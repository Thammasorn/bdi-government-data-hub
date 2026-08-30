"use client";

import clsx from "clsx";
import type { CSSProperties } from "react";

import {
  NODE_TONE_DOT,
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
  lockedTo = null,
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
   * มีสองขั้น radiogroup ติ๊กพร้อมกันสองอันไม่ได้
   */
  highlightMine?: boolean;
  /**
   * กล่องที่กดได้ — `null` แปลว่ากดได้ทุกกล่อง
   *
   * แท็บเป็นตัวคุมว่าหน้านี้พูดถึงขอบเขตไหน อยู่แท็บ "ที่ต้องดำเนินการ" กล่องที่ไม่ใช่ของ
   * ผู้ใช้จึงกดไม่ได้ ไม่ใช่กดแล้วสลับแท็บให้เงียบ ๆ — กล่องที่จางลงอธิบายตัวเองได้ทันที
   * ว่าทำไมกดไม่ได้ ส่วนการสลับแท็บให้อัตโนมัติผู้ใช้ไม่รู้ว่าเกิดอะไรขึ้น
   */
  lockedTo?: NodeKey[] | null;
}) {
  if (!summary) return <FlowSkeleton />;

  const main = summary.nodes.filter((n) => n.lane === "main");
  const branches = summary.nodes.filter((n) => n.lane === "branch");
  const revision = summary.nodes.find((n) => n.lane === "revision") ?? null;
  const closed = summary.nodes.filter((n) => n.lane === "closed");

  const returning = new Set(summary.edges.filter((e) => e.kind === "return").map((e) => e.from));
  const resubmitTargets = summary.edges
    .filter((e) => e.kind === "resubmit")
    .map((e) => summary.nodes.find((n) => n.key === e.to)?.short)
    .filter((s): s is string => Boolean(s));

  const columns = { "--flow-cols": String(main.length) } as CSSProperties;
  const railFrom = main.findIndex((n) => returning.has(n.key));
  /** โหนด "รอการแก้ไข" อยู่ใต้ด่านแรกที่ส่งกลับได้ */
  const revisionColumn = Math.max(0, railFrom);

  const disabledOf = (key: NodeKey) => Boolean(lockedTo && !lockedTo.includes(key));
  const pick = (key: NodeKey) => onSelect(selected === key ? null : key);

  /**
   * พิกัดแนวนอนของคอลัมน์ — กริดเป็น `repeat(N, 1fr)` ที่มีช่องว่าง 2rem (gap-x-8)
   * คำนวณเป็น calc ได้ตรง ๆ จึงไม่ต้องวัดตำแหน่งด้วย JS หรือ ResizeObserver
   */
  const N = main.length;
  const track = `((100% - ${(N - 1) * 2}rem) / ${N})`;
  const colStart = (i: number) => `calc(${i} * (${track} + 2rem))`;
  const colEnd = (i: number) => `calc(${i} * (${track} + 2rem) + ${track})`;
  const colMid = (i: number) => `calc(${i} * (${track} + 2rem) + ${track} / 2)`;
  /** กล่องทุกใบสูงเท่ากัน (min-h-[4.5rem]) กึ่งกลางจึงอยู่ที่ 2.25rem จากขอบแถวเสมอ */
  const MID = "2.25rem";
  const BOX = "4.5rem";
  /** กลางช่องว่างทางซ้ายของกล่องรอการแก้ไข — ทางเดินของเส้น "นำส่งใหม่" */
  const gutter = `calc(${colStart(revisionColumn)} - 1rem)`;

  /** ด่านที่ส่งกลับได้และไม่ได้อยู่คอลัมน์เดียวกับกล่องรอการแก้ไข — เข้าทางด้านขวา */
  const sideReturns = main
    .map((n, i) => ({ n, i }))
    .filter(({ n, i }) => returning.has(n.key) && i !== revisionColumn);
  const sideRailTo = sideReturns.length > 0 ? Math.max(...sideReturns.map((r) => r.i)) : -1;

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
        <AllChip
          checked={selected === null}
          total={summary.total}
          unit={summary.unit}
          onSelect={() => onSelect(null)}
        />
        <p className="text-[13px] text-ink-muted">กดขั้นตอนเพื่อดูเฉพาะคำขอที่ค้างอยู่ตรงนั้น</p>
      </div>

      {/* ทางแยก — อยู่ **เหนือ** แถวหลัก และอยู่นอกบล็อกที่ชั้นเส้นเชื่อมใช้อ้างอิง
          เดิมห้อยอยู่ข้างล่างและบังทางที่ลูกศร "ส่งกลับให้แก้ไข" ต้องดิ่งลงไป จนต้องอ้อม
          ออกข้าง ย้ายขึ้นมาแล้วเส้นนั้นตรงลงได้ตามแบบ
          **ต้องอยู่นอก `relative` ข้างล่าง** เพราะทุกเส้นวัดจาก `top: BOX` = ขอบล่างของ
          แถวหลัก ถ้าย้ายแถวนี้เข้าไปในบล็อกเดียวกัน เส้นทุกเส้นจะเลื่อนพร้อมกันเงียบ ๆ
          ไม่ได้อยู่ในชั้นเส้นเชื่อมที่ซ่อนต่ำกว่า md ไม่งั้นตัวกรองนี้หายทั้งอันบนมือถือ */}
      {branches.length > 0 ? (
        <div
          className="mb-2 grid grid-cols-2 items-stretch gap-2 sm:grid-cols-3 md:mb-12 md:gap-x-8 md:gap-y-0 md:[grid-template-columns:repeat(var(--flow-cols),minmax(0,1fr))]"
          style={columns}
        >
          {main.map((column) => {
            const branch = branches.find((b) => b.anchor === column.key);
            if (!branch) return <span key={column.key} className="hidden md:block" aria-hidden="true" />;
            return (
              <div key={column.key} className="relative">
                {/* เส้นประสองหัวลูกศร — ทางแยกที่ออกไปแล้วกลับเข้าด่านเดิม ไม่ใช่ทางผ่าน
                    ช่องว่าง 3rem (md:mb-12) พอให้เห็นว่าเส้นเป็นเส้นประจริง ๆ หลังหักหัวลูกศร
                    หัวละ 0.75rem ออกจากปลายทั้งสองข้างแล้ว

                    **ห้ามจัดกึ่งกลางด้วย `-translate-x-1/2`** — Chevron หมุนด้วย rotate ซึ่ง
                    Tailwind รวมเป็น transform เดียวกัน การเลื่อนแนวนอนจึงถูกหมุนตามไปเป็นการ
                    เลื่อนแนวตั้ง แล้วหัวลูกศรสองอันจะไหลมาชนกันกลางเส้น */}
                <span
                  aria-hidden="true"
                  title="ขั้นตอนนี้ไม่บังคับ — เกิดเมื่อผู้รับผิดชอบเลือกเท่านั้น แล้วคำขอกลับมาที่ด่านเดิม"
                  className="absolute left-1/2 top-full hidden h-12 border-l border-dashed border-navy-300 md:block"
                />
                <Chevron
                  direction="up"
                  className="absolute hidden text-ink-subtle md:block"
                  style={{ left: "calc(50% - 0.375rem)", top: "calc(100% + 0.15rem)" }}
                />
                <Chevron
                  direction="down"
                  className="absolute hidden text-ink-subtle md:block"
                  style={{ left: "calc(50% - 0.375rem)", top: "calc(100% + 2.1rem)" }}
                />
                <FlowNode
                  node={branch}
                  unit={summary.unit}
                  checked={selected === branch.key}
                  highlighted={highlightMine && branch.mine}
                  disabled={disabledOf(branch.key)}
                  onSelect={() => pick(branch.key)}
                  hint="ทางแยก — เจ้าหน้าที่เลือกเปิด ไม่ใช่ด่านที่ทุกคำขอต้องผ่าน"
                />
              </div>
            );
          })}
        </div>
      ) : null}

      {/* บล็อกเดียวครอบตั้งแต่แถวหลักถึงแถวส่งกลับ — เส้นเชื่อมทั้งหมดวางแบบ absolute
          เทียบกับบล็อกนี้ คอลัมน์จึงตรงกันโดยไม่ต้องวัดอะไรเลย
          ต่ำกว่า md เส้นหายหมดและกล่องไหลเป็นชิปสองคอลัมน์ — โซ่ยาว 900px ในจอ 360px
          ไม่ใช่แผนภาพ */}
      <div className="relative">
        {/* แถวหลัก */}
        <div
          className="grid grid-cols-2 items-stretch gap-2 sm:grid-cols-3 md:gap-x-8 md:gap-y-0 md:[grid-template-columns:repeat(var(--flow-cols),minmax(0,1fr))]"
          style={columns}
        >
          {main.map((node, i) => (
            <div key={node.key} className="relative">
              {i > 0 ? (
                <Arrow className="absolute right-full top-[2.25rem] w-8 -translate-y-1/2" />
              ) : null}
              <FlowNode
                node={node}
                unit={summary.unit}
                checked={selected === node.key}
                highlighted={highlightMine && node.mine}
                disabled={disabledOf(node.key)}
                onSelect={() => pick(node.key)}
              />
            </div>
          ))}
        </div>

        {/* แถวส่งกลับ — คอลัมน์เดียวกับด่านแรกที่ส่งกลับได้ */}
        {revision ? (
          <div
            className="mt-3 grid grid-cols-2 items-stretch gap-2 sm:grid-cols-3 md:mt-12 md:gap-x-8 md:gap-y-0 md:[grid-template-columns:repeat(var(--flow-cols),minmax(0,1fr))]"
            style={columns}
          >
            {main.map((node, i) =>
              i === revisionColumn ? (
                <FlowNode
                  key={node.key}
                  node={revision}
                  unit={summary.unit}
                  checked={selected === revision.key}
                  highlighted={highlightMine && revision.mine}
                  disabled={disabledOf(revision.key)}
                  onSelect={() => pick(revision.key)}
                />
              ) : (
                <span key={node.key} className="hidden md:block" aria-hidden="true" />
              ),
            )}
          </div>
        ) : null}

        {/* ชั้นเส้นเชื่อม — ลูกศรส่งกลับและลูกศรนำส่งใหม่ */}
        {revision && railFrom >= 0 ? (
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 hidden md:block">
            {/* ด่านที่อยู่คอลัมน์เดียวกับกล่องรอการแก้ไข — ดิ่งลงเข้าทางด้านบนของกล่อง
                ทางลงนี้ว่างเสมอตั้งแต่ย้ายแถวทางแยกขึ้นไปอยู่เหนือแถวหลัก */}
            <span
              className="absolute w-px bg-line"
              style={{ left: colMid(revisionColumn), top: BOX, bottom: BOX }}
            />
            <Chevron
              direction="down"
              className="absolute -translate-x-1/2"
              style={{ left: colMid(revisionColumn), bottom: `calc(${BOX} - 0.3rem)` }}
            />

            {/* ด่านอื่น — ดิ่งลงมาถึงกึ่งกลางแถวส่งกลับ แล้ววิ่งซ้ายเข้าด้านขวาของกล่อง */}
            {sideReturns.map(({ n, i }) => (
              <span
                key={n.key}
                className="absolute w-px bg-line"
                style={{ left: colMid(i), top: BOX, bottom: MID }}
              />
            ))}
            {sideRailTo >= 0 ? (
              <>
                <span
                  className="absolute h-px bg-line"
                  style={{
                    left: colEnd(revisionColumn),
                    width: `calc(${colMid(sideRailTo)} - ${colEnd(revisionColumn)})`,
                    bottom: MID,
                  }}
                />
                <Chevron
                  direction="left"
                  className="absolute translate-y-1/2"
                  style={{ left: colEnd(revisionColumn), bottom: `calc(${MID} - 0.3rem)` }}
                />
              </>
            ) : null}

            {/* นำส่งใหม่ — ออกจากด้านซ้ายของกล่องรอการแก้ไข ขึ้นไปแล้วเข้าด้านซ้ายของด่านแรก
                เดินใน **ช่องว่างระหว่างคอลัมน์** (gap-x-8 = 2rem) ไม่ใช่กลางคอลัมน์ซ้าย
                ไม่งั้นเส้นแนวนอนจะพาดทับกล่อง "ฉบับร่าง" ที่อยู่ในแถวเดียวกัน */}
            <span
              className="absolute h-px bg-line"
              style={{ left: gutter, width: "1rem", bottom: MID }}
            />
            <span className="absolute w-px bg-line" style={{ left: gutter, top: MID, bottom: MID }} />
            <span
              className="absolute h-px bg-line"
              style={{ left: gutter, width: "1rem", top: MID }}
            />
          </div>
        ) : null}
      </div>

      {resubmitTargets.length > 1 ? (
        <p className="mt-2 text-[12px] leading-relaxed text-ink-subtle md:ml-2">
          แก้แล้วนำส่งใหม่ → กลับไปที่ {resubmitTargets.join(" หรือ ")} แล้วแต่ว่าหน่วยงานลงนามไปแล้วหรือยัง
        </p>
      ) : null}

      {/* ปลายทางที่ปิดแล้ว — อยู่นอกสายพาน จึงไม่มีเส้นเชื่อมเข้าหาเลย
          สี่ด่านปฏิเสธได้ ลากสี่เส้นมารวมกันจะทำภาพอ่านไม่ออกเพื่อบอกสิ่งที่ไม่มีใครใช้กรอง */}
      {closed.length > 0 ? (
        <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-line pt-4">
          <span className="mr-1 text-[12px] text-ink-subtle">จบแบบอื่น</span>
          {closed.map((node) => (
            <div key={node.key} className="w-36">
              <FlowNode
                node={node}
                unit={summary.unit}
                size="sm"
                checked={selected === node.key}
                disabled={disabledOf(node.key)}
                onSelect={() => pick(node.key)}
              />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function FlowNode({
  node,
  checked,
  onSelect,
  unit,
  size = "md",
  hint,
  highlighted = false,
  disabled = false,
}: {
  node: JourneyNode;
  checked: boolean;
  onSelect: () => void;
  unit: string;
  size?: "md" | "sm";
  hint?: string;
  highlighted?: boolean;
  disabled?: boolean;
}) {
  const label = [
    node.waitingLabel ?? node.label,
    `จำนวน ${node.count} ${unit}`,
    node.mine ? "รอคุณดำเนินการ" : null,
    disabled ? "กดไม่ได้ในแท็บนี้" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      aria-disabled={disabled || undefined}
      disabled={disabled}
      tabIndex={checked && !disabled ? 0 : -1}
      aria-label={label}
      title={hint ?? node.label}
      onClick={onSelect}
      className={clsx(
        // สีพื้นอยู่ในกิ่งของเงื่อนไขทุกกิ่ง ไม่ใช่ bg-white ที่ฐาน — Tailwind ตัดสินด้วยลำดับ
        // ในสไตล์ชีต ไม่ใช่ลำดับใน class ฐานจึงชนะกิ่งเงียบ ๆ และไฮไลต์ไม่ขึ้น
        "flex h-full w-full flex-col justify-center gap-0.5 rounded-xl border text-left transition-colors",
        // ความสูงคงที่ — ชั้นเส้นเชื่อมยึดกึ่งกลางกล่องไว้ที่ 2.25rem จากขอบแถว
        size === "sm" ? "px-3 py-2" : "min-h-[4.5rem] px-3.5 py-2.5",
        disabled
          ? "cursor-not-allowed border-line bg-navy-50/40 opacity-55"
          : checked
            ? "border-navy-800 bg-navy-50 ring-1 ring-navy-800"
            : highlighted
              ? "border-success/50 bg-success-bg hover:border-success"
              : "border-line bg-white hover:border-navy-300 hover:bg-navy-50/40",
        // "รอคุณดำเนินการ" มีทั้งเส้นข้างและคำกำกับ — สีอย่างเดียวสื่อไม่ได้
        node.mine && !disabled && "border-l-[3px] border-l-coral-500",
      )}
    >
      {node.mine ? (
        <span className="text-[11px] font-medium leading-tight text-coral-600">รอคุณดำเนินการ</span>
      ) : null}
      {/* ชื่อขั้นตอนคือสิ่งที่ต้องอ่านก่อน จำนวนเป็นรายละเอียดรอง — เดิมสลับกัน */}
      <span
        className={clsx(
          "flex items-center gap-1.5 font-semibold leading-snug",
          size === "sm" ? "text-[13px]" : "text-[15px]",
          checked ? "text-navy-800" : "text-ink",
        )}
      >
        <span
          aria-hidden="true"
          className={clsx("h-1.5 w-1.5 shrink-0 rounded-full", NODE_TONE_DOT[node.tone])}
        />
        {node.short}
      </span>
      <span className="text-[12px] leading-tight text-ink-muted">
        จำนวน: <span className="tabular-nums">{node.count.toLocaleString("th-TH")}</span> {unit}
      </span>
    </button>
  );
}

function AllChip({
  checked,
  total,
  unit,
  onSelect,
}: {
  checked: boolean;
  total: number;
  unit: string;
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
      ทุกขั้นตอน <span className="tabular-nums">{total.toLocaleString("th-TH")}</span> {unit}
    </button>
  );
}

/** ลูกศรระหว่างโหนด — ซ่อนต่ำกว่า md พร้อมเส้นเชื่อมอื่นทั้งหมด */
function Arrow({ className }: { className?: string }) {
  return (
    <span aria-hidden="true" className={clsx("hidden items-center text-ink-subtle md:flex", className)}>
      <span className="h-px w-full bg-line" />
      <Chevron direction="right" className="shrink-0" />
    </span>
  );
}

/**
 * หัวลูกศร — เส้นเปล่า ๆ ไม่บอกทิศ และเส้นส่งกลับกับเส้นนำส่งใหม่วิ่งสวนทางกัน
 *
 * คลาสหมุนเขียนเต็มทุกตัว ไม่ต่อสตริง — Tailwind สแกนไฟล์แบบ static
 */
function Chevron({
  direction,
  className,
  style,
}: {
  direction: "right" | "left" | "down" | "up";
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 10 10"
      style={style}
      className={clsx(
        "h-3 w-3",
        direction === "left"
          ? "rotate-180"
          : direction === "down"
            ? "rotate-90"
            : direction === "up"
              ? "-rotate-90"
              : "",
        className,
      )}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="m3 1.5 3.5 3.5L3 8.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
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
