"use client";

import { useEffect, useMemo, useState } from "react";

import { SelectField, TextAreaField, TextField } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { adminErrorView, type AdminErrorView } from "@/lib/admin-errors";

import { ErrorNotice } from "./ui";

export type SnapshotField =
  | { key: string; label: string; type: "text" | "textarea" | "number"; wide?: boolean }
  | { key: string; label: string; type: "choice" | "choices"; options: Array<{ code: string; label: string }>; wide?: boolean }
  | { key: string; label: string; type: "flag"; wide?: boolean };

export interface SnapshotSection {
  title: string;
  note?: string;
  fields: SnapshotField[];
}

type Raw = string | number | boolean | null | undefined;

/** ค่าในช่องกรอก ↔ ค่าที่ API รับ — ช่องว่างเป็น null (ล้างค่า) ตัวเลขเป็น number ธง Y/N เป็น boolean */
function toInput(value: Raw): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "Y" : "N";
  return String(value);
}
function fromInput(field: SnapshotField, text: string): Raw {
  const t = text.trim();
  if (!t) return null;
  if (field.type === "number") return Number(t);
  if (field.type === "flag") return t === "Y";
  return t;
}

/**
 * แก้เนื้อของคำขอแทนหน่วยงาน — `PUT /api/admin/registrations/{organizations,datasets}/:id`
 *
 * **ไม่ใช่ฟอร์มของหน่วยงาน** และไม่ได้ตรวจทุกกฎที่ฟอร์มนั้นตรวจระหว่างพิมพ์ API เป็นคนตัดสิน (schema ของมัน `.strict()`
 * และตอบ 400 พร้อมชื่อช่อง ซึ่งขึ้นใต้ช่องนั้นที่นี่) สิ่งที่ตัวแก้นี้รับประกันคือส่ง**เฉพาะช่องที่เปลี่ยน** — API เขียนเฉพาะ
 * key ที่อยู่ใน body ช่องที่ไม่ได้แตะจึงไม่ถูกเขียนทับด้วยค่าที่อ่านมาตอนเปิดหน้า และ diff ใน `audit_event` เหลือแค่ที่แก้จริง
 *
 * ข้ามล็อกทั้งสามของฟอร์ม (รหัสหน่วยงาน ผู้ประสานงาน อีเมล/เลขบัตรของผู้มีอำนาจฯ ที่เปิดใช้งานแล้ว) — ตั้งใจ (CLAUDE.md,
 * "PUT goes past all three of the form's locks") คำเตือนจาก `warnings` แสดงหลังบันทึก
 */
export function SnapshotEditor({
  open,
  onClose,
  title,
  sections,
  values,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  sections: SnapshotSection[];
  values: Record<string, unknown>;
  onSubmit: (changed: Record<string, Raw>, reason: string) => Promise<void>;
}) {
  const fields = useMemo(() => sections.flatMap((s) => s.fields), [sections]);
  const initial = useMemo(
    () => Object.fromEntries(fields.map((f) => [f.key, toInput(values[f.key] as Raw)])),
    [fields, values],
  );
  const [form, setForm] = useState<Record<string, string>>(initial);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AdminErrorView | null>(null);

  useEffect(() => {
    if (!open) return;
    setForm(initial);
    setReason("");
    setError(null);
  }, [open, initial]);

  const changed = fields.filter((f) => (form[f.key] ?? "").trim() !== (initial[f.key] ?? "").trim());

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSubmit(Object.fromEntries(changed.map((f) => [f.key, fromInput(f, form[f.key] ?? "")])), reason.trim());
      onClose();
    } catch (err) {
      setError(adminErrorView(err));
    } finally {
      setBusy(false);
    }
  };

  const control = (f: SnapshotField) => {
    const common = {
      label: f.label,
      value: form[f.key] ?? "",
      error: error?.fields[f.key],
    };
    const onText = (v: string) => setForm((s) => ({ ...s, [f.key]: v }));
    switch (f.type) {
      case "textarea":
        return <TextAreaField {...common} rows={3} onChange={(e) => onText(e.target.value)} />;
      case "number":
        return <TextField {...common} inputMode="numeric" onChange={(e) => onText(e.target.value.replace(/\D/g, ""))} />;
      case "flag":
        return (
          <SelectField {...common} onChange={(e) => onText(e.target.value)}>
            <option value="">— ไม่ระบุ —</option>
            <option value="Y">ใช่ / อนุญาต</option>
            <option value="N">ไม่ใช่ / ไม่อนุญาต</option>
          </SelectField>
        );
      case "choice":
        return (
          <SelectField {...common} onChange={(e) => onText(e.target.value)}>
            <option value="">— ไม่ระบุ —</option>
            {withCode(f.options, common.value).map((o) => (
              <option key={o.code} value={o.code}>
                {o.code} · {o.label}
              </option>
            ))}
          </SelectField>
        );
      case "choices": {
        // รหัสหลายตัวคั่นด้วย comma ในคอลัมน์เดียว (`objective` — CLAUDE.md, schema) เลือกด้วยช่องติ๊ก
        const selected = new Set(common.value.split(",").map((c) => c.trim()).filter(Boolean));
        const toggle = (code: string) => {
          if (selected.has(code)) selected.delete(code);
          else selected.add(code);
          onText(f.options.map((o) => o.code).filter((c) => selected.has(c)).join(","));
        };
        return (
          <fieldset>
            <legend className="text-sm font-medium text-ink">{f.label}</legend>
            <div className="mt-1.5 grid gap-1 sm:grid-cols-2">
              {f.options.map((o) => (
                <label key={o.code} className="flex items-start gap-2 text-[14px]">
                  <input type="checkbox" className="mt-1" checked={selected.has(o.code)} onChange={() => toggle(o.code)} />
                  <span>
                    {o.code} · {o.label}
                  </span>
                </label>
              ))}
            </div>
            {common.error ? <p className="mt-1 text-[13px] text-danger">{common.error}</p> : null}
          </fieldset>
        );
      }
      default:
        return <TextField {...common} onChange={(e) => onText(e.target.value)} />;
    }
  };

  return (
    <Modal open={open} onClose={busy ? () => undefined : onClose} title={title} size="lg">
      <form
        className="space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (changed.length > 0 && reason.trim().length >= 10) void submit();
        }}
      >
        {sections.map((s) => (
          <fieldset key={s.title} className="space-y-3">
            <legend className="text-[15px] font-semibold text-navy-800">{s.title}</legend>
            {s.note ? <p className="text-[13px] text-ink-muted">{s.note}</p> : null}
            <div className="grid gap-4 sm:grid-cols-2">
              {s.fields.map((f) => (
                <div key={f.key} className={f.wide || f.type === "textarea" || f.type === "choices" ? "sm:col-span-2" : undefined}>
                  {control(f)}
                </div>
              ))}
            </div>
          </fieldset>
        ))}

        <div className="sticky bottom-0 -mx-6 -mb-6 space-y-3 border-t border-line bg-white px-6 py-4">
          <TextAreaField
            label="เหตุผลของการแก้ไข"
            required
            rows={2}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            error={error?.fields.reason}
            hint={`หน่วยงานเห็นเหตุผลนี้ — อย่างน้อย 10 ตัวอักษร (${reason.trim().length}/10) · แก้แล้ว ${changed.length} ช่อง`}
          />
          {error && !Object.keys(error.fields).some((k) => k !== "reason") ? <ErrorNotice view={error} /> : null}
          {error && Object.keys(error.fields).some((k) => k !== "reason") ? (
            <ErrorNotice view={{ ...error, message: "ตรวจช่องที่มีข้อความสีแดงด้านบน" }} />
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
              ยกเลิก
            </Button>
            <Button type="submit" loading={busy} disabled={changed.length === 0 || reason.trim().length < 10}>
              บันทึกการแก้ไข
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

/** รหัสที่บันทึกไว้แต่ปิดใช้แล้ว (ไม่อยู่ในรายการที่ใช้ได้) ต้องยังแสดงอยู่ ไม่งั้น select แสดงค่าว่างทั้งที่คำขอมีค่า */
function withCode(options: Array<{ code: string; label: string }>, code: string) {
  return code && !options.some((o) => o.code === code) ? [{ code, label: "(ตัวเลือกที่ปิดใช้แล้ว)" }, ...options] : options;
}
