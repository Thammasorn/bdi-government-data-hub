"use client";

import type { ReactNode } from "react";

/** ช่องค้นหาของหน้ารายการ — เดิมเขียนซ้ำอยู่ในตารางหน่วยงานและตารางชุดข้อมูล */
export function ListSearch({
  value,
  onChange,
  placeholder,
  action,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative max-w-md flex-1">
        <svg
          viewBox="0 0 20 20"
          className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          aria-hidden="true"
        >
          <circle cx="9" cy="9" r="6" />
          <path d="m13.5 13.5 3 3" strokeLinecap="round" />
        </svg>
        <input
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          aria-label="ค้นหา"
          className="h-11 w-full rounded-full border border-line bg-white pl-10 pr-4 text-[15px] transition-[border-color,box-shadow] placeholder:text-ink-subtle focus:border-navy-500 focus:shadow-[0_0_0_3px_var(--color-navy-100)]"
        />
      </div>
      {action}
    </div>
  );
}
