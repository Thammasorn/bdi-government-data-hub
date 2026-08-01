import localFont from "next/font/local";

/**
 * ฟอนต์จากชุด CI ที่ให้มาใน assets/theme_ci_design/Font
 * self-host ทั้งหมด ไม่เรียก Google Fonts เพื่อให้ทำงานได้หลัง firewall
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
