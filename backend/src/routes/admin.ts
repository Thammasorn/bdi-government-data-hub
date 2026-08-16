import { Router } from "../lib/async-route.js";
import { z } from "zod";
import {
  ActivationKeyStatus,
  AccountType,
  OrganizationStatus,
  RequestStatus,
  UserAccountStatus,
} from "@prisma/client";

import { prisma } from "../db.js";
import { lookupZipcode, resolveAddressCodes, resolveAddressNames } from "../lib/address.js";
import { AuditAction, AuditSubject, logAudit } from "../lib/audit.js";
import { issueActivationKey } from "../lib/iam.js";
import {
  nextOrganizationCode,
  nextOrganizationRequestNumber,
} from "../lib/request-number.js";
import { sendInvitationEmail } from "../lib/mail.js";
import { ROLE_LABELS } from "../lib/roles.js";
import {
  BDI_ORGANIZATION_ID,
  ORGANIZATION_SCOPED_ROLES,
  PLACEHOLDER_ORGANIZATION_NAME,
  ROLE_CODES,
  SYSTEM_USER_ID,
  type RoleCode,
} from "../lib/system.js";
import { emailSchema, formatZodError, nationalIdSchema } from "../lib/validation.js";
import { requireAdminToken } from "../middleware/auth.js";

export const adminRouter = Router();

adminRouter.use(requireAdminToken);

// ---------------------------------------------------------------- หน่วยงานที่ admin สร้างล่วงหน้า

/**
 * การ์ด "Admin Prefill Organization Form" ข้อ 1
 *
 * บังคับเฉพาะคอลัมน์ที่ฐานข้อมูลบังคับจริง — `organization_code` กับ `name_th` เป็น NOT NULL
 * ที่เหลือ nullable ทั้งหมด จึงปล่อยให้ว่างได้ ตามที่ตัดสินไว้ 2026-08-16
 * (ให้ admin สร้างหน่วยงานได้แม้รู้แค่ชื่อกับรหัส แล้วผู้ใช้มากรอกส่วนที่เหลือตอนลงทะเบียน)
 *
 * `organization_code` รับจาก admin ไม่ใช่ generate เอง — `request-number.ts` เขียนคำถามนี้ไว้
 * ตั้งแต่ตอนย้ายสคีมาแล้วว่า "ถ้าได้รหัสราชการจริงมาแล้ว ให้รับค่าจากผู้ใช้แทนการ generate"
 */
const adminOrganizationSchema = z.object({
  organizationCode: z
    .string()
    .trim()
    .min(1, "กรุณากรอกรหัสหน่วยงาน")
    .max(64, "รหัสหน่วยงานยาวเกิน 64 ตัวอักษร"),
  nameTh: z.string().trim().min(1, "กรุณากรอกชื่อหน่วยงาน (ภาษาไทย)").max(255),
  nameEn: z.string().trim().max(255).optional(),
  organizationType: z.string().trim().max(64).optional(),
  /** ที่อยู่รับเป็น "ชื่อ" จังหวัด/อำเภอ/ตำบล เหมือนฟอร์มลงทะเบียน แล้วแปลงเป็นรหัสให้ */
  addressLine: z.string().trim().max(500).optional(),
  province: z.string().trim().optional(),
  district: z.string().trim().optional(),
  subdistrict: z.string().trim().optional(),
  postalCode: z.string().trim().regex(/^\d{5}$/, "รหัสไปรษณีย์ต้องเป็นตัวเลข 5 หลัก").optional(),
  phone: z.string().trim().max(32).optional(),
  email: emailSchema.optional(),
  websiteUrl: z.string().trim().max(500).optional(),
  parentOrganizationId: z.string().uuid().optional(),
});

/** รูปแบบที่ทุก endpoint ของหมวดนี้ตอบกลับ — ที่อยู่คืนเป็นชื่อ ไม่ใช่รหัส */
async function toAdminOrganizationShape(org: {
  id: string;
  organizationCode: string;
  organizationType: string | null;
  nameTh: string;
  nameEn: string | null;
  status: OrganizationStatus;
  addressLine: string | null;
  provinceCode: string | null;
  districtCode: string | null;
  subDistrictCode: string | null;
  postalCode: string | null;
  phone: string | null;
  email: string | null;
  websiteUrl: string | null;
  parentOrganizationId: string | null;
  activatedAt: Date | null;
  createdAt: Date;
}) {
  const names = await resolveAddressNames(prisma, {
    provinceCode: org.provinceCode,
    districtCode: org.districtCode,
    subDistrictCode: org.subDistrictCode,
  });
  return {
    id: org.id,
    organizationCode: org.organizationCode,
    organizationType: org.organizationType,
    nameTh: org.nameTh,
    nameEn: org.nameEn,
    status: org.status,
    addressLine: org.addressLine,
    province: names.province,
    district: names.district,
    subdistrict: names.subdistrict,
    postalCode: org.postalCode,
    phone: org.phone,
    email: org.email,
    websiteUrl: org.websiteUrl,
    parentOrganizationId: org.parentOrganizationId,
    activatedAt: org.activatedAt,
    createdAt: org.createdAt,
  };
}

/**
 * สร้างหน่วยงานล่วงหน้า — สถานะ `PENDING_REGISTRATION` จนกว่าคำขอจดทะเบียนจะผ่าน
 * `BDI_FINAL_APPROVAL` (การ์ดข้อ 5 · ตรงกับ Journey B ที่ทำไว้แล้ว)
 *
 * จงใจ **ไม่** สร้างคำขอจดทะเบียนที่นี่ — คำขอเกิดตอนผู้ใช้เริ่มลงทะเบียนจริง
 * แล้วคัดลอกข้อมูลจากแถวนี้ไปเป็นค่าตั้งต้น (ดู `POST /api/organizations`)
 * ถ้าสร้างไว้ตั้งแต่ตอนนี้ การที่ admin แก้ข้อมูลหน่วยงานทีหลังจะไม่ไปถึงฟอร์มของผู้ใช้
 */
adminRouter.post("/organizations", async (req, res) => {
  const parsed = adminOrganizationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "validation", fields: formatZodError(parsed.error) });
    return;
  }
  const input = parsed.data;

  const duplicate = await prisma.organization.findUnique({
    where: { organizationCode: input.organizationCode },
    select: { id: true },
  });
  if (duplicate) {
    res.status(409).json({
      error: "code_exists",
      message: "รหัสหน่วยงานนี้ถูกใช้ไปแล้ว",
      organizationId: duplicate.id,
    });
    return;
  }

  if (input.parentOrganizationId) {
    const parent = await prisma.organization.findUnique({
      where: { id: input.parentOrganizationId },
      select: { id: true },
    });
    if (!parent) {
      res.status(404).json({ error: "not_found", message: "ไม่พบหน่วยงานต้นสังกัดที่ระบุ" });
      return;
    }
  }

  /**
   * ที่อยู่ไม่บังคับ แต่ถ้ากรอกมาแล้วเทียบกับ master ไม่ได้ต้องบอก ไม่ใช่เก็บเป็น null เงียบ ๆ
   *
   * admin ยิง API เอาเองไม่มี dropdown ให้เลือกเหมือนฟอร์มลงทะเบียน โอกาสพิมพ์ชื่อไม่ตรง
   * จึงสูง — และชื่อใน master ไม่มีคำนำหน้า ("ดุสิต" ไม่ใช่ "เขตดุสิต") ถ้าปล่อยผ่าน
   * หน่วยงานจะถูกสร้างโดยไม่มีที่อยู่ทั้งที่คนสร้างเชื่อว่ากรอกไปแล้ว
   */
  const codes = await resolveAddressCodes(prisma, input);
  const addressFields: Record<string, string> = {};
  if (input.province && !codes.provinceCode) {
    addressFields.province = "ไม่พบจังหวัดนี้ ใช้ชื่อตามข้อมูลกลาง เช่น \"กรุงเทพมหานคร\"";
  }
  if (input.district && !codes.districtCode) {
    addressFields.district = "ไม่พบอำเภอ/เขตนี้ในจังหวัดที่เลือก ชื่อในระบบไม่มีคำนำหน้า เช่น \"ดุสิต\"";
  }
  if (input.subdistrict && !codes.subDistrictCode) {
    addressFields.subdistrict = "ไม่พบตำบล/แขวงนี้ในอำเภอที่เลือก ชื่อในระบบไม่มีคำนำหน้า เช่น \"ดุสิต\"";
  }
  if (Object.keys(addressFields).length > 0) {
    res.status(400).json({ error: "validation", fields: addressFields });
    return;
  }

  /** เติมรหัสไปรษณีย์ให้เองเมื่อระบุที่อยู่ครบ เหมือนที่ฟอร์มลงทะเบียนทำ */
  const postalCode =
    input.postalCode ||
    (input.province && input.district && input.subdistrict
      ? (lookupZipcode(input.province, input.district, input.subdistrict) ?? null)
      : null);

  const organization = await prisma.organization.create({
    data: {
      organizationCode: input.organizationCode,
      organizationType: input.organizationType ?? null,
      nameTh: input.nameTh,
      nameEn: input.nameEn ?? null,
      status: OrganizationStatus.PENDING_REGISTRATION,
      addressLine: input.addressLine ?? null,
      provinceCode: codes.provinceCode ?? null,
      districtCode: codes.districtCode ?? null,
      subDistrictCode: codes.subDistrictCode ?? null,
      postalCode,
      phone: input.phone ?? null,
      email: input.email ?? null,
      websiteUrl: input.websiteUrl ?? null,
      parentOrganizationId: input.parentOrganizationId ?? null,
      createdBy: SYSTEM_USER_ID,
      updatedBy: SYSTEM_USER_ID,
    },
  });

  await logAudit({
    action: AuditAction.ORGANIZATION_CREATED,
    subjectType: AuditSubject.ORGANIZATION,
    subjectId: organization.id,
    organizationId: organization.id,
    metadata: { organization_code: organization.organizationCode, created_via: "ADMIN_API" },
  });

  res.status(201).json({ organization: await toAdminOrganizationShape(organization) });
});

/**
 * รายการหน่วยงาน — การ์ดข้อ 2 ("ใช้อ้างอิงตอนส่งคำเชิญ")
 * `?status=` กรองตามสถานะ · `?q=` ค้นจากชื่อไทย/อังกฤษ/รหัส
 */
adminRouter.get("/organizations", async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  if (status && !Object.values(OrganizationStatus).includes(status as OrganizationStatus)) {
    res.status(400).json({
      error: "validation",
      fields: { status: `status ต้องเป็นค่าใดค่าหนึ่งใน ${Object.values(OrganizationStatus).join(", ")}` },
    });
    return;
  }
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";

  const organizations = await prisma.organization.findMany({
    where: {
      ...(status ? { status: status as OrganizationStatus } : {}),
      ...(q
        ? {
            OR: [
              { nameTh: { contains: q, mode: "insensitive" as const } },
              { nameEn: { contains: q, mode: "insensitive" as const } },
              { organizationCode: { contains: q, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  res.json({ organizations: await Promise.all(organizations.map(toAdminOrganizationShape)) });
});

/**
 * รายละเอียดหน่วยงานหนึ่งแห่ง พร้อมสิ่งที่ admin ต้องดูเพื่อรู้ว่าเรื่องไปถึงไหนแล้ว:
 * คำขอจดทะเบียนที่ยังเปิดอยู่ และคำเชิญที่ออกให้หน่วยงานนี้
 */
adminRouter.get("/organizations/:id", async (req, res) => {
  const parsedId = z.string().uuid().safeParse(req.params.id);
  if (!parsedId.success) {
    res.status(404).json({ error: "not_found", message: "ไม่พบหน่วยงานที่ระบุ" });
    return;
  }

  const organization = await prisma.organization.findUnique({ where: { id: parsedId.data } });
  if (!organization) {
    res.status(404).json({ error: "not_found", message: "ไม่พบหน่วยงานที่ระบุ" });
    return;
  }

  const requests = await prisma.organizationRegistrationRequest.findMany({
    where: { organizationId: organization.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, requestNumber: true, status: true, submittedAt: true, createdAt: true },
  });
  const invitations = await prisma.activationKey.findMany({
    where: { organizationId: organization.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      expiresAt: true,
      userAccount: { select: { email: true, status: true } },
      role: { select: { code: true } },
    },
  });

  res.json({
    organization: await toAdminOrganizationShape(organization),
    registrationRequests: requests,
    invitations,
  });
});

// ---------------------------------------------------------------- คำเชิญผู้ใช้

const inviteSchema = z.object({
  email: emailSchema,
  role: z.enum(Object.values(ROLE_CODES) as [RoleCode, ...RoleCode[]], { error: "role ไม่ถูกต้อง" }),
  organizationId: z.string().uuid().optional(),
  displayName: z.string().trim().min(1).optional(),
  /**
   * เลขประจำตัวประชาชนของคนที่ถูกเชิญ — บังคับทุก role
   *
   * §2.4 ของสเปก ThaiD ให้เทียบเลขบัตรที่ ThaiD ส่งกลับมากับ "CID ที่ถูกบันทึกไว้
   * ในระบบตอนสร้างบัญชี" ไม่ใช่เลขที่ผู้ใช้พิมพ์เองตอนลงทะเบียน — ถ้าให้ผู้ใช้กรอกเอง
   * การเทียบก็ไม่ได้พิสูจน์อะไร เพราะเขากรอกเลขของบัตรที่ถืออยู่ในมือได้เสมอ
   * เจ้าหน้าที่จึงต้องกรอกจากเอกสารที่หน่วยงานส่งมา ตั้งแต่ตอนสร้างบัญชี
   */
  cid: nationalIdSchema,
});

/**
 * Journey A ขั้นที่ 2 — "Admin ยิง api เพื่อส่งเมล์ invite ให้คนมาสมัคร (ไม่มี UI)"
 *
 *   POST /api/admin/invitations
 *   x-admin-token: <ADMIN_API_TOKEN>
 *   { "email": "...", "role": "ORGANIZATION_USER", "organizationId": "...", "cid": "1234567890121" }
 *
 * เปลี่ยน contract จากของเดิม: ตาม "Suggested lifecycle" ใน sheet `activation_key`
 * ขั้นที่ 1–3 คือ **สร้าง user_account (PENDING) ก่อน** แล้วค่อยออก activation key
 * ให้บัญชีนั้น ไม่ใช่ผูกคำเชิญไว้กับอีเมลลอย ๆ แบบเดิม
 */
adminRouter.post("/invitations", async (req, res) => {
  const parsed = inviteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "validation", fields: formatZodError(parsed.error) });
    return;
  }
  const { email, role, displayName, cid } = parsed.data;

  const isOrgScoped = ORGANIZATION_SCOPED_ROLES.includes(role);
  // activation_key.organization_id เป็น NOT NULL — เจ้าหน้าที่ BDI ผูกกับหน่วยงาน BDI เอง
  const requestedOrganizationId = isOrgScoped ? parsed.data.organizationId : BDI_ORGANIZATION_ID;

  if (requestedOrganizationId) {
    const organization = await prisma.organization.findUnique({
      where: { id: requestedOrganizationId },
      select: { id: true },
    });
    if (!organization) {
      res.status(404).json({ error: "not_found", message: "ไม่พบหน่วยงานที่ระบุ" });
      return;
    }
  }

  const existing = await prisma.userAccount.findUnique({ where: { email } });
  if (existing?.status === UserAccountStatus.ACTIVE) {
    res.status(409).json({ error: "exists", message: "อีเมลนี้มีบัญชีในระบบแล้ว" });
    return;
  }

  const result = await prisma.$transaction(async (tx) => {
    // เชิญซ้ำบัญชีที่ยัง PENDING ถือว่าเจ้าหน้าที่กำลังแก้ข้อมูลที่กรอกผิด — เขียนทับเลขบัตรเดิม
    const account = existing
      ? await tx.userAccount.update({
          where: { id: existing.id },
          data: { cid, updatedBy: SYSTEM_USER_ID },
        })
      : await tx.userAccount.create({
          data: {
            email,
            cid,
            displayName: displayName ?? email,
            accountType: isOrgScoped ? AccountType.ORGANIZATION : AccountType.BDI,
            status: UserAccountStatus.PENDING,
            createdBy: SYSTEM_USER_ID,
            updatedBy: SYSTEM_USER_ID,
          },
        });

    /**
     * เชิญคนที่จะมา "สร้างหน่วยงานของตัวเอง" (Journey B) โดยไม่ระบุหน่วยงาน
     *
     * activation_key.organization_id เป็น NOT NULL ตามดีไซน์ แต่ตอนเชิญยังไม่มีหน่วยงาน
     * ให้ผูก — ถ้าบังคับให้ระบุ เส้นทางนี้จะเข้าไม่ได้เลย เพราะหน่วยงานเกิดหลังจากที่
     * ผู้ใช้ล็อกอินเข้ามากรอกฟอร์ม
     *
     * จึงสร้างหน่วยงานเปล่าสถานะ PENDING_REGISTRATION พร้อมคำขอฉบับร่างไว้ล่วงหน้า
     * ให้เป็นของบัญชีนั้น ผู้ใช้กด "สร้างหน่วยงาน" แล้วจะเจอร่างใบนี้แทนที่จะได้ใบใหม่
     * (POST /api/organizations ตอบ 409 พร้อม id ของร่างเดิม แล้วหน้าเว็บพาไปแก้ต่อ)
     */
    let organizationId = requestedOrganizationId;
    if (!organizationId) {
      const placeholder = await tx.organization.create({
        data: {
          organizationCode: await nextOrganizationCode(tx),
          nameTh: PLACEHOLDER_ORGANIZATION_NAME,
          status: OrganizationStatus.PENDING_REGISTRATION,
          createdBy: SYSTEM_USER_ID,
          updatedBy: SYSTEM_USER_ID,
        },
      });
      await tx.organizationRegistrationRequest.create({
        data: {
          requestNumber: await nextOrganizationRequestNumber(tx),
          organizationId: placeholder.id,
          organizationCode: placeholder.organizationCode,
          status: RequestStatus.DRAFT,
          userEmail: email,
          createdBy: account.id,
          updatedBy: account.id,
        },
      });
      organizationId = placeholder.id;
    }

    const { key, record } = await issueActivationKey(tx, {
      userAccountId: account.id,
      organizationId,
      roleCode: role,
      actorId: SYSTEM_USER_ID,
    });

    return { account, key, record, organizationId };
  });

  await sendInvitationEmail(email, result.key, ROLE_LABELS[role]);

  res.status(201).json({
    activationKeyId: result.record.id,
    userAccountId: result.account.id,
    email,
    role,
    roleLabel: ROLE_LABELS[role],
    organizationId: result.organizationId,
    expiresAt: result.record.expiresAt,
  });
});

adminRouter.get("/invitations", async (_req, res) => {
  const keys = await prisma.activationKey.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      status: true,
      issuedAt: true,
      expiresAt: true,
      usedAt: true,
      revokedAt: true,
      createdAt: true,
      userAccount: { select: { id: true, email: true, status: true } },
      role: { select: { code: true, nameTh: true } },
      organization: { select: { id: true, nameTh: true } },
    },
  });
  res.json({ invitations: keys });
});

adminRouter.post("/invitations/:id/revoke", async (req, res) => {
  const key = await prisma.activationKey.findUnique({ where: { id: req.params.id } });
  if (!key || key.status !== ActivationKeyStatus.ISSUED) {
    res.status(404).json({ error: "not_found", message: "ไม่พบคำเชิญที่ยังใช้งานได้" });
    return;
  }
  await prisma.activationKey.update({
    where: { id: key.id },
    data: {
      status: ActivationKeyStatus.REVOKED,
      revokedAt: new Date(),
      revokedBy: SYSTEM_USER_ID,
      revokedReason: String(req.body?.reason ?? "ยกเลิกโดยผู้ดูแลระบบ"),
      updatedBy: SYSTEM_USER_ID,
    },
  });
  res.json({ ok: true });
});
