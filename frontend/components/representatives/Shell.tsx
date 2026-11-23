"use client";

import clsx from "clsx";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { ListPageHeader } from "@/components/list/ListPageHeader";
import { CHANGE_STATUS_META,
  type ChangeStatus, type HeadcountRow } from "@/lib/representatives";

const MENU = [
  { href: "/representatives", label: "รายชื่อผู้แทนหน่วยงาน" },
  { href: "/representatives/requests", label: "ฟอร์มเปลี่ยนแปลงผู้แทนหน่วยงาน" },
];

/**
 * แท็บย่อยของ "ผู้แทนหน่วยงาน" — เดิมเป็นเมนูซ้ายตาม wireframe ซึ่งกินความกว้างไป 15rem
 * จนตารางรายชื่อและตารางคำขอต้องเลื่อนแนวนอน ย้ายขึ้นมาเป็นแท็บใต้หัวหน้าแล้วเนื้อหาจึงได้เต็มความกว้าง
 *
 * ทรงเป็นปุ่มกลุ่ม (segmented) ไม่ใช่เส้นใต้ เพราะหน้าคำขอมีแถบ "ที่ต้องดำเนินการ | ทั้งหมด"
 * (QueueTabs) แบบเส้นใต้อยู่แล้ว สองแถวหน้าตาเดียวกันจะอ่านเหมือนเป็นตัวกรองชั้นเดียวกัน
 */
export function RepresentativeShell({
  title,
  description,
  breadcrumb,
  children,
}: {
  title: string;
  description: string;
  breadcrumb?: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      {breadcrumb ? <div className="mb-5">{breadcrumb}</div> : null}
      <ListPageHeader tone="organization" eyebrow="ผู้แทนหน่วยงาน" title={title} description={description} />
      <nav
        aria-label="เมนูผู้แทนหน่วยงาน"
        className="flex gap-1 rounded-2xl bg-white p-1 ring-1 ring-line sm:inline-flex"
      >
        {MENU.map((item) => {
          const active =
            item.href === "/representatives" ? pathname === item.href : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={clsx(
                "flex-1 rounded-xl px-4 py-2.5 text-center text-sm font-medium transition-colors sm:flex-none",
                active ? "bg-navy-800 text-white" : "text-navy-800 hover:bg-navy-50",
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="mt-6 min-w-0">{children}</div>
    </div>
  );
}

export function ChangeStatusBadge({ status }: { status: ChangeStatus }) {
  const meta = CHANGE_STATUS_META[status];
  return (
    <span
      className={clsx(
        "inline-flex items-start gap-1.5 rounded-2xl px-3 py-1 text-[13px] font-medium leading-snug",
        meta.className,
      )}
    >
      <span className="mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-70" aria-hidden="true" />
      <span>{meta.label}</span>
    </span>
  );
}

/** ตารางจำนวนก่อน/หลัง — แถวที่ไม่อยู่ในช่วงมีข้อความบอก ไม่ได้บอกด้วยสีอย่างเดียว */
export function HeadcountTable({ rows }: { rows: HeadcountRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[32rem] text-sm">
        <thead>
          <tr className="border-b border-line text-left text-ink-muted">
            <th className="py-2 pr-3 font-medium">บทบาท</th>
            <th className="px-3 py-2 text-right font-medium">ปัจจุบัน</th>
            <th className="px-3 py-2 text-right font-medium">ยกเลิก</th>
            <th className="px-3 py-2 text-right font-medium">เพิ่ม</th>
            <th className="px-3 py-2 text-right font-medium">หลังดำเนินการ</th>
            <th className="py-2 pl-3 text-right font-medium">ขั้นต่ำ–สูงสุด</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.roleCode} className={clsx("border-b border-line last:border-0", row.problem && "text-danger")}>
              <td className="py-2 pr-3">
                {row.roleLabel}
                {row.problem ? <p className="text-[13px]">{row.problem}</p> : null}
                {row.notice ? <p className="text-[13px] text-warning">{row.notice}</p> : null}
              </td>
              <td className="px-3 py-2 text-right">{row.current}</td>
              <td className="px-3 py-2 text-right">{row.removed ? `−${row.removed}` : 0}</td>
              <td className="px-3 py-2 text-right">{row.added ? `+${row.added}` : 0}</td>
              <td className="px-3 py-2 text-right font-semibold">{row.after}</td>
              <td className="py-2 pl-3 text-right">
                {row.min}–{row.max}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
