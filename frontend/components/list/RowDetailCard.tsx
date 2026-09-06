"use client";

import clsx from "clsx";
import { useEffect, useState } from "react";

import { StepDots } from "@/components/review/ApprovalSteps";
import { daysSince, formatThaiDate, stageMeta } from "@/lib/status";
import type { RequestStatus, ReviewTaskType } from "@/lib/status";
import type { JourneyProgressSummary } from "@/lib/types";

/** สิ่งที่กล่องต้องรู้ — เก็บตอนเปิด ไม่ตามเป้าหลังจากนั้น */
export interface RowDetail {
  /** กรอบของสิ่งที่ชี้อยู่ ใช้วางกล่อง */
  rect: DOMRect;
  status: RequestStatus;
  currentTaskType: ReviewTaskType | null;
  progress: JourneyProgressSummary | null;
  submittedAt: string | null;
  updatedAt: string | null;
}

/** ข้อความอธิบายช่วงที่คำขออยู่ — ชุดเดียวกับที่ ApprovalStepsCompact ใช้ */
const PHASE_NOTE: Record<string, string | null> = {
  DRAFT: "ยังไม่ได้นำส่ง — อยู่ระหว่างการกรอกข้อมูลของหน่วยงาน",
  IN_PROGRESS: null,
  WAITING_REVISION: "ยังไม่ได้นำส่ง — อยู่ระหว่างการแก้ไขตามที่ผู้ตรวจส่งกลับ",
  APPROVED: "ผ่านครบทุกขั้นตอนแล้ว",
  REJECTED: "คำขอนี้ไม่ได้รับอนุมัติ — กระบวนการปิดแล้ว",
  CANCELLED: "คำขอนี้ถูกยกเลิก",
};

const CARD_WIDTH = 288; // w-72
const GAP = 8;

/**
 * กล่องรายละเอียดของแถว — ขึ้นเมื่อชี้เมาส์ที่ช่องสถานะ หรือโฟกัสแถวด้วยคีย์บอร์ด
 *
 * ## ทำไมไม่ใช้ `title` ของเบราว์เซอร์
 *
 * มันหน่วงราวหนึ่งวินาทีก่อนแสดงและตั้งค่าไม่ได้ ต้องจ่อเมาส์ค้างถึงจะเห็น ซึ่งอ่านเหมือน
 * ไม่มีอะไรให้ดู และมันเป็นข้อความเปล่า ใส่จุดบอกขั้นหรือวันที่ไม่ได้
 *
 * ## ทำไม `fixed` และทำไมอยู่นอก <Card>
 *
 * ตารางครอบด้วย `<Card className="overflow-hidden">` ซึ่งตัดลูกที่วางแบบ `absolute` ทิ้ง
 * ส่วน `fixed` ยึดกับ viewport จึงไม่ถูกตัด — **ตราบใดที่ไม่มี ancestor ไหนมี
 * `transform` / `filter` / `backdrop-filter` / `will-change` / `contain`** ซึ่งจะทำให้
 * มันกลายเป็น containing block แทน วันนี้ไล่ตั้งแต่ `body` ถึงแถวแล้วไม่มีเลย
 * (`frost-12` อยู่บน `<header>` ซึ่งเป็นพี่น้องของ `<main>` ไม่ใช่บรรพบุรุษของแถว)
 * ถ้าวันหลังใครใส่ animation ให้ `<main>` หรือ `<Card>` กล่องนี้จะเพี้ยนแบบเงียบ ๆ
 *
 * และเรนเดอร์ไว้ **นอก** `<Card>` เพราะแถวเป็น `<button>` ทั้งแถว จะฝัง `<div>` หรือ
 * อะไรที่โฟกัสได้ไว้ข้างในไม่ได้
 */
export function RowDetailCard({ detail }: { detail: RowDetail | null }) {
  const [viewport, setViewport] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const measure = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  if (!detail || viewport.w === 0) return null;

  const { rect, progress } = detail;
  const meta = stageMeta(detail.status, detail.currentTaskType);
  const title = (detail.currentTaskType ? progress?.currentLabel : null) ?? meta.label;
  const note = progress ? PHASE_NOTE[progress.phase] : null;
  /**
   * "รอมาแล้ว" คือเวลาที่คำขอค้างอยู่ที่ด่านของผู้ตรวจ — นับเฉพาะตอนที่มันค้างอยู่จริง
   *
   * ใบที่ถูกส่งกลับมีเลขขั้นแล้ว (ขั้นที่ 1 รอหน่วยงานนำส่งใหม่) แต่ไม่มีใครฝั่งผู้ตรวจ
   * ถืออยู่ ถ้านับต่อไปกล่องจะบอกว่า "รอมาแล้ว 12 วัน" ทั้งที่คนที่ต้องขยับคือหน่วยงานเอง
   */
  const waited =
    detail.submittedAt && progress?.phase === "IN_PROGRESS"
      ? daysSince(detail.submittedAt)
      : null;

  // หนีบไม่ให้ล้นจอ และพลิกขึ้นด้านบนเมื่อแถวอยู่ใกล้ขอบล่าง
  const left = Math.min(Math.max(GAP, rect.left), viewport.w - CARD_WIDTH - GAP);
  const below = rect.bottom + GAP;
  const flip = below + 190 > viewport.h;

  return (
    <div
      role="tooltip"
      aria-hidden="true"
      className="animate-in-up fixed z-40 w-72 rounded-xl bg-white p-4 shadow-pop ring-1 ring-line"
      style={flip ? { left, bottom: viewport.h - rect.top + GAP } : { left, top: below }}
    >
      <p className="text-[14px] font-semibold leading-snug text-navy-800">{title}</p>

      {progress?.currentOrder ? (
        <div className="mt-2 flex items-center gap-2">
          <span className="text-[13px] font-medium text-ink">
            ขั้นที่ {progress.currentOrder} จาก {progress.totalSteps}
          </span>
          <StepDots total={progress.totalSteps} current={progress.currentOrder} size="md" />
        </div>
      ) : null}

      {progress?.nextLabel ? (
        <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">
          ขั้นต่อไป: {progress.nextLabel}
        </p>
      ) : null}

      {note ? <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">{note}</p> : null}

      <dl className="mt-3 space-y-1 border-t border-line pt-3 text-[12px] text-ink-subtle">
        {detail.updatedAt ? (
          <div className="flex justify-between gap-3">
            <dt>อัปเดตล่าสุด</dt>
            <dd className="text-right text-ink-muted">{formatThaiDate(detail.updatedAt)}</dd>
          </div>
        ) : null}
        {waited !== null ? (
          <div className="flex justify-between gap-3">
            <dt>รอมาแล้ว</dt>
            <dd className={clsx("text-right", waited >= 7 ? "text-warning" : "text-ink-muted")}>
              {waited.toLocaleString("th-TH")} วัน
            </dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}

/**
 * state ของกล่อง — หนึ่งตัวต่อหนึ่งตาราง ไม่ใช่ต่อแถว
 *
 * hook เรียกใน `map` ไม่ได้ และเปิดพร้อมกันสองใบก็ไม่ควรเกิดอยู่แล้ว ตัวที่เปิดค้างไว้
 * ต้องปิดเมื่อหน้าเลื่อนหรือจอเปลี่ยนขนาด เพราะ `rect` ที่เก็บไว้จะชี้ผิดที่ทันที
 */
export function useRowDetail() {
  const [detail, setDetail] = useState<RowDetail | null>(null);

  useEffect(() => {
    if (!detail) return;
    const close = () => setDetail(null);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [detail]);

  return { detail, setDetail };
}
