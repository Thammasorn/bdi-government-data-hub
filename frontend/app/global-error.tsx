"use client";

import { useEffect, useState } from "react";

import { reportError } from "@/lib/report-error";

/**
 * เรนเดอร์นอก layout หลัก จึงห้ามพึ่ง context ใด ๆ (SessionProvider/ToastProvider)
 * และต้องมี <html>/<body> ของตัวเอง
 *
 * แสดง**รหัสอ้างอิง**ให้ผู้ใช้อ่านให้เจ้าหน้าที่ฟังได้ — สร้างที่เบราว์เซอร์ (8 ตัวฐานสิบหก) แล้วส่งไปกับรายงาน error
 * (`browser.reference` ใน log store ค้นด้วย Postman G6 ได้ — lib/report-error.ts) สร้างใน `useEffect` ไม่ใช่ตอนเรนเดอร์:
 * หน้านี้ถูก prerender ตอน build ค่าสุ่มตอนเรนเดอร์จะติดไปกับ HTML ทุกคนได้รหัสเดียวกัน และไม่ตรงกับตอน hydrate
 * `error.digest` (ของ error ฝั่ง server ที่ Next ซ่อนข้อความ) ไปกับรายงานด้วย — Next server รายงาน error ตัวเดียวกันพร้อม
 * digest เดียวกัน (`extra.digest`, lib/server-error-report.ts) trace ของรหัสนี้ (Postman G6) จึงได้ข้อความจริงใน `serverErrors`
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [reference, setReference] = useState<string | null>(null);

  useEffect(() => {
    const bytes = new Uint8Array(4);
    crypto.getRandomValues(bytes);
    const generated = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    setReference(generated);
    reportError(error, { mechanism: "global-error", digest: error.digest, reference: generated });
  }, [error]);

  return (
    <html lang="th">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "#f6f7fb",
          color: "#141a33",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
          padding: "24px",
        }}
      >
        <main style={{ maxWidth: 420, textAlign: "center" }}>
          <div
            style={{
              height: 4,
              width: 64,
              margin: "0 auto 28px",
              borderRadius: 999,
              backgroundImage: "linear-gradient(90deg,#e5775a,#192768)",
            }}
          />
          <h1 style={{ fontSize: 24, fontWeight: 600, color: "#192768", margin: "0 0 10px" }}>
            เกิดข้อผิดพลาดที่ไม่คาดคิด
          </h1>
          <p style={{ fontSize: 15, lineHeight: 1.7, color: "#5b6178", margin: "0 0 28px" }}>
            ระบบทำงานผิดพลาดชั่วคราว กรุณาลองใหม่อีกครั้ง
            หากยังพบปัญหาให้ติดต่อผู้ประสานงานของ BDI
            {reference ? (
              <>
                <br />
                พร้อมแจ้งรหัสอ้างอิง{" "}
                <span style={{ fontFamily: "ui-monospace, monospace", color: "#192768", fontWeight: 600 }}>
                  {reference}
                </span>
              </>
            ) : null}
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              background: "#e5775a",
              color: "#fff",
              border: 0,
              borderRadius: 999,
              padding: "14px 30px",
              fontSize: 15,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            ลองใหม่อีกครั้ง
          </button>
        </main>
      </body>
    </html>
  );
}
