/**
 * รูปร่างของเส้นทางอนุมัติที่ `/summary` ส่งมา — โหนด เส้นเชื่อม และตัวเลข
 *
 * ไฟล์นี้ **ไม่รู้จักเส้นทางไหนเลย** และต้องเป็นแบบนั้นต่อไป: ลำดับด่านประกาศไว้ที่
 * `backend/src/lib/journey-steps.ts` ที่เดียว (กติกาเดียวกับที่ ApprovalSteps.tsx และ
 * lib/types.ts เขียนไว้) และคำตอบว่า "ช่องไหนเป็นของฉัน" ก็มาจาก server เช่นกัน —
 * map role→ช่อง ฝั่งหน้าเว็บจะเดาผิดแล้วโชว์ **แถวผิด** ไม่ใช่แค่ป้ายผิด
 *
 * สิ่งเดียวที่ไฟล์นี้เป็นเจ้าของคือ **สี** ซึ่งเป็นเรื่องการนำเสนอ ไม่ใช่ข้อมูล จึงไม่ควร
 * เดินทางมากับ API — server ส่งชื่อโทนมา ที่นี่แปลเป็นคลาส (Tailwind สแกน static
 * คลาสจึงต้องเป็นสตริงเต็มในไฟล์นี้)
 */

/** ช่องของแผนภาพที่โหนดไปอยู่ */
export type NodeLane = "main" | "branch" | "revision" | "closed";

export type NodeTone = "neutral" | "review" | "approval" | "success" | "danger";

export type EdgeKind = "chain" | "branch" | "return" | "resubmit";

/**
 * คีย์ของโหนดเป็น string ธรรมดาโดยตั้งใจ — union ที่แคบกว่านี้ต้องรู้จัก StepKey
 * ซึ่งแปลว่าต้องรู้ลำดับด่าน ห้าปลายทางที่หน้าเว็บเป็นเจ้าของจริง ๆ ยังพิมพ์แล้วเดาได้
 */
export type TerminalKey = "DRAFT" | "RETURNED" | "APPROVED" | "REJECTED" | "CANCELLED";
export type NodeKey = TerminalKey | (string & {});

export interface JourneyNode {
  key: NodeKey;
  lane: NodeLane;
  /** โหนดที่ทางแยกนี้ห้อยอยู่ — มีเฉพาะ lane "branch" */
  anchor: NodeKey | null;
  order: number | null;
  optional: boolean;
  terminal: boolean;
  label: string;
  short: string;
  waitingLabel: string | null;
  roleCode: string | null;
  roleLabel: string | null;
  tone: NodeTone;
  count: number;
  /** ช่องนี้เป็นงานของตำแหน่งผู้ใช้คนนี้ */
  mine: boolean;
}

export interface JourneyEdge {
  from: NodeKey;
  to: NodeKey;
  kind: EdgeKind;
}

/** GET /api/{organizations,dataset-requests}/summary */
export interface ListSummary {
  total: number;
  mine: number;
  /**
   * ในกองที่รอผู้อ่านอยู่ มีกี่ใบที่ผู้เชี่ยวชาญให้ความเห็นกลับมาแล้ว
   *
   * optional เพราะเส้นทางหน่วยงานตอบ 0 เสมอ และหน้าเว็บไม่ต้องรู้ว่าทำไม — เซิร์ฟเวอร์
   * เป็นคนตัดสินว่าใครควรเห็นตัวเลขนี้ (ผู้เชี่ยวชาญได้ 0 ไม่ใช่จำนวนความเห็นของตัวเอง)
   */
  advisory?: number;
  /** คำนามที่ใช้นับของในเส้นทางนี้ — "หน่วยงาน" หรือ "ชุดข้อมูล" มาจาก server */
  unit: string;
  nodes: JourneyNode[];
  edges: JourneyEdge[];
}

/**
 * สีของจุดนำหน้าชื่อขั้นตอน — สำนวนเดียวกับจุดใน badge ของแถว
 *
 * กล่องเน้นชื่อขั้นตอนเป็นหลัก ตัวเลขจึงไม่ได้เป็นชิปสีอีกแล้ว เหลือจุดเล็ก ๆ ไว้ให้กวาดตา
 * แล้วยังแยก "อนุมัติแล้ว" ออกจาก "ไม่อนุมัติ" ได้โดยไม่ต้องอ่าน
 */
export const NODE_TONE_DOT: Record<NodeTone, string> = {
  neutral: "bg-navy-300",
  review: "bg-warning",
  approval: "bg-navy-500",
  success: "bg-success",
  danger: "bg-danger",
};

export const nodeCount = (summary: ListSummary | null, key: NodeKey): number =>
  summary?.nodes.find((n) => n.key === key)?.count ?? 0;

export interface PageInfo {
  page: number;
  pageSize: number;
  total: number;
  pageCount: number;
}

/**
 * การเรียง — สำเนาโดยตั้งใจของ `SortOrder` ใน `backend/src/lib/queue.ts`
 *
 * สองมิติในโทเคนเดียว: เรียงตามวันที่ไหน (`date` = วันที่นำส่ง · `updated` = วันที่คำขอ
 * เปลี่ยนแปลงล่าสุด) และเรียงทางไหน โทเคนเดียวเพราะมันเดินทางเป็น `?sort=` ตัวเดียวทั้ง
 * ใน URL ของหน้าและใน query ที่ยิงไป API
 *
 * ชื่อ `date_*` ไม่ถูกเปลี่ยนเป็น `submitted_*` ที่ตรงกว่า ด้วยเหตุผลเดียวกับฝั่ง backend:
 * โทเคนสองตัวนี้อยู่ในลิงก์ที่แชร์กันไปแล้ว และโทเคนที่ไม่รู้จักจะตกไปที่ค่าเริ่มต้นเงียบ ๆ
 */
export type SortField = "date" | "updated";
export type SortDirection = "desc" | "asc";
export type SortOrder = `${SortField}_${SortDirection}`;

export const SORT_ORDERS: SortOrder[] = ["date_desc", "date_asc", "updated_desc", "updated_asc"];

export const sortField = (value: SortOrder): SortField =>
  value.startsWith("updated_") ? "updated" : "date";

export const sortDirection = (value: SortOrder): SortDirection =>
  value.endsWith("_asc") ? "asc" : "desc";

export const sortToken = (field: SortField, direction: SortDirection): SortOrder =>
  `${field}_${direction}`;

export const SORT_DIRECTION_LABELS: Record<SortDirection, string> = {
  desc: "ใหม่ → เก่า",
  asc: "เก่า → ใหม่",
};

/**
 * ชื่อของวันที่ที่เรียง — ครึ่งเดียว
 *
 * `updated` มีชื่อเดียวทั้งสองเส้นทาง ส่วน `date` ไม่มี: ตารางหน่วยงานเรียกคอลัมน์นั้นว่า
 * "วันที่ยื่น" ตารางชุดข้อมูลเรียกว่า "วันที่นำส่ง" ตัวเลือกในกล่องเรียงต้องอ่านตรงกับหัว
 * คอลัมน์ที่อยู่ใต้มันบนหน้าจอเดียวกัน ไม่ใช่ตรงกับอีกหน้าหนึ่ง — ชื่อของ `date` จึงมาจาก
 * ผู้เรียก (`submittedLabel`) แทนที่จะอยู่ในตารางนี้
 */
export const SORT_UPDATED_LABEL = "วันที่อัปเดตล่าสุด";

/**
 * ผู้ใช้คนนี้มีช่องเป็นของตัวเองไหม — ใช้ตัดสิน **แค่ว่าจะเปิดแท็บไหนก่อน** ตอนที่
 * ยังไม่มีคำตอบจาก `/summary`
 *
 * คำตอบจริงคือธง `mine` บนแต่ละโหนด ที่นี่จึงเก็บแค่รายชื่อ role ที่ *ไม่มี* ช่องเลย
 * ซึ่งสั้นและเปลี่ยนแทบไม่ได้ ถ้าเดาผิดผลคือแท็บเปิดผิดอันหนึ่งครั้ง ไม่ใช่ข้อมูลผิด —
 * จงใจแลกไว้แบบนี้ เพราะทางเลือกอื่นคือให้แท็บสลับเองหลังโหลดเสร็จ ซึ่งเห็นกระพริบ
 */
const ROLES_WITHOUT_QUEUE = ["SYSTEM_ADMINISTRATOR", "BDI_LEGAL_OFFICER"];

export const hasOwnQueue = (roles: string[]) =>
  roles.some((r) => !ROLES_WITHOUT_QUEUE.includes(r));
