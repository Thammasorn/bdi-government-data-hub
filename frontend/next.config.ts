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

/** ปลายทางจริงของ API ใน network ของ docker */
const internalApi = process.env.INTERNAL_API_URL ?? "http://backend:4000";

const nextConfig: NextConfig = {
  // Emits a self-contained server bundle for the production Docker image.
  output: "standalone",
  ...(allowedDevOrigins.length > 0 ? { allowedDevOrigins } : {}),

  /**
   * ส่ง /api/* ต่อไปยัง backend จากฝั่ง server ของ Next
   *
   * ทำให้เบราว์เซอร์เรียก API ที่ origin เดียวกับหน้าเว็บเสมอ ไม่ว่าจะเข้าจาก
   * localhost:3000 หรือ bdi.thammasorn.org — จึงไม่มี CORS และ session cookie
   * ไม่กลายเป็น cross-site (ซึ่ง SameSite=Lax จะไม่ส่งให้)
   *
   * bdi-api.thammasorn.org ยังใช้ได้ตามปกติสำหรับผู้เรียก API จากภายนอก
   */
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${internalApi}/api/:path*` }];
  },
};

export default nextConfig;
