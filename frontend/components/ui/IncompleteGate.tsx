"use client";

import clsx from "clsx";
import { useEffect, useId, useRef, useState } from "react";

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

/** ระยะห่างระหว่างปุ่มกับกล่อง — ค่าเดียวกับ `GAP` ใน components/list/RowDetailCard.tsx */
const GAP = 8;

/** ยึดจากขอบบนหรือขอบล่างของ viewport อย่างใดอย่างหนึ่ง ไม่ใช่ทั้งคู่ */
type Placement = { left: number; top: number } | { left: number; bottom: number };

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
 *
 * **ทำไม `fixed` แล้ววัดตำแหน่งเอง ไม่ใช่ `absolute top-full`:** การ์ดขอให้กล่องไปอยู่ *ใต้* ปุ่ม
 * แต่แถบปุ่มเป็น `sticky bottom-0` ระหว่างที่ผู้ใช้อยู่กลางฟอร์มมันจึงถูกตรึงติดขอบล่างของ viewport
 * โดยไม่มีที่ว่างใต้มันเลย กล่องที่วางด้วย `top-full` ตรงนั้นจะไปอยู่ใต้ขอบจอ และ **เลื่อนลงไปดูไม่ได้
 * ด้วย** เพราะระยะที่ sticky เลื่อนไม่นับเป็นพื้นที่ scroll — hover กับบรรทัดสรุปจะกลายเป็นกดแล้วไม่มี
 * อะไรเกิดขึ้น อีกข้อคือกล่องนี้อยู่ใน DOM เสมอ (ดูย่อหน้าบน) กล่องแบบ `absolute` ที่ห้อยลงล่างจึง
 * เพิ่มพื้นที่ scroll เปล่า ๆ ท้ายหน้าทั้งสองฟอร์มตลอดเวลา แม้ตอนปิดอยู่ ส่วน `fixed` ไม่นับเป็นพื้นที่
 * scroll เลย จึงไม่มีปัญหานั้น
 *
 * วิธีนี้ลอกมาจาก `components/list/RowDetailCard.tsx` ซึ่งเป็นกล่องลอยตัวเดียวในโปรเจกต์ที่หลบขอบจอ
 * อยู่แล้ว — `fixed` + วัด `DOMRect` ของตัวยึด หนีบซ้ายขวาไม่ให้ล้น และพลิกขึ้นบนเมื่อข้างล่างไม่พอ
 * (โปรเจกต์นี้ไม่มีไลบรารีจัดตำแหน่งและไม่ใช้ portal ที่ไหนเลย) ข้อแลกเปลี่ยนเหมือนกัน: ถ้าวันหลัง
 * มีใครใส่ `transform`/`filter`/`will-change`/`contain` ให้ ancestor ตัวไหน `fixed` จะยึดกับตัวนั้น
 * แทน viewport แล้วกล่องจะเพี้ยนแบบเงียบ ๆ วันนี้ไล่ตั้งแต่ `body` ถึงแถบปุ่มแล้วไม่มี
 */
export function IncompleteGate({ items, actionLabel, hintId, children }: IncompleteGateProps) {
  const [open, setOpen] = useState(false);
  const summaryId = useId();
  const anchorRef = useRef<HTMLSpanElement>(null);
  const panelRef = useRef<HTMLSpanElement>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);

  /**
   * วัดใหม่ทุกครั้งที่เปิด และระหว่างเปิดก็วัดซ้ำตอน scroll หรือย่อขยายจอ
   *
   * `RowDetailCard` เลือก *ปิด* กล่องตอน scroll เพราะ rect ที่มันจับไว้จะเก่า แต่ที่นี่ตัวยึดอยู่ใน
   * แถบ sticky การเลื่อนลงไปสุดหน้าคือจังหวะที่ข้างล่างเพิ่งจะมีที่ว่างพอดี กล่องจึงควรพลิกลงล่าง
   * ตามที่การ์ดขอ ไม่ใช่หายไป · ใช้ capture เพราะ scroll ของ element ไม่ bubble
   */
  useEffect(() => {
    if (!open) return;

    const place = () => {
      const anchor = anchorRef.current;
      const panel = panelRef.current;
      if (!anchor || !panel) return;

      const rect = anchor.getBoundingClientRect();
      const { offsetWidth: width, offsetHeight: height } = panel;
      // ชิดขวาให้ตรงกับขอบขวาของปุ่ม แล้วหนีบไม่ให้ล้นจอทั้งสองข้าง
      const left = Math.min(Math.max(GAP, rect.right - width), window.innerWidth - width - GAP);
      const below = rect.bottom + GAP;

      setPlacement(
        below + height <= window.innerHeight - GAP
          ? { left, top: below }
          : { left, bottom: window.innerHeight - rect.top + GAP },
      );
    };

    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, items.length]);

  // ฟอร์มที่กรอกครบแล้วไม่ต้องมีอะไรมาครอบ ปุ่มกลับไปเป็นปุ่มธรรมดา
  if (items.length === 0) return <>{children}</>;

  return (
    <>
      {/*
        `order-first` ไม่ใช่การวางไว้ต้นสุดใน DOM — ตัวครอบปุ่มต้องอยู่ติดกับปุ่มจริง ๆ เพื่อให้
        วัดตำแหน่งจากปุ่มได้ บรรทัดนี้จึงถูกย้ายด้วย CSS ให้ไปอยู่ซ้ายสุด (บนสุดเมื่อจอแคบ)
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

      {/* ไม่ต้อง `relative` แล้ว กล่องยึดกับ viewport ไม่ได้ยึดกับตัวครอบ — มีไว้รับเมาส์กับให้ rect วัด */}
      <span
        ref={anchorRef}
        className="inline-flex"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
      >
        {/*
          `placement` ยังเป็น null แปลว่ายังไม่ได้วัด — กล่องจะอยู่ที่ตำแหน่ง static ของมัน จึงค่อย
          เปลี่ยนเป็นทึบหลังวัดเสร็จ ไม่งั้นจะเห็นมันแวบอยู่ผิดที่หนึ่งเฟรม · ตอนปิดไม่ล้าง
          `placement` ทิ้ง กล่องจะได้จางหายตรงที่เดิม
        */}
        <span
          ref={panelRef}
          id={hintId}
          role="tooltip"
          style={placement ?? undefined}
          className={clsx(
            "fixed z-40 w-[min(22rem,calc(100vw-3rem))] rounded-xl border border-line bg-white p-4 text-left shadow-pop transition-opacity duration-150",
            open && placement ? "opacity-100" : "pointer-events-none opacity-0",
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
