/**
 * สถานะการส่งอีเมลหนึ่งฉบับในรูปที่หน้าจอใช้ — การ์ด "[Enhance] Send every email through the delivery worker" ข้อ 3
 *
 * หน้าจอผู้ดูแลระบบสามที่อ่านจากที่นี่: กล่อง/การ์ดติดตามหลังกดเชิญหรือส่งลิงก์ (`GET /api/admin/deliveries/:id`), ป้ายสถานะในแถวคำเชิญ
 * (`latestBySubject()`), และหน้า "ประวัติการส่งอีเมล" ทุกที่จึงพูดสถานะและเหตุผลด้วยคำเดียวกัน
 *
 * **ไม่มีข้อความดิบของ SMTP** (ยกที่อยู่ผู้รับและรายละเอียดของเซิร์ฟเวอร์มา) — มีแต่หมวดที่แปลเป็นประโยคแล้ว (lib/delivery-errors.ts)
 */
import { DeliveryStatus, type Prisma, type PrismaClient } from "@prisma/client";

import { deliveryReason, type FixedBy } from "./delivery-errors.js";
import { NotificationType } from "./notify.js";

type Db = PrismaClient | Prisma.TransactionClient;

/** เท่ากับค่าของ delivery-worker (`DELIVERY_MAX_ATTEMPTS`) — สอง process อ่าน env ตัวเดียวกัน */
export const MAX_ATTEMPTS = Number(process.env.DELIVERY_MAX_ATTEMPTS ?? 5);

/** สถานะที่หน้าจอแสดง — ห้าแบบตามการ์ด ไม่ใช่ enum ของตาราง (PROCESSING นับเป็นกำลังส่ง, FAILED คือกำลังลองใหม่) */
export type DeliveryState = "queued" | "sent" | "retrying" | "failed" | "cancelled";

export function stateOf(status: DeliveryStatus): DeliveryState {
  switch (status) {
    case DeliveryStatus.PENDING:
    case DeliveryStatus.PROCESSING:
      return "queued";
    case DeliveryStatus.SENT:
    case DeliveryStatus.DELIVERED:
      return "sent";
    case DeliveryStatus.FAILED:
      return "retrying";
    case DeliveryStatus.DEAD_LETTER:
      return "failed";
    case DeliveryStatus.CANCELLED:
      return "cancelled";
  }
}

/** ชื่ออีเมลแต่ละชนิดบนหน้าจอ — ชนิดที่ไม่มีในนี้ใช้หัวข้อของแถว notification */
const TYPE_LABELS: Record<string, string> = {
  [NotificationType.USER_ACTIVATION_INVITATION]: "คำเชิญ",
  [NotificationType.INVITATION_REMINDER]: "เตือนคำเชิญใกล้หมดอายุ",
  [NotificationType.PASSWORD_RESET]: "ลิงก์ตั้งรหัสผ่านใหม่",
  [NotificationType.LOGIN_OTP]: "รหัส OTP",
  [NotificationType.EMAIL_TEMPLATE_TEST]: "อีเมลทดสอบเทมเพลต",
  [NotificationType.REQUEST_SUBMITTED]: "แจ้งคำขอรอดำเนินการ",
  [NotificationType.REQUEST_RETURNED]: "ส่งกลับแก้ไข",
  [NotificationType.REQUEST_APPROVED]: "อนุมัติคำขอ",
  [NotificationType.REQUEST_REJECTED]: "ไม่อนุมัติคำขอ",
  [NotificationType.REQUEST_PROGRESSED]: "แจ้งความคืบหน้า",
  [NotificationType.REQUEST_CANCELLED]: "ยกเลิกคำขอ",
  [NotificationType.SPECIALIST_ASSIGNED]: "มอบหมายผู้เชี่ยวชาญ",
  [NotificationType.SPECIALIST_COMMENTED]: "ผู้เชี่ยวชาญให้ความเห็น",
  [NotificationType.ROLE_ASSIGNMENT_CHANGED]: "เปลี่ยนบทบาท",
};
export const DELIVERY_TYPE_OPTIONS = Object.entries(TYPE_LABELS).map(([value, label]) => ({ value, label }));

/**
 * ส่งอีกครั้งจากหน้าประวัติทำอย่างไร — อีเมลที่พก secret ส่งซ้ำแถวเดิมไม่ได้ (secret ถูกลบไปแล้ว) ต้องออกคีย์/ลิงก์ใหม่ผ่านปุ่มเดิมของมัน
 * `requeue` = เข้าคิวใหม่ได้เลย · `invitation` / `password_reset` = ไปที่ปุ่มของมัน · null = ไม่มีให้ส่งซ้ำ (OTP ผู้ใช้กดขอเองที่หน้าเข้าสู่ระบบ)
 */
export type ResendMode = "requeue" | "invitation" | "password_reset" | null;

function resendModeOf(type: string): ResendMode {
  if (type === NotificationType.USER_ACTIVATION_INVITATION) return "invitation";
  if (type === NotificationType.PASSWORD_RESET) return "password_reset";
  if (type === NotificationType.LOGIN_OTP || type === NotificationType.EMAIL_TEMPLATE_TEST) return null;
  return "requeue";
}

export const DELIVERY_SELECT = {
  id: true,
  status: true,
  destination: true,
  attemptCount: true,
  createdAt: true,
  sentAt: true,
  lastAttemptAt: true,
  nextRetryAt: true,
  lastErrorCode: true,
  notification: {
    select: { notificationType: true, title: true, recipientUserId: true, subjectType: true, subjectId: true, organizationId: true },
  },
} as const satisfies Prisma.NotificationDeliverySelect;

type DeliveryRow = Prisma.NotificationDeliveryGetPayload<{ select: typeof DELIVERY_SELECT }>;

export interface DeliveryView {
  id: string;
  state: DeliveryState;
  type: string;
  typeLabel: string;
  destination: string;
  attemptCount: number;
  maxAttempts: number;
  createdAt: Date;
  sentAt: Date | null;
  lastAttemptAt: Date | null;
  nextRetryAt: Date | null;
  reason: string | null;
  fixedBy: FixedBy | null;
  recipientUserId: string;
  subjectType: string | null;
  subjectId: string | null;
  organizationId: string | null;
  resend: ResendMode;
}

export function viewOf(row: DeliveryRow): DeliveryView {
  const state = stateOf(row.status);
  const why = state === "sent" || state === "queued" ? null : deliveryReason(row.lastErrorCode);
  return {
    id: row.id,
    state,
    type: row.notification.notificationType,
    typeLabel: TYPE_LABELS[row.notification.notificationType] ?? row.notification.title,
    destination: row.destination,
    attemptCount: row.attemptCount,
    maxAttempts: MAX_ATTEMPTS,
    createdAt: row.createdAt,
    sentAt: row.sentAt,
    lastAttemptAt: row.lastAttemptAt,
    nextRetryAt: state === "retrying" ? row.nextRetryAt : null,
    reason: why?.reason ?? null,
    fixedBy: why?.fixedBy ?? null,
    recipientUserId: row.notification.recipientUserId,
    subjectType: row.notification.subjectType,
    subjectId: row.notification.subjectId,
    organizationId: row.notification.organizationId,
    resend: resendModeOf(row.notification.notificationType),
  };
}

export async function deliveryView(db: Db, id: string): Promise<DeliveryView | null> {
  const row = await db.notificationDelivery.findUnique({ where: { id }, select: DELIVERY_SELECT });
  return row ? viewOf(row) : null;
}

/**
 * อีเมลฉบับล่าสุดของแต่ละ subject (เช่น คำเชิญของคีย์แต่ละใบ) — ป้ายสถานะในแถวของตาราง หนึ่งคำสั่ง ไม่ใช่หนึ่งคำสั่งต่อแถว
 */
export async function latestBySubject(db: Db, type: string, subjectIds: string[]): Promise<Map<string, DeliveryView>> {
  const out = new Map<string, DeliveryView>();
  if (subjectIds.length === 0) return out;
  const rows = await db.notificationDelivery.findMany({
    where: { notification: { notificationType: type, subjectId: { in: subjectIds } } },
    orderBy: { createdAt: "desc" },
    select: DELIVERY_SELECT,
  });
  for (const row of rows) {
    const key = row.notification.subjectId!;
    if (!out.has(key)) out.set(key, viewOf(row));
  }
  return out;
}
