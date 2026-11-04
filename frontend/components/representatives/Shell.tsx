"use client";

import clsx from "clsx";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { ListPageHeader } from "@/components/list/ListPageHeader";
import { changeStatusTone, CHANGE_STATUS_LABELS, type ChangeStatus, type HeadcountRow } from "@/lib/representatives";

const MENU = [
  { href: "/representatives", label: "รายชื่อผู้แทนหน่วยงาน" },
  { href: "/representatives/requests", label: "ฟอร์มเปลี่ยนแปลงผู้แทนหน่วยงาน" },
];

/** เมนูซ้ายของ "ผู้แทนหน่วยงาน" ตาม wireframe */
export function RepresentativeShell({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <ListPageHeader tone="organization" eyebrow="ผู้แทนหน่วยงาน" title={title} description={description} />
      <div className="mt-6 grid gap-6 md:grid-cols-[15rem_1fr]">
        <nav aria-label="เมนูผู้แทนหน่วยงาน" className="flex flex-col gap-2">
          {MENU.map((item) => {
            const active =
              item.href === "/representatives" ? pathname === item.href : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={clsx(
                  "rounded-xl px-4 py-3 text-sm font-medium ring-1 ring-line",
                  active ? "bg-navy-800 text-white" : "bg-white text-navy-800 hover:bg-navy-50",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}

export function ChangeStatusBadge({ status }: { status: ChangeStatus }) {
  return (
    <span className={clsx("inline-flex rounded-full px-3 py-1 text-[13px] font-medium", changeStatusTone(status))}>
      {CHANGE_STATUS_LABELS[status]}
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
