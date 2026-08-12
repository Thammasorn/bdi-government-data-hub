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
import { generateActivationKey, hashActivationKey } from "./auth.js";
import { ORGANIZATION_SCOPED_ROLES, SYSTEM_USER_ID, type RoleCode } from "./system.js";

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
 * role ระดับหน่วยงานต้องมี organizationId เสมอ ส่วน role ฝั่ง BDI ต้องเป็น null
 * (sheet มาร์กคอลัมน์นี้ว่า Conditional — Organization scope)
 *
 * partial unique index uq_active_org_scoped_role_assignment บังคับว่าหนึ่งหน่วยงาน
 * มี ORGANIZATION_USER / ORGANIZATION_APPROVER ที่ ACTIVE ได้อย่างละคนเดียว
 * จึงเพิกถอนคนเดิมก่อนเสมอ ไม่ปล่อยให้ insert ชนแล้วโยน error ออกไปหา client
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
  const organizationId = isOrgScoped ? (params.organizationId ?? null) : null;

  if (isOrgScoped && !organizationId) {
    throw new Error(`role "${roleCode}" ต้องระบุ organizationId`);
  }

  const roleId = await roleIdByCode(db, roleCode);

  if (isOrgScoped && organizationId) {
    await revokeRoleAssignments(db, {
      organizationId,
      roleId,
      actorId,
      reason: "มีผู้รับผิดชอบคนใหม่แทน",
      exceptUserAccountId: userAccountId,
    });
  }

  const existing = await db.userRoleAssignment.findFirst({
    where: { userAccountId, roleId, organizationId, ...activeAssignmentWhere() },
    select: { id: true },
  });
  if (existing) return existing;

  return db.userRoleAssignment.create({
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
}

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
) {
  await db.userRoleAssignment.updateMany({
    where: {
      status: RoleAssignmentStatus.ACTIVE,
      ...(params.organizationId !== undefined ? { organizationId: params.organizationId } : {}),
      ...(params.roleId ? { roleId: params.roleId } : {}),
      ...(params.userAccountId ? { userAccountId: params.userAccountId } : {}),
      ...(params.exceptUserAccountId ? { userAccountId: { not: params.exceptUserAccountId } } : {}),
    },
    data: {
      status: RoleAssignmentStatus.REVOKED,
      revokedAt: new Date(),
      revokedBy: params.actorId,
      revocationReason: params.reason,
      updatedBy: params.actorId,
    },
  });
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
    include: {
      userAccount: true,
      organization: { select: { id: true, nameTh: true, status: true } },
      role: { select: { id: true, code: true, nameTh: true } },
    },
  });

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

  await assignRole(db, {
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
}
