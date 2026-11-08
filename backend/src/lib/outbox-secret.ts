/**
 * secret ที่อีเมลต้องพกระหว่างรอ delivery worker — การ์ด "[Enhance] Send every email through the delivery worker" (2026-11-08)
 *
 * คำเชิญ ลิงก์ตั้งรหัสผ่าน และ OTP มี secret ที่ระบบเก็บแค่ HMAC/bcrypt ของมัน worker จึงประกอบอีเมลเองจากฐานข้อมูลไม่ได้ ก่อนการ์ดนี้
 * อีเมลสามชนิดนี้จึงส่ง inline จากคำขอ (ไม่มี retry ไม่มีบันทึก) ตอนนี้ secret อยู่ใน `notification_delivery.secret_payload`
 * **เข้ารหัส** AES-256-GCM ด้วย `OUTBOX_SECRET_KEY` ซึ่งไม่อยู่ในฐานข้อมูล — สำเนาฐานข้อมูลอย่างเดียวอ่านไม่ออก — และถูกลบทันทีที่อีเมล
 * ส่งสำเร็จ ยกเลิก เลิกส่ง หรือ secret หมดอายุ (`secret_expires_at`, ลบโดย worker ทุกรอบ)
 *
 * รูปที่เก็บ: `v1.<iv>.<tag>.<ciphertext>` (base64url) — มีเลขรุ่นเผื่อเปลี่ยนวิธีในอนาคต GCM ตรวจความถูกต้องในตัว แถวที่ถูกแก้ด้วยมือ
 * หรือกุญแจที่ถูกหมุนถอดไม่ออก (`OutboxSecretError`) และ worker ยกเลิกอีเมลนั้นแทนการส่งของผิด
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import { env } from "../env.js";

const VERSION = "v1";
const key = createHash("sha256").update(env.auth.outboxSecretKey, "utf8").digest();

export class OutboxSecretError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutboxSecretError";
  }
}

export function encryptSecret(payload: Record<string, unknown>): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptSecret<T = Record<string, unknown>>(stored: string): T {
  const [version, iv, tag, ciphertext] = stored.split(".");
  if (version !== VERSION || !iv || !tag || !ciphertext) throw new OutboxSecretError("รูปแบบ secret ใน outbox ไม่ถูกต้อง");
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    const plain = Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]);
    return JSON.parse(plain.toString("utf8")) as T;
  } catch {
    throw new OutboxSecretError("ถอดรหัส secret ใน outbox ไม่ได้ — OUTBOX_SECRET_KEY ถูกเปลี่ยน หรือแถวถูกแก้");
  }
}
