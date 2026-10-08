import type { NextRequest } from "next/server";

/**
 * ส่ง /api/* ต่อไปยัง backend จากฝั่ง server ของ Next
 *
 * ทำให้เบราว์เซอร์เรียก API ที่ origin เดียวกับหน้าเว็บเสมอ ไม่ว่าจะเข้าจาก
 * localhost:3000 หรือ bdi.thammasorn.org — จึงไม่มี CORS และ session cookie
 * ไม่กลายเป็น cross-site (ซึ่ง SameSite=Lax จะไม่ส่งให้)
 *
 * **เดิมงานนี้เป็น rewrites() ใน next.config.ts และนั่นคือบั๊ก** — Next เรียก
 * rewrites() ครั้งเดียวตอน `next build` แล้วเขียนปลายทางที่แทนค่าแล้วลง
 * routes-manifest.json (และฝังเป็น JSON ใน server.js เพราะ output: "standalone")
 * ตอนรันจึงไม่มีใครอ่าน process.env.INTERNAL_API_URL อีกเลย ปลายทาง
 * http://backend:4000 ที่เป็นค่า fallback ตอน build ติดไปกับ image ถาวร แล้วพัง
 * ด้วย ENOTFOUND backend บน Azure Container Apps ที่ไม่มี compose network
 *
 * route handler ทำงานตอนรับ request จริง จึงอ่าน env สด ๆ ได้ — image เดียว
 * ใช้ได้ทุก environment แค่เปลี่ยน env แล้ว restart
 */
function target() {
  return (process.env.INTERNAL_API_URL ?? "http://backend:4000").replace(/\/$/, "");
}

/** header ที่เป็นของ hop นี้โดยเฉพาะ ส่งต่อไปแล้วทำให้ upstream สับสน */
const HOP_BY_HOP = ["host", "connection", "content-length", "transfer-encoding"];

/** header ขากลับที่ปล่อยผ่านไม่ได้ เพราะ body ถูกแกะ/ประกอบใหม่แล้ว */
const STRIP_FROM_UPSTREAM = ["content-encoding", "content-length", "transfer-encoding"];

async function proxy(req: NextRequest) {
  // ใช้ pathname ตรง ๆ แทนการประกอบใหม่จาก params เพื่อให้ path ที่ encode มา
  // เดินทางถึง backend เหมือนเดิมทุกตัวอักษร (เหมือนที่ rewrite เคยทำ)
  const url = `${target()}${req.nextUrl.pathname}${req.nextUrl.search}`;

  const headers = new Headers(req.headers);
  for (const h of HOP_BY_HOP) headers.delete(h);

  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  const upstream = await fetch(url, {
    method: req.method,
    headers,
    // ส่งเป็น stream ไม่ buffer — คำขอแนบไฟล์ PDF ผ่านทางนี้
    body: hasBody ? req.body : undefined,
    redirect: "manual",
    ...(hasBody ? { duplex: "half" } : {}),
  } as RequestInit);

  const out = new Headers();
  upstream.headers.forEach((value, key) => {
    if (STRIP_FROM_UPSTREAM.includes(key)) return;
    // set-cookie ต้องแยกใบ ทำทีหลังด้วย getSetCookie()
    if (key === "set-cookie") return;
    out.set(key, value);
  });
  // Headers.set() ยุบ set-cookie หลายใบเหลือใบเดียว ซึ่งทำให้เบราว์เซอร์อ่าน
  // session cookie ไม่ออกแล้วค้างอยู่หน้า login — ต้อง append ทีละใบ
  for (const cookie of upstream.headers.getSetCookie()) out.append("set-cookie", cookie);

  return new Response(upstream.body, { status: upstream.status, headers: out });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const HEAD = proxy;
export const OPTIONS = proxy;

/** ห้าม Next พยายาม prerender หรือ cache — ทุกคำขอต้องวิ่งถึง backend จริง */
export const dynamic = "force-dynamic";
