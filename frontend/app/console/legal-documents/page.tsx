"use client";

import { useRef, useState } from "react";

import { ActionDialog } from "@/components/console/ActionDialog";
import { Badge, ErrorNotice, PageHeader, Panel, Tag, WarningList } from "@/components/console/ui";
import { Button } from "@/components/ui/Button";
import { TextAreaField, TextField } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";
import { useToast } from "@/components/ui/Toast";
import { adminErrorView, type AdminErrorView } from "@/lib/admin-errors";
import { api } from "@/lib/api";
import { formatThaiDate } from "@/lib/status";
import { useAdminData } from "@/lib/use-admin";

interface LegalVersion {
  id: string;
  versionNumber: number;
  status: "DRAFT" | "PUBLISHED" | "SUPERSEDED" | "ARCHIVED";
  contentHash: string | null;
  publishedAt: string | null;
  supersededAt: string | null;
  publishedBy: string | null;
}

interface LegalDocument {
  code: string;
  name: string;
  shortname: string | null;
  legalNotice: string | null;
  isRequired: boolean;
  scope: string;
  status: string;
  displayOrder: number;
  versions: LegalVersion[];
}

interface LegalPayload {
  documents: LegalDocument[];
  variableGroups: Array<{
    group: string;
    title: string;
    variables: Array<{ name: string; description: string; example: string }>;
  }>;
}

const SCOPE_TITLES: Record<string, { title: string; note: string }> = {
  ORGANIZATION_REGISTRATION: {
    title: "เอกสารของคำขอลงทะเบียนหน่วยงาน",
    note: "ผู้มีอำนาจอนุมัติของหน่วยงานอ่านและเห็นชอบทีละฉบับก่อนลงนาม",
  },
  DATASET_REGISTRATION: {
    title: "เอกสารของคำขอส่งชุดข้อมูล",
    note: "แบบฟอร์มที่ระบบเติมค่าจากคำขอให้ผู้ลงนามอ่าน",
  },
};

const VERSION_META: Record<LegalVersion["status"], { label: string; className: string }> = {
  PUBLISHED: { label: "ใช้งานอยู่", className: "bg-success-bg text-success" },
  SUPERSEDED: { label: "ฉบับก่อน", className: "bg-navy-50 text-ink-muted" },
  DRAFT: { label: "ร่าง", className: "bg-warning-bg text-warning" },
  ARCHIVED: { label: "เก็บถาวร", className: "bg-navy-50 text-ink-muted" },
};

/**
 * เอกสารข้อตกลง (A0–A3) และแบบนำส่งข้อมูล (A4) — template เป็นแถวในฐานข้อมูล ไม่ใช่ไฟล์ใน repo (CLAUDE.md, PDF)
 *
 * แก้ได้สองแบบซึ่งเป็นคนละเรื่องกัน (คู่มือ docs/18 บทที่ 5): **ข้อมูลประจำตัว** (ชื่อสั้น ข้อความเตือน ข้ามได้หรือไม่) แก้ที่นี่
 * มีผลทันทีกับทุกคำขอที่เปิดหน้าเอกสาร ส่วน**เนื้อเอกสาร**เปลี่ยนด้วยการอัปโหลด .docx เป็นเวอร์ชันใหม่ ซึ่งระบบตรวจ placeholder
 * และแปลงเป็น PDF ก่อนรับ — ไฟล์ที่ใช้ชื่อตัวแปรผิดถูกปฏิเสธตรงนี้ ไม่ใช่ไปพังบนหน้าจอของหน่วยงาน
 */
export default function ConsoleLegalDocumentsPage() {
  const { data, error, loading, reload } = useAdminData<LegalPayload>("/api/admin/legal-documents");
  const [editing, setEditing] = useState<LegalDocument | null>(null);
  const [uploading, setUploading] = useState<LegalDocument | null>(null);
  const [restoring, setRestoring] = useState<{ doc: LegalDocument; version: LegalVersion } | null>(null);
  const [catalogue, setCatalogue] = useState(false);
  const { show } = useToast();

  if (loading && !data) return <Spinner />;
  if (error && !data) return <ErrorNotice view={adminErrorView(error)} />;
  if (!data) return null;

  // ลำดับตามเส้นทางของผู้ใช้: หน่วยงานลงทะเบียนก่อน แล้วจึงส่งชุดข้อมูล — scope ที่ไม่รู้จักต่อท้าย
  const order = Object.keys(SCOPE_TITLES);
  const scopes = [...new Set(data.documents.map((d) => d.scope))].sort(
    (a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99),
  );

  return (
    <div>
      <PageHeader
        eyebrow="ตั้งค่าระบบ"
        title="เอกสารข้อตกลง"
        description="ข้อมูลของเอกสารแต่ละฉบับ และ template .docx ที่ระบบใช้สร้างเอกสารให้ทุกคำขอ — เวอร์ชันเก่าเก็บไว้ทั้งหมด เพราะเป็นหลักฐานว่าผู้ลงนามเห็นชอบเนื้อความไหน"
        actions={
          <Button size="sm" variant="secondary" onClick={() => setCatalogue(true)}>
            ตัวแปรที่ใช้ใน template
          </Button>
        }
      />

      <div className="space-y-8">
        {scopes.map((scope) => (
          <section key={scope}>
            <h2 className="text-[16px] font-semibold text-navy-800">{SCOPE_TITLES[scope]?.title ?? scope}</h2>
            {SCOPE_TITLES[scope] ? <p className="mb-3 text-[13.5px] text-ink-muted">{SCOPE_TITLES[scope].note}</p> : null}
            <div className="space-y-4">
              {data.documents
                .filter((d) => d.scope === scope)
                .map((doc) => (
                  <DocumentCard
                    key={doc.code}
                    doc={doc}
                    onEdit={() => setEditing(doc)}
                    onUpload={() => setUploading(doc)}
                    onRestore={(version) => setRestoring({ doc, version })}
                  />
                ))}
            </div>
          </section>
        ))}
      </div>

      <EditDialog
        doc={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          show({ tone: "success", title: "บันทึกข้อมูลเอกสารแล้ว" });
          reload();
        }}
      />
      <UploadDialog
        doc={uploading}
        onClose={() => setUploading(null)}
        onPublished={(n) => {
          show({ tone: "success", title: `เผยแพร่เวอร์ชัน ${n} แล้ว` });
          reload();
        }}
      />
      <ActionDialog
        open={restoring !== null}
        onClose={() => setRestoring(null)}
        title={restoring ? `นำเวอร์ชัน ${restoring.version.versionNumber} ของ ${restoring.doc.code} กลับมาใช้` : ""}
        description="ระบบเผยแพร่เนื้อหาของเวอร์ชันนั้นเป็นเวอร์ชันใหม่ล่าสุด ไม่ได้ลบหรือแก้เวอร์ชันใด — ผู้ที่เห็นชอบฉบับปัจจุบันไปแล้วยังผูกกับฉบับนั้น ไฟล์ถูกตรวจ placeholder กับรายชื่อตัวแปรของวันนี้อีกครั้ง"
        confirmLabel="เผยแพร่อีกครั้ง"
        onConfirm={async (reason) => {
          if (!restoring) return;
          const res = await api.post<{ message: string }>(
            `/api/admin/legal-documents/${restoring.doc.code}/versions/${restoring.version.id}/restore`,
            { reason },
          );
          show({ tone: "success", title: res.message });
          reload();
        }}
      />
      <Modal open={catalogue} onClose={() => setCatalogue(false)} title="ตัวแปรที่ใช้ใน template ได้" size="lg">
        <p className="mb-4 text-[14px] text-ink-muted">
          พิมพ์ชื่อในวงเล็บปีกกาคู่ลงในไฟล์ Word เช่น <code className="rounded bg-navy-50 px-1">{"{{org.nameTh}}"}</code> — ชื่อที่ไม่อยู่ในรายการนี้ทำให้อัปโหลดไม่ผ่าน
          ตัวแปรของคำขอหน่วยงานใช้ในเอกสารของคำขอชุดข้อมูลไม่ได้ และกลับกัน
        </p>
        <div className="space-y-5">
          {data.variableGroups
            .filter((g) => g.variables.length > 0)
            .map((g) => (
              <div key={g.group}>
                <h3 className="mb-1.5 text-[14px] font-semibold text-navy-800">{g.title}</h3>
                <dl className="divide-y divide-line rounded-xl ring-1 ring-line">
                  {g.variables.map((v) => (
                    <div key={v.name} className="grid gap-1 px-3 py-2 text-[13.5px] sm:grid-cols-[minmax(0,15rem)_1fr]">
                      <dt className="break-all font-mono text-navy-700">{v.name}</dt>
                      <dd className="text-ink-muted">
                        {v.description}
                        {v.example ? <span className="block text-ink-subtle">เช่น {v.example}</span> : null}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
        </div>
      </Modal>
    </div>
  );
}

function DocumentCard({
  doc,
  onEdit,
  onUpload,
  onRestore,
}: {
  doc: LegalDocument;
  onEdit: () => void;
  onUpload: () => void;
  onRestore: (v: LegalVersion) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const versions = showAll ? doc.versions : doc.versions.slice(0, 3);
  const file = (v: LegalVersion, kind: "docx" | "pdf") =>
    api.fileUrl(`/api/admin/legal-documents/${doc.code}/versions/${v.id}/file?kind=${kind}`);

  return (
    <Panel
      title={
        <span className="flex flex-wrap items-center gap-2">
          <Tag>{doc.code}</Tag>
          {doc.name}
        </span>
      }
      actions={
        <>
          <Button size="sm" variant="secondary" onClick={onEdit}>
            แก้ข้อมูลเอกสาร
          </Button>
          <Button size="sm" onClick={onUpload}>
            อัปโหลดเวอร์ชันใหม่
          </Button>
        </>
      }
      flush
    >
      <div className="grid gap-4 border-b border-line px-5 py-4 text-[14px] sm:grid-cols-3">
        <div>
          <p className="text-[12.5px] text-ink-subtle">ชื่อสั้น</p>
          <p className="text-ink">{doc.shortname ?? "—"}</p>
        </div>
        <div>
          <p className="text-[12.5px] text-ink-subtle">ผู้ลงนามต้องเห็นชอบ</p>
          <p className="text-ink">{doc.isRequired ? "บังคับ" : "ข้ามได้ (เลือก “ไม่เกี่ยวข้อง”)"}</p>
        </div>
        <div className="sm:col-span-3">
          <p className="text-[12.5px] text-ink-subtle">ข้อความเตือนใต้เอกสาร</p>
          <p className="whitespace-pre-line text-ink">{doc.legalNotice ?? "—"}</p>
        </div>
      </div>
      <ul className="divide-y divide-line">
        {versions.map((v) => (
          <li key={v.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
            <div className="min-w-0">
              <p className="flex items-center gap-2 font-medium text-ink">
                เวอร์ชัน {v.versionNumber} <Badge meta={VERSION_META[v.status]} />
              </p>
              <p className="text-[13px] text-ink-muted">
                เผยแพร่ {formatThaiDate(v.publishedAt)}
                {v.publishedBy ? ` โดย ${v.publishedBy}` : ""}
                {v.supersededAt ? ` · แทนที่เมื่อ ${formatThaiDate(v.supersededAt)}` : ""}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1">
              <a href={file(v, "docx")} className="rounded-full px-2.5 py-1 text-[13px] font-medium text-navy-700 hover:bg-navy-50">
                .docx
              </a>
              <a href={file(v, "pdf")} className="rounded-full px-2.5 py-1 text-[13px] font-medium text-navy-700 hover:bg-navy-50">
                PDF
              </a>
              {v.status === "SUPERSEDED" ? (
                <button
                  type="button"
                  onClick={() => onRestore(v)}
                  className="rounded-full px-2.5 py-1 text-[13px] font-medium text-coral-600 hover:bg-coral-50"
                >
                  นำกลับมาใช้
                </button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      {doc.versions.length > 3 ? (
        <button
          type="button"
          onClick={() => setShowAll((s) => !s)}
          className="w-full border-t border-line px-5 py-2.5 text-[13.5px] font-medium text-navy-700 hover:bg-navy-50/50"
        >
          {showAll ? "ซ่อนเวอร์ชันเก่า" : `ดูทุกเวอร์ชัน (${doc.versions.length})`}
        </button>
      ) : null}
    </Panel>
  );
}

function EditDialog({ doc, onClose, onSaved }: { doc: LegalDocument | null; onClose: () => void; onSaved: () => void }) {
  const [shortname, setShortname] = useState("");
  const [notice, setNotice] = useState("");
  const [required, setRequired] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AdminErrorView | null>(null);
  const [lastDoc, setLastDoc] = useState<string | null>(null);

  // เปิดเอกสารใหม่ = เริ่มจากค่าปัจจุบันของเอกสารนั้น
  if (doc && doc.code !== lastDoc) {
    setLastDoc(doc.code);
    setShortname(doc.shortname ?? "");
    setNotice(doc.legalNotice ?? "");
    setRequired(doc.isRequired);
    setError(null);
  }
  if (!doc && lastDoc !== null) setLastDoc(null);

  const save = async () => {
    if (!doc) return;
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/api/admin/legal-documents/${doc.code}`, {
        shortname: shortname.trim() || null,
        legalNotice: notice.trim() || null,
        isRequired: required,
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(adminErrorView(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={doc !== null} onClose={onClose} title={doc ? `แก้ข้อมูล ${doc.code}` : ""} description="มีผลทันทีกับทุกคำขอที่เปิดหน้าเอกสาร ไม่ต้องอัปโหลดไฟล์ใหม่">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <TextField
          label="ชื่อสั้น"
          value={shortname}
          maxLength={200}
          onChange={(e) => setShortname(e.target.value)}
          hint="ชื่อที่แสดงบนแถบเอกสาร เว้นว่างเพื่อใช้ชื่อเต็ม"
          error={error?.fields.shortname}
        />
        <TextAreaField
          label="ข้อความเตือนใต้เอกสาร"
          rows={4}
          value={notice}
          onChange={(e) => setNotice(e.target.value)}
          hint="แสดงใต้บรรทัด “เอกสารฉบับที่ n จาก m” — ไม่ใช่เนื้อเอกสาร"
          error={error?.fields.legalNotice}
        />
        <label className="flex items-start gap-2.5 rounded-xl bg-canvas px-4 py-3 text-[14px]">
          <input type="checkbox" className="mt-1" checked={!required} onChange={(e) => setRequired(!e.target.checked)} />
          <span>
            <span className="font-medium text-ink">ผู้ลงนามข้ามเอกสารนี้ได้</span>
            <span className="block text-[13px] text-ink-muted">ผู้มีอำนาจอนุมัติเลือก “ไม่เกี่ยวข้อง” แทนการเห็นชอบได้</span>
          </span>
        </label>
        {error && Object.keys(error.fields).length === 0 ? <ErrorNotice view={error} /> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            ยกเลิก
          </Button>
          <Button type="submit" loading={busy}>
            บันทึก
          </Button>
        </div>
      </form>
    </Modal>
  );
}

interface UploadResult {
  versionNumber: number;
  placeholders: string[];
  warning?: string;
  /** สิ่งที่ backend จัดรูปให้ก่อนเก็บ (`normaliseTemplate()`) */
  normalised: { optionParagraphs: number; highlights: number };
}

function UploadDialog({
  doc,
  onClose,
  onPublished,
}: {
  doc: LegalDocument | null;
  onClose: () => void;
  onPublished: (versionNumber: number) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AdminErrorView | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);

  const ticks = result ? result.placeholders.filter((p) => p.startsWith("tick.")).length : 0;

  const close = () => {
    setFile(null);
    setError(null);
    setResult(null);
    onClose();
  };

  const upload = async () => {
    if (!doc || !file) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await api.upload<UploadResult>(
        `/api/admin/legal-documents/${doc.code}/versions`,
        form,
      );
      setResult(res);
      onPublished(res.versionNumber);
    } catch (err) {
      setError(adminErrorView(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={doc !== null} onClose={busy ? () => undefined : close} title={doc ? `อัปโหลด ${doc.code} เวอร์ชันใหม่` : ""}>
      {result ? (
        <div className="space-y-4">
          <p className="text-[15px] text-ink">
            เผยแพร่เป็น <strong>เวอร์ชัน {result.versionNumber}</strong> แล้ว — คำขอที่เปิดหน้าเอกสารหลังจากนี้เห็นฉบับใหม่
          </p>
          <WarningList warnings={result.warning ? [result.warning] : []} />
          {result.normalised.optionParagraphs > 0 || result.normalised.highlights > 0 ? (
            <p className="text-[13.5px] text-ink-muted">
              ระบบจัดรูปให้แล้ว:
              {result.normalised.optionParagraphs > 0 ? ` บรรทัดช่องติ๊ก ${result.normalised.optionParagraphs} บรรทัด` : ""}
              {result.normalised.optionParagraphs > 0 && result.normalised.highlights > 0 ? " ·" : ""}
              {result.normalised.highlights > 0 ? ` ลบไฮไลต์ ${result.normalised.highlights} จุด` : ""}
            </p>
          ) : null}
          <div>
            <p className="text-[13px] font-medium text-ink-muted">
              ตัวแปรที่พบในไฟล์ ({result.placeholders.length})
              {/* ช่องติ๊กของ A4 มีเกือบร้อยช่อง ชื่อแต่ละช่องไม่ได้ช่วยให้ตรวจอะไร — นับรวมแทน แสดงชื่อเฉพาะตัวแปรข้อความ */}
              {ticks > 0 ? ` — ช่องติ๊ก ${ticks} ช่อง` : ""}
            </p>
            <p className="mt-1 flex flex-wrap gap-1">
              {result.placeholders.length === 0 ? (
                <span className="text-[13px] text-ink-subtle">ไม่มี — ใช้ไฟล์ PDF กลางฉบับเดียวกับทุกคำขอ</span>
              ) : (
                result.placeholders.filter((p) => !p.startsWith("tick.")).map((p) => <Tag key={p}>{p}</Tag>)
              )}
            </p>
          </div>
          <div className="flex justify-end">
            <Button onClick={close}>เสร็จสิ้น</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-[14px] text-ink-muted">
            เลือกไฟล์ Word (.docx) ที่แก้เสร็จแล้ว ไม่เกิน 20 MB — อัปโหลดได้ตรงจาก Word ระบบจัดรูปบรรทัดช่องติ๊กและลบไฮไลต์ให้เอง
            แล้วตรวจชื่อตัวแปรก่อนเผยแพร่ ถ้าไม่ผ่านจะไม่มีอะไรถูกบันทึก
          </p>
          {/* ปุ่มของ <input type="file"> เขียนเป็นภาษาของเบราว์เซอร์ ("Choose File") — ซ่อนไว้แล้ววาดปุ่มภาษาไทยแทน */}
          <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-line bg-canvas px-4 py-3 hover:border-navy-300">
            <input
              ref={input}
              type="file"
              accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="sr-only"
            />
            <span className="shrink-0 rounded-full bg-navy-800 px-4 py-1.5 text-[14px] font-medium text-white">เลือกไฟล์</span>
            <span className="min-w-0 truncate text-[14px] text-ink-muted">
              {file ? `${file.name} · ${(file.size / 1024 / 1024).toFixed(1)} MB` : "ยังไม่ได้เลือกไฟล์ .docx"}
            </span>
          </label>
          {error ? <ErrorNotice view={error} /> : null}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={close} disabled={busy}>
              ยกเลิก
            </Button>
            <Button onClick={() => void upload()} loading={busy} disabled={!file}>
              ตรวจและเผยแพร่
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
