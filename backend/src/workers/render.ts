/**
 * ประกอบเนื้ออีเมลตอนจะส่ง — ไม่ใช่ตอนสร้าง notification
 *
 * ภาพใน sheet `notification_delivery` เขียนไว้ว่า
 *   "Sensitive Token หรือ Credential ห้ามเก็บในรูป Plain Text"
 *   "หาก Message Body มี Activation Token ต้องจัดเก็บ Payload แบบเข้ารหัส
 *    หรือออกแบบให้ Worker สามารถสร้าง Payload ที่ปลอดภัยขณะส่ง"
 *
 * เลือกทางหลัง: ตาราง delivery ไม่มีคอลัมน์ body เลย worker อ่าน subject_type/subject_id
 * จาก notification แล้วไป query ข้อมูลสดมาประกอบ template เอง
 * ผลพลอยได้คือ template ที่แก้ทีหลังมีผลกับอีเมลที่ยังค้างในคิวด้วย
 *
 * activation key ไม่เดินทางผ่านคิวนี้ — routes/admin.ts กับ routes/organizations.ts
 * ส่งอีเมลคำเชิญเองทันทีเพราะ raw key มีอยู่แค่ในหน่วยความจำ ณ ตอนสร้าง
 */
import { PrismaClient, ReviewTaskType, RoleAssignmentStatus, SubjectType } from "@prisma/client";

import {
  sendActivated,
  sendFinalApprovalRequest,
  sendRevisionRequested,
  sendSubmittedToOfficers,
  sendDatasetApproved,
  sendDatasetPendingBdiApproval,
  sendDatasetPendingOrgApprover,
  sendDatasetRejected,
  sendDatasetRevisionRequested,
  sendDatasetSubmitted,
  sendRaw,
  sendRoleRemoved,
} from "../lib/mail.js";
import { NotificationType } from "../lib/notify.js";
import { ROLE_LABELS } from "../lib/roles.js";
import { type RoleCode } from "../lib/system.js";

export interface DeliverableNotification {
  notificationType: string;
  title: string;
  message: string;
  subjectType: string | null;
  subjectId: string | null;
}

/** ข้อมูลที่ template ของ Journey C ต้องใช้ */
async function datasetInfo(prisma: PrismaClient, subjectId: string) {
  const request = await prisma.datasetRegistrationRequest.findUnique({
    where: { id: subjectId },
    include: {
      metadata: { select: { title: true } },
      organization: { select: { nameTh: true } },
    },
  });
  if (!request) return null;
  return {
    requestNumber: request.requestNumber,
    datasetName: request.metadata?.title || request.proposedTitle || `คำขอ ${request.requestNumber}`,
    organizationName: request.organization.nameTh,
    id: request.id,
  };
}

/**
 * ส่งอีเมลหนึ่งฉบับ โดยเลือก template จากชนิดของ notification
 * ชนิดที่ยังไม่มี template เฉพาะจะตกมาที่ sendRaw ซึ่งใช้ layout กลางกับ title/message
 */
export async function renderAndSend(
  prisma: PrismaClient,
  destination: string,
  n: DeliverableNotification,
): Promise<void> {
  const to = [destination];

  if (n.subjectType === SubjectType.DATASET_REGISTRATION_REQUEST && n.subjectId) {
    const info = await datasetInfo(prisma, n.subjectId);
    if (info) {
      switch (n.notificationType) {
        case NotificationType.REQUEST_SUBMITTED: {
          // ชนิดเดียวกันถูกใช้ทั้งตอนนำส่งและตอนส่งต่อระหว่างด่าน
          // แยกด้วยด่านที่ค้างอยู่จริง ไม่ใช่ด้วยชนิดของ notification
          const active = await prisma.reviewTask.findFirst({
            where: {
              subjectType: SubjectType.DATASET_REGISTRATION_REQUEST,
              subjectId: n.subjectId,
              status: { in: ["PENDING", "IN_PROGRESS"] },
            },
            select: { taskType: true },
          });
          if (active?.taskType === ReviewTaskType.ORGANIZATION_APPROVAL) {
            await sendDatasetPendingOrgApprover(to, info);
            return;
          }
          if (active?.taskType === ReviewTaskType.BDI_FINAL_APPROVAL) {
            await sendDatasetPendingBdiApproval(to, info);
            return;
          }
          await sendDatasetSubmitted(to, { ...info, submitter: "ผู้ใช้จากหน่วยงาน" });
          return;
        }
        case NotificationType.REQUEST_RETURNED:
          await sendDatasetRevisionRequested(to, {
            ...info,
            note: n.message,
            byName: "ผู้ตรวจสอบ",
            at: new Date(),
          });
          return;
        case NotificationType.REQUEST_REJECTED:
          await sendDatasetRejected(to, { ...info, reason: n.message });
          return;
        case NotificationType.REQUEST_APPROVED:
          await sendDatasetApproved(to, info);
          return;
        default:
          break;
      }
    }
  }

  /**
   * ถูกถอดออกจากหน่วยงานเพราะมีคนมารับ role แทน
   *
   * subject คือแถว `user_role_assignment` ที่ถูกเพิกถอน ไม่ใช่หน่วยงาน — มันเป็นที่เดียว
   * ที่มีทั้งหน่วยงาน role และเวลาที่ถูกถอดครบในแถวเดียว ชื่อคนที่มารับหน้าที่แทนอ่าน
   * **ตอนส่ง** จากคนที่ถือ role เดียวกันในหน่วยงานนั้นอยู่ ณ ตอนนั้น ไม่ได้ฝากมากับคิว
   */
  if (n.subjectType === "USER_ROLE_ASSIGNMENT" && n.subjectId) {
    const assignment = await prisma.userRoleAssignment.findUnique({
      where: { id: n.subjectId },
      select: {
        roleId: true,
        organizationId: true,
        revokedAt: true,
        organization: { select: { nameTh: true } },
        role: { select: { code: true } },
      },
    });
    if (assignment && n.notificationType === NotificationType.ROLE_ASSIGNMENT_CHANGED) {
      const successor = assignment.organizationId
        ? await prisma.userRoleAssignment.findFirst({
            where: {
              organizationId: assignment.organizationId,
              roleId: assignment.roleId,
              status: RoleAssignmentStatus.ACTIVE,
              OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: new Date() } }],
            },
            orderBy: { effectiveFrom: "desc" },
            select: { userAccount: { select: { displayName: true } } },
          })
        : null;

      await sendRoleRemoved(destination, {
        organizationName: assignment.organization?.nameTh ?? "หน่วยงานเดิมของคุณ",
        roleLabel: ROLE_LABELS[assignment.role.code as RoleCode] ?? assignment.role.code,
        successorName: successor?.userAccount.displayName ?? null,
        removedAt: assignment.revokedAt,
      });
      return;
    }
  }

  if (n.subjectType === SubjectType.ORGANIZATION_REGISTRATION_REQUEST && n.subjectId) {
    const request = await prisma.organizationRegistrationRequest.findUnique({
      where: { id: n.subjectId },
      select: {
        id: true,
        organizationNameTh: true,
        userFirstnameTh: true,
        userLastnameTh: true,
        organization: { select: { nameTh: true } },
      },
    });
    if (request) {
      const orgName = request.organizationNameTh ?? request.organization.nameTh;
      switch (n.notificationType) {
        case NotificationType.REQUEST_SUBMITTED: {
          const active = await prisma.reviewTask.findFirst({
            where: {
              subjectType: SubjectType.ORGANIZATION_REGISTRATION_REQUEST,
              subjectId: n.subjectId,
              status: { in: ["PENDING", "IN_PROGRESS"] },
            },
            select: { taskType: true },
          });
          if (active?.taskType === ReviewTaskType.BDI_FINAL_APPROVAL) {
            await sendFinalApprovalRequest(to, orgName, request.id);
            return;
          }
          await sendSubmittedToOfficers(
            to,
            orgName,
            [request.userFirstnameTh, request.userLastnameTh].filter(Boolean).join(" ") || "ผู้ใช้จากหน่วยงาน",
            request.id,
          );
          return;
        }
        case NotificationType.REQUEST_RETURNED:
          await sendRevisionRequested(destination, orgName, n.message, request.id);
          return;
        case NotificationType.REQUEST_APPROVED:
          await sendActivated(to, orgName, request.id);
          return;
        default:
          break;
      }
    }
  }

  await sendRaw(destination, n.title, n.message);
}
