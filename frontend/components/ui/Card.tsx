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
 *
 * **คำเดียวกับหน้ารายละเอียดเสมอ** — เดิม badge ในตารางใช้ `shortLabel` ("รอ BDI ตรวจสอบ")
 * ส่วนหน้ารายละเอียดใช้คำของ `stageMeta` ("รอเจ้าหน้าที่ BDI ตรวจสอบ") คนที่กดจากตาราง
 * เข้าไปดูรายละเอียดจึงเห็นด่านเดียวกันถูกเรียกคนละชื่อในสองหน้าจอติดกัน
 *
 * ชื่อยาวกว่าเดิมจึงต้องยอมให้ตกบรรทัดได้ (เดิม `whitespace-nowrap` + ชื่อเต็ม เคยล้นไป
 * ทับคอลัมน์ความคืบหน้า) — สองบรรทัดในคอลัมน์แคบ ดีกว่าสองคำเรียกสำหรับสิ่งเดียวกัน
 *
 * `shortLabel` ยังอยู่ในข้อมูล แต่ใช้เฉพาะกล่องในแผนภาพเส้นทาง ซึ่งวาดเป็นกล่องเล็กจริง ๆ
 */
export function StatusBadge({
  status,
  currentTaskType,
  className,
}: {
  status: RequestStatus;
  currentTaskType?: ReviewTaskType | null;
  /** ไม่ได้ใช้แล้ว — คงพารามิเตอร์ไว้ให้แผนภาพเส้นทางที่ยังส่งมา ไม่ต้องแก้พร้อมกัน */
  shortLabel?: string | null;
  waitingLabel?: string | null;
  className?: string;
}) {
  const meta = stageMeta(status, currentTaskType);
  const label = meta.label;
  return (
    <span
      className={clsx(
        "inline-flex items-start gap-1.5 rounded-2xl px-3 py-1 text-[13px] font-medium leading-snug",
        meta.className,
        className,
      )}
    >
      <span
        className="mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-70"
        aria-hidden="true"
      />
      <span>{label}</span>
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
  /** ไม่ได้ใช้แล้ว — คงพารามิเตอร์ไว้ให้แผนภาพเส้นทางที่ยังส่งมา ไม่ต้องแก้พร้อมกัน */
  shortLabel?: string | null;
  waitingLabel?: string | null;
  className?: string;
}) {
  const meta = stageMeta(status, currentTaskType);
  const label = meta.label;
  return (
    <span
      className={clsx(
        "inline-flex items-start gap-1.5 rounded-2xl px-3 py-1 text-[13px] font-medium leading-snug",
        meta.className,
        className,
      )}
    >
      <span
        className="mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-70"
        aria-hidden="true"
      />
      <span>{label}</span>
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
