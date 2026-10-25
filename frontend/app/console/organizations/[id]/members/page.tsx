"use client";

import { useParams } from "next/navigation";

import { InviteDialog } from "@/components/console/InviteDialog";
import { MembersTable } from "@/components/console/MembersTable";
import { useOrganizationScope } from "@/components/console/OrganizationScope";
import { EmptyState, ErrorNotice, FilterSelect, PageHeader, Panel, SearchBox } from "@/components/console/ui";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { USER_STATUS_META, type AdminUserListItem, type UserAccountStatus } from "@/lib/admin";
import { adminErrorView } from "@/lib/admin-errors";
import { DEFAULT_PAGE_SIZE } from "@/lib/use-request-list";
import { qs, useAdminData, useUrlFilters } from "@/lib/use-admin";

const FILTERS = ["q", "status", "new", "pageSize"] as const;

/** 13 หลักล้วนในช่องค้นหา = เลขบัตร — เหมือนหน้าผู้ใช้รวม */
const CID = /^\d{13}$/;

/**
 * สมาชิกของหน่วยงานหนึ่งแห่ง — หน้าย่อยของ `/console/organizations/[id]`
 *
 * แทนที่ลิงก์ "ดูในรายชื่อผู้ใช้" ที่พาออกไปหน้าผู้ใช้รวมแล้วกรองด้วยหน่วยงาน ซึ่งไม่มีทางกลับและซ่อนอดีตสมาชิกไว้ (การ์ด Issue
 * 2026-10-25) หน้านี้อยู่ใต้หน่วยงาน มีลิงก์กลับ รวมอดีตสมาชิก (`includeFormer=1`) และกล่องเชิญเปิดในหน้าโดยล็อกหน่วยงานไว้
 */
export default function OrganizationMembersPage() {
  const { id } = useParams<{ id: string }>();
  const scope = useOrganizationScope(id);
  const { values, set, page } = useUrlFilters(FILTERS);
  const { show } = useToast();
  const pageSize = Number(values.pageSize) || DEFAULT_PAGE_SIZE;
  const query = values.q.replace(/[\s-]/g, "");
  const { data, error, loading, reload } = useAdminData<{ users: AdminUserListItem[]; total: number }>(
    `/api/admin/users${qs({
      organizationId: id,
      includeFormer: "1",
      ...(CID.test(query) ? { cid: query } : { q: values.q }),
      status: values.status,
      page,
      pageSize,
    })}`,
  );

  if (scope.error && !scope.organization) {
    return (
      <div>
        <PageHeader title="ไม่พบหน่วยงาน" back={{ href: "/console/organizations", label: "หน่วยงานทั้งหมด" }} />
        <ErrorNotice view={adminErrorView(scope.error)} />
      </div>
    );
  }
  const org = scope.organization;

  return (
    <div>
      <PageHeader
        back={scope.back ?? undefined}
        eyebrow={org ? `${org.nameTh} · ${org.organizationCode}` : "หน่วยงาน"}
        title="สมาชิก"
        description="ทุกบัญชีที่สังกัดหน่วยงานนี้ รวมบัญชีที่รอเปิดใช้งานจากคำเชิญ และอดีตสมาชิกที่ถูกถอนบทบาทไปแล้ว — กดแถวเพื่อดูหรือแก้บัญชี"
        actions={
          <Button size="sm" onClick={() => set({ new: "1" })} disabled={!org}>
            เชิญเข้าหน่วยงานนี้
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
            label="สถานะบัญชี"
            value={values.status}
            onChange={(v) => set({ status: v })}
            options={(Object.keys(USER_STATUS_META) as UserAccountStatus[]).map((s) => ({
              value: s,
              label: USER_STATUS_META[s].label,
            }))}
          />
        </div>
        {error ? <ErrorNotice view={adminErrorView(error)} className="m-4" /> : null}
        <MembersTable
          users={data?.users ?? null}
          organizationId={id}
          total={data?.total}
          loading={loading}
          page={page}
          pageSize={pageSize}
          onPage={(p) => set({ page: String(p) })}
          onPageSize={(s) => set({ pageSize: String(s) })}
          empty={
            values.q || values.status ? (
              <EmptyState title="ไม่พบบัญชีที่ตรงกับตัวกรอง">ลองล้างตัวกรองหรือค้นด้วยคำอื่น</EmptyState>
            ) : (
              <EmptyState title="ยังไม่มีสมาชิก">เชิญผู้ประสานงานของหน่วยงานเพื่อให้เริ่มยื่นคำขอลงทะเบียนได้</EmptyState>
            )
          }
        />
      </Panel>

      {org ? (
        <InviteDialog
          open={values.new === "1"}
          lockedOrganization={{ id: org.id, nameTh: org.nameTh }}
          onClose={() => set({ new: "" })}
          onDone={(email) => {
            show({ tone: "success", title: "ส่งคำเชิญแล้ว", detail: email });
            reload();
          }}
        />
      ) : null}
    </div>
  );
}
