"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { ErrorNotice, Panel, StatRow } from "@/components/console/ui";
import { ListPageHeader } from "@/components/list/ListPageHeader";
import { OrganizationDatasetTable } from "@/components/statistics/OrganizationDatasetTable";
import { Spinner } from "@/components/ui/Spinner";
import { adminErrorView } from "@/lib/admin-errors";
import { useRequireAuth } from "@/lib/require-auth";
import { formatThaiDate } from "@/lib/status";
import { useAdminData } from "@/lib/use-admin";

/**
 * หน้า "สถิติ" ของผู้ประสานงานและผู้มีอำนาจอนุมัติของ BDI (feedback "features 1 full" แถว 15, 2026-10-27)
 *
 * ผู้ดูแลระบบเห็นชุดเดียวกันบนหน้า ภาพรวม ของ /console จึงไม่มีหน้านี้ในเมนูของเขา ตัวเลขทั้งสองหน้ามาจาก
 * lib/statistics.ts ตัวเดียวกันในฝั่ง API ส่วนชิ้นบนจอ (`Panel`, `StatRow`, ตาราง) ก็ตัวเดียวกัน
 */

const VIEWER_ROLES = ["BDI_OFFICER", "BDI_FINAL_APPROVER", "SYSTEM_ADMINISTRATOR"];

type Counts = Record<string, number>;

interface StatisticsSummary {
  organizations: Counts;
  datasetRequests: Counts;
  generatedAt: string;
}

export default function StatisticsPage() {
  const router = useRouter();
  const { user, loading } = useRequireAuth();
  const allowed = Boolean(user?.roles.some((r) => VIEWER_ROLES.includes(r)));

  useEffect(() => {
    if (!loading && user && !allowed) router.replace("/");
  }, [user, loading, allowed, router]);

  const { data, error } = useAdminData<StatisticsSummary>(allowed ? "/api/statistics/summary" : null);

  if (loading || !user || !allowed) return <Spinner />;

  const org = data?.organizations;
  const req = data?.datasetRequests;
  const sum = (c: Counts | undefined) => (c ? Object.values(c).reduce((a, b) => a + b, 0) : 0);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <ListPageHeader
        tone="organization"
        eyebrow="สถิติ"
        title="สถิติหน่วยงานและชุดข้อมูล"
        description={data ? `ข้อมูล ณ ${formatThaiDate(data.generatedAt)}` : "จำนวนหน่วยงานและคำขอส่งชุดข้อมูลในระบบ"}
      />

      {error && !data ? <ErrorNotice view={adminErrorView(error)} /> : null}

      {org && req ? (
        <div className="grid gap-5 lg:grid-cols-2">
          <Panel title={`หน่วยงาน · ทั้งหมด ${sum(org).toLocaleString("th-TH")}`}>
            <StatRow
              items={[
                { label: "เปิดใช้งาน", value: org.ACTIVE ?? 0 },
                { label: "รอลงทะเบียน", value: org.PENDING_REGISTRATION ?? 0 },
                { label: "ระงับชั่วคราว", value: org.SUSPENDED ?? 0 },
                { label: "ยุติการใช้งาน", value: org.INACTIVE ?? 0 },
              ]}
            />
          </Panel>
          <Panel title={`คำขอส่งชุดข้อมูล · ทั้งหมด ${sum(req).toLocaleString("th-TH")}`}>
            <StatRow
              items={[
                { label: "อนุมัติแล้ว", value: req.APPROVED ?? 0, href: "/admin/datasets?stage=APPROVED" },
                {
                  label: "รอพิจารณา",
                  value: (req.SUBMITTED ?? 0) + (req.UNDER_REVIEW ?? 0),
                  href: "/admin/datasets?tab=all",
                },
                { label: "รอการแก้ไข", value: req.RETURNED ?? 0 },
                { label: "ฉบับร่าง", value: req.DRAFT ?? 0 },
              ]}
            />
            <p className="mt-4 text-[13.5px] text-ink-muted">
              ไม่อนุมัติ {(req.REJECTED ?? 0).toLocaleString("th-TH")} · ยกเลิก{" "}
              {(req.CANCELLED ?? 0).toLocaleString("th-TH")}
            </p>
          </Panel>
        </div>
      ) : null}

      <div className="mt-8">
        <OrganizationDatasetTable />
      </div>
    </div>
  );
}
