"use client";

import clsx from "clsx";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { Logo } from "@/components/brand/Logo";
import { NotificationBell } from "@/components/NotificationBell";
import { SessionChangedDialog } from "@/components/SessionChangedDialog";
import { announceSignOut, sessionUserName, useSession } from "@/components/SessionProvider";
import { api } from "@/lib/api";
import { ROLE_LABELS, isBdiStaff, isSpecialistOnly } from "@/lib/status";

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
      {/* ตัวตนของเบราว์เซอร์เปลี่ยนไประหว่างที่แท็บนี้เปิดค้าง — ต้องขวางไว้ ไม่ใช่แค่บอก */}
      <SessionChangedDialog />
    </div>
  );
}

/** เมนูหนึ่งช่อง — `disabledReason` ไม่ null = เห็นได้แต่กดไม่ได้ พร้อมเหตุผล */
interface NavItem {
  href: string;
  label: string;
  disabledReason?: string;
}

function navItems(
  roles: string[],
  organizationId: string | null,
  organizationStatus: string | null,
): NavItem[] {
  const hasOrganization = Boolean(organizationId);
  if (isBdiStaff(roles)) {
    // ผู้เชี่ยวชาญมีบทบาทเฉพาะเส้นทางชุดข้อมูล จึงไม่ต้องเห็นเมนูหน่วยงาน
    // (กติกาเดียวกับ bdiLandingPath ที่ตัดสินว่าเข้าสู่ระบบแล้วไปหน้าไหน)
    // ชื่อเมนูเดียวกับของคนอื่น — หน้าที่ปลายทางกรองให้เองว่าเห็นอะไรได้บ้าง
    if (isSpecialistOnly(roles)) return [{ href: "/admin/datasets", label: "ชุดข้อมูล" }];

    // เดิมมีเมนูที่สามสำหรับผู้อนุมัติ BDI ที่ลิงก์ไป `?status=SUBMITTED,UNDER_REVIEW`
    // เพราะหน้ารายการกรองตามด่านไม่ได้ ตอนนี้กรองได้แล้ว และทั้งสองหน้าเปิดมาที่แท็บ
    // "ที่ต้องดำเนินการ" ของตำแหน่งผู้ใช้เองอยู่แล้ว เมนูนั้นจึงพาไปที่เดิมกับเมนูแรก
    return [
      { href: "/admin/organizations", label: "หน่วยงาน" },
      { href: "/admin/datasets", label: "ชุดข้อมูล" },
    ];
  }
  // ผู้มีอำนาจกระทำการแทนที่ถูกเชิญเข้ามาทีหลังยังไม่ถูกผูก organizationId
  // แต่ต้องเข้าหน้าแรกและหน้าชุดข้อมูลได้ เพราะเป็นผู้พิจารณาด่านที่ 2 ของเส้นทาง C
  if (roles.includes("ORGANIZATION_APPROVER") && !hasOrganization) {
    return [
      { href: "/", label: "หน้าแรก" },
      { href: "/datasets", label: "ชุดข้อมูล" },
    ];
  }

  /**
   * ชุดข้อมูลนำส่งได้ต่อเมื่อหน่วยงานเปิดใช้งานแล้ว
   *
   * `organizationId` มีค่าตั้งแต่เปิดคำขอลงทะเบียนใบแรก (หน่วยงานถูกสร้างเป็น
   * PENDING_REGISTRATION รอผลอนุมัติ) เมนูจึงโผล่มาให้กดตั้งแต่ยังลงทะเบียนไม่เสร็จ
   * แล้วพาไปหน้าที่ทำอะไรไม่ได้ — ทางที่ตรงกว่าคือให้เห็นว่ามีเมนูนี้อยู่ แต่ยังกดไม่ได้
   * และบอกว่าทำไม
   */
  const datasetsLocked = organizationStatus !== "ACTIVE";

  // สเปก: ผู้ใช้ที่ยังไม่มีหน่วยงานเห็นได้แค่ปุ่มสร้างหน่วยงานกลางจอ ไม่มีเมนู
  return hasOrganization
    ? [
        { href: "/", label: "หน้าแรก" },
        { href: `/organizations/${organizationId}`, label: "หน่วยงานของฉัน" },
        {
          href: "/datasets",
          label: "ชุดข้อมูล",
          ...(datasetsLocked
            ? { disabledReason: "ใช้งานได้เมื่อหน่วยงานของคุณได้รับอนุมัติแล้ว" }
            : {}),
        },
      ]
    : [];
}

function Header() {
  const { user } = useSession();
  const pathname = usePathname();
  const items = navItems(
    user?.roles ?? [],
    user?.organizationId ?? null,
    user?.organization?.status ?? null,
  );

  return (
    <header className="sticky top-0 z-40 bg-white/85 frost-12">
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
              if (item.disabledReason) {
                return (
                  <span
                    key={item.href}
                    aria-disabled="true"
                    title={item.disabledReason}
                    className="cursor-not-allowed rounded-full px-3.5 py-2 text-sm font-medium text-ink-subtle"
                  >
                    {item.label}
                    <span className="sr-only"> — {item.disabledReason}</span>
                  </span>
                );
              }
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
  const { user } = useSession();
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
  const name = sessionUserName(user);

  /**
   * ออกจากระบบแล้วต้องจบที่ `/login` เปล่า ๆ — ไม่ใช่ `/login?next=<หน้าที่เพิ่งอยู่>`
   *
   * เดิมที่นี่ทำ setUser(null) แล้ว router.push("/login") ซึ่งแพ้การแข่งกับตัวเอง:
   * setUser(null) ทำให้หน้าที่ยังค้างอยู่ re-render, useRequireAuth ของหน้านั้นเห็นว่า
   * ไม่มี user จึง router.replace("/login?next=<หน้านั้น>") ทับ push ที่เพิ่งทำไป
   * ผลคือ ?next= ค้างบน URL ข้ามไปถึงการล็อกอินครั้งถัดไป แล้วหน้า login ก็พาไปตามนั้น
   * โดยไม่ดู role — คนละบัญชีที่ล็อกอินต่อบนเบราว์เซอร์เดียวกันจึงไปโผล่หน้าที่ไม่มีสิทธิ
   *
   * โหลดหน้าใหม่ทั้งหน้าแทน: ไม่มี state เปลี่ยน ก็ไม่มี effect ไหนมาเขียน URL ทับ —
   * ตัดการแข่งขันทิ้ง ไม่ใช่พยายามชนะมัน และ replace ยังไม่ทิ้งหน้าเดิมไว้ใน history
   * ปุ่ม Back หลังออกจากระบบจึงไม่เด้งกลับเข้าหน้าที่ต้องล็อกอินอีก
   *
   * แลกมาด้วยการต้องประกาศให้แท็บอื่นเองด้วย เพราะ effect ที่เคยทำให้ตอน user เปลี่ยน
   * จะไม่ได้ทำงานแล้ว
   */
  const logout = async () => {
    await api.post("/api/auth/logout").catch(() => undefined);
    announceSignOut();
    window.location.replace("/login");
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-2 rounded-full px-3 py-2 transition-colors hover:bg-navy-50"
      >
        <span className="text-sm font-medium text-ink">{name}</span>
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
