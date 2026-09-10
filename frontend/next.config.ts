import type { NextConfig } from "next";

/**
 * โดเมนที่ dev server ยอมรับ นอกเหนือจาก localhost
 * ตั้งผ่าน ALLOWED_DEV_ORIGINS (คั่นด้วย comma) — จำเป็นเมื่อเปิด dev server
 * ผ่าน tunnel/reverse proxy มิฉะนั้น Next จะปฏิเสธ request ที่ Host ไม่ตรง
 */
const allowedDevOrigins = (process.env.ALLOWED_DEV_ORIGINS ?? "")
  .split(",")
  .map((o) => o.trim().replace(/^https?:\/\//, ""))
  .filter(Boolean);

/**
 * ไม่มี rewrites() ที่นี่แล้ว — การส่ง /api/* ต่อไป backend ย้ายไปอยู่ที่
 * app/api/[...path]/route.ts เพราะ rewrites() ถูกประเมินตอน `next build`
 * แล้วฝังปลายทางลง routes-manifest.json ทำให้ INTERNAL_API_URL ที่ตั้งตอนรัน
 * ไม่มีผล (ดูคอมเมนต์เต็มในไฟล์นั้น)
 */
const nextConfig: NextConfig = {
  // Emits a self-contained server bundle for the production Docker image.
  output: "standalone",
  ...(allowedDevOrigins.length > 0 ? { allowedDevOrigins } : {}),
};

export default nextConfig;
