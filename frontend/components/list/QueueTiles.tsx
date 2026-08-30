"use client";

import clsx from "clsx";

import { MY_STAGE_HEADLINE, STAGE_META, type ListSummary, type StageToken } from "@/lib/stage";

/**
 * แถบสรุปด้านบนสุด — การ์ดหนึ่งใบต่อหนึ่งด่านที่ตำแหน่งของผู้ใช้เป็นคนทำ
 *
 * กดแล้วกรองเหลือด่านนั้น: การ์ดกับเม็ดกรองเป็นสองหน้าตาของ state เดียวกัน
 * ไม่ใช่ตัวเลขที่อ่านได้อย่างเดียวแล้วต้องไปหาเม็ดกรองที่ตรงกันเอง
 */
export function QueueTiles({
  summary,
  selected,
  onPick,
}: {
  summary: ListSummary | null;
  selected: StageToken[];
  onPick: (token: StageToken) => void;
}) {
  if (!summary || summary.myStages.length === 0) return null;

  return (
    <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {summary.myStages.map((token) => {
        const count = summary.stages[token] ?? 0;
        const active = selected.includes(token);
        return (
          <button
            key={token}
            type="button"
            aria-pressed={active}
            onClick={() => onPick(token)}
            className={clsx(
              "rounded-2xl border px-5 py-4 text-left transition-colors",
              active
                ? "border-navy-800 bg-navy-50/70"
                : "border-line bg-white hover:border-navy-300 hover:bg-navy-50/40",
            )}
          >
            <span className="block text-[13px] font-medium text-ink-muted">
              {MY_STAGE_HEADLINE[token]}
            </span>
            <span className="mt-1 flex items-baseline gap-1.5">
              <span className="text-[26px] font-semibold tabular-nums text-navy-800">{count}</span>
              <span className="text-[13px] text-ink-muted">รายการ</span>
            </span>
            <span
              className={clsx(
                "mt-2 inline-flex rounded-full px-2.5 py-0.5 text-[12px] font-medium",
                STAGE_META[token].className,
              )}
            >
              {STAGE_META[token].short}
            </span>
          </button>
        );
      })}
    </div>
  );
}
