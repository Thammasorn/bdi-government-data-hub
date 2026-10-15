/**
 * ชนิดข้อมูลและป้ายของหมวด "ตั้งค่าเอกสาร" ใน /console — สิ่งที่ `/api/admin/legal-documents` ตอบกลับมา
 * ชื่อช่องตรงกับ `documentShape()` ใน backend/src/routes/admin-legal-documents.ts
 */
export type LegalScope = "ORGANIZATION_REGISTRATION" | "DATASET_REGISTRATION";

export type LegalVersionStatus = "DRAFT" | "PUBLISHED" | "SUPERSEDED" | "RETIRED";

export interface LegalVersionSummary {
  id: string;
  versionNumber: number;
  /** จำนวนคำขอที่ผูกเวอร์ชันนี้ไว้ */
  usageCount: number;
  status: LegalVersionStatus;
  publishedAt: string | null;
  publishedBy: string | null;
}

export interface LegalDocument {
  code: string;
  name: string;
  shortname: string | null;
  legalNotice: string | null;
  isRequired: boolean;
  scope: LegalScope;
  displayOrder: number;
  status: "DRAFT" | "ACTIVE" | "RETIRED";
  /** เปิดใช้อยู่ = ผู้ใช้ที่นำส่งคำขอจากนี้ไปเห็นเอกสารนี้ */
  isActive: boolean;
  hasPublishedVersion: boolean;
  activeVersion: LegalVersionSummary | null;
  draftVersionCount: number;
  versionCount: number;
}

export interface LegalVersionRow {
  id: string;
  versionNumber: number;
  status: LegalVersionStatus;
  /** true = ฉบับที่ใช้อยู่ตอนนี้ */
  isActive: boolean;
  usageCount: number;
  /** ลบถาวรได้ — ไม่ใช่ฉบับที่ใช้อยู่ ไม่มีคำขอผูก และไม่มีหลักฐานการยอมรับ */
  canDelete: boolean;
  filename: string;
  createdAt: string;
  createdBy: string | null;
  publishedAt: string | null;
  publishedBy: string | null;
  supersededAt: string | null;
}

/** หัวข้อของแต่ละ scope — ตรงกับ `SCOPE_LABELS` ฝั่ง backend */
export const SCOPE_ORDER: LegalScope[] = ["ORGANIZATION_REGISTRATION", "DATASET_REGISTRATION"];

export const SCOPE_TITLES: Record<LegalScope, string> = {
  ORGANIZATION_REGISTRATION: "เอกสารของคำขอลงทะเบียนหน่วยงาน",
  DATASET_REGISTRATION: "เอกสารของคำขอส่งชุดข้อมูล",
};

export const VERSION_META: Record<LegalVersionStatus, { label: string; className: string }> = {
  PUBLISHED: { label: "ใช้งานอยู่", className: "bg-success-bg text-success" },
  SUPERSEDED: { label: "ฉบับก่อน", className: "bg-navy-50 text-ink-muted" },
  DRAFT: { label: "ฉบับร่าง", className: "bg-warning-bg text-warning" },
  RETIRED: { label: "เก็บถาวร", className: "bg-navy-50 text-ink-muted" },
};

export const ACTIVE_META = { label: "ใช้งาน", className: "bg-success-bg text-success" };
export const INACTIVE_META = { label: "ปิดใช้", className: "bg-navy-50 text-ink-muted" };
