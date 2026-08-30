import { Router } from "../lib/async-route.js";
import { z } from "zod";
import bcrypt from "bcryptjs";
import {
  OtpPurpose,
  RoleAssignmentStatus,
  SessionRevokeReason,
  UserAccountStatus,
  type IntegrationOperation,
} from "@prisma/client";

import { prisma } from "../db.js";
import { env } from "../env.js";
import {
  SESSION_COOKIE,
  cookieOptions,
  generateOtp,
  hashPassword,
  verifyPassword,
} from "../lib/auth.js";
import { AuditAction, AuditSubject, logAudit } from "../lib/audit.js";
import {
  activeAssignmentWhere,
  activeRoleCodes,
  completeActivation,
  findUsableActivationKey,
  revokeActivationKey,
  ROLE_REPLACED_REASON,
  usableActivationKeyById,
  type RevokedAssignment,
} from "../lib/iam.js";
import { announceRoleReplacement } from "../lib/notify.js";
import { sendOtpEmail } from "../lib/mail.js";
import { ROLE_LABELS } from "../lib/roles.js";
import {
  activeSessionsFor,
  createSession,
  resolveSession,
  revokeSession,
  revokeSessionsFor,
} from "../lib/session.js";
import { ORGANIZATION_SCOPED_ROLES, type RoleCode } from "../lib/system.js";
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
    identityVerified: Boolean(verification),
    /**
     * ข้อมูลที่มีคนกรอกไว้ให้เจ้าของบัญชีนี้แล้ว — เอาไปเติมฟอร์มสร้างบัญชี
     *
     * ผู้มีอำนาจกระทำการแทนไม่ได้เป็นคนกรอกเรื่องตัวเองไว้ก่อน — เจ้าหน้าที่ของหน่วยงาน
     * กรอกชื่อ นามสกุล และเบอร์โทรของเขาไว้ตั้งแต่ตอนลงทะเบียนหน่วยงาน แล้ว
     * `ensureApproverAccount()` เขียนลง user_account ตอนสร้างบัญชี PENDING ให้
     * ถ้าไม่ส่งกลับไป เขาจะเจอฟอร์มเปล่าและต้องพิมพ์สิ่งที่ระบบรู้อยู่แล้วซ้ำอีกรอบ
     *
     * ปลอดภัยที่จะเปิดโดยไม่ต้องล็อกอิน เพราะความลับคือตัว token ในลิงก์ และค่าเหล่านี้
     * เป็นข้อมูลของเจ้าของลิงก์เอง — เลขบัตรยังปิดไว้เหมือนเดิม (cidHint)
     */
    profile: {
      prefix: key.userAccount.prefixTh,
      firstName: key.userAccount.firstnameTh,
      lastName: key.userAccount.lastnameTh,
      phone: key.userAccount.phoneNumber,
    },
  });
});

// ---------------------------------------------------------------- ค่าตั้งค่าสาธารณะ

/**
 * ค่าที่หน้าเว็บต้องรู้ตั้งแต่ก่อนล็อกอิน — อ่านผ่าน API ไม่ฝังตอน build
 *
 * ทำแบบนี้เพื่อให้ปิดโหมด bypass ได้ด้วยการแก้ env แล้วรีสตาร์ต backend อย่างเดียว
 * ไม่ต้อง build frontend ใหม่ (`NEXT_PUBLIC_*` ฝังตอน build จึงไม่เหมาะ)
 */
authRouter.get("/config", (_req, res) => {
  res.json({ thaidBypass: env.thaid.bypass });
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
  // ⚠️ โหมด SIT: ข้ามการยืนยันกับกรมการปกครองไปก่อน (ดู env.thaid.bypass / docs/16)
  // เข้าสู่ระบบด้วย ThaiD ไม่รองรับในโหมดนี้ — ผู้ทดสอบใช้รหัสผ่าน + OTP แทน
  if (env.thaid.bypass) {
    if (parsed.data.purpose !== "activate") {
      res.status(501).json({
        error: "bypass_login_unsupported",
        message: "โหมดทดสอบยังไม่รองรับการเข้าสู่ระบบด้วย ThaiD กรุณาใช้รหัสผ่านและรหัส OTP",
      });
      return;
    }
    await bypassActivateStart(req, res, parsed.data.token);
    return;
  }

  if (!thaidConfigured()) {
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
    // เสียเวลาไปยืนยันกับ ThaiD แล้วค่อยล้มตอนกลับมา
    if (!key.userAccount.cid) {
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

  const { state, nonce } = await startThaidOperation({
    purpose: parsed.data.purpose,
    subjectId,
    organizationId,
  });

  res.json({ authorizeUrl: authorizeUrl(state, nonce) });
});

/**
 * ⚠️ โหมด SIT เท่านั้น — บันทึกใบเสร็จ "ยืนยันตัวตนแล้ว" ให้ทันทีโดยไม่ผ่าน DOPA
 *
 * เดินตามด่านความปลอดภัยชุดเดียวกับขาจริงทุกข้อ ยกเว้นการเทียบกับกรมการปกครอง:
 * คีย์ต้องใช้ได้ · บัญชีต้องมีเลขบัตรที่เจ้าหน้าที่บันทึกไว้ · แล้วบันทึก
 * integration_operation เป็น SUCCEEDED โดยใช้เลขบัตรของบัญชีเองเป็น external subject
 * ซึ่งเป็นสิ่งที่ callback ของจริงทำเมื่อเลขตรงกัน หน้า /activate จึงเดินต่อได้เหมือนเดิม
 *
 * "เชื่อ" ก็คือเชื่อเลขบัตรที่เจ้าหน้าที่กรอกตอนสร้างบัญชี ไม่ใช่ให้ใครก็ได้ผ่าน —
 * ผู้ที่ถือลิงก์เท่านั้นที่มาถึงตรงนี้ได้ และลิงก์ถูกส่งไปที่อีเมลของผู้ถูกเชิญเท่านั้น
 */
async function bypassActivateStart(
  req: import("express").Request,
  res: import("express").Response,
  token: string | undefined,
) {
  if (!token) {
    res.status(400).json({ error: "validation", fields: { token: "ไม่พบ activation key" } });
    return;
  }
  const { key, reason } = await findUsableActivationKey(token);
  if (!key) {
    res.status(410).json({ error: reason, message: ACTIVATION_FAILURE_MESSAGES[reason!] });
    return;
  }
  if (!key.userAccount.cid) {
    res.status(409).json({
      error: "cid_missing",
      message:
        "บัญชีนี้ยังไม่มีเลขประจำตัวประชาชนบันทึกไว้ จึงยืนยันตัวตนไม่ได้ กรุณาติดต่อเจ้าหน้าที่",
    });
    return;
  }

  const { operation } = await startThaidOperation({
    purpose: "activate",
    subjectId: key.id,
    organizationId: key.organizationId,
  });
  await succeedThaidOperation(operation, key.userAccount.cid);

  await logAudit({
    action: AuditAction.IDENTITY_VERIFIED,
    subjectType: AuditSubject.USER_ACTIVATION_KEY,
    subjectId: key.id,
    organizationId: key.organizationId,
    metadata: {
      user_account_id: key.userAccountId,
      integration_operation_id: operation.id,
      // ทำเครื่องหมายไว้ชัด ๆ ว่าใบนี้มาจากโหมดข้าม ไม่ใช่การยืนยันกับ DOPA จริง
      cid_source: "bypass",
    },
  });

  // frontend เห็น bypass:true แล้วรีโหลดหน้า /activate ให้เข้าขั้นตั้งรหัสผ่านต่อ
  res.json({ bypass: true });
}

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
    // nonce ที่บันทึกไว้ตอน start — เทียบกับ claim ใน id_token ข้างใน resolveIdentity()
    identity = await resolveIdentity(parsed.data.code, operation.requestNonce);
  } catch (err) {
    const code = err instanceof ThaidError ? err.code : "unexpected";
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`[thaid] ${code}: ${detail}`);
    await failThaidOperation(operation, code, detail);

    /**
     * nonce ไม่ตรง = id_token ใบนี้ไม่ได้ออกให้คำขอนี้ ปฏิเสธไปเลย
     *
     * **ไม่เพิกถอน activation key** ด้วยเหตุผลเดียวกับ `cid_unavailable`: ผู้ใช้ไม่ได้
     * ทำอะไรผิด สาเหตุอยู่ที่ฝั่งเราหรือฝั่งกรมการปกครอง (หรือมีคนพยายามยัด id_token
     * ซึ่งก็ยิ่งไม่ควรทำให้ลิงก์ของเหยื่อพัง — นั่นจะกลายเป็นวิธียกเลิกลิงก์ของคนอื่น)
     */
    if (code === "nonce_mismatch" || code === "nonce_missing") {
      res.status(403).json({
        error: code,
        message: "ผลการยืนยันจาก ThaiD ไม่ตรงกับคำขอที่เริ่มไว้ กรุณาเริ่มยืนยันตัวตนใหม่อีกครั้ง",
      });
      return;
    }

    res.status(502).json({
      error: "thaid_error",
      message: "ติดต่อระบบ ThaiD ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง",
    });
    return;
  }

  /**
   * ไม่มีเลขบัตร = เทียบไม่ได้ = ยืนยันตัวตนไม่ได้ ทั้ง §2.4 ตั้งอยู่บนการเทียบ
   *
   * จงใจไม่ยกเลิกคีย์ตรงนี้ ต่างจากกรณี "เลขไม่ตรง" — เลขบัตรที่หายไปหรืออ่านไม่ออก
   * แปลว่าฝั่งเราตั้งค่า claim ไว้ผิด (`THAID_USE_PID` / scope) ไม่ใช่ผู้ใช้ถือบัตรผิดใบ
   * ลงโทษลิงก์ของเขาเพราะเราตั้งค่าพลาดไม่ได้
   */
  if (!identity.pid) {
    const claim = env.thaid.usePid ? "pid" : "sub";
    await failThaidOperation(
      operation,
      "cid_unavailable",
      `claim ${claim} ไม่มา หรือไม่ใช่เลขประจำตัวประชาชนที่ถูกต้อง (THAID_USE_PID/scope ตั้งถูกหรือไม่)`,
    );
    console.error(`[thaid] ไม่ได้เลขบัตรจาก claim ${claim} — ตรวจ THAID_USE_PID และ THAID_SCOPE`);
    res.status(502).json({
      error: "cid_unavailable",
      message: "ระบบไม่ได้รับเลขประจำตัวประชาชนจาก ThaiD จึงยืนยันตัวตนไม่ได้ กรุณาติดต่อผู้ดูแลระบบ",
    });
    return;
  }

  if (purpose === "login") {
    await thaidLogin(req, res, operation, identity);
    return;
  }

  // ---- ขา activate: เทียบเลขบัตรกับที่บันทึกไว้ตอนสร้างบัญชี
  const { key, reason: keyReason } = await usableActivationKeyById(operation.subjectId);
  if (!key) {
    await failThaidOperation(operation, `key_${keyReason}`, "activation key ใช้ไม่ได้แล้ว");
    res.status(410).json({ error: keyReason, message: ACTIVATION_FAILURE_MESSAGES[keyReason!] });
    return;
  }

  if (key.userAccount.cid !== identity.pid) {
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
      /** เลขบัตรที่เทียบมาจาก claim ไหน — ย้อนอ่าน log แล้วรู้ว่าตอนนั้นตั้งค่าไว้อย่างไร */
      cid_source: env.thaid.usePid ? "pid" : "sub",
    },
  });

  res.json({
    purpose: "activate",
    verified: true,
    email: key.userAccount.email,
    /**
     * เอาไว้เติมฟอร์มขั้นสร้างบัญชีให้ตรงกับบัตร ผู้ใช้ยังแก้ได้
     *
     * `prefix` / `fullName` มาจาก claim `title` / `name` ซึ่งไม่ได้อยู่ใน scope ที่ขอ
     * จึงเป็น null ตามปกติ — ปล่อยไว้เผื่อกรมการปกครองส่งมาให้เอง
     */
    /**
     * ThaiD มาก่อน แล้วตกมาที่ชื่อที่เจ้าหน้าที่กรอกไว้ตอนเชิญ
     *
     * `given_name` / `family_name` อยู่ใน scope ที่กรมการปกครองอนุมัติแล้ว เคสปกติจึงได้
     * ชื่อจากบัตรมาเติมให้ ส่วนที่ตกมาใช้ค่าจากคำเชิญคือเคสที่ ThaiD ไม่ได้ทำงาน:
     * โหมด bypass (SIT ใช้อยู่) · ยังไม่ได้ตั้งค่า ThaiD · หรือ DOPA ส่ง claim มาเป็นค่าว่าง
     *
     * คำนำหน้าตกมาที่ค่าจากคำเชิญแทบทุกครั้ง เพราะ claim `title` ไม่ได้อยู่ใน scope
     * ที่ได้รับ (`docs/07` §4.1) — ช่องนี้จึงเป็นช่องที่ค่าจากคำเชิญมีประโยชน์ที่สุด
     */
    profile: {
      prefix: identity.titleTh ?? key.userAccount.prefixTh,
      firstName: identity.givenNameTh ?? key.userAccount.firstnameTh,
      lastName: identity.familyNameTh ?? key.userAccount.lastnameTh,
      firstNameEn: identity.givenNameEn,
      lastNameEn: identity.familyNameEn,
      fullName: identity.nameTh,
    },
  });
});

/** เข้าสู่ระบบด้วย ThaiD — จับคู่บัญชีด้วยเลขบัตร ไม่ใช่อีเมล */
async function thaidLogin(
  req: import("express").Request,
  res: import("express").Response,
  operation: IntegrationOperation,
  identity: ThaidIdentity,
) {
  const matches = await prisma.userAccount.findMany({
    where: { cid: identity.pid, status: UserAccountStatus.ACTIVE },
    select: { id: true, email: true, externalSubject: true },
  });

  if (matches.length === 0) {
    await failThaidOperation(operation, "account_not_found", "ไม่มีบัญชีที่ผูกกับเลขบัตรนี้");
    await logAudit({
      action: AuditAction.LOGIN_FAILED,
      subjectType: AuditSubject.USER_ACCOUNT,
      result: "FAILURE",
      metadata: { failure_reason: "THAID_NO_MATCHING_ACCOUNT", thaid_subject: identity.subject },
    });
    res.status(403).json({
      error: "account_not_found",
      message: "ไม่พบบัญชีที่ผูกกับเลขประจำตัวประชาชนนี้ กรุณาเปิดใช้งานบัญชีจากลิงก์คำเชิญก่อน",
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

  await issueSession(req, res, user.id, { purpose: "login", provider: "thaid" });
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

  /**
   * assignment ของคนที่ถูกแทนที่ตอนมอบ role ให้บัญชีนี้ — ประกาศหลัง transaction commit
   * เท่านั้น audit และอีเมลเขียนผ่าน prisma ตัวหลัก ไม่ใช่ tx จะเรียกจากในนั้นไม่ได้
   */
  let replaced: RevokedAssignment[] = [];

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
      const activation = await completeActivation(tx, {
        activationKeyId: key.id,
        userAccountId: key.userAccountId,
        roleCode: key.role.code as RoleCode,
        organizationId: key.organizationId,
      });
      // ประกาศหลัง commit — เก็บไว้ก่อน ดู announceRoleReplacement()
      replaced = activation.replaced;
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

  await announceRoleReplacement(replaced);

  await issueSession(req, res, key.userAccountId);
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

  await issueSession(req, res, user.id);
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

/**
 * ออกจากระบบบนอุปกรณ์นี้ — **เพิกถอนแถว session จริง ๆ** ไม่ใช่แค่ล้าง cookie
 *
 * ของเดิมล้าง cookie อย่างเดียว สำเนาที่ถูกคัดลอกออกไปก่อนหน้านั้นยังใช้ได้จนครบ 7 วัน
 * ตอนนี้ค่าใน cookie ใช้ไม่ได้อีกทันทีไม่ว่าจะอยู่ในมือใคร
 *
 * ไม่ผ่าน requireAuth: คนที่ถือ cookie ที่หมดอายุแล้วก็ควรล้าง cookie ได้ตามปกติ
 * ตอบ ok เสมอ ไม่บอกว่า cookie ที่ส่งมาใช้ได้อยู่หรือไม่
 */
authRouter.post("/logout", async (req, res) => {
  const presented = req.cookies?.[SESSION_COOKIE];
  if (presented) {
    const { session } = await resolveSession(presented);
    if (session) await revokeSession(prisma, session.id, SessionRevokeReason.LOGOUT);
  }
  res.clearCookie(SESSION_COOKIE, { ...cookieOptions(), maxAge: undefined });
  res.json({ ok: true });
});

/** ออกจากระบบทุกอุปกรณ์ รวมอุปกรณ์ที่กดเองด้วย — ใช้ตอนสงสัยว่า cookie หลุดออกไป */
authRouter.post("/logout-all", requireAuth, async (req, res) => {
  const count = await revokeSessionsFor(prisma, {
    userAccountId: req.session!.sub,
    reason: SessionRevokeReason.LOGOUT_ALL,
  });
  res.clearCookie(SESSION_COOKIE, { ...cookieOptions(), maxAge: undefined });
  res.json({ ok: true, revoked: count });
});

/**
 * session ที่ยังใช้ได้ของบัญชีตัวเอง — ตอบคำถาม "ตอนนี้ใครล็อกอินค้างอยู่บ้าง"
 *
 * ยังไม่มีหน้าจอ (การ์ด §8: ทำ API ก่อน) แต่ต้องมี API ให้พิสูจน์และให้สอบสวนได้
 * ไม่ส่ง `token_hash` ออกไปแม้จะเป็น hash — ไม่มีเหตุผลที่ผู้เรียกต้องรู้
 */
authRouter.get("/sessions", requireAuth, async (req, res) => {
  const sessions = await activeSessionsFor(req.session!.sub);
  res.json({
    sessions: sessions.map((s) => ({
      id: s.id,
      current: s.id === req.session!.sessionId,
      issuedAt: s.issuedAt,
      expiresAt: s.expiresAt,
      lastSeenAt: s.lastSeenAt,
      ipAddress: s.ipAddress,
      userAgent: s.userAgent,
    })),
  });
});

authRouter.get("/me", requireAuth, async (req, res) => {
  const user = await prisma.userAccount.findUnique({ where: { id: req.session!.sub } });
  if (!user) {
    res.status(401).json({ error: "unauthenticated" });
    return;
  }
  res.json({
    user: {
      ...publicUser(user, req.session!.roles, req.session!.organizationId),
      organization: await sessionOrganization(req.session!.organizationId),
      removedFromOrganization: await removedFromOrganization(
        req.session!.sub,
        req.session!.organizationId,
      ),
    },
  });
});

/**
 * หน่วยงานในรูปแบบที่หน้าเว็บใช้ — ชื่อหน่วยงานกับสถานะ ไม่ใช่แค่ id
 *
 * ทั้ง `/me` และ `issueSession` ต้องคืนก้อนนี้เหมือนกัน: หน้าแรกตัดสินจาก
 * `user.organization` ว่าจะพาดหัวด้วยชื่อหน่วยงานหรือด้วยข้อความของผู้มีอำนาจกระทำการแทน
 * ถ้าคำตอบของการล็อกอิน/เปิดใช้งานบัญชีไม่มีก้อนนี้ ผู้ใช้จะเห็นหน้าแรกของอีก role หนึ่ง
 * จนกว่าจะกดรีเฟรช
 */
async function sessionOrganization(organizationId: string | null) {
  if (!organizationId) return null;
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { id: true, nameTh: true, status: true },
  });
  return organization && {
    id: organization.id,
    name: organization.nameTh,
    status: organization.status,
  };
}

/**
 * ผู้ใช้ที่ "หายไปจากหน่วยงาน" เพราะมีคนมารับหน้าที่แทน — ไม่ใช่ผู้ใช้ที่ยังไม่เคยมีหน่วยงาน
 *
 * `assignRole()` บังคับกติกา "หนึ่งหน่วยงานมี ORGANIZATION_USER / ORGANIZATION_APPROVER
 * ที่ ACTIVE ได้อย่างละคน" ด้วยการ **เพิกถอนคนเดิม** ไม่ใช่ปฏิเสธคนใหม่ คนเดิมจึงเสีย
 * หน่วยงานไปกลางคันโดยไม่มีใครบอก แล้วหน้าแรกก็อ่านว่า `organizationId` เป็น null เท่ากับ
 * "ยังไม่มีหน่วยงาน" และเชิญให้ไปสร้างใบใหม่ — ซึ่งสร้างหน่วยงานซ้ำขึ้นมาจริง ๆ
 * (เจอบน main เมื่อ 2026-08-24: บัญชีที่ถูกแทนที่ไปเปิด "หน่วยงานใหม่" ทับของเดิมที่
 * อนุมัติไปแล้ว ทั้งที่ noti "หน่วยงานได้รับอนุมัติแล้ว" ยังค้างอยู่ในกระดิ่ง)
 *
 * ตอบกลับไปให้หน้าเว็บแยกสองกรณีนี้ออกจากกันได้ ยังไม่มีการแจ้งเตือนทางอีเมลตอนถูกถอด
 * และ `revokeRoleAssignments()` ก็ยังไม่เขียน audit_event — ทั้งสองอย่างยังค้างอยู่
 */
async function removedFromOrganization(userAccountId: string, organizationId: string | null) {
  // ยังสังกัดหน่วยงานอยู่ (หรือย้ายไปที่ใหม่แล้ว) ก็ไม่มีอะไรต้องอธิบาย
  if (organizationId) return null;

  const removal = await prisma.userRoleAssignment.findFirst({
    where: {
      userAccountId,
      status: RoleAssignmentStatus.REVOKED,
      revocationReason: ROLE_REPLACED_REASON,
      organizationId: { not: null },
      role: { code: { in: [...ORGANIZATION_SCOPED_ROLES] } },
    },
    orderBy: { revokedAt: "desc" },
    select: {
      revokedAt: true,
      organizationId: true,
      roleId: true,
      organization: { select: { nameTh: true } },
      role: { select: { code: true } },
    },
  });
  if (!removal) return null;

  /**
   * ใครมารับหน้าที่แทน — อ่านจากคนที่ถือ role เดียวกันในหน่วยงานนั้น **อยู่ตอนนี้**
   * ไม่ใช่จาก `revoked_by` ซึ่งเป็นแค่ actor ของ transaction นั้น และไม่ได้แปลว่าเป็น
   * คนที่มาแทนเสมอไป ถ้าหาไม่เจอก็ปล่อยเป็น null — ข้อความยังอ่านรู้เรื่องโดยไม่มีชื่อ
   */
  const successor = await prisma.userRoleAssignment.findFirst({
    where: {
      organizationId: removal.organizationId,
      roleId: removal.roleId,
      ...activeAssignmentWhere(),
    },
    orderBy: { effectiveFrom: "desc" },
    select: { userAccount: { select: { displayName: true } } },
  });

  return {
    organizationName: removal.organization?.nameTh ?? null,
    role: removal.role.code,
    roleLabel: ROLE_LABELS[removal.role.code as RoleCode] ?? removal.role.code,
    removedAt: removal.revokedAt,
    replacedBy: successor?.userAccount.displayName ?? null,
  };
}

/**
 * ออก session ใหม่หนึ่งใบแล้วส่ง id ดิบกลับไปเป็น cookie
 *
 * cookie ไม่มีข้อมูลอยู่ในตัวแล้ว — role กับหน่วยงานที่ตอบกลับไปในนี้มีไว้ให้หน้าเว็บ
 * วาดเมนูรอบแรกเท่านั้น requireAuth อ่านใหม่จากฐานข้อมูลทุก request อยู่ดี
 *
 * **หมุนใบเสมอ**: ถ้าผู้เรียกถือ session ใบเก่ามาอยู่แล้ว ใบนั้นถูกเพิกถอนทิ้ง
 * (`ROTATED`) การเข้าสู่ระบบและการเปิดใช้งานบัญชีคือจุดที่สิทธิ์เปลี่ยนระดับ ปล่อยให้
 * ค่าเดิมใช้ต่อได้คือ session fixation — คนที่ยัด cookie ให้เหยื่อก่อนล็อกอินจะได้
 * session ที่ล็อกอินแล้วไปใช้ฟรี ๆ
 */
async function issueSession(
  req: import("express").Request,
  res: import("express").Response,
  userAccountId: string,
  extra?: object,
) {
  const user = await prisma.userAccount.findUniqueOrThrow({ where: { id: userAccountId } });
  const roles = await activeRoleCodes(prisma, userAccountId);
  /**
   * เรียงให้ role ระดับหน่วยงานมาก่อน ให้ตรงกับที่ requireAuth เลือก — ไม่งั้นคนที่ถือ
   * ทั้ง role ของหน่วยงานและของ BDI จะได้หน่วยงานคนละแห่งใน cookie กับในคำขอถัดไป
   */
  const assignments = await prisma.userRoleAssignment.findMany({
    where: {
      userAccountId,
      organizationId: { not: null },
      status: "ACTIVE",
      OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: new Date() } }],
    },
    select: { organizationId: true, role: { select: { code: true } } },
  });
  const organizationId =
    assignments.find((a) => ORGANIZATION_SCOPED_ROLES.includes(a.role.code as RoleCode))
      ?.organizationId ??
    assignments[0]?.organizationId ??
    null;

  const presented = req.cookies?.[SESSION_COOKIE];
  if (presented) {
    const { session } = await resolveSession(presented);
    if (session) await revokeSession(prisma, session.id, SessionRevokeReason.ROTATED);
  }

  const { sessionId } = await createSession(prisma, userAccountId);
  res.cookie(SESSION_COOKIE, sessionId, cookieOptions());
  res.json({
    user: {
      ...publicUser(user, roles, organizationId),
      organization: await sessionOrganization(organizationId),
      removedFromOrganization: await removedFromOrganization(userAccountId, organizationId),
    },
    ...extra,
  });
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
