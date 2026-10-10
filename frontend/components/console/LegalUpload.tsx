"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { ErrorNotice, Tag, WarningList } from "@/components/console/ui";
import { Button } from "@/components/ui/Button";
import { TextAreaField, TextField } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";
import { adminErrorView, type AdminErrorView } from "@/lib/admin-errors";
import { api } from "@/lib/api";
import type { LegalDocument, LegalScope } from "@/lib/legal-admin";

/**
 * ส่วนที่ "อัปโหลดเอกสาร" ใช้ร่วมกัน — ทั้งการออกเวอร์ชันใหม่และการสร้างเอกสารใหม่ (card "Enhance Legal document management" ข้อ 4–5)
 *
 * ลำดับที่ผู้ดูแลเดินคือ เลือกไฟล์ → ระบบตรวจ → ดูตัวอย่าง "ก่อน render" (ตามที่พิมพ์) และ "หลัง render" (เติมข้อมูลตัวอย่าง
 * ไฮไลต์เหลืองเฉพาะส่วนที่ระบบเติม) → ติ๊ก "ใช้ทันที" หรือไม่ → ยืนยัน ไฟล์ไม่ถูกเก็บจนกว่าจะกดยืนยัน ปุ่มดูตัวอย่างจึงส่งไฟล์เดิมจากเบราว์เซอร์ซ้ำ
 */

const MB = 1024 * 1024;

// ---------------------------------------------------------------- ตัวอย่าง PDF

type PreviewState =
  | { status: "idle" }
  | { status: "loading"; label: string }
  | { status: "ready"; label: string; url: string; highlighted: boolean }
  | { status: "error"; view: AdminErrorView };

/**
 * PDF ตัวอย่างที่ได้จาก API เป็นไฟล์ (ไม่ใช่ URL ที่ใช้ cookie เปิดตรงได้ เพราะบางตัวต้องส่งไฟล์ขึ้นไปแปลง) → blob URL สำหรับ `<iframe>`
 * URL เก่าถูกคืนทุกครั้งที่เปลี่ยนและตอนปิดหน้า ไม่งั้นเบราว์เซอร์ถือ PDF ทุกฉบับที่เคยดูไว้จนปิดแท็บ
 */
export function usePdfPreview() {
  const [state, setState] = useState<PreviewState>({ status: "idle" });
  const current = useRef<string | null>(null);
  /** ผลของคำขอที่ช้ากว่าคำขอถัดไปถูกทิ้ง — กดสลับ "ก่อน/หลัง render" เร็ว ๆ ต้องได้ฉบับที่กดล่าสุด */
  const ticket = useRef(0);

  const release = () => {
    if (current.current) URL.revokeObjectURL(current.current);
    current.current = null;
  };

  const show = useCallback(async (label: string, highlighted: boolean, produce: () => Promise<Blob>) => {
    const mine = ++ticket.current;
    setState({ status: "loading", label });
    try {
      const blob = await produce();
      if (mine !== ticket.current) return;
      release();
      current.current = URL.createObjectURL(blob);
      setState({ status: "ready", label, url: current.current, highlighted });
    } catch (err) {
      if (mine === ticket.current) setState({ status: "error", view: adminErrorView(err) });
    }
  }, []);

  const clear = useCallback(() => {
    ticket.current += 1;
    release();
    setState({ status: "idle" });
  }, []);

  useEffect(() => release, []);

  return { state, show, clear };
}

export type PdfPreview = ReturnType<typeof usePdfPreview>;

/** กรอบแสดง PDF ตัวอย่าง — ว่างอยู่จนกว่าจะกดปุ่มดูตัวอย่าง */
export function PdfPane({ preview, className }: { preview: PdfPreview; className?: string }) {
  const { state } = preview;
  return (
    <div className={className}>
      <div className="flex h-full min-h-[22rem] flex-col overflow-hidden rounded-xl border border-line bg-navy-50">
        <div className="flex items-center justify-between gap-3 border-b border-line bg-white px-4 py-2.5">
          <p className="truncate text-[13.5px] font-medium text-ink">
            {state.status === "ready" || state.status === "loading" ? state.label : "ตัวอย่างเอกสาร"}
          </p>
          {state.status === "ready" ? (
            <a
              href={state.url}
              target="_blank"
              rel="noreferrer"
              className="shrink-0 rounded-full px-3 py-1 text-[13px] font-medium text-navy-700 hover:bg-navy-50"
            >
              เปิดในแท็บใหม่
            </a>
          ) : null}
        </div>
        {state.status === "ready" && state.highlighted ? (
          <p className="border-b border-line bg-white px-4 py-1.5 text-[12.5px] text-ink-muted">
            <mark className="rounded bg-yellow-200 px-1 text-ink">ไฮไลต์เหลือง</mark> = ส่วนที่ระบบเติม (ข้อมูลตัวอย่าง)
          </p>
        ) : null}
        <div className="relative min-h-0 flex-1">
          {state.status === "idle" ? (
            <p className="flex h-full min-h-[18rem] items-center justify-center px-6 text-center text-[14px] text-ink-muted">
              ยังไม่ได้เปิดตัวอย่าง
            </p>
          ) : null}
          {state.status === "loading" ? (
            <div className="flex h-full min-h-[18rem] flex-col items-center justify-center gap-2 text-[14px] text-ink-muted">
              <Spinner />
              กำลังสร้างตัวอย่าง…
            </div>
          ) : null}
          {state.status === "error" ? (
            <div className="p-4">
              <ErrorNotice view={state.view} />
            </div>
          ) : null}
          {state.status === "ready" ? (
            <iframe
              key={state.url}
              src={`${state.url}#page=1`}
              title={state.label}
              className="h-[clamp(20rem,calc(100vh_-_16rem),46rem)] w-full bg-white"
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- ตรวจไฟล์ที่เลือก

interface Inspection {
  filename: string;
  placeholders: string[];
  deprecatedPlaceholders: string[];
  normalised: { optionParagraphs: number; highlights: number };
  warning?: string;
}

type InspectState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "ok"; data: Inspection }
  | { status: "error"; view: AdminErrorView };

/** สถานะของการเลือกไฟล์: ไฟล์ ผลตรวจ ติ๊ก "ใช้ทันที" และตัวอย่าง — ทั้งสอง modal ใช้ชุดเดียวกัน */
export function useTemplateUpload(scope: LegalScope | null) {
  const [file, setFileState] = useState<File | null>(null);
  const [inspect, setInspect] = useState<InspectState>({ status: "idle" });
  const [apply, setApply] = useState(true);
  const preview = usePdfPreview();
  const run = useRef(0);

  const formOf = useCallback(
    (f: File, extra: Record<string, string> = {}) => {
      const form = new FormData();
      form.append("file", f);
      if (scope) form.append("scope", scope);
      for (const [k, v] of Object.entries(extra)) form.append(k, v);
      return form;
    },
    [scope],
  );

  const setFile = useCallback(
    async (f: File | null) => {
      const mine = ++run.current;
      setFileState(f);
      preview.clear();
      if (!f || !scope) {
        setInspect({ status: "idle" });
        return;
      }
      setInspect({ status: "checking" });
      try {
        const data = await api.upload<Inspection>("/api/admin/legal-documents/inspect", formOf(f));
        if (mine === run.current) setInspect({ status: "ok", data });
      } catch (err) {
        if (mine === run.current) setInspect({ status: "error", view: adminErrorView(err) });
      }
    },
    // preview.clear มี identity คงที่
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scope, formOf],
  );

  const showPreview = (mode: "raw" | "rendered") => {
    if (!file) return;
    void preview.show(
      mode === "raw" ? "ตัวอย่างก่อน render — ตามที่พิมพ์ในไฟล์" : "ตัวอย่างหลัง render — เติมข้อมูลตัวอย่างแล้ว",
      mode === "rendered",
      () => api.uploadBlob("/api/admin/legal-documents/preview", formOf(file, { mode })),
    );
  };

  const reset = () => {
    run.current += 1;
    setFileState(null);
    setInspect({ status: "idle" });
    setApply(true);
    preview.clear();
  };

  return { file, setFile, inspect, apply, setApply, preview, showPreview, reset, formOf };
}

export type TemplateUpload = ReturnType<typeof useTemplateUpload>;

/** เลือกไฟล์ + ผลตรวจ + ปุ่มดูตัวอย่าง + ติ๊ก "ใช้ทันที" */
export function TemplateUploadFields({
  upload,
  applyHint,
}: {
  upload: TemplateUpload;
  applyHint?: ReactNode;
}) {
  const { file, inspect } = upload;
  const ticks = inspect.status === "ok" ? inspect.data.placeholders.filter((p) => p.startsWith("tick.")).length : 0;
  const names = inspect.status === "ok" ? inspect.data.placeholders.filter((p) => !p.startsWith("tick.")) : [];
  const ready = inspect.status === "ok";

  return (
    <div className="space-y-4">
      {/* ปุ่มของ <input type="file"> เขียนเป็นภาษาของเบราว์เซอร์ ("Choose File") — ซ่อนไว้แล้ววาดปุ่มภาษาไทยแทน */}
      <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-line bg-canvas px-4 py-3 hover:border-navy-300">
        <input
          type="file"
          accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          onChange={(e) => void upload.setFile(e.target.files?.[0] ?? null)}
          className="sr-only"
        />
        <span className="shrink-0 rounded-full bg-navy-800 px-4 py-1.5 text-[14px] font-medium text-white">เลือกไฟล์</span>
        <span className="min-w-0 truncate text-[14px] text-ink-muted">
          {file ? `${file.name} · ${(file.size / MB).toFixed(1)} MB` : "ยังไม่ได้เลือกไฟล์ .docx (ไม่เกิน 20 MB)"}
        </span>
      </label>

      {inspect.status === "checking" ? (
        // div ไม่ใช่ p — <Spinner> เรนเดอร์เป็น <div> และ HTML ไม่ให้ div อยู่ใน p (hydration error)
        <div className="flex items-center gap-2 text-[13.5px] text-ink-muted">
          <Spinner /> กำลังตรวจไฟล์…
        </div>
      ) : null}
      {inspect.status === "error" ? <ErrorNotice view={inspect.view} /> : null}
      {inspect.status === "ok" ? (
        <div className="space-y-2 rounded-xl bg-canvas px-4 py-3 text-[13.5px]">
          <p className="font-medium text-success">ตรวจไฟล์แล้ว — ตัวแปรถูกต้องทั้งหมด</p>
          <WarningList warnings={inspect.data.warning ? [inspect.data.warning] : []} />
          <div>
            <p className="text-ink-muted">
              ตัวแปรที่พบ ({inspect.data.placeholders.length}){ticks > 0 ? ` — ช่องติ๊ก ${ticks} ช่อง` : ""}
            </p>
            <p className="mt-1 flex flex-wrap gap-1">
              {inspect.data.placeholders.length === 0 ? (
                <span className="text-ink-subtle">ไม่มี</span>
              ) : (
                names.map((p) => <Tag key={p}>{p}</Tag>)
              )}
            </p>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="secondary" disabled={!ready} onClick={() => upload.showPreview("raw")}>
          ดูตัวอย่างก่อน render
        </Button>
        <Button type="button" size="sm" variant="secondary" disabled={!ready} onClick={() => upload.showPreview("rendered")}>
          ดูตัวอย่างหลัง render
        </Button>
      </div>

      <label className="flex items-start gap-2.5 rounded-xl bg-canvas px-4 py-3 text-[14px]">
        <input type="checkbox" className="mt-1" checked={upload.apply} onChange={(e) => upload.setApply(e.target.checked)} />
        <span>
          <span className="font-medium text-ink">ใช้ทันที</span>
          {applyHint ? <span className="block text-[13px] text-ink-muted">{applyHint}</span> : null}
        </span>
      </label>
    </div>
  );
}

// ---------------------------------------------------------------- เวอร์ชันใหม่ของเอกสารที่มีอยู่

interface VersionResult {
  versionNumber: number;
  status: "PUBLISHED" | "DRAFT";
  message: string;
  placeholders: string[];
  warning?: string;
}

/** อัปโหลดเวอร์ชันใหม่ของเอกสารที่มีอยู่แล้ว — ใช้ทั้งจากหน้ารายการและหน้าแก้ไข */
export function UploadVersionModal({
  doc,
  onClose,
  onDone,
}: {
  doc: LegalDocument | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const upload = useTemplateUpload(doc?.scope ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AdminErrorView | null>(null);
  const [result, setResult] = useState<VersionResult | null>(null);

  const close = () => {
    upload.reset();
    setError(null);
    setResult(null);
    onClose();
  };

  const confirm = async () => {
    if (!doc || !upload.file) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.upload<VersionResult>(
        `/api/admin/legal-documents/${doc.code}/versions`,
        upload.formOf(upload.file, { apply: String(upload.apply) }),
      );
      setResult(res);
      onDone();
    } catch (err) {
      setError(adminErrorView(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={doc !== null}
      onClose={busy ? () => undefined : close}
      title={doc ? `อัปโหลดเวอร์ชันใหม่ — ${doc.name}` : ""}
      size="xl"
    >
      {result ? (
        <div className="space-y-4">
          <p className="text-[15px] text-ink">
            {result.status === "PUBLISHED" ? (
              <>
                เผยแพร่เป็น <strong>Version {result.versionNumber}</strong> แล้ว
              </>
            ) : (
              <>
                เก็บเป็น <strong>ฉบับร่าง Version {result.versionNumber}</strong> แล้ว
              </>
            )}
          </p>
          <WarningList warnings={result.warning ? [result.warning] : []} />
          <div className="flex justify-end">
            <Button onClick={close}>เสร็จสิ้น</Button>
          </div>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
          <div className="space-y-4">
            <TemplateUploadFields
              upload={upload}
            />
            {error ? <ErrorNotice view={error} /> : null}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={close} disabled={busy}>
                ยกเลิก
              </Button>
              <Button onClick={() => void confirm()} loading={busy} disabled={upload.inspect.status !== "ok"}>
                {upload.apply ? "ยืนยันและเผยแพร่" : "ยืนยันและเก็บเป็นฉบับร่าง"}
              </Button>
            </div>
          </div>
          <PdfPane preview={upload.preview} />
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------- เอกสารใหม่

interface CreateResult {
  document: { code: string; isActive: boolean };
  message: string;
  warning?: string;
}

/**
 * ฟอร์มเพิ่มเอกสารใหม่ในหมวดใดหมวดหนึ่ง — หน้า `/console/legal-documents/new/:scope` (เดิมเป็น modal ปรับตามคำสั่งของ BDI 2026-10-10)
 * ลำดับต่อท้ายเสมอ ต้องแนบไฟล์ฉบับแรกมาด้วย สำเร็จแล้วไปที่หน้าแก้ไขของเอกสารใหม่
 */
export function AddDocumentForm({
  scope,
  onDone,
}: {
  scope: LegalScope;
  onDone: (result: CreateResult) => void;
}) {
  const upload = useTemplateUpload(scope);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [shortname, setShortname] = useState("");
  const [notice, setNotice] = useState("");
  const [required, setRequired] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AdminErrorView | null>(null);

  const filled = code.trim() !== "" && name.trim() !== "" && upload.inspect.status === "ok";

  const confirm = async () => {
    if (!upload.file) return;
    setBusy(true);
    setError(null);
    try {
      const form = upload.formOf(upload.file, {
        documentCode: code.trim(),
        nameTh: name.trim(),
        isRequired: String(required),
        apply: String(upload.apply),
      });
      if (shortname.trim()) form.append("shortname", shortname.trim());
      if (notice.trim()) form.append("legalNotice", notice.trim());
      const res = await api.upload<CreateResult>("/api/admin/legal-documents", form);
      onDone(res);
    } catch (err) {
      setError(adminErrorView(err));
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,28rem)_minmax(0,1fr)]">
      <form
        className="space-y-4 rounded-2xl bg-white p-5 shadow-card ring-1 ring-line"
        onSubmit={(e) => {
          e.preventDefault();
          if (filled) void confirm();
        }}
      >
        <TextField
          label="รหัสเอกสาร"
          required
          value={code}
          maxLength={16}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          hint="เช่น B1 — แก้ไม่ได้หลังสร้าง"
          error={error?.fields.documentCode}
        />
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
          hint="เว้นว่างเพื่อใช้ชื่อเต็ม"
          error={error?.fields.shortname}
        />
        <TextAreaField
          label="ข้อความเตือนใต้เอกสาร (legal_notice)"
          rows={3}
          value={notice}
          onChange={(e) => setNotice(e.target.value)}
          
          error={error?.fields.legalNotice}
        />
        <label className="flex items-start gap-2.5 rounded-xl bg-canvas px-4 py-3 text-[14px]">
          <input type="checkbox" className="mt-1" checked={required} onChange={(e) => setRequired(e.target.checked)} />
          <span>
            <span className="font-medium text-ink">เอกสารบังคับ (is_required)</span>
            <span className="block text-[13px] text-ink-muted">เอาออกให้ผู้ลงนามข้ามได้</span>
          </span>
        </label>
        <TemplateUploadFields
          upload={upload}
        />
        {error ? <ErrorNotice view={error} hideFields={["documentCode", "nameTh", "shortname", "legalNotice"]} /> : null}
        <div className="flex justify-end">
          <Button type="submit" loading={busy} disabled={!filled}>
            ยืนยันสร้างเอกสาร
          </Button>
        </div>
      </form>
      <PdfPane preview={upload.preview} className="lg:sticky lg:top-28 lg:self-start" />
    </div>
  );
}
