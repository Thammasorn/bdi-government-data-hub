import { z } from "zod";

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
