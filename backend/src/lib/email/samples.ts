/**
 * ข้อมูลตัวอย่างของ preview และอีเมลทดสอบ — **ของสมมติทั้งหมด** ไม่ใช่ข้อมูลของคนหรือหน่วยงานจริง (การ์ดกำหนด: ไม่ให้ข้อมูลจริงไปอยู่ใน
 * กล่องจดหมายทดสอบ) ค่าคงที่ ไม่ใช้วันที่ปัจจุบัน เพื่อให้เปรียบเทียบ preview สองรอบได้
 *
 * ประกอบผ่าน `*Context()` ตัวเดียวกับที่อีเมลจริงใช้ (lib/mail.ts) preview จึงเห็นบล็อกของระบบหน้าตาเดียวกับที่ผู้รับจะเห็น
 */
import { ReviewTaskType } from "@prisma/client";

import type { JourneyProgress, JourneyStep } from "../journey-steps.js";
import {
  activatedContext,
  datasetApprovedContext,
  datasetPendingBdiContext,
  datasetPendingOrgApproverContext,
  datasetRejectedContext,
  datasetRevisionContext,
  datasetSignedPendingContext,
  datasetSpecialistAssignedContext,
  datasetSpecialistCommentedContext,
  datasetSubmittedContext,
  finalApprovalContext,
  invitationContext,
  invitationReminderContext,
  orgRevisionContext,
  orgSubmittedContext,
  otpContext,
  passwordResetContext,
  requestProgressedContext,
  roleRemovedContext,
  signatoryRequestContext,
} from "../mail.js";
import { ROLE_CODES } from "../system.js";
import { INVITATION_SUBJECT_DEFAULT, LAYOUT_KEY } from "./catalogue.js";
import type { EmailContext } from "./render.js";

const ISSUED = new Date("2026-11-08T09:30:00.000Z");
const EXPIRES = new Date("2026-11-15T09:30:00.000Z");
const AT = new Date("2026-11-08T07:15:00.000Z");
const ORG = { name: "กรมตัวอย่าง", code: "ORG-0001" };
const SAMPLE_ID = "00000000-0000-4000-8000-000000000000";
const SAMPLE_KEY = "AK-EXAMPLE-0000-0000-0000";

function step(
  order: number,
  key: JourneyStep["key"],
  taskType: ReviewTaskType | null,
  label: string,
  shortLabel: string,
  roleCode: JourneyStep["roleCode"],
  roleLabel: string,
  state: JourneyStep["state"],
): JourneyStep {
  return {
    key,
    taskType,
    order,
    optional: false,
    label,
    shortLabel,
    waitingLabel: shortLabel,
    roleCode,
    roleLabel,
    state,
    result: null,
    completedAt: null,
    roundNumber: null,
  };
}

/** คำขอที่อยู่ขั้นที่ 2 จาก 4 — ตัวอย่างของบล็อกสถานะคำขอ */
const steps = [
  step(1, "SUBMISSION", null, "หน่วยงานส่งหรือแก้ไขคำขอ", "รอหน่วยงานนำส่ง", ROLE_CODES.ORGANIZATION_USER, "ผู้ประสานงานของหน่วยงาน", "DONE"),
  step(2, "OFFICER_REVIEW", ReviewTaskType.BDI_OFFICER_REVIEW, "BDI ตรวจสอบคำขอ", "รอ BDI ตรวจสอบ", ROLE_CODES.BDI_OFFICER, "ผู้ประสานงานของ BDI", "CURRENT"),
  step(3, "ORGANIZATION_APPROVAL", ReviewTaskType.ORGANIZATION_APPROVAL, "หน่วยงานลงนามเห็นชอบ", "รอหน่วยงานลงนาม", ROLE_CODES.ORGANIZATION_APPROVER, "ผู้มีอำนาจอนุมัติของหน่วยงาน", "UPCOMING"),
  step(4, "FINAL_APPROVAL", ReviewTaskType.BDI_FINAL_APPROVAL, "BDI พิจารณาเห็นชอบ", "รอ BDI อนุมัติ", ROLE_CODES.BDI_FINAL_APPROVER, "ผู้มีอำนาจอนุมัติของ BDI", "UPCOMING"),
];
const PROGRESS: JourneyProgress = {
  steps,
  totalSteps: 4,
  currentOrder: 2,
  currentStep: steps[1]!,
  nextStep: steps[2]!,
  phase: "IN_PROGRESS",
};

const DATASET = {
  requestNumber: "DS-2569-0001",
  organizationCode: ORG.code,
  organizationName: ORG.name,
  datasetName: "ข้อมูลสถิติการท่องเที่ยวรายจังหวัด",
  id: SAMPLE_ID,
};
const NOTE = "กรุณาแนบหนังสือนำส่งที่ลงนามโดยหัวหน้าหน่วยงาน และแก้ไขชื่อผู้ประสานงานให้ตรงกับบัตรประชาชน";

const SAMPLES: Record<string, () => EmailContext> = {
  invitation_external: () =>
    invitationContext(SAMPLE_KEY, { roleLabel: "ผู้ประสานงานของหน่วยงาน", organizationName: ORG.name, expiresAt: EXPIRES, internal: false }),
  invitation_internal: () =>
    invitationContext(SAMPLE_KEY, {
      roleLabel: "ผู้ประสานงานของ BDI",
      organizationName: "สถาบันข้อมูลขนาดใหญ่ (องค์การมหาชน)",
      expiresAt: EXPIRES,
      internal: true,
    }),
  invitation_reminder: () =>
    invitationReminderContext(
      { roleLabel: "ผู้ประสานงานของหน่วยงาน", organizationName: ORG.name, issuedAt: ISSUED, expiresAt: EXPIRES, internal: false },
      INVITATION_SUBJECT_DEFAULT,
    ),
  password_reset: () =>
    passwordResetContext("somchai@example.go.th", "example-token", { displayName: "นาย สมชาย ใจดี", expiresAt: EXPIRES }),
  otp: () => otpContext("482916"),
  role_removed: () =>
    roleRemovedContext({ organizationName: ORG.name, roleLabel: "ผู้ประสานงานของหน่วยงาน", successorName: "นางสาว วิไล ใจงาม", removedAt: AT }),
  org_submitted: () => orgSubmittedContext(ORG, "นาง สมหญิง รักดี", SAMPLE_ID, PROGRESS),
  org_revision: () => orgRevisionContext(ORG, NOTE, SAMPLE_ID, PROGRESS),
  org_signatory_request: () => signatoryRequestContext(ORG, SAMPLE_ID, undefined, PROGRESS),
  org_signatory_register: () => signatoryRequestContext(ORG, SAMPLE_ID, "example-token", PROGRESS),
  org_final_approval: () => finalApprovalContext(ORG, SAMPLE_ID, PROGRESS),
  org_activated: () => activatedContext(ORG, SAMPLE_ID, PROGRESS),
  dataset_submitted: () => datasetSubmittedContext({ ...DATASET, submitter: "นาง สมหญิง รักดี" }, PROGRESS),
  dataset_revision: () => datasetRevisionContext({ ...DATASET, note: NOTE, byName: "นาย ประเสริฐ มั่นคง", at: AT }, PROGRESS),
  dataset_specialist_assigned: () => datasetSpecialistAssignedContext(DATASET, PROGRESS),
  dataset_specialist_commented: () =>
    datasetSpecialistCommentedContext(
      { ...DATASET, note: "ชุดข้อมูลนี้ควรระบุความถี่ในการปรับปรุงให้ชัดเจน", byName: "ดร. วิชัย รู้ลึก", at: AT },
      PROGRESS,
    ),
  dataset_pending_org_approver: () => datasetPendingOrgApproverContext(DATASET, PROGRESS),
  dataset_signed_pending: () => datasetSignedPendingContext({ ...DATASET, signedBy: "นาย ประเสริฐ มั่นคง" }, PROGRESS),
  dataset_pending_bdi: () => datasetPendingBdiContext(DATASET, PROGRESS),
  dataset_approved: () => datasetApprovedContext(DATASET, PROGRESS),
  dataset_rejected: () =>
    datasetRejectedContext({ ...DATASET, reason: "ชุดข้อมูลซ้ำกับที่ลงทะเบียนไว้แล้ว (DS-2568-0042)" }, PROGRESS),
  request_progressed: () =>
    requestProgressedContext(
      {
        title: "คำขอของคุณเดินหน้าไปอีกขั้น",
        message: "คำขอ ORG-0001 ผ่านการตรวจสอบของผู้ประสานงานของ BDI แล้ว และรอผู้มีอำนาจอนุมัติของหน่วยงาน",
        path: `/organizations/${SAMPLE_ID}`,
        orgCode: ORG.code,
      },
      PROGRESS,
    ),
};

/** เทมเพลตที่ใช้แสดงแม่แบบกลางใน preview — อีเมลที่มีครบทุกส่วน (รหัสหน่วยงาน ขั้นตอน ปุ่ม) */
export const LAYOUT_PREVIEW_KEY = "org_activated";

export function sampleContext(key: string): EmailContext {
  const build = SAMPLES[key === LAYOUT_KEY ? LAYOUT_PREVIEW_KEY : key];
  if (!build) throw new Error(`ไม่มีข้อมูลตัวอย่างของเทมเพลต ${key}`);
  return build();
}
