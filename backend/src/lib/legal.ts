/**
 * เอกสารกฎหมาย A0–A4 — ตัว template อยู่ในฐานข้อมูล ไม่ได้อยู่ในโค้ด
 *
 * `legal.legal_document` มีแถว A0–A4 อยู่แล้วจาก seed:masters ส่วนไฟล์จริงของแต่ละ
 * เวอร์ชันเก็บเป็น `legal.legal_document_version` -> `attachment.attachment` ใน Azure Blob Storage
 * ตามที่ sheet ออกแบบไว้ (comment ใน seed-masters.ts เขียนขั้นตอนนี้ไว้ตรง ๆ ว่า
 * "เมื่อได้ไฟล์จริงมา: อัปโหลดเป็น attachment ... แล้วเปลี่ยนสถานะเป็น ACTIVE/PUBLISHED")
 *
 * ทำไมไม่เก็บ .docx ไว้ใน repo แล้วอ่านจากดิสก์เอา:
 *
 * - ฝ่ายกฎหมายเป็นเจ้าของถ้อยคำ ไม่ใช่ทีมพัฒนา การแก้ข้อความหนึ่งบรรทัดไม่ควรเป็น
 *   งาน deploy ไฟล์ใน `src/assets/legal-templates/` เป็นแค่ **ฉบับตั้งต้น** ที่ seed
 *   ใช้สร้างเวอร์ชัน 1 หลังจากนั้นของจริงคือเวอร์ชันล่าสุดในฐานข้อมูล
 * - เอกสารที่หน่วยงานลงนามต้องอ้างอิงได้ว่าเป็น "ฉบับไหน" — legal_acceptance ชี้ไปที่
 *   legal_document_version_id เมื่อ template ถูกแก้ในภายหลัง หลักฐานเดิมไม่เปลี่ยนตาม
 *
 * **หนึ่งเวอร์ชันมีสองไฟล์** และอยู่ต่าง attachment_type กันเพราะ partial unique index
 * ยอมให้มี ACTIVE ได้แถวเดียวต่อ (owner_type, owner_id, attachment_type):
 *   LEGAL_DOCUMENT  = .docx ต้นแบบ (ของจริงที่เอาไปเติมค่า)
 *   GENERATED_FORM  = PDF ที่ render จาก .docx นั้นตอน publish ไว้ให้เปิดอ่าน
 * แปลงตอน publish ครั้งเดียว ไม่ใช่ทุกครั้งที่มีคนเปิดดู — ผนวก A1–A3 ไม่มีช่องให้เติม
 * ผลลัพธ์จึงเหมือนกันทุกครั้งอยู่แล้ว
 */
import { randomUUID } from "node:crypto";

import {
  AttachmentOwnerType,
  AttachmentType,
  LegalDocumentStatus,
  LegalDocumentVersionStatus,
  type Prisma,
  type PrismaClient,
} from "@prisma/client";

import {
  activeAttachment,
  readAttachment,
  storeAttachment,
} from "./attachment.js";
import {
  DEPRECATED_PLACEHOLDERS,
  DocumentRenderError,
  assertKnownPlaceholders,
  assertReadableDocx,
  docxToPdf,
  fillTemplate,
  type VariableScope,
} from "./document-render.js";

type Db = PrismaClient | Prisma.TransactionClient;

const OWNER = AttachmentOwnerType.LEGAL_DOCUMENT_VERSION;

/** Flow ที่เอกสารถูกใช้ — คอลัมน์ application_scope */
export const LEGAL_SCOPES = {
  ORGANIZATION_REGISTRATION: "ORGANIZATION_REGISTRATION",
  DATASET_REGISTRATION: "DATASET_REGISTRATION",
} as const;

export type LegalScope = (typeof LEGAL_SCOPES)[keyof typeof LEGAL_SCOPES];

/** application_scope ของเอกสาร -> scope ที่ใช้ตรวจชื่อตัวแปร */
export function variableScopeOf(scope: string): VariableScope {
  return scope === LEGAL_SCOPES.DATASET_REGISTRATION ? "dataset" : "organization";
}

export interface PublishedDocument {
  code: string;
  nameTh: string;
  displayOrder: number;
  versionId: string;
  versionNumber: number;
  /** PDF ที่ render ไว้ให้เปิดอ่าน — ผนวกที่ไม่มีช่องให้เติมใช้ไฟล์นี้ได้ตรง ๆ */
  pdfAttachmentId: string | null;
  /** true = เอกสารมี placeholder จึงต้อง render ใหม่ต่อคำขอ ไม่ใช้ไฟล์กลาง */
  hasPlaceholders: boolean;
}

/**
 * เอกสารที่ "แสดงให้ผู้ใช้ยอมรับได้" ตามตารางท้าย sheet legal_document_version:
 * document ACTIVE + version PUBLISHED เท่านั้น
 */
export async function publishedDocuments(
  db: Db,
  scope: LegalScope,
): Promise<PublishedDocument[]> {
  const documents = await db.legalDocument.findMany({
    where: { applicationScope: scope, status: LegalDocumentStatus.ACTIVE },
    orderBy: { displayOrder: "asc" },
    include: {
      versions: {
        where: { status: LegalDocumentVersionStatus.PUBLISHED },
        orderBy: { versionNumber: "desc" },
        take: 1,
      },
    },
  });

  const out: PublishedDocument[] = [];
  for (const doc of documents) {
    const version = doc.versions[0];
    if (!version) continue;
    const pdf = await activeAttachment(db, OWNER, version.id, AttachmentType.GENERATED_FORM);
    const source = await activeAttachment(db, OWNER, version.id, AttachmentType.LEGAL_DOCUMENT);
    out.push({
      code: doc.documentCode,
      nameTh: doc.nameTh,
      displayOrder: doc.displayOrder,
      versionId: version.id,
      versionNumber: version.versionNumber,
      pdfAttachmentId: pdf?.id ?? null,
      hasPlaceholders: source
        ? assertKnownPlaceholders(await readAttachment(source), variableScopeOf(scope)).length > 0
        : false,
    });
  }
  return out;
}

/** .docx ต้นแบบของเวอร์ชันหนึ่ง — สิ่งที่เอาไปเติมค่าแล้ว render */
export async function templateDocx(db: Db, versionId: string): Promise<Buffer> {
  const source = await activeAttachment(db, OWNER, versionId, AttachmentType.LEGAL_DOCUMENT);
  if (!source) {
    throw new DocumentRenderError(
      "template_missing",
      "ยังไม่มีไฟล์ต้นแบบของเอกสารฉบับนี้ในระบบ กรุณาแจ้งผู้ดูแลระบบให้อัปโหลดเอกสาร",
      503,
    );
  }
  return readAttachment(source);
}

/**
 * เผยแพร่ .docx เป็นเวอร์ชันใหม่ของเอกสารหนึ่งฉบับ
 *
 * ตรวจ placeholder **ก่อน** เขียนอะไรลงฐานข้อมูล คนที่อัปโหลดจะได้รู้ทันทีว่าใช้ชื่อ
 * ตัวแปรผิด ไม่ใช่ไปพังตอนมีหน่วยงานกดสร้างเอกสารในอีกสองวัน
 *
 * แปลงเป็น PDF ตอนนี้เลยด้วยเหตุผลเดียวกัน: template ที่ LibreOffice เปิดไม่ได้ต้อง
 * ตกที่ขั้นตอนอัปโหลด ไม่ใช่ที่หน้าจอของหน่วยงาน
 */
export async function publishVersion(
  db: Db,
  params: { documentCode: string; docx: Buffer; filename: string; actorId: string },
): Promise<{
  versionId: string;
  versionNumber: number;
  placeholders: string[];
  deprecatedPlaceholders: string[];
}> {
  assertReadableDocx(params.docx);

  const document = await db.legalDocument.findUnique({
    where: { documentCode: params.documentCode },
  });
  if (!document) {
    throw new DocumentRenderError(
      "unknown_document",
      `ไม่มีเอกสารรหัส ${params.documentCode} ในระบบ`,
      404,
    );
  }

  // ตรวจชื่อตัวแปรตาม flow ของเอกสาร — `{{dataset.title}}` ในข้อตกลงหน่วยงานไม่มีค่าให้เติม
  const placeholders = assertKnownPlaceholders(
    params.docx,
    variableScopeOf(document.applicationScope),
  );
  /**
   * ชื่อชุดเก่ายังเติมค่าให้ได้ จึงไม่ปฏิเสธไฟล์ — แต่ต้องบอกคนอัปโหลด ไม่งั้นเอกสารฉบับใหม่
   * จะถูกเขียนด้วยชื่อที่กำลังจะถูกเลิกใช้ต่อไปเรื่อย ๆ โดยไม่มีใครทัก
   */
  const deprecated = placeholders.filter((name) => name in DEPRECATED_PLACEHOLDERS);
  /**
   * PDF กลางของเวอร์ชันนี้ — เติมค่าว่างก่อนแปลงถ้าเอกสารมี placeholder
   *
   * ถ้าแปลงตรง ๆ ไฟล์กลางจะมีข้อความ `{{org.name}}` โผล่ให้เห็นจริง ๆ เติมค่าว่างแทน
   * ทำให้ได้ "ฉบับเปล่า" ที่อ่านเหมือนแบบฟอร์มยังไม่กรอก ซึ่งเป็นสิ่งที่ควรเห็นถ้ามีใคร
   * เปิดไฟล์กลางของเอกสารที่ปกติต้อง render ต่อคำขอ
   */
  const pdf = await docxToPdf(
    placeholders.length > 0 ? fillTemplate(params.docx, {}) : params.docx,
    params.filename,
  );

  const latest = await db.legalDocumentVersion.findFirst({
    where: { legalDocumentId: document.id },
    orderBy: { versionNumber: "desc" },
    select: { versionNumber: true },
  });
  const versionNumber = (latest?.versionNumber ?? 0) + 1;

  // เวอร์ชันที่เผยแพร่อยู่กลายเป็น SUPERSEDED — ตาราง sheet บอกว่าสถานะนี้
  // "ไม่รับ acceptance ใหม่ ประวัติเดิมยังตรวจสอบได้" ซึ่งตรงกับที่ต้องการ
  await db.legalDocumentVersion.updateMany({
    where: { legalDocumentId: document.id, status: LegalDocumentVersionStatus.PUBLISHED },
    data: { status: LegalDocumentVersionStatus.SUPERSEDED, supersededAt: new Date() },
  });

  // id ของเวอร์ชันถูกกำหนดล่วงหน้า เพราะ storage key ของไฟล์มี owner_id อยู่ใน path
  // ถ้าเก็บไฟล์ก่อนแล้วค่อยย้าย owner ทีหลัง แถวจะบอกว่าเป็นของเวอร์ชันนี้
  // แต่ path ใน object storage ยังชี้ owner เดิมอยู่ตลอดไป
  const versionId = randomUUID();
  const now = new Date();

  const source = await storeAttachment(db, {
    ownerType: OWNER,
    ownerId: versionId,
    attachmentType: AttachmentType.LEGAL_DOCUMENT,
    file: {
      buffer: params.docx,
      originalname: params.filename,
      mimetype: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      size: params.docx.length,
    },
    uploadedBy: params.actorId,
  });

  await db.legalDocumentVersion.create({
    data: {
      id: versionId,
      legalDocumentId: document.id,
      versionNumber,
      attachmentId: source.id,
      contentHash: source.contentHash,
      status: LegalDocumentVersionStatus.PUBLISHED,
      effectiveAt: now,
      publishedAt: now,
      publishedBy: params.actorId,
      createdBy: params.actorId,
    },
  });

  await storeAttachment(db, {
    ownerType: OWNER,
    ownerId: versionId,
    attachmentType: AttachmentType.GENERATED_FORM,
    file: {
      buffer: pdf,
      originalname: `${params.documentCode} ${document.nameTh}.pdf`,
      mimetype: "application/pdf",
      size: pdf.length,
    },
    uploadedBy: params.actorId,
  });

  if (document.status !== LegalDocumentStatus.ACTIVE) {
    await db.legalDocument.update({
      where: { id: document.id },
      data: { status: LegalDocumentStatus.ACTIVE },
    });
  }

  return { versionId, versionNumber, placeholders, deprecatedPlaceholders: deprecated };
}
