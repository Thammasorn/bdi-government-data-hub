/**
 * กฎการตรวจข้อมูลของฟอร์มลงทะเบียนหน่วยงาน — **ฉบับคัดลอกของฝั่งหน้าเว็บ**
 *
 * เป็นการทำซ้ำโดยตั้งใจ แบบเดียวกับ `frontend/lib/dataset-form.ts`: ฟอร์มต้องบอกได้
 * ทันทีที่ผู้ใช้พิมพ์ว่ารูปแบบยังไม่ถูก จึงถามฝั่ง API ทุกตัวอักษรไม่ได้ ตัวตัดสินจริง
 * ยังเป็น `submitSchema` ใน `backend/src/routes/organizations.ts` กับ
 * `backend/src/lib/validation.ts` ซึ่งตรวจซ้ำทุกครั้งก่อนเขียน — ไฟล์นี้ล้าสมัยจึงเป็น
 * บั๊กของหน้าจอ ไม่ใช่บั๊กของข้อมูล **แก้ทั้งสองฝั่งพร้อมกันเสมอ**
 *
 * ข้อความทุกอันบอกวิธีแก้ ไม่ใช่แค่บอกว่าผิด (ข้อกำหนดใน `docs/02-ui-spec.md` §5)
 * และเป็นข้อความเดียวกับที่ API ตอบกลับมา เพื่อไม่ให้ช่องเดียวกันพูดคนละอย่างสองรอบ
 */

/** เท่ากับ MAX_ADDRESS_LINE ใน backend/src/routes/organizations.ts และคอลัมน์ VARCHAR(2000) */
export const MAX_ADDRESS_LINE = 2000;

export const MAX_ORGANIZATION_NAME = 200;

/** ช่วง U+0E01–U+0E5B คือบล็อกภาษาไทยทั้งบล็อก */
export function containsThai(value: string): boolean {
  return /[ก-๛]/.test(value);
}

/**
 * เบอร์ไทยในรูปตัวเลขล้วน — คืน null ถ้าอ่านเป็นเบอร์ไม่ได้
 * รับขีด เว้นวรรค วงเล็บ และ +66 เหมือนฝั่ง API
 */
export function normaliseThaiPhone(value: string): string | null {
  const trimmed = value.trim();
  if (!/^[+\d\s().-]+$/.test(trimmed)) return null;

  const digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+66") || digits.startsWith("66")) {
    const national = digits.replace(/^66/, "");
    return national ? `0${national}` : null;
  }
  return digits;
}

/** มือถือ 10 หลัก 06/08/09 หรือเบอร์ประจำที่ 9 หลัก 0 ตามด้วยรหัสพื้นที่ 2–7 */
export function isValidThaiPhone(value: string): boolean {
  const digits = normaliseThaiPhone(value);
  if (!digits) return false;
  if (!/^0[689]\d{8}$/.test(digits) && !/^0[2-7]\d{7}$/.test(digits)) return false;
  return !/^0(\d)\1+$/.test(digits);
}

/** เลขบัตรประชาชน 13 หลัก หลักสุดท้ายเป็น check digit */
export function isValidThaiNationalId(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  if (digits.length !== 13) return false;
  if (/^(\d)\1{12}$/.test(digits)) return false;

  let sum = 0;
  for (let i = 0; i < 12; i += 1) sum += Number(digits[i]) * (13 - i);
  return (11 - (sum % 11)) % 10 === Number(digits[12]);
}

/**
 * รูปแบบอีเมลอย่างหยาบ — ตัวตัดสินคือ zod ฝั่ง API
 *
 * ตั้งใจให้หลวมกว่าฝั่ง API เล็กน้อย: ฟอร์มที่ปฏิเสธอีเมลที่ API รับได้คือฟอร์มที่พัง
 * ส่วนอีเมลที่ฟอร์มปล่อยผ่านแล้ว API ปฏิเสธ ยังจบด้วยข้อความใต้ช่องเดิมตอนกดปุ่ม
 */
export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());
}

export const PHONE_MESSAGE =
  "เบอร์โทรศัพท์ไม่ถูกต้อง — มือถือ 10 หลักขึ้นต้นด้วย 06 08 หรือ 09 (เช่น 0812345678) เบอร์ที่ทำงาน 9 หลักขึ้นต้นด้วย 0 ตามด้วยรหัสพื้นที่ (เช่น 021234567)";

export interface OrganizationFormValues {
  organizationCode: string;
  name: string;
  addressLine: string;
  road: string;
  province: string;
  district: string;
  subdistrict: string;
  postalCode: string;
  email: string;
  signatoryPrefix: string;
  signatoryFirstName: string;
  signatoryLastName: string;
  signatoryPosition: string;
  signatoryEmail: string;
  signatoryNationalId: string;
  signatoryPhone: string;
  contactPrefix: string;
  contactFirstName: string;
  contactLastName: string;
  contactPosition: string;
  contactDepartment: string;
  contactEmail: string;
  contactPhone: string;
}

export type OrganizationFormField = keyof OrganizationFormValues;

const required = (value: string, message: string) => (value.trim() ? null : message);

/**
 * ตรวจช่องเดียว — คืนข้อความไทยที่บอกวิธีแก้ หรือ null ถ้าผ่าน
 *
 * รับทั้งฟอร์มมาด้วย เพราะบางกฎเป็นกฎข้ามช่อง (อีเมลหน่วยงานกับอีเมลผู้มีอำนาจ
 * กระทำการแทนต้องไม่ซ้ำกัน) การเรียกทีละช่องโดยไม่รู้ช่องอื่นจึงไม่พอ
 *
 * `organizationCode` ไม่มีกฎที่นี่โดยตั้งใจ — เป็นช่องอ่านอย่างเดียว ผู้ใช้แก้ไม่ได้
 * และฝั่ง API ปฏิเสธค่าที่ต่างจากเดิม
 */
export function validateOrganizationField(
  field: OrganizationFormField,
  values: OrganizationFormValues,
): string | null {
  const value = values[field] ?? "";
  const trimmed = value.trim();

  switch (field) {
    case "organizationCode":
      return null;

    case "name": {
      const empty = required(value, "กรุณากรอกชื่อหน่วยงาน");
      if (empty) return empty;
      if (trimmed.length < 3) return "ชื่อหน่วยงานต้องมีอย่างน้อย 3 ตัวอักษร";
      if (trimmed.length > MAX_ORGANIZATION_NAME)
        return `ชื่อหน่วยงานต้องไม่เกิน ${MAX_ORGANIZATION_NAME} ตัวอักษร`;
      if (!containsThai(trimmed))
        return "ชื่อหน่วยงานต้องมีภาษาไทย (มีภาษาอังกฤษปนได้ เช่น สำนักงานสถิติแห่งชาติ (NSO))";
      return null;
    }

    case "addressLine": {
      const empty = required(value, "กรุณากรอกที่อยู่");
      if (empty) return empty;
      if (trimmed.length > MAX_ADDRESS_LINE)
        return `ที่อยู่ต้องไม่เกิน ${MAX_ADDRESS_LINE} ตัวอักษร`;
      return null;
    }

    // ถนนไม่บังคับ — ที่อยู่ราชการหลายแห่งใช้หมู่ที่แทนชื่อถนน
    case "road":
      return trimmed.length > 255 ? "ชื่อถนนต้องไม่เกิน 255 ตัวอักษร" : null;

    case "province":
      return required(value, "กรุณาเลือกจังหวัด");
    case "district":
      return required(value, "กรุณาเลือกอำเภอ/เขต");
    case "subdistrict":
      return required(value, "กรุณาเลือกตำบล/แขวง");

    case "postalCode": {
      const empty = required(value, "กรุณากรอกรหัสไปรษณีย์");
      if (empty) return empty;
      return /^\d{5}$/.test(trimmed) ? null : "รหัสไปรษณีย์ต้องเป็นตัวเลข 5 หลัก";
    }

    case "email": {
      const empty = required(value, "กรุณากรอกอีเมล");
      if (empty) return empty;
      if (!isValidEmail(trimmed)) return "รูปแบบอีเมลไม่ถูกต้อง";
      // กฎเดียวกับ submitSchema.superRefine() ฝั่ง API
      if (trimmed.toLowerCase() === values.signatoryEmail.trim().toLowerCase())
        return "อีเมลหน่วยงานต้องไม่ใช่อีเมลเดียวกับผู้มีอำนาจกระทำการแทน กรุณากรอกอีเมลกลางของหน่วยงาน";
      return null;
    }

    case "signatoryEmail":
    case "contactEmail": {
      const empty = required(value, "กรุณากรอกอีเมล");
      if (empty) return empty;
      return isValidEmail(trimmed) ? null : "รูปแบบอีเมลไม่ถูกต้อง";
    }

    case "signatoryNationalId": {
      const empty = required(value, "กรุณากรอกเลขบัตรประชาชน");
      if (empty) return empty;
      if (trimmed.replace(/\D/g, "").length !== 13) return "เลขบัตรประชาชนต้องมี 13 หลัก";
      return isValidThaiNationalId(trimmed)
        ? null
        : "เลขบัตรประชาชนไม่ถูกต้อง กรุณาตรวจสอบตัวเลขอีกครั้ง";
    }

    case "signatoryPhone":
    case "contactPhone": {
      const empty = required(value, "กรุณากรอกเบอร์โทรศัพท์");
      if (empty) return empty;
      return isValidThaiPhone(trimmed) ? null : PHONE_MESSAGE;
    }

    case "signatoryPrefix":
    case "contactPrefix":
      return required(value, "กรุณาเลือกคำนำหน้า");
    case "signatoryFirstName":
    case "contactFirstName":
      return required(value, "กรุณากรอกชื่อ");
    case "signatoryLastName":
    case "contactLastName":
      return required(value, "กรุณากรอกนามสกุล");
    case "signatoryPosition":
    case "contactPosition":
      return required(value, "กรุณากรอกตำแหน่ง");
    case "contactDepartment":
      return required(value, "กรุณากรอกฝ่าย/กอง/สำนัก");

    default:
      return null;
  }
}

/**
 * ตรวจทั้งฟอร์มทีเดียว — ใช้ทั้งกับแถบความคืบหน้าและกับการกันไม่ให้กดสร้าง PDF
 *
 * อีเมลหน่วยงานขึ้นกับอีเมลผู้มีอำนาจกระทำการแทน การตรวจทีละช่องตอนที่ค่านั้นเปลี่ยน
 * จึงไม่พอ — ต้องคิดใหม่ทั้งชุดทุกครั้งที่ฟอร์มเปลี่ยน
 */
export function validateOrganizationForm(
  values: OrganizationFormValues,
): Partial<Record<OrganizationFormField, string>> {
  const errors: Partial<Record<OrganizationFormField, string>> = {};
  for (const field of Object.keys(values) as OrganizationFormField[]) {
    const message = validateOrganizationField(field, values);
    if (message) errors[field] = message;
  }
  return errors;
}
