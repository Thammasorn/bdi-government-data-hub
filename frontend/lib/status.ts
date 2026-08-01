export type OrganizationStatus =
  | "DRAFT"
  | "PENDING_BDI_REVIEW"
  | "NEEDS_REVISION"
  | "PENDING_SIGNATORY_REVIEW"
  | "PENDING_BDI_APPROVAL"
  | "ACTIVE";

export type Role =
  | "BDI_OFFICER"
  | "BDI_APPROVER"
  | "BDI_SPECIALIST"
  | "ORGANIZATION_USER"
  | "ORGANIZATION_APPROVER";

/** สีตาม docs/02-ui-spec.md §1.3 — ทุก badge มีทั้งสีและข้อความ ไม่สื่อด้วยสีอย่างเดียว */
export const STATUS_META: Record<OrganizationStatus, { label: string; className: string }> = {
  DRAFT: { label: "ฉบับร่าง", className: "bg-navy-50 text-ink-muted" },
  PENDING_BDI_REVIEW: { label: "รอตรวจสอบจาก BDI", className: "bg-warning-bg text-warning" },
  PENDING_SIGNATORY_REVIEW: { label: "รอตรวจสอบจากผู้มีอำนาจ", className: "bg-navy-100 text-navy-600" },
  PENDING_BDI_APPROVAL: { label: "รอ BDI ลงนาม", className: "bg-navy-100 text-navy-800" },
  NEEDS_REVISION: { label: "รอการแก้ไข", className: "bg-danger-bg text-danger" },
  ACTIVE: { label: "เปิดใช้งาน", className: "bg-success-bg text-success" },
};

export const ROLE_LABELS: Record<Role, string> = {
  BDI_OFFICER: "เจ้าหน้าที่ BDI",
  BDI_APPROVER: "ผู้อนุมัติ BDI",
  BDI_SPECIALIST: "ผู้เชี่ยวชาญ BDI",
  ORGANIZATION_USER: "ผู้ใช้จากหน่วยงาน",
  ORGANIZATION_APPROVER: "ผู้มีอำนาจกระทำการแทน",
};

export const EVENT_LABELS: Record<string, string> = {
  CREATED: "สร้างคำขอ",
  DRAFT_SAVED: "บันทึกฉบับร่าง",
  SUBMITTED: "นำส่งฟอร์มสร้างหน่วยงาน",
  BDI_APPROVED: "เจ้าหน้าที่ BDI อนุมัติ",
  BDI_REVISION_REQUESTED: "เจ้าหน้าที่ BDI ขอให้ปรับปรุง",
  SIGNATORY_INVITED: "ส่งคำเชิญให้ผู้มีอำนาจกระทำการแทน",
  SIGNATORY_APPROVED: "ผู้มีอำนาจกระทำการแทนเห็นชอบ",
  SIGNATORY_REVISION_REQUESTED: "ผู้มีอำนาจกระทำการแทนขอให้ปรับปรุง",
  FINAL_APPROVED: "BDI เห็นชอบและลงนาม",
  FINAL_REVISION_REQUESTED: "ผู้อนุมัติ BDI ขอให้ปรับปรุง",
};

export const isBdiStaff = (roles: string[]) =>
  roles.some((r) => r === "BDI_OFFICER" || r === "BDI_APPROVER" || r === "BDI_SPECIALIST");

export const PREFIXES = ["นาย", "นาง", "นางสาว", "ดร.", "ผศ.ดร.", "รศ.ดร.", "ศ.ดร."];

export function formatThaiDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  }).format(d);
}
