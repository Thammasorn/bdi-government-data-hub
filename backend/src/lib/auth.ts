import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

import bcrypt from "bcryptjs";

import { env } from "../env.js";
import type { RoleCode } from "./system.js";

export const SESSION_COOKIE = "bdi_session";

/**
 * สิ่งที่ requireAuth ประกอบขึ้นต่อ request — **ไม่ได้อ่านมาจาก cookie**
 *
 * cookie เก็บแค่ค่าสุ่ม opaque ที่ชี้ไปยังแถว `iam.session` ทุกฟิลด์ในนี้มาจากฐานข้อมูล
 * ณ เวลาที่ยิง request (ของเดิมเป็น JWT ที่แบก roles/organizationId มาในตัว แล้วถูก
 * เขียนทับอยู่ดี — payload นั้นจึงมีแต่โอกาสทำให้เข้าใจผิด)
 */
export interface SessionPayload {
  sub: string;
  email: string;
  /** role.code ของ assignment ที่ยังใช้งานได้ ณ เวลาที่อ่าน */
  roles: RoleCode[];
  organizationId: string | null;
  /** id ของแถว iam.session ที่ request นี้เดินทางมาด้วย — ใช้ตอน logout และตอนหมุนใบ */
  sessionId: string;
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/**
 * Token ที่ส่งทางอีเมลเก็บเป็น hash ในฐานข้อมูล ถ้าฐานข้อมูลรั่วก็ยังสวมสิทธิ์ไม่ได้
 * ใช้ SHA-256 ไม่ใช่ bcrypt เพราะต้อง lookup ด้วย token ตรง ๆ (bcrypt salt ต่างกันทุกครั้ง)
 * ปลอดภัยพอเพราะ token สุ่ม 32 ไบต์ ไม่ใช่รหัสผ่านที่คนตั้งเอง
 */
export function generateToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Activation key ตาม sheet `activation_key`
 *
 * รูปแบบที่ sheet แนะนำ: สุ่มอย่างน้อย 32 ไบต์ แล้วเข้ารหัส URL-safe Base64
 * ลิงก์ที่ส่งให้ผู้ใช้: {APP_URL}/activate?token=<raw key>
 *
 * key_hash = HMAC-SHA-256(server_secret, raw_activation_key)
 * ต่างจาก invitation เดิมที่ใช้ SHA-256 เปล่า — ถ้าฐานข้อมูลรั่วโดยที่ server secret
 * ไม่รั่วไปด้วย ผู้โจมตีจะสร้าง key ที่ตรงกับ hash ไม่ได้เลย
 */
export function generateActivationKey(): { key: string; keyHash: string } {
  const key = randomBytes(32).toString("base64url");
  return { key, keyHash: hashActivationKey(key) };
}

export function hashActivationKey(key: string): string {
  return createHmac("sha256", env.auth.activationKeySecret).update(key).digest("hex");
}

/** เทียบ hash แบบคงเวลา กันการเดาค่าจากเวลาที่ใช้เปรียบเทียบ */
export function activationKeyMatches(key: string, storedHash: string): boolean {
  const computed = Buffer.from(hashActivationKey(key), "hex");
  const stored = Buffer.from(storedHash, "hex");
  return computed.length === stored.length && timingSafeEqual(computed, stored);
}

/** OTP 6 หลัก ใช้ randomInt เพื่อไม่ให้เดาลำดับได้ */
export function generateOtp(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/**
 * ค่าที่ใส่ใน cookie `bdi_session` — สุ่ม 32 ไบต์ ไม่มีข้อมูลอยู่ในตัวมันเอง
 *
 * ใช้ `generateToken()` ตัวเดียวกับ activation key/OTP link: 32 ไบต์ base64url
 * เก็บฝั่ง server เป็น SHA-256 ฐานข้อมูลที่รั่วออกไปจึงไม่มี cookie ที่ใช้ได้อยู่ในนั้น
 */
export function generateSessionId(): { sessionId: string; sessionIdHash: string } {
  const { token, tokenHash } = generateToken();
  return { sessionId: token, sessionIdHash: tokenHash };
}

export function cookieOptions() {
  return {
    httpOnly: true,
    // bdi.thammasorn.org กับ bdi-api.thammasorn.org อยู่ใต้ registrable domain
    // เดียวกัน จึงนับเป็น same-site — Lax ส่ง cookie ข้าม subdomain ให้อยู่แล้ว
    // ไม่ต้องใช้ None ซึ่งจะเปิดกว้างเกินจำเป็น
    sameSite: "lax" as const,
    secure: env.auth.cookieSecure,
    path: "/",
    maxAge: env.auth.sessionTtlDays * 24 * 60 * 60 * 1000,
  };
}
