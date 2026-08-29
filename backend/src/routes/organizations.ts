/**
 * Journey B — ลงทะเบียนหน่วยงาน
 *
 * โครงเปลี่ยนไปจากเดิมสองอย่างใหญ่ ๆ ตามดีไซน์ใน Excel:
 *
 * 1. **แยกสองตาราง** organization.organization เก็บสถานะปัจจุบันของหน่วยงาน
 *    (PENDING_REGISTRATION → ACTIVE) ส่วน organization_registration_request เก็บ
 *    snapshot ของคำขอพร้อมสถานะ workflow เจ็ดค่า ของเดิมยัดรวมไว้ในตารางเดียว
 *    `:id` ในทุก route คือ **id ของคำขอ** ไม่ใช่ของหน่วยงาน
 *
 * 2. **ด่านอนุมัติย้ายไป review.review_task** POST /:id/review ยังเป็นจุดตัดสินใจเดียว
 *    ของทุกด่านเหมือนเดิม แต่ตัดสินจาก active review_task แทนที่จะดูจาก status
 *
 * ลำดับด่านของ Journey นี้: BDI_OFFICER_REVIEW → ORGANIZATION_APPROVAL → BDI_FINAL_APPROVAL
 */
import { Router } from "../lib/async-route.js";
import multer from "multer";
import { z } from "zod";
import {
  AccountType,
  AttachmentOwnerType,
  AttachmentType,
  OrganizationStatus,
  Prisma,
  RequestStatus,
  ReviewResult,
  ReviewTaskStatus,
  ReviewTaskType,
  SubjectType,
  UserAccountStatus,
} from "@prisma/client";

import { prisma } from "../db.js";
import { isValidAddress, lookupZipcode, resolveAddressCodes, resolveAddressNames } from "../lib/address.js";
import {
  activeAttachment,
  activeAttachments,
  activeRenderedDocument,
  publicAttachment,
  storeAttachment,
  streamAttachment,
  uploadedFile,
} from "../lib/attachment.js";
import {
  AcceptanceMethod,
  ConfirmationType,
  LegalDocumentVersionStatus,
} from "@prisma/client";
import { AuditAction, AuditSubject, logAudit } from "../lib/audit.js";
import { assignRole, issueActivationKey, type RevokedAssignment } from "../lib/iam.js";
import {
  sendActivated,
  sendFinalApprovalRequest,
  sendInvitationEmail,
  sendRevisionRequested,
  sendSignatoryRequest,
  sendSubmittedToOfficers,
} from "../lib/mail.js";
import {
  NotificationType,
  announceProgress,
  announceRoleReplacement,
  bdiApproverIds,
  bdiOfficerIds,
  emailsOf,
  notifyUsers,
  organizationMemberIds,
} from "../lib/notify.js";
import {
  AGREEMENT_CODE,
  agreementVersion,
  renderLegalDocument,
  renderPlaceholderDocuments,
} from "../lib/organization-agreement.js";
import { DocumentRenderError } from "../lib/document-render.js";
import { LEGAL_SCOPES, publishedDocuments } from "../lib/legal.js";
import { nextOrganizationCode, nextOrganizationRequestNumber } from "../lib/request-number.js";
import { buildJourneyProgress, summariseMany } from "../lib/journey-steps.js";
import { REVIEW_TASK_TYPE_LABELS, ROLE_LABELS, isBdiStaff } from "../lib/roles.js";
import {
  PLACEHOLDER_ORGANIZATION_NAME,
  BDI_ORGANIZATION_ID,
  ROLE_CODES,
  SYSTEM_USER_ID,
  type RoleCode,
} from "../lib/system.js";
import {
  emailSchema,
  parseRequestSnapshot,
  formatZodError,
  isUuid,
  nationalIdSchema,
  normaliseThaiPhone,
  organizationNameSchema,
  phoneSchema,
} from "../lib/validation.js";
import {
  WorkflowError,
  activeTask,
  completeTask,
  deriveRequestStatus,
  openTask,
  startTask,
  taskHistory,
} from "../lib/workflow.js";
import { requireAuth } from "../middleware/auth.js";

export const organizationRouter = Router();
organizationRouter.use(requireAuth);

/**
 * `:id` / `:attachmentId` เป็น UUID เสมอ — ตัดค่าที่ไม่ใช่ทิ้งตั้งแต่ต้นทาง
 *
 * ไม่อย่างนั้น path อย่าง /api/organizations/mine จะเข้ามาที่ GET /:id แล้ว Prisma
 * โยน P2023 ผลเป็น 500 ทั้งที่คำตอบที่ถูกคือ 404
 */
for (const name of ["id", "attachmentId"]) {
  organizationRouter.param(name, (_req, res, next, value: string) => {
    if (!isUuid(value)) {
      res.status(404).json({ error: "not_found", message: "ไม่พบรายการนี้" });
      return;
    }
    next();
  });
}

const SUBJECT = SubjectType.ORGANIZATION_REGISTRATION_REQUEST;

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME = new Set(["application/pdf", "image/jpeg", "image/jpg"]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: (_req, file, cb) => {
    cb(null, ALLOWED_MIME.has(file.mimetype));
  },
});

// ---------------------------------------------------------------- schemas

/**
 * ความยาวสูงสุดของช่องที่อยู่
 *
 * เดิม schema จำกัดไว้ 300 ตัวอักษรทั้งที่คอลัมน์รับได้ 500 — ที่อยู่ราชการเต็มรูปแบบ
 * (ชื่ออาคาร ชั้น เลขห้อง ซอย แขวง พร้อมวงเล็บอธิบายทางเข้า) ชนเพดานนั้นได้จริง และ
 * เพดานฝั่ง schema ทำให้ผู้ใช้เจอ error ทั้งที่คอลัมน์ยังว่างอยู่อีกมาก ตอนนี้ทั้ง
 * schema และคอลัมน์เป็น 2000 เท่ากัน (migration 20260829120000_widen_address_line)
 * ค่านี้ถูกคัดลอกไว้ที่ frontend/lib/organization-form.ts ด้วย — แก้พร้อมกันเสมอ
 */
const MAX_ADDRESS_LINE = 2000;

/**
 * ตอนบันทึกร่างยอมให้ว่างได้ ตอนนำส่งต้องครบ — จึงแยกเป็นสองชุด
 *
 * ชื่อฟิลด์ฝั่ง API ยังเป็นชุดเดิม (name / signatory* / contact*) เพื่อไม่ให้ frontend
 * ต้องแก้ทั้งฟอร์ม การแปลงไปเป็นคอลัมน์ snapshot ของดีไซน์ (organization_name_th /
 * approver_* / user_*) เกิดที่ toRequestData() ข้างล่าง
 */
const draftSchema = z.object({
  /**
   * รหัสหน่วยงาน — **อ่านอย่างเดียว** รับมาเพื่อเทียบว่าตรงกับของเดิมเท่านั้น
   *
   * ค่านี้ไม่ได้ถูกแปลงลง snapshot ที่ toRequestData() อีกแล้ว ฟอร์มจึงเขียนทับไม่ได้
   * แม้จะส่งมา — ดู assertOrganizationCodeUnchanged() ว่าทำไมถึงตอบ 400 แทนที่จะ
   * เงียบ ๆ เมื่อค่าที่ส่งมาไม่ตรงกับของเดิม
   */
  organizationCode: z.string().trim().max(64).optional(),
  name: z.string().trim().max(200).optional(),
  nameEn: z.string().trim().max(200).optional(),
  organizationType: z.string().trim().max(64).optional(),
  addressLine: z.string().trim().max(MAX_ADDRESS_LINE).optional(),
  road: z.string().trim().max(255).optional(),
  province: z.string().trim().optional(),
  district: z.string().trim().optional(),
  subdistrict: z.string().trim().optional(),
  postalCode: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  email: z.string().trim().optional(),
  websiteUrl: z.string().trim().max(500).optional(),

  signatoryPrefix: z.string().trim().optional(),
  signatoryFirstName: z.string().trim().optional(),
  signatoryLastName: z.string().trim().optional(),
  signatoryPosition: z.string().trim().optional(),
  signatoryEmail: z.string().trim().optional(),
  signatoryNationalId: z.string().trim().optional(),
  signatoryPhone: z.string().trim().optional(),
  signatoryDepartment: z.string().trim().optional(),

  contactPrefix: z.string().trim().optional(),
  contactFirstName: z.string().trim().optional(),
  contactLastName: z.string().trim().optional(),
  contactPosition: z.string().trim().optional(),
  contactDepartment: z.string().trim().optional(),
  contactEmail: z.string().trim().optional(),
  contactPhone: z.string().trim().optional(),
  contactNationalId: z.string().trim().optional(),
});

const submitSchema = z
  .object({
  organizationCode: z.string().trim().min(1, "กรุณากรอกรหัสหน่วยงาน").max(64),
  name: organizationNameSchema,
  addressLine: z
    .string()
    .trim()
    .min(1, "กรุณากรอกที่อยู่")
    .max(MAX_ADDRESS_LINE, `ที่อยู่ต้องไม่เกิน ${MAX_ADDRESS_LINE} ตัวอักษร`),
  /**
   * ถนนไม่บังคับ — ที่อยู่ราชการหลายแห่งไม่มีชื่อถนน (ใช้หมู่ที่แทน) บังคับกรอกจะกลายเป็น
   * การให้ผู้ใช้กรอกข้อมูลที่ไม่มีอยู่จริง ช่อง "ถนน" ในเอกสาร A0 จะว่างไว้ตามความจริง
   */
  road: z.string().trim().max(255).optional(),
  province: z.string().trim().min(1, "กรุณาเลือกจังหวัด"),
  district: z.string().trim().min(1, "กรุณาเลือกอำเภอ/เขต"),
  subdistrict: z.string().trim().min(1, "กรุณาเลือกตำบล/แขวง"),
  postalCode: z.string().trim().regex(/^\d{5}$/, "รหัสไปรษณีย์ต้องเป็นตัวเลข 5 หลัก"),
  email: emailSchema,

  signatoryPrefix: z.string().trim().min(1, "กรุณาเลือกคำนำหน้า"),
  signatoryFirstName: z.string().trim().min(1, "กรุณากรอกชื่อ"),
  signatoryLastName: z.string().trim().min(1, "กรุณากรอกนามสกุล"),
  signatoryPosition: z.string().trim().min(1, "กรุณากรอกตำแหน่ง"),
  signatoryEmail: emailSchema,
  signatoryNationalId: nationalIdSchema,
  signatoryPhone: phoneSchema,

  contactPrefix: z.string().trim().min(1, "กรุณาเลือกคำนำหน้า"),
  contactFirstName: z.string().trim().min(1, "กรุณากรอกชื่อ"),
  contactLastName: z.string().trim().min(1, "กรุณากรอกนามสกุล"),
  contactPosition: z.string().trim().min(1, "กรุณากรอกตำแหน่ง"),
  contactDepartment: z.string().trim().min(1, "กรุณากรอกฝ่าย/กอง/สำนัก"),
  contactEmail: emailSchema,
  contactPhone: phoneSchema,
  })
  /**
   * อีเมลหน่วยงานต้องไม่ใช่อีเมลของผู้มีอำนาจกระทำการแทน
   *
   * สองช่องนี้ทำคนละหน้าที่กัน และระบบใช้ต่างกันจริง ๆ — อีเมลผู้มีอำนาจกระทำการแทน
   * คือที่อยู่ที่ระบบ **ออกคำเชิญให้เข้ามาลงนาม** (ensureApproverAccount() เปิดบัญชี
   * ให้ที่อยู่นั้น) ส่วนอีเมลหน่วยงานเป็นช่องทางติดต่อกลางของหน่วยงาน กรอกซ้ำกันแล้ว
   * หน่วยงานจะเหลือช่องทางติดต่อเดียวที่ผูกกับตัวบุคคล พอคนนั้นย้ายงานก็ติดต่อ
   * หน่วยงานไม่ได้อีกเลย และอีเมลกลางของหน่วยงานซึ่งมักมีคนดูแลหลายคนจะกลายเป็น
   * ที่รับลิงก์เปิดใช้งานบัญชีส่วนบุคคล
   */
  .superRefine((value, ctx) => {
    if (value.email && value.email === value.signatoryEmail) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["email"],
        message:
          "อีเมลหน่วยงานต้องไม่ใช่อีเมลเดียวกับผู้มีอำนาจกระทำการแทน กรุณากรอกอีเมลกลางของหน่วยงาน",
      });
    }
  });

type RequestRow = Prisma.OrganizationRegistrationRequestGetPayload<{
  include: { organization: true };
}>;

// ---------------------------------------------------------------- mapping

/** แปลงชื่อฟิลด์ฝั่ง API เป็นคอลัมน์ snapshot ตามดีไซน์ */
async function toRequestData(input: z.infer<typeof draftSchema>) {
  const codes = await resolveAddressCodes(prisma, input);

  const postalCode =
    input.postalCode ||
    (input.province && input.district && input.subdistrict
      ? (lookupZipcode(input.province, input.district, input.subdistrict) ?? undefined)
      : undefined);

  /**
   * เก็บเบอร์ในรูปตัวเลขล้วนเสมอ ไม่ว่าผู้ใช้จะพิมพ์ขีดหรือ +66 มา
   *
   * เบอร์เดียวกันที่เก็บคนละรูปทำให้ค้นไม่เจอและพิมพ์ลงเอกสาร A0 ไม่เหมือนกันสองใบ
   * ค่าที่อ่านเป็นเบอร์ไม่ได้เลยปล่อยผ่านตามเดิม เพื่อให้ตอนนำส่ง phoneSchema เป็นคน
   * บอกว่าผิดตรงไหน แทนที่จะกลายเป็นค่าว่างเงียบ ๆ ระหว่างบันทึกร่าง
   */
  const phone = (value?: string) => (value ? (normaliseThaiPhone(value) ?? value) : value);

  return {
    /**
     * ไม่มี organizationCode ที่นี่โดยตั้งใจ — รหัสหน่วยงานแก้ผ่านฟอร์มไม่ได้
     * ค่าที่ถูกต้องมาจากแถว organization เท่านั้น (prefillFromOrganization ตอนเปิดคำขอ
     * หรือ nextOrganizationCode ตอนสร้างหน่วยงานใหม่)
     */
    organizationType: input.organizationType,
    organizationNameTh: input.name,
    organizationNameEn: input.nameEn,
    organizationAddressLine: input.addressLine,
    organizationRoad: input.road,
    organizationProvinceCode: codes.provinceCode,
    organizationDistrictCode: codes.districtCode,
    organizationSubdistrictCode: codes.subDistrictCode,
    organizationPostalCode: postalCode,
    organizationPhone: phone(input.phone),
    organizationEmail: input.email,
    organizationWebsite: input.websiteUrl,

    approverPrefixTh: input.signatoryPrefix,
    approverFirstnameTh: input.signatoryFirstName,
    approverLastnameTh: input.signatoryLastName,
    approverPositionTh: input.signatoryPosition,
    approverEmail: input.signatoryEmail,
    approverCid: input.signatoryNationalId,
    approverPhoneNumber: phone(input.signatoryPhone),
    approverDepartmentTh: input.signatoryDepartment,

    userPrefixTh: input.contactPrefix,
    userFirstnameTh: input.contactFirstName,
    userLastnameTh: input.contactLastName,
    userPositionTh: input.contactPosition,
    userDepartmentTh: input.contactDepartment,
    userEmail: input.contactEmail,
    userPhoneNumber: phone(input.contactPhone),
    userCid: input.contactNationalId,
  };
}

/**
 * ค่าตั้งต้นของคำขอ คัดจากแถว organization ที่ admin สร้างไว้ล่วงหน้า
 *
 * เป็นการคัดลอก ไม่ใช่การอ้างอิง — คำขอเก็บ snapshot ตามดีไซน์ ผู้ใช้แก้ในคำขอได้
 * โดยไม่กระทบ master และ master จะถูกเขียนทับด้วย snapshot อีกทีตอนอนุมัติขั้นสุดท้าย
 */
function prefillFromOrganization(org: {
  organizationCode: string;
  organizationType: string | null;
  nameTh: string;
  nameEn: string | null;
  addressLine: string | null;
  road: string | null;
  provinceCode: string | null;
  districtCode: string | null;
  subDistrictCode: string | null;
  postalCode: string | null;
  phone: string | null;
  email: string | null;
  websiteUrl: string | null;
}) {
  return {
    organizationCode: org.organizationCode,
    organizationType: org.organizationType,
    // ชื่อชั่วคราวที่ระบบตั้งให้เองไม่ใช่ข้อมูลจริง อย่าเอาไปเติมในฟอร์มให้ผู้ใช้ต้องมาลบ
    organizationNameTh: org.nameTh === PLACEHOLDER_ORGANIZATION_NAME ? null : org.nameTh,
    organizationNameEn: org.nameEn,
    organizationAddressLine: org.addressLine,
    organizationRoad: org.road,
    organizationProvinceCode: org.provinceCode,
    organizationDistrictCode: org.districtCode,
    organizationSubdistrictCode: org.subDistrictCode,
    organizationPostalCode: org.postalCode,
    organizationPhone: org.phone,
    organizationEmail: org.email,
    organizationWebsite: org.websiteUrl,
  };
}

/**
 * ตัด key ที่ไม่มีค่าออก เพื่อไม่ให้ body ที่ไม่ได้ส่งอะไรมาไปลบค่าที่ prefill ไว้
 *
 * ต้องตัด `null` ด้วยไม่ใช่แค่ `undefined` — `resolveAddressCodes()` คืน null (ไม่ใช่
 * undefined) เมื่อไม่ได้ส่งที่อยู่มา ถ้ากรองแค่ undefined รหัสจังหวัด/อำเภอ/ตำบล
 * ที่คัดลอกมาจากหน่วยงานจะถูกทับด้วย null ทันที (เจอตอน SIT รอบแรก ที่อยู่หายทั้งชุด)
 */
function providedOnly<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined && v !== null),
  ) as Partial<T>;
}

/**
 * รหัสหน่วยงานเป็นของระบบ ไม่ใช่ของผู้กรอก — คืนข้อความผิดพลาดถ้าฟอร์มพยายามเปลี่ยน
 *
 * เดิมช่อง "รหัสหน่วยงาน" บนฟอร์มแก้ได้ และค่าที่แก้ไหลลง snapshot ตรง ๆ ผลคือ
 * เจ้าหน้าที่หน่วยงานเปลี่ยนรหัสของหน่วยงานตัวเองเป็นอะไรก็ได้ ทั้งที่รหัสนี้เป็น
 * `@unique` ระดับตาราง เป็นสิ่งที่ `POST /api/admin/organizations` กำหนดไว้ล่วงหน้า
 * หรือ `nextOrganizationCode()` ออกให้ตามลำดับ และเป็นค่าที่เอกสาร A0 กับระบบอื่น
 * ใช้อ้างถึงหน่วยงานนี้ การให้ผู้ถูกตรวจสอบตั้งรหัสอ้างอิงของตัวเองได้ยังเปิดทางให้
 * ไปชนรหัสของหน่วยงานอื่น ซึ่งเดิมไปโผล่เป็น error ตอนอนุมัติขั้นสุดท้าย — คนละคน
 * คนละวันกับคนที่พิมพ์ผิด
 *
 * ตอบ 400 พร้อมบอกว่าทำไม แทนที่จะรับค่าแล้วทิ้งเงียบ ๆ เพราะแท็บที่เปิดค้างไว้ก่อน
 * การเปลี่ยนแปลงนี้ยังส่งช่องนั้นมาได้ และผู้ใช้ที่ตั้งใจแก้ต้องรู้ว่าค่าที่เขาพิมพ์
 * ไม่ได้ถูกบันทึก ค่าที่ส่งมา **ตรงกับของเดิม** ผ่านได้ตามปกติ ฟอร์มจึงยังส่งทั้งชุดได้
 */
function organizationCodeEdit(
  input: { organizationCode?: string },
  current: string | null | undefined,
): string | null {
  if (!input.organizationCode) return null;
  if (current && input.organizationCode === current) return null;
  return "รหัสหน่วยงานแก้ไขไม่ได้ — ระบบกำหนดให้อัตโนมัติ หากไม่ถูกต้องกรุณาแจ้งเจ้าหน้าที่ BDI";
}

/**
 * แปลงกลับเป็นรูปที่ frontend และ zod ชุด submit เข้าใจ
 * คงชื่อฟิลด์เดิมไว้เพื่อไม่ให้ต้องแก้ฟอร์มทั้งหน้า
 */
async function toApiShape(request: RequestRow) {
  const names = await resolveAddressNames(prisma, {
    provinceCode: request.organizationProvinceCode,
    districtCode: request.organizationDistrictCode,
    subDistrictCode: request.organizationSubdistrictCode,
  });

  return {
    id: request.id,
    requestNumber: request.requestNumber,
    status: request.status,
    organizationId: request.organizationId,
    organizationStatus: request.organization.status,
    // snapshot ของคำขอมาก่อน master — ผู้ใช้แก้รหัสในฟอร์มได้ และค่าจะไปทับ master ตอนอนุมัติ
    organizationCode: request.organizationCode ?? request.organization.organizationCode,

    name: request.organizationNameTh,
    nameEn: request.organizationNameEn,
    organizationType: request.organizationType,
    addressLine: request.organizationAddressLine,
    road: request.organizationRoad,
    province: names.province,
    district: names.district,
    subdistrict: names.subdistrict,
    postalCode: request.organizationPostalCode,
    phone: request.organizationPhone,
    email: request.organizationEmail,
    websiteUrl: request.organizationWebsite,

    signatoryPrefix: request.approverPrefixTh,
    signatoryFirstName: request.approverFirstnameTh,
    signatoryLastName: request.approverLastnameTh,
    signatoryPosition: request.approverPositionTh,
    // เก็บลงคอลัมน์ตั้งแต่ต้นแต่ไม่เคยส่งกลับออกมา ฟอร์มจึงลืมค่าที่กรอกไว้ทุกครั้งที่โหลด
    // และ {{org_approver.department}} ในเอกสารก็ไม่มีค่าให้เติม
    signatoryDepartment: request.approverDepartmentTh,
    signatoryEmail: request.approverEmail,
    signatoryNationalId: request.approverCid,
    signatoryPhone: request.approverPhoneNumber,

    contactPrefix: request.userPrefixTh,
    contactFirstName: request.userFirstnameTh,
    contactLastName: request.userLastnameTh,
    contactPosition: request.userPositionTh,
    contactDepartment: request.userDepartmentTh,
    contactNationalId: request.userCid,
    contactEmail: request.userEmail,
    contactPhone: request.userPhoneNumber,

    submittedAt: request.submittedAt,
    approvedAt: request.approvedAt,
    rejectedAt: request.rejectedAt,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
  };
}

// ---------------------------------------------------------------- helpers

/**
 * เลือกผู้รับมอบหมายของด่านถัดไป
 *
 * sheet มาร์ก review_task.assigned_user_id เป็น Required จึงต้องมีคนรับตั้งแต่สร้าง task
 * เลือกคนที่มี active task น้อยที่สุด เพื่อไม่ให้งานกองที่คนเดียว
 * (docs/01-user-journey.md §4.4 เขียนว่า "BDI Officer ทุกคนเห็นคำขอทั้งหมด" ใครว่างก่อนหยิบก่อน
 *  — ดีไซน์บังคับให้มีเจ้าของ จึงมอบหมายอัตโนมัติแล้วให้ reassign ได้ทีหลังแทน)
 *
 * เจ้าหน้าที่ BDI สังกัดหน่วยงาน BDI ตั้งแต่ 2026-08-16 — เดิม organization_id ของพวกเขา
 * เป็น NULL ผู้เรียกจึงส่ง `null` มาเพื่อหมายถึง "ฝั่ง BDI ไม่ผูกหน่วยงาน" ตอนนี้ตัวกรองนั้น
 * ไม่ตรงกับใครเลย ผลคือ submit ตอบ 503 no_reviewer ทั้งที่มีเจ้าหน้าที่อยู่ครบ
 * จึงต้องส่ง BDI_ORGANIZATION_ID มาแทน
 */
async function pickAssignee(roleCode: RoleCode, organizationId?: string | null): Promise<string | null> {
  const assignments = await prisma.userRoleAssignment.findMany({
    where: {
      role: { code: roleCode, isActive: true },
      status: "ACTIVE",
      OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: new Date() } }],
      userAccount: { status: UserAccountStatus.ACTIVE },
      ...(organizationId !== undefined ? { organizationId } : {}),
    },
    select: { userAccountId: true },
  });

  const candidates = [...new Set(assignments.map((a) => a.userAccountId))];
  if (candidates.length === 0) return null;

  const loads = await prisma.reviewTask.groupBy({
    by: ["assignedUserId"],
    where: {
      assignedUserId: { in: candidates },
      status: { in: [ReviewTaskStatus.PENDING, ReviewTaskStatus.IN_PROGRESS] },
    },
    _count: { _all: true },
  });

  const loadByUser = new Map(loads.map((l) => [l.assignedUserId, l._count._all]));
  return candidates.sort((a, b) => (loadByUser.get(a) ?? 0) - (loadByUser.get(b) ?? 0))[0] ?? null;
}

/** คำนำหน้า ชื่อ นามสกุล ที่ต่อกันแล้ว ข้ามช่องที่ยังว่าง */
function fullName(prefix?: string | null, first?: string | null, last?: string | null): string {
  return [prefix, first, last].filter(Boolean).join(" ").trim();
}

/** ผู้ใช้เห็นคำขอนี้ได้ไหม */
function canView(
  session: { sub: string; roles: RoleCode[]; organizationId: string | null; email: string },
  request: { createdBy: string; organizationId: string; approverEmail: string | null },
): boolean {
  if (isBdiStaff(session.roles)) return true;
  if (request.createdBy === session.sub) return true;
  if (session.organizationId === request.organizationId) return true;
  return request.approverEmail?.toLowerCase() === session.email.toLowerCase();
}

/** สถานะของคำขอต้องตรงกับที่ derive จาก review_task เสมอ */
async function syncStatus(
  tx: Prisma.TransactionClient,
  request: { id: string; submittedAt: Date | null; cancelledAt: Date | null },
) {
  const status = await deriveRequestStatus(tx, {
    subjectType: SUBJECT,
    subjectId: request.id,
    hasSubmitted: Boolean(request.submittedAt),
    cancelled: Boolean(request.cancelledAt),
  });
  return tx.organizationRegistrationRequest.update({
    where: { id: request.id },
    data: { status, updatedBy: SYSTEM_USER_ID },
  });
}

// ---------------------------------------------------------------- list

organizationRouter.get("/", async (req, res) => {
  const session = req.session!;
  const { status, q } = req.query as { status?: string; q?: string };

  const where: Prisma.OrganizationRegistrationRequestWhereInput = {};

  if (!isBdiStaff(session.roles)) {
    where.OR = [
      { createdBy: session.sub },
      ...(session.organizationId ? [{ organizationId: session.organizationId }] : []),
      { approverEmail: { equals: session.email, mode: "insensitive" as const } },
    ];
  }

  const statuses = (status ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is RequestStatus => s in RequestStatus);
  if (statuses.length > 0) where.status = { in: statuses };

  if (q?.trim()) {
    const search = q.trim();
    where.AND = [
      {
        OR: [
          { organizationNameTh: { contains: search, mode: "insensitive" } },
          { requestNumber: { contains: search, mode: "insensitive" } },
          { userEmail: { contains: search, mode: "insensitive" } },
          { approverEmail: { contains: search, mode: "insensitive" } },
        ],
      },
    ];
  }

  const requests = await prisma.organizationRegistrationRequest.findMany({
    where,
    orderBy: [{ submittedAt: "desc" }, { createdAt: "desc" }],
    take: 200,
    select: {
      id: true,
      requestNumber: true,
      status: true,
      organizationNameTh: true,
      userEmail: true,
      userFirstnameTh: true,
      userLastnameTh: true,
      submittedAt: true,
      createdAt: true,
      organizationId: true,
      createdBy: true,
    },
  });

  /**
   * ด่านที่แต่ละคำขอค้างอยู่ — badge บนหน้าจอใช้ค่านี้แทน PENDING_* ที่หายไปจาก status
   *
   * ดึงประวัติทั้งหมด ไม่ใช่เฉพาะแถวที่ยัง active เพราะคอลัมน์ความคืบหน้าต้องรู้ว่าผ่านมาแล้ว
   * กี่ด่าน แถวที่ active ก็คัดออกมาจากชุดเดียวกันนี้ ไม่ต้องยิง query เพิ่ม
   */
  const tasks = await prisma.reviewTask.findMany({
    where: { subjectType: SUBJECT, subjectId: { in: requests.map((r) => r.id) } },
    select: {
      id: true,
      subjectId: true,
      taskType: true,
      sequenceNumber: true,
      roundNumber: true,
      status: true,
      result: true,
      completedAt: true,
    },
  });
  const stageBySubject = new Map(
    tasks
      .filter(
        (t) =>
          t.status === ReviewTaskStatus.PENDING || t.status === ReviewTaskStatus.IN_PROGRESS,
      )
      .map((t) => [t.subjectId, t]),
  );
  const progressBySubject = summariseMany({ subjectType: SUBJECT, requests, tasks });

  /**
   * ชื่อหน่วยงานและชื่อผู้ยื่นในตารางต้องไม่ว่าง
   *
   * ทั้งสองคอลัมน์เคยอ่านจาก **snapshot ของคำขอ** อย่างเดียว ซึ่งยังเป็น null ทั้งแถวจนกว่า
   * ผู้ใช้จะเริ่มกรอกฟอร์ม คำขอฉบับร่างที่ระบบเตรียมไว้ให้ผู้ที่เพิ่งรับคำเชิญจึงขึ้นเป็น
   * ช่องว่างกับ "—" ในตารางของเจ้าหน้าที่ อ่านไม่ออกว่าเป็นของใคร
   * จึงถอยไปใช้ชื่อหน่วยงานจริงกับบัญชีผู้สร้างเมื่อ snapshot ยังว่าง
   */
  const organizations = new Map(
    (
      await prisma.organization.findMany({
        where: { id: { in: [...new Set(requests.map((r) => r.organizationId))] } },
        select: { id: true, nameTh: true },
      })
    ).map((o) => [o.id, o.nameTh]),
  );
  const creators = new Map(
    (
      await prisma.userAccount.findMany({
        where: { id: { in: [...new Set(requests.map((r) => r.createdBy))] } },
        select: { id: true, email: true, firstnameTh: true, lastnameTh: true },
      })
    ).map((u) => [u.id, u]),
  );

  res.json({
    organizations: requests.map((r) => {
      const creator = creators.get(r.createdBy);
      return {
        id: r.id,
        requestNumber: r.requestNumber,
        name: r.organizationNameTh ?? organizations.get(r.organizationId) ?? null,
        status: r.status,
        currentTaskType: stageBySubject.get(r.id)?.taskType ?? null,
        currentRound: stageBySubject.get(r.id)?.roundNumber ?? null,
        progress: progressBySubject.get(r.id) ?? null,
        submittedAt: r.submittedAt,
        createdAt: r.createdAt,
        organizationId: r.organizationId,
        createdBy: {
          email: r.userEmail ?? creator?.email ?? "",
          firstName: r.userFirstnameTh ?? creator?.firstnameTh ?? null,
          lastName: r.userLastnameTh ?? creator?.lastnameTh ?? null,
        },
      };
    }),
  });
});

// ---------------------------------------------------------------- create draft

organizationRouter.post("/", async (req, res) => {
  const session = req.session!;
  if (isBdiStaff(session.roles)) {
    res.status(403).json({ error: "forbidden", message: "เจ้าหน้าที่ BDI ไม่สามารถสร้างหน่วยงานได้" });
    return;
  }

  /**
   * คำขอที่ยังไม่จบ นับทั้งของที่ตัวเองสร้างและของหน่วยงานที่ตัวเองสังกัด
   *
   * ข้อหลังจำเป็นตั้งแต่มีคำเชิญที่ผูก `organization_id` มาให้: ผู้ใช้คนที่สองของหน่วยงาน
   * (เช่นผู้มีอำนาจลงนาม) ไม่ได้เป็นคนสร้างคำขอ ถ้าดูแค่ `createdBy` เขาจะได้คำขอใบใหม่
   * พร้อมหน่วยงานใหม่ทั้งที่หน่วยงานของเขามีอยู่แล้ว
   */
  const existing = await prisma.organizationRegistrationRequest.findFirst({
    where: {
      status: { notIn: [RequestStatus.APPROVED, RequestStatus.REJECTED, RequestStatus.CANCELLED] },
      OR: [
        { createdBy: session.sub },
        ...(session.organizationId ? [{ organizationId: session.organizationId }] : []),
      ],
    },
  });
  if (existing) {
    // requestId ไม่ใช่ id ของหน่วยงาน — `:id` ทุกเส้นทางของ router นี้คือ id ของคำขอ
    res.status(409).json({ error: "exists", requestId: existing.id, message: "คุณมีคำขออยู่แล้ว" });
    return;
  }

  const parsed = draftSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "validation", fields: formatZodError(parsed.error) });
    return;
  }

  const snapshot = await toRequestData(parsed.data);

  /**
   * ผู้ใช้ที่มาจากคำเชิญมีหน่วยงานอยู่แล้ว — เปิดคำขอให้หน่วยงานนั้น ไม่ใช่สร้างหน่วยงานใหม่
   * แล้วเติมฟอร์มด้วยสิ่งที่ admin บันทึกไว้ (การ์ด "Admin Prefill Organization Form" ข้อ 4)
   *
   * คัดลอกตอนนี้ ไม่ใช่ตอนออกคำเชิญ เพื่อให้ได้ค่าล่าสุดที่ admin แก้ไว้จนถึงวินาทีนี้
   */
  if (session.organizationId) {
    const organization = await prisma.organization.findUnique({
      where: { id: session.organizationId },
    });
    if (!organization) {
      res.status(404).json({ error: "not_found", message: "ไม่พบหน่วยงานของคุณ" });
      return;
    }

    const codeEdit = organizationCodeEdit(parsed.data, organization.organizationCode);
    if (codeEdit) {
      res.status(400).json({ error: "validation", fields: { organizationCode: codeEdit } });
      return;
    }

    const account = await prisma.userAccount.findUnique({ where: { id: session.sub } });
    const prefilled = await prisma.organizationRegistrationRequest.create({
      data: {
        requestNumber: await nextOrganizationRequestNumber(prisma),
        organizationId: organization.id,
        status: RequestStatus.DRAFT,
        ...prefillFromOrganization(organization),
        // ผู้กรอกคือผู้ประสานงานโดยปริยาย เอาจากบัญชีที่ ThaiD ยืนยันมาแล้ว ผู้ใช้แก้ได้
        userPrefixTh: account?.prefixTh ?? undefined,
        userFirstnameTh: account?.firstnameTh ?? undefined,
        userLastnameTh: account?.lastnameTh ?? undefined,
        userEmail: account?.email,
        userPhoneNumber: account?.phoneNumber ?? undefined,
        userCid: account?.cid ?? undefined,
        // ค่าที่ส่งมากับ body (ถ้ามี) ชนะค่าที่คัดลอกมา
        ...providedOnly(snapshot),
        createdBy: session.sub,
        updatedBy: session.sub,
      },
      include: { organization: true },
    });

    await logAudit({
      action: AuditAction.ORGANIZATION_UPDATED,
      subjectType: AuditSubject.ORGANIZATION_REGISTRATION_REQUEST,
      subjectId: prefilled.id,
      organizationId: organization.id,
      metadata: {
        prefilled_from: "ADMIN_ORGANIZATION",
        organization_code: organization.organizationCode,
      },
    });

    res.status(201).json({ organization: await toApiShape(prefilled) });
    return;
  }

  // หน่วยงานใหม่ยังไม่มีรหัส — รหัสจะออกโดย nextOrganizationCode() ข้างล่าง
  // ค่าที่ส่งมากับ body จึงเป็นการตั้งรหัสเอง ซึ่งไม่ใช่สิ่งที่ฟอร์มทำได้
  const newCodeEdit = organizationCodeEdit(parsed.data, null);
  if (newCodeEdit) {
    res.status(400).json({ error: "validation", fields: { organizationCode: newCodeEdit } });
    return;
  }

  /** คนที่เสีย role ไปเพราะ assignRole ด้านล่าง — ประกาศหลัง transaction commit */
  let replacedHolders: RevokedAssignment[] = [];

  const created = await prisma.$transaction(async (tx) => {
    // หน่วยงานถูกสร้างพร้อมคำขอ แต่ยังเป็น PENDING_REGISTRATION จนกว่าจะอนุมัติครบ
    const organization = await tx.organization.create({
      data: {
        organizationCode: await nextOrganizationCode(tx),
        organizationType: parsed.data.organizationType ?? null,
        nameTh: parsed.data.name || PLACEHOLDER_ORGANIZATION_NAME,
        nameEn: parsed.data.nameEn ?? null,
        status: OrganizationStatus.PENDING_REGISTRATION,
        createdBy: session.sub,
        updatedBy: session.sub,
      },
    });

    const request = await tx.organizationRegistrationRequest.create({
      data: {
        requestNumber: await nextOrganizationRequestNumber(tx),
        organizationId: organization.id,
        status: RequestStatus.DRAFT,
        ...snapshot,
        organizationCode: organization.organizationCode,
        createdBy: session.sub,
        updatedBy: session.sub,
      },
      include: { organization: true },
    });

    // ผู้สร้างกลายเป็น ORGANIZATION_USER ของหน่วยงานนี้
    const { replaced } = await assignRole(tx, {
      userAccountId: session.sub,
      roleCode: ROLE_CODES.ORGANIZATION_USER,
      organizationId: organization.id,
      actorId: session.sub,
    });
    replacedHolders = replaced;

    return request;
  });

  // หลัง commit เสมอ — audit กับอีเมลเขียนผ่าน prisma ตัวหลัก ไม่ใช่ tx ข้างบน
  await announceRoleReplacement(replacedHolders);

  await logAudit({
    action: AuditAction.ORGANIZATION_CREATED,
    subjectType: AuditSubject.ORGANIZATION_REGISTRATION_REQUEST,
    subjectId: created.id,
    organizationId: created.organizationId,
    after: { requestNumber: created.requestNumber, name: created.organizationNameTh },
  });

  res.status(201).json({ organization: await toApiShape(created) });
});

// ---------------------------------------------------------------- detail

/**
 * `:id` ของ router นี้คือ id ของ **คำขอจดทะเบียน** เสมอ — แต่สิ่งเดียวที่ session ถืออยู่
 * คือ id ของ **หน่วยงาน** เมนู "หน่วยงานของฉัน" กับลิงก์บนหน้าแรกจึงประกอบ URL จาก id
 * ของหน่วยงาน และได้ "ไม่พบหน่วยงานนี้" ทุกครั้งที่กด (ผู้ใช้หน่วยงานทุกคน ทุกหน้า)
 *
 * หน้ารายละเอียดจึงรับได้ทั้งสอง id: ถ้าไม่ใช่คำขอ ให้ตีความว่าเป็นหน่วยงาน แล้วเปิด
 * คำขอล่าสุดของหน่วยงานนั้น สิ่งที่ตอบกลับยังเป็นคำขอเสมอ (`id` ในผลลัพธ์คือ id ของคำขอ)
 * ลิงก์ "แก้ไข"/"ตรวจสอบ" ที่หน้านั้นสร้างต่อจึงชี้ถูกที่อยู่แล้ว และการตรวจสิทธิ์
 * ยังเป็น `canView` ตัวเดิมบนคำขอที่หาเจอ ไม่ได้เปิดช่องให้ใครเห็นเพิ่ม
 */
async function findRequestByRequestOrOrganizationId(id: string) {
  const byRequest = await prisma.organizationRegistrationRequest.findUnique({
    where: { id },
    include: { organization: true },
  });
  if (byRequest) return byRequest;
  return prisma.organizationRegistrationRequest.findFirst({
    where: { organizationId: id },
    include: { organization: true },
    orderBy: { createdAt: "desc" },
  });
}

organizationRouter.get("/:id", async (req, res) => {
  const session = req.session!;
  const request = await findRequestByRequestOrOrganizationId(req.params.id);
  if (!request || !canView(session, request)) {
    res.status(404).json({ error: "not_found", message: "ไม่พบหน่วยงานนี้" });
    return;
  }

  const [attachments, tasks, active, creator] = await Promise.all([
    activeAttachments(prisma, AttachmentOwnerType.ORGANIZATION_REGISTRATION_REQUEST, request.id),
    taskHistory(prisma, SUBJECT, request.id),
    activeTask(prisma, SUBJECT, request.id),
    // created_by เป็นคอลัมน์ uuid เปล่า ไม่ใช่ relation จึงต้องอ่านเอง
    prisma.userAccount.findUnique({
      where: { id: request.createdBy },
      select: { id: true, email: true, prefixTh: true, firstnameTh: true, lastnameTh: true },
    }),
  ]);

  // เหตุผลที่ผู้ตรวจส่งกลับ — หน้าฟอร์มมีกล่องแดงรออ่านช่องนี้อยู่ แต่ไม่เคยมีใครส่งให้
  // (ปัญหาเดียวกันกับฝั่งชุดข้อมูล) ผู้ใช้ที่ถูกส่งกลับจึงไม่เห็นว่าต้องแก้อะไร
  const lastReturned = [...tasks].reverse().find((t) => t.result === ReviewResult.RETURNED);
  const revisionNote =
    request.status === RequestStatus.RETURNED ? (lastReturned?.resultComment ?? null) : null;

  res.json({
    organization: {
      ...(await toApiShape(request)),
      revisionNote,
      // หน้ารายละเอียดเขียนว่า "ยื่นโดย <ชื่อ>" และใช้ id ตัดสินว่าเป็นเจ้าของคำขอไหม
      // ตกหล่นไปตอนย้ายสคีมา เหลือแต่ createdBy ที่เป็น uuid เปล่า
      createdBy: creator
        ? {
            id: creator.id,
            email: creator.email,
            prefix: creator.prefixTh,
            firstName: creator.firstnameTh,
            lastName: creator.lastnameTh,
          }
        : null,
      currentTaskType: active?.taskType ?? null,
      currentRound: active?.roundNumber ?? null,
      currentAssignee: active?.assignedUser?.displayName ?? null,
      // เส้นทางทั้งเส้น ไม่ใช่แค่ด่านที่ค้างอยู่ — หน้าจอต้องบอกได้ว่ามีกี่ขั้น
      // ตอนนี้ขั้นไหน และขั้นต่อไปเป็นหน้าที่ของบทบาทใด
      progress: buildJourneyProgress({
        subjectType: SUBJECT,
        status: request.status,
        tasks,
        active,
      }),
      attachments: attachments.map(publicAttachment),
      // timeline มาจาก review_task แทน organization_events เดิม
      events: tasks.map((t) => ({
        id: t.id,
        taskType: t.taskType,
        sequenceNumber: t.sequenceNumber,
        roundNumber: t.roundNumber,
        status: t.status,
        result: t.result,
        note: t.resultComment,
        actor: t.assignedUser
          ? { id: t.assignedUser.id, name: t.assignedUser.displayName, email: t.assignedUser.email }
          : null,
        assignedAt: t.assignedAt,
        startedAt: t.startedAt,
        completedAt: t.completedAt,
        createdAt: t.assignedAt,
      })),
    },
  });
});

// ---------------------------------------------------------------- save draft

organizationRouter.patch("/:id", async (req, res) => {
  const session = req.session!;
  const request = await prisma.organizationRegistrationRequest.findUnique({
    where: { id: req.params.id },
    include: { organization: true },
  });
  if (!request || request.createdBy !== session.sub) {
    res.status(404).json({ error: "not_found", message: "ไม่พบหน่วยงานนี้" });
    return;
  }
  if (request.status !== RequestStatus.DRAFT && request.status !== RequestStatus.RETURNED) {
    res.status(409).json({ error: "locked", message: "คำขออยู่ระหว่างการตรวจสอบ แก้ไขไม่ได้" });
    return;
  }

  const parsed = draftSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "validation", fields: formatZodError(parsed.error) });
    return;
  }

  const codeEdit = organizationCodeEdit(
    parsed.data,
    request.organizationCode ?? request.organization.organizationCode,
  );
  if (codeEdit) {
    res.status(400).json({ error: "validation", fields: { organizationCode: codeEdit } });
    return;
  }

  const snapshot = await toRequestData(parsed.data);

  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.organizationRegistrationRequest.update({
      where: { id: request.id },
      data: { ...snapshot, updatedBy: session.sub },
      include: { organization: true },
    });
    // ชื่อหน่วยงานบน master ตามคำขอไปด้วย ตราบใดที่ยังไม่อนุมัติ
    if (parsed.data.name) {
      await tx.organization.update({
        where: { id: request.organizationId },
        data: {
          nameTh: parsed.data.name,
          nameEn: parsed.data.nameEn ?? null,
          organizationType: parsed.data.organizationType ?? null,
          updatedBy: session.sub,
        },
      });
    }
    return next;
  });

  res.json({ organization: await toApiShape(updated) });
});

// ---------------------------------------------------------------- attachments

organizationRouter.post("/:id/attachments", upload.single("file"), async (req, res) => {
  const session = req.session!;
  const kind = String(req.body?.kind ?? "");
  const attachmentType =
    kind === "APPOINTMENT_ORDER" || kind === AttachmentType.AUTHORIZED_REPRESENTATIVE_APPOINTMENT_ORDER
      ? AttachmentType.AUTHORIZED_REPRESENTATIVE_APPOINTMENT_ORDER
      : kind === "POWER_OF_ATTORNEY"
        ? AttachmentType.POWER_OF_ATTORNEY
        : null;

  if (!attachmentType) {
    res.status(400).json({ error: "validation", message: "ประเภทเอกสารไม่ถูกต้อง" });
    return;
  }
  if (!req.file) {
    res.status(400).json({
      error: "validation",
      message: "รองรับเฉพาะไฟล์ PDF หรือ JPG ขนาดไม่เกิน 10 MB",
    });
    return;
  }

  const request = await prisma.organizationRegistrationRequest.findUnique({
    where: { id: req.params.id },
  });
  if (!request || request.createdBy !== session.sub) {
    res.status(404).json({ error: "not_found", message: "ไม่พบหน่วยงานนี้" });
    return;
  }

  const attachment = await storeAttachment(prisma, {
    ownerType: AttachmentOwnerType.ORGANIZATION_REGISTRATION_REQUEST,
    ownerId: request.id,
    attachmentType,
    file: uploadedFile(req.file),
    uploadedBy: session.sub,
  });

  // คอลัมน์ FK บนคำขอชี้ไฟล์ปัจจุบันของแต่ละช่อง ตามที่ sheet กำหนดไว้สองคอลัมน์
  await prisma.organizationRegistrationRequest.update({
    where: { id: request.id },
    data:
      attachmentType === AttachmentType.AUTHORIZED_REPRESENTATIVE_APPOINTMENT_ORDER
        ? { authorizedRepresentativeAppointmentAttachmentId: attachment.id, updatedBy: session.sub }
        : { powerOfAttorneyAttachmentId: attachment.id, updatedBy: session.sub },
  });

  await logAudit({
    action: attachment.replacedAttachmentId
      ? AuditAction.ATTACHMENT_REPLACED
      : AuditAction.ATTACHMENT_UPLOADED,
    subjectType: AuditSubject.ATTACHMENT,
    subjectId: attachment.id,
    organizationId: request.organizationId,
    after: { attachmentType, filename: attachment.originalFileName },
  });

  res.status(201).json({ attachment: publicAttachment(attachment) });
});

organizationRouter.get("/:id/attachments/:attachmentId", async (req, res) => {
  const session = req.session!;
  const request = await prisma.organizationRegistrationRequest.findUnique({
    where: { id: req.params.id },
  });
  if (!request || !canView(session, request)) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  const attachment = await prisma.attachment.findFirst({
    where: {
      id: req.params.attachmentId,
      ownerType: AttachmentOwnerType.ORGANIZATION_REGISTRATION_REQUEST,
      ownerId: request.id,
    },
  });
  if (!attachment) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  await logAudit({
    action: AuditAction.DOCUMENT_DOWNLOADED,
    subjectType: AuditSubject.ATTACHMENT,
    subjectId: attachment.id,
    organizationId: request.organizationId,
    after: { filename: attachment.originalFileName },
  });

  await streamAttachment(res, attachment);
});

// ---------------------------------------------------------------- generate PDF

/** ขั้นตอนที่ 1 ข้อ 5 — ตรวจข้อมูลให้ผ่านก่อน แล้วสร้าง PDF จาก template ให้ผู้ใช้ดู */
organizationRouter.post("/:id/generate-form", async (req, res) => {
  const session = req.session!;
  const request = await prisma.organizationRegistrationRequest.findUnique({
    where: { id: req.params.id },
    include: { organization: true },
  });
  if (!request || request.createdBy !== session.sub) {
    res.status(404).json({ error: "not_found", message: "ไม่พบหน่วยงานนี้" });
    return;
  }

  const shape = await toApiShape(request);
  const parsed = parseRequestSnapshot(submitSchema, shape);
  if (!parsed.success) {
    res.status(400).json({
      error: "validation",
      message: "ข้อมูลยังไม่ครบถ้วน กรุณาตรวจสอบอีกครั้ง",
      fields: formatZodError(parsed.error),
    });
    return;
  }
  if (!isValidAddress(shape.province!, shape.district!, shape.subdistrict!)) {
    res.status(400).json({
      error: "validation",
      fields: { subdistrict: "ที่อยู่ที่เลือกไม่ตรงกับข้อมูลในระบบ" },
    });
    return;
  }

  const appointment = await activeAttachment(
    prisma,
    AttachmentOwnerType.ORGANIZATION_REGISTRATION_REQUEST,
    request.id,
    AttachmentType.AUTHORIZED_REPRESENTATIVE_APPOINTMENT_ORDER,
  );
  if (!appointment) {
    res.status(400).json({
      error: "validation",
      fields: { APPOINTMENT_ORDER: "กรุณาแนบคำสั่งแต่งตั้งผู้มีอำนาจกระทำการแทน" },
    });
    return;
  }

  /**
   * สร้างเอกสารจาก template .docx ของฝ่ายกฎหมาย — **ทุกฉบับที่มี placeholder** ไม่ใช่แค่ A0
   *
   * ก่อนหน้านี้ตรงนี้เรียก renderOrganizationForm() ซึ่งวางเลย์เอาต์ "แบบฟอร์มขอสร้าง
   * หน่วยงานในระบบ" ขึ้นมาเอง เพราะตอนนั้นสเปกมีแต่ภาพตัวอย่าง ไม่มีไฟล์ template
   * ตอนนี้มีไฟล์จริงแล้ว เอกสารที่หน่วยงานลงนามจึงต้องเป็นฉบับนั้น ไม่ใช่ฉบับที่เราวาดเอง
   * ข้อมูลผู้กรอก เลขบัตร และเบอร์โทรยังตรวจได้จากหน้ารายละเอียดคำขอ ซึ่งแสดงครบทุกช่อง
   */
  const rendered = await renderPlaceholderDocuments(prisma, {
    request: { ...shape, submittedAt: request.submittedAt },
    printedByName: fullName(shape.contactPrefix, shape.contactFirstName, shape.contactLastName),
    actorId: session.sub,
  });
  if (rendered.length === 0) {
    res.status(503).json({
      error: "no_legal_documents",
      message: "ยังไม่มีเอกสารข้อตกลงที่เผยแพร่ในระบบ กรุณาแจ้งผู้ดูแลระบบ",
    });
    return;
  }

  const attachment = await activeAttachment(
    prisma,
    AttachmentOwnerType.ORGANIZATION_REGISTRATION_REQUEST,
    request.id,
    AttachmentType.GENERATED_FORM,
  );
  res.status(201).json({
    attachment: attachment ? publicAttachment(attachment) : null,
    /** รหัสเอกสารที่สร้างให้รอบนี้ — หน้าตรวจสอบก่อนนำส่งใช้ยืนยันว่าครบ */
    documents: rendered,
  });
});

// ------------------------------------------------------- เอกสารกฎหมายของคำขอ

/**
 * เอกสารทั้งชุดที่ผู้อนุมัติต้องอ่าน — A0 ที่ render จากคำขอนี้ ตามด้วยผนวก A1–A3
 *
 * A0 เป็นไฟล์ของคำขอ (มีชื่อหน่วยงานและลายมือชื่ออยู่ในนั้น) ส่วนผนวกเป็นไฟล์กลางของ
 * เวอร์ชันที่เผยแพร่อยู่ ไม่ได้ copy ต่อคำขอ — เพราะไม่มีช่องให้เติมเลยแม้ช่องเดียว
 * สิ่งที่ผูกผนวกเข้ากับคำขอคือ legal.legal_acceptance ซึ่งชี้ไปที่ version id
 */
organizationRouter.get("/:id/legal-documents", async (req, res) => {
  const session = req.session!;
  /**
   * `:id` รับได้ทั้ง id ของคำขอและของหน่วยงาน เหมือน GET /:id
   *
   * เมนู "หน่วยงานของฉัน" ประกอบลิงก์จาก id ของ**หน่วยงาน** (AppShell.tsx) ผู้มีอำนาจ
   * กระทำการแทนที่เข้าหน้ารายละเอียดจากเมนูนั้นจึงยิงมาที่นี่ด้วย id ของหน่วยงาน
   */
  const request = await findRequestByRequestOrOrganizationId(req.params.id);
  if (!request || !canView(session, request)) {
    res.status(404).json({ error: "not_found", message: "ไม่พบหน่วยงานนี้" });
    return;
  }

  const documents = await publishedDocuments(prisma, LEGAL_SCOPES.ORGANIZATION_REGISTRATION);

  const versions = await prisma.legalDocumentVersion.findMany({
    where: { id: { in: documents.map((d) => d.versionId) } },
    select: { id: true, publishedAt: true },
  });
  const publishedAt = new Map(versions.map((v) => [v.id, v.publishedAt]));

  const accepted = await prisma.legalAcceptance.findMany({
    where: { subjectType: SUBJECT, subjectId: request.id },
    select: { legalDocumentVersionId: true, acceptedAt: true },
  });
  const acceptedAt = new Map(accepted.map((a) => [a.legalDocumentVersionId, a.acceptedAt]));

  /** ข้อมูลของคำขอ ประกอบเมื่อต้องใช้จริงเท่านั้น — การ render เป็นเรื่องที่ไม่เกิดบ่อย */
  let shape: Awaited<ReturnType<typeof toApiShape>> | null = null;
  const requestShape = async () => (shape ??= await toApiShape(request));

  const out: Array<{
    code: string;
    name: string;
    versionId: string;
    versionNumber: number;
    fromRequest: boolean;
    fileUrl: string | null;
    acceptedAt: Date | null;
  }> = [];

  for (const doc of documents) {
    /**
     * ฉบับที่ไม่มี placeholder ใช้ไฟล์กลางของเวอร์ชันที่เผยแพร่ร่วมกันทุกหน่วยงาน
     * เพราะ render ออกมาเหมือนกันหมด ไม่มีเหตุให้ทำสำเนาต่อคำขอ
     */
    if (!doc.hasPlaceholders) {
      out.push({
        code: doc.code,
        name: doc.nameTh,
        versionId: doc.versionId,
        versionNumber: doc.versionNumber,
        fromRequest: false,
        fileUrl: `/api/organizations/${request.id}/legal-documents/${doc.versionId}/file`,
        acceptedAt: acceptedAt.get(doc.versionId) ?? null,
      });
      continue;
    }

    /**
     * ฉบับที่มี placeholder ต้อง render ด้วยข้อมูลของคำขอนี้ และสร้างใหม่ให้เองถ้าไฟล์ที่มี
     * เก่ากว่า template ที่เผยแพร่อยู่ (หรือยังไม่มีไฟล์เลย)
     *
     * เคสที่ต้องกัน: หน่วยงานกดสร้าง PDF จาก v1 แล้วนำส่ง ต่อมาฝ่ายกฎหมายเผยแพร่ v2
     * ผู้มีอำนาจเปิดหน้านี้ รายการจะบอกว่าเอกสารคือ v2 และตอนกดลงนามระบบจะบันทึก
     * legal_acceptance เป็น v2 — แต่ไฟล์ที่เขาเพิ่งอ่านยัง render จาก v1 อยู่
     *
     * วนซ้ำไม่ได้ เพราะหลังสร้างเสร็จ uploadedAt จะใหม่กว่า publishedAt เสมอ
     * คำขอที่ยังไม่ได้นำส่งไม่สร้างให้ — ผู้กรอกเป็นคนกดสร้างเองที่หน้าตรวจสอบก่อนนำส่ง
     */
    let rendered = await activeRenderedDocument(
      prisma,
      AttachmentOwnerType.ORGANIZATION_REGISTRATION_REQUEST,
      request.id,
      doc.versionId,
    );

    // A0 ที่สร้างไว้ก่อนมีคอลัมน์ legal_document_version_id — ยอมรับไฟล์เดิมต่อไป
    // ไม่ต้อง render ใหม่ ไม่งั้นเอกสารที่อนุมัติแล้วจะเปลี่ยนบรรทัด "พิมพ์จากระบบ"
    if (!rendered && doc.code === AGREEMENT_CODE) {
      rendered = await prisma.attachment.findFirst({
        where: {
          ownerType: AttachmentOwnerType.ORGANIZATION_REGISTRATION_REQUEST,
          ownerId: request.id,
          attachmentType: AttachmentType.GENERATED_FORM,
          legalDocumentVersionId: null,
          status: "ACTIVE",
        },
      });
    }

    const published = publishedAt.get(doc.versionId) ?? null;
    const stale =
      request.submittedAt !== null &&
      (!rendered || (published !== null && rendered.uploadedAt < published));

    if (stale) {
      const data = await requestShape();
      const result = await renderLegalDocument(prisma, {
        request: { ...data, submittedAt: request.submittedAt },
        document: { code: doc.code, nameTh: doc.nameTh, versionId: doc.versionId },
        printedByName: fullName(data.contactPrefix, data.contactFirstName, data.contactLastName),
        actorId: session.sub,
      });
      rendered = await prisma.attachment.findUniqueOrThrow({ where: { id: result.attachment.id } });
    }

    out.push({
      code: doc.code,
      name: doc.nameTh,
      versionId: doc.versionId,
      versionNumber: doc.versionNumber,
      fromRequest: true,
      fileUrl: rendered
        ? `/api/organizations/${request.id}/legal-documents/${doc.versionId}/file`
        : null,
      acceptedAt: acceptedAt.get(doc.versionId) ?? null,
    });
  }

  res.json({ documents: out });
});

/**
 * ไฟล์ PDF ของเอกสารฉบับหนึ่ง
 *
 * เส้นทางเดียวสำหรับทุกฉบับ ไม่ว่าจะเป็นไฟล์ที่ render ให้คำขอนี้หรือไฟล์กลางของเวอร์ชัน —
 * frontend จึงไม่ต้องรู้ว่าฉบับไหนมี placeholder และไม่ต้องมีสองรูปแบบ URL
 */
organizationRouter.get("/:id/legal-documents/:versionId/file", async (req, res) => {
  const session = req.session!;
  const request = await findRequestByRequestOrOrganizationId(req.params.id);
  if (!request || !canView(session, request)) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const versionId = req.params.versionId;
  if (!isUuid(versionId)) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  // ฉบับที่ render ให้คำขอนี้มาก่อนไฟล์กลางเสมอ
  let file = await activeRenderedDocument(
    prisma,
    AttachmentOwnerType.ORGANIZATION_REGISTRATION_REQUEST,
    request.id,
    versionId,
  );

  // A0 ฉบับเก่าที่ยังไม่มี legal_document_version_id
  if (!file) {
    const primary = await agreementVersion(prisma);
    if (primary.versionId === versionId) {
      file = await prisma.attachment.findFirst({
        where: {
          ownerType: AttachmentOwnerType.ORGANIZATION_REGISTRATION_REQUEST,
          ownerId: request.id,
          attachmentType: AttachmentType.GENERATED_FORM,
          legalDocumentVersionId: null,
          status: "ACTIVE",
        },
      });
    }
  }

  // ไฟล์กลางของเวอร์ชัน — ฉบับที่ไม่มี placeholder ใช้ตัวนี้
  file ??= await activeAttachment(
    prisma,
    AttachmentOwnerType.LEGAL_DOCUMENT_VERSION,
    versionId,
    AttachmentType.GENERATED_FORM,
  );

  if (!file) {
    res.status(404).json({ error: "not_found", message: "ยังไม่มีไฟล์ของเอกสารฉบับนี้" });
    return;
  }

  await logAudit({
    action: AuditAction.DOCUMENT_DOWNLOADED,
    subjectType: AuditSubject.ATTACHMENT,
    subjectId: file.id,
    organizationId: request.organizationId,
    after: { filename: file.originalFileName, legalDocumentVersionId: versionId },
  });

  await streamAttachment(res, file);
});

// ---------------------------------------------------------------- submit

organizationRouter.post("/:id/submit", async (req, res) => {
  const session = req.session!;
  const request = await prisma.organizationRegistrationRequest.findUnique({
    where: { id: req.params.id },
    include: { organization: true },
  });
  if (!request || request.createdBy !== session.sub) {
    res.status(404).json({ error: "not_found", message: "ไม่พบหน่วยงานนี้" });
    return;
  }
  if (request.status !== RequestStatus.DRAFT && request.status !== RequestStatus.RETURNED) {
    res.status(409).json({ error: "locked", message: "คำขอนี้นำส่งไปแล้ว" });
    return;
  }

  const shape = await toApiShape(request);
  const parsed = parseRequestSnapshot(submitSchema, shape);
  if (!parsed.success) {
    res.status(400).json({ error: "validation", fields: formatZodError(parsed.error) });
    return;
  }

  /**
   * รหัสหน่วยงานเป็น unique ที่ระดับตาราง — ถ้าปล่อยให้ผู้ใช้ส่งรหัสของหน่วยงานอื่นเข้ามา
   * จะไปพังตอนอนุมัติขั้นสุดท้าย (P2002) ซึ่งเป็นคนละคนและคนละเวลา บอกตั้งแต่ตอนนำส่งดีกว่า
   */
  const codeOwner = await prisma.organization.findUnique({
    where: { organizationCode: parsed.data.organizationCode },
    select: { id: true },
  });
  if (codeOwner && codeOwner.id !== request.organizationId) {
    res.status(400).json({
      error: "validation",
      fields: { organizationCode: "รหัสหน่วยงานนี้ถูกใช้กับหน่วยงานอื่นแล้ว" },
    });
    return;
  }

  const form = await activeAttachment(
    prisma,
    AttachmentOwnerType.ORGANIZATION_REGISTRATION_REQUEST,
    request.id,
    AttachmentType.GENERATED_FORM,
  );
  if (!form) {
    res.status(400).json({ error: "no_form", message: "กรุณาสร้างและตรวจสอบ PDF ก่อนนำส่ง" });
    return;
  }

  const officer = await pickAssignee(ROLE_CODES.BDI_OFFICER, BDI_ORGANIZATION_ID);
  if (!officer) {
    res.status(503).json({
      error: "no_reviewer",
      message: "ยังไม่มีเจ้าหน้าที่ BDI ในระบบ กรุณาติดต่อผู้ดูแล",
    });
    return;
  }

  const updated = await prisma.$transaction(async (tx) => {
    await tx.organizationRegistrationRequest.update({
      where: { id: request.id },
      data: { submittedAt: new Date(), updatedBy: session.sub },
    });
    await openTask(tx, {
      subjectType: SUBJECT,
      subjectId: request.id,
      taskType: ReviewTaskType.BDI_OFFICER_REVIEW,
      assignedUserId: officer,
      assignedRole: ROLE_CODES.BDI_OFFICER,
      actorId: session.sub,
    });
    return syncStatus(tx, { ...request, submittedAt: new Date() });
  });

  await logAudit({
    action: AuditAction.REQUEST_SUBMITTED,
    subjectType: AuditSubject.ORGANIZATION_REGISTRATION_REQUEST,
    subjectId: request.id,
    organizationId: request.organizationId,
    after: { requestNumber: request.requestNumber },
  });

  const submitter = [shape.contactPrefix, shape.contactFirstName, shape.contactLastName]
    .filter(Boolean)
    .join(" ");
  // อีเมลไม่ได้ส่งตรงนี้แล้ว — notifyUsers เขียนแถวลง notification_delivery
  // แล้ว worker เป็นคนประกอบเนื้อและส่ง (src/workers/delivery.ts)
  void submitter;
  await notifyUsers(await bdiOfficerIds(), {
    type: NotificationType.REQUEST_SUBMITTED,
    title: "มีคำขอลงทะเบียนหน่วยงานใหม่",
    message: `${shape.name} นำส่งคำขอ ${request.requestNumber}`,
    subjectType: SUBJECT,
    subjectId: request.id,
    organizationId: request.organizationId,
  });

  res.json({ organization: await toApiShape({ ...request, ...updated, organization: request.organization }) });
});

// ---------------------------------------------------------------- review

/**
 * การลงนามอิเล็กทรอนิกส์ที่แนบมากับการอนุมัติ
 *
 * `acknowledgedVersionIds` คือเอกสารที่ผู้ลงนามกด "เห็นชอบ" ทีละฉบับก่อนถึงหน้าลงนาม
 * (ขั้นตอนที่ 3 ของการ์ด) ส่งเป็น version id ไม่ใช่รหัส A0/A1 เพราะสิ่งที่ต้องบันทึกว่า
 * ยอมรับคือ "ฉบับไหน" ถ้าฝ่ายกฎหมายอัปโหลดเวอร์ชันใหม่ระหว่างที่ผู้อนุมัติเปิดหน้าอยู่
 * รายการที่ส่งกลับมาจะไม่ตรงกับที่เผยแพร่ และต้องให้อ่านใหม่ ไม่ใช่ผ่านไปเงียบ ๆ
 *
 * `confirmationText` คือข้อความที่ผู้ใช้เห็นตอนกดลงนาม เก็บลง
 * signature_confirmation.confirmation_text ตามที่ sheet กำหนด — หลักฐานว่า
 * เขายืนยันอะไร ต้องเป็นข้อความจริงที่แสดง ณ เวลานั้น ไม่ใช่ข้อความที่โค้ดเดาย้อนหลัง
 */
const signatureSchema = z.object({
  /**
   * เอกสารที่ผู้ลงนามยืนยันว่าอ่านแล้ว พร้อมเวลาที่ยืนยันของแต่ละฉบับ
   *
   * ส่งเป็น version id ไม่ใช่รหัส A0/A1 เพราะสิ่งที่ต้องบันทึกคือยอมรับ**ฉบับไหน**
   * และเวลาแยกต่อฉบับ เพราะผู้ลงนามติ๊กยืนยันทีละฉบับตอนอ่าน ไม่ได้ติ๊กรวดเดียวตอนท้าย
   */
  acknowledgements: z
    .array(
      z.object({
        versionId: z.string(),
        attestedAt: z.string().datetime(),
      }),
    )
    .min(1),
  /**
   * ข้อความที่ผู้ลงนามติ๊กยืนยันต่อเอกสารแต่ละฉบับ
   *
   * เก็บข้อความจริงที่แสดง ณ เวลานั้น ไม่ใช่ให้โค้ดเดาย้อนหลัง — ถ้าวันหนึ่งถ้อยคำนี้
   * ถูกแก้ หลักฐานเก่าต้องไม่เปลี่ยนความหมายตามไปด้วย ฝ่าย BDI ลงนามรวดเดียวโดยไม่มี
   * การยืนยันรายฉบับ (การ์ดข้อ 4) จึงไม่มีค่านี้มา
   */
  attestationText: z.string().trim().min(1).max(500).optional(),
  confirmationText: z.string().trim().min(1).max(2000),
});

const reviewSchema = z.object({
  action: z.enum(["approve", "request_revision", "reject"]),
  note: z.string().trim().optional(),
  signature: signatureSchema.optional(),
});

/** ด่านที่การอนุมัติคือการลงนามบนเอกสาร จึงต้องมี signature มาด้วย */
const SIGNING_TASKS: Record<string, ConfirmationType> = {
  [ReviewTaskType.ORGANIZATION_APPROVAL]: ConfirmationType.ORGANIZATION_APPROVAL,
  [ReviewTaskType.BDI_FINAL_APPROVAL]: ConfirmationType.BDI_FINAL_APPROVAL,
};

/**
 * จุดตัดสินใจเดียวสำหรับทุกด่าน — ใครทำได้ขึ้นกับ **active review_task** ไม่ใช่ status
 *
 * ลำดับด่าน: BDI_OFFICER_REVIEW → ORGANIZATION_APPROVAL → BDI_FINAL_APPROVAL
 * ผลที่ใช้ได้ต่อด่านถูกบังคับใน lib/workflow.ts ตามตารางในภาพของ sheet `review_task`
 */
organizationRouter.post("/:id/review", async (req, res, next) => {
  try {
    const session = req.session!;
    const parsed = reviewSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "validation", fields: formatZodError(parsed.error) });
      return;
    }
    const { action, note, signature } = parsed.data;

    if (action !== "approve" && (note?.length ?? 0) < 10) {
      res.status(400).json({
        error: "validation",
        fields: { note: "กรุณาระบุสิ่งที่ต้องแก้ไขอย่างน้อย 10 ตัวอักษร" },
      });
      return;
    }

    const request = await prisma.organizationRegistrationRequest.findUnique({
      where: { id: req.params.id },
      include: { organization: true },
    });
    if (!request) {
      res.status(404).json({ error: "not_found", message: "ไม่พบหน่วยงานนี้" });
      return;
    }

    const task = await activeTask(prisma, SUBJECT, request.id);
    if (!task) {
      res
        .status(409)
        .json({ error: "invalid_state", message: "สถานะปัจจุบันไม่รองรับการดำเนินการนี้" });
      return;
    }

    // ใครมีสิทธิ์ปิด task นี้ — role ที่ตรงกับด่าน หรือเป็นผู้รับมอบหมายโดยตรง
    const allowedRoles: Record<ReviewTaskType, RoleCode[]> = {
      [ReviewTaskType.BDI_OFFICER_REVIEW]: [ROLE_CODES.BDI_OFFICER],
      [ReviewTaskType.ORGANIZATION_APPROVAL]: [ROLE_CODES.ORGANIZATION_APPROVER],
      [ReviewTaskType.BDI_FINAL_APPROVAL]: [ROLE_CODES.BDI_FINAL_APPROVER],
      [ReviewTaskType.DATASET_SPECIALIST_REVIEW]: [ROLE_CODES.BDI_DATASET_SPECIALIST],
      [ReviewTaskType.ORGANIZATION_REVISION]: [ROLE_CODES.ORGANIZATION_USER],
    };
    /** ผู้ใช้คนนี้ปิดด่านชนิดนี้ของคำขอนี้ได้ไหม */
    const canAction = (taskType: ReviewTaskType) =>
      session.roles.some((r) => allowedRoles[taskType].includes(r)) ||
      (taskType === ReviewTaskType.ORGANIZATION_APPROVAL &&
        request.approverEmail?.toLowerCase() === session.email.toLowerCase());

    if (!canAction(task.taskType)) {
      /**
       * "ไม่มีสิทธิ์" กับ "คำขอเดินไปแล้ว" ไม่ใช่เรื่องเดียวกัน และเดิมตอบเหมือนกันหมด
       *
       * เคสที่เกิดจริงบ่อยกว่า: ผู้มีอำนาจกระทำการแทนเปิดหน้าไว้ ระหว่างนั้นคำขอถูกปิดด่าน
       * ของเขาไปแล้ว (คนอื่นทำ หรือเขาเองทำจากอีกแท็บ) พอกดลงนาม active task กลายเป็น
       * ด่านของ BDI ซึ่งเขาแตะไม่ได้ ระบบเลยตอบว่า "คุณไม่มีสิทธิ์ดำเนินการขั้นตอนนี้"
       * ทั้งที่เขามีสิทธิ์เต็มที่ในด่านของตัวเอง — ข้อความนั้นส่งเขาไปหาปัญหาเรื่องสิทธิ์
       * ที่ไม่มีอยู่จริง แทนที่จะบอกว่าหน้าจอที่ถืออยู่เป็นข้อมูลเก่า
       *
       * แยกโดยถามว่า "ด่านที่เขาทำได้ของคำขอนี้ ปิดไปแล้วหรือยัง" ถ้าปิดแล้ว = เดินไปแล้ว
       */
      const ownStage = await prisma.reviewTask.findFirst({
        where: {
          subjectType: SUBJECT,
          subjectId: request.id,
          status: ReviewTaskStatus.COMPLETED,
          taskType: { in: Object.values(ReviewTaskType).filter(canAction) },
        },
        orderBy: { completedAt: "desc" },
      });

      if (ownStage) {
        res.status(409).json({
          error: "stage_completed",
          message:
            `ขั้นตอนของคุณในคำขอนี้ดำเนินการเรียบร้อยแล้ว ` +
            `ตอนนี้คำขออยู่ที่ขั้น "${REVIEW_TASK_TYPE_LABELS[task.taskType]}" — ` +
            `หน้าจอที่เปิดอยู่เป็นข้อมูลก่อนหน้านั้น กรุณาโหลดหน้าใหม่`,
        });
        return;
      }

      res.status(403).json({ error: "forbidden", message: "คุณไม่มีสิทธิ์ดำเนินการขั้นตอนนี้" });
      return;
    }

    const result =
      action === "approve"
        ? task.taskType === ReviewTaskType.BDI_OFFICER_REVIEW
          ? ReviewResult.PASSED
          : ReviewResult.APPROVED
        : action === "reject"
          ? ReviewResult.REJECTED
          : ReviewResult.RETURNED;

    /**
     * สองด่านสุดท้ายอนุมัติด้วยการลงนามบนเอกสาร ไม่ใช่กดปุ่มผ่านเฉย ๆ
     *
     * ตรวจให้จบก่อนเปิด transaction: ถ้ารายการเอกสารที่ผู้ใช้กดเห็นชอบไม่ครบหรือไม่ตรงกับ
     * ที่เผยแพร่อยู่ ต้องให้กลับไปอ่านใหม่ ไม่ใช่ปิด task ไปแล้วค่อยพบว่าหลักฐานไม่ครบ
     */
    const confirmationType = SIGNING_TASKS[task.taskType];
    let signedVersionIds: string[] = [];

    if (confirmationType && result === ReviewResult.APPROVED) {
      if (!signature) {
        res.status(400).json({
          error: "signature_required",
          message: "ขั้นตอนนี้ต้องลงนามบนเอกสารข้อตกลง กรุณาอ่านเอกสารให้ครบทุกฉบับแล้วกดลงนาม",
        });
        return;
      }

      const published = await publishedDocuments(prisma, LEGAL_SCOPES.ORGANIZATION_REGISTRATION);
      if (published.length === 0) {
        res.status(503).json({
          error: "no_legal_documents",
          message: "ยังไม่มีเอกสารข้อตกลงที่เผยแพร่ในระบบ กรุณาแจ้งผู้ดูแลระบบ",
        });
        return;
      }

      const acknowledged = new Set(signature.acknowledgements.map((a) => a.versionId));
      const missing = published.filter((doc) => !acknowledged.has(doc.versionId));
      if (missing.length > 0) {
        res.status(400).json({
          error: "documents_not_acknowledged",
          message:
            `ยังมีเอกสารที่ยังไม่ได้เห็นชอบ: ${missing.map((d) => d.code).join(" ")} — ` +
            "เอกสารอาจถูกปรับปรุงเป็นฉบับใหม่ระหว่างที่เปิดหน้านี้อยู่ กรุณาโหลดหน้าใหม่แล้วอ่านอีกครั้ง",
        });
        return;
      }

      signedVersionIds = published.map((doc) => doc.versionId);
    }

    /** ผู้ถือ role เดิมที่เสียสิทธิ์ตอนผูกผู้มีอำนาจ — ประกาศหลัง commit */
    let replacedHolders: RevokedAssignment[] = [];

    const outcome = await prisma.$transaction(async (tx) => {
      await startTask(tx, task.id, session.sub);
      await completeTask(tx, {
        taskId: task.id,
        result,
        comment: note ?? null,
        commentVisibility: "ORGANIZATION",
        actorId: session.sub,
      });

      /**
       * หลักฐานการลงนาม เขียนใน transaction เดียวกับการปิด task
       *
       * ชื่อผู้ลงนามถูก snapshot ลง confirmation_payload_json ด้วย ไม่ได้พึ่ง displayName
       * ของบัญชีตอนอ่าน — เอกสารที่ลงนามแล้วต้องไม่เปลี่ยนชื่อตามเมื่อผู้ใช้แก้โปรไฟล์
       *
       * legal_acceptance เขียนเฉพาะฝ่ายหน่วยงาน: ตารางนี้คือ "ใครยอมรับเอกสารฉบับใด"
       * ซึ่งคือหน่วยงานผู้ลงทะเบียน การลงนามของ BDI เป็นการเห็นชอบของสำนักงาน
       * ไม่ใช่การยอมรับเงื่อนไข จึงมีแต่ signature_confirmation
       */
      if (confirmationType && signature && result === ReviewResult.APPROVED) {
        /**
         * ชื่อที่ปรากฏบนเอกสาร
         *
         * session ถือแค่ id กับอีเมล (ตั้งใจให้เบา) จึงต้องอ่านชื่อจากฐานข้อมูล
         * ฝ่ายหน่วยงานใช้ชื่อจาก snapshot ของคำขอก่อนชื่อบนบัญชี เพราะชื่อในคำขอคือชื่อที่
         * หน่วยงานกรอกว่าเป็นผู้มีอำนาจกระทำการแทน และเป็นชื่อที่ปรากฏในย่อหน้าคู่สัญญา
         * ข้างบนของเอกสารฉบับเดียวกัน — สองที่ต้องเป็นชื่อเดียวกัน
         */
        const account = await tx.userAccount.findUnique({
          where: { id: session.sub },
          select: { displayName: true, prefixTh: true, firstnameTh: true, lastnameTh: true },
        });
        const isOrgSide = confirmationType === ConfirmationType.ORGANIZATION_APPROVAL;
        const signedFirst = isOrgSide ? request.approverFirstnameTh : (account?.firstnameTh ?? null);
        const signedLast = isOrgSide ? request.approverLastnameTh : (account?.lastnameTh ?? null);
        const signedName =
          (isOrgSide
            ? fullName(request.approverPrefixTh, signedFirst, signedLast)
            : fullName(account?.prefixTh, signedFirst, signedLast)) ||
          account?.displayName ||
          session.email;
        const confirmation = await tx.signatureConfirmation.create({
          data: {
            reviewTaskId: task.id,
            subjectType: SUBJECT,
            subjectId: request.id,
            userAccountId: session.sub,
            organizationId: request.organizationId,
            confirmationType,
            confirmationText: signature.confirmationText,
            confirmationPayloadJson: {
              signedName,
              /**
               * เก็บชื่อกับนามสกุลแยกด้วย เพราะเอกสารบางฉบับมีช่อง "ชื่อ" กับ "นามสกุล"
               * แยกกัน ({{bdi_approver.firstName}} / {{bdi_approver.lastName}}) แยกจากชื่อเต็มย้อนหลัง
               * ทำได้แค่เดาจากช่องว่าง จึงเก็บตอนที่ยังรู้แน่ดีกว่า
               */
              signedFirstName: signedFirst,
              signedLastName: signedLast,
              documentVersionIds: signedVersionIds,
            },
            ipAddress: req.ip ?? null,
            userAgent: req.get("user-agent") ?? null,
            createdBy: session.sub,
          },
        });

        if (confirmationType === ConfirmationType.ORGANIZATION_APPROVAL) {
          const attestedAt = new Map(
            signature.acknowledgements.map((a) => [a.versionId, new Date(a.attestedAt)]),
          );
          await tx.legalAcceptance.createMany({
            data: signedVersionIds.map((versionId) => ({
              legalDocumentVersionId: versionId,
              userAccountId: session.sub,
              organizationId: request.organizationId,
              subjectType: SUBJECT,
              subjectId: request.id,
              reviewTaskId: task.id,
              signatureConfirmationId: confirmation.id,
              /**
               * ติ๊กยืนยันว่าอ่านครบทีละฉบับ ไม่ใช่กดปุ่มเดียวรวบทุกฉบับ —
               * sheet แยกสองวิธีนี้ไว้ และตอนนี้ตรงกับ CHECKBOX จริง ๆ
               */
              acceptanceMethod: AcceptanceMethod.CHECKBOX,
              // เวลาที่ติ๊กของฉบับนั้น ไม่ใช่เวลาที่กดลงนามตอนท้าย
              acceptedAt: attestedAt.get(versionId) ?? new Date(),
              acceptanceContextJson: signature.attestationText
                ? { attestationText: signature.attestationText }
                : undefined,
              ipAddress: req.ip ?? null,
              userAgent: req.get("user-agent") ?? null,
              createdBy: session.sub,
            })),
          });
        }
      }

      if (result === ReviewResult.PASSED && task.taskType === ReviewTaskType.BDI_OFFICER_REVIEW) {
        const approver = await ensureApproverAccount(tx, request);
        replacedHolders = approver.replaced;
        await openTask(tx, {
          subjectType: SUBJECT,
          subjectId: request.id,
          taskType: ReviewTaskType.ORGANIZATION_APPROVAL,
          assignedUserId: approver.id,
          assignedRole: ROLE_CODES.ORGANIZATION_APPROVER,
          assignedById: session.sub,
          actorId: session.sub,
        });
      }

      if (result === ReviewResult.APPROVED && task.taskType === ReviewTaskType.ORGANIZATION_APPROVAL) {
        const finalApprover = await pickAssignee(ROLE_CODES.BDI_FINAL_APPROVER, BDI_ORGANIZATION_ID);
        if (!finalApprover) {
          throw new WorkflowError(
            "no_reviewer",
            "ยังไม่มีผู้อนุมัติ BDI ในระบบ กรุณาติดต่อผู้ดูแล",
            503,
          );
        }
        await openTask(tx, {
          subjectType: SUBJECT,
          subjectId: request.id,
          taskType: ReviewTaskType.BDI_FINAL_APPROVAL,
          assignedUserId: finalApprover,
          assignedRole: ROLE_CODES.BDI_FINAL_APPROVER,
          assignedById: session.sub,
          actorId: session.sub,
        });
      }

      // อนุมัติขั้นสุดท้าย — หน่วยงานเปิดใช้งานจริง
      if (result === ReviewResult.APPROVED && task.taskType === ReviewTaskType.BDI_FINAL_APPROVAL) {
        await tx.organizationRegistrationRequest.update({
          where: { id: request.id },
          data: { approvedAt: new Date(), updatedBy: session.sub },
        });
        await tx.organization.update({
          where: { id: request.organizationId },
          data: {
            status: OrganizationStatus.ACTIVE,
            activatedAt: new Date(),
            activatedBy: session.sub,
            // รหัสที่ผู้ใช้ยืนยันในฟอร์มมีน้ำหนักกว่าที่ admin กรอกไว้ตอนสร้าง
            organizationCode: request.organizationCode ?? request.organization.organizationCode,
            nameTh: request.organizationNameTh ?? request.organization.nameTh,
            nameEn: request.organizationNameEn,
            addressLine: request.organizationAddressLine,
            road: request.organizationRoad,
            provinceCode: request.organizationProvinceCode,
            districtCode: request.organizationDistrictCode,
            subDistrictCode: request.organizationSubdistrictCode,
            postalCode: request.organizationPostalCode,
            phone: request.organizationPhone,
            email: request.organizationEmail,
            websiteUrl: request.organizationWebsite,
            updatedBy: session.sub,
          },
        });
      }

      if (result === ReviewResult.REJECTED) {
        await tx.organizationRegistrationRequest.update({
          where: { id: request.id },
          data: { rejectedAt: new Date(), updatedBy: session.sub },
        });
      }

      return syncStatus(tx, request);
    });

    await logAudit({
      action:
        result === ReviewResult.REJECTED
          ? AuditAction.REQUEST_REJECTED
          : result === ReviewResult.RETURNED
            ? AuditAction.REQUEST_RETURNED
            : outcome.status === RequestStatus.APPROVED
              ? AuditAction.REQUEST_APPROVED
              : AuditAction.REQUEST_SUBMITTED,
      subjectType: AuditSubject.ORGANIZATION_REGISTRATION_REQUEST,
      subjectId: request.id,
      organizationId: request.organizationId,
      after: { taskType: task.taskType, result, note },
    });

    if (confirmationType && result === ReviewResult.APPROVED) {
      await logAudit({
        action: AuditAction.DOCUMENT_SIGNED,
        subjectType: AuditSubject.ORGANIZATION_REGISTRATION_REQUEST,
        subjectId: request.id,
        organizationId: request.organizationId,
        after: { confirmationType, documentVersionIds: signedVersionIds },
      });
    }

    await announceRoleReplacement(replacedHolders);

    await dispatchReviewNotifications(request, task.taskType, result, note);

    const fresh = await prisma.organizationRegistrationRequest.findUniqueOrThrow({
      where: { id: request.id },
      include: { organization: true },
    });

    /**
     * ลงนามแล้ว — สร้าง A0 ทับด้วยฉบับที่มีลายมือชื่อ (และตราเห็นชอบเมื่อเป็นด่านสุดท้าย)
     *
     * ทำนอก transaction โดยตั้งใจ ตามแบบเดียวกับ dataset-requests.ts: การเรนเดอร์เอกสาร
     * ต้องคุยกับ LibreOffice และเขียนลง object storage ซึ่งใช้เวลาเป็นวินาที ไม่ควรถือ
     * transaction ของฐานข้อมูลไว้ (ค่า timeout ปกติของ Prisma คือ 5 วินาที) และถ้าขั้นนี้ล้ม
     * การลงนามที่บันทึกไปแล้วต้องไม่ถูกย้อน — หลักฐานอยู่ใน signature_confirmation
     * เรียบร้อยแล้ว เอกสารสร้างซ้ำได้จากหลักฐานนั้นเสมอ
     *
     * ฉบับก่อนหน้ากลายเป็น REPLACED ไม่ได้ถูกลบ จึงยังตรวจย้อนได้ว่าผู้ลงนามเห็นอะไร
     */
    let agreementRendered = true;
    if (confirmationType && result === ReviewResult.APPROVED) {
      try {
        const shape = await toApiShape(fresh);
        // ทุกฉบับที่มี placeholder ไม่ใช่แค่ A0 — ฉบับอื่นอาจมีช่องลงนามของตัวเองด้วย
        await renderPlaceholderDocuments(prisma, {
          request: { ...shape, submittedAt: fresh.submittedAt },
          printedByName: fullName(shape.contactPrefix, shape.contactFirstName, shape.contactLastName),
          actorId: session.sub,
        });
      } catch (err) {
        agreementRendered = false;
        console.error("[organizations] สร้างเอกสารข้อตกลงฉบับลงนามไม่สำเร็จ", err);
      }
    }

    res.json({ organization: await toApiShape(fresh), agreementRendered });
  } catch (err) {
    if (err instanceof DocumentRenderError) {
      res.status(err.status).json({ error: err.code, message: err.message, fields: err.fields });
      return;
    }
    if (err instanceof WorkflowError) {
      res.status(err.status).json({ error: err.code, message: err.message });
      return;
    }
    next(err);
  }
});

/**
 * ผู้มีอำนาจกระทำการแทนต้องมี user_account ก่อน เพราะ review_task.assigned_user_id
 * เป็น NOT NULL — สร้างบัญชี PENDING พร้อม activation key ให้ถ้ายังไม่มี
 * (ขั้นที่ 1–3 ของ "Suggested lifecycle" ใน sheet `activation_key`)
 */
async function ensureApproverAccount(
  tx: Prisma.TransactionClient,
  request: RequestRow,
): Promise<{ id: string; replaced: RevokedAssignment[] }> {
  const email = request.approverEmail;
  if (!email) {
    throw new WorkflowError("no_approver", "คำขอนี้ยังไม่ได้ระบุอีเมลผู้มีอำนาจกระทำการแทน");
  }

  const displayName =
    [request.approverPrefixTh, request.approverFirstnameTh, request.approverLastnameTh]
      .filter(Boolean)
      .join(" ") || email;

  const existing = await tx.userAccount.findUnique({ where: { email } });

  /**
   * `user_account.cid` เป็น unique — หนึ่งเลขบัตรหนึ่งบัญชี
   *
   * เกิดได้จริงเมื่อผู้มีอำนาจคนเดียวกันถูกกรอกด้วยอีเมลคนละใบในสองคำขอ หรือกรอก
   * เลขบัตรผิดไปตรงกับของคนอื่น ถ้าปล่อยให้ create ชน P2002 คนกรอกฟอร์มจะเห็นแค่
   * ข้อผิดพลาดรวม ๆ ตอนกดนำส่ง โดยไม่รู้ว่าต้องกลับไปแก้ช่องไหน
   */
  if (!existing && request.approverCid) {
    const sameCid = await tx.userAccount.findUnique({ where: { cid: request.approverCid } });
    if (sameCid) {
      throw new WorkflowError(
        "approver_cid_exists",
        `เลขบัตรประชาชนของผู้มีอำนาจกระทำการแทนเป็นของบัญชี ${sameCid.email} อยู่แล้ว ` +
          `กรุณาตรวจสอบเลขบัตร หรือแก้อีเมลผู้มีอำนาจให้เป็นอีเมลของบัญชีนั้น`,
        409,
      );
    }
  }

  const account =
    existing ??
    (await tx.userAccount.create({
      data: {
        email,
        cid: request.approverCid,
        prefixTh: request.approverPrefixTh,
        firstnameTh: request.approverFirstnameTh,
        lastnameTh: request.approverLastnameTh,
        phoneNumber: request.approverPhoneNumber,
        positionTh: request.approverPositionTh,
        departmentTh: request.approverDepartmentTh,
        displayName,
        accountType: AccountType.ORGANIZATION,
        status: UserAccountStatus.PENDING,
        createdBy: SYSTEM_USER_ID,
        updatedBy: SYSTEM_USER_ID,
      },
    }));

  let replaced: RevokedAssignment[] = [];

  if (account.status === UserAccountStatus.ACTIVE) {
    // มีบัญชีอยู่แล้ว — ผูก role ผู้มีอำนาจให้กับหน่วยงานนี้ ผู้ถือคนเดิม (ถ้ามี) เสียสิทธิ์
    // ตรงนี้ ผู้เรียกต้องแจ้งเขาหลัง transaction commit
    ({ replaced } = await assignRole(tx, {
      userAccountId: account.id,
      roleCode: ROLE_CODES.ORGANIZATION_APPROVER,
      organizationId: request.organizationId,
      actorId: SYSTEM_USER_ID,
    }));
  } else {
    // ยังไม่มีบัญชีใช้งานได้ — ออก activation key ให้ไปสมัคร
    const { key } = await issueActivationKey(tx, {
      userAccountId: account.id,
      organizationId: request.organizationId,
      roleCode: ROLE_CODES.ORGANIZATION_APPROVER,
    });
    // ส่งอีเมลนอก transaction ไม่ได้เพราะต้องใช้ raw key — ยอมส่งในนี้
    void sendInvitationEmail(email, key, ROLE_LABELS[ROLE_CODES.ORGANIZATION_APPROVER]);
  }

  return { id: account.id, replaced };
}

async function dispatchReviewNotifications(
  request: RequestRow,
  taskType: ReviewTaskType,
  result: ReviewResult,
  note: string | undefined,
) {
  const name = request.organizationNameTh ?? request.organization.nameTh;
  const members = await organizationMemberIds(request.organizationId);

  /**
   * ฝั่งหน่วยงานได้ยินทุกครั้งที่คำขอขยับ ไม่ใช่แค่ตอนถูกส่งกลับหรืออนุมัติจบ
   * announceProgress() เงียบเองเมื่อไม่มีด่านใหม่เปิดขึ้น จึงเรียกก่อนแล้วปล่อยให้
   * การแจ้ง "คนต่อไปที่ต้องทำ" ด้านล่างทำงานตามเดิม — คนละกลุ่มผู้รับ ไม่ทับกัน
   */
  const progress = await announceProgress({
    subjectType: SUBJECT,
    subjectId: request.id,
    organizationId: request.organizationId,
    createdBy: request.createdBy,
    subjectLabel: `${name} — ${request.requestNumber}`,
  });

  if (result === ReviewResult.RETURNED) {
    await notifyUsers([...members.users, request.createdBy], {
      type: NotificationType.REQUEST_RETURNED,
      title: "คำขอถูกส่งกลับให้แก้ไข",
      message: note ?? "",
      subjectType: SUBJECT,
      subjectId: request.id,
      organizationId: request.organizationId,
    });
    return;
  }

  if (result === ReviewResult.REJECTED) {
    await notifyUsers([...members.users, request.createdBy], {
      type: NotificationType.REQUEST_REJECTED,
      title: "คำขอไม่ได้รับอนุมัติ",
      message: note ?? "",
      subjectType: SUBJECT,
      subjectId: request.id,
      organizationId: request.organizationId,
    });
    return;
  }

  if (taskType === ReviewTaskType.BDI_OFFICER_REVIEW && request.approverEmail) {
    await sendSignatoryRequest(request.approverEmail, name, request.id, undefined, progress);
    return;
  }

  if (taskType === ReviewTaskType.ORGANIZATION_APPROVAL) {
    await notifyUsers(await bdiApproverIds(), {
      type: NotificationType.REQUEST_SUBMITTED,
      title: "มีคำขอรออนุมัติขั้นสุดท้าย",
      message: `${name} — ${request.requestNumber}`,
      subjectType: SUBJECT,
      subjectId: request.id,
      organizationId: request.organizationId,
    });
    return;
  }

  if (taskType === ReviewTaskType.BDI_FINAL_APPROVAL) {
    await notifyUsers([...members.users, ...members.approvers, request.createdBy], {
      type: NotificationType.REQUEST_APPROVED,
      title: "หน่วยงานได้รับอนุมัติแล้ว",
      message: `${name} เปิดใช้งานเรียบร้อย`,
      subjectType: SUBJECT,
      subjectId: request.id,
      organizationId: request.organizationId,
    });
  }
}
