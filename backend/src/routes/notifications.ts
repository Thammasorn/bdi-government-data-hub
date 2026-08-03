/**
 * In-app notification (docs/01-user-journey.md §4.8)
 * ไม่ต้อง real time — หน้าเว็บดึงตอนโหลดหน้าใหม่ ที่นี่จึงเป็น REST ธรรมดา
 */
import { Router } from "express";

import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";

export const notificationRouter = Router();
notificationRouter.use(requireAuth);

const PAGE_SIZE = 20;

notificationRouter.get("/", async (req, res) => {
  const userId = req.session!.sub;
  const [notifications, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: PAGE_SIZE,
      select: { id: true, type: true, title: true, body: true, link: true, readAt: true, createdAt: true },
    }),
    prisma.notification.count({ where: { userId, readAt: null } }),
  ]);
  res.json({ notifications, unreadCount });
});

notificationRouter.post("/:id/read", async (req, res) => {
  // updateMany ไม่ใช่ update — กัน id ของคนอื่นด้วย where ในคำสั่งเดียว
  const { count } = await prisma.notification.updateMany({
    where: { id: req.params.id, userId: req.session!.sub, readAt: null },
    data: { readAt: new Date() },
  });
  res.json({ ok: true, updated: count });
});

notificationRouter.post("/read-all", async (req, res) => {
  const { count } = await prisma.notification.updateMany({
    where: { userId: req.session!.sub, readAt: null },
    data: { readAt: new Date() },
  });
  res.json({ ok: true, updated: count });
});
