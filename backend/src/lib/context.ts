/**
 * บริบทของ request ปัจจุบัน
 *
 * schema ใหม่บังคับ `correlation_id` เป็น NOT NULL ทั้งใน audit.audit_event,
 * notification.notification, notification.notification_delivery และ
 * integration.integration_operation — sheet `audit.audit_event` อธิบายไว้ว่า
 * "All actions belonging to the same HTTP request or business workflow should share
 * the same correlation ID"
 *
 * ส่งผ่าน AsyncLocalStorage แทนการเพิ่ม argument ให้ทุกฟังก์ชันในทุกชั้น
 * มิฉะนั้นต้องแก้ signature ของโค้ดเกือบทั้งโปรเจกต์เพียงเพื่อส่ง id ตัวเดียว
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import type { NextFunction, Request, Response } from "express";

export interface RequestContext {
  correlationId: string;
  actorId: string | null;
  /** ผ่าน `parseClientIp()` แล้วเท่านั้น ไม่ใช่ `req.ip` ดิบ — เป็น IP จริงหรือ null */
  ipAddress: string | null;
  /** `req.ip` มีค่าแต่ไม่ใช่ IP — logAudit จดเป็น `metadata.ip_unparsed` แทนการเก็บค่านั้น */
  ipUnparsed: boolean;
  userAgent: string | null;
  /** ชื่อ service ที่เขียน log — คอลัมน์ source_component */
  sourceComponent: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function currentContext(): RequestContext | undefined {
  return storage.getStore();
}

/**
 * correlation id ของงานปัจจุบัน — ถ้าไม่ได้อยู่ใน request (เช่น worker หรือ seed)
 * จะสร้างใหม่ให้ เพื่อให้คอลัมน์ NOT NULL มีค่าเสมอ
 */
export function correlationId(): string {
  return storage.getStore()?.correlationId ?? randomUUID();
}

export function sourceComponent(): string {
  return storage.getStore()?.sourceComponent ?? "request-service";
}

/** รันงานในบริบทที่กำหนดเอง — ใช้ใน worker และสคริปต์ */
export function runWithContext<T>(context: Partial<RequestContext>, fn: () => T): T {
  return storage.run(
    {
      correlationId: context.correlationId ?? randomUUID(),
      actorId: context.actorId ?? null,
      ipAddress: context.ipAddress ?? null,
      ipUnparsed: context.ipUnparsed ?? false,
      userAgent: context.userAgent ?? null,
      sourceComponent: context.sourceComponent ?? "request-service",
    },
    fn,
  );
}

/**
 * ที่อยู่ของผู้เรียกในรูปที่เก็บลงฐานข้อมูลได้ — ค่าที่ไม่ใช่ IP ได้ `ip: null, unparsed: true`
 *
 * `trust proxy 1` ทำให้ `req.ip` คือค่าสุดท้ายของ X-Forwarded-For และไม่มีชั้นไหนในระบบเราต่อท้าย
 * ที่อยู่จริงให้: backend ยิงตรงได้โดยไม่ผ่าน proxy และ proxy ของหน้าเว็บ (`app/api/[...path]`) ก็
 * ส่ง header ของเบราว์เซอร์ต่อมาทั้งดุ้น เพราะ Next เติม X-Forwarded-For จาก socket เฉพาะตอนที่ไม่มี
 * มา (`??=`) ค่านี้จึงเป็นข้อความอะไรก็ได้ที่ผู้เรียกพิมพ์มา ไม่ว่าจะมาทางไหน — ถูกต้องเฉพาะเมื่อชั้น
 * นอกสุดต่อท้ายที่อยู่จริงให้ (Cloudflare หน้า production) ส่วนคอลัมน์ ip_address ทุกตัวเป็น
 * VARCHAR(64) ค่าที่ยาวเกินทำให้ INSERT ล้ม: แถว audit ของคำขอนั้นหายทั้งแถว (logAudit กลืน error
 * ไว้) คนเดา token หรือรหัสผ่านจึงยิงได้โดยไม่เหลือร่องรอย และการสร้าง session ก็ล้มจนเข้าสู่ระบบ
 * ไม่ได้เลย
 *
 * ค่าที่ไม่ผ่านไม่ถูกเก็บไว้ที่ไหนเลย แม้จะตัดให้สั้นแล้ว: ชั้นที่ต่อท้ายที่อยู่จริงเขียน IP ที่ถูกรูปเสมอ
 * ค่าที่ไม่ผ่านจึงเป็นของที่ผู้เรียกแต่งเองทั้งหมด ไม่มีข้อมูลให้สอบสวน มีแต่ช่องให้เขียนข้อความลง audit
 * ส่วนค่าที่ผ่านก็ยังแต่งได้ ผ่านแค่แปลว่าเป็นรูป IP ไม่ได้แปลว่าเป็นที่อยู่ของผู้เรียก
 *
 * zone ของ IPv6 (`fe80::1%eth0`) ถูกตัดหลังผ่าน `isIP()` แล้ว เพราะ `isIP()` รับ zone ยาวเท่าไรก็ได้
 * และ zone ที่มากับ header ไม่มีความหมายกับเครื่องนี้ ค่าที่คืนจึงยาวไม่เกิน 45 ตัว ส่วน `::ffff:`
 * ของ IPv4-mapped คงไว้ตามเดิม ให้ตรงกับแถวที่มีอยู่แล้ว
 */
export function parseClientIp(raw: string | undefined): { ip: string | null; unparsed: boolean } {
  if (!raw) return { ip: null, unparsed: false };
  if (isIP(raw) === 0) return { ip: null, unparsed: true };
  return { ip: raw.split("%")[0] ?? null, unparsed: false };
}

/** IP ของคำขอสำหรับโค้ดที่เขียนคอลัมน์ ip_address เอง (เช่นการลงนาม) — ห้ามใช้ `req.ip` ตรง ๆ */
export function clientIp(req: Request): string | null {
  return parseClientIp(req.ip).ip;
}

/**
 * ผูก correlation id ให้ทุก request
 *
 * รับค่าจาก header x-correlation-id ถ้าผู้เรียกส่งมา เพื่อให้ trace ข้ามระบบได้
 * (ต้องเป็น UUID เพราะคอลัมน์เป็น uuid — ค่าที่ไม่ผ่านจะถูกแทนด้วยค่าใหม่)
 * และส่งกลับใน response header เสมอ เพื่อให้ผู้เรียกอ้างถึงได้เวลาแจ้งปัญหา
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function correlationMiddleware(req: Request, res: Response, next: NextFunction) {
  const incoming = req.header("x-correlation-id");
  const id = incoming && UUID_RE.test(incoming) ? incoming : randomUUID();

  res.setHeader("x-correlation-id", id);
  const client = parseClientIp(req.ip);

  storage.run(
    {
      correlationId: id,
      // session ยังไม่ถูกอ่านตอนนี้ — requireAuth เติมทีหลังผ่าน setActor()
      actorId: null,
      ipAddress: client.ip,
      ipUnparsed: client.unparsed,
      userAgent: req.header("user-agent") ?? null,
      sourceComponent: "web-portal",
    },
    () => next(),
  );
}

/** requireAuth เรียกหลังรู้แล้วว่าใครเป็นผู้กระทำ */
export function setActor(actorId: string | null) {
  const store = storage.getStore();
  if (store) store.actorId = actorId;
}
