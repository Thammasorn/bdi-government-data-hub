/**
 * คิวงาน — "ใบไหนค้างอยู่ที่ด่านไหน" และ "ใบไหนเป็นงานของตำแหน่งฉัน"
 *
 * ## ทำไมต้องมีคำศัพท์ชุดนี้
 *
 * ตัวกรองของหน้ารายการเคยกรองด้วย `status` ซึ่งกรองผิดระดับ: `SUBMITTED` ไม่ได้แปลว่า
 * "เพิ่งนำส่ง" แต่แปลว่า "มีด่านค้างอยู่และยังไม่มีใครกดเปิด" — ไม่ว่าด่านนั้นจะเป็น
 * ด่านเจ้าหน้าที่ BDI ตรวจรอบแรก ด่านผู้มีอำนาจของหน่วยงานลงนาม หรือด่าน BDI อนุมัติ
 * ขั้นสุดท้าย (ดู requestStatusFor() ใน workflow.ts) เม็ดกรองเม็ดเดียวจึงกวาดงานของ
 * คนละคนมารวมกัน แล้วเขียนป้ายเดียวกันว่า "นำส่งแล้ว"
 *
 * ที่นี่จึงนิยาม **โทเคนของตัวกรอง** ให้เท่ากับ *ป้ายที่แถวนั้นแสดงจริง ๆ* —
 * ซึ่งก็คือสิ่งที่ stageMeta() ฝั่งหน้าเว็บวาด: ระหว่างที่คำขอยังเดินอยู่ใช้ด่านจาก
 * review_task ส่วนที่จบแล้วหรือยังไม่เริ่มใช้สถานะ
 *
 * ## ขอบเขตของไฟล์นี้
 *
 * `workflow.ts` เป็นเจ้าของ **"ใครมีสิทธิ์ทำด่านนี้"** (TASK_TYPE_ROLES) ไฟล์นี้เป็น
 * เจ้าของ **"จะถามฐานข้อมูลยังไงว่าอะไรรอฉันอยู่"** เท่านั้น กติกาสิทธิ์ทั้งหมด
 * derive มาจากตารางโน้น ไม่เขียนซ้ำ
 *
 * ฝั่งหน้าเว็บ **ไม่มีสำเนาของ map role→ด่าน** โดยตั้งใจ — `/summary` ส่ง `myStages`
 * กลับไปให้ ธรรมเนียม "สำเนาโดยตั้งใจ" ของ lib/dataset-form.ts มีไว้สำหรับสิ่งที่
 * หน้าจอต้องรู้ *ก่อน* เครือข่ายตอบ ซึ่งแท็บที่รอตัวเลขอยู่แล้วไม่ใช่
 */
import {
  Prisma,
  PrismaClient,
  RequestStatus,
  ReviewTaskType,
  SubjectType,
} from "@prisma/client";

import type { RoleCode } from "./system.js";
import { ACTIVE_STATUSES, ROLE_TASK_TYPES } from "./workflow.js";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * โทเคนหนึ่งตัว = ป้ายหนึ่งแบบที่แถวในตารางแสดงได้
 *
 * สองอย่างถูกตัดออกโดยตั้งใจ และตัดที่ระดับ type เพื่อให้เผลอส่งมาแล้วคอมไพล์ไม่ผ่าน:
 *
 * - `SUBMITTED` / `UNDER_REVIEW` คือความกำกวมที่งานนี้กำลังกำจัด แถวที่เป็นสองสถานะนี้
 *   มีด่านค้างอยู่เสมอ จึงถูกแทนด้วยโทเคนของด่านนั้น
 * - `ORGANIZATION_REVISION` ไม่เคยถูกเปิดเป็น task เลย (คำขอที่ถูกส่งกลับไม่มีด่าน
 *   ที่ค้างอยู่ — ดู journey-steps.ts) กรองด้วยตัวนี้จะได้ศูนย์แถวตลอดกาล ซึ่งเป็น
 *   คำตอบผิดที่เงียบ งานของผู้ดำเนินการหน่วยงานใช้ `RETURNED` กับ `DRAFT` แทน
 */
export type StageToken =
  | Exclude<ReviewTaskType, "ORGANIZATION_REVISION">
  | Exclude<RequestStatus, "SUBMITTED" | "UNDER_REVIEW">;

/** โทเคนที่มาจาก review_task — เรียงตามลำดับที่คำขอเดินผ่าน */
export const STAGE_TASK_TYPES = [
  ReviewTaskType.BDI_OFFICER_REVIEW,
  ReviewTaskType.DATASET_SPECIALIST_REVIEW,
  ReviewTaskType.ORGANIZATION_APPROVAL,
  ReviewTaskType.BDI_FINAL_APPROVAL,
] as const satisfies readonly StageToken[];

/** โทเคนที่มาจาก request.status — ปลายทางที่ไม่มีด่านค้าง */
export const STAGE_STATUSES = [
  RequestStatus.DRAFT,
  RequestStatus.RETURNED,
  RequestStatus.APPROVED,
  RequestStatus.REJECTED,
  RequestStatus.CANCELLED,
] as const satisfies readonly StageToken[];

export const STAGE_TOKENS: StageToken[] = [...STAGE_TASK_TYPES, ...STAGE_STATUSES];

/**
 * ด่านที่เส้นทางนี้เดินผ่านจริง
 *
 * เส้นทางหน่วยงาน (Journey B) ไม่มีด่านผู้เชี่ยวชาญข้อมูล — ถ้าไม่ตัดออก ตารางหน่วยงาน
 * จะขึ้นเม็ดกรอง "รอผู้เชี่ยวชาญพิจารณา" ที่กดแล้วได้ศูนย์แถวเสมอ และผู้เชี่ยวชาญที่
 * บังเอิญถือ role อื่นด้วยจะเห็นการ์ดสรุปที่เป็นศูนย์ตลอดกาล
 */
export function journeyStages(subjectType: SubjectType): StageToken[] {
  return subjectType === SubjectType.DATASET_REGISTRATION_REQUEST
    ? STAGE_TOKENS
    : STAGE_TOKENS.filter((t) => t !== ReviewTaskType.DATASET_SPECIALIST_REVIEW);
}

export const isTaskTypeToken = (t: StageToken): t is (typeof STAGE_TASK_TYPES)[number] =>
  (STAGE_TASK_TYPES as readonly string[]).includes(t);

/**
 * โทเคนที่ API ยอมรับ = โทเคนใหม่ + สองสถานะเก่าที่ UI เลิกใช้แล้ว
 *
 * ลิงก์เก่าอย่าง `?status=SUBMITTED,UNDER_REVIEW` (เมนูของผู้อนุมัติ BDI, bookmark,
 * Postman collection) ต้องไม่ตายเพราะ UI เปลี่ยนคำศัพท์ — รับต่อไปแต่ไม่เสนอให้กด
 */
type LegacyToken = "SUBMITTED" | "UNDER_REVIEW";
export type FilterToken = StageToken | LegacyToken;

const ACCEPTED: string[] = [...STAGE_TOKENS, "SUBMITTED", "UNDER_REVIEW"];

/** อ่านค่าจาก query string — โทเคนที่ไม่รู้จักถูกทิ้งเงียบ เหมือนที่ ?status= เคยทำ */
export function parseFilterTokens(raw?: string | string[]): FilterToken[] {
  const parts = (Array.isArray(raw) ? raw.join(",") : (raw ?? ""))
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is FilterToken => ACCEPTED.includes(s));
  return [...new Set(parts)];
}

/**
 * ด่านที่ตำแหน่งเหล่านี้ต้องเป็นคนทำต่อ
 *
 * ตัดสินจาก **role ไม่ใช่จากผู้รับมอบหมาย** — POST /:id/review อนุญาตให้ใครก็ตามที่
 * ถือ role ตรงกับด่านกดปิดด่านได้ (assigned_user_id เป็นแค่การกระจายโหลดแบบ
 * round-robin) กรองด้วย assignedUserId จะซ่อนงานที่เขาทำได้จริง
 */
export function myStageTokens(roles: RoleCode[]): StageToken[] {
  const tokens = new Set<StageToken>();
  for (const role of roles) {
    for (const taskType of ROLE_TASK_TYPES[role] ?? []) {
      if (taskType === ReviewTaskType.ORGANIZATION_REVISION) {
        // ด่านนี้ไม่เคยถูกเปิดเป็น task — คิวของผู้ดำเนินการหน่วยงานคือใบที่ถูกส่งกลับ
        // มาแก้ กับฉบับร่างที่ยังไม่ได้นำส่ง ทั้งสองอย่างคือ "ถึงตาคุณแล้ว" เหมือนกัน
        tokens.add(RequestStatus.RETURNED);
        tokens.add(RequestStatus.DRAFT);
      } else {
        tokens.add(taskType);
      }
    }
  }
  return STAGE_TOKENS.filter((t) => tokens.has(t));
}

/** id ของคำขอที่มี review_task ค้างอยู่ที่ด่านเหล่านี้ */
export async function requestIdsAtStage(
  db: Db,
  subjectType: SubjectType,
  taskTypes: ReviewTaskType[],
): Promise<string[]> {
  if (taskTypes.length === 0) return [];
  const rows = await db.reviewTask.findMany({
    where: { subjectType, status: { in: ACTIVE_STATUSES }, taskType: { in: taskTypes } },
    select: { subjectId: true },
  });
  return [...new Set(rows.map((r) => r.subjectId))];
}

/** เงื่อนไขที่ตรงกับโทเคนชุดหนึ่ง — ประกอบเป็น element เดียวของ AND[] เสมอ */
type StageClause = {
  OR: ({ status: { in: RequestStatus[] } } | { id: { in: string[] } })[];
};

/**
 * แปลงโทเคนเป็นเงื่อนไข Prisma
 *
 * review_task ผูกกับคำขอแบบ logical (subject_type + subject_id ไม่ใช่ relation)
 * จึงต้องอ่าน id ออกมาก่อนแล้วค่อย `id: { in: … }` — สำนวนเดียวกับ visibilityFilter()
 * ใน dataset-requests.ts จำนวน id ถูกจำกัดด้วยจำนวน task ที่ยัง active (คำขอหนึ่งฉบับ
 * มี active task ได้ไม่เกินหนึ่ง — partial unique index บังคับไว้) ไม่ใช่จำนวนคำขอ
 * ทั้งหมด ใบที่จบแล้วไม่นับเข้ามาเลย
 *
 * **ถ้าวันหนึ่ง requestIdsAtStage คืนเกินราว 20,000 id** ค่อยย้ายไป raw EXISTS
 * sub-select — ตรงนั้นคือจุดที่ค่าขนส่ง array แพงกว่าการ join
 *
 * คืน null เมื่อไม่มีโทเคนเลย ผู้เรียกจึงไม่ push อะไรเข้า AND — **ห้ามข้าม clause
 * เมื่อ id list ว่าง** เพราะ `{ id: { in: [] } }` แปลว่า "ไม่มีอะไรตรง" ซึ่งถูก
 * ส่วนการข้ามแปลว่า "ไม่กรอง" ซึ่งโชว์ทุกอย่าง
 */
export async function stageWhere(
  db: Db,
  subjectType: SubjectType,
  tokens: FilterToken[],
): Promise<StageClause | null> {
  if (tokens.length === 0) return null;

  const taskTypes = tokens.filter(
    (t): t is (typeof STAGE_TASK_TYPES)[number] =>
      (STAGE_TASK_TYPES as readonly string[]).includes(t),
  );
  const statuses = tokens.filter((t): t is RequestStatus =>
    (STAGE_TASK_TYPES as readonly string[]).includes(t) ? false : true,
  ) as RequestStatus[];

  const or: StageClause["OR"] = [];
  if (statuses.length > 0) or.push({ status: { in: statuses } });
  if (taskTypes.length > 0) {
    or.push({ id: { in: await requestIdsAtStage(db, subjectType, taskTypes) } });
  }
  return { OR: or };
}

export type StageCounts = {
  total: number;
  stages: Record<StageToken, number>;
  myStages: StageToken[];
  mine: number;
};

/**
 * ตัวเลขของแถบสรุปและป้ายแท็บ
 *
 * ผู้เรียกส่ง callback มาเพราะสองเส้นทางใช้คนละโมเดล — เก็บการ typecheck ของ Prisma
 * ไว้ที่ route ไม่ต้องหลอกด้วย any ที่นี่
 *
 * ขอบเขตของตัวเลข = **สิ่งที่ผู้ใช้มองเห็น + คำค้นหา** แต่ **ไม่รวมตัวกรองด่านและแท็บ**
 * ป้ายแท็บที่เปลี่ยนเลขตอนกดเม็ดกรองในแท็บนั้นเองใช้งานไม่ได้ แต่ "ทั้งหมด (312)"
 * ลอยอยู่เหนือผลค้นหาสามแถวก็อ่านว่าพัง
 *
 * ผลรวมของ `stages` อาจน้อยกว่า `total` อยู่เล็กน้อย: requestStatusFor() มีทางที่ให้
 * `UNDER_REVIEW` โดยไม่มี task ค้าง ("ผ่านด่านหนึ่งแล้วแต่ยังไม่ได้เปิดด่านถัดไป")
 * แถวแบบนั้นไม่ตรงกับโทเคนไหนเลย เห็นได้จากแท็บทั้งหมดเท่านั้น — ปล่อยให้เห็น
 * ดีกว่าปิดด้วย notIn ที่แพงและกลบอาการของสภาพข้อมูลที่ไม่ควรมี
 */
export async function stageCounts(params: {
  db: Db;
  subjectType: SubjectType;
  roles: RoleCode[];
  countAll: () => Promise<number>;
  groupByStatus: () => Promise<{ status: RequestStatus; _count: { _all: number } }[]>;
  inflightIds: () => Promise<string[]>;
}): Promise<StageCounts> {
  const [total, byStatus, inflight] = await Promise.all([
    params.countAll(),
    params.groupByStatus(),
    params.inflightIds(),
  ]);

  const available = journeyStages(params.subjectType);
  const stages = Object.fromEntries(available.map((t) => [t, 0])) as Record<StageToken, number>;
  for (const row of byStatus) {
    if (row.status in stages) stages[row.status as StageToken] = row._count._all;
  }

  if (inflight.length > 0) {
    const tasks = await params.db.reviewTask.groupBy({
      by: ["taskType"],
      where: {
        subjectType: params.subjectType,
        subjectId: { in: inflight },
        status: { in: ACTIVE_STATUSES },
      },
      _count: { _all: true },
    });
    for (const row of tasks) {
      if (row.taskType in stages) stages[row.taskType as StageToken] = row._count._all;
    }
  }

  // ตัดด่านที่เส้นทางนี้ไม่มีออก — ไม่งั้นแถบสรุปขึ้นการ์ดที่เป็นศูนย์ตลอดกาล
  const myStages = myStageTokens(params.roles).filter((t) => available.includes(t));
  return {
    total,
    stages,
    myStages,
    // ด่านกับสถานะปลายทางไม่ทับกัน (ใบที่มี active task เป็น SUBMITTED/UNDER_REVIEW เสมอ)
    // ผลบวกจึงไม่นับซ้ำ และไม่ต้องยิงคิวรีเพิ่ม
    mine: myStages.reduce((sum, t) => sum + stages[t], 0),
  };
}

/** ทิศทางการเรียง — ค่าเดียวที่หน้าเว็บส่งมาได้ */
export type SortOrder = "date_desc" | "date_asc";

export const parseSort = (raw?: string): SortOrder => (raw === "date_asc" ? "date_asc" : "date_desc");

export const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

export function parsePaging(query: { page?: unknown; pageSize?: unknown }) {
  const page = Math.max(1, Math.trunc(Number(query.page)) || 1);
  const requested = Math.trunc(Number(query.pageSize));
  const pageSize = Number.isFinite(requested) && requested > 0
    ? Math.min(requested, MAX_PAGE_SIZE)
    : DEFAULT_PAGE_SIZE;
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

/**
 * ลำดับที่คงที่ข้ามหน้า
 *
 * `id` ตัวท้ายไม่ใช่ของแถม — แถวที่ submittedAt และ createdAt เท่ากันไม่มีลำดับที่
 * นิยามไว้ Postgres จึงคืนสลับที่ได้ทุกครั้ง ผลคือแถวเดียวโผล่ทั้งหน้า 1 และหน้า 2
 * หรือหายไปทั้งคู่ seed:demo เขียนแถวติด ๆ กันในลูปเดียว จึงเจอทันทีที่ลอง
 *
 * ร่างไม่มีวันที่นำส่ง — `nulls` เขียนให้ตรงกับพฤติกรรมเดิม (Postgres วาง NULL ไว้หัว
 * ตารางเมื่อ DESC) เพื่อไม่ให้ร่างของผู้ใช้ย้ายที่เพราะงานนี้ และเขียนออกมาตรง ๆ
 * เพราะการพึ่ง default คือทางที่ทำให้ร่างย้ายที่เงียบ ๆ ตอนกดสลับทิศ
 */
export function listOrderBy(sort: SortOrder) {
  const dir: Prisma.SortOrder = sort === "date_asc" ? "asc" : "desc";
  const nulls: Prisma.NullsOrder = dir === "desc" ? "first" : "last";
  return [{ submittedAt: { sort: dir, nulls } }, { createdAt: dir }, { id: dir }];
}
