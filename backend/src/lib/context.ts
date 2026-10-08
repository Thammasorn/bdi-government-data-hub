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
import type { NextFunction, Request, Response } from "express";

import { SYSTEM_USER_ID } from "./system.js";

export interface RequestContext {
  correlationId: string;
  actorId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  /** ชื่อ service ที่เขียน log — คอลัมน์ source_component */
  sourceComponent: string;
  /**
   * ผ่าน guard ของ admin API มาทางไหน — `TOKEN` (`x-admin-token`, ผู้กระทำคือ "ระบบ") หรือ `SESSION` (ผู้ใช้ที่ถือ
   * `SYSTEM_ADMINISTRATOR` ใช้หน้า /console ผู้กระทำคือคนนั้น) null ถ้าคำขอไม่ได้มาทาง admin API — `requireAdmin` ตั้งให้
   * logAudit จด `SESSION` ลง `metadata.admin_via` แถวของหน้า /console จึงแยกออกจากงานที่ผู้ใช้คนเดียวกันทำบนหน้าอื่นได้
   */
  adminVia: "TOKEN" | "SESSION" | null;
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
      userAgent: context.userAgent ?? null,
      sourceComponent: context.sourceComponent ?? "request-service",
      adminVia: context.adminVia ?? null,
    },
    fn,
  );
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

  storage.run(
    {
      correlationId: id,
      // session ยังไม่ถูกอ่านตอนนี้ — requireAuth เติมทีหลังผ่าน setActor()
      actorId: null,
      ipAddress: req.ip ?? null,
      userAgent: req.header("user-agent") ?? null,
      sourceComponent: "web-portal",
      adminVia: null,
    },
    () => next(),
  );
}

/** requireAuth เรียกหลังรู้แล้วว่าใครเป็นผู้กระทำ */
export function setActor(actorId: string | null) {
  const store = storage.getStore();
  if (store) store.actorId = actorId;
}

/** requireAdmin เรียกเมื่อผ่าน guard ของ admin API แล้ว — ดู `RequestContext.adminVia` */
export function setAdminVia(via: "TOKEN" | "SESSION") {
  const store = storage.getStore();
  if (store) store.adminVia = via;
}

/**
 * ผู้กระทำของงานผู้ดูแลระบบ — ผู้ใช้จาก session เมื่อมาทางหน้า /console, บัญชี SYSTEM เมื่อมาทาง admin token
 *
 * route ของ admin เคยส่ง `SYSTEM_USER_ID` ตรง ๆ ลงคอลัมน์ `*_by` และ actor ของ helper เพราะ token ไม่ผูกกับคน ตอนนี้
 * เส้นทางเดียวกันรับ session ด้วย คอลัมน์เหล่านั้นจึงต้องบอกชื่อคนที่กดเมื่อรู้ — เส้นทาง token ได้ค่าเดิมทุกตัว
 */
export function adminActorId(): string {
  return storage.getStore()?.actorId ?? SYSTEM_USER_ID;
}
