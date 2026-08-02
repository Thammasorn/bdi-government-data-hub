import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { InvitationStatus, OtpPurpose, UserStatus } from "@prisma/client";

import { prisma } from "../db.js";
import { env } from "../env.js";
import {
  SESSION_COOKIE,
  cookieOptions,
  generateOtp,
  hashPassword,
  hashToken,
  signSession,
  verifyPassword,
} from "../lib/auth.js";
import { sendOtpEmail } from "../lib/mail.js";
import { emailSchema, formatZodError, passwordSchema, phoneSchema } from "../lib/validation.js";
import { requireAuth } from "../middleware/auth.js";
import { ROLE_LABELS } from "../lib/roles.js";

export const authRouter = Router();

const registerSchema = z.object({
  token: z.string().min(1),
  prefix: z.string().trim().min(1, "กรุณาเลือกคำนำหน้า"),
  firstName: z.string().trim().min(1, "กรุณากรอกชื่อ"),
  lastName: z.string().trim().min(1, "กรุณากรอกนามสกุล"),
  phone: phoneSchema,
  password: passwordSchema,
});

/** หา invitation ที่ยังใช้ได้จาก token ดิบ */
async function findLiveInvitation(token: string) {
  const invitation = await prisma.invitation.findUnique({
    where: { tokenHash: hashToken(token) },
  });
  if (!invitation) return { invitation: null, reason: "not_found" as const };
  if (invitation.status !== InvitationStatus.PENDING) {
    return { invitation: null, reason: "used" as const };
  }
  if (invitation.expiresAt < new Date()) {
    await prisma.invitation.update({
      where: { id: invitation.id },
      data: { status: InvitationStatus.EXPIRED },
    });
    return { invitation: null, reason: "expired" as const };
  }
  return { invitation, reason: null };
}

async function issueOtp(email: string) {
  const code = generateOtp();
  // ยกเลิกรหัสเก่าที่ยังไม่ถูกใช้ ป้องกันมีรหัสใช้ได้หลายตัวพร้อมกัน
  await prisma.otpCode.updateMany({
    where: { email, purpose: OtpPurpose.REGISTRATION, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  await prisma.otpCode.create({
    data: {
      email,
      codeHash: await bcrypt.hash(code, 8),
      purpose: OtpPurpose.REGISTRATION,
      expiresAt: new Date(Date.now() + env.auth.otpTtlMinutes * 60_000),
    },
  });
  await sendOtpEmail(email, code);
}

// ---------------------------------------------------------------- ตรวจลิงก์เชิญ

authRouter.get("/invitation", async (req, res) => {
  const token = String(req.query.token ?? "");
  if (!token) {
    res.status(400).json({ error: "invalid", message: "ไม่พบ token" });
    return;
  }
  const { invitation, reason } = await findLiveInvitation(token);
  if (!invitation) {
    const message =
      reason === "expired"
        ? "ลิงก์คำเชิญหมดอายุแล้ว กรุณาติดต่อเจ้าหน้าที่เพื่อขอลิงก์ใหม่"
        : reason === "used"
          ? "ลิงก์คำเชิญนี้ถูกใช้ไปแล้ว หากคุณมีบัญชีอยู่แล้วให้เข้าสู่ระบบ"
          : "ไม่พบลิงก์คำเชิญนี้ในระบบ";
    res.status(410).json({ error: reason, message });
    return;
  }
  res.json({
    email: invitation.email,
    role: invitation.role,
    roleLabel: ROLE_LABELS[invitation.role],
    expiresAt: invitation.expiresAt,
  });
});

// ---------------------------------------------------------------- สมัคร (ขั้นที่ 1)

authRouter.post("/register", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "validation", fields: formatZodError(parsed.error) });
    return;
  }
  const { token, prefix, firstName, lastName, phone, password } = parsed.data;

  const { invitation, reason } = await findLiveInvitation(token);
  if (!invitation) {
    res.status(410).json({ error: reason, message: "ลิงก์คำเชิญใช้งานไม่ได้แล้ว" });
    return;
  }

  const existing = await prisma.user.findUnique({ where: { email: invitation.email } });
  if (existing?.status === UserStatus.ACTIVE) {
    res.status(409).json({ error: "exists", message: "อีเมลนี้มีบัญชีอยู่แล้ว กรุณาเข้าสู่ระบบ" });
    return;
  }

  const data = {
    prefix,
    firstName,
    lastName,
    phone,
    passwordHash: await hashPassword(password),
    roles: [invitation.role],
    status: UserStatus.INVITED,
    organizationId: invitation.organizationId,
  };

  await prisma.user.upsert({
    where: { email: invitation.email },
    create: { email: invitation.email, ...data },
    update: data,
  });

  await issueOtp(invitation.email);
  res.status(202).json({ email: invitation.email, nextStep: "verify_otp" });
});

// ---------------------------------------------------------------- ยืนยัน OTP (ขั้นที่ 2)

authRouter.post("/verify-otp", async (req, res) => {
  const schema = z.object({ token: z.string().min(1), code: z.string().trim().length(6, "รหัสต้องมี 6 หลัก") });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "validation", fields: formatZodError(parsed.error) });
    return;
  }

  const { invitation, reason } = await findLiveInvitation(parsed.data.token);
  if (!invitation) {
    res.status(410).json({ error: reason, message: "ลิงก์คำเชิญใช้งานไม่ได้แล้ว" });
    return;
  }

  const otp = await prisma.otpCode.findFirst({
    where: { email: invitation.email, purpose: OtpPurpose.REGISTRATION, consumedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!otp || otp.expiresAt < new Date()) {
    res.status(400).json({ error: "otp_expired", message: "รหัสหมดอายุแล้ว กรุณากดขอรหัสใหม่" });
    return;
  }
  if (otp.attempts >= env.auth.otpMaxAttempts) {
    await prisma.otpCode.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });
    res.status(429).json({ error: "otp_locked", message: "กรอกรหัสผิดเกินจำนวนที่กำหนด กรุณาขอรหัสใหม่" });
    return;
  }

  if (!(await bcrypt.compare(parsed.data.code, otp.codeHash))) {
    await prisma.otpCode.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
    const left = env.auth.otpMaxAttempts - otp.attempts - 1;
    res.status(400).json({
      error: "otp_invalid",
      message: left > 0 ? `รหัสไม่ถูกต้อง เหลืออีก ${left} ครั้ง` : "รหัสไม่ถูกต้อง กรุณาขอรหัสใหม่",
    });
    return;
  }

  const user = await prisma.$transaction(async (tx) => {
    await tx.otpCode.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });
    await tx.invitation.update({
      where: { id: invitation.id },
      data: { status: InvitationStatus.ACCEPTED, acceptedAt: new Date() },
    });
    return tx.user.update({
      where: { email: invitation.email },
      data: { status: UserStatus.ACTIVE, emailVerifiedAt: new Date(), lastLoginAt: new Date() },
    });
  });

  res.cookie(
    SESSION_COOKIE,
    signSession({
      sub: user.id,
      email: user.email,
      roles: user.roles,
      organizationId: user.organizationId,
    }),
    cookieOptions(),
  );
  res.json({ user: publicUser(user) });
});

// ---------------------------------------------------------------- ThaiD (mock)

/**
 * สเปกให้ยืนยันตัวตนด้วย "email หรือ ThaiD" แต่ยังไม่มี OAuth client จริง
 * endpoint นี้จำลองผลลัพธ์ของการยืนยันสำเร็จ เพื่อให้ทดลอง flow ได้ครบ
 * เปิดด้วย THAID_MOCK=true เท่านั้น — ปิดไว้ทุกที่ที่ไม่ใช่เครื่อง dev
 */
authRouter.post("/thaid/verify", async (req, res) => {
  if (!env.auth.thaidMock) {
    res.status(501).json({
      error: "not_implemented",
      message: "ยังไม่ได้เชื่อมต่อ ThaiD กรุณายืนยันตัวตนด้วยรหัสทางอีเมล",
    });
    return;
  }

  const parsed = z.object({ token: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "validation", fields: formatZodError(parsed.error) });
    return;
  }

  const { invitation, reason } = await findLiveInvitation(parsed.data.token);
  if (!invitation) {
    res.status(410).json({ error: reason, message: "ลิงก์คำเชิญใช้งานไม่ได้แล้ว" });
    return;
  }

  const existing = await prisma.user.findUnique({ where: { email: invitation.email } });
  if (!existing?.passwordHash) {
    res.status(409).json({
      error: "incomplete",
      message: "กรุณากรอกข้อมูลและตั้งรหัสผ่านให้เรียบร้อยก่อน",
    });
    return;
  }

  const user = await prisma.$transaction(async (tx) => {
    await tx.invitation.update({
      where: { id: invitation.id },
      data: { status: InvitationStatus.ACCEPTED, acceptedAt: new Date() },
    });
    await tx.otpCode.updateMany({
      where: { email: invitation.email, purpose: OtpPurpose.REGISTRATION, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    return tx.user.update({
      where: { email: invitation.email },
      data: { status: UserStatus.ACTIVE, emailVerifiedAt: new Date(), lastLoginAt: new Date() },
    });
  });

  console.log(`[thaid:mock] ยืนยันตัวตนจำลองให้ ${user.email}`);

  res.cookie(
    SESSION_COOKIE,
    signSession({
      sub: user.id,
      email: user.email,
      roles: user.roles,
      organizationId: user.organizationId,
    }),
    cookieOptions(),
  );
  res.json({ user: publicUser(user), provider: "thaid-mock" });
});

authRouter.post("/resend-otp", async (req, res) => {
  const token = String(req.body?.token ?? "");
  const { invitation } = await findLiveInvitation(token);
  if (!invitation) {
    res.status(410).json({ error: "invalid", message: "ลิงก์คำเชิญใช้งานไม่ได้แล้ว" });
    return;
  }
  await issueOtp(invitation.email);
  res.status(202).json({ ok: true });
});

// ---------------------------------------------------------------- เข้า/ออกระบบ

authRouter.post("/login", async (req, res) => {
  const schema = z.object({ email: emailSchema, password: z.string().min(1, "กรุณากรอกรหัสผ่าน") });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "validation", fields: formatZodError(parsed.error) });
    return;
  }

  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  // ข้อความเดียวกันทุกกรณี ไม่บอกว่าอีเมลมีอยู่จริงหรือไม่
  const invalid = () =>
    res.status(401).json({ error: "invalid_credentials", message: "อีเมลหรือรหัสผ่านไม่ถูกต้อง" });

  if (!user?.passwordHash || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
    invalid();
    return;
  }
  if (user.status !== UserStatus.ACTIVE) {
    res.status(403).json({
      error: "inactive",
      message:
        user.status === UserStatus.INVITED
          ? "บัญชียังลงทะเบียนไม่เสร็จ กรุณาใช้ลิงก์คำเชิญที่ได้รับทางอีเมล"
          : "บัญชีนี้ถูกระงับการใช้งาน",
    });
    return;
  }

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  res.cookie(
    SESSION_COOKIE,
    signSession({
      sub: user.id,
      email: user.email,
      roles: user.roles,
      organizationId: user.organizationId,
    }),
    cookieOptions(),
  );
  res.json({ user: publicUser(user) });
});

authRouter.post("/logout", (_req, res) => {
  res.clearCookie(SESSION_COOKIE, { ...cookieOptions(), maxAge: undefined });
  res.json({ ok: true });
});

authRouter.get("/me", requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.session!.sub },
    include: { organization: { select: { id: true, name: true, status: true } } },
  });
  if (!user) {
    res.status(401).json({ error: "unauthenticated" });
    return;
  }
  res.json({ user: { ...publicUser(user), organization: user.organization } });
});

function publicUser(user: {
  id: string;
  email: string;
  prefix: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  roles: string[];
  organizationId: string | null;
}) {
  return {
    id: user.id,
    email: user.email,
    prefix: user.prefix,
    firstName: user.firstName,
    lastName: user.lastName,
    phone: user.phone,
    roles: user.roles,
    organizationId: user.organizationId,
  };
}
