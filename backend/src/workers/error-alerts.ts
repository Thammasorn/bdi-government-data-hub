/**
 * อีเมลสรุปปัญหาของระบบ (plan §5 "Alerting", step 10) — ลูปของตัวเองใน delivery-worker แยกจากลูปส่งอีเมลของ outbox
 *
 * **ปิดอยู่จนกว่าจะตั้ง `ERROR_ALERT_EMAILS`** (env.ts `logStore.alertEmails`) ปิดอยู่ลูปนี้ไม่เริ่มเลย issue ยังถูกเก็บตามปกติ
 *
 * **อะไรทำให้แจ้ง** (อ่านจาก log store ทุกนาที — `collect`):
 *   1. issue ใหม่ระดับ error ขึ้นไปที่ยังไม่เคยแจ้ง (`new`)
 *   2. issue ที่ปิดแล้วเกิดซ้ำ — `regressedAt` หลังการแจ้งครั้งล่าสุด (`regressed`) ข้ามช่วงพักหกชั่วโมง **เฉพาะ issue ที่
 *      ข้ออื่นจะแจ้งอยู่แล้ว**: ระดับ error ขึ้นไป หรือ `http:5xx:` ที่ต่อเนื่องตามข้อ 4 (5 ตัวใน 15 นาที) — warning ที่เกิดซ้ำ
 *      ไม่แจ้ง เดิมข้อนี้ไม่ดูระดับ ChunkLoadError (`browser:chunk-load` — deploy ใหม่ระหว่างที่หน้าเก่ายังเปิด) ที่ปิดไปแล้ว
 *      จึงได้อีเมล "เกิดซ้ำหลังปิด" เมื่อใครก็ได้ส่งรายงานเดิมมาอีกตัว (ตรวจขั้น 10 แบบค้าน, 2026-10-01)
 *   3. fatal ที่เกิดอีกหลังแจ้งไปแล้ว (`fatal`) และอีเมลที่ส่งไม่สำเร็จครบทุกครั้ง (`delivery:dead-letter:*` — `dead_letter`)
 *   4. 5xx ที่ route ตอบเองต่อเนื่อง — issue ระดับ warning ที่ fingerprint ขึ้นต้น `http:5xx:` มี event ตั้งแต่ 5 ตัวใน 15 นาที
 *      (`sustained_5xx` — 503 `no_reviewer`, `no_legal_documents`, 501 ThaID ไม่ได้ตั้งค่า)
 *   5. วนรีสตาร์ต — ในชั่วโมงที่ผ่านมา service หนึ่งมี `fatal-exit` ตั้งแต่ 2 ครั้ง หรือ `start` ที่ไม่มี `shutdown` ของ service
 *      เดียวกันนำหน้าภายใน 60 วินาที ตั้งแต่ 3 ครั้ง (`crashLoops`) — restart ปกติและการสร้าง container ใหม่ตอน deploy มี
 *      shutdown นำหน้าเสมอ จึงไม่นับ (เทียบ service ไม่ใช่ container: deploy ได้ container ใหม่ ชื่อเครื่องใหม่)
 *   6. log store เกินเพดานขนาด (`relay_state.overQuota`) — ครั้งเดียวต่อครั้งที่เกิน
 *   warning อื่นไม่แจ้งเลย issue ที่ `ignored` ไม่แจ้งไม่ว่าอะไร และสองตัวนี้**ไม่แจ้งด้วยข้อไหนทั้งสิ้น** (`NEVER_ALERT`):
 *   `browser:chunk-load` กับ `http:5xx:…:log_access_disabled` — ตัวหลังคือคนลองเรียก API อ่าน log ที่ปิดไว้ ไม่ใช่ระบบเสีย
 *
 * **อัตรา:** สรุปไม่เกินหนึ่งฉบับต่อ 15 นาที ฉบับละไม่เกิน 20 issue issue หนึ่งแจ้งไม่เกินหนึ่งครั้งต่อหกชั่วโมง เว้นแต่เกิดซ้ำหลัง
 * ปิด วนรีสตาร์ตของ service เดียวกันก็หกชั่วโมง ที่เกิน 20 เหลือไว้ฉบับหน้า (ยังไม่ถูกนับว่าแจ้งแล้ว)
 *
 * **รายงานจากเบราว์เซอร์** (`service: "browser"` — `POST /api/client-errors` ไม่ต้อง login ใครก็ส่งได้ และ IP ที่ใช้นับเพดาน
 * ผู้ส่งเขียนเอง) มีโควตาของตัวเอง: ไม่เกิน 5 issue ต่อหกชั่วโมง**รวมทุกฉบับ** (`BROWSER_ALERTS_PER_WINDOW`) นับจาก
 * `alertedAt` ของ issue เบราว์เซอร์ใน log store เอง — คนที่ส่งข้อความไม่ซ้ำกันไม่หยุดจึงได้ไม่เกินห้าบรรทัดต่อหกชั่วโมง ไม่ใช่
 * สรุปทุก 15 นาทีไปเรื่อย ๆ และอ่านแยกจาก issue ของ server (`collect`) พายุ issue เบราว์เซอร์จึงไม่เบียด error ของ server
 * ออกจากสองร้อยตัวที่อ่านมาพิจารณา **เนื้อความของ issue เบราว์เซอร์ไม่ลงอีเมล** (`browserLines`): หัวเรื่องกับ culprit
 * ของมันคือข้อความที่ผู้ส่งเขียนเอง (ผ่านแค่การกวาดตามรูปแบบ ชื่อกับ URL ยังรอด) อีเมลที่ออกจากระบบถึงผู้ดูแลต้องไม่พาข้อความ
 * ของใครก็ได้ไปด้วย จึงเหลือชื่อ error กับหน้า**เฉพาะที่อยู่ในรูปที่รู้จัก** จำนวน เวลา และ fingerprint ที่เปิดดูเต็มใน E2
 *
 * **ส่งทีละฉบับ ทีละผู้รับ ไม่มีสองการเชื่อมต่อซ้อนกัน** ผ่าน `sendRaw(…, {timeoutMs: 30 วินาที})` — Office 365 รับได้ราวสาม
 * การเชื่อมต่อพร้อมกัน (outbox ใช้ไม่ได้: `recipient_user_id` เป็น NOT NULL และผู้รับพวกนี้ไม่ใช่บัญชีในระบบ) ครบ 30 วินาที
 * lib/mail.ts ปิดการเชื่อมต่อของฉบับนั้นเอง (`sendWithDeadline` — เดิมเป็นแค่ `Promise.race` ที่เลิกรอ การส่งที่ค้างยังถือการ
 * เชื่อมต่อต่อไปได้เป็นนาที) แล้ว**รอบนี้หยุด**: SMTP ที่ช้าจนฉบับหนึ่งเกิน 30 วินาทีน่าจะช้ากับฉบับถัดไปด้วย
 *
 * **ผู้รับที่ยังไม่ได้ฉบับนี้ไม่หายไป** (`pending`): ตัวที่หมดเวลา ตัวที่ยังไม่ถึงคิวตอนรอบหยุด และตัวที่ล้มชั่วคราว (ต่อไม่ได้
 * เงียบเกิน 20 วินาที SMTP ตอบ 4xx) ถูกจดเป็น key ของที่อยู่พร้อมหัวเรื่องกับเนื้อความของฉบับนั้น แล้วได้ฉบับนั้น (หัวเรื่องบอกว่า
 * "ส่งช้า") ก่อนฉบับใหม่ในรอบถัดไป 15 นาทีให้หลัง (`deliverPending`) — ผู้รับที่ค้างจึงได้สองฉบับในรอบนั้นได้ เก็บไม่เกิน 3 ฉบับ
 * ฉบับละไม่เกินหกชั่วโมง ตัวที่ SMTP ปฏิเสธถาวร (ตอบ 5xx: ไม่มีผู้รับนี้ รหัสผ่านผิด) ไม่ถูกเก็บ ส่งซ้ำก็ได้ผลเดิม เดิม issue
 * ของฉบับที่ส่งถึงอย่างน้อยหนึ่งคนถูกนับว่าแจ้งแล้วทั้งชุด ผู้รับที่อยู่หลังตัวที่ค้างจึงไม่ได้ยินเรื่องนั้นเลย ทั้งที่ความเห็นนี้กับ
 * CLAUDE.md เขียนว่า "รอฉบับหน้า" (issue ใหม่ไม่ "ใหม่" อีก และติดช่วงพักหกชั่วโมง — ตรวจแบบค้าน 2026-10-01)
 * ส่งไม่ได้สักคน issue ยังไม่ถูกนับว่าแจ้งแล้ว และไม่มีอะไรถูกเก็บ ฉบับหน้าประกอบใหม่ทั้งชุดหลัง 15 นาที ไม่ใช่ทุกนาที
 *
 * **ไม่มีข้อมูลบุคคลในอีเมล:** หัวเรื่องของ issue ของ server (ข้อความ error ที่ผ่าน lib/redact.ts แล้วตัด id กับตัวเลขทิ้ง), service,
 * ที่เกิด (แม่แบบของ route), จำนวน, เวลา, รุ่น, id ของ event และ fingerprint ที่เปิดดูใน Postman — ไม่มีผู้ใช้ IP อีเมล
 *
 * สถานะของลูปอยู่ในเอกสาร `relay_state` `_id: "error_alerts"` (`enabled`, `recipients`, `checkedAt`, `enabledAt`,
 * `lastDigestAt`, `crashLoopAlertedAt`, `overQuotaAlertedAt`, `lastError`, `pending`) — worker เริ่มใหม่ก็ไม่ส่งซ้ำ และ issue ที่มีอยู่ก่อน
 * เปิดการแจ้งเตือน (เห็นล่าสุดก่อน `enabledAt`) ไม่ถูกแจ้งย้อนหลังทั้งกอง `enabled` กับ `checkedAt` คือคำของ worker เองว่าตอนนี้
 * เปิดอยู่ไหม (`GET /api/admin/logs/status` แสดง) — เปิดอยู่เขียนทุกนาที ปิดอยู่เขียนครั้งเดียวตอนเริ่มพร้อมล้าง `enabledAt`
 * เปิดกลับมาจึงนับใหม่จากตอนนั้น ไม่ใช่แจ้งทุกอย่างที่เกิดระหว่างที่ปิด
 */
import { createHmac, randomBytes } from "node:crypto";

import type { Collection, Db, Document, Filter } from "mongodb";

import { env } from "../env.js";
import { captureError } from "../lib/error-capture.js";
import { MONGO_COMMAND_MAX_MS, logDb } from "../lib/log-store.js";
import { SendDeadlineError, sendRaw } from "../lib/mail.js";

const STATE_ID = "error_alerts";
const FIRST_TICK_MS = 30_000;
const TICK_MS = 60_000;
const DIGEST_EVERY_MS = 15 * 60_000;
const ISSUE_COOLDOWN_MS = 6 * 60 * 60_000;
const ISSUES_PER_DIGEST = 20;
/** issue จากเบราว์เซอร์ที่แจ้งได้ต่อหกชั่วโมง รวมทุกฉบับ (หัวไฟล์ "รายงานจากเบราว์เซอร์") */
const BROWSER_ALERTS_PER_WINDOW = 5;
const BROWSER_WINDOW_MS = 6 * 60 * 60_000;
const SEND_TIMEOUT_MS = 30_000;
/** ฉบับที่ยังส่งไม่ถึงผู้รับบางคน เก็บไว้ส่งซ้ำไม่เกินเท่านี้ฉบับ ฉบับละไม่เกินหกชั่วโมง (หัวไฟล์ "ผู้รับที่ยังไม่ได้ฉบับนี้") */
const PENDING_MAX = 3;
const PENDING_MAX_AGE_MS = 6 * 60 * 60_000;
/** เนื้อความที่เก็บไว้ส่งซ้ำยาวไม่เกินนี้ — ฉบับจริงยี่สิบ issue ราว 15 KB เอกสารของ relay_state ต้องไม่โตไม่รู้จบ */
const PENDING_BODY_MAX = 32_000;
const SUSTAINED_WINDOW_MS = 15 * 60_000;
const SUSTAINED_MIN_EVENTS = 5;
const CRASH_WINDOW_MS = 60 * 60_000;
const CRASH_FATAL_EXITS = 2;
const CRASH_UNEXPLAINED_STARTS = 3;
const START_AFTER_SHUTDOWN_MS = 60_000;
/** issue ของ server ที่อ่านมาพิจารณาต่อรอบ — มากกว่านี้ในรอบเดียวคือพายุ ฉบับละ 20 อยู่แล้ว */
const CANDIDATES_MAX = 200;
/** issue เบราว์เซอร์ที่อ่านมาพิจารณาต่อรอบ — แจ้งได้ไม่เกินห้าต่อหกชั่วโมงอยู่แล้ว */
const BROWSER_CANDIDATES_MAX = 20;
/**
 * ไม่แจ้งด้วยข้อไหนทั้งสิ้น — `browser:chunk-load` คือ deploy ใหม่ระหว่างที่หน้าเก่ายังเปิดอยู่ (plan §5: "never alerts")
 * และ 503 `log_access_disabled` คือคนลองเรียก API อ่าน log ที่ปิดไว้ ไม่ใช่ระบบเสีย
 */
const NEVER_ALERT_IDS = ["browser:chunk-load"];
const NEVER_ALERT_SUFFIX = ":log_access_disabled";
/** ชื่อ error ของรายงานเบราว์เซอร์ที่ลงอีเมลได้ — ชื่อแบบตัวระบุของ JavaScript (`TypeError`, `ChunkLoadError`) */
const BROWSER_NAME_SHAPE = /^[A-Za-z][A-Za-z0-9_$]{0,59}$/;
/** หน้าของรายงานเบราว์เซอร์ที่ลงอีเมลได้ — ท่อนละตัวเล็ก ตัวเลข ขีด (`:id`/`:n` ที่ pagePattern ใส่) ไม่เกินหกท่อน 80 ตัว */
const BROWSER_PAGE_SHAPE = /^(?:\/[a-z0-9:_-]{1,40}){0,6}\/?$/;
/** รุ่นของบันเดิลที่ลงอีเมลได้ — SHA (ต่อ `-dirty` ได้) หรือ `dev` / `unknown` ค่าอื่นผู้ส่งเขียนเอง */
const RELEASE_SHAPE = /^(?:[0-9a-f]{7,40}(?:-dirty)?|dev|unknown)$/;
const BANGKOK_OFFSET_MS = 7 * 60 * 60_000;
const CAPTURE_EVERY_MS = 10 * 60_000;

type Trigger = "fatal" | "regressed" | "dead_letter" | "new" | "sustained_5xx";

/** ลำดับในอีเมล — ตัวที่เลขน้อยกว่าได้ที่ก่อนเมื่อเกิน 20 */
const TRIGGER_ORDER: Record<Trigger, number> = { fatal: 0, regressed: 1, dead_letter: 2, new: 3, sustained_5xx: 4 };
const TRIGGER_LABEL: Record<Trigger, string> = {
  fatal: "process ตาย (fatal)",
  regressed: "เกิดซ้ำหลังปิด",
  dead_letter: "อีเมลส่งไม่สำเร็จครบทุกครั้ง",
  new: "ปัญหาใหม่",
  sustained_5xx: "ตอบ 5xx ต่อเนื่อง",
};

interface IssueDoc {
  _id: string;
  service?: string;
  title?: string;
  culprit?: string;
  level?: string;
  count?: number;
  firstSeen?: Date;
  lastSeen?: Date;
  firstRelease?: string;
  lastRelease?: string;
  lastEventId?: string | null;
  status?: string;
  regressedAt?: Date | null;
  alertedAt?: Date | null;
}

interface AlertState {
  _id: string;
  /** คำของ worker ว่าเปิดอยู่ไหม ณ `checkedAt` (หัวไฟล์ ย่อหน้าสุดท้าย) */
  enabled?: boolean;
  recipients?: number;
  checkedAt?: Date;
  enabledAt?: Date;
  lastDigestAt?: Date;
  crashLoopAlertedAt?: Record<string, Date>;
  overQuotaAlertedAt?: Date | null;
  lastError?: string | null;
  lastDigest?: Record<string, unknown>;
  /** ฉบับที่ยังไม่ถึงผู้รับบางคน — อ่านผ่าน `pendingList` เท่านั้น (ค่าจาก Mongo ไม่เชื่อรูป) */
  pending?: unknown;
}

/** ฉบับหนึ่งที่ยังส่งไม่ถึงผู้รับบางคน (หัวไฟล์ "ผู้รับที่ยังไม่ได้ฉบับนี้") */
interface PendingDigest {
  createdAt: Date;
  subject: string;
  body: string;
  /** ผู้รับที่ยังไม่ได้ — key ของที่อยู่ (`recipientKey`) ไม่ใช่ตัวที่อยู่ log store ไม่ต้องถืออีเมลของใคร */
  recipients: string[];
}

/** ผลของการส่งหนึ่งฉบับถึงรายชื่อหนึ่ง (`sendToAll`) */
interface SendRound {
  delivered: number;
  /** SMTP ปฏิเสธถาวร (ตอบ 5xx) — ส่งซ้ำก็ได้ผลเดิม จึงไม่ถูกเก็บไว้ส่งซ้ำ */
  rejected: number;
  /** key ของผู้รับที่ยังไม่ได้ฉบับนี้และควรลองอีก: หมดเวลา ล้มชั่วคราว หรือยังไม่ถึงคิวตอนรอบหยุด */
  missed: string[];
  /** มีฉบับที่เกิน 30 วินาที — SMTP ช้า ผู้เรียกไม่เปิดการส่งอื่นอีกในรอบนี้ */
  stalled: boolean;
}

interface Candidate {
  issue: IssueDoc;
  trigger: Trigger;
  /** จำนวน event ใน 15 นาทีล่าสุด — เฉพาะ issue `http:5xx:` (`sustained_5xx` หรือ `regressed`) */
  recent?: number;
}

interface CrashLoop {
  service: string;
  fatalExits: number;
  unexplainedStarts: number;
}

let timer: NodeJS.Timeout | null = null;
let running: Promise<void> | null = null;
let stopped = false;
const lastCaptured = new Map<string, number>();

/**
 * เริ่มลูป — ปิด log store ไม่ทำอะไร ไม่มีผู้รับบอกหนึ่งบรรทัดว่าทำไม แล้วจดลง log store ครั้งเดียวว่าปิดอยู่
 * (`recordDisabled` — ให้ `/api/admin/logs/status` ไม่แสดงสถานะของตอนที่ยังเปิด)
 */
export function startErrorAlerts(): void {
  if (!env.logStore.enabled || timer || running) return;
  stopped = false;
  if (env.logStore.alertEmails.length === 0) {
    console.log("[error-alerts] ปิดอยู่ — ไม่ได้ตั้ง ERROR_ALERT_EMAILS (issue ยังถูกเก็บตามปกติ)");
    timer = setTimeout(() => {
      timer = null;
      running = recordDisabled().finally(() => {
        running = null;
      });
    }, FIRST_TICK_MS);
    timer.unref();
    return;
  }
  console.log(`[error-alerts] เปิดอยู่ — ส่งสรุปถึง ${env.logStore.alertEmails.length} ผู้รับ ไม่เกินทุก 15 นาที`);
  schedule(FIRST_TICK_MS);
}

/**
 * จดว่าปิดอยู่ — ครั้งเดียวต่อการเริ่ม worker และล้าง `enabledAt`: ตอนเปิดกลับมา issue ที่เกิดระหว่างที่ปิดนับเป็น "มีอยู่ก่อน
 * เปิด" ไม่ถูกแจ้งทั้งกอง Mongo ยังต่อไม่ได้ก็ข้ามไป (สถานะที่ /status แสดงค้างเป็นของเดิมจนกว่า worker จะเริ่มใหม่)
 */
async function recordDisabled(): Promise<void> {
  try {
    const db = await logDb();
    if (!db) return;
    await db
      .collection<AlertState>("relay_state")
      .updateOne(
        { _id: STATE_ID },
        { $set: { enabled: false, recipients: 0, checkedAt: new Date() }, $unset: { enabledAt: "" } },
        { upsert: true, maxTimeMS: MONGO_COMMAND_MAX_MS },
      );
  } catch (err) {
    captureThrottled("error-alerts.state", err);
  }
}

/**
 * หยุดลูป — ไม่รอฉบับที่กำลังส่ง (ส่งค้างได้ถึง 30 วินาที เกิน 10 วินาทีของ compose) ผู้รับที่ยังไม่ถึงคิวนับเป็น `missed`
 * ถ้า process ปิดก่อนจดผล ฉบับนั้นไม่ถูกนับว่าแจ้งแล้ว และรอบหน้าประกอบใหม่
 */
export function stopErrorAlerts(): void {
  stopped = true;
  if (timer) clearTimeout(timer);
  timer = null;
}

function schedule(ms: number) {
  if (stopped) return;
  timer = setTimeout(() => {
    timer = null;
    running = tick().finally(() => {
      running = null;
      schedule(TICK_MS);
    });
  }, ms);
  timer.unref();
}

async function tick(): Promise<void> {
  try {
    const db = await logDb();
    if (!db) return;
    const states = db.collection<AlertState>("relay_state");
    const now = new Date();
    let state = await states.findOne({ _id: STATE_ID }, { maxTimeMS: MONGO_COMMAND_MAX_MS });
    // บอกทุกรอบว่ายังเปิดอยู่ (`/api/admin/logs/status`) — `enabledAt` เฉพาะครั้งแรกหลังเปิด
    const heartbeat: Partial<AlertState> = { enabled: true, recipients: env.logStore.alertEmails.length, checkedAt: now };
    if (!state?.enabledAt) heartbeat.enabledAt = now;
    await states.updateOne({ _id: STATE_ID }, { $set: heartbeat }, { upsert: true, maxTimeMS: MONGO_COMMAND_MAX_MS });
    state = { ...(state ?? { _id: STATE_ID }), ...heartbeat };
    const quota = await overQuotaChange(db, states, state);
    if (state.lastDigestAt && now.getTime() - state.lastDigestAt.getTime() < DIGEST_EVERY_MS) return;

    // ฉบับก่อน ๆ ที่ยังไม่ถึงผู้รับบางคน — ส่งก่อนฉบับใหม่ SMTP ยังช้าอยู่ก็หยุดตรงนั้น ฉบับใหม่รอรอบหน้า (issue ยังไม่ถูกนับว่าแจ้ง)
    const carried = await deliverPending(state.pending, now);
    if (carried.stalled) {
      await states.updateOne(
        { _id: STATE_ID },
        { $set: { lastDigestAt: now, pending: carried.pending, lastError: pendingError(carried.pending) } },
        { upsert: true, maxTimeMS: MONGO_COMMAND_MAX_MS },
      );
      return;
    }

    const browserBudget = await browserBudgetOf(db, now);
    const candidates = await collect(db, state, now, browserBudget);
    const crashLoops = await crashLoopsOf(db, state, now);
    const chosen = choose(candidates, browserBudget);
    // มีแค่ issue เบราว์เซอร์ที่โควตาหกชั่วโมงหมดแล้ว = ไม่มีอะไรจะส่ง ไม่ใช่ฉบับที่มีแต่บรรทัด "และอีก N รายการ"
    if (chosen.length === 0 && crashLoops.length === 0 && !quota) {
      if (carried.changed) {
        await states.updateOne(
          { _id: STATE_ID },
          {
            $set: {
              pending: carried.pending,
              lastError: pendingError(carried.pending),
              // ส่งฉบับที่ค้างไปแล้วในรอบนี้ = ใช้รอบนี้ไปแล้ว ครั้งต่อไปอีก 15 นาที
              ...(carried.attempted ? { lastDigestAt: now } : {}),
            },
          },
          { upsert: true, maxTimeMS: MONGO_COMMAND_MAX_MS },
        );
      }
      return;
    }

    const { subject, body } = compose(chosen, candidates.length - chosen.length, crashLoops, quota);
    const round = await sendToAll(subject, body, env.logStore.alertEmails);
    const delivered = round.delivered;
    let pending = carried.pending;
    // ถึงบางคนแต่ไม่ครบ — คนที่ยังไม่ได้ได้ฉบับนี้ในรอบหน้า (ไม่ถึงใครเลย = ไม่เก็บ ฉบับหน้าประกอบใหม่ทั้งชุด)
    if (delivered > 0 && round.missed.length > 0) {
      pending = [...pending, { createdAt: now, subject, body: body.slice(0, PENDING_BODY_MAX), recipients: round.missed }];
      if (pending.length > PENDING_MAX) {
        for (const dropped of pending.slice(0, pending.length - PENDING_MAX)) warnDropped(dropped, "เก็บได้ไม่เกิน 3 ฉบับ");
        pending = pending.slice(-PENDING_MAX);
      }
    }

    // ส่งถึงอย่างน้อยหนึ่งคน = แจ้งแล้ว (คนที่ยังไม่ได้อยู่ใน `pending`) ไม่ถึงใครเลย = ยังไม่ได้แจ้ง ฉบับหน้า (15 นาที) ลองใหม่ทั้งชุด
    const update: Document = {
      lastDigestAt: now,
      lastError: delivered === 0 ? "ส่งไม่สำเร็จทุกผู้รับ" : pendingError(pending),
      pending,
      lastDigest: {
        at: now,
        issues: chosen.map((c) => ({ fingerprint: c.issue._id, trigger: c.trigger })),
        crashLoops: crashLoops.map((c) => c.service),
        overQuota: quota !== null,
        delivered,
        rejected: round.rejected,
        missed: round.missed.length,
        recipients: env.logStore.alertEmails.length,
      },
    };
    if (delivered > 0) {
      for (const loop of crashLoops) update[`crashLoopAlertedAt.${loop.service}`] = now;
      if (quota) update.overQuotaAlertedAt = now;
      if (chosen.length > 0) {
        await db
          .collection<IssueDoc>("error_issues")
          .updateMany(
            { _id: { $in: chosen.map((c) => c.issue._id) } },
            { $set: { alertedAt: now }, $inc: { alertCount: 1 } },
            { maxTimeMS: MONGO_COMMAND_MAX_MS },
          );
      }
    }
    await states.updateOne({ _id: STATE_ID }, { $set: update }, { upsert: true, maxTimeMS: MONGO_COMMAND_MAX_MS });
    console.log(
      `[error-alerts] สรุป ${chosen.length} issue` +
        `${crashLoops.length > 0 ? ` · วนรีสตาร์ต ${crashLoops.map((c) => c.service).join(", ")}` : ""}` +
        `${quota ? " · เกินเพดานขนาด" : ""} — ส่งถึง ${delivered}/${env.logStore.alertEmails.length} ผู้รับ` +
        `${round.rejected > 0 ? ` · ถูกปฏิเสธ ${round.rejected}` : ""}` +
        `${delivered > 0 && round.missed.length > 0 ? ` · ยังไม่ถึง ${round.missed.length} (ส่งให้ในรอบหน้า)` : ""} ` +
        `(${chosen.map((c) => `${c.trigger}:${shortFingerprint(c.issue._id)}`).join(" ") || "ไม่มี issue"})`,
    );
  } catch (err) {
    captureThrottled("error-alerts.tick", err);
  }
}

// --------------------------------------------------------------------------------------------- สิ่งที่ต้องแจ้ง

/**
 * issue ที่เข้าเงื่อนไขข้อ 1–4 ของหัวไฟล์ — ทุกตัว `open` และเห็นล่าสุดหลังเปิดการแจ้งเตือน (`enabledAt`)
 * คำสั่งกวาดตัวที่อาจเข้าข่าย (เงื่อนไขเดียวกับ `triggerOf` ให้ตัวที่ไม่มีทางแจ้งไม่กินที่ในสองร้อยตัว) แล้วแยกประเภทในโค้ด
 * issue `http:5xx:` นับ event ของ 15 นาทีล่าสุดเพิ่มทีละ issue (index `fingerprint, occurredAt`) — ตอนเกินเพดานขนาด event
 * ไม่ถูกเก็บ ข้อ 4 จึงไม่ทำงาน แต่ข้อ 6 แจ้งเรื่องเพดานแทนแล้ว
 *
 * issue ของ server กับของเบราว์เซอร์อ่านแยกกันคนละคำสั่ง: ถ้าอ่านรวม สองร้อยตัวที่ `lastSeen` ใหม่สุดอาจเป็นของเบราว์เซอร์
 * ทั้งหมด (ใครก็สร้างได้) แล้ว error ของ server ที่เกิดก่อนหน้านั้นไม่ถูกอ่านมาพิจารณาเลย ของเบราว์เซอร์อ่านเฉพาะเมื่อโควตาหก
 * ชั่วโมงยังเหลือ
 */
async function collect(db: Db, state: AlertState, now: Date, browserBudget: number): Promise<Candidate[]> {
  const cooledDown = new Date(now.getTime() - ISSUE_COOLDOWN_MS);
  const recentFrom = new Date(now.getTime() - SUSTAINED_WINDOW_MS);
  const filter = {
    status: "open",
    lastSeen: { $gte: state.enabledAt ?? now },
    _id: { $nin: NEVER_ALERT_IDS, $not: new RegExp(`${NEVER_ALERT_SUFFIX}$`) },
    $or: [
      { level: { $in: ["error", "fatal"] }, alertedAt: null },
      { regressedAt: { $ne: null }, $or: [{ level: { $in: ["error", "fatal"] } }, { _id: { $regex: "^http:5xx:" } }] },
      { level: "fatal", alertedAt: { $lte: cooledDown } },
      { _id: { $regex: "^delivery:dead-letter:" }, alertedAt: { $lte: cooledDown } },
      {
        _id: { $regex: "^http:5xx:" },
        lastSeen: { $gte: recentFrom },
        $or: [{ alertedAt: null }, { alertedAt: { $lte: cooledDown } }],
      },
    ],
  } as Filter<IssueDoc>;
  const issuesOf = (service: Filter<IssueDoc>, limit: number) =>
    db
      .collection<IssueDoc>("error_issues")
      .find({ ...filter, ...service })
      .sort({ lastSeen: -1 })
      .limit(limit)
      .maxTimeMS(MONGO_COMMAND_MAX_MS)
      .toArray();
  const issues = [
    ...(await issuesOf({ service: { $ne: "browser" } }, CANDIDATES_MAX)),
    ...(browserBudget > 0 ? await issuesOf({ service: "browser" }, BROWSER_CANDIDATES_MAX) : []),
  ];

  const candidates: Candidate[] = [];
  for (const issue of issues) {
    const trigger = triggerOf(issue, cooledDown);
    if (trigger === null) continue;
    if (issue._id.startsWith("http:5xx:")) {
      // 5xx ที่ route ตอบเองเป็น warning — แจ้งเฉพาะเมื่อต่อเนื่อง ไม่ว่าจะมาทาง sustained_5xx หรือ regressed
      const recent = await db
        .collection("error_events")
        .countDocuments({ fingerprint: issue._id, occurredAt: { $gte: recentFrom } }, { maxTimeMS: MONGO_COMMAND_MAX_MS });
      if (recent < SUSTAINED_MIN_EVENTS) continue;
      candidates.push({ issue, trigger, recent });
    } else {
      candidates.push({ issue, trigger });
    }
  }
  return candidates;
}

/**
 * ประเภทของการแจ้ง หรือ null ถ้าไม่แจ้ง — issue `http:5xx:` ที่ได้ค่ากลับไปยังต้องผ่านการนับ 5 ตัวใน 15 นาทีของ `collect`
 *
 * `regressed` เฉพาะตัวที่ข้ออื่นจะแจ้งอยู่แล้ว (ระดับ error ขึ้นไป หรือ 5xx ต่อเนื่อง) — การเกิดซ้ำหลังปิดข้ามช่วงพักหกชั่วโมง
 * ได้ แต่ไม่ได้ทำให้ warning กลายเป็นเรื่องที่ต้องแจ้ง (หัวไฟล์ ข้อ 2)
 */
function triggerOf(issue: IssueDoc, cooledDown: Date): Trigger | null {
  if (NEVER_ALERT_IDS.includes(issue._id) || issue._id.endsWith(NEVER_ALERT_SUFFIX)) return null;
  const alertedAt = issue.alertedAt ?? null;
  const serious = issue.level === "error" || issue.level === "fatal";
  const http5xx = issue._id.startsWith("http:5xx:");
  if (issue.regressedAt && (!alertedAt || issue.regressedAt > alertedAt) && (serious || http5xx)) return "regressed";
  const cooled = !alertedAt || alertedAt <= cooledDown;
  const recurred = !alertedAt || (issue.lastSeen !== undefined && issue.lastSeen > alertedAt);
  if (issue.level === "fatal" && cooled && recurred) return "fatal";
  if (issue._id.startsWith("delivery:dead-letter:") && cooled && recurred) return "dead_letter";
  if (serious && !alertedAt) return "new";
  if (http5xx && cooled) return "sustained_5xx";
  return null;
}

/**
 * issue เบราว์เซอร์ที่ยังแจ้งได้ในหกชั่วโมงนี้ — ห้าลบจำนวนที่ `alertedAt` อยู่ในหกชั่วโมงที่ผ่านมา นับจาก log store ไม่ใช่
 * หน่วยความจำ worker เริ่มใหม่จึงไม่ได้โควตาใหม่
 */
async function browserBudgetOf(db: Db, now: Date): Promise<number> {
  const used = await db
    .collection<IssueDoc>("error_issues")
    .countDocuments(
      { service: "browser", alertedAt: { $gte: new Date(now.getTime() - BROWSER_WINDOW_MS) } },
      { maxTimeMS: MONGO_COMMAND_MAX_MS },
    );
  return Math.max(0, BROWSER_ALERTS_PER_WINDOW - used);
}

/** ไม่เกิน 20 ตัวตามลำดับความสำคัญ ในนั้นเป็นรายงานจากเบราว์เซอร์ได้ไม่เกินโควตาหกชั่วโมงที่เหลือ (ยืนยันแหล่งที่มาไม่ได้) */
function choose(candidates: Candidate[], browserBudget: number): Candidate[] {
  const sorted = [...candidates].sort(
    (a, b) =>
      TRIGGER_ORDER[a.trigger] - TRIGGER_ORDER[b.trigger] ||
      (b.issue.lastSeen?.getTime() ?? 0) - (a.issue.lastSeen?.getTime() ?? 0),
  );
  const chosen: Candidate[] = [];
  let browser = 0;
  for (const candidate of sorted) {
    if (chosen.length >= ISSUES_PER_DIGEST) break;
    if (candidate.issue.service === "browser") {
      if (browser >= browserBudget) continue;
      browser += 1;
    }
    chosen.push(candidate);
  }
  return chosen;
}

/**
 * service ที่วนรีสตาร์ตในชั่วโมงที่ผ่านมา (ข้อ 5 ของหัวไฟล์) และยังไม่ได้แจ้งภายในหกชั่วโมง — จาก `runtime_events`
 * ที่ backend กับ worker เขียนตอนเริ่ม ปิด และตาย (lib/error-capture.ts `recordRuntimeEvent`)
 */
async function crashLoopsOf(db: Db, state: AlertState, now: Date): Promise<CrashLoop[]> {
  const events = await db
    .collection<{ at: Date; service: string; kind: string }>("runtime_events")
    .find({ at: { $gte: new Date(now.getTime() - CRASH_WINDOW_MS - START_AFTER_SHUTDOWN_MS) } })
    .sort({ at: 1 })
    .limit(2_000)
    .maxTimeMS(MONGO_COMMAND_MAX_MS)
    .toArray();
  const windowStart = now.getTime() - CRASH_WINDOW_MS;
  const byService = new Map<string, Array<{ at: number; kind: string }>>();
  for (const event of events) {
    if (!(event.at instanceof Date) || typeof event.service !== "string") continue;
    const list = byService.get(event.service) ?? [];
    list.push({ at: event.at.getTime(), kind: event.kind });
    byService.set(event.service, list);
  }
  const loops: CrashLoop[] = [];
  for (const [service, list] of byService) {
    const inWindow = list.filter((e) => e.at >= windowStart);
    const fatalExits = inWindow.filter((e) => e.kind === "fatal-exit").length;
    const unexplainedStarts = inWindow.filter(
      (start) =>
        start.kind === "start" &&
        !list.some((e) => e.kind === "shutdown" && e.at <= start.at && start.at - e.at <= START_AFTER_SHUTDOWN_MS),
    ).length;
    if (fatalExits < CRASH_FATAL_EXITS && unexplainedStarts < CRASH_UNEXPLAINED_STARTS) continue;
    const alertedAt = state.crashLoopAlertedAt?.[service];
    if (alertedAt instanceof Date && now.getTime() - alertedAt.getTime() < ISSUE_COOLDOWN_MS) continue;
    loops.push({ service, fatalExits, unexplainedStarts });
  }
  return loops;
}

/**
 * เกินเพดานขนาดครั้งใหม่ที่ยังไม่ได้แจ้ง — คืนตัวเลขถ้าต้องแจ้ง ไม่งั้น null ธงลงแล้วล้าง `overQuotaAlertedAt` ครั้งหน้าที่เกินจึง
 * แจ้งอีก (เรียกทุกรอบ ก่อนตรวจอัตรา 15 นาที เพื่อให้การล้างไม่ต้องรอฉบับถัดไป)
 */
async function overQuotaChange(
  db: Db,
  states: Collection<AlertState>,
  state: AlertState,
): Promise<{ storageMb: number | null; maxMb: number | null } | null> {
  const relay = await db
    .collection<{ _id: string; overQuota?: boolean; storageMb?: number; maxMb?: number }>("relay_state")
    .findOne({ _id: "audit_event" }, { projection: { overQuota: 1, storageMb: 1, maxMb: 1 }, maxTimeMS: MONGO_COMMAND_MAX_MS });
  if (relay?.overQuota === true) {
    if (state.overQuotaAlertedAt) return null;
    return { storageMb: relay.storageMb ?? null, maxMb: relay.maxMb ?? null };
  }
  if (state.overQuotaAlertedAt) {
    await states.updateOne({ _id: STATE_ID }, { $set: { overQuotaAlertedAt: null } }, { maxTimeMS: MONGO_COMMAND_MAX_MS });
    state.overQuotaAlertedAt = null;
  }
  return null;
}

// --------------------------------------------------------------------------------------------- อีเมล

function bangkok(value: Date | undefined | null): string {
  if (!(value instanceof Date)) return "-";
  return new Date(value.getTime() + BANGKOK_OFFSET_MS).toISOString().slice(0, 19).replace("T", " ");
}

function shortFingerprint(fingerprint: string): string {
  return /^[0-9a-f]{40}$/.test(fingerprint) ? fingerprint.slice(0, 12) : fingerprint.slice(0, 80);
}

/**
 * ข้อความของสรุปหนึ่งฉบับ — ข้อความธรรมดา (ขึ้นบรรทัดด้วย `\n`, `sendRaw(…, {lineBreaks: true})` แปลงเป็น `<br>` หลัง escape)
 * ทุกค่ามาจาก `error_issues` ซึ่งกวาดข้อมูลส่วนบุคคลตั้งแต่ตอนเก็บ issue ของเบราว์เซอร์ใช้ `browserLines` แทน: หัวเรื่อง
 * culprit และรุ่นของมันผู้ส่งเขียนเอง จึงไม่ลงอีเมลตรง ๆ
 */
function compose(
  chosen: Candidate[],
  leftOver: number,
  crashLoops: CrashLoop[],
  quota: { storageMb: number | null; maxMb: number | null } | null,
): { subject: string; body: string } {
  const total = chosen.length + crashLoops.length + (quota ? 1 : 0);
  const subject = `[D2 ${env.deployEnv}] ระบบพบปัญหาที่ควรตรวจสอบ ${total} รายการ`;
  const lines: string[] = [
    `ระบบ ${env.deployEnv} (worker รุ่น ${env.release}) พบปัญหาที่ควรตรวจสอบ ${total} รายการ เวลาเป็นเวลาไทย`,
    "",
  ];
  chosen.forEach((candidate, index) => {
    const issue = candidate.issue;
    if (issue.service === "browser") {
      lines.push(...browserLines(index + 1, candidate));
      return;
    }
    lines.push(`${index + 1}. [${TRIGGER_LABEL[candidate.trigger]}] ${(issue.title ?? "(ไม่มีหัวเรื่อง)").slice(0, 200)}`);
    lines.push(
      `   service ${issue.service ?? "-"} · ระดับ ${issue.level ?? "-"} · ที่เกิด ${(issue.culprit ?? "-").slice(0, 120)}` +
        ` · ทั้งหมด ${issue.count ?? 0} ครั้ง${recentText(candidate)}`,
    );
    lines.push(
      `   พบครั้งแรก ${bangkok(issue.firstSeen)} · ล่าสุด ${bangkok(issue.lastSeen)} · รุ่น ${issue.firstRelease ?? "-"}` +
        `${issue.lastRelease && issue.lastRelease !== issue.firstRelease ? ` → ${issue.lastRelease}` : ""}`,
    );
    lines.push(`   event ล่าสุด ${issue.lastEventId ?? "-"} · เปิดดู: Postman E2 โดยตั้ง errorFingerprint = ${issue._id}`);
  });
  if (leftOver > 0) {
    lines.push(
      "",
      `และอีก ${leftOver} รายการที่ยังไม่ได้แจ้งในฉบับนี้ (เกิน ${ISSUES_PER_DIGEST} รายการต่อฉบับ หรือเกินโควตารายงานจาก` +
        ` เบราว์เซอร์ ${BROWSER_ALERTS_PER_WINDOW} รายการต่อ 6 ชั่วโมง) — เปิดดูทั้งหมดด้วย Postman E1`,
    );
  }
  if (crashLoops.length > 0) {
    lines.push("", "process วนรีสตาร์ตในชั่วโมงที่ผ่านมา:");
    for (const loop of crashLoops) {
      lines.push(
        `   ${loop.service}: ตายเอง (fatal) ${loop.fatalExits} ครั้ง · เริ่มใหม่โดยไม่ได้ปิดตามปกติ ${loop.unexplainedStarts} ครั้ง` +
          " — ดู docker compose logs และ E1 (level=fatal)",
      );
    }
  }
  if (quota) {
    lines.push(
      "",
      `log store เกินเพดานขนาด: ใช้อยู่ ${quota.storageMb ?? "?"} MB จากเพดาน ${quota.maxMb ?? "?"} MB — ระหว่างนี้เก็บแค่ตัวนับ` +
        " ของ issue ไม่เก็บ error ทีละตัว (ดู Postman S1 และ docs/21 เรื่องเพดานขนาด)",
    );
  }
  lines.push(
    "",
    "สรุปนี้ส่งไม่เกินทุก 15 นาที ปัญหาเดียวกันแจ้งซ้ำไม่เกินทุก 6 ชั่วโมง เว้นแต่เกิดซ้ำหลังปิด " +
      "ปิดหรือละเว้นปัญหาด้วย Postman E4 (ต้องระบุเหตุผล)",
  );
  return { subject, body: lines.join("\n") };
}

function recentText(candidate: Candidate): string {
  return candidate.recent !== undefined ? ` (${candidate.recent} ครั้งใน 15 นาที)` : "";
}

/**
 * บรรทัดของ issue เบราว์เซอร์ — **ไม่มีข้อความที่ผู้ส่งเลือกเองได้อย่างอิสระ** (หัวไฟล์ "รายงานจากเบราว์เซอร์")
 *
 * หัวเรื่องของ issue คือ `ชื่อ: ข้อความ` ที่ใครก็ POST มาได้ ผ่านแค่การกวาดตามรูปแบบ (เลขบัตร อีเมล โทรศัพท์) ชื่อคนกับ URL
 * รอด เดิมบรรทัดแรกของอีเมลคือหัวเรื่องนั้นตรง ๆ: ใครก็ได้จึงเขียนข้อความของตัวเองลงอีเมลที่ออกจากระบบถึงผู้ดูแล (ตรวจขั้น 10
 * แบบค้าน, 2026-10-01) ตอนนี้เหลือ: ชื่อ error เฉพาะที่เป็นรูปตัวระบุของ JavaScript, หน้าเฉพาะท่อนตัวเล็ก ตัวเลข ขีด (ข้อความ
 * สั้น ๆ แบบ `/send-money-now` ยังผ่านได้ — ยอมรับ), รุ่นเฉพาะที่เป็น SHA, จำนวน เวลา และ fingerprint (server คำนวณเอง)
 * ข้อความเต็มเปิดดูได้ใน E2 ซึ่งเป็น JSON และถูกบันทึกเป็นการอ่าน
 */
function browserLines(number: number, candidate: Candidate): string[] {
  const issue = candidate.issue;
  const rawName = (issue.title ?? "").split(":")[0]?.trim() ?? "";
  const name = BROWSER_NAME_SHAPE.test(rawName) ? rawName : "(ชื่อ error อยู่นอกรูปแบบที่รู้จัก)";
  const culprit = issue.culprit ?? "";
  // รายงานที่ไม่บอกหน้า culprit เป็นชื่อ service (lib/error-capture.ts `countIssue`)
  const page =
    culprit === "" || culprit === "browser"
      ? "-"
      : culprit.length <= 80 && BROWSER_PAGE_SHAPE.test(culprit)
        ? culprit
        : "(หน้าอยู่นอกรูปแบบที่รู้จัก)";
  const release = (value: string | undefined) => (value && RELEASE_SHAPE.test(value) ? value : "(ไม่รู้จัก)");
  return [
    `${number}. [${TRIGGER_LABEL[candidate.trigger]}] ${name} จากเบราว์เซอร์ — รายงานนี้ใครก็ส่งได้ ยืนยันแหล่งที่มาไม่ได้` +
      " ข้อความของ error ไม่ใส่ในอีเมลเพราะผู้ส่งเขียนเอง",
    `   ระดับ ${issue.level ?? "-"} · หน้า ${page} · ทั้งหมด ${issue.count ?? 0} ครั้ง${recentText(candidate)}`,
    `   พบครั้งแรก ${bangkok(issue.firstSeen)} · ล่าสุด ${bangkok(issue.lastSeen)} · รุ่นของหน้าเว็บ ${release(issue.lastRelease)}`,
    `   เปิดดูข้อความเต็ม: Postman E2 โดยตั้ง errorFingerprint = ${issue._id}`,
  ];
}

/**
 * ส่งถึง `recipients` ทีละคน (Office 365 รับการเชื่อมต่อพร้อมกันได้น้อย) คนละไม่เกิน 30 วินาที — ไม่ throw
 * SMTP ที่ยังไม่ได้ตั้ง (dev) `sendRaw` พิมพ์แค่ผู้รับกับหัวเรื่อง จึงพิมพ์เนื้อความทั้งฉบับไว้ที่นี่ด้วย (ไม่มีข้อมูลบุคคล)
 *
 * **ฉบับที่เกิน 30 วินาทีหยุดทั้งรอบ** (`stalled`): lib/mail.ts ปิดการเชื่อมต่อของมันแล้ว แต่ SMTP ที่ช้าขนาดนั้นน่าจะช้ากับคน
 * ถัดไปด้วย ตัวที่หมดเวลากับทุกคนที่ยังไม่ถึงคิวอยู่ใน `missed` ให้ผู้เรียกเก็บไว้ส่งรอบหน้า ความล้มเหลวอื่นจบการเชื่อมต่อของมัน
 * เองแล้ว จึงส่งคนถัดไปต่อ: SMTP ตอบ 5xx (ไม่มีผู้รับนี้ รหัสผ่านผิด) นับเป็น `rejected` ไม่ลองซ้ำ ที่เหลือ (ต่อไม่ได้ เงียบเกิน
 * 20 วินาที ตอบ 4xx) ชั่วคราว อยู่ใน `missed`
 */
async function sendToAll(subject: string, body: string, recipients: readonly string[]): Promise<SendRound> {
  if (!env.smtp.enabled) console.log(`[error-alerts] (dry-run) เนื้อความ:\n${body}`);
  const round: SendRound = { delivered: 0, rejected: 0, missed: [], stalled: false };
  for (const [index, to] of recipients.entries()) {
    if (stopped || round.stalled) {
      round.missed.push(recipientKey(to));
      continue;
    }
    try {
      await sendRaw(to, subject, body, { lineBreaks: true, timeoutMs: SEND_TIMEOUT_MS });
      round.delivered += 1;
    } catch (err) {
      captureThrottled("error-alerts.send", err);
      if (permanentFailure(err)) {
        round.rejected += 1;
        continue;
      }
      round.missed.push(recipientKey(to));
      if (err instanceof SendDeadlineError) {
        round.stalled = true;
        console.warn(
          `[error-alerts] ส่งฉบับที่ ${index + 1}/${recipients.length} เกิน ${SEND_TIMEOUT_MS / 1000} วินาที — ปิดการเชื่อมต่อแล้ว ` +
            "หยุดรอบนี้ ผู้รับที่ยังไม่ได้ได้ฉบับนี้ในรอบหน้า",
        );
      }
    }
  }
  return round;
}

/** SMTP ปฏิเสธถาวร — รหัสตอบกลับ 5xx (nodemailer ใส่ไว้ที่ `responseCode`) ส่งซ้ำก็ได้ผลเดิม */
function permanentFailure(err: unknown): boolean {
  const code = (err as { responseCode?: unknown } | null | undefined)?.responseCode;
  return typeof code === "number" && code >= 500 && code < 600;
}

/**
 * กุญแจของ `recipientKey` — `LOG_HASH_KEY` ตัวเดียวกับ key ค้นหาของสำเนากิจกรรม (worker มีอยู่แล้ว) ไม่ได้ตั้ง (production ที่ตั้ง
 * ไม่ครบ — `/status` บอก `hashKey: "missing"`) ใช้กุญแจสุ่มของ process นี้แทน: ผู้รับที่ค้างจึงถูกจำได้แค่จน worker เริ่มใหม่
 */
const RECIPIENT_KEY_SECRET = env.logStore.hashKey || randomBytes(32).toString("hex");

/**
 * key ของผู้รับที่ `pending` เก็บ — HMAC ของที่อยู่ (ตัวเล็กอยู่แล้ว — env.ts `emailList`) ไม่ใช่ตัวที่อยู่ รายชื่อจริงอยู่ใน
 * `ERROR_ALERT_EMAILS` ที่เดียว ผู้รับที่ถูกถอดออกจากรายชื่อระหว่างนั้นหาไม่เจอ ก็ไม่ได้ฉบับที่ค้าง
 *
 * เดิมเป็น SHA-256 เปล่า ๆ ใครอ่าน `relay_state` ได้ (รวม `bdi_backend`) ก็ยืนยันที่อยู่ของเจ้าหน้าที่ที่เดาไว้ได้ด้วยการ hash เอง
 * (ตรวจแบบค้าน 2026-10-01) — อีเมลใน log store ที่อื่นเป็น HMAC ใต้ `LOG_HASH_KEY` ทั้งหมด (plan §7) ข้อความนำหน้าแยก key ชุดนี้
 * ออกจาก `email#…` ของ `activity.hashKeys` ที่อยู่เดียวกันจึงได้ key คนละตัว โยงกันไม่ได้ `LOG_HASH_KEY` เปลี่ยน key เก่าก็หา
 * ไม่เจอ ผู้รับที่ค้างในตอนนั้นไม่ได้ฉบับที่ค้าง (บรรทัดเตือนของ `deliverPending`)
 */
function recipientKey(address: string): string {
  return createHmac("sha256", RECIPIENT_KEY_SECRET).update(`error-alert-recipient\0${address}`).digest("hex").slice(0, 16);
}

/**
 * ฉบับก่อน ๆ ที่ยังไม่ถึงผู้รับบางคน — ส่งให้คนที่ยังอยู่ในรายชื่อ ตามลำดับที่เกิด ก่อนประกอบฉบับใหม่ (`tick`)
 *
 * หัวเรื่องบอกว่าส่งช้าและเนื้อความบอกเวลาที่ฉบับนั้นออก ตัวเลขในนั้นเป็นของตอนนั้น ฉบับที่ค้างเกินหกชั่วโมงทิ้งพร้อมบรรทัดเตือน:
 * issue ที่ยังเกิดอยู่แจ้งใหม่ได้แล้วหลังช่วงพักหกชั่วโมง และ E1 แสดงทุกตัวที่ยังเปิดอยู่ `changed` = รายการต่างจากที่อ่านมา ต้องจดใหม่
 */
async function deliverPending(
  stored: unknown,
  now: Date,
): Promise<{ pending: PendingDigest[]; attempted: boolean; stalled: boolean; changed: boolean }> {
  const items = pendingList(stored);
  let changed = items.length !== (Array.isArray(stored) ? stored.length : 0);
  if (items.length === 0) return { pending: [], attempted: false, stalled: false, changed };
  const configured = new Map(env.logStore.alertEmails.map((address) => [recipientKey(address), address]));
  const kept: PendingDigest[] = [];
  let attempted = false;
  let stalled = false;
  for (const item of items) {
    if (now.getTime() - item.createdAt.getTime() > PENDING_MAX_AGE_MS) {
      warnDropped(item, "ค้างเกิน 6 ชั่วโมง");
      changed = true;
      continue;
    }
    const keys = item.recipients.filter((key) => configured.has(key));
    if (keys.length < item.recipients.length) {
      changed = true;
      warnUnknown(item, item.recipients.length - keys.length);
    }
    if (keys.length === 0) continue;
    if (stalled || stopped) {
      kept.push({ ...item, recipients: keys });
      continue;
    }
    attempted = true;
    changed = true;
    const targets = keys.map((key) => configured.get(key)!);
    const round = await sendToAll(
      `${item.subject} (ส่งช้า — สรุปเมื่อ ${bangkok(item.createdAt)})`,
      `สรุปฉบับนี้ออกเมื่อ ${bangkok(item.createdAt)} (เวลาไทย) แต่ส่งถึงคุณไม่ได้ในรอบนั้น — ตัวเลขข้างล่างเป็นของเวลานั้น` +
        ` ดูสถานะล่าสุดด้วย Postman E1\n\n${item.body}`,
      targets,
    );
    console.log(
      `[error-alerts] ส่งสรุปของ ${bangkok(item.createdAt)} ที่ค้างอยู่ถึง ${round.delivered}/${targets.length} ผู้รับ` +
        `${round.missed.length > 0 ? ` · ยังไม่ถึง ${round.missed.length} (ลองอีกในรอบหน้า)` : ""}`,
    );
    if (round.missed.length > 0) kept.push({ ...item, recipients: round.missed });
    stalled = round.stalled;
  }
  return { pending: kept, attempted, stalled, changed };
}

/** `pending` ที่อ่านจาก Mongo ในรูปที่ใช้ได้ — ตัวที่ผิดรูปข้ามไป (รอบถัดไปจดทับ) */
function pendingList(value: unknown): PendingDigest[] {
  if (!Array.isArray(value)) return [];
  const list: PendingDigest[] = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== "object") continue;
    const { createdAt, subject, body, recipients } = entry as Record<string, unknown>;
    if (!(createdAt instanceof Date) || Number.isNaN(createdAt.getTime())) continue;
    if (typeof subject !== "string" || typeof body !== "string" || !Array.isArray(recipients)) continue;
    const keys = recipients.filter((key): key is string => typeof key === "string" && /^[0-9a-f]{16}$/.test(key));
    if (keys.length === 0) continue;
    list.push({ createdAt, subject: subject.slice(0, 500), body: body.slice(0, PENDING_BODY_MAX), recipients: keys });
  }
  return list.slice(-PENDING_MAX);
}

function pendingError(pending: PendingDigest[]): string | null {
  if (pending.length === 0) return null;
  const people = pending.reduce((sum, item) => sum + item.recipients.length, 0);
  return `ยังส่งไม่ถึงผู้รับ ${people} รายการใน ${pending.length} ฉบับ — ส่งให้ในรอบหน้า`;
}

/** ผู้รับในฉบับที่ค้างซึ่งไม่อยู่ในรายชื่อแล้ว — ถูกถอดออก หรือ key ใช้ไม่ได้แล้ว (`recipientKey`: `LOG_HASH_KEY` เปลี่ยน หรือไม่ได้ตั้งแล้ว worker เริ่มใหม่) */
function warnUnknown(item: PendingDigest, count: number) {
  console.warn(
    `[error-alerts] สรุปของ ${bangkok(item.createdAt)} ที่ค้างอยู่มีผู้รับ ${count} รายที่ไม่อยู่ในรายชื่อแล้ว — ไม่ส่งให้ ` +
      "(ถูกถอดออกจาก ERROR_ALERT_EMAILS หรือ LOG_HASH_KEY เปลี่ยน/ไม่ได้ตั้งแล้ว worker เริ่มใหม่)",
  );
}

function warnDropped(item: PendingDigest, why: string) {
  console.warn(
    `[error-alerts] ทิ้งสรุปของ ${bangkok(item.createdAt)} ที่ยังส่งไม่ถึง ${item.recipients.length} ผู้รับ (${why}) — ` +
      "ปัญหาที่ยังเปิดอยู่ดูได้ด้วย Postman E1",
  );
}

/** ความล้มเหลวของลูปนี้เก็บไม่เกินครั้งละสิบนาทีต่อ tag — SMTP หรือ Mongo ที่ล่มนานต้องไม่ได้ issue ใหม่ทุกนาที */
function captureThrottled(tag: string, err: unknown) {
  const now = Date.now();
  if (now - (lastCaptured.get(tag) ?? 0) < CAPTURE_EVERY_MS) return;
  lastCaptured.set(tag, now);
  captureError(err, { level: "warning", tag });
}
