"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { ActionDialog } from "@/components/console/ActionDialog";
import { DataTable, type Column } from "@/components/console/DataTable";
import { OrganizationPicker } from "@/components/console/OrganizationPicker";
import {
  Badge,
  EmptyState,
  ErrorNotice,
  FilterSelect,
  PageHeader,
  Panel,
  SearchBox,
  Tag,
} from "@/components/console/ui";
import { Button } from "@/components/ui/Button";
import { SelectField, TextField } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import {
  BDI_ROLE_CODES,
  INVITATION_STATUS_META,
  ORGANIZATION_ROLES,
  invitationState,
  type ActivationKeyStatus,
  type AdminInvitation,
} from "@/lib/admin";
import { adminErrorView } from "@/lib/admin-errors";
import { api } from "@/lib/api";
import { PREFIXES, ROLE_LABELS, formatThaiDate, type Role } from "@/lib/status";
import { DEFAULT_PAGE_SIZE } from "@/lib/use-request-list";
import { qs, useAdminData, useUrlFilters } from "@/lib/use-admin";

const FILTERS = ["email", "status", "state", "organizationId", "pageSize", "new", "role"] as const;

type RowAction = { kind: "resend" | "revoke" | "delete"; invitation: AdminInvitation } | null;

/**
 * คำเชิญ (activation key) — Journey A ขั้นที่ 2 ที่เคยเป็น `POST /api/admin/invitations` ใน Postman
 *
 * คำเชิญหนึ่งใบสร้างบัญชี PENDING ก่อนแล้วจึงออกคีย์ (CLAUDE.md, Auth) แถวหนึ่งในตารางนี้จึงเป็นทั้งคำเชิญและบัญชีที่รอ
 * เปิดใช้งาน สามคำสั่งต่อแถวไม่ใช่ตัวเลือกที่ใกล้กัน: **ส่งใหม่** ออกคีย์ใบใหม่ให้บัญชีเดิม **ยกเลิก** ทำให้ลิงก์ใช้ไม่ได้แต่บัญชี
 * และเลขบัตรยังผูกอยู่ **ลบ** เอาคำเชิญออก — และบัญชีด้วยถ้ามันเกิดมาเพราะคำเชิญนี้อย่างเดียว ซึ่งเป็นทางเดียวที่ปลดอีเมล
 * กับเลขบัตรที่กรอกผิดคืน กล่องยืนยันของแต่ละคำสั่งบอกความต่างนี้ตรง ๆ
 */
export default function ConsoleInvitationsPage() {
  const { values, set, page } = useUrlFilters(FILTERS);
  const { show } = useToast();
  const pageSize = Number(values.pageSize) || DEFAULT_PAGE_SIZE;
  const { data, error, loading, reload } = useAdminData<{ invitations: AdminInvitation[]; total: number }>(
    `/api/admin/invitations${qs({
      email: values.email,
      status: values.status,
      state: values.state,
      organizationId: values.organizationId,
      page,
      pageSize,
    })}`,
  );
  const [action, setAction] = useState<RowAction>(null);

  const columns: Column<AdminInvitation>[] = [
    {
      key: "who",
      header: "ผู้รับคำเชิญ",
      cell: (inv) => (
        <div className="min-w-0">
          <Link
            href={`/console/users/${inv.userAccount.id}`}
            onClick={(e) => e.stopPropagation()}
            className="font-medium text-navy-800 hover:underline"
          >
            {inv.userAccount.email}
          </Link>
          <p className="text-[13px] text-ink-muted">เลขบัตร {inv.userAccount.cid ?? "—"}</p>
        </div>
      ),
    },
    {
      key: "role",
      header: "บทบาท / หน่วยงาน",
      cell: (inv) => (
        <div>
          <Tag>{ROLE_LABELS[inv.role.code] ?? inv.role.nameTh}</Tag>
          {inv.organization ? <p className="mt-0.5 text-[13px] text-ink-muted">{inv.organization.nameTh}</p> : null}
        </div>
      ),
    },
    {
      key: "status",
      header: "สถานะ",
      cell: (inv) => (
        <div>
          <Badge meta={INVITATION_STATUS_META[invitationState(inv)]} />
          <p className="mt-1 text-[12.5px] text-ink-muted">
            {inv.usedAt
              ? `ใช้เมื่อ ${formatThaiDate(inv.usedAt)}`
              : inv.revokedAt
                ? `ยกเลิกเมื่อ ${formatThaiDate(inv.revokedAt)}`
                : `หมดอายุ ${formatThaiDate(inv.expiresAt)}`}
          </p>
        </div>
      ),
    },
    {
      key: "actions",
      header: "",
      className: "text-right",
      cell: (inv) => <RowActions invitation={inv} onAction={setAction} />,
    },
  ];

  const close = () => setAction(null);
  const inv = action?.invitation;

  return (
    <div>
      <PageHeader
        eyebrow="บัญชีและสิทธิ์"
        title="คำเชิญ"
        description="ผู้ใช้ทุกคนเข้าระบบด้วยคำเชิญ — ผู้รับกดลิงก์ในอีเมล ยืนยันตัวตนด้วย ThaID แล้วตั้งรหัสผ่าน ลิงก์ใช้ได้ครั้งเดียวและมีวันหมดอายุ"
        actions={<Button size="sm" onClick={() => set({ new: "1" })}>เชิญผู้ใช้</Button>}
      />
      <Panel flush>
        <div className="flex flex-wrap items-center gap-3 border-b border-line p-4">
          <div className="min-w-[240px] flex-1">
            <SearchBox value={values.email} onCommit={(v) => set({ email: v })} placeholder="ค้นหาด้วยอีเมลผู้รับ" />
          </div>
          <FilterSelect
            label="สถานะ"
            value={values.state ? `state:${values.state}` : values.status}
            onChange={(v) =>
              v.startsWith("state:") ? set({ state: v.slice(6), status: "" }) : set({ status: v, state: "" })
            }
            options={[
              ...(Object.keys(INVITATION_STATUS_META) as ActivationKeyStatus[]).map((s) => ({
                value: s,
                label: INVITATION_STATUS_META[s].label,
              })),
              { value: "state:soon", label: "ใกล้หมดอายุ (48 ชม.)" },
              { value: "state:lapsed", label: "เลยกำหนดแต่ยังไม่มีใครกด" },
            ]}
          />
        </div>
        {error ? <ErrorNotice view={adminErrorView(error)} className="m-4" /> : null}
        <DataTable
          columns={columns}
          rows={data?.invitations ?? null}
          rowKey={(i) => i.id}
          loading={loading}
          empty={<EmptyState title="ไม่พบคำเชิญที่ตรงกับตัวกรอง" />}
          page={page}
          pageSize={pageSize}
          total={data?.total}
          onPage={(p) => set({ page: String(p) })}
          onPageSize={(s) => set({ pageSize: String(s) })}
        />
      </Panel>

      <InviteDialog
        open={values.new === "1"}
        initialRole={(values.role as Role) || ""}
        initialOrganization={values.organizationId}
        onClose={() => set({ new: "", role: "" })}
        onDone={(email) => {
          show({ tone: "success", title: "ส่งคำเชิญแล้ว", detail: email });
          reload();
        }}
      />

      <ActionDialog
        open={action?.kind === "resend"}
        onClose={close}
        title="ส่งคำเชิญใหม่"
        description={inv ? `ออกลิงก์ใหม่ไปที่ ${inv.userAccount.email} — ลิงก์เดิมใช้ไม่ได้อีก บัญชี บทบาท และหน่วยงานเหมือนเดิม` : undefined}
        confirmLabel="ส่งคำเชิญใหม่"
        reason={false}
        onConfirm={async () => {
          if (!inv) return;
          await api.post(`/api/admin/invitations/${inv.id}/resend`);
          show({ tone: "success", title: "ส่งคำเชิญใหม่แล้ว", detail: inv.userAccount.email });
          reload();
        }}
      />
      <ActionDialog
        open={action?.kind === "revoke"}
        onClose={close}
        title="ยกเลิกคำเชิญ"
        description="ลิงก์ในอีเมลใช้ไม่ได้อีก แต่บัญชีที่รอเปิดใช้งานยังอยู่ และอีเมลกับเลขบัตรยังผูกกับบัญชีนั้น — ถ้ากรอกผิดและต้องการเชิญใหม่ด้วยค่าเดิม ให้ “ลบ” แทน"
        confirmLabel="ยกเลิกคำเชิญ"
        tone="danger"
        onConfirm={async (reason) => {
          if (!inv) return;
          await api.post(`/api/admin/invitations/${inv.id}/revoke`, { reason });
          show({ tone: "success", title: "ยกเลิกคำเชิญแล้ว" });
          reload();
        }}
      />
      <ActionDialog
        open={action?.kind === "delete"}
        onClose={close}
        title="ลบคำเชิญ"
        description="ลบคำเชิญออกจากระบบ — ถ้าบัญชีที่รอเปิดใช้งานเกิดมาเพราะคำเชิญนี้อย่างเดียว บัญชีก็ถูกลบด้วย อีเมลและเลขบัตรจึงใช้เชิญใหม่ได้ บัญชีที่เปิดใช้งานแล้วลบไม่ได้"
        confirmLabel="ลบคำเชิญ"
        tone="danger"
        reason={false}
        confirmPhrase={inv?.userAccount.email}
        onConfirm={async () => {
          if (!inv) return;
          const res = await api.remove<{ removed: { userAccount: unknown } }>(`/api/admin/invitations/${inv.id}`);
          show({
            tone: "success",
            title: "ลบคำเชิญแล้ว",
            detail: res.removed.userAccount ? "บัญชีที่รอเปิดใช้งานถูกลบด้วย" : "บัญชียังอยู่ เพราะมีสิ่งอื่นผูกอยู่",
          });
          reload();
        }}
      />
    </div>
  );
}

function RowActions({ invitation, onAction }: { invitation: AdminInvitation; onAction: (a: RowAction) => void }) {
  const state = invitationState(invitation);
  const accountActive = invitation.userAccount.status === "ACTIVE";
  const btn = (kind: "resend" | "revoke" | "delete", label: string) => (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onAction({ kind, invitation });
      }}
      className="rounded-full px-2.5 py-1 text-[13px] font-medium text-navy-700 hover:bg-navy-50"
    >
      {label}
    </button>
  );
  return (
    <div className="flex flex-wrap justify-end gap-1">
      {!accountActive && state !== "USED" ? btn("resend", "ส่งใหม่") : null}
      {invitation.status === "ISSUED" && state === "ISSUED" ? btn("revoke", "ยกเลิก") : null}
      {!accountActive ? btn("delete", "ลบ") : null}
    </div>
  );
}

function InviteDialog({
  open,
  initialRole,
  initialOrganization,
  onClose,
  onDone,
}: {
  open: boolean;
  initialRole: Role | "";
  initialOrganization: string;
  onClose: () => void;
  onDone: (email: string) => void;
}) {
  const [form, setForm] = useState({ email: "", cid: "", role: "" as Role | "", org: "", prefix: "", first: "", last: "" });
  useEffect(() => {
    if (open) {
      setForm({ email: "", cid: "", role: initialRole, org: initialOrganization, prefix: "", first: "", last: "" });
    }
  }, [open, initialRole, initialOrganization]);
  const scoped = form.role !== "" && ORGANIZATION_ROLES.includes(form.role);
  const ready = /\S+@\S+\.\S+/.test(form.email) && /^\d{13}$/.test(form.cid) && form.role !== "" && (!scoped || form.org);

  return (
    <ActionDialog
      open={open}
      onClose={onClose}
      title="เชิญผู้ใช้"
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
      </SelectField>
      {scoped ? (
        <>
          <OrganizationPicker value={form.org} onChange={(org) => setForm({ ...form, org })} required />
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

