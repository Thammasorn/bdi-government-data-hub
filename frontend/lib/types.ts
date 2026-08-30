import type { RequestStatus, ReviewTaskType, ReviewResult } from "./status";

export interface Attachment {
  id: string;
  /**
   * ค่าเดียวกับ enum `AttachmentType` ใน schema.prisma ซึ่งตั้งชื่อตาม Excel
   * ไม่ใช่ชื่อย่อที่ใช้เรียกช่องบนฟอร์ม — API ส่งค่าใน enum ออกมาตรง ๆ
   *
   * เดิมบรรทัดนี้เขียนว่า APPOINTMENT_ORDER ซึ่งไม่มีอยู่จริงบนสาย ผลคือ
   * ATTACHMENT_LABELS[a.kind] เป็น undefined หน้ารายละเอียดจึงขึ้นแต่ชื่อไฟล์
   * โดยไม่มีหัวข้อว่าไฟล์นั้นคือเอกสารอะไร และฟอร์มแก้ไขก็หาไฟล์เดิมไม่เจอ
   * TypeScript จับให้ไม่ได้เพราะไม่มีทางรู้ว่าปลายสายส่งอะไรมา
   */
  kind: "AUTHORIZED_REPRESENTATIVE_APPOINTMENT_ORDER" | "POWER_OF_ATTORNEY" | "GENERATED_FORM";
  filename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

/**
 * หนึ่งแถวใน review.review_task — ใช้เป็น timeline ทั้งสอง Journey
 * ตาราง organization_events / dataset_request_events ถูกตัดออกตามดีไซน์แล้ว
 */
export interface ReviewTaskEvent {
  id: string;
  taskType: ReviewTaskType;
  sequenceNumber: number;
  roundNumber: number;
  status: string;
  result: ReviewResult | null;
  note: string | null;
  actor: { id: string; name: string; email: string } | null;
  assignedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

/**
 * เส้นทางการอนุมัติทั้งเส้น — คำนวณที่ backend (`backend/src/lib/journey-steps.ts`)
 *
 * ลอจิกลำดับด่าน **ไม่ถูกคัดลอกมาไว้ฝั่งนี้** ต่างจาก `lib/dataset-form.ts` และ
 * `lib/organization-form.ts` ที่จงใจ copy เพราะฟอร์มต้องตอบสนองทันทีที่ผู้ใช้พิมพ์
 * ตัวแสดงขั้นตอนไม่มีข้อบังคับนั้น จึงมีแต่ข้อเสียถ้าสำเนาหลุด sync กับ state machine
 */
export type StepState = "DONE" | "CURRENT" | "UPCOMING" | "REJECTED";

export type JourneyPhase =
  | "DRAFT"
  | "IN_PROGRESS"
  | "WAITING_REVISION"
  | "APPROVED"
  | "REJECTED"
  | "CANCELLED";

export interface JourneyStep {
  key: string;
  taskType: ReviewTaskType;
  /** เลขที่แสดง; null สำหรับขั้นไม่บังคับ ซึ่งไม่ถูกนับใน totalSteps */
  order: number | null;
  optional: boolean;
  label: string;
  shortLabel: string;
  waitingLabel: string;
  roleCode: string;
  roleLabel: string;
  state: StepState;
  result: ReviewResult | null;
  completedAt: string | null;
  roundNumber: number | null;
}

export interface JourneyProgress {
  steps: JourneyStep[];
  totalSteps: number;
  currentOrder: number | null;
  currentStep: JourneyStep | null;
  nextStep: JourneyStep | null;
  phase: JourneyPhase;
}

/** ฉบับย่อสำหรับตารางและการ์ด — หน้ารายการไม่ได้รับรายการขั้นทั้งชุด */
export interface JourneyProgressSummary {
  totalSteps: number;
  currentOrder: number | null;
  /** ช่องที่คำขอค้างอยู่ — คีย์เดียวกับโหนดในแผนภาพ badge อ่านคำจาก currentLabel คู่กัน */
  currentKey: string | null;
  /** ชื่อสั้นของช่องปัจจุบัน — badge ใช้ตัวนี้ ชื่อเต็มไปอยู่ใน hover */
  currentShortLabel: string | null;
  currentLabel: string | null;
  nextLabel: string | null;
  phase: JourneyPhase;
}

export interface Organization {
  /** id ของ **คำขอจดทะเบียน** ไม่ใช่ของหน่วยงาน — ทุก path ของ `/api/organizations/:id` ใช้ตัวนี้ */
  id: string;
  /** id ของ **หน่วยงาน** ตัวที่ตรงกับ `user.organizationId` */
  organizationId: string;
  status: RequestStatus;
  currentTaskType: ReviewTaskType | null;
  /** รหัสหน่วยงาน — เจ้าหน้าที่กรอกไว้ล่วงหน้า ผู้ใช้ยืนยัน/แก้ไขในฟอร์ม */
  organizationCode: string | null;
  name: string;
  addressLine: string | null;
  road: string | null;
  province: string | null;
  district: string | null;
  subdistrict: string | null;
  postalCode: string | null;
  email: string | null;

  signatoryPrefix: string | null;
  signatoryFirstName: string | null;
  signatoryLastName: string | null;
  signatoryPosition: string | null;
  signatoryEmail: string | null;
  signatoryNationalId: string | null;
  signatoryPhone: string | null;

  contactPrefix: string | null;
  contactFirstName: string | null;
  contactLastName: string | null;
  contactPosition: string | null;
  contactDepartment: string | null;
  contactEmail: string | null;
  contactPhone: string | null;

  revisionNote: string | null;
  submittedAt: string | null;
  activatedAt: string | null;
  createdAt: string;

  /** null ได้ ถ้าหาบัญชีผู้ยื่นไม่เจอ — หน้าจอต้องรับมือ ไม่ใช่ deref ตรง ๆ */
  createdBy: {
    id: string;
    email: string;
    prefix: string | null;
    firstName: string | null;
    lastName: string | null;
  } | null;
  attachments: Attachment[];
  events: ReviewTaskEvent[];
  progress: JourneyProgress;
}

export interface OrganizationListItem {
  id: string;
  name: string;
  status: RequestStatus;
  currentTaskType: ReviewTaskType | null;
  progress: JourneyProgressSummary | null;
  submittedAt: string | null;
  createdAt: string;
  /** เวลาที่แถวนี้ถูกแก้ล่าสุด — กล่องรายละเอียดตอนชี้เมาส์ใช้บอก "อัปเดตล่าสุด" */
  updatedAt: string;
  createdBy: { firstName: string | null; lastName: string | null; email: string };
}

export const fullName = (
  prefix?: string | null,
  first?: string | null,
  last?: string | null,
): string => [prefix, first, last].filter(Boolean).join(" ") || "—";

export const ATTACHMENT_LABELS: Record<Attachment["kind"], string> = {
  AUTHORIZED_REPRESENTATIVE_APPOINTMENT_ORDER: "คำสั่งแต่งตั้งผู้มีอำนาจกระทำการแทน",
  POWER_OF_ATTORNEY: "คำสั่งมอบอำนาจ",
  GENERATED_FORM: "แบบฟอร์มที่ระบบสร้าง",
};

/**
 * เอกสารกฎหมายหนึ่งฉบับของคำขอ — GET /api/organizations/:id/legal-documents
 *
 * `versionId` คือสิ่งที่ต้องส่งกลับตอนลงนาม ไม่ใช่ `code` เพราะหลักฐานต้องบอกว่ายอมรับ
 * เอกสาร**ฉบับไหน** ถ้าฝ่ายกฎหมายเผยแพร่ฉบับใหม่ระหว่างที่เปิดหน้านี้อยู่ id ที่ส่งกลับ
 * จะไม่ตรงกับที่เผยแพร่ และ backend จะให้โหลดหน้าใหม่แทนที่จะรับการลงนามนั้นไว้
 */
export interface LegalDocument {
  code: string;
  name: string;
  versionId: string;
  versionNumber: number;
  /** true = ฉบับที่ระบบเติมข้อมูลของคำขอนี้ลงไป (A0) — ที่เหลือเป็นไฟล์กลางของทุกหน่วยงาน */
  fromRequest: boolean;
  fileUrl: string | null;
  acceptedAt: string | null;
  /**
   * false = แอดมินตั้งฉบับนี้เป็นเอกสารไม่บังคับ ผู้มีอำนาจกด "ไม่เกี่ยวข้อง" ข้ามได้
   * ฉบับที่ถูกข้ามจะไม่ถูกส่งต่อไปให้ฝ่าย BDI เห็นชอบด้วย
   */
  isRequired: boolean;
}

// ------------------------------------------------------------------ ชุดข้อมูล (Journey C)

export interface DatasetAttachment {
  id: string;
  kind: "DATA_DICTIONARY" | "EXAMPLE_DATA" | "GENERATED_FORM";
  filename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}


export interface DatasetRequest {
  id: string;
  requestNumber: string;
  status: RequestStatus;
  currentTaskType: ReviewTaskType | null;

  /**
   * metadata ตามชีท A4_dataset_metadata ของ metadata_mapping.xlsx
   * ชื่อฟิลด์ตรงกับคอลัมน์ในฐานข้อมูล และเก็บเป็น **รหัส** ของมาตรฐาน ("1", "01", "G0")
   * ป้ายภาษาไทยของแต่ละรหัสอยู่ใน lib/dataset-form.ts
   */
  dataType: string | null;
  dataTopic: string | null;
  dataTopicOther: string | null;
  title: string | null;
  name: string | null;
  maintainer: string | null;
  maintainerEmail: string | null;
  tagString: string | null;
  notes: string | null;
  objective: string | null;
  updateFrequencyUnit: string | null;
  updateFrequencyInterval: number | null;
  deliveryFrequency: string | null;
  geoCoverage: string | null;
  dataSource: string | null;
  dataFormat: string | null;
  dataFormatOther: string | null;
  dataCategory: string | null;
  containsPersonalData: boolean | null;
  personalDataTypes: string | null;
  dataSubjectCategories: string | null;
  personalDataProcessingPeriod: string | null;
  personalDataProcessingPeriodYear: number | null;
  personalDataProcessingPeriodMonth: number | null;
  dataClassification: string | null;
  licenseId: string | null;
  allowOriginalRawDataRetention: boolean | null;
  allowOriginalRawDataSharing: boolean | null;
  allowTransformedRawDataSharing: boolean | null;
  allowTransformedRawDataGdxSharing: boolean | null;
  allowAggregatedDataSharing: boolean | null;
  authorizePersonalDataAnonymization: boolean | null;
  transformedRawDataRecipients: string | null;
  transformedRawDataGdxRecipients: string | null;
  aggregatedDataRecipients: string | null;

  legalAcceptedAt: string | null;

  revisionNote: string | null;
  submittedAt: string | null;
  orgApproverSignedAt: string | null;
  orgApproverSignedName: string | null;
  approvedAt: string | null;
  approvedByName: string | null;
  rejectedAt: string | null;
  rejectedByName: string | null;
  rejectionReason: string | null;
  assignedAt: string | null;
  createdAt: string;

  organization: { id: string; name: string; signatoryEmail: string | null };
  /** null ได้ ถ้าหาบัญชีผู้ยื่นไม่เจอ — หน้าจอต้องรับมือ ไม่ใช่ deref ตรง ๆ */
  createdBy: {
    id: string;
    email: string;
    prefix: string | null;
    firstName: string | null;
    lastName: string | null;
  } | null;
  assignedSpecialist: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
  } | null;
  attachments: DatasetAttachment[];
  events: ReviewTaskEvent[];
  progress: JourneyProgress;
}

export interface DatasetRequestListItem {
  id: string;
  requestNumber: string;
  /** ชื่อชุดข้อมูลภาษาไทย — คอลัมน์ `title` ในชีท A4_dataset_metadata */
  title: string | null;
  status: RequestStatus;
  currentTaskType: ReviewTaskType | null;
  progress: JourneyProgressSummary | null;
  submittedAt: string | null;
  createdAt: string;
  /** เวลาที่แถวนี้ถูกแก้ล่าสุด — หน้าแรกแสดงคู่กับวันที่นำข้อมูลเข้ามา */
  updatedAt: string;
  organization: { id: string; name: string };
  createdBy: { firstName: string | null; lastName: string | null; email: string };
  assignedSpecialist: { id: string; firstName: string | null; lastName: string | null } | null;
  /** แบบฟอร์มที่ระบบสร้าง — ว่างได้ ถ้ายังไม่เคยกดตรวจสอบและสร้าง PDF */
  generatedForm: { id: string; filename: string } | null;
}

export interface SpecialistOption {
  id: string;
  email: string;
  prefix: string | null;
  firstName: string | null;
  lastName: string | null;
}

export const DATASET_ATTACHMENT_LABELS: Record<DatasetAttachment["kind"], string> = {
  DATA_DICTIONARY: "พจนานุกรมข้อมูล (Data Dictionary)",
  EXAMPLE_DATA: "ตัวอย่างข้อมูล",
  GENERATED_FORM: "แบบฟอร์มที่ระบบสร้าง",
};

export interface AppNotification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

/** ชื่อที่แสดงของคำขอ — ร่างที่ยังไม่ตั้งชื่อให้ใช้เลขที่คำขอแทน */
export const datasetTitle = (r: { title: string | null; requestNumber: string }) =>
  r.title?.trim() || `คำขอ ${r.requestNumber}`;
