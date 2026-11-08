/**
 * ประวัติการส่งอีเมล — `/api/admin/deliveries` (การ์ด "[Enhance] Send every email through the delivery worker" ข้อ 3)
 *
 * ```
 * GET  /             รายการ กรองตามสถานะ ชนิด และอีเมลผู้รับ
 * GET  /summary      จำนวนที่ส่งไม่สำเร็จ (tile บนหน้าภาพรวม)
 * GET  /:id          สถานะของฉบับเดียว — กล่อง/การ์ดติดตามหลังกดเชิญ ส่งลิงก์ หรือส่งทดสอบ
 * POST /:id/resend   เข้าคิวใหม่ (เฉพาะอีเมลที่ไม่พก secret — คำเชิญกับลิงก์ตั้งรหัสผ่านต้องออกคีย์/ลิงก์ใหม่ผ่านปุ่มของมัน)
 * ```
 *
 * ผู้ดูแลระบบเท่านั้น — รายการมีอีเมลของบุคคล การอ่านทุกครั้งลง `ADMIN_API_REQUEST` อยู่แล้ว (lib/admin-access.ts)
 */
import { DeliveryStatus, type Prisma } from "@prisma/client";
import { z } from "zod";

import { prisma } from "../db.js";
import { Router } from "../lib/async-route.js";
import { correlationId } from "../lib/context.js";
import { DELIVERY_SELECT, DELIVERY_TYPE_OPTIONS, deliveryView, viewOf } from "../lib/delivery-view.js";
import { OUTBOX_CHANNEL } from "../lib/notify.js";
import { requireAdmin } from "../middleware/auth.js";

export const adminDeliveryRouter = Router();
adminDeliveryRouter.use(requireAdmin);

const STATE_FILTER: Record<string, DeliveryStatus[]> = {
  failed: [DeliveryStatus.DEAD_LETTER],
  retrying: [DeliveryStatus.FAILED],
  queued: [DeliveryStatus.PENDING, DeliveryStatus.PROCESSING],
  sent: [DeliveryStatus.SENT, DeliveryStatus.DELIVERED],
  cancelled: [DeliveryStatus.CANCELLED],
};

const listSchema = z.object({
  state: z.enum(["failed", "retrying", "queued", "sent", "cancelled", ""]).optional(),
  type: z.string().max(64).optional(),
  q: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

adminDeliveryRouter.get("/", async (req, res) => {
  const parsed = listSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "validation", message: "ตัวกรองไม่ถูกต้อง" });
    return;
  }
  const { state, type, q, page, pageSize } = parsed.data;
  const where: Prisma.NotificationDeliveryWhereInput = {
    ...(state ? { status: { in: STATE_FILTER[state] } } : {}),
    ...(type ? { notification: { notificationType: type } } : {}),
    ...(q ? { destination: { contains: q.toLowerCase(), mode: "insensitive" } } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.notificationDelivery.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: DELIVERY_SELECT,
    }),
    prisma.notificationDelivery.count({ where }),
  ]);
  res.json({ items: rows.map(viewOf), total, page, pageSize, types: DELIVERY_TYPE_OPTIONS });
});

/** เลิกส่ง (DEAD_LETTER) ใน 7 วันล่าสุด กับที่กำลังลองใหม่ — สองตัวเลขที่ผู้ดูแลต้องสนใจ */
adminDeliveryRouter.get("/summary", async (_req, res) => {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [failed, retrying] = await Promise.all([
    prisma.notificationDelivery.count({ where: { status: DeliveryStatus.DEAD_LETTER, createdAt: { gte: since } } }),
    prisma.notificationDelivery.count({ where: { status: DeliveryStatus.FAILED } }),
  ]);
  res.json({ failedLast7Days: failed, retrying });
});

adminDeliveryRouter.get("/:id", async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id);
  const view = id.success ? await deliveryView(prisma, id.data) : null;
  if (!view) {
    res.status(404).json({ error: "not_found", message: "ไม่พบอีเมลฉบับนี้" });
    return;
  }
  res.json({ delivery: view });
});

adminDeliveryRouter.post("/:id/resend", async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id);
  const view = id.success ? await deliveryView(prisma, id.data) : null;
  if (!view) {
    res.status(404).json({ error: "not_found", message: "ไม่พบอีเมลฉบับนี้" });
    return;
  }
  if (view.resend !== "requeue") {
    const message =
      view.resend === "invitation"
        ? "คำเชิญส่งซ้ำแถวเดิมไม่ได้ — กด \"ส่งคำเชิญอีกครั้ง\" ที่คำเชิญนั้น ระบบจะออก Activation Key ใบใหม่"
        : view.resend === "password_reset"
          ? "ลิงก์ตั้งรหัสผ่านส่งซ้ำแถวเดิมไม่ได้ — กด \"ส่งลิงก์ตั้งรหัสผ่าน\" ที่หน้าผู้ใช้ ระบบจะออกลิงก์ใหม่"
          : "อีเมลชนิดนี้ส่งซ้ำจากที่นี่ไม่ได้";
    res.status(409).json({ error: "resend_elsewhere", message, mode: view.resend, delivery: view });
    return;
  }
  if (view.state === "queued" || view.state === "retrying") {
    res.status(409).json({ error: "still_sending", message: "อีเมลฉบับนี้ยังอยู่ในคิว ระบบกำลังส่งหรือจะลองใหม่เอง", delivery: view });
    return;
  }
  // แถวใหม่ของ notification เดิม — ประวัติของฉบับที่ล้มยังอยู่ worker ประกอบเนื้อหาใหม่จากข้อมูลปัจจุบันตอนส่ง
  const source = await prisma.notificationDelivery.findUniqueOrThrow({
    where: { id: view.id },
    select: { notificationId: true, channel: true, destination: true },
  });
  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.notificationDelivery.create({
      data: { ...source, status: DeliveryStatus.PENDING, correlationId: correlationId() },
      select: { id: true },
    });
    await tx.$executeRaw`SELECT pg_notify(${OUTBOX_CHANNEL}, '')`;
    return row;
  });
  res.status(201).json({ deliveryId: created.id, message: `เข้าคิวส่ง "${view.typeLabel}" ถึง ${view.destination} อีกครั้งแล้ว` });
});
