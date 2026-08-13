/**
 * ผู้กระทำที่เป็น "ระบบ" ไม่ใช่คน
 *
 * สคีมาตาม draft_db_design (2026-08-11) บังคับ `created_by` / `updated_by` เป็น NOT NULL
 * ทุกตาราง แถวที่ระบบสร้างเอง (master data, งานที่ scheduler สร้าง, migration) จึงต้องมี
 * ผู้กระทำอ้างถึงได้ — sheet `user_account` เตรียม `account_type = SYSTEM` ไว้ให้พอดี
 *
 * id ตรึงไว้เป็นค่าคงที่เพื่อให้ seed ซ้ำได้และ log ย้อนหลังยังชี้ถูกแถวเดิม
 */
export const SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000001";
export const SYSTEM_USER_EMAIL = "system@bdi.local";

/**
 * BDI เองก็เป็นแถวหนึ่งใน organization.organization
 *
 * sheet `activation_key` บังคับ organization_id เป็น NOT NULL ทุกแถว รวมถึงคีย์ที่ออกให้
 * เจ้าหน้าที่ BDI ด้วย และตัวอย่าง payload ใน sheet `signature_confirmation` ก็เขียน
 * organizationNameTh = "สถาบันข้อมูลขนาดใหญ่" / organizationNameEn = "Big Data Institute"
 * ไว้ตรง ๆ — ดีไซน์จึงมองว่า BDI เป็นหน่วยงานหนึ่งอยู่แล้ว
 *
 * ต่างจาก user_role_assignment.organization_id ที่ sheet มาร์กว่า Conditional
 * (Organization scope) — role ฝั่ง BDI ปล่อยเป็น NULL ตามเดิม
 */
export const BDI_ORGANIZATION_ID = "00000000-0000-0000-0000-0000000000b0";
export const BDI_ORGANIZATION_CODE = "BDI";

/**
 * รหัส role ทั้งเจ็ดตาม sheet `role`
 *
 * เปลี่ยนจากของเดิมสองตัว: BDI_APPROVER → BDI_FINAL_APPROVER และ
 * BDI_SPECIALIST → BDI_DATASET_SPECIALIST · เพิ่มใหม่สองตัว: BDI_LEGAL_OFFICER,
 * SYSTEM_ADMINISTRATOR
 */
export const ROLE_CODES = {
  ORGANIZATION_USER: "ORGANIZATION_USER",
  ORGANIZATION_APPROVER: "ORGANIZATION_APPROVER",
  BDI_OFFICER: "BDI_OFFICER",
  BDI_DATASET_SPECIALIST: "BDI_DATASET_SPECIALIST",
  BDI_FINAL_APPROVER: "BDI_FINAL_APPROVER",
  BDI_LEGAL_OFFICER: "BDI_LEGAL_OFFICER",
  SYSTEM_ADMINISTRATOR: "SYSTEM_ADMINISTRATOR",
} as const;

export type RoleCode = (typeof ROLE_CODES)[keyof typeof ROLE_CODES];

/** ชื่อ role ภาษาไทย/อังกฤษ ตามที่ sheet `role` เขียนไว้ทุกตัวอักษร */
export const ROLE_DEFINITIONS: { code: RoleCode; nameTh: string; nameEn: string }[] = [
  { code: ROLE_CODES.ORGANIZATION_USER, nameTh: "ผู้ดำเนินการของหน่วยงาน", nameEn: "Organization User" },
  {
    code: ROLE_CODES.ORGANIZATION_APPROVER,
    nameTh: "ผู้มีอำนาจกระทำการแทนของหน่วยงาน",
    nameEn: "Organization Approver",
  },
  { code: ROLE_CODES.BDI_OFFICER, nameTh: "ผู้ดำเนินการของ BDI", nameEn: "BDI Officer" },
  {
    code: ROLE_CODES.BDI_DATASET_SPECIALIST,
    nameTh: "ผู้เชี่ยวชาญด้านข้อมูลของ BDI",
    nameEn: "BDI Dataset Specialist",
  },
  {
    code: ROLE_CODES.BDI_FINAL_APPROVER,
    nameTh: "ผู้มีอำนาจกระทำการแทนของ BDI",
    nameEn: "BDI Final Approver",
  },
  {
    code: ROLE_CODES.BDI_LEGAL_OFFICER,
    nameTh: "ผู้ดำเนินการทางกฎหมายของ BDI",
    nameEn: "BDI Legal Officer",
  },
  { code: ROLE_CODES.SYSTEM_ADMINISTRATOR, nameTh: "ผู้ดูแลระบบ", nameEn: "System Administrator" },
];

/** role ที่ผูกกับหน่วยงาน — user_role_assignment.organization_id บังคับสำหรับสองตัวนี้ */
export const ORGANIZATION_SCOPED_ROLES: RoleCode[] = [
  ROLE_CODES.ORGANIZATION_USER,
  ROLE_CODES.ORGANIZATION_APPROVER,
];

/**
 * ชื่อของหน่วยงานที่ยังไม่มีใครกรอกชื่อให้
 *
 * activation_key.organization_id เป็น NOT NULL ตอนเชิญคนที่จะมาสร้างหน่วยงานของตัวเอง
 * (Journey B) จึงต้องมีแถวหน่วยงานรออยู่ก่อนตั้งแต่ตอนเชิญ ทั้งที่ยังไม่รู้ชื่อ
 * ใช้ที่ POST /api/admin/invitations · POST /api/organizations และ seed:demo —
 * ผู้ใช้เห็นชื่อนี้บนหน้าจอจนกว่าจะกรอกส่วนที่ 1 ของฟอร์ม
 */
export const PLACEHOLDER_ORGANIZATION_NAME = "หน่วยงานใหม่";
