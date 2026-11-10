"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Panel } from "@/components/console/ui";
import { ChangeStatusBadge } from "@/components/representatives/Shell";
import { api } from "@/lib/api";
import type { ChangeRow, SeatSummary } from "@/lib/representatives";

/**
 * ผู้แทนของหน่วยงานเทียบกับจำนวนสูงสุด และคำขอเปลี่ยนแปลงผู้แทนของหน่วยงานนี้
 *
 * จำนวนสูงสุดเป็นค่าเดียวทั้งระบบตั้งแต่ 2026-11-10 แก้ที่ ตั้งค่าระบบ ไม่ใช่ที่หน่วยงาน — แผงนี้จึงแสดงอย่างเดียว
 * ตัวเลขมาจาก API (`representativeSeats`) เพราะหน่วยงานที่ยังไม่ ACTIVE ใช้ 1 ต่อบทบาท ไม่ใช่ค่าตั้ง
 */
export function RepresentativePanel({ organizationId, seats }: { organizationId: string; seats: SeatSummary[] }) {
  const [requests, setRequests] = useState<ChangeRow[]>([]);

  const load = useCallback(() => {
    api
      .get<{ requests: ChangeRow[] }>(`/api/admin/representative-changes?organizationId=${organizationId}&pageSize=20`)
      .then((data) => setRequests(data.requests))
      .catch(() => setRequests([]));
  }, [organizationId]);

  useEffect(load, [load]);

  return (
    <Panel title="ผู้แทนหน่วยงาน">
      <ul className="space-y-1 text-sm">
        {seats.map((seat) => (
          <li key={seat.roleCode} className={seat.over ? "text-danger" : undefined}>
            {seat.roleLabel} <b>{seat.current}</b> / {seat.max} คน
            {seat.over ? ` — เกินจำนวนสูงสุด ${seat.current - seat.max} คน` : ""}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[13px] text-ink-muted">
        จำนวนสูงสุดใช้ค่าเดียวกันทุกหน่วยงาน แก้ได้ที่{" "}
        <Link className="font-medium text-navy-700 underline" href="/console/settings">
          ตั้งค่าระบบ
        </Link>{" "}
        · หน่วยงานที่ยังไม่เปิดใช้งานมีได้บทบาทละ 1 คน
      </p>
      {requests.length ? (
        <ul className="mt-3 divide-y divide-line text-sm">
          {requests.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <Link className="text-navy-700 underline" href={`/representatives/requests/${row.id}`}>
                {row.requestNumber}
              </Link>
              <ChangeStatusBadge status={row.status} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-ink-muted">ยังไม่มีคำขอเปลี่ยนแปลงผู้แทน</p>
      )}
    </Panel>
  );
}
