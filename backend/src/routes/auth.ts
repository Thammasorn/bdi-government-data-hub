import { Router } from "../lib/async-route.js";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { OtpPurpose, UserAccountStatus } from "@prisma/client";

import { prisma } from "../db.js";
import { env } from "../env.js";
import {
  SESSION_COOKIE,
  cookieOptions,
  generateOtp,
  hashPassword,
  signSession,
  verifyPassword,
} from "../lib/auth.js";
import { activeRoleCodes, completeActivation, findUsableActivationKey } from "../lib/iam.js";
import { sendOtpEmail } from "../lib/mail.js";
import { ROLE_LABELS } from "../lib/roles.js";
import { ORGANIZATION_SCOPED_ROLES, type RoleCode } from "../lib/system.js";
import { emailSchema, formatZodError, passwordSchema, phoneSchema } from "../lib/validation.js";
import { requireAuth } from "../middleware/auth.js";

export const authRouter = Router();

const registerSchema = z.object({
  token: z.string().min(1),
  prefix: z.string().trim().min(1, "กรุณาเลือกคำนำหน้า"),
  firstName: z.string().trim().min(1, "กรุณากรอกชื่อ"),
  lastName: z.string().trim().min(1, "กรุณากรอกนามสกุล"),
  phone: phoneSchema,
  password: passwordSchema,
  /**
   * เลขบัตรประชาชน — sheet `user_account` มาร์ก cid เป็น Required
   * บังคับเฉพาะบัญชีฝั่งหน่วยงาน เพราะเจ้าหน้าที่ BDI ยังไม่ได้เก็บเลขบัตร
   * (ดู docs/06-db-migration-plan.md §5 ข้อ 1)
   */
  cid: z
    .string()
    .trim()
    .regex(/^\d{13}$/, "เลขประจำตัวประชาชนต้องเป็นตัวเลข 13 หลัก")
    .optional(),
});

const ACTIVATION_FAILURE_MESSAGES: Record<string, string> = {
  expired: "ลิงก์คำเชิญหมดอายุแล้ว กรุณาติดต่อเจ้าหน้าที่เพื่อขอลิงก์ใหม่",
  used: "ลิงก์คำเชิญนี้ถูกใช้ไปแล้ว หากคุณมีบัญชีอยู่แล้วให้เข้าสู่ระบบ",
  revoked: "ลิงก์คำเชิญนี้ถูกยกเลิกแล้ว กรุณาติดต่อเจ้าหน้าที่",
  not_found: "ไม่พบลิงก์คำเชิญนี้ในระบบ",
};

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
  const { key, reason } = await findUsableActivationKey(token);
  if (!key) {
    res.status(410).json({ error: reason, message: ACTIVATION_FAILURE_MESSAGES[reason!] });
    return;
  }
  res.json({
    email: key.userAccount.email,
    role: key.role.code,
    roleLabel: ROLE_LABELS[key.role.code as RoleCode] ?? key.role.nameTh,
    organizationId: key.organization.id,
    organizationName: key.organization.nameTh,
    expiresAt: key.expiresAt,
  });
});

// ---------------------------------------------------------------- สมัคร (ขั้นที่ 1)

authRouter.post("/register", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "validation", fields: formatZodError(parsed.error) });
    return;
  }
  const { token, prefix, firstName, lastName, phone, password, cid } = parsed.data;

  const { key, reason } = await findUsableActivationKey(token);
  if (!key) {
    res.status(410).json({ error: reason, message: ACTIVATION_FAILURE_MESSAGES[reason!] });
    return;
  }

  if (key.userAccount.status === UserAccountStatus.ACTIVE) {
    res.status(409).json({ error: "exists", message: "อีเมลนี้มีบัญชีอยู่แล้ว กรุณาเข้าสู่ระบบ" });
    return;
  }

  if (ORGANIZATION_SCOPED_ROLES.includes(key.role.code as RoleCode) && !cid) {
    res.status(400).json({
      error: "validation",
      fields: { cid: "กรุณากรอกเลขประจำตัวประชาชน 13 หลัก" },
    });
    return;
  }

  await prisma.userAccount.update({
    where: { id: key.userAccountId },
    data: {
      prefixTh: prefix,
      firstnameTh: firstName,
      lastnameTh: lastName,
      displayName: `${prefix}${firstName} ${lastName}`,
      phoneNumber: phone,
      cid: cid ?? undefined,
      passwordHash: await hashPassword(password),
      updatedBy: key.userAccountId,
    },
  });

  await issueOtp(key.userAccount.email);
  res.status(202).json({ email: key.userAccount.email, nextStep: "verify_otp" });
});

// ---------------------------------------------------------------- ยืนยัน OTP (ขั้นที่ 2)

authRouter.post("/verify-otp", async (req, res) => {
  const schema = z.object({
    token: z.string().min(1),
    code: z.string().trim().length(6, "รหัสต้องมี 6 หลัก"),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "validation", fields: formatZodError(parsed.error) });
    return;
  }

  const { key, reason } = await findUsableActivationKey(parsed.data.token);
  if (!key) {
    res.status(410).json({ error: reason, message: ACTIVATION_FAILURE_MESSAGES[reason!] });
    return;
  }

  const email = key.userAccount.email;
  const otp = await prisma.otpCode.findFirst({
    where: { email, purpose: OtpPurpose.REGISTRATION, consumedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!otp || otp.expiresAt < new Date()) {
    res.status(400).json({ error: "otp_expired", message: "รหัสหมดอายุแล้ว กรุณากดขอรหัสใหม่" });
    return;
  }
  if (otp.attempts >= env.auth.otpMaxAttempts) {
    await prisma.otpCode.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });
    res
      .status(429)
      .json({ error: "otp_locked", message: "กรอกรหัสผิดเกินจำนวนที่กำหนด กรุณาขอรหัสใหม่" });
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

  // ขั้นที่ 6–8 ของ lifecycle ใน sheet `activation_key` — ต้องอยู่ใน transaction เดียว
  await prisma.$transaction(async (tx) => {
    await tx.otpCode.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });
    await completeActivation(tx, {
      activationKeyId: key.id,
      userAccountId: key.userAccountId,
      roleCode: key.role.code as RoleCode,
      organizationId: key.organizationId,
    });
  });

  await issueSession(res, key.userAccountId);
});

// ---------------------------------------------------------------- ThaiD (mock)

/**
 * สเปกให้ยืนยันตัวตนด้วย "email หรือ ThaiD" แต่ยังไม่มี OAuth client จริง
 * endpoint นี้จำลองผลลัพธ์ของการยืนยันสำเร็จ เพื่อให้ทดลอง flow ได้ครบ
 * เปิดด้วย THAID_MOCK=true เท่านั้น — ปิดไว้ทุกที่ที่ไม่ใช่เครื่อง dev
 *
 * เมื่อเชื่อม ThaiD จริงแล้ว ค่าที่ได้กลับมาจะลงคอลัมน์ user_account.external_subject
 * ซึ่ง sheet มาร์กว่า Required — ตอนนี้ยังเป็น nullable
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

  const { key, reason } = await findUsableActivationKey(parsed.data.token);
  if (!key) {
    res.status(410).json({ error: reason, message: ACTIVATION_FAILURE_MESSAGES[reason!] });
    return;
  }

  if (!key.userAccount.passwordHash) {
    res.status(409).json({
      error: "incomplete",
      message: "กรุณากรอกข้อมูลและตั้งรหัสผ่านให้เรียบร้อยก่อน",
    });
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.otpCode.updateMany({
      where: {
        email: key.userAccount.email,
        purpose: OtpPurpose.REGISTRATION,
        consumedAt: null,
      },
      data: { consumedAt: new Date() },
    });
    await tx.userAccount.update({
      where: { id: key.userAccountId },
      // ค่าจำลอง — ThaiD จริงจะส่ง subject ของตัวเองมา
      data: { externalSubject: `thaid-mock:${key.userAccountId}`, updatedBy: key.userAccountId },
    });
    await completeActivation(tx, {
      activationKeyId: key.id,
      userAccountId: key.userAccountId,
      roleCode: key.role.code as RoleCode,
      organizationId: key.organizationId,
    });
  });

  console.log(`[thaid:mock] ยืนยันตัวตนจำลองให้ ${key.userAccount.email}`);
  await issueSession(res, key.userAccountId, { provider: "thaid-mock" });
});

authRouter.post("/resend-otp", async (req, res) => {
  const token = String(req.body?.token ?? "");
  const { key } = await findUsableActivationKey(token);
  if (!key) {
    res.status(410).json({ error: "invalid", message: "ลิงก์คำเชิญใช้งานไม่ได้แล้ว" });
    return;
  }
  await issueOtp(key.userAccount.email);
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

  const user = await prisma.userAccount.findUnique({ where: { email: parsed.data.email } });
  // ข้อความเดียวกันทุกกรณี ไม่บอกว่าอีเมลมีอยู่จริงหรือไม่
  const invalid = () =>
    res.status(401).json({ error: "invalid_credentials", message: "อีเมลหรือรหัสผ่านไม่ถูกต้อง" });

  if (!user?.passwordHash || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
    invalid();
    return;
  }
  if (user.status !== UserAccountStatus.ACTIVE) {
    res.status(403).json({
      error: "inactive",
      message:
        user.status === UserAccountStatus.PENDING
          ? "บัญชียังลงทะเบียนไม่เสร็จ กรุณาใช้ลิงก์คำเชิญที่ได้รับทางอีเมล"
          : "บัญชีนี้ถูกระงับการใช้งาน",
    });
    return;
  }

  await prisma.userAccount.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date(), updatedBy: user.id },
  });
  await issueSession(res, user.id);
});

authRouter.post("/logout", (_req, res) => {
  res.clearCookie(SESSION_COOKIE, { ...cookieOptions(), maxAge: undefined });
  res.json({ ok: true });
});

authRouter.get("/me", requireAuth, async (req, res) => {
  const user = await prisma.userAccount.findUnique({ where: { id: req.session!.sub } });
  if (!user) {
    res.status(401).json({ error: "unauthenticated" });
    return;
  }
  const organization = req.session!.organizationId
    ? await prisma.organization.findUnique({
        where: { id: req.session!.organizationId },
        select: { id: true, nameTh: true, status: true },
      })
    : null;

  res.json({
    user: {
      ...publicUser(user, req.session!.roles, req.session!.organizationId),
      organization: organization && {
        id: organization.id,
        name: organization.nameTh,
        status: organization.status,
      },
    },
  });
});

/**
 * ออก session cookie — อ่าน role กับหน่วยงานสดจากฐานข้อมูลเสมอ
 * ตัว cookie เก็บค่าไว้ก็จริง แต่ requireAuth จะอ่านทับใหม่ทุก request อยู่ดี
 */
async function issueSession(res: import("express").Response, userAccountId: string, extra?: object) {
  const user = await prisma.userAccount.findUniqueOrThrow({ where: { id: userAccountId } });
  const roles = await activeRoleCodes(prisma, userAccountId);
  const assignment = await prisma.userRoleAssignment.findFirst({
    where: {
      userAccountId,
      organizationId: { not: null },
      status: "ACTIVE",
      OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: new Date() } }],
    },
    select: { organizationId: true },
  });
  const organizationId = assignment?.organizationId ?? null;

  res.cookie(
    SESSION_COOKIE,
    signSession({ sub: user.id, email: user.email, roles, organizationId }),
    cookieOptions(),
  );
  res.json({ user: publicUser(user, roles, organizationId), ...extra });
}

function publicUser(
  user: {
    id: string;
    email: string;
    prefixTh: string | null;
    firstnameTh: string | null;
    lastnameTh: string | null;
    phoneNumber: string | null;
    displayName: string;
  },
  roles: RoleCode[],
  organizationId: string | null,
) {
  return {
    id: user.id,
    email: user.email,
    prefix: user.prefixTh,
    firstName: user.firstnameTh,
    lastName: user.lastnameTh,
    phone: user.phoneNumber,
    displayName: user.displayName,
    roles,
    organizationId,
  };
}
