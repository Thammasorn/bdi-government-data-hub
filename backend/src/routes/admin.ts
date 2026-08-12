import { Router } from "express";
import { z } from "zod";
import { ActivationKeyStatus, AccountType, UserAccountStatus } from "@prisma/client";

import { prisma } from "../db.js";
import { issueActivationKey } from "../lib/iam.js";
import { sendInvitationEmail } from "../lib/mail.js";
import { ROLE_LABELS } from "../lib/roles.js";
import {
  BDI_ORGANIZATION_ID,
  ORGANIZATION_SCOPED_ROLES,
  ROLE_CODES,
  SYSTEM_USER_ID,
  type RoleCode,
} from "../lib/system.js";
import { emailSchema, formatZodError } from "../lib/validation.js";
import { requireAdminToken } from "../middleware/auth.js";

export const adminRouter = Router();

adminRouter.use(requireAdminToken);

const inviteSchema = z.object({
  email: emailSchema,
  role: z.enum(Object.values(ROLE_CODES) as [RoleCode, ...RoleCode[]], { error: "role ไม่ถูกต้อง" }),
  organizationId: z.string().uuid().optional(),
  displayName: z.string().trim().min(1).optional(),
});

/**
 * Journey A ขั้นที่ 2 — "Admin ยิง api เพื่อส่งเมล์ invite ให้คนมาสมัคร (ไม่มี UI)"
 *
 *   POST /api/admin/invitations
 *   x-admin-token: <ADMIN_API_TOKEN>
 *   { "email": "...", "role": "ORGANIZATION_USER", "organizationId": "..." }
 *
 * เปลี่ยน contract จากของเดิม: ตาม "Suggested lifecycle" ใน sheet `activation_key`
 * ขั้นที่ 1–3 คือ **สร้าง user_account (PENDING) ก่อน** แล้วค่อยออก activation key
 * ให้บัญชีนั้น ไม่ใช่ผูกคำเชิญไว้กับอีเมลลอย ๆ แบบเดิม
 */
adminRouter.post("/invitations", async (req, res) => {
  const parsed = inviteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "validation", fields: formatZodError(parsed.error) });
    return;
  }
  const { email, role, displayName } = parsed.data;

  const isOrgScoped = ORGANIZATION_SCOPED_ROLES.includes(role);
  // activation_key.organization_id เป็น NOT NULL — เจ้าหน้าที่ BDI ผูกกับหน่วยงาน BDI เอง
  const organizationId = isOrgScoped ? parsed.data.organizationId : BDI_ORGANIZATION_ID;

  if (!organizationId) {
    res.status(400).json({
      error: "validation",
      fields: { organizationId: "role ระดับหน่วยงานต้องระบุ organizationId" },
    });
    return;
  }

  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { id: true },
  });
  if (!organization) {
    res.status(404).json({ error: "not_found", message: "ไม่พบหน่วยงานที่ระบุ" });
    return;
  }

  const existing = await prisma.userAccount.findUnique({ where: { email } });
  if (existing?.status === UserAccountStatus.ACTIVE) {
    res.status(409).json({ error: "exists", message: "อีเมลนี้มีบัญชีในระบบแล้ว" });
    return;
  }

  const result = await prisma.$transaction(async (tx) => {
    const account =
      existing ??
      (await tx.userAccount.create({
        data: {
          email,
          displayName: displayName ?? email,
          accountType: isOrgScoped ? AccountType.ORGANIZATION : AccountType.BDI,
          status: UserAccountStatus.PENDING,
          createdBy: SYSTEM_USER_ID,
          updatedBy: SYSTEM_USER_ID,
        },
      }));

    const { key, record } = await issueActivationKey(tx, {
      userAccountId: account.id,
      organizationId,
      roleCode: role,
      actorId: SYSTEM_USER_ID,
    });

    return { account, key, record };
  });

  await sendInvitationEmail(email, result.key, ROLE_LABELS[role]);

  res.status(201).json({
    activationKeyId: result.record.id,
    userAccountId: result.account.id,
    email,
    role,
    roleLabel: ROLE_LABELS[role],
    organizationId,
    expiresAt: result.record.expiresAt,
  });
});

adminRouter.get("/invitations", async (_req, res) => {
  const keys = await prisma.activationKey.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      status: true,
      issuedAt: true,
      expiresAt: true,
      usedAt: true,
      revokedAt: true,
      createdAt: true,
      userAccount: { select: { id: true, email: true, status: true } },
      role: { select: { code: true, nameTh: true } },
      organization: { select: { id: true, nameTh: true } },
    },
  });
  res.json({ invitations: keys });
});

adminRouter.post("/invitations/:id/revoke", async (req, res) => {
  const key = await prisma.activationKey.findUnique({ where: { id: req.params.id } });
  if (!key || key.status !== ActivationKeyStatus.ISSUED) {
    res.status(404).json({ error: "not_found", message: "ไม่พบคำเชิญที่ยังใช้งานได้" });
    return;
  }
  await prisma.activationKey.update({
    where: { id: key.id },
    data: {
      status: ActivationKeyStatus.REVOKED,
      revokedAt: new Date(),
      revokedBy: SYSTEM_USER_ID,
      revokedReason: String(req.body?.reason ?? "ยกเลิกโดยผู้ดูแลระบบ"),
      updatedBy: SYSTEM_USER_ID,
    },
  });
  res.json({ ok: true });
});
