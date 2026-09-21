"use client";

/** ฝัง PDF ที่ระบบสร้างไว้ในหน้า — ใช้ทั้งเส้นทางหน่วยงานและเส้นทางชุดข้อมูล */
export function PdfViewer({
  url,
  filename,
  title = "เอกสารที่ระบบสร้าง",
}: {
  url: string;
  filename?: string;
  title?: string;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-navy-50">
      <div className="flex items-center justify-between gap-3 border-b border-line bg-white px-4 py-2.5">
        <p className="truncate text-sm font-medium text-ink">{filename ?? title}</p>
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 rounded-full px-3 py-1.5 text-[13px] font-medium text-navy-700 transition-colors hover:bg-navy-50"
        >
          เปิดในแท็บใหม่
        </a>
      </div>
      {/*
        ความสูงต้องยอมให้ของที่อยู่ใต้ตัวอ่าน — ช่องติ๊กและปุ่ม — ยังอยู่ในจอ
        `62vh` ตายตัวทำไม่ได้บนจอเตี้ย: ตัวอ่าน 62vh บวกหัวกล่อง ช่องติ๊กและแถวปุ่ม
        รวมแล้วเกิน 100vh เสมอเมื่อจอสูงราว 640px ปุ่มจึงหลุดขอบล่าง และเลื่อนไปหาไม่ได้
        เพราะล้อเมาส์ที่หมุนอยู่เหนือ PDF ถูก iframe รับไปเลื่อนเอกสารแทน
        clamp จึงหดตัวอ่านลงตามพื้นที่จริง โดยไม่ต่ำกว่า 16rem ซึ่งยังพออ่านได้
      */}
      {/*
        `key={url}` — เปลี่ยนเอกสารแล้วต้องได้ iframe ตัวใหม่ ไม่ใช่ตัวเดิมที่เปลี่ยน `src`
        กล่องเห็นชอบเดินจากผนวก 1 ไปผนวก 2 ด้วยการเปลี่ยน prop ตัวเดียว React จึงใช้
        iframe เดิม และตัวอ่าน PDF ของเบราว์เซอร์ถือตำแหน่งที่เลื่อนค้างไว้ข้ามไปฉบับใหม่ —
        อ่านผนวก 1 จนจบแล้วกดเห็นชอบ ผนวก 2 เปิดมาที่หน้า 2 ของ 6 (feedback 2026-09-21)

        `#page=1` เป็น PDF open parameter (Adobe; Chrome/Edge/Firefox รองรับ) บอกตัวอ่านให้
        เริ่มหน้าแรกอย่างชัดเจน กันกรณี Chrome จำตำแหน่งต่อ URL ไว้จากครั้งที่เปิดจากการ์ด
        เอกสารก่อนหน้า — fragment ไม่ถูกส่งไปเซิร์ฟเวอร์ ลิงก์ "เปิดในแท็บใหม่" จึงใช้ URL เปล่าต่อไป
      */}
      <iframe
        key={url}
        src={`${url}#page=1`}
        title={title}
        className="h-[clamp(16rem,calc(100vh_-_24rem),62vh)] w-full bg-white"
      />
    </div>
  );
}
