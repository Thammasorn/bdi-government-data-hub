/**
 * แถว audit ที่ Postgres ไม่รับ — ไม่ให้หายเงียบอีกต่อไป
 *
 * `logAudit()` กลืน error ของตัวเองโดยตั้งใจ (การบันทึกต้องไม่ทำให้คำขอที่สำเร็จไปแล้วพัง) ผลคือแถวที่ INSERT ไม่ผ่าน
 * หายไปทั้งแถวโดยไม่มีใครรู้ นอกจากบรรทัดเดียวใน docker logs ที่ถูกลบทุกครั้งที่ deploy ตอนนี้ความล้มเหลวนั้นได้สองอย่าง
 * ลง log store (plan §3 "Postgres down", §5):
 *
 *   1. error event `audit.write-failed` พร้อม input ของแถวนั้นที่ปิดเลขบัตรแล้ว (`extra.audit`)
 *   2. เอกสารใน `activity` ที่ `source: "audit_fallback"` — รูปเดียวกับสำเนาของแถวที่ relay ของ worker คัดลอกมา
 *      ค้นเจอด้วยตัวกรองเดียวกัน และชี้กลับไปหา error event ด้วย `fallback.errorEventId`
 *
 * ทั้งสองเข้าคิวของ lib/error-capture.ts ซึ่ง**ไม่เรียก logAudit กลับ** — ความล้มเหลวหนึ่งครั้งจึงไม่มีทางวน
 * Postgres ที่เป็นระบบบันทึกหลักไม่ได้แถวนั้นคืน: ข้อมูลใน `activity` เป็นสำเนาที่ค้นได้ ไม่ใช่การเขียนซ้ำ
 *
 * ข้อยกเว้นหนึ่งเดียว: บันทึกการอ่าน log (`AUDIT_LOG_READ`, `recordLogReadFallback()`) เขียนตรงและรอผลแทนการเข้าคิว
 * เพราะคำขออ่านต้องไม่ได้ข้อมูลถ้าการอ่านไม่ถูกบันทึก
 */
import { randomUUID } from "node:crypto";

import { env } from "../env.js";
import { fitDocument, projectAuditRow, type ActivityDoc } from "./activity-shape.js";
import type { AuditInput } from "./audit.js";
import { correlationId, currentContext } from "./context.js";
import { captureError, enqueueActivity } from "./error-capture.js";
import { logDb } from "./log-store.js";
import { maskForErrorCopy, maskedTypedEmail } from "./redact.js";

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

/**
 * input ของแถว audit ในรูปที่ออกไปถึง log store ได้ (`extra.audit` ของ error event) — plan §7.6
 *
 * ปิดเลขบัตรด้วย `maskForErrorCopy` (กฎตัวกว้างของข้อความ error ทุกค่า) ไม่ใช่ `maskForLogStore` ของสำเนากิจกรรม ซึ่ง
 * ต่างกันแค่ชื่อไฟล์: สำเนากิจกรรมใช้กฎตัวแคบกับชื่อไฟล์ให้วันที่กับเลขลำดับรอด สำเนาใน error ปิดเกินได้ เอกสาร activity
 * ของความล้มเหลวเดียวกัน (ข้างล่าง) ยังผ่าน `projectAuditRow()` ตัวเดียวกับ relay — กฎเดียวกับสำเนาของแถวที่ Postgres รับ
 *
 * ผู้กระทำคือคนที่ `logAudit()` หามาได้ (`actorId`: input ก่อน แล้วค่อยบริบทของคำขอ) ไม่ใช่ `input.actorId` เฉย ๆ —
 * แถวที่มาจาก session ส่วนใหญ่ไม่ได้ส่ง actorId มา event กับเอกสาร activity ของความล้มเหลวเดียวกันเคยบอกผู้กระทำ
 * ไม่ตรงกัน (null กับ id จริง) ชนิดของผู้กระทำก็คิดแบบเดียวกับที่ logAudit จะเขียนลง Postgres
 */
function maskedInput(input: AuditInput, actorId: string | null): Record<string, unknown> {
  const metadata = (maskForErrorCopy(plain(input.metadata ?? null)) ?? null) as Record<string, unknown> | null;
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
    before: maskForErrorCopy(plain(input.before)),
    after: maskForErrorCopy(plain(input.after)),
    metadata,
  };
}

/**
 * เรียกจาก catch ของ `logAudit()` เท่านั้น — ไม่ throw ไม่ await
 *
 * `known` คือสิ่งที่ logAudit หามาได้ก่อนล้ม (ผู้กระทำ และชื่อกับ role ของเขาถ้าอ่านจากฐานข้อมูลทัน — ถ้า Postgres
 * ล่มตั้งแต่ตอนอ่านผู้กระทำ ก็มีแค่ id) กับ user agent ในรูปที่ audit_event เก็บ
 *
 * เอกสาร activity ประกอบเป็นแถวแบบที่ logAudit จะเขียน (metadata = snapshot ของผู้กระทำ + ของผู้เรียก + `ip_unparsed`
 * + `admin_token_fp` ลำดับเดียวกับ logAudit) แล้วผ่าน `projectAuditRow()` ตัวเดียวกับ relay — category, via, การปิด
 * ข้อมูล hashKeys และเพดาน 64 KB จึงใช้กฎเดียวกับสำเนาของแถวที่ Postgres รับ ที่ต่างคือ:
 *   - `source: "audit_fallback"` และ `_id` ใหม่ (แถวนี้ไม่มี id ใน Postgres)
 *   - `occurredAt` = เวลาที่ INSERT ล้ม ไม่ใช่เวลาที่ logAudit เริ่ม
 *   - `request.method` / `request.route` ของคำขอ (relay ได้ null เพราะ audit_event ไม่มีสองคอลัมน์นี้)
 *   - `fallback.errorEventId`
 *   - `requestNumber` มาจาก `metadata.request_number` เท่านั้น — relay ค้นเลขที่คำขอจากตารางคำขอด้วย (subject ที่เป็นคำขอ
 *     หรือไฟล์แนบของคำขอ) แต่ทางนี้วิ่งบนเส้นทางของคำขอหลัง Postgres เพิ่งปฏิเสธการเขียน จึงไม่ถามฐานข้อมูลอีก แถวที่ไม่ได้
 *     ใส่ `request_number` ไว้ใน metadata (การอัปโหลดไฟล์ การดาวน์โหลด …) จึงได้ `requestNumber: null` ขณะที่สำเนาของ relay มี
 */
export function reportAuditWriteFailure(
  err: unknown,
  input: AuditInput,
  known: { actorId: string | null; actorSnapshot?: Record<string, unknown>; userAgent: string | null },
): void {
  try {
    const eventId = captureError(err, { tag: "audit.write-failed", extra: { audit: maskedInput(input, known.actorId) } });
    enqueueActivity(fallbackDocument(input, known, eventId));
  } catch {
    // ทางสำรองของทางสำรอง — ไม่มีอะไรเหลือให้ทำ captureError พิมพ์บรรทัดไปแล้วถ้าไปถึง
  }
}

/**
 * เอกสาร `activity` ของแถวที่ Postgres ไม่รับ — ประกอบเป็นแถวแบบที่ logAudit จะเขียน (metadata = snapshot ของผู้กระทำ
 * + ของผู้เรียก + `ip_unparsed` + `admin_token_fp` + `admin_via` ลำดับเดียวกับ `auditMetadata()` ใน lib/audit.ts) แล้วผ่าน
 * `projectAuditRow()` ตัวเดียวกับ relay ส่วนที่ต่างจากสำเนาของ relay อธิบายไว้ที่ `reportAuditWriteFailure()`
 */
function fallbackDocument(
  input: AuditInput,
  known: { actorId: string | null; actorSnapshot?: Record<string, unknown>; userAgent: string | null },
  errorEventId: string | null,
): ActivityDoc {
  const ctx = currentContext();
  const now = new Date();
  const callerMetadata = plain(input.metadata ?? null);
  const metadata: Record<string, unknown> = {
    ...(known.actorSnapshot ?? {}),
    ...(callerMetadata && typeof callerMetadata === "object" ? (callerMetadata as Record<string, unknown>) : {}),
    ...(ctx?.ipUnparsed ? { ip_unparsed: true } : {}),
    ...(ctx?.adminTokenFp ? { admin_token_fp: ctx.adminTokenFp } : {}),
    ...(ctx?.adminVia === "SESSION" ? { admin_via: "SESSION" } : {}),
  };
  const doc = projectAuditRow(
    {
      id: randomUUID(),
      occurredAt: now,
      actorType: actorTypeOf(input, known.actorId),
      actorId: known.actorId,
      action: input.action,
      subjectType: input.subjectType,
      subjectId: input.subjectId ?? null,
      organizationId: input.organizationId ?? null,
      result: input.result ?? "SUCCESS",
      before: plain(input.before),
      after: plain(input.after),
      ipAddress: ctx?.ipAddress ?? null,
      userAgent: known.userAgent,
      correlationId: correlationId(),
      sourceComponent: ctx?.sourceComponent ?? "request-service",
      metadata,
    },
    { source: "audit_fallback", hashKey: env.logStore.hashKey, now },
  );
  doc.request.method = ctx?.method ?? null;
  doc.request.route = ctx?.route ?? null;
  doc.fallback = { errorEventId };
  fitDocument(doc);
  return doc;
}

/** เพดานของทางสำรองของ `recordLogRead()` ทั้งก้อน (ต่อ Mongo + เขียน) — คำขออ่าน log รออยู่ (plan §6) */
const LOG_READ_FALLBACK_MS = 2_000;

/**
 * ทางสำรองของ `recordLogRead()` (lib/audit.ts) เมื่อเขียน `AUDIT_LOG_READ` ลง Postgres ไม่ได้ — คืน `_id` ของสำเนาที่เขียน
 * ลง log store แล้ว หรือ null ถ้าเขียนไม่ได้ภายใน 2 วินาที ไม่ throw
 *
 * ต่างจาก `reportAuditWriteFailure()` ตรงที่**เขียนตรงและรอผล ไม่ผ่านคิว**: คำขออ่านต้องรู้ว่าการอ่านถูกบันทึกแล้วก่อนส่ง
 * ข้อมูลกลับ ถ้าวางไว้ในคิว (ซึ่งเขียนทีหลังทุก 2 วินาทีและทิ้งได้เมื่อเต็ม) การอ่านที่ไม่มีร่องรอยจะหลุดไปได้ ไม่มี
 * `extra.audit` ใน error event: metadata ของการอ่าน (ผู้อ่าน เหตุผล ตัวกรอง) อยู่ในสำเนานี้แล้ว — error event บอกแค่ว่า
 * Postgres ล้มเพราะอะไร
 *
 * `_id` เป็น UUID ใหม่ ไม่ใช่ id ที่ Postgres จะได้: ถ้า INSERT ที่หมดเวลารอไปแล้วยัง commit ทีหลัง relay จะคัดลอกแถวนั้น
 * มาเป็นเอกสารอีกใบ (`source: "audit_event"`) การอ่านครั้งนั้นจึงมีสองบันทึก ซึ่งดีกว่าไม่มีเลย ถ้าใช้ id เดียวกัน
 * `$setOnInsert` ของ relay จะไม่เขียนทับสำเนานี้ และ reconcile จะนับ Postgres กับ Mongo ไม่ตรงกันไปตลอด
 */
export async function recordLogReadFallback(
  err: unknown,
  input: AuditInput,
  userAgent: string | null,
): Promise<string | null> {
  const eventId = captureError(err, { tag: "audit.log-read-failed" });
  try {
    const doc = fallbackDocument(input, { actorId: null, userAgent }, eventId);
    const write = (async () => {
      const db = await logDb();
      if (!db) return false;
      await db.collection<{ _id: string }>("activity").insertOne(doc);
      return true;
    })();
    return (await withinDeadline(write, LOG_READ_FALLBACK_MS)) ? doc._id : null;
  } catch {
    return null;
  }
}

/** ผลของ `work` ถ้าจบภายใน `ms` — ไม่งั้น (หรือ reject) ได้ false ตัวจับเวลาถูกล้างทันทีที่ work จบ */
function withinDeadline(work: Promise<boolean>, ms: number): Promise<boolean> {
  let handle: NodeJS.Timeout | undefined;
  const deadline = new Promise<boolean>((resolve) => {
    handle = setTimeout(() => resolve(false), ms);
  });
  return Promise.race([work.catch(() => false), deadline]).finally(() => clearTimeout(handle));
}
