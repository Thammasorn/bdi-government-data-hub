/**
 * งานดูแล log store ที่ worker เป็นเจ้าของ (plan §3 "Who owns what") — backend ไม่สร้าง index และไม่ตั้งธงเพดาน
 *
 *   - `ensureIndexes()` ของ collection ที่เก็บ error: error_events, error_issues, runtime_events (index ของ `activity`
 *     มากับงานสำเนา audit ใน step 6) — ทำครั้งแรกที่ต่อ Mongo ได้ ทีละ index: ตัวไหนล้มเตือนหนึ่งบรรทัด เก็บเป็น
 *     warning แล้วไปตัวถัดไป option ที่บริการบน Azure ไม่รับจึงไม่มีทางหยุด worker (ทุกตัวเป็น index ธรรมดา)
 *   - ตรวจเพดานขนาดตอนบูตและทุกชั่วโมง: `dbStats` (ข้อมูลกับ index ที่ใช้อยู่จริง ไม่นับพื้นที่ว่างที่ WiredTiger
 *     จองไว้ใช้ซ้ำ — `checkQuota`) → `relay_state.storageMb` เกิน
 *     LOG_STORE_MAX_MB แล้วตั้ง `overQuota` ซึ่ง backend กับ worker อ่านเป็นสถานะ `over_quota` ภายใน 30 วินาที
 *     และระหว่างนั้นเก็บแค่ตัวนับของ issue (lib/error-capture.ts) ธงลงเมื่อต่ำกว่า 90% ของเพดาน — ช่องว่างกันธง
 *     กะพริบทุกชั่วโมงตอนขนาดอยู่แถวเพดานพอดี
 *
 * วิ่งเป็นลูปของตัวเอง แยกจากลูปส่งอีเมล: ทุกครั้งมี timeout ไม่ซ้อนกัน และไม่ throw ออกไป Mongo ล่มหรือช้าแค่ไหน
 * อีเมลก็ส่งตามปกติ ความล้มเหลวซ้ำ ๆ เก็บเป็น issue ได้ไม่เกินครั้งละสิบนาทีต่อ tag
 */
import type { Db } from "mongodb";

import { env } from "../env.js";
import { captureError } from "../lib/error-capture.js";
import { logDb } from "../lib/log-store.js";

/** index แบบธรรมดาทั้งหมด (ไม่มี partial / sparse / $text) — ชุดที่ plan §3 ระบุสำหรับ collection ของ error */
const ERROR_INDEXES: Array<{ collection: string; keys: Record<string, 1 | -1> }> = [
  { collection: "error_events", keys: { fingerprint: 1, occurredAt: -1 } },
  { collection: "error_events", keys: { occurredAt: -1 } },
  { collection: "error_events", keys: { "request.correlationId": 1 } },
  { collection: "error_events", keys: { "browser.reference": 1 } },
  { collection: "error_issues", keys: { status: 1, lastSeen: -1 } },
  { collection: "error_issues", keys: { service: 1, lastSeen: -1 } },
  { collection: "runtime_events", keys: { at: -1 } },
];

/** รอบแรกหลังบูตรอให้ log store ต่อเสร็จก่อน — startLogStore ของ worker ไม่ถูก await */
const FIRST_TICK_MS = 5_000;
const TICK_MS = 60_000;
const QUOTA_EVERY_MS = 60 * 60_000;
/** ธงลงเมื่อต่ำกว่าสัดส่วนนี้ของเพดาน */
const CLEAR_BELOW = 0.9;
/** หนึ่งรอบทั้งรอบ — createIndex บน collection ใหญ่ใช้เวลาได้ แต่ต้องไม่ค้างจนรอบถัดไปซ้อน */
const TICK_TIMEOUT_MS = 45_000;
const CAPTURE_EVERY_MS = 10 * 60_000;

/** ส่วนของ relay_state ที่งานนี้เขียน — cursor ของ relay (step 6) อยู่ในเอกสารเดียวกัน `$set` จึงไม่แตะมัน */
interface RelayStateDoc {
  _id: string;
  overQuota?: boolean;
  /** MB ที่เทียบกับเพดาน — ที่ข้อมูลกับ index ใช้อยู่จริง หรือที่จองไว้ถ้าบริการไม่บอกพื้นที่ว่าง (`sizeBasis`) */
  storageMb?: number;
  sizeBasis?: SizeBasis;
  /** MB ที่ WiredTiger จองไว้ทั้งหมด รวมพื้นที่ว่างที่รอใช้ซ้ำ — ขนาดบนดิสก์จริง ลดลงเมื่อ `compact` เท่านั้น */
  allocatedMb?: number;
  maxMb?: number;
  quotaCheckedAt?: Date;
}

let timer: NodeJS.Timeout | null = null;
let firstTimer: NodeJS.Timeout | null = null;
let running = false;
/** index ที่ไม่ต้องลองอีก — สร้างแล้ว หรือถูกปฏิเสธด้วยเหตุที่ลองใหม่ก็ไม่ผ่าน */
const settledIndexes = new Set<number>();
let lastQuotaCheckAt = 0;
const lastCaptured = new Map<string, number>();

export function startLogUpkeep(): void {
  if (!env.logStore.enabled || timer) return;
  firstTimer = setTimeout(() => void tick(), FIRST_TICK_MS);
  firstTimer.unref();
  timer = setInterval(() => void tick(), TICK_MS);
  timer.unref();
}

export function stopLogUpkeep(): void {
  if (firstTimer) clearTimeout(firstTimer);
  if (timer) clearInterval(timer);
  firstTimer = null;
  timer = null;
}

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const db = await logDb();
    // ต่อไม่ได้ — log-store.ts พิมพ์สถานะไปแล้ว รอบหน้าลองใหม่ ไม่ใช่ความล้มเหลวของงานนี้
    if (!db) return;
    await withTimeout(
      (async () => {
        if (settledIndexes.size < ERROR_INDEXES.length) await ensureIndexes(db);
        if (Date.now() - lastQuotaCheckAt >= QUOTA_EVERY_MS) {
          await checkQuota(db);
          lastQuotaCheckAt = Date.now();
        }
      })(),
      TICK_TIMEOUT_MS,
    );
  } catch (err) {
    captureThrottled("log-upkeep.tick", err);
  } finally {
    running = false;
  }
}

/** ทีละ index — ตัวที่ล้มเพราะต่อไม่ได้ลองใหม่รอบหน้า ตัวที่ Mongo ปฏิเสธเตือนครั้งเดียวแล้วเลิก */
async function ensureIndexes(db: Db): Promise<void> {
  for (const [index, spec] of ERROR_INDEXES.entries()) {
    if (settledIndexes.has(index)) continue;
    try {
      await db.collection(spec.collection).createIndex(spec.keys, { maxTimeMS: 30_000 });
      settledIndexes.add(index);
    } catch (err) {
      if (isTransient(err)) throw err;
      settledIndexes.add(index);
      const name = err instanceof Error ? err.name : "Error";
      console.warn(
        `[log-store] delivery-worker: สร้าง index ${JSON.stringify(spec.keys)} ของ ${spec.collection} ไม่ได้ (${name}) — ` +
          "ข้ามไป ค้นได้แต่ช้าลง",
      );
      captureError(err, { level: "warning", tag: "log-upkeep.index", extra: { collection: spec.collection } });
    }
  }
}

/** error ที่ลองใหม่แล้วอาจผ่าน (เน็ต, เลือก server ไม่ได้, หมดเวลา) — ไม่ใช่การปฏิเสธตัว index */
function isTransient(err: unknown): boolean {
  const name = err instanceof Error ? err.name : "";
  return /Network|ServerSelection|Timeout|PoolCleared|NotPrimary/i.test(name);
}

/**
 * ตัวเลขที่เทียบกับเพดาน — `in_use` คือข้อมูลกับ index ที่ใช้อยู่จริง `allocated` คือที่จองไว้ทั้งหมดรวมพื้นที่ว่างที่รอ
 * ใช้ซ้ำ (ใช้เมื่อบริการไม่ให้ตัวเลขพื้นที่ว่าง) บันทึกไว้ใน `relay_state.sizeBasis` ให้คนอ่าน storageMb รู้ว่าเป็นตัวไหน
 */
export type SizeBasis = "in_use" | "allocated";

export interface StorageFigures {
  storageMb: number;
  allocatedMb: number;
  basis: SizeBasis;
}

/** บริการนี้ปฏิเสธ `freeStorage` ไปแล้วครั้งหนึ่ง — ไม่ขออีกจนกว่า process จะเริ่มใหม่ */
let freeStorageRejected = false;

/**
 * ขนาดของ log store จาก `dbStats` — ขอตัวเลขพื้นที่ว่างด้วย `freeStorage: 1` ก่อน ถ้าบริการไม่รับ field นี้ขอใหม่โดยไม่มีมัน
 *
 * mongo ปฏิเสธ field ที่ไม่รู้จักทั้งคำสั่ง ไม่ใช่ข้ามไปเฉย ๆ (ลองกับ mongo:7.0 แล้ว 2026-09-30:
 * `{dbStats: 1, bogusOption: 1}` → 40415 IDLUnknownField) บริการ managed ที่ไม่รู้จัก `freeStorage` จึงน่าจะทำแบบเดียวกัน
 * เดิมคำสั่งที่ถูกปฏิเสธ throw ทุกชั่วโมง ถูกเก็บเป็น warning แล้วเพดานไม่เคยถูกเทียบเลย ตอนนี้ถอยไปเทียบขนาดที่จองไว้
 * (storageSize + indexSize) ซึ่งมากกว่าหรือเท่ากับที่ใช้จริงเสมอ — ธงอาจตั้งเร็วกว่าที่ควร แต่ไม่มีวันไม่ตั้ง
 * error ชั่วคราว (ต่อไม่ติด หมดเวลา) ไม่ถือว่าเป็นการปฏิเสธ throw ต่อให้รอบหน้าลองใหม่ ไม่งั้นเน็ตสะดุดครั้งเดียวทำให้
 * เทียบด้วยตัวเลขที่หยาบกว่าไปจนกว่า worker จะเริ่มใหม่
 *
 * บริการที่รับ `freeStorage` แต่ไม่ส่งตัวเลขกลับมาก็ได้ `allocated` เช่นกัน
 */
export async function readStorageSize(db: Pick<Db, "command">): Promise<StorageFigures> {
  // คำสั่งนี้อ่านแค่ metadata ของ WiredTiger — เพดานเวลาคือ socketTimeoutMS ของ driver (5 วินาที) กับ TICK_TIMEOUT_MS
  let stats: Record<string, unknown> | null = null;
  if (!freeStorageRejected) {
    try {
      stats = await db.command({ dbStats: 1, freeStorage: 1 });
    } catch (err) {
      if (isTransient(err)) throw err;
      freeStorageRejected = true;
      const name = err instanceof Error ? err.name : "Error";
      const code = (err as { codeName?: unknown; code?: unknown }).codeName ?? (err as { code?: unknown }).code;
      console.warn(
        `[log-store] delivery-worker: dbStats ไม่รับ freeStorage (${name}${code === undefined ? "" : ` ${String(code)}`}) — ` +
          "เทียบเพดานด้วยขนาดที่จองไว้ (storageSize + indexSize) แทนขนาดที่ใช้จริง",
      );
      captureError(err, { level: "warning", tag: "log-upkeep.free-storage", fingerprint: "log-store:free-storage-rejected" });
    }
  }
  stats ??= await db.command({ dbStats: 1 });

  const allocated = Number(stats.storageSize ?? 0) + Number(stats.indexSize ?? 0);
  const freeFields = [stats.freeStorageSize, stats.indexFreeStorageSize].filter((v) => typeof v === "number");
  const basis: SizeBasis = freeFields.length > 0 ? "in_use" : "allocated";
  const free = freeFields.reduce((sum: number, v) => sum + Number(v), 0);
  const inUse = Math.max(0, allocated - (Number.isFinite(free) ? free : 0));
  return {
    storageMb: Math.round((inUse / 1024 / 1024) * 10) / 10,
    allocatedMb: Math.round((allocated / 1024 / 1024) * 10) / 10,
    basis,
  };
}

/**
 * ขนาดที่ใช้อยู่จริงเทียบเพดาน แล้วเขียนธงลง relay_state — นับทั้งข้อมูลและ index เพราะเพดานมีไว้กันดิสก์เต็ม และ index
 * ก็กินดิสก์เหมือนกัน (ของ `activity` มีสิบเอ็ดตัว)
 *
 * **ที่ใช้อยู่ ไม่ใช่ที่จองไว้**: WiredTiger ไม่คืนพื้นที่ของเอกสารที่ลบแล้วให้ระบบ แต่เก็บไว้ใช้ซ้ำ `storageSize` /
 * `indexSize` จึงไม่ลดลงหลังลบ พื้นที่ว่างนั้นรายงานแยกเป็น `freeStorageSize` / `indexFreeStorageSize` (ต้องขอด้วย
 * `freeStorage: 1`) เดิมเทียบ storageSize + indexSize ตรง ๆ — ธงที่ตั้งแล้วไม่มีวันลง แม้ prune รายวัน หรือคน
 * `deleteMany` จนเหลือครึ่ง: ลองกับ mongo:7.0 แล้ว 2026-09-30 ลบหมดทั้ง collection storageSize ไม่ขยับ ขยับแค่ตัว
 * free ถ้าต้องการคืนดิสก์ให้เครื่องจริง ๆ ต้อง `compact` เอง บริการที่ไม่ให้ตัวเลขพื้นที่ว่างเทียบขนาดที่จองไว้แทน
 * (`readStorageSize`, `relay_state.sizeBasis`)
 */
async function checkQuota(db: Db): Promise<void> {
  const { storageMb, allocatedMb, basis } = await readStorageSize(db);
  const maxMb = env.logStore.maxMb;

  const relay = db.collection<RelayStateDoc>("relay_state");
  const previous = await relay.findOne({ _id: "audit_event" }, { projection: { overQuota: 1 }, maxTimeMS: 5_000 });
  const wasOver = previous?.overQuota === true;
  const overQuota = storageMb > maxMb ? true : storageMb < maxMb * CLEAR_BELOW ? false : wasOver;

  await relay.updateOne(
    { _id: "audit_event" },
    { $set: { storageMb, allocatedMb, sizeBasis: basis, overQuota, maxMb, quotaCheckedAt: new Date() } },
    { upsert: true },
  );

  if (overQuota && !wasOver) {
    const message =
      `log store ใช้พื้นที่ ${storageMb} MB (จองไว้ ${allocatedMb} MB) เกินเพดาน LOG_STORE_MAX_MB ${maxMb} MB — ` +
      "ต่อจากนี้เก็บแค่ตัวนับของ issue ไม่เก็บ error event ทีละตัว จนกว่าจะต่ำกว่า " +
      `${Math.round(maxMb * CLEAR_BELOW * 10) / 10} MB (สำเนา audit ยังเก็บต่อ)`;
    console.warn(`[log-store] delivery-worker: ${message}`);
    captureError(new Error(message), {
      level: "warning",
      tag: "log-store.over-quota",
      fingerprint: "log-store:over-quota",
      extra: { storageMb, allocatedMb, maxMb },
      print: false,
    });
  } else if (!overQuota && wasOver) {
    console.log(
      `[log-store] delivery-worker: log store ใช้พื้นที่ ${storageMb} MB (จองไว้ ${allocatedMb} MB) ต่ำกว่าเพดานแล้ว — ` +
        "กลับมาเก็บ error event ตามปกติ",
    );
  }
}

/** เก็บความล้มเหลวของงานนี้ไม่เกินครั้งละสิบนาทีต่อ tag — Mongo ที่ล่มนานต้องไม่ได้ issue ใหม่ทุกนาที */
function captureThrottled(tag: string, err: unknown) {
  const now = Date.now();
  if (now - (lastCaptured.get(tag) ?? 0) < CAPTURE_EVERY_MS) return;
  lastCaptured.set(tag, now);
  captureError(err, { level: "warning", tag });
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let handle: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    handle = setTimeout(() => reject(new Error(`งานดูแล log store เกิน ${ms / 1000} วินาที`)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(handle));
}
