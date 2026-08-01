"use client";

import clsx from "clsx";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

type Tone = "success" | "error" | "info";
interface Toast {
  id: number;
  tone: Tone;
  title: string;
  detail?: string;
}

const ToastContext = createContext<{ show: (t: Omit<Toast, "id">) => void } | null>(null);

/** สเปกระบุว่าเมื่อข้อมูลไม่ผ่านการตรวจสอบ ให้ขึ้น toast เตือน */
export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast ต้องอยู่ภายใน <ToastProvider>");
  return ctx;
}

const TONES: Record<Tone, { bar: string; icon: ReactNode }> = {
  success: {
    bar: "bg-success",
    icon: (
      <path d="M4 8.5 6.8 11.3 12 5.8" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    ),
  },
  error: {
    bar: "bg-danger",
    icon: <path d="M8 4v5m0 3h.01" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />,
  },
  info: {
    bar: "bg-navy-500",
    icon: <path d="M8 7v5M8 4.5h.01" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />,
  },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const show = useCallback((t: Omit<Toast, "id">) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { ...t, id }]);
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), 6000);
  }, []);

  const value = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4 sm:items-end sm:p-6"
        role="region"
        aria-live="polite"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className="animate-in-up pointer-events-auto flex w-full max-w-sm overflow-hidden rounded-xl bg-white shadow-pop ring-1 ring-line"
          >
            <span className={clsx("w-1 shrink-0", TONES[t.tone].bar)} />
            <div className="flex flex-1 items-start gap-3 p-3.5">
              <svg
                viewBox="0 0 16 16"
                className={clsx(
                  "mt-0.5 h-4 w-4 shrink-0",
                  t.tone === "success" ? "text-success" : t.tone === "error" ? "text-danger" : "text-navy-500",
                )}
                aria-hidden="true"
              >
                {TONES[t.tone].icon}
              </svg>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink">{t.title}</p>
                {t.detail ? <p className="mt-0.5 text-[13px] leading-relaxed text-ink-muted">{t.detail}</p> : null}
              </div>
              <button
                type="button"
                onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
                className="-m-1 rounded p-1 text-ink-subtle hover:text-ink"
                aria-label="ปิดการแจ้งเตือน"
              >
                <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="m4 4 8 8M12 4l-8 8" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
