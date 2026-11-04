"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { ActionDialog } from "@/components/console/ActionDialog";
import { Panel } from "@/components/console/ui";
import { ChangeStatusBadge } from "@/components/representatives/Shell";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { api } from "@/lib/api";
import type { ChangeRow } from "@/lib/representatives";

/** จำนวนผู้แทนสูงสุดของหน่วยงาน และคำขอเปลี่ยนแปลงผู้แทนของหน่วยงานนี้ */
export function RepresentativePanel({
  organizationId,
  maxUsers,
  maxApprovers,
  onChanged,
}: {
  organizationId: string;
  maxUsers: number;
  maxApprovers: number;
  onChanged: () => void;
}) {
  const { show } = useToast();
  const [open, setOpen] = useState(false);
  const [users, setUsers] = useState(String(maxUsers));
  const [approvers, setApprovers] = useState(String(maxApprovers));
  const [requests, setRequests] = useState<ChangeRow[]>([]);

  const load = useCallback(() => {
    api
      .get<{ requests: ChangeRow[] }>(`/api/admin/representative-changes?organizationId=${organizationId}&pageSize=20`)
      .then((data) => setRequests(data.requests))
      .catch(() => setRequests([]));
  }, [organizationId]);

  useEffect(load, [load]);

  return (
    <Panel
      title="ผู้แทนหน่วยงาน"
      actions={
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            setUsers(String(maxUsers));
            setApprovers(String(maxApprovers));
            setOpen(true);
          }}
        >
          ตั้งจำนวนสูงสุด
        </Button>
      }
    >
      <p className="text-sm">
        ผู้ประสานงานสูงสุด <b>{maxUsers}</b> คน · ผู้มีอำนาจสูงสุด <b>{maxApprovers}</b> คน
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

      <ActionDialog
        open={open}
        onClose={() => setOpen(false)}
        title="ตั้งจำนวนผู้แทนสูงสุด"
        description="ลดต่ำกว่าจำนวนที่มีอยู่ได้ ไม่มีใครถูกถอดออก ค่าใหม่มีผลกับการเชิญและคำขอที่ยืนยันหลังจากนี้"
        confirmLabel="บันทึก"
        canSubmit={Number(users) >= 1 && Number(approvers) >= 1}
        onConfirm={async (reason) => {
          await api.put(`/api/admin/organizations/${organizationId}/representative-limits`, {
            maxOrganizationUserCount: Number(users),
            maxOrganizationApproverCount: Number(approvers),
            reason,
          });
          show({ tone: "success", title: "บันทึกจำนวนผู้แทนแล้ว" });
          onChanged();
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="ผู้ประสานงานสูงสุด" type="number" min={1} value={users} onChange={(e) => setUsers(e.target.value)} />
          <TextField label="ผู้มีอำนาจสูงสุด" type="number" min={1} value={approvers} onChange={(e) => setApprovers(e.target.value)} />
        </div>
      </ActionDialog>
    </Panel>
  );
}
