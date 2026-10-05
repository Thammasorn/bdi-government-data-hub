import { Prisma, PrismaClient } from "@prisma/client";

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

// --------------------------------------------------------------------------------------------- เพดานเวลา

/**
 * Postgres ที่หยุด (stop) ทำให้ Prisma รอ connect ราว 5 วินาที ที่ค้าง (pause, pool เต็ม) รอได้ถึง pool timeout 10 วินาที
 * หรือไม่จบเลย — งานที่ต้องไม่ค้างตาม (API อ่าน log: บันทึกการอ่าน การแปลงตัวระบุ ส่วน Postgres ของ trace) ครอบด้วย
 * `withDatabaseDeadline()` คำสั่งปกติรอไม่เกิน DEADLINE_MS ถ้าภายใน DOWN_HOLD_MS ที่ผ่านมามีคำสั่งที่ครอบแบบนี้ล้มเพราะ
 * ติดต่อไม่ได้ ถัดไปรอแค่ DEADLINE_WHILE_DOWN_MS — ยังลองทุกครั้ง ไม่ข้าม: Postgres ที่กลับมาแล้วตอบในไม่กี่สิบ ms และความสำเร็จ
 * ครั้งแรกล้างสถานะนี้ทันที
 *
 * คำสั่งที่เลิกรอไม่ได้ถูกยกเลิก: ยังถือ connection จนจบ และ INSERT ที่ถูกทิ้งยัง commit ทีหลังได้
 */
const DEADLINE_MS = 2_000;
const DEADLINE_WHILE_DOWN_MS = 300;
const DOWN_HOLD_MS = 30_000;
let downUntil = 0;

export class DatabaseDeadlineExceeded extends Error {
  constructor(ms: number) {
    super(`Postgres ไม่ตอบภายใน ${ms} ms`);
    this.name = "DatabaseDeadlineExceeded";
  }
}

/** รหัสของ Prisma ที่แปลว่าติดต่อฐานข้อมูลไม่ได้หรือไม่ทัน (ตรงกับที่ index.ts แปลเป็น 503) — ไม่ใช่ข้อผิดของคำสั่ง */
const UNREACHABLE_CODES = new Set(["P1001", "P1002", "P1008", "P1017", "P2024"]);

/**
 * error นี้แปลว่า Postgres ติดต่อไม่ได้หรือไม่ทันเวลา — ไม่ใช่ว่าคำสั่งผิด (unique ชน แถวไม่มี …) client ที่ไม่เคยต่อติดโยน
 * `PrismaClientInitializationError` ซึ่งไม่มี `code` (CLAUDE.md, Traps)
 */
export function isDatabaseUnreachable(err: unknown): boolean {
  if (err instanceof DatabaseDeadlineExceeded) return true;
  if (err instanceof Prisma.PrismaClientInitializationError) return true;
  return err instanceof Prisma.PrismaClientKnownRequestError && UNREACHABLE_CODES.has(err.code);
}

/** ผลของ `work` หรือ `DatabaseDeadlineExceeded` ถ้าไม่จบในเพดาน (ดูหัวข้อข้างบน) — error อื่นผ่านออกไปตามเดิม */
export async function withDatabaseDeadline<T>(work: () => Promise<T>): Promise<T> {
  const ms = Date.now() < downUntil ? DEADLINE_WHILE_DOWN_MS : DEADLINE_MS;
  let handle: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    handle = setTimeout(() => reject(new DatabaseDeadlineExceeded(ms)), ms);
  });
  try {
    // race ผูก handler ไว้กับ work แล้ว — work ที่ถูกทิ้งแล้วล้มทีหลังจึงไม่กลายเป็น unhandled rejection
    const result = await Promise.race([work(), deadline]);
    downUntil = 0;
    return result;
  } catch (err) {
    if (isDatabaseUnreachable(err)) downUntil = Date.now() + DOWN_HOLD_MS;
    throw err;
  } finally {
    clearTimeout(handle);
  }
}
