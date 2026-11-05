"use client";

import { Fragment, useEffect, useState } from "react";

import { RepresentativeShell } from "@/components/representatives/Shell";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";
import { api } from "@/lib/api";
import type { Representative, SeatSummary } from "@/lib/representatives";
import { useRequireAuth } from "@/lib/require-auth";
import { isBdiStaff } from "@/lib/status";

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

export default function RepresentativesPage() {
  const { user, loading } = useRequireAuth();
  const [data, setData] = useState<{ summary: SeatSummary[]; representatives: Representative[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<Representative | null>(null);

  useEffect(() => {
    if (loading || !user) return;
    api
      .get<{ summary: SeatSummary[]; representatives: Representative[] }>("/api/representative-changes/representatives")
      .then(setData)
      .catch((err: Error) => setError(err.message));
  }, [user, loading]);

  if (loading || !user) return <Spinner />;
  const showOrganization = isBdiStaff(user.roles);

  return (
    <RepresentativeShell title="รายชื่อผู้แทนหน่วยงาน" description="ผู้มีอำนาจและผู้ประสานงานที่ถือบทบาทหรือมีคำเชิญค้างอยู่">
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {!data && !error ? <Spinner /> : null}
      {data ? (
        <>
          {data.summary.length ? (
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
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-ink-muted">
                  {showOrganization ? <th className="px-4 py-3 font-medium">หน่วยงาน</th> : null}
                  <th className="px-4 py-3 font-medium">คำนำหน้า</th>
                  <th className="px-4 py-3 font-medium">ชื่อ</th>
                  <th className="px-4 py-3 font-medium">นามสกุล</th>
                  <th className="px-4 py-3 font-medium">บทบาท</th>
                  <th className="px-4 py-3 font-medium">สถานะ</th>
                  <th className="px-4 py-3 font-medium">details</th>
                </tr>
              </thead>
              <tbody>
                {data.representatives.map((person) => (
                  <tr key={person.userRoleAssignmentId ?? person.activationKeyId} className="border-b border-line last:border-0">
                    {showOrganization ? <td className="px-4 py-3">{person.organization?.nameTh}</td> : null}
                    <td className="px-4 py-3">{person.prefixTh}</td>
                    <td className="px-4 py-3">{person.firstnameTh}</td>
                    <td className="px-4 py-3">{person.lastnameTh}</td>
                    <td className="px-4 py-3">{person.roleLabel}</td>
                    <td className="px-4 py-3">{statusOf(person)}</td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <button type="button" className="text-navy-700 underline" onClick={() => setViewing(person)}>
                        view detail
                      </button>
                    </td>
                  </tr>
                ))}
                {data.representatives.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-ink-muted">
                      ยังไม่มีผู้แทน
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </Card>
          <PersonDialog person={viewing} onClose={() => setViewing(null)} />
        </>
      ) : null}
    </RepresentativeShell>
  );
}
