"use client";

import clsx from "clsx";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { DateTimeCell } from "@/components/list/DateTimeCell";
import { JourneyFlow } from "@/components/list/JourneyFlow";
import { ListSearch } from "@/components/list/ListSearch";
import { Pagination } from "@/components/list/Pagination";
import { QueueTabs } from "@/components/list/QueueTabs";
import { SortSelect } from "@/components/list/SortSelect";
import { ChangeStatusBadge } from "@/components/representatives/Shell";
import { useSession } from "@/components/SessionProvider";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { TextAreaField } from "@/components/ui/Field";
import { TrashIcon } from "@/components/ui/Icons";
import { Modal } from "@/components/ui/Modal";
import { SkeletonRows } from "@/components/ui/Spinner";
import { useToast } from "@/components/ui/Toast";
import { ApiError, api } from "@/lib/api";
import type { ChangeRow, ChangeStatus } from "@/lib/representatives";
import { isBdiStaff, isOrganizationFrozen } from "@/lib/status";
import { useRequestList } from "@/lib/use-request-list";

/**
 * สถานะที่ปุ่มยกเลิกขึ้น — ชุดเดียวกับที่ `POST /api/representative-changes/:id/cancel` รับ
 * (คำขอที่อยู่ในมือของหน่วยงาน) ใบที่นำส่งแล้วอยู่ที่ด่านของ BDI ปุ่มที่กดแล้วได้ 409 แย่กว่าไม่มีปุ่ม
 */
const CANCELLABLE: ChangeStatus[] = ["DRAFT", "RETURNED"];

/** ช่องขวาสุดที่ปุ่มยกเลิกวางทับ — ค่าเดียวกับตารางคำขอชุดข้อมูล ดูเหตุผลที่ RESERVE_CLOSE_BUTTON ใน dataset/RequestTable.tsx */
const RESERVE_CLOSE_BUTTON = "pr-36";

/** ตารางคำขอเปลี่ยนแปลงผู้แทน — ใช้ชิ้นส่วนใน components/list ชุดเดียวกับสองรายการคำขอเดิม */
export function ChangeRequestTable({ basePath = "/representatives/requests" }: { basePath?: string } = {}) {
  const router = useRouter();
  const { user } = useSession();
  const { show } = useToast();
  const roles = user?.roles ?? [];
  const list = useRequestList<ChangeRow>({
    endpoint: "/api/representative-changes",
    itemsKey: "requests",
    hasQueue: roles.includes("ORGANIZATION_USER") || roles.includes("BDI_OFFICER"),
  });
  const showQueue = list.summary?.nodes.some((n) => n.mine) ?? false;
  // ผู้ดูแลระบบเห็นทุกหน่วยงานเหมือน BDI จึงต้องมีชื่อหน่วยงานในแถวด้วย
  const bdi = isBdiStaff(roles) || roles.includes("SYSTEM_ADMINISTRATOR");
  /**
   * ยกเลิกได้เฉพาะผู้ประสานงานของหน่วยงาน — `canEdit()` ฝั่ง server ตรวจ role นี้กับหน่วยงานของคำขอ
   * และรายการฝั่งหน่วยงานมีแต่คำขอของหน่วยงานตัวเองอยู่แล้ว BDI กับผู้ดูแลระบบจึงไม่เห็นปุ่ม
   */
  const canCancel = !bdi && roles.includes("ORGANIZATION_USER");

  const [pending, setPending] = useState<ChangeRow | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const openCancel = (row: ChangeRow) => {
    setPending(row);
    setReason("");
    setReasonError(null);
  };

  /**
   * เหตุผลบังคับ ≥10 ตัวอักษรเหมือนปุ่มบนหน้ารายละเอียด เพราะ endpoint เดียวกันบังคับ และเหตุผลนี้ไปปิด
   * review_task กับบันทึกลง audit — ต่างจากตารางชุดข้อมูลที่ `DELETE` ไม่รับเหตุผล
   */
  async function confirmCancel() {
    if (!pending) return;
    if (reason.trim().length < 10) {
      setReasonError("กรุณาระบุเหตุผลอย่างน้อย 10 ตัวอักษร");
      return;
    }
    setCancelling(true);
    try {
      await api.post(`/api/representative-changes/${pending.id}/cancel`, { reason: reason.trim() });
      show({
        tone: "success",
        title: "ยกเลิกคำขอแล้ว",
        detail: `${pending.requestNumber} ถูกปิดไว้ในสถานะ “ยกเลิกแล้ว”`,
      });
      setPending(null);
      list.reload();
    } catch (err) {
      show({ tone: "error", title: "ยกเลิกคำขอไม่สำเร็จ", detail: err instanceof ApiError ? err.message : undefined });
      // 404/409 แปลว่าแถวบนจอเก่าไปแล้ว (อีกแท็บนำส่งหรือยกเลิกไปก่อน) — โหลดรายการใหม่ให้ตรงกับความจริง
      if (err instanceof ApiError && (err.status === 404 || err.status === 409)) {
        setPending(null);
        list.reload();
      }
    } finally {
      setCancelling(false);
    }
  }

  /**
   * เลขที่คำขอต้องอ่านได้เต็ม — เป็นสิ่งเดียวที่ใช้บอกว่ากำลังจะยกเลิกใบไหน เดิมสถานะกว้าง 13rem และเลขที่ได้ 1.4fr
   * พอกันช่องให้ปุ่มยกเลิก (pr-36) เลขที่เหลือ ~100px และถูกตัดเป็น "ORG-REP-2…" ทุกแถว ป้ายสถานะที่ยาวที่สุด
   * ("ดำเนินการไม่สำเร็จ") พอดี 10rem และป้ายตัดบรรทัดได้อยู่แล้ว ชื่อเอกสารยอมถูกตัดแทน
   */
  const columns = "md:grid-cols-[minmax(9.5rem,1.4fr)_minmax(0,1fr)_10rem_7rem_7rem]";

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
            <div
              className={clsx(
                "hidden gap-4 border-b border-line px-6 py-3 text-[12px] font-semibold uppercase tracking-wide text-ink-subtle md:grid",
                // หัวตารางกับแถวเป็นคนละ grid — เว้นช่องปุ่มทั้งสองฝั่ง ไม่งั้นคอลัมน์วันที่เหลื่อมกัน
                canCancel && RESERVE_CLOSE_BUTTON,
                columns,
              )}
            >
              <span>เลขที่คำขอ</span>
              <span>ชื่อเอกสาร</span>
              <span>สถานะ</span>
              <span className="text-right">วันที่นำส่ง</span>
              <span className="text-right">อัปเดตล่าสุด</span>
            </div>
            <ul className="divide-y divide-line">
              {list.rows.map((row) => (
                /* ปุ่มยกเลิกเป็นพี่น้องของปุ่มแถว ไม่ใช่ลูก — ซ้อน <button> ไม่ได้ จึงวางทับด้วย absolute
                   แบบเดียวกับตารางคำขอชุดข้อมูล */
                <li key={row.id} className="relative">
                  <button
                    type="button"
                    onClick={() => router.push(`${basePath}/${row.id}`)}
                    className={clsx(
                      "grid w-full grid-cols-1 items-center gap-2 px-6 py-4 text-left transition-colors hover:bg-navy-50/60 md:gap-4",
                      canCancel && RESERVE_CLOSE_BUTTON,
                      columns,
                    )}
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
                  {/* หน่วยงานถูกระงับหรือยุติ — ยกเลิกเองไม่ได้ (409) แถวยังแสดงอยู่ตามเดิม */}
                  {canCancel && CANCELLABLE.includes(row.status) && !isOrganizationFrozen(row.organization.status) ? (
                    /* บนจอแคบแถวเรียงลงเป็นชั้น ปุ่มจึงเกาะบรรทัดบนสุดแทนกึ่งกลางแถว */
                    <button
                      type="button"
                      onClick={() => openCancel(row)}
                      aria-label={`ยกเลิกคำขอ ${row.requestNumber}`}
                      className="absolute right-5 top-4 z-10 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium text-ink-subtle transition-colors hover:bg-danger/10 hover:text-danger focus-visible:bg-danger/10 focus-visible:text-danger md:top-1/2 md:-translate-y-1/2"
                    >
                      <TrashIcon />
                      ยกเลิก
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      <Modal
        open={pending !== null}
        onClose={() => (cancelling ? undefined : setPending(null))}
        title="ยกเลิกคำขอ"
        description="คำขอจะไม่ถูกลบ แต่จะถูกปิดไว้ในสถานะ “ยกเลิกแล้ว” และแก้ไขหรือนำส่งต่อไม่ได้อีก"
      >
        <p className="text-[15px] leading-relaxed text-ink-muted">
          ต้องการยกเลิกคำขอ <span className="font-medium text-ink">{pending?.requestNumber}</span> ใช่หรือไม่
          <br />
          คำขอและข้อมูลที่กรอกไว้ยังอยู่ในระบบให้ย้อนดูได้ — ค้นหาได้จากตัวกรอง “ยกเลิกแล้ว”
        </p>
        <TextAreaField
          className="mt-5"
          label="เหตุผล"
          required
          value={reason}
          error={reasonError ?? undefined}
          onChange={(e) => {
            setReason(e.target.value);
            setReasonError(null);
          }}
        />
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="secondary" disabled={cancelling} onClick={() => setPending(null)}>
            ปิด
          </Button>
          <Button variant="danger" loading={cancelling} onClick={confirmCancel}>
            ยืนยันยกเลิกคำขอ
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
