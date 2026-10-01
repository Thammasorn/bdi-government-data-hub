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
 *   5. วนรีสตาร์ต — ในชั่วโมงที่ผ่านมา service หนึ่งมี `fatal-exit` ตั้งแต่ 2 ครั้ง หรือ `start` ที่**บันทึกก่อนหน้าของ container
 *      เดียวกัน**ไม่ใช่ `shutdown` และไม่มีป้าย `cleanExit` ตั้งแต่ 3 ครั้ง (`crashLoopsOf`) — process ก่อนหน้าตายโดยไม่ได้ปิดตาม
 *      ปกติ (SIGKILL, OOM, fatal) restart ปกติ หยุดแล้วเปิดใหม่ทีหลังนานเท่าไรก็ตาม และ container ใหม่ตอน deploy (ยังไม่มีบันทึก
 *      ของตัวเอง) ไม่นับ — **เมื่อการปิดนั้นทิ้งร่องรอยไว้ได้**: บันทึก `shutdown` ถึง Mongo หรือป้ายในไฟล์ของ container
 *      (lib/error-capture.ts) อยู่รอดถึงการเริ่มครั้งถัดไป restart ที่ไม่มีทั้งสองอย่าง (Mongo หยุดหรือล่มตอนปิด **และ** container
 *      เริ่มใหม่ด้วย filesystem ใหม่ในชื่อเครื่องเดิม หรือเขียนไฟล์ไม่ได้) ยังนับเป็นการเริ่มที่ไม่มีคำอธิบาย
 *   6. log store เกินเพดานขนาด (`relay_state.overQuota`) — ครั้งเดียวต่อครั้งที่เกิน
 *   warning อื่นไม่แจ้งเลย issue ที่ `ignored` ไม่แจ้งไม่ว่าอะไร และสองตัวนี้**ไม่แจ้งด้วยข้อไหนทั้งสิ้น** (`NEVER_ALERT`):
 *   `browser:chunk-load` กับ `http:5xx:…:log_access_disabled` — ตัวหลังคือคนลองเรียก API อ่าน log ที่ปิดไว้ ไม่ใช่ระบบเสีย
 *
 * **อัตรา:** สรุปฉบับใหม่ไม่เกินหนึ่งฉบับต่อ 15 นาที (การส่งซ้ำของฉบับที่ค้างนับแยก — "จังหวะมีสองตัว" ข้างล่าง) ฉบับละไม่เกิน
 * 20 issue issue หนึ่งแจ้งไม่เกินหนึ่งครั้งต่อหกชั่วโมง เว้นแต่เกิดซ้ำหลังปิด วนรีสตาร์ตของ service เดียวกันก็หกชั่วโมง ที่เกิน 20
 * เหลือไว้ฉบับหน้า (ยังไม่ถูกนับว่าแจ้งแล้ว)
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
 * เชื่อมต่อต่อไปได้เป็นนาที) ฉบับที่เกิน 30 วินาทีจบแค่การส่งถึง**ผู้รับคนนั้น** ไม่ใช่ทั้งรอบ คนถัดไปได้ส่งต่อ ทั้งรอบมีงบ
 * 90 วินาที (`ROUND_BUDGET_MS`) ครบแล้วไม่เริ่มฉบับใหม่ SMTP ที่ช้ากับทุกคนจึงถือลูปนี้ไว้ไม่เกินราวสองนาที ผู้รับที่ช้าในรอบก่อน
 * และผู้รับที่ยังค้างฉบับเก่าถูกเรียงไว้ท้ายคิว (`deliverRound`) — คนที่อยู่หลังคนช้าในรายชื่อไม่ต้องรอคนช้าทุกรอบ
 *
 * **ฉบับที่ค้างไม่กั้นฉบับใหม่** (`pending`): ผู้รับที่ยังไม่ได้ฉบับหนึ่ง — หมดเวลา ล้มชั่วคราว (ต่อไม่ได้ เงียบเกิน 20 วินาที
 * SMTP ตอบ 4xx login ของระบบไม่ผ่าน — `permanentFailure`) หรือไม่ได้ลองเพราะงบของรอบหมด — ถูกจดเป็น key ของที่อยู่
 * (`recipientKey`) พร้อมหัวเรื่องกับเนื้อความของฉบับนั้น ฉบับนั้น**ต่อท้ายฉบับใหม่ถัดไปของผู้รับคนนั้นในอีเมลเดียวกัน**
 * (`messageFor`) หรือถ้ายังไม่มีฉบับใหม่ ส่งซ้ำลำพังโดยหัวเรื่องบอกว่า "ส่งช้า" เก็บไม่เกิน 3 ฉบับ ฉบับละไม่เกินหกชั่วโมง ตัวที่ SMTP
 * ปฏิเสธถาวร (ไม่มีผู้รับนี้ ไม่รับเนื้อความนี้) ไม่ถูกเก็บ ส่งซ้ำก็ได้ผลเดิม — ฉบับที่เขาค้างอยู่ถูกทิ้งพร้อมบรรทัดเตือน
 *
 * **จังหวะมีสองตัว แยกกัน:** ฉบับใหม่ไม่เกินหนึ่งฉบับต่อ 15 นาที นับจาก `lastDigestAt` ซึ่งขยับเฉพาะรอบที่มีฉบับใหม่ · การส่งซ้ำ
 * ลำพังของฉบับที่ค้างไม่เกินหนึ่งครั้งต่อ 15 นาที**ต่อผู้รับ** นับจากเวลาที่ลองส่งถึงเขาครั้งล่าสุด (`triedAt`, `lateDue`) ผู้รับ
 * หนึ่งคนจึงได้ไม่เกินสองอีเมลในช่วง 15 นาทีใด ๆ (ส่งซ้ำหนึ่ง ฉบับใหม่หนึ่ง) และ fatal วนรีสตาร์ต หรือเกินเพดานที่เกิดหลังการส่งซ้ำ
 * ออกในนาทีถัดไปถึงทุกคน ไม่ต้องรอ
 *
 * เดิม (6407cb5) ฉบับที่ค้างถูกส่งแยกเป็นอีเมลของมันเองก่อนประกอบฉบับใหม่ และรอบหยุดที่ฉบับแรกที่เกิน 30 วินาที ผู้รับที่ช้าตลอด
 * คนเดียวจึงกั้น**ทุก**การแจ้งใหม่ (fatal วนรีสตาร์ต เกินเพดาน) ของ**ทุกคน**ไว้จนฉบับที่ค้างหมดอายุหกชั่วโมง ผู้รับที่อยู่หลังเขา
 * ไม่ได้อะไรเลย และผู้รับที่ล้มชั่วคราวซ้ำ ๆ ได้ฉบับที่ค้างทีละฉบับบวกฉบับใหม่ — สี่อีเมลในรอบเดียว (ตรวจแบบค้าน 2026-10-01)
 * รอบแก้แรก (ea9ccbb) ยังให้รอบที่ส่งซ้ำอย่างเดียวขยับ `lastDigestAt`: ผู้รับคนเดียวที่ค้างอะไรอยู่ทำให้ fatal ใหม่ของ**ทุกคน**
 * (รวมคนที่ไม่ค้างอะไร) รอได้ถึง 15 นาที ทุกช่วงจนฉบับที่ค้างหมดอายุ — ลองจริงแบบ dry-run: fatal ที่เกิดสิบวินาทีหลังการส่งซ้ำยัง
 * ไม่ออกหลังห้านาที (ตรวจแบบค้านรอบสอง 2026-10-01) และ 5xx ทุกตัวนับเป็นถาวร รหัสผ่านของบัญชีส่งที่เปลี่ยนจึงทิ้งฉบับที่ค้างทั้งหมด
 * เงียบ ๆ
 *
 * issue ในฉบับใหม่ถูกนับว่าแจ้งแล้วเมื่อฉบับนั้นถึงผู้รับอย่างน้อยหนึ่งคน (คนที่ยังไม่ได้อยู่ใน `pending`) ถึงไม่ได้สักคน issue
 * ยังไม่ถูกนับ และไม่มีอะไรถูกเก็บ ฉบับหน้าประกอบใหม่ทั้งชุดหลัง 15 นาที ไม่ใช่ทุกนาที — `lastError` (`alertError`) บอกทั้งสองกรณี
 * และบอกผู้รับที่ SMTP ปฏิเสธถาวร ผู้รับที่ช้า และผู้รับที่ไม่ได้ลองเพราะงบหมด
 *
 * **ไม่มีข้อมูลบุคคลในอีเมล:** หัวเรื่องของ issue ของ server (ข้อความ error ที่ผ่าน lib/redact.ts แล้วตัด id กับตัวเลขทิ้ง), service,
 * ที่เกิด (แม่แบบของ route), จำนวน, เวลา, รุ่น, id ของ event และ fingerprint ที่เปิดดูใน Postman — ไม่มีผู้ใช้ IP อีเมล
 *
 * สถานะของลูปอยู่ในเอกสาร `relay_state` `_id: "error_alerts"` (`enabled`, `recipients`, `checkedAt`, `enabledAt`,
 * `lastDigestAt`, `crashLoopAlertedAt`, `overQuotaAlertedAt`, `lastError`, `pending`, `slow`, `triedAt`) — worker เริ่มใหม่ก็ไม่ส่งซ้ำ
 * และ issue ที่มีอยู่ก่อนเปิดการแจ้งเตือน (เห็นล่าสุดก่อน `enabledAt`) ไม่ถูกแจ้งย้อนหลังทั้งกอง `enabled` กับ `checkedAt` คือคำของ
 * worker เองว่าตอนนี้เปิดอยู่ไหม (`GET /api/admin/logs/status` แสดง) — เปิดอยู่เขียนทุกนาทีและก่อนทุกฉบับระหว่างรอบ (`heartbeatOf`)
 * ปิดอยู่เขียนครั้งเดียวตอนเริ่มพร้อมล้าง `enabledAt` เปิดกลับมาจึงนับใหม่จากตอนนั้น ไม่ใช่แจ้งทุกอย่างที่เกิดระหว่างที่ปิด
 */
import { createHmac, randomBytes } from "node:crypto";

import type { Collection, Db, Document, Filter } from "mongodb";

import { env } from "../env.js";
import { captureError } from "../lib/error-capture.js";
import { RUNTIME_EVENT_DAYS } from "../lib/log-retention.js";
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
/** งบเวลาของหนึ่งรอบ ครบแล้วไม่เริ่มส่งฉบับใหม่ — รอบหนึ่งยาวไม่เกินงบนี้บวกหนึ่งฉบับ (หัวไฟล์ "ส่งทีละฉบับ") */
const ROUND_BUDGET_MS = 90_000;
/** ฉบับที่ยังส่งไม่ถึงผู้รับบางคน เก็บไว้ส่งซ้ำไม่เกินเท่านี้ฉบับ ฉบับละไม่เกินหกชั่วโมง (หัวไฟล์ "ฉบับที่ค้างไม่กั้นฉบับใหม่") */
const PENDING_MAX = 3;
const PENDING_MAX_AGE_MS = 6 * 60 * 60_000;
/** เนื้อความที่เก็บไว้ส่งซ้ำยาวไม่เกินนี้ — ฉบับจริงยี่สิบ issue ราว 15 KB เอกสารของ relay_state ต้องไม่โตไม่รู้จบ */
const PENDING_BODY_MAX = 32_000;
const SUSTAINED_WINDOW_MS = 15 * 60_000;
const SUSTAINED_MIN_EVENTS = 5;
const CRASH_WINDOW_MS = 60 * 60_000;
const CRASH_FATAL_EXITS = 2;
const CRASH_UNEXPLAINED_STARTS = 3;
/** บันทึกของ process ในชั่วโมงที่อ่านมาพิจารณา — ตัวใหม่สุดก่อน วนรีสตาร์ตจริงไม่ถึงหลักพันต่อชั่วโมง (restart policy มี backoff) */
const CRASH_EVENTS_MAX = 2_000;
/** ย้อนหาบันทึกก่อนหน้าของ container ได้ไกลเท่าอายุของ `runtime_events` (lib/log-retention.ts) — เก่ากว่านั้นไม่เหลือให้หา */
const CRASH_LOOKBACK_MS = RUNTIME_EVENT_DAYS * 24 * 60 * 60_000;
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
  /** key ของผู้รับที่ช้าในรอบล่าสุดที่ส่งถึงเขา (`RoundResult.slow`) — รอบหน้าอยู่ท้ายคิว อ่านผ่าน `slowKeys` */
  slow?: unknown;
  /**
   * `{key ของผู้รับ: เวลาที่ลองส่งถึงเขาครั้งล่าสุด}` เฉพาะผู้รับที่ยังค้างฉบับเก่า — จังหวะของการส่งซ้ำต่อคน (`lateDue`) ไม่ใช่
   * `lastDigestAt` อ่านผ่าน `triedTimes`
   */
  triedAt?: unknown;
}

/** ฉบับหนึ่งที่ยังส่งไม่ถึงผู้รับบางคน (หัวไฟล์ "ฉบับที่ค้างไม่กั้นฉบับใหม่") */
interface PendingDigest {
  createdAt: Date;
  subject: string;
  body: string;
  /** ผู้รับที่ยังไม่ได้ — key ของที่อยู่ (`recipientKey`) ไม่ใช่ตัวที่อยู่ log store ไม่ต้องถืออีเมลของใคร */
  recipients: string[];
}

interface Message {
  subject: string;
  body: string;
}

/** ผลของหนึ่งรอบ (`deliverRound`) — ทุกชุดเป็น key ของผู้รับ (`recipientKey`) */
interface RoundResult {
  /** ผู้รับที่รอบนี้ต้องส่งให้ — ทุกคนเมื่อมีฉบับใหม่ ไม่งั้นเฉพาะคนที่ค้างฉบับเก่าและถึงจังหวะส่งซ้ำ (`lateDue`) */
  addressed: Set<string>;
  /** ได้ลองส่งจริงในรอบนี้ (ผลเป็นอะไรก็ตาม) — ไม่รวมคนที่ไม่ได้ลองเพราะงบของรอบหมด */
  attempted: Set<string>;
  /** ได้อีเมลของตัวเองในรอบนี้แล้ว (ฉบับใหม่ ถ้ามี พร้อมทุกฉบับที่ค้างของเขา) */
  delivered: Set<string>;
  /**
   * SMTP ปฏิเสธถาวร (5xx ต่อผู้รับหรือต่อเนื้อความ — `permanentFailure`) — ส่งซ้ำก็ได้ผลเดิม จึงไม่ถูกเก็บไว้ส่งซ้ำ ฉบับที่เขา
   * ค้างอยู่ถูกทิ้งพร้อมบรรทัดเตือน และ `lastError` บอก
   */
  rejected: Set<string>;
  /** ยังไม่ได้และควรลองอีก: หมดเวลา ล้มชั่วคราว หรือไม่ได้ลองเพราะงบของรอบหมด / worker กำลังหยุด */
  missed: Set<string>;
  /** ส่งเกิน 30 วินาทีในรอบนี้ หรือช้าในรอบก่อนแล้วรอบนี้ไม่ได้ลอง — รอบหน้าอยู่ท้ายคิว */
  slow: Set<string>;
  /** ไม่ได้ลองเพราะงบของรอบหมด หรือ worker กำลังหยุด */
  skipped: number;
  /** ฉบับที่ค้างซึ่งส่งถึงแล้วในรอบนี้ นับต่อผู้รับ */
  late: number;
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

    const configured = new Map(env.logStore.alertEmails.map((address) => [recipientKey(address), address]));
    const carried = carriedPending(state.pending, configured, now);
    const tried = triedTimes(state.triedAt, configured);
    const slowBefore = slowKeys(state.slow, configured);
    // ฉบับใหม่ไม่เกินหนึ่งฉบับต่อ 15 นาที นับจากฉบับใหม่ล่าสุด**เท่านั้น** — การส่งซ้ำของฉบับที่ค้างมีจังหวะต่อผู้รับของมันเอง
    // (`lateDue`) และไม่ย้าย `lastDigestAt` (หัวไฟล์ "ฉบับที่ค้างไม่กั้นฉบับใหม่")
    const digestDue = !state.lastDigestAt || now.getTime() - state.lastDigestAt.getTime() >= DIGEST_EVERY_MS;
    let chosen: Candidate[] = [];
    let crashLoops: CrashLoop[] = [];
    let fresh: Message | null = null;
    if (digestDue) {
      const browserBudget = await browserBudgetOf(db, now);
      const candidates = await collect(db, state, now, browserBudget);
      crashLoops = await crashLoopsOf(db, state, now);
      chosen = choose(candidates, browserBudget);
      // มีแค่ issue เบราว์เซอร์ที่โควตาหกชั่วโมงหมดแล้ว = ไม่มีเรื่องใหม่ ไม่ใช่ฉบับที่มีแต่บรรทัด "และอีก N รายการ"
      fresh =
        chosen.length > 0 || crashLoops.length > 0 || quota
          ? compose(chosen, candidates.length - chosen.length, crashLoops, quota)
          : null;
    }
    // ไม่มีฉบับใหม่: ส่งเฉพาะคนที่ค้างและถึงจังหวะส่งซ้ำของเขา · มีฉบับใหม่: ทุกคน (คนที่ค้างได้ฉบับเก่าต่อท้าย)
    const lateKeys = fresh ? null : lateDue(carried.pending, tried, now);
    if (lateKeys !== null && lateKeys.size === 0) {
      // ไม่มีอะไรต้องส่งตอนนี้ — ฉบับที่ค้างหมดอายุหรือผู้รับถูกถอดออก จดสิ่งที่เหลือ
      if (carried.changed) {
        const set: Document = { pending: carried.pending, triedAt: triedFor(carried.pending, tried) };
        if (carried.pending.length === 0) set.lastError = null;
        await states.updateOne({ _id: STATE_ID }, { $set: set }, { upsert: true, maxTimeMS: MONGO_COMMAND_MAX_MS });
      }
      return;
    }

    // หนึ่งอีเมลต่อผู้รับ: ฉบับใหม่ (ถ้ามี) ต่อด้วยทุกฉบับที่เขายังค้าง — ฉบับที่ค้างไม่กั้นฉบับใหม่ (หัวไฟล์)
    const round = await deliverRound(fresh, carried.pending, configured, slowBefore, lateKeys, heartbeatOf(states));
    // ฉบับที่ค้าง: คนที่ได้อีเมลของรอบนี้ (ซึ่งรวมฉบับนั้นไว้) หลุดออก คนที่ SMTP ปฏิเสธถาวรหลุดออกพร้อมบรรทัดเตือน ที่เหลือ —
    // ยังไม่ถึง ไม่ได้ลองเพราะงบหมด หรือยังไม่ถึงจังหวะส่งซ้ำของเขา — ค้างต่อ
    let pending = carried.pending
      .map((item) => {
        const rejected = item.recipients.filter((key) => round.rejected.has(key));
        if (rejected.length > 0) warnDropped({ ...item, recipients: rejected }, "SMTP ปฏิเสธถาวร");
        return {
          ...item,
          recipients: item.recipients.filter((key) => !round.delivered.has(key) && !round.rejected.has(key)),
        };
      })
      .filter((item) => item.recipients.length > 0);
    const delivered = fresh ? round.delivered.size : 0;
    // ฉบับใหม่ถึงบางคนแต่ไม่ครบ — คนที่ยังไม่ได้ได้ฉบับนี้รวมกับอีเมลรอบหน้า (ไม่ถึงใครเลย = ไม่เก็บ ฉบับหน้าประกอบใหม่ทั้งชุด)
    if (fresh && delivered > 0 && round.missed.size > 0) {
      pending.push({
        createdAt: now,
        subject: fresh.subject,
        body: fresh.body.slice(0, PENDING_BODY_MAX),
        recipients: [...round.missed],
      });
      if (pending.length > PENDING_MAX) {
        for (const dropped of pending.slice(0, pending.length - PENDING_MAX)) warnDropped(dropped, "เก็บได้ไม่เกิน 3 ฉบับ");
        pending = pending.slice(-PENDING_MAX);
      }
    }

    // เวลาที่ลองส่งถึงแต่ละคนล่าสุด — จังหวะส่งซ้ำของคนที่ยังค้าง ผู้รับที่ไม่ได้ลองรอบนี้ (งบหมด) ไม่ถูกเลื่อน จึงได้ลองในนาทีถัดไป
    const triedAfter = new Map(tried);
    for (const key of round.attempted) triedAfter.set(key, now);
    // ผู้รับที่ช้า: ของรอบนี้ แทนของรอบก่อน**เฉพาะคนที่รอบนี้ส่งถึง** — รอบส่งซ้ำที่ส่งแค่บางคนต้องไม่ลบความช้าของคนอื่นทิ้ง
    const slow = new Set([...slowBefore].filter((key) => !round.addressed.has(key)));
    for (const key of round.slow) slow.add(key);

    // ส่งถึงอย่างน้อยหนึ่งคน = แจ้งแล้ว (คนที่ยังไม่ได้อยู่ใน `pending`) ไม่ถึงใครเลย = ยังไม่ได้แจ้ง ฉบับหน้า (15 นาที) ลองใหม่ทั้งชุด
    // `lastDigestAt` ขยับเฉพาะรอบที่มีฉบับใหม่ (ถึงหรือไม่ถึงใครก็ตาม — SMTP ล่มต้องไม่ได้การลองทั้งรายชื่อทุกนาที)
    const update: Document = {
      lastError: alertError(pending, fresh !== null && delivered === 0, round, slow),
      pending,
      slow: [...slow],
      triedAt: triedFor(pending, triedAfter),
      // รอบหนึ่งยาวได้ราวสองนาที — บอกว่ายังวิ่งอยู่ตอนจบด้วย ไม่ใช่แค่ตอนเริ่ม (`heartbeatOf`)
      checkedAt: new Date(),
    };
    if (fresh) {
      update.lastDigestAt = now;
      update.lastDigest = {
        at: now,
        issues: chosen.map((c) => ({ fingerprint: c.issue._id, trigger: c.trigger })),
        crashLoops: crashLoops.map((c) => c.service),
        overQuota: quota !== null,
        delivered,
        rejected: round.rejected.size,
        missed: round.missed.size,
        slow: round.slow.size,
        skipped: round.skipped,
        late: round.late,
        recipients: configured.size,
      };
    }
    if (fresh && delivered > 0) {
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
    const head = fresh
      ? `สรุป ${chosen.length} issue` +
        `${crashLoops.length > 0 ? ` · วนรีสตาร์ต ${crashLoops.map((c) => c.service).join(", ")}` : ""}` +
        `${quota ? " · เกินเพดานขนาด" : ""}`
      : "ไม่มีเรื่องใหม่ ส่งเฉพาะสรุปที่ค้าง";
    console.log(
      `[error-alerts] ${head} — ส่งถึง ${round.delivered.size}/${round.addressed.size} ผู้รับ` +
        `${round.late > 0 ? ` · รวมสรุปที่ค้าง ${round.late} ฉบับ` : ""}` +
        `${round.rejected.size > 0 ? ` · ถูกปฏิเสธ ${round.rejected.size}` : ""}` +
        `${
          fresh && delivered === 0
            ? " · ไม่ถึงใครเลย (issue ยังไม่ถูกนับว่าแจ้งแล้ว ประกอบใหม่ในรอบหน้า)"
            : round.missed.size > 0
              ? ` · ยังไม่ถึง ${round.missed.size} (รวมไว้ในอีเมลรอบหน้าของผู้รับนั้น)`
              : ""
        }` +
        `${fresh ? ` (${chosen.map((c) => `${c.trigger}:${shortFingerprint(c.issue._id)}`).join(" ") || "ไม่มี issue"})` : ""}`,
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

interface RuntimeRecord {
  at: Date;
  service: string;
  kind: string;
  host?: { containerId?: unknown };
  /** `cleanExit: true` บน `start` = process ก่อนหน้าใน container นี้ปิดตามปกติ (lib/error-capture.ts `recordRuntimeEvent`) */
  detail?: { cleanExit?: unknown } | null;
}

/**
 * service ที่วนรีสตาร์ตในชั่วโมงที่ผ่านมา (ข้อ 5 ของหัวไฟล์) และยังไม่ได้แจ้งภายในหกชั่วโมง — จาก `runtime_events`
 * ที่ backend กับ worker เขียนตอนเริ่ม ปิด และตาย (lib/error-capture.ts `recordRuntimeEvent`)
 *
 * **`start` ที่ไม่มีคำอธิบาย** = บันทึกก่อนหน้าของ container เดียวกัน (service + `host.containerId` ซึ่งคือชื่อเครื่องของ
 * container — restart policy เริ่ม container เดิม ชื่อเดิม) ไม่ใช่ `shutdown`: เป็น `start` (process ก่อนตายโดยไม่ได้บันทึกอะไร —
 * SIGKILL, OOM) หรือ `fatal-exit` **และ** ตัว `start` เองไม่มี `detail.cleanExit` บันทึกก่อนหน้าเป็น `shutdown` หรือตัว start
 * มี `cleanExit` = ปิดตามปกติ ไม่ว่าจะเปิดใหม่หลังจากนั้นนานเท่าไร container ที่ยังไม่มีบันทึกก่อนหน้าเลย (deploy สร้างใหม่ ชื่อใหม่ —
 * ตัวเก่าบันทึก shutdown ของมันเองไว้แล้ว) ก็ไม่นับ บันทึกก่อนหน้าของ start แรกในชั่วโมงอาจอยู่ก่อนชั่วโมงนั้น จึงหาแยกหนึ่งคำสั่ง
 * (ย้อนได้เท่าอายุของ `runtime_events`)
 *
 * **ทำไมต้องมี `cleanExit`:** บันทึก `shutdown` เดินทางผ่านคิวในหน่วยความจำ และตอนปิดมีเวลา flush สองวินาที Mongo ที่กำลังหยุดหรือ
 * ล่มอยู่ตอนนั้น (`docker compose restart` ทั้ง stack, stop/start ทั้ง project, daemon หรือเครื่องรีบูต, restart backend ระหว่าง
 * Mongo ล่ม) ทำให้บันทึกนั้นหาย — `docker compose restart mongo backend delivery-worker` สามรอบได้ "เริ่มใหม่โดยไม่ได้ปิดตามปกติ
 * 3 ครั้ง" ของทั้ง backend และ worker (ตรวจขั้น 10 แบบค้าน 2026-10-01) process ที่ปิดตามปกติจึงเขียนป้ายลงไฟล์ใน container ด้วย
 * และ `start` ถัดไปประทับ `cleanExit: true` (lib/error-capture.ts `recordRuntimeEvent`) ป้ายอยู่รอด restart กับ stop/start ของ
 * container เดิม แต่ไม่รอด container ที่ถูกเริ่มด้วย filesystem ใหม่ในชื่อเครื่องเดิม (Kubernetes / Container Apps เริ่ม container
 * ใหม่ใน replica เดิม) หรือ root filesystem ที่เขียนไม่ได้ — ตรงนั้น restart ที่บันทึก `shutdown` ไปไม่ถึง Mongo ยังนับ
 *
 * เดิมนับ start ที่ไม่มี `shutdown` ของ service เดียวกันภายใน 60 วินาทีก่อนหน้า ตามถ้อยคำของแผน: `docker compose stop backend`
 * แล้ว `start` หลังจากนั้นเกินหนึ่งนาที สามรอบในชั่วโมงเดียว (ปิดตามปกติทุกรอบ — ทดสอบหน้า 502 ของ proxy) ได้อีเมล "วนรีสตาร์ต
 * backend" จริงใน checkout นี้ (2026-10-01 01:04Z) deploy ที่ build ระหว่างหยุดกับเริ่มก็เข้าข่ายเดียวกัน และเทียบทั้ง service
 * ทำให้ replica หลายตัว (Azure) ที่เริ่มพร้อมกันหลังปิดตัวเดียวนับเป็นการล่ม เดิมยังอ่านบันทึกเก่าสุดสองพันตัว ไม่ใช่ใหม่สุด
 */
async function crashLoopsOf(db: Db, state: AlertState, now: Date): Promise<CrashLoop[]> {
  const runtime = db.collection<RuntimeRecord>("runtime_events");
  const windowStart = new Date(now.getTime() - CRASH_WINDOW_MS);
  const recent = await runtime
    .find(
      { at: { $gte: windowStart } },
      { projection: { at: 1, service: 1, kind: 1, "host.containerId": 1, "detail.cleanExit": 1 } },
    )
    .sort({ at: -1 })
    .limit(CRASH_EVENTS_MAX)
    .maxTimeMS(MONGO_COMMAND_MAX_MS)
    .toArray();
  // แยกตาม container (service + ชื่อเครื่อง) เรียงเก่าไปใหม่
  const homes = new Map<
    string,
    { service: string; containerId: string | null; events: Array<{ at: number; kind: string; cleanExit: boolean }> }
  >();
  for (const event of recent.reverse()) {
    if (!(event.at instanceof Date) || typeof event.service !== "string" || typeof event.kind !== "string") continue;
    const containerId = typeof event.host?.containerId === "string" ? event.host.containerId : null;
    const key = homeKey(event.service, containerId);
    const home = homes.get(key) ?? { service: event.service, containerId, events: [] };
    home.events.push({ at: event.at.getTime(), kind: event.kind, cleanExit: event.detail?.cleanExit === true });
    homes.set(key, home);
  }
  if (homes.size === 0) return [];
  const withStart = [...homes.values()].filter((home) => home.events.some((event) => event.kind === "start"));

  // บันทึกสุดท้ายของแต่ละ container ก่อนชั่วโมงนี้ — บอกว่า start แรกในชั่วโมงตามหลังการปิดตามปกติหรือเปล่า
  const before = new Map<string, string>();
  if (withStart.length > 0) {
    const rows = await runtime
      .aggregate<{ _id: { service?: unknown; containerId?: unknown }; kind?: unknown }>(
        [
          {
            $match: {
              at: { $lt: windowStart, $gte: new Date(now.getTime() - CRASH_LOOKBACK_MS) },
              service: { $in: [...new Set(withStart.map((home) => home.service))] },
              "host.containerId": { $in: [...new Set(withStart.map((home) => home.containerId))] },
            },
          },
          { $sort: { at: -1 } },
          { $group: { _id: { service: "$service", containerId: "$host.containerId" }, kind: { $first: "$kind" } } },
        ],
        { maxTimeMS: MONGO_COMMAND_MAX_MS },
      )
      .toArray();
    for (const row of rows) {
      if (typeof row._id.service !== "string" || typeof row.kind !== "string") continue;
      const containerId = typeof row._id.containerId === "string" ? row._id.containerId : null;
      before.set(homeKey(row._id.service, containerId), row.kind);
    }
  }

  const perService = new Map<string, { fatalExits: number; unexplainedStarts: number }>();
  for (const [key, home] of homes) {
    const counts = perService.get(home.service) ?? { fatalExits: 0, unexplainedStarts: 0 };
    let previous = before.get(key) ?? null;
    for (const event of home.events) {
      if (event.kind === "fatal-exit") counts.fatalExits += 1;
      if (event.kind === "start" && !event.cleanExit && previous !== null && previous !== "shutdown") {
        counts.unexplainedStarts += 1;
      }
      previous = event.kind;
    }
    perService.set(home.service, counts);
  }

  const loops: CrashLoop[] = [];
  for (const [service, { fatalExits, unexplainedStarts }] of perService) {
    if (fatalExits < CRASH_FATAL_EXITS && unexplainedStarts < CRASH_UNEXPLAINED_STARTS) continue;
    const alertedAt = state.crashLoopAlertedAt?.[service];
    if (alertedAt instanceof Date && now.getTime() - alertedAt.getTime() < ISSUE_COOLDOWN_MS) continue;
    loops.push({ service, fatalExits, unexplainedStarts });
  }
  return loops;
}

function homeKey(service: string, containerId: string | null): string {
  return `${service}\0${containerId ?? ""}`;
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
        `เบราว์เซอร์ ${BROWSER_ALERTS_PER_WINDOW} รายการต่อ 6 ชั่วโมง) — เปิดดูทั้งหมดด้วย Postman E1`,
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
        "ของ issue ไม่เก็บ error ทีละตัว (ดู Postman S1 และ docs/21 เรื่องเพดานขนาด)",
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
 * หนึ่งรอบของการส่ง: ผู้รับหนึ่งคนได้อีเมลเดียว (`messageFor` — ฉบับใหม่ต่อด้วยทุกฉบับที่เขาค้าง) ทีละคน ไม่มีสองการเชื่อมต่อ
 * ซ้อนกัน (Office 365 รับการเชื่อมต่อพร้อมกันได้น้อย) คนละไม่เกิน 30 วินาที — ไม่ throw ไม่มีฉบับใหม่ (`fresh` null) ส่งเฉพาะคน
 * ที่ค้างและอยู่ใน `lateKeys` (ถึงจังหวะส่งซ้ำ — `lateDue`) `beat` ถูกเรียกก่อนทุกฉบับ (`heartbeatOf` — ไม่รอ)
 * SMTP ที่ยังไม่ได้ตั้ง (dev) `sendRaw` พิมพ์แค่ผู้รับกับหัวเรื่อง จึงพิมพ์เนื้อความไว้ที่นี่ด้วย (ไม่มีข้อมูลบุคคล)
 *
 * **ลำดับ:** คนที่ไม่ค้างอะไร → คนที่ค้างฉบับเก่า → คนที่ช้าในรอบก่อน (`slowBefore`) ตามลำดับในรายชื่อภายในแต่ละกลุ่ม ผู้รับที่ช้า
 * ตลอดจึงอยู่ท้ายเสมอ และกินงบของรอบหลังคนอื่นได้ของไปแล้ว
 *
 * **ฉบับที่เกิน 30 วินาทีจบแค่ผู้รับคนนั้น** (`slow` + `missed`) lib/mail.ts ปิดการเชื่อมต่อของมันแล้ว จึงส่งคนถัดไปต่อได้โดยไม่มี
 * การเชื่อมต่อซ้อน เดิมทั้งรอบหยุดที่ตรงนั้น ผู้รับที่ตามหลังคนช้าจึงไม่เคยได้อะไร (ตรวจแบบค้าน 2026-10-01) ทั้งรอบมีงบ
 * `ROUND_BUDGET_MS` ครบแล้วไม่เริ่มฉบับใหม่ — ที่เหลือเป็น `missed` และ `skipped` SMTP ที่ปฏิเสธผู้รับหรือเนื้อความถาวร
 * (`permanentFailure`) นับเป็น `rejected` ไม่ลองซ้ำ ความล้มเหลวอื่น (ต่อไม่ได้ เงียบเกิน 20 วินาที ตอบ 4xx รหัสผ่านของระบบผิด)
 * ชั่วคราว อยู่ใน `missed`
 */
async function deliverRound(
  fresh: Message | null,
  pending: PendingDigest[],
  configured: Map<string, string>,
  slowBefore: Set<string>,
  lateKeys: Set<string> | null,
  beat: () => void,
): Promise<RoundResult> {
  const lateFor = new Map<string, PendingDigest[]>();
  for (const item of pending) {
    for (const key of item.recipients) lateFor.set(key, [...(lateFor.get(key) ?? []), item]);
  }
  const rank = (key: string) => (slowBefore.has(key) ? 2 : lateFor.has(key) ? 1 : 0);
  const order = [...configured]
    .filter(([key]) => fresh !== null || (lateKeys?.has(key) === true && lateFor.has(key)))
    .map(([key, address], index) => ({ key, address, index }))
    .sort((a, b) => rank(a.key) - rank(b.key) || a.index - b.index);
  const result: RoundResult = {
    addressed: new Set(order.map((entry) => entry.key)),
    attempted: new Set(),
    delivered: new Set(),
    rejected: new Set(),
    missed: new Set(),
    slow: new Set(),
    skipped: 0,
    late: 0,
  };
  if (!env.smtp.enabled && fresh) console.log(`[error-alerts] (dry-run) เนื้อความ:\n${fresh.body}`);
  const startedAt = Date.now();
  for (const [position, { key, address }] of order.entries()) {
    const late = lateFor.get(key) ?? [];
    if (stopped || Date.now() - startedAt >= ROUND_BUDGET_MS) {
      result.missed.add(key);
      if (slowBefore.has(key)) result.slow.add(key);
      result.skipped += 1;
      continue;
    }
    const message = messageFor(fresh, late);
    if (!env.smtp.enabled && late.length > 0) {
      console.log(
        `[error-alerts] (dry-run) ฉบับที่ ${position + 1}/${order.length} รวมสรุปที่ค้าง ${late.length} ฉบับ:\n${message.body}`,
      );
    }
    // บอกว่าลูปยังวิ่งก่อนทุกฉบับ — รอบที่ช้ายาวได้ถึงงบ 90 วินาทีบวกหนึ่งฉบับ `checkedAt` ต้องไม่ค้างตลอดช่วงนั้น
    beat();
    result.attempted.add(key);
    try {
      await sendRaw(address, message.subject, message.body, { lineBreaks: true, timeoutMs: SEND_TIMEOUT_MS });
      result.delivered.add(key);
      result.late += late.length;
    } catch (err) {
      captureThrottled("error-alerts.send", err);
      if (permanentFailure(err)) {
        result.rejected.add(key);
        continue;
      }
      result.missed.add(key);
      if (err instanceof SendDeadlineError) {
        result.slow.add(key);
        console.warn(
          `[error-alerts] ส่งฉบับที่ ${position + 1}/${order.length} เกิน ${SEND_TIMEOUT_MS / 1000} วินาที — ปิดการเชื่อมต่อแล้ว ` +
            "ส่งผู้รับคนถัดไปต่อ ผู้รับคนนี้ได้ฉบับนี้รวมกับอีเมลรอบหน้า (ท้ายคิว)",
        );
      }
    }
  }
  if (result.skipped > 0) {
    console.warn(
      `[error-alerts] ยังไม่ได้ลอง ${result.skipped} ผู้รับ (ครบงบ ${ROUND_BUDGET_MS / 1000} วินาทีของรอบ หรือ worker กำลังหยุด)` +
        " — ได้ฉบับนี้รวมกับอีเมลรอบหน้า",
    );
  }
  return result;
}

/**
 * อีเมลของผู้รับหนึ่งคนในรอบนี้ — ฉบับใหม่ แล้วต่อท้ายด้วยทุกฉบับที่เขายังค้าง (เก่าสุดก่อน) แต่ละฉบับมีเวลาที่มันออก ตัวเลขในนั้น
 * เป็นของตอนนั้น ไม่มีฉบับใหม่ = เฉพาะที่ค้าง หัวเรื่องบอกว่า "ส่งช้า"
 */
function messageFor(fresh: Message | null, late: PendingDigest[]): Message {
  if (fresh && late.length === 0) return fresh;
  const sections = late.map(
    (item) =>
      `---------- สรุปเมื่อ ${bangkok(item.createdAt)} ที่ส่งถึงคุณไม่ได้ในรอบนั้น (ตัวเลขเป็นของเวลานั้น) ----------\n\n${item.body}`,
  );
  if (fresh) {
    return {
      subject: `${fresh.subject} + สรุปที่ส่งไม่ถึงก่อนหน้า ${late.length} ฉบับ`,
      body: `${fresh.body}\n\n${sections.join("\n\n")}`,
    };
  }
  return {
    subject: `[D2 ${env.deployEnv}] สรุปที่ส่งถึงคุณไม่ได้ ${late.length} ฉบับ (ส่งช้า — ฉบับแรกเมื่อ ${bangkok(late[0]?.createdAt)})`,
    body:
      "สรุปข้างล่างออกไปแล้วแต่ส่งถึงคุณไม่ได้ในรอบนั้น ตัวเลขเป็นของเวลาที่ระบุ — ดูสถานะล่าสุดด้วย Postman E1\n\n" +
      sections.join("\n\n"),
  };
}

/** รหัส 5xx ที่เป็นเรื่องการ login ของระบบเอง ไม่ใช่ของผู้รับ — 530 ต้อง login ก่อน, 534/538 วิธี login, 535 รหัสผ่านผิด */
const SMTP_AUTH_CODES = new Set([530, 534, 535, 538]);

/**
 * SMTP ปฏิเสธถาวร**สำหรับผู้รับหรือเนื้อความนี้** — ส่งซ้ำก็ได้ผลเดิม: รหัส 5xx (nodemailer ใส่ไว้ที่ `responseCode`) ที่ตอบคำสั่ง
 * `RCPT TO` (ไม่มีผู้รับนี้) หรือ `DATA` (ไม่รับเนื้อความนี้) — nodemailer บอกคำสั่งไว้ที่ `command`
 *
 * 5xx อื่นเป็นความผิดของการตั้งค่าฝั่งเรา ไม่ใช่ของผู้รับ และหายเมื่อแก้การตั้งค่า จึงนับเป็นชั่วคราว (`missed`, ค้างไว้ส่งซ้ำ):
 * login ไม่ผ่าน (`EAUTH`, คำสั่ง `AUTH …`, รหัส 530/534/535/538 — เช่นหลังเปลี่ยนรหัสผ่านของบัญชีที่ส่ง) และ `MAIL FROM` ที่ถูก
 * ปฏิเสธ (บัญชีไม่มีสิทธิ์ส่งในนามผู้ส่ง) 5xx ที่ไม่บอกคำสั่งก็นับเป็นชั่วคราว — ลองซ้ำจนฉบับหมดอายุหกชั่วโมงดีกว่าทิ้งเงียบ ๆ
 * เดิม 5xx ทุกตัวนับเป็นถาวร: หลังรหัสผ่านของบัญชีส่งเปลี่ยน ฉบับที่ผู้รับค้างอยู่ถูกทิ้งทั้งหมดโดยไม่มีบรรทัดเตือนและ `lastError`
 * ว่าง (ตรวจขั้น 10 แบบค้านรอบสอง, 2026-10-01)
 */
function permanentFailure(err: unknown): boolean {
  const { responseCode, code, command } = (err ?? {}) as { responseCode?: unknown; code?: unknown; command?: unknown };
  if (typeof responseCode !== "number" || responseCode < 500 || responseCode >= 600) return false;
  if (code === "EAUTH" || SMTP_AUTH_CODES.has(responseCode)) return false;
  return command === "RCPT TO" || command === "DATA";
}

/**
 * ตัวบอกว่าลูปยังวิ่ง (`checkedAt`) ที่เรียกระหว่างรอบ — ไม่รอ Mongo และไม่ซ้อน (ครั้งก่อนยังไม่จบก็ข้าม) error ไม่ทำอะไร: รอบถัดไป
 * เขียน `checkedAt` ตอนเริ่มอยู่แล้ว เดิมเขียนแค่ตอนเริ่มรอบ รอบที่ส่งช้า (งบ 90 วินาทีบวกหนึ่งฉบับ 30 วินาที) บวกช่วงพัก 60 วินาที
 * ทำให้ `/status` เห็น `checkedAt` เก่าราวสามนาทีทั้งที่ลูปปกติ (ตรวจขั้น 10 แบบค้านรอบสอง, 2026-10-01) ตอนนี้เขียนตอนเริ่มรอบ
 * ก่อนทุกฉบับ และตอนจบรอบ ช่วงห่างมากสุดจึงราวหนึ่งนาที (ช่วงพัก 60 วินาทีบวกงานกับ Mongo ต้นรอบ แต่ละคำสั่งไม่เกิน
 * `MONGO_COMMAND_MAX_MS`) — `checkedAt` ที่เก่ากว่าสามนาทีจึงแปลว่าลูปไม่ได้วิ่ง (routes/admin-logs.ts `/status`)
 */
function heartbeatOf(states: Collection<AlertState>): () => void {
  let inFlight = false;
  return () => {
    if (inFlight) return;
    inFlight = true;
    states
      .updateOne({ _id: STATE_ID }, { $set: { checkedAt: new Date() } }, { maxTimeMS: MONGO_COMMAND_MAX_MS })
      .catch(() => undefined)
      .finally(() => {
        inFlight = false;
      });
  };
}

/**
 * ผู้รับที่ค้างฉบับเก่าและถึงจังหวะส่งซ้ำแล้ว — ไม่เคยลองส่งถึงเขา (ฉบับนั้นออกตอนงบของรอบหมดก่อนถึงคิวเขา หรือสถานะจาก worker
 * รุ่นก่อน) หรือลองครั้งล่าสุดเกิน 15 นาทีแล้ว ผู้รับหนึ่งคนจึงได้การส่งซ้ำไม่เกินหนึ่งครั้งต่อ 15 นาที โดยไม่ต้องใช้ `lastDigestAt`
 */
function lateDue(pending: PendingDigest[], tried: Map<string, Date>, now: Date): Set<string> {
  const due = new Set<string>();
  for (const item of pending) {
    for (const key of item.recipients) {
      const at = tried.get(key);
      if (!at || now.getTime() - at.getTime() >= DIGEST_EVERY_MS) due.add(key);
    }
  }
  return due;
}

/** `triedAt` ที่อ่านจาก Mongo — เฉพาะ key ของผู้รับที่ยังอยู่ในรายชื่อ และค่าที่เป็นเวลาจริง */
function triedTimes(value: unknown, configured: Map<string, string>): Map<string, Date> {
  const times = new Map<string, Date>();
  if (value === null || typeof value !== "object" || Array.isArray(value)) return times;
  for (const [key, at] of Object.entries(value as Record<string, unknown>)) {
    if (configured.has(key) && at instanceof Date && !Number.isNaN(at.getTime())) times.set(key, at);
  }
  return times;
}

/** `triedAt` ที่จะเขียน — เฉพาะผู้รับที่ยังค้างอะไรอยู่ คนที่ได้ครบแล้วไม่ต้องมีจังหวะส่งซ้ำ */
function triedFor(pending: PendingDigest[], tried: Map<string, Date>): Record<string, Date> {
  const out: Record<string, Date> = {};
  for (const item of pending) {
    for (const key of item.recipients) {
      const at = tried.get(key);
      if (at) out[key] = at;
    }
  }
  return out;
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
 * ไม่เจอ ผู้รับที่ค้างในตอนนั้นไม่ได้ฉบับที่ค้าง (บรรทัดเตือนของ `carriedPending`)
 */
function recipientKey(address: string): string {
  return createHmac("sha256", RECIPIENT_KEY_SECRET).update(`error-alert-recipient\0${address}`).digest("hex").slice(0, 16);
}

/**
 * ฉบับก่อน ๆ ที่ยังไม่ถึงผู้รับบางคน ในรูปที่รอบนี้ใช้ได้ — ทิ้งฉบับที่ค้างเกินหกชั่วโมง (พร้อมบรรทัดเตือน: issue ที่ยังเกิดอยู่แจ้ง
 * ใหม่ได้แล้วหลังช่วงพักหกชั่วโมง และ E1 แสดงทุกตัวที่ยังเปิดอยู่) และผู้รับที่ไม่อยู่ในรายชื่อแล้ว `changed` = ต่างจากที่อ่านมา
 * ไม่ส่งอะไร — `deliverRound` รวมฉบับเหล่านี้เข้าอีเมลของแต่ละคน
 */
function carriedPending(
  stored: unknown,
  configured: Map<string, string>,
  now: Date,
): { pending: PendingDigest[]; changed: boolean } {
  const items = pendingList(stored);
  let changed = items.length !== (Array.isArray(stored) ? stored.length : 0);
  const kept: PendingDigest[] = [];
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
    if (keys.length > 0) kept.push({ ...item, recipients: keys });
  }
  return { pending: kept, changed };
}

/** `slow` ที่อ่านจาก Mongo — เฉพาะ key ของผู้รับที่ยังอยู่ในรายชื่อ */
function slowKeys(value: unknown, configured: Map<string, string>): Set<string> {
  if (!Array.isArray(value)) return new Set();
  return new Set(value.filter((key): key is string => typeof key === "string" && configured.has(key)));
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

/**
 * `lastError` ของรอบล่าสุด (`GET /api/admin/logs/status` แสดง) — ฉบับใหม่ที่ไม่ถึงใครเลย (issue ในนั้นยังไม่ถูกนับว่าแจ้ง)
 * ผู้รับที่ SMTP ปฏิเสธถาวร ผู้รับที่ยังค้าง ผู้รับที่ช้า (`slow` — รวมคนที่ช้าในรอบก่อนแต่รอบนี้ไม่ได้ส่งถึง) และผู้รับที่ไม่ได้ลอง
 * เพราะงบหมด ไม่มีอะไรผิดปกติ = null
 */
function alertError(
  pending: PendingDigest[],
  freshReachedNobody: boolean,
  round: RoundResult,
  slow: Set<string>,
): string | null {
  const parts: string[] = [];
  if (freshReachedNobody) {
    parts.push("สรุปฉบับล่าสุดส่งไม่ถึงผู้รับคนไหนเลย — ปัญหาในฉบับนั้นยังไม่ถูกนับว่าแจ้งแล้ว ประกอบใหม่ในรอบหน้า");
  }
  if (round.rejected.size > 0) {
    parts.push(
      `SMTP ปฏิเสธผู้รับ ${round.rejected.size} คนถาวรในรอบล่าสุด (ไม่มีผู้รับนี้ หรือไม่รับเนื้อความ) — ไม่ลองซ้ำ` +
        " สรุปของรอบนั้นและที่เขาค้างไม่ถึงเขา (ดู docker compose logs delivery-worker)",
    );
  }
  const owed = new Set(pending.flatMap((item) => item.recipients)).size;
  if (owed > 0) parts.push(`ผู้รับ ${owed} คนยังไม่ได้สรุป ${pending.length} ฉบับ — ส่งซ้ำไม่เกินทุก 15 นาทีหรือรวมกับฉบับใหม่`);
  if (slow.size > 0) parts.push(`ผู้รับ ${slow.size} คนส่งเกิน ${SEND_TIMEOUT_MS / 1000} วินาที (อยู่ท้ายคิว)`);
  if (round.skipped > 0) parts.push(`ผู้รับ ${round.skipped} คนไม่ได้ลองในรอบล่าสุด (ครบงบ ${ROUND_BUDGET_MS / 1000} วินาที)`);
  return parts.length > 0 ? parts.join(" · ") : null;
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
