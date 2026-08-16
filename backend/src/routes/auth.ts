import { Router } from "../lib/async-route.js";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { OtpPurpose, UserAccountStatus, type IntegrationOperation } from "@prisma/client";

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
import { AuditAction, AuditSubject, logAudit } from "../lib/audit.js";
import {
  activeRoleCodes,
  completeActivation,
  findUsableActivationKey,
  revokeActivationKey,
  usableActivationKeyById,
} from "../lib/iam.js";
import { sendOtpEmail } from "../lib/mail.js";
import { ROLE_LABELS } from "../lib/roles.js";
import { type RoleCode } from "../lib/system.js";
import {
  ThaidError,
  authorizeUrl,
  resolveIdentity,
  thaidConfigured,
  type ThaidIdentity,
} from "../lib/thaid.js";
import {
  claimThaidState,
  failThaidOperation,
  latestVerification,
  purposeOf,
  startThaidOperation,
  succeedThaidOperation,
  type ThaidPurpose,
} from "../lib/thaid-flow.js";
import { emailSchema, formatZodError, passwordSchema, phoneSchema } from "../lib/validation.js";
import { requireAuth } from "../middleware/auth.js";

export const authRouter = Router();

const ACTIVATION_FAILURE_MESSAGES: Record<string, string> = {
  expired: "ลิงก์คำเชิญหมดอายุแล้ว กรุณาติดต่อเจ้าหน้าที่เพื่อขอลิงก์ใหม่",
  used: "ลิงก์คำเชิญนี้ถูกใช้ไปแล้ว หากคุณมีบัญชีอยู่แล้วให้เข้าสู่ระบบ",
  revoked: "ลิงก์คำเชิญนี้ถูกยกเลิกแล้ว กรุณาติดต่อเจ้าหน้าที่",
  not_found: "ไม่พบลิงก์คำเชิญนี้ในระบบ",
};

async function issueOtp(email: string, purpose: OtpPurpose) {
  const code = generateOtp();
  // ยกเลิกรหัสเก่าที่ยังไม่ถูกใช้ ป้องกันมีรหัสใช้ได้หลายตัวพร้อมกัน
  await prisma.otpCode.updateMany({
    where: { email, purpose, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  await prisma.otpCode.create({
    data: {
      email,
      codeHash: await bcrypt.hash(code, 8),
      purpose,
      expiresAt: new Date(Date.now() + env.auth.otpTtlMinutes * 60_000),
    },
  });
  await sendOtpEmail(email, code);
}

/** ปิดท้ายด้วยเลขสี่ตัวหลัง พอให้ผู้ใช้รู้ว่าต้องยืนยันด้วยบัตรใบไหน แต่ไม่เปิดเลขทั้งชุด */
function maskCid(cid: string | null): string | null {
  return cid ? `${"•".repeat(9)}${cid.slice(-4)}` : null;
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

  // ยืนยัน ThaiD ผ่านแล้วหรือยัง ตัดสินที่ฝั่ง server เสมอ — หน้าเว็บแค่แสดงตาม
  const verification = await latestVerification(key.id);

  res.json({
    email: key.userAccount.email,
    role: key.role.code,
    roleLabel: ROLE_LABELS[key.role.code as RoleCode] ?? key.role.nameTh,
    organizationId: key.organization.id,
    organizationName: key.organization.nameTh,
    expiresAt: key.expiresAt,
    /** บัญชีที่ไม่มีเลขบัตรในระบบยืนยันด้วย ThaiD ไม่ได้ — หน้าเว็บต้องบอกให้ชัด */
    cidHint: maskCid(key.userAccount.cid),
    /**
     * deployment นี้เทียบเลขบัตรจริงหรือไม่ (THAID_REQUIRE_CID_MATCH)
     * หน้าเว็บบอกผู้ใช้ว่าจะเกิดอะไรขึ้น จึงต้องพูดตามที่ระบบทำจริง ไม่ใช่ตามที่สเปกเขียน
     */
    cidCheck: env.thaid.requireCidMatch,
    identityVerified: Boolean(verification),
  });
});

// ---------------------------------------------------------------- ThaiD

const startSchema = z.object({
  purpose: z.enum(["activate", "login"]),
  /** raw activation key — เฉพาะ purpose = activate */
  token: z.string().min(1).optional(),
});

/**
 * ขั้นที่ 1 ของ §2.4 — พาผู้ใช้ไปยืนยันตัวตนที่ ThaiD
 *
 * คืน URL ให้เบราว์เซอร์พาไปเอง แทนที่จะ 302 จาก API เพราะหน้าเว็บเรียกด้วย fetch
 * (ตอบ 302 จะถูก follow แล้วชน CORS ของ imauthsbx.bora.dopa.go.th)
 */
authRouter.post("/thaid/start", async (req, res) => {
  const parsed = startSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "validation", fields: formatZodError(parsed.error) });
    return;
  }
  if (!thaidConfigured() && !env.thaid.mock) {
    res.status(501).json({
      error: "not_configured",
      message: "ระบบยังไม่ได้ตั้งค่าการเชื่อมต่อ ThaiD กรุณาติดต่อผู้ดูแลระบบ",
    });
    return;
  }

  let subjectId: string | undefined;
  let organizationId: string | null = null;

  if (parsed.data.purpose === "activate") {
    if (!parsed.data.token) {
      res.status(400).json({ error: "validation", fields: { token: "ไม่พบ activation key" } });
      return;
    }
    const { key, reason } = await findUsableActivationKey(parsed.data.token);
    if (!key) {
      res.status(410).json({ error: reason, message: ACTIVATION_FAILURE_MESSAGES[reason!] });
      return;
    }
    // ไม่มีเลขบัตรบันทึกไว้ = ไม่มีอะไรให้เทียบ ปิดทางตั้งแต่ต้นดีกว่าปล่อยให้ผู้ใช้
    // เสียเวลาไปยืนยันกับ ThaiD แล้วค่อยล้มตอนกลับมา — เว้นแต่ระบบไม่ได้เทียบอยู่แล้ว
    if (env.thaid.requireCidMatch && !key.userAccount.cid) {
      res.status(409).json({
        error: "cid_missing",
        message:
          "บัญชีนี้ยังไม่มีเลขประจำตัวประชาชนบันทึกไว้ จึงเทียบกับ ThaiD ไม่ได้ กรุณาติดต่อเจ้าหน้าที่",
      });
      return;
    }
    subjectId = key.id;
    organizationId = key.organizationId;
  }

  const { state } = await startThaidOperation({
    purpose: parsed.data.purpose,
    subjectId,
    organizationId,
  });

  /**
   * โหมดจำลอง: ข้ามกรมการปกครองไปเลย ส่งกลับที่หน้า callback ของเราเองพร้อม code ปลอม
   * หน้าเว็บจึงเดินเส้นทางเดียวกันทุกประการ ต่างแค่ไม่มีการเรียกออกนอกระบบ
   */
  const url = env.thaid.mock
    ? `${env.appUrl}/auth/callback/thaid?code=MOCK&state=${encodeURIComponent(state)}`
    : authorizeUrl(state);

  res.json({ authorizeUrl: url, mock: env.thaid.mock });
});

const callbackSchema = z.object({
  state: z.string().min(1),
  code: z.string().min(1).optional(),
  /** ThaiD ส่ง error กลับมาทาง query string เมื่อผู้ใช้ไม่ยินยอมหรือยืนยันไม่ผ่าน */
  error: z.string().optional(),
  errorDescription: z.string().optional(),
});

/**
 * ขั้นที่ 2 ของ §2.4 — รับ authorization code แล้วเทียบเลขบัตร
 *
 * ทั้งขา activate และ login จบที่นี่ เพราะ ThaiD รู้จัก redirect_uri เดียว
 * ตัวที่บอกว่าเป็นขาไหนคือแถว integration_operation ที่ผูกกับ state ไม่ใช่ค่าจากเบราว์เซอร์
 */
authRouter.post("/thaid/callback", async (req, res) => {
  const parsed = callbackSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "validation", fields: formatZodError(parsed.error) });
    return;
  }

  const { operation, reason } = await claimThaidState(parsed.data.state);
  if (!operation) {
    res.status(400).json({
      error: `state_${reason}`,
      message:
        reason === "expired"
          ? "หมดเวลายืนยันตัวตน กรุณาเริ่มใหม่อีกครั้ง"
          : reason === "already_used"
            ? "การยืนยันนี้ถูกใช้ไปแล้ว กรุณาเริ่มใหม่อีกครั้ง"
            : "ไม่พบคำขอยืนยันตัวตนนี้ กรุณาเริ่มใหม่อีกครั้ง",
    });
    return;
  }

  if (parsed.data.error) {
    await failThaidOperation(operation, parsed.data.error, parsed.data.errorDescription ?? "");
    res.status(400).json({
      error: parsed.data.error,
      message:
        parsed.data.error === "user_denied"
          ? "คุณไม่ได้ให้ความยินยอมกับ ThaiD การยืนยันตัวตนจึงไม่สำเร็จ"
          : "ยืนยันตัวตนกับ ThaiD ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง",
    });
    return;
  }
  if (!parsed.data.code) {
    await failThaidOperation(operation, "missing_code", "callback ไม่มี authorization code");
    res.status(400).json({ error: "missing_code", message: "ไม่พบผลการยืนยันจาก ThaiD" });
    return;
  }

  const purpose = purposeOf(operation);

  let identity: ThaidIdentity;
  try {
    identity = env.thaid.mock
      ? await mockIdentity(operation.subjectId, purpose)
      : await resolveIdentity(parsed.data.code);
  } catch (err) {
    const code = err instanceof ThaidError ? err.code : "unexpected";
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`[thaid] ${code}: ${detail}`);
    await failThaidOperation(operation, code, detail);
    res.status(502).json({
      error: "thaid_error",
      message: "ติดต่อระบบ ThaiD ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง",
    });
    return;
  }

  /**
   * ไม่มี pid = เทียบเลขบัตรไม่ได้ ปกติถือเป็นความล้มเหลว เพราะทั้ง §2.4 ตั้งอยู่บนการเทียบ
   * ยกเว้น deployment ที่ตั้ง THAID_REQUIRE_CID_MATCH=false ไว้ (client ยังไม่ได้ scope `pid`)
   * ตรงนั้นเดินต่อโดยผูกบัญชีด้วย `sub` แทน — ดูคำเตือนที่ env.ts
   */
  if (!identity.pid && env.thaid.requireCidMatch) {
    await failThaidOperation(operation, "pid_missing", "ThaiD ไม่ได้ส่ง pid มาด้วย (scope pid?)");
    res.status(502).json({
      error: "pid_missing",
      message: "ระบบไม่ได้รับเลขประจำตัวประชาชนจาก ThaiD จึงยืนยันตัวตนไม่ได้ กรุณาติดต่อผู้ดูแลระบบ",
    });
    return;
  }

  if (purpose === "login") {
    await thaidLogin(res, operation, identity);
    return;
  }

  // ---- ขา activate: เทียบเลขบัตรกับที่บันทึกไว้ตอนสร้างบัญชี
  const { key, reason: keyReason } = await usableActivationKeyById(operation.subjectId);
  if (!key) {
    await failThaidOperation(operation, `key_${keyReason}`, "activation key ใช้ไม่ได้แล้ว");
    res.status(410).json({ error: keyReason, message: ACTIVATION_FAILURE_MESSAGES[keyReason!] });
    return;
  }

  /**
   * เทียบเมื่อมีของให้เทียบครบทั้งสองฝั่ง ถ้า `pid` ไม่มาและ deployment ยอมให้ข้าม
   * (THAID_REQUIRE_CID_MATCH=false) ก็ไม่มีอะไรให้ตัดสิน — ผ่านไปโดยบันทึกไว้ว่าไม่ได้เทียบ
   * แต่ถ้า `pid` มาแล้วไม่ตรง ยังยกเลิกคีย์เหมือนเดิมไม่ว่าจะตั้งค่าไว้อย่างไร
   */
  const cidVerified = Boolean(identity.pid && key.userAccount.cid);
  if ((env.thaid.requireCidMatch || cidVerified) && key.userAccount.cid !== identity.pid) {
    await revokeActivationKey(prisma, {
      activationKeyId: key.id,
      reason: "เลขประจำตัวประชาชนจาก ThaiD ไม่ตรงกับที่บันทึกไว้",
    });
    await failThaidOperation(operation, "cid_mismatch", "เลขบัตรจาก ThaiD ไม่ตรงกับบัญชี");
    await logAudit({
      action: AuditAction.IDENTITY_VERIFICATION_FAILED,
      subjectType: AuditSubject.USER_ACTIVATION_KEY,
      subjectId: key.id,
      organizationId: key.organizationId,
      result: "FAILURE",
      metadata: {
        failure_reason: "CID_MISMATCH",
        user_account_id: key.userAccountId,
        // ไม่บันทึกเลขบัตรของทั้งสองฝั่งลง log — เก็บแค่ subject ที่ ThaiD ออกให้
        thaid_subject: identity.subject,
        integration_operation_id: operation.id,
      },
    });
    res.status(403).json({
      error: "cid_mismatch",
      message:
        "เลขประจำตัวประชาชนที่ยืนยันผ่าน ThaiD ไม่ตรงกับที่บันทึกไว้ในระบบ " +
        "ลิงก์นี้ถูกยกเลิกแล้วเพื่อความปลอดภัย กรุณาติดต่อเจ้าหน้าที่เพื่อขอลิงก์ใหม่",
    });
    return;
  }

  await succeedThaidOperation(operation, identity.subject);
  await logAudit({
    action: AuditAction.IDENTITY_VERIFIED,
    subjectType: AuditSubject.USER_ACTIVATION_KEY,
    subjectId: key.id,
    organizationId: key.organizationId,
    metadata: {
      user_account_id: key.userAccountId,
      thaid_subject: identity.subject,
      integration_operation_id: operation.id,
      /** ผ่านการยืนยันแล้ว แต่ได้เทียบเลขบัตรจริงหรือไม่ — ต่างกันมากตอนย้อนอ่าน log */
      cid_verified: cidVerified,
    },
  });

  res.json({
    purpose: "activate",
    verified: true,
    email: key.userAccount.email,
    /** เอาไว้เติมฟอร์มขั้นสร้างบัญชีให้ตรงกับบัตร ผู้ใช้ยังแก้ได้ */
    profile: {
      prefix: identity.titleTh,
      firstName: identity.givenNameTh,
      lastName: identity.familyNameTh,
      fullName: identity.nameTh,
    },
  });
});

/**
 * เข้าสู่ระบบด้วย ThaiD — จับคู่บัญชีด้วยเลขบัตร ไม่ใช่อีเมล
 *
 * เมื่อ client ไม่ได้รับ scope `pid` ไม่มีเลขบัตรให้จับคู่ จึงใช้ `sub` ที่บันทึกไว้เป็น
 * `external_subject` ตอนเปิดใช้งานบัญชีแทน — หมายความว่าเข้าสู่ระบบด้วย ThaiD ได้เฉพาะ
 * บัญชีที่เคยเปิดใช้งานผ่าน ThaiD ด้วย client ชุดเดียวกันมาก่อน (sub ผูกกับ client)
 */
async function thaidLogin(
  res: import("express").Response,
  operation: IntegrationOperation,
  identity: ThaidIdentity,
) {
  const matches = await prisma.userAccount.findMany({
    where: {
      status: UserAccountStatus.ACTIVE,
      ...(identity.pid ? { cid: identity.pid } : { externalSubject: identity.subject }),
    },
    select: { id: true, email: true, externalSubject: true },
  });

  if (matches.length === 0) {
    await failThaidOperation(
      operation,
      "account_not_found",
      identity.pid ? "ไม่มีบัญชีที่ผูกกับเลขบัตรนี้" : "ไม่มีบัญชีที่ผูกกับ ThaiD บัญชีนี้",
    );
    await logAudit({
      action: AuditAction.LOGIN_FAILED,
      subjectType: AuditSubject.USER_ACCOUNT,
      result: "FAILURE",
      metadata: { failure_reason: "THAID_NO_MATCHING_ACCOUNT", thaid_subject: identity.subject },
    });
    res.status(403).json({
      error: "account_not_found",
      message:
        (identity.pid ? "ไม่พบบัญชีที่ผูกกับเลขประจำตัวประชาชนนี้ " : "ไม่พบบัญชีที่ผูกกับ ThaiD บัญชีนี้ ") +
        "กรุณาเปิดใช้งานบัญชีจากลิงก์คำเชิญก่อน",
    });
    return;
  }
  if (matches.length > 1) {
    // partial unique index กันไว้แค่ระดับ role ต่อหน่วยงาน ไม่ได้กันเลขบัตรซ้ำข้ามหน่วยงาน
    await failThaidOperation(operation, "ambiguous_account", "เลขบัตรนี้ผูกกับหลายบัญชี");
    res.status(409).json({
      error: "ambiguous_account",
      message: "เลขประจำตัวประชาชนนี้ผูกกับหลายบัญชี กรุณาเข้าสู่ระบบด้วยอีเมลและรหัสผ่าน",
    });
    return;
  }

  const user = matches[0]!;
  await prisma.userAccount.update({
    where: { id: user.id },
    data: {
      lastLoginAt: new Date(),
      // external_subject เป็น unique — เขียนเฉพาะตอนที่ยังว่าง ไม่ไปทับของคนอื่น
      ...(user.externalSubject ? {} : { externalSubject: identity.subject }),
      updatedBy: user.id,
    },
  });
  await succeedThaidOperation(operation, identity.subject);
  await logAudit({
    action: AuditAction.LOGIN_SUCCEEDED,
    subjectType: AuditSubject.USER_ACCOUNT,
    subjectId: user.id,
    actorId: user.id,
    metadata: { method: "THAID" },
  });

  await issueSession(res, user.id, { purpose: "login", provider: "thaid" });
}

/**
 * โหมดจำลอง — ใช้เลขบัตรของบัญชีเองเป็นคำตอบ จึง "ตรง" เสมอ
 * มีไว้ให้ deployment ที่ยังไม่มี client credentials เดิน flow ได้เท่านั้น
 */
async function mockIdentity(subjectId: string, purpose: ThaidPurpose): Promise<ThaidIdentity> {
  if (purpose === "login") {
    throw new ThaidError("mock_unsupported", "โหมดจำลองไม่รองรับการเข้าสู่ระบบด้วย ThaiD");
  }
  const { key } = await usableActivationKeyById(subjectId);
  if (!key?.userAccount.cid) {
    throw new ThaidError("mock_unavailable", "บัญชีนี้ไม่มีเลขบัตรให้จำลอง");
  }
  console.log(`[thaid:mock] จำลองการยืนยันตัวตนของ ${key.userAccount.email}`);
  return {
    pid: key.userAccount.cid,
    subject: `thaid-mock:${key.userAccountId}`,
    titleTh: null,
    givenNameTh: null,
    familyNameTh: null,
    nameTh: null,
    nameEn: null,
  };
}

// ---------------------------------------------------------------- สร้างบัญชี (§2.5)

const activateSchema = z.object({
  token: z.string().min(1),
  prefix: z.string().trim().min(1, "กรุณาเลือกคำนำหน้า"),
  firstName: z.string().trim().min(1, "กรุณากรอกชื่อ"),
  lastName: z.string().trim().min(1, "กรุณากรอกนามสกุล"),
  phone: phoneSchema,
  password: passwordSchema,
});

/**
 * ขั้นสุดท้าย: ตั้งรหัสผ่านแล้วเปิดใช้งานบัญชี
 *
 * ไม่มีทางลัดมาถึงตรงนี้ — ต้องมีใบเสร็จ VERIFY_IDENTITY ที่สำเร็จและยังไม่หมดอายุ
 * ของ activation key ใบเดียวกัน มิฉะนั้นตอบ 409 ให้กลับไปยืนยันตัวตนก่อน
 *
 * หมายเหตุ: **ไม่แตะ organization.status** ที่นี่ หน่วยงานจะ ACTIVE เมื่อคำขอ
 * จดทะเบียนผ่าน BDI_FINAL_APPROVAL ตาม Journey B เท่านั้น (ตัดสินไว้ 2026-08-13)
 */
authRouter.post("/activate", async (req, res) => {
  const parsed = activateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "validation", fields: formatZodError(parsed.error) });
    return;
  }
  const { token, prefix, firstName, lastName, phone, password } = parsed.data;

  const { key, reason } = await findUsableActivationKey(token);
  if (!key) {
    res.status(410).json({ error: reason, message: ACTIVATION_FAILURE_MESSAGES[reason!] });
    return;
  }
  if (key.userAccount.status === UserAccountStatus.ACTIVE) {
    res.status(409).json({ error: "exists", message: "อีเมลนี้มีบัญชีอยู่แล้ว กรุณาเข้าสู่ระบบ" });
    return;
  }

  const verification = await latestVerification(key.id);
  if (!verification) {
    res.status(409).json({
      error: "identity_required",
      message: "กรุณายืนยันตัวตนด้วย ThaiD ก่อนตั้งรหัสผ่าน",
    });
    return;
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.userAccount.update({
        where: { id: key.userAccountId },
        data: {
          prefixTh: prefix,
          firstnameTh: firstName,
          lastnameTh: lastName,
          displayName: `${prefix}${firstName} ${lastName}`,
          phoneNumber: phone,
          passwordHash: await hashPassword(password),
          externalSubject: verification.externalReference,
          updatedBy: key.userAccountId,
        },
      });
      await completeActivation(tx, {
        activationKeyId: key.id,
        userAccountId: key.userAccountId,
        roleCode: key.role.code as RoleCode,
        organizationId: key.organizationId,
      });
    });
  } catch (err) {
    // external_subject ซ้ำ = ThaiD คนเดียวกันเคยเปิดบัญชีอื่นไปแล้ว
    // (พูดถึง "บัญชี ThaiD" ไม่ใช่ "เลขบัตร" เพราะเมื่อไม่ได้รับ scope pid ระบบไม่เคยเห็นเลขบัตร)
    if (typeof err === "object" && err && (err as { code?: string }).code === "P2002") {
      res.status(409).json({
        error: "identity_in_use",
        message: "บัญชี ThaiD นี้ถูกใช้เปิดใช้งานบัญชีอื่นในระบบแล้ว กรุณาติดต่อเจ้าหน้าที่",
      });
      return;
    }
    throw err;
  }

  await logAudit({
    action: AuditAction.USER_ACCOUNT_ACTIVATED,
    subjectType: AuditSubject.USER_ACCOUNT,
    subjectId: key.userAccountId,
    actorId: key.userAccountId,
    organizationId: key.organizationId,
    metadata: { method: "THAID", activation_key_id: key.id },
  });

  await issueSession(res, key.userAccountId);
});

// ---------------------------------------------------------------- เข้า/ออกระบบ

/**
 * ขั้นที่ 1 ของการเข้าสู่ระบบด้วยรหัสผ่าน — ถูกต้องแล้วส่ง OTP ทางอีเมล
 *
 * "login โดยวิธี password + otp จาก email หรือจะผ่าน ThaID ก็ได้" (Login Step ของสเปก)
 * จึงไม่ออก session ที่ขั้นนี้ ต้องผ่าน /login/verify-otp ก่อนเสมอ
 */
authRouter.post("/login", async (req, res) => {
  const schema = z.object({ email: emailSchema, password: z.string().min(1, "กรุณากรอกรหัสผ่าน") });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "validation", fields: formatZodError(parsed.error) });
    return;
  }

  const user = await prisma.userAccount.findUnique({ where: { email: parsed.data.email } });
  // ข้อความเดียวกันทุกกรณี ไม่บอกว่าอีเมลมีอยู่จริงหรือไม่
  const invalid = async () => {
    await logAudit({
      action: AuditAction.LOGIN_FAILED,
      subjectType: AuditSubject.USER_ACCOUNT,
      subjectId: user?.id ?? null,
      result: "FAILURE",
      metadata: { failure_reason: "INVALID_CREDENTIAL", email: parsed.data.email },
    });
    res.status(401).json({ error: "invalid_credentials", message: "อีเมลหรือรหัสผ่านไม่ถูกต้อง" });
  };

  if (!user?.passwordHash || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
    await invalid();
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

  await issueOtp(user.email, OtpPurpose.LOGIN);
  res.status(202).json({ email: user.email, nextStep: "verify_otp" });
});

/** ขั้นที่ 2 ของการเข้าสู่ระบบ — ตรวจ OTP แล้วออก session */
authRouter.post("/login/verify-otp", async (req, res) => {
  const schema = z.object({
    email: emailSchema,
    code: z.string().trim().length(6, "รหัสต้องมี 6 หลัก"),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "validation", fields: formatZodError(parsed.error) });
    return;
  }

  const otp = await prisma.otpCode.findFirst({
    where: { email: parsed.data.email, purpose: OtpPurpose.LOGIN, consumedAt: null },
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

  const user = await prisma.userAccount.findUnique({ where: { email: parsed.data.email } });
  if (!user || user.status !== UserAccountStatus.ACTIVE) {
    res.status(403).json({ error: "inactive", message: "บัญชีนี้เข้าสู่ระบบไม่ได้" });
    return;
  }

  await prisma.otpCode.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });
  await prisma.userAccount.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date(), updatedBy: user.id },
  });
  await logAudit({
    action: AuditAction.LOGIN_SUCCEEDED,
    subjectType: AuditSubject.USER_ACCOUNT,
    subjectId: user.id,
    actorId: user.id,
    metadata: { method: "PASSWORD_OTP" },
  });

  await issueSession(res, user.id);
});

/**
 * ขอ OTP ใหม่ระหว่างเข้าสู่ระบบ
 *
 * ไม่รับรหัสผ่านซ้ำ แต่ต้องมี OTP ของรอบนี้ค้างอยู่ก่อน — เป็นหลักฐานว่าขั้นตอนแรก
 * ผ่านไปแล้ว มิฉะนั้น endpoint นี้จะกลายเป็นเครื่องยิงอีเมลให้ที่อยู่ใดก็ได้
 */
authRouter.post("/login/resend-otp", async (req, res) => {
  const parsed = z.object({ email: emailSchema }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "validation", fields: formatZodError(parsed.error) });
    return;
  }
  const pending = await prisma.otpCode.findFirst({
    where: { email: parsed.data.email, purpose: OtpPurpose.LOGIN, consumedAt: null },
  });
  if (!pending) {
    res.status(409).json({ error: "no_pending", message: "กรุณาเข้าสู่ระบบด้วยรหัสผ่านอีกครั้ง" });
    return;
  }
  await issueOtp(parsed.data.email, OtpPurpose.LOGIN);
  res.status(202).json({ ok: true });
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
