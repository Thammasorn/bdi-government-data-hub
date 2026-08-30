/**
 * ตัวช่วยของ schema `iam` — role, role assignment และ activation key
 *
 * ทุกฟังก์ชันรับ Prisma client หรือ transaction client ได้ทั้งคู่ เพราะขั้นตอนตาม
 * sheet `activation_key` ("Suggested lifecycle") ต้องเกิดใน transaction เดียว:
 *   6. Update the user account to ACTIVE
 *   7. Create the corresponding user_role_assignment
 *   8. Mark the activation key as USED
 */
import {
  ActivationKeyStatus,
  Prisma,
  PrismaClient,
  RoleAssignmentStatus,
  UserAccountStatus,
} from "@prisma/client";

import { prisma } from "../db.js";
import { env } from "../env.js";
import { AuditAction, AuditSubject, logAudit } from "./audit.js";
import { generateActivationKey, hashActivationKey } from "./auth.js";
import {
  BDI_ORGANIZATION_ID,
  ORGANIZATION_SCOPED_ROLES,
  SYSTEM_USER_ID,
  type RoleCode,
} from "./system.js";

/** ใช้ได้ทั้ง prisma ปกติและ tx ใน $transaction */
export type Db = PrismaClient | Prisma.TransactionClient;

export async function roleIdByCode(db: Db, code: RoleCode): Promise<string> {
  const role = await db.role.findUnique({ where: { code }, select: { id: true } });
  if (!role) {
    // master data หายแปลว่ายังไม่ได้รัน seed:masters — ล้มให้ชัดดีกว่าปล่อยผ่าน
    throw new Error(`ไม่พบ role "${code}" ใน iam.role — รัน npm run seed:masters ก่อน`);
  }
  return role.id;
}

/**
 * เหตุผลที่เขียนลง `revocation_reason` เมื่อคนใหม่มารับ role เดิมแทน
 *
 * เป็นค่าคงที่ไม่ใช่ literal ลอย ๆ เพราะหน้าเว็บต้องอ่านมันกลับ: คนที่ถูกถอดออกด้วย
 * เหตุผลนี้คือคนเดียวที่ควรได้คำอธิบายว่า "หน่วยงานหายไปไหน" ไม่ใช่คนที่ยังไม่เคยมี
 * หน่วยงานเลย — `removedFromOrganization()` ใน routes/auth.ts เทียบกับค่านี้
 */
export const ROLE_REPLACED_REASON = "มีผู้รับผิดชอบคนใหม่แทน";

/** เงื่อนไข "assignment ใช้งานได้" ตามที่ sheet `user_role_assignment` เขียนไว้ */
export function activeAssignmentWhere() {
  return {
    status: RoleAssignmentStatus.ACTIVE,
    OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: new Date() } }],
  };
}

/**
 * derived status ตาม sheet:
 *   REVOKED                                   → REVOKED
 *   effective_until ผ่านมาแล้ว                  → EXPIRED
 *   นอกนั้น                                    → ACTIVE
 */
export function derivedAssignmentStatus(assignment: {
  status: RoleAssignmentStatus;
  effectiveUntil: Date | null;
}): "ACTIVE" | "REVOKED" | "EXPIRED" {
  if (assignment.status === RoleAssignmentStatus.REVOKED) return "REVOKED";
  if (assignment.effectiveUntil && assignment.effectiveUntil <= new Date()) return "EXPIRED";
  return "ACTIVE";
}

/**
 * มอบ role ให้ผู้ใช้
 *
 * **ทุก assignment มีหน่วยงานเสมอ** — role ระดับหน่วยงานใช้หน่วยงานที่ระบุมา
 * ส่วน role ฝั่ง BDI/SYSTEM สังกัดหน่วยงาน BDI ซึ่งเป็นแถวหนึ่งใน organization.organization
 * อยู่แล้ว (เดิมตรงนี้เป็น null ทำให้ตอบจากฐานข้อมูลไม่ได้ว่าเจ้าหน้าที่ BDI อยู่หน่วยงานไหน
 * ทั้งที่ activation_key ของเขาชี้มาที่ BDI มาตลอด — เปลี่ยนเมื่อ 2026-08-16)
 *
 * กติกา "หนึ่งหน่วยงานมี ORGANIZATION_USER / ORGANIZATION_APPROVER ที่ ACTIVE ได้อย่างละคน"
 * บังคับที่นี่ ไม่ใช่ที่ฐานข้อมูลอีกแล้ว — `uq_active_org_scoped_role_assignment` ถูกลบไป
 * เพราะมันคลุมทุก role ไม่ใช่แค่สองตัวนี้ พอเจ้าหน้าที่ BDI มีหน่วยงานจริงก็ชนกันเอง
 * และเขียน index ให้แยก role ไม่ได้ (role.id สุ่มใหม่ทุกฐานข้อมูล)
 *
 * **หน่วยงาน BDI ยกเว้นจากกติกานี้** มีเจ้าหน้าที่กี่คนต่อ role ก็ได้
 */
export async function assignRole(
  db: Db,
  params: {
    userAccountId: string;
    roleCode: RoleCode;
    organizationId?: string | null;
    actorId: string;
    effectiveFrom?: Date;
  },
) {
  const { userAccountId, roleCode, actorId } = params;
  const isOrgScoped = ORGANIZATION_SCOPED_ROLES.includes(roleCode);
  const organizationId = isOrgScoped
    ? (params.organizationId ?? null)
    : (params.organizationId ?? BDI_ORGANIZATION_ID);

  if (isOrgScoped && !organizationId) {
    throw new Error(`role "${roleCode}" ต้องระบุ organizationId`);
  }

  const roleId = await roleIdByCode(db, roleCode);

  /**
   * หนึ่ง role หนึ่งคนต่อหนึ่งหน่วยงาน — เพิกถอนคนเดิมก่อนเสมอ ไม่ใช่ปฏิเสธคนใหม่
   * (พฤติกรรมเดิมตั้งแต่ตอนที่ยังมี unique index คอยรับอยู่ ไม่ได้เปลี่ยน)
   *
   * ไม่ใช้กับหน่วยงาน BDI เพราะเจ้าหน้าที่ BDI มีหลายคนต่อ role เป็นเรื่องปกติ —
   * ถ้าเพิกถอนคนเดิม การเปิดใช้งานบัญชีเจ้าหน้าที่คนที่สองจะไปปิดสิทธิ์คนแรกเงียบ ๆ
   */
  const replaced =
    isOrgScoped && organizationId && organizationId !== BDI_ORGANIZATION_ID
      ? await revokeRoleAssignments(db, {
          organizationId,
          roleId,
          actorId,
          reason: ROLE_REPLACED_REASON,
          exceptUserAccountId: userAccountId,
        })
      : [];

  const existing = await db.userRoleAssignment.findFirst({
    where: { userAccountId, roleId, organizationId, ...activeAssignmentWhere() },
    select: { id: true },
  });
  if (existing) return { id: existing.id, replaced };

  const created = await db.userRoleAssignment.create({
    data: {
      userAccountId,
      roleId,
      organizationId,
      effectiveFrom: params.effectiveFrom ?? new Date(),
      createdBy: actorId,
      updatedBy: actorId,
    },
    select: { id: true },
  });
  return { id: created.id, replaced };
}

/**
 * assignment ที่เพิ่งถูกเพิกถอนไป — ผู้เรียกต้องเอาไปแจ้งเจ้าตัวและเขียน audit
 * ดู `announceRoleReplacement()` ใน lib/notify.ts
 */
export interface RevokedAssignment {
  id: string;
  userAccountId: string;
  organizationId: string | null;
  roleId: string;
}

/**
 * เพิกถอน assignment ที่เข้าเงื่อนไข แล้ว **คืนแถวที่ถูกเพิกถอนกลับไป**
 *
 * คืนกลับไปเพราะคนที่ถูกถอดต้องได้รู้ตัว: `updateMany` ไม่บอกว่าโดนใครไปบ้าง และ
 * ฟังก์ชันนี้ถูกเรียกจากใน transaction เสมอ จะยิงอีเมลหรือเขียน audit ตรงนี้เองไม่ได้
 * (ทั้งสองอย่างเขียนผ่าน prisma ตัวหลัก ไม่ใช่ tx — rollback แล้วจะเหลือหลักฐานของ
 * เหตุการณ์ที่ไม่เคยเกิด) ผู้เรียกจึงต้องเก็บค่านี้ไว้แล้วประกาศหลัง commit
 */
export async function revokeRoleAssignments(
  db: Db,
  params: {
    organizationId?: string | null;
    userAccountId?: string;
    roleId?: string;
    actorId: string;
    reason: string;
    exceptUserAccountId?: string;
  },
): Promise<RevokedAssignment[]> {
  const where = {
    status: RoleAssignmentStatus.ACTIVE,
    ...(params.organizationId !== undefined ? { organizationId: params.organizationId } : {}),
    ...(params.roleId ? { roleId: params.roleId } : {}),
    ...(params.userAccountId ? { userAccountId: params.userAccountId } : {}),
    ...(params.exceptUserAccountId ? { userAccountId: { not: params.exceptUserAccountId } } : {}),
  };

  // อ่านก่อนเขียน — หลัง updateMany เงื่อนไข status = ACTIVE จะไม่ตรงกับแถวเดิมอีกแล้ว
  const targets = await db.userRoleAssignment.findMany({
    where,
    select: { id: true, userAccountId: true, organizationId: true, roleId: true },
  });
  if (targets.length === 0) return [];

  await db.userRoleAssignment.updateMany({
    where: { id: { in: targets.map((t) => t.id) } },
    data: {
      status: RoleAssignmentStatus.REVOKED,
      revokedAt: new Date(),
      revokedBy: params.actorId,
      revocationReason: params.reason,
      updatedBy: params.actorId,
    },
  });

  /**
   * การถอนสิทธิ์ไม่เคยถูกบันทึกลง `audit_event` เลย (บันทึกไว้ว่าค้างที่ `routes/auth.ts`)
   *
   * เป็นช่องว่างที่สำคัญกว่าที่ดู เพราะฟังก์ชันนี้ถอนสิทธิ์คนโดยที่เจ้าตัวไม่ได้ทำอะไรเลย —
   * ถูกแทนที่ด้วยผู้รับผิดชอบคนใหม่ ถูกย้ายหน่วยงาน หรือบัญชีถูกปิด ถ้าไม่มีแถว audit
   * ก็ตอบไม่ได้ว่าใครสั่งและด้วยเหตุผลอะไร เหลือแค่ `revocation_reason` บนแถวที่ถูกถอน
   *
   * `logAudit()` กลืน error ของตัวเองอยู่แล้ว จึงไม่ทำให้ transaction ที่เรียกมาล้ม
   */
  for (const target of targets) {
    await logAudit({
      action: AuditAction.ROLE_REVOKED,
      subjectType: AuditSubject.USER_ROLE_ASSIGNMENT,
      subjectId: target.id,
      organizationId: target.organizationId,
      actorId: params.actorId,
      before: { userAccountId: target.userAccountId, roleId: target.roleId, status: "ACTIVE" },
      after: { status: RoleAssignmentStatus.REVOKED },
      metadata: { reason: params.reason },
    });
  }

  return targets;
}

/** role code ที่ผู้ใช้คนหนึ่งถืออยู่จริง ณ ตอนนี้ */
export async function activeRoleCodes(db: Db, userAccountId: string): Promise<RoleCode[]> {
  const rows = await db.userRoleAssignment.findMany({
    where: { userAccountId, ...activeAssignmentWhere() },
    select: { role: { select: { code: true, isActive: true } } },
  });
  return rows.filter((r) => r.role.isActive).map((r) => r.role.code as RoleCode);
}

/**
 * ออก activation key ใหม่ตาม sheet `activation_key`
 *
 * ยกเลิกคีย์ที่ยัง ISSUED ของ (user, organization, role) เดิมก่อน เพื่อไม่ให้มีลิงก์
 * ที่ใช้ได้หลายอันพร้อมกัน — และเพื่อไม่ให้ชน partial unique index uq_active_activation_key
 * (index ของ activation_key ยังอยู่ ตัวที่ถูกลบไปคือของ user_role_assignment)
 *
 * คืน raw key กลับมาให้ผู้เรียกส่งอีเมล ฐานข้อมูลเก็บแค่ HMAC
 */
export async function issueActivationKey(
  db: Db,
  params: {
    userAccountId: string;
    organizationId: string;
    roleCode: RoleCode;
    actorId?: string;
    ttlDays?: number;
  },
) {
  const actorId = params.actorId ?? SYSTEM_USER_ID;
  const roleId = await roleIdByCode(db, params.roleCode);
  const { key, keyHash } = generateActivationKey();

  await db.activationKey.updateMany({
    where: {
      userAccountId: params.userAccountId,
      organizationId: params.organizationId,
      roleId,
      status: ActivationKeyStatus.ISSUED,
    },
    data: {
      status: ActivationKeyStatus.REVOKED,
      revokedAt: new Date(),
      revokedBy: actorId,
      revokedReason: "ออกคีย์ใหม่แทน",
      updatedBy: actorId,
    },
  });

  const ttlDays = params.ttlDays ?? env.auth.activationKeyTtlDays;
  const record = await db.activationKey.create({
    data: {
      userAccountId: params.userAccountId,
      organizationId: params.organizationId,
      roleId,
      keyHash,
      expiresAt: new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000),
      createdBy: actorId,
      updatedBy: actorId,
    },
  });

  return { key, record };
}

export type ActivationLookupFailure = "not_found" | "used" | "expired" | "revoked";

/**
 * หา activation key ที่ยังใช้ได้จาก raw key
 * คีย์ที่เลยกำหนดจะถูกเปลี่ยนสถานะเป็น EXPIRED ทันทีที่พบ ไม่รอ job มาเก็บกวาด
 */
export async function findUsableActivationKey(rawKey: string) {
  const record = await prisma.activationKey.findFirst({
    where: { keyHash: hashActivationKey(rawKey) },
    include: ACTIVATION_KEY_INCLUDE,
  });
  return evaluateActivationKey(record);
}

/**
 * เหมือน findUsableActivationKey แต่หาจาก id ของแถว
 *
 * callback ของ ThaiD ไม่มี raw key อยู่ในมือ (จงใจ — คีย์จริงไม่เคยถูกส่งผ่าน
 * ThaiD หรือถูกเก็บลงฐานข้อมูล) มีแต่ subject_id ของ integration_operation
 */
export async function usableActivationKeyById(id: string) {
  const record = await prisma.activationKey.findUnique({
    where: { id },
    include: ACTIVATION_KEY_INCLUDE,
  });
  return evaluateActivationKey(record);
}

const ACTIVATION_KEY_INCLUDE = {
  userAccount: true,
  organization: { select: { id: true, nameTh: true, status: true } },
  role: { select: { id: true, code: true, nameTh: true } },
} as const;

type ActivationKeyRecord = Prisma.ActivationKeyGetPayload<{
  include: typeof ACTIVATION_KEY_INCLUDE;
}> | null;

async function evaluateActivationKey(record: ActivationKeyRecord) {
  if (!record) return { key: null, reason: "not_found" as ActivationLookupFailure };
  if (record.status === ActivationKeyStatus.USED) {
    return { key: null, reason: "used" as ActivationLookupFailure };
  }
  if (record.status === ActivationKeyStatus.REVOKED) {
    return { key: null, reason: "revoked" as ActivationLookupFailure };
  }
  if (record.expiresAt < new Date()) {
    if (record.status !== ActivationKeyStatus.EXPIRED) {
      await prisma.activationKey.update({
        where: { id: record.id },
        data: { status: ActivationKeyStatus.EXPIRED, updatedBy: SYSTEM_USER_ID },
      });
    }
    return { key: null, reason: "expired" as ActivationLookupFailure };
  }

  return { key: record, reason: null };
}

/**
 * ยกเลิกคีย์ที่ยังใช้ได้อยู่
 *
 * §2.4 ของสเปกสั่งไว้ว่าเลขบัตรจาก ThaiD ไม่ตรงกับที่บันทึกไว้ → REVOKED ไม่ใช่แค่
 * ปฏิเสธครั้งนั้น คนที่ถือลิงก์ต้องขอใบใหม่จากเจ้าหน้าที่ ลองสุ่มเลขบัตรซ้ำ ๆ ไม่ได้
 */
export async function revokeActivationKey(
  db: Db,
  params: { activationKeyId: string; reason: string; actorId?: string },
) {
  const actorId = params.actorId ?? SYSTEM_USER_ID;
  await db.activationKey.update({
    where: { id: params.activationKeyId },
    data: {
      status: ActivationKeyStatus.REVOKED,
      revokedAt: new Date(),
      revokedBy: actorId,
      revokedReason: params.reason,
      updatedBy: actorId,
    },
  });
}

/**
 * ปิดงาน activation ตามขั้นที่ 6–8 ของ lifecycle ใน sheet
 * เรียกจากใน transaction เท่านั้น
 */
export async function completeActivation(
  db: Db,
  params: { activationKeyId: string; userAccountId: string; roleCode: RoleCode; organizationId: string },
) {
  await db.userAccount.update({
    where: { id: params.userAccountId },
    data: {
      status: UserAccountStatus.ACTIVE,
      activatedAt: new Date(),
      lastLoginAt: new Date(),
      updatedBy: params.userAccountId,
    },
  });

  // ส่งกลับให้ผู้เรียกประกาศหลัง commit — คนที่ถูกแทนที่ต้องได้รู้ตัว
  const { replaced } = await assignRole(db, {
    userAccountId: params.userAccountId,
    roleCode: params.roleCode,
    organizationId: params.organizationId,
    actorId: params.userAccountId,
  });

  await db.activationKey.update({
    where: { id: params.activationKeyId },
    data: {
      status: ActivationKeyStatus.USED,
      usedAt: new Date(),
      updatedBy: params.userAccountId,
    },
  });

  return { replaced };
}
