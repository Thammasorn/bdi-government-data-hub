import { timingSafeEqual } from "node:crypto";

import type { NextFunction, Request, Response } from "express";
import { RoleAssignmentStatus, SessionRevokeReason, UserAccountStatus } from "@prisma/client";

import { prisma } from "../db.js";
import { env } from "../env.js";
import { SESSION_COOKIE, hashToken, type SessionPayload } from "../lib/auth.js";
import { setActor, setAdminVia } from "../lib/context.js";
import { resolveSession, revokeSessionsFor } from "../lib/session.js";
import { ORGANIZATION_SCOPED_ROLES, ROLE_CODES, type RoleCode } from "../lib/system.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      session?: SessionPayload;
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

/**
 * สเปกระบุว่าขั้นตอนเชิญผู้ใช้ "ไม่มี UI แต่ต้องมี api" จึงป้องกันด้วย shared secret
 * แทนที่จะใช้ session — ผู้เรียกเป็นสคริปต์ฝั่ง admin ไม่ใช่เบราว์เซอร์
 *
 * ข้อจำกัดที่ **ยอมรับไว้ ไม่ใช่มองข้าม** (ตัดสิน 2026-08-16): token นี้ไม่หมดอายุ
 * ไม่หมุน และไม่ผูกกับตัวบุคคล `audit_event` ของงานที่ทำผ่านเส้นทางนี้จึงบอกได้แค่
 * "ระบบทำ" ทางที่ผูกกับคนคือหน้า /console ด้วยบัญชีที่มี role `SYSTEM_ADMINISTRATOR`
 * (`requireAdmin` ข้างล่าง การ์ด Admin Console 2026-10-05) — token ยังอยู่เพราะ Postman
 * collection, notebook และการตั้งผู้ดูแลระบบคนแรกของ deployment ใหม่ยังใช้เส้นทางนี้
 */
export function requireAdminToken(req: Request, res: Response, next: NextFunction) {
  const provided = req.header("x-admin-token");
  if (!provided || !secretMatches(provided, env.auth.adminApiToken)) {
    res.status(401).json({ error: "unauthenticated", message: "x-admin-token ไม่ถูกต้อง" });
    return;
  }
  setAdminVia("TOKEN");
  next();
}

/**
 * origin ที่ยอมให้ส่งคำสั่งเปลี่ยนข้อมูลของผู้ดูแลระบบด้วย cookie — ที่ CORS ยอมกับที่อยู่ของหน้าเว็บเอง (`APP_URL`)
 * เทียบทั้ง scheme host และ port (`new URL().origin`) ไม่เทียบ prefix: `https://bdi.thammasorn.org.evil.example` ต้องไม่ผ่าน
 */
function trustedOrigin(origin: string): boolean {
  let parsed: string;
  try {
    parsed = new URL(origin).origin;
  } catch {
    return false;
  }
  const allowed = [...env.corsOrigins, env.appUrl].map((o) => {
    try {
      return new URL(o).origin;
    } catch {
      return null;
    }
  });
  return allowed.includes(parsed);
}

/**
 * guard ของ `/api/admin/*` — รับได้สองทาง
 *
 * 1. **`x-admin-token`** (หรือไม่มี cookie เลย) — ทางเดิมของ Postman, notebook และสคริปต์ ส่งต่อให้ `requireAdminToken`
 *    ทั้งดุ้น token ผิดได้ 401 ทันที ไม่ลองอ่าน cookie ต่อ: ผู้เรียกที่ตั้งใจใช้ token ต้องรู้ว่า token ของเขาผิด
 * 2. **session ของผู้ใช้ที่ถือ `SYSTEM_ADMINISTRATOR`** — หน้า /console (การ์ด Admin Console, 2026-10-05) ผู้กระทำในแถว audit
 *    จึงเป็นคนจริงแทน "ระบบ" (`adminActorId()` ใน lib/context.ts) และแถวมี `metadata.admin_via = SESSION`
 *
 * ทาง session ต้องมี **`Origin` ที่เชื่อได้ในทุกคำขอที่ไม่ใช่ GET/HEAD** cookie เป็น `SameSite=lax` (lib/auth.ts) ซึ่งกันได้แค่
 * ข้ามไซต์ ส่วน host อื่นใต้ `thammasorn.org` นับเป็นไซต์เดียวกัน และคำขอ multipart (อัปโหลด template) ไม่มี preflight ของ CORS
 * มากั้น ฟอร์มธรรมดาบนหน้าใดก็ได้ในโดเมนนั้นจึงยิงคำสั่งของผู้ดูแลระบบด้วย cookie ของเขาได้ถ้าไม่ตรวจตรงนี้ เบราว์เซอร์ส่ง `Origin`
 * กับ POST/PUT/PATCH/DELETE เสมอ และ proxy ของหน้าเว็บ (`app/api/[...path]`) ส่งต่อตามเดิม ผู้ใช้จริงจึงไม่เคยโดนข้อนี้
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.header("x-admin-token") !== undefined || !req.cookies?.[SESSION_COOKIE]) {
    requireAdminToken(req, res, next);
    return;
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    const origin = req.header("origin");
    if (!origin || !trustedOrigin(origin)) {
      res.status(403).json({
        error: "csrf_origin",
        message: "คำขอนี้ไม่ได้มาจากหน้าเว็บของระบบ — เปิดหน้าผู้ดูแลระบบจากที่อยู่ของระบบแล้วลองใหม่",
      });
      return;
    }
  }
  void requireAuth(req, res, (err?: unknown) => {
    if (err) {
      next(err);
      return;
    }
    if (!req.session?.roles.includes(ROLE_CODES.SYSTEM_ADMINISTRATOR)) {
      res.status(403).json({ error: "forbidden", message: "เฉพาะผู้ดูแลระบบเท่านั้น" });
      return;
    }
    setAdminVia("SESSION");
    next();
  });
}
