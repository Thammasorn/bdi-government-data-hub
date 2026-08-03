/**
 * In-app notification (docs/01-user-journey.md §4.8)
 *
 * สเปกระบุว่าไม่ต้อง real time — หน้าเว็บ fetch ตอนโหลดหน้าใหม่ก็พอ
 * ที่นี่จึงมีแค่การเขียนแถวลงตาราง ไม่มี websocket/SSE
 */
import { NotificationType, Role, UserStatus } from "@prisma/client";

import { prisma } from "../db.js";

interface NotifyInput {
  type: NotificationType;
  title: string;
  body?: string | null;
  /** path ภายในแอป เช่น /datasets/<id> */
  link?: string | null;
}

/** สร้าง notification ให้หลายคนพร้อมกัน (ตัด id ซ้ำและค่าว่างออกให้) */
export async function notifyUsers(userIds: Array<string | null | undefined>, input: NotifyInput) {
  const unique = [...new Set(userIds.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return;

  await prisma.notification.createMany({
    data: unique.map((userId) => ({
      userId,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      link: input.link ?? null,
    })),
  });
}

async function activeIdsWithRole(role: Role): Promise<string[]> {
  const users = await prisma.user.findMany({
    where: { roles: { has: role }, status: UserStatus.ACTIVE },
    select: { id: true },
  });
  return users.map((u) => u.id);
}

export const bdiOfficerIds = () => activeIdsWithRole(Role.BDI_OFFICER);
export const bdiApproverIds = () => activeIdsWithRole(Role.BDI_APPROVER);

/**
 * ผู้ใช้ของหน่วยงานหนึ่ง แยกตาม role
 *
 * ผู้มีอำนาจถูกหาได้สองทาง: ผูก organizationId ไว้แล้ว หรืออีเมลตรงกับ signatoryEmail
 * ของหน่วยงาน — เพราะผู้มีอำนาจที่มีบัญชีอยู่ก่อนแล้วจะถูกเพิ่ม role ให้ใน Journey B
 * แต่ยังไม่ถูกย้าย organizationId (docs/01-user-journey.md §4.1)
 */
export async function organizationMemberIds(organizationId: string): Promise<{
  users: string[];
  approvers: string[];
}> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { signatoryEmail: true },
  });

  const members = await prisma.user.findMany({
    where: {
      status: UserStatus.ACTIVE,
      OR: [
        { organizationId },
        ...(org?.signatoryEmail
          ? [{ email: { equals: org.signatoryEmail, mode: "insensitive" as const } }]
          : []),
      ],
    },
    select: { id: true, email: true, roles: true },
  });

  const signatory = org?.signatoryEmail?.toLowerCase();
  return {
    users: members.filter((m) => m.roles.includes(Role.ORGANIZATION_USER)).map((m) => m.id),
    approvers: members
      .filter(
        (m) => m.roles.includes(Role.ORGANIZATION_APPROVER) || m.email.toLowerCase() === signatory,
      )
      .map((m) => m.id),
  };
}

/**
 * stakeholders ของคำขอหนึ่งฉบับ — docs/01-user-journey.md §4.6 [สมมติฐาน]
 * ผู้สร้าง + ผู้ใช้และผู้มีอำนาจของหน่วยงาน + BDI officer/approver ทุกคน + specialist ที่ถูก assign
 */
export async function datasetStakeholderIds(request: {
  organizationId: string;
  createdById: string;
  assignedSpecialistId: string | null;
}): Promise<string[]> {
  const [members, officers, approvers] = await Promise.all([
    organizationMemberIds(request.organizationId),
    bdiOfficerIds(),
    bdiApproverIds(),
  ]);

  return [
    ...new Set([
      request.createdById,
      ...members.users,
      ...members.approvers,
      ...officers,
      ...approvers,
      ...(request.assignedSpecialistId ? [request.assignedSpecialistId] : []),
    ]),
  ];
}

/** อีเมลของผู้ใช้ตาม id — ใช้ส่งเมลให้ชุดเดียวกับที่แจ้งเตือนในระบบ */
export async function emailsOf(userIds: string[]): Promise<string[]> {
  if (userIds.length === 0) return [];
  const users = await prisma.user.findMany({
    where: { id: { in: userIds }, status: UserStatus.ACTIVE },
    select: { email: true },
  });
  return users.map((u) => u.email);
}
