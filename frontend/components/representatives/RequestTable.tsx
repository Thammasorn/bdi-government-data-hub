"use client";

import { useRouter } from "next/navigation";

import { DateTimeCell } from "@/components/list/DateTimeCell";
import { JourneyFlow } from "@/components/list/JourneyFlow";
import { ListSearch } from "@/components/list/ListSearch";
import { Pagination } from "@/components/list/Pagination";
import { QueueTabs } from "@/components/list/QueueTabs";
import { SortSelect } from "@/components/list/SortSelect";
import { ChangeStatusBadge } from "@/components/representatives/Shell";
import { useSession } from "@/components/SessionProvider";
import { Card } from "@/components/ui/Card";
import { SkeletonRows } from "@/components/ui/Spinner";
import type { ChangeRow } from "@/lib/representatives";
import { isBdiStaff } from "@/lib/status";
import { useRequestList } from "@/lib/use-request-list";

/** ตารางคำขอเปลี่ยนแปลงผู้แทน — ใช้ชิ้นส่วนใน components/list ชุดเดียวกับสองรายการคำขอเดิม */
export function ChangeRequestTable() {
  const router = useRouter();
  const { user } = useSession();
  const roles = user?.roles ?? [];
  const list = useRequestList<ChangeRow>({
    endpoint: "/api/representative-changes",
    itemsKey: "requests",
    hasQueue: roles.includes("ORGANIZATION_USER") || roles.includes("BDI_OFFICER"),
  });
  const showQueue = list.summary?.nodes.some((n) => n.mine) ?? false;
  const bdi = isBdiStaff(roles);

  return (
    <>
      {showQueue ? (
        <QueueTabs
          tab={list.tab}
          onChange={list.setTab}
          mine={list.summary?.mine ?? null}
          all={list.summary?.total ?? null}
        />
      ) : null}

      <JourneyFlow
        summary={list.summary}
        selected={list.stage}
        onSelect={list.selectStage}
        loading={list.loading}
        highlightMine={list.tab === "mine" && list.stage === null}
        lockedTo={
          list.tab === "mine" ? (list.summary?.nodes.filter((n) => n.mine).map((n) => n.key) ?? []) : null
        }
      />

      <div className="mb-5 flex flex-col gap-4">
        <ListSearch
          value={list.query}
          onChange={list.setQuery}
          placeholder={bdi ? "ค้นหาเลขที่คำขอ หรือชื่อหน่วยงาน" : "ค้นหาเลขที่คำขอ"}
          action={<SortSelect value={list.sort} onChange={list.setSort} submittedLabel="วันที่นำส่ง" />}
        />
      </div>

      <Card className="overflow-hidden">
        {list.loading ? (
          <SkeletonRows />
        ) : list.rows.length === 0 ? (
          <EmptyState hasFilter={list.hasFilter} onQueueTab={list.tab === "mine"} />
        ) : (
          <>
            <div className="hidden grid-cols-[minmax(0,1.4fr)_minmax(0,1.1fr)_13rem_7rem_7rem] gap-4 border-b border-line px-6 py-3 text-[12px] font-semibold uppercase tracking-wide text-ink-subtle md:grid">
              <span>เลขที่คำขอ</span>
              <span>ชื่อเอกสาร</span>
              <span>สถานะ</span>
              <span className="text-right">วันที่นำส่ง</span>
              <span className="text-right">อัปเดตล่าสุด</span>
            </div>
            <ul className="divide-y divide-line">
              {list.rows.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => router.push(`/representatives/requests/${row.id}`)}
                    className="grid w-full grid-cols-1 items-center gap-2 px-6 py-4 text-left transition-colors hover:bg-navy-50/60 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1.1fr)_13rem_7rem_7rem] md:gap-4"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-ink">{row.requestNumber}</span>
                      {bdi ? (
                        <span className="block truncate text-[13px] text-ink-muted">{row.organization.nameTh}</span>
                      ) : null}
                    </span>
                    <span className="block min-w-0 truncate text-sm text-ink-muted">{row.documentName ?? "—"}</span>
                    <span className="min-w-0 justify-self-start">
                      <ChangeStatusBadge status={row.status} />
                    </span>
                    <DateTimeCell value={row.submittedAt} label="วันที่นำส่ง" />
                    <DateTimeCell value={row.updatedAt} label="อัปเดตล่าสุด" />
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      <Pagination
        info={list.pageInfo}
        onPage={list.goToPage}
        pageSize={list.pageSize}
        onPageSize={list.setPageSize}
      />
    </>
  );
}

function EmptyState({ hasFilter, onQueueTab }: { hasFilter: boolean; onQueueTab: boolean }) {
  return (
    <div className="px-6 py-20 text-center">
      <p className="font-medium text-ink">
        {hasFilter
          ? "ไม่พบรายการที่ตรงกับเงื่อนไข"
          : onQueueTab
            ? "ไม่มีคำขอที่รอคุณดำเนินการ"
            : "ยังไม่มีคำขอเปลี่ยนแปลงผู้แทน"}
      </p>
      <p className="mt-1 text-sm text-ink-muted">
        {hasFilter
          ? "ลองล้างตัวกรองหรือเปลี่ยนคำค้นหา"
          : onQueueTab
            ? 'กดแท็บ "ทั้งหมด" เพื่อดูคำขอที่อยู่ในขั้นตอนอื่น'
            : "เมื่อมีคำขอเข้ามา รายการจะแสดงที่นี่"}
      </p>
    </div>
  );
}
