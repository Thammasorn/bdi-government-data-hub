import { flushPendingReports, noteApiCall, queueProxyFailure } from "./report-error";

/**
 * ค่าว่าง = เรียกที่ origin เดียวกับหน้าเว็บ แล้วให้ rewrite ใน next.config.ts
 * ส่งต่อไป backend เอง (ดูเหตุผลที่นั่น) — เป็นค่าที่ควรใช้เป็นปกติ
 *
 * ตั้ง NEXT_PUBLIC_API_URL เป็น URL เต็มก็ได้ถ้าจงใจให้ยิงข้ามโดเมน
 * แต่ต้องเพิ่ม origin นั้นใน CORS_ORIGIN ของ backend และรับว่า cookie
 * จะไม่ถูกส่งถ้าสองฝั่งอยู่คนละ registrable domain
 */
const BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

export class ApiError extends Error {
  /** ป้ายให้ lib/report-error.ts แยก error ของ API ออกได้โดยไม่ต้อง import คลาสนี้ (บันเดิล production ย่อชื่อคลาสทิ้ง) */
  readonly kind = "ApiError" as const;
  status: number;
  code: string;
  fields: Record<string, string>;
  /** ส่งกลับมาพร้อม code "exists" — id ของ "คำขอ" เดิมของเขา ไม่ใช่ของหน่วยงาน */
  requestId?: string;
  /**
   * รหัสอ้างอิงของ 5xx (`reference` ใน body — 8 ตัวแรกของ correlation id) ซึ่ง backend ต่อท้าย `message` ให้แล้ว หน้าไหนแสดง
   * `message` ก็แสดงรหัสนี้ไปด้วย ส่วนหน้าที่ใช้ข้อความของตัวเองหยิบจากตรงนี้ได้ · 502 ของ proxy มีรหัสของตัวเอง
   */
  reference?: string;
  /** `x-correlation-id` ของคำตอบ — ตัวเต็มของรหัสอ้างอิง (ไม่มีถ้าเชื่อมต่อไม่ได้เลย) */
  correlationId?: string;
  /**
   * body ทั้งก้อนของคำตอบที่ไม่สำเร็จ — 409 ของ /api/admin/* แนบ id ของสิ่งที่ชนมาด้วย (`holderUserAccountId`,
   * `activationKeyId`, `userAccountId`) ซึ่งหน้า /console ใช้ทำลิงก์ "ไปที่บัญชีนั้น" (lib/admin-errors.ts)
   */
  details: Record<string, unknown>;

  constructor(
    status: number,
    body: {
      error?: string;
      message?: string;
      fields?: Record<string, string>;
      requestId?: string;
      reference?: string;
    },
    correlationId?: string,
  ) {
    super(body.message ?? "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง");
    this.status = status;
    this.code = body.error ?? "unknown";
    this.fields = body.fields ?? {};
    this.requestId = body.requestId;
    this.reference = typeof body.reference === "string" ? body.reference : undefined;
    this.correlationId = correlationId;
    this.details = body as Record<string, unknown>;
  }
}

/**
 * `background` — คำขอเบื้องหลังที่ผู้ใช้ไม่ได้สั่งและกลืน error เอง (poll ของหน้ารายละเอียด กระดิ่ง `/api/auth/me`) ข้อความของมัน
 * ไม่เคยขึ้นจอ รหัสอ้างอิงของ 502 จึงไม่มีใครเห็น ยังเข้าคิวรายงาน **ไม่ใส่ก็ไม่ผิด**: คิวของ lib/report-error.ts ตัดสินว่ารหัสไหน
 * ผู้ใช้เห็นจากหน้าเว็บเอง (`queueProxyFailure`) ป้ายนี้แค่บอกว่าไม่ต้องเฝ้าดูรหัสของคำขอนี้
 */
export interface CallOptions {
  background?: boolean;
}

async function request<T>(path: string, init: RequestInit = {}, options: CallOptions = {}): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      credentials: "include",
      headers:
        init.body instanceof FormData
          ? init.headers
          : { "Content-Type": "application/json", ...init.headers },
    });
  } catch {
    noteApiCall({ method, path, status: 0, correlationId: null });
    throw new ApiError(0, { message: "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบการเชื่อมต่อ" });
  }

  const correlationId = res.headers.get("x-correlation-id") ?? undefined;
  noteApiCall({ method, path, status: res.status, correlationId: correlationId ?? null });

  if (res.status === 204) {
    flushPendingReports();
    return undefined as T;
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new ApiError(res.status, body, correlationId);
    // proxy ต่อ backend ไม่ได้ (app/api/[...path]/route.ts) — backend ไม่เคยเห็นคำขอนี้ จึงต้องรายงานจากเบราว์เซอร์ แต่ส่งตอนนี้
    // ไม่ถึง (backend ล่มอยู่) เก็บไว้ส่งหลังคำขอถัดไปที่สำเร็จ ให้รหัสใน toast ค้นเจอได้ (lib/report-error.ts)
    if (res.status === 502 && error.code === "backend_unreachable") {
      queueProxyFailure(error.reference, { background: options.background === true });
    }
    throw error;
  }
  flushPendingReports();
  return body as T;
}

export const api = {
  get: <T>(path: string, options?: CallOptions) => request<T>(path, {}, options),
  post: <T>(path: string, body?: unknown, options?: CallOptions) =>
    request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) }, options),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) => request<T>(path, { method: "PUT", body: JSON.stringify(body) }),
  /**
   * DELETE ที่มี body และคำตอบ — endpoint ของผู้ดูแลระบบ (/api/admin/*) รับ `reason` ใน body และตอบสิ่งที่ถูกลบกลับมา
   * ต่างจาก `del` ข้างล่างที่เป็นของหน้าฝั่งผู้ใช้ซึ่งไม่ส่งอะไรและไม่อ่านคำตอบ
   */
  remove: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "DELETE", body: body === undefined ? undefined : JSON.stringify(body) }),
  upload: <T>(path: string, form: FormData) => request<T>(path, { method: "POST", body: form }),
  /** ตอบ 204 ไม่มี body — request() คืน undefined ให้เอง จึงประกาศเป็น void */
  del: (path: string) => request<void>(path, { method: "DELETE" }),
  /** URL สำหรับ <iframe>/<img> ที่ต้องส่ง cookie ไปด้วย */
  fileUrl: (path: string) => `${BASE}${path}`,
};
