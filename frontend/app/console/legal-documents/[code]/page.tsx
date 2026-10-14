"use client";

import clsx from "clsx";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { ActionDialog } from "@/components/console/ActionDialog";
import { RelatedRequestsModal, type RelatedRequestsTarget } from "@/components/console/RelatedRequestsModal";
import { PdfPane, UploadVersionModal, usePdfPreview } from "@/components/console/LegalUpload";
import { Badge, ErrorNotice, PageHeader, Panel, Tag } from "@/components/console/ui";
import { Pagination } from "@/components/list/Pagination";
import { Button } from "@/components/ui/Button";
import { TextAreaField, TextField } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";
import { useToast } from "@/components/ui/Toast";
import { adminErrorView, type AdminErrorView } from "@/lib/admin-errors";
import { api } from "@/lib/api";
import {
  ACTIVE_META,
  INACTIVE_META,
  SCOPE_TITLES,
  VERSION_META,
  type LegalDocument,
  type LegalVersionRow,
} from "@/lib/legal-admin";
import { formatThaiDate } from "@/lib/status";
import { useAdminData } from "@/lib/use-admin";

/**
 * แก้เอกสารหนึ่งฉบับ — ข้อมูลประจำตัว เปิด/ปิดใช้ เวอร์ชันที่ใช้อยู่ และประวัติเวอร์ชัน (card "Enhance Legal document management" ข้อ 2, 9)
 *
 * แสดงแค่เวอร์ชันที่ใช้อยู่ ประวัติทั้งหมดซ่อนหลังปุ่ม "Version History" (แบ่งหน้า) ปุ่มปิดใช้และช่อง "ข้ามได้" ถูกปิดไว้พร้อมบอกเหตุผลเมื่อทำให้
 * หมวดเสียกติกา (ต้องมีเอกสารที่ผู้ใช้เห็นและเป็นเอกสารบังคับอย่างน้อย 1 ฉบับ) — เป็นการบอกก่อนกด ด่านจริงอยู่ที่ API ซึ่งตอบ 409 พร้อมเหตุผลเดียวกัน
 */
export default function ConsoleLegalDocumentPage() {
  const params = useParams<{ code: string }>();
  const code = decodeURIComponent(params.code ?? "");
  const { data, error, loading, reload } = useAdminData<{ documents: LegalDocument[] }>("/api/admin/legal-documents");
  const [uploading, setUploading] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [previewing, setPreviewing] = useState<PreviewTarget | null>(null);
  const [related, setRelated] = useState<RelatedRequestsTarget | null>(null);
  const { show } = useToast();

  if (loading && !data) return <Spinner />;
  if (error && !data) return <ErrorNotice view={adminErrorView(error)} />;
  if (!data) return null;

  const doc = data.documents.find((d) => d.code === code);
  if (!doc) {
    return (
      <PageHeader
        title="ไม่พบเอกสาร"
        back={{ href: "/console/legal-documents", label: "เอกสารข้อตกลง" }}
        description={`ไม่มีเอกสารรหัส ${code} ในระบบ`}
      />
    );
  }

  const sameScope = data.documents.filter((d) => d.scope === doc.scope);
  const serving = sameScope.filter((d) => d.isActive && d.hasPublishedVersion);
  const isServing = doc.isActive && doc.hasPublishedVersion;
  const lastRequired = isServing && doc.isRequired && serving.filter((d) => d.isRequired).length === 1;
  const scopeTitle = SCOPE_TITLES[doc.scope];

  /** เหตุผลที่ปิดใช้ไม่ได้ — ข้อความเดียวกับที่ API ตอบ 409 (`assertScopeStillWorks()` ใน admin-legal-documents.ts) */
  const cannotDeactivate = !doc.isActive
    ? null
    : isServing && serving.length === 1
      ? "ปิดใช้ไม่ได้ — เป็นเอกสารที่ใช้งานเพียงฉบับเดียวของหมวดนี้"
      : lastRequired
        ? "ปิดใช้ไม่ได้ — เป็นเอกสารบังคับฉบับสุดท้ายของหมวดนี้"
        : null;
  const cannotActivate = doc.isActive
    ? null
    : doc.hasPublishedVersion
      ? null
      : "เปิดใช้ไม่ได้ — ยังไม่มีเวอร์ชันที่เผยแพร่";

  return (
    <div>
      <PageHeader
        eyebrow={`ตั้งค่าเอกสาร · ${scopeTitle}`}
        title={
          <span className="flex flex-wrap items-center gap-2">
            {doc.name}
            <Tag>{doc.code}</Tag>
          </span>
        }
        back={{ href: "/console/legal-documents", label: "เอกสารข้อตกลง" }}
      />

      <div className="space-y-6">
        <Panel
          title={
            <span className="flex flex-wrap items-center gap-2">
              สถานะการใช้งาน
              <Badge meta={doc.isActive ? ACTIVE_META : INACTIVE_META} className="leading-5" />
            </span>
          }
          // มีคำอธิบายก็ต่อเมื่อปุ่มถูกปิด — บอกเหตุผลที่ทำไม่ได้ ไม่ใช่อธิบายสถานะ
          description={cannotDeactivate ?? cannotActivate ?? undefined}
          actions={
            <Button
              size="sm"
              variant={doc.isActive ? "secondary" : "primary"}
              disabled={Boolean(cannotDeactivate ?? cannotActivate)}
              onClick={() => setToggling(true)}
            >
              {doc.isActive ? "ปิดใช้เอกสารนี้" : "เปิดใช้เอกสารนี้"}
            </Button>
          }
          compact
        />

        <InfoForm key={doc.code + doc.name + (doc.shortname ?? "") + (doc.legalNotice ?? "") + doc.isRequired} doc={doc} lastRequired={lastRequired} scopeTitle={scopeTitle} onSaved={reload} />


        <ActiveVersion
          doc={doc}
          code={code}
          onUpload={() => setUploading(true)}
          onPreview={() => doc.activeVersion && setPreviewing({ id: doc.activeVersion.id, versionNumber: doc.activeVersion.versionNumber, mode: "rendered" })}
          onRelated={() =>
            doc.activeVersion &&
            setRelated({ code: doc.code, versionId: doc.activeVersion.id, versionNumber: doc.activeVersion.versionNumber })
          }
          onHistory={() => setShowHistory((s) => !s)}
          historyOpen={showHistory}
        />

        {showHistory ? (
          <VersionHistory
            doc={doc}
            onChanged={reload}
            onPreview={(v) => setPreviewing({ id: v.id, versionNumber: v.versionNumber, mode: "rendered" })}
            onRelated={(v) => setRelated({ code: doc.code, versionId: v.id, versionNumber: v.versionNumber })}
          />
        ) : null}
      </div>

      <VersionPreviewModal doc={doc} target={previewing} onClose={() => setPreviewing(null)} />
      <RelatedRequestsModal target={related} onClose={() => setRelated(null)} />
      <UploadVersionModal
        doc={uploading ? doc : null}
        onClose={() => setUploading(false)}
        onDone={() => {
          show({ tone: "success", title: "บันทึกเวอร์ชันใหม่แล้ว" });
          reload();
        }}
      />
      <ActionDialog
        open={toggling}
        onClose={() => setToggling(false)}
        title={doc.isActive ? `ปิดใช้ ${doc.code}` : `เปิดใช้ ${doc.code}`}
        confirmLabel={doc.isActive ? "ปิดใช้" : "เปิดใช้"}
        tone={doc.isActive ? "danger" : "primary"}
        reason={false}
        onConfirm={async () => {
          const res = await api.patch<{ message: string }>(`/api/admin/legal-documents/${doc.code}`, {
            isActive: !doc.isActive,
          });
          show({ tone: "success", title: res.message });
          reload();
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------- ข้อมูลประจำตัว

function InfoForm({
  doc,
  lastRequired,
  scopeTitle,
  onSaved,
}: {
  doc: LegalDocument;
  lastRequired: boolean;
  scopeTitle: string;
  onSaved: () => void;
}) {
  const [name, setName] = useState(doc.name);
  const [shortname, setShortname] = useState(doc.shortname ?? "");
  const [notice, setNotice] = useState(doc.legalNotice ?? "");
  const [required, setRequired] = useState(doc.isRequired);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AdminErrorView | null>(null);
  const { show } = useToast();

  const dirty =
    name.trim() !== doc.name ||
    shortname.trim() !== (doc.shortname ?? "") ||
    notice.trim() !== (doc.legalNotice ?? "") ||
    required !== doc.isRequired;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.patch<{ message?: string }>(`/api/admin/legal-documents/${doc.code}`, {
        nameTh: name.trim(),
        shortname: shortname.trim() || null,
        legalNotice: notice.trim() || null,
        isRequired: required,
      });
      show({ tone: "success", title: "บันทึกข้อมูลเอกสารแล้ว", detail: res.message });
      onSaved();
    } catch (err) {
      setError(adminErrorView(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="ข้อมูลเอกสาร">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <TextField
          label="ชื่อเอกสาร (name_th)"
          required
          value={name}
          maxLength={500}
          onChange={(e) => setName(e.target.value)}
          error={error?.fields.nameTh}
        />
        <TextField
          label="ชื่อสั้น (short_name)"
          value={shortname}
          maxLength={200}
          onChange={(e) => setShortname(e.target.value)}
          error={error?.fields.shortname}
        />
        <TextAreaField
          label="ข้อความเตือนใต้เอกสาร (legal_notice)"
          rows={3}
          value={notice}
          onChange={(e) => setNotice(e.target.value)}
          error={error?.fields.legalNotice}
        />
        <div>
          <label className={clsx("flex items-start gap-2.5 rounded-xl bg-canvas px-4 py-3 text-[14px]", lastRequired && "opacity-70")}>
            <input
              type="checkbox"
              className="mt-1"
              checked={!required}
              disabled={lastRequired}
              onChange={(e) => setRequired(!e.target.checked)}
            />
            <span>
              <span className="font-medium text-ink">ผู้ลงนามข้ามเอกสารนี้ได้ (ไม่บังคับ)</span>
            </span>
          </label>
          {lastRequired ? (
            <p role="note" className="mt-2 text-[13px] text-ink-muted">
              เปลี่ยนเป็นไม่บังคับไม่ได้ — เป็นเอกสารบังคับฉบับสุดท้ายของหมวดนี้
            </p>
          ) : null}
        </div>
        {error ? <ErrorNotice view={error} hideFields={["nameTh", "shortname", "legalNotice"]} /> : null}
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={!dirty || busy}
            onClick={() => {
              setName(doc.name);
              setShortname(doc.shortname ?? "");
              setNotice(doc.legalNotice ?? "");
              setRequired(doc.isRequired);
              setError(null);
            }}
          >
            ยกเลิกการแก้ไข
          </Button>
          <Button type="submit" loading={busy} disabled={!dirty || name.trim() === ""}>
            บันทึก
          </Button>
        </div>
      </form>
    </Panel>
  );
}

// ---------------------------------------------------------------- เวอร์ชันที่ใช้อยู่

function ActiveVersion({
  doc,
  code,
  onUpload,
  onPreview,
  onRelated,
  onHistory,
  historyOpen,
}: {
  doc: LegalDocument;
  code: string;
  onUpload: () => void;
  onPreview: () => void;
  onRelated: () => void;
  onHistory: () => void;
  historyOpen: boolean;
}) {
  const v = doc.activeVersion;
  const file = (id: string, kind: "docx" | "pdf") => api.fileUrl(`/api/admin/legal-documents/${code}/versions/${id}/file?kind=${kind}`);

  return (
    <Panel
      centered
      title="Version"
      actions={
        <>
          <Button size="sm" variant="secondary" onClick={onHistory} aria-expanded={historyOpen}>
            Version History{doc.versionCount > 0 ? ` (${doc.versionCount})` : ""}
          </Button>
          <Button size="sm" onClick={onUpload}>
            อัปโหลดฉบับใหม่
          </Button>
        </>
      }
    >
      {v ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 font-medium text-ink">
              Version {v.versionNumber} <Badge meta={VERSION_META.PUBLISHED} className="leading-5" />
            </p>
            <p className="text-[13.5px] text-ink-muted">
              เผยแพร่ {formatThaiDate(v.publishedAt)}
              {v.publishedBy ? ` โดย ${v.publishedBy}` : ""}
              {doc.draftVersionCount > 0 ? ` · มีฉบับร่างรอเผยแพร่ ${doc.draftVersionCount} ฉบับ` : ""}
            </p>
            <p className="text-[13.5px] text-ink-muted">
              ใช้งานใน <span className="tabular-nums font-medium text-ink">{v.usageCount.toLocaleString("th-TH")}</span> คำขอ
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <button
              type="button"
              onClick={onPreview}
              className="rounded-full px-3 py-1.5 text-[13.5px] font-medium text-navy-700 hover:bg-navy-50"
            >
              ดูตัวอย่าง
            </button>
            <button
              type="button"
              onClick={onRelated}
              className="rounded-full px-3 py-1.5 text-[13.5px] font-medium text-navy-700 hover:bg-navy-50"
            >
              ดูคำขอที่เกี่ยวข้อง
            </button>
            <a href={file(v.id, "docx")} className="rounded-full px-3 py-1.5 text-[13.5px] font-medium text-navy-700 hover:bg-navy-50">
              ดาวน์โหลด .docx
            </a>
            <a href={file(v.id, "pdf")} className="rounded-full px-3 py-1.5 text-[13.5px] font-medium text-navy-700 hover:bg-navy-50">
              PDF ฉบับเปล่า
            </a>
          </div>
        </div>
      ) : (
        <p role="note" className="rounded-xl bg-warning-bg px-4 py-3 text-[14px] text-ink">
          ยังไม่มีเวอร์ชันที่เผยแพร่{doc.draftVersionCount > 0 ? ` · มีฉบับร่าง ${doc.draftVersionCount} ฉบับ` : ""}
        </p>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------- ประวัติเวอร์ชัน

interface HistoryPayload {
  page: number;
  pageSize: number;
  total: number;
  versions: LegalVersionRow[];
}

function VersionHistory({
  doc,
  onChanged,
  onPreview,
  onRelated,
}: {
  doc: LegalDocument;
  onChanged: () => void;
  onPreview: (v: LegalVersionRow) => void;
  onRelated: (v: LegalVersionRow) => void;
}) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const history = useAdminData<HistoryPayload>(
    `/api/admin/legal-documents/${doc.code}/versions?page=${page}&pageSize=${pageSize}`,
  );
  const [activating, setActivating] = useState<LegalVersionRow | null>(null);
  const [restoring, setRestoring] = useState<LegalVersionRow | null>(null);
  const { show } = useToast();

  const refresh = () => {
    history.reload();
    onChanged();
  };

  const file = (v: LegalVersionRow) => api.fileUrl(`/api/admin/legal-documents/${doc.code}/versions/${v.id}/file?kind=docx`);

  return (
    <Panel title="Version History" flush>
      {history.loading && !history.data ? (
        <div className="p-6">
          <Spinner />
        </div>
      ) : history.error && !history.data ? (
        <div className="p-5">
          <ErrorNotice view={adminErrorView(history.error)} />
        </div>
      ) : history.data ? (
        <div className="p-5">
          <div>
            <ul className="divide-y divide-line rounded-xl ring-1 ring-line">
              {history.data.versions.map((v) => (
                <li key={v.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="flex items-center gap-2 font-medium text-ink">
                      Version {v.versionNumber} <Badge meta={VERSION_META[v.status]} />
                    </p>
                    <div className="flex flex-wrap items-center gap-1">
                      <button
                        type="button"
                        onClick={() => onPreview(v)}
                        className="rounded-full px-2.5 py-1 text-[13px] font-medium text-navy-700 hover:bg-navy-50"
                      >
                        ดูตัวอย่าง
                      </button>
                      <button
                        type="button"
                        onClick={() => onRelated(v)}
                        className="rounded-full px-2.5 py-1 text-[13px] font-medium text-navy-700 hover:bg-navy-50"
                      >
                        ดูคำขอที่เกี่ยวข้อง
                      </button>
                      <a href={file(v)} className="rounded-full px-2.5 py-1 text-[13px] font-medium text-navy-700 hover:bg-navy-50">
                        .docx
                      </a>
                      {v.status === "DRAFT" ? (
                        <button
                          type="button"
                          onClick={() => setActivating(v)}
                          className="rounded-full px-2.5 py-1 text-[13px] font-medium text-coral-600 hover:bg-coral-50"
                        >
                          ใช้เวอร์ชันนี้
                        </button>
                      ) : null}
                      {v.status === "SUPERSEDED" ? (
                        <button
                          type="button"
                          onClick={() => setRestoring(v)}
                          className="rounded-full px-2.5 py-1 text-[13px] font-medium text-coral-600 hover:bg-coral-50"
                        >
                          เผยแพร่อีกครั้ง
                        </button>
                      ) : null}
                    </div>
                  </div>
                  <p className="mt-0.5 text-[13px] text-ink-muted">
                    {v.filename} · อัปโหลด {formatThaiDate(v.createdAt)}
                    {v.createdBy ? ` โดย ${v.createdBy}` : ""}
                  </p>
                  <p className="text-[13px] text-ink-muted">
                    ใช้งานใน <span className="tabular-nums font-medium text-ink">{v.usageCount.toLocaleString("th-TH")}</span> คำขอ
                  </p>
                  <p className="text-[13px] text-ink-muted">
                    {v.publishedAt ? `เผยแพร่ ${formatThaiDate(v.publishedAt)}${v.publishedBy ? ` โดย ${v.publishedBy}` : ""}` : "ยังไม่เผยแพร่"}
                    {v.supersededAt ? ` · แทนที่เมื่อ ${formatThaiDate(v.supersededAt)}` : ""}
                  </p>
                </li>
              ))}
            </ul>
            <Pagination
              info={{ ...history.data, pageCount: Math.max(1, Math.ceil(history.data.total / pageSize)) }}
              onPage={setPage}
              pageSize={pageSize}
              onPageSize={(size) => {
                setPageSize(size);
                setPage(1);
              }}
            />
          </div>
        </div>
      ) : null}

      <ActionDialog
        open={activating !== null}
        onClose={() => setActivating(null)}
        title={activating ? `ใช้ Version ${activating.versionNumber} ของ ${doc.code}` : ""}
        confirmLabel="ใช้เวอร์ชันนี้"
        reason={false}
        onConfirm={async () => {
          if (!activating) return;
          const res = await api.post<{ message: string }>(
            `/api/admin/legal-documents/${doc.code}/versions/${activating.id}/activate`,
          );
          show({ tone: "success", title: res.message });
          refresh();
        }}
      />
      <ActionDialog
        open={restoring !== null}
        onClose={() => setRestoring(null)}
        title={restoring ? `เผยแพร่ Version ${restoring.versionNumber} ของ ${doc.code} อีกครั้ง` : ""}
        confirmLabel="เผยแพร่อีกครั้ง"
        reason={false}
        onConfirm={async () => {
          if (!restoring) return;
          const res = await api.post<{ message: string }>(
            `/api/admin/legal-documents/${doc.code}/versions/${restoring.id}/activate`,
          );
          show({ tone: "success", title: res.message });
          refresh();
        }}
      />
    </Panel>
  );
}

// ---------------------------------------------------------------- ตัวอย่างเอกสาร

interface PreviewTarget {
  id: string;
  versionNumber: number;
  mode: "raw" | "rendered";
}

/** modal ตัวอย่าง PDF ของเวอร์ชันที่เก็บไว้ — เปิดได้จากเวอร์ชันที่ใช้อยู่และจากทุกแถวของ Version History สลับ "ก่อน/หลัง render" ในตัว */
function VersionPreviewModal({
  doc,
  target,
  onClose,
}: {
  doc: LegalDocument;
  target: PreviewTarget | null;
  onClose: () => void;
}) {
  const preview = usePdfPreview();
  const [mode, setMode] = useState<"raw" | "rendered">("rendered");
  const { show } = preview;

  const load = useCallback(
    (t: PreviewTarget, m: "raw" | "rendered") => {
      setMode(m);
      void show(
        `Version ${t.versionNumber} — ${m === "raw" ? "ก่อน render" : "หลัง render"}`,
        m === "rendered",
        () => api.getBlob(`/api/admin/legal-documents/${doc.code}/versions/${t.id}/preview?mode=${m}`),
      );
    },
    [doc.code, show],
  );

  // เปิดเวอร์ชันใหม่ (หรือโหมดใหม่จากปุ่มข้างนอก) = โหลดตัวอย่างใหม่ทันที
  useEffect(() => {
    if (target) load(target, target.mode);
  }, [target, load]);

  return (
    <Modal
      open={target !== null}
      onClose={() => {
        preview.clear();
        onClose();
      }}
      title={target ? `ตัวอย่าง ${doc.name} — Version ${target.versionNumber}` : ""}
      size="xl"
    >
      {target ? (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant={mode === "raw" ? "primary" : "secondary"} onClick={() => load(target, "raw")}>
              ก่อน render
            </Button>
            <Button size="sm" variant={mode === "rendered" ? "primary" : "secondary"} onClick={() => load(target, "rendered")}>
              หลัง render
            </Button>
          </div>
          <PdfPane preview={preview} />
        </div>
      ) : null}
    </Modal>
  );
}
