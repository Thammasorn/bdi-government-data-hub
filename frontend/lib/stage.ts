/**
 * คำศัพท์ "ด่าน" ของหน้ารายการ — ป้ายบนเม็ดกรองต้องเป็นคำเดียวกับ badge ในแถว
 *
 * เม็ดกรองเคยกรองด้วย `status` ซึ่งกรองผิดระดับ: `SUBMITTED` แปลว่า "มีด่านค้างอยู่
 * และยังไม่มีใครกดเปิด" ไม่ว่าด่านนั้นจะเป็นด่านไหน เม็ดเดียวจึงกวาดงานของคนละคน
 * มารวมกันแล้วเขียนป้ายเดียวกันว่า "นำส่งแล้ว"
 *
 * โทเคนที่นี่ = ป้ายหนึ่งแบบที่ stageMeta() วาดได้ ผู้ใช้จึงกรองด้วยคำที่เขาเห็น
 *
 * **ไม่มีสำเนาของ map role→ด่าน ที่นี่โดยตั้งใจ** — `/summary` ส่ง `myStages` มาให้
 * ธรรมเนียม "สำเนาโดยตั้งใจ" ของ lib/dataset-form.ts มีไว้สำหรับสิ่งที่หน้าจอต้องรู้
 * *ก่อน* เครือข่ายตอบ ซึ่งแท็บที่รอตัวเลขอยู่แล้วไม่ใช่ ถ้าสองฝั่งเดินคนละทาง
 * หน้าจอจะบอกคนผิดว่าไม่มีงาน ซึ่งเป็นความผิดพลาดที่เงียบที่สุดของงานนี้
 */
import {
  REQUEST_STATUS_META,
  TASK_TYPE_META,
  type RequestStatus,
  type ReviewTaskType,
} from "@/lib/status";

export type StageToken =
  | Exclude<ReviewTaskType, "ORGANIZATION_REVISION">
  | Exclude<RequestStatus, "SUBMITTED" | "UNDER_REVIEW">;

/**
 * ป้ายยาวใช้กับ badge อยู่แล้ว — เม็ดกรองกับการ์ดสรุปต้องการฉบับสั้น
 * แต่ทั้งสองแบบต้องมาจากตารางเดียวกัน ไม่ใช่พิมพ์ใหม่
 */
export const STAGE_META: Record<StageToken, { label: string; short: string; className: string }> = {
  BDI_OFFICER_REVIEW: { ...TASK_TYPE_META.BDI_OFFICER_REVIEW, short: "รอ BDI ตรวจสอบ" },
  DATASET_SPECIALIST_REVIEW: {
    ...TASK_TYPE_META.DATASET_SPECIALIST_REVIEW,
    short: "รอผู้เชี่ยวชาญ",
  },
  ORGANIZATION_APPROVAL: {
    ...TASK_TYPE_META.ORGANIZATION_APPROVAL,
    short: "รอหน่วยงานลงนาม",
  },
  BDI_FINAL_APPROVAL: { ...TASK_TYPE_META.BDI_FINAL_APPROVAL, short: "รอ BDI อนุมัติ" },
  DRAFT: { ...REQUEST_STATUS_META.DRAFT, short: "ฉบับร่าง" },
  RETURNED: { ...REQUEST_STATUS_META.RETURNED, short: "รอการแก้ไข" },
  APPROVED: { ...REQUEST_STATUS_META.APPROVED, short: "อนุมัติแล้ว" },
  REJECTED: { ...REQUEST_STATUS_META.REJECTED, short: "ไม่อนุมัติ" },
  CANCELLED: { ...REQUEST_STATUS_META.CANCELLED, short: "ยกเลิกแล้ว" },
};

/** ประโยคบนการ์ดสรุป — พูดกับเจ้าของงานตรง ๆ ไม่ใช่บรรยายสถานะ */
export const MY_STAGE_HEADLINE: Record<StageToken, string> = {
  BDI_OFFICER_REVIEW: "รอคุณตรวจสอบ",
  DATASET_SPECIALIST_REVIEW: "รอคุณให้ความเห็น",
  ORGANIZATION_APPROVAL: "รอคุณลงนาม",
  BDI_FINAL_APPROVAL: "รอคุณอนุมัติ",
  DRAFT: "ฉบับร่างที่ยังไม่ได้นำส่ง",
  RETURNED: "รอคุณแก้ไขและนำส่งใหม่",
  APPROVED: "อนุมัติแล้ว",
  REJECTED: "ไม่อนุมัติ",
  CANCELLED: "ยกเลิกแล้ว",
};

/** GET /api/{organizations,dataset-requests}/summary */
export interface ListSummary {
  total: number;
  /** ลำดับของคีย์คือลำดับที่เม็ดกรองควรเรียง — เส้นทางหน่วยงานไม่มีด่านผู้เชี่ยวชาญ */
  stages: Partial<Record<StageToken, number>>;
  myStages: StageToken[];
  mine: number;
}

export interface PageInfo {
  page: number;
  pageSize: number;
  total: number;
  pageCount: number;
}

export type SortOrder = "date_desc" | "date_asc";

export const SORT_LABELS: Record<SortOrder, string> = {
  date_desc: "ใหม่ → เก่า",
  date_asc: "เก่า → ใหม่",
};

/**
 * ผู้ใช้คนนี้มีด่านเป็นของตัวเองไหม — ใช้ตัดสิน **แค่ว่าจะเปิดแท็บไหนก่อน** ตอนที่
 * ยังไม่มีคำตอบจาก `/summary`
 *
 * คำตอบจริงคือ `myStages` ที่ server ส่งมา (คำนวณจาก TASK_TYPE_ROLES ที่เดียว)
 * ที่นี่จึงเก็บแค่รายชื่อ role ที่ *ไม่มี* ด่านเลย ซึ่งสั้นและเปลี่ยนแทบไม่ได้ ถ้าเดาผิด
 * ผลคือแท็บเปิดผิดอันหนึ่งครั้ง ไม่ใช่ข้อมูลผิด — จงใจแลกไว้แบบนี้ เพราะทางเลือกอื่น
 * คือให้แท็บสลับเองหลังโหลดเสร็จ ซึ่งเห็นกระพริบทุกครั้งที่เข้าหน้า
 */
const ROLES_WITHOUT_QUEUE = ["SYSTEM_ADMINISTRATOR", "BDI_LEGAL_OFFICER"];

export const hasOwnQueue = (roles: string[]) =>
  roles.some((r) => !ROLES_WITHOUT_QUEUE.includes(r));
