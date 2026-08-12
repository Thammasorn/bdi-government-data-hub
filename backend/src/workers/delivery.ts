/**
 * Delivery worker — ตัวส่งของ outbox `notification.notification_delivery`
 *
 * ก่อนย้ายสคีมา lib/mail.ts ถูกเรียกตรง ๆ ใน request handler ถ้า SMTP ช้าหรือล่ม
 * ผู้ใช้จะค้างรอไปด้วย และอีเมลที่ส่งไม่สำเร็จก็หายไปเฉย ๆ
 *
 * ดีไซน์กำหนดให้ delivery เป็นคิว มี attempt_count / next_retry_at / DEAD_LETTER
 * งานของ worker คือหยิบแถวที่ถึงเวลาแล้วมาส่ง และบันทึกผลกลับ
 *
 * ข้อกำหนดจากภาพใน sheet `notification_delivery`:
 * - "Delivery Worker ต้องใช้ Row Lock หรือกลไกเทียบเท่า เพื่อป้องกัน Worker หลายตัว
 *    ส่งรายการเดียวกันพร้อมกัน" → ใช้ SELECT … FOR UPDATE SKIP LOCKED
 * - attempt_count เริ่มที่ 0 · SENT ต้องมี sent_at · retry ต้องกำหนด next_retry_at
 * - "Sensitive Token หรือ Credential ห้ามเก็บในรูป Plain Text" → เก็บแค่ title/message
 *   ของ notification ไม่เก็บ payload ที่มีความลับ
 */
import { DeliveryStatus, PrismaClient } from "@prisma/client";

import { runWithContext } from "../lib/context.js";
import { renderAndSend } from "./render.js";

const prisma = new PrismaClient();

const BATCH_SIZE = 20;
const POLL_INTERVAL_MS = Number(process.env.DELIVERY_POLL_INTERVAL_MS ?? 15_000);
const MAX_ATTEMPTS = Number(process.env.DELIVERY_MAX_ATTEMPTS ?? 5);

/** exponential backoff แบบง่าย — 1, 2, 4, 8 นาที */
const backoffMs = (attempt: number) => Math.min(2 ** attempt, 16) * 60_000;

interface Claimed {
  id: string;
  notification_id: string;
  destination: string;
  attempt_count: number;
  correlation_id: string;
}

/**
 * หยิบงานที่ถึงเวลาส่งแล้ว และล็อกไว้ในคำสั่งเดียว
 * SKIP LOCKED ทำให้ worker ตัวที่สองข้ามแถวที่ตัวแรกถืออยู่แทนที่จะรอ
 */
async function claimBatch(): Promise<Claimed[]> {
  return prisma.$queryRaw<Claimed[]>`
    UPDATE notification.notification_delivery d
       SET status = ${DeliveryStatus.PROCESSING}::notification."DeliveryStatus",
           processing_at = now(),
           updated_at = now(),
           version = d.version + 1
     WHERE d.id IN (
       SELECT id
         FROM notification.notification_delivery
        WHERE status IN (${DeliveryStatus.PENDING}::notification."DeliveryStatus",
                         ${DeliveryStatus.FAILED}::notification."DeliveryStatus")
          AND scheduled_at <= now()
          AND (next_retry_at IS NULL OR next_retry_at <= now())
        ORDER BY scheduled_at
        LIMIT ${BATCH_SIZE}
          FOR UPDATE SKIP LOCKED
     )
    RETURNING d.id, d.notification_id, d.destination, d.attempt_count, d.correlation_id`;
}

async function deliver(row: Claimed) {
  const attempt = row.attempt_count + 1;

  try {
    const notification = await prisma.notification.findUniqueOrThrow({
      where: { id: row.notification_id },
      select: {
        notificationType: true,
        title: true,
        message: true,
        subjectType: true,
        subjectId: true,
      },
    });

    // เนื้ออีเมลถูกประกอบตอนนี้ ไม่ได้เก็บไว้ในตาราง — ดู workers/render.ts
    await renderAndSend(prisma, row.destination, notification);

    await prisma.notificationDelivery.update({
      where: { id: row.id },
      data: {
        status: DeliveryStatus.SENT,
        sentAt: new Date(),
        attemptCount: attempt,
        lastAttemptAt: new Date(),
        nextRetryAt: null,
        lastErrorCode: null,
        lastErrorMessage: null,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const exhausted = attempt >= MAX_ATTEMPTS;

    await prisma.notificationDelivery.update({
      where: { id: row.id },
      data: {
        status: exhausted ? DeliveryStatus.DEAD_LETTER : DeliveryStatus.FAILED,
        attemptCount: attempt,
        lastAttemptAt: new Date(),
        nextRetryAt: exhausted ? null : new Date(Date.now() + backoffMs(attempt)),
        lastErrorCode: exhausted ? "MAX_ATTEMPTS" : "SEND_FAILED",
        // ข้อความ error ถูกตัดความยาว และไม่ควรมี credential อยู่แล้ว
        lastErrorMessage: message.slice(0, 500),
      },
    });

    console.error(`[delivery] ส่งไม่สำเร็จ ครั้งที่ ${attempt}: ${message}`);
  }
}

async function tick() {
  const batch = await claimBatch();
  if (batch.length === 0) return;

  console.log(`[delivery] หยิบงาน ${batch.length} รายการ`);
  for (const row of batch) {
    // แต่ละงานอยู่ใน correlation ของตัวเอง เพื่อให้ audit ตามรอยกลับไปหา request ต้นทางได้
    await runWithContext(
      { correlationId: row.correlation_id, sourceComponent: "notification-worker" },
      () => deliver(row),
    );
  }
}

async function main() {
  console.log(`[delivery] เริ่มทำงาน — poll ทุก ${POLL_INTERVAL_MS} ms, retry สูงสุด ${MAX_ATTEMPTS} ครั้ง`);

  let running = true;
  const stop = async (signal: string) => {
    console.log(`[delivery] ${signal} received, shutting down`);
    running = false;
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGTERM", () => void stop("SIGTERM"));
  process.on("SIGINT", () => void stop("SIGINT"));

  while (running) {
    try {
      await tick();
    } catch (err) {
      console.error("[delivery] รอบนี้ล้มเหลว:", err);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

main().catch((err) => {
  console.error("[delivery] fatal:", err);
  process.exit(1);
});
