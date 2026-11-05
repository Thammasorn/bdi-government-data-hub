import { isValidThaiNationalId } from "./organization-form";

/** คำขอเปลี่ยนแปลงผู้แทนหน่วยงาน — รูปข้อมูลของ `routes/representative-changes.ts` */
export type ChangeStatus =
  | "DRAFT"
  | "SUBMITTED"
  | "UNDER_REVIEW"
  | "RETURNED"
  | "CONFIRMED"
  | "PROCESSING"
  | "COMPLETED"
  | "PROCESSING_FAILED"
  | "REJECTED"
  | "CANCELLED";

export const CHANGE_STATUS_LABELS: Record<ChangeStatus, string> = {
  DRAFT: "ฉบับร่าง",
  SUBMITTED: "นำส่งแล้ว",
  UNDER_REVIEW: "อยู่ระหว่างการตรวจสอบ",
  RETURNED: "ส่งกลับแก้ไข",
  CONFIRMED: "ผ่านการตรวจสอบ",
  PROCESSING: "กำลังดำเนินการ",
  COMPLETED: "ดำเนินการเสร็จสิ้น",
  PROCESSING_FAILED: "ดำเนินการไม่สำเร็จ",
  REJECTED: "ปฏิเสธคำขอ",
  CANCELLED: "ยกเลิก",
};

const TONE: Record<ChangeStatus, string> = {
  DRAFT: "bg-navy-50 text-navy-700",
  SUBMITTED: "bg-warning-bg text-ink",
  UNDER_REVIEW: "bg-warning-bg text-ink",
  RETURNED: "bg-coral-50 text-coral-700",
  CONFIRMED: "bg-navy-50 text-navy-700",
  PROCESSING: "bg-navy-50 text-navy-700",
  COMPLETED: "bg-success-bg text-success",
  PROCESSING_FAILED: "bg-danger-bg text-danger",
  REJECTED: "bg-danger-bg text-danger",
  CANCELLED: "bg-navy-50 text-ink-muted",
};
export const changeStatusTone = (status: ChangeStatus) => TONE[status];

export interface Representative {
  kind: "HOLDER" | "INVITED";
  accountStatus: string;
  userRoleAssignmentId: string | null;
  activationKeyId: string | null;
  userAccountId: string;
  prefixTh: string | null;
  firstnameTh: string | null;
  lastnameTh: string | null;
  name: string;
  positionTh: string | null;
  departmentTh: string | null;
  email: string | null;
  phoneNumber: string | null;
  phoneNumberExtension: string | null;
  roleCode: string;
  roleLabel: string;
  openRequests: string[];
  organization?: { id: string; nameTh: string };
}

export interface SeatSummary {
  roleCode: string;
  roleLabel: string;
  current: number;
  max: number;
  over: boolean;
}

export interface ChangeRow {
  id: string;
  requestNumber: string;
  status: ChangeStatus;
  submittedAt: string | null;
  updatedAt: string;
  organization: { id: string; nameTh: string };
  removalCount: number;
  additionCount: number;
  documentName: string | null;
}

export interface HeadcountRow {
  roleCode: string;
  roleLabel: string;
  current: number;
  removed: number;
  added: number;
  after: number;
  min: number;
  max: number;
  changed: boolean;
  problem: string | null;
}

export interface RemovalItem {
  id: string;
  status: string;
  userRoleAssignmentId: string | null;
  activationKeyId: string | null;
  pendingInvitee: boolean;
  name: string;
  positionTh: string | null;
  departmentTh: string | null;
  roleCode: string | null;
  roleLabel: string | null;
}

export interface AdditionForm {
  id?: string;
  roleCode: string;
  prefixTh: string;
  firstnameTh: string;
  lastnameTh: string;
  cid: string;
  email: string;
  phoneNumber: string;
  phoneNumberExtension: string;
  positionTh: string;
  departmentTh: string;
}

export interface AdditionItem extends Omit<AdditionForm, "id"> {
  id: string;
  status: string;
  roleLabel: string;
}

export interface ChangeDetail {
  id: string;
  requestNumber: string;
  status: ChangeStatus;
  organization: { id: string; nameTh: string };
  submittedAt: string | null;
  updatedAt: string;
  cancellationReason: string | null;
  removals: RemovalItem[];
  additions: AdditionItem[];
  attachment: { id: string; filename: string; sizeBytes: number } | null;
  timeline: {
    id: string;
    taskType: string;
    status: string;
    result: string | null;
    comment: string | null;
    completedAt: string | null;
    completedBy: { name: string } | null;
  }[];
  headcount: HeadcountRow[];
  review: {
    accountChecks: { additionId: string; name: string; state: string; ok: boolean; message: string }[];
    overlaps: { name: string; requestNumber: string }[];
    blockers: string[];
  } | null;
  canEdit: boolean;
  canReview: boolean;
  canRetry: boolean;
}

export const ROLE_OPTIONS = [
  { value: "ORGANIZATION_APPROVER", label: "ผู้มีอำนาจของหน่วยงาน" },
  { value: "ORGANIZATION_USER", label: "ผู้ประสานงานของหน่วยงาน" },
];

export const emptyAddition = (): AdditionForm => ({
  roleCode: "",
  prefixTh: "",
  firstnameTh: "",
  lastnameTh: "",
  cid: "",
  email: "",
  phoneNumber: "",
  phoneNumberExtension: "",
  positionTh: "",
  departmentTh: "",
});

/** สำเนาของ `additionSubmitSchema` — ฟอร์มบอกได้ก่อนกดส่ง backend ตัดสินจริง */
export function validateAddition(a: AdditionForm): Partial<Record<keyof AdditionForm, string>> {
  const errors: Partial<Record<keyof AdditionForm, string>> = {};
  if (!a.roleCode) errors.roleCode = "กรุณาเลือกบทบาท";
  if (!a.prefixTh) errors.prefixTh = "กรุณาเลือกคำนำหน้า";
  if (!a.firstnameTh.trim()) errors.firstnameTh = "กรุณากรอกชื่อ";
  if (!a.lastnameTh.trim()) errors.lastnameTh = "กรุณากรอกนามสกุล";
  if (!isValidThaiNationalId(a.cid.trim())) errors.cid = "เลขบัตรประชาชนไม่ถูกต้อง";
  if (!a.positionTh.trim()) errors.positionTh = "กรุณากรอกตำแหน่ง";
  if (!a.departmentTh.trim()) errors.departmentTh = "กรุณากรอกฝ่าย/กอง/สำนัก";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.email.trim())) errors.email = "กรุณากรอกอีเมลให้ถูกต้อง";
  if (!/^\d{9,10}$/.test(a.phoneNumber.replace(/\D/g, ""))) errors.phoneNumber = "กรุณากรอกเบอร์โทรศัพท์ 9–10 หลัก";
  return errors;
}
