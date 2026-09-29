// role กับ user ของ log store — ผู้ใช้สิทธิ์น้อยที่สุดสองคน (docs/21)
//
// docker-entrypoint.sh ของ image รันไฟล์นี้ด้วย mongosh ในฐานะ root **ครั้งเดียว ตอน volume ยังว่าง**
// เปลี่ยนรหัสผ่านใน .env ทีหลังจึงไม่มีผลกับ volume ที่ init ไปแล้ว — ไฟล์นี้เขียนให้รันซ้ำได้ (สร้างหรืออัปเดต
// role/user ตามค่าปัจจุบัน) ใช้เปลี่ยนรหัสผ่านของ bdi_backend/bdi_worker หรือปรับสิทธิ์ของ volume เดิมด้วยมือ:
//
//   docker compose exec mongo sh -c 'mongosh -u "$MONGO_INITDB_ROOT_USERNAME" -p "$MONGO_INITDB_ROOT_PASSWORD" \
//     --authenticationDatabase admin --quiet /docker-entrypoint-initdb.d/01-users.js'
//
// (รหัสผ่านของ root เองเปลี่ยนด้วยไฟล์นี้ไม่ได้ ใช้ db.changeUserPassword)
//
// แบ่งสองคนเพราะ backend คือ process ที่รับคำขอจากอินเทอร์เน็ต: ถ้ามันถูกยึด ต้องลบหรือแก้ activity ย้อนหลังไม่ได้
//   bdi_backend — find + insert ทุก collection ของฐานนี้ และ update เฉพาะ error_issues (ตัวนับของ issue
//                 กับสถานะ open/resolved/ignored) ไม่มี remove ไม่มี drop ไม่มี createIndex
//   bdi_worker  — เพิ่ม update/remove (relay upsert, prune ตามอายุ) createIndex กับ listIndexes (ensureIndexes
//                 ตอนบูต ดูว่ามีอะไรอยู่แล้วก่อนสร้าง) listCollections, collStats และ dbStats (ตรวจเพดานขนาด
//                 รวมทั้งฐานและราย collection) ยังไม่มี drop ใด ๆ — รายการเต็มคือ ROLES.bdiLogWorker ข้างล่าง
// ไม่ต้องให้ createCollection: insert หรือ createIndex ลง collection ที่ยังไม่มีก็สร้างมันเองได้ด้วยสิทธิ์ของตัวมัน
// (ลองกับ mongo:7.0 แล้ว 2026-09-30)

const DB_NAME = process.env.MONGODB_DB || "bdi_logs";

/**
 * กติกาเดียวกับ mongo/entrypoint.sh — ที่นั่นกันทุกครั้งที่เริ่ม ที่นี่กันซ้ำตอน init เผื่อมีคนรัน mongod
 * โดยไม่ผ่าน entrypoint ของเรา throw ในไฟล์นี้ = docker-entrypoint.sh ออกด้วย error คอนเทนเนอร์ไม่ขึ้น
 */
function checkPasswords() {
  if (process.env.MONGO_REFUSE_DEV_PASSWORDS !== "true") return;
  const bad = [];
  for (const name of ["MONGO_INITDB_ROOT_PASSWORD", "MONGO_BACKEND_PASSWORD", "MONGO_WORKER_PASSWORD"]) {
    const value = process.env[name] || "";
    const devLike = value === "" || value.startsWith("dev-") || value.includes("change-me");
    // รหัสผ่านของ backend/worker ถูกแทนลงใน MONGODB_URI โดยไม่ encode
    const uriUnsafe = name !== "MONGO_INITDB_ROOT_PASSWORD" && /[^A-Za-z0-9._~-]/.test(value);
    if (devLike || uriUnsafe) bad.push(name);
  }
  if (bad.length > 0) {
    throw new Error(
      `[mongo] ไม่สร้างผู้ใช้ของ log store: รหัสผ่านว่าง ยังเป็นค่าตัวอย่าง หรือใส่ใน URI ไม่ได้ — ${bad.join(", ")} ` +
        "(ตั้งใน .env ด้วย `openssl rand -hex 32`)",
    );
  }
}

function requirePassword(name) {
  const value = process.env[name];
  if (!value) throw new Error(`[mongo] ไม่ได้ส่ง ${name} มาให้คอนเทนเนอร์ mongo — ดู environment ใน docker-compose.yml`);
  return value;
}

checkPasswords();

const logs = db.getSiblingDB(DB_NAME);
const everything = { db: DB_NAME, collection: "" };

const ROLES = {
  bdiLogBackend: [
    { resource: everything, actions: ["find", "insert"] },
    { resource: { db: DB_NAME, collection: "error_issues" }, actions: ["update"] },
  ],
  bdiLogWorker: [
    {
      resource: everything,
      actions: [
        "find",
        "insert",
        "update",
        "remove",
        "createIndex",
        "listIndexes",
        "listCollections",
        "collStats",
        "dbStats",
      ],
    },
  ],
};

const USERS = [
  { user: "bdi_backend", role: "bdiLogBackend", passwordVar: "MONGO_BACKEND_PASSWORD" },
  { user: "bdi_worker", role: "bdiLogWorker", passwordVar: "MONGO_WORKER_PASSWORD" },
];

for (const [role, privileges] of Object.entries(ROLES)) {
  if (logs.getRole(role)) {
    logs.updateRole(role, { privileges, roles: [] });
    print(`[mongo] อัปเดต role ${DB_NAME}.${role}`);
  } else {
    logs.createRole({ role, privileges, roles: [] });
    print(`[mongo] สร้าง role ${DB_NAME}.${role}`);
  }
}

for (const { user, role, passwordVar } of USERS) {
  const pwd = requirePassword(passwordVar);
  const roles = [{ role, db: DB_NAME }];
  if (logs.getUser(user)) {
    logs.updateUser(user, { pwd, roles });
    print(`[mongo] อัปเดต user ${DB_NAME}.${user}`);
  } else {
    logs.createUser({ user, pwd, roles });
    print(`[mongo] สร้าง user ${DB_NAME}.${user}`);
  }
}
