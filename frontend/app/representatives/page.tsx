"use client";

import { Fragment, Suspense, useEffect, useState } from "react";

import { DataTable, EmptyState, type Column } from "@/components/console/DataTable";
import { FilterSelect, Panel, SearchBox } from "@/components/console/ui";
import { RepresentativeShell } from "@/components/representatives/Shell";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";
import { api } from "@/lib/api";
import type { Representative, SeatSummary } from "@/lib/representatives";
import { useRequireAuth } from "@/lib/require-auth";
import { ROLE_LABELS, isBdiStaff } from "@/lib/status";
import { qs, useUrlFilters } from "@/lib/use-admin";

function statusOf(person: Representative) {
  if (person.kind === "INVITED") return "รอเปิดใช้งาน";
  return person.accountStatus === "SUSPENDED" ? "ถูกระงับ" : "ใช้งานอยู่";
}

function statusTone(person: Representative) {
  if (person.kind === "INVITED") return "bg-warning-bg text-warning";
  return person.accountStatus === "SUSPENDED" ? "bg-danger-bg text-danger" : "bg-success-bg text-success";
}

function DetailGroup({ title, rows }: { title: string; rows: [string, string | null | undefined][] }) {
  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold text-navy-800">{title}</h3>
      <dl className="grid grid-cols-[8.5rem_1fr] gap-x-4 gap-y-2 text-sm">
        {rows.map(([label, value]) => (
          <Fragment key={label}>
            <dt className="text-ink-muted">{label}</dt>
            <dd className="break-words text-ink">{value || "–"}</dd>
          </Fragment>
        ))}
      </dl>
    </section>
  );
}

/** ข้อมูลของผู้แทนหนึ่งคน — ไม่แสดงเลขประจำตัวประชาชน และ API ของรายชื่อนี้ก็ไม่ส่งมา */
function PersonDialog({ person, onClose }: { person: Representative | null; onClose: () => void }) {
  const phone = person?.phoneNumber
    ? [person.phoneNumber, person.phoneNumberExtension && `ต่อ ${person.phoneNumberExtension}`].filter(Boolean).join(" ")
    : null;
  return (
    <Modal open={person !== null} onClose={onClose} title={person?.name ?? ""}>
      {person ? (
        <>
          <div className="flex items-start justify-between gap-3 border-b border-line pb-4">
            <div className="min-w-0 text-sm">
              <p className="text-ink">{person.roleLabel}</p>
              {person.organization ? <p className="text-ink-muted">{person.organization.nameTh}</p> : null}
            </div>
            <span className={`inline-flex shrink-0 rounded-full px-3 py-1 text-[13px] font-medium ${statusTone(person)}`}>
              {statusOf(person)}
            </span>
          </div>
          <div className="mt-4 space-y-5">
            <DetailGroup
              title="ข้อมูลการทำงาน"
              rows={[
                ["ตำแหน่ง", person.positionTh],
                ["ฝ่าย/กอง/สำนัก", person.departmentTh],
              ]}
            />
            <DetailGroup
              title="ข้อมูลติดต่อ"
              rows={[
                ["อีเมล", person.email],
                ["เบอร์โทรศัพท์", phone],
              ]}
            />
          </div>
          {person.openRequests.length ? (
            <p className="mt-5 text-sm text-coral-700">อยู่ในคำขอ {person.openRequests.join(", ")} ที่ยังไม่จบ</p>
          ) : null}
        </>
      ) : null}
      <div className="mt-6 flex justify-end">
        <Button variant="secondary" onClick={onClose}>
          ปิด
        </Button>
      </div>
    </Modal>
  );
}

const FILTERS = ["q", "status", "role", "organizationId", "pageSize"] as const;

const ROLE_FILTER = [
  { value: "ORGANIZATION_USER", label: ROLE_LABELS.ORGANIZATION_USER },
  { value: "ORGANIZATION_APPROVER", label: ROLE_LABELS.ORGANIZATION_APPROVER },
];

const STATUS_FILTER = [
  { value: "ACTIVE", label: "ใช้งานอยู่" },
  { value: "SUSPENDED", label: "ถูกระงับ" },
  { value: "INVITED", label: "รอเปิดใช้งาน" },
];

interface Roster {
  summary: SeatSummary[];
  representatives: Representative[];
  organizations: { id: string; nameTh: string }[];
  total: number;
}

export default function RepresentativesPage() {
  // ตัวกรองอ่านจาก query string ผ่าน useSearchParams — ต้องอยู่ใน Suspense ไม่งั้น next build ล้ม
  return (
    <Suspense fallback={<Spinner />}>
      <RepresentativeRoster />
    </Suspense>
  );
}

function RepresentativeRoster() {
  const { user, loading } = useRequireAuth();
  const { values, set, page } = useUrlFilters(FILTERS);
  const [data, setData] = useState<Roster | null>(null);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<Representative | null>(null);
  const pageSize = Number(values.pageSize) || 20;

  useEffect(() => {
    if (loading || !user) return;
    setFetching(true);
    api
      .get<Roster>(`/api/representative-changes/representatives${qs({ ...values, page, pageSize })}`)
      .then(setData)
      .catch((err: Error) => setError(err.message))
      .finally(() => setFetching(false));
  }, [user, loading, values, page, pageSize]);

  if (loading || !user) return <Spinner />;
  const bdi = isBdiStaff(user.roles);

  const columns: Column<Representative>[] = [
    ...(bdi
      ? [{ key: "organization", header: "หน่วยงาน", cell: (p: Representative) => p.organization?.nameTh ?? "—" }]
      : []),
    { key: "prefix", header: "คำนำหน้า", cell: (p) => p.prefixTh ?? "—" },
    { key: "first", header: "ชื่อ", cell: (p) => p.firstnameTh ?? "—" },
    { key: "last", header: "นามสกุล", cell: (p) => p.lastnameTh ?? "—" },
    { key: "role", header: "บทบาท", cell: (p) => p.roleLabel },
    {
      key: "status",
      header: "สถานะ",
      cell: (p) => (
        <span className={`inline-flex rounded-full px-3 py-1 text-[13px] font-medium ${statusTone(p)}`}>{statusOf(p)}</span>
      ),
    },
    {
      key: "details",
      header: "details",
      cell: (p) => (
        <button type="button" className="whitespace-nowrap text-navy-700 underline" onClick={() => setViewing(p)}>
          view detail
        </button>
      ),
    },
  ];

  return (
    <RepresentativeShell title="รายชื่อผู้แทนหน่วยงาน" description="ผู้มีอำนาจและผู้ประสานงานที่ถือบทบาทหรือมีคำเชิญค้างอยู่">
      {error ? <p className="mb-4 text-sm text-danger">{error}</p> : null}
      {data?.summary.length ? (
        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          {data.summary.map((seat) => (
            <Card key={seat.roleCode} className="px-5 py-4">
              <p className="text-sm text-ink-muted">{seat.roleLabel}</p>
              <p className={seat.over ? "text-2xl font-semibold text-danger" : "text-2xl font-semibold text-navy-800"}>
                {seat.current} / {seat.max}
              </p>
              {seat.over ? <p className="text-[13px] text-danger">เกินจำนวนที่กำหนด {seat.current - seat.max} คน</p> : null}
            </Card>
          ))}
        </div>
      ) : null}
      <Panel flush>
        {bdi ? (
          <div className="flex flex-wrap items-center gap-3 border-b border-line p-4">
            <div className="min-w-[240px] flex-1">
              <SearchBox
                value={values.q}
                onCommit={(v) => set({ q: v })}
                placeholder="ค้นหาด้วยชื่อ อีเมล หรือชื่อหน่วยงาน"
              />
            </div>
            <FilterSelect
              label="หน่วยงาน"
              value={values.organizationId}
              onChange={(v) => set({ organizationId: v })}
              options={(data?.organizations ?? []).map((o) => ({ value: o.id, label: o.nameTh }))}
            />
            <FilterSelect label="สถานะ" value={values.status} onChange={(v) => set({ status: v })} options={STATUS_FILTER} />
            <FilterSelect label="บทบาท" value={values.role} onChange={(v) => set({ role: v })} options={ROLE_FILTER} />
          </div>
        ) : null}
        <DataTable
          columns={columns}
          rows={data?.representatives ?? null}
          rowKey={(p) => p.userRoleAssignmentId ?? p.activationKeyId ?? p.userAccountId}
          loading={fetching}
          empty={<EmptyState title="ไม่พบผู้แทนที่ตรงกับตัวกรอง">ลองล้างตัวกรองหรือเปลี่ยนคำค้นหา</EmptyState>}
          page={page}
          pageSize={pageSize}
          total={data?.total}
          onPage={(p) => set({ page: String(p) })}
          onPageSize={(size) => set({ pageSize: String(size) })}
        />
      </Panel>
      <PersonDialog person={viewing} onClose={() => setViewing(null)} />
    </RepresentativeShell>
  );
}
