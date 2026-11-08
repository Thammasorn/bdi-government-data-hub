/**
 * ทำไมอีเมลส่งไม่สำเร็จ — แปลงความล้มเหลวของ SMTP เป็นหมวด (`notification_delivery.last_error_code`) และเหตุผลภาษาไทยที่บอกว่า **ใครต้องแก้**
 * (การ์ด "[Enhance] Send every email through the delivery worker" ข้อ 3.4) worker เขียนหมวด หน้าจอแปลหมวดเป็นประโยค
 *
 * ข้อความดิบของ SMTP (`550 5.1.1 <…>`) ไม่มีความหมายสำหรับผู้ดูแลระบบ และยกที่อยู่ผู้รับมาด้วย จึงไม่ส่งถึงหน้าจอ
 *
 * **5xx ที่ตอบ `RCPT TO` หรือ `DATA` เท่านั้นที่ถาวร** (ไม่มีกล่องจดหมายนี้ / ไม่รับเนื้อความนี้) — ส่งซ้ำก็ได้ผลเดิม จึงเลิกส่งทันที
 * แทนการลองห้าครั้งราว 45 นาที กฎเดียวกับอีเมลสรุป error (`permanentFailure()` ใน workers/error-alerts.ts): 5xx ตอน login (530/534/535/538)
 * หรือ `MAIL FROM` เป็นการตั้งค่าฝั่งเรา หายเมื่อแก้ จึงลองซ้ำ
 */
const SMTP_AUTH_CODES = new Set([530, 534, 535, 538]);
const NETWORK_CODES = new Set(["ETIMEDOUT", "ECONNECTION", "ECONNREFUSED", "ESOCKET", "EDNS", "ECONNRESET"]);

export type DeliveryErrorCode =
  | "SMTP_REJECTED"
  | "SMTP_AUTH"
  | "SMTP_UNREACHABLE"
  | "SEND_FAILED";

export function classifyDeliveryError(err: unknown): { code: DeliveryErrorCode; permanent: boolean } {
  const { responseCode, code, command } = (err ?? {}) as { responseCode?: unknown; code?: unknown; command?: unknown };
  if (code === "EAUTH" || (typeof responseCode === "number" && SMTP_AUTH_CODES.has(responseCode))) {
    return { code: "SMTP_AUTH", permanent: false };
  }
  if (typeof responseCode === "number" && responseCode >= 500 && responseCode < 600 && (command === "RCPT TO" || command === "DATA")) {
    return { code: "SMTP_REJECTED", permanent: true };
  }
  if (typeof code === "string" && NETWORK_CODES.has(code)) return { code: "SMTP_UNREACHABLE", permanent: false };
  return { code: "SEND_FAILED", permanent: false };
}

export type FixedBy = "admin" | "it" | "none" | "user";

/** หมวด → ประโยคที่หน้าจอแสดง และใครต้องทำอะไร — หมวดที่ไม่รู้จัก (แถวเก่า) ได้ประโยคกลาง */
export function deliveryReason(code: string | null): { reason: string; fixedBy: FixedBy } | null {
  switch (code) {
    case null:
    case undefined:
      return null;
    case "SMTP_REJECTED":
      return { reason: "ไม่มีกล่องจดหมายนี้ หรือปลายทางไม่รับอีเมล — ตรวจอีเมลผู้รับแล้วส่งอีกครั้ง", fixedBy: "admin" };
    case "SMTP_AUTH":
      return { reason: "ระบบเข้าสู่เซิร์ฟเวอร์อีเมลไม่ได้ — แจ้งฝ่าย IT (บัญชีที่ใช้ส่งอีเมล)", fixedBy: "it" };
    case "SMTP_UNREACHABLE":
      return { reason: "เซิร์ฟเวอร์อีเมลไม่ตอบ — ระบบจะลองส่งใหม่เอง", fixedBy: "none" };
    case "SECRET_EXPIRED":
      return { reason: "รหัสหรือลิงก์ในอีเมลหมดอายุก่อนส่งสำเร็จ — สั่งส่งใหม่", fixedBy: "admin" };
    case "SECRET_UNREADABLE":
    case "SECRET_MISSING":
      return { reason: "ไม่มีข้อมูลที่อีเมลฉบับนี้ต้องใช้แล้ว — สั่งส่งใหม่", fixedBy: "admin" };
    case "INVITATION_NOT_PENDING":
      return { reason: "คำเชิญถูกใช้ เพิกถอน หรือมีใบใหม่แทนแล้ว — ไม่ต้องส่ง", fixedBy: "none" };
    case "RESET_LINK_NOT_VALID":
      return { reason: "ลิงก์ถูกใช้ หรือมีลิงก์ใหม่แทนแล้ว — ไม่ต้องส่ง", fixedBy: "none" };
    case "OTP_NOT_VALID":
      return { reason: "รหัสถูกใช้ หรือมีรหัสใหม่แทนแล้ว — ไม่ต้องส่ง", fixedBy: "none" };
    case "ORGANIZATION_FROZEN":
      return { reason: "หน่วยงานถูกระงับหรือยุติ — ยกเลิกไม่ส่ง", fixedBy: "none" };
    case "MAX_ATTEMPTS":
    case "SEND_FAILED":
    default:
      return { reason: "ส่งไม่สำเร็จ — ระบบลองส่งใหม่ตามรอบ ถ้ายังไม่ได้ให้แจ้งฝ่าย IT", fixedBy: "it" };
  }
}
