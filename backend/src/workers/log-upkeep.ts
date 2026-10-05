/**
 * งานดูแล log store ที่ worker เป็นเจ้าของ (plan §3 "Who owns what") — backend ไม่สร้าง index และไม่ตั้งธงเพดาน
 *
 *   - `ensureIndexes()` ของทุก collection: `activity` (สำเนา audit — workers/log-relay.ts), error_events, error_issues,
 *     runtime_events — ทำครั้งแรกที่ต่อ Mongo ได้ ทีละ index: ตัวไหนล้มเตือนหนึ่งบรรทัด เก็บเป็น warning แล้วไปตัวถัดไป
 *     option ที่บริการบน Azure ไม่รับจึงไม่มีทางหยุด worker (ทุกตัวเป็น index ธรรมดา) แล้วทำซ้ำทุกชั่วโมง และทันทีที่
 *     relay_state ไม่ใช่อย่างที่ process นี้เขียนไว้ (`storeWasReset`) — `createIndex` ของ index ที่มีแล้วไม่ทำอะไร
 *   - log store ที่ถูกล้าง (volume ใหม่ขณะ worker ยังวิ่ง, มีคนลบ relay_state ทั้งใบ) ได้ index และตัวเลขเพดานกลับมาใน
 *     รอบนาทีถัดไป ไม่ต้องรอ worker เริ่มใหม่หรือรอบชั่วโมงหน้า
 *   - ตรวจเพดานขนาดตอนบูตและทุกชั่วโมง: `dbStats` → `relay_state.storageMb` คือข้อมูลกับ index ที่ใช้อยู่จริง ไม่นับ
 *     พื้นที่ว่างที่ WiredTiger จองไว้ใช้ซ้ำ หรือขนาดที่จองไว้ทั้งหมดเมื่อบริการไม่บอกพื้นที่ว่าง (`sizeBasis: "allocated"`
 *     — `readStorageSize`) เกิน LOG_STORE_MAX_MB แล้วตั้ง `overQuota` ซึ่ง backend กับ worker อ่านเป็นสถานะ
 *     `over_quota` ภายใน 30 วินาที และระหว่างนั้นเก็บแค่ตัวนับของ issue (lib/error-capture.ts) ธงลงเมื่อต่ำกว่า 90%
 *     ของเพดาน — ช่องว่างกันธงกะพริบทุกชั่วโมงตอนขนาดอยู่แถวเพดานพอดี เพดานคุมไบต์ที่**ใช้อยู่** ไม่ใช่ขนาดบนดิสก์
 *     (`relay_state.allocatedMb`) ซึ่งเกินเพดานได้ — ดู `checkQuota` · ธงไม่หยุด relay: `activity` โตต่อเกินเพดาน
 *     (workers/log-relay.ts หัวไฟล์ — "เพดานขนาดไม่คุม `activity`")
 *
 * วิ่งเป็นลูปของตัวเอง แยกจากลูปส่งอีเมล: ทุกครั้งมี timeout ไม่ซ้อนกัน และไม่ throw ออกไป Mongo ล่มหรือช้าแค่ไหน
 * อีเมลก็ส่งตามปกติ ความล้มเหลวซ้ำ ๆ เก็บเป็น issue ได้ไม่เกินครั้งละสิบนาทีต่อ tag
 */
import type { Db } from "mongodb";

import { env } from "../env.js";
import { captureError } from "../lib/error-capture.js";
import { MONGO_COMMAND_MAX_MS, logDb } from "../lib/log-store.js";

/**
 * index แบบธรรมดาทั้งหมด (ไม่มี partial / sparse / $text) — ชุดที่ plan §3 ระบุ
 *
 * `activity`: หนึ่งตัวต่อตัวกรองของ API อ่าน log (step 7) ทุกตัวลงท้ายด้วย `occurredAt` เพราะผลเรียงตามเวลาเสมอ
 * `{category, result, occurredAt}` ใช้กับ prune ตามอายุด้วย · `tokenFps` เป็น array (multikey) — แถวสรุปของ token ที่ถูก
 * ปฏิเสธมีหลายตัว · รหัสอ้างอิง 8 ตัวค้นด้วย regex ยึดหัวบน `request.correlationId`
 */
const INDEXES: Array<{ collection: string; keys: Record<string, 1 | -1> }> = [
  { collection: "activity", keys: { occurredAt: -1, _id: -1 } },
  { collection: "activity", keys: { "subject.type": 1, "subject.id": 1, occurredAt: -1 } },
  { collection: "activity", keys: { relatedUserIds: 1, occurredAt: -1 } },
  { collection: "activity", keys: { "actor.id": 1, occurredAt: -1 } },
  { collection: "activity", keys: { organizationId: 1, occurredAt: -1 } },
  { collection: "activity", keys: { action: 1, occurredAt: -1 } },
  { collection: "activity", keys: { category: 1, result: 1, occurredAt: -1 } },
  { collection: "activity", keys: { requestNumber: 1, occurredAt: -1 } },
  { collection: "activity", keys: { "request.correlationId": 1 } },
  { collection: "activity", keys: { hashKeys: 1, occurredAt: -1 } },
  { collection: "activity", keys: { tokenFps: 1, occurredAt: -1 } },
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
/** ทำ `ensureIndexes()` ซ้ำทั้งชุดทุกเท่านี้ — ตาข่ายของกรณีที่ `storeWasReset` มองไม่เห็น (collection ถูก drop ด้วย root) */
const INDEX_RECHECK_MS = 60 * 60_000;
/** ธงลงเมื่อต่ำกว่าสัดส่วนนี้ของเพดาน */
const CLEAR_BELOW = 0.9;
/**
 * หนึ่งรอบทั้งรอบ (index สิบแปดตัวกับ dbStats — แต่ละคำสั่งถูก driver ตัดที่ 5 วินาทีอยู่แล้ว) ต้องไม่ค้างจนรอบถัดไปซ้อน
 */
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
/**
 * index ที่สร้างสำเร็จในรอบนี้ — ล้างทิ้งทุกชั่วโมงและเมื่อ log store ถูกล้าง แล้ว `ensureIndexes()` สร้างซ้ำ
 *
 * เดิมเป็นชุดเดียวที่ไม่เคยล้างจนกว่า worker จะเริ่มใหม่: volume ของ mongo ที่ถูกสร้างใหม่ขณะ worker ยังวิ่ง (ขั้นตอน
 * "เริ่มจาก volume ใหม่" ของแผนเอง) ได้ `activity` ที่มีเอกสารและ relay_state แต่มีแค่ index `_id` — index ทั้งสิบเอ็ดตัว
 * กลับมาหลัง `restart delivery-worker` เท่านั้น (ตรวจขั้น 6, 2026-09-30)
 */
const createdIndexes = new Set<number>();
/** index ที่ Mongo ปฏิเสธด้วยเหตุที่ลองใหม่ก็ไม่ผ่าน — เตือนไปแล้วครั้งหนึ่ง ไม่ลองอีกจนกว่า process จะเริ่มใหม่ */
const refusedIndexes = new Set<number>();
let lastIndexCheckAt = 0;
let lastQuotaCheckAt = 0;
/** `quotaCheckedAt` ที่ process นี้เขียนลง relay_state ครั้งล่าสุด — ไม่ตรงกับที่อ่านได้ = log store ถูกล้างหรือมีคนเขียนแทน */
let lastWrittenQuotaAt: Date | null = null;
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
        const reset = await storeWasReset(db);
        if (reset || Date.now() - lastIndexCheckAt >= INDEX_RECHECK_MS) {
          createdIndexes.clear();
          lastIndexCheckAt = Date.now();
        }
        if (createdIndexes.size + refusedIndexes.size < INDEXES.length) await ensureIndexes(db);
        if (reset || Date.now() - lastQuotaCheckAt >= QUOTA_EVERY_MS) {
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

/**
 * ทีละ index — ตัวที่ล้มชั่วคราว (ต่อไม่ได้ หมดเวลา mongod กำลังปิดหรือสลับ primary — `isTransient`) ลองใหม่รอบหน้า
 * ตัวที่ Mongo ปฏิเสธเตือนครั้งเดียวแล้วเลิก
 */
async function ensureIndexes(db: Db): Promise<void> {
  for (const [index, spec] of INDEXES.entries()) {
    if (createdIndexes.has(index) || refusedIndexes.has(index)) continue;
    try {
      // ไม่มี maxTimeMS: เพดานจริงคือ socketTimeoutMS 5 วินาทีของ driver (lib/log-store.ts) — เดิมใส่ 30 วินาทีซึ่ง driver ไม่เคยให้
      // index ที่สร้างนานกว่านั้น (collection ใหญ่) driver เลิกรอแล้วปิดแค่การเชื่อมต่อนั้น ได้ `MongoNetworkTimeoutError` ซึ่งเป็น
      // error ชั่วคราว (`isTransient`) ส่วน server สร้างต่อจนเสร็จ รอบหน้า createIndex ของ index ที่เสร็จแล้วไม่ทำอะไร
      // (Mongo ที่หยุดตอบทั้งตัวเป็นอีกเรื่อง: monitor ของ driver ล้าง pool แล้วตัดคำสั่งนี้ด้วย `PoolClearedOnNetworkError` — ชั่วคราวเหมือนกัน)
      await db.collection(spec.collection).createIndex(spec.keys);
      createdIndexes.add(index);
    } catch (err) {
      if (isTransient(err)) throw err;
      refusedIndexes.add(index);
      const name = err instanceof Error ? err.name : "Error";
      console.warn(
        `[log-store] delivery-worker: สร้าง index ${JSON.stringify(spec.keys)} ของ ${spec.collection} ไม่ได้ (${name}) — ` +
          "ข้ามไป ค้นได้แต่ช้าลง",
      );
      captureError(err, { level: "warning", tag: "log-upkeep.index", extra: { collection: spec.collection } });
    }
  }
}

/**
 * relay_state ไม่ใช่อย่างที่ process นี้เขียนไว้ครั้งล่าสุด — `quotaCheckedAt` หายไปหรือเป็นค่าอื่น
 *
 * เกิดได้สามทาง ทุกทางต้องการสิ่งเดียวกัน (ตรวจเพดานและสร้าง index ใหม่ทันที):
 *   1. volume ของ mongo ถูกสร้างใหม่ขณะ worker ยังวิ่ง — ไม่มี index และไม่มีตัวเลขเพดาน
 *   2. มีคนลบเอกสาร relay_state ทั้งใบ (แทนการ `$unset` สามฟิลด์ของ rebuild — workers/log-relay.ts) — ธงเกินเพดานหายไป
 *      store ที่เกินเพดานจริงถูกนับว่าไม่เกินจนถึงรอบชั่วโมงหน้า (ตรวจขั้น 6, 2026-09-30: หายไปราว 55 นาที)
 *   3. คนอื่นเขียนแทน — worker อีกตัวที่ซ้อนอยู่ระหว่าง deploy (ตรวจซ้ำนาทีละครั้งช่วงสั้น ๆ ไม่เสียหาย) หรือคนที่ถือสิทธิ์
 *      ของ worker/root `overQuota: true` ปลอมทำให้ error ทั้งระบบเหลือแค่ตัวนับ (`bdi_backend` เคย insert relay_state ได้
 *      ตอนที่มันยังไม่มี — ตอนนี้ role ของมัน insert ได้แค่สี่ collection ที่เขียนจริง mongo/init/01-users.js)
 * ยังไม่เคยเขียน (รอบแรกหลังบูต) ตอบ false — รอบนั้นตรวจทั้งสองอย่างอยู่แล้ว
 */
async function storeWasReset(db: Db): Promise<boolean> {
  if (lastWrittenQuotaAt === null) return false;
  const state = await db
    .collection<RelayStateDoc>("relay_state")
    .findOne({ _id: "audit_event" }, { projection: { quotaCheckedAt: 1 }, maxTimeMS: MONGO_COMMAND_MAX_MS });
  const seen = state?.quotaCheckedAt;
  if (seen instanceof Date && seen.getTime() === lastWrittenQuotaAt.getTime()) return false;
  console.log(
    "[log-store] delivery-worker: relay_state ไม่ใช่อย่างที่เขียนไว้ (log store ถูกล้าง หรือมีคนเขียนแทน) — " +
      "ตรวจเพดานขนาดและสร้าง index ใหม่รอบนี้",
  );
  return true;
}

/**
 * รหัส error ฝั่ง server ที่เป็นสถานะชั่วคราวของ mongod ไม่ใช่คำตอบต่อคำสั่ง: กำลังปิด (91 ShutdownInProgress,
 * 11600 InterruptedAtShutdown) สลับ primary (189 10107 11602 13435 13436) เครือข่ายระหว่าง node (6 7 89 9001)
 * หมดเวลาฝั่ง shard (262) และ majority ยังไม่พร้อม (134) — ชุดเดียวกับ RETRYABLE_READ_ERROR_CODES ของ driver
 * (spec retryable-reads) ซึ่ง driver ไม่ export ออกมาให้ใช้
 */
const TRANSIENT_SERVER_CODES = new Set([6, 7, 89, 91, 134, 189, 262, 9001, 10107, 11600, 11602, 13435, 13436]);

/**
 * error ที่ลองใหม่แล้วอาจผ่าน — ฝั่ง driver (เน็ต, เลือก server ไม่ได้, หมดเวลา) ดูจากชื่อ ฝั่ง server ดูจากรหัส
 *
 * เดิมดูแค่ชื่อ แต่ error ที่ mongod ส่งกลับมาชื่อ `MongoServerError` เสมอ ไม่ว่าจะเป็นการปฏิเสธคำสั่งหรือ mongod
 * กำลัง restart อยู่ — `createIndex` ที่โดน InterruptedAtShutdown จึงถูกนับว่า index ถูกปฏิเสธและไม่ถูกสร้างอีกจนกว่า
 * worker จะเริ่มใหม่ และ `dbStats` ที่โดนแบบเดียวกันเคยทำให้เลิกขอ `freeStorage` ไปตลอด (`readStorageSize`)
 */
function isTransient(err: unknown): boolean {
  const name = err instanceof Error ? err.name : "";
  if (/Network|ServerSelection|Timeout|PoolCleared|NotPrimary/i.test(name)) return true;
  const code = (err as { code?: unknown } | null | undefined)?.code;
  return typeof code === "number" && TRANSIENT_SERVER_CODES.has(code);
}

/**
 * รหัสที่แปลว่าบริการไม่รับ **option** ที่ส่งไป ไม่ว่าจะถามกี่รอบ: field ที่ไม่รู้จัก (40415 IDLUnknownField — ที่ mongo:7.0
 * ตอบจริงกับ `{dbStats: 1, bogusOption: 1}`) ค่าผิดรูป (2 BadValue, 9 FailedToParse, 14 TypeMismatch — ตัวหลังคือที่
 * mongo:7.0 ตอบกับ `freeStorage: "yes"`) และ option ที่ไม่รองรับ (72 InvalidOptions) ดูทั้งรหัสและชื่อ เพราะบริการ
 * ที่เลียนแบบ mongo บางตัวส่งมาแค่อย่างใดอย่างหนึ่ง
 */
const OPTION_REFUSED_CODES = new Set([2, 9, 14, 72, 40415]);
const OPTION_REFUSED_NAMES = new Set(["BadValue", "FailedToParse", "TypeMismatch", "InvalidOptions", "IDLUnknownField"]);

function refusesOption(err: unknown): boolean {
  const { code, codeName } = (err ?? {}) as { code?: unknown; codeName?: unknown };
  return (
    (typeof code === "number" && OPTION_REFUSED_CODES.has(code)) ||
    (typeof codeName === "string" && OPTION_REFUSED_NAMES.has(codeName))
  );
}

/** ชื่อกับรหัสของ error ไว้พิมพ์ — ไม่มีข้อความของ error (กฎใน CLAUDE.md: ข้อความดิบไปทาง captureError เท่านั้น) */
function errorLabel(err: unknown): string {
  const name = err instanceof Error ? err.name : "Error";
  const { code, codeName } = (err ?? {}) as { code?: unknown; codeName?: unknown };
  const detail = codeName ?? code;
  return detail === undefined ? name : `${name} ${String(detail)}`;
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

/** บริการนี้ปฏิเสธ option `freeStorage` เอง (`refusesOption`) — ไม่ขออีกจนกว่า process จะเริ่มใหม่ */
let freeStorageRefused = false;
/** error ที่ไม่รู้จักซึ่งเตือนไปแล้ว (ตาม `errorLabel`) — เตือนครั้งเดียวต่อชนิด ไม่ใช่ทุกชั่วโมง */
const unrecognisedWarned = new Set<string>();

/**
 * ขนาดของ log store จาก `dbStats` — ขอตัวเลขพื้นที่ว่างด้วย `freeStorage: 1` ก่อน ถ้าไม่ผ่านขอใหม่โดยไม่มีมัน
 *
 * mongo ปฏิเสธ field ที่ไม่รู้จักทั้งคำสั่ง ไม่ใช่ข้ามไปเฉย ๆ (ลองกับ mongo:7.0 แล้ว 2026-09-30:
 * `{dbStats: 1, bogusOption: 1}` → 40415 IDLUnknownField) บริการ managed ที่ไม่รู้จัก `freeStorage` จึงน่าจะทำแบบเดียวกัน
 * เดิมคำสั่งที่ถูกปฏิเสธ throw ทุกชั่วโมง ถูกเก็บเป็น warning แล้วเพดานไม่เคยถูกเทียบเลย ตอนนี้ถอยไปเทียบขนาดที่จองไว้
 * (storageSize + indexSize) ซึ่งมากกว่าหรือเท่ากับที่ใช้จริงเสมอ — ธงอาจตั้งเร็วกว่าที่ควร แต่ไม่มีวันไม่ตั้ง
 *
 * ความล้มเหลวของคำสั่งแรกแยกเป็นสามทาง เพราะการจำผิดมีราคา: ธงที่ตั้งด้วยขนาดที่จองไว้**ไม่ลงเมื่อลบ** (ลงเมื่อ `compact`
 * เท่านั้น — `checkQuota`) และระหว่างนั้น error event ถูกเก็บแค่ตัวนับ
 *   1. ชั่วคราว (`isTransient` — เน็ต หมดเวลา mongod กำลังปิดหรือสลับ primary) → throw ไม่ถอย ไม่จำ รอบถัดไป (60 วินาที
 *      เพราะ `lastQuotaCheckAt` ยังไม่ถูกจด) ขอ `freeStorage` ใหม่
 *   2. คำสั่งเปล่าก็ล้มด้วย (ไม่มีสิทธิ์ `dbStats` ฯลฯ) → ปัญหาไม่ได้อยู่ที่ option: throw error ของคำสั่งเปล่า ไม่จำ ไม่เตือนว่า
 *      ไม่รับ `freeStorage`
 *   3. คำสั่งเปล่าผ่าน → รอบนี้เทียบขนาดที่จองไว้ แล้ว
 *      - รหัสเป็นการปฏิเสธ option จริง (`refusesOption`) → จำไว้จนกว่า process จะเริ่มใหม่ เตือนหนึ่งบรรทัดและเก็บเป็น
 *        `log-store:free-storage-rejected` ครั้งเดียว
 *      - รหัสอื่น → **ไม่จำ** รอบตรวจชั่วโมงหน้าขอ `freeStorage` ใหม่ (ถ้ายังล้มก็ถอยอีก เสียคำสั่งเปล่าหนึ่งคำสั่งต่อชั่วโมง)
 *        เตือนและเก็บเป็น `log-store:free-storage-failed` ครั้งเดียวต่อชนิดของ error บริการที่ปฏิเสธด้วยรหัสของตัวเอง
 *        ก็ยังถูกเทียบเพดานทุกชั่วโมง ส่วน error ที่ไม่รู้จักแต่หายเองได้ทำให้เทียบหยาบไปแค่รอบเดียว
 *   เดิมทุกอย่างที่ไม่ใช่ข้อ 1 (ซึ่งตอนนั้นดูแค่ชื่อ error) ถูกจำว่าเป็นการปฏิเสธ — mongod ที่ restart ระหว่าง `dbStats`
 *   ครั้งเดียว (11600 InterruptedAtShutdown) หรือสิทธิ์ที่ขาดชั่วคราว (13 Unauthorized) ทำให้เทียบด้วยขนาดที่จองไว้
 *   จนกว่า worker จะเริ่มใหม่ และธงที่ตั้งระหว่างนั้นลงไม่ได้เลย
 *
 * บริการที่รับ `freeStorage` แต่ไม่ส่งตัวเลขกลับมาก็ได้ `allocated` เช่นกัน
 */
export async function readStorageSize(db: Pick<Db, "command">): Promise<StorageFigures> {
  // คำสั่งนี้อ่านแค่ metadata ของ WiredTiger — เพดานเวลาคือ socketTimeoutMS ของ driver (5 วินาที) กับ TICK_TIMEOUT_MS
  let stats: Record<string, unknown> | null = null;
  if (!freeStorageRefused) {
    try {
      stats = await db.command({ dbStats: 1, freeStorage: 1 });
    } catch (err) {
      if (isTransient(err)) throw err;
      // ล้มตรงนี้ = ข้อ 2 — error ของคำสั่งเปล่าออกไปถึง tick() ซึ่งเก็บเป็น log-upkeep.tick
      stats = await db.command({ dbStats: 1 });
      const label = errorLabel(err);
      if (refusesOption(err)) {
        freeStorageRefused = true;
        console.warn(
          `[log-store] delivery-worker: dbStats ไม่รับ freeStorage (${label}) — ` +
            "ต่อจากนี้เทียบเพดานด้วยขนาดที่จองไว้ (storageSize + indexSize) แทนขนาดที่ใช้จริง จนกว่า worker จะเริ่มใหม่",
        );
        captureError(err, { level: "warning", tag: "log-upkeep.free-storage", fingerprint: "log-store:free-storage-rejected" });
      } else if (!unrecognisedWarned.has(label)) {
        unrecognisedWarned.add(label);
        console.warn(
          `[log-store] delivery-worker: dbStats แบบขอ freeStorage ล้ม (${label}) แต่แบบไม่ขอผ่าน — ` +
            "รอบนี้เทียบเพดานด้วยขนาดที่จองไว้ (storageSize + indexSize) รอบตรวจหน้าขอ freeStorage ใหม่ (เตือนครั้งเดียวต่อชนิด)",
        );
        captureError(err, { level: "warning", tag: "log-upkeep.free-storage", fingerprint: "log-store:free-storage-failed" });
      }
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
 * ขนาดที่ใช้อยู่จริงเทียบเพดาน แล้วเขียนธงลง relay_state — นับทั้งข้อมูลและ index เพราะ index ก็กินที่เหมือนกัน
 * (ของ `activity` มีสิบเอ็ดตัว)
 *
 * **เพดานนี้คุมไบต์ที่ใช้อยู่ ไม่ได้คุมขนาดบนดิสก์** ซึ่งเป็นเหตุผลที่มีเพดาน (/hdd1tb ร่วมกับ Postgres ของ production):
 * WiredTiger ใช้พื้นที่ว่างซ้ำได้เฉพาะในไฟล์ของ collection (หรือ index) ที่ปล่อยมันออกมา หลัง prune รายวันลบ
 * error_events ไป พื้นที่นั้นยังเป็นของ error_events ถ้า `activity` หรือ `runtime_events` โตต่อ มันจองดิสก์ใหม่ ขนาด
 * บนดิสก์ (`allocatedMb`) จึงเกิน LOG_STORE_MAX_MB ได้เท่ากับพื้นที่ว่างที่ collection อื่นถืออยู่ — ขอบบนคือผลรวมของ
 * ขนาดสูงสุดที่แต่ละ collection เคยใช้ ไม่ใช่เพดาน (กรณีที่น่าจะเกิดจริง: ราวหนึ่งเพดาน) คืนดิสก์ได้ด้วย `compact`
 * เท่านั้น ถ้าต้องการให้ดิสก์ไม่เกินค่าหนึ่งจริง ๆ ให้ตั้งเพดานไว้ราวครึ่งหนึ่งของค่านั้นแล้วเฝ้าดู `allocatedMb`
 * ส่วนบน `sizeBasis: "allocated"` (บริการไม่บอกพื้นที่ว่าง — `readStorageSize`) ตัวที่เทียบคือขนาดที่จองไว้ ซึ่งคุม
 * ขนาดบนดิสก์ได้ แต่ธงลงไม่ได้เองอย่างที่ย่อหน้าท้ายบอก
 *
 * **ที่ใช้อยู่ ไม่ใช่ที่จองไว้**: WiredTiger ไม่คืนพื้นที่ของเอกสารที่ลบแล้วให้ระบบ แต่เก็บไว้ใช้ซ้ำ `storageSize` /
 * `indexSize` จึงไม่ลดลงหลังลบ พื้นที่ว่างนั้นรายงานแยกเป็น `freeStorageSize` / `indexFreeStorageSize` (ต้องขอด้วย
 * `freeStorage: 1`) เดิมเทียบ storageSize + indexSize ตรง ๆ — ธงที่ตั้งแล้วไม่มีวันลง แม้ prune รายวัน หรือคน
 * `deleteMany` จนเหลือครึ่ง: ลองกับ mongo:7.0 แล้ว 2026-09-30 ลบหมดทั้ง collection storageSize ไม่ขยับ ขยับแค่ตัว
 * free ถ้าต้องการคืนดิสก์ให้เครื่องจริง ๆ ต้อง `compact` เอง บริการที่ไม่ให้ตัวเลขพื้นที่ว่างเทียบขนาดที่จองไว้แทน
 * (`readStorageSize`, `relay_state.sizeBasis`)
 *
 * **บน `sizeBasis: "allocated"` ธงลงได้ทางเดียวคือ `compact`** — ขนาดที่จองไว้ไม่ลดเมื่อลบ บนบริการที่ปฏิเสธ `freeStorage`
 * จริง restart worker ก็ไม่ช่วย (มันถามใหม่แล้วถูกปฏิเสธอีก) ส่วนรอบที่ถอยเพราะ error ที่ไม่ใช่การปฏิเสธ รอบตรวจหน้า
 * ได้ `in_use` กลับมาและธงลงตามปกติถ้าที่ใช้จริงต่ำกว่า 90%
 */
async function checkQuota(db: Db): Promise<void> {
  const { storageMb, allocatedMb, basis } = await readStorageSize(db);
  const maxMb = env.logStore.maxMb;

  const relay = db.collection<RelayStateDoc>("relay_state");
  const previous = await relay.findOne(
    { _id: "audit_event" },
    { projection: { overQuota: 1 }, maxTimeMS: MONGO_COMMAND_MAX_MS },
  );
  const wasOver = previous?.overQuota === true;
  const overQuota = storageMb > maxMb ? true : storageMb < maxMb * CLEAR_BELOW ? false : wasOver;

  const checkedAt = new Date();
  await relay.updateOne(
    { _id: "audit_event" },
    { $set: { storageMb, allocatedMb, sizeBasis: basis, overQuota, maxMb, quotaCheckedAt: checkedAt } },
    { upsert: true },
  );
  lastWrittenQuotaAt = checkedAt;

  if (overQuota && !wasOver) {
    const message =
      `log store ใช้พื้นที่ ${storageMb} MB (จองไว้ ${allocatedMb} MB) เกินเพดาน LOG_STORE_MAX_MB ${maxMb} MB — ` +
      "ต่อจากนี้เก็บแค่ตัวนับของ issue ไม่เก็บ error event ทีละตัว จนกว่าจะต่ำกว่า " +
      `${Math.round(maxMb * CLEAR_BELOW * 10) / 10} MB (สำเนา audit กับบันทึกการเรียก admin API ที่ token ผ่านยังเก็บต่อ)`;
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
