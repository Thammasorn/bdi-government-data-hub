/**
 * log store — MongoDB ที่เก็บสำเนาค้นหาได้ของ audit.audit_event และ error ของระบบ (docs/21)
 *
 * **ไฟล์นี้เป็นไฟล์เดียวที่แตะ driver `mongodb`** แบบเดียวกับที่ storage.ts เป็นที่เดียวที่แตะ
 * `@azure/storage-blob` และแตะผ่าน `import()` ตอนเปิดใช้เท่านั้น — `import type` ข้างล่าง tsc ลบทิ้งตอน build
 * ปิด log store (`LOG_STORE_ENABLED=false` หรือไม่มี URI) แล้ว driver ไม่ถูกโหลดเลย และ driver ที่โหลดไม่ขึ้น
 * (แพ็กเกจหาย เสีย) ทำได้แค่ให้สถานะเป็น `down` ไม่มีทางทำให้ backend หรือ worker บูตไม่ขึ้น
 *
 * log store เป็นของเสริม ไม่ใช่ของที่ระบบขาดไม่ได้ กติกาของไฟล์นี้จึงเป็น:
 *   - ไม่มีฟังก์ชันไหน throw ออกไปหาผู้เรียก — ต่อไม่ได้คือสถานะ `down` กับหนึ่งบรรทัดใน log
 *   - ไม่มีอะไรบนเส้นทางของคำขอรอ Mongo: `/health/ready` อ่านสถานะที่จำไว้ ซึ่งตรวจใหม่เบื้องหลังทุก 30 วินาที
 *   - timeout ของ driver สั้น (CLIENT_TIMEOUTS) Mongo ที่ช้าหรือหายไปรู้ผลภายในไม่กี่วินาที ไม่ค้าง
 *   - ต่อแบบขี้เกียจ: สร้าง client ตอนใช้ครั้งแรก ต่อไม่ติดก็ทิ้ง client นั้นแล้วลองใหม่รอบหน้า
 */
import type { Db, MongoClient, MongoClientOptions } from "mongodb";

import { env } from "../env.js";

/**
 * สถานะที่ `/health/ready` รายงาน (สาธารณะ — จึงมีแค่คำเดียว ไม่มีรายละเอียดของ error)
 *
 *   up         — ต่อได้ login ผ่าน อ่านได้
 *   down       — ต่อไม่ได้ login ไม่ผ่าน หรือ driver โหลดไม่ขึ้น (รายละเอียดอยู่ใน log ของ process)
 *   disabled   — ปิดไว้ด้วย LOG_STORE_ENABLED=false หรือไม่มี MONGODB_URI
 *   over_quota — ต่อได้ แต่ธง `overQuota` ใน relay_state ตั้งอยู่ ซึ่งแปลว่าขนาดเกิน LOG_STORE_MAX_MB แล้ว
 *                ตัวตั้งธงคือตัวตรวจเพดานรายชั่วโมงของ worker (workers/log-upkeep.ts) ระหว่างที่ธงตั้งอยู่
 *                lib/error-capture.ts เก็บแค่ตัวนับของ issue ไม่เก็บ error event ทีละตัว
 */
export type LogStoreStatus = "up" | "down" | "disabled" | "over_quota";

/** ใครเป็นคนเปิด — ใช้ในบรรทัด log และเป็น appName ที่ Mongo เห็น */
export type LogStoreService = "backend" | "delivery-worker";

/** เอกสารใน relay_state ที่ worker เขียน (workers/log-upkeep.ts) — ไฟล์นี้อ่านแค่ธงเพดานขนาด */
interface RelayStateDoc {
  _id: string;
  overQuota?: boolean;
}

/** ตรวจสถานะใหม่ทุกเท่านี้ — health อ่านค่าที่จำไว้ จึงไม่มี probe ไหนต้องรอ Mongo */
const REFRESH_MS = 30_000;
/** ตอนบูต รอผลตรวจครั้งแรกไม่เกินเท่านี้ แล้วเดินต่อไม่ว่าผลจะเป็นอะไร (เหมือน ensureContainer) */
const FIRST_CHECK_WAIT_MS = 3_000;
/** เพดานของการตรวจหนึ่งรอบทั้งก้อน เผื่อ driver ค้างเกินกว่า timeout ของตัวเอง */
const CHECK_TIMEOUT_MS = 6_000;
/** ตอนปิด process รอ client ปิดไม่เกินเท่านี้ — compose ให้เวลาทั้งหมด 10 วินาทีก่อน SIGKILL */
const CLOSE_WAIT_MS = 1_500;

/**
 * Mongo ช้าหรือล่มต้องรู้ผลเร็ว ไม่ใช่ค้างตาม default ของ driver (เลือก server 30 วินาที, socket ไม่มีเพดาน)
 * pool เล็ก: backend 5, worker 3 — ตั้งจาก startLogStore()
 */
const CLIENT_TIMEOUTS = {
  serverSelectionTimeoutMS: 2_000,
  connectTimeoutMS: 2_000,
  socketTimeoutMS: 5_000,
} satisfies MongoClientOptions;

/**
 * สถานะเดิมแต่สาเหตุของความล้มเหลวเปลี่ยน พิมพ์บรรทัดใหม่ได้ไม่ถี่กว่านี้ (setState) — สถานะที่เปลี่ยนพิมพ์ทันทีเสมอ
 * สิบนาทีคือไม่เกิน 6 บรรทัดต่อชั่วโมงต่อ process ต่อให้สาเหตุสลับไปมาทุกรอบตรวจ
 */
const CAUSE_REPRINT_MS = 10 * 60_000;

/** บรรทัดสถานะที่พิมพ์ไปล่าสุด — ใช้ตัดสินว่าผลตรวจรอบใหม่มีอะไรใหม่ให้พิมพ์ไหม */
interface Printed {
  status: LogStoreStatus;
  /** สาเหตุแบบตัดตัวเลขทิ้งแล้ว (causeKey) หรือ null ถ้าไม่มี error */
  cause: string | null;
  at: number;
}

let currentStatus: LogStoreStatus = env.logStore.enabled ? "down" : "disabled";
let printed: Printed | null = null;
let service: LogStoreService = "backend";
let maxPoolSize = 5;
let started = false;
let closed = false;
let timer: NodeJS.Timeout | null = null;
let client: MongoClient | null = null;
let connecting: Promise<MongoClient> | null = null;
let refreshing: Promise<void> | null = null;

/** สถานะล่าสุดที่ตรวจไว้ — ไม่แตะ Mongo ไม่ await อะไร เรียกจาก health probe ได้ทุกครั้ง */
export function logStoreStatus(): { status: LogStoreStatus } {
  return { status: currentStatus };
}

/**
 * เปิด log store ของ process นี้ — ตรวจครั้งแรก แล้วตั้งให้ตรวจซ้ำทุก 30 วินาที
 *
 * ไม่ reject เลย และคืนค่าภายใน ~3 วินาทีเสมอ: backend รอได้ตอนบูต (ได้สถานะแรกที่ถูกก่อนเปิดรับคำขอ)
 * ส่วน worker ไม่ต้องรอ — ลูปส่งอีเมลเริ่มได้ทันทีโดยไม่ผูกกับ Mongo
 */
export function startLogStore(options: { service: LogStoreService; maxPoolSize: number }): Promise<void> {
  if (started) return Promise.resolve();
  started = true;
  service = options.service;
  maxPoolSize = options.maxPoolSize;

  if (!env.logStore.enabled) {
    const why = env.logStore.uri ? "LOG_STORE_ENABLED ไม่ใช่ true" : "ไม่ได้ตั้ง MONGODB_URI";
    console.log(`[log-store] ${service}: ปิดอยู่ (${why}) — ไม่โหลด driver ของ Mongo`);
    return Promise.resolve();
  }

  warnIfDevPassword();
  warnIfNoHashKey();

  timer = setInterval(() => void refresh(), REFRESH_MS);
  // ตัวตรวจซ้ำต้องไม่รั้ง process ไว้ตอนที่อย่างอื่นจบหมดแล้ว
  timer.unref();
  // ส่วนเส้นตายของการรอครั้งแรก**ต้องไม่ unref**: ตอนบูตยังไม่มีอะไรอื่นรั้ง event loop ไว้ ถ้า Mongo ล่มแล้วตัวจับ
  // เวลาของ driver ไม่ ref ด้วย process จะจบเงียบ ๆ ก่อนถึง listen — log store ล่มแล้วพา backend ล่มตาม
  return settleWithin(refresh(), FIRST_CHECK_WAIT_MS);
}

/**
 * ฐานข้อมูลของ log store สำหรับผู้เขียน (lib/error-capture.ts, workers/log-upkeep.ts) — ไม่ reject
 *
 * คืน null เมื่อปิดอยู่ ยังไม่ได้ `startLogStore()` ถูกปิดไปแล้ว หรือต่อไม่ได้ (สถานะกลายเป็น `down` พร้อมบรรทัดเดียว
 * ตามกติกาของ setState) ผู้เรียกถือ null ว่า "ตอนนี้เขียนไม่ได้" แล้วลองใหม่รอบหน้า ไม่ใช่ error
 *
 * **ผู้เรียกที่อ่านต้องใส่ `maxTimeMS` เอง** — timeout ของ driver (CLIENT_TIMEOUTS) คุมแค่การต่อกับ socket ไม่ได้คุม
 * query ที่ server ทำงานนาน ส่วนการเขียนจบใน socketTimeoutMS 5 วินาทีอยู่แล้ว
 */
export async function logDb(): Promise<Db | null> {
  if (!env.logStore.enabled || !started || closed) return null;
  try {
    return (await connectedClient()).db(env.logStore.db);
  } catch (err) {
    setState("down", describe(err));
    return null;
  }
}

/**
 * ปิด client ตอน process จะออก — ไม่ reject และไม่รอเกิน CLOSE_WAIT_MS
 *
 * การเชื่อมต่อที่ยังค้างอยู่ไม่ต้องรอ: `closed` ทำให้มันปิด client ของตัวเองทันทีที่ต่อเสร็จ
 */
export async function closeLogStore(): Promise<void> {
  closed = true;
  if (timer) clearInterval(timer);
  timer = null;
  const current = client;
  client = null;
  if (current) await settleWithin(current.close(), CLOSE_WAIT_MS);
}

// ---------------------------------------------------------------------------------------------

/** โหลด driver ครั้งเดียวต่อ process (โหลดไม่ขึ้นก็ลองใหม่รอบหน้า ไม่จำความล้มเหลวไว้) */
let driver: Promise<typeof import("mongodb")> | null = null;
function loadDriver(): Promise<typeof import("mongodb")> {
  if (!driver) {
    driver = import("mongodb").catch((err: unknown) => {
      driver = null;
      throw err;
    });
  }
  return driver;
}

function connectedClient(): Promise<MongoClient> {
  if (client) return Promise.resolve(client);
  if (!connecting) {
    connecting = (async () => {
      const { MongoClient } = await loadDriver();
      let fresh: MongoClient;
      try {
        fresh = new MongoClient(env.logStore.uri, {
          ...CLIENT_TIMEOUTS,
          maxPoolSize,
          appName: `bdi-${service}`,
        });
      } catch (err) {
        // constructor คือที่ driver แยก connection string — ข้อความจากตรงนี้ห้ามพิมพ์ตรง ๆ (describe)
        throw new UriRejected(err);
      }
      // driver ส่ง 'error' ของ topology ต่อมาที่ client (เช่น MongoCompatibilityError เมื่อ server เก่าหรือใหม่เกินรุ่น
      // ที่ driver คุยได้ — lib/sdam/topology.js) และ EventEmitter ที่ไม่มีใครฟัง 'error' จะ throw ออกมาเป็น
      // uncaught exception ซึ่งพา process ล่มทั้งตัว ฟังไว้ให้เหลือแค่สถานะ down
      fresh.on("error", (err) => setState("down", describe(err)));
      try {
        await fresh.connect();
      } catch (err) {
        // client ที่ connect ล้มเอากลับมาใช้ไม่ได้แน่ ๆ ทุกรุ่นของ driver — ปิดทิ้ง รอบหน้าสร้างใหม่
        await fresh.close().catch(() => undefined);
        throw err;
      }
      if (closed) {
        await fresh.close().catch(() => undefined);
        throw new Error("log store ถูกปิดระหว่างเชื่อมต่อ");
      }
      client = fresh;
      return fresh;
    })().finally(() => {
      connecting = null;
    });
  }
  return connecting;
}

/**
 * ตรวจหนึ่งรอบ: ping (ต่อได้ + login ผ่าน) แล้วอ่านธงเพดานขนาดที่ worker เขียนไว้ — ไม่ซ้อนกัน ไม่ throw
 *
 * อ่าน relay_state ด้วยสิทธิ์ของ process เอง จึงได้ตรวจไปในตัวว่า user นั้นอ่านฐานนี้ได้จริง
 * collection ที่ยังไม่มีคืน null ธรรมดา ไม่ใช่ error
 */
function refresh(): Promise<void> {
  if (closed) return Promise.resolve();
  if (!refreshing) {
    refreshing = withTimeout(
      (async () => {
        const db = (await connectedClient()).db(env.logStore.db);
        await db.command({ ping: 1 });
        const relay = await db
          .collection<RelayStateDoc>("relay_state")
          .findOne({ _id: "audit_event" }, { projection: { overQuota: 1 }, maxTimeMS: 2_000 });
        setState(relay?.overQuota === true ? "over_quota" : "up", null);
      })(),
      CHECK_TIMEOUT_MS,
    )
      .catch((err: unknown) => setState("down", describe(err)))
      .finally(() => {
        refreshing = null;
      });
  }
  return refreshing;
}

/**
 * เปลี่ยนสถานะ และพิมพ์หนึ่งบรรทัดเมื่อมีอะไรใหม่ให้บอก — Mongo ที่ล่มนาน ๆ ต้องไม่ได้บรรทัดใหม่ทุก 30 วินาที
 *
 *   - สถานะเปลี่ยน (up → down, down → up, …) และผลตรวจครั้งแรกของ process พิมพ์ทันทีเสมอ
 *   - สถานะเดิมแต่สาเหตุเปลี่ยน พิมพ์ได้ไม่ถี่กว่า CAUSE_REPRINT_MS สาเหตุเทียบกันหลังตัดตัวเลขทิ้ง (causeKey)
 *     เพราะข้อความของ driver ฝังเวลาที่ใช้ไว้ ("timed out after 2001ms" รอบนี้ "2002ms" รอบหน้า) และ IP ของ
 *     container ซึ่งเปลี่ยนทุกครั้งที่สร้างใหม่ — เทียบทั้งข้อความเคยทำให้พิมพ์ซ้ำเกือบทุกรอบตลอดเวลาที่ล่ม
 *     ส่วนเพดานเวลากันสาเหตุที่สลับไปมา เช่น mongo ที่วนรีสตาร์ต (main/ ก่อนตั้งรหัสผ่านจริง) ซึ่งบางรอบหาชื่อ
 *     host ไม่เจอ บางรอบต่อไม่ติด
 * สถานะปัจจุบันยังดูได้ตลอดที่ /health/ready — บรรทัดใน log มีไว้บอกว่าเปลี่ยนเมื่อไรและเพราะอะไร
 */
function setState(status: LogStoreStatus, error: string | null) {
  currentStatus = status;
  const cause = error === null ? null : causeKey(error);
  const now = Date.now();
  if (printed?.status === status && (printed.cause === cause || now - printed.at < CAUSE_REPRINT_MS)) return;
  printed = { status, cause, at: now };
  const where = `ฐานข้อมูล ${env.logStore.db}`;
  if (status === "up") console.log(`[log-store] ${service}: เชื่อมต่อ MongoDB ได้ (${where})`);
  else if (status === "over_quota") {
    console.warn(`[log-store] ${service}: เชื่อมต่อได้ แต่ขนาดเกิน LOG_STORE_MAX_MB แล้ว (${where})`);
  } else if (status === "down") console.warn(`[log-store] ${service}: ใช้ MongoDB ไม่ได้ — ${error ?? "ไม่ทราบสาเหตุ"}`);
}

/**
 * รหัสผ่านใน URI ยังเป็นค่าตัวอย่างของ dev (`dev-…` หรือ `…change-me`)
 *
 * ใช้แค่ข้อนี้ข้อเดียวร่วมกับ mongo/entrypoint.sh และ mongo/init/01-users.js สองไฟล์นั้นยังปฏิเสธรหัสผ่านว่าง
 * และอักขระนอก [A-Za-z0-9._~-] ด้วย เพราะมันตรวจตัวแปร MONGO_*_PASSWORD ก่อนถูกแทนลงใน URI ส่วนที่นี่เห็น URI
 * ที่ประกอบเสร็จหรือเขียนเองแล้ว: URI ที่ไม่มีรหัสผ่าน (managed Mongo ที่ใช้ identity แทน) ถูกต้อง และอักขระพิเศษที่
 * encode เป็น %xx แล้วก็ถูกต้อง
 *
 * เตือนเฉพาะ production แบบเดียวกับคำเตือน ADMIN_API_TOKEN ใน index.ts: เตือน ไม่ใช่ปฏิเสธ เพราะ log store
 * เป็นของเสริมและ deploy ต้องไม่ทำให้ process วนรีสตาร์ต ไม่พิมพ์ค่าหรือความยาวของรหัสผ่าน
 */
function warnIfDevPassword() {
  if (env.nodeEnv !== "production") return;
  const password = uriPassword(env.logStore.uri)?.decoded;
  if (password === undefined) return;
  if (password.startsWith("dev-") || password.includes("change-me")) {
    console.warn(
      `[log-store] ${service}: คำเตือน: รหัสผ่านใน MONGODB_URI ยังเป็นค่าตัวอย่าง dev-…/…change-me ที่เปิดเผยอยู่ใน ` +
        "repo — ตั้ง MONGO_BACKEND_PASSWORD / MONGO_WORKER_PASSWORD ใน .env เป็นค่าจาก `openssl rand -hex 32` " +
        "(mongo ใน prod overlay ไม่ยอมเริ่มด้วยค่าเหล่านี้อยู่แล้ว)",
    );
  }
}

/**
 * ไม่มี LOG_HASH_KEY (production ที่ยังไม่ได้ตั้ง — dev มีค่าตั้งต้น) — ปิดค่าได้ แต่ทำ key ค้นหาไม่ได้ ไม่ใช่ error
 * เตือนทุกครั้งที่บูต เพราะผลของมันเงียบ: ทุกเอกสารที่เขียนระหว่างนี้ค้นด้วยเลขบัตรหรืออีเมล (`x-log-cid` / `x-log-email`) ไม่เจอไปตลอด จนกว่าจะ rebuild
 */
function warnIfNoHashKey() {
  if (env.logStore.hashKey) return;
  console.warn(
    `[log-store] ${service}: คำเตือน: ไม่ได้ตั้ง LOG_HASH_KEY — เลขบัตรและอีเมลที่พิมพ์มาในสำเนากิจกรรมถูกปิดอย่างเดียว ` +
      "ไม่มี key ค้นหา cid#/email# (API อ่าน log ค้นด้วย x-log-cid / x-log-email ไม่ได้) ตั้งเป็นค่าจาก `openssl rand -hex 32` ใน .env " +
      "ค่าเดียวกันทั้ง backend และ delivery-worker",
  );
}

/** สาเหตุสำหรับเทียบใน setState: ตัวเลขทุกชุดเป็น `#` ("after 2001ms" กับ "after 2002ms" คือสาเหตุเดียวกัน) */
function causeKey(error: string): string {
  return error.replace(/\d+/g, "#");
}

/**
 * รหัสผ่านใน `mongodb://user:pass@…` ตามที่ driver เองแยก หรือ null ถ้าไม่มี (คืนทั้งแบบดิบใน URI และแบบถอด %xx)
 *
 * แยกแบบเดียวกับ HOSTS_REGEX ของ mongodb-connection-string-url: รหัสผ่านคือทุกตัวหลัง `user:` จนถึง `@` ตัวแรก
 * `/` ที่ไม่ได้ encode จึงนับเป็นรหัสผ่านด้วย ไม่ใช้ `new URL` เพราะ URI หลาย host แยกไม่ได้
 */
function uriPassword(uri: string): { raw: string; decoded: string } | null {
  const match = /^mongodb(?:\+srv)?:\/\/[^:@]*:([^@]*)@/i.exec(uri);
  const raw = match?.[1];
  if (!raw) return null;
  try {
    return { raw, decoded: decodeURIComponent(raw) };
  } catch {
    return { raw, decoded: raw };
  }
}

/**
 * `new MongoClient()` ปฏิเสธ connection string — ห่อ error เดิมไว้ให้ describe() รู้ว่ามาจากการแยก URI
 * ซึ่งเป็นที่เดียวที่พบว่า driver รุ่นนี้ยก URI (ทั้งเส้นหรือท่อนหลัง `user:`) มาใส่ข้อความ
 */
class UriRejected extends Error {
  constructor(readonly original: unknown) {
    super("MONGODB_URI rejected by the driver");
  }
}

/**
 * ข้อความของ driver ตอนแยก URI ไม่ได้ ที่เป็นประโยคตายตัว ไม่มีส่วนไหนของ URI ปน — พิมพ์ได้ (เทียบทั้งประโยค)
 * ข้อความอื่นของขั้นนี้ไม่พิมพ์ รวมถึงข้อความที่ driver รุ่นหน้าเพิ่มหรือเปลี่ยนถ้อยคำ
 * ที่มา: mongodb-connection-string-url 3.0 (ConnectionString) และ decodeURIComponent ของ %xx ที่เสีย
 */
const FIXED_PARSE_MESSAGES = new Set([
  'Invalid scheme, expected connection string to start with "mongodb://" or "mongodb+srv://"',
  "Password contains unescaped characters",
  "URI contained empty userinfo section",
  "URI malformed",
  "mongodb+srv URI cannot have multiple service names",
  "mongodb+srv URI cannot have port number",
]);

/**
 * URI ที่ตั้งไว้มี `@` เกินหนึ่งตัว — ข้อความของ driver ทุกขั้นอาจมีท่อนหนึ่งของรหัสผ่าน (describe)
 * นับทั้งเส้น ไม่หยุดที่ `?`: รหัสผ่าน `pa@ss?x` ทำให้ driver อ่าน `ss` เป็นชื่อ host และ `?x@…` เป็น query
 * `@` ที่อยู่ใน query จริง ๆ ก็ถูกนับด้วย — ผลคือไม่ได้ข้อความละเอียดของ driver ไม่ใช่รหัสผ่านรั่ว
 */
const URI_HAS_EXTRA_AT = (env.logStore.uri.match(/@/g)?.length ?? 0) > 1;

/**
 * userinfo ของ connection string ใดก็ตามที่อยู่ในข้อความ — ถึง `@` ตัวสุดท้ายก่อนช่องว่างหรือเครื่องหมายคำพูด
 * driver รุ่นนี้ยก URI มาเฉพาะตอนแยก URI ซึ่ง describe() ไม่พิมพ์อยู่แล้ว ชั้นนี้กันไว้เผื่อรุ่นหน้า
 */
const URI_USERINFO = /(mongodb(?:\+srv)?:\/\/[^:@\s"']*:)[^\s"']*@/gi;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * ข้อความของ error สำหรับ log — แยกตามที่มา เพราะ driver ดัดรหัสผ่านก่อนยกมาหลายแบบจนตามลบทีหลังไม่ครบ
 *
 *   1. แยก URI ไม่ได้ (UriRejected): driver ยก URI หรือบางส่วนมาในหลายรูป — ทั้งเส้นในเครื่องหมายคำพูด
 *      (`Protocol and host list are required in "…"`), ต่อท้าย `Invalid URL:`, และท่อนหลัง `user:` ที่แทนช่องว่าง
 *      ด้วย %20 (`Unable to parse bdi_backend:Sek%20r3t with URL` เมื่อ URI ไม่มี `@`) จึงพิมพ์แค่ชื่อ error
 *      กับประโยคใน FIXED_PARSE_MESSAGES
 *   2. URI มี `@` เกินหนึ่งตัว: driver ถือว่ารหัสผ่านจบที่ `@` ตัวแรก แล้วอ่านท่อนถัดไปเป็นชื่อ host ซึ่ง error ตอนต่อ
 *      ยกมา — ตัวพิมพ์เล็กด้วย (`getaddrinfo ENOTFOUND r3tpw`, `querySrv ENOTFOUND _mongodb._tcp.r3tPw`)
 *      จึงพิมพ์แค่ชื่อ error กับวิธีแก้
 *   3. นอกนั้น (แยก URI ผ่าน และมี `@` ตัวเดียว) รหัสผ่านอยู่ใน userinfo เท่านั้น ซึ่ง error ตอนต่อ/login/ping
 *      ไม่ยกมา ข้อความจึงพิมพ์ได้หลังลบสองชั้นกันไว้ (ไม่สนตัวพิมพ์เล็กใหญ่): userinfo ของ URI ใด ๆ ในข้อความ
 *      และรหัสผ่านของ URI ที่ตั้งไว้ในรูปดิบ ถอด %xx แล้ว และ encode ใหม่
 * ข้อ 1 กับ 2 ปิดทุกทางที่พบว่า driver รุ่นนี้ (mongodb 6.21) ยกรหัสผ่านมา การลบทีหลังในข้อ 3 จึงเป็นชั้นสำรอง
 * ไม่ใช่ชั้นที่ต้องเดาให้ครบทุกรูปของรหัสผ่านอีกต่อไป
 */
function describe(err: unknown): string {
  if (err instanceof UriRejected) {
    const original = err.original;
    const name = original instanceof Error ? original.name : "Error";
    const message = original instanceof Error ? original.message : "";
    const reason = FIXED_PARSE_MESSAGES.has(message)
      ? `(${message})`
      : "(ไม่พิมพ์ข้อความของ driver เพราะอาจยก URI มาด้วย)";
    return (
      `${name}: driver แยก MONGODB_URI ไม่ได้ ${reason} — ตรวจรูป mongodb://ผู้ใช้:รหัสผ่าน@host:port/ฐานข้อมูล ` +
      "และเขียนอักขระพิเศษในรหัสผ่านเป็น %xx"
    );
  }
  const name = err instanceof Error ? err.name : "Error";
  if (URI_HAS_EXTRA_AT) {
    return (
      `${name}: (ไม่พิมพ์ข้อความของ driver) MONGODB_URI มี @ เกินหนึ่งตัว driver จึงอ่านท่อนหลัง @ ตัวแรกเป็นชื่อ ` +
      "host และข้อความของมันอาจมีบางส่วนของรหัสผ่าน — @ ในรหัสผ่านต้องเขียนเป็น %40"
    );
  }
  let text = err instanceof Error ? `${name}: ${err.message}` : String(err);
  text = text.replace(URI_USERINFO, "$1***@");
  const password = uriPassword(env.logStore.uri);
  if (password) {
    const forms = new Set([password.raw, password.decoded, encodeURIComponent(password.decoded)]);
    for (const form of forms) if (form) text = text.replace(new RegExp(escapeRegExp(form), "gi"), "***");
  }
  return text.length > 300 ? `${text.slice(0, 300)}…` : text;
}

/** รอ `work` ไม่เกิน `ms` แล้วคืนค่าเสมอ ไม่ว่ามันจะสำเร็จ ล้ม หรือยังไม่จบ — ไม่ reject */
function settleWithin(work: Promise<unknown>, ms: number): Promise<void> {
  let handle: NodeJS.Timeout | undefined;
  const deadline = new Promise<void>((resolve) => {
    handle = setTimeout(resolve, ms);
  });
  const settled = work.then(
    () => undefined,
    () => undefined,
  );
  return Promise.race([settled, deadline]).finally(() => clearTimeout(handle));
}

/** เหมือน `work` แต่ล้มถ้าไม่จบใน `ms` — ตัวจับเวลาถูกล้างทันทีที่ `work` จบ */
function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let handle: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    handle = setTimeout(() => reject(new Error(`ตรวจ log store เกิน ${ms / 1000} วินาที`)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(handle));
}
