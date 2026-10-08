/**
 * Admin API ของตาราง master ที่อยู่ — จังหวัด / อำเภอ / ตำบล (`administration.*`)
 *
 *   GET   /api/admin/addresses/provinces                 ทุกจังหวัด รวมที่ปิดอยู่
 *   GET   /api/admin/addresses/provinces/:code           จังหวัดหนึ่ง + อำเภอข้างใต้
 *   GET   /api/admin/addresses/districts/:code           อำเภอหนึ่ง + ตำบลข้างใต้
 *   GET   /api/admin/addresses/sub-districts/:code       ตำบลหนึ่ง
 *   GET   /api/admin/addresses/search?q=พญาไท             หาตามชื่อหรือรหัส ทุกระดับ
 *   POST  /api/admin/addresses/{provinces|districts|sub-districts}
 *   PATCH /api/admin/addresses/{provinces|districts|sub-districts}/:code
 *   POST  /api/admin/addresses/refresh                   โหลด cache ใหม่หลังแก้ตารางด้วยมือ
 *
 * ## ไม่มี DELETE — ปิดด้วย isActive แทน
 *
 * `organization` และ `organization_registration_request` เก็บรหัสที่อยู่โดยไม่มี FK การลบแถว
 * จะทิ้งรหัสที่ไม่มีชื่อไว้ในทุกแถวที่อ้างอยู่ ที่อยู่ของหน่วยงานเหล่านั้นจะแสดงเป็นค่าว่างทั้งบน
 * หน้าจอและใน PDF รายการที่ปิดจะหายจาก dropdown แต่ที่อยู่ที่บันทึกไว้แล้วยังอ่านและนำส่งได้
 *
 * ## รหัสแก้ไม่ได้
 *
 * รหัสคือสิ่งที่แถวของหน่วยงานถืออยู่ การเปลี่ยนรหัสต้องย้ายข้อมูลทุกแถวที่อ้างไปด้วย ซึ่งเป็นงาน
 * migration ไม่ใช่งานของ endpoint (ดู backend/scripts/build-address-data.mjs) — แก้ได้แค่ชื่อ
 * รหัสไปรษณีย์ และสถานะเปิด/ปิด รหัสของรายการใหม่ต้องเป็นรหัสกรมการปกครองและขึ้นต้นด้วยรหัสของแม่
 */
import { z } from "zod";

import { prisma } from "../db.js";
import { addressStatus, refreshAddresses } from "../lib/address.js";
import { Router } from "../lib/async-route.js";
import { AuditAction, AuditSubject, logAudit } from "../lib/audit.js";
import { formatZodError } from "../lib/validation.js";
import { requireAdmin } from "../middleware/auth.js";

export const adminAddressRouter = Router();
adminAddressRouter.use(requireAdmin);

type Level = "province" | "district" | "subDistrict";

const LEVEL_LABEL: Record<Level, string> = { province: "จังหวัด", district: "อำเภอ/เขต", subDistrict: "ตำบล/แขวง" };

const nameTh = z
  .string({ error: "กรุณาระบุชื่อภาษาไทย" })
  .trim()
  .min(1, "กรุณาระบุชื่อภาษาไทย")
  .max(255, "ชื่อต้องยาวไม่เกิน 255 ตัวอักษร");
const nameEn = z.string().trim().max(255, "ชื่อต้องยาวไม่เกิน 255 ตัวอักษร").nullable().optional();
const postalCode = z
  .string()
  .trim()
  .regex(/^\d{5}$/, "รหัสไปรษณีย์ต้องเป็นตัวเลข 5 หลัก")
  .nullable()
  .optional();

/** ใช้นับว่ารายการนี้ถูกอ้างอยู่กี่แถว — แสดงก่อนแอดมินเปลี่ยนชื่อหรือปิด */
async function usage(level: Level, code: string): Promise<{ organizations: number; registrationRequests: number }> {
  const [organizations, registrationRequests] = await Promise.all([
    prisma.organization.count({
      where:
        level === "province"
          ? { provinceCode: code }
          : level === "district"
            ? { districtCode: code }
            : { subDistrictCode: code },
    }),
    prisma.organizationRegistrationRequest.count({
      where:
        level === "province"
          ? { organizationProvinceCode: code }
          : level === "district"
            ? { organizationDistrictCode: code }
            : { organizationSubdistrictCode: code },
    }),
  ]);
  return { organizations, registrationRequests };
}

async function recordChange(
  level: Level,
  code: string,
  operation: "CREATE" | "UPDATE",
  before: unknown,
  after: unknown,
) {
  await logAudit({
    action: AuditAction.ADDRESS_MASTER_CHANGED,
    subjectType: AuditSubject.ADDRESS_MASTER,
    before,
    after,
    metadata: { level, code, changed_via: "ADMIN_API", operation },
  });
  await refreshAddresses();
}

const notFound = (level: Level, code: string) => ({
  error: "not_found",
  message: `ไม่มี${LEVEL_LABEL[level]}รหัส ${code}`,
});

const duplicateName = (level: Level, name: string, existingCode: string) => ({
  error: "validation",
  fields: {
    nameTh:
      `มี${LEVEL_LABEL[level]}ชื่อ "${name}" (รหัส ${existingCode}) อยู่ในระดับเดียวกันแล้ว — ` +
      "ฟอร์มส่งที่อยู่มาเป็นชื่อ ชื่อซ้ำจะทำให้ระบบเลือกรหัสผิดตัว ถ้าต้องการเปิดรายการเดิมอีกครั้งให้ใช้ PATCH",
  },
});

// ─────────────────────────────────────────────────────────── อ่าน

adminAddressRouter.get("/provinces", async (_req, res) => {
  const provinces = await prisma.province.findMany({
    orderBy: { code: "asc" },
    select: { code: true, nameTh: true, nameEn: true, isActive: true, _count: { select: { districts: true } } },
  });
  res.json({
    provinces: provinces.map(({ _count, ...p }) => ({ ...p, districtCount: _count.districts })),
  });
});

adminAddressRouter.get("/provinces/:code", async (req, res) => {
  const code = String(req.params.code);
  const province = await prisma.province.findUnique({
    where: { code },
    select: {
      code: true,
      nameTh: true,
      nameEn: true,
      isActive: true,
      districts: {
        orderBy: { code: "asc" },
        select: { code: true, nameTh: true, nameEn: true, isActive: true, _count: { select: { subDistricts: true } } },
      },
    },
  });
  if (!province) {
    res.status(404).json(notFound("province", code));
    return;
  }
  const { districts, ...rest } = province;
  res.json({
    province: rest,
    usage: await usage("province", code),
    districts: districts.map(({ _count, ...d }) => ({ ...d, subDistrictCount: _count.subDistricts })),
  });
});

adminAddressRouter.get("/districts/:code", async (req, res) => {
  const code = String(req.params.code);
  const district = await prisma.district.findUnique({
    where: { code },
    select: {
      code: true,
      nameTh: true,
      nameEn: true,
      isActive: true,
      province: { select: { code: true, nameTh: true, isActive: true } },
      subDistricts: {
        orderBy: { code: "asc" },
        select: { code: true, nameTh: true, nameEn: true, postalCode: true, isActive: true },
      },
    },
  });
  if (!district) {
    res.status(404).json(notFound("district", code));
    return;
  }
  const { subDistricts, ...rest } = district;
  res.json({ district: rest, usage: await usage("district", code), subDistricts });
});

adminAddressRouter.get("/sub-districts/:code", async (req, res) => {
  const code = String(req.params.code);
  const subDistrict = await prisma.subDistrict.findUnique({
    where: { code },
    select: {
      code: true,
      nameTh: true,
      nameEn: true,
      postalCode: true,
      isActive: true,
      district: {
        select: {
          code: true,
          nameTh: true,
          isActive: true,
          province: { select: { code: true, nameTh: true, isActive: true } },
        },
      },
    },
  });
  if (!subDistrict) {
    res.status(404).json(notFound("subDistrict", code));
    return;
  }
  res.json({ subDistrict, usage: await usage("subDistrict", code) });
});

adminAddressRouter.get("/search", async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  if (q.length < 2) {
    res.status(400).json({ error: "validation", fields: { q: "กรุณาพิมพ์ชื่อหรือรหัสอย่างน้อย 2 ตัวอักษร" } });
    return;
  }
  const where = { OR: [{ nameTh: { contains: q } }, { nameEn: { contains: q, mode: "insensitive" as const } }, { code: q }] };
  const take = 50;
  const [provinces, districts, subDistricts] = await Promise.all([
    prisma.province.findMany({ where, take, orderBy: { code: "asc" }, select: { code: true, nameTh: true, isActive: true } }),
    prisma.district.findMany({
      where,
      take,
      orderBy: { code: "asc" },
      select: { code: true, nameTh: true, isActive: true, province: { select: { code: true, nameTh: true } } },
    }),
    prisma.subDistrict.findMany({
      where,
      take,
      orderBy: { code: "asc" },
      select: {
        code: true,
        nameTh: true,
        postalCode: true,
        isActive: true,
        district: { select: { code: true, nameTh: true, province: { select: { code: true, nameTh: true } } } },
      },
    }),
  ]);
  res.json({ provinces, districts, subDistricts, limitPerLevel: take });
});

/**
 * โหลด cache ใหม่โดยไม่ต้องรีสตาร์ต backend — ใช้หลังแก้ตารางด้วย psql หรือหลังรัน seed:masters
 * (การแก้ผ่าน endpoint ในไฟล์นี้โหลดใหม่ให้เองแล้ว)
 */
adminAddressRouter.post("/refresh", async (_req, res) => {
  await refreshAddresses();
  res.json(addressStatus());
});

// ─────────────────────────────────────────────────────────── เพิ่ม

const newProvinceSchema = z.object({
  code: z.string({ error: "กรุณาระบุรหัสจังหวัด" }).trim().regex(/^\d{2}$/, "รหัสจังหวัดต้องเป็นตัวเลข 2 หลักตามกรมการปกครอง"),
  nameTh,
  nameEn,
});

adminAddressRouter.post("/provinces", async (req, res) => {
  const parsed = newProvinceSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "validation", fields: formatZodError(parsed.error) });
    return;
  }
  const { code } = parsed.data;

  if (await prisma.province.findUnique({ where: { code }, select: { code: true } })) {
    res.status(409).json({ error: "code_exists", message: `มีจังหวัดรหัส ${code} อยู่แล้ว ถ้าต้องการแก้ให้ใช้ PATCH` });
    return;
  }
  const clash = await prisma.province.findFirst({ where: { nameTh: parsed.data.nameTh }, select: { code: true } });
  if (clash) {
    res.status(409).json(duplicateName("province", parsed.data.nameTh, clash.code));
    return;
  }

  const created = await prisma.province.create({
    data: { code, nameTh: parsed.data.nameTh, nameEn: parsed.data.nameEn ?? null },
    select: { code: true, nameTh: true, nameEn: true, isActive: true },
  });
  await recordChange("province", code, "CREATE", undefined, created);
  res.status(201).json({ province: created, message: `เพิ่มจังหวัด "${created.nameTh}" (รหัส ${code}) แล้ว` });
});

const newDistrictSchema = z
  .object({
    code: z.string({ error: "กรุณาระบุรหัสอำเภอ" }).trim().regex(/^\d{4}$/, "รหัสอำเภอต้องเป็นตัวเลข 4 หลักตามกรมการปกครอง"),
    provinceCode: z.string({ error: "กรุณาระบุรหัสจังหวัดที่อำเภอนี้สังกัด" }).trim().min(1, "กรุณาระบุรหัสจังหวัดที่อำเภอนี้สังกัด"),
    nameTh,
    nameEn,
  })
  .refine((body) => body.code.startsWith(body.provinceCode), {
    path: ["code"],
    error: "รหัสอำเภอต้องขึ้นต้นด้วยรหัสจังหวัดที่สังกัด",
  });

adminAddressRouter.post("/districts", async (req, res) => {
  const parsed = newDistrictSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "validation", fields: formatZodError(parsed.error) });
    return;
  }
  const { code, provinceCode } = parsed.data;

  if (!(await prisma.province.findUnique({ where: { code: provinceCode }, select: { code: true } }))) {
    res.status(400).json({ error: "validation", fields: { provinceCode: `ไม่มีจังหวัดรหัส ${provinceCode}` } });
    return;
  }
  if (await prisma.district.findUnique({ where: { code }, select: { code: true } })) {
    res.status(409).json({ error: "code_exists", message: `มีอำเภอรหัส ${code} อยู่แล้ว ถ้าต้องการแก้ให้ใช้ PATCH` });
    return;
  }
  const clash = await prisma.district.findFirst({
    where: { provinceCode, nameTh: parsed.data.nameTh },
    select: { code: true },
  });
  if (clash) {
    res.status(409).json(duplicateName("district", parsed.data.nameTh, clash.code));
    return;
  }

  const created = await prisma.district.create({
    data: { code, provinceCode, nameTh: parsed.data.nameTh, nameEn: parsed.data.nameEn ?? null },
    select: { code: true, nameTh: true, nameEn: true, isActive: true, provinceCode: true },
  });
  await recordChange("district", code, "CREATE", undefined, created);
  res.status(201).json({ district: created, message: `เพิ่มอำเภอ "${created.nameTh}" (รหัส ${code}) แล้ว` });
});

const newSubDistrictSchema = z
  .object({
    code: z.string({ error: "กรุณาระบุรหัสตำบล" }).trim().regex(/^\d{6}$/, "รหัสตำบลต้องเป็นตัวเลข 6 หลักตามกรมการปกครอง"),
    districtCode: z.string({ error: "กรุณาระบุรหัสอำเภอที่ตำบลนี้สังกัด" }).trim().min(1, "กรุณาระบุรหัสอำเภอที่ตำบลนี้สังกัด"),
    nameTh,
    nameEn,
    postalCode,
  })
  .refine((body) => body.code.startsWith(body.districtCode), {
    path: ["code"],
    error: "รหัสตำบลต้องขึ้นต้นด้วยรหัสอำเภอที่สังกัด",
  });

adminAddressRouter.post("/sub-districts", async (req, res) => {
  const parsed = newSubDistrictSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "validation", fields: formatZodError(parsed.error) });
    return;
  }
  const { code, districtCode } = parsed.data;

  if (!(await prisma.district.findUnique({ where: { code: districtCode }, select: { code: true } }))) {
    res.status(400).json({ error: "validation", fields: { districtCode: `ไม่มีอำเภอรหัส ${districtCode}` } });
    return;
  }
  if (await prisma.subDistrict.findUnique({ where: { code }, select: { code: true } })) {
    res.status(409).json({ error: "code_exists", message: `มีตำบลรหัส ${code} อยู่แล้ว ถ้าต้องการแก้ให้ใช้ PATCH` });
    return;
  }
  const clash = await prisma.subDistrict.findFirst({
    where: { districtCode, nameTh: parsed.data.nameTh },
    select: { code: true },
  });
  if (clash) {
    res.status(409).json(duplicateName("subDistrict", parsed.data.nameTh, clash.code));
    return;
  }

  const created = await prisma.subDistrict.create({
    data: {
      code,
      districtCode,
      nameTh: parsed.data.nameTh,
      nameEn: parsed.data.nameEn ?? null,
      postalCode: parsed.data.postalCode ?? null,
    },
    select: { code: true, nameTh: true, nameEn: true, postalCode: true, isActive: true, districtCode: true },
  });
  await recordChange("subDistrict", code, "CREATE", undefined, created);
  res.status(201).json({ subDistrict: created, message: `เพิ่มตำบล "${created.nameTh}" (รหัส ${code}) แล้ว` });
});

// ─────────────────────────────────────────────────────────── แก้

const nothingToChange = { error: "ไม่มีอะไรให้แก้ — ระบุอย่างน้อยหนึ่งช่อง" };

const immutable = {
  error: "แก้ได้เฉพาะ nameTh, nameEn, isActive (และ postalCode ของตำบล) — รหัสและสังกัดแก้ผ่าน API ไม่ได้ ดูหัวไฟล์ admin-addresses.ts",
};

const patchSchema = z
  .strictObject(
    { nameTh: nameTh.optional(), nameEn, isActive: z.boolean({ error: "isActive ต้องเป็น true หรือ false" }).optional() },
    immutable,
  )
  .refine((body) => Object.keys(body).length > 0, nothingToChange);

const patchSubDistrictSchema = z
  .strictObject(
    {
      nameTh: nameTh.optional(),
      nameEn,
      postalCode,
      isActive: z.boolean({ error: "isActive ต้องเป็น true หรือ false" }).optional(),
    },
    immutable,
  )
  .refine((body) => Object.keys(body).length > 0, nothingToChange);

/** ข้อความที่บอกแอดมินว่าการแก้นี้กระทบใครบ้าง */
function impactNotes(
  before: { nameTh: string; isActive: boolean },
  after: { nameTh: string; isActive: boolean },
  used: { organizations: number; registrationRequests: number },
): string {
  const notes: string[] = [];
  const unused = used.organizations === 0 && used.registrationRequests === 0;
  const refs = `หน่วยงาน ${used.organizations} แห่งและคำขอลงทะเบียน ${used.registrationRequests} ฉบับ`;
  if (unused && (before.nameTh !== after.nameTh || before.isActive !== after.isActive)) {
    notes.push("ยังไม่มีหน่วยงานหรือคำขอลงทะเบียนใดอ้างรายการนี้");
    if (!before.isActive && after.isActive) notes.push("รายการนี้กลับมาให้เลือกในฟอร์มแล้ว");
    if (before.isActive && !after.isActive) notes.push("รายการนี้หายจาก dropdown แล้ว");
    return notes.join(" · ");
  }
  if (before.nameTh !== after.nameTh) {
    notes.push(`ชื่อใหม่จะแสดงในที่อยู่ของ${refs}ที่อ้างรหัสนี้ทันที รวมถึงเอกสารที่สร้างใหม่หลังจากนี้`);
  }
  if (before.isActive && !after.isActive) {
    notes.push(`รายการนี้หายจาก dropdown แล้ว แต่${refs}ที่เลือกไว้ก่อนหน้ายังอ่านและนำส่งได้ตามเดิม`);
  }
  if (!before.isActive && after.isActive) notes.push("รายการนี้กลับมาให้เลือกในฟอร์มแล้ว");
  return notes.join(" · ") || "บันทึกแล้ว";
}

adminAddressRouter.patch("/provinces/:code", async (req, res) => {
  const code = String(req.params.code);
  const parsed = patchSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "validation", fields: formatZodError(parsed.error) });
    return;
  }
  const select = { code: true, nameTh: true, nameEn: true, isActive: true } as const;
  const before = await prisma.province.findUnique({ where: { code }, select });
  if (!before) {
    res.status(404).json(notFound("province", code));
    return;
  }
  if (parsed.data.nameTh && parsed.data.nameTh !== before.nameTh) {
    const clash = await prisma.province.findFirst({ where: { nameTh: parsed.data.nameTh, NOT: { code } }, select: { code: true } });
    if (clash) {
      res.status(409).json(duplicateName("province", parsed.data.nameTh, clash.code));
      return;
    }
  }
  const after = await prisma.province.update({ where: { code }, data: parsed.data, select });
  await recordChange("province", code, "UPDATE", before, after);
  res.json({ province: after, message: impactNotes(before, after, await usage("province", code)) });
});

adminAddressRouter.patch("/districts/:code", async (req, res) => {
  const code = String(req.params.code);
  const parsed = patchSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "validation", fields: formatZodError(parsed.error) });
    return;
  }
  const select = { code: true, nameTh: true, nameEn: true, isActive: true, provinceCode: true } as const;
  const before = await prisma.district.findUnique({ where: { code }, select });
  if (!before) {
    res.status(404).json(notFound("district", code));
    return;
  }
  if (parsed.data.nameTh && parsed.data.nameTh !== before.nameTh) {
    const clash = await prisma.district.findFirst({
      where: { provinceCode: before.provinceCode, nameTh: parsed.data.nameTh, NOT: { code } },
      select: { code: true },
    });
    if (clash) {
      res.status(409).json(duplicateName("district", parsed.data.nameTh, clash.code));
      return;
    }
  }
  const after = await prisma.district.update({ where: { code }, data: parsed.data, select });
  await recordChange("district", code, "UPDATE", before, after);
  res.json({ district: after, message: impactNotes(before, after, await usage("district", code)) });
});

adminAddressRouter.patch("/sub-districts/:code", async (req, res) => {
  const code = String(req.params.code);
  const parsed = patchSubDistrictSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "validation", fields: formatZodError(parsed.error) });
    return;
  }
  const select = {
    code: true,
    nameTh: true,
    nameEn: true,
    postalCode: true,
    isActive: true,
    districtCode: true,
  } as const;
  const before = await prisma.subDistrict.findUnique({ where: { code }, select });
  if (!before) {
    res.status(404).json(notFound("subDistrict", code));
    return;
  }
  if (parsed.data.nameTh && parsed.data.nameTh !== before.nameTh) {
    const clash = await prisma.subDistrict.findFirst({
      where: { districtCode: before.districtCode, nameTh: parsed.data.nameTh, NOT: { code } },
      select: { code: true },
    });
    if (clash) {
      res.status(409).json(duplicateName("subDistrict", parsed.data.nameTh, clash.code));
      return;
    }
  }
  const after = await prisma.subDistrict.update({ where: { code }, data: parsed.data, select });
  await recordChange("subDistrict", code, "UPDATE", before, after);

  let message = impactNotes(before, after, await usage("subDistrict", code));
  if (before.postalCode !== after.postalCode) {
    message +=
      " · รหัสไปรษณีย์ใหม่ใช้กับการเลือกตำบลครั้งต่อไป ที่อยู่ที่บันทึกไว้แล้วเก็บรหัสไปรษณีย์ของตัวเองไว้ ไม่เปลี่ยนตาม";
  }
  res.json({ subDistrict: after, message });
});
