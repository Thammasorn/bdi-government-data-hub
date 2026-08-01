"use client";

import clsx from "clsx";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";

import { useSession } from "@/components/SessionProvider";
import { Card, StatusBadge } from "@/components/ui/Card";
import { SkeletonRows, Spinner } from "@/components/ui/Spinner";
import { useToast } from "@/components/ui/Toast";
import { api } from "@/lib/api";
import { STATUS_META, formatThaiDate, isBdiStaff, type OrganizationStatus } from "@/lib/status";
import type { OrganizationListItem } from "@/lib/types";

const FILTERABLE: OrganizationStatus[] = [
  "PENDING_BDI_REVIEW",
  "PENDING_SIGNATORY_REVIEW",
  "PENDING_BDI_APPROVAL",
  "NEEDS_REVISION",
  "ACTIVE",
  "DRAFT",
];

export default function AdminOrganizationsPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <OrganizationTable />
    </Suspense>
  );
}

function OrganizationTable() {
  const router = useRouter();
  const params = useSearchParams();
  const { user, loading: sessionLoading } = useSession();
  const { show } = useToast();

  const [rows, setRows] = useState<OrganizationListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<OrganizationStatus>>(
    () => new Set((params.get("status")?.split(",").filter(Boolean) as OrganizationStatus[]) ?? []),
  );

  useEffect(() => {
    if (sessionLoading) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    if (!isBdiStaff(user.roles)) router.replace("/");
  }, [user, sessionLoading, router]);

  // debounce การค้นหา ไม่ยิง API ทุกตัวอักษร
  const statusParam = useMemo(() => [...selected].join(","), [selected]);
  useEffect(() => {
    const timer = setTimeout(() => {
      const qs = new URLSearchParams();
      if (statusParam) qs.set("status", statusParam);
      if (query.trim()) qs.set("q", query.trim());
      api
        .get<{ organizations: OrganizationListItem[] }>(`/api/organizations?${qs}`)
        .then((d) => setRows(d.organizations))
        .catch(() => show({ tone: "error", title: "โหลดรายการไม่สำเร็จ" }))
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(timer);
  }, [statusParam, query, show]);

  const toggle = (status: OrganizationStatus) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  };

  if (sessionLoading || !user) return <Spinner />;

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <header className="mb-7">
        <h1 className="text-[26px] font-semibold text-navy-800">หน่วยงาน</h1>
        <p className="mt-1.5 text-[15px] text-ink-muted">
          คำขอสร้างหน่วยงานทั้งหมดในระบบ กรองตามสถานะหรือค้นหาจากชื่อหน่วยงานและผู้ยื่น
        </p>
      </header>

      <div className="mb-5 flex flex-col gap-4">
        <div className="relative max-w-md">
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
            placeholder="ค้นหาชื่อหน่วยงาน หรือผู้ยื่น"
            aria-label="ค้นหา"
            className="h-11 w-full rounded-full border border-line bg-white pl-10 pr-4 text-[15px] transition-[border-color,box-shadow] placeholder:text-ink-subtle focus:border-navy-500 focus:shadow-[0_0_0_3px_var(--color-navy-100)]"
          />
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
                {STATUS_META[s].label}
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
          <EmptyState hasFilter={selected.size > 0 || query.trim().length > 0} />
        ) : (
          <>
            <div className="hidden grid-cols-[minmax(0,2fr)_minmax(0,1.6fr)_auto_9rem] gap-4 border-b border-line px-6 py-3 text-[12px] font-semibold uppercase tracking-wide text-ink-subtle md:grid">
              <span>ชื่อหน่วยงาน</span>
              <span>ผู้สร้าง</span>
              <span>สถานะ</span>
              <span className="text-right">วันที่ยื่น</span>
            </div>
            <ul className="divide-y divide-line">
              {rows.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => router.push(`/admin/organizations/${row.id}`)}
                    className="grid w-full grid-cols-1 items-center gap-2 px-6 py-4 text-left transition-colors hover:bg-navy-50/60 md:grid-cols-[minmax(0,2fr)_minmax(0,1.6fr)_auto_9rem] md:gap-4"
                  >
                    <span className="truncate font-medium text-ink">{row.name}</span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-ink">
                        {[row.createdBy.firstName, row.createdBy.lastName].filter(Boolean).join(" ") || "—"}
                      </span>
                      <span className="block truncate text-[13px] text-ink-muted">{row.createdBy.email}</span>
                    </span>
                    <span className="justify-self-start">
                      <StatusBadge status={row.status} />
                    </span>
                    <span className="text-[13px] text-ink-muted md:text-right">
                      {row.submittedAt ? formatThaiDate(row.submittedAt).split(" ").slice(0, 3).join(" ") : "—"}
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
    </div>
  );
}

function EmptyState({ hasFilter }: { hasFilter: boolean }) {
  return (
    <div className="px-6 py-20 text-center">
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-navy-50">
        <svg viewBox="0 0 24 24" className="h-6 w-6 text-navy-400" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
          <path d="M4 20V7l8-4 8 4v13" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M2 20h20M10 11h4M10 15h4" strokeLinecap="round" />
        </svg>
      </div>
      <p className="mt-4 font-medium text-ink">
        {hasFilter ? "ไม่พบรายการที่ตรงกับเงื่อนไข" : "ยังไม่มีคำขอสร้างหน่วยงาน"}
      </p>
      <p className="mt-1 text-sm text-ink-muted">
        {hasFilter ? "ลองล้างตัวกรองหรือเปลี่ยนคำค้นหา" : "เมื่อมีหน่วยงานยื่นคำขอเข้ามา รายการจะแสดงที่นี่"}
      </p>
    </div>
  );
}
