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
  nodes: JourneyNode[];
  edges: JourneyEdge[];
}

/** สีของชิปตัวเลขบนโหนด — คู่เดียวกับที่ badge ในแถวใช้ โหนดกับแถวจึงสีเดียวกันด้วย */
export const NODE_TONE_CLASS: Record<NodeTone, string> = {
  neutral: "bg-navy-50 text-ink-muted",
  review: "bg-warning-bg text-warning",
  approval: "bg-navy-100 text-navy-600",
  success: "bg-success-bg text-success",
  danger: "bg-danger-bg text-danger",
};

export const nodeCount = (summary: ListSummary | null, key: NodeKey): number =>
  summary?.nodes.find((n) => n.key === key)?.count ?? 0;

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
