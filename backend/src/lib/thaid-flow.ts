/**
 * สถานะระหว่างทางของการยืนยันตัวตนด้วย ThaiD
 *
 * OAuth ต้องจำสองอย่างข้ามการ redirect: `state` (กัน CSRF และผูก callback กลับเข้า
 * คำขอเดิม) และผลลัพธ์ "ยืนยันผ่านแล้ว" ที่ต้องอยู่รอดจนผู้ใช้ตั้งรหัสผ่านเสร็จ
 *
 * ทั้งสองอย่างเก็บใน `integration.integration_operation` ไม่ใช่ตารางใหม่ — sheet นั้น
 * ระบุ THAID → VERIFY_IDENTITY ไว้ตรง ๆ ว่าเป็นที่บันทึกงาน integration หนึ่งงาน
 * ผลพลอยได้คือได้ audit trail ของทุกครั้งที่เรียก ThaiD ฟรี รวมทั้งครั้งที่ล้มเหลว
 *
 * ที่จงใจ **ไม่** เก็บ: raw activation key (callback อ้าง `subject_id` = id ของแถว
 * activation_key แทน คีย์จริงจึงไม่เคยถูกเขียนลงฐานข้อมูล) และเลขบัตรจาก ThaiD
 * (ใช้เทียบแล้วทิ้ง เก็บไว้แค่ `sub` ลง external_reference)
 */
import { randomUUID } from "node:crypto";

import { IntegrationStatus, IntegrationType, type IntegrationOperation } from "@prisma/client";

import { prisma } from "../db.js";
import { env } from "../env.js";
import { correlationId } from "./context.js";
import { generateNonce, generateState } from "./thaid.js";

/**
 * operation code
 *   VERIFY_IDENTITY — ยืนยันตัวตนตอนเปิดใช้งานบัญชี (ตามตัวอย่างใน sheet)
 *   AUTHENTICATE    — เข้าสู่ระบบด้วย ThaiD แทนรหัสผ่าน (เพิ่มจาก sheet ตาม Login Step)
 */
export const ThaidOperation = {
  VERIFY_IDENTITY: "VERIFY_IDENTITY",
  AUTHENTICATE: "AUTHENTICATE",
} as const;

export type ThaidPurpose = "activate" | "login";

const OPERATION_BY_PURPOSE: Record<ThaidPurpose, string> = {
  activate: ThaidOperation.VERIFY_IDENTITY,
  login: ThaidOperation.AUTHENTICATE,
};

/** subject_type ของแถว integration_operation */
const SUBJECT_BY_PURPOSE: Record<ThaidPurpose, string> = {
  activate: "USER_ACTIVATION_KEY",
  login: "THAID_LOGIN",
};

export function purposeOf(operation: IntegrationOperation): ThaidPurpose {
  return operation.operation === ThaidOperation.AUTHENTICATE ? "login" : "activate";
}

/**
 * เปิดงานใหม่และคืน state ที่จะแนบไปกับ authorization request
 *
 * `subjectId` เป็น UUID เสมอตามชนิดคอลัมน์ — ขา activate ใช้ id ของ activation key
 * ส่วนขา login ยังไม่รู้ว่าใคร จึงใช้ UUID สุ่มเป็นตัวแทนของ "ความพยายามครั้งนี้"
 */
export async function startThaidOperation(params: {
  purpose: ThaidPurpose;
  subjectId?: string;
  organizationId?: string | null;
}): Promise<{ state: string; nonce: string; operation: IntegrationOperation }> {
  const state = generateState();
  const nonce = generateNonce();
  const operation = await prisma.integrationOperation.create({
    data: {
      integrationType: IntegrationType.THAID,
      operation: OPERATION_BY_PURPOSE[params.purpose],
      subjectType: SUBJECT_BY_PURPOSE[params.purpose],
      subjectId: params.subjectId ?? randomUUID(),
      organizationId: params.organizationId ?? null,
      idempotencyKey: `thaid:${state}`,
      /**
       * `nonce` เก็บคู่กับ `state` ในแถวเดียวกัน callback จึงเทียบได้โดยไม่ต้องเชื่อ
       * อะไรที่เดินทางผ่านเบราว์เซอร์ — เหตุผลเดียวกับที่ state ไม่ได้อยู่ใน cookie
       */
      requestNonce: nonce,
      status: IntegrationStatus.PENDING,
      correlationId: correlationId(),
    },
  });
  return { state, nonce, operation };
}

export type StateFailure = "not_found" | "expired" | "already_used";

/**
 * รับ state จาก callback มาจองไว้
 *
 * `updateMany` ที่กรอง status = PENDING ทำให้การจองเป็น atomic — code หนึ่งใบถูกยิงซ้ำ
 * (ผู้ใช้กด refresh หน้า callback) จะได้ already_used แทนที่จะแลก token สองรอบ
 */
export async function claimThaidState(
  state: string,
): Promise<{ operation: IntegrationOperation; reason: null } | { operation: null; reason: StateFailure }> {
  const existing = await prisma.integrationOperation.findUnique({
    where: { idempotencyKey: `thaid:${state}` },
  });
  if (!existing) return { operation: null, reason: "not_found" };

  const ageMs = Date.now() - existing.createdAt.getTime();
  if (ageMs > env.thaid.stateTtlMinutes * 60_000) {
    if (existing.status === IntegrationStatus.PENDING) {
      await failThaidOperation(existing, "state_expired", "หมดเวลารอการยืนยันจาก ThaiD");
    }
    return { operation: null, reason: "expired" };
  }

  const claimed = await prisma.integrationOperation.updateMany({
    where: { id: existing.id, status: IntegrationStatus.PENDING },
    data: {
      status: IntegrationStatus.PROCESSING,
      processingAt: new Date(),
      lastAttemptAt: new Date(),
      attemptCount: { increment: 1 },
    },
  });
  if (claimed.count === 0) return { operation: null, reason: "already_used" };

  return { operation: existing, reason: null };
}

export async function succeedThaidOperation(
  operation: IntegrationOperation,
  externalReference: string,
): Promise<void> {
  await prisma.integrationOperation.update({
    where: { id: operation.id },
    data: {
      status: IntegrationStatus.SUCCEEDED,
      externalReference,
      completedAt: new Date(),
    },
  });
}

export async function failThaidOperation(
  operation: IntegrationOperation,
  code: string,
  message: string,
): Promise<void> {
  await prisma.integrationOperation.update({
    where: { id: operation.id },
    data: {
      status: IntegrationStatus.FAILED,
      lastErrorCode: code.slice(0, 64),
      lastErrorMessage: message,
      completedAt: new Date(),
    },
  });
}

/**
 * ใบเสร็จ "ยืนยันตัวตนผ่านแล้ว" ของ activation key ใบนี้ ถ้ายังไม่หมดอายุ
 *
 * ขั้นตั้งรหัสผ่านเรียกตัวนี้แทนการเชื่อคำบอกเล่าจากเบราว์เซอร์ — ปลอมไม่ได้เพราะ
 * ผู้เรียกต้องถือ raw activation key ที่ hash ตรงกับแถวนี้อยู่แล้ว
 */
export async function latestVerification(activationKeyId: string): Promise<IntegrationOperation | null> {
  const operation = await prisma.integrationOperation.findFirst({
    where: {
      integrationType: IntegrationType.THAID,
      operation: ThaidOperation.VERIFY_IDENTITY,
      subjectId: activationKeyId,
      status: IntegrationStatus.SUCCEEDED,
    },
    orderBy: { completedAt: "desc" },
  });
  if (!operation?.completedAt) return null;

  const ageMs = Date.now() - operation.completedAt.getTime();
  return ageMs <= env.thaid.verificationTtlMinutes * 60_000 ? operation : null;
}
