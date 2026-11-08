/**
 * อีเมลของระบบที่พก secret — คำเชิญ ลิงก์ตั้งรหัสผ่าน OTP และอีเมลทดสอบของหน้าแก้เทมเพลต (การ์ด "[Enhance] Send every email through the
 * delivery worker", 2026-11-08)
 *
 * secret มาจาก `notification_delivery.secret_payload` (ถอดรหัสแล้วโดย delivery.ts) ข้อเท็จจริงอื่นอ่านใหม่จากฐานข้อมูลตอนส่ง เหมือนอีเมล
 * ชนิดอื่นของ worker — และตรวจก่อนว่าสิ่งที่อีเมลพาไปยังใช้ได้อยู่: คีย์ที่ถูกใช้/เพิกถอน/หมดอายุ ลิงก์ที่ถูกแทน หรือ OTP ที่ถูกใช้ไปแล้ว
 * ทำให้อีเมลถูก **ยกเลิก** (CANCELLED พร้อมเหตุผล) ไม่ใช่ส่งของที่ใช้ไม่ได้ไปให้คน
 */
import { ActivationKeyStatus, type PrismaClient } from "@prisma/client";

import { templateDefinition, type TemplateContent } from "../lib/email/catalogue.js";
import { renderSample } from "../lib/email/sample-render.js";
import { validateContent } from "../lib/email/render.js";
import { imageCodes } from "../lib/email/images.js";
import { sendInvitationEmail, sendOtpEmail, sendPasswordResetEmail, sendRendered } from "../lib/mail.js";
import { NotificationType } from "../lib/notify.js";
import { isOrganizationFrozen } from "../lib/organization-freeze.js";
import { fullNameTh } from "../lib/person-name.js";
import { ROLE_LABELS } from "../lib/roles.js";
import { BDI_ORGANIZATION_ID, type RoleCode } from "../lib/system.js";
import type { DeliverableNotification, RenderOutcome } from "./render.js";

const SYSTEM_TYPES: ReadonlySet<string> = new Set([
  NotificationType.USER_ACTIVATION_INVITATION,
  NotificationType.PASSWORD_RESET,
  NotificationType.LOGIN_OTP,
  NotificationType.EMAIL_TEMPLATE_TEST,
]);

export function isSystemEmail(type: string): boolean {
  return SYSTEM_TYPES.has(type);
}

const cancel = (code: string, message: string): RenderOutcome => ({ cancelled: { code, message } });

/** secret หาย (ถูกลบไปแล้ว หรือแถวเก่าก่อนมีคอลัมน์นี้) — ส่งไม่ได้ ต้องสั่งใหม่จากหน้าจอ */
const NO_SECRET = cancel("SECRET_MISSING", "ไม่มีข้อมูลลับที่อีเมลฉบับนี้ต้องใช้แล้ว (หมดอายุหรือถูกลบ) — สั่งส่งใหม่จากหน้าจอ");

export async function renderSystemEmail(
  prisma: PrismaClient,
  destination: string,
  n: DeliverableNotification,
  secret: Record<string, unknown> | null,
): Promise<RenderOutcome> {
  if (!secret) return NO_SECRET;

  switch (n.notificationType) {
    case NotificationType.USER_ACTIVATION_INVITATION: {
      const key = n.subjectId
        ? await prisma.activationKey.findUnique({
            where: { id: n.subjectId },
            select: {
              status: true,
              expiresAt: true,
              organizationId: true,
              organization: { select: { nameTh: true, status: true } },
              role: { select: { code: true } },
            },
          })
        : null;
      if (!key || key.status !== ActivationKeyStatus.ISSUED || key.expiresAt <= new Date()) {
        return cancel("INVITATION_NOT_PENDING", "คำเชิญถูกใช้ ถูกเพิกถอน ถูกแทนด้วยใบใหม่ หรือหมดอายุก่อนถึงคิวส่ง จึงยกเลิก");
      }
      if (isOrganizationFrozen(key.organization.status)) {
        return cancel("ORGANIZATION_FROZEN", "หน่วยงานถูกระงับหรือยุติหลังคำเชิญเข้าคิว เปิดบัญชีไม่ได้ จึงยกเลิกไม่ส่ง");
      }
      const organizationName =
        typeof secret.organizationName === "string" && secret.organizationName ? secret.organizationName : key.organization.nameTh;
      await sendInvitationEmail(destination, String(secret.key), {
        roleLabel: ROLE_LABELS[key.role.code as RoleCode] ?? key.role.code,
        organizationName,
        expiresAt: key.expiresAt,
        internal: key.organizationId === BDI_ORGANIZATION_ID,
      });
      return;
    }

    case NotificationType.PASSWORD_RESET: {
      const token = n.subjectId
        ? await prisma.passwordResetToken.findUnique({
            where: { id: n.subjectId },
            select: {
              expiresAt: true,
              usedAt: true,
              revokedAt: true,
              userAccount: { select: { prefixTh: true, firstnameTh: true, lastnameTh: true } },
            },
          })
        : null;
      if (!token || token.usedAt || token.revokedAt || token.expiresAt <= new Date()) {
        return cancel("RESET_LINK_NOT_VALID", "ลิงก์ถูกใช้ ถูกแทนด้วยลิงก์ใหม่ หรือหมดอายุก่อนถึงคิวส่ง จึงยกเลิก");
      }
      await sendPasswordResetEmail(destination, String(secret.token), {
        displayName: fullNameTh(token.userAccount) || null,
        expiresAt: token.expiresAt,
      });
      return;
    }

    case NotificationType.LOGIN_OTP: {
      const otp = n.subjectId
        ? await prisma.otpCode.findUnique({ where: { id: n.subjectId }, select: { expiresAt: true, consumedAt: true } })
        : null;
      if (!otp || otp.consumedAt || otp.expiresAt <= new Date()) {
        return cancel("OTP_NOT_VALID", "รหัสถูกใช้ ถูกแทนด้วยรหัสใหม่ หรือหมดอายุก่อนถึงคิวส่ง จึงยกเลิก");
      }
      await sendOtpEmail(destination, String(secret.code));
      return;
    }

    case NotificationType.EMAIL_TEMPLATE_TEST: {
      const def = templateDefinition(String(secret.templateKey ?? ""));
      if (!def) return cancel("TEMPLATE_UNKNOWN", "ไม่มีเทมเพลตนี้แล้ว");
      // ตรวจซ้ำและ sanitize อีกรอบ — เนื้อหานี้มาจากแถวในฐานข้อมูล ไม่ใช่จากคำขอที่ผ่านการตรวจเมื่อครู่
      const check = validateContent(def, secret.content as TemplateContent, await imageCodes(prisma));
      const rendered = await renderSample(prisma, def, check.clean, false);
      await sendRendered(destination, `[ทดสอบ] ${rendered.subject || def.label}`, rendered.html, rendered.attachments);
      return;
    }
  }
  return NO_SECRET;
}
