"use client";

import Link from "next/link";
import { useState } from "react";

import { Badge, ErrorNotice, FilterSelect, SearchBox } from "@/components/console/ui";
import { Pagination } from "@/components/list/Pagination";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";
import { adminErrorView } from "@/lib/admin-errors";
import { REQUEST_STATUS_META, formatThaiDate, type RequestStatus } from "@/lib/status";
import { useAdminData } from "@/lib/use-admin";

interface RelatedRequest {
  id: string;
  requestNumber: string;
  status: RequestStatus;
  submittedAt: string | null;
  organizationName: string;
  /** ชื่อชุดข้อมูล — มีเฉพาะคำขอส่งชุดข้อมูล */
  title: string | null;
}

interface Payload {
  scope: "ORGANIZATION_REGISTRATION" | "DATASET_REGISTRATION";
  page: number;
  pageSize: number;
  total: number;
  requests: RelatedRequest[];
}

export interface RelatedRequestsTarget {
  code: string;
  versionId: string;
  versionNumber: number;
}

/**
 * popup "ดูคำขอที่เกี่ยวข้อง" — คำขอทั้งหมดที่ผูกเอกสารเวอร์ชันนี้ไว้ตอนนำส่ง (`request_document_snapshot`)
 * แบ่งหน้า ค้นหาเลขที่คำขอ/ชื่อหน่วยงาน/ชื่อชุดข้อมูล และกรองตามสถานะ
 */
export function RelatedRequestsModal({
  target,
  onClose,
}: {
  target: RelatedRequestsTarget | null;
  onClose: () => void;
}) {
  return (
    <Modal
      open={target !== null}
      onClose={onClose}
      size="xl"
      title={target ? `คำขอที่ใช้ ${target.code} Version ${target.versionNumber}` : ""}
      description="คำขอที่นำส่งโดยผูกเอกสารเวอร์ชันนี้ไว้ — เวอร์ชันที่ผูกแล้วไม่เปลี่ยนแม้มีเวอร์ชันใหม่"
    >
      {target ? <Body key={target.versionId} target={target} /> : null}
    </Modal>
  );
}

function Body({ target }: { target: RelatedRequestsTarget }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");

  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (q) params.set("q", q);
  if (status) params.set("status", status);
  const { data, error, loading } = useAdminData<Payload>(
    `/api/admin/legal-documents/${target.code}/versions/${target.versionId}/requests?${params}`,
  );

  const isOrg = data?.scope === "ORGANIZATION_REGISTRATION";
  const href = (id: string) =>
    `/console/registrations/${isOrg ? "organizations" : "datasets"}/${id}`;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-[220px] flex-1">
          <SearchBox
            value={q}
            onCommit={(v) => {
              setQ(v);
              setPage(1);
            }}
            placeholder="ค้นหาเลขที่คำขอ ชื่อหน่วยงาน หรือชื่อชุดข้อมูล"
          />
        </div>
        <FilterSelect
          label="สถานะ"
          value={status}
          onChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
          options={(Object.keys(REQUEST_STATUS_META) as RequestStatus[]).map((s) => ({
            value: s,
            label: REQUEST_STATUS_META[s].label,
          }))}
        />
      </div>

      <div className="mt-4">
        {loading && !data ? (
          <Spinner />
        ) : error && !data ? (
          <ErrorNotice view={adminErrorView(error)} />
        ) : data && data.requests.length === 0 ? (
          <p className="rounded-xl bg-navy-50 px-4 py-6 text-center text-[14px] text-ink-muted">
            {q || status ? "ไม่พบคำขอที่ตรงกับเงื่อนไข" : "ยังไม่มีคำขอที่ใช้เอกสารเวอร์ชันนี้"}
          </p>
        ) : data ? (
          <>
            <ul className="divide-y divide-line rounded-xl ring-1 ring-line">
              {data.requests.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 font-medium text-ink">
                      <Link href={href(r.id)} className="text-navy-700 hover:underline">
                        {r.requestNumber}
                      </Link>
                      <Badge meta={REQUEST_STATUS_META[r.status]} />
                    </p>
                    <p className="truncate text-[13.5px] text-ink-muted">
                      {r.title ? `${r.title} · ` : ""}
                      {r.organizationName}
                    </p>
                  </div>
                  <p className="text-[13px] text-ink-muted">
                    {r.submittedAt ? `นำส่ง ${formatThaiDate(r.submittedAt)}` : "ยังไม่นำส่ง"}
                  </p>
                </li>
              ))}
            </ul>
            <Pagination
              info={{ ...data, pageCount: Math.max(1, Math.ceil(data.total / pageSize)) }}
              onPage={setPage}
              pageSize={pageSize}
              onPageSize={(size) => {
                setPageSize(size);
                setPage(1);
              }}
            />
          </>
        ) : null}
      </div>
    </div>
  );
}
