"use client";

import { useEffect, useRef, useState } from "react";

import { ActionDialog } from "@/components/console/ActionDialog";
import { OrganizationPicker } from "@/components/console/OrganizationPicker";
import { SelectField, TextField } from "@/components/ui/Field";
import { BDI_ROLE_CODES, ORGANIZATION_ROLES } from "@/lib/admin";
import { ApiError, api } from "@/lib/api";
import { PREFIXES, ROLE_LABELS, formatThaiDate, type Role } from "@/lib/status";

/** หน่วยงานที่กล่องเชิญถูกล็อกไว้ — เปิดจากหน้าของหน่วยงานนั้นเอง */
export interface LockedOrganization {
  id: string;
  nameTh: string;
}

/**
 * บัญชีที่ยุติการใช้งานแล้วของคนที่กำลังจะถูกเชิญกลับ — มาจาก 409 `cid_deactivated` ของ `POST /api/admin/invitations`
 * หรือจากปุ่ม "เชิญกลับเข้ามา" บนหน้าบัญชีนั้น
 */
export interface ReinviteAccount {
  userAccountId: string;
  displayName: string;
  cid: string;
  currentEmail: string;
  deactivatedAt: string | null;
  formerOrganizationName: string | null;
}

const str = (value: unknown) => (typeof value === "string" ? value : null);

/**
 * กล่อง "เชิญผู้ใช้" — `POST /api/admin/invitations` ที่เคยอยู่ในหน้าคำเชิญรวมอย่างเดียว
 *
 * แยกออกมาเพราะปุ่มเชิญบนหน้าหน่วยงานและหน้าผู้ใช้เคยเป็น**ลิงก์**พามาเปิดกล่องที่หน้าคำเชิญ ส่งเสร็จแล้วผู้ดูแลค้างอยู่
 * หน้านั้นโดยไม่มีทางกลับไปหน่วยงานที่เพิ่งดูอยู่ (การ์ด Issue 2026-10-25) ตอนนี้ทุกหน้าเปิดกล่องนี้ในที่ของตัวเอง
 *
 * `lockedOrganization` — เปิดจากหน้าของหน่วยงาน: ไม่มีตัวเลือกหน่วยงานให้เลือกผิด ชื่อหน่วยงานแสดงเป็นข้อความ และบทบาท
 * เหลือเฉพาะฝั่งหน่วยงาน (เชิญเจ้าหน้าที่ BDI "เข้าหน่วยงาน" ไม่มีความหมาย) ไม่ส่งมา = กล่องเต็มของหน้าคำเชิญรวม
 * ซึ่งยังรับค่าตั้งต้นจาก URL (`?new=1&role=…&organizationId=…`) ที่ `lib/admin-errors.ts` ลิงก์มา
 *
 * **ขั้นที่สอง: เชิญกลับ** (การ์ด "เชิญคนที่เคยยุติไปแล้วกลับมา" 2026-10-31) — ถ้าเลขบัตรเป็นของบัญชีที่ยุติการใช้งานแล้ว
 * API ตอบ 409 `cid_deactivated` กล่องไม่ปิดและไม่ขึ้นเป็นข้อผิดพลาด แต่บอกว่าเป็นใคร เคยอยู่ที่ไหน แล้วถามเหตุผล ปุ่มกลายเป็น
 * "เชิญกลับเข้ามา" ซึ่งเรียก `POST /api/admin/users/:id/reinvite` ด้วยอีเมล บทบาท และหน่วยงานในฟอร์มเดิม — บัญชีเดิมได้อีเมลนี้
 * และเจ้าตัวต้องยืนยัน ThaID อีกครั้งที่ลิงก์ เปลี่ยนเลขบัตรเมื่อไรก็กลับเป็นการเชิญปกติ
 * `reinviteAccount` เปิดกล่องในขั้นนี้ตั้งแต่แรก (ปุ่มบนหน้าบัญชี) เลขบัตรจึงแก้ไม่ได้
 */
export function InviteDialog({
  open,
  initialRole = "",
  initialOrganization = "",
  lockedOrganization,
  reinviteAccount,
  onClose,
  onDone,
}: {
  open: boolean;
  initialRole?: Role | "";
  initialOrganization?: string;
  lockedOrganization?: LockedOrganization;
  reinviteAccount?: ReinviteAccount;
  onClose: () => void;
  onDone: (email: string) => void;
}) {
  const [form, setForm] = useState({ email: "", cid: "", role: "" as Role | "", org: "", prefix: "", first: "", last: "" });
  const [reinvite, setReinvite] = useState<ReinviteAccount | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // แผงขึ้นเหนือฟอร์มขณะที่กล่องเลื่อนลงมาอยู่ที่ปุ่ม — ไม่เลื่อนขึ้นไปให้เห็น ผู้ดูแลจะกด "เชิญกลับ" โดยไม่ได้อ่านว่าเป็นใคร
  useEffect(() => {
    if (reinvite) panelRef.current?.scrollIntoView({ block: "nearest" });
  }, [reinvite]);
  const lockedId = lockedOrganization?.id ?? "";
  const presetCid = reinviteAccount?.cid ?? "";
  useEffect(() => {
    if (open) {
      setForm({
        email: "",
        cid: presetCid,
        role: lockedId ? initialRole || "ORGANIZATION_USER" : initialRole,
        org: lockedId || initialOrganization,
        prefix: "",
        first: "",
        last: "",
      });
      setReinvite(reinviteAccount ?? null);
    }
    // ผูกกับ id ไม่ใช่ object — หน้าที่เรียกสร้าง `lockedOrganization` / `reinviteAccount` ใหม่ทุก render และ effect นี้ล้างฟอร์มทิ้ง
  }, [open, initialRole, initialOrganization, lockedId, presetCid]);
  const scoped = form.role !== "" && ORGANIZATION_ROLES.includes(form.role);
  const ready = /\S+@\S+\.\S+/.test(form.email) && /^\d{13}$/.test(form.cid) && form.role !== "" && (!scoped || form.org);

  return (
    <ActionDialog
      open={open}
      onClose={onClose}
      title={reinvite ? "เชิญกลับเข้ามาในบัญชีเดิม" : lockedOrganization ? "เชิญเข้าหน่วยงานนี้" : "เชิญผู้ใช้"}
      description={
        reinvite
          ? "บัญชีเดิมได้อีเมลที่กรอก แล้วระบบส่งลิงก์ไปที่อีเมลนั้น — บัญชียังปิดอยู่จนเจ้าตัวยืนยันตัวตนด้วย ThaID ให้ตรงเลขบัตรเดิมและตั้งรหัสผ่านใหม่"
          : "ระบบสร้างบัญชีที่รอเปิดใช้งานแล้วส่งลิงก์ไปที่อีเมล — เลขบัตรต้องตรงกับบัตรที่ผู้รับใช้ยืนยันตัวตนกับ ThaID"
      }
      confirmLabel={reinvite ? "เชิญกลับเข้ามา" : "ส่งคำเชิญ"}
      reason={Boolean(reinvite)}
      reasonHint="เหตุผลนี้ถูกบันทึกไว้กับบัญชี เช่น ย้ายมาจากหน่วยงานเดิม"
      canSubmit={Boolean(ready)}
      onConfirm={async (reason) => {
        const target = { role: form.role, ...(scoped ? { organizationId: form.org } : {}) };
        if (reinvite) {
          await api.post(`/api/admin/users/${reinvite.userAccountId}/reinvite`, {
            email: form.email.trim(),
            ...target,
            reason,
          });
          onDone(form.email.trim());
          return;
        }
        try {
          await api.post("/api/admin/invitations", {
            email: form.email.trim(),
            cid: form.cid,
            ...target,
            ...(form.prefix ? { prefixTh: form.prefix } : {}),
            ...(form.first.trim() ? { firstnameTh: form.first.trim() } : {}),
            ...(form.last.trim() ? { lastnameTh: form.last.trim() } : {}),
          });
        } catch (err) {
          if (!(err instanceof ApiError) || err.code !== "cid_deactivated") throw err;
          const d = err.details;
          setReinvite({
            userAccountId: str(d.userAccountId) ?? "",
            displayName: str(d.displayName) ?? "",
            cid: form.cid,
            currentEmail: str(d.currentEmail) ?? "",
            deactivatedAt: str(d.deactivatedAt),
            formerOrganizationName: str(d.formerOrganizationName),
          });
          return false;
        }
        onDone(form.email.trim());
      }}
    >
      {reinvite ? (
        <div ref={panelRef}>
          <ReinvitePanel account={reinvite} />
        </div>
      ) : null}
      {lockedOrganization ? <TextField label="หน่วยงาน" value={lockedOrganization.nameTh} readOnly /> : null}
      <TextField
        label="อีเมล"
        type="email"
        required
        value={form.email}
        onChange={(e) => setForm({ ...form, email: e.target.value })}
        placeholder="name@agency.go.th"
        hint={reinvite ? "อีเมลที่เจ้าตัวใช้อยู่ตอนนี้ — บัญชีเดิมจะเข้าระบบด้วยอีเมลนี้" : undefined}
      />
      <TextField
        label="เลขประจำตัวประชาชน"
        required
        inputMode="numeric"
        maxLength={13}
        value={form.cid}
        readOnly={Boolean(reinviteAccount)}
        onChange={(e) => {
          const cid = e.target.value.replace(/\D/g, "");
          setForm({ ...form, cid });
          // เลขบัตรใหม่คือคนใหม่ — ผลการตรวจของเลขเดิมใช้ไม่ได้แล้ว
          if (reinvite && cid !== reinvite.cid) setReinvite(null);
        }}
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
      {/* บัญชีเดิมมีชื่อจาก ThaID อยู่แล้ว และยืนยันใหม่ที่ลิงก์ — ไม่มีอะไรให้กรอกแทน */}
      {reinvite ? null : (
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
      )}
    </ActionDialog>
  );
}

/** ใครคือเจ้าของเลขบัตรนี้ — ผู้ดูแลต้องเห็นก่อนตัดสินว่าเป็นคนเดิมจริง */
function ReinvitePanel({ account }: { account: ReinviteAccount }) {
  const released = account.currentEmail.endsWith("@invalid.local");
  return (
    <div className="rounded-xl bg-warning-bg px-4 py-3 text-[14px] text-ink">
      <p className="font-semibold">เลขบัตรนี้เป็นของบัญชีที่ยุติการใช้งานแล้ว</p>
      <p className="mt-1">
        {account.displayName || "บัญชีที่ไม่มีชื่อ"}
        {account.formerOrganizationName ? ` — เคยอยู่ ${account.formerOrganizationName}` : ""}
        {account.deactivatedAt ? ` · ยุติเมื่อ ${formatThaiDate(account.deactivatedAt)}` : ""}
      </p>
      <p className="mt-1 text-ink-muted">
        {released
          ? "อีเมลเดิมของบัญชีนี้ถูกถอดออกไปแล้ว"
          : `อีเมลในบัญชีตอนนี้: ${account.currentEmail}`}{" "}
        — ถ้าเป็นคนเดิมที่กลับมา ให้เชิญกลับเข้ามาในบัญชีเดิม ประวัติเดิมอยู่ครบ หนึ่งเลขบัตรมีได้บัญชีเดียวจึงสร้างบัญชีใหม่ไม่ได้
      </p>
    </div>
  );
}
