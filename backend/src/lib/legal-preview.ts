/**
 * ตัวอย่างเอกสารกฎหมายสำหรับหน้า /console — "ก่อน render" และ "หลัง render"
 *
 * ผู้ดูแลต้องเห็นว่าไฟล์ที่กำลังจะเผยแพร่หน้าตาเป็นอย่างไรเมื่อระบบเติมข้อมูลจริงลงไป **ก่อน**กดยืนยัน เพราะเวอร์ชันที่เผยแพร่แล้วมีหน่วยงาน
 * นำส่งทับทันที (card "Enhance Legal document management" ข้อ 4–5)
 *
 * - `raw`      แปลงไฟล์ตามที่อัปโหลดเป็น PDF เลย ไม่เติมอะไร เห็น `{{org.name}}` ตามที่ผู้เขียนพิมพ์
 * - `rendered` เติมข้อมูลตัวอย่างข้างล่างแล้วไฮไลต์เหลืองเฉพาะส่วนที่ระบบเติม
 *
 * **ข้อมูลตัวอย่างเป็นของสมมติทั้งหมด** — หน่วยงาน ผู้ลงนาม เลขบัตร และชุดข้อมูลไม่มีตัวตนจริง เขียนให้อ่านเป็นทางการเพราะเป็นระบบของราชการ
 * และตั้งใจให้เห็นชัดว่าเป็นตัวอย่าง ("ตัวอย่าง") ไม่ใช่ชื่อของหน่วยงานจริงที่ใครอาจเข้าใจว่าเป็นผู้ลงนามเอกสารฉบับนั้น ค่าเป็นค่าคงที่ ไม่ใช้วันที่ปัจจุบัน
 * เพื่อให้เปรียบเทียบภาพสองรอบได้
 */
import { EMPTY_METADATA, type MetadataValues } from "./dataset.js";
import { datasetDocumentValues, type DatasetDocumentInput } from "./dataset-values.js";
import { docxToPdf, fillTemplate, tickFields } from "./document-render.js";
import { agreementValues, type AgreementInput } from "./legal-values.js";
import { LEGAL_SCOPES, type LegalScope } from "./legal.js";

export type PreviewMode = "raw" | "rendered";

/** วันที่ตัวอย่าง (เวลาไทย) */
const SAMPLE_SUBMITTED = new Date("2026-09-15T03:30:00.000Z");
const SAMPLE_APPROVER_SIGNED = new Date("2026-09-18T07:15:00.000Z");
const SAMPLE_BDI_SIGNED = new Date("2026-09-22T08:40:00.000Z");
const SAMPLE_PRINTED = new Date("2026-09-22T09:00:00.000Z");
const SAMPLE_EFFECTIVE = new Date("2026-09-01T00:00:00.000Z");

export const SAMPLE_ORGANIZATION: AgreementInput = {
  requestNumber: "ORG-2569-0001",

  organizationCode: "EX-0001",
  name: "กรมตัวอย่างการบริหารข้อมูลภาครัฐ",
  nameEn: "Example Department of Public Data Administration",
  organizationType: "หน่วยงานของรัฐ",
  addressLine: "99 อาคารตัวอย่าง ชั้น 5",
  road: "ถนนราชดำเนินกลาง",
  province: "กรุงเทพมหานคร",
  // ชื่อเปล่า ไม่มีคำนำหน้า — template พิมพ์ "แขวง/เขต" ให้เอง เหมือนข้อมูลจริงในตารางจังหวัด/อำเภอ/ตำบล
  district: "พระนคร",
  subdistrict: "บวรนิเวศ",
  postalCode: "10200",
  phone: "022000000",
  phoneExtension: "1234",
  email: "saraban@example-agency.go.th",
  websiteUrl: "https://www.example-agency.go.th",

  signatoryPrefix: "นาย",
  signatoryFirstName: "สมชาย",
  signatoryLastName: "ตัวอย่างดี",
  signatoryPosition: "อธิบดีกรมตัวอย่างการบริหารข้อมูลภาครัฐ",
  signatoryDepartment: "สำนักงานอธิบดี",
  signatoryEmail: "somchai.t@example-agency.go.th",
  signatoryPhone: "022000001",
  signatoryPhoneExtension: "100",
  signatoryNationalId: "1100000000001",

  contactPrefix: "นางสาว",
  contactFirstName: "สมหญิง",
  contactLastName: "ตัวอย่างมั่นคง",
  contactPosition: "นักวิเคราะห์นโยบายและแผนชำนาญการ",
  contactDepartment: "กองแผนงานและสารสนเทศ",
  contactEmail: "somying.t@example-agency.go.th",
  contactPhone: "022000002",
  contactPhoneExtension: "201",
  contactNationalId: "1100000000002",

  agreementDate: SAMPLE_SUBMITTED,
  submittedAt: SAMPLE_SUBMITTED,
  approvedAt: SAMPLE_BDI_SIGNED,

  approverSignedName: "นาย สมชาย ตัวอย่างดี",
  approverSignedAt: SAMPLE_APPROVER_SIGNED,

  bdiSignedName: "ศาสตราจารย์ตัวอย่าง ผู้อำนวยการ",
  bdiSignedFirstName: "ตัวอย่าง",
  bdiSignedLastName: "ผู้อำนวยการ",
  bdiSignedAt: SAMPLE_BDI_SIGNED,

  officeName: "สถาบันข้อมูลขนาดใหญ่ (องค์การมหาชน)",
  officeEmail: "contact@example-bdi.or.th",
  officePhone: "020000000",
  officePhoneExtension: null,

  printedByName: "นางสาว สมหญิง ตัวอย่างมั่นคง",
  printedAt: SAMPLE_PRINTED,

  documentVersionNumber: 1,
  documentEffectiveAt: SAMPLE_EFFECTIVE,
};

/** ช่องติ๊กทุกช่องเลือกตัวเลือกแรกของรายการ — ให้เห็นทั้ง ✔ และ ○ ในแต่ละกลุ่ม */
function sampleChoices(): Partial<Record<keyof MetadataValues, string>> {
  const out: Record<string, string> = {};
  for (const [field, codes] of Object.entries(tickFields())) {
    if (codes[0] !== undefined) out[field] = codes[0];
  }
  return out;
}

export function sampleDataset(): DatasetDocumentInput {
  return {
    ...EMPTY_METADATA,
    ...(sampleChoices() as Partial<MetadataValues>),
    title: "ข้อมูลตัวอย่างสถิติการให้บริการประชาชน",
    name: "example-public-service-statistics",
    dataFields: "รหัสหน่วยบริการ, ประเภทบริการ, จำนวนผู้ใช้บริการ, เดือนที่ให้บริการ",
    maintainer: "นางสาว สมหญิง ตัวอย่างมั่นคง",
    maintainerEmail: "somying.t@example-agency.go.th",
    tagString: "สถิติ, บริการประชาชน, ข้อมูลเปิด",
    notes: "ชุดข้อมูลตัวอย่างสำหรับแสดงการเติมค่าลงในเอกสาร ไม่ใช่ข้อมูลจริง",
    objective: "01",
    objectiveOther: null,
    updateFrequencyInterval: 1,
    personalDataProcessingPeriodYear: 1,
    personalDataProcessingPeriodMonth: 6,
    dataSource: "ระบบงานบริการประชาชนของกรมตัวอย่างการบริหารข้อมูลภาครัฐ",

    requestNumber: "DS-2569-0001",
    organizationName: SAMPLE_ORGANIZATION.name,

    approverSignedName: SAMPLE_ORGANIZATION.approverSignedName,
    approverSignedAt: SAMPLE_APPROVER_SIGNED,
    bdiSignedName: SAMPLE_ORGANIZATION.bdiSignedName,
    bdiSignedFirstName: SAMPLE_ORGANIZATION.bdiSignedFirstName,
    bdiSignedLastName: SAMPLE_ORGANIZATION.bdiSignedLastName,
    bdiSignedAt: SAMPLE_BDI_SIGNED,

    submittedAt: SAMPLE_SUBMITTED,
    approvedAt: SAMPLE_BDI_SIGNED,
    printedByName: SAMPLE_ORGANIZATION.printedByName,
    printedAt: SAMPLE_PRINTED,

    documentVersionNumber: 1,
    documentEffectiveAt: SAMPLE_EFFECTIVE,
  };
}

/**
 * PDF ตัวอย่างของ .docx หนึ่งไฟล์ — `scope` กำหนดชุดข้อมูลตัวอย่าง (ข้อมูลหน่วยงาน หรือ ชุดข้อมูล) ตรงกับที่ upload ตรวจชื่อตัวแปร
 */
export async function previewPdf(
  docx: Buffer,
  scope: LegalScope,
  mode: PreviewMode,
  filename: string,
): Promise<Buffer> {
  if (mode === "raw") return docxToPdf(docx, filename);

  const values =
    scope === LEGAL_SCOPES.DATASET_REGISTRATION
      ? datasetDocumentValues(sampleDataset())
      : agreementValues(SAMPLE_ORGANIZATION);
  return docxToPdf(fillTemplate(docx, values, { highlight: true }), filename);
}
