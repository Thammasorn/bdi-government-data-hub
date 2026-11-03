/**
 * ตัวเฝ้าคำเชิญใกล้หมดอายุ — เข้าคิวอีเมลเตือน N วันก่อนคีย์หมดอายุ (การ์ด "อีเมลเตือนก่อนคำเชิญหมดอายุ (ตั้งจำนวนวันได้ใน admin)", 2026-11-03)
 *
 * ลูปของตัวเองใน delivery-worker เหมือน `log-upkeep.ts` แต่**ไม่ส่งอีเมลเอง**: เข้าคิวผ่าน `notifyUsers()` แล้ว `tick()` ของ delivery.ts ส่ง
 * ตามปกติ อีเมลนี้ไม่ถือความลับ (ไม่มีลิงก์ ไม่มีคีย์) จึงเดินทาง outbox ได้ และได้ retry / DEAD_LETTER มาฟรี `workers/render.ts` ประกอบเนื้อจากคีย์
 * ตอนส่ง และยกเลิกถ้าคีย์ไม่ได้รออยู่แล้ว
 *
 * N มาจากค่าตั้งระบบ `invitation_reminder_days` (`lib/system-settings.ts`) อ่านทุกรอบ — แก้ที่หน้า /console แล้วมีผลรอบถัดไป 0 = ไม่เตือน
 *
 * **หนึ่งคีย์เตือนครั้งเดียว** คีย์ถูกจองด้วย `UPDATE … SET reminded_at = now() WHERE reminded_at IS NULL … RETURNING` คำสั่งเดียว worker สองตัวที่
 * รันพร้อมกันจึงได้คนละชุด (ตัวที่สองรอ row lock แล้วเห็นว่า `reminded_at` ไม่ว่างแล้ว) เข้าคิวไม่สำเร็จ → คืน `reminded_at` เป็น NULL ให้รอบหน้าลองใหม่
 * คำเชิญที่ส่งซ้ำ (resend) ได้คีย์ใบใหม่ที่ยังไม่เคยเตือน จึงเตือนได้อีกครั้ง และอีเมลอ้างวันที่ของใบใหม่ ซึ่งคือฉบับที่ผู้รับต้องหา
 *
 * เกณฑ์ (เวลาของคีย์แต่ละใบ ไม่ใช่ `ACTIVATION_KEY_TTL_SECONDS` — `issueActivationKey()` รับ `ttlSeconds` ต่อใบได้):
 * - `ISSUED` ยังไม่หมดอายุ และหมดอายุภายใน N วัน
 * - อายุทั้งหมดของคีย์เกิน N วัน (`issued_at < expires_at - N วัน`) — ไม่งั้นจะเตือนทันทีที่ออก ซึ่งไม่มีประโยชน์
 * - หน่วยงานไม่ถูกระงับหรือยุติ — เปิดบัญชีไม่ได้อยู่แล้ว (409 `organization_frozen`) คีย์ไม่ถูกจอง จึงยังเตือนได้ถ้าเปิดหน่วยงานกลับก่อนหมดอายุ
 */
import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";

import { AuditAction, AuditSubject, logAudit } from "../lib/audit.js";
import { runWithContext } from "../lib/context.js";
import { captureError } from "../lib/error-capture.js";
import { NotificationType, notifyUsers } from "../lib/notify.js";
import { FROZEN_ORGANIZATION_STATUSES } from "../lib/organization-freeze.js";
import { readSystemSetting } from "../lib/system-settings.js";

/** ทุก 15 นาที — เตือนล่วงหน้าเป็นวัน ช้าไปไม่เกิน 15 นาทีไม่มีใครเห็นความต่าง ส่วนการตรวจเป็น UPDATE ที่ index พาไปถึงแถวน้อย */
const TICK_MS = Number(process.env.INVITATION_REMINDER_POLL_MS ?? 15 * 60_000);
/** รอบแรกหลังเริ่ม 30 วินาที — ให้ migration และ log store ตั้งตัวก่อน และ restart ติดกันหลายครั้งไม่ทำให้เกิดรอบถี่ */
const FIRST_TICK_MS = 30_000;
/** เพดานต่อรอบ — คีย์ค้างจำนวนมากตอนเปิดใช้ครั้งแรกจะทยอยเข้าคิว ไม่ถมคิวอีเมลทีเดียว */
const BATCH_SIZE = 50;

const dateFormat = new Intl.DateTimeFormat("th-TH", { dateStyle: "long", timeZone: "Asia/Bangkok" });

let firstTimer: NodeJS.Timeout | null = null;
let timer: NodeJS.Timeout | null = null;
let running = false;

interface Claimed {
  id: string;
  user_account_id: string;
  organization_id: string;
  issued_at: Date;
  expires_at: Date;
}

export function startInvitationReminders(prisma: PrismaClient): void {
  if (timer) return;
  firstTimer = setTimeout(() => void tick(prisma), FIRST_TICK_MS);
  firstTimer.unref();
  timer = setInterval(() => void tick(prisma), TICK_MS);
  timer.unref();
}

export function stopInvitationReminders(): void {
  if (firstTimer) clearTimeout(firstTimer);
  if (timer) clearInterval(timer);
  firstTimer = null;
  timer = null;
}

async function tick(prisma: PrismaClient): Promise<void> {
  if (running) return;
  running = true;
  try {
    const days = await readSystemSetting(prisma, "invitation_reminder_days");
    if (days <= 0) return;

    const claimed = await prisma.$queryRaw<Claimed[]>`
      UPDATE iam.activation_key k
         SET reminded_at = now()
       WHERE k.id IN (
         SELECT k2.id
           FROM iam.activation_key k2
           JOIN organization.organization o ON o.id = k2.organization_id
          WHERE k2.status = 'ISSUED'
            AND k2.reminded_at IS NULL
            AND k2.expires_at > now()
            AND k2.expires_at <= now() + make_interval(days => ${days}::int)
            AND k2.issued_at < k2.expires_at - make_interval(days => ${days}::int)
            AND o.status::text <> ALL (${[...FROZEN_ORGANIZATION_STATUSES]}::text[])
          ORDER BY k2.expires_at
          LIMIT ${BATCH_SIZE}
            FOR UPDATE OF k2 SKIP LOCKED
       )
         AND k.reminded_at IS NULL
      RETURNING k.id, k.user_account_id, k.organization_id, k.issued_at, k.expires_at`;
    if (claimed.length === 0) return;

    console.log(`[invitation-reminders] เข้าคิวอีเมลเตือน ${claimed.length} ฉบับ (เตือนก่อนหมดอายุ ${days} วัน)`);
    for (const key of claimed) {
      // หนึ่งคีย์หนึ่ง correlation — แถว notification, delivery และ audit ของการเตือนครั้งนี้ตามรอยหากันได้
      await runWithContext({ correlationId: randomUUID(), sourceComponent: "invitation-reminder" }, () =>
        enqueue(prisma, key, days),
      );
    }
  } catch (err) {
    console.error("[invitation-reminders] รอบนี้ล้มเหลว — ดูบรรทัด [capture] ถัดไป");
    captureError(err, { tag: "invitation-reminders.tick" });
  } finally {
    running = false;
  }
}

async function enqueue(prisma: PrismaClient, key: Claimed, days: number): Promise<void> {
  try {
    await notifyUsers([key.user_account_id], {
      type: NotificationType.INVITATION_REMINDER,
      title: "คำเชิญเข้าใช้งานระบบของท่านใกล้หมดอายุ",
      message:
        `Activation Key ที่ส่งถึงท่านทางอีเมลเมื่อ ${dateFormat.format(key.issued_at)} ` +
        `ใช้ได้ถึง ${dateFormat.format(key.expires_at)} กรุณาลงทะเบียนตามอีเมลคำเชิญฉบับนั้นก่อนวันหมดอายุ`,
      subjectType: "ACTIVATION_KEY",
      subjectId: key.id,
      organizationId: key.organization_id,
      // แถวนี้มีไว้ถือ outbox — ผู้รับยังเข้าระบบไม่ได้ และเมื่อเข้าได้แล้วข้อความนี้ก็ไม่ใช่ข่าวใหม่
      read: true,
    });
  } catch (err) {
    // คืนการจอง ให้รอบหน้าลองใหม่ — ไม่งั้นคีย์ใบนี้ไม่ได้เตือนเลยทั้งที่ยังเข้าเกณฑ์
    await prisma.activationKey.update({ where: { id: key.id }, data: { remindedAt: null } }).catch(() => undefined);
    captureError(err, { tag: "invitation-reminders.enqueue", extra: { activationKeyId: key.id } });
    return;
  }

  // หลังเข้าคิวสำเร็จ ไม่ใช่ก่อน — แถวนี้บอกว่า "เข้าคิวแล้ว" ซึ่งต้องจริง (logAudit ไม่โยน ล้มเองก็ไปเป็น audit.write-failed)
  await logAudit({
    action: AuditAction.ACTIVATION_KEY_REMINDER_QUEUED,
    subjectType: AuditSubject.USER_ACTIVATION_KEY,
    subjectId: key.id,
    organizationId: key.organization_id,
    metadata: {
      user_account_id: key.user_account_id,
      issued_at: key.issued_at.toISOString(),
      expires_at: key.expires_at.toISOString(),
      reminder_days: days,
    },
  });
}
