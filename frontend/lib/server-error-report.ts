/**
 * error ของ Next server (Node.js runtime เท่านั้น — import จาก instrumentation.ts เมื่อ `NEXT_RUNTIME === "nodejs"`)
 *
 * แต่ละตัวได้สองอย่าง:
 *   1. **หนึ่งบรรทัด JSON ลง stdout** (`[frontend-error] {...}`) — ที่แรกที่คนเปิดดู และที่เดียวตอน backend หรือ log store ล่ม
 *      ข้อความผ่านตัวกวาดอย่างย่อ (`scrub`) ก่อนพิมพ์: Next พิมพ์ error เต็มของมันเองอยู่แล้ว (`⨯ …`) บรรทัดนี้ไม่ควรเพิ่มที่รั่ว
 *   2. **POST ไป backend** (`${INTERNAL_API_URL}/api/client-errors`) แนบ `x-report-source: frontend-server` กับ
 *      `x-report-token: $INGEST_SERVER_TOKEN` — backend เก็บเป็น `service: "frontend-server"` เฉพาะเมื่อ token ตรง และกวาดซ้ำ
 *      ด้วยกฎเต็มของ backend/src/lib/redact.ts รอไม่เกิน 1 วินาที ล้มก็เงียบ (บรรทัดที่ 1 มีอยู่แล้ว) body ไม่เกินเพดานเป็นไบต์
 *      (lib/report-body.ts)
 *
 * path ของคำขอ: บรรทัดใน stdout ได้แค่ pathname ส่วนที่ POST ไป backend ได้ pathname กับ**ชื่อ** key ของ query ไม่มีค่า
 * (`/activate?token` ไม่ใช่ `/activate?token=…` — `keyNamesOnly`) backend ดึงชื่อไปเป็น `request.queryKeys` (plan §3 เก็บชื่อ
 * key ไว้ ค่าไม่เก็บ) เดิมตัด query ทิ้งทั้งหมดก่อนส่ง event ของ Next server จึงได้ `queryKeys: []` เสมอ
 *
 * เพดาน: ไม่เกิน 60 ตัวต่อนาทีต่อ process และข้อความเดียวกันซ้ำภายในหนึ่งนาทีนับเป็นตัวเดียว — error ที่เกิดกับทุกคำขอรูปภาพ
 * (EACCES ของ `.next/cache` ใน image production — plan §13 #5) ต้องไม่กลายเป็นร้อยบรรทัดต่อวินาที
 *
 * `INGEST_SERVER_TOKEN` อ่านตอนส่ง (runtime env) **ห้ามเป็น `NEXT_PUBLIC_`** — ค่าที่ขึ้นต้นแบบนั้นถูกฝังลงบันเดิลของเบราว์เซอร์
 */
import { reportBody } from "./report-body";

type ServerMechanism = "onRequestError" | "unhandledRejection" | "uncaughtException";

interface RouteInfo {
  path?: string | null;
  type?: string | null;
  routerKind?: string | null;
  method?: string | null;
  requestPath?: string | null;
}

const RELEASE = process.env.NEXT_PUBLIC_RELEASE || "dev";
const PER_MINUTE = 60;
const REPEAT_WINDOW_MS = 60_000;
const POST_TIMEOUT_MS = 1_000;

let minute = { start: 0, count: 0 };
const recent = new Map<string, number>();
let installed = false;

/** ตัวดักของ process — ติดตั้งครั้งเดียว ไม่เปลี่ยนพฤติกรรมเดิมของ Next (ดูข้างใน) */
export function installProcessHandlers(): void {
  if (installed) return;
  installed = true;
  // Next ติดตั้งตัวดัก unhandledRejection ของมันเองอยู่แล้ว (process-error-handlers.js — พิมพ์แล้วทำงานต่อ) ตัวนี้จึงเป็นแค่
  // ตัวที่สอง ไม่ได้ทำให้ process ที่ควรตายไม่ตาย
  process.on("unhandledRejection", (reason) => {
    if (isPostpone(reason)) return;
    void reportServerError(reason, { mechanism: "unhandledRejection" });
  });
  // `uncaughtExceptionMonitor` ไม่ใช่ `uncaughtException`: ตัว monitor แค่ดู ไม่นับเป็นตัวจัดการ — Node ออกหรือไม่ออกตามเดิม
  process.on("uncaughtExceptionMonitor", (error) => {
    if (isPostpone(error)) return;
    void reportServerError(error, { mechanism: "uncaughtException" });
  });
}

/** React postpone ที่ไม่มีใครรับ — เป็นส่วนหนึ่งของการเรนเดอร์ ไม่ใช่ error (Next เองก็ข้าม) */
function isPostpone(value: unknown): boolean {
  return !!value && typeof value === "object" && (value as { $$typeof?: unknown }).$$typeof === Symbol.for("react.postpone");
}

/** รายงานหนึ่งตัว — ไม่ throw และจบภายในราว 1 วินาทีเสมอ */
export async function reportServerError(
  error: unknown,
  options: { mechanism: ServerMechanism; route?: RouteInfo },
): Promise<void> {
  try {
    const { name, message, stack, digest } = describe(error);
    const now = Date.now();
    if (!admit(`${options.mechanism}|${name}|${message}|${options.route?.path ?? ""}`, now)) return;

    const rawPath = options.route?.requestPath ?? null;
    const pathname = rawPath ? rawPath.split(/[?#]/)[0]!.slice(0, 500) : null;
    const route = options.route
      ? {
          path: options.route.path ?? null,
          type: options.route.type ?? null,
          routerKind: options.route.routerKind ?? null,
          method: options.route.method ?? null,
          requestPath: rawPath ? keyNamesOnly(rawPath) : null,
        }
      : undefined;
    console.error(
      `[frontend-error] ${JSON.stringify({
        at: new Date(now).toISOString(),
        mechanism: options.mechanism,
        name,
        message: scrub(message).slice(0, 300),
        route: route?.path ?? null,
        path: pathname ? scrub(pathname) : null,
        digest,
        release: RELEASE,
      })}`,
    );

    const target = (process.env.INTERNAL_API_URL ?? "http://backend:4000").replace(/\/$/, "");
    const token = process.env.INGEST_SERVER_TOKEN ?? "";
    await fetch(`${target}/api/client-errors`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-report-source": "frontend-server",
        ...(token ? { "x-report-token": token } : {}),
      },
      body: reportBody({
        mechanism: options.mechanism,
        level: "error",
        name: name.slice(0, 200),
        message: message.slice(0, 2_000),
        ...(stack ? { stack: stack.slice(0, 16_000) } : {}),
        ...(digest ? { digest } : {}),
        release: RELEASE,
        ...(route ? { route } : {}),
      }),
      signal: AbortSignal.timeout(POST_TIMEOUT_MS),
    }).catch(() => undefined);
  } catch {
    // การรายงานพังต้องไม่พาอะไรพังตาม — บรรทัดของ Next เองยังอยู่
  }
}

/** เพดานต่อนาที และข้อความเดียวกันภายในหนึ่งนาทีนับครั้งเดียว — false = ไม่รายงานตัวนี้ */
function admit(key: string, now: number): boolean {
  if (now - minute.start >= 60_000) {
    minute = { start: now, count: 0 };
    for (const [seen, at] of recent) if (now - at >= REPEAT_WINDOW_MS) recent.delete(seen);
  }
  const last = recent.get(key);
  if (last !== undefined && now - last < REPEAT_WINDOW_MS) return false;
  if (minute.count >= PER_MINUTE) return false;
  minute.count += 1;
  recent.set(key, now);
  return true;
}

function describe(error: unknown): { name: string; message: string; stack?: string; digest?: string } {
  const digestOf = (value: unknown) => {
    const digest = (value as { digest?: unknown } | null)?.digest;
    return typeof digest === "string" ? digest.slice(0, 100) : undefined;
  };
  if (error instanceof Error) {
    return { name: error.name || "Error", message: String(error.message ?? ""), stack: error.stack, digest: digestOf(error) };
  }
  if (typeof error === "string") return { name: "Error", message: error };
  return { name: "NonError", message: Object.prototype.toString.call(error), digest: digestOf(error) };
}

/**
 * ตัวกวาดอย่างย่อสำหรับบรรทัดใน stdout ของ Next server — อีเมล, JWT, `key=value` ของความลับ, ฐานสิบหก/base64 ยาว, เลขยาว
 * (เลขบัตร เบอร์โทร) และ query ของ URL (เหลือแค่ path — กฎเดียวกับ `withoutUrlQueries` ของ backend) ไม่ใช่ตัวเต็มของ backend
 * (backend กวาดซ้ำเองทุกครั้งที่รับ) แค่กันของที่เห็นชัดไม่ให้ไปถึง docker logs
 */
function scrub(text: string): string {
  return withoutUrlQueries(text)
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]")
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g, "[jwt]")
    .replace(/\b(token|key|secret|password|otp|code|state)=[^&\s"']+/gi, "$1=[redacted]")
    .replace(/[A-Za-z0-9_+/-]{32,}={0,2}/g, "[secret]")
    .replace(/\d(?:[\s.-]?\d){8,}/g, "[n]");
}

/**
 * `/p?cid=1101700203451&tab=2#x` → `/p?cid&tab` — pathname กับชื่อ key ของ query เท่านั้น ไม่มีค่า ไม่มี `#…` ชื่อไม่เกิน 20 ตัว
 * ตัวละไม่เกิน 64 อักษร (เพดานเดียวกับ `requestTarget` ของ backend ซึ่งกวาดชื่อซ้ำอีกรอบ) ชื่อยังเข้ารหัส URL อยู่ backend ถอดเอง
 */
function keyNamesOnly(requestPath: string): string {
  const [beforeHash] = requestPath.split("#");
  const cut = beforeHash!.indexOf("?");
  const path = (cut === -1 ? beforeHash! : beforeHash!.slice(0, cut)).slice(0, 500);
  if (cut === -1) return path;
  const names = new Set<string>();
  for (const pair of beforeHash!.slice(cut + 1).split("&")) {
    const name = pair.split("=")[0]!.slice(0, 64);
    if (name) names.add(name);
    if (names.size >= 20) break;
  }
  return names.size > 0 ? `${path}?${[...names].join("&")}` : path;
}

/** URL ในข้อความเหลือแค่ path: คำที่มี `/` ก่อน `?`/`#` ตัวแรกถูกตัดตรงนั้น เหลือ `:บรรทัด:คอลัมน์` ท้ายเฟรมไว้ */
function withoutUrlQueries(text: string): string {
  return text.replace(/[^\s"'`()<>]+/g, (word) => {
    const cut = word.search(/[?#]/);
    if (cut <= 0) return word;
    const path = word.slice(0, cut);
    if (!path.includes("/")) return word;
    return path + (/(?::\d{1,9}){1,2}$/.exec(word.slice(cut))?.[0] ?? "");
  });
}
