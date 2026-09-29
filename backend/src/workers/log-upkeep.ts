/**
 * งานดูแล log store ที่ worker เป็นเจ้าของ (plan §3 "Who owns what") — backend ไม่สร้าง index และไม่ตั้งธงเพดาน
 *
 *   - `ensureIndexes()` ของ collection ที่เก็บ error: error_events, error_issues, runtime_events (index ของ `activity`
 *     มากับงานสำเนา audit ใน step 6) — ทำครั้งแรกที่ต่อ Mongo ได้ ทีละ index: ตัวไหนล้มเตือนหนึ่งบรรทัด เก็บเป็น
 *     warning แล้วไปตัวถัดไป option ที่บริการบน Azure ไม่รับจึงไม่มีทางหยุด worker (ทุกตัวเป็น index ธรรมดา)
 *   - ตรวจเพดานขนาดตอนบูตและทุกชั่วโมง: `dbStats` (storageSize + indexSize) → `relay_state.storageMb` เกิน
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
  storageMb?: number;
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
 * ขนาดจริงเทียบเพดาน แล้วเขียนธงลง relay_state — ใช้ storageSize + indexSize เพราะเพดานมีไว้กันดิสก์เต็ม และ index
 * ก็กินดิสก์เหมือนกัน (ของ `activity` ใน step 6 มีสิบเอ็ดตัว)
 */
async function checkQuota(db: Db): Promise<void> {
  // คำสั่งนี้อ่านแค่ metadata ของ WiredTiger — เพดานเวลาคือ socketTimeoutMS ของ driver (5 วินาที) กับ TICK_TIMEOUT_MS
  const stats = await db.command({ dbStats: 1 });
  const bytes = Number(stats.storageSize ?? 0) + Number(stats.indexSize ?? 0);
  const storageMb = Math.round((bytes / 1024 / 1024) * 10) / 10;
  const maxMb = env.logStore.maxMb;

  const relay = db.collection<RelayStateDoc>("relay_state");
  const previous = await relay.findOne({ _id: "audit_event" }, { projection: { overQuota: 1 }, maxTimeMS: 5_000 });
  const wasOver = previous?.overQuota === true;
  const overQuota = storageMb > maxMb ? true : storageMb < maxMb * CLEAR_BELOW ? false : wasOver;

  await relay.updateOne(
    { _id: "audit_event" },
    { $set: { storageMb, overQuota, maxMb, quotaCheckedAt: new Date() } },
    { upsert: true },
  );

  if (overQuota && !wasOver) {
    const message =
      `log store ใช้ดิสก์ ${storageMb} MB เกินเพดาน LOG_STORE_MAX_MB ${maxMb} MB — ต่อจากนี้เก็บแค่ตัวนับของ issue ` +
      `ไม่เก็บ error event ทีละตัว จนกว่าจะต่ำกว่า ${Math.round(maxMb * CLEAR_BELOW * 10) / 10} MB (สำเนา audit ยังเก็บต่อ)`;
    console.warn(`[log-store] delivery-worker: ${message}`);
    captureError(new Error(message), {
      level: "warning",
      tag: "log-store.over-quota",
      fingerprint: "log-store:over-quota",
      extra: { storageMb, maxMb },
      print: false,
    });
  } else if (!overQuota && wasOver) {
    console.log(`[log-store] delivery-worker: log store ใช้ดิสก์ ${storageMb} MB ต่ำกว่าเพดานแล้ว — กลับมาเก็บ error event ตามปกติ`);
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
