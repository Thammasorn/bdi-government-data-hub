import { OrganizationStatus, Role } from "@prisma/client";

export const ROLE_LABELS: Record<Role, string> = {
  [Role.BDI_OFFICER]: "เจ้าหน้าที่ BDI",
  [Role.BDI_APPROVER]: "ผู้อนุมัติ BDI",
  [Role.BDI_SPECIALIST]: "ผู้เชี่ยวชาญ BDI",
  [Role.ORGANIZATION_USER]: "ผู้ใช้จากหน่วยงาน",
  [Role.ORGANIZATION_APPROVER]: "ผู้มีอำนาจกระทำการแทน",
};

export const STATUS_LABELS: Record<OrganizationStatus, string> = {
  [OrganizationStatus.DRAFT]: "ฉบับร่าง",
  [OrganizationStatus.PENDING_BDI_REVIEW]: "รอตรวจสอบจาก BDI",
  [OrganizationStatus.NEEDS_REVISION]: "รอการแก้ไข",
  [OrganizationStatus.PENDING_SIGNATORY_REVIEW]: "รอตรวจสอบจากผู้มีอำนาจ",
  [OrganizationStatus.PENDING_BDI_APPROVAL]: "รอ BDI ลงนาม",
  [OrganizationStatus.ACTIVE]: "เปิดใช้งาน",
};

export const isBdiStaff = (roles: Role[]) =>
  roles.some((r) => r === Role.BDI_OFFICER || r === Role.BDI_APPROVER || r === Role.BDI_SPECIALIST);
