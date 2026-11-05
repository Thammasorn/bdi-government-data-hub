/**
 * คำขอเปลี่ยนแปลงผู้แทนหน่วยงาน — state machine ทั้งหมดของ workflow นี้อยู่ไฟล์เดียว เหมือนสอง journey เดิม
 *
 * หน่วยงานที่ ACTIVE แล้วยื่นคำขอยกเลิกผู้แทนเดิมและ/หรือเพิ่มผู้แทนใหม่ BDI Officer ตรวจด่านเดียว
 * (`BDI_OFFICER_REVIEW`) แล้วระบบถอนคนเดิมและส่งคำเชิญคนใหม่ให้เอง
 *
 *   DRAFT → SUBMITTED → UNDER_REVIEW → RETURNED (แก้แล้วนำส่งใหม่) · REJECTED
 *                                    → CONFIRMED → PROCESSING → COMPLETED · PROCESSING_FAILED
 *   DRAFT / RETURNED → CANCELLED
 *
 * **จำนวนผู้แทนตรวจครั้งเดียว ตอน BDI กดผ่านการตรวจสอบ** ในทรานแซกชันเดียวกับการดำเนินการ ฝั่งหน่วยงานนำส่งได้
 * แม้จำนวนเกินหรือขาด เพราะคำตอบเปลี่ยนได้ระหว่างรอ ด้วยเหตุเดียวกัน หน่วยงานจึงมีคำขอค้างได้หลายใบ:
 * การล็อกแถวหน่วยงานตอนยืนยันทำให้ทีละใบนับจากข้อมูลจริงเสมอ
 *
 * **ฟอร์มไม่ค้นบัญชีจากเลขบัตร** ผู้กรอกจึงรู้ไม่ได้ว่าคนอื่นมีบัญชีหรือถูกระงับหรือไม่ สถานะบัญชีเห็นเฉพาะฝั่ง BDI
 * (`evaluateChangeRequest()` ใน lib/representative-change.ts) หน่วยงานเห็นเพียงเหตุผลที่ BDI เขียนตอนส่งกลับ
 */
import {
  AccountType,
  AttachmentOwnerType,
  AttachmentStatus,
  AttachmentType,
  CommentVisibility,
  OrganizationStatus,
  Prisma,
  RepresentativeAdditionStatus,
  RepresentativeChangeStatus,
  RepresentativeRemovalStatus,
  ReviewResult,
  SessionRevokeReason,
  SubjectType,
  UserAccountStatus,
} from "@prisma/client";
import type { Request, Response } from "express";
import multer from "multer";
import { z } from "zod";

import { prisma } from "../db.js";
import { Router } from "../lib/async-route.js";
import { publicAttachment, storeAttachment, streamAttachment, uploadedFile } from "../lib/attachment.js";
import { AuditAction, AuditSubject, logAudit } from "../lib/audit.js";
import { adminActorId } from "../lib/context.js";
import {
  issueActivationKey,
  logKeysRevoked,
  revokeIssuedKeys,
  revokeRoleAssignments,
  roleIdByCode,
  type RevokedKey,
} from "../lib/iam.js";
import { sendInvitationEmail } from "../lib/mail.js";
import { NotificationType, bdiOfficerIds, notifyUsers, organizationMemberIds } from "../lib/notify.js";
import {
  frozenOrganizationMessage,
  isOrganizationFrozen,
  ORGANIZATION_FROZEN,
  refuseIfOrganizationFrozen,
} from "../lib/organization-freeze.js";
import { fullNameTh } from "../lib/person-name.js";
import {
  changeRequestSummary,
  evaluateChangeRequest,
  listRepresentatives,
  loadChangeRequest,
  maskCid,
  REPRESENTATIVE_ROLES,
  removalTarget,
  representativeSummary,
  statusesOfNode,
  statusesOfRoles,
  computeHeadcount,
  type ChangeRequestRow,
} from "../lib/representative-change.js";
import { nextRepresentativeChangeNumber } from "../lib/request-number.js";
import { ROLE_LABELS } from "../lib/roles.js";
import { revokeSessionsFor } from "../lib/session.js";
import { BDI_ORGANIZATION_ID, ROLE_CODES, type RoleCode } from "../lib/system.js";
import {
  emailSchema,
  formatZodError,
  nationalIdSchema,
  phoneExtensionSchema,
  phoneSchema,
} from "../lib/validation.js";
import {
  activeTask,
  cancelActiveTask,
  completeTask,
  openTask,
  startTask,
  taskHistory,
  taskPerson,
  WorkflowError,
} from "../lib/workflow.js";
import { requireAdmin, requireAuth } from "../middleware/auth.js";

export const representativeChangeRouter = Router();
representativeChangeRouter.use(requireAuth);

/** "ทุกอย่างที่ BDI Officer ทำได้" ของผู้ดูแลระบบ — ตรรกะเดียวกัน ต่างแค่ผู้กระทำและการตรวจสิทธิ์ */
export const adminRepresentativeChangeRouter = Router();
adminRepresentativeChangeRouter.use(requireAdmin);

const SUBJECT = SubjectType.REPRESENTATIVE_CHANGE_REQUEST;
const OWNER = AttachmentOwnerType.REPRESENTATIVE_CHANGE_REQUEST;
const LETTER = AttachmentType.REPRESENTATIVE_CHANGE_REQUEST_LETTER;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** คำขอค้างที่ PROCESSING นานเกินนี้ถือว่ากระบวนการหลุดกลางทาง สั่งลองใหม่ได้ */
const STUCK_PROCESSING_MS = 2 * 60_000;

/** ตรวจชนิดไฟล์ใน handler ไม่ใช่ fileFilter — เหตุผลเดียวกับ routes/organizations.ts */
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES } });

type Session = NonNullable<Request["session"]>;

const seesAllOrganizations = (session: Session) =>
  session.roles.some((role) =>
    ([ROLE_CODES.BDI_OFFICER, ROLE_CODES.BDI_FINAL_APPROVER, ROLE_CODES.SYSTEM_ADMINISTRATOR] as RoleCode[]).includes(role),
  );
const isOfficer = (session: Session) => session.roles.includes(ROLE_CODES.BDI_OFFICER);
const belongsTo = (session: Session, organizationId: string) =>
  session.organizationId === organizationId &&
  session.roles.some((role) => REPRESENTATIVE_ROLES.includes(role));
const canView = (session: Session, organizationId: string) =>
  seesAllOrganizations(session) || belongsTo(session, organizationId);
const canEdit = (session: Session, organizationId: string) =>
  session.organizationId === organizationId && session.roles.includes(ROLE_CODES.ORGANIZATION_USER);

const editable = (status: RepresentativeChangeStatus) =>
  status === RepresentativeChangeStatus.DRAFT || status === RepresentativeChangeStatus.RETURNED;

const notFound = (res: Response) => res.status(404).json({ error: "not_found", message: "ไม่พบคำขอนี้" });

/** ยืนยันไม่ได้เพราะเงื่อนไขของคำขอ — body มีรายการเหตุผลให้หน้าจอแสดงครบ */
class ChangeBlockedError extends WorkflowError {
  constructor(readonly blockers: string[]) {
    super("change_request_blocked", blockers.join(" · "), 409);
  }
}

function answerWorkflowError(res: Response, err: unknown): boolean {
  if (err instanceof ChangeBlockedError) {
    res.status(err.status).json({ error: err.code, message: err.message, blockers: err.blockers });
    return true;
  }
  if (err instanceof WorkflowError) {
    res.status(err.status).json({ error: err.code, message: err.message });
    return true;
  }
  return false;
}

// ---------------------------------------------------------------- รูปตอบกลับ

async function currentLetter(requestId: string) {
  return prisma.attachment.findFirst({
    where: { ownerType: OWNER, ownerId: requestId, attachmentType: LETTER, status: AttachmentStatus.ACTIVE },
  });
}

function toItems(request: ChangeRequestRow, showFullCid: boolean) {
  return {
    removals: request.removals.map((removal) => {
      const { person, roleCode, pendingInvitee } = removalTarget(removal);
      return {
        id: removal.id,
        status: removal.status,
        userRoleAssignmentId: removal.userRoleAssignmentId,
        activationKeyId: removal.activationKeyId,
        pendingInvitee,
        name: fullNameTh(person),
        positionTh: person?.positionTh ?? null,
        departmentTh: person?.departmentTh ?? null,
        roleCode,
        roleLabel: roleCode ? ROLE_LABELS[roleCode] : null,
      };
    }),
    additions: request.additions.map((addition) => ({
      id: addition.id,
      status: addition.status,
      roleCode: addition.role.code,
      roleLabel: ROLE_LABELS[addition.role.code as RoleCode] ?? addition.role.code,
      prefixTh: addition.userPrefixTh,
      firstnameTh: addition.userFirstnameTh,
      lastnameTh: addition.userLastnameTh,
      cid: showFullCid ? addition.userCid : maskCid(addition.userCid),
      email: addition.userEmail,
      phoneNumber: addition.userPhoneNumber,
      phoneNumberExtension: addition.userPhoneNumberExtension,
      positionTh: addition.userPositionTh,
      departmentTh: addition.userDepartmentTh,
    })),
  };
}

async function timelineOf(requestId: string) {
  const tasks = await taskHistory(prisma, SUBJECT, requestId);
  const actors = await prisma.userAccount.findMany({
    where: { id: { in: tasks.flatMap((t) => (t.completedBy ? [t.completedBy] : [])) } },
    select: { id: true, email: true, prefixTh: true, firstnameTh: true, lastnameTh: true },
  });
  const byId = new Map(actors.map((a) => [a.id, a]));
  return tasks.map((task) => ({
    id: task.id,
    taskType: task.taskType,
    status: task.status,
    result: task.result,
    comment: task.resultComment,
    completedAt: task.completedAt,
    completedBy: task.completedBy ? taskPerson(byId.get(task.completedBy)) : null,
  }));
}

/** รายละเอียดหนึ่งใบ — `bdiView` เท่านั้นที่ได้สถานะบัญชีและเลขบัตรเต็มเสมอ */
async function detailOf(request: ChangeRequestRow, options: { bdiView: boolean; canEdit: boolean; canReview: boolean }) {
  const [letter, timeline] = await Promise.all([currentLetter(request.id), timelineOf(request.id)]);
  const showFullCid = options.bdiView || (options.canEdit && editable(request.status));
  const evaluation = options.bdiView ? await evaluateChangeRequest(prisma, request) : null;
  return {
    id: request.id,
    requestNumber: request.requestNumber,
    status: request.status,
    organization: request.organization,
    submittedAt: request.submittedAt,
    confirmedAt: request.confirmedAt,
    rejectedAt: request.rejectedAt,
    cancelledAt: request.cancelledAt,
    cancellationReason: request.cancellationReason,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
    ...toItems(request, showFullCid),
    attachment: letter ? publicAttachment(letter) : null,
    timeline,
    headcount: evaluation?.headcount ?? (await computeHeadcount(prisma, request)),
    review: evaluation
      ? {
          accountChecks: evaluation.accountChecks,
          overlaps: evaluation.overlaps,
          blockers: evaluation.blockers,
        }
      : null,
    canEdit: options.canEdit && editable(request.status),
    canReview: options.canReview,
    canRetry: canRetry(request),
  };
}

function canRetry(request: { status: RepresentativeChangeStatus; updatedAt: Date }) {
  if (request.status === RepresentativeChangeStatus.PROCESSING_FAILED) return true;
  return (
    request.status === RepresentativeChangeStatus.PROCESSING &&
    Date.now() - request.updatedAt.getTime() > STUCK_PROCESSING_MS
  );
}

const reviewable = (status: RepresentativeChangeStatus) =>
  status === RepresentativeChangeStatus.SUBMITTED || status === RepresentativeChangeStatus.UNDER_REVIEW;

// ---------------------------------------------------------------- อ่าน

const SORTS = ["date_desc", "date_asc", "updated_desc", "updated_asc"] as const;

/** คำศัพท์เดียวกับสองรายการคำขอเดิม เพื่อให้ `useRequestList` ของหน้าเว็บใช้ซ้ำได้ */
const pageSchema = z.object({
  page: z.coerce.number().int().min(1).catch(1),
  pageSize: z.coerce.number().int().min(1).max(100).catch(20),
  stage: z.string().optional().catch(undefined),
  scope: z.string().optional().catch(undefined),
  sort: z.enum(SORTS).catch("date_desc"),
  organizationId: z.string().uuid().optional().catch(undefined),
  q: z.string().trim().max(100).optional().catch(undefined),
});

/** ขอบเขตที่ผู้อ่านเห็น บวกคำค้น — จำนวนบนแผนภาพใช้ขอบเขตนี้ ไม่ขยับตามโหนดที่กด */
function visibleWhere(organizationId: string | undefined, q: string | undefined): Prisma.RepresentativeChangeRequestWhereInput {
  return {
    ...(organizationId ? { organizationId } : {}),
    ...(q
      ? {
          OR: [
            { requestNumber: { contains: q, mode: "insensitive" } },
            { organization: { nameTh: { contains: q, mode: "insensitive" } } },
          ],
        }
      : {}),
  };
}

async function listRequests(
  scope: { organizationId?: string; roles: string[] },
  query: z.infer<typeof pageSchema>,
) {
  const [field, direction] = query.sort.split("_") as ["date" | "updated", "asc" | "desc"];
  const where: Prisma.RepresentativeChangeRequestWhereInput = {
    AND: [
      visibleWhere(scope.organizationId, query.q),
      ...(statusesOfNode(query.stage) ? [{ status: { in: statusesOfNode(query.stage)! } }] : []),
      ...(query.scope === "mine" ? [{ status: { in: statusesOfRoles(scope.roles) } }] : []),
    ],
  };
  const [rows, total] = await Promise.all([
    prisma.representativeChangeRequest.findMany({
      where,
      orderBy: [
        field === "date" ? { submittedAt: { sort: direction, nulls: "last" } } : { updatedAt: direction },
        // แถวที่วันที่เท่ากันต้องมีลำดับตายตัว ไม่งั้นแถวหนึ่งโผล่สองหน้าและอีกแถวหาย
        { id: "asc" },
      ],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: {
        id: true,
        requestNumber: true,
        status: true,
        submittedAt: true,
        updatedAt: true,
        organization: { select: { id: true, nameTh: true } },
        _count: { select: { removals: true, additions: true } },
      },
    }),
    prisma.representativeChangeRequest.count({ where }),
  ]);
  const letters = await prisma.attachment.findMany({
    where: {
      ownerType: OWNER,
      ownerId: { in: rows.map((r) => r.id) },
      attachmentType: LETTER,
      status: AttachmentStatus.ACTIVE,
    },
    select: { ownerId: true, originalFileName: true },
  });
  const letterName = new Map(letters.map((l) => [l.ownerId, l.originalFileName]));
  return {
    requests: rows.map(({ _count, ...row }) => ({
      ...row,
      removalCount: _count.removals,
      additionCount: _count.additions,
      documentName: letterName.get(row.id) ?? null,
    })),
    page: {
      page: query.page,
      pageSize: query.pageSize,
      total,
      pageCount: Math.max(1, Math.ceil(total / query.pageSize)),
    },
  };
}

representativeChangeRouter.get("/representatives", async (req, res) => {
  const session = req.session!;
  const organizationId = seesAllOrganizations(session)
    ? (z.string().uuid().optional().catch(undefined).parse(req.query.organizationId) ?? undefined)
    : (session.organizationId ?? undefined);

  if (!seesAllOrganizations(session) && !(organizationId && belongsTo(session, organizationId))) {
    res.status(403).json({ error: "forbidden", message: "คุณไม่มีสิทธิ์ดูข้อมูลนี้" });
    return;
  }
  if (organizationId) {
    const [organization, representatives, summary] = await Promise.all([
      prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true, nameTh: true, status: true } }),
      listRepresentatives(prisma, organizationId),
      representativeSummary(prisma, organizationId),
    ]);
    if (!organization) {
      res.status(404).json({ error: "not_found", message: "ไม่พบหน่วยงานนี้" });
      return;
    }
    res.json({ organization, summary, representatives: representatives.map((r) => ({ ...r, organization })) });
    return;
  }
  // ฝั่ง BDI ไม่เลือกหน่วยงาน — ทุกหน่วยงานที่เปิดใช้งาน เรียงตามชื่อ
  const organizations = await prisma.organization.findMany({
    where: { status: { not: OrganizationStatus.PENDING_REGISTRATION }, id: { not: BDI_ORGANIZATION_ID } },
    orderBy: { nameTh: "asc" },
    select: { id: true, nameTh: true, status: true },
    take: 200,
  });
  const representatives = [];
  for (const organization of organizations) {
    const rows = await listRepresentatives(prisma, organization.id);
    representatives.push(...rows.map((r) => ({ ...r, organization })));
  }
  res.json({ organization: null, summary: [], representatives });
});

/** องค์กรที่ผู้อ่านคนนี้เห็น — `undefined` = ทุกหน่วยงาน, `null` = ไม่มีสิทธิ์ */
function listScope(session: Session, requested: string | undefined): string | undefined | null {
  if (seesAllOrganizations(session)) return requested;
  return session.organizationId && belongsTo(session, session.organizationId) ? session.organizationId : null;
}

representativeChangeRouter.get("/", async (req, res) => {
  const session = req.session!;
  const query = pageSchema.parse(req.query);
  const organizationId = listScope(session, query.organizationId);
  if (organizationId === null) {
    res.status(403).json({ error: "forbidden", message: "คุณไม่มีสิทธิ์ดูข้อมูลนี้" });
    return;
  }
  res.json(await listRequests({ organizationId, roles: session.roles }, query));
});

representativeChangeRouter.get("/summary", async (req, res) => {
  const session = req.session!;
  const query = pageSchema.parse(req.query);
  const organizationId = listScope(session, query.organizationId);
  if (organizationId === null) {
    res.status(403).json({ error: "forbidden", message: "คุณไม่มีสิทธิ์ดูข้อมูลนี้" });
    return;
  }
  const grouped = await prisma.representativeChangeRequest.groupBy({
    by: ["status"],
    where: visibleWhere(organizationId, query.q),
    _count: { _all: true },
  });
  res.json(
    changeRequestSummary(
      Object.fromEntries(grouped.map((g) => [g.status, g._count._all])),
      session.roles,
    ),
  );
});

representativeChangeRouter.get("/:id", async (req, res) => {
  const session = req.session!;
  const parsed = z.string().uuid().safeParse(req.params.id);
  const request = parsed.success ? await loadChangeRequest(prisma, parsed.data) : null;
  if (!request || !canView(session, request.organizationId)) {
    notFound(res);
    return;
  }
  res.json({
    request: await detailOf(request, {
      bdiView: seesAllOrganizations(session),
      canEdit: canEdit(session, request.organizationId),
      canReview: isOfficer(session) && reviewable(request.status),
    }),
  });
});

representativeChangeRouter.get("/:id/attachments/:attachmentId", async (req, res) => {
  const session = req.session!;
  const parsed = z.string().uuid().safeParse(req.params.id);
  const request = parsed.success
    ? await prisma.representativeChangeRequest.findUnique({ where: { id: parsed.data } })
    : null;
  if (!request || !canView(session, request.organizationId)) {
    notFound(res);
    return;
  }
  const attachment = await prisma.attachment.findFirst({
    where: { id: req.params.attachmentId, ownerType: OWNER, ownerId: request.id },
  });
  if (!attachment) {
    notFound(res);
    return;
  }
  await logAudit({
    action: AuditAction.DOCUMENT_DOWNLOADED,
    subjectType: AuditSubject.ATTACHMENT,
    subjectId: attachment.id,
    organizationId: request.organizationId,
    after: { filename: attachment.originalFileName },
  });
  await streamAttachment(req, res, attachment);
});

// ---------------------------------------------------------------- ร่าง

/** เปิดร่างใบใหม่ — หน่วยงานมีคำขอค้างได้หลายใบ */
representativeChangeRouter.post("/", async (req, res) => {
  const session = req.session!;
  const organizationId = session.organizationId;
  if (!organizationId || !canEdit(session, organizationId)) {
    res.status(403).json({ error: "forbidden", message: "เฉพาะผู้ประสานงานของหน่วยงานเท่านั้นที่ยื่นคำขอนี้ได้" });
    return;
  }
  if (await refuseIfOrganizationFrozen(res, organizationId)) return;
  const organization = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { status: true },
  });
  if (organization.status !== OrganizationStatus.ACTIVE) {
    res.status(409).json({
      error: "organization_not_active",
      message: "หน่วยงานต้องลงทะเบียนเสร็จก่อนจึงจะยื่นคำขอเปลี่ยนแปลงผู้แทนได้",
    });
    return;
  }

  let created: { id: string; requestNumber: string } | null = null;
  // เลขคำขอคำนวณจากใบล่าสุด สองคนกดพร้อมกันจึงชนกันได้ ลองใหม่แทนที่จะตอบ "ข้อมูลซ้ำ"
  for (let attempt = 0; attempt < 3 && !created; attempt += 1) {
    try {
      created = await prisma.representativeChangeRequest.create({
        data: {
          requestNumber: await nextRepresentativeChangeNumber(prisma),
          organizationId,
          createdBy: session.sub,
          updatedBy: session.sub,
        },
        select: { id: true, requestNumber: true },
      });
    } catch (err) {
      const duplicate = err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
      if (!duplicate || attempt === 2) throw err;
    }
  }
  await logAudit({
    action: AuditAction.REPRESENTATIVE_CHANGE_CREATED,
    subjectType: AuditSubject.REPRESENTATIVE_CHANGE_REQUEST,
    subjectId: created!.id,
    organizationId,
    after: { requestNumber: created!.requestNumber },
  });
  res.status(201).json({ request: created });
});

const optionalText = (max: number) => z.string().trim().max(max).optional().nullable();

/** ร่างยังไม่ครบได้ ตรวจครบตอนนำส่ง (`additionSubmitSchema`) */
const additionDraftSchema = z.object({
  id: z.string().uuid().optional(),
  roleCode: z.enum([ROLE_CODES.ORGANIZATION_USER, ROLE_CODES.ORGANIZATION_APPROVER], {
    error: "กรุณาเลือกบทบาท",
  }),
  prefixTh: optionalText(64),
  firstnameTh: optionalText(255),
  lastnameTh: optionalText(255),
  cid: optionalText(13),
  email: optionalText(255),
  phoneNumber: optionalText(32),
  phoneNumberExtension: optionalText(16),
  positionTh: optionalText(255),
  departmentTh: optionalText(255),
});

const draftSchema = z.object({
  removals: z
    .array(
      z
        .object({
          userRoleAssignmentId: z.string().uuid().nullish(),
          activationKeyId: z.string().uuid().nullish(),
        })
        .refine((r) => Boolean(r.userRoleAssignmentId) !== Boolean(r.activationKeyId), "ต้องระบุผู้แทนหนึ่งคน"),
    )
    .max(50)
    .default([]),
  additions: z.array(additionDraftSchema).max(50).default([]),
});

const blank = (value: string | null | undefined) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

async function writeDraft(
  tx: Prisma.TransactionClient,
  request: ChangeRequestRow,
  input: z.infer<typeof draftSchema>,
  actorId: string,
) {
  // ฝั่งยกเลิก — เทียบกับที่มีอยู่ ของที่ถูกเอาออกเป็น CANCELLED แถวยังอยู่
  const key = (r: { userRoleAssignmentId?: string | null; activationKeyId?: string | null }) =>
    r.userRoleAssignmentId ?? r.activationKeyId ?? "";
  const wanted = new Map(input.removals.map((r) => [key(r), r]));
  for (const removal of request.removals) {
    if (!wanted.delete(key(removal))) {
      await tx.representativeChangeRemoval.update({
        where: { id: removal.id },
        data: { status: RepresentativeRemovalStatus.CANCELLED, updatedBy: actorId },
      });
    }
  }
  for (const removal of wanted.values()) {
    await assertRemovalBelongs(tx, request.organizationId, removal);
    await tx.representativeChangeRemoval.create({
      data: {
        changeRequestId: request.id,
        userRoleAssignmentId: removal.userRoleAssignmentId ?? null,
        activationKeyId: removal.activationKeyId ?? null,
        createdBy: actorId,
        updatedBy: actorId,
      },
    });
  }

  // ฝั่งเพิ่ม — แถวที่ส่ง id มาคือแก้ แถวเดิมที่ไม่ถูกส่งมาคือเอาออก
  const keep = new Set(input.additions.flatMap((a) => (a.id ? [a.id] : [])));
  for (const addition of request.additions) {
    if (!keep.has(addition.id)) {
      await tx.representativeChangeAddition.update({
        where: { id: addition.id },
        data: { status: RepresentativeAdditionStatus.CANCELLED, updatedBy: actorId },
      });
    }
  }
  for (const addition of input.additions) {
    if (addition.id && !request.additions.some((a) => a.id === addition.id)) {
      throw new WorkflowError("validation", "ไม่พบรายการผู้แทนที่ต้องการแก้ไข", 400);
    }
    const data = {
      roleId: await roleIdByCode(tx, addition.roleCode),
      userPrefixTh: blank(addition.prefixTh),
      userFirstnameTh: blank(addition.firstnameTh),
      userLastnameTh: blank(addition.lastnameTh),
      userCid: blank(addition.cid),
      userEmail: blank(addition.email)?.toLowerCase() ?? null,
      userPhoneNumber: blank(addition.phoneNumber),
      userPhoneNumberExtension: blank(addition.phoneNumberExtension),
      userPositionTh: blank(addition.positionTh),
      userDepartmentTh: blank(addition.departmentTh),
      updatedBy: actorId,
    };
    if (addition.id) {
      await tx.representativeChangeAddition.update({ where: { id: addition.id }, data });
    } else {
      await tx.representativeChangeAddition.create({
        data: { ...data, changeRequestId: request.id, createdBy: actorId },
      });
    }
  }
}

/** คนที่เลือกต้องเป็นผู้แทนของหน่วยงานนี้จริง — ไม่งั้นส่ง id ของหน่วยงานอื่นมายกเลิกได้ */
async function assertRemovalBelongs(
  tx: Prisma.TransactionClient,
  organizationId: string,
  removal: { userRoleAssignmentId?: string | null; activationKeyId?: string | null },
) {
  const roleIds = await Promise.all(REPRESENTATIVE_ROLES.map((code) => roleIdByCode(tx, code)));
  const found = removal.userRoleAssignmentId
    ? await tx.userRoleAssignment.findFirst({
        where: { id: removal.userRoleAssignmentId, organizationId, roleId: { in: roleIds } },
        select: { id: true },
      })
    : await tx.activationKey.findFirst({
        where: { id: removal.activationKeyId!, organizationId, roleId: { in: roleIds } },
        select: { id: true },
      });
  if (!found) throw new WorkflowError("validation", "ไม่พบผู้แทนที่เลือกในหน่วยงานนี้", 400);
}

representativeChangeRouter.patch("/:id", async (req, res) => {
  const session = req.session!;
  const parsedId = z.string().uuid().safeParse(req.params.id);
  const request = parsedId.success ? await loadChangeRequest(prisma, parsedId.data) : null;
  if (!request || !canEdit(session, request.organizationId)) {
    notFound(res);
    return;
  }
  if (await refuseIfOrganizationFrozen(res, request.organizationId)) return;
  if (!editable(request.status)) {
    res.status(409).json({ error: "locked", message: "คำขออยู่ระหว่างการดำเนินการ จึงแก้ไขไม่ได้" });
    return;
  }
  const parsed = draftSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "validation", fields: formatZodError(parsed.error) });
    return;
  }
  try {
    await prisma.$transaction(async (tx) => {
      await writeDraft(tx, request, parsed.data, session.sub);
      await tx.representativeChangeRequest.update({
        where: { id: request.id },
        data: { updatedBy: session.sub },
      });
    });
  } catch (err) {
    if (answerWorkflowError(res, err)) return;
    throw err;
  }
  await logAudit({
    action: AuditAction.REPRESENTATIVE_CHANGE_DRAFT_SAVED,
    subjectType: AuditSubject.REPRESENTATIVE_CHANGE_REQUEST,
    subjectId: request.id,
    organizationId: request.organizationId,
    after: { removals: parsed.data.removals.length, additions: parsed.data.additions.length },
  });
  const fresh = await loadChangeRequest(prisma, request.id);
  res.json({ request: await detailOf(fresh!, { bdiView: false, canEdit: true, canReview: false }) });
});

representativeChangeRouter.post("/:id/attachments", upload.single("file"), async (req, res) => {
  const session = req.session!;
  const parsedId = z.string().uuid().safeParse(req.params.id);
  const request = parsedId.success
    ? await prisma.representativeChangeRequest.findUnique({ where: { id: parsedId.data } })
    : null;
  if (!request || !canEdit(session, request.organizationId)) {
    notFound(res);
    return;
  }
  if (!req.file) {
    res.status(400).json({ error: "validation", message: "กรุณาเลือกไฟล์" });
    return;
  }
  if (req.file.mimetype !== "application/pdf") {
    res.status(400).json({ error: "validation", message: "รองรับเฉพาะไฟล์ PDF ขนาดไม่เกิน 10 MB" });
    return;
  }
  if (await refuseIfOrganizationFrozen(res, request.organizationId)) return;
  if (!editable(request.status)) {
    res.status(409).json({ error: "locked", message: "คำขออยู่ระหว่างการดำเนินการ จึงแก้ไขไม่ได้" });
    return;
  }
  const attachment = await storeAttachment(prisma, {
    ownerType: OWNER,
    ownerId: request.id,
    attachmentType: LETTER,
    file: uploadedFile(req.file),
    uploadedBy: session.sub,
  });
  await logAudit({
    action: attachment.replacedAttachmentId ? AuditAction.ATTACHMENT_REPLACED : AuditAction.ATTACHMENT_UPLOADED,
    subjectType: AuditSubject.ATTACHMENT,
    subjectId: attachment.id,
    organizationId: request.organizationId,
    after: { attachmentType: LETTER, filename: attachment.originalFileName },
  });
  res.status(201).json({ attachment: publicAttachment(attachment) });
});

representativeChangeRouter.delete("/:id/attachments/:attachmentId", async (req, res) => {
  const session = req.session!;
  const parsedId = z.string().uuid().safeParse(req.params.id);
  const request = parsedId.success
    ? await prisma.representativeChangeRequest.findUnique({ where: { id: parsedId.data } })
    : null;
  if (!request || !canEdit(session, request.organizationId)) {
    notFound(res);
    return;
  }
  if (await refuseIfOrganizationFrozen(res, request.organizationId)) return;
  if (!editable(request.status)) {
    res.status(409).json({ error: "locked", message: "คำขออยู่ระหว่างการดำเนินการ จึงแก้ไขไม่ได้" });
    return;
  }
  const { count } = await prisma.attachment.updateMany({
    where: { id: req.params.attachmentId, ownerType: OWNER, ownerId: request.id, status: AttachmentStatus.ACTIVE },
    data: {
      status: AttachmentStatus.DELETED,
      deletedAt: new Date(),
      deletedBy: session.sub,
      deletionReason: "ผู้กรอกลบไฟล์ออกจากร่าง",
    },
  });
  if (count === 0) {
    notFound(res);
    return;
  }
  await logAudit({
    action: AuditAction.ATTACHMENT_DELETED,
    subjectType: AuditSubject.ATTACHMENT,
    subjectId: req.params.attachmentId,
    organizationId: request.organizationId,
  });
  res.json({ ok: true });
});

// ---------------------------------------------------------------- นำส่ง · ยกเลิก

/** ตรวจตอนนำส่ง — รูปแบบข้อมูลเท่านั้น จำนวนและสถานะบัญชีตรวจที่ BDI */
const additionSubmitSchema = z.object({
  userPrefixTh: z.string({ error: "กรุณาเลือกคำนำหน้า" }).min(1, "กรุณาเลือกคำนำหน้า"),
  userFirstnameTh: z.string({ error: "กรุณากรอกชื่อ" }).min(1, "กรุณากรอกชื่อ"),
  userLastnameTh: z.string({ error: "กรุณากรอกนามสกุล" }).min(1, "กรุณากรอกนามสกุล"),
  userCid: nationalIdSchema,
  userEmail: emailSchema,
  userPhoneNumber: phoneSchema,
  userPhoneNumberExtension: phoneExtensionSchema.nullish(),
  userPositionTh: z.string({ error: "กรุณากรอกตำแหน่ง" }).min(1, "กรุณากรอกตำแหน่ง"),
  userDepartmentTh: z.string({ error: "กรุณากรอกฝ่าย/กอง/สำนัก" }).min(1, "กรุณากรอกฝ่าย/กอง/สำนัก"),
});

function validateForSubmit(request: ChangeRequestRow, hasLetter: boolean) {
  const fields: Record<string, string> = {};
  if (request.removals.length === 0 && request.additions.length === 0) {
    fields.items = "กรุณาระบุผู้แทนที่ต้องการยกเลิกหรือเพิ่มอย่างน้อยหนึ่งรายการ";
  }
  if (!hasLetter) fields.attachment = "กรุณาแนบหนังสือนำและฟอร์มแจ้งรายละเอียด";
  const parsedRows = request.additions.map((addition, index) => {
    const parsed = additionSubmitSchema.safeParse(addition);
    if (parsed.success) return { id: addition.id, data: parsed.data };
    for (const [field, message] of Object.entries(formatZodError(parsed.error))) {
      fields[`additions.${index}.${field}`] = message;
    }
    return null;
  });
  const seenCid = new Set<string>();
  const seenEmail = new Set<string>();
  request.additions.forEach((addition, index) => {
    if (addition.userCid && seenCid.has(addition.userCid)) {
      fields[`additions.${index}.userCid`] = "เลขบัตรประชาชนซ้ำกับรายการอื่นในคำขอนี้";
    }
    if (addition.userEmail && seenEmail.has(addition.userEmail)) {
      fields[`additions.${index}.userEmail`] = "อีเมลซ้ำกับรายการอื่นในคำขอนี้";
    }
    if (addition.userCid) seenCid.add(addition.userCid);
    if (addition.userEmail) seenEmail.add(addition.userEmail);
  });
  return { fields, rows: parsedRows.filter((r) => r !== null) };
}

representativeChangeRouter.post("/:id/submit", async (req, res) => {
  const session = req.session!;
  const parsedId = z.string().uuid().safeParse(req.params.id);
  const request = parsedId.success ? await loadChangeRequest(prisma, parsedId.data) : null;
  if (!request || !canEdit(session, request.organizationId)) {
    notFound(res);
    return;
  }
  if (await refuseIfOrganizationFrozen(res, request.organizationId)) return;
  if (!editable(request.status)) {
    res.status(409).json({ error: "locked", message: "คำขอนี้ถูกนำส่งหรือปิดไปแล้ว" });
    return;
  }
  const { fields, rows } = validateForSubmit(request, (await currentLetter(request.id)) !== null);
  if (Object.keys(fields).length > 0) {
    res.status(400).json({ error: "validation", fields });
    return;
  }
  try {
    await prisma.$transaction(async (tx) => {
      const moved = await tx.representativeChangeRequest.updateMany({
        where: {
          id: request.id,
          status: { in: [RepresentativeChangeStatus.DRAFT, RepresentativeChangeStatus.RETURNED] },
        },
        data: { status: RepresentativeChangeStatus.SUBMITTED, submittedAt: new Date(), updatedBy: session.sub },
      });
      if (moved.count === 0) throw new WorkflowError("locked", "คำขอนี้ถูกนำส่งหรือปิดไปแล้ว", 409);
      for (const row of rows) {
        // เก็บค่าที่ปรับรูปแล้ว เช่น เบอร์เหลือแต่ตัวเลข
        await tx.representativeChangeAddition.update({
          where: { id: row.id },
          data: {
            userEmail: row.data.userEmail,
            userPhoneNumber: row.data.userPhoneNumber,
            userPhoneNumberExtension: row.data.userPhoneNumberExtension ?? null,
          },
        });
      }
      await openTask(tx, {
        subjectType: SUBJECT,
        subjectId: request.id,
        taskType: "BDI_OFFICER_REVIEW",
        assignedRole: ROLE_CODES.BDI_OFFICER,
        actorId: session.sub,
      });
    });
  } catch (err) {
    if (answerWorkflowError(res, err)) return;
    throw err;
  }
  await logAudit({
    action: AuditAction.REPRESENTATIVE_CHANGE_SUBMITTED,
    subjectType: AuditSubject.REPRESENTATIVE_CHANGE_REQUEST,
    subjectId: request.id,
    organizationId: request.organizationId,
    after: { requestNumber: request.requestNumber },
  });
  const members = await organizationMemberIds(request.organizationId);
  await notifyUsers([...(await bdiOfficerIds()), ...members.users], {
    type: NotificationType.REPRESENTATIVE_CHANGE_SUBMITTED,
    title: `คำขอเปลี่ยนแปลงผู้แทน ${request.requestNumber} ถูกนำส่งแล้ว`,
    message: `${request.organization.nameTh} นำส่งคำขอเปลี่ยนแปลงผู้แทนหน่วยงาน เลขที่ ${request.requestNumber}`,
    subjectType: SUBJECT,
    subjectId: request.id,
    organizationId: request.organizationId,
  });
  res.json({ ok: true });
});

representativeChangeRouter.post("/:id/cancel", async (req, res) => {
  const session = req.session!;
  const parsedId = z.string().uuid().safeParse(req.params.id);
  const request = parsedId.success ? await loadChangeRequest(prisma, parsedId.data) : null;
  if (!request || !canEdit(session, request.organizationId)) {
    notFound(res);
    return;
  }
  const parsed = z
    .object({ reason: z.string({ error: "กรุณาระบุเหตุผล" }).trim().min(10, "กรุณาระบุเหตุผลอย่างน้อย 10 ตัวอักษร") })
    .safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "validation", fields: formatZodError(parsed.error) });
    return;
  }
  if (await refuseIfOrganizationFrozen(res, request.organizationId)) return;
  const closed = await prisma.$transaction(async (tx) => {
    const moved = await tx.representativeChangeRequest.updateMany({
      where: {
        id: request.id,
        status: { in: [RepresentativeChangeStatus.DRAFT, RepresentativeChangeStatus.RETURNED] },
      },
      data: {
        status: RepresentativeChangeStatus.CANCELLED,
        cancelledAt: new Date(),
        cancelledBy: session.sub,
        cancellationReason: parsed.data.reason,
        updatedBy: session.sub,
      },
    });
    if (moved.count === 0) return false;
    await closeItems(tx, request.id, session.sub);
    await cancelActiveTask(tx, {
      subjectType: SUBJECT,
      subjectId: request.id,
      actorId: session.sub,
      reason: parsed.data.reason,
    });
    return true;
  });
  if (!closed) {
    res.status(409).json({ error: "locked", message: "ยกเลิกได้เฉพาะคำขอที่เป็นร่างหรือถูกส่งกลับแก้ไข" });
    return;
  }
  await logAudit({
    action: AuditAction.REPRESENTATIVE_CHANGE_CANCELLED,
    subjectType: AuditSubject.REPRESENTATIVE_CHANGE_REQUEST,
    subjectId: request.id,
    organizationId: request.organizationId,
    metadata: { reason: parsed.data.reason },
  });
  res.json({ ok: true });
});

async function closeItems(tx: Prisma.TransactionClient, requestId: string, actorId: string) {
  await tx.representativeChangeRemoval.updateMany({
    where: { changeRequestId: requestId, status: RepresentativeRemovalStatus.PENDING },
    data: { status: RepresentativeRemovalStatus.CANCELLED, updatedBy: actorId },
  });
  await tx.representativeChangeAddition.updateMany({
    where: { changeRequestId: requestId, status: RepresentativeAdditionStatus.PENDING },
    data: { status: RepresentativeAdditionStatus.CANCELLED, updatedBy: actorId },
  });
}

// ---------------------------------------------------------------- ตรวจ

/** BDI เปิดอ่าน — SUBMITTED → UNDER_REVIEW หน้าตรวจเรียกตอนเปิด */
async function openForReview(requestId: string, actorId: string) {
  await prisma.$transaction(async (tx) => {
    const moved = await tx.representativeChangeRequest.updateMany({
      where: { id: requestId, status: RepresentativeChangeStatus.SUBMITTED },
      data: { status: RepresentativeChangeStatus.UNDER_REVIEW, updatedBy: actorId },
    });
    if (moved.count === 0) return;
    const task = await activeTask(tx, SUBJECT, requestId);
    if (task) await startTask(tx, task.id, actorId);
  });
}

interface InvitationToSend {
  additionId: string;
  email: string;
  key: string;
  expiresAt: Date;
  roleCode: RoleCode;
  activationKeyId: string;
  userAccountId: string;
}

/** ผู้แทนเดิมหนึ่งคน — ผลเท่ากับ admin Deactivate ส่วนคนที่มีแค่คำเชิญถูกเพิกถอนคำเชิญอย่างเดียว */
async function applyRemoval(
  tx: Prisma.TransactionClient,
  removal: ChangeRequestRow["removals"][number],
  request: ChangeRequestRow,
  actorId: string,
) {
  const reason = `ยกเลิกตามคำขอเปลี่ยนแปลงผู้แทน ${request.requestNumber}`;
  const revokedKeys: RevokedKey[] = [];
  let deactivated: string | null = null;

  if (removal.userRoleAssignment) {
    const userAccountId = removal.userRoleAssignment.userAccount.id;
    await revokeRoleAssignments(tx, { userAccountId, actorId, reason });
    revokedKeys.push(...(await revokeIssuedKeys(tx, { userAccountId }, { actorId, reason })));
    await revokeSessionsFor(tx, { userAccountId, reason: SessionRevokeReason.ACCOUNT_SUSPENDED });
    await tx.userAccount.update({
      where: { id: userAccountId },
      data: { status: UserAccountStatus.DEACTIVATED, deactivatedAt: new Date(), updatedBy: actorId },
    });
    deactivated = userAccountId;
  } else if (removal.activationKeyId) {
    revokedKeys.push(...(await revokeIssuedKeys(tx, { id: removal.activationKeyId }, { actorId, reason })));
  }
  await tx.representativeChangeRemoval.update({
    where: { id: removal.id },
    data: { status: RepresentativeRemovalStatus.COMPLETED, deactivatedAt: new Date(), updatedBy: actorId },
  });
  return { revokedKeys, deactivated };
}

/** ผู้แทนใหม่หนึ่งคน — §5.3 ของการ์ด ทุกทางจบที่คำเชิญ ไม่มีการมอบบทบาทโดยไม่ผ่าน ThaID */
async function applyAddition(
  tx: Prisma.TransactionClient,
  addition: ChangeRequestRow["additions"][number],
  check: { state: string; accountId: string | null },
  request: ChangeRequestRow,
  actorId: string,
): Promise<{ invitation: InvitationToSend; revokedKeys: RevokedKey[]; createdAccount: boolean }> {
  const email = addition.userEmail!;
  const names = {
    prefixTh: addition.userPrefixTh,
    firstnameTh: addition.userFirstnameTh,
    lastnameTh: addition.userLastnameTh,
  };
  const contact = {
    phoneNumber: addition.userPhoneNumber,
    phoneNumberExtension: addition.userPhoneNumberExtension,
    positionTh: addition.userPositionTh,
    departmentTh: addition.userDepartmentTh,
  };
  let userAccountId: string;
  let createdAccount = false;
  if (check.state === "NEW") {
    const account = await tx.userAccount.create({
      data: {
        email,
        cid: addition.userCid,
        ...names,
        ...contact,
        displayName: fullNameTh(names),
        accountType: AccountType.ORGANIZATION,
        status: UserAccountStatus.PENDING,
        createdBy: actorId,
        updatedBy: actorId,
      },
      select: { id: true },
    });
    userAccountId = account.id;
    createdAccount = true;
  } else if (check.state === "REUSE_PENDING") {
    userAccountId = check.accountId!;
    // ยังไม่เคยเปิดใช้งาน ค่าเดิมเป็นแค่ที่พิมพ์ไว้ ค่าในคำขอใหม่กว่า และ ThaID ยังตรวจเลขบัตรตอนเปิดใช้งาน
    await tx.userAccount.update({
      where: { id: userAccountId },
      data: { email, ...names, ...contact, displayName: fullNameTh(names), accountType: AccountType.ORGANIZATION, updatedBy: actorId },
    });
  } else {
    // INVITE_BACK — เหมือน `POST /api/admin/users/:id/reinvite` บัญชียัง DEACTIVATED จนเจ้าตัวเปิดใช้งาน
    userAccountId = check.accountId!;
    await tx.userAccount.update({
      where: { id: userAccountId },
      data: { email, accountType: AccountType.ORGANIZATION, updatedBy: actorId },
    });
  }
  const roleCode = addition.role.code as RoleCode;
  const issued = await issueActivationKey(tx, {
    userAccountId,
    organizationId: request.organizationId,
    roleCode,
    actorId,
  });
  await tx.representativeChangeAddition.update({
    where: { id: addition.id },
    data: { status: RepresentativeAdditionStatus.PROCESSING, activationKeyId: issued.record.id, updatedBy: actorId },
  });
  return {
    invitation: {
      additionId: addition.id,
      email,
      key: issued.key,
      expiresAt: issued.record.expiresAt,
      roleCode,
      activationKeyId: issued.record.id,
      userAccountId,
    },
    revokedKeys: issued.revokedKeys,
    createdAccount,
  };
}

/** ส่งคำเชิญแบบ inline แล้วสรุปสถานะคำขอ — raw key มีแค่ในหน่วยความจำ จึงส่งผ่าน outbox ไม่ได้ */
async function deliverInvitations(
  requestId: string,
  request: { requestNumber: string; organizationId: string; organization: { nameTh: string } },
  invitations: InvitationToSend[],
  actorId: string,
) {
  const failed: string[] = [];
  for (const invitation of invitations) {
    // audit ก่อนส่ง — การส่งอาจ throw แต่คีย์ถูก commit ไปแล้ว
    await logAudit({
      action: AuditAction.ACTIVATION_KEY_ISSUED,
      subjectType: AuditSubject.USER_ACTIVATION_KEY,
      subjectId: invitation.activationKeyId,
      organizationId: request.organizationId,
      after: { role: invitation.roleCode, userAccountId: invitation.userAccountId },
      metadata: { issued_via: "REPRESENTATIVE_CHANGE", request_number: request.requestNumber },
    });
    try {
      await sendInvitationEmail(invitation.email, invitation.key, {
        roleLabel: ROLE_LABELS[invitation.roleCode],
        organizationName: request.organization.nameTh,
        expiresAt: invitation.expiresAt,
        internal: false,
      });
      await prisma.representativeChangeAddition.update({
        where: { id: invitation.additionId },
        data: { status: RepresentativeAdditionStatus.INVITED, updatedBy: actorId },
      });
    } catch (err) {
      console.error("[representative-change] ส่งคำเชิญไม่สำเร็จ", err instanceof Error ? err.message : err);
      failed.push(invitation.email);
      await prisma.representativeChangeAddition.update({
        where: { id: invitation.additionId },
        data: { status: RepresentativeAdditionStatus.FAILED, updatedBy: actorId },
      });
    }
  }
  const status = failed.length
    ? RepresentativeChangeStatus.PROCESSING_FAILED
    : RepresentativeChangeStatus.COMPLETED;
  await prisma.representativeChangeRequest.update({
    where: { id: requestId },
    data: { status, updatedBy: actorId },
  });
  return { status, failed };
}

async function announceOutcome(
  request: ChangeRequestRow,
  outcome: { status: RepresentativeChangeStatus; failed: string[] },
  removedIds: string[],
  reviewerId: string,
) {
  const common = {
    subjectType: SUBJECT,
    subjectId: request.id,
    organizationId: request.organizationId,
  };
  if (outcome.status === RepresentativeChangeStatus.PROCESSING_FAILED) {
    await notifyUsers(await bdiOfficerIds(), {
      ...common,
      type: NotificationType.REPRESENTATIVE_CHANGE_FAILED,
      title: `คำขอ ${request.requestNumber} ดำเนินการไม่สำเร็จบางรายการ`,
      message: `ส่งคำเชิญไม่สำเร็จ ${outcome.failed.length} รายการ กรุณาเปิดคำขอแล้วกดลองใหม่`,
    });
    return;
  }
  const members = await organizationMemberIds(request.organizationId);
  await notifyUsers([...members.users, ...members.approvers, reviewerId], {
    ...common,
    type: NotificationType.REPRESENTATIVE_CHANGE_COMPLETED,
    title: `คำขอเปลี่ยนแปลงผู้แทน ${request.requestNumber} ดำเนินการเรียบร้อย`,
    message: `${request.organization.nameTh} — ยกเลิกผู้แทนเดิมและส่งคำเชิญผู้แทนใหม่เรียบร้อยแล้ว`,
  });
  await notifyUsers(removedIds, {
    type: NotificationType.ROLE_ASSIGNMENT_CHANGED,
    title: "บัญชีของคุณถูกยกเลิกจากการเป็นผู้แทนหน่วยงาน",
    message: `${request.organization.nameTh} ได้ยกเลิกคุณจากการเป็นผู้แทนตามคำขอ ${request.requestNumber} หากคิดว่าไม่ถูกต้อง โปรดติดต่อหน่วยงานของคุณ`,
    organizationId: request.organizationId,
  });
}

/** BDI กดผ่านการตรวจสอบ — ตรวจเงื่อนไขและดำเนินการในทรานแซกชันเดียว แล้วส่งคำเชิญหลัง commit */
async function confirmRequest(requestId: string, actorId: string, note: string | undefined) {
  const committed = await prisma.$transaction(
    async (tx) => {
      const before = await tx.representativeChangeRequest.findUnique({
        where: { id: requestId },
        select: { organizationId: true },
      });
      if (!before) throw new WorkflowError("not_found", "ไม่พบคำขอนี้", 404);
      /**
       * ล็อกแถวหน่วยงานก่อนนับ — สองใบของหน่วยงานเดียวกันที่ถูกกดพร้อมกันจะถูกตรวจทีละใบ
       * ถ้าไม่ล็อก ทั้งสองใบเห็นจำนวนเดิม ผ่านทั้งคู่ แล้วรวมกันเกินเพดาน
       */
      const rows = await tx.$queryRaw<{ status: OrganizationStatus }[]>`
        SELECT status FROM organization.organization WHERE id = ${before.organizationId}::uuid FOR UPDATE`;
      if (rows[0] && isOrganizationFrozen(rows[0].status)) {
        throw new WorkflowError(ORGANIZATION_FROZEN, frozenOrganizationMessage(rows[0].status), 409);
      }
      const request = await loadChangeRequest(tx, requestId);
      if (!request || !reviewable(request.status)) {
        throw new WorkflowError("task_closed", "คำขอนี้ถูกดำเนินการไปแล้ว", 409);
      }
      const evaluation = await evaluateChangeRequest(tx, request);
      if (evaluation.blockers.length > 0) throw new ChangeBlockedError(evaluation.blockers);

      const task = await activeTask(tx, SUBJECT, requestId);
      if (!task) throw new WorkflowError("task_closed", "คำขอนี้ถูกดำเนินการไปแล้ว", 409);
      await startTask(tx, task.id, actorId);
      await completeTask(tx, {
        taskId: task.id,
        result: ReviewResult.CONFIRMED,
        comment: note ?? null,
        commentVisibility: CommentVisibility.ORGANIZATION,
        actorId,
      });
      await tx.representativeChangeRequest.update({
        where: { id: requestId },
        data: {
          status: RepresentativeChangeStatus.PROCESSING,
          confirmedAt: new Date(),
          confirmedBy: actorId,
          updatedBy: actorId,
        },
      });

      // ยกเลิกก่อน แล้วค่อยเพิ่ม — เลขบัตรหรืออีเมลของคนที่เพิ่งถูกถอดอาจถูกใช้ต่อในใบเดียวกันไม่ได้อยู่แล้ว
      // แต่ลำดับนี้ทำให้จำนวนระหว่างทางไม่เกินเพดาน
      const revokedKeys: RevokedKey[] = [];
      const removedIds: string[] = [];
      for (const removal of request.removals) {
        const applied = await applyRemoval(tx, removal, request, actorId);
        revokedKeys.push(...applied.revokedKeys);
        if (applied.deactivated) removedIds.push(applied.deactivated);
      }
      const invitations: InvitationToSend[] = [];
      const createdAccounts: string[] = [];
      for (const addition of request.additions) {
        const check = evaluation.accountChecks.find((c) => c.additionId === addition.id)!;
        const applied = await applyAddition(tx, addition, check, request, actorId);
        invitations.push(applied.invitation);
        revokedKeys.push(...applied.revokedKeys);
        if (applied.createdAccount) createdAccounts.push(applied.invitation.userAccountId);
      }
      return { request, invitations, revokedKeys, removedIds, createdAccounts };
    },
    { timeout: 30_000 },
  );

  const { request } = committed;
  await logAudit({
    action: AuditAction.REPRESENTATIVE_CHANGE_CONFIRMED,
    subjectType: AuditSubject.REPRESENTATIVE_CHANGE_REQUEST,
    subjectId: request.id,
    organizationId: request.organizationId,
    after: { removals: request.removals.length, additions: request.additions.length },
  });
  for (const userAccountId of committed.removedIds) {
    await logAudit({
      action: AuditAction.USER_ACCOUNT_DEACTIVATED,
      subjectType: AuditSubject.USER_ACCOUNT,
      subjectId: userAccountId,
      organizationId: request.organizationId,
      after: { status: UserAccountStatus.DEACTIVATED },
      metadata: { deactivated_via: "REPRESENTATIVE_CHANGE", request_number: request.requestNumber },
    });
  }
  for (const userAccountId of committed.createdAccounts) {
    await logAudit({
      action: AuditAction.USER_ACCOUNT_CREATED,
      subjectType: AuditSubject.USER_ACCOUNT,
      subjectId: userAccountId,
      organizationId: request.organizationId,
      metadata: { created_via: "REPRESENTATIVE_CHANGE", request_number: request.requestNumber },
    });
  }
  await logKeysRevoked(committed.revokedKeys, { revokedVia: "REPRESENTATIVE_CHANGE" });

  const outcome = await deliverInvitations(request.id, request, committed.invitations, actorId);
  await announceOutcome(request, outcome, committed.removedIds, actorId);
  return outcome;
}

async function returnOrReject(
  requestId: string,
  action: "return" | "reject",
  actorId: string,
  note: string,
) {
  const request = await prisma.$transaction(async (tx) => {
    const row = await loadChangeRequest(tx, requestId);
    if (!row) throw new WorkflowError("not_found", "ไม่พบคำขอนี้", 404);
    if (isOrganizationFrozen(row.organization.status)) {
      throw new WorkflowError(ORGANIZATION_FROZEN, frozenOrganizationMessage(row.organization.status), 409);
    }
    if (!reviewable(row.status)) throw new WorkflowError("task_closed", "คำขอนี้ถูกดำเนินการไปแล้ว", 409);
    const task = await activeTask(tx, SUBJECT, requestId);
    if (!task) throw new WorkflowError("task_closed", "คำขอนี้ถูกดำเนินการไปแล้ว", 409);
    await startTask(tx, task.id, actorId);
    await completeTask(tx, {
      taskId: task.id,
      result: action === "return" ? ReviewResult.RETURNED : ReviewResult.REJECTED,
      comment: note,
      commentVisibility: CommentVisibility.ORGANIZATION,
      actorId,
    });
    await tx.representativeChangeRequest.update({
      where: { id: requestId },
      data:
        action === "return"
          ? { status: RepresentativeChangeStatus.RETURNED, updatedBy: actorId }
          : {
              status: RepresentativeChangeStatus.REJECTED,
              rejectedAt: new Date(),
              rejectedBy: actorId,
              updatedBy: actorId,
            },
    });
    if (action === "reject") await closeItems(tx, requestId, actorId);
    return row;
  });
  await logAudit({
    action:
      action === "return"
        ? AuditAction.REPRESENTATIVE_CHANGE_RETURNED
        : AuditAction.REPRESENTATIVE_CHANGE_REJECTED,
    subjectType: AuditSubject.REPRESENTATIVE_CHANGE_REQUEST,
    subjectId: requestId,
    organizationId: request.organizationId,
    metadata: { note },
  });
  const members = await organizationMemberIds(request.organizationId);
  await notifyUsers(members.users, {
    type:
      action === "return"
        ? NotificationType.REPRESENTATIVE_CHANGE_RETURNED
        : NotificationType.REPRESENTATIVE_CHANGE_REJECTED,
    title:
      action === "return"
        ? `คำขอ ${request.requestNumber} ถูกส่งกลับแก้ไข`
        : `คำขอ ${request.requestNumber} ถูกปฏิเสธ`,
    message: note,
    subjectType: SUBJECT,
    subjectId: requestId,
    organizationId: request.organizationId,
  });
}

/** ลองใหม่เฉพาะรายการที่ค้าง — ออกคีย์ใหม่ (`issueActivationKey()` เพิกถอนใบเดิมเอง) แล้วส่งอีกครั้ง */
async function retryRequest(requestId: string, actorId: string) {
  const row = await loadChangeRequest(prisma, requestId);
  if (!row) throw new WorkflowError("not_found", "ไม่พบคำขอนี้", 404);
  if (!canRetry(row)) throw new WorkflowError("nothing_to_retry", "คำขอนี้ไม่มีรายการให้ลองใหม่", 409);

  const { invitations, revokedKeys } = await prisma.$transaction(async (tx) => {
    const moved = await tx.representativeChangeRequest.updateMany({
      where: {
        id: requestId,
        status: { in: [RepresentativeChangeStatus.PROCESSING_FAILED, RepresentativeChangeStatus.PROCESSING] },
        updatedAt: row.updatedAt,
      },
      data: { status: RepresentativeChangeStatus.PROCESSING, updatedBy: actorId },
    });
    if (moved.count === 0) throw new WorkflowError("task_closed", "มีผู้ใช้ท่านอื่นสั่งลองใหม่ไปแล้ว", 409);
    const issuedAll: InvitationToSend[] = [];
    const revoked: RevokedKey[] = [];
    for (const addition of row.additions) {
      const pending =
        addition.status === RepresentativeAdditionStatus.FAILED ||
        addition.status === RepresentativeAdditionStatus.PROCESSING;
      if (!pending || !addition.activationKeyId) continue;
      const key = await tx.activationKey.findUniqueOrThrow({
        where: { id: addition.activationKeyId },
        select: { userAccountId: true },
      });
      const roleCode = addition.role.code as RoleCode;
      const issued = await issueActivationKey(tx, {
        userAccountId: key.userAccountId,
        organizationId: row.organizationId,
        roleCode,
        actorId,
      });
      await tx.representativeChangeAddition.update({
        where: { id: addition.id },
        data: { status: RepresentativeAdditionStatus.PROCESSING, activationKeyId: issued.record.id, updatedBy: actorId },
      });
      revoked.push(...issued.revokedKeys);
      issuedAll.push({
        additionId: addition.id,
        email: addition.userEmail!,
        key: issued.key,
        expiresAt: issued.record.expiresAt,
        roleCode,
        activationKeyId: issued.record.id,
        userAccountId: key.userAccountId,
      });
    }
    return { invitations: issuedAll, revokedKeys: revoked };
  });
  await logKeysRevoked(revokedKeys, { revokedVia: "REPRESENTATIVE_CHANGE" });
  const outcome = await deliverInvitations(requestId, row, invitations, actorId);
  await announceOutcome(row, outcome, [], actorId);
  return outcome;
}

const reviewSchema = z
  .object({
    action: z.enum(["confirm", "return", "reject"], { error: "กรุณาเลือกผลการตรวจสอบ" }),
    note: z.string().trim().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.action !== "confirm" && (value.note?.length ?? 0) < 10) {
      ctx.addIssue({ code: "custom", path: ["note"], message: "กรุณาระบุเหตุผลอย่างน้อย 10 ตัวอักษร" });
    }
  });

async function handleReview(req: Request, res: Response, actorId: string) {
  const parsedId = z.string().uuid().safeParse(req.params.id);
  const parsed = reviewSchema.safeParse(req.body ?? {});
  if (!parsedId.success) {
    notFound(res);
    return;
  }
  if (!parsed.success) {
    res.status(400).json({ error: "validation", fields: formatZodError(parsed.error) });
    return;
  }
  const { action, note } = parsed.data;
  try {
    if (action === "confirm") {
      const outcome = await confirmRequest(parsedId.data, actorId, note);
      res.json({ status: outcome.status, failedEmails: outcome.failed });
      return;
    }
    await returnOrReject(parsedId.data, action, actorId, note!);
    res.json({ ok: true });
  } catch (err) {
    if (answerWorkflowError(res, err)) return;
    throw err;
  }
}

async function handleRetry(req: Request, res: Response, actorId: string) {
  const parsedId = z.string().uuid().safeParse(req.params.id);
  if (!parsedId.success) {
    notFound(res);
    return;
  }
  try {
    const outcome = await retryRequest(parsedId.data, actorId);
    res.json({ status: outcome.status, failedEmails: outcome.failed });
  } catch (err) {
    if (answerWorkflowError(res, err)) return;
    throw err;
  }
}

function requireOfficer(req: Request, res: Response): boolean {
  if (isOfficer(req.session!)) return true;
  res.status(403).json({ error: "forbidden", message: "เฉพาะผู้ประสานงานของ BDI เท่านั้นที่ตรวจคำขอนี้ได้" });
  return false;
}

representativeChangeRouter.post("/:id/open", async (req, res) => {
  if (!requireOfficer(req, res)) return;
  const parsedId = z.string().uuid().safeParse(req.params.id);
  if (!parsedId.success) {
    notFound(res);
    return;
  }
  await openForReview(parsedId.data, req.session!.sub);
  res.json({ ok: true });
});

representativeChangeRouter.post("/:id/review", async (req, res) => {
  if (!requireOfficer(req, res)) return;
  await handleReview(req, res, req.session!.sub);
});

representativeChangeRouter.post("/:id/retry", async (req, res) => {
  if (!requireOfficer(req, res)) return;
  await handleRetry(req, res, req.session!.sub);
});

// ---------------------------------------------------------------- ผู้ดูแลระบบ

adminRepresentativeChangeRouter.get("/", async (req, res) => {
  const query = pageSchema.parse(req.query);
  res.json(await listRequests({ organizationId: query.organizationId, roles: [] }, query));
});

adminRepresentativeChangeRouter.get("/:id", async (req, res) => {
  const parsed = z.string().uuid().safeParse(req.params.id);
  const request = parsed.success ? await loadChangeRequest(prisma, parsed.data) : null;
  if (!request) {
    notFound(res);
    return;
  }
  res.json({
    request: await detailOf(request, { bdiView: true, canEdit: false, canReview: reviewable(request.status) }),
  });
});

adminRepresentativeChangeRouter.post("/:id/review", async (req, res) => {
  await handleReview(req, res, adminActorId());
});

adminRepresentativeChangeRouter.post("/:id/retry", async (req, res) => {
  await handleRetry(req, res, adminActorId());
});
