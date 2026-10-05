/**
 * error ของเบราว์เซอร์ที่ไม่มีใครจับ → log store (lib/report-error.ts) — Next โหลดไฟล์นี้ก่อนหน้าเว็บพร้อมใช้งาน
 *
 * `window` `error` กับ `unhandledrejection` เท่านั้น — error ที่หน้าจับเองแล้วแสดง toast ไม่ถูกรายงาน (ส่วนใหญ่เป็น `ApiError`
 * ซึ่ง backend เก็บไว้แล้ว) chunk ที่โหลดไม่ขึ้น (deploy ใหม่ระหว่างที่หน้าเก่ายังเปิดอยู่ — `ChunkLoadError` ของ webpack หรือ
 * "Failed to load chunk …" ของ Turbopack) เป็นคำเตือน ไม่ใช่บั๊ก และไม่ส่งอีเมลแจ้งเตือน — `reportError` ตัดสินระดับเอง
 * (`isChunkLoadError`) ให้หน้า global-error ได้กติกาเดียวกัน ต้องเบา: Next เตือนถ้าไฟล์นี้ใช้เวลาเกิน 16 ms ตอนเปิดหน้า
 */
import { reportError } from "./lib/report-error";

try {
  window.addEventListener("error", (event) => {
    reportError(event.error ?? event.message, { mechanism: "window" });
  });
  window.addEventListener("unhandledrejection", (event) => {
    reportError(event.reason, { mechanism: "unhandledrejection" });
  });
} catch {
  // ติดตั้งตัวดักไม่ได้ — หน้ายังต้องทำงานตามปกติ
}
