/**
 * ข้อมูลคำขอลงทะเบียนชุดข้อมูล -> ค่าของ placeholder ในแบบนำส่งข้อมูล (A4)
 *
 * ต่างจาก lib/legal-values.ts ที่ทำหน้าเดียวกันให้เส้นทางลงทะเบียนหน่วยงาน — เอกสาร
 * คนละฉบับดึงข้อมูลคนละชุด แต่ใช้ตัวจัดรูปแบบวันที่ชุดเดียวกัน — พ.ศ. และเลขอารบิก
 *
 * **ช่องติ๊ก** เป็นของใหม่ที่เส้นทางนี้ต้องใช้: A4 เป็นแบบฟอร์มกระดาษที่มีตัวเลือกให้กา
 * ทุกตัวเลือกยังพิมพ์ออกมาครบ ข้อที่ตรงกับคำขอได้ ✔ ข้อที่ไม่ตรงได้ ☐ ผู้อ่านจึงเห็นว่า
 * ตัวเลือกอื่นมีอะไรและไม่ได้เลือกอะไร ซึ่งเป็นสิ่งที่แบบฟอร์มกระดาษสื่อ
 */
import { SYSTEM_NAME, TICK_FIELDS } from "./document-render.js";
import { splitTags, type MetadataValues } from "./dataset.js";
import { thaiLongDate, thaiLongDateTime } from "./legal-values.js";

/**
 * ✔ เลือกข้อนี้ · ○ ไม่ได้เลือก
 *
 * **ช่องว่างเป็นวงกลม แต่ข้อที่เลือกเป็นเครื่องหมายถูก ไม่ใช่วงกลมถมดำ** (BDI 2026-09-10)
 * รูปแบบเดียวกับของเดิมที่เป็น ☐ กับ ✔ เปลี่ยนแค่รูปช่องว่างจากสี่เหลี่ยมเป็นวงกลมให้ตรงกับ
 * แบบฟอร์มกระดาษที่ฝ่ายกฎหมายร่างมา (bullet วงกลมของ Word) — วงกลมถมดำที่ลองใช้เมื่อ
 * 2026-09-09 อ่านเป็น "จุด" มากกว่า "ติ๊กแล้ว"
 *
 * TH SarabunPSK **ไม่มี** อักขระสองตัวนี้ ตัวแปลงจึงต้องไปหยิบจากฟอนต์อื่น — ซึ่งเป็นเหตุผล
 * ที่ image ของตัวแปลงตัดฟอนต์อีโมจิสีออก (ดู gotenberg/fontconfig/99-no-colour-emoji.conf)
 *
 * **ฟอนต์ของเครื่องหมายถูกกำหนดไว้ที่ template ไม่ใช่ที่นี่** — `build-a4-template.py` ใส่
 * เครื่องหมายลงใน run ของตัวเองที่ระบุ DejaVu Sans กับขนาดตายตัว เพราะตอนปล่อยให้
 * fontconfig เลือกเอง บางบรรทัดไปได้ Tahoma บางบรรทัดได้ DejaVu Sans วงกลมจึงโตไม่เท่ากัน
 * ทั้งหน้า (BDI แจ้ง 2026-09-10 — เห็นได้จาก `pdffonts` ที่ลิสต์ทั้งสองฟอนต์)
 *
 * เรื่องขนาดคืออันตรายจริง ไม่ใช่ความกังวลลอย ๆ — ✓ (U+2713) เคยตกไปที่ DejaVu Math ที่วาด
 * สูง 68pt บนบรรทัด 18.6pt จึงต้องเลือก ✔ (U+2714) แทนเมื่อ 2026-08-20
 * **เปลี่ยนอักขระเมื่อไร ต้องวัดจาก PDF จริงใหม่ทุกครั้ง**
 */
const TICKED = "✔";
const UNTICKED = "○";

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
  const num = (n: number | null) => (n === null || n === undefined ? "" : String(n));

  return {
    ...tickValues(input),

    // ── ชุดข้อมูล ──
    "dataset.title": input.title ?? "",
    "dataset.nameEn": input.name ?? "",
    "dataset.dataFields": input.dataFields ?? "",
    "dataset.maintainer": input.maintainer ?? "",
    "dataset.maintainerEmail": input.maintainerEmail ?? "",
    "dataset.tags": splitTags(input.tagString).join(" · "),
    "dataset.notes": input.notes ?? "",
    "dataset.objective": input.objective ?? "",
    "dataset.dataSource": input.dataSource ?? "",
    "dataset.dataTopicOther": input.dataTopicOther ?? "",
    "dataset.dataFormatOther": input.dataFormatOther ?? "",
    "dataset.geoCoverageOther": input.geoCoverageOther ?? "",
    "dataset.transformedSharingPlatforms":
      input.allowTransformedRawDataSharingSpecifiedPlatforms ?? "",
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
      input.documentVersionNumber === null ? "" : String(input.documentVersionNumber),
    "document.effectiveDate": date(input.documentEffectiveAt),

    // ── ระบบ ──
    "system.name": SYSTEM_NAME,
    printedBy: input.printedByName ?? "",
    printedAt: thaiLongDate(input.printedAt),
    printedDateTime: thaiLongDateTime(input.printedAt),
  };
}
