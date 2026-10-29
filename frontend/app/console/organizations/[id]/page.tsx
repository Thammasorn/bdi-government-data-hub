"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";

import { ActionDialog } from "@/components/console/ActionDialog";
import { InviteDialog } from "@/components/console/InviteDialog";
import { membershipOf } from "@/components/console/MembersTable";
import { OrganizationForm } from "@/components/console/OrganizationForm";
import {
  Badge,
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

/** กรอบสรุปบนหน้านี้แสดงกี่แถวก่อนส่งต่อไปหน้าย่อย */
const PREVIEW_ROWS = 6;

/**
 * หน่วยงานหนึ่งแห่ง — ทะเบียน สถานะ และสรุปของสมาชิก คำเชิญ คำขอลงทะเบียนของหน่วยงานนั้น
 *
 * สมาชิกและคำเชิญมีหน้าย่อยของตัวเอง (`/members`, `/invitations`) ที่มีตารางเต็ม ตัวกรอง และคำสั่งต่อแถว — กรอบในหน้านี้
 * เป็นตัวอย่างไม่กี่แถวพร้อมลิงก์ไปหน้านั้น ส่วนปุ่ม "เชิญเข้าหน่วยงานนี้" เปิดกล่องในหน้านี้เลย ไม่พาออกไปไหน (การ์ด Issue
 * 2026-10-25: เคยพาไปหน้าคำเชิญรวมแล้วไม่มีทางกลับ)
 */
export default function ConsoleOrganizationPage() {
  const { id } = useParams<{ id: string }>();
  const { show } = useToast();
  const { data, error, loading, reload } = useAdminData<AdminOrganizationDetail>(`/api/admin/organizations/${id}`);
  // รวมอดีตสมาชิกด้วย เพื่อให้นับได้ว่ามีกี่คน — หน่วยงานที่ทุกคนถูกยุติไปแล้วต้องไม่ดูเหมือนไม่เคยมีใคร
  const members = useAdminData<{ users: AdminUserListItem[] }>(
    `/api/admin/users?organizationId=${id}&includeFormer=1&pageSize=100`,
  );
  const [editing, setEditing] = useState(false);
  const [change, setChange] = useState<StatusChange | null>(null);
  const [inviting, setInviting] = useState(false);
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
  const allMembers = members.data?.users ?? [];
  const currentMembers = allMembers.filter((m) => !membershipOf(m, org.id).former);
  const formerCount = allMembers.length - currentMembers.length;
  const openInvitations = data.invitations.filter((inv) => invitationState(inv) === "ISSUED");
  // ระหว่างที่หน่วยงานอยู่ในคำขอ เนื้อข้อมูลเป็นของผู้ประสานงาน (การ์ด 20261026-01) — แก้ได้เมื่อเปิดใช้งานแล้ว
  // หรือเมื่อยังไม่มีคำขอสักใบ (ขั้น ① ที่ admin เพิ่งสร้างหน่วยงานล่วงหน้า)
  const lockedRequest = org.activatedAt ? null : (data.registrationRequests[0] ?? null);

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
            <Button size="sm" onClick={() => setInviting(true)}>
              เชิญเข้าหน่วยงานนี้
            </Button>
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
          description={
            lockedRequest
              ? "หน่วยงานนี้ยังอยู่ระหว่างลงทะเบียน ข้อมูลอยู่ในคำขอของผู้ประสานงาน — แก้ที่นี่ได้หลังอนุมัติและเปิดใช้งานแล้วเท่านั้น"
              : org.activatedAt
                ? "แก้ได้ทุกช่องเหมือนในใบคำขอ และตรวจข้อมูลด้วยกฎเดียวกับฟอร์มของหน่วยงาน"
                : "ข้อมูลที่กรอกล่วงหน้า — ผู้ประสานงานเห็นในฟอร์มคำขอตอนเปิดคำขอครั้งแรก และกรอกส่วนที่เหลือเอง แก้ที่นี่ได้จนกว่าจะมีคำขอ"
          }
          actions={
            editing || lockedRequest ? null : (
              <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
                แก้ไข
              </Button>
            )
          }
        >
          {lockedRequest ? (
            <p className="mb-4 rounded-xl bg-navy-50 px-4 py-3 text-[14px] text-ink">
              ระหว่างนี้ผู้ดูแลระบบปรับได้แค่สถานะของคำขอ (ปรับกลับเป็นฉบับร่าง หรือยกเลิก) ที่{" "}
              <Link href={`/console/registrations/organizations/${lockedRequest.id}`} className="font-medium text-navy-700 underline">
                คำขอ {lockedRequest.requestNumber}
              </Link>
            </p>
          ) : null}
          {editing ? (
            <OrganizationForm
              organization={org}
              onCancel={() => setEditing(false)}
              onSaved={(_org: AdminOrganization) => {
                setEditing(false);
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
            <Link href={`/console/organizations/${org.id}/members`} className="text-[13.5px] font-medium text-navy-700 hover:underline">
              ดูสมาชิกทั้งหมด →
            </Link>
          }
          flush
        >
          {currentMembers.length > 0 ? (
            <ul className="divide-y divide-line">
              {currentMembers.slice(0, PREVIEW_ROWS).map((m) => (
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
                      {membershipOf(m, org.id).current.map((a) => (
                        <Tag key={a.id}>{ROLE_LABELS[a.role.code]}</Tag>
                      ))}
                      <Badge meta={USER_STATUS_META[m.status]} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title={members.loading ? "กำลังโหลด…" : formerCount > 0 ? "ไม่มีสมาชิกที่ยังใช้งานอยู่" : "ยังไม่มีสมาชิก"}>
              {members.loading ? null : "เชิญผู้ประสานงานของหน่วยงานเพื่อให้เริ่มยื่นคำขอลงทะเบียนได้"}
            </EmptyState>
          )}
          {!members.loading && (currentMembers.length > PREVIEW_ROWS || formerCount > 0) ? (
            <p className="border-t border-line px-5 py-2.5 text-[13px] text-ink-muted">
              {currentMembers.length > PREVIEW_ROWS ? `แสดง ${PREVIEW_ROWS} จาก ${currentMembers.length} คน` : null}
              {currentMembers.length > PREVIEW_ROWS && formerCount > 0 ? " · " : null}
              {formerCount > 0 ? (
                <>
                  อดีตสมาชิก {formerCount} คน —{" "}
                  <Link href={`/console/organizations/${org.id}/members`} className="font-medium text-navy-700 underline">
                    ดูในหน้าสมาชิก
                  </Link>
                </>
              ) : null}
            </p>
          ) : null}
        </Panel>

        <div className="grid gap-5 lg:grid-cols-2">
          <Panel
            title="คำเชิญที่รอผู้รับ"
            actions={
              <Link
                href={`/console/organizations/${org.id}/invitations`}
                className="text-[13.5px] font-medium text-navy-700 hover:underline"
              >
                ดูคำเชิญทั้งหมด →
              </Link>
            }
            flush
          >
            {openInvitations.length === 0 ? (
              <EmptyState title={data.invitations.length === 0 ? "ยังไม่มีคำเชิญ" : "ไม่มีคำเชิญที่ยังรออยู่"}>
                {data.invitations.length === 0 ? null : `ทั้งหมด ${data.invitations.length} ใบ ใช้แล้ว หมดอายุ หรือถูกยกเลิก`}
              </EmptyState>
            ) : (
              <ul className="divide-y divide-line">
                {openInvitations.slice(0, PREVIEW_ROWS).map((inv) => (
                  <li key={inv.id} className="px-5 py-3 text-[14px]">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Link
                        href={`/console/organizations/${org.id}/invitations?email=${encodeURIComponent(inv.userAccount.email)}`}
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

      <InviteDialog
        open={inviting}
        lockedOrganization={{ id: org.id, nameTh: org.nameTh }}
        onClose={() => setInviting(false)}
        onDone={(email) => {
          show({ tone: "success", title: "ส่งคำเชิญแล้ว", detail: email });
          reload();
          members.reload();
        }}
      />

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
