"use client";

import clsx from "clsx";
import { useId, useState } from "react";

/**
 * รายการเดียวที่ยังต้องแก้ก่อนกดปุ่มได้
 *
 * `message` คือข้อความเดียวกับที่ขึ้นใต้ช่องนั้น ไม่ใช่ข้อความที่เขียนขึ้นใหม่ — ช่องที่พูดอย่างหนึ่ง
 * ใต้ช่องแล้วพูดอีกอย่างในรายการนี้ แย่กว่าไม่มีรายการนี้เลย ส่วน `section` กับ `label` มีไว้บอกว่า
 * ต้องไปแก้ที่ไหน เพราะข้อความอย่าง "กรุณากรอกอีเมล" ตรงกับได้สามช่องในฟอร์มเดียว
 */
export interface IncompleteItem {
  key: string;
  /** ป้ายสั้นของส่วน เช่น "ส่วนที่ 2" */
  section: string;
  /** ป้ายของช่องอย่างที่เขียนอยู่บนฟอร์ม เช่น "เลขบัตรประชาชน" */
  label: string;
  message: string;
}

export interface IncompleteGateProps {
  items: IncompleteItem[];
  /** ป้ายของปุ่มที่ถูกปิด ใช้เขียนหัวข้อของกล่อง — สองฟอร์มเรียกปุ่มนี้คนละชื่อ */
  actionLabel: string;
  /** id ของกล่อง ต้องเป็นค่าเดียวกับ `aria-describedby` ของปุ่มข้างใน */
  hintId: string;
  children: React.ReactNode;
}

/**
 * ปุ่มที่กดไม่ได้ พร้อมรายการว่าต้องไปแก้อะไรบ้าง
 *
 * **ทำไมต้องครอบปุ่มไว้:** `Button` ตั้ง `disabled:pointer-events-none` ปุ่มที่ถูก disable จึงไม่เกิด
 * เหตุการณ์เมาส์เลย — `title` ก็ไม่ขึ้น และ `onMouseEnter` บนตัวปุ่มก็ไม่ทำงาน (การ์ด
 * "Disable ปุ่มตรวจสอบคำขอ ถ้าไม่แนบไฟล์ data dict" เจอข้อนี้มาแล้วจึงเขียนเหตุผลไว้บนหน้าจอแทน)
 * ตัวครอบชั้นนอกยังรับเมาส์ได้ตามปกติ hover จึงต้องอยู่ที่ตัวครอบ ไม่ใช่ที่ปุ่ม
 *
 * **ทำไมยังมีบรรทัดสรุปที่เห็นตลอด:** hover ไม่มีอยู่บนจอสัมผัส และปุ่มที่ถูก disable ก็โฟกัสด้วย
 * คีย์บอร์ดไม่ได้ ถ้าเหลือแต่ hover ผู้ใช้กลุ่มนั้นจะเจอปุ่มที่กดไม่ได้โดยไม่มีคำอธิบายใด ๆ ซึ่งอ่าน
 * ว่าหน้าเว็บพัง บรรทัดสรุปจึงเป็นปุ่มจริงที่กดเปิด/ปิดกล่องเดียวกันได้
 *
 * **ทำไมกล่องอยู่ใน DOM เสมอ:** `aria-describedby` ของปุ่มต้องชี้ไปยัง element ที่มีอยู่จริง กล่องที่
 * ถูกสร้างตอน hover เท่านั้นจึงไม่มีอะไรให้โปรแกรมอ่านหน้าจออ่าน ซ่อนด้วย `opacity-0` ไม่ใช่
 * `hidden`/`invisible` ด้วยเหตุผลเดียวกัน
 */
export function IncompleteGate({ items, actionLabel, hintId, children }: IncompleteGateProps) {
  const [open, setOpen] = useState(false);
  const summaryId = useId();

  // ฟอร์มที่กรอกครบแล้วไม่ต้องมีอะไรมาครอบ ปุ่มกลับไปเป็นปุ่มธรรมดา
  if (items.length === 0) return <>{children}</>;

  return (
    <>
      {/*
        `order-first` ไม่ใช่การวางไว้ต้นสุดใน DOM — ตัวครอบปุ่มต้องอยู่ติดกับปุ่มจริง ๆ เพื่อให้
        กล่องวางตำแหน่งจากปุ่มได้ บรรทัดนี้จึงถูกย้ายด้วย CSS ให้ไปอยู่ซ้ายสุด (บนสุดเมื่อจอแคบ)
      */}
      <button
        type="button"
        id={summaryId}
        aria-expanded={open}
        aria-controls={hintId}
        onClick={() => setOpen((o) => !o)}
        className="order-first inline-flex items-center gap-1.5 self-start rounded-md text-left text-[13px] leading-relaxed text-ink-muted underline decoration-dotted underline-offset-4 hover:text-ink sm:mr-auto sm:self-center"
      >
        ยังกรอกไม่ครบ {items.length} รายการ — ดูว่าต้องแก้อะไรบ้าง
        <svg viewBox="0 0 16 16" className={clsx("h-3.5 w-3.5 shrink-0 transition-transform", open && "rotate-180")} aria-hidden="true">
          <path d="M4 6.5 8 10.5l4-4" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      <span
        className="relative inline-flex"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
      >
        <span
          id={hintId}
          role="tooltip"
          className={clsx(
            "absolute bottom-full right-0 z-10 mb-2 w-[min(22rem,calc(100vw-3rem))] rounded-xl border border-line bg-white p-4 text-left shadow-pop transition-opacity duration-150",
            open ? "opacity-100" : "pointer-events-none opacity-0",
          )}
        >
          <span className="block text-[13px] font-semibold text-navy-800">
            ต้องแก้ {items.length} รายการก่อนกด &ldquo;{actionLabel}&rdquo;
          </span>
          <ul className="mt-2 flex max-h-[min(50vh,18rem)] flex-col gap-1.5 overflow-y-auto text-[13px] leading-relaxed text-ink-muted">
            {items.map((item) => (
              <li key={item.key} className="flex gap-1.5">
                <span aria-hidden="true" className="mt-[0.6em] h-1 w-1 shrink-0 rounded-full bg-coral-500" />
                <span>
                  <span className="font-medium text-ink">
                    {item.section} {item.label}
                  </span>{" "}
                  — {item.message}
                </span>
              </li>
            ))}
          </ul>
        </span>
        {children}
      </span>
    </>
  );
}
