/**
 * เก็บ error แบบ Sentry ลง log store (MongoDB) — รวมเป็น issue ตาม fingerprint มีตัวนับ เห็นครั้งแรก/ล่าสุด รุ่นที่เกิด
 * และสถานะ open / resolved / ignored ที่เปิดกลับเองเมื่อเกิดซ้ำหลังปิด (plan §3, §5)
 *
 * **`captureError()` เป็น synchronous และไม่ throw** — สร้างเอกสารที่กวาดข้อมูลส่วนบุคคลแล้ว (lib/redact.ts) พิมพ์หนึ่ง
 * บรรทัดที่มี id ของ event ลง stdout แล้ววางไว้ในคิวในหน่วยความจำ ไม่มีอะไรบนเส้นทางของคำขอรอ Mongo:
 * ตัวจับเวลาทุก 2 วินาทีเป็นคนเขียน ทีละก้อนเดียว (ไม่มีก้อนซ้อน) ล้มแล้วถอยห่างทีละเท่าจนถึง 60 วินาที
 * Postgres ล่มก็ยังเก็บได้ ซึ่งเป็นตอนที่ต้องการที่สุด ส่วน Mongo ล่ม คำขอก็ไม่รู้สึกอะไร และยังมีบรรทัดใน stdout
 * ทุกตัว ยกเว้นที่ผู้เรียกปิดไว้เอง (`print: false`): body ที่อ่านไม่ออก (ผู้เรียกยิงถี่ได้เท่าที่ต้องการ) กับการแจ้ง
 * เกินเพดานขนาดที่ worker พิมพ์บรรทัดของตัวเองไปแล้ว
 *
 * เพดาน — ทุกตัวมีไว้กันหน่วยความจำกับดิสก์ ไม่ใช่กันข้อมูล:
 *   - คิวไม่เกิน 500 เอกสาร / 2 MB เต็มแล้วทิ้งตามลำดับ (PRIORITY): คำเตือนก่อน แล้วค่อย error; fatal, บันทึกของ
 *     process (start/shutdown/fatal-exit) และสำเนา audit ที่ Postgres ไม่รับถูกเก็บไว้ท้ายสุด ทิ้งไปเท่าไรนับไว้
 *     แล้วพอเขียนได้อีกครั้งจะมี event สรุปหนึ่งตัวว่า "ทิ้งไป N รายการระหว่าง X ถึง Y"
 *   - เก็บ event ทีละตัวได้ไม่เกิน 50 ต่อ fingerprint ต่อชั่วโมง และไม่เกิน 600 ต่อ process ต่อนาที — เกินนั้นเดินแค่ตัวนับ
 *     ของ issue (error ที่วนซ้ำหมื่นครั้งยังเห็นว่าหมื่น แต่เก็บตัวอย่างแค่ 50) fatal ไม่ติดเพดานสองตัวนี้
 *     คำขอที่ติดเพดานแล้วตอบ 5xx พร้อมรหัสอ้างอิงได้**ตัวย่อ**หนึ่งตัวแทน ให้รหัสนั้นค้นเจอ (`keepReference`, ≤120/นาที)
 *   - log store เกินเพดานขนาด (สถานะ `over_quota` ที่ worker ตั้ง) — เดินแค่ตัวนับ ไม่เก็บ event รายงานจากเบราว์เซอร์ไม่สร้าง
 *     issue ใหม่ด้วย (นับเข้าได้แค่ issue ที่มีอยู่แล้ว)
 *   - รายงานจากเบราว์เซอร์สร้าง issue ใหม่ได้ไม่เกิน 100 fingerprint ต่อ process ต่อชั่วโมง (`BROWSER_FINGERPRINTS_PER_HOUR` —
 *     ยกเว้นสองตัวที่ตั้งชื่อเอง) รายงานที่มีรหัสอ้างอิงยังเก็บตัว event ได้แม้ issue ไม่ถูกสร้าง ให้รหัสนั้นค้นเจอ (`captureReport`)
 *   - issue ที่รอเขียนไม่เกิน 1,000 fingerprint ในนั้นเป็นของเบราว์เซอร์ได้ไม่เกิน 200 และ fatal ได้ที่เสมอ (`roomForIssue`)
 *   - เอกสารหนึ่งตัวไม่เกิน 64 KB
 *
 * ปิด log store (`LOG_STORE_ENABLED=false`) แล้วยังพิมพ์บรรทัดลง stdout เหมือนเดิม แค่ไม่มีคิวและไม่มีตัวจับเวลา
 *
 * ไฟล์นี้**ไม่เรียก `logAudit()`** ทางใดทางหนึ่ง — ความล้มเหลวของ audit มาเก็บที่นี่ (lib/audit-fallback.ts)
 * ถ้าทางกลับกันมีได้ ความล้มเหลวหนึ่งครั้งจะวนไม่จบ
 */
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";

import type { Request } from "express";
import type { AnyBulkWriteOperation, Db } from "mongodb";

import { env } from "../env.js";
import { bsonSize } from "./bson-size.js";
import { currentContext, referenceOf, type Breadcrumb, type RequestContext } from "./context.js";
import { logDb, logStoreStatus } from "./log-store.js";
import { bodyShape, headlineOf, requestTarget, scrubClipped, scrubError, type ScrubbedError } from "./redact.js";

export type ErrorLevel = "fatal" | "error" | "warning";
/** error มาถึงทางไหน — `captured` คือโค้ดของเราเรียกเองที่จุดที่กลืน error ไว้ */
export type CaptureMechanism = "express" | "unhandledRejection" | "uncaughtException" | "captured";
/**
 * ทางที่รายงานจากนอก process มาถึง (`POST /api/client-errors` — routes/client-errors.ts): `window` / `unhandledrejection`
 * ของเบราว์เซอร์ หน้า `global-error` · `proxy` = 502 ของ proxy ที่เบราว์เซอร์ส่งตามมาทีหลัง · `onRequestError` และ
 * `unhandledRejection` / `uncaughtException` ของ Next server
 */
export type ReportMechanism =
  | "window"
  | "unhandledrejection"
  | "global-error"
  | "proxy"
  | "onRequestError"
  | "unhandledRejection"
  | "uncaughtException";
export type CaptureService = "backend" | "delivery-worker";
/** service ของ event — ของ process เอง หรือของรายงานที่รับเข้ามา */
export type EventService = CaptureService | "browser" | "frontend-server";

export interface CaptureOptions {
  /** ค่าตั้งต้น `error` · `warning` ไม่มีวันส่งอีเมลแจ้งเตือน (step 10) */
  level?: ErrorLevel;
  /** ชื่อจุดที่เก็บ เช่น `render.agreement-after-commit` — ใช้จัดกลุ่มแทน route เมื่อไม่ได้อยู่ในคำขอ */
  tag?: string;
  /** กำหนด fingerprint เอง (`smtp:535`, `prisma:P2002:POST /api/…`) แทนค่าที่คำนวณจาก error */
  fingerprint?: string;
  mechanism?: CaptureMechanism;
  /** ค่าตั้งต้น: false สำหรับ unhandledRejection/uncaughtException, true นอกนั้น */
  handled?: boolean;
  /** คำขอ Express — เพิ่ม path, ชื่อ query, รูปร่างของ body และผู้ใช้จาก session ลง event */
  req?: Request;
  /** status ที่ตอบกลับไป */
  status?: number;
  /** ข้อมูลเพิ่มที่**ผ่านการกวาดมาแล้ว** — ไฟล์นี้ไม่กวาดให้อีก */
  extra?: Record<string, unknown>;
  /** ค่าตั้งต้น true — ปิดเฉพาะ error ที่ผู้เรียกเป็นต้นเหตุและยิงถี่ได้ (body ที่อ่านไม่ออก) */
  print?: boolean;
}

interface ErrorEventDoc {
  _id: string;
  occurredAt: Date;
  fingerprint: string;
  level: ErrorLevel;
  handled: boolean;
  tag: string | null;
  service: EventService;
  environment: string;
  release: string;
  host: { containerId: string; startedAt: Date };
  mechanism: CaptureMechanism | ReportMechanism;
  error: Omit<ScrubbedError, "topFrame">;
  request: {
    method: string | null;
    route: string | null;
    path: string | null;
    queryKeys: string[];
    status: number | null;
    durationMs: number | null;
    correlationId: string | null;
    reference: string | null;
    ip: string | null;
    userAgent: string | null;
    bodyShape: Record<string, string> | null;
  } | null;
  actor: { id: string; roles: string[]; organizationId: string | null; sessionId: string | null } | null;
  breadcrumbs: Breadcrumb[];
  extra: Record<string, unknown> | null;
  /** รายงานที่รับเข้ามา (step 9, `captureReport`) — null เสมอสำหรับ error ของ process เอง */
  browser: BrowserContext | null;
  ingest: IngestContext | null;
}

/**
 * หน้าที่รายงานมาจาก — `pathname` เท่านั้น ไม่มี query/hash · `reference` = รหัสอ้างอิงที่ผู้ใช้เห็นบนจอ (หน้า global-error สร้าง
 * เอง, หรือของ 502 จาก proxy) **ผู้ส่งอ้างเอง** จึงไม่อยู่ใน `request.correlationId` — trace ค้นแยก (`browser.reference`)
 * · `lastApi` = คำขอ API ห้าตัวล่าสุดของหน้านั้น (path ไม่มี query) · `release` = รุ่นของบันเดิลที่เบราว์เซอร์รันอยู่
 */
export interface BrowserContext {
  pathname: string | null;
  digest: string | null;
  reference: string | null;
  release: string | null;
  lastApi: Array<{ method: string; path: string; status: number; correlationId: string | null }>;
}

/** รายงานมาทางไหน — `verified` = Next server ที่ `x-report-token` ตรง ที่เหลือคือใครก็ได้ที่เรียก endpoint นี้ */
export interface IngestContext {
  verified: boolean;
  claimedService: string | null;
  ip: string | null;
  userAgent: string | null;
}

export type RuntimeKind = "start" | "shutdown" | "fatal-exit";

interface RuntimeEventDoc {
  _id: string;
  at: Date;
  service: CaptureService;
  host: { containerId: string; startedAt: Date };
  release: string;
  kind: RuntimeKind;
  detail: Record<string, unknown> | null;
}

/** สำเนาของแถว audit ที่เขียนลง Postgres ไม่สำเร็จ (`source: "audit_fallback"`) — รูปอยู่ใน lib/audit-fallback.ts */
export type ActivityDoc = { _id: string } & Record<string, unknown>;

interface IssueDoc {
  _id: string;
  service: EventService;
  title: string;
  culprit: string;
  level: ErrorLevel;
  tag: string | null;
  count: number;
  firstSeen: Date;
  lastSeen: Date;
  firstRelease: string;
  lastRelease: string;
  lastEventId: string | null;
  status: "open" | "resolved" | "ignored";
  statusChangedAt: Date;
  statusReason: string | null;
  regressedAt: Date | null;
  alertedAt: Date | null;
  alertCount: number;
}

/** การเปลี่ยนแปลงของ issue หนึ่งตัวที่ยังไม่ได้เขียน — error ร้อยตัวของ fingerprint เดียวกันเป็น update เดียว */
interface IssueDelta {
  fingerprint: string;
  service: EventService;
  title: string;
  culprit: string;
  level: ErrorLevel;
  tag: string | null;
  count: number;
  firstSeen: Date;
  lastSeen: Date;
  lastEventId: string | null;
  /** รุ่นของรายงานที่รับเข้ามา (บันเดิลของเบราว์เซอร์) — ไม่มี = รุ่นของ process นี้ (`env.release`) */
  release?: string;
  /**
   * สร้าง issue ใหม่ได้ไหม (upsert) — false = เดินตัวนับของ issue ที่มีอยู่แล้วเท่านั้น ไม่มีก็ไม่เกิดอะไร เป็น false เฉพาะรายงาน
   * จากเบราว์เซอร์ที่มาตอนเกินเพดานขนาด หรือเกินเพดาน fingerprint ใหม่ต่อชั่วโมง (`admitBrowserFingerprint`)
   */
  create: boolean;
}

/**
 * `activity` = สำเนาของแถว audit ที่ Postgres ไม่รับ (สำเนาเดียวที่เหลือ) · `access` = บันทึกการเรียก admin API
 * (lib/admin-access.ts) — ลง collection เดียวกัน แต่ `access` ถูกทิ้งก่อนเกือบทุกอย่างเมื่อคิวเต็ม และไม่เขียนตอนเกินเพดานขนาด
 */
type RingItem =
  | { kind: "event"; doc: ErrorEventDoc; bytes: number; priority: number }
  | { kind: "runtime"; doc: RuntimeEventDoc; bytes: number; priority: number }
  | { kind: "activity"; doc: ActivityDoc; bytes: number; priority: number }
  | { kind: "access"; doc: ActivityDoc; bytes: number; priority: number };

// --------------------------------------------------------------------------------------------- เพดาน

const FLUSH_INTERVAL_MS = 2_000;
const BACKOFF_MAX_MS = 60_000;
/**
 * ก้อนที่เขียนนานกว่านี้ได้บรรทัดเตือนหนึ่งบรรทัด — **ไม่ใช่ timeout**: ก้อนนั้นยังเขียนต่อ และก้อนใหม่ยังไม่เริ่มจนกว่า
 * มันจะจบ ความยาวของแต่ละคำสั่งคุมโดย driver อยู่แล้ว (serverSelectionTimeoutMS 2 วินาที, socketTimeoutMS 5 วินาที)
 * เดิมเป็น timeout 15 วินาทีที่เอาก้อนกลับเข้าคิวแล้วปล่อยให้ก้อนใหม่เริ่ม ขณะที่ก้อนเดิมยังเขียนอยู่เบื้องหลัง —
 * Mongo ที่ช้าแต่ไม่ล่ม (คำสั่งละ 4 วินาที) จึงได้ `$inc count` ของ issue ชุดเดียวกันสองรอบ
 */
const FLUSH_SLOW_MS = 15_000;
const RING_MAX_DOCS = 500;
const RING_MAX_BYTES = 2 * 1024 * 1024;
/** issue ที่รอเขียนพร้อมกันได้ไม่เกินนี้ — error ร้อยแบบไม่ซ้ำกันระหว่างที่ Mongo ล่มต้องไม่กินหน่วยความจำไม่จบ */
const PENDING_ISSUES_MAX = 1_000;
/**
 * ในนั้นเป็นของรายงานเบราว์เซอร์ได้ไม่เกินนี้ — ที่เหลืออย่างน้อย 800 เป็นของ backend และ worker เอง (`roomForIssue`)
 *
 * เดิมใช้ที่ร่วมกันไม่มีลำดับ: ระหว่างที่ Mongo ล่ม ตัวนับของ issue ค้างอยู่ทั้งหมด รายงานขยะที่ข้อความไม่ซ้ำกัน (ใครก็ส่งได้
 * `X-Forwarded-For` เขียนเองหลบเพดานต่อ IP ได้) เต็มพันที่ในราวสามนาทีครึ่ง แล้ว error ของ server ทุกตัวรวมทั้ง fatal ถูกทิ้งทั้ง
 * event และตัวนับ fatal จึงไม่เป็น issue และไม่มีอีเมลแจ้ง (ตรวจขั้น 8-10 แบบค้าน 2026-10-01: พันที่ เก้าร้อยเป็นของรายงานที่สร้าง
 * issue ไม่ได้ด้วยซ้ำ) คิวทิ้งรายงานเบราว์เซอร์ก่อนทุกอย่างอยู่แล้ว ที่ของตัวนับต้องเป็นแบบเดียวกัน
 */
const BROWSER_PENDING_ISSUES_MAX = 200;
const DOC_MAX_BYTES = 64 * 1024;
const EXTRA_MAX_BYTES = 16 * 1024;
const PER_FINGERPRINT_PER_HOUR = 50;
const PER_PROCESS_PER_MINUTE = 600;
/** ในจำนวน 600 ต่อนาทีนั้น เป็นรายงานจากเบราว์เซอร์ได้ไม่เกินนี้ (plan §3) — เบราว์เซอร์ส่งอะไรมาก็ได้ ต้องไม่กินที่ของ server */
const BROWSER_PER_MINUTE = 60;
/**
 * fingerprint ของรายงานเบราว์เซอร์ที่สร้าง issue ได้ต่อ process ต่อชั่วโมง — เกินแล้วรายงานของ fingerprint ที่ยังไม่เห็นในชั่วโมงนี้
 * เดินได้แค่ตัวนับของ issue ที่มีอยู่แล้ว (`captureReport`)
 *
 * fingerprint ของเบราว์เซอร์คือข้อความที่ผู้ส่งเขียน (ตัดแค่เลขกับ UUID) ข้อความไม่ซ้ำกันหนึ่งตัวจึงเป็น issue ใหม่หนึ่งใบ เดิม
 * ไม่มีเพดานนี้ และตอนเกินเพดานขนาดก็ยัง upsert issue: เพดาน 30 ต่อนาทีต่อ IP ที่ผู้ส่งเขียนเองกับ 300 ต่อนาทีรวม ยอมให้ได้ราว
 * 430,000 issue ใหม่ต่อวัน ซึ่งไม่เคยถูก prune (ตรวจขั้น 10 แบบค้าน, 2026-10-01: ยี่สิบรายงานที่เปลี่ยนคำและ `X-Forwarded-For`
 * ได้ issue ใหม่ยี่สิบใบ) บั๊กจริงหนึ่งตัวคือ fingerprint ไม่กี่ตัว ร้อยต่อชั่วโมงจึงไม่บังของจริง
 */
const BROWSER_FINGERPRINTS_PER_HOUR = 100;
/**
 * fingerprint ของเบราว์เซอร์ที่ routes/client-errors.ts ตั้งชื่อเอง — ชุดตายตัวสองตัว ไม่โตตามข้อความที่ผู้ส่งเขียน จึงสร้าง issue
 * ได้เสมอ ไม่กินที่ในร้อยตัวต่อชั่วโมง เดิมกินที่เหมือนตัวอื่น รายงานขยะร้อยข้อความแรกของชั่วโมงจึงทำให้ 502 ของ proxy (ตอน backend
 * ล่มจริง) ไม่มี issue ให้เห็นทั้งชั่วโมง (ตรวจขั้น 9, 2026-10-01)
 */
const FIXED_BROWSER_FINGERPRINTS: ReadonlySet<string> = new Set(["browser:chunk-load", "proxy:backend_unreachable"]);
/** ตอนปิด process รอเขียนคิวที่ค้างไม่เกินเท่านี้ — compose ให้เวลาทั้งหมด 10 วินาที */
export const FLUSH_ON_EXIT_MS = 2_000;

/**
 * ลำดับการทิ้งเมื่อคิวเต็ม: ตัวที่เลขน้อยกว่าถูกทิ้งก่อน (ตัวเก่าสุดในกลุ่มนั้น) ตัวที่เข้ามาใหม่ไล่ได้เฉพาะตัวที่เลข
 * **น้อยกว่า** ตัวเอง เลขเท่ากันแปลว่าตัวใหม่ถูกทิ้ง — ตัวอย่างแรก ๆ ของเหตุการณ์หนึ่งบอกอะไรได้มากกว่าตัวที่ห้าร้อย
 * รายงานจากเบราว์เซอร์ (0) กับบันทึกการเรียก admin API (1 — lib/admin-access.ts) ถูกทิ้งก่อนทุกอย่างของ server เอง:
 * เบราว์เซอร์ส่งอะไรมาก็ได้ และบันทึกการเรียกเป็นการเข้าถึง ไม่ใช่การเปลี่ยนแปลง (การเปลี่ยนแปลงอยู่ใน audit_event อยู่แล้ว)
 *
 * สำเนา audit (`activity`) อยู่ชั้นเดียวกับ fatal ไม่ใช่กับ error: มันคือสำเนา**เดียว**ที่เหลือของแถวที่ Postgres ไม่รับ
 * ส่วนตัวอย่าง error ที่ถูกไล่ออกยังเหลือตัวนับของ issue อยู่ เดิมเลขเท่ากับ error — คิวที่เต็มไปด้วย error ตอน Mongo
 * ล่ม (ห้าร้อยตัว ซึ่งเกิดจริงในการทดสอบ) จึงทิ้งสำเนา audit ที่มาทีหลังแทนที่จะทิ้งตัวอย่าง error ตัวเก่าสุด
 *
 * บันทึกสรุปของการเรียก admin API ที่เก็บเป็นตัวเดี่ยวไม่ได้ (`accessSummary`) อยู่ชั้นเดียวกับคำเตือน: มันเกิดตอนที่คิวเต็มไป
 * ด้วยบันทึกการเรียกพอดี ถ้าอยู่ชั้น 1 ก็ไล่ใครไม่ได้และหายไปพร้อมสิ่งที่มันสรุป (lib/admin-access.ts)
 */
const PRIORITY = {
  browser: 0,
  access: 1,
  accessSummary: 2,
  warning: 2,
  error: 3,
  activity: 4,
  fatal: 4,
  runtime: 4,
} as const;

// --------------------------------------------------------------------------------------------- สถานะ

let service: CaptureService = "backend";
let timer: NodeJS.Timeout | null = null;
let handlersInstalled = false;
let exiting = false;

let ring: RingItem[] = [];
let ringBytes = 0;
const pendingIssues = new Map<string, IssueDelta>();

/** เก็บไปแล้วกี่ตัวในชั่วโมงนี้ ต่อ fingerprint — ล้างรายการที่หมดชั่วโมงทุกครั้งที่เขียนสำเร็จ */
const perFingerprint = new Map<string, { windowStart: number; stored: number }>();
let processWindow = { start: 0, stored: 0, browser: 0 };
/** fingerprint ของรายงานเบราว์เซอร์ที่สร้าง issue ได้ในชั่วโมงนี้ (`BROWSER_FINGERPRINTS_PER_HOUR`) */
let browserFingerprints = { start: 0, seen: new Set<string>() };
/** รายงานเบราว์เซอร์ที่ไม่ได้สร้าง issue ตั้งแต่ process เริ่ม (เกินเพดาน fingerprint หรือเกินเพดานขนาด) — `/status` แสดง */
let browserNotCreated = 0;
/** รายงานเบราว์เซอร์ที่มีรหัสอ้างอิงซึ่งไม่ได้เก็บทั้งตัวเต็มและตัวย่อ ตั้งแต่ process เริ่ม — `/status` แสดง (G6 จะตอบว่าไม่พบ) */
let browserReferencesLost = 0;

/**
 * ทำไมถึงทิ้ง — event สรุปต้องบอกสาเหตุให้ถูก เดิมมันโทษ "log store เขียนไม่ได้นาน" ทุกครั้ง แม้ที่ทิ้งจริงคือเอกสารที่
 * Mongo ไม่รับ หรือพายุ error ตอนที่ Mongo ปกติดี คนอ่านจึงไปไล่หา Mongo ล่มที่ไม่เคยเกิด
 *   - queue_full: คิวในหน่วยความจำเต็ม (500 รายการ / 2 MB) — Mongo เขียนไม่ได้นาน หรือ error มาเร็วกว่าที่เขียนทัน
 *   - too_large: เอกสารตัวเดียวเกิน 64 KB หลังตัดแล้ว
 *   - rejected: Mongo ปฏิเสธตัวเอกสาร (DOCUMENT_REJECTED) ลองซ้ำก็ไม่ผ่าน
 *   - issue_backlog: issue ที่รอเขียนครบ 1,000 fingerprint — การเกิดครั้งนั้นไม่ได้เข้าตัวนับด้วยซ้ำ
 *   - browser_backlog: รายงานเบราว์เซอร์ที่ issue ของเบราว์เซอร์ที่รอเขียนครบ 200 fingerprint (`BROWSER_PENDING_ISSUES_MAX`)
 */
type DropReason = "queue_full" | "too_large" | "rejected" | "issue_backlog" | "browser_backlog";

/** ทิ้งไปเท่าไรตั้งแต่เขียนสำเร็จครั้งล่าสุด — ได้ event สรุปหนึ่งตัวเมื่อกลับมาเขียนได้ */
const dropped = {
  count: 0,
  first: null as Date | null,
  last: null as Date | null,
  reasons: { queue_full: 0, too_large: 0, rejected: 0, issue_backlog: 0, browser_backlog: 0 } as Record<DropReason, number>,
  /** ในนั้นเป็นสำเนา audit ที่ Postgres ไม่รับกี่ตัว — สำเนาเดียวที่เหลือของแถวนั้น หายแล้วหายเลย */
  auditCopies: 0,
};

/** ทิ้งไปทั้งหมดเท่าไรตั้งแต่ process เริ่ม — `dropped.count` ข้างบนถูกล้างทุกครั้งที่ event สรุปเข้าคิว ตัวนี้ไม่ถูกล้าง */
let droppedSinceStart = 0;

let flushing: Promise<void> | null = null;
let failures = 0;
let nextAttemptAt = 0;
let failing = false;

const HOST = { containerId: hostname(), startedAt: new Date(Date.now() - process.uptime() * 1000) };

/**
 * เวลาที่ process ก่อนหน้า**ใน container เดียวกัน**ปิดตามปกติ อ่านจากป้ายในไฟล์ตอน `initErrorCapture` (`takeCleanExitMarker`)
 * null = ไม่มีป้าย — ก่อนหน้าตาย ถูก SIGKILL เป็น container ใหม่ หรือเขียนป้ายไม่ได้ ใช้ประทับบันทึก `start` (`recordRuntimeEvent`)
 */
let cleanExitBefore: Date | null = null;
let cleanExitTaken = false;

// --------------------------------------------------------------------------------------------- API

/**
 * เริ่มระบบเก็บ error ของ process นี้ — เรียกครั้งเดียวที่ต้น main() ก่อนอย่างอื่น
 *
 * ติดตั้งตัวดัก `unhandledRejection` (เก็บแล้วทำงานต่อ — decision 14: Node 22 ออกทั้ง process ถ้าไม่มีตัวดัก
 * reject ที่ไม่มีใครรอตัวเดียวจึงพาคำขออื่นทั้งหมดที่ค้างอยู่ล่มไปด้วย) และ `uncaughtException` (เก็บเป็น fatal
 * เขียนบันทึก fatal-exit รอเขียนคิวไม่เกิน 2 วินาทีแล้ว exit(1) — สถานะของ process หลัง exception ที่ไม่มีใครจับ
 * เชื่อไม่ได้แล้ว) แล้วเริ่มตัวจับเวลาเขียนคิว (ถ้าเปิด log store) event ที่เก็บก่อน log store ต่อได้รออยู่ในคิว
 */
export function initErrorCapture(options: { service: CaptureService }): void {
  service = options.service;
  // ป้าย "ปิดตามปกติ" ของ process ก่อนหน้า — อ่านแล้วลบตั้งแต่ต้น ไม่ว่าเปิด log store หรือไม่ ป้ายเก่าจึงไม่ค้างไปถึงการเริ่มรอบหลัง
  if (!cleanExitTaken) {
    cleanExitTaken = true;
    cleanExitBefore = takeCleanExitMarker();
  }
  if (!handlersInstalled) {
    handlersInstalled = true;
    process.on("unhandledRejection", (reason) => {
      captureError(reason, { level: "error", mechanism: "unhandledRejection", handled: false });
    });
    process.on("uncaughtException", (err) => {
      exitAfterFatal(err, { mechanism: "uncaughtException" });
    });
  }
  if (env.logStore.enabled && !timer) {
    timer = setInterval(tick, FLUSH_INTERVAL_MS);
    // ตัวจับเวลาต้องไม่รั้ง process ไว้ตอนที่อย่างอื่นจบหมดแล้ว
    timer.unref();
  }
}

/**
 * เก็บ error หนึ่งตัว — คืน id ของ event ถ้าได้เข้าคิว หรือ null (ปิดอยู่ เกินเพดาน นับอย่างเดียว คิวเต็ม)
 *
 * synchronous และไม่ throw: ใช้ได้ทุกที่ รวมถึงใน catch ของโค้ดที่ throw ต่อไม่ได้ พิมพ์หนึ่งบรรทัดลง stdout เสมอ
 * (เว้นแต่ `print: false`) บรรทัดนั้นเป็นข้อความที่กวาดแล้ว ไม่ใช่ error ดิบ
 */
export function captureError(err: unknown, options: CaptureOptions = {}): string | null {
  try {
    return capture(err, options);
  } catch (failure) {
    try {
      console.error(
        `[capture] ${service}: เก็บ error ไม่สำเร็จ (${failure instanceof Error ? failure.name : "Error"}) — error เดิมไม่ได้ถูกบันทึก`,
      );
    } catch {
      // stdout ใช้ไม่ได้ ไม่มีที่ไหนให้บอกแล้ว
    }
    return null;
  }
}

/**
 * บันทึกของ process (start / shutdown / fatal-exit) — ใช้ดูว่าวนรีสตาร์ตไหม (step 10, `crashLoopsOf` ใน workers/error-alerts.ts)
 * ไม่ throw
 *
 * นอกจากเข้าคิวแล้ว `shutdown` ยังเขียนป้ายลงไฟล์ (`writeCleanExitMarker`) และ `fatal-exit` ลบป้ายนั้น `start` ของ process ถัดไป
 * ที่พบป้ายได้ `detail.cleanExit: true` กับ `cleanExitAt` บันทึก `shutdown` อยู่ในคิวในหน่วยความจำ และ flush ตอนปิดมีเวลาสอง
 * วินาที ถ้า Mongo กำลังหยุดหรือล่มอยู่ตอนนั้น บันทึกนี้หายไปพร้อม process ป้ายในไฟล์ไม่ต้องพึ่ง Mongo จึงบอกได้แทนว่าการเริ่มครั้งนี้
 * ตามหลังการปิดตามปกติ เดิมไม่มีป้าย: `docker compose restart mongo backend delivery-worker` สามรอบในชั่วโมงเดียว (ปิดตามปกติ
 * ทุกรอบ) ได้ `start` สามตัวโดยไม่มี `shutdown` นำหน้า แล้วสรุปแจ้ง "delivery-worker วนรีสตาร์ต" (ตรวจขั้น 10 แบบค้าน 2026-10-01)
 *
 * **`shutdown` ระหว่างที่ fatal กำลังออก (`exiting`) ไม่บันทึกอะไรเลย** ทั้งป้ายและบันทึกในคิว: process นี้ออกเพราะ fatal
 * (`exitAfterFatal` ลบป้ายและบันทึก `fatal-exit` ไปแล้ว แล้วรอเขียนคิวไม่เกินสองวินาที) SIGTERM ที่มาในช่วงนั้นไม่ได้ทำให้การออก
 * กลายเป็นการปิดตามปกติ เดิมมันเขียนป้ายที่ fatal เพิ่งลบกลับคืน `start` ถัดไปจึงได้ `cleanExit: true` และไม่ถูกนับเป็นการเริ่มที่
 * ไม่มีคำอธิบาย (ลองจริงใน container: process ที่ throw แล้วได้ SIGTERM 300 มิลลิวินาทีหลังจากนั้น ออกด้วยรหัส 1 โดยที่ป้ายยังอยู่ —
 * ตรวจขั้น 10 แบบค้าน 2026-10-01) บันทึก `shutdown` ในคิวก็ข้ามด้วยเหตุเดียวกัน ถ้าถึง Mongo มันจะเป็นบันทึกก่อนหน้าของ `start`
 * ถัดไปแทน `fatal-exit` (`crashLoopsOf` ใน workers/error-alerts.ts) บรรทัด "SIGTERM received" ใน stdout ยังบอกว่าสัญญาณมาถึง
 */
export function recordRuntimeEvent(kind: RuntimeKind, detail: Record<string, unknown> | null = null): void {
  try {
    if (!env.logStore.enabled) return;
    if (kind === "shutdown" && exiting) return;
    // ป้ายก่อนคิว — การปิดที่ถูก SIGKILL ระหว่าง flush ยังเป็นการปิดที่มีคนสั่ง ไม่ใช่การตาย
    if (kind === "shutdown") writeCleanExitMarker();
    if (kind === "fatal-exit") removeCleanExitMarker();
    const doc: RuntimeEventDoc = {
      _id: randomUUID(),
      at: new Date(),
      service,
      host: HOST,
      release: env.release,
      kind,
      detail:
        kind === "start" && cleanExitBefore ? { ...(detail ?? {}), cleanExit: true, cleanExitAt: cleanExitBefore } : detail,
    };
    enqueue({ kind: "runtime", doc, bytes: sizeOf(doc), priority: PRIORITY.runtime });
  } catch {
    // บันทึกของ process หายได้ ห้ามทำให้การบูตหรือการปิดสะดุด
  }
}

/**
 * สำเนาของแถว audit ที่ Postgres ไม่รับ (lib/audit-fallback.ts) — เก็บแม้เกินเพดานขนาด เพราะเป็นบันทึกของสิ่งที่
 * เกิดขึ้นจริง ไม่ใช่ error (plan §3: activity เดินต่อตอนเกินเพดาน) คืน false ถ้าเข้าคิวไม่ได้ ไม่ throw
 *
 * เอกสารที่ส่งมาผ่าน `fitDocument()` ของ lib/activity-shape.ts แล้ว ซึ่งรับประกันว่าไม่เกิน 64 KB ด้วยตัววัดเดียวกับ
 * `sizeOf` ข้างล่าง (BSON) — การทิ้งแบบ `too_large` ใน `enqueue` จึงไม่เกิดกับสำเนาพวกนี้ ทางที่ทิ้งได้เหลือแค่คิวเต็ม
 */
export function enqueueActivity(doc: ActivityDoc): boolean {
  try {
    if (!env.logStore.enabled) return false;
    return enqueue({ kind: "activity", doc, bytes: sizeOf(doc), priority: PRIORITY.activity });
  } catch {
    return false;
  }
}

/**
 * บันทึกการเรียก admin API (lib/admin-access.ts, `source: "http"`) — ไม่ throw คืนผลสามแบบ:
 *   - `queued` เข้าคิวแล้ว
 *   - `full`   คิวเต็ม (ไม่มีตัวที่ชั้นต่ำกว่าให้ไล่) — ผู้เรียกพับลงบันทึกสรุปแล้วส่งใหม่ทีหลัง
 *   - `off`    log store ปิดหรือเกินเพดานขนาด — ไม่เก็บเลย ทั้งตัวเดี่ยวและสรุป (plan §3 "Size ceiling")
 *
 * ต่างจากสำเนา audit ข้างบนสองข้อ: เกินเพดานขนาดแล้วไม่เก็บ และอยู่ชั้นที่ 1 ของคิว ถูกทิ้งหลังรายงานจากเบราว์เซอร์แต่ก่อน
 * ทุกอย่างของ server เอง ยกเว้นบันทึกสรุป (`summary: true`) ซึ่งอยู่ชั้นเดียวกับคำเตือน — ตัวเดียวแทนการเรียกเป็นร้อย และมีขึ้น
 * เพราะคิวหรือเพดานต่อนาทีรับตัวเดี่ยวไม่ไหวแล้ว ถ้าอยู่ชั้นเดียวกับตัวเดี่ยวก็ถูกทิ้งด้วยเหตุเดียวกัน แต่สรุปไม่เบียดตัวเดี่ยว
 * ออกจากคิว (`enqueue`) เอกสารต้องผ่าน `fitDocument()` มาแล้ว
 */
export function enqueueAccessRecord(doc: ActivityDoc, summary = false): "queued" | "full" | "off" {
  try {
    if (!env.logStore.enabled || logStoreStatus().status === "over_quota") return "off";
    const priority = summary ? PRIORITY.accessSummary : PRIORITY.access;
    return enqueue({ kind: "access", doc, bytes: sizeOf(doc), priority }) ? "queued" : "full";
  } catch {
    return "off";
  }
}

/**
 * ผู้รับบันทึกการเรียก admin API ที่**เข้าคิวแล้วแต่ถูกเบียดออก** — ของที่ชั้นสูงกว่ามาทีหลัง (คำเตือน error สำเนา audit หรือ
 * บันทึกสรุปเอง) หรือที่คิวรับกลับไม่ได้หลังเขียนล้ม (`requeue`) lib/admin-access.ts ลงทะเบียนตอนโหลด แล้วพับตัวนั้นลงบันทึกสรุป
 * ตัวที่ถูกส่งไปที่นี่ไม่นับเป็น "ทิ้ง" (`noteDropped`) เพราะไม่ได้หาย
 *
 * เดิมตัวที่ถูกเบียดหายไปเงียบ ๆ เหลือแค่ตัวเลขใน event "ทิ้งไป N ตัว": สรุปหนึ่งใบที่เข้าคิวตอนคิวเต็มไล่บันทึก `?cid=` ที่เข้าคิว
 * ไว้ก่อนออกไป แล้วไม่มีอะไรให้ `x-log-cid` ค้นเจอ (ตรวจขั้น 8, 2026-10-01) ไฟล์นี้ import lib/admin-access.ts ไม่ได้ (import วน)
 * จึงเป็นการลงทะเบียน ผู้รับต้องไม่เรียก `enqueue` กลับมาทันที — ถูกเรียกจากกลางลูปไล่ของในคิว
 */
let accessEvicted: ((doc: ActivityDoc) => void) | null = null;

export function onAccessRecordEvicted(handler: (doc: ActivityDoc) => void): void {
  accessEvicted = handler;
}

/** ส่งบันทึกการเรียก admin API ที่หลุดจากคิวให้ lib/admin-access.ts — false ถ้าไม่มีผู้รับหรือผู้รับล้ม (นับเป็นทิ้งตามเดิม) */
function handOverAccessRecord(doc: ActivityDoc): boolean {
  if (!accessEvicted) return false;
  try {
    accessEvicted(doc);
    return true;
  } catch {
    return false;
  }
}

/**
 * ตัวเลขของคิวใน process นี้ — `GET /api/admin/logs/status` แสดง (ไม่มีข้อมูลบุคคล ไม่แตะ Mongo ไม่ await อะไร)
 *
 *   buffered       — รายการที่รอเขียนอยู่ในคิว (event, บันทึกของ process, สำเนา audit) · bufferedBytes ขนาดรวม
 *   pendingIssues  — issue ที่ตัวนับยังไม่ได้เขียน
 *   dropped        — ทิ้งไปทั้งหมดตั้งแต่ process เริ่ม (คิวเต็ม ใหญ่เกิน Mongo ไม่รับ issue ค้างเกิน)
 *   droppedUnreported — ในนั้นที่ยังไม่มี event สรุป "ทิ้งไป N รายการ" (เข้าคิวเมื่อเขียนได้อีกครั้ง)
 *   browserReferencesLost — รายงานเบราว์เซอร์ที่มีรหัสอ้างอิงซึ่งไม่ได้เก็บเลย (เกินเพดานขนาด, ตัวย่อเกิน 240 ต่อนาที, คิวเต็ม)
 *   writing        — `failing` ระหว่างที่เขียน log store ไม่ได้และกำลังถอยห่าง
 * เป็นของ process ที่ตอบเท่านั้น: คิวของ delivery-worker และของ backend replica อื่นแยกกัน
 */
export function errorCaptureStats(): {
  buffered: number;
  bufferedBytes: number;
  pendingIssues: number;
  dropped: number;
  droppedUnreported: number;
  browserReportsNotCreatingIssues: number;
  browserReferencesLost: number;
  writing: "ok" | "failing";
} {
  return {
    buffered: ring.length,
    bufferedBytes: ringBytes,
    pendingIssues: pendingIssues.size,
    dropped: droppedSinceStart,
    droppedUnreported: dropped.count,
    browserReportsNotCreatingIssues: browserNotCreated,
    browserReferencesLost,
    writing: failing ? "failing" : "ok",
  };
}

/**
 * เขียนคิวที่ค้างอยู่ให้เท่าที่ทันภายใน `timeoutMs` — ใช้ตอนปิด process ไม่ reject
 * รอก้อนที่กำลังเขียนอยู่ให้จบก่อน แล้วเขียนต่อไม่เกินสามก้อน (1,500 ตัว) หรือจนกว่าจะล้ม
 */
export async function flushErrors(timeoutMs: number): Promise<void> {
  if (!env.logStore.enabled) return;
  const work = (async () => {
    if (flushing) await flushing;
    nextAttemptAt = 0;
    for (let round = 0; round < 3 && hasWork(); round++) {
      flushing = runFlush().finally(() => {
        flushing = null;
      });
      await flushing;
      if (failing) break;
    }
  })();
  await settleWithin(work, timeoutMs);
}

/**
 * ทางออกเดียวของ process ที่เจอ error ถึงตาย — เก็บเป็น fatal, บันทึก fatal-exit, รอเขียนคิวไม่เกิน 2 วินาที, exit(1)
 * เข้ามาซ้ำระหว่างรอ (exception ตัวที่สองระหว่างเขียน) ก็ออกทันที ไม่วน
 */
export function exitAfterFatal(err: unknown, options: { mechanism: CaptureMechanism; tag?: string }): void {
  if (exiting) {
    process.exit(1);
  }
  exiting = true;
  captureError(err, {
    level: "fatal",
    mechanism: options.mechanism,
    handled: options.mechanism !== "uncaughtException",
    tag: options.tag,
  });
  recordRuntimeEvent("fatal-exit", { mechanism: options.mechanism, tag: options.tag ?? null });
  // เผื่อ event loop ค้างจนสัญญาข้างล่างไม่มีวันจบ — ต้องออกให้ได้ docker จะเริ่ม process ใหม่ให้
  setTimeout(() => process.exit(1), FLUSH_ON_EXIT_MS + 1_000).unref();
  void flushErrors(FLUSH_ON_EXIT_MS).finally(() => process.exit(1));
}

// --------------------------------------------------------------------------------------------- ป้าย "ปิดตามปกติ"

/**
 * ป้ายอยู่ใน `os.tmpdir()` ของ container (`/tmp` — ไม่มี volume ทับใน compose) ซึ่งเป็นชั้นที่เขียนได้ของ container นั้นเอง:
 * อยู่รอด `docker compose restart`, stop แล้ว start, Docker daemon หรือเครื่องรีบูต (ตัว container เดิม) และหายเมื่อ container ถูก
 * สร้างใหม่ (deploy, `up` ที่ config เปลี่ยน) — ซึ่งได้ชื่อเครื่องใหม่ จึงไม่มีบันทึกก่อนหน้าให้นับอยู่แล้ว
 *
 * ที่ป้ายช่วยไม่ได้: container ที่ระบบเริ่มใหม่ด้วยชั้นที่เขียนได้ชุดใหม่แต่ชื่อเครื่องเดิม (Kubernetes / Container Apps เริ่ม
 * container ใหม่ใน replica เดิม) กับ root filesystem ที่เขียนไม่ได้หรือดิสก์เต็ม — ตรงนั้นเหลือแค่บันทึก `shutdown` ใน Mongo
 * เหมือนก่อนมีป้าย restart ที่บันทึกนั้นไปไม่ถึง Mongo ยังนับเป็นการเริ่มที่ไม่มีคำอธิบาย
 */
function cleanExitMarkerPath(): string {
  return join(tmpdir(), `bdi-${service}.clean-exit.json`);
}

function writeCleanExitMarker(): void {
  try {
    writeFileSync(
      cleanExitMarkerPath(),
      JSON.stringify({ at: new Date().toISOString(), containerId: HOST.containerId, pid: process.pid }),
      { mode: 0o600 },
    );
  } catch {
    // เขียนไม่ได้ — กลับไปพึ่งบันทึก shutdown ใน Mongo อย่างเดียว ห้ามทำให้การปิดสะดุด
  }
}

function removeCleanExitMarker(): void {
  try {
    rmSync(cleanExitMarkerPath(), { force: true });
  } catch {
    // ลบไม่ได้ก็ไม่มีอะไรให้ทำ
  }
}

/**
 * อ่านป้ายของ process ก่อนหน้าแล้วลบทิ้ง — คืนเวลาที่มันปิด หรือ null รับเฉพาะป้ายที่เขียนในชื่อเครื่องนี้ (ถ้ามีใครเอา volume มา
 * ทับ `/tmp` ร่วมกันหลาย container ป้ายของตัวอื่นต้องไม่นับเป็นของตัวนี้) ไม่ throw
 */
function takeCleanExitMarker(): Date | null {
  let at: Date | null = null;
  try {
    const marker = JSON.parse(readFileSync(cleanExitMarkerPath(), "utf8")) as { at?: unknown; containerId?: unknown };
    if (marker.containerId === HOST.containerId && typeof marker.at === "string") {
      const parsed = new Date(marker.at);
      if (!Number.isNaN(parsed.getTime())) at = parsed;
    }
  } catch {
    // ไม่มีป้าย หรืออ่านไม่ออก = ไม่รู้ว่าก่อนหน้าปิดตามปกติ
  }
  removeCleanExitMarker();
  return at;
}

// --------------------------------------------------------------------------------------------- การเก็บ

function capture(err: unknown, options: CaptureOptions): string | null {
  const now = new Date();
  const id = randomUUID();
  const level = options.level ?? "error";
  const req = options.req;
  const mechanism = options.mechanism ?? (req ? "express" : "captured");
  const handled = options.handled ?? (mechanism === "express" || mechanism === "captured");
  const ctx = currentContext();
  // ตั้งก่อนอย่างอื่น — ถ้าข้างล่าง throw ก็ยังถือว่ามีคนพยายามเก็บแล้ว 5xx ของคำขอนี้ไม่ต้องถูกเก็บซ้ำ (index.ts)
  if (ctx) ctx.errorCaptured = true;
  const scrubbed = scrubError(err);
  const tag = options.tag ?? null;

  const method = req?.method ?? ctx?.method ?? null;
  const route = ctx?.route ?? null;
  /** ที่เกิด ในรูปที่คนอ่านและใช้จัดกลุ่ม: `POST /api/organizations/:id/review` */
  const where = route ? `${method ?? ""} ${route}`.trim() : null;
  const fingerprint = options.fingerprint ?? defaultFingerprint(scrubbed, where ?? tag);
  const correlation = ctx?.correlationId ?? null;
  const reference = correlation ? referenceOf(correlation) : null;

  const target = req ? requestTarget(req.originalUrl) : null;
  const session = req?.session;
  const actorId = session?.sub ?? ctx?.actorId ?? null;

  const doc: ErrorEventDoc = {
    _id: id,
    occurredAt: now,
    fingerprint,
    level,
    handled,
    tag,
    service,
    environment: env.deployEnv,
    release: env.release,
    host: HOST,
    mechanism,
    error: {
      name: scrubbed.name,
      message: scrubbed.message,
      stack: scrubbed.stack,
      props: scrubbed.props,
      causes: scrubbed.causes,
    },
    request:
      ctx || req
        ? {
            method,
            route,
            path: target?.path ?? null,
            queryKeys: target?.queryKeys ?? [],
            status: options.status ?? null,
            durationMs: ctx ? now.getTime() - ctx.startedAt : null,
            correlationId: correlation,
            reference,
            ip: ctx?.ipAddress ?? null,
            userAgent: ctx?.userAgent ? scrubClipped(ctx.userAgent, 512) : null,
            bodyShape: req ? bodyShape(req.body) : null,
          }
        : null,
    actor: actorId
      ? {
          id: actorId,
          roles: session?.roles ?? [],
          organizationId: session?.organizationId ?? null,
          // id ของแถว iam.session ไม่ใช่ค่า cookie
          sessionId: session?.sessionId ?? null,
        }
      : null,
    breadcrumbs: ctx ? [...ctx.breadcrumbs] : [],
    extra: boundedExtra(options.extra),
    browser: null,
    ingest: null,
  };

  const outcome = keep(doc, fingerprint, scrubbed, where ?? tag);
  if (ctx && (outcome === "capped_issue" || outcome === "capped_process")) unstored.set(ctx, { doc, outcome });
  if (options.print !== false) printLine(doc, scrubbed, where ?? tag, outcome);
  return outcome === "queued" ? id : null;
}

// --------------------------------------------------------------------------------------------- รายงานที่รับเข้ามา

/**
 * รายงาน error จากนอก process (routes/client-errors.ts) ที่**ผู้เรียกกวาดแล้ว** ด้วย lib/redact.ts — ไฟล์นี้ไม่กวาดให้อีก
 * `where` = ที่เกิดในรูปที่คนอ่าน (แม่แบบของหน้า `/organizations/:id` หรือ route ของ Next) เป็น culprit ของ issue
 */
export interface IngestedReport {
  service: "browser" | "frontend-server";
  level: ErrorLevel;
  mechanism: ReportMechanism;
  fingerprint: string;
  where: string | null;
  error: ScrubbedError;
  occurredAt: Date;
  /** รุ่นของโค้ดที่เกิด (บันเดิลของเบราว์เซอร์ หรือ image ของ frontend) — ไม่รู้ = `unknown` */
  release: string;
  tag: string | null;
  request: ErrorEventDoc["request"];
  browser: BrowserContext | null;
  /** ข้อมูลเพิ่มที่**ผู้เรียกกวาดแล้ว** — ตอนนี้มีแค่ `digest` ของ Next บน event ของ Next server ที่ยืนยันแล้ว */
  extra: Record<string, unknown> | null;
  ingest: IngestContext;
}

/**
 * เก็บรายงานหนึ่งตัว — คืน id ของ event ถ้าได้เข้าคิว หรือ null (ปิดอยู่ เกินเพดาน นับอย่างเดียว คิวเต็ม) ไม่ throw
 *
 * กติกาเดียวกับ `captureError` (นับเข้า issue ก่อน แล้วจึงตัดสินว่าจะเก็บตัว event ไหม) ต่างกันสามข้อ:
 *   - **ไม่พิมพ์ลง stdout** — ใครก็ส่งมาได้ถี่เท่าที่ต้องการ บรรทัดของมันจะกลบ log ของระบบ (Next server พิมพ์บรรทัดของตัวเอง
 *     อยู่แล้ว — frontend/lib/server-error-report.ts)
 *   - รายงานจากเบราว์เซอร์เก็บได้ไม่เกิน 60 ตัวต่อนาที (BROWSER_PER_MINUTE) และอยู่ชั้นล่างสุดของคิว (ทิ้งก่อนทุกอย่าง)
 *   - issue ได้ `service` ของรายงาน และรุ่นของมัน (`firstRelease` / `lastRelease`) ไม่ใช่ของ backend ที่รับเข้ามา
 *   - รายงานจากเบราว์เซอร์**สร้าง issue ใหม่ได้เฉพาะ**ตอนที่ไม่เกินเพดานขนาด และ fingerprint ของมันอยู่ในร้อยตัวแรกของชั่วโมงนี้
 *     (`admitBrowserFingerprint` — สองตัวที่ตั้งชื่อเอง `browser:chunk-load` / `proxy:backend_unreachable` ได้เสมอ) นอกนั้นเดินแค่
 *     ตัวนับของ issue ที่มีอยู่แล้ว และไม่เก็บตัว event — event ของ fingerprint ที่อาจไม่มี issue จะเป็น event ที่ไม่มีใครเห็นในรายการ
 *     issue (plan §3 "over quota, counters only" ตีความว่า "ตัวนับของที่มีอยู่")
 *   - **ยกเว้นรายงานที่มีรหัสอ้างอิง** (`browser.reference` — หน้า global-error, 502 ของ proxy): รหัสนั้นผู้ใช้อ่านให้เจ้าหน้าที่ฟัง
 *     และ Postman G6 ค้นจากตัว event (`reports`) ไม่ใช่จาก issue จึงเก็บตัว event เสมอเมื่อไม่เกินเพดานขนาด แม้ issue ไม่ถูกสร้าง
 *     (`extra.capped: "browser_fingerprints"` บอกว่า issue ของ fingerprint นี้อาจไม่มี) และไม่ติดเพดาน 50 ตัวต่อ fingerprint ต่อ
 *     ชั่วโมง (ผู้ใช้ร้อยคนเจอ 502 ตอน backend ล่มได้รหัสร้อยตัว ต้องค้นเจอร้อย) เดิมรายงานขยะร้อยข้อความ (`X-Forwarded-For`
 *     เขียนเองได้ เพดานต่อ IP จึงไม่ช่วย) ทำให้รหัสบนหน้า global-error ที่มาหลังจากนั้นค้นไม่เจอทั้งชั่วโมง (ตรวจขั้น 9, 2026-10-01)
 *   - รายงานที่มีรหัสอ้างอิงซึ่ง**เกินเพดานต่อนาที** (60 ของเบราว์เซอร์ หรือ 600 ของ process) เก็บเป็น**ตัวย่อ**แทน
 *     (`keepBrowserReference`) — เดิมทิ้งไปเลย ใครก็ยิงรายงานขยะนาทีละหกสิบตัว (หนึ่งตัวต่อวินาที) ทำให้รหัสทุกตัวที่ผู้ใช้เห็นใน
 *     นาทีนั้นค้นไม่เจอ (ตรวจขั้น 9 แบบค้าน 2026-10-01) ตอนนี้ต้องยิงเกินเพดานรวมของ routes/client-errors.ts (300 ต่อนาที) ซึ่งที่
 *     นั่นรายงานถูกทิ้งก่อนถึงตรงนี้อยู่แล้ว — endpoint ที่ไม่ต้อง login ป้องกันได้แค่นั้น
 */
export function captureReport(report: IngestedReport): string | null {
  try {
    if (!env.logStore.enabled) return null;
    const browser = report.service === "browser";
    const referenced = browser && typeof report.browser?.reference === "string";
    const overQuota = logStoreStatus().status === "over_quota";
    const now = Date.now();
    const create = !browser || (!overQuota && admitBrowserFingerprint(report.fingerprint, now));
    const doc: ErrorEventDoc = {
      _id: randomUUID(),
      occurredAt: report.occurredAt,
      fingerprint: report.fingerprint,
      level: report.level,
      handled: false,
      tag: report.tag,
      service: report.service,
      environment: env.deployEnv,
      release: report.release,
      host: HOST,
      mechanism: report.mechanism,
      error: {
        name: report.error.name,
        message: report.error.message,
        stack: report.error.stack,
        props: report.error.props,
        causes: report.error.causes,
      },
      request: report.request,
      actor: null,
      breadcrumbs: [],
      extra: boundedExtra(report.extra ?? undefined),
      browser: report.browser,
      ingest: report.ingest,
    };
    const delta = countIssue(doc, report.fingerprint, report.error, report.where, create);
    if (!delta) {
      noteDropped(doc.occurredAt, 1, browser ? "browser_backlog" : "issue_backlog");
      if (referenced) browserReferencesLost += 1;
      return null;
    }
    delta.release = report.release;
    if (!create) browserNotCreated += 1;
    if (overQuota) {
      if (referenced) browserReferencesLost += 1;
      return null;
    }
    if (!delta.create && !referenced) return null;
    if (!delta.create) doc.extra = { ...(doc.extra ?? {}), capped: "browser_fingerprints" };
    const cap = admit(report.fingerprint, now, browser, referenced);
    if (cap !== null) return referenced ? keepBrowserReference(doc, cap, delta.create, now) : null;
    const bytes = fitDocument(doc);
    const priority = browser ? PRIORITY.browser : report.level === "warning" ? PRIORITY.warning : PRIORITY.error;
    if (!enqueue({ kind: "event", doc, bytes, priority })) {
      if (referenced) browserReferencesLost += 1;
      return null;
    }
    delta.lastEventId = doc._id;
    return doc._id;
  } catch {
    return null;
  }
}

/**
 * ตัวย่อของรายงานเบราว์เซอร์ที่มีรหัสอ้างอิงซึ่งเกินเพดานต่อนาทีที่เก็บได้ต่อ process ต่อนาที — 240 บวก 60 ตัวเต็มเท่ากับเพดานรวม
 * ของเบราว์เซอร์ใน routes/client-errors.ts (300) คนที่จะกลบรหัสของผู้ใช้จึงต้องยิงเกินนั้น ซึ่งที่นั่นรายงานถูกทิ้งตั้งแต่ต้นทางอยู่แล้ว
 * แยกจาก `REFERENCE_STUBS_PER_MINUTE` ของ 5xx ฝั่ง server — รายงานที่ใครก็ส่งได้ต้องไม่กินที่ของรหัสที่ backend ออกเอง
 */
const BROWSER_REFERENCE_STUBS_PER_MINUTE = 240;
let browserStubWindow = { start: 0, stored: 0 };

/**
 * เก็บรายงานเบราว์เซอร์ที่มีรหัสอ้างอิงซึ่งติดเพดานต่อนาที (`cap`) เป็นตัวย่อ: รหัส หน้า รุ่น ชื่อกับข้อความสั้น ๆ ของ error
 * ไม่มี stack และคำขอ API ห้าตัวล่าสุด (`extra.referenceOnly: true`) — G6 ค้นจาก `browser.reference` เหมือนตัวเต็ม คืน id หรือ null
 * อยู่ชั้นล่างสุดของคิวเหมือนรายงานเบราว์เซอร์อื่น
 */
function keepBrowserReference(
  doc: ErrorEventDoc,
  cap: "capped_issue" | "capped_process",
  issueCreated: boolean,
  now: number,
): string | null {
  if (now - browserStubWindow.start >= 60_000) browserStubWindow = { start: now, stored: 0 };
  if (browserStubWindow.stored >= BROWSER_REFERENCE_STUBS_PER_MINUTE) {
    browserReferencesLost += 1;
    return null;
  }
  const stub: ErrorEventDoc = {
    ...doc,
    error: { name: doc.error.name, message: doc.error.message.slice(0, 300), stack: null, props: {}, causes: [] },
    browser: doc.browser ? { ...doc.browser, lastApi: [] } : null,
    // `capped` ของตัวย่อคือเพดานต่อนาทีที่ติด (แบบเดียวกับตัวย่อของ server) · issue ที่ไม่ถูกสร้างบอกแยกใน `issueCapped`
    extra: { referenceOnly: true, capped: cap, ...(issueCreated ? {} : { issueCapped: "browser_fingerprints" }) },
  };
  if (!enqueue({ kind: "event", doc: stub, bytes: sizeOf(stub), priority: PRIORITY.browser })) {
    browserReferencesLost += 1;
    return null;
  }
  browserStubWindow.stored += 1;
  return stub._id;
}

// --------------------------------------------------------------------------------------------- รหัสอ้างอิง

/** เก็บรหัสอ้างอิงที่ไม่มีตัวอย่างเต็มได้ไม่เกินนี้ต่อ process ต่อนาที — แยกจากเพดาน 600 ตัวของ event เต็ม */
const REFERENCE_STUBS_PER_MINUTE = 120;
let stubWindow = { start: 0, stored: 0 };

/**
 * error ของคำขอที่ติดเพดานการสุ่มเก็บ (ครบ 50 ตัวต่อชั่วโมงของ issue หรือ 600 ตัวต่อนาทีของ process) — ตัวล่าสุด
 * ของแต่ละคำขอ รอดูว่าคำขอนั้นจะตอบ 5xx พร้อมรหัสอ้างอิงหรือเปล่า (`keepReference`) หายไปเองพร้อมบริบทของคำขอ
 */
const unstored = new WeakMap<RequestContext, { doc: ErrorEventDoc; outcome: "capped_issue" | "capped_process" }>();

/**
 * ให้รหัสอ้างอิงที่กำลังจะไปถึงตาผู้ใช้ค้นเจอใน error_events — เรียกจาก `referenceOnServerErrors` (index.ts) ทุกครั้ง
 * ที่คำตอบ 5xx ได้รหัสอ้างอิง ไม่ throw
 *
 * error ที่ติดเพดานการสุ่มเก็บเหลือแค่ตัวนับของ issue ไม่มีเอกสารที่ถือ correlation id ของคำขอนั้น — 503 `no_reviewer`
 * ที่หน่วยงานกดส่งพร้อมกันหกสิบแห่งในชั่วโมงเดียวได้รหัสหกสิบตัว แต่ค้นเจอแค่ห้าสิบ ตัวนี้เก็บ**ตัวย่อ**ของ error ตัวนั้น
 * แทน: fingerprint (โยงกับ issue), ชื่อกับข้อความ, route, status, ผู้ใช้, เวลา ไม่มี stack, cause, breadcrumb, รูปร่าง
 * ของ body — `extra.referenceOnly: true` บอกว่าเป็นตัวย่อ
 *
 * ยังค้นไม่เจอเมื่อ: log store เกินเพดานขนาด (เก็บแค่ตัวนับ), คิวเต็ม, หรือเกิน 120 ตัวย่อต่อนาที — เหลือแค่ตัวนับของ
 * issue กับบรรทัด `[capture] … ref=` ใน stdout
 */
export function keepReference(status: number): void {
  try {
    const ctx = currentContext();
    if (!ctx || !env.logStore.enabled) return;
    const pending = unstored.get(ctx);
    if (!pending) return;
    unstored.delete(ctx);
    if (logStoreStatus().status === "over_quota") return;

    const now = Date.now();
    if (now - stubWindow.start >= 60_000) stubWindow = { start: now, stored: 0 };
    if (stubWindow.stored >= REFERENCE_STUBS_PER_MINUTE) return;

    const { doc, outcome } = pending;
    const stub: ErrorEventDoc = {
      ...doc,
      error: { name: doc.error.name, message: doc.error.message, stack: null, props: doc.error.props, causes: [] },
      request: doc.request ? { ...doc.request, status, bodyShape: null } : null,
      breadcrumbs: [],
      extra: { referenceOnly: true, capped: outcome },
    };
    // ชั้นเดียวกับคำเตือน — คิวเต็มแล้วตัวย่อถูกทิ้งก่อนตัวอย่างเต็มทุกตัว
    if (enqueue({ kind: "event", doc: stub, bytes: sizeOf(stub), priority: PRIORITY.warning })) stubWindow.stored += 1;
  } catch {
    // รหัสอ้างอิงที่ค้นไม่เจอดีกว่าคำตอบที่ส่งไม่ออก
  }
}

/**
 * `capped_issue` = ครบ 50 ตัวต่อชั่วโมงของ fingerprint นี้ · `capped_process` = ครบ 600 ตัวต่อนาทีของทั้ง process ·
 * `issue_backlog` = issue ที่รอเขียนครบแล้ว ไม่ได้นับด้วยซ้ำ · `dropped` = คิวเต็ม
 */
type Outcome = "queued" | "disabled" | "over_quota" | "capped_issue" | "capped_process" | "issue_backlog" | "dropped";

/** นับเข้า issue แล้วตัดสินว่าจะเก็บตัว event ไหม */
function keep(doc: ErrorEventDoc, fingerprint: string, scrubbed: ScrubbedError, where: string | null): Outcome {
  if (!env.logStore.enabled) return "disabled";

  const delta = countIssue(doc, fingerprint, scrubbed, where);
  if (!delta) {
    noteDropped(doc.occurredAt, 1, "issue_backlog");
    return "issue_backlog";
  }
  if (logStoreStatus().status === "over_quota") return "over_quota";
  /**
   * fatal ไม่ผ่านเพดานการสุ่มเก็บ — เกิดได้ครั้งเดียวต่อ process (exit ตามมาทันที) จึงท่วมอะไรไม่ได้ และเป็นตัวที่
   * บอกว่าทำไม process ตาย ถ้าต้องผ่านเพดานด้วย uncaughtException ที่มาระหว่างพายุ error (เกิน 600 ต่อนาทีอยู่แล้ว)
   * จะเหลือแค่ตัวนับ คิวก็ให้ fatal อยู่ชั้นบนสุดด้วยเหตุผลเดียวกัน
   */
  if (doc.level !== "fatal") {
    const cap = admit(fingerprint, doc.occurredAt.getTime());
    if (cap !== null) return cap;
  }

  const bytes = fitDocument(doc);
  const priority = doc.level === "fatal" ? PRIORITY.fatal : doc.level === "error" ? PRIORITY.error : PRIORITY.warning;
  if (!enqueue({ kind: "event", doc, bytes, priority })) return "dropped";
  delta.lastEventId = doc._id;
  return "queued";
}

function countIssue(
  doc: ErrorEventDoc,
  fingerprint: string,
  scrubbed: ScrubbedError,
  where: string | null,
  create = true,
): IssueDelta | null {
  const existing = pendingIssues.get(fingerprint);
  if (existing) {
    existing.count += 1;
    existing.lastSeen = doc.occurredAt;
    existing.level = doc.level;
    // ครั้งไหนก็ตามในก้อนเดียวกันที่สร้างได้ ก็สร้างได้ (เช่นเพดานขนาดลงระหว่างก้อน)
    if (create) existing.create = true;
    return existing;
  }
  if (!roomForIssue(doc.service, doc.level)) return null;
  const delta: IssueDelta = {
    fingerprint,
    service: doc.service,
    title: `${scrubbed.name}: ${normalizeMessage(headlineOf(scrubbed.name, scrubbed.message))}`.slice(0, 200),
    culprit: (where ?? scrubbed.topFrame ?? doc.service).slice(0, 200),
    level: doc.level,
    tag: doc.tag,
    count: 1,
    firstSeen: doc.occurredAt,
    lastSeen: doc.occurredAt,
    lastEventId: null,
    create,
  };
  pendingIssues.set(fingerprint, delta);
  return delta;
}

/**
 * issue ใหม่ (ยังไม่มีตัวนับที่รอเขียน) ได้ที่ไหม — fatal ได้เสมอ (เกิดได้ครั้งเดียวต่อ process แล้ว exit ตามมา และเป็นตัวที่บอกว่า
 * ทำไม process ตาย) นอกนั้นไม่เกิน PENDING_ISSUES_MAX และของเบราว์เซอร์ไม่เกิน BROWSER_PENDING_ISSUES_MAX ที่เหลือจึงเป็นของ server
 * อย่างน้อย 800 เสมอ นับของเบราว์เซอร์ด้วยการไล่ทั้ง Map (ไม่เกินพันตัว) เฉพาะตอนจะเปิดที่ใหม่ของเบราว์เซอร์ — ไม่มีตัวนับให้หลุด
 */
function roomForIssue(owner: EventService, level: ErrorLevel): boolean {
  if (level === "fatal") return true;
  if (pendingIssues.size >= PENDING_ISSUES_MAX) return false;
  if (owner !== "browser") return true;
  let browser = 0;
  for (const delta of pendingIssues.values()) if (delta.service === "browser") browser += 1;
  return browser < BROWSER_PENDING_ISSUES_MAX;
}

/**
 * fingerprint ของรายงานเบราว์เซอร์ตัวนี้สร้าง issue ได้ไหม — ได้ถ้าเห็นแล้วในชั่วโมงนี้ หรือยังไม่ครบ BROWSER_FINGERPRINTS_PER_HOUR
 * (ชั่วโมงเริ่มนับจากรายงานแรกหลังชั่วโมงก่อนจบ) fingerprint ที่มีอยู่แล้วใน log store ก็กินที่ในชุดนี้ด้วย — process ไม่รู้ว่า
 * ตัวไหนมีอยู่แล้ว ซึ่งไม่เสียอะไร ตัวที่ไม่ได้ที่ยังเดินตัวนับของ issue เดิมได้ (`upsert: false`) · `FIXED_BROWSER_FINGERPRINTS`
 * ได้เสมอโดยไม่กินที่
 */
function admitBrowserFingerprint(fingerprint: string, now: number): boolean {
  if (FIXED_BROWSER_FINGERPRINTS.has(fingerprint)) return true;
  if (now - browserFingerprints.start >= 3_600_000) browserFingerprints = { start: now, seen: new Set() };
  if (browserFingerprints.seen.has(fingerprint)) return true;
  if (browserFingerprints.seen.size >= BROWSER_FINGERPRINTS_PER_HOUR) return false;
  browserFingerprints.seen.add(fingerprint);
  return true;
}

/**
 * เพดาน 50 ตัวต่อ fingerprint ต่อชั่วโมง และ 600 ตัวต่อ process ต่อนาที — เกินแล้วนับอย่างเดียว
 * คืน null ถ้าเก็บได้ หรือบอกว่าติดเพดานตัวไหน: บรรทัดใน stdout ต้องบอกให้ถูก ไม่งั้น error ที่เพิ่งเห็นครั้งแรก
 * แต่ติดเพดานของ process ถูกพิมพ์ว่า "เก็บตัวอย่างของ issue นี้ครบแล้ว" ซึ่งไม่จริง
 *
 * `referenced` = รายงานจากเบราว์เซอร์ที่มีรหัสอ้างอิง (`captureReport`) — ไม่ผ่านเพดานต่อ fingerprint และไม่กินที่ของมัน (รหัสทุกตัว
 * ต้องค้นเจอ ไม่ใช่แค่ห้าสิบตัวแรก) แต่ยังผ่านเพดานต่อนาทีทั้งสองตัว
 */
function admit(
  fingerprint: string,
  now: number,
  browser = false,
  referenced = false,
): "capped_issue" | "capped_process" | null {
  if (now - processWindow.start >= 60_000) processWindow = { start: now, stored: 0, browser: 0 };
  if (processWindow.stored >= PER_PROCESS_PER_MINUTE) return "capped_process";
  if (browser && processWindow.browser >= BROWSER_PER_MINUTE) return "capped_process";

  if (!referenced) {
    let window = perFingerprint.get(fingerprint);
    if (!window || now - window.windowStart >= 3_600_000) {
      window = { windowStart: now, stored: 0 };
      perFingerprint.set(fingerprint, window);
    }
    if (window.stored >= PER_FINGERPRINT_PER_HOUR) return "capped_issue";
    window.stored += 1;
  }

  processWindow.stored += 1;
  if (browser) processWindow.browser += 1;
  return null;
}

/**
 * fingerprint ตั้งต้น: sha1(service | ชื่อ error | หัวเรื่องของข้อความที่ตัด id กับตัวเลขทิ้ง | เฟรมแรกของโค้ดเรา |
 * route หรือ tag) ไม่มีเลขบรรทัด — แก้โค้ดบรรทัดข้างบนแล้ว issue เดิมยังเป็น issue เดิม ใช้แค่หัวเรื่อง (`headlineOf`)
 * ไม่ใช่ข้อความเต็ม เพราะข้อความของ Prisma ยกโค้ดรอบจุดที่เรียกมาด้วย แก้บรรทัดข้างเคียงแล้ว issue จะแตก
 */
function defaultFingerprint(scrubbed: ScrubbedError, where: string | null): string {
  const headline = normalizeMessage(headlineOf(scrubbed.name, scrubbed.message));
  return createHash("sha1")
    .update([service, scrubbed.name, headline, scrubbed.topFrame ?? "", where ?? ""].join("|"))
    .digest("hex");
}

const UUID_ANYWHERE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

export function normalizeMessage(message: string): string {
  return message.replace(UUID_ANYWHERE, "<uuid>").replace(/\d+/g, "<n>").slice(0, 200);
}

function boundedExtra(extra: Record<string, unknown> | undefined): Record<string, unknown> | null {
  if (!extra) return null;
  try {
    const bytes = bsonSize(extra);
    return bytes <= EXTRA_MAX_BYTES ? extra : { truncated: true, bytes, keys: Object.keys(extra).slice(0, 20) };
  } catch {
    return { unserialisable: true };
  }
}

/**
 * ขนาดของเอกสารเมื่อเป็น BSON — ตัวที่ Mongo เก็บจริง และตัวเดียวกับที่ `fitDocument()` ของ lib/activity-shape.ts ใช้
 * เดิมเป็นความยาวของ JSON: array ของค่าสั้น ๆ ใน BSON แพงกว่ามาก (สำเนา audit ที่ "พอดี 64 KB" ด้วย JSON เป็น 80 KB) และ
 * ข้อความที่มีเครื่องหมายคำพูดกลับถูกนับเกิน — สองตัววัดต้องตรงกัน ไม่งั้นสำเนาที่ activity-shape ตัดจนผ่านแล้วถูกทิ้งที่นี่
 * เป็น `too_large` ได้ (ใช้เป็นตัวนับหน่วยความจำของคิวด้วย ซึ่งตัววัดไหนก็ใช้ได้)
 */
function sizeOf(doc: unknown): number {
  return bsonSize(doc);
}

/** ให้เอกสารไม่เกิน 64 KB — ตัดของที่ช่วยน้อยที่สุดก่อน คืนขนาดสุดท้าย */
function fitDocument(doc: ErrorEventDoc): number {
  let bytes = sizeOf(doc);
  if (bytes > DOC_MAX_BYTES && doc.extra) {
    doc.extra = { truncated: true };
    bytes = sizeOf(doc);
  }
  if (bytes > DOC_MAX_BYTES && doc.error.stack) {
    doc.error.stack = `${doc.error.stack.slice(0, 4_096)}…`;
    bytes = sizeOf(doc);
  }
  if (bytes > DOC_MAX_BYTES) {
    doc.breadcrumbs = [];
    if (doc.request) doc.request.bodyShape = null;
    doc.error.causes = [];
    bytes = sizeOf(doc);
  }
  return bytes;
}

/** บรรทัดเดียวใน stdout ต่อ error หนึ่งตัว — docker logs ยังเป็นที่แรกที่คนเปิดดู และเป็นที่เดียวตอน Mongo ล่ม */
function printLine(doc: ErrorEventDoc, scrubbed: ScrubbedError, where: string | null, outcome: Outcome) {
  const event =
    outcome === "queued"
      ? `event=${doc._id}`
      : outcome === "disabled"
        ? "event=- (log store ปิดอยู่)"
        : outcome === "over_quota"
          ? "event=- (log store เกินเพดานขนาด: นับอย่างเดียว)"
          : outcome === "capped_issue"
            ? `event=- (เก็บตัวอย่างของ issue นี้ครบ ${PER_FINGERPRINT_PER_HOUR} ตัวในชั่วโมงนี้แล้ว: นับอย่างเดียว)`
            : outcome === "capped_process"
              ? `event=- (เกินเพดาน ${PER_PROCESS_PER_MINUTE} ต่อนาทีของ process: นับอย่างเดียว)`
              : outcome === "issue_backlog"
                ? `event=- (issue ที่รอเขียนครบ ${PENDING_ISSUES_MAX} fingerprint: ไม่ได้นับ)`
                : "event=- (คิวเต็ม: ทิ้ง)";
  const issue = /^[0-9a-f]{40}$/.test(doc.fingerprint) ? doc.fingerprint.slice(0, 12) : doc.fingerprint;
  const ref = doc.request?.reference ? ` ref=${doc.request.reference}` : "";
  const firstLine = headlineOf(scrubbed.name, scrubbed.message).slice(0, 300);
  const frame = scrubbed.topFrame ? ` @ ${scrubbed.topFrame}` : "";
  const line =
    `[capture] ${service} ${doc.level} ${event}${ref} issue=${issue} ${where ?? "-"} — ` +
    `${scrubbed.name}: ${firstLine}${frame}`;
  if (doc.level === "warning") console.warn(line);
  else console.error(line);
}

// --------------------------------------------------------------------------------------------- คิว

/** วางลงคิว ไล่ตัวที่สำคัญน้อยกว่าออกถ้าเต็ม — คืน false ถ้าตัวที่เข้ามาใหม่เองถูกทิ้ง */
/**
 * บันทึกการเรียก admin API (`kind: "access"`) มีกติกาของมันเอง:
 *   - ตัวที่คิวรับไม่ได้ไม่นับเป็น "ทิ้ง" — มาครั้งแรกผู้เรียกได้ `full` แล้วพับลงบันทึกสรุปเอง (lib/admin-access.ts) ตัวที่เคยอยู่
 *     ในคิวแล้ว (`requeued` — `requeue` หลังเขียนล้ม) ส่งให้ไฟล์นั้นพับ แบบเดียวกับตัวที่ถูกเบียด
 *   - **บันทึกสรุปไม่เบียดบันทึกเดี่ยว** (ไล่ได้แค่รายงานจากเบราว์เซอร์) — ตัวเดี่ยวที่ถูกเบียดก็ถูกพับเป็นสรุปอีกใบ สรุปใบนั้นก็เบียด
 *     ตัวถัดไป วนแลกหนึ่งต่อหนึ่งไม่ได้อะไรขึ้นมาตลอดที่คิวเต็ม และเสียรายละเอียดของตัวเดี่ยว (เวลา correlation id) ไปทีละตัว
 *     สรุปที่เข้าไม่ได้รอแล้วลองใหม่ (ลองแล้ว 2026-10-01: Mongo หยุด คิวเต็มด้วยตัวเดี่ยว ได้สรุปใบละหนึ่งการเรียกสิบกว่าใบ)
 */
function enqueue(item: RingItem, requeued = false): boolean {
  if (item.bytes > DOC_MAX_BYTES) {
    noteDropped(new Date(), 1, "too_large", item.kind === "activity" ? 1 : 0);
    return false;
  }
  while (ring.length >= RING_MAX_DOCS || ringBytes + item.bytes > RING_MAX_BYTES) {
    const victim = lowestPriorityIndex();
    const victimItem = victim === -1 ? undefined : ring[victim];
    if (
      !victimItem ||
      victimItem.priority >= item.priority ||
      (item.kind === "access" && victimItem.kind === "access")
    ) {
      if (item.kind === "access") {
        if (!requeued || handOverAccessRecord(item.doc)) return false;
      }
      noteDropped(new Date(), 1, "queue_full", item.kind === "activity" ? 1 : 0);
      return false;
    }
    ring.splice(victim, 1);
    ringBytes -= victimItem.bytes;
    if (victimItem.kind === "access" && handOverAccessRecord(victimItem.doc)) continue;
    noteDropped(new Date(), 1, "queue_full", victimItem.kind === "activity" ? 1 : 0);
  }
  ring.push(item);
  ringBytes += item.bytes;
  return true;
}

/** ตัวเก่าสุดในกลุ่มที่สำคัญน้อยสุด */
function lowestPriorityIndex(): number {
  let index = -1;
  let lowest = Number.POSITIVE_INFINITY;
  for (let i = 0; i < ring.length; i++) {
    const priority = ring[i]?.priority ?? Number.POSITIVE_INFINITY;
    if (priority < lowest) {
      lowest = priority;
      index = i;
    }
  }
  return index;
}

function noteDropped(at: Date, count: number, reason: DropReason, auditCopies = 0) {
  droppedSinceStart += count;
  dropped.count += count;
  dropped.reasons[reason] += count;
  dropped.auditCopies += auditCopies;
  dropped.first ??= at;
  dropped.last = at;
}

function hasWork(): boolean {
  return ring.length > 0 || pendingIssues.size > 0;
}

// --------------------------------------------------------------------------------------------- การเขียน

function tick() {
  if (flushing || exiting || !hasWork() || Date.now() < nextAttemptAt) return;
  flushing = runFlush().finally(() => {
    flushing = null;
  });
}

/** เขียนหนึ่งก้อน — ไม่ reject สำเร็จแล้วล้างตัวนับการถอยห่าง ล้มแล้วถอยห่างเป็นเท่าตัวจนถึง 60 วินาที */
async function runFlush(): Promise<void> {
  try {
    await flushOnce();
    if (failing) {
      failing = false;
      console.log(`[capture] ${service}: เขียน log store ได้อีกครั้ง — ค้างอยู่ ${ring.length} รายการ`);
    }
    failures = 0;
    nextAttemptAt = 0;
    pruneWindows(Date.now());
    if (dropped.count > 0) enqueueDroppedSummary();
  } catch (err) {
    failures += 1;
    nextAttemptAt = Date.now() + Math.min(FLUSH_INTERVAL_MS * 2 ** failures, BACKOFF_MAX_MS);
    if (!failing) {
      failing = true;
      console.warn(
        `[capture] ${service}: ยังเขียน log store ไม่ได้ (${reasonOf(err)}) — เก็บไว้ในหน่วยความจำ ` +
          `${ring.length} รายการ (เพดาน ${RING_MAX_DOCS}) ลองใหม่ถอยห่างไม่เกิน ${BACKOFF_MAX_MS / 1000} วินาที`,
      );
    }
  }
}

class StoreUnavailable extends Error {}

/** สาเหตุสั้น ๆ สำหรับบรรทัดเดียว — ชื่อกับรหัสของ error เท่านั้น ข้อความเต็มของ Mongo ยก command มาได้ */
function reasonOf(err: unknown): string {
  if (err instanceof StoreUnavailable) return `log store ${logStoreStatus().status}`;
  if (!(err instanceof Error)) return "Error";
  const code = (err as { code?: unknown; codeName?: unknown }).codeName ?? (err as { code?: unknown }).code;
  return `${err.name}${typeof code === "string" || typeof code === "number" ? ` ${code}` : ""}`;
}

/**
 * หยิบจากคิวหนึ่งก้อน (ไม่เกิน 500) กับ issue ที่รอทั้งหมด แล้วเขียน — ส่วนที่ยังไม่ได้เขียนตอนล้มกลับเข้าคิว
 *
 * ลำดับ: event → บันทึกของ process → สำเนา audit → issue ส่วนที่เขียนแล้วไม่เอากลับเข้าคิว event ที่เขียนไปแล้ว
 * บางส่วนแล้วถูกลองซ้ำชน `_id` เดิม ซึ่งถือว่าสำเร็จ (duplicate key 11000)
 *
 * **ตัวนับของ issue นับซ้ำได้ทั้งก้อน** — `$inc` ไม่ idempotent: คำสั่งที่ driver เลิกรอไปแล้ว (socketTimeoutMS 5 วินาที)
 * แต่ server ได้รับไว้แล้ว ถูกทำจริงทีหลัง แล้วรอบที่ลองซ้ำก็ `$inc` อีกครั้ง ลองแล้ว 2026-09-30: `docker compose pause
 * mongo` สิบกว่าวินาทีระหว่างที่มี error 20 ตัว ตัวนับขึ้น 40 (Mongo ที่ช้าจนคำสั่งเดียวเกิน 5 วินาทีก็เป็นแบบเดียวกัน)
 * ยอมรับไว้ก่อน: ตัวนับที่เกินดีกว่าตัวนับที่หาย และ event ทีละตัวไม่ซ้ำ ทางแก้ถ้าต้องการตัวเลขตรงคือให้ก้อนของ issue
 * มี id ของตัวเองที่ลองซ้ำด้วยตัวเดิม แล้วกรองด้วย id ที่เคยใช้แล้วในเอกสารของ issue
 */
async function flushOnce(): Promise<void> {
  const db = await logDb();
  if (!db) throw new StoreUnavailable();

  const items = ring.splice(0, RING_MAX_DOCS);
  ringBytes = ring.reduce((sum, item) => sum + item.bytes, 0);
  const issues = [...pendingIssues.values()];
  pendingIssues.clear();

  // operation ของ issue สร้างตอนนี้ ก่อน await แรก — ตัวเลขใน operation จึงเป็นของก้อนนี้เท่านั้น ไม่ว่าอะไรจะเกิด
  // กับวัตถุ IssueDelta ระหว่างที่เขียน
  const issueOps = issues.length > 0 ? issueOperations(issues) : [];
  const done = { items: false, issues: false };
  const slow = setTimeout(() => {
    console.warn(
      `[capture] ${service}: เขียน log store ก้อนนี้เกิน ${FLUSH_SLOW_MS / 1000} วินาทีแล้ว — รอให้จบก่อน ไม่เริ่มก้อนใหม่ซ้อน`,
    );
  }, FLUSH_SLOW_MS);
  slow.unref();
  try {
    // ไม่มี timeout ครอบ: ก้อนที่ถูกทิ้งไว้กลางทางยังเขียนต่อเบื้องหลัง ถ้าเอาของมันกลับเข้าคิวแล้วเริ่มก้อนใหม่ issue
    // จะถูกนับสองรอบ ของกลับเข้าคิวเฉพาะเมื่อรู้แน่แล้วว่าก้อนนี้จบ (ล้ม) และเฉพาะส่วนที่ยังไม่ได้เขียน
    await writeBatch(db, items, issueOps, done);
  } catch (err) {
    requeue(done.items ? [] : items, done.issues ? [] : issues);
    throw err;
  } finally {
    clearTimeout(slow);
  }
}

async function writeBatch(
  db: Db,
  items: RingItem[],
  issueOps: AnyBulkWriteOperation<IssueDoc>[],
  done: { items: boolean; issues: boolean },
): Promise<void> {
  // เกินเพดานขนาดระหว่างที่ event รออยู่ในคิว — ทิ้งตัว event (ตัวนับของ issue ยังเดิน) บันทึกของ process กับสำเนา
  // audit ยังเขียนตามปกติ
  const overQuota = logStoreStatus().status === "over_quota";
  const events: ErrorEventDoc[] = [];
  const runtime: RuntimeEventDoc[] = [];
  const activity: ActivityDoc[] = [];
  const access: ActivityDoc[] = [];
  for (const item of items) {
    if (item.kind === "event") {
      if (!overQuota) events.push(item.doc);
    } else if (item.kind === "runtime") runtime.push(item.doc);
    else if (item.kind === "access") {
      if (!overQuota) access.push(item.doc);
    } else activity.push(item.doc);
  }
  if (events.length > 0) await insertAll(db, "error_events", events);
  if (runtime.length > 0) await insertAll(db, "runtime_events", runtime);
  if (activity.length > 0) await insertAll(db, "activity", activity, { auditCopies: true });
  if (access.length > 0) await insertAll(db, "activity", access);
  done.items = true;

  if (issueOps.length > 0) {
    await db.collection<IssueDoc>("error_issues").bulkWrite(issueOps, { ordered: true });
  }
  done.issues = true;
}

/**
 * รหัสของ Mongo ที่แปลว่า "เอกสาร**ตัวนี้**ใช้ไม่ได้ ลองซ้ำกี่ครั้งก็ไม่ผ่าน" — BadValue, FailedToParse,
 * DollarPrefixedFieldName, DocumentValidationFailure, BSONObjectTooLarge, KeyTooLong
 * รหัสอื่นทั้งหมด (ปิดเครื่อง 11600/91, สลับ primary, สิทธิ์ 13, throttle 16500 ของ Cosmos, …) คือทั้งก้อนต้องลองใหม่
 */
export const DOCUMENT_REJECTED = new Set([2, 9, 52, 121, 10334, 17280]);

/**
 * insertMany ที่ทนการลองซ้ำ — `_id` ที่มีอยู่แล้ว (11000) คือเขียนไปแล้วรอบก่อน ถือว่าสำเร็จ ตัวที่ Mongo ปฏิเสธด้วย
 * รหัสใน DOCUMENT_REJECTED ถูกทิ้งและนับเป็น "ทิ้ง" ไม่งั้นมันจะค้างหัวคิวและถูกลองซ้ำไปตลอด
 *
 * นอกนั้น throw ต่อ ให้ทั้งก้อนกลับเข้าคิว — **รวมถึง `MongoBulkWriteError` ที่ `writeErrors` ว่าง**: driver ห่อ error
 * ระดับคำสั่ง (server กำลังปิด, ต่อไม่ติดกลางทาง) ไว้ในคลาสเดียวกับ error รายเอกสาร ลองแล้ว 2026-09-30: ถือว่า
 * "ไม่มี error รายตัว = สำเร็จ" ทำให้ event ทั้งคิวหายเงียบระหว่างที่ mongo ถูก stop ขณะที่ตัวนับของ issue ยังครบ
 */
async function insertAll(
  db: Db,
  collection: string,
  docs: Array<{ _id: string }>,
  options: { auditCopies?: boolean } = {},
): Promise<void> {
  try {
    await db.collection<{ _id: string }>(collection).insertMany(docs, { ordered: false });
  } catch (err) {
    const writeErrors = perDocumentErrors(err);
    if (!writeErrors || writeErrors.length === 0) throw err;
    const notDuplicate = writeErrors.filter((e) => e.code !== 11000);
    if (notDuplicate.some((e) => !DOCUMENT_REJECTED.has(Number(e.code)))) throw err;
    if (notDuplicate.length > 0) {
      noteDropped(new Date(), notDuplicate.length, "rejected", options.auditCopies ? notDuplicate.length : 0);
      console.warn(`[capture] ${service}: Mongo ไม่รับเอกสาร ${notDuplicate.length} ตัวใน ${collection} — ทิ้งแล้ว`);
    }
  }
}

/** error รายเอกสารของ `MongoBulkWriteError` — null ถ้าไม่ใช่ error ชนิดนั้น (ใช้ร่วมกับ relay ใน workers/log-relay.ts) */
export function perDocumentErrors(err: unknown): Array<{ code?: unknown }> | null {
  if (!err || typeof err !== "object" || (err as { name?: unknown }).name !== "MongoBulkWriteError") return null;
  const writeErrors = (err as { writeErrors?: unknown }).writeErrors;
  if (Array.isArray(writeErrors)) return writeErrors as Array<{ code?: unknown }>;
  return writeErrors && typeof writeErrors === "object" ? [writeErrors as { code?: unknown }] : [];
}

/**
 * หนึ่ง issue = สอง operation: upsert ตัวนับ แล้วเปิด issue ที่ `resolved` กลับเป็น `open` (regression) ถ้า
 * การเกิดครั้งล่าสุดอยู่หลังเวลาที่ถูกปิด — `ignored` ยังนับต่อแต่ไม่เปิดกลับ · `create: false` (รายงานเบราว์เซอร์ที่เกินเพดาน)
 * ไม่ upsert: issue ที่มีอยู่แล้วนับต่อ ที่ไม่มีก็ไม่ถูกสร้าง
 */
function issueOperations(issues: IssueDelta[]): AnyBulkWriteOperation<IssueDoc>[] {
  const release = env.release;
  const operations: AnyBulkWriteOperation<IssueDoc>[] = [];
  for (const d of issues) {
    operations.push({
      updateOne: {
        filter: { _id: d.fingerprint },
        update: {
          $inc: { count: d.count },
          $min: { firstSeen: d.firstSeen },
          $max: { lastSeen: d.lastSeen },
          $set: {
            title: d.title,
            culprit: d.culprit,
            level: d.level,
            tag: d.tag,
            lastRelease: d.release ?? release,
            ...(d.lastEventId ? { lastEventId: d.lastEventId } : {}),
          },
          $setOnInsert: {
            service: d.service,
            firstRelease: d.release ?? release,
            status: "open",
            statusChangedAt: d.firstSeen,
            statusReason: null,
            regressedAt: null,
            alertedAt: null,
            alertCount: 0,
            ...(d.lastEventId ? {} : { lastEventId: null }),
          },
        },
        upsert: d.create,
      },
    });
    operations.push({
      updateOne: {
        filter: { _id: d.fingerprint, status: "resolved", statusChangedAt: { $lt: d.lastSeen } },
        update: {
          $set: {
            status: "open",
            regressedAt: d.lastSeen,
            statusChangedAt: d.lastSeen,
            statusReason: "เกิดซ้ำหลังปิด (regression)",
          },
        },
      },
    });
  }
  return operations;
}

/** ส่วนที่ยังไม่ได้เขียนกลับเข้าคิว — ก่อนของที่เข้ามาใหม่ระหว่างนั้น และยังอยู่ใต้เพดานเดิม (ล้นก็ทิ้งตามลำดับ) */
function requeue(items: RingItem[], issues: IssueDelta[]) {
  const newer = ring;
  ring = [];
  ringBytes = 0;
  for (const item of [...items, ...newer]) enqueue(item, true);

  for (const d of issues) {
    const current = pendingIssues.get(d.fingerprint);
    if (current) {
      current.count += d.count;
      if (d.firstSeen < current.firstSeen) current.firstSeen = d.firstSeen;
      current.lastEventId ??= d.lastEventId;
      if (d.create) current.create = true;
    } else if (roomForIssue(d.service, d.level)) {
      pendingIssues.set(d.fingerprint, d);
    } else {
      noteDropped(d.lastSeen, d.count, d.service === "browser" ? "browser_backlog" : "issue_backlog");
    }
  }
}

/**
 * event สรุปหนึ่งตัวว่าทิ้งไปเท่าไร ระหว่างเมื่อไรถึงเมื่อไร — วางหลังเขียนสำเร็จครั้งแรกหลังช่วงที่ทิ้ง
 * ไม่ผ่าน captureError: ต้องไม่ติดเพดานตัวไหน และต้องไม่ถูกนับเป็น "ทิ้ง" ซ้ำ
 */
function enqueueDroppedSummary() {
  const count = dropped.count;
  const first = dropped.first ?? new Date();
  const last = dropped.last ?? first;
  const reasons = { ...dropped.reasons };
  const auditCopies = dropped.auditCopies;
  dropped.count = 0;
  dropped.first = null;
  dropped.last = null;
  dropped.reasons = { queue_full: 0, too_large: 0, rejected: 0, issue_backlog: 0, browser_backlog: 0 };
  dropped.auditCopies = 0;

  const REASON_TEXT: Record<DropReason, (n: number) => string> = {
    queue_full: (n) =>
      `คิวในหน่วยความจำเต็ม ${n} รายการ (เพดาน ${RING_MAX_DOCS} รายการ / ${RING_MAX_BYTES / 1024 / 1024} MB: ` +
      "log store เขียนไม่ได้นาน หรือ error มาเร็วกว่าที่เขียนทัน)",
    too_large: (n) => `เอกสารใหญ่เกิน ${DOC_MAX_BYTES / 1024} KB ${n} รายการ`,
    rejected: (n) => `Mongo ไม่รับตัวเอกสาร ${n} รายการ`,
    issue_backlog: (n) => `issue ที่รอเขียนครบ ${PENDING_ISSUES_MAX} fingerprint ${n} ครั้ง (ไม่ได้เข้าตัวนับด้วย)`,
    browser_backlog: (n) =>
      `รายงานเบราว์เซอร์ ${n} ตัวที่ issue ของเบราว์เซอร์ที่รอเขียนครบ ${BROWSER_PENDING_ISSUES_MAX} fingerprint (ไม่ได้เข้าตัวนับด้วย)`,
  };
  const breakdown = (Object.keys(REASON_TEXT) as DropReason[])
    .filter((reason) => reasons[reason] > 0)
    .map((reason) => REASON_TEXT[reason](reasons[reason]))
    .join(" · ");
  const message =
    `ทิ้งไป ${count} รายการระหว่าง ${first.toISOString()} ถึง ${last.toISOString()} — ${breakdown}` +
    (auditCopies > 0 ? ` · ในนั้นเป็นสำเนา audit ที่ Postgres ไม่รับ ${auditCopies} รายการ` : "");
  const now = new Date();
  const fingerprint = `error-capture:dropped:${service}`;
  const doc: ErrorEventDoc = {
    _id: randomUUID(),
    occurredAt: now,
    fingerprint,
    level: "warning",
    handled: true,
    tag: "error-capture.dropped",
    service,
    environment: env.deployEnv,
    release: env.release,
    host: HOST,
    mechanism: "captured",
    error: { name: "ErrorCaptureDropped", message, stack: null, props: {}, causes: [] },
    request: null,
    actor: null,
    breadcrumbs: [],
    extra: { dropped: count, from: first, to: last, reasons, auditCopies },
    browser: null,
    ingest: null,
  };
  console.warn(`[capture] ${service} warning event=${doc._id} issue=${fingerprint} — ${message}`);
  if (!enqueue({ kind: "event", doc, bytes: sizeOf(doc), priority: PRIORITY.runtime })) return;
  const existing = pendingIssues.get(fingerprint);
  if (existing) {
    existing.count += 1;
    existing.lastSeen = now;
    existing.lastEventId = doc._id;
  } else {
    pendingIssues.set(fingerprint, {
      fingerprint,
      service,
      title: "ErrorCaptureDropped: ทิ้งสิ่งที่ควรเก็บไป (สาเหตุแยกอยู่ใน event)",
      culprit: service,
      level: "warning",
      tag: doc.tag,
      count: 1,
      firstSeen: now,
      lastSeen: now,
      lastEventId: doc._id,
      create: true,
    });
  }
}

/** ล้างหน้าต่างนับรายชั่วโมงที่หมดอายุแล้ว — ไม่งั้น fingerprint ที่เคยเห็นครั้งเดียวค้างอยู่ใน Map ตลอดไป */
function pruneWindows(now: number) {
  for (const [fingerprint, window] of perFingerprint) {
    if (now - window.windowStart >= 3_600_000) perFingerprint.delete(fingerprint);
  }
}

// --------------------------------------------------------------------------------------------- เวลา

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
