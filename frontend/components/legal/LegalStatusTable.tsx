"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { DataTable, EmptyState, type Column } from "@/components/console/DataTable";
import { QueueTabs } from "@/components/list/QueueTabs";
import { MultiSelectFilter } from "@/components/list/MultiSelectFilter";
import { LegalHistoryDialog, StatusPill as Badge } from "@/components/legal/LegalHistoryDialog";
import { RequestJoinDialog } from "@/components/legal/RequestJoinDialog";
import { Dropdown } from "@/components/list/SortSelect";
import { useSession } from "@/components/SessionProvider";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { SkeletonRows } from "@/components/ui/Spinner";
import { api } from "@/lib/api";
import {
  APPROVAL_STATUS_META,
  NOT_JOINED_META,
  rowDocumentLabel,
  rowMeta,
  thaiDate,
  type LegalStatusPage,
  type LegalStatusRow,
} from "@/lib/legal-status";
import { DEFAULT_PAGE_SIZE, type QueueTab } from "@/lib/use-request-list";

interface Options {
  documents: { id: string; documentCode: string; nameTh: string; shortname: string | null }[];
  organizations: { id: string; nameTh: string }[];
}


/**
 * ตาราง "สถานะเอกสารทางกฎหมายของหน่วยงาน" — ใช้ทั้งหน้า /legal-documents และ /console/legal-status
 *
 * หนึ่งแถวต่อ (หน่วยงาน, เอกสาร) · แท็บ "ที่ต้องดำเนินการ | ทั้งหมด" ตัวเดียวกับหน้ารายการคำขอ · ตัวกรองเป็นกล่องเลือกทรงเม็ดยา
 * ตัวเดียวกับ "เรียงตาม" · ประวัติเปิดใน popup พร้อมแบ่งหน้า · ปุ่มทำรายการขึ้นเฉพาะคนที่ backend ยอมให้ทำ
 */

/** ตัวกรองสถานะ — ป้ายชุดเดียวกับในตาราง (`rowMeta()`) · ค่าตรงกับ `STATUS_FILTERS` ใน backend/src/lib/legal-reacceptance.ts */
const STATUS_FILTER_ORDER = ["PENDING_ORG_APPROVAL", "PENDING_BDI_APPROVAL", "ACTIVE"] as const;

export function LegalStatusTable({ base = "/legal-documents" }: { base?: string }) {
  /** หน้ารายละเอียด — มีงานค้าง = หน้างานลงนาม · ไม่มี = เวอร์ชันที่ใช้อยู่ (หรือยังไม่ได้เข้าร่วม) */
  const approvalBase = `${base}/approvals`;
  const documentHref = (organizationId: string, documentId: string, versionId?: string) =>
    `${base}/documents/${organizationId}/${documentId}${versionId ? `?version=${versionId}` : ""}`;
  const router = useRouter();
  const { user } = useSession();
  const roles = user?.roles ?? [];
  const isOrgApprover = roles.includes("ORGANIZATION_APPROVER");
  const isBdiApprover = roles.includes("BDI_FINAL_APPROVER");

  /**
   * แท็บเริ่มต้น: มีงานที่ต้องดำเนินการ → "ที่ต้องดำเนินการ" · ไม่มี → "ทั้งหมด" — null ระหว่างถาม จะได้ไม่เห็นแท็บสลับไปมา
   * ถามครั้งเดียวตอนเปิดหน้า หลังจากนั้นแท็บเป็นของผู้ใช้
   */
  const [tab, setTab] = useState<QueueTab | null>(null);
  const [documentId, setDocumentId] = useState("");
  // ?organizationIds=a,b — ลิงก์ "ดูสถานะเอกสารทางกฎหมายของหน่วยงาน" จากหน้าคำขอลงทะเบียนเปิดมาพร้อมหน่วยงานที่เลือกไว้
  // อ่านครั้งเดียวตอนเปิดหน้า · ต้องเป็น useSearchParams ไม่ใช่ window.location — เปิดผ่าน <Link> แล้ว URL ยังเป็นหน้าเดิมตอน render แรก
  // (หน้าที่ใช้ตารางนี้ต้องครอบด้วย Suspense)
  const searchParams = useSearchParams();
  const [organizationIds, setOrganizationIds] = useState<string[]>(() =>
    (searchParams.get("organizationIds") ?? "").split(",").filter(Boolean),
  );
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [data, setData] = useState<LegalStatusPage | null>(null);
  const [counts, setCounts] = useState<{ pending: number; all: number } | null>(null);
  const [options, setOptions] = useState<Options | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  const [history, setHistory] = useState<LegalStatusRow | null>(null);
  const [requesting, setRequesting] = useState<LegalStatusRow | null>(null);

  useEffect(() => {
    api.get<Options>("/api/legal-status/options").then(setOptions).catch(() => undefined);
  }, []);

  useEffect(() => {
    api
      // นับตามหน่วยงานที่เปิดมาพร้อมกัน — หน่วยงานที่ไม่มีงานค้างต้องเปิดที่ "ทั้งหมด" ไม่ใช่แท็บว่าง
      .get<LegalStatusPage>(
        `/api/legal-status?tab=pending&pageSize=1${organizationIds.length ? `&organizationIds=${organizationIds.join(",")}` : ""}`,
      )
      .then((mine) => setTab((current) => current ?? (mine.total > 0 ? "mine" : "all")))
      .catch(() => setTab((current) => current ?? "all"));
    // ถามครั้งเดียวตอนเปิดหน้า — ค่าเริ่มต้นของตัวกรองเท่านั้น
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let alive = true;
    if (!tab) return;
    const filters = new URLSearchParams();
    if (documentId) filters.set("documentId", documentId);
    if (organizationIds.length) filters.set("organizationIds", organizationIds.join(","));
    if (status) filters.set("status", status);
    const query = (extra: Record<string, string>) => {
      const q = new URLSearchParams(filters);
      for (const [k, v] of Object.entries(extra)) q.set(k, v);
      return `/api/legal-status?${q.toString()}`;
    };
    setLoading(true);
    setError(null);
    Promise.all([
      api.get<LegalStatusPage>(
        query({ tab: tab === "mine" ? "pending" : "all", page: String(page), pageSize: String(pageSize) }),
      ),
      // จำนวนบนแท็บอีกฝั่ง — ขอแค่แถวเดียวเพื่อเอา total
      api.get<LegalStatusPage>(query({ tab: tab === "mine" ? "all" : "pending", pageSize: "1" })),
    ])
      .then(([current, other]) => {
        if (!alive) return;
        setData(current);
        setCounts(tab === "mine" ? { pending: current.total, all: other.total } : { pending: other.total, all: current.total });
      })
      .catch((err) => alive && setError(err instanceof Error ? err.message : "โหลดรายการไม่สำเร็จ"))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [tab, documentId, organizationIds, status, page, pageSize, round]);

  const resetPage = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPage(1);
  };


  const seesAll = data?.seesAll ?? false;
  /**
   * ตารางตัวเดียวกับหน้ารายการใน /console (`DataTable`) — คอลัมน์กว้างตามเนื้อหา หัวตารางกับแถวอยู่ใน `<table>` เดียวกันจึงตรงกันเสมอ
   * จอแคบเลื่อนตารางในกรอบของมันเอง ไม่ตกเป็นการ์ดซ้อน · เวอร์ชัน วันที่ สถานะ และปุ่มไม่ตัดบรรทัด ชื่อหน่วยงานและชื่อเอกสารได้ที่ที่เหลือ
   */
  const canActOn = (row: LegalStatusRow) =>
    (row.pending?.status === "PENDING_ORG_APPROVAL" && isOrgApprover && !seesAll) ||
    (row.pending?.status === "PENDING_BDI_APPROVAL" && isBdiApprover);
  /** แถวของหน่วยงานเดียวกันที่อยู่ติดกัน (backend เรียงตามหน่วยงานแล้ว) — เซลล์หน่วยงานผสานคลุมทั้งกลุ่ม แต่ละหน้าเริ่มกลุ่มใหม่ */
  const organizationSpan = (row: LegalStatusRow, index: number, rows: LegalStatusRow[]) => {
    if (index > 0 && rows[index - 1].organizationId === row.organizationId) return 0;
    let span = 1;
    while (rows[index + span]?.organizationId === row.organizationId) span++;
    return span;
  };
  const columns: Column<LegalStatusRow>[] = [
    // BDI เห็นหลายหน่วยงาน — คอลัมน์ของตัวเอง ผสานเซลล์ต่อหน่วยงาน (feedback 2026-11-22) · ฝั่งหน่วยงานเห็นแต่ของตัวเองจึงไม่มีคอลัมน์นี้
    ...(seesAll
      ? [
          {
            key: "organization",
            header: "หน่วยงาน",
            className: "min-w-[8rem] max-w-[14rem]",
            rowSpan: organizationSpan,
            cell: (row: LegalStatusRow) => (
              <span className="block text-[14px] font-semibold text-ink">{row.organizationName}</span>
            ),
          },
        ]
      : []),
    {
      key: "document",
      header: "เอกสาร",
      className: "min-w-[10rem]",
      cell: (row) => (
        <>
          <span className="block text-[15px] font-medium text-navy-800">{rowDocumentLabel(row)}</span>
          {row.documentShortname && row.documentShortname !== row.documentName ? (
            <span className="block text-[13px] text-ink-muted">{row.documentName}</span>
          ) : null}
        </>
      ),
    },
    { key: "version", header: "เวอร์ชัน", className: "whitespace-nowrap", cell: (row) => row.currentVersion ?? "—" },
    { key: "effective", header: "วันที่มีผล", className: "whitespace-nowrap", cell: (row) => thaiDate(row.effectiveAt) },
        // ป้ายยาวตกบรรทัดได้เฉพาะเมื่อการ์ดแคบ (/console ของผู้ดูแลระบบมีเมนูซ้าย) แทนการดันตารางให้เลื่อนข้าง — การ์ดกว้างคงบรรทัดเดียว
    { key: "status", header: "สถานะ", className: "min-w-[8.5rem]", cell: (row) => <Badge meta={rowMeta(row)} wrap /> },
    {
      key: "actions",
      header: "",
      className: "w-px whitespace-nowrap text-right",
      cell: (row) => {
        const canAct = canActOn(row);
        const canRequest = !row.pending && !row.currentVersion && !row.documentIsRequired && isOrgApprover && !seesAll;
        return (
          <span className="inline-flex gap-2">
            {/* ทุกแถวมีรายละเอียด (feedback 2026-11-22) — ไม่ใช่แค่แถวที่มีงานค้าง */}
            <Button
              size="sm"
              variant={canAct ? "primary" : "secondary"}
              onClick={() =>
                router.push(
                  row.pending
                    ? `${approvalBase}/${row.pending.approvalId}`
                    : documentHref(row.organizationId, row.documentId),
                )
              }
            >
              {canAct ? "อนุมัติ" : "ดูรายละเอียด"}
            </Button>
            {canRequest ? (
              <Button size="sm" variant="secondary" onClick={() => setRequesting(row)}>
                ขอเข้าร่วม
              </Button>
            ) : null}
            {row.currentVersion || row.pending ? (
              <Button size="sm" variant="secondary" onClick={() => setHistory(row)}>
                ประวัติ
              </Button>
            ) : null}
          </span>
        );
      },
    },
  ];

  // ยังไม่รู้ว่าจะเปิดแท็บไหน — โครงเดียวกับตอนโหลดรายการ
  if (!tab) {
    return (
      <Card className="overflow-hidden">
        <SkeletonRows />
      </Card>
    );
  }

  return (
    <>
      <QueueTabs
        tab={tab}
        onChange={(next) => {
          setTab(next);
          setPage(1);
        }}
        mine={counts?.pending ?? null}
        all={counts?.all ?? null}
      />

      <div className="mb-5 flex flex-wrap items-center gap-3 text-[13px] text-ink-muted">
        กรองตาม
        <Dropdown
          label="เอกสาร"
          value={documentId}
          onChange={resetPage(setDocumentId)}
          options={[
            { value: "", label: "เอกสารทุกฉบับ" },
            ...(options?.documents ?? []).map((d) => ({ value: d.id, label: d.shortname ?? d.nameTh })),
          ]}
        />
        {seesAll ? (
          <MultiSelectFilter
            label="หน่วยงาน"
            allLabel="ทุกหน่วยงาน"
            unit="หน่วยงาน"
            searchPlaceholder="พิมพ์ชื่อหน่วยงาน"
            value={organizationIds}
            onChange={resetPage((next: string[]) => {
              setOrganizationIds(next);
              // "ยังไม่ได้เข้าร่วม" มีเฉพาะเมื่อระบุหน่วยงาน — ล้างหน่วยงานแล้วตัวกรองนี้จะว่างเสมอ
              if (next.length === 0 && status === "NOT_JOINED") setStatus("");
            })}
            options={(options?.organizations ?? []).map((o) => ({ value: o.id, label: o.nameTh }))}
          />
        ) : null}
        <Dropdown
          label="สถานะ"
          value={status}
          onChange={resetPage(setStatus)}
          options={[
            { value: "", label: "ทุกสถานะ" },
            ...STATUS_FILTER_ORDER.map((key) => ({ value: key, label: APPROVAL_STATUS_META[key].label })),
            ...(!seesAll || organizationIds.length > 0 ? [{ value: "NOT_JOINED", label: NOT_JOINED_META.label }] : []),
          ]}
        />
      </div>

      <Card className="@container overflow-hidden">
        {error ? (
          <p className="m-6 rounded-xl bg-danger-bg p-5 text-sm text-danger">โหลดรายการไม่สำเร็จ — {error}</p>
        ) : (
          <DataTable
            columns={columns}
            rows={data?.rows ?? null}
            rowKey={(row) => `${row.organizationId}:${row.documentId}`}
            loading={loading}
            empty={
              <EmptyState title={tab === "mine" ? "ไม่มีเอกสารที่รอดำเนินการ" : "ไม่พบเอกสารที่ตรงกับตัวกรอง"}>
                {tab === "mine" ? null : "ลองล้างตัวกรอง"}
              </EmptyState>
            }
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
      </Card>

      <LegalHistoryDialog
        target={
          history
            ? {
                organizationId: history.organizationId,
                documentId: history.documentId,
                documentLabel: rowDocumentLabel(history),
                organizationName: history.organizationName,
              }
            : null
        }
        base={base}
        onClose={() => setHistory(null)}
      />

      <RequestJoinDialog
        target={requesting ? { organizationId: requesting.organizationId, documentId: requesting.documentId } : null}
        approvalBase={approvalBase}
        onClose={() => setRequesting(null)}
        onChanged={() => setRound((r) => r + 1)}
      />
    </>
  );
}
