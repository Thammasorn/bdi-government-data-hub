/**
 * ขนาดของค่าหนึ่งค่าเมื่อเป็น BSON — ตัวเลขเดียวกับที่ Mongo เก็บ (`calculateObjectSize` ของแพ็กเกจ `bson`) โดยไม่ต้องโหลด
 * driver: `mongodb` (และ `bson` ที่มากับมัน) โหลดด้วย `import()` เฉพาะเมื่อเปิด log store (lib/log-store.ts, plan decision 11)
 * แต่เพดาน 64 KB ของเอกสารต้องวัดตอนประกอบเอกสาร ซึ่งเกิดบนเส้นทางของคำขอ (lib/audit-fallback.ts) และใน relay
 *
 * ทำไมไม่ใช้ความยาวของ JSON: BSON ต่างจาก JSON สองทางและทั้งสองทางมีจริง
 *   - array ของค่าสั้น ๆ แพงกว่ามาก ทุกใบมีชนิด (1 ไบต์) ชื่อ key เป็นเลขลำดับ (`"0"`…`"2999"` บวกตัวปิด) และข้อความมี
 *     ความยาว 4 ไบต์นำหน้า — array ข้อความสามพันใบที่ JSON 57 KB เป็น BSON 80 KB (ตรวจขั้น 6, 2026-09-30) เดิมวัดด้วย JSON
 *     เอกสารแบบนี้จึงผ่านเพดานไปทั้งที่เกิน
 *   - ข้อความที่มีเครื่องหมายคำพูดหรืออักขระควบคุมถูก escape ใน JSON (`"` → `\"`) แต่ BSON เก็บตรง ๆ
 *
 * กฎเดียวกับที่ driver เขียน (js-bson 6 กับค่าตั้งต้นของ MongoClient `ignoreUndefined: false`, `serializeFunctions: false`)
 * ตรงกับ `calculateObjectSize` ไบต์ต่อไบต์ (ลองกับเอกสารจริงและค่าแปลก ๆ แล้ว 2026-09-30) ยกเว้น undefined ใน object ซึ่ง
 * `calculateObjectSize` ข้ามโดยค่าตั้งต้นของมันเอง แต่ driver เขียนเป็น null — ที่นี่นับแบบ driver (มากกว่าไม่กี่ไบต์):
 *   - เอกสาร/array: 4 (ความยาว) + element ทั้งหมด + 1 (ตัวปิด) · array ใช้เลขลำดับเป็นชื่อ key
 *   - element: 1 (ชนิด) + ชื่อ key เป็น UTF-8 + 1 + ค่า
 *   - ข้อความ 4 + UTF-8 + 1 · จำนวนเต็มในช่วง int32 4 · ตัวเลขอื่น (double) 8 · bigint 8 · Date 8 · boolean 1
 *   - null และ undefined 0 (undefined ถูกเขียนเป็น null) · function และ symbol ไม่ถูกเขียนเลย
 *   - Buffer/Uint8Array 4 + 1 (subtype) + ความยาว
 *   - object อื่นที่ไม่ใช่ข้างบน วัดแบบเอกสารจาก property ของมันเอง (แบบที่ driver เขียน)
 * ชนิดที่เอกสารของเราไม่มี (ObjectId, Decimal128, RegExp …) วัดแบบ object — ขนาดอาจคลาดได้ แต่ไม่มีใครส่งมา
 */
export function bsonSize(value: unknown): number {
  return documentSize(value, 0);
}

/** ลึกเกินนี้ Mongo เองก็ไม่รับ (เพดาน 100 ชั้น) — นับเป็น 0 เพื่อไม่ให้ค่าที่วนกลับหาตัวเองทำให้ stack ล้น */
const DEPTH_MAX = 120;

function documentSize(value: unknown, depth: number): number {
  let size = 4 + 1;
  if (depth > DEPTH_MAX || value === null || typeof value !== "object") return size;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) size += elementSize(String(i), value[i], depth + 1);
    return size;
  }
  for (const [key, child] of Object.entries(value)) size += elementSize(key, child, depth + 1);
  return size;
}

function elementSize(key: string, value: unknown, depth: number): number {
  if (typeof value === "function" || typeof value === "symbol") return 0;
  return 1 + Buffer.byteLength(key) + 1 + valueSize(value, depth);
}

const INT32_MIN = -0x80000000;
const INT32_MAX = 0x7fffffff;

function valueSize(value: unknown, depth: number): number {
  switch (typeof value) {
    case "string":
      return 4 + Buffer.byteLength(value) + 1;
    case "number":
      return Number.isInteger(value) && value >= INT32_MIN && value <= INT32_MAX ? 4 : 8;
    case "bigint":
      return 8;
    case "boolean":
      return 1;
    case "undefined":
      return 0;
    case "object":
      if (value === null) return 0;
      if (value instanceof Date) return 8;
      if (value instanceof Uint8Array) return 4 + 1 + value.byteLength;
      return documentSize(value, depth);
    default:
      return 0;
  }
}
