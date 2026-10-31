"use client";

import Link from "next/link";
import { useState } from "react";

import { ActionDialog } from "@/components/console/ActionDialog";
import { DataTable, type Column } from "@/components/console/DataTable";
import { Badge, EmptyState, Tag } from "@/components/console/ui";
import { useToast } from "@/components/ui/Toast";
import {
  INVITATION_STATUS_META,
  USER_STATUS_META,
  invitationState,
  isReleasedEmail,
  type AdminInvitation,
} from "@/lib/admin";
import { api } from "@/lib/api";
import { ROLE_LABELS, formatThaiDate } from "@/lib/status";

type InvitationTarget = Pick<AdminInvitation, "id" | "status" | "expiresAt" | "userAccount">;
type RowAction = { kind: "resend" | "revoke" | "delete"; invitation: InvitationTarget } | null;

/**
 * คำสั่งสามอย่างของคำเชิญหนึ่งใบ — ส่งใหม่ ยกเลิก ลบ — พร้อมกล่องยืนยันของแต่ละคำสั่ง
 *
 * ตารางคำเชิญรวมกับตารางสมาชิกของหน่วยงานใช้ชุดเดียวกัน คำอธิบายในกล่องยืนยันจึงมีที่เดียว คำเชิญหนึ่งใบสร้างบัญชี PENDING
 * ก่อนแล้วจึงออกคีย์ (CLAUDE.md, Auth) และสามคำสั่งไม่ใช่ตัวเลือกที่ใกล้กัน: **ส่งใหม่** ออกคีย์ใบใหม่ให้บัญชีเดิม **ยกเลิก**
 * ทำให้ลิงก์ใช้ไม่ได้แต่บัญชีและเลขบัตรยังผูกอยู่ **ลบ** เอาคำเชิญออก — และบัญชีด้วยถ้ามันเกิดมาเพราะคำเชิญนี้อย่างเดียว
 * ซึ่งเป็นทางเดียวที่ปลดอีเมลกับเลขบัตรที่กรอกผิดคืน กล่องยืนยันของแต่ละคำสั่งบอกความต่างนี้ตรง ๆ
 *
 * `buttons(inv)` วางในแถว `dialogs` วางครั้งเดียวในหน้า
 */
export function useInvitationActions(onChanged: () => void) {
  const { show } = useToast();
  const [action, setAction] = useState<RowAction>(null);
  const close = () => setAction(null);
  const inv = action?.invitation;

  const buttons = (invitation: InvitationTarget) => {
    const state = invitationState(invitation);
    const accountActive = invitation.userAccount.status === "ACTIVE";
    const btn = (kind: "resend" | "revoke" | "delete", label: string) => (
      <button
        key={kind}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setAction({ kind, invitation });
        }}
        className="rounded-full px-2.5 py-1 text-[13px] font-medium text-navy-700 hover:bg-navy-50"
      >
        {label}
      </button>
    );
    const shown = [
      !accountActive && state !== "USED" ? btn("resend", "ส่งใหม่") : null,
      invitation.status === "ISSUED" && state === "ISSUED" ? btn("revoke", "ยกเลิก") : null,
      !accountActive ? btn("delete", "ลบ") : null,
    ].filter(Boolean);
    if (shown.length === 0) return null;
    return <div className="flex flex-wrap justify-end gap-1">{shown}</div>;
  };

  const dialogs = (
    <>
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

  return { buttons, dialogs };
}

/**
 * ตารางคำเชิญ (activation key) ทั้งระบบ — หน้าคำเชิญรวม `/console/invitations`
 *
 * หน่วยงานหนึ่งแห่งไม่มีตารางนี้แล้ว คำเชิญของหน่วยงานอยู่ในแถวของคนในหน้า "สมาชิกและคำเชิญ" (`MembersTable`, การ์ด Issue
 * 20261031-04) เพราะคำถามที่ผู้ดูแลถามที่นั่นคือ "ใครอยู่ ใครกำลังจะเข้า" ไม่ใช่ "ลิงก์ใบไหนถูกใช้"
 *
 * สถานะของแถวคือสถานะของ**ลิงก์** `USED` แปลว่าลิงก์ถูกใช้เปิดบัญชีแล้วเท่านั้น ถ้าบัญชีถูกระงับหรือยุติภายหลัง ตารางแสดง
 * สถานะของบัญชีแทน ไม่งั้นบัญชีที่ยุติไปแล้วยังขึ้น "เปิดใช้งานแล้ว" สีเขียว
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
  empty?: React.ReactNode;
}) {
  const actions = useInvitationActions(onChanged);

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
            {isReleasedEmail(inv.userAccount.email) ? <span className="text-ink-muted">อีเมลถูกถอดออกแล้ว</span> : inv.userAccount.email}
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
      cell: (inv) => {
        const state = invitationState(inv);
        const accountGone = state === "USED" && inv.userAccount.status !== "ACTIVE";
        return (
          <div>
            <Badge meta={accountGone ? USER_STATUS_META[inv.userAccount.status] : INVITATION_STATUS_META[state]} />
            <p className="mt-1 text-[12.5px] text-ink-muted">
              {inv.usedAt
                ? `${accountGone ? "เปิดใช้งานเมื่อ" : "ใช้เมื่อ"} ${formatThaiDate(inv.usedAt)}`
                : inv.revokedAt
                  ? `ยกเลิกเมื่อ ${formatThaiDate(inv.revokedAt)}`
                  : `หมดอายุ ${formatThaiDate(inv.expiresAt)}`}
            </p>
          </div>
        );
      },
    },
    {
      key: "actions",
      header: "",
      className: "text-right",
      cell: (inv) => actions.buttons(inv),
    },
  ];

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
      {actions.dialogs}
    </>
  );
}
