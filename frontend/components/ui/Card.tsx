import clsx from "clsx";
import type { ReactNode } from "react";

import {
  DATASET_STATUS_META,
  STATUS_META,
  type DatasetRequestStatus,
  type OrganizationStatus,
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

export function StatusBadge({
  status,
  className,
}: {
  status: OrganizationStatus;
  className?: string;
}) {
  const meta = STATUS_META[status];
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

export function DatasetStatusBadge({
  status,
  className,
}: {
  status: DatasetRequestStatus;
  className?: string;
}) {
  const meta = DATASET_STATUS_META[status];
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
