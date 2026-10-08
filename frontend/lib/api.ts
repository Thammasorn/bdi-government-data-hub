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
  status: number;
  code: string;
  fields: Record<string, string>;
  /** ส่งกลับมาพร้อม code "exists" — id ของ "คำขอ" เดิมของเขา ไม่ใช่ของหน่วยงาน */
  requestId?: string;
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
    },
  ) {
    super(body.message ?? "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง");
    this.status = status;
    this.code = body.error ?? "unknown";
    this.fields = body.fields ?? {};
    this.requestId = body.requestId;
    this.details = body as Record<string, unknown>;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
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
    throw new ApiError(0, { message: "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบการเชื่อมต่อ" });
  }

  if (res.status === 204) return undefined as T;

  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) }),
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
