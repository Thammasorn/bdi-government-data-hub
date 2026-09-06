"use client";

import clsx from "clsx";

import type { QueueTab } from "@/lib/use-request-list";

/**
 * "ที่ต้องดำเนินการ | ทั้งหมด" — **ตัวคุมทั้งหน้า** อยู่เหนือแผนภาพ
 *
 * แท็บซ้ายคือคำตอบของคำถาม "ใบไหนที่ตำแหน่งของฉันต้องทำต่อ" ซึ่งเดิมต้องไล่อ่าน
 * badge ทีละแถวเอาเอง คนที่ไม่มีด่านเป็นของตัวเองไม่เห็นแถบนี้เลย ไม่ใช่เห็นแท็บที่ว่าง
 *
 * เดิมแท็บอยู่ *ใต้* แผนภาพ ซึ่งอ่านเหมือนตัวกรองอีกชั้นที่ทำงานซ้ำกับการกดกล่อง
 * ตอนนี้มันคุมว่ากล่องไหนกดได้ — แท็บของตัวเองเหลือเฉพาะขั้นของผู้ใช้ที่กดได้
 */
export function QueueTabs({
  tab,
  onChange,
  mine,
  all,
}: {
  tab: QueueTab;
  onChange: (next: QueueTab) => void;
  mine: number | null;
  all: number | null;
}) {
  const items: { key: QueueTab; label: string; count: number | null }[] = [
    { key: "mine", label: "ที่ต้องดำเนินการ", count: mine },
    { key: "all", label: "ทั้งหมด", count: all },
  ];

  return (
    <div className="mb-5">
      <div className="flex gap-1 border-b border-line" role="tablist" aria-label="ขอบเขตของรายการ">
      {items.map((item) => {
        const active = tab === item.key;
        return (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(item.key)}
            className={clsx(
              "-mb-px border-b-2 px-4 py-2.5 text-[15px] font-medium transition-colors",
              active
                ? "border-coral-500 text-navy-800"
                : "border-transparent text-ink-muted hover:text-navy-700",
            )}
          >
            {item.label}
            {item.count !== null ? (
              <span
                className={clsx(
                  "ml-2 rounded-full px-2 py-0.5 text-[12px] tabular-nums",
                  active ? "bg-navy-100 text-navy-700" : "bg-navy-50 text-ink-muted",
                )}
              >
                {item.count}
              </span>
            ) : null}
          </button>
        );
      })}
      </div>
    </div>
  );
}