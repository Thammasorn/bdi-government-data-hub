"use client";

import clsx from "clsx";

import { DELIVERY_STATE_META, deliverySentence, type DeliveryView } from "@/lib/deliveries";

/**
 * ป้ายสถานะอีเมลฉบับล่าสุดในแถว (คำเชิญ สมาชิก หน้าผู้ใช้) — การ์ด "Send every email through the delivery worker" ข้อ 3.2
 * ไม่มีอีเมล (แถวก่อนการ์ดนี้) = ไม่วาดอะไร ข้อความเต็มอยู่ใน `title` และสำหรับโปรแกรมอ่านจอ
 */
export function DeliveryChip({ delivery, prefix = "อีเมล" }: { delivery: DeliveryView | null | undefined; prefix?: string }) {
  if (!delivery) return null;
  const meta = DELIVERY_STATE_META[delivery.state];
  const label =
    delivery.state === "retrying" ? `${meta.label} (${delivery.attemptCount}/${delivery.maxAttempts})` : meta.label;
  const sentence = deliverySentence(delivery);
  return (
    <span
      title={sentence}
      aria-label={`${prefix}: ${sentence}`}
      className={clsx(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[12px] font-medium",
        meta.className,
      )}
    >
      <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
        <path d="M2.5 4h11v8h-11zM2.5 4l5.5 4.5L13.5 4" strokeLinejoin="round" />
      </svg>
      {prefix} {label}
    </span>
  );
}
