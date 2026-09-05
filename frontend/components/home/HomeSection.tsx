"use client";

import clsx from "clsx";
import type { ReactNode } from "react";

import { Card } from "@/components/ui/Card";

/** `attention` = งานที่หยุดรอผู้อ่านอยู่ — ป้ายจำนวนและขอบการ์ดเป็นสี coral */
export type SectionTone = "plain" | "attention";

/**
 * เปลือกของ section หนึ่งบล็อกบนหน้าแรก
 *
 * หัวข้อ + ป้ายจำนวน + คำอธิบาย + การ์ดที่ห่อรายการไว้ + บรรทัดปิดท้าย — เหมือนกันหมด
 * ไม่ว่าแถวข้างในจะเป็นคำขอลงทะเบียนหน่วยงานหรือคำขอลงทะเบียนชุดข้อมูล ส่วนที่ **ต่างกันจริง**
 * คือคอลัมน์ของแถว ซึ่งยกมารวมกันไม่ได้อยู่แล้ว เพราะ Tailwind สแกนคลาสแบบ static —
 * สตริง grid ต้องเขียนเต็มอยู่ในไฟล์ของแถวนั้นเอง (เหตุผลเดียวกับที่ lib/use-request-list.ts
 * รวม state ของสองตารางไว้แต่ไม่รวม JSX ของแถว)
 */
export function HomeSection({
  title,
  description,
  count,
  empty,
  emptyText,
  tone = "plain",
  footer,
  children,
}: {
  title: string;
  description: string;
  /** จำนวนจริงทั้งหมด — section แสดงแค่ไม่กี่แถวแรก จำนวนแถวที่ส่งเข้ามาจึงพูดแทนไม่ได้ */
  count: number;
  /** ไม่มีแถวเลย — ให้ขึ้น `emptyText` แทนรายการ */
  empty: boolean;
  emptyText: string;
  tone?: SectionTone;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section>
      <header className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-[19px] font-semibold text-navy-800">{title}</h2>
        <span
          className={clsx(
            "rounded-full px-2.5 py-0.5 text-[13px] font-semibold",
            tone === "attention" ? "bg-coral-50 text-coral-600" : "bg-navy-50 text-navy-700",
          )}
        >
          {count} รายการ
        </span>
        <p className="w-full text-[14px] text-ink-muted">{description}</p>
      </header>

      <Card
        className={clsx(
          "overflow-hidden",
          tone === "attention" && !empty ? "ring-coral-200" : undefined,
        )}
      >
        {empty ? (
          <p className="px-6 py-10 text-center text-[15px] text-ink-muted">{emptyText}</p>
        ) : (
          children
        )}
      </Card>

      {footer ? <div className="mt-3">{footer}</div> : null}
    </section>
  );
}
