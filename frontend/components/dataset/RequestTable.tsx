"use client";

import clsx from "clsx";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { ApprovalStepsCompact } from "@/components/review/ApprovalSteps";
import { Card, DatasetStatusBadge } from "@/components/ui/Card";
import { SkeletonRows } from "@/components/ui/Spinner";
import { useToast } from "@/components/ui/Toast";
import { api } from "@/lib/api";
import { DATASET_STATUS_META, formatThaiDate, type DatasetRequestStatus } from "@/lib/status";
import { datasetTitle, type DatasetRequestListItem } from "@/lib/types";

const FILTERABLE: DatasetRequestStatus[] = [
  "DRAFT",
  "SUBMITTED",
  "UNDER_REVIEW",
  "RETURNED",
  "APPROVED",
  "REJECTED",
];

/**
 * ตารางคำขอที่ใช้ร่วมกันทั้งฝั่งหน่วยงานและฝั่ง BDI
 * ต่างกันแค่ปลายทางของลิงก์และคอลัมน์ "หน่วยงาน" ที่ฝั่งหน่วยงานไม่ต้องเห็น
 */
export function DatasetRequestTable({
  basePath,
  showOrganization,
  initialStatuses = [],
  emptyHint,
  action,
}: {
  basePath: string;
  showOrganization: boolean;
  initialStatuses?: DatasetRequestStatus[];
  emptyHint: string;
  action?: ReactNode;
}) {
  const router = useRouter();
  const { show } = useToast();

  const [rows, setRows] = useState<DatasetRequestListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<DatasetRequestStatus>>(
    () => new Set(initialStatuses),
  );

  const statusParam = useMemo(() => [...selected].join(","), [selected]);

  useEffect(() => {
    // debounce การค้นหา ไม่ยิง API ทุกตัวอักษร
    const timer = setTimeout(() => {
      const qs = new URLSearchParams();
      if (statusParam) qs.set("status", statusParam);
      if (query.trim()) qs.set("q", query.trim());
      api
        .get<{ requests: DatasetRequestListItem[] }>(`/api/dataset-requests?${qs}`)
        .then((d) => setRows(d.requests))
        .catch(() => show({ tone: "error", title: "โหลดรายการไม่สำเร็จ" }))
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(timer);
  }, [statusParam, query, show]);

  const toggle = (status: DatasetRequestStatus) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  };

  // เขียนคลาสเต็มทั้งสองแบบไว้ตรง ๆ — Tailwind สแกนไฟล์แบบ static คลาสที่ต่อสตริงเองจะไม่ถูกสร้าง
  // คอลัมน์สถานะกว้างคงที่ ไม่ใช้ auto เพราะหัวตารางกับแถวเป็นคนละ grid
  // ถ้าใช้ auto ต่างฝ่ายต่างคิดความกว้างจากเนื้อหาตัวเอง คอลัมน์จะไม่ตรงกัน
  const columns = showOrganization
    ? "md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_12rem_13rem_8rem]"
    : "md:grid-cols-[minmax(0,2fr)_12rem_13rem_8rem]";

  return (
    <>
      <div className="mb-5 flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative max-w-md flex-1">
            <svg
              viewBox="0 0 20 20"
              className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              aria-hidden="true"
            >
              <circle cx="9" cy="9" r="6" />
              <path d="m13.5 13.5 3 3" strokeLinecap="round" />
            </svg>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ค้นหาชื่อชุดข้อมูล เลขที่คำขอ หรือหน่วยงาน"
              aria-label="ค้นหา"
              className="h-11 w-full rounded-full border border-line bg-white pl-10 pr-4 text-[15px] transition-[border-color,box-shadow] placeholder:text-ink-subtle focus:border-navy-500 focus:shadow-[0_0_0_3px_var(--color-navy-100)]"
            />
          </div>
          {action}
        </div>

        <div className="flex flex-wrap gap-2" role="group" aria-label="กรองตามสถานะ">
          {FILTERABLE.map((s) => {
            const active = selected.has(s);
            return (
              <button
                key={s}
                type="button"
                aria-pressed={active}
                onClick={() => toggle(s)}
                className={clsx(
                  "rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition-colors",
                  active
                    ? "border-navy-800 bg-navy-800 text-white"
                    : "border-line bg-white text-ink-muted hover:border-navy-300 hover:text-navy-700",
                )}
              >
                {DATASET_STATUS_META[s].label}
              </button>
            );
          })}
          {selected.size > 0 ? (
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="rounded-full px-3 py-1.5 text-[13px] font-medium text-ink-muted underline-offset-2 hover:underline"
            >
              ล้างตัวกรอง
            </button>
          ) : null}
        </div>
      </div>

      <Card className="overflow-hidden">
        {loading ? (
          <SkeletonRows />
        ) : rows.length === 0 ? (
          <EmptyState
            hasFilter={selected.size > 0 || query.trim().length > 0}
            emptyHint={emptyHint}
          />
        ) : (
          <>
            <div
              className={clsx(
                "hidden gap-4 border-b border-line px-6 py-3 text-[12px] font-semibold uppercase tracking-wide text-ink-subtle md:grid",
                columns,
              )}
            >
              <span>ชุดข้อมูล</span>
              {showOrganization ? <span>หน่วยงาน</span> : null}
              <span>สถานะ</span>
              <span>ความคืบหน้า</span>
              <span className="text-right">วันที่นำส่ง</span>
            </div>
            <ul className="divide-y divide-line">
              {rows.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => router.push(`${basePath}/${row.id}`)}
                    className={clsx(
                      "grid w-full grid-cols-1 items-center gap-2 px-6 py-4 text-left transition-colors hover:bg-navy-50/60 md:gap-4",
                      columns,
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-ink">{datasetTitle(row)}</span>
                      <span className="block truncate text-[13px] text-ink-muted">
                        {row.requestNumber}
                        {row.assignedSpecialist
                          ? ` · ผู้เชี่ยวชาญ ${[row.assignedSpecialist.firstName, row.assignedSpecialist.lastName].filter(Boolean).join(" ")}`
                          : ""}
                      </span>
                    </span>
                    {showOrganization ? (
                      <span className="min-w-0 truncate text-sm text-ink">{row.organization.name}</span>
                    ) : null}
                    <span className="justify-self-start">
                      {/* ส่ง currentTaskType ไปด้วย ไม่งั้นแถวขึ้นแค่ "นำส่งแล้ว" ทั้งที่ข้อมูลด่านมาถึงแล้ว */}
                      <DatasetStatusBadge status={row.status} currentTaskType={row.currentTaskType} />
                    </span>
                    <span className="min-w-0">
                      <ApprovalStepsCompact progress={row.progress} />
                    </span>
                    <span className="text-[13px] text-ink-muted md:text-right">
                      {row.submittedAt
                        ? formatThaiDate(row.submittedAt).split(" ").slice(0, 3).join(" ")
                        : "—"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      {!loading && rows.length > 0 ? (
        <p className="mt-4 text-[13px] text-ink-muted">แสดง {rows.length} รายการ</p>
      ) : null}
    </>
  );
}

function EmptyState({ hasFilter, emptyHint }: { hasFilter: boolean; emptyHint: string }) {
  return (
    <div className="px-6 py-20 text-center">
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-navy-50">
        <svg
          viewBox="0 0 24 24"
          className="h-6 w-6 text-navy-400"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          aria-hidden="true"
        >
          <ellipse cx="12" cy="6" rx="7" ry="3" />
          <path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6" strokeLinecap="round" />
          <path d="M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3" strokeLinecap="round" />
        </svg>
      </div>
      <p className="mt-4 font-medium text-ink">
        {hasFilter ? "ไม่พบรายการที่ตรงกับเงื่อนไข" : "ยังไม่มีคำขอลงทะเบียนชุดข้อมูล"}
      </p>
      <p className="mt-1 text-sm text-ink-muted">
        {hasFilter ? "ลองล้างตัวกรองหรือเปลี่ยนคำค้นหา" : emptyHint}
      </p>
    </div>
  );
}
