"use client";

import clsx from "clsx";
import { useState } from "react";

import { ActionDialog } from "@/components/console/ActionDialog";
import { Badge, ErrorNotice, PageHeader, Panel } from "@/components/console/ui";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { Spinner } from "@/components/ui/Spinner";
import { useToast } from "@/components/ui/Toast";
import { adminErrorView, type AdminErrorView } from "@/lib/admin-errors";
import { api } from "@/lib/api";
import { useAdminData, useUrlFilters } from "@/lib/use-admin";

interface Choice {
  id: string;
  code: string;
  labelTh: string;
  labelEn: string | null;
  displayOrder: number;
  isActive: boolean;
}

interface ChoiceField {
  fieldKey: string;
  /** ไม่ null = เพิ่มรหัสใหม่ไม่ได้ (ตารางเงื่อนไขในโค้ดตัดสินตัวเลือกของช่องนี้) พร้อมเหตุผล */
  addRestriction: string | null;
  choices: Choice[];
}

/** ชื่อช่องตามหัวข้อของแบบฟอร์มชุดข้อมูล (docs/11) */
const FIELD_LABELS: Record<string, string> = {
  dataType: "ประเภทข้อมูล",
  dataTopic: "ประเด็นของข้อมูล",
  objective: "วัตถุประสงค์",
  updateFrequencyUnit: "ความถี่ในการปรับปรุง",
  deliveryFrequency: "ความถี่ในการส่งข้อมูล",
  geoCoverage: "ขอบเขตเชิงพื้นที่",
  dataFormat: "รูปแบบการส่งข้อมูล",
  dataCategory: "หมวดหมู่ข้อมูล",
  personalDataProcessingPeriod: "ระยะเวลาประมวลผลข้อมูลส่วนบุคคล",
  dataClassification: "ระดับชั้นข้อมูล",
  licenseId: "สัญญาอนุญาต",
};

const ACTIVE = { label: "แสดงในฟอร์ม", className: "bg-success-bg text-success" };
const INACTIVE = { label: "ปิดใช้", className: "bg-navy-50 text-ink-muted" };

/**
 * ตัวเลือกของแบบฟอร์มชุดข้อมูล — แถวใน `administration.dataset_choice` (CLAUDE.md, Frontend)
 *
 * **ไม่มีปุ่มลบโดยตั้งใจ** คำขอที่บันทึกไปแล้วและเอกสาร A4 ที่ลงนามแล้วถือรหัสนั้นอยู่ ปิดใช้แทน: หายจากตัวเลือกของคนที่
 * กำลังกรอก แต่คำขอเก่ายังตรวจผ่านและพิมพ์ช่องติ๊กได้ รหัสแก้ไม่ได้ด้วยเหตุผลเดียวกัน — แก้ได้แค่ป้ายและลำดับ
 * ทุกคำสั่งบันทึกแล้ว cache ของ API ถูกโหลดใหม่ให้เอง "โหลดตัวเลือกใหม่" มีไว้หลังแก้ฐานข้อมูลด้วยมือเท่านั้น
 */
export default function ConsoleDatasetChoicesPage() {
  const { values, set } = useUrlFilters(["field"] as const);
  const { show } = useToast();
  const { data, error, loading, reload } = useAdminData<{ fields: ChoiceField[] }>("/api/admin/dataset-choices");
  const [adding, setAdding] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  if (loading && !data) return <Spinner />;
  if (error && !data) return <ErrorNotice view={adminErrorView(error)} />;
  if (!data) return null;

  const field = data.fields.find((f) => f.fieldKey === values.field) ?? data.fields[0];
  if (!field) return null;
  const sorted = field.choices.slice().sort((a, b) => a.displayOrder - b.displayOrder);

  return (
    <div>
      <PageHeader
        eyebrow="ตั้งค่าระบบ"
        title="ตัวเลือกในแบบฟอร์มชุดข้อมูล"
        description="เพิ่มตัวเลือกหรือแก้ป้ายได้ทันทีโดยไม่ต้อง deploy — ตัวเลือกที่ใช้แล้วลบไม่ได้ ให้ปิดใช้แทน คำขอเก่าที่เลือกไว้ยังอ่านได้ตามเดิม"
        actions={
          <Button
            size="sm"
            variant="secondary"
            loading={refreshing}
            onClick={async () => {
              setRefreshing(true);
              try {
                const res = await api.post<{ message: string }>("/api/admin/dataset-choices/refresh");
                show({ tone: "success", title: "โหลดตัวเลือกใหม่แล้ว", detail: res.message });
                reload();
              } catch (err) {
                show({ tone: "error", title: "โหลดใหม่ไม่สำเร็จ", detail: adminErrorView(err).message });
              } finally {
                setRefreshing(false);
              }
            }}
          >
            โหลดตัวเลือกใหม่
          </Button>
        }
      />

      <div className="grid gap-5 md:grid-cols-[14rem_1fr]">
        <nav aria-label="ช่องของแบบฟอร์ม" className="flex gap-1.5 overflow-x-auto md:flex-col md:overflow-visible">
          {data.fields.map((f) => (
            <button
              key={f.fieldKey}
              type="button"
              onClick={() => set({ field: f.fieldKey })}
              aria-current={f.fieldKey === field.fieldKey ? "true" : undefined}
              className={clsx(
                "flex shrink-0 items-center justify-between gap-2 whitespace-nowrap rounded-xl px-3 py-2 text-left text-[14px] transition-colors md:whitespace-normal",
                f.fieldKey === field.fieldKey ? "bg-white font-medium text-navy-800 shadow-card ring-1 ring-line" : "text-ink-muted hover:bg-white/70",
              )}
            >
              {FIELD_LABELS[f.fieldKey] ?? f.fieldKey}
              <span className="text-[12px] tabular-nums text-ink-subtle">{f.choices.filter((c) => c.isActive).length}</span>
            </button>
          ))}
        </nav>

        <Panel
          title={FIELD_LABELS[field.fieldKey] ?? field.fieldKey}
          description={field.addRestriction ?? `ช่อง ${field.fieldKey} — เรียงตามลำดับที่แสดงในฟอร์ม`}
          actions={
            field.addRestriction ? null : (
              <Button size="sm" onClick={() => setAdding(true)}>
                เพิ่มตัวเลือก
              </Button>
            )
          }
          flush
        >
          <ul className="divide-y divide-line">
            {sorted.map((c) => (
              <ChoiceRow
                key={c.id}
                fieldKey={field.fieldKey}
                choice={c}
                onSaved={(msg) => {
                  show({ tone: "success", title: msg });
                  reload();
                }}
              />
            ))}
          </ul>
        </Panel>
      </div>

      <AddChoiceDialog
        open={adding}
        fieldKey={field.fieldKey}
        nextOrder={(sorted.at(-1)?.displayOrder ?? 0) + 1}
        onClose={() => setAdding(false)}
        onAdded={(label) => {
          show({ tone: "success", title: "เพิ่มตัวเลือกแล้ว", detail: label });
          reload();
        }}
      />
    </div>
  );
}

function ChoiceRow({ fieldKey, choice, onSaved }: { fieldKey: string; choice: Choice; onSaved: (msg: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ labelTh: choice.labelTh, labelEn: choice.labelEn ?? "", order: String(choice.displayOrder) });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AdminErrorView | null>(null);

  const patch = async (body: Record<string, unknown>, msg: string) => {
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/api/admin/dataset-choices/${fieldKey}/${encodeURIComponent(choice.code)}`, body);
      setEditing(false);
      onSaved(msg);
    } catch (err) {
      setError(adminErrorView(err));
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    return (
      <li className="space-y-3 bg-canvas/60 px-5 py-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_6rem]">
          <TextField
            label={`ป้ายภาษาไทย (รหัส ${choice.code})`}
            value={form.labelTh}
            onChange={(e) => setForm({ ...form, labelTh: e.target.value })}
            error={error?.fields.labelTh}
          />
          <TextField
            label="ป้ายภาษาอังกฤษ"
            value={form.labelEn}
            onChange={(e) => setForm({ ...form, labelEn: e.target.value })}
            error={error?.fields.labelEn}
          />
          <TextField
            label="ลำดับ"
            inputMode="numeric"
            value={form.order}
            onChange={(e) => setForm({ ...form, order: e.target.value.replace(/\D/g, "") })}
            error={error?.fields.displayOrder}
          />
        </div>
        {error && Object.keys(error.fields).length === 0 ? <ErrorNotice view={error} /> : null}
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="secondary" onClick={() => setEditing(false)} disabled={busy}>
            ยกเลิก
          </Button>
          <Button
            size="sm"
            loading={busy}
            disabled={!form.labelTh.trim() || form.order === ""}
            onClick={() =>
              void patch(
                { labelTh: form.labelTh.trim(), labelEn: form.labelEn.trim() || null, displayOrder: Number(form.order) },
                "บันทึกตัวเลือกแล้ว",
              )
            }
          >
            บันทึก
          </Button>
        </div>
      </li>
    );
  }

  return (
    <li className={clsx("flex flex-wrap items-center gap-3 px-5 py-3", !choice.isActive && "opacity-70")}>
      <span className="w-12 shrink-0 font-mono text-[13px] text-ink-muted">{choice.code}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14.5px] text-ink">{choice.labelTh}</span>
        {choice.labelEn ? <span className="block text-[13px] text-ink-muted">{choice.labelEn}</span> : null}
      </span>
      <Badge meta={choice.isActive ? ACTIVE : INACTIVE} />
      <span className="flex gap-1">
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="rounded-full px-2.5 py-1 text-[13px] font-medium text-navy-700 hover:bg-navy-50"
        >
          แก้ไข
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void patch({ isActive: !choice.isActive }, choice.isActive ? "ปิดใช้ตัวเลือกแล้ว" : "เปิดใช้ตัวเลือกแล้ว")
          }
          className="rounded-full px-2.5 py-1 text-[13px] font-medium text-navy-700 hover:bg-navy-50 disabled:opacity-50"
        >
          {choice.isActive ? "ปิดใช้" : "เปิดใช้"}
        </button>
      </span>
      {error ? <ErrorNotice view={error} className="basis-full" /> : null}
    </li>
  );
}

function AddChoiceDialog({
  open,
  fieldKey,
  nextOrder,
  onClose,
  onAdded,
}: {
  open: boolean;
  fieldKey: string;
  nextOrder: number;
  onClose: () => void;
  onAdded: (label: string) => void;
}) {
  const [form, setForm] = useState({ code: "", labelTh: "", labelEn: "" });
  return (
    <ActionDialog
      open={open}
      onClose={() => {
        setForm({ code: "", labelTh: "", labelEn: "" });
        onClose();
      }}
      title={`เพิ่มตัวเลือกใน “${FIELD_LABELS[fieldKey] ?? fieldKey}”`}
      description="รหัสแก้ภายหลังไม่ได้ และใช้เป็นชื่อช่องติ๊กในเอกสาร A4 ({{tick.<ช่อง>.<รหัส>}}) — ตั้งให้ต่อจากรหัสเดิมของช่องนี้"
      confirmLabel="เพิ่มตัวเลือก"
      reason={false}
      canSubmit={Boolean(form.code.trim() && form.labelTh.trim())}
      onConfirm={async () => {
        await api.post(`/api/admin/dataset-choices/${fieldKey}`, {
          code: form.code.trim(),
          labelTh: form.labelTh.trim(),
          labelEn: form.labelEn.trim() || null,
          displayOrder: nextOrder,
        });
        onAdded(form.labelTh.trim());
        setForm({ code: "", labelTh: "", labelEn: "" });
      }}
    >
      <TextField label="รหัส" required maxLength={16} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
      <TextField
        label="ป้ายภาษาไทย"
        required
        value={form.labelTh}
        onChange={(e) => setForm({ ...form, labelTh: e.target.value })}
      />
      <TextField label="ป้ายภาษาอังกฤษ" value={form.labelEn} onChange={(e) => setForm({ ...form, labelEn: e.target.value })} />
    </ActionDialog>
  );
}
