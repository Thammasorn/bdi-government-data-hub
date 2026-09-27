/**
 * สถานะระหว่างทางของการยืนยันตัวตนด้วย ThaID
 *
 * OAuth ต้องจำสองอย่างข้ามการ redirect: `state` (กัน CSRF และผูก callback กลับเข้า
 * คำขอเดิม) และผลลัพธ์ "ยืนยันผ่านแล้ว" ที่ต้องอยู่รอดจนผู้ใช้ตั้งรหัสผ่านเสร็จ
 *
 * ทั้งสองอย่างเก็บใน `integration.integration_operation` ไม่ใช่ตารางใหม่ — sheet นั้น
 * ระบุ THAID → VERIFY_IDENTITY ไว้ตรง ๆ ว่าเป็นที่บันทึกงาน integration หนึ่งงาน
 * ผลพลอยได้คือได้ audit trail ของทุกครั้งที่เรียก ThaID ฟรี รวมทั้งครั้งที่ล้มเหลว
 *
 * ที่จงใจ **ไม่** เก็บ: raw activation key (callback อ้าง `subject_id` = id ของแถว
 * activation_key แทน คีย์จริงจึงไม่เคยถูกเขียนลงฐานข้อมูล) และเลขบัตรจาก ThaID
 * (ใช้เทียบแล้วทิ้ง เก็บไว้แค่ `sub` ลง external_reference)
 */
import { randomUUID } from "node:crypto";

import { IntegrationStatus, IntegrationType, type IntegrationOperation } from "@prisma/client";

import { prisma } from "../db.js";
import { env } from "../env.js";
import { AuditAction, AuditSubject, logAudit } from "./audit.js";
import { correlationId } from "./context.js";
import { generateNonce, generateState } from "./thaid.js";

/**
 * operation code
 *   VERIFY_IDENTITY — ยืนยันตัวตนตอนเปิดใช้งานบัญชี (ตามตัวอย่างใน sheet)
 *   AUTHENTICATE    — เข้าสู่ระบบด้วย ThaID แทนรหัสผ่าน (เพิ่มจาก sheet ตาม Login Step)
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
 *
 * จองไม่ได้ก็ยังคืนแถวที่หาเจอ (`found`) ให้ผู้เรียก — `IDENTITY_VERIFICATION_FAILED`
 * ของกรณี `state_*` ต้องบอกได้ว่าเป็นความพยายามครั้งไหน ของคีย์ไหน
 */
export async function claimThaidState(
  state: string,
): Promise<
  | { operation: IntegrationOperation; reason: null; found: IntegrationOperation }
  | { operation: null; reason: StateFailure; found: IntegrationOperation | null }
> {
  const existing = await prisma.integrationOperation.findUnique({
    where: { idempotencyKey: `thaid:${state}` },
  });
  if (!existing) return { operation: null, reason: "not_found", found: null };

  const ageMs = Date.now() - existing.createdAt.getTime();
  if (ageMs > env.thaid.stateTtlMinutes * 60_000) {
    if (existing.status === IntegrationStatus.PENDING) {
      // audit: false — callback เขียน `state_expired` เองทุกกรณี (รวมแถวที่ไม่ใช่ PENDING แล้ว)
      // ถ้าเขียนตรงนี้ด้วย การหมดเวลาครั้งเดียวจะได้สองแถว
      await failThaidOperation(existing, "state_expired", "หมดเวลารอการยืนยันจาก ThaID", {
        audit: false,
      });
    }
    return { operation: null, reason: "expired", found: existing };
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
  if (claimed.count === 0) return { operation: null, reason: "already_used", found: existing };

  return { operation: existing, reason: null, found: existing };
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

/** ค่าที่ใช้แทน `error` จาก callback ที่ไม่ใช่รูปของรหัส OAuth */
export const UNRECOGNISED_THAID_ERROR = "thaid_error_unrecognised";

/**
 * รหัส OAuth ทุกตัว (access_denied, invalid_request, …) และ `user_denied` ที่ ThaID ส่งจริง
 * เป็นตัวพิมพ์เล็กกับ `_` ล้วน — ไม่มีตัวเลข รูปนี้จึงรับรหัสของ ThaID ที่เรายังไม่รู้จักได้
 * แต่ไม่มีทางพาเลข 13 หลักติดมาด้วย
 */
const OAUTH_ERROR_CODE = /^[a-z][a-z_]{0,39}$/;

/**
 * `error` ของ callback → รหัสที่เก็บได้
 *
 * ค่านี้ **ไม่ได้มาจาก ThaID โดยตรง** — หน้า callback อ่านจาก query string แล้วส่งต่อมา ใครที่
 * เรียก /thaid/start ได้ state ของตัวเองแล้วยิง callback เองด้วยข้อความอะไรก็ได้ ถ้าเก็บตามที่ส่งมา
 * ข้อความนั้นจะกลายเป็น `failure_reason` (และ `last_error_code`) ทำให้รายการรหัสที่ใช้จัดกลุ่ม
 * เลอะ และฝังเลขบัตรลงคอลัมน์ที่ไม่มีใครคิดจะปิดบังได้ ค่าที่ไม่ใช่รูปของรหัสจึงเหลือค่าคงที่ค่าเดียว
 * ไม่เก็บค่าดิบไว้ที่ไหนเลย — `error_description` ยังลง `last_error_message` เหมือนเดิม
 *
 * รหัสอื่นที่ส่งเข้า `failThaidOperation()` ไม่ต้องผ่านตรงนี้: เป็นค่าคงที่ของเราเอง หรือ `error`
 * ที่ endpoint token ของ ThaID ตอบกลับมาทาง server-to-server (บางตัวมีตัวเลข เช่น `http_502`)
 */
export function thaidCallbackErrorCode(raw: string): string {
  const code = raw.trim().toLowerCase();
  return OAUTH_ERROR_CODE.test(code) ? code : UNRECOGNISED_THAID_ERROR;
}

/**
 * ปิดงานเป็น FAILED **และเขียน `IDENTITY_VERIFICATION_FAILED`** ในที่เดียว
 *
 * ทุกความล้มเหลวของ callback ต้องผ่านตรงนี้อยู่แล้วเพื่อปิดแถว integration_operation จึงเป็น
 * ที่เดียวที่ audit ครบได้โดยไม่ต้องจำไปเติมทีละจุด — ทางออกใหม่ที่เขียนเพิ่มทีหลังได้ log เอง
 *
 * `{ audit: false }` สำหรับผู้เรียกที่เขียนแถวของตัวเองอยู่แล้ว ไม่งั้นเหตุการณ์เดียวได้สองแถว:
 * `cid_mismatch` (แถวของมันมี `thaid_subject` ที่ตรงนี้ไม่มี) · `account_not_found` ของขา login
 * (เขียนเป็น LOGIN_FAILED) · `state_expired` ใน `claimThaidState()` (callback เขียนเอง)
 */
export async function failThaidOperation(
  operation: IntegrationOperation,
  code: string,
  message: string,
  options: { audit?: boolean } = {},
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
  if (options.audit !== false) await logThaidFailure(operation, code);
}

/**
 * แถว `IDENTITY_VERIFICATION_FAILED` หนึ่งแถว — `operation` เป็น null ได้เมื่อ state ที่ส่งมา
 * ไม่ตรงกับแถวไหนเลย
 *
 * เก็บแค่รหัส (ตัดที่ 64 ตัวเท่ากับ `last_error_code`) **ไม่เก็บ message** — ข้อความจาก
 * `error_description` ของ ThaID เป็นข้อความอิสระที่มาทาง query string คุมเนื้อหาไม่ได้
 * ส่วน `error` ที่มาทางเดียวกัน callback แปลงผ่าน `thaidCallbackErrorCode()` ก่อนถึงตรงนี้
 *
 * subject ตามขา: activate ชี้ activation key (ตรงกับ `IDENTITY_VERIFIED` และแถว CID_MISMATCH
 * ที่มีอยู่ก่อน — เรื่องราวของคีย์หนึ่งใบจึงอ่านได้จาก subject เดียว) ส่วน login ยังไม่รู้ว่าเป็น
 * ใคร จึงชี้แถว integration_operation ของความพยายามครั้งนั้น
 */
export async function logThaidFailure(
  operation: IntegrationOperation | null,
  code: string,
): Promise<void> {
  const purpose = operation ? purposeOf(operation) : null;
  const activationKeyId = operation && purpose === "activate" ? operation.subjectId : null;

  // บัญชีของคีย์ — ให้ค้นประวัติของคนคนหนึ่งเจอความพยายามที่ล้มเหลวของเขาด้วย
  const key = activationKeyId
    ? await prisma.activationKey
        .findUnique({ where: { id: activationKeyId }, select: { userAccountId: true } })
        .catch(() => null)
    : null;

  await logAudit({
    action: AuditAction.IDENTITY_VERIFICATION_FAILED,
    subjectType: activationKeyId ? AuditSubject.USER_ACTIVATION_KEY : AuditSubject.INTEGRATION_JOB,
    subjectId: activationKeyId ?? operation?.id ?? null,
    organizationId: operation?.organizationId ?? null,
    actorType: "ANONYMOUS",
    result: "FAILURE",
    metadata: {
      failure_reason: code.slice(0, 64),
      purpose,
      integration_operation_id: operation?.id ?? null,
      ...(key ? { user_account_id: key.userAccountId } : {}),
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
