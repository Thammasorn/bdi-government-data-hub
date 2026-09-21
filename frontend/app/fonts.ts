import localFont from "next/font/local";

/**
 * ฟอนต์จากชุด CI ที่ให้มาใน assets/theme_ci_design/Font
 * self-host ทั้งหมด ไม่เรียก Google Fonts เพื่อให้ทำงานได้หลัง firewall
 *
 * Sarabun ทั้งสี่ไฟล์ **ไม่ใช่ไฟล์ดิบจาก CI** — descender ถูกขยายจาก -232 เป็น -330 ด้วย
 * `docs/tools/fix-sarabun-descender.py` เพราะฟอนต์วาด `_` ต่ำกว่า descender ที่ประกาศไว้
 * และ Chrome ตัดข้อความใน <input> ไว้ที่กล่อง ascent+descent ตัว `_` จึงหายไปเป็นช่องว่าง
 * (feedback 2026-09-21) ถ้าได้ฟอนต์ชุดใหม่จาก CI ให้รันสคริปต์นั้นซ้ำก่อนวางทับ
 */
export const prompt = localFont({
  variable: "--font-prompt",
  display: "swap",
  src: [
    { path: "../public/fonts/Prompt-Regular.ttf", weight: "400", style: "normal" },
    { path: "../public/fonts/Prompt-Medium.ttf", weight: "500", style: "normal" },
    { path: "../public/fonts/Prompt-SemiBold.ttf", weight: "600", style: "normal" },
    { path: "../public/fonts/Prompt-Bold.ttf", weight: "700", style: "normal" },
  ],
});

export const sarabun = localFont({
  variable: "--font-sarabun",
  display: "swap",
  src: [
    { path: "../public/fonts/Sarabun-Regular.ttf", weight: "400", style: "normal" },
    { path: "../public/fonts/Sarabun-Medium.ttf", weight: "500", style: "normal" },
    { path: "../public/fonts/Sarabun-SemiBold.ttf", weight: "600", style: "normal" },
    { path: "../public/fonts/Sarabun-Bold.ttf", weight: "700", style: "normal" },
  ],
});
