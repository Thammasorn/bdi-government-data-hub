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
 *   - route แบบแม่แบบ (`/api/admin/users/:id`) ถ้าถึง route — ส่วน mount เป็นตัวเล็กเสมอ (`wrap()` ใน lib/async-route.ts) ·
 *     path แบบรูปแบบ (`pathPattern()` — อีเมล → `:email` UUID → `:id` เลขยาว → `:n`) เสมอ ตัวพิมพ์ตามที่ผู้เรียกพิมพ์ คำขอที่
 *     token ไม่ผ่าน (401 ที่ guard) ไม่ถึง route จึงมีแค่ path
 *   - **ชื่อ**ของ query ทุกตัว (ผ่าน `requestTarget()` — ชื่อที่เป็นอีเมลในรูปใดก็ตามเหลือ `[email]`) ค่าเก็บเฉพาะห้าชื่อที่ไม่ใช่
 *     ข้อมูลบุคคล และเฉพาะเมื่อค่าเป็นค่าที่ API รับจริง (`QUERY_VALUE_SHAPES` — นอกนั้น `[other]`) — `cid` ได้แค่ key `cid#`
 *     และ `email` / `q` ที่เป็นอีเมลเต็มได้ key `email#` (`q` ที่เป็นเลขบัตร 13 หลักได้ `cid#`) ค่าจริงไม่ถูกเก็บ ค้นบางส่วนไม่ได้ key
 *   - subject จากแม่แบบของ route (`SUBJECT_BY_ROUTE`) กับ `:id` ที่ Express จับได้ (`routeId` ของบริบท — ถอด `%xx` แล้ว ไม่ใช่
 *     ท่อนของ path ดิบ) — `/users/:id` เข้า `relatedUserIds` ให้ `x-log-person` หาเจอว่าใครเปิดดู เดิมแกะ id จาก path ดิบและเทียบ
 *     route แบบสนตัวพิมพ์: `/API/Admin/Users/<id>`, `/api/admin/users/%65…` และ request target แบบเต็ม
 *     (`GET http://host/api/admin/users/<id>`) ได้อีเมลกับเลขบัตรไปครบแต่บันทึกไม่บอกว่าของใคร (ตรวจขั้น 8, 2026-10-01)
 *   - status, เวลาที่ใช้, IP และ user agent (กฎเดียวกับ `audit_event`), fingerprint ของ token ทั้งที่ผ่านและไม่ผ่าน
 *   - ไม่มี body ไม่มี header อื่น — การเปลี่ยนแปลงที่ body สั่งอยู่ใน `audit_event` แล้วพร้อม diff
 *
 * **ติดตั้งก่อนตัวอ่าน body** (index.ts): คำขอที่ body อ่านไม่ออก ใหญ่เกิน หรือ encoding ที่ไม่รู้จัก (400 `validation`, 413, 415
 * จาก `parseJsonBody`) ไม่ถึง router ของ admin เลย เดิมตัวนี้ติดตั้งหลังตัวอ่าน คำขอพวกนั้นจึงไม่มีบันทึกที่ไหนทั้งสิ้น ทั้งที่ plan
 * step 8 ว่าบันทึก "ทุก" การเรียก (ตรวจขั้น 8 แบบค้านรอบสอง, 2026-10-01) — ตอนนี้ได้บันทึกพร้อม `metadata.token_checked: false`
 * เพราะ `requireAdminToken` ไม่ได้ตรวจ token ของคำขอนั้น (`token_accepted: false` ของมันไม่ได้แปลว่า token ผิด) และไม่มีแถว
 * `ADMIN_TOKEN_REJECTED` ใน Postgres ด้วยเหตุเดียวกัน: ไม่มีใครตัดสิน token นั้น ไม่มีโค้ดของ admin วิ่งและไม่มีข้อมูลออกไป
 *
 * ไม่บันทึกคำขอที่ถึง router ของ log (`/api/admin/logs*`) — API อ่าน log บันทึกตัวเองเป็น `AUDIT_LOG_READ` อยู่แล้ว (สองบันทึก
 * ต่อการอ่านหนึ่งครั้งคือเสียงรบกวน) ตัดสินจาก**สิ่งที่ Express ทำจริง**: index.ts ติด `markLogApiRequest` ไว้ที่ mount เดียวกับ
 * router ของ log คำขอที่ถึงตรงนั้นถูกจำไว้ แล้วตอนคำตอบจบจึงข้าม เดิมเทียบ regex กับ `req.originalUrl` ซึ่งไม่ใช่ path ที่ Express
 * ใช้: request target แบบเต็ม (`GET http://host/api/admin/logs/activity`) หรือ `#` ต่อท้าย `/logs` ถึง router ของ log แต่ regex
 * ไม่ตรง การอ่าน log จึงได้ `ADMIN_API_REQUEST` แบบ `ANONYMOUS` ติดมาด้วย (ตรวจขั้น 8, 2026-10-01) ผลที่ตามมา:
 * `/API/Admin/LOGS/x` ถึง router ของ log (Express ไม่สนตัวพิมพ์) จึงไม่ถูกบันทึกที่นี่ · `/api/admin/%6Cogs` ไม่ถึง (Express
 * ไม่ถอด `%xx` ก่อนเทียบ mount path) จึงเป็นการเรียก admin · คำขอของ log API ที่ตัวอ่าน body ปฏิเสธก็ไม่ถึง router ของ log
 * จึงถูกบันทึกที่นี่แบบ `token_checked: false` — การอ่านไม่เกิดและไม่มี `AUDIT_LOG_READ` นี่คือร่องรอยเดียวของมัน
 *
 * เพดานต่อ process (`admit`): token ที่ผ่าน ไม่เกิน 600 ต่อนาที · ไม่ผ่านหรือไม่มี token ไม่เกิน 60 ต่อนาที — คนยิง 401 รัว ๆ
 * ต้องไม่เติมดิสก์ แถว `ADMIN_TOKEN_REJECTED` ใน Postgres (throttle ของ lib/token-rejection.ts) ยังนับทุกครั้ง ที่เกินนับไว้
 * แล้วบอกในบันทึกถัดไปที่ผ่านเพดาน (`metadata.suppressed_before`) และใน `GET /api/admin/logs/status`
 * เกินเพดานขนาด (`over_quota`) ไม่เก็บเลย (plan §3)
 */
import { randomUUID } from "node:crypto";

import { ActivationKeyStatus, OrganizationStatus, UserAccountStatus } from "@prisma/client";
import type { NextFunction, Request, Response } from "express";

import { env } from "../env.js";
import { SCHEMA_VERSION, fitDocument, hashKeyOf, type ActivityDoc } from "./activity-shape.js";
import { storedUserAgent } from "./audit.js";
import { tokenFingerprint } from "./auth.js";
import { currentContext, referenceOf, type RequestContext } from "./context.js";
import { enqueueAccessRecord } from "./error-capture.js";
import { maskCidText, requestTarget } from "./redact.js";
import { ROLE_CODES } from "./system.js";
import { pathPattern } from "./token-rejection.js";

/** รหัสของบันทึก — ไม่อยู่ใน `AuditAction` เพราะไม่เคยลง `audit_event` (category อยู่ใน lib/activity-shape.ts) */
export const ADMIN_API_REQUEST = "ADMIN_API_REQUEST";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * subject ของบันทึกตามแม่แบบของ route — `:id` ที่ Express จับได้และเป็น UUID คือ id ของ subject ที่เหลือ (รายการ, route ที่ไม่มี
 * id) เป็น `ADMIN_API` ไม่มี id ตัวแรกที่ตรงชนะ route มาจาก `wrap()` ซึ่งทำส่วน mount เป็นตัวเล็กแล้ว `/i` ที่นี่กันไว้อีกชั้น:
 * ตารางนี้ต้องไม่พลาดเพราะตัวพิมพ์ ไม่ว่าวันหนึ่งใครจะแก้ `wrap()` อย่างไร
 */
const SUBJECT_BY_ROUTE: Array<[RegExp, string]> = [
  [/^\/api\/admin\/users\/:id(?:\/|$)/i, "USER_ACCOUNT"],
  [/^\/api\/admin\/organizations\/:id(?:\/|$)/i, "ORGANIZATION"],
  [/^\/api\/admin\/invitations\/:id(?:\/|$)/i, "USER_ACTIVATION_KEY"],
  [/^\/api\/admin\/registrations\/organizations\/:id(?:\/|$)/i, "ORGANIZATION_REGISTRATION_REQUEST"],
  [/^\/api\/admin\/registrations\/datasets\/:id(?:\/|$)/i, "DATASET_REGISTRATION_REQUEST"],
  [/^\/api\/admin\/legal-documents(?:\/|$)/i, "LEGAL_DOCUMENT"],
  [/^\/api\/admin\/dataset-choices(?:\/|$)/i, "DATASET_CHOICE"],
];

/**
 * query ที่เก็บค่าได้ **เฉพาะเมื่อค่าอยู่ในรูปที่ admin API รับจริง** — สถานะ role หน่วยงาน การแบ่งหน้า ตัวอื่นเก็บแค่ชื่อ
 * ค่านอกรูปเก็บเป็น `QUERY_VALUE_OTHER` (มีค่าส่งมา แต่ไม่ใช่ค่าที่ API รู้จัก — API ตอบ 400 ไปแล้ว)
 *
 * เดิมเก็บทุกค่าของห้าชื่อนี้หลังกวาดอย่างเดียว ค่าคือข้อความที่ผู้เรียกพิมพ์เอง อีเมลที่เขียนด้วย `＠` หรือ `%2540` รอดกฎอีเมล:
 * `?status=v8.status%EF%BC%A0example.go.th` เก็บ `status: "v8.status＠example.go.th"` 400 วัน (ตรวจขั้น 8 แบบค้านรอบสอง,
 * 2026-10-01) ชุดค่าจึงมาจาก enum ตัวเดียวกับที่ route ตรวจ ไม่ใช่รูปแบบคร่าว ๆ: ข้อความตัวใหญ่ล้วนยังเป็นชื่อคนได้
 */
const QUERY_VALUE_SHAPES = new Map<string, (value: string) => boolean>([
  // `/users?status=` (UserAccountStatus) · `/invitations?status=` (ActivationKeyStatus) · `/organizations?status=`
  ["status", (value) => STATUS_VALUES.has(value)],
  ["role", (value) => ROLE_VALUES.has(value)],
  ["organizationId", (value) => UUID.test(value)],
  ["page", (value) => /^\d{1,6}$/.test(value)],
  ["pageSize", (value) => /^\d{1,6}$/.test(value)],
]);
const STATUS_VALUES = new Set<string>([
  ...Object.values(UserAccountStatus),
  ...Object.values(ActivationKeyStatus),
  ...Object.values(OrganizationStatus),
]);
const ROLE_VALUES = new Set<string>(Object.values(ROLE_CODES));
const QUERY_VALUE_OTHER = "[other]";

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

/** คำขอที่ถึง router ของ log — ดูหัวไฟล์ WeakSet: คำขอที่จบแล้วถูกเก็บกวาดเอง ไม่ต้องลบ */
const logApiRequests = new WeakSet<Request>();

/**
 * middleware — index.ts ติดไว้ที่ mount เดียวกับ router ของ log (`app.use(LOG_API_PATH, markLogApiRequest, adminLogRouter)`)
 * คำขอที่ Express ส่งมาถึงตรงนี้คือคำขอที่ router ของ log รับไป ไม่ว่าผู้เรียกจะเขียน path แบบไหน
 */
export function markLogApiRequest(req: Request, _res: Response, next: NextFunction): void {
  logApiRequests.add(req);
  next();
}

/**
 * middleware — ติดตั้งด้วย `app.use("/api/admin", recordAdminAccess)` หลัง `correlationMiddleware` ก่อนตัวอ่าน body และ router ของ
 * admin ทุกตัว (index.ts) ไม่ throw ไม่ await ไม่เปลี่ยนคำตอบ ยังไม่รู้ตอนนี้ว่าคำขอจะถึง router ของ log ไหม — ตัดสินตอนคำตอบจบ
 */
export function recordAdminAccess(req: Request, res: Response, next: NextFunction): void {
  const ctx = currentContext();
  if (!env.logStore.enabled || !ctx) {
    next();
    return;
  }
  const provided = req.header("x-admin-token");
  let recorded = false;
  const record = () => {
    if (recorded) return;
    recorded = true;
    if (logApiRequests.has(req)) return;
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
  // `requireAdminToken` ตัดสิน token นี้แล้วหรือยัง — ผ่าน (fingerprint อยู่ในบริบท) หรือไม่ผ่าน (401 มีที่มาทางเดียวใต้ /api/admin
  // คือ guard นั้น) ที่เหลือคือคำขอที่ตัวอ่าน body ปฏิเสธก่อนถึง router (หัวไฟล์ "ติดตั้งก่อนตัวอ่าน body") หรือที่ตัดสายระหว่างส่ง body
  const checked = accepted || status === 401;
  const target = requestTarget(req.originalUrl);
  const hashKey = env.logStore.hashKey;
  const hashKeys = new Set<string>();
  const query: Record<string, string> = {};
  for (const [name, raw] of Object.entries(req.query)) {
    const value = typeof raw === "string" ? raw.trim() : null;
    if (value === null) continue;
    // Map ไม่ใช่ object: ชื่อ query อย่าง `constructor` ต้องไม่ได้ฟังก์ชันของ Object.prototype มาเป็นตัวตรวจ
    const shape = QUERY_VALUE_SHAPES.get(name);
    if (shape) {
      query[name] = shape(value) ? value : QUERY_VALUE_OTHER;
      continue;
    }
    // ค่าที่ชี้ตัวคนได้ — เก็บเป็น key ค้นหาเท่านั้น ค่าที่ไม่ครบ (ค้นบางส่วน) ไม่ได้ key และไม่ถูกเก็บ
    const cidKey = name === "cid" || name === "q" ? hashKeyOf("cid", value, hashKey) : null;
    const emailKey = (name === "email" || name === "q") && EMAIL.test(value) ? hashKeyOf("email", value, hashKey) : null;
    if (cidKey && (name === "cid" || /^[\d\s-]+$/.test(value))) hashKeys.add(cidKey);
    if (emailKey) hashKeys.add(emailKey);
  }

  const subject = subjectOf(route, ctx.routeId);
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
      ...(checked ? {} : { token_checked: false }),
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
 * subject จากแม่แบบของ route กับ `:id` ที่ Express จับได้ (`RequestContext.routeId` — ถอด `%xx` แล้ว) id ที่ไม่ใช่ UUID
 * (404 ของ id ผิดรูป, `:code` ของเอกสาร) ไม่ถูกเก็บ UUID ตัวใหญ่เก็บเป็นตัวเล็ก ให้ตรงกับ id ในฐานข้อมูลและ `x-log-person`
 */
function subjectOf(route: string | null, routeId: string | null): { type: string; id: string | null } {
  if (!route) return { type: "ADMIN_API", id: null };
  const match = SUBJECT_BY_ROUTE.find(([pattern]) => pattern.test(route));
  if (!match) return { type: "ADMIN_API", id: null };
  return { type: match[1], id: routeId && UUID.test(routeId) ? routeId.toLowerCase() : null };
}
