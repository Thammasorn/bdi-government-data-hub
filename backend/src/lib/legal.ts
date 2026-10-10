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
  ConfirmationType,
  LegalDocumentStatus,
  LegalDocumentVersionStatus,
  RequestStatus,
  ReviewResult,
  ReviewTaskStatus,
  ReviewTaskType,
  SubjectType,
  type Prisma,
  type PrismaClient,
} from "@prisma/client";

import {
  activeAttachment,
  activeRenderedDocument,
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
  normaliseTemplate,
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
  /**
   * ชื่อสั้นที่ผู้ใช้เห็นแทนรหัส — null สำหรับฉบับที่ไม่ได้ตั้งไว้ (A4)
   *
   * `code` (A0–A4) เป็นรหัสภายใน หน้าจอไม่พิมพ์มันออกมาอีกแล้วตั้งแต่ 2026-09-06
   * แต่ API ยังส่งไปด้วย เพราะการข้าม "ไม่เกี่ยวข้อง" เทียบด้วยรหัส ไม่ใช่ชื่อ
   */
  shortname: string | null;
  /** ข้อความเตือนใต้บรรทัด "เอกสารฉบับที่ n จาก m" — ไม่ใช่เนื้อเอกสาร */
  legalNotice: string | null;
  displayOrder: number;
  versionId: string;
  versionNumber: number;
  /** วันที่เวอร์ชันนี้เริ่มมีผล — เอกสารพิมพ์ค่านี้ได้ผ่าน {{document.effectiveDate}} */
  effectiveAt: Date | null;
  /** PDF ที่ render ไว้ให้เปิดอ่าน — ผนวกที่ไม่มีช่องให้เติมใช้ไฟล์นี้ได้ตรง ๆ */
  pdfAttachmentId: string | null;
  /** true = เอกสารมี placeholder จึงต้อง render ใหม่ต่อคำขอ ไม่ใช้ไฟล์กลาง */
  hasPlaceholders: boolean;
  /**
   * false = ผู้มีอำนาจกดข้าม "ไม่เกี่ยวข้อง" ได้ ไม่ต้องเห็นชอบก็ลงนามผ่าน
   *
   * คอลัมน์ `legal_document.is_required` มีมาตั้งแต่ต้นตามดีไซน์ แต่ไม่เคยมีใครอ่าน —
   * `seed-masters.ts` ตั้งเป็น true ให้ทุกฉบับแล้วจบ ตอนนี้แอดมินสลับได้ผ่าน
   * `PATCH /api/admin/legal-documents/:code`
   */
  isRequired: boolean;
}

/** แถวที่ `publishedDocuments()` อ่านจากฐานข้อมูล ก่อนไปเปิดไฟล์ — ใช้ตอนเขียน snapshot ซึ่งไม่ต้องการไฟล์ */
interface DocumentVersionRow {
  document: {
    documentCode: string;
    nameTh: string;
    shortname: string | null;
    legalNotice: string | null;
    applicationScope: string;
  };
  version: { id: string; versionNumber: number; effectiveAt: Date | null };
  displayOrder: number;
  isRequired: boolean;
}

/**
 * เอกสารที่ "แสดงให้ผู้ใช้ยอมรับได้" ตามตารางท้าย sheet legal_document_version:
 * document ACTIVE + version PUBLISHED เท่านั้น
 */
async function publishedRows(db: Db, scope: LegalScope): Promise<DocumentVersionRow[]> {
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

  return documents.flatMap((doc) => {
    const version = doc.versions[0];
    if (!version) return [];
    return [
      {
        document: doc,
        version,
        displayOrder: doc.displayOrder,
        isRequired: doc.isRequired,
      },
    ];
  });
}

/** เปิดไฟล์ของเวอร์ชันหนึ่งแล้วประกอบเป็น `PublishedDocument` — ใช้ร่วมกันทั้งชุดล่าสุดและชุดที่คำขอถืออยู่ */
async function toPublishedDocument(db: Db, row: DocumentVersionRow): Promise<PublishedDocument> {
  const { document: doc, version } = row;
  const pdf = await activeAttachment(db, OWNER, version.id, AttachmentType.GENERATED_FORM);
  const source = await activeAttachment(db, OWNER, version.id, AttachmentType.LEGAL_DOCUMENT);
  return {
    code: doc.documentCode,
    nameTh: doc.nameTh,
    shortname: doc.shortname,
    legalNotice: doc.legalNotice,
    displayOrder: row.displayOrder,
    isRequired: row.isRequired,
    versionId: version.id,
    versionNumber: version.versionNumber,
    effectiveAt: version.effectiveAt,
    pdfAttachmentId: pdf?.id ?? null,
    hasPlaceholders: source
      ? assertKnownPlaceholders(await readAttachment(source), variableScopeOf(doc.applicationScope)).length > 0
      : false,
  };
}

/**
 * ชุดเอกสาร**ล่าสุด**ของ scope หนึ่ง — document ACTIVE + version PUBLISHED
 *
 * นี่คือสิ่งที่คำขอ**ที่ยังไม่ได้นำส่ง**เห็น และสิ่งที่การนำส่งจะบันทึกไว้ (`pinRequestDocuments()`) คำขอที่นำส่งไปแล้ว
 * ต้องอ่านผ่าน `documentsForRequest()` แทน ไม่งั้นฝ่ายกฎหมายเปลี่ยนเอกสารใต้คำขอที่กำลังเดินอยู่ได้
 */
export async function publishedDocuments(
  db: Db,
  scope: LegalScope,
): Promise<PublishedDocument[]> {
  const rows = await publishedRows(db, scope);
  const out: PublishedDocument[] = [];
  for (const row of rows) out.push(await toPublishedDocument(db, row));
  return out;
}

/** คำขอหนึ่งใบที่เอกสารผูกอยู่ด้วย — review_task, signature_confirmation ใช้คู่นี้ชี้ */
export interface DocumentSubject {
  subjectType: SubjectType;
  subjectId: string;
}

/**
 * รหัสเอกสารที่ผู้กรอกยังไม่ได้เห็นฉบับล่าสุดของมัน — มี placeholder แต่ยังไม่มี PDF ที่ render จากเวอร์ชันที่เผยแพร่อยู่ตอนนี้
 *
 * ใช้ก่อนนำส่ง: การนำส่งบันทึกเวอร์ชัน**ล่าสุด**ลง snapshot ถ้าฝ่ายกฎหมายเผยแพร่ฉบับใหม่หลังจากที่ผู้กรอกกดสร้าง PDF ไปแล้ว
 * เขาจะนำส่งโดยไม่เคยเห็นเอกสารที่ตัวเองผูกพันอยู่ ต้องกดสร้างใหม่ก่อน (ฉบับที่ไม่มี placeholder ไม่ต้องตรวจ — ไฟล์กลางของเวอร์ชัน)
 */
export async function documentsAwaitingRender(
  db: Db,
  scope: LegalScope,
  ownerType: AttachmentOwnerType,
  requestId: string,
): Promise<string[]> {
  const latest = await publishedDocuments(db, scope);
  const missing: string[] = [];
  for (const doc of latest) {
    if (!doc.hasPlaceholders) continue;
    if (!(await activeRenderedDocument(db, ownerType, requestId, doc.versionId))) missing.push(doc.code);
  }
  return missing;
}

/** scope ของเอกสาร -> subject ของคำขอที่ใช้ scope นั้น (DATASET_REQUEST ยังไม่มีเส้นทาง) */
export const SUBJECT_OF_SCOPE: Record<LegalScope, SubjectType> = {
  ORGANIZATION_REGISTRATION: SubjectType.ORGANIZATION_REGISTRATION_REQUEST,
  DATASET_REGISTRATION: SubjectType.DATASET_REGISTRATION_REQUEST,
};

/**
 * บันทึกว่าการนำส่งครั้งนี้ใช้เอกสารฉบับไหนเวอร์ชันไหน — เรียกใน transaction เดียวกับที่ตั้ง `submitted_at`
 *
 * เขียนเป็นชุดใหม่ (`submission_no` ถัดไป) ทุกครั้งที่นำส่ง คำขอที่ถูกส่งกลับแล้วนำส่งใหม่จึงได้เอกสารเวอร์ชันล่าสุด ณ ตอนนั้น
 * ส่วนชุดเก่าเก็บไว้เป็นประวัติ ไม่ลบ — ชุดที่ใช้อยู่คือเลขสูงสุดของคำขอ (`pinnedDocuments()`)
 *
 * อ่านเฉพาะแถวในฐานข้อมูล ไม่เปิดไฟล์ จึงอยู่ใน transaction ได้โดยไม่ชนเวลา 5 วินาทีของ Prisma
 */
export async function pinRequestDocuments(
  db: Db,
  scope: LegalScope,
  subject: DocumentSubject,
): Promise<{ submissionNo: number; codes: string[] }> {
  const rows = await publishedRows(db, scope);
  if (rows.length === 0) {
    throw new DocumentRenderError(
      "no_legal_documents",
      "ยังไม่มีเอกสารที่เกี่ยวข้องที่เผยแพร่ในระบบ กรุณาแจ้งผู้ดูแลระบบ",
      503,
    );
  }
  const last = await db.requestDocumentSnapshot.aggregate({
    where: subject,
    _max: { submissionNo: true },
  });
  const submissionNo = (last._max.submissionNo ?? 0) + 1;
  await db.requestDocumentSnapshot.createMany({
    data: rows.map((row) => ({
      ...subject,
      submissionNo,
      legalDocumentVersionId: row.version.id,
      displayOrder: row.displayOrder,
      isRequired: row.isRequired,
    })),
  });
  return { submissionNo, codes: rows.map((r) => r.document.documentCode) };
}

/**
 * บันทึกชุดเอกสารให้คำขอที่นำส่งไปแล้วก่อนจะมี `request_document_snapshot` — ใช้โดย `backfill:document-snapshots` และ `seed:demo`
 *
 * ต่อฉบับ: ถ้าคำขอนี้เคยบันทึก `legal_acceptance` ไว้กับเอกสารฉบับนั้น ใช้เวอร์ชันที่เขารับไว้จริง (ผู้ลงนามเห็นไฟล์นั้น);
 * ถ้าไม่เคย ใช้เวอร์ชันที่เผยแพร่อยู่ตอนนี้ — เป็นการยึดตามที่เห็นได้ตอนนี้ ไม่ใช่ตามที่หน่วยงานเห็นตอนกดนำส่งจริง ซึ่งย้อนรู้ไม่ได้
 * ฉบับที่ปิดใช้หรือไม่มีเวอร์ชันที่เผยแพร่อยู่ตอนนี้ไม่ถูกใส่ เว้นแต่คำขอนี้เคยรับไว้
 *
 * คืนรายการที่จะบันทึก ไม่เขียนเมื่อ `write: false` — สคริปต์ใช้พิมพ์รายงานก่อน
 */
export async function pinSubmittedRequest(
  db: Db,
  scope: LegalScope,
  subject: DocumentSubject,
  options: { write: boolean },
): Promise<Array<{ code: string; versionNumber: number; latestVersionNumber: number | null; accepted: boolean }>> {
  const latest = await publishedRows(db, scope);
  const acceptances = await db.legalAcceptance.findMany({
    where: subject,
    orderBy: { acceptedAt: "desc" },
    select: {
      legalDocumentVersion: {
        select: {
          id: true,
          versionNumber: true,
          legalDocument: { select: { documentCode: true, displayOrder: true, isRequired: true } },
        },
      },
    },
  });
  const acceptedByCode = new Map<
    string,
    { id: string; versionNumber: number; displayOrder: number; isRequired: boolean }
  >();
  for (const a of acceptances) {
    const v = a.legalDocumentVersion;
    const code = v.legalDocument.documentCode;
    if (!acceptedByCode.has(code)) {
      acceptedByCode.set(code, {
        id: v.id,
        versionNumber: v.versionNumber,
        displayOrder: v.legalDocument.displayOrder,
        isRequired: v.legalDocument.isRequired,
      });
    }
  }

  const picks = new Map<
    string,
    { versionId: string; versionNumber: number; displayOrder: number; isRequired: boolean; accepted: boolean }
  >();
  for (const row of latest) {
    picks.set(row.document.documentCode, {
      versionId: row.version.id,
      versionNumber: row.version.versionNumber,
      displayOrder: row.displayOrder,
      isRequired: row.isRequired,
      accepted: false,
    });
  }
  for (const [code, a] of acceptedByCode) {
    picks.set(code, {
      versionId: a.id,
      versionNumber: a.versionNumber,
      displayOrder: a.displayOrder,
      isRequired: a.isRequired,
      accepted: true,
    });
  }

  const result = [...picks.entries()]
    .sort(([, a], [, b]) => a.displayOrder - b.displayOrder)
    .map(([code, p]) => ({
      code,
      versionNumber: p.versionNumber,
      latestVersionNumber: latest.find((r) => r.document.documentCode === code)?.version.versionNumber ?? null,
      accepted: p.accepted,
      pick: p,
    }));

  if (options.write && result.length > 0) {
    const last = await db.requestDocumentSnapshot.aggregate({ where: subject, _max: { submissionNo: true } });
    const submissionNo = (last._max.submissionNo ?? 0) + 1;
    await db.requestDocumentSnapshot.createMany({
      data: result.map(({ pick }) => ({
        ...subject,
        submissionNo,
        legalDocumentVersionId: pick.versionId,
        displayOrder: pick.displayOrder,
        isRequired: pick.isRequired,
      })),
    });
  }
  return result.map(({ pick: _pick, ...rest }) => rest);
}

/**
 * ชุดเอกสารที่คำขอถืออยู่ตามการนำส่งครั้งล่าสุด — null ถ้าไม่เคยบันทึก
 *
 * ไม่กรองด้วยสถานะของเอกสาร: เอกสารที่ถูกปิดใช้ (RETIRED) หลังจากนั้นยังต้องอยู่ในชุดของคำขอที่นำส่งไปแล้ว และเวอร์ชันที่ถูก
 * SUPERSEDED ก็ต้องยังเปิดอ่านได้ เพราะคำขอนี้ยังถือฉบับนั้นอยู่
 */
async function pinnedDocuments(db: Db, subject: DocumentSubject): Promise<PublishedDocument[] | null> {
  const last = await db.requestDocumentSnapshot.aggregate({
    where: subject,
    _max: { submissionNo: true },
  });
  if (last._max.submissionNo === null) return null;

  const rows = await db.requestDocumentSnapshot.findMany({
    where: { ...subject, submissionNo: last._max.submissionNo },
    orderBy: { displayOrder: "asc" },
    include: {
      legalDocumentVersion: {
        select: {
          id: true,
          versionNumber: true,
          effectiveAt: true,
          legalDocument: {
            select: {
              documentCode: true,
              nameTh: true,
              shortname: true,
              legalNotice: true,
              applicationScope: true,
            },
          },
        },
      },
    },
  });

  const out: PublishedDocument[] = [];
  for (const row of rows) {
    const { legalDocument, ...version } = row.legalDocumentVersion;
    out.push(
      await toPublishedDocument(db, {
        document: legalDocument,
        version,
        displayOrder: row.displayOrder,
        isRequired: row.isRequired,
      }),
    );
  }
  return out;
}

/** คำขอนี้อยู่ในมือหน่วยงาน (ฉบับร่างหรือถูกส่งกลับ) หรือไม่ — ถ้าใช่ ชุดเอกสารยังเปลี่ยนตามล่าสุดได้จนกว่าจะนำส่ง */
async function withOrganisation(db: Db, subject: DocumentSubject): Promise<boolean> {
  const select = { status: true } as const;
  const row =
    subject.subjectType === SubjectType.ORGANIZATION_REGISTRATION_REQUEST
      ? await db.organizationRegistrationRequest.findUnique({ where: { id: subject.subjectId }, select })
      : await db.datasetRegistrationRequest.findUnique({ where: { id: subject.subjectId }, select });
  return !row || row.status === RequestStatus.DRAFT || row.status === RequestStatus.RETURNED;
}

/**
 * ชุดเอกสารของคำขอหนึ่งใบ — **จุดอ่านเดียว** ของทุกที่ที่แสดง ลงนาม render หรือดาวน์โหลดเอกสารของคำขอ
 *
 * - ฉบับร่าง / ถูกส่งกลับ: ชุดล่าสุดที่เผยแพร่ (`publishedDocuments`) — หน่วยงานยังแก้ฟอร์มและสร้าง PDF ใหม่ได้
 * - นำส่งแล้ว: ชุดที่บันทึกตอนกดนำส่ง ต่อให้ฝ่ายกฎหมายเผยแพร่เวอร์ชันใหม่ เพิ่ม หรือปิดเอกสารภายหลัง
 * - นำส่งแล้วแต่ไม่มี snapshot (คำขอก่อนมี `request_document_snapshot` ที่ยังไม่ได้รัน `backfill:document-snapshots`):
 *   ตกกลับไปใช้ชุดล่าสุดเหมือนเดิม ไม่พัง
 */
export async function documentsForRequest(
  db: Db,
  scope: LegalScope,
  subject: DocumentSubject,
): Promise<PublishedDocument[]> {
  if (!(await withOrganisation(db, subject))) {
    const pinned = await pinnedDocuments(db, subject);
    if (pinned) return pinned;
  }
  return publishedDocuments(db, scope);
}

/**
 * ฉบับที่หน่วยงานกด "ไม่เกี่ยวข้อง" ไปแล้ว คืนมาเป็นชุดของ**รหัสเอกสาร** ไม่ใช่ version id
 *
 * เทียบด้วยรหัสเพราะการตัดสินใจของหน่วยงานเป็นเรื่องของ**ตัวเอกสาร** ไม่ใช่ของเวอร์ชัน —
 * เขาบอกว่า "A3 ไม่เกี่ยวกับหน่วยงานเรา" ไม่ได้บอกว่า "A3 ฉบับลงวันที่นี้ไม่เกี่ยว"
 * ถ้าฝ่ายกฎหมายเผยแพร่ A3 เวอร์ชันใหม่หลังจากนั้น มันต้องยังถูกข้ามอยู่ ไม่ใช่โผล่กลับมา
 *
 * **แต่การกดนั้นมีอายุเท่ารอบของมัน** — รอบที่ถูกยกเลิกไม่เหลือการตัดสินใจอะไรไว้เลย
 */
async function skippedDocumentCodes(db: Db, subject: DocumentSubject): Promise<Set<string>> {
  const confirmation = await db.signatureConfirmation.findFirst({
    where: { ...subject, confirmationType: ConfirmationType.ORGANIZATION_APPROVAL },
    orderBy: { confirmedAt: "desc" },
    select: {
      confirmationPayloadJson: true,
      reviewTask: { select: { sequenceNumber: true } },
    },
  });
  if (!confirmation) return new Set();

  /**
   * ผู้อนุมัติ BDI ส่งกลับ = ยกเลิกการเห็นชอบ**และการตัดสินใจทั้งหมด**ของผู้มีอำนาจของ
   * หน่วยงานไปด้วย (BDI ตัดสินเมื่อ 2026-09-20) ชุดเอกสารจึงกลับมาครบทุกฉบับ ผนวก 3 รวมอยู่ด้วย
   *
   * ทุกแถวที่ `sequence_number` ไม่เกินการส่งกลับครั้งล่าสุดเป็นของรอบที่การส่งกลับนั้นล้างทิ้ง
   * กฎเดียวกับ `lastReturnSequence()` ใน lib/journey-steps.ts ซึ่งตัดสินเรื่องเดียวกันให้ stepper
   * และเป็นเหตุผลที่เทียบด้วยลำดับ ไม่ใช่เวลา — `confirmed_at` กับ `completed_at` เขียนคนละ
   * จังหวะกันในทรานแซกชันเดียว ส่วน `signature_confirmation.review_task_id` เป็น FK จริง
   *
   * นับ `CANCELLED` ด้วย ไม่ใช่แค่ `RETURNED` เพราะ reset ของแอดมิน
   * (`/api/admin/registrations/.../reset`) กับ `revertStrandedWork()` ปิดด่านแบบนั้นและไม่ทิ้งแถว
   * `RETURNED` ไว้เลย — รอบก็ถูกยกเลิกเหมือนกัน การ recall ของเจ้าหน้าที่ BDI ปิดแบบนั้นเช่นกัน
   * แต่ `recallRefusal()` ยอมเฉพาะตอน task ยัง `PENDING` ซึ่งยังไม่มีใบลงนามให้ยกเลิกอยู่แล้ว
   */
  const lastVoid = await db.reviewTask.findFirst({
    where: {
      ...subject,
      OR: [{ result: ReviewResult.RETURNED }, { status: ReviewTaskStatus.CANCELLED }],
    },
    orderBy: { sequenceNumber: "desc" },
    select: { sequenceNumber: true },
  });
  if (lastVoid && confirmation.reviewTask.sequenceNumber <= lastVoid.sequenceNumber) {
    return new Set();
  }

  // การลงนามที่เกิดก่อนมีฟีเจอร์นี้ไม่มีคีย์นี้ใน payload — ไม่ได้ข้ามอะไรไว้
  const payload = confirmation.confirmationPayloadJson as { notApplicableVersionIds?: unknown } | null;
  const ids = Array.isArray(payload?.notApplicableVersionIds)
    ? payload.notApplicableVersionIds.filter((v): v is string => typeof v === "string")
    : [];
  if (ids.length === 0) return new Set();

  const versions = await db.legalDocumentVersion.findMany({
    where: { id: { in: ids } },
    select: { legalDocument: { select: { documentCode: true } } },
  });
  return new Set(versions.map((v) => v.legalDocument.documentCode));
}

/**
 * ชุดเอกสารของคำขอหนึ่งใบ = ที่เผยแพร่อยู่ ลบฉบับที่หน่วยงานระบุว่าไม่เกี่ยวข้องกับตัวเอง
 *
 * มีที่เดียวเพราะสองที่ต้องตอบเท่ากันเสมอ: รายการที่หน้าจอเอาไปแสดงกับด่านตรวจตอนกด
 * ลงนาม ถ้าแยกกันคำนวณ ด่านหลังจะตัดฉบับที่ถูกข้ามออกเงียบ ๆ ในขณะที่หน้าจอยังโชว์มัน
 * อยู่ — ผู้อนุมัติ BDI จึงอ่านและนึกว่าตัวเองลงนามฉบับที่ไม่มีใครฝั่งหน่วยงานยอมรับ
 *
 * **ระหว่างที่ด่านผู้มีอำนาจของหน่วยงานยังเปิดอยู่ ไม่กรองอะไรทั้งนั้น** — คำขอที่ถูกตีกลับ
 * มาให้แก้แล้วส่งกลับขึ้นไปใหม่ จะเปิด task ลงนามใบใหม่ให้เขาเลือกทั้งชุดอีกครั้ง ถ้ายึด
 * การกด "ไม่เกี่ยวข้อง" ของรอบก่อนไว้ เขาจะเปลี่ยนใจกลับมาเห็นชอบฉบับนั้นไม่ได้เลย
 *
 * ด่านที่ยังเปิดอยู่เป็นแค่ครึ่งเดียวของกฎนั้น อีกครึ่งอยู่ใน `skippedDocumentCodes()` —
 * ตั้งแต่วินาทีที่ผู้อนุมัติ BDI กดส่งกลับ จนถึงวินาทีที่ด่านลงนามใบใหม่เปิด **ไม่มี task
 * ไหนเปิดอยู่เลย** ช่วงนั้นคือตอนที่หน่วยงานกำลังแก้ฟอร์มและเปิดดูเอกสารของตัวเอง ซึ่งเคย
 * เห็นแค่ 3 ฉบับเพราะยังยึดการกดข้ามของรอบที่ถูกยกเลิกไปแล้ว
 */
export async function requestDocuments(
  db: Db,
  scope: LegalScope,
  subject: DocumentSubject,
): Promise<{ documents: PublishedDocument[]; notApplicable: PublishedDocument[] }> {
  const published = await documentsForRequest(db, scope, subject);

  const signingNow = await db.reviewTask.findFirst({
    where: {
      ...subject,
      taskType: ReviewTaskType.ORGANIZATION_APPROVAL,
      status: { in: [ReviewTaskStatus.PENDING, ReviewTaskStatus.IN_PROGRESS] },
    },
    select: { id: true },
  });
  if (signingNow) return { documents: published, notApplicable: [] };

  const skipped = await skippedDocumentCodes(db, subject);
  if (skipped.size === 0) return { documents: published, notApplicable: [] };

  return {
    documents: published.filter((d) => !skipped.has(d.code)),
    notApplicable: published.filter((d) => skipped.has(d.code)),
  };
}

/** .docx ต้นแบบของเวอร์ชันหนึ่ง — สิ่งที่เอาไปเติมค่าแล้ว render */
export async function templateDocx(db: Db, versionId: string): Promise<Buffer> {
  const source = await templateAttachment(db, versionId);
  return readAttachment(source);
}

/**
 * แถว attachment ของ .docx ต้นแบบของเวอร์ชันหนึ่ง — หน้า /console ดาวน์โหลดไฟล์นี้ตรง ๆ
 * (`GET /api/admin/legal-documents/:code/versions/:versionId/file`)
 */
export async function templateAttachment(db: Db, versionId: string) {
  const source = await activeAttachment(db, OWNER, versionId, AttachmentType.LEGAL_DOCUMENT);
  if (!source) {
    throw new DocumentRenderError(
      "template_missing",
      "ยังไม่มีไฟล์ต้นแบบของเอกสารฉบับนี้ในระบบ กรุณาแจ้งผู้ดูแลระบบให้อัปโหลดเอกสาร",
      503,
    );
  }
  return source;
}

/** เวอร์ชันอื่นของเอกสารที่ยัง PUBLISHED อยู่กลายเป็น SUPERSEDED — ให้เหลือฉบับที่เผยแพร่ได้ฉบับเดียวเสมอ */
async function supersedeOthers(db: Db, documentId: string, keepVersionId: string) {
  await db.legalDocumentVersion.updateMany({
    where: {
      legalDocumentId: documentId,
      status: LegalDocumentVersionStatus.PUBLISHED,
      id: { not: keepVersionId },
    },
    data: { status: LegalDocumentVersionStatus.SUPERSEDED, supersededAt: new Date() },
  });
}

/**
 * ใช้เวอร์ชันที่มีอยู่แล้วเป็นฉบับที่เผยแพร่ — ฉบับที่เผยแพร่อยู่เดิมกลายเป็น SUPERSEDED ไม่สร้างเวอร์ชันใหม่
 *
 * รับ DRAFT ("ใช้เวอร์ชันนี้") และ SUPERSEDED ("เผยแพร่อีกครั้ง") — แถวเดิมกลับเป็น PUBLISHED เลขเวอร์ชันและไฟล์ไม่เปลี่ยน
 * `legal_acceptance` และ snapshot ของคำขอที่ชี้เวอร์ชันนี้อยู่จึงยังชี้ตัวเดิม (เดิม restore ออกเป็นเวอร์ชัน N+1 ที่เนื้อหาเหมือนกัน)
 * `supersededAt` ถูกล้าง เพราะเวอร์ชันนี้กลับมาเป็นฉบับปัจจุบันแล้ว
 */
export async function activateVersion(db: Db, versionId: string, actorId: string) {
  const now = new Date();
  const version = await db.legalDocumentVersion.update({
    where: { id: versionId },
    data: {
      status: LegalDocumentVersionStatus.PUBLISHED,
      effectiveAt: now,
      publishedAt: now,
      publishedBy: actorId,
      supersededAt: null,
    },
  });
  await supersedeOthers(db, version.legalDocumentId, versionId);
  return version;
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
  params: {
    documentCode: string;
    docx: Buffer;
    filename: string;
    actorId: string;
    /**
     * `DRAFT` = เก็บเป็นฉบับร่างโดยไม่เผยแพร่ ไม่แตะเวอร์ชันที่ใช้อยู่ (ติ๊ก "ใช้ทันที" ออกในหน้า /console) ค่าตั้งต้นคือเผยแพร่ทันที
     * ฉบับร่างเผยแพร่ภายหลังด้วย `activateVersion()`
     */
    status?: "PUBLISHED" | "DRAFT";
  },
): Promise<{
  versionId: string;
  versionNumber: number;
  placeholders: string[];
  deprecatedPlaceholders: string[];
  /** สิ่งที่ `normaliseTemplate()` แก้ให้ก่อนเก็บ — หน้า /console บอกผู้อัปโหลด */
  normalised: { optionParagraphs: number; highlights: number };
}> {
  assertReadableDocx(params.docx);
  /**
   * จัดรูปก่อนทำอย่างอื่น — ตรวจ placeholder แปลง PDF และเก็บไฟล์ จากฉบับที่จัดรูปแล้วฉบับเดียว ไฟล์ที่ผู้ดูแลดาวน์โหลดกลับไป
   * ภายหลังจึงเป็นฉบับเดียวกับที่ระบบใช้จริง (เดิมต้องรัน docs/tools/normalise-template.py เองก่อนอัปโหลด)
   */
  const { docx, optionParagraphs, highlights } = normaliseTemplate(params.docx);

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
    docx,
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
    placeholders.length > 0 ? fillTemplate(docx, {}) : docx,
    params.filename,
  );

  const latest = await db.legalDocumentVersion.findFirst({
    where: { legalDocumentId: document.id },
    orderBy: { versionNumber: "desc" },
    select: { versionNumber: true },
  });
  const versionNumber = (latest?.versionNumber ?? 0) + 1;
  const publish = (params.status ?? "PUBLISHED") === "PUBLISHED";

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
      buffer: docx,
      originalname: params.filename,
      mimetype: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      size: docx.length,
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
      status: publish ? LegalDocumentVersionStatus.PUBLISHED : LegalDocumentVersionStatus.DRAFT,
      effectiveAt: publish ? now : null,
      publishedAt: publish ? now : null,
      publishedBy: publish ? params.actorId : null,
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

  /**
   * เวอร์ชันที่เผยแพร่อยู่กลายเป็น SUPERSEDED — ตาราง sheet บอกว่าสถานะนี้ "ไม่รับ acceptance ใหม่ ประวัติเดิมยังตรวจสอบได้"
   *
   * ทำ**หลัง**เก็บไฟล์และสร้างแถวใหม่แล้ว (เดิมทำก่อน): ถ้า storage ล้มกลางทาง ฉบับเดิมยังเผยแพร่อยู่ แทนที่เอกสารจะไม่มีฉบับ
   * ที่เผยแพร่เลยจนกว่าจะมีคนอัปโหลดซ้ำ ระหว่างนั้นมีสองแถวที่ PUBLISHED ได้ชั่วครู่ ซึ่งไม่มีใครเห็นต่าง —
   * `publishedDocuments()` อ่านเลขเวอร์ชันสูงสุดตัวเดียว
   *
   * **ไม่เปลี่ยนสถานะของเอกสาร** — เดิมเอกสารที่ไม่ใช่ ACTIVE ถูกเปิดใช้ให้เงียบ ๆ ตรงนี้ ซึ่งขัดกับการปิดใช้เอกสารจาก /console:
   * เอกสารที่ปิดใช้ไว้ยังอัปโหลดเวอร์ชันใหม่ได้โดยไม่ถูกเปิดกลับมา เปิดใช้ด้วย `PATCH …/legal-documents/:code` `isActive` เท่านั้น
   * (`seed:masters` ที่สร้างเอกสารเป็น DRAFT เปิดใช้เองหลังเผยแพร่เวอร์ชันแรก)
   */
  if (publish) await supersedeOthers(db, document.id, versionId);

  return {
    versionId,
    versionNumber,
    placeholders,
    deprecatedPlaceholders: deprecated,
    normalised: { optionParagraphs, highlights },
  };
}
