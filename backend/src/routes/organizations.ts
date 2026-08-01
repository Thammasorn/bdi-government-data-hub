import { randomUUID } from "node:crypto";

import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import {
  AttachmentKind,
  OrganizationEventType,
  OrganizationStatus,
  Prisma,
  Role,
  UserStatus,
} from "@prisma/client";

import { prisma } from "../db.js";
import { isValidAddress, lookupZipcode } from "../lib/address.js";
import {
  sendActivated,
  sendFinalApprovalRequest,
  sendRevisionRequested,
  sendSignatoryRequest,
  sendSubmittedToOfficers,
} from "../lib/mail.js";
import { renderOrganizationForm } from "../lib/pdf.js";
import { isBdiStaff } from "../lib/roles.js";
import { BUCKET, minio } from "../storage.js";
import {
  emailSchema,
  formatZodError,
  nationalIdSchema,
  phoneSchema,
} from "../lib/validation.js";
import { requireAuth } from "../middleware/auth.js";
import { createInvitation } from "./admin.js";

export const organizationRouter = Router();
organizationRouter.use(requireAuth);

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME = new Set(["application/pdf", "image/jpeg", "image/jpg"]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: (_req, file, cb) => {
    cb(null, ALLOWED_MIME.has(file.mimetype));
  },
});

// ---------------------------------------------------------------- schemas

/** ตอนบันทึกร่างยอมให้ว่างได้ ตอนนำส่งต้องครบ — จึงแยกเป็นสองชุด */
const draftSchema = z.object({
  name: z.string().trim().max(200).optional(),
  addressLine: z.string().trim().max(300).optional(),
  province: z.string().trim().optional(),
  district: z.string().trim().optional(),
  subdistrict: z.string().trim().optional(),
  postalCode: z.string().trim().optional(),
  email: z.string().trim().optional(),

  signatoryPrefix: z.string().trim().optional(),
  signatoryFirstName: z.string().trim().optional(),
  signatoryLastName: z.string().trim().optional(),
  signatoryPosition: z.string().trim().optional(),
  signatoryEmail: z.string().trim().optional(),
  signatoryNationalId: z.string().trim().optional(),
  signatoryPhone: z.string().trim().optional(),

  contactPrefix: z.string().trim().optional(),
  contactFirstName: z.string().trim().optional(),
  contactLastName: z.string().trim().optional(),
  contactPosition: z.string().trim().optional(),
  contactDepartment: z.string().trim().optional(),
  contactEmail: z.string().trim().optional(),
  contactPhone: z.string().trim().optional(),
});

const submitSchema = z.object({
  name: z.string().trim().min(3, "ชื่อหน่วยงานต้องมีอย่างน้อย 3 ตัวอักษร").max(200),
  addressLine: z.string().trim().min(1, "กรุณากรอกที่อยู่"),
  province: z.string().trim().min(1, "กรุณาเลือกจังหวัด"),
  district: z.string().trim().min(1, "กรุณาเลือกอำเภอ/เขต"),
  subdistrict: z.string().trim().min(1, "กรุณาเลือกตำบล/แขวง"),
  postalCode: z.string().trim().regex(/^\d{5}$/, "รหัสไปรษณีย์ต้องเป็นตัวเลข 5 หลัก"),
  email: emailSchema,

  signatoryPrefix: z.string().trim().min(1, "กรุณาเลือกคำนำหน้า"),
  signatoryFirstName: z.string().trim().min(1, "กรุณากรอกชื่อ"),
  signatoryLastName: z.string().trim().min(1, "กรุณากรอกนามสกุล"),
  signatoryPosition: z.string().trim().min(1, "กรุณากรอกตำแหน่ง"),
  signatoryEmail: emailSchema,
  signatoryNationalId: nationalIdSchema,
  signatoryPhone: phoneSchema,

  contactPrefix: z.string().trim().min(1, "กรุณาเลือกคำนำหน้า"),
  contactFirstName: z.string().trim().min(1, "กรุณากรอกชื่อ"),
  contactLastName: z.string().trim().min(1, "กรุณากรอกนามสกุล"),
  contactPosition: z.string().trim().min(1, "กรุณากรอกตำแหน่ง"),
  contactDepartment: z.string().trim().min(1, "กรุณากรอกฝ่าย/กอง/สำนัก"),
  contactEmail: emailSchema,
  contactPhone: phoneSchema,
});

// ---------------------------------------------------------------- helpers

const detailInclude = {
  createdBy: { select: { id: true, email: true, prefix: true, firstName: true, lastName: true } },
  attachments: {
    select: { id: true, kind: true, filename: true, mimeType: true, sizeBytes: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  },
  events: {
    orderBy: { createdAt: "asc" },
    include: { actor: { select: { id: true, firstName: true, lastName: true, email: true } } },
  },
} satisfies Prisma.OrganizationInclude;

async function recordEvent(
  tx: Prisma.TransactionClient,
  organizationId: string,
  type: OrganizationEventType,
  actorId: string | null,
  fromStatus: OrganizationStatus | null,
  toStatus: OrganizationStatus | null,
  note?: string,
) {
  await tx.organizationEvent.create({
    data: { organizationId, type, actorId, fromStatus, toStatus, note },
  });
}

/** ผู้ใช้เห็นหน่วยงานนี้ได้ไหม */
function canView(
  session: { sub: string; roles: Role[]; organizationId: string | null },
  org: { id: string; createdById: string; signatoryEmail: string | null },
  email: string,
): boolean {
  if (isBdiStaff(session.roles)) return true;
  if (org.createdById === session.sub) return true;
  if (session.organizationId === org.id) return true;
  return org.signatoryEmail?.toLowerCase() === email.toLowerCase();
}

async function officerEmails(): Promise<string[]> {
  const users = await prisma.user.findMany({
    where: { roles: { has: Role.BDI_OFFICER }, status: UserStatus.ACTIVE },
    select: { email: true },
  });
  return users.map((u) => u.email);
}

async function approverEmails(): Promise<string[]> {
  const users = await prisma.user.findMany({
    where: { roles: { has: Role.BDI_APPROVER }, status: UserStatus.ACTIVE },
    select: { email: true },
  });
  return users.map((u) => u.email);
}

// ---------------------------------------------------------------- list

organizationRouter.get("/", async (req, res) => {
  const session = req.session!;
  const { status, q } = req.query as { status?: string; q?: string };

  const where: Prisma.OrganizationWhereInput = {};

  if (!isBdiStaff(session.roles)) {
    where.OR = [
      { createdById: session.sub },
      { members: { some: { id: session.sub } } },
      { signatoryEmail: { equals: session.email, mode: "insensitive" } },
    ];
  }

  const statuses = (status ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is OrganizationStatus => s in OrganizationStatus);
  if (statuses.length > 0) where.status = { in: statuses };

  if (q?.trim()) {
    const search = q.trim();
    where.AND = [
      {
        OR: [
          { name: { contains: search, mode: "insensitive" } },
          { createdBy: { email: { contains: search, mode: "insensitive" } } },
          { createdBy: { firstName: { contains: search, mode: "insensitive" } } },
          { createdBy: { lastName: { contains: search, mode: "insensitive" } } },
        ],
      },
    ];
  }

  const organizations = await prisma.organization.findMany({
    where,
    orderBy: [{ submittedAt: "desc" }, { createdAt: "desc" }],
    take: 200,
    select: {
      id: true,
      name: true,
      status: true,
      submittedAt: true,
      createdAt: true,
      createdBy: { select: { firstName: true, lastName: true, email: true } },
    },
  });

  res.json({ organizations });
});

// ---------------------------------------------------------------- create draft

organizationRouter.post("/", async (req, res) => {
  const session = req.session!;
  if (isBdiStaff(session.roles)) {
    res.status(403).json({ error: "forbidden", message: "เจ้าหน้าที่ BDI ไม่สามารถสร้างหน่วยงานได้" });
    return;
  }

  const existing = await prisma.organization.findFirst({
    where: { createdById: session.sub, status: { not: OrganizationStatus.ACTIVE } },
  });
  if (existing) {
    res.status(409).json({ error: "exists", organizationId: existing.id, message: "คุณมีคำขออยู่แล้ว" });
    return;
  }

  const parsed = draftSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "validation", fields: formatZodError(parsed.error) });
    return;
  }

  const org = await prisma.$transaction(async (tx) => {
    const created = await tx.organization.create({
      data: { ...parsed.data, name: parsed.data.name || "หน่วยงานใหม่", createdById: session.sub },
    });
    await recordEvent(tx, created.id, OrganizationEventType.CREATED, session.sub, null, created.status);
    await tx.user.update({ where: { id: session.sub }, data: { organizationId: created.id } });
    return created;
  });

  res.status(201).json({ organization: org });
});

// ---------------------------------------------------------------- detail

organizationRouter.get("/:id", async (req, res) => {
  const org = await prisma.organization.findUnique({
    where: { id: req.params.id },
    include: detailInclude,
  });
  if (!org || !canView(req.session!, org, req.session!.email)) {
    res.status(404).json({ error: "not_found", message: "ไม่พบหน่วยงานนี้" });
    return;
  }
  res.json({ organization: org });
});

// ---------------------------------------------------------------- save draft

organizationRouter.patch("/:id", async (req, res) => {
  const session = req.session!;
  const org = await prisma.organization.findUnique({ where: { id: req.params.id } });
  if (!org || org.createdById !== session.sub) {
    res.status(404).json({ error: "not_found", message: "ไม่พบหน่วยงานนี้" });
    return;
  }
  if (org.status !== OrganizationStatus.DRAFT && org.status !== OrganizationStatus.NEEDS_REVISION) {
    res.status(409).json({ error: "locked", message: "คำขออยู่ระหว่างการตรวจสอบ แก้ไขไม่ได้" });
    return;
  }

  const parsed = draftSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "validation", fields: formatZodError(parsed.error) });
    return;
  }

  const data = { ...parsed.data };
  // เติมรหัสไปรษณีย์ให้อัตโนมัติเมื่อเลือกตำบลครบ
  if (data.province && data.district && data.subdistrict && !data.postalCode) {
    data.postalCode = lookupZipcode(data.province, data.district, data.subdistrict) ?? undefined;
  }

  const updated = await prisma.organization.update({
    where: { id: org.id },
    data: { ...data, ...(data.name ? { name: data.name } : {}) },
  });
  res.json({ organization: updated });
});

// ---------------------------------------------------------------- attachments

organizationRouter.post("/:id/attachments", upload.single("file"), async (req, res) => {
  const session = req.session!;
  const kind = String(req.body?.kind ?? "");
  if (kind !== AttachmentKind.APPOINTMENT_ORDER && kind !== AttachmentKind.POWER_OF_ATTORNEY) {
    res.status(400).json({ error: "validation", message: "ประเภทเอกสารไม่ถูกต้อง" });
    return;
  }
  if (!req.file) {
    res.status(400).json({
      error: "validation",
      message: "รองรับเฉพาะไฟล์ PDF หรือ JPG ขนาดไม่เกิน 10 MB",
    });
    return;
  }

  const org = await prisma.organization.findUnique({ where: { id: req.params.id } });
  if (!org || org.createdById !== session.sub) {
    res.status(404).json({ error: "not_found", message: "ไม่พบหน่วยงานนี้" });
    return;
  }

  const objectKey = `organizations/${org.id}/${kind}/${randomUUID()}`;
  await minio.putObject(BUCKET, objectKey, req.file.buffer, req.file.size, {
    "Content-Type": req.file.mimetype,
  });

  // เอกสารแต่ละประเภทมีได้ฉบับเดียว — อัปโหลดใหม่แทนที่ของเดิม
  const previous = await prisma.attachment.findMany({
    where: { organizationId: org.id, kind: kind as AttachmentKind },
  });
  await Promise.all(
    previous.map((p) => minio.removeObject(BUCKET, p.objectKey).catch(() => undefined)),
  );
  await prisma.attachment.deleteMany({ where: { id: { in: previous.map((p) => p.id) } } });

  const attachment = await prisma.attachment.create({
    data: {
      kind: kind as AttachmentKind,
      objectKey,
      filename: Buffer.from(req.file.originalname, "latin1").toString("utf8"),
      mimeType: req.file.mimetype,
      sizeBytes: req.file.size,
      organizationId: org.id,
      uploadedById: session.sub,
    },
    select: { id: true, kind: true, filename: true, mimeType: true, sizeBytes: true, createdAt: true },
  });

  res.status(201).json({ attachment });
});

organizationRouter.get("/:id/attachments/:attachmentId", async (req, res) => {
  const org = await prisma.organization.findUnique({ where: { id: req.params.id } });
  if (!org || !canView(req.session!, org, req.session!.email)) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const attachment = await prisma.attachment.findFirst({
    where: { id: req.params.attachmentId, organizationId: org.id },
  });
  if (!attachment) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  const stream = await minio.getObject(BUCKET, attachment.objectKey);
  res.setHeader("Content-Type", attachment.mimeType);
  res.setHeader(
    "Content-Disposition",
    `inline; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`,
  );
  stream.pipe(res);
});

// ---------------------------------------------------------------- generate PDF

/**
 * ขั้นตอนที่ 1 ข้อ 5 — ตรวจข้อมูลให้ผ่านก่อน แล้วสร้าง PDF จาก template ให้ผู้ใช้ดู
 */
organizationRouter.post("/:id/generate-form", async (req, res) => {
  const session = req.session!;
  const org = await prisma.organization.findUnique({
    where: { id: req.params.id },
    include: { attachments: true },
  });
  if (!org || org.createdById !== session.sub) {
    res.status(404).json({ error: "not_found", message: "ไม่พบหน่วยงานนี้" });
    return;
  }

  const parsed = submitSchema.safeParse(org);
  if (!parsed.success) {
    res.status(400).json({
      error: "validation",
      message: "ข้อมูลยังไม่ครบถ้วน กรุณาตรวจสอบอีกครั้ง",
      fields: formatZodError(parsed.error),
    });
    return;
  }
  if (!isValidAddress(org.province!, org.district!, org.subdistrict!)) {
    res.status(400).json({
      error: "validation",
      fields: { subdistrict: "ที่อยู่ที่เลือกไม่ตรงกับข้อมูลในระบบ" },
    });
    return;
  }
  if (!org.attachments.some((a) => a.kind === AttachmentKind.APPOINTMENT_ORDER)) {
    res.status(400).json({
      error: "validation",
      fields: { APPOINTMENT_ORDER: "กรุณาแนบคำสั่งแต่งตั้งผู้มีอำนาจกระทำการแทน" },
    });
    return;
  }

  const pdf = await renderOrganizationForm(org);
  const objectKey = `organizations/${org.id}/form/${randomUUID()}.pdf`;
  await minio.putObject(BUCKET, objectKey, pdf, pdf.length, { "Content-Type": "application/pdf" });

  const previous = await prisma.attachment.findMany({
    where: { organizationId: org.id, kind: AttachmentKind.GENERATED_FORM },
  });
  await Promise.all(
    previous.map((p) => minio.removeObject(BUCKET, p.objectKey).catch(() => undefined)),
  );
  await prisma.attachment.deleteMany({ where: { id: { in: previous.map((p) => p.id) } } });

  const attachment = await prisma.attachment.create({
    data: {
      kind: AttachmentKind.GENERATED_FORM,
      objectKey,
      filename: `แบบฟอร์มสร้างหน่วยงาน-${org.name}.pdf`,
      mimeType: "application/pdf",
      sizeBytes: pdf.length,
      organizationId: org.id,
      uploadedById: session.sub,
    },
    select: { id: true, kind: true, filename: true, mimeType: true, sizeBytes: true, createdAt: true },
  });

  res.status(201).json({ attachment });
});

// ---------------------------------------------------------------- submit

organizationRouter.post("/:id/submit", async (req, res) => {
  const session = req.session!;
  const org = await prisma.organization.findUnique({
    where: { id: req.params.id },
    include: { attachments: true },
  });
  if (!org || org.createdById !== session.sub) {
    res.status(404).json({ error: "not_found", message: "ไม่พบหน่วยงานนี้" });
    return;
  }
  if (org.status !== OrganizationStatus.DRAFT && org.status !== OrganizationStatus.NEEDS_REVISION) {
    res.status(409).json({ error: "locked", message: "คำขอนี้นำส่งไปแล้ว" });
    return;
  }

  const parsed = submitSchema.safeParse(org);
  if (!parsed.success) {
    res.status(400).json({ error: "validation", fields: formatZodError(parsed.error) });
    return;
  }
  if (!org.attachments.some((a) => a.kind === AttachmentKind.GENERATED_FORM)) {
    res.status(400).json({ error: "no_form", message: "กรุณาสร้างและตรวจสอบ PDF ก่อนนำส่ง" });
    return;
  }

  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.organization.update({
      where: { id: org.id },
      data: {
        status: OrganizationStatus.PENDING_BDI_REVIEW,
        submittedAt: new Date(),
        revisionNote: null,
      },
    });
    await recordEvent(
      tx,
      org.id,
      OrganizationEventType.SUBMITTED,
      session.sub,
      org.status,
      next.status,
    );
    return next;
  });

  const submitter = [org.contactPrefix, org.contactFirstName, org.contactLastName]
    .filter(Boolean)
    .join(" ");
  await sendSubmittedToOfficers(await officerEmails(), org.name, submitter || session.email, org.id);

  res.json({ organization: updated });
});

// ---------------------------------------------------------------- review

const reviewSchema = z.object({
  action: z.enum(["approve", "request_revision"]),
  note: z.string().trim().optional(),
});

/**
 * จุดตัดสินใจเดียวสำหรับทั้งสามด่าน — ใครทำได้ขึ้นกับสถานะปัจจุบัน
 * รวมไว้ที่เดียวเพื่อให้ state machine อยู่ในไฟล์เดียว ไม่กระจัดกระจาย
 */
organizationRouter.post("/:id/review", async (req, res) => {
  const session = req.session!;
  const parsed = reviewSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "validation", fields: formatZodError(parsed.error) });
    return;
  }
  const { action, note } = parsed.data;

  if (action === "request_revision" && (note?.length ?? 0) < 10) {
    res.status(400).json({
      error: "validation",
      fields: { note: "กรุณาระบุสิ่งที่ต้องแก้ไขอย่างน้อย 10 ตัวอักษร" },
    });
    return;
  }

  const org = await prisma.organization.findUnique({ where: { id: req.params.id } });
  if (!org) {
    res.status(404).json({ error: "not_found", message: "ไม่พบหน่วยงานนี้" });
    return;
  }

  const roles = session.roles;
  const isSignatory = org.signatoryEmail?.toLowerCase() === session.email.toLowerCase();

  let nextStatus: OrganizationStatus;
  let eventType: OrganizationEventType;

  switch (org.status) {
    case OrganizationStatus.PENDING_BDI_REVIEW: {
      if (!roles.includes(Role.BDI_OFFICER)) {
        res.status(403).json({ error: "forbidden", message: "เฉพาะเจ้าหน้าที่ BDI เท่านั้น" });
        return;
      }
      nextStatus =
        action === "approve"
          ? OrganizationStatus.PENDING_SIGNATORY_REVIEW
          : OrganizationStatus.NEEDS_REVISION;
      eventType =
        action === "approve"
          ? OrganizationEventType.BDI_APPROVED
          : OrganizationEventType.BDI_REVISION_REQUESTED;
      break;
    }
    case OrganizationStatus.PENDING_SIGNATORY_REVIEW: {
      if (!isSignatory && !roles.includes(Role.ORGANIZATION_APPROVER)) {
        res.status(403).json({ error: "forbidden", message: "เฉพาะผู้มีอำนาจกระทำการแทนเท่านั้น" });
        return;
      }
      nextStatus =
        action === "approve"
          ? OrganizationStatus.PENDING_BDI_APPROVAL
          : OrganizationStatus.NEEDS_REVISION;
      eventType =
        action === "approve"
          ? OrganizationEventType.SIGNATORY_APPROVED
          : OrganizationEventType.SIGNATORY_REVISION_REQUESTED;
      break;
    }
    case OrganizationStatus.PENDING_BDI_APPROVAL: {
      if (!roles.includes(Role.BDI_APPROVER)) {
        res.status(403).json({ error: "forbidden", message: "เฉพาะผู้อนุมัติ BDI เท่านั้น" });
        return;
      }
      nextStatus =
        action === "approve" ? OrganizationStatus.ACTIVE : OrganizationStatus.NEEDS_REVISION;
      eventType =
        action === "approve"
          ? OrganizationEventType.FINAL_APPROVED
          : OrganizationEventType.FINAL_REVISION_REQUESTED;
      break;
    }
    default:
      res.status(409).json({ error: "invalid_state", message: "สถานะปัจจุบันไม่รองรับการดำเนินการนี้" });
      return;
  }

  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.organization.update({
      where: { id: org.id },
      data: {
        status: nextStatus,
        revisionNote: action === "request_revision" ? (note ?? null) : null,
        activatedAt: nextStatus === OrganizationStatus.ACTIVE ? new Date() : org.activatedAt,
      },
    });
    await recordEvent(tx, org.id, eventType, session.sub, org.status, nextStatus, note);
    return next;
  });

  await dispatchReviewEmails(org, nextStatus, note, session.sub);
  res.json({ organization: updated });
});

async function dispatchReviewEmails(
  org: { id: string; name: string; signatoryEmail: string | null; contactEmail: string | null },
  nextStatus: OrganizationStatus,
  note: string | undefined,
  actorId: string,
) {
  if (nextStatus === OrganizationStatus.NEEDS_REVISION) {
    if (org.contactEmail) await sendRevisionRequested(org.contactEmail, org.name, note ?? "", org.id);
    return;
  }

  if (nextStatus === OrganizationStatus.PENDING_SIGNATORY_REVIEW && org.signatoryEmail) {
    // สเปกขั้นที่ 2 ข้อ 4 — ถ้าผู้มีอำนาจยังไม่มีบัญชี ต้องเพิ่มและส่งลิงก์สมัคร
    const existing = await prisma.user.findUnique({ where: { email: org.signatoryEmail } });
    if (!existing || existing.status !== UserStatus.ACTIVE) {
      const invitation = await createInvitation(
        org.signatoryEmail,
        Role.ORGANIZATION_APPROVER,
        org.id,
        actorId,
      );
      await prisma.organizationEvent.create({
        data: {
          organizationId: org.id,
          type: OrganizationEventType.SIGNATORY_INVITED,
          actorId,
          note: `ส่งคำเชิญไปยัง ${org.signatoryEmail}`,
        },
      });
      void invitation;
      return; // อีเมลคำเชิญถูกส่งไปแล้วใน createInvitation
    }
    // มีบัญชีอยู่แล้ว — ผูก role และหน่วยงานให้ แล้วแจ้งไปตรวจสอบ
    await prisma.user.update({
      where: { id: existing.id },
      data: {
        roles: existing.roles.includes(Role.ORGANIZATION_APPROVER)
          ? existing.roles
          : [...existing.roles, Role.ORGANIZATION_APPROVER],
      },
    });
    await sendSignatoryRequest(org.signatoryEmail, org.name, org.id);
    return;
  }

  if (nextStatus === OrganizationStatus.PENDING_BDI_APPROVAL) {
    await sendFinalApprovalRequest(await approverEmails(), org.name, org.id);
    return;
  }

  if (nextStatus === OrganizationStatus.ACTIVE) {
    await sendActivated(
      [org.contactEmail, org.signatoryEmail].filter((e): e is string => Boolean(e)),
      org.name,
      org.id,
    );
  }
}
