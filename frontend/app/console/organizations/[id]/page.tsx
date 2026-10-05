"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";

import { ActionDialog } from "@/components/console/ActionDialog";
import { OrganizationForm } from "@/components/console/OrganizationForm";
import {
  Badge,
  ButtonLink,
  DetailList,
  EmptyState,
  ErrorNotice,
  PageHeader,
  Panel,
  Tag,
  WarningList,
} from "@/components/console/ui";
import { Button } from "@/components/ui/Button";
import { OrganizationStatusBadge, StatusBadge } from "@/components/ui/Card";
import { Spinner } from "@/components/ui/Spinner";
import { useToast } from "@/components/ui/Toast";
import {
  INVITATION_STATUS_META,
  USER_STATUS_META,
  invitationState,
  type AdminOrganization,
  type AdminOrganizationDetail,
  type AdminUserListItem,
} from "@/lib/admin";
import { adminErrorView } from "@/lib/admin-errors";
import { api } from "@/lib/api";
import { ROLE_LABELS, formatThaiDate } from "@/lib/status";
import { phoneWithExtension } from "@/lib/types";
import { accountName, useAdminData } from "@/lib/use-admin";

type StatusChange = "suspend" | "deactivate" | "reactivate";

const STATUS_COPY: Record<StatusChange, { title: string; description: string; confirm: string; tone: "primary" | "danger" }> = {
  suspend: {
    title: "ระงับหน่วยงานชั่วคราว",
    description:
      "หน่วยงานยื่นคำขอใหม่ไม่ได้ระหว่างระงับ บัญชีของสมาชิกยังเข้าระบบได้และคำขอที่ค้างอยู่ยังอยู่ที่ด่านเดิม — ระบบบอกให้หลังสั่งว่ายังมีอะไรค้าง",
    confirm: "ระงับหน่วยงาน",
    tone: "danger",
  },
  deactivate: {
    title: "ยุติการใช้งานหน่วยงาน",
    description:
      "ใช้แทนการลบ — หน่วยงานและประวัติยังอยู่ แต่ยื่นคำขอใหม่ไม่ได้ บัญชีและคำขอที่ค้างอยู่ไม่ถูกแตะ จัดการแยกได้หลังจากนี้",
    confirm: "ยุติการใช้งาน",
    tone: "danger",
  },
  reactivate: {
    title: "เปิดใช้หน่วยงานอีกครั้ง",
    description:
      "หน่วยงานที่เคยผ่านการลงทะเบียนกลับเป็น “เปิดใช้งาน” ส่วนหน่วยงานที่ยังไม่เคยผ่านกลับเป็น “อยู่ระหว่างลงทะเบียน”",
    confirm: "เปิดใช้อีกครั้ง",
    tone: "primary",
  },
};

/** หน่วยงานหนึ่งแห่ง — ทะเบียน สถานะ สมาชิก คำเชิญ และคำขอลงทะเบียนของหน่วยงานนั้นในหน้าเดียว */
export default function ConsoleOrganizationPage() {
  const { id } = useParams<{ id: string }>();
  const { show } = useToast();
  const { data, error, loading, reload } = useAdminData<AdminOrganizationDetail>(`/api/admin/organizations/${id}`);
  const members = useAdminData<{ users: AdminUserListItem[] }>(`/api/admin/users?organizationId=${id}&pageSize=100`);
  const [editing, setEditing] = useState(false);
  const [change, setChange] = useState<StatusChange | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  if (loading && !data) return <Spinner />;
  if (error && !data) {
    return (
      <div>
        <PageHeader title="ไม่พบหน่วยงาน" back={{ href: "/console/organizations", label: "หน่วยงานทั้งหมด" }} />
        <ErrorNotice view={adminErrorView(error)} />
      </div>
    );
  }
  if (!data) return null;
  const org = data.organization;

  return (
    <div>
      <PageHeader
        back={{ href: "/console/organizations", label: "หน่วยงานทั้งหมด" }}
        eyebrow={`รหัส ${org.organizationCode}`}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {org.nameTh}
            <OrganizationStatusBadge status={org.status} />
          </span>
        }
        description={org.nameEn ?? undefined}
        actions={
          <>
            <ButtonLink href={`/console/invitations?new=1&organizationId=${org.id}&role=ORGANIZATION_USER`}>
              เชิญเข้าหน่วยงานนี้
            </ButtonLink>
            {org.status === "ACTIVE" || org.status === "PENDING_REGISTRATION" ? (
              <Button size="sm" variant="secondary" onClick={() => setChange("suspend")}>
                ระงับชั่วคราว
              </Button>
            ) : null}
            {org.status !== "INACTIVE" ? (
              <Button size="sm" variant="danger" onClick={() => setChange("deactivate")}>
                ยุติการใช้งาน
              </Button>
            ) : null}
            {org.status === "SUSPENDED" || org.status === "INACTIVE" ? (
              <Button size="sm" onClick={() => setChange("reactivate")}>
                เปิดใช้อีกครั้ง
              </Button>
            ) : null}
          </>
        }
      />

      {org.status === "SUSPENDED" ? (
        <div className="mb-5 rounded-xl bg-danger-bg px-4 py-3 text-[14px]">
          <p className="font-semibold text-danger">ระงับเมื่อ {formatThaiDate(org.suspendedAt)}</p>
          {org.suspensionReason ? <p className="text-ink">เหตุผล: {org.suspensionReason}</p> : null}
        </div>
      ) : null}
      {org.status === "INACTIVE" ? (
        <div className="mb-5 rounded-xl bg-navy-50 px-4 py-3 text-[14px] text-ink">
          ยุติการใช้งานเมื่อ {formatThaiDate(org.deactivatedAt)}
        </div>
      ) : null}
      <WarningList warnings={warnings} className="mb-5" />

      <div className="space-y-5">
        <Panel
          title="ทะเบียนหน่วยงาน"
          description="ข้อมูลนี้ถูกคัดลอกลงคำขอลงทะเบียนตอนหน่วยงานเปิดคำขอ — แก้ที่นี่ไม่เปลี่ยนคำขอที่เปิดไปแล้ว"
          actions={
            editing ? null : (
              <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
                แก้ไข
              </Button>
            )
          }
        >
          {editing ? (
            <OrganizationForm
              organization={org}
              onCancel={() => setEditing(false)}
              onSaved={(_org: AdminOrganization, warning?: string) => {
                setEditing(false);
                setWarnings(warning ? [warning] : []);
                show({ tone: "success", title: "บันทึกทะเบียนหน่วยงานแล้ว" });
                reload();
              }}
            />
          ) : (
            <DetailList
              items={[
                { label: "ประเภทหน่วยงาน", value: org.organizationType },
                { label: "อีเมล", value: org.email },
                {
                  label: "ที่อยู่",
                  wide: true,
                  value: [org.addressLine, org.road, org.subdistrict, org.district, org.province, org.postalCode]
                    .filter(Boolean)
                    .join(" "),
                },
                { label: "เบอร์โทรศัพท์", value: phoneWithExtension(org.phone, org.phoneExtension) },
                {
                  label: "เว็บไซต์",
                  value: org.websiteUrl ? (
                    <a href={org.websiteUrl} target="_blank" rel="noopener noreferrer" className="text-navy-700 underline">
                      {org.websiteUrl}
                    </a>
                  ) : null,
                },
                { label: "สร้างเมื่อ", value: formatThaiDate(org.createdAt) },
                { label: "เปิดใช้งานเมื่อ", value: org.activatedAt ? formatThaiDate(org.activatedAt) : null },
              ]}
            />
          )}
        </Panel>

        <Panel
          title="สมาชิก"
          description="หนึ่งหน่วยงานมีผู้ประสานงานหนึ่งคนและผู้มีอำนาจอนุมัติหนึ่งคน"
          actions={
            <Link href={`/console/users?organizationId=${org.id}`} className="text-[13.5px] font-medium text-navy-700 hover:underline">
              ดูในรายชื่อผู้ใช้ →
            </Link>
          }
          flush
        >
          {members.data && members.data.users.length > 0 ? (
            <ul className="divide-y divide-line">
              {members.data.users.map((m) => (
                <li key={m.id}>
                  <Link
                    href={`/console/users/${m.id}`}
                    className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 hover:bg-navy-50/50"
                  >
                    <span className="min-w-0">
                      <span className="block font-medium text-navy-800">{accountName(m)}</span>
                      <span className="block text-[13px] text-ink-muted">{m.email}</span>
                    </span>
                    <span className="flex items-center gap-2">
                      {m.roleAssignments
                        .filter((a) => a.organization?.id === org.id)
                        .map((a) => (
                          <Tag key={a.id}>{ROLE_LABELS[a.role.code]}</Tag>
                        ))}
                      <Badge meta={USER_STATUS_META[m.status]} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title={members.loading ? "กำลังโหลด…" : "ยังไม่มีสมาชิก"}>
              {members.loading ? null : "เชิญผู้ประสานงานของหน่วยงานเพื่อให้เริ่มยื่นคำขอลงทะเบียนได้"}
            </EmptyState>
          )}
        </Panel>

        <div className="grid gap-5 lg:grid-cols-2">
          <Panel title="คำเชิญ" flush>
            {data.invitations.length === 0 ? (
              <EmptyState title="ยังไม่มีคำเชิญ" />
            ) : (
              <ul className="divide-y divide-line">
                {data.invitations.map((inv) => (
                  <li key={inv.id} className="px-5 py-3 text-[14px]">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Link
                        href={`/console/invitations?email=${encodeURIComponent(inv.userAccount.email)}`}
                        className="truncate font-medium text-navy-800 hover:underline"
                      >
                        {inv.userAccount.email}
                      </Link>
                      <Badge meta={INVITATION_STATUS_META[invitationState(inv)]} />
                    </div>
                    <p className="text-[13px] text-ink-muted">
                      {ROLE_LABELS[inv.role.code]} · หมดอายุ {formatThaiDate(inv.expiresAt)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title="คำขอลงทะเบียนหน่วยงาน" flush>
            {data.registrationRequests.length === 0 ? (
              <EmptyState title="ยังไม่มีคำขอ" />
            ) : (
              <ul className="divide-y divide-line">
                {data.registrationRequests.map((r) => (
                  <li key={r.id}>
                    <Link
                      href={`/console/registrations/organizations/${r.id}`}
                      className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-[14px] hover:bg-navy-50/50"
                    >
                      <span>
                        <span className="block font-medium text-navy-800">{r.requestNumber}</span>
                        <span className="block text-[13px] text-ink-muted">
                          {r.submittedAt ? `นำส่ง ${formatThaiDate(r.submittedAt)}` : `เปิดเมื่อ ${formatThaiDate(r.createdAt)}`}
                        </span>
                      </span>
                      <StatusBadge status={r.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>

      <ActionDialog
        open={change !== null}
        onClose={() => setChange(null)}
        title={change ? STATUS_COPY[change].title : ""}
        description={change ? STATUS_COPY[change].description : undefined}
        confirmLabel={change ? STATUS_COPY[change].confirm : ""}
        tone={change ? STATUS_COPY[change].tone : "primary"}
        confirmPhrase={change === "deactivate" ? org.organizationCode : undefined}
        onConfirm={async (reason) => {
          if (!change) return;
          const res = await api.post<{ warnings: string[] }>(`/api/admin/organizations/${org.id}/${change}`, { reason });
          setWarnings(res.warnings);
          show({ tone: "success", title: `${STATUS_COPY[change].confirm}แล้ว` });
          reload();
        }}
      />
    </div>
  );
}
