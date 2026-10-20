/**
 * ระยะเวลาเป็นวินาที → ข้อความภาษาไทยสำหรับคนอ่าน เช่น 600 → "10 นาที", 5400 → "1 ชั่วโมง 30 นาที"
 *
 * อายุทุกอย่างใน env เป็นวินาที (`*_TTL_SECONDS`) แต่อีเมลและข้อความตอบกลับต้องบอกคนเป็นหน่วย
 * ที่คนใช้ — ใส่ตัวเลขดิบลงไปจะได้ "ใช้ได้ 604800 วินาที" หน่วยที่เป็นศูนย์ถูกข้ามไป
 */
const UNITS: Array<[seconds: number, label: string]> = [
  [24 * 60 * 60, "วัน"],
  [60 * 60, "ชั่วโมง"],
  [60, "นาที"],
  [1, "วินาที"],
];

export function thaiDuration(totalSeconds: number): string {
  let rest = Math.max(0, Math.floor(totalSeconds));
  const parts: string[] = [];
  for (const [size, label] of UNITS) {
    const n = Math.floor(rest / size);
    if (n > 0) parts.push(`${n} ${label}`);
    rest -= n * size;
  }
  return parts.length ? parts.join(" ") : "0 วินาที";
}
