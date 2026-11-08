"use client";

import clsx from "clsx";
import { useState } from "react";

/**
 * ตัวอย่างอีเมลหนึ่งฉบับ — หัวเรื่อง + HTML ใน `<iframe sandbox="">` สลับความกว้างแบบ desktop / mobile ได้
 *
 * `sandbox` ว่าง = ไม่มีสคริปต์ ไม่มีฟอร์ม ลิงก์กดไม่ไปไหน และ origin แยกจากหน้า console — HTML นี้ผู้ดูแลเขียนเองและยังไม่ผ่านการบันทึก
 * โลโก้มาเป็น data URI จาก API (อีเมลจริงแนบไฟล์และอ้างด้วย cid:)
 */
export function EmailPreviewFrame({ subject, html, bytes }: { subject: string; html: string; bytes?: number }) {
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 text-[13.5px]">
          <span className="text-ink-subtle">หัวเรื่อง: </span>
          <span className="font-medium text-ink">{subject || "—"}</span>
        </div>
        <div role="group" aria-label="ความกว้างของตัวอย่าง" className="flex rounded-full bg-navy-50 p-0.5 text-[12.5px]">
          {(["desktop", "mobile"] as const).map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={device === d}
              onClick={() => setDevice(d)}
              className={clsx(
                "rounded-full px-3 py-1 font-medium",
                device === d ? "bg-white text-navy-800 shadow-sm" : "text-ink-muted hover:text-navy-700",
              )}
            >
              {d === "desktop" ? "คอมพิวเตอร์" : "มือถือ"}
            </button>
          ))}
        </div>
      </div>
      <div className="flex justify-center rounded-xl bg-[#F6F7FB] ring-1 ring-line">
        <iframe
          title={`ตัวอย่างอีเมล: ${subject}`}
          sandbox=""
          srcDoc={html}
          className={clsx("h-[44rem] bg-white transition-[width]", device === "mobile" ? "w-[375px] shrink-0" : "w-full")}
        />
      </div>
      {bytes !== undefined ? (
        <p className="text-right text-[12px] text-ink-subtle">
          ขนาดประมาณ {(bytes / 1024).toFixed(0)} KB (ในตัวอย่างรวมรูปโลโก้ อีเมลจริงแนบโลโก้เป็นไฟล์แยก)
        </p>
      ) : null}
    </div>
  );
}
