"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { DataTable, type Column } from "@/components/console/DataTable";
import { OrganizationForm } from "@/components/console/OrganizationForm";
import { EmptyState, ErrorNotice, FilterSelect, PageHeader, Panel, SearchBox } from "@/components/console/ui";
import { Button } from "@/components/ui/Button";
import { OrganizationStatusBadge } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import type { AdminOrganization } from "@/lib/admin";
import { adminErrorView } from "@/lib/admin-errors";
import { ORGANIZATION_STATUS_META, formatThaiDate, type OrganizationStatus } from "@/lib/status";
import { qs, useAdminData, useUrlFilters } from "@/lib/use-admin";

const FILTERS = ["q", "status", "new"] as const;
const BDI_ORGANIZATION_ID = "00000000-0000-0000-0000-0000000000b0";

/**
 * ทะเบียนหน่วยงาน — หน่วยงานเกิดจากผู้ดูแลระบบเท่านั้น (ตัดสินใจ 2026-09-30) แล้วจึงเชิญผู้ประสานงานเข้าไป
 *
 * API คืนสูงสุด 200 แถวไม่แบ่งหน้า ซึ่งเกินจำนวนหน่วยงานที่ระบบมีไปมาก ตารางจึงไม่มีตัวแบ่งหน้า แถวของ BDI เองถูกซ่อน —
 * เป็นแถวของระบบ แก้หรือเปลี่ยนสถานะไม่ได้
 */
export default function ConsoleOrganizationsPage() {
  const router = useRouter();
  const { show } = useToast();
  const { values, set } = useUrlFilters(FILTERS);
  const { data, error, loading } = useAdminData<{ organizations: AdminOrganization[] }>(
    `/api/admin/organizations${qs({ q: values.q, status: values.status })}`,
  );
  const rows = data ? data.organizations.filter((o) => o.id !== BDI_ORGANIZATION_ID) : null;

  const columns: Column<AdminOrganization>[] = [
    {
      key: "name",
      header: "หน่วยงาน",
      cell: (o) => (
        <div className="min-w-0">
          <Link
            href={`/console/organizations/${o.id}`}
            onClick={(e) => e.stopPropagation()}
            className="font-medium text-navy-800 hover:underline"
          >
            {o.nameTh}
          </Link>
          <p className="text-[13px] text-ink-muted">{o.nameEn ?? "—"}</p>
        </div>
      ),
    },
    { key: "code", header: "รหัส", cell: (o) => <span className="font-mono text-[13px]">{o.organizationCode}</span> },
    { key: "province", header: "จังหวัด", cell: (o) => <span className="text-[13.5px]">{o.province ?? "—"}</span> },
    { key: "status", header: "สถานะ", cell: (o) => <OrganizationStatusBadge status={o.status} /> },
    {
      key: "created",
      header: "สร้างเมื่อ",
      cell: (o) => <span className="text-[13px] text-ink-muted">{formatThaiDate(o.createdAt)}</span>,
    },
  ];

  return (
    <div>
      <PageHeader
        eyebrow="หน่วยงานและคำขอ"
        title="หน่วยงาน"
        description="สร้างหน่วยงานก่อนเชิญผู้ประสานงานของหน่วยงานนั้น — ข้อมูลที่กรอกไว้ที่นี่ถูกเติมลงคำขอลงทะเบียนให้หน่วยงานโดยอัตโนมัติ"
        actions={
          <Button size="sm" onClick={() => set({ new: "1" })}>
            สร้างหน่วยงาน
          </Button>
        }
      />
      <Panel flush>
        <div className="flex flex-wrap items-center gap-3 border-b border-line p-4">
          <div className="min-w-[240px] flex-1">
            <SearchBox value={values.q} onCommit={(v) => set({ q: v })} placeholder="ค้นหาด้วยชื่อหรือรหัสหน่วยงาน" />
          </div>
          <FilterSelect
            label="สถานะ"
            value={values.status}
            onChange={(v) => set({ status: v })}
            options={(Object.keys(ORGANIZATION_STATUS_META) as OrganizationStatus[]).map((s) => ({
              value: s,
              label: ORGANIZATION_STATUS_META[s].label,
            }))}
          />
        </div>
        {error ? <ErrorNotice view={adminErrorView(error)} className="m-4" /> : null}
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(o) => o.id}
          rowHref={(o) => `/console/organizations/${o.id}`}
          loading={loading}
          empty={<EmptyState title="ไม่พบหน่วยงานที่ตรงกับตัวกรอง" />}
        />
      </Panel>

      <Modal open={values.new === "1"} onClose={() => set({ new: "" })} title="สร้างหน่วยงาน" size="lg">
        <OrganizationForm
          organization={null}
          onCancel={() => set({ new: "" })}
          onSaved={(org) => {
            show({ tone: "success", title: "สร้างหน่วยงานแล้ว", detail: "เชิญผู้ประสานงานของหน่วยงานได้จากหน้านี้" });
            router.push(`/console/organizations/${org.id}`);
          }}
        />
      </Modal>
    </div>
  );
}
