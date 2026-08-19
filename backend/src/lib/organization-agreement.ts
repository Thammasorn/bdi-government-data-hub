/**
 * สร้างเอกสาร A0 (ข้อตกลงในการบริหารจัดการและการแบ่งปันข้อมูล) ของคำขอหนึ่งใบ
 *
 * ถูกเรียกสามจุดในเส้นทาง B และทุกจุดใช้ทางเดินเดียวกัน ต่างกันแค่ว่าตอนนั้นมีลายมือชื่อ
 * ของใครแล้ว:
 *
 *   1. ผู้กรอกกด "ตรวจสอบและสร้าง PDF"  → ยังไม่มีลายมือชื่อทั้งสองฝ่าย
 *   2. ผู้มีอำนาจกระทำการแทนลงนาม        → มีลายมือชื่อฝ่ายหน่วยงาน
 *   3. ผู้อนุมัติ BDI ลงนาม              → มีทั้งสองฝ่าย พร้อมตราเห็นชอบ
 *
 * แต่ละครั้งเขียนทับ slot GENERATED_FORM ของคำขอ ซึ่ง storeAttachment() จะเปลี่ยนไฟล์เดิม
 * เป็น REPLACED ไม่ได้ลบ — ฉบับก่อนลงนามจึงยังตรวจย้อนได้ว่าหน่วยงานเห็นอะไรตอนกดนำส่ง
 *
 * **ลายมือชื่อไม่ได้คำนวณสดจากบัญชีผู้ใช้** แต่อ่านจาก signature.signature_confirmation
 * ที่บันทึกชื่อไว้ ณ เวลาลงนาม ถ้าผู้ใช้เปลี่ยนชื่อภายหลัง เอกสารที่ลงนามแล้วต้องไม่เปลี่ยนตาม
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
import { LEGAL_SCOPES, publishedDocuments, templateDocx } from "./legal.js";
import { agreementValues, type AgreementInput } from "./legal-values.js";

type Db = PrismaClient | Prisma.TransactionClient;

const OWNER = AttachmentOwnerType.ORGANIZATION_REGISTRATION_REQUEST;
const SUBJECT = SubjectType.ORGANIZATION_REGISTRATION_REQUEST;

/** รหัสเอกสารที่เป็นตัวข้อตกลงหลัก — ผนวก A1–A3 ไม่มีช่องให้เติมและไม่มีช่องลงนาม */
export const AGREEMENT_CODE = "A0";

/** ข้อมูลคำขอในรูปที่ toApiShape() คืนมา — เอาเฉพาะช่องที่เอกสารต้องใช้ */
export type AgreementRequest = Pick<
  AgreementInput,
  | "requestNumber"
  | "name"
  | "addressLine"
  | "road"
  | "province"
  | "district"
  | "subdistrict"
  | "postalCode"
  | "email"
  | "signatoryPrefix"
  | "signatoryFirstName"
  | "signatoryLastName"
  | "signatoryPosition"
  | "signatoryNationalId"
> & { id: string; submittedAt: Date | null };

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
    if (!row) return { name: null, at: null };
    const payload = row.confirmationPayloadJson as { signedName?: string } | null;
    // ชื่อที่ snapshot ไว้ใน payload มาก่อน displayName ปัจจุบันของบัญชี
    return { name: payload?.signedName ?? row.userAccount.displayName, at: row.confirmedAt };
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
 * เติมข้อมูลลง A0 แล้วเก็บเป็น GENERATED_FORM ของคำขอ
 * คืน attachment ในรูปที่ส่งออก API ได้เลย พร้อม id ของเวอร์ชันที่ใช้ render
 */
export async function renderAgreement(
  db: Db,
  params: {
    request: AgreementRequest;
    /** ชื่อคนที่ทำให้เอกสารฉบับนี้ถูกสร้าง — ไปอยู่บรรทัด "พิมพ์จากระบบโดย" */
    printedByName: string | null;
    actorId: string;
  },
) {
  const version = await agreementVersion(db);
  const docx = await templateDocx(db, version.versionId);
  const signatures = await signaturesOf(db, params.request.id);
  const now = new Date();

  const values = agreementValues({
    ...params.request,
    // วันทำข้อตกลงคือวันที่หน่วยงานนำส่งคำขอ ไม่ใช่วันที่ render — ไม่อย่างนั้นเอกสาร
    // ฉบับที่ผู้อนุมัติเห็นจะลงวันที่คนละวันกับฉบับที่หน่วยงานกดนำส่ง
    agreementDate: params.request.submittedAt ?? now,
    approverSignedName: signatures.approver.name,
    approverSignedAt: signatures.approver.at,
    bdiSignedName: signatures.bdi.name,
    bdiSignedAt: signatures.bdi.at,
    printedByName: params.printedByName,
    printedAt: now,
  });

  const pdf = await renderTemplateToPdf(docx, values, `${AGREEMENT_CODE}.docx`);

  const attachment = await storeAttachment(db, {
    ownerType: OWNER,
    ownerId: params.request.id,
    attachmentType: AttachmentType.GENERATED_FORM,
    file: {
      buffer: pdf,
      originalname: `${AGREEMENT_CODE} ข้อตกลง-${params.request.name ?? "หน่วยงาน"}.pdf`,
      mimetype: "application/pdf",
      size: pdf.length,
    },
    uploadedBy: params.actorId,
  });

  return { attachment: publicAttachment(attachment), versionId: version.versionId };
}
