"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { DataTable, type Column } from "@/components/console/DataTable";
import { useInvitationActions } from "@/components/console/InvitationsTable";
import { Badge, Tag } from "@/components/console/ui";
import {
  INVITATION_STATUS_META,
  USER_STATUS_META,
  invitationState,
  isReleasedEmail,
  type AdminUserListItem,
} from "@/lib/admin";
import { ROLE_LABELS, formatThaiDate } from "@/lib/status";
import { accountName } from "@/lib/use-admin";

type Assignment = AdminUserListItem["roleAssignments"][number];

/**
 * คนหนึ่งคนเป็นอะไรกับหน่วยงานนี้ ตามลำดับที่ตรวจ:
 *
 * - `current` — มีบทบาทที่ใช้งานอยู่ที่นี่ (บัญชีที่**ระงับชั่วคราว**ยังนับ เพราะบทบาทยังอยู่ ป้ายสถานะบัญชีบอกเรื่องนั้นเอง)
 * - `pending` — คำเชิญล่าสุดเข้าที่นี่ยังใช้ได้ คนที่ได้รับเชิญยังไม่มีบทบาท บทบาทเกิดตอนเปิดใช้งาน มาก่อน `former` เพราะอดีต
 *   สมาชิกที่ถูกเชิญกลับเข้ามา ตอนนี้คือคนที่รอเปิดใช้งาน
 * - `former` — เคยมีบทบาทที่นี่แต่ถูกถอนหมดแล้ว (ยุติการใช้งาน ถอนบทบาท หรือย้ายหน่วยงาน)
 * - `lapsed` — ได้รับเชิญเข้าที่นี่แต่ไม่เคยเปิดใช้งาน และคำเชิญหมดอายุหรือถูกยกเลิกไปแล้ว
 *
 * อ่านจากแถวที่ `GET /api/admin/users?organizationId=…&includeFormer=1&includeInvited=1` ส่งมา
 */
export type MembershipState = "current" | "pending" | "former" | "lapsed";

export function membershipOf(user: AdminUserListItem, organizationId: string) {
  const here = user.roleAssignments.filter((a) => a.organization?.id === organizationId);
  const current = here.filter((a) => a.status === "ACTIVE");
  const revoked = here
    .filter((a): a is Assignment & { revokedAt: string } => a.status === "REVOKED" && Boolean(a.revokedAt))
    .sort((a, b) => b.revokedAt.localeCompare(a.revokedAt));
  const elsewhere = user.roleAssignments.filter((a) => a.status === "ACTIVE" && a.organization && a.organization.id !== organizationId);
  const invitation = user.activationKeys?.[0] ?? null;
  const invitationOpen = invitation !== null && invitationState(invitation) === "ISSUED";
  const state: MembershipState =
    current.length > 0
      ? "current"
      : invitationOpen
        ? "pending"
        : here.length > 0
          ? "former"
          : invitation && invitation.status !== "USED"
            ? "lapsed"
            : "former";
  return {
    state,
    current,
    /** แถวที่ถูกถอนล่าสุด — วันที่และเหตุผลที่แสดงใต้ป้าย */
    lastRevoked: revoked[0] ?? null,
    formerRoles: [...new Set(here.map((a) => a.role.code))],
    elsewhere,
    invitation,
  };
}

/**
 * ชื่อกับอีเมลของคนหนึ่ง — อีเมลที่ถูกถอดออกแล้วพิมพ์ว่าถอดแล้ว ไม่พิมพ์ `released+…@invalid.local`
 *
 * ผู้ได้รับเชิญที่ยังไม่เปิดใช้งานมักยังไม่มีชื่อ (`accountName()` คืนอีเมลแทน) บรรทัดล่างจึงบอกว่ายังไม่มีชื่อ แทนการพิมพ์อีเมลซ้ำ
 */
export function PersonCell({ user, href, muted = false }: { user: AdminUserListItem; href?: string; muted?: boolean }) {
  const name = accountName(user);
  const released = isReleasedEmail(user.email);
  const nameless = name === user.email;
  const title = href ? (
    <Link href={href} onClick={(e) => e.stopPropagation()} className="font-medium text-navy-800 hover:underline">
      {name}
    </Link>
  ) : (
    <span className="font-medium text-navy-800">{name}</span>
  );
  return (
    <div className={muted ? "min-w-0 opacity-70" : "min-w-0"}>
      {title}
      <p className="truncate text-[13px] text-ink-muted">
        {released ? "อีเมลถูกถอดออกแล้ว" : nameless ? "ยังไม่มีชื่อ — ได้ชื่อเมื่อเปิดใช้งาน" : user.email}
      </p>
    </div>
  );
}

/**
 * ป้ายสถานะของคนหนึ่งเทียบกับหน่วยงานนี้ — คนที่รอเปิดใช้งานบอกวันหมดอายุของคำเชิญ คนที่คำเชิญตกไปบอกว่าตกไปอย่างไร
 * ที่เหลือคือสถานะของบัญชี
 */
export function MembershipBadge({ m, user }: { m: ReturnType<typeof membershipOf>; user: AdminUserListItem }) {
  if (m.state === "pending" && m.invitation) {
    return (
      <div>
        <Badge meta={INVITATION_STATUS_META.ISSUED} />
        <p className="mt-1 text-[12.5px] text-ink-muted">คำเชิญหมดอายุ {formatThaiDate(m.invitation.expiresAt)}</p>
      </div>
    );
  }
  if (m.state === "lapsed" && m.invitation) {
    const state = invitationState(m.invitation);
    return (
      <div>
        <Badge meta={INVITATION_STATUS_META[state]} />
        <p className="mt-1 text-[12.5px] text-ink-muted">
          {state === "REVOKED" && m.invitation.revokedAt
            ? `คำเชิญถูกยกเลิกเมื่อ ${formatThaiDate(m.invitation.revokedAt)}`
            : `คำเชิญหมดอายุเมื่อ ${formatThaiDate(m.invitation.expiresAt)}`}
        </p>
      </div>
    );
  }
  return <Badge meta={USER_STATUS_META[user.status]} />;
}

/**
 * ตารางสมาชิกและคำเชิญของหน่วยงานหนึ่งแห่ง — หน้า "สมาชิกและคำเชิญ" ของหน่วยงานใน /console
 *
 * หนึ่งแถวคือหนึ่งคน ไม่ใช่หนึ่งคำเชิญ (การ์ด Issue 20261031-04): เดิมสมาชิกกับคำเชิญอยู่คนละหน้า ผู้ดูแลที่ถามว่า "หน่วยงานนี้มี
 * ผู้ประสานงานแล้วหรือยัง" เห็นตารางสมาชิกว่างทั้งที่คำเชิญถึงผู้ประสานงานรออยู่อีกหน้า ตอนนี้คนที่รอเปิดใช้งานอยู่ในตารางเดียว
 * กับสมาชิก พร้อมคำสั่งส่งใหม่ ยกเลิก ลบ ของคำเชิญใบนั้น ประวัติคำเชิญทุกใบของคนหนึ่งดูได้ที่หน้าผู้ใช้ของเขา
 *
 * คอลัมน์บทบาทพูดถึง**หน่วยงานนี้**เท่านั้น อดีตสมาชิกยังอยู่ในตาราง (จางลง ติดป้าย พร้อมวันที่ถอน) — หน่วยงานที่คนถูกยุติไป
 * หมดเคยขึ้นว่าง ๆ เหมือนไม่เคยมีใคร (การ์ด Issue 2026-10-25)
 */
export function MembersTable({
  users,
  organizationId,
  total,
  loading,
  page,
  pageSize,
  onPage,
  onPageSize,
  onChanged,
  empty,
}: {
  users: AdminUserListItem[] | null;
  organizationId: string;
  total: number | undefined;
  loading: boolean;
  page: number;
  pageSize: number;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
  /** คำสั่งของคำเชิญในแถวสำเร็จ — หน้าโหลดรายการใหม่ */
  onChanged: () => void;
  empty: ReactNode;
}) {
  const actions = useInvitationActions(onChanged);

  const columns: Column<AdminUserListItem>[] = [
    {
      key: "name",
      header: "ชื่อ / อีเมล",
      cell: (u) => {
        const m = membershipOf(u, organizationId);
        return <PersonCell user={u} href={`/console/users/${u.id}`} muted={m.state === "former" || m.state === "lapsed"} />;
      },
    },
    {
      key: "role",
      header: "บทบาทในหน่วยงานนี้",
      cell: (u) => {
        const m = membershipOf(u, organizationId);
        if (m.state === "current") {
          return (
            <div className="flex flex-wrap gap-1">
              {m.current.map((a) => (
                <Tag key={a.id}>{ROLE_LABELS[a.role.code] ?? a.role.code}</Tag>
              ))}
            </div>
          );
        }
        if ((m.state === "pending" || m.state === "lapsed") && m.invitation) {
          return (
            <div className="space-y-1">
              <Tag>{ROLE_LABELS[m.invitation.role.code] ?? m.invitation.role.nameTh}</Tag>
              <p className="text-[12.5px] text-ink-subtle">
                {m.state === "pending" ? "ได้รับเชิญ" : "เคยได้รับเชิญ"} {formatThaiDate(m.invitation.issuedAt)}
                {m.state === "pending" && m.lastRevoked ? " · เคยเป็นสมาชิกที่นี่" : ""}
              </p>
            </div>
          );
        }
        if (m.formerRoles.length === 0) return <span className="text-[13px] text-ink-subtle">ไม่มีบทบาท</span>;
        return (
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <Tag className="bg-navy-100/70 text-ink-muted">อดีตสมาชิก</Tag>
              <span className="text-[13px] text-ink-muted">{m.formerRoles.map((r) => ROLE_LABELS[r] ?? r).join(" · ")}</span>
            </div>
            {m.lastRevoked ? (
              <p className="text-[12.5px] text-ink-subtle">
                ถอนบทบาทเมื่อ {formatThaiDate(m.lastRevoked.revokedAt)}
                {m.lastRevoked.revocationReason ? ` — ${m.lastRevoked.revocationReason}` : ""}
              </p>
            ) : null}
            {m.elsewhere.length > 0 ? (
              <p className="text-[12.5px] text-ink-subtle">
                ปัจจุบันอยู่ที่ {[...new Set(m.elsewhere.map((a) => a.organization!.nameTh))].join(", ")}
              </p>
            ) : null}
          </div>
        );
      },
    },
    {
      key: "status",
      header: "สถานะ",
      cell: (u) => <MembershipBadge m={membershipOf(u, organizationId)} user={u} />,
    },
    {
      key: "login",
      header: "เข้าระบบล่าสุด",
      cell: (u) => <span className="text-[13px] text-ink-muted">{u.lastLoginAt ? formatThaiDate(u.lastLoginAt) : "ยังไม่เคย"}</span>,
    },
    {
      key: "actions",
      header: "",
      className: "text-right",
      cell: (u) => {
        const m = membershipOf(u, organizationId);
        if ((m.state !== "pending" && m.state !== "lapsed") || !m.invitation) return null;
        return actions.buttons({
          id: m.invitation.id,
          status: m.invitation.status,
          expiresAt: m.invitation.expiresAt,
          userAccount: { id: u.id, email: u.email, cid: u.cid, status: u.status },
        });
      },
    },
  ];

  return (
    <>
      <DataTable
        columns={columns}
        rows={users}
        rowKey={(u) => u.id}
        rowHref={(u) => `/console/users/${u.id}`}
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
