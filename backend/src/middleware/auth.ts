import type { NextFunction, Request, Response } from "express";
import type { Role } from "@prisma/client";

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

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.[SESSION_COOKIE];
  const session = token ? verifySession(token) : null;
  if (!session) {
    res.status(401).json({ error: "unauthenticated", message: "กรุณาเข้าสู่ระบบ" });
    return;
  }
  req.session = session;
  next();
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
