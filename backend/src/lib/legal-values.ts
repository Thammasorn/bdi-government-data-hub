/**
 * ข้อมูลคำขอลงทะเบียนหน่วยงาน -> ค่าของ placeholder ในเอกสารกฎหมาย
 *
 * เอกสารเป็นภาษาราชการ ตัวเลขในเอกสารราชการไทยเขียนด้วยเลขไทย และปีเป็น พ.ศ.
 * `template A0` เองก็ตั้ง page number เป็น thaiNumbers ไว้ จึงเดินตามนั้นทั้งฉบับ
 *
 * ค่าที่ยังไม่เกิดขึ้น (ลายมือชื่อที่ยังไม่มีใครลงนาม) ถูกส่งเป็นค่าว่างโดยตั้งใจ
 * ไม่ใช่ขีดเส้นหรือ "-" — ช่องลายมือชื่อที่ว่างคือสิ่งที่บอกว่ายังไม่มีการลงนาม
 */
import type { TemplateValues } from "./document-render.js";

const THAI_DIGITS = ["๐", "๑", "๒", "๓", "๔", "๕", "๖", "๗", "๘", "๙"];

const thaiMonth = (month: number) => THAI_MONTHS[month - 1] ?? "";

const THAI_MONTHS = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
];

/** เลขอาหรับทุกตัวในสตริง -> เลขไทย ตัวอักษรอื่นไม่แตะ */
export function thaiNumerals(value: string): string {
  return value.replace(/[0-9]/g, (d) => THAI_DIGITS[Number(d)] ?? d);
}

/** วัน เดือน ปี พ.ศ. แยกช่อง เพราะ template มีสามช่องแยกกัน */
function bangkokParts(date: Date) {
  // เขียนเวลาเป็นเขตเวลาไทยเสมอ ไม่ใช่ UTC — เอกสารลงวันที่ผิดวันได้ถ้าลงนามดึก ๆ
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return { day: get("day"), month: get("month"), year: get("year") };
}

/** เช่น "๑๙ สิงหาคม ๒๕๖๙" — รูปแบบวันที่ในเอกสารราชการ */
export function thaiLongDate(date: Date): string {
  const { day, month, year } = bangkokParts(date);
  return `${thaiNumerals(String(day))} ${thaiMonth(month)} ${thaiNumerals(String(year + 543))}`;
}

/**
 * ข้อมูลที่เอกสารต้องใช้ — structural type ไม่ผูกกับ Prisma model
 *
 * กว้างกว่าที่ A0 ใช้โดยตั้งใจ เพราะเอกสารฉบับต่อไปหยิบข้อมูลชุดอื่นไปใช้ได้ทันที
 * ทุกช่องมาจาก toApiShape() ของคำขอ ยกเว้นลายมือชื่อกับข้อมูลสำนักงานที่ระบุไว้ข้างล่าง
 */
export interface AgreementInput {
  requestNumber: string | null;

  organizationCode: string | null;
  name: string | null;
  nameEn: string | null;
  organizationType: string | null;
  addressLine: string | null;
  road: string | null;
  province: string | null;
  district: string | null;
  subdistrict: string | null;
  postalCode: string | null;
  phone: string | null;
  email: string | null;
  websiteUrl: string | null;

  signatoryPrefix: string | null;
  signatoryFirstName: string | null;
  signatoryLastName: string | null;
  signatoryPosition: string | null;
  signatoryDepartment: string | null;
  signatoryEmail: string | null;
  signatoryPhone: string | null;
  signatoryNationalId: string | null;

  contactPrefix: string | null;
  contactFirstName: string | null;
  contactLastName: string | null;
  contactPosition: string | null;
  contactDepartment: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  contactNationalId: string | null;

  /** วันที่ที่ถือเป็นวันทำข้อตกลง — วันที่นำส่งคำขอ ถ้ายังไม่นำส่งใช้วันนี้ */
  agreementDate: Date;
  submittedAt: Date | null;
  approvedAt: Date | null;

  /** ลงนามฝ่ายหน่วยงาน — มาจาก signature_confirmation ที่บันทึกไว้ ไม่ใช่คำนวณสด */
  approverSignedName: string | null;
  approverSignedAt: Date | null;

  /** ลงนามฝ่ายสำนักงาน (BDI) พร้อมตราเห็นชอบ */
  bdiSignedName: string | null;
  bdiSignedAt: Date | null;

  /** ข้อมูลสำนักงานจากตาราง organization ของ BDI — ว่างได้ถ้ายังไม่ได้บันทึก */
  officeName: string | null;
  officeEmail: string | null;
  officePhone: string | null;

  /** คนที่กดสร้างเอกสารครั้งนี้ */
  printedByName: string | null;
  printedAt: Date;
}

export const SYSTEM_NAME = "ระบบกลางเพื่อการแบ่งปันข้อมูล (Government Datahub Platform)";

/**
 * ข้อมูลสำนักงานที่ไม่มีช่องเก็บในฐานข้อมูล
 *
 * ที่อยู่และชื่อผู้อำนวยการถูกคัดมาจากตัวเนื้อความของ A0 เอง ซึ่งเป็นแหล่งที่เชื่อถือได้ที่สุด
 * ที่มีอยู่ **ต้องแก้ที่นี่เมื่อย้ายที่ทำการหรือเปลี่ยนผู้อำนวยการ** — ตาราง organization
 * ของ BDI ไม่มีคอลัมน์สำหรับชื่อผู้อำนวยการ และแถวนั้นยังไม่ได้กรอกที่อยู่ไว้
 * (ถ้าวันหนึ่งกรอกแล้ว ค่าจากฐานข้อมูลจะถูกใช้ก่อนค่าตั้งต้นนี้)
 */
export const OFFICE_DEFAULTS = {
  name: "สถาบันข้อมูลขนาดใหญ่ (องค์การมหาชน)",
  address:
    "234/432 ซอยลาดพร้าว 12 ถนนลาดพร้าว แขวงจอมพล เขตจตุจักร กรุงเทพมหานคร 10900",
  directorName: "ศาสตราจารย์ธีรณี อจลากุล",
  directorPosition: "ผู้อำนวยการสถาบันข้อมูลขนาดใหญ่",
} as const;

/** ข้อความในตราเห็นชอบของสำนักงาน — เก็บเป็นค่าคงที่เพราะต้องตรงกันทุกฉบับ */
export const ENDORSEMENT_TEXT = "เห็นชอบ";

export function agreementValues(input: AgreementInput): TemplateValues {
  const { day, month, year } = bangkokParts(input.agreementDate);
  const date = (d: Date | null) => (d ? thaiLongDate(d) : "");

  return {
    // ── วันที่ทำข้อตกลง ──
    "agreement.day": thaiNumerals(String(day)),
    "agreement.month": thaiMonth(month),
    "agreement.year": thaiNumerals(String(year + 543)),
    "agreement.date": thaiLongDate(input.agreementDate),

    // ── คำขอ ──
    requestNumber: input.requestNumber ?? "",
    "request.submittedDate": date(input.submittedAt),
    "request.approvedDate": date(input.approvedAt),

    // ── หน่วยงาน ──
    "org.name": input.name ?? "",
    "org.nameEn": input.nameEn ?? "",
    "org.code": input.organizationCode ?? "",
    "org.type": input.organizationType ?? "",
    "org.addressNo": input.addressLine ?? "",
    "org.road": input.road ?? "",
    "org.subdistrict": input.subdistrict ?? "",
    "org.district": input.district ?? "",
    "org.province": input.province ?? "",
    "org.postalCode": thaiNumerals(input.postalCode ?? ""),
    "org.address": organizationAddress(input),
    "org.phone": thaiNumerals(input.phone ?? ""),
    "org.email": input.email ?? "",
    "org.website": input.websiteUrl ?? "",

    // ── ผู้มีอำนาจกระทำการแทน ──
    "signatory.fullName": fullName(
      input.signatoryPrefix,
      input.signatoryFirstName,
      input.signatoryLastName,
    ),
    "signatory.prefix": input.signatoryPrefix ?? "",
    "signatory.firstName": input.signatoryFirstName ?? "",
    "signatory.lastName": input.signatoryLastName ?? "",
    "signatory.position": input.signatoryPosition ?? "",
    "signatory.department": input.signatoryDepartment ?? "",
    "signatory.email": input.signatoryEmail ?? "",
    "signatory.phone": thaiNumerals(input.signatoryPhone ?? ""),
    "signatory.nationalId": thaiNumerals(formatNationalId(input.signatoryNationalId)),

    // ── ผู้กรอกข้อมูล ──
    "contact.fullName": fullName(
      input.contactPrefix,
      input.contactFirstName,
      input.contactLastName,
    ),
    "contact.prefix": input.contactPrefix ?? "",
    "contact.firstName": input.contactFirstName ?? "",
    "contact.lastName": input.contactLastName ?? "",
    "contact.position": input.contactPosition ?? "",
    "contact.department": input.contactDepartment ?? "",
    "contact.email": input.contactEmail ?? "",
    "contact.phone": thaiNumerals(input.contactPhone ?? ""),
    "contact.nationalId": thaiNumerals(formatNationalId(input.contactNationalId)),

    // ── ลายมือชื่อ ──
    "approver.signature": input.approverSignedName ?? "",
    "approver.signedDate": date(input.approverSignedAt),
    "bdi.signature": input.bdiSignedName ?? "",
    "bdi.signedDate": date(input.bdiSignedAt),
    // \n กลายเป็นการขึ้นบรรทัดจริงใน Word (docxtemplater ตั้ง linebreaks: true)
    // ตราจึงอยู่บรรทัดเหนือบรรทัดลงนามในช่องเดียวกันของตาราง
    "bdi.endorsement": input.bdiSignedAt ? `${ENDORSEMENT_TEXT}\n` : "",

    // ── สำนักงาน ──
    "office.name": input.officeName || OFFICE_DEFAULTS.name,
    "office.address": OFFICE_DEFAULTS.address,
    "office.email": input.officeEmail ?? "",
    "office.phone": thaiNumerals(input.officePhone ?? ""),
    "office.directorName": OFFICE_DEFAULTS.directorName,
    "office.directorPosition": OFFICE_DEFAULTS.directorPosition,

    // ── ระบบ ──
    "system.name": SYSTEM_NAME,
    printedBy: input.printedByName ?? "",
    printedAt: thaiLongDate(input.printedAt),
  };
}

/** ที่อยู่หน่วยงานทั้งบรรทัด สำหรับเอกสารที่มีช่องที่อยู่ช่องเดียว */
function organizationAddress(input: AgreementInput): string {
  return [
    input.addressLine,
    input.road ? `ถนน${input.road}` : null,
    input.subdistrict ? `ตำบล/แขวง${input.subdistrict}` : null,
    input.district ? `อำเภอ/เขต${input.district}` : null,
    input.province ? `จังหวัด${input.province}` : null,
    thaiNumerals(input.postalCode ?? "") || null,
  ]
    .filter(Boolean)
    .join(" ");
}

function fullName(prefix?: string | null, first?: string | null, last?: string | null): string {
  return [prefix, first, last].filter(Boolean).join(" ").trim();
}

function formatNationalId(id?: string | null): string {
  if (!id) return "";
  const d = id.replace(/\D/g, "");
  if (d.length !== 13) return id;
  return `${d[0]}-${d.slice(1, 5)}-${d.slice(5, 10)}-${d.slice(10, 12)}-${d[12]}`;
}
