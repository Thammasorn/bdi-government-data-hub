/**
 * เข้าคิวอีเมลของระบบที่พก secret — การ์ด "[Enhance] Send every email through the delivery worker" (2026-11-08)
 *
 * คำเชิญ ลิงก์ตั้งรหัสผ่าน OTP และอีเมลทดสอบของหน้าแก้เทมเพลตเคยส่ง inline จากคำขอ: SMTP สะดุดหนึ่งครั้ง = อีเมลหาย ไม่มี retry
 * ไม่มีบันทึก และผู้ดูแลเห็นแค่ 500 ตอนนี้ทุกฉบับเข้า outbox แล้ว worker ส่ง (มี retry, DEAD_LETTER, สถานะให้หน้าจอติดตาม) secret ถูก
 * เข้ารหัสเก็บไว้กับแถว outbox จนส่งเสร็จ (lib/outbox-secret.ts) worker ประกอบอีเมลจาก secret + แถวในฐานข้อมูลตอนส่ง (workers/render.ts)
 *
 * ทุกฟังก์ชันคืน id ของแถว `notification_delivery` — API ส่งต่อให้หน้าจอติดตามว่าส่งถึงแล้วหรือยัง
 * แถว notification ที่เกิดคู่กันเป็นชนิดใน `SYSTEM_EMAIL_TYPES`: อ่านแล้วตั้งแต่เกิด และไม่ขึ้นกระดิ่ง
 */
import { NotificationType, notifyUsers } from "./notify.js";

/** คำเชิญ (Activation Key) — subject คือคีย์ worker อ่านหน่วยงาน บทบาท และวันหมดอายุจากคีย์ตอนส่ง และยกเลิกถ้าคีย์ไม่รออยู่แล้ว */
export async function queueInvitationEmail(input: {
  userAccountId: string;
  activationKeyId: string;
  rawKey: string;
  expiresAt: Date;
  organizationId?: string | null;
  /** ชื่อหน่วยงานที่อีเมลพิมพ์ — ไม่ส่ง = ชื่อในทะเบียน คำเชิญผู้มีอำนาจฯ ส่งชื่อที่หน่วยงานกรอกในคำขอ (ทะเบียนยังเป็นชื่อชั่วคราวได้) */
  organizationName?: string | null;
}): Promise<string | null> {
  const [id] = await notifyUsers([input.userAccountId], {
    type: NotificationType.USER_ACTIVATION_INVITATION,
    title: "คำเชิญเข้าใช้งานระบบ",
    message: "อีเมลคำเชิญพร้อม Activation Key",
    subjectType: "ACTIVATION_KEY",
    subjectId: input.activationKeyId,
    organizationId: input.organizationId ?? null,
    read: true,
    secret: {
      payload: { key: input.rawKey, organizationName: input.organizationName ?? null },
      expiresAt: input.expiresAt,
    },
  });
  return id ?? null;
}

/** ลิงก์ตั้งรหัสผ่านใหม่ — subject คือแถว `iam.password_reset_token` */
export async function queuePasswordResetEmail(input: {
  userAccountId: string;
  tokenId: string;
  rawToken: string;
  expiresAt: Date;
}): Promise<string | null> {
  const [id] = await notifyUsers([input.userAccountId], {
    type: NotificationType.PASSWORD_RESET,
    title: "ลิงก์ตั้งรหัสผ่านใหม่",
    message: "อีเมลลิงก์ตั้งรหัสผ่านใหม่",
    subjectType: "PASSWORD_RESET_TOKEN",
    subjectId: input.tokenId,
    read: true,
    secret: { payload: { token: input.rawToken }, expiresAt: input.expiresAt },
  });
  return id ?? null;
}

/** รหัส OTP ตอนเข้าสู่ระบบ — subject คือแถว `iam.otp_code` worker ยกเลิกถ้ารหัสถูกใช้ ถูกแทน หรือหมดอายุก่อนถึงคิว */
export async function queueOtpEmail(input: {
  userAccountId: string;
  otpId: string;
  code: string;
  expiresAt: Date;
}): Promise<string | null> {
  const [id] = await notifyUsers([input.userAccountId], {
    type: NotificationType.LOGIN_OTP,
    title: "รหัสยืนยันตัวตน",
    message: "อีเมลรหัส OTP",
    subjectType: "OTP_CODE",
    subjectId: input.otpId,
    read: true,
    secret: { payload: { code: input.code }, expiresAt: input.expiresAt },
  });
  return id ?? null;
}

/** อายุของอีเมลทดสอบในคิว — ไม่ใช่ secret แต่เนื้อหาที่ยังไม่บันทึกไม่ควรค้างอยู่ในฐานข้อมูล */
const TEST_EMAIL_TTL_MS = 60 * 60 * 1000;

/**
 * อีเมลทดสอบของหน้าแก้เทมเพลต — เนื้อหาที่กำลังแก้ (อาจยังไม่บันทึก) อยู่ในช่อง secret ของแถว เพราะตารางไม่มีช่องเนื้อความโดยตั้งใจ
 * และเนื้อหานั้นไม่ควรอยู่ในฐานข้อมูลนานกว่าการส่งหนึ่งครั้ง
 */
export async function queueTemplateTestEmail(input: {
  userAccountId: string;
  templateKey: string;
  content: Record<string, unknown>;
}): Promise<string | null> {
  const [id] = await notifyUsers([input.userAccountId], {
    type: NotificationType.EMAIL_TEMPLATE_TEST,
    title: "อีเมลทดสอบเทมเพลต",
    message: input.templateKey,
    subjectType: "EMAIL_TEMPLATE",
    subjectId: null,
    read: true,
    secret: {
      payload: { templateKey: input.templateKey, content: input.content },
      expiresAt: new Date(Date.now() + TEST_EMAIL_TTL_MS),
    },
  });
  return id ?? null;
}
