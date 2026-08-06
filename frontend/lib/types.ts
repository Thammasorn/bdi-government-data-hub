import type {
  CLASSIFICATION_LABELS,
  DATASET_CATEGORY_LABELS,
  DATASET_TYPE_LABELS,
  DATA_FORMAT_LABELS,
  DELIVERY_METHOD_LABELS,
  DatasetRequestStatus,
  FREQUENCY_LABELS,
  GEO_COVERAGE_LABELS,
  LICENSE_LABELS,
  OrganizationStatus,
} from "./status";

export interface Attachment {
  id: string;
  kind: "APPOINTMENT_ORDER" | "POWER_OF_ATTORNEY" | "GENERATED_FORM";
  filename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

export interface OrganizationEvent {
  id: string;
  type: string;
  note: string | null;
  createdAt: string;
  actor: { firstName: string | null; lastName: string | null; email: string } | null;
}

export interface Organization {
  id: string;
  status: OrganizationStatus;
  name: string;
  addressLine: string | null;
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

  createdBy: {
    id: string;
    email: string;
    prefix: string | null;
    firstName: string | null;
    lastName: string | null;
  };
  attachments: Attachment[];
  events: OrganizationEvent[];
}

export interface OrganizationListItem {
  id: string;
  name: string;
  status: OrganizationStatus;
  submittedAt: string | null;
  createdAt: string;
  createdBy: { firstName: string | null; lastName: string | null; email: string };
}

export const fullName = (
  prefix?: string | null,
  first?: string | null,
  last?: string | null,
): string => [prefix, first, last].filter(Boolean).join(" ") || "—";

export const ATTACHMENT_LABELS: Record<Attachment["kind"], string> = {
  APPOINTMENT_ORDER: "คำสั่งแต่งตั้งผู้มีอำนาจกระทำการแทน",
  POWER_OF_ATTORNEY: "คำสั่งมอบอำนาจ",
  GENERATED_FORM: "แบบฟอร์มที่ระบบสร้าง",
};

// ------------------------------------------------------------------ ชุดข้อมูล (Journey C)

export type DatasetType = keyof typeof DATASET_TYPE_LABELS;
export type DatasetCategory = keyof typeof DATASET_CATEGORY_LABELS;
export type UpdateFrequency = keyof typeof FREQUENCY_LABELS;
export type GeoCoverage = keyof typeof GEO_COVERAGE_LABELS;
export type DeliveryMethod = keyof typeof DELIVERY_METHOD_LABELS;
export type DataFormat = keyof typeof DATA_FORMAT_LABELS;
export type DataClassification = keyof typeof CLASSIFICATION_LABELS;
export type LicenseType = keyof typeof LICENSE_LABELS;

export interface DatasetAttachment {
  id: string;
  kind: "DATA_DICTIONARY" | "EXAMPLE_DATA" | "GENERATED_FORM";
  filename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

export interface DatasetRequestEvent {
  id: string;
  type: string;
  note: string | null;
  createdAt: string;
  actor: { firstName: string | null; lastName: string | null; email: string } | null;
}

export interface DatasetRequest {
  id: string;
  requestNumber: string;
  status: DatasetRequestStatus;

  nameTh: string | null;
  nameEn: string | null;
  description: string | null;
  datasetType: DatasetType | null;
  category: DatasetCategory | null;
  keywords: string[];
  updateFrequency: UpdateFrequency | null;
  geoCoverage: GeoCoverage | null;
  dataStartDate: string | null;
  dataEndDate: string | null;
  estimatedRecords: number | null;
  stewardName: string | null;
  stewardEmail: string | null;
  stewardPhone: string | null;

  deliveryMethod: DeliveryMethod | null;
  dataFormat: DataFormat | null;
  deliveryFrequency: UpdateFrequency | null;
  deliveryEndpoint: string | null;
  technicalContactName: string | null;
  technicalContactEmail: string | null;
  deliveryNote: string | null;

  dataClassification: DataClassification | null;
  hasPersonalData: boolean | null;
  personalDataMeasure: string | null;
  legalBasis: string | null;
  licenseType: LicenseType | null;
  usageRestriction: string | null;
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
  createdBy: {
    id: string;
    email: string;
    prefix: string | null;
    firstName: string | null;
    lastName: string | null;
  };
  assignedSpecialist: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
  } | null;
  attachments: DatasetAttachment[];
  events: DatasetRequestEvent[];
}

export interface DatasetRequestListItem {
  id: string;
  requestNumber: string;
  nameTh: string | null;
  status: DatasetRequestStatus;
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
export const datasetTitle = (r: { nameTh: string | null; requestNumber: string }) =>
  r.nameTh?.trim() || `คำขอ ${r.requestNumber}`;
