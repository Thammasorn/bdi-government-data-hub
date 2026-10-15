/**
 * ฟอร์มลงทะเบียนหน่วยงาน — schema ของฉบับร่าง และการแปลงเป็นคอลัมน์ snapshot
 *
 * อยู่ที่นี่ไม่ใช่ใน `routes/organizations.ts` เพราะมีผู้ใช้สองทาง: ฟอร์มของหน่วยงานเอง
 * (`PATCH /api/organizations/:id`) กับเส้นทางของผู้ดูแลระบบ
 * (`PUT /api/admin/registrations/organizations/:id`) การคัดลอกตารางชื่อฟิลด์ไปไว้อีกที่
 * แปลว่าคอลัมน์ที่เพิ่มทีหลังจะไหลลงทางเดียวแล้วเงียบหายไปอีกทาง — ปัญหาเดียวกับที่
 * `materialiseDataset()` เลี่ยงด้วยการคัดลอกทั้งแถวแทนการไล่เขียนทีละช่อง
 *
 * **ที่นี่ไม่ตัดสินว่าใครแก้ช่องไหนได้** กฎล็อก (รหัสหน่วยงาน · ส่วนผู้ดำเนินการ ·
 * อีเมลกับเลขบัตรของผู้มีอำนาจฯ ที่เปิดใช้งานบัญชีแล้ว) เป็นของผู้เรียกแต่ละทาง
 * และทั้งสองทางตั้งใจให้ไม่เหมือนกัน
 */
import { z } from "zod";

import { prisma } from "../db.js";
import { lookupZipcode, resolveAddressCodes } from "./address.js";
import { draftEmailSchema, normaliseThaiPhone, phoneExtensionSchema } from "./validation.js";

/**
 * ความยาวสูงสุดของช่องที่อยู่
 *
 * เดิม schema จำกัดไว้ 300 ตัวอักษรทั้งที่คอลัมน์รับได้ 500 — ที่อยู่ราชการเต็มรูปแบบ
 * (ชื่ออาคาร ชั้น เลขห้อง ซอย แขวง พร้อมวงเล็บอธิบายทางเข้า) ชนเพดานนั้นได้จริง และ
 * เพดานฝั่ง schema ทำให้ผู้ใช้เจอ error ทั้งที่คอลัมน์ยังว่างอยู่อีกมาก ตอนนี้ทั้ง
 * schema และคอลัมน์เป็น 2000 เท่ากัน (migration 20260829120000_widen_address_line)
 * ค่านี้ถูกคัดลอกไว้ที่ frontend/lib/organization-form.ts ด้วย — แก้พร้อมกันเสมอ
 */
export const MAX_ADDRESS_LINE = 2000;

/**
 * ตอนบันทึกร่างยอมให้ว่างได้ ตอนนำส่งต้องครบ — จึงแยกเป็นสองชุด
 *
 * ชื่อฟิลด์ฝั่ง API ยังเป็นชุดเดิม (name / signatory* / contact*) เพื่อไม่ให้ frontend
 * ต้องแก้ทั้งฟอร์ม การแปลงไปเป็นคอลัมน์ snapshot ของดีไซน์ (organization_name_th /
 * approver_* / user_*) เกิดที่ toRequestData() ข้างล่าง
 */
export const organizationDraftSchema = z.object({
  /**
   * รหัสหน่วยงาน — **อ่านอย่างเดียว** รับมาเพื่อเทียบว่าตรงกับของเดิมเท่านั้น
   *
   * ค่านี้ไม่ได้ถูกแปลงลง snapshot ที่ toRequestData() อีกแล้ว ฟอร์มจึงเขียนทับไม่ได้
   * แม้จะส่งมา — ดู assertOrganizationCodeUnchanged() ว่าทำไมถึงตอบ 400 แทนที่จะ
   * เงียบ ๆ เมื่อค่าที่ส่งมาไม่ตรงกับของเดิม
   */
  organizationCode: z.string().trim().max(64).optional(),
  name: z.string().trim().max(200).optional(),
  nameEn: z.string().trim().max(200).optional(),
  organizationType: z.string().trim().max(64).optional(),
  addressLine: z.string().trim().max(MAX_ADDRESS_LINE).optional(),
  road: z.string().trim().max(255).optional(),
  province: z.string().trim().optional(),
  district: z.string().trim().optional(),
  subdistrict: z.string().trim().optional(),
  postalCode: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  /**
   * เลขต่อตรวจตั้งแต่บันทึกร่าง ไม่รอถึงตอนนำส่งแบบช่องอื่น — กฎมันสั้น (ตัวเลขล้วน) และ
   * ค่าที่ผิดกฎเป็นค่าที่เก็บไว้ก็ไม่มีประโยชน์ ต่างจากเบอร์ที่ค่าครึ่ง ๆ กลาง ๆ ยังเป็นร่างได้
   * ค่าว่างผ่านและกลายเป็น null: ผู้ใช้ลบเลขต่อออกแล้วบันทึก ต้องลบออกจากคอลัมน์จริง ๆ
   */
  phoneExtension: phoneExtensionSchema,
  email: draftEmailSchema,
  websiteUrl: z.string().trim().max(500).optional(),

  signatoryPrefix: z.string().trim().optional(),
  signatoryFirstName: z.string().trim().optional(),
  signatoryLastName: z.string().trim().optional(),
  signatoryPosition: z.string().trim().optional(),
  signatoryEmail: draftEmailSchema,
  signatoryNationalId: z.string().trim().optional(),
  signatoryPhone: z.string().trim().optional(),
  signatoryPhoneExtension: phoneExtensionSchema,
  signatoryDepartment: z.string().trim().optional(),

  contactPrefix: z.string().trim().optional(),
  contactFirstName: z.string().trim().optional(),
  contactLastName: z.string().trim().optional(),
  contactPosition: z.string().trim().optional(),
  contactDepartment: z.string().trim().optional(),
  contactEmail: draftEmailSchema,
  contactPhone: z.string().trim().optional(),
  contactPhoneExtension: phoneExtensionSchema,
  contactNationalId: z.string().trim().optional(),
});


/**
 * เก็บเบอร์ในรูปตัวเลขล้วนเสมอ ไม่ว่าผู้ใช้จะพิมพ์ขีดหรือ +66 มา
 *
 * เบอร์เดียวกันที่เก็บคนละรูปทำให้ค้นไม่เจอและพิมพ์ลงเอกสาร A0 ไม่เหมือนกันสองใบ
 * ค่าที่อ่านเป็นเบอร์ไม่ได้เลยปล่อยผ่านตามเดิม เพื่อให้ตอนนำส่ง phoneSchema เป็นคน
 * บอกว่าผิดตรงไหน แทนที่จะกลายเป็นค่าว่างเงียบ ๆ ระหว่างบันทึกร่าง
 */
function draftPhone(value?: string): string | undefined {
  return value ? (normaliseThaiPhone(value) ?? value) : value;
}

/** คอลัมน์ที่ `toRequestData()` เขียนจากช่องอีเมล (`draftEmailSchema`) และจากช่องเบอร์ (`draftPhone()`) */
const EMAIL_COLUMNS = new Set(["organizationEmail", "approverEmail", "userEmail"]);
const PHONE_COLUMNS = new Set(["organizationPhone", "approverPhoneNumber", "userPhoneNumber"]);

/**
 * ค่าเดิมในคอลัมน์ snapshot ถ้าส่งกลับมาทางฟอร์มนี้ จะถูกเขียนลงไปเป็นอะไร
 *
 * ทุกช่องใน `organizationDraftSchema` ถูกตัดช่องว่างหัวท้าย อีเมลเป็นตัวพิมพ์เล็ก และเบอร์เป็น
 * ตัวเลขล้วน — ใช้ตัวแปลงตัวเดียวกันกับทางเขียน (`draftEmailSchema` · `draftPhone()`) ไม่ได้เขียน
 * กฎซ้ำ แก้การแปลงของช่องไหนเมื่อไร ถ้าช่องนั้นไม่ได้ผ่านสองตัวนี้ ต้องเพิ่มที่นี่ด้วย
 */
function asDraftWouldStore(column: string, value: unknown): unknown {
  if (typeof value !== "string") return value;
  if (EMAIL_COLUMNS.has(column)) return draftEmailSchema.parse(value);
  const trimmed = value.trim();
  return PHONE_COLUMNS.has(column) ? draftPhone(trimmed) : trimmed;
}

/**
 * ช่องนี้เปลี่ยนแค่รูป ไม่ได้เปลี่ยนค่า — ค่าเดิมผ่านการแปลงของฟอร์มแล้วได้ค่าที่เขียนลงพอดี
 *
 * ใช้แยกแถว audit ของการบันทึกร่าง: ร่างที่เก็บไว้ก่อนมีการแปลง (อีเมลตัวพิมพ์ใหญ่ก่อน 2026-09-18 ·
 * เบอร์มีขีดก่อน 2026-08-29) ถูกหน้าจอแสดงตามที่เก็บ ส่งกลับมาตามนั้น แล้ว route เขียนลงในรูปใหม่
 * ช่องนั้นจึงเปลี่ยนในตารางจริงโดยที่ผู้กรอกไม่ได้แตะ ผู้กรอกที่พิมพ์ค่าเดิมใหม่ต่างกันแค่ตัวพิมพ์
 * หรือขีดก็ได้ผลเดียวกันทุกประการ และนับเป็นกลุ่มนี้ด้วย — ความหมายของค่าไม่ได้เปลี่ยน
 *
 * `""` เท่ากับ null เหมือน `blankAsNull()` ที่ใช้ก่อน diff
 */
export function changedOnlyInForm(column: string, before: unknown, after: unknown): boolean {
  const blank = (v: unknown) => (v === "" || v === undefined ? null : v);
  return JSON.stringify(blank(asDraftWouldStore(column, before))) === JSON.stringify(blank(after));
}

/** แปลงชื่อฟิลด์ฝั่ง API เป็นคอลัมน์ snapshot ตามดีไซน์ */
export type OrganizationDraftInput = z.infer<typeof organizationDraftSchema>;

export async function toRequestData(input: OrganizationDraftInput) {
  const codes = await resolveAddressCodes(prisma, input);

  const postalCode =
    input.postalCode ||
    (input.province && input.district && input.subdistrict
      ? (lookupZipcode(input.province, input.district, input.subdistrict) ?? undefined)
      : undefined);

  return {
    /**
     * ไม่มี organizationCode ที่นี่โดยตั้งใจ — รหัสหน่วยงานแก้ผ่านฟอร์มไม่ได้
     * ค่าที่ถูกต้องมาจากแถว organization เท่านั้น (prefillFromOrganization ตอนเปิดคำขอ
     * หรือ nextOrganizationCode ตอนสร้างหน่วยงานใหม่)
     */
    organizationType: input.organizationType,
    organizationNameTh: input.name,
    organizationNameEn: input.nameEn,
    organizationAddressLine: input.addressLine,
    organizationRoad: input.road,
    organizationProvinceCode: codes.provinceCode,
    organizationDistrictCode: codes.districtCode,
    organizationSubdistrictCode: codes.subDistrictCode,
    organizationPostalCode: postalCode,
    organizationPhone: draftPhone(input.phone),
    // phoneExtensionSchema แปลง "" เป็น null ให้แล้ว — undefined (ไม่ได้ส่งมา) คงค่าเดิมไว้
    organizationPhoneExtension: input.phoneExtension,
    organizationEmail: input.email,
    organizationWebsite: input.websiteUrl,

    approverPrefixTh: input.signatoryPrefix,
    approverFirstnameTh: input.signatoryFirstName,
    approverLastnameTh: input.signatoryLastName,
    approverPositionTh: input.signatoryPosition,
    approverEmail: input.signatoryEmail,
    approverCid: input.signatoryNationalId,
    approverPhoneNumber: draftPhone(input.signatoryPhone),
    approverPhoneNumberExtension: input.signatoryPhoneExtension,
    approverDepartmentTh: input.signatoryDepartment,

    userPrefixTh: input.contactPrefix,
    userFirstnameTh: input.contactFirstName,
    userLastnameTh: input.contactLastName,
    userPositionTh: input.contactPosition,
    userDepartmentTh: input.contactDepartment,
    userEmail: input.contactEmail,
    userPhoneNumber: draftPhone(input.contactPhone),
    userPhoneNumberExtension: input.contactPhoneExtension,
    userCid: input.contactNationalId,
  };
}

