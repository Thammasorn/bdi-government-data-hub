"use client";

import { InvitationsTable } from "@/components/console/InvitationsTable";
import { InviteDialog } from "@/components/console/InviteDialog";
import { OrganizationChip, useOrganizationScope } from "@/components/console/OrganizationScope";
import { EmptyState, ErrorNotice, FilterSelect, PageHeader, Panel, SearchBox } from "@/components/console/ui";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { INVITATION_STATUS_META, type ActivationKeyStatus, type AdminInvitation } from "@/lib/admin";
import { adminErrorView } from "@/lib/admin-errors";
import type { Role } from "@/lib/status";
import { DEFAULT_PAGE_SIZE } from "@/lib/use-request-list";
import { qs, useAdminData, useUrlFilters } from "@/lib/use-admin";

const FILTERS = ["email", "status", "state", "organizationId", "pageSize", "new", "role"] as const;

/**
 * คำเชิญ (activation key) ทั้งระบบ — Journey A ขั้นที่ 2 ที่เคยเป็น `POST /api/admin/invitations` ใน Postman
 *
 * ตารางอยู่ใน `InvitationsTable` และกล่องเชิญใน `InviteDialog` หน้านี้เหลือหน้าที่ประกอบตัวกรองกับ URL คำสั่งต่อแถวของคำเชิญ
 * (`useInvitationActions`) ใช้ร่วมกับหน้า "สมาชิกและคำเชิญ" ของหน่วยงาน (`/console/organizations/[id]/members`) ซึ่งแทน
 * หน้าคำเชิญของหน่วยงานที่เคยมีแยก (การ์ด Issue 20261031-04)
 *
 * `?organizationId=` กรองได้เหมือนเดิม (ลิงก์เก่าและ `lib/admin-errors.ts` ยังชี้มา) และตอนนี้**บอก**ว่ากำลังกรองอยู่ พร้อม
 * ลิงก์กลับหน่วยงานนั้น — ก่อนหน้านี้กรองเงียบ ๆ ไม่มีอะไรบนจอบอกเลย
 */
export default function ConsoleInvitationsPage() {
  const { values, set, page } = useUrlFilters(FILTERS);
  const { show } = useToast();
  const scope = useOrganizationScope(values.organizationId || null);
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

  return (
    <div>
      <PageHeader
        back={scope.back ?? undefined}
        eyebrow="หน่วยงานและผู้ใช้"
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
          {scope.chipLabel ? <OrganizationChip label={scope.chipLabel} onClear={() => set({ organizationId: "" })} /> : null}
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
          empty={<EmptyState title="ไม่พบคำเชิญที่ตรงกับตัวกรอง" />}
        />
      </Panel>

      <InviteDialog
        open={values.new === "1"}
        initialRole={(values.role as Role) || ""}
        initialOrganization={values.organizationId}
        lockedOrganization={scope.organization ? { id: scope.organization.id, nameTh: scope.organization.nameTh } : undefined}
        onClose={() => set({ new: "", role: "" })}
        onDone={(email) => {
          show({ tone: "success", title: "ส่งคำเชิญแล้ว", detail: email });
          reload();
        }}
      />
    </div>
  );
}
