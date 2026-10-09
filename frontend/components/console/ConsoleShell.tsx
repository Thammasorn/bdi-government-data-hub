"use client";

import clsx from "clsx";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { useSession } from "@/components/SessionProvider";
import { Spinner } from "@/components/ui/Spinner";
import { useRequireAuth } from "@/lib/require-auth";
import { isSystemAdmin } from "@/lib/status";

interface Section {
  href: string;
  label: string;
  icon: ReactNode;
}

const icon = (d: string) => (
  <svg viewBox="0 0 20 20" className="h-[18px] w-[18px] shrink-0" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    <path d={d} strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/**
 * เมนูของ /console จัดตามลำดับที่งานเกิดจริง — สร้างหน่วยงานก่อน แล้วจึงมีผู้ใช้ และคำเชิญที่จะกลายเป็นผู้ใช้ (ลำดับที่ BDI
 * ขอเมื่อ 2026-10-09) "คำขอ" คือสิ่งที่หน่วยงานยื่นเข้ามา "ตั้งค่าระบบ" คือสิ่งที่ทุกหน่วยงานเห็นเหมือนกัน
 */
export const CONSOLE_GROUPS: Array<{ title: string | null; items: Section[] }> = [
  {
    title: null,
    items: [{ href: "/console", label: "ภาพรวม", icon: icon("M3 10.5 10 4l7 6.5M5 9v7h4v-4h2v4h4V9") }],
  },
  {
    title: "หน่วยงานและผู้ใช้",
    items: [
      { href: "/console/organizations", label: "หน่วยงาน", icon: icon("M4 17V5l6-2 6 2v12M4 17h12M8 8h1m2 0h1M8 11h1m2 0h1M9 17v-3h2v3") },
      { href: "/console/users", label: "ผู้ใช้", icon: icon("M10 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-6 7c.6-3 3-4.5 6-4.5s5.4 1.5 6 4.5") },
      { href: "/console/invitations", label: "คำเชิญ", icon: icon("M3 5.5h14v9H3zM3 6l7 5 7-5") },
    ],
  },
  {
    title: "คำขอ",
    items: [
      {
        href: "/console/registrations/organizations",
        label: "คำขอลงทะเบียนหน่วยงาน",
        icon: icon("M6 3h6l3 3v11H6zM12 3v3h3M8.5 10h4M8.5 13h4"),
      },
      {
        href: "/console/registrations/datasets",
        label: "คำขอส่งชุดข้อมูล",
        icon: icon("M4 5c0-1.1 2.7-2 6-2s6 .9 6 2-2.7 2-6 2-6-.9-6-2Zm0 0v10c0 1.1 2.7 2 6 2s6-.9 6-2V5M4 10c0 1.1 2.7 2 6 2s6-.9 6-2"),
      },
    ],
  },
  {
    title: "ตั้งค่าระบบ",
    items: [
      { href: "/console/legal-documents", label: "เอกสารข้อตกลง", icon: icon("M5 3h7l3 3v11H5zM8 9h4M8 12h4M8 15h2") },
      { href: "/console/dataset-choices", label: "ตัวเลือกในแบบฟอร์ม", icon: icon("M4 5h2m3 0h7M4 10h2m3 0h7M4 15h2m3 0h7") },
      { href: "/console/public-documents", label: "เอกสารดาวน์โหลด", icon: icon("M10 3v9m-4-4 4 4 4-4M4 15v2h12v-2") },
    ],
  },
];

const ALL_SECTIONS = CONSOLE_GROUPS.flatMap((g) => g.items);

/** เมนูที่ตรงกับ path ที่ยาวที่สุดชนะ — `/console` ต้องไม่ติดสถานะ "อยู่ที่นี่" ไปกับทุกหน้าย่อย */
function activeHref(pathname: string): string | null {
  const matches = ALL_SECTIONS.filter((s) => pathname === s.href || pathname.startsWith(`${s.href}/`));
  return matches.sort((a, b) => b.href.length - a.href.length)[0]?.href ?? null;
}

/**
 * โครงของ /console — เมนูด้านซ้ายบนจอกว้าง แถบเลื่อนข้างบนจอแคบ และประตูของผู้ดูแลระบบ
 *
 * ประตูอยู่ที่นี่ที่เดียว ทุกหน้าใต้ /console จึงไม่ต้องเช็กเอง: ยังไม่ล็อกอิน → `/login?next=…` (useRequireAuth),
 * ล็อกอินแล้วแต่ไม่ใช่ผู้ดูแลระบบ → การ์ดบอกว่าไม่มีสิทธิ์ ไม่ใช่เด้งกลับหน้าแรกเงียบ ๆ ซึ่งอ่านเหมือนลิงก์เสีย
 * ด่านจริงคือ `requireAdmin` ฝั่ง backend — ที่นี่เป็นแค่การไม่วาดหน้าที่ทุกคำขอจะได้ 403
 */
export function ConsoleShell({ children }: { children: ReactNode }) {
  const { ready } = useRequireAuth();
  const { user } = useSession();
  const pathname = usePathname();

  if (!ready || !user) return <Spinner />;
  if (!isSystemAdmin(user.roles)) {
    return (
      <div className="mx-auto max-w-xl px-4 py-20 text-center sm:px-6">
        <h1 className="text-xl font-semibold text-navy-800">หน้านี้สำหรับผู้ดูแลระบบ</h1>
        <p className="mt-2 text-ink-muted">บัญชีของคุณไม่มีบทบาทผู้ดูแลระบบ หากต้องการสิทธิ์ กรุณาติดต่อผู้ดูแลระบบของ BDI</p>
        <Link href="/" className="mt-6 inline-block font-medium text-navy-700 underline">
          กลับหน้าแรก
        </Link>
      </div>
    );
  }

  const current = activeHref(pathname);

  return (
    <div className="mx-auto flex max-w-6xl gap-8 px-4 py-8 sm:px-6 lg:py-10">
      <aside className="hidden w-56 shrink-0 lg:block">
        <nav aria-label="เมนูผู้ดูแลระบบ" className="sticky top-28 space-y-5">
          {CONSOLE_GROUPS.map((group) => (
            <div key={group.title ?? "top"}>
              {group.title ? (
                <p className="mb-1.5 px-3 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">
                  {group.title}
                </p>
              ) : null}
              <ul className="space-y-0.5">
                {group.items.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={current === item.href ? "page" : undefined}
                      className={clsx(
                        "flex items-center gap-2.5 rounded-xl px-3 py-2 text-[14.5px] transition-colors",
                        current === item.href
                          ? "bg-navy-800 font-medium text-white"
                          : "text-ink-muted hover:bg-navy-50 hover:text-navy-800",
                      )}
                    >
                      {item.icon}
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </aside>

      <div className="min-w-0 flex-1">
        {/* จอแคบ: เมนูเดียวกันเป็นแถบเลื่อนข้าง — กดได้ทุกหน้า ไม่ต้องย้อนกลับไปหน้าภาพรวมก่อน */}
        <nav aria-label="เมนูผู้ดูแลระบบ" className="-mx-4 mb-6 overflow-x-auto px-4 lg:hidden">
          <ul className="flex gap-1.5">
            {ALL_SECTIONS.map((item) => (
              <li key={item.href} className="shrink-0">
                <Link
                  href={item.href}
                  aria-current={current === item.href ? "page" : undefined}
                  className={clsx(
                    "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-1.5 text-[13.5px] ring-1 transition-colors",
                    current === item.href
                      ? "bg-navy-800 font-medium text-white ring-navy-800"
                      : "bg-white text-ink-muted ring-line hover:text-navy-800",
                  )}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        {children}
      </div>
    </div>
  );
}
