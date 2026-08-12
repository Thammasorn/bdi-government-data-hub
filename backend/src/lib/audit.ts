/**
 * Immutable audit event — schema `audit`, sheet `audit.audit_event`
 *
 * แทน activity_logs เดิม ต่างกันสี่เรื่อง:
 *   - action code ละเอียดขึ้นมาก (~25 ค่า แทน 10 ค่าหยาบ)
 *   - มี actor_type และ result (SUCCESS/FAILURE) ทำให้บันทึกความล้มเหลวได้
 *   - correlation_id และ source_component เป็น NOT NULL
 *   - ไม่มีคอลัมน์ actor_name / actor_roles อีกแล้ว
 *
 * เรื่องสุดท้ายสำคัญ: ของเดิมคัดลอกชื่อและ role ของผู้กระทำลงแถวโดยตั้งใจ เพื่อให้ log
 * ยังอ่านถูกแม้ผู้ใช้เปลี่ยนชื่อหรือถูกถอน role ภายหลัง ดีไซน์ใหม่มีแต่ actor_id
 * → เก็บชื่อกับ role ต่อใน metadata_json ไม่งั้นเสียคุณสมบัตินั้นไป
 */
import {
  AuditActorType,
  AuditResult,
  RoleAssignmentStatus,
  type Prisma,
} from "@prisma/client";

import { prisma } from "../db.js";
import { correlationId, currentContext, sourceComponent } from "./context.js";

/** action code ตามตัวอย่างใน sheet `audit.audit_event` */
export const AuditAction = {
  USER_ACCOUNT_CREATED: "USER_ACCOUNT_CREATED",
  USER_ACCOUNT_ACTIVATED: "USER_ACCOUNT_ACTIVATED",
  USER_ACCOUNT_DEACTIVATED: "USER_ACCOUNT_DEACTIVATED",

  ACTIVATION_KEY_ISSUED: "ACTIVATION_KEY_ISSUED",
  ACTIVATION_KEY_USED: "ACTIVATION_KEY_USED",
  ACTIVATION_KEY_REVOKED: "ACTIVATION_KEY_REVOKED",
  ACTIVATION_KEY_EXPIRED: "ACTIVATION_KEY_EXPIRED",

  ROLE_ASSIGNED: "ROLE_ASSIGNED",
  ROLE_REVOKED: "ROLE_REVOKED",

  ORGANIZATION_CREATED: "ORGANIZATION_CREATED",
  ORGANIZATION_UPDATED: "ORGANIZATION_UPDATED",
  ORGANIZATION_ACTIVATED: "ORGANIZATION_ACTIVATED",

  REQUEST_CREATED: "REQUEST_CREATED",
  REQUEST_SUBMITTED: "REQUEST_SUBMITTED",
  REQUEST_RETURNED: "REQUEST_RETURNED",
  REQUEST_APPROVED: "REQUEST_APPROVED",
  REQUEST_REJECTED: "REQUEST_REJECTED",

  ATTACHMENT_UPLOADED: "ATTACHMENT_UPLOADED",
  ATTACHMENT_REPLACED: "ATTACHMENT_REPLACED",
  ATTACHMENT_DELETED: "ATTACHMENT_DELETED",

  LOGIN_SUCCEEDED: "LOGIN_SUCCEEDED",
  LOGIN_FAILED: "LOGIN_FAILED",

  DATA_EXPORTED: "DATA_EXPORTED",
  DOCUMENT_DOWNLOADED: "DOCUMENT_DOWNLOADED",
} as const;

export type AuditActionCode = (typeof AuditAction)[keyof typeof AuditAction];

/** subject_type ตามตัวอย่างใน sheet */
export const AuditSubject = {
  USER_ACCOUNT: "USER_ACCOUNT",
  USER_ROLE_ASSIGNMENT: "USER_ROLE_ASSIGNMENT",
  USER_ACTIVATION_KEY: "USER_ACTIVATION_KEY",
  ORGANIZATION: "ORGANIZATION",
  ORGANIZATION_REGISTRATION_REQUEST: "ORGANIZATION_REGISTRATION_REQUEST",
  DATASET: "DATASET",
  DATASET_REGISTRATION_REQUEST: "DATASET_REGISTRATION_REQUEST",
  DATA_REQUEST: "DATA_REQUEST",
  APPROVAL: "APPROVAL",
  ATTACHMENT: "ATTACHMENT",
  LEGAL_DOCUMENT: "LEGAL_DOCUMENT",
  NOTIFICATION: "NOTIFICATION",
  INTEGRATION_JOB: "INTEGRATION_JOB",
} as const;

export type AuditSubjectType = (typeof AuditSubject)[keyof typeof AuditSubject];

interface AuditInput {
  action: AuditActionCode;
  subjectType: AuditSubjectType;
  subjectId?: string | null;
  organizationId?: string | null;
  actorId?: string | null;
  actorType?: AuditActorType;
  result?: AuditResult;
  before?: unknown;
  after?: unknown;
  /** ข้อมูลเพิ่มเติม เช่น { failure_reason: "INVALID_CREDENTIAL" } */
  metadata?: Record<string, unknown>;
}

/** Date และ undefined ลง Json column ไม่ได้ ต้องแปลงเป็นค่าที่ serialize ได้ก่อน */
function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

/**
 * เขียน audit event หนึ่งแถว
 *
 * ล้มเหลวแล้วไม่ throw ต่อ: การบันทึก log ต้องไม่ทำให้คำขอที่ผู้ใช้กดสำเร็จไปแล้วพัง
 */
export async function logAudit(input: AuditInput): Promise<void> {
  try {
    const ctx = currentContext();
    const actorId = input.actorId ?? ctx?.actorId ?? null;

    // ชื่อและ role ณ เวลานั้น — ดีไซน์ไม่มีคอลัมน์ให้ จึงเก็บลง metadata_json
    let actorSnapshot: Record<string, unknown> | undefined;
    if (actorId) {
      const actor = await prisma.userAccount.findUnique({
        where: { id: actorId },
        select: {
          displayName: true,
          email: true,
          roleAssignments: {
            where: { status: RoleAssignmentStatus.ACTIVE },
            select: { role: { select: { code: true } }, organizationId: true },
          },
        },
      });
      if (actor) {
        actorSnapshot = {
          actor_name: actor.displayName || actor.email,
          actor_roles: actor.roleAssignments.map((a) => a.role.code),
          actor_organization_id: actor.roleAssignments.find((a) => a.organizationId)?.organizationId,
        };
      }
    }

    const metadata = { ...actorSnapshot, ...input.metadata };

    await prisma.auditEvent.create({
      data: {
        action: input.action,
        actorType: input.actorType ?? (actorId ? AuditActorType.USER : AuditActorType.SYSTEM),
        actorId,
        subjectType: input.subjectType,
        subjectId: input.subjectId ?? null,
        organizationId: input.organizationId ?? null,
        result: input.result ?? AuditResult.SUCCESS,
        beforeSummaryJson: toJson(input.before),
        afterSummaryJson: toJson(input.after),
        ipAddress: ctx?.ipAddress ?? null,
        userAgent: ctx?.userAgent ?? null,
        correlationId: correlationId(),
        sourceComponent: sourceComponent(),
        metadataJson: Object.keys(metadata).length > 0 ? toJson(metadata) : undefined,
      },
    });
  } catch (err) {
    console.error("[audit] บันทึก audit event ไม่สำเร็จ:", err);
  }
}

/**
 * คืนเฉพาะฟิลด์ที่เปลี่ยนจริง — เก็บทั้ง record ทุกครั้งทำให้ log อ่านไม่ออก
 * เทียบด้วย JSON เพื่อให้ Date และ array เทียบได้โดยไม่ต้องแยกกรณี
 */
export function diffFields<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
): { before: Partial<T>; after: Partial<T> } | null {
  const changedBefore: Partial<T> = {};
  const changedAfter: Partial<T> = {};
  let changed = false;

  for (const key of Object.keys(after) as Array<keyof T>) {
    const a = JSON.stringify(before[key] ?? null);
    const b = JSON.stringify(after[key] ?? null);
    if (a !== b) {
      changedBefore[key] = before[key];
      changedAfter[key] = after[key];
      changed = true;
    }
  }

  return changed ? { before: changedBefore, after: changedAfter } : null;
}
