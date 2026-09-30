import { timingSafeEqual } from "node:crypto";

import type { NextFunction, Request, Response } from "express";
import { RoleAssignmentStatus, SessionRevokeReason, UserAccountStatus } from "@prisma/client";

import { prisma } from "../db.js";
import { env } from "../env.js";
import { AuditAction, AuditSubject } from "../lib/audit.js";
import { SESSION_COOKIE, hashToken, tokenFingerprint, type SessionPayload } from "../lib/auth.js";
import { setActor, setAdminTokenFp, setSourceComponent } from "../lib/context.js";
import { resolveSession, revokeSessionsFor } from "../lib/session.js";
import { ORGANIZATION_SCOPED_ROLES, type RoleCode } from "../lib/system.js";
import { createTokenRejectionRecorder } from "../lib/token-rejection.js";

/** ผู้อ่าน log ที่ผ่าน `requireLogReader` — สิ่งที่ `recordLogRead()` ต้องใช้บันทึกการอ่าน */
export interface LogReader {
  /** อีเมลจาก `x-log-reader` ตัวพิมพ์เล็ก — ประกาศเอง ไม่ได้พิสูจน์ */
  reader: string;
  /** ข้อความจาก `x-log-reason` ที่ถอดแล้ว หรือ null ถ้าไม่ได้ส่ง (บังคับเฉพาะบาง endpoint — `requireReadReason`) */
  reason: string | null;
  /** fingerprint ของ `x-log-token` ที่ใช้ — ลง `metadata.token_fp` */
  tokenFp: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      session?: SessionPayload;
      logReader?: LogReader;
    }
  }
}

/**
 * ยืนยันตัวตนจาก cookie แล้ว **อ่านสิทธิ์กับหน่วยงานใหม่จากฐานข้อมูลทุกครั้ง**
 *
 * cookie เก็บค่าสุ่ม opaque ที่ชี้ไปยังแถว `iam.session` — ตัวมันเองไม่ได้บอกอะไรเลย
 * แม้แต่ว่าเป็นของใคร แถว session ต้องยังไม่ถูกเพิกถอนและยังไม่หมดอายุทั้ง absolute
 * และ idle มิฉะนั้น 401 (ดู lib/session.ts)
 *
 * cookie บอกได้แค่ว่า "ใคร" — บอกไม่ได้ว่าตอนนี้คนนั้นอยู่หน่วยงานไหนหรือมี role อะไร
 * เพราะทั้งสองอย่างเปลี่ยนได้ระหว่างที่ session ยังไม่หมดอายุ: ผู้ใช้สร้างหน่วยงาน
 * หรือถูกเพิ่มสิทธิ์ผู้มีอำนาจตอนหน่วยงานส่งให้ลงนาม ถ้าเชื่อค่าใน cookie ต่อไป
 * คนที่เพิ่งสร้างหน่วยงานเสร็จจะยังลงทะเบียนชุดข้อมูลไม่ได้จนกว่าจะออกจากระบบแล้วเข้าใหม่
 *
 * แหล่งข้อมูลย้ายจาก users.roles[] มาที่ iam.user_role_assignment แล้ว แต่กฎเดิมยังอยู่:
 * ห้าม optimise การอ่านนี้ทิ้ง และห้ามอ่าน roles/organizationId จาก JWT
 *
 * assignment ใช้งานได้เมื่อ (sheet `user_role_assignment`):
 *   status = 'ACTIVE' AND (effective_until IS NULL OR effective_until > CURRENT_TIMESTAMP)
 * เงื่อนไข effective_until เป็นตัวที่ทำให้ derived status EXPIRED ถูกตัดออกไปเอง
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const unauthenticated = () =>
    res.status(401).json({ error: "unauthenticated", message: "กรุณาเข้าสู่ระบบ" });

  try {
    const rawSessionId = req.cookies?.[SESSION_COOKIE];
    if (!rawSessionId) {
      unauthenticated();
      return;
    }
    const { session } = await resolveSession(rawSessionId);
    if (!session) {
      unauthenticated();
      return;
    }

    const user = await prisma.userAccount.findUnique({
      where: { id: session.userAccountId },
      select: {
        id: true,
        email: true,
        status: true,
        roleAssignments: {
          where: {
            status: RoleAssignmentStatus.ACTIVE,
            OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: new Date() } }],
          },
          select: { organizationId: true, role: { select: { code: true, isActive: true } } },
        },
      },
    });
    /**
     * บัญชีถูกลบหรือถูกระงับหลัง cookie ออกไปแล้ว — ตัดสิทธิ์ทันที ไม่รอ cookie หมดอายุ
     *
     * ตอนนี้ปิด session ของบัญชีนั้นทิ้งด้วย ไม่ใช่แค่ปฏิเสธ request นี้: การระงับบัญชี
     * ยังไม่มี endpoint ของตัวเอง (ทำผ่านฐานข้อมูลตรง ๆ) แถวที่ค้างอยู่จึงต้องถูกปิด
     * ที่นี่ ไม่งั้น "ดูว่าใครล็อกอินค้างอยู่" จะรวมคนที่เข้าไม่ได้แล้วไปด้วย
     */
    if (!user || user.status !== UserAccountStatus.ACTIVE) {
      await revokeSessionsFor(prisma, {
        userAccountId: session.userAccountId,
        reason: SessionRevokeReason.ACCOUNT_SUSPENDED,
      });
      unauthenticated();
      return;
    }

    // role ที่ถูกปิดใช้งานใน master (is_active = false) ไม่ให้สิทธิ์อีกต่อไป
    const assignments = user.roleAssignments.filter((a) => a.role.isActive);
    const roles = assignments.map((a) => a.role.code as RoleCode);

    /**
     * หน่วยงานของผู้ใช้ — role ระดับหน่วยงานมาก่อน แล้วค่อยตกมาที่ assignment อื่น
     *
     * ลำดับนี้สำคัญกับคนที่ถือทั้งสองฝั่ง (เช่นเจ้าหน้าที่ BDI ที่ถูกเชิญเข้าหน่วยงานด้วย):
     * หน่วยงานที่เขาสังกัดจริงต้องชนะหน่วยงาน BDI ไม่ใช่แล้วแต่ลำดับแถวที่ query คืนมา
     *
     * เจ้าหน้าที่ BDI ได้ id ของหน่วยงาน BDI แล้ว (เดิมเป็น null) — ทุกที่ที่เช็กขอบเขต
     * การมองเห็นดู isBdiStaff() ก่อนอยู่แล้ว ค่านี้จึงไม่ไปแคบสิทธิ์ใคร
     */
    const organizationId =
      assignments.find(
        (a) => a.organizationId && ORGANIZATION_SCOPED_ROLES.includes(a.role.code as RoleCode),
      )?.organizationId ??
      assignments.find((a) => a.organizationId)?.organizationId ??
      null;

    req.session = { sub: user.id, email: user.email, roles, organizationId, sessionId: session.id };
    // ให้ logAudit() รู้ว่าใครเป็นผู้กระทำ โดยไม่ต้องส่ง actorId ผ่านทุกชั้น
    setActor(user.id);
    next();
  } catch (err) {
    next(err);
  }
}

export function requireRole(...allowed: RoleCode[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const roles = req.session?.roles ?? [];
    if (!roles.some((r) => allowed.includes(r))) {
      res.status(403).json({ error: "forbidden", message: "คุณไม่มีสิทธิ์เข้าถึงส่วนนี้" });
      return;
    }
    next();
  };
}

/**
 * เทียบความลับสองค่าโดยใช้เวลาเท่ากันเสมอ ไม่ว่าจะต่างกันตั้งแต่ตัวแรกหรือตัวสุดท้าย
 *
 * `timingSafeEqual` โยนเมื่อความยาวไม่เท่ากัน ซึ่งเท่ากับบอกความยาวของค่าจริงออกไป
 * จึง hash ทั้งสองฝั่งก่อน — ได้ buffer ยาวเท่ากันเสมอ และความยาวของค่าจริงหายไปด้วย
 * (`activationKeyMatches()` ไม่ต้องทำขั้นนี้เพราะเทียบ hash กับ hash อยู่แล้ว)
 */
function secretMatches(provided: string, expected: string): boolean {
  return timingSafeEqual(
    Buffer.from(hashToken(provided), "hex"),
    Buffer.from(hashToken(expected), "hex"),
  );
}

/** ตัวนับการปฏิเสธ `x-admin-token` ของ process นี้ — ดู `requireAdminToken()` */
const adminTokenRejections = createTokenRejectionRecorder(
  AuditAction.ADMIN_TOKEN_REJECTED,
  AuditSubject.ADMIN_API,
  { watchedFps: env.auth.adminTokenWatchFps },
);

/**
 * สเปกระบุว่าขั้นตอนเชิญผู้ใช้ "ไม่มี UI แต่ต้องมี api" จึงป้องกันด้วย shared secret
 * แทนที่จะใช้ session — ผู้เรียกเป็นสคริปต์ฝั่ง admin ไม่ใช่เบราว์เซอร์
 *
 * ข้อจำกัดที่ **ยอมรับไว้ ไม่ใช่มองข้าม** (ตัดสิน 2026-08-16): token นี้ไม่หมดอายุ
 * ไม่หมุน และไม่ผูกกับตัวบุคคล `audit_event` ของงานที่ทำผ่านเส้นทางนี้จึงบอกได้แค่
 * "ระบบทำ" การย้ายไปใช้บัญชีจริงที่มี role `SYSTEM_ADMINISTRATOR` เป็นงานของการ์ด
 * Admin Portal ซึ่งยังไม่มีหน้าจอ — ทำที่นี่จะพัง Postman collection และ notebook
 * ที่ใช้เส้นทางนี้อยู่ โดยที่ยังไม่มีอะไรมาแทน
 *
 * การปฏิเสธทุกครั้งถูกนับ และลง `audit_event` เป็น `ADMIN_TOKEN_REJECTED` แบบ throttle
 * (lib/token-rejection.ts): หน้าต่าง 10 นาทีต่อ IP ภายใต้งบแถวทันที 20 แถวรวมทุก IP ส่วนที่มาหลัง
 * งบหมดลงถังรวมที่ไม่มี IP (`throttle_overflow`) และ token ที่ปลดแล้วตาม `ADMIN_TOKEN_WATCH_FPS`
 * ได้แถวของตัวเองนอกงบนั้น (`watched_token`) — ไม่ await: คำตอบ 401 ไม่รอฐานข้อมูล
 *
 * ผ่านแล้วประทับคำขอเป็น `admin-portal` (มีในรายการ source_component ของ sheet) พร้อม fingerprint
 * ของ token ทุกแถว audit ของคำขอนี้จึงบอกได้ว่ามาทาง admin API — actor ของเส้นทางนี้เป็น "ระบบ"
 * เสมอ `metadata.admin_token_fp` จึงเป็นสิ่งเดียวบนแถวที่บอกว่าใช้ token ใบไหน ตอนหมุน token
 * งานที่ทำด้วยใบเก่ากับใบใหม่จึงแยกกันได้
 */
export function requireAdminToken(req: Request, res: Response, next: NextFunction) {
  const provided = req.header("x-admin-token");
  if (!provided || !secretMatches(provided, env.auth.adminApiToken)) {
    adminTokenRejections.record(req, provided);
    res.status(401).json({ error: "unauthenticated", message: "x-admin-token ไม่ถูกต้อง" });
    return;
  }
  setSourceComponent("admin-portal");
  setAdminTokenFp(tokenFingerprint(provided));
  next();
}

/** ตัวนับการปฏิเสธ `x-log-token` ของ process นี้ — แยกจากของ admin token (หน้าต่างและงบของใครของมัน) */
const logTokenRejections = createTokenRejectionRecorder(AuditAction.LOG_TOKEN_REJECTED, AuditSubject.AUDIT_LOG);

/** อีเมล ASCII ธรรมดา — ผู้อ่านพิมพ์เองใน Postman ไม่ต้องรองรับทุกรูปที่ RFC ยอม แค่ต้องไม่ใช่ข้อความอิสระ */
const READER_EMAIL = /^[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/;
const READER_MAX = 100;
const REASON_MIN = 10;
const REASON_MAX = 500;
/** ชื่อ query ที่ดูเป็นเหตุผล — `?reason=`, `?x-log-reason=`, `?readReason=` … */
const REASON_IN_QUERY = /reason/i;

function validationError(res: Response, field: string, message: string) {
  res.status(400).json({ error: "validation", message, fields: { [field]: message } });
}

/**
 * ถอด `x-log-reason` — ต้องเป็น UTF-8 ที่ percent-encode แล้ว (`encodeURIComponent`) เพราะ header ของ HTTP เป็น ASCII:
 * ภาษาไทยที่ส่งดิบมาถึง Node เป็น latin1 ทีละไบต์ อ่านออกมาเป็นขยะ จึงปฏิเสธแทนการเก็บขยะลงบันทึก
 * คืนข้อความ หรือข้อความของ error ภาษาไทยที่บอกว่าผิดตรงไหน
 */
function decodeReason(raw: string): { reason: string } | { error: string } {
  if (/[^\x20-\x7e]/.test(raw)) {
    return { error: "x-log-reason ต้อง percent-encode (encodeURIComponent) — ส่งภาษาไทยดิบใน header ไม่ได้" };
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return { error: "x-log-reason ถอด percent-encoding ไม่ได้ — ต้องเป็น UTF-8 ที่ผ่าน encodeURIComponent" };
  }
  const reason = decoded.trim();
  if (/[\u0000-\u001f\u007f]/.test(reason)) return { error: "x-log-reason มีอักขระควบคุม (ขึ้นบรรทัดใหม่ ฯลฯ)" };
  const length = [...reason].length;
  if (length < REASON_MIN || length > REASON_MAX) {
    return { error: `x-log-reason ต้องยาว ${REASON_MIN}–${REASON_MAX} ตัวอักษร — บอกว่าอ่านเพื่ออะไร (เช่น เลขเรื่องที่สอบสวน)` };
  }
  return { reason };
}

/**
 * ด่านของ API อ่าน log (`/api/admin/logs/*`, routes/admin-logs.ts) — plan §6, decision 9
 *
 *   1. ไม่ได้ตั้ง `LOG_READ_TOKEN` (หรือ production ตั้งเป็นค่าตัวอย่าง — env.ts) → 503 `log_access_disabled` ไม่เคยเปิดให้
 *      อ่านโดยไม่มี token และไม่ทำให้บูตไม่ขึ้น
 *   2. `x-log-token` ผิดหรือไม่ได้ส่ง → 401 และ `LOG_TOKEN_REJECTED` แบบ throttle (lib/token-rejection.ts ตัวเดียวกับของ admin
 *      token) เทียบด้วย `secretMatches` ใช้เวลาเท่ากันเสมอ
 *   3. มีชื่อ query ที่ดูเป็นเหตุผล → 400: เหตุผลมักมีชื่อคนที่ถูกสอบสวน และ URL ไปจบใน log ของ proxy/edge ทุกชั้น จึงรับได้
 *      ทาง header เท่านั้น — ปฏิเสธดัง ๆ ให้คนแก้ Postman ไม่ใช่ทิ้งค่านั้นเงียบ ๆ ซึ่งทำให้คิดว่าส่งถูกแล้ว
 *   4. `x-log-reader` ต้องเป็นอีเมล ASCII ไม่เกิน 100 ตัว — **ประกาศเอง ไม่ได้พิสูจน์** ใครถือ token ก็ใส่ชื่อใครก็ได้ มันบอกว่า
 *      ผู้ถือ token *อ้างว่า* เป็นใคร (ตัวที่ผูกกับ token จริงคือ `token_fp`)
 *   5. `x-log-reason` ถ้าส่งมาต้องถอดได้และยาว 10–500 ตัว — endpoint ที่บังคับให้ส่งใช้ `requireReadReason` ต่ออีกชั้น
 *
 * ผ่านแล้วประทับคำขอเป็น `log-api` (source_component ของ `AUDIT_LOG_READ` และ `ERROR_ISSUE_STATUS_CHANGED`) และวาง
 * `req.logReader` ไว้ให้ route ใช้บันทึกการอ่าน ไม่แตะ Postgres หรือ Mongo — ด่านนี้ยังทำงานเมื่อทั้งสองล่ม
 */
export function requireLogReader(req: Request, res: Response, next: NextFunction) {
  const expected = env.logStore.readToken;
  if (!expected) {
    res.status(503).json({
      error: "log_access_disabled",
      message: "ยังไม่ได้เปิด API อ่าน log บนระบบนี้ (ไม่ได้ตั้ง LOG_READ_TOKEN)",
    });
    return;
  }
  const provided = req.header("x-log-token");
  if (!provided || !secretMatches(provided, expected)) {
    logTokenRejections.record(req, provided);
    res.status(401).json({ error: "unauthenticated", message: "x-log-token ไม่ถูกต้อง" });
    return;
  }

  const reasonKey = Object.keys(req.query).find((key) => REASON_IN_QUERY.test(key));
  if (reasonKey !== undefined) {
    validationError(
      res,
      reasonKey,
      "ห้ามส่งเหตุผลใน URL (URL ถูกเก็บใน log ของ proxy ทุกชั้น) — ส่งใน header x-log-reason แบบ encodeURIComponent",
    );
    return;
  }

  const reader = (req.header("x-log-reader") ?? "").trim().toLowerCase();
  if (!reader || reader.length > READER_MAX || !READER_EMAIL.test(reader)) {
    validationError(res, "x-log-reader", `ต้องระบุอีเมลของผู้อ่านใน header x-log-reader (ASCII ไม่เกิน ${READER_MAX} ตัว)`);
    return;
  }

  let reason: string | null = null;
  const rawReason = req.header("x-log-reason");
  if (rawReason !== undefined && rawReason.trim() !== "") {
    const decoded = decodeReason(rawReason.trim());
    if ("error" in decoded) {
      validationError(res, "x-log-reason", decoded.error);
      return;
    }
    reason = decoded.reason;
  }

  setSourceComponent("log-api");
  req.logReader = { reader, reason, tokenFp: tokenFingerprint(provided) };
  next();
}

/**
 * endpoint ที่อ่านประวัติการกระทำของคน (activity · timeline · trace) ต้องมีเหตุผล — ติดตั้งหลัง `requireLogReader`
 * endpoint ของ error ไม่บังคับ (เนื้อหาเป็นเรื่องของระบบ ไม่ใช่ของคน) แต่ถ้าส่งมาก็ถูกบันทึกเหมือนกัน
 */
export function requireReadReason(req: Request, res: Response, next: NextFunction) {
  if (!req.logReader?.reason) {
    validationError(
      res,
      "x-log-reason",
      `ต้องระบุเหตุผลที่อ่านใน header x-log-reason (${REASON_MIN}–${REASON_MAX} ตัว แบบ encodeURIComponent)`,
    );
    return;
  }
  next();
}
