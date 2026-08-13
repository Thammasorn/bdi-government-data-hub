/**
 * Journey C — ขอลงทะเบียนชุดข้อมูล
 *
 * โครงตามดีไซน์ใน Excel (ภาพใน sheet `dataset_registration_request`):
 *
 *   dataset_registration_request  1:1  dataset_registration_metadata
 *              │ หลังอนุมัติ
 *              ▼
 *          dataset            1:1  dataset_metadata
 *
 * ลำดับด่านใน review.review_task:
 *   BDI_OFFICER_REVIEW → [DATASET_SPECIALIST_REVIEW] → BDI_OFFICER_REVIEW
 *   → ORGANIZATION_APPROVAL → BDI_OFFICER_REVIEW (ตรวจซ้ำ) → BDI_FINAL_APPROVAL
 *
 * ด่าน "ตรวจซ้ำ" ไม่มี task_type ของตัวเองในดีไซน์ — ใช้ BDI_OFFICER_REVIEW รอบถัดไป
 * แล้วดูจากประวัติว่า ORGANIZATION_APPROVAL ผ่านไปแล้วหรือยัง (nextStageAfter())
 */
import { Router } from "../lib/async-route.js";
import multer from "multer";
import { z } from "zod";
import {
  AttachmentOwnerType,
  AttachmentStatus,
  AttachmentType,
  CommentVisibility,
  DatasetStatus,
  IntegrationType,
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
import {
  activeAttachment,
  activeAttachments,
  publicAttachment,
  storeAttachment,
  streamAttachment,
} from "../lib/attachment.js";
import { AuditAction, AuditSubject, logAudit } from "../lib/audit.js";
import { correlationId } from "../lib/context.js";
import {
  DATASET_ALLOWED_MIME,
  DATASET_MAX_UPLOAD_BYTES,
  datasetDraftSchema,
  datasetSubmitSchema,
  fromMetadataRow,
  toMetadataColumns,
} from "../lib/dataset.js";
import {
  sendDatasetApproved,
  sendDatasetRejected,
  sendDatasetRevisionRequested,
  sendDatasetSubmitted,
  sendDatasetPendingBdiApproval,
  sendDatasetPendingOrgApprover,
  sendDatasetSpecialistAssigned,
} from "../lib/mail.js";
import {
  NotificationType,
  bdiApproverIds,
  bdiOfficerIds,
  emailsOf,
  notifyUsers,
  organizationMemberIds,
} from "../lib/notify.js";
import { renderDatasetRegistrationForm } from "../lib/pdf.js";
import { nextDatasetCode, nextDatasetRequestNumber } from "../lib/request-number.js";
import { isBdiStaff } from "../lib/roles.js";
import { ROLE_CODES, SYSTEM_USER_ID, type RoleCode } from "../lib/system.js";
import { formatZodError, isUuid } from "../lib/validation.js";
import {
  WorkflowError,
  activeTask,
  cancelActiveTask,
  completeTask,
  deriveRequestStatus,
  openTask,
  recordComment,
  startTask,
  taskHistory,
} from "../lib/workflow.js";
import { requireAuth } from "../middleware/auth.js";

export const datasetRequestRouter = Router();
datasetRequestRouter.use(requireAuth);

/** เหมือน organizationRouter — id ที่ไม่ใช่ UUID คือ 404 ไม่ใช่ 500 */
for (const name of ["id", "attachmentId"]) {
  datasetRequestRouter.param(name, (_req, res, next, value: string) => {
    if (!isUuid(value)) {
      res.status(404).json({ error: "not_found", message: "ไม่พบรายการนี้" });
      return;
    }
    next();
  });
}

const SUBJECT = SubjectType.DATASET_REGISTRATION_REQUEST;
const OWNER = AttachmentOwnerType.DATASET_REGISTRATION_REQUEST;

interface Session {
  sub: string;
  email: string;
  roles: RoleCode[];
  organizationId: string | null;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: DATASET_MAX_UPLOAD_BYTES },
});

// ---------------------------------------------------------------- helpers

const requestInclude = {
  metadata: true,
  organization: { select: { id: true, nameTh: true, status: true } },
} satisfies Prisma.DatasetRegistrationRequestInclude;

type RequestRow = Prisma.DatasetRegistrationRequestGetPayload<{ include: typeof requestInclude }>;

/** ขอบเขตที่ผู้ใช้แต่ละ role มองเห็น (§4.7) */
function visibilityFilter(session: Session): Prisma.DatasetRegistrationRequestWhereInput {
  if (isBdiStaff(session.roles)) return {};
  if (session.organizationId) return { organizationId: session.organizationId };
  return { createdBy: session.sub };
}

const datasetLabel = (r: RequestRow) =>
  r.metadata?.titleTh?.trim() || r.proposedTitle?.trim() || `คำขอ ${r.requestNumber}`;

async function displayName(userId: string): Promise<string> {
  const user = await prisma.userAccount.findUnique({
    where: { id: userId },
    select: { displayName: true, email: true },
  });
  return user?.displayName || user?.email || "ไม่ทราบชื่อ";
}

/**
 * เงื่อนไขก่อนสร้างคำขอ (§4.1) — คืนข้อความอธิบายเมื่อยังไม่ครบ
 * ใช้ทั้งตอนสร้างจริงและตอนให้หน้าเว็บรู้ว่าจะเปิดปุ่มได้หรือยัง
 */
async function prerequisiteError(session: Session): Promise<string | null> {
  if (!session.roles.includes(ROLE_CODES.ORGANIZATION_USER)) {
    return "เฉพาะผู้ใช้จากหน่วยงานเท่านั้นที่ยื่นคำขอลงทะเบียนชุดข้อมูลได้";
  }
  if (!session.organizationId) return "กรุณาสร้างหน่วยงานของคุณให้เรียบร้อยก่อน";

  const org = await prisma.organization.findUnique({
    where: { id: session.organizationId },
    select: { status: true },
  });
  if (!org) return "ไม่พบหน่วยงานของคุณ";
  if (org.status !== OrganizationStatus.ACTIVE) {
    return "หน่วยงานของคุณต้องผ่านการอนุมัติและเปิดใช้งานก่อนจึงจะลงทะเบียนชุดข้อมูลได้";
  }

  const members = await organizationMemberIds(session.organizationId);
  if (members.users.length === 0) return "หน่วยงานต้องมีผู้ใช้ที่เปิดใช้งานแล้วอย่างน้อยหนึ่งคน";
  if (members.approvers.length === 0) {
    return "หน่วยงานต้องมีผู้มีอำนาจกระทำการแทนที่เปิดใช้งานบัญชีแล้ว จึงจะลงทะเบียนชุดข้อมูลได้";
  }
  return null;
}

function mayEdit(session: Session, request: { organizationId: string; createdBy: string }): boolean {
  if (isBdiStaff(session.roles)) return false;
  return session.organizationId === request.organizationId || request.createdBy === session.sub;
}

/** เลือกผู้รับมอบหมายที่ว่างที่สุด — assigned_user_id เป็น NOT NULL ในดีไซน์ */
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
  return tx.datasetRegistrationRequest.update({
    where: { id: request.id },
    data: { status, updatedBy: SYSTEM_USER_ID },
  });
}

/** รูปข้อมูลที่ frontend และ zod ชุด submit ใช้ */
function toApiShape(request: RequestRow, extra?: Record<string, unknown>) {
  const metadata = request.metadata
    ? fromMetadataRow(request.metadata)
    : fromMetadataRow({
        titleTh: null, titleEn: null, descriptionTh: null, descriptionEn: null, objective: null,
        datasetCategoryCode: null, dataOwnerDepartment: null, contactName: null, contactEmail: null,
        contactPhone: null, updateFrequency: null, coverageStartDate: null, coverageEndDate: null,
        geographicScope: null, containsPersonalData: null, containsSensitiveData: null,
        accessLevel: null, deliveryMethod: null, dataFormat: null, additionalMetadataJson: null,
      });

  return {
    id: request.id,
    requestNumber: request.requestNumber,
    status: request.status,
    organizationId: request.organizationId,
    organization: { id: request.organization.id, name: request.organization.nameTh },
    createdById: request.createdBy,
    createdDatasetId: request.createdDatasetId,
    submittedAt: request.submittedAt,
    approvedAt: request.approvedAt,
    rejectedAt: request.rejectedAt,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
    ...metadata,
    ...extra,
  };
}

// ---------------------------------------------------------------- list

datasetRequestRouter.get("/", async (req, res) => {
  const session = req.session! as Session;
  const { status, q } = req.query as { status?: string; q?: string };

  const where: Prisma.DatasetRegistrationRequestWhereInput = { ...visibilityFilter(session) };

  const statuses = (status ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is RequestStatus => s in RequestStatus);
  if (statuses.length > 0) where.status = { in: statuses };

  if (q?.trim()) {
    const search = q.trim();
    where.OR = [
      { requestNumber: { contains: search, mode: "insensitive" } },
      { proposedTitle: { contains: search, mode: "insensitive" } },
      { metadata: { titleTh: { contains: search, mode: "insensitive" } } },
    ];
  }

  const requests = await prisma.datasetRegistrationRequest.findMany({
    where,
    orderBy: [{ submittedAt: "desc" }, { createdAt: "desc" }],
    take: 200,
    include: requestInclude,
  });

  const tasks = await prisma.reviewTask.findMany({
    where: {
      subjectType: SUBJECT,
      subjectId: { in: requests.map((r) => r.id) },
      status: { in: [ReviewTaskStatus.PENDING, ReviewTaskStatus.IN_PROGRESS] },
    },
    select: { subjectId: true, taskType: true, roundNumber: true, assignedUserId: true },
  });
  const stage = new Map(tasks.map((t) => [t.subjectId, t]));

  // เอกสารที่ระบบสร้าง — หน้าแรกทำปุ่มดาวน์โหลดในรายการได้โดยไม่ต้องเปิดคำขอทีละใบ
  const forms = await prisma.attachment.findMany({
    where: {
      ownerType: OWNER,
      ownerId: { in: requests.map((r) => r.id) },
      attachmentType: AttachmentType.GENERATED_FORM,
      status: AttachmentStatus.ACTIVE,
    },
    select: { id: true, ownerId: true, originalFileName: true },
  });
  const formByRequest = new Map(forms.map((f) => [f.ownerId, f]));

  res.json({
    requests: requests.map((r) => ({
      ...toApiShape(r),
      currentTaskType: stage.get(r.id)?.taskType ?? null,
      currentRound: stage.get(r.id)?.roundNumber ?? null,
      assignedSpecialistId:
        stage.get(r.id)?.taskType === ReviewTaskType.DATASET_SPECIALIST_REVIEW
          ? (stage.get(r.id)?.assignedUserId ?? null)
          : null,
      generatedForm: formByRequest.has(r.id)
        ? { id: formByRequest.get(r.id)!.id, filename: formByRequest.get(r.id)!.originalFileName }
        : null,
    })),
  });
});

datasetRequestRouter.get("/eligibility", async (req, res) => {
  const reason = await prerequisiteError(req.session! as Session);
  res.json({ eligible: reason === null, reason });
});

/** รายชื่อผู้เชี่ยวชาญให้ BDI Officer เลือก assign (§4.4) */
datasetRequestRouter.get("/specialists", async (req, res) => {
  const session = req.session! as Session;
  if (!session.roles.includes(ROLE_CODES.BDI_OFFICER)) {
    res.status(403).json({ error: "forbidden", message: "เฉพาะเจ้าหน้าที่ BDI เท่านั้น" });
    return;
  }
  const assignments = await prisma.userRoleAssignment.findMany({
    where: {
      role: { code: ROLE_CODES.BDI_DATASET_SPECIALIST, isActive: true },
      status: "ACTIVE",
      userAccount: { status: UserAccountStatus.ACTIVE },
    },
    select: {
      userAccount: {
        select: { id: true, email: true, prefixTh: true, firstnameTh: true, lastnameTh: true },
      },
    },
  });
  res.json({
    specialists: assignments.map((a) => ({
      id: a.userAccount.id,
      email: a.userAccount.email,
      prefix: a.userAccount.prefixTh,
      firstName: a.userAccount.firstnameTh,
      lastName: a.userAccount.lastnameTh,
    })),
  });
});

// ---------------------------------------------------------------- create draft

datasetRequestRouter.post("/", async (req, res) => {
  const session = req.session! as Session;
  const reason = await prerequisiteError(session);
  if (reason) {
    res.status(403).json({ error: "not_eligible", message: reason });
    return;
  }

  const parsed = datasetDraftSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "validation", fields: formatZodError(parsed.error) });
    return;
  }

  const { columns, extra } = toMetadataColumns(parsed.data);

  const created = await prisma.$transaction(async (tx) => {
    const request = await tx.datasetRegistrationRequest.create({
      data: {
        requestNumber: await nextDatasetRequestNumber(tx),
        organizationId: session.organizationId!,
        status: RequestStatus.DRAFT,
        proposedTitle: parsed.data.nameTh ?? null,
        createdBy: session.sub,
        updatedBy: session.sub,
        metadata: {
          create: { ...columns, additionalMetadataJson: extra as Prisma.InputJsonValue, createdBy: session.sub, updatedBy: session.sub },
        },
      },
      include: requestInclude,
    });
    return request;
  });

  await logAudit({
    action: AuditAction.REQUEST_CREATED,
    subjectType: AuditSubject.DATASET_REGISTRATION_REQUEST,
    subjectId: created.id,
    organizationId: created.organizationId,
    after: { requestNumber: created.requestNumber },
  });

  res.status(201).json({ request: toApiShape(created) });
});

// ---------------------------------------------------------------- detail

datasetRequestRouter.get("/:id", async (req, res) => {
  const session = req.session! as Session;
  const request = await prisma.datasetRegistrationRequest.findFirst({
    where: { id: req.params.id, ...visibilityFilter(session) },
    include: requestInclude,
  });
  if (!request) {
    res.status(404).json({ error: "not_found", message: "ไม่พบคำขอนี้" });
    return;
  }

  const [attachments, tasks, active, creator] = await Promise.all([
    activeAttachments(prisma, OWNER, request.id),
    taskHistory(prisma, SUBJECT, request.id),
    activeTask(prisma, SUBJECT, request.id),
    // created_by เป็นคอลัมน์ uuid เปล่า ไม่ใช่ relation จึงต้องอ่านเอง
    prisma.userAccount.findUnique({
      where: { id: request.createdBy },
      select: { id: true, email: true, prefixTh: true, firstnameTh: true, lastnameTh: true },
    }),
  ]);

  const isOrgSide = !isBdiStaff(session.roles);

  res.json({
    request: toApiShape(request, {
      // หัวข้อหน้ารายละเอียดเขียนว่า "ยื่นโดย <ชื่อ>" — ตกหล่นไปตอนย้ายสคีมา
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
      assignedSpecialistId:
        active?.taskType === ReviewTaskType.DATASET_SPECIALIST_REVIEW
          ? active.assignedUserId
          : null,
      attachments: attachments.map(publicAttachment),
      // timeline มาจาก review_task แทน dataset_request_events เดิม
      // ความเห็นที่ตั้งไว้เป็น BDI_INTERNAL ถูกซ่อนจากฝั่งหน่วยงาน
      events: tasks.map((t) => ({
        id: t.id,
        taskType: t.taskType,
        sequenceNumber: t.sequenceNumber,
        roundNumber: t.roundNumber,
        status: t.status,
        result: t.result,
        note:
          isOrgSide && t.commentVisibility === CommentVisibility.BDI_INTERNAL
            ? null
            : t.resultComment,
        actor: t.assignedUser
          ? { id: t.assignedUser.id, name: t.assignedUser.displayName, email: t.assignedUser.email }
          : null,
        assignedAt: t.assignedAt,
        startedAt: t.startedAt,
        completedAt: t.completedAt,
        createdAt: t.assignedAt,
      })),
    }),
  });
});

// ---------------------------------------------------------------- save draft

datasetRequestRouter.patch("/:id", async (req, res) => {
  const session = req.session! as Session;
  const request = await prisma.datasetRegistrationRequest.findUnique({
    where: { id: req.params.id },
    include: requestInclude,
  });
  if (!request || !mayEdit(session, request)) {
    res.status(404).json({ error: "not_found", message: "ไม่พบคำขอนี้" });
    return;
  }
  if (request.status !== RequestStatus.DRAFT && request.status !== RequestStatus.RETURNED) {
    res.status(409).json({ error: "locked", message: "คำขออยู่ระหว่างการตรวจสอบ แก้ไขไม่ได้" });
    return;
  }

  const parsed = datasetDraftSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "validation", fields: formatZodError(parsed.error) });
    return;
  }

  const { columns, extra } = toMetadataColumns(
    parsed.data,
    request.metadata?.additionalMetadataJson,
  );

  const updated = await prisma.$transaction(async (tx) => {
    await tx.datasetRegistrationMetadata.upsert({
      where: { datasetRegistrationRequestId: request.id },
      update: { ...columns, additionalMetadataJson: extra as Prisma.InputJsonValue, updatedBy: session.sub },
      create: {
        datasetRegistrationRequestId: request.id,
        ...columns,
        additionalMetadataJson: extra as Prisma.InputJsonValue,
        createdBy: session.sub,
        updatedBy: session.sub,
      },
    });
    return tx.datasetRegistrationRequest.update({
      where: { id: request.id },
      data: {
        proposedTitle: parsed.data.nameTh ?? request.proposedTitle,
        updatedBy: session.sub,
      },
      include: requestInclude,
    });
  });

  res.json({ request: toApiShape(updated) });
});

// ---------------------------------------------------------------- attachments

datasetRequestRouter.post("/:id/attachments", upload.single("file"), async (req, res) => {
  const session = req.session! as Session;
  const kind = String(req.body?.kind ?? "");
  if (kind !== "DATA_DICTIONARY" && kind !== "EXAMPLE_DATA") {
    res.status(400).json({ error: "validation", message: "ประเภทเอกสารไม่ถูกต้อง" });
    return;
  }
  if (!req.file) {
    res.status(400).json({ error: "validation", message: "กรุณาเลือกไฟล์" });
    return;
  }
  if (!DATASET_ALLOWED_MIME[kind].includes(req.file.mimetype)) {
    res.status(400).json({ error: "validation", message: "ชนิดไฟล์นี้ไม่รองรับ" });
    return;
  }

  const request = await prisma.datasetRegistrationRequest.findUnique({
    where: { id: req.params.id },
  });
  if (!request || !mayEdit(session, request)) {
    res.status(404).json({ error: "not_found", message: "ไม่พบคำขอนี้" });
    return;
  }

  const attachmentType =
    kind === "DATA_DICTIONARY" ? AttachmentType.DATA_DICTIONARY : AttachmentType.EXAMPLE_DATA;

  const attachment = await storeAttachment(prisma, {
    ownerType: OWNER,
    ownerId: request.id,
    attachmentType,
    file: req.file,
    uploadedBy: session.sub,
  });

  await prisma.datasetRegistrationRequest.update({
    where: { id: request.id },
    data:
      kind === "DATA_DICTIONARY"
        ? { dataDictionaryAttachmentId: attachment.id, updatedBy: session.sub }
        : { exampleDataAttachmentId: attachment.id, updatedBy: session.sub },
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

datasetRequestRouter.get("/:id/attachments/:attachmentId", async (req, res) => {
  const session = req.session! as Session;
  const request = await prisma.datasetRegistrationRequest.findFirst({
    where: { id: req.params.id, ...visibilityFilter(session) },
    select: { id: true, requestNumber: true, organizationId: true },
  });
  if (!request) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  const attachment = await prisma.attachment.findFirst({
    where: { id: req.params.attachmentId, ownerType: OWNER, ownerId: request.id },
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

  // ค่าปกติเป็น inline เพราะหน้ารายละเอียดฝัง PDF ไว้ใน <iframe>
  // ปุ่ม "ดาวน์โหลด" ในรายการส่ง ?download=1 มาเพื่อให้เบราว์เซอร์บันทึกไฟล์แทนที่จะเปิดดู
  await streamAttachment(res, attachment, "download" in req.query ? "attachment" : "inline");
});

// ---------------------------------------------------------------- generate PDF

/** §4.3 ข้อ 4 — ต้องผ่าน validation ทั้งฉบับก่อน แล้วจึงสร้าง PDF ให้ตรวจ */
datasetRequestRouter.post("/:id/generate-form", async (req, res) => {
  const session = req.session! as Session;
  const request = await prisma.datasetRegistrationRequest.findUnique({
    where: { id: req.params.id },
    include: requestInclude,
  });
  if (!request || !mayEdit(session, request)) {
    res.status(404).json({ error: "not_found", message: "ไม่พบคำขอนี้" });
    return;
  }

  const shape = toApiShape(request);
  const parsed = datasetSubmitSchema.safeParse(shape);
  if (!parsed.success) {
    res.status(400).json({
      error: "validation",
      message: "ข้อมูลยังไม่ครบถ้วน กรุณาตรวจสอบอีกครั้ง",
      fields: formatZodError(parsed.error),
    });
    return;
  }

  const pdf = await renderDatasetRegistrationForm(await buildForm(request));
  const attachment = await storeAttachment(prisma, {
    ownerType: OWNER,
    ownerId: request.id,
    attachmentType: AttachmentType.GENERATED_FORM,
    file: {
      buffer: pdf,
      originalname: `แบบฟอร์มลงทะเบียนชุดข้อมูล-${request.requestNumber}.pdf`,
      mimetype: "application/pdf",
      size: pdf.length,
    },
    uploadedBy: session.sub,
  });

  res.status(201).json({ attachment: publicAttachment(attachment) });
});

async function buildForm(request: RequestRow) {
  const attachments = await activeAttachments(prisma, OWNER, request.id);
  const shape = toApiShape(request);

  // ผู้ลงนามและผู้อนุมัติ — มาจาก signature_confirmation และ review_task ที่ปิดแล้ว
  const signature = await prisma.signatureConfirmation.findFirst({
    where: { subjectType: SUBJECT, subjectId: request.id, confirmationType: "ORGANIZATION_APPROVAL" },
    orderBy: { confirmedAt: "desc" },
    include: { userAccount: { select: { displayName: true } } },
  });
  const finalApproval = await prisma.reviewTask.findFirst({
    where: {
      subjectType: SUBJECT,
      subjectId: request.id,
      taskType: ReviewTaskType.BDI_FINAL_APPROVAL,
      result: ReviewResult.APPROVED,
    },
    orderBy: { completedAt: "desc" },
    include: { assignedUser: { select: { displayName: true } } },
  });

  const legal = await prisma.legalAcceptance.findFirst({
    where: { subjectType: SUBJECT, subjectId: request.id },
    orderBy: { acceptedAt: "asc" },
  });

  return {
    ...shape,
    requestNumber: request.requestNumber,
    organization: { name: request.organization.nameTh },
    submittedAt: request.submittedAt,
    createdAt: request.createdAt,
    legalAcceptedAt: legal?.acceptedAt ?? null,
    orgApproverSignedName: signature?.userAccount.displayName ?? null,
    orgApproverSignedAt: signature?.confirmedAt ?? null,
    approvedByName: finalApproval?.assignedUser.displayName ?? null,
    approvedAt: request.approvedAt,
    attachments: attachments.map((a) => ({
      kind: a.attachmentType as string,
      filename: a.originalFileName,
    })),
  };
}

// ---------------------------------------------------------------- submit

datasetRequestRouter.post("/:id/submit", async (req, res) => {
  const session = req.session! as Session;
  const request = await prisma.datasetRegistrationRequest.findUnique({
    where: { id: req.params.id },
    include: requestInclude,
  });
  if (!request || !mayEdit(session, request)) {
    res.status(404).json({ error: "not_found", message: "ไม่พบคำขอนี้" });
    return;
  }
  if (request.status !== RequestStatus.DRAFT && request.status !== RequestStatus.RETURNED) {
    res.status(409).json({ error: "locked", message: "คำขอนี้นำส่งไปแล้ว" });
    return;
  }

  const parsed = datasetSubmitSchema.safeParse(toApiShape(request));
  if (!parsed.success) {
    res.status(400).json({ error: "validation", fields: formatZodError(parsed.error) });
    return;
  }

  const dictionary = await activeAttachment(prisma, OWNER, request.id, AttachmentType.DATA_DICTIONARY);
  if (!dictionary) {
    res.status(400).json({
      error: "validation",
      fields: { DATA_DICTIONARY: "กรุณาแนบพจนานุกรมข้อมูล (Data Dictionary)" },
    });
    return;
  }
  const form = await activeAttachment(prisma, OWNER, request.id, AttachmentType.GENERATED_FORM);
  if (!form) {
    res.status(400).json({ error: "no_form", message: "กรุณาสร้างและตรวจสอบ PDF ก่อนนำส่ง" });
    return;
  }

  const officer = await pickAssignee(ROLE_CODES.BDI_OFFICER, null);
  if (!officer) {
    res
      .status(503)
      .json({ error: "no_reviewer", message: "ยังไม่มีเจ้าหน้าที่ BDI ในระบบ กรุณาติดต่อผู้ดูแล" });
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.datasetRegistrationRequest.update({
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
    await syncStatus(tx, { ...request, submittedAt: new Date() });
  });

  const officers = await bdiOfficerIds();
  const info = {
    requestNumber: request.requestNumber,
    datasetName: datasetLabel(request),
    organizationName: request.organization.nameTh,
    submitter: await displayName(session.sub),
    id: request.id,
  };
  await notifyUsers(officers, {
    type: NotificationType.REQUEST_SUBMITTED,
    title: `มีคำขอลงทะเบียนชุดข้อมูลใหม่ ${request.requestNumber}`,
    message: `${info.organizationName} — ${info.datasetName}`,
    subjectType: SUBJECT,
    subjectId: request.id,
    organizationId: request.organizationId,
  });

  await logAudit({
    action: AuditAction.REQUEST_SUBMITTED,
    subjectType: AuditSubject.DATASET_REGISTRATION_REQUEST,
    subjectId: request.id,
    organizationId: request.organizationId,
    after: { requestNumber: request.requestNumber },
  });

  const fresh = await prisma.datasetRegistrationRequest.findUniqueOrThrow({
    where: { id: request.id },
    include: requestInclude,
  });
  res.json({ request: toApiShape(fresh) });
});

// ---------------------------------------------------------------- assign specialist

const assignSchema = z.object({ specialistId: z.string().uuid().nullable() });

/**
 * มอบหมาย/ถอนผู้เชี่ยวชาญ (§4.4 ข้อ 2 — ไม่บังคับ)
 *
 * ของเดิมเป็นคอลัมน์เดียวบนคำขอ แบบใหม่คือเปิด DATASET_SPECIALIST_REVIEW task
 * เพราะหนึ่งคำขอมี active task ได้ตัวเดียว การมอบหมายจึงต้องปิด task ของ officer ก่อน
 * และเมื่อผู้เชี่ยวชาญทำเสร็จ ระบบจะเปิด BDI_OFFICER_REVIEW รอบถัดไปคืนให้ officer
 */
datasetRequestRouter.post("/:id/assign", async (req, res, next) => {
  try {
    const session = req.session! as Session;
    if (!session.roles.includes(ROLE_CODES.BDI_OFFICER)) {
      res.status(403).json({ error: "forbidden", message: "เฉพาะเจ้าหน้าที่ BDI เท่านั้น" });
      return;
    }
    const parsed = assignSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "validation", fields: formatZodError(parsed.error) });
      return;
    }

    const request = await prisma.datasetRegistrationRequest.findUnique({
      where: { id: req.params.id },
      include: requestInclude,
    });
    if (!request) {
      res.status(404).json({ error: "not_found", message: "ไม่พบคำขอนี้" });
      return;
    }

    const current = await activeTask(prisma, SUBJECT, request.id);
    if (!current) {
      res.status(409).json({ error: "invalid_state", message: "คำขอนี้ไม่ได้อยู่ระหว่างการตรวจสอบ" });
      return;
    }

    const { specialistId } = parsed.data;

    await prisma.$transaction(async (tx) => {
      if (specialistId) {
        if (current.taskType !== ReviewTaskType.BDI_OFFICER_REVIEW) {
          throw new WorkflowError("invalid_state", "มอบหมายผู้เชี่ยวชาญได้เฉพาะช่วงที่ BDI ตรวจสอบ");
        }
        await cancelActiveTask(tx, {
          subjectType: SUBJECT,
          subjectId: request.id,
          actorId: session.sub,
          reason: "มอบหมายให้ผู้เชี่ยวชาญด้านข้อมูลพิจารณา",
        });
        await openTask(tx, {
          subjectType: SUBJECT,
          subjectId: request.id,
          taskType: ReviewTaskType.DATASET_SPECIALIST_REVIEW,
          assignedUserId: specialistId,
          assignedRole: ROLE_CODES.BDI_DATASET_SPECIALIST,
          assignedById: session.sub,
          assignmentSource: "MANUAL",
          actorId: session.sub,
        });
      } else {
        if (current.taskType !== ReviewTaskType.DATASET_SPECIALIST_REVIEW) {
          throw new WorkflowError("invalid_state", "ไม่มีผู้เชี่ยวชาญที่ได้รับมอบหมายอยู่");
        }
        await cancelActiveTask(tx, {
          subjectType: SUBJECT,
          subjectId: request.id,
          actorId: session.sub,
          reason: "ถอนการมอบหมายผู้เชี่ยวชาญ",
        });
        const officer = await pickAssignee(ROLE_CODES.BDI_OFFICER, null);
        await openTask(tx, {
          subjectType: SUBJECT,
          subjectId: request.id,
          taskType: ReviewTaskType.BDI_OFFICER_REVIEW,
          assignedUserId: officer ?? session.sub,
          assignedRole: ROLE_CODES.BDI_OFFICER,
          actorId: session.sub,
        });
      }
      await syncStatus(tx, request);
    });

    if (specialistId) {
      await notifyUsers([specialistId], {
        type: NotificationType.SPECIALIST_ASSIGNED,
        title: `คุณได้รับมอบหมายให้พิจารณา ${request.requestNumber}`,
        message: datasetLabel(request),
        subjectType: SUBJECT,
        subjectId: request.id,
        organizationId: request.organizationId,
      });
      const [specialistEmail] = await emailsOf([specialistId]);
      if (specialistEmail) {
        await sendDatasetSpecialistAssigned(specialistEmail, {
          requestNumber: request.requestNumber,
          datasetName: datasetLabel(request),
          organizationName: request.organization.nameTh,
          id: request.id,
        });
      }
    }

    const fresh = await prisma.datasetRegistrationRequest.findUniqueOrThrow({
      where: { id: request.id },
      include: requestInclude,
    });
    res.json({ request: toApiShape(fresh) });
  } catch (err) {
    if (err instanceof WorkflowError) {
      res.status(err.status).json({ error: err.code, message: err.message });
      return;
    }
    next(err);
  }
});

// ---------------------------------------------------------------- review

const reviewSchema = z.object({
  action: z.enum(["approve", "forward", "confirm", "comment", "request_revision", "reject"]),
  note: z.string().trim().optional(),
});

/**
 * จุดตัดสินใจเดียวของทุกด่าน — ตัดสินจาก active review_task ไม่ใช่จาก status
 * ผลที่ใช้ได้ต่อ task_type ถูกบังคับใน lib/workflow.ts ตามตารางในภาพของ sheet `review_task`
 */
datasetRequestRouter.post("/:id/review", async (req, res, next) => {
  try {
    const session = req.session! as Session;
    const parsed = reviewSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "validation", fields: formatZodError(parsed.error) });
      return;
    }
    const { action, note } = parsed.data;

    if ((action === "request_revision" || action === "reject") && (note?.length ?? 0) < 10) {
      res.status(400).json({
        error: "validation",
        fields: { note: "กรุณาระบุเหตุผลอย่างน้อย 10 ตัวอักษร" },
      });
      return;
    }

    const request = await prisma.datasetRegistrationRequest.findUnique({
      where: { id: req.params.id },
      include: requestInclude,
    });
    if (!request) {
      res.status(404).json({ error: "not_found", message: "ไม่พบคำขอนี้" });
      return;
    }

    const task = await activeTask(prisma, SUBJECT, request.id);
    if (!task) {
      res
        .status(409)
        .json({ error: "invalid_state", message: "สถานะปัจจุบันไม่รองรับการดำเนินการนี้" });
      return;
    }

    const allowedRoles: Record<ReviewTaskType, RoleCode[]> = {
      [ReviewTaskType.BDI_OFFICER_REVIEW]: [ROLE_CODES.BDI_OFFICER],
      [ReviewTaskType.DATASET_SPECIALIST_REVIEW]: [ROLE_CODES.BDI_DATASET_SPECIALIST],
      [ReviewTaskType.ORGANIZATION_APPROVAL]: [ROLE_CODES.ORGANIZATION_APPROVER],
      [ReviewTaskType.BDI_FINAL_APPROVAL]: [ROLE_CODES.BDI_FINAL_APPROVER],
      [ReviewTaskType.ORGANIZATION_REVISION]: [ROLE_CODES.ORGANIZATION_USER],
    };
    const isAssignee = task.assignedUserId === session.sub;
    if (!session.roles.some((r) => allowedRoles[task.taskType].includes(r)) && !isAssignee) {
      res.status(403).json({ error: "forbidden", message: "คุณไม่มีสิทธิ์ดำเนินการขั้นตอนนี้" });
      return;
    }

    // บันทึกความเห็นโดยไม่เปลี่ยนด่าน — ผู้เชี่ยวชาญเท่านั้น
    if (action === "comment") {
      if (task.taskType !== ReviewTaskType.DATASET_SPECIALIST_REVIEW) {
        res.status(409).json({ error: "invalid_state", message: "บันทึกความเห็นได้เฉพาะผู้เชี่ยวชาญ" });
        return;
      }
      if (!note) {
        res.status(400).json({ error: "validation", fields: { note: "กรุณากรอกความเห็น" } });
        return;
      }
      await prisma.$transaction(async (tx) => {
        await startTask(tx, task.id, session.sub);
        await recordComment(tx, { taskId: task.id, comment: note, actorId: session.sub });
        const officer = await pickAssignee(ROLE_CODES.BDI_OFFICER, null);
        await openTask(tx, {
          subjectType: SUBJECT,
          subjectId: request.id,
          taskType: ReviewTaskType.BDI_OFFICER_REVIEW,
          assignedUserId: officer ?? task.assignedUserId,
          assignedRole: ROLE_CODES.BDI_OFFICER,
          actorId: session.sub,
        });
        await syncStatus(tx, request);
      });
      const fresh = await prisma.datasetRegistrationRequest.findUniqueOrThrow({
        where: { id: request.id },
        include: requestInclude,
      });
      res.json({ request: toApiShape(fresh) });
      return;
    }

    const advance = action === "approve" || action === "forward" || action === "confirm";
    const result: ReviewResult =
      action === "reject"
        ? ReviewResult.REJECTED
        : action === "request_revision"
          ? ReviewResult.RETURNED
          : task.taskType === ReviewTaskType.ORGANIZATION_APPROVAL ||
              task.taskType === ReviewTaskType.BDI_FINAL_APPROVAL
            ? ReviewResult.APPROVED
            : ReviewResult.PASSED;

    await prisma.$transaction(async (tx) => {
      await startTask(tx, task.id, session.sub);
      await completeTask(tx, {
        taskId: task.id,
        result,
        comment: note ?? null,
        commentVisibility: CommentVisibility.ORGANIZATION,
        actorId: session.sub,
      });

      if (advance) {
        await nextStageAfter(tx, request, task.taskType, session.sub);
      }

      if (result === ReviewResult.REJECTED) {
        await tx.datasetRegistrationRequest.update({
          where: { id: request.id },
          data: { rejectedAt: new Date(), updatedBy: session.sub },
        });
      }

      await syncStatus(tx, request);
    });

    await logAudit({
      action:
        result === ReviewResult.REJECTED
          ? AuditAction.REQUEST_REJECTED
          : result === ReviewResult.RETURNED
            ? AuditAction.REQUEST_RETURNED
            : AuditAction.REQUEST_APPROVED,
      subjectType: AuditSubject.DATASET_REGISTRATION_REQUEST,
      subjectId: request.id,
      organizationId: request.organizationId,
      after: { taskType: task.taskType, result, note },
    });

    await dispatchDatasetNotifications(request, task.taskType, result, note, session.sub);

    const fresh = await prisma.datasetRegistrationRequest.findUniqueOrThrow({
      where: { id: request.id },
      include: requestInclude,
    });
    res.json({ request: toApiShape(fresh) });
  } catch (err) {
    if (err instanceof WorkflowError) {
      res.status(err.status).json({ error: err.code, message: err.message });
      return;
    }
    next(err);
  }
});

/**
 * ด่านถัดไปหลังปิด task หนึ่ง
 *
 * BDI_OFFICER_REVIEW มีสองความหมายในเส้นทางนี้ ("ตรวจเบื้องต้น" กับ "ตรวจซ้ำ")
 * แยกจากกันด้วยว่ามี ORGANIZATION_APPROVAL ที่ปิดแล้วหรือยัง ไม่ใช่ด้วย round_number
 * เพราะรอบเพิ่มขึ้นทุกครั้งที่ส่งกลับให้แก้ไขหรือมอบหมายผู้เชี่ยวชาญด้วย
 */
async function nextStageAfter(
  tx: Prisma.TransactionClient,
  request: RequestRow,
  completed: ReviewTaskType,
  actorId: string,
) {
  const orgApproved = await tx.reviewTask.count({
    where: {
      subjectType: SUBJECT,
      subjectId: request.id,
      taskType: ReviewTaskType.ORGANIZATION_APPROVAL,
      result: ReviewResult.APPROVED,
    },
  });

  const open = async (taskType: ReviewTaskType, roleCode: RoleCode, orgScope?: string | null) => {
    const assignee = await pickAssignee(roleCode, orgScope ?? null);
    if (!assignee) {
      throw new WorkflowError(
        "no_reviewer",
        `ยังไม่มีผู้รับผิดชอบขั้นตอน ${taskType} ในระบบ กรุณาติดต่อผู้ดูแล`,
        503,
      );
    }
    await openTask(tx, {
      subjectType: SUBJECT,
      subjectId: request.id,
      taskType,
      assignedUserId: assignee,
      assignedRole: roleCode,
      assignedById: actorId,
      actorId,
    });
  };

  switch (completed) {
    case ReviewTaskType.DATASET_SPECIALIST_REVIEW:
      // ผู้เชี่ยวชาญพิจารณาเสร็จ — คืนให้ officer ตัดสินใจ
      await open(ReviewTaskType.BDI_OFFICER_REVIEW, ROLE_CODES.BDI_OFFICER);
      return;

    case ReviewTaskType.BDI_OFFICER_REVIEW:
      if (orgApproved === 0) {
        await open(
          ReviewTaskType.ORGANIZATION_APPROVAL,
          ROLE_CODES.ORGANIZATION_APPROVER,
          request.organizationId,
        );
      } else {
        // §4.5 ข้อ 4 — ตรวจซ้ำผ่านแล้ว ส่งให้ผู้อนุมัติ BDI
        await open(ReviewTaskType.BDI_FINAL_APPROVAL, ROLE_CODES.BDI_FINAL_APPROVER);
      }
      return;

    case ReviewTaskType.ORGANIZATION_APPROVAL:
      await open(ReviewTaskType.BDI_OFFICER_REVIEW, ROLE_CODES.BDI_OFFICER);
      return;

    case ReviewTaskType.BDI_FINAL_APPROVAL:
      await materialiseDataset(tx, request, actorId);
      return;

    default:
      return;
  }
}

/**
 * "การ Copy ข้อมูลเมื่ออนุมัติ" — ภาพใน sheet `dataset_registration_request`
 *
 *   1. ปิด BDI Final Approval Task        (ทำไปแล้วที่ผู้เรียก)
 *   2. เปลี่ยน request.status = APPROVED  (syncStatus() ที่ผู้เรียก)
 *   3. สร้าง dataset
 *   4. Copy approved request metadata ไป dataset_metadata
 *   5. Copy หรือเชื่อม attachment ที่ได้รับอนุมัติ
 *   6. บันทึก dataset_id กลับใน registration request
 *   7. สร้าง integration operation สำหรับส่ง DII
 *   8. Commit
 */
async function materialiseDataset(
  tx: Prisma.TransactionClient,
  request: RequestRow,
  actorId: string,
) {
  await tx.datasetRegistrationRequest.update({
    where: { id: request.id },
    data: { approvedAt: new Date(), updatedBy: actorId },
  });

  const dataset = await tx.dataset.create({
    data: {
      datasetCode: await nextDatasetCode(tx),
      organizationId: request.organizationId,
      status: DatasetStatus.ACTIVE,
      // เชื่อม attachment เดิม ไม่ copy object ใหม่ (ทางเลือก A ในภาพของ sheet)
      dataDictionaryAttachmentId: request.dataDictionaryAttachmentId,
      exampleDataAttachmentId: request.exampleDataAttachmentId,
      sourceDatasetRegistrationRequestId: request.id,
      activatedAt: new Date(),
      activatedBy: actorId,
      createdBy: actorId,
      updatedBy: actorId,
    },
  });

  const m = request.metadata;
  if (m) {
    await tx.datasetMetadata.create({
      data: {
        datasetId: dataset.id,
        titleTh: m.titleTh,
        titleEn: m.titleEn,
        descriptionTh: m.descriptionTh,
        descriptionEn: m.descriptionEn,
        objective: m.objective,
        datasetCategoryCode: m.datasetCategoryCode,
        dataOwnerDepartment: m.dataOwnerDepartment,
        contactName: m.contactName,
        contactEmail: m.contactEmail,
        contactPhone: m.contactPhone,
        updateFrequency: m.updateFrequency,
        coverageStartDate: m.coverageStartDate,
        coverageEndDate: m.coverageEndDate,
        geographicScope: m.geographicScope,
        containsPersonalData: m.containsPersonalData,
        containsSensitiveData: m.containsSensitiveData,
        accessLevel: m.accessLevel,
        deliveryMethod: m.deliveryMethod,
        dataFormat: m.dataFormat,
        additionalMetadataJson: m.additionalMetadataJson ?? Prisma.DbNull,
        createdBy: actorId,
        updatedBy: actorId,
      },
    });
  }

  await tx.datasetRegistrationRequest.update({
    where: { id: request.id },
    data: { createdDatasetId: dataset.id, updatedBy: actorId },
  });

  // ขั้นที่ 7 — งานส่ง Dataset Reference ไปยัง DII รอ worker หยิบไปทำ
  // docs/01-user-journey.md §6 ระบุว่า DII ยังเป็น [Next Phase] จึงมีแค่แถวรอไว้
  await tx.integrationOperation.create({
    data: {
      integrationType: IntegrationType.DII,
      operation: "PUBLISH_DATASET_REFERENCE",
      subjectType: "DATASET",
      subjectId: dataset.id,
      organizationId: request.organizationId,
      idempotencyKey: `DII:PUBLISH_DATASET_REFERENCE:${dataset.id}`,
      correlationId: correlationId(),
    },
  });

  return dataset;
}

async function dispatchDatasetNotifications(
  request: RequestRow,
  taskType: ReviewTaskType,
  result: ReviewResult,
  note: string | undefined,
  actorId: string,
) {
  const members = await organizationMemberIds(request.organizationId);
  const actorName = await displayName(actorId);
  const info = {
    requestNumber: request.requestNumber,
    datasetName: datasetLabel(request),
    organizationName: request.organization.nameTh,
    id: request.id,
  };

  if (result === ReviewResult.RETURNED) {
    await notifyUsers([...members.users, request.createdBy], {
      type: NotificationType.REQUEST_RETURNED,
      title: `คำขอ ${request.requestNumber} ถูกส่งกลับให้แก้ไข`,
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
      title: `คำขอ ${request.requestNumber} ไม่ได้รับอนุมัติ`,
      message: note ?? "",
      subjectType: SUBJECT,
      subjectId: request.id,
      organizationId: request.organizationId,
    });
    return;
  }

  if (taskType === ReviewTaskType.BDI_OFFICER_REVIEW) {
    const orgApproved = await prisma.reviewTask.count({
      where: {
        subjectType: SUBJECT,
        subjectId: request.id,
        taskType: ReviewTaskType.ORGANIZATION_APPROVAL,
        result: ReviewResult.APPROVED,
      },
    });
    if (orgApproved === 0) {
      await notifyUsers(members.approvers, {
        type: NotificationType.REQUEST_SUBMITTED,
        title: `คำขอ ${request.requestNumber} รอคุณลงนาม`,
        message: info.datasetName,
        subjectType: SUBJECT,
        subjectId: request.id,
        organizationId: request.organizationId,
      });
    } else {
      await notifyUsers(await bdiApproverIds(), {
        type: NotificationType.REQUEST_SUBMITTED,
        title: `คำขอ ${request.requestNumber} รออนุมัติขั้นสุดท้าย`,
        message: info.datasetName,
        subjectType: SUBJECT,
        subjectId: request.id,
        organizationId: request.organizationId,
      });
    }
    return;
  }

  if (taskType === ReviewTaskType.BDI_FINAL_APPROVAL && result === ReviewResult.APPROVED) {
    await notifyUsers([...members.users, ...members.approvers, request.createdBy], {
      type: NotificationType.REQUEST_APPROVED,
      title: `คำขอ ${request.requestNumber} ได้รับอนุมัติแล้ว`,
      message: info.datasetName,
      subjectType: SUBJECT,
      subjectId: request.id,
      organizationId: request.organizationId,
    });
  }
}
