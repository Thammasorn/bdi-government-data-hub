"use client";

import Link from "next/link";

import { ButtonLink, ErrorNotice, PageHeader, Panel, StatRow, Tile } from "@/components/console/ui";
import { OrganizationDatasetTable } from "@/components/statistics/OrganizationDatasetTable";
import { Spinner } from "@/components/ui/Spinner";
import type { AdminSummary } from "@/lib/admin";
import { adminErrorView } from "@/lib/admin-errors";
import { formatThaiDate } from "@/lib/status";
import { useAdminData } from "@/lib/use-admin";

/**
 * หน้าแรกของ /console — "มีอะไรรอผู้ดูแลอยู่บ้าง" ก่อน "ระบบมีอะไรอยู่บ้าง"
 *
 * แถวบนสุดคือสิ่งที่ต้องลงมือ (คำเชิญที่หมดอายุแล้วยังไม่มีใครส่งใหม่ คำเชิญใกล้หมดอายุ อีเมลที่ส่งไม่ออก) ตัวเลขที่เป็นศูนย์
 * จางลงเพื่อให้ตัวที่ไม่ใช่ศูนย์เด่น ทุกตัวเลขกดได้และพาไปรายการที่กรองไว้แล้ว — ตัวเลขที่กดไม่ได้บนหน้าแบบนี้คือทางตัน
 */
export default function ConsoleHomePage() {
  const { data, error, loading } = useAdminData<AdminSummary>("/api/admin/summary");

  if (loading && !data) return <Spinner />;
  if (error && !data) return <ErrorNotice view={adminErrorView(error)} />;
  if (!data) return null;

  const pendingOrgReq = data.organizationRequests.SUBMITTED + data.organizationRequests.UNDER_REVIEW;
  const pendingDatasetReq = data.datasetRequests.SUBMITTED + data.datasetRequests.UNDER_REVIEW;

  return (
    <div>
      <PageHeader
        eyebrow="ผู้ดูแลระบบ"
        title="ภาพรวมระบบ"
        description={`ข้อมูล ณ ${formatThaiDate(data.generatedAt)}`}
        actions={
          <>
            <ButtonLink href="/console/organizations?new=1" variant="secondary">
              สร้างหน่วยงาน
            </ButtonLink>
            <ButtonLink href="/console/invitations?new=1">เชิญผู้ใช้</ButtonLink>
          </>
        }
      />

      <h2 className="mb-3 text-[15px] font-semibold text-navy-800">รอผู้ดูแลระบบดำเนินการ</h2>
      <div className="grid gap-3 sm:grid-cols-3">
        <Tile
          href="/console/invitations?state=lapsed"
          value={data.invitations.lapsed}
          label="คำเชิญหมดอายุแล้ว"
          hint="ผู้รับยังไม่ได้เปิดใช้งาน — ส่งคำเชิญใหม่"
          tone="alert"
        />
        <Tile
          href="/console/invitations?state=soon"
          value={data.invitations.expiringSoon}
          label="คำเชิญใกล้หมดอายุ"
          hint="ภายใน 48 ชั่วโมง"
          tone="warn"
        />
        <Tile
          value={data.deadLetters}
          label="อีเมลที่ส่งไม่สำเร็จ"
          hint="เกินจำนวนครั้งที่ลองส่งใหม่ ตรวจได้จากบันทึกของระบบ"
          tone="alert"
        />
      </div>

      <div className="mt-8 grid gap-5 lg:grid-cols-2">
        <Panel title="หน่วยงาน" actions={<SeeAll href="/console/organizations" />}>
          <StatRow
            items={[
              { label: "เปิดใช้งาน", value: data.organizations.ACTIVE, href: "/console/organizations?status=ACTIVE" },
              {
                label: "รอลงทะเบียน",
                value: data.organizations.PENDING_REGISTRATION,
                href: "/console/organizations?status=PENDING_REGISTRATION",
              },
              {
                label: "ระงับชั่วคราว",
                value: data.organizations.SUSPENDED,
                href: "/console/organizations?status=SUSPENDED",
              },
              { label: "ยุติการใช้งาน", value: data.organizations.INACTIVE, href: "/console/organizations?status=INACTIVE" },
            ]}
          />
        </Panel>

        <Panel title="บัญชีผู้ใช้" actions={<SeeAll href="/console/users" />}>
          <StatRow
            items={[
              { label: "ใช้งานอยู่", value: data.users.ACTIVE, href: "/console/users?status=ACTIVE" },
              { label: "รอเปิดใช้งาน", value: data.users.PENDING, href: "/console/users?status=PENDING" },
              { label: "ระงับชั่วคราว", value: data.users.SUSPENDED, href: "/console/users?status=SUSPENDED" },
              { label: "ยุติการใช้งาน", value: data.users.DEACTIVATED, href: "/console/users?status=DEACTIVATED" },
            ]}
          />
          <p className="mt-4 text-[13.5px] text-ink-muted">
            คำเชิญที่ยังใช้ได้ {data.invitations.usable} ฉบับ —{" "}
            <Link href="/console/invitations?status=ISSUED" className="font-medium text-navy-700 underline">
              ดูคำเชิญ
            </Link>
          </p>
        </Panel>

        <Panel title="คำขอลงทะเบียนหน่วยงาน" actions={<SeeAll href="/console/registrations/organizations" />}>
          <StatRow
            items={[
              { label: "รอพิจารณา", value: pendingOrgReq, href: "/console/registrations/organizations?scope=all" },
              { label: "รอการแก้ไข", value: data.organizationRequests.RETURNED },
              { label: "ฉบับร่าง", value: data.organizationRequests.DRAFT },
              { label: "อนุมัติแล้ว", value: data.organizationRequests.APPROVED },
            ]}
          />
        </Panel>

        <Panel title="คำขอส่งชุดข้อมูล" actions={<SeeAll href="/console/registrations/datasets" />}>
          <StatRow
            items={[
              { label: "รอพิจารณา", value: pendingDatasetReq, href: "/console/registrations/datasets?scope=all" },
              { label: "รอการแก้ไข", value: data.datasetRequests.RETURNED },
              { label: "ฉบับร่าง", value: data.datasetRequests.DRAFT },
              { label: "อนุมัติแล้ว", value: data.datasetRequests.APPROVED },
            ]}
          />
        </Panel>
      </div>

      {/* ตารางเดียวกับหน้า "สถิติ" ของ BDI — ผู้ดูแลระบบไม่มีหน้าแยก ดูจากที่นี่ (feedback "features 1 full" แถว 15) */}
      <div className="mt-8">
        <OrganizationDatasetTable />
      </div>
    </div>
  );
}

function SeeAll({ href }: { href: string }) {
  return (
    <Link href={href} className="text-[13.5px] font-medium text-navy-700 hover:underline">
      ดูทั้งหมด →
    </Link>
  );
}
