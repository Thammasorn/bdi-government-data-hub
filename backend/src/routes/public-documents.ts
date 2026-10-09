/**
 * เอกสารดาวน์โหลดบนหน้าแรก — หัวข้อ "กฎหมายและเอกสารที่เกี่ยวข้อง" (การ์ด Admin Console 2026-10-09)
 *
 *   GET  /api/public-documents                       รายการที่แสดง (ไม่ต้องล็อกอิน — หน้าแรกเป็นของคนนอก)
 *   GET  /api/public-documents/:id/file              ไฟล์ปัจจุบันของรายการหนึ่ง
 *
 *   GET   /api/admin/public-documents                ทุกรายการ รวมที่ซ่อนไว้ และประวัติไฟล์
 *   POST  /api/admin/public-documents                เพิ่มรายการ (multipart: ไฟล์ + ช่องข้อความ)
 *   PATCH /api/admin/public-documents/:id            แก้ชื่อ ฉบับ รหัส ลำดับ ซ่อน/แสดง
 *   POST  /api/admin/public-documents/:id/file       เปลี่ยนไฟล์ (multipart) — ฉบับเดิมเก็บไว้เป็นประวัติ
 *   GET   /api/admin/public-documents/:id/files/:attachmentId   ดาวน์โหลดไฟล์ฉบับใดก็ได้ในประวัติ
 *
 * ไฟล์เก็บผ่าน `storeAttachment()` ตัวเดียวกับไฟล์แนบทุกชนิด (`owner_type = PUBLIC_DOCUMENT`) ซึ่งเปลี่ยนไฟล์เดิมเป็น
 * REPLACED ให้เอง ประวัติจึงไม่ต้องมีตารางของตัวเอง แถวที่ยังไม่เคยมีใครอัปโหลดใช้ไฟล์ใน `frontend/public` ตาม `static_path`
 * (หกรายการที่ย้ายมาจาก content.ts) — ลิงก์บนหน้าแรกจึงไม่หักตอน deploy
 *
 * **ชื่อไฟล์ที่ผู้เยี่ยมชมได้คือชื่อเดิมของไฟล์ที่อัปโหลด** ทุกตัวอักษร ตามที่ BDI สั่งไว้ 2026-10-01 กับไฟล์ชุดแรก
 */
import { AttachmentOwnerType, AttachmentStatus, AttachmentType } from "@prisma/client";
import multer from "multer";
import { z } from "zod";

import { prisma } from "../db.js";
import { activeAttachment, streamAttachment, storeAttachment, uploadedFile } from "../lib/attachment.js";
import { Router } from "../lib/async-route.js";
import { AuditAction, AuditSubject, diffFields, logAudit } from "../lib/audit.js";
import { adminActorId } from "../lib/context.js";
import { formatZodError } from "../lib/validation.js";
import { requireAdmin } from "../middleware/auth.js";

const OWNER = AttachmentOwnerType.PUBLIC_DOCUMENT;
const FILE_TYPE = AttachmentType.PUBLIC_DOCUMENT_FILE;

/** ลำดับหัวข้อบนหน้าแรก — กฎหมาย แล้วข้อตกลงหลัก แล้วภาคผนวก */
export const PUBLIC_DOCUMENT_SECTIONS = ["REGULATION", "PRIMARY", "ANNEX"] as const;
type Section = (typeof PUBLIC_DOCUMENT_SECTIONS)[number];

/** PDF อย่างเดียว — ไฟล์ชุดแรกเคยเป็น .docx ครึ่งวันแล้ว BDI ขอเป็น PDF (content.ts) เบราว์เซอร์เปิดอ่านได้ทันที */
const pdfUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, file.mimetype === "application/pdf"),
});

const NOT_FOUND = { error: "not_found", message: "ไม่พบเอกสารนี้" } as const;

type Row = Awaited<ReturnType<typeof prisma.publicDocument.findMany>>[number];

async function currentFiles(ids: string[]) {
  const files = await prisma.attachment.findMany({
    where: { ownerType: OWNER, ownerId: { in: ids }, attachmentType: FILE_TYPE, status: AttachmentStatus.ACTIVE },
    select: { id: true, ownerId: true, originalFileName: true, fileSizeBytes: true, uploadedAt: true },
  });
  return new Map(files.map((f) => [f.ownerId, f]));
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** รูปที่หน้าแรกใช้ — `href` ชี้ไฟล์ที่อัปโหลด หรือไฟล์ใน `frontend/public` ถ้ายังไม่เคยอัปโหลด */
function publicShape(row: Row, file: { originalFileName: string; uploadedAt: Date } | undefined) {
  return {
    id: row.id,
    section: row.section as Section,
    code: row.code,
    title: row.title,
    versionLabel: row.versionLabel,
    href: file ? `/api/public-documents/${row.id}/file` : row.staticPath,
    fileName: file ? file.originalFileName : row.staticPath ? basename(row.staticPath) : null,
    updatedAt: file?.uploadedAt ?? row.updatedAt,
  };
}

function bySectionThenOrder(a: Row, b: Row) {
  const s =
    PUBLIC_DOCUMENT_SECTIONS.indexOf(a.section as Section) - PUBLIC_DOCUMENT_SECTIONS.indexOf(b.section as Section);
  return s !== 0 ? s : a.displayOrder - b.displayOrder;
}

// ════════════════════════════════════════════════════════ สาธารณะ

export const publicDocumentRouter = Router();

/**
 * รายการที่หน้าแรกแสดง — แถวที่ซ่อนอยู่และแถวที่ไม่มีไฟล์ให้ดาวน์โหลดเลยไม่ส่งออกไป (ปุ่มดาวน์โหลดที่ไม่มีไฟล์คือลิงก์เสีย)
 * cache สั้น ๆ: หน้าแรกเปิดบ่อยที่สุดในระบบ แต่ผู้ดูแลที่เพิ่งเปลี่ยนไฟล์ต้องเห็นผลภายในไม่กี่วินาที
 */
publicDocumentRouter.get("/", async (_req, res) => {
  const rows = (await prisma.publicDocument.findMany({ where: { isActive: true } })).sort(bySectionThenOrder);
  const files = await currentFiles(rows.map((r) => r.id));
  res.setHeader("Cache-Control", "public, max-age=30");
  res.json({
    documents: rows.map((r) => publicShape(r, files.get(r.id))).filter((d) => d.href),
  });
});

publicDocumentRouter.get("/:id/file", async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id);
  const row = id.success ? await prisma.publicDocument.findUnique({ where: { id: id.data } }) : null;
  const file = row?.isActive ? await activeAttachment(prisma, OWNER, row.id, FILE_TYPE) : null;
  if (!row || !file) {
    res.status(404).json(NOT_FOUND);
    return;
  }
  // inline: ปุ่มบนหน้าแรกเปิดแท็บใหม่ให้อ่าน คนที่จะบันทึกได้ชื่อเดิมของไฟล์จาก Content-Disposition
  await streamAttachment(res, file, "inline");
});

// ════════════════════════════════════════════════════════ ผู้ดูแลระบบ

export const adminPublicDocumentRouter = Router();
adminPublicDocumentRouter.use(requireAdmin);

adminPublicDocumentRouter.get("/", async (_req, res) => {
  const rows = (await prisma.publicDocument.findMany()).sort(bySectionThenOrder);
  const history = await prisma.attachment.findMany({
    where: { ownerType: OWNER, ownerId: { in: rows.map((r) => r.id) }, attachmentType: FILE_TYPE },
    orderBy: { uploadedAt: "desc" },
    select: {
      id: true,
      ownerId: true,
      status: true,
      originalFileName: true,
      fileSizeBytes: true,
      uploadedAt: true,
      uploadedBy: true,
    },
  });
  const uploaderIds = [...new Set(history.map((h) => h.uploadedBy).filter((x): x is string => Boolean(x)))];
  const uploaders = new Map(
    (
      await prisma.userAccount.findMany({
        where: { id: { in: uploaderIds } },
        select: { id: true, displayName: true, email: true },
      })
    ).map((u) => [u.id, u.displayName || u.email]),
  );
  res.json({
    documents: rows.map((r) => {
      const files = history.filter((h) => h.ownerId === r.id);
      const current = files.find((f) => f.status === AttachmentStatus.ACTIVE);
      return {
        ...publicShape(r, current),
        isActive: r.isActive,
        displayOrder: r.displayOrder,
        usesStaticFile: !current,
        files: files.map((f) => ({
          id: f.id,
          current: f.status === AttachmentStatus.ACTIVE,
          fileName: f.originalFileName,
          sizeBytes: Number(f.fileSizeBytes ?? 0),
          uploadedAt: f.uploadedAt,
          uploadedBy: f.uploadedBy ? (uploaders.get(f.uploadedBy) ?? null) : null,
        })),
      };
    }),
  });
});

const textFields = {
  title: z.string().trim().min(1, "กรุณาระบุชื่อเอกสาร").max(500),
  versionLabel: z
    .string()
    .trim()
    .max(100, "ข้อความฉบับยาวได้ไม่เกิน 100 ตัวอักษร")
    .transform((v) => v || null)
    .nullable(),
  code: z
    .string()
    .trim()
    .max(16, "รหัสยาวได้ไม่เกิน 16 ตัวอักษร")
    .transform((v) => v || null)
    .nullable(),
};

const createSchema = z.object({
  section: z.enum(PUBLIC_DOCUMENT_SECTIONS, { error: "หัวข้อไม่ถูกต้อง" }),
  title: textFields.title,
  versionLabel: textFields.versionLabel.optional(),
  code: textFields.code.optional(),
});

/** ไฟล์ที่ multer ปฏิเสธ (ไม่ใช่ PDF) มาถึงที่นี่เป็น `req.file` ว่าง — ตอบแบบเดียวกับการอัปโหลด template */
function missingFile(res: import("express").Response) {
  res.status(400).json({
    error: "validation",
    message: "กรุณาแนบไฟล์ PDF",
    fields: { file: "รองรับเฉพาะไฟล์ PDF ขนาดไม่เกิน 30 MB" },
  });
}

/** เพิ่มรายการ — ต้องมีไฟล์ตั้งแต่ต้น รายการที่ไม่มีไฟล์แสดงบนหน้าแรกไม่ได้อยู่แล้ว ต่อท้ายหัวข้อนั้น */
adminPublicDocumentRouter.post("/", pdfUpload.single("file"), async (req, res) => {
  const parsed = createSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "validation", fields: formatZodError(parsed.error) });
    return;
  }
  if (!req.file) {
    missingFile(res);
    return;
  }
  const last = await prisma.publicDocument.findFirst({
    where: { section: parsed.data.section },
    orderBy: { displayOrder: "desc" },
    select: { displayOrder: true },
  });
  const actor = adminActorId();
  const row = await prisma.publicDocument.create({
    data: {
      section: parsed.data.section,
      title: parsed.data.title,
      versionLabel: parsed.data.versionLabel ?? null,
      code: parsed.data.code ?? null,
      displayOrder: (last?.displayOrder ?? 0) + 1,
      createdBy: actor,
      updatedBy: actor,
    },
  });
  const file = await storeAttachment(prisma, {
    ownerType: OWNER,
    ownerId: row.id,
    attachmentType: FILE_TYPE,
    file: uploadedFile(req.file),
    uploadedBy: actor,
  });
  await logAudit({
    action: AuditAction.PUBLIC_DOCUMENT_CHANGED,
    subjectType: AuditSubject.PUBLIC_DOCUMENT,
    subjectId: row.id,
    after: { section: row.section, code: row.code, title: row.title, versionLabel: row.versionLabel },
    metadata: { operation: "CREATE", file_name: file.originalFileName, attachment_id: file.id },
  });
  res.status(201).json({ document: publicShape(row, file) });
});

const patchSchema = z
  .object({
    title: textFields.title.optional(),
    versionLabel: textFields.versionLabel.optional(),
    code: textFields.code.optional(),
    displayOrder: z.number().int().min(0).optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { error: "ไม่มีอะไรให้แก้" });

adminPublicDocumentRouter.patch("/:id", async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id);
  const before = id.success ? await prisma.publicDocument.findUnique({ where: { id: id.data } }) : null;
  if (!before) {
    res.status(404).json(NOT_FOUND);
    return;
  }
  const parsed = patchSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "validation", fields: formatZodError(parsed.error) });
    return;
  }
  const row = await prisma.publicDocument.update({
    where: { id: before.id },
    data: { ...parsed.data, updatedBy: adminActorId() },
  });
  const diff = diffFields(before as Record<string, unknown>, parsed.data as Record<string, unknown>);
  if (diff) {
    await logAudit({
      action: AuditAction.PUBLIC_DOCUMENT_CHANGED,
      subjectType: AuditSubject.PUBLIC_DOCUMENT,
      subjectId: row.id,
      before: diff.before,
      after: diff.after,
      metadata: { operation: "UPDATE", fields: Object.keys(diff.after) },
    });
  }
  const files = await currentFiles([row.id]);
  res.json({ document: publicShape(row, files.get(row.id)) });
});

/**
 * เปลี่ยนไฟล์ — ฉบับใหม่ขึ้นหน้าแรกทันที ฉบับเดิมเป็น REPLACED ใน `attachment.attachment` (ดาวน์โหลดย้อนได้จากประวัติ)
 * `versionLabel` ในฟอร์มเดียวกัน ไม่ส่ง = ไม่แตะ ส่งค่าว่าง = ล้าง — ไฟล์ใหม่มักมาพร้อมฉบับใหม่ จึงให้แก้ได้ในคำสั่งเดียว
 */
adminPublicDocumentRouter.post("/:id/file", pdfUpload.single("file"), async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id);
  const before = id.success ? await prisma.publicDocument.findUnique({ where: { id: id.data } }) : null;
  if (!before) {
    res.status(404).json(NOT_FOUND);
    return;
  }
  const parsed = z.object({ versionLabel: textFields.versionLabel.optional() }).safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "validation", fields: formatZodError(parsed.error) });
    return;
  }
  if (!req.file) {
    missingFile(res);
    return;
  }
  const actor = adminActorId();
  const previous = await activeAttachment(prisma, OWNER, before.id, FILE_TYPE);
  const file = await storeAttachment(prisma, {
    ownerType: OWNER,
    ownerId: before.id,
    attachmentType: FILE_TYPE,
    file: uploadedFile(req.file),
    uploadedBy: actor,
  });
  const row = await prisma.publicDocument.update({
    where: { id: before.id },
    data: {
      ...(parsed.data.versionLabel !== undefined ? { versionLabel: parsed.data.versionLabel } : {}),
      updatedBy: actor,
    },
  });
  await logAudit({
    action: AuditAction.PUBLIC_DOCUMENT_CHANGED,
    subjectType: AuditSubject.PUBLIC_DOCUMENT,
    subjectId: row.id,
    before: {
      fileName: previous?.originalFileName ?? (before.staticPath ? basename(before.staticPath) : null),
      versionLabel: before.versionLabel,
    },
    after: { fileName: file.originalFileName, versionLabel: row.versionLabel },
    metadata: { operation: "FILE", attachment_id: file.id, replaced_attachment_id: previous?.id ?? null },
  });
  res.json({ document: publicShape(row, file) });
});

adminPublicDocumentRouter.get("/:id/files/:attachmentId", async (req, res) => {
  const ids = z.object({ id: z.string().uuid(), attachmentId: z.string().uuid() }).safeParse(req.params);
  const file = ids.success
    ? await prisma.attachment.findFirst({
        where: { id: ids.data.attachmentId, ownerType: OWNER, ownerId: ids.data.id, attachmentType: FILE_TYPE },
      })
    : null;
  if (!file) {
    res.status(404).json(NOT_FOUND);
    return;
  }
  await streamAttachment(res, file, "attachment");
});
