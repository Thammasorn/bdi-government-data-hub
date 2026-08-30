import { OrganizationStatus, RequestStatus, ReviewTaskType } from "@prisma/client";

import { ROLE_CODES, type RoleCode } from "./system.js";

/** ชื่อ role ที่แสดงบนหน้าจอ — คู่กับ iam.role.name_th ใน sheet `role` */
export const ROLE_LABELS: Record<RoleCode, string> = {
  [ROLE_CODES.ORGANIZATION_USER]: "ผู้ดำเนินการของหน่วยงาน",
  [ROLE_CODES.ORGANIZATION_APPROVER]: "ผู้มีอำนาจกระทำการแทนของหน่วยงาน",
  [ROLE_CODES.BDI_OFFICER]: "ผู้ดำเนินการของ BDI",
  [ROLE_CODES.BDI_DATASET_SPECIALIST]: "ผู้เชี่ยวชาญด้านข้อมูลของ BDI",
  [ROLE_CODES.BDI_FINAL_APPROVER]: "ผู้มีอำนาจอนุมัติฝ่าย BDI",
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
 * ภาษาไทยไม่เว้นวรรคระหว่างคำ — ยกเว้นเมื่อคำก่อนหน้าลงท้ายด้วยอักษรละติน
 * "ผู้ดำเนินการของ BDI" + "ตรวจสอบ" ต่อกันตรง ๆ ได้ "BDIตรวจสอบ" ซึ่งอ่านเป็นคำเดียว
 */
export const roleGap = (label: string) => (/[A-Za-z0-9)]$/.test(label) ? " " : "");

/**
 * ชื่อบทบาท + สิ่งที่บทบาทนั้นทำ — ประโยคบอกด่านทุกประโยคในระบบประกอบจากตรงนี้
 *
 * เดิมแต่ละที่เขียนชื่อบทบาทของตัวเอง ("เจ้าหน้าที่ BDI" ที่ badge, "ผู้ดำเนินการของ BDI"
 * ที่อีเมล, "BDI" เฉย ๆ ในแผนภาพ) ผู้ใช้คนเดียวกันจึงเห็นด่านเดียวกันถูกเรียกสามชื่อ
 * ระหว่างอีเมลที่ได้รับ ตารางที่เปิดอยู่ และหน้ารายละเอียดที่กดเข้าไป
 */
export const withRole = (roleCode: RoleCode, action: string) => {
  const label = ROLE_LABELS[roleCode];
  return `${label}${roleGap(label)}${action}`;
};

/** ด่านหนึ่ง = บทบาทหนึ่ง — ที่เดียวที่ผูกสองอย่างนี้เข้าด้วยกัน */
export const REVIEW_TASK_ROLE: Record<ReviewTaskType, RoleCode> = {
  [ReviewTaskType.BDI_OFFICER_REVIEW]: ROLE_CODES.BDI_OFFICER,
  [ReviewTaskType.DATASET_SPECIALIST_REVIEW]: ROLE_CODES.BDI_DATASET_SPECIALIST,
  [ReviewTaskType.ORGANIZATION_APPROVAL]: ROLE_CODES.ORGANIZATION_APPROVER,
  [ReviewTaskType.BDI_FINAL_APPROVAL]: ROLE_CODES.BDI_FINAL_APPROVER,
  [ReviewTaskType.ORGANIZATION_REVISION]: ROLE_CODES.ORGANIZATION_USER,
};

/** สิ่งที่แต่ละด่านทำ — ต่อท้ายชื่อบทบาทเป็นประโยคเดียว */
export const REVIEW_TASK_ACTION: Record<ReviewTaskType, string> = {
  [ReviewTaskType.BDI_OFFICER_REVIEW]: "ตรวจสอบเอกสาร",
  [ReviewTaskType.DATASET_SPECIALIST_REVIEW]: "พิจารณา",
  [ReviewTaskType.ORGANIZATION_APPROVAL]: "ลงนามเห็นชอบ",
  [ReviewTaskType.BDI_FINAL_APPROVAL]: "ดำเนินการอนุมัติ",
  [ReviewTaskType.ORGANIZATION_REVISION]: "แก้ไข",
};

/**
 * ด่านที่คำขอกำลังรออยู่ — มาจาก review_task.task_type ของ active task
 * ใช้แทน PENDING_* ที่หายไปจาก status เพื่อให้ badge บนหน้าจอยังบอกได้ว่ารอใคร
 */
export const REVIEW_TASK_TYPE_LABELS: Record<ReviewTaskType, string> = Object.fromEntries(
  (Object.keys(REVIEW_TASK_ROLE) as ReviewTaskType[]).map((t) => [
    t,
    `รอ${withRole(REVIEW_TASK_ROLE[t], REVIEW_TASK_ACTION[t])}`,
  ]),
) as Record<ReviewTaskType, string>;

/** role ฝั่ง BDI ทั้งหมด — เห็นคำขอได้ทุกหน่วยงาน */
export const BDI_ROLES: RoleCode[] = [
  ROLE_CODES.BDI_OFFICER,
  ROLE_CODES.BDI_DATASET_SPECIALIST,
  ROLE_CODES.BDI_FINAL_APPROVER,
  ROLE_CODES.BDI_LEGAL_OFFICER,
];

export const isBdiStaff = (roles: RoleCode[]) => roles.some((r) => BDI_ROLES.includes(r));

/**
 * ผู้เชี่ยวชาญข้อมูลที่ไม่ได้ถือ role อื่นของ BDI ด้วย
 *
 * `docs/01-user-journey.md` §4.7 ให้ role นี้เห็น **เฉพาะคำขอที่ถูกมอบหมายให้ตนเอง**
 * ต่างจาก BDI role อื่นที่เห็นทั้งระบบ — จึงต้องแยกออกจาก `isBdiStaff` ตรงจุดที่กรอง
 * (สำเนาเดียวกันอยู่ที่ `isSpecialistOnly` ใน frontend/lib/status.ts ซึ่งใช้ตัดสินเมนู)
 */
export const isSpecialistOnly = (roles: RoleCode[]) =>
  roles.includes(ROLE_CODES.BDI_DATASET_SPECIALIST) &&
  !roles.includes(ROLE_CODES.BDI_OFFICER) &&
  !roles.includes(ROLE_CODES.BDI_FINAL_APPROVER) &&
  !roles.includes(ROLE_CODES.BDI_LEGAL_OFFICER);

export const hasRole = (roles: RoleCode[], ...allowed: RoleCode[]) =>
  roles.some((r) => allowed.includes(r));
