"use client";

import { useEffect, useState } from "react";

import { RepresentativeShell } from "@/components/representatives/Shell";
import { Card } from "@/components/ui/Card";
import { Spinner } from "@/components/ui/Spinner";
import { api } from "@/lib/api";
import type { Representative, SeatSummary } from "@/lib/representatives";
import { useRequireAuth } from "@/lib/require-auth";
import { isBdiStaff } from "@/lib/status";

function statusOf(person: Representative) {
  if (person.kind === "INVITED") return "รอเปิดใช้งาน";
  return person.accountStatus === "SUSPENDED" ? "ถูกระงับ" : "ใช้งานอยู่";
}

export default function RepresentativesPage() {
  const { user, loading } = useRequireAuth();
  const [data, setData] = useState<{ summary: SeatSummary[]; representatives: Representative[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

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
                    <td className="px-4 py-3 text-ink-muted">
                      {[person.positionTh, person.departmentTh].filter(Boolean).join(" · ") || "–"}
                      {person.openRequests.length ? (
                        <p className="text-[13px]">อยู่ในคำขอ {person.openRequests.join(", ")}</p>
                      ) : null}
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
        </>
      ) : null}
    </RepresentativeShell>
  );
}
