"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { DataTable, type Column } from "@/components/console/DataTable";
import { Badge, Tag } from "@/components/console/ui";
import { USER_STATUS_META, type AdminUserListItem } from "@/lib/admin";
import { ROLE_LABELS, formatThaiDate } from "@/lib/status";
import { accountName } from "@/lib/use-admin";

type Assignment = AdminUserListItem["roleAssignments"][number];

/**
 * สมาชิกคนหนึ่งเทียบกับหน่วยงานที่กำลังดู — จากแถว assignment ที่ `GET /api/admin/users?organizationId=…&includeFormer=1` ส่งมา
 *
 * "อดีตสมาชิก" = เคยมีบทบาทที่นี่แต่ไม่มีแถวที่ยังใช้งานอยู่เลย (ยุติการใช้งาน ถอนบทบาท หรือย้ายหน่วยงาน) **ระงับชั่วคราว**ไม่นับ
 * เพราะบทบาทยังอยู่ — ป้ายสถานะบัญชีบอกเรื่องนั้นเอง
 */
export function membershipOf(user: AdminUserListItem, organizationId: string) {
  const here = user.roleAssignments.filter((a) => a.organization?.id === organizationId);
  const current = here.filter((a) => a.status === "ACTIVE");
  const revoked = here
    .filter((a): a is Assignment & { revokedAt: string } => a.status === "REVOKED" && Boolean(a.revokedAt))
    .sort((a, b) => b.revokedAt.localeCompare(a.revokedAt));
  const elsewhere = user.roleAssignments.filter((a) => a.status === "ACTIVE" && a.organization && a.organization.id !== organizationId);
  return {
    current,
    former: current.length === 0 && here.length > 0,
    /** แถวที่ถูกถอนล่าสุด — วันที่และเหตุผลที่แสดงใต้ป้าย */
    lastRevoked: revoked[0] ?? null,
    formerRoles: [...new Set(here.map((a) => a.role.code))],
    elsewhere,
  };
}

/**
 * ตารางผู้ใช้ของหน่วยงานหนึ่งแห่ง — หน้า "สมาชิก" ของหน่วยงานใน /console
 *
 * ต่างจากตารางผู้ใช้รวมตรงที่คอลัมน์บทบาทพูดถึง**หน่วยงานนี้**เท่านั้น และแถวของอดีตสมาชิกยังอยู่ในตาราง (จางลง ติดป้าย
 * พร้อมวันที่ถอน) — หน่วยงานที่คนถูกยุติไปหมดเคยขึ้นว่าง ๆ เหมือนไม่เคยมีใคร (การ์ด Issue 2026-10-25)
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
  empty: ReactNode;
}) {
  const columns: Column<AdminUserListItem>[] = [
    {
      key: "name",
      header: "ชื่อ / อีเมล",
      cell: (u) => {
        const m = membershipOf(u, organizationId);
        return (
          <div className={m.former ? "min-w-0 opacity-70" : "min-w-0"}>
            <Link
              href={`/console/users/${u.id}`}
              onClick={(e) => e.stopPropagation()}
              className="font-medium text-navy-800 hover:underline"
            >
              {accountName(u)}
            </Link>
            <p className="truncate text-[13px] text-ink-muted">{u.email}</p>
          </div>
        );
      },
    },
    {
      key: "role",
      header: "บทบาทในหน่วยงานนี้",
      cell: (u) => {
        const m = membershipOf(u, organizationId);
        if (m.former) {
          return (
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <Tag className="bg-navy-100/70 text-ink-muted">อดีตสมาชิก</Tag>
                <span className="text-[13px] text-ink-muted">
                  {m.formerRoles.map((r) => ROLE_LABELS[r] ?? r).join(" · ")}
                </span>
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
        }
        if (m.current.length === 0) return <span className="text-[13px] text-ink-subtle">ไม่มีบทบาท</span>;
        return (
          <div className="flex flex-wrap gap-1">
            {m.current.map((a) => (
              <Tag key={a.id}>{ROLE_LABELS[a.role.code] ?? a.role.code}</Tag>
            ))}
          </div>
        );
      },
    },
    { key: "status", header: "สถานะบัญชี", cell: (u) => <Badge meta={USER_STATUS_META[u.status]} /> },
    {
      key: "login",
      header: "เข้าระบบล่าสุด",
      cell: (u) => <span className="text-[13px] text-ink-muted">{u.lastLoginAt ? formatThaiDate(u.lastLoginAt) : "ยังไม่เคย"}</span>,
    },
  ];

  return (
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
  );
}
