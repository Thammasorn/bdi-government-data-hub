/**
 * แถว audit ที่ Postgres ไม่รับ — ไม่ให้หายเงียบอีกต่อไป
 *
 * `logAudit()` กลืน error ของตัวเองโดยตั้งใจ (การบันทึกต้องไม่ทำให้คำขอที่สำเร็จไปแล้วพัง) ผลคือแถวที่ INSERT ไม่ผ่าน
 * หายไปทั้งแถวโดยไม่มีใครรู้ นอกจากบรรทัดเดียวใน docker logs ที่ถูกลบทุกครั้งที่ deploy ตอนนี้ความล้มเหลวนั้นได้สองอย่าง
 * ลง log store (plan §3 "Postgres down", §5):
 *
 *   1. error event `audit.write-failed` พร้อม input ของแถวนั้นที่ปิดเลขบัตรแล้ว (`extra.audit`)
 *   2. เอกสารใน `activity` ที่ `source: "audit_fallback"` — รูปเดียวกับสำเนาของแถวที่ worker จะ mirror มา (step 6)
 *      ค้นเจอด้วยตัวกรองเดียวกัน และชี้กลับไปหา error event ด้วย `fallback.errorEventId`
 *
 * ทั้งสองเข้าคิวของ lib/error-capture.ts ซึ่ง**ไม่เรียก logAudit กลับ** — ความล้มเหลวหนึ่งครั้งจึงไม่มีทางวน
 * Postgres ที่เป็นระบบบันทึกหลักไม่ได้แถวนั้นคืน: ข้อมูลใน `activity` เป็นสำเนาที่ค้นได้ ไม่ใช่การเขียนซ้ำ
 */
import { randomUUID } from "node:crypto";

import type { AuditInput } from "./audit.js";
import { currentContext, referenceOf } from "./context.js";
import { captureError, enqueueActivity } from "./error-capture.js";
import { maskForLogStore, maskedTypedEmail } from "./redact.js";

/** เพดานของเอกสารใน log store (เหมือน error event) — diff ของแบบฟอร์มชุดข้อมูล 36 ช่องยังห่างจากนี้มาก */
const DOC_MAX_BYTES = 64 * 1024;

/**
 * หมวดของ action — **ชั่วคราว** จนกว่าตารางหมวดจริงของสำเนา audit (`lib/activity-shape.ts`, step 6) จะมา
 * ตอนนั้นให้ย้ายไปใช้ตารางนั้นแทน ค่าที่ออกจากที่นี่อยู่ในรายการหมวดของ plan §3 เสมอ
 */
const CATEGORY_RULES: Array<[RegExp, string]> = [
  [/^(LOGIN_|PASSWORD_RESET_|IDENTITY_VERIF|ADMIN_TOKEN_|LOG_TOKEN_)/, "auth"],
  [/^SESSION_/, "session"],
  [/^(USER_ACCOUNT_|USER_IDENTITY_|ACTIVATION_KEY_)/, "account"],
  [/^ROLE_/, "role"],
  [/^(INVITATION_|APPROVER_INVITATION_)/, "invitation"],
  [/^ORGANIZATION_/, "organization"],
  [/^REQUEST_(APPROVED|REJECTED|RETURNED)$|^SPECIALIST_COMMENT/, "review"],
  [/^REQUEST_/, "request"],
  [/^(ATTACHMENT_|DOCUMENT_|DATA_EXPORTED)/, "document"],
  [/^(LEGAL_DOCUMENT_|DATASET_CHOICE_)/, "config"],
  [/^AUDIT_LOG_READ$/, "log-access"],
];

function categoryOf(action: string): string {
  return CATEGORY_RULES.find(([pattern]) => pattern.test(action))?.[1] ?? "other";
}

/** แถวนี้มาทางไหน (plan §3 `via`) — จากบริบทของคำขอ ไม่ใช่จาก input */
function viaOf(actorId: string | null, actorType: string | undefined): string {
  const ctx = currentContext();
  if (ctx?.adminTokenFp) return "ADMIN_TOKEN";
  if (ctx?.sourceComponent === "notification-worker") return "WORKER";
  if (ctx?.sourceComponent === "seed-demo" || ctx?.sourceComponent === "admin-script") return "SCRIPT";
  if (actorType === "ANONYMOUS" || !actorId) return "ANONYMOUS";
  return "SESSION";
}

/** Date → ISO, Decimal ของ Prisma → ข้อความ — ให้ได้ค่าที่ Mongo เก็บแล้วอ่านกลับมาเหมือนที่ Postgres จะเก็บ */
function plain(value: unknown): unknown {
  if (value === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(value)) as unknown;
  } catch {
    return { unserialisable: true };
  }
}

/** `actor_type` ที่ logAudit จะเขียน — ค่าที่ผู้เรียกบอกมา ไม่งั้น USER ถ้ารู้ตัวผู้กระทำ ไม่งั้น SYSTEM */
function actorTypeOf(input: AuditInput, actorId: string | null): string {
  return input.actorType ?? (actorId ? "USER" : "SYSTEM");
}

function keysOf(value: unknown): string[] {
  return value && typeof value === "object" && !Array.isArray(value) ? Object.keys(value) : [];
}

/**
 * input ของแถว audit ในรูปที่ออกไปถึง log store ได้ — plan §7.6
 *
 * ผู้กระทำคือคนที่ `logAudit()` หามาได้ (`actorId`: input ก่อน แล้วค่อยบริบทของคำขอ) ไม่ใช่ `input.actorId` เฉย ๆ —
 * แถวที่มาจาก session ส่วนใหญ่ไม่ได้ส่ง actorId มา event กับเอกสาร activity ของความล้มเหลวเดียวกันเคยบอกผู้กระทำ
 * ไม่ตรงกัน (null กับ id จริง) ชนิดของผู้กระทำก็คิดแบบเดียวกับที่ logAudit จะเขียนลง Postgres
 */
function maskedInput(input: AuditInput, actorId: string | null): Record<string, unknown> {
  const metadata = (maskForLogStore(plain(input.metadata ?? null)) ?? null) as Record<string, unknown> | null;
  // อีเมลที่**พิมพ์เอง**ตอนล็อกอินไม่ผ่าน อาจไม่ใช่ของบัญชีไหนเลย — ปิดไว้ อีเมลของบัญชีในที่อื่นเก็บตามเดิม
  if (input.action === "LOGIN_FAILED" && metadata && "email" in metadata) {
    metadata.email = maskedTypedEmail(metadata.email);
  }
  return {
    action: input.action,
    subjectType: input.subjectType,
    subjectId: input.subjectId ?? null,
    organizationId: input.organizationId ?? null,
    actorId,
    actorType: actorTypeOf(input, actorId),
    result: input.result ?? "SUCCESS",
    before: maskForLogStore(plain(input.before)),
    after: maskForLogStore(plain(input.after)),
    metadata,
  };
}

/**
 * เรียกจาก catch ของ `logAudit()` เท่านั้น — ไม่ throw ไม่ await
 *
 * `known` คือสิ่งที่ logAudit หามาได้ก่อนล้ม (ผู้กระทำ และชื่อกับ role ของเขาถ้าอ่านจากฐานข้อมูลทัน — ถ้า Postgres
 * ล่มตั้งแต่ตอนอ่านผู้กระทำ ก็มีแค่ id) กับ user agent ในรูปที่ audit_event เก็บ
 */
export function reportAuditWriteFailure(
  err: unknown,
  input: AuditInput,
  known: { actorId: string | null; actorSnapshot?: Record<string, unknown>; userAgent: string | null },
): void {
  try {
    const masked = maskedInput(input, known.actorId);
    const eventId = captureError(err, { tag: "audit.write-failed", extra: { audit: masked } });

    const ctx = currentContext();
    const now = new Date();
    const metadata = { ...((masked.metadata as Record<string, unknown> | null) ?? {}) };
    const after = masked.after as Record<string, unknown> | null;
    const snapshot = known.actorSnapshot ?? {};
    const doc: Record<string, unknown> & { _id: string } = {
      _id: randomUUID(),
      source: "audit_fallback",
      schemaVersion: 1,
      occurredAt: now,
      action: input.action,
      category: categoryOf(input.action),
      result: masked.result,
      actor: {
        type: actorTypeOf(input, known.actorId),
        id: known.actorId,
        name: typeof snapshot.actor_name === "string" ? snapshot.actor_name : null,
        roles: Array.isArray(snapshot.actor_roles) ? snapshot.actor_roles : [],
        organizationId: typeof snapshot.actor_organization_id === "string" ? snapshot.actor_organization_id : null,
      },
      via: viaOf(known.actorId, input.actorType),
      tokenFp: ctx?.adminTokenFp ?? null,
      subject: { type: input.subjectType, id: input.subjectId ?? null },
      organizationId: input.organizationId ?? null,
      requestNumber: typeof metadata.request_number === "string" ? metadata.request_number : null,
      gate: after && typeof after.taskType === "string" ? after.taskType : null,
      before: masked.before ?? null,
      after: masked.after ?? null,
      changedFields: [...new Set([...keysOf(masked.before), ...keysOf(masked.after)])],
      reason: typeof metadata.reason === "string" ? metadata.reason : null,
      metadata: Object.keys(metadata).length > 0 ? metadata : null,
      request: {
        correlationId: ctx?.correlationId ?? null,
        reference: ctx ? referenceOf(ctx.correlationId) : null,
        ip: ctx?.ipAddress ?? null,
        // ผ่าน `storedUserAgent()` มาแล้ว — ค่าเดียวกับที่ Postgres จะได้
        userAgent: known.userAgent,
        method: ctx?.method ?? null,
        route: ctx?.route ?? null,
        status: null,
        durationMs: null,
      },
      sourceComponent: ctx?.sourceComponent ?? "request-service",
      relatedUserIds: [],
      // key ค้นหา `cid#…` / `email#…` ต้องใช้ LOG_HASH_KEY ซึ่งมากับงานสำเนา audit (step 6)
      hashKeys: [],
      mirroredAt: now,
      fallback: { errorEventId: eventId },
    };

    if (Buffer.byteLength(JSON.stringify(doc)) > DOC_MAX_BYTES) {
      doc.before = { truncated: true };
      doc.after = { truncated: true };
    }
    if (Buffer.byteLength(JSON.stringify(doc)) > DOC_MAX_BYTES) doc.metadata = { truncated: true };
    enqueueActivity(doc);
  } catch {
    // ทางสำรองของทางสำรอง — ไม่มีอะไรเหลือให้ทำ captureError พิมพ์บรรทัดไปแล้วถ้าไปถึง
  }
}
