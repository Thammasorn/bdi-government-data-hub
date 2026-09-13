"use client";

import clsx from "clsx";
import Link from "next/link";

import { type JourneyNode, type ListSummary } from "@/lib/stage";
import { isOrganizationScopedRole } from "@/lib/status";

/**
 * คำที่กล่องปลายทางใช้บนหน้าแรก — คนละคำกับ badge ในตาราง ซึ่งเขียนว่า "อนุมัติแล้ว"
 *
 * ตรงนี้เป็นข้อยกเว้นเดียวของกติกา "ใช้คำเดียวกับ badge" ด้านล่าง และตั้งใจให้เป็นข้อยกเว้น:
 * กล่องนี้ตอบคำถามว่าเดินจบเส้นทางไปแล้วกี่ใบ ซึ่งสำหรับคนอ่านฝั่ง BDI แปลว่าหน่วยงาน
 * หรือชุดข้อมูลนั้นใช้งานได้จริงแล้ว ไม่ใช่แค่มีใครสักคนเซ็นอนุมัติ — การ์ด Task Board
 * เขียนคำว่า "เปิดใช้งานแล้ว" ไว้ตั้งแต่ต้น และยืนยันอีกครั้งเมื่อ 2026-09-13
 *
 * ใส่เป็นตารางแทนที่จะฮาร์ดโค้ดในกล่อง เพราะปลายทางอื่น (`REJECTED`, `CANCELLED`) อาจถูก
 * เพิ่มเข้าแถววันหลังแล้วต้องการคำของตัวเองเหมือนกัน คีย์ที่ไม่อยู่ในนี้ยังใช้คำจาก server ตามเดิม
 */
const TERMINAL_LABELS: Record<string, string> = {
  APPROVED: "เปิดใช้งานแล้ว",
};

/**
 * แถวสรุปของเส้นทางหนึ่งบนหน้าแรกฝั่ง BDI — กล่อง "ทั้งหมด" แล้วกล่องละด่าน ปิดท้ายด้วย
 * "เปิดใช้งานแล้ว"
 *
 * กล่องที่เป็นงานของตำแหน่งผู้อ่าน (`node.mine` จาก `/summary`) เด่นขึ้นมา ที่เหลือในแถว
 * เดียวกันถูกหรี่ลง — ผู้ประสานงานของ BDI เห็น "รอผู้ประสานงานของ BDI ตรวจสอบเอกสาร" ชัด
 * ส่วนผู้มีอำนาจอนุมัติของ BDI เห็นด่านของตัวเองชัด (การ์ด Task Board 2026-09-11)
 * ตำแหน่งที่ไม่มีด่านเลย (นิติกร, ผู้ดูแลระบบ) ไม่มีอะไรให้เด่น จึงไม่หรี่กล่องไหนเลย
 *
 * **แถวนี้ไม่รู้จักลำดับด่าน** ตามกติกาหัวไฟล์ lib/stage.ts — มันหยิบโหนดจากสิ่งที่ server
 * ส่งมา: ด่านในช่องหลักที่เป็นของฝั่ง BDI (ด่านของหน่วยงานไม่มีกล่องของตัวเอง เพราะไม่มีวัน
 * เป็นงานของใครฝั่งนี้ — มันไปรวมอยู่ในบรรทัด "อยู่ระหว่างการดำเนินการของหน่วยงาน" ของกล่อง
 * ทั้งหมดแทน) บวกปลายทาง `APPROVED` ซึ่งเป็นสถานะที่หน้าเว็บเป็นเจ้าของได้
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
        {/* ลิงก์ไปหน้าที่วาดเส้นทางเต็ม — แทนกล่องของด่านหน่วยงานที่ไม่ได้อยู่ในแถวนี้ */}
        <Link
          href={`${basePath}?tab=all`}
          className="text-[13px] font-medium text-navy-700 underline-offset-4 hover:underline"
        >
          ดูรายการแต่ละขั้นทั้งหมด →
        </Link>
      </div>

      {/*
        สี่คอลัมน์เริ่มที่ `xl` ไม่ใช่ `lg` — ที่ 1024px คอนเทนเนอร์ยังไม่ถึง max-w-6xl กล่องจึง
        เหลือความกว้างข้อความราว 192px และบรรทัด "อยู่ในการดำเนินโดยหน่วยงาน N <หน่วย>" ตกลงไป
        เป็นสองบรรทัด ซึ่งเป็นอาการที่การ์ด "แก้เพิ่มเติม" สั่งให้หายไป วัดแล้ว: ต้องมีราว 230px
        จึงจบบรรทัดเดียว ซึ่งได้เมื่อ viewport กว้างกว่า ~1176px — `xl` (1280) คือขั้นถัดไปที่
        ปลอดภัย ระหว่าง 1024–1279 แถวเป็นสองคอลัมน์ กล่องกว้าง ~480px เหลือเฟือ
      */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <TotalTile summary={summary} basePath={basePath} />
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

const tileClass =
  "flex flex-col justify-center rounded-2xl px-5 py-4 ring-1 transition-colors";

/**
 * กล่อง "ทั้งหมด" — คำขอทุกใบของเส้นทางนี้ **รวมฉบับร่าง** แล้วบอกว่าส่วนที่ไม่ได้อยู่ในสาม
 * กล่องข้าง ๆ ไปกองอยู่ที่ไหน
 *
 * เหตุผลที่ต้องมีบรรทัดพวกนั้น: แถวนี้โชว์เฉพาะด่านฝั่ง BDI กับปลายทางที่อนุมัติแล้ว ตัวเลข
 * สามกล่องจึงไม่มีวันบวกได้เท่า "ทั้งหมด" และผู้อ่านที่ลองบวกดูจะสรุปว่าตัวเลขพัง — การ์ด
 * Task Board 2026-09-13 ขอบรรทัดนี้มาด้วยเหตุผลนี้ตรง ๆ กติกาคือ
 * **ทั้งหมด = อยู่ในการดำเนินโดยหน่วยงาน + สามกล่องที่เหลือ**
 *
 * คำว่า "อยู่ในการดำเนินโดยหน่วยงาน" สั้นกว่าที่เขียนไว้รอบแรก ("อยู่ระหว่างการดำเนินการของ
 * หน่วยงาน") เพราะของเดิมตกไปสองบรรทัดในกล่องกว้างราว 230px แล้วดันตัวเลขของกล่องอื่น
 * ในแถวให้ไม่อยู่ระดับเดียวกัน — การ์ดสั่งไว้ว่าต้องจบในบรรทัดเดียว และเป็นคนเลือกคำนี้เอง
 *
 * ทั้งสองบรรทัด derive จากโหนดที่ server ส่งมา ไม่ได้ไล่ชื่อด่านเอง — "ของหน่วยงาน" คือโหนด
 * ที่ roleCode เป็น role ฝั่งหน่วยงาน (ฉบับร่าง · รอการแก้ไข · รอหน่วยงานลงนาม) ซึ่งเป็นกติกา
 * เดียวกับที่แถวใช้คัดกล่องออก ส่วน "ปิดเรื่องแล้ว" คือช่อง `closed` ของแผนภาพ
 * (ไม่อนุมัติ · ยกเลิกแล้ว) บรรทัดนั้นขึ้นเฉพาะเมื่อมีจริง เพราะเส้นทางส่วนใหญ่ไม่มีเลย —
 * แต่ถ้ามีแล้วไม่เขียน การบวกก็ไม่ลงอีกแบบหนึ่ง
 *
 * ตัวเลข "ทั้งหมด" คือ `summary.total` จาก server ตรง ๆ ไม่ใช่ผลบวกของบรรทัดข้างล่าง —
 * ตั้งใจให้เป็นแบบนั้น เพราะคำขอที่เป็น `UNDER_REVIEW` โดยไม่มี task ค้าง (ดูหมายเหตุใน
 * backend/src/lib/queue.ts) ไม่ตรงกับโหนดไหนเลย ถ้าเอาผลบวกมาโชว์แทน สภาพข้อมูลแบบนั้น
 * จะถูกกลบเงียบ ๆ แทนที่จะเห็นเป็นตัวเลขที่บวกไม่ลง
 */
function TotalTile({ summary, basePath }: { summary: ListSummary; basePath: string }) {
  const unit = summary.unit;
  const sum = (keep: (n: JourneyNode) => boolean) =>
    summary.nodes.filter(keep).reduce((total, n) => total + n.count, 0);

  const atOrganization = sum((n) => n.roleCode !== null && isOrganizationScopedRole(n.roleCode));
  const closed = sum((n) => n.lane === "closed");

  const count = summary.total.toLocaleString("th-TH");
  const notes = [
    `อยู่ในการดำเนินโดยหน่วยงาน ${atOrganization.toLocaleString("th-TH")} ${unit}`,
    closed > 0 ? `ไม่อนุมัติหรือยกเลิก ${closed.toLocaleString("th-TH")} ${unit}` : null,
  ].filter((line): line is string => line !== null);

  return (
    <Link
      href={`${basePath}?tab=all`}
      aria-label={[`ทั้งหมด ${count} ${unit}`, `${unit}ทั้งหมดในระบบรวมถึงแบบร่าง`, ...notes].join(
        " · ",
      )}
      className={clsx(tileClass, "bg-white shadow-card ring-line hover:ring-navy-300")}
    >
      <p className="text-[11px] font-medium leading-tight text-ink-subtle">ทั้งหมด</p>
      <p className="text-[13px] leading-snug text-ink-muted">{`${unit}ทั้งหมดในระบบรวมถึงแบบร่าง`}</p>
      <p className="mt-1 text-[28px] font-semibold leading-tight tabular-nums text-navy-800">
        {count}
      </p>
      {notes.map((line) => (
        <p key={line} className="mt-0.5 text-[12px] leading-snug text-ink-subtle">
          {line}
        </p>
      ))}
    </Link>
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
 * ของแผนภาพ เพราะกดกล่องแล้วไปเจอแถวที่ badge เขียนคำนั้น ยกเว้นปลายทางที่อยู่ใน
 * `TERMINAL_LABELS` ซึ่งหน้าแรกตั้งใจเรียกด้วยคำของตัวเอง — ดูเหตุผลที่หัวตารางนั้น
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
  const label = TERMINAL_LABELS[node.key] ?? node.waitingLabel ?? node.label;
  const count = node.count.toLocaleString("th-TH");
  const tab = node.mine ? "mine" : "all";

  return (
    <Link
      href={`${basePath}?tab=${tab}&stage=${node.key}`}
      aria-label={[label, `จำนวน ${count} รายการ`, node.mine ? "รอคุณดำเนินการ" : null]
        .filter(Boolean)
        .join(" · ")}
      className={clsx(
        tileClass,
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
