/**
 * รูปของเอกสาร `activity` ใน log store — แถว `audit.audit_event` หนึ่งแถว → เอกสารหนึ่งใบ (docs/21 §3, plan §3)
 *
 * ทุกทางที่เขียน `activity` ผ่านไฟล์นี้: relay ที่คัดลอกแถวที่ Postgres commit แล้ว (workers/log-relay.ts,
 * `source: "audit_event"`) และสำเนาของแถวที่ Postgres ไม่รับ (lib/audit-fallback.ts, `source: "audit_fallback"`)
 * ค้นด้วยตัวกรองเดียวกันได้เพราะมาจาก projection เดียวกัน กติกาที่อยู่ที่นี่ที่เดียว:
 *
 *   - **category** ของทุกรหัส (`CATEGORY_BY_ACTION`) — retention ผูกกับมัน (lib/log-retention.ts) รหัสใหม่ใน
 *     `AuditAction` ที่ไม่ได้ใส่ในตารางนี้ typecheck ไม่ผ่าน
 *   - **via** — มาทางไหน (session, admin token, สคริปต์, …) ดูจากแถวเอง ไม่ใช่จาก actor อย่างเดียว
 *   - **การปิดข้อมูล** — เลขบัตรทุกคีย์ที่ชื่อบอก (รวม `thaid_subject`) และเลข 13 หลักในข้อความทุกค่า
 *     (`maskForLogStore` ใน lib/redact.ts) อีเมลที่**พิมพ์มา**ตอนล็อกอินไม่ผ่าน · ค่าที่ Postgres ปิดมาแล้วผ่านไปตามเดิม
 *   - **hashKeys** — `cid#<hmac16>` ของทุกเลขบัตรที่สำเนาปิดเอง และ `email#<hmac16>` ของทุกอีเมลในแถว (`hashKeyOf`)
 *   - เอกสารไม่เกิน 64 KB — ตัดแบบกำหนดได้ (`fitDocument`) ไม่ทิ้งทั้งใบ
 *
 * Postgres ไม่ถูกแตะ: ทุกอย่างที่นี่ทำกับสำเนา แถวใน audit_event ยังเก็บสิ่งที่มันเก็บ (plan Q4)
 */
import { createHmac } from "node:crypto";

import { AuditAction, storedUserAgent, type AuditActionCode } from "./audit.js";
import { referenceOf } from "./context.js";
import { maskCidText, maskForLogStore, maskedTypedEmail, type MaskFindings } from "./redact.js";

/** เพิ่มเมื่อรูปของเอกสารเปลี่ยนจนของเดิมต้อง rebuild — relay เตือนเมื่อค่าที่บันทึกไว้ไม่ตรง */
export const SCHEMA_VERSION = 1;

export type ActivityCategory =
  | "auth"
  | "session"
  | "account"
  | "role"
  | "invitation"
  | "organization"
  | "request"
  | "document"
  | "review"
  | "config"
  | "log-access"
  | "admin-access"
  | "system"
  | "other";

/**
 * มาทางไหน — `SYSTEM` คือแถวที่ actor เป็นระบบแต่ไม่ได้มาจาก worker สคริปต์ หรือ admin token เช่น logout ที่ไม่มี actor
 * ใน context หรือคีย์ที่ถูกพลิกเป็น EXPIRED ตอนมีคนเปิดลิงก์ (docs/21 §3.4)
 */
export type ActivityVia = "SESSION" | "ADMIN_TOKEN" | "LOG_TOKEN" | "WORKER" | "SCRIPT" | "ANONYMOUS" | "SYSTEM";

export type ActivitySource = "audit_event" | "audit_fallback" | "http";

/**
 * category ของทุกรหัสใน `AuditAction` — `Record<AuditActionCode, …>` ทำให้รหัสใหม่ที่ไม่ได้ใส่ตรงนี้ typecheck ไม่ผ่าน
 * ไม่ใช่ตกไปเป็น `other` เงียบ ๆ แล้วถูกลบที่ 400 วันทั้งที่เป็นเรื่องของธุรกิจ
 *
 * ที่ตัดสินแล้ว (2026-09-30): วงจรของคีย์เปิดใช้งานทั้งหมดอยู่ `invitation` รวม USED/EXPIRED — ถ้าอยู่ `auth` จะถูกลบที่
 * 400 วันแล้ววงจรขาดเป็นสองท่อน · `REQUEST_ASSIGNED` เป็นการตรวจ (`review`) · token ที่ถูกปฏิเสธเป็น `admin-access`
 * คู่กับบันทึกการเรียก admin API (step 8) ไม่ใช่ `auth` ของผู้ใช้
 */
const CATEGORY_BY_ACTION: Record<AuditActionCode, ActivityCategory> = {
  LOGIN_SUCCEEDED: "auth",
  LOGIN_FAILED: "auth",
  LOGIN_OTP_ISSUED: "auth",
  PASSWORD_RESET_REQUESTED: "auth",
  PASSWORD_RESET_COMPLETED: "auth",
  IDENTITY_VERIFICATION_STARTED: "auth",
  IDENTITY_VERIFIED: "auth",
  IDENTITY_VERIFICATION_FAILED: "auth",

  SESSION_REVOKED: "session",

  USER_ACCOUNT_CREATED: "account",
  USER_ACCOUNT_ACTIVATED: "account",
  USER_ACCOUNT_UPDATED: "account",
  USER_ACCOUNT_SUSPENDED: "account",
  USER_ACCOUNT_REINSTATED: "account",
  USER_ACCOUNT_DEACTIVATED: "account",
  USER_ACCOUNT_REACTIVATED: "account",
  USER_IDENTITY_RELEASED: "account",

  ROLE_ASSIGNED: "role",
  ROLE_REVOKED: "role",

  ACTIVATION_KEY_ISSUED: "invitation",
  ACTIVATION_KEY_USED: "invitation",
  ACTIVATION_KEY_REVOKED: "invitation",
  ACTIVATION_KEY_EXPIRED: "invitation",
  INVITATION_DELETED: "invitation",
  APPROVER_INVITATION_RECALLED: "invitation",

  ORGANIZATION_CREATED: "organization",
  ORGANIZATION_UPDATED: "organization",
  ORGANIZATION_ACTIVATED: "organization",

  REQUEST_CREATED: "request",
  REQUEST_DRAFT_SAVED: "request",
  REQUEST_FORM_GENERATED: "request",
  // การตรวจคำขอหน่วยงานที่ผ่านด่านแรกก็เขียนรหัสนี้ (มี after.taskType) — categoryOf() ย้ายไป review
  REQUEST_SUBMITTED: "request",
  REQUEST_UPDATED: "request",
  REQUEST_RESET_TO_DRAFT: "request",
  REQUEST_CANCELLED: "request",
  REQUEST_DELETED: "request",

  REQUEST_ASSIGNED: "review",
  REQUEST_APPROVED: "review",
  REQUEST_RETURNED: "review",
  REQUEST_REJECTED: "review",
  SPECIALIST_COMMENT_RECORDED: "review",

  ATTACHMENT_UPLOADED: "document",
  ATTACHMENT_REPLACED: "document",
  ATTACHMENT_DELETED: "document",
  DOCUMENT_DOWNLOADED: "document",
  DOCUMENT_SIGNED: "document",
  DATA_EXPORTED: "document",

  LEGAL_DOCUMENT_PUBLISHED: "config",
  LEGAL_DOCUMENT_UPDATED: "config",
  DATASET_CHOICE_CHANGED: "config",

  ADMIN_TOKEN_REJECTED: "admin-access",
};

/** รหัสของขั้นถัดไปที่ยังไม่อยู่ใน `AuditAction` (step 7, 8) — ย้ายเข้าตารางข้างบนเมื่อรหัสนั้นเกิดจริง */
const CATEGORY_OF_LATER_ACTIONS: Record<string, ActivityCategory> = {
  AUDIT_LOG_READ: "log-access",
  ERROR_ISSUE_STATUS_CHANGED: "log-access",
  LOG_TOKEN_REJECTED: "admin-access",
  ADMIN_API_REQUEST: "admin-access",
};

/** รหัสที่อ่าน log ผ่าน LOG_READ_TOKEN (step 7) — via เป็น LOG_TOKEN */
const LOG_TOKEN_ACTIONS = new Set(["AUDIT_LOG_READ", "ERROR_ISSUE_STATUS_CHANGED"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function categoryOf(action: string, after: unknown): ActivityCategory {
  if (action === AuditAction.REQUEST_SUBMITTED && isPlainObject(after) && typeof after.taskType === "string") {
    return "review";
  }
  return (
    (CATEGORY_BY_ACTION as Record<string, ActivityCategory>)[action] ?? CATEGORY_OF_LATER_ACTIONS[action] ?? "other"
  );
}

/**
 * via ตามลำดับ ข้อแรกที่ตรงชนะ (docs/21 §3.4):
 *   1. สคริปต์ (`seed-demo`, `admin-script`) → SCRIPT
 *   2. worker หรือ job (`notification-worker`, `activation-expiry-job`) → WORKER
 *   3. การอ่าน log (`AUDIT_LOG_READ`, `ERROR_ISSUE_STATUS_CHANGED`) → LOG_TOKEN
 *   4. `admin-portal` หรือมี fingerprint ของ admin token → ADMIN_TOKEN — มาก่อน actor โดยตั้งใจ: แถวที่ helper เขียน
 *      ระหว่างคำสั่งของ admin มี actor เป็น USER (บัญชีเป้าหมาย) ถ้าดู actor ก่อนจะได้ SESSION ทั้งที่มาทาง admin token
 *   5. actor ANONYMOUS → ANONYMOUS
 *   6. actor USER → SESSION
 *   7. ที่เหลือ (SYSTEM ที่ไม่ได้มาจากข้างบน, EXTERNAL) → SYSTEM
 * แถวที่เขียนก่อนการ์ดนี้ (admin ก่อนมี `admin-portal` และ fingerprint, `LOGIN_FAILED` ที่เป็น SYSTEM) ได้ SYSTEM จากข้อ 7
 * — อ่าน via ของแถวก่อน deploy ของการ์ดด้วยความระวัง (docs/21 §6.2)
 */
export function viaOf(row: {
  action: string;
  actorType: string;
  sourceComponent: string;
  adminTokenFp: string | null;
}): ActivityVia {
  if (row.sourceComponent === "seed-demo" || row.sourceComponent === "admin-script") return "SCRIPT";
  if (row.sourceComponent === "notification-worker" || row.sourceComponent === "activation-expiry-job") return "WORKER";
  if (LOG_TOKEN_ACTIONS.has(row.action)) return "LOG_TOKEN";
  if (row.sourceComponent === "admin-portal" || row.adminTokenFp) return "ADMIN_TOKEN";
  if (row.actorType === "ANONYMOUS") return "ANONYMOUS";
  if (row.actorType === "USER") return "SESSION";
  return "SYSTEM";
}

// --------------------------------------------------------------------------------------------- key ค้นหา

/**
 * key ค้นหาของค่าหนึ่งค่า — `cid#` / `email#` + 16 ตัวแรกของ HMAC-SHA256 (กุญแจ LOG_HASH_KEY) ของค่าที่ normalise แล้ว
 *   - เลขบัตร: เหลือแค่ตัวเลข ต้องครบ 13 หลัก (ค่าที่ไม่ครบ เช่นร่างที่กรอกครึ่งทาง ไม่มีทางถูกค้นด้วย ?cid= อยู่แล้ว)
 *   - อีเมล: ตัดช่องว่างหัวท้าย ตัวพิมพ์เล็ก ต้องมี `@`
 * คืน null เมื่อไม่มีกุญแจหรือค่าไม่เข้ารูป — ใช้ตัวเดียวกันทั้งตอนเขียน (ที่นี่) และตอนค้น (API อ่าน log, step 7)
 * 16 ตัว (64 บิต) พอสำหรับ index ที่มีคนไม่กี่ล้าน และกุญแจลับทำให้ไล่ย้อนเลขบัตร 10¹³ ค่าไม่ได้ถ้าไม่มีกุญแจ
 */
export function hashKeyOf(kind: "cid" | "email", value: string, key: string): string | null {
  if (!key) return null;
  let normalised: string;
  if (kind === "cid") {
    normalised = value.replace(/\D/g, "");
    if (normalised.length !== 13) return null;
  } else {
    normalised = value.trim().toLowerCase();
    if (!normalised.includes("@") || normalised.length > 254) return null;
  }
  return `${kind}#${createHmac("sha256", key).update(normalised).digest("hex").slice(0, 16)}`;
}

/** key ที่ค่าเป็นอีเมล — `email`, `approverEmail`, `contact_email`, `e-mail` … */
const EMAIL_KEY = /e-?mail$/i;

/** อีเมลทุกตัวที่อยู่ใต้ key แบบ EMAIL_KEY ทุกชั้น — ค่าดิบก่อนปิด (อีเมลที่พิมพ์มาก็ได้ key ก่อนถูกปิด) */
function emailsIn(value: unknown, into: string[], depth = 0): void {
  if (depth > 8) return;
  if (Array.isArray(value)) {
    for (const item of value) emailsIn(item, into, depth + 1);
    return;
  }
  if (!isPlainObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (EMAIL_KEY.test(key) && typeof child === "string" && child.includes("@")) into.push(child);
    else emailsIn(child, into, depth + 1);
  }
}

// --------------------------------------------------------------------------------------------- เอกสาร

/** แถว audit_event ในรูปที่ projection ใช้ — relay อ่านจาก Postgres, audit-fallback ประกอบจาก input ที่ INSERT ไม่ผ่าน */
export interface AuditRowLike {
  id: string;
  occurredAt: Date;
  actorType: string;
  actorId: string | null;
  action: string;
  subjectType: string;
  subjectId: string | null;
  organizationId: string | null;
  result: string;
  before: unknown;
  after: unknown;
  ipAddress: string | null;
  userAgent: string | null;
  correlationId: string;
  sourceComponent: string;
  /** `metadata_json` ทั้งก้อน รวม `actor_*` ที่ logAudit เติม */
  metadata: unknown;
}

export interface ActivityDoc {
  _id: string;
  source: ActivitySource;
  schemaVersion: number;
  occurredAt: Date;
  action: string;
  category: ActivityCategory;
  result: string;
  actor: { type: string; id: string | null; name: string | null; roles: string[]; organizationId: string | null };
  via: ActivityVia;
  /** fingerprint ของ token ที่แถวนี้เกี่ยว — แถว admin หนึ่งตัว (`admin_token_fp`) แถวปฏิเสธทันทีหนึ่งตัว แถวสรุปทั้งรายการ */
  tokenFps: string[];
  subject: { type: string; id: string | null };
  organizationId: string | null;
  requestNumber: string | null;
  gate: string | null;
  before: unknown;
  after: unknown;
  changedFields: string[];
  reason: string | null;
  metadata: Record<string, unknown> | null;
  request: {
    correlationId: string;
    reference: string;
    ip: string | null;
    userAgent: string | null;
    method: string | null;
    route: string | null;
    status: number | null;
    durationMs: number | null;
  };
  sourceComponent: string;
  relatedUserIds: string[];
  hashKeys: string[];
  mirroredAt: Date;
  /** มีเฉพาะเมื่อ before/after/metadata ถูกตัดให้เอกสารไม่เกิน 64 KB */
  truncated?: true;
  [extra: string]: unknown;
}

export interface ProjectOptions {
  source: ActivitySource;
  /** LOG_HASH_KEY — ว่าง = ไม่มี key ค้นหา */
  hashKey: string;
  /** เลขที่คำขอของ subject (หรือของเจ้าของไฟล์แนบ) ที่ผู้เรียกค้นไว้แล้ว — ไม่มีก็ใช้ `metadata.request_number` */
  requestNumber?: string | null;
  now?: Date;
}

const UUID_EXACT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_FP = /^[0-9a-f]{12}$/;
const ACTOR_KEYS = ["actor_name", "actor_roles", "actor_organization_id"] as const;
/** ข้อความของ admin ที่ยกขึ้นมาเป็น `reason` ยาวไม่เกินนี้ — ตัวเต็ม (ปิดเลขบัตรแล้ว) ยังอยู่ใน metadata */
const REASON_MAX = 1_000;
export const DOC_MAX_BYTES = 64 * 1024;

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * คนที่แถวนี้เกี่ยวข้อง (index ของ `person=` ใน step 7) — ผู้กระทำ, บัญชีที่เป็น subject, และ id ของบัญชีที่แต่ละรหัส
 * วางไว้ใน metadata / before / after (ตาราง "คนอยู่ตรงไหน" ใน docs/21 §2.10) อ่านจากค่าดิบก่อนปิด
 * แถวที่มีแค่อีเมลของบัญชี (resend ของ ACTIVATION_KEY_ISSUED, INVITATION_DELETED, APPROVER_INVITATION_RECALLED ที่บัญชีถูก
 * ลบไปแล้ว) ไม่มี id ให้ใส่ — หาได้ด้วย `email#` ใน hashKeys แทน
 */
function relatedUserIdsOf(row: AuditRowLike): string[] {
  const ids = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value === "string" && UUID_EXACT.test(value)) ids.add(value.toLowerCase());
  };
  add(row.actorId);
  if (row.subjectType === "USER_ACCOUNT") add(row.subjectId);
  if (isPlainObject(row.metadata)) {
    add(row.metadata.user_account_id);
    add(row.metadata.revoked_user_account_id);
    add(row.metadata.transferred_user_account_id);
  }
  for (const side of [row.before, row.after]) {
    if (!isPlainObject(side)) continue;
    add(side.userAccountId);
    add(side.assignedSpecialistId);
  }
  return [...ids];
}

/** fingerprint ของ token ในแถว — แถว admin (`admin_token_fp`), แถวปฏิเสธทันที (`token_fp`), แถวสรุป (`token_fps`) */
function tokenFpsOf(metadata: unknown): string[] {
  if (!isPlainObject(metadata)) return [];
  const fps = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value === "string" && TOKEN_FP.test(value)) fps.add(value);
  };
  add(metadata.admin_token_fp);
  add(metadata.token_fp);
  if (Array.isArray(metadata.token_fps)) for (const fp of metadata.token_fps) add(fp);
  return [...fps];
}

/** ค่าที่ถูกปิดมาแล้วตั้งแต่ Postgres (`sanitizeDiff()`) — `changed: true` บอกว่าเปลี่ยน แม้ 4 ตัวท้ายจะบังเอิญตรงกัน */
function isMaskedChange(value: unknown): boolean {
  return isPlainObject(value) && "masked" in value && value.changed === true;
}

/**
 * ชื่อช่องที่เปลี่ยน
 *   - แถวที่บอกเองว่าอะไรเปลี่ยน (`REQUEST_DRAFT_SAVED`): `fields_changed` + `synced_from_account` + `normalised_by_route`
 *     — สามรายการรวมกันคือ key ของ before/after พอดี (ช่องที่ผู้กรอกแก้ · ที่ route เขียนจากบัญชี · ที่ route แปลงรูป)
 *   - แถวที่มีทั้ง before และ after: key ที่อยู่ทั้งสองข้างและค่าไม่เท่ากัน — แถวที่เก็บทั้ง state หรือคนละรูป
 *     (`USER_ACCOUNT_DEACTIVATED` `{status, email, cid}` → `{status}`) จึงได้แค่ `status` ไม่ใช่ทุก key
 *   - นอกนั้น (สร้าง ลบ แถวที่มีข้างเดียว) `[]`
 * เทียบค่าดิบก่อนปิด — หลังปิดแล้วเลขบัตรสองค่าที่ 4 ตัวท้ายตรงกันจะดูเหมือนไม่เปลี่ยน
 */
function changedFieldsOf(row: AuditRowLike): string[] {
  const meta = isPlainObject(row.metadata) ? row.metadata : null;
  if (meta && Array.isArray(meta.fields_changed)) {
    const listed = [meta.fields_changed, meta.synced_from_account, meta.normalised_by_route]
      .flatMap((list) => (Array.isArray(list) ? list : []))
      .filter((key): key is string => typeof key === "string");
    return [...new Set(listed)];
  }
  if (!isPlainObject(row.before) || !isPlainObject(row.after)) return [];
  const before = row.before;
  const after = row.after;
  return Object.keys(after).filter((key) => {
    if (!(key in before)) return false;
    if (isMaskedChange(before[key]) || isMaskedChange(after[key])) return true;
    return JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null);
  });
}

/**
 * แถวหนึ่งแถว → เอกสาร `activity` หนึ่งใบ — ไม่ throw บนข้อมูลแปลก ๆ (ค่าที่ไม่ใช่ชนิดที่คาดได้ null หรือ `[]`)
 *
 * ค่าดิบใช้หา relatedUserIds, tokenFps, changedFields และ hashKeys ก่อน แล้วจึงปิด ค่าดิบไม่ออกไปทางอื่น
 */
export function projectAuditRow(row: AuditRowLike, options: ProjectOptions): ActivityDoc {
  const now = options.now ?? new Date();
  const rawMeta = isPlainObject(row.metadata) ? row.metadata : null;
  const findings: MaskFindings = { cids: [] };
  const emails: string[] = [];
  emailsIn(row.before, emails);
  emailsIn(row.after, emails);
  emailsIn(rawMeta, emails);

  const before = row.before === null || row.before === undefined ? null : maskForLogStore(row.before, findings);
  const after = row.after === null || row.after === undefined ? null : maskForLogStore(row.after, findings);

  let metadata: Record<string, unknown> | null = null;
  if (rawMeta) {
    const rest: Record<string, unknown> = { ...rawMeta };
    for (const key of ACTOR_KEYS) delete rest[key];
    // อีเมลที่**พิมพ์มา**ตอนล็อกอินไม่ผ่านอาจไม่ใช่ของบัญชีไหน — ปิด (key ค้นหามาจากค่าดิบข้างบนแล้ว)
    // อีเมลของบัญชีในที่อื่น (PASSWORD_RESET_REQUESTED.metadata.email) เก็บตามเดิม
    if (row.action === AuditAction.LOGIN_FAILED && "email" in rest) rest.email = maskedTypedEmail(rest.email);
    const masked = maskForLogStore(rest, findings) as Record<string, unknown>;
    metadata = Object.keys(masked).length > 0 ? masked : null;
  }

  const hashKeys = new Set<string>();
  for (const cid of findings.cids) {
    const key = hashKeyOf("cid", cid, options.hashKey);
    if (key) hashKeys.add(key);
  }
  for (const email of emails) {
    const key = hashKeyOf("email", email, options.hashKey);
    if (key) hashKeys.add(key);
  }

  const adminTokenFp = rawMeta ? stringOrNull(rawMeta.admin_token_fp) : null;
  const reasonText = rawMeta ? stringOrNull(rawMeta.reason) : null;
  const roles = rawMeta && Array.isArray(rawMeta.actor_roles) ? rawMeta.actor_roles.filter((r) => typeof r === "string") : [];

  const doc: ActivityDoc = {
    _id: row.id,
    source: options.source,
    schemaVersion: SCHEMA_VERSION,
    occurredAt: row.occurredAt,
    action: row.action,
    category: categoryOf(row.action, row.after),
    result: row.result,
    actor: {
      type: row.actorType,
      id: row.actorId,
      name: rawMeta ? stringOrNull(rawMeta.actor_name) : null,
      roles: roles as string[],
      organizationId: rawMeta ? stringOrNull(rawMeta.actor_organization_id) : null,
    },
    via: viaOf({ action: row.action, actorType: row.actorType, sourceComponent: row.sourceComponent, adminTokenFp }),
    tokenFps: tokenFpsOf(rawMeta),
    subject: { type: row.subjectType, id: row.subjectId },
    organizationId: row.organizationId,
    requestNumber: options.requestNumber ?? (rawMeta ? stringOrNull(rawMeta.request_number) : null),
    gate: isPlainObject(row.after) ? stringOrNull(row.after.taskType) : null,
    before,
    after,
    changedFields: changedFieldsOf(row),
    // ค่านี้ปนรหัส (SESSION_REVOKED: LOGOUT, …) กับข้อความที่คนพิมพ์ — docs/21 §4.0 "ความหมายของ reason"
    reason: reasonText === null ? null : maskCidText(reasonText).slice(0, REASON_MAX),
    metadata,
    request: {
      correlationId: row.correlationId,
      reference: referenceOf(row.correlationId),
      ip: row.ipAddress,
      // แถวที่เขียนก่อน a0a0578 เก็บ user agent ดิบ — ผ่านกฎเดียวกับที่ logAudit ใช้ทุกวันนี้ (ทำซ้ำได้ ไม่เปลี่ยนค่าที่ผ่านแล้ว)
      userAgent: storedUserAgent(row.userAgent),
      method: null,
      route: null,
      status: null,
      durationMs: null,
    },
    sourceComponent: row.sourceComponent,
    relatedUserIds: relatedUserIdsOf(row),
    hashKeys: [...hashKeys],
    mirroredAt: now,
  };
  fitDocument(doc);
  return doc;
}

/** ความยาวของข้อความแต่ละค่าที่ลองตัดทีละขั้น — เอกสารที่เกิน 64 KB ส่วนใหญ่มาจากข้อความยาวตัวเดียว (บันทึก, ความเห็น) */
const TRUNCATE_STEPS = [2_048, 256, 32];

function sizeOf(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value));
}

function truncateStrings(value: unknown, max: number, depth = 0): unknown {
  if (typeof value === "string") return value.length > max ? `${value.slice(0, max)}…` : value;
  if (depth > 10) return value;
  if (Array.isArray(value)) return value.map((v) => truncateStrings(v, max, depth + 1));
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, truncateStrings(v, max, depth + 1)]));
  }
  return value;
}

/**
 * ให้เอกสารไม่เกิน 64 KB โดยไม่ทิ้งทั้งใบ — ตัดข้อความยาวใน before / after / metadata ทีละขั้น (2 KB, 256, 32 ตัว)
 * ยังเกินอีกก็เหลือ `{truncated: true, keys}` ของสามก้อนนั้น ส่วนอื่นของเอกสาร (ใคร อะไร เมื่อไร) อยู่ครบเสมอ
 *
 * ผลเหมือนเดิมทุกครั้งกับแถวเดิม: relay ที่ rebuild ได้เอกสารเดียวกัน `truncated: true` บอกว่าเกิดขึ้น
 * ตัวเต็มยังอยู่ใน Postgres
 */
export function fitDocument(doc: ActivityDoc): void {
  if (sizeOf(doc) <= DOC_MAX_BYTES) return;
  doc.truncated = true;
  for (const max of TRUNCATE_STEPS) {
    doc.before = truncateStrings(doc.before, max);
    doc.after = truncateStrings(doc.after, max);
    doc.metadata = truncateStrings(doc.metadata, max) as Record<string, unknown> | null;
    if (sizeOf(doc) <= DOC_MAX_BYTES) return;
  }
  const summary = (value: unknown) =>
    value === null || value === undefined
      ? null
      : { truncated: true, keys: isPlainObject(value) ? Object.keys(value).slice(0, 50) : [] };
  doc.before = summary(doc.before);
  doc.after = summary(doc.after);
  doc.metadata = summary(doc.metadata) as Record<string, unknown> | null;
  doc.changedFields = doc.changedFields.slice(0, 200);
}

/**
 * fingerprint ของ LOG_HASH_KEY ที่ใช้สร้างสำเนา — relay เก็บไว้ใน relay_state แล้วเตือนเมื่อกุญแจเปลี่ยน (key เดิมหาไม่เจอ
 * จนกว่าจะ rebuild) ไม่ใช่กุญแจ: HMAC ของข้อความคงที่ ย้อนกลับไม่ได้ `none` = ไม่ได้ตั้งกุญแจ
 */
export function hashKeyFingerprint(key: string): string {
  return key ? createHmac("sha256", key).update("bdi-log-hash-key-check").digest("hex").slice(0, 12) : "none";
}
