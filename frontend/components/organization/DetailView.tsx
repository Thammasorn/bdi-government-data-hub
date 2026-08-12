"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { PdfViewer } from "@/components/organization/PdfViewer";
import { Timeline } from "@/components/organization/Timeline";
import { useSession } from "@/components/SessionProvider";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, StatusBadge } from "@/components/ui/Card";
import { TextAreaField } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";
import { useToast } from "@/components/ui/Toast";
import { api, ApiError } from "@/lib/api";
import { formatThaiDate } from "@/lib/status";
import { ATTACHMENT_LABELS, fullName, type Organization } from "@/lib/types";

/** ผู้ใช้ปัจจุบันตัดสินใจกับคำขอนี้ได้หรือไม่ ขึ้นกับสถานะ + role */
function decideAbility(org: Organization, roles: string[], email: string) {
  switch (org.currentTaskType) {
    case "BDI_OFFICER_REVIEW":
      return roles.includes("BDI_OFFICER")
        ? { can: true, approveLabel: "อนุมัติ", hint: "ตรวจสอบข้อมูลและเอกสารก่อนส่งต่อให้ผู้มีอำนาจกระทำการแทน" }
        : { can: false };
    case "ORGANIZATION_APPROVAL":
      return org.signatoryEmail?.toLowerCase() === email.toLowerCase()
        ? { can: true, approveLabel: "เห็นชอบ", hint: "โปรดตรวจสอบเอกสารในฐานะผู้มีอำนาจกระทำการแทน" }
        : { can: false };
    case "BDI_FINAL_APPROVAL":
      return roles.includes("BDI_FINAL_APPROVER")
        ? { can: true, approveLabel: "เห็นชอบและลงนาม", hint: "ขั้นตอนสุดท้าย เมื่อลงนามแล้วหน่วยงานจะเปิดใช้งานทันที" }
        : { can: false };
    default:
      return { can: false };
  }
}

export function OrganizationDetailView({ id, backHref }: { id: string; backHref?: string }) {
  const { user } = useSession();
  const { show } = useToast();
  const router = useRouter();

  const [org, setOrg] = useState<Organization | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [modal, setModal] = useState<null | "approve" | "revise">(null);
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const load = () =>
    api
      .get<{ organization: Organization }>(`/api/organizations/${id}`)
      .then((d) => setOrg(d.organization))
      .catch((err) => {
        // 404 = ไม่มีหน่วยงานนี้ หรือไม่มีสิทธิ์เห็น — ปล่อยค้างที่ spinner
        // ผู้ใช้จะนึกว่าระบบแฮงก์
        if (err instanceof ApiError && err.status === 404) {
          setNotFound(true);
          return;
        }
        show({ tone: "error", title: "โหลดข้อมูลไม่สำเร็จ" });
      });

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (notFound) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-20 text-center sm:px-6">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-navy-50">
          <svg
            viewBox="0 0 24 24"
            className="h-6 w-6 text-navy-400"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M12 8v5M12 16h.01" strokeLinecap="round" />
          </svg>
        </div>
        <h1 className="mt-4 text-xl font-semibold text-navy-800">ไม่พบหน่วยงานนี้</h1>
        <p className="mx-auto mt-2 max-w-md text-[15px] leading-relaxed text-ink-muted">
          หน่วยงานอาจถูกลบไปแล้ว หรือคุณไม่มีสิทธิ์เข้าถึงหน่วยงานนี้
        </p>
        {backHref ? (
          <Link
            href={backHref}
            className="mt-6 inline-block rounded-full border border-line px-5 py-2.5 text-sm font-medium text-navy-800 transition-colors hover:bg-navy-50"
          >
            กลับไปที่รายการ
          </Link>
        ) : null}
      </div>
    );
  }

  if (!org || !user) return <Spinner />;

  const ability = decideAbility(org, user.roles, user.email);
  const generated = org.attachments.find((a) => a.kind === "GENERATED_FORM");
  const supporting = org.attachments.filter((a) => a.kind !== "GENERATED_FORM");
  const isOwner = org.createdBy.id === user.id;
  const isMember = user.roles.includes("ORGANIZATION_USER") && user.organizationId === org.id;

  const act = async (action: "approve" | "request_revision") => {
    if (action === "request_revision" && note.trim().length < 10) {
      setNoteError("กรุณาระบุสิ่งที่ต้องแก้ไขอย่างน้อย 10 ตัวอักษร");
      return;
    }
    setBusy(true);
    try {
      await api.post(`/api/organizations/${id}/review`, { action, note: note.trim() || undefined });
      show({
        tone: "success",
        title: action === "approve" ? "ดำเนินการเรียบร้อย" : "ส่งกลับให้แก้ไขแล้ว",
        detail: "ระบบแจ้งผู้เกี่ยวข้องทางอีเมลแล้ว",
      });
      setModal(null);
      setNote("");
      await load();
    } catch (err) {
      show({
        tone: "error",
        title: "ดำเนินการไม่สำเร็จ",
        detail: err instanceof ApiError ? err.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      {backHref ? (
        <Link href={backHref} className="text-sm font-medium text-navy-700 hover:underline">
          ← กลับไปที่รายการ
        </Link>
      ) : null}

      <header className="mb-7 mt-4 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[26px] font-semibold text-navy-800">{org.name}</h1>
          <p className="mt-1.5 text-[15px] text-ink-muted">
            ยื่นโดย {fullName(org.createdBy.prefix, org.createdBy.firstName, org.createdBy.lastName)} ·{" "}
            {org.createdBy.email}
          </p>
        </div>
        <StatusBadge status={org.status} currentTaskType={org.currentTaskType} />
      </header>

      {org.status === "RETURNED" && org.revisionNote ? (
        <div className="mb-6 rounded-xl border-l-[3px] border-danger bg-danger-bg p-5">
          <p className="text-[13px] font-semibold text-danger">สิ่งที่ต้องแก้ไข</p>
          <p className="mt-1.5 whitespace-pre-wrap text-[15px] leading-relaxed text-ink">{org.revisionNote}</p>
          {isOwner ? (
            <Button size="sm" className="mt-4" onClick={() => router.push(`/organizations/${org.id}/edit`)}>
              แก้ไขข้อมูล
            </Button>
          ) : null}
        </div>
      ) : null}

      {ability.can ? (
        <Card className="mb-6 border-l-[3px] border-l-coral-500">
          <div className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium text-navy-800">รอการพิจารณาของคุณ</p>
              <p className="mt-0.5 text-sm text-ink-muted">{ability.hint}</p>
            </div>
            <div className="flex shrink-0 gap-3">
              <Button variant="secondary" onClick={() => setModal("revise")}>
                ต้องปรับปรุง
              </Button>
              <Button onClick={() => setModal("approve")}>{ability.approveLabel}</Button>
            </div>
          </div>
        </Card>
      ) : null}

      {isMember ? <DatasetEntryCard /> : null}

      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader tag="ส่วนที่ 1" title="ข้อมูลหน่วยงาน" />
          <Rows
            rows={[
              ["ชื่อหน่วยงาน", org.name],
              ["ที่อยู่", org.addressLine],
              ["ตำบล/แขวง", org.subdistrict],
              ["อำเภอ/เขต", org.district],
              ["จังหวัด", org.province],
              ["รหัสไปรษณีย์", org.postalCode],
              ["อีเมลหน่วยงาน", org.email],
            ]}
          />
        </Card>

        <Card>
          <CardHeader tag="ส่วนที่ 2" title="ผู้มีอำนาจกระทำการแทน" />
          <Rows
            rows={[
              ["ชื่อ-นามสกุล", fullName(org.signatoryPrefix, org.signatoryFirstName, org.signatoryLastName)],
              ["ตำแหน่ง", org.signatoryPosition],
              ["เลขบัตรประชาชน", maskId(org.signatoryNationalId)],
              ["อีเมล", org.signatoryEmail],
              ["เบอร์โทรศัพท์", org.signatoryPhone],
            ]}
          />
        </Card>

        <Card>
          <CardHeader tag="ส่วนที่ 3" title="ผู้กรอกข้อมูล" />
          <Rows
            rows={[
              ["ชื่อ-นามสกุล", fullName(org.contactPrefix, org.contactFirstName, org.contactLastName)],
              ["ตำแหน่ง", org.contactPosition],
              ["ฝ่าย/กอง/สำนัก", org.contactDepartment],
              ["อีเมล", org.contactEmail],
              ["เบอร์โทรศัพท์", org.contactPhone],
            ]}
          />
        </Card>

        {supporting.length > 0 ? (
          <Card>
            <CardHeader title="เอกสารแนบ" />
            <ul className="divide-y divide-line">
              {supporting.map((a) => (
                <li key={a.id} className="flex items-center gap-3 px-6 py-3.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-ink">{ATTACHMENT_LABELS[a.kind]}</p>
                    <p className="truncate text-[13px] text-ink-muted">{a.filename}</p>
                  </div>
                  <a
                    href={api.fileUrl(`/api/organizations/${org.id}/attachments/${a.id}`)}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 rounded-full border border-line px-3.5 py-1.5 text-[13px] font-medium text-navy-700 transition-colors hover:bg-navy-50"
                  >
                    เปิดดู
                  </a>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        {generated ? (
          <Card>
            <CardHeader title="แบบฟอร์มที่ระบบสร้าง" description="เอกสารที่ใช้ประกอบการพิจารณา" />
            <div className="p-6">
              <PdfViewer
                url={api.fileUrl(`/api/organizations/${org.id}/attachments/${generated.id}`)}
                filename={generated.filename}
                title="แบบฟอร์มสร้างหน่วยงาน"
              />
            </div>
          </Card>
        ) : null}

        <Card>
          <CardHeader title="ประวัติการดำเนินการ" description={`ยื่นเมื่อ ${formatThaiDate(org.submittedAt ?? org.createdAt)}`} />
          <Timeline events={org.events} />
        </Card>
      </div>

      <Modal
        open={modal === "revise"}
        onClose={() => setModal(null)}
        title="ระบุสิ่งที่ต้องปรับปรุง"
        description="ข้อความนี้จะถูกส่งทางอีเมลไปยังเจ้าหน้าที่ของหน่วยงาน"
      >
        <TextAreaField
          label="รายละเอียดที่ต้องแก้ไข"
          required
          value={note}
          error={noteError}
          onChange={(e) => {
            setNote(e.target.value);
            setNoteError(undefined);
          }}
          placeholder="เช่น เลขบัตรประชาชนของผู้มีอำนาจกระทำการแทนไม่ตรงกับคำสั่งแต่งตั้งที่แนบมา"
        />
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setModal(null)}>
            ยกเลิก
          </Button>
          <Button variant="danger" loading={busy} onClick={() => act("request_revision")}>
            ยืนยันส่งกลับแก้ไข
          </Button>
        </div>
      </Modal>

      <Modal
        open={modal === "approve"}
        onClose={() => setModal(null)}
        title={ability.approveLabel ?? "ยืนยัน"}
        description="ยืนยันว่าคุณตรวจสอบข้อมูลและเอกสารทั้งหมดเรียบร้อยแล้ว"
      >
        <p className="text-[15px] leading-relaxed text-ink-muted">
          ระบบจะบันทึกการตัดสินใจนี้พร้อมชื่อและเวลาของคุณ และแจ้งผู้เกี่ยวข้องในขั้นถัดไปทางอีเมล
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setModal(null)}>
            ยกเลิก
          </Button>
          <Button loading={busy} onClick={() => act("approve")}>
            {ability.approveLabel}
          </Button>
        </div>
      </Modal>
    </div>
  );
}

/**
 * ทางเข้าเส้นทางชุดข้อมูล (docs/01-user-journey.md §4.1)
 * ปุ่มยังอยู่แม้กดไม่ได้ พร้อมบอกว่าติดอะไร — ซ่อนปุ่มแล้วผู้ใช้จะไม่รู้ว่าต้องทำอะไรต่อ
 */
function DatasetEntryCard() {
  const router = useRouter();
  const [eligibility, setEligibility] = useState<{ eligible: boolean; reason: string | null } | null>(
    null,
  );

  useEffect(() => {
    api
      .get<{ eligible: boolean; reason: string | null }>("/api/dataset-requests/eligibility")
      .then(setEligibility)
      .catch(() => undefined);
  }, []);

  return (
    <Card className="mb-6">
      <div className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-medium text-navy-800">ลงทะเบียนชุดข้อมูล</p>
          <p className="mt-0.5 text-sm text-ink-muted">
            {eligibility && !eligibility.eligible
              ? eligibility.reason
              : "ยื่นคำขอลงทะเบียนชุดข้อมูลของหน่วยงาน และติดตามสถานะการอนุมัติ"}
          </p>
        </div>
        <Button
          className="shrink-0"
          disabled={!eligibility?.eligible}
          onClick={() => router.push("/datasets")}
        >
          ไปที่ชุดข้อมูล
        </Button>
      </div>
    </Card>
  );
}

/** ป้ายกับค่าคนละขนาดตัวอักษร ต้องจัดตามเส้นฐาน ไม่งั้นค่าจะดูต่ำกว่าป้ายเล็กน้อยทุกแถว */
function Rows({ rows }: { rows: Array<[string, string | null | undefined]> }) {
  return (
    <dl className="divide-y divide-line">
      {rows.map(([label, value]) => (
        <div
          key={label}
          className="grid gap-1 px-6 py-3.5 sm:grid-cols-[11rem_minmax(0,1fr)] sm:items-baseline sm:gap-4"
        >
          <dt className="text-sm text-ink-muted">{label}</dt>
          <dd className={value ? "text-[15px] text-ink" : "text-[15px] text-ink-subtle"}>{value || "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

/** ปิดบังเลขบัตรบางส่วน — ไม่จำเป็นต้องเห็นเต็มในหน้าจอตรวจสอบ */
function maskId(id: string | null): string {
  if (!id) return "";
  const d = id.replace(/\D/g, "");
  if (d.length !== 13) return id;
  return `${d[0]}-${d.slice(1, 5)}-xxxxx-xx-${d[12]}`;
}
