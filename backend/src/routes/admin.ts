import { Router } from "../lib/async-route.js";
import multer from "multer";
import { z } from "zod";
import {
  ActivationKeyStatus,
  AccountType,
  AttachmentOwnerType,
  AttachmentType,
  DeliveryStatus,
  LegalDocumentVersionStatus,
  OrganizationStatus,
  Prisma,
  RequestStatus,
  UserAccountStatus,
} from "@prisma/client";

import { prisma } from "../db.js";
import { adminActorId } from "../lib/context.js";
import { fullNameTh } from "../lib/person-name.js";
import { activeAttachment, readAttachment, streamAttachment, uploadedFile } from "../lib/attachment.js";
import { TEMPLATE_VARIABLES, VARIABLE_GROUPS } from "../lib/document-render.js";
import { publishVersion, templateAttachment } from "../lib/legal.js";
import { lookupZipcode, resolveAddressCodes, resolveAddressNames } from "../lib/address.js";
import {
  CHOICE_FIELD_KEYS,
  choiceStatus,
  refreshChoices,
  type ChoiceFieldKey,
} from "../lib/dataset-choices.js";
import {
  AuditAction,
  AuditSubject,
  diffFields,
  logAudit,
  sanitizeDiff,
  sanitizeState,
  sentOnly,
} from "../lib/audit.js";
import {
  activeAssignmentWhere,
  issueActivationKey,
  logKeysRevoked,
  pendingInvitationFor,
  revokeIssuedKeys,
  roleIdByCode,
  roleSeatTaken,
} from "../lib/iam.js";
import { sendInvitationEmail } from "../lib/mail.js";
import { ORGANIZATION_STATUS_LABELS, ROLE_LABELS } from "../lib/roles.js";
import {
  BDI_ORGANIZATION_ID,
  ORGANIZATION_SCOPED_ROLES,
  PLACEHOLDER_ORGANIZATION_NAME,
  ROLE_CODES,
  SYSTEM_USER_ID,
  type RoleCode,
} from "../lib/system.js";
import {
  emailSchema,
  formatZodError,
  nationalIdSchema,
  phoneExtensionSchema,
  uuidSchema,
} from "../lib/validation.js";
import { requireAdmin } from "../middleware/auth.js";

export const adminRouter = Router();

adminRouter.use(requireAdmin);

// ---------------------------------------------------------------- ภาพรวม

/** คำเชิญที่จะหมดอายุภายในช่วงนี้นับเป็น "ใกล้หมดอายุ" บนหน้าแรกของ /console */
const EXPIRING_SOON_MS = 48 * 60 * 60 * 1000;

/** แถวของ `groupBy` → `{ <status>: <count> }` ที่มีทุกสถานะ (สถานะที่ไม่มีแถวเป็น 0 ไม่หายไปจากคำตอบ) */
function countsByStatus<S extends string>(all: readonly S[], rows: { status: S; _count: { _all: number } }[]) {
  const out = Object.fromEntries(all.map((s) => [s, 0])) as Record<S, number>;
  for (const row of rows) out[row.status] = row._count._all;
  return out;
}

/**
 * ตัวเลขของหน้าแรกของ /console — การ์ด Admin Console (2026-10-05)
 *
 * นับอย่างเดียว ไม่มีชื่อคนหรือเลขบัตร ทุกตัวเลขเป็นลิงก์ไปหน้ารายการที่กรองไว้แล้วบนหน้าจอ คำเชิญที่ยัง ISSUED แต่เลยเวลา
 * แล้วนับเป็นหมดอายุ (`lapsed`) — คีย์เปลี่ยนเป็น EXPIRED ก็ต่อเมื่อมีคนกดลิงก์ (lib/iam.ts) ไม่มี job เก็บกวาด สถานะในตาราง
 * จึงยัง ISSUED ได้อีกนาน ตัวเลขนี้คือคำเชิญที่ผู้ดูแลต้องส่งใหม่
 */
adminRouter.get("/summary", async (_req, res) => {
  const now = new Date();
  const soon = new Date(now.getTime() + EXPIRING_SOON_MS);
  const [users, organizations, orgRequests, datasetRequests, usable, expiringSoon, lapsed, deadLetters] =
    await Promise.all([
      prisma.userAccount.groupBy({
        by: ["status"],
        where: { id: { not: SYSTEM_USER_ID } },
        _count: { _all: true },
      }),
      prisma.organization.groupBy({
        by: ["status"],
        where: { id: { not: BDI_ORGANIZATION_ID } },
        _count: { _all: true },
      }),
      prisma.organizationRegistrationRequest.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.datasetRegistrationRequest.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.activationKey.count({ where: { status: ActivationKeyStatus.ISSUED, expiresAt: { gt: now } } }),
      prisma.activationKey.count({
        where: { status: ActivationKeyStatus.ISSUED, expiresAt: { gt: now, lte: soon } },
      }),
      prisma.activationKey.count({ where: { status: ActivationKeyStatus.ISSUED, expiresAt: { lte: now } } }),
      prisma.notificationDelivery.count({ where: { status: DeliveryStatus.DEAD_LETTER } }),
    ]);

  res.json({
    users: countsByStatus(Object.values(UserAccountStatus), users),
    organizations: countsByStatus(Object.values(OrganizationStatus), organizations),
    organizationRequests: countsByStatus(Object.values(RequestStatus), orgRequests),
    datasetRequests: countsByStatus(Object.values(RequestStatus), datasetRequests),
    invitations: { usable, expiringSoon, lapsed },
    deadLetters,
    generatedAt: now,
  });
});

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
  /** เลขต่อของเบอร์หน่วยงาน — ตัวเลขล้วน ว่างได้ ไหลลงฟอร์มลงทะเบียนพร้อมเบอร์ */
  phoneExtension: phoneExtensionSchema,
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
  phoneExtension: string | null;
  email: string | null;
  websiteUrl: string | null;
  parentOrganizationId: string | null;
  activatedAt: Date | null;
  suspendedAt: Date | null;
  suspensionReason: string | null;
  deactivatedAt: Date | null;
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
    phoneExtension: org.phoneExtension,
    email: org.email,
    websiteUrl: org.websiteUrl,
    parentOrganizationId: org.parentOrganizationId,
    activatedAt: org.activatedAt,
    suspendedAt: org.suspendedAt,
    suspensionReason: org.suspensionReason,
    deactivatedAt: org.deactivatedAt,
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
      phoneExtension: input.phoneExtension ?? null,
      email: input.email ?? null,
      websiteUrl: input.websiteUrl ?? null,
      parentOrganizationId: input.parentOrganizationId ?? null,
      createdBy: adminActorId(),
      updatedBy: adminActorId(),
    },
  });

  await logAudit({
    action: AuditAction.ORGANIZATION_CREATED,
    subjectType: AuditSubject.ORGANIZATION,
    subjectId: organization.id,
    organizationId: organization.id,
    /**
     * ค่าที่ลงทะเบียนจริง (ที่อยู่เป็นรหัสที่แปลงแล้ว ไม่ใช่ชื่อที่ส่งมา) — เดิมเก็บแค่รหัสหน่วยงาน
     * ช่องที่ admin กรอกผิดตั้งแต่ตอนสร้างจึงย้อนดูไม่ได้ว่าเป็นค่าตั้งต้นหรือถูกแก้ทีหลัง ทุกช่องเป็นของ
     * หน่วยงาน ไม่มีข้อมูลบุคคลให้ปิด
     */
    after: {
      organizationCode: organization.organizationCode,
      organizationType: organization.organizationType,
      nameTh: organization.nameTh,
      nameEn: organization.nameEn,
      status: organization.status,
      addressLine: organization.addressLine,
      road: organization.road,
      provinceCode: organization.provinceCode,
      districtCode: organization.districtCode,
      subDistrictCode: organization.subDistrictCode,
      postalCode: organization.postalCode,
      phone: organization.phone,
      phoneExtension: organization.phoneExtension,
      email: organization.email,
      websiteUrl: organization.websiteUrl,
      parentOrganizationId: organization.parentOrganizationId,
    },
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
  phoneExtension: phoneExtensionSchema,
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

  /**
   * ค่าที่เขียนลงจริง — diff ของ audit เทียบกับตัวนี้ ไม่ใช่กับ body: body ส่งที่อยู่มาเป็นชื่อ แต่แถว
   * เก็บเป็นรหัส และรหัสไปรษณีย์ถูกหาให้ใหม่ได้แม้ไม่ได้ส่งมา
   */
  const written = {
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
    ...(input.phoneExtension !== undefined ? { phoneExtension: input.phoneExtension } : {}),
    ...(input.email !== undefined ? { email: input.email } : {}),
    ...(input.websiteUrl !== undefined ? { websiteUrl: input.websiteUrl } : {}),
    ...(input.parentOrganizationId !== undefined
      ? { parentOrganizationId: input.parentOrganizationId }
      : {}),
  };

  const organization = await prisma.organization.update({
    where: { id: before.id },
    data: { ...written, updatedBy: adminActorId() },
  });

  /**
   * เดิม before/after เก็บแค่รหัสกับชื่อไทยไม่ว่าจะแก้ช่องไหน — การแก้ที่อยู่หรืออีเมลของหน่วยงานจึงเหลือ
   * แถวที่บอกว่า "รหัสกับชื่อเหมือนเดิม" ตอนนี้เป็นช่องที่เปลี่ยนจริงทุกช่อง ยังเขียนแถวแม้ไม่มีอะไรเปลี่ยน
   * (`fields_changed: []`) เพราะคำสั่งของผู้ดูแลระบบเกิดขึ้นจริงและเขียนแถวหน่วยงานจริง
   */
  const diff = sanitizeDiff(diffFields(before, sentOnly(written)));
  await logAudit({
    action: AuditAction.ORGANIZATION_UPDATED,
    subjectType: AuditSubject.ORGANIZATION,
    subjectId: organization.id,
    organizationId: organization.id,
    before: diff?.before,
    after: diff?.after,
    metadata: {
      updated_via: "ADMIN_API",
      fields: Object.keys(input),
      fields_changed: Object.keys(diff?.after ?? {}),
    },
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

// ---------------------------------------------------------------- สถานะของหน่วยงาน

/** เหตุผลของคำสั่งที่เปลี่ยนสถานะหน่วยงาน — ลง `audit_event` และ `suspension_reason` เหมือนเหตุผลของ /api/admin/users */
const adminReasonSchema = z.object({
  reason: z
    .string({ error: "ต้องระบุ reason — เหตุผลนี้ถูกบันทึกลง audit" })
    .trim()
    .min(10, "กรุณาระบุเหตุผลอย่างน้อย 10 ตัวอักษร — เหตุผลนี้ถูกบันทึกไว้เป็นหลักฐาน")
    .max(500),
});

type OrganizationStatusChange = "suspend" | "deactivate" | "reactivate";

/** สถานะต้นทางที่แต่ละคำสั่งรับ — ที่เหลือตอบ 409 `invalid_state` */
const STATUS_CHANGE_FROM: Record<OrganizationStatusChange, OrganizationStatus[]> = {
  suspend: [OrganizationStatus.PENDING_REGISTRATION, OrganizationStatus.ACTIVE],
  deactivate: [
    OrganizationStatus.PENDING_REGISTRATION,
    OrganizationStatus.ACTIVE,
    OrganizationStatus.SUSPENDED,
  ],
  reactivate: [OrganizationStatus.SUSPENDED, OrganizationStatus.INACTIVE],
};

const STATUS_CHANGE_AUDIT = {
  suspend: AuditAction.ORGANIZATION_SUSPENDED,
  deactivate: AuditAction.ORGANIZATION_DEACTIVATED,
  reactivate: AuditAction.ORGANIZATION_REACTIVATED,
} as const;

/**
 * ระงับ / ยุติ / เปิดใช้หน่วยงานอีกครั้ง — การ์ด Admin Console (2026-10-05) เติมช่องที่ `docs/10` §9 เว้นไว้
 * ("ถ้าต้องเลิกใช้หน่วยงานหนึ่ง ทางที่ตรงกว่าคือเพิ่มสถานะ INACTIVE ให้ตั้งได้") ซึ่งแทนการลบ: หน่วยงานที่มีคำเชิญ
 * คำขอ หรือชุดข้อมูลผูกอยู่ลบทิ้งไม่ได้ และประวัติต้องอ่านย้อนได้
 *
 * **เปลี่ยนแค่สถานะของหน่วยงาน ไม่ลากอะไรไปด้วย** — บัญชีของสมาชิกยังเข้าระบบได้ คำขอที่ค้างอยู่ยังอยู่ที่ด่านเดิม
 * สิ่งที่หยุดเองคือของที่ถามสถานะนี้อยู่แล้ว: ยื่นคำขอชุดข้อมูลใหม่ต้อง ACTIVE และยื่นคำขอจดทะเบียนต้อง
 * PENDING_REGISTRATION คำตอบบอก `warnings` ว่ายังมีใครและอะไรค้างอยู่ ให้ผู้ดูแลตัดสินเองว่าจะระงับบัญชีหรือยกเลิก
 * คำขอต่อหรือไม่ — ทำให้เองจะเปลี่ยนงานของคนในหน่วยงานโดยไม่มีใครเห็นว่าใครสั่ง
 *
 * เปิดใช้อีกครั้งได้ ACTIVE ถ้าหน่วยงานเคยผ่านการจดทะเบียน (มีคำขอที่ APPROVED) ไม่งั้นกลับไป PENDING_REGISTRATION
 * — ตั้ง ACTIVE ให้หน่วยงานที่ไม่เคยผ่านด่านสุดท้ายเท่ากับข้ามทั้ง Journey B
 */
function organizationStatusRoute(change: OrganizationStatusChange) {
  return async (req: import("express").Request, res: import("express").Response) => {
    // `guid()` ไม่ใช่ `uuid()` — id ของหน่วยงาน BDI (`…0000b0`) ไม่มีเลขรุ่นของ RFC 9562 จึงไม่ผ่าน `uuid()` ของ zod 4
    // และจะได้ 404 แทนคำตอบที่บอกว่าทำไมทำไม่ได้
    const parsedId = z.guid().safeParse(req.params.id);
    const organization = parsedId.success
      ? await prisma.organization.findUnique({ where: { id: parsedId.data } })
      : null;
    if (!organization) {
      res.status(404).json({ error: "not_found", message: "ไม่พบหน่วยงานที่ระบุ" });
      return;
    }
    const parsed = adminReasonSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "validation", fields: formatZodError(parsed.error) });
      return;
    }
    if (organization.id === BDI_ORGANIZATION_ID) {
      res.status(409).json({
        error: "bdi_organization",
        message: "หน่วยงาน BDI เป็นหน่วยงานของระบบเอง เปลี่ยนสถานะไม่ได้",
      });
      return;
    }
    if (!STATUS_CHANGE_FROM[change].includes(organization.status)) {
      res.status(409).json({
        error: "invalid_state",
        message: `หน่วยงานนี้อยู่สถานะ ${ORGANIZATION_STATUS_LABELS[organization.status]} จึงทำคำสั่งนี้ไม่ได้`,
      });
      return;
    }

    const now = new Date();
    const actorId = adminActorId();
    let data: Prisma.OrganizationUncheckedUpdateInput;
    if (change === "suspend") {
      data = {
        status: OrganizationStatus.SUSPENDED,
        suspendedAt: now,
        suspendedBy: actorId,
        suspensionReason: parsed.data.reason,
      };
    } else if (change === "deactivate") {
      data = { status: OrganizationStatus.INACTIVE, deactivatedAt: now, deactivatedBy: actorId };
    } else {
      const approved = await prisma.organizationRegistrationRequest.count({
        where: { organizationId: organization.id, status: RequestStatus.APPROVED },
      });
      data = {
        status: approved > 0 ? OrganizationStatus.ACTIVE : OrganizationStatus.PENDING_REGISTRATION,
        suspendedAt: null,
        suspendedBy: null,
        suspensionReason: null,
        deactivatedAt: null,
        deactivatedBy: null,
      };
    }
    const updated = await prisma.organization.update({
      where: { id: organization.id },
      data: { ...data, updatedBy: actorId },
    });

    await logAudit({
      action: STATUS_CHANGE_AUDIT[change],
      subjectType: AuditSubject.ORGANIZATION,
      subjectId: organization.id,
      organizationId: organization.id,
      before: { status: organization.status },
      after: { status: updated.status },
      metadata: { reason: parsed.data.reason, organization_code: organization.organizationCode },
    });

    res.json({
      organization: await toAdminOrganizationShape(updated),
      warnings: change === "reactivate" ? [] : await organizationLeftovers(organization.id),
    });
  };
}

/** สิ่งที่ยังทำงานอยู่ในหน่วยงานหลังเปลี่ยนสถานะ — ให้ผู้ดูแลตัดสินต่อเอง ดู `organizationStatusRoute()` */
async function organizationLeftovers(organizationId: string): Promise<string[]> {
  const open = {
    notIn: [RequestStatus.DRAFT, RequestStatus.APPROVED, RequestStatus.REJECTED, RequestStatus.CANCELLED],
  };
  const [members, orgRequests, datasetRequests] = await Promise.all([
    prisma.userAccount.count({
      where: {
        status: UserAccountStatus.ACTIVE,
        roleAssignments: { some: { organizationId, ...activeAssignmentWhere() } },
      },
    }),
    prisma.organizationRegistrationRequest.count({ where: { organizationId, status: open } }),
    prisma.datasetRegistrationRequest.count({ where: { organizationId, status: open } }),
  ]);
  const warnings: string[] = [];
  if (members > 0) {
    warnings.push(
      `ยังมีบัญชีที่ใช้งานอยู่ในหน่วยงานนี้ ${members} บัญชี — ระงับบัญชีแยกต่างหากถ้าไม่ต้องการให้เข้าระบบ`,
    );
  }
  if (orgRequests > 0) warnings.push(`มีคำขอจดทะเบียนหน่วยงานที่อยู่ระหว่างพิจารณา ${orgRequests} ใบ`);
  if (datasetRequests > 0) warnings.push(`มีคำขอลงทะเบียนชุดข้อมูลที่อยู่ระหว่างพิจารณา ${datasetRequests} ใบ`);
  return warnings;
}

adminRouter.post("/organizations/:id/suspend", organizationStatusRoute("suspend"));
adminRouter.post("/organizations/:id/deactivate", organizationStatusRoute("deactivate"));
adminRouter.post("/organizations/:id/reactivate", organizationStatusRoute("reactivate"));

// ---------------------------------------------------------------- คำเชิญผู้ใช้

/**
 * ช่องชื่อของคำเชิญ — ค่าว่างนับเท่ากับไม่ส่ง
 *
 * คนเรียก endpoint นี้คือสคริปต์ Postman และ notebook ซึ่งส่ง `""` มาแทน "ไม่มี" เสมอ
 * ถ้าปล่อยผ่านจะได้แถวที่ชื่อเป็นสตริงว่าง แทนที่จะเป็น NULL แล้วโค้ดที่เช็ค
 * `firstnameTh ?? …` ก็จะเลือกสตริงว่างนั้นแทนที่จะตกไปหาค่าสำรอง
 */
const optionalNameSchema = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value ? value : undefined));

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
     * ชื่อจริงของผู้ถูกเชิญ — **ไม่บังคับ** (Feedback 20260904 #2 → Invitation API ข้อ 1)
     *
     * เคยบังคับทุก role เพราะเอกสาร A0–A3 เลือกชื่อจาก `firstnameTh`/`lastnameTh` ก่อน
     * `display_name` เสมอ ถ้าสองช่องนั้นว่าง ชื่อบนเอกสารจะตกไปเป็นอีเมล
     *
     * เหตุผลนั้นหมดไปแล้วสองชั้น: ตอนเชิญ เจ้าหน้าที่มักมีแค่อีเมลอยู่ในมือ และชื่อที่กรอก
     * ตอนเชิญถูกเขียนทับอยู่ดีตอนเจ้าตัวเปิดใช้งาน — `POST /api/auth/activate` เขียนทั้งสี่
     * ช่องพร้อมกันและ **ยังบังคับกรอกครบเหมือนเดิม** บัญชีจึงมีชื่อครบก่อนไปปรากฏบนเอกสาร
     * ใด ๆ เสมอ เพราะเอกสารออกหลังเปิดใช้งานทั้งหมด
     *
     * ส่งมาก็ยังมีประโยชน์เท่าเดิม — `GET /api/auth/invitation` เอาไป prefill ฟอร์มเปิด
     * ใช้งาน ผู้ถูกเชิญจะได้ไม่ต้องพิมพ์สิ่งที่ระบบรู้อยู่แล้วซ้ำอีกรอบ
     */
    prefixTh: optionalNameSchema(64),
    firstnameTh: optionalNameSchema(255),
    lastnameTh: optionalNameSchema(255),
    /**
     * เลขประจำตัวประชาชนของคนที่ถูกเชิญ — บังคับทุก role
     *
     * §2.4 ของสเปก ThaID ให้เทียบเลขบัตรที่ ThaID ส่งกลับมากับ "CID ที่ถูกบันทึกไว้
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
    // ชื่อหน่วยงานขึ้นหัวจดหมายในอีเมลคำเชิญ ("เรียน ผู้ใช้งาน <หน่วยงาน>")
    select: { id: true, nameTh: true, status: true },
  });
  if (!organization) {
    res.status(404).json({ error: "not_found", message: "ไม่พบหน่วยงานที่ระบุ" });
    return;
  }

  /**
   * หนึ่งหน่วยงานมีผู้ดำเนินการหนึ่งคนและผู้มีอำนาจอนุมัติหนึ่งคน — **ที่นั่งไม่ว่างก็เชิญ
   * ไม่ได้** (การ์ด "แก้เรื่อง invite org user เพิ่ม" 2026-09-13)
   *
   * เดิม endpoint นี้ไม่ดูเลยว่าหน่วยงานมีคนอยู่แล้วหรือไม่ แล้วปล่อยให้ `assignRole()`
   * ตอนเปิดใช้งานเตะคนเดิมออกให้คนใหม่ — เชิญผิดคนครั้งเดียวเปลี่ยนตัวผู้รับผิดชอบของ
   * หน่วยงานได้ทั้งคน ตอนนี้ตอบ 409 ตั้งแต่ตอนเชิญ พร้อมบอกว่าใครนั่งอยู่ (ฝั่ง admin
   * ไม่ mask — คนเรียกคือผู้ประสานงานของ BDI) และต้องระงับหรือยุติบัญชีคนนั้นก่อน
   *
   * สามด่านตามลำดับ:
   *   1. ผู้มีอำนาจอนุมัติเชิญได้เฉพาะหน่วยงานที่ ACTIVE แล้ว — ก่อนหน้านั้นผู้มีอำนาจฯ
   *      ต้องมาจากคำขอจดทะเบียน (Journey B) ซึ่งเป็นคนที่ถูกกรอกชื่อไว้บนเอกสาร A0
   *      การเชิญตรงจะได้คนที่ไม่ตรงกับเอกสารที่หน่วยงานกำลังจะลงนาม
   *   2. มีคนถือ role นี้และบัญชียังใช้งานอยู่ → 409 `role_occupied`
   *   3. มีคำเชิญ role นี้ค้างอยู่ → 409 `invitation_pending` — ที่นั่งถูกจองตั้งแต่ตอน
   *      เชิญ ไม่งั้นคนที่กดลิงก์ทีหลังจะเจอ error ตอนเปิดใช้งานที่ตัวเองแก้ไม่ได้
   */
  if (isOrgScoped) {
    if (role === ROLE_CODES.ORGANIZATION_APPROVER && organization.status !== OrganizationStatus.ACTIVE) {
      res.status(409).json({
        error: "organization_not_active",
        message:
          `หน่วยงานนี้ยังไม่เปิดใช้งาน (สถานะ ${organization.status}) จึงยังเชิญผู้มีอำนาจอนุมัติตรง ๆ ไม่ได้ — ` +
          `ผู้มีอำนาจอนุมัติคนแรกมาจากคำขอจดทะเบียนหน่วยงาน (ผู้ดำเนินการกรอกชื่อไว้ในฟอร์ม ` +
          `ระบบส่งคำเชิญให้เองเมื่อผู้ประสานงานของ BDI ตรวจสอบผ่าน) ` +
          `เชิญตรงได้เฉพาะเมื่อหน่วยงานเปิดใช้งานแล้วและที่นั่งว่าง`,
        organizationStatus: organization.status,
      });
      return;
    }

    const roleId = await roleIdByCode(prisma, role);
    const holder = await roleSeatTaken(prisma, { organizationId, roleId });
    if (holder) {
      res.status(409).json({
        error: "role_occupied",
        message:
          `หน่วยงานนี้มี "${ROLE_LABELS[role]}" ที่ใช้งานอยู่แล้ว (${holder.userAccount.email}) — ` +
          `หนึ่งหน่วยงานมีได้คนเดียว ระบบไม่เปลี่ยนตัวให้เอง ` +
          `ถ้าต้องการเปลี่ยนคน ให้ระงับด้วย POST /api/admin/users/:id/suspend ` +
          `หรือยุติบัญชีด้วย POST /api/admin/users/:id/deactivate ก่อน แล้วค่อยเชิญใหม่`,
        holderUserAccountId: holder.userAccountId,
        holderEmail: holder.userAccount.email,
      });
      return;
    }

    const pending = await pendingInvitationFor(prisma, { organizationId, roleId });
    if (pending) {
      res.status(409).json({
        error: "invitation_pending",
        message:
          `หน่วยงานนี้มีคำเชิญไปยังตำแหน่ง "${ROLE_LABELS[role]}" ค้างอยู่แล้วที่อีเมล์ ${pending.userAccount.email} — ` +
          `หากต้องการเปลี่ยนแปลง กรุณายกเลิกคำเชิญก่อนหน้าด้วย ` +
          `DELETE /api/admin/invitations/${pending.id} ก่อน ` +
          `ในกรณีที่ต้องการ invite เจ้าหน้าที่ท่านเดิมเพื่อส่ง link invitation ใหม่ กรุณาใช้ POST /api/admin/invitations/${pending.id}/resend`,
        activationKeyId: pending.id,
        userAccountId: pending.userAccountId,
        pendingEmail: pending.userAccount.email,
      });
      return;
    }
  }

  /**
   * ไม่มีการ "เชิญซ้ำ" อีกแล้ว (ตัดสินใจ 2026-08-30)
   *
   * ของเดิมถือว่าการเชิญอีเมลเดิมที่ยัง PENDING คือเจ้าหน้าที่แก้ข้อมูลที่กรอกผิด แล้ว
   * **เขียนทับ `cid` ของบัญชีนั้นเงียบ ๆ** ทั้งที่ endpoint นี้ไม่เขียน audit เลย — `cid`
   * คือค่าที่ ThaID §2.4 เอาไปเทียบตอนเปิดใช้งาน พิมพ์ผิดครั้งเดียวจึงเปลี่ยนตัวคนที่
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
        /**
         * ว่างได้ — คำเชิญที่ไม่ได้กรอกชื่อมาจะได้บัญชี PENDING ที่ยังไม่มีชื่อ จนกว่า
         * เจ้าตัวจะเปิดใช้งานแล้วกรอกเอง **ไม่ตกไปใช้อีเมล** เพราะอีเมลใน `display_name`
         * คือทางที่อีเมลไปโผล่ในช่องลายมือชื่อบนเอกสารได้ (ดู lib/person-name.ts)
         */
        displayName: fullNameTh({ prefixTh, firstnameTh, lastnameTh }),
        accountType: isOrgScoped ? AccountType.ORGANIZATION : AccountType.BDI,
        status: UserAccountStatus.PENDING,
        createdBy: adminActorId(),
        updatedBy: adminActorId(),
      },
    });

    const { key, record } = await issueActivationKey(tx, {
      userAccountId: account.id,
      organizationId,
      roleCode: role,
      actorId: adminActorId(),
    });

    // บัญชีเพิ่งเกิดใน transaction นี้ จึงไม่มีคีย์ใบเก่าให้ `revokedKeys` — ไม่ต้องเขียน REVOKED
    return { account, key, record };
  });

  /**
   * audit ทั้งสองแถวมาก่อนอีเมล — การส่งทำ inline และ throw ได้ เดิมแถวอยู่หลังการส่ง SMTP ที่ล้ม
   * จึงพาแถวหายไปด้วยทั้งที่บัญชีกับคีย์ถูก commit ไปแล้ว (ผู้ดูแลระบบได้ 500 แล้วเชิญซ้ำไม่ได้เพราะอีเมล
   * มีบัญชีแล้ว โดยไม่มีบันทึกว่าบัญชีนั้นมาจากไหน)
   */
  await logAudit({
    action: AuditAction.USER_ACCOUNT_CREATED,
    subjectType: AuditSubject.USER_ACCOUNT,
    subjectId: result.account.id,
    organizationId,
    after: sanitizeState({
      email,
      cid,
      displayName: result.account.displayName,
      accountType: result.account.accountType,
      status: result.account.status,
    }),
    metadata: { created_via: "ADMIN_API", activation_key_id: result.record.id, role },
  });

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

  await sendInvitationEmail(email, result.key, {
    roleLabel: ROLE_LABELS[role],
    organizationName: organization.nameTh,
    expiresAt: result.record.expiresAt,
    internal: organizationId === BDI_ORGANIZATION_ID,
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
  /**
   * คำเชิญที่ยัง ISSUED แต่ `lapsed` เลยเวลาแล้ว หรือ `soon` จะหมดภายใน 48 ชั่วโมง — ลิงก์จากหน้าภาพรวมของ /console
   * (`GET /summary`) คีย์เปลี่ยนเป็น EXPIRED ก็ต่อเมื่อมีคนกดลิงก์ `status=EXPIRED` จึงไม่เจอใบที่ไม่มีใครกด
   */
  state: z.enum(["lapsed", "soon"]).optional(),
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
  const { email, cid, status, state, organizationId, page, pageSize } = parsed.data;

  const now = new Date();
  const where: Prisma.ActivationKeyWhereInput = {
    ...(status ? { status: status as ActivationKeyStatus } : {}),
    ...(state === "lapsed" ? { status: ActivationKeyStatus.ISSUED, expiresAt: { lte: now } } : {}),
    ...(state === "soon"
      ? {
          status: ActivationKeyStatus.ISSUED,
          expiresAt: { gt: now, lte: new Date(now.getTime() + EXPIRING_SOON_MS) },
        }
      : {}),
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
      organization: { select: { nameTh: true } },
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

  /**
   * ที่นั่งต้องยังเป็นของคนนี้อยู่ — กฎเดียวกับ `POST /invitations`
   *
   * คำเชิญที่หมดอายุไปแล้วไม่ได้จองที่นั่ง (`pendingInvitationFor()` นับเฉพาะใบที่ยังไม่
   * หมดอายุ) ระหว่างนั้นหน่วยงานอาจได้คนใหม่ไปแล้ว ถ้าส่งใบเก่าซ้ำโดยไม่ดู คนที่กดลิงก์
   * จะเจอ `RoleOccupiedError` ตอนเปิดใช้งาน — error ที่เขาแก้เองไม่ได้
   */
  if (
    ORGANIZATION_SCOPED_ROLES.includes(roleCode) &&
    key.organizationId !== BDI_ORGANIZATION_ID
  ) {
    const holder = await roleSeatTaken(prisma, {
      organizationId: key.organizationId,
      roleId: key.roleId,
      exceptUserAccountId: key.userAccountId,
    });
    if (holder) {
      res.status(409).json({
        error: "role_occupied",
        message:
          `หน่วยงานนี้มี "${ROLE_LABELS[roleCode]}" ที่ใช้งานอยู่แล้ว (${holder.userAccount.email}) — ` +
          `ส่งคำเชิญใบนี้ซ้ำไม่ได้จนกว่าจะระงับหรือยุติบัญชีคนนั้นก่อน`,
        holderUserAccountId: holder.userAccountId,
        holderEmail: holder.userAccount.email,
      });
      return;
    }
    const pending = await pendingInvitationFor(prisma, {
      organizationId: key.organizationId,
      roleId: key.roleId,
      exceptUserAccountId: key.userAccountId,
    });
    if (pending) {
      res.status(409).json({
        error: "invitation_pending",
        message:
          `หน่วยงานนี้มีคำเชิญ "${ROLE_LABELS[roleCode]}" ของคนอื่นค้างอยู่ (${pending.userAccount.email}) — ` +
          `ยกเลิกใบนั้นด้วย DELETE /api/admin/invitations/${pending.id} ก่อน ถ้าจะส่งใบนี้ซ้ำ`,
        activationKeyId: pending.id,
        userAccountId: pending.userAccountId,
        pendingEmail: pending.userAccount.email,
      });
      return;
    }
  }

  const { key: raw, record, revokedKeys } = await prisma.$transaction((tx) =>
    issueActivationKey(tx, {
      userAccountId: key.userAccountId,
      organizationId: key.organizationId,
      roleCode,
      actorId: adminActorId(),
    }),
  );

  // audit ก่อนอีเมลที่ส่ง inline และ throw ได้ — เหตุผลเดียวกับ `POST /invitations`
  // ใบเดิมที่สถานะยัง ISSUED ถูกแทนที่ (ใบที่เป็น EXPIRED หรือ REVOKED อยู่แล้วไม่อยู่ใน `revokedKeys`)
  await logKeysRevoked(revokedKeys, { revokedVia: "ADMIN_API", replacedByKeyId: record.id });
  await logAudit({
    action: AuditAction.ACTIVATION_KEY_ISSUED,
    subjectType: AuditSubject.USER_ACTIVATION_KEY,
    subjectId: record.id,
    organizationId: key.organizationId,
    before: { activationKeyId: key.id, status: key.status },
    after: { email: key.userAccount.email, role: roleCode },
    metadata: { issued_via: "ADMIN_API", reason: "RESEND", replaced_key_id: key.id },
  });

  await sendInvitationEmail(key.userAccount.email, raw, {
    roleLabel: ROLE_LABELS[roleCode],
    organizationName: key.organization.nameTh,
    // วันหมดอายุของ **คีย์ใบใหม่** ไม่ใช่ของใบที่เพิ่งถูกแทนที่
    expiresAt: record.expiresAt,
    internal: key.organizationId === BDI_ORGANIZATION_ID,
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
              /**
               * นับเฉพาะคีย์ใบอื่นที่ **ยังใช้ได้** — ใบ REVOKED ที่ `resend` ทิ้งไว้เป็นประวัติ
               * ของคำเชิญใบเดียวกัน ไม่ใช่ "คำเชิญใบอื่น" เดิมนับทุกใบ พอ resend สักครั้ง
               * บัญชีก็มีสองแถวและลบไม่ได้อีกเลย อีเมลกับเลขบัตรถูกยึดถาวรทั้งที่ทางแก้
               * ที่ทุกข้อความ 409 ชี้ไปคือ "ลบใบเดิมแล้วเชิญใหม่" (พบ 2026-09-13)
               * `activation_key` มี onDelete: Cascade ใบเก่าจึงหายไปพร้อมบัญชี
               */
              activationKeys: {
                where: { NOT: { id: parsedId.data }, status: ActivationKeyStatus.ISSUED },
              },
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
  const keepAccountBecause =
    counts.activationKeys > 0
      ? "บัญชีนี้ยังมีคำเชิญใบอื่นที่ใช้ได้อยู่"
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

/**
 * `reason` ของการเพิกถอน — ไม่บังคับมาตั้งแต่แรก (คู่มือผู้ทดสอบ `docs/13` เรียกโดยไม่ส่ง body) และค่าตั้งต้น
 * ก็ยังบอกได้ว่าผู้ดูแลระบบเป็นคนสั่ง
 *
 * แต่ถ้าส่งมาต้องเป็นข้อความ 10–500 ตัวอักษรเหมือน `/api/admin/users` เดิมรับ `String(...)` ของอะไรก็ได้
 * object กลายเป็น "[object Object]" ค่าว่างก็ผ่าน และยาวเป็นเมกะไบต์ก็ผ่าน ค่านี้ลงทั้ง `revoked_reason`
 * (ไม่จำกัดความยาว) และ `metadata.reason` ของ `audit_event` ซึ่งไม่มี retention และไม่มีวันถูกแก้
 */
const revokeSchema = z.object({
  reason: z
    .string({ error: "reason ต้องเป็นข้อความ — เหตุผลนี้ถูกบันทึกลง audit" })
    .trim()
    .min(10, "กรุณาระบุเหตุผลอย่างน้อย 10 ตัวอักษร หรือไม่ต้องส่ง reason มาเลย — เหตุผลนี้ถูกบันทึกลง audit")
    .max(500, "เหตุผลยาวได้ไม่เกิน 500 ตัวอักษร")
    .optional(),
});

/**
 * เพิกถอนคำเชิญ แต่เก็บแถวไว้เป็นประวัติ — ต่างจาก `DELETE /invitations/:id` ที่คืนอีเมลกับเลขบัตร
 *
 * เดิมเส้นทางนี้ไม่เขียน audit เลย (QA A14) คำเชิญที่ถูกเพิกถอนจึงเหลือแค่ `revoked_reason` บนแถว
 * ซึ่งบอกไม่ได้ว่าถูกสั่งเมื่อไรในคำขอไหน ตอนนี้เขียน `ACTIVATION_KEY_REVOKED` พร้อมเหตุผลที่พิมพ์มา
 * แตะเฉพาะใบที่สถานะยังเป็น ISSUED — ใบที่เป็น USED, EXPIRED หรือ REVOKED แล้วตอบ 404 เหมือนเดิม
 * และไม่ได้แถวซ้ำ แม้สั่งพร้อมกันหลายครั้ง: `revokeIssuedKeys()` คืนเฉพาะใบที่คำสั่งนี้เปลี่ยนเอง
 */
adminRouter.post("/invitations/:id/revoke", async (req, res) => {
  const parsedId = z.string().uuid().safeParse(req.params.id);
  if (!parsedId.success) {
    res.status(404).json({ error: "not_found", message: "ไม่พบคำเชิญที่ยังใช้งานได้" });
    return;
  }
  const parsed = revokeSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "validation", fields: formatZodError(parsed.error) });
    return;
  }
  const revoked = await revokeIssuedKeys(
    prisma,
    { id: parsedId.data },
    { actorId: adminActorId(), reason: parsed.data.reason ?? "ยกเลิกโดยผู้ดูแลระบบ" },
  );
  if (revoked.length === 0) {
    res.status(404).json({ error: "not_found", message: "ไม่พบคำเชิญที่ยังใช้งานได้" });
    return;
  }
  await logKeysRevoked(revoked, { revokedVia: "ADMIN_API" });
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
 * แก้ข้อมูลประจำตัวของเอกสาร — `PATCH /api/admin/legal-documents/:code`
 *
 * สามช่องที่ฝ่ายกฎหมายสั่งเปลี่ยนได้โดยไม่ต้องแก้โค้ดและไม่ต้อง seed ใหม่ — ส่งมาช่องเดียว
 * หรือหลายช่องพร้อมกันก็ได้ ช่องที่ไม่ได้ส่งมาไม่ถูกแตะ
 *
 * - **`shortname`** ชื่อสั้นที่ผู้ใช้เห็นแทนรหัส (`ผนวก 1`) รหัส `A0`–`A4` เป็นของภายใน
 *   ระบบไม่พิมพ์ออกหน้าจอ ฉบับที่ไม่มีชื่อสั้นตกกลับไปใช้ชื่อเต็ม ไม่ใช่ตกกลับไปใช้รหัส
 *   (`documentLabel()` ที่ `frontend/lib/legal-document.ts`) — **unique** ทั้งตาราง
 * - **`legalNotice`** คำเตือนใต้บรรทัด "เอกสารฉบับที่ n จาก m" ในกล่องอ่าน/ลงนามของ
 *   ผู้มีอำนาจ **ไม่ใช่เนื้อเอกสาร** และไม่เข้าไปอยู่ใน .docx — ของ A3 คือบรรทัดที่บอกว่า
 *   หน่วยงานที่ไม่มีการแบ่งปันข้อมูลส่วนบุคคลกดข้ามได้
 * - **`isRequired`** ฉบับที่ไม่บังคับจะมีปุ่ม "ไม่เกี่ยวข้อง" ให้ผู้มีอำนาจกดข้ามตอนลงนาม
 *   และฉบับที่ถูกข้ามจะไม่ถูกส่งต่อไปให้ฝ่าย BDI เห็นชอบด้วย
 *
 * `is_required` มีในสคีมามาตั้งแต่ต้นแต่ไม่เคยมีโค้ดไหนอ่านมัน — `seed-masters.ts` เคยตั้ง
 * true ให้ทุกฉบับแล้วจบ ที่นี่คือที่ที่แอดมินสลับได้ และ `seed-masters.ts` จงใจไม่ใส่
 * `isRequired` ไว้ใน `update` ของ upsert เพื่อไม่ให้การ seed รอบถัดไปล้างสิ่งที่ตั้งไว้ที่นี่
 * **`shortname` กับ `legalNotice` ยังอยู่ใน `update` นั้น** การรัน `seed:masters` จึงดึงสอง
 * ช่องนี้กลับไปเป็นค่าในโค้ด — แก้ถาวรต้องแก้ `LEGAL_DOCUMENTS` ในสคริปต์นั้นด้วย
 *
 * **ไม่ย้อนหลัง** — คำขอที่ลงนามไปแล้วเก็บรายการเอกสารของตัวเองไว้ใน
 * `signature_confirmation.confirmation_payload_json` และ `legal_acceptance` แล้ว
 * การแก้ค่าเหล่านี้จึงมีผลกับคำขอที่ยังไม่ลงนามเท่านั้น
 */

/** ค่าที่ส่งมาเป็นช่องว่างล้วนนับเป็น "ไม่มี" — `legalNoticeOf()` ฝั่งหน้าจอนับแบบเดียวกัน
 *  และ `shortname` ที่เป็นสตริงว่างจะชนกันเองที่ดัชนี unique ตั้งแต่ฉบับที่สอง */
const blankToNull = (value: string | null | undefined) =>
  value === undefined ? undefined : (value?.trim() ? value.trim() : null);

const legalDocumentPatchSchema = z
  .object({
    shortname: z
      .string()
      .max(200, { error: "ชื่อสั้นยาวได้ไม่เกิน 200 ตัวอักษร" })
      .nullable()
      .optional(),
    legalNotice: z.string().nullable().optional(),
    isRequired: z.boolean({ error: "ต้องระบุ isRequired เป็น true หรือ false" }).optional(),
  })
  .refine(
    (body) =>
      body.shortname !== undefined || body.legalNotice !== undefined || body.isRequired !== undefined,
    { error: "ต้องส่งอย่างน้อยหนึ่งช่อง: shortname, legalNotice หรือ isRequired" },
  );

/** ช่องที่แก้ได้ พร้อมถ้อยคำที่ใช้รายงานกลับไป — ลำดับเดียวกับที่ตอบใน `changed` */
const PATCHABLE_FIELDS = ["shortname", "legalNotice", "isRequired"] as const;

adminRouter.patch("/legal-documents/:code", async (req, res) => {
  const parsed = legalDocumentPatchSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "validation", fields: formatZodError(parsed.error) });
    return;
  }

  const document = await prisma.legalDocument.findUnique({
    where: { documentCode: req.params.code },
    select: {
      id: true,
      documentCode: true,
      nameTh: true,
      shortname: true,
      legalNotice: true,
      isRequired: true,
    },
  });
  if (!document) {
    res.status(404).json({ error: "not_found", message: "ไม่พบเอกสารรหัสนี้" });
    return;
  }

  const wanted = {
    shortname: blankToNull(parsed.data.shortname),
    legalNotice: blankToNull(parsed.data.legalNotice),
    isRequired: parsed.data.isRequired,
  };

  // ส่งค่าเดิมกลับมาไม่นับเป็นการแก้ — ไม่เขียนแถวและไม่เขียน audit ให้เปล่า ๆ
  const changed = PATCHABLE_FIELDS.filter(
    (field) => wanted[field] !== undefined && wanted[field] !== document[field],
  );
  if (changed.length === 0) {
    res.json({ document, changed: false, changedFields: [] });
    return;
  }

  const data = Object.fromEntries(changed.map((field) => [field, wanted[field]]));

  let updated;
  try {
    updated = await prisma.legalDocument.update({
      where: { id: document.id },
      data,
      select: {
        id: true,
        documentCode: true,
        nameTh: true,
        shortname: true,
        legalNotice: true,
        isRequired: true,
      },
    });
  } catch (error) {
    // shortname เป็น unique ทั้งตาราง — ชื่อซ้ำต้องบอกว่าซ้ำกับใคร ไม่ใช่ 500
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const owner = await prisma.legalDocument.findFirst({
        where: { shortname: wanted.shortname },
        select: { documentCode: true },
      });
      res.status(409).json({
        error: "conflict",
        message: `ชื่อสั้น "${wanted.shortname}" ถูกใช้กับเอกสาร ${owner?.documentCode ?? "ฉบับอื่น"} อยู่แล้ว`,
        fields: { shortname: "ชื่อสั้นต้องไม่ซ้ำกับเอกสารฉบับอื่น" },
      });
      return;
    }
    throw error;
  }

  // ไม่มีเวอร์ชันใหม่เกิดขึ้น — ไม่ใช่ LEGAL_DOCUMENT_PUBLISHED (ดูคอมเมนต์ของรหัสใน lib/audit.ts)
  await logAudit({
    action: AuditAction.LEGAL_DOCUMENT_UPDATED,
    subjectType: AuditSubject.LEGAL_DOCUMENT,
    subjectId: document.id,
    before: Object.fromEntries(changed.map((field) => [field, document[field]])),
    after: Object.fromEntries(changed.map((field) => [field, updated[field]])),
    metadata: { document_code: document.documentCode, changed_via: "ADMIN_API" },
  });

  const messages: string[] = [];
  if (changed.includes("shortname")) {
    messages.push(
      updated.shortname
        ? `หน้าจอจะเรียกเอกสารฉบับนี้ว่า "${updated.shortname}"`
        : `ล้างชื่อสั้นแล้ว หน้าจอจะเรียกเอกสารฉบับนี้ด้วยชื่อเต็ม "${updated.nameTh}"`,
    );
  }
  if (changed.includes("legalNotice")) {
    messages.push(
      updated.legalNotice
        ? "คำเตือนใหม่จะขึ้นในกล่องอ่าน/ลงนามของผู้มีอำนาจ"
        : "ลบคำเตือนแล้ว กล่องอ่าน/ลงนามจะไม่มีบรรทัดเตือนของฉบับนี้",
    );
  }
  if (changed.includes("isRequired")) {
    messages.push(
      updated.isRequired
        ? `${document.documentCode} กลับเป็นเอกสารบังคับแล้ว ผู้มีอำนาจต้องเห็นชอบทุกครั้ง`
        : `${document.documentCode} เป็นเอกสารไม่บังคับแล้ว ผู้มีอำนาจกด "ไม่เกี่ยวข้อง" ข้ามได้`,
    );
  }

  res.json({
    document: updated,
    changed: true,
    changedFields: changed,
    message: messages.join(" · "),
  });
});

adminRouter.get("/legal-documents", async (_req, res) => {
  const documents = await prisma.legalDocument.findMany({
    orderBy: [{ applicationScope: "asc" }, { displayOrder: "asc" }],
    include: { versions: { orderBy: { versionNumber: "desc" } } },
  });
  // ชื่อคนที่เผยแพร่แต่ละฉบับ — หน้า /console แสดงในประวัติเวอร์ชัน (ฉบับที่เผยแพร่ด้วย token เป็นบัญชี SYSTEM "ระบบ")
  const publisherIds = [
    ...new Set(
      documents.flatMap((d) => d.versions.map((v) => v.publishedBy)).filter((id): id is string => Boolean(id)),
    ),
  ];
  const publishers = new Map(
    (
      await prisma.userAccount.findMany({
        where: { id: { in: publisherIds } },
        select: { id: true, email: true, displayName: true, prefixTh: true, firstnameTh: true, lastnameTh: true },
      })
    ).map((u) => [u.id, fullNameTh(u) || u.displayName || u.email]),
  );

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
      /** สามช่องที่ PATCH แก้ได้ — อ่านค่าปัจจุบันจากที่นี่ก่อนสั่งแก้ */
      shortname: doc.shortname,
      legalNotice: doc.legalNotice,
      isRequired: doc.isRequired,
      scope: doc.applicationScope,
      status: doc.status,
      displayOrder: doc.displayOrder,
      versions: doc.versions.map((v) => ({
        id: v.id,
        versionNumber: v.versionNumber,
        status: v.status,
        contentHash: v.contentHash,
        publishedAt: v.publishedAt,
        supersededAt: v.supersededAt,
        publishedBy: v.publishedBy ? (publishers.get(v.publishedBy) ?? null) : null,
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
      actorId: adminActorId(),
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
      // subject เป็นเวอร์ชัน — id ของเอกสารทำให้ค้นคู่กับ LEGAL_DOCUMENT_UPDATED ของเอกสารเดียวกันได้
      metadata: { legal_document_id: published.documentId },
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

/** เวอร์ชันของเอกสารตามรหัส — null ถ้า id ไม่ใช่ uuid หรือไม่ใช่ของเอกสารนี้ */
async function legalVersionOf(code: string, versionId: string) {
  if (!z.string().uuid().safeParse(versionId).success) return null;
  return prisma.legalDocumentVersion.findFirst({
    where: { id: versionId, legalDocument: { documentCode: code } },
    include: { legalDocument: { select: { id: true, documentCode: true, nameTh: true } } },
  });
}

/**
 * ไฟล์ของเวอร์ชันหนึ่ง — `kind=docx` ต้นแบบที่อัปโหลด (ค่าตั้งต้น) หรือ `kind=pdf` ฉบับเปล่าที่แปลงไว้ตอนเผยแพร่
 *
 * ก่อนมีหน้า /console ไม่มีทางเอา .docx ที่เผยแพร่ไปแล้วกลับออกมาเลยนอกจากเข้า storage ตรง ผู้เขียนเอกสารที่จะแก้ฉบับ
 * ถัดไปต้องเริ่มจากไฟล์ใน repo ซึ่งไม่ใช่ฉบับที่ใช้อยู่จริง (CLAUDE.md "The template is a row … not a file in the repo")
 */
adminRouter.get("/legal-documents/:code/versions/:versionId/file", async (req, res) => {
  const code = String(req.params.code ?? "").toUpperCase();
  const version = await legalVersionOf(code, String(req.params.versionId));
  if (!version) {
    res.status(404).json({ error: "not_found", message: "ไม่พบเวอร์ชันนี้ของเอกสาร" });
    return;
  }
  const kind = req.query.kind === "pdf" ? "pdf" : "docx";
  const file =
    kind === "pdf"
      ? await activeAttachment(
          prisma,
          AttachmentOwnerType.LEGAL_DOCUMENT_VERSION,
          version.id,
          AttachmentType.GENERATED_FORM,
        )
      : await templateAttachment(prisma, version.id);
  if (!file) {
    res.status(404).json({ error: "not_found", message: "ไม่พบไฟล์ PDF ของเวอร์ชันนี้" });
    return;
  }
  await logAudit({
    action: AuditAction.DOCUMENT_DOWNLOADED,
    subjectType: AuditSubject.ATTACHMENT,
    subjectId: file.id,
    after: { filename: file.originalFileName, legalDocumentVersionId: version.id, kind },
  });
  await streamAttachment(req, res, file, "attachment");
});

/**
 * เผยแพร่เวอร์ชันเก่าอีกครั้ง — เป็นเวอร์ชันใหม่ N+1 ที่เนื้อไฟล์เหมือนฉบับที่เลือก ไม่ใช่พลิกสถานะของแถวเก่ากลับ
 *
 * แทนการย้อนด้วย SQL ที่ทำไปสองครั้ง (CLAUDE.md "Production carries exactly one version per document") — ทางนั้นลบ
 * เวอร์ชันและย้าย `legal_acceptance` ไปชี้ฉบับอื่น ซึ่งทำได้ก่อนเปิดใช้งานจริงเท่านั้น ที่นี่ไม่มีอะไรถูกลบ: ทุกคนที่เห็นชอบ
 * ฉบับใดไว้ยังชี้ฉบับนั้น และ "เวอร์ชันล่าสุด = ฉบับที่เผยแพร่" ยังจริงเสมอ
 *
 * ผ่าน `publishVersion()` ตัวเดียวกับการอัปโหลด ไฟล์เก่าจึงถูกตรวจ placeholder กับรายชื่อตัวแปรของ**วันนี้** — ฉบับที่ใช้ชื่อ
 * ที่เลิกไปแล้วได้ 400 แทนที่จะกลับมาพิมพ์ช่องว่างบนเอกสารที่มีคนลงนาม
 */
adminRouter.post("/legal-documents/:code/versions/:versionId/restore", async (req, res) => {
  const code = String(req.params.code ?? "").toUpperCase();
  const version = await legalVersionOf(code, String(req.params.versionId));
  if (!version) {
    res.status(404).json({ error: "not_found", message: "ไม่พบเวอร์ชันนี้ของเอกสาร" });
    return;
  }
  const parsed = adminReasonSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "validation", fields: formatZodError(parsed.error) });
    return;
  }
  if (version.status === LegalDocumentVersionStatus.PUBLISHED) {
    res.status(409).json({
      error: "already_current",
      message: `เวอร์ชัน ${version.versionNumber} เป็นฉบับที่เผยแพร่อยู่แล้ว`,
    });
    return;
  }

  const source = await templateAttachment(prisma, version.id);
  const published = await publishVersion(prisma, {
    documentCode: code,
    docx: await readAttachment(source),
    filename: source.originalFileName,
    actorId: adminActorId(),
  });

  await logAudit({
    action: AuditAction.LEGAL_DOCUMENT_PUBLISHED,
    subjectType: AuditSubject.LEGAL_DOCUMENT,
    subjectId: published.versionId,
    after: {
      documentCode: code,
      versionNumber: published.versionNumber,
      filename: source.originalFileName,
      placeholders: published.placeholders,
    },
    metadata: {
      legal_document_id: published.documentId,
      restored_from_version_id: version.id,
      restored_from_version_number: version.versionNumber,
      reason: parsed.data.reason,
    },
  });

  res.status(201).json({
    documentCode: code,
    versionId: published.versionId,
    versionNumber: published.versionNumber,
    restoredFrom: version.versionNumber,
    placeholders: published.placeholders,
    deprecatedPlaceholders: published.deprecatedPlaceholders,
    message: `เผยแพร่เนื้อหาของเวอร์ชัน ${version.versionNumber} อีกครั้งเป็นเวอร์ชัน ${published.versionNumber} แล้ว`,
  });
});

/**
 * ────────────────────────────────────────────────────────── ตัวเลือกในแบบฟอร์มชุดข้อมูล
 *
 * นี่คือทางที่ทำให้ "แก้ตัวเลือกได้โดยไม่ต้องแก้โค้ด" เป็นจริง — เดิมรายการนี้เป็นค่าคงที่
 * ใน `lib/dataset.ts` คู่กับสำเนาใน `frontend/lib/dataset-form.ts` การเพิ่มตัวเลือกหรือ
 * แก้ป้ายสักตัวจึงต้องแก้โค้ดสองไฟล์ merge แล้ว deploy ใหม่ทั้งระบบ
 *
 * ใช้ x-admin-token เหมือน endpoint อื่นในไฟล์นี้ — ยังไม่มีหน้าจอแอดมินในระบบ
 *
 * **ไม่มี DELETE โดยตั้งใจ** คำขอที่บันทึกไปแล้วถือรหัสนั้นอยู่ในคอลัมน์ของมัน และเอกสาร
 * A4 ที่ลงนามแล้วก็พิมพ์ช่องติ๊กของรหัสนั้นไว้ การลบแถวทิ้งจะทำให้คำขอเก่ากลายเป็นคำขอที่
 * ถือค่าที่ระบบไม่รู้จัก — ปิดด้วย `isActive: false` แทน ซึ่งเอาออกจาก dropdown ของคนที่
 * กำลังกรอก โดยที่ของเก่ายังตรวจผ่านและยังพิมพ์ ✔ ได้เหมือนเดิม
 */

/** ช่องที่เพิ่มรหัสใหม่ไม่ได้ เพราะตารางเงื่อนไขในโค้ดตัดสินตัวเลือกของมันเอง */
const RULE_BOUND_FIELDS: Record<string, string> = {
  dataClassification:
    "ระดับชั้นข้อมูล (ข้อ 13.3) ถูกจำกัดด้วยตารางเงื่อนไขในชีท conditions — " +
    "หมวดหมู่ข้อมูลแต่ละหมวดเปิดให้เลือกได้เฉพาะรหัส 01–05 ที่กำหนดไว้ รหัสใหม่จะถูกล้างทิ้ง" +
    "ทุกครั้งที่บันทึก การเพิ่มระดับชั้นต้องแก้ metadataRules() ใน backend/src/lib/dataset.ts ด้วย",
  licenseId:
    "สัญญาอนุญาต (ข้อ 14) ถูกจำกัดด้วยตารางเงื่อนไขในชีท conditions — " +
    "ระดับชั้นข้อมูลแต่ละระดับเปิดให้เลือกได้เฉพาะ G0 / G2 / G5 รหัสใหม่จะถูกล้างทิ้ง" +
    "ทุกครั้งที่บันทึก การเพิ่มสัญญาอนุญาตต้องแก้ metadataRules() ใน backend/src/lib/dataset.ts ด้วย",
};

function parseFieldKey(value: string): ChoiceFieldKey | null {
  return (CHOICE_FIELD_KEYS as readonly string[]).includes(value)
    ? (value as ChoiceFieldKey)
    : null;
}

const unknownField = (value: string) => ({
  error: "not_found",
  message:
    `ไม่มีช่องชื่อ ${value} ในแบบฟอร์มลงทะเบียนชุดข้อมูล ` +
    `ช่องที่มีตัวเลือกให้แก้ได้คือ: ${CHOICE_FIELD_KEYS.join(", ")}`,
});

adminRouter.get("/dataset-choices", async (_req, res) => {
  const rows = await prisma.datasetChoice.findMany({
    orderBy: [{ fieldKey: "asc" }, { displayOrder: "asc" }],
    select: {
      id: true,
      fieldKey: true,
      code: true,
      labelTh: true,
      labelEn: true,
      displayOrder: true,
      isActive: true,
      updatedAt: true,
    },
  });

  // จัดกลุ่มตามช่อง และไล่ตามลำดับที่ฟอร์มถาม ไม่ใช่ตามตัวอักษรของ field_key
  const byField = new Map<string, typeof rows>();
  for (const row of rows) {
    const bucket = byField.get(row.fieldKey);
    if (bucket) bucket.push(row);
    else byField.set(row.fieldKey, [row]);
  }

  res.json({
    fields: CHOICE_FIELD_KEYS.map((fieldKey) => ({
      fieldKey,
      /** ช่องที่เพิ่มรหัสใหม่ไม่ได้ พร้อมเหตุผล — null แปลว่าเพิ่มได้ */
      addRestriction: RULE_BOUND_FIELDS[fieldKey] ?? null,
      choices: (byField.get(fieldKey) ?? []).map((row) => ({
        id: row.id,
        code: row.code,
        labelTh: row.labelTh,
        labelEn: row.labelEn,
        displayOrder: row.displayOrder,
        isActive: row.isActive,
        updatedAt: row.updatedAt,
      })),
    })),
    /**
     * แถวที่ field_key ไม่ใช่ช่องที่โค้ดรู้จัก — ระบบไม่ได้ใช้ แต่บอกไว้ให้เห็น
     * ไม่งั้นแถวที่พิมพ์ชื่อช่องผิดจะหายเงียบและไม่มีใครรู้ว่าทำไมแก้แล้วไม่มีผล
     */
    ignored: rows
      .filter((row) => !parseFieldKey(row.fieldKey))
      .map((row) => ({ id: row.id, fieldKey: row.fieldKey, code: row.code })),
  });
});

/**
 * โหลด cache ใหม่โดยไม่ต้องรีสตาร์ต backend
 *
 * `seed:masters` และการแก้ผ่าน psql เกิดในคนละโปรเซสกับ API แถวที่เปลี่ยนที่นั่นจึงยังไม่
 * เข้า cache ของ API จนกว่าจะรีสตาร์ต — นี่คือคำสั่งที่ใช้แทนการรีสตาร์ต
 * (การแก้ผ่าน endpoint ข้างบนไม่ต้องเรียก ทั้งสองตัวเรียก refreshChoices() ให้เองแล้ว)
 */
adminRouter.post("/dataset-choices/refresh", async (_req, res) => {
  await refreshChoices();
  const { source, count } = choiceStatus();
  res.json({
    source,
    count,
    message:
      source === "database"
        ? `โหลดตัวเลือก ${count} รายการจากฐานข้อมูลแล้ว`
        : `ยังไม่พบตัวเลือกในฐานข้อมูล ระบบใช้ค่าตั้งต้นในโค้ด ${count} รายการอยู่ — กรุณารัน seed:masters`,
  });
});

const newChoiceSchema = z.object({
  code: z
    .string({ error: "กรุณาระบุรหัสของตัวเลือก" })
    .trim()
    .min(1, "กรุณาระบุรหัสของตัวเลือก")
    .max(16, "รหัสต้องยาวไม่เกิน 16 ตัวอักษร"),
  labelTh: z
    .string({ error: "กรุณาระบุป้ายภาษาไทยของตัวเลือก" })
    .trim()
    .min(1, "กรุณาระบุป้ายภาษาไทยของตัวเลือก")
    .max(255, "ป้ายต้องยาวไม่เกิน 255 ตัวอักษร"),
  labelEn: z.string().trim().max(255, "ป้ายต้องยาวไม่เกิน 255 ตัวอักษร").nullable().optional(),
  /** ไม่ระบุ = ต่อท้ายรายการ ซึ่งเป็นที่ที่ตัวเลือกใหม่ควรอยู่จนกว่าจะมีคนสั่งเป็นอย่างอื่น */
  displayOrder: z.number().int("ลำดับต้องเป็นจำนวนเต็ม").min(0, "ลำดับต้องไม่ติดลบ").optional(),
});

adminRouter.post("/dataset-choices/:fieldKey", async (req, res) => {
  const fieldKey = parseFieldKey(String(req.params.fieldKey ?? ""));
  if (!fieldKey) {
    res.status(404).json(unknownField(String(req.params.fieldKey ?? "")));
    return;
  }

  /**
   * ปฏิเสธตั้งแต่ต้นทาง ไม่ใช่ปล่อยให้เพิ่มได้แล้วไปหายตอนบันทึกคำขอ —
   * normaliseMetadata() ล้างรหัสที่อยู่นอกตารางเงื่อนไขทิ้งทุกครั้งที่เขียน ซึ่งจะกลาย
   * เป็นรายงานบั๊ก "เพิ่มรหัสแล้วมันหาย" ที่ไล่หาต้นตอยาก
   */
  const restriction = RULE_BOUND_FIELDS[fieldKey];
  if (restriction) {
    res.status(409).json({ error: "rule_bound_field", message: restriction });
    return;
  }

  const parsed = newChoiceSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "validation", fields: formatZodError(parsed.error) });
    return;
  }

  const existing = await prisma.datasetChoice.findUnique({
    where: { fieldKey_code: { fieldKey, code: parsed.data.code } },
    select: { id: true, labelTh: true, isActive: true },
  });
  if (existing) {
    res.status(409).json({
      error: "code_exists",
      message:
        `ช่องนี้มีรหัส ${parsed.data.code} อยู่แล้ว ("${existing.labelTh}"` +
        `${existing.isActive ? "" : " — ปิดอยู่"}) ` +
        `ถ้าต้องการแก้ป้ายหรือเปิดใช้งานอีกครั้ง ให้ใช้ PATCH แทน`,
    });
    return;
  }

  const last = await prisma.datasetChoice.findFirst({
    where: { fieldKey },
    orderBy: { displayOrder: "desc" },
    select: { displayOrder: true },
  });

  const created = await prisma.datasetChoice.create({
    data: {
      fieldKey,
      code: parsed.data.code,
      labelTh: parsed.data.labelTh,
      labelEn: parsed.data.labelEn ?? null,
      displayOrder: parsed.data.displayOrder ?? (last?.displayOrder ?? 0) + 1,
      createdBy: adminActorId(),
      updatedBy: adminActorId(),
    },
    select: {
      id: true,
      fieldKey: true,
      code: true,
      labelTh: true,
      labelEn: true,
      displayOrder: true,
      isActive: true,
    },
  });

  await logAudit({
    action: AuditAction.DATASET_CHOICE_CHANGED,
    subjectType: AuditSubject.DATASET_CHOICE,
    subjectId: created.id,
    after: created,
    metadata: { field_key: fieldKey, code: created.code, changed_via: "ADMIN_API", operation: "CREATE" },
  });

  await refreshChoices();

  res.status(201).json({
    choice: created,
    message:
      `เพิ่มตัวเลือก "${created.labelTh}" (รหัส ${created.code}) แล้ว ` +
      `หน้าฟอร์มจะเห็นทันที ส่วนช่องติ๊ก {{tick.${fieldKey}.${created.code}}} ใช้ในเอกสารได้แล้ว ` +
      `แต่ยังต้องเพิ่มบรรทัดของมันในไฟล์ A4.docx แล้วอัปโหลดเวอร์ชันใหม่ด้วย`,
  });
});

const patchChoiceSchema = z
  .object({
    labelTh: z.string().trim().min(1, "ป้ายภาษาไทยห้ามว่าง").max(255, "ป้ายต้องยาวไม่เกิน 255 ตัวอักษร").optional(),
    labelEn: z.string().trim().max(255, "ป้ายต้องยาวไม่เกิน 255 ตัวอักษร").nullable().optional(),
    displayOrder: z.number().int("ลำดับต้องเป็นจำนวนเต็ม").min(0, "ลำดับต้องไม่ติดลบ").optional(),
    isActive: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    error: "ไม่มีอะไรให้แก้ — ระบุอย่างน้อยหนึ่งใน labelTh, labelEn, displayOrder, isActive",
  });

adminRouter.patch("/dataset-choices/:fieldKey/:code", async (req, res) => {
  const fieldKey = parseFieldKey(String(req.params.fieldKey ?? ""));
  if (!fieldKey) {
    res.status(404).json(unknownField(String(req.params.fieldKey ?? "")));
    return;
  }
  const code = String(req.params.code ?? "");

  const parsed = patchChoiceSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "validation", fields: formatZodError(parsed.error) });
    return;
  }

  const before = await prisma.datasetChoice.findUnique({
    where: { fieldKey_code: { fieldKey, code } },
    select: {
      id: true,
      fieldKey: true,
      code: true,
      labelTh: true,
      labelEn: true,
      displayOrder: true,
      isActive: true,
    },
  });
  if (!before) {
    res.status(404).json({
      error: "not_found",
      message: `ไม่มีรหัส ${code} ในช่อง ${fieldKey}`,
    });
    return;
  }

  const after = await prisma.datasetChoice.update({
    where: { id: before.id },
    data: { ...parsed.data, updatedBy: adminActorId() },
    select: {
      id: true,
      fieldKey: true,
      code: true,
      labelTh: true,
      labelEn: true,
      displayOrder: true,
      isActive: true,
    },
  });

  await logAudit({
    action: AuditAction.DATASET_CHOICE_CHANGED,
    subjectType: AuditSubject.DATASET_CHOICE,
    subjectId: before.id,
    before,
    after,
    metadata: { field_key: fieldKey, code, changed_via: "ADMIN_API", operation: "UPDATE" },
  });

  await refreshChoices();

  const notes: string[] = [];
  if (before.isActive && !after.isActive) {
    notes.push(
      `ตัวเลือกนี้หายจากฟอร์มแล้ว แต่คำขอที่เลือกไว้ก่อนหน้ายังนำส่งได้และยังพิมพ์ ✔ ได้ตามเดิม`,
    );
  }
  if (!before.isActive && after.isActive) notes.push("ตัวเลือกนี้กลับมาให้เลือกในฟอร์มแล้ว");
  if (before.labelTh !== after.labelTh) {
    notes.push(
      `ป้ายใหม่จะขึ้นกับคำขอทุกฉบับที่ถือรหัสนี้ รวมถึงฉบับที่อนุมัติไปแล้ว — ` +
        `ส่วนข้อความในไฟล์ A4.docx เป็นของฝ่ายกฎหมาย ต้องแก้แล้วอัปโหลดแยกต่างหาก`,
    );
  }

  res.json({ choice: after, message: notes.join(" · ") || "บันทึกแล้ว" });
});
