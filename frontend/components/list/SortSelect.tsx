"use client";

import { SORT_LABELS, type SortOrder } from "@/lib/stage";

/**
 * ทิศทางการเรียงตามวันที่
 *
 * สีข้อความและพื้นหลังเขียนไว้ตรง ๆ เพราะ <select> ที่ปล่อยตามค่าเริ่มต้นของเบราว์เซอร์
 * ถูกวาดเป็นสีเทาจาง อ่านได้ว่าเป็นช่องที่ถูกล็อก (เคยแก้มาแล้วในหน้าฟอร์ม)
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
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as SortOrder)}
        className="h-9 rounded-full border border-line bg-white px-3 pr-8 text-[13px] font-medium text-ink transition-[border-color,box-shadow] focus:border-navy-500 focus:shadow-[0_0_0_3px_var(--color-navy-100)]"
      >
        {(Object.keys(SORT_LABELS) as SortOrder[]).map((key) => (
          <option key={key} value={key}>
            {SORT_LABELS[key]}
          </option>
        ))}
      </select>
    </label>
  );
}
