"use client";

import clsx from "clsx";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import { AdvisoryBadge, AdvisoryFilter } from "@/components/list/AdvisoryFilter";
import { ListSearch } from "@/components/list/ListSearch";
import { JourneyFlow } from "@/components/list/JourneyFlow";
import { Pagination } from "@/components/list/Pagination";
import { DateTimeCell } from "@/components/list/DateTimeCell";
import { RowDetailCard, useRowDetail } from "@/components/list/RowDetailCard";
import { QueueTabs } from "@/components/list/QueueTabs";
import { SortSelect } from "@/components/list/SortSelect";
import { StepDots } from "@/components/review/ApprovalSteps";
import { useSession } from "@/components/SessionProvider";
import { Button } from "@/components/ui/Button";
import { Card, DatasetStatusBadge } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { SkeletonRows } from "@/components/ui/Spinner";
import { useToast } from "@/components/ui/Toast";
import { ApiError, api } from "@/lib/api";
import { isBdiStaff } from "@/lib/status";
import { hasOwnQueue } from "@/lib/stage";
import { datasetTitle, fullName, type DatasetRequestListItem } from "@/lib/types";
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
  const { show } = useToast();
  const [pendingDelete, setPendingDelete] = useState<DatasetRequestListItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  /**
   * ปุ่มลบมีเฉพาะฝั่งหน่วยงาน และเฉพาะแถวที่ยังเป็นฉบับร่าง — เงื่อนไขเดียวกับที่
   * `DELETE /api/dataset-requests/:id` ใช้ (mayEdit + role + status DRAFT) ปุ่มที่กดแล้วไม่ผ่าน
   * แย่กว่าไม่มีปุ่ม เจ้าหน้าที่ BDI จึงไม่เห็นมันเลยแม้จะเห็นแถวนั้นอยู่ในรายการของตัวเอง
   *
   * ลบได้เฉพาะ **ผู้ประสานงานของหน่วยงาน** ไม่ใช่ทุกคนในหน่วยงานเหมือนสิทธิ์แก้ไข —
   * ผู้มีอำนาจอนุมัติเห็นแถวเดียวกันและแก้ไขร่างได้ แต่ฝั่ง server ตอบ 403 ให้เขา
   * ยังไม่แคบถึงเฉพาะคนที่กดสร้าง — แถวในรายการไม่ได้ส่ง id ของผู้สร้างมาด้วย
   * และฝั่ง server ก็ไม่ได้แคบกว่านี้
   */
  const canDelete =
    !isBdiStaff(user?.roles ?? []) && (user?.roles.includes("ORGANIZATION_USER") ?? false);

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await api.del(`/api/dataset-requests/${pendingDelete.id}`);
      show({
        tone: "success",
        title: "ลบคำขอแล้ว",
        detail: `${pendingDelete.requestNumber} ถูกลบออกจากรายการเรียบร้อย`,
      });
      setPendingDelete(null);
      list.reload();
    } catch (err) {
      show({
        tone: "error",
        title: "ลบคำขอไม่สำเร็จ",
        detail: err instanceof ApiError ? err.message : undefined,
      });
      // 404/409 แปลว่าแถวบนจอเก่าไปแล้ว (อีกแท็บกดนำส่งหรือลบไปก่อน) — โหลดรายการใหม่
      // ให้ตรงกับความจริง ไม่ปล่อยให้ผู้ใช้กดปุ่มเดิมซ้ำแล้วได้ข้อความเดิม
      if (err instanceof ApiError && (err.status === 404 || err.status === 409)) {
        setPendingDelete(null);
        list.reload();
      }
    } finally {
      setDeleting(false);
    }
  }

  // เขียนคลาสเต็มทั้งสองแบบไว้ตรง ๆ — Tailwind สแกนไฟล์แบบ static คลาสที่ต่อสตริงเองจะไม่ถูกสร้าง
  // คอลัมน์สถานะกว้างคงที่ ไม่ใช้ auto เพราะหัวตารางกับแถวเป็นคนละ grid
  // ถ้าใช้ auto ต่างฝ่ายต่างคิดความกว้างจากเนื้อหาตัวเอง คอลัมน์จะไม่ตรงกัน
  const columns = showOrganization
    ? "md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_16rem_8rem_8rem]"
    : "md:grid-cols-[minmax(0,2fr)_16rem_8rem_8rem]";

  const showQueue = list.summary?.nodes.some((n) => n.mine) ?? false;
  /**
   * ตัวกรองความเห็นเป็นเครื่องมือของฝั่ง BDI — ทั้งความเห็นและตัวผู้เชี่ยวชาญเป็นเรื่องภายใน
   * และ backend มองข้าม `?advisory=` ที่มาจากฝั่งหน่วยงานอยู่แล้ว ปุ่มที่กดแล้วไม่เกิดอะไร
   * แย่กว่าไม่มีปุ่ม
   */
  const showAdvisory = isBdiStaff(user?.roles ?? []);

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
              <SortSelect value={list.sort} onChange={list.setSort} submittedLabel="วันที่นำส่ง" />
              {action}
            </>
          }
        />

        {/* ใต้ช่องค้นหา เหนือตาราง — ลำดับการอ่านคือ ขั้นไหน → ความเห็นมาหรือยัง → แถว */}
        {showAdvisory ? (
          <AdvisoryFilter value={list.advisory} onChange={list.setAdvisory} />
        ) : null}
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
                // ช่องว่างขวาสุดที่ปุ่มลบไปนั่งทับ — หัวตารางกับแถวเป็นคนละ grid
                // ถ้าเว้นข้างเดียวคอลัมน์วันที่ของหัวกับของแถวจะเหลื่อมกันทั้งตาราง
                canDelete && "pr-24",
                columns,
              )}
            >
              <span>ชุดข้อมูล</span>
              {showOrganization ? <span>หน่วยงาน</span> : null}
              <span>สถานะ</span>
              <span className="text-right">วันที่นำส่ง</span>
              <span className="text-right">อัปเดตล่าสุด</span>
            </div>
            <ul className="divide-y divide-line">
              {list.rows.map((row) => (
                /* ปุ่มลบเป็น "พี่น้อง" ของปุ่มแถว ไม่ใช่ลูก — ทั้งแถวเป็น <button> อยู่แล้ว
                   ซ้อนปุ่มไว้ข้างในไม่ได้ (ดู RowDetailCard.tsx) จึงวางทับด้วย absolute
                   บนช่องว่างที่ pr-24 กันไว้ แทนที่จะรื้อแถวเป็นลิงก์คลุมทั้งกล่อง */
                <li key={row.id} className="relative">
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
                        specialistCommentAt: showAdvisory ? row.specialistCommentAt : null,
                      })
                    }
                    onBlur={() => setDetail(null)}
                    className={clsx(
                      "grid w-full grid-cols-1 items-center gap-2 px-6 py-4 text-left transition-colors hover:bg-navy-50/60 md:gap-4",
                      canDelete && "pr-24",
                      columns,
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-ink">{datasetTitle(row)}</span>
                      {/* ป้ายอยู่นอก truncate — ถ้าอยู่ในนั้น ชื่อผู้เชี่ยวชาญยาว ๆ จะกินมันหายไป */}
                      <span className="flex min-w-0 items-center gap-2 text-[13px] text-ink-muted">
                        <span className="truncate">
                          {row.requestNumber}
                          {row.assignedSpecialist
                            ? ` · ผู้เชี่ยวชาญ ${fullName(row.assignedSpecialist.prefix, row.assignedSpecialist.firstName, row.assignedSpecialist.lastName)}`
                            : ""}
                        </span>
                        {showAdvisory ? (
                          <AdvisoryBadge
                            commentedAt={row.specialistCommentAt}
                            assigned={Boolean(row.assignedSpecialist)}
                          />
                        ) : null}
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
                          specialistCommentAt: showAdvisory ? row.specialistCommentAt : null,
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
                    <DateTimeCell value={row.submittedAt} label="วันที่นำส่ง" />
                    <DateTimeCell value={row.updatedAt} label="อัปเดตล่าสุด" />
                  </button>
                  {canDelete && row.status === "DRAFT" ? (
                    /* บนจอแคบแถวเรียงลงเป็นชั้น ปุ่มจึงเกาะบรรทัดบนสุดแทนกึ่งกลางแถว */
                    <button
                      type="button"
                      onClick={() => setPendingDelete(row)}
                      aria-label={`ลบคำขอ ${datasetTitle(row)}`}
                      className="absolute right-5 top-4 z-10 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium text-ink-subtle transition-colors hover:bg-danger/10 hover:text-danger focus-visible:bg-danger/10 focus-visible:text-danger md:top-1/2 md:-translate-y-1/2"
                    >
                      <TrashIcon />
                      ลบ
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      <RowDetailCard detail={detail} />

      <Modal
        open={pendingDelete !== null}
        onClose={() => (deleting ? undefined : setPendingDelete(null))}
        title="ลบคำขอฉบับร่าง"
        description="คำขอและข้อมูลที่กรอกไว้จะถูกลบออกจากระบบ และกู้คืนไม่ได้"
      >
        <p className="text-[15px] leading-relaxed text-ink-muted">
          ต้องการลบ{" "}
          <span className="font-medium text-ink">
            {pendingDelete ? datasetTitle(pendingDelete) : ""}
          </span>
          {/* ร่างที่ยังไม่มีชื่อถูกเรียกว่า "คำขอ <เลขที่>" อยู่แล้ว วงเล็บเลขที่ต่อท้าย
              จึงกลายเป็นเลขเดิมสองครั้งในประโยคเดียว */}
          {pendingDelete?.title?.trim() ? ` (${pendingDelete.requestNumber})` : ""} ใช่หรือไม่
          <br />
          คำขอนี้ยังไม่ได้นำส่ง จึงยังไม่มีผู้ตรวจสอบท่านใดเห็นข้อมูลในคำขอ
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="secondary" disabled={deleting} onClick={() => setPendingDelete(null)}>
            ยกเลิก
          </Button>
          <Button variant="danger" loading={deleting} onClick={confirmDelete}>
            ยืนยันลบคำขอ
          </Button>
        </div>
      </Modal>

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

/**
 * ถังขยะเป็น SVG ไม่ใช่อักขระ — ฟอนต์ไทยดันเส้นฐานลงต่ำกว่าปุ่มเล็ก ๆ ทุกครั้ง
 * ตัวอักษรสัญลักษณ์ในปุ่มความสูงเท่านี้จึงลอยต่ำกว่าข้อความข้าง ๆ เสมอ
 */
function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true" fill="none">
      <path
        d="M4 7h16M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7m-9 0 .8 11.2A2 2 0 0 0 8.8 20h6.4a2 2 0 0 0 2-1.8L18 7M10 11v5m4-5v5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
