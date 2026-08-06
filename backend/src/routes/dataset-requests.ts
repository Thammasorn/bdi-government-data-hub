import { randomUUID } from "node:crypto";

import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import {
  ActivityAction,
  DatasetAttachmentKind,
  DatasetRequestEventType,
  DatasetRequestStatus,
  NotificationType,
  OrganizationStatus,
  Prisma,
  Role,
  UserStatus,
} from "@prisma/client";

import { prisma } from "../db.js";
import { diffFields, logActivity } from "../lib/activity.js";
import {
  DATASET_ALLOWED_MIME,
  DATASET_MAX_UPLOAD_BYTES,
  datasetDraftSchema,
  datasetSubmitSchema,
  nextRequestNumber,
} from "../lib/dataset.js";
import {
  sendDatasetApproved,
  sendDatasetPendingBdiApproval,
  sendDatasetPendingFinalCheck,
  sendDatasetPendingOrgApprover,
  sendDatasetRejected,
  sendDatasetRevisionRequested,
  sendDatasetSpecialistAssigned,
  sendDatasetSubmitted,
} from "../lib/mail.js";
import {
  bdiApproverIds,
  bdiOfficerIds,
  datasetStakeholderIds,
  emailsOf,
  notifyUsers,
  organizationMemberIds,
} from "../lib/notify.js";
import { renderDatasetRegistrationForm } from "../lib/pdf.js";
import { formatZodError } from "../lib/validation.js";
import { requireAuth } from "../middleware/auth.js";
import { BUCKET, minio } from "../storage.js";

export const datasetRequestRouter = Router();
datasetRequestRouter.use(requireAuth);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: DATASET_MAX_UPLOAD_BYTES },
});

type Session = { sub: string; email: string; roles: Role[]; organizationId: string | null };

// ---------------------------------------------------------------- helpers

const detailInclude = {
  organization: { select: { id: true, name: true, signatoryEmail: true } },
  createdBy: { select: { id: true, email: true, prefix: true, firstName: true, lastName: true } },
  assignedSpecialist: { select: { id: true, email: true, firstName: true, lastName: true } },
  attachments: {
    select: { id: true, kind: true, filename: true, mimeType: true, sizeBytes: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  },
  events: {
    orderBy: { createdAt: "asc" },
    include: { actor: { select: { id: true, firstName: true, lastName: true, email: true } } },
  },
} satisfies Prisma.DatasetRequestInclude;

/**
 * ขอบเขตที่ผู้ใช้แต่ละคนเห็น (docs/01-user-journey.md §4.7)
 *
 * คืน where ว่างแปลว่าเห็นทั้งหมด — เจ้าหน้าที่ BDI ฝั่ง officer/approver
 * ที่เหลือประกอบเงื่อนไข OR: หน่วยงานของตัวเอง, เป็นผู้มีอำนาจของหน่วยงานนั้น,
 * หรือเป็นผู้เชี่ยวชาญที่ถูก assign
 */
function visibilityFilter(session: Session): Prisma.DatasetRequestWhereInput {
  if (session.roles.includes(Role.BDI_OFFICER) || session.roles.includes(Role.BDI_APPROVER)) {
    return {};
  }

  const or: Prisma.DatasetRequestWhereInput[] = [
    { createdById: session.sub },
    { organization: { signatoryEmail: { equals: session.email, mode: "insensitive" } } },
  ];
  if (session.organizationId) or.push({ organizationId: session.organizationId });
  if (session.roles.includes(Role.BDI_SPECIALIST)) or.push({ assignedSpecialistId: session.sub });

  return { OR: or };
}

async function recordEvent(
  tx: Prisma.TransactionClient,
  datasetRequestId: string,
  type: DatasetRequestEventType,
  actorId: string | null,
  fromStatus: DatasetRequestStatus | null,
  toStatus: DatasetRequestStatus | null,
  note?: string,
) {
  await tx.datasetRequestEvent.create({
    data: { datasetRequestId, type, actorId, fromStatus, toStatus, note },
  });
}

async function displayName(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { prefix: true, firstName: true, lastName: true, email: true },
  });
  if (!user) return "ระบบ";
  return [user.prefix, user.firstName, user.lastName].filter(Boolean).join(" ") || user.email;
}

const datasetLabel = (r: { nameTh: string | null; requestNumber: string }) =>
  r.nameTh?.trim() || `คำขอ ${r.requestNumber}`;

/**
 * เงื่อนไขก่อนสร้างคำขอ (§4.1) — คืนข้อความอธิบายเมื่อยังไม่ครบ
 * ใช้ทั้งตอนสร้างจริงและตอนให้หน้าเว็บรู้ว่าจะเปิดปุ่มได้หรือยัง
 */
async function prerequisiteError(session: Session): Promise<string | null> {
  if (!session.roles.includes(Role.ORGANIZATION_USER)) {
    return "เฉพาะผู้ใช้จากหน่วยงานเท่านั้นที่ยื่นคำขอลงทะเบียนชุดข้อมูลได้";
  }
  if (!session.organizationId) return "กรุณาสร้างหน่วยงานของคุณให้เรียบร้อยก่อน";

  const org = await prisma.organization.findUnique({
    where: { id: session.organizationId },
    select: { status: true },
  });
  if (!org) return "ไม่พบหน่วยงานของคุณ";
  if (org.status !== OrganizationStatus.ACTIVE) {
    return "หน่วยงานของคุณต้องผ่านการอนุมัติและเปิดใช้งานก่อนจึงจะลงทะเบียนชุดข้อมูลได้";
  }

  const members = await organizationMemberIds(session.organizationId);
  if (members.users.length === 0) return "หน่วยงานต้องมีผู้ใช้ที่เปิดใช้งานแล้วอย่างน้อยหนึ่งคน";
  if (members.approvers.length === 0) {
    return "หน่วยงานต้องมีผู้มีอำนาจกระทำการแทนที่เปิดใช้งานบัญชีแล้ว จึงจะลงทะเบียนชุดข้อมูลได้";
  }
  return null;
}

/** แปลงค่าที่รับจากฟอร์มเป็นชุดข้อมูลที่เขียนลงตารางได้ */
function draftToData(input: z.infer<typeof datasetDraftSchema>, actorId: string) {
  const { legalAccepted, ...rest } = input;
  const data: Prisma.DatasetRequestUpdateInput = { ...rest };
  if (legalAccepted === true) {
    data.legalAcceptedAt = new Date();
    data.legalAcceptedById = actorId;
  } else if (legalAccepted === false) {
    data.legalAcceptedAt = null;
    data.legalAcceptedById = null;
  }
  return data;
}

// ---------------------------------------------------------------- list

datasetRequestRouter.get("/", async (req, res) => {
  const session = req.session! as Session;
  const { status, q } = req.query as { status?: string; q?: string };

  const where: Prisma.DatasetRequestWhereInput = { ...visibilityFilter(session) };

  const statuses = (status ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is DatasetRequestStatus => s in DatasetRequestStatus);
  if (statuses.length > 0) where.status = { in: statuses };

  if (q?.trim()) {
    const search = q.trim();
    where.AND = [
      {
        OR: [
          { nameTh: { contains: search, mode: "insensitive" } },
          { nameEn: { contains: search, mode: "insensitive" } },
          { requestNumber: { contains: search, mode: "insensitive" } },
          { organization: { name: { contains: search, mode: "insensitive" } } },
        ],
      },
    ];
  }

  const requests = await prisma.datasetRequest.findMany({
    where,
    orderBy: [{ submittedAt: "desc" }, { createdAt: "desc" }],
    take: 200,
    select: {
      id: true,
      requestNumber: true,
      nameTh: true,
      status: true,
      submittedAt: true,
      createdAt: true,
      // หน้าแรกของผู้ใช้หน่วยงานต้องบอก "วันเวลาที่มี update ล่าสุด" คู่กับวันที่นำเข้า
      updatedAt: true,
      organization: { select: { id: true, name: true } },
      createdBy: { select: { firstName: true, lastName: true, email: true } },
      assignedSpecialist: { select: { id: true, firstName: true, lastName: true } },
      // เอกสารที่ระบบสร้าง — ใช้ทำปุ่มดาวน์โหลดในรายการโดยไม่ต้องเปิดคำขอทีละใบ
      attachments: {
        where: { kind: DatasetAttachmentKind.GENERATED_FORM },
        select: { id: true, filename: true },
        take: 1,
      },
    },
  });

  // แบนเป็น generatedForm ตัวเดียว — ฝั่งหน้าเว็บสนใจแค่ว่ามีเอกสารให้โหลดไหม ไม่ใช่ทั้งกอง
  res.json({
    requests: requests.map(({ attachments, ...rest }) => ({
      ...rest,
      generatedForm: attachments[0] ?? null,
    })),
  });
});

/** ให้หน้าเว็บรู้ว่าปุ่ม "ลงทะเบียนชุดข้อมูล" เปิดได้หรือยัง และถ้ายังไม่ได้เพราะอะไร */
datasetRequestRouter.get("/eligibility", async (req, res) => {
  const reason = await prerequisiteError(req.session! as Session);
  res.json({ eligible: reason === null, reason });
});

/** รายชื่อผู้เชี่ยวชาญให้ BDI Officer เลือก assign (§4.4) */
datasetRequestRouter.get("/specialists", async (req, res) => {
  const session = req.session! as Session;
  if (!session.roles.includes(Role.BDI_OFFICER)) {
    res.status(403).json({ error: "forbidden", message: "เฉพาะเจ้าหน้าที่ BDI เท่านั้น" });
    return;
  }
  const specialists = await prisma.user.findMany({
    where: { roles: { has: Role.BDI_SPECIALIST }, status: UserStatus.ACTIVE },
    select: { id: true, email: true, prefix: true, firstName: true, lastName: true },
    orderBy: { firstName: "asc" },
  });
  res.json({ specialists });
});

// ---------------------------------------------------------------- create draft

datasetRequestRouter.post("/", async (req, res) => {
  const session = req.session! as Session;

  const blocked = await prerequisiteError(session);
  if (blocked) {
    res.status(403).json({ error: "not_eligible", message: blocked });
    return;
  }

  const parsed = datasetDraftSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "validation", fields: formatZodError(parsed.error) });
    return;
  }

  const year = new Date().getFullYear();
  const created = await createWithRequestNumber(year, async (requestNumber) =>
    prisma.datasetRequest.create({
      data: {
        ...(draftToData(parsed.data, session.sub) as Prisma.DatasetRequestCreateInput),
        requestNumber,
        organization: { connect: { id: session.organizationId! } },
        createdBy: { connect: { id: session.sub } },
      },
    }),
  );

  await prisma.datasetRequestEvent.create({
    data: {
      datasetRequestId: created.id,
      type: DatasetRequestEventType.CREATED,
      actorId: session.sub,
      toStatus: created.status,
    },
  });
  await logActivity({
    action: ActivityAction.CREATE,
    actorId: session.sub,
    targetType: "DatasetRequest",
    targetId: created.id,
    targetRef: created.requestNumber,
    after: { status: created.status },
    req,
  });

  res.status(201).json({ request: created });
});

/**
 * เลขที่คำขอนับแยกรายปี สองคนกดพร้อมกันอาจได้เลขเดียวกัน — ชนแล้วลองใหม่
 * (ทางเลือกคือ sequence ใน Postgres แต่ต้องเขียน SQL ดิบ ซึ่งเกินความจำเป็นที่ปริมาณงานระดับนี้)
 */
async function createWithRequestNumber<T>(
  year: number,
  create: (requestNumber: string) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const count = await prisma.datasetRequest.count({
      where: { requestNumber: { startsWith: `DR-${year}-` } },
    });
    try {
      return await create(nextRequestNumber(year, count + attempt));
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") continue;
      throw err;
    }
  }
  throw new Error("ออกเลขที่คำขอไม่สำเร็จหลังจากลองหลายครั้ง");
}

// ---------------------------------------------------------------- detail

datasetRequestRouter.get("/:id", async (req, res) => {
  const session = req.session! as Session;
  const request = await prisma.datasetRequest.findFirst({
    where: { id: req.params.id, ...visibilityFilter(session) },
    include: detailInclude,
  });
  if (!request) {
    res.status(404).json({ error: "not_found", message: "ไม่พบคำขอนี้" });
    return;
  }
  res.json({ request });
});

// ---------------------------------------------------------------- save draft

datasetRequestRouter.patch("/:id", async (req, res) => {
  const session = req.session! as Session;
  const request = await prisma.datasetRequest.findUnique({ where: { id: req.params.id } });
  if (!request || !mayEdit(session, request)) {
    res.status(404).json({ error: "not_found", message: "ไม่พบคำขอนี้" });
    return;
  }
  if (
    request.status !== DatasetRequestStatus.DRAFT &&
    request.status !== DatasetRequestStatus.NEEDS_REVISION
  ) {
    res.status(409).json({ error: "locked", message: "คำขออยู่ระหว่างการตรวจสอบ แก้ไขไม่ได้" });
    return;
  }

  const parsed = datasetDraftSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "validation", fields: formatZodError(parsed.error) });
    return;
  }

  const data = draftToData(parsed.data, session.sub);
  const updated = await prisma.datasetRequest.update({ where: { id: request.id }, data });

  const changes = diffFields(
    request as unknown as Record<string, unknown>,
    data as Record<string, unknown>,
  );
  if (changes) {
    await logActivity({
      action: ActivityAction.UPDATE,
      actorId: session.sub,
      targetType: "DatasetRequest",
      targetId: request.id,
      targetRef: request.requestNumber,
      before: changes.before,
      after: changes.after,
      req,
    });
  }

  res.json({ request: updated });
});

/** org user คนไหนก็แก้คำขอของหน่วยงานตัวเองได้ ตามสเปกข้อ 1 */
function mayEdit(session: Session, request: { organizationId: string; createdById: string }): boolean {
  if (request.createdById === session.sub) return true;
  return (
    session.roles.includes(Role.ORGANIZATION_USER) && session.organizationId === request.organizationId
  );
}

// ---------------------------------------------------------------- attachments

datasetRequestRouter.post("/:id/attachments", upload.single("file"), async (req, res) => {
  const session = req.session! as Session;
  const kind = String(req.body?.kind ?? "");
  if (kind !== DatasetAttachmentKind.DATA_DICTIONARY && kind !== DatasetAttachmentKind.EXAMPLE_DATA) {
    res.status(400).json({ error: "validation", message: "ประเภทเอกสารไม่ถูกต้อง" });
    return;
  }
  if (!req.file) {
    res.status(400).json({ error: "validation", message: "กรุณาเลือกไฟล์" });
    return;
  }
  if (!DATASET_ALLOWED_MIME[kind].includes(req.file.mimetype)) {
    res.status(400).json({
      error: "validation",
      fields: {
        [kind]:
          kind === DatasetAttachmentKind.DATA_DICTIONARY
            ? "รองรับเฉพาะไฟล์ PDF, XLSX หรือ CSV ขนาดไม่เกิน 10 MB"
            : "รองรับเฉพาะไฟล์ CSV, XLSX หรือ JSON ขนาดไม่เกิน 10 MB",
      },
    });
    return;
  }

  const request = await prisma.datasetRequest.findUnique({ where: { id: req.params.id } });
  if (!request || !mayEdit(session, request)) {
    res.status(404).json({ error: "not_found", message: "ไม่พบคำขอนี้" });
    return;
  }
  if (
    request.status !== DatasetRequestStatus.DRAFT &&
    request.status !== DatasetRequestStatus.NEEDS_REVISION
  ) {
    res.status(409).json({ error: "locked", message: "คำขออยู่ระหว่างการตรวจสอบ แก้ไขไม่ได้" });
    return;
  }

  const objectKey = `dataset-requests/${request.id}/${kind}/${randomUUID()}`;
  await minio.putObject(BUCKET, objectKey, req.file.buffer, req.file.size, {
    "Content-Type": req.file.mimetype,
  });

  // เอกสารแต่ละประเภทมีได้ฉบับเดียว — อัปโหลดใหม่แทนที่ของเดิม (เหมือน Journey B)
  await replacePrevious(request.id, kind);

  const attachment = await prisma.datasetAttachment.create({
    data: {
      kind,
      objectKey,
      filename: Buffer.from(req.file.originalname, "latin1").toString("utf8"),
      mimeType: req.file.mimetype,
      sizeBytes: req.file.size,
      datasetRequestId: request.id,
      uploadedById: session.sub,
    },
    select: { id: true, kind: true, filename: true, mimeType: true, sizeBytes: true, createdAt: true },
  });

  await logActivity({
    action: ActivityAction.UPDATE,
    actorId: session.sub,
    targetType: "DatasetRequest",
    targetId: request.id,
    targetRef: request.requestNumber,
    after: { attachment: { kind, filename: attachment.filename } },
    req,
  });

  res.status(201).json({ attachment });
});

async function replacePrevious(datasetRequestId: string, kind: DatasetAttachmentKind) {
  const previous = await prisma.datasetAttachment.findMany({ where: { datasetRequestId, kind } });
  await Promise.all(
    previous.map((p) => minio.removeObject(BUCKET, p.objectKey).catch(() => undefined)),
  );
  await prisma.datasetAttachment.deleteMany({ where: { id: { in: previous.map((p) => p.id) } } });
}

datasetRequestRouter.get("/:id/attachments/:attachmentId", async (req, res) => {
  const session = req.session! as Session;
  const request = await prisma.datasetRequest.findFirst({
    where: { id: req.params.id, ...visibilityFilter(session) },
    select: { id: true, requestNumber: true },
  });
  if (!request) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const attachment = await prisma.datasetAttachment.findFirst({
    where: { id: req.params.attachmentId, datasetRequestId: request.id },
  });
  if (!attachment) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  await logActivity({
    action: ActivityAction.DOWNLOAD,
    actorId: session.sub,
    targetType: "DatasetRequest",
    targetId: request.id,
    targetRef: request.requestNumber,
    after: { attachmentId: attachment.id, filename: attachment.filename },
    req,
  });

  const stream = await minio.getObject(BUCKET, attachment.objectKey);
  res.setHeader("Content-Type", attachment.mimeType);
  // ค่าปกติเป็น inline เพราะหน้ารายละเอียดฝัง PDF ไว้ใน <iframe>
  // ปุ่ม "ดาวน์โหลด" ในรายการส่ง ?download=1 มาเพื่อให้เบราว์เซอร์บันทึกไฟล์แทนที่จะเปิดดู
  const disposition = "download" in req.query ? "attachment" : "inline";
  res.setHeader(
    "Content-Disposition",
    `${disposition}; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`,
  );
  stream.pipe(res);
});

// ---------------------------------------------------------------- generate PDF

/** §4.3 ข้อ 4 — ต้องผ่าน validation ทั้งฉบับก่อน แล้วจึงสร้าง PDF ให้ตรวจ */
datasetRequestRouter.post("/:id/generate-form", async (req, res) => {
  const session = req.session! as Session;
  const request = await prisma.datasetRequest.findUnique({
    where: { id: req.params.id },
    include: { attachments: true, organization: { select: { name: true } } },
  });
  if (!request || !mayEdit(session, request)) {
    res.status(404).json({ error: "not_found", message: "ไม่พบคำขอนี้" });
    return;
  }

  const parsed = datasetSubmitSchema.safeParse(request);
  if (!parsed.success) {
    res.status(400).json({
      error: "validation",
      message: "ข้อมูลยังไม่ครบถ้วน กรุณาตรวจสอบอีกครั้ง",
      fields: formatZodError(parsed.error),
    });
    return;
  }
  if (!request.attachments.some((a) => a.kind === DatasetAttachmentKind.DATA_DICTIONARY)) {
    res.status(400).json({
      error: "validation",
      fields: { DATA_DICTIONARY: "กรุณาแนบพจนานุกรมข้อมูล (Data Dictionary)" },
    });
    return;
  }

  const attachment = await buildForm(request, session.sub);
  res.status(201).json({ attachment });
});

/** สร้าง PDF ฉบับใหม่และแทนที่ฉบับเดิม — ใช้ทั้งตอน preview และตอนอนุมัติ */
async function buildForm(
  request: Prisma.DatasetRequestGetPayload<{
    include: { attachments: true; organization: { select: { name: true } } };
  }>,
  actorId: string,
) {
  const pdf = await renderDatasetRegistrationForm(request);
  const objectKey = `dataset-requests/${request.id}/form/${randomUUID()}.pdf`;
  await minio.putObject(BUCKET, objectKey, pdf, pdf.length, { "Content-Type": "application/pdf" });
  await replacePrevious(request.id, DatasetAttachmentKind.GENERATED_FORM);

  return prisma.datasetAttachment.create({
    data: {
      kind: DatasetAttachmentKind.GENERATED_FORM,
      objectKey,
      filename: `แบบฟอร์มลงทะเบียนชุดข้อมูล-${request.requestNumber}.pdf`,
      mimeType: "application/pdf",
      sizeBytes: pdf.length,
      datasetRequestId: request.id,
      uploadedById: actorId,
    },
    select: { id: true, kind: true, filename: true, mimeType: true, sizeBytes: true, createdAt: true },
  });
}

// ---------------------------------------------------------------- submit

datasetRequestRouter.post("/:id/submit", async (req, res) => {
  const session = req.session! as Session;
  const request = await prisma.datasetRequest.findUnique({
    where: { id: req.params.id },
    include: { attachments: true, organization: { select: { name: true } } },
  });
  if (!request || !mayEdit(session, request)) {
    res.status(404).json({ error: "not_found", message: "ไม่พบคำขอนี้" });
    return;
  }
  if (
    request.status !== DatasetRequestStatus.DRAFT &&
    request.status !== DatasetRequestStatus.NEEDS_REVISION
  ) {
    res.status(409).json({ error: "locked", message: "คำขอนี้นำส่งไปแล้ว" });
    return;
  }

  const parsed = datasetSubmitSchema.safeParse(request);
  if (!parsed.success) {
    res.status(400).json({ error: "validation", fields: formatZodError(parsed.error) });
    return;
  }
  if (!request.attachments.some((a) => a.kind === DatasetAttachmentKind.DATA_DICTIONARY)) {
    res.status(400).json({
      error: "validation",
      fields: { DATA_DICTIONARY: "กรุณาแนบพจนานุกรมข้อมูล (Data Dictionary)" },
    });
    return;
  }
  if (!request.attachments.some((a) => a.kind === DatasetAttachmentKind.GENERATED_FORM)) {
    res.status(400).json({ error: "no_form", message: "กรุณาสร้างและตรวจสอบ PDF ก่อนนำส่ง" });
    return;
  }

  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.datasetRequest.update({
      where: { id: request.id },
      data: {
        status: DatasetRequestStatus.PENDING_OFFICER_REVIEW,
        submittedAt: new Date(),
        revisionNote: null,
      },
    });
    await recordEvent(
      tx,
      request.id,
      DatasetRequestEventType.SUBMITTED,
      session.sub,
      request.status,
      next.status,
    );
    return next;
  });

  const officers = await bdiOfficerIds();
  const info = {
    requestNumber: request.requestNumber,
    datasetName: datasetLabel(request),
    organizationName: request.organization.name,
    submitter: await displayName(session.sub),
    id: request.id,
  };
  await notifyUsers(officers, {
    type: NotificationType.DATASET_SUBMITTED,
    title: `มีคำขอลงทะเบียนชุดข้อมูลใหม่ ${request.requestNumber}`,
    body: `${info.organizationName} — ${info.datasetName}`,
    link: `/admin/datasets/${request.id}`,
  });
  await sendDatasetSubmitted(await emailsOf(officers), info);

  await logActivity({
    action: ActivityAction.SUBMIT,
    actorId: session.sub,
    targetType: "DatasetRequest",
    targetId: request.id,
    targetRef: request.requestNumber,
    before: { status: request.status },
    after: { status: updated.status },
    req,
  });

  res.json({ request: updated });
});

// ---------------------------------------------------------------- assign specialist

const assignSchema = z.object({ specialistId: z.string().uuid().nullable() });

/** §4.4 ข้อ 3 — assign ผู้เชี่ยวชาญ (ไม่บังคับ) ทำได้เฉพาะระหว่างการตรวจด่านแรก */
datasetRequestRouter.post("/:id/assign", async (req, res) => {
  const session = req.session! as Session;
  if (!session.roles.includes(Role.BDI_OFFICER)) {
    res.status(403).json({ error: "forbidden", message: "เฉพาะเจ้าหน้าที่ BDI เท่านั้น" });
    return;
  }

  const parsed = assignSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "validation", fields: formatZodError(parsed.error) });
    return;
  }

  const request = await prisma.datasetRequest.findUnique({
    where: { id: req.params.id },
    include: { organization: { select: { name: true } } },
  });
  if (!request) {
    res.status(404).json({ error: "not_found", message: "ไม่พบคำขอนี้" });
    return;
  }
  if (request.status !== DatasetRequestStatus.PENDING_OFFICER_REVIEW) {
    res.status(409).json({
      error: "invalid_state",
      message: "มอบหมายผู้เชี่ยวชาญได้เฉพาะตอนที่คำขออยู่ในขั้นตรวจสอบเบื้องต้น",
    });
    return;
  }

  const { specialistId } = parsed.data;
  if (specialistId) {
    const specialist = await prisma.user.findFirst({
      where: { id: specialistId, roles: { has: Role.BDI_SPECIALIST }, status: UserStatus.ACTIVE },
      select: { id: true, email: true },
    });
    if (!specialist) {
      res.status(400).json({
        error: "validation",
        fields: { specialistId: "ไม่พบผู้เชี่ยวชาญที่เลือก หรือบัญชียังไม่เปิดใช้งาน" },
      });
      return;
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.datasetRequest.update({
      where: { id: request.id },
      data: {
        assignedSpecialistId: specialistId,
        assignedAt: specialistId ? new Date() : null,
      },
    });
    await recordEvent(
      tx,
      request.id,
      specialistId
        ? DatasetRequestEventType.SPECIALIST_ASSIGNED
        : DatasetRequestEventType.SPECIALIST_UNASSIGNED,
      session.sub,
      request.status,
      request.status,
      specialistId ? `มอบหมายให้ ${await displayName(specialistId)}` : "ยกเลิกการมอบหมาย",
    );
    return next;
  });

  if (specialistId) {
    const info = {
      requestNumber: request.requestNumber,
      datasetName: datasetLabel(request),
      organizationName: request.organization.name,
      id: request.id,
    };
    await notifyUsers([specialistId], {
      type: NotificationType.DATASET_SPECIALIST_ASSIGNED,
      title: `คุณได้รับมอบหมายคำขอ ${request.requestNumber}`,
      body: info.datasetName,
      link: `/admin/datasets/${request.id}`,
    });
    const [email] = await emailsOf([specialistId]);
    if (email) await sendDatasetSpecialistAssigned(email, info);
  }

  await logActivity({
    action: ActivityAction.ASSIGN,
    actorId: session.sub,
    targetType: "DatasetRequest",
    targetId: request.id,
    targetRef: request.requestNumber,
    before: { assignedSpecialistId: request.assignedSpecialistId },
    after: { assignedSpecialistId: specialistId },
    req,
  });

  res.json({ request: updated });
});

// ---------------------------------------------------------------- review

const reviewSchema = z.object({
  action: z.enum(["approve", "forward", "confirm", "reject", "request_revision", "comment"]),
  note: z.string().trim().optional(),
});

/**
 * จุดตัดสินใจเดียวของทั้งสี่ด่าน — ใครทำอะไรได้ตัดสินจาก "สถานะปัจจุบัน" ของคำขอ
 * ไม่ใช่จาก path เหมือน POST /organizations/:id/review เพื่อให้ state machine อยู่ในไฟล์เดียว
 */
datasetRequestRouter.post("/:id/review", async (req, res) => {
  const session = req.session! as Session;
  const parsed = reviewSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "validation", fields: formatZodError(parsed.error) });
    return;
  }
  const { action } = parsed.data;
  const note = parsed.data.note?.trim() ?? "";

  if ((action === "request_revision" || action === "reject") && note.length < 10) {
    res.status(400).json({
      error: "validation",
      fields: {
        note:
          action === "reject"
            ? "กรุณาระบุเหตุผลที่ไม่อนุมัติอย่างน้อย 10 ตัวอักษร"
            : "กรุณาระบุสิ่งที่ต้องแก้ไขอย่างน้อย 10 ตัวอักษร",
      },
    });
    return;
  }
  if (action === "comment" && note.length === 0) {
    res.status(400).json({ error: "validation", fields: { note: "กรุณาพิมพ์ความเห็น" } });
    return;
  }

  const request = await prisma.datasetRequest.findUnique({
    where: { id: req.params.id },
    include: { organization: { select: { id: true, name: true, signatoryEmail: true } } },
  });
  if (!request) {
    res.status(404).json({ error: "not_found", message: "ไม่พบคำขอนี้" });
    return;
  }

  const decision = decide(session, request, action);
  if ("error" in decision) {
    res.status(decision.status).json({ error: decision.error, message: decision.message });
    return;
  }

  const now = new Date();
  const actorName = await displayName(session.sub);

  // ความเห็นของผู้เชี่ยวชาญไม่เปลี่ยนสถานะ — บันทึกลง timeline อย่างเดียว (§4.4 ข้อ 4)
  if (decision.nextStatus === null) {
    await prisma.datasetRequestEvent.create({
      data: {
        datasetRequestId: request.id,
        type: decision.eventType,
        actorId: session.sub,
        fromStatus: request.status,
        toStatus: request.status,
        note,
      },
    });
    const officers = await bdiOfficerIds();
    await notifyUsers(officers, {
      type: NotificationType.DATASET_COMMENTED,
      title: `ผู้เชี่ยวชาญบันทึกความเห็นในคำขอ ${request.requestNumber}`,
      body: note,
      link: `/admin/datasets/${request.id}`,
    });
    await logActivity({
      action: ActivityAction.REVIEW,
      actorId: session.sub,
      targetType: "DatasetRequest",
      targetId: request.id,
      targetRef: request.requestNumber,
      after: { comment: note },
      req,
    });
    const refreshed = await prisma.datasetRequest.findUnique({ where: { id: request.id } });
    res.json({ request: refreshed });
    return;
  }

  const nextStatus = decision.nextStatus;
  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.datasetRequest.update({
      where: { id: request.id },
      data: {
        status: nextStatus,
        revisionNote: nextStatus === DatasetRequestStatus.NEEDS_REVISION ? note : null,
        ...(decision.eventType === DatasetRequestEventType.ORG_APPROVER_SIGNED
          ? {
              orgApproverSignedAt: now,
              orgApproverSignedById: session.sub,
              orgApproverSignedName: actorName,
            }
          : {}),
        ...(nextStatus === DatasetRequestStatus.APPROVED
          ? { approvedAt: now, approvedById: session.sub, approvedByName: actorName }
          : {}),
        ...(nextStatus === DatasetRequestStatus.REJECTED
          ? {
              rejectedAt: now,
              rejectedById: session.sub,
              rejectedByName: actorName,
              rejectionReason: note,
            }
          : {}),
      },
    });
    await recordEvent(
      tx,
      request.id,
      decision.eventType,
      session.sub,
      request.status,
      nextStatus,
      note || undefined,
    );
    return next;
  });

  // PDF ฉบับอนุมัติต้องมีเลขที่คำขอ ผู้ลงนามทุกด่านและวันที่อนุมัติ จึงสร้างใหม่หลังบันทึกสถานะ
  if (nextStatus === DatasetRequestStatus.APPROVED) {
    const full = await prisma.datasetRequest.findUniqueOrThrow({
      where: { id: request.id },
      include: { attachments: true, organization: { select: { name: true } } },
    });
    await buildForm(full, session.sub);
  }

  await dispatchDatasetNotifications(request, updated, nextStatus, note, actorName, now);
  await logActivity({
    action: activityFor(nextStatus),
    actorId: session.sub,
    targetType: "DatasetRequest",
    targetId: request.id,
    targetRef: request.requestNumber,
    before: { status: request.status },
    after: { status: nextStatus, note: note || undefined },
    req,
  });

  res.json({ request: updated });
});

type Decision =
  | { nextStatus: DatasetRequestStatus | null; eventType: DatasetRequestEventType }
  | { error: string; message: string; status: number };

const forbidden = (message: string): Decision => ({ error: "forbidden", message, status: 403 });
const invalidState: Decision = {
  error: "invalid_state",
  message: "สถานะปัจจุบันไม่รองรับการดำเนินการนี้",
  status: 409,
};

/** ตารางการตัดสินใจตาม docs/04-dataset-registration-plan.md §2.2 */
function decide(
  session: Session,
  request: {
    status: DatasetRequestStatus;
    organizationId: string;
    assignedSpecialistId: string | null;
    organization: { signatoryEmail: string | null };
  },
  action: z.infer<typeof reviewSchema>["action"],
): Decision {
  const roles = session.roles;
  const advance = action === "approve" || action === "forward" || action === "confirm";
  const isOfficer = roles.includes(Role.BDI_OFFICER);
  const isSpecialist = request.assignedSpecialistId === session.sub;
  const isOrgApprover =
    request.organization.signatoryEmail?.toLowerCase() === session.email.toLowerCase() ||
    (roles.includes(Role.ORGANIZATION_APPROVER) && session.organizationId === request.organizationId);

  switch (request.status) {
    case DatasetRequestStatus.PENDING_OFFICER_REVIEW: {
      if (isOfficer) {
        if (advance) {
          return { nextStatus: DatasetRequestStatus.PENDING_ORG_APPROVER, eventType: DatasetRequestEventType.OFFICER_FORWARDED };
        }
        if (action === "request_revision") {
          return { nextStatus: DatasetRequestStatus.NEEDS_REVISION, eventType: DatasetRequestEventType.OFFICER_REVISION_REQUESTED };
        }
        return invalidState;
      }
      if (isSpecialist) {
        if (action === "comment") {
          return { nextStatus: null, eventType: DatasetRequestEventType.SPECIALIST_COMMENTED };
        }
        if (action === "request_revision") {
          return { nextStatus: DatasetRequestStatus.NEEDS_REVISION, eventType: DatasetRequestEventType.SPECIALIST_REVISION_REQUESTED };
        }
        return forbidden("ผู้เชี่ยวชาญบันทึกความเห็นหรือส่งกลับให้แก้ไขได้เท่านั้น");
      }
      return forbidden("เฉพาะเจ้าหน้าที่ BDI หรือผู้เชี่ยวชาญที่ได้รับมอบหมายเท่านั้น");
    }

    case DatasetRequestStatus.PENDING_ORG_APPROVER: {
      if (!isOrgApprover) return forbidden("เฉพาะผู้มีอำนาจกระทำการแทนของหน่วยงานเท่านั้น");
      if (advance) {
        return { nextStatus: DatasetRequestStatus.PENDING_OFFICER_FINAL_CHECK, eventType: DatasetRequestEventType.ORG_APPROVER_SIGNED };
      }
      if (action === "request_revision") {
        return { nextStatus: DatasetRequestStatus.NEEDS_REVISION, eventType: DatasetRequestEventType.ORG_APPROVER_REVISION_REQUESTED };
      }
      return invalidState;
    }

    case DatasetRequestStatus.PENDING_OFFICER_FINAL_CHECK: {
      if (!isOfficer) return forbidden("เฉพาะเจ้าหน้าที่ BDI เท่านั้น");
      if (advance) {
        return { nextStatus: DatasetRequestStatus.PENDING_BDI_APPROVAL, eventType: DatasetRequestEventType.OFFICER_CONFIRMED };
      }
      if (action === "request_revision") {
        return { nextStatus: DatasetRequestStatus.NEEDS_REVISION, eventType: DatasetRequestEventType.OFFICER_FINAL_REVISION_REQUESTED };
      }
      return invalidState;
    }

    case DatasetRequestStatus.PENDING_BDI_APPROVAL: {
      if (!roles.includes(Role.BDI_APPROVER)) return forbidden("เฉพาะผู้อนุมัติ BDI เท่านั้น");
      if (advance) {
        return { nextStatus: DatasetRequestStatus.APPROVED, eventType: DatasetRequestEventType.BDI_APPROVED };
      }
      if (action === "reject") {
        return { nextStatus: DatasetRequestStatus.REJECTED, eventType: DatasetRequestEventType.BDI_REJECTED };
      }
      if (action === "request_revision") {
        return { nextStatus: DatasetRequestStatus.NEEDS_REVISION, eventType: DatasetRequestEventType.BDI_REVISION_REQUESTED };
      }
      return invalidState;
    }

    default:
      return invalidState;
  }
}

function activityFor(status: DatasetRequestStatus): ActivityAction {
  if (status === DatasetRequestStatus.APPROVED) return ActivityAction.APPROVE;
  if (status === DatasetRequestStatus.REJECTED) return ActivityAction.REJECT;
  if (status === DatasetRequestStatus.NEEDS_REVISION) return ActivityAction.RETURN_FOR_REVISION;
  return ActivityAction.REVIEW;
}

/** อีเมลและ in-app notification เดินคู่กันเสมอ (§4.8) */
async function dispatchDatasetNotifications(
  before: {
    id: string;
    requestNumber: string;
    nameTh: string | null;
    organizationId: string;
    createdById: string;
    assignedSpecialistId: string | null;
    organization: { name: string };
  },
  after: { orgApproverSignedName: string | null },
  nextStatus: DatasetRequestStatus,
  note: string,
  actorName: string,
  at: Date,
) {
  const info = {
    requestNumber: before.requestNumber,
    datasetName: datasetLabel(before),
    organizationName: before.organization.name,
    id: before.id,
  };

  switch (nextStatus) {
    case DatasetRequestStatus.NEEDS_REVISION: {
      const members = await organizationMemberIds(before.organizationId);
      const targets = [...new Set([before.createdById, ...members.users])];
      await notifyUsers(targets, {
        type: NotificationType.DATASET_REVISION_REQUESTED,
        title: `คำขอ ${info.requestNumber} ต้องปรับปรุง`,
        body: `${actorName}: ${note}`,
        link: `/datasets/${before.id}`,
      });
      await sendDatasetRevisionRequested(await emailsOf(targets), {
        ...info,
        note,
        byName: actorName,
        at,
      });
      return;
    }

    case DatasetRequestStatus.PENDING_ORG_APPROVER: {
      const members = await organizationMemberIds(before.organizationId);
      await notifyUsers(members.approvers, {
        type: NotificationType.DATASET_PENDING_ORG_APPROVER,
        title: `รอความเห็นชอบคำขอ ${info.requestNumber}`,
        body: info.datasetName,
        link: `/datasets/${before.id}`,
      });
      await sendDatasetPendingOrgApprover(await emailsOf(members.approvers), info);
      return;
    }

    case DatasetRequestStatus.PENDING_OFFICER_FINAL_CHECK: {
      const officers = await bdiOfficerIds();
      await notifyUsers(officers, {
        type: NotificationType.DATASET_PENDING_FINAL_CHECK,
        title: `รอตรวจสอบขั้นสุดท้าย ${info.requestNumber}`,
        body: info.datasetName,
        link: `/admin/datasets/${before.id}`,
      });
      await sendDatasetPendingFinalCheck(await emailsOf(officers), {
        ...info,
        signedBy: after.orgApproverSignedName ?? actorName,
      });
      return;
    }

    case DatasetRequestStatus.PENDING_BDI_APPROVAL: {
      const approvers = await bdiApproverIds();
      await notifyUsers(approvers, {
        type: NotificationType.DATASET_PENDING_BDI_APPROVAL,
        title: `รออนุมัติคำขอ ${info.requestNumber}`,
        body: info.datasetName,
        link: `/admin/datasets/${before.id}`,
      });
      await sendDatasetPendingBdiApproval(await emailsOf(approvers), info);
      return;
    }

    case DatasetRequestStatus.APPROVED: {
      const stakeholders = await datasetStakeholderIds(before);
      await notifyUsers(stakeholders, {
        type: NotificationType.DATASET_APPROVED,
        title: `อนุมัติคำขอ ${info.requestNumber} แล้ว`,
        body: info.datasetName,
        link: `/datasets/${before.id}`,
      });
      await sendDatasetApproved(await emailsOf(stakeholders), info);
      return;
    }

    case DatasetRequestStatus.REJECTED: {
      const stakeholders = await datasetStakeholderIds(before);
      await notifyUsers(stakeholders, {
        type: NotificationType.DATASET_REJECTED,
        title: `ไม่อนุมัติคำขอ ${info.requestNumber}`,
        body: note,
        link: `/datasets/${before.id}`,
      });
      await sendDatasetRejected(await emailsOf(stakeholders), { ...info, reason: note });
      return;
    }

    default:
      return;
  }
}
