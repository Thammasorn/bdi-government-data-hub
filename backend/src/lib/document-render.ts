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

/**
 * ชื่อตัวแปรทั้งหมดที่ template เรียกใช้ได้
 *
 * นี่คือเส้นแบ่งของ "แก้ได้โดยไม่แก้โค้ด": ผู้ดูแลเอกสารย้าย ลบ หรือใช้ placeholder
 * ตัวไหนซ้ำกี่ที่ก็ได้ แต่การ**เพิ่มชื่อใหม่**ต้องมีคนต่อค่าให้มันในโค้ดก่อน
 * ตอนอัปโหลดจึงตรวจชื่อทั้งหมดแล้วปฏิเสธพร้อมบอกรายชื่อที่ใช้ได้ — ไม่ปล่อยให้ไป
 * โป๊ะตอน render ซึ่งเป็นอีกวันและอีกคน
 */
export const TEMPLATE_VARIABLES = {
  "agreement.day": "วันที่ทำข้อตกลง (เลขไทย)",
  "agreement.month": "เดือนที่ทำข้อตกลง (ชื่อเดือนภาษาไทย)",
  "agreement.year": "ปีที่ทำข้อตกลง (พ.ศ. เลขไทย)",
  "org.name": "ชื่อหน่วยงาน",
  "org.addressNo": "ที่อยู่หน่วยงาน (เลขที่และรายละเอียด)",
  "org.road": "ถนน",
  "org.subdistrict": "แขวง/ตำบล",
  "org.district": "เขต/อำเภอ",
  "org.province": "จังหวัด",
  "org.postalCode": "รหัสไปรษณีย์",
  "org.email": "อีเมลหน่วยงาน",
  "signatory.fullName": "ชื่อผู้มีอำนาจกระทำการแทน (คำนำหน้า ชื่อ นามสกุล)",
  "signatory.position": "ตำแหน่งผู้มีอำนาจกระทำการแทน",
  "signatory.nationalId": "เลขบัตรประชาชนผู้มีอำนาจกระทำการแทน",
  "approver.signature": "ลายมือชื่อฝ่ายหน่วยงาน — ว่างจนกว่าผู้มีอำนาจจะลงนาม",
  "approver.signedDate": "วันที่ฝ่ายหน่วยงานลงนาม",
  "bdi.signature": "ลายมือชื่อฝ่ายสำนักงาน — ว่างจนกว่าผู้อนุมัติ BDI จะลงนาม",
  "bdi.signedDate": "วันที่ฝ่ายสำนักงานลงนาม",
  "bdi.endorsement": "ตราเห็นชอบของสำนักงาน — ว่างจนกว่าจะอนุมัติขั้นสุดท้าย",
  "system.name": "ชื่อระบบ",
  "requestNumber": "เลขที่คำขอ",
  "printedBy": "ผู้สั่งพิมพ์เอกสารจากระบบ",
  "printedAt": "วันที่พิมพ์เอกสารจากระบบ",
} as const;

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
    throw new DocumentRenderError(
      "unknown_placeholder",
      `เอกสารอ้างถึงตัวแปรที่ระบบไม่รู้จัก: ${unknown.map((u) => `{{${u}}}`).join(" ")} — ` +
        `ตัวแปรที่ใช้ได้คือ ${Object.keys(TEMPLATE_VARIABLES).map((v) => `{{${v}}}`).join(" ")}`,
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
