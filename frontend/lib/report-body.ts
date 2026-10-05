/**
 * body ของรายงาน error ที่พอดีเพดานของ backend — ใช้ทั้งฝั่งเบราว์เซอร์ (lib/report-error.ts) และ Next server
 * (lib/server-error-report.ts)
 *
 * `POST /api/client-errors` อ่าน body ได้ไม่เกิน 16 KB **เป็นไบต์ของ UTF-8** (backend/src/routes/client-errors.ts) เกินแล้ว
 * ตัวอ่าน body ปฏิเสธทั้งก้อนและตอบ 204 เงียบ ๆ เหมือนรับไปแล้ว — รายงานหายไปทั้งตัว เดิมทั้งสองฝั่งตัดแค่จำนวนตัวอักษร (ข้อความ
 * 2,000 + stack 16,000) ซึ่งเกิน 16 KB ได้เองโดยไม่ต้องตั้งใจ: stack ยาวของ Firefox/Safari (ราวร้อยเฟรม) บวกข้อความภาษาไทยสั้น ๆ
 * (ตัวละ 3 ไบต์ และ stack ของ V8 ยกข้อความมาซ้ำอีกรอบที่บรรทัดแรก) ได้ราว 17 KB แล้วหาย (ตรวจขั้น 9, 2026-10-01)
 *
 * ที่นี่วัดเป็นไบต์หลังแปลงเป็น JSON แล้วตัด **stack ก่อน** (ทิ้งเฟรมท้าย ๆ ทีละบรรทัดเต็ม — เฟรมบนสุดบอกได้มากที่สุด) แล้วจึงตัด
 * ข้อความถ้ายังเกิน งบ 15,000 ไบต์ เผื่อที่ไว้ใต้ 16,384 ของเพดาน
 */

export const REPORT_BODY_BUDGET_BYTES = 15_000;
/** ตัดรอบละส่วน ถ้ายังไม่พอหลังจากนี้ ทิ้ง stack กับ `lastApi` และตัดข้อความเหลือ 500 ตัว — พอดีงบเสมอ */
const ROUNDS = 8;

function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * ข้อความที่สั้นลงพอให้หายเกินราว `over` ไบต์ — ประมาณจากไบต์เฉลี่ยต่อตัวอักษรของข้อความนั้นเอง (ตัวไทยสามไบต์ตัดทีละหนึ่งในสาม
 * ของที่ตัวอังกฤษต้องตัด) ประมาณขาดก็ได้รอบถัดไปเก็บ `wholeLines` = ตัดถึงท้ายบรรทัดก่อนหน้า (stack)
 */
function shortened(text: string, over: number, wholeLines: boolean): string {
  const bytes = Math.max(1, utf8Length(JSON.stringify(text)) - 2);
  const perChar = Math.max(1, bytes / Math.max(1, text.length));
  const kept = text.slice(0, Math.max(0, text.length - Math.ceil(over / perChar)));
  if (!wholeLines) return kept;
  const lastBreak = kept.lastIndexOf("\n");
  return lastBreak > 0 ? kept.slice(0, lastBreak) : kept;
}

/** JSON ของรายงานที่ไม่เกินงบ — ตัด `stack` ก่อน แล้ว `message` แล้ว `lastApi` ไม่ throw */
export function reportBody(report: Record<string, unknown>): string {
  let current: Record<string, unknown> = { ...report };
  let body = JSON.stringify(current);
  for (let round = 0; round < ROUNDS; round += 1) {
    const over = utf8Length(body) - REPORT_BODY_BUDGET_BYTES;
    if (over <= 0) return body;
    current = { ...current };
    const stack = typeof current.stack === "string" ? current.stack : "";
    const message = typeof current.message === "string" ? current.message : "";
    if (stack.length > 0) {
      const trimmed = shortened(stack, over, true);
      if (trimmed) current.stack = trimmed;
      else delete current.stack;
    } else if (message.length > 0) {
      current.message = shortened(message, over, false);
    } else if (Array.isArray(current.lastApi) && current.lastApi.length > 0) {
      current.lastApi = [];
    } else {
      break;
    }
    body = JSON.stringify(current);
  }
  if (utf8Length(body) <= REPORT_BODY_BUDGET_BYTES) return body;
  const { stack: _stack, lastApi: _lastApi, ...rest } = current;
  const message = typeof rest.message === "string" ? rest.message.slice(0, 500) : rest.message;
  return JSON.stringify({ ...rest, message, ...(Array.isArray(report.lastApi) ? { lastApi: [] } : {}) });
}
