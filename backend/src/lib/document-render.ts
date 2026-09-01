/**
 * เติมข้อมูลลง template .docx แล้วแปลงเป็น PDF
 *
 * ทำไมต้องเดินทาง .docx -> LibreOffice -> PDF แทนการวาดเอกสารเองด้วยโค้ด:
 *
 * 1. **เอกสารกฎหมายต้องแก้ได้โดยไม่แก้โค้ด** A0–A3 เป็นเอกสารที่ฝ่ายกฎหมาย BDI เป็น
 *    เจ้าของ ไม่ใช่ทีมพัฒนา เขาแก้ใน Word แล้วอัปโหลดเวอร์ชันใหม่เข้าระบบ ถ้าเนื้อความ
 *    อยู่ในโค้ด ทุกการแก้ถ้อยคำจะกลายเป็นงาน deploy
 * 2. **เลย์เอาต์ต้องไม่เปลี่ยน** LibreOffice จัดหน้าจากไฟล์ต้นฉบับ ฟอนต์ ระยะ ย่อหน้า
 *    และการตัดบรรทัดจึงเป็นของ template เอง ไม่ใช่สิ่งที่เราพยายามเลียนแบบ
 * 3. **ค่าที่เติมต้องไหลไปกับข้อความ** ชื่อหน่วยงานยาว ๆ ดันบรรทัดถัดไปเองตามที่ควรเป็น
 *    วิธี "วาดข้อความทับ PDF ตามพิกัด" ทำข้อนี้ไม่ได้ และพิกัดจะใช้ไม่ได้ทันทีที่มีคน
 *    อัปโหลด template ใหม่ — ซึ่งเป็นสิ่งที่ข้อ 1 บอกว่าจะเกิดขึ้นเป็นปกติ
 *
 * ตัวแปลงคือ gotenberg (LibreOffice ที่ห่อด้วย HTTP API) เป็นบริการแยกใน compose
 * เรียก soffice ตรง ๆ จาก process นี้ก็ได้ แต่ต้องจัดการ user profile ที่ชนกันเมื่อมี
 * หลาย request พร้อมกัน กับ process ที่ค้างเอง
 */
import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";

import {
  DATA_CATEGORY_LABELS,
  DATA_CLASSIFICATION_LABELS,
  DATA_FORMAT_LABELS,
  DATA_TOPIC_LABELS,
  DATA_TYPE_LABELS,
  DELIVERY_FREQUENCY_LABELS,
  GEO_COVERAGE_LABELS,
  LICENSE_LABELS,
  PERSONAL_DATA_PERIOD_LABELS,
  UPDATE_FREQUENCY_UNIT_LABELS,
} from "./dataset.js";
import { env } from "../env.js";

/** `{{ }}` ไม่ใช่ `{ }` ของ docxtemplater — วงเล็บเดี่ยวชนกับข้อความในเอกสารกฎหมายเอง */
const DELIMITERS = { start: "{{", end: "}}" } as const;

const PLACEHOLDER = /\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g;

export class DocumentRenderError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 500,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
  }
}

/** กลุ่มของตัวแปร ใช้จัดหมวดในเอกสารคู่มือและในผลลัพธ์ของ API */
export const VARIABLE_GROUPS = {
  agreement: "วันที่ทำข้อตกลง",
  dataset: "ชุดข้อมูลที่ขอลงทะเบียน",
  tick: "ช่องติ๊กตามตัวเลือกในแบบฟอร์ม",
  request: "คำขอลงทะเบียน",
  org: "หน่วยงานที่ลงทะเบียน",
  org_approver: "ผู้มีอำนาจกระทำการแทนของหน่วยงาน",
  org_officer: "ผู้กรอกข้อมูลของหน่วยงาน",
  signature: "ลายมือชื่อและตราเห็นชอบ",
  bdi: "สำนักงาน (BDI)",
  document: "ตัวเอกสารและเวอร์ชัน",
  system: "ระบบและการพิมพ์เอกสาร",
} as const;

export type VariableGroup = keyof typeof VARIABLE_GROUPS;

/**
 * flow ที่ตัวแปรนี้มีค่าให้เติม
 *
 * เอกสารของเส้นทางลงทะเบียนหน่วยงานกับของเส้นทางลงทะเบียนชุดข้อมูลดึงข้อมูลคนละชุด
 * `{{org_approver.position}}` ไม่มีความหมายในแบบนำส่งข้อมูล และ `{{dataset.title}}` ไม่มี
 * ความหมายในข้อตกลง — ตรวจตอนอัปโหลดตาม scope ของเอกสาร จะได้รู้ตั้งแต่ตอนนั้น
 * ไม่ใช่ไปเจอช่องว่างเปล่าในเอกสารที่หน่วยงานลงนามแล้ว
 */
export type VariableScope = "both" | "organization" | "dataset";

export interface TemplateVariableSpec {
  group: VariableGroup;
  scope?: VariableScope;
  description: string;
  /** ตัวอย่างค่าที่ render ออกมา — ใช้ในคู่มือ ไม่ได้ใช้ตอน render */
  example: string;
}

/**
 * ชื่อตัวแปรทั้งหมดที่ template เรียกใช้ได้ — **สัญญาระหว่างเอกสารกับระบบ**
 *
 * นี่คือเส้นแบ่งของ "แก้ได้โดยไม่ต้องแก้โค้ด": ผู้ดูแลเอกสารย้าย ลบ หรือใช้ placeholder
 * ตัวไหนซ้ำกี่ที่ก็ได้ และเอกสารฉบับใหม่หยิบตัวไหนไปใช้ก็ได้จากรายการนี้ แต่การ
 * **เพิ่มชื่อใหม่**ต้องมีคนต่อค่าให้มันใน lib/legal-values.ts ก่อน
 *
 * ตอนอัปโหลด template ระบบตรวจชื่อทั้งหมดแล้วปฏิเสธถ้ามีตัวที่ไม่รู้จัก — ไม่ปล่อยให้ไป
 * โป๊ะตอน render ซึ่งเป็นอีกวันและอีกคน
 *
 * รายการนี้กว้างกว่าที่เอกสาร A0 ใช้โดยตั้งใจ เพราะเอกสารฉบับต่อไป (ผนวกที่ต้องเติมข้อมูล
 * หรือแบบฟอร์มอื่นของหน่วยงาน) จะหยิบข้อมูลชุดอื่นไปใช้ได้ทันทีโดยไม่ต้องแก้โค้ด
 * คู่มือสำหรับผู้เขียนเอกสารอยู่ที่ docs/18-document-template-variables.md
 */
export const TEMPLATE_VARIABLES = {
  // ── วันที่ทำข้อตกลง ────────────────────────────────────────────
  "agreement.day": { scope: "organization", group: "agreement", description: "วันที่ทำข้อตกลง (เลขไทย)", example: "๑๙" },
  "agreement.month": { scope: "organization", group: "agreement", description: "เดือนที่ทำข้อตกลง (ชื่อเดือนภาษาไทย)", example: "สิงหาคม" },
  "agreement.year": { scope: "organization", group: "agreement", description: "ปีที่ทำข้อตกลง (พ.ศ. เลขไทย)", example: "๒๕๖๙" },
  "agreement.date": { scope: "organization", group: "agreement", description: "วันที่ทำข้อตกลงแบบเต็ม สำหรับเอกสารที่มีช่องเดียว", example: "๑๙ สิงหาคม ๒๕๖๙" },

  // ── คำขอ ─────────────────────────────────────────────────────
  requestNumber: { group: "request", description: "เลขที่คำขอลงทะเบียนหน่วยงาน", example: "ORG-REG-2026-0009" },
  "request.submittedDate": { group: "request", description: "วันที่หน่วยงานนำส่งคำขอ — ว่างถ้ายังไม่นำส่ง", example: "๑๘ สิงหาคม ๒๕๖๙" },
  "request.approvedDate": { group: "request", description: "วันที่คำขอได้รับอนุมัติขั้นสุดท้าย — ว่างถ้ายังไม่อนุมัติ", example: "๑๙ สิงหาคม ๒๕๖๙" },

  // ── หน่วยงานที่ลงทะเบียน ────────────────────────────────────────
  "org.name": { group: "org", description: "ชื่อหน่วยงาน (ภาษาไทย)", example: "กรมส่งเสริมการปกครองท้องถิ่น" },
  "org.nameEn": { group: "org", description: "ชื่อหน่วยงาน (ภาษาอังกฤษ) — ว่างถ้าไม่ได้กรอก", example: "Department of Local Administration" },
  "org.code": { group: "org", description: "รหัสหน่วยงาน", example: "DLA" },
  "org.type": { group: "org", description: "ประเภทหน่วยงาน — เป็นรหัสภายในระบบ ไม่ใช่คำอ่านภาษาไทย", example: "GOVERNMENT_AGENCY" },
  "org.addressNo": { group: "org", description: "ที่อยู่หน่วยงาน ส่วนเลขที่/อาคาร/ซอย", example: "578" },
  "org.road": { group: "org", description: "ถนน — ว่างได้ ที่อยู่ราชการหลายแห่งไม่มีชื่อถนน", example: "ศรีจันทร์" },
  "org.subdistrict": { group: "org", description: "แขวง/ตำบล", example: "ในเมือง" },
  "org.district": { group: "org", description: "เขต/อำเภอ", example: "เมืองขอนแก่น" },
  "org.province": { group: "org", description: "จังหวัด", example: "ขอนแก่น" },
  "org.postalCode": { group: "org", description: "รหัสไปรษณีย์ (เลขไทย)", example: "๔๐๐๐๐" },
  "org.address": { group: "org", description: "ที่อยู่หน่วยงานทั้งบรรทัด ประกอบให้แล้ว สำหรับเอกสารที่มีช่องที่อยู่ช่องเดียว", example: "578 ถนนศรีจันทร์ ตำบลในเมือง อำเภอเมืองขอนแก่น จังหวัดขอนแก่น ๔๐๐๐๐" },
  "org.phone": { group: "org", description: "เบอร์โทรศัพท์หน่วยงาน", example: "๐๔๓๒๓๖๗๘๙" },
  "org.email": { group: "org", description: "อีเมลหน่วยงาน", example: "saraban@dla.go.th" },
  "org.website": { group: "org", description: "เว็บไซต์หน่วยงาน — ว่างถ้าไม่ได้กรอก", example: "https://www.dla.go.th" },

  // ── ผู้มีอำนาจกระทำการแทน ───────────────────────────────────────
  "org_approver.fullName": { scope: "organization", group: "org_approver", description: "ชื่อผู้มีอำนาจกระทำการแทน (คำนำหน้า ชื่อ นามสกุล)", example: "นาย อนุชา พัฒนา" },
  "org_approver.prefix": { scope: "organization", group: "org_approver", description: "คำนำหน้าชื่อผู้มีอำนาจกระทำการแทน", example: "นาย" },
  "org_approver.firstName": { scope: "organization", group: "org_approver", description: "ชื่อผู้มีอำนาจกระทำการแทน", example: "อนุชา" },
  "org_approver.lastName": { scope: "organization", group: "org_approver", description: "นามสกุลผู้มีอำนาจกระทำการแทน", example: "พัฒนา" },
  "org_approver.position": { scope: "organization", group: "org_approver", description: "ตำแหน่งผู้มีอำนาจกระทำการแทน", example: "ผู้อำนวยการ" },
  "org_approver.department": { scope: "organization", group: "org_approver", description: "ฝ่าย/กอง/สำนักของผู้มีอำนาจกระทำการแทน — ว่างถ้าไม่ได้กรอก", example: "สำนักบริหารกลาง" },
  "org_approver.email": { scope: "organization", group: "org_approver", description: "อีเมลผู้มีอำนาจกระทำการแทน", example: "director@dla.go.th" },
  "org_approver.phone": { scope: "organization", group: "org_approver", description: "เบอร์โทรศัพท์ผู้มีอำนาจกระทำการแทน", example: "๐๘๑๒๓๔๕๖๗๘" },
  "org_approver.nationalId": { scope: "organization", group: "org_approver", description: "เลขบัตรประชาชนผู้มีอำนาจกระทำการแทน (เลขไทย คั่นด้วยขีด)", example: "๑-๑๐๑๗-๐๐๒๐๗-๐๓-๐" },

  // ── ผู้กรอกข้อมูล ────────────────────────────────────────────
  "org_officer.fullName": { group: "org_officer", description: "ชื่อผู้กรอกข้อมูล (คำนำหน้า ชื่อ นามสกุล)", example: "นางสาว พิมพ์ชนก สังคมดี" },
  "org_officer.prefix": { group: "org_officer", description: "คำนำหน้าชื่อผู้กรอกข้อมูล", example: "นางสาว" },
  "org_officer.firstName": { group: "org_officer", description: "ชื่อผู้กรอกข้อมูล", example: "พิมพ์ชนก" },
  "org_officer.lastName": { group: "org_officer", description: "นามสกุลผู้กรอกข้อมูล", example: "สังคมดี" },
  "org_officer.position": { group: "org_officer", description: "ตำแหน่งผู้กรอกข้อมูล", example: "นักวิเคราะห์นโยบายและแผน" },
  "org_officer.department": { group: "org_officer", description: "ฝ่าย/กอง/สำนักของผู้กรอกข้อมูล", example: "กลุ่มงานข้อมูลสารสนเทศ" },
  "org_officer.email": { group: "org_officer", description: "อีเมลผู้กรอกข้อมูล", example: "user@dla.go.th" },
  "org_officer.phone": { group: "org_officer", description: "เบอร์โทรศัพท์ผู้กรอกข้อมูล", example: "๐๘๒๐๐๐๐๐๐๐" },
  "org_officer.nationalId": { group: "org_officer", description: "เลขบัตรประชาชนผู้กรอกข้อมูล (เลขไทย คั่นด้วยขีด)", example: "๑-๑๐๑๗-๐๐๒๐๗-๐๓-๐" },

  // ── ชุดข้อมูลที่ขอลงทะเบียน (เส้นทาง C) ──
  "dataset.title": { scope: "dataset", group: "dataset", description: "ชื่อชุดข้อมูล (ภาษาไทย)", example: "ปริมาณน้ำฝนรายวัน" },
  "dataset.nameEn": { scope: "dataset", group: "dataset", description: "ชื่อชุดข้อมูล (ภาษาอังกฤษ)", example: "Daily Rainfall" },
  "dataset.maintainer": { scope: "dataset", group: "dataset", description: "ชื่อผู้ติดต่อของชุดข้อมูล", example: "กลุ่มงานข้อมูลสารสนเทศ" },
  "dataset.maintainerEmail": { scope: "dataset", group: "dataset", description: "อีเมลผู้ติดต่อของชุดข้อมูล", example: "data@dla.go.th" },
  "dataset.tags": { scope: "dataset", group: "dataset", description: "คำสำคัญหรือคำค้น คั่นด้วยจุดกลาง", example: "น้ำฝน · อุทกภัย" },
  "dataset.notes": { scope: "dataset", group: "dataset", description: "รายละเอียดชุดข้อมูล", example: "ข้อมูลปริมาณน้ำฝนรายวันจากสถานีตรวจวัด" },
  "dataset.objective": { scope: "dataset", group: "dataset", description: "วัตถุประสงค์ของการนำส่งข้อมูล", example: "เพื่อการวิเคราะห์และเตือนภัย" },
  "dataset.dataSource": { scope: "dataset", group: "dataset", description: "แหล่งที่มาของข้อมูล", example: "สถานีตรวจวัดของกรม" },
  "dataset.dataTopicOther": { scope: "dataset", group: "dataset", description: "ประเด็นอื่น ๆ ที่ระบุเอง — ว่างถ้าไม่ได้เลือก \"อื่น ๆ\"", example: "การเกษตร" },
  "dataset.dataFormatOther": { scope: "dataset", group: "dataset", description: "ชื่อระบบเชื่อมโยงข้อมูลอื่น — ว่างถ้าไม่ได้เลือกข้อนั้น", example: "GDX" },
  "dataset.updateFrequencyInterval": { scope: "dataset", group: "dataset", description: "ค่าความถี่ของการปรับปรุงข้อมูลต้นทาง (เลขไทย)", example: "๑" },
  "dataset.personalDataTypes": { scope: "dataset", group: "dataset", description: "ประเภทของข้อมูลส่วนบุคคล — ว่างถ้าไม่มีข้อมูลส่วนบุคคล", example: "ชื่อ-นามสกุล, เลขบัตรประชาชน" },
  "dataset.dataSubjectCategories": { scope: "dataset", group: "dataset", description: "กลุ่มหรือประเภทของเจ้าของข้อมูลส่วนบุคคล", example: "ประชาชนผู้ขอรับบริการ" },
  "dataset.personalDataPeriodYear": { scope: "dataset", group: "dataset", description: "ระยะเวลาประมวลผลข้อมูลส่วนบุคคล จำนวนปี (เลขไทย)", example: "๕" },
  "dataset.personalDataPeriodMonth": { scope: "dataset", group: "dataset", description: "ระยะเวลาประมวลผลข้อมูลส่วนบุคคล จำนวนเดือน (เลขไทย)", example: "๖" },
  "dataset.requestNumber": { scope: "dataset", group: "dataset", description: "เลขที่คำขอลงทะเบียนชุดข้อมูล", example: "DS-REG-2026-0004" },

  // ── ลายมือชื่อ ──────────────────────────────────────────────
  "org_approver.signature": { group: "signature", description: "ลายมือชื่อฝ่ายหน่วยงาน — ว่างจนกว่าผู้มีอำนาจจะลงนาม", example: "นาย อนุชา พัฒนา" },
  "org_approver.signedDate": { group: "signature", description: "วันที่ฝ่ายหน่วยงานลงนาม — ว่างจนกว่าจะลงนาม", example: "๑๙ สิงหาคม ๒๕๖๙" },
  "bdi_approver.signature": { group: "signature", description: "ลายมือชื่อฝ่ายสำนักงาน — ว่างจนกว่าผู้อนุมัติ BDI จะลงนาม", example: "นาง สุดารัตน์ อนุมัติ" },
  "bdi_approver.signedDate": { group: "signature", description: "วันที่ฝ่ายสำนักงานลงนาม — ว่างจนกว่าจะลงนาม", example: "๑๙ สิงหาคม ๒๕๖๙" },
  "bdi_approver.firstName": { group: "signature", description: "ชื่อผู้ลงนามฝ่ายสำนักงาน (ไม่รวมคำนำหน้าและนามสกุล)", example: "สุดารัตน์" },
  "bdi_approver.lastName": { group: "signature", description: "นามสกุลผู้ลงนามฝ่ายสำนักงาน", example: "อนุมัติ" },
  "bdi_approver.endorsement": { group: "signature", description: 'ตราเห็นชอบของสำนักงาน — ว่างจนกว่าจะอนุมัติขั้นสุดท้าย แล้วขึ้นเป็น "เห็นชอบ" พร้อมขึ้นบรรทัดใหม่', example: "เห็นชอบ" },

  // ── สำนักงาน (BDI) ─────────────────────────────────────────
  "bdi.name": { group: "bdi", description: "ชื่อสำนักงาน", example: "สถาบันข้อมูลขนาดใหญ่ (องค์การมหาชน)" },
  "bdi.address": { group: "bdi", description: "ที่อยู่สำนักงานทั้งบรรทัด", example: "234/432 ซอยลาดพร้าว 12 ถนนลาดพร้าว แขวงจอมพล เขตจตุจักร กรุงเทพมหานคร 10900" },
  "bdi.email": { group: "bdi", description: "อีเมลสำนักงาน — ว่างถ้ายังไม่ได้บันทึกไว้ในระบบ", example: "saraban@bdi.or.th" },
  "bdi.phone": { group: "bdi", description: "เบอร์โทรศัพท์สำนักงาน — ว่างถ้ายังไม่ได้บันทึกไว้ในระบบ", example: "๐๒๑๔๒๑๔๔๔" },
  "bdi.directorName": { group: "bdi", description: "ชื่อผู้อำนวยการสถาบัน — เป็นค่าตั้งไว้ในโค้ด ต้องแก้เมื่อเปลี่ยนผู้อำนวยการ", example: "ศาสตราจารย์ธีรณี อจลากุล" },
  "bdi.directorPosition": { group: "bdi", description: "ตำแหน่งผู้ลงนามฝ่ายสำนักงาน", example: "ผู้อำนวยการสถาบันข้อมูลขนาดใหญ่" },

  // ── ตัวเอกสารเอง ────────────────────────────────────────────
  /**
   * เอกสารบอกได้ว่าตัวมันเองเป็นฉบับไหน — ชุด template 2026-08-31 ทำเครื่องหมายช่องนี้
   * ไว้ที่ท้ายเอกสาร (`legal_document_version.version_number` / `.effective_at`)
   *
   * ค่ามาจากแถว `legal.legal_document_version` ที่ถูกหยิบมา render รอบนั้น ไม่ใช่จากคำขอ
   * จึงเป็นตัวแปรชุดเดียวที่ **เอกสารคนละฉบับในคำขอเดียวกันได้ค่าไม่เท่ากัน** — ผนวกที่
   * เผยแพร่คนละวันกับข้อตกลงหลักย่อมมีเลขเวอร์ชันของตัวเอง
   */
  "document.version": { group: "document", description: "เลขเวอร์ชันของเอกสารฉบับนี้ (เลขไทย)", example: "๒" },
  "document.effectiveDate": { group: "document", description: "วันที่เอกสารเวอร์ชันนี้เริ่มมีผล — ว่างถ้ายังไม่ได้เผยแพร่", example: "๓๑ สิงหาคม ๒๕๖๙" },

  // ── ระบบ ────────────────────────────────────────────────────
  "system.name": { group: "system", description: "ชื่อระบบ", example: "ระบบกลางเพื่อการแบ่งปันข้อมูล (Government Datahub Platform)" },
  printedBy: { group: "system", description: "ชื่อผู้ที่ทำให้เอกสารฉบับนี้ถูกสร้าง", example: "นางสาว พิมพ์ชนก สังคมดี" },
  printedAt: { group: "system", description: "วันที่พิมพ์เอกสารจากระบบ", example: "๑๙ สิงหาคม ๒๕๖๙" },
  printedDateTime: { group: "system", description: "วันที่และเวลาที่พิมพ์เอกสารจากระบบ (เวลาไทย)", example: "๑๙ สิงหาคม ๒๕๖๙ ๑๕:๒๗" },
} as const satisfies Record<string, TemplateVariableSpec>;

/**
 * ชื่อเดิมของ placeholder ที่ยังเติมค่าให้ได้ — **ชื่อที่ถูกต้องอยู่ใน TEMPLATE_VARIABLES**
 *
 * ชื่อชุดเดิมบอกไม่ตรงกับบทบาทในระบบ (`signatory` กับ `approver` เป็นคนเดียวกัน ส่วน
 * `bdi` เป็นได้ทั้งผู้ลงนามและตัวสำนักงาน) จึงเปลี่ยนเป็น `org_approver` · `org_officer` ·
 * `bdi_approver` · `bdi` เมื่อ 2026-08-24
 *
 * **ลบตารางนี้ทิ้งไม่ได้ทันที** — template ที่ใช้งานจริงเป็นแถวใน
 * `legal.legal_document_version` ไม่ใช่ไฟล์ใน repo เอกสารที่ฝ่ายกฎหมายอัปโหลดไว้ก่อน
 * วันนั้นยังใช้ชื่อเดิม ถ้าตัดชื่อเดิมออกพร้อมกับการ deploy เอกสารเหล่านั้นจะ render
 * เป็นช่องว่างเปล่าโดยไม่มีใครรู้ตัว จนกว่าจะมีคนเปิด PDF ที่ลงนามไปแล้วดู
 *
 * ชื่อเดิมจึงยังเติมค่าให้ตอน render และยังผ่านการตรวจตอนอัปโหลด แต่ไม่ปรากฏในคู่มือ
 * และในผลลัพธ์ของ API อีกแล้ว — ปิดทางไม่ให้เอกสารฉบับใหม่หยิบไปใช้ ตารางนี้จะว่างลง
 * เองเมื่อทุก template ถูกอัปโหลดใหม่ด้วยชื่อใหม่ แล้วค่อยลบทั้งก้อน
 */
export const DEPRECATED_PLACEHOLDERS: Readonly<Record<string, TemplateVariable>> = {
  "signatory.fullName": "org_approver.fullName",
  "signatory.prefix": "org_approver.prefix",
  "signatory.firstName": "org_approver.firstName",
  "signatory.lastName": "org_approver.lastName",
  "signatory.position": "org_approver.position",
  "signatory.department": "org_approver.department",
  "signatory.email": "org_approver.email",
  "signatory.phone": "org_approver.phone",
  "signatory.nationalId": "org_approver.nationalId",

  "contact.fullName": "org_officer.fullName",
  "contact.prefix": "org_officer.prefix",
  "contact.firstName": "org_officer.firstName",
  "contact.lastName": "org_officer.lastName",
  "contact.position": "org_officer.position",
  "contact.department": "org_officer.department",
  "contact.email": "org_officer.email",
  "contact.phone": "org_officer.phone",
  "contact.nationalId": "org_officer.nationalId",

  "approver.signature": "org_approver.signature",
  "approver.signedDate": "org_approver.signedDate",

  // `bdi.` ชุดลายมือชื่อกลายเป็น `bdi_approver.` — ระวังว่าชื่อใหม่ของสำนักงานก็ขึ้นต้น
  // ด้วย `bdi.` เหมือนกัน แต่คนละชื่อกัน จึงไม่ทับกัน
  "bdi.signature": "bdi_approver.signature",
  "bdi.signedDate": "bdi_approver.signedDate",
  "bdi.firstName": "bdi_approver.firstName",
  "bdi.lastName": "bdi_approver.lastName",
  "bdi.endorsement": "bdi_approver.endorsement",

  "office.name": "bdi.name",
  "office.address": "bdi.address",
  "office.email": "bdi.email",
  "office.phone": "bdi.phone",
  "office.directorName": "bdi.directorName",
  "office.directorPosition": "bdi.directorPosition",
};

/**
 * ช่องติ๊กเป็น "ตระกูล" ไม่ใช่ชื่อเดี่ยว — `{{tick.<ฟิลด์>.<รหัส>}}`
 *
 * ไม่ไล่เขียนทีละชื่อลง TEMPLATE_VARIABLES เพราะมีเกือบร้อยช่อง และจะกลายเป็นสำเนาที่สอง
 * ของ code list ใน lib/dataset.ts ที่ต้องคอยแก้ให้ตรงกัน — สร้างจาก code list ตรง ๆ
 * เพิ่มตัวเลือกใหม่ในนั้นแล้วช่องติ๊กใหม่ใช้ได้ทันทีโดยไม่ต้องแตะไฟล์นี้
 *
 * ฟิลด์ที่เป็น boolean ใช้รหัส `true` / `false`
 */
export const TICK_FIELDS: Record<string, readonly string[]> = {
  dataType: Object.keys(DATA_TYPE_LABELS),
  dataTopic: Object.keys(DATA_TOPIC_LABELS),
  updateFrequencyUnit: Object.keys(UPDATE_FREQUENCY_UNIT_LABELS),
  deliveryFrequency: Object.keys(DELIVERY_FREQUENCY_LABELS),
  geoCoverage: Object.keys(GEO_COVERAGE_LABELS),
  dataFormat: Object.keys(DATA_FORMAT_LABELS),
  dataCategory: Object.keys(DATA_CATEGORY_LABELS),
  dataClassification: Object.keys(DATA_CLASSIFICATION_LABELS),
  personalDataProcessingPeriod: Object.keys(PERSONAL_DATA_PERIOD_LABELS),
  licenseId: Object.keys(LICENSE_LABELS),
  containsPersonalData: ["true", "false"],
  allowOriginalRawDataRetention: ["true", "false"],
  allowOriginalRawDataSharing: ["true", "false"],
  allowTransformedRawDataSharing: ["true", "false"],
  allowTransformedRawDataGdxSharing: ["true", "false"],
  allowAggregatedDataSharing: ["true", "false"],
  authorizePersonalDataAnonymization: ["true", "false"],
};

/** ชื่อช่องติ๊กที่ใช้ได้ทั้งหมด เช่น `tick.dataType.1` */
export const TICK_VARIABLES: ReadonlySet<string> = new Set(
  Object.entries(TICK_FIELDS).flatMap(([field, codes]) => codes.map((c) => `tick.${field}.${c}`)),
);

/**
 * ชื่อที่ถูกต้องของ placeholder ตัวนี้ — คืนชื่อเดิมถ้ามันเป็นชื่อปัจจุบันอยู่แล้ว
 * แปลงให้เมื่อเป็นชื่อชุดเก่า และคืน null เมื่อไม่รู้จักเลย
 */
export function canonicalPlaceholder(name: string): string | null {
  if (TICK_VARIABLES.has(name)) return name;
  if (name in TEMPLATE_VARIABLES) return name;
  return DEPRECATED_PLACEHOLDERS[name] ?? null;
}

/** ตัวแปรนี้ใช้ได้กับ flow นี้ไหม — ชื่อชุดเก่าถือว่าใช้ได้เท่ากับชื่อใหม่ของมัน */
export function variableAllowed(name: string, scope: VariableScope): boolean {
  const canonical = canonicalPlaceholder(name);
  if (!canonical) return false;
  if (TICK_VARIABLES.has(canonical)) return scope === "dataset" || scope === "both";
  const spec = (TEMPLATE_VARIABLES as Record<string, TemplateVariableSpec | undefined>)[canonical];
  if (!spec) return false;
  const declared = spec.scope ?? "both";
  return declared === "both" || scope === "both" || declared === scope;
}

/** ชื่อชุดเก่าที่เอกสารฉบับนี้ยังใช้อยู่ — ใช้เตือนคนอัปโหลด ไม่ใช่เหตุให้ปฏิเสธไฟล์ */
export function deprecatedPlaceholdersIn(docx: Buffer): string[] {
  return placeholdersIn(docx).filter((name) => name in DEPRECATED_PLACEHOLDERS);
}

export type TemplateVariable = keyof typeof TEMPLATE_VARIABLES;
export type TemplateValues = Partial<Record<TemplateVariable, string>>;

/** ชื่อตัวแปรทุกตัวที่ปรากฏใน .docx — อ่านจาก XML ทุกส่วนที่ Word เก็บข้อความไว้ */
export function placeholdersIn(docx: Buffer): string[] {
  const zip = openDocx(docx);
  const found = new Set<string>();
  for (const name of Object.keys(zip.files)) {
    if (!/^word\/.*\.xml$/.test(name)) continue;
    const xml = zip.file(name)?.asText() ?? "";
    // Word ตัดข้อความเป็นหลาย run ได้ทุกที่ ({{org.name}} อาจถูกผ่าเป็นสามชิ้น)
    // จึงต้องดึงข้อความออกมาต่อกันก่อน แล้วค่อยหา placeholder
    for (const m of textOf(xml).matchAll(PLACEHOLDER)) {
      if (m[1]) found.add(m[1]);
    }
  }
  return [...found].sort();
}

/**
 * ปฏิเสธ template ที่เรียกตัวแปรซึ่งไม่มีใครต่อค่าให้
 * โยน DocumentRenderError ที่ status 400 เพราะเป็นความผิดของไฟล์ที่อัปโหลดมา
 */
export function assertKnownPlaceholders(docx: Buffer, scope: VariableScope = "both"): string[] {
  const used = placeholdersIn(docx);
  const unknown = used.filter((name) => !variableAllowed(name, scope));
  if (unknown.length > 0) {
    /**
     * ไม่ไล่ชื่อตัวแปรทั้ง 74 ตัวลงในข้อความ — ยาวเกินกว่าจะอ่านบนหน้าจอ
     * บอกตัวที่ผิด แล้วเสนอตัวที่ชื่อใกล้กันในกลุ่มเดียวกัน ซึ่งมักเป็นตัวที่เขาตั้งใจพิมพ์
     */
    const suggestions = unknown
      .map((name) => {
        const prefix = name.includes(".") ? `${name.split(".")[0]}.` : "";
        const near = prefix
          ? Object.keys(TEMPLATE_VARIABLES).filter((v) => v.startsWith(prefix)).slice(0, 6)
          : [];
        return near.length > 0 ? `{{${name}}} (ในกลุ่มนี้มี ${near.map((v) => `{{${v}}}`).join(" ")})` : `{{${name}}}`;
      })
      .join(" · ");

    throw new DocumentRenderError(
      "unknown_placeholder",
      `เอกสารอ้างถึงตัวแปรที่ระบบไม่รู้จัก: ${suggestions} — ` +
        `ดูรายชื่อตัวแปรที่ใช้ได้ทั้งหมดได้จาก GET /api/admin/legal-documents ` +
        `หรือ docs/18-document-template-variables.md`,
      400,
      { file: `ตัวแปรที่ระบบไม่รู้จัก: ${unknown.join(", ")}` },
    );
  }
  return used;
}

/** ข้อความล้วนของ XML หนึ่งไฟล์ โดยไม่สนใจว่า Word ผ่า run ไว้กี่ชิ้น */
function textOf(xml: string): string {
  return xml.replace(/<[^>]*>/g, "");
}

function openDocx(docx: Buffer): PizZip {
  try {
    return new PizZip(docx);
  } catch {
    throw new DocumentRenderError(
      "not_a_docx",
      "ไฟล์นี้ไม่ใช่เอกสาร Word (.docx) ที่อ่านได้",
      400,
      { file: "รองรับเฉพาะไฟล์ .docx" },
    );
  }
}

/**
 * ค่าชุดเดียวกัน แต่ใส่ชื่อชุดเก่าเพิ่มเข้าไปด้วย
 *
 * ตัวสร้างค่า (lib/legal-values.ts, lib/dataset-values.ts) รู้จักแต่ชื่อปัจจุบัน — ที่นี่
 * เป็นที่เดียวที่รู้เรื่องชื่อเดิม เอกสารเก่าจึงยังเติมค่าได้โดยไม่ต้องมีตารางชื่อสองชุด
 * กระจายอยู่ในไฟล์ที่ต่อค่า
 */
function withDeprecatedNames(values: TemplateValues): Record<string, string> {
  const out: Record<string, string> = { ...(values as Record<string, string>) };
  for (const [old, current] of Object.entries(DEPRECATED_PLACEHOLDERS)) {
    const value = (values as Record<string, string | undefined>)[current];
    if (value !== undefined) out[old] = value;
  }
  return out;
}

/**
 * เติมค่าลง placeholder แล้วคืน .docx ที่เติมแล้ว
 *
 * ค่าที่ไม่ได้ส่งมาจะกลายเป็นค่าว่าง ไม่ใช่ข้อความ "undefined" — ตั้งใจ เพราะเอกสาร
 * ฉบับก่อนลงนามต้องมีช่องลายมือชื่อว่างไว้ให้เห็นว่ายังไม่มีใครลงนาม
 */
export function fillTemplate(docx: Buffer, values: TemplateValues): Buffer {
  const zip = openDocx(docx);
  const filled = withDeprecatedNames(values);
  let doc: Docxtemplater;
  try {
    doc = new Docxtemplater(zip, {
      delimiters: DELIMITERS,
      // ค่าที่มี \n ต้องกลายเป็นการขึ้นบรรทัดจริงใน Word ไม่ใช่ช่องว่าง —
      // ตราเห็นชอบอยู่บรรทัดเหนือบรรทัดลงนามในช่องเดียวกันของตาราง
      linebreaks: true,
      paragraphLoop: true,
      nullGetter: () => "",
    });
    doc.render(filled);
  } catch (err) {
    // docxtemplater รวมทุกปัญหาของ template ไว้ใน error เดียว (แท็กไม่ปิด ซ้อนกันผิด)
    // ข้อความของมันเป็นภาษาอังกฤษเชิงเทคนิค แต่คนที่เห็นคือคนอัปโหลดเอกสาร
    const detail = describeTemplateError(err);
    throw new DocumentRenderError(
      "template_invalid",
      `เอกสารต้นแบบมีรูปแบบ placeholder ที่ผิด: ${detail}`,
      400,
      { file: `placeholder ในเอกสารผิดรูปแบบ: ${detail}` },
    );
  }
  return doc.getZip().generate({ type: "nodebuffer", compression: "DEFLATE" }) as Buffer;
}

function describeTemplateError(err: unknown): string {
  const e = err as { properties?: { errors?: Array<{ properties?: { explanation?: string } }> } };
  const explanations = e.properties?.errors
    ?.map((inner) => inner.properties?.explanation)
    .filter(Boolean);
  if (explanations?.length) return explanations.join("; ");
  return err instanceof Error ? err.message : String(err);
}

/**
 * .docx -> PDF ผ่าน gotenberg
 *
 * ฟอนต์ TH SarabunPSK ถูกฝังไว้ใน image ของ gotenberg ไม่ใช่ในไฟล์ .docx —
 * LibreOffice คำนวณการตัดบรรทัดและการแบ่งหน้าจากฟอนต์ที่ติดตั้งในเครื่อง ถ้าไม่มี
 * มันจะแทนด้วยฟอนต์อื่นแล้วเลย์เอาต์เลื่อนทั้งฉบับ (ดู gotenberg/Dockerfile)
 */
export async function docxToPdf(docx: Buffer, filename: string): Promise<Buffer> {
  const form = new FormData();
  form.append(
    "files",
    new Blob([new Uint8Array(docx)], {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }),
    // นามสกุลเป็นสิ่งที่ gotenberg ใช้เลือก filter ของ LibreOffice จึงต้องเป็น .docx
    filename.endsWith(".docx") ? filename : `${filename}.docx`,
  );

  let res: Response;
  try {
    res = await fetch(`${env.gotenberg.url}/forms/libreoffice/convert`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(env.gotenberg.timeoutMs),
    });
  } catch (err) {
    // ไม่มี fallback โดยตั้งใจ — ปล่อย PDF ที่เลย์เอาต์เพี้ยนออกไปให้ลงนาม
    // แย่กว่าบอกตรง ๆ ว่าตัวแปลงเอกสารไม่พร้อม
    throw new DocumentRenderError(
      "converter_unavailable",
      "ตัวแปลงเอกสารเป็น PDF ไม่ตอบสนอง กรุณาลองอีกครั้ง หากยังเป็นเหมือนเดิมโปรดแจ้งผู้ดูแลระบบ",
      503,
    );
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new DocumentRenderError(
      "conversion_failed",
      `แปลงเอกสารเป็น PDF ไม่สำเร็จ (${res.status}) ${body.slice(0, 300)}`.trim(),
      502,
    );
  }

  return Buffer.from(await res.arrayBuffer());
}

/** เติมค่าแล้วแปลงเป็น PDF ในขั้นตอนเดียว — ทางเดินปกติของทุกเอกสารกฎหมาย */
export async function renderTemplateToPdf(
  docx: Buffer,
  values: TemplateValues,
  filename: string,
): Promise<Buffer> {
  return docxToPdf(fillTemplate(docx, values), filename);
}

/** ใช้ตรวจว่าไฟล์ที่อัปโหลดมาเปิดเป็นเอกสาร Word ได้จริง ไม่ใช่แค่มีนามสกุลถูก */
export function assertReadableDocx(docx: Buffer): void {
  const zip = openDocx(docx);
  if (!zip.file("word/document.xml")) {
    throw new DocumentRenderError(
      "not_a_docx",
      "ไฟล์นี้ไม่ใช่เอกสาร Word (.docx) — ไม่พบ word/document.xml ข้างใน",
      400,
      { file: "รองรับเฉพาะไฟล์ .docx" },
    );
  }
}
