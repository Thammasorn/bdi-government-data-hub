/**
 * ตารางเวลาตรวจสถานะการ์ด Jira แบบ cron (การ์ด "[Enhance] Jira sync schedule เป็น cron" 2026-11-10)
 *
 * แทนค่า "ทุก N วินาที" เดิม — ผู้ดูแลระบบกำหนดได้ทั้งความถี่ ช่วงเวลา และวัน เช่น `*\/15 8-18 * * MON-FRI` ตัวแปลคือ `cron-parser`
 * รับทุกรูปแบบที่มันรองรับ: 5 ช่อง, 6 ช่อง (วินาทีนำหน้า), ช่วง รายการ ขั้น ชื่อวัน/เดือน, `L` `#` `?` และ `@hourly` `@daily` ฯลฯ
 * (ไม่รองรับ `W` ของ Quartz — ตัวแปลไม่รู้จัก)
 *
 * **เวลาไทยเสมอ** — container ใช้ UTC ถ้าไม่กำหนด tz "8-18" จะคลาด 7 ชั่วโมง
 *
 * **ถี่สุดนาทีละครั้ง** — ในรูป 6 ช่อง ช่องวินาทีต้องเป็นตัวเลขเดียว สองรอบติดกันจึงอยู่คนละนาทีเสมอ (ห่างกันอย่างน้อย 60 วินาที) เป็นการตรวจที่
 * ตรงแน่นอน ไม่ใช่การสุ่มดูรอบถัด ๆ ไป ซึ่งพลาดรูปแบบที่ถี่เฉพาะบางช่วงได้ กันไม่ให้ `*\/5 * * * * *` เรียก Jira ทุก 5 วินาที
 */
import cronParser from "cron-parser";

export const JIRA_SYNC_TIMEZONE = "Asia/Bangkok";
export const DEFAULT_JIRA_SYNC_CRON = "*/15 * * * *";

export type CronCheck = { ok: true; nextRuns: Date[] } | { ok: false; error: string };

const parse = (expr: string, from: Date) =>
  cronParser.parseExpression(expr, { tz: JIRA_SYNC_TIMEZONE, currentDate: from });

/** ตรวจ cron ที่ผู้ดูแลระบบพิมพ์ — คืนเวลาสามรอบถัดไปเมื่อใช้ได้ หรือข้อความภาษาไทยเมื่อใช้ไม่ได้ */
export function checkSyncCron(input: string, from = new Date()): CronCheck {
  const expr = input.trim();
  if (!expr) return { ok: false, error: "กรุณากรอกตารางเวลาแบบ cron" };
  if (expr.length > 120) return { ok: false, error: "ตารางเวลายาวเกินไป" };

  const fields = expr.split(/\s+/);
  if (!expr.startsWith("@") && fields.length === 6 && !/^\d{1,2}$/.test(fields[0]!)) {
    return {
      ok: false,
      error: "ช่องวินาที (ช่องแรกของรูปแบบ 6 ช่อง) ต้องเป็นตัวเลขเดียว เช่น 0 — ระบบตรวจการ์ดได้ถี่สุดนาทีละครั้ง",
    };
  }
  if (!expr.startsWith("@") && fields.length !== 5 && fields.length !== 6) {
    return { ok: false, error: `cron ต้องมี 5 ช่อง (นาที ชั่วโมง วันที่ เดือน วันในสัปดาห์) หรือ 6 ช่อง — ที่กรอกมี ${fields.length} ช่อง` };
  }

  try {
    const it = parse(expr, from);
    const nextRuns = [it.next().toDate(), it.next().toDate(), it.next().toDate()];
    return { ok: true, nextRuns };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `รูปแบบ cron ไม่ถูกต้อง — ${detail}` };
  }
}

/**
 * รอบแรกของตารางเวลาที่อยู่หลัง `after` — worker เทียบกับตอนนี้: ถึงแล้วก็ตรวจ ยังไม่ถึงก็รอ
 * ถ้า worker หยุดไปหลายรอบ รอบที่พลาดทั้งหมดรวมเป็นการตรวจครั้งเดียว เพราะถามแค่ "มีรอบไหนผ่านไปแล้วหรือยัง"
 */
export function nextRunAfter(expr: string, after: Date): Date {
  return parse(expr, after).next().toDate();
}
