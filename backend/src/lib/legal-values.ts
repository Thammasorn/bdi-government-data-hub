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

/** ข้อมูลที่เอกสาร A0 ต้องใช้ — structural type ไม่ผูกกับ Prisma model */
export interface AgreementInput {
  requestNumber: string | null;

  name: string | null;
  addressLine: string | null;
  road: string | null;
  province: string | null;
  district: string | null;
  subdistrict: string | null;
  postalCode: string | null;
  email: string | null;

  signatoryPrefix: string | null;
  signatoryFirstName: string | null;
  signatoryLastName: string | null;
  signatoryPosition: string | null;
  signatoryNationalId: string | null;

  /** วันที่ที่ถือเป็นวันทำข้อตกลง — วันที่นำส่งคำขอ ถ้ายังไม่นำส่งใช้วันนี้ */
  agreementDate: Date;

  /** ลงนามฝ่ายหน่วยงาน — มาจาก signature_confirmation ที่บันทึกไว้ ไม่ใช่คำนวณสด */
  approverSignedName: string | null;
  approverSignedAt: Date | null;

  /** ลงนามฝ่ายสำนักงาน (BDI) พร้อมตราเห็นชอบ */
  bdiSignedName: string | null;
  bdiSignedAt: Date | null;

  /** คนที่กดสร้างเอกสารครั้งนี้ */
  printedByName: string | null;
  printedAt: Date;
}

export const SYSTEM_NAME = "ระบบกลางเพื่อการแบ่งปันข้อมูล (Government Datahub Platform)";

/** ข้อความในตราเห็นชอบของสำนักงาน — เก็บเป็นค่าคงที่เพราะต้องตรงกันทุกฉบับ */
export const ENDORSEMENT_TEXT = "เห็นชอบ";

export function agreementValues(input: AgreementInput): TemplateValues {
  const { day, month, year } = bangkokParts(input.agreementDate);

  return {
    "agreement.day": thaiNumerals(String(day)),
    "agreement.month": thaiMonth(month),
    "agreement.year": thaiNumerals(String(year + 543)),

    "org.name": input.name ?? "",
    "org.addressNo": input.addressLine ?? "",
    /**
     * ฟอร์มลงทะเบียนมีช่อง "ถนน" แยกจากที่อยู่ตั้งแต่ 2026-08-19 เพราะ A0 แยกช่องไว้
     * ตามแบบฟอร์มราชการ ยังว่างได้ตามความจริง — ที่อยู่ราชการหลายแห่งไม่มีชื่อถนน
     */
    "org.road": input.road ?? "",
    "org.subdistrict": input.subdistrict ?? "",
    "org.district": input.district ?? "",
    "org.province": input.province ?? "",
    "org.postalCode": thaiNumerals(input.postalCode ?? ""),
    "org.email": input.email ?? "",

    "signatory.fullName": fullName(
      input.signatoryPrefix,
      input.signatoryFirstName,
      input.signatoryLastName,
    ),
    "signatory.position": input.signatoryPosition ?? "",
    "signatory.nationalId": thaiNumerals(formatNationalId(input.signatoryNationalId)),

    "approver.signature": input.approverSignedName ?? "",
    "approver.signedDate": input.approverSignedAt ? thaiLongDate(input.approverSignedAt) : "",

    "bdi.signature": input.bdiSignedName ?? "",
    "bdi.signedDate": input.bdiSignedAt ? thaiLongDate(input.bdiSignedAt) : "",
    // \n กลายเป็นการขึ้นบรรทัดจริงใน Word (docxtemplater ตั้ง linebreaks: true)
    // ตราจึงอยู่บรรทัดเหนือบรรทัดลงนามในช่องเดียวกันของตาราง
    "bdi.endorsement": input.bdiSignedAt ? `${ENDORSEMENT_TEXT}\n` : "",

    "system.name": SYSTEM_NAME,
    requestNumber: input.requestNumber ?? "",
    printedBy: input.printedByName ?? "",
    printedAt: thaiLongDate(input.printedAt),
  };
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
