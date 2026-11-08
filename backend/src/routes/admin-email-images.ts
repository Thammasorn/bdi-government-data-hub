/**
 * รูปภาพในอีเมล — `/api/admin/email-images` (หน้า /console → ตั้งค่า › รูปภาพในอีเมล, การ์ด "[New Feature] Admin Email Template Edit")
 *
 * ที่เดียวที่ผู้ดูแลระบบเปลี่ยนรูปที่อีเมลใช้ รวมโลโก้ เทมเพลตอ้างรูปด้วย `{{image.<code>}}` เปลี่ยนไฟล์ที่นี่แล้วอีเมลทุกฉบับที่อ้างรูปนั้น
 * ได้ไฟล์ใหม่ทันที ผู้ดูแลระบบเท่านั้น (`requireAdmin`)
 *
 * ```
 * GET    /                 ทุกรูป + เทมเพลตที่ใช้อยู่
 * GET    /:code/file       ไฟล์ของรูป (รูปย่อบนหน้าจอ)
 * POST   /                 เพิ่มรูป — multipart: code, name, altText, displayWidth, file
 * PUT    /:code            แก้ชื่อ คำอธิบาย ความกว้าง และ/หรือเปลี่ยนไฟล์ — multipart
 * DELETE /:code            ลบรูป {reason} — ไม่ได้ถ้าเป็นโลโก้ หรือเทมเพลตยังอ้างอยู่
 * POST   /logo/reset       โลโก้กลับเป็นไฟล์ตั้งต้นในโค้ด {reason}
 * ```
 */
import type { Response } from "express";
import multer from "multer";
import { z } from "zod";

import { prisma } from "../db.js";
import { Router } from "../lib/async-route.js";
import { AuditAction, AuditSubject, logAudit } from "../lib/audit.js";
import { adminActorId } from "../lib/context.js";
import { TEMPLATES } from "../lib/email/catalogue.js";
import {
  DISPLAY_WIDTH_MAX,
  DISPLAY_WIDTH_MIN,
  IMAGE_CODE,
  LOGO_CODE,
  LOGO_DEFAULT_META,
  MAX_IMAGE_BYTES,
  detectImageType,
  imageDimensions,
  imageFile,
  listImages,
  referencedImages,
  sha256,
} from "../lib/email/images.js";
import { logo as defaultLogo } from "../lib/email/blocks.js";
import { fullNameTh } from "../lib/person-name.js";
import { requireAdmin } from "../middleware/auth.js";

export const adminEmailImageRouter = Router();
adminEmailImageRouter.use(requireAdmin);

// ขีดจำกัดของ multer สูงกว่าเพดานจริงเล็กน้อย — ไฟล์ที่เกินเพดานได้ข้อความภาษาไทยจาก handler ไม่ใช่ MulterError
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_IMAGE_BYTES * 4, files: 1 } });

const metaSchema = z.object({
  name: z.string().trim().min(1, "กรุณาใส่ชื่อรูป").max(200),
  altText: z.string().trim().min(1, "กรุณาใส่คำอธิบายรูป (แสดงเมื่อเมลไคลเอนต์ไม่โหลดรูป)").max(300),
  displayWidth: z.coerce
    .number()
    .int("ความกว้างต้องเป็นจำนวนเต็ม")
    .min(DISPLAY_WIDTH_MIN, `ความกว้างต้องอยู่ระหว่าง ${DISPLAY_WIDTH_MIN}–${DISPLAY_WIDTH_MAX} px`)
    .max(DISPLAY_WIDTH_MAX, `ความกว้างต้องอยู่ระหว่าง ${DISPLAY_WIDTH_MIN}–${DISPLAY_WIDTH_MAX} px`),
});
const createSchema = metaSchema.extend({
  code: z
    .string()
    .trim()
    .regex(IMAGE_CODE, "รหัสรูปใช้ a–z ตัวเล็ก ตัวเลข และ _ ขึ้นต้นด้วยตัวอักษร 2–40 ตัว เช่น banner, seal_2569"),
});
const reasonSchema = z.object({ reason: z.string().trim().min(10, "กรุณาระบุเหตุผลอย่างน้อย 10 ตัวอักษร").max(500) });

/** Prisma เก็บ `Bytes` เป็น `Uint8Array<ArrayBuffer>` — Buffer ของ multer อาจอยู่บน buffer ที่ใช้ร่วมกัน จึงคัดลอกออกมา */
const toBytes = (buf: Buffer): Uint8Array<ArrayBuffer> => new Uint8Array(buf);

function fail(res: Response, status: number, error: string, message: string, extra: Record<string, unknown> = {}) {
  res.status(status).json({ error, message, ...extra });
}

function zodFail(res: Response, err: z.ZodError) {
  const fields: Record<string, string> = {};
  for (const issue of err.issues) fields[String(issue.path[0] ?? "body")] ??= issue.message;
  fail(res, 400, "validation", Object.values(fields)[0] ?? "ข้อมูลไม่ถูกต้อง", { fields });
}

/** ตรวจไฟล์ที่อัปโหลด — ชนิดจากไบต์แรก (ไม่เชื่อ mimetype ของเบราว์เซอร์) ขนาด และอ่านขนาดภาพได้ */
function checkFile(file: Express.Multer.File): { error: string } | {
  content: Buffer;
  contentType: string;
  widthPx: number;
  heightPx: number;
} {
  if (file.size > MAX_IMAGE_BYTES) {
    return { error: `ไฟล์ใหญ่ ${(file.size / 1024).toFixed(0)} KB — ต้องไม่เกิน ${MAX_IMAGE_BYTES / 1024} KB (อีเมลที่ใหญ่ถูก Gmail ตัด)` };
  }
  const contentType = detectImageType(file.buffer);
  if (!contentType) return { error: "ใช้ได้เฉพาะไฟล์ PNG หรือ JPG" };
  const dims = imageDimensions(file.buffer, contentType);
  if (!dims || dims.width < 1 || dims.height < 1) return { error: "อ่านขนาดของรูปไม่ได้ — ไฟล์อาจเสีย ลองบันทึกใหม่เป็น PNG" };
  return { content: file.buffer, contentType, widthPx: dims.width, heightPx: dims.height };
}

/** เทมเพลตที่อ้างรูปแต่ละรูป — ฉบับที่ใช้งานอยู่และฉบับร่าง (เทมเพลตที่ไม่มีแถวใช้เนื้อหาตั้งต้น) */
async function usageByImage(): Promise<Map<string, Array<{ key: string; label: string; status: "PUBLISHED" | "DRAFT" }>>> {
  const rows = await prisma.emailTemplateVersion.findMany({
    where: { status: { in: ["PUBLISHED", "DRAFT"] } },
    select: { templateKey: true, status: true, bodyHtml: true, footnoteHtml: true },
  });
  const usage = new Map<string, Array<{ key: string; label: string; status: "PUBLISHED" | "DRAFT" }>>();
  const add = (code: string, key: string, label: string, status: "PUBLISHED" | "DRAFT") => {
    const list = usage.get(code) ?? [];
    if (!list.some((u) => u.key === key && u.status === status)) list.push({ key, label, status });
    usage.set(code, list);
  };
  for (const def of TEMPLATES) {
    const mine = rows.filter((r) => r.templateKey === def.key);
    const versions = mine.length
      ? mine.map((r) => ({ status: r.status as "PUBLISHED" | "DRAFT", body: r.bodyHtml, foot: r.footnoteHtml }))
      : [{ status: "PUBLISHED" as const, body: def.defaults.bodyHtml, foot: def.defaults.footnoteHtml }];
    for (const v of versions) for (const code of referencedImages(v.body, v.foot)) add(code, def.key, def.label, v.status);
  }
  return usage;
}

async function namesFor(ids: Array<string | null>): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (!unique.length) return new Map();
  const people = await prisma.userAccount.findMany({
    where: { id: { in: unique } },
    select: { id: true, email: true, displayName: true, prefixTh: true, firstnameTh: true, lastnameTh: true },
  });
  return new Map(people.map((p) => [p.id, fullNameTh(p) || p.displayName || p.email]));
}

adminEmailImageRouter.get("/", async (_req, res) => {
  const [images, usage] = await Promise.all([listImages(prisma), usageByImage()]);
  const names = await namesFor(images.map((i) => i.updatedBy));
  res.json({
    images: images.map((i) => ({
      ...i,
      updatedBy: i.updatedBy ? (names.get(i.updatedBy) ?? null) : null,
      usedBy: usage.get(i.code) ?? [],
    })),
    limits: { maxBytes: MAX_IMAGE_BYTES, displayWidthMin: DISPLAY_WIDTH_MIN, displayWidthMax: DISPLAY_WIDTH_MAX },
  });
});

adminEmailImageRouter.get("/:code/file", async (req, res) => {
  const file = await imageFile(prisma, String(req.params.code));
  if (!file) {
    fail(res, 404, "not_found", "ไม่มีรูปนี้");
    return;
  }
  res.setHeader("Content-Type", file.contentType);
  res.setHeader("Cache-Control", "no-store");
  res.send(file.content);
});

adminEmailImageRouter.post("/", upload.single("file"), async (req, res) => {
  const parsed = createSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    zodFail(res, parsed.error);
    return;
  }
  if (!req.file) {
    fail(res, 400, "validation", "กรุณาเลือกไฟล์รูป", { fields: { file: "กรุณาเลือกไฟล์รูป" } });
    return;
  }
  const checked = checkFile(req.file);
  if ("error" in checked) {
    fail(res, 400, "validation", checked.error, { fields: { file: checked.error } });
    return;
  }
  const { code, ...meta } = parsed.data;
  if (code === LOGO_CODE || (await prisma.emailImage.findUnique({ where: { code }, select: { code: true } }))) {
    fail(res, 409, "code_exists", `มีรูปรหัส ${code} อยู่แล้ว — ใช้รหัสอื่น หรือเปลี่ยนไฟล์ของรูปเดิม`, {
      fields: { code: "รหัสนี้ถูกใช้แล้ว" },
    });
    return;
  }
  const actor = adminActorId();
  await prisma.emailImage.create({
    data: {
      code,
      ...meta,
      ...checked,
      content: toBytes(checked.content),
      sizeBytes: checked.content.length,
      contentHash: sha256(checked.content),
      createdBy: actor,
      updatedBy: actor,
    },
  });
  await logAudit({
    action: AuditAction.EMAIL_IMAGE_CHANGED,
    subjectType: AuditSubject.EMAIL_IMAGE,
    after: { ...meta, content_hash: sha256(checked.content), size_bytes: checked.content.length },
    metadata: { code, operation: "CREATE" },
  });
  res.status(201).json({ message: `เพิ่มรูปแล้ว — ใส่ {{image.${code}}} ในเนื้อหาของเทมเพลตเพื่อใช้รูปนี้` });
});

adminEmailImageRouter.put("/:code", upload.single("file"), async (req, res) => {
  const code = String(req.params.code);
  const existing = await prisma.emailImage.findUnique({ where: { code } });
  if (!existing && code !== LOGO_CODE) {
    fail(res, 404, "not_found", "ไม่มีรูปนี้");
    return;
  }
  const parsed = metaSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    zodFail(res, parsed.error);
    return;
  }
  let file: { content: Buffer; contentType: string; widthPx: number; heightPx: number } | null = null;
  if (req.file) {
    const checked = checkFile(req.file);
    if ("error" in checked) {
      fail(res, 400, "validation", checked.error, { fields: { file: checked.error } });
      return;
    }
    file = checked;
  } else if (!existing) {
    // โลโก้ที่ยังเป็นไฟล์ในโค้ด แก้แค่ชื่อ/ความกว้าง — เขียนแถวด้วยไฟล์ตั้งต้น
    if (!defaultLogo) {
      fail(res, 400, "validation", "กรุณาเลือกไฟล์รูป", { fields: { file: "กรุณาเลือกไฟล์รูป" } });
      return;
    }
    const dims = imageDimensions(defaultLogo, "image/png")!;
    file = { content: defaultLogo, contentType: "image/png", widthPx: dims.width, heightPx: dims.height };
  }
  const actor = adminActorId();
  const fileData = file
    ? { ...file, content: toBytes(file.content), sizeBytes: file.content.length, contentHash: sha256(file.content) }
    : {};
  if (existing) {
    await prisma.emailImage.update({ where: { code }, data: { ...parsed.data, ...fileData, updatedBy: actor } });
  } else {
    // ไม่มีแถว = โลโก้ — `file` ถูกตั้งข้างบนแล้วเสมอ (ไฟล์ที่อัปโหลด หรือไฟล์ตั้งต้น)
    const f = file!;
    await prisma.emailImage.create({
      data: {
        code,
        ...parsed.data,
        ...f,
        content: toBytes(f.content),
        sizeBytes: f.content.length,
        contentHash: sha256(f.content),
        createdBy: actor,
        updatedBy: actor,
      },
    });
  }
  await logAudit({
    action: AuditAction.EMAIL_IMAGE_CHANGED,
    subjectType: AuditSubject.EMAIL_IMAGE,
    before: existing
      ? { name: existing.name, altText: existing.altText, displayWidth: existing.displayWidth, content_hash: existing.contentHash }
      : { ...LOGO_DEFAULT_META, is_default: true },
    after: { ...parsed.data, content_hash: file ? sha256(file.content) : existing?.contentHash },
    metadata: { code, operation: file && req.file ? "REPLACE_FILE" : "UPDATE" },
  });
  res.json({ message: req.file ? "เปลี่ยนรูปแล้ว — อีเมลทุกฉบับที่ใช้รูปนี้ได้ไฟล์ใหม่ทันที" : "บันทึกแล้ว" });
});

adminEmailImageRouter.delete("/:code", async (req, res) => {
  const code = String(req.params.code);
  const parsed = reasonSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    zodFail(res, parsed.error);
    return;
  }
  if (code === LOGO_CODE) {
    fail(res, 409, "logo_fixed", "ลบโลโก้ไม่ได้ — เปลี่ยนไฟล์ หรือกด \"ใช้รูปตั้งต้น\" แทน");
    return;
  }
  const existing = await prisma.emailImage.findUnique({ where: { code }, select: { code: true, name: true, contentHash: true } });
  if (!existing) {
    fail(res, 404, "not_found", "ไม่มีรูปนี้");
    return;
  }
  const usedBy = (await usageByImage()).get(code) ?? [];
  if (usedBy.length) {
    fail(res, 409, "image_in_use", `ลบไม่ได้ — เทมเพลตยังใช้รูปนี้: ${usedBy.map((u) => `${u.label}${u.status === "DRAFT" ? " (ฉบับร่าง)" : ""}`).join(", ")}`, {
      usedBy,
    });
    return;
  }
  await prisma.emailImage.delete({ where: { code } });
  await logAudit({
    action: AuditAction.EMAIL_IMAGE_CHANGED,
    subjectType: AuditSubject.EMAIL_IMAGE,
    before: { name: existing.name, content_hash: existing.contentHash },
    metadata: { code, operation: "DELETE", reason: parsed.data.reason },
  });
  res.json({ message: `ลบรูป ${code} แล้ว` });
});

adminEmailImageRouter.post("/logo/reset", async (req, res) => {
  const parsed = reasonSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    zodFail(res, parsed.error);
    return;
  }
  const existing = await prisma.emailImage.findUnique({ where: { code: LOGO_CODE } });
  if (!existing) {
    fail(res, 409, "already_default", "โลโก้ใช้รูปตั้งต้นอยู่แล้ว");
    return;
  }
  await prisma.emailImage.delete({ where: { code: LOGO_CODE } });
  await logAudit({
    action: AuditAction.EMAIL_IMAGE_CHANGED,
    subjectType: AuditSubject.EMAIL_IMAGE,
    before: { name: existing.name, content_hash: existing.contentHash },
    after: { is_default: true },
    metadata: { code: LOGO_CODE, operation: "RESET", reason: parsed.data.reason },
  });
  res.json({ message: "โลโก้กลับเป็นรูปตั้งต้นแล้ว" });
});
