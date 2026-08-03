"use client";

import clsx from "clsx";
import { useRouter, usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "@/lib/api";
import { formatThaiDate } from "@/lib/status";
import type { AppNotification } from "@/lib/types";

/**
 * กระดิ่งแจ้งเตือน (docs/01-user-journey.md §4.8)
 *
 * สเปกระบุว่าไม่ต้อง real time — ดึงใหม่ตอนโหลดหน้าและตอนเปลี่ยนหน้าเท่านั้น
 * ไม่มี polling เพื่อไม่ให้ยิง API ทิ้งไว้ตลอดเวลาที่เปิดแท็บค้าง
 */
export function NotificationBell() {
  const router = useRouter();
  const pathname = usePathname();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    api
      .get<{ notifications: AppNotification[]; unreadCount: number }>("/api/notifications")
      .then((d) => {
        setItems(d.notifications);
        setUnread(d.unreadCount);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    load();
  }, [load, pathname]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const openItem = async (item: AppNotification) => {
    setOpen(false);
    if (!item.readAt) {
      setUnread((n) => Math.max(0, n - 1));
      setItems((list) =>
        list.map((i) => (i.id === item.id ? { ...i, readAt: new Date().toISOString() } : i)),
      );
      await api.post(`/api/notifications/${item.id}/read`).catch(() => undefined);
    }
    if (item.link) router.push(item.link);
  };

  const markAll = async () => {
    setUnread(0);
    setItems((list) => list.map((i) => ({ ...i, readAt: i.readAt ?? new Date().toISOString() })));
    await api.post("/api/notifications/read-all").catch(() => undefined);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={unread > 0 ? `การแจ้งเตือน ${unread} รายการที่ยังไม่อ่าน` : "การแจ้งเตือน"}
        className="relative grid h-10 w-10 place-items-center rounded-full transition-colors hover:bg-navy-50"
      >
        <svg
          viewBox="0 0 24 24"
          className="h-5 w-5 text-navy-800"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          aria-hidden="true"
        >
          <path d="M18 8a6 6 0 1 0-12 0c0 6-2 7-2 7h16s-2-1-2-7" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M13.7 20a2 2 0 0 1-3.4 0" strokeLinecap="round" />
        </svg>
        {unread > 0 ? (
          // ตัวเลขกำกับด้วย เพราะจุดสีอย่างเดียวสื่อความหมายไม่ได้
          <span className="absolute -right-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-coral-500 px-1 text-[11px] font-semibold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          role="menu"
          className="animate-in-up absolute right-0 mt-2 w-[22rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl bg-white shadow-pop ring-1 ring-line"
        >
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <p className="text-sm font-semibold text-ink">การแจ้งเตือน</p>
            {unread > 0 ? (
              <button
                type="button"
                onClick={markAll}
                className="text-[13px] font-medium text-navy-700 hover:underline"
              >
                ทำเครื่องหมายว่าอ่านแล้วทั้งหมด
              </button>
            ) : null}
          </div>

          {items.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-ink-muted">ยังไม่มีการแจ้งเตือน</p>
          ) : (
            <ul className="max-h-96 divide-y divide-line overflow-y-auto">
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => openItem(item)}
                    className={clsx(
                      "w-full px-4 py-3 text-left transition-colors hover:bg-navy-50/70",
                      !item.readAt && "bg-coral-50/50",
                    )}
                  >
                    <p className="text-sm font-medium text-ink">{item.title}</p>
                    {item.body ? (
                      <p className="mt-0.5 line-clamp-2 text-[13px] text-ink-muted">{item.body}</p>
                    ) : null}
                    <p className="mt-1 text-[12px] text-ink-subtle">
                      {formatThaiDate(item.createdAt)}
                      {item.readAt ? "" : " · ยังไม่อ่าน"}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
