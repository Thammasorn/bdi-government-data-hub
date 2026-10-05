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
  // ยิงแล้วไม่รอ (plan §5): Next **รอ** ตัวนี้ก่อนตอบ error ของ route handler (build/templates/app-route.js) — backend ช้าหรือล่ม
  // ต้องไม่ทำให้คำตอบ 500 ช้าไปอีกวินาที เอกสารของ Next ที่ให้ await เขียนไว้สำหรับ serverless ซึ่ง process ตายหลังตอบ ที่นี่
  // Next server รันค้างอยู่ (output: "standalone") POST ที่ค้างจึงจบเองภายในเพดาน 1 วินาทีของมัน
  void reportServerError(error, {
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
