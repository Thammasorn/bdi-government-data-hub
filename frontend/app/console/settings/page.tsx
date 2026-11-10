"use client";

import { useState } from "react";

import { ErrorNotice, PageHeader, Panel } from "@/components/console/ui";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { Spinner } from "@/components/ui/Spinner";
import { useToast } from "@/components/ui/Toast";
import { adminErrorView, type AdminErrorView } from "@/lib/admin-errors";
import { api } from "@/lib/api";
import { formatThaiDate } from "@/lib/status";
import { useAdminData } from "@/lib/use-admin";

/** หนึ่งค่าตั้งระบบตามที่ `GET /api/admin/settings` ตอบ — ชื่อช่องตรงกับ `listSystemSettings()` ใน backend/src/lib/system-settings.ts */
interface SystemSetting {
  key: string;
  label: string;
  description: string;
  unit: string;
  /** ค่าที่วางรวมในกล่องเดียวกัน — คีย์ของ `groups` ในคำตอบเดียวกัน */
  group: string | null;
  fieldLabel: string | null;
  value: number;
  defaultValue: number;
  isDefault: boolean;
  min: number;
  max: number;
  outOfRange: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

/**
 * ตั้งค่าระบบ — ค่าที่ผู้ดูแลระบบแก้ได้โดยไม่ต้อง deploy (การ์ด "อีเมลเตือนก่อนคำเชิญหมดอายุ (ตั้งจำนวนวันได้ใน admin)", 2026-11-03)
 *
 * ตอนนี้มีค่าเดียว (`invitation_reminder_days`) หน้านี้วาดตามรายการที่ API ตอบ ไม่รู้จักค่าไหนเป็นพิเศษ — ค่าใหม่ใน `SYSTEM_SETTINGS`
 * ฝั่ง backend ขึ้นที่นี่เองโดยไม่ต้องแก้หน้า ช่วงที่ใช้ได้มาจาก API เช่นกัน และ API ตรวจซ้ำเสมอ
 */
export default function ConsoleSettingsPage() {
  const { data, error, loading, reload } = useAdminData<{
    settings: SystemSetting[];
    groups: Record<string, { title: string; description: string }>;
  }>("/api/admin/settings");

  if (loading && !data) return <Spinner />;
  if (error && !data) return <ErrorNotice view={adminErrorView(error)} />;
  if (!data) return null;

  return (
    <div>
      <PageHeader eyebrow="ตั้งค่าระบบ" title="ตั้งค่าระบบ" />
      <div className="space-y-6">
        {/* ค่าที่อยู่กลุ่มเดียวกันขึ้นเป็นกล่องเดียว ณ ตำแหน่งของค่าแรกในกลุ่ม */}
        {data.settings.map((setting, index) => {
          if (!setting.group) {
            return <SettingForm key={`${setting.key}:${setting.value}`} setting={setting} onSaved={reload} />;
          }
          if (data.settings.findIndex((s) => s.group === setting.group) !== index) return null;
          const members = data.settings.filter((s) => s.group === setting.group);
          const group = data.groups[setting.group];
          return (
            <SettingGroupForm
              key={`${setting.group}:${members.map((m) => m.value).join(",")}`}
              title={group?.title ?? setting.label}
              description={group?.description ?? ""}
              settings={members}
              onSaved={reload}
            />
          );
        })}
      </div>
    </div>
  );
}

function SettingForm({ setting, onSaved }: { setting: SystemSetting; onSaved: () => void }) {
  const [text, setText] = useState(String(setting.value));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AdminErrorView | null>(null);
  const { show } = useToast();

  const trimmed = text.trim();
  const parsed = /^\d+$/.test(trimmed) ? Number(trimmed) : null;
  // ตรวจช่วงในหน้าก่อนกด — ข้อความเดียวกับที่ API ตอบ 400 (`PUT /api/admin/settings/:key`)
  const localError =
    trimmed !== "" && (parsed === null || parsed < setting.min || parsed > setting.max)
      ? `ต้องเป็นจำนวนเต็ม ${setting.min}–${setting.max} ${setting.unit}`
      : undefined;
  const dirty = parsed !== setting.value;

  const save = async () => {
    if (parsed === null) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.put<{ message: string }>(`/api/admin/settings/${setting.key}`, { value: parsed });
      show({ tone: "success", title: res.message });
      onSaved();
    } catch (err) {
      setError(adminErrorView(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title={setting.label} description={setting.description}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="max-w-xs">
          <TextField
            label={`จำนวน${setting.unit}`}
            inputMode="numeric"
            value={text}
            onChange={(e) => setText(e.target.value)}
            error={localError ?? error?.fields.value}
            hint={`${setting.min}–${setting.max} ${setting.unit} · ค่าเริ่มต้น ${setting.defaultValue} ${setting.unit}`}
          />
        </div>
        {setting.outOfRange ? (
          <p role="note" className="rounded-xl bg-warning-bg px-4 py-3 text-[14px] text-ink">
            ค่าที่ตั้งไว้ ({setting.value} {setting.unit}) เกินอายุคำเชิญในตอนนี้ จึงไม่มีคำเชิญใดได้รับอีเมลเตือน — ตั้งค่าใหม่ไม่เกิน{" "}
            {setting.max} {setting.unit}
          </p>
        ) : null}
        <p className="text-[13px] text-ink-muted">
          {setting.isDefault
            ? "ใช้ค่าเริ่มต้นของระบบ ยังไม่มีผู้ตั้งค่า"
            : `แก้ไขล่าสุด ${setting.updatedAt ? formatThaiDate(setting.updatedAt) : ""}${setting.updatedBy ? ` โดย ${setting.updatedBy}` : ""}`}
        </p>
        {error ? <ErrorNotice view={error} hideFields={["value"]} /> : null}
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={!dirty || busy}
            onClick={() => {
              setText(String(setting.value));
              setError(null);
            }}
          >
            ยกเลิกการแก้ไข
          </Button>
          <Button type="submit" loading={busy} disabled={!dirty || parsed === null || Boolean(localError)}>
            บันทึก
          </Button>
        </div>
      </form>
    </Panel>
  );
}

/** ช่วงที่ยอมรับ — ข้อความเดียวกับที่ API ตอบ */
function rangeError(setting: SystemSetting, text: string): string | undefined {
  const trimmed = text.trim();
  const parsed = /^\d+$/.test(trimmed) ? Number(trimmed) : null;
  return trimmed !== "" && (parsed === null || parsed < setting.min || parsed > setting.max)
    ? `ต้องเป็นจำนวนเต็ม ${setting.min}–${setting.max} ${setting.unit}`
    : undefined;
}

/**
 * หลายค่าในกล่องเดียว ปุ่มบันทึกเดียว — บันทึกเฉพาะค่าที่เปลี่ยน ทีละค่า
 *
 * API รับทีละ key ถ้าค่าที่สองไม่ผ่าน ค่าแรกถูกบันทึกไปแล้ว หน้าจอจึงโหลดใหม่ทุกครั้ง ไม่ว่าสำเร็จหรือไม่
 */
function SettingGroupForm({
  title,
  description,
  settings,
  onSaved,
}: {
  title: string;
  description: string;
  settings: SystemSetting[];
  onSaved: () => void;
}) {
  const [texts, setTexts] = useState<Record<string, string>>(() =>
    Object.fromEntries(settings.map((s) => [s.key, String(s.value)])),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AdminErrorView | null>(null);
  const { show } = useToast();

  const errors = Object.fromEntries(settings.map((s) => [s.key, rangeError(s, texts[s.key] ?? "")]));
  const changed = settings.filter((s) => (texts[s.key] ?? "").trim() !== String(s.value));
  const invalid = settings.some((s) => errors[s.key] || (texts[s.key] ?? "").trim() === "");

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      for (const setting of changed) {
        await api.put(`/api/admin/settings/${setting.key}`, { value: Number(texts[setting.key].trim()) });
      }
      show({ tone: "success", title: `บันทึก${title}แล้ว` });
      onSaved();
    } catch (err) {
      setError(adminErrorView(err));
      onSaved();
    } finally {
      setBusy(false);
    }
  };

  const latest = settings
    .filter((s) => !s.isDefault && s.updatedAt)
    .sort((a, b) => Date.parse(b.updatedAt!) - Date.parse(a.updatedAt!))[0];

  return (
    <Panel title={title} description={description}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          {settings.map((setting) => (
            <TextField
              key={setting.key}
              label={setting.fieldLabel ?? setting.label}
              inputMode="numeric"
              value={texts[setting.key] ?? ""}
              onChange={(e) => setTexts((t) => ({ ...t, [setting.key]: e.target.value }))}
              error={errors[setting.key]}
              hint={`${setting.min}–${setting.max} ${setting.unit} · ค่าเริ่มต้น ${setting.defaultValue} ${setting.unit}`}
            />
          ))}
        </div>
        <p className="text-[13px] text-ink-muted">
          {latest
            ? `แก้ไขล่าสุด ${formatThaiDate(latest.updatedAt!)}${latest.updatedBy ? ` โดย ${latest.updatedBy}` : ""}`
            : "ใช้ค่าเริ่มต้นของระบบ ยังไม่มีผู้ตั้งค่า"}
        </p>
        {error ? <ErrorNotice view={error} /> : null}
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={changed.length === 0 || busy}
            onClick={() => {
              setTexts(Object.fromEntries(settings.map((s) => [s.key, String(s.value)])));
              setError(null);
            }}
          >
            ยกเลิกการแก้ไข
          </Button>
          <Button type="submit" loading={busy} disabled={changed.length === 0 || invalid}>
            บันทึก
          </Button>
        </div>
      </form>
    </Panel>
  );
}
