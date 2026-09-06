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

  /**
   * กล่องสูงเกินจอไม่ได้ และเนื้อในต้องเลื่อนได้
   *
   * เดิมกล่องไม่มีเพดานความสูงเลย มีแต่ `overflow-hidden` ที่ใส่ไว้ให้มุมมน ผลคือบนจอเตี้ย
   * (โน้ตบุ๊ก Windows ทั่วไปเหลือพื้นที่ราว 600–700px หลังหักแถบเบราว์เซอร์กับ taskbar)
   * กล่องอ่านเอกสารสูงกว่าจอ แล้วส่วนที่เกิน — ช่องติ๊กกับปุ่ม "เห็นชอบ" — ถูกตัดทิ้ง
   * ไม่ใช่แค่มองไม่เห็น แต่เลื่อนไปหาไม่ได้เลย เพราะไม่มีอะไรในหน้าที่เลื่อนได้
   * (`document.body` ถูกล็อก `overflow: hidden` ไว้ตอนเปิด modal) — Feedback 20260904 #2
   *
   * แก้เป็น flex column: แถบหัวอยู่กับที่ ส่วนเนื้อในเลื่อนได้ และทั้งกล่องสูงไม่เกินจอ
   * ตัว PdfViewer ก็ถูกจำกัดความสูงตามพื้นที่จริงด้วย (ดู PdfViewer.tsx) เพื่อให้ปุ่ม
   * โผล่พ้นขอบล่างโดยไม่ต้องเลื่อนผ่านตัวอ่าน PDF ซึ่งกินการหมุนล้อของเมาส์ไปเอง
   */
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
        className={`animate-in-up relative flex max-h-[calc(100vh_-_2rem)] w-full flex-col overflow-hidden rounded-2xl bg-white shadow-pop ${
          size === "lg" ? "max-w-3xl" : "max-w-lg"
        }`}
      >
        <div className="bg-brand-gradient h-1 shrink-0" />
        <div className="shrink-0 px-6 pt-5">
          <h2 className="text-lg font-semibold text-navy-800">{title}</h2>
          {description ? <p className="mt-1 text-sm text-ink-muted">{description}</p> : null}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-6">{children}</div>
      </div>
    </div>
  );
}
