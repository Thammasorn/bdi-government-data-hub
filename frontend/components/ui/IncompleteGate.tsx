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
  /**
   * ปุ่มอื่นในแถบเดียวกันที่ไม่เกี่ยวกับการตรวจ (วันนี้คือ "บันทึกแบบร่าง" ของทั้งสองฟอร์ม)
   *
   * รับเข้ามาแทนที่จะให้หน้าวางเองข้าง ๆ เพราะกล่องต้องไปอยู่ *ใต้ทั้งแถบ* ไม่ใช่ใต้ปุ่มเดียว
   * ตัวคอมโพเนนต์จึงต้องเป็นเจ้าของแถวนั้นทั้งแถว
   */
  secondaryAction?: React.ReactNode;
  children: React.ReactNode;
}

/** หน่วงก่อนปิดตอนเมาส์ออก — ให้เมาส์เดินจากปุ่มลงไปถึงกล่องได้โดยกล่องไม่ปิดเสียก่อน */
const CLOSE_DELAY = 120;

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
 * ถูกสร้างตอน hover เท่านั้นจึงไม่มีอะไรให้โปรแกรมอ่านหน้าจออ่าน ย่อด้วย `grid-rows-[0fr]` +
 * `opacity-0` ไม่ใช่ `hidden`/`invisible` ด้วยเหตุผลเดียวกัน (และได้อนิเมชันย่อ/ขยายมาด้วย)
 *
 * **ทำไมกล่องอยู่ใน flow ของแถบปุ่ม ไม่ใช่กล่องลอย `fixed`:** การ์ดขอให้กล่องอยู่ *ใต้* ปุ่มเสมอ
 * แต่แถบปุ่มเป็น `sticky bottom-0` — ระหว่างที่ผู้ใช้อยู่กลางฟอร์มมันถูกตรึงติดขอบล่างของ viewport
 * โดยใต้มัน **ไม่มีที่ว่างเหลืออยู่เลยแม้แต่พิกเซลเดียว** กล่องลอยที่วางลงล่างตรงนั้นจะไปอยู่ใต้ขอบจอ
 * และเลื่อนลงไปดูไม่ได้ด้วย (ระยะที่ sticky เลื่อนไม่นับเป็นพื้นที่ scroll) รุ่นก่อนหน้านี้จึงต้องพลิก
 * ขึ้นบนเมื่อที่ไม่พอ ซึ่งแปลว่าในทางปฏิบัติมันอยู่บนเกือบตลอดเวลา
 *
 * ที่ว่างใต้ปุ่มจึงต้อง **ถูกสร้างขึ้นมา** ไม่ใช่ไปหาเอา วิธีที่ทำได้คือให้กล่องอยู่ในแถบปุ่มเอง แถบที่
 * สูงขึ้นแต่ขอบล่างถูกตรึงไว้จะ "งอก" ขึ้นบน ปุ่มเลื่อนขึ้นไปและกล่องเข้ามาแทนที่เดิมของปุ่มพอดี —
 * กล่องจึงอยู่ใต้ปุ่มจริงทุกจังหวะ ไม่ว่าจะเลื่อนหน้าอยู่ตรงไหน และไม่มีทางหลุดขอบจอ
 *
 * ผลพลอยได้: ไม่ต้องวัด `DOMRect` ไม่ต้องฟัง scroll/resize และไม่ต้องรับข้อแลกเปลี่ยนของ `fixed`
 * (ancestor ที่มี `transform`/`filter`/`will-change`/`contain` จะกลายเป็นกรอบอ้างอิงแทน viewport)
 * ที่ต้องระวังแทนคือ **เมาส์**: ปุ่มเลื่อนหนีจากใต้เคอร์เซอร์ตอนกล่องเปิด ถ้าปิดทันทีที่เมาส์ออกจากปุ่ม
 * มันจะเปิด-ปิดสลับกันไม่รู้จบ กล่องจึงรับ hover ต่อจากปุ่ม และการปิดถูกหน่วงไว้ `CLOSE_DELAY`
 */
export function IncompleteGate({
  items,
  actionLabel,
  hintId,
  secondaryAction,
  children,
}: IncompleteGateProps) {
  const [open, setOpen] = useState(false);
  const summaryId = useId();
  const closeTimer = useRef<number | null>(null);

  const cancelClose = () => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  const openNow = () => {
    cancelClose();
    setOpen(true);
  };
  const closeSoon = () => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => setOpen(false), CLOSE_DELAY);
  };

  useEffect(() => cancelClose, []);

  // กรอกครบแล้วก็ไม่เหลืออะไรให้บอก ปิดกล่องทิ้งไว้ไม่ได้ ไม่งั้นมันค้างอยู่ตอนแถวหายไป
  useEffect(() => {
    if (items.length === 0) setOpen(false);
  }, [items.length]);

  const row = (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
      {items.length > 0 ? (
        <button
          type="button"
          id={summaryId}
          aria-expanded={open}
          aria-controls={hintId}
          onClick={() => setOpen((o) => !o)}
          className="inline-flex items-center gap-1.5 self-start rounded-md text-left text-[13px] leading-relaxed text-ink-muted underline decoration-dotted underline-offset-4 hover:text-ink sm:mr-auto sm:self-center"
        >
          ยังกรอกไม่ครบ {items.length} รายการ — ดูว่าต้องแก้อะไรบ้าง
          <svg
            viewBox="0 0 16 16"
            className={clsx("h-3.5 w-3.5 shrink-0 transition-transform", open && "rotate-180")}
            aria-hidden="true"
          >
            <path d="M4 6.5 8 10.5l4-4" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      ) : null}
      {secondaryAction}
      {/* ตัวครอบรับ hover แทนปุ่มที่ถูก disable — ดูเหตุผลข้างบน */}
      <span className="inline-flex" onMouseEnter={openNow} onMouseLeave={closeSoon}>
        {children}
      </span>
    </div>
  );

  // ฟอร์มที่กรอกครบแล้วเหลือแค่แถวปุ่มธรรมดา ไม่มีอะไรให้ย่อ/ขยาย
  if (items.length === 0) return row;

  return (
    <div className="flex flex-col gap-3">
      {row}
      {/*
        `grid-rows-[0fr]` → `[1fr]` ย่อ/ขยายได้ตามความสูงจริงของเนื้อหา โดยไม่ต้องรู้ค่าความสูง
        ล่วงหน้าเหมือน `max-height` — ตอนย่ออยู่กินที่ 0px แถบปุ่มจึงสูงเท่าเดิมเป๊ะ
      */}
      <span
        id={hintId}
        role="tooltip"
        onMouseEnter={openNow}
        onMouseLeave={closeSoon}
        className={clsx(
          "grid transition-[grid-template-rows,opacity] duration-150",
          open ? "grid-rows-[1fr] opacity-100" : "pointer-events-none grid-rows-[0fr] opacity-0",
        )}
      >
        <span className="overflow-hidden">
          <span className="block w-full rounded-xl border border-line bg-white p-4 text-left shadow-pop">
            <span className="block text-[13px] font-semibold text-navy-800">
              ต้องแก้ {items.length} รายการก่อนกด &ldquo;{actionLabel}&rdquo;
            </span>
            {/*
              กล่องกว้างเท่าแถบปุ่ม รายการจึงเดินสองคอลัมน์ตั้งแต่ `sm` ขึ้นไป — บรรทัดละรายการ
              บนความกว้างเท่านี้จะเหลือที่ว่างท้ายบรรทัดครึ่งจอ และดันรายการที่เหลือลงไปใต้เส้น
              scroll มากกว่าเดิมเท่าตัว · ใช้ grid ไม่ใช่ `columns` เพราะ multi-column ในกล่องที่
              จำกัดความสูงจะล้นออกไป *ทางขวา* กลายเป็น scroll แนวนอนแทน
            */}
            <ul className="mt-2 grid max-h-[min(50vh,18rem)] grid-cols-1 gap-x-6 gap-y-1.5 overflow-y-auto text-[13px] leading-relaxed text-ink-muted sm:grid-cols-2">
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
        </span>
      </span>
    </div>
  );
}
