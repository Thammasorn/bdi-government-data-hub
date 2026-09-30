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
 * **ส่งทีละฉบับ ทีละผู้รับ ไม่มีสองการเชื่อมต่อซ้อนกัน** ผ่าน `sendRaw(…, {bounded: true})` — Office 365 รับได้ราวสามการเชื่อมต่อ
 * พร้อมกัน (outbox ใช้ไม่ได้: `recipient_user_id` เป็น NOT NULL และผู้รับพวกนี้ไม่ใช่บัญชีในระบบ) ฉบับหนึ่งรอไม่เกิน 30 วินาที
 * การรอที่หมดเวลา**ไม่ได้ยกเลิก**การส่งที่ค้าง (`Promise.race`) จึงหยุดทั้งรอบทันทีที่หมดเวลา ไม่ส่งผู้รับคนถัดไปขณะที่การเชื่อมต่อ
 * เดิมยังเปิด และ transport ของ `bounded` ปิดการเชื่อมต่อเองเมื่อเงียบเกินเพดานของ lib/mail.ts (เดิมใช้ transport ปกติที่รอได้ถึง
 * 10 นาที แล้วส่งคนถัดไปต่อ — การเชื่อมต่อที่สองเปิดขณะที่ตัวแรกยังค้าง) ส่งไม่ได้สักคน issue ยังไม่ถูกนับว่าแจ้งแล้ว ฉบับหน้า
 * ลองใหม่หลัง 15 นาที ไม่ใช่ทุกนาที
 *
 * **ไม่มีข้อมูลบุคคลในอีเมล:** หัวเรื่องของ issue ของ server (ข้อความ error ที่ผ่าน lib/redact.ts แล้วตัด id กับตัวเลขทิ้ง), service,
 * ที่เกิด (แม่แบบของ route), จำนวน, เวลา, รุ่น, id ของ event และ fingerprint ที่เปิดดูใน Postman — ไม่มีผู้ใช้ IP อีเมล
 *
 * สถานะของลูปอยู่ในเอกสาร `relay_state` `_id: "error_alerts"` (`enabled`, `recipients`, `checkedAt`, `enabledAt`,
 * `lastDigestAt`, `crashLoopAlertedAt`, `overQuotaAlertedAt`, `lastError`) — worker เริ่มใหม่ก็ไม่ส่งซ้ำ และ issue ที่มีอยู่ก่อน
 * เปิดการแจ้งเตือน (เห็นล่าสุดก่อน `enabledAt`) ไม่ถูกแจ้งย้อนหลังทั้งกอง `enabled` กับ `checkedAt` คือคำของ worker เองว่าตอนนี้
 * เปิดอยู่ไหม (`GET /api/admin/logs/status` แสดง) — เปิดอยู่เขียนทุกนาที ปิดอยู่เขียนครั้งเดียวตอนเริ่มพร้อมล้าง `enabledAt`
 * เปิดกลับมาจึงนับใหม่จากตอนนั้น ไม่ใช่แจ้งทุกอย่างที่เกิดระหว่างที่ปิด
 */
import type { Collection, Db, Document, Filter } from "mongodb";

import { env } from "../env.js";
import { captureError } from "../lib/error-capture.js";
import { MONGO_COMMAND_MAX_MS, logDb } from "../lib/log-store.js";
import { sendRaw } from "../lib/mail.js";

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

/** หยุดลูป — ไม่รอฉบับที่กำลังส่ง (ส่งค้างได้ถึง 30 วินาที เกิน 10 วินาทีของ compose) ฉบับนั้นไม่ถูกนับว่าแจ้งแล้ว */
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

    const browserBudget = await browserBudgetOf(db, now);
    const candidates = await collect(db, state, now, browserBudget);
    const crashLoops = await crashLoopsOf(db, state, now);
    const chosen = choose(candidates, browserBudget);
    // มีแค่ issue เบราว์เซอร์ที่โควตาหกชั่วโมงหมดแล้ว = ไม่มีอะไรจะส่ง ไม่ใช่ฉบับที่มีแต่บรรทัด "และอีก N รายการ"
    if (chosen.length === 0 && crashLoops.length === 0 && !quota) return;

    const { subject, body } = compose(chosen, candidates.length - chosen.length, crashLoops, quota);
    const delivered = await sendToAll(subject, body);

    // ส่งถึงอย่างน้อยหนึ่งคน = แจ้งแล้ว ไม่ถึงใครเลย = ยังไม่ได้แจ้ง ฉบับหน้า (15 นาที) ลองใหม่ทั้งชุด
    const update: Document = {
      lastDigestAt: now,
      lastError: delivered === 0 ? "ส่งไม่สำเร็จทุกผู้รับ" : null,
      lastDigest: {
        at: now,
        issues: chosen.map((c) => ({ fingerprint: c.issue._id, trigger: c.trigger })),
        crashLoops: crashLoops.map((c) => c.service),
        overQuota: quota !== null,
        delivered,
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
        `${quota ? " · เกินเพดานขนาด" : ""} — ส่งถึง ${delivered}/${env.logStore.alertEmails.length} ผู้รับ ` +
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
 * ส่งถึงทุกผู้รับทีละคน (Office 365 รับการเชื่อมต่อพร้อมกันได้น้อย) คนละไม่เกิน 30 วินาที — คืนจำนวนที่ส่งถึง ไม่ throw
 * SMTP ที่ยังไม่ได้ตั้ง (dev) `sendRaw` พิมพ์แค่ผู้รับกับหัวเรื่อง จึงพิมพ์เนื้อความทั้งฉบับไว้ที่นี่ด้วย (ไม่มีข้อมูลบุคคล)
 *
 * **หมดเวลาแล้วหยุดทั้งรอบ** ไม่ส่งคนถัดไป: `withTimeout` เลิกรอ ไม่ได้ยกเลิก — การส่งที่ค้างยังถือการเชื่อมต่อของมันอยู่จนกว่า
 * transport แบบ `bounded` จะตัดเอง (lib/mail.ts) ถ้าส่งคนถัดไปเลย จะมีสองการเชื่อมต่อซ้อนกัน ซึ่งเป็นสิ่งที่ "ทีละฉบับ" มีไว้กัน
 * ผู้รับที่เหลือได้ฉบับหน้า (ถ้าไม่มีใครได้เลย ทั้งชุดถูกลองใหม่หลัง 15 นาที) ความล้มเหลวอื่น (ผู้รับถูกปฏิเสธ รหัสผ่านผิด) จบ
 * การเชื่อมต่อของมันแล้ว จึงส่งคนถัดไปต่อได้
 */
async function sendToAll(subject: string, body: string): Promise<number> {
  if (!env.smtp.enabled) console.log(`[error-alerts] (dry-run) เนื้อความ:\n${body}`);
  let delivered = 0;
  const recipients = env.logStore.alertEmails;
  for (const [index, to] of recipients.entries()) {
    if (stopped) break;
    try {
      await withTimeout(sendRaw(to, subject, body, { lineBreaks: true, bounded: true }), SEND_TIMEOUT_MS);
      delivered += 1;
    } catch (err) {
      captureThrottled("error-alerts.send", err);
      if (err instanceof SendTimeout) {
        console.warn(
          `[error-alerts] ส่งฉบับที่ ${index + 1}/${recipients.length} เกิน ${SEND_TIMEOUT_MS / 1000} วินาที — ` +
            "หยุดรอบนี้ ไม่เปิดการเชื่อมต่อใหม่ขณะที่ตัวเดิมยังค้าง",
        );
        break;
      }
    }
  }
  return delivered;
}

class SendTimeout extends Error {
  constructor(ms: number) {
    super(`ส่งอีเมลสรุปเกิน ${ms / 1000} วินาที`);
    this.name = "SendTimeout";
  }
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let handle: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    handle = setTimeout(() => reject(new SendTimeout(ms)), ms);
  });
  // การส่งที่ถูกเลิกรอแล้วล้มทีหลังต้องไม่กลายเป็น unhandled rejection
  work.catch(() => undefined);
  return Promise.race([work, timeout]).finally(() => clearTimeout(handle));
}

/** ความล้มเหลวของลูปนี้เก็บไม่เกินครั้งละสิบนาทีต่อ tag — SMTP หรือ Mongo ที่ล่มนานต้องไม่ได้ issue ใหม่ทุกนาที */
function captureThrottled(tag: string, err: unknown) {
  const now = Date.now();
  if (now - (lastCaptured.get(tag) ?? 0) < CAPTURE_EVERY_MS) return;
  lastCaptured.set(tag, now);
  captureError(err, { level: "warning", tag });
}
