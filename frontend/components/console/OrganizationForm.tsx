"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { SelectField, TextField } from "@/components/ui/Field";
import type { AdminOrganization } from "@/lib/admin";
import { adminErrorView, type AdminErrorView } from "@/lib/admin-errors";
import { api } from "@/lib/api";

import { ErrorNotice } from "./ui";

const FIELDS = [
  "organizationCode",
  "nameTh",
  "nameEn",
  "organizationType",
  "addressLine",
  "road",
  "province",
  "district",
  "subdistrict",
  "postalCode",
  "phone",
  "phoneExtension",
  "email",
  "websiteUrl",
] as const;
type Key = (typeof FIELDS)[number];
type Values = Record<Key, string>;

const EMPTY: Values = Object.fromEntries(FIELDS.map((k) => [k, ""])) as Values;

function valuesOf(org: AdminOrganization | null): Values {
  if (!org) return EMPTY;
  return Object.fromEntries(FIELDS.map((k) => [k, (org[k] as string | null) ?? ""])) as Values;
}

/**
 * ทะเบียนหน่วยงาน — ฟอร์มเดียวใช้ทั้งสร้าง (`POST /api/admin/organizations`) และแก้ (`PATCH /:id`)
 *
 * บังคับแค่รหัสกับชื่อไทย ตามที่ API บังคับ (สองคอลัมน์ที่ฐานข้อมูลทำให้ NOT NULL) ที่เหลือหน่วยงานกรอกเองในคำขอ
 * ลงทะเบียนได้ ตอนแก้ ส่งเฉพาะช่องที่เปลี่ยน และช่องที่ถูกลบจนว่างส่งเป็น `null` (ล้างค่า) — API แยก "ไม่ส่ง" กับ "ล้าง"
 *
 * ที่อยู่เลือกจากรายการ (จังหวัด → อำเภอ → ตำบล แล้วเติมรหัสไปรษณีย์ให้) ไม่ใช่พิมพ์เอง: API แปลงชื่อเป็นรหัสด้วยการเทียบ
 * ตรงตัว ชื่อที่พิมพ์ต่างไปนิดเดียวได้ 400
 */
export function OrganizationForm({
  organization,
  onSaved,
  onCancel,
}: {
  organization: AdminOrganization | null;
  onSaved: (org: AdminOrganization, warning?: string) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<Values>(() => valuesOf(organization));
  const [provinces, setProvinces] = useState<string[]>([]);
  const [amphoes, setAmphoes] = useState<string[]>([]);
  const [subdistricts, setSubdistricts] = useState<Array<{ name: string; zipcode: string }>>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<AdminErrorView | null>(null);

  useEffect(() => {
    api
      .get<{ provinces: string[] }>("/api/address/provinces")
      .then((d) => setProvinces(d.provinces))
      .catch(() => setProvinces([]));
  }, []);
  useEffect(() => {
    if (!form.province) return setAmphoes([]);
    api
      .get<{ amphoes: string[] }>(`/api/address/amphoes?province=${encodeURIComponent(form.province)}`)
      .then((d) => setAmphoes(d.amphoes))
      .catch(() => setAmphoes([]));
  }, [form.province]);
  useEffect(() => {
    if (!form.province || !form.district) return setSubdistricts([]);
    api
      .get<{ subdistricts: Array<{ name: string; zipcode: string }> }>(
        `/api/address/subdistricts?province=${encodeURIComponent(form.province)}&amphoe=${encodeURIComponent(form.district)}`,
      )
      .then((d) => setSubdistricts(d.subdistricts))
      .catch(() => setSubdistricts([]));
  }, [form.province, form.district]);

  const set = (key: Key, value: string) => {
    setForm((f) => {
      const next = { ...f, [key]: value };
      // เปลี่ยนระดับบนแล้วระดับล่างที่เลือกไว้ไม่ใช่ของจังหวัด/อำเภอนั้นอีกต่อไป
      if (key === "province") Object.assign(next, { district: "", subdistrict: "", postalCode: "" });
      if (key === "district") Object.assign(next, { subdistrict: "", postalCode: "" });
      if (key === "subdistrict") next.postalCode = subdistricts.find((s) => s.name === value)?.zipcode ?? "";
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      if (organization) {
        const before = valuesOf(organization);
        const changed = Object.fromEntries(
          FIELDS.filter((k) => form[k].trim() !== before[k]).map((k) => [k, form[k].trim() || null]),
        );
        if (Object.keys(changed).length === 0) {
          onCancel();
          return;
        }
        const res = await api.patch<{ organization: AdminOrganization; warning?: string }>(
          `/api/admin/organizations/${organization.id}`,
          changed,
        );
        onSaved(res.organization, res.warning);
      } else {
        const body = Object.fromEntries(FIELDS.filter((k) => form[k].trim()).map((k) => [k, form[k].trim()]));
        const res = await api.post<{ organization: AdminOrganization }>("/api/admin/organizations", body);
        onSaved(res.organization);
      }
    } catch (err) {
      setError(adminErrorView(err));
    } finally {
      setSaving(false);
    }
  };

  const field = (key: Key, label: string, extra: Partial<Parameters<typeof TextField>[0]> = {}) => (
    <TextField
      label={label}
      value={form[key]}
      onChange={(e) => set(key, e.target.value)}
      error={error?.fields[key]}
      {...extra}
    />
  );

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-[14px] font-semibold text-navy-800">ข้อมูลหน่วยงาน</legend>
        {field("organizationCode", "รหัสหน่วยงาน", {
          required: true,
          hint: organization ? "พิมพ์บนเอกสาร A0 — แก้แล้วคำขอที่ลงนามไปแล้วไม่เปลี่ยนตาม" : "รหัสที่ใช้อ้างอิงหน่วยงาน ซ้ำกับที่มีอยู่ไม่ได้",
        })}
        {field("organizationType", "ประเภทหน่วยงาน")}
        {field("nameTh", "ชื่อหน่วยงาน (ไทย)", { required: true, className: "sm:col-span-2" })}
        {field("nameEn", "ชื่อหน่วยงาน (อังกฤษ)", { className: "sm:col-span-2" })}
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-[14px] font-semibold text-navy-800">ที่อยู่</legend>
        {field("addressLine", "เลขที่ / อาคาร")}
        {field("road", "ถนน")}
        <SelectField label="จังหวัด" value={form.province} onChange={(e) => set("province", e.target.value)} error={error?.fields.province}>
          <option value="">เลือกจังหวัด</option>
          {withCurrent(provinces, form.province).map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="อำเภอ / เขต"
          value={form.district}
          onChange={(e) => set("district", e.target.value)}
          disabled={!form.province}
          error={error?.fields.district}
        >
          <option value="">เลือกอำเภอ</option>
          {withCurrent(amphoes, form.district).map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="ตำบล / แขวง"
          value={form.subdistrict}
          onChange={(e) => set("subdistrict", e.target.value)}
          disabled={!form.district}
          error={error?.fields.subdistrict}
        >
          <option value="">เลือกตำบล</option>
          {withCurrent(
            subdistricts.map((s) => s.name),
            form.subdistrict,
          ).map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </SelectField>
        {field("postalCode", "รหัสไปรษณีย์", { inputMode: "numeric", maxLength: 5 })}
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-[14px] font-semibold text-navy-800">ช่องทางติดต่อ</legend>
        {field("phone", "เบอร์โทรศัพท์", { inputMode: "numeric" })}
        {field("phoneExtension", "เบอร์ต่อ", { inputMode: "numeric", maxLength: 10 })}
        {field("email", "อีเมลหน่วยงาน", { type: "email" })}
        {field("websiteUrl", "เว็บไซต์")}
      </fieldset>

      {error && Object.keys(error.fields).length === 0 ? <ErrorNotice view={error} /> : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={saving}>
          ยกเลิก
        </Button>
        <Button type="submit" loading={saving} disabled={!form.organizationCode.trim() || !form.nameTh.trim()}>
          {organization ? "บันทึก" : "สร้างหน่วยงาน"}
        </Button>
      </div>
    </form>
  );
}

/** ค่าที่บันทึกไว้แต่ไม่อยู่ในรายการ (ยังโหลดไม่เสร็จ หรือชื่อเก่า) ต้องยังเลือกอยู่ ไม่งั้น select แสดงค่าแรกแทน */
function withCurrent(list: string[], current: string): string[] {
  return current && !list.includes(current) ? [current, ...list] : list;
}

