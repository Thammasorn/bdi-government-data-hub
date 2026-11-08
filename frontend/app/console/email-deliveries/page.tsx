"use client";

import Link from "next/link";
import { useState } from "react";

import { ActionDialog } from "@/components/console/ActionDialog";
import { DataTable, type Column } from "@/components/console/DataTable";
import { DeliveryChip } from "@/components/console/DeliveryChip";
import { useDeliveryTracker } from "@/components/console/DeliveryTracker";
import { EmptyState, ErrorNotice, FilterSelect, PageHeader, Panel, SearchBox } from "@/components/console/ui";
import { Button } from "@/components/ui/Button";
import { adminErrorView } from "@/lib/admin-errors";
import { api } from "@/lib/api";
import { DELIVERY_STATE_META, type DeliveryState, type DeliveryView } from "@/lib/deliveries";
import { formatThaiDate } from "@/lib/status";
import { qs, useAdminData, useUrlFilters } from "@/lib/use-admin";

const FILTERS = ["state", "type", "q", "pageSize"] as const;
const DEFAULT_PAGE_SIZE = 25;

/** ใครต้องแก้ — คำเดียวกับตารางในการ์ด ข้อ 3.4 */
const FIXED_BY: Record<string, string> = {
  admin: "ผู้ดูแลระบบ",
  it: "ฝ่าย IT",
  none: "ไม่ต้องทำอะไร",
  user: "ผู้ใช้",
};

/**
 * ประวัติการส่งอีเมล — อีเมลทุกฉบับที่ระบบส่ง (การ์ด "[Enhance] Send every email through the delivery worker" ข้อ 3.3)
 *
 * ตัวกรองอยู่ใน URL ให้ tile บนหน้าภาพรวมลิงก์มาที่ "ส่งไม่สำเร็จ" ได้ตรง ๆ ส่งอีกครั้ง: อีเมลทั่วไปเข้าคิวใหม่ได้ทันที ส่วนคำเชิญกับลิงก์
 * ตั้งรหัสผ่านต้องออกคีย์/ลิงก์ใบใหม่ จึงพาไปที่ปุ่มของมัน (secret ของฉบับเดิมถูกลบไปแล้ว) และ OTP ผู้ใช้กดขอใหม่เองที่หน้าเข้าสู่ระบบ
 */
export default function EmailDeliveriesPage() {
  const { values, set, page } = useUrlFilters(FILTERS);
  const pageSize = Number(values.pageSize) || DEFAULT_PAGE_SIZE;
  const { data, error, loading, reload } = useAdminData<{
    items: DeliveryView[];
    total: number;
    types: Array<{ value: string; label: string }>;
  }>(`/api/admin/deliveries${qs({ state: values.state, type: values.type, q: values.q, page, pageSize })}`);
  const { track } = useDeliveryTracker();
  const [resending, setResending] = useState<DeliveryView | null>(null);

  const columns: Column<DeliveryView>[] = [
    {
      key: "time",
      header: "เวลา",
      cell: (d) => <span className="whitespace-nowrap text-[13.5px] text-ink">{formatThaiDate(d.createdAt)}</span>,
    },
    {
      key: "type",
      header: "อีเมล",
      cell: (d) => (
        <div className="min-w-0">
          <p className="text-[14px] font-medium text-navy-800">{d.typeLabel}</p>
          <p className="break-all text-[13px] text-ink-muted">{d.destination}</p>
        </div>
      ),
    },
    {
      key: "state",
      header: "สถานะ",
      cell: (d) => (
        <div className="space-y-1">
          <DeliveryChip delivery={d} prefix="" />
          {d.reason ? <p className="max-w-xs text-[12.5px] text-ink-muted">{d.reason}</p> : null}
          {d.fixedBy && d.state !== "sent" ? (
            <p className="text-[12px] text-ink-subtle">ผู้แก้: {FIXED_BY[d.fixedBy] ?? d.fixedBy}</p>
          ) : null}
        </div>
      ),
    },
    {
      key: "attempts",
      header: "ครั้งที่ส่ง",
      cell: (d) => (
        <span className="text-[13.5px] tabular-nums text-ink">
          {d.attemptCount}/{d.maxAttempts}
        </span>
      ),
    },
    {
      key: "action",
      header: "",
      cell: (d) => <ResendCell d={d} onResend={() => setResending(d)} />,
    },
  ];

  return (
    <div>
      <PageHeader
        eyebrow="ตั้งค่าระบบ"
        title="ประวัติการส่งอีเมล"
        description="อีเมลทุกฉบับที่ระบบส่ง — ส่งผ่านคิว ถ้าเซิร์ฟเวอร์อีเมลขัดข้องระบบจะลองใหม่เอง ถ้าส่งไม่สำเร็จจะบอกเหตุผลและใครต้องแก้"
      />
      <Panel flush>
        <div className="flex flex-wrap items-center gap-3 border-b border-line p-4">
          <div className="min-w-[240px] flex-1">
            <SearchBox value={values.q} onCommit={(v) => set({ q: v })} placeholder="ค้นหาด้วยอีเมลผู้รับ" />
          </div>
          <FilterSelect
            label="สถานะ"
            value={values.state}
            onChange={(v) => set({ state: v })}
            options={[
              { value: "", label: "ทุกสถานะ" },
              ...(Object.keys(DELIVERY_STATE_META) as DeliveryState[]).map((s) => ({
                value: s,
                label: DELIVERY_STATE_META[s].label,
              })),
            ]}
          />
          <FilterSelect
            label="ชนิดอีเมล"
            value={values.type}
            onChange={(v) => set({ type: v })}
            options={[{ value: "", label: "ทุกชนิด" }, ...(data?.types ?? [])]}
          />
        </div>
        {error ? <ErrorNotice view={adminErrorView(error)} className="m-4" /> : null}
        <DataTable
          columns={columns}
          rows={data?.items ?? null}
          rowKey={(d) => d.id}
          loading={loading}
          empty={<EmptyState title="ไม่พบอีเมลที่ตรงกับตัวกรอง" />}
          page={page}
          pageSize={pageSize}
          total={data?.total}
          onPage={(p) => set({ page: String(p) })}
          onPageSize={(s) => set({ pageSize: String(s) })}
        />
      </Panel>

      <ActionDialog
        open={resending !== null}
        onClose={() => setResending(null)}
        title={`ส่ง "${resending?.typeLabel ?? ""}" อีกครั้ง`}
        description={resending ? `เข้าคิวส่งถึง ${resending.destination} อีกครั้ง เนื้อหาประกอบใหม่จากข้อมูลปัจจุบัน` : undefined}
        confirmLabel="ส่งอีกครั้ง"
        reason={false}
        onConfirm={async () => {
          const res = await api.post<{ deliveryId: string }>(`/api/admin/deliveries/${resending!.id}/resend`);
          track(res.deliveryId, `${resending!.typeLabel} ถึง ${resending!.destination}`);
          reload();
        }}
      />
    </div>
  );
}

/** ปุ่มของแถว — ตามชนิดของอีเมล (`resend` จาก API) แสดงเฉพาะฉบับที่จบแบบไม่สำเร็จ */
function ResendCell({ d, onResend }: { d: DeliveryView; onResend: () => void }) {
  if (d.state !== "failed" && d.state !== "cancelled") return null;
  if (d.resend === "requeue") {
    return (
      <Button size="sm" variant="secondary" className="whitespace-nowrap" onClick={onResend}>
        ส่งอีกครั้ง
      </Button>
    );
  }
  if (d.resend === "invitation") {
    return (
      <Link
        href={`/console/invitations${qs({ email: d.destination })}`}
        className="whitespace-nowrap text-[13px] font-medium text-navy-700 underline"
      >
        ไปที่คำเชิญ →
      </Link>
    );
  }
  if (d.resend === "password_reset") {
    return (
      <Link href={`/console/users/${d.recipientUserId}`} className="whitespace-nowrap text-[13px] font-medium text-navy-700 underline">
        ไปที่ผู้ใช้ →
      </Link>
    );
  }
  return null;
}
