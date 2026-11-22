/**
 * การลงนามเอกสารกฎหมายเวอร์ชันใหม่ (card "[Enhance] Legal Document Management")
 *
 * BDI เผยแพร่ A0–A3 เวอร์ชันใหม่ที่ติ๊ก "ต้องลงนามซ้ำ" (`requires_reacceptance`) แล้ว:
 *
 * - หน่วยงานที่ลงทะเบียนแล้วและเคยลงนามเอกสารนั้น → ล็อก (`organization.access_status = LEGAL_DOCS_UPDATE_REQUIRED`)
 *   และมีงาน `organization_legal_approval` ต่อเอกสาร: ผู้มีอำนาจของหน่วยงานลงนาม (ด่าน ORGANIZATION_APPROVAL)
 *   → ผู้มีอำนาจอนุมัติของ BDI อนุมัติ (ด่าน BDI_FINAL_APPROVAL) → ไม่มีงานค้างเหลือ = ปลดล็อก
 * - คำขอลงทะเบียนที่ยังเปิดอยู่ ก่อนผู้มีอำนาจของหน่วยงานอนุมัติ → ได้ชุดเอกสารใหม่ (snapshot ชุดถัดไป)
 *   หลังอนุมัติแล้ว → ย้อนกลับไปที่ผู้มีอำนาจของหน่วยงาน
 *
 * หน่วยงานที่ข้ามเอกสาร optional (A3) ขอเข้าร่วมเองได้ ด้วยสองด่านเดียวกัน แต่ไม่ล็อกหน่วยงาน
 *
 * กติกาที่ไฟล์นี้ถือ (CLAUDE.md):
 * - ด่านทุกด่านผ่าน `lib/workflow.ts` และการเปลี่ยนสถานะของงานเขียนแบบมีเงื่อนไขใน WHERE — สองคนกดพร้อมกัน คนที่สองได้ 409
 * - notification อีเมล และ audit เกิดหลัง commit เท่านั้น
 * - การเริ่มงานตอนเผยแพร่รันซ้ำได้ผลเดิม: งานค้างของเวอร์ชันเดียวกันไม่ถูกสร้างซ้ำ (ดัชนี `uq_open_organization_legal_approval`)
 *   และหนึ่งหน่วยงานหนึ่งทรานแซกชัน — หน่วยงานหนึ่งล้มไม่ลากหน่วยงานอื่น
 */
import {
  AcceptanceMethod,
  ConfirmationType,
  LegalDocumentStatus,
  LegalDocumentVersionStatus,
  OrganizationAccessStatus,
  OrganizationLegalApprovalStatus,
  OrganizationStatus,
  Prisma,
  RequestStatus,
  ReviewTaskType,
  SubjectType,
  type PrismaClient,
} from "@prisma/client";
import type { Response } from "express";

import { prisma } from "../db.js";
import { AuditAction, AuditSubject, logAudit } from "./audit.js";
import { activeAssignmentWhere, roleIdByCode } from "./iam.js";
import { buildJourneyProgress, LEGAL_DOCS_CHANGED_REASON } from "./journey-steps.js";
import { pinRequestDocuments, skippedDocumentCodes } from "./legal.js";
import { NotificationType, bdiApproverIds, notifyUsers, organizationMemberIds } from "./notify.js";
import { NAME_FIELDS, fullNameTh } from "./person-name.js";
import { ROLE_CODES } from "./system.js";
import {
  TASK_TAKEN_MESSAGE,
  WorkflowError,
  activeTask,
  cancelActiveTask,
  completeTask,
  deriveRequestStatus,
  openTask,
  startTask,
  taskHistory,
} from "./workflow.js";

type Db = PrismaClient | Prisma.TransactionClient;

export const SUBJECT = SubjectType.ORGANIZATION_LEGAL_APPROVAL;
const REGISTRATION = SubjectType.ORGANIZATION_REGISTRATION_REQUEST;
const REGISTRATION_SCOPE = "ORGANIZATION_REGISTRATION";

/** รหัสที่ด่านล็อกตอบ 409 — หน้าจอใช้แยกจากเหตุอื่น */
export const LEGAL_LOCK_CODE = "legal_docs_update_required";
export const LEGAL_LOCK_MESSAGE = "หน่วยงานต้องลงนามเอกสารกฎหมายเวอร์ชันใหม่ก่อนจึงจะทำรายการนี้ได้";

/** เหตุผลบนด่าน BDI ที่ถูกปิดเพราะเอกสารเปลี่ยน — หน้ารายละเอียดคำขอใช้ตัดสินว่าต้องแสดงป้าย "เอกสารมีการเปลี่ยนแปลง" */
export const REGISTRATION_REOPEN_REASON = LEGAL_DOCS_CHANGED_REASON;

const PENDING: OrganizationLegalApprovalStatus[] = [
  OrganizationLegalApprovalStatus.PENDING_ORG_APPROVAL,
  OrganizationLegalApprovalStatus.PENDING_BDI_APPROVAL,
];

// ------------------------------------------------------------------ ด่านล็อก

/** หน่วยงานถูกล็อกจากเอกสารกฎหมายไหม — ทุกเส้นทางชุดข้อมูลและ eligibility ถามที่นี่ที่เดียว */
export async function isLegalLocked(db: Db, organizationId: string): Promise<boolean> {
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { accessStatus: true } });
  return org?.accessStatus === OrganizationAccessStatus.LEGAL_DOCS_UPDATE_REQUIRED;
}

/** สำหรับ route ที่ไม่ได้อยู่ในทรานแซกชัน — แบบเดียวกับ `refuseIfOrganizationFrozen()` */
export async function refuseIfLegalLocked(res: Response, organizationId: string): Promise<boolean> {
  if (!(await isLegalLocked(prisma, organizationId))) return false;
  res.status(409).json({ error: LEGAL_LOCK_CODE, message: LEGAL_LOCK_MESSAGE });
  return true;
}

/** ผู้ใช้ถือ ORGANIZATION_APPROVER ที่ใช้งานอยู่ของหน่วยงานนี้ */
export async function isActiveApproverOf(db: Db, userAccountId: string, organizationId: string): Promise<boolean> {
  const roleId = await roleIdByCode(db, ROLE_CODES.ORGANIZATION_APPROVER);
  const row = await db.userRoleAssignment.findFirst({
    where: { userAccountId, roleId, organizationId, ...activeAssignmentWhere() },
    select: { id: true },
  });
  return row !== null;
}

// ------------------------------------------------------------------ เปิดงานลงนาม

/**
 * เปิดงานลงนามหนึ่งงาน (หน่วยงาน × เอกสาร) และด่านแรก
 *
 * คืน null เมื่อมีงานค้างของ**เวอร์ชันเดียวกัน**อยู่แล้ว (เผยแพร่ซ้ำ / รันซ้ำ) — งานค้างของเวอร์ชันเก่ากว่าถูกยกเลิกก่อน
 * เพราะเวอร์ชันใหม่มาแทน (ตาราง sheet: CANCELLED = มี Version ใหม่มาแทนรายการ Pending)
 */
async function openApproval(
  tx: Prisma.TransactionClient,
  params: {
    organizationId: string;
    legalDocumentId: string;
    versionId: string;
    previousVersionId: string | null;
    requestedByUserId: string | null;
    lock: boolean;
    actorId: string;
  },
): Promise<{ id: string; locked: boolean } | null> {
  const open = await tx.organizationLegalApproval.findMany({
    where: { organizationId: params.organizationId, legalDocumentId: params.legalDocumentId, status: { in: PENDING } },
    select: { id: true, legalDocumentVersionId: true },
  });
  if (open.some((row) => row.legalDocumentVersionId === params.versionId)) return null;
  for (const row of open) {
    await cancelActiveTask(tx, {
      subjectType: SUBJECT,
      subjectId: row.id,
      actorId: params.actorId,
      reason: "มีเอกสารเวอร์ชันใหม่มาแทนงานที่ยังรออนุมัติ",
    });
    await tx.organizationLegalApproval.updateMany({
      where: { id: row.id, status: { in: PENDING } },
      data: { status: OrganizationLegalApprovalStatus.CANCELLED, version: { increment: 1 }, updatedBy: params.actorId },
    });
  }

  const approval = await tx.organizationLegalApproval.create({
    data: {
      organizationId: params.organizationId,
      legalDocumentId: params.legalDocumentId,
      legalDocumentVersionId: params.versionId,
      previousVersionId: params.previousVersionId,
      requestedByUserId: params.requestedByUserId,
      createdBy: params.actorId,
      updatedBy: params.actorId,
    },
  });
  const task = await openTask(tx, {
    subjectType: SUBJECT,
    subjectId: approval.id,
    taskType: ReviewTaskType.ORGANIZATION_APPROVAL,
    assignedRole: ROLE_CODES.ORGANIZATION_APPROVER,
    actorId: params.actorId,
  });
  await tx.organizationLegalApproval.update({
    where: { id: approval.id },
    data: { orgApprovalReviewTaskId: task.id },
  });

  let locked = false;
  if (params.lock) {
    const { count } = await tx.organization.updateMany({
      where: { id: params.organizationId, accessStatus: OrganizationAccessStatus.ACTIVE },
      data: {
        accessStatus: OrganizationAccessStatus.LEGAL_DOCS_UPDATE_REQUIRED,
        accessStatusChangedAt: new Date(),
        updatedBy: params.actorId,
      },
    });
    locked = count > 0;
  }
  return { id: approval.id, locked };
}

export interface ReacceptanceSummary {
  /** หน่วยงานที่ได้งานลงนามใหม่ */
  organizations: number;
  /** หน่วยงานที่มีงานของเวอร์ชันนี้อยู่แล้ว (รันซ้ำ) */
  skipped: number;
  /** หน่วยงานที่เปิดงานไม่สำเร็จ — ดู error log รันซ้ำได้ */
  failed: number;
  registrationsRefreshed: number;
  registrationsReopened: number;
}

/**
 * เรียกหลังเวอร์ชันถูกเผยแพร่แล้ว (อัปโหลดแบบ "ใช้ทันที" หรือกด "ใช้เวอร์ชันนี้" กับฉบับร่าง)
 * ไม่ทำอะไรถ้าเวอร์ชันไม่ได้ติ๊กลงนามซ้ำ ยังไม่เผยแพร่ หรือไม่ใช่เอกสารของคำขอลงทะเบียน
 */
export async function startReacceptance(params: {
  versionId: string;
  actorId: string;
}): Promise<ReacceptanceSummary> {
  const summary: ReacceptanceSummary = {
    organizations: 0,
    skipped: 0,
    failed: 0,
    registrationsRefreshed: 0,
    registrationsReopened: 0,
  };
  const version = await prisma.legalDocumentVersion.findUnique({
    where: { id: params.versionId },
    select: {
      id: true,
      legalDocumentId: true,
      versionNumber: true,
      requiresReacceptance: true,
      status: true,
      legalDocument: { select: { applicationScope: true } },
    },
  });
  if (
    !version ||
    !version.requiresReacceptance ||
    version.status !== LegalDocumentVersionStatus.PUBLISHED ||
    version.legalDocument.applicationScope !== REGISTRATION_SCOPE
  ) {
    return summary;
  }

  const registrations = await applyToOpenRegistrations(params.actorId, version.legalDocumentId);
  summary.registrationsRefreshed = registrations.refreshed;
  summary.registrationsReopened = registrations.reopened;

  const previous = await prisma.legalDocumentVersion.findFirst({
    where: { legalDocumentId: version.legalDocumentId, versionNumber: { lt: version.versionNumber } },
    orderBy: { versionNumber: "desc" },
    select: { id: true },
  });

  /**
   * หน่วยงานที่ลงทะเบียนแล้วและมีเอกสารนี้**มีผล**อยู่ (เวอร์ชันใดก็ได้) แต่ยังไม่ได้ลงนามเวอร์ชันนี้ — A3 ที่ข้ามไว้ไม่มี acceptance จึงไม่ถูกนับ
   *
   * ไม่นับลายมือชื่อของงานที่ยังรอ BDI หรือถูกยกเลิก: หน่วยงานที่กำลังขอเข้าร่วม A3 (ลงนามแล้ว รอ BDI) ยังไม่เคยมี A3 มีผล
   * ถ้านับ จะถูกล็อกด้วยเอกสารที่ตัวเองยังไม่ได้เข้าร่วม — คำขอเข้าร่วมย้ายไปเวอร์ชันใหม่แบบไม่ล็อกแทน (`joiners` ข้างล่าง)
   */
  const notInForce = await prisma.organizationLegalApproval.findMany({
    where: {
      legalDocumentId: version.legalDocumentId,
      status: { in: [...PENDING, OrganizationLegalApprovalStatus.CANCELLED] },
    },
    select: { id: true },
  });
  const signers = await prisma.legalAcceptance.findMany({
    where: {
      legalDocumentVersion: { legalDocumentId: version.legalDocumentId },
      organization: { status: { in: [OrganizationStatus.ACTIVE, OrganizationStatus.SUSPENDED] } },
      NOT: { subjectId: { in: notInForce.map((a) => a.id) } },
    },
    distinct: ["organizationId"],
    select: { organizationId: true },
  });
  const signerIds = new Set(signers.map((s) => s.organizationId));
  /**
   * คำขอเข้าร่วมที่ค้างอยู่ (เวอร์ชันเก่า) ของหน่วยงานที่ไม่มีเอกสารนี้มีผล — ย้ายไปเวอร์ชันใหม่ ผู้มีอำนาจลงนามใหม่ ไม่ล็อก
   * งานเดิมถูกยกเลิกใน `openApproval()` เหมือนงานลงนามซ้ำ (test case G3)
   */
  const joiners = await prisma.organizationLegalApproval.findMany({
    where: {
      legalDocumentId: version.legalDocumentId,
      status: { in: PENDING },
      requestedByUserId: { not: null },
      legalDocumentVersionId: { not: version.id },
    },
    select: { organizationId: true, requestedByUserId: true },
  });
  const targets: Array<{ organizationId: string; requestedByUserId: string | null; lock: boolean }> = [
    ...signers.map((s) => ({ organizationId: s.organizationId, requestedByUserId: null, lock: true })),
    ...joiners
      .filter((j) => !signerIds.has(j.organizationId))
      .map((j) => ({ organizationId: j.organizationId, requestedByUserId: j.requestedByUserId, lock: false })),
  ];
  const alreadySigned = new Set(
    (
      await prisma.legalAcceptance.findMany({
        // ลายมือชื่อที่มีผลเท่านั้น — ของงานที่ยังรอหรือถูกยกเลิกไม่นับ (กติกาเดียวกับ `signers`)
        where: { legalDocumentVersionId: version.id, NOT: { subjectId: { in: notInForce.map((a) => a.id) } } },
        distinct: ["organizationId"],
        select: { organizationId: true },
      })
    ).map((row) => row.organizationId),
  );

  for (const { organizationId, requestedByUserId, lock } of targets) {
    if (alreadySigned.has(organizationId)) continue;
    let opened: { id: string; locked: boolean } | null;
    try {
      opened = await prisma.$transaction((tx) =>
        openApproval(tx, {
          organizationId,
          legalDocumentId: version.legalDocumentId,
          versionId: version.id,
          previousVersionId: previous?.id ?? null,
          requestedByUserId,
          lock,
          actorId: params.actorId,
        }),
      );
    } catch (error) {
      // สองคำสั่งเผยแพร่ชนกัน — อีกฝั่งเปิดงานไปแล้ว
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        summary.skipped += 1;
        continue;
      }
      summary.failed += 1;
      console.error("[legal-reacceptance] เปิดงานลงนามไม่สำเร็จ", organizationId, error);
      continue;
    }
    if (!opened) {
      summary.skipped += 1;
      continue;
    }
    summary.organizations += 1;

    await logAudit({
      action: AuditAction.LEGAL_REACCEPTANCE_STARTED,
      subjectType: AuditSubject.ORGANIZATION_LEGAL_APPROVAL,
      subjectId: opened.id,
      organizationId,
      after: { legalDocumentVersionId: version.id },
      metadata: { reason: "NEW_LEGAL_VERSION" },
    });
    if (opened.locked) {
      await logAudit({
        action: AuditAction.ORGANIZATION_ACCESS_CHANGED,
        subjectType: AuditSubject.ORGANIZATION,
        subjectId: organizationId,
        organizationId,
        after: { accessStatus: OrganizationAccessStatus.LEGAL_DOCS_UPDATE_REQUIRED },
        metadata: { approval_id: opened.id },
      });
    }
    const members = await organizationMemberIds(organizationId);
    const notice = { subjectType: SUBJECT, subjectId: opened.id, organizationId };
    // ข้อความถึงผู้ประสานงานบอกว่าหน่วยงานถูกล็อก — คำขอเข้าร่วมที่ย้ายไปเวอร์ชันใหม่ไม่ล็อก จึงแจ้งเฉพาะผู้มีอำนาจ
    if (lock) await notifyUsers(members.users, {
      ...notice,
      type: NotificationType.LEGAL_REACCEPTANCE_REQUESTED_OFFICER,
      title: "มีเอกสารกฎหมายเวอร์ชันใหม่ รอผู้มีอำนาจอนุมัติของหน่วยงาน",
      message: "หน่วยงานทำรายการชุดข้อมูลไม่ได้จนกว่าผู้มีอำนาจอนุมัติของหน่วยงานจะลงนามเอกสารเวอร์ชันใหม่",
    });
    await notifyUsers(members.approvers, {
      ...notice,
      type: NotificationType.LEGAL_REACCEPTANCE_REQUESTED_APPROVER,
      title: "มีเอกสารกฎหมายเวอร์ชันใหม่ ให้ดำเนินการอนุมัติ",
      message: "กรุณาอ่านและลงนามเอกสารกฎหมายเวอร์ชันใหม่ของหน่วยงาน",
    });
  }

  return summary;
}

// ------------------------------------------------------------------ คำขอลงทะเบียนที่ยังเปิดอยู่

/**
 * ก่อนผู้มีอำนาจของหน่วยงานอนุมัติ (ด่าน BDI_OFFICER_REVIEW หรือ ORGANIZATION_APPROVAL เปิดอยู่) → snapshot ชุดถัดไปด้วยเวอร์ชันล่าสุด
 * หลังอนุมัติแล้ว (ด่าน BDI_FINAL_APPROVAL เปิดอยู่) → ปิดด่าน BDI แล้วเปิดด่านผู้มีอำนาจของหน่วยงานใหม่ พร้อม snapshot ชุดใหม่
 * ด่านถูกอ่านซ้ำในทรานแซกชันของแต่ละคำขอ — ถ้ามีคนกดผ่านด่านไปพอดี คำขอนั้นถูกจัดการตามด่านใหม่
 */
async function applyToOpenRegistrations(
  actorId: string,
  /** เอกสารที่เปลี่ยน — คำขอที่ผู้มีอำนาจกด "ไม่เกี่ยวข้อง" กับเอกสารนี้ในรอบนี้ไม่ถูกส่งกลับ (A3 ที่ข้ามไว้) */
  legalDocumentId: string,
): Promise<{ refreshed: number; reopened: number }> {
  const changed = await prisma.legalDocument.findUnique({ where: { id: legalDocumentId }, select: { documentCode: true } });
  const open = await prisma.organizationRegistrationRequest.findMany({
    where: { status: { in: [RequestStatus.SUBMITTED, RequestStatus.UNDER_REVIEW] } },
    select: { id: true, organizationId: true },
  });
  let refreshed = 0;
  const reopened: Array<{ id: string; organizationId: string }> = [];
  for (const request of open) {
    const outcome = await prisma.$transaction(async (tx) => {
      const gate = await activeTask(tx, REGISTRATION, request.id);
      if (!gate) return "none" as const;
      if (gate.taskType === ReviewTaskType.BDI_FINAL_APPROVAL) {
        // ผู้มีอำนาจระบุว่าเอกสารนี้ไม่เกี่ยวข้องตอนลงนามรอบนี้ (A3 optional) — ฉบับใหม่ของมันไม่เปลี่ยนสิ่งที่เขาอนุมัติ ไม่ต้องย้อน
        if (changed && (await skippedDocumentCodes(tx, { subjectType: REGISTRATION, subjectId: request.id })).has(changed.documentCode)) {
          return "none" as const;
        }
        const prior = await tx.reviewTask.findFirst({
          where: {
            subjectType: REGISTRATION,
            subjectId: request.id,
            taskType: ReviewTaskType.ORGANIZATION_APPROVAL,
            status: "COMPLETED",
          },
          orderBy: { sequenceNumber: "desc" },
          select: { assignedUserId: true },
        });
        const cancelled = await cancelActiveTask(tx, {
          subjectType: REGISTRATION,
          subjectId: request.id,
          actorId,
          reason: REGISTRATION_REOPEN_REASON,
        });
        if (!cancelled) return "none" as const;
        await openTask(tx, {
          subjectType: REGISTRATION,
          subjectId: request.id,
          taskType: ReviewTaskType.ORGANIZATION_APPROVAL,
          assignedUserId: prior?.assignedUserId ?? null,
          assignedRole: ROLE_CODES.ORGANIZATION_APPROVER,
          actorId,
        });
        await pinRequestDocuments(tx, REGISTRATION_SCOPE, { subjectType: REGISTRATION, subjectId: request.id });
        // แบบเดียวกับ syncStatus() ใน routes/organizations.ts — ทุกเส้นทางที่เขียน review_task ต้องจบที่นี่
        const status = await deriveRequestStatus(tx, {
          subjectType: REGISTRATION,
          subjectId: request.id,
          hasSubmitted: true,
          cancelled: false,
        });
        await tx.organizationRegistrationRequest.update({ where: { id: request.id }, data: { status, updatedBy: actorId } });
        return "reopened" as const;
      }
      if (gate.taskType === ReviewTaskType.BDI_OFFICER_REVIEW || gate.taskType === ReviewTaskType.ORGANIZATION_APPROVAL) {
        await pinRequestDocuments(tx, REGISTRATION_SCOPE, { subjectType: REGISTRATION, subjectId: request.id });
        await tx.organizationRegistrationRequest.update({ where: { id: request.id }, data: { updatedBy: actorId } });
        return "refreshed" as const;
      }
      return "none" as const;
    });
    if (outcome === "refreshed") refreshed += 1;
    if (outcome === "reopened") reopened.push(request);
    if (outcome !== "none") {
      await logAudit({
        action: AuditAction.REQUEST_DOCUMENTS_CHANGED,
        subjectType: AuditSubject.ORGANIZATION_REGISTRATION_REQUEST,
        subjectId: request.id,
        organizationId: request.organizationId,
        metadata: { outcome: outcome === "reopened" ? "RETURNED_TO_ORGANIZATION_APPROVER" : "SNAPSHOT_REFRESHED" },
      });
    }
  }

  for (const request of reopened) {
    const members = await organizationMemberIds(request.organizationId);
    await notifyUsers([...members.users, ...members.approvers], {
      type: NotificationType.REGISTRATION_DOCUMENTS_CHANGED,
      title: "เอกสารมีการเปลี่ยนแปลง ต้องอนุมัติใหม่อีกครั้ง",
      message: "BDI เปลี่ยนเวอร์ชันเอกสารกฎหมายระหว่างที่คำขอลงทะเบียนรอการอนุมัติ ผู้มีอำนาจอนุมัติของหน่วยงานต้องอนุมัติคำขออีกครั้ง",
      subjectType: REGISTRATION,
      subjectId: request.id,
      organizationId: request.organizationId,
    });
  }
  return { refreshed, reopened: reopened.length };
}

// ------------------------------------------------------------------ เอกสาร optional

/**
 * ขอเข้าร่วมเอกสาร optional — สร้างงานและลงนามในคราวเดียว (feedback 2026-11-22)
 *
 * กด "ขอเข้าร่วม" แล้วกล่องลงนามเปิดทันที · กดยกเลิก = ไม่มีอะไรถูกบันทึก สถานะยังเป็น "ยังไม่ได้เข้าร่วม"
 * (เดิมสร้างงาน "รอหน่วยงานลงนาม" ก่อน แล้วให้ไปลงนามอีกหน้า — ปิดกลางทางแล้วงานค้างอยู่)
 * ไม่ล็อกหน่วยงาน · เวอร์ชันที่ลงนามต้องเป็นเวอร์ชันที่เผยแพร่อยู่ตอนกด ไม่งั้นตอบ `stale_documents`
 */
export async function joinOptionalDocument(params: {
  organizationId: string;
  legalDocumentId: string;
  userAccountId: string;
  /** เวอร์ชันที่ผู้ลงนามอ่านในกล่อง */
  acknowledgedVersionId: string;
  confirmationText: string;
  attestationText: string;
  attestedAt: Date;
  ipAddress: string | null;
  userAgent: string | null;
}): Promise<{ approvalId: string }> {
  const latest = await joinableVersion(params);
  if (latest.id !== params.acknowledgedVersionId) {
    throw new WorkflowError("stale_documents", "เอกสารมีเวอร์ชันใหม่ระหว่างที่เปิดหน้านี้อยู่ กรุณาโหลดหน้าและอ่านอีกครั้ง", 400);
  }

  let opened: { id: string } | null;
  try {
    opened = await prisma.$transaction(async (tx) => {
      const approval = await openApproval(tx, {
        organizationId: params.organizationId,
        legalDocumentId: params.legalDocumentId,
        versionId: latest.id,
        previousVersionId: null,
        requestedByUserId: params.userAccountId,
        lock: false,
        actorId: params.userAccountId,
      });
      if (!approval) return null;
      await signApprovalInTx(tx, { ...params, approvalId: approval.id });
      return approval;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") opened = null;
    else throw error;
  }
  if (!opened) throw new WorkflowError("already_pending", "มีคำขอเอกสารนี้รออนุมัติอยู่แล้ว", 409);

  await logAudit({
    action: AuditAction.LEGAL_REACCEPTANCE_STARTED,
    subjectType: AuditSubject.ORGANIZATION_LEGAL_APPROVAL,
    subjectId: opened.id,
    organizationId: params.organizationId,
    actorId: params.userAccountId,
    after: { legalDocumentVersionId: latest.id },
    metadata: { reason: "OPTIONAL_DOCUMENT_REQUESTED" },
  });
  await afterOrganizationSigned({ approvalId: opened.id, organizationId: params.organizationId, userAccountId: params.userAccountId });
  return { approvalId: opened.id };
}

/**
 * เวอร์ชันที่หน่วยงานขอเข้าร่วมได้ — เอกสาร optional ของคำขอลงทะเบียนที่ยังใช้งาน หน่วยงาน ACTIVE ผู้เรียกเป็นผู้มีอำนาจ
 * ของหน่วยงานนี้ และยังไม่เคยลงนาม · ไม่ผ่าน = WorkflowError พร้อมเหตุผล (กล่องลงนามและปุ่มขอเข้าร่วมใช้กติกาเดียวกัน)
 */
export async function joinableVersion(params: { organizationId: string; legalDocumentId: string; userAccountId: string }) {
  const [org, document] = await Promise.all([
    prisma.organization.findUnique({ where: { id: params.organizationId }, select: { status: true } }),
    prisma.legalDocument.findUnique({
      where: { id: params.legalDocumentId },
      select: { id: true, isRequired: true, status: true, applicationScope: true },
    }),
  ]);
  if (!org || org.status !== OrganizationStatus.ACTIVE) {
    throw new WorkflowError("organization_not_active", "หน่วยงานต้องลงทะเบียนเรียบร้อยก่อนจึงจะขอเข้าร่วมเอกสารได้", 409);
  }
  if (!document || document.applicationScope !== REGISTRATION_SCOPE || document.status !== LegalDocumentStatus.ACTIVE) {
    throw new WorkflowError("not_found", "ไม่พบเอกสารนี้", 404);
  }
  if (document.isRequired) {
    throw new WorkflowError("required_document", "เอกสารนี้เป็นเอกสารบังคับอยู่แล้ว", 409);
  }
  if (!(await isActiveApproverOf(prisma, params.userAccountId, params.organizationId))) {
    throw new WorkflowError("forbidden", "เฉพาะผู้มีอำนาจอนุมัติของหน่วยงานนี้เท่านั้น", 403);
  }
  const latest = await prisma.legalDocumentVersion.findFirst({
    where: { legalDocumentId: document.id, status: LegalDocumentVersionStatus.PUBLISHED },
    orderBy: { versionNumber: "desc" },
    select: {
      id: true,
      versionNumber: true,
      displayVersionNumber: true,
      effectiveAt: true,
      legalDocument: { select: { documentCode: true, nameTh: true, shortname: true, legalNotice: true, applicationScope: true } },
    },
  });
  if (!latest) throw new WorkflowError("no_published_version", "เอกสารนี้ยังไม่มีเวอร์ชันที่เผยแพร่", 409);
  // ลายมือชื่อที่มีผลเท่านั้น — ของงานที่ถูกยกเลิกก่อน BDI อนุมัติไม่นับ ไม่งั้นหน่วยงานนั้นขอเข้าร่วมใหม่ไม่ได้อีกเลย
  const signed = await prisma.legalAcceptance.count({
    where: {
      organizationId: params.organizationId,
      legalDocumentVersion: { legalDocumentId: document.id },
      NOT: { subjectId: { in: await notInForceApprovalIds(params.organizationId, document.id) } },
    },
  });
  if (signed > 0) throw new WorkflowError("already_accepted", "หน่วยงานลงนามเอกสารนี้แล้ว", 409);
  const pending = await prisma.organizationLegalApproval.count({
    where: { organizationId: params.organizationId, legalDocumentId: document.id, status: { in: PENDING } },
  });
  if (pending > 0) throw new WorkflowError("already_pending", "มีคำขอเอกสารนี้รออนุมัติอยู่แล้ว", 409);
  return latest;
}

// ------------------------------------------------------------------ ลงนาม / อนุมัติ

interface SignInput {
  approvalId: string;
  userAccountId: string;
  confirmationText: string;
  ipAddress: string | null;
  userAgent: string | null;
}

/** ชื่อ-ตำแหน่งของผู้ลงนาม ณ เวลาลงนาม — เอกสารที่ลงนามแล้วพิมพ์ค่านี้ ไม่อ่านค่าปัจจุบันของบัญชี */
async function signerSnapshot(db: Db, userAccountId: string) {
  const account = await db.userAccount.findUnique({
    where: { id: userAccountId },
    select: { ...NAME_FIELDS, positionTh: true },
  });
  return {
    signedName: fullNameTh(account) || null,
    signedFirstName: account?.firstnameTh ?? null,
    signedLastName: account?.lastnameTh ?? null,
    signedPosition: account?.positionTh ?? null,
  };
}

/** ผู้มีอำนาจอนุมัติของหน่วยงานลงนาม (ด่าน ORGANIZATION_APPROVAL) — ติ๊กอ่านแล้วกดเห็นชอบในกล่องลงนามเดิม */
export async function signReacceptance(
  params: SignInput & { attestationText: string; attestedAt: Date },
): Promise<{ status: OrganizationLegalApprovalStatus }> {
  const result = await prisma.$transaction((tx) => signApprovalInTx(tx, params));
  await afterOrganizationSigned({ ...params, organizationId: result.organizationId });
  return { status: OrganizationLegalApprovalStatus.PENDING_BDI_APPROVAL };
}

/** ด่านผู้มีอำนาจของหน่วยงาน — ปิดด่าน บันทึกลายมือชื่อและการเห็นชอบ เปิดด่าน BDI · ใช้ทั้งงานลงนามซ้ำและการขอเข้าร่วม */
async function signApprovalInTx(
  tx: Prisma.TransactionClient,
  params: SignInput & { attestationText: string; attestedAt: Date },
): Promise<{ organizationId: string }> {
  {
    const approval = await tx.organizationLegalApproval.findUnique({
      where: { id: params.approvalId },
      select: { id: true, status: true, organizationId: true, legalDocumentVersionId: true },
    });
    if (!approval) throw new WorkflowError("not_found", "ไม่พบงานลงนามนี้", 404);
    if (!(await isActiveApproverOf(tx, params.userAccountId, approval.organizationId))) {
      throw new WorkflowError("forbidden", "เฉพาะผู้มีอำนาจอนุมัติของหน่วยงานนี้เท่านั้นที่ลงนามได้", 403);
    }
    const task = await activeTask(tx, SUBJECT, approval.id);
    if (approval.status !== OrganizationLegalApprovalStatus.PENDING_ORG_APPROVAL || task?.taskType !== ReviewTaskType.ORGANIZATION_APPROVAL) {
      throw new WorkflowError("task_closed", TASK_TAKEN_MESSAGE, 409);
    }

    await startTask(tx, task.id, params.userAccountId);
    await completeTask(tx, { taskId: task.id, result: "APPROVED", actorId: params.userAccountId });

    const confirmation = await tx.signatureConfirmation.create({
      data: {
        reviewTaskId: task.id,
        subjectType: SUBJECT,
        subjectId: approval.id,
        userAccountId: params.userAccountId,
        organizationId: approval.organizationId,
        confirmationType: ConfirmationType.ORGANIZATION_APPROVAL,
        confirmationText: params.confirmationText,
        confirmationPayloadJson: {
          ...(await signerSnapshot(tx, params.userAccountId)),
          documentVersionIds: [approval.legalDocumentVersionId],
        },
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
        createdBy: params.userAccountId,
      },
    });
    await tx.legalAcceptance.create({
      data: {
        legalDocumentVersionId: approval.legalDocumentVersionId,
        userAccountId: params.userAccountId,
        organizationId: approval.organizationId,
        subjectType: SUBJECT,
        subjectId: approval.id,
        reviewTaskId: task.id,
        signatureConfirmationId: confirmation.id,
        acceptanceMethod: AcceptanceMethod.CHECKBOX,
        acceptedAt: params.attestedAt,
        acceptanceContextJson: { attestationText: params.attestationText },
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
        createdBy: params.userAccountId,
      },
    });
    const bdiTask = await openTask(tx, {
      subjectType: SUBJECT,
      subjectId: approval.id,
      taskType: ReviewTaskType.BDI_FINAL_APPROVAL,
      assignedRole: ROLE_CODES.BDI_FINAL_APPROVER,
      actorId: params.userAccountId,
    });
    const { count } = await tx.organizationLegalApproval.updateMany({
      where: { id: approval.id, status: OrganizationLegalApprovalStatus.PENDING_ORG_APPROVAL },
      data: {
        status: OrganizationLegalApprovalStatus.PENDING_BDI_APPROVAL,
        bdiApprovalReviewTaskId: bdiTask.id,
        version: { increment: 1 },
        updatedBy: params.userAccountId,
      },
    });
    if (count === 0) throw new WorkflowError("task_closed", TASK_TAKEN_MESSAGE, 409);
    return { organizationId: approval.organizationId };
  }
}

/** หลัง commit: บันทึกการลงนาม และแจ้งผู้มีอำนาจอนุมัติของ BDI */
async function afterOrganizationSigned(params: { approvalId: string; organizationId: string; userAccountId: string }) {
  const result = { organizationId: params.organizationId };
  await logAudit({
    action: AuditAction.LEGAL_REACCEPTANCE_SIGNED,
    subjectType: AuditSubject.ORGANIZATION_LEGAL_APPROVAL,
    subjectId: params.approvalId,
    organizationId: result.organizationId,
    actorId: params.userAccountId,
    after: { status: OrganizationLegalApprovalStatus.PENDING_BDI_APPROVAL },
  });
  await notifyUsers(await bdiApproverIds(), {
    type: NotificationType.LEGAL_REACCEPTANCE_SIGNED,
    title: "หน่วยงานลงนามเอกสารกฎหมายเวอร์ชันใหม่แล้ว",
    message: "มีเอกสารกฎหมายที่หน่วยงานลงนามแล้ว รอผู้มีอำนาจอนุมัติของ BDI อนุมัติ",
    subjectType: SUBJECT,
    subjectId: params.approvalId,
    organizationId: result.organizationId,
  });
}

/** ผู้มีอำนาจอนุมัติของ BDI อนุมัติ (ด่าน BDI_FINAL_APPROVAL) — มีปุ่มเดียว เวอร์ชันนั้นมีผล และปลดล็อกเมื่อไม่มีงานค้างเหลือ */
export async function approveReacceptance(params: SignInput): Promise<{ unlocked: boolean }> {
  const result = await prisma.$transaction(async (tx) => {
    const approval = await tx.organizationLegalApproval.findUnique({
      where: { id: params.approvalId },
      select: {
        id: true,
        status: true,
        organizationId: true,
        legalDocumentId: true,
        legalDocumentVersionId: true,
        orgApprovalReviewTask: { select: { completedBy: true } },
      },
    });
    if (!approval) throw new WorkflowError("not_found", "ไม่พบงานลงนามนี้", 404);
    const task = await activeTask(tx, SUBJECT, approval.id);
    if (approval.status !== OrganizationLegalApprovalStatus.PENDING_BDI_APPROVAL || task?.taskType !== ReviewTaskType.BDI_FINAL_APPROVAL) {
      throw new WorkflowError("task_closed", TASK_TAKEN_MESSAGE, 409);
    }

    await startTask(tx, task.id, params.userAccountId);
    await completeTask(tx, { taskId: task.id, result: "APPROVED", actorId: params.userAccountId });
    await tx.signatureConfirmation.create({
      data: {
        reviewTaskId: task.id,
        subjectType: SUBJECT,
        subjectId: approval.id,
        userAccountId: params.userAccountId,
        organizationId: approval.organizationId,
        confirmationType: ConfirmationType.BDI_FINAL_APPROVAL,
        confirmationText: params.confirmationText,
        confirmationPayloadJson: {
          ...(await signerSnapshot(tx, params.userAccountId)),
          documentVersionIds: [approval.legalDocumentVersionId],
        },
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
        createdBy: params.userAccountId,
      },
    });

    const now = new Date();
    // ACTIVE ได้ฉบับเดียวต่อเอกสารต่อหน่วยงาน (uq_active_organization_legal_approval) — ปลดฉบับเดิมก่อน
    await tx.organizationLegalApproval.updateMany({
      where: {
        organizationId: approval.organizationId,
        legalDocumentId: approval.legalDocumentId,
        status: OrganizationLegalApprovalStatus.ACTIVE,
      },
      data: { status: OrganizationLegalApprovalStatus.SUPERSEDED, version: { increment: 1 }, updatedBy: params.userAccountId },
    });
    const { count } = await tx.organizationLegalApproval.updateMany({
      where: { id: approval.id, status: OrganizationLegalApprovalStatus.PENDING_BDI_APPROVAL },
      data: {
        status: OrganizationLegalApprovalStatus.ACTIVE,
        activatedAt: now,
        version: { increment: 1 },
        updatedBy: params.userAccountId,
      },
    });
    if (count === 0) throw new WorkflowError("task_closed", TASK_TAKEN_MESSAGE, 409);

    // ปลดล็อกเมื่อไม่มีงานค้างที่ล็อกหน่วยงานอยู่ (งานขอเอกสาร optional ไม่ล็อก จึงไม่นับ)
    const lockingPending = await tx.organizationLegalApproval.count({
      where: { organizationId: approval.organizationId, status: { in: PENDING }, requestedByUserId: null },
    });
    let unlocked = false;
    if (lockingPending === 0) {
      const res = await tx.organization.updateMany({
        where: { id: approval.organizationId, accessStatus: OrganizationAccessStatus.LEGAL_DOCS_UPDATE_REQUIRED },
        data: { accessStatus: OrganizationAccessStatus.ACTIVE, accessStatusChangedAt: now, updatedBy: params.userAccountId },
      });
      unlocked = res.count > 0;
    }
    return { organizationId: approval.organizationId, signerId: approval.orgApprovalReviewTask?.completedBy ?? null, unlocked };
  });

  await logAudit({
    action: AuditAction.LEGAL_REACCEPTANCE_APPROVED,
    subjectType: AuditSubject.ORGANIZATION_LEGAL_APPROVAL,
    subjectId: params.approvalId,
    organizationId: result.organizationId,
    actorId: params.userAccountId,
    after: { status: OrganizationLegalApprovalStatus.ACTIVE },
  });
  await notifyUsers([result.signerId], {
    type: NotificationType.LEGAL_REACCEPTANCE_COMPLETED,
    title: "การยืนยันลงนามเอกสารกฎหมายเสร็จสมบูรณ์",
    message: "ผู้มีอำนาจอนุมัติของ BDI อนุมัติการลงนามเอกสารกฎหมายเวอร์ชันใหม่ของหน่วยงานแล้ว",
    subjectType: SUBJECT,
    subjectId: params.approvalId,
    organizationId: result.organizationId,
  });
  if (result.unlocked) {
    await logAudit({
      action: AuditAction.ORGANIZATION_ACCESS_CHANGED,
      subjectType: AuditSubject.ORGANIZATION,
      subjectId: result.organizationId,
      organizationId: result.organizationId,
      actorId: params.userAccountId,
      after: { accessStatus: OrganizationAccessStatus.ACTIVE },
    });
    const members = await organizationMemberIds(result.organizationId);
    await notifyUsers([...members.users, ...members.approvers], {
      type: NotificationType.LEGAL_ACCESS_RESTORED,
      title: "หน่วยงานกลับมาใช้งานได้ตามปกติ",
      message: "เอกสารกฎหมายเวอร์ชันใหม่ได้รับการลงนามและอนุมัติครบแล้ว หน่วยงานทำรายการชุดข้อมูลได้ตามปกติ",
      subjectType: SUBJECT,
      subjectId: params.approvalId,
      organizationId: result.organizationId,
    });
  }
  return { unlocked: result.unlocked };
}

// ------------------------------------------------------------------ อ่าน

/** สถานะของงานในรูปที่ `buildJourneyProgress()` เข้าใจ — ใช้วาด ApprovalSteps แบบเดียวกับคำขออื่น */
function journeyStatusOf(status: OrganizationLegalApprovalStatus): RequestStatus {
  switch (status) {
    case OrganizationLegalApprovalStatus.ACTIVE:
    case OrganizationLegalApprovalStatus.SUPERSEDED:
      return RequestStatus.APPROVED;
    case OrganizationLegalApprovalStatus.CANCELLED:
      return RequestStatus.CANCELLED;
    default:
      return RequestStatus.UNDER_REVIEW;
  }
}

export async function approvalDetail(approvalId: string) {
  const approval = await prisma.organizationLegalApproval.findUnique({
    where: { id: approvalId },
    select: {
      id: true,
      status: true,
      organizationId: true,
      createdAt: true,
      activatedAt: true,
      requestedByUserId: true,
      organization: { select: { nameTh: true, accessStatus: true } },
      legalDocument: { select: { id: true, documentCode: true, nameTh: true, shortname: true, legalNotice: true } },
      legalDocumentVersion: { select: { id: true, displayVersionNumber: true, effectiveAt: true } },
    },
  });
  if (!approval) return null;
  const [tasks, active] = await Promise.all([taskHistory(prisma, SUBJECT, approval.id), activeTask(prisma, SUBJECT, approval.id)]);
  return {
    approval,
    progress: buildJourneyProgress({
      subjectType: SUBJECT,
      status: journeyStatusOf(approval.status),
      tasks,
      active,
      submittedAt: approval.createdAt,
    }),
  };
}

/**
 * เวอร์ชันที่หน่วยงานใช้อยู่ของเอกสารนี้ **ก่อน**งานลงนามงานนี้ — ส่วน "เอกสารเวอร์ชันปัจจุบัน" ของหน้ารายละเอียดงาน
 *
 * การลงนามล่าสุดที่ BDI อนุมัติแล้ว: ไม่นับงานนี้เอง และไม่นับงานที่ยังค้างหรือถูกปิด (CANCELLED) ซึ่งหน่วยงานอาจลงนามไปแล้วแต่ไม่มีผล
 * วันที่อนุมัติ = ลายมือชื่อด่านสุดท้ายของ BDI บนเรื่องเดียวกับการลงนาม (คำขอลงทะเบียน หรืองานลงนามซ้ำ) — กติกาเดียวกับ `legalHistory()`
 * null = หน่วยงานไม่เคยมีเอกสารนี้ (ขอเข้าร่วมเอกสาร optional)
 */
export async function previousSignedVersion(params: { organizationId: string; legalDocumentId: string; approvalId: string }) {
  const voided = await prisma.organizationLegalApproval.findMany({
    where: {
      organizationId: params.organizationId,
      legalDocumentId: params.legalDocumentId,
      status: { in: [...PENDING, OrganizationLegalApprovalStatus.CANCELLED] },
    },
    select: { id: true },
  });
  const acceptance = await prisma.legalAcceptance.findFirst({
    where: {
      organizationId: params.organizationId,
      legalDocumentVersion: { legalDocumentId: params.legalDocumentId },
      NOT: { subjectId: { in: [params.approvalId, ...voided.map((v) => v.id)] } },
    },
    orderBy: [{ legalDocumentVersion: { versionNumber: "desc" } }, { acceptedAt: "desc" }],
    select: {
      subjectType: true,
      subjectId: true,
      legalDocumentVersion: { select: { id: true, versionNumber: true, displayVersionNumber: true, effectiveAt: true } },
    },
  });
  if (!acceptance) return null;
  const bdi = await prisma.signatureConfirmation.findFirst({
    where: {
      confirmationType: ConfirmationType.BDI_FINAL_APPROVAL,
      subjectType: acceptance.subjectType,
      subjectId: acceptance.subjectId,
    },
    orderBy: { confirmedAt: "desc" },
    select: { confirmedAt: true },
  });
  return {
    version: acceptance.legalDocumentVersion,
    approvedAt: bdi?.confirmedAt ?? null,
    /** เรื่องที่ลงนามเวอร์ชันนั้น — ใช้ประทับลายมือชื่อลงไฟล์ของเวอร์ชันนั้น */
    signatureSubject: { subjectType: acceptance.subjectType, subjectId: acceptance.subjectId },
  };
}

/**
 * เวอร์ชันที่หน่วยงานลงนามของเอกสารหนึ่งฉบับ — หน้า "ดูรายละเอียด" ของแถวที่ไม่มีงานค้าง และของแถวในประวัติที่ลงนามตอนลงทะเบียน
 *
 * ไม่ระบุ `versionId` = เวอร์ชันที่ใช้อยู่ (ลงนามล่าสุด ไม่นับงานที่ยังรอหรือถูกยกเลิก — กติกาเดียวกับ `previousSignedVersion`)
 * null = หน่วยงานไม่เคยลงนามเอกสารนี้ (หรือไม่เคยลงนามเวอร์ชันนั้น)
 */
export async function signedVersionDetail(params: { organizationId: string; documentId: string; versionId?: string | null }) {
  const voided = await prisma.organizationLegalApproval.findMany({
    where: {
      organizationId: params.organizationId,
      legalDocumentId: params.documentId,
      status: { in: [...PENDING, OrganizationLegalApprovalStatus.CANCELLED] },
    },
    select: { id: true },
  });
  const where: Prisma.LegalAcceptanceWhereInput = {
    organizationId: params.organizationId,
    legalDocumentVersion: { legalDocumentId: params.documentId },
    NOT: { subjectId: { in: voided.map((v) => v.id) } },
  };
  const select = {
    subjectType: true,
    subjectId: true,
    legalDocumentVersion: { select: { id: true, displayVersionNumber: true, effectiveAt: true } },
    signatureConfirmation: { select: { confirmedAt: true, confirmationPayloadJson: true } },
  } satisfies Prisma.LegalAcceptanceSelect;
  const newest = [{ legalDocumentVersion: { versionNumber: "desc" as const } }, { acceptedAt: "desc" as const }];
  const current = await prisma.legalAcceptance.findFirst({ where, orderBy: newest, select });
  const chosen = params.versionId
    ? await prisma.legalAcceptance.findFirst({
        where: { ...where, legalDocumentVersionId: params.versionId },
        orderBy: { acceptedAt: "desc" },
        select,
      })
    : current;
  if (!chosen) return null;
  const bdi = await prisma.signatureConfirmation.findFirst({
    where: { confirmationType: ConfirmationType.BDI_FINAL_APPROVAL, subjectType: chosen.subjectType, subjectId: chosen.subjectId },
    orderBy: { confirmedAt: "desc" },
    select: { confirmedAt: true, confirmationPayloadJson: true },
  });
  const registration =
    chosen.subjectType === SubjectType.ORGANIZATION_REGISTRATION_REQUEST
      ? await prisma.organizationRegistrationRequest.findUnique({
          where: { id: chosen.subjectId },
          select: { id: true, requestNumber: true },
        })
      : null;
  return {
    version: chosen.legalDocumentVersion,
    isCurrent: chosen.legalDocumentVersion.id === current?.legalDocumentVersion.id,
    orgApprovedAt: chosen.signatureConfirmation?.confirmedAt ?? null,
    orgApproverName: signedNameOf(chosen.signatureConfirmation?.confirmationPayloadJson),
    bdiApprovedAt: bdi?.confirmedAt ?? null,
    bdiApproverName: signedNameOf(bdi?.confirmationPayloadJson),
    signatureSubject: { subjectType: chosen.subjectType, subjectId: chosen.subjectId },
    /** ลงนามผ่านทางไหน — คำขอลงทะเบียน (เลขคำขอ) หรืองานลงนามเวอร์ชันใหม่ */
    registration,
    approvalId: chosen.subjectType === SUBJECT ? chosen.subjectId : null,
  };
}

export interface StatusRow {
  organizationId: string;
  organizationName: string;
  documentId: string;
  documentCode: string;
  documentName: string;
  documentShortname: string | null;
  documentIsRequired: boolean;
  currentVersion: string | null;
  effectiveAt: Date | null;
  pending: { approvalId: string; status: OrganizationLegalApprovalStatus; versionDisplay: string } | null;
}

/**
 * ตาราง "สถานะเอกสารทางกฎหมายของหน่วยงาน" — หนึ่งแถวต่อ (หน่วยงาน, เอกสาร) แบ่งหน้าใน SQL
 *
 * แถวมาจากสามทาง: เอกสารที่หน่วยงานเคยลงนาม, งานที่ค้างอยู่ และ (เมื่อระบุหน่วยงาน) เอกสารทุกฉบับของคำขอลงทะเบียน
 * — ทางที่สามทำให้เอกสาร optional ที่ข้ามไว้ปรากฏพร้อมปุ่มขอเข้าร่วม
 * "เวอร์ชันล่าสุดที่ลงนาม" ไม่นับการลงนามที่ยังรอ BDI อนุมัติ · "วันที่มีผล" คือวันที่มีผลของเวอร์ชันนั้น
 */
/** ตัวกรองสถานะ — ชุดเดียวกับป้ายในตาราง (`rowMeta()` ฝั่ง frontend) · NOT_JOINED มีเฉพาะเมื่อระบุหน่วยงาน */
export const STATUS_FILTERS = ["PENDING_ORG_APPROVAL", "PENDING_BDI_APPROVAL", "ACTIVE", "NOT_JOINED"] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

function statusClause(status: StatusFilter | null): Prisma.Sql {
  switch (status) {
    case "PENDING_ORG_APPROVAL":
    case "PENDING_BDI_APPROVAL":
      return Prisma.sql`AND pend.status = ${status}::legal."OrganizationLegalApprovalStatus"`;
    case "ACTIVE":
      return Prisma.sql`AND pend.id IS NULL AND cur.display_version_number IS NOT NULL`;
    case "NOT_JOINED":
      return Prisma.sql`AND pend.id IS NULL AND cur.display_version_number IS NULL`;
    default:
      return Prisma.empty;
  }
}

export async function legalStatusRows(params: {
  /** null = ทุกหน่วยงาน (BDI) · หน่วยงานเดียวหรือหลายแห่งที่เลือกในตัวกรอง */
  organizationIds: string[] | null;
  documentId: string | null;
  status?: StatusFilter | null;
  /** แท็บ "ที่ต้องดำเนินการ" — เฉพาะเอกสารที่มีคำขอรออนุมัติ (ไม่ว่าด่านไหน) · "ยังไม่ได้เข้าร่วม" ไม่นับ */
  onlyPending: boolean;
  /** แท็บ "ที่ต้องดำเนินการ" ของผู้มีอำนาจอนุมัติของ BDI — เฉพาะงานที่รอ BDI อนุมัติ · null = ทุกงานที่ค้าง */
  pendingStatus?: "PENDING_BDI_APPROVAL" | null;
  page: number;
  pageSize: number;
}): Promise<{ rows: StatusRow[]; total: number }> {
  // หน่วยงานที่เลือกไว้ (หรือหน่วยงานของผู้ใช้) ได้แถวของเอกสารทุกฉบับ รวมฉบับ optional ที่ยังไม่ได้เข้าร่วม
  const orgIds = params.organizationIds && params.organizationIds.length > 0 ? params.organizationIds : null;
  const raw = await prisma.$queryRaw<
    Array<{
      organization_id: string;
      organization_name: string;
      document_id: string;
      document_code: string;
      document_name: string;
      shortname: string | null;
      is_required: boolean;
      current_version: string | null;
      effective_at: Date | null;
      pending_id: string | null;
      pending_status: OrganizationLegalApprovalStatus | null;
      pending_version: string | null;
      total: bigint;
    }>
  >(Prisma.sql`
    WITH pairs AS (
      SELECT la.organization_id, v.legal_document_id
        FROM legal.legal_acceptance la
        JOIN legal.legal_document_version v ON v.id = la.legal_document_version_id
      UNION
      SELECT a.organization_id, a.legal_document_id
        FROM legal.organization_legal_approval a
       WHERE a.status IN ('PENDING_ORG_APPROVAL', 'PENDING_BDI_APPROVAL')
      UNION
      SELECT o.id, d.id
        FROM organization.organization o
        CROSS JOIN legal.legal_document d
       WHERE o.id = ANY(${orgIds}::uuid[])
         AND d.application_scope = ${REGISTRATION_SCOPE} AND d.status = 'ACTIVE'
    )
    SELECT p.organization_id, o.name_th AS organization_name,
           d.id AS document_id, d.document_code, d.name_th AS document_name, d.shortname, d.is_required,
           cur.display_version_number AS current_version, cur.effective_at,
           pend.id AS pending_id, pend.status AS pending_status, pv.display_version_number AS pending_version,
           COUNT(*) OVER () AS total
      FROM pairs p
      JOIN organization.organization o ON o.id = p.organization_id
      JOIN legal.legal_document d ON d.id = p.legal_document_id
      LEFT JOIN LATERAL (
        SELECT v.display_version_number, v.effective_at
          FROM legal.legal_acceptance la
          JOIN legal.legal_document_version v ON v.id = la.legal_document_version_id
         WHERE la.organization_id = p.organization_id
           AND v.legal_document_id = p.legal_document_id
           AND NOT EXISTS (
             SELECT 1 FROM legal.organization_legal_approval x
              -- ลายมือชื่อของงานที่ยังรอ หรือถูกยกเลิก (มีเวอร์ชันใหม่มาแทนก่อน BDI อนุมัติ) ไม่ใช่เวอร์ชันที่มีผล
              WHERE x.id = la.subject_id AND x.status IN ('PENDING_ORG_APPROVAL', 'PENDING_BDI_APPROVAL', 'CANCELLED')
           )
         ORDER BY v.version_number DESC
         LIMIT 1
      ) cur ON TRUE
      LEFT JOIN legal.organization_legal_approval pend
        ON pend.organization_id = p.organization_id AND pend.legal_document_id = p.legal_document_id
       AND pend.status IN ('PENDING_ORG_APPROVAL', 'PENDING_BDI_APPROVAL')
      LEFT JOIN legal.legal_document_version pv ON pv.id = pend.legal_document_version_id
     WHERE o.status IN ('ACTIVE', 'SUSPENDED')
       AND d.application_scope = ${REGISTRATION_SCOPE}
       AND (${orgIds}::uuid[] IS NULL OR p.organization_id = ANY(${orgIds}::uuid[]))
       AND (${params.documentId}::uuid IS NULL OR p.legal_document_id = ${params.documentId}::uuid)
       AND (${!params.onlyPending} OR pend.id IS NOT NULL)
       ${statusClause(params.status ?? null)}
       ${statusClause(params.pendingStatus ?? null)}
     ORDER BY o.name_th, o.id, d.display_order
     LIMIT ${params.pageSize} OFFSET ${(params.page - 1) * params.pageSize}
  `);
  return {
    total: raw[0] ? Number(raw[0].total) : 0,
    rows: raw.map((r) => ({
      organizationId: r.organization_id,
      organizationName: r.organization_name,
      documentId: r.document_id,
      documentCode: r.document_code,
      documentName: r.document_name,
      documentShortname: r.shortname,
      documentIsRequired: r.is_required,
      currentVersion: r.current_version,
      effectiveAt: r.effective_at,
      pending:
        r.pending_id && r.pending_status && r.pending_version
          ? { approvalId: r.pending_id, status: r.pending_status, versionDisplay: r.pending_version }
          : null,
    })),
  };
}

/** CANCELLED = หน่วยงานลงนามแล้ว แต่งานถูกยกเลิกก่อน BDI อนุมัติ (มีเวอร์ชันใหม่มาแทน) — ไม่เคยมีผล */
type HistoryStatus = "PENDING_ORG_APPROVAL" | "PENDING_BDI_APPROVAL" | "ACTIVE" | "SUPERSEDED" | "CANCELLED";

export interface HistoryRow {
  key: string;
  versionDisplay: string;
  effectiveAt: Date | null;
  orgApprovedAt: Date | null;
  orgApproverName: string | null;
  bdiApprovedAt: Date | null;
  bdiApproverName: string | null;
  status: HistoryStatus;
  /** ปุ่ม "ดูรายละเอียด" — งานลงนามเวอร์ชันใหม่เปิดหน้างานนั้น · ลงนามตอนลงทะเบียนเปิดหน้ารายละเอียดของเวอร์ชันนั้น */
  link: { approvalId: string } | { versionId: string };
}

function signedNameOf(payload: Prisma.JsonValue | null | undefined): string | null {
  if (payload && typeof payload === "object" && !Array.isArray(payload) && typeof payload.signedName === "string") {
    return payload.signedName;
  }
  return null;
}

/**
 * ประวัติการลงนามของหน่วยงานกับเอกสารหนึ่งฉบับ — ทุกเวอร์ชันที่ลงนาม (ตอนลงทะเบียนและการลงนามใหม่) แบ่งหน้าใน DB
 * งานที่ยังรอผู้มีอำนาจของหน่วยงานลงนามขึ้นเป็นแถวแรกของหน้าแรก
 */
export async function legalHistory(params: {
  organizationId: string;
  documentId: string;
  page: number;
  pageSize: number;
}): Promise<{ rows: HistoryRow[]; total: number }> {
  const waiting = await prisma.organizationLegalApproval.findFirst({
    where: {
      organizationId: params.organizationId,
      legalDocumentId: params.documentId,
      status: OrganizationLegalApprovalStatus.PENDING_ORG_APPROVAL,
    },
    select: { id: true, legalDocumentVersion: { select: { displayVersionNumber: true, effectiveAt: true } } },
  });
  const where: Prisma.LegalAcceptanceWhereInput = {
    organizationId: params.organizationId,
    legalDocumentVersion: { legalDocumentId: params.documentId },
  };
  const extra = waiting ? 1 : 0;
  const skip = Math.max(0, (params.page - 1) * params.pageSize - extra);
  const take = params.page === 1 ? params.pageSize - extra : params.pageSize;
  const [count, acceptances, newest] = await Promise.all([
    prisma.legalAcceptance.count({ where }),
    prisma.legalAcceptance.findMany({
      where,
      orderBy: [{ legalDocumentVersion: { versionNumber: "desc" } }, { acceptedAt: "desc" }],
      skip,
      take,
      select: {
        id: true,
        subjectType: true,
        subjectId: true,
        legalDocumentVersion: { select: { id: true, displayVersionNumber: true, effectiveAt: true } },
        signatureConfirmation: { select: { confirmedAt: true, confirmationPayloadJson: true } },
      },
    }),
    prisma.legalAcceptance.findFirst({
      where: { ...where, NOT: { subjectId: { in: await notInForceApprovalIds(params.organizationId, params.documentId) } } },
      orderBy: [{ legalDocumentVersion: { versionNumber: "desc" } }, { acceptedAt: "desc" }],
      select: { id: true },
    }),
  ]);

  const bdi = await prisma.signatureConfirmation.findMany({
    where: {
      confirmationType: ConfirmationType.BDI_FINAL_APPROVAL,
      OR: acceptances.map((a) => ({ subjectType: a.subjectType, subjectId: a.subjectId })),
    },
    orderBy: { confirmedAt: "asc" },
    select: { subjectId: true, confirmedAt: true, confirmationPayloadJson: true },
  });
  const pendingIds = new Set(await pendingApprovalIds(params.organizationId, params.documentId));
  const cancelledIds = new Set(await cancelledApprovalIds(params.organizationId, params.documentId));

  const rows: HistoryRow[] = [];
  if (waiting && params.page === 1) {
    rows.push({
      key: waiting.id,
      versionDisplay: waiting.legalDocumentVersion.displayVersionNumber,
      effectiveAt: waiting.legalDocumentVersion.effectiveAt,
      orgApprovedAt: null,
      orgApproverName: null,
      bdiApprovedAt: null,
      bdiApproverName: null,
      status: "PENDING_ORG_APPROVAL",
      link: { approvalId: waiting.id },
    });
  }
  for (const a of acceptances) {
    const bdiSign = bdi.filter((b) => b.subjectId === a.subjectId).at(-1);
    rows.push({
      key: a.id,
      versionDisplay: a.legalDocumentVersion.displayVersionNumber,
      effectiveAt: a.legalDocumentVersion.effectiveAt,
      orgApprovedAt: a.signatureConfirmation?.confirmedAt ?? null,
      orgApproverName: signedNameOf(a.signatureConfirmation?.confirmationPayloadJson),
      bdiApprovedAt: bdiSign?.confirmedAt ?? null,
      bdiApproverName: signedNameOf(bdiSign?.confirmationPayloadJson),
      status: pendingIds.has(a.subjectId)
        ? "PENDING_BDI_APPROVAL"
        : cancelledIds.has(a.subjectId)
          ? "CANCELLED"
          : a.id === newest?.id
            ? "ACTIVE"
            : "SUPERSEDED",
      link: a.subjectType === SUBJECT ? { approvalId: a.subjectId } : { versionId: a.legalDocumentVersion.id },
    });
  }
  return { rows, total: count + extra };
}

async function cancelledApprovalIds(organizationId: string, documentId: string): Promise<string[]> {
  const rows = await prisma.organizationLegalApproval.findMany({
    where: { organizationId, legalDocumentId: documentId, status: OrganizationLegalApprovalStatus.CANCELLED },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/** งานที่ลายมือชื่อของมันยังไม่มีผล — ยังรออยู่ หรือถูกยกเลิกก่อน BDI อนุมัติ */
async function notInForceApprovalIds(organizationId: string, documentId: string): Promise<string[]> {
  return [...(await pendingApprovalIds(organizationId, documentId)), ...(await cancelledApprovalIds(organizationId, documentId))];
}

async function pendingApprovalIds(organizationId: string, documentId: string): Promise<string[]> {
  const rows = await prisma.organizationLegalApproval.findMany({
    where: { organizationId, legalDocumentId: documentId, status: { in: PENDING } },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}
