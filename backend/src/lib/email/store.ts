/**
 * เวอร์ชันของเทมเพลตอีเมลในฐานข้อมูล (`administration.email_template_version`, การ์ด "[New Feature] Admin Email Template Edit")
 *
 * กติกา:
 *   - **ไม่มีแถว = เวอร์ชัน 1 คือเนื้อหาตั้งต้นในโค้ด** (`catalogue.ts`) deploy แล้วไม่ต้อง seed อะไร เวอร์ชัน 1 ถูกเขียนลงตารางจริงครั้งแรก
 *     ตอนมีคนบันทึกฉบับร่าง ประวัติจึงเริ่มจากถ้อยคำเดิมเสมอ และ "คืนค่าเริ่มต้น" = นำเวอร์ชัน 1 กลับมาใช้
 *   - ฉบับร่างมีได้หนึ่งฉบับต่อเทมเพลต บันทึกซ้ำ = เขียนทับฉบับร่างเดิม (ฉบับร่างไม่เคยถูกใช้ส่งจริง ไม่มีอะไรต้องเก็บเป็นหลักฐาน)
 *   - เผยแพร่ = ฉบับร่างกลายเป็น PUBLISHED ฉบับเดิมกลายเป็น SUPERSEDED ไม่มีการลบแถว
 *   - อ่านทุกครั้งที่ส่ง ไม่ cache — API กับ delivery-worker เป็นคนละ process ไม่มีอะไรให้ล้าง
 */
import { EmailTemplateVersionStatus, Prisma, type EmailTemplateVersion, type PrismaClient } from "@prisma/client";

import { SYSTEM_USER_ID } from "../system.js";
import { templateDefinition, type TemplateContent, type TemplateDefinition } from "./catalogue.js";

type Db = PrismaClient | Prisma.TransactionClient;

/** เวอร์ชันหนึ่งในรูปที่ API และหน้าจอใช้ — เวอร์ชัน 1 ที่ยังไม่มีแถวมี `id: null` */
export interface VersionView extends TemplateContent {
  id: string | null;
  versionNumber: number;
  status: EmailTemplateVersionStatus;
  isDefault: boolean;
  restoredFromVersion: number | null;
  restoreReason: string | null;
  publishedAt: Date | null;
  publishedBy: string | null;
  publishReason: string | null;
  supersededAt: Date | null;
  createdAt: Date | null;
  createdBy: string | null;
  updatedAt: Date | null;
  updatedBy: string | null;
}

export class EmailTemplateError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function contentOf(row: Pick<EmailTemplateVersion, "subject" | "bodyHtml" | "buttonLabel" | "footnoteHtml">): TemplateContent {
  return { subject: row.subject, bodyHtml: row.bodyHtml, buttonLabel: row.buttonLabel, footnoteHtml: row.footnoteHtml };
}

function viewOf(row: EmailTemplateVersion): VersionView {
  return {
    ...contentOf(row),
    id: row.id,
    versionNumber: row.versionNumber,
    status: row.status,
    isDefault: row.versionNumber === 1 && row.createdBy === SYSTEM_USER_ID,
    restoredFromVersion: row.restoredFromVersion,
    restoreReason: row.restoreReason,
    publishedAt: row.publishedAt,
    publishedBy: row.publishedBy,
    publishReason: row.publishReason,
    supersededAt: row.supersededAt,
    createdAt: row.createdAt,
    createdBy: row.createdBy,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
  };
}

/** เวอร์ชัน 1 ที่ยังไม่ได้เขียนลงตาราง — เนื้อหาตั้งต้นในโค้ด */
function virtualDefault(def: TemplateDefinition): VersionView {
  return {
    ...def.defaults,
    id: null,
    versionNumber: 1,
    status: EmailTemplateVersionStatus.PUBLISHED,
    isDefault: true,
    restoredFromVersion: null,
    restoreReason: null,
    publishedAt: null,
    publishedBy: null,
    publishReason: null,
    supersededAt: null,
    createdAt: null,
    createdBy: null,
    updatedAt: null,
    updatedBy: null,
  };
}

export function requireDefinition(key: string): TemplateDefinition {
  const def = templateDefinition(key);
  if (!def) throw new EmailTemplateError(404, "not_found", "ไม่มีเทมเพลตอีเมลนี้");
  return def;
}

/** เนื้อหาที่ใช้ส่งจริงตอนนี้ — ฉบับ PUBLISHED หรือเนื้อหาตั้งต้นเมื่อยังไม่มีแถว */
export async function liveContent(db: Db, key: string): Promise<{ content: TemplateContent; versionNumber: number }> {
  const def = requireDefinition(key);
  const row = await db.emailTemplateVersion.findFirst({
    where: { templateKey: key, status: EmailTemplateVersionStatus.PUBLISHED },
  });
  return row ? { content: contentOf(row), versionNumber: row.versionNumber } : { content: def.defaults, versionNumber: 1 };
}

/**
 * เนื้อหาที่ใช้งานอยู่ ณ เวลาหนึ่ง — เวอร์ชันล่าสุดที่เริ่มใช้ก่อนหรือตรงเวลานั้น
 *
 * อีเมลเตือนคำเชิญใช้หาหัวเรื่องของคำเชิญฉบับที่ผู้รับได้รับจริง (`issued_at` ของคีย์) ไม่ใช่หัวเรื่องปัจจุบัน — ถ้าผู้ดูแลเปลี่ยนหัวเรื่อง
 * หลังส่งคำเชิญ ผู้รับต้องค้นกล่องจดหมายด้วยหัวเรื่องเดิมจึงจะเจอ ก่อนเวอร์ชันแรกที่มีแถว คือเวอร์ชัน 1
 */
export async function contentAt(db: Db, key: string, at: Date): Promise<TemplateContent> {
  const def = requireDefinition(key);
  const row =
    (await db.emailTemplateVersion.findFirst({
      where: { templateKey: key, publishedAt: { lte: at } },
      orderBy: { publishedAt: "desc" },
    })) ?? (await db.emailTemplateVersion.findFirst({ where: { templateKey: key, versionNumber: 1 } }));
  return row ? contentOf(row) : def.defaults;
}

/** ทุกเวอร์ชันของเทมเพลตหนึ่ง ใหม่สุดก่อน — มีเวอร์ชัน 1 เสมอ (ตัวจริงหรือเนื้อหาตั้งต้น) */
export async function listVersions(db: Db, key: string): Promise<VersionView[]> {
  const def = requireDefinition(key);
  const rows = await db.emailTemplateVersion.findMany({ where: { templateKey: key }, orderBy: { versionNumber: "desc" } });
  return rows.length ? rows.map(viewOf) : [virtualDefault(def)];
}

/** สรุปของทุกเทมเพลตสำหรับหน้ารายการ — เวอร์ชันที่ใช้งานอยู่ มีฉบับร่างไหม แก้ล่าสุดเมื่อไร */
export async function templateSummaries(db: Db) {
  const rows = await db.emailTemplateVersion.findMany({
    where: { status: { in: [EmailTemplateVersionStatus.PUBLISHED, EmailTemplateVersionStatus.DRAFT] } },
    select: { templateKey: true, status: true, versionNumber: true, updatedAt: true, updatedBy: true, publishedAt: true },
  });
  return rows;
}

/**
 * เขียนเวอร์ชัน 1 ลงตารางถ้ายังไม่มีแถวของ key นี้ — เรียกในธุรกรรมก่อนสร้างฉบับร่างแรก
 *
 * `published_at` = ตอนนี้ (ไม่ใช่วันที่ deploy ซึ่งไม่มีใครรู้) — `contentAt()` ถอยไปหาเวอร์ชัน 1 เองเมื่อไม่มีเวอร์ชันไหนเริ่มก่อนเวลาที่ถาม
 */
async function materialiseDefault(tx: Prisma.TransactionClient, def: TemplateDefinition): Promise<void> {
  const count = await tx.emailTemplateVersion.count({ where: { templateKey: def.key } });
  if (count > 0) return;
  await tx.emailTemplateVersion.create({
    data: {
      templateKey: def.key,
      versionNumber: 1,
      status: EmailTemplateVersionStatus.PUBLISHED,
      ...def.defaults,
      publishedAt: new Date(),
      publishedBy: SYSTEM_USER_ID,
      publishReason: "เนื้อหาตั้งต้นของระบบ",
      createdBy: SYSTEM_USER_ID,
      updatedBy: SYSTEM_USER_ID,
    },
  });
}

/** ฉบับร่างแถวใหม่ หรือเขียนทับฉบับร่างที่มีอยู่ */
async function writeDraft(
  tx: Prisma.TransactionClient,
  def: TemplateDefinition,
  content: TemplateContent,
  actorId: string,
  restore?: { fromVersion: number; reason: string },
): Promise<EmailTemplateVersion> {
  await materialiseDefault(tx, def);
  const existing = await tx.emailTemplateVersion.findFirst({
    where: { templateKey: def.key, status: EmailTemplateVersionStatus.DRAFT },
  });
  const data = {
    ...content,
    restoredFromVersion: restore?.fromVersion ?? null,
    restoreReason: restore?.reason ?? null,
    updatedBy: actorId,
  };
  if (existing) return tx.emailTemplateVersion.update({ where: { id: existing.id }, data });
  const last = await tx.emailTemplateVersion.aggregate({ where: { templateKey: def.key }, _max: { versionNumber: true } });
  return tx.emailTemplateVersion.create({
    data: {
      ...data,
      templateKey: def.key,
      versionNumber: (last._max.versionNumber ?? 0) + 1,
      status: EmailTemplateVersionStatus.DRAFT,
      createdBy: actorId,
    },
  });
}

/** สองคนบันทึกหรือเผยแพร่พร้อมกัน — partial unique index (`uq_email_template_draft` / `_published`) หรือเลขเวอร์ชันชนกัน */
function translateConflict(err: unknown): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    throw new EmailTemplateError(409, "concurrent_edit", "มีผู้ดูแลระบบอีกคนแก้เทมเพลตนี้พร้อมกัน — โหลดหน้าใหม่แล้วลองอีกครั้ง");
  }
  throw err;
}

export async function saveDraft(db: PrismaClient, key: string, content: TemplateContent, actorId: string) {
  const def = requireDefinition(key);
  try {
    return viewOf(await db.$transaction((tx) => writeDraft(tx, def, content, actorId)));
  } catch (err) {
    translateConflict(err);
  }
}

/** นำเวอร์ชันเก่ากลับมาเป็นฉบับร่าง (เขียนทับฉบับร่างที่มีอยู่) — ไม่แก้ประวัติเดิม */
export async function restoreVersion(db: PrismaClient, key: string, versionNumber: number, reason: string, actorId: string) {
  const def = requireDefinition(key);
  try {
    return await db.$transaction(async (tx) => {
      await materialiseDefault(tx, def);
      const source = await tx.emailTemplateVersion.findUnique({
        where: { templateKey_versionNumber: { templateKey: key, versionNumber } },
      });
      if (!source) throw new EmailTemplateError(404, "version_not_found", `ไม่มีเวอร์ชัน ${versionNumber}`);
      if (source.status === EmailTemplateVersionStatus.DRAFT) {
        throw new EmailTemplateError(409, "is_draft", "เวอร์ชันนี้คือฉบับร่างอยู่แล้ว");
      }
      const draft = await writeDraft(tx, def, contentOf(source), actorId, { fromVersion: versionNumber, reason });
      return { draft: viewOf(draft), source: viewOf(source) };
    });
  } catch (err) {
    translateConflict(err);
  }
}

/** เผยแพร่ฉบับร่าง — คืนเวอร์ชันใหม่กับเลขเวอร์ชันที่ถูกแทน */
export async function publishDraft(db: PrismaClient, key: string, reason: string, actorId: string) {
  requireDefinition(key);
  try {
    return await db.$transaction(async (tx) => {
      const draft = await tx.emailTemplateVersion.findFirst({
        where: { templateKey: key, status: EmailTemplateVersionStatus.DRAFT },
      });
      if (!draft) throw new EmailTemplateError(409, "no_draft", "ยังไม่มีฉบับร่างให้เผยแพร่ — บันทึกฉบับร่างก่อน");
      const now = new Date();
      const previous = await tx.emailTemplateVersion.findFirst({
        where: { templateKey: key, status: EmailTemplateVersionStatus.PUBLISHED },
      });
      if (previous) {
        await tx.emailTemplateVersion.update({
          where: { id: previous.id },
          // updated_by ไม่เปลี่ยน — การถูกแทนไม่ใช่การแก้ ประวัติต้องยังบอกว่าใครเป็นคนเขียนเวอร์ชันนั้น
          data: { status: EmailTemplateVersionStatus.SUPERSEDED, supersededAt: now },
        });
      }
      // conditional update: ฉบับร่างที่อีกคนเพิ่งเผยแพร่ไปแล้วจะไม่ตรง WHERE
      const done = await tx.emailTemplateVersion.updateMany({
        where: { id: draft.id, status: EmailTemplateVersionStatus.DRAFT },
        data: {
          status: EmailTemplateVersionStatus.PUBLISHED,
          publishedAt: now,
          publishedBy: actorId,
          publishReason: reason,
          updatedBy: actorId,
        },
      });
      if (done.count !== 1) throw new EmailTemplateError(409, "concurrent_edit", "ฉบับร่างนี้ถูกเผยแพร่ไปแล้ว — โหลดหน้าใหม่");
      const published = await tx.emailTemplateVersion.findUniqueOrThrow({ where: { id: draft.id } });
      return { published: viewOf(published), previousVersion: previous?.versionNumber ?? null };
    });
  } catch (err) {
    translateConflict(err);
  }
}
