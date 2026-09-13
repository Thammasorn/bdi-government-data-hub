"use client";

import clsx from "clsx";
import Link from "next/link";

import { type JourneyNode, type ListSummary } from "@/lib/stage";
import { isOrganizationScopedRole } from "@/lib/status";

/**
 * แถวสรุปของเส้นทางหนึ่งบนหน้าแรกฝั่ง BDI — กล่องละด่าน แล้วปิดท้ายด้วย "อนุมัติแล้ว"
 *
 * กล่องที่เป็นงานของตำแหน่งผู้อ่าน (`node.mine` จาก `/summary`) เด่นขึ้นมา ที่เหลือในแถว
 * เดียวกันถูกหรี่ลง — ผู้ประสานงานของ BDI เห็น "รอผู้ประสานงานของ BDI ตรวจสอบเอกสาร" ชัด
 * ส่วนผู้มีอำนาจอนุมัติของ BDI เห็นด่านของตัวเองชัด (การ์ด Task Board 2026-09-11)
 * ตำแหน่งที่ไม่มีด่านเลย (นิติกร, ผู้ดูแลระบบ) ไม่มีอะไรให้เด่น จึงไม่หรี่กล่องไหนเลย
 *
 * **แถวนี้ไม่รู้จักลำดับด่าน** ตามกติกาหัวไฟล์ lib/stage.ts — มันหยิบโหนดจากสิ่งที่ server
 * ส่งมา: ด่านในช่องหลักที่เป็นของฝั่ง BDI (ด่านของหน่วยงานถูกตัดออกตามการ์ด เพราะไม่มีวัน
 * เป็นงานของใครฝั่งนี้ และลิงก์ "ดูรายการแต่ละขั้นทั้งหมด" พาไปเห็นเส้นทางเต็มบนแผนภาพ
 * ของหน้ารายการอยู่แล้ว) บวกปลายทาง `APPROVED` ซึ่งเป็นสถานะที่หน้าเว็บเป็นเจ้าของได้
 * เพิ่มด่านฝั่ง BDI ใน journey-steps.ts แล้วกล่องจะโผล่เองโดยไม่ต้องแก้ที่นี่
 */
export function JourneyRow({
  title,
  summary,
  basePath,
}: {
  title: string;
  summary: ListSummary;
  /** หน้ารายการของเส้นทางนี้ — กล่องแต่ละใบลิงก์ไปหาแถวของด่านนั้นบนหน้านี้ */
  basePath: string;
}) {
  const nodes = summary.nodes.filter(
    (n) =>
      n.lane === "main" &&
      (n.terminal
        ? n.key === "APPROVED"
        : n.roleCode !== null && !isOrganizationScopedRole(n.roleCode)),
  );
  const hasOwn = nodes.some((n) => n.mine);

  return (
    <section aria-label={title}>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-[15px] font-semibold text-navy-800">{title}</h2>
        {/* ลิงก์ไปหน้าที่วาดเส้นทางเต็ม — แทนกล่องของด่านหน่วยงานที่ตัดออกไป */}
        <Link
          href={`${basePath}?tab=all`}
          className="text-[13px] font-medium text-navy-700 underline-offset-4 hover:underline"
        >
          ดูรายการแต่ละขั้นทั้งหมด →
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {nodes.map((node) => (
          <StageTile
            key={node.key}
            node={node}
            basePath={basePath}
            dimmed={hasOwn && !node.mine}
          />
        ))}
      </div>
    </section>
  );
}

/**
 * กล่องหนึ่งด่าน — ลิงก์ไปหน้ารายการที่กรองด่านนั้นไว้แล้ว
 *
 * ของตัวเองเปิดที่แท็บ "ที่ต้องดำเนินการ" (โหนดของตัวเองกดได้บนแท็บนั้น และเป็นแถวชุด
 * เดียวกับตัวเลขบนกล่อง) ของคนอื่นเปิดที่ "ทั้งหมด" — บนแท็บของตัวเอง โหนดของคนอื่นถูกล็อก
 * ไว้ ลิงก์ที่พาไปเจอตัวกรองที่กดไม่ได้จะอ่านไม่ออกว่าทำไม (ดู lib/use-request-list.ts)
 *
 * ชื่อบนกล่องคือ `waitingLabel` — คำเดียวกับ badge ในตารางและหน้ารายละเอียด ไม่ใช่ชื่อย่อ
 * ของแผนภาพ เพราะกดกล่องแล้วไปเจอแถวที่ badge เขียนคำนั้น
 */
function StageTile({
  node,
  basePath,
  dimmed,
}: {
  node: JourneyNode;
  basePath: string;
  dimmed: boolean;
}) {
  const label = node.waitingLabel ?? node.label;
  const count = node.count.toLocaleString("th-TH");
  const tab = node.mine ? "mine" : "all";

  return (
    <Link
      href={`${basePath}?tab=${tab}&stage=${node.key}`}
      aria-label={[label, `จำนวน ${count} รายการ`, node.mine ? "รอคุณดำเนินการ" : null]
        .filter(Boolean)
        .join(" · ")}
      className={clsx(
        "flex flex-col justify-center rounded-2xl px-5 py-4 ring-1 transition-colors",
        // "งานของคุณ" มีทั้งเส้นข้าง คำกำกับ และสี — สีอย่างเดียวสื่อไม่ได้
        node.mine && "border-l-[3px] border-l-coral-500 bg-white shadow-card ring-coral-200",
        dimmed
          ? "bg-navy-50/40 ring-line hover:bg-navy-50"
          : !node.mine && "bg-white shadow-card ring-line hover:ring-navy-300",
      )}
    >
      {node.mine ? (
        <p className="text-[11px] font-medium leading-tight text-coral-600">รอคุณดำเนินการ</p>
      ) : null}
      <p className={clsx("text-[13px] leading-snug", dimmed ? "text-ink-subtle" : "text-ink-muted")}>
        {label}
      </p>
      <p
        className={clsx(
          "mt-1 text-[28px] font-semibold leading-tight tabular-nums",
          node.mine
            ? "text-coral-600"
            : dimmed
              ? "text-ink-subtle"
              : node.tone === "success"
                ? "text-success"
                : "text-navy-800",
        )}
      >
        {count}
      </p>
    </Link>
  );
}
