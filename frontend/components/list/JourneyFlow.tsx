"use client";

import clsx from "clsx";
import type { CSSProperties } from "react";

import {
  NODE_TONE_CLASS,
  type JourneyNode,
  type ListSummary,
  type NodeKey,
} from "@/lib/stage";

/**
 * แผนภาพเส้นทางอนุมัติที่กดกรองได้ — แทนการ์ดสรุปกับเม็ดกรองเดิม
 *
 * เม็ดกรองแนวนอนแปดเม็ดบอกได้ว่ามีด่านอะไรบ้าง แต่ไม่ได้บอกว่าด่านต่อกันอย่างไร อ่านได้
 * ว่าเป็นแปดอย่างที่ไม่เกี่ยวกัน ทั้งที่จริงคือขั้นตอนที่คำขอเดินผ่านทีละขั้นและมีทางแยก
 * กลับมาแก้ไข
 *
 * **ไฟล์นี้ไม่รู้จักเส้นทางไหนเลย** โหนด ลำดับ คำ และเส้นเชื่อมทั้งหมดมาจาก `/summary`
 * เพิ่มด่านใหม่ที่ backend/src/lib/journey-steps.ts แล้วภาพนี้ขึ้นเอง
 *
 * ## ทำไมเป็น CSS grid ไม่ใช่ SVG
 *
 * มันเป็น **ตัวควบคุม ไม่ใช่ภาพ** — โหนดต้องเป็น <button> จริงเพื่อให้ได้ focus ring
 * ของ globals.css, hit area และการตัดบรรทัดภาษาไทย ส่วนความกว้างโหนดขึ้นกับเนื้อหา
 * (ชื่อด่านยาว ๆ กับตัวเลขที่โตจาก 3 เป็น 1,204) SVG จึงต้องวัดข้อความเองหรือใช้
 * foreignObject จำนวนคอลัมน์มาจาก server ด้วย — `grid-cols-${n}` ใช้ไม่ได้เพราะ Tailwind
 * สแกน static จึงกำหนด template ผ่าน inline style ซึ่งเป็นค่าที่คำนวณได้ ไม่ใช่คลาส
 *
 * เส้นดิ่งลงหาโหนด "รอการแก้ไข" อยู่ **ในเซลล์ของโหนดเอง** (`left-1/2 top-full`) จึงตรง
 * กลางโหนดโดยไม่ต้องวัดตำแหน่งด้วย JS — นั่นคือเหตุผลที่ไม่ต้องใช้ SVG เลย
 */
export function JourneyFlow({
  summary,
  selected,
  onSelect,
  loading,
  highlightMine = false,
}: {
  summary: ListSummary | null;
  /** null = ยังไม่ได้เจาะจงโหนดไหน (แท็บเป็นตัวบอกขอบเขตแทน) */
  selected: NodeKey | null;
  onSelect: (key: NodeKey | null) => void;
  loading: boolean;
  /**
   * ระบายขั้นของผู้ใช้ให้เห็นว่า "ตารางข้างล่างคือของคุณอยู่แล้ว"
   *
   * เปิดเมื่ออยู่แท็บของตัวเองและยังไม่ได้เจาะจงโหนดไหน — เป็นค่าตั้งต้นที่ผู้ใช้ได้ทันที
   * โดยไม่ต้องรอ /summary ตัดสินอะไร และ **ไม่ใช่ `aria-checked`** เพราะคนที่ถือสอง role
   * มีสองขั้น radiogroup ติ๊กพร้อมกันสองอันไม่ได้ ความหมายที่ถูกคือ "ขอบเขตของแท็บ"
   * ซึ่งแท็บพูดอยู่แล้ว ตรงนี้แค่ชี้ว่าขอบเขตนั้นตกที่ขั้นไหนบ้าง
   */
  highlightMine?: boolean;
}) {
  if (!summary) return <FlowSkeleton />;

  const main = summary.nodes.filter((n) => n.lane === "main");
  const branches = summary.nodes.filter((n) => n.lane === "branch");
  const revision = summary.nodes.find((n) => n.lane === "revision") ?? null;
  const closed = summary.nodes.filter((n) => n.lane === "closed");

  const returning = new Set(
    summary.edges.filter((e) => e.kind === "return").map((e) => e.from),
  );
  const resubmitTargets = summary.edges
    .filter((e) => e.kind === "resubmit")
    .map((e) => summary.nodes.find((n) => n.key === e.to)?.short)
    .filter((s): s is string => Boolean(s));

  /**
   * จำนวนคอลัมน์มาจาก server — `grid-cols-${n}` ใช้ไม่ได้เพราะ Tailwind สแกน static
   * จึงส่งเป็น CSS variable แล้วให้คลาส (ซึ่งเป็นสตริงเต็ม) อ่านค่านั้น **เฉพาะ md ขึ้นไป**
   * ต่ำกว่านั้นแผนภาพเลิกเป็นแผนภาพและกลายเป็นชิปสองคอลัมน์ที่ยังกดกรองได้ครบ —
   * โซ่ยาว 900px ในจอ 360px ไม่ใช่แผนภาพ เป็นแค่ของที่อ่านไม่ออก
   */
  const columns = { "--flow-cols": String(main.length) } as CSSProperties;
  const railFrom = main.findIndex((n) => returning.has(n.key));
  const railTo = main.map((n) => returning.has(n.key)).lastIndexOf(true);
  /** โหนด "รอการแก้ไข" อยู่ใต้ด่านแรกที่ส่งกลับได้ — รางจึงเลี้ยวลงตรงนั้น */
  const revisionColumn = Math.max(0, railFrom);

  /** ไม่มีโหนดไหนถูกเจาะจง = "ทุกขั้นตอน" ถูกเลือกอยู่ radiogroup ต้องมีสมาชิกที่ติ๊กเสมอ */
  const nothingPicked = selected === null;

  return (
    <div
      role="radiogroup"
      aria-label="กรองตามขั้นตอนในเส้นทางอนุมัติ"
      className={clsx(
        "mb-5 rounded-2xl border border-line bg-white px-4 py-5 transition-opacity sm:px-6",
        loading && "opacity-60",
      )}
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <AllChip checked={nothingPicked} total={summary.total} onSelect={() => onSelect(null)} />
        <p className="text-[13px] text-ink-muted">
          กดขั้นตอนเพื่อดูเฉพาะคำขอที่ค้างอยู่ตรงนั้น
        </p>
      </div>

      {/* แถวหลัก — ต่ำกว่า md เส้นเชื่อมหายไปหมดและโหนดไหลเป็นชิป
          จอแคบวาดโซ่ยาว 900px ไม่ได้ ถ้าดันให้เลื่อนแนวนอนก็ไม่มีใครเลื่อน */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:gap-x-8 md:gap-y-0 md:[grid-template-columns:repeat(var(--flow-cols),minmax(0,1fr))]" style={columns}>
        {main.map((node, i) => (
          <div key={node.key} className="relative">
            {i > 0 ? <Arrow className="absolute right-full top-1/2 w-8 -translate-y-1/2" /> : null}
            <FlowNode
              node={node}
              checked={selected === node.key}
              highlighted={highlightMine && node.mine}
              onSelect={() => onSelect(selected === node.key ? null : node.key)}
            />
            {returning.has(node.key) ? (
              <span aria-hidden="true" className="absolute left-1/2 top-full hidden h-4 w-px bg-line md:block" />
            ) : null}
          </div>
        ))}
      </div>

      {/* แถวทางแยก — **ไม่ได้อยู่ในแถบเส้นเชื่อม** เพราะแถบนั้นซ่อนต่ำกว่า md
          ถ้าเอาโหนดไปไว้ในนั้น ตัวกรอง "รอผู้เชี่ยวชาญ" จะหายไปทั้งอันบนมือถือ
          เซลล์ที่ไม่มีทางแยกแต่ส่งกลับได้ วาดเส้นดิ่งต่อลงไปหาราง เส้นจึงไม่ขาดตรงแถวนี้ */}
      {(branches.length > 0 || (revision && railFrom >= 0)) ? (
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 md:gap-x-8 md:gap-y-0 md:[grid-template-columns:repeat(var(--flow-cols),minmax(0,1fr))] md:mt-0 md:min-h-[4.5rem]" style={columns}>
          {main.map((column) => {
            const branch = branches.find((b) => b.anchor === column.key);
            if (branch) {
              return (
                <div key={column.key} className="relative md:pt-5">
                  <span aria-hidden="true" className="absolute left-1/2 top-0 hidden h-5 w-px bg-line md:block" />
                  <FlowNode
                    node={branch}
                    checked={selected === branch.key}
                    highlighted={highlightMine && branch.mine}
                    onSelect={() => onSelect(selected === branch.key ? null : branch.key)}
                    hint="ทางแยก — เจ้าหน้าที่เลือกเปิด ไม่ใช่ด่านที่ทุกคำขอต้องผ่าน"
                  />
                </div>
              );
            }
            return (
              <span key={column.key} className="relative hidden md:block" aria-hidden="true">
                {returning.has(column.key) ? (
                  <span className="absolute left-1/2 top-0 h-full w-px bg-line" />
                ) : null}
              </span>
            );
          })}
        </div>
      ) : null}

      {/* รางที่เส้นส่งกลับวิ่งมารวมกัน แล้วเลี้ยวลงหาโหนด "รอการแก้ไข" ที่คอลัมน์ซ้ายสุด
          วางทุกอย่างในกริดที่ใช้ template เดียวกับแถวบน คอลัมน์จึงตรงกันโดยไม่ต้องวัดอะไรเลย
          — เหตุผลเดียวกับที่ทั้งแผนภาพไม่ต้องใช้ SVG */}
      {revision && railFrom >= 0 ? (
        <div className="hidden h-8 md:grid md:gap-x-8 md:[grid-template-columns:repeat(var(--flow-cols),minmax(0,1fr))]" style={columns}>
          {main.map((node, i) => (
            <span key={node.key} className="relative">
              {returning.has(node.key) ? (
                <span aria-hidden="true" className="absolute left-1/2 top-0 h-4 w-px bg-line" />
              ) : null}
              {i >= revisionColumn && i < railTo ? (
                <span
                  aria-hidden="true"
                  className="absolute left-1/2 top-4 h-px w-[calc(100%+2rem)] bg-line"
                />
              ) : null}
              {i === revisionColumn ? (
                <span aria-hidden="true" className="absolute left-1/2 top-4 h-4 w-px bg-line" />
              ) : null}
            </span>
          ))}
        </div>
      ) : null}

      {/* แถวส่งกลับ — วางคอลัมน์เดียวกับด่านแรกที่ส่งกลับได้ เส้นดิ่งจึงตรงกลางโหนดพอดี */}
      {revision ? (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 md:gap-x-8 md:gap-y-0 md:[grid-template-columns:repeat(var(--flow-cols),minmax(0,1fr))] md:mt-0" style={columns}>
          {main.map((node, i) => {
            if (i !== revisionColumn)
              return <span key={node.key} className="hidden md:block" aria-hidden="true" />;
            return (
              <div key={node.key}>
                <FlowNode
                  node={revision}
                  checked={selected === revision.key}
                  highlighted={highlightMine && revision.mine}
                  onSelect={() => onSelect(selected === revision.key ? null : revision.key)}
                />
                {resubmitTargets.length > 0 ? (
                  <p className="mt-1.5 text-[12px] leading-relaxed text-ink-subtle">
                    แก้แล้วนำส่งใหม่ → {resubmitTargets.join(" หรือ ")}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}

      {/* ปลายทางที่ปิดแล้ว — อยู่นอกสายพาน จึงไม่มีเส้นเชื่อมเข้าหาเลย
          สี่ด่านปฏิเสธได้ ลากสี่เส้นมารวมกันจะทำภาพอ่านไม่ออกเพื่อบอกสิ่งที่ไม่มีใครใช้กรอง */}
      {closed.length > 0 ? (
        <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-line pt-4">
          <span className="mr-1 text-[12px] text-ink-subtle">จบแบบอื่น</span>
          {closed.map((node) => (
            <div key={node.key} className="w-32">
              <FlowNode
                node={node}
                size="sm"
                checked={selected === node.key}
                onSelect={() => onSelect(selected === node.key ? null : node.key)}
              />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * โหนดหนึ่งปุ่ม
 *
 * `role="radio"` ไม่ใช่ `aria-pressed` — เลือกได้ทีละอันเท่านั้น และ aria-pressed บนปุ่ม
 * เก้าปุ่มที่ติดได้ทีละอันจะรายงานความหมายผิด ตัวเลขอยู่ในชื่อที่ screen reader อ่านด้วย
 * เพราะไฮไลต์ "ขั้นตอนของคุณ" เป็นสีล้วนไม่ได้ (กติกาใน docs/02-ui-spec.md)
 */
function FlowNode({
  node,
  checked,
  onSelect,
  size = "md",
  hint,
  highlighted = false,
}: {
  node: JourneyNode;
  checked: boolean;
  onSelect: () => void;
  size?: "md" | "sm";
  hint?: string;
  highlighted?: boolean;
}) {
  const label = [
    node.waitingLabel ?? node.label,
    `${node.count} รายการ`,
    node.mine ? "ขั้นตอนของคุณ" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      tabIndex={checked ? 0 : -1}
      aria-label={label}
      title={hint ?? node.label}
      onClick={onSelect}
      className={clsx(
        // สีพื้นอยู่ในกิ่งของเงื่อนไขทุกกิ่ง ไม่ใช่ bg-white ที่ฐาน — Tailwind ตัดสินด้วยลำดับ
        // ในสไตล์ชีต ไม่ใช่ลำดับใน class ฐานจึงชนะกิ่งเงียบ ๆ และไฮไลต์ไม่ขึ้น
        "flex w-full flex-col gap-1 rounded-xl border text-left transition-colors",
        size === "sm" ? "px-3 py-1.5" : "px-3 py-2.5",
        checked
          ? "border-navy-800 bg-navy-50 ring-1 ring-navy-800"
          : highlighted
            ? "border-success/50 bg-success-bg hover:border-success"
            : "border-line bg-white hover:border-navy-300 hover:bg-navy-50/40",
        // "ขั้นตอนของคุณ" มีทั้งเส้นข้างและคำว่า "ของคุณ" — สีอย่างเดียวสื่อไม่ได้
        node.mine && "border-l-[3px] border-l-coral-500",
      )}
    >
      <span className="flex items-baseline gap-1.5">
        <span
          className={clsx(
            "rounded-full px-2 py-0.5 text-[13px] font-semibold tabular-nums",
            NODE_TONE_CLASS[node.tone],
          )}
        >
          {node.count.toLocaleString("th-TH")}
        </span>
        {node.mine ? (
          <span className="text-[11px] font-medium text-coral-600">ของคุณ</span>
        ) : null}
      </span>
      <span
        className={clsx(
          "leading-snug",
          size === "sm" ? "text-[12px]" : "text-[13px]",
          checked ? "font-medium text-navy-800" : "text-ink",
        )}
      >
        {node.short}
      </span>
    </button>
  );
}

function AllChip({
  checked,
  total,
  onSelect,
}: {
  checked: boolean;
  total: number;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      tabIndex={checked ? 0 : -1}
      onClick={onSelect}
      className={clsx(
        "rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition-colors",
        checked
          ? "border-navy-800 bg-navy-800 text-white"
          : "border-line bg-white text-ink-muted hover:border-navy-300 hover:text-navy-700",
      )}
    >
      ทุกขั้นตอน <span className="tabular-nums">{total.toLocaleString("th-TH")}</span>
    </button>
  );
}

/** ลูกศรระหว่างโหนด — ซ่อนต่ำกว่า md พร้อมเส้นเชื่อมอื่นทั้งหมด */
function Arrow({ className }: { className?: string }) {
  return (
    <span aria-hidden="true" className={clsx("hidden items-center text-ink-subtle md:flex", className)}>
      <span className="h-px w-full bg-line" />
      <svg viewBox="0 0 10 10" className="h-2.5 w-2.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="m3 1.5 3.5 3.5L3 8.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

/**
 * ระหว่างรอ `/summary` — วาดกรอบไว้ก่อนแต่ไม่โชว์เลขศูนย์
 * "ยังไม่รู้" กับ "ศูนย์จริง" ต้องไม่หน้าตาเหมือนกัน และแถบนี้อยู่บนจอทุกครั้งที่ debounce
 */
function FlowSkeleton() {
  return (
    <div className="mb-5 rounded-2xl border border-line bg-white px-4 py-5 sm:px-6">
      <div className="mb-4 h-8 w-32 animate-pulse rounded-full bg-navy-50" />
      <div className="grid gap-2 sm:grid-cols-3 md:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-16 animate-pulse rounded-xl bg-navy-50" />
        ))}
      </div>
    </div>
  );
}
