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
  OrganizationStatus,
  Prisma,
  PrismaClient,
  RoleAssignmentStatus,
  UserAccountStatus,
} from "@prisma/client";

import { prisma } from "../db.js";
import { env } from "../env.js";
import { AuditAction, AuditSubject, logAudit } from "./audit.js";
import { generateActivationKey, hashActivationKey } from "./auth.js";
import { ROLE_LABELS } from "./roles.js";
import {
  BDI_ORGANIZATION_ID,
  ORGANIZATION_SCOPED_ROLES,
  ROLE_CODES,
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

/**
 * บัญชีนี้ถือบทบาทอื่นอยู่แล้ว — กฎ *หนึ่งผู้ใช้ = หนึ่งบทบาท* (ตัดสินใจ 2026-09-03)
 *
 * เป็น error แยกชนิด ไม่ใช่ `Error` ลอย ๆ เพราะผู้เรียกทุกทางต้องแปลงเป็น 409 พร้อม
 * บอกว่าบทบาทที่ถืออยู่คืออะไร ไม่ใช่ปล่อยเป็น 500 กลางทรานแซกชัน — ทุกเส้นทางที่
 * มอบบทบาทควรดักไว้ก่อนหน้านี้ด้วยข้อความของตัวเอง ตัวนี้คือตาข่ายชั้นสุดท้าย
 */
export class RoleConflictError extends Error {
  constructor(
    readonly currentRole: RoleCode,
    readonly currentOrganizationId: string | null,
    message: string,
  ) {
    super(message);
    this.name = "RoleConflictError";
  }
}

/**
 * ที่นั่งนี้มีคนถืออยู่แล้ว — กฎ *หนึ่งหน่วยงานมี ORGANIZATION_USER / ORGANIZATION_APPROVER
 * ได้อย่างละคน* ฉบับ 2026-09-13 ที่ **ปฏิเสธคนใหม่** แทนการเตะคนเดิมออก
 *
 * แยกชนิดจาก `RoleConflictError` เพราะเป็นคนละคำถาม: ตัวนั้นคือ "คนนี้ถือบทบาทอื่นอยู่"
 * ตัวนี้คือ "บทบาทนี้มีคนอื่นถืออยู่" ทางออกจึงต่างกัน — ตัวนั้นถอนบทบาทของคนนี้
 * ตัวนี้ต้องระงับหรือยุติบัญชีของ *คนเดิม* ก่อน ผู้เรียกทุกทางควรดักด้วย
 * `roleSeatTaken()` ก่อนถึงตรงนี้ ตัวนี้เป็นตาข่ายชั้นสุดท้ายในทรานแซกชัน
 */
export class RoleOccupiedError extends Error {
  constructor(
    readonly roleCode: RoleCode,
    readonly organizationId: string,
    readonly holderUserAccountId: string,
    message: string,
  ) {
    super(message);
    this.name = "RoleOccupiedError";
  }
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
 * **ทุก assignment มีหน่วยงานเสมอ** — role ระดับหน่วยงานใช้หน่วยงานที่ระบุมา
 * ส่วน role ฝั่ง BDI/SYSTEM สังกัดหน่วยงาน BDI ซึ่งเป็นแถวหนึ่งใน organization.organization
 * อยู่แล้ว (เดิมตรงนี้เป็น null ทำให้ตอบจากฐานข้อมูลไม่ได้ว่าเจ้าหน้าที่ BDI อยู่หน่วยงานไหน
 * ทั้งที่ activation_key ของเขาชี้มาที่ BDI มาตลอด — เปลี่ยนเมื่อ 2026-08-16)
 *
 * กติกาจำนวนผู้ถือ `ORGANIZATION_USER` / `ORGANIZATION_APPROVER` ต่อหน่วยงาน (ก่อน ACTIVE อย่างละคน
 * หลังจากนั้นตามที่ผู้ดูแลระบบตั้ง ดู `roleSeatLimit()`) บังคับที่นี่ ไม่ใช่ที่ฐานข้อมูลอีกแล้ว —
 * `uq_active_org_scoped_role_assignment` ถูกลบไป เพราะมันคลุมทุก role ไม่ใช่แค่สองตัวนี้ พอเจ้าหน้าที่ BDI
 * มีหน่วยงานจริงก็ชนกันเอง และเขียน index ให้แยก role ไม่ได้ (role.id สุ่มใหม่ทุกฐานข้อมูล)
 *
 * **กติกานี้ปฏิเสธคนใหม่ ไม่เตะใครออก** — ดู `roleSeatTaken()` และคอมเมนต์ในตัวฟังก์ชัน
 *
 * **หน่วยงาน BDI ยกเว้นจากกติกานี้** มีเจ้าหน้าที่กี่คนต่อ role ก็ได้
 *
 * อีกกติกาหนึ่งที่คนละเรื่องกันและบังคับที่นี่เหมือนกันคือ **หนึ่งผู้ใช้ = หนึ่งบทบาท**
 * (2026-09-03) ซึ่งครอบทุก role ทั้งฝั่งหน่วยงานและฝั่ง BDI ไม่มีข้อยกเว้น — ดูเหตุผล
 * ในตัวฟังก์ชัน มอบบทบาทที่ถืออยู่แล้ว (คู่ role+หน่วยงานเดิม) ยังเป็น no-op เหมือนเดิม
 */
export async function assignRole(
  db: Db,
  params: {
    userAccountId: string;
    roleCode: RoleCode;
    organizationId?: string | null;
    actorId: string;
    effectiveFrom?: Date;
    skipSeatCheck?: boolean;
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
   * **หนึ่งผู้ใช้ = หนึ่งบทบาท** (ตัดสินใจ 2026-09-03) — บังคับที่นี่ที่เดียว
   *
   * ทุกทางที่มอบบทบาทวิ่งผ่านฟังก์ชันนี้ (เปิดใช้งานบัญชีจาก activation key ·
   * `POST /api/admin/users/:id/roles` · `POST /:id/transfer` · Journey B ตอน BDI
   * กดผ่านด่านแรก · `seed:demo`) เขียนกฎไว้ตรงนี้จึงปิดได้ครบด้วยจุดเดียว
   *
   * กฎที่มีมาก่อนหน้านี้เป็นคนละกฎ และไม่มีอันไหนกันเคสนี้: `assignRole()` กัน
   * "หนึ่งหน่วยงาน หนึ่งคนต่อ role" ส่วน `organizationClash()` ใน routes/admin-users.ts
   * กัน "หนึ่งบัญชี หนึ่งหน่วยงาน" — ผู้ดำเนินการของหน่วยงานหนึ่งจึงรับบทบาท
   * ผู้มีอำนาจกระทำการแทนของ **หน่วยงานเดียวกัน** เพิ่มได้ แล้วนำส่งคำขอเองและ
   * ลงนามรับรองคำขอของตัวเองที่ด่าน `ORGANIZATION_APPROVAL` ฝั่ง BDI ก็เช่นกัน:
   * คนเดียวถือ `BDI_OFFICER` + `BDI_FINAL_APPROVER` แล้วตรวจด่านที่ 2 กับอนุมัติ
   * ด่านที่ 4 ของใบเดียวกันได้
   *
   * **ปฏิเสธคนใหม่ ไม่ใช่เพิกถอนของเดิม** — ตรงข้ามกับกติกา "หนึ่งหน่วยงานหนึ่งคน
   * ต่อ role" ข้างล่างที่เพิกถอนคนเดิมเงียบ ๆ เพราะที่นี่ของเดิมเป็นสิทธิ์ของคนคนนี้เอง
   * การถอนมันทิ้งโดยไม่มีใครสั่งคือการเปลี่ยนหน้าที่ของเขาโดยที่ไม่มีใครตั้งใจ
   * ทางเปลี่ยนบทบาทที่ตั้งใจแล้วคือ `POST /api/admin/users/:id/transfer` (ถอนของเดิม
   * และมอบของใหม่ในคำสั่งเดียว) หรือ `DELETE /:id/roles/:assignmentId` ก่อนมอบใหม่
   */
  const held = await db.userRoleAssignment.findFirst({
    where: {
      userAccountId,
      NOT: { roleId, organizationId },
      ...activeAssignmentWhere(),
    },
    select: { organizationId: true, role: { select: { code: true } } },
  });
  if (held) {
    const heldCode = held.role.code as RoleCode;
    throw new RoleConflictError(
      heldCode,
      held.organizationId,
      `บัญชีนี้ถือบทบาท "${ROLE_LABELS[heldCode]}" อยู่แล้ว — ผู้ใช้หนึ่งคนมีได้บทบาทเดียว ` +
        `ต้องถอนบทบาทเดิมก่อนจึงจะมอบบทบาทใหม่ได้`,
    );
  }

  /**
   * จำนวนผู้ถือ role ของหน่วยงานต้องไม่เกินที่กำหนด — **ปฏิเสธคนใหม่** เมื่อเต็ม ไม่เตะใครออก
   *
   * ที่นั่งเต็มนับรวมคนที่ถูกระงับ เพราะการระงับคือชั่วคราว เขาคืนสถานะได้ทุกเมื่อและกลับมาทำงานต่อได้
   * จนถึง 2026-11-04 คนที่ถูกระงับไม่นับ และเสีย role ให้คนใหม่ตอนเปิดใช้งาน ทำให้การระงับกลายเป็นการถอด
   * ถาวรโดยที่ไม่มีใครสั่ง ที่นั่งจะว่างก็ต่อเมื่อมีคนถอดเขาออกจริง ๆ เท่านั้น
   *
   * `skipSeatCheck` คือคีย์ที่มาจากคำขอเปลี่ยนแปลงผู้แทน — จำนวนถูกตรวจไปแล้วตอน BDI ยืนยัน และผู้ถูกเชิญ
   * ต้องเปิดใช้งานได้แม้ผู้ดูแลระบบลดเพดานลงทีหลัง
   *
   * ไม่ใช้กับหน่วยงาน BDI เพราะเจ้าหน้าที่ BDI มีหลายคนต่อ role เป็นเรื่องปกติ
   */
  if (isOrgScoped && organizationId && organizationId !== BDI_ORGANIZATION_ID && !params.skipSeatCheck) {
    const holder = await roleSeatTaken(db, { organizationId, roleId, exceptUserAccountId: userAccountId });
    if (holder) {
      throw new RoleOccupiedError(
        roleCode,
        organizationId,
        holder.userAccountId,
        `หน่วยงานนี้มี "${ROLE_LABELS[roleCode]}" ครบตามจำนวนที่กำหนดแล้ว — ` +
          `ต้องยุติบัญชีคนเดิมก่อนจึงจะมอบบทบาทนี้ให้คนใหม่ได้`,
      );
    }
  }

  // `created` บอกผู้เรียกว่ามีการมอบจริงหรือเป็น no-op — `ROLE_ASSIGNED` ต้องไม่ถูกเขียน
  // ให้ assignment ที่มีอยู่ก่อนแล้ว ไม่งั้น log จะบอกเวลามอบผิด
  const existing = await db.userRoleAssignment.findFirst({
    where: { userAccountId, roleId, organizationId, ...activeAssignmentWhere() },
    select: { id: true },
  });
  if (existing) return { id: existing.id, created: false };

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
  return { id: created.id, created: true };
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
 * เพดานจำนวนผู้ถือ role หนึ่งของหน่วยงานหนึ่ง
 *
 * หน่วยงานที่ยังไม่ผ่าน Journey B มีได้อย่างละคน ส่วนหน่วยงานที่เปิดใช้งานแล้วใช้ค่าที่ผู้ดูแลระบบตั้งไว้
 * หน่วยงาน BDI และ role ที่ไม่ใช่ระดับหน่วยงานไม่มีเพดาน
 */
export async function roleSeatLimit(
  db: Db,
  params: { organizationId: string; roleId: string },
): Promise<number> {
  if (params.organizationId === BDI_ORGANIZATION_ID) return Number.POSITIVE_INFINITY;
  const [organization, role] = await Promise.all([
    db.organization.findUnique({
      where: { id: params.organizationId },
      select: { status: true, maxOrganizationUserCount: true, maxOrganizationApproverCount: true },
    }),
    db.role.findUnique({ where: { id: params.roleId }, select: { code: true } }),
  ]);
  if (!organization || !role) return Number.POSITIVE_INFINITY;
  if (!ORGANIZATION_SCOPED_ROLES.includes(role.code as RoleCode)) return Number.POSITIVE_INFINITY;
  if (organization.status === OrganizationStatus.PENDING_REGISTRATION) return 1;
  return role.code === ROLE_CODES.ORGANIZATION_APPROVER
    ? organization.maxOrganizationApproverCount
    : organization.maxOrganizationUserCount;
}

/** ผู้ถือ role ที่ยังนับเป็นคนของหน่วยงาน — บัญชีที่ถูกระงับยังนับ เพราะเขาคืนสถานะได้ */
const SEAT_HOLDER_ACCOUNT = {
  status: { in: [UserAccountStatus.ACTIVE, UserAccountStatus.SUSPENDED] },
};

/**
 * ที่นั่งของ (หน่วยงาน, role) ถูกใช้ไปกี่คน — ผู้ถือ role รวมคนที่ถูกระงับ + คำเชิญที่ยังใช้ได้
 *
 * นับเป็นรายคน คนหนึ่งที่มีทั้ง role และคำเชิญค้างนับครั้งเดียว ต้องนับคำเชิญด้วย ไม่งั้นคนที่ยังไม่เปิดใช้งาน
 * ทำให้เกินเพดานได้ตอนเขากดลิงก์ ซึ่งห่างจากคนที่เชิญหลายวัน
 */
export async function roleSeatUsage(
  db: Db,
  params: { organizationId: string; roleId: string; exceptUserAccountId?: string },
) {
  const except = params.exceptUserAccountId ? { userAccountId: { not: params.exceptUserAccountId } } : {};
  const [limit, holders, invited] = await Promise.all([
    roleSeatLimit(db, params),
    db.userRoleAssignment.findMany({
      where: {
        organizationId: params.organizationId,
        roleId: params.roleId,
        ...except,
        userAccount: SEAT_HOLDER_ACCOUNT,
        ...activeAssignmentWhere(),
      },
      select: { userAccountId: true },
    }),
    db.activationKey.findMany({
      where: {
        organizationId: params.organizationId,
        roleId: params.roleId,
        status: ActivationKeyStatus.ISSUED,
        expiresAt: { gt: new Date() },
        ...except,
      },
      select: { userAccountId: true },
    }),
  ]);
  const used = new Set([...holders, ...invited].map((row) => row.userAccountId)).size;
  return { limit, used, full: used >= limit };
}

/**
 * ที่นั่งของ (หน่วยงาน, role) เต็มแล้วเพราะมีผู้ถือ role — คืนผู้ถือคนหนึ่งไว้บอกในข้อความ, `null` ถ้ายังรับได้
 *
 * เต็มเพราะคำเชิญล้วน ๆ ตอบ `null` ที่นี่ และ `pendingInvitationFor()` เป็นคนตอบแทน ผู้เรียกจึงถามสองตัวนี้
 * ตามลำดับได้เหมือนเดิม
 *
 * `POST /api/admin/invitations` · `POST /api/admin/users/:id/roles` · `transfer` และ
 * `approverConflict()` ใน routes/organizations.ts ใช้ตัวนี้ตอบ 409 ล่วงหน้าพร้อมบอก
 * ทางออก แทนที่จะปล่อยให้ `RoleOccupiedError` โยนกลางทรานแซกชัน
 */
export async function roleSeatTaken(
  db: Db,
  params: { organizationId: string; roleId: string; exceptUserAccountId?: string },
) {
  if (!(await roleSeatUsage(db, params)).full) return null;
  return db.userRoleAssignment.findFirst({
    where: {
      organizationId: params.organizationId,
      roleId: params.roleId,
      ...(params.exceptUserAccountId ? { userAccountId: { not: params.exceptUserAccountId } } : {}),
      userAccount: SEAT_HOLDER_ACCOUNT,
      ...activeAssignmentWhere(),
    },
    select: {
      id: true,
      userAccountId: true,
      userAccount: { select: { email: true, displayName: true } },
    },
  });
}

/**
 * ที่นั่งเต็มแล้ว และมีคำเชิญที่ยังใช้ได้อยู่ในนั้น — คืนใบล่าสุด, `null` ถ้ายังรับได้
 *
 * นับเป็น "จองที่นั่งแล้ว" ตั้งแต่ตอนเชิญ ถ้าเชิญเกินได้ คนที่กดลิงก์ทีหลังจะเจอ `RoleOccupiedError`
 * ซึ่งเป็น error ที่เขาแก้เองไม่ได้และห่างจากคนที่เชิญหลายวัน ผู้ดูแลระบบจึงต้องยกเลิกคำเชิญใบเดิมก่อน
 * (`DELETE /api/admin/invitations/:id`)
 */
export async function pendingInvitationFor(
  db: Db,
  params: { organizationId: string; roleId: string; exceptUserAccountId?: string },
) {
  if (!(await roleSeatUsage(db, params)).full) return null;
  return db.activationKey.findFirst({
    where: {
      organizationId: params.organizationId,
      roleId: params.roleId,
      status: ActivationKeyStatus.ISSUED,
      expiresAt: { gt: new Date() },
      ...(params.exceptUserAccountId ? { userAccountId: { not: params.exceptUserAccountId } } : {}),
    },
    select: { id: true, userAccountId: true, userAccount: { select: { email: true } } },
    orderBy: { createdAt: "desc" },
  });
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

/** activation key ที่เพิ่งถูกเพิกถอน — ผู้เรียกส่งต่อให้ `logKeysRevoked()` หลัง commit */
export interface RevokedKey {
  id: string;
  userAccountId: string;
  organizationId: string;
  roleCode: string;
  /** ค่าที่เขียนลง `revoked_reason` — แถว audit ใช้ค่าเดียวกัน */
  reason: string;
}

/**
 * เพิกถอนคีย์ที่ยัง `ISSUED` ตามเงื่อนไข แล้ว **คืนคีย์ที่ถูกเพิกถอนกลับไป**
 *
 * เหตุผลเดียวกับ `revokeRoleAssignments()`: `updateMany` ไม่บอกว่าโดนใบไหนไปบ้าง และทุกผู้เรียกอยู่ใน
 * transaction ซึ่งเขียน audit เองไม่ได้ (audit เขียนผ่าน prisma ตัวหลัก rollback แล้วจะเหลือแถวของการ
 * เพิกถอนที่ไม่เคยเกิด) ผู้เรียกจึงต้องถือค่านี้ออกจาก transaction แล้วเขียน `ACTIVATION_KEY_REVOKED`
 * หลัง commit เดิมแต่ละทางเขียน `updateMany` ของตัวเองและไม่มีทางไหนเขียน audit เลย
 *
 * **คืนเฉพาะใบที่ UPDATE นี้เปลี่ยนเอง** (`updateManyAndReturn` = `UPDATE … RETURNING`) ไม่ใช่ใบที่อ่านเจอก่อน
 * เขียน: รุ่นแรกอ่าน ISSUED ด้วย `findMany` แล้วค่อย `updateMany` สี่คำสั่ง revoke ที่ยิงพร้อมกันจึงเห็นใบเดียวกัน
 * เป็น ISSUED ทั้งสี่ ได้ 200 ทั้งสี่ และเขียน `ACTIVATION_KEY_REVOKED` สี่แถว ทั้งที่มีแค่ใบแรกที่เปลี่ยนสถานะได้จริง
 * (สามแถวเป็นการเพิกถอนที่ไม่เคยเกิด และใบที่ `/activate` เพิ่งใช้ไปก็ถูกบันทึกว่าถูกเพิกถอนได้ด้วย) ตอนนี้
 * เงื่อนไข ISSUED อยู่ใน WHERE ของคำสั่งเดียวกับที่เขียน คนที่มาทีหลังรอ lock ของแถวแล้วได้รายการว่าง
 *
 * ต้องระบุ `id` หรือ `userAccountId` อย่างใดอย่างหนึ่งเสมอ — เงื่อนไขว่างคือการเพิกถอนคีย์ทั้งระบบ
 */
export async function revokeIssuedKeys(
  db: Db,
  where: { id: string } | { userAccountId: string; organizationId?: string; roleId?: string },
  params: { actorId: string; reason: string },
): Promise<RevokedKey[]> {
  const revoked = await db.activationKey.updateManyAndReturn({
    where: { ...where, status: ActivationKeyStatus.ISSUED },
    data: {
      status: ActivationKeyStatus.REVOKED,
      revokedAt: new Date(),
      revokedBy: params.actorId,
      revokedReason: params.reason,
      updatedBy: params.actorId,
    },
    select: { id: true, userAccountId: true, organizationId: true, role: { select: { code: true } } },
  });

  return revoked.map((t) => ({
    id: t.id,
    userAccountId: t.userAccountId,
    organizationId: t.organizationId,
    roleCode: t.role.code,
    reason: params.reason,
  }));
}

/**
 * `ACTIVATION_KEY_REVOKED` หนึ่งแถวต่อคีย์ — เรียกหลัง commit ของ transaction ที่คืน `RevokedKey[]` มา
 *
 * `revokedVia` คือช่องทางเดียวกับแถวต้นเรื่องของคำขอนั้น (ADMIN_API · ADMIN_RESET_API · REVIEW_API)
 * `replacedByKeyId` ใส่เมื่อเพิกถอนเพราะออกใบใหม่แทน ไม่ throw เหมือน `logAudit()`
 */
export async function logKeysRevoked(
  keys: RevokedKey[],
  context: { revokedVia: string; replacedByKeyId?: string },
): Promise<void> {
  for (const key of keys) {
    await logAudit({
      action: AuditAction.ACTIVATION_KEY_REVOKED,
      subjectType: AuditSubject.USER_ACTIVATION_KEY,
      subjectId: key.id,
      organizationId: key.organizationId,
      before: { status: ActivationKeyStatus.ISSUED },
      after: { status: ActivationKeyStatus.REVOKED },
      metadata: {
        reason: key.reason,
        revoked_via: context.revokedVia,
        user_account_id: key.userAccountId,
        role: key.roleCode,
        ...(context.replacedByKeyId ? { replaced_by_key_id: context.replacedByKeyId } : {}),
      },
    });
  }
}

/**
 * ออก activation key ใหม่ตาม sheet `activation_key`
 *
 * ยกเลิกคีย์ที่ยัง ISSUED ของ (user, organization, role) เดิมก่อน เพื่อไม่ให้มีลิงก์
 * ที่ใช้ได้หลายอันพร้อมกัน — และเพื่อไม่ให้ชน partial unique index uq_active_activation_key
 * (index ของ activation_key ยังอยู่ ตัวที่ถูกลบไปคือของ user_role_assignment)
 *
 * คืน raw key กลับมาให้ผู้เรียกส่งอีเมล ฐานข้อมูลเก็บแค่ HMAC และคืนใบที่ถูกแทนที่ (`revokedKeys`)
 * ให้ผู้เรียกส่งต่อ `logKeysRevoked()` พร้อม `replacedByKeyId` หลัง commit
 */
export async function issueActivationKey(
  db: Db,
  params: {
    userAccountId: string;
    organizationId: string;
    roleCode: RoleCode;
    actorId?: string;
    ttlSeconds?: number;
  },
) {
  const actorId = params.actorId ?? SYSTEM_USER_ID;
  const roleId = await roleIdByCode(db, params.roleCode);
  const { key, keyHash } = generateActivationKey();

  const revokedKeys = await revokeIssuedKeys(
    db,
    { userAccountId: params.userAccountId, organizationId: params.organizationId, roleId },
    { actorId, reason: "ออกคีย์ใหม่แทน" },
  );

  const ttlSeconds = params.ttlSeconds ?? env.auth.activationKeyTtlSeconds;
  const record = await db.activationKey.create({
    data: {
      userAccountId: params.userAccountId,
      organizationId: params.organizationId,
      roleId,
      keyHash,
      expiresAt: new Date(Date.now() + ttlSeconds * 1000),
      createdBy: actorId,
      updatedBy: actorId,
    },
  });

  return { key, record, revokedKeys };
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
 * callback ของ ThaID ไม่มี raw key อยู่ในมือ (จงใจ — คีย์จริงไม่เคยถูกส่งผ่าน
 * ThaID หรือถูกเก็บลงฐานข้อมูล) มีแต่ subject_id ของ integration_operation
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
      // เงื่อนไขสถานะเดิมอยู่ใน where — สองคำขอที่เปิดลิงก์เดียวกันพร้อมกันจะมีใบเดียว
      // ที่พลิกได้จริง และ `ACTIVATION_KEY_EXPIRED` จึงมีแถวเดียวต่อคีย์
      const { count } = await prisma.activationKey.updateMany({
        where: { id: record.id, status: record.status },
        data: { status: ActivationKeyStatus.EXPIRED, updatedBy: SYSTEM_USER_ID },
      });
      if (count > 0) {
        await logAudit({
          action: AuditAction.ACTIVATION_KEY_EXPIRED,
          subjectType: AuditSubject.USER_ACTIVATION_KEY,
          subjectId: record.id,
          organizationId: record.organizationId,
          before: { status: record.status },
          after: { status: ActivationKeyStatus.EXPIRED },
          metadata: {
            user_account_id: record.userAccountId,
            role: record.role.code,
            expires_at: record.expiresAt,
          },
        });
      }
    }
    return { key: null, reason: "expired" as ActivationLookupFailure };
  }

  return { key: record, reason: null };
}

/**
 * ยกเลิกคีย์ที่ยังใช้ได้อยู่
 *
 * §2.4 ของสเปกสั่งไว้ว่าเลขบัตรจาก ThaID ไม่ตรงกับที่บันทึกไว้ → REVOKED ไม่ใช่แค่
 * ปฏิเสธครั้งนั้น คนที่ถือลิงก์ต้องขอใบใหม่จากเจ้าหน้าที่ ลองสุ่มเลขบัตรซ้ำ ๆ ไม่ได้
 *
 * ไม่ผ่าน `revokeIssuedKeys()` และไม่มี `ACTIVATION_KEY_REVOKED` โดยตั้งใจ — ผู้เรียกเขียน
 * `IDENTITY_VERIFICATION_FAILED` (`CID_MISMATCH`) ซึ่งเป็นหลักฐานของการเพิกถอนครั้งนี้อยู่แล้ว
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
 * คีย์ไม่ได้เป็น `ISSUED` แล้วตอนที่ `completeActivation()` จะใช้มัน — อีก transaction เปลี่ยนไปก่อน
 *
 * `POST /activate` อ่านคีย์ก่อนเปิด transaction แล้วใช้เวลา hash รหัสผ่านอยู่ข้างใน ระหว่างนั้นผู้ดูแลระบบ
 * เพิกถอนได้ หรือฟอร์มเดิมถูกส่งซ้ำแล้วใบแรกใช้คีย์ไปแล้ว `reason` คือสถานะที่ transaction อื่น commit ไว้
 * ผู้เรียกตอบ 410 ด้วยรหัสเดียวกับตอนอ่านคีย์ไม่ผ่าน และทั้ง transaction ถอยกลับ บัญชีจึงไม่ถูกเปิด
 */
export class ActivationKeyUnusableError extends Error {
  constructor(readonly reason: ActivationLookupFailure) {
    super(`activation key ถูกเปลี่ยนสถานะไปก่อน (${reason})`);
    this.name = "ActivationKeyUnusableError";
  }
}

/**
 * ปิดงาน activation ตามขั้นที่ 6–8 ของ lifecycle ใน sheet
 * เรียกจากใน transaction เท่านั้น
 */
export async function completeActivation(
  db: Db,
  params: {
    activationKeyId: string;
    userAccountId: string;
    roleCode: RoleCode;
    organizationId: string;
    skipSeatCheck?: boolean;
  },
) {
  /**
   * ขั้นที่ 8 ทำก่อน และเงื่อนไข `ISSUED` อยู่ใน WHERE ของคำสั่งที่เขียน — กับดัก read-then-write
   * เดียวกับ `revokeIssuedKeys()` เดิมเป็น `update` ตามสถานะที่อ่านไว้นอก transaction จึงทับ `REVOKED`
   * ของคำสั่งเพิกถอนที่ commit ระหว่างนั้นได้ (บัญชีเปิดด้วยคำเชิญที่ถูกยกเลิกแล้ว และ log มีสองแถว
   * ที่ออกจาก ISSUED ขัดกันเอง) ส่วนฟอร์มที่ส่งซ้ำ ใบที่สองรอ lock ของแถวบัญชีแล้วผ่านทุกขั้น
   * ได้ `USER_ACCOUNT_ACTIVATED` กับ `ACTIVATION_KEY_USED` สองชุด ตอนนี้คนที่มาทีหลังได้ 0 แถวแล้วหยุด
   * ก่อนแตะบัญชีหรือ role ลำดับภายใน transaction เดียวไม่เปลี่ยนผลของการ commit
   */
  const claimed = await db.activationKey.updateMany({
    where: { id: params.activationKeyId, status: ActivationKeyStatus.ISSUED },
    data: {
      status: ActivationKeyStatus.USED,
      usedAt: new Date(),
      updatedBy: params.userAccountId,
    },
  });
  if (claimed.count === 0) {
    const current = await db.activationKey.findUnique({
      where: { id: params.activationKeyId },
      select: { status: true },
    });
    throw new ActivationKeyUnusableError(
      current?.status === ActivationKeyStatus.USED
        ? "used"
        : current?.status === ActivationKeyStatus.REVOKED
          ? "revoked"
          : current?.status === ActivationKeyStatus.EXPIRED
            ? "expired"
            : "not_found",
    );
  }

  /**
   * ล้างร่องรอยการยุติและการระงับด้วย — บัญชีที่ยุติแล้วกลับมาทางนี้ได้เมื่อถูกเชิญกลับ
   * (`POST /api/admin/users/:id/reinvite`) ถ้าไม่ล้าง หน้าบัญชีจะขึ้น "ยุติการใช้งานเมื่อ…" บนบัญชีที่ใช้งานอยู่
   * `activatedAt` เป็นวันที่เปิดใช้ครั้งล่าสุด ครั้งแรกยังอยู่ใน `USER_ACCOUNT_ACTIVATED` แถวเดิม
   */
  await db.userAccount.update({
    where: { id: params.userAccountId },
    data: {
      status: UserAccountStatus.ACTIVE,
      activatedAt: new Date(),
      lastLoginAt: new Date(),
      deactivatedAt: null,
      suspendedAt: null,
      suspendedBy: null,
      suspensionReason: null,
      updatedBy: params.userAccountId,
    },
  });

  const assignment = await assignRole(db, {
    userAccountId: params.userAccountId,
    roleCode: params.roleCode,
    organizationId: params.organizationId,
    actorId: params.userAccountId,
    skipSeatCheck: params.skipSeatCheck,
  });

  // assignment คือ subject ของ `ROLE_ASSIGNED` (ถ้า `assignRole()` มอบให้จริง)
  return {
    roleAssignmentId: assignment.id,
    roleAssignmentCreated: assignment.created,
  };
}

/**
 * ผู้มีอำนาจอนุมัติของหน่วยงานที่**เปิดใช้งานบัญชีแล้ว**และนั่งที่นั่งของหน่วยงานนี้อยู่ —
 * `null` ถ้าคำขอยังไม่เดินไปถึงขั้นนั้น
 *
 * เมื่อเขาเปิดใช้งานบัญชีแล้ว อีเมลนั้นรับลิงก์ได้จริงและ ThaID ยืนยันเลขบัตรไปแล้ว
 * สองช่องนี้จึงเป็นข้อเท็จจริงของบัญชี ไม่ใช่ของฟอร์มอีกต่อไป — เหตุผลเดียวกับที่
 * `recallRefusal()` ปฏิเสธการยกเลิกผลตรวจสอบหลังจากนั้น และเป็นคู่ของ `contactFromAccount()`
 * สำหรับส่วนที่ 2: ค่าจากบัญชีมาก่อน snapshot และฟอร์มแก้ไม่ได้ (การ์ด "BUG ส่งชื่อ approver
 * ไม่ได้": "ถ้า org approver activate แล้ว ให้ disable email และ cid ไม่ให้แก้ไข")
 *
 * ต้องถือ role ของ**หน่วยงานนี้**ด้วย ไม่ใช่แค่บัญชี ACTIVE — ร่างที่กรอกอีเมลของผู้มีอำนาจฯ
 * หน่วยงานอื่นเข้ามาต้องยังแก้ช่องนั้นได้ ไม่งั้นคนกรอกติดอยู่กับค่าที่ `approverConflict()`
 * จะปฏิเสธและแก้ไม่ได้
 *
 * ค้นแบบไม่สนตัวพิมพ์ เพราะร่างที่บันทึกก่อน 2026-09-18 เก็บอีเมลตามที่พิมพ์มา
 *
 * ย้ายมาจาก `routes/organizations.ts` ตอนเพิ่ม `/api/admin/registrations` — คำถาม
 * "ที่นั่งผู้มีอำนาจฯ ของหน่วยงานนี้มีคนจริงนั่งอยู่ไหม" เป็นคำถามของ iam ไม่ใช่ของฟอร์ม
 * และเส้นทางของผู้ดูแลระบบตัดสินจากคำตอบเดียวกันนี้ (ต่างกันแค่ทำอะไรต่อ)
 */
export async function activatedApprover(
  db: Db,
  request: { approverEmail: string | null; organizationId: string },
) {
  if (!request.approverEmail) return null;
  const roleId = await roleIdByCode(db, ROLE_CODES.ORGANIZATION_APPROVER);
  return db.userAccount.findFirst({
    where: {
      email: { equals: request.approverEmail, mode: "insensitive" },
      status: UserAccountStatus.ACTIVE,
      roleAssignments: {
        some: { roleId, organizationId: request.organizationId, ...activeAssignmentWhere() },
      },
    },
    select: { id: true, email: true, cid: true },
  });
}
