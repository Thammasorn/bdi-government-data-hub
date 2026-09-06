"use client";

import { SORT_LABELS, type SortOrder } from "@/lib/stage";

/**
 * ทิศทางการเรียงตามวันที่
 *
 * ซ่อนลูกศรเนทีฟแล้ววาดเอง ตามธรรมเนียมเดียวกับ <Select> ใน components/ui/Field.tsx —
 * `<select>` เข้าเงื่อนไข `:read-only` เสมอตามสเปก HTML แม้จะเลือกค่าได้ตามปกติ
 * ปล่อยตามค่าเริ่มต้นของเบราว์เซอร์แล้วจะถูกวาดจนอ่านได้ว่าเป็นช่องที่ถูกล็อก
 */
export function SortSelect({
  value,
  onChange,
}: {
  value: SortOrder;
  onChange: (next: SortOrder) => void;
}) {
  return (
    <label className="inline-flex items-center gap-2 text-[13px] text-ink-muted">
      เรียงตามวันที่
      <span className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value as SortOrder)}
          aria-label="ทิศทางการเรียงตามวันที่"
          className="h-9 appearance-none rounded-full border border-line bg-white pl-3.5 pr-9 text-[13px] font-medium text-ink transition-[border-color,box-shadow] focus:border-navy-500 focus:shadow-[0_0_0_3px_var(--color-navy-100)]"
        >
          {(Object.keys(SORT_LABELS) as SortOrder[]).map((key) => (
            <option key={key} value={key}>
              {SORT_LABELS[key]}
            </option>
          ))}
        </select>
        <svg
          viewBox="0 0 20 20"
          className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          aria-hidden="true"
        >
          <path d="m5 8 5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </label>
  );
}
