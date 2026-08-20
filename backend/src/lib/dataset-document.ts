/**
 * สร้างเอกสารของคำขอลงทะเบียนชุดข้อมูล (A4 แบบนำส่งข้อมูล) จาก template ที่เผยแพร่อยู่
 *
 * โครงเหมือน lib/organization-agreement.ts ของเส้นทาง B ทุกอย่าง ต่างกันแค่ scope ของ
 * เอกสารกับชุดข้อมูลที่เอาไปเติม — ฉบับไหนมี placeholder ก็ถูก render ต่อคำขอและเก็บ
 * แยกไฟล์กัน (คีย์ด้วย legal_document_version_id) ฉบับที่ไม่มีใช้ไฟล์กลางร่วมกัน
 *
 * ลายมือชื่ออ่านจาก signature.signature_confirmation ที่ snapshot ชื่อไว้ ณ เวลาลงนาม
 * ไม่ใช่จากบัญชีผู้ใช้สด ๆ — เอกสารที่ลงนามแล้วต้องไม่เปลี่ยนตามเมื่อผู้ใช้แก้โปรไฟล์
 */
import {
  AttachmentOwnerType,
  AttachmentType,
  ConfirmationType,
  SubjectType,
  type Prisma,
  type PrismaClient,
} from "@prisma/client";

import { publicAttachment, storeAttachment } from "./attachment.js";
import { DocumentRenderError, renderTemplateToPdf } from "./document-render.js";
import { datasetDocumentValues, type DatasetDocumentInput } from "./dataset-values.js";
import { LEGAL_SCOPES, publishedDocuments, templateDocx } from "./legal.js";

type Db = PrismaClient | Prisma.TransactionClient;

const OWNER = AttachmentOwnerType.DATASET_REGISTRATION_REQUEST;
const SUBJECT = SubjectType.DATASET_REGISTRATION_REQUEST;

/** รหัสเอกสารหลักของเส้นทางนี้ — แบบนำส่งข้อมูล */
export const DATASET_FORM_CODE = "A4";

export type DatasetDocumentRequest = Omit<
  DatasetDocumentInput,
  | "approverSignedName"
  | "approverSignedAt"
  | "bdiSignedName"
  | "bdiSignedFirstName"
  | "bdiSignedLastName"
  | "bdiSignedAt"
  | "printedByName"
  | "printedAt"
> & { id: string };

async function signaturesOf(db: Db, requestId: string) {
  const rows = await db.signatureConfirmation.findMany({
    where: { subjectType: SUBJECT, subjectId: requestId },
    orderBy: { confirmedAt: "asc" },
    include: { userAccount: { select: { displayName: true } } },
  });

  const pick = (type: ConfirmationType) => {
    const row = rows.filter((r) => r.confirmationType === type).at(-1);
    if (!row) return { name: null, firstName: null, lastName: null, at: null };
    const payload = row.confirmationPayloadJson as {
      signedName?: string;
      signedFirstName?: string;
      signedLastName?: string;
    } | null;
    const name = payload?.signedName ?? row.userAccount.displayName;
    const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
    return {
      name,
      firstName: payload?.signedFirstName ?? (parts.length >= 2 ? parts.at(-2)! : null),
      lastName: payload?.signedLastName ?? (parts.length >= 2 ? parts.at(-1)! : null),
      at: row.confirmedAt,
    };
  };

  return {
    approver: pick(ConfirmationType.ORGANIZATION_APPROVAL),
    bdi: pick(ConfirmationType.BDI_FINAL_APPROVAL),
  };
}

/** เวอร์ชันที่เผยแพร่อยู่ของ A4 */
export async function datasetFormVersion(db: Db) {
  const documents = await publishedDocuments(db, LEGAL_SCOPES.DATASET_REGISTRATION);
  const form = documents.find((d) => d.code === DATASET_FORM_CODE);
  if (!form) {
    throw new DocumentRenderError(
      "form_not_published",
      `ยังไม่มีเอกสาร ${DATASET_FORM_CODE} ที่เผยแพร่ในระบบ กรุณาแจ้งผู้ดูแลระบบให้อัปโหลดเอกสารต้นแบบ`,
      503,
    );
  }
  return form;
}

/** เติมข้อมูลของคำขอลงในเอกสารฉบับหนึ่ง แล้วเก็บเป็นไฟล์ของคำขอ */
export async function renderDatasetDocument(
  db: Db,
  params: {
    request: DatasetDocumentRequest;
    document: { code: string; nameTh: string; versionId: string };
    printedByName: string | null;
    actorId: string;
  },
) {
  const docx = await templateDocx(db, params.document.versionId);
  const signatures = await signaturesOf(db, params.request.id);

  const values = datasetDocumentValues({
    ...params.request,
    approverSignedName: signatures.approver.name,
    approverSignedAt: signatures.approver.at,
    bdiSignedName: signatures.bdi.name,
    bdiSignedFirstName: signatures.bdi.firstName,
    bdiSignedLastName: signatures.bdi.lastName,
    bdiSignedAt: signatures.bdi.at,
    printedByName: params.printedByName,
    printedAt: new Date(),
  });

  const pdf = await renderTemplateToPdf(docx, values, `${params.document.code}.docx`);

  const attachment = await storeAttachment(db, {
    ownerType: OWNER,
    ownerId: params.request.id,
    attachmentType: AttachmentType.GENERATED_FORM,
    legalDocumentVersionId: params.document.versionId,
    file: {
      buffer: pdf,
      originalname: `${params.document.code} ${params.document.nameTh}-${params.request.requestNumber ?? "คำขอ"}.pdf`,
      mimetype: "application/pdf",
      size: pdf.length,
    },
    uploadedBy: params.actorId,
  });

  return { attachment: publicAttachment(attachment), versionId: params.document.versionId };
}

/** render ทุกฉบับของ scope นี้ที่มี placeholder — คืนรหัสเอกสารที่สร้าง */
export async function renderDatasetDocuments(
  db: Db,
  params: { request: DatasetDocumentRequest; printedByName: string | null; actorId: string },
): Promise<string[]> {
  const documents = await publishedDocuments(db, LEGAL_SCOPES.DATASET_REGISTRATION);
  const rendered: string[] = [];
  for (const doc of documents) {
    if (!doc.hasPlaceholders) continue;
    await renderDatasetDocument(db, {
      request: params.request,
      document: { code: doc.code, nameTh: doc.nameTh, versionId: doc.versionId },
      printedByName: params.printedByName,
      actorId: params.actorId,
    });
    rendered.push(doc.code);
  }
  return rendered;
}
