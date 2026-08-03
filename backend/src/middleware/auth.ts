import type { NextFunction, Request, Response } from "express";
import { UserStatus, type Role } from "@prisma/client";

import { prisma } from "../db.js";
import { env } from "../env.js";
import { SESSION_COOKIE, verifySession, type SessionPayload } from "../lib/auth.js";

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
 * (organizations.ts เขียน organizationId ลงตาราง user) หรือถูกเพิ่มสิทธิ์ผู้มีอำนาจ
 * ตอนหน่วยงานส่งให้ลงนาม ถ้าเชื่อค่าใน cookie ต่อไป คนที่เพิ่งสร้างหน่วยงานเสร็จจะยัง
 * ลงทะเบียนชุดข้อมูลไม่ได้จนกว่าจะออกจากระบบแล้วเข้าใหม่
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

    const user = await prisma.user.findUnique({
      where: { id: session.sub },
      select: { id: true, email: true, roles: true, organizationId: true, status: true },
    });
    // บัญชีถูกลบหรือถูกระงับหลัง cookie ออกไปแล้ว — ตัดสิทธิ์ทันที ไม่รอ cookie หมดอายุ
    if (!user || user.status !== UserStatus.ACTIVE) {
      unauthenticated();
      return;
    }

    req.session = {
      sub: user.id,
      email: user.email,
      roles: user.roles,
      organizationId: user.organizationId,
    };
    next();
  } catch (err) {
    next(err);
  }
}

export function requireRole(...allowed: Role[]) {
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
