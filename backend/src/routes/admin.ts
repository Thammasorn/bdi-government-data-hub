import { Router } from "../lib/async-route.js";
import multer from "multer";
import { z } from "zod";
import {
  ActivationKeyStatus,
  AccountType,
  OrganizationStatus,
  Prisma,
  RequestStatus,
  UserAccountStatus,
} from "@prisma/client";

import { prisma } from "../db.js";
import { uploadedFile } from "../lib/attachment.js";
import { TEMPLATE_VARIABLES, VARIABLE_GROUPS } from "../lib/document-render.js";
import { publishVersion } from "../lib/legal.js";
import { lookupZipcode, resolveAddressCodes, resolveAddressNames } from "../lib/address.js";
import { AuditAction, AuditSubject, logAudit } from "../lib/audit.js";
import { issueActivationKey } from "../lib/iam.js";
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
import { emailSchema, formatZodError, nationalIdSchema, uuidSchema } from "../lib/validation.js";
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
  road: z.string().trim().max(255).optional(),
  province: z.string().trim().optional(),
  district: z.string().trim().optional(),
  subdistrict: z.string().trim().optional(),
  postalCode: z.string().trim().regex(/^\d{5}$/, "รหัสไปรษณีย์ต้องเป็นตัวเลข 5 หลัก").optional(),
  phone: z.string().trim().max(32).optional(),
  email: emailSchema.optional(),
  websiteUrl: z.string().trim().max(500).optional(),
  parentOrganizationId: uuidSchema(
    "parentOrganizationId ต้องเป็น UUID ของหน่วยงานแม่ — " +
      "ถ้าไม่มีหน่วยงานแม่ ให้ไม่ส่งฟิลด์นี้เลย (ส่งค่าว่างไม่นับว่าไม่ส่ง)",
  ).optional(),
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
  road: string | null;
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
    road: org.road,
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
      road: input.road ?? null,
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
 * แก้ข้อมูลหน่วยงานที่สร้างไว้ — ทุกช่องไม่บังคับ ส่งมาเฉพาะที่จะแก้
 *
 * `null` = ล้างค่าทิ้ง ต่างจากไม่ส่ง key มาเลยซึ่งแปลว่า "ไม่แตะ"
 * สองช่องที่ฐานข้อมูลบังคับ (`organizationCode` / `nameTh`) ล้างไม่ได้ จึงไม่รับ null
 */
const adminOrganizationPatchSchema = z.object({
  organizationCode: z.string().trim().min(1, "รหัสหน่วยงานว่างไม่ได้").max(64).optional(),
  nameTh: z.string().trim().min(1, "ชื่อหน่วยงานว่างไม่ได้").max(255).optional(),
  nameEn: z.string().trim().max(255).nullable().optional(),
  organizationType: z.string().trim().max(64).nullable().optional(),
  addressLine: z.string().trim().max(500).nullable().optional(),
  road: z.string().trim().max(255).nullable().optional(),
  province: z.string().trim().nullable().optional(),
  district: z.string().trim().nullable().optional(),
  subdistrict: z.string().trim().nullable().optional(),
  postalCode: z
    .string()
    .trim()
    .regex(/^\d{5}$/, "รหัสไปรษณีย์ต้องเป็นตัวเลข 5 หลัก")
    .nullable()
    .optional(),
  phone: z.string().trim().max(32).nullable().optional(),
  email: emailSchema.nullable().optional(),
  websiteUrl: z.string().trim().max(500).nullable().optional(),
  parentOrganizationId: uuidSchema(
    "parentOrganizationId ต้องเป็น UUID ของหน่วยงานแม่ — " +
      "ถ้าต้องการล้างหน่วยงานแม่ ให้ส่ง null (ส่งค่าว่างไม่นับว่าล้างค่า)",
  )
    .nullable()
    .optional(),
});

adminRouter.patch("/organizations/:id", async (req, res) => {
  const parsedId = z.string().uuid().safeParse(req.params.id);
  if (!parsedId.success) {
    res.status(404).json({ error: "not_found", message: "ไม่พบหน่วยงานที่ระบุ" });
    return;
  }
  const parsed = adminOrganizationPatchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "validation", fields: formatZodError(parsed.error) });
    return;
  }
  const input = parsed.data;

  const before = await prisma.organization.findUnique({ where: { id: parsedId.data } });
  if (!before) {
    res.status(404).json({ error: "not_found", message: "ไม่พบหน่วยงานที่ระบุ" });
    return;
  }

  if (input.organizationCode && input.organizationCode !== before.organizationCode) {
    const taken = await prisma.organization.findUnique({
      where: { organizationCode: input.organizationCode },
      select: { id: true },
    });
    if (taken) {
      res.status(409).json({
        error: "code_exists",
        message: "รหัสหน่วยงานนี้ถูกใช้ไปแล้ว",
        organizationId: taken.id,
      });
      return;
    }
  }

  if (input.parentOrganizationId) {
    if (input.parentOrganizationId === before.id) {
      res.status(400).json({
        error: "validation",
        fields: { parentOrganizationId: "หน่วยงานเป็นต้นสังกัดของตัวเองไม่ได้" },
      });
      return;
    }
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
   * ที่อยู่ต้องแปลงจาก "ที่อยู่หลังแก้ทั้งชุด" ไม่ใช่เฉพาะช่องที่ส่งมา — ส่งมาแค่ตำบล
   * ก็ต้องใช้จังหวัด/อำเภอเดิมประกอบ ไม่งั้นเทียบไม่เจอแล้วกลายเป็นล้างที่อยู่ทิ้งทั้งชุด
   */
  const touchesAddress =
    input.province !== undefined || input.district !== undefined || input.subdistrict !== undefined;
  const currentNames = await resolveAddressNames(prisma, {
    provinceCode: before.provinceCode,
    districtCode: before.districtCode,
    subDistrictCode: before.subDistrictCode,
  });
  const merged = {
    province: input.province !== undefined ? input.province : currentNames.province,
    district: input.district !== undefined ? input.district : currentNames.district,
    subdistrict: input.subdistrict !== undefined ? input.subdistrict : currentNames.subdistrict,
  };

  let codes = {
    provinceCode: before.provinceCode,
    districtCode: before.districtCode,
    subDistrictCode: before.subDistrictCode,
  };
  if (touchesAddress) {
    codes = await resolveAddressCodes(prisma, merged);
    const addressFields: Record<string, string> = {};
    if (merged.province && !codes.provinceCode) {
      addressFields.province = "ไม่พบจังหวัดนี้ ใช้ชื่อตามข้อมูลกลาง เช่น \"กรุงเทพมหานคร\"";
    }
    if (merged.district && !codes.districtCode) {
      addressFields.district = "ไม่พบอำเภอ/เขตนี้ในจังหวัดที่เลือก ชื่อในระบบไม่มีคำนำหน้า เช่น \"ดุสิต\"";
    }
    if (merged.subdistrict && !codes.subDistrictCode) {
      addressFields.subdistrict = "ไม่พบตำบล/แขวงนี้ในอำเภอที่เลือก ชื่อในระบบไม่มีคำนำหน้า เช่น \"ดุสิต\"";
    }
    if (Object.keys(addressFields).length > 0) {
      res.status(400).json({ error: "validation", fields: addressFields });
      return;
    }
  }

  /** ย้ายที่อยู่แล้วไม่ได้บอกรหัสไปรษณีย์มาด้วย = ให้ระบบหาให้ใหม่ ไม่ใช่ค้างของที่เดิม */
  const postalCode =
    input.postalCode !== undefined
      ? input.postalCode
      : touchesAddress && merged.province && merged.district && merged.subdistrict
        ? (lookupZipcode(merged.province, merged.district, merged.subdistrict) ?? before.postalCode)
        : before.postalCode;

  const organization = await prisma.organization.update({
    where: { id: before.id },
    data: {
      ...(input.organizationCode !== undefined ? { organizationCode: input.organizationCode } : {}),
      ...(input.nameTh !== undefined ? { nameTh: input.nameTh } : {}),
      ...(input.nameEn !== undefined ? { nameEn: input.nameEn } : {}),
      ...(input.organizationType !== undefined ? { organizationType: input.organizationType } : {}),
      ...(input.addressLine !== undefined ? { addressLine: input.addressLine } : {}),
      ...(input.road !== undefined ? { road: input.road } : {}),
      ...(touchesAddress
        ? {
            provinceCode: codes.provinceCode,
            districtCode: codes.districtCode,
            subDistrictCode: codes.subDistrictCode,
          }
        : {}),
      postalCode,
      ...(input.phone !== undefined ? { phone: input.phone } : {}),
      ...(input.email !== undefined ? { email: input.email } : {}),
      ...(input.websiteUrl !== undefined ? { websiteUrl: input.websiteUrl } : {}),
      ...(input.parentOrganizationId !== undefined
        ? { parentOrganizationId: input.parentOrganizationId }
        : {}),
      updatedBy: SYSTEM_USER_ID,
    },
  });

  await logAudit({
    action: AuditAction.ORGANIZATION_UPDATED,
    subjectType: AuditSubject.ORGANIZATION,
    subjectId: organization.id,
    organizationId: organization.id,
    before: { organizationCode: before.organizationCode, nameTh: before.nameTh },
    after: { organizationCode: organization.organizationCode, nameTh: organization.nameTh },
    metadata: { updated_via: "ADMIN_API", fields: Object.keys(input) },
  });

  /**
   * ฟอร์มของผู้ใช้คัดลอกข้อมูลไปตั้งแต่ตอนเปิดคำขอ การแก้ที่นี่จึงไปไม่ถึงคำขอที่เปิดแล้ว
   * บอกกลับไปตรง ๆ ดีกว่าให้ admin เข้าใจว่าแก้แล้วผู้ใช้จะเห็น
   */
  const openRequest = await prisma.organizationRegistrationRequest.findFirst({
    where: {
      organizationId: organization.id,
      status: { notIn: [RequestStatus.APPROVED, RequestStatus.REJECTED, RequestStatus.CANCELLED] },
    },
    select: { id: true, requestNumber: true, status: true },
  });

  res.json({
    organization: await toAdminOrganizationShape(organization),
    ...(openRequest
      ? {
          warning: {
            code: "registration_in_progress",
            message:
              "หน่วยงานนี้มีคำขอจดทะเบียนที่เปิดอยู่แล้ว การแก้ตรงนี้จะไม่ไปปรากฏในฟอร์มของผู้ใช้ " +
              "เพราะคำขอคัดลอกข้อมูลไปตั้งแต่ตอนเปิด ต้องให้ผู้ใช้แก้ในฟอร์มเอง",
            request: openRequest,
          },
        }
      : {}),
  });
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

const inviteSchema = z
  .object({
    email: emailSchema,
    role: z.enum(Object.values(ROLE_CODES) as [RoleCode, ...RoleCode[]], {
      error: "role ไม่ถูกต้อง",
    }),
    organizationId: uuidSchema(
      "organizationId ต้องเป็น UUID ของหน่วยงานที่มีอยู่แล้ว (ส่งค่าว่างไม่นับว่าไม่ส่ง)",
    ).optional(),
    /**
     * ชื่อจริงของผู้ถูกเชิญ — บังคับทุก role
     *
     * เดิมรับเป็น `displayName` ช่องเดียวและไม่บังคับ ซึ่งมีปัญหาสามชั้น: ค่าที่กรอกมา
     * ถูกทับทิ้งตอนเจ้าตัวเปิดใช้งาน (`auth.ts` เขียนทั้งสี่ช่องพร้อมกัน) · ข้อมูลที่หน่วยงาน
     * ส่งมาแล้วไม่ได้ถูกใช้เลย ผู้ถูกเชิญต้องพิมพ์ชื่อตัวเองซ้ำอีกรอบ · และเอกสาร A0–A3
     * เลือกชื่อจาก `firstnameTh`/`lastnameTh` ก่อน `displayName` เสมอ ถ้าสองช่องนั้นว่าง
     * ชื่อบนเอกสารจะตกมาที่ `displayName` ซึ่งอาจเป็นอีเมล
     *
     * บังคับทุก role รวมเจ้าหน้าที่ BDI เพราะทุกคนมีโอกาสไปปรากฏบนเอกสารที่ลงนาม
     */
    prefixTh: z.string().trim().min(1).max(64).optional(),
    firstnameTh: z
      .string({ error: "กรุณากรอกชื่อ (ภาษาไทย) — บังคับทุก role" })
      .trim()
      .min(1, "กรุณากรอกชื่อ (ภาษาไทย)")
      .max(255),
    lastnameTh: z
      .string({ error: "กรุณากรอกนามสกุล (ภาษาไทย) — บังคับทุก role" })
      .trim()
      .min(1, "กรุณากรอกนามสกุล (ภาษาไทย)")
      .max(255),
    /**
     * เลขประจำตัวประชาชนของคนที่ถูกเชิญ — บังคับทุก role
     *
     * §2.4 ของสเปก ThaiD ให้เทียบเลขบัตรที่ ThaiD ส่งกลับมากับ "CID ที่ถูกบันทึกไว้
     * ในระบบตอนสร้างบัญชี" ไม่ใช่เลขที่ผู้ใช้พิมพ์เองตอนลงทะเบียน — ถ้าให้ผู้ใช้กรอกเอง
     * การเทียบก็ไม่ได้พิสูจน์อะไร เพราะเขากรอกเลขของบัตรที่ถืออยู่ในมือได้เสมอ
     * เจ้าหน้าที่จึงต้องกรอกจากเอกสารที่หน่วยงานส่งมา ตั้งแต่ตอนสร้างบัญชี
     */
    cid: nationalIdSchema,
  })
  /**
   * role ระดับหน่วยงานต้องระบุหน่วยงานเสมอ (ตัดสินใจ 2026-08-30)
   *
   * ของเดิมยอมให้ไม่ส่งมา แล้วสร้าง "หน่วยงานใหม่" เปล่า ๆ พร้อมร่างคำขอให้เอง ซึ่งสร้าง
   * ใบใหม่ทุกครั้งที่เชิญ ไม่เคยใช้ใบเดิมซ้ำ — หน่วยงานเปล่าจึงค้างเพิ่มเรื่อย ๆ และเพราะ
   * คีย์ผูกกับหน่วยงานคนละใบ `issueActivationKey()` ก็ revoke ใบเก่าไม่เจอ เหลือลิงก์
   * เปิดใช้งานที่ใช้ได้พร้อมกันสองใบ
   *
   * ทางที่ถูกคือแอดมินสร้างหน่วยงานด้วย `POST /api/admin/organizations` ก่อน
   * (บังคับแค่ organizationCode กับ nameTh) แล้วค่อยเชิญด้วย id ที่ได้
   */
  .superRefine((value, ctx) => {
    if (ORGANIZATION_SCOPED_ROLES.includes(value.role) && !value.organizationId) {
      ctx.addIssue({
        code: "custom",
        path: ["organizationId"],
        message:
          `role "${value.role}" เป็น role ระดับหน่วยงาน จึงต้องระบุ organizationId เสมอ — ` +
          `ถ้ายังไม่มีหน่วยงานในระบบ ให้สร้างด้วย POST /api/admin/organizations ก่อน ` +
          `แล้วนำ id ที่ได้มาใส่ที่นี่`,
      });
    }
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
  const { email, role, prefixTh, firstnameTh, lastnameTh, cid } = parsed.data;

  const isOrgScoped = ORGANIZATION_SCOPED_ROLES.includes(role);
  // activation_key.organization_id เป็น NOT NULL — เจ้าหน้าที่ BDI ผูกกับหน่วยงาน BDI เอง
  // superRefine ข้างบนบังคับแล้วว่า role ระดับหน่วยงานต้องส่ง organizationId มา
  const organizationId = isOrgScoped ? parsed.data.organizationId! : BDI_ORGANIZATION_ID;

  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { id: true },
  });
  if (!organization) {
    res.status(404).json({ error: "not_found", message: "ไม่พบหน่วยงานที่ระบุ" });
    return;
  }

  /**
   * ไม่มีการ "เชิญซ้ำ" อีกแล้ว (ตัดสินใจ 2026-08-30)
   *
   * ของเดิมถือว่าการเชิญอีเมลเดิมที่ยัง PENDING คือเจ้าหน้าที่แก้ข้อมูลที่กรอกผิด แล้ว
   * **เขียนทับ `cid` ของบัญชีนั้นเงียบ ๆ** ทั้งที่ endpoint นี้ไม่เขียน audit เลย — `cid`
   * คือค่าที่ ThaiD §2.4 เอาไปเทียบตอนเปิดใช้งาน พิมพ์ผิดครั้งเดียวจึงเปลี่ยนตัวคนที่
   * เปิดบัญชีนั้นได้โดยไม่เหลือร่องรอย
   *
   * ตอนนี้อีเมลหรือเลขบัตรที่มีบัญชีอยู่แล้วตอบ 409 เสมอ ทางแก้ข้อมูลผิดคือ
   * `DELETE /api/admin/invitations/:id` ซึ่งเขียน `INVITATION_DELETED` เก็บอีเมล เลขบัตร
   * และ role ที่ลบไป แล้วค่อยเชิญใหม่ — ทางที่ปลอดภัยกว่าคือทางที่มีหลักฐาน
   *
   * ส่วน "ลิงก์หาย/หมดอายุ แต่ข้อมูลถูกหมดแล้ว" ใช้ `POST /invitations/:id/resend`
   * ซึ่งไม่รับ payload จึงไม่มีอะไรให้กรอกผิด
   */
  const existing = await prisma.userAccount.findUnique({
    where: { email },
    select: { id: true, status: true, activationKeys: { select: { id: true }, take: 1 } },
  });
  if (existing) {
    res.status(409).json({
      error: "exists",
      message:
        existing.status === UserAccountStatus.ACTIVE
          ? `อีเมลนี้มีบัญชีที่เปิดใช้งานแล้วในระบบ — เชิญซ้ำไม่ได้`
          : `อีเมลนี้มีคำเชิญค้างอยู่แล้ว — ระบบไม่มีการเชิญซ้ำ ` +
            `ถ้าต้องการส่งลิงก์ใหม่ให้คนเดิมโดยไม่แก้ข้อมูล ใช้ POST /api/admin/invitations/:id/resend ` +
            `ถ้าข้อมูลที่เชิญไว้ผิด ให้ลบด้วย DELETE /api/admin/invitations/:id แล้วเชิญใหม่ ` +
            `(ค้นหาใบเดิมได้ที่ GET /api/admin/invitations?email=...)`,
      userAccountId: existing.id,
      activationKeyId: existing.activationKeys[0]?.id ?? null,
    });
    return;
  }

  /**
   * หนึ่งเลขบัตรประชาชน = หนึ่งบัญชี (`user_account.cid` เป็น unique)
   *
   * ถ้าไม่ดักตรงนี้ Prisma จะโยน P2002 ขึ้นมากลางทรานแซกชันแล้วกลายเป็น 500 ทั้งที่
   * ความหมายจริงคือ "เลขบัตรนี้มีบัญชีอยู่แล้ว" — บอกไปด้วยว่าเป็นบัญชีอีเมลใด เพราะ
   * คนเรียก endpoint นี้คือเจ้าหน้าที่ที่ถือ admin token ไม่ใช่คนนอก จึงไม่ต้อง mask
   * (ตรงข้ามกับฝั่งฟอร์มจดทะเบียนที่ mask เพราะคนกรอกเป็นใครก็ได้)
   */
  const sameCid = await prisma.userAccount.findUnique({
    where: { cid },
    select: { id: true, email: true, activationKeys: { select: { id: true }, take: 1 } },
  });
  if (sameCid) {
    res.status(409).json({
      error: "cid_exists",
      message:
        `เลขบัตรประชาชนนี้เป็นของบัญชี ${sameCid.email} อยู่แล้ว — หนึ่งเลขบัตรมีได้หนึ่งบัญชี ` +
        `ถ้าเป็นคนเดียวกันและแค่อยากส่งลิงก์ใหม่ ใช้ POST /api/admin/invitations/:id/resend ` +
        `ถ้าเชิญผิด ให้ลบคำเชิญใบเดิมด้วย DELETE /api/admin/invitations/:id แล้วเชิญใหม่`,
      userAccountId: sameCid.id,
      activationKeyId: sameCid.activationKeys[0]?.id ?? null,
    });
    return;
  }

  const result = await prisma.$transaction(async (tx) => {
    const account = await tx.userAccount.create({
      data: {
        email,
        cid,
        prefixTh,
        firstnameTh,
        lastnameTh,
        /**
         * ประกอบจากสามช่องบน ไม่ได้รับมาตรง ๆ — จะได้ไม่มีทางที่ชื่อที่แสดงกับชื่อจริง
         * ในฐานข้อมูลพูดคนละเรื่องกัน และหน้ารายการคำเชิญอ่านออกตั้งแต่ก่อนเปิดใช้งาน
         */
        displayName: `${prefixTh ?? ""}${firstnameTh} ${lastnameTh}`,
        accountType: isOrgScoped ? AccountType.ORGANIZATION : AccountType.BDI,
        status: UserAccountStatus.PENDING,
        createdBy: SYSTEM_USER_ID,
        updatedBy: SYSTEM_USER_ID,
      },
    });

    const { key, record } = await issueActivationKey(tx, {
      userAccountId: account.id,
      organizationId,
      roleCode: role,
      actorId: SYSTEM_USER_ID,
    });

    return { account, key, record };
  });

  await sendInvitationEmail(email, result.key, ROLE_LABELS[role]);

  /**
   * การออกคำเชิญไม่เคยถูกบันทึกลง audit เลย ทั้งที่มันสร้างบัญชีและออกสิทธิ์เข้าระบบ —
   * `INVITATION_DELETED` จึงเคยเป็นร่องรอยเดียวของคำเชิญ และมีเฉพาะตอนถูกลบ
   */
  await logAudit({
    action: AuditAction.ACTIVATION_KEY_ISSUED,
    subjectType: AuditSubject.USER_ACTIVATION_KEY,
    subjectId: result.record.id,
    organizationId,
    after: { email, cid, role, name: result.account.displayName, userAccountId: result.account.id },
    metadata: { issued_via: "ADMIN_API", reason: "INVITATION" },
  });

  res.status(201).json({
    activationKeyId: result.record.id,
    userAccountId: result.account.id,
    email,
    role,
    roleLabel: ROLE_LABELS[role],
    organizationId,
    expiresAt: result.record.expiresAt,
  });
});

const invitationQuerySchema = z.object({
  /** ค้นบางส่วนของอีเมล — ใบที่ต้องลบมักถูกจำได้แค่ "อีเมลอะไรสักอย่างที่มี @mot" */
  email: z.string().trim().min(1).optional(),
  /**
   * เลขบัตรค้นแบบตรงตัวเต็มเท่านั้น ไม่ใช่ substring
   *
   * ค้นบางส่วนได้เท่ากับให้ไล่เดาเลขบัตรทีละหลักจาก endpoint นี้ ซึ่งไม่ใช่สิ่งที่
   * เจ้าหน้าที่ต้องการอยู่แล้ว — เขาถือเลขเต็มจากเอกสารที่หน่วยงานส่งมา
   */
  cid: nationalIdSchema.optional(),
  status: z.enum(Object.values(ActivationKeyStatus) as [string, ...string[]]).optional(),
  organizationId: uuidSchema("organizationId ต้องเป็น UUID").optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

/**
 * รายการคำเชิญ — ค้นหาได้ เพราะตอนนี้เป็นทางเดียวที่ใช้หาใบที่ต้องลบ
 *
 * ของเดิมเป็น `take: 100` ล้วน ๆ ไม่อ่าน query เลย ซึ่งพอเลิกเชิญซ้ำแล้วก็แปลว่า
 * เจ้าหน้าที่หาใบที่ต้องลบไม่เจอเมื่อคำเชิญเกินร้อยใบ
 */
adminRouter.get("/invitations", async (req, res) => {
  const parsed = invitationQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "validation", fields: formatZodError(parsed.error) });
    return;
  }
  const { email, cid, status, organizationId, page, pageSize } = parsed.data;

  const where: Prisma.ActivationKeyWhereInput = {
    ...(status ? { status: status as ActivationKeyStatus } : {}),
    ...(organizationId ? { organizationId } : {}),
    ...(email || cid
      ? {
          userAccount: {
            ...(email ? { email: { contains: email, mode: "insensitive" as const } } : {}),
            ...(cid ? { cid } : {}),
          },
        }
      : {}),
  };

  const [total, keys] = await prisma.$transaction([
    prisma.activationKey.count({ where }),
    prisma.activationKey.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        status: true,
        issuedAt: true,
        expiresAt: true,
        usedAt: true,
        revokedAt: true,
        createdAt: true,
        userAccount: { select: { id: true, email: true, cid: true, status: true } },
        role: { select: { code: true, nameTh: true } },
        organization: { select: { id: true, nameTh: true } },
      },
    }),
  ]);

  res.json({ invitations: keys, total, page, pageSize });
});

/**
 * ส่งคำเชิญใบเดิมซ้ำ — `POST /api/admin/invitations/:id/resend`
 *
 * คู่กับการตัด "เชิญซ้ำ" ออกจาก `POST /invitations`: เคสที่เกิดบ่อยที่สุดคือลิงก์หาย
 * หรือหมดอายุ โดยที่อีเมล เลขบัตร role และหน่วยงานถูกหมดแล้ว ถ้าบังคับให้ลบแล้วเชิญใหม่
 * เคสนี้จะกลายเป็นสี่ขั้นและต้องพิมพ์ payload ใหม่ทั้งชุด ซึ่งเป็นจุดที่พิมพ์ผิดตั้งแต่แรก
 *
 * **ไม่รับ payload เลย** จึงไม่มีอะไรให้กรอกผิด — ออกคีย์ใบใหม่ให้ (บัญชี/หน่วยงาน/role เดิม)
 * `issueActivationKey()` ยกเลิกใบเก่าของชุดเดียวกันให้เอง เหลือลิงก์ที่ใช้ได้ใบเดียว
 */
adminRouter.post("/invitations/:id/resend", async (req, res) => {
  const parsedId = z.string().uuid().safeParse(req.params.id);
  if (!parsedId.success) {
    res.status(404).json({ error: "not_found", message: "ไม่พบคำเชิญที่ระบุ" });
    return;
  }

  const key = await prisma.activationKey.findUnique({
    where: { id: parsedId.data },
    include: {
      userAccount: { select: { id: true, email: true, status: true } },
      role: { select: { code: true } },
    },
  });
  if (!key) {
    res.status(404).json({ error: "not_found", message: "ไม่พบคำเชิญที่ระบุ" });
    return;
  }

  if (key.userAccount.status === UserAccountStatus.ACTIVE) {
    res.status(409).json({
      error: "activated",
      message:
        `บัญชี ${key.userAccount.email} เปิดใช้งานแล้ว จึงไม่ต้องส่งคำเชิญซ้ำ — ` +
        `ถ้าเขาเข้าระบบไม่ได้ เป็นเรื่องของการล็อกอิน ไม่ใช่คำเชิญ`,
    });
    return;
  }

  const roleCode = key.role.code as RoleCode;
  const { key: raw, record } = await prisma.$transaction((tx) =>
    issueActivationKey(tx, {
      userAccountId: key.userAccountId,
      organizationId: key.organizationId,
      roleCode,
      actorId: SYSTEM_USER_ID,
    }),
  );

  await sendInvitationEmail(key.userAccount.email, raw, ROLE_LABELS[roleCode]);

  await logAudit({
    action: AuditAction.ACTIVATION_KEY_ISSUED,
    subjectType: AuditSubject.USER_ACTIVATION_KEY,
    subjectId: record.id,
    organizationId: key.organizationId,
    before: { activationKeyId: key.id, status: key.status },
    after: { email: key.userAccount.email, role: roleCode },
    metadata: { issued_via: "ADMIN_API", reason: "RESEND", replaced_key_id: key.id },
  });

  res.status(201).json({
    activationKeyId: record.id,
    replacedActivationKeyId: key.id,
    userAccountId: key.userAccountId,
    email: key.userAccount.email,
    role: roleCode,
    roleLabel: ROLE_LABELS[roleCode],
    organizationId: key.organizationId,
    expiresAt: record.expiresAt,
  });
});

/**
 * ลบคำเชิญทิ้งทั้งใบ — คนละเรื่องกับ `POST /:id/revoke` ที่เก็บใบเดิมไว้เป็นประวัติ
 *
 * มีไว้เพราะ `user_account.email` และ `user_account.cid` เป็น unique ทั้งคู่: ถ้าเจ้าหน้าที่
 * กรอกอีเมลผิดตอนเชิญ บัญชี PENDING ใบนั้นจะยึดทั้งอีเมลและเลขบัตรไว้ การ revoke คีย์
 * ไม่ได้คืนสองค่านั้นให้ ทางออกเดียวก่อนหน้านี้คือเข้าไปลบในฐานข้อมูลด้วยมือ ซึ่งเป็น
 * สิ่งที่ `docs/08-database-access.md` ห้ามไว้ — endpoint นี้จึงเป็นทางที่ถูกต้องแทน
 *
 *   DELETE /api/admin/invitations/:id
 *   x-admin-token: <ADMIN_API_TOKEN>
 *
 * ลบบัญชีให้เฉพาะเมื่อบัญชีนั้น "เกิดมาเพราะคำเชิญใบนี้และยังไม่ได้ทำอะไรเลย" คือยัง
 * PENDING · ไม่มีคีย์ใบอื่น · ไม่มี role · ไม่ถูกมอบหมายงานในสายอนุมัติ · ไม่มีลายเซ็น
 * หรือการยอมรับเอกสาร ถ้าติดข้อใดข้อหนึ่ง จะลบแค่คำเชิญและบอกว่าทำไมบัญชียังอยู่ —
 * ลบบัญชีที่มีร่องรอยการทำงานแล้วคือลบประวัติของคนอื่นไปด้วย
 */
adminRouter.delete("/invitations/:id", async (req, res) => {
  const parsedId = z.string().uuid().safeParse(req.params.id);
  if (!parsedId.success) {
    res.status(404).json({ error: "not_found", message: "ไม่พบคำเชิญที่ระบุ" });
    return;
  }

  const key = await prisma.activationKey.findUnique({
    where: { id: parsedId.data },
    include: {
      userAccount: {
        select: {
          id: true,
          email: true,
          cid: true,
          status: true,
          _count: {
            select: {
              activationKeys: true,
              roleAssignments: true,
              assignedReviewTasks: true,
              legalAcceptances: true,
              signatures: true,
            },
          },
        },
      },
      role: { select: { code: true } },
    },
  });
  if (!key) {
    res.status(404).json({ error: "not_found", message: "ไม่พบคำเชิญที่ระบุ" });
    return;
  }

  const account = key.userAccount;
  if (account.status === UserAccountStatus.ACTIVE) {
    res.status(409).json({
      error: "activated",
      message:
        `บัญชี ${account.email} เปิดใช้งานแล้ว จึงลบคำเชิญของบัญชีนี้ไม่ได้ — ` +
        `การลบบัญชีที่ใช้งานอยู่ไม่ใช่การลบคำเชิญ ถ้าต้องการปิดการใช้งาน ให้ระงับบัญชีแทน`,
    });
    return;
  }

  const counts = account._count;
  // คีย์ใบนี้นับอยู่ใน activationKeys ด้วย จึงเทียบกับ 1 ไม่ใช่ 0
  const keepAccountBecause =
    counts.activationKeys > 1
      ? "บัญชีนี้ยังมีคำเชิญใบอื่นอยู่"
      : counts.roleAssignments > 0
        ? "บัญชีนี้มีสิทธิ์ (role) ผูกอยู่แล้ว"
        : counts.assignedReviewTasks > 0
          ? "บัญชีนี้ถูกมอบหมายงานในสายอนุมัติแล้ว"
          : counts.legalAcceptances > 0 || counts.signatures > 0
            ? "บัญชีนี้มีลายเซ็นหรือการยอมรับเอกสารบันทึกไว้แล้ว"
            : null;

  const removed = await prisma.$transaction(async (tx) => {
    await tx.activationKey.delete({ where: { id: key.id } });
    if (keepAccountBecause) return { userAccount: null, organization: null, request: null };

    /**
     * หน่วยงานเปล่า + ร่างคำขอที่ POST /invitations สร้างไว้ให้คำเชิญที่ไม่ระบุหน่วยงาน
     *
     * ถ้าปล่อยไว้ ร่างนั้นจะค้างโดยที่ `created_by` ชี้บัญชีที่ถูกลบไปแล้ว และการเชิญ
     * คนเดิมใหม่ก็จะสร้างหน่วยงานเปล่าเพิ่มอีกใบ ลบเฉพาะใบที่ยังไม่มีใครแตะ: ชื่อยังเป็น
     * ชื่อ placeholder · ยังไม่มีคำขออื่นหรือคีย์ใบอื่นผูกอยู่ · ร่างยังเป็น DRAFT
     * ที่บัญชีนี้เป็นคนสร้าง (บัญชี PENDING ล็อกอินไม่ได้ จึงยังไม่มีทางแนบไฟล์หรือกรอกอะไร)
     */
    const organization = await tx.organization.findFirst({
      where: {
        id: key.organizationId,
        nameTh: PLACEHOLDER_ORGANIZATION_NAME,
        status: OrganizationStatus.PENDING_REGISTRATION,
        activationKeys: { none: {} },
        roleAssignments: { none: {} },
        datasets: { none: {} },
        datasetRequests: { none: {} },
        registrationRequests: {
          every: { status: RequestStatus.DRAFT, submittedAt: null, createdBy: account.id },
        },
      },
      select: { id: true, organizationCode: true, registrationRequests: { select: { id: true, requestNumber: true } } },
    });

    if (organization) {
      await tx.organizationRegistrationRequest.deleteMany({
        where: { organizationId: organization.id },
      });
      await tx.organization.delete({ where: { id: organization.id } });
    }

    await tx.userAccount.delete({ where: { id: account.id } });

    return {
      userAccount: { id: account.id, email: account.email, cid: account.cid },
      organization: organization && { id: organization.id, organizationCode: organization.organizationCode },
      request: organization?.registrationRequests[0] ?? null,
    };
  });

  await logAudit({
    action: AuditAction.INVITATION_DELETED,
    subjectType: AuditSubject.USER_ACTIVATION_KEY,
    subjectId: key.id,
    organizationId: key.organizationId,
    before: {
      email: account.email,
      cid: account.cid,
      role: key.role.code,
      keyStatus: key.status,
    },
    metadata: {
      deleted_via: "ADMIN_API",
      user_account_deleted: removed.userAccount !== null,
      kept_account_because: keepAccountBecause ?? undefined,
      placeholder_organization_deleted: removed.organization !== null,
    },
  });

  res.json({
    ok: true,
    removed: {
      activationKeyId: key.id,
      userAccount: removed.userAccount,
      organization: removed.organization,
      registrationRequest: removed.request,
    },
    message: removed.userAccount
      ? `ลบคำเชิญและบัญชี ${account.email} แล้ว — อีเมลและเลขบัตรประชาชนนี้ใช้เชิญใหม่ได้`
      : `ลบคำเชิญแล้ว แต่ยังเก็บบัญชี ${account.email} ไว้: ${keepAccountBecause}`,
  });
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

// -------------------------------------------------- เอกสารกฎหมาย (template .docx)

/**
 * เผยแพร่ template เอกสารกฎหมายฉบับใหม่
 *
 * นี่คือทางที่ทำให้ "แก้เอกสารได้โดยไม่ต้องแก้โค้ด" เป็นจริง: ฝ่ายกฎหมายแก้ .docx ใน Word
 * แล้วอัปโหลดเข้ามา ระบบออกเป็น legal_document_version ใหม่ เวอร์ชันเดิมกลายเป็น
 * SUPERSEDED และคำขอที่ลงนามไว้แล้วยังชี้เวอร์ชันเดิมของมันอยู่ (legal_acceptance)
 *
 * ตรวจสองอย่างก่อนรับ และทั้งคู่ตอบ 400 พร้อมบอกว่าต้องแก้อะไร:
 *   1. ชื่อ placeholder ทุกตัวต้องเป็นตัวที่ระบบต่อค่าให้ได้ (TEMPLATE_VARIABLES)
 *   2. LibreOffice ต้องแปลงไฟล์นั้นเป็น PDF ได้จริง
 * ปล่อยไฟล์ที่ไม่ผ่านสองข้อนี้เข้าไป จะไปพังตอนหน่วยงานกดสร้างเอกสาร ซึ่งเป็นคนละคน
 * คนละวัน และเขาแก้อะไรไม่ได้เลย
 *
 * ใช้ x-admin-token เหมือน endpoint อื่นในไฟล์นี้ — ยังไม่มีหน้าจอแอดมินในระบบ
 */
const TEMPLATE_MIME = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

const templateUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, TEMPLATE_MIME.has(file.mimetype)),
});

/**
 * ตั้งเอกสารเป็นบังคับหรือไม่บังคับ — `PATCH /api/admin/legal-documents/:code`
 *
 * `legal_document.is_required` มีในสคีมามาตั้งแต่ต้น ("ผู้ใช้ต้องยอมรับเอกสารนี้หรือไม่")
 * แต่ไม่เคยมีโค้ดไหนอ่านมัน — `seed-masters.ts` ตั้ง true ให้ทุกฉบับแล้วจบ ที่นี่คือที่ที่
 * แอดมินสลับได้ โดยไม่ต้องแก้โค้ดหรือ seed ใหม่
 *
 * ฉบับที่ไม่บังคับจะมีปุ่ม "ไม่เกี่ยวข้อง" ให้ผู้มีอำนาจกดข้ามตอนลงนาม และฉบับที่ถูกข้าม
 * จะไม่ถูกส่งต่อไปให้ฝ่าย BDI เห็นชอบด้วย
 *
 * **ไม่ย้อนหลัง** — คำขอที่ลงนามไปแล้วเก็บรายการเอกสารของตัวเองไว้ใน
 * `signature_confirmation.confirmation_payload_json` และ `legal_acceptance` แล้ว
 * การสลับค่านี้จึงมีผลกับคำขอที่ยังไม่ลงนามเท่านั้น
 */
adminRouter.patch("/legal-documents/:code", async (req, res) => {
  const parsed = z
    .object({ isRequired: z.boolean({ error: "ต้องระบุ isRequired เป็น true หรือ false" }) })
    .safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "validation", fields: formatZodError(parsed.error) });
    return;
  }

  const document = await prisma.legalDocument.findUnique({
    where: { documentCode: req.params.code },
    select: { id: true, documentCode: true, nameTh: true, isRequired: true },
  });
  if (!document) {
    res.status(404).json({ error: "not_found", message: "ไม่พบเอกสารรหัสนี้" });
    return;
  }

  if (document.isRequired === parsed.data.isRequired) {
    res.json({ document, changed: false });
    return;
  }

  const updated = await prisma.legalDocument.update({
    where: { id: document.id },
    data: { isRequired: parsed.data.isRequired },
    select: { id: true, documentCode: true, nameTh: true, isRequired: true },
  });

  await logAudit({
    action: AuditAction.LEGAL_DOCUMENT_PUBLISHED,
    subjectType: AuditSubject.LEGAL_DOCUMENT,
    subjectId: document.id,
    before: { isRequired: document.isRequired },
    after: { isRequired: updated.isRequired },
    metadata: { document_code: document.documentCode, changed_via: "ADMIN_API" },
  });

  res.json({
    document: updated,
    changed: true,
    message: updated.isRequired
      ? `${document.documentCode} กลับเป็นเอกสารบังคับแล้ว ผู้มีอำนาจต้องเห็นชอบทุกครั้ง`
      : `${document.documentCode} เป็นเอกสารไม่บังคับแล้ว ผู้มีอำนาจกด "ไม่เกี่ยวข้อง" ข้ามได้`,
  });
});

adminRouter.get("/legal-documents", async (_req, res) => {
  const documents = await prisma.legalDocument.findMany({
    orderBy: [{ applicationScope: "asc" }, { displayOrder: "asc" }],
    include: { versions: { orderBy: { versionNumber: "desc" } } },
  });

  res.json({
    /** รายชื่อตัวแปรที่ template ใช้ได้ จัดกลุ่มไว้ให้ผู้เขียนเอกสารอ่าน */
    variableGroups: Object.entries(VARIABLE_GROUPS).map(([group, title]) => ({
      group,
      title,
      variables: Object.entries(TEMPLATE_VARIABLES)
        .filter(([, spec]) => spec.group === group)
        .map(([name, spec]) => ({
          name: `{{${name}}}`,
          description: spec.description,
          example: spec.example,
        })),
    })),
    documents: documents.map((doc) => ({
      code: doc.documentCode,
      name: doc.nameTh,
      scope: doc.applicationScope,
      status: doc.status,
      displayOrder: doc.displayOrder,
      isRequired: doc.isRequired,
      versions: doc.versions.map((v) => ({
        id: v.id,
        versionNumber: v.versionNumber,
        status: v.status,
        contentHash: v.contentHash,
        publishedAt: v.publishedAt,
      })),
    })),
  });
});

adminRouter.post(
  "/legal-documents/:code/versions",
  templateUpload.single("file"),
  async (req, res) => {
    const code = String(req.params.code ?? "").toUpperCase();
    if (!req.file) {
      res.status(400).json({
        error: "validation",
        message: "กรุณาแนบไฟล์เอกสาร Word (.docx)",
        fields: { file: "รองรับเฉพาะไฟล์ .docx ขนาดไม่เกิน 20 MB" },
      });
      return;
    }

    const file = uploadedFile(req.file);
    const published = await publishVersion(prisma, {
      documentCode: code,
      docx: file.buffer,
      filename: file.originalname,
      actorId: SYSTEM_USER_ID,
    });

    await logAudit({
      action: AuditAction.LEGAL_DOCUMENT_PUBLISHED,
      subjectType: AuditSubject.LEGAL_DOCUMENT,
      subjectId: published.versionId,
      after: {
        documentCode: code,
        versionNumber: published.versionNumber,
        filename: file.originalname,
        placeholders: published.placeholders,
      },
    });

    res.status(201).json({
      documentCode: code,
      versionId: published.versionId,
      versionNumber: published.versionNumber,
      /** placeholder ที่พบในไฟล์ — ให้คนอัปโหลดยืนยันได้ว่าช่องที่ตั้งใจใส่ถูกอ่านเจอครบ */
      placeholders: published.placeholders,
      /**
       * ชื่อชุดเก่าที่ไฟล์นี้ยังใช้อยู่ — ยังเติมค่าให้ตามปกติ แต่ควรแก้เป็นชื่อใหม่
       * ในเวอร์ชันถัดไป (ดู docs/18-document-template-variables.md)
       */
      deprecatedPlaceholders: published.deprecatedPlaceholders,
      ...(published.deprecatedPlaceholders.length > 0
        ? {
            warning:
              `เอกสารนี้ยังใช้ชื่อ placeholder ชุดเดิม ${published.deprecatedPlaceholders.length} ตัว ` +
              `(${published.deprecatedPlaceholders.join(", ")}) — ระบบยังเติมค่าให้ได้ ` +
              `แต่กรุณาเปลี่ยนเป็นชื่อใหม่ในเวอร์ชันถัดไป`,
          }
        : {}),
    });
  },
);
