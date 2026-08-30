"use client";

import clsx from "clsx";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

import { ListSearch } from "@/components/list/ListSearch";
import { JourneyFlow } from "@/components/list/JourneyFlow";
import { Pagination } from "@/components/list/Pagination";
import { RowDetailCard, useRowDetail } from "@/components/list/RowDetailCard";
import { QueueTabs } from "@/components/list/QueueTabs";
import { SortSelect } from "@/components/list/SortSelect";
import { StepDots } from "@/components/review/ApprovalSteps";
import { useSession } from "@/components/SessionProvider";
import { Card, DatasetStatusBadge } from "@/components/ui/Card";
import { SkeletonRows } from "@/components/ui/Spinner";
import { formatThaiDate } from "@/lib/status";
import { hasOwnQueue } from "@/lib/stage";
import { datasetTitle, type DatasetRequestListItem } from "@/lib/types";
import { useRequestList } from "@/lib/use-request-list";

/**
 * ตารางคำขอที่ใช้ร่วมกันทั้งฝั่งหน่วยงานและฝั่ง BDI
 * ต่างกันแค่ปลายทางของลิงก์และคอลัมน์ "หน่วยงาน" ที่ฝั่งหน่วยงานไม่ต้องเห็น
 *
 * สถานะทั้งหมด (แท็บ ตัวกรอง การเรียง หน้า คำค้น) อยู่ใน useRequestList ซึ่งตาราง
 * หน่วยงานใช้ตัวเดียวกัน เหลือไว้ที่นี่เฉพาะสิ่งที่ต่างกันจริง: คลาส grid ของคอลัมน์
 * (Tailwind สแกนแบบ static จึงต่อสตริงเองไม่ได้) กับ JSX ของแถว
 */
export function DatasetRequestTable({
  basePath,
  showOrganization,
  emptyHint,
  action,
}: {
  basePath: string;
  showOrganization: boolean;
  emptyHint: string;
  action?: ReactNode;
}) {
  const router = useRouter();
  const { user } = useSession();
  const { detail, setDetail } = useRowDetail();
  const list = useRequestList<DatasetRequestListItem>({
    endpoint: "/api/dataset-requests",
    itemsKey: "requests",
    hasQueue: hasOwnQueue(user?.roles ?? []),
  });

  // เขียนคลาสเต็มทั้งสองแบบไว้ตรง ๆ — Tailwind สแกนไฟล์แบบ static คลาสที่ต่อสตริงเองจะไม่ถูกสร้าง
  // คอลัมน์สถานะกว้างคงที่ ไม่ใช้ auto เพราะหัวตารางกับแถวเป็นคนละ grid
  // ถ้าใช้ auto ต่างฝ่ายต่างคิดความกว้างจากเนื้อหาตัวเอง คอลัมน์จะไม่ตรงกัน
  const columns = showOrganization
    ? "md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_16rem_8rem]"
    : "md:grid-cols-[minmax(0,2fr)_16rem_8rem]";

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
        {/* ค้นหา การเรียง และปุ่มของหน้า อยู่บรรทัดเดียวกัน — เม็ดกรองย้ายขึ้นไปเป็น
            แผนภาพแล้ว เหลือบรรทัดเปล่าที่มีตัวเรียงลอยอยู่ขวาสุดอ่านแล้วเหมือนของตกหล่น */}
        <ListSearch
          value={list.query}
          onChange={list.setQuery}
          placeholder="ค้นหาชื่อชุดข้อมูล เลขที่คำขอ หรือหน่วยงาน"
          action={
            <>
              <SortSelect value={list.sort} onChange={list.setSort} />
              {action}
            </>
          }
        />
      </div>

      <Card className="overflow-hidden">
        {list.loading ? (
          <SkeletonRows />
        ) : list.rows.length === 0 ? (
          <EmptyState hasFilter={list.hasFilter} onQueueTab={list.tab === "mine"} emptyHint={emptyHint} />
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
              <span className="text-right">วันที่นำส่ง</span>
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
                      <DatasetStatusBadge
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

function EmptyState({
  hasFilter,
  onQueueTab,
  emptyHint,
}: {
  hasFilter: boolean;
  onQueueTab: boolean;
  emptyHint: string;
}) {
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
        {hasFilter
          ? "ไม่พบรายการที่ตรงกับเงื่อนไข"
          : onQueueTab
            ? "ไม่มีคำขอที่รอคุณดำเนินการ"
            : "ยังไม่มีคำขอลงทะเบียนชุดข้อมูล"}
      </p>
      <p className="mt-1 text-sm text-ink-muted">
        {hasFilter
          ? "ลองล้างตัวกรองหรือเปลี่ยนคำค้นหา"
          : onQueueTab
            ? 'กดแท็บ "ทั้งหมด" เพื่อดูคำขอที่อยู่ในขั้นตอนของคนอื่น'
            : emptyHint}
      </p>
    </div>
  );
}
