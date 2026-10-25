"use client";

import { useParams } from "next/navigation";

import { InvitationsTable } from "@/components/console/InvitationsTable";
import { InviteDialog } from "@/components/console/InviteDialog";
import { useOrganizationScope } from "@/components/console/OrganizationScope";
import { EmptyState, ErrorNotice, FilterSelect, PageHeader, Panel, SearchBox } from "@/components/console/ui";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { INVITATION_STATUS_META, type ActivationKeyStatus, type AdminInvitation } from "@/lib/admin";
import { adminErrorView } from "@/lib/admin-errors";
import { DEFAULT_PAGE_SIZE } from "@/lib/use-request-list";
import { qs, useAdminData, useUrlFilters } from "@/lib/use-admin";

const FILTERS = ["email", "status", "state", "new", "pageSize"] as const;

/**
 * คำเชิญของหน่วยงานหนึ่งแห่ง — หน้าย่อยของ `/console/organizations/[id]` ตารางและคำสั่งเดียวกับหน้าคำเชิญรวม
 * (`InvitationsTable`) แต่เห็นเฉพาะหน่วยงานนี้ มีลิงก์กลับ และกล่องเชิญล็อกหน่วยงานไว้ (การ์ด Issue 2026-10-25)
 */
export default function OrganizationInvitationsPage() {
  const { id } = useParams<{ id: string }>();
  const scope = useOrganizationScope(id);
  const { values, set, page } = useUrlFilters(FILTERS);
  const { show } = useToast();
  const pageSize = Number(values.pageSize) || DEFAULT_PAGE_SIZE;
  const { data, error, loading, reload } = useAdminData<{ invitations: AdminInvitation[]; total: number }>(
    `/api/admin/invitations${qs({
      organizationId: id,
      email: values.email,
      status: values.status,
      state: values.state,
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
        title="คำเชิญ"
        description="คำเชิญทุกใบที่ออกให้หน่วยงานนี้ — ผู้รับกดลิงก์ในอีเมล ยืนยันตัวตนด้วย ThaID แล้วตั้งรหัสผ่าน ลิงก์ใช้ได้ครั้งเดียวและมีวันหมดอายุ"
        actions={
          <Button size="sm" onClick={() => set({ new: "1" })} disabled={!org}>
            เชิญเข้าหน่วยงานนี้
          </Button>
        }
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
        <InvitationsTable
          invitations={data?.invitations ?? null}
          total={data?.total}
          loading={loading}
          page={page}
          pageSize={pageSize}
          onPage={(p) => set({ page: String(p) })}
          onPageSize={(s) => set({ pageSize: String(s) })}
          onChanged={reload}
          hideOrganization
          empty={
            values.email || values.status || values.state ? (
              <EmptyState title="ไม่พบคำเชิญที่ตรงกับตัวกรอง" />
            ) : (
              <EmptyState title="ยังไม่มีคำเชิญ">เชิญผู้ประสานงานของหน่วยงานเพื่อให้เริ่มยื่นคำขอลงทะเบียนได้</EmptyState>
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
