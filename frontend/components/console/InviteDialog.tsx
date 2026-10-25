"use client";

import { useEffect, useState } from "react";

import { ActionDialog } from "@/components/console/ActionDialog";
import { OrganizationPicker } from "@/components/console/OrganizationPicker";
import { SelectField, TextField } from "@/components/ui/Field";
import { BDI_ROLE_CODES, ORGANIZATION_ROLES } from "@/lib/admin";
import { api } from "@/lib/api";
import { PREFIXES, ROLE_LABELS, type Role } from "@/lib/status";

/** หน่วยงานที่กล่องเชิญถูกล็อกไว้ — เปิดจากหน้าของหน่วยงานนั้นเอง */
export interface LockedOrganization {
  id: string;
  nameTh: string;
}

/**
 * กล่อง "เชิญผู้ใช้" — `POST /api/admin/invitations` ที่เคยอยู่ในหน้าคำเชิญรวมอย่างเดียว
 *
 * แยกออกมาเพราะปุ่มเชิญบนหน้าหน่วยงานและหน้าผู้ใช้เคยเป็น**ลิงก์**พามาเปิดกล่องที่หน้าคำเชิญ ส่งเสร็จแล้วผู้ดูแลค้างอยู่
 * หน้านั้นโดยไม่มีทางกลับไปหน่วยงานที่เพิ่งดูอยู่ (การ์ด Issue 2026-10-25) ตอนนี้ทุกหน้าเปิดกล่องนี้ในที่ของตัวเอง
 *
 * `lockedOrganization` — เปิดจากหน้าของหน่วยงาน: ไม่มีตัวเลือกหน่วยงานให้เลือกผิด ชื่อหน่วยงานแสดงเป็นข้อความ และบทบาท
 * เหลือเฉพาะฝั่งหน่วยงาน (เชิญเจ้าหน้าที่ BDI "เข้าหน่วยงาน" ไม่มีความหมาย) ไม่ส่งมา = กล่องเต็มของหน้าคำเชิญรวม
 * ซึ่งยังรับค่าตั้งต้นจาก URL (`?new=1&role=…&organizationId=…`) ที่ `lib/admin-errors.ts` ลิงก์มา
 */
export function InviteDialog({
  open,
  initialRole = "",
  initialOrganization = "",
  lockedOrganization,
  onClose,
  onDone,
}: {
  open: boolean;
  initialRole?: Role | "";
  initialOrganization?: string;
  lockedOrganization?: LockedOrganization;
  onClose: () => void;
  onDone: (email: string) => void;
}) {
  const [form, setForm] = useState({ email: "", cid: "", role: "" as Role | "", org: "", prefix: "", first: "", last: "" });
  const lockedId = lockedOrganization?.id ?? "";
  useEffect(() => {
    if (open) {
      setForm({
        email: "",
        cid: "",
        role: lockedId ? initialRole || "ORGANIZATION_USER" : initialRole,
        org: lockedId || initialOrganization,
        prefix: "",
        first: "",
        last: "",
      });
    }
    // ผูกกับ id ไม่ใช่ object — หน้าที่เรียกสร้าง `lockedOrganization` ใหม่ทุก render และ effect นี้ล้างฟอร์มทิ้ง
  }, [open, initialRole, initialOrganization, lockedId]);
  const scoped = form.role !== "" && ORGANIZATION_ROLES.includes(form.role);
  const ready = /\S+@\S+\.\S+/.test(form.email) && /^\d{13}$/.test(form.cid) && form.role !== "" && (!scoped || form.org);

  return (
    <ActionDialog
      open={open}
      onClose={onClose}
      title={lockedOrganization ? "เชิญเข้าหน่วยงานนี้" : "เชิญผู้ใช้"}
      description="ระบบสร้างบัญชีที่รอเปิดใช้งานแล้วส่งลิงก์ไปที่อีเมล — เลขบัตรต้องตรงกับบัตรที่ผู้รับใช้ยืนยันตัวตนกับ ThaID"
      confirmLabel="ส่งคำเชิญ"
      reason={false}
      canSubmit={Boolean(ready)}
      onConfirm={async () => {
        await api.post("/api/admin/invitations", {
          email: form.email.trim(),
          cid: form.cid,
          role: form.role,
          ...(scoped ? { organizationId: form.org } : {}),
          ...(form.prefix ? { prefixTh: form.prefix } : {}),
          ...(form.first.trim() ? { firstnameTh: form.first.trim() } : {}),
          ...(form.last.trim() ? { lastnameTh: form.last.trim() } : {}),
        });
        onDone(form.email.trim());
      }}
    >
      {lockedOrganization ? <TextField label="หน่วยงาน" value={lockedOrganization.nameTh} readOnly /> : null}
      <TextField
        label="อีเมล"
        type="email"
        required
        value={form.email}
        onChange={(e) => setForm({ ...form, email: e.target.value })}
        placeholder="name@agency.go.th"
      />
      <TextField
        label="เลขประจำตัวประชาชน"
        required
        inputMode="numeric"
        maxLength={13}
        value={form.cid}
        onChange={(e) => setForm({ ...form, cid: e.target.value.replace(/\D/g, "") })}
        hint="13 หลัก จากเอกสารที่หน่วยงานส่งมา"
      />
      <SelectField
        label="บทบาท"
        required
        value={form.role}
        onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
      >
        <option value="">เลือกบทบาท</option>
        {lockedOrganization ? (
          ORGANIZATION_ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))
        ) : (
          <>
            <optgroup label="ฝั่งหน่วยงาน">
              {ORGANIZATION_ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </optgroup>
            <optgroup label="ฝั่ง BDI">
              {BDI_ROLE_CODES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </optgroup>
          </>
        )}
      </SelectField>
      {scoped ? (
        <>
          {lockedOrganization ? null : (
            <OrganizationPicker value={form.org} onChange={(org) => setForm({ ...form, org })} required />
          )}
          {form.role === "ORGANIZATION_APPROVER" ? (
            <p className="text-[13px] text-ink-muted">
              ผู้มีอำนาจอนุมัติคนแรกมาจากคำขอลงทะเบียนของหน่วยงาน — เชิญตรงได้เฉพาะหน่วยงานที่เปิดใช้งานแล้ว
            </p>
          ) : null}
        </>
      ) : null}
      <details className="rounded-xl bg-canvas px-4 py-3">
        <summary className="cursor-pointer text-[14px] font-medium text-navy-700">ชื่อผู้รับ (ไม่บังคับ)</summary>
        <p className="mt-2 text-[13px] text-ink-muted">กรอกไว้ให้หน้าเปิดใช้งานเติมให้ — ผู้รับยืนยันชื่อจาก ThaID อีกครั้ง</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <SelectField label="คำนำหน้า" value={form.prefix} onChange={(e) => setForm({ ...form, prefix: e.target.value })}>
            <option value="">—</option>
            {PREFIXES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </SelectField>
          <TextField label="ชื่อ" value={form.first} onChange={(e) => setForm({ ...form, first: e.target.value })} />
          <TextField label="นามสกุล" value={form.last} onChange={(e) => setForm({ ...form, last: e.target.value })} />
        </div>
      </details>
    </ActionDialog>
  );
}
