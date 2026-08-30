"use client";

import clsx from "clsx";

import type { PageInfo } from "@/lib/stage";
import { PAGE_SIZES } from "@/lib/use-request-list";

/**
 * ตัวเลขหน้าแบบมีหน้าต่าง ไม่ใช่ 1..N
 *
 * คำขอที่อนุมัติแล้วสะสมไปเรื่อย ๆ ปุ่มเรียงครบทุกหน้าจึงล้นจอในไม่กี่เดือน
 * บรรทัด "แสดง …" ใช้ตัวเลขจาก server ไม่ใช่ rows.length — เดิมบรรทัดนั้นพูดว่า
 * "แสดง 200 รายการ" ทั้งที่ระบบมีมากกว่านั้น และไม่มีอะไรบอกว่าที่เหลือหายไปไหน
 */
export function Pagination({
  info,
  onPage,
  pageSize,
  onPageSize,
}: {
  info: PageInfo | null;
  onPage: (page: number) => void;
  pageSize: number;
  onPageSize: (size: number) => void;
}) {
  if (!info || info.total === 0) return null;

  const from = (info.page - 1) * info.pageSize + 1;
  const to = Math.min(info.page * info.pageSize, info.total);

  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <p className="text-[13px] text-ink-muted">
          แสดง <span className="tabular-nums">{from.toLocaleString("th-TH")}</span>–
          <span className="tabular-nums">{to.toLocaleString("th-TH")}</span> จาก{" "}
          <span className="tabular-nums">{info.total.toLocaleString("th-TH")}</span> รายการ
        </p>
        <label className="inline-flex items-center gap-2 text-[13px] text-ink-muted">
          แถวต่อหน้า
          <span className="relative">
            {/* ซ่อนลูกศรเนทีฟแล้ววาดเอง ตามธรรมเนียมของ <Select> ใน components/ui/Field.tsx —
                `<select>` เข้าเงื่อนไข `:read-only` เสมอตามสเปก HTML ปล่อยตามค่าเริ่มต้น
                จะถูกวาดจนอ่านได้ว่าเป็นช่องที่ถูกล็อก */}
            <select
              value={pageSize}
              onChange={(e) => onPageSize(Number(e.target.value))}
              aria-label="จำนวนแถวต่อหน้า"
              className="h-9 appearance-none rounded-full border border-line bg-white pl-3.5 pr-9 text-[13px] font-medium tabular-nums text-ink transition-[border-color,box-shadow] focus:border-navy-500 focus:shadow-[0_0_0_3px_var(--color-navy-100)]"
            >
              {PAGE_SIZES.map((n) => (
                <option key={n} value={n}>
                  {n}
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
      </div>

      {info.pageCount > 1 ? (
        <nav className="flex items-center gap-1" aria-label="เปลี่ยนหน้า">
          <Step label="หน้าก่อนหน้า" disabled={info.page <= 1} onClick={() => onPage(info.page - 1)}>
            ‹
          </Step>
          {windowed(info.page, info.pageCount).map((entry, i) =>
            entry === null ? (
              <span key={`gap-${i}`} className="px-1 text-[13px] text-ink-subtle" aria-hidden="true">
                …
              </span>
            ) : (
              <button
                key={entry}
                type="button"
                aria-current={entry === info.page ? "page" : undefined}
                onClick={() => onPage(entry)}
                className={clsx(
                  "h-9 min-w-9 rounded-full px-2.5 text-[13px] font-medium tabular-nums transition-colors",
                  entry === info.page
                    ? "bg-navy-800 text-white"
                    : "text-ink-muted hover:bg-navy-50 hover:text-navy-700",
                )}
              >
                {entry.toLocaleString("th-TH")}
              </button>
            ),
          )}
          <Step
            label="หน้าถัดไป"
            disabled={info.page >= info.pageCount}
            onClick={() => onPage(info.page + 1)}
          >
            ›
          </Step>
        </nav>
      ) : null}
    </div>
  );
}

function Step({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="h-9 w-9 rounded-full text-[15px] text-ink-muted transition-colors hover:bg-navy-50 hover:text-navy-700 disabled:pointer-events-none disabled:opacity-35"
    >
      {children}
    </button>
  );
}

/** [1, null, 4, 5, 6, null, 12] — null คือจุดไข่ปลา */
function windowed(page: number, count: number): (number | null)[] {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i + 1);

  const pages = new Set([1, count, page, page - 1, page + 1]);
  const sorted = [...pages].filter((p) => p >= 1 && p <= count).sort((a, b) => a - b);

  const out: (number | null)[] = [];
  let previous = 0;
  for (const p of sorted) {
    if (previous && p - previous > 1) out.push(null);
    out.push(p);
    previous = p;
  }
  return out;
}
