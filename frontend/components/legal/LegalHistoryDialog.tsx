"use client";

import clsx from "clsx";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Pagination } from "@/components/list/Pagination";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { SkeletonRows } from "@/components/ui/Spinner";
import { api } from "@/lib/api";
import { APPROVAL_STATUS_META, thaiDate, type LegalHistoryRow } from "@/lib/legal-status";
import type { PageInfo } from "@/lib/stage";

/** หน่วยงานกับเอกสารที่จะดูประวัติ — ตาราง หน้างานลงนาม และหน้ารายละเอียดเอกสารส่งรูปเดียวกัน */
export interface HistoryTarget {
  organizationId: string;
  documentId: string;
  documentLabel: string;
  organizationName: string;
}

/** ป้ายสถานะบรรทัดเดียว ทรงเดียวกับ `OrganizationStatusBadge` — ชื่อสั้นจึงไม่ต้องตกบรรทัด */
export function StatusPill({ meta, wrap = false }: { meta: { label: string; className: string }; wrap?: boolean }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-medium",
        // wrap: บรรทัดเดียวเมื่อการ์ดกว้าง ตกบรรทัดเฉพาะเมื่อการ์ดแคบกว่า 56rem (ต้องอยู่ใน `@container`)
        wrap ? "whitespace-nowrap @max-[56rem]:items-start @max-[56rem]:whitespace-normal" : "whitespace-nowrap",
        meta.className,
      )}
    >
      <span className={clsx("h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-70", wrap && "@max-[56rem]:mt-[0.45rem]")} aria-hidden="true" />
      {meta.label}
    </span>
  );
}

/** ประวัติการลงนามของหน่วยงานกับเอกสารหนึ่งฉบับ — popup พร้อมแบ่งหน้า */
export function LegalHistoryDialog({
  target,
  base,
  onClose,
}: {
  target: HistoryTarget | null;
  /** หน้ารายการที่หน้านี้อยู่ใต้ — "/legal-documents" หรือ "/console/legal-status" (ใช้ประกอบลิงก์ "ดูรายละเอียด") */
  base: string;
  onClose: () => void;
}) {
  const row = target;
  /** ปุ่ม "ดูรายละเอียด" ของแต่ละแถว — งานลงนามเปิดหน้างานนั้น · ลงนามตอนลงทะเบียนเปิดหน้าเวอร์ชันนั้น (feedback 2026-11-22) */
  const hrefOf = (h: LegalHistoryRow) =>
    "approvalId" in h.link
      ? `${base}/approvals/${h.link.approvalId}`
      : `${base}/documents/${target!.organizationId}/${target!.documentId}?version=${h.link.versionId}`;
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [data, setData] = useState<(PageInfo & { rows: LegalHistoryRow[] }) | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!row) return;
    setError(null);
    try {
      setData(
        await api.get(
          `/api/legal-status/${row.organizationId}/${row.documentId}/history?page=${page}&pageSize=${pageSize}`,
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "โหลดประวัติไม่สำเร็จ");
    }
  }, [row, page, pageSize]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setPage(1);
    setData(null);
  }, [row]);

  return (
    <Modal
      open={row !== null}
      onClose={onClose}
      size="xl"
      title="ประวัติการลงนาม"
      description={row ? `${row.documentLabel} · ${row.organizationName}` : undefined}
    >
      {error ? (
        <p className="rounded-xl bg-danger-bg p-5 text-sm text-danger">{error}</p>
      ) : !data ? (
        <SkeletonRows rows={3} />
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl ring-1 ring-line">
            <table className="w-full min-w-[44rem] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[12px] font-semibold uppercase tracking-wide text-ink-subtle">
                  <th className="px-4 py-3">เวอร์ชัน</th>
                  <th className="px-4 py-3">วันที่มีผล</th>
                  <th className="px-4 py-3">ผู้มีอำนาจอนุมัติของหน่วยงาน</th>
                  <th className="px-4 py-3">ผู้มีอำนาจอนุมัติของ BDI</th>
                  <th className="px-4 py-3">สถานะ</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.rows.map((h) => (
                  <tr key={h.key} className="align-top">
                    <td className="px-4 py-3 font-medium text-ink">{h.versionDisplay}</td>
                    <td className="px-4 py-3 text-ink">{thaiDate(h.effectiveAt)}</td>
                    <td className="px-4 py-3">
                      <span className="block text-ink">{h.orgApproverName ?? "—"}</span>
                      {h.orgApprovedAt ? <span className="block text-[13px] text-ink-muted">{thaiDate(h.orgApprovedAt)}</span> : null}
                    </td>
                    <td className="px-4 py-3">
                      <span className="block text-ink">{h.bdiApproverName ?? "—"}</span>
                      {h.bdiApprovedAt ? <span className="block text-[13px] text-ink-muted">{thaiDate(h.bdiApprovedAt)}</span> : null}
                    </td>
                    <td className="px-4 py-3">
                      <StatusPill meta={APPROVAL_STATUS_META[h.status]} />
                    </td>
                    <td className="w-px whitespace-nowrap px-4 py-3 text-right">
                      <Button size="sm" variant="secondary" onClick={() => router.push(hrefOf(h))}>
                        ดูรายละเอียด
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            info={data}
            onPage={setPage}
            pageSize={pageSize}
            onPageSize={(size) => {
              setPageSize(size);
              setPage(1);
            }}
          />
        </>
      )}
      <div className="mt-5 flex justify-end">
        <Button variant="secondary" onClick={onClose}>
          ปิด
        </Button>
      </div>
    </Modal>
  );
}
