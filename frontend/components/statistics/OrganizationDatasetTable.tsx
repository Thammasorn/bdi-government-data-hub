"use client";

import { useState } from "react";

import { DataTable, type Column } from "@/components/console/DataTable";
import { ErrorNotice, Panel, SearchBox } from "@/components/console/ui";
import { adminErrorView } from "@/lib/admin-errors";
import { api } from "@/lib/api";
import { useAdminData } from "@/lib/use-admin";

/**
 * ชุดข้อมูลต่อหน่วยงาน — ตารางเดียวที่หน้า ภาพรวม ของ /console และหน้า "สถิติ" ของ BDI ใช้ร่วมกัน
 * (feedback "features 1 full" แถว 15: "หน่วยงานมีชุดข้อมูลอนุมัติแล้วกี่อัน" + เรียงตามหน่วยงาน + export)
 *
 * ค้นหา เรียง และแบ่งหน้าทำที่ฐานข้อมูลทั้งหมด (`GET /api/statistics/organizations`) — ตารางนี้ถือแค่หน้าที่เห็น จำนวนหน่วยงาน
 * จะโตแค่ไหนหน้าก็ไม่ช้าลง ปุ่ม CSV ส่งตัวกรองเดียวกันไปที่ปลายทางที่ stream ทั้งชุด ไม่ใช่แค่หน้าที่เห็น
 */

interface OrganizationCountRow {
  id: string;
  code: string;
  name: string;
  approved: number;
  inReview: number;
  returned: number;
  draft: number;
  closed: number;
  total: number;
}

interface OrganizationCountPage {
  organizations: OrganizationCountRow[];
  total: number;
  page: number;
  pageSize: number;
}

const SORT_OPTIONS = [
  { value: "approved_desc", label: "อนุมัติแล้ว มาก → น้อย" },
  { value: "approved_asc", label: "อนุมัติแล้ว น้อย → มาก" },
  { value: "total_desc", label: "คำขอทั้งหมด มาก → น้อย" },
  { value: "inReview_desc", label: "รอพิจารณา มาก → น้อย" },
  { value: "returned_desc", label: "รอการแก้ไข มาก → น้อย" },
  { value: "name_asc", label: "ชื่อหน่วยงาน ก → ฮ" },
  { value: "name_desc", label: "ชื่อหน่วยงาน ฮ → ก" },
];

const number = (n: number) => n.toLocaleString("th-TH");

const COLUMNS: Column<OrganizationCountRow>[] = [
  {
    key: "name",
    header: "หน่วยงาน",
    cell: (r) => (
      <>
        <span className="font-medium text-ink">{r.name}</span>
        <span className="block text-[12.5px] text-ink-subtle">{r.code}</span>
      </>
    ),
  },
  { key: "approved", header: "อนุมัติแล้ว", cell: (r) => <strong className="text-navy-800">{number(r.approved)}</strong>, className: "text-right tabular-nums" },
  { key: "inReview", header: "รอพิจารณา", cell: (r) => number(r.inReview), className: "text-right tabular-nums" },
  { key: "returned", header: "รอการแก้ไข", cell: (r) => number(r.returned), className: "text-right tabular-nums" },
  { key: "draft", header: "ฉบับร่าง", cell: (r) => number(r.draft), className: "text-right tabular-nums" },
  { key: "closed", header: "ไม่อนุมัติ/ยกเลิก", cell: (r) => number(r.closed), className: "text-right tabular-nums" },
  { key: "total", header: "รวม", cell: (r) => number(r.total), className: "text-right tabular-nums" },
];

export function OrganizationDatasetTable({ title = "สถิติชุดข้อมูลต่อหน่วยงาน" }: { title?: string }) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("approved_desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const params = new URLSearchParams({ sort, page: String(page), pageSize: String(pageSize) });
  if (q) params.set("q", q);
  const { data, error, loading } = useAdminData<OrganizationCountPage>(`/api/statistics/organizations?${params}`);

  const csvParams = new URLSearchParams({ sort });
  if (q) csvParams.set("q", q);

  return (
    <Panel
      title={title}
      description="จำนวนคำขอส่งชุดข้อมูลของแต่ละหน่วยงานแยกตามสถานะ — นับจากคำขอทั้งหมดในระบบ ณ เวลาที่เปิดหน้า"
      actions={
        <a
          href={api.fileUrl(`/api/statistics/organizations.csv?${csvParams}`)}
          className="inline-flex h-9 items-center rounded-full border border-line bg-white px-4 text-[13.5px] font-medium text-navy-700 transition-colors hover:bg-navy-50"
        >
          ดาวน์โหลด CSV
        </a>
      }
      flush
    >
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3">
        <div className="min-w-[16rem] flex-1">
          <SearchBox
            value={q}
            onCommit={(v) => {
              setQ(v);
              setPage(1);
            }}
            placeholder="ค้นหาชื่อหรือรหัสหน่วยงาน"
          />
        </div>
        <label className="inline-flex items-center gap-2 text-[13px] text-ink-muted">
          เรียงตาม
          <select
            value={sort}
            onChange={(e) => {
              setSort(e.target.value);
              setPage(1);
            }}
            className="h-9 rounded-full border border-line bg-white px-3.5 text-[13px] font-medium text-ink focus:border-navy-500 focus:shadow-[0_0_0_3px_var(--color-navy-100)]"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && !data ? (
        <div className="p-5">
          <ErrorNotice view={adminErrorView(error)} />
        </div>
      ) : (
        <DataTable
          columns={COLUMNS}
          rows={data?.organizations ?? null}
          rowKey={(r) => r.id}
          loading={loading}
          empty={<p className="px-5 py-8 text-center text-[14px] text-ink-muted">ไม่พบหน่วยงานที่ตรงกับคำค้น</p>}
          page={page}
          pageSize={pageSize}
          total={data?.total}
          onPage={setPage}
          onPageSize={(size) => {
            setPageSize(size);
            setPage(1);
          }}
        />
      )}
    </Panel>
  );
}
