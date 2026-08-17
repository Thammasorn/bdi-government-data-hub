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

/**
 * ตรวจ snapshot ของคำขอ โดยให้ช่องที่ยังไม่ได้กรอก (`null`) มีความหมายเท่ากับ "กรอกค่าว่าง"
 *
 * ช่องที่ผู้ใช้ยังไม่ได้กรอกเป็น `null` ในฐานข้อมูล ซึ่ง zod ปฏิเสธด้วยข้อความของ
 * **ชนิดข้อมูล** — `Invalid input: expected string, received null` — เป็นภาษาอังกฤษ
 * และไปแทนที่ข้อความ `min(1, "กรุณากรอก…")` ที่เขียนเตรียมไว้ทุกช่อง ผลคือผู้ใช้กด
 * "ตรวจสอบและสร้าง PDF" บนฟอร์มที่ยังว่าง แล้วเห็นข้อความ zod ภาษาอังกฤษใต้ทุกช่อง
 * ทั้งที่ข้อความไทยมีอยู่แล้ว (ผิดทั้งข้อกำหนดเรื่องภาษา และไม่ได้บอกว่าต้องแก้อะไร)
 *
 * ทำโดยตรวจหนึ่งรอบก่อน แล้วแทนค่าว่างเฉพาะช่องที่ **schema บอกเองว่าต้องการสตริง**
 * แล้วตรวจใหม่ — ไม่ใช่แทนทุกช่องที่เป็น null: ช่องตัวเลขอย่าง `updateFrequencyInterval`
 * รับ null ได้อยู่แล้วตามดีไซน์ การยัดสตริงว่างให้มันกลับสร้างข้อความอังกฤษอีกอัน
 * (`expected number, received string`) ขึ้นมาแทน
 */
export function parseRequestSnapshot<Schema extends z.ZodType>(
  schema: Schema,
  value: Record<string, unknown>,
) {
  const first = schema.safeParse(value);
  if (first.success) return first;

  const blanks = first.error.issues
    .filter(
      (issue) =>
        issue.code === "invalid_type" &&
        issue.expected === "string" &&
        issue.path.length === 1 &&
        value[String(issue.path[0])] === null,
    )
    .map((issue) => String(issue.path[0]));
  if (blanks.length === 0) return first;

  return schema.safeParse({ ...value, ...Object.fromEntries(blanks.map((k) => [k, ""])) });
}

/** ข้อความแสดงข้อผิดพลาดแบบ field -> message ให้ frontend ผูกกับช่องกรอกได้ตรง ๆ */
export function formatZodError(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    if (!fields[key]) fields[key] = issue.message;
  }
  return fields;
}
