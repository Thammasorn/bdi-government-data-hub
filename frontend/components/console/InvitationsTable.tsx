"use client";

import Link from "next/link";
import { useState } from "react";

import { ActionDialog } from "@/components/console/ActionDialog";
import { DataTable, type Column } from "@/components/console/DataTable";
import { Badge, EmptyState, Tag } from "@/components/console/ui";
import { useToast } from "@/components/ui/Toast";
import { INVITATION_STATUS_META, invitationState, type AdminInvitation } from "@/lib/admin";
import { api } from "@/lib/api";
import { ROLE_LABELS, formatThaiDate } from "@/lib/status";

type RowAction = { kind: "resend" | "revoke" | "delete"; invitation: AdminInvitation } | null;

/**
 * ตารางคำเชิญ (activation key) พร้อมสามคำสั่งต่อแถว — ใช้ทั้งหน้าคำเชิญรวมและหน้าคำเชิญของหน่วยงานหนึ่งแห่ง
 *
 * คำเชิญหนึ่งใบสร้างบัญชี PENDING ก่อนแล้วจึงออกคีย์ (CLAUDE.md, Auth) แถวหนึ่งในตารางนี้จึงเป็นทั้งคำเชิญและบัญชีที่รอ
 * เปิดใช้งาน สามคำสั่งต่อแถวไม่ใช่ตัวเลือกที่ใกล้กัน: **ส่งใหม่** ออกคีย์ใบใหม่ให้บัญชีเดิม **ยกเลิก** ทำให้ลิงก์ใช้ไม่ได้แต่บัญชี
 * และเลขบัตรยังผูกอยู่ **ลบ** เอาคำเชิญออก — และบัญชีด้วยถ้ามันเกิดมาเพราะคำเชิญนี้อย่างเดียว ซึ่งเป็นทางเดียวที่ปลดอีเมล
 * กับเลขบัตรที่กรอกผิดคืน กล่องยืนยันของแต่ละคำสั่งบอกความต่างนี้ตรง ๆ
 *
 * `hideOrganization` — บนหน้าของหน่วยงานทุกแถวเป็นหน่วยงานเดียวกัน ไม่ต้องพิมพ์ชื่อซ้ำทุกบรรทัด
 */
export function InvitationsTable({
  invitations,
  total,
  loading,
  page,
  pageSize,
  onPage,
  onPageSize,
  onChanged,
  hideOrganization = false,
  empty = <EmptyState title="ไม่พบคำเชิญที่ตรงกับตัวกรอง" />,
}: {
  invitations: AdminInvitation[] | null;
  total: number | undefined;
  loading: boolean;
  page: number;
  pageSize: number;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
  /** คำสั่งใดสำเร็จ — หน้าโหลดรายการใหม่ */
  onChanged: () => void;
  hideOrganization?: boolean;
  empty?: React.ReactNode;
}) {
  const { show } = useToast();
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
      header: hideOrganization ? "บทบาท" : "บทบาท / หน่วยงาน",
      cell: (inv) => (
        <div>
          <Tag>{ROLE_LABELS[inv.role.code] ?? inv.role.nameTh}</Tag>
          {!hideOrganization && inv.organization ? (
            <p className="mt-0.5 text-[13px] text-ink-muted">{inv.organization.nameTh}</p>
          ) : null}
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
    <>
      <DataTable
        columns={columns}
        rows={invitations}
        rowKey={(i) => i.id}
        loading={loading}
        empty={empty}
        page={page}
        pageSize={pageSize}
        total={total}
        onPage={onPage}
        onPageSize={onPageSize}
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
          onChanged();
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
          onChanged();
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
          onChanged();
        }}
      />
    </>
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
