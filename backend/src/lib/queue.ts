/**
 * คิวงาน — "ใบไหนค้างอยู่ที่ช่องไหนของเส้นทาง" และ "ช่องไหนเป็นงานของตำแหน่งฉัน"
 *
 * ## ทำไมโทเคนของตัวกรองต้องเป็น "ช่อง" ไม่ใช่ task_type
 *
 * รอบก่อนตัวกรองย้ายจาก `status` มาเป็น `task_type` เพราะ `SUBMITTED` แปลว่า "มีด่าน
 * ค้างอยู่และยังไม่มีใครกดเปิด" ไม่ว่าด่านไหน เม็ดเดียวจึงกวาดสามด่านมารวมกัน
 *
 * `task_type` ยังกวาดไม่พอ: `BDI_OFFICER_REVIEW` เป็น **สองด่านคนละด่าน** ในเส้นทาง
 * ชุดข้อมูล — ตรวจเบื้องต้น กับ ตรวจซ้ำหลังหน่วยงานลงนาม โทเคนจึงเลื่อนอีกขั้นไปเป็น
 * `StepKey` ของ `journey-steps.ts` ซึ่งแยกสองช่องนั้นไว้อยู่แล้ว บวกปลายทางที่ไม่มี
 * task (`DRAFT` · `RETURNED` · `APPROVED` · `REJECTED` · `CANCELLED`)
 *
 * ผลพลอยได้คือหนึ่งโทเคน = หนึ่งโหนดบนแผนภาพเส้นทางพอดี
 *
 * ## ขอบเขตของไฟล์นี้
 *
 * - `journey-steps.ts` เป็นเจ้าของ **ลำดับด่านและรูปร่างของเส้นทาง**
 * - `workflow.ts` เป็นเจ้าของ **"ใครมีสิทธิ์ทำด่านนี้"** (`TASK_TYPE_ROLES`)
 * - ไฟล์นี้เป็นเจ้าของ **"จะถามฐานข้อมูลยังไงว่าอะไรรอฉันอยู่"** เท่านั้น
 *
 * ฝั่งหน้าเว็บไม่มีสำเนาของทั้งลำดับและ map role→ช่อง โดยตั้งใจ — `/summary` ส่งทั้ง
 * รูปร่างของเส้นทางและธงว่าโหนดไหนเป็นของผู้เรียกไปให้ ธรรมเนียม "สำเนาโดยตั้งใจ"
 * ของ lib/dataset-form.ts มีไว้สำหรับสิ่งที่หน้าจอต้องรู้ *ก่อน* เครือข่ายตอบ ซึ่ง
 * แผนภาพที่รอตัวเลขอยู่แล้วไม่ใช่
 */
import {
  Prisma,
  PrismaClient,
  RequestStatus,
  ReviewResult,
  ReviewTaskType,
  SubjectType,
} from "@prisma/client";

import {
  currentSlotOf,
  hasRecheckStep,
  journeyGraph,
  journeyNodeKeys,
  journeyUnit,
  planFor,
  type JourneyEdge,
  type JourneyNodeKey,
  type JourneyNodeShape,
  type StepKey,
  type TerminalKey,
} from "./journey-steps.js";
import type { RoleCode } from "./system.js";
import { ACTIVE_STATUSES, ROLE_TASK_TYPES } from "./workflow.js";

type Db = PrismaClient | Prisma.TransactionClient;

export type { JourneyNodeKey };

/** ปลายทางที่กรองได้จาก `status` ตรง ๆ — ไม่มี task ค้างอยู่เลย */
export const TERMINAL_KEYS = [
  "DRAFT",
  "RETURNED",
  "APPROVED",
  "REJECTED",
  "CANCELLED",
] as const satisfies readonly TerminalKey[];

const isTerminalKey = (t: string): t is TerminalKey =>
  (TERMINAL_KEYS as readonly string[]).includes(t);

/**
 * โทเคนที่ API ยอมรับ = คำศัพท์ปัจจุบัน + คำศัพท์เก่าอีกสองรุ่น
 *
 * รุ่นที่หนึ่ง `?status=SUBMITTED,UNDER_REVIEW` — จากตอนที่ยังกรองด้วยสถานะ
 * รุ่นที่สอง `?stage=BDI_OFFICER_REVIEW` — เม็ดกรองด่านรุ่นแรก ซึ่ง **หน้าแรกยังยิงอยู่
 * วันนี้** และมีทั้งใน bookmark และ Postman collection
 *
 * ทั้งสองรุ่นถูกแปลตอน `resolveTokens()` ไม่ใช่ตอน parse เพราะการแปลขึ้นกับ subjectType:
 * `BDI_OFFICER_REVIEW` เป็นหนึ่งช่องในเส้นทางหน่วยงาน แต่เป็นสองช่องในเส้นทางชุดข้อมูล
 */
type LegacyToken = "SUBMITTED" | "UNDER_REVIEW" | ReviewTaskType;
export type FilterToken = JourneyNodeKey | LegacyToken;

const ACCEPTED: string[] = [
  ...new Set([
    ...journeyNodeKeys(SubjectType.DATASET_REGISTRATION_REQUEST),
    ...journeyNodeKeys(SubjectType.ORGANIZATION_REGISTRATION_REQUEST),
    ...TERMINAL_KEYS,
    "SUBMITTED",
    "UNDER_REVIEW",
    ...Object.values(ReviewTaskType),
  ]),
];

/** อ่านค่าจาก query string — โทเคนที่ไม่รู้จักถูกทิ้งเงียบ เหมือนที่ ?status= เคยทำ */
export function parseFilterTokens(raw?: string | string[]): FilterToken[] {
  const parts = (Array.isArray(raw) ? raw.join(",") : (raw ?? ""))
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is FilterToken => ACCEPTED.includes(s));
  return [...new Set(parts)];
}

/**
 * โทเคนที่รับมา → ช่องของเส้นทางนี้ + สถานะที่กรองตรง ๆ ได้
 *
 * `BDI_OFFICER_REVIEW` จากลิงก์เก่าแปลว่า "ค้างอยู่ที่ด่านตรวจของเจ้าหน้าที่" ซึ่งใน
 * เส้นทางชุดข้อมูลคือสองช่อง — แปลเป็น **ทั้งสอง** ไม่ใช่เลือกข้าง ความหมายเดิมเป็น
 * union อยู่แล้ว
 */
export function resolveTokens(
  subjectType: SubjectType,
  tokens: FilterToken[],
): { nodes: StepKey[]; statuses: RequestStatus[] } {
  const plan = planFor(subjectType);
  const nodes = new Set<StepKey>();
  const statuses = new Set<RequestStatus>();

  for (const token of tokens) {
    const step = plan.find((s) => s.key === token);
    if (step) {
      nodes.add(step.key);
    } else if (Object.values(ReviewTaskType).includes(token as ReviewTaskType)) {
      for (const s of plan.filter((s) => s.taskType === token)) nodes.add(s.key);
    } else {
      statuses.add(token as RequestStatus);
    }
  }
  return { nodes: [...nodes], statuses: [...statuses] };
}

/**
 * ช่องที่ตำแหน่งเหล่านี้ต้องเป็นคนทำต่อ
 *
 * ตัดสินจาก **role ไม่ใช่จากผู้รับมอบหมาย** — `POST /:id/review` อนุญาตให้ใครก็ตามที่
 * ถือ role ตรงกับด่านกดปิดด่านได้ (`assigned_user_id` เป็นแค่การกระจายโหลดแบบ
 * round-robin) กรองด้วย assignedUserId จะซ่อนงานที่เขาทำได้จริง
 *
 * เจ้าหน้าที่ BDI จึงเป็นเจ้าของ **สองช่อง** ในเส้นทางชุดข้อมูล และผลรวมของสองช่องนั้น
 * เท่ากับจำนวน `BDI_OFFICER_REVIEW` ก้อนเดียวของเดิมพอดี
 */
export function myNodeKeys(subjectType: SubjectType, roles: RoleCode[]): JourneyNodeKey[] {
  const plan = planFor(subjectType);
  const keys = new Set<JourneyNodeKey>();

  for (const role of roles) {
    for (const taskType of ROLE_TASK_TYPES[role] ?? []) {
      if (taskType === ReviewTaskType.ORGANIZATION_REVISION) {
        // ด่านนี้ไม่เคยถูกเปิดเป็น task — คิวของผู้ดำเนินการหน่วยงานคือใบที่ถูกส่งกลับ
        // มาแก้ กับฉบับร่างที่ยังไม่ได้นำส่ง ทั้งสองอย่างคือ "ถึงตาคุณแล้ว" เหมือนกัน
        keys.add("RETURNED");
        keys.add("DRAFT");
      } else {
        for (const s of plan.filter((s) => s.taskType === taskType)) keys.add(s.key);
      }
    }
  }
  // เรียงตามลำดับที่วาด ไม่ใช่ตามลำดับที่ role มาถึง
  return journeyGraph(subjectType).nodes.map((n) => n.key).filter((k) => keys.has(k));
}

/**
 * ใบไหนที่หน่วยงานลงนามผ่านไปแล้ว — ตัวชี้ขาดระหว่างด่านตรวจเบื้องต้นกับด่านตรวจซ้ำ
 *
 * ถามเฉพาะใบที่ค้างอยู่ที่ด่านเจ้าหน้าที่ ด่านอื่นไม่ได้ใช้คำตอบนี้ และเส้นทางที่ไม่มี
 * ด่านตรวจซ้ำก็ไม่ต้องถามเลย — คิวรีนี้จึงไม่เกิดขึ้นบนเส้นทางหน่วยงาน
 */
async function signedSubjects(
  db: Db,
  subjectType: SubjectType,
  active: { subjectId: string; taskType: ReviewTaskType }[],
): Promise<Set<string>> {
  if (!hasRecheckStep(subjectType)) return new Set();
  const officer = active
    .filter((r) => r.taskType === ReviewTaskType.BDI_OFFICER_REVIEW)
    .map((r) => r.subjectId);
  if (officer.length === 0) return new Set();

  const rows = await db.reviewTask.findMany({
    where: {
      subjectType,
      subjectId: { in: officer },
      taskType: ReviewTaskType.ORGANIZATION_APPROVAL,
      result: ReviewResult.APPROVED,
    },
    select: { subjectId: true },
  });
  return new Set(rows.map((r) => r.subjectId));
}

/**
 * id ของคำขอที่ค้างอยู่ที่ช่องเหล่านี้
 *
 * review_task ผูกกับคำขอแบบ logical (subject_type + subject_id ไม่ใช่ relation ของ
 * Prisma) จึงต้องอ่าน id ออกมาก่อนแล้วค่อย `id: { in: … }` — สำนวนเดียวกับ
 * visibilityFilter() ใน dataset-requests.ts จำนวน id ถูกจำกัดด้วยจำนวน task ที่ยัง
 * active (คำขอหนึ่งฉบับมี active task ได้ไม่เกินหนึ่ง — partial unique index บังคับไว้)
 * ไม่ใช่จำนวนคำขอทั้งหมด
 *
 * **ถ้าวันหนึ่งคืนเกินราว 20,000 id** ค่อยย้ายไป raw EXISTS sub-select — ตรงนั้นคือจุด
 * ที่ค่าขนส่ง array แพงกว่าการ join การแยกสองช่องไม่ได้ขยับเพดานนี้
 */
export async function requestIdsAtStage(
  db: Db,
  subjectType: SubjectType,
  nodes: StepKey[],
): Promise<string[]> {
  if (nodes.length === 0) return [];
  const plan = planFor(subjectType);
  const taskTypes = [
    ...new Set(
      nodes
        .map((k) => plan.find((s) => s.key === k)?.taskType)
        .filter((t): t is ReviewTaskType => Boolean(t)),
    ),
  ];
  if (taskTypes.length === 0) return [];

  const active = await db.reviewTask.findMany({
    where: { subjectType, status: { in: ACTIVE_STATUSES }, taskType: { in: taskTypes } },
    select: { subjectId: true, taskType: true },
  });
  const signed = await signedSubjects(db, subjectType, active);
  const want = new Set<StepKey>(nodes);

  return [
    ...new Set(
      active
        .filter((r) => {
          const key = currentSlotOf({
            subjectType,
            taskType: r.taskType,
            orgApproved: signed.has(r.subjectId) ? 1 : 0,
          });
          return key !== null && want.has(key);
        })
        .map((r) => r.subjectId),
    ),
  ];
}

/** เงื่อนไขที่ตรงกับโทเคนชุดหนึ่ง — ประกอบเป็น element เดียวของ AND[] เสมอ */
type NodeClause = {
  OR: ({ status: { in: RequestStatus[] } } | { id: { in: string[] } })[];
};

/**
 * แปลงโทเคนเป็นเงื่อนไข Prisma
 *
 * คืน null เมื่อไม่มีโทเคนเลย ผู้เรียกจึงไม่ push อะไรเข้า AND — **ห้ามข้าม clause
 * เมื่อ id list ว่าง** เพราะ `{ id: { in: [] } }` แปลว่า "ไม่มีอะไรตรง" ซึ่งถูก
 * ส่วนการข้ามแปลว่า "ไม่กรอง" ซึ่งโชว์ทุกอย่าง (มีสองจุดที่เผลอ return ก่อนได้ตอนนี้:
 * ที่นี่ และใน signedSubjects)
 */
export async function nodeWhere(
  db: Db,
  subjectType: SubjectType,
  tokens: FilterToken[],
): Promise<NodeClause | null> {
  if (tokens.length === 0) return null;
  const { nodes, statuses } = resolveTokens(subjectType, tokens);

  const or: NodeClause["OR"] = [];
  if (statuses.length > 0) or.push({ status: { in: statuses } });
  if (nodes.length > 0) or.push({ id: { in: await requestIdsAtStage(db, subjectType, nodes) } });
  return { OR: or };
}

/** โหนดหนึ่งโหนดพร้อมตัวเลข — รูปร่างจาก journeyGraph() บวกสิ่งที่ต้องนับ */
export type JourneyNodeCount = JourneyNodeShape & { count: number; mine: boolean };

export type JourneySummary = {
  total: number;
  mine: number;
  /** คำนามที่ใช้นับของในเส้นทางนี้ — กล่องเขียน "จำนวน: 20 <unit>" */
  unit: string;
  nodes: JourneyNodeCount[];
  edges: JourneyEdge[];
};

/**
 * ตัวเลขบนแผนภาพ
 *
 * ผู้เรียกส่ง callback มาเพราะสองเส้นทางใช้คนละโมเดล — เก็บการ typecheck ของ Prisma
 * ไว้ที่ route ไม่ต้องหลอกด้วย any ที่นี่
 *
 * ขอบเขตของตัวเลข = **สิ่งที่ผู้ใช้มองเห็น + คำค้นหา** แต่ **ไม่รวมตัวกรองโหนดและแท็บ**
 * ตัวเลขบนโหนดที่ขยับตอนกดโหนดนั้นเองใช้งานไม่ได้ แต่ "ทั้งหมด (312)" ลอยอยู่เหนือ
 * ผลค้นหาสามแถวก็อ่านว่าพัง
 *
 * ผลรวมของ count อาจน้อยกว่า `total` อยู่เล็กน้อย: requestStatusFor() มีทางที่ให้
 * `UNDER_REVIEW` โดยไม่มี task ค้าง ("ผ่านด่านหนึ่งแล้วแต่ยังไม่ได้เปิดด่านถัดไป")
 * แถวแบบนั้นไม่ตรงกับโหนดไหนเลย เห็นได้จากแท็บทั้งหมดเท่านั้น — ปล่อยให้เห็นดีกว่าปิด
 * ด้วย notIn ที่แพงและกลบอาการของสภาพข้อมูลที่ไม่ควรมี
 */
export async function journeySummary(params: {
  db: Db;
  subjectType: SubjectType;
  roles: RoleCode[];
  countAll: () => Promise<number>;
  groupByStatus: () => Promise<{ status: RequestStatus; _count: { _all: number } }[]>;
  inflightIds: () => Promise<string[]>;
}): Promise<JourneySummary> {
  const [total, byStatus, inflight] = await Promise.all([
    params.countAll(),
    params.groupByStatus(),
    params.inflightIds(),
  ]);

  const counts = new Map<JourneyNodeKey, number>();
  for (const row of byStatus) {
    if (isTerminalKey(row.status)) counts.set(row.status, row._count._all);
  }

  if (inflight.length > 0) {
    const active = await params.db.reviewTask.findMany({
      where: {
        subjectType: params.subjectType,
        subjectId: { in: inflight },
        status: { in: ACTIVE_STATUSES },
      },
      select: { subjectId: true, taskType: true },
    });
    const signed = await signedSubjects(params.db, params.subjectType, active);

    // นับทีละแถวได้เพราะหนึ่งคำขอมี active task ได้ไม่เกินหนึ่ง (partial unique index)
    // ถ้าวันหนึ่ง index นั้นหาย ตัวเลขจะเกิน total ซึ่งเห็นทันที ไม่ใช่ผิดเงียบ
    for (const row of active) {
      const key = currentSlotOf({
        subjectType: params.subjectType,
        taskType: row.taskType,
        orgApproved: signed.has(row.subjectId) ? 1 : 0,
      });
      if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }

  const mineKeys = new Set(myNodeKeys(params.subjectType, params.roles));
  const graph = journeyGraph(params.subjectType);
  const nodes: JourneyNodeCount[] = graph.nodes.map((n) => ({
    ...n,
    count: counts.get(n.key) ?? 0,
    mine: mineKeys.has(n.key),
  }));

  return {
    total,
    unit: journeyUnit(params.subjectType),
    // ช่องกับปลายทางไม่ทับกัน (ใบที่มี active task เป็น SUBMITTED/UNDER_REVIEW เสมอ)
    // ผลบวกจึงไม่นับซ้ำ และไม่ต้องยิงคิวรีเพิ่ม
    mine: nodes.filter((n) => n.mine).reduce((sum, n) => sum + n.count, 0),
    nodes,
    edges: graph.edges,
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
  const pageSize =
    Number.isFinite(requested) && requested > 0
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
