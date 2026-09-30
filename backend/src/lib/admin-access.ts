/**
 * บันทึกการเรียก `/api/admin*` ทุกครั้ง รวมการอ่าน — `ADMIN_API_REQUEST` ใน `activity` (`source: "http"`, plan step 8)
 *
 * ทำไมต้องมี: admin API ตอบเลขบัตรและอีเมลแบบไม่ปิดของทุกบัญชี (`GET /api/admin/users?cid=…`, `/invitations`) และ admin token
 * เคยหลุดมาแล้ว — `audit_event` บันทึกแค่การเปลี่ยนแปลง การเปิดดูไม่มีร่องรอยเลย ตัวนี้ตอบ "ใครค้นเลขบัตรนี้ผ่าน admin API"
 * และ "token ใบนี้ถูกใช้ทำอะไรบ้าง" ได้ (Postman G8: `tokenFp=`) เก็บใน Mongo อย่างเดียว ไม่ผ่าน `logAudit()` และไม่แตะ Postgres
 *
 * **ไม่มีคำขอไหนรอ Mongo:** ตัวนี้แค่ผูก listener ตอนคำขอเข้า แล้วสร้างเอกสารตอนคำตอบจบ (`finish`/`close`) วางลงคิวของ
 * lib/error-capture.ts (ชั้นที่ 1 — ทิ้งก่อนทุกอย่างของ server เอง) ซึ่งเขียนทุก 2 วินาที Mongo ล่ม admin API ก็ตอบตามปกติ
 *
 * ต้องจับ store ของ AsyncLocalStorage ไว้ตอนผูก listener (`currentContext()` ตอนเข้า) — event `finish` ของ socket วิ่งนอก
 * บริบทของคำขอ (กับดักเดียวกับ multer ใน CLAUDE.md) วัตถุเดียวกันนั้นถูกเติมระหว่างทาง: `requireAdminToken` ใส่ fingerprint
 * ของ token และ `admin-portal`, `wrap()` ใส่ route แบบแม่แบบ ตอนคำตอบจบจึงอ่านได้ครบ
 *
 * เก็บอะไร (plan §7 — ผ่าน lib/redact.ts ทั้งหมด):
 *   - route แบบแม่แบบ (`/api/admin/users/:id`) ถ้าถึง route · path แบบรูปแบบ (`pathPattern()` — UUID → `:id` เลขยาว → `:n`)
 *     เสมอ คำขอที่ token ไม่ผ่าน (401 ที่ guard) ไม่ถึง route จึงมีแค่ path
 *   - **ชื่อ**ของ query ทุกตัว ค่าเฉพาะที่ไม่ใช่ข้อมูลบุคคล (`QUERY_VALUES_KEPT`) — `cid` ได้แค่ key `cid#` และ `email` / `q`
 *     ที่เป็นอีเมลเต็มได้ key `email#` (`q` ที่เป็นเลขบัตร 13 หลักได้ `cid#`) ค่าจริงไม่ถูกเก็บ ค้นบางส่วนไม่ได้ key
 *   - subject จากแม่แบบของ route (`SUBJECT_BY_ROUTE`) — `/users/:id` เข้า `relatedUserIds` ให้ `x-log-person` หาเจอว่าใครเปิดดู
 *   - status, เวลาที่ใช้, IP และ user agent (กฎเดียวกับ `audit_event`), fingerprint ของ token ทั้งที่ผ่านและไม่ผ่าน
 *   - ไม่มี body ไม่มี header อื่น — การเปลี่ยนแปลงที่ body สั่งอยู่ใน `audit_event` แล้วพร้อม diff
 *
 * ไม่บันทึก `/api/admin/logs*` — API อ่าน log บันทึกตัวเองเป็น `AUDIT_LOG_READ` อยู่แล้ว (สองบันทึกต่อการอ่านหนึ่งครั้งคือเสียงรบกวน)
 * เทียบกับ path ดิบแบบไม่สนตัวพิมพ์ แบบเดียวกับที่ Express ส่งคำขอไปหา router ของ log: `/API/Admin/LOGS/x` ถึง router ของ log
 * จึงไม่ถูกบันทึกที่นี่ ส่วน `/api/admin/%6Cogs` ไม่ถึง (Express ไม่ถอด `%xx` ก่อนเทียบ mount path) จึงถูกบันทึกเป็นการเรียก admin
 *
 * เพดานต่อ process (`admit`): token ที่ผ่าน ไม่เกิน 600 ต่อนาที · ไม่ผ่านหรือไม่มี token ไม่เกิน 60 ต่อนาที — คนยิง 401 รัว ๆ
 * ต้องไม่เติมดิสก์ แถว `ADMIN_TOKEN_REJECTED` ใน Postgres (throttle ของ lib/token-rejection.ts) ยังนับทุกครั้ง ที่เกินนับไว้
 * แล้วบอกในบันทึกถัดไปที่ผ่านเพดาน (`metadata.suppressed_before`) และใน `GET /api/admin/logs/status`
 * เกินเพดานขนาด (`over_quota`) ไม่เก็บเลย (plan §3)
 */
import { randomUUID } from "node:crypto";

import type { NextFunction, Request, Response } from "express";

import { env } from "../env.js";
import { SCHEMA_VERSION, fitDocument, hashKeyOf, type ActivityDoc } from "./activity-shape.js";
import { storedUserAgent } from "./audit.js";
import { tokenFingerprint } from "./auth.js";
import { currentContext, referenceOf, type RequestContext } from "./context.js";
import { enqueueAccessRecord } from "./error-capture.js";
import { maskCidText, requestTarget, scrubClipped } from "./redact.js";
import { pathPattern } from "./token-rejection.js";

/** รหัสของบันทึก — ไม่อยู่ใน `AuditAction` เพราะไม่เคยลง `audit_event` (category อยู่ใน lib/activity-shape.ts) */
export const ADMIN_API_REQUEST = "ADMIN_API_REQUEST";

const LOG_API = /^\/api\/admin\/logs(?:\/|\?|$)/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * subject ของบันทึกตามแม่แบบของ route — `:id` ที่เป็น UUID ใน path คือ id ของ subject ที่เหลือ (รายการ, route ที่ไม่มี id)
 * เป็น `ADMIN_API` ไม่มี id ตัวแรกที่ตรงชนะ
 */
const SUBJECT_BY_ROUTE: Array<[RegExp, string]> = [
  [/^\/api\/admin\/users\/:id(?:\/|$)/, "USER_ACCOUNT"],
  [/^\/api\/admin\/organizations\/:id(?:\/|$)/, "ORGANIZATION"],
  [/^\/api\/admin\/invitations\/:id(?:\/|$)/, "USER_ACTIVATION_KEY"],
  [/^\/api\/admin\/registrations\/organizations\/:id(?:\/|$)/, "ORGANIZATION_REGISTRATION_REQUEST"],
  [/^\/api\/admin\/registrations\/datasets\/:id(?:\/|$)/, "DATASET_REGISTRATION_REQUEST"],
  [/^\/api\/admin\/legal-documents(?:\/|$)/, "LEGAL_DOCUMENT"],
  [/^\/api\/admin\/dataset-choices(?:\/|$)/, "DATASET_CHOICE"],
];

/** query ที่เก็บค่าได้ — ไม่ใช่ข้อมูลบุคคล (สถานะ role หน่วยงาน การแบ่งหน้า) ตัวอื่นเก็บแค่ชื่อ */
const QUERY_VALUES_KEPT = new Set(["status", "role", "organizationId", "page", "pageSize"]);

const PER_MINUTE_ACCEPTED = 600;
const PER_MINUTE_REJECTED = 60;

let window = { start: 0, accepted: 0, rejected: 0 };
/** เกินเพดานไปกี่ครั้งตั้งแต่บันทึกล่าสุดที่ผ่าน — บอกในบันทึกถัดไป */
let suppressedSinceLast = 0;
const stats = { recorded: 0, suppressed: 0, notQueued: 0 };

/** ตัวเลขของ process นี้ — `GET /api/admin/logs/status` แสดง (ไม่มีข้อมูลบุคคล) */
export function adminAccessStats(): { recorded: number; suppressed: number; notQueued: number } {
  return { ...stats };
}

/**
 * middleware — ติดตั้งด้วย `app.use("/api/admin", recordAdminAccess)` ก่อน router ของ admin ทุกตัว (index.ts) ไม่ throw
 * ไม่ await ไม่เปลี่ยนคำตอบ
 */
export function recordAdminAccess(req: Request, res: Response, next: NextFunction): void {
  const ctx = currentContext();
  if (!env.logStore.enabled || !ctx || LOG_API.test(req.originalUrl)) {
    next();
    return;
  }
  const provided = req.header("x-admin-token");
  let recorded = false;
  const record = () => {
    if (recorded) return;
    recorded = true;
    try {
      write(req, res, ctx, provided);
    } catch {
      // บันทึกการเข้าถึงหายได้ ห้ามทำให้คำตอบสะดุด — คำตอบออกไปแล้วด้วยซ้ำ
    }
  };
  res.once("finish", record);
  // ผู้เรียกตัดสายก่อนคำตอบจบ — ไม่มี finish มีแต่ close (หลัง finish ก็มี close ตามมา ซึ่ง `recorded` กันไว้)
  res.once("close", record);
  next();
}

/** นับเข้าเพดานของนาทีนี้ — false ถ้าเกิน */
function admit(accepted: boolean, now: number): boolean {
  if (now - window.start >= 60_000) window = { start: now, accepted: 0, rejected: 0 };
  if (accepted) {
    if (window.accepted >= PER_MINUTE_ACCEPTED) return false;
    window.accepted += 1;
  } else {
    if (window.rejected >= PER_MINUTE_REJECTED) return false;
    window.rejected += 1;
  }
  return true;
}

function write(req: Request, res: Response, ctx: RequestContext, provided: string | undefined): void {
  const now = new Date();
  const accepted = ctx.adminTokenFp !== null;
  if (!admit(accepted, now.getTime())) {
    suppressedSinceLast += 1;
    stats.suppressed += 1;
    return;
  }

  const finished = res.writableFinished;
  const status = finished ? res.statusCode : null;
  const route = ctx.route;
  const target = requestTarget(req.originalUrl);
  const hashKey = env.logStore.hashKey;
  const hashKeys = new Set<string>();
  const query: Record<string, string> = {};
  for (const [name, raw] of Object.entries(req.query)) {
    const value = typeof raw === "string" ? raw.trim() : null;
    if (value === null) continue;
    if (QUERY_VALUES_KEPT.has(name)) {
      query[name] = scrubClipped(value, 64);
      continue;
    }
    // ค่าที่ชี้ตัวคนได้ — เก็บเป็น key ค้นหาเท่านั้น ค่าที่ไม่ครบ (ค้นบางส่วน) ไม่ได้ key และไม่ถูกเก็บ
    const cidKey = name === "cid" || name === "q" ? hashKeyOf("cid", value, hashKey) : null;
    const emailKey = (name === "email" || name === "q") && EMAIL.test(value) ? hashKeyOf("email", value, hashKey) : null;
    if (cidKey && (name === "cid" || /^[\d\s-]+$/.test(value))) hashKeys.add(cidKey);
    if (emailKey) hashKeys.add(emailKey);
  }

  const subject = subjectOf(route, req.originalUrl);
  const tokenFp = ctx.adminTokenFp ?? (provided ? tokenFingerprint(provided) : null);
  const organizationId =
    subject.type === "ORGANIZATION" && subject.id
      ? subject.id
      : typeof query.organizationId === "string" && UUID.test(query.organizationId)
        ? query.organizationId.toLowerCase()
        : null;
  const suppressed = suppressedSinceLast;
  suppressedSinceLast = 0;

  const doc: ActivityDoc = {
    _id: randomUUID(),
    source: "http",
    schemaVersion: SCHEMA_VERSION,
    occurredAt: new Date(ctx.startedAt),
    action: ADMIN_API_REQUEST,
    category: "admin-access",
    result: status !== null && status < 400 ? "SUCCESS" : "FAILURE",
    // admin token ไม่ผูกกับคน (CLAUDE.md, Auth) — ผู้กระทำคือ "ระบบ" แบบเดียวกับแถว audit ของเส้นทางนี้
    actor: { type: accepted ? "SYSTEM" : "ANONYMOUS", id: null, name: null, roles: [], organizationId: null },
    via: accepted ? "ADMIN_TOKEN" : "ANONYMOUS",
    tokenFps: tokenFp ? [tokenFp] : [],
    subject,
    organizationId,
    requestNumber: null,
    gate: null,
    before: null,
    after: null,
    changedFields: [],
    reason: null,
    metadata: {
      path: pathPattern(req),
      queryKeys: target.queryKeys,
      ...(Object.keys(query).length > 0 ? { query } : {}),
      token_present: Boolean(provided),
      token_accepted: accepted,
      ...(finished ? {} : { aborted: true }),
      ...(suppressed > 0 ? { suppressed_before: suppressed } : {}),
    },
    request: {
      correlationId: ctx.correlationId,
      reference: referenceOf(ctx.correlationId),
      ip: ctx.ipAddress,
      userAgent: ctx.userAgent ? maskCidText(storedUserAgent(ctx.userAgent) ?? "") : null,
      method: req.method,
      route,
      status,
      durationMs: now.getTime() - ctx.startedAt,
    },
    sourceComponent: ctx.sourceComponent,
    relatedUserIds: subject.type === "USER_ACCOUNT" && subject.id ? [subject.id] : [],
    hashKeys: [...hashKeys],
    mirroredAt: now,
  };
  fitDocument(doc);
  if (enqueueAccessRecord(doc)) stats.recorded += 1;
  else stats.notQueued += 1;
}

/**
 * subject จากแม่แบบของ route กับ path จริง — ตำแหน่งของ `:id` ในแม่แบบคือตำแหน่งของ id ใน path (Express จับคู่มาแล้ว)
 * id ที่ไม่ใช่ UUID (404 ของ id ผิดรูป) ไม่ถูกเก็บ
 */
function subjectOf(route: string | null, originalUrl: string): { type: string; id: string | null } {
  if (!route) return { type: "ADMIN_API", id: null };
  const match = SUBJECT_BY_ROUTE.find(([pattern]) => pattern.test(route));
  if (!match) return { type: "ADMIN_API", id: null };
  const index = route.split("/").indexOf(":id");
  const segment = index === -1 ? undefined : (originalUrl.split("?")[0] ?? "").split("/")[index];
  return { type: match[1], id: segment && UUID.test(segment) ? segment.toLowerCase() : null };
}
