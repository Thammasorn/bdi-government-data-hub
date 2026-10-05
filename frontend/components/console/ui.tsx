"use client";

import clsx from "clsx";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

import { ListSearch } from "@/components/list/ListSearch";
import type { AdminErrorView } from "@/lib/admin-errors";
import { useDebounced } from "@/lib/use-admin";

/**
 * ชิ้นส่วนเล็ก ๆ ที่ทุกหน้าของ /console ใช้ร่วมกัน — หัวหน้า ป้าย รายการคู่ชื่อ-ค่า แท็บ กล่องข้อผิดพลาด
 *
 * สีและทรงมาจาก token เดียวกับหน้าอื่นของระบบ (app/globals.css) ส่วนที่ต่างคือความหนาแน่น: หน้านี้คนเปิดทั้งวันเพื่อหา
 * แล้วแก้ จึงใช้ตารางแน่นกว่าและตัวหนังสือเล็กกว่าหน้าของหน่วยงานหนึ่งขั้น
 */

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  back,
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
}) {
  return (
    <header className="mb-6">
      {back ? (
        <Link
          href={back.href}
          className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-navy-600 hover:text-navy-800"
        >
          <svg
            viewBox="0 0 16 16"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            aria-hidden="true"
          >
            <path d="m10 3-5 5 5 5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {back.label}
        </Link>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          {eyebrow ? (
            <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-coral-500">{eyebrow}</p>
          ) : null}
          <h1 className="mt-0.5 text-2xl font-semibold text-navy-800">{title}</h1>
          {description ? <p className="mt-1 max-w-3xl text-[15px] text-ink-muted">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}

/**
 * ลิงก์ที่หน้าตาเป็นปุ่ม — `<Link><Button/></Link>` ซ้อนองค์ประกอบที่กดได้สองชั้น ซึ่งโปรแกรมอ่านจอประกาศสองครั้งและคีย์บอร์ด
 * ต้อง Tab ผ่านสองครั้ง สีกับขนาดเท่า `Button` size sm
 */
export function ButtonLink({
  href,
  children,
  variant = "primary",
}: {
  href: string;
  children: ReactNode;
  variant?: "primary" | "secondary";
}) {
  return (
    <Link
      href={href}
      className={clsx(
        "inline-flex h-9 items-center justify-center gap-2 rounded-full px-4 text-sm font-medium transition-colors",
        variant === "primary"
          ? "bg-coral-500 text-white shadow-sm hover:bg-coral-600"
          : "border border-line bg-white text-navy-800 hover:bg-navy-50",
      )}
    >
      {children}
    </Link>
  );
}

/** ป้ายสถานะ — รับ meta ของ `*_STATUS_META` ตัวไหนก็ได้ (ป้ายกับสี) */
export function Badge({ meta, className }: { meta: { label: string; className: string }; className?: string }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12.5px] font-medium",
        meta.className,
        className,
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" aria-hidden="true" />
      {meta.label}
    </span>
  );
}

/** ป้ายจาง ๆ สำหรับข้อความกำกับ (บทบาท รหัส) — ไม่ใช่สถานะ จึงไม่มีจุด */
export function Tag({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-md bg-navy-50 px-2 py-0.5 text-[12.5px] font-medium text-navy-700",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Panel({
  title,
  description,
  actions,
  children,
  className,
  flush,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  /** เนื้อในชิดขอบ (ตาราง) ไม่มี padding */
  flush?: boolean;
}) {
  return (
    <section className={clsx("rounded-2xl bg-white shadow-card ring-1 ring-line", className)}>
      {title || actions ? (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4 sm:flex-nowrap">
          <div className="min-w-0 flex-1">
            {title ? <h2 className="text-[16px] font-semibold text-navy-800">{title}</h2> : null}
            {description ? <p className="mt-0.5 text-[13.5px] text-ink-muted">{description}</p> : null}
          </div>
          {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      <div className={flush ? undefined : "p-5"}>{children}</div>
    </section>
  );
}

/** รายการชื่อ-ค่า สองคอลัมน์บนจอกว้าง — ค่าว่างแสดงขีดจาง ไม่ใช่ช่องโหว่ */
export function DetailList({ items }: { items: Array<{ label: string; value: ReactNode; wide?: boolean }> }) {
  return (
    <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.label} className={clsx("min-w-0", item.wide && "sm:col-span-2")}>
          <dt className="text-[12.5px] font-medium text-ink-subtle">{item.label}</dt>
          <dd className="mt-0.5 break-words text-[15px] text-ink">
            {item.value === null || item.value === undefined || item.value === "" ? (
              <span className="text-ink-subtle">—</span>
            ) : (
              item.value
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function Tabs<K extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: Array<{ key: K; label: string; count?: number }>;
  active: K;
  onChange: (key: K) => void;
}) {
  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map((t) => (
        <button
          key={t.key}
          role="tab"
          type="button"
          aria-selected={active === t.key}
          onClick={() => onChange(t.key)}
          className={clsx(
            "-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-[14.5px] font-medium transition-colors",
            active === t.key
              ? "border-coral-500 text-navy-800"
              : "border-transparent text-ink-muted hover:text-navy-700",
          )}
        >
          {t.label}
          {t.count !== undefined ? (
            <span className="ml-1.5 rounded-full bg-navy-50 px-1.5 py-px text-[12px] tabular-nums text-ink-muted">
              {t.count}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

/** กล่องข้อผิดพลาดของคำสั่ง — หัวข้อ ข้อความของ backend และลิงก์ไปสิ่งที่ขวางอยู่ (lib/admin-errors.ts) */
export function ErrorNotice({
  view,
  className,
  hideFields = [],
}: {
  view: AdminErrorView;
  className?: string;
  /** ช่องที่หน้านั้นแสดงข้อความไว้ใต้ช่องอยู่แล้ว */
  hideFields?: string[];
}) {
  const fieldMessages = [
    ...new Set(Object.entries(view.fields).filter(([k]) => !hideFields.includes(k)).map(([, m]) => m)),
  ];
  return (
    <div role="alert" className={clsx("rounded-xl bg-danger-bg px-4 py-3 text-[14px]", className)}>
      <p className="font-semibold text-danger">{view.title}</p>
      {fieldMessages.length > 0 ? (
        // 400 `validation` มีข้อความต่อช่องและ `message` เป็นค่าตั้งต้นที่ไม่บอกอะไร — แสดงข้อความของแต่ละช่องแทน
        // หน้าที่ผูกข้อความไว้ใต้ช่องเองส่ง `hideFields` มา ไม่งั้นข้อความเดียวกันขึ้นสองที่
        <ul className="mt-0.5 list-disc pl-5 text-ink">
          {fieldMessages.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-0.5 text-ink">{view.message}</p>
      )}
      {view.next ? (
        <Link href={view.next.href} className="mt-1.5 inline-block font-medium text-navy-700 underline">
          {view.next.label} →
        </Link>
      ) : null}
    </div>
  );
}

/** กล่องเตือนสีเหลือง — `warnings` ที่ API แนบมากับคำตอบที่สำเร็จ */
export function WarningList({ warnings, className }: { warnings: string[]; className?: string }) {
  if (warnings.length === 0) return null;
  return (
    <div className={clsx("rounded-xl bg-warning-bg px-4 py-3 text-[14px] text-ink", className)}>
      <ul className="list-disc space-y-1 pl-5">
        {warnings.map((w) => (
          <li key={w}>{w}</li>
        ))}
      </ul>
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="px-6 py-14 text-center">
      <p className="font-medium text-navy-800">{title}</p>
      {children ? <div className="mt-1 text-sm text-ink-muted">{children}</div> : null}
    </div>
  );
}

/**
 * ช่องค้นหาที่เขียน URL หลังหยุดพิมพ์ — ค่าเริ่มจาก URL เมื่อเปิดหน้าหรือกดย้อนกลับ
 *
 * ไม่ส่งค่าเดิมกลับไปที่ URL ตอนเปิดหน้า ไม่งั้นการ "เปลี่ยนตัวกรอง" ที่ไม่ได้เปลี่ยนอะไรจะลบเลขหน้าทิ้ง
 */
export function SearchBox({
  value,
  onCommit,
  placeholder,
  action,
}: {
  value: string;
  onCommit: (v: string) => void;
  placeholder: string;
  action?: ReactNode;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  useDebounced(text, (v) => {
    if (v.trim() !== value) onCommit(v.trim());
  });
  return <ListSearch value={text} onChange={setText} placeholder={placeholder} action={action} />;
}

/** select เล็กในแถวตัวกรอง — ทรงเดียวกับช่องค้นหา */
export function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="relative inline-flex">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 appearance-none rounded-full border border-line bg-white pl-4 pr-10 text-[14.5px] text-ink transition-[border-color,box-shadow] focus:border-navy-500 focus:shadow-[0_0_0_3px_var(--color-navy-100)]"
      >
        <option value="">{label}: ทั้งหมด</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <svg
        viewBox="0 0 20 20"
        className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        aria-hidden="true"
      >
        <path d="m5 8 5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </label>
  );
}
