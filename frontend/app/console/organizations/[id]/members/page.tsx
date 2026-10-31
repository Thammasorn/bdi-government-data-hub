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
 * สมาชิกและคำเชิญของหน่วยงานหนึ่งแห่ง — หน้าย่อยของ `/console/organizations/[id]`
 *
 * หน้าเดียวที่ตอบว่า "ใครอยู่ ใครกำลังจะเข้า ใครเคยอยู่": สมาชิกที่ใช้งานอยู่ คนที่ได้รับเชิญและรอเปิดใช้งาน คนที่คำเชิญหมดอายุ
 * หรือถูกยกเลิก และอดีตสมาชิก (`includeFormer=1&includeInvited=1`) หนึ่งแถวคือหนึ่งคน คำสั่งของคำเชิญอยู่ในแถวของคนนั้น
 *
 * เดิมคำเชิญมีหน้าแยก (`/invitations`, ตอนนี้พามาที่นี่) และผู้ได้รับเชิญยังไม่มีบทบาทจนกว่าจะเปิดใช้งาน จึงไม่ขึ้นในตาราง
 * สมาชิกเลย ผู้ดูแลเห็น "ไม่มีสมาชิก" ทั้งที่ส่งคำเชิญถึงผู้ประสานงานไปแล้ว (การ์ด Issue 20261031-04) หน้านี้แทนลิงก์
 * "ดูในรายชื่อผู้ใช้" ที่พาออกไปหน้าผู้ใช้รวมแล้วไม่มีทางกลับ (การ์ด Issue 2026-10-25) และกล่องเชิญเปิดในหน้าโดยล็อกหน่วยงานไว้
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
      includeInvited: "1",
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
        title="สมาชิกและคำเชิญ"
        description="ทุกคนที่เกี่ยวกับหน่วยงานนี้ในตารางเดียว — สมาชิกที่ใช้งานอยู่ คนที่ได้รับเชิญและรอเปิดใช้งาน คนที่คำเชิญหมดอายุหรือถูกยกเลิก และอดีตสมาชิก ส่งคำเชิญใหม่ ยกเลิก หรือลบได้จากแถวของคนนั้น กดแถวเพื่อดูบัญชีและประวัติคำเชิญทุกใบ"
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
          onChanged={reload}
          empty={
            values.q || values.status ? (
              <EmptyState title="ไม่พบบัญชีที่ตรงกับตัวกรอง">ลองล้างตัวกรองหรือค้นด้วยคำอื่น</EmptyState>
            ) : (
              <EmptyState title="ยังไม่มีสมาชิกหรือคำเชิญ">เชิญผู้ประสานงานของหน่วยงานเพื่อให้เริ่มยื่นคำขอลงทะเบียนได้</EmptyState>
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
