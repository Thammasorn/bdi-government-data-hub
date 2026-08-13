/**
 * In-app notification — schema `notification`
 * ไม่ต้อง real time — หน้าเว็บดึงตอนโหลดหน้าใหม่ ที่นี่จึงเป็น REST ธรรมดา
 *
 * สถานะเปลี่ยนจาก readAt แบบ nullable เป็น enum UNREAD/READ/ARCHIVED
 * CHECK constraint ในฐานข้อมูลบังคับว่า READ ต้องมี read_at และ ARCHIVED ต้องมี archived_at
 */
import { Router } from "../lib/async-route.js";
import { NotificationStatus } from "@prisma/client";

import { prisma } from "../db.js";
import { linkFor } from "../lib/notify.js";
import { requireAuth } from "../middleware/auth.js";

export const notificationRouter = Router();
notificationRouter.use(requireAuth);

const PAGE_SIZE = 20;

notificationRouter.get("/", async (req, res) => {
  const recipientUserId = req.session!.sub;
  const [rows, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: { recipientUserId, status: { not: NotificationStatus.ARCHIVED } },
      orderBy: { createdAt: "desc" },
      take: PAGE_SIZE,
      select: {
        id: true,
        notificationType: true,
        title: true,
        message: true,
        subjectType: true,
        subjectId: true,
        status: true,
        readAt: true,
        createdAt: true,
      },
    }),
    prisma.notification.count({
      where: { recipientUserId, status: NotificationStatus.UNREAD },
    }),
  ]);

  // `link` ไม่มีในดีไซน์แล้ว — derive จาก subject ให้ frontend ใช้เหมือนเดิม
  const notifications = rows.map((n) => ({
    id: n.id,
    type: n.notificationType,
    title: n.title,
    body: n.message,
    link: linkFor(n.subjectType, n.subjectId),
    readAt: n.readAt,
    createdAt: n.createdAt,
  }));

  res.json({ notifications, unreadCount });
});

notificationRouter.post("/:id/read", async (req, res) => {
  // updateMany ไม่ใช่ update — กัน id ของคนอื่นด้วย where ในคำสั่งเดียว
  const { count } = await prisma.notification.updateMany({
    where: {
      id: req.params.id,
      recipientUserId: req.session!.sub,
      status: NotificationStatus.UNREAD,
    },
    data: { status: NotificationStatus.READ, readAt: new Date() },
  });
  res.json({ ok: true, updated: count });
});

notificationRouter.post("/read-all", async (req, res) => {
  const { count } = await prisma.notification.updateMany({
    where: { recipientUserId: req.session!.sub, status: NotificationStatus.UNREAD },
    data: { status: NotificationStatus.READ, readAt: new Date() },
  });
  res.json({ ok: true, updated: count });
});
