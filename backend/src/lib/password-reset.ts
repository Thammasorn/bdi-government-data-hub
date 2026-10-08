/**
 * ลิงก์ตั้งรหัสผ่านใหม่ — `iam.password_reset_token`
 *
 * การ์ด "API ให้ system admin reset password ให้ user" (2026-09-18) ทางเดียวที่ออกใบนี้ได้
 * คือ `POST /api/admin/users/password-reset` ไม่มีปุ่ม "ลืมรหัสผ่าน" ให้กดเอง: ระบบเป็น
 * invite-only และการ์ดสั่งให้แอดมินเป็นคนเริ่ม
 *
 * โทเคนดิบ 32 ไบต์ base64url อยู่ในลิงก์ในอีเมลฉบับเดียว ฐานข้อมูลเก็บ
 * HMAC-SHA-256(ACTIVATION_KEY_SECRET, token) เหมือน activation key — และเทียบด้วย
 * `activationKeyMatches()` ตัวเดียวกันตอนตรวจ
 */
import type { Prisma, PrismaClient } from "@prisma/client";

import { prisma } from "../db.js";
import { env } from "../env.js";
import { activationKeyMatches, generateActivationKey, hashActivationKey } from "./auth.js";
import { SYSTEM_USER_ID } from "./system.js";

export const PASSWORD_RESET_VIA_ADMIN = "ADMIN_API";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * ออกใบใหม่ให้บัญชีหนึ่ง — ใบเก่าที่ยังไม่ถูกใช้ถูกยกเลิกทั้งหมดก่อน
 *
 * หนึ่งบัญชีมีลิงก์ที่ใช้ได้ทีละใบ (กติกาเดียวกับ OTP) เพราะแอดมินที่สั่งซ้ำมักสั่ง
 * เพราะใบแรกไปไม่ถึง ถ้าใบแรกโผล่มาทีหลังแล้วยังใช้ได้ จะมีสองลิงก์ลอยอยู่ในกล่อง
 * จดหมายที่อาจไม่ใช่ของเจ้าตัวคนเดียว
 */
export async function issuePasswordResetToken(
  db: Db,
  userAccountId: string,
  requestedVia: string,
): Promise<{ token: string; record: { id: string; expiresAt: Date } }> {
  await db.passwordResetToken.updateMany({
    where: { userAccountId, usedAt: null, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  const { key: token, keyHash: tokenHash } = generateActivationKey();
  const record = await db.passwordResetToken.create({
    data: {
      userAccountId,
      tokenHash,
      expiresAt: new Date(Date.now() + env.auth.passwordResetTtlMinutes * 60_000),
      requestedVia,
      createdBy: SYSTEM_USER_ID,
    },
    select: { id: true, expiresAt: true },
  });
  return { token, record };
}

export type PasswordResetLookupFailure = "not_found" | "used" | "expired" | "revoked";

const RESET_TOKEN_INCLUDE = {
  userAccount: {
    select: {
      id: true,
      email: true,
      status: true,
      prefixTh: true,
      firstnameTh: true,
      lastnameTh: true,
    },
  },
} as const;

export type PasswordResetRecord = Prisma.PasswordResetTokenGetPayload<{
  include: typeof RESET_TOKEN_INCLUDE;
}>;

/**
 * หาใบที่ยังใช้ได้จากโทเคนดิบ — เหตุผลที่ใช้ไม่ได้แยกเป็นสี่แบบเพราะหน้าจอต้องบอกคนละอย่าง:
 * "ใช้ไปแล้ว" ให้ไปเข้าสู่ระบบ ส่วน "หมดอายุ/ถูกยกเลิก" ให้ขอลิงก์ใหม่
 *
 * ค้นด้วย hash โดยตรง (unique index) แล้วเทียบซ้ำแบบคงเวลาอีกชั้นเหมือน activation key
 */
export async function findUsablePasswordResetToken(
  rawToken: string,
): Promise<{ record: PasswordResetRecord; reason: null } | { record: null; reason: PasswordResetLookupFailure }> {
  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashActivationKey(rawToken) },
    include: RESET_TOKEN_INCLUDE,
  });
  if (!record || !activationKeyMatches(rawToken, record.tokenHash)) {
    return { record: null, reason: "not_found" };
  }
  if (record.usedAt) return { record: null, reason: "used" };
  if (record.revokedAt) return { record: null, reason: "revoked" };
  if (record.expiresAt < new Date()) return { record: null, reason: "expired" };
  return { record, reason: null };
}
