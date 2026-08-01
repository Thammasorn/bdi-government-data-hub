import { createHash, randomBytes, randomInt } from "node:crypto";

import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { Role } from "@prisma/client";

import { env } from "../env.js";

export const SESSION_COOKIE = "bdi_session";

export interface SessionPayload {
  sub: string;
  email: string;
  roles: Role[];
  organizationId: string | null;
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function signSession(payload: SessionPayload): string {
  return jwt.sign(payload, env.auth.jwtSecret, {
    expiresIn: `${env.auth.sessionTtlDays}d`,
  });
}

export function verifySession(token: string): SessionPayload | null {
  try {
    return jwt.verify(token, env.auth.jwtSecret) as SessionPayload;
  } catch {
    return null;
  }
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

/** OTP 6 หลัก ใช้ randomInt เพื่อไม่ให้เดาลำดับได้ */
export function generateOtp(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: env.nodeEnv === "production",
    path: "/",
    maxAge: env.auth.sessionTtlDays * 24 * 60 * 60 * 1000,
  };
}
