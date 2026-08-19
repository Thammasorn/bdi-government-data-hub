"use client";

import { useEffect, useRef, type ReactNode } from "react";

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  /** กว้างขึ้นสำหรับ modal ที่ต้องฝังเอกสาร PDF ให้อ่านได้จริง ไม่ใช่แค่ข้อความยืนยัน */
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  size?: "md" | "lg";
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    // กันหน้าเลื่อนอยู่ข้างหลัง modal
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.querySelector<HTMLElement>("textarea,input,button")?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center">
      <div
        className="absolute inset-0 bg-navy-900/40 frost-2"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`animate-in-up relative w-full overflow-hidden rounded-2xl bg-white shadow-pop ${
          size === "lg" ? "max-w-3xl" : "max-w-lg"
        }`}
      >
        <div className="bg-brand-gradient h-1" />
        <div className="px-6 pt-5">
          <h2 className="text-lg font-semibold text-navy-800">{title}</h2>
          {description ? <p className="mt-1 text-sm text-ink-muted">{description}</p> : null}
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}
