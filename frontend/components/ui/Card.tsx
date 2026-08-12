import clsx from "clsx";
import type { ReactNode } from "react";

import {
  ORGANIZATION_STATUS_META,
  stageMeta,
  type OrganizationStatus,
  type RequestStatus,
  type ReviewTaskType,
} from "@/lib/status";

export function Card({
  id,
  className,
  children,
}: {
  id?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className={clsx("rounded-2xl bg-white shadow-card ring-1 ring-line", className)}>
      {children}
    </section>
  );
}

export function CardHeader({
  tag,
  title,
  description,
}: {
  tag?: string;
  title: string;
  description?: string;
}) {
  return (
    <header className="border-b border-line px-6 py-5">
      {tag ? (
        <span className="mb-1.5 inline-block text-[11px] font-semibold uppercase tracking-[0.08em] text-coral-500">
          {tag}
        </span>
      ) : null}
      <h2 className="text-lg font-semibold text-navy-800">{title}</h2>
      {description ? <p className="mt-1 text-sm text-ink-muted">{description}</p> : null}
    </header>
  );
}

/**
 * badge สถานะ — รับ currentTaskType มาด้วยได้
 *
 * สถานะคำขอเหลือเจ็ดค่าที่ไม่บอกว่า "รอใคร" แล้ว ด่านที่ค้างอยู่จึงมาจาก review_task
 * stageMeta() เลือกให้ว่าจะแสดงด่านหรือสถานะ
 */
export function StatusBadge({
  status,
  currentTaskType,
  className,
}: {
  status: RequestStatus;
  currentTaskType?: ReviewTaskType | null;
  className?: string;
}) {
  const meta = stageMeta(status, currentTaskType);
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1 text-[13px] font-medium",
        meta.className,
        className,
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" aria-hidden="true" />
      {meta.label}
    </span>
  );
}

/** สถานะคำขอชุดข้อมูลใช้ชุดค่าเดียวกับหน่วยงานแล้ว — คงชื่อไว้ให้หน้าเดิมเรียกได้ */
export function DatasetStatusBadge({
  status,
  currentTaskType,
  className,
}: {
  status: RequestStatus;
  currentTaskType?: ReviewTaskType | null;
  className?: string;
}) {
  const meta = stageMeta(status, currentTaskType);
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1 text-[13px] font-medium",
        meta.className,
        className,
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" aria-hidden="true" />
      {meta.label}
    </span>
  );
}

/** พื้นหลังลายจุดของ CI ใช้ตกแต่งมุมจอ ต้องจางพอที่จะไม่รบกวนการอ่าน */
export function DotDecoration({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={clsx("bg-dot-grid pointer-events-none absolute opacity-[0.09]", className)}
    />
  );
}

/**
 * สถานะของ "หน่วยงาน" ไม่ใช่ของคำขอ
 *
 * ตั้งแต่แยก organization ออกจาก organization_registration_request สองอย่างนี้เป็น
 * คนละชุดค่ากันจริง ๆ — หน่วยงานมี PENDING_REGISTRATION/ACTIVE/SUSPENDED/INACTIVE
 * ส่วนคำขอมีเจ็ดค่าของ workflow ใช้ badge ตัวเดียวกันไม่ได้
 */
export function OrganizationStatusBadge({
  status,
  className,
}: {
  status: OrganizationStatus;
  className?: string;
}) {
  const meta = ORGANIZATION_STATUS_META[status];
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1 text-[13px] font-medium",
        meta.className,
        className,
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" aria-hidden="true" />
      {meta.label}
    </span>
  );
}
