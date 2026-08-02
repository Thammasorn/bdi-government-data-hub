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

const nextConfig: NextConfig = {
  // Emits a self-contained server bundle for the production Docker image.
  output: "standalone",
  ...(allowedDevOrigins.length > 0 ? { allowedDevOrigins } : {}),
};

export default nextConfig;
