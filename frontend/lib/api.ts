const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export class ApiError extends Error {
  status: number;
  code: string;
  fields: Record<string, string>;
  /** ส่งกลับมาพร้อม code "exists" เพื่อพาผู้ใช้ไปที่คำขอเดิมของเขา */
  organizationId?: string;

  constructor(
    status: number,
    body: {
      error?: string;
      message?: string;
      fields?: Record<string, string>;
      organizationId?: string;
    },
  ) {
    super(body.message ?? "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง");
    this.status = status;
    this.code = body.error ?? "unknown";
    this.fields = body.fields ?? {};
    this.organizationId = body.organizationId;
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
  upload: <T>(path: string, form: FormData) => request<T>(path, { method: "POST", body: form }),
  /** URL สำหรับ <iframe>/<img> ที่ต้องส่ง cookie ไปด้วย */
  fileUrl: (path: string) => `${BASE}${path}`,
};
