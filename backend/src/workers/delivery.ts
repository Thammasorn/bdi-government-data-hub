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
import {
  FLUSH_ON_EXIT_MS,
  captureError,
  exitAfterFatal,
  flushErrors,
  initErrorCapture,
  recordRuntimeEvent,
} from "../lib/error-capture.js";
import { closeLogStore, startLogStore } from "../lib/log-store.js";
import { startLogRelay, stopLogRelay } from "./log-relay.js";
import { startLogUpkeep, stopLogUpkeep } from "./log-upkeep.js";
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

/**
 * รหัสของ SMTP ที่ใช้จัดกลุ่ม — `responseCode` ของ server (535 login ไม่ผ่าน, 550 ผู้รับถูกปฏิเสธ, 421 ช้าเกิน/เกินโควตา)
 * หรือ `code` แบบ `E…` ของ nodemailer และ socket (EAUTH, ECONNECTION, ETIMEDOUT, ECONNREFUSED) — ไม่ใช่ error ของ
 * SMTP (เช่น notification ถูกลบไปแล้ว P2025) ได้ null แล้วใช้ fingerprint ตั้งต้น
 */
function smtpCode(err: unknown): string | null {
  const { responseCode, code } = err as { responseCode?: unknown; code?: unknown };
  if (typeof responseCode === "number") return String(responseCode);
  if (typeof code === "string" && /^E[A-Z]+$/.test(code)) return code;
  return null;
}

async function deliver(row: Claimed) {
  const attempt = row.attempt_count + 1;
  let notificationType: string | null = null;

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

    notificationType = notification.notificationType;

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

    /**
     * บรรทัดนี้บอกแค่ว่าเกิดที่ไหน ครั้งที่เท่าไร กับรหัสของ SMTP แล้วชี้ไปที่บรรทัด [capture] ถัดไป — ไม่พิมพ์ข้อความ
     * ของ error แม้จะกวาดแล้ว: captureError พิมพ์ฉบับที่กวาดแล้วอยู่แล้ว สองบรรทัดที่มีข้อความเดียวกันซ้ำกันเปล่า ๆ
     * และข้อความของ SMTP ยกที่อยู่ผู้รับมาได้ ("550 5.1.1 <…>: Recipient address rejected") ที่เดียวที่กวาดจึงดีกว่าสองที่
     */
    const code = smtpCode(err);
    console.error(`[delivery] ส่งไม่สำเร็จ ครั้งที่ ${attempt}${code ? ` (${code})` : ""} — ดูบรรทัด [capture] ถัดไป`);

    // ทุกครั้งที่ล้มเป็น warning จัดกลุ่มตามรหัสของ SMTP — ล้มครั้งเดียวแล้ว retry ผ่านเป็นเรื่องปกติ
    captureError(err, {
      level: "warning",
      tag: "delivery.send-failed",
      fingerprint: code ? `smtp:${code}` : undefined,
      extra: { deliveryId: row.id, attempt, notificationType },
    });
    /**
     * ครบจำนวนครั้งแล้วเลิกส่ง — error ของตัวเอง แยก issue ตามชนิดของ notification เพราะนี่คืออีเมลที่ผู้รับจะไม่ได้
     * เลย และก่อนหน้านี้ไม่มีใครเห็นนอกจากแถว DEAD_LETTER ในตาราง correlation id ของแถวยังเป็นของคำขอที่สร้างมัน
     * (runWithContext ใน tick) event นี้จึงอยู่ในเส้นทางเดียวกับการกดปุ่มที่ทำให้เกิดอีเมลฉบับนั้น
     */
    if (exhausted) {
      captureError(
        new Error(`อีเมล ${notificationType ?? "(ไม่ทราบชนิด)"} ส่งไม่สำเร็จครบ ${MAX_ATTEMPTS} ครั้ง — เลิกส่ง (DEAD_LETTER)`, {
          cause: err,
        }),
        {
          level: "error",
          tag: "delivery.dead-letter",
          fingerprint: `delivery:dead-letter:${notificationType ?? "unknown"}`,
          extra: { notificationType, deliveryId: row.id, attempts: attempt },
        },
      );
    }
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
  // ตัวดัก unhandledRejection / uncaughtException และคิวของ error — ก่อนอย่างอื่น (ดู lib/error-capture.ts)
  initErrorCapture({ service: "delivery-worker" });
  console.log(`[delivery] เริ่มทำงาน — poll ทุก ${POLL_INTERVAL_MS} ms, retry สูงสุด ${MAX_ATTEMPTS} ครั้ง`);

  /**
   * log store (MongoDB) — ไม่ await โดยตั้งใจ: ลูปส่งอีเมลข้างล่างต้องเริ่มทันทีและต้องไม่ผูกกับ Mongo เลย
   * startLogStore ไม่ reject และปิดอยู่ก็ไม่โหลด driver (ดู lib/log-store.ts) งานดูแล (index, เพดานขนาด) และ relay ที่
   * คัดลอก audit_event ลง Mongo (workers/log-relay.ts) เป็นลูปของตัวเองทั้งคู่ — ใช้ PrismaClient ตัวเดียวกับลูปอีเมล
   * แต่อ่านทีละคำสั่ง จึงถือ connection ของ pool ไม่เกินหนึ่งตัวต่อลูป
   */
  void startLogStore({ service: "delivery-worker", maxPoolSize: 3 });
  startLogUpkeep();
  startLogRelay(prisma);
  recordRuntimeEvent("start", { node: process.version });

  let running = true;
  const stop = async (signal: string) => {
    console.log(`[delivery] ${signal} received, shutting down`);
    running = false;
    stopLogUpkeep();
    // รอบของ relay ที่กำลังเขียนไม่เกิน 1.5 วินาที — ที่ค้างอ่านซ้ำตอนเริ่มใหม่ได้
    await stopLogRelay();
    recordRuntimeEvent("shutdown", { signal });
    // ไม่เกิน 1.5 + 2 + 1.5 วินาที — อยู่ใน 10 วินาทีของ compose
    await flushErrors(FLUSH_ON_EXIT_MS);
    await closeLogStore();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGTERM", () => void stop("SIGTERM"));
  process.on("SIGINT", () => void stop("SIGINT"));

  while (running) {
    try {
      await tick();
    } catch (err) {
      // ไม่พิมพ์ `err` ดิบ — error ของ Prisma/SMTP ยกแถวหรือที่อยู่ผู้รับมาได้ captureError พิมพ์ฉบับที่กวาดแล้ว
      console.error("[delivery] รอบนี้ล้มเหลว — ดูบรรทัด [capture] ถัดไป");
      captureError(err, { tag: "delivery.tick" });
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

main().catch((err: unknown) => {
  console.error("[delivery] fatal — ดูบรรทัด [capture] ถัดไป");
  exitAfterFatal(err, { mechanism: "captured", tag: "delivery.main" });
});
