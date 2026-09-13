"use client";

import clsx from "clsx";

import type { AdvisoryFilterValue } from "@/lib/use-request-list";

/**
 * ตัวกรอง "ความเห็นของผู้เชี่ยวชาญ" — มิติที่สองของหน้ารายการคำขอชุดข้อมูล
 *
 * **ไม่ใช่โหนดของเส้นทาง** การขอความเห็นไม่ใช่ด่านและไม่ย้ายคำขอไปไหน (ตัดสินไว้ 2026-08-30)
 * มันจึงไม่มีกล่องบนแผนภาพ และอยู่ที่นี่ในฐานะตัวกรองที่ AND กับแผนภาพและแท็บ — เลือกพร้อมกัน
 * ได้ และแต่ละอันยังหมายความตามเดิม
 *
 * เป็น `radiogroup` ที่มีสมาชิก "ทั้งหมด" ติ๊กอยู่เมื่อไม่ได้กรองอะไร ด้วยเหตุผลเดียวกับ
 * `JourneyFlow`: radiogroup ที่ไม่มีอะไรถูกติ๊กคือทางตันของ screen reader
 *
 * **ไม่มีตัวเลขบนชิปโดยตั้งใจ** — `/summary` ตั้งใจไม่ขยับตามแท็บและโหนด (ดูหัวไฟล์
 * lib/queue.ts) ถ้าเอาตัวเลขจากขอบเขตนั้นมาแปะบนตัวกรองที่ AND กับทั้งสองอย่าง ผู้อ่านจะเห็น
 * เลขที่บวกไม่ลงกับจำนวนแถวที่อยู่ตรงหน้า จำนวนผลลัพธ์จริงอยู่ที่บรรทัดท้ายตารางแล้ว
 */
const OPTIONS: { value: AdvisoryFilterValue | null; label: string; dot: string | null }[] = [
  { value: null, label: "ทั้งหมด", dot: null },
  { value: "with", label: "มีความเห็นแล้ว", dot: "bg-navy-500" },
  { value: "awaiting", label: "รอความเห็น", dot: "border border-navy-300" },
  { value: "none", label: "ยังไม่ได้ขอความเห็น", dot: null },
];

export function AdvisoryFilter({
  value,
  onChange,
}: {
  value: AdvisoryFilterValue | null;
  onChange: (next: AdvisoryFilterValue | null) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <span className="text-[13px] font-medium text-ink-muted" id="advisory-filter-label">
        ความเห็นผู้เชี่ยวชาญ
      </span>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-labelledby="advisory-filter-label">
        {OPTIONS.map((option) => {
          const active = value === option.value;
          return (
            <button
              key={option.label}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(option.value)}
              className={clsx(
                "inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[13px] transition-colors",
                active
                  ? "border-navy-500 bg-navy-50 font-medium text-navy-800"
                  : "border-line bg-white text-ink-muted hover:border-navy-300 hover:text-navy-700",
              )}
            >
              {/* จุดนำหน้าเป็นของแถม — ป้ายทุกอันมีข้อความอยู่แล้ว สีไม่ได้แบกความหมายไว้คนเดียว */}
              {option.dot ? (
                <span className={clsx("h-2 w-2 rounded-full", option.dot)} aria-hidden="true" />
              ) : null}
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * ป้ายในแถวของตาราง — บอกแค่ "มี / ยังไม่มี" ไม่ใช่เนื้อความ
 *
 * ใบที่ยังไม่ได้ขอความเห็นไม่มีป้าย: ความว่างคือคำตอบอยู่แล้ว และแถวส่วนใหญ่เป็นแบบนั้น
 * การใส่ป้ายให้ทุกแถวจะกลายเป็นเสียงรบกวนแทนที่จะเป็นสัญญาณ
 *
 * ผู้มีอำนาจอนุมัติของ BDI เห็นป้ายนี้ด้วย — มันบอกว่า *มี* ความเห็นอยู่ ไม่ได้ยกเนื้อความ
 * ขึ้นมา จึงไม่ขัดกับการ์ด 2026-09-10 ที่ซ่อนการ์ดความเห็นจากหน้าคำขอของเขา
 */
export function AdvisoryBadge({
  commentedAt,
  assigned,
}: {
  commentedAt: string | null;
  assigned: boolean;
}) {
  if (commentedAt) {
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-navy-50 px-2.5 py-0.5 text-[12px] font-medium text-navy-700">
        <span className="h-1.5 w-1.5 rounded-full bg-navy-500" aria-hidden="true" />
        มีความเห็นแล้ว
      </span>
    );
  }
  if (!assigned) return null;
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line px-2.5 py-0.5 text-[12px] text-ink-muted">
      <span className="h-1.5 w-1.5 rounded-full border border-navy-300" aria-hidden="true" />
      รอความเห็น
    </span>
  );
}
