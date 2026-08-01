import Link from "next/link";
import type { ReactNode } from "react";

import { Logo, LogoMark } from "@/components/brand/Logo";

/**
 * โครงหน้า auth สองคอลัมน์ — ซ้ายเป็นแบรนด์ ขวาเป็นฟอร์ม (docs/02-ui-spec.md §3.1)
 * บนจอเล็กซ่อนคอลัมน์ซ้าย เหลือแต่ฟอร์ม
 */
export function AuthLayout({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <aside className="bg-brand-gradient relative hidden overflow-hidden lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div
          aria-hidden="true"
          className="bg-dot-grid absolute -right-16 -top-16 h-96 w-96 text-white opacity-[0.16]"
        />
        <div
          aria-hidden="true"
          className="bg-dot-grid absolute -bottom-24 -left-10 h-80 w-80 text-white opacity-[0.10]"
        />
        <LogoMark className="relative h-9 w-auto text-white" dotClassName="fill-coral-200" />

        <div className="relative max-w-md">
          <h2 className="text-[32px] font-semibold leading-tight text-white">
            แพลตฟอร์มข้อมูลกลาง
            <br />
            ของหน่วยงานภาครัฐ
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed text-white/75">
            รวบรวม เชื่อมโยง และกำกับดูแลข้อมูลจากหน่วยงานรัฐทั่วประเทศ
            ภายใต้มาตรฐานเดียวกัน โดยสถาบันข้อมูลขนาดใหญ่ (องค์การมหาชน)
          </p>
        </div>

        <p className="relative text-[13px] text-white/55">
          © {new Date().getFullYear()} Big Data Institute
        </p>
      </aside>

      <div className="flex flex-col bg-white">
        <div className="bg-brand-gradient h-[3px] lg:hidden" />
        <div className="flex flex-1 items-center justify-center px-4 py-10 sm:px-8">
          <div className="w-full max-w-[400px]">
            <Link href="/" className="mb-9 inline-block lg:hidden">
              <Logo />
            </Link>

            <h1 className="text-[26px] font-semibold text-navy-800">{title}</h1>
            {description ? (
              <p className="mt-2 text-[15px] leading-relaxed text-ink-muted">{description}</p>
            ) : null}

            <div className="mt-8">{children}</div>

            {footer ? <div className="mt-8 text-sm text-ink-muted">{footer}</div> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
