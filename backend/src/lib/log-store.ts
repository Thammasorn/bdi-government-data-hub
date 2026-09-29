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
import type { MongoClient, MongoClientOptions } from "mongodb";

import { env } from "../env.js";

/**
 * สถานะที่ `/health/ready` รายงาน (สาธารณะ — จึงมีแค่คำเดียว ไม่มีรายละเอียดของ error)
 *
 *   up         — ต่อได้ login ผ่าน อ่านได้
 *   down       — ต่อไม่ได้ login ไม่ผ่าน หรือ driver โหลดไม่ขึ้น (รายละเอียดอยู่ใน log ของ process)
 *   disabled   — ปิดไว้ด้วย LOG_STORE_ENABLED=false หรือไม่มี MONGODB_URI
 *   over_quota — ต่อได้ แต่ขนาดเกิน LOG_STORE_MAX_MB แล้ว: worker ตั้งธง `overQuota` ไว้ใน relay_state
 */
export type LogStoreStatus = "up" | "down" | "disabled" | "over_quota";

/** ใครเป็นคนเปิด — ใช้ในบรรทัด log และเป็น appName ที่ Mongo เห็น */
export type LogStoreService = "backend" | "delivery-worker";

/** เอกสารใน relay_state ที่ worker ดูแล — ไฟล์นี้อ่านแค่ธงเพดานขนาด */
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

interface State {
  status: LogStoreStatus;
  /** ข้อความของความล้มเหลวล่าสุด (ลบรหัสผ่านออกแล้ว) — พิมพ์ตอนสถานะเปลี่ยนเท่านั้น */
  error: string | null;
}

let state: State = { status: env.logStore.enabled ? "down" : "disabled", error: null };
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
  return { status: state.status };
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

  timer = setInterval(() => void refresh(), REFRESH_MS);
  // ตัวตรวจซ้ำต้องไม่รั้ง process ไว้ตอนที่อย่างอื่นจบหมดแล้ว
  timer.unref();
  // ส่วนเส้นตายของการรอครั้งแรก**ต้องไม่ unref**: ตอนบูตยังไม่มีอะไรอื่นรั้ง event loop ไว้ ถ้า Mongo ล่มแล้วตัวจับ
  // เวลาของ driver ไม่ ref ด้วย process จะจบเงียบ ๆ ก่อนถึง listen — log store ล่มแล้วพา backend ล่มตาม
  return settleWithin(refresh(), FIRST_CHECK_WAIT_MS);
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
      const fresh = new MongoClient(env.logStore.uri, {
        ...CLIENT_TIMEOUTS,
        maxPoolSize,
        appName: `bdi-${service}`,
      });
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
 * เปลี่ยนสถานะ และพิมพ์หนึ่งบรรทัดเฉพาะตอนที่เปลี่ยน (ไม่พิมพ์ซ้ำทุก 30 วินาทีตอน Mongo ล่มนาน ๆ)
 * ผลตรวจครั้งแรกนับว่าเปลี่ยนเสมอ: ค่าเริ่มต้นคือ down ที่ไม่มีข้อความ ซึ่งการตรวจไม่มีวันให้ผลแบบนั้น
 */
function setState(status: LogStoreStatus, error: string | null) {
  if (status === state.status && error === state.error) return;
  state = { status, error };
  const where = `ฐานข้อมูล ${env.logStore.db}`;
  if (status === "up") console.log(`[log-store] ${service}: เชื่อมต่อ MongoDB ได้ (${where})`);
  else if (status === "over_quota") {
    console.warn(`[log-store] ${service}: เชื่อมต่อได้ แต่ขนาดเกิน LOG_STORE_MAX_MB แล้ว (${where})`);
  } else if (status === "down") console.warn(`[log-store] ${service}: ใช้ MongoDB ไม่ได้ — ${error ?? "ไม่ทราบสาเหตุ"}`);
}

/**
 * รหัสผ่านใน URI ยังเป็นค่าตัวอย่างของ dev (`dev-…` หรือ `…change-me`) — กติกาเดียวกับ mongo/entrypoint.sh
 * และ mongo/init/01-users.js ที่ไม่ยอมเริ่ม/ไม่ยอมสร้าง user บน production
 *
 * เตือนเฉพาะ production แบบเดียวกับคำเตือน ADMIN_API_TOKEN ใน index.ts: เตือน ไม่ใช่ปฏิเสธ เพราะ log store
 * เป็นของเสริมและ deploy ต้องไม่ทำให้ process วนรีสตาร์ต ไม่พิมพ์ค่าหรือความยาวของรหัสผ่าน
 * URI ที่ไม่มีรหัสผ่านเลย (managed Mongo ที่ใช้ identity แทน) ไม่เข้าข่าย
 */
function warnIfDevPassword() {
  if (env.nodeEnv !== "production") return;
  const password = uriPassword(env.logStore.uri);
  if (password === null) return;
  if (password.startsWith("dev-") || password.includes("change-me")) {
    console.warn(
      `[log-store] ${service}: คำเตือน: รหัสผ่านใน MONGODB_URI ยังเป็นค่าตัวอย่าง dev-…/…change-me ที่เปิดเผยอยู่ใน ` +
        "repo — ตั้ง MONGO_BACKEND_PASSWORD / MONGO_WORKER_PASSWORD ใน .env เป็นค่าจาก `openssl rand -hex 32` " +
        "(mongo ใน prod overlay ไม่ยอมเริ่มด้วยค่าเหล่านี้อยู่แล้ว)",
    );
  }
}

/** รหัสผ่านใน `mongodb://user:pass@…` (ถอด %xx แล้ว) หรือ null ถ้าไม่มี — ไม่ใช้ `new URL` เพราะ URI หลาย host แยกไม่ได้ */
function uriPassword(uri: string): string | null {
  const match = /^mongodb(?:\+srv)?:\/\/[^:@/]*:([^@/]*)@/.exec(uri);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

/** ข้อความของ error สำหรับ log — ตัดรหัสผ่านออกเผื่อ driver ยกบางส่วนของ URI มา และจำกัดความยาว */
function describe(err: unknown): string {
  let text = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  const password = uriPassword(env.logStore.uri);
  if (password) {
    for (const form of new Set([password, encodeURIComponent(password)])) text = text.split(form).join("***");
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
