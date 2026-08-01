"use client";

/**
 * เรนเดอร์นอก layout หลัก จึงห้ามพึ่ง context ใด ๆ (SessionProvider/ToastProvider)
 * และต้องมี <html>/<body> ของตัวเอง
 */
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
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
            หากยังพบปัญหาให้ติดต่อเจ้าหน้าที่ BDI
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
