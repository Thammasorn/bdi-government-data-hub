/**
 * หน้า "สถิติ" — จำนวนหน่วยงาน คำขอส่งชุดข้อมูล และตารางต่อหน่วยงาน (feedback "features 1 full" แถว 15, 2026-10-27)
 *
 *   GET /api/statistics/summary                       ตัวเลขรวมแยกสถานะ
 *   GET /api/statistics/organizations?q=&sort=&page=&pageSize=
 *   GET /api/statistics/organizations.csv?q=&sort=    ทั้งหมดตามตัวกรอง ไม่ใช่แค่หน้าที่เห็น
 *
 * ผู้ที่เห็น: ผู้ประสานงานของ BDI ผู้มีอำนาจอนุมัติของ BDI และผู้ดูแลระบบ — ตามที่ชีตระบุ อยู่นอก `/api/admin` เพราะทางนั้นเป็นของ
 * ผู้ดูแลระบบอย่างเดียว (`requireAdmin`) และรับ admin token ด้วย ซึ่งหน้านี้ไม่ต้องการ ข้อมูลเป็นตัวเลขกับชื่อหน่วยงาน ไม่มีข้อมูล
 * บุคคล จึงไม่เขียน audit ต่อการเปิดดู
 */
import { z } from "zod";

import { Router } from "../lib/async-route.js";
import { organizationCounts, parseOrganizationSort, registrationCounts } from "../lib/statistics.js";
import { ROLE_CODES } from "../lib/system.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

export const statisticsRouter = Router();
statisticsRouter.use(
  requireAuth,
  requireRole(ROLE_CODES.BDI_OFFICER, ROLE_CODES.BDI_FINAL_APPROVER, ROLE_CODES.SYSTEM_ADMINISTRATOR),
);

statisticsRouter.get("/summary", async (_req, res) => {
  const counts = await registrationCounts();
  res.json({ ...counts, generatedAt: new Date() });
});

const listQuery = z.object({
  q: z.string().max(200).optional().default(""),
  sort: z.string().optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
});

statisticsRouter.get("/organizations", async (req, res) => {
  const parsed = listQuery.safeParse(req.query);
  const { q, sort, page, pageSize } = parsed.success ? parsed.data : listQuery.parse({});
  const sortToken = parseOrganizationSort(sort);
  const { rows, total } = await organizationCounts({ q, sort: sortToken, limit: pageSize, offset: (page - 1) * pageSize });
  res.json({ organizations: rows, total, page, pageSize, sort: sortToken });
});

/** ทีละชุด — ไฟล์ใหญ่แค่ไหนก็ไม่ถือทั้งไฟล์ไว้ในหน่วยความจำ */
const CSV_BATCH = 500;

const CSV_COLUMNS: Array<{ header: string; value: (r: Awaited<ReturnType<typeof organizationCounts>>["rows"][number]) => string | number }> = [
  { header: "รหัสหน่วยงาน", value: (r) => r.code },
  { header: "ชื่อหน่วยงาน", value: (r) => r.name },
  { header: "อนุมัติแล้ว", value: (r) => r.approved },
  { header: "รอพิจารณา", value: (r) => r.inReview },
  { header: "รอการแก้ไข", value: (r) => r.returned },
  { header: "ฉบับร่าง", value: (r) => r.draft },
  { header: "ไม่อนุมัติ/ยกเลิก", value: (r) => r.closed },
  { header: "รวม", value: (r) => r.total },
];

/**
 * ช่อง CSV — ใส่เครื่องหมายคำพูดเมื่อจำเป็น และกันสูตร: ชื่อที่ขึ้นต้นด้วย = + - @ ถูก Excel อ่านเป็นสูตรเมื่อเปิดไฟล์
 * ชื่อหน่วยงานพิมพ์โดยผู้ใช้ฝั่งหน่วยงาน จึงต่อ ' ข้างหน้าแบบที่ OWASP แนะนำ ตัวเลขผ่านไปตามเดิม
 */
function csvCell(value: string | number): string {
  if (typeof value === "number") return String(value);
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

statisticsRouter.get("/organizations.csv", async (req, res) => {
  const parsed = listQuery.safeParse(req.query);
  const q = parsed.success ? parsed.data.q : "";
  const sort = parseOrganizationSort(parsed.success ? parsed.data.sort : undefined);
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="organization-datasets-${stamp}.csv"`);
  res.setHeader("Cache-Control", "no-store");
  // BOM: Excel เปิด CSV ที่ไม่มี BOM ด้วย code page ของเครื่อง ภาษาไทยจะกลายเป็นตัวอักษรเพี้ยน
  res.write("﻿" + CSV_COLUMNS.map((c) => csvCell(c.header)).join(",") + "\r\n");
  for (let offset = 0; ; offset += CSV_BATCH) {
    const { rows } = await organizationCounts({ q, sort, limit: CSV_BATCH, offset });
    if (rows.length > 0) res.write(rows.map((r) => CSV_COLUMNS.map((c) => csvCell(c.value(r))).join(",")).join("\r\n") + "\r\n");
    if (rows.length < CSV_BATCH) break;
  }
  res.end();
});
