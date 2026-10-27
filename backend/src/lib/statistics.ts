/**
 * ตัวเลขสถิติของระบบ — หน้า "สถิติ" ของ BDI (`/admin/statistics`) และหน้า ภาพรวม ของ /console อ่านจากที่เดียวกัน
 * (feedback "features 1 full" แถว 15, 2026-10-27) ตัวเลขสองหน้าจึงไม่มีทางไม่ตรงกัน
 *
 * **นับในฐานข้อมูลเสมอ ไม่ดึงแถวมานับใน Node** — ตารางต่อหน่วยงานเป็น SQL ตัวเดียว: นับคำขอตามสถานะต่อหน่วยงานใน CTE
 * (ใช้ index `(organization_id, status)` ที่มีอยู่แล้ว) แล้ว LEFT JOIN กับหน่วยงาน เรียงและตัดหน้าในฐานข้อมูล Prisma
 * `groupBy` เรียงตามจำนวนข้ามตารางแล้วแบ่งหน้าไม่ได้ จึงเป็น `$queryRaw` และคอลัมน์ที่เรียงได้มาจากรายการที่เขียนไว้ตรงนี้
 * เท่านั้น ไม่มีส่วนใดของ ORDER BY มาจาก query string
 */
import { OrganizationStatus, Prisma, RequestStatus } from "@prisma/client";

import { prisma } from "../db.js";
import { BDI_ORGANIZATION_ID } from "./system.js";

/** แถวของ `groupBy` → `{ <status>: <count> }` ที่มีทุกสถานะ (สถานะที่ไม่มีแถวเป็น 0 ไม่หายไปจากคำตอบ) */
export function countsByStatus<S extends string>(all: readonly S[], rows: { status: S; _count: { _all: number } }[]) {
  const out = Object.fromEntries(all.map((s) => [s, 0])) as Record<S, number>;
  for (const row of rows) out[row.status] = row._count._all;
  return out;
}

/** จำนวนหน่วยงาน (ไม่นับ BDI เอง) และคำขอทั้งสองเส้นทาง แยกตามสถานะ */
export async function registrationCounts() {
  const [organizations, organizationRequests, datasetRequests] = await Promise.all([
    prisma.organization.groupBy({
      by: ["status"],
      where: { id: { not: BDI_ORGANIZATION_ID } },
      _count: { _all: true },
    }),
    prisma.organizationRegistrationRequest.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.datasetRegistrationRequest.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);
  return {
    organizations: countsByStatus(Object.values(OrganizationStatus), organizations),
    organizationRequests: countsByStatus(Object.values(RequestStatus), organizationRequests),
    datasetRequests: countsByStatus(Object.values(RequestStatus), datasetRequests),
  };
}

// ---------------------------------------------------------------- ตารางต่อหน่วยงาน

/** คอลัมน์ตัวเลขของตาราง — ชื่อเดียวกับใน SQL และใน JSON */
export const ORGANIZATION_COUNT_COLUMNS = ["approved", "inReview", "returned", "draft", "closed", "total"] as const;
type CountColumn = (typeof ORGANIZATION_COUNT_COLUMNS)[number];

const SORT_SQL: Record<string, Prisma.Sql> = {
  name_asc: Prisma.sql`o.name_th ASC`,
  name_desc: Prisma.sql`o.name_th DESC`,
  ...Object.fromEntries(
    ORGANIZATION_COUNT_COLUMNS.flatMap((c) => [
      [`${c}_desc`, Prisma.sql`${Prisma.raw(`"${c}"`)} DESC`],
      [`${c}_asc`, Prisma.sql`${Prisma.raw(`"${c}"`)} ASC`],
    ]),
  ),
};

/** ค่าเริ่มต้นตามที่ผู้ขอถาม: หน่วยงานไหนมีชุดข้อมูลอนุมัติแล้วมากที่สุด — โทเคนที่ไม่รู้จักกลับมาที่ค่านี้ */
export const DEFAULT_ORGANIZATION_SORT = "approved_desc";

export function parseOrganizationSort(value: unknown): string {
  return typeof value === "string" && value in SORT_SQL ? value : DEFAULT_ORGANIZATION_SORT;
}

export interface OrganizationCountRow extends Record<CountColumn, number> {
  id: string;
  code: string;
  name: string;
  status: OrganizationStatus;
}

/**
 * หนึ่งหน้าของตารางต่อหน่วยงาน — `limit: null` คือทั้งหมด (CSV ใช้ทีละชุดผ่าน `offset` แทน)
 *
 * หน่วยงานที่ยังไม่มีคำขอเลยก็อยู่ในตาราง (เป็น 0) เพราะ "ยังไม่มีชุดข้อมูล" ก็เป็นคำตอบ ไม่ตัด BDI เองออกเหมือนหน้า ภาพรวม
 * `ORDER BY` ลงท้ายด้วยชื่อและ id เสมอ แถวที่ตัวเลขเท่ากันจึงมีลำดับแน่นอน ไม่ซ้ำหรือหายระหว่างหน้า
 */
export async function organizationCounts(params: {
  q: string;
  sort: string;
  limit: number;
  offset: number;
}): Promise<{ rows: OrganizationCountRow[]; total: number }> {
  const search = params.q.trim();
  const pattern = `%${search.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
  const where = search
    ? Prisma.sql`AND (o.name_th ILIKE ${pattern} OR o.organization_code ILIKE ${pattern})`
    : Prisma.empty;
  const raw = await prisma.$queryRaw<
    Array<Omit<OrganizationCountRow, CountColumn> & Record<CountColumn, bigint> & { total_rows: bigint }>
  >`
    WITH counts AS (
      SELECT organization_id,
        count(*) FILTER (WHERE status = 'APPROVED') AS approved,
        count(*) FILTER (WHERE status IN ('SUBMITTED', 'UNDER_REVIEW')) AS in_review,
        count(*) FILTER (WHERE status = 'RETURNED') AS returned,
        count(*) FILTER (WHERE status = 'DRAFT') AS draft,
        count(*) FILTER (WHERE status IN ('REJECTED', 'CANCELLED')) AS closed,
        count(*) AS total
      FROM dataset.dataset_registration_request
      GROUP BY organization_id
    )
    SELECT o.id, o.organization_code AS code, o.name_th AS name, o.status,
      COALESCE(c.approved, 0) AS "approved",
      COALESCE(c.in_review, 0) AS "inReview",
      COALESCE(c.returned, 0) AS "returned",
      COALESCE(c.draft, 0) AS "draft",
      COALESCE(c.closed, 0) AS "closed",
      COALESCE(c.total, 0) AS "total",
      count(*) OVER () AS total_rows
    FROM organization.organization o
    LEFT JOIN counts c ON c.organization_id = o.id
    WHERE o.id <> ${BDI_ORGANIZATION_ID}::uuid ${where}
    ORDER BY ${SORT_SQL[parseOrganizationSort(params.sort)]}, o.name_th ASC, o.id ASC
    LIMIT ${params.limit} OFFSET ${params.offset}
  `;
  const total = Number(raw[0]?.total_rows ?? 0);
  const rows = raw.map(({ total_rows: _drop, ...r }) => ({
    ...r,
    ...(Object.fromEntries(ORGANIZATION_COUNT_COLUMNS.map((c) => [c, Number(r[c])])) as Record<CountColumn, number>),
  }));
  return { rows, total };
}
