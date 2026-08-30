"use client";

import clsx from "clsx";

import type { PageInfo } from "@/lib/stage";

/**
 * ตัวเลขหน้าแบบมีหน้าต่าง ไม่ใช่ 1..N
 *
 * คำขอที่อนุมัติแล้วสะสมไปเรื่อย ๆ ปุ่มเรียงครบทุกหน้าจึงล้นจอในไม่กี่เดือน
 * บรรทัด "แสดง …" ใช้ตัวเลขจาก server ไม่ใช่ rows.length — เดิมบรรทัดนั้นพูดว่า
 * "แสดง 200 รายการ" ทั้งที่ระบบมีมากกว่านั้น และไม่มีอะไรบอกว่าที่เหลือหายไปไหน
 */
export function Pagination({ info, onPage }: { info: PageInfo | null; onPage: (page: number) => void }) {
  if (!info || info.total === 0) return null;

  const from = (info.page - 1) * info.pageSize + 1;
  const to = Math.min(info.page * info.pageSize, info.total);

  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <p className="text-[13px] text-ink-muted">
        แสดง <span className="tabular-nums">{from.toLocaleString("th-TH")}</span>–
        <span className="tabular-nums">{to.toLocaleString("th-TH")}</span> จาก{" "}
        <span className="tabular-nums">{info.total.toLocaleString("th-TH")}</span> รายการ
      </p>

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
