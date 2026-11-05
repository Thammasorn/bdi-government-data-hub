"use client";

import Link from "next/link";

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
  const { user } = useSession();
  const roles = user?.roles ?? [];
  const list = useRequestList<ChangeRow>({
    endpoint: "/api/representative-changes",
    itemsKey: "requests",
    hasQueue: roles.includes("ORGANIZATION_USER") || roles.includes("BDI_OFFICER"),
  });
  const showQueue = list.summary?.nodes.some((n) => n.mine) ?? false;
  const bdi = isBdiStaff(roles);
  const canEdit = roles.includes("ORGANIZATION_USER");
  const canReview = roles.includes("BDI_OFFICER");

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

      <Card className="overflow-x-auto">
        {list.loading ? (
          <SkeletonRows />
        ) : list.rows.length === 0 ? (
          <p className="px-6 py-16 text-center text-sm text-ink-muted">
            {list.hasFilter ? "ไม่พบรายการที่ตรงกับเงื่อนไข" : "ยังไม่มีคำขอ"}
          </p>
        ) : (
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
              {list.rows.map((row) => (
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
                      {canReview && (row.status === "SUBMITTED" || row.status === "UNDER_REVIEW") ? "review" : "view"}
                    </Link>
                    {canEdit && (row.status === "DRAFT" || row.status === "RETURNED") ? (
                      <Link className="ml-3 text-navy-700 underline" href={`/representatives/requests/${row.id}/edit`}>
                        edit
                      </Link>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
