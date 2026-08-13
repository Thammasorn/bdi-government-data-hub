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
import { Router } from "express";
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
  publicAttachment,
  storeAttachment,
  streamAttachment,
} from "../lib/attachment.js";
import { AuditAction, AuditSubject, logAudit } from "../lib/audit.js";
import { assignRole, issueActivationKey } from "../lib/iam.js";
import {
  sendActivated,
  sendFinalApprovalRequest,
  sendInvitationEmail,
  sendRevisionRequested,
  sendSignatoryRequest,
  sendSubmittedToOfficers,
} from "../lib/mail.js";
import { NotificationType, bdiApproverIds, bdiOfficerIds, emailsOf, notifyUsers, organizationMemberIds } from "../lib/notify.js";
import { renderOrganizationForm } from "../lib/pdf.js";
import { nextOrganizationCode, nextOrganizationRequestNumber } from "../lib/request-number.js";
import { ROLE_LABELS, isBdiStaff } from "../lib/roles.js";
import {
  PLACEHOLDER_ORGANIZATION_NAME,
  ROLE_CODES,
  SYSTEM_USER_ID,
  type RoleCode,
} from "../lib/system.js";
import { emailSchema, formatZodError, nationalIdSchema, phoneSchema } from "../lib/validation.js";
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
 * ตอนบันทึกร่างยอมให้ว่างได้ ตอนนำส่งต้องครบ — จึงแยกเป็นสองชุด
 *
 * ชื่อฟิลด์ฝั่ง API ยังเป็นชุดเดิม (name / signatory* / contact*) เพื่อไม่ให้ frontend
 * ต้องแก้ทั้งฟอร์ม การแปลงไปเป็นคอลัมน์ snapshot ของดีไซน์ (organization_name_th /
 * approver_* / user_*) เกิดที่ toRequestData() ข้างล่าง
 */
const draftSchema = z.object({
  name: z.string().trim().max(200).optional(),
  nameEn: z.string().trim().max(200).optional(),
  organizationType: z.string().trim().max(64).optional(),
  addressLine: z.string().trim().max(300).optional(),
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

const submitSchema = z.object({
  name: z.string().trim().min(3, "ชื่อหน่วยงานต้องมีอย่างน้อย 3 ตัวอักษร").max(200),
  addressLine: z.string().trim().min(1, "กรุณากรอกที่อยู่"),
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

  return {
    organizationType: input.organizationType,
    organizationNameTh: input.name,
    organizationNameEn: input.nameEn,
    organizationAddressLine: input.addressLine,
    organizationProvinceCode: codes.provinceCode,
    organizationDistrictCode: codes.districtCode,
    organizationSubdistrictCode: codes.subDistrictCode,
    organizationPostalCode: postalCode,
    organizationPhone: input.phone,
    organizationEmail: input.email,
    organizationWebsite: input.websiteUrl,

    approverPrefixTh: input.signatoryPrefix,
    approverFirstnameTh: input.signatoryFirstName,
    approverLastnameTh: input.signatoryLastName,
    approverPositionTh: input.signatoryPosition,
    approverEmail: input.signatoryEmail,
    approverCid: input.signatoryNationalId,
    approverPhoneNumber: input.signatoryPhone,
    approverDepartmentTh: input.signatoryDepartment,

    userPrefixTh: input.contactPrefix,
    userFirstnameTh: input.contactFirstName,
    userLastnameTh: input.contactLastName,
    userPositionTh: input.contactPosition,
    userDepartmentTh: input.contactDepartment,
    userEmail: input.contactEmail,
    userPhoneNumber: input.contactPhone,
    userCid: input.contactNationalId,
  };
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
    organizationCode: request.organization.organizationCode,

    name: request.organizationNameTh,
    nameEn: request.organizationNameEn,
    organizationType: request.organizationType,
    addressLine: request.organizationAddressLine,
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
    signatoryEmail: request.approverEmail,
    signatoryNationalId: request.approverCid,
    signatoryPhone: request.approverPhoneNumber,

    contactPrefix: request.userPrefixTh,
    contactFirstName: request.userFirstnameTh,
    contactLastName: request.userLastnameTh,
    contactPosition: request.userPositionTh,
    contactDepartment: request.userDepartmentTh,
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
    },
  });

  // ด่านที่แต่ละคำขอค้างอยู่ — badge บนหน้าจอใช้ค่านี้แทน PENDING_* ที่หายไปจาก status
  const tasks = await prisma.reviewTask.findMany({
    where: {
      subjectType: SUBJECT,
      subjectId: { in: requests.map((r) => r.id) },
      status: { in: [ReviewTaskStatus.PENDING, ReviewTaskStatus.IN_PROGRESS] },
    },
    select: { subjectId: true, taskType: true, roundNumber: true },
  });
  const stageBySubject = new Map(tasks.map((t) => [t.subjectId, t]));

  res.json({
    organizations: requests.map((r) => ({
      id: r.id,
      requestNumber: r.requestNumber,
      name: r.organizationNameTh,
      status: r.status,
      currentTaskType: stageBySubject.get(r.id)?.taskType ?? null,
      currentRound: stageBySubject.get(r.id)?.roundNumber ?? null,
      submittedAt: r.submittedAt,
      createdAt: r.createdAt,
      organizationId: r.organizationId,
      createdBy: {
        email: r.userEmail,
        firstName: r.userFirstnameTh,
        lastName: r.userLastnameTh,
      },
    })),
  });
});

// ---------------------------------------------------------------- create draft

organizationRouter.post("/", async (req, res) => {
  const session = req.session!;
  if (isBdiStaff(session.roles)) {
    res.status(403).json({ error: "forbidden", message: "เจ้าหน้าที่ BDI ไม่สามารถสร้างหน่วยงานได้" });
    return;
  }

  const existing = await prisma.organizationRegistrationRequest.findFirst({
    where: {
      createdBy: session.sub,
      status: { notIn: [RequestStatus.APPROVED, RequestStatus.REJECTED, RequestStatus.CANCELLED] },
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
    await assignRole(tx, {
      userAccountId: session.sub,
      roleCode: ROLE_CODES.ORGANIZATION_USER,
      organizationId: organization.id,
      actorId: session.sub,
    });

    return request;
  });

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

organizationRouter.get("/:id", async (req, res) => {
  const session = req.session!;
  const request = await prisma.organizationRegistrationRequest.findUnique({
    where: { id: req.params.id },
    include: { organization: true },
  });
  if (!request || !canView(session, request)) {
    res.status(404).json({ error: "not_found", message: "ไม่พบหน่วยงานนี้" });
    return;
  }

  const [attachments, tasks, active] = await Promise.all([
    activeAttachments(prisma, AttachmentOwnerType.ORGANIZATION_REGISTRATION_REQUEST, request.id),
    taskHistory(prisma, SUBJECT, request.id),
    activeTask(prisma, SUBJECT, request.id),
  ]);

  res.json({
    organization: {
      ...(await toApiShape(request)),
      currentTaskType: active?.taskType ?? null,
      currentRound: active?.roundNumber ?? null,
      currentAssignee: active?.assignedUser?.displayName ?? null,
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
    file: req.file,
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
  const parsed = submitSchema.safeParse(shape);
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

  const pdf = await renderOrganizationForm(shape);
  const attachment = await storeAttachment(prisma, {
    ownerType: AttachmentOwnerType.ORGANIZATION_REGISTRATION_REQUEST,
    ownerId: request.id,
    attachmentType: AttachmentType.GENERATED_FORM,
    file: {
      buffer: pdf,
      originalname: `แบบฟอร์มสร้างหน่วยงาน-${shape.name}.pdf`,
      mimetype: "application/pdf",
      size: pdf.length,
    },
    uploadedBy: session.sub,
  });

  res.status(201).json({ attachment: publicAttachment(attachment) });
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
  const parsed = submitSchema.safeParse(shape);
  if (!parsed.success) {
    res.status(400).json({ error: "validation", fields: formatZodError(parsed.error) });
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

  const officer = await pickAssignee(ROLE_CODES.BDI_OFFICER, null);
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

const reviewSchema = z.object({
  action: z.enum(["approve", "request_revision", "reject"]),
  note: z.string().trim().optional(),
});

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
    const { action, note } = parsed.data;

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
    const isApproverByEmail =
      task.taskType === ReviewTaskType.ORGANIZATION_APPROVAL &&
      request.approverEmail?.toLowerCase() === session.email.toLowerCase();

    if (!session.roles.some((r) => allowedRoles[task.taskType].includes(r)) && !isApproverByEmail) {
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

    const outcome = await prisma.$transaction(async (tx) => {
      await startTask(tx, task.id, session.sub);
      await completeTask(tx, {
        taskId: task.id,
        result,
        comment: note ?? null,
        commentVisibility: "ORGANIZATION",
        actorId: session.sub,
      });

      if (result === ReviewResult.PASSED && task.taskType === ReviewTaskType.BDI_OFFICER_REVIEW) {
        const approverId = await ensureApproverAccount(tx, request);
        await openTask(tx, {
          subjectType: SUBJECT,
          subjectId: request.id,
          taskType: ReviewTaskType.ORGANIZATION_APPROVAL,
          assignedUserId: approverId,
          assignedRole: ROLE_CODES.ORGANIZATION_APPROVER,
          assignedById: session.sub,
          actorId: session.sub,
        });
      }

      if (result === ReviewResult.APPROVED && task.taskType === ReviewTaskType.ORGANIZATION_APPROVAL) {
        const finalApprover = await pickAssignee(ROLE_CODES.BDI_FINAL_APPROVER, null);
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
            nameTh: request.organizationNameTh ?? request.organization.nameTh,
            nameEn: request.organizationNameEn,
            addressLine: request.organizationAddressLine,
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

    await dispatchReviewNotifications(request, task.taskType, result, note);

    const fresh = await prisma.organizationRegistrationRequest.findUniqueOrThrow({
      where: { id: request.id },
      include: { organization: true },
    });
    res.json({ organization: await toApiShape(fresh) });
  } catch (err) {
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
): Promise<string> {
  const email = request.approverEmail;
  if (!email) {
    throw new WorkflowError("no_approver", "คำขอนี้ยังไม่ได้ระบุอีเมลผู้มีอำนาจกระทำการแทน");
  }

  const displayName =
    [request.approverPrefixTh, request.approverFirstnameTh, request.approverLastnameTh]
      .filter(Boolean)
      .join(" ") || email;

  const existing = await tx.userAccount.findUnique({ where: { email } });

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

  if (account.status === UserAccountStatus.ACTIVE) {
    // มีบัญชีอยู่แล้ว — ผูก role ผู้มีอำนาจให้กับหน่วยงานนี้
    await assignRole(tx, {
      userAccountId: account.id,
      roleCode: ROLE_CODES.ORGANIZATION_APPROVER,
      organizationId: request.organizationId,
      actorId: SYSTEM_USER_ID,
    });
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

  return account.id;
}

async function dispatchReviewNotifications(
  request: RequestRow,
  taskType: ReviewTaskType,
  result: ReviewResult,
  note: string | undefined,
) {
  const name = request.organizationNameTh ?? request.organization.nameTh;
  const members = await organizationMemberIds(request.organizationId);

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
    await sendSignatoryRequest(request.approverEmail, name, request.id);
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
