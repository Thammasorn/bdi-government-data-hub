/**
 * เทมเพลตอีเมล — `/api/admin/email-templates` (หน้า /console → ตั้งค่า › เทมเพลตอีเมล, การ์ด "[New Feature] Admin Email Template Edit"
 * 2026-11-08)
 *
 * ผู้ดูแลระบบเท่านั้น (`requireAdmin`) รายการเทมเพลต ตัวแปร บล็อก และเนื้อหาตั้งต้นอยู่ที่ `lib/email/catalogue.ts` เวอร์ชันอยู่ที่
 * `lib/email/store.ts` route นี้แค่ต่อสองอย่างนั้นเข้ากับ HTTP
 *
 * ```
 * GET    /                              รายการเทมเพลตทั้งหมด + เวอร์ชันที่ใช้งาน / มีฉบับร่างไหม
 * GET    /:key                          นิยาม (ตัวแปร บล็อก) + ทุกเวอร์ชัน
 * PUT    /:key/draft                    บันทึกฉบับร่าง (เขียนทับฉบับร่างเดิม) — ไม่ต้องใส่เหตุผล
 * POST   /:key/publish                  เผยแพร่ฉบับร่าง — เหตุผล ≥ 10 ตัวอักษร
 * POST   /:key/versions/:n/restore      นำเวอร์ชันเก่ากลับมาเป็นฉบับร่าง — เหตุผล ≥ 10 ตัวอักษร
 * POST   /:key/preview                  render เนื้อหาที่ส่งมา (หรือเวอร์ชัน n) ด้วยข้อมูลตัวอย่าง — ไม่บันทึกอะไร
 * POST   /:key/test-send                ส่งเนื้อหาที่ส่งมาถึงอีเมลของผู้ดูแลที่ล็อกอินอยู่เท่านั้น
 * ```
 */
import type { Request, Response } from "express";
import { z } from "zod";

import { prisma } from "../db.js";
import { Router } from "../lib/async-route.js";
import { AuditAction, AuditSubject, logAudit } from "../lib/audit.js";
import { adminActorId } from "../lib/context.js";
import {
  BLOCK_LABELS,
  GROUP_LABELS,
  LAYOUT_KEY,
  TEMPLATES,
  VARIABLES,
  allowedVariables,
  type TemplateContent,
  type TemplateDefinition,
} from "../lib/email/catalogue.js";
import { imageCodes, listImages } from "../lib/email/images.js";
import { validateContent, type ContentIssue } from "../lib/email/render.js";
import { renderSample as renderSampleWith } from "../lib/email/sample-render.js";
import {
  EmailTemplateError,
  listVersions,
  liveContent,
  publishDraft,
  requireDefinition,
  restoreVersion,
  saveDraft,
  templateSummaries,
  type VersionView,
} from "../lib/email/store.js";
import { queueTemplateTestEmail } from "../lib/email-queue.js";
import { fullNameTh } from "../lib/person-name.js";
import { requireAdmin } from "../middleware/auth.js";

export const adminEmailTemplateRouter = Router();
adminEmailTemplateRouter.use(requireAdmin);

const REASON_MIN = 10;

const contentSchema = z
  .object({
    subject: z.string().max(1000).default(""),
    bodyHtml: z.string().max(400_000),
    buttonLabel: z.string().max(1000).nullable().optional(),
    footnoteHtml: z.string().max(10_000).nullable().optional(),
  })
  .strict();

const reasonSchema = z
  .object({ reason: z.string().trim().min(REASON_MIN, `กรุณาระบุเหตุผลอย่างน้อย ${REASON_MIN} ตัวอักษร`).max(500) })
  .strict();

function toContent(body: z.infer<typeof contentSchema>): TemplateContent {
  return {
    subject: body.subject,
    bodyHtml: body.bodyHtml,
    buttonLabel: body.buttonLabel ?? null,
    footnoteHtml: body.footnoteHtml ?? null,
  };
}

/** แปลง error ของ store และ zod เป็นคำตอบ — ทุก handler ห่อด้วยตัวนี้ */
async function handle(res: Response, work: () => Promise<void>): Promise<void> {
  try {
    await work();
  } catch (err) {
    if (err instanceof EmailTemplateError) {
      res.status(err.status).json({ error: err.code, message: err.message });
      return;
    }
    if (err instanceof z.ZodError) {
      const fields: Record<string, string> = {};
      for (const issue of err.issues) fields[String(issue.path[0] ?? "body")] ??= issue.message;
      res.status(400).json({ error: "validation", message: Object.values(fields)[0] ?? "ข้อมูลไม่ถูกต้อง", fields });
      return;
    }
    throw err;
  }
}

function validationFailure(res: Response, issues: ContentIssue[]) {
  const fields: Record<string, string> = {};
  for (const issue of issues) fields[issue.field] ??= issue.message;
  res.status(400).json({
    error: "validation",
    message: `บันทึกไม่ได้ — ${issues[0]?.message ?? "เนื้อหาไม่ถูกต้อง"}${issues.length > 1 ? ` (และอีก ${issues.length - 1} ข้อ)` : ""}`,
    fields,
    issues,
  });
}

/** ชื่อคนจาก id — คอลัมน์ `*_by` ของเวอร์ชัน */
async function namesFor(ids: Array<string | null | undefined>): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return new Map();
  const people = await prisma.userAccount.findMany({
    where: { id: { in: unique } },
    select: { id: true, email: true, displayName: true, prefixTh: true, firstnameTh: true, lastnameTh: true },
  });
  // บัญชี SYSTEM ไม่มีชื่อไทยโดยตั้งใจ ชื่อของมันคือ display_name "ระบบ"
  return new Map(people.map((p) => [p.id, fullNameTh(p) || p.displayName || p.email]));
}

async function withNames(versions: VersionView[]) {
  const names = await namesFor(versions.flatMap((v) => [v.createdBy, v.updatedBy, v.publishedBy]));
  const name = (id: string | null) => (id ? (names.get(id) ?? null) : null);
  return versions.map((v) => ({
    ...v,
    createdByName: name(v.createdBy),
    updatedByName: name(v.updatedBy),
    publishedByName: name(v.publishedBy),
  }));
}

function definitionView(def: TemplateDefinition) {
  const isLayout = def.key === LAYOUT_KEY;
  return {
    key: def.key,
    group: def.group,
    groupLabel: GROUP_LABELS[def.group],
    label: def.label,
    description: def.description,
    isLayout,
    hasButton: def.hasButton,
    variables: (isLayout ? [] : allowedVariables(def)).map((name) => ({ name, label: VARIABLES[name].label, sample: VARIABLES[name].sample })),
    blocks: def.blocks.map((name) => ({ name, label: BLOCK_LABELS[name], required: def.required.includes(name) })),
    layoutPlaceholders: isLayout
      ? [
          { name: "content", label: "เนื้อหาของอีเมลแต่ละฉบับ (ต้องมี)" },
          { name: "footnote", label: "หมายเหตุท้ายอีเมลของแต่ละฉบับ" },
          ...["support.contact", "support.email", "app.url"].map((name) => ({
            name,
            label: VARIABLES[name as keyof typeof VARIABLES].label,
          })),
        ]
      : [],
  };
}

const renderSample = (def: TemplateDefinition, content: TemplateContent, preview: boolean) =>
  renderSampleWith(prisma, def, content, preview);

// ------------------------------------------------------------------ อ่าน

adminEmailTemplateRouter.get("/", async (_req, res) => {
  const rows = await templateSummaries(prisma);
  const names = await namesFor(rows.map((r) => r.updatedBy));
  const templates = TEMPLATES.map((def) => {
    const live = rows.find((r) => r.templateKey === def.key && r.status === "PUBLISHED");
    const draft = rows.find((r) => r.templateKey === def.key && r.status === "DRAFT");
    const latest = [live, draft].filter(Boolean).sort((a, b) => b!.updatedAt.getTime() - a!.updatedAt.getTime())[0];
    return {
      key: def.key,
      group: def.group,
      groupLabel: GROUP_LABELS[def.group],
      label: def.label,
      description: def.description,
      liveVersion: live?.versionNumber ?? 1,
      isDefault: !live || live.versionNumber === 1,
      draftVersion: draft?.versionNumber ?? null,
      updatedAt: latest?.updatedAt ?? null,
      updatedBy: latest ? (names.get(latest.updatedBy) ?? null) : null,
    };
  });
  res.json({ groups: GROUP_LABELS, templates });
});

adminEmailTemplateRouter.get("/:key", async (req, res) => {
  await handle(res, async () => {
    const def = requireDefinition(String(req.params.key));
    const versions = await withNames(await listVersions(prisma, def.key));
    const images = (await listImages(prisma)).map((i) => ({ code: i.code, name: i.name }));
    res.json({
      template: { ...definitionView(def), images },
      live: versions.find((v) => v.status === "PUBLISHED") ?? null,
      draft: versions.find((v) => v.status === "DRAFT") ?? null,
      versions,
    });
  });
});

// ------------------------------------------------------------------ เขียน

adminEmailTemplateRouter.put("/:key/draft", async (req, res) => {
  await handle(res, async () => {
    const def = requireDefinition(String(req.params.key));
    const result = validateContent(def, toContent(contentSchema.parse(req.body ?? {})), await imageCodes(prisma));
    if (result.issues.length) {
      validationFailure(res, result.issues);
      return;
    }
    const draft = await saveDraft(prisma, def.key, result.clean, adminActorId());
    const [named] = await withNames([draft]);
    res.json({ draft: named, warnings: result.warnings, message: `บันทึกฉบับร่าง (เวอร์ชัน ${draft.versionNumber}) แล้ว — อีเมลจริงยังใช้เวอร์ชันที่ใช้งานอยู่จนกว่าจะเผยแพร่` });
  });
});

adminEmailTemplateRouter.post("/:key/publish", async (req, res) => {
  await handle(res, async () => {
    const def = requireDefinition(String(req.params.key));
    const { reason } = reasonSchema.parse(req.body ?? {});
    // ตรวจซ้ำก่อนเผยแพร่ — ฉบับร่างที่ได้มาจาก "นำกลับมาใช้" อาจอ้างตัวแปรที่ catalogue ถอดออกไปแล้ว
    const versions = await listVersions(prisma, def.key);
    const draft = versions.find((v) => v.status === "DRAFT");
    if (!draft) throw new EmailTemplateError(409, "no_draft", "ยังไม่มีฉบับร่างให้เผยแพร่ — บันทึกฉบับร่างก่อน");
    const check = validateContent(def, draft, await imageCodes(prisma));
    if (check.issues.length) {
      validationFailure(res, check.issues);
      return;
    }
    const { published, previousVersion } = (await publishDraft(prisma, def.key, reason, adminActorId()))!;
    await logAudit({
      action: AuditAction.EMAIL_TEMPLATE_PUBLISHED,
      subjectType: AuditSubject.EMAIL_TEMPLATE,
      subjectId: published.id,
      before: { version: previousVersion },
      after: { version: published.versionNumber },
      metadata: { template_key: def.key, version: published.versionNumber, reason },
    });
    const [named] = await withNames([published]);
    res.json({ published: named, message: `เผยแพร่เวอร์ชัน ${published.versionNumber} แล้ว — อีเมลฉบับถัดไปใช้เนื้อหานี้` });
  });
});

adminEmailTemplateRouter.post("/:key/versions/:version/restore", async (req, res) => {
  await handle(res, async () => {
    const def = requireDefinition(String(req.params.key));
    const versionNumber = Number(req.params.version);
    if (!Number.isInteger(versionNumber) || versionNumber < 1) {
      throw new EmailTemplateError(404, "version_not_found", "ไม่มีเวอร์ชันนี้");
    }
    const { reason } = reasonSchema.parse(req.body ?? {});
    const { draft } = (await restoreVersion(prisma, def.key, versionNumber, reason, adminActorId()))!;
    await logAudit({
      action: AuditAction.EMAIL_TEMPLATE_RESTORED,
      subjectType: AuditSubject.EMAIL_TEMPLATE,
      subjectId: draft.id,
      metadata: { template_key: def.key, version: draft.versionNumber, from_version: versionNumber, reason },
    });
    const [named] = await withNames([draft]);
    res.json({
      draft: named,
      message: `คัดลอกเวอร์ชัน ${versionNumber} เป็นฉบับร่าง (เวอร์ชัน ${draft.versionNumber}) แล้ว — กดเผยแพร่เพื่อใช้ส่งจริง`,
    });
  });
});

// ------------------------------------------------------------------ preview + ทดสอบ

const previewSchema = z.union([
  z.object({ versionNumber: z.number().int().min(1) }).strict(),
  z.object({ content: contentSchema }).strict(),
]);

adminEmailTemplateRouter.post("/:key/preview", async (req, res) => {
  await handle(res, async () => {
    const def = requireDefinition(String(req.params.key));
    const body = previewSchema.parse(req.body ?? {});
    let content: TemplateContent;
    if ("versionNumber" in body) {
      const version = (await listVersions(prisma, def.key)).find((v) => v.versionNumber === body.versionNumber);
      if (!version) throw new EmailTemplateError(404, "version_not_found", `ไม่มีเวอร์ชัน ${body.versionNumber}`);
      content = version;
    } else {
      content = toContent(body.content);
    }
    // preview ไม่ปฏิเสธ: แสดง issue พร้อมผลที่ sanitize แล้ว ผู้ดูแลเห็นว่าอะไรจะถูกตัดขณะที่ยังพิมพ์อยู่
    const check = validateContent(def, content, await imageCodes(prisma));
    const rendered = await renderSample(def, check.clean, true);
    res.json({ ...rendered, issues: check.issues, warnings: check.warnings, bytes: Buffer.byteLength(rendered.html) });
  });
});

adminEmailTemplateRouter.post("/:key/test-send", async (req: Request, res) => {
  await handle(res, async () => {
    const def = requireDefinition(String(req.params.key));
    const to = req.session?.email;
    const userAccountId = req.session?.sub;
    if (!to || !userAccountId) {
      // ทาง admin token ไม่มีตัวคน — ส่งทดสอบได้เฉพาะถึงอีเมลของผู้ดูแลที่ล็อกอิน การ์ดห้ามพิมพ์ที่อยู่อื่น
      throw new EmailTemplateError(400, "session_required", "ส่งอีเมลทดสอบได้เฉพาะเมื่อเข้าสู่ระบบด้วยบัญชีผู้ดูแลระบบ — อีเมลจะไปถึงบัญชีนั้น");
    }
    const { content } = z.object({ content: contentSchema }).strict().parse(req.body ?? {});
    const check = validateContent(def, toContent(content), await imageCodes(prisma));
    if (check.issues.length) {
      validationFailure(res, check.issues);
      return;
    }
    // ผ่าน delivery-worker เหมือนอีเมลจริง (การ์ด "Send every email through the delivery worker") — การทดสอบจึงพิสูจน์ด้วยว่า worker
    // กับ SMTP ใช้งานได้ หน้าจอติดตามสถานะด้วย deliveryId worker render เนื้อหาที่ส่งมานี้ด้วยข้อมูลตัวอย่างชุดเดียวกับ preview
    const deliveryId = await queueTemplateTestEmail({ userAccountId, templateKey: def.key, content: { ...check.clean } });
    const live = await liveContent(prisma, def.key);
    const unchanged = JSON.stringify(check.clean) === JSON.stringify(validateContent(def, live.content, await imageCodes(prisma)).clean);
    await logAudit({
      action: AuditAction.EMAIL_TEMPLATE_TEST_SENT,
      subjectType: AuditSubject.EMAIL_TEMPLATE,
      metadata: { template_key: def.key, live_version: live.versionNumber, draft: !unchanged },
    });
    res.json({ to, deliveryId, message: `เข้าคิวอีเมลทดสอบถึง ${to} แล้ว — ใช้ข้อมูลตัวอย่าง หัวเรื่องขึ้นต้นด้วย [ทดสอบ]` });
  });
});
