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

export const ROLE_LABELS: Record<Role, string> = {
  ORGANIZATION_USER: "ผู้ดำเนินการของหน่วยงาน",
  ORGANIZATION_APPROVER: "ผู้มีอำนาจกระทำการแทนของหน่วยงาน",
  BDI_OFFICER: "ผู้ดำเนินการของ BDI",
  BDI_DATASET_SPECIALIST: "ผู้เชี่ยวชาญด้านข้อมูลของ BDI",
  BDI_FINAL_APPROVER: "ผู้มีอำนาจอนุมัติฝ่าย BDI",
  BDI_LEGAL_OFFICER: "ผู้ดำเนินการทางกฎหมายของ BDI",
  SYSTEM_ADMINISTRATOR: "ผู้ดูแลระบบ",
};

/**
 * ภาษาไทยไม่เว้นวรรคระหว่างคำ — ยกเว้นเมื่อคำก่อนหน้าลงท้ายด้วยอักษรละติน
 * "ผู้ดำเนินการของ BDI" + "ตรวจสอบ" ต่อกันตรง ๆ ได้ "BDIตรวจสอบ" ซึ่งอ่านเป็นคำเดียว
 */
export const roleGap = (label: string) => (/[A-Za-z0-9)]$/.test(label) ? " " : "");

/** ชื่อบทบาท + สิ่งที่บทบาทนั้นทำ — ทุกประโยคบอกด่านในหน้าจอประกอบจากตรงนี้ */
export const withRole = (role: Role, action: string) => {
  const label = ROLE_LABELS[role];
  return `${label}${roleGap(label)}${action}`;
};

/**
 * ด่านหนึ่ง = บทบาทหนึ่ง — ใช้ชี้ไปที่ `ROLE_LABELS` แทนที่จะมีคำเรียกของตัวเอง
 *
 * เดิมมีชุดคำเรียกบทบาทอยู่สามชุดในหน้าจอ ("เจ้าหน้าที่ BDI" ที่ timeline, "รอ BDI ตรวจสอบ"
 * ที่ badge ในตาราง, "ผู้ดำเนินการของ BDI" ที่อีเมลและ API) ผู้ใช้คนเดียวกันจึงเห็นด่านเดียวกัน
 * ถูกเรียกคนละชื่อระหว่างอีเมลที่ได้รับ ตารางที่เปิดอยู่ และหน้ารายละเอียดที่กดเข้าไป
 */
export const TASK_TYPE_ROLE: Record<ReviewTaskType, Role> = {
  BDI_OFFICER_REVIEW: "BDI_OFFICER",
  DATASET_SPECIALIST_REVIEW: "BDI_DATASET_SPECIALIST",
  ORGANIZATION_APPROVAL: "ORGANIZATION_APPROVER",
  BDI_FINAL_APPROVAL: "BDI_FINAL_APPROVER",
  ORGANIZATION_REVISION: "ORGANIZATION_USER",
};


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
    if (currentTaskType === "ORGANIZATION_REVISION") return "รอหน่วยงานของคุณแก้ไข";
    /**
     * ด่านผู้เชี่ยวชาญไม่ใช่ด่านที่คำขอค้างอยู่ได้อีกแล้ว (2026-08-30) — คำขอยังอยู่กับ
     * เจ้าหน้าที่ตลอดเวลาที่ขอความเห็น จึงตอบชื่อเดียวกับด่านของเจ้าหน้าที่
     */
    const role =
      currentTaskType === "DATASET_SPECIALIST_REVIEW"
        ? TASK_TYPE_ROLE.BDI_OFFICER_REVIEW
        : TASK_TYPE_ROLE[currentTaskType];
    return withRole(role, "กำลังดำเนินการ");
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

/** สิ่งที่แต่ละด่านทำ — สำเนาของ REVIEW_TASK_ACTION ใน backend/src/lib/roles.ts */
const TASK_TYPE_ACTION: Record<ReviewTaskType, string> = {
  BDI_OFFICER_REVIEW: "ตรวจสอบเอกสาร",
  DATASET_SPECIALIST_REVIEW: "พิจารณา",
  ORGANIZATION_APPROVAL: "ลงนามเห็นชอบ",
  BDI_FINAL_APPROVAL: "ดำเนินการอนุมัติ",
  ORGANIZATION_REVISION: "แก้ไข",
};

const TASK_TYPE_TONE: Record<ReviewTaskType, string> = {
  BDI_OFFICER_REVIEW: "bg-warning-bg text-warning",
  DATASET_SPECIALIST_REVIEW: "bg-navy-100 text-navy-600",
  ORGANIZATION_APPROVAL: "bg-navy-100 text-navy-600",
  BDI_FINAL_APPROVAL: "bg-navy-100 text-navy-800",
  ORGANIZATION_REVISION: "bg-danger-bg text-danger",
};

/**
 * ด่านที่คำขอกำลังรออยู่ — แทน PENDING_* ที่หายไปจาก status
 *
 * ประกอบจาก `ROLE_LABELS` ตัวเดียวกับที่อีเมลและ API ใช้ ไม่ใช่ชุดคำของหน้าจอเอง —
 * badge ในตาราง กับ badge ในหน้ารายละเอียด เคยเรียกด่านเดียวกันคนละชื่อ
 */
export const TASK_TYPE_META: Record<ReviewTaskType, { label: string; className: string }> =
  Object.fromEntries(
    (Object.keys(TASK_TYPE_ACTION) as ReviewTaskType[]).map((t) => [
      t,
      {
        // แถวของผู้เชี่ยวชาญเป็นความเห็นที่บันทึกไปแล้ว ไม่ใช่ด่านที่ใครกำลังรอ
        label:
          t === "DATASET_SPECIALIST_REVIEW"
            ? `ความเห็นของ${ROLE_LABELS[TASK_TYPE_ROLE[t]]}`
            : `รอ${withRole(TASK_TYPE_ROLE[t], TASK_TYPE_ACTION[t])}`,
        className: TASK_TYPE_TONE[t],
      },
    ]),
  ) as Record<ReviewTaskType, { label: string; className: string }>;

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

/**
 * บรรทัด timeline — ประกอบจาก review_task ไม่ใช่ตาราง event เดิม
 * ("ผู้เชี่ยวชาญบันทึกความเห็น" = DATASET_SPECIALIST_REVIEW ที่ result = CONFIRMED)
 */
export function taskEventLabel(taskType: ReviewTaskType, result?: ReviewResult | null): string {
  const actor = ROLE_LABELS[TASK_TYPE_ROLE[taskType]];
  const gap = roleGap(actor);

  if (!result) return `รอ${actor}${gap}ดำเนินการ`;
  return `${actor}${gap}${
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

// ป้ายของแบบฟอร์มชุดข้อมูลย้ายไป lib/dataset-form.ts ทั้งชุด พร้อมกับกฎในชีท conditions
// ที่ต้องอ่านคู่กัน — ดูหัวไฟล์นั้นว่าทำไมจึงเป็นสำเนาของ backend/src/lib/dataset.ts

export const isBdiStaff = (roles: string[]) =>
  roles.some((r) =>
    ["BDI_OFFICER", "BDI_DATASET_SPECIALIST", "BDI_FINAL_APPROVER", "BDI_LEGAL_OFFICER"].includes(r),
  );

/**
 * ผู้เชี่ยวชาญข้อมูลที่ไม่ได้ถือ role อื่นของ BDI ด้วย — เมนูของเขามีรายการเดียว
 * คือชุดข้อมูลที่ถูกมอบหมาย (ดู navItems ใน components/AppShell.tsx)
 */
export const isSpecialistOnly = (roles: string[]) =>
  roles.includes("BDI_DATASET_SPECIALIST") &&
  !roles.includes("BDI_OFFICER") &&
  !roles.includes("BDI_FINAL_APPROVER");

/**
 * หน้าแรกของเจ้าหน้าที่ BDI หลังเข้าสู่ระบบ
 *
 * ทุกที่เคยส่งไป `/admin/organizations` ตรง ๆ ซึ่งเป็นหน้าที่ **ไม่มีในเมนู**
 * ของผู้เชี่ยวชาญ เขาจึงถูกพาไปยืนอยู่บนหน้าที่กดกลับมาเองไม่ได้ทุกครั้งที่ล็อกอิน
 */
export const bdiLandingPath = (roles: string[]) =>
  isSpecialistOnly(roles) ? "/admin/datasets" : "/admin/organizations";

/**
 * role ที่ผูกกับหน่วยงาน — ตรงกับ ORGANIZATION_SCOPED_ROLES ใน backend/src/lib/system.ts
 * สองตัวนี้บังคับกรอกเลขประจำตัวประชาชนตอนลงทะเบียน (ดีไซน์มาร์ก cid เป็น Required)
 */
export const isOrganizationScopedRole = (role: string) =>
  role === "ORGANIZATION_USER" || role === "ORGANIZATION_APPROVER";

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

/**
 * จำนวนวันเต็มนับจากวันที่ให้มาถึงตอนนี้ — ใช้บอก "รอมาแล้ว N วัน"
 *
 * ย้ายมาจาก components/home/DatasetSection.tsx ตอนที่กล่องรายละเอียดของตารางต้องใช้
 * ตัวเดียวกัน สองที่ที่นับวันคนละแบบจะให้ตัวเลขไม่ตรงกันในหน้าจอเดียว
 */
export function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}
