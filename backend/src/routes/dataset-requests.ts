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
  ConfirmationType,
  AcceptanceMethod,
  SubjectType,
  UserAccountStatus,
} from "@prisma/client";

import { prisma } from "../db.js";
import {
  activeAttachment,
  activeAttachments,
  activeRenderedDocument,
  publicAttachment,
  storeAttachment,
  streamAttachment,
  uploadedFile,
} from "../lib/attachment.js";
import { AuditAction, AuditSubject, logAudit } from "../lib/audit.js";
import { correlationId } from "../lib/context.js";
import {
  DATASET_ALLOWED_MIME,
  DATASET_MAX_UPLOAD_BYTES,
  EMPTY_METADATA,
  datasetDraftSchema,
  datasetSubmitSchema,
  fromMetadataRow,
  mergeMetadata,
  normaliseMetadata,
  toMetadataColumns,
} from "../lib/dataset.js";
import {
  sendDatasetApproved,
  sendDatasetRejected,
  sendDatasetRevisionRequested,
  sendDatasetSubmitted,
  sendDatasetPendingBdiApproval,
  sendDatasetPendingOrgApprover,
  sendDatasetPendingFinalCheck,
  sendDatasetSpecialistAssigned,
} from "../lib/mail.js";
import {
  NotificationType,
  announceProgress,
  bdiApproverIds,
  bdiOfficerIds,
  emailsOf,
  notifyUsers,
  organizationMemberIds,
} from "../lib/notify.js";
import {
  DATASET_FORM_CODE,
  datasetFormVersion,
  renderDatasetDocument,
  renderDatasetDocuments,
} from "../lib/dataset-document.js";
import { DocumentRenderError } from "../lib/document-render.js";
import { LEGAL_SCOPES, publishedDocuments } from "../lib/legal.js";
import { nextDatasetCode, nextDatasetRequestNumber } from "../lib/request-number.js";
import { buildJourneyProgress, summariseMany } from "../lib/journey-steps.js";
import { isBdiStaff, isSpecialistOnly } from "../lib/roles.js";
import {
  BDI_ORGANIZATION_ID,
  ROLE_CODES,
  SYSTEM_USER_ID,
  type RoleCode,
} from "../lib/system.js";
import { formatZodError, isUuid, parseRequestSnapshot } from "../lib/validation.js";
import {
  listOrderBy,
  myNodeKeys,
  parseFilterTokens,
  parsePaging,
  parseSort,
  journeySummary,
  nodeWhere,
} from "../lib/queue.js";
import {
  TASK_TYPE_ROLES,
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

/**
 * ขอบเขตที่ผู้ใช้แต่ละ role มองเห็น — ตาราง §4.7
 *
 * ผู้เชี่ยวชาญข้อมูลเห็น **เฉพาะคำขอที่ถูกมอบหมายให้ตนเอง** ไม่ใช่ทั้งระบบเหมือน BDI
 * role อื่น เดิม `isBdiStaff` เหมารวมเขาไปด้วย หน้าที่พาดหัวว่า "คำขอที่คุณได้รับมอบหมาย"
 * จึงแสดงคำขอของทุกหน่วยงาน และเปิดดูรายละเอียดใบไหนก็ได้
 *
 * review_task อ้างถึงคำขอแบบ logical (ไม่ใช่ relation ของ Prisma) จึงต้องอ่าน id
 * ที่เคยถูกมอบหมายออกมาก่อนแล้วค่อยกรอง — รวมงานที่ปิดไปแล้วด้วย เพื่อให้เขายังเปิดดู
 * สิ่งที่ตัวเองเคยตรวจได้หลังส่งคืนเจ้าหน้าที่
 */
async function visibilityFilter(
  session: Session,
): Promise<Prisma.DatasetRegistrationRequestWhereInput> {
  if (isSpecialistOnly(session.roles)) {
    const assigned = await prisma.reviewTask.findMany({
      where: {
        subjectType: SUBJECT,
        taskType: ReviewTaskType.DATASET_SPECIALIST_REVIEW,
        assignedUserId: session.sub,
      },
      select: { subjectId: true },
    });
    return { id: { in: [...new Set(assigned.map((t) => t.subjectId))] } };
  }
  if (isBdiStaff(session.roles)) return {};
  if (session.organizationId) return { organizationId: session.organizationId };
  return { createdBy: session.sub };
}

const datasetLabel = (r: RequestRow) =>
  r.metadata?.title?.trim() || r.proposedTitle?.trim() || `คำขอ ${r.requestNumber}`;

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

/**
 * เลือกผู้รับมอบหมายที่ว่างที่สุด — assigned_user_id เป็น NOT NULL ในดีไซน์
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

/**
 * เวลาที่ผู้ยื่นติ๊กยอมรับเงื่อนไขการนำส่งข้อมูล
 *
 * **ยังไม่ได้เก็บใน legal.legal_acceptance** ตารางนั้นบังคับทั้ง legal_document_version_id
 * และ review_task_id ซึ่งตอนกรอกร่างยังไม่มีทั้งคู่ (task เปิดตอนนำส่ง และเอกสารกฎหมาย
 * ที่ seed ไว้ยังเป็น DRAFT ไม่มีเนื้อหาจริง) จึงพักไว้ที่ additional_metadata_json ก่อน
 * ของเดิมไม่ได้เก็บที่ไหนเลย ช่องนี้ในแบบฟอร์ม PDF จึงพิมพ์ "—" ทั้งที่ผู้ใช้ติ๊กแล้ว
 */
const LEGAL_ACCEPTED_AT = "legalAcceptedAt";

function legalAcceptedAtOf(row: { additionalMetadataJson?: unknown } | null): string | null {
  const extra = row?.additionalMetadataJson;
  if (typeof extra !== "object" || extra === null) return null;
  const value = (extra as Record<string, unknown>)[LEGAL_ACCEPTED_AT];
  return typeof value === "string" ? value : null;
}

/** รูปข้อมูลที่ frontend และ zod ชุด submit ใช้ */
function toApiShape(request: RequestRow, extra?: Record<string, unknown>) {
  const metadata = fromMetadataRow(request.metadata);

  return {
    legalAcceptedAt: legalAcceptedAtOf(request.metadata),
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

/** ช่องที่การค้นหาไล่ดู */
const searchFilter = (search: string): Prisma.DatasetRegistrationRequestWhereInput => ({
  OR: [
    { requestNumber: { contains: search, mode: "insensitive" } },
    { proposedTitle: { contains: search, mode: "insensitive" } },
    { metadata: { title: { contains: search, mode: "insensitive" } } },
    { metadata: { name: { contains: search, mode: "insensitive" } } },
  ],
});

/**
 * เงื่อนไขพื้นฐานของทั้งหน้ารายการและตัวเลขสรุป — เห็นอะไรได้ + ค้นหาอะไรอยู่
 *
 * ทุกตัวกรองเป็น **หนึ่ง element ของ AND[]** เดิมการค้นหา assign ทับ `where.OR`
 * ซึ่งจะล้าง OR ที่ visibilityFilter() คืนมา — วันนี้ยังไม่ระเบิดเพราะ visibilityFilter
 * ไม่เคยคืน OR แต่ตัวกรองด่านที่เพิ่มเข้ามาเป็น OR อีกก้อน กติกาข้อเดียวนี้จึงเป็น
 * สิ่งที่ทำให้ตัวกรองสองตัวที่ต่างจำกัด `id` (ผู้เชี่ยวชาญที่กดแท็บ "ที่ต้องดำเนินการ")
 * ตัดกันถูกต้อง แทนที่จะเงียบ ๆ ทิ้งไปข้างหนึ่ง
 */
async function baseFilters(
  session: Session,
  q?: string,
): Promise<Prisma.DatasetRegistrationRequestWhereInput[]> {
  const and: Prisma.DatasetRegistrationRequestWhereInput[] = [await visibilityFilter(session)];
  if (q?.trim()) and.push(searchFilter(q.trim()));
  return and;
}

datasetRequestRouter.get("/", async (req, res) => {
  const session = req.session! as Session;
  const { status, stage, scope, sort, q } = req.query as {
    status?: string;
    stage?: string;
    scope?: string;
    sort?: string;
    q?: string;
  };

  const and = await baseFilters(session, q);

  /**
   * `stage` คือชื่อใหม่ `status` คือชื่อเดิม — รวมเป็นชุดเดียวกันแล้ว OR กัน ไม่ใช่ AND
   * ลิงก์เก่า `?status=SUBMITTED,UNDER_REVIEW` จึงยังทำงาน และคนที่มาจากลิงก์นั้นแล้ว
   * กดเม็ดกรองใหม่ก็ไม่ได้ผลลัพธ์ศูนย์แถวจากเงื่อนไขที่ขัดกันเอง
   */
  const tokens = [...parseFilterTokens(status), ...parseFilterTokens(stage)];
  const stageClause = await nodeWhere(prisma, SUBJECT, [...new Set(tokens)]);
  if (stageClause) and.push(stageClause);

  // แท็บ "ที่ต้องดำเนินการ" — ด่านที่ตำแหน่งของผู้เรียกเป็นคนทำ
  if (scope === "mine") {
    const mine = await nodeWhere(prisma, SUBJECT, myNodeKeys(SUBJECT, session.roles));
    // ไม่มีด่านเป็นของตัวเองเลย (เช่น ผู้ดูแลระบบ) = คิวว่าง ไม่ใช่ "ไม่กรอง"
    and.push(mine ?? { id: { in: [] } });
  }

  const where: Prisma.DatasetRegistrationRequestWhereInput = { AND: and };
  const paging = parsePaging(req.query);

  const [requests, total] = await prisma.$transaction([
    prisma.datasetRegistrationRequest.findMany({
      where,
      orderBy: listOrderBy(parseSort(sort)),
      skip: paging.skip,
      take: paging.take,
      include: requestInclude,
    }),
    prisma.datasetRegistrationRequest.count({ where }),
  ]);

  /**
   * ประวัติทั้งหมด ไม่ใช่เฉพาะแถวที่ยัง active — คอลัมน์ความคืบหน้าต้องรู้ว่าผ่านมาแล้วกี่ด่าน
   * และการแยก "ตรวจเบื้องต้น" กับ "ตรวจซ้ำ" อ่านไม่ได้จากแถวที่ค้างอยู่แถวเดียว
   *
   * คิวรีนี้กับอีกสองอันข้างล่างคีย์ด้วย id ของหน้าปัจจุบัน จึงเล็กลงตาม pageSize เอง
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
      assignedUserId: true,
    },
  });
  const activeTasks = tasks.filter(
    (t) => t.status === ReviewTaskStatus.PENDING || t.status === ReviewTaskStatus.IN_PROGRESS,
  );
  const stage_ = new Map(activeTasks.map((t) => [t.subjectId, t]));
  const progressBySubject = summariseMany({ subjectType: SUBJECT, requests, tasks });

  // ตารางเขียนว่า "· ผู้เชี่ยวชาญ <ชื่อ>" ต่อท้ายสถานะ จึงต้องมีชื่อ ไม่ใช่แค่ id
  const specialistIds = [
    ...new Set(
      activeTasks
        .filter((t) => t.taskType === ReviewTaskType.DATASET_SPECIALIST_REVIEW && t.assignedUserId)
        .map((t) => t.assignedUserId),
    ),
  ];
  const specialists = new Map(
    (
      await prisma.userAccount.findMany({
        where: { id: { in: specialistIds } },
        select: { id: true, email: true, firstnameTh: true, lastnameTh: true },
      })
    ).map((u) => [
      u.id,
      { id: u.id, email: u.email, firstName: u.firstnameTh, lastName: u.lastnameTh },
    ]),
  );

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
      currentTaskType: stage_.get(r.id)?.taskType ?? null,
      currentRound: stage_.get(r.id)?.roundNumber ?? null,
      progress: progressBySubject.get(r.id) ?? null,
      assignedSpecialist:
        stage_.get(r.id)?.taskType === ReviewTaskType.DATASET_SPECIALIST_REVIEW
          ? (specialists.get(stage_.get(r.id)!.assignedUserId) ?? null)
          : null,
      generatedForm: formByRequest.has(r.id)
        ? { id: formByRequest.get(r.id)!.id, filename: formByRequest.get(r.id)!.originalFileName }
        : null,
    })),
    page: {
      page: paging.page,
      pageSize: paging.pageSize,
      total,
      pageCount: Math.max(1, Math.ceil(total / paging.pageSize)),
    },
  });
});

/**
 * ตัวเลขของแถบสรุปและป้ายแท็บ
 *
 * แยก endpoint เพราะขอบเขตของมันคือขอบเขตที่ **ไม่เปลี่ยน** ตอนกดเม็ดกรอง เปลี่ยนหน้า
 * หรือสลับแท็บ — ถ้าคิดรวมมากับรายการ ตัวเลขบนแท็บจะขยับทุกครั้งที่กดอะไรในแท็บนั้น
 *
 * ต้องประกาศไว้ **เหนือ GET /:id** เหมือน /eligibility และ /specialists
 */
datasetRequestRouter.get("/summary", async (req, res) => {
  const session = req.session! as Session;
  const { q } = req.query as { q?: string };
  const where: Prisma.DatasetRegistrationRequestWhereInput = {
    AND: await baseFilters(session, q),
  };

  const counts = await journeySummary({
    db: prisma,
    subjectType: SUBJECT,
    roles: session.roles,
    countAll: () => prisma.datasetRegistrationRequest.count({ where }),
    groupByStatus: () =>
      prisma.datasetRegistrationRequest
        .groupBy({ by: ["status"], where, _count: { _all: true } })
        .then((rows) => rows.map((r) => ({ status: r.status, _count: r._count }))),
    inflightIds: () =>
      prisma.datasetRegistrationRequest
        .findMany({
          where: {
            AND: [where, { status: { in: [RequestStatus.SUBMITTED, RequestStatus.UNDER_REVIEW] } }],
          },
          select: { id: true },
        })
        .then((rows) => rows.map((r) => r.id)),
  });

  res.json(counts);
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

  const { columns, extra } = toMetadataColumns(mergeMetadata(EMPTY_METADATA, parsed.data));

  const created = await prisma.$transaction(async (tx) => {
    const request = await tx.datasetRegistrationRequest.create({
      data: {
        requestNumber: await nextDatasetRequestNumber(tx),
        organizationId: session.organizationId!,
        status: RequestStatus.DRAFT,
        proposedTitle: parsed.data.title ?? null,
        createdBy: session.sub,
        updatedBy: session.sub,
        metadata: {
          create: {
            ...columns,
            // ชีทเขียนว่า owner_org fixed เป็นหน่วยงานที่กรอกข้อมูล — คัดลอกมา ไม่ให้ผู้ใช้เลือก
            ownerOrgId: session.organizationId!,
            additionalMetadataJson: extra as Prisma.InputJsonValue,
            createdBy: session.sub,
            updatedBy: session.sub,
          },
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
    // AND ไม่ใช่ spread — ตัวกรองของผู้เชี่ยวชาญเป็น `id: { in: [...] }` ซึ่งถ้ากระจายเข้าไป
    // จะไปทับ `id` ของ path param แล้วคืนคำขอใบอื่นที่เขามีสิทธิ์เห็นแทนใบที่ขอมา
    where: { AND: [{ id: req.params.id }, await visibilityFilter(session)] },
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

  /**
   * เหตุผลที่ผู้ตรวจส่งกลับ — หน้าฟอร์มมีกล่องแดง "สิ่งที่ต้องแก้ไขตามที่ผู้ตรวจสอบระบุ"
   * รออ่านช่องนี้อยู่ แต่ไม่มี route ไหนเคยส่งมันออกไป กล่องนั้นจึงไม่เคยขึ้นเลย
   * ผู้ใช้ที่ถูกส่งกลับมาแก้จึงไม่เห็นว่าให้แก้อะไร ต้องไปอ่านเอาเองจากไทม์ไลน์
   * ความเห็นที่ตั้งเป็น BDI_INTERNAL ยังถูกซ่อนจากฝั่งหน่วยงานเหมือนในไทม์ไลน์
   */
  const lastReturned = [...tasks].reverse().find((t) => t.result === ReviewResult.RETURNED);
  const revisionNote =
    request.status === RequestStatus.RETURNED &&
    lastReturned &&
    !(isOrgSide && lastReturned.commentVisibility === CommentVisibility.BDI_INTERNAL)
      ? lastReturned.resultComment
      : null;

  /**
   * ใครเป็นคนอนุมัติ/ไม่อนุมัติ และไม่อนุมัติเพราะอะไร
   *
   * การ์ดสีเขียวและสีแดงบนหัวหน้ารายละเอียดอ่านสามช่องนี้ แต่ไม่มีใครส่งมาให้
   * ("โดย —" และกล่องเหตุผลที่ว่างเปล่า) — ทั้งสามค่าอยู่ในไทม์ไลน์ที่โหลดมาแล้ว
   */
  const decided = [...tasks]
    .reverse()
    .find((t) => t.result === ReviewResult.APPROVED || t.result === ReviewResult.REJECTED);
  const approvedByName =
    decided?.result === ReviewResult.APPROVED ? (decided.assignedUser?.displayName ?? null) : null;
  const rejectedByName =
    decided?.result === ReviewResult.REJECTED ? (decided.assignedUser?.displayName ?? null) : null;
  const rejectionReason =
    decided?.result === ReviewResult.REJECTED ? (decided.resultComment ?? null) : null;

  res.json({
    request: toApiShape(request, {
      revisionNote,
      approvedByName,
      rejectedByName,
      rejectionReason,
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
      // เส้นทางทั้งเส้น ไม่ใช่แค่ด่านที่ค้างอยู่ — ดู lib/journey-steps.ts
      progress: buildJourneyProgress({
        subjectType: SUBJECT,
        status: request.status,
        tasks,
        active,
      }),
      /**
       * คืนเป็น **ก้อน** ไม่ใช่แค่ id — ทุกหน้าจออ่าน `assignedSpecialist.…`
       * (การ์ด "ผู้เชี่ยวชาญที่ได้รับมอบหมาย" ป้ายปุ่มมอบหมาย/เปลี่ยน และค่าตั้งต้น
       * ใน modal) เดิมส่งไปแต่ `assignedSpecialistId` ทุกที่จึงเป็น undefined เงียบ ๆ
       */
      assignedSpecialist:
        active?.taskType === ReviewTaskType.DATASET_SPECIALIST_REVIEW && active.assignedUser
          ? {
              id: active.assignedUser.id,
              email: active.assignedUser.email,
              firstName: active.assignedUser.firstnameTh,
              lastName: active.assignedUser.lastnameTh,
            }
          : null,
      // การ์ดเดียวกันมีบรรทัด "มอบหมายเมื่อ" — เวลาที่มอบหมายคือเวลาที่เปิด task ของด่านนั้น
      assignedAt:
        active?.taskType === ReviewTaskType.DATASET_SPECIALIST_REVIEW ? active.assignedAt : null,
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

  // รวมกับค่าที่บันทึกไว้เดิมก่อนเสมอ กฎในชีท conditions ตัดสินจากคำตอบทั้งใบ
  // ไม่ใช่เฉพาะช่องที่เพิ่งแก้ (เปลี่ยนหมวดหมู่ข้อมูลอย่างเดียวก็เปลี่ยนค่าอีกหกช่องได้)
  const values = mergeMetadata(fromMetadataRow(request.metadata), parsed.data);
  const { columns, extra } = toMetadataColumns(values, request.metadata?.additionalMetadataJson);
  if (parsed.data.legalAccepted !== undefined) {
    extra[LEGAL_ACCEPTED_AT] = parsed.data.legalAccepted
      ? (legalAcceptedAtOf(request.metadata) ?? new Date().toISOString())
      : null;
  }

  const updated = await prisma.$transaction(async (tx) => {
    await tx.datasetRegistrationMetadata.upsert({
      where: { datasetRegistrationRequestId: request.id },
      update: { ...columns, additionalMetadataJson: extra as Prisma.InputJsonValue, updatedBy: session.sub },
      create: {
        datasetRegistrationRequestId: request.id,
        ...columns,
        ownerOrgId: request.organizationId,
        additionalMetadataJson: extra as Prisma.InputJsonValue,
        createdBy: session.sub,
        updatedBy: session.sub,
      },
    });
    return tx.datasetRegistrationRequest.update({
      where: { id: request.id },
      data: {
        proposedTitle: values.title ?? request.proposedTitle,
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
    file: uploadedFile(req.file),
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
    // AND ไม่ใช่ spread — ตัวกรองของผู้เชี่ยวชาญเป็น `id: { in: [...] }` ซึ่งถ้ากระจายเข้าไป
    // จะไปทับ `id` ของ path param แล้วคืนคำขอใบอื่นที่เขามีสิทธิ์เห็นแทนใบที่ขอมา
    where: { AND: [{ id: req.params.id }, await visibilityFilter(session)] },
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
  const parsed = parseRequestSnapshot(datasetSubmitSchema, shape);
  if (!parsed.success) {
    res.status(400).json({
      error: "validation",
      message: "ข้อมูลยังไม่ครบถ้วน กรุณาตรวจสอบอีกครั้ง",
      fields: formatZodError(parsed.error),
    });
    return;
  }
  // เอกสารที่หน่วยงานลงนามต้องมีการยืนยันของผู้ยื่นกำกับ ไม่ใช่ช่องติ๊กที่หน้าเว็บบังคับฝ่ายเดียว
  if (!legalAcceptedAtOf(request.metadata)) {
    res.status(400).json({
      error: "validation",
      fields: { legalAcceptedAt: "กรุณายืนยันความถูกต้องของข้อมูลก่อนสร้างแบบฟอร์ม" },
    });
    return;
  }

  /**
   * เอกสารที่สร้างคือ A4 (แบบนำส่งข้อมูล) ฉบับจริงจาก template ของฝ่ายกฎหมาย
   *
   * ก่อนหน้านี้ตรงนี้เรียก renderDatasetRegistrationForm() ซึ่งวางเลย์เอาต์ขึ้นมาเองด้วย
   * PDFKit เพราะตอนนั้นยังไม่ได้เอา template เข้าระบบ — เหมือนที่เส้นทาง B เคยวาด
   * "แบบฟอร์มขอสร้างหน่วยงานในระบบ" ขึ้นมาเอง ตอนนี้เอกสารที่หน่วยงานลงนามคือฉบับจริง
   * ซึ่งมีช่องติ๊กตามตัวเลือกที่ผู้กรอกเลือกไว้
   */
  const rendered = await renderDatasetDocuments(prisma, {
    request: datasetDocumentRequestOf(request),
    printedByName: await submitterNameOf(request),
    actorId: session.sub,
  });
  if (rendered.length === 0) {
    res.status(503).json({
      error: "no_legal_documents",
      message: "ยังไม่มีแบบนำส่งข้อมูลที่เผยแพร่ในระบบ กรุณาแจ้งผู้ดูแลระบบ",
    });
    return;
  }

  const attachment = await activeAttachment(prisma, OWNER, request.id, AttachmentType.GENERATED_FORM);
  res.status(201).json({
    attachment: attachment ? publicAttachment(attachment) : null,
    documents: rendered,
  });
});

/** ข้อมูลของคำขอในรูปที่ตัวสร้างเอกสารรับ */
function datasetDocumentRequestOf(request: RequestRow) {
  const metadata = fromMetadataRow(request.metadata);
  return {
    ...metadata,
    id: request.id,
    requestNumber: request.requestNumber,
    organizationName: request.organization.nameTh,
    submittedAt: request.submittedAt,
    approvedAt: request.approvedAt,
  };
}

/** ชื่อผู้ยื่นคำขอ ณ เวลาที่สร้างเอกสาร — ไปอยู่บรรทัด "พิมพ์จากระบบโดย" ถ้า template มีช่องนั้น */
async function submitterNameOf(request: RequestRow): Promise<string | null> {
  const account = await prisma.userAccount.findUnique({
    where: { id: request.createdBy },
    select: { displayName: true, prefixTh: true, firstnameTh: true, lastnameTh: true },
  });
  if (!account) return null;
  const full = [account.prefixTh, account.firstnameTh, account.lastnameTh].filter(Boolean).join(" ").trim();
  return full || account.displayName;
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

  const parsed = parseRequestSnapshot(datasetSubmitSchema, toApiShape(request));
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

  const officer = await pickAssignee(ROLE_CODES.BDI_OFFICER, BDI_ORGANIZATION_ID);
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
        const officer = await pickAssignee(ROLE_CODES.BDI_OFFICER, BDI_ORGANIZATION_ID);
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

// ------------------------------------------------------- เอกสารของคำขอ

/**
 * เอกสารทั้งชุดที่ผู้อนุมัติต้องอ่าน — โครงเดียวกับเส้นทาง B
 *
 * เส้นทางนี้มีเอกสารฉบับเดียว (A4 แบบนำส่งข้อมูล) และมี placeholder จึงถูก render
 * ด้วยข้อมูลของคำขอนี้เสมอ ฉบับที่ไม่มี placeholder จะใช้ไฟล์กลางของเวอร์ชัน
 * (ยังไม่มีในเส้นทางนี้ แต่รองรับไว้ เพราะเอกสารฉบับใหม่เพิ่มได้โดยไม่ต้องแก้โค้ด)
 */
datasetRequestRouter.get("/:id/legal-documents", async (req, res) => {
  const session = req.session! as Session;
  const request = await prisma.datasetRegistrationRequest.findFirst({
    where: { AND: [{ id: req.params.id }, await visibilityFilter(session)] },
    include: requestInclude,
  });
  if (!request) {
    res.status(404).json({ error: "not_found", message: "ไม่พบคำขอนี้" });
    return;
  }

  const documents = await publishedDocuments(prisma, LEGAL_SCOPES.DATASET_REGISTRATION);
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

  const out = [];
  for (const doc of documents) {
    if (!doc.hasPlaceholders) {
      out.push({
        code: doc.code,
        name: doc.nameTh,
        versionId: doc.versionId,
        versionNumber: doc.versionNumber,
        fromRequest: false,
        fileUrl: `/api/dataset-requests/${request.id}/legal-documents/${doc.versionId}/file`,
        acceptedAt: acceptedAt.get(doc.versionId) ?? null,
      });
      continue;
    }

    /**
     * สร้างใหม่ให้เองถ้าไฟล์ที่มีเก่ากว่า template ที่เผยแพร่อยู่ (หรือยังไม่มีไฟล์)
     * คำขอที่ยังไม่ได้นำส่งไม่สร้างให้ — ผู้กรอกเป็นคนกดสร้างเองที่หน้าตรวจสอบก่อนนำส่ง
     */
    let rendered = await activeRenderedDocument(prisma, OWNER, request.id, doc.versionId);
    const published = publishedAt.get(doc.versionId) ?? null;
    const stale =
      request.submittedAt !== null &&
      (!rendered || (published !== null && rendered.uploadedAt < published));

    if (stale) {
      const result = await renderDatasetDocument(prisma, {
        request: datasetDocumentRequestOf(request),
        document: { code: doc.code, nameTh: doc.nameTh, versionId: doc.versionId },
        printedByName: await submitterNameOf(request),
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
        ? `/api/dataset-requests/${request.id}/legal-documents/${doc.versionId}/file`
        : null,
      acceptedAt: acceptedAt.get(doc.versionId) ?? null,
    });
  }

  res.json({ documents: out });
});

/** ไฟล์ PDF ของเอกสารฉบับหนึ่ง — ฉบับที่ render ให้คำขอนี้มาก่อนไฟล์กลางเสมอ */
datasetRequestRouter.get("/:id/legal-documents/:versionId/file", async (req, res) => {
  const session = req.session! as Session;
  const request = await prisma.datasetRegistrationRequest.findFirst({
    where: { AND: [{ id: req.params.id }, await visibilityFilter(session)] },
    include: requestInclude,
  });
  if (!request) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const versionId = req.params.versionId;
  if (!isUuid(versionId)) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  let file = await activeRenderedDocument(prisma, OWNER, request.id, versionId);
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

// ---------------------------------------------------------------- review

/**
 * การลงนามอิเล็กทรอนิกส์ที่แนบมากับการอนุมัติ — โครงเดียวกับเส้นทาง B
 *
 * เส้นทางนี้มีเอกสารฉบับเดียว (A4) จึงไม่มีการเดินอ่านทีละฉบับ แต่ยังต้องติ๊กยืนยันว่า
 * อ่านครบก่อนกดยืนยัน (ตัดสินไว้ 2026-08-20) และยังบันทึกว่ายอมรับ **เวอร์ชันไหน**
 */
const signatureSchema = z.object({
  acknowledgements: z
    .array(z.object({ versionId: z.string(), attestedAt: z.string().datetime() }))
    .min(1),
  attestationText: z.string().trim().min(1).max(500).optional(),
  confirmationText: z.string().trim().min(1).max(2000),
});

const reviewSchema = z.object({
  action: z.enum(["approve", "forward", "confirm", "comment", "request_revision", "reject"]),
  note: z.string().trim().optional(),
  signature: signatureSchema.optional(),
});

/**
 * ด่านที่การอนุมัติคือการลงนามบนเอกสาร
 *
 * ด่านผู้เชี่ยวชาญข้อมูลและด่านตรวจซ้ำของเจ้าหน้าที่ BDI ไม่อยู่ในนี้โดยตั้งใจ —
 * ทั้งสองอ่านเอกสารได้แต่ไม่ลงนาม ตามที่การ์ดกำหนด (ตัดสินไว้ 2026-08-20)
 */
const SIGNING_TASKS: Partial<Record<ReviewTaskType, ConfirmationType>> = {
  [ReviewTaskType.ORGANIZATION_APPROVAL]: ConfirmationType.ORGANIZATION_APPROVAL,
  [ReviewTaskType.BDI_FINAL_APPROVAL]: ConfirmationType.BDI_FINAL_APPROVAL,
};

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
    const { action, note, signature } = parsed.data;

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

    // ตารางเดียวกับที่ lib/queue.ts ใช้ตอบว่า "ใบไหนเป็นงานของตำแหน่งฉัน" — เดิมเขียนซ้ำไว้ตรงนี้
    // ถ้าสองที่ไม่ตรงกัน หน้ารายการจะโชว์ใบที่กดต่อไม่ได้ หรือซ่อนใบที่กดได้
    const allowedRoles = TASK_TYPE_ROLES;
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
        const officer = await pickAssignee(ROLE_CODES.BDI_OFFICER, BDI_ORGANIZATION_ID);
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

    /**
     * สองด่านสุดท้ายอนุมัติด้วยการลงนามบนเอกสาร ไม่ใช่กดปุ่มผ่านเฉย ๆ
     *
     * ตรวจให้จบก่อนเปิด transaction: ถ้าเอกสารที่ผู้ใช้ยืนยันไม่ตรงกับเวอร์ชันที่เผยแพร่อยู่
     * ต้องให้โหลดหน้าใหม่ ไม่ใช่ปิด task ไปแล้วค่อยพบว่าหลักฐานไม่ครบ
     */
    const confirmationType = SIGNING_TASKS[task.taskType];
    let signedVersionIds: string[] = [];

    if (confirmationType && result === ReviewResult.APPROVED) {
      if (!signature) {
        res.status(400).json({
          error: "signature_required",
          message: "ขั้นตอนนี้ต้องยืนยันแบบนำส่งข้อมูล กรุณาอ่านเอกสารแล้วกดยืนยัน",
        });
        return;
      }
      const published = await publishedDocuments(prisma, LEGAL_SCOPES.DATASET_REGISTRATION);
      if (published.length === 0) {
        res.status(503).json({
          error: "no_legal_documents",
          message: "ยังไม่มีแบบนำส่งข้อมูลที่เผยแพร่ในระบบ กรุณาแจ้งผู้ดูแลระบบ",
        });
        return;
      }
      const acknowledged = new Set(signature.acknowledgements.map((a) => a.versionId));
      const missing = published.filter((doc) => !acknowledged.has(doc.versionId));
      if (missing.length > 0) {
        res.status(400).json({
          error: "documents_not_acknowledged",
          message:
            `ยังมีเอกสารที่ยังไม่ได้ยืนยัน: ${missing.map((d) => d.code).join(" ")} — ` +
            "เอกสารอาจถูกปรับปรุงเป็นฉบับใหม่ระหว่างที่เปิดหน้านี้อยู่ กรุณาโหลดหน้าใหม่แล้วอ่านอีกครั้ง",
        });
        return;
      }
      signedVersionIds = published.map((doc) => doc.versionId);
    }

    await prisma.$transaction(async (tx) => {
      await startTask(tx, task.id, session.sub);
      await completeTask(tx, {
        taskId: task.id,
        result,
        comment: note ?? null,
        commentVisibility: CommentVisibility.ORGANIZATION,
        actorId: session.sub,
      });

      /**
       * หลักฐานการลงนาม เขียนใน transaction เดียวกับการปิด task
       *
       * legal_acceptance เขียนเฉพาะฝ่ายหน่วยงาน: ตารางนี้คือ "ใครยอมรับเอกสารฉบับใด"
       * ซึ่งคือหน่วยงานผู้นำส่งข้อมูล การอนุมัติของ BDI เป็นการเห็นชอบของสำนักงาน
       */
      if (confirmationType && signature && result === ReviewResult.APPROVED) {
        const account = await tx.userAccount.findUnique({
          where: { id: session.sub },
          select: { displayName: true, prefixTh: true, firstnameTh: true, lastnameTh: true },
        });
        const signedFirst = account?.firstnameTh ?? null;
        const signedLast = account?.lastnameTh ?? null;
        const signedName =
          [account?.prefixTh, signedFirst, signedLast].filter(Boolean).join(" ").trim() ||
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
              acceptanceMethod: AcceptanceMethod.CHECKBOX,
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

    /**
     * ลงนามหรืออนุมัติแล้ว — สร้างเอกสารทับด้วยฉบับที่มีลายมือชื่อและวันที่อนุมัติ
     *
     * เดิมสร้างใหม่เฉพาะตอนอนุมัติขั้นสุดท้าย ทำให้ฉบับที่ผู้อนุมัติ BDI เปิดอ่านยังเป็นฉบับ
     * ก่อนหน่วยงานลงนาม ตอนนี้สร้างทุกครั้งที่มีการลงนามเพิ่ม ฉบับเดิมกลายเป็น REPLACED
     * ตามกลไกของ storeAttachment (ประวัติยังตรวจย้อนได้)
     *
     * ทำนอก transaction โดยตั้งใจ: การเรนเดอร์ต้องคุยกับ LibreOffice และเขียนลง object
     * storage ซึ่งใช้เวลาเป็นวินาที (transaction timeout ปกติของ Prisma คือ 5 วินาที)
     * ถ้าขั้นนี้ล้ม การลงนามที่บันทึกไปแล้วต้องไม่ถูกย้อน — หลักฐานอยู่ใน
     * signature_confirmation แล้ว และเอกสารสร้างซ้ำได้จากหลักฐานนั้นเสมอ
     */
    let documentRendered = true;
    if (confirmationType && result === ReviewResult.APPROVED) {
      try {
        await renderDatasetDocuments(prisma, {
          request: datasetDocumentRequestOf(fresh),
          printedByName: await submitterNameOf(fresh),
          actorId: session.sub,
        });
      } catch (err) {
        documentRendered = false;
        console.error("[dataset] สร้างแบบนำส่งข้อมูลฉบับลงนามไม่สำเร็จ", err);
      }
    }

    res.json({ request: toApiShape(fresh), documentRendered });
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
    // ไม่ระบุ orgScope = ด่านฝั่ง BDI ซึ่งอยู่ในหน่วยงาน BDI
    const assignee = await pickAssignee(roleCode, orgScope ?? BDI_ORGANIZATION_ID);
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
    // สองตารางมีคอลัมน์ชุดเดียวกันทั้งหมด ต่างแค่ FK ที่ผูก — คัดลอกทั้งแถวโดยตัดคอลัมน์
    // ที่เป็นของแถวเดิมออก ถ้าไล่เขียนทีละช่อง คอลัมน์ที่เพิ่มทีหลังจะเงียบหายตอนอนุมัติ
    const { id, datasetRegistrationRequestId, createdAt, createdBy, updatedAt, updatedBy, ...copied } = m;
    await tx.datasetMetadata.create({
      data: {
        ...copied,
        datasetId: dataset.id,
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
    subjectLabel: `${info.datasetName} — ${request.requestNumber}`,
  });

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

  /**
   * หน่วยงานลงนามแล้ว → ด่านตรวจซ้ำเปิดขึ้น แต่ไม่มีใครบอกเจ้าหน้าที่ BDI
   *
   * `docs/01-user-journey.md` §4.5 ข้อ 3 กับอีเมลฉบับที่ 12 ในตาราง §4.8 กำหนดไว้ว่า
   * ต้องแจ้ง BDI Officer ทุกคน และ `sendDatasetPendingFinalCheck()` ก็เขียนรออยู่ตั้งแต่ต้น
   * แต่ dispatcher ไม่เคยมีสาขาของ ORGANIZATION_APPROVAL เลย งานที่ค้างอยู่จึงเงียบสนิท
   * จนกว่าจะมีคนเปิดตารางไปเจอเอง
   */
  if (taskType === ReviewTaskType.ORGANIZATION_APPROVAL && result === ReviewResult.APPROVED) {
    const officers = await bdiOfficerIds();
    await notifyUsers(officers, {
      type: NotificationType.REQUEST_SUBMITTED,
      title: `คำขอ ${request.requestNumber} รอตรวจสอบขั้นสุดท้าย`,
      message: info.datasetName,
      subjectType: SUBJECT,
      subjectId: request.id,
      organizationId: request.organizationId,
      // อีเมลของด่านนี้ต้องบอกชื่อผู้ลงนาม ซึ่ง template กลางของ worker ไม่รู้จัก
      email: false,
    });
    const emails = await emailsOf(officers);
    if (emails.length > 0) {
      await sendDatasetPendingFinalCheck(emails, { ...info, signedBy: actorName }, progress);
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
