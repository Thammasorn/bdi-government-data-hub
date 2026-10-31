import { OrganizationStatus, type Prisma, type PrismaClient } from "@prisma/client";

import { prisma } from "../db.js";
import { ORGANIZATION_FROZEN, isOrganizationFrozen } from "./organization-freeze.js";
import { ORGANIZATION_STATUS_LABELS } from "./roles.js";
import { ORGANIZATION_SCOPED_ROLES, ROLE_CODES, type RoleCode } from "./system.js";

type Db = PrismaClient | Prisma.TransactionClient;

export interface InvitationTarget {
  id: string;
  nameTh: string;
  status: OrganizationStatus;
}

/** คำตอบ 409/404 ที่ route ส่งต่อได้ตรง ๆ — body มี id ที่หน้าคอนโซลใช้ทำลิงก์ */
export interface InvitationRefusal {
  status: number;
  body: Record<string, unknown>;
}

/**
 * หน่วยงานปลายทางของคำเชิญรับคนเข้าได้หรือไม่ — ด่านที่ไม่ขึ้นกับว่าเชิญใคร
 *
 * แยกออกจาก `POST /api/admin/invitations` เพราะการเชิญคนเดิมกลับเข้ามา (`POST /api/admin/users/:id/reinvite`)
 * ต้องผ่านด่านเดียวกันทุกข้อ และต้องพูดประโยคเดียวกัน — สองที่เขียนแยกกันจะค่อย ๆ พูดไม่ตรงกัน
 *
 *   1. ไม่พบหน่วยงาน → 404
 *   2. หน่วยงานถูกระงับหรือยุติ → 409 `organization_frozen` (การ์ด "ระงับหน่วยงาน" 2026-10-31)
 *   3. เชิญผู้มีอำนาจอนุมัติเข้าหน่วยงานที่ยังไม่ ACTIVE → 409 `organization_not_active` — ผู้มีอำนาจฯ คนแรกมาจาก
 *      คำขอจดทะเบียน (Journey B) ซึ่งเป็นคนที่ถูกกรอกชื่อไว้บนเอกสาร A0
 *
 * ด่านที่นั่ง (`role_occupied` / `invitation_pending`) ไม่อยู่ที่นี่ เพราะต้องรู้ว่าบัญชีไหนได้รับยกเว้น
 */
export async function invitationTarget(
  db: Db,
  params: { role: RoleCode; organizationId: string },
): Promise<{ organization: InvitationTarget; refusal: null } | { organization: null; refusal: InvitationRefusal }> {
  const organization = await db.organization.findUnique({
    where: { id: params.organizationId },
    // ชื่อหน่วยงานขึ้นหัวจดหมายในอีเมลคำเชิญ ("เรียน ผู้ใช้งาน <หน่วยงาน>")
    select: { id: true, nameTh: true, status: true },
  });
  if (!organization) {
    return {
      organization: null,
      refusal: { status: 404, body: { error: "not_found", message: "ไม่พบหน่วยงานที่ระบุ" } },
    };
  }
  if (isOrganizationFrozen(organization.status)) {
    return {
      organization: null,
      refusal: {
        status: 409,
        body: {
          error: ORGANIZATION_FROZEN,
          message:
            `หน่วยงานนี้อยู่สถานะ "${ORGANIZATION_STATUS_LABELS[organization.status]}" จึงเชิญผู้ใช้เข้าไม่ได้ — ` +
            `เปิดใช้หน่วยงานอีกครั้งก่อน แล้วจึงเชิญ`,
          organizationStatus: organization.status,
        },
      },
    };
  }
  if (
    ORGANIZATION_SCOPED_ROLES.includes(params.role) &&
    params.role === ROLE_CODES.ORGANIZATION_APPROVER &&
    organization.status !== OrganizationStatus.ACTIVE
  ) {
    return {
      organization: null,
      refusal: {
        status: 409,
        body: {
          error: "organization_not_active",
          message:
            `หน่วยงานนี้ยังไม่เปิดใช้งาน (สถานะ ${organization.status}) จึงยังเชิญผู้มีอำนาจอนุมัติตรง ๆ ไม่ได้ — ` +
            `ผู้มีอำนาจอนุมัติคนแรกมาจากคำขอจดทะเบียนหน่วยงาน (ผู้ดำเนินการกรอกชื่อไว้ในฟอร์ม ` +
            `ระบบส่งคำเชิญให้เองเมื่อผู้ประสานงานของ BDI ตรวจสอบผ่าน) ` +
            `เชิญตรงได้เฉพาะเมื่อหน่วยงานเปิดใช้งานแล้วและที่นั่งว่าง`,
          organizationStatus: organization.status,
        },
      },
    };
  }
  return { organization, refusal: null };
}

/**
 * หน่วยงานล่าสุดที่บัญชีนี้เคยถือบทบาทอยู่ — ใช้บอกผู้ดูแลระบบว่า "คนนี้คือใคร" ตอนเลขบัตรชนกับบัญชีที่ยุติแล้ว
 *
 * อ่านทุกสถานะของ assignment เพราะบัญชีที่ยุติแล้วถูกถอนบทบาทหมด (`REVOKED`) ใบล่าสุดคือที่ที่เขาอยู่ก่อนถูกยุติ
 */
export async function formerOrganizationOf(
  userAccountId: string,
  db: Db = prisma,
): Promise<{ id: string; nameTh: string } | null> {
  const latest = await db.userRoleAssignment.findFirst({
    where: { userAccountId, organizationId: { not: null } },
    orderBy: { createdAt: "desc" },
    select: { organization: { select: { id: true, nameTh: true } } },
  });
  return latest?.organization ?? null;
}
