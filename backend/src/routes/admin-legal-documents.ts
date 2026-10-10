/**
 * เอกสารกฎหมาย (A0–A4 และที่เพิ่มเอง) ใน /console หมวด "ตั้งค่าเอกสาร" — `/api/admin/legal-documents` และ `/api/admin/template-variables`
 *
 * การ์ด "Enhance Legal document management" (2026-10-10) ย้ายเส้นทางเหล่านี้ออกจาก `routes/admin.ts` มาไว้ที่เดียว เพราะเพิ่มของใหม่หลายอย่าง:
 * สร้างเอกสาร เปิด/ปิดใช้ ฉบับร่าง ประวัติเวอร์ชันแบบแบ่งหน้า และ preview ก่อนเผยแพร่
 *
 * ผู้ใช้ได้สองกลุ่ม: ผู้ดูแลระบบ (`SYSTEM_ADMINISTRATOR`) และผู้เชี่ยวชาญด้านกฎหมายของ BDI (`BDI_LEGAL_OFFICER`) ผ่าน `requireDocumentAdmin`
 * ไม่มีขั้นอนุมัติแยก — คนที่อัปโหลดเป็นคนเผยแพร่ (ตัดสินใจกับ BDI 2026-10-10) ด่านกันพลาดมีสามอย่าง: preview ก่อนยืนยัน, ติ๊ก "ใช้ทันที" ออกเพื่อเก็บเป็น
 * ฉบับร่าง, และคำขอที่นำส่งไปแล้วไม่ได้ตามเวอร์ชันล่าสุด (lib/legal.ts `documentsForRequest`)
 */
import multer from "multer";
import { z } from "zod";
import {
  AttachmentOwnerType,
  AttachmentType,
  LegalDocumentStatus,
  LegalDocumentVersionStatus,
  Prisma,
} from "@prisma/client";

import { prisma } from "../db.js";
import { Router } from "../lib/async-route.js";
import { activeAttachment, readAttachment, sendRenderedPdf, streamAttachment, uploadedFile } from "../lib/attachment.js";
import { AuditAction, AuditSubject, logAudit } from "../lib/audit.js";
import { adminActorId } from "../lib/context.js";
import {
  DEPRECATED_PLACEHOLDERS,
  TEMPLATE_VARIABLES,
  VARIABLE_GROUPS,
  assertKnownPlaceholders,
  assertReadableDocx,
  normaliseTemplate,
} from "../lib/document-render.js";
import {
  LEGAL_SCOPES,
  activateVersion,
  publishVersion,
  templateAttachment,
  variableScopeOf,
  type LegalScope,
} from "../lib/legal.js";
import { previewPdf, type PreviewMode } from "../lib/legal-preview.js";
import { fullNameTh } from "../lib/person-name.js";
import { formatZodError } from "../lib/validation.js";
import { requireDocumentAdmin } from "../middleware/auth.js";

export const adminLegalDocumentRouter = Router();

adminLegalDocumentRouter.use(["/legal-documents", "/template-variables"], requireDocumentAdmin);

// ------------------------------------------------------------------ ชื่อและกติกาของ scope

/** ชื่อที่ผู้ดูแลเห็นของแต่ละ scope — ตรงกับหัวข้อ section บนหน้า /console */
const SCOPE_LABELS: Record<LegalScope, string> = {
  ORGANIZATION_REGISTRATION: "เอกสารของคำขอลงทะเบียนหน่วยงาน",
  DATASET_REGISTRATION: "เอกสารของคำขอส่งชุดข้อมูล",
};

const SCOPES = Object.values(LEGAL_SCOPES) as [LegalScope, ...LegalScope[]];

/**
 * รหัสเอกสารที่ตั้งเองได้: ตัวพิมพ์ใหญ่ขึ้นต้นด้วยตัวอักษร ยาวไม่เกิน 16 (ขนาดคอลัมน์) — `A0`, `B1`, `NDA-2`
 * ตัวพิมพ์เล็กถูกแปลงเป็นใหญ่ให้ ไม่ใช่ปฏิเสธ รหัสแก้ไม่ได้หลังสร้าง: legal_acceptance, snapshot ของคำขอและชื่อไฟล์ PDF อ้างรหัสนี้
 */
const DOCUMENT_CODE = /^[A-Z][A-Z0-9-]{0,15}$/;

const blankToNull = (value: string | null | undefined) =>
  value === undefined ? undefined : (value?.trim() ? value.trim() : null);

/** ข้อผิดพลาดของกติกาชุดเอกสาร — ตอบ 409 พร้อมรหัสและข้อความภาษาไทยที่บอกทั้งสาเหตุและทางออก */
class DocumentRuleError extends Error {
  constructor(
    readonly code: "last_active_document" | "no_required_document" | "no_published_version",
    message: string,
  ) {
    super(message);
  }
}

/** เอกสารของ scope ที่ผู้ใช้เห็นได้จริง = เปิดใช้ **และ** มีเวอร์ชันที่เผยแพร่อยู่ (`publishedDocuments()` ข้ามอันที่ไม่มี) */
async function servingDocuments(tx: Prisma.TransactionClient, scope: string) {
  return tx.legalDocument.findMany({
    where: {
      applicationScope: scope,
      status: LegalDocumentStatus.ACTIVE,
      versions: { some: { status: LegalDocumentVersionStatus.PUBLISHED } },
    },
    select: { documentCode: true, isRequired: true },
  });
}

/** ล็อกแถวของ scope ไว้จนจบ transaction — สองผู้ดูแลที่ปิดใช้เอกสารคนละฉบับพร้อมกันต้องรอกัน ไม่งั้นต่างคนต่างเห็นว่ายังเหลืออีกฉบับ */
async function lockScope(tx: Prisma.TransactionClient, scope: string) {
  await tx.$queryRaw`SELECT id FROM legal.legal_document WHERE application_scope = ${scope} FOR UPDATE`;
}

type ScopeChange = "deactivate" | "unrequire";

/**
 * แต่ละ scope ต้องมีเอกสารที่ผู้ใช้เห็นอย่างน้อย 1 ฉบับ และอย่างน้อย 1 ฉบับในนั้นต้องเป็นเอกสารบังคับ (card ข้อ 9)
 *
 * ตรวจ**หลังเขียน**ใน transaction เดียวกับที่ล็อกแถวไว้ แล้วโยนเมื่อการเปลี่ยนครั้งนี้เป็นตัวทำให้กติกา**ที่เคยเป็นจริง**พัง — scope ที่พังอยู่ก่อนแล้ว
 * (ข้อมูลเก่า) ไม่ทำให้แก้ชื่อเอกสารไม่ได้ ผู้เรียกส่ง `before` มาจากการอ่านก่อนเขียน
 */
function assertScopeStillWorks(
  scope: LegalScope,
  change: ScopeChange,
  before: Array<{ isRequired: boolean }>,
  after: Array<{ isRequired: boolean }>,
) {
  const label = SCOPE_LABELS[scope];
  if (before.length > 0 && after.length === 0) {
    throw new DocumentRuleError(
      "last_active_document",
      `ไม่สามารถปิดใช้เอกสารนี้ได้ เพราะเป็นเอกสารที่เปิดใช้เพียงฉบับเดียวของ${label} ` +
        "ต้องมีเอกสารที่เปิดใช้และมีเวอร์ชันที่เผยแพร่อย่างน้อย 1 ฉบับ — เปิดใช้เอกสารอื่นก่อน",
    );
  }
  if (before.some((d) => d.isRequired) && !after.some((d) => d.isRequired)) {
    throw new DocumentRuleError(
      "no_required_document",
      change === "deactivate"
        ? `ไม่สามารถปิดใช้เอกสารนี้ได้ เพราะเป็นเอกสารบังคับฉบับสุดท้ายที่เปิดใช้ของ${label} ` +
            "ต้องมีเอกสารบังคับที่เปิดใช้อย่างน้อย 1 ฉบับ — ตั้งเอกสารอื่นเป็นเอกสารบังคับและเปิดใช้ก่อน"
        : `ไม่สามารถเปลี่ยนเอกสารนี้เป็นไม่บังคับได้ เพราะเป็นเอกสารบังคับฉบับสุดท้ายที่เปิดใช้ของ${label} ` +
            "ต้องมีเอกสารบังคับที่เปิดใช้อย่างน้อย 1 ฉบับ — ตั้งเอกสารอื่นเป็นเอกสารบังคับก่อน",
    );
  }
}

function ruleErrorBody(error: DocumentRuleError) {
  return { error: error.code, message: error.message };
}

// ------------------------------------------------------------------ รูปแบบที่ตอบกลับ

const documentSelect = {
  id: true,
  documentCode: true,
  nameTh: true,
  shortname: true,
  legalNotice: true,
  isRequired: true,
  applicationScope: true,
  displayOrder: true,
  status: true,
} as const;

type DocumentRow = Prisma.LegalDocumentGetPayload<{ select: typeof documentSelect }>;

function documentShape(doc: DocumentRow) {
  return {
    code: doc.documentCode,
    name: doc.nameTh,
    shortname: doc.shortname,
    legalNotice: doc.legalNotice,
    isRequired: doc.isRequired,
    scope: doc.applicationScope,
    displayOrder: doc.displayOrder,
    status: doc.status,
    /** เปิดใช้ = `ACTIVE`; ปิดใช้ = `RETIRED` (เคยใช้) หรือ `DRAFT` (สร้างแล้วแต่ยังไม่เคยเผยแพร่) */
    isActive: doc.status === LegalDocumentStatus.ACTIVE,
  };
}

/** ชื่อคนที่ลงมือ (บัญชี SYSTEM = "ระบบ") — หน้า /console แสดงในประวัติเวอร์ชัน */
async function personNames(ids: Array<string | null>): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return new Map();
  const users = await prisma.userAccount.findMany({
    where: { id: { in: unique } },
    select: { id: true, email: true, displayName: true, prefixTh: true, firstnameTh: true, lastnameTh: true },
  });
  return new Map(users.map((u) => [u.id, fullNameTh(u) || u.displayName || u.email]));
}

/** รายชื่อตัวแปรที่ template ใช้ได้ จัดกลุ่มไว้ให้ผู้เขียนเอกสารอ่าน พร้อมบอกว่าใช้ได้กับเอกสารของคำขอแบบไหน */
function variableCatalogue() {
  return Object.entries(VARIABLE_GROUPS).map(([group, title]) => ({
    group,
    title,
    variables: Object.entries(TEMPLATE_VARIABLES)
      .filter(([, spec]) => spec.group === group)
      .map(([name, spec]) => ({
        name: `{{${name}}}`,
        description: spec.description,
        example: spec.example,
        /** `both` ใช้ได้ทั้งสองแบบ · `organization` เฉพาะเอกสารของคำขอลงทะเบียนหน่วยงาน · `dataset` เฉพาะเอกสารของคำขอส่งชุดข้อมูล */
        scope: (spec as { scope?: string }).scope ?? "both",
      })),
  }));
}

adminLegalDocumentRouter.get("/template-variables", (_req, res) => {
  res.json({
    scopes: SCOPES.map((scope) => ({ scope, label: SCOPE_LABELS[scope], variableScope: variableScopeOf(scope) })),
    variableGroups: variableCatalogue(),
  });
});

// ------------------------------------------------------------------ รายการเอกสาร

adminLegalDocumentRouter.get("/legal-documents", async (_req, res) => {
  const documents = await prisma.legalDocument.findMany({
    orderBy: [{ applicationScope: "asc" }, { displayOrder: "asc" }],
    include: { versions: { orderBy: { versionNumber: "desc" } } },
  });
  const names = await personNames(documents.flatMap((d) => d.versions.map((v) => v.publishedBy)));

  res.json({
    variableGroups: variableCatalogue(),
    scopes: SCOPES.map((scope) => ({ scope, label: SCOPE_LABELS[scope] })),
    documents: documents.map((doc) => {
      const active = doc.versions.find((v) => v.status === LegalDocumentVersionStatus.PUBLISHED) ?? null;
      return {
        ...documentShape(doc),
        hasPublishedVersion: active !== null,
        /** เวอร์ชันที่ใช้อยู่ — หน้ารายการและหน้าแก้ไขแสดงแค่ฉบับนี้ ประวัติทั้งหมดอยู่ที่ `GET …/:code/versions` */
        activeVersion: active
          ? {
              id: active.id,
              versionNumber: active.versionNumber,
              publishedAt: active.publishedAt,
              publishedBy: active.publishedBy ? (names.get(active.publishedBy) ?? null) : null,
            }
          : null,
        draftVersionCount: doc.versions.filter((v) => v.status === LegalDocumentVersionStatus.DRAFT).length,
        versionCount: doc.versions.length,
        versions: doc.versions.map((v) => ({
          id: v.id,
          versionNumber: v.versionNumber,
          status: v.status,
          contentHash: v.contentHash,
          publishedAt: v.publishedAt,
          supersededAt: v.supersededAt,
          publishedBy: v.publishedBy ? (names.get(v.publishedBy) ?? null) : null,
        })),
      };
    }),
  });
});

// ------------------------------------------------------------------ อัปโหลดและตรวจไฟล์

const TEMPLATE_MIME = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

const templateUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, TEMPLATE_MIME.has(file.mimetype)),
});

function requireFile(req: { file?: Express.Multer.File }, res: import("express").Response) {
  if (!req.file) {
    res.status(400).json({
      error: "validation",
      message: "กรุณาแนบไฟล์เอกสาร Word (.docx)",
      fields: { file: "รองรับเฉพาะไฟล์ .docx ขนาดไม่เกิน 20 MB" },
    });
    return null;
  }
  return uploadedFile(req.file);
}

/** ช่อง multipart ทุกช่องเป็นสตริง — "false" และ "0" คือไม่ นอกนั้น (รวมไม่ได้ส่งมา) ใช้ค่าตั้งต้น */
function formBool(value: unknown, fallback: boolean): boolean {
  if (typeof value !== "string") return fallback;
  return !["false", "0", "off", "no"].includes(value.trim().toLowerCase());
}

const scopeSchema = z.enum(SCOPES, { error: "ต้องเลือกเอกสารของคำขอลงทะเบียนหน่วยงานหรือคำขอส่งชุดข้อมูล" });

/**
 * ตรวจไฟล์ก่อนยืนยัน — ชื่อ placeholder, ชื่อชุดเก่า และสิ่งที่ระบบจัดรูปให้ โดยไม่เขียนอะไร
 *
 * `scope` เป็นของเอกสารปลายทาง (ตัวแปรของคำขอหน่วยงานใช้ในเอกสารของคำขอชุดข้อมูลไม่ได้ และกลับกัน) หน้า upload เรียกที่นี่ทันทีที่เลือกไฟล์
 * ปุ่ม preview และปุ่มยืนยันจึงไม่ต้องเจอข้อผิดพลาดชุดเดียวกันอีก
 */
adminLegalDocumentRouter.post("/legal-documents/inspect", templateUpload.single("file"), async (req, res) => {
  const file = requireFile(req, res);
  if (!file) return;
  const scope = scopeSchema.safeParse(req.body?.scope);
  if (!scope.success) {
    res.status(400).json({ error: "validation", fields: formatZodError(scope.error) });
    return;
  }

  assertReadableDocx(file.buffer);
  const { docx, optionParagraphs, highlights } = normaliseTemplate(file.buffer);
  const placeholders = assertKnownPlaceholders(docx, variableScopeOf(scope.data));
  const deprecated = placeholders.filter((name) => name in DEPRECATED_PLACEHOLDERS);
  res.json({
    filename: file.originalname,
    placeholders,
    deprecatedPlaceholders: deprecated,
    normalised: { optionParagraphs, highlights },
    ...(deprecated.length > 0
      ? {
          warning:
            `ใช้ชื่อตัวแปรชุดเดิม ${deprecated.length} ตัว: ${deprecated.join(", ")}`,
        }
      : {}),
  });
});

const previewModeSchema = z.enum(["raw", "rendered"], { error: "mode ต้องเป็น raw หรือ rendered" });

/**
 * PDF ตัวอย่างของไฟล์ที่เพิ่งเลือก (ยังไม่เก็บ) — `mode=raw` ตามที่ผู้เขียนพิมพ์ · `mode=rendered` เติมข้อมูลตัวอย่างแล้วไฮไลต์เหลืองส่วนที่ระบบเติม
 *
 * เป็น POST เพราะต้องส่งไฟล์ และไฟล์ไม่ถูกเก็บ: ปุ่ม preview กับปุ่มยืนยันส่งไฟล์เดียวกันจากเบราว์เซอร์ซ้ำ ดีกว่าให้ระบบถือไฟล์ที่ยังไม่มีใครยืนยันไว้
 */
adminLegalDocumentRouter.post("/legal-documents/preview", templateUpload.single("file"), async (req, res) => {
  const file = requireFile(req, res);
  if (!file) return;
  const scope = scopeSchema.safeParse(req.body?.scope);
  const mode = previewModeSchema.safeParse(req.body?.mode);
  if (!scope.success || !mode.success) {
    res.status(400).json({
      error: "validation",
      fields: {
        ...(scope.success ? {} : formatZodError(scope.error)),
        ...(mode.success ? {} : { mode: mode.error.issues[0]?.message ?? "mode ไม่ถูกต้อง" }),
      },
    });
    return;
  }

  assertReadableDocx(file.buffer);
  const { docx } = normaliseTemplate(file.buffer);
  assertKnownPlaceholders(docx, variableScopeOf(scope.data));
  const pdf = await previewPdf(docx, scope.data, mode.data, file.originalname);
  sendRenderedPdf(res, pdf, `ตัวอย่าง-${file.originalname}.pdf`);
});

// ------------------------------------------------------------------ สร้างเอกสาร

const createDocumentSchema = z.object({
  scope: scopeSchema,
  documentCode: z
    .string({ error: "ต้องระบุรหัสเอกสาร" })
    .trim()
    .transform((v) => v.toUpperCase())
    .pipe(
      z.string().regex(DOCUMENT_CODE, {
        error: "รหัสเอกสารใช้ได้เฉพาะ A–Z ตัวเลข และ - ขึ้นต้นด้วยตัวอักษร ยาวไม่เกิน 16 ตัว เช่น B1",
      }),
    ),
  nameTh: z
    .string({ error: "ต้องระบุชื่อเอกสาร" })
    .trim()
    .min(1, "ต้องระบุชื่อเอกสาร")
    .max(500, "ชื่อเอกสารยาวได้ไม่เกิน 500 ตัวอักษร"),
  shortname: z.string().max(200, "ชื่อสั้นยาวได้ไม่เกิน 200 ตัวอักษร").nullish(),
  legalNotice: z.string().nullish(),
});

/** ข้อความ 409 เมื่อรหัสหรือชื่อสั้นซ้ำ — บอกว่าซ้ำกับฉบับไหน ไม่ใช่แค่ว่าซ้ำ */
async function conflictsOf(code: string, shortname: string | null | undefined, exceptId?: string) {
  const fields: Record<string, string> = {};
  const messages: string[] = [];
  if (code) {
    const owner = await prisma.legalDocument.findUnique({
      where: { documentCode: code },
      select: { id: true, nameTh: true },
    });
    if (owner && owner.id !== exceptId) {
      fields.documentCode = `รหัส ${code} ถูกใช้กับเอกสาร "${owner.nameTh}" อยู่แล้ว`;
      messages.push(fields.documentCode);
    }
  }
  if (shortname) {
    const owner = await prisma.legalDocument.findFirst({
      where: { shortname, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { documentCode: true, nameTh: true },
    });
    if (owner) {
      fields.shortname = `ชื่อสั้น "${shortname}" ถูกใช้กับเอกสาร ${owner.documentCode} (${owner.nameTh}) อยู่แล้ว`;
      messages.push(fields.shortname);
    }
  }
  return messages.length > 0 ? { fields, message: messages.join(" · ") } : null;
}

/**
 * เพิ่มเอกสารใหม่ในหมวดใดหมวดหนึ่ง — ต้องแนบไฟล์ .docx ฉบับแรกมาด้วยเสมอ (multipart)
 *
 * - ลำดับเป็นต่อท้ายเสมอ: `max(display_order)` ของ scope + 1 นับเอกสารที่ปิดใช้ด้วย เพื่อให้เอกสารที่เปิดกลับมาไม่ชนลำดับของใคร
 * - `apply=true` (ค่าตั้งต้น): เผยแพร่ v1 และเปิดใช้เอกสารเลย · `apply=false`: เก็บ v1 เป็นฉบับร่าง เอกสารยังไม่เปิดใช้ (`DRAFT`)
 *   เผยแพร่ภายหลังด้วย "ใช้เวอร์ชันนี้" แล้วเปิดใช้เอกสารเอง
 * - คำขอที่นำส่งหรืออนุมัติไปแล้วไม่ได้เอกสารใหม่ เพราะถือชุดเอกสารของตัวเองอยู่แล้ว (`request_document_snapshot`)
 * - สร้างแถวก่อนแล้วจึงเก็บไฟล์ (แปลง PDF ใช้เวลาเกินกว่า transaction ของ Prisma รอได้) ถ้าเผยแพร่ไม่สำเร็จจะลบแถวนั้นทิ้ง ไม่ทิ้งเอกสารเปล่าไว้
 */
adminLegalDocumentRouter.post("/legal-documents", templateUpload.single("file"), async (req, res) => {
  const file = requireFile(req, res);
  if (!file) return;

  const parsed = createDocumentSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "validation", fields: formatZodError(parsed.error) });
    return;
  }
  const { scope, documentCode, nameTh } = parsed.data;
  const shortname = blankToNull(parsed.data.shortname) ?? null;
  const legalNotice = blankToNull(parsed.data.legalNotice) ?? null;
  const isRequired = formBool(req.body?.isRequired, true);
  const apply = formBool(req.body?.apply, true);

  const conflict = await conflictsOf(documentCode, shortname);
  if (conflict) {
    res.status(409).json({ error: "conflict", message: conflict.message, fields: conflict.fields });
    return;
  }

  // ตรวจไฟล์ก่อนเขียนอะไร — ชื่อ placeholder ผิด/เปิดไม่ได้ ต้องตกที่นี่ ไม่ใช่หลังสร้างเอกสารไปแล้ว
  assertReadableDocx(file.buffer);
  assertKnownPlaceholders(normaliseTemplate(file.buffer).docx, variableScopeOf(scope));

  const actorId = adminActorId();
  let created;
  try {
    created = await prisma.$transaction(async (tx) => {
      await lockScope(tx, scope);
      const last = await tx.legalDocument.aggregate({
        where: { applicationScope: scope },
        _max: { displayOrder: true },
      });
      return tx.legalDocument.create({
        data: {
          documentCode,
          documentType: documentCode,
          nameTh,
          shortname,
          legalNotice,
          applicationScope: scope,
          displayOrder: (last._max.displayOrder ?? 0) + 1,
          isRequired,
          requiresSignatureConfirmation: true,
          status: LegalDocumentStatus.DRAFT,
          createdBy: actorId,
        },
        select: documentSelect,
      });
    });
  } catch (error) {
    // สองคนสร้างรหัสเดียวกันพร้อมกัน — ตรวจข้างบนไม่ทัน
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const again = await conflictsOf(documentCode, shortname);
      res.status(409).json({
        error: "conflict",
        message: again?.message ?? "รหัสหรือชื่อสั้นนี้ถูกใช้กับเอกสารฉบับอื่นอยู่แล้ว",
        fields: again?.fields ?? {},
      });
      return;
    }
    throw error;
  }

  let published;
  try {
    published = await publishVersion(prisma, {
      documentCode,
      docx: file.buffer,
      filename: file.originalname,
      actorId,
      status: apply ? "PUBLISHED" : "DRAFT",
    });
    if (apply) {
      await prisma.legalDocument.update({
        where: { id: created.id },
        data: { status: LegalDocumentStatus.ACTIVE },
      });
    }
  } catch (error) {
    await prisma.legalDocument.deleteMany({ where: { id: created.id } });
    throw error;
  }

  await logAudit({
    action: AuditAction.LEGAL_DOCUMENT_CHANGED,
    subjectType: AuditSubject.LEGAL_DOCUMENT,
    subjectId: created.id,
    after: { documentCode, nameTh, scope, isRequired, applied: apply, filename: file.originalname },
    metadata: { operation: "CREATE", document_code: documentCode, version_id: published.versionId },
  });

  const document = await prisma.legalDocument.findUniqueOrThrow({ where: { id: created.id }, select: documentSelect });
  res.status(201).json({
    document: documentShape(document),
    versionId: published.versionId,
    versionNumber: published.versionNumber,
    placeholders: published.placeholders,
    deprecatedPlaceholders: published.deprecatedPlaceholders,
    normalised: published.normalised,
    message: apply
      ? `สร้างเอกสาร ${documentCode} และเปิดใช้แล้ว`
      : `สร้างเอกสาร ${documentCode} แล้ว (ยังไม่เปิดใช้ — Version 1 เป็นฉบับร่าง)`,
  });
});

// ------------------------------------------------------------------ จัดลำดับ

const reorderSchema = z.object({
  scope: scopeSchema,
  codes: z.array(z.string().trim().min(1)).min(1, "ต้องส่งรหัสเอกสารอย่างน้อยหนึ่งฉบับ"),
});

/**
 * จัดลำดับเอกสารของหมวดหนึ่ง — `codes` คือรหัส**ทุกฉบับ**ของหมวดตามลำดับใหม่ (ทั้งที่เปิดและปิดใช้)
 *
 * ส่งทั้งชุดไม่ใช่สลับทีละคู่ เพื่อให้ผลเป็นลำดับเดียวที่ผู้ดูแลเห็นบนหน้าจอเสมอ แม้สองคนจัดพร้อมกัน (คนหลังชนะทั้งชุด ไม่ได้ลำดับครึ่ง ๆ กลาง ๆ)
 * ชุดที่ไม่ตรงกับเอกสารที่มีอยู่จริงในหมวดถูกปฏิเสธ — ฉบับที่เพิ่งมีคนเพิ่มระหว่างที่เปิดหน้าอยู่ต้องไม่หายไปเงียบ ๆ
 * ลำดับมีผลกับคำขอที่นำส่ง**จากนี้ไป**เท่านั้น คำขอที่นำส่งแล้วถือ `display_order` ของตัวเองใน snapshot
 */
adminLegalDocumentRouter.put("/legal-documents/order", async (req, res) => {
  const parsed = reorderSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "validation", fields: formatZodError(parsed.error) });
    return;
  }
  const { scope } = parsed.data;
  const codes = parsed.data.codes.map((c) => c.toUpperCase());

  const result = await prisma.$transaction(async (tx) => {
    await lockScope(tx, scope);
    const docs = await tx.legalDocument.findMany({
      where: { applicationScope: scope },
      select: { id: true, documentCode: true, displayOrder: true },
    });
    const known = new Set(docs.map((d) => d.documentCode));
    const wanted = new Set(codes);
    if (wanted.size !== codes.length || known.size !== wanted.size || [...known].some((c) => !wanted.has(c))) {
      return { mismatch: true as const };
    }
    const byCode = new Map(docs.map((d) => [d.documentCode, d]));
    for (const [index, code] of codes.entries()) {
      const doc = byCode.get(code)!;
      if (doc.displayOrder !== index + 1) {
        await tx.legalDocument.update({ where: { id: doc.id }, data: { displayOrder: index + 1 } });
      }
    }
    return { mismatch: false as const, before: docs.sort((a, b) => a.displayOrder - b.displayOrder).map((d) => d.documentCode) };
  });

  if (result.mismatch) {
    res.status(409).json({
      error: "order_stale",
      message: "รายการเอกสารของหมวดนี้เปลี่ยนไปแล้ว (มีผู้เพิ่มหรือแก้เอกสาร) — โหลดหน้าใหม่แล้วจัดลำดับอีกครั้ง",
    });
    return;
  }

  await logAudit({
    action: AuditAction.LEGAL_DOCUMENT_CHANGED,
    subjectType: AuditSubject.LEGAL_DOCUMENT,
    subjectId: null,
    before: { order: result.before },
    after: { order: codes },
    metadata: { operation: "REORDER", scope, changed_via: "ADMIN_API" },
  });

  res.json({ scope, codes, message: "จัดลำดับเอกสารแล้ว" });
});

// ------------------------------------------------------------------ แก้ข้อมูลเอกสาร / เปิด-ปิดใช้

const documentPatchSchema = z
  .object({
    nameTh: z
      .string()
      .trim()
      .min(1, "ชื่อเอกสารต้องไม่ว่าง")
      .max(500, "ชื่อเอกสารยาวได้ไม่เกิน 500 ตัวอักษร")
      .optional(),
    shortname: z.string().max(200, { error: "ชื่อสั้นยาวได้ไม่เกิน 200 ตัวอักษร" }).nullable().optional(),
    legalNotice: z.string().nullable().optional(),
    isRequired: z.boolean({ error: "ต้องระบุ isRequired เป็น true หรือ false" }).optional(),
    isActive: z.boolean({ error: "ต้องระบุ isActive เป็น true หรือ false" }).optional(),
  })
  .refine((body) => Object.values(body).some((v) => v !== undefined), {
    error: "ต้องส่งอย่างน้อยหนึ่งช่อง: nameTh, shortname, legalNotice, isRequired หรือ isActive",
  });

const PATCHABLE_FIELDS = ["nameTh", "shortname", "legalNotice", "isRequired"] as const;

/**
 * แก้ข้อมูลประจำตัวของเอกสาร และเปิด/ปิดใช้ — `PATCH /api/admin/legal-documents/:code`
 *
 * - `nameTh` `shortname` `legalNotice` `isRequired` ตามเดิม (nameTh เพิ่มเมื่อ 2026-10-10) · `shortname` unique ทั้งตาราง
 * - `isActive` เปิด/ปิดใช้เอกสาร: ปิด = ผู้ใช้**ใหม่**ไม่เห็นเอกสารนี้ คำขอที่นำส่งไปแล้วยังถือเอกสารนี้ตามเดิม
 *
 * กติกาต่อ scope (ตรวจใน transaction ที่ล็อกแถวไว้ — ตอบ 409 พร้อมเหตุผล): ต้องมีเอกสารที่เปิดใช้และมีเวอร์ชันที่เผยแพร่ ≥ 1 ฉบับ และอย่างน้อย 1 ฉบับในนั้นต้องบังคับ
 * เปิดใช้เอกสารที่ยังไม่เคยเผยแพร่เวอร์ชันใดไม่ได้ (ผู้ใช้ไม่เห็นอะไรเลย)
 */
adminLegalDocumentRouter.patch("/legal-documents/:code", async (req, res) => {
  const parsed = documentPatchSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "validation", fields: formatZodError(parsed.error) });
    return;
  }

  const code = String(req.params.code ?? "").toUpperCase();
  const document = await prisma.legalDocument.findUnique({ where: { documentCode: code }, select: documentSelect });
  if (!document) {
    res.status(404).json({ error: "not_found", message: "ไม่พบเอกสารรหัสนี้" });
    return;
  }
  const scope = document.applicationScope as LegalScope;

  const wanted = {
    nameTh: parsed.data.nameTh,
    shortname: blankToNull(parsed.data.shortname),
    legalNotice: blankToNull(parsed.data.legalNotice),
    isRequired: parsed.data.isRequired,
  };
  const changed = PATCHABLE_FIELDS.filter(
    (field) => wanted[field] !== undefined && wanted[field] !== document[field],
  );
  const activeChange =
    parsed.data.isActive === undefined || parsed.data.isActive === (document.status === LegalDocumentStatus.ACTIVE)
      ? null
      : parsed.data.isActive
        ? ("activate" as const)
        : ("deactivate" as const);

  if (changed.length === 0 && activeChange === null) {
    res.json({ document: documentShape(document), changed: false, changedFields: [] });
    return;
  }

  if (wanted.shortname) {
    const conflict = await conflictsOf("", wanted.shortname, document.id);
    if (conflict) {
      res.status(409).json({ error: "conflict", message: conflict.message, fields: conflict.fields });
      return;
    }
  }

  const data: Prisma.LegalDocumentUpdateInput = Object.fromEntries(changed.map((field) => [field, wanted[field]]));
  if (activeChange === "activate") data.status = LegalDocumentStatus.ACTIVE;
  if (activeChange === "deactivate") data.status = LegalDocumentStatus.RETIRED;

  let updated: DocumentRow;
  try {
    updated = await prisma.$transaction(async (tx) => {
      await lockScope(tx, scope);

      if (activeChange === "activate") {
        const published = await tx.legalDocumentVersion.count({
          where: { legalDocumentId: document.id, status: LegalDocumentVersionStatus.PUBLISHED },
        });
        if (published === 0) {
          throw new DocumentRuleError(
            "no_published_version",
            `ไม่สามารถเปิดใช้เอกสาร ${document.documentCode} ได้ เพราะยังไม่มีเวอร์ชันที่เผยแพร่ ` +
              'ผู้ใช้จะไม่เห็นเอกสารนี้เลย — อัปโหลดเวอร์ชันโดยติ๊ก "ใช้ทันที" หรือกด "ใช้เวอร์ชันนี้" ที่ฉบับร่างก่อน แล้วเปิดใช้อีกครั้ง',
          );
        }
      }

      const touchesRule = activeChange === "deactivate" || changed.includes("isRequired");
      const before = touchesRule ? await servingDocuments(tx, scope) : [];
      const next = await tx.legalDocument.update({ where: { id: document.id }, data, select: documentSelect });
      if (touchesRule) {
        const after = await servingDocuments(tx, scope);
        assertScopeStillWorks(scope, activeChange === "deactivate" ? "deactivate" : "unrequire", before, after);
      }
      return next;
    });
  } catch (error) {
    if (error instanceof DocumentRuleError) {
      res.status(409).json(ruleErrorBody(error));
      return;
    }
    // ชื่อสั้นชนกันหลังตรวจข้างบน (สองคนแก้พร้อมกัน)
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const conflict = await conflictsOf("", wanted.shortname ?? null, document.id);
      res.status(409).json({
        error: "conflict",
        message: conflict?.message ?? "ชื่อสั้นนี้ถูกใช้กับเอกสารฉบับอื่นอยู่แล้ว",
        fields: conflict?.fields ?? { shortname: "ชื่อสั้นต้องไม่ซ้ำกับเอกสารฉบับอื่น" },
      });
      return;
    }
    throw error;
  }

  const operation = activeChange === "activate" ? "ACTIVATE" : activeChange === "deactivate" ? "DEACTIVATE" : "UPDATE";
  await logAudit({
    action: AuditAction.LEGAL_DOCUMENT_CHANGED,
    subjectType: AuditSubject.LEGAL_DOCUMENT,
    subjectId: document.id,
    before: {
      ...Object.fromEntries(changed.map((field) => [field, document[field]])),
      ...(activeChange ? { status: document.status } : {}),
    },
    after: {
      ...Object.fromEntries(changed.map((field) => [field, updated[field]])),
      ...(activeChange ? { status: updated.status } : {}),
    },
    metadata: { operation, document_code: document.documentCode, changed_via: "ADMIN_API" },
  });

  const messages: string[] = [];
  if (changed.includes("nameTh")) messages.push(`เปลี่ยนชื่อเอกสารเป็น "${updated.nameTh}"`);
  if (changed.includes("shortname")) {
    messages.push(
      updated.shortname
        ? `ตั้งชื่อสั้นเป็น "${updated.shortname}"`
        : "ล้างชื่อสั้นแล้ว",
    );
  }
  if (changed.includes("legalNotice")) {
    messages.push(
      updated.legalNotice
        ? "แก้ข้อความเตือนแล้ว"
        : "ลบข้อความเตือนแล้ว",
    );
  }
  if (changed.includes("isRequired")) {
    messages.push(
      updated.isRequired
        ? `${document.documentCode} เป็นเอกสารบังคับแล้ว`
        : `${document.documentCode} เป็นเอกสารไม่บังคับแล้ว`,
    );
  }
  if (activeChange === "activate") {
    messages.push(`เปิดใช้ ${document.documentCode} แล้ว`);
  }
  if (activeChange === "deactivate") {
    messages.push(
      `ปิดใช้ ${document.documentCode} แล้ว`,
    );
  }

  res.json({
    document: documentShape(updated),
    changed: true,
    changedFields: [...changed, ...(activeChange ? ["isActive"] : [])],
    message: messages.join(" · "),
  });
});

// ------------------------------------------------------------------ เวอร์ชัน

/** เวอร์ชันของเอกสารตามรหัส — null ถ้า id ไม่ใช่ uuid หรือไม่ใช่ของเอกสารนี้ */
async function legalVersionOf(code: string, versionId: string) {
  if (!z.string().uuid().safeParse(versionId).success) return null;
  return prisma.legalDocumentVersion.findFirst({
    where: { id: versionId, legalDocument: { documentCode: code } },
    include: {
      legalDocument: { select: { id: true, documentCode: true, nameTh: true, applicationScope: true } },
    },
  });
}

const historyQuerySchema = z.object({
  page: z.coerce.number().int().min(1).catch(1),
  pageSize: z.coerce.number().int().min(1).max(100).catch(10),
});

/**
 * ประวัติเวอร์ชันของเอกสารหนึ่งฉบับ แบ่งหน้า ใหม่สุดก่อน — ปุ่ม "Version History" ในหน้าแก้ไข
 * (`GET /api/admin/legal-documents` ตอบแค่เวอร์ชันที่ใช้อยู่ กับจำนวน)
 */
adminLegalDocumentRouter.get("/legal-documents/:code/versions", async (req, res) => {
  const code = String(req.params.code ?? "").toUpperCase();
  const document = await prisma.legalDocument.findUnique({
    where: { documentCode: code },
    select: documentSelect,
  });
  if (!document) {
    res.status(404).json({ error: "not_found", message: "ไม่พบเอกสารรหัสนี้" });
    return;
  }
  const { page, pageSize } = historyQuerySchema.parse(req.query);

  const [total, rows] = await Promise.all([
    prisma.legalDocumentVersion.count({ where: { legalDocumentId: document.id } }),
    prisma.legalDocumentVersion.findMany({
      where: { legalDocumentId: document.id },
      orderBy: { versionNumber: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { attachment: { select: { originalFileName: true } } },
    }),
  ]);
  const names = await personNames(rows.flatMap((v) => [v.publishedBy, v.createdBy]));

  res.json({
    document: documentShape(document),
    page,
    pageSize,
    total,
    versions: rows.map((v) => ({
      id: v.id,
      versionNumber: v.versionNumber,
      status: v.status,
      /** true = ฉบับที่ใช้อยู่ตอนนี้ */
      isActive: v.status === LegalDocumentVersionStatus.PUBLISHED,
      filename: v.attachment.originalFileName,
      contentHash: v.contentHash,
      createdAt: v.createdAt,
      createdBy: names.get(v.createdBy) ?? null,
      publishedAt: v.publishedAt,
      publishedBy: v.publishedBy ? (names.get(v.publishedBy) ?? null) : null,
      supersededAt: v.supersededAt,
    })),
  });
});

/**
 * เผยแพร่ .docx เป็นเวอร์ชันใหม่ของเอกสาร — multipart: `file` และ `apply` (ค่าตั้งต้น true)
 *
 * `apply=false` เก็บเป็นฉบับร่าง (DRAFT) ไม่แตะเวอร์ชันที่ใช้อยู่ · เอกสารที่ปิดใช้อยู่ก็อัปโหลดและเผยแพร่ได้ — เผยแพร่เวอร์ชันไม่เปลี่ยนสถานะของเอกสาร
 */
adminLegalDocumentRouter.post("/legal-documents/:code/versions", templateUpload.single("file"), async (req, res) => {
  const code = String(req.params.code ?? "").toUpperCase();
  const file = requireFile(req, res);
  if (!file) return;
  const apply = formBool(req.body?.apply, true);

  const published = await publishVersion(prisma, {
    documentCode: code,
    docx: file.buffer,
    filename: file.originalname,
    actorId: adminActorId(),
    status: apply ? "PUBLISHED" : "DRAFT",
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
      applied: apply,
    },
  });

  res.status(201).json({
    documentCode: code,
    versionId: published.versionId,
    versionNumber: published.versionNumber,
    status: apply ? LegalDocumentVersionStatus.PUBLISHED : LegalDocumentVersionStatus.DRAFT,
    /** placeholder ที่พบในไฟล์ — ให้คนอัปโหลดยืนยันได้ว่าช่องที่ตั้งใจใส่ถูกอ่านเจอครบ */
    placeholders: published.placeholders,
    /** ชื่อชุดเก่าที่ไฟล์นี้ยังใช้อยู่ — ยังเติมค่าให้ตามปกติ แต่ควรแก้เป็นชื่อใหม่ในเวอร์ชันถัดไป (docs/18) */
    deprecatedPlaceholders: published.deprecatedPlaceholders,
    /** สิ่งที่ระบบจัดรูปให้ก่อนเก็บ (ย่อหน้าตัวเลือก ไฮไลต์) */
    normalised: published.normalised,
    message: apply
      ? `เผยแพร่ Version ${published.versionNumber} แล้ว`
      : `เก็บ Version ${published.versionNumber} เป็นฉบับร่างแล้ว`,
    ...(published.deprecatedPlaceholders.length > 0
      ? {
          warning:
            `ใช้ชื่อตัวแปรชุดเดิม ${published.deprecatedPlaceholders.length} ตัว: ${published.deprecatedPlaceholders.join(", ")}`,
        }
      : {}),
  });
});

/**
 * ใช้ฉบับร่างเป็นเวอร์ชันที่เผยแพร่ — ฉบับที่ใช้อยู่เดิมกลายเป็น SUPERSEDED (เอกสารที่ปิดใช้อยู่ก็ทำได้ และยังปิดใช้ต่อไป)
 */
adminLegalDocumentRouter.post("/legal-documents/:code/versions/:versionId/activate", async (req, res) => {
  const code = String(req.params.code ?? "").toUpperCase();
  const version = await legalVersionOf(code, String(req.params.versionId));
  if (!version) {
    res.status(404).json({ error: "not_found", message: "ไม่พบเวอร์ชันนี้ของเอกสาร" });
    return;
  }
  if (version.status === LegalDocumentVersionStatus.PUBLISHED) {
    res.status(409).json({
      error: "already_current",
      message: `Version ${version.versionNumber} เป็นฉบับที่เผยแพร่อยู่แล้ว`,
    });
    return;
  }
  if (
    version.status !== LegalDocumentVersionStatus.DRAFT &&
    version.status !== LegalDocumentVersionStatus.SUPERSEDED
  ) {
    res.status(409).json({
      error: "not_draft",
      message: `Version ${version.versionNumber} เก็บถาวรแล้ว ใช้ไม่ได้`,
    });
    return;
  }

  // ไฟล์เก่าถูกตรวจกับรายชื่อตัวแปรของ**วันนี้** — ฉบับที่ใช้ชื่อที่เลิกไปแล้วต้องได้ 400 ไม่ใช่กลับมาพิมพ์ช่องว่างบนเอกสารที่มีคนลงนาม
  assertKnownPlaceholders(
    normaliseTemplate(await readAttachment(await templateAttachment(prisma, version.id))).docx,
    variableScopeOf(version.legalDocument.applicationScope),
  );

  const activated = await prisma.$transaction(async (tx) => {
    await lockScope(tx, version.legalDocument.applicationScope);
    return activateVersion(tx, version.id, adminActorId());
  });

  await logAudit({
    action: AuditAction.LEGAL_DOCUMENT_CHANGED,
    subjectType: AuditSubject.LEGAL_DOCUMENT,
    subjectId: version.legalDocument.id,
    after: { documentCode: code, versionNumber: activated.versionNumber },
    metadata: {
      operation: "VERSION_ACTIVATED",
      document_code: code,
      version_id: version.id,
      from_status: version.status,
    },
  });

  res.json({
    documentCode: code,
    versionId: activated.id,
    versionNumber: activated.versionNumber,
    message: `ใช้ Version ${activated.versionNumber} แล้ว`,
  });
});

/**
 * ไฟล์ของเวอร์ชันหนึ่ง — `kind=docx` ต้นแบบที่อัปโหลด (ค่าตั้งต้น) หรือ `kind=pdf` ฉบับเปล่าที่แปลงไว้ตอนเผยแพร่
 *
 * ก่อนมีหน้า /console ไม่มีทางเอา .docx ที่เผยแพร่ไปแล้วกลับออกมาเลยนอกจากเข้า storage ตรง ผู้เขียนเอกสารที่จะแก้ฉบับ
 * ถัดไปต้องเริ่มจากไฟล์ใน repo ซึ่งไม่ใช่ฉบับที่ใช้อยู่จริง (CLAUDE.md "The template is a row … not a file in the repo")
 */
adminLegalDocumentRouter.get("/legal-documents/:code/versions/:versionId/file", async (req, res) => {
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
  await streamAttachment(res, file, "attachment");
});

/**
 * PDF ตัวอย่างของเวอร์ชันที่เก็บไว้แล้ว — `mode=raw` (ตามที่ผู้เขียนพิมพ์ เห็น `{{…}}`) หรือ `mode=rendered` (เติมข้อมูลตัวอย่าง ไฮไลต์เหลือง)
 * แปลงสดทุกครั้ง ไม่ได้เก็บ — `…/file?kind=pdf` คือฉบับเปล่าที่แปลงไว้ตอนเผยแพร่
 */
adminLegalDocumentRouter.get("/legal-documents/:code/versions/:versionId/preview", async (req, res) => {
  const code = String(req.params.code ?? "").toUpperCase();
  const version = await legalVersionOf(code, String(req.params.versionId));
  if (!version) {
    res.status(404).json({ error: "not_found", message: "ไม่พบเวอร์ชันนี้ของเอกสาร" });
    return;
  }
  const mode = previewModeSchema.safeParse(req.query.mode ?? "rendered");
  if (!mode.success) {
    res.status(400).json({ error: "validation", fields: { mode: "mode ต้องเป็น raw หรือ rendered" } });
    return;
  }
  const source = await templateAttachment(prisma, version.id);
  const pdf = await previewPdf(
    await readAttachment(source),
    version.legalDocument.applicationScope as LegalScope,
    mode.data as PreviewMode,
    source.originalFileName,
  );
  sendRenderedPdf(res, pdf, `ตัวอย่าง-${code}-v${version.versionNumber}.pdf`);
});

const adminReasonSchema = z.object({
  reason: z
    .string({ error: "ต้องระบุ reason — เหตุผลนี้ถูกบันทึกลง audit" })
    .trim()
    .min(10, "กรุณาระบุเหตุผลอย่างน้อย 10 ตัวอักษร — เหตุผลนี้ถูกบันทึกไว้เป็นหลักฐาน")
    .max(500),
});

/**
 * เผยแพร่เวอร์ชันเก่าอีกครั้ง พร้อมเหตุผล — เหมือน `…/:versionId/activate` ทุกประการ (แถวเดิมกลับเป็น PUBLISHED ไม่ออกเวอร์ชันใหม่)
 * เก็บไว้เพราะ Postman collection เรียกเส้นทางนี้ และเหตุผลลง audit
 */
adminLegalDocumentRouter.post("/legal-documents/:code/versions/:versionId/restore", async (req, res) => {
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
      message: `Version ${version.versionNumber} เป็นฉบับที่เผยแพร่อยู่แล้ว`,
    });
    return;
  }
  if (version.status !== LegalDocumentVersionStatus.SUPERSEDED) {
    res.status(409).json({
      error: "not_draft",
      message: `Version ${version.versionNumber} ไม่ใช่ฉบับที่ถูกแทนที่ — ใช้ …/activate`,
    });
    return;
  }
  assertKnownPlaceholders(
    normaliseTemplate(await readAttachment(await templateAttachment(prisma, version.id))).docx,
    variableScopeOf(version.legalDocument.applicationScope),
  );

  const activated = await prisma.$transaction(async (tx) => {
    await lockScope(tx, version.legalDocument.applicationScope);
    return activateVersion(tx, version.id, adminActorId());
  });

  await logAudit({
    action: AuditAction.LEGAL_DOCUMENT_CHANGED,
    subjectType: AuditSubject.LEGAL_DOCUMENT,
    subjectId: version.legalDocument.id,
    after: { documentCode: code, versionNumber: activated.versionNumber },
    metadata: {
      operation: "VERSION_ACTIVATED",
      document_code: code,
      version_id: version.id,
      from_status: version.status,
      reason: parsed.data.reason,
    },
  });

  res.json({
    documentCode: code,
    versionId: activated.id,
    versionNumber: activated.versionNumber,
    message: `เผยแพร่ Version ${activated.versionNumber} อีกครั้งแล้ว`,
  });
});
