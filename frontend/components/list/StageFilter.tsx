"use client";

import clsx from "clsx";

import { STAGE_META, type StageToken } from "@/lib/stage";

/**
 * เม็ดกรอง "ด่าน" — แทนเม็ดกรอง "สถานะ" ของเดิม
 *
 * รายชื่อด่านมาจาก `summary.stages` ที่ server ส่งมา ไม่ใช่ค่าคงที่ในไฟล์นี้ เพราะ
 * เส้นทางหน่วยงานไม่มีด่านผู้เชี่ยวชาญ ส่วนเส้นทางชุดข้อมูลมี — ให้ฝั่งที่รู้เป็นคนบอก
 */
export function StageFilter({
  available,
  counts,
  selected,
  onToggle,
  onClear,
}: {
  available: StageToken[];
  counts?: Partial<Record<StageToken, number>>;
  selected: StageToken[];
  onToggle: (token: StageToken) => void;
  onClear: () => void;
}) {
  if (available.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="กรองตามขั้นตอน">
      {available.map((token) => {
        const active = selected.includes(token);
        const count = counts?.[token];
        return (
          <button
            key={token}
            type="button"
            aria-pressed={active}
            onClick={() => onToggle(token)}
            className={clsx(
              "rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition-colors",
              active
                ? "border-navy-800 bg-navy-800 text-white"
                : "border-line bg-white text-ink-muted hover:border-navy-300 hover:text-navy-700",
            )}
          >
            {STAGE_META[token].short}
            {typeof count === "number" ? (
              <span className={clsx("ml-1.5 tabular-nums", active ? "opacity-80" : "text-ink-subtle")}>
                {count}
              </span>
            ) : null}
          </button>
        );
      })}
      {selected.length > 0 ? (
        <button
          type="button"
          onClick={onClear}
          className="rounded-full px-3 py-1.5 text-[13px] font-medium text-ink-muted underline-offset-2 hover:underline"
        >
          ล้างตัวกรอง
        </button>
      ) : null}
    </div>
  );
}
