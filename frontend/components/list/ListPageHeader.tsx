import type { ReactNode } from "react";

/**
 * หัวของหน้า landing ทั้งสองแท็บ — และที่เดียวที่สีประจำเส้นทางถูกเลือก
 *
 * BDI ขอเมื่อ 2026-09-04 ให้หน้า landing ของแท็บ "คำขอลงทะเบียนหน่วยงาน" เป็น
 * Royal Blue `#364B96` และของแท็บ "คำขอส่งชุดข้อมูล" เป็น Coral `#E5775A`
 * ทั้งสองค่าเป็นสีที่มีอยู่แล้วใน CI (`--color-navy-500` / `--color-coral-500`
 * ใน `app/globals.css` วัดมาจากไฟล์ `.ai` ต้นฉบับ) จึงไม่มี token ใหม่และไม่มี
 * hex ลอย ๆ ใน component — Tailwind สแกนคลาสแบบ static คลาสจึงต้องเขียนเต็ม
 *
 * สีอยู่ที่แถบและคำกำกับ ไม่ได้อยู่ที่ตัวหัวข้อ: Coral บนพื้นขาวได้คอนทราสต์
 * ราว 3:1 ซึ่งพอสำหรับตัวใหญ่แต่ไม่เหลือที่ให้พลาด และกติกาของโปรเจกต์คือ
 * ห้ามสื่อความหมายด้วยสีอย่างเดียวอยู่แล้ว — แถบสีจึงเป็นของประดับที่บอกว่า
 * "ตอนนี้อยู่เส้นทางไหน" ส่วนคำบอกเรื่องเดียวกันเป็นตัวหนังสือ
 */
const TONES = {
  organization: { bar: "bg-navy-500", eyebrow: "text-navy-500" },
  dataset: { bar: "bg-coral-500", eyebrow: "text-coral-500" },
} as const;

export function ListPageHeader({
  tone,
  eyebrow,
  title,
  description,
}: {
  tone: keyof typeof TONES;
  eyebrow: string;
  title: string;
  description: ReactNode;
}) {
  const { bar, eyebrow: eyebrowClass } = TONES[tone];
  return (
    <header className="mb-7">
      <div className={`h-1 w-12 rounded-full ${bar}`} aria-hidden="true" />
      <p className={`mt-3 text-[13px] font-semibold uppercase tracking-wide ${eyebrowClass}`}>
        {eyebrow}
      </p>
      <h1 className="mt-1 text-[26px] font-semibold text-navy-800">{title}</h1>
      <p className="mt-1.5 text-[15px] text-ink-muted">{description}</p>
    </header>
  );
}
