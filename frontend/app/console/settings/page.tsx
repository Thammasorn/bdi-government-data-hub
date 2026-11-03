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
  const { data, error, loading, reload } = useAdminData<{ settings: SystemSetting[] }>("/api/admin/settings");

  if (loading && !data) return <Spinner />;
  if (error && !data) return <ErrorNotice view={adminErrorView(error)} />;
  if (!data) return null;

  return (
    <div>
      <PageHeader eyebrow="ตั้งค่าระบบ" title="ตั้งค่าระบบ" />
      <div className="space-y-6">
        {data.settings.map((setting) => (
          <SettingForm key={`${setting.key}:${setting.value}`} setting={setting} onSaved={reload} />
        ))}
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
