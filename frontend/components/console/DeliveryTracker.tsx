"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

import { DELIVERY_STATE_META, deliverySentence, useDeliveryWatch } from "@/lib/deliveries";

/**
 * ตัวติดตามอีเมลที่ผู้ดูแลเพิ่งสั่งส่ง — การ์ด "[Enhance] Send every email through the delivery worker" ข้อ 3.1
 *
 * อีเมลทุกฉบับส่งโดย delivery-worker แล้ว คำตอบของ API จึงบอกแค่ "เข้าคิว" ไม่ใช่ "ส่งถึง" ก่อนหน้านี้ผู้ดูแลเห็นผลทันทีบนหน้าจอ (SMTP ล้ม =
 * error) จึงต้องมีที่ให้เห็นผลจริงต่อ: กล่องเล็กมุมขวาล่างที่ติดตามแต่ละฉบับราว 30 วินาที ไม่หายเองเมื่อปิดกล่องคำสั่ง และอยู่ข้ามการเปลี่ยนหน้า
 * ใน /console ผู้ดูแลปิดเองเมื่ออ่านแล้ว
 *
 * ใช้: `const { track } = useDeliveryTracker(); track(res.deliveryId, "คำเชิญถึง a@b.go.th")`
 */
interface Tracked {
  id: string;
  title: string;
}

const TrackerContext = createContext<{ track: (id: string | null | undefined, title: string) => void } | null>(null);

export function useDeliveryTracker() {
  const ctx = useContext(TrackerContext);
  // นอก /console (ไม่มี provider) — ไม่ติดตาม ไม่พัง
  return ctx ?? { track: () => undefined };
}

export function DeliveryTrackerProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Tracked[]>([]);
  const track = useCallback((id: string | null | undefined, title: string) => {
    if (!id) return;
    setItems((prev) => [{ id, title }, ...prev.filter((p) => p.id !== id)].slice(0, 4));
  }, []);
  const value = useMemo(() => ({ track }), [track]);
  const close = (id: string) => setItems((prev) => prev.filter((p) => p.id !== id));

  return (
    <TrackerContext.Provider value={value}>
      {children}
      {items.length ? (
        <div
          role="region"
          aria-label="สถานะการส่งอีเมล"
          className="fixed bottom-4 right-4 z-40 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
        >
          {items.map((item) => (
            <TrackedCard key={item.id} item={item} onClose={() => close(item.id)} />
          ))}
        </div>
      ) : null}
    </TrackerContext.Provider>
  );
}

function TrackedCard({ item, onClose }: { item: Tracked; onClose: () => void }) {
  const { delivery, watching } = useDeliveryWatch(item.id);
  const meta = delivery ? DELIVERY_STATE_META[delivery.state] : DELIVERY_STATE_META.queued;
  const failed = delivery?.state === "failed" || delivery?.state === "cancelled";
  return (
    <div role="status" aria-live="polite" className="rounded-xl bg-white p-3 shadow-card ring-1 ring-line">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[13.5px] font-semibold text-navy-800">{item.title}</p>
          <p className="mt-0.5 text-[13px] text-ink">
            <span className={`mr-1.5 inline-block rounded-full px-2 py-px text-[12px] font-medium ${meta.className}`}>
              {meta.label}
            </span>
            {/* ป้ายบอกสถานะแล้ว — ส่งไม่สำเร็จ/ยกเลิกแสดงแค่เหตุผล ไม่พูดคำเดิมซ้ำ */}
            {!delivery ? "เข้าคิวแล้ว กำลังส่ง…" : failed && delivery.reason ? delivery.reason : deliverySentence(delivery)}
          </p>
          {failed ? (
            <Link
              href={`/console/email-deliveries?state=${delivery?.state === "failed" ? "failed" : "cancelled"}`}
              className="mt-1 inline-block text-[12.5px] font-medium text-navy-700 underline"
            >
              ดูประวัติการส่งอีเมล →
            </Link>
          ) : null}
          {!watching && delivery && !["sent", "failed", "cancelled"].includes(delivery.state) ? (
            <p className="mt-1 text-[12px] text-ink-subtle">ยังไม่จบใน 30 วินาที — ดูผลต่อได้ที่ป้ายในแถว หรือหน้าประวัติการส่งอีเมล</p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="ปิด"
          className="rounded-md p-1 text-ink-subtle hover:bg-navy-50 hover:text-navy-700"
        >
          <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <path d="m4 4 8 8M12 4l-8 8" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}
