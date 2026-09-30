/**
 * รายงาน error ของเบราว์เซอร์ไปที่ log store — `POST /api/client-errors` ของ backend (backend/src/routes/client-errors.ts)
 *
 * ใช้จาก instrumentation-client.ts (error ที่ไม่มีใครจับ), app/global-error.tsx และ lib/api.ts (502 ของ proxy) — ไม่มีหน้าไหน
 * ต้องเรียกเอง กติกา:
 *   - **ไม่รายงาน `ApiError`** ยกเว้น `backend_unreachable` — 4xx เป็นเรื่องของคำขอ 5xx backend เก็บไว้เองแล้วพร้อมรหัสอ้างอิง
 *     ส่วน 502 ของ proxy คือคำขอที่ backend ไม่เคยเห็น จึงต้องมาจากที่นี่ แต่ส่งตอนนั้นไม่ได้ (backend ล่มอยู่) — เก็บไว้ใน
 *     `sessionStorage` (`bdi.pendingErrorReports` ไม่เกิน 5 รายการ ไม่เขียนอะไรอื่นลงไป) แล้วส่งหลังคำขอ API ถัดไปที่สำเร็จ
 *   - ส่งแค่ `location.pathname` ไม่เคยส่ง query hash หรือค่าใด ๆ จาก `sessionStorage` ของหน้า (`?token=` ของหน้า activate,
 *     `?code&state` ของ ThaID) path ของคำขอ API ห้าตัวล่าสุดก็ตัด query ทิ้ง (`noteApiCall`)
 *   - ซ้ำกัน (ข้อความ + เฟรมแรก) ส่งครั้งเดียวต่อการเปิดหน้า และไม่เกิน 10 รายงานต่อการเปิดหน้า
 *   - `navigator.sendBeacon` เป็น `text/plain` (ไม่มี preflight ข้าม origin ในเครื่อง dev และส่งได้แม้หน้ากำลังปิด) ไม่ได้ก็ `fetch`
 *     แบบ keepalive ไม่แนบ cookie — endpoint ไม่ต้อง login และไม่ควรรู้ว่าใครส่ง
 *   - กลืนทุกความล้มเหลว: การรายงาน error ต้องไม่เป็นต้นเหตุของ error
 * backend กวาดทุกช่องซ้ำเอง (lib/redact.ts) ไม่เชื่อสิ่งที่ส่งไป
 */

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "";
/** รุ่นของบันเดิลนี้ — SHA ที่ build (frontend/Dockerfile: GIT_SHA → NEXT_PUBLIC_RELEASE) dev ไม่มี */
const RELEASE = process.env.NEXT_PUBLIC_RELEASE || "dev";
const ENDPOINT = `${BASE}/api/client-errors`;

const MAX_PER_PAGE = 10;
const PENDING_KEY = "bdi.pendingErrorReports";
const PENDING_MAX = 5;
const LAST_API_MAX = 5;

export type ReportMechanism = "window" | "unhandledrejection" | "global-error" | "proxy";

interface ApiCall {
  method: string;
  path: string;
  status: number;
  correlationId: string | null;
}

interface PendingReport {
  reference: string;
  pathname: string;
  at: string;
}

let sent = 0;
const seen = new Set<string>();
const lastApi: ApiCall[] = [];

/** จดคำขอ API ล่าสุด (lib/api.ts เรียกทุกคำตอบ) — path ไม่มี query เก็บแค่ห้าตัว ติดไปกับรายงานถัดไป */
export function noteApiCall(call: ApiCall): void {
  try {
    lastApi.push({ ...call, path: call.path.split("?")[0]!.split("#")[0]!.slice(0, 300) });
    if (lastApi.length > LAST_API_MAX) lastApi.shift();
  } catch {
    // ไม่มีอะไรต้องทำ
  }
}

/**
 * ของที่ throw มาเป็น `ApiError` ของ lib/api.ts ไหม — ดูจากป้าย `kind` ไม่ใช่ `instanceof` (lib/api.ts import ไฟล์นี้) และไม่ใช่
 * `constructor.name` ซึ่งบันเดิล production ย่อชื่อคลาสทิ้ง
 */
function apiErrorOf(value: unknown): { status: number; code: string } | null {
  if (!value || typeof value !== "object") return null;
  const { kind, status, code } = value as { kind?: unknown; status?: unknown; code?: unknown };
  return kind === "ApiError" && typeof status === "number" && typeof code === "string" ? { status, code } : null;
}

function describe(value: unknown): { name: string; message: string; stack?: string } {
  if (value instanceof Error) {
    return { name: value.name || "Error", message: String(value.message ?? ""), stack: value.stack };
  }
  if (typeof value === "string") return { name: "Error", message: value };
  try {
    return { name: "NonError", message: JSON.stringify(value)?.slice(0, 500) ?? String(value) };
  } catch {
    return { name: "NonError", message: String(value) };
  }
}

/**
 * รายงาน error หนึ่งตัว — ไม่ throw ไม่ await `reference` คือรหัสที่ผู้ใช้เห็นบนจอ (หน้า global-error) `digest` คือของ Next
 * สำหรับ error ฝั่ง server ที่ถูกซ่อนข้อความ
 */
export function reportError(
  error: unknown,
  options: { mechanism: ReportMechanism; level?: "error" | "warning"; digest?: string; reference?: string },
): void {
  try {
    const api = apiErrorOf(error);
    if (api) return; // 4xx: เรื่องของคำขอ · 5xx: backend เก็บแล้ว · backend_unreachable: lib/api.ts เข้าคิวเอง
    if (sent >= MAX_PER_PAGE) return;
    const { name, message, stack } = describe(error);
    const firstFrame = (stack ?? "").split("\n").find((line) => /^\s+at\s|@/.test(line)) ?? "";
    const key = `${name}|${message}|${firstFrame}`;
    // รายงานที่มีรหัสอ้างอิงไม่ถูกตัดเป็นตัวซ้ำ: error ที่เรนเดอร์ไม่ผ่านมาถึง `window` `error` ก่อน (React ส่งต่อ) แล้วหน้า
    // global-error รายงานตัวเดียวกันพร้อมรหัสที่ผู้ใช้เห็น — ถ้าตัดตัวหลัง รหัสบนจอจะค้นไม่เจอ
    if (seen.has(key) && !options.reference) return;
    seen.add(key);
    sent += 1;
    send({
      mechanism: options.mechanism,
      level: options.level ?? "error",
      name: name.slice(0, 200),
      message: message.slice(0, 2_000),
      ...(stack ? { stack: stack.slice(0, 16_000) } : {}),
      pathname: currentPathname(),
      ...(options.digest ? { digest: options.digest.slice(0, 100) } : {}),
      ...(options.reference ? { reference: options.reference } : {}),
      release: RELEASE,
      lastApi: [...lastApi],
    });
  } catch {
    // การรายงานพังต้องไม่พาอะไรพังตาม
  }
}

/**
 * 502 ของ proxy (`backend_unreachable`) — เก็บไว้ส่งทีหลัง ตอนนี้ backend ล่มอยู่ ส่งไปก็ไม่ถึง ไม่เกิน 5 รายการ (ตัวเก่าหลุดก่อน)
 * รหัสอ้างอิงเดียวกับที่ผู้ใช้เห็นใน toast ทำให้เจ้าหน้าที่ค้นเจอได้ (Postman G6 — trace แสดงเป็น `reports`)
 */
export function queueProxyFailure(reference: string | undefined): void {
  try {
    if (!reference || !/^[0-9a-f]{8}$/i.test(reference)) return;
    const pending = readPending();
    if (pending.some((item) => item.reference === reference)) return;
    pending.push({ reference, pathname: currentPathname(), at: new Date().toISOString() });
    writePending(pending.slice(-PENDING_MAX));
  } catch {
    // sessionStorage ใช้ไม่ได้ (โหมดส่วนตัว เต็ม) — รายงานนั้นหายไป
  }
}

/** ส่งรายงาน 502 ที่ค้างไว้ — lib/api.ts เรียกหลังคำขอที่สำเร็จ (backend กลับมาแล้ว) ล้างคิวก่อนส่ง จึงไม่ส่งซ้ำ */
export function flushPendingReports(): void {
  try {
    const pending = readPending();
    if (pending.length === 0) return;
    writePending([]);
    for (const item of pending) {
      send({
        mechanism: "proxy",
        level: "error",
        name: "BackendUnreachable",
        message: "backend_unreachable",
        pathname: item.pathname,
        reference: item.reference,
        at: item.at,
        release: RELEASE,
        lastApi: [],
      });
    }
  } catch {
    // ไม่มีอะไรต้องทำ
  }
}

function readPending(): PendingReport[] {
  try {
    const raw = window.sessionStorage.getItem(PENDING_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter(
          (item): item is PendingReport =>
            !!item && typeof item.reference === "string" && typeof item.pathname === "string" && typeof item.at === "string",
        )
      : [];
  } catch {
    return [];
  }
}

function writePending(items: PendingReport[]): void {
  try {
    if (items.length === 0) window.sessionStorage.removeItem(PENDING_KEY);
    else window.sessionStorage.setItem(PENDING_KEY, JSON.stringify(items));
  } catch {
    // ไม่มีอะไรต้องทำ
  }
}

function currentPathname(): string {
  try {
    return window.location.pathname;
  } catch {
    return "";
  }
}

function send(report: Record<string, unknown>): void {
  try {
    const body = JSON.stringify(report);
    const beacon =
      typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function"
        ? navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "text/plain" }))
        : false;
    if (beacon) return;
    void fetch(ENDPOINT, {
      method: "POST",
      body,
      keepalive: true,
      credentials: "omit",
      headers: { "content-type": "text/plain" },
    }).catch(() => undefined);
  } catch {
    // ไม่มีอะไรต้องทำ
  }
}
