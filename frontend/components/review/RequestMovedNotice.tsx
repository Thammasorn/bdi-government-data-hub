"use client";

import { Button } from "@/components/ui/Button";

/**
 * "คำขอเดินไปแล้วระหว่างที่คุณเปิดหน้านี้ค้างไว้"
 *
 * เป็นแถบค้าง ไม่ใช่ toast โดยตั้งใจ — toast หายเองใน 6 วินาทีและไม่มีที่ให้เขียนว่าตอนนี้
 * คำขออยู่ขั้นไหน คนที่เดินออกไปชงกาแฟแล้วกลับมาจะไม่เห็นอะไรเลย ทั้งที่สิ่งที่เขาเห็นบนจอ
 * เปลี่ยนไปแล้วทั้งหน้า
 *
 * ต่างจาก `SessionChangedDialog` ตรงที่ **ไม่ปิดกั้นหน้าจอ**: ที่นั่นตัวตนของผู้ใช้เปลี่ยน
 * ทุกอย่างที่เห็นอยู่จึงเชื่อไม่ได้อีก แต่ที่นี่ข้อมูลถูกโหลดใหม่ให้เรียบร้อยแล้ว สิ่งที่เหลือคือ
 * บอกว่าเมื่อกี้เกิดอะไรขึ้น เพื่อไม่ให้ปุ่มที่หายไปดูเหมือนหน้าจอเพี้ยน
 */
export function RequestMovedNotice({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}) {
  return (
    <div
      role="status"
      className="mb-6 flex flex-col gap-3 rounded-xl border-l-[3px] border-coral-500 bg-coral-50 p-5 sm:flex-row sm:items-start sm:justify-between"
    >
      <div className="min-w-0">
        <p className="text-[13px] font-semibold text-coral-700">คำขอนี้เพิ่งมีการเปลี่ยนแปลง</p>
        <p className="mt-1.5 text-[15px] leading-relaxed text-ink">{message}</p>
      </div>
      <Button variant="secondary" size="sm" className="shrink-0" onClick={onDismiss}>
        รับทราบ
      </Button>
    </div>
  );
}
