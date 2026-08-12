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
  RoleAssignmentStatus,
  UserAccountStatus,
} from "@prisma/client";

import { prisma } from "../db.js";
import { correlationId } from "./context.js";
import { activeAssignmentWhere } from "./iam.js";
import { ROLE_CODES, type RoleCode } from "./system.js";

/** notification type code ตามตัวอย่างในภาพของ sheet `notification` */
export const NotificationType = {
  USER_ACTIVATION_INVITATION: "USER_ACTIVATION_INVITATION",
  USER_REGISTRATION_COMPLETED: "USER_REGISTRATION_COMPLETED",
  ROLE_ASSIGNMENT_CHANGED: "ROLE_ASSIGNMENT_CHANGED",
  REQUEST_SUBMITTED: "REQUEST_SUBMITTED",
  REQUEST_RETURNED: "REQUEST_RETURNED",
  REQUEST_APPROVED: "REQUEST_APPROVED",
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
