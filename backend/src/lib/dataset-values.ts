/**
 * ข้อมูลคำขอลงทะเบียนชุดข้อมูล -> ค่าของ placeholder ในแบบนำส่งข้อมูล (A4)
 *
 * ต่างจาก lib/legal-values.ts ที่ทำหน้าเดียวกันให้เส้นทางลงทะเบียนหน่วยงาน — เอกสาร
 * คนละฉบับดึงข้อมูลคนละชุด ตัวเลขและวันที่ยังเป็นเลขไทยและ พ.ศ. เหมือนกัน
 *
 * **ช่องติ๊ก** เป็นของใหม่ที่เส้นทางนี้ต้องใช้: A4 เป็นแบบฟอร์มกระดาษที่มีตัวเลือกให้กา
 * ทุกตัวเลือกยังพิมพ์ออกมาครบ ข้อที่ตรงกับคำขอได้ ✔ ข้อที่ไม่ตรงได้ ☐ ผู้อ่านจึงเห็นว่า
 * ตัวเลือกอื่นมีอะไรและไม่ได้เลือกอะไร ซึ่งเป็นสิ่งที่แบบฟอร์มกระดาษสื่อ
 */
import { TICK_FIELDS } from "./document-render.js";
import { splitTags, type MetadataValues } from "./dataset.js";
import { thaiLongDate, thaiLongDateTime, thaiNumerals } from "./legal-values.js";

/**
 * ✔ ติ๊กแล้ว · ☐ ยังไม่ติ๊ก
 *
 * TH SarabunPSK **ไม่มี** อักขระสองตัวนี้ ตัวแปลงจึงต้องไปหยิบจากฟอนต์อื่นตามลำดับของ
 * fontconfig — ซึ่งเป็นเหตุผลที่ image ของตัวแปลงตัดฟอนต์อีโมจิสีออก (ดู
 * gotenberg/fontconfig/99-no-colour-emoji.conf) ทั้งคู่จึงมาจาก DejaVu Sans สูงพอดี
 * บรรทัดเท่ากับข้อความรอบข้าง
 *
 * ทำไม ✔ (U+2714) ไม่ใช่ ✓ (U+2713): ✓ ตกไปที่ DejaVu Math ที่วาดสูง 68pt บนบรรทัด
 * 18.6pt ส่วน ✔ อยู่ใน DejaVu Sans ตรง ๆ — วัดจากไฟล์ที่แปลงออกมาจริง 2026-08-20
 */
const TICKED = "✔";
const UNTICKED = "☐";

export interface DatasetDocumentInput extends MetadataValues {
  requestNumber: string | null;
  organizationName: string | null;

  /** ลงนามฝ่ายหน่วยงาน — จาก signature_confirmation ที่บันทึกไว้ ไม่ใช่คำนวณสด */
  approverSignedName: string | null;
  approverSignedAt: Date | null;
  /** ลงนามฝ่ายสำนักงาน (BDI) */
  bdiSignedName: string | null;
  bdiSignedFirstName: string | null;
  bdiSignedLastName: string | null;
  bdiSignedAt: Date | null;

  submittedAt: Date | null;
  approvedAt: Date | null;
  printedByName: string | null;
  printedAt: Date;

  /** เวอร์ชันของเอกสารฉบับที่กำลัง render — ดูคำอธิบายใน lib/legal-values.ts */
  documentVersionNumber: number | null;
  documentEffectiveAt: Date | null;
}

/**
 * ค่าของช่องติ๊กทุกช่อง
 *
 * เดินจาก TICK_FIELDS ไม่ใช่จากสิ่งที่ template ใช้ — ช่องที่ template ไม่ได้ใช้ก็สร้างค่าไว้
 * เฉย ๆ ไม่เสียหาย แต่ช่องที่ template ใช้แล้วเราไม่ได้สร้างจะกลายเป็นค่าว่าง ซึ่งอ่านเหมือน
 * "ไม่ได้เลือก" ทั้งที่จริงคือระบบลืมส่งค่ามา
 */
function tickValues(metadata: MetadataValues): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [field, codes] of Object.entries(TICK_FIELDS)) {
    const raw = (metadata as unknown as Record<string, unknown>)[field];
    // boolean เก็บเป็น true/false ส่วน code list เก็บเป็นสตริงรหัส
    const selected = raw === null || raw === undefined ? null : String(raw);
    for (const code of codes) {
      out[`tick.${field}.${code}`] = selected === code ? TICKED : UNTICKED;
    }
  }
  return out;
}

export function datasetDocumentValues(input: DatasetDocumentInput): Record<string, string> {
  const date = (d: Date | null) => (d ? thaiLongDate(d) : "");
  const num = (n: number | null) => (n === null || n === undefined ? "" : thaiNumerals(String(n)));

  return {
    ...tickValues(input),

    // ── ชุดข้อมูล ──
    "dataset.title": input.title ?? "",
    "dataset.nameEn": input.name ?? "",
    "dataset.maintainer": input.maintainer ?? "",
    "dataset.maintainerEmail": input.maintainerEmail ?? "",
    "dataset.tags": splitTags(input.tagString).join(" · "),
    "dataset.notes": input.notes ?? "",
    "dataset.objective": input.objective ?? "",
    "dataset.dataSource": input.dataSource ?? "",
    "dataset.dataTopicOther": input.dataTopicOther ?? "",
    "dataset.dataFormatOther": input.dataFormatOther ?? "",
    "dataset.updateFrequencyInterval": num(input.updateFrequencyInterval),
    "dataset.personalDataTypes": input.personalDataTypes ?? "",
    "dataset.dataSubjectCategories": input.dataSubjectCategories ?? "",
    "dataset.personalDataPeriodYear": num(input.personalDataProcessingPeriodYear),
    "dataset.personalDataPeriodMonth": num(input.personalDataProcessingPeriodMonth),
    "dataset.requestNumber": input.requestNumber ?? "",

    // ── หน่วยงานเจ้าของชุดข้อมูล ──
    "org.name": input.organizationName ?? "",

    // ── คำขอ ──
    requestNumber: input.requestNumber ?? "",
    "request.submittedDate": date(input.submittedAt),
    "request.approvedDate": date(input.approvedAt),

    // ── ลายมือชื่อ ──
    // A4 ที่ฝ่ายกฎหมายร่างมาไม่มีช่องลงนาม (ตัดสินไว้ 2026-08-20 ว่าไม่เพิ่มให้)
    // ค่าพวกนี้จึงยังไม่มี template ไหนใช้ แต่สร้างไว้เพื่อให้เพิ่มช่องลงนามในเอกสาร
    // ได้ทันทีโดยไม่ต้องแก้โค้ด — หลักฐานการลงนามอยู่ในฐานข้อมูลอยู่แล้ว
    "org_approver.signature": input.approverSignedName ?? "",
    "org_approver.signedDate": date(input.approverSignedAt),
    "bdi_approver.signature": input.bdiSignedName ?? "",
    "bdi_approver.firstName": input.bdiSignedFirstName ?? "",
    "bdi_approver.lastName": input.bdiSignedLastName ?? "",
    "bdi_approver.signedDate": date(input.bdiSignedAt),
    "bdi_approver.endorsement": input.bdiSignedAt ? "เห็นชอบ\n" : "",

    // ── ตัวเอกสารเอง ──
    "document.version":
      input.documentVersionNumber === null ? "" : thaiNumerals(String(input.documentVersionNumber)),
    "document.effectiveDate": date(input.documentEffectiveAt),

    // ── ระบบ ──
    "system.name": "ระบบกลางเพื่อการแบ่งปันข้อมูล (Government Datahub Platform)",
    printedBy: input.printedByName ?? "",
    printedAt: thaiLongDate(input.printedAt),
    printedDateTime: thaiLongDateTime(input.printedAt),
  };
}
