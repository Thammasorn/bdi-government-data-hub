"use client";

/**
 * สถานะการส่งอีเมล — ตรงกับ `DeliveryView` ใน backend/src/lib/delivery-view.ts (การ์ด "[Enhance] Send every email through the delivery
 * worker" ข้อ 3) ประโยคเหตุผลมาจาก API เสมอ หน้าจอแปลแค่สถานะเป็นป้าย
 */
import { useEffect, useState } from "react";

import { api } from "./api";

export type DeliveryState = "queued" | "sent" | "retrying" | "failed" | "cancelled";

export interface DeliveryView {
  id: string;
  state: DeliveryState;
  type: string;
  typeLabel: string;
  destination: string;
  attemptCount: number;
  maxAttempts: number;
  createdAt: string;
  sentAt: string | null;
  lastAttemptAt: string | null;
  nextRetryAt: string | null;
  reason: string | null;
  fixedBy: "admin" | "it" | "none" | "user" | null;
  recipientUserId: string;
  subjectType: string | null;
  subjectId: string | null;
  organizationId: string | null;
  resend: "requeue" | "invitation" | "password_reset" | null;
}

export const DELIVERY_STATE_META: Record<DeliveryState, { label: string; className: string }> = {
  queued: { label: "รอส่ง", className: "bg-navy-50 text-navy-700" },
  sent: { label: "ส่งแล้ว", className: "bg-success-bg text-success" },
  retrying: { label: "กำลังลองใหม่", className: "bg-warning-bg text-warning" },
  failed: { label: "ส่งไม่สำเร็จ", className: "bg-danger-bg text-danger" },
  cancelled: { label: "ยกเลิก", className: "bg-navy-50 text-ink-muted" },
};

export const isFinal = (state: DeliveryState) => state === "sent" || state === "failed" || state === "cancelled";

const time = (iso: string) =>
  new Intl.DateTimeFormat("th-TH", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" }).format(new Date(iso));

/** หนึ่งบรรทัดที่บอกสถานะเป็นคำ — ใช้ทั้งในตัวติดตามและในป้าย (title) */
export function deliverySentence(d: DeliveryView): string {
  switch (d.state) {
    case "queued":
      return "เข้าคิวแล้ว กำลังส่ง…";
    case "sent":
      return `ส่งถึง ${d.destination} แล้ว${d.sentAt ? ` (${time(d.sentAt)})` : ""}`;
    case "retrying":
      return `ส่งยังไม่สำเร็จ — ระบบจะลองใหม่อัตโนมัติ (ครั้งที่ ${d.attemptCount + 1} จาก ${d.maxAttempts})`;
    case "failed":
      return `ส่งไม่สำเร็จ${d.reason ? `: ${d.reason}` : ""}`;
    case "cancelled":
      return `ยกเลิก${d.reason ? `: ${d.reason}` : ""}`;
  }
}

/**
 * ติดตามอีเมลหนึ่งฉบับหลังกดคำสั่ง — ถามทุกวินาทีใน 10 วินาทีแรก แล้วทุก 3 วินาทีจนครบ 30 วินาที (การ์ดข้อ 3.1) หยุดทันทีที่จบ
 * (ส่งแล้ว ส่งไม่สำเร็จ ยกเลิก) หรือเมื่อครบเวลา — สถานะหลังจากนั้นดูได้จากป้ายในแถวและหน้าประวัติการส่งอีเมล
 */
export function useDeliveryWatch(id: string | null) {
  const [delivery, setDelivery] = useState<DeliveryView | null>(null);
  const [watching, setWatching] = useState(false);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const started = Date.now();
    setWatching(true);
    const tick = async () => {
      try {
        const res = await api.get<{ delivery: DeliveryView }>(`/api/admin/deliveries/${id}`, { background: true });
        if (!alive) return;
        setDelivery(res.delivery);
        if (isFinal(res.delivery.state)) {
          setWatching(false);
          return;
        }
      } catch {
        // เงียบ — ครั้งถัดไปลองใหม่ สถานะเดิมยังแสดงอยู่
      }
      const elapsed = Date.now() - started;
      if (elapsed >= 30_000) {
        if (alive) setWatching(false);
        return;
      }
      timer = setTimeout(() => void tick(), elapsed < 10_000 ? 1_000 : 3_000);
    };
    void tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [id]);

  return { delivery, watching };
}
