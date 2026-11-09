/**
 * ยกเลิกคำขอลงทะเบียนหน่วยงาน — ตัวเดียวที่ทั้งปุ่ม "ยกเลิกคำขอ" ของผู้ดูแลระบบ
 * (`POST /api/admin/registrations/organizations/:id/cancel`) และการเปลี่ยนผู้ประสานงาน
 * (`/api/admin/users` ยุติบัญชี · ถอนบทบาท · ย้าย) ใช้ร่วมกัน ผลกับคำขอจึงเหมือนกันทุกอย่าง
 * ต่างกันแค่ต้นเหตุที่เขียนลง `cancelled_via`
 *
 * แยกเป็นสองครึ่งตามธรรมเนียมของ audit (CLAUDE.md "Audit rows come before the mail is queued"):
 * `cancelOrganizationRequest()` ทำงานใน transaction ของผู้เรียก ส่วน `recordCancelledRegistration()`
 * เขียน audit คีย์ที่ถูกเพิกถอน และการแจ้งเตือน **หลัง commit**
 */
import {
  Prisma,
  RequestStatus,
  SubjectType,
  type OrganizationRegistrationRequest,
  type ReviewTaskType,
} from "@prisma/client";

import { releaseApproverSeat, type ReleasedSeat } from "./approver-seat.js";
import { AuditAction, AuditSubject, logAudit } from "./audit.js";
import { adminActorId } from "./context.js";
import { activatedApprover, logKeysRevoked } from "./iam.js";
import { NotificationType, notifyUsers, organizationMemberIds, submitterIfMember } from "./notify.js";
import { cancelActiveTask, deriveRequestStatus } from "./workflow.js";

const ORG_SUBJECT = SubjectType.ORGANIZATION_REGISTRATION_REQUEST;

/**
 * คำขอที่ "ยังไม่จบ" — ชุดเดียวกับที่ `POST /api/organizations` ใช้ตัดสินว่าหน่วยงานมีคำขอค้างอยู่
 * (`notIn: [APPROVED, REJECTED, CANCELLED]`) ใบที่ยกเลิกตามชุดนี้แล้ว ผู้ประสานงานคนใหม่จึงเปิดใบใหม่ได้ทันที
 */
export const OPEN_REGISTRATION_STATUSES: RequestStatus[] = [
  RequestStatus.DRAFT,
  RequestStatus.SUBMITTED,
  RequestStatus.UNDER_REVIEW,
  RequestStatus.RETURNED,
];

export type ApproverOutcome =
  | "NONE"
  | "INVITATION_REVOKED"
  | "ACCOUNT_DELETED"
  | "KEPT_ACTIVE"
  | "DEACTIVATED";

export function approverOutcomeCode(
  approver: { id: string } | null,
  isRemoveApprover: boolean,
  seat: ReleasedSeat | null,
): ApproverOutcome {
  if (approver) return isRemoveApprover ? "DEACTIVATED" : "KEPT_ACTIVE";
  if (!seat) return "NONE";
  return seat.accountDeleted ? "ACCOUNT_DELETED" : "INVITATION_REVOKED";
}

type CancellableRequest = Pick<
  OrganizationRegistrationRequest,
  "id" | "requestNumber" | "organizationId" | "status" | "submittedAt" | "approverEmail" | "createdBy"
>;

export interface CancelledRegistration {
  /** คำขอก่อนยกเลิก — `before` ของ audit */
  request: CancellableRequest;
  updated: OrganizationRegistrationRequest;
  cancelledTask: { id: string; taskType: ReviewTaskType } | null;
  approver: { id: string; email: string; cid: string | null } | null;
  releasedSeat: ReleasedSeat | null;
}

/**
 * ปิดคำขอหนึ่งใบเป็น `CANCELLED` — แถวและ `review_task` ทุกแถวยังอยู่ ทางกลับคือ reset
 *
 * ที่นั่งผู้มีอำนาจฯ: ยังไม่เปิดใช้งาน → `releaseApproverSeat()` ปล่อยคำเชิญและบัญชี PENDING ที่ยึดอีเมลกับเลขบัตรไว้
 * (คำขอที่ปิดแล้วไม่มีใครต้องลงนามอีก) เปิดใช้งานแล้ว → ไม่แตะ ถอดคนนั้นเป็นคำสั่งที่ผู้ดูแลต้องสั่งเองตั้งใจ
 */
export async function cancelOrganizationRequest(
  tx: Prisma.TransactionClient,
  request: CancellableRequest,
  reason: string,
): Promise<CancelledRegistration> {
  const approver = await activatedApprover(tx, request);
  const taskIds = (
    await tx.reviewTask.findMany({
      where: { subjectType: ORG_SUBJECT, subjectId: request.id },
      select: { id: true },
    })
  ).map((t) => t.id);

  const cancelled = await cancelActiveTask(tx, {
    subjectType: ORG_SUBJECT,
    subjectId: request.id,
    actorId: adminActorId(),
    reason,
  });
  const releasedSeat = approver
    ? null
    : await releaseApproverSeat(tx, {
        email: request.approverEmail,
        organizationId: request.organizationId,
        taskIds,
        actorId: adminActorId(),
        reason,
      });
  await tx.organizationRegistrationRequest.update({
    where: { id: request.id },
    data: {
      cancelledAt: new Date(),
      cancelledBy: adminActorId(),
      cancellationReason: reason,
      updatedBy: adminActorId(),
    },
  });
  const status = await deriveRequestStatus(tx, {
    subjectType: ORG_SUBJECT,
    subjectId: request.id,
    hasSubmitted: Boolean(request.submittedAt),
    cancelled: true,
  });
  const updated = await tx.organizationRegistrationRequest.update({
    where: { id: request.id },
    data: { status, updatedBy: adminActorId() },
  });
  return {
    request,
    updated,
    cancelledTask: cancelled ? { id: cancelled.id, taskType: cancelled.taskType } : null,
    approver,
    releasedSeat,
  };
}

/**
 * ยกเลิกคำขอที่ยังไม่จบทุกใบของหน่วยงานที่ผู้ประสานงานเพิ่งถูกเอาออก (Admin Action Effect › Issue
 * "ถ้า admin เปลี่ยน organization officer ตัว organization request ที่ค้างอยู่จะตีเป็นยกเลิกไปเลย", 2026-11-09)
 *
 * คำตอบของคำถามที่การ์ด 261101-01 ทิ้งไว้: คำขอที่ยื่นโดยผู้ประสานงานคนเดิมไม่เดินต่อด้วยชื่อคนเดิม ผู้ประสานงานคนใหม่
 * เริ่มใบใหม่เอง ก่อนหน่วยงานเปิดใช้งาน ที่นั่งผู้ประสานงานมีหนึ่งที่ และคำเชิญคนใหม่ติดที่นั่งจนกว่าคนเดิมจะออก — การเอา
 * คนเดิมออกจึงเป็นจุดเดียวที่การเปลี่ยนตัวเกิดขึ้น ไม่ต้องรอดูว่าใครเข้ามาแทน
 *
 * ล็อกแถวคำขอ `FOR UPDATE` ก่อนอ่านสถานะ: การนำส่งหรือการอนุมัติที่กำลังเขียนแถวเดียวกันอยู่จะ commit ก่อน แล้ว
 * การอ่านข้างล่างเห็นค่าล่าสุด — ใบที่เพิ่งอนุมัติหลุดจากชุด และด่านที่เพิ่งเปิดถูกปิดไปด้วย ไม่ใช่ยกเลิกใบที่อนุมัติไปแล้ว
 * หรือปล่อยด่านค้างไว้บนใบที่ยกเลิก
 */
export async function cancelOpenRegistrations(
  tx: Prisma.TransactionClient,
  params: { organizationIds: string[]; reason: string },
): Promise<CancelledRegistration[]> {
  const organizationIds = [...new Set(params.organizationIds)];
  if (organizationIds.length === 0) return [];

  await tx.$queryRaw`
    SELECT id FROM organization.organization_registration_request
    WHERE organization_id = ANY(${organizationIds}::uuid[])
    FOR UPDATE`;
  const open = await tx.organizationRegistrationRequest.findMany({
    where: { organizationId: { in: organizationIds }, status: { in: OPEN_REGISTRATION_STATUSES } },
    select: {
      id: true,
      requestNumber: true,
      organizationId: true,
      status: true,
      submittedAt: true,
      approverEmail: true,
      createdBy: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const outcomes: CancelledRegistration[] = [];
  for (const request of open) {
    outcomes.push(await cancelOrganizationRequest(tx, request, params.reason));
  }
  return outcomes;
}

/**
 * ครึ่งหลัง commit — `REQUEST_CANCELLED` ต่อใบ, การเรียกคืนคำเชิญผู้มีอำนาจฯ, คีย์ที่ถูกเพิกถอน และการแจ้งเตือน
 *
 * ผู้รับ: ผู้ประสานงานที่ยังอยู่ของหน่วยงาน และผู้สร้างคำขอถ้ายังเป็นสมาชิก (`submitterIfMember()` — คนที่ถูกเอาออก
 * ไม่ได้รับ) `includeApprovers` เพิ่มผู้มีอำนาจฯ ที่เปิดบัญชีแล้ว: ตอนเปลี่ยนผู้ประสานงานมักไม่เหลือผู้ประสานงานให้แจ้ง
 * และผู้มีอำนาจฯ ที่กำลังจะลงนามคือคนที่ต้องรู้ว่าไม่ต้องลงนามแล้ว ฝั่ง BDI ไม่ได้รับแจ้ง เหมือน reset — งานหายจากคิวเอง
 */
export async function recordCancelledRegistration(
  outcome: CancelledRegistration,
  params: {
    reason: string;
    /** `cancelled_via` ของ `REQUEST_CANCELLED` */
    via: string;
    /** `recalled_via` / `revokedVia` ของแถวผู้มีอำนาจฯ — ปุ่มยกเลิกคำขอเขียน `ADMIN_CANCEL_API` มาตั้งแต่ก่อนแยกไฟล์นี้ */
    recalledVia: string;
    metadata?: Record<string, unknown>;
    message: string;
    includeApprovers?: boolean;
  },
) {
  const { request, updated, cancelledTask, approver, releasedSeat: seat } = outcome;
  await logAudit({
    action: AuditAction.REQUEST_CANCELLED,
    subjectType: AuditSubject.ORGANIZATION_REGISTRATION_REQUEST,
    subjectId: request.id,
    organizationId: request.organizationId,
    before: { status: request.status },
    after: { status: updated.status },
    metadata: {
      reason: params.reason,
      cancelled_via: params.via,
      request_number: request.requestNumber,
      cancelled_task_type: cancelledTask?.taskType ?? null,
      approver_outcome: approverOutcomeCode(approver, false, seat),
      ...params.metadata,
    },
  });
  if (seat) {
    await logAudit({
      action: AuditAction.APPROVER_INVITATION_RECALLED,
      subjectType: AuditSubject.ORGANIZATION_REGISTRATION_REQUEST,
      subjectId: request.id,
      organizationId: request.organizationId,
      before: { email: seat.email, cid: seat.cid, displayName: seat.displayName, status: seat.status },
      after: { accountDeleted: seat.accountDeleted, keptBecause: seat.keptBecause ?? undefined },
      metadata: { reason: params.reason, recalled_via: params.recalledVia },
    });
  }
  await logKeysRevoked(seat?.revokedKeys ?? [], { revokedVia: params.recalledVia });

  const members = await organizationMemberIds(request.organizationId);
  await notifyUsers(
    [
      ...members.users,
      ...(params.includeApprovers ? members.approvers : []),
      submitterIfMember(request.createdBy, members),
    ],
    {
      type: NotificationType.REQUEST_CANCELLED,
      title: "คำขอลงทะเบียนหน่วยงานถูกยกเลิก",
      message: params.message,
      subjectType: ORG_SUBJECT,
      subjectId: request.id,
      organizationId: request.organizationId,
    },
  );
}
