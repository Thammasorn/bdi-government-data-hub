/**
 * จัดการบัญชีที่เปิดใช้งานแล้ว — `/api/admin/users` (ไม่มี UI ยิง API ด้วย `x-admin-token`)
 *
 * คู่กับ `admin.ts` ที่ดูแล "คำเชิญ" คือบัญชีที่ยัง `PENDING` ยังไม่เคยเข้าระบบ เส้นแบ่ง
 * ระหว่างสองไฟล์คือสถานะบัญชี ไม่ใช่ชนิดของงาน:
 *
 *   PENDING  → `DELETE /admin/invitations/:id` ลบแถวจริง คืนทั้งอีเมลและเลขบัตร
 *   ACTIVE ↑ → ที่นี่ ไม่มีการลบจริงเลย มีแต่ `DEACTIVATED`
 *
 * **ลบบัญชีที่เปิดใช้งานแล้วไม่ได้ และเปิดให้ทำก็ไม่ได้** ฐานข้อมูลกันไว้เองด้วย FK สามใบ:
 * `legal.legal_acceptance` · `signature.signature_confirmation` ·
 * `review.review_task.assigned_user_id` ทั้งหมดเป็น `ON DELETE RESTRICT` คนที่เคยยอมรับ
 * เอกสาร เคยลงนาม หรือเคยถูกมอบหมายงานในสายอนุมัติ ลบด้วย SQL ตรง ๆ ยังไม่ผ่าน
 *
 * ### เลขบัตรกับอีเมลเป็นตัวระบุคนละชนิด
 *
 * `cid` คือ **คน** — ถาวร ไม่ซ้ำทั้งประเทศ เป็นของคนอื่นไม่ได้ จึงไม่มีคำสั่งไหนปล่อยคืน
 * `email` คือ **กล่องจดหมาย** — เปลี่ยนมือได้จริง (อีเมลกลางของฝ่ายถูกส่งต่อให้เจ้าหน้าที่
 * คนใหม่) จึงปล่อยคืนได้ แต่ต้องเป็นคำสั่งที่ตั้งใจเรียก ไม่ใช่ผลข้างเคียงของการปิดบัญชี
 *
 * ผลคือ "สร้างบัญชีใหม่ด้วยเลขบัตรเดิม" ไม่มีอยู่ในระบบ — คนเดิมที่กลับเข้ามาใช้
 * `reactivate` แถวเดิม เพราะ `legal_acceptance` กับ `signature` ชี้มาที่บัญชี ถ้าแตกคนคนเดียว
 * เป็นสองแถว ระบบจะตอบไม่ได้ว่าใครลงนามเอกสาร A0–A3 ฉบับนั้น
 *
 * ### ไม่ mask ข้อมูล
 *
 * ทุก endpoint ในไฟล์นี้ตอบข้อมูลจริงโดยไม่ปิดบัง ต่างจากฝั่งฟอร์มจดทะเบียนที่ปิด
 * เพราะที่นั่นคนกรอกเป็นใครก็ได้ ส่วน `x-admin-token` อยู่ใน `.env` เจ้าหน้าที่ BDI
 * เท่านั้นที่เรียกได้ และเขาต้องรู้ว่าต้องไปแก้ที่บัญชีใบไหน
 */
import { Router } from "../lib/async-route.js";
import { z } from "zod";
import {
  ActivationKeyStatus,
  Prisma,
  RequestStatus,
  RoleAssignmentStatus,
  SessionRevokeReason,
  SubjectType,
  UserAccountStatus,
} from "@prisma/client";

import { prisma } from "../db.js";
import { AuditAction, AuditSubject, diffFields, logAudit } from "../lib/audit.js";
import {
  activeAssignmentWhere,
  assignRole,
  derivedAssignmentStatus,
  revokeRoleAssignments,
  roleIdByCode,
  type Db,
} from "../lib/iam.js";
import { NotificationType, notifyUsers } from "../lib/notify.js";
import { ROLE_LABELS } from "../lib/roles.js";
import { activeSessionsFor, revokeSessionsFor } from "../lib/session.js";
import { ACTIVE_STATUSES, cancelActiveTask } from "../lib/workflow.js";
import {
  BDI_ORGANIZATION_ID,
  ORGANIZATION_SCOPED_ROLES,
  ROLE_CODES,
  SYSTEM_USER_ID,
  type RoleCode,
} from "../lib/system.js";
import { emailSchema, formatZodError, nationalIdSchema, uuidSchema } from "../lib/validation.js";
import { requireAdminToken } from "../middleware/auth.js";

export const adminUserRouter = Router();
adminUserRouter.use(requireAdminToken);

/**
 * เหตุผลบังคับทุกคำสั่งที่ตัดสิทธิ์คน
 *
 * ไม่ใช่พิธีกรรม — `revocation_reason` กับ `suspension_reason` เป็นสิ่งเดียวที่คนถูก
 * กระทำได้เห็น (`removedFromOrganization()` อ่านมันกลับไปอธิบายให้เขาฟัง) และเป็น
 * สิ่งเดียวที่ตอบได้ว่าทำไม เมื่อมีคนมาถามย้อนหลังหลายเดือน
 */
const reasonSchema = z
  .string({ error: "ต้องระบุ reason — เหตุผลนี้ถูกบันทึกลง audit และแจ้งให้เจ้าตัวทราบ" })
  .trim()
  .min(10, "กรุณาระบุเหตุผลอย่างน้อย 10 ตัวอักษร — เหตุผลนี้ถูกบันทึกและแจ้งให้เจ้าตัวทราบ")
  .max(500);

const roleEnum = z.enum(Object.values(ROLE_CODES) as [RoleCode, ...RoleCode[]], {
  error: "role ไม่ถูกต้อง",
});

// ---------------------------------------------------------------- ตัวช่วยร่วม

/** รูปแบบเดียวที่ทุก endpoint ในไฟล์นี้คืนบัญชีกลับไป */
const accountSelect = {
  id: true,
  email: true,
  cid: true,
  prefixTh: true,
  firstnameTh: true,
  lastnameTh: true,
  displayName: true,
  phoneNumber: true,
  positionTh: true,
  departmentTh: true,
  accountType: true,
  status: true,
  lastLoginAt: true,
  activatedAt: true,
  suspendedAt: true,
  suspendedBy: true,
  suspensionReason: true,
  deactivatedAt: true,
  createdAt: true,
} satisfies Prisma.UserAccountSelect;

async function findAccount(id: string) {
  if (!z.string().uuid().safeParse(id).success) return null;
  return prisma.userAccount.findUnique({ where: { id }, select: accountSelect });
}

function notFound(res: import("express").Response) {
  res.status(404).json({ error: "not_found", message: "ไม่พบบัญชีที่ระบุ" });
}

/** role ระดับหน่วยงานที่ยังใช้งานได้ของบัญชีนี้ พร้อมชื่อหน่วยงาน */
async function activeOrgAssignments(db: Db, userAccountId: string) {
  return db.userRoleAssignment.findMany({
    where: {
      userAccountId,
      role: { code: { in: [...ORGANIZATION_SCOPED_ROLES] } },
      ...activeAssignmentWhere(),
    },
    select: {
      id: true,
      organizationId: true,
      role: { select: { code: true } },
      organization: { select: { id: true, nameTh: true } },
    },
  });
}

/**
 * กฎ *หนึ่งบัญชี = หนึ่งหน่วยงาน* — ครอบทั้งสอง role ระดับหน่วยงานและข้ามบทบาท
 *
 * `assignRole()` บังคับแค่ทางเดียวคือ "หนึ่งหน่วยงานมีคนเดียวต่อ role" ส่วนทางกลับ
 * ไม่เคยมีอะไรกันไว้ ตรวจตรงนี้ก่อนมอบ role หรือ reactivate เสมอ และต้องตรวจ
 * **ณ ตอนที่ทำ** ไม่ใช่เชื่อสิ่งที่จริงตอนเขาจากไป
 */
async function organizationClash(db: Db, userAccountId: string, organizationId: string) {
  if (organizationId === BDI_ORGANIZATION_ID) return null;
  const held = await activeOrgAssignments(db, userAccountId);
  return held.find((a) => a.organizationId !== organizationId) ?? null;
}

/**
 * กันไม่ให้ระงับ/ปิดเจ้าหน้าที่ BDI คนสุดท้ายของ role นั้น
 *
 * ถ้าไม่เหลือ `BDI_FINAL_APPROVER` เลยสักคน คำขอทุกใบที่เดินมาถึงด่านสุดท้ายจะค้าง
 * โดยไม่มีใครปลดได้ และคนที่ปลดได้ก็คือคนที่เพิ่งถูกปิดไป — กู้คืนได้ทางเดียวคือแก้
 * ฐานข้อมูลด้วยมือ ซึ่ง `docs/08-database-access.md` ห้ามไว้
 */
async function lastBdiHolder(db: Db, userAccountId: string) {
  const held = await db.userRoleAssignment.findMany({
    where: { userAccountId, organizationId: BDI_ORGANIZATION_ID, ...activeAssignmentWhere() },
    select: { roleId: true, role: { select: { code: true } } },
  });

  for (const assignment of held) {
    const others = await db.userRoleAssignment.count({
      where: {
        roleId: assignment.roleId,
        organizationId: BDI_ORGANIZATION_ID,
        userAccountId: { not: userAccountId },
        userAccount: { status: UserAccountStatus.ACTIVE },
        ...activeAssignmentWhere(),
      },
    });
    if (others === 0) return assignment.role.code;
  }
  return null;
}

// ---------------------------------------------------------------- ค้นหาและดู

const listQuerySchema = z.object({
  /** ค้นบางส่วนของอีเมลหรือชื่อที่แสดง */
  q: z.string().trim().min(1).optional(),
  /**
   * เลขบัตรค้นแบบตรงตัวเต็มเท่านั้น
   *
   * ค้นบางส่วนได้เท่ากับเปิดให้ไล่เดาเลขบัตรทีละหลักผ่าน endpoint นี้ ซึ่งเจ้าหน้าที่
   * ไม่ต้องการอยู่แล้ว เขาถือเลขเต็มจากเอกสารที่หน่วยงานส่งมา
   */
  cid: nationalIdSchema.optional(),
  status: z.enum(Object.values(UserAccountStatus) as [string, ...string[]]).optional(),
  role: roleEnum.optional(),
  organizationId: uuidSchema("organizationId ต้องเป็น UUID").optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

adminUserRouter.get("/", async (req, res) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "validation", fields: formatZodError(parsed.error) });
    return;
  }
  const { q, cid, status, role, organizationId, page, pageSize } = parsed.data;

  const assignmentFilter =
    role || organizationId
      ? {
          roleAssignments: {
            some: {
              ...(role ? { role: { code: role } } : {}),
              ...(organizationId ? { organizationId } : {}),
              ...activeAssignmentWhere(),
            },
          },
        }
      : {};

  const where: Prisma.UserAccountWhereInput = {
    ...(cid ? { cid } : {}),
    ...(status ? { status: status as UserAccountStatus } : {}),
    ...assignmentFilter,
    ...(q
      ? {
          OR: [
            { email: { contains: q, mode: "insensitive" as const } },
            { displayName: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [total, users] = await prisma.$transaction([
    prisma.userAccount.count({ where }),
    prisma.userAccount.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        ...accountSelect,
        roleAssignments: {
          where: activeAssignmentWhere(),
          select: {
            id: true,
            role: { select: { code: true } },
            organization: { select: { id: true, nameTh: true } },
          },
        },
      },
    }),
  ]);

  res.json({ users, total, page, pageSize });
});

adminUserRouter.get("/:id", async (req, res) => {
  const account = await findAccount(req.params.id);
  if (!account) {
    notFound(res);
    return;
  }

  const [assignments, keys, sessions, audit] = await Promise.all([
    // ทั้งที่ใช้งานได้และที่ถูกถอนไปแล้ว — ประวัติคือเหตุผลหลักที่เปิดหน้านี้
    prisma.userRoleAssignment.findMany({
      where: { userAccountId: account.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        status: true,
        effectiveFrom: true,
        effectiveUntil: true,
        revokedAt: true,
        revocationReason: true,
        role: { select: { code: true, nameTh: true } },
        organization: { select: { id: true, nameTh: true } },
      },
    }),
    prisma.activationKey.findMany({
      where: { userAccountId: account.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true, issuedAt: true, expiresAt: true, usedAt: true },
    }),
    activeSessionsFor(account.id),
    prisma.auditEvent.findMany({
      where: { subjectType: AuditSubject.USER_ACCOUNT, subjectId: account.id },
      orderBy: { occurredAt: "desc" },
      take: 20,
      select: {
        id: true,
        action: true,
        occurredAt: true,
        actorId: true,
        beforeSummaryJson: true,
        afterSummaryJson: true,
        metadataJson: true,
      },
    }),
  ]);

  res.json({
    user: account,
    roleAssignments: assignments.map((a) => ({ ...a, derivedStatus: derivedAssignmentStatus(a) })),
    activationKeys: keys,
    sessions: sessions.map((s) => ({
      id: s.id,
      createdAt: s.createdAt,
      lastSeenAt: s.lastSeenAt,
      expiresAt: s.expiresAt,
      ipAddress: s.ipAddress,
      userAgent: s.userAgent,
    })),
    recentAudit: audit,
  });
});

// ---------------------------------------------------------------- แก้ข้อมูล

const profileSchema = z
  .object({
    prefixTh: z.string().trim().max(64).nullable().optional(),
    firstnameTh: z.string().trim().max(255).nullable().optional(),
    lastnameTh: z.string().trim().max(255).nullable().optional(),
    displayName: z.string().trim().min(1).max(255).optional(),
    phoneNumber: z.string().trim().max(32).nullable().optional(),
    positionTh: z.string().trim().max(255).nullable().optional(),
    departmentTh: z.string().trim().max(255).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { error: "ไม่มีฟิลด์ให้แก้" });

/**
 * แก้ได้เฉพาะโปรไฟล์ — `email` กับ `cid` ไม่อยู่ในนี้โดยตั้งใจ
 *
 * สองค่านั้นเป็น identity anchor: อีเมลคือตัวล็อกอิน เลขบัตรคือค่าที่ ThaiD §2.4
 * เอาไปเทียบตอนเปิดใช้งาน การแก้จึงต้องผ่าน `POST /:id/identity` ซึ่งบังคับเหตุผล
 * ปิด session ทิ้ง และเขียน audit before/after
 */
adminUserRouter.patch("/:id", async (req, res) => {
  const account = await findAccount(req.params.id);
  if (!account) {
    notFound(res);
    return;
  }
  const parsed = profileSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "validation", fields: formatZodError(parsed.error) });
    return;
  }

  const changed = diffFields(account as Record<string, unknown>, parsed.data);
  if (!changed) {
    res.json({ user: account, changed: false });
    return;
  }

  const updated = await prisma.userAccount.update({
    where: { id: account.id },
    data: { ...parsed.data, updatedBy: SYSTEM_USER_ID },
    select: accountSelect,
  });

  await logAudit({
    action: AuditAction.USER_ACCOUNT_UPDATED,
    subjectType: AuditSubject.USER_ACCOUNT,
    subjectId: account.id,
    before: changed.before,
    after: changed.after,
    metadata: { updated_via: "ADMIN_API" },
  });

  res.json({ user: updated, changed: true });
});

const identitySchema = z
  .object({
    email: emailSchema.optional(),
    cid: nationalIdSchema.optional(),
    reason: reasonSchema,
  })
  .refine((v) => v.email !== undefined || v.cid !== undefined, {
    error: "ต้องระบุ email หรือ cid อย่างน้อยหนึ่งอย่าง",
  });

/**
 * แก้อีเมล / เลขบัตรของบัญชีที่เปิดใช้งานแล้ว
 *
 * การ์ดคำเชิญตัดสินว่า "กรอกผิด = ลบแล้วเชิญใหม่" ซึ่งใช้ได้กับบัญชี `PENDING` เท่านั้น
 * บัญชีที่เปิดใช้งานแล้วลบไม่ได้ (FK สามใบเป็น RESTRICT) ถ้าไม่มีทางแก้ตรงนี้ การกรอก
 * อีเมลผิดตั้งแต่แรกจะกลายเป็นทางตันถาวร
 *
 * ปิด session ทุกใบหลังแก้ เพราะอีเมลคือตัวล็อกอิน — ใบที่ค้างอยู่ผูกกับตัวตนเดิม
 */
adminUserRouter.post("/:id/identity", async (req, res) => {
  const account = await findAccount(req.params.id);
  if (!account) {
    notFound(res);
    return;
  }
  const parsed = identitySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "validation", fields: formatZodError(parsed.error) });
    return;
  }
  const { email, cid, reason } = parsed.data;

  if (email && email !== account.email) {
    const taken = await prisma.userAccount.findUnique({
      where: { email },
      select: { id: true, email: true },
    });
    if (taken) {
      res.status(409).json({
        error: "email_exists",
        message: `อีเมล ${email} เป็นของบัญชีอื่นอยู่แล้ว`,
        userAccountId: taken.id,
      });
      return;
    }
  }
  if (cid && cid !== account.cid) {
    const taken = await prisma.userAccount.findUnique({
      where: { cid },
      select: { id: true, email: true },
    });
    if (taken) {
      res.status(409).json({
        error: "cid_exists",
        message: `เลขบัตรประชาชนนี้เป็นของบัญชี ${taken.email} อยู่แล้ว — หนึ่งเลขบัตรมีได้หนึ่งบัญชี`,
        userAccountId: taken.id,
      });
      return;
    }
  }

  const changed = diffFields(account as Record<string, unknown>, { email, cid });
  if (!changed) {
    res.json({ user: account, changed: false });
    return;
  }

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.userAccount.update({
      where: { id: account.id },
      data: {
        ...(email !== undefined ? { email } : {}),
        ...(cid !== undefined ? { cid } : {}),
        updatedBy: SYSTEM_USER_ID,
      },
      select: accountSelect,
    });
    await revokeSessionsFor(tx, {
      userAccountId: account.id,
      reason: SessionRevokeReason.ROTATED,
    });
    return row;
  });

  await logAudit({
    action: AuditAction.USER_ACCOUNT_UPDATED,
    subjectType: AuditSubject.USER_ACCOUNT,
    subjectId: account.id,
    before: changed.before,
    after: changed.after,
    metadata: { updated_via: "ADMIN_API", identity_change: true, reason },
  });

  res.json({ user: updated, changed: true, sessionsRevoked: true });
});

/**
 * ปล่อยอีเมลให้กลับไปใช้ใหม่ได้ — ใช้กับกล่องจดหมายที่เปลี่ยนมือจริง ๆ
 *
 * **ไม่มีตัวเลือกปล่อยเลขบัตร** เลขบัตรคือคน ไม่ใช่ตำแหน่ง — เป็นของคนอื่นไม่ได้เลย
 * ส่วนอีเมลกลางของฝ่าย (`it@agency.go.th`) ถูกส่งต่อให้เจ้าหน้าที่คนใหม่ได้จริง
 *
 * อีเมลเดิมถูกแทนที่ด้วยค่าที่ล็อกอินไม่ได้และไม่มีทางชนกับใคร แล้วเก็บของเดิมไว้ใน
 * `before` ของ audit ซึ่งหลังจากนี้เป็นหลักฐานเดียวที่เหลือว่าแถวนี้เคยเป็นอีเมลใด
 */
adminUserRouter.post("/:id/release-identity", async (req, res) => {
  const account = await findAccount(req.params.id);
  if (!account) {
    notFound(res);
    return;
  }
  const parsed = z
    .object({ releaseEmail: z.literal(true), reason: reasonSchema })
    .safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "validation",
      fields: formatZodError(parsed.error),
      message: "ปล่อยได้เฉพาะอีเมล (releaseEmail: true) — เลขบัตรประชาชนปล่อยคืนไม่ได้",
    });
    return;
  }

  if (account.status !== UserAccountStatus.DEACTIVATED) {
    res.status(409).json({
      error: "not_deactivated",
      message:
        `ปล่อยอีเมลได้เฉพาะบัญชีที่ยุติการใช้งานแล้ว — บัญชีนี้อยู่สถานะ ${account.status} ` +
        `ถ้าตั้งใจจะเปลี่ยนอีเมลของบัญชีที่ยังใช้งานอยู่ ให้ใช้ POST /api/admin/users/:id/identity แทน`,
    });
    return;
  }

  const released = `released+${account.id}@invalid.local`;
  const updated = await prisma.userAccount.update({
    where: { id: account.id },
    data: { email: released, updatedBy: SYSTEM_USER_ID },
    select: accountSelect,
  });

  await logAudit({
    action: AuditAction.USER_IDENTITY_RELEASED,
    subjectType: AuditSubject.USER_ACCOUNT,
    subjectId: account.id,
    before: { email: account.email },
    after: { email: released },
    metadata: { released_via: "ADMIN_API", reason: parsed.data.reason, cid_retained: true },
  });

  res.json({
    user: updated,
    releasedEmail: account.email,
    message: `อีเมล ${account.email} ใช้เชิญใหม่ได้แล้ว — เลขบัตรประชาชนยังผูกกับบัญชีนี้ตามเดิม`,
  });
});

// ---------------------------------------------------------------- สถานะบัญชี

/** ระงับชั่วคราว — role ยังอยู่ครบ เพราะตั้งใจให้กลับมาใช้ได้ */
adminUserRouter.post("/:id/suspend", async (req, res) => {
  const account = await findAccount(req.params.id);
  if (!account) {
    notFound(res);
    return;
  }
  const parsed = z.object({ reason: reasonSchema }).safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "validation", fields: formatZodError(parsed.error) });
    return;
  }
  if (account.status !== UserAccountStatus.ACTIVE) {
    res.status(409).json({
      error: "invalid_state",
      message: `ระงับได้เฉพาะบัญชีที่ใช้งานอยู่ — บัญชีนี้อยู่สถานะ ${account.status}`,
    });
    return;
  }

  const stranded = await lastBdiHolder(prisma, account.id);
  if (stranded) {
    res.status(409).json({
      error: "last_holder",
      message:
        `บัญชีนี้เป็นเจ้าหน้าที่ ${ROLE_LABELS[stranded as RoleCode] ?? stranded} คนสุดท้ายที่ใช้งานอยู่ — ` +
        `ระงับแล้วจะไม่มีใครปิดงานในด่านนั้นได้เลย กรุณาเปิดใช้งานบัญชีอื่นในบทบาทนี้ก่อน`,
      roleCode: stranded,
    });
    return;
  }

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.userAccount.update({
      where: { id: account.id },
      data: {
        status: UserAccountStatus.SUSPENDED,
        suspendedAt: new Date(),
        suspendedBy: SYSTEM_USER_ID,
        suspensionReason: parsed.data.reason,
        updatedBy: SYSTEM_USER_ID,
      },
      select: accountSelect,
    });
    await revokeSessionsFor(tx, {
      userAccountId: account.id,
      reason: SessionRevokeReason.ACCOUNT_SUSPENDED,
    });
    return row;
  });

  await logAudit({
    action: AuditAction.USER_ACCOUNT_SUSPENDED,
    subjectType: AuditSubject.USER_ACCOUNT,
    subjectId: account.id,
    before: { status: account.status },
    after: { status: UserAccountStatus.SUSPENDED },
    metadata: { reason: parsed.data.reason, suspended_via: "ADMIN_API" },
  });

  res.json({ user: updated, message: "ระงับบัญชีแล้ว สิทธิ์ (role) ยังอยู่ครบ" });
});

/** คืนสถานะให้บัญชีที่ถูกระงับ — ใช้กับ DEACTIVATED ไม่ได้ นั่นคือ reactivate */
adminUserRouter.post("/:id/reinstate", async (req, res) => {
  const account = await findAccount(req.params.id);
  if (!account) {
    notFound(res);
    return;
  }
  if (account.status !== UserAccountStatus.SUSPENDED) {
    res.status(409).json({
      error: "invalid_state",
      message:
        account.status === UserAccountStatus.DEACTIVATED
          ? "บัญชีนี้ยุติการใช้งานไปแล้ว ไม่ใช่ถูกระงับ — ใช้ POST /api/admin/users/:id/reactivate แทน"
          : `คืนสถานะได้เฉพาะบัญชีที่ถูกระงับ — บัญชีนี้อยู่สถานะ ${account.status}`,
    });
    return;
  }

  const updated = await prisma.userAccount.update({
    where: { id: account.id },
    data: {
      status: UserAccountStatus.ACTIVE,
      suspendedAt: null,
      suspendedBy: null,
      suspensionReason: null,
      updatedBy: SYSTEM_USER_ID,
    },
    select: accountSelect,
  });

  await logAudit({
    action: AuditAction.USER_ACCOUNT_REINSTATED,
    subjectType: AuditSubject.USER_ACCOUNT,
    subjectId: account.id,
    before: { status: account.status, suspensionReason: account.suspensionReason },
    after: { status: UserAccountStatus.ACTIVE },
    metadata: { reinstated_via: "ADMIN_API" },
  });

  res.json({ user: updated, message: "คืนสถานะบัญชีแล้ว" });
});

/**
 * ยุติการใช้งานบัญชี — นี่คือ "ลบ" ของระบบนี้
 *
 * ถอน role ทุกใบ ปิด session ทุกใบ และยกเลิกคำเชิญที่ยังใช้ได้ แต่ **แถวยังอยู่**
 * พร้อมอีเมลและเลขบัตรเดิม เพราะ `legal_acceptance` `signature_confirmation`
 * และ `review_task` ชี้มาที่บัญชีนี้ ประวัติจึงต้องอ่านกลับได้ตลอดไป
 */
adminUserRouter.post("/:id/deactivate", async (req, res) => {
  const account = await findAccount(req.params.id);
  if (!account) {
    notFound(res);
    return;
  }
  const parsed = z.object({ reason: reasonSchema }).safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "validation", fields: formatZodError(parsed.error) });
    return;
  }
  if (account.status === UserAccountStatus.DEACTIVATED) {
    res.status(409).json({ error: "invalid_state", message: "บัญชีนี้ยุติการใช้งานไปแล้ว" });
    return;
  }

  const stranded = await lastBdiHolder(prisma, account.id);
  if (stranded) {
    res.status(409).json({
      error: "last_holder",
      message:
        `บัญชีนี้เป็นเจ้าหน้าที่ ${ROLE_LABELS[stranded as RoleCode] ?? stranded} คนสุดท้ายที่ใช้งานอยู่ — ` +
        `ปิดแล้วจะไม่มีใครปิดงานในด่านนั้นได้เลย กรุณาเปิดใช้งานบัญชีอื่นในบทบาทนี้ก่อน`,
      roleCode: stranded,
    });
    return;
  }

  const result = await prisma.$transaction(async (tx) => {
    const revoked = await revokeRoleAssignments(tx, {
      userAccountId: account.id,
      actorId: SYSTEM_USER_ID,
      reason: parsed.data.reason,
    });
    await tx.activationKey.updateMany({
      where: { userAccountId: account.id, status: ActivationKeyStatus.ISSUED },
      data: {
        status: ActivationKeyStatus.REVOKED,
        revokedAt: new Date(),
        revokedBy: SYSTEM_USER_ID,
        revokedReason: "บัญชียุติการใช้งาน",
        updatedBy: SYSTEM_USER_ID,
      },
    });
    await revokeSessionsFor(tx, {
      userAccountId: account.id,
      reason: SessionRevokeReason.ACCOUNT_SUSPENDED,
    });
    const row = await tx.userAccount.update({
      where: { id: account.id },
      data: {
        status: UserAccountStatus.DEACTIVATED,
        deactivatedAt: new Date(),
        updatedBy: SYSTEM_USER_ID,
      },
      select: accountSelect,
    });
    return { row, revoked };
  });

  await logAudit({
    action: AuditAction.USER_ACCOUNT_DEACTIVATED,
    subjectType: AuditSubject.USER_ACCOUNT,
    subjectId: account.id,
    before: { status: account.status, email: account.email, cid: account.cid },
    after: { status: UserAccountStatus.DEACTIVATED },
    metadata: {
      reason: parsed.data.reason,
      deactivated_via: "ADMIN_API",
      roles_revoked: result.revoked.length,
    },
  });

  res.json({
    user: result.row,
    rolesRevoked: result.revoked.length,
    message:
      "ยุติการใช้งานบัญชีแล้ว — อีเมลและเลขบัตรประชาชนยังผูกกับบัญชีนี้ไว้เพื่อให้ประวัติอ่านกลับได้ " +
      "ถ้าคนเดิมกลับเข้ามาใหม่ ให้ใช้ reactivate ไม่ใช่สร้างบัญชีใหม่",
  });
});

/**
 * เปิดใช้งานบัญชีที่ยุติไปแล้วกลับมา — สำหรับคนเดิมที่กลับเข้ามา
 *
 * **ไม่คืน role ให้เอง** ต้องมอบใหม่ผ่าน `POST /:id/roles` เพราะเขาอาจกลับมาที่หน่วยงาน
 * อื่นหรือบทบาทอื่น และเพราะ role ที่ถูกถอนตอนปิดบัญชีนั้นถูกถอนด้วยเหตุผลของมันเอง
 */
adminUserRouter.post("/:id/reactivate", async (req, res) => {
  const account = await findAccount(req.params.id);
  if (!account) {
    notFound(res);
    return;
  }
  const parsed = z.object({ reason: reasonSchema }).safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "validation", fields: formatZodError(parsed.error) });
    return;
  }
  if (account.status !== UserAccountStatus.DEACTIVATED) {
    res.status(409).json({
      error: "invalid_state",
      message: `เปิดใช้งานใหม่ได้เฉพาะบัญชีที่ยุติการใช้งานแล้ว — บัญชีนี้อยู่สถานะ ${account.status}`,
    });
    return;
  }
  if (account.email.endsWith("@invalid.local")) {
    res.status(409).json({
      error: "identity_released",
      message:
        "อีเมลของบัญชีนี้ถูกปล่อยคืนไปแล้ว จึงเปิดใช้งานกลับมาไม่ได้จนกว่าจะตั้งอีเมลใหม่ — " +
        "ใช้ POST /api/admin/users/:id/identity ตั้งอีเมลก่อน",
    });
    return;
  }

  const updated = await prisma.userAccount.update({
    where: { id: account.id },
    data: {
      status: UserAccountStatus.ACTIVE,
      deactivatedAt: null,
      updatedBy: SYSTEM_USER_ID,
    },
    select: accountSelect,
  });

  await logAudit({
    action: AuditAction.USER_ACCOUNT_REACTIVATED,
    subjectType: AuditSubject.USER_ACCOUNT,
    subjectId: account.id,
    before: { status: account.status },
    after: { status: UserAccountStatus.ACTIVE },
    metadata: { reason: parsed.data.reason, reactivated_via: "ADMIN_API" },
  });

  res.json({
    user: updated,
    message:
      "เปิดใช้งานบัญชีกลับมาแล้ว — ยังไม่มีสิทธิ์ใด ๆ ต้องมอบ role ด้วย POST /api/admin/users/:id/roles",
  });
});

// ---------------------------------------------------------------- session

adminUserRouter.get("/:id/sessions", async (req, res) => {
  const account = await findAccount(req.params.id);
  if (!account) {
    notFound(res);
    return;
  }
  const sessions = await activeSessionsFor(account.id);
  res.json({
    sessions: sessions.map((s) => ({
      id: s.id,
      createdAt: s.createdAt,
      lastSeenAt: s.lastSeenAt,
      expiresAt: s.expiresAt,
      ipAddress: s.ipAddress,
      userAgent: s.userAgent,
    })),
  });
});

/** บังคับออกจากระบบทุกเครื่องโดยไม่ต้องระงับบัญชี — ใช้ตอนสงสัยว่า session ถูกขโมย */
adminUserRouter.delete("/:id/sessions", async (req, res) => {
  const account = await findAccount(req.params.id);
  if (!account) {
    notFound(res);
    return;
  }
  const parsed = z.object({ reason: reasonSchema }).safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "validation", fields: formatZodError(parsed.error) });
    return;
  }

  const revoked = await revokeSessionsFor(prisma, {
    userAccountId: account.id,
    reason: SessionRevokeReason.LOGOUT_ALL,
  });

  await logAudit({
    action: AuditAction.SESSION_REVOKED,
    subjectType: AuditSubject.USER_ACCOUNT,
    subjectId: account.id,
    metadata: {
      reason: SessionRevokeReason.LOGOUT_ALL,
      admin_reason: parsed.data.reason,
      revoked_via: "ADMIN_API",
    },
  });

  res.json({ revoked, message: `ปิด session แล้ว ${revoked} ใบ` });
});

// ---------------------------------------------------------------- สิทธิ์และหน่วยงาน

/**
 * งานของหน่วยงานเดิมที่ค้างอยู่กับคนที่กำลังจะย้าย — ดันกลับเป็นร่าง
 *
 * เจ้าของงานสั่งไว้ว่า "ย้ายหน่วยงานแล้ว ห้ามเอางานหน่วยงานเก่าไปด้วย" ทั้งกรณีที่เขา
 * เป็นผู้ดำเนินการและกรณีที่เป็นผู้มีอำนาจ — คำขอที่ค้างอยู่กับเขาจึงถูกดันกลับเป็น `DRAFT`
 * ให้หน่วยงานเดิมรับช่วงต่อ ไม่ใช่ค้างรอคนที่ไม่อยู่แล้ว
 *
 * สามอย่างที่ต้องทำพร้อมกัน ไม่งั้นคำขอจะค้างในสภาพครึ่ง ๆ กลาง ๆ:
 *   1. ปิด task ที่ยัง active เป็น `CANCELLED` (ยกเลิกโดยไม่เกิดผล)
 *   2. ล้าง `submittedAt` — `deriveRequestStatus()` อ่านค่านี้เป็น `hasSubmitted`
 *      ถ้าไม่ล้าง สถานะจะคำนวณออกมาเป็น SUBMITTED ทั้งที่ไม่มี task ไหนเปิดอยู่
 *   3. ถ้าเขาคือผู้มีอำนาจของใบนั้น ล้าง `approverEmail` ทิ้ง — คำขอกลับเป็นร่างก็เพราะ
 *      ผู้มีอำนาจของมันหายไป หน่วยงานเดิมต้องกรอกคนใหม่ และการล้างยังตัดสิทธิ์
 *      การมองเห็นของคนที่ย้ายไปแล้วด้วย (`canView()` ยอมให้ผ่านถ้าอีเมลตรงกับช่องนี้)
 *      ชื่อกับนามสกุลเก็บไว้ เพื่อให้คนกรอกเห็นว่าเดิมเป็นใคร
 */
async function revertStrandedWork(
  tx: Prisma.TransactionClient,
  params: { userAccountId: string; email: string; organizationIds: string[]; reason: string },
) {
  if (params.organizationIds.length === 0) return [];

  /**
   * `review_task` เป็น polymorphic — `subject_id` ไม่ใช่ FK จริง (คอมเมนต์ในสคีมาบอกไว้)
   * จึงหาจาก task ก่อนแล้วค่อยดึงคำขอตาม id ที่ได้ ไม่มี relation ให้ join ตรง ๆ
   */
  const openTasks = await tx.reviewTask.findMany({
    where: {
      assignedUserId: params.userAccountId,
      subjectType: SubjectType.ORGANIZATION_REGISTRATION_REQUEST,
      status: { in: ACTIVE_STATUSES },
    },
    select: { subjectId: true },
  });
  if (openTasks.length === 0) return [];

  const stranded = await tx.organizationRegistrationRequest.findMany({
    where: {
      id: { in: [...new Set(openTasks.map((t) => t.subjectId))] },
      organizationId: { in: params.organizationIds },
      submittedAt: { not: null },
    },
    select: { id: true, requestNumber: true, organizationId: true, approverEmail: true },
  });

  const reverted: Array<{ id: string; requestNumber: string; approverCleared: boolean }> = [];
  for (const request of stranded) {
    await cancelActiveTask(tx, {
      subjectType: SubjectType.ORGANIZATION_REGISTRATION_REQUEST,
      subjectId: request.id,
      actorId: SYSTEM_USER_ID,
      reason: params.reason,
    });
    const approverCleared =
      request.approverEmail?.toLowerCase() === params.email.toLowerCase();
    await tx.organizationRegistrationRequest.update({
      where: { id: request.id },
      data: {
        submittedAt: null,
        status: RequestStatus.DRAFT,
        ...(approverCleared ? { approverEmail: null } : {}),
        updatedBy: SYSTEM_USER_ID,
      },
    });
    reverted.push({
      id: request.id,
      requestNumber: request.requestNumber,
      approverCleared,
    });
  }
  return reverted;
}

/** คนที่ยังอยู่กับหน่วยงานนั้นและควรรู้ว่ามีคนย้ายออก */
async function remainingStaff(db: Db, organizationId: string, exceptUserAccountId: string) {
  const rows = await db.userRoleAssignment.findMany({
    where: {
      organizationId,
      userAccountId: { not: exceptUserAccountId },
      role: { code: { in: [...ORGANIZATION_SCOPED_ROLES] } },
      userAccount: { status: UserAccountStatus.ACTIVE },
      ...activeAssignmentWhere(),
    },
    select: { userAccountId: true },
  });
  return [...new Set(rows.map((r) => r.userAccountId))];
}

const roleGrantSchema = z.object({
  role: roleEnum,
  organizationId: uuidSchema("organizationId ต้องเป็น UUID ของหน่วยงานที่มีอยู่แล้ว").optional(),
  reason: reasonSchema,
});

adminUserRouter.post("/:id/roles", async (req, res) => {
  const account = await findAccount(req.params.id);
  if (!account) {
    notFound(res);
    return;
  }
  const parsed = roleGrantSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "validation", fields: formatZodError(parsed.error) });
    return;
  }
  const { role, reason } = parsed.data;

  if (account.status !== UserAccountStatus.ACTIVE) {
    res.status(409).json({
      error: "invalid_state",
      message: `มอบสิทธิ์ได้เฉพาะบัญชีที่ใช้งานอยู่ — บัญชีนี้อยู่สถานะ ${account.status}`,
    });
    return;
  }

  const isOrgScoped = ORGANIZATION_SCOPED_ROLES.includes(role);
  const organizationId = isOrgScoped ? parsed.data.organizationId : BDI_ORGANIZATION_ID;
  if (isOrgScoped && !organizationId) {
    res.status(400).json({
      error: "validation",
      fields: { organizationId: `role "${role}" เป็น role ระดับหน่วยงาน จึงต้องระบุ organizationId` },
    });
    return;
  }

  const organization = await prisma.organization.findUnique({
    where: { id: organizationId! },
    select: { id: true, nameTh: true },
  });
  if (!organization) {
    res.status(404).json({ error: "not_found", message: "ไม่พบหน่วยงานที่ระบุ" });
    return;
  }

  const clash = await organizationClash(prisma, account.id, organization.id);
  if (clash) {
    res.status(409).json({
      error: "organization_clash",
      message:
        `บัญชีนี้ถือสิทธิ์ระดับหน่วยงานของ "${clash.organization?.nameTh}" อยู่แล้ว — ` +
        `หนึ่งบัญชีอยู่ได้หน่วยงานเดียว ถ้าต้องการย้ายให้ใช้ POST /api/admin/users/:id/transfer ` +
        `ซึ่งถอนของเดิมและมอบของใหม่ในคำสั่งเดียว`,
      currentOrganizationId: clash.organizationId,
    });
    return;
  }

  const { replaced } = await prisma.$transaction((tx) =>
    assignRole(tx, {
      userAccountId: account.id,
      roleCode: role,
      organizationId: organization.id,
      actorId: SYSTEM_USER_ID,
    }),
  );

  await logAudit({
    action: AuditAction.ROLE_ASSIGNED,
    subjectType: AuditSubject.USER_ACCOUNT,
    subjectId: account.id,
    organizationId: organization.id,
    after: { role, organizationId: organization.id },
    metadata: { reason, assigned_via: "ADMIN_API", replaced: replaced.length },
  });

  await notifyUsers([account.id], {
    type: NotificationType.ROLE_ASSIGNMENT_CHANGED,
    title: "คุณได้รับสิทธิ์ใหม่ในระบบ",
    message: `คุณได้รับบทบาท "${ROLE_LABELS[role]}" ของหน่วยงาน ${organization.nameTh}`,
    organizationId: organization.id,
  });

  res.status(201).json({
    role,
    roleLabel: ROLE_LABELS[role],
    organization,
    replacedUserAccountIds: replaced.map((r) => r.userAccountId),
  });
});

adminUserRouter.delete("/:id/roles/:assignmentId", async (req, res) => {
  const account = await findAccount(req.params.id);
  if (!account) {
    notFound(res);
    return;
  }
  const parsed = z.object({ reason: reasonSchema }).safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "validation", fields: formatZodError(parsed.error) });
    return;
  }

  const assignment = await prisma.userRoleAssignment.findFirst({
    where: { id: req.params.assignmentId, userAccountId: account.id, ...activeAssignmentWhere() },
    select: { id: true, organizationId: true, role: { select: { code: true } } },
  });
  if (!assignment) {
    res.status(404).json({ error: "not_found", message: "ไม่พบสิทธิ์ที่ใช้งานอยู่ตามที่ระบุ" });
    return;
  }

  await prisma.userRoleAssignment.update({
    where: { id: assignment.id },
    data: {
      status: RoleAssignmentStatus.REVOKED,
      revokedAt: new Date(),
      revokedBy: SYSTEM_USER_ID,
      revocationReason: parsed.data.reason,
      updatedBy: SYSTEM_USER_ID,
    },
  });

  await logAudit({
    action: AuditAction.ROLE_REVOKED,
    subjectType: AuditSubject.USER_ROLE_ASSIGNMENT,
    subjectId: assignment.id,
    organizationId: assignment.organizationId,
    before: { userAccountId: account.id, role: assignment.role.code, status: "ACTIVE" },
    after: { status: RoleAssignmentStatus.REVOKED },
    metadata: { reason: parsed.data.reason, revoked_via: "ADMIN_API" },
  });

  await notifyUsers([account.id], {
    type: NotificationType.ROLE_ASSIGNMENT_CHANGED,
    title: "สิทธิ์ของคุณถูกเปลี่ยนแปลง",
    message: `บทบาท "${ROLE_LABELS[assignment.role.code as RoleCode]}" ของคุณถูกถอน — ${parsed.data.reason}`,
    organizationId: assignment.organizationId,
  });

  res.json({ ok: true });
});

const transferSchema = z.object({
  organizationId: uuidSchema("organizationId ต้องเป็น UUID ของหน่วยงานปลายทาง"),
  role: roleEnum,
  reason: reasonSchema,
});

/**
 * ย้ายหน่วยงาน — ถอนของเดิมและมอบของใหม่ในคำสั่งเดียว
 *
 * ต้องเป็นคำสั่งเดียว ไม่ใช่ให้แอดมินเรียก DELETE แล้ว POST เอง เพราะกฎ
 * *หนึ่งบัญชี = หนึ่งหน่วยงาน* จะปฏิเสธถ้ามอบก่อนถอน และถ้าแยกสองคำสั่งแล้วคำสั่ง
 * ที่สองล้ม เขาจะค้างอยู่แบบไม่สังกัดหน่วยงานไหนเลย
 *
 * ย้ายได้เสมอ ไม่บล็อกแม้มีงานค้างหรือแม้หน่วยงานเดิมจะไม่เหลือใคร — แต่ตอบกลับมา
 * ให้ครบว่าเกิดอะไรขึ้นบ้าง เพราะแอดมินต้องรู้ว่าต้องไปเชิญคนใหม่ให้หน่วยงานเดิม
 */
adminUserRouter.post("/:id/transfer", async (req, res) => {
  const account = await findAccount(req.params.id);
  if (!account) {
    notFound(res);
    return;
  }
  const parsed = transferSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "validation", fields: formatZodError(parsed.error) });
    return;
  }
  const { organizationId, role, reason } = parsed.data;

  if (account.status !== UserAccountStatus.ACTIVE) {
    res.status(409).json({
      error: "invalid_state",
      message: `ย้ายได้เฉพาะบัญชีที่ใช้งานอยู่ — บัญชีนี้อยู่สถานะ ${account.status}`,
    });
    return;
  }
  if (!ORGANIZATION_SCOPED_ROLES.includes(role)) {
    res.status(400).json({
      error: "validation",
      fields: {
        role: `role "${role}" ไม่ใช่ role ระดับหน่วยงาน จึงไม่มีหน่วยงานให้ย้าย — ใช้ POST /roles แทน`,
      },
    });
    return;
  }

  const target = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { id: true, nameTh: true },
  });
  if (!target) {
    res.status(404).json({ error: "not_found", message: "ไม่พบหน่วยงานปลายทางที่ระบุ" });
    return;
  }

  const current = await activeOrgAssignments(prisma, account.id);
  const sourceIds = [...new Set(current.map((a) => a.organizationId))].filter(
    (id): id is string => Boolean(id) && id !== target.id,
  );
  if (sourceIds.length === 0 && current.some((a) => a.organizationId === target.id)) {
    res.status(409).json({
      error: "already_there",
      message: `บัญชีนี้อยู่กับหน่วยงาน ${target.nameTh} อยู่แล้ว`,
    });
    return;
  }

  // ต้องอ่านไว้ก่อนย้าย — หลังถอนสิทธิ์แล้วจะหาคนที่ "ยังอยู่" ของหน่วยงานเดิมไม่เจอ
  const notifyPerSource = new Map<string, string[]>();
  for (const sourceId of sourceIds) {
    notifyPerSource.set(sourceId, await remainingStaff(prisma, sourceId, account.id));
  }

  const outcome = await prisma.$transaction(async (tx) => {
    const reverted = await revertStrandedWork(tx, {
      userAccountId: account.id,
      email: account.email,
      organizationIds: sourceIds,
      reason: `ผู้รับผิดชอบย้ายไปหน่วยงานอื่น — ${reason}`,
    });

    for (const sourceId of sourceIds) {
      await revokeRoleAssignments(tx, {
        userAccountId: account.id,
        organizationId: sourceId,
        actorId: SYSTEM_USER_ID,
        reason,
      });
    }

    const { replaced } = await assignRole(tx, {
      userAccountId: account.id,
      roleCode: role,
      organizationId: target.id,
      actorId: SYSTEM_USER_ID,
    });

    // สิทธิ์เปลี่ยนระดับ — ออกใบใหม่ตามธรรมเนียมของ SessionRevokeReason.ROTATED
    await revokeSessionsFor(tx, {
      userAccountId: account.id,
      reason: SessionRevokeReason.ROTATED,
    });

    return { reverted, replaced };
  });

  await logAudit({
    action: AuditAction.ROLE_ASSIGNED,
    subjectType: AuditSubject.USER_ACCOUNT,
    subjectId: account.id,
    organizationId: target.id,
    before: { organizationIds: sourceIds },
    after: { organizationId: target.id, role },
    metadata: {
      reason,
      transferred_via: "ADMIN_API",
      requests_reverted_to_draft: outcome.reverted.map((r) => r.requestNumber),
      replaced: outcome.replaced.length,
    },
  });

  await notifyUsers([account.id], {
    type: NotificationType.ROLE_ASSIGNMENT_CHANGED,
    title: "คุณถูกย้ายหน่วยงาน",
    message:
      `คุณถูกย้ายมาอยู่หน่วยงาน ${target.nameTh} ในบทบาท "${ROLE_LABELS[role]}" — ${reason} ` +
      `งานที่ค้างอยู่กับหน่วยงานเดิมไม่ได้ย้ายตามมาด้วย`,
    organizationId: target.id,
  });

  /**
   * คนที่ยังอยู่กับหน่วยงานเดิมต้องรู้ทั้งสองเรื่องในข้อความเดียว: มีคนย้ายออก และ
   * คำขอที่เคยนำส่งไปแล้วกลับมาเป็นร่างให้แก้ต่อ ไม่งั้นเขาจะเห็นคำขอเปลี่ยนสถานะเอง
   * โดยไม่มีใครบอกว่าทำไม
   */
  for (const [sourceId, recipients] of notifyPerSource) {
    const back = outcome.reverted.filter(() => true).map((r) => r.requestNumber);
    await notifyUsers(recipients, {
      type: NotificationType.ROLE_ASSIGNMENT_CHANGED,
      title: "ผู้รับผิดชอบของหน่วยงานย้ายออก",
      message:
        `${account.displayName || account.email} ย้ายไปหน่วยงานอื่นแล้ว` +
        (back.length > 0
          ? ` และคำขอ ${back.join(" ")} ถูกปรับกลับเป็นฉบับร่างให้หน่วยงานดำเนินการต่อ` +
            ` กรุณาตรวจสอบข้อมูลผู้มีอำนาจกระทำการแทนแล้วนำส่งใหม่`
          : ""),
      organizationId: sourceId,
    });
  }

  const vacancies = [];
  for (const sourceId of sourceIds) {
    const left = await remainingStaff(prisma, sourceId, account.id);
    if (left.length === 0) vacancies.push(sourceId);
  }

  res.json({
    ok: true,
    from: sourceIds,
    to: target,
    role,
    roleLabel: ROLE_LABELS[role],
    requestsRevertedToDraft: outcome.reverted,
    replacedUserAccountIds: outcome.replaced.map((r) => r.userAccountId),
    organizationsLeftWithoutStaff: vacancies,
    message:
      `ย้ายไปหน่วยงาน ${target.nameTh} แล้ว` +
      (outcome.reverted.length > 0
        ? ` · คำขอ ${outcome.reverted.length} ใบถูกปรับกลับเป็นฉบับร่างและแจ้งหน่วยงานเดิมแล้ว`
        : "") +
      (vacancies.length > 0
        ? ` · หน่วยงานเดิมไม่เหลือผู้รับผิดชอบแล้ว กรุณาเชิญคนใหม่`
        : ""),
  });
});

export { adminUserRouter as default };
