/**
 * เติมข้อมูลลง template .docx แล้วแปลงเป็น PDF
 *
 * ทำไมต้องเดินทาง .docx -> LibreOffice -> PDF ทั้งที่ระบบมี PDFKit อยู่แล้ว
 * (lib/pdf.ts วาดแบบฟอร์มชุดข้อมูลเอง):
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
  request: "คำขอลงทะเบียน",
  org: "หน่วยงานที่ลงทะเบียน",
  signatory: "ผู้มีอำนาจกระทำการแทน",
  contact: "ผู้กรอกข้อมูล",
  signature: "ลายมือชื่อและตราเห็นชอบ",
  office: "สำนักงาน (BDI)",
  system: "ระบบและการพิมพ์เอกสาร",
} as const;

export type VariableGroup = keyof typeof VARIABLE_GROUPS;

export interface TemplateVariableSpec {
  group: VariableGroup;
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
  "agreement.day": { group: "agreement", description: "วันที่ทำข้อตกลง (เลขไทย)", example: "๑๙" },
  "agreement.month": { group: "agreement", description: "เดือนที่ทำข้อตกลง (ชื่อเดือนภาษาไทย)", example: "สิงหาคม" },
  "agreement.year": { group: "agreement", description: "ปีที่ทำข้อตกลง (พ.ศ. เลขไทย)", example: "๒๕๖๙" },
  "agreement.date": { group: "agreement", description: "วันที่ทำข้อตกลงแบบเต็ม สำหรับเอกสารที่มีช่องเดียว", example: "๑๙ สิงหาคม ๒๕๖๙" },

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
  "signatory.fullName": { group: "signatory", description: "ชื่อผู้มีอำนาจกระทำการแทน (คำนำหน้า ชื่อ นามสกุล)", example: "นาย อนุชา พัฒนา" },
  "signatory.prefix": { group: "signatory", description: "คำนำหน้าชื่อผู้มีอำนาจกระทำการแทน", example: "นาย" },
  "signatory.firstName": { group: "signatory", description: "ชื่อผู้มีอำนาจกระทำการแทน", example: "อนุชา" },
  "signatory.lastName": { group: "signatory", description: "นามสกุลผู้มีอำนาจกระทำการแทน", example: "พัฒนา" },
  "signatory.position": { group: "signatory", description: "ตำแหน่งผู้มีอำนาจกระทำการแทน", example: "ผู้อำนวยการ" },
  "signatory.department": { group: "signatory", description: "ฝ่าย/กอง/สำนักของผู้มีอำนาจกระทำการแทน — ว่างถ้าไม่ได้กรอก", example: "สำนักบริหารกลาง" },
  "signatory.email": { group: "signatory", description: "อีเมลผู้มีอำนาจกระทำการแทน", example: "director@dla.go.th" },
  "signatory.phone": { group: "signatory", description: "เบอร์โทรศัพท์ผู้มีอำนาจกระทำการแทน", example: "๐๘๑๒๓๔๕๖๗๘" },
  "signatory.nationalId": { group: "signatory", description: "เลขบัตรประชาชนผู้มีอำนาจกระทำการแทน (เลขไทย คั่นด้วยขีด)", example: "๑-๑๐๑๗-๐๐๒๐๗-๐๓-๐" },

  // ── ผู้กรอกข้อมูล ────────────────────────────────────────────
  "contact.fullName": { group: "contact", description: "ชื่อผู้กรอกข้อมูล (คำนำหน้า ชื่อ นามสกุล)", example: "นางสาว พิมพ์ชนก สังคมดี" },
  "contact.prefix": { group: "contact", description: "คำนำหน้าชื่อผู้กรอกข้อมูล", example: "นางสาว" },
  "contact.firstName": { group: "contact", description: "ชื่อผู้กรอกข้อมูล", example: "พิมพ์ชนก" },
  "contact.lastName": { group: "contact", description: "นามสกุลผู้กรอกข้อมูล", example: "สังคมดี" },
  "contact.position": { group: "contact", description: "ตำแหน่งผู้กรอกข้อมูล", example: "นักวิเคราะห์นโยบายและแผน" },
  "contact.department": { group: "contact", description: "ฝ่าย/กอง/สำนักของผู้กรอกข้อมูล", example: "กลุ่มงานข้อมูลสารสนเทศ" },
  "contact.email": { group: "contact", description: "อีเมลผู้กรอกข้อมูล", example: "user@dla.go.th" },
  "contact.phone": { group: "contact", description: "เบอร์โทรศัพท์ผู้กรอกข้อมูล", example: "๐๘๒๐๐๐๐๐๐๐" },
  "contact.nationalId": { group: "contact", description: "เลขบัตรประชาชนผู้กรอกข้อมูล (เลขไทย คั่นด้วยขีด)", example: "๑-๑๐๑๗-๐๐๒๐๗-๐๓-๐" },

  // ── ลายมือชื่อ ──────────────────────────────────────────────
  "approver.signature": { group: "signature", description: "ลายมือชื่อฝ่ายหน่วยงาน — ว่างจนกว่าผู้มีอำนาจจะลงนาม", example: "นาย อนุชา พัฒนา" },
  "approver.signedDate": { group: "signature", description: "วันที่ฝ่ายหน่วยงานลงนาม — ว่างจนกว่าจะลงนาม", example: "๑๙ สิงหาคม ๒๕๖๙" },
  "bdi.signature": { group: "signature", description: "ลายมือชื่อฝ่ายสำนักงาน — ว่างจนกว่าผู้อนุมัติ BDI จะลงนาม", example: "นาง สุดารัตน์ อนุมัติ" },
  "bdi.signedDate": { group: "signature", description: "วันที่ฝ่ายสำนักงานลงนาม — ว่างจนกว่าจะลงนาม", example: "๑๙ สิงหาคม ๒๕๖๙" },
  "bdi.endorsement": { group: "signature", description: 'ตราเห็นชอบของสำนักงาน — ว่างจนกว่าจะอนุมัติขั้นสุดท้าย แล้วขึ้นเป็น "เห็นชอบ" พร้อมขึ้นบรรทัดใหม่', example: "เห็นชอบ" },

  // ── สำนักงาน (BDI) ─────────────────────────────────────────
  "office.name": { group: "office", description: "ชื่อสำนักงาน", example: "สถาบันข้อมูลขนาดใหญ่ (องค์การมหาชน)" },
  "office.address": { group: "office", description: "ที่อยู่สำนักงานทั้งบรรทัด", example: "234/432 ซอยลาดพร้าว 12 ถนนลาดพร้าว แขวงจอมพล เขตจตุจักร กรุงเทพมหานคร 10900" },
  "office.email": { group: "office", description: "อีเมลสำนักงาน — ว่างถ้ายังไม่ได้บันทึกไว้ในระบบ", example: "saraban@bdi.or.th" },
  "office.phone": { group: "office", description: "เบอร์โทรศัพท์สำนักงาน — ว่างถ้ายังไม่ได้บันทึกไว้ในระบบ", example: "๐๒๑๔๒๑๔๔๔" },
  "office.directorName": { group: "office", description: "ชื่อผู้อำนวยการสถาบัน — เป็นค่าตั้งไว้ในโค้ด ต้องแก้เมื่อเปลี่ยนผู้อำนวยการ", example: "ศาสตราจารย์ธีรณี อจลากุล" },
  "office.directorPosition": { group: "office", description: "ตำแหน่งผู้ลงนามฝ่ายสำนักงาน", example: "ผู้อำนวยการสถาบันข้อมูลขนาดใหญ่" },

  // ── ระบบ ────────────────────────────────────────────────────
  "system.name": { group: "system", description: "ชื่อระบบ", example: "ระบบกลางเพื่อการแบ่งปันข้อมูล (Government Datahub Platform)" },
  printedBy: { group: "system", description: "ชื่อผู้ที่ทำให้เอกสารฉบับนี้ถูกสร้าง", example: "นางสาว พิมพ์ชนก สังคมดี" },
  printedAt: { group: "system", description: "วันที่พิมพ์เอกสารจากระบบ", example: "๑๙ สิงหาคม ๒๕๖๙" },
} as const satisfies Record<string, TemplateVariableSpec>;

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
export function assertKnownPlaceholders(docx: Buffer): string[] {
  const used = placeholdersIn(docx);
  const unknown = used.filter((name) => !(name in TEMPLATE_VARIABLES));
  if (unknown.length > 0) {
    /**
     * ไม่ไล่ชื่อตัวแปรทั้ง 53 ตัวลงในข้อความ — ยาวเกินกว่าจะอ่านบนหน้าจอ
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
 * เติมค่าลง placeholder แล้วคืน .docx ที่เติมแล้ว
 *
 * ค่าที่ไม่ได้ส่งมาจะกลายเป็นค่าว่าง ไม่ใช่ข้อความ "undefined" — ตั้งใจ เพราะเอกสาร
 * ฉบับก่อนลงนามต้องมีช่องลายมือชื่อว่างไว้ให้เห็นว่ายังไม่มีใครลงนาม
 */
export function fillTemplate(docx: Buffer, values: TemplateValues): Buffer {
  const zip = openDocx(docx);
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
    doc.render(values as Record<string, string>);
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
