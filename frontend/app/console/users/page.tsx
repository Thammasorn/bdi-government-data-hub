"use client";

import Link from "next/link";

import { DataTable, type Column } from "@/components/console/DataTable";
import { InviteDialog } from "@/components/console/InviteDialog";
import { OrganizationChip, useOrganizationScope } from "@/components/console/OrganizationScope";
import { Badge, EmptyState, ErrorNotice, FilterSelect, PageHeader, Panel, SearchBox, Tag } from "@/components/console/ui";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { USER_STATUS_META, type AdminUserListItem, type UserAccountStatus } from "@/lib/admin";
import { adminErrorView } from "@/lib/admin-errors";
import { ROLE_LABELS, formatThaiDate, type Role } from "@/lib/status";
import { DEFAULT_PAGE_SIZE } from "@/lib/use-request-list";
import { accountName, qs, useAdminData, useUrlFilters } from "@/lib/use-admin";

const FILTERS = ["q", "status", "role", "organizationId", "pageSize", "new"] as const;

/** 13 หลักล้วนในช่องค้นหา = เลขบัตร — API ค้นเลขบัตรแบบตรงตัวเท่านั้น (`?cid=`) ไม่ใช่ส่วนหนึ่งของชื่อ */
const CID = /^\d{13}$/;

/**
 * ผู้ใช้ทั้งระบบ — `?organizationId=` กรองเฉพาะหน่วยงานหนึ่ง (บทบาทที่ยังใช้งานอยู่เท่านั้น; อดีตสมาชิกอยู่ที่หน้า "สมาชิก"
 * ของหน่วยงานนั้น) และเมื่อกรองอยู่ หัวหน้ามีลิงก์กลับหน่วยงานกับป้ายบอกชื่อ — ก่อนหน้านี้บอกแค่ "เฉพาะหน่วยงานที่เลือก"
 * และปุ่มเชิญพาออกไปหน้าคำเชิญโดยทิ้งหน่วยงานที่กรองอยู่ (การ์ด Issue 2026-10-25) กล่องเชิญเปิดในหน้านี้แล้ว
 */
export default function ConsoleUsersPage() {
  const { values, set, page } = useUrlFilters(FILTERS);
  const { show } = useToast();
  const scope = useOrganizationScope(values.organizationId || null);
  const pageSize = Number(values.pageSize) || DEFAULT_PAGE_SIZE;
  const query = values.q.replace(/[\s-]/g, "");
  const path = `/api/admin/users${qs({
    ...(CID.test(query) ? { cid: query } : { q: values.q }),
    status: values.status,
    role: values.role,
    organizationId: values.organizationId,
    page,
    pageSize,
  })}`;
  const { data, error, loading, reload } = useAdminData<{ users: AdminUserListItem[]; total: number }>(path);

  const columns: Column<AdminUserListItem>[] = [
    {
      key: "name",
      header: "ชื่อ / อีเมล",
      cell: (u) => (
        <div className="min-w-0">
          <Link
            href={`/console/users/${u.id}`}
            onClick={(e) => e.stopPropagation()}
            className="font-medium text-navy-800 hover:underline"
          >
            {accountName(u)}
          </Link>
          <p className="truncate text-[13px] text-ink-muted">{u.email}</p>
        </div>
      ),
    },
    {
      key: "role",
      header: "บทบาท / หน่วยงาน",
      cell: (u) =>
        u.roleAssignments.length === 0 ? (
          <span className="text-[13px] text-ink-subtle">ไม่มีบทบาท</span>
        ) : (
          <div className="space-y-1">
            {u.roleAssignments.map((a) => (
              <div key={a.id}>
                <Tag>{ROLE_LABELS[a.role.code] ?? a.role.code}</Tag>
                {a.organization ? <p className="mt-0.5 text-[13px] text-ink-muted">{a.organization.nameTh}</p> : null}
              </div>
            ))}
          </div>
        ),
    },
    { key: "status", header: "สถานะ", cell: (u) => <Badge meta={USER_STATUS_META[u.status]} /> },
    {
      key: "login",
      header: "เข้าระบบล่าสุด",
      cell: (u) => <span className="text-[13px] text-ink-muted">{u.lastLoginAt ? formatThaiDate(u.lastLoginAt) : "ยังไม่เคย"}</span>,
    },
  ];

  return (
    <div>
      <PageHeader
        back={scope.back ?? undefined}
        eyebrow="หน่วยงานและผู้ใช้"
        title="ผู้ใช้"
        description="ทุกบัญชีในระบบ รวมบัญชีที่ยังรอเปิดใช้งานจากคำเชิญ — กดแถวเพื่อแก้ข้อมูล เปลี่ยนบทบาท หรือระงับบัญชี"
        actions={
          <Button size="sm" onClick={() => set({ new: "1" })}>
            {scope.organization ? "เชิญเข้าหน่วยงานนี้" : "เชิญผู้ใช้"}
          </Button>
        }
      />
      <Panel flush>
        <div className="flex flex-wrap items-center gap-3 border-b border-line p-4">
          <div className="min-w-[240px] flex-1">
            <SearchBox
              value={values.q}
              onCommit={(v) => set({ q: v })}
              placeholder="ค้นหาด้วยอีเมล ชื่อ หรือเลขบัตรประชาชน 13 หลัก"
            />
          </div>
          <FilterSelect
            label="สถานะ"
            value={values.status}
            onChange={(v) => set({ status: v })}
            options={(Object.keys(USER_STATUS_META) as UserAccountStatus[]).map((s) => ({
              value: s,
              label: USER_STATUS_META[s].label,
            }))}
          />
          <FilterSelect
            label="บทบาท"
            value={values.role}
            onChange={(v) => set({ role: v })}
            options={(Object.keys(ROLE_LABELS) as Role[]).map((r) => ({ value: r, label: ROLE_LABELS[r] }))}
          />
          {scope.chipLabel ? <OrganizationChip label={scope.chipLabel} onClear={() => set({ organizationId: "" })} /> : null}
        </div>
        {scope.organization ? (
          <p className="border-b border-line bg-canvas/60 px-5 py-2 text-[13px] text-ink-muted">
            แสดงเฉพาะบัญชีที่ยังมีบทบาทในหน่วยงานนี้ —{" "}
            <Link href={`/console/organizations/${scope.organization.id}/members`} className="font-medium text-navy-700 underline">
              หน้าสมาชิกของหน่วยงาน
            </Link>{" "}
            รวมอดีตสมาชิกที่ถูกถอนบทบาทไปแล้วด้วย
          </p>
        ) : null}
        {error ? <ErrorNotice view={adminErrorView(error)} className="m-4" /> : null}
        <DataTable
          columns={columns}
          rows={data?.users ?? null}
          rowKey={(u) => u.id}
          rowHref={(u) => `/console/users/${u.id}`}
          loading={loading}
          empty={<EmptyState title="ไม่พบบัญชีที่ตรงกับตัวกรอง">ลองล้างตัวกรองหรือค้นด้วยคำอื่น</EmptyState>}
          page={page}
          pageSize={pageSize}
          total={data?.total}
          onPage={(p) => set({ page: String(p) })}
          onPageSize={(s) => set({ pageSize: String(s) })}
        />
      </Panel>

      <InviteDialog
        open={values.new === "1"}
        lockedOrganization={scope.organization ? { id: scope.organization.id, nameTh: scope.organization.nameTh } : undefined}
        onClose={() => set({ new: "" })}
        onDone={(email) => {
          show({ tone: "success", title: "ส่งคำเชิญแล้ว", detail: email });
          reload();
        }}
      />
    </div>
  );
}
