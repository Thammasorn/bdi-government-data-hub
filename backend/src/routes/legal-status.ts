/**
 * สถานะเอกสารทางกฎหมายของหน่วยงาน และการลงนามเอกสารเวอร์ชันใหม่ (card "[Enhance] Legal Document Management")
 *
 *   GET  /api/legal-status?tab=all|pending&organizationIds=a,b&documentId=&status=&page=&pageSize=
 *   GET  /api/legal-status/options                       ตัวเลือกตัวกรอง (เอกสาร และหน่วยงานสำหรับ BDI)
 *   GET  /api/legal-status/:organizationId/:documentId/history?page=&pageSize=
 *   GET  /api/legal-status/:organizationId/:documentId/detail?versionId=   เวอร์ชันที่ลงนาม (ไม่ระบุ = ที่ใช้อยู่)
 *   GET  /api/legal-status/:organizationId/:documentId/versions/:versionId/file   PDF ของเวอร์ชันที่หน่วยงานลงนาม
 *   GET  /api/legal-status/approvals/:id                 รายละเอียดงานลงนาม + ลำดับขั้น + เอกสารสำหรับกล่องลงนาม
 *   GET  /api/legal-status/approvals/:id/file            PDF ของเวอร์ชันที่ต้องลงนาม (A0 เติมข้อมูลหน่วยงาน)
 *   GET  /api/legal-status/approvals/:id/current-file    PDF ของเวอร์ชันที่หน่วยงานใช้อยู่ก่อนงานนี้
 *   POST /api/legal-status/approvals/:id/sign            ผู้มีอำนาจอนุมัติของหน่วยงานลงนาม
 *   POST /api/legal-status/approvals/:id/approve         ผู้มีอำนาจอนุมัติของ BDI อนุมัติ
 *   POST /api/legal-status/join                          ผู้มีอำนาจอนุมัติของหน่วยงานขอเข้าร่วมเอกสาร optional — สร้างงานและลงนามในคราวเดียว
 *   GET  /api/legal-status/:organizationId/:documentId/join-file   PDF ของเวอร์ชันที่จะขอเข้าร่วม (อ่านในกล่องลงนาม)
 *
 * เห็นทุกหน่วยงาน: เจ้าหน้าที่ BDI · ผู้มีอำนาจอนุมัติของ BDI · เจ้าหน้าที่กฎหมายของ BDI · ผู้ดูแลระบบ
 * เห็นหน่วยงานตัวเอง: ผู้ใช้และผู้มีอำนาจอนุมัติของหน่วยงาน
 * ทำรายการได้: ผู้มีอำนาจอนุมัติของหน่วยงาน (ลงนาม ขอเข้าร่วม) และผู้มีอำนาจอนุมัติของ BDI (อนุมัติ) — ที่เหลือดูอย่างเดียว
 */
import { AttachmentOwnerType, AttachmentType, OrganizationStatus, type SubjectType } from "@prisma/client";
import type { Request, Response } from "express";
import { z } from "zod";

import { prisma } from "../db.js";
import { Router } from "../lib/async-route.js";
import { activeAttachment, readAttachment, sendRenderedPdf } from "../lib/attachment.js";
import { assertKnownPlaceholders } from "../lib/document-render.js";
import { templateDocx, variableScopeOf } from "../lib/legal.js";
import {
  approvalDetail,
  approveReacceptance,
  isActiveApproverOf,
  previousSignedVersion,
  signedVersionDetail,
  legalHistory,
  legalStatusRows,
  STATUS_FILTERS,
  joinOptionalDocument,
  joinableVersion,
  SUBJECT,
  signReacceptance,
} from "../lib/legal-reacceptance.js";
import { agreementPdf } from "../lib/organization-agreement.js";
import { accountNameTh } from "../lib/person-name.js";
import { ROLE_CODES } from "../lib/system.js";
import { WorkflowError } from "../lib/workflow.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { approvedAgreementRequest } from "./organizations.js";

export const legalStatusRouter = Router();
legalStatusRouter.use(requireAuth);

const SEES_ALL: string[] = [
  ROLE_CODES.BDI_OFFICER,
  ROLE_CODES.BDI_FINAL_APPROVER,
  ROLE_CODES.BDI_LEGAL_OFFICER,
  ROLE_CODES.SYSTEM_ADMINISTRATOR,
];
const ORG_ROLES: string[] = [ROLE_CODES.ORGANIZATION_USER, ROLE_CODES.ORGANIZATION_APPROVER];

type Scope = { all: true } | { all: false; organizationId: string };

/** ขอบเขตที่ผู้เรียกเห็น — null = ไม่มีสิทธิ์ */
function scopeOf(session: { roles: string[]; organizationId: string | null } | undefined): Scope | null {
  if (!session) return null;
  if (session.roles.some((r) => SEES_ALL.includes(r))) return { all: true };
  if (session.organizationId && session.roles.some((r) => ORG_ROLES.includes(r))) {
    return { all: false, organizationId: session.organizationId };
  }
  return null;
}

const canSee = (scope: Scope | null, organizationId: string) => scope !== null && (scope.all || scope.organizationId === organizationId);

function workflowError(error: unknown, res: { status: (code: number) => { json: (body: unknown) => void } }): boolean {
  if (error instanceof WorkflowError) {
    res.status(error.status).json({ error: error.code, message: error.message });
    return true;
  }
  return false;
}

const pageQuery = {
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
};

const listQuery = z.object({
  tab: z.enum(["all", "pending"]).optional().default("all"),
  /** คั่นด้วย "," — เลือกได้หลายหน่วยงาน */
  organizationIds: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(",").filter(Boolean) : []))
    .pipe(z.array(z.string().uuid()).max(200)),
  documentId: z.string().uuid().optional(),
  status: z.enum(STATUS_FILTERS).optional(),
  ...pageQuery,
});

legalStatusRouter.get("/", async (req, res) => {
  const scope = scopeOf(req.session);
  if (!scope) {
    res.status(403).json({ error: "forbidden", message: "ไม่มีสิทธิ์ดูสถานะเอกสารทางกฎหมาย" });
    return;
  }
  const parsed = listQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "validation" });
    return;
  }
  const q = parsed.data;
  const { rows, total } = await legalStatusRows({
    organizationIds: scope.all ? q.organizationIds : [scope.organizationId],
    documentId: q.documentId ?? null,
    status: q.status ?? null,
    // "ที่ต้องดำเนินการ" = ทุกเอกสารในขอบเขตที่ยังไม่เปิดใช้งาน (รอหน่วยงานลงนาม / รอ BDI อนุมัติ) ไม่ว่าใครเป็นคนต้องกด
    // "ยังไม่ได้เข้าร่วม" ไม่นับ — ไม่มีใครต้องทำอะไร (BDI ตัดสิน 2026-11-22) · ปุ่ม "อนุมัติ" ยังขึ้นเฉพาะคนที่ถึงตา
    // ยกเว้นผู้มีอำนาจอนุมัติของ BDI: เฉพาะงานที่รอเขาอนุมัติ (BDI ตัดสิน 2026-11-22)
    onlyPending: q.tab === "pending",
    pendingStatus:
      q.tab === "pending" && req.session!.roles.includes(ROLE_CODES.BDI_FINAL_APPROVER) ? "PENDING_BDI_APPROVAL" : null,
    page: q.page,
    pageSize: q.pageSize,
  });
  res.json({
    rows,
    page: q.page,
    pageSize: q.pageSize,
    total,
    pageCount: Math.max(1, Math.ceil(total / q.pageSize)),
    seesAll: scope.all,
  });
});

/** ตัวเลือกของตัวกรอง — หน่วยงานส่งให้เฉพาะผู้ที่เห็นทุกหน่วยงาน */
legalStatusRouter.get("/options", async (req, res) => {
  const scope = scopeOf(req.session);
  if (!scope) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  const [documents, organizations] = await Promise.all([
    prisma.legalDocument.findMany({
      where: { applicationScope: "ORGANIZATION_REGISTRATION", status: "ACTIVE" },
      orderBy: { displayOrder: "asc" },
      select: { id: true, documentCode: true, nameTh: true, shortname: true },
    }),
    scope.all
      ? prisma.organization.findMany({
          where: { status: { in: [OrganizationStatus.ACTIVE, OrganizationStatus.SUSPENDED] } },
          orderBy: { nameTh: "asc" },
          select: { id: true, nameTh: true },
        })
      : Promise.resolve([]),
  ]);
  res.json({ documents, organizations });
});

legalStatusRouter.get("/:organizationId/:documentId/history", async (req, res) => {
  const scope = scopeOf(req.session);
  const ids = z.object({ organizationId: z.string().uuid(), documentId: z.string().uuid() }).safeParse(req.params);
  const page = z.object(pageQuery).safeParse(req.query);
  if (!ids.success || !page.success) {
    res.status(400).json({ error: "validation" });
    return;
  }
  if (!canSee(scope, ids.data.organizationId)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  const { rows, total } = await legalHistory({ ...ids.data, ...page.data });
  res.json({
    rows,
    page: page.data.page,
    pageSize: page.data.pageSize,
    total,
    pageCount: Math.max(1, Math.ceil(total / page.data.pageSize)),
  });
});

const approvalId = z.object({ id: z.string().uuid() });

legalStatusRouter.get("/approvals/:id", async (req, res) => {
  const params = approvalId.safeParse(req.params);
  if (!params.success) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const detail = await approvalDetail(params.data.id);
  const scope = scopeOf(req.session);
  if (!detail || !canSee(scope, detail.approval.organizationId)) {
    res.status(404).json({ error: "not_found", message: "ไม่พบงานลงนามนี้" });
    return;
  }
  const { approval, progress } = detail;
  const session = req.session!;
  const canSign =
    approval.status === "PENDING_ORG_APPROVAL" &&
    session.roles.includes(ROLE_CODES.ORGANIZATION_APPROVER) &&
    (await isActiveApproverOf(prisma, session.sub, approval.organizationId));
  const canApprove = approval.status === "PENDING_BDI_APPROVAL" && session.roles.includes(ROLE_CODES.BDI_FINAL_APPROVER);
  const previous = await previousSignedVersion({
    organizationId: approval.organizationId,
    legalDocumentId: approval.legalDocument.id,
    approvalId: approval.id,
  });

  res.json({
    approval: {
      id: approval.id,
      status: approval.status,
      organizationId: approval.organizationId,
      organizationName: approval.organization.nameTh,
      /** ปุ่ม "ดูประวัติ" บนหน้างาน — ประวัติเป็นของ (หน่วยงาน, เอกสาร) */
      legalDocumentId: approval.legalDocument.id,
      versionDisplay: approval.legalDocumentVersion.displayVersionNumber,
      effectiveAt: approval.legalDocumentVersion.effectiveAt,
      activatedAt: approval.activatedAt,
      optionalRequest: approval.requestedByUserId !== null,
    },
    /** เวอร์ชันที่หน่วยงานใช้อยู่ก่อนงานนี้ — null เมื่อหน่วยงานไม่เคยมีเอกสารนี้ (ขอเข้าร่วม) */
    current: previous
      ? {
          versionId: previous.version.id,
          versionDisplay: previous.version.displayVersionNumber,
          effectiveAt: previous.version.effectiveAt,
          approvedAt: previous.approvedAt,
          fileUrl: `/api/legal-status/approvals/${approval.id}/current-file`,
        }
      : null,
    /** เอกสารในรูปเดียวกับเอกสารของคำขอ (`LegalDocument` ฝั่งหน้าจอ) — การ์ดเอกสารและกล่องลงนามใช้ได้ทันที */
    document: {
      code: approval.legalDocument.documentCode,
      name: approval.legalDocument.nameTh,
      shortname: approval.legalDocument.shortname,
      // ไม่มีปุ่ม "ไม่เกี่ยวข้อง" ในงานลงนามเอกสาร — คำเตือนของ A3 ที่สั่งให้กดปุ่มนั้นจึงไม่ใช้ที่นี่
      legalNotice: null,
      versionId: approval.legalDocumentVersion.id,
      versionNumber: 0,
      displayVersionNumber: approval.legalDocumentVersion.displayVersionNumber,
      fromRequest: true,
      fileUrl: `/api/legal-status/approvals/${approval.id}/file`,
      acceptedAt: null,
      isRequired: true,
    },
    progress,
    canSign,
    canApprove,
  });
});

/**
 * PDF ของเวอร์ชันที่ต้องลงนาม — อ่านอย่างเดียว ไม่เก็บไฟล์
 *
 * เอกสารที่มี placeholder (A0) เติมด้วยคำขอลงทะเบียนที่อนุมัติแล้วของหน่วยงาน และลายมือชื่อของงานลงนามนี้
 * (ยังไม่ลงนาม = ช่องลายมือชื่อว่าง) — ฉบับอื่นใช้ไฟล์กลางของเวอร์ชัน
 */
legalStatusRouter.get("/approvals/:id/file", async (req, res) => {
  await sendVersionFile(req, res, "pending");
});

legalStatusRouter.get("/approvals/:id/current-file", async (req, res) => {
  await sendVersionFile(req, res, "current");
});

const documentParams = z.object({ organizationId: z.string().uuid(), documentId: z.string().uuid() });

/**
 * เวอร์ชันที่หน่วยงานลงนามของเอกสารหนึ่งฉบับ — ปุ่ม "ดูรายละเอียด" ของแถวที่ไม่มีงานค้าง และของประวัติที่ลงนามตอนลงทะเบียน
 * `current: null` = หน่วยงานยังไม่ได้เข้าร่วม · `pending` = งานลงนามที่ค้างอยู่ (หน้าจอพาไปหน้างานนั้นได้)
 */
legalStatusRouter.get("/:organizationId/:documentId/detail", async (req, res) => {
  const params = documentParams.safeParse(req.params);
  const query = z.object({ versionId: z.string().uuid().optional() }).safeParse(req.query);
  if (!params.success || !query.success) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const { organizationId, documentId } = params.data;
  if (!canSee(scopeOf(req.session), organizationId)) {
    res.status(404).json({ error: "not_found", message: "ไม่พบเอกสารนี้" });
    return;
  }
  const [organization, document, pending, signed] = await Promise.all([
    prisma.organization.findUnique({ where: { id: organizationId }, select: { nameTh: true } }),
    prisma.legalDocument.findUnique({
      where: { id: documentId },
      select: {
        id: true,
        documentCode: true,
        nameTh: true,
        shortname: true,
        legalNotice: true,
        isRequired: true,
        status: true,
        applicationScope: true,
      },
    }),
    prisma.organizationLegalApproval.findFirst({
      where: { organizationId, legalDocumentId: documentId, status: { in: ["PENDING_ORG_APPROVAL", "PENDING_BDI_APPROVAL"] } },
      select: { id: true, status: true, legalDocumentVersion: { select: { displayVersionNumber: true } } },
    }),
    signedVersionDetail({ organizationId, documentId, versionId: query.data.versionId ?? null }),
  ]);
  if (!organization || !document || (query.data.versionId && !signed)) {
    res.status(404).json({ error: "not_found", message: "ไม่พบเอกสารนี้" });
    return;
  }
  /**
   * ปุ่ม "ขอเข้าร่วม" — กติกาเดียวกับที่ POST /join ตรวจ (`joinableVersion`) · ส่งเอกสารเวอร์ชันล่าสุดมาด้วย
   * กล่องลงนามเปิดได้ทันทีโดยไม่ต้องสร้างงานก่อน (feedback 2026-11-22)
   */
  const session = req.session!;
  const joinable =
    !signed && !pending && session.organizationId === organizationId && session.roles.includes(ROLE_CODES.ORGANIZATION_APPROVER)
      ? await joinableVersion({ organizationId, legalDocumentId: documentId, userAccountId: session.sub }).catch(() => null)
      : null;

  res.json({
    organizationId,
    organizationName: organization.nameTh,
    documentId,
    canRequest: joinable !== null,
    /** เอกสารในรูปที่กล่องลงนามรับ — null เมื่อขอเข้าร่วมไม่ได้ */
    joinDocument: joinable
      ? {
          code: joinable.legalDocument.documentCode,
          name: joinable.legalDocument.nameTh,
          shortname: joinable.legalDocument.shortname,
          // คำเตือนของ A3 สั่งให้กด "ไม่เกี่ยวข้อง" ซึ่งไม่มีในกล่องนี้ — ขอเข้าร่วมคือเห็นชอบฉบับนี้
          legalNotice: null,
          versionId: joinable.id,
          versionNumber: 0,
          displayVersionNumber: joinable.displayVersionNumber,
          fromRequest: true,
          fileUrl: `/api/legal-status/${organizationId}/${documentId}/join-file`,
          acceptedAt: null,
          // กล่องลงนามไม่มีปุ่ม "ไม่เกี่ยวข้อง" — ขอเข้าร่วมแล้วคือเห็นชอบฉบับนี้
          isRequired: true,
        }
      : null,
    document: signed
      ? {
          code: document.documentCode,
          name: document.nameTh,
          shortname: document.shortname,
          legalNotice: document.legalNotice,
          versionId: signed.version.id,
          versionNumber: 0,
          displayVersionNumber: signed.version.displayVersionNumber,
          fromRequest: true,
          fileUrl: `/api/legal-status/${organizationId}/${documentId}/versions/${signed.version.id}/file`,
          acceptedAt: null,
          isRequired: document.isRequired,
        }
      : { code: document.documentCode, name: document.nameTh, shortname: document.shortname },
    signed: signed
      ? {
          versionDisplay: signed.version.displayVersionNumber,
          effectiveAt: signed.version.effectiveAt,
          isCurrent: signed.isCurrent,
          orgApprovedAt: signed.orgApprovedAt,
          orgApproverName: signed.orgApproverName,
          bdiApprovedAt: signed.bdiApprovedAt,
          bdiApproverName: signed.bdiApproverName,
          registration: signed.registration,
          approvalId: signed.approvalId,
        }
      : null,
    pending: pending
      ? { approvalId: pending.id, status: pending.status, versionDisplay: pending.legalDocumentVersion.displayVersionNumber }
      : null,
  });
});

legalStatusRouter.get("/:organizationId/:documentId/versions/:versionId/file", async (req, res) => {
  const params = documentParams.extend({ versionId: z.string().uuid() }).safeParse(req.params);
  if (!params.success || !canSee(scopeOf(req.session), params.data.organizationId)) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const signed = await signedVersionDetail(params.data);
  if (!signed) {
    res.status(404).json({ error: "not_found", message: "หน่วยงานไม่ได้ลงนามเอกสารเวอร์ชันนี้" });
    return;
  }
  const version = await prisma.legalDocumentVersion.findUniqueOrThrow({
    where: { id: signed.version.id },
    select: {
      id: true,
      versionNumber: true,
      displayVersionNumber: true,
      effectiveAt: true,
      legalDocument: { select: { documentCode: true, nameTh: true, applicationScope: true } },
    },
  });
  await sendSignedPdf(req, res, { organizationId: params.data.organizationId, version, signatureSubject: signed.signatureSubject });
});

/**
 * PDF ของเวอร์ชันหนึ่งของงานลงนาม — "pending" = เวอร์ชันที่งานนี้ขอให้ลงนาม · "current" = เวอร์ชันที่หน่วยงานใช้อยู่ก่อนงานนี้
 * เอกสารที่มี placeholder render สดด้วยข้อมูลหน่วยงาน (ลายมือชื่อของเรื่องที่ลงนามเวอร์ชันนั้น) · ที่เหลือส่งไฟล์กลางของเวอร์ชัน
 */
async function sendVersionFile(req: Request, res: Response, which: "pending" | "current") {
  const params = approvalId.safeParse(req.params);
  if (!params.success) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const approval = await prisma.organizationLegalApproval.findUnique({
    where: { id: params.data.id },
    select: {
      id: true,
      organizationId: true,
      legalDocumentId: true,
      legalDocumentVersion: {
        select: {
          id: true,
          versionNumber: true,
          displayVersionNumber: true,
          effectiveAt: true,
          legalDocument: { select: { documentCode: true, nameTh: true, applicationScope: true } },
        },
      },
    },
  });
  if (!approval || !canSee(scopeOf(req.session), approval.organizationId)) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  let version = approval.legalDocumentVersion;
  let signatureSubject: { subjectType: SubjectType; subjectId: string } = { subjectType: SUBJECT, subjectId: approval.id };
  if (which === "current") {
    const previous = await previousSignedVersion({
      organizationId: approval.organizationId,
      legalDocumentId: approval.legalDocumentId,
      approvalId: approval.id,
    });
    if (!previous) {
      res.status(404).json({ error: "not_found", message: "หน่วยงานยังไม่มีเอกสารนี้เวอร์ชันก่อนหน้า" });
      return;
    }
    version = await prisma.legalDocumentVersion.findUniqueOrThrow({
      where: { id: previous.version.id },
      select: {
        id: true,
        versionNumber: true,
        displayVersionNumber: true,
        effectiveAt: true,
        legalDocument: { select: { documentCode: true, nameTh: true, applicationScope: true } },
      },
    });
    signatureSubject = previous.signatureSubject;
  }
  await sendSignedPdf(req, res, { organizationId: approval.organizationId, version, signatureSubject });
}

type VersionForFile = {
  id: string;
  versionNumber: number;
  displayVersionNumber: string;
  effectiveAt: Date | null;
  legalDocument: { documentCode: string; nameTh: string; applicationScope: Parameters<typeof variableScopeOf>[0] };
};

/** PDF ของเวอร์ชันหนึ่งสำหรับหน่วยงานหนึ่ง — มี placeholder: render สดพร้อมลายมือชื่อของ `signatureSubject` · ไม่มี: ไฟล์กลาง */
async function sendSignedPdf(
  req: Request,
  res: Response,
  params: { organizationId: string; version: VersionForFile; signatureSubject: { subjectType: SubjectType; subjectId: string } },
) {
  const { version, signatureSubject } = params;
  const filename = `${version.legalDocument.documentCode} ${version.legalDocument.nameTh}.pdf`;
  const hasPlaceholders =
    assertKnownPlaceholders(await templateDocx(prisma, version.id), variableScopeOf(version.legalDocument.applicationScope))
      .length > 0;
  const request = hasPlaceholders ? await approvedAgreementRequest(params.organizationId) : null;
  if (request) {
    const pdf = await agreementPdf(prisma, {
      request,
      document: {
        code: version.legalDocument.documentCode,
        nameTh: version.legalDocument.nameTh,
        versionId: version.id,
        versionNumber: version.versionNumber,
        displayVersionNumber: version.displayVersionNumber,
        effectiveAt: version.effectiveAt,
      },
      printedByName: await accountNameTh(prisma, req.session!.sub),
      signatureSubject,
    });
    sendRenderedPdf(res, pdf, filename);
    return;
  }
  const file = await activeAttachment(prisma, AttachmentOwnerType.LEGAL_DOCUMENT_VERSION, version.id, AttachmentType.GENERATED_FORM);
  if (!file) {
    res.status(404).json({ error: "file_missing", message: "ไม่พบไฟล์ของเอกสารเวอร์ชันนี้" });
    return;
  }
  sendRenderedPdf(res, await readAttachment(file), filename);
}

/** payload เดียวกับ `signature` ของ POST /api/organizations/:id/review — กล่องลงนามส่งรูปนี้ */
const signatureSchema = z.object({
  acknowledgements: z.array(z.object({ versionId: z.string(), attestedAt: z.string().datetime() })).min(1),
  notApplicable: z.array(z.object({ versionId: z.string() })).default([]),
  attestationText: z.string().trim().min(1).max(500).optional(),
  confirmationText: z.string().trim().min(1).max(2000),
});

/** ยืนยันว่าผู้ลงนามเห็นเวอร์ชันเดียวกับที่งานนี้ต้องการ — กันการลงนามบนหน้าที่เปิดค้างไว้ก่อนมีเวอร์ชันใหม่ */
async function acknowledgedVersion(approvalIdValue: string, acknowledged: string[]): Promise<boolean> {
  const approval = await prisma.organizationLegalApproval.findUnique({
    where: { id: approvalIdValue },
    select: { legalDocumentVersionId: true },
  });
  return approval !== null && acknowledged.includes(approval.legalDocumentVersionId);
}

legalStatusRouter.post("/approvals/:id/sign", requireRole(ROLE_CODES.ORGANIZATION_APPROVER), async (req, res) => {
  const params = approvalId.safeParse(req.params);
  const body = signatureSchema.safeParse(req.body ?? {});
  if (!params.success || !body.success || !body.data.attestationText) {
    res.status(400).json({ error: "validation", message: "ต้องติ๊กยืนยันว่าอ่านเอกสารครบก่อนลงนาม" });
    return;
  }
  if (!(await acknowledgedVersion(params.data.id, body.data.acknowledgements.map((a) => a.versionId)))) {
    res.status(400).json({ error: "stale_documents", message: "เอกสารมีเวอร์ชันใหม่ระหว่างที่เปิดหน้านี้อยู่ กรุณาโหลดหน้าและอ่านอีกครั้ง" });
    return;
  }
  try {
    const result = await signReacceptance({
      approvalId: params.data.id,
      userAccountId: req.session!.sub,
      confirmationText: body.data.confirmationText,
      attestationText: body.data.attestationText,
      attestedAt: new Date(body.data.acknowledgements[0]?.attestedAt ?? Date.now()),
      ipAddress: req.ip ?? null,
      userAgent: req.get("user-agent") ?? null,
    });
    res.json(result);
  } catch (error) {
    if (workflowError(error, res)) return;
    throw error;
  }
});

legalStatusRouter.post("/approvals/:id/approve", requireRole(ROLE_CODES.BDI_FINAL_APPROVER), async (req, res) => {
  const params = approvalId.safeParse(req.params);
  const body = signatureSchema.safeParse(req.body ?? {});
  if (!params.success || !body.success) {
    res.status(400).json({ error: "validation" });
    return;
  }
  if (!(await acknowledgedVersion(params.data.id, body.data.acknowledgements.map((a) => a.versionId)))) {
    res.status(400).json({ error: "stale_documents", message: "เอกสารมีเวอร์ชันใหม่ระหว่างที่เปิดหน้านี้อยู่ กรุณาโหลดหน้าและอ่านอีกครั้ง" });
    return;
  }
  try {
    const result = await approveReacceptance({
      approvalId: params.data.id,
      userAccountId: req.session!.sub,
      confirmationText: body.data.confirmationText,
      ipAddress: req.ip ?? null,
      userAgent: req.get("user-agent") ?? null,
    });
    res.json(result);
  } catch (error) {
    if (workflowError(error, res)) return;
    throw error;
  }
});

legalStatusRouter.post("/join", requireRole(ROLE_CODES.ORGANIZATION_APPROVER), async (req, res) => {
  const body = signatureSchema.extend({ documentId: z.string().uuid() }).safeParse(req.body ?? {});
  const organizationId = req.session!.organizationId;
  if (!body.success || !organizationId || !body.data.attestationText) {
    res.status(400).json({ error: "validation", message: "ต้องติ๊กยืนยันว่าอ่านเอกสารครบก่อนลงนาม" });
    return;
  }
  try {
    const result = await joinOptionalDocument({
      organizationId,
      legalDocumentId: body.data.documentId,
      userAccountId: req.session!.sub,
      acknowledgedVersionId: body.data.acknowledgements[0]?.versionId ?? "",
      confirmationText: body.data.confirmationText,
      attestationText: body.data.attestationText,
      attestedAt: new Date(body.data.acknowledgements[0]?.attestedAt ?? Date.now()),
      ipAddress: req.ip ?? null,
      userAgent: req.get("user-agent") ?? null,
    });
    res.status(201).json(result);
  } catch (error) {
    if (workflowError(error, res)) return;
    throw error;
  }
});

/** PDF ของเวอร์ชันที่จะขอเข้าร่วม — ยังไม่มีงาน จึงยังไม่มีลายมือชื่อ (ช่องลายมือชื่อว่าง ถ้าเอกสารมี placeholder) */
legalStatusRouter.get("/:organizationId/:documentId/join-file", async (req, res) => {
  const params = documentParams.safeParse(req.params);
  if (!params.success || !canSee(scopeOf(req.session), params.data.organizationId)) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const latest = await prisma.legalDocumentVersion.findFirst({
    where: { legalDocumentId: params.data.documentId, status: "PUBLISHED" },
    orderBy: { versionNumber: "desc" },
    select: {
      id: true,
      versionNumber: true,
      displayVersionNumber: true,
      effectiveAt: true,
      legalDocument: { select: { documentCode: true, nameTh: true, applicationScope: true } },
    },
  });
  if (!latest) {
    res.status(404).json({ error: "not_found", message: "เอกสารนี้ยังไม่มีเวอร์ชันที่เผยแพร่" });
    return;
  }
  // เรื่องที่ไม่มีลายมือชื่อใด ๆ — ช่องลายมือชื่อในเอกสารที่มี placeholder จึงว่าง เหมือนไฟล์ของงานที่ยังไม่ลงนาม
  await sendSignedPdf(req, res, {
    organizationId: params.data.organizationId,
    version: latest,
    signatureSubject: { subjectType: SUBJECT, subjectId: params.data.organizationId },
  });
});
