import { PrismaClient } from "@prisma/client";

import { env } from "./env.js";
import { databaseLogLine } from "./lib/redact.js";

/**
 * log ของ Prisma เองออกเป็น event แล้วพิมพ์บรรทัดเดียวที่กวาดแล้ว — ไม่ใช่ `log: ["error"]` ที่พิมพ์ข้อความเต็มลง stdout
 *
 * ข้อความเต็มของ error จาก Postgres ยก DETAIL มาทั้งแถว (`Failing row contains (…)`: id ผู้กระทำ before/after เป็น
 * JSON, IP, UA, ชื่อ) และยกโค้ดรอบจุดที่เรียกมาด้วย — บรรทัดนั้นเคยลง docker logs ก่อน error ตัวเดียวกันจะไปถึง
 * captureError ซึ่งกวาดแล้วอย่างถูกต้อง ทั้งสองทางจึงต้องผ่าน lib/redact.ts
 * เหลือแค่ `target` (`auditEvent.create`) กับสาเหตุ ส่วนรายละเอียดเต็มที่กวาดแล้วอยู่ใน error event ของ log store
 */
export const prisma = new PrismaClient({
  log: [
    { emit: "event", level: "error" },
    { emit: "event", level: "warn" },
  ],
});

prisma.$on("error", (event) => {
  console.error(`prisma:error ${event.target || "-"} — ${databaseLogLine(event.message)}`);
});
// คำเตือนของ Prisma (pool, การตั้งค่า) — พิมพ์เฉพาะตอน dev เหมือนเดิม ผ่านตัวกวาดเหมือน error
prisma.$on("warn", (event) => {
  if (env.nodeEnv === "development") console.warn(`prisma:warn ${databaseLogLine(event.message)}`);
});

/** Cheap round-trip that works even before any models exist. */
export async function pingDatabase(): Promise<void> {
  await prisma.$queryRaw`SELECT 1`;
}
