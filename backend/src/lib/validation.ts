import { z } from "zod";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * ทุก id ที่รับมาจาก path เป็น UUID
 *
 * Postgres โยน error ถ้าเทียบคอลัมน์ uuid กับข้อความที่ไม่ใช่ UUID — ปล่อยให้ค่าที่
 * ไม่ใช่ UUID ไหลไปถึง Prisma จะได้ 500 ทั้งที่ความหมายจริงคือ "ไม่พบ"
 */
export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/**
 * เลขบัตรประชาชนไทย 13 หลัก — หลักสุดท้ายเป็น check digit
 * นำ 12 หลักแรกคูณน้ำหนัก 13..2 รวมกัน แล้ว (11 - ผลรวม % 11) % 10
 */
export function isValidThaiNationalId(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  if (digits.length !== 13) return false;
  // เลขซ้ำทั้ง 13 ตัวผ่าน checksum ได้ แต่ไม่มีอยู่จริง
  if (/^(\d)\1{12}$/.test(digits)) return false;

  let sum = 0;
  for (let i = 0; i < 12; i += 1) {
    sum += Number(digits[i]) * (13 - i);
  }
  const check = (11 - (sum % 11)) % 10;
  return check === Number(digits[12]);
}

/** เบอร์ไทย: มือถือ 0X-XXXX-XXXX หรือเบอร์บ้าน 0X-XXX-XXXX */
export function isValidThaiPhone(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  return /^0\d{8,9}$/.test(digits);
}

export const emailSchema = z
  .string()
  .trim()
  .min(1, "กรุณากรอกอีเมล")
  .email("รูปแบบอีเมลไม่ถูกต้อง")
  .transform((v) => v.toLowerCase());

export const phoneSchema = z
  .string()
  .trim()
  .refine(isValidThaiPhone, "เบอร์โทรศัพท์ไม่ถูกต้อง กรุณากรอกเลข 9–10 หลักขึ้นต้นด้วย 0");

export const nationalIdSchema = z
  .string()
  .trim()
  .refine(isValidThaiNationalId, "เลขบัตรประชาชนไม่ถูกต้อง");

/**
 * id ที่อ้างถึงแถวอื่นและรับมาทาง body
 *
 * ข้อความของ zod เองคือ `Invalid UUID` — เป็นภาษาอังกฤษ และไม่บอกว่าต้องแก้อะไร
 * ค่าที่ผิดบ่อยที่สุดคือ **สตริงว่าง** จากตัวแปรใน script/Postman ที่ยังไม่ได้เติมค่า
 * จึงต้องเขียนให้ชัดว่าค่าว่างไม่เท่ากับไม่ส่งฟิลด์
 *
 * ไม่ปล่อยให้ค่าว่างนับเป็น "ไม่ส่ง" เพราะฟิลด์เหล่านี้เป็นแบบ optional ที่มีความหมาย
 * ต่างกันสองทาง — `POST /api/admin/invitations` ที่ไม่ส่ง organizationId จะสร้าง
 * หน่วยงานเปล่าให้ใบใหม่ ถ้ายอมรับค่าว่างเป็นเหมือนไม่ส่ง คำเชิญที่ตั้งใจผูกกับ
 * หน่วยงานที่เตรียมไว้จะไปสร้างหน่วยงานใหม่เงียบ ๆ แทนที่จะฟ้องว่าตัวแปรไม่มีค่า
 */
export function uuidSchema(message: string) {
  return z.string().trim().uuid(message);
}

export const passwordSchema = z
  .string()
  .min(8, "รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร")
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), "รหัสผ่านต้องมีทั้งตัวอักษรและตัวเลข");

/** ข้อความแสดงข้อผิดพลาดแบบ field -> message ให้ frontend ผูกกับช่องกรอกได้ตรง ๆ */
export function formatZodError(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    if (!fields[key]) fields[key] = issue.message;
  }
  return fields;
}
