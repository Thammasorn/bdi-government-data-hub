import type { PageInfo } from "@/lib/stage";
import { REQUEST_STATUS_META, TASK_TYPE_META } from "@/lib/status";
import type { JourneyProgress, LegalDocument } from "@/lib/types";

/**
 * สถานะเอกสารทางกฎหมายของหน่วยงาน (card "[Enhance] Legal Document Management") — รูปของ /api/legal-status
 * สำเนาของ `StatusRow` / `HistoryRow` ใน backend/src/lib/legal-reacceptance.ts
 */
export type ApprovalStatus = "PENDING_ORG_APPROVAL" | "PENDING_BDI_APPROVAL" | "ACTIVE" | "SUPERSEDED" | "CANCELLED";

export interface LegalStatusRow {
  organizationId: string;
  organizationName: string;
  documentId: string;
  documentCode: string;
  documentName: string;
  documentShortname: string | null;
  documentIsRequired: boolean;
  /** เวอร์ชันล่าสุดที่ลงนามและ BDI อนุมัติแล้ว — null = ยังไม่เคยเข้าร่วม (เอกสาร optional ที่ข้ามไว้) */
  currentVersion: string | null;
  effectiveAt: string | null;
  pending: { approvalId: string; status: ApprovalStatus; versionDisplay: string } | null;
}

export interface LegalStatusPage extends PageInfo {
  rows: LegalStatusRow[];
  seesAll: boolean;
}

export interface LegalHistoryRow {
  key: string;
  versionDisplay: string;
  effectiveAt: string | null;
  orgApprovedAt: string | null;
  orgApproverName: string | null;
  bdiApprovedAt: string | null;
  bdiApproverName: string | null;
  /** CANCELLED = ลงนามแล้วแต่งานถูกยกเลิกก่อน BDI อนุมัติ (มีเวอร์ชันใหม่มาแทน) — ไม่เคยมีผล */
  status: ApprovalStatus;
  /** ปุ่ม "ดูรายละเอียด" — งานลงนามเวอร์ชันใหม่ หรือเวอร์ชันที่ลงนามตอนลงทะเบียน */
  link: { approvalId: string } | { versionId: string };
}

/** GET /api/legal-status/:organizationId/:documentId/detail — เวอร์ชันที่หน่วยงานลงนาม (ไม่ระบุ = ที่ใช้อยู่) */
export interface LegalDocumentDetail {
  organizationId: string;
  organizationName: string;
  documentId: string;
  /** ผู้มีอำนาจอนุมัติของหน่วยงานนี้ขอเข้าร่วมเอกสาร optional ที่ยังไม่ได้เข้าร่วมได้ */
  canRequest: boolean;
  /** เวอร์ชันที่จะขอเข้าร่วม ในรูปที่กล่องลงนามรับ — null เมื่อขอเข้าร่วมไม่ได้ */
  joinDocument: LegalDocument | null;
  /** ยังไม่ได้เข้าร่วม = มีแค่ชื่อ ไม่มีไฟล์ */
  document: (LegalDocument & { displayVersionNumber: string }) | Pick<LegalDocument, "code" | "name" | "shortname">;
  signed: {
    versionDisplay: string;
    effectiveAt: string | null;
    isCurrent: boolean;
    orgApprovedAt: string | null;
    orgApproverName: string | null;
    bdiApprovedAt: string | null;
    bdiApproverName: string | null;
    registration: { id: string; requestNumber: string } | null;
    approvalId: string | null;
  } | null;
  pending: { approvalId: string; status: ApprovalStatus; versionDisplay: string } | null;
}

export interface LegalApprovalDetail {
  approval: {
    id: string;
    status: ApprovalStatus;
    organizationId: string;
    organizationName: string;
    legalDocumentId: string;
    versionDisplay: string;
    effectiveAt: string | null;
    activatedAt: string | null;
    optionalRequest: boolean;
  };
  document: LegalDocument & { displayVersionNumber: string };
  /** เวอร์ชันที่หน่วยงานใช้อยู่ก่อนงานนี้ — null เมื่อหน่วยงานไม่เคยมีเอกสารนี้ (ขอเข้าร่วมเอกสาร optional) */
  current: {
    versionId: string;
    versionDisplay: string;
    effectiveAt: string | null;
    approvedAt: string | null;
    fileUrl: string;
  } | null;
  progress: JourneyProgress;
  canSign: boolean;
  canApprove: boolean;
}

type Meta = { label: string; className: string };

/**
 * ป้ายสถานะ — ชื่อสั้นชุดเดียวกับกล่องในแผนภาพเส้นทางของคำขออื่น (`shortLabel` ใน backend/src/lib/journey-steps.ts)
 * สีจาก `TASK_TYPE_META` ของด่านเดียวกัน · ไม่แสดงเวอร์ชันที่รออยู่ในตาราง (ดูได้ในหน้ารายละเอียดและประวัติ)
 */
export const APPROVAL_STATUS_META: Record<ApprovalStatus, Meta> = {
  PENDING_ORG_APPROVAL: { label: "รอหน่วยงานลงนาม", className: TASK_TYPE_META.ORGANIZATION_APPROVAL.className },
  PENDING_BDI_APPROVAL: { label: "รอ BDI อนุมัติ", className: TASK_TYPE_META.BDI_FINAL_APPROVAL.className },
  ACTIVE: { label: "เปิดใช้งาน", className: "bg-success-bg text-success" },
  SUPERSEDED: { label: "ถูกแทนที่", className: "bg-navy-50 text-ink-muted" },
  CANCELLED: REQUEST_STATUS_META.CANCELLED,
};

/** แถวที่หน่วยงานไม่เคยลงนามและไม่มีงานค้าง — เอกสาร optional ที่ข้ามไว้ตอนลงทะเบียน */
export const NOT_JOINED_META: Meta = { label: "ยังไม่ได้เข้าร่วม", className: "bg-navy-50 text-ink-muted" };

export function rowMeta(row: LegalStatusRow): Meta {
  if (row.pending) return APPROVAL_STATUS_META[row.pending.status];
  return row.currentVersion ? APPROVAL_STATUS_META.ACTIVE : NOT_JOINED_META;
}

/** ชื่อเอกสารที่หน้าจอใช้ — กติกาเดียวกับ `documentLabel()` (ไม่แสดงรหัส A0–A3) */
export const rowDocumentLabel = (row: Pick<LegalStatusRow, "documentShortname" | "documentName">) =>
  row.documentShortname ?? row.documentName;

/** วันที่อย่างเดียว ไม่มีเวลา — วันที่มีผลของเวอร์ชันและวันที่อนุมัติในตารางประวัติ */
export function thaiDate(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeZone: "Asia/Bangkok" }).format(new Date(value));
}
