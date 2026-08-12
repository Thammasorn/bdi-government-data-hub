import { OrganizationStatus, RequestStatus, ReviewTaskType } from "@prisma/client";

import { ROLE_CODES, type RoleCode } from "./system.js";

/** ชื่อ role ที่แสดงบนหน้าจอ — คู่กับ iam.role.name_th ใน sheet `role` */
export const ROLE_LABELS: Record<RoleCode, string> = {
  [ROLE_CODES.ORGANIZATION_USER]: "ผู้ดำเนินการของหน่วยงาน",
  [ROLE_CODES.ORGANIZATION_APPROVER]: "ผู้มีอำนาจกระทำการแทนของหน่วยงาน",
  [ROLE_CODES.BDI_OFFICER]: "ผู้ดำเนินการของ BDI",
  [ROLE_CODES.BDI_DATASET_SPECIALIST]: "ผู้เชี่ยวชาญด้านข้อมูลของ BDI",
  [ROLE_CODES.BDI_FINAL_APPROVER]: "ผู้มีอำนาจกระทำการแทนของ BDI",
  [ROLE_CODES.BDI_LEGAL_OFFICER]: "ผู้ดำเนินการทางกฎหมายของ BDI",
  [ROLE_CODES.SYSTEM_ADMINISTRATOR]: "ผู้ดูแลระบบ",
};

/**
 * สถานะหน่วยงาน — เหลือสี่ค่าตาม sheet `organization`
 * สถานะของ "คำขอ" ย้ายไปอยู่ที่ RequestStatus แล้ว ไม่ปนกันอีก
 */
export const ORGANIZATION_STATUS_LABELS: Record<OrganizationStatus, string> = {
  [OrganizationStatus.PENDING_REGISTRATION]: "อยู่ระหว่างลงทะเบียน",
  [OrganizationStatus.ACTIVE]: "เปิดใช้งาน",
  [OrganizationStatus.SUSPENDED]: "ระงับชั่วคราว",
  [OrganizationStatus.INACTIVE]: "ยุติการใช้งาน",
};

/** สถานะคำขอ — ชุดเดียวกันทั้ง Journey B และ C ตาม sheet ทั้งสองใบ */
export const REQUEST_STATUS_LABELS: Record<RequestStatus, string> = {
  [RequestStatus.DRAFT]: "ฉบับร่าง",
  [RequestStatus.SUBMITTED]: "นำส่งแล้ว",
  [RequestStatus.UNDER_REVIEW]: "กำลังพิจารณา",
  [RequestStatus.RETURNED]: "ส่งกลับให้แก้ไข",
  [RequestStatus.APPROVED]: "อนุมัติแล้ว",
  [RequestStatus.REJECTED]: "ไม่อนุมัติ",
  [RequestStatus.CANCELLED]: "ยกเลิกแล้ว",
};

/**
 * ด่านที่คำขอกำลังรออยู่ — มาจาก review_task.task_type ของ active task
 * ใช้แทน PENDING_* ที่หายไปจาก status เพื่อให้ badge บนหน้าจอยังบอกได้ว่ารอใคร
 */
export const REVIEW_TASK_TYPE_LABELS: Record<ReviewTaskType, string> = {
  [ReviewTaskType.BDI_OFFICER_REVIEW]: "รอเจ้าหน้าที่ BDI ตรวจสอบ",
  [ReviewTaskType.DATASET_SPECIALIST_REVIEW]: "รอผู้เชี่ยวชาญด้านข้อมูลพิจารณา",
  [ReviewTaskType.ORGANIZATION_APPROVAL]: "รอผู้มีอำนาจของหน่วยงานลงนาม",
  [ReviewTaskType.BDI_FINAL_APPROVAL]: "รอ BDI อนุมัติขั้นสุดท้าย",
  [ReviewTaskType.ORGANIZATION_REVISION]: "รอหน่วยงานแก้ไข",
};

/** role ฝั่ง BDI ทั้งหมด — เห็นคำขอได้ทุกหน่วยงาน */
export const BDI_ROLES: RoleCode[] = [
  ROLE_CODES.BDI_OFFICER,
  ROLE_CODES.BDI_DATASET_SPECIALIST,
  ROLE_CODES.BDI_FINAL_APPROVER,
  ROLE_CODES.BDI_LEGAL_OFFICER,
];

export const isBdiStaff = (roles: RoleCode[]) => roles.some((r) => BDI_ROLES.includes(r));

export const hasRole = (roles: RoleCode[], ...allowed: RoleCode[]) =>
  roles.some((r) => allowed.includes(r));
