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

// ------------------------------------------------------------------ ชุดข้อมูล (Journey C)

export type DatasetRequestStatus =
  | "DRAFT"
  | "PENDING_OFFICER_REVIEW"
  | "PENDING_ORG_APPROVER"
  | "PENDING_OFFICER_FINAL_CHECK"
  | "PENDING_BDI_APPROVAL"
  | "NEEDS_REVISION"
  | "APPROVED"
  | "REJECTED";

/** สีชุดเดียวกับสถานะหน่วยงาน — ทุก badge มีทั้งสีและข้อความ ไม่สื่อด้วยสีอย่างเดียว */
export const DATASET_STATUS_META: Record<DatasetRequestStatus, { label: string; className: string }> = {
  DRAFT: { label: "ฉบับร่าง", className: "bg-navy-50 text-ink-muted" },
  PENDING_OFFICER_REVIEW: { label: "รอ BDI ตรวจสอบเบื้องต้น", className: "bg-warning-bg text-warning" },
  PENDING_ORG_APPROVER: { label: "รอผู้มีอำนาจของหน่วยงาน", className: "bg-navy-100 text-navy-600" },
  PENDING_OFFICER_FINAL_CHECK: { label: "รอ BDI ตรวจสอบขั้นสุดท้าย", className: "bg-warning-bg text-warning" },
  PENDING_BDI_APPROVAL: { label: "รอ BDI อนุมัติ", className: "bg-navy-100 text-navy-800" },
  NEEDS_REVISION: { label: "รอการแก้ไข", className: "bg-danger-bg text-danger" },
  APPROVED: { label: "อนุมัติแล้ว", className: "bg-success-bg text-success" },
  REJECTED: { label: "ไม่อนุมัติ", className: "bg-danger-bg text-danger" },
};

export const DATASET_EVENT_LABELS: Record<string, string> = {
  CREATED: "สร้างคำขอ",
  SUBMITTED: "นำส่งคำขอ",
  SPECIALIST_ASSIGNED: "มอบหมายผู้เชี่ยวชาญ",
  SPECIALIST_UNASSIGNED: "ยกเลิกการมอบหมายผู้เชี่ยวชาญ",
  SPECIALIST_COMMENTED: "ผู้เชี่ยวชาญบันทึกความเห็น",
  SPECIALIST_REVISION_REQUESTED: "ผู้เชี่ยวชาญขอให้ปรับปรุง",
  OFFICER_FORWARDED: "เจ้าหน้าที่ BDI ส่งต่อให้ผู้มีอำนาจ",
  OFFICER_REVISION_REQUESTED: "เจ้าหน้าที่ BDI ขอให้ปรับปรุง",
  ORG_APPROVER_SIGNED: "ผู้มีอำนาจกระทำการแทนลงนามเห็นชอบ",
  ORG_APPROVER_REVISION_REQUESTED: "ผู้มีอำนาจกระทำการแทนขอให้ปรับปรุง",
  OFFICER_CONFIRMED: "เจ้าหน้าที่ BDI ยืนยันผลการตรวจสอบ",
  OFFICER_FINAL_REVISION_REQUESTED: "เจ้าหน้าที่ BDI ขอให้ปรับปรุง (ตรวจขั้นสุดท้าย)",
  BDI_APPROVED: "ผู้อนุมัติ BDI อนุมัติ",
  BDI_REJECTED: "ผู้อนุมัติ BDI ไม่อนุมัติ",
  BDI_REVISION_REQUESTED: "ผู้อนุมัติ BDI ขอให้ปรับปรุง",
};

/** ป้ายของ enum ในแบบฟอร์ม — ต้องตรงกับ backend/src/lib/dataset.ts */
export const DATASET_TYPE_LABELS = {
  RECORD: "ข้อมูลระเบียน",
  STATISTIC: "ข้อมูลสถิติ",
  GEOGRAPHIC: "ข้อมูลภูมิสารสนเทศ",
  MULTIMEDIA: "ข้อมูลมัลติมีเดีย",
  OTHER: "อื่น ๆ",
} as const;

export const DATASET_CATEGORY_LABELS = {
  ECONOMY_FINANCE: "เศรษฐกิจ การเงินและการคลัง",
  AGRICULTURE: "เกษตรกรรม",
  HEALTH: "สาธารณสุข",
  EDUCATION: "การศึกษา",
  TRANSPORT: "คมนาคมและขนส่ง",
  ENERGY: "พลังงาน",
  ENVIRONMENT: "ทรัพยากรธรรมชาติและสิ่งแวดล้อม",
  SOCIETY: "สังคมและสวัสดิการ",
  PUBLIC_SAFETY: "ความมั่นคงและความปลอดภัย",
  SCIENCE_TECH: "วิทยาศาสตร์ เทคโนโลยีและดิจิทัล",
  TOURISM_SPORT: "การท่องเที่ยวและกีฬา",
  GOVERNMENT: "การบริหารราชการ",
} as const;

export const FREQUENCY_LABELS = {
  REAL_TIME: "ทันที (real-time)",
  DAILY: "รายวัน",
  WEEKLY: "รายสัปดาห์",
  MONTHLY: "รายเดือน",
  QUARTERLY: "รายไตรมาส",
  BIANNUAL: "ราย 6 เดือน",
  YEARLY: "รายปี",
  AS_NEEDED: "ตามความจำเป็น",
} as const;

export const GEO_COVERAGE_LABELS = {
  NATIONAL: "ทั้งประเทศ",
  REGIONAL: "รายภาค",
  PROVINCIAL: "รายจังหวัด",
  DISTRICT: "รายอำเภอ/เขต",
  OTHER: "อื่น ๆ",
} as const;

export const DELIVERY_METHOD_LABELS = {
  API: "API",
  SFTP: "SFTP",
  DATABASE: "เชื่อมต่อฐานข้อมูลโดยตรง",
  FILE_UPLOAD: "อัปโหลดไฟล์เข้าระบบ",
  OTHER: "อื่น ๆ",
} as const;

export const DATA_FORMAT_LABELS = {
  CSV: "CSV",
  JSON: "JSON",
  XLSX: "Excel (XLSX)",
  XML: "XML",
  PARQUET: "Parquet",
  SHAPEFILE: "Shapefile",
  OTHER: "อื่น ๆ",
} as const;

export const CLASSIFICATION_LABELS = {
  PUBLIC: "สาธารณะ",
  INTERNAL: "ใช้ภายในหน่วยงาน",
  CONFIDENTIAL: "ลับ",
  SECRET: "ลับมาก",
} as const;

export const LICENSE_LABELS = {
  OPEN_GOVERNMENT: "Open Government License",
  CC_BY: "CC-BY",
  CC_BY_SA: "CC-BY-SA",
  CC_BY_NC: "CC-BY-NC",
  INTERNAL_ONLY: "ใช้ภายในเท่านั้น",
  OTHER: "อื่น ๆ",
} as const;

/** วิธีการนำส่งที่ต้องระบุปลายทาง — ตรงกับ ENDPOINT_REQUIRED ฝั่ง backend */
export const ENDPOINT_REQUIRED_METHODS = ["API", "SFTP", "DATABASE"];

/** ตัวช่วยทำ <option> จาก label map โดยคงลำดับที่ประกาศไว้ */
export const optionsOf = <T extends Record<string, string>>(map: T) =>
  Object.entries(map) as Array<[keyof T & string, string]>;

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
