"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { ActionDialog } from "@/components/console/ActionDialog";
import { ErrorNotice, Panel, Tag } from "@/components/console/ui";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";
import { useToast } from "@/components/ui/Toast";
import { adminErrorView, type AdminErrorView } from "@/lib/admin-errors";
import { api } from "@/lib/api";
import { formatThaiDate } from "@/lib/status";
import { useAdminData } from "@/lib/use-admin";

/** หนึ่งรูปตามที่ `GET /api/admin/email-images` ตอบ — ดู `listImages()` ใน backend/src/lib/email/images.ts */
interface EmailImage {
  code: string;
  name: string;
  altText: string;
  displayWidth: number;
  contentType: string;
  sizeBytes: number;
  widthPx: number;
  heightPx: number;
  isDefault: boolean;
  isLogo: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
  usedBy: Array<{ key: string; label: string; status: "PUBLISHED" | "DRAFT" }>;
}
interface Limits {
  maxBytes: number;
  displayWidthMin: number;
  displayWidthMax: number;
}

const BASE = "/api/admin/email-images";

/**
 * แท็บ "รูปภาพ" ของหน้า ตั้งค่า › เทมเพลตอีเมล — ที่เดียวที่เปลี่ยนรูปที่อีเมลใช้ รวมโลโก้ (การ์ด "[New Feature] Admin Email Template Edit",
 * 2026-11-08) เคยเป็นเมนูของตัวเอง ย้ายมาเป็นแท็บเพราะรูปมีไว้ให้เทมเพลตอีเมลใช้เท่านั้น (feedback ระหว่างทดสอบ)
 *
 * เทมเพลตอ้างรูปด้วย `{{image.<รหัส>}}` (แทรกได้จาก popup ในหน้าแก้เทมเพลต) เปลี่ยนไฟล์ที่นี่แล้วอีเมลทุกฉบับที่ใช้รูปนั้นได้ไฟล์ใหม่ทันที
 * โลโก้ลบไม่ได้ แต่กลับเป็นรูปตั้งต้นได้ รูปที่เทมเพลตยังใช้อยู่ลบไม่ได้ (API ตอบ 409 พร้อมรายชื่อเทมเพลต)
 */
export function EmailImagesPanel() {
  const { data, error, loading, reload } = useAdminData<{ images: EmailImage[]; limits: Limits }>(BASE);
  const { show } = useToast();
  const [editing, setEditing] = useState<EmailImage | "new" | null>(null);
  const [deleting, setDeleting] = useState<EmailImage | null>(null);
  const [resetting, setResetting] = useState(false);

  if (loading && !data) return <Spinner />;
  if (error && !data) return <ErrorNotice view={adminErrorView(error)} />;
  if (!data) return null;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-3xl text-[14px] text-ink-muted">
          รูปทุกรูปที่เทมเพลตอีเมลใช้ รวมโลโก้ — เปลี่ยนไฟล์ที่นี่แล้วอีเมลทุกฉบับที่ใช้รูปนั้นได้ไฟล์ใหม่ทันที ใส่รูปในเทมเพลตด้วย{" "}
          {"{{image.<รหัส>}}"} รูปแนบไปกับอีเมล ผู้รับเห็นได้โดยไม่ต้องกดอนุญาตให้โหลดรูป
        </p>
        <Button onClick={() => setEditing("new")}>เพิ่มรูป</Button>
      </div>

      <div className="space-y-6">
        {data.images.map((img) => (
          <Panel
            key={img.code}
            title={img.name}
            description={img.isLogo ? "โลโก้ในหัวจดหมายของทุกอีเมล — ลบไม่ได้" : undefined}
            actions={
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={() => setEditing(img)}>
                  แก้ไข / เปลี่ยนไฟล์
                </Button>
                {img.isLogo ? (
                  img.isDefault ? null : (
                    <Button size="sm" variant="ghost" onClick={() => setResetting(true)}>
                      ใช้รูปตั้งต้น
                    </Button>
                  )
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => setDeleting(img)}>
                    ลบ
                  </Button>
                )}
              </div>
            }
          >
            {/*
              รูปย่ออยู่บน รายละเอียดอยู่ล่าง — ไม่วางข้างกัน: การ์ดแคบ (สองคอลัมน์บนจอ ~1400px) เคยบีบคอลัมน์ข้อความจนเหลือคำละบรรทัด
              ขนาดรูปคุมด้วย style ตรง ๆ รูปจริงกว้าง 400px ขึ้นไป ต้องไม่ล้นกรอบไม่ว่า CSS จะมาช้าแค่ไหน (feedback 2026-11-08 13:58)
            */}
            <div className="space-y-4">
              <div
                className="flex items-center justify-center rounded-xl bg-[#F6F7FB] ring-1 ring-line"
                style={{ height: "10rem", overflow: "hidden" }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- รูปมาจาก API ของผู้ดูแลพร้อม cookie ไม่ใช่ไฟล์ static */}
                <img
                  src={api.fileUrl(`${BASE}/${img.code}/file?v=${encodeURIComponent(img.updatedAt ?? "default")}`)}
                  alt={img.altText}
                  style={{ maxHeight: "8.5rem", maxWidth: "90%", width: "auto", height: "auto", objectFit: "contain" }}
                />
              </div>
              <dl
                className="text-[13.5px]"
                style={{ display: "grid", gridTemplateColumns: "max-content minmax(0, 1fr)", columnGap: "1rem", rowGap: "0.5rem" }}
              >
                <dt className="text-ink-subtle">ใช้ในเทมเพลต</dt>
                <dd className="min-w-0">
                  <Tag>{`{{image.${img.code}}}`}</Tag>
                  {img.isLogo ? <span className="ml-1 text-ink-subtle">หรือ {"{{block.logo}}"}</span> : null}
                </dd>
                <dt className="text-ink-subtle">ขนาดที่แสดง</dt>
                <dd className="text-ink">กว้าง {img.displayWidth} px</dd>
                <dt className="text-ink-subtle">ไฟล์</dt>
                <dd className="text-ink">
                  {img.contentType === "image/png" ? "PNG" : "JPG"} · {img.widthPx}×{img.heightPx} px ·{" "}
                  {(img.sizeBytes / 1024).toFixed(0)} KB
                </dd>
                <dt className="text-ink-subtle">คำอธิบายรูป</dt>
                <dd className="min-w-0 break-words text-ink">{img.altText}</dd>
                <dt className="text-ink-subtle">อีเมลที่ใช้รูปนี้</dt>
                <dd className="min-w-0">
                  {img.usedBy.length ? (
                    <ul className="space-y-0.5">
                      {img.usedBy.map((u) => (
                        <li key={`${u.key}:${u.status}`}>
                          <Link
                            href={`/console/settings/email-templates/${u.key}`}
                            className="text-navy-700 underline-offset-2 hover:underline"
                          >
                            {u.label}
                          </Link>
                          {u.status === "DRAFT" ? <span className="text-ink-subtle"> (ฉบับร่าง)</span> : null}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="text-ink-subtle">ยังไม่มีเทมเพลตใช้</span>
                  )}
                </dd>
              </dl>
              <p className="text-[12.5px] text-ink-subtle">
                {img.isDefault
                  ? "รูปตั้งต้นของระบบ"
                  : `แก้ไขล่าสุด ${img.updatedAt ? formatThaiDate(img.updatedAt) : ""}${img.updatedBy ? ` โดย ${img.updatedBy}` : ""}`}
              </p>
            </div>
          </Panel>
        ))}
      </div>

      <ImageDialog
        target={editing}
        limits={data.limits}
        onClose={() => setEditing(null)}
        onSaved={(message) => {
          show({ tone: "success", title: message });
          setEditing(null);
          reload();
        }}
      />

      <ActionDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={`ลบรูป "${deleting?.name ?? ""}"`}
        description={`ลบ {{image.${deleting?.code ?? ""}}} ออกจากระบบ — ลบได้เฉพาะรูปที่ไม่มีเทมเพลตใช้ (ทั้งฉบับที่ใช้งานอยู่และฉบับร่าง)`}
        confirmLabel="ลบรูป"
        tone="danger"
        onConfirm={async (reason) => {
          const res = await api.remove<{ message: string }>(`${BASE}/${deleting!.code}`, { reason });
          show({ tone: "success", title: res.message });
          reload();
        }}
      />

      <ActionDialog
        open={resetting}
        onClose={() => setResetting(false)}
        title="โลโก้กลับเป็นรูปตั้งต้น"
        description="อีเมลทุกฉบับจะใช้โลโก้ตั้งต้นของระบบอีกครั้ง ไฟล์โลโก้ที่อัปโหลดไว้จะถูกลบ"
        confirmLabel="ใช้รูปตั้งต้น"
        onConfirm={async (reason) => {
          const res = await api.post<{ message: string }>(`${BASE}/logo/reset`, { reason });
          show({ tone: "success", title: res.message });
          reload();
        }}
      />
    </div>
  );
}

/** เพิ่มรูป หรือแก้รูปเดิม (ชื่อ คำอธิบาย ความกว้าง และ/หรือไฟล์) — รหัสรูปตั้งได้ตอนเพิ่มเท่านั้น เพราะเทมเพลตอ้างด้วยรหัสนี้ */
function ImageDialog({
  target,
  limits,
  onClose,
  onSaved,
}: {
  target: EmailImage | "new" | null;
  limits: Limits;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const isNew = target === "new";
  const existing = target && target !== "new" ? target : null;
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [altText, setAltText] = useState("");
  const [width, setWidth] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AdminErrorView | null>(null);

  useEffect(() => {
    if (!target) return;
    setCode("");
    setName(existing?.name ?? "");
    setAltText(existing?.altText ?? "");
    setWidth(String(existing?.displayWidth ?? 200));
    setFile(null);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const tooBig = file !== null && file.size > limits.maxBytes;
  const submit = async () => {
    setBusy(true);
    setError(null);
    const form = new FormData();
    if (isNew) form.append("code", code.trim());
    form.append("name", name);
    form.append("altText", altText);
    form.append("displayWidth", width);
    if (file) form.append("file", file);
    try {
      const res = isNew
        ? await api.upload<{ message: string }>(BASE, form)
        : await api.uploadPut<{ message: string }>(`${BASE}/${existing!.code}`, form);
      onSaved(res.message);
    } catch (err) {
      setError(adminErrorView(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={target !== null}
      onClose={onClose}
      title={isNew ? "เพิ่มรูป" : `แก้ไขรูป "${existing?.name ?? ""}"`}
      description={`PNG หรือ JPG ไม่เกิน ${limits.maxBytes / 1024} KB — รูปแนบไปกับอีเมลทุกฉบับที่ใช้ ไฟล์เล็กส่งได้เร็วกว่า`}
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {isNew ? (
          <TextField
            label="รหัสรูป"
            value={code}
            onChange={(e) => setCode(e.target.value.toLowerCase())}
            hint={`ใช้ในเทมเพลตเป็น {{image.${code.trim() || "รหัส"}}} — a–z ตัวเล็ก ตัวเลข และ _ เปลี่ยนภายหลังไม่ได้`}
            error={error?.fields.code}
            required
          />
        ) : null}
        <TextField label="ชื่อรูป" value={name} onChange={(e) => setName(e.target.value)} error={error?.fields.name} required />
        <TextField
          label="คำอธิบายรูป"
          value={altText}
          onChange={(e) => setAltText(e.target.value)}
          hint="แสดงแทนรูปเมื่อเมลไคลเอนต์ไม่โหลดรูป และโปรแกรมอ่านหน้าจออ่านข้อความนี้"
          error={error?.fields.altText}
          required
        />
        <TextField
          label="ความกว้างที่แสดงในอีเมล (px)"
          inputMode="numeric"
          value={width}
          onChange={(e) => setWidth(e.target.value)}
          hint={`${limits.displayWidthMin}–${limits.displayWidthMax} px — ความสูงคำนวณจากสัดส่วนของรูป (อีเมลกว้างราว 500 px)`}
          error={error?.fields.displayWidth}
          required
        />
        <div>
          <label htmlFor="email-image-file" className="mb-1.5 block text-[14px] font-medium text-ink">
            {isNew ? "ไฟล์รูป" : "เปลี่ยนไฟล์ (ไม่เลือก = ใช้ไฟล์เดิม)"}
          </label>
          <input
            id="email-image-file"
            type="file"
            accept="image/png,image/jpeg"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-[14px] text-ink file:mr-3 file:rounded-full file:border-0 file:bg-navy-50 file:px-4 file:py-2 file:text-navy-800"
          />
          {tooBig ? (
            <p className="mt-1 text-[13px] text-danger">
              ไฟล์ใหญ่ {(file!.size / 1024).toFixed(0)} KB — ต้องไม่เกิน {limits.maxBytes / 1024} KB
            </p>
          ) : null}
          {error?.fields.file ? <p className="mt-1 text-[13px] text-danger">{error.fields.file}</p> : null}
          {previewUrl ? (
            <div className="mt-3 flex justify-center rounded-xl bg-[#F6F7FB] p-3 ring-1 ring-line">
              {/* eslint-disable-next-line @next/next/no-img-element -- รูปที่เพิ่งเลือก (blob URL) */}
              <img src={previewUrl} alt="รูปที่เลือก" style={{ width: Number(width) || undefined }} className="max-w-full" />
            </div>
          ) : null}
        </div>
        {error && Object.keys(error.fields).length === 0 ? <ErrorNotice view={error} /> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            ยกเลิก
          </Button>
          <Button type="submit" loading={busy} disabled={tooBig || (isNew && !file)}>
            {isNew ? "เพิ่มรูป" : "บันทึก"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
