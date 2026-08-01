import { Router } from "express";
import { z } from "zod";
import { InvitationStatus, Role, UserStatus } from "@prisma/client";

import { prisma } from "../db.js";
import { env } from "../env.js";
import { generateToken } from "../lib/auth.js";
import { sendInvitationEmail } from "../lib/mail.js";
import { ROLE_LABELS } from "../lib/roles.js";
import { emailSchema, formatZodError } from "../lib/validation.js";
import { requireAdminToken } from "../middleware/auth.js";

export const adminRouter = Router();

adminRouter.use(requireAdminToken);

const inviteSchema = z.object({
  email: emailSchema,
  role: z.nativeEnum(Role, { error: "role ไม่ถูกต้อง" }),
  organizationId: z.string().uuid().optional(),
});

/**
 * Journey A ขั้นที่ 2 — "Admin ยิง api เพื่อส่งเมล์ invite ให้คนมาสมัคร (ไม่มี UI)"
 *
 *   POST /api/admin/invitations
 *   x-admin-token: <ADMIN_API_TOKEN>
 *   { "email": "...", "role": "ORGANIZATION_USER" }
 */
adminRouter.post("/invitations", async (req, res) => {
  const parsed = inviteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "validation", fields: formatZodError(parsed.error) });
    return;
  }
  const { email, role, organizationId } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing?.status === UserStatus.ACTIVE) {
    res.status(409).json({ error: "exists", message: "อีเมลนี้มีบัญชีในระบบแล้ว" });
    return;
  }

  const invitation = await createInvitation(email, role, organizationId ?? null, null);

  res.status(201).json({
    invitationId: invitation.id,
    email,
    role,
    roleLabel: ROLE_LABELS[role],
    expiresAt: invitation.expiresAt,
  });
});

adminRouter.get("/invitations", async (_req, res) => {
  const invitations = await prisma.invitation.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      email: true,
      role: true,
      status: true,
      expiresAt: true,
      acceptedAt: true,
      createdAt: true,
    },
  });
  res.json({ invitations });
});

adminRouter.post("/invitations/:id/revoke", async (req, res) => {
  const invitation = await prisma.invitation.findUnique({ where: { id: req.params.id } });
  if (!invitation || invitation.status !== InvitationStatus.PENDING) {
    res.status(404).json({ error: "not_found", message: "ไม่พบคำเชิญที่ยังใช้งานได้" });
    return;
  }
  await prisma.invitation.update({
    where: { id: invitation.id },
    data: { status: InvitationStatus.REVOKED },
  });
  res.json({ ok: true });
});

/**
 * ออก token ใหม่และส่งอีเมล — ยกเลิกคำเชิญเดิมที่ยังค้างของอีเมลนี้ก่อน
 * เพื่อไม่ให้มีลิงก์ที่ใช้ได้หลายอันพร้อมกัน
 */
export async function createInvitation(
  email: string,
  role: Role,
  organizationId: string | null,
  invitedById: string | null,
) {
  const { token, tokenHash } = generateToken();

  const invitation = await prisma.$transaction(async (tx) => {
    await tx.invitation.updateMany({
      where: { email, status: InvitationStatus.PENDING },
      data: { status: InvitationStatus.REVOKED },
    });
    return tx.invitation.create({
      data: {
        email,
        role,
        tokenHash,
        organizationId,
        invitedById,
        expiresAt: new Date(Date.now() + env.auth.invitationTtlDays * 24 * 60 * 60 * 1000),
      },
    });
  });

  await sendInvitationEmail(email, token, ROLE_LABELS[role]);
  return invitation;
}
