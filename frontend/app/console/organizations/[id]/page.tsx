"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";

import { ActionDialog } from "@/components/console/ActionDialog";
import { DataTable, type Column } from "@/components/console/DataTable";
import { InviteDialog } from "@/components/console/InviteDialog";
import { MembershipBadge, PersonCell, membershipOf } from "@/components/console/MembersTable";
import { OrganizationForm } from "@/components/console/OrganizationForm";
import {
  DetailList,
  EmptyState,
  ErrorNotice,
  PageHeader,
  Panel,
  Tag,
  WarningList,
} from "@/components/console/ui";
import { Button } from "@/components/ui/Button";
import { DateTimeCell } from "@/components/list/DateTimeCell";
import { DatasetStatusBadge, OrganizationStatusBadge, StatusBadge } from "@/components/ui/Card";
import { Spinner } from "@/components/ui/Spinner";
import { useToast } from "@/components/ui/Toast";
import {
  type AdminOrganization,
  type AdminOrganizationDatasetRow,
  type AdminOrganizationDetail,
  type AdminUserListItem,
} from "@/lib/admin";
import { adminErrorView } from "@/lib/admin-errors";
import { api } from "@/lib/api";
import { ROLE_LABELS, formatThaiDate } from "@/lib/status";
import { datasetTitle, phoneWithExtension } from "@/lib/types";
import { useAdminData } from "@/lib/use-admin";

type StatusChange = "suspend" | "deactivate" | "reactivate";

const STATUS_COPY: Record<StatusChange, { title: string; description: string; confirm: string; tone: "primary" | "danger" }> = {
  suspend: {
    title: "ระงับหน่วยงานชั่วคราว",
    description:
      "คำขอทุกใบของหน่วยงานหยุดอยู่ที่ขั้นเดิม — ทั้งหน่วยงานและเจ้าหน้าที่ BDI แก้ไข นำส่ง หรืออนุมัติไม่ได้ ยื่นคำขอใหม่และเชิญผู้ใช้เพิ่มไม่ได้ สมาชิกยังเข้าระบบมาดูได้ และผู้ดูแลระบบยังยกเลิกหรือปรับคำขอกลับเป็นฉบับร่างได้ — ระบบบอกให้หลังสั่งว่ายังมีอะไรค้าง",
    confirm: "ระงับหน่วยงาน",
    tone: "danger",
  },
  deactivate: {
    title: "ยุติการใช้งานหน่วยงาน",
    description:
      "ใช้แทนการลบ — หน่วยงานและประวัติยังอยู่ คำขอที่ค้างหยุดอยู่ที่ขั้นเดิมเหมือนการระงับ ยื่นคำขอใหม่และเชิญผู้ใช้เพิ่มไม่ได้ บัญชีและคำขอไม่ถูกลบ จัดการแยกได้หลังจากนี้",
    confirm: "ยุติการใช้งาน",
    tone: "danger",
  },
  reactivate: {
    title: "เปิดใช้หน่วยงานอีกครั้ง",
    description:
      "หน่วยงานที่เคยผ่านการลงทะเบียนกลับเป็น “เปิดใช้งาน” ส่วนหน่วยงานที่ยังไม่เคยผ่านกลับเป็น “อยู่ระหว่างลงทะเบียน” — คำขอที่ค้างอยู่เดินต่อจากขั้นเดิม",
    confirm: "เปิดใช้อีกครั้ง",
    tone: "primary",
  },
};

/** กรอบสรุปบนหน้านี้แสดงกี่แถวก่อนส่งต่อไปหน้าย่อย */
const PREVIEW_ROWS = 6;

/** ตารางชุดข้อมูลแสดงกี่แถวก่อนกด "แสดงทั้งหมด" — ไม่มีหน้าย่อยให้ส่งต่อ จึงขยายในที่ */
const DATASET_PREVIEW_ROWS = 10;

/** คำขอที่ยังไม่จบ — ปิดแล้วคืออนุมัติ ไม่อนุมัติ หรือยกเลิก */
const CLOSED_REQUEST_STATUSES = new Set(["APPROVED", "REJECTED", "CANCELLED"]);

const DATASET_COLUMNS: Column<AdminOrganizationDatasetRow>[] = [
  {
    key: "title",
    header: "ชื่อชุดข้อมูล",
    cell: (r) => (
      <div className="min-w-0">
        <Link
          href={`/console/registrations/datasets/${r.id}`}
          onClick={(e) => e.stopPropagation()}
          className="font-medium text-navy-800 hover:underline"
        >
          {datasetTitle(r)}
        </Link>
        <span className="block text-[12.5px] text-ink-muted">คำขอ {r.requestNumber}</span>
      </div>
    ),
  },
  {
    key: "dataset",
    header: "ชุดข้อมูล",
    className: "w-[11rem]",
    cell: (r) =>
      r.dataset ? (
        <div>
          <span className="font-mono text-[13px] text-navy-800">{r.dataset.datasetCode}</span>
          <span className="block text-[12.5px] text-ink-muted">
            {r.dataset.status === "ACTIVE"
              ? `เปิดใช้เมื่อ ${formatThaiDate(r.dataset.activatedAt ?? r.approvedAt)}`
              : `ปิดใช้เมื่อ ${formatThaiDate(r.dataset.deactivatedAt)}`}
          </span>
        </div>
      ) : (
        <span className="text-[13px] text-ink-subtle">ยังไม่เป็นชุดข้อมูล</span>
      ),
  },
  {
    key: "status",
    header: "สถานะคำขอ",
    className: "w-[13rem]",
    cell: (r) => <DatasetStatusBadge status={r.status} currentTaskType={r.currentTaskType} />,
  },
  {
    key: "updated",
    header: "อัปเดตล่าสุด",
    className: "w-[8rem]",
    cell: (r) => <DateTimeCell value={r.updatedAt} label="อัปเดตล่าสุด" />,
  },
];

/**
 * หน่วยงานหนึ่งแห่ง — ทะเบียน สถานะ สมาชิกและคำเชิญ คำขอลงทะเบียน และชุดข้อมูลกับคำขอส่งชุดข้อมูลของหน่วยงานนั้น
 *
 * ชุดข้อมูลกับคำขอส่งชุดข้อมูลเป็นตารางเดียว (การ์ด Issue 261031-06): ชุดข้อมูลทุกชุดเกิดจากคำขอใบเดียว หนึ่งแถวจึงเป็นคำขอหนึ่งใบ
 * และใบที่อนุมัติแล้วบอกรหัสชุดข้อมูลในคอลัมน์ของมัน แยกเป็นสองตารางจะได้ชุดข้อมูลที่ซ้ำกับแถว "อนุมัติแล้ว" ของอีกตาราง
 *
 * สมาชิกกับคำเชิญเป็นกรอบเดียว (การ์ด Issue 20261031-04): คนที่ได้รับเชิญยังไม่มีบทบาทจนกว่าจะเปิดใช้งาน กรอบสมาชิกที่แยกจาก
 * กรอบคำเชิญจึงบอก "ไม่มีสมาชิก" ขณะที่คำเชิญถึงผู้ประสานงานรออยู่กรอบถัดไป ผู้ดูแลตอบไม่ได้ว่าหน่วยงานมีผู้ประสานงานแล้ว
 * หรือยัง ตอนนี้กรอบเดียวแสดงทั้งคนที่ใช้งานอยู่และคนที่รอเปิดใช้งาน ส่วนตารางเต็ม ตัวกรอง และคำสั่งต่อแถวอยู่ที่หน้าย่อย
 * `/members` ปุ่ม "เชิญเข้าหน่วยงานนี้" เปิดกล่องในหน้านี้เลย ไม่พาออกไปไหน (การ์ด Issue 2026-10-25: เคยพาไปหน้าคำเชิญรวม
 * แล้วไม่มีทางกลับ)
 */
export default function ConsoleOrganizationPage() {
  const { id } = useParams<{ id: string }>();
  const { show } = useToast();
  const { data, error, loading, reload } = useAdminData<AdminOrganizationDetail>(`/api/admin/organizations/${id}`);
  // รวมคนที่ได้รับเชิญ (ยังไม่มีบทบาท) และอดีตสมาชิก — คนที่รอเปิดใช้งานขึ้นในกรอบสมาชิก อดีตสมาชิกนับไว้ใต้กรอบ
  const members = useAdminData<{ users: AdminUserListItem[] }>(
    `/api/admin/users?organizationId=${id}&includeFormer=1&includeInvited=1&pageSize=100`,
  );
  const [editing, setEditing] = useState(false);
  const [change, setChange] = useState<StatusChange | null>(null);
  const [inviting, setInviting] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [allDatasets, setAllDatasets] = useState(false);

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
  const people = (members.data?.users ?? []).map((user) => ({ user, m: membershipOf(user, org.id) }));
  // ใช้งานอยู่ก่อน แล้วจึงคนที่รอเปิดใช้งาน — คำตอบของ "มีใครแล้วหรือยัง" ต้องอยู่บรรทัดแรก
  const shown = [...people.filter((p) => p.m.state === "current"), ...people.filter((p) => p.m.state === "pending")];
  const formerCount = people.filter((p) => p.m.state === "former").length;
  const lapsedCount = people.filter((p) => p.m.state === "lapsed").length;
  const footer = [
    shown.length > PREVIEW_ROWS ? `แสดง ${PREVIEW_ROWS} จาก ${shown.length} คน` : null,
    formerCount > 0 ? `อดีตสมาชิก ${formerCount} คน` : null,
    lapsedCount > 0 ? `คำเชิญที่หมดอายุหรือถูกยกเลิก ${lapsedCount} ใบ` : null,
  ].filter((x): x is string => x !== null);
  // ระหว่างที่หน่วยงานอยู่ในคำขอ เนื้อข้อมูลเป็นของผู้ประสานงาน (การ์ด 20261026-01) — แก้ได้เมื่อเปิดใช้งานแล้ว
  // หรือเมื่อยังไม่มีคำขอสักใบ (ขั้น ① ที่ admin เพิ่งสร้างหน่วยงานล่วงหน้า)
  const lockedRequest = org.activatedAt ? null : (data.registrationRequests[0] ?? null);
  const datasetRows = data.datasetRequests;
  const datasetCount = datasetRows.filter((r) => r.dataset !== null).length;
  const openRequestCount = datasetRows.filter((r) => !CLOSED_REQUEST_STATUSES.has(r.status)).length;

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
          title="สมาชิกและคำเชิญ"
          description="หนึ่งหน่วยงานมีผู้ประสานงานหนึ่งคนและผู้มีอำนาจอนุมัติหนึ่งคน — คนที่ได้รับเชิญแล้วแต่ยังไม่เปิดใช้งานขึ้นที่นี่ด้วย"
          actions={
            <Link href={`/console/organizations/${org.id}/members`} className="text-[13.5px] font-medium text-navy-700 hover:underline">
              ดูสมาชิกและคำเชิญทั้งหมด →
            </Link>
          }
          flush
        >
          {shown.length > 0 ? (
            <ul className="divide-y divide-line">
              {shown.slice(0, PREVIEW_ROWS).map(({ user, m }) => (
                <li key={user.id}>
                  <Link
                    href={`/console/users/${user.id}`}
                    className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 hover:bg-navy-50/50"
                  >
                    <PersonCell user={user} />
                    <span className="flex flex-wrap items-center gap-2">
                      {m.state === "current"
                        ? m.current.map((a) => <Tag key={a.id}>{ROLE_LABELS[a.role.code]}</Tag>)
                        : m.invitation
                          ? <Tag>{ROLE_LABELS[m.invitation.role.code] ?? m.invitation.role.nameTh}</Tag>
                          : null}
                      <MembershipBadge m={m} user={user} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              title={
                members.loading
                  ? "กำลังโหลด…"
                  : formerCount > 0 || lapsedCount > 0
                    ? "ไม่มีสมาชิกที่ใช้งานอยู่ และไม่มีคำเชิญที่รออยู่"
                    : "ยังไม่มีสมาชิกและไม่มีคำเชิญ"
              }
            >
              {members.loading ? null : "เชิญผู้ประสานงานของหน่วยงานเพื่อให้เริ่มยื่นคำขอลงทะเบียนได้"}
            </EmptyState>
          )}
          {!members.loading && footer.length > 0 ? (
            <p className="border-t border-line px-5 py-2.5 text-[13px] text-ink-muted">
              {footer.join(" · ")} —{" "}
              <Link href={`/console/organizations/${org.id}/members`} className="font-medium text-navy-700 underline">
                ดูในหน้าสมาชิกและคำเชิญ
              </Link>
            </p>
          ) : null}
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

        <Panel
          title="ชุดข้อมูลและคำขอส่งชุดข้อมูล"
          description={
            datasetRows.length === 0
              ? "หนึ่งแถวคือคำขอหนึ่งใบ — คำขอที่อนุมัติแล้วกลายเป็นชุดข้อมูลของหน่วยงาน"
              : `ชุดข้อมูล ${datasetCount} ชุด · คำขอที่ยังไม่ปิด ${openRequestCount} ใบ · ทั้งหมด ${datasetRows.length} ใบ — หนึ่งแถวคือคำขอหนึ่งใบ คำขอที่อนุมัติแล้วมีรหัสชุดข้อมูลกำกับ`
          }
          flush
        >
          <DataTable
            columns={DATASET_COLUMNS}
            rows={allDatasets ? datasetRows : datasetRows.slice(0, DATASET_PREVIEW_ROWS)}
            rowKey={(r) => r.id}
            rowHref={(r) => `/console/registrations/datasets/${r.id}`}
            loading={false}
            empty={<EmptyState title="ยังไม่มีชุดข้อมูลและไม่มีคำขอส่งชุดข้อมูล" />}
          />
          {datasetRows.length > DATASET_PREVIEW_ROWS ? (
            <div className="border-t border-line px-5 py-2.5 text-[13px] text-ink-muted">
              {allDatasets ? `แสดงทั้งหมด ${datasetRows.length} ใบ` : `แสดง ${DATASET_PREVIEW_ROWS} จาก ${datasetRows.length} ใบ`}{" "}
              —{" "}
              <button
                type="button"
                onClick={() => setAllDatasets((v) => !v)}
                className="font-medium text-navy-700 underline"
              >
                {allDatasets ? "แสดงเฉพาะล่าสุด" : "แสดงทั้งหมด"}
              </button>
            </div>
          ) : null}
        </Panel>
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
