"use client";

import clsx from "clsx";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { DateTimeCell } from "@/components/list/DateTimeCell";
import { ChangeStatusBadge, RepresentativeShell } from "@/components/representatives/Shell";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Spinner } from "@/components/ui/Spinner";
import { useToast } from "@/components/ui/Toast";
import { api, ApiError } from "@/lib/api";
import { FLOW_NODES, type ChangeRow, type ChangeStatus } from "@/lib/representatives";
import { useRequireAuth } from "@/lib/require-auth";
import { isBdiStaff } from "@/lib/status";

interface ListResponse {
  requests: ChangeRow[];
  total: number;
  page: number;
  pageSize: number;
  counts: Partial<Record<ChangeStatus, number>>;
}

export default function ChangeRequestsPage() {
  const router = useRouter();
  const { show } = useToast();
  const { user, loading } = useRequireAuth();
  const [data, setData] = useState<ListResponse | null>(null);
  const [node, setNode] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    const statuses = FLOW_NODES.find((n) => n.key === node)?.statuses.join(",") ?? "";
    api
      .get<ListResponse>(`/api/representative-changes?page=${page}&pageSize=20&status=${statuses}`)
      .then(setData)
      .catch((err: Error) => show({ tone: "error", title: "โหลดรายการไม่สำเร็จ", detail: err.message }));
  }, [node, page, show]);

  useEffect(() => {
    if (!loading && user) load();
  }, [loading, user, load]);

  if (loading || !user) return <Spinner />;
  const bdi = isBdiStaff(user.roles);
  const canCreate = user.roles.includes("ORGANIZATION_USER");

  const create = async () => {
    setCreating(true);
    try {
      const { request } = await api.post<{ request: { id: string } }>("/api/representative-changes", {});
      router.push(`/representatives/requests/${request.id}/edit`);
    } catch (err) {
      show({ tone: "error", title: "สร้างคำขอไม่สำเร็จ", detail: err instanceof ApiError ? err.message : undefined });
      setCreating(false);
    }
  };

  return (
    <RepresentativeShell
      title="ฟอร์มเปลี่ยนแปลงผู้แทนหน่วยงาน"
      description="คำขอยกเลิกผู้แทนเดิมและเพิ่มผู้แทนใหม่ของหน่วยงาน"
    >
      {canCreate ? (
        <Button className="mb-4 h-auto min-h-11 py-2" onClick={create} loading={creating}>
          กรอก คำขอเปลี่ยนแปลงผู้มีอำนาจและผู้ประสานงานของหน่วยงาน
        </Button>
      ) : null}

      <Card className="mb-4 px-5 py-4">
        <p className="mb-3 text-sm font-medium text-ink">Flow จำนวน</p>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="กรองตามขั้นตอน">
          {FLOW_NODES.map((item) => {
            const count = item.statuses.reduce((sum, s) => sum + (data?.counts[s] ?? 0), 0);
            const active = node === item.key;
            return (
              <button
                key={item.key}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => {
                  setNode(active ? null : item.key);
                  setPage(1);
                }}
                className={clsx(
                  "rounded-xl px-4 py-2 text-sm ring-1 ring-line",
                  active ? "bg-navy-800 text-white" : "bg-white text-navy-800 hover:bg-navy-50",
                )}
              >
                {item.label} <span className="font-semibold">{count}</span>
              </button>
            );
          })}
        </div>
      </Card>

      <Card className="overflow-x-auto">
        <table className="w-full min-w-[44rem] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-ink-muted">
              {bdi ? <th className="px-4 py-3 font-medium">หน่วยงาน</th> : null}
              <th className="px-4 py-3 font-medium">เลขที่คำขอ</th>
              <th className="px-4 py-3 font-medium">สถานะ</th>
              <th className="px-4 py-3 font-medium">วัน-เวลา</th>
              <th className="px-4 py-3 font-medium">ชื่อเอกสาร</th>
              <th className="px-4 py-3 font-medium" />
            </tr>
          </thead>
          <tbody>
            {data?.requests.map((row) => {
              const canEditRow = canCreate && (row.status === "DRAFT" || row.status === "RETURNED");
              const canReviewRow =
                user.roles.includes("BDI_OFFICER") && (row.status === "SUBMITTED" || row.status === "UNDER_REVIEW");
              return (
                <tr key={row.id} className="border-b border-line last:border-0">
                  {bdi ? <td className="px-4 py-3">{row.organization.nameTh}</td> : null}
                  <td className="px-4 py-3 font-medium text-navy-800">{row.requestNumber}</td>
                  <td className="px-4 py-3">
                    <ChangeStatusBadge status={row.status} />
                  </td>
                  <td className="px-4 py-3">
                    <DateTimeCell value={row.updatedAt} label="วัน-เวลา" />
                  </td>
                  <td className="px-4 py-3 text-ink-muted">{row.documentName ?? "–"}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    <Link className="text-navy-700 underline" href={`/representatives/requests/${row.id}`}>
                      {canReviewRow ? "review" : "view"}
                    </Link>
                    {canEditRow ? (
                      <Link className="ml-3 text-navy-700 underline" href={`/representatives/requests/${row.id}/edit`}>
                        edit
                      </Link>
                    ) : null}
                  </td>
                </tr>
              );
            })}
            {data && data.requests.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-ink-muted">
                  ยังไม่มีคำขอ
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </Card>
      {data && data.total > data.pageSize ? (
        <div className="mt-4 flex items-center justify-end gap-2">
          <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            ก่อนหน้า
          </Button>
          <span className="text-sm text-ink-muted">หน้า {page}</span>
          <Button
            size="sm"
            variant="secondary"
            disabled={page * data.pageSize >= data.total}
            onClick={() => setPage(page + 1)}
          >
            ถัดไป
          </Button>
        </div>
      ) : null}
    </RepresentativeShell>
  );
}
