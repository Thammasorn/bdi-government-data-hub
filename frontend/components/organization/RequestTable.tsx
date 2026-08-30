"use client";

import { useRouter } from "next/navigation";

import { ListSearch } from "@/components/list/ListSearch";
import { JourneyFlow } from "@/components/list/JourneyFlow";
import { Pagination } from "@/components/list/Pagination";
import { RowDetailCard, useRowDetail } from "@/components/list/RowDetailCard";
import { QueueTabs } from "@/components/list/QueueTabs";
import { SortSelect } from "@/components/list/SortSelect";
import { StepDots } from "@/components/review/ApprovalSteps";
import { useSession } from "@/components/SessionProvider";
import { Card, StatusBadge } from "@/components/ui/Card";
import { SkeletonRows } from "@/components/ui/Spinner";
import { formatThaiDate } from "@/lib/status";
import { hasOwnQueue } from "@/lib/stage";
import type { OrganizationListItem } from "@/lib/types";
import { useRequestList } from "@/lib/use-request-list";

/**
 * ตารางคำขอสร้างหน่วยงาน — เดิมเขียนอยู่ในหน้า /admin/organizations ทั้งก้อน และเป็น
 * สำเนาของตารางชุดข้อมูลเกือบบรรทัดต่อบรรทัด ตอนนี้ทั้งสองแบ่ง useRequestList และ
 * ชิ้นส่วนใน components/list ร่วมกัน เหลือต่างกันเฉพาะคอลัมน์กับ JSX ของแถว
 */
export function OrganizationRequestTable({ basePath }: { basePath: string }) {
  const router = useRouter();
  const { user } = useSession();
  const { detail, setDetail } = useRowDetail();
  const list = useRequestList<OrganizationListItem>({
    endpoint: "/api/organizations",
    itemsKey: "organizations",
    hasQueue: hasOwnQueue(user?.roles ?? []),
  });

  const showQueue = list.summary?.nodes.some((n) => n.mine) ?? false;

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
          list.tab === "mine"
            ? (list.summary?.nodes.filter((n) => n.mine).map((n) => n.key) ?? [])
            : null
        }
      />

      <div className="mb-5 flex flex-col gap-4">
        {/* ค้นหากับการเรียงอยู่บรรทัดเดียวกัน — เม็ดกรองย้ายขึ้นไปเป็นแผนภาพแล้ว
            เหลือบรรทัดเปล่าที่มีตัวเรียงลอยอยู่ขวาสุดอ่านแล้วเหมือนของตกหล่น */}
        <ListSearch
          value={list.query}
          onChange={list.setQuery}
          placeholder="ค้นหาชื่อหน่วยงาน หรือผู้ยื่น"
          action={<SortSelect value={list.sort} onChange={list.setSort} />}
        />
      </div>

      <Card className="overflow-hidden">
        {list.loading ? (
          <SkeletonRows />
        ) : list.rows.length === 0 ? (
          <EmptyState hasFilter={list.hasFilter} onQueueTab={list.tab === "mine"} />
        ) : (
          <>
            {/* คอลัมน์สถานะต้องกว้างคงที่ ไม่ใช่ auto — หัวตารางกับแถวเป็นคนละ grid
                ถ้าใช้ auto ความกว้างจะคิดจากเนื้อหาของแต่ละอันแยกกัน แล้วคอลัมน์จะเหลื่อม */}
            <div className="hidden grid-cols-[minmax(0,1.7fr)_minmax(0,1.3fr)_16rem_8rem] gap-4 border-b border-line px-6 py-3 text-[12px] font-semibold uppercase tracking-wide text-ink-subtle md:grid">
              <span>ชื่อหน่วยงาน</span>
              <span>ผู้สร้าง</span>
              <span>สถานะ</span>
              <span className="text-right">วันที่ยื่น</span>
            </div>
            <ul className="divide-y divide-line">
              {list.rows.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => router.push(`${basePath}/${row.id}`)}
                    onFocus={(e) =>
                      setDetail({
                        rect: e.currentTarget.getBoundingClientRect(),
                        status: row.status,
                        currentTaskType: row.currentTaskType,
                        progress: row.progress,
                        submittedAt: row.submittedAt,
                        updatedAt: row.updatedAt,
                      })
                    }
                    onBlur={() => setDetail(null)}
                    className="grid w-full grid-cols-1 items-center gap-2 px-6 py-4 text-left transition-colors hover:bg-navy-50/60 md:grid-cols-[minmax(0,1.7fr)_minmax(0,1.3fr)_16rem_8rem] md:gap-4"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-ink">{row.name}</span>
                      {/* รหัสหน่วยงานคือสิ่งที่เอกสารและอีเมลใช้อ้างถึงหน่วยงานนี้ */}
                      {row.organizationCode ? (
                        <span className="block truncate text-[13px] text-ink-muted">
                          {row.organizationCode}
                        </span>
                      ) : null}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-ink">
                        {[row.createdBy.firstName, row.createdBy.lastName].filter(Boolean).join(" ") || "—"}
                      </span>
                      <span className="block truncate text-[13px] text-ink-muted">{row.createdBy.email}</span>
                    </span>
                    <span
                      className="flex min-w-0 flex-col items-start gap-1.5 justify-self-start"
                      onMouseEnter={(e) =>
                        setDetail({
                          rect: e.currentTarget.getBoundingClientRect(),
                          status: row.status,
                          currentTaskType: row.currentTaskType,
                          progress: row.progress,
                          submittedAt: row.submittedAt,
                          updatedAt: row.updatedAt,
                        })
                      }
                      onMouseLeave={() => setDetail(null)}
                    >
                      {/* ส่ง currentTaskType ไปด้วย ไม่งั้นแถวขึ้นแค่ "นำส่งแล้ว" ทั้งที่ข้อมูลด่านมาถึงแล้ว
                          ไม่ส่ง waitingLabel แล้ว — ชื่อเต็มอยู่ในกล่องที่ขึ้นตอนชี้เมาส์
                          ถ้าส่ง badge จะตั้ง title แล้ว tooltip ช้า ๆ ของเบราว์เซอร์จะขึ้นซ้อนกล่องนั้น */}
                      <StatusBadge
                        status={row.status}
                        currentTaskType={row.currentTaskType}
                        shortLabel={row.progress?.currentShortLabel}
                        className="max-w-full"
                      />
                      {row.progress?.currentOrder ? (
                        <span className="flex items-center gap-2">
                          <span className="text-[12px] text-ink-muted">
                            ขั้นที่ {row.progress.currentOrder} จาก {row.progress.totalSteps}
                          </span>
                          <StepDots
                            total={row.progress.totalSteps}
                            current={row.progress.currentOrder}
                          />
                        </span>
                      ) : null}
                      {/* กล่อง hover เป็น aria-hidden — ข้อความเต็มสำหรับ screen reader อยู่ตรงนี้ที่เดียว */}
                      <span className="sr-only">
                        {[row.progress?.currentLabel, row.progress?.nextLabel && `ขั้นต่อไป: ${row.progress.nextLabel}`]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
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

      <RowDetailCard detail={detail} />

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
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-navy-50">
        <svg viewBox="0 0 24 24" className="h-6 w-6 text-navy-400" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
          <path d="M4 20V7l8-4 8 4v13" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M2 20h20M10 11h4M10 15h4" strokeLinecap="round" />
        </svg>
      </div>
      <p className="mt-4 font-medium text-ink">
        {hasFilter
          ? "ไม่พบรายการที่ตรงกับเงื่อนไข"
          : onQueueTab
            ? "ไม่มีคำขอที่รอคุณดำเนินการ"
            : "ยังไม่มีคำขอสร้างหน่วยงาน"}
      </p>
      <p className="mt-1 text-sm text-ink-muted">
        {hasFilter
          ? "ลองล้างตัวกรองหรือเปลี่ยนคำค้นหา"
          : onQueueTab
            ? 'กดแท็บ "ทั้งหมด" เพื่อดูคำขอที่อยู่ในขั้นตอนของคนอื่น'
            : "เมื่อมีหน่วยงานยื่นคำขอเข้ามา รายการจะแสดงที่นี่"}
      </p>
    </div>
  );
}
