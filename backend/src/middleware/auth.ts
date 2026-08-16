import type { NextFunction, Request, Response } from "express";
import { RoleAssignmentStatus, UserAccountStatus } from "@prisma/client";

import { prisma } from "../db.js";
import { env } from "../env.js";
import { SESSION_COOKIE, verifySession, type SessionPayload } from "../lib/auth.js";
import { setActor } from "../lib/context.js";
import { ORGANIZATION_SCOPED_ROLES, type RoleCode } from "../lib/system.js";

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
    const token = req.cookies?.[SESSION_COOKIE];
    const session = token ? verifySession(token) : null;
    if (!session) {
      unauthenticated();
      return;
    }

    const user = await prisma.userAccount.findUnique({
      where: { id: session.sub },
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
    // บัญชีถูกลบหรือถูกระงับหลัง cookie ออกไปแล้ว — ตัดสิทธิ์ทันที ไม่รอ cookie หมดอายุ
    if (!user || user.status !== UserAccountStatus.ACTIVE) {
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

    req.session = { sub: user.id, email: user.email, roles, organizationId };
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
 * สเปกระบุว่าขั้นตอนเชิญผู้ใช้ "ไม่มี UI แต่ต้องมี api" จึงป้องกันด้วย shared secret
 * แทนที่จะใช้ session — ผู้เรียกเป็นสคริปต์ฝั่ง admin ไม่ใช่เบราว์เซอร์
 */
export function requireAdminToken(req: Request, res: Response, next: NextFunction) {
  const provided = req.header("x-admin-token");
  if (!provided || provided !== env.auth.adminApiToken) {
    res.status(401).json({ error: "unauthenticated", message: "x-admin-token ไม่ถูกต้อง" });
    return;
  }
  next();
}
