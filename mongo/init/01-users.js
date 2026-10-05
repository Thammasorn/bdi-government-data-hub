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
//   bdi_backend — find ทุก collection ของฐานนี้ · insert เฉพาะสี่ collection ที่มันเขียนจริง (BACKEND_WRITES —
//                 error_events, error_issues, runtime_events และ activity ของ audit_fallback) · update เฉพาะ
//                 error_issues (ตัวนับของ issue กับสถานะ open/resolved/ignored) ไม่มี remove ไม่มี drop ไม่มี createIndex
//                 ไม่มี insert บน relay_state: เอกสารนั้นถือ cursor ของ relay กับธงเกินเพดาน และตอนที่มันยังไม่มี
//                 (volume ใหม่ หรือมีคนลบทั้งใบ) backend ที่ถูกยึดเคยวางใบปลอมได้ — cursor ที่เป็นเวลาปัจจุบันทำให้ relay
//                 ข้าม backfill ทั้งหมดเงียบ ๆ และ `overQuota: true` ทำให้ error ทั้งระบบเหลือแค่ตัวนับ (ตรวจขั้น 6,
//                 2026-09-30) collection ใหม่ที่ backend ต้องเขียน ต้องเพิ่มชื่อใน BACKEND_WRITES แล้วรันไฟล์นี้ซ้ำ
//                 ไม่งั้นได้ "not authorized on bdi_logs to execute command { insert: … }"
//   bdi_worker  — เพิ่ม update/remove (relay upsert, prune ตามอายุ) createIndex กับ listIndexes (ensureIndexes
//                 ตอนบูต ดูว่ามีอะไรอยู่แล้วก่อนสร้าง) listCollections, collStats และ dbStats (ตรวจเพดานขนาด
//                 รวมทั้งฐานและราย collection) ยังไม่มี drop ใด ๆ — รายการเต็มคือ ROLES.bdiLogWorker ข้างล่าง
// ไม่ต้องให้ createCollection: insert หรือ createIndex ลง collection ที่ยังไม่มีก็สร้างมันเองได้ด้วยสิทธิ์ของตัวมัน
// (ลองกับ mongo:7.0 แล้ว 2026-09-30)

const DB_NAME = process.env.MONGODB_DB || "bdi_logs";

/**
 * กติกาเดียวกับ mongo/entrypoint.sh ทุกข้อ — ที่นั่นกันทุกครั้งที่เริ่ม ที่นี่กันซ้ำตอน init เผื่อมีคนรัน mongod
 * โดยไม่ผ่าน entrypoint ของเรา throw ในไฟล์นี้ = docker-entrypoint.sh ออกด้วย error คอนเทนเนอร์ไม่ขึ้น
 * (warnIfDevPassword ใน backend/src/lib/log-store.ts ใช้ร่วมแค่ข้อ dev-…/…change-me และแค่เตือน)
 */
function checkPasswords() {
  if (process.env.MONGO_REFUSE_DEV_PASSWORDS !== "true") return;
  const bad = [];
  const names = ["MONGO_INITDB_ROOT_PASSWORD", "MONGO_BACKEND_PASSWORD", "MONGO_WORKER_PASSWORD"];
  // user ของเครื่องมือค้น log ไม่บังคับ — ตรวจเฉพาะเมื่อมีคนตั้ง
  // (compose ส่งค่าว่างมาเสมอเมื่อไม่ได้ตั้ง — ว่าง = ไม่ใช้ ไม่ใช่รหัสผ่านผิด)
  if (process.env.MONGO_READER_PASSWORD) names.push("MONGO_READER_PASSWORD");
  for (const name of names) {
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
const only = (collection) => ({ db: DB_NAME, collection });

/** collection ที่ backend insert — lib/error-capture.ts (`insertAll` กับ upsert ของ issue) ที่เดียว */
const BACKEND_WRITES = ["activity", "error_events", "error_issues", "runtime_events"];
/** collection ที่ผู้อ่านผ่านเครื่องมือ (bdi_reader) เห็น — ทุกตัวเป็นสำเนาที่ปิดเลขบัตรและ scrub แล้ว */
const READER_COLLECTIONS = ["activity", "error_events", "error_issues", "runtime_events"];

const ROLES = {
  bdiLogBackend: [
    { resource: everything, actions: ["find"] },
    ...BACKEND_WRITES.map((collection) => ({
      resource: only(collection),
      actions: collection === "error_issues" ? ["insert", "update"] : ["insert"],
    })),
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
  /**
   * เครื่องมือค้น log ที่ต่อฐานข้อมูลตรง (Metabase — docs/21 §11) อ่านได้เฉพาะสี่ collection ที่ปิดเลขบัตร
   * และ scrub แล้ว ไม่เห็น relay_state ไม่เขียนอะไรเลย — การอ่านผ่านทางนี้ไม่ถูกบันทึกเป็น
   * AUDIT_LOG_READ เหมือน API จึงต้องจำกัดคนที่เข้าเครื่องมือได้แทน
   */
  bdiLogReader: [
    ...READER_COLLECTIONS.map((collection) => ({ resource: only(collection), actions: ["find", "collStats"] })),
    // dbStats บอกแค่ขนาดฐานข้อมูล ไม่มีข้อมูล — Metabase ใช้ทดสอบการเชื่อมต่อ
    { resource: everything, actions: ["listCollections", "listIndexes", "dbStats"] },
  ],
};

const USERS = [
  { user: "bdi_backend", role: "bdiLogBackend", passwordVar: "MONGO_BACKEND_PASSWORD" },
  { user: "bdi_worker", role: "bdiLogWorker", passwordVar: "MONGO_WORKER_PASSWORD" },
  // ไม่บังคับ — สร้างเฉพาะเมื่อมีรหัสผ่าน production จึงไม่มี user นี้จนกว่าจะเลือกเปิดเครื่องมือค้น log
  { user: "bdi_reader", role: "bdiLogReader", passwordVar: "MONGO_READER_PASSWORD", optional: true },
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

for (const { user, role, passwordVar, optional } of USERS) {
  if (optional && !process.env[passwordVar]) {
    print(`[mongo] ข้าม user ${DB_NAME}.${user} — ไม่ได้ตั้ง ${passwordVar}`);
    continue;
  }
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
