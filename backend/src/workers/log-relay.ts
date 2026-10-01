/**
 * relay — คัดลอกแถวที่ Postgres commit แล้วจาก `audit.audit_event` ไปเป็นเอกสาร `activity` ใน log store
 * (plan §3 "Write paths", decision 2) พร้อมงานดูแลที่ผูกกับมัน: reconcile รายชั่วโมง และ prune ตามอายุรายวัน
 *
 * Postgres ยังเป็นระบบบันทึกหลัก — `logAudit()` ไม่รู้จัก Mongo เลย และคำขอของผู้ใช้ไม่เคยรอที่นี่ relay อ่านสิ่งที่ commit
 * แล้วตามหลัง คัดลอกตามจริงทุกแถว รวมแถวที่เขียนระหว่าง transaction ยังเปิดแล้ว transaction นั้น rollback (QA A4 —
 * docs/21 §6.2 อธิบายวิธีอ่าน)
 *
 * วิ่งใน delivery-worker เป็น**ลูปของตัวเอง**สองลูป แยกจากลูปส่งอีเมล: relay ทุก 5 วินาที และงานดูแลทุกนาที
 * แต่ละลูปนัดรอบถัดไปหลังรอบนี้จบ (ไม่ซ้อน) ไม่ throw ออกไป และทุกคำสั่งมีเพดานเวลา (Prisma: `withTimeout`, Mongo:
 * timeout ของ driver กับ `maxTimeMS`) Mongo ล่ม ช้า หรือถูก pause อีเมลก็ยังส่งตามปกติ
 *
 * **ทางเขียน** (relayTick):
 *   1. forward pass — จาก cursor `(occurred_at, id)` ที่บันทึกไว้ อ่านแถวที่ `occurred_at ≤ now − 2 วินาที` เรียงตาม
 *      `(occurred_at, id)` ทีละ 500 ไม่เกิน 20 หน้าต่อรอบ บันทึก cursor หลังทุกหน้า แถวที่ `occurred_at` เดียวกันเป็นพัน
 *      (transaction เดียว, seed) จึงไม่ทำให้ค้าง cursor เก็บเวลาละเอียดถึงไมโครวินาที (`exact`) — Date ของ JavaScript
 *      มีแค่มิลลิวินาที ถ้าใช้ Date ตรง ๆ แถวที่ต่างกันแค่ไมโครวินาทีจะถูกอ่านซ้ำไม่จบ
 *   2. tail pass — อ่านซ้ำแถวที่ `occurred_at > now − 120 วินาที` ไม่เกิน 10 หน้า เก็บแถวที่ commit หลังจาก cursor
 *      ผ่านเวลาของมันไปแล้ว (`occurred_at` มาจากนาฬิกาของ process ที่เขียน ตอนสร้าง INSERT ไม่ใช่ตอน commit)
 *   3. แถวที่มีใน Mongo แล้วข้ามไปเลย ที่เหลือผ่าน `projectAuditRow()` (lib/activity-shape.ts) แล้ว `updateOne` +
 *      `$setOnInsert` + upsert — อ่านซ้ำกี่รอบก็ไม่เปลี่ยนอะไร และ relay สองตัวซ้อนกันระหว่าง deploy ก็ไม่เสียหาย
 *
 * **reconcile** ทุกชั่วโมงเมื่อ forward pass ตามทันแล้วนับจากการเริ่มใหม่ครั้งล่าสุด (rebuild, volume ใหม่ — `caughtUpAt`
 * ถูกล้างตอนเริ่มจากแถวแรก) — นับแถวของ 24 ชั่วโมงที่จบเมื่อสองนาทีก่อน (แถวที่ใหม่กว่านั้นเป็น
 * ของ tail pass) ในทั้งสองฝั่ง ไม่เท่ากันแล้วอ่านช่วงนั้น
 * ซ้ำ (แถวที่มีแล้วถูกข้าม) Mongo มากกว่าเป็นเรื่องปกติหลัง `seed:demo` ลบ Postgres — ยังอ่านซ้ำด้วย เพราะแถวที่ขาดไป
 * ซ่อนอยู่หลังตัวนับที่เกินได้ ผลอยู่ใน `relay_state.lastReconcile`
 *
 * **prune** วันละครั้งหลัง 03:00 น. เวลาไทย (หรือรอบแรกที่ worker ขึ้นหลังจากนั้น) ตามตารางใน lib/log-retention.ts
 *
 * **เพดานขนาดไม่คุม `activity`** — relay ไม่อ่าน `overQuota` เลย คัดลอกทุกแถวไม่ว่า log store จะใหญ่แค่ไหน (plan §3 "Size
 * ceiling" และตัดสิน 2026-09-30: activity เล็ก และเป็นบันทึกที่ค้นได้) เพดานหยุดแค่ `error_events` (workers/log-upkeep.ts)
 * ผลที่ต้องรู้: แถวของคำขอที่ไม่ต้อง login และถูก (`LOGIN_FAILED` `OTP_NOT_PENDING`, `IDENTITY_VERIFICATION_FAILED`
 * `state_not_found`, `PASSWORD_RESET_COMPLETED` `not_found` — ไม่มี throttle) คือแถวหนึ่งใน Postgres **และ**เอกสารหนึ่งใบที่มี
 * index สิบเอ็ดตัว (บวก `_id`) ที่นี่ วัดบน checkout นี้ (2026-09-30): เอกสารราว 970 ไบต์ บวก index 540–640 ไบต์ ต่อแถว
 * Postgres ราว 440 ไบต์ — คำขอที่วนยิงจึงกิน `/hdd1tb` เร็วขึ้นสามถึงสี่เท่าของตอนที่มีแค่ Postgres ประโยค "The Mongo
 * copy is bounded by the size ceiling" ในตารางความเสี่ยงของแผน (§11) ไม่จริงแล้ว — ตัวแก้คือ rate limit ของ `/api/auth/*`
 * (plan §13 #30) ไม่ใช่ที่นี่
 *
 * **rebuild** (รูปเอกสารเปลี่ยน หรือเปลี่ยน LOG_HASH_KEY) — **คำสั่งเดียว** (ผู้ใช้ root หรือ bdi_worker) แล้ว worker ทำเอง:
 *
 *     db.relay_state.updateOne({ _id: "audit_event" }, { $set: { rebuildRequestedAt: new Date() } })
 *
 * รอบ relay ถัดไป (ไม่เกินราว 5 วินาที, `rebuildTick`) ลบเอกสาร `source: "audit_event"` ทีละก้อน แล้วใน `updateOne` เดียว
 * `$unset` `cursor` `hashKeyFp` `schemaVersion` `caughtUpAt` กับตัว `rebuildRequestedAt` และจด `lastRebuild` — รอบถัดจากนั้น
 * เติมใหม่ตั้งแต่แถวแรก ไม่ต้องเริ่ม worker ใหม่ ระหว่างที่ `rebuildRequestedAt` ยังอยู่ relay ไม่คัดลอกอะไร และ reconcile ไม่วิ่ง
 * (`maintenanceTick`) ส่วน relay ไม่เริ่มลบขณะที่รอบงานดูแลกำลังวิ่ง (reconcile ที่นับไปครึ่งทาง)
 *
 * เดิมเป็นสองคำสั่งด้วยมือ — `deleteMany` แล้ว `$unset` cursor ระหว่างสองคำสั่งนั้น cursor ยังอยู่และทุกรอบ relay ต่ออายุ
 * `caughtUpAt` reconcile ที่ถึงกำหนดในช่วงนั้นจึงนับ Mongo 0 เทียบ Postgres N เติมเอง แล้วเตือนและเก็บ warning ว่า "relay พลาดไป
 * N แถว" ทั้งที่ไม่ได้พลาด (ตรวจแบบค้าน, 2026-10-01: สองคำสั่งห่างกัน 31 วินาที ได้คำเตือน 43,498 แถว) ช่องนั้นไม่ใช่แค่ราว
 * 5 วินาทีหลัง `$unset` อย่างที่ความเห็นเดิมเขียน แต่คือทั้งช่วงระหว่างสองคำสั่ง ซึ่งคนพิมพ์ทีละคำสั่งได้เป็นนาที สองคำสั่งแบบเดิม
 * ยังทำงานได้ (cursor เทียบก่อนเขียน — `advanceCursor`) แค่ได้คำเตือนนั้นถ้า reconcile ตรงช่วงพอดี ใช้คำสั่งเดียวข้างบน
 *
 * **อย่าลบเอกสาร relay_state ทั้งใบ**: ใบเดียวกันถือตัวเลขของเพดานขนาด (`storageMb` `overQuota` … — workers/log-upkeep.ts) และ
 * `lastPruneAt` ถ้าลบทั้งใบ log-upkeep เห็นว่าเอกสารไม่ใช่อย่างที่มันเขียนไว้แล้วตรวจเพดานใหม่ในรอบนาทีถัดไป (ก่อนหน้านั้น
 * ธงเกินเพดานหายไปราวหนึ่งนาที) และ prune วิ่งทันที ซึ่งไม่เสียหาย แต่ไม่ใช่วิธีที่ตั้งใจ — docs/21 §3.8 ต้องบอกแบบเดียวกัน
 * ข้อจำกัด: แถวที่ `seed:demo` ลบจาก Postgres ไปแล้วหายจากสำเนาถาวร, เอกสาร `audit_fallback`/`http` ไม่ถูกสร้างใหม่ (ไม่มีใน
 * Postgres และ rebuild ไม่ลบ) และเอกสารที่ prune ลบไปแล้ว (หรือ IP/UA ที่ตัดไปแล้ว) กลับมาจนกว่า prune รอบถัดไปจะลบซ้ำ — ตั้งใจ
 * ไม่แก้ (ตัดสิน 2026-09-30): rebuild ไม่แตะ `lastPruneAt` prune รอบถัดไปจึงเป็นรอบแรกหลัง 03:00 น. เวลาไทยครั้งถัดไป — ช้าสุด
 * ราว 24 ชั่วโมงหลัง rebuild ถ้าต้องการให้ลบทันที รอให้ `caughtUpAt` ใหม่กว่า `lastRebuild.completedAt` (บรรทัด "เติมของค้างครบแล้ว" มีเฉพาะเมื่อค้างเกินหมื่นแถว) แล้วค่อย `$unset`
 * `lastPruneAt` — prune วิ่งในรอบงานดูแลถัดไป (ไม่เกินหนึ่งนาที) ถ้า `$unset` พร้อมกับ rebuild prune อาจวิ่งก่อน relay
 * เติมถึงแถวเก่า แถวที่เติมหลังจากนั้นก็ค้างไปจนถึง 03:00 น. อยู่ดี (relay เติมราวหมื่นแถวต่อรอบ 5 วินาที)
 */
import { AttachmentOwnerType, Prisma, type PrismaClient } from "@prisma/client";
import type { AnyBulkWriteOperation, Collection, Db, Filter } from "mongodb";

import { env } from "../env.js";
import {
  SCHEMA_VERSION,
  categoryOf,
  hashKeyFingerprint,
  projectAuditRow,
  type ActivityCategory,
  type ActivityDoc,
  type AuditRowLike,
} from "../lib/activity-shape.js";
import { referenceOf } from "../lib/context.js";
import { DOCUMENT_REJECTED, captureError, perDocumentErrors } from "../lib/error-capture.js";
import {
  ACTIVITY_RETENTION,
  ANONYMOUS_ADMIN_ACCESS_DAYS,
  BROWSER_EVENT_DAYS,
  CLOSED_ISSUE_DAYS,
  ERROR_EVENT_DAYS,
  OPEN_BROWSER_ISSUE_DAYS,
  RUNTIME_EVENT_DAYS,
} from "../lib/log-retention.js";
import { MONGO_COMMAND_MAX_MS, logDb } from "../lib/log-store.js";

const STATE_ID = "audit_event";

const FIRST_RELAY_MS = 3_000;
const RELAY_EVERY_MS = 5_000;
const PAGE_SIZE = 500;
const FORWARD_PAGES_MAX = 20;
/** แถวที่ใหม่กว่านี้ forward pass ยังไม่อ่าน — ให้ transaction ที่กำลัง commit จบก่อน (tail pass เก็บที่เหลือ) */
const SETTLE_MS = 2_000;
const TAIL_WINDOW_MS = 120_000;
const TAIL_PAGES_MAX = 10;

const FIRST_MAINTENANCE_MS = 20_000;
const MAINTENANCE_EVERY_MS = 60_000;
const RECONCILE_EVERY_MS = 60 * 60_000;
const RECONCILE_WINDOW_MS = 24 * 60 * 60_000;
const RECONCILE_PAGES_MAX = 200;
/** reconcile รอจน forward pass ตามทัน — ระหว่าง backfill ตัวนับไม่เท่ากันแน่ ๆ และการอ่านซ้ำเป็นงานซ้ำเปล่า ๆ */
const CAUGHT_UP_FRESH_MS = 60_000;
/** 03:00 น. เวลาไทย (UTC+7) = 20:00 UTC ของวันก่อน */
const PRUNE_HOUR_UTC = 20;
/**
 * prune ทำทีละก้อนเท่านี้ (`inChunks`) ทั้งการลบและการตัด IP/UA — ก้อนหนึ่งคือคำสั่งหา id หนึ่งคำสั่งกับคำสั่งลบหรือแก้หนึ่งคำสั่ง
 * แต่ละคำสั่งต้องจบใน MONGO_MS
 */
const PRUNE_CHUNK = 5_000;
/** prune หนึ่งรอบทำไม่เกิน 40 × 5,000 ต่อเงื่อนไข — ค้างมากกว่านั้น (worker ดับไปนาน) รอบถัดไปใน 1 นาทีทำต่อ */
const PRUNE_CHUNKS_MAX = 40;

const PG_TIMEOUT_MS = 15_000;
/**
 * `maxTimeMS` ของทุกคำสั่ง Mongo ในไฟล์นี้ ทั้งอ่านและเขียน — เพดานจริงของทุกคำสั่งคือ socketTimeoutMS 5 วินาทีของ driver
 * (lib/log-store.ts) ค่านี้ต่ำกว่านั้นหนึ่งวินาทีให้ server ที่ยังตอบได้แต่ช้ายกเลิกเองก่อน เดิมมี `MONGO_MS = 60_000` ของการเขียน
 * และ prune ซึ่งสัญญาหกสิบวินาทีที่ driver ไม่เคยให้ — `updateMany` ที่ตัด IP/UA ทั้งปีในคำสั่งเดียวโดนตัดที่ห้าวินาทีแล้ว server
 * ยังทำต่อเบื้องหลังขณะที่ worker นับว่าล้ม (ตรวจขั้น 7 แบบค้าน, 2026-09-30) งานที่ยาวกว่านี้แบ่งก้อน (`inChunks`) ไม่ขยายเพดาน
 * ค่านี้**ไม่ได้**กันคำสั่งถูกตัดเมื่อ server หยุดตอบราวสองวินาทีขึ้นไป: monitor ของ driver ล้าง pool แล้วตัดทุกคำสั่งที่ค้างอยู่
 * (`PoolClearedOnNetworkError` — MONGO_COMMAND_MAX_MS ใน lib/log-store.ts) รอบของลูปนั้นล้มแล้วรอบถัดไปทำต่อ prune จดส่วนที่
 * ทำไปแล้วก่อนล้ม (`runPrune`)
 */
const MONGO_MS = MONGO_COMMAND_MAX_MS;
/** cursor ที่อยู่ในอนาคตเกินนี้ถือว่าเสีย — เริ่มใหม่จากแถวแรก (ดู `cursorFrom`) */
const FUTURE_TOLERANCE_MS = 5 * 60_000;
const CAPTURE_EVERY_MS = 10 * 60_000;

const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const EXACT_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** ตำแหน่งใน audit_event — แถวถัดไปคือแถวแรกที่ `(occurred_at, id)` มากกว่านี้ */
interface Cursor {
  /** ถึงมิลลิวินาที — ไว้ให้คนอ่าน */
  at: Date;
  /** ISO ถึงไมโครวินาที (`…T01:02:03.123456Z`) — ตัวที่ใช้เทียบจริง */
  exact: string;
  id: string;
}

const EPOCH: Cursor = { at: new Date(0), exact: "1970-01-01T00:00:00.000000Z", id: NIL_UUID };

/**
 * เอกสารเดียวใน relay_state — worker เป็นผู้เขียนคนเดียว และเขียนด้วย `$set` ทีละส่วนเสมอ: workers/log-upkeep.ts เขียน
 * ส่วนของเพดานขนาด (`storageMb`, `overQuota`, …) ลงเอกสารเดียวกัน
 */
interface RelayStateDoc {
  _id: string;
  cursor?: Cursor;
  lastRunAt?: Date;
  /** เอกสารที่รอบล่าสุดเขียนใหม่ */
  lastBatch?: number;
  lastError?: string | null;
  /** forward pass อ่านจนสุดครั้งล่าสุดเมื่อไร — ความล่าช้าของสำเนา ≈ ตอนนี้ลบค่านี้ (`/api/admin/logs/status` ของ step 7) */
  caughtUpAt?: Date;
  lastReconcileAt?: Date;
  lastReconcile?: Record<string, unknown>;
  lastPruneAt?: Date;
  lastPrune?: Record<string, unknown>;
  /** fingerprint ของ LOG_HASH_KEY ที่สำเนานี้ใช้ — `hashKeyFingerprint()` */
  hashKeyFp?: string;
  schemaVersion?: number;
  /** คนสั่ง rebuild (หัวไฟล์) — ค่าอะไรก็ได้ที่ไม่ใช่ null ถือว่าสั่ง `rebuildTick` ล้างเมื่อลบครบ */
  rebuildRequestedAt?: unknown;
  lastRebuild?: Record<string, unknown>;
}

/** แถวตามที่ `$queryRaw` คืน — enum เป็นข้อความ uuid เป็นข้อความ และเวลาละเอียดถึงไมโครวินาทีใน `occurred_exact` */
interface RawAuditRow {
  id: string;
  occurred_at: Date;
  occurred_exact: string;
  actor_type: string;
  actor_id: string | null;
  action: string;
  subject_type: string;
  subject_id: string | null;
  organization_id: string | null;
  result: string;
  before_summary_json: unknown;
  after_summary_json: unknown;
  ip_address: string | null;
  user_agent: string | null;
  correlation_id: string;
  source_component: string;
  metadata_json: unknown;
}

type ActivityCollection = Collection<{ _id: string; [key: string]: unknown }>;

let prisma: PrismaClient | null = null;
let stopped = false;
let relayTimer: NodeJS.Timeout | null = null;
let maintenanceTimer: NodeJS.Timeout | null = null;
let relayRunning: Promise<void> | null = null;
let maintenanceRunning: Promise<void> | null = null;
/** relay ล้มติดกันอยู่ — พิมพ์บรรทัดเดียวตอนเริ่มล้มและตอนกลับมา ไม่ใช่ทุก 5 วินาที */
let failing = false;
/** กำลังเติมของค้าง (forward pass ครบ 20 หน้า) — พิมพ์ความคืบหน้าและบรรทัดเดียวตอนจบ */
let backfilling = false;
let warnedHashKey = false;
let warnedSchema = false;
/** rebuild ที่กำลังลบอยู่ — ลบไปแล้วกี่ใบ (รอบละไม่เกิน 200,000 ใบ ค้างมากกว่านั้นลบต่อรอบถัดไป) */
let rebuilding: { deleted: number; started: Date } | null = null;
const lastCaptured = new Map<string, number>();

/** เริ่มสองลูป — เรียกจาก main() ของ delivery-worker หลัง startLogStore ปิด log store อยู่ก็ไม่ทำอะไร */
export function startLogRelay(client: PrismaClient): void {
  if (!env.logStore.enabled || prisma) return;
  prisma = client;
  stopped = false;
  scheduleRelay(FIRST_RELAY_MS);
  scheduleMaintenance(FIRST_MAINTENANCE_MS);
}

/**
 * หยุดสองลูป แล้วรอรอบที่กำลังวิ่งไม่เกิน `waitMs` — รอบที่ถูกตัดกลางทางไม่เสียอะไร: cursor บันทึกหลังหน้าที่เขียนแล้ว
 * เท่านั้น หน้าที่ค้างถูกอ่านซ้ำตอนเริ่มใหม่ (upsert ซ้ำได้)
 */
export async function stopLogRelay(waitMs = 1_500): Promise<void> {
  stopped = true;
  if (relayTimer) clearTimeout(relayTimer);
  if (maintenanceTimer) clearTimeout(maintenanceTimer);
  relayTimer = null;
  maintenanceTimer = null;
  const running = [relayRunning, maintenanceRunning].filter((p): p is Promise<void> => p !== null);
  if (running.length > 0) await settleWithin(Promise.all(running), waitMs);
}

function scheduleRelay(ms: number) {
  if (stopped) return;
  relayTimer = setTimeout(() => {
    relayRunning = relayTick().finally(() => {
      relayRunning = null;
      scheduleRelay(RELAY_EVERY_MS);
    });
  }, ms);
  relayTimer.unref();
}

function scheduleMaintenance(ms: number) {
  if (stopped) return;
  maintenanceTimer = setTimeout(() => {
    maintenanceRunning = maintenanceTick().finally(() => {
      maintenanceRunning = null;
      scheduleMaintenance(MAINTENANCE_EVERY_MS);
    });
  }, ms);
  maintenanceTimer.unref();
}

// --------------------------------------------------------------------------------------------- relay

async function relayTick(): Promise<void> {
  const client = prisma;
  if (!client) return;
  try {
    const db = await logDb();
    // ต่อไม่ได้ — log-store.ts พิมพ์สถานะไปแล้ว รอบหน้าลองใหม่
    if (!db) return;
    const relay = db.collection<RelayStateDoc>("relay_state");
    const state = await relay.findOne({ _id: STATE_ID }, { maxTimeMS: MONGO_MS });
    // ก่อน checkIdentity: กุญแจที่เปลี่ยนคือเหตุผลของ rebuild เอง ไม่ต้องเตือนซ้ำระหว่างที่กำลังทำ
    if (state?.rebuildRequestedAt !== undefined && state.rebuildRequestedAt !== null) {
      await rebuildTick(db, relay, state.rebuildRequestedAt);
      return;
    }
    await checkIdentity(relay, state);

    const started = new Date();
    const upper = new Date(started.getTime() - SETTLE_MS);
    const from = cursorFrom(state);
    /**
     * เริ่มจากแถวแรก (volume ใหม่, rebuild, cursor เสีย) — ล้างสองอย่างก่อนอ่านหน้าแรก:
     *   - cursor ที่เก็บไว้ถ้าใช้ไม่ได้ (รูปผิด อยู่ในอนาคต) การเขียน cursor ของรอบนี้จึงเทียบกับ "ไม่มี cursor" ได้ แทนการเทียบกับ
     *     ค่าเสียที่อาจอ่านกลับมาไม่ตรงตัว (แล้ว relay ติดอยู่ตรงนั้นตลอดไป)
     *   - `caughtUpAt` — มันบอก reconcile ว่าสำเนาครบถึงเมื่อไร ซึ่งไม่จริงแล้วตั้งแต่เริ่มใหม่ เดิมค่าเก่ายังอยู่หลัง rebuild
     *     reconcile รอบชั่วโมงที่ตรงกับช่วงเติมของค้างเห็นว่า "ตามทันเมื่อครู่" นับ 24 ชั่วโมงแล้วเจอ Mongo ขาด เติมเองแล้วเตือน
     *     "สำเนาขาดไป N แถว" ว่า relay พลาดทั้งที่มันแค่ยังเติมไม่ถึง (ตรวจขั้น 7 แบบค้าน, 2026-09-30) รอบที่ forward pass
     *     อ่านจนสุดจริงเป็นตัวเขียนค่าใหม่ (`markCaughtUp`)
     */
    if (from === EPOCH) {
      const unset: Record<string, ""> = {};
      if (state?.cursor !== undefined && state.cursor !== null) unset.cursor = "";
      if (state?.caughtUpAt !== undefined) unset.caughtUpAt = "";
      if (Object.keys(unset).length > 0) {
        await relay.updateOne({ _id: STATE_ID }, { $unset: unset }, { maxTimeMS: MONGO_MS });
      }
    }
    let cursor = from;
    let inserted = 0;
    let caughtUp = false;
    for (let page = 0; page < FORWARD_PAGES_MAX && !stopped; page++) {
      const rows = await readPage(client, cursor, { at: upper, inclusive: true });
      if (rows.length > 0) {
        inserted += await writeRows(db, client, rows);
        const next = cursorOfRow(rows[rows.length - 1]!);
        if (!(await advanceCursor(relay, cursor, next))) {
          console.log(
            "[log-relay] cursor ใน relay_state เปลี่ยนไประหว่างรอบนี้ (rebuild หรือ relay อีกตัว) — ทิ้งรอบนี้ " +
              "รอบถัดไปอ่านต่อจาก cursor ที่บันทึกไว้ตอนนั้น",
          );
          return;
        }
        cursor = next;
      }
      if (rows.length < PAGE_SIZE) {
        caughtUp = true;
        break;
      }
    }

    let tail = cursorAt(new Date(started.getTime() - TAIL_WINDOW_MS));
    for (let page = 0; page < TAIL_PAGES_MAX && !stopped; page++) {
      const rows = await readPage(client, tail, null);
      if (rows.length === 0) break;
      inserted += await writeRows(db, client, rows);
      tail = cursorOfRow(rows[rows.length - 1]!);
      if (rows.length < PAGE_SIZE) break;
    }

    await relay.updateOne(
      { _id: STATE_ID },
      { $set: { lastRunAt: new Date(), lastBatch: inserted, lastError: null } },
      { upsert: true, maxTimeMS: MONGO_MS },
    );
    if (caughtUp) await markCaughtUp(relay, cursor, started);

    if (failing) {
      failing = false;
      // บอก cursor ที่รอบนี้ใช้จริง — volume ที่ถูกสร้างใหม่ระหว่างล่มไม่มี cursor ให้ตามต่อ relay เริ่มจากแถวแรก
      // (แถวที่ seed:demo ลบจาก Postgres ไปแล้วไม่กลับมา) เดิมบรรทัดนี้บอก "ตามต่อจาก cursor เดิม ไม่มีแถวหาย" เสมอ
      // แม้ในกรณีนั้น (ตรวจขั้น 6, 2026-09-30) · cursorFrom() คืน EPOCH ทั้งตอนไม่มี cursor และตอน cursor เสีย
      console.log(
        `[log-relay] คัดลอก audit_event ลง log store ได้อีกครั้ง — ${
          from === EPOCH
            ? "ไม่มี cursor ที่ใช้ได้ใน relay_state (volume ใหม่ ถูกลบ หรือเสีย) เริ่มจากแถวแรก"
            : `อ่านต่อจาก cursor ที่บันทึกไว้ (${from.exact})`
        }`,
      );
    }
    if (!caughtUp) {
      backfilling = true;
      console.log(`[log-relay] กำลังเติมของค้าง — ถึง ${cursor.exact} แล้ว (รอบนี้เขียนใหม่ ${inserted} เอกสาร)`);
    } else if (backfilling) {
      backfilling = false;
      console.log(`[log-relay] เติมของค้างครบแล้ว — ตามทันถึง ${cursor.exact}`);
    }
  } catch (err) {
    if (!failing) {
      failing = true;
      console.warn(`[log-relay] คัดลอกไม่สำเร็จ (${errorName(err)}) — ลองใหม่ทุก 5 วินาที`);
    }
    captureThrottled("log-relay.tick", err);
    await noteError(err);
  }
}

/**
 * rebuild ที่คนสั่งไว้ (`rebuildRequestedAt` — หัวไฟล์) หนึ่งรอบ: ลบสำเนา `source: "audit_event"` ทีละก้อน (ก้อนละ 5,000 ไม่เกิน
 * 40 ก้อนต่อรอบ เหมือน prune) ลบครบแล้วล้าง cursor และค่าที่ผูกกับสำเนาเดิมในคำสั่งเดียว รอบถัดไปเติมใหม่ตั้งแต่แถวแรก
 *
 * การล้างเทียบ `rebuildRequestedAt` กับค่าที่อ่านมา: คนที่สั่งซ้ำระหว่างที่กำลังลบ (ค่าใหม่) ได้อีกรอบ ไม่ใช่ถูกล้างทิ้ง
 * ไม่เริ่มลบขณะที่รอบงานดูแลกำลังวิ่ง — reconcile ที่นับ Mongo ไปครึ่งทางระหว่างที่ถูกลบจะเติมเองแล้วเตือนว่า relay พลาด
 * รอบงานดูแลที่เริ่มหลังจากนี้เห็น `rebuildRequestedAt` แล้วข้าม reconcile เอง (ใน process เดียวกัน — worker สองตัวซ้อนกันตอน
 * deploy ยังชนกันได้ ผลคือคำเตือนหนึ่งบรรทัด ไม่ใช่ข้อมูลเสีย)
 */
async function rebuildTick(db: Db, relay: Collection<RelayStateDoc>, requestedAt: unknown): Promise<void> {
  if (maintenanceRunning) return;
  if (!rebuilding) {
    rebuilding = { deleted: 0, started: new Date() };
    console.log("[log-relay] rebuild: ลบสำเนาของ audit_event ใน log store แล้วจะเติมใหม่ตั้งแต่แถวแรก (relay หยุดคัดลอกระหว่างนี้)");
  }
  const activity = db.collection("activity") as unknown as ActivityCollection;
  const progress = rebuilding;
  // นับทีละก้อน — รอบที่ล้มกลางทาง (Mongo หยุดตอบ) ไม่ทำให้ยอดที่ลบไปแล้วหาย รอบถัดไปบวกต่อ
  const complete = await deleteInChunks(activity, { source: "audit_event" }, (n) => (progress.deleted += n));
  if (!complete) {
    console.log(`[log-relay] rebuild: ลบไปแล้ว ${rebuilding.deleted} ใบ — ยังเหลือ ลบต่อรอบถัดไป`);
    return;
  }
  const done = await relay.updateOne(
    { _id: STATE_ID, rebuildRequestedAt: requestedAt } as Filter<RelayStateDoc>,
    {
      $unset: { cursor: "", hashKeyFp: "", schemaVersion: "", caughtUpAt: "", rebuildRequestedAt: "" },
      $set: { lastRebuild: { requestedAt, startedAt: rebuilding.started, completedAt: new Date(), deleted: rebuilding.deleted } },
    },
    { maxTimeMS: MONGO_MS },
  );
  if (done.matchedCount === 0) {
    // มีคนสั่งซ้ำระหว่างที่ลบ — รอบถัดไปอ่านค่าใหม่แล้วลบอีกรอบ (เอกสารที่ relay ไม่ได้เขียนระหว่างนี้ ลบรอบสองเร็ว)
    console.log("[log-relay] rebuild: มีคำสั่ง rebuild ใหม่ระหว่างที่ลบ — ทำอีกรอบ");
    return;
  }
  console.log(
    `[log-relay] rebuild: ลบสำเนาเดิมครบ ${rebuilding.deleted} ใบ — ล้าง cursor แล้ว รอบถัดไปเติมใหม่ตั้งแต่แถวแรก`,
  );
  rebuilding = null;
  warnedHashKey = false;
  warnedSchema = false;
}

/**
 * cursor ที่บันทึกไว้ — ไม่มี (volume ใหม่, หลัง rebuild) หรือรูปผิดเริ่มจากแถวแรก
 *
 * cursor ที่อยู่ในอนาคตถือว่าเสียด้วย: forward pass จะข้ามทุกแถวจนกว่านาฬิกาจะไปถึง แล้ว backfill ของแถวเก่าทั้งหมด
 * จะไม่เกิด — แถวใหม่ยังรอดเพราะ tail pass กับ reconcile ไม่ใช้ cursor ตัวนี้ cursor แบบนั้นถูกทิ้งแล้วเริ่มจากแถวแรก
 * (upsert ซ้ำได้ ราคาแค่การอ่านทั้งตาราง) และเก็บเป็น error ไว้ให้เห็น ตรวจที่ `exact` เพราะเป็นตัวที่ใช้เทียบจริง ไม่ใช่
 * `at` ที่มีไว้ให้คนอ่าน
 *
 * ตัวนี้เป็นชั้นที่สอง: เดิม `bdi_backend` insert ได้ทุก collection รวม relay_state (plan decision 8) backend ที่ถูกยึดจึง
 * วางเอกสารนี้เองได้ตอนที่มันยังไม่มี (volume ใหม่ หรือมีคนลบทั้งใบ) และ cursor ที่เป็น**เวลาปัจจุบัน**ผ่านการตรวจนี้ได้
 * — relay ข้าม backfill ทั้งหมดเงียบ ๆ ส่วน reconcile เติมแค่ 24 ชั่วโมงล่าสุด ตอนนี้ role ของ backend insert ได้แค่
 * activity / error_events / error_issues / runtime_events (mongo/init/01-users.js) ช่องนั้นจึงปิดที่สิทธิ์ ที่เหลือคือ
 * คนที่ถือสิทธิ์ของ worker หรือ root ซึ่งแก้อะไรใน Mongo ก็ได้อยู่แล้ว
 */
function cursorFrom(state: RelayStateDoc | null): Cursor {
  const cursor = state?.cursor;
  if (!cursor) return EPOCH;
  const valid =
    cursor.at instanceof Date &&
    typeof cursor.exact === "string" &&
    EXACT_TS.test(cursor.exact) &&
    typeof cursor.id === "string" &&
    UUID.test(cursor.id);
  if (!valid) {
    reportBadCursor("รูปไม่ถูกต้อง");
    return EPOCH;
  }
  if (Date.parse(cursor.exact) > Date.now() + FUTURE_TOLERANCE_MS) {
    reportBadCursor(`อยู่ในอนาคต (${cursor.exact})`);
    return EPOCH;
  }
  return { at: cursor.at, exact: cursor.exact, id: cursor.id };
}

/**
 * บันทึก cursor ใหม่ **เฉพาะเมื่อค่าที่เก็บยังเป็น `expected`** (compare-and-set) — คืน false ถ้ามีคนเปลี่ยนมันไปแล้ว
 *
 * เดิมเป็น `$set` เฉย ๆ จากค่าที่อ่านตอนเริ่มรอบ rebuild ตามคู่มือเดิม (`deleteMany` แล้ว `$unset` cursor ด้วยมือขณะ worker วิ่งอยู่
 * — คู่มือตอนนี้เป็นคำสั่งเดียวที่ worker ลบเอง `rebuildTick` แต่สองคำสั่งแบบเดิมยังพิมพ์ได้) จึง
 * แข่งกับรอบที่อ่าน state ก่อน `$unset` แล้วเขียนหน้าถัดไปหลังจากนั้นได้: cursor เก่าถูกเขียนคืน relay อ่านต่อจากเกือบปัจจุบัน
 * เอกสารก่อนหน้านั้นที่ `deleteMany` ลบไปแล้วไม่กลับมาอีก reconcile เติมแค่ 24 ชั่วโมงล่าสุด และไม่มีบรรทัดไหนบอก (ตรวจแบบค้าน
 * ขั้น 7, 2026-09-30 — จากการอ่านโค้ด) ตอนนี้รอบนั้นเขียนไม่ติด ทิ้งรอบ แล้วรอบถัดไปเริ่มจากแถวแรก
 *
 * ไม่ upsert: เอกสาร relay_state มีอยู่แล้วเสมอตรงนี้ (`checkIdentity` สร้างให้ตอนอ่านได้ null) ถ้ามีคนลบทั้งใบระหว่างรอบ
 * ก็เขียนไม่ติดเหมือนกัน รอบถัดไปสร้างใหม่ · ช่องที่เหลือ: รอบที่เริ่มจาก "ไม่มี cursor" แล้ว rebuild เกิดระหว่างหน้าแรก
 * ของมัน — `$unset` ของค่าที่ไม่มีอยู่แล้วไม่เปลี่ยนอะไร ตัวเทียบจึงผ่าน และถ้า `deleteMany` ลบเอกสารของหน้านั้นไปแล้ว
 * แถวไม่เกิน 500 แถวนั้นไม่ถูกเติมคืน (ต้อง rebuild ซ้ำภายในไม่กี่วินาทีหลัง rebuild หรือ volume ใหม่ — ยอมรับ)
 * relay สองตัวซ้อนกันระหว่าง deploy ก็ผ่านตัวนี้: ตัวที่เขียนช้ากว่าทิ้งรอบของมันแทนการพา cursor ถอยหลัง
 */
async function advanceCursor(relay: Collection<RelayStateDoc>, expected: Cursor, next: Cursor): Promise<boolean> {
  const guard: Filter<RelayStateDoc> =
    expected === EPOCH
      ? ({ cursor: null } as unknown as Filter<RelayStateDoc>)
      : { "cursor.exact": expected.exact, "cursor.id": expected.id };
  const result = await relay.updateOne({ _id: STATE_ID, ...guard }, { $set: { cursor: next } }, { maxTimeMS: MONGO_MS });
  return result.matchedCount === 1;
}

/**
 * จดว่า forward pass อ่านจนสุดแล้ว (`caughtUpAt`) **เฉพาะเมื่อ cursor ยังเป็นตัวที่รอบนี้เขียนไว้** — rebuild ที่ `$unset` cursor
 * ระหว่าง tail pass ของรอบนี้ต้องไม่ได้ `caughtUpAt` ของสำเนาเก่ากลับคืน ไม่งั้น reconcile เชื่อว่าตามทันทั้งที่เพิ่งเริ่มเติมใหม่
 * รอบที่ไม่เคยเขียน cursor (ตาราง audit ว่าง) เทียบกับ "ไม่มี cursor" แบบเดียวกับ `advanceCursor`
 */
async function markCaughtUp(relay: Collection<RelayStateDoc>, cursor: Cursor, at: Date): Promise<void> {
  const guard: Filter<RelayStateDoc> =
    cursor === EPOCH
      ? ({ cursor: null } as unknown as Filter<RelayStateDoc>)
      : { "cursor.exact": cursor.exact, "cursor.id": cursor.id };
  await relay.updateOne({ _id: STATE_ID, ...guard }, { $set: { caughtUpAt: at } }, { maxTimeMS: MONGO_MS });
}

function reportBadCursor(why: string) {
  const message = `cursor ใน relay_state ${why} — เริ่มคัดลอกใหม่จากแถวแรก (เขียนซ้ำไม่เสียหาย)`;
  console.warn(`[log-relay] ${message}`);
  captureThrottled("log-relay.cursor", new Error(message), "error");
}

/** ตำแหน่งก่อนแถวแรกที่ `occurred_at >= at` */
function cursorAt(at: Date): Cursor {
  return { at, exact: at.toISOString().replace(/Z$/, "000Z"), id: NIL_UUID };
}

function cursorOfRow(row: RawAuditRow): Cursor {
  return { at: row.occurred_at, exact: row.occurred_exact, id: row.id };
}

/**
 * หนึ่งหน้า เรียงตาม `(occurred_at, id)` ต่อจาก `after` — `(a, b) > (x, y)` ของ Postgres ใช้ index `(occurred_at, id)`
 * (migration 20260930013712) เวลาเทียบกันด้วยข้อความถึงไมโครวินาที ไม่ผ่าน Date ของ JavaScript
 */
async function readPage(
  client: PrismaClient,
  after: Cursor,
  upper: { at: Date; inclusive: boolean } | null,
): Promise<RawAuditRow[]> {
  const bound = !upper
    ? Prisma.empty
    : upper.inclusive
      ? Prisma.sql`AND occurred_at <= ${upper.at.toISOString()}::timestamptz`
      : Prisma.sql`AND occurred_at < ${upper.at.toISOString()}::timestamptz`;
  return withTimeout(
    client.$queryRaw<RawAuditRow[]>`
      SELECT id::text AS id,
             occurred_at,
             to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS occurred_exact,
             actor_type::text AS actor_type,
             actor_id::text AS actor_id,
             action,
             subject_type,
             subject_id::text AS subject_id,
             organization_id::text AS organization_id,
             result::text AS result,
             before_summary_json,
             after_summary_json,
             ip_address,
             user_agent,
             correlation_id,
             source_component,
             metadata_json
        FROM audit.audit_event
       WHERE (occurred_at, id) > (${after.exact}::timestamptz, ${after.id}::uuid)
             ${bound}
       ORDER BY occurred_at, id
       LIMIT ${PAGE_SIZE}`,
    PG_TIMEOUT_MS,
    "อ่าน audit_event",
  );
}

function rowLike(row: RawAuditRow): AuditRowLike {
  return {
    id: row.id,
    occurredAt: row.occurred_at,
    actorType: row.actor_type,
    actorId: row.actor_id,
    action: row.action,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    organizationId: row.organization_id,
    result: row.result,
    before: row.before_summary_json,
    after: row.after_summary_json,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
    correlationId: row.correlation_id,
    sourceComponent: row.source_component,
    metadata: row.metadata_json,
  };
}

/**
 * เขียนแถวที่ยังไม่มีใน Mongo — คืนจำนวนเอกสารที่เขียนใหม่
 *
 * ถามก่อนว่า id ไหนมีแล้ว (index `_id`) แล้วแปลงเฉพาะที่ขาด: tail pass อ่านสองนาทีล่าสุดซ้ำทุก 5 วินาที และ rebuild
 * หรือ cursor ที่ถูกรีเซ็ตอ่านทั้งตารางซ้ำ ไม่ถามก่อนก็แปลง (HMAC, ปิดข้อมูล) และส่ง upsert ที่ไม่เปลี่ยนอะไรเป็นพัน ๆ
 * ตัวต่อรอบ การเขียนยังเป็น upsert + `$setOnInsert` ไม่ใช่ insert: relay อีกตัว (deploy ซ้อนกัน) อาจเขียนไปก่อนระหว่างนั้น
 */
async function writeRows(db: Db, client: PrismaClient, rows: RawAuditRow[]): Promise<number> {
  const activity = db.collection("activity") as unknown as ActivityCollection;
  const existing = await activity
    .find({ _id: { $in: rows.map((row) => row.id) } }, { projection: { _id: 1 }, maxTimeMS: MONGO_MS })
    .toArray();
  const have = new Set(existing.map((doc) => doc._id));
  const missing = rows.filter((row) => !have.has(row.id));
  if (missing.length === 0) return 0;

  const numbers = await requestNumbers(client, missing);
  const now = new Date();
  const operations: AnyBulkWriteOperation<{ _id: string; [key: string]: unknown }>[] = missing.map((row) => {
    const { _id, ...fields } = projectSafely(row, numbers.get(row.id) ?? null, now);
    return { updateOne: { filter: { _id }, update: { $setOnInsert: fields }, upsert: true } };
  });
  try {
    const result = await activity.bulkWrite(operations, { ordered: false, maxTimeMS: MONGO_MS });
    return result.upsertedCount;
  } catch (err) {
    // เหมือน insertAll ใน lib/error-capture.ts: 11000 = อีกตัวเขียนไปแล้ว (สำเร็จ) · รหัสใน DOCUMENT_REJECTED =
    // เอกสารตัวนั้นใช้ไม่ได้ ลองกี่ครั้งก็ไม่ผ่าน ข้ามไป ไม่งั้น cursor ค้างที่หน้านี้ตลอดไป · นอกนั้นทั้งหน้าลองใหม่รอบหน้า
    const writeErrors = perDocumentErrors(err);
    if (!writeErrors || writeErrors.length === 0) throw err;
    const refused = writeErrors.filter((e) => e.code !== 11000);
    if (refused.some((e) => !DOCUMENT_REJECTED.has(Number(e.code)))) throw err;
    if (refused.length > 0) {
      console.warn(`[log-relay] Mongo ไม่รับเอกสาร ${refused.length} ตัว — ข้ามไป (แถวยังอยู่ใน Postgres)`);
      captureThrottled("log-relay.rejected", err, "error");
    }
    return (err as { result?: { upsertedCount?: number } }).result?.upsertedCount ?? 0;
  }
}

/**
 * แปลงหนึ่งแถว — แถวที่แปลงไม่ได้ (ข้อมูลรูปที่ไม่มีใครคาด) ได้เอกสารย่อที่มีแค่ใคร ทำอะไร เมื่อไร กับ
 * `projectionFailed: true` แทน ไม่ใช่ทำให้ทั้งหน้าล้ม: หน้าที่ล้มทุกรอบคือ cursor ที่ไม่มีวันขยับ และสำเนาหยุดทั้งก้อน
 * แถวเต็มยังอยู่ใน Postgres
 */
function projectSafely(row: RawAuditRow, requestNumber: string | null, now: Date): ActivityDoc {
  try {
    return projectAuditRow(rowLike(row), { source: "audit_event", hashKey: env.logStore.hashKey, requestNumber, now });
  } catch (err) {
    captureThrottled("log-relay.project", err, "error");
    return {
      _id: row.id,
      source: "audit_event",
      schemaVersion: SCHEMA_VERSION,
      occurredAt: row.occurred_at,
      action: row.action,
      category: categoryOf(row.action, null),
      result: row.result,
      actor: { type: row.actor_type, id: row.actor_id, name: null, roles: [], organizationId: null },
      via: "SYSTEM",
      tokenFps: [],
      subject: { type: row.subject_type, id: row.subject_id },
      organizationId: row.organization_id,
      requestNumber,
      gate: null,
      before: null,
      after: null,
      changedFields: [],
      reason: null,
      metadata: null,
      request: {
        correlationId: row.correlation_id,
        reference: referenceOf(row.correlation_id),
        ip: null,
        userAgent: null,
        method: null,
        route: null,
        status: null,
        durationMs: null,
      },
      sourceComponent: row.source_component,
      relatedUserIds: [],
      hashKeys: [],
      mirroredAt: now,
      projectionFailed: true,
    };
  }
}

/**
 * เลขที่คำขอของแถวที่ subject เป็นคำขอ หรือเป็นไฟล์แนบของคำขอ — `findMany` ครั้งเดียวต่อตารางต่อหน้า
 * ไฟล์แนบของชุดข้อมูลที่อนุมัติแล้ว (`DATASET`) และไฟล์ของเอกสารกฎหมายไม่ได้เลขที่คำขอ
 *
 * **คำขอที่ถูกลบไปแล้ว** (`DELETE /api/admin/registrations/datasets/:id`) ไม่อยู่ในตารางคำขอ — เลขที่มาจากแถว
 * `REQUEST_DELETED` ของมันเองใน audit_event (`metadata.request_number`, สำรองด้วย `before.requestNumber`) หนึ่งคำสั่งต่อหน้า
 * เฉพาะเมื่อมี id ที่หาไม่เจอ (index `subject_type, subject_id`) ไฟล์แนบของคำขอนั้นยังอยู่ (ถูกปิด ไม่ถูกลบ) จึงได้เลขที่
 * ผ่านทางเดียวกัน เดิมทางนี้ถามแค่ตารางคำขอ: แถวที่ relay คัดลอก**หลัง**การลบ — ทุกแถวตอน backfill ครั้งแรกของ production
 * และทุก rebuild — ได้ `requestNumber: null` ยกเว้นรหัสที่ใส่ `request_number` ไว้ใน metadata เอง (บันทึกร่าง สร้างเอกสาร
 * แก้โดย admin) `REQUEST_CREATED` `SUBMITTED` `APPROVED` `RETURNED` และทุกแถวของไฟล์แนบจึงหายจาก `?request=<เลขที่>` ทั้งที่
 * สำเนาที่คัดลอกก่อนการลบมีเลขที่ครบ ผลขึ้นกับว่า relay วิ่งเมื่อไร (ตรวจแบบค้านขั้น 7, 2026-09-30)
 */
async function requestNumbers(client: PrismaClient, rows: RawAuditRow[]): Promise<Map<string, string>> {
  const organizationIds = new Set<string>();
  const datasetIds = new Set<string>();
  const attachmentIds = new Set<string>();
  for (const row of rows) {
    if (!row.subject_id) continue;
    if (row.subject_type === "ORGANIZATION_REGISTRATION_REQUEST") organizationIds.add(row.subject_id);
    else if (row.subject_type === "DATASET_REGISTRATION_REQUEST") datasetIds.add(row.subject_id);
    else if (row.subject_type === "ATTACHMENT") attachmentIds.add(row.subject_id);
  }

  const ownerOf = new Map<string, string>();
  if (attachmentIds.size > 0) {
    const attachments = await withTimeout(
      client.attachment.findMany({
        where: { id: { in: [...attachmentIds] } },
        select: { id: true, ownerType: true, ownerId: true },
      }),
      PG_TIMEOUT_MS,
      "อ่านเจ้าของไฟล์แนบ",
    );
    for (const attachment of attachments) {
      if (attachment.ownerType === AttachmentOwnerType.ORGANIZATION_REGISTRATION_REQUEST) {
        organizationIds.add(attachment.ownerId);
      } else if (attachment.ownerType === AttachmentOwnerType.DATASET_REGISTRATION_REQUEST) {
        datasetIds.add(attachment.ownerId);
      } else continue;
      ownerOf.set(attachment.id, attachment.ownerId);
    }
  }

  const numberOf = new Map<string, string>();
  if (organizationIds.size > 0) {
    const requests = await withTimeout(
      client.organizationRegistrationRequest.findMany({
        where: { id: { in: [...organizationIds] } },
        select: { id: true, requestNumber: true },
      }),
      PG_TIMEOUT_MS,
      "อ่านเลขที่คำขอหน่วยงาน",
    );
    for (const request of requests) numberOf.set(request.id, request.requestNumber);
  }
  if (datasetIds.size > 0) {
    const requests = await withTimeout(
      client.datasetRegistrationRequest.findMany({
        where: { id: { in: [...datasetIds] } },
        select: { id: true, requestNumber: true },
      }),
      PG_TIMEOUT_MS,
      "อ่านเลขที่คำขอชุดข้อมูล",
    );
    for (const request of requests) numberOf.set(request.id, request.requestNumber);
  }
  const gone = [...organizationIds, ...datasetIds].filter((id) => !numberOf.has(id));
  if (gone.length > 0) {
    const deletions = await withTimeout(
      client.auditEvent.findMany({
        where: {
          action: "REQUEST_DELETED",
          subjectType: { in: ["ORGANIZATION_REGISTRATION_REQUEST", "DATASET_REGISTRATION_REQUEST"] },
          subjectId: { in: gone },
        },
        select: { subjectId: true, metadataJson: true, beforeSummaryJson: true },
      }),
      PG_TIMEOUT_MS,
      "อ่านเลขที่ของคำขอที่ถูกลบ",
    );
    for (const deletion of deletions) {
      const number = stringField(deletion.metadataJson, "request_number") ?? stringField(deletion.beforeSummaryJson, "requestNumber");
      if (deletion.subjectId && number) numberOf.set(deletion.subjectId, number);
    }
  }

  const byRow = new Map<string, string>();
  for (const row of rows) {
    if (!row.subject_id) continue;
    const requestId = row.subject_type === "ATTACHMENT" ? ownerOf.get(row.subject_id) : row.subject_id;
    const number = requestId ? numberOf.get(requestId) : undefined;
    if (number) byRow.set(row.id, number);
  }
  return byRow;
}

/**
 * สำเนาในนี้สร้างด้วยกุญแจและรูปเอกสารเดียวกับตอนนี้ไหม — ไม่มีค่าบันทึกไว้ (volume ใหม่, หลัง rebuild) ก็บันทึกค่าปัจจุบัน
 *
 * กุญแจเปลี่ยน = `cid#`/`email#` ของเอกสารเดิมหาด้วยกุญแจใหม่ไม่เจอ รูปเอกสารเปลี่ยน = เอกสารเดิมไม่มีฟิลด์ใหม่ ทั้งสอง
 * แบบ relay แก้เองไม่ได้ (`$setOnInsert` ไม่แตะเอกสารเดิม และการลบทั้งหมดแล้วเติมใหม่ทำให้แถวที่ seed:demo ลบจาก Postgres
 * ไปแล้วหายถาวร — คนต้องตัดสิน) จึงเตือนและเก็บเป็น error ครั้งเดียวต่อ process จนกว่าจะ rebuild ซึ่ง `$unset` สองค่านี้
 * แล้วรอบถัดไปบันทึกค่าปัจจุบันเอง ไม่ต้องเริ่ม worker ใหม่
 */
async function checkIdentity(relay: Collection<RelayStateDoc>, state: RelayStateDoc | null): Promise<void> {
  const fp = hashKeyFingerprint(env.logStore.hashKey);
  const set: Partial<RelayStateDoc> = {};
  if (state?.hashKeyFp === undefined) set.hashKeyFp = fp;
  else if (state.hashKeyFp !== fp && !warnedHashKey) {
    warnedHashKey = true;
    const message =
      `LOG_HASH_KEY ไม่ใช่ตัวที่ใช้สร้างสำเนานี้ (${state.hashKeyFp} → ${fp}) — key ค้นหา cid#/email# ของเอกสารเดิม` +
      "หาไม่เจอด้วยกุญแจใหม่ ต้อง rebuild สำเนา (docs/21 runbook)";
    console.warn(`[log-relay] ${message}`);
    captureError(new Error(message), { level: "error", tag: "log-relay.hash-key", fingerprint: "log-relay:hash-key-changed" });
  }
  if (state?.schemaVersion === undefined) set.schemaVersion = SCHEMA_VERSION;
  else if (state.schemaVersion !== SCHEMA_VERSION && !warnedSchema) {
    warnedSchema = true;
    const message =
      `รูปเอกสาร activity เปลี่ยนจากรุ่น ${state.schemaVersion} เป็น ${SCHEMA_VERSION} — เอกสารเดิมยังเป็นรูปเก่า ` +
      "ต้อง rebuild สำเนา (docs/21 runbook)";
    console.warn(`[log-relay] ${message}`);
    captureError(new Error(message), { level: "warning", tag: "log-relay.schema", fingerprint: "log-relay:schema-changed" });
  }
  if (Object.keys(set).length > 0) {
    await relay.updateOne({ _id: STATE_ID }, { $set: set }, { upsert: true, maxTimeMS: MONGO_MS });
  }
}

async function noteError(err: unknown) {
  try {
    const db = await logDb();
    await db
      ?.collection<RelayStateDoc>("relay_state")
      .updateOne(
        { _id: STATE_ID },
        { $set: { lastRunAt: new Date(), lastError: errorName(err) } },
        { upsert: true, maxTimeMS: MONGO_MS },
      );
  } catch {
    // Mongo เองที่ล้ม — ไม่มีที่ให้จด บรรทัดใน stdout กับ error ที่เก็บไว้พอแล้ว
  }
}

// --------------------------------------------------------------------------------------------- งานดูแล

async function maintenanceTick(): Promise<void> {
  const client = prisma;
  if (!client) return;
  try {
    const db = await logDb();
    if (!db) return;
    const relay = db.collection<RelayStateDoc>("relay_state");
    const state = await relay.findOne({ _id: STATE_ID }, { maxTimeMS: MONGO_MS });
    const now = new Date();
    const lastPruneAt = pastDate(state?.lastPruneAt, "lastPruneAt", now);

    if (pruneDue(lastPruneAt, now)) await runPrune(db, relay, state, now);

    const lastReconcile = pastDate(state?.lastReconcileAt, "lastReconcileAt", now)?.getTime() ?? 0;
    const caughtUpAt = pastDate(state?.caughtUpAt, "caughtUpAt", now)?.getTime() ?? 0;
    /**
     * reconcile เฉพาะเมื่อ forward pass ตามทันจริงนับจากการเริ่มใหม่ครั้งล่าสุด — `caughtUpAt` ถูกล้างตอน relay เริ่มจากแถวแรก
     * และตอน rebuild ลบครบ แล้วเขียนใหม่เมื่ออ่านจนสุดเท่านั้น (`markCaughtUp`) · มี `rebuildRequestedAt` = สำเนากำลังถูกลบ
     * (`rebuildTick`) ตัวนับของ Mongo ไม่มีความหมาย · ไม่มี cursor = สำเนากำลังจะเริ่มใหม่ ไม่ใช่ครบ (ช่องระหว่าง `$unset`
     * cursor ด้วยมือถึงรอบ relay ถัดไป — rebuild แบบคำสั่งเดียวไม่มีช่องนี้ เพราะล้าง cursor กับ `caughtUpAt` พร้อมกัน)
     */
    const hasCursor = state?.cursor !== undefined && state.cursor !== null;
    const rebuildPending = state?.rebuildRequestedAt !== undefined && state.rebuildRequestedAt !== null;
    if (
      hasCursor &&
      !rebuildPending &&
      now.getTime() - lastReconcile >= RECONCILE_EVERY_MS &&
      now.getTime() - caughtUpAt <= CAUGHT_UP_FRESH_MS
    ) {
      const summary = await reconcile(db, client, now);
      await relay.updateOne(
        { _id: STATE_ID },
        { $set: { lastReconcileAt: now, lastReconcile: summary } },
        { upsert: true, maxTimeMS: MONGO_MS },
      );
      if (summary.inserted > 0) {
        console.warn(
          `[log-relay] reconcile: สำเนาขาดไป ${summary.inserted} แถวในช่วง 24 ชั่วโมงล่าสุด — เติมแล้ว ` +
            `(Postgres ${summary.postgres}, Mongo ก่อนเติม ${summary.mongo})`,
        );
        captureThrottled(
          "log-relay.reconcile",
          new Error(`reconcile เติมแถวที่ relay พลาดไป ${summary.inserted} แถว`),
          "warning",
        );
      }
    }
  } catch (err) {
    captureThrottled("log-relay.maintenance", err);
  }
}

/**
 * เวลาที่อ่านจาก relay_state — ไม่ใช่ Date หรืออยู่ในอนาคตเกิน FUTURE_TOLERANCE_MS ถือว่าไม่มี (แล้วเก็บเป็น error ให้เห็น)
 *
 * เหตุผลเดียวกับ `cursorFrom` (ชั้นที่สองหลังสิทธิ์ของ role: เดิม `bdi_backend` insert relay_state ได้ตอนที่เอกสารยังไม่มี)
 * `lastPruneAt` ปลอมในอนาคตทำให้ `pruneDue()` ตอบ false ไปจนกว่านาฬิกาจะถึง — การลบตามอายุ (PDPA) หยุดเงียบ ๆ และ
 * `lastReconcileAt` ปลอมก็หยุด reconcile แบบเดียวกัน ค่าที่ไม่ใช่ Date เลย (ข้อความ ตัวเลข) เดิมทำให้ `getTime()` throw
 * ทุกนาที งานดูแลทั้งรอบจึงไม่เคยวิ่ง (ตรวจขั้น 6, 2026-09-30) ถือว่าไม่มีแล้ว prune วิ่งทันที (ลบซ้ำได้ไม่เสียหาย)
 * และรอบถัดไปเขียนค่าจริงทับ
 */
function pastDate(value: unknown, field: string, now: Date): Date | null {
  if (value === undefined || value === null) return null;
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    reportBadState(field, `${field} ใน relay_state ไม่ใช่วันเวลา — ถือว่าไม่มี`);
    return null;
  }
  if (value.getTime() > now.getTime() + FUTURE_TOLERANCE_MS) {
    reportBadState(field, `${field} ใน relay_state อยู่ในอนาคต (${value.toISOString()}) — ถือว่าไม่มี`);
    return null;
  }
  return value;
}

/** tag แยกต่อฟิลด์ — ฟิลด์ปลอมสองตัวในรอบเดียวกันต้องได้ issue ทั้งสองตัว ไม่ใช่ตัวแรกแล้วตัวที่สองติด throttle สิบนาที */
function reportBadState(field: string, message: string) {
  console.warn(`[log-relay] ${message}`);
  captureThrottled(`log-relay.state.${field}`, new Error(message), "error");
}

/** prune ครบกำหนดเมื่อยังไม่เคยทำ หรือทำครั้งล่าสุดก่อน 03:00 น. (เวลาไทย) ล่าสุดที่ผ่านมาแล้ว */
export function pruneDue(lastPruneAt: Date | null, now: Date): boolean {
  if (!lastPruneAt) return true;
  const boundary = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), PRUNE_HOUR_UTC));
  if (boundary.getTime() > now.getTime()) boundary.setUTCDate(boundary.getUTCDate() - 1);
  return lastPruneAt.getTime() < boundary.getTime();
}

export interface PruneSummary {
  activityDeleted: number;
  activityStripped: number;
  errorEventsDeleted: number;
  runtimeEventsDeleted: number;
  issuesDeleted: number;
  complete: boolean;
}

const PRUNE_COUNTS = [
  "activityDeleted",
  "activityStripped",
  "errorEventsDeleted",
  "runtimeEventsDeleted",
  "issuesDeleted",
] as const;

export function emptyPruneSummary(): PruneSummary {
  return {
    activityDeleted: 0,
    activityStripped: 0,
    errorEventsDeleted: 0,
    runtimeEventsDeleted: 0,
    issuesDeleted: 0,
    complete: true,
  };
}

/**
 * prune หนึ่งรอบของงานดูแล แล้วจดผล — `relay_state.lastPrune` เป็น**ยอดของการ prune ทั้งครั้ง** ตั้งแต่รอบแรกจนรอบที่จบ ไม่ใช่
 * แค่รอบสุดท้าย และทุกรอบที่ทำอะไรได้พิมพ์บรรทัดของรอบนั้น
 *
 * การ prune ครั้งหนึ่งกินหลายรอบได้สองทาง: ค้างมากเกิน PRUNE_CHUNKS_MAX (`complete: false`) หรือล้มกลางรอบ — Mongo ที่หยุดตอบ
 * ราวสองวินาทีขึ้นไปทำให้ monitor ของ driver ตัด `deleteMany` ที่ค้างอยู่ (`PoolClearedOnNetworkError`, ดู MONGO_MS) เดิมรอบที่
 * ล้มทิ้งตัวเลขทั้งรอบ: ตรวจแบบค้าน 2026-10-01 หยุด mongo 3.4 วินาทีกลางรอบ เอกสาร auth ที่ลบไปแล้ว 12,000 ใบไม่ปรากฏที่ไหนเลย
 * รอบที่ลองใหม่จด `activityDeleted: 0` และพิมพ์ "ลบ activity 0" ตอนนี้ตัวเลขนับทีละก้อน (`inChunks`) รอบที่ล้มพิมพ์ส่วนที่ทำไปแล้ว
 * พร้อมชื่อ error จดลง `lastPrune` ถ้า Mongo กลับมาทัน (`error`, `complete: false`) แล้ว throw ต่อให้ `maintenanceTick` เก็บ
 * รอบถัดไปเห็น `complete: false` จึงบวกต่อจากยอดเดิม (`startedAt` ของครั้งนั้นคงไว้) ก้อนที่ล้ม**กลางคำสั่ง**ไม่ถูกนับ: server อาจ
 * ลบไปแล้วบางส่วนหรือทั้งหมด แต่ไม่มีใครบอกจำนวน — ยอดรวมจึงต่ำกว่าจริงได้ไม่เกินหนึ่งก้อน (5,000) ต่อครั้งที่ล้ม
 * ลองหลังแก้ 2026-10-01: `killOp` ก้อนที่สามของ 40,000 → รอบนั้นพิมพ์และจด 10,000 (`complete: false`) รอบถัดไปรวมเป็น 38,880
 * (ก้อนที่ถูกฆ่าลบไป 1,120 ก่อนหยุด) · หยุด mongo ให้ monitor ล้าง pool กลาง prune 150,000 → "หยุดกลางคัน:
 * PoolClearedOnNetworkError" 5,000 แล้วรอบถัดไปรวมเป็น 147,330 `startedAt` เป็นของรอบที่ล้ม
 */
async function runPrune(db: Db, relay: Collection<RelayStateDoc>, state: RelayStateDoc | null, now: Date): Promise<void> {
  const tick = emptyPruneSummary();
  let failure: unknown = null;
  try {
    await pruneLogStore(db, now, tick);
  } catch (err) {
    failure = err;
    tick.complete = false;
  }
  const carried = unfinishedPrune(state?.lastPrune);
  const record: Record<string, unknown> = { at: now, startedAt: carried?.startedAt ?? now, complete: tick.complete };
  for (const key of PRUNE_COUNTS) record[key] = (carried?.counts[key] ?? 0) + tick[key];
  if (failure) record.error = errorName(failure);

  const done = PRUNE_COUNTS.reduce((sum, key) => sum + tick[key], 0);
  if (done > 0 || failure) {
    const line =
      `[log-relay] prune ตามอายุ: ลบ activity ${tick.activityDeleted} · ตัด IP/UA ${tick.activityStripped} · ` +
      `ลบ error_events ${tick.errorEventsDeleted} · runtime_events ${tick.runtimeEventsDeleted} · ` +
      `error_issues ${tick.issuesDeleted}` +
      (failure
        ? ` (หยุดกลางคัน: ${errorName(failure)} — ตัวเลขนี้คือส่วนที่ทำไปแล้ว รอบหน้าทำต่อ)`
        : tick.complete
          ? ""
          : " (ยังไม่หมด ทำต่อรอบหน้า)");
    if (failure) console.warn(line);
    else console.log(line);
  }
  try {
    await relay.updateOne(
      { _id: STATE_ID },
      // ไม่จบ (ค้างมาก หรือล้มกลางคัน) — ไม่เลื่อน lastPruneAt รอบถัดไปในหนึ่งนาทีทำต่อ
      { $set: { lastPrune: record, ...(tick.complete ? { lastPruneAt: now } : {}) } },
      { upsert: true, maxTimeMS: MONGO_MS },
    );
  } catch (err) {
    if (!failure) throw err;
    // Mongo ยังไม่กลับ — ตัวเลขของรอบนี้อยู่ในบรรทัดข้างบนแล้ว error ที่ส่งต่อคือตัวที่ทำให้ prune ล้ม
  }
  if (failure) throw failure;
}

/** `lastPrune` ของการ prune ที่ยังไม่จบ (`complete: false`) — ยอดที่รอบนี้ต้องบวกต่อ ค่าที่ผิดรูปนับเป็นศูนย์ ไม่มี/จบแล้ว = null */
function unfinishedPrune(
  value: unknown,
): { startedAt: Date; counts: Record<(typeof PRUNE_COUNTS)[number], number> } | null {
  if (value === null || typeof value !== "object") return null;
  const last = value as Record<string, unknown>;
  if (last.complete !== false) return null;
  const counts = {} as Record<(typeof PRUNE_COUNTS)[number], number>;
  for (const key of PRUNE_COUNTS) {
    const n = last[key];
    counts[key] = typeof n === "number" && Number.isSafeInteger(n) && n >= 0 ? n : 0;
  }
  const started = last.startedAt instanceof Date ? last.startedAt : last.at instanceof Date ? last.at : null;
  return { startedAt: started && !Number.isNaN(started.getTime()) ? started : new Date(), counts };
}

function daysBefore(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60_000);
}

/** หมวดของ activity จัดกลุ่มตามจำนวนวัน — คำสั่งเดียวต่อกลุ่ม ไม่ใช่ต่อหมวด */
function groupByDays(pick: (category: ActivityCategory) => number | null): Map<number, ActivityCategory[]> {
  const groups = new Map<number, ActivityCategory[]>();
  for (const category of Object.keys(ACTIVITY_RETENTION) as ActivityCategory[]) {
    const days = pick(category);
    if (days === null) continue;
    groups.set(days, [...(groups.get(days) ?? []), category]);
  }
  return groups;
}

/**
 * ลบและตัดตามอายุ (lib/log-retention.ts) ณ เวลา `now` — export ไว้ให้ทดสอบด้วยนาฬิกาที่เลื่อนได้
 *
 * ทั้งการลบและการตัด IP/UA ทำทีละก้อน 5,000 ด้วย `_id` (`inChunks`) ไม่ใช่ `deleteMany` / `updateMany` ครั้งเดียวทั้งก้อน —
 * เดิมการตัด IP/UA เป็น `updateMany` คำสั่งเดียว ซึ่งวันแรกที่แถวอายุครบปี (หรือหลัง rebuild) คือทั้งปีในคำสั่งเดียว เกิน
 * socketTimeoutMS ของ driver แน่นอน IP/UA ถูก `$unset` ไม่ใช่ตั้งเป็น null — เอกสารที่ตัดแล้วไม่ตรงเงื่อนไข `$exists` อีก
 * ก้อนถัดไปและรอบถัดไปจึงไม่แตะซ้ำ
 *
 * ตัวเลขลง `summary` ของผู้เรียก**ทีละก้อน**ทันทีที่ก้อนนั้นสำเร็จ ไม่ใช่ตอนจบ — ถ้า throw กลางทาง ผู้เรียกยังเห็นส่วนที่ทำไปแล้ว
 * (`runPrune`)
 */
export async function pruneLogStore(db: Db, now: Date, summary: PruneSummary = emptyPruneSummary()): Promise<PruneSummary> {
  const activity = db.collection("activity") as unknown as ActivityCollection;
  const done = (complete: boolean) => {
    if (!complete) summary.complete = false;
  };

  for (const [days, categories] of groupByDays((c) => ACTIVITY_RETENTION[c].deleteAfterDays)) {
    done(
      await deleteInChunks(
        activity,
        { category: { $in: categories }, occurredAt: { $lt: daysBefore(now, days) } },
        (n) => (summary.activityDeleted += n),
      ),
    );
  }
  // ตัด IP/UA ทีละก้อนเหมือนการลบ — เอกสารที่ตัดแล้วไม่ตรง `$exists` อีก ก้อนถัดไปจึงเป็นเอกสารชุดใหม่เสมอ
  for (const [days, categories] of groupByDays((c) => ACTIVITY_RETENTION[c].stripClientAfterDays)) {
    done(
      await inChunks(
        activity,
        {
          category: { $in: categories },
          occurredAt: { $lt: daysBefore(now, days) },
          $or: [{ "request.ip": { $exists: true } }, { "request.userAgent": { $exists: true } }],
        },
        async (ids) =>
          (
            await activity.updateMany(
              { _id: { $in: ids } },
              { $unset: { "request.ip": "", "request.userAgent": "" } },
              { maxTimeMS: MONGO_MS },
            )
          ).modifiedCount,
        (n) => (summary.activityStripped += n),
      ),
    );
  }
  // บันทึกการเรียก admin API ที่ token ไม่ผ่าน — อายุสั้นกว่าหมวดของมัน (lib/log-retention.ts ANONYMOUS_ADMIN_ACCESS_DAYS)
  // `source: "http"` ต้องอยู่ด้วย: แถว `ADMIN_TOKEN_REJECTED` ที่ relay คัดลอกจาก Postgres ก็หมวด `admin-access` และ `ANONYMOUS`
  // แต่ถือ 400 วันตามหมวด · `category` นำหน้าให้ใช้ index `{category, result, occurredAt}`
  done(
    await deleteInChunks(
      activity,
      {
        category: "admin-access",
        source: "http",
        via: "ANONYMOUS",
        occurredAt: { $lt: daysBefore(now, ANONYMOUS_ADMIN_ACCESS_DAYS) },
      },
      (n) => (summary.activityDeleted += n),
    ),
  );

  const errors = db.collection("error_events") as unknown as ActivityCollection;
  const errorEvents = (n: number) => (summary.errorEventsDeleted += n);
  done(
    await deleteInChunks(
      errors,
      { service: { $ne: "browser" }, occurredAt: { $lt: daysBefore(now, ERROR_EVENT_DAYS) } },
      errorEvents,
    ),
  );
  done(
    await deleteInChunks(errors, { service: "browser", occurredAt: { $lt: daysBefore(now, BROWSER_EVENT_DAYS) } }, errorEvents),
  );
  done(
    await deleteInChunks(
      db.collection("runtime_events") as unknown as ActivityCollection,
      { at: { $lt: daysBefore(now, RUNTIME_EVENT_DAYS) } },
      (n) => (summary.runtimeEventsDeleted += n),
    ),
  );
  const issues = db.collection("error_issues") as unknown as ActivityCollection;
  const issuesDeleted = (n: number) => (summary.issuesDeleted += n);
  done(
    await deleteInChunks(
      issues,
      { status: { $ne: "open" }, lastSeen: { $lt: daysBefore(now, CLOSED_ISSUE_DAYS) } },
      issuesDeleted,
    ),
  );
  // issue เบราว์เซอร์ที่ยังเปิดแต่ไม่เกิดอีก — ใครก็สร้างได้ จึงมีอายุเท่า event ของมัน (lib/log-retention.ts)
  done(
    await deleteInChunks(
      issues,
      { service: "browser", status: "open", lastSeen: { $lt: daysBefore(now, OPEN_BROWSER_ISSUE_DAYS) } },
      issuesDeleted,
    ),
  );
  return summary;
}

function deleteInChunks(
  collection: ActivityCollection,
  filter: Filter<{ _id: string; [key: string]: unknown }>,
  add: (count: number) => void,
): Promise<boolean> {
  return inChunks(
    collection,
    filter,
    async (ids) => (await collection.deleteMany({ _id: { $in: ids } }, { maxTimeMS: MONGO_MS })).deletedCount,
    add,
  );
}

/**
 * ทำ `apply` กับเอกสารที่ตรง `filter` ทีละ PRUNE_CHUNK ตัว (หา id ก่อน แล้วสั่งด้วย `_id`) ไม่เกิน PRUNE_CHUNKS_MAX ก้อน —
 * ส่งจำนวนที่ `apply` นับได้ให้ `add` ทีละก้อน และคืน false ถ้ายังเหลือ (รอบหน้าทำต่อ) `apply` ต้องทำให้เอกสารที่ทำแล้วไม่ตรง
 * `filter` อีก (ลบ หรือ `$unset` ฟิลด์ที่ filter ถามหา) ไม่งั้นก้อนถัดไปได้ id ชุดเดิม
 *
 * ไม่ใช่คำสั่งเดียวทั้งก้อน: คำสั่งเดียวที่แตะเป็นแสนใช้เวลาเกิน socketTimeoutMS ของ driver แล้ว server ยังทำต่อเบื้องหลังขณะที่
 * worker คิดว่าล้ม ก้อนเล็กจบในเวลาและนับได้จริง
 */
async function inChunks(
  collection: ActivityCollection,
  filter: Filter<{ _id: string; [key: string]: unknown }>,
  apply: (ids: string[]) => Promise<number>,
  add: (count: number) => void,
): Promise<boolean> {
  for (let chunk = 0; chunk < PRUNE_CHUNKS_MAX && !stopped; chunk++) {
    const found = await collection
      .find(filter, { projection: { _id: 1 }, limit: PRUNE_CHUNK, maxTimeMS: MONGO_MS })
      .toArray();
    if (found.length === 0) return true;
    add(await apply(found.map((doc) => doc._id)));
    if (found.length < PRUNE_CHUNK) return true;
  }
  return false;
}

interface ReconcileSummary {
  from: Date;
  to: Date;
  postgres: number;
  mongo: number;
  inserted: number;
  [key: string]: unknown;
}

/**
 * นับแถวของ 24 ชั่วโมงที่จบเมื่อสองนาทีก่อน (TAIL_WINDOW_MS) ทั้งสองฝั่ง ไม่เท่ากันแล้วอ่านช่วงนั้นซ้ำ (แถวที่มีแล้วถูกข้าม)
 *
 * ขอบบนอยู่ที่ `now − TAIL_WINDOW_MS` ไม่ใช่ `now − SETTLE_MS`: แถวที่อายุไม่ถึงสองนาทียังเป็นของ tail pass ซึ่งอ่านมันซ้ำทุกรอบ
 * relay และ relay วิ่งทุกราว 5 วินาที แถวที่เกิดหลังการอ่านครั้งล่าสุดของ relay จึงยังไม่มีสำเนาเป็นปกติ เดิมขอบบนอยู่ที่
 * `now − 2 วินาที` reconcile นับแถวพวกนั้นว่าขาด เติมเอง แล้วพิมพ์ "สำเนาขาดไป N แถว" กับเก็บ warning ว่า relay พลาด ทั้งที่
 * relay ไม่ได้พลาดอะไร — ราวครึ่งหนึ่งของจังหวะระหว่างสองลูปเมื่อมีแถวเข้ามาตลอด (ตรวจแบบค้านขั้น 7, 2026-09-30: เติม 10 แถว
 * อายุ 3–4 วินาทีที่ relay รอบถัดไปจะเก็บเอง) คำเตือนที่ดังทุกชั่วโมงกลบกรณีจริงที่ reconcile มีไว้จับ ส่วนแถวที่ relay พลาดจริง
 * (commit หลัง tail pass ผ่านเวลาของมันไปแล้ว — transaction ที่เปิดค้างเกินสองนาที) ยังอยู่ในช่วงเสมอ เพราะมันเก่ากว่าขอบบน
 * reconcile วิ่งเฉพาะเมื่อ forward pass ตามทันในนาทีที่ผ่านมา (CAUGHT_UP_FRESH_MS) แถวที่เก่ากว่าสองนาทีจึงผ่าน relay มาแล้ว
 *
 * ขอบของช่วงปัดลงเป็นวินาทีเต็ม และเป็นช่วงครึ่งเปิด `[from, to)` ทั้งสองฝั่ง — Postgres เก็บไมโครวินาที Mongo เก็บ
 * มิลลิวินาที ขอบที่ไม่ลงตัวทำให้แถวที่ขอบถูกนับฝั่งเดียวแล้วดูเหมือนขาดทุกชั่วโมง
 */
async function reconcile(db: Db, client: PrismaClient, now: Date): Promise<ReconcileSummary> {
  const to = new Date(Math.floor((now.getTime() - TAIL_WINDOW_MS) / 1_000) * 1_000);
  const from = new Date(to.getTime() - RECONCILE_WINDOW_MS);
  const postgres = await withTimeout(
    client.auditEvent.count({ where: { occurredAt: { gte: from, lt: to } } }),
    PG_TIMEOUT_MS,
    "นับ audit_event",
  );
  const activity = db.collection("activity") as unknown as ActivityCollection;
  const mongo = await activity.countDocuments(
    { source: "audit_event", occurredAt: { $gte: from, $lt: to } },
    { maxTimeMS: MONGO_MS },
  );
  let inserted = 0;
  if (mongo !== postgres) {
    let cursor = cursorAt(from);
    for (let page = 0; page < RECONCILE_PAGES_MAX && !stopped; page++) {
      const rows = await readPage(client, cursor, { at: to, inclusive: false });
      if (rows.length > 0) inserted += await writeRows(db, client, rows);
      if (rows.length < PAGE_SIZE) break;
      cursor = cursorOfRow(rows[rows.length - 1]!);
    }
  }
  return { from, to, postgres, mongo, inserted };
}

// --------------------------------------------------------------------------------------------- ตัวช่วย

/** ข้อความที่ไม่ว่างใต้ `key` ของ object JSON — ไม่ใช่ object หรือไม่ใช่ข้อความได้ null */
function stringField(value: unknown, key: string): string | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" && field.length > 0 ? field : null;
}

function errorName(err: unknown): string {
  if (!(err instanceof Error)) return "Error";
  const code = (err as { codeName?: unknown; code?: unknown }).codeName ?? (err as { code?: unknown }).code;
  return `${err.name}${typeof code === "string" || typeof code === "number" ? ` ${code}` : ""}`;
}

/** เก็บความล้มเหลวของงานนี้ไม่เกินครั้งละสิบนาทีต่อ tag — Mongo หรือ Postgres ที่ล่มนานต้องไม่ได้ issue ใหม่ทุก 5 วินาที */
function captureThrottled(tag: string, err: unknown, level: "warning" | "error" = "warning") {
  const now = Date.now();
  if (now - (lastCaptured.get(tag) ?? 0) < CAPTURE_EVERY_MS) return;
  lastCaptured.set(tag, now);
  captureError(err, { level, tag });
}

/**
 * เหมือน `work` แต่ล้มถ้าไม่จบใน `ms` — เลิก**รอ** ไม่ได้ยกเลิก: คำสั่งของ Prisma ที่ค้างยังวิ่งต่อใน Postgres และถือ
 * connection ของ pool ไว้จนจบ (เป็นการอ่านอย่างเดียว ไม่เสียข้อมูล) ระหว่างนั้นรอบถัดไปของลูปเดียวกันเริ่มคำสั่งใหม่ได้อีก
 * ตัว — Postgres ที่ช้าจนถึงเพดานนี้ทำให้ relay ถือ connection ได้มากกว่าหนึ่งตัวต่อลูป (ราวหนึ่งตัวต่อ 20 วินาทีที่ช้า)
 * จนกว่าคำสั่งที่ค้างจะจบ pool นั้นใช้ร่วมกับลูปส่งอีเมล (workers/delivery.ts)
 */
function withTimeout<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let handle: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    handle = setTimeout(() => reject(new Error(`${what} เกิน ${ms / 1000} วินาที`)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(handle));
}

/** รอ `work` ไม่เกิน `ms` แล้วคืนค่าเสมอ — ไม่ reject */
function settleWithin(work: Promise<unknown>, ms: number): Promise<void> {
  let handle: NodeJS.Timeout | undefined;
  const deadline = new Promise<void>((resolve) => {
    handle = setTimeout(resolve, ms);
  });
  return Promise.race([work.then(() => undefined, () => undefined), deadline]).finally(() => clearTimeout(handle));
}
