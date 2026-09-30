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
  /**
   * fingerprint (`tokenFingerprint()`) ของ `x-admin-token` ที่ผ่าน `requireAdminToken` — null ถ้าคำขอ
   * ไม่ได้มาทาง admin API logAudit จดลง `metadata.admin_token_fp`
   */
  adminTokenFp: string | null;
  /** เวลาที่งานนี้เริ่ม (ms) — lib/error-capture.ts คิด durationMs ของคำขอที่ล้มจากค่านี้ */
  startedAt: number;
  /** HTTP method ของคำขอ — null ใน worker และสคริปต์ */
  method: string | null;
  /**
   * route แบบแม่แบบ (`/api/organizations/:id/review`) ไม่ใช่ path จริง — `wrap()` ใน lib/async-route.ts ตั้งให้
   * ก่อน handler ทำงาน ใช้จัดกลุ่ม error ที่เกิดใน route เดียวกันให้เป็น issue เดียว ไม่ว่า id ใน path จะเป็นอะไร
   */
  route: string | null;
  /**
   * สิ่งที่คำขอนี้ทำไปแล้วก่อนจะล้ม (เขียน audit · ลง outbox · ส่งอีเมล · เรนเดอร์ · storage · ThaID) ล่าสุดไม่เกิน
   * BREADCRUMB_MAX รายการ — ติดไปกับ error event ของคำขอนั้น ตอบคำถาม "commit ไปแล้วหรือยังก่อนจะได้ 500"
   * ข้อความเป็นของเราเองทั้งหมด **ห้ามใส่ที่อยู่อีเมล ชื่อ หรือค่าที่ผู้ใช้กรอก**
   */
  breadcrumbs: Breadcrumb[];
  /**
   * คำขอนี้ผ่าน `captureError()` ไปแล้วหรือยัง — lib/error-capture.ts ตั้งเป็น true ส่วน `referenceOnServerErrors`
   * ใน index.ts อ่าน: 5xx ที่ route ตอบเองโดยไม่มีใครเก็บ (503 `no_reviewer`, `no_legal_documents`) ถูกเก็บเป็น
   * warning ตรงนั้น ส่วน 5xx ที่ถูกเก็บไปแล้วไม่ถูกนับซ้ำเป็น issue ที่สอง รหัสอ้างอิงที่ผู้ใช้เห็นค้นเจอใน log store
   * ยกเว้นตอนเกินเพดานขนาด คิวเต็ม หรือเพดานของตัวย่อ — ดู `keepReference()` ใน lib/error-capture.ts
   */
  errorCaptured: boolean;
}

export type BreadcrumbType = "audit" | "outbox" | "smtp" | "render" | "storage" | "thaid";

export interface Breadcrumb {
  at: Date;
  type: BreadcrumbType;
  message: string;
  ok: boolean;
}

/** เก็บแค่ 30 รายการล่าสุด — คำขอที่วนเขียนเป็นร้อยครั้งต้องไม่ทำให้ error event โตไม่มีเพดาน */
const BREADCRUMB_MAX = 30;

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

/**
 * รหัสอ้างอิงที่ผู้ใช้เห็นบนข้อความ 5xx — 8 ตัวแรกของ correlation id ของคำขอ (decision 18 ใน plan)
 *
 * สั้นพอให้อ่านให้เจ้าหน้าที่ฟังทางโทรศัพท์ได้ และค้นย้อนหา error event กับแถว audit ของคำขอนั้นได้ด้วย prefix
 * ของ `request.correlationId` ไม่ได้อยู่ในคำขอ (worker) ก็ได้ค่าจาก correlation id ใหม่ ซึ่งไม่ชี้อะไร
 */
export function referenceOf(id: string): string {
  return id.slice(0, 8);
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
      adminTokenFp: context.adminTokenFp ?? null,
      startedAt: Date.now(),
      method: null,
      route: null,
      breadcrumbs: [],
      errorCaptured: false,
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
 * นอกสุดต่อท้ายที่อยู่จริงให้ (หน้า production คือ Cloudflare ซึ่งเอกสารของ Cloudflare บอกว่าต่อท้าย
 * แต่ยังไม่ได้ยืนยันกับ tunnel ของเรา) ส่วนคอลัมน์ ip_address ทุกตัวเป็น
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
 *
 * เก็บเป็น**ตัวพิมพ์เล็กเสมอ**: คอลัมน์ uuid ของ Postgres เก็บตัวเล็ก (สำเนาที่ relay คัดลอกจึงตัวเล็ก) แต่ error event กับสำเนา
 * `audit_fallback` เขียนค่าจากบริบทนี้ตรง ๆ — ถ้าคงตัวพิมพ์ที่ส่งมา รหัสอ้างอิงบนข้อความ 5xx เป็นตัวใหญ่ และค้นด้วย
 * `trace/` หรือ `?correlationId=` (ซึ่งแปลงเป็นตัวเล็กแล้วจับด้วย prefix ที่ใช้ index) ไม่เจอ
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function correlationMiddleware(req: Request, res: Response, next: NextFunction) {
  const incoming = req.header("x-correlation-id");
  const id = incoming && UUID_RE.test(incoming) ? incoming.toLowerCase() : randomUUID();

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
      // ค่าตั้งต้นของทุกคำขอ — requireAdminToken เปลี่ยนเป็น admin-portal เมื่อ token ผ่าน
      sourceComponent: "web-portal",
      adminTokenFp: null,
      startedAt: Date.now(),
      method: req.method,
      // ยังไม่รู้ว่าจะไปถึง route ไหน — wrap() เติมให้ตอนเข้า handler ของ route
      route: null,
      breadcrumbs: [],
      errorCaptured: false,
    },
    () => next(),
  );
}

/** requireAuth เรียกหลังรู้แล้วว่าใครเป็นผู้กระทำ */
export function setActor(actorId: string | null) {
  const store = storage.getStore();
  if (store) store.actorId = actorId;
}

/**
 * เปลี่ยน source_component ของคำขอนี้ — เรียกหลังรู้แล้วว่าคำขอมาจากช่องทางไหน
 *
 * correlationMiddleware ประทับ `web-portal` ให้ทุกคำขอเพราะตอนนั้นยังไม่รู้ว่าเป็นใคร ถ้าไม่มีตัวนี้
 * งานของผู้ดูแลระบบทุกแถวก็เป็น `web-portal` ไปด้วย แยกไม่ออกว่าหน่วยงานกดบนหน้าเว็บหรือมีคนถือ
 * admin token ยิงเข้ามา
 */
export function setSourceComponent(component: string) {
  const store = storage.getStore();
  if (store) store.sourceComponent = component;
}

/** requireAdminToken เรียกเมื่อ token ผ่าน — ดู `RequestContext.adminTokenFp` */
export function setAdminTokenFp(fingerprint: string) {
  const store = storage.getStore();
  if (store) store.adminTokenFp = fingerprint;
}

/** `wrap()` เรียกก่อน handler ของ route — ดู `RequestContext.route` */
export function setRoute(route: string) {
  const store = storage.getStore();
  if (store) store.route = route;
}

/**
 * จดว่าคำขอนี้ทำอะไรไปแล้ว — ไม่ throw ไม่แตะ I/O นอกคำขอ (worker สคริปต์) ก็แค่ไม่ได้จด
 *
 * `message` เป็นข้อความของเราเองเท่านั้น: ชื่อ action รหัสตอบกลับ จำนวน — **ไม่ใส่ที่อยู่อีเมล ชื่อคน หรือค่าที่
 * ผู้ใช้กรอก** เพราะ breadcrumb ลง error event ทั้งก้อนโดยไม่ผ่านตัวกรองอีกชั้น
 */
export function addBreadcrumb(type: BreadcrumbType, message: string, ok = true) {
  const store = storage.getStore();
  if (!store) return;
  store.breadcrumbs.push({ at: new Date(), type, message: message.slice(0, 200), ok });
  if (store.breadcrumbs.length > BREADCRUMB_MAX) store.breadcrumbs.shift();
}
