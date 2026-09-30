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

/**
 * header ที่เบราว์เซอร์ส่งมาแล้วต้องไม่ถึง backend ตามที่ส่ง
 *   - `x-report-source` / `x-report-token` — ป้ายของรายงาน error จาก Next server (lib/server-error-report.ts) เบราว์เซอร์ไม่มี
 *     สิทธิ์อ้างว่าเป็น frontend-server (backend ตรวจ token อยู่แล้ว ตรงนี้กันอีกชั้นสำหรับทางที่ผ่านหน้าเว็บ)
 *   - `x-correlation-id` — ถูกแทนด้วยค่าใหม่ทุกคำขอ (`proxy()`)
 */
const STRIP_FROM_BROWSER = ["x-report-source", "x-report-token", "x-correlation-id"];

/** header ขากลับที่ปล่อยผ่านไม่ได้ เพราะ body ถูกแกะ/ประกอบใหม่แล้ว */
const STRIP_FROM_UPSTREAM = ["content-encoding", "content-length", "transfer-encoding"];

/**
 * API อ่าน log (`/api/admin/logs*` — backend/src/routes/admin-logs.ts) ไม่เปิดผ่านหน้าเว็บสาธารณะ (plan decision 19)
 *
 * log รวมทุกการกระทำของทุกคน ต่อให้มี token ของมันเองก็ไม่ควรเรียกได้จาก bdi.thammasorn.org คนที่ต้องอ่านเรียก backend ตรง
 * (Postman) การจำกัดทางเครือข่ายต่อจากนี้เป็นเรื่องของ infra ไม่ใช่ของโค้ด
 *
 * เทียบแบบไม่สนตัวพิมพ์เล็กใหญ่ เพราะ Express จับ route แบบนั้น (`/api/ADMIN/Logs/activity` ถึง router ของ log เหมือนกัน)
 * และเทียบทั้งรูปดิบกับรูปที่ถอด `%xx` แล้วยุบ `/` ซ้อน — Express เทียบกับ path ดิบ (`%6Cogs` ไม่ถึง router ของ log) แต่
 * การปฏิเสธเกินไว้ไม่เสียอะไร ไม่มีหน้าไหนของเว็บเรียก path แบบนั้น
 */
function isLogApi(pathname: string): boolean {
  const forms = [pathname];
  try {
    forms.push(decodeURIComponent(pathname));
  } catch {
    // %xx ที่เสีย — เหลือรูปดิบให้เทียบ
  }
  return forms.some((form) => form.toLowerCase().replace(/\/{2,}/g, "/").startsWith("/api/admin/logs"));
}

async function proxy(req: NextRequest) {
  if (isLogApi(req.nextUrl.pathname)) {
    return Response.json({ error: "not_found", message: "ไม่พบเส้นทางนี้" }, { status: 404 });
  }

  // ใช้ pathname ตรง ๆ แทนการประกอบใหม่จาก params เพื่อให้ path ที่ encode มา
  // เดินทางถึง backend เหมือนเดิมทุกตัวอักษร (เหมือนที่ rewrite เคยทำ)
  const url = `${target()}${req.nextUrl.pathname}${req.nextUrl.search}`;

  /**
   * correlation id ใหม่**ทุกคำขอ** ไม่รับของเบราว์เซอร์ — backend รับค่าที่ผู้เรียกส่งมาถ้าเป็น UUID (lib/context.ts) ถ้าส่งต่อ
   * ตามที่ได้ คนหนึ่งวางแถวลงเส้นทาง (trace) ของคำขอคนอื่นผ่านหน้าเว็บได้ ครอบทุกคำขอรวม GET ของ iframe/ลิงก์ไฟล์ และคือ
   * รหัสอ้างอิงของ 502 ข้างล่างเมื่อ backend ไม่ตอบ (backend ต่อตรงไม่ผ่านที่นี่ยังส่งเองได้ — trace บอกด้วย `mixedActors`)
   *
   * **`X-Forwarded-For` ส่งต่อตามที่เบราว์เซอร์ส่งมา** (ตัดสินใจ 2026-09-30 ไม่เปลี่ยน): Next เติมจาก socket ก็ต่อเมื่อไม่มีมา
   * (`??=` ใน base-server.js) ค่านี้จึงเป็นอะไรก็ได้ที่ผู้เรียกเขียน ที่อยู่ของผู้ใช้ใน audit เชื่อได้เฉพาะเมื่อชั้นนอกสุดต่อท้าย
   * ที่อยู่จริงให้ — production คือ Cloudflare tunnel ซึ่งเอกสารของ Cloudflare บอกว่าต่อท้าย แต่**ยังไม่มีใครยืนยันกับ tunnel ของ
   * เรา** (plan §10 ข้อ 13) ทุกทางที่เรียก backend หรือหน้าเว็บได้โดยไม่ผ่าน Cloudflare (พอร์ต 3000/4000 บน LAN, checkout dev)
   * IP ใน audit คือสิ่งที่ผู้เรียกเขียนเอง การตัด header ทิ้งไม่ใช่ทางแก้: route handler อ่าน IP ของ socket ไม่ได้ ผู้ใช้ทุกคนจะ
   * กลายเป็นที่อยู่ของ container frontend แล้ว throttle ต่อ IP ของ backend ก็รวมเป็นก้อนเดียว (CLAUDE.md, Traps)
   */
  const correlationId = crypto.randomUUID();
  const headers = new Headers(req.headers);
  for (const h of HOP_BY_HOP) headers.delete(h);
  for (const h of STRIP_FROM_BROWSER) headers.delete(h);
  headers.set("x-correlation-id", correlationId);

  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: req.method,
      headers,
      // ส่งเป็น stream ไม่ buffer — คำขอแนบไฟล์ PDF ผ่านทางนี้
      body: hasBody ? req.body : undefined,
      redirect: "manual",
      ...(hasBody ? { duplex: "half" } : {}),
    } as RequestInit);
  } catch (err) {
    return backendUnreachable(req, correlationId, err);
  }

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

/**
 * ต่อ backend ไม่ได้ (ล่ม กำลัง deploy ชื่อ host ผิด) — 502 แบบมีชนิดแทน error ของ Next ที่ไม่มีใครอ่านออก ข้อความภาษาไทยพร้อม
 * รหัสอ้างอิง (8 ตัวแรกของ correlation id ของคำขอนี้) toast ที่แสดง `message` จึงบอกรหัสได้เลย backend ไม่เคยเห็นคำขอนี้ รายงาน
 * จึงมาจากเบราว์เซอร์ทีหลัง (lib/api.ts เก็บรหัสไว้แล้วส่งเมื่อ backend กลับมา — `browser.reference` ค้นด้วย Postman G6 ได้)
 * และจากบรรทัด JSON ใน stdout ของ Next server ตรงนี้ (id เต็ม ชื่อ error ของการต่อ path ไม่มี query)
 */
function backendUnreachable(req: NextRequest, correlationId: string, err: unknown): Response {
  const reference = correlationId.slice(0, 8);
  const cause = err instanceof Error ? ((err.cause as { code?: unknown } | undefined)?.code ?? err.name) : "Error";
  console.error(
    `[frontend-proxy] ${JSON.stringify({
      at: new Date().toISOString(),
      event: "backend_unreachable",
      correlationId,
      method: req.method,
      path: req.nextUrl.pathname.slice(0, 200),
      cause: String(cause).slice(0, 60),
    })}`,
  );
  return Response.json(
    {
      error: "backend_unreachable",
      message: `ระบบไม่พร้อมให้บริการชั่วคราว กรุณาลองใหม่อีกครั้ง (รหัสอ้างอิง ${reference})`,
      reference,
    },
    { status: 502, headers: { "x-correlation-id": correlationId } },
  );
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
