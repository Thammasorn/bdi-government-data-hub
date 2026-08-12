"use client";

import clsx from "clsx";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { Logo } from "@/components/brand/Logo";
import { NotificationBell } from "@/components/NotificationBell";
import { useSession } from "@/components/SessionProvider";
import { api } from "@/lib/api";
import { ROLE_LABELS, isBdiStaff } from "@/lib/status";

/** หน้าที่ไม่ต้องมี header/footer — เต็มจอเพื่อให้โฟกัสกับงานตรงหน้า */
const BARE_ROUTES = ["/login", "/register"];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { user, loading } = useSession();

  if (BARE_ROUTES.some((r) => pathname.startsWith(r))) {
    return <>{children}</>;
  }
  // หน้าแรกของผู้ที่ยังไม่ล็อกอินคือหน้าแนะนำระบบ ซึ่งมี sidebar และ footer ของตัวเอง
  // ครอบด้วย header/footer ของแอปอีกชั้นจะได้เมนูสองชุดซ้อนกัน
  if (pathname === "/" && !loading && !user) {
    return <>{children}</>;
  }
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}

function navItems(roles: string[], organizationId: string | null) {
  const hasOrganization = Boolean(organizationId);
  if (isBdiStaff(roles)) {
    // ผู้เชี่ยวชาญมีบทบาทเฉพาะเส้นทางชุดข้อมูล จึงไม่ต้องเห็นเมนูหน่วยงาน
    const specialistOnly =
      roles.includes("BDI_DATASET_SPECIALIST") &&
      !roles.includes("BDI_OFFICER") &&
      !roles.includes("BDI_FINAL_APPROVER");
    if (specialistOnly) return [{ href: "/admin/datasets", label: "ชุดข้อมูลที่ได้รับมอบหมาย" }];

    const items = [
      { href: "/admin/organizations", label: "หน่วยงาน" },
      { href: "/admin/datasets", label: "ชุดข้อมูล" },
    ];
    if (roles.includes("BDI_FINAL_APPROVER")) {
      // ด่าน "รอลงนาม" ไม่ใช่สถานะอีกแล้ว แต่เป็น task_type ที่ค้างอยู่ ซึ่งหน้ารายการ
      // ยังกรองไม่ได้ — ลิงก์นี้จึงพาไปที่คำขอที่ยังเดินอยู่ทั้งหมด แล้วให้ badge
      // ในตารางบอกต่อว่าใบไหนค้างที่ด่านไหน
      items.push({ href: "/admin/organizations?status=SUBMITTED,UNDER_REVIEW", label: "คำขอที่ต้องพิจารณา" });
    }
    return items;
  }
  // ผู้มีอำนาจกระทำการแทนที่ถูกเชิญเข้ามาทีหลังยังไม่ถูกผูก organizationId
  // แต่ต้องเข้าหน้าแรกและหน้าชุดข้อมูลได้ เพราะเป็นผู้พิจารณาด่านที่ 2 ของเส้นทาง C
  if (roles.includes("ORGANIZATION_APPROVER") && !hasOrganization) {
    return [
      { href: "/", label: "หน้าแรก" },
      { href: "/datasets", label: "ชุดข้อมูล" },
    ];
  }

  // สเปก: ผู้ใช้ที่ยังไม่มีหน่วยงานเห็นได้แค่ปุ่มสร้างหน่วยงานกลางจอ ไม่มีเมนู
  return hasOrganization
    ? [
        { href: "/", label: "หน้าแรก" },
        { href: `/organizations/${organizationId}`, label: "หน่วยงานของฉัน" },
        { href: "/datasets", label: "ชุดข้อมูล" },
      ]
    : [];
}

function Header() {
  const { user } = useSession();
  const pathname = usePathname();
  const items = navItems(user?.roles ?? [], user?.organizationId ?? null);

  return (
    <header className="sticky top-0 z-40 bg-white/85 backdrop-blur-md">
      {/* แถบ gradient ประจำแบรนด์ */}
      <div className="bg-brand-gradient h-[3px]" />
      <div className="border-b border-line">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6">
          <Link href="/" className="shrink-0" aria-label="หน้าแรก Government Datahub">
            <Logo />
          </Link>

          <nav className="hidden flex-1 items-center gap-1 md:flex">
            {items.map((item) => {
              const active = pathname === item.href.split("?")[0];
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={clsx(
                    "rounded-full px-3.5 py-2 text-sm font-medium transition-colors",
                    active ? "bg-navy-50 text-navy-800" : "text-ink-muted hover:bg-navy-50/70 hover:text-navy-700",
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-1">
            {user ? <NotificationBell /> : null}
            {user ? <UserMenu /> : <SignInLink />}
          </div>
        </div>
      </div>
    </header>
  );
}

function SignInLink() {
  return (
    <Link
      href="/login"
      className="rounded-full border border-line px-4 py-2 text-sm font-medium text-navy-800 transition-colors hover:bg-navy-50"
    >
      เข้าสู่ระบบ
    </Link>
  );
}

function UserMenu() {
  const { user, setUser } = useSession();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  if (!user) return null;
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email;
  const initial = (user.firstName ?? user.email)[0]?.toUpperCase() ?? "?";

  const logout = async () => {
    await api.post("/api/auth/logout").catch(() => undefined);
    setUser(null);
    router.push("/login");
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-2.5 rounded-full py-1 pl-1 pr-2.5 transition-colors hover:bg-navy-50"
      >
        <span className="grid h-8 w-8 place-items-center rounded-full bg-navy-800 text-[13px] font-semibold text-white">
          {initial}
        </span>
        <span className="hidden text-sm font-medium text-ink sm:block">{name}</span>
        <svg viewBox="0 0 20 20" className="h-4 w-4 text-ink-subtle" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="m5 8 5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open ? (
        <div
          role="menu"
          className="animate-in-up absolute right-0 mt-2 w-64 overflow-hidden rounded-xl bg-white shadow-pop ring-1 ring-line"
        >
          <div className="border-b border-line px-4 py-3">
            <p className="truncate text-sm font-semibold text-ink">{name}</p>
            <p className="truncate text-[13px] text-ink-muted">{user.email}</p>
            <div className="mt-2 flex flex-wrap gap-1">
              {user.roles.map((r) => (
                <span key={r} className="rounded-full bg-navy-50 px-2 py-0.5 text-[11px] font-medium text-navy-700">
                  {ROLE_LABELS[r] ?? r}
                </span>
              ))}
            </div>
          </div>
          <button
            type="button"
            onClick={logout}
            role="menuitem"
            className="w-full px-4 py-3 text-left text-sm font-medium text-ink transition-colors hover:bg-navy-50"
          >
            ออกจากระบบ
          </button>
        </div>
      ) : null}
    </div>
  );
}

function Footer() {
  return (
    <footer className="border-t border-line bg-white">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-7 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <Logo subtitle={null} />
        <p className="text-[13px] text-ink-muted">
          สถาบันข้อมูลขนาดใหญ่ (องค์การมหาชน) · Big Data Institute
        </p>
      </div>
    </footer>
  );
}
