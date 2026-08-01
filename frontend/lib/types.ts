import type { OrganizationStatus } from "./status";

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
