"use client";

import {
  SORT_DIRECTION_LABELS,
  SORT_UPDATED_LABEL,
  sortDirection,
  sortField,
  sortToken,
  type SortDirection,
  type SortField,
  type SortOrder,
} from "@/lib/stage";

/**
 * เรียงตามวันที่ไหน และเรียงทางไหน
 *
 * **สองกล่อง ไม่ใช่กล่องเดียวสี่ตัวเลือก** — สองอย่างนี้เลือกกันคนละเรื่อง และการยุบเป็น
 * กล่องเดียวจะได้รายการอย่าง "วันที่นำส่ง: ใหม่ → เก่า" สี่บรรทัด ซึ่งผู้อ่านต้องไล่หา
 * ครึ่งที่ตัวเองอยากเปลี่ยนในทุกบรรทัด และจำนวนบรรทัดจะคูณสองทุกครั้งที่มีวันที่ให้เรียงเพิ่ม
 *
 * ค่าที่ส่งออกยังเป็นโทเคนเดียว (`date_desc` …) เพราะมันเดินทางเป็น `?sort=` ตัวเดียว
 * ทั้งใน URL ของหน้าและใน query ที่ยิงไป API — การแตกเป็นสอง state จะทำให้มีสองที่ที่
 * ต้องซิงก์กับ URL แทนที่จะเป็นที่เดียว
 *
 * ซ่อนลูกศรเนทีฟแล้ววาดเอง ตามธรรมเนียมเดียวกับ <Select> ใน components/ui/Field.tsx —
 * `<select>` เข้าเงื่อนไข `:read-only` เสมอตามสเปก HTML แม้จะเลือกค่าได้ตามปกติ
 * ปล่อยตามค่าเริ่มต้นของเบราว์เซอร์แล้วจะถูกวาดจนอ่านได้ว่าเป็นช่องที่ถูกล็อก
 */
export function SortSelect({
  value,
  onChange,
  submittedLabel,
}: {
  value: SortOrder;
  onChange: (next: SortOrder) => void;
  /** ชื่อวันที่นำส่งบนหน้านี้ — ต้องตรงกับหัวคอลัมน์ของตารางที่อยู่ใต้มัน */
  submittedLabel: string;
}) {
  const field = sortField(value);
  const direction = sortDirection(value);

  return (
    <span className="inline-flex items-center gap-2 text-[13px] text-ink-muted">
      เรียงตาม
      <Dropdown
        label="เรียงตามวันที่ใด"
        value={field}
        onChange={(next) => onChange(sortToken(next as SortField, direction))}
        options={[
          { value: "date", label: submittedLabel },
          { value: "updated", label: SORT_UPDATED_LABEL },
        ]}
      />
      <Dropdown
        label="ทิศทางการเรียงตามวันที่"
        value={direction}
        onChange={(next) => onChange(sortToken(field, next as SortDirection))}
        options={(Object.keys(SORT_DIRECTION_LABELS) as SortDirection[]).map((key) => ({
          value: key,
          label: SORT_DIRECTION_LABELS[key],
        }))}
      />
    </span>
  );
}

function Dropdown({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <span className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className="h-9 appearance-none rounded-full border border-line bg-white pl-3.5 pr-9 text-[13px] font-medium text-ink transition-[border-color,box-shadow] focus:border-navy-500 focus:shadow-[0_0_0_3px_var(--color-navy-100)]"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
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
  );
}
