/**
 * อายุการเก็บของทุกอย่างใน log store — ตารางเดียวที่ BDI ตรวจและแก้ตัวเลขได้ (plan §3 "Retention", คำถาม Q3)
 *
 * worker ใช้ตารางนี้วันละครั้งหลัง 03:00 น. (workers/log-relay.ts, `pruneLogStore`) ไม่ใช้ TTL index: prune แบบนี้
 * ทำงานเหมือนกันทั้งบน mongo ในเครื่อง Atlas และ Cosmos ทั้งสองแบบ (Cosmos RU มี TTL ได้แค่บน `_ts`)
 *
 * **Postgres `audit.audit_event` ไม่อยู่ในตารางนี้และไม่ถูกลบ** — มันคือระบบบันทึกหลัก ตารางนี้คุมแค่สำเนาใน Mongo
 * สำเนาที่ถูกลบตามอายุ relay ไม่คัดลอกกลับ (cursor เดินผ่านไปแล้ว) ยกเว้นตอน rebuild ซึ่งเติมใหม่ตั้งแต่แถวแรกของ
 * Postgres แล้ว prune รอบถัดไปลบซ้ำ (docs/21 runbook)
 */
import type { ActivityCategory } from "./activity-shape.js";

/**
 * activity แต่ละหมวด:
 *   - `deleteAfterDays` — ลบทั้งเอกสารเมื่อ `occurredAt` เก่ากว่านี้ (null = ไม่ลบ)
 *   - `stripClientAfterDays` — `$unset` `request.ip` กับ `request.userAgent` เมื่อเก่ากว่านี้ (null = ไม่ตัด)
 */
export interface ActivityRetention {
  deleteAfterDays: number | null;
  stripClientAfterDays: number | null;
}

/** เรื่องของธุรกิจ — เก็บตลอด แต่ IP กับ user agent หมดความจำเป็นหลังหนึ่งปี */
const KEEP: ActivityRetention = { deleteAfterDays: null, stripClientAfterDays: 365 };
/**
 * การเข้าสู่ระบบ session และการเข้าถึง admin API — 400 วัน: ได้ประวัติการเดารหัสผ่านย้อนหลังครบหนึ่งปีเต็ม และนานกว่า
 * 90 วันของ พ.ร.บ.คอมพิวเตอร์ ม.26 ถ้าบังคับใช้ ลบทั้งใบจึงไม่ต้องตัด IP ก่อน
 */
const AUTH_LIKE: ActivityRetention = { deleteAfterDays: 400, stripClientAfterDays: null };

/** ตัดสินแล้ว 2026-09-30 — `system` กับ `other` (รหัสที่ยังไม่ได้จัดหมวด) ถือแบบ auth ไม่ใช่แบบธุรกิจ */
export const ACTIVITY_RETENTION: Record<ActivityCategory, ActivityRetention> = {
  account: KEEP,
  role: KEEP,
  invitation: KEEP,
  organization: KEEP,
  request: KEEP,
  document: KEEP,
  review: KEEP,
  config: KEEP,
  "log-access": KEEP,
  auth: AUTH_LIKE,
  session: AUTH_LIKE,
  "admin-access": AUTH_LIKE,
  system: AUTH_LIKE,
  other: AUTH_LIKE,
};

/** error ทีละครั้ง — ตัวอย่างสำหรับไล่ปัญหา ตัวนับอยู่ใน error_issues */
export const ERROR_EVENT_DAYS = 90;
/** รายงานจากเบราว์เซอร์ (step 9) — มากและบอกได้น้อยกว่า */
export const BROWSER_EVENT_DAYS = 30;
/** process เริ่ม ปิด และตาย — ใช้ดูการวนรีสตาร์ต (step 10) */
export const RUNTIME_EVENT_DAYS = 90;
/**
 * issue ที่ปิด (resolved) หรือละเว้น (ignored) แล้วไม่เกิดอีก — issue ของ server ที่ยัง `open` ไม่ถูกลบไม่ว่าเก่าแค่ไหน
 * (ของเบราว์เซอร์ดู OPEN_BROWSER_ISSUE_DAYS)
 */
export const CLOSED_ISSUE_DAYS = 365;
/**
 * issue ของเบราว์เซอร์ที่ยัง `open` และไม่เกิดอีก — เท่าอายุของ event ของมัน (ถึงตอนนั้นไม่เหลือ event ให้เปิดดูแล้ว) ไม่ใช่ไม่มี
 * กำหนดเหมือนของ server: รายงานจากเบราว์เซอร์ใครก็ส่งได้ และข้อความไม่ซ้ำกันหนึ่งตัวคือ issue ใหม่หนึ่งใบ (lib/error-capture.ts
 * `BROWSER_FINGERPRINTS_PER_HOUR`) issue ที่คนปิดหรือละเว้นไว้ยังใช้ CLOSED_ISSUE_DAYS — ตัวที่ละเว้นต้องไม่หายแล้วกลับมาเป็น
 * issue ใหม่ที่แจ้งเตือนอีก
 */
export const OPEN_BROWSER_ISSUE_DAYS = BROWSER_EVENT_DAYS;
