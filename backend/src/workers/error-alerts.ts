/**
 * อีเมลสรุปปัญหาของระบบ (plan §5 "Alerting", step 10) — ลูปของตัวเองใน delivery-worker แยกจากลูปส่งอีเมลของ outbox
 *
 * **ปิดอยู่จนกว่าจะตั้ง `ERROR_ALERT_EMAILS`** (env.ts `logStore.alertEmails`) ปิดอยู่ลูปนี้ไม่เริ่มเลย issue ยังถูกเก็บตามปกติ
 *
 * **อะไรทำให้แจ้ง** (อ่านจาก log store ทุกนาที — `collect`):
 *   1. issue ใหม่ระดับ error ขึ้นไปที่ยังไม่เคยแจ้ง (`new`)
 *   2. issue ที่ปิดแล้วเกิดซ้ำ — `regressedAt` หลังการแจ้งครั้งล่าสุด (`regressed`) ข้ามช่วงพักหกชั่วโมง
 *   3. fatal ที่เกิดอีกหลังแจ้งไปแล้ว (`fatal`) และอีเมลที่ส่งไม่สำเร็จครบทุกครั้ง (`delivery:dead-letter:*` — `dead_letter`)
 *   4. 5xx ที่ route ตอบเองต่อเนื่อง — issue ระดับ warning ที่ fingerprint ขึ้นต้น `http:5xx:` มี event ตั้งแต่ 5 ตัวใน 15 นาที
 *      (`sustained_5xx` — 503 `no_reviewer`, `no_legal_documents`, 501 ThaID ไม่ได้ตั้งค่า) **ยกเว้น `log_access_disabled`**:
 *      นั่นคือคนลองเรียก API อ่าน log ที่ปิดไว้ ไม่ใช่ระบบเสีย
 *   5. วนรีสตาร์ต — ในชั่วโมงที่ผ่านมา service หนึ่งมี `fatal-exit` ตั้งแต่ 2 ครั้ง หรือ `start` ที่ไม่มี `shutdown` ของ service
 *      เดียวกันนำหน้าภายใน 60 วินาที ตั้งแต่ 3 ครั้ง (`crashLoops`) — restart ปกติและการสร้าง container ใหม่ตอน deploy มี
 *      shutdown นำหน้าเสมอ จึงไม่นับ (เทียบ service ไม่ใช่ container: deploy ได้ container ใหม่ ชื่อเครื่องใหม่)
 *   6. log store เกินเพดานขนาด (`relay_state.overQuota`) — ครั้งเดียวต่อครั้งที่เกิน
 *   warning อื่นไม่แจ้งเลย และ issue ที่ `ignored` ไม่แจ้งไม่ว่าอะไร
 *
 * **อัตรา:** สรุปไม่เกินหนึ่งฉบับต่อ 15 นาที ฉบับละไม่เกิน 20 issue (รายงานจากเบราว์เซอร์ไม่เกิน 5 ใน 20 นั้น — ใครก็ส่งมาได้
 * routes/client-errors.ts) issue หนึ่งแจ้งไม่เกินหนึ่งครั้งต่อหกชั่วโมง เว้นแต่เกิดซ้ำหลังปิด วนรีสตาร์ตของ service เดียวกันก็
 * หกชั่วโมง ที่เกิน 20 เหลือไว้ฉบับหน้า (ยังไม่ถูกนับว่าแจ้งแล้ว)
 *
 * **ส่งทีละฉบับ ทีละผู้รับ** ผ่าน `sendRaw()` เพดาน 30 วินาทีต่อฉบับ — Office 365 รับได้ราวสามการเชื่อมต่อพร้อมกัน (outbox ใช้
 * ไม่ได้: `recipient_user_id` เป็น NOT NULL และผู้รับพวกนี้ไม่ใช่บัญชีในระบบ) ส่งไม่ได้สักคน issue ยังไม่ถูกนับว่าแจ้งแล้ว
 * ฉบับหน้าลองใหม่หลัง 15 นาที ไม่ใช่ทุกนาที
 *
 * **ไม่มีข้อมูลบุคคลในอีเมล:** หัวเรื่องของ issue (ข้อความ error ที่ผ่าน lib/redact.ts แล้วตัด id กับตัวเลขทิ้ง), service, ที่เกิด
 * (แม่แบบของ route หรือของหน้า), จำนวน, เวลา, รุ่น, id ของ event และ fingerprint ที่เปิดดูใน Postman — ไม่มีผู้ใช้ IP อีเมล
 *
 * สถานะของลูปอยู่ในเอกสาร `relay_state` `_id: "error_alerts"` (`enabledAt`, `lastDigestAt`, `crashLoopAlertedAt`,
 * `overQuotaAlertedAt`, `lastError`) — worker เริ่มใหม่ก็ไม่ส่งซ้ำ และ issue ที่มีอยู่ก่อนเปิดการแจ้งเตือน (เห็นล่าสุดก่อน
 * `enabledAt`) ไม่ถูกแจ้งย้อนหลังทั้งกอง
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
const BROWSER_ISSUES_PER_DIGEST = 5;
const SEND_TIMEOUT_MS = 30_000;
const SUSTAINED_WINDOW_MS = 15 * 60_000;
const SUSTAINED_MIN_EVENTS = 5;
const CRASH_WINDOW_MS = 60 * 60_000;
const CRASH_FATAL_EXITS = 2;
const CRASH_UNEXPLAINED_STARTS = 3;
const START_AFTER_SHUTDOWN_MS = 60_000;
/** issue ที่อ่านมาพิจารณาต่อรอบ — มากกว่านี้ในรอบเดียวคือพายุ ฉบับละ 20 อยู่แล้ว */
const CANDIDATES_MAX = 200;
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
  /** จำนวน event ใน 15 นาทีล่าสุด — เฉพาะ `sustained_5xx` */
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

/** เริ่มลูป — ปิด log store หรือไม่มีผู้รับ ไม่ทำอะไร (บอกหนึ่งบรรทัดว่าทำไม) */
export function startErrorAlerts(): void {
  if (!env.logStore.enabled || timer || running) return;
  if (env.logStore.alertEmails.length === 0) {
    console.log("[error-alerts] ปิดอยู่ — ไม่ได้ตั้ง ERROR_ALERT_EMAILS (issue ยังถูกเก็บตามปกติ)");
    return;
  }
  stopped = false;
  console.log(`[error-alerts] เปิดอยู่ — ส่งสรุปถึง ${env.logStore.alertEmails.length} ผู้รับ ไม่เกินทุก 15 นาที`);
  schedule(FIRST_TICK_MS);
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
    if (!state?.enabledAt) {
      await states.updateOne({ _id: STATE_ID }, { $set: { enabledAt: now } }, { upsert: true, maxTimeMS: MONGO_COMMAND_MAX_MS });
      state = { ...(state ?? { _id: STATE_ID }), enabledAt: now };
    }
    const quota = await overQuotaChange(db, states, state);
    if (state.lastDigestAt && now.getTime() - state.lastDigestAt.getTime() < DIGEST_EVERY_MS) return;

    const candidates = await collect(db, state, now);
    const crashLoops = await crashLoopsOf(db, state, now);
    if (candidates.length === 0 && crashLoops.length === 0 && !quota) return;

    const chosen = choose(candidates);
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
 * คำสั่งเดียวกวาดตัวที่อาจเข้าข่าย แล้วแยกประเภทในโค้ด ข้อ 4 นับ event ของ 15 นาทีล่าสุดเพิ่มทีละ issue (index
 * `fingerprint, occurredAt`) — ตอนเกินเพดานขนาด event ไม่ถูกเก็บ ข้อ 4 จึงไม่ทำงาน แต่ข้อ 6 แจ้งเรื่องเพดานแทนแล้ว
 */
async function collect(db: Db, state: AlertState, now: Date): Promise<Candidate[]> {
  const cooledDown = new Date(now.getTime() - ISSUE_COOLDOWN_MS);
  const recentFrom = new Date(now.getTime() - SUSTAINED_WINDOW_MS);
  const filter: Filter<IssueDoc> = {
    status: "open",
    lastSeen: { $gte: state.enabledAt ?? now },
    $or: [
      { level: { $in: ["error", "fatal"] }, alertedAt: null },
      { regressedAt: { $ne: null } },
      { level: "fatal", alertedAt: { $lte: cooledDown } },
      { _id: { $regex: "^delivery:dead-letter:" }, alertedAt: { $lte: cooledDown } },
      {
        _id: { $regex: "^http:5xx:" },
        lastSeen: { $gte: recentFrom },
        $or: [{ alertedAt: null }, { alertedAt: { $lte: cooledDown } }],
      },
    ],
  };
  const issues = await db
    .collection<IssueDoc>("error_issues")
    .find(filter)
    .sort({ lastSeen: -1 })
    .limit(CANDIDATES_MAX)
    .maxTimeMS(MONGO_COMMAND_MAX_MS)
    .toArray();

  const candidates: Candidate[] = [];
  for (const issue of issues) {
    const trigger = triggerOf(issue, cooledDown);
    if (trigger === null) continue;
    if (trigger === "sustained_5xx") {
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

function triggerOf(issue: IssueDoc, cooledDown: Date): Trigger | null {
  const alertedAt = issue.alertedAt ?? null;
  if (issue.regressedAt && (!alertedAt || issue.regressedAt > alertedAt)) return "regressed";
  const cooled = !alertedAt || alertedAt <= cooledDown;
  const recurred = !alertedAt || (issue.lastSeen !== undefined && issue.lastSeen > alertedAt);
  if (issue.level === "fatal" && cooled && recurred) return "fatal";
  if (issue._id.startsWith("delivery:dead-letter:") && cooled && recurred) return "dead_letter";
  if ((issue.level === "error" || issue.level === "fatal") && !alertedAt) return "new";
  if (issue._id.startsWith("http:5xx:") && !issue._id.endsWith(":log_access_disabled") && cooled) return "sustained_5xx";
  return null;
}

/** ไม่เกิน 20 ตัวตามลำดับความสำคัญ ในนั้นเป็นรายงานจากเบราว์เซอร์ได้ไม่เกิน 5 ตัว (ยืนยันแหล่งที่มาไม่ได้) */
function choose(candidates: Candidate[]): Candidate[] {
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
      if (browser >= BROWSER_ISSUES_PER_DIGEST) continue;
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
 * ทุกค่ามาจาก `error_issues` ซึ่งกวาดข้อมูลส่วนบุคคลตั้งแต่ตอนเก็บ ไม่มีอะไรจากผู้ใช้หรือคำขอ
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
    const unverified = issue.service === "browser" ? " (รายงานจากเบราว์เซอร์ ยืนยันแหล่งที่มาไม่ได้)" : "";
    lines.push(`${index + 1}. [${TRIGGER_LABEL[candidate.trigger]}] ${(issue.title ?? "(ไม่มีหัวเรื่อง)").slice(0, 200)}${unverified}`);
    lines.push(
      `   service ${issue.service ?? "-"} · ระดับ ${issue.level ?? "-"} · ที่เกิด ${(issue.culprit ?? "-").slice(0, 120)}` +
        ` · ทั้งหมด ${issue.count ?? 0} ครั้ง${candidate.recent !== undefined ? ` (${candidate.recent} ครั้งใน 15 นาที)` : ""}`,
    );
    lines.push(
      `   พบครั้งแรก ${bangkok(issue.firstSeen)} · ล่าสุด ${bangkok(issue.lastSeen)} · รุ่น ${issue.firstRelease ?? "-"}` +
        `${issue.lastRelease && issue.lastRelease !== issue.firstRelease ? ` → ${issue.lastRelease}` : ""}`,
    );
    lines.push(`   event ล่าสุด ${issue.lastEventId ?? "-"} · เปิดดู: Postman E2 โดยตั้ง errorFingerprint = ${issue._id}`);
  });
  if (leftOver > 0) lines.push("", `และอีก ${leftOver} รายการ — จะอยู่ในสรุปฉบับถัดไป หรือเปิดดูทั้งหมดด้วย Postman E1`);
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

/**
 * ส่งถึงทุกผู้รับทีละคน (Office 365 รับการเชื่อมต่อพร้อมกันได้น้อย) คนละไม่เกิน 30 วินาที — คืนจำนวนที่ส่งถึง ไม่ throw
 * SMTP ที่ยังไม่ได้ตั้ง (dev) `sendRaw` พิมพ์แค่ผู้รับกับหัวเรื่อง จึงพิมพ์เนื้อความทั้งฉบับไว้ที่นี่ด้วย (ไม่มีข้อมูลบุคคล)
 */
async function sendToAll(subject: string, body: string): Promise<number> {
  if (!env.smtp.enabled) console.log(`[error-alerts] (dry-run) เนื้อความ:\n${body}`);
  let delivered = 0;
  for (const to of env.logStore.alertEmails) {
    if (stopped) break;
    try {
      await withTimeout(sendRaw(to, subject, body, { lineBreaks: true }), SEND_TIMEOUT_MS);
      delivered += 1;
    } catch (err) {
      captureThrottled("error-alerts.send", err);
    }
  }
  return delivered;
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let handle: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    handle = setTimeout(() => reject(new Error(`ส่งอีเมลสรุปเกิน ${ms / 1000} วินาที`)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(handle));
}

/** ความล้มเหลวของลูปนี้เก็บไม่เกินครั้งละสิบนาทีต่อ tag — SMTP หรือ Mongo ที่ล่มนานต้องไม่ได้ issue ใหม่ทุกนาที */
function captureThrottled(tag: string, err: unknown) {
  const now = Date.now();
  if (now - (lastCaptured.get(tag) ?? 0) < CAPTURE_EVERY_MS) return;
  lastCaptured.set(tag, now);
  captureError(err, { level: "warning", tag });
}
