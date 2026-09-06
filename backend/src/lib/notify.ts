/**
 * In-app notification + outbox — schema `notification`
 *
 * เปลี่ยนจากของเดิมสองเรื่อง:
 *
 * 1. `notification` มี subject_type/subject_id/correlation_id และ status
 *    (UNREAD/READ/ARCHIVED) แทน readAt แบบ nullable · คอลัมน์ `link` หายไปจากดีไซน์
 *    → derive ลิงก์จาก subject แทน (linkFor() ท้ายไฟล์)
 *
 * 2. `notification_delivery` เป็น **outbox queue** — การส่งอีเมลไม่เกิดขึ้นในตัว
 *    request handler อีกต่อไป แต่เขียนแถวรอไว้ให้ worker หยิบไปส่ง
 *    (ดู src/workers/delivery.ts)
 *
 * ภาพใน sheet `notification_delivery` ระบุว่า notification ที่แสดงในระบบอ่านจาก
 * ตาราง notification โดยตรง จึงไม่ต้องสร้าง delivery ที่ channel = IN_APP
 */
import {
  DeliveryChannel,
  DeliveryStatus,
  NotificationStatus,
  ReviewTaskStatus,
  ReviewTaskType,
  RoleAssignmentStatus,
  SubjectType,
  UserAccountStatus,
} from "@prisma/client";

import { prisma } from "../db.js";
import { AuditAction, AuditSubject, logAudit } from "./audit.js";
import { buildJourneyProgress, type JourneyProgress } from "./journey-steps.js";
import { correlationId } from "./context.js";
import { activeAssignmentWhere, type RevokedAssignment } from "./iam.js";
import { ROLE_LABELS } from "./roles.js";
import { ROLE_CODES, type RoleCode } from "./system.js";

/** notification type code ตามตัวอย่างในภาพของ sheet `notification` */
export const NotificationType = {
  USER_ACTIVATION_INVITATION: "USER_ACTIVATION_INVITATION",
  USER_REGISTRATION_COMPLETED: "USER_REGISTRATION_COMPLETED",
  ROLE_ASSIGNMENT_CHANGED: "ROLE_ASSIGNMENT_CHANGED",
  REQUEST_SUBMITTED: "REQUEST_SUBMITTED",
  REQUEST_RETURNED: "REQUEST_RETURNED",
  REQUEST_APPROVED: "REQUEST_APPROVED",
  /**
   * คำขอเดินหน้าไปอีกด่านหนึ่ง
   *
   * ไม่ได้อยู่ในรายการชนิดตัวอย่างของ sheet `notification` แต่ต้องมี — เดิมทุกด่านที่ผ่าน
   * แจ้งแต่ "คนต่อไปที่ต้องทำ" ผู้ยื่นคำขอจึงเงียบไปทั้งกระบวนการ แล้วได้ยินข่าวอีกที
   * ตอนถูกส่งกลับหรืออนุมัติจบ ซึ่งอ่านเหมือนคำขอหายไปหลายวัน
   */
  REQUEST_PROGRESSED: "REQUEST_PROGRESSED",
  REQUEST_REJECTED: "REQUEST_REJECTED",
  SPECIALIST_ASSIGNED: "SPECIALIST_ASSIGNED",
  SLA_REMINDER: "SLA_REMINDER",
  LEGAL_DOCUMENT_UPDATED: "LEGAL_DOCUMENT_UPDATED",
} as const;

export type NotificationTypeCode = (typeof NotificationType)[keyof typeof NotificationType];

interface NotifyInput {
  type: NotificationTypeCode;
  title: string;
  message: string;
  subjectType?: string | null;
  subjectId?: string | null;
  organizationId?: string | null;
  /**
   * ส่งอีเมลด้วยหรือไม่ (ค่าเริ่มต้น: ส่ง)
   *
   * สร้างแถวใน notification_delivery ให้ worker หยิบไปส่ง — ไม่ส่งเองตรงนี้
   * เนื้ออีเมลไม่ได้ถูกเก็บลงตาราง worker เป็นคนประกอบตอนส่ง (workers/render.ts)
   * ตั้ง false สำหรับข้อความที่ไม่ควรออกไปทางอีเมล
   */
  email?: boolean;
}

/**
 * สร้าง notification ให้หลายคนพร้อมกัน (ตัด id ซ้ำและค่าว่างออกให้)
 *
 * ผู้รับที่สถานะยัง PENDING ก็รับได้ — ภาพใน sheet `notification` ระบุไว้ชัด
 * ("recipient_user_id ต้องอ้างอิง User Account ที่มีอยู่ในระบบ รวมถึง Account ที่มีสถานะ PENDING")
 */
export async function notifyUsers(userIds: Array<string | null | undefined>, input: NotifyInput) {
  const unique = [...new Set(userIds.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return;

  const correlation = correlationId();

  const recipients = await prisma.userAccount.findMany({
    where: { id: { in: unique } },
    select: { id: true, email: true },
  });

  await prisma.$transaction(async (tx) => {
    for (const recipient of recipients) {
      const notification = await tx.notification.create({
        data: {
          recipientUserId: recipient.id,
          notificationType: input.type,
          title: input.title,
          message: input.message,
          subjectType: input.subjectType ?? null,
          subjectId: input.subjectId ?? null,
          organizationId: input.organizationId ?? null,
          status: NotificationStatus.UNREAD,
          correlationId: correlation,
        },
      });

      if (input.email !== false) {
        await tx.notificationDelivery.create({
          data: {
            notificationId: notification.id,
            channel: DeliveryChannel.EMAIL,
            destination: recipient.email,
            status: DeliveryStatus.PENDING,
            scheduledAt: new Date(),
            correlationId: correlation,
          },
        });
      }
    }
  });
}

/**
 * ประกาศว่ามีคนถูกถอดออกจากหน่วยงานเพราะมีคนมารับ role แทน — audit + แจ้งเจ้าตัว
 *
 * `assignRole()` บังคับกติกา "หนึ่งหน่วยงานมี ORGANIZATION_USER / ORGANIZATION_APPROVER
 * ที่ ACTIVE ได้อย่างละคน" ด้วยการเพิกถอนคนเดิม เดิมทีการเพิกถอนนั้นเขียนแค่
 * `revocation_reason` ลงแถวเดียว ไม่มี audit_event และไม่มีใครบอกเจ้าตัว — คนที่ถูกถอด
 * รู้ตัวอีกทีตอนล็อกอินแล้วหน่วยงานหายไป (เกิดจริงบน main 2026-08-24)
 *
 * **ต้องเรียกหลัง transaction commit แล้วเท่านั้น** ทั้ง logAudit และ notifyUsers เขียน
 * ผ่าน prisma ตัวหลัก ไม่ใช่ tx ที่มอบ role ให้คนใหม่ เรียกจากในนั้นแล้ว rollback จะเหลือ
 * audit event กับอีเมลของเหตุการณ์ที่ไม่เคยเกิดขึ้น
 *
 * subject ของ notification คือ **แถว assignment ที่ถูกเพิกถอน** ไม่ใช่หน่วยงาน เพราะ
 * worker ต้องประกอบอีเมลจากมันตอนส่ง (workers/render.ts) และมันคือที่เดียวที่มีทั้ง
 * หน่วยงาน role และเวลาที่ถูกถอดครบในแถวเดียว
 */
export async function announceRoleReplacement(replaced: RevokedAssignment[]): Promise<void> {
  for (const assignment of replaced) {
    const row = await prisma.userRoleAssignment.findUnique({
      where: { id: assignment.id },
      select: {
        id: true,
        userAccountId: true,
        organizationId: true,
        revokedAt: true,
        revokedBy: true,
        organization: { select: { nameTh: true } },
        role: { select: { code: true } },
      },
    });
    if (!row) continue;

    const roleLabel = ROLE_LABELS[row.role.code as RoleCode] ?? row.role.code;
    const organizationName = row.organization?.nameTh ?? "หน่วยงานเดิมของคุณ";

    await logAudit({
      action: AuditAction.ROLE_REVOKED,
      subjectType: AuditSubject.USER_ROLE_ASSIGNMENT,
      subjectId: row.id,
      organizationId: row.organizationId,
      metadata: {
        reason: "REPLACED_BY_NEW_HOLDER",
        role_code: row.role.code,
        // เก็บ id ของคนที่ถูกถอดไว้ด้วย — subject คือแถว assignment ไม่ใช่ตัวบุคคล
        revoked_user_account_id: row.userAccountId,
      },
    });

    await notifyUsers([row.userAccountId], {
      type: NotificationType.ROLE_ASSIGNMENT_CHANGED,
      title: "บัญชีของคุณถูกถอดออกจากหน่วยงาน",
      message:
        `ผู้ดูแลระบบได้มอบหน้าที่ ${roleLabel} ของ ${organizationName} ให้เจ้าหน้าที่คนใหม่แทน ` +
        `บัญชีของคุณจึงไม่ได้สังกัดหน่วยงานใดในระบบขณะนี้ ` +
        `หากคิดว่าไม่ถูกต้อง โปรดติดต่อผู้ดูแลระบบ BDI เพื่อขอสิทธิ์ในหน่วยงานเดิมคืน`,
      subjectType: AuditSubject.USER_ROLE_ASSIGNMENT,
      subjectId: row.id,
      organizationId: row.organizationId,
    });
  }
}

/** id ของผู้ใช้ที่ ACTIVE และถือ role ที่กำหนดอยู่จริง ณ ตอนนี้ */
async function activeIdsWithRole(roleCode: RoleCode): Promise<string[]> {
  const rows = await prisma.userRoleAssignment.findMany({
    where: {
      ...activeAssignmentWhere(),
      role: { code: roleCode, isActive: true },
      userAccount: { status: UserAccountStatus.ACTIVE },
    },
    select: { userAccountId: true },
  });
  return [...new Set(rows.map((r) => r.userAccountId))];
}

export const bdiOfficerIds = () => activeIdsWithRole(ROLE_CODES.BDI_OFFICER);
export const bdiApproverIds = () => activeIdsWithRole(ROLE_CODES.BDI_FINAL_APPROVER);
export const bdiSpecialistIds = () => activeIdsWithRole(ROLE_CODES.BDI_DATASET_SPECIALIST);
export const bdiLegalOfficerIds = () => activeIdsWithRole(ROLE_CODES.BDI_LEGAL_OFFICER);

/**
 * ผู้ใช้ของหน่วยงานหนึ่ง แยกตาม role
 *
 * ของเดิมต้องหาผู้มีอำนาจสองทาง (organizationId หรืออีเมลตรงกับ signatoryEmail)
 * เพราะ role ยังผูกกับตาราง user โดยตรง แบบใหม่ทุกอย่างอยู่ที่ user_role_assignment
 * ที่มี organization_id ในตัว จึง query ทางเดียวจบ
 */
export async function organizationMemberIds(organizationId: string): Promise<{
  users: string[];
  approvers: string[];
}> {
  const assignments = await prisma.userRoleAssignment.findMany({
    where: {
      organizationId,
      ...activeAssignmentWhere(),
      userAccount: { status: UserAccountStatus.ACTIVE },
    },
    select: { userAccountId: true, role: { select: { code: true } } },
  });

  return {
    users: assignments
      .filter((a) => a.role.code === ROLE_CODES.ORGANIZATION_USER)
      .map((a) => a.userAccountId),
    approvers: assignments
      .filter((a) => a.role.code === ROLE_CODES.ORGANIZATION_APPROVER)
      .map((a) => a.userAccountId),
  };
}

/**
 * stakeholders ของคำขอหนึ่งฉบับ
 * ผู้สร้าง + ผู้ใช้และผู้มีอำนาจของหน่วยงาน + BDI officer/approver ทุกคน
 * + ผู้เชี่ยวชาญที่ถือ task อยู่
 */
export async function requestStakeholderIds(request: {
  organizationId: string;
  createdBy: string;
  assignedUserIds?: string[];
}): Promise<string[]> {
  const [members, officers, approvers] = await Promise.all([
    organizationMemberIds(request.organizationId),
    bdiOfficerIds(),
    bdiApproverIds(),
  ]);

  return [
    ...new Set([
      request.createdBy,
      ...members.users,
      ...members.approvers,
      ...officers,
      ...approvers,
      ...(request.assignedUserIds ?? []),
    ]),
  ];
}

/**
 * แจ้งฝั่งหน่วยงานว่าคำขอเดินไปถึงด่านไหนแล้ว
 *
 * เรียก **หลัง transaction commit** เพราะอ่านสถานะที่เพิ่งเปลี่ยนจาก prisma ตัวหลัก
 * ไม่ใช่จาก tx ที่ทำ transition
 *
 * ผู้มีอำนาจลงนามถูกตัดออกเมื่อด่านใหม่คือด่านของเขาเอง — เขาได้อีเมล "รอคุณลงนาม"
 * ฉบับตรงกว่านั้นอยู่แล้ว การส่งซ้ำสองฉบับเรื่องเดียวกันในนาทีเดียวกันทำให้ฉบับที่มีปุ่ม
 * ให้กดกลายเป็นฉบับที่ถูกมองข้าม
 */
export async function announceProgress(params: {
  subjectType: SubjectType;
  subjectId: string;
  organizationId: string;
  createdBy: string;
  /** ชื่อที่ผู้รับใช้เรียกคำขอนี้ เช่นชื่อหน่วยงานหรือชื่อชุดข้อมูล + เลขที่คำขอ */
  subjectLabel: string;
}): Promise<JourneyProgress | null> {
  const [request, tasks, active] = await Promise.all([
    params.subjectType === SubjectType.ORGANIZATION_REGISTRATION_REQUEST
      ? prisma.organizationRegistrationRequest.findUnique({
          where: { id: params.subjectId },
          select: { status: true },
        })
      : prisma.datasetRegistrationRequest.findUnique({
          where: { id: params.subjectId },
          select: { status: true },
        }),
    prisma.reviewTask.findMany({
      where: { subjectType: params.subjectType, subjectId: params.subjectId },
      orderBy: { sequenceNumber: "asc" },
      select: {
        id: true,
        taskType: true,
        sequenceNumber: true,
        roundNumber: true,
        status: true,
        result: true,
        completedAt: true,
      },
    }),
    prisma.reviewTask.findFirst({
      where: {
        subjectType: params.subjectType,
        subjectId: params.subjectId,
        status: { in: [ReviewTaskStatus.PENDING, ReviewTaskStatus.IN_PROGRESS] },
      },
      select: {
        id: true,
        taskType: true,
        sequenceNumber: true,
        roundNumber: true,
        status: true,
        result: true,
        completedAt: true,
      },
    }),
  ]);
  if (!request) return null;

  const progress = buildJourneyProgress({
    subjectType: params.subjectType,
    status: request.status,
    tasks,
    active,
  });

  /**
   * ไม่มีด่านใหม่เปิดขึ้น = ไม่ได้เดินหน้าไปไหน (จบแล้ว ถูกส่งกลับ หรือไม่อนุมัติ)
   * สามกรณีนั้นมี notification ของตัวเองอยู่แล้ว
   *
   * ตั้งแต่ขั้น "นำส่งคำขอ" เข้ามาเป็นขั้นที่ 1 คำขอที่ **ถูกส่งกลับ** ก็มีขั้นปัจจุบัน
   * แล้ว (ขั้นที่ 1 รอหน่วยงานนำส่งใหม่) ลำพัง `currentStep` จึงไม่ใช่คำตอบของ
   * "เดินหน้าหรือยัง" อีกต่อไป — ขั้นที่ไม่มี `taskType` แปลว่าไม่มีใครเปิดด่านอะไรขึ้นมา
   * ถ้าไม่กันไว้ ใบที่เพิ่งถูกส่งกลับจะได้อีเมล "คำขอของคุณเดินหน้าไปอีกขั้น" ตามหลัง
   * อีเมลแจ้งให้แก้ไข ซึ่งบอกตรงข้ามกับความจริง
   */
  const step = progress.currentStep;
  if (!step || !step.order || step.taskType === null) return progress;

  const members = await organizationMemberIds(params.organizationId);
  const recipients = [
    ...members.users,
    params.createdBy,
    ...(step.taskType === ReviewTaskType.ORGANIZATION_APPROVAL ? [] : members.approvers),
  ];

  await notifyUsers(recipients, {
    type: NotificationType.REQUEST_PROGRESSED,
    title: "คำขอของคุณเดินหน้าไปอีกขั้น",
    message:
      `${params.subjectLabel} — ขณะนี้อยู่ขั้นที่ ${step.order} จาก ${progress.totalSteps}: ` +
      `${step.waitingLabel}` +
      (progress.nextStep ? ` · ขั้นต่อไป: ${progress.nextStep.label}` : ""),
    subjectType: params.subjectType,
    subjectId: params.subjectId,
    organizationId: params.organizationId,
  });

  // ผู้เรียกใช้ต่อกับอีเมลที่ส่งตรง (ไม่ผ่านคิว) เพื่อไม่ต้องคำนวณเส้นทางซ้ำ
  return progress;
}

/** อีเมลของผู้ใช้ตาม id — ใช้ส่งเมลให้ชุดเดียวกับที่แจ้งเตือนในระบบ */
export async function emailsOf(userIds: string[]): Promise<string[]> {
  if (userIds.length === 0) return [];
  const users = await prisma.userAccount.findMany({
    where: { id: { in: userIds }, status: UserAccountStatus.ACTIVE },
    select: { email: true },
  });
  return users.map((u) => u.email);
}

/**
 * ลิงก์ในแอปของ notification หนึ่งรายการ
 *
 * ดีไซน์ตัดคอลัมน์ `link` ออก เหลือแต่ subject_type/subject_id จึงต้อง derive เอง
 * เก็บ path ภายในแอปเท่านั้น ไม่เก็บ URL เต็มเพราะโดเมนเปลี่ยนได้
 */
export function linkFor(subjectType: string | null, subjectId: string | null): string | null {
  if (!subjectType || !subjectId) return null;
  switch (subjectType) {
    case "ORGANIZATION_REGISTRATION_REQUEST":
      return `/organizations/${subjectId}`;
    case "DATASET_REGISTRATION_REQUEST":
      return `/datasets/${subjectId}`;
    case "DATASET":
      return `/datasets/${subjectId}`;
    default:
      return null;
  }
}

export { RoleAssignmentStatus };
