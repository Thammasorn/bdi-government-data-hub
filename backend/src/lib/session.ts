/**
 * Session ฝั่ง server — ตาราง `iam.session`
 *
 * cookie `bdi_session` เก็บค่าสุ่ม opaque 32 ไบต์ ไม่ใช่ JWT ที่แบก payload มาในตัว
 * สถานะจริงของ session อยู่ในตารางนี้ ซึ่งเป็นสิ่งเดียวที่ทำให้ "เพิกถอนได้จริง" เป็นไปได้:
 * ของเดิม logout ล้างแค่ cookie ในเบราว์เซอร์ตัวเอง สำเนาที่ถูกคัดลอกออกไปยังใช้ได้จนครบ 7 วัน
 *
 * ค่าใช้จ่ายที่เพิ่มขึ้นคือ query อีกหนึ่งครั้งต่อ request ซึ่งแทบไม่มีความหมายที่นี่ —
 * `requireAuth` อ่าน user_account + user_role_assignment ใหม่ทุก request อยู่แล้วโดยตั้งใจ
 * (docs/09-auth-tokens.md §1.3) ระบบนี้จึงไม่เคยได้ประโยชน์ข้อ "ไม่ต้องแตะฐานข้อมูล"
 * ของ stateless JWT ตั้งแต่แรก
 *
 * อายุมีสองชั้นและต้องผ่านทั้งคู่
 *   absolute — `expires_at` = ตอนออก + SESSION_TTL_DAYS ต่ออายุไม่ได้
 *   idle     — `last_seen_at` + SESSION_IDLE_HOURS ขยับทุกครั้งที่ใช้งาน
 */
import { SessionRevokeReason, type Prisma, type Session } from "@prisma/client";

import { prisma } from "../db.js";
import { env } from "../env.js";
import { hashToken, generateSessionId } from "./auth.js";
import { AuditAction, AuditSubject, logAudit } from "./audit.js";
import { currentContext } from "./context.js";
import type { Db } from "./iam.js";

export type SessionRejection = "not_found" | "revoked" | "expired" | "idle";

/**
 * ไม่เขียน `last_seen_at` ทุก request — request เดียวของหน้าเว็บหนึ่งหน้ามีหลายสิบครั้ง
 * ขยับทีละ 1 นาทีก็พอต่อการวัด idle ที่นับเป็นชั่วโมง และประหยัด write ไปเกือบทั้งหมด
 */
const TOUCH_INTERVAL_MS = 60_000;

function absoluteExpiry(from: Date): Date {
  return new Date(from.getTime() + env.auth.sessionTtlDays * 24 * 60 * 60 * 1000);
}

function idleDeadline(lastSeenAt: Date): Date {
  return new Date(lastSeenAt.getTime() + env.auth.sessionIdleHours * 60 * 60 * 1000);
}

/**
 * ออก session ใหม่หนึ่งใบ คืนค่าดิบที่จะไปอยู่ใน cookie (มีอยู่แค่ในหน่วยความจำตอนนี้)
 *
 * `ip_address` / `user_agent` มาจาก request context เดียวกับที่ audit_event ใช้ —
 * เก็บเพื่อให้สอบสวนย้อนหลังได้ว่าใบไหนมาจากที่ใด (ตัดสินไว้ 2026-08-16)
 */
export async function createSession(
  db: Db,
  userAccountId: string,
): Promise<{ sessionId: string; session: Session }> {
  const { sessionId, sessionIdHash } = generateSessionId();
  const ctx = currentContext();
  const now = new Date();

  const session = await db.session.create({
    data: {
      userAccountId,
      tokenHash: sessionIdHash,
      issuedAt: now,
      expiresAt: absoluteExpiry(now),
      lastSeenAt: now,
      userAgent: ctx?.userAgent ?? null,
      ipAddress: ctx?.ipAddress ?? null,
      createdBy: userAccountId,
      updatedBy: userAccountId,
    },
  });

  return { sessionId, session };
}

/**
 * แลกค่าใน cookie เป็นแถว session ที่ยังใช้ได้
 *
 * ใบที่หมดอายุ (ทั้งสองแบบ) ถูกปิดทิ้งตรงนี้เลย ไม่ใช่แค่ตอบปฏิเสธ — ตารางจึงบอกได้
 * ว่าใบไหนตายเพราะอะไร โดยไม่ต้องมี cron มาไล่เก็บ
 */
export async function resolveSession(
  rawSessionId: string,
): Promise<{ session: Session; reason: null } | { session: null; reason: SessionRejection }> {
  const session = await prisma.session.findUnique({ where: { tokenHash: hashToken(rawSessionId) } });
  if (!session) return { session: null, reason: "not_found" };
  if (session.revokedAt) return { session: null, reason: "revoked" };

  const now = new Date();
  if (session.expiresAt <= now) {
    await expire(session, "expired");
    return { session: null, reason: "expired" };
  }
  if (idleDeadline(session.lastSeenAt) <= now) {
    await expire(session, "idle");
    return { session: null, reason: "idle" };
  }

  if (now.getTime() - session.lastSeenAt.getTime() >= TOUCH_INTERVAL_MS) {
    await prisma.session.update({
      where: { id: session.id },
      data: { lastSeenAt: now, updatedBy: session.userAccountId },
    });
  }

  return { session, reason: null };
}

async function expire(session: Session, kind: "expired" | "idle"): Promise<void> {
  await prisma.session.update({
    where: { id: session.id },
    data: {
      revokedAt: new Date(),
      revokedReason: SessionRevokeReason.EXPIRED,
      updatedBy: session.userAccountId,
    },
  });
  await logAudit({
    action: AuditAction.SESSION_REVOKED,
    subjectType: AuditSubject.SESSION,
    subjectId: session.id,
    actorId: session.userAccountId,
    metadata: {
      reason: SessionRevokeReason.EXPIRED,
      expiry_kind: kind === "idle" ? "IDLE" : "ABSOLUTE",
      session_count: 1,
    },
  });
}

/** เพิกถอนใบเดียว — logout และการหมุนใบตอนออก session ใหม่ */
export async function revokeSession(
  db: Db,
  sessionId: string,
  reason: SessionRevokeReason,
): Promise<number> {
  const { count } = await db.session.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
  if (count > 0) {
    await logAudit({
      action: AuditAction.SESSION_REVOKED,
      subjectType: AuditSubject.SESSION,
      subjectId: sessionId,
      metadata: { reason, session_count: count },
    });
  }
  return count;
}

/**
 * เพิกถอนทุกใบของบัญชีหนึ่ง — "ออกจากระบบทุกอุปกรณ์" · เปลี่ยนรหัสผ่าน · ระงับบัญชี
 *
 * `exceptSessionId` มีไว้ให้เส้นทางที่ผู้ใช้เป็นคนสั่งเอง: ใบที่เขากำลังใช้อยู่ควรรอด
 * ไม่งั้นการเปลี่ยนรหัสผ่านจะเตะตัวเองออกทันทีที่ทำสำเร็จ
 */
export async function revokeSessionsFor(
  db: Db,
  params: {
    userAccountId: string;
    reason: SessionRevokeReason;
    exceptSessionId?: string;
  },
): Promise<number> {
  const where: Prisma.SessionWhereInput = {
    userAccountId: params.userAccountId,
    revokedAt: null,
    ...(params.exceptSessionId ? { id: { not: params.exceptSessionId } } : {}),
  };
  const { count } = await db.session.updateMany({
    where,
    data: { revokedAt: new Date(), revokedReason: params.reason },
  });

  if (count > 0) {
    await logAudit({
      action: AuditAction.SESSION_REVOKED,
      subjectType: AuditSubject.USER_ACCOUNT,
      subjectId: params.userAccountId,
      actorId: params.userAccountId,
      metadata: {
        reason: params.reason,
        session_count: count,
        kept_session_id: params.exceptSessionId ?? null,
      },
    });
  }
  return count;
}

/**
 * ใบที่ยังใช้ได้ของบัญชีหนึ่ง — ยังไม่ถูกเพิกถอน ยังไม่หมดอายุทั้งสองแบบ
 *
 * ใบที่เลย idle deadline แต่ยังไม่มีใครเอามายิงจะยังมี `revoked_at` เป็น null อยู่
 * (ปิดตอน resolveSession) จึงต้องกรองด้วยเวลาซ้ำที่นี่ ไม่ใช่เชื่อคอลัมน์อย่างเดียว
 */
export async function activeSessionsFor(userAccountId: string): Promise<Session[]> {
  const now = new Date();
  const rows = await prisma.session.findMany({
    where: { userAccountId, revokedAt: null, expiresAt: { gt: now } },
    orderBy: { lastSeenAt: "desc" },
  });
  return rows.filter((s) => idleDeadline(s.lastSeenAt) > now);
}
