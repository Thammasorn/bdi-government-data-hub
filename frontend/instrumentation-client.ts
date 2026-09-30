/**
 * error ของเบราว์เซอร์ที่ไม่มีใครจับ → log store (lib/report-error.ts) — Next โหลดไฟล์นี้ก่อนหน้าเว็บพร้อมใช้งาน
 *
 * `window` `error` กับ `unhandledrejection` เท่านั้น — error ที่หน้าจับเองแล้วแสดง toast ไม่ถูกรายงาน (ส่วนใหญ่เป็น `ApiError`
 * ซึ่ง backend เก็บไว้แล้ว) `ChunkLoadError` (deploy ใหม่ระหว่างที่หน้าเก่ายังเปิดอยู่) เป็นคำเตือน ไม่ใช่บั๊ก และไม่ส่งอีเมล
 * แจ้งเตือน ต้องเบา: Next เตือนถ้าไฟล์นี้ใช้เวลาเกิน 16 ms ตอนเปิดหน้า
 */
import { reportError } from "./lib/report-error";

function isChunkLoad(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === "ChunkLoadError" || /Loading (?:CSS )?chunk [\w-]+ failed/i.test(error.message);
}

try {
  window.addEventListener("error", (event) => {
    const error: unknown = event.error ?? event.message;
    reportError(error, { mechanism: "window", level: isChunkLoad(error) ? "warning" : "error" });
  });
  window.addEventListener("unhandledrejection", (event) => {
    const error: unknown = event.reason;
    reportError(error, { mechanism: "unhandledrejection", level: isChunkLoad(error) ? "warning" : "error" });
  });
} catch {
  // ติดตั้งตัวดักไม่ได้ — หน้ายังต้องทำงานตามปกติ
}
