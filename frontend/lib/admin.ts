/**
 * ชนิดข้อมูลและป้ายของหน้า /console — สิ่งที่ /api/admin/* ตอบกลับมา
 *
 * แยกจาก lib/types.ts เพราะเป็นอีกชุด API: ของผู้ดูแลระบบ ซึ่งคืนค่าที่หน้าอื่นไม่เคยเห็น (เลขบัตรเต็ม สถานะบัญชี คำเชิญ)
 * ชื่อช่องตรงกับ `accountSelect` ใน backend/src/routes/admin-users.ts และ `toAdminOrganizationShape()` ใน routes/admin.ts
 */
import type { OrganizationStatus, RequestStatus, Role } from "./status";

export type UserAccountStatus = "PENDING" | "ACTIVE" | "SUSPENDED" | "DEACTIVATED";
export type ActivationKeyStatus = "ISSUED" | "USED" | "EXPIRED" | "REVOKED";

export interface AdminUser {
  id: string;
  email: string;
  cid: string | null;
  prefixTh: string | null;
  firstnameTh: string | null;
  lastnameTh: string | null;
  displayName: string | null;
  phoneNumber: string | null;
  phoneNumberExtension: string | null;
  positionTh: string | null;
  departmentTh: string | null;
  accountType: "ORGANIZATION" | "BDI";
  status: UserAccountStatus;
  lastLoginAt: string | null;
  activatedAt: string | null;
  suspendedAt: string | null;
  suspensionReason: string | null;
  deactivatedAt: string | null;
  createdAt: string;
}

export interface AdminUserListItem extends AdminUser {
  roleAssignments: Array<{
    id: string;
    role: { code: Role };
    organization: { id: string; nameTh: string } | null;
  }>;
}

export interface AdminRoleAssignment {
  id: string;
  status: "ACTIVE" | "REVOKED";
  derivedStatus: "ACTIVE" | "REVOKED" | "EXPIRED";
  effectiveFrom: string | null;
  effectiveUntil: string | null;
  revokedAt: string | null;
  revocationReason: string | null;
  role: { code: Role; nameTh: string };
  organization: { id: string; nameTh: string } | null;
}

export interface AdminSession {
  id: string;
  createdAt: string;
  lastSeenAt: string | null;
  expiresAt: string;
  ipAddress: string | null;
  userAgent: string | null;
}

export interface AdminAuditRow {
  id: string;
  action: string;
  occurredAt: string;
  actorId: string | null;
  metadataJson: Record<string, unknown> | null;
}

export interface AdminUserDetail {
  user: AdminUser;
  roleAssignments: AdminRoleAssignment[];
  activationKeys: Array<{
    id: string;
    status: ActivationKeyStatus;
    issuedAt: string;
    expiresAt: string;
    usedAt: string | null;
  }>;
  sessions: AdminSession[];
  recentAudit: AdminAuditRow[];
}

export interface AdminInvitation {
  id: string;
  status: ActivationKeyStatus;
  issuedAt: string;
  expiresAt: string;
  usedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  userAccount: { id: string; email: string; cid: string | null; status: UserAccountStatus };
  role: { code: Role; nameTh: string };
  organization: { id: string; nameTh: string } | null;
}

export interface AdminOrganization {
  id: string;
  organizationCode: string;
  organizationType: string | null;
  nameTh: string;
  nameEn: string | null;
  status: OrganizationStatus;
  addressLine: string | null;
  road: string | null;
  province: string | null;
  district: string | null;
  subdistrict: string | null;
  postalCode: string | null;
  phone: string | null;
  phoneExtension: string | null;
  email: string | null;
  websiteUrl: string | null;
  parentOrganizationId: string | null;
  activatedAt: string | null;
  suspendedAt: string | null;
  suspensionReason: string | null;
  deactivatedAt: string | null;
  createdAt: string;
}

export interface AdminOrganizationDetail {
  organization: AdminOrganization;
  registrationRequests: Array<{
    id: string;
    requestNumber: string;
    status: RequestStatus;
    submittedAt: string | null;
    createdAt: string;
  }>;
  invitations: Array<{
    id: string;
    status: ActivationKeyStatus;
    expiresAt: string;
    userAccount: { email: string; status: UserAccountStatus };
    role: { code: Role };
  }>;
}

export interface AdminSummary {
  users: Record<UserAccountStatus, number>;
  organizations: Record<OrganizationStatus, number>;
  organizationRequests: Record<RequestStatus, number>;
  datasetRequests: Record<RequestStatus, number>;
  invitations: { usable: number; expiringSoon: number; lapsed: number };
  deadLetters: number;
  generatedAt: string;
}

// ---------------------------------------------------------------- ป้ายสถานะ

/** ทุก badge มีทั้งสีและข้อความ (docs/02-ui-spec.md §1.3) — ชุดสีเดียวกับ REQUEST_STATUS_META */
export const USER_STATUS_META: Record<UserAccountStatus, { label: string; className: string }> = {
  PENDING: { label: "รอเปิดใช้งาน", className: "bg-warning-bg text-warning" },
  ACTIVE: { label: "ใช้งานอยู่", className: "bg-success-bg text-success" },
  SUSPENDED: { label: "ระงับชั่วคราว", className: "bg-danger-bg text-danger" },
  DEACTIVATED: { label: "ยุติการใช้งาน", className: "bg-navy-50 text-ink-muted" },
};

export const INVITATION_STATUS_META: Record<ActivationKeyStatus, { label: string; className: string }> = {
  ISSUED: { label: "รอผู้รับเปิดใช้งาน", className: "bg-warning-bg text-warning" },
  USED: { label: "เปิดใช้งานแล้ว", className: "bg-success-bg text-success" },
  EXPIRED: { label: "หมดอายุ", className: "bg-navy-50 text-ink-muted" },
  REVOKED: { label: "ยกเลิกแล้ว", className: "bg-navy-50 text-ink-muted" },
};

/** คำเชิญที่ยัง ISSUED แต่เลยเวลาแล้ว — ฐานข้อมูลยังไม่เปลี่ยนสถานะให้จนกว่าจะมีคนกดลิงก์ (ดู `GET /api/admin/summary`) */
export function invitationState(inv: { status: ActivationKeyStatus; expiresAt: string }): ActivationKeyStatus {
  if (inv.status === "ISSUED" && new Date(inv.expiresAt).getTime() <= Date.now()) return "EXPIRED";
  return inv.status;
}

/** role ระดับหน่วยงาน — ต้องเลือกหน่วยงาน (ตรงกับ ORGANIZATION_SCOPED_ROLES ใน backend/src/lib/system.ts) */
export const ORGANIZATION_ROLES: Role[] = ["ORGANIZATION_USER", "ORGANIZATION_APPROVER"];
export const BDI_ROLE_CODES: Role[] = [
  "BDI_OFFICER",
  "BDI_DATASET_SPECIALIST",
  "BDI_FINAL_APPROVER",
  "BDI_LEGAL_OFFICER",
  "SYSTEM_ADMINISTRATOR",
];

/** ข้อความของแถวประวัติบัญชี — action ที่ไม่มีในตารางนี้แสดงรหัสตรง ๆ ดีกว่าเดาความหมาย */
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  USER_ACCOUNT_CREATED: "สร้างบัญชี",
  USER_ACCOUNT_ACTIVATED: "เปิดใช้งานบัญชี",
  USER_ACCOUNT_UPDATED: "แก้ข้อมูลบัญชี",
  USER_ACCOUNT_SUSPENDED: "ระงับบัญชี",
  USER_ACCOUNT_REINSTATED: "ยกเลิกการระงับ",
  USER_ACCOUNT_DEACTIVATED: "ยุติการใช้งานบัญชี",
  USER_ACCOUNT_REACTIVATED: "เปิดใช้บัญชีอีกครั้ง",
  USER_IDENTITY_RELEASED: "ปล่อยอีเมลให้ใช้ใหม่",
  PASSWORD_RESET_REQUESTED: "ส่งลิงก์ตั้งรหัสผ่านใหม่",
  PASSWORD_RESET_COMPLETED: "ตั้งรหัสผ่านใหม่",
  SESSION_REVOKED: "ออกจากระบบทุกอุปกรณ์",
  LOGIN_SUCCEEDED: "เข้าสู่ระบบ",
  LOGIN_FAILED: "เข้าสู่ระบบไม่สำเร็จ",
  ROLE_ASSIGNED: "มอบบทบาท",
  ROLE_REVOKED: "ถอนบทบาท",
  ACTIVATION_KEY_ISSUED: "ส่งคำเชิญ",
  ACTIVATION_KEY_USED: "ใช้คำเชิญเปิดบัญชี",
  ACTIVATION_KEY_REVOKED: "ยกเลิกคำเชิญ",
  ACTIVATION_KEY_EXPIRED: "คำเชิญหมดอายุ",
};
