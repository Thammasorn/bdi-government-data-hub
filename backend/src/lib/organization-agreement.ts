/**
 * สร้างเอกสารกฎหมายของคำขอหนึ่งใบ จาก template ที่เผยแพร่อยู่
 *
 * ถูกเรียกสามจุดในเส้นทาง B และทุกจุดใช้ทางเดินเดียวกัน ต่างกันแค่ว่าตอนนั้นมีลายมือชื่อ
 * ของใครแล้ว:
 *
 *   1. ผู้กรอกกด "ตรวจสอบและสร้าง PDF"  → ยังไม่มีลายมือชื่อทั้งสองฝ่าย
 *   2. ผู้มีอำนาจกระทำการแทนลงนาม        → มีลายมือชื่อฝ่ายหน่วยงาน
 *   3. ผู้อนุมัติ BDI ลงนาม              → มีทั้งสองฝ่าย พร้อมตราเห็นชอบ
 *
 * **ไม่ผูกกับ A0 ฉบับเดียวอีกต่อไป** เอกสารฉบับไหนที่มี placeholder จะถูก render ด้วยข้อมูล
 * ของคำขอนั้นและเก็บแยกไฟล์กัน (คีย์ด้วย legal_document_version_id) ฉบับที่ไม่มี placeholder
 * ใช้ไฟล์กลางของเวอร์ชันที่เผยแพร่ร่วมกันทุกหน่วยงาน เพราะผลลัพธ์เหมือนกันหมด
 *
 * แต่ละครั้งเขียนทับ slot ของเอกสารฉบับนั้นในคำขอ ซึ่ง storeAttachment() จะเปลี่ยนไฟล์เดิม
 * เป็น REPLACED ไม่ได้ลบ — ฉบับก่อนลงนามจึงยังตรวจย้อนได้ว่าหน่วยงานเห็นอะไรตอนกดนำส่ง
 *
 * **ลายมือชื่อไม่ได้คำนวณสดจากบัญชีผู้ใช้** แต่อ่านจาก signature.signature_confirmation
 * ที่บันทึกชื่อไว้ ณ เวลาลงนาม ถ้าผู้ใช้เปลี่ยนชื่อภายหลัง เอกสารที่ลงนามแล้วต้องไม่เปลี่ยนตาม
 */
import {
  AttachmentOwnerType,
  AttachmentStatus,
  AttachmentType,
  ConfirmationType,
  SubjectType,
  type Prisma,
  type PrismaClient,
} from "@prisma/client";

import { publicAttachment, storeAttachment } from "./attachment.js";
import { DocumentRenderError, renderTemplateToPdf } from "./document-render.js";
import { LEGAL_SCOPES, publishedDocuments, templateDocx } from "./legal.js";
import { agreementValues, type AgreementInput } from "./legal-values.js";
import { BDI_ORGANIZATION_ID } from "./system.js";

type Db = PrismaClient | Prisma.TransactionClient;

const OWNER = AttachmentOwnerType.ORGANIZATION_REGISTRATION_REQUEST;
const SUBJECT = SubjectType.ORGANIZATION_REGISTRATION_REQUEST;

/** รหัสเอกสารที่เป็นตัวข้อตกลงหลัก — ผนวก A1–A3 ไม่มีช่องให้เติมและไม่มีช่องลงนาม */
export const AGREEMENT_CODE = "A0";

/**
 * ข้อมูลคำขอในรูปที่ toApiShape() คืนมา
 *
 * เอาทุกช่องที่ตัวแปรของ template ใช้ได้ (ดู TEMPLATE_VARIABLES) ไม่ใช่เฉพาะที่ A0 ใช้ —
 * เอกสารฉบับใหม่หยิบช่องอื่นไปใช้ได้ทันทีโดยไม่ต้องแก้ไฟล์นี้
 */
export type AgreementRequest = Omit<
  AgreementInput,
  | "agreementDate"
  | "approverSignedName"
  | "approverSignedAt"
  | "bdiSignedName"
  | "bdiSignedFirstName"
  | "bdiSignedLastName"
  | "bdiSignedAt"
  | "officeName"
  | "officeEmail"
  | "officePhone"
  | "printedByName"
  | "printedAt"
  | "documentVersionNumber"
  | "documentEffectiveAt"
> & { id: string };

/**
 * ลายมือชื่อที่มีอยู่แล้วของคำขอนี้ — ชื่อและเวลาตามที่บันทึกไว้ตอนลงนาม
 * `signature_confirmation` มีได้ฝ่ายละหนึ่งแถวต่อคำขอ (หนึ่งแถวต่อ review_task)
 */
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
    // ชื่อที่ snapshot ไว้ใน payload มาก่อน displayName ปัจจุบันของบัญชี
    const name = payload?.signedName ?? row.userAccount.displayName;
    /**
     * แถวที่ลงนามก่อนจะเริ่มเก็บชื่อ-นามสกุลแยกกัน มีแต่ชื่อเต็ม — แยกจากช่องว่าง
     * แบบดีที่สุดที่ทำได้ (ชื่อเต็มคือ "คำนำหน้า ชื่อ นามสกุล") ไม่ใช่ไปอ่านจากบัญชีสด
     * เพราะเอกสารที่ลงนามแล้วต้องไม่เปลี่ยนตามเมื่อผู้ใช้แก้โปรไฟล์
     */
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

/** เวอร์ชันที่เผยแพร่อยู่ของ A0 — เอกสารที่จะถูกเติมค่าในรอบนี้ */
export async function agreementVersion(db: Db) {
  const documents = await publishedDocuments(db, LEGAL_SCOPES.ORGANIZATION_REGISTRATION);
  const agreement = documents.find((d) => d.code === AGREEMENT_CODE);
  if (!agreement) {
    throw new DocumentRenderError(
      "agreement_not_published",
      `ยังไม่มีเอกสาร ${AGREEMENT_CODE} ที่เผยแพร่ในระบบ กรุณาแจ้งผู้ดูแลระบบให้อัปโหลดเอกสารต้นแบบ`,
      503,
    );
  }
  return agreement;
}

/**
 * เติมข้อมูลของคำขอลงในเอกสารฉบับหนึ่ง แล้วเก็บเป็นไฟล์ของคำขอ
 *
 * คืน attachment ในรูปที่ส่งออก API ได้เลย พร้อม id ของเวอร์ชันที่ใช้ render
 */
export async function renderLegalDocument(
  db: Db,
  params: {
    request: AgreementRequest;
    /** เอกสารที่จะ render — ต้องเป็นเวอร์ชันที่เผยแพร่อยู่ */
    document: {
      code: string;
      nameTh: string;
      versionId: string;
      versionNumber: number;
      effectiveAt: Date | null;
    };
    /** ชื่อคนที่ทำให้เอกสารฉบับนี้ถูกสร้าง — ไปอยู่บรรทัด "พิมพ์จากระบบโดย" */
    printedByName: string | null;
    actorId: string;
  },
) {
  const docx = await templateDocx(db, params.document.versionId);
  const signatures = await signaturesOf(db, params.request.id);
  // ข้อมูลสำนักงานมาจากแถว organization ของ BDI เอง ไม่ได้ hardcode ทั้งชุด —
  // ที่ยัง hardcode คือช่องที่ตารางไม่มี (ที่อยู่ ชื่อผู้อำนวยการ) ดู OFFICE_DEFAULTS
  const office = await db.organization.findUnique({
    where: { id: BDI_ORGANIZATION_ID },
    select: { nameTh: true, email: true, phone: true },
  });
  const now = new Date();

  const values = agreementValues({
    ...params.request,
    // วันทำข้อตกลงคือวันที่หน่วยงานนำส่งคำขอ ไม่ใช่วันที่ render — ไม่อย่างนั้นเอกสาร
    // ฉบับที่ผู้อนุมัติเห็นจะลงวันที่คนละวันกับฉบับที่หน่วยงานกดนำส่ง
    agreementDate: params.request.submittedAt ?? now,
    approverSignedName: signatures.approver.name,
    approverSignedAt: signatures.approver.at,
    bdiSignedName: signatures.bdi.name,
    bdiSignedFirstName: signatures.bdi.firstName,
    bdiSignedLastName: signatures.bdi.lastName,
    bdiSignedAt: signatures.bdi.at,
    officeName: office?.nameTh ?? null,
    officeEmail: office?.email ?? null,
    officePhone: office?.phone ?? null,
    printedByName: params.printedByName,
    printedAt: now,
    documentVersionNumber: params.document.versionNumber,
    documentEffectiveAt: params.document.effectiveAt,
  });

  const pdf = await renderTemplateToPdf(docx, values, `${params.document.code}.docx`);

  /**
   * A0 ที่ถูกสร้างก่อนมีคอลัมน์ legal_document_version_id เก็บไว้ที่ slot เดียวกันแต่
   * เวอร์ชันเป็น NULL ซึ่ง Postgres นับว่าเป็นอีก slot — ถ้าไม่ปลดออกจะมีสองฉบับ ACTIVE
   * พร้อมกัน และหน้าจอจะหยิบฉบับไหนก็ได้
   */
  if (params.document.code === AGREEMENT_CODE) {
    await db.attachment.updateMany({
      where: {
        ownerType: OWNER,
        ownerId: params.request.id,
        attachmentType: AttachmentType.GENERATED_FORM,
        legalDocumentVersionId: null,
        status: AttachmentStatus.ACTIVE,
      },
      data: { status: AttachmentStatus.REPLACED },
    });
  }

  const attachment = await storeAttachment(db, {
    ownerType: OWNER,
    ownerId: params.request.id,
    attachmentType: AttachmentType.GENERATED_FORM,
    legalDocumentVersionId: params.document.versionId,
    file: {
      buffer: pdf,
      originalname: `${params.document.code} ${params.document.nameTh}-${params.request.name ?? "หน่วยงาน"}.pdf`,
      mimetype: "application/pdf",
      size: pdf.length,
    },
    uploadedBy: params.actorId,
  });

  return { attachment: publicAttachment(attachment), versionId: params.document.versionId };
}

/**
 * render ทุกฉบับที่มี placeholder ของคำขอหนึ่งใบ
 *
 * ใช้หลังลงนามทุกครั้ง: ลายมือชื่อที่เพิ่มเข้ามาต้องไปปรากฏในทุกฉบับที่มีช่องลงนาม
 * ไม่ใช่แค่ A0 — เอกสารฉบับอื่นอาจมี {{org_approver.signature}} อยู่ด้วย
 */
export async function renderPlaceholderDocuments(
  db: Db,
  params: { request: AgreementRequest; printedByName: string | null; actorId: string },
): Promise<string[]> {
  const documents = await publishedDocuments(db, LEGAL_SCOPES.ORGANIZATION_REGISTRATION);
  const rendered: string[] = [];
  for (const doc of documents) {
    if (!doc.hasPlaceholders) continue;
    await renderLegalDocument(db, {
      request: params.request,
      document: {
        code: doc.code,
        nameTh: doc.nameTh,
        versionId: doc.versionId,
        versionNumber: doc.versionNumber,
        effectiveAt: doc.effectiveAt,
      },
      printedByName: params.printedByName,
      actorId: params.actorId,
    });
    rendered.push(doc.code);
  }
  return rendered;
}
