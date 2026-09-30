/**
 * relay — คัดลอกแถวที่ Postgres commit แล้วจาก `audit.audit_event` ไปเป็นเอกสาร `activity` ใน log store
 * (plan §3 "Write paths", decision 2) พร้อมงานดูแลที่ผูกกับมัน: reconcile รายชั่วโมง
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
 * **reconcile** ทุกชั่วโมงเมื่อ forward pass ตามทันแล้ว — นับแถวของ 24 ชั่วโมงล่าสุดในทั้งสองฝั่ง ไม่เท่ากันแล้วอ่านช่วงนั้น
 * ซ้ำ (แถวที่มีแล้วถูกข้าม) Mongo มากกว่าเป็นเรื่องปกติหลัง `seed:demo` ลบ Postgres — ยังอ่านซ้ำด้วย เพราะแถวที่ขาดไป
 * ซ่อนอยู่หลังตัวนับที่เกินได้ ผลอยู่ใน `relay_state.lastReconcile`
 *
 * **rebuild** (รูปเอกสารเปลี่ยน หรือเปลี่ยน LOG_HASH_KEY) ทำด้วยมือ — ลบ `activity` ที่ `source: "audit_event"` แล้ว
 * `$unset` `cursor` `hashKeyFp` `schemaVersion` ใน relay_state relay เติมใหม่ตั้งแต่แถวแรก (docs/21 runbook) ข้อจำกัด:
 * แถวที่ `seed:demo` ลบจาก Postgres ไปแล้วหายจากสำเนาถาวร, เอกสาร `audit_fallback`/`http` ไม่ถูกสร้างใหม่ (ไม่มีใน
 * Postgres)
 */
import { AttachmentOwnerType, Prisma, type PrismaClient } from "@prisma/client";
import type { AnyBulkWriteOperation, Collection, Db } from "mongodb";

import { env } from "../env.js";
import {
  SCHEMA_VERSION,
  categoryOf,
  hashKeyFingerprint,
  projectAuditRow,
  type ActivityDoc,
  type AuditRowLike,
} from "../lib/activity-shape.js";
import { referenceOf } from "../lib/context.js";
import { DOCUMENT_REJECTED, captureError, perDocumentErrors } from "../lib/error-capture.js";
import { logDb } from "../lib/log-store.js";

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

const PG_TIMEOUT_MS = 15_000;
const MONGO_READ_MS = 5_000;
const MONGO_WRITE_MS = 60_000;
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
  /** fingerprint ของ LOG_HASH_KEY ที่สำเนานี้ใช้ — `hashKeyFingerprint()` */
  hashKeyFp?: string;
  schemaVersion?: number;
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
    const state = await relay.findOne({ _id: STATE_ID }, { maxTimeMS: MONGO_READ_MS });
    await checkIdentity(relay, state);

    const started = new Date();
    const upper = new Date(started.getTime() - SETTLE_MS);
    let cursor = cursorFrom(state);
    let inserted = 0;
    let caughtUp = false;
    for (let page = 0; page < FORWARD_PAGES_MAX && !stopped; page++) {
      const rows = await readPage(client, cursor, { at: upper, inclusive: true });
      if (rows.length > 0) {
        inserted += await writeRows(db, client, rows);
        cursor = cursorOfRow(rows[rows.length - 1]!);
        await relay.updateOne({ _id: STATE_ID }, { $set: { cursor } }, { upsert: true, maxTimeMS: MONGO_READ_MS });
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
      {
        $set: {
          lastRunAt: new Date(),
          lastBatch: inserted,
          lastError: null,
          ...(caughtUp ? { caughtUpAt: started } : {}),
        },
      },
      { upsert: true, maxTimeMS: MONGO_READ_MS },
    );

    if (failing) {
      failing = false;
      console.log("[log-relay] คัดลอก audit_event ลง log store ได้อีกครั้ง — ตามต่อจาก cursor เดิม ไม่มีแถวหาย");
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
      console.warn(`[log-relay] คัดลอกไม่สำเร็จ (${errorName(err)}) — ลองใหม่ทุก 5 วินาที ตามต่อจาก cursor เดิม`);
    }
    captureThrottled("log-relay.tick", err);
    await noteError(err);
  }
}

/**
 * cursor ที่บันทึกไว้ — ไม่มี (volume ใหม่, หลัง rebuild) หรือรูปผิดเริ่มจากแถวแรก
 *
 * cursor ที่อยู่ในอนาคตถือว่าเสียด้วย: forward pass จะข้ามทุกแถวจนกว่านาฬิกาจะไปถึง `bdi_backend` มีสิทธิ์ insert ทุก
 * collection รวม relay_state (plan decision 8) backend ที่ถูกยึดจึงวาง cursor ปลอมได้ตอนที่เอกสารนี้ยังไม่มี (volume
 * ใหม่ หรือหลัง rebuild) แล้ว backfill ของแถวเก่าทั้งหมดจะไม่เกิด — แถวใหม่ยังรอดเพราะ tail pass กับ reconcile ไม่ใช้
 * cursor ตัวนี้ cursor แบบนั้นถูกทิ้งแล้วเริ่มจากแถวแรก (upsert ซ้ำได้ ราคาแค่การอ่านทั้งตาราง) และเก็บเป็น error ไว้ให้เห็น
 * ตรวจที่ `exact` เพราะเป็นตัวที่ใช้เทียบจริง ไม่ใช่ `at` ที่มีไว้ให้คนอ่าน
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
    .find({ _id: { $in: rows.map((row) => row.id) } }, { projection: { _id: 1 }, maxTimeMS: MONGO_READ_MS })
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
    const result = await activity.bulkWrite(operations, { ordered: false, maxTimeMS: MONGO_WRITE_MS });
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
 * แถวที่ไม่เจอ (คำขอถูกลบไปแล้ว: `REQUEST_DELETED`) ใช้ `metadata.request_number` แทนใน projectAuditRow
 * ไฟล์แนบของชุดข้อมูลที่อนุมัติแล้ว (`DATASET`) และไฟล์ของเอกสารกฎหมายไม่ได้เลขที่คำขอ
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
    await relay.updateOne({ _id: STATE_ID }, { $set: set }, { upsert: true, maxTimeMS: MONGO_READ_MS });
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
        { upsert: true, maxTimeMS: MONGO_READ_MS },
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
    const state = await relay.findOne({ _id: STATE_ID }, { maxTimeMS: MONGO_READ_MS });
    const now = new Date();

    const lastReconcile = state?.lastReconcileAt?.getTime() ?? 0;
    const caughtUpAt = state?.caughtUpAt?.getTime() ?? 0;
    if (now.getTime() - lastReconcile >= RECONCILE_EVERY_MS && now.getTime() - caughtUpAt <= CAUGHT_UP_FRESH_MS) {
      const summary = await reconcile(db, client, now);
      await relay.updateOne(
        { _id: STATE_ID },
        { $set: { lastReconcileAt: now, lastReconcile: summary } },
        { upsert: true, maxTimeMS: MONGO_READ_MS },
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

interface ReconcileSummary {
  from: Date;
  to: Date;
  postgres: number;
  mongo: number;
  inserted: number;
  [key: string]: unknown;
}

/**
 * นับแถวของ 24 ชั่วโมงล่าสุดทั้งสองฝั่ง ไม่เท่ากันแล้วอ่านช่วงนั้นซ้ำ (แถวที่มีแล้วถูกข้าม)
 *
 * ขอบของช่วงปัดลงเป็นวินาทีเต็ม และเป็นช่วงครึ่งเปิด `[from, to)` ทั้งสองฝั่ง — Postgres เก็บไมโครวินาที Mongo เก็บ
 * มิลลิวินาที ขอบที่ไม่ลงตัวทำให้แถวที่ขอบถูกนับฝั่งเดียวแล้วดูเหมือนขาดทุกชั่วโมง
 */
async function reconcile(db: Db, client: PrismaClient, now: Date): Promise<ReconcileSummary> {
  const to = new Date(Math.floor((now.getTime() - SETTLE_MS) / 1_000) * 1_000);
  const from = new Date(to.getTime() - RECONCILE_WINDOW_MS);
  const postgres = await withTimeout(
    client.auditEvent.count({ where: { occurredAt: { gte: from, lt: to } } }),
    PG_TIMEOUT_MS,
    "นับ audit_event",
  );
  const activity = db.collection("activity") as unknown as ActivityCollection;
  const mongo = await activity.countDocuments(
    { source: "audit_event", occurredAt: { $gte: from, $lt: to } },
    { maxTimeMS: MONGO_READ_MS },
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

/** เหมือน `work` แต่ล้มถ้าไม่จบใน `ms` — คำสั่งของ Prisma ที่ค้างยังวิ่งต่อเบื้องหลังได้ แต่เป็นการอ่านอย่างเดียว */
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
