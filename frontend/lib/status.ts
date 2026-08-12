/**
 * ป้ายและสีของสถานะ — ตรงกับสคีมาใน
 * assets/db_schema/draft_db_design_downloaded_on_2026-08-11.xlsx
 *
 * สถานะของ "คำขอ" ยุบเหลือเจ็ดค่าที่ใช้ร่วมกันทั้ง Journey B และ C ส่วน "ด่านที่กำลังรอ"
 * ย้ายไปอยู่ที่ review_task แล้ว API จึงส่ง currentTaskType มาคู่กับ status เสมอ
 * badge บนหน้าจอควรแสดง stageLabel() ซึ่งเลือกใช้ด่านเมื่อมี และใช้สถานะเมื่อไม่มี
 */

/** organization.organization — sheet `organization` */
export type OrganizationStatus = "PENDING_REGISTRATION" | "ACTIVE" | "SUSPENDED" | "INACTIVE";

/** สถานะคำขอ — ชุดเดียวกันทั้งสอง Journey */
export type RequestStatus =
  | "DRAFT"
  | "SUBMITTED"
  | "UNDER_REVIEW"
  | "RETURNED"
  | "APPROVED"
  | "REJECTED"
  | "CANCELLED";

/** review.review_task.task_type */
export type ReviewTaskType =
  | "BDI_OFFICER_REVIEW"
  | "DATASET_SPECIALIST_REVIEW"
  | "ORGANIZATION_APPROVAL"
  | "BDI_FINAL_APPROVAL"
  | "ORGANIZATION_REVISION";

/** review.review_task.result */
export type ReviewResult =
  | "PASSED"
  | "APPROVED"
  | "RETURNED"
  | "REJECTED"
  | "CONFIRMED"
  | "COMPLETED";

/** iam.role.code — sheet `role` */
export type Role =
  | "ORGANIZATION_USER"
  | "ORGANIZATION_APPROVER"
  | "BDI_OFFICER"
  | "BDI_DATASET_SPECIALIST"
  | "BDI_FINAL_APPROVER"
  | "BDI_LEGAL_OFFICER"
  | "SYSTEM_ADMINISTRATOR";

/** สีตาม docs/02-ui-spec.md §1.3 — ทุก badge มีทั้งสีและข้อความ ไม่สื่อด้วยสีอย่างเดียว */
export const REQUEST_STATUS_META: Record<RequestStatus, { label: string; className: string }> = {
  DRAFT: { label: "ฉบับร่าง", className: "bg-navy-50 text-ink-muted" },
  SUBMITTED: { label: "นำส่งแล้ว", className: "bg-warning-bg text-warning" },
  UNDER_REVIEW: { label: "กำลังพิจารณา", className: "bg-navy-100 text-navy-600" },
  RETURNED: { label: "รอการแก้ไข", className: "bg-danger-bg text-danger" },
  APPROVED: { label: "อนุมัติแล้ว", className: "bg-success-bg text-success" },
  REJECTED: { label: "ไม่อนุมัติ", className: "bg-danger-bg text-danger" },
  CANCELLED: { label: "ยกเลิกแล้ว", className: "bg-navy-50 text-ink-muted" },
};

export const ORGANIZATION_STATUS_META: Record<
  OrganizationStatus,
  { label: string; className: string }
> = {
  PENDING_REGISTRATION: { label: "อยู่ระหว่างลงทะเบียน", className: "bg-warning-bg text-warning" },
  ACTIVE: { label: "เปิดใช้งาน", className: "bg-success-bg text-success" },
  SUSPENDED: { label: "ระงับชั่วคราว", className: "bg-danger-bg text-danger" },
  INACTIVE: { label: "ยุติการใช้งาน", className: "bg-navy-50 text-ink-muted" },
};

/**
 * คำขอที่ยัง "เดินอยู่ในสายพาน" — ยังไม่จบ และไม่ได้ค้างอยู่ที่หน่วยงาน
 * หน้าแรกใช้ชุดนี้แยก section บนออกจากรายการชุดข้อมูลทั้งหมด
 *
 * เดิมเป็นรายการของ PENDING_* ทีละด่าน ตอนนี้ด่านย้ายไป review_task แล้ว
 * เหลือสองสถานะที่แปลว่ากำลังรอผู้ตรวจ: นำส่งแล้วแต่ยังไม่มีใครเปิด และเปิดตรวจอยู่
 */
export const PENDING_DATASET_STATUSES: RequestStatus[] = ["SUBMITTED", "UNDER_REVIEW"];

export const isPendingDatasetStatus = (status: RequestStatus) =>
  PENDING_DATASET_STATUSES.includes(status);

/**
 * ประโยคบอกผู้ใช้ว่า "ตอนนี้ใครถืออยู่" ไม่ใช่แค่ชื่อสถานะ
 *
 * ระหว่างที่คำขอเดินอยู่ คำตอบมาจากด่านใน review_task ส่วนสถานะที่จบแล้วหรือ
 * ยังไม่ได้เริ่ม ตอบจากตัวสถานะเอง
 */
export function datasetPendingOwner(
  status: RequestStatus,
  currentTaskType?: ReviewTaskType | null,
): string {
  if (currentTaskType && isPendingDatasetStatus(status)) {
    return {
      BDI_OFFICER_REVIEW: "เจ้าหน้าที่ BDI กำลังตรวจสอบ",
      DATASET_SPECIALIST_REVIEW: "ผู้เชี่ยวชาญด้านข้อมูลกำลังพิจารณา",
      ORGANIZATION_APPROVAL: "ผู้มีอำนาจกระทำการแทนของหน่วยงานกำลังพิจารณา",
      BDI_FINAL_APPROVAL: "ผู้อนุมัติ BDI กำลังพิจารณา",
      ORGANIZATION_REVISION: "รอหน่วยงานของคุณแก้ไข",
    }[currentTaskType];
  }
  return {
    DRAFT: "ยังเป็นฉบับร่าง ยังไม่ได้นำส่ง",
    SUBMITTED: "รอผู้ตรวจเริ่มดำเนินการ",
    UNDER_REVIEW: "อยู่ระหว่างการพิจารณา",
    RETURNED: "รอหน่วยงานของคุณแก้ไขและนำส่งใหม่",
    APPROVED: "อนุมัติเรียบร้อยแล้ว",
    REJECTED: "ไม่ได้รับอนุมัติ",
    CANCELLED: "ยกเลิกแล้ว",
  }[status];
}

/** ด่านที่คำขอกำลังรออยู่ — แทน PENDING_* ที่หายไปจาก status */
export const TASK_TYPE_META: Record<ReviewTaskType, { label: string; className: string }> = {
  BDI_OFFICER_REVIEW: { label: "รอเจ้าหน้าที่ BDI ตรวจสอบ", className: "bg-warning-bg text-warning" },
  DATASET_SPECIALIST_REVIEW: {
    label: "รอผู้เชี่ยวชาญด้านข้อมูลพิจารณา",
    className: "bg-navy-100 text-navy-600",
  },
  ORGANIZATION_APPROVAL: {
    label: "รอผู้มีอำนาจของหน่วยงานลงนาม",
    className: "bg-navy-100 text-navy-600",
  },
  BDI_FINAL_APPROVAL: { label: "รอ BDI อนุมัติขั้นสุดท้าย", className: "bg-navy-100 text-navy-800" },
  ORGANIZATION_REVISION: { label: "รอหน่วยงานแก้ไข", className: "bg-danger-bg text-danger" },
};

export const REVIEW_RESULT_LABELS: Record<ReviewResult, string> = {
  PASSED: "ผ่านการตรวจสอบ",
  APPROVED: "อนุมัติ",
  RETURNED: "ส่งกลับให้แก้ไข",
  REJECTED: "ไม่อนุมัติ",
  CONFIRMED: "ยืนยันผลการตรวจสอบ",
  COMPLETED: "ดำเนินการเสร็จ",
};

/**
 * badge ที่ผู้ใช้ควรเห็น
 *
 * ระหว่างที่คำขอยังเดินอยู่ ด่านบอกความหมายได้มากกว่าสถานะ (SUBMITTED เฉย ๆ
 * ไม่บอกว่ารอใคร) จบแล้วค่อยกลับไปใช้สถานะ
 */
export function stageMeta(
  status: RequestStatus,
  currentTaskType?: ReviewTaskType | null,
): { label: string; className: string } {
  if (currentTaskType && (status === "SUBMITTED" || status === "UNDER_REVIEW")) {
    return TASK_TYPE_META[currentTaskType];
  }
  return REQUEST_STATUS_META[status];
}

export const ROLE_LABELS: Record<Role, string> = {
  ORGANIZATION_USER: "ผู้ดำเนินการของหน่วยงาน",
  ORGANIZATION_APPROVER: "ผู้มีอำนาจกระทำการแทนของหน่วยงาน",
  BDI_OFFICER: "ผู้ดำเนินการของ BDI",
  BDI_DATASET_SPECIALIST: "ผู้เชี่ยวชาญด้านข้อมูลของ BDI",
  BDI_FINAL_APPROVER: "ผู้มีอำนาจกระทำการแทนของ BDI",
  BDI_LEGAL_OFFICER: "ผู้ดำเนินการทางกฎหมายของ BDI",
  SYSTEM_ADMINISTRATOR: "ผู้ดูแลระบบ",
};

/**
 * บรรทัด timeline — ประกอบจาก review_task ไม่ใช่ตาราง event เดิม
 * ("ผู้เชี่ยวชาญบันทึกความเห็น" = DATASET_SPECIALIST_REVIEW ที่ result = CONFIRMED)
 */
export function taskEventLabel(taskType: ReviewTaskType, result?: ReviewResult | null): string {
  const actor = {
    BDI_OFFICER_REVIEW: "เจ้าหน้าที่ BDI",
    DATASET_SPECIALIST_REVIEW: "ผู้เชี่ยวชาญด้านข้อมูล",
    ORGANIZATION_APPROVAL: "ผู้มีอำนาจกระทำการแทน",
    BDI_FINAL_APPROVAL: "ผู้อนุมัติ BDI",
    ORGANIZATION_REVISION: "หน่วยงาน",
  }[taskType];

  if (!result) return `รอ${actor}ดำเนินการ`;
  return `${actor}${
    {
      PASSED: "ตรวจสอบผ่าน",
      APPROVED: "อนุมัติ",
      RETURNED: "ขอให้ปรับปรุง",
      REJECTED: "ไม่อนุมัติ",
      CONFIRMED: "ยืนยันผลการตรวจสอบ",
      COMPLETED: "ดำเนินการเสร็จ",
    }[result]
  }`;
}

// เก็บชื่อเดิมไว้ให้โค้ดหน้าเว็บที่ยังอ้างถึงอยู่ ไม่ต้องแก้ทุกไฟล์พร้อมกัน
export const STATUS_META = REQUEST_STATUS_META;
export const DATASET_STATUS_META = REQUEST_STATUS_META;
export type DatasetRequestStatus = RequestStatus;

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
  roles.some((r) =>
    ["BDI_OFFICER", "BDI_DATASET_SPECIALIST", "BDI_FINAL_APPROVER", "BDI_LEGAL_OFFICER"].includes(r),
  );

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
