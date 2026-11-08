/**
 * ชนิดข้อมูลของหน้าเทมเพลตอีเมล (/console/settings/email-templates) — ตรงกับคำตอบของ `routes/admin-email-templates.ts`
 *
 * หน้าจอไม่มีสำเนารายการตัวแปรหรือกติกาการตรวจ: ทั้งหมดมาจาก API (`template.variables`, `template.blocks`) และ preview ตอบ `issues`
 * กลับมาขณะพิมพ์ — ตัวตัดสินคือ backend ที่เดียว
 */

export interface TemplateContent {
  subject: string;
  bodyHtml: string;
  buttonLabel: string | null;
  footnoteHtml: string | null;
}

export type VersionStatus = "DRAFT" | "PUBLISHED" | "SUPERSEDED";

export interface TemplateVersion extends TemplateContent {
  id: string | null;
  versionNumber: number;
  status: VersionStatus;
  isDefault: boolean;
  restoredFromVersion: number | null;
  restoreReason: string | null;
  publishedAt: string | null;
  publishedByName: string | null;
  publishReason: string | null;
  supersededAt: string | null;
  createdAt: string | null;
  createdByName: string | null;
  updatedAt: string | null;
  updatedByName: string | null;
}

export interface TemplateDefinitionView {
  key: string;
  group: string;
  groupLabel: string;
  label: string;
  description: string;
  isLayout: boolean;
  hasButton: boolean;
  variables: Array<{ name: string; label: string; sample: string }>;
  blocks: Array<{ name: string; label: string; required: boolean }>;
  layoutPlaceholders: Array<{ name: string; label: string }>;
  /** รูปจากหน้า "รูปภาพในอีเมล" — แทรกเป็น `{{image.<code>}}` ในเนื้อหา */
  images: Array<{ code: string; name: string }>;
}

export interface TemplateDetail {
  template: TemplateDefinitionView;
  live: TemplateVersion | null;
  draft: TemplateVersion | null;
  versions: TemplateVersion[];
}

export interface TemplateSummary {
  key: string;
  group: string;
  groupLabel: string;
  label: string;
  description: string;
  liveVersion: number;
  isDefault: boolean;
  draftVersion: number | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface ContentIssue {
  field: keyof TemplateContent;
  message: string;
}

export interface PreviewResult {
  subject: string;
  html: string;
  issues: ContentIssue[];
  warnings: string[];
  bytes: number;
}

export const VERSION_STATUS: Record<VersionStatus, { label: string; className: string }> = {
  PUBLISHED: { label: "ใช้งานอยู่", className: "bg-success-bg text-success" },
  DRAFT: { label: "ฉบับร่าง", className: "bg-warning-bg text-warning" },
  SUPERSEDED: { label: "เคยใช้", className: "bg-navy-50 text-ink-muted" },
};

export function contentOf(v: TemplateContent): TemplateContent {
  return { subject: v.subject, bodyHtml: v.bodyHtml, buttonLabel: v.buttonLabel, footnoteHtml: v.footnoteHtml };
}

export function sameContent(a: TemplateContent, b: TemplateContent): boolean {
  const norm = (v: string | null) => (v ?? "").trim();
  return (
    norm(a.subject) === norm(b.subject) &&
    norm(a.bodyHtml) === norm(b.bodyHtml) &&
    norm(a.buttonLabel) === norm(b.buttonLabel) &&
    norm(a.footnoteHtml) === norm(b.footnoteHtml)
  );
}

export type DiffLine = { kind: "same" | "added" | "removed"; text: string };

/**
 * diff ทีละบรรทัด (LCS) สำหรับ "เปรียบเทียบเวอร์ชัน" — เนื้ออีเมลยาวไม่กี่ร้อยบรรทัด O(n·m) จึงพอ
 * `before` คือเวอร์ชันที่ใช้งานอยู่ `after` คือเวอร์ชันที่เลือกดู
 */
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before.split("\n");
  const b = after.split("\n");
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: "same", text: a[i]! });
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      out.push({ kind: "removed", text: a[i++]! });
    } else {
      out.push({ kind: "added", text: b[j++]! });
    }
  }
  while (i < n) out.push({ kind: "removed", text: a[i++]! });
  while (j < m) out.push({ kind: "added", text: b[j++]! });
  return out;
}
