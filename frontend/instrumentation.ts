/**
 * error ของ Next server → stdout หนึ่งบรรทัด + log store (lib/server-error-report.ts)
 *
 * ไฟล์นี้ถูก build ทั้งสำหรับ Node.js และ Edge runtime — โค้ดที่ใช้ `process.on` อยู่ในไฟล์แยกที่ import เฉพาะเมื่อ
 * `NEXT_RUNTIME === "nodejs"` (แบบที่เอกสารของ Next แนะนำ) ไม่งั้นบันเดิลของ Edge เตือนว่าใช้ Node API ที่ไม่มี
 *
 *   - `register()` — ตัวดัก `unhandledRejection` / `uncaughtException` ของ process ที่ไม่เปลี่ยนพฤติกรรมเดิมของ Next
 *     (error เดียวที่เคยเห็นจาก frontend ของ production คือแบบนี้: `⨯ unhandledRejection: EACCES mkdir '/app/.next/cache'`)
 *   - `onRequestError` — error ที่ Next จับได้ระหว่างเรนเดอร์หน้า route handler หรือ server action
 */
import type { Instrumentation } from "next";

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { installProcessHandlers } = await import("./lib/server-error-report");
  installProcessHandlers();
}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { reportServerError } = await import("./lib/server-error-report");
  // เอกสารของ Next ให้ await งาน async ในนี้ — มีเพดาน 1 วินาทีอยู่ในตัวแล้ว
  await reportServerError(error, {
    mechanism: "onRequestError",
    route: {
      path: context.routePath,
      type: context.routeType,
      routerKind: context.routerKind,
      method: request.method,
      requestPath: request.path,
    },
  });
};
