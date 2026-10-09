"use client";

import clsx from "clsx";
import { useState } from "react";

import { ActionDialog } from "@/components/console/ActionDialog";
import { Badge, ErrorNotice, PageHeader, Panel, Tag } from "@/components/console/ui";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { Spinner } from "@/components/ui/Spinner";
import { useToast } from "@/components/ui/Toast";
import { adminErrorView } from "@/lib/admin-errors";
import { api } from "@/lib/api";
import { formatThaiDate } from "@/lib/status";
import { useAdminData } from "@/lib/use-admin";

type Section = "REGULATION" | "PRIMARY" | "ANNEX";

interface PublicDocumentFile {
  id: string;
  current: boolean;
  fileName: string;
  sizeBytes: number;
  uploadedAt: string;
  uploadedBy: string | null;
}

interface PublicDocument {
  id: string;
  section: Section;
  code: string | null;
  title: string;
  versionLabel: string | null;
  href: string | null;
  fileName: string | null;
  updatedAt: string;
  isActive: boolean;
  displayOrder: number;
  usesStaticFile: boolean;
  files: PublicDocumentFile[];
}

/** หัวข้อเดียวกับบนหน้าแรก (components/landing/LandingPage.tsx `Legal`) เรียงตามที่ผู้เยี่ยมชมเห็น */
const SECTIONS: Array<{ key: Section; title: string; note: string; hasCode: boolean }> = [
  { key: "REGULATION", title: "กฎหมายที่เกี่ยวข้อง", note: "ระเบียบ ประกาศ และกฎหมายที่หน่วยงานควรอ่าน", hasCode: false },
  { key: "PRIMARY", title: "ข้อตกลงหลัก", note: "ข้อตกลงที่หน่วยงานลงนามเมื่อเข้าร่วม (A0)", hasCode: true },
  { key: "ANNEX", title: "เอกสารภาคผนวก", note: "แนบท้ายข้อตกลงหลัก (A1–A3)", hasCode: true },
];

type Dialog =
  | { kind: "upload"; doc: PublicDocument }
  | { kind: "edit"; doc: PublicDocument }
  | { kind: "add"; section: Section }
  | null;

const MB = 1024 * 1024;

/**
 * เอกสารดาวน์โหลดบนหน้าแรก — หัวข้อ "กฎหมายและเอกสารที่เกี่ยวข้อง" ที่คนนอกเห็นก่อนล็อกอิน (การ์ด Admin Console 2026-10-09)
 *
 * เดิมเปลี่ยนฉบับต้องแก้โค้ดแล้ว deploy ตอนนี้อัปโหลด PDF ฉบับใหม่ที่นี่แล้วหน้าแรกเปลี่ยนภายในครึ่งนาที (cache ของ API)
 * ฉบับเก่าเก็บไว้ในประวัติของแต่ละรายการ ดาวน์โหลดย้อนดูได้ แต่ไม่มีปุ่มนำกลับมา — ถ้าต้องการ อัปโหลดไฟล์นั้นใหม่
 * ไม่มีปุ่มลบเช่นกัน ซ่อนแทน ไฟล์ที่เคยเผยแพร่ต่อสาธารณะต้องตอบได้ภายหลังว่าเคยเป็นฉบับไหน
 *
 * **ไม่ใช่เอกสารข้อตกลงที่ใช้ลงนาม** (หน้า "เอกสารข้อตกลง") — ที่นั่นคือ template .docx ที่ระบบเติมค่าให้แต่ละหน่วยงาน
 * ที่นี่คือ PDF ฉบับอ่านตามที่ BDI ส่งมา สองชุดนี้ไม่ได้ผูกเวอร์ชันกัน ออกฉบับใหม่ต้องอัปเดตทั้งสองที่
 */
export default function ConsolePublicDocumentsPage() {
  const { data, error, loading, reload } = useAdminData<{ documents: PublicDocument[] }>("/api/admin/public-documents");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [openHistory, setOpenHistory] = useState<string | null>(null);
  const { show } = useToast();

  if (loading && !data) return <Spinner />;
  if (error && !data) return <ErrorNotice view={adminErrorView(error)} />;
  if (!data) return null;

  const patch = async (doc: PublicDocument, body: Record<string, unknown>, message: string) => {
    try {
      await api.patch(`/api/admin/public-documents/${doc.id}`, body);
      show({ tone: "success", title: message });
      reload();
    } catch (err) {
      show({ tone: "error", title: "บันทึกไม่สำเร็จ", detail: adminErrorView(err).message });
    }
  };

  /** สลับลำดับกับรายการข้างเคียงในหัวข้อเดียวกัน — สองคำสั่ง PATCH ลำดับที่ซ้ำกันชั่วครู่ไม่มีผลกับใคร */
  const move = async (list: PublicDocument[], index: number, dir: -1 | 1) => {
    const a = list[index];
    const b = list[index + dir];
    if (!a || !b) return;
    try {
      await api.patch(`/api/admin/public-documents/${a.id}`, { displayOrder: b.displayOrder });
      await api.patch(`/api/admin/public-documents/${b.id}`, { displayOrder: a.displayOrder });
      reload();
    } catch (err) {
      show({ tone: "error", title: "เปลี่ยนลำดับไม่สำเร็จ", detail: adminErrorView(err).message });
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow="ตั้งค่าระบบ"
        title="เอกสารดาวน์โหลด"
        description="ไฟล์ PDF ที่ผู้เยี่ยมชมดาวน์โหลดได้จากหัวข้อ “กฎหมายและเอกสารที่เกี่ยวข้อง” บนหน้าแรก — อัปโหลดฉบับใหม่แล้วหน้าแรกเปลี่ยนภายในครึ่งนาที ไม่ต้อง deploy"
        actions={
          <a
            href="/#legal"
            target="_blank"
            rel="noopener"
            className="inline-flex h-9 items-center rounded-full border border-line bg-white px-4 text-sm font-medium text-navy-800 hover:bg-navy-50"
          >
            ดูหน้าแรก ↗
          </a>
        }
      />

      <div className="space-y-6">
        {SECTIONS.map((section) => {
          const list = data.documents.filter((d) => d.section === section.key);
          return (
            <Panel
              key={section.key}
              title={section.title}
              description={section.note}
              actions={
                <Button size="sm" variant="secondary" onClick={() => setDialog({ kind: "add", section: section.key })}>
                  เพิ่มรายการ
                </Button>
              }
              flush
            >
              {list.length === 0 ? (
                <p className="px-5 py-8 text-center text-[14px] text-ink-muted">ยังไม่มีเอกสารในหัวข้อนี้</p>
              ) : (
                <ul className="divide-y divide-line">
                  {list.map((doc, i) => (
                    <li key={doc.id} className={clsx("px-5 py-4", !doc.isActive && "bg-canvas/70")}>
                      <div className="flex flex-wrap items-start gap-3">
                        <div className="flex shrink-0 flex-col">
                          <button
                            type="button"
                            aria-label="เลื่อนขึ้น"
                            disabled={i === 0}
                            onClick={() => void move(list, i, -1)}
                            className="rounded px-1.5 text-ink-muted hover:bg-navy-50 disabled:opacity-25"
                          >
                            ▲
                          </button>
                          <button
                            type="button"
                            aria-label="เลื่อนลง"
                            disabled={i === list.length - 1}
                            onClick={() => void move(list, i, 1)}
                            className="rounded px-1.5 text-ink-muted hover:bg-navy-50 disabled:opacity-25"
                          >
                            ▼
                          </button>
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="flex flex-wrap items-center gap-2 font-medium text-ink">
                            {doc.code ? <Tag>{doc.code}</Tag> : null}
                            {doc.title}
                            {!doc.isActive ? (
                              <Badge meta={{ label: "ซ่อนจากหน้าแรก", className: "bg-navy-50 text-ink-muted" }} />
                            ) : null}
                          </p>
                          <p className="mt-1 text-[13.5px] text-ink-muted">
                            {doc.versionLabel ? <span className="text-ink">{doc.versionLabel} · </span> : null}
                            {doc.href ? (
                              <a
                                href={doc.href.startsWith("/api/") ? api.fileUrl(doc.href) : encodeURI(doc.href)}
                                target="_blank"
                                rel="noopener"
                                className="text-navy-700 underline"
                              >
                                {doc.fileName}
                              </a>
                            ) : (
                              "ยังไม่มีไฟล์"
                            )}
                            {doc.usesStaticFile ? " · ไฟล์ตั้งต้นที่มากับระบบ" : ` · อัปโหลด ${formatThaiDate(doc.updatedAt)}`}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-1">
                          <Button size="sm" onClick={() => setDialog({ kind: "upload", doc })}>
                            อัปโหลดฉบับใหม่
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: "edit", doc })}>
                            แก้ไข
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              void patch(
                                doc,
                                { isActive: !doc.isActive },
                                doc.isActive ? "ซ่อนจากหน้าแรกแล้ว" : "แสดงบนหน้าแรกแล้ว",
                              )
                            }
                          >
                            {doc.isActive ? "ซ่อน" : "แสดง"}
                          </Button>
                        </div>
                      </div>
                      {doc.files.length > 0 ? (
                        <div className="mt-2 pl-9">
                          <button
                            type="button"
                            onClick={() => setOpenHistory(openHistory === doc.id ? null : doc.id)}
                            className="text-[13px] font-medium text-navy-700 hover:underline"
                          >
                            {openHistory === doc.id ? "ซ่อนประวัติ" : `ประวัติไฟล์ (${doc.files.length})`}
                          </button>
                          {openHistory === doc.id ? (
                            <ul className="mt-2 space-y-1 rounded-xl bg-canvas px-3 py-2 text-[13px]">
                              {doc.files.map((f) => (
                                <li key={f.id} className="flex flex-wrap items-center justify-between gap-2">
                                  <a
                                    href={api.fileUrl(`/api/admin/public-documents/${doc.id}/files/${f.id}`)}
                                    className="min-w-0 truncate text-navy-700 underline"
                                  >
                                    {f.fileName}
                                  </a>
                                  <span className="text-ink-muted">
                                    {f.current ? "ใช้อยู่ · " : ""}
                                    {(f.sizeBytes / MB).toFixed(1)} MB · {formatThaiDate(f.uploadedAt)}
                                    {f.uploadedBy ? ` · ${f.uploadedBy}` : ""}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          ) : null}
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          );
        })}
      </div>

      <UploadDialog
        doc={dialog?.kind === "upload" ? dialog.doc : null}
        onClose={() => setDialog(null)}
        onDone={() => {
          show({ tone: "success", title: "เผยแพร่ฉบับใหม่แล้ว", detail: "หน้าแรกจะแสดงไฟล์ใหม่ภายในครึ่งนาที" });
          reload();
        }}
      />
      <EditDialog
        doc={dialog?.kind === "edit" ? dialog.doc : null}
        onClose={() => setDialog(null)}
        onDone={() => {
          show({ tone: "success", title: "บันทึกแล้ว" });
          reload();
        }}
      />
      <AddDialog
        section={dialog?.kind === "add" ? dialog.section : null}
        onClose={() => setDialog(null)}
        onDone={() => {
          show({ tone: "success", title: "เพิ่มเอกสารแล้ว" });
          reload();
        }}
      />
    </div>
  );
}

/** ช่องเลือก PDF ภาษาไทย — แบบเดียวกับหน้าเอกสารข้อตกลง (ปุ่มของ `<input type="file">` เป็นภาษาของเบราว์เซอร์) */
function PdfPicker({ file, onChange }: { file: File | null; onChange: (f: File | null) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-line bg-canvas px-4 py-3 hover:border-navy-300">
      <input
        type="file"
        accept="application/pdf,.pdf"
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
        className="sr-only"
      />
      <span className="shrink-0 rounded-full bg-navy-800 px-4 py-1.5 text-[14px] font-medium text-white">เลือกไฟล์</span>
      <span className="min-w-0 truncate text-[14px] text-ink-muted">
        {file ? `${file.name} · ${(file.size / MB).toFixed(1)} MB` : "ยังไม่ได้เลือกไฟล์ PDF"}
      </span>
    </label>
  );
}

function UploadDialog({ doc, onClose, onDone }: { doc: PublicDocument | null; onClose: () => void; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [version, setVersion] = useState("");
  const [last, setLast] = useState<string | null>(null);
  // เปิดรายการใหม่ = เริ่มจากฉบับปัจจุบันของรายการนั้น ไฟล์ว่าง
  if (doc && doc.id !== last) {
    setLast(doc.id);
    setFile(null);
    setVersion(doc.versionLabel ?? "");
  }
  if (!doc && last !== null) setLast(null);

  return (
    <ActionDialog
      open={doc !== null}
      onClose={onClose}
      title={doc ? `อัปโหลดฉบับใหม่ — ${doc.code ?? doc.title}` : ""}
      description="ไฟล์ PDF ไม่เกิน 30 MB — ผู้เยี่ยมชมได้ไฟล์ชื่อเดิมตามที่อัปโหลดทุกตัวอักษร ฉบับเดิมเก็บไว้ในประวัติ"
      confirmLabel="เผยแพร่ฉบับใหม่"
      reason={false}
      canSubmit={file !== null}
      onConfirm={async () => {
        if (!doc || !file) return;
        const form = new FormData();
        form.append("file", file);
        form.append("versionLabel", version.trim());
        await api.upload(`/api/admin/public-documents/${doc.id}/file`, form);
        onDone();
      }}
    >
      <PdfPicker file={file} onChange={setFile} />
      <TextField
        label="ฉบับ (แสดงใต้ชื่อบนหน้าแรก)"
        value={version}
        maxLength={100}
        onChange={(e) => setVersion(e.target.value)}
        placeholder="เช่น ฉบับที่ 2 · 9 ต.ค. 2569"
        hint="แก้ให้ตรงกับไฟล์ใหม่ เว้นว่างถ้าไม่ต้องการแสดง"
      />
    </ActionDialog>
  );
}

function EditDialog({ doc, onClose, onDone }: { doc: PublicDocument | null; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({ title: "", versionLabel: "", code: "" });
  const [last, setLast] = useState<string | null>(null);
  if (doc && doc.id !== last) {
    setLast(doc.id);
    setForm({ title: doc.title, versionLabel: doc.versionLabel ?? "", code: doc.code ?? "" });
  }
  if (!doc && last !== null) setLast(null);
  const hasCode = SECTIONS.find((s) => s.key === doc?.section)?.hasCode ?? false;

  return (
    <ActionDialog
      open={doc !== null}
      onClose={onClose}
      title="แก้ไขรายการ"
      description="เปลี่ยนชื่อหรือฉบับที่แสดงบนหน้าแรก — ไฟล์ไม่เปลี่ยน"
      confirmLabel="บันทึก"
      reason={false}
      canSubmit={form.title.trim().length > 0}
      onConfirm={async () => {
        if (!doc) return;
        await api.patch(`/api/admin/public-documents/${doc.id}`, {
          title: form.title.trim(),
          versionLabel: form.versionLabel.trim(),
          ...(hasCode ? { code: form.code.trim() } : {}),
        });
        onDone();
      }}
    >
      {hasCode ? (
        <TextField label="รหัส" value={form.code} maxLength={16} onChange={(e) => setForm({ ...form, code: e.target.value })} />
      ) : null}
      <TextField
        label="ชื่อเอกสาร"
        required
        value={form.title}
        maxLength={500}
        onChange={(e) => setForm({ ...form, title: e.target.value })}
      />
      <TextField
        label="ฉบับ"
        value={form.versionLabel}
        maxLength={100}
        onChange={(e) => setForm({ ...form, versionLabel: e.target.value })}
        placeholder="เช่น ฉบับที่ 2 · 9 ต.ค. 2569"
      />
    </ActionDialog>
  );
}

function AddDialog({ section, onClose, onDone }: { section: Section | null; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({ title: "", versionLabel: "", code: "" });
  const [file, setFile] = useState<File | null>(null);
  const meta = SECTIONS.find((s) => s.key === section);

  return (
    <ActionDialog
      open={section !== null}
      onClose={() => {
        setForm({ title: "", versionLabel: "", code: "" });
        setFile(null);
        onClose();
      }}
      title={meta ? `เพิ่มเอกสารใน “${meta.title}”` : ""}
      description="รายการใหม่ต่อท้ายหัวข้อและแสดงบนหน้าแรกทันที"
      confirmLabel="เพิ่มเอกสาร"
      reason={false}
      canSubmit={form.title.trim().length > 0 && file !== null}
      onConfirm={async () => {
        if (!section || !file) return;
        const body = new FormData();
        body.append("section", section);
        body.append("title", form.title.trim());
        body.append("versionLabel", form.versionLabel.trim());
        if (meta?.hasCode) body.append("code", form.code.trim());
        body.append("file", file);
        await api.upload("/api/admin/public-documents", body);
        setForm({ title: "", versionLabel: "", code: "" });
        setFile(null);
        onDone();
      }}
    >
      {meta?.hasCode ? (
        <TextField
          label="รหัส"
          value={form.code}
          maxLength={16}
          onChange={(e) => setForm({ ...form, code: e.target.value })}
          placeholder="เช่น A4"
        />
      ) : null}
      <TextField
        label="ชื่อเอกสาร"
        required
        value={form.title}
        maxLength={500}
        onChange={(e) => setForm({ ...form, title: e.target.value })}
      />
      <TextField
        label="ฉบับ"
        value={form.versionLabel}
        maxLength={100}
        onChange={(e) => setForm({ ...form, versionLabel: e.target.value })}
        placeholder="เช่น ฉบับที่ 1 · 9 ต.ค. 2569"
      />
      <PdfPicker file={file} onChange={setFile} />
    </ActionDialog>
  );
}
