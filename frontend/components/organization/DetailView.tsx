"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { LegalDocumentsCard, useLegalDocuments } from "@/components/organization/LegalDocuments";
import { SigningDialog } from "@/components/organization/SigningDialog";
import { Timeline } from "@/components/organization/Timeline";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, StatusBadge } from "@/components/ui/Card";
import { TextAreaField } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";
import { useToast } from "@/components/ui/Toast";
import { api, ApiError } from "@/lib/api";
import { useRequireAuth } from "@/lib/require-auth";
import { formatThaiDate } from "@/lib/status";
import { useOrganizationRegistration } from "@/lib/use-organization-registration";
import { ATTACHMENT_LABELS, fullName, type Organization } from "@/lib/types";

/** ผู้ใช้ปัจจุบันตัดสินใจกับคำขอนี้ได้หรือไม่ ขึ้นกับสถานะ + role */
function decideAbility(org: Organization, roles: string[], email: string) {
  switch (org.currentTaskType) {
    case "BDI_OFFICER_REVIEW":
      return roles.includes("BDI_OFFICER")
        ? { can: true, approveLabel: "อนุมัติ", hint: "ตรวจสอบข้อมูลและเอกสารก่อนส่งต่อให้ผู้มีอำนาจกระทำการแทน" }
        : { can: false };
    /**
     * สองด่านนี้อนุมัติด้วยการลงนามบนเอกสาร ปุ่มจึงเปิด SigningDialog ไม่ใช่ modal ยืนยันสั้น ๆ
     * `signing` บอกว่าต้องเดินขั้นตอนลงนาม และ `perDocument` บอกว่าต้องขึ้นเอกสารทีละฉบับ
     * ให้กดเห็นชอบก่อนหรือไม่ — การ์ดข้อ 4 เขียนไว้ว่าฝ่าย BDI "ไม่ต้องมีขึ้น เห็นชอบ ทีละเอกสาร"
     */
    case "ORGANIZATION_APPROVAL":
      return org.signatoryEmail?.toLowerCase() === email.toLowerCase()
        ? {
            can: true,
            approveLabel: "ผ่านการตรวจสอบ",
            hint: "โปรดตรวจสอบเอกสารในฐานะผู้มีอำนาจกระทำการแทน แล้วลงนามอิเล็กทรอนิกส์",
            signing: true,
            perDocument: true,
          }
        : { can: false };
    case "BDI_FINAL_APPROVAL":
      return roles.includes("BDI_FINAL_APPROVER")
        ? {
            can: true,
            approveLabel: "เห็นชอบและลงนาม",
            hint: "ขั้นตอนสุดท้าย เมื่อลงนามแล้วหน่วยงานจะเปิดใช้งานทันที",
            signing: true,
            perDocument: false,
          }
        : { can: false };
    default:
      return { can: false };
  }
}

export function OrganizationDetailView({ id, backHref }: { id: string; backHref?: string }) {
  const { user, ready } = useRequireAuth();
  const { show } = useToast();
  const router = useRouter();

  const [org, setOrg] = useState<Organization | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [modal, setModal] = useState<null | "approve" | "revise" | "sign">(null);
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const { start: startRegistration, starting } = useOrganizationRegistration();
  /**
   * ผูกกับ `org.id` ไม่ใช่ `id` บน URL
   *
   * พารามิเตอร์บน URL รับได้ทั้ง id ของคำขอและของหน่วยงาน — เมนู "หน่วยงานของฉัน"
   * ส่ง id ของหน่วยงานมา เหมือนที่ act() เตือนไว้ข้างล่าง ค่าที่โหลดมาแล้วเป็น id ของ
   * คำขอเสมอ ไม่ว่าจะเข้าหน้านี้มาทางไหน
   */
  const {
    documents: legalDocuments,
    error: legalDocumentsError,
    reload: reloadLegalDocuments,
  } = useLegalDocuments(org?.id ?? null);
  /** ขยับทุกครั้งที่โหลดเอกสารใหม่ — ใช้ทำลาย cache ของ iframe ที่ฝัง PDF ไว้ */
  const [documentRound, setDocumentRound] = useState(0);

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
        // 401 = session หมดอายุระหว่างเปิดหน้าค้างไว้ useRequireAuth กำลังพาไป
        // หน้าล็อกอินอยู่แล้ว เตือนซ้ำจะได้ทั้ง toast แดงและการเด้งหน้าพร้อมกัน
        if (err instanceof ApiError && err.status === 401) return;
        show({ tone: "error", title: "โหลดข้อมูลไม่สำเร็จ" });
      });

  useEffect(() => {
    // รอให้รู้ผลของ session ก่อน ยิงตอนยังไม่ล็อกอินได้แค่ 401
    if (!ready) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, ready]);

  if (notFound) {
    /**
     * เมนู "หน่วยงานของฉัน" ประกอบ URL จาก id ของหน่วยงาน ซึ่งยังไม่มีคำขอจดทะเบียน
     * ผูกอยู่เลยถ้าเจ้าหน้าที่เพิ่งสร้างหน่วยงานไว้ให้ — นั่นไม่ใช่ "ไม่พบ" แต่คือ
     * "ยังไม่ได้เริ่มกรอก" และเป็นจุดเริ่มต้นของเส้นทาง B พอดี
     */
    const ownOrganization = !!user?.organizationId && user.organizationId === id;
    if (ownOrganization) {
      return (
        <div className="mx-auto max-w-2xl px-4 py-20 text-center sm:px-6">
          <h1 className="text-[26px] font-semibold text-navy-800">ยังไม่ได้เริ่มลงทะเบียนหน่วยงาน</h1>
          <p className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-ink-muted">
            {user?.organization?.name ?? "หน่วยงานของคุณ"} ถูกสร้างไว้ในระบบแล้ว
            แต่ยังไม่มีแบบฟอร์มลงทะเบียนที่กรอกค้างไว้ กดปุ่มด้านล่างเพื่อเริ่มกรอก
            ระบบจะเติมข้อมูลที่เจ้าหน้าที่บันทึกไว้ให้เป็นค่าตั้งต้น
          </p>
          <Button size="lg" className="mt-8" loading={starting} onClick={startRegistration}>
            กรอกแบบฟอร์มลงทะเบียนหน่วยงาน
          </Button>
        </div>
      );
    }

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
  const supporting = org.attachments.filter((a) => a.kind !== "GENERATED_FORM");
  const isOwner = org.createdBy?.id === user.id;
  // เทียบกับ `org.organizationId` ไม่ใช่ `org.id` — `org.id` คือ id ของคำขอ การ์ด
  // "ลงทะเบียนชุดข้อมูล" จึงไม่เคยขึ้นให้ผู้ใช้หน่วยงานเห็นเลย
  const isMember =
    user.roles.includes("ORGANIZATION_USER") && user.organizationId === org.organizationId;
  // "ขอให้ปรับปรุง" = review_task ที่ปิดด้วย result = RETURNED (เหมือนฝั่งชุดข้อมูล)
  const lastRevision = [...org.events].reverse().find((e) => e.result === "RETURNED");

  const act = async (action: "approve" | "request_revision") => {
    if (action === "request_revision" && note.trim().length < 10) {
      setNoteError("กรุณาระบุสิ่งที่ต้องแก้ไขอย่างน้อย 10 ตัวอักษร");
      return;
    }
    setBusy(true);
    try {
      // `org.id` ไม่ใช่ `id` — พารามิเตอร์บน URL รับได้ทั้ง id ของคำขอและของหน่วยงาน
      // (เมนู "หน่วยงานของฉัน" ส่ง id ของหน่วยงานมา) แต่ `/review` รับเฉพาะ id ของคำขอ
      // ใช้ค่าที่โหลดมาแล้วจึงถูกเสมอ ไม่ว่าจะเข้าหน้านี้มาทางไหน
      await api.post(`/api/organizations/${org.id}/review`, {
        action,
        note: note.trim() || undefined,
      });
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
        {/* ชื่อผู้ยื่นและอีเมลอยู่ในการ์ด "ผู้กรอกข้อมูล" ด้านล่างอยู่แล้ว บรรทัดนี้พูดซ้ำ */}
        <div className="min-w-0">
          <h1 className="break-words text-[26px] font-semibold text-navy-800">{org.name}</h1>
        </div>
        <StatusBadge status={org.status} currentTaskType={org.currentTaskType} />
      </header>

      {/* ฉบับร่างที่ยังไม่ได้นำส่ง — หน้านี้เคยไม่มีทางกลับเข้าฟอร์มเลย ผู้ใช้ที่ปิดแท็บไป
          แล้วกดเมนู "หน่วยงานของฉัน" จึงเห็นข้อมูลค้างอยู่โดยไม่มีปุ่มให้ทำต่อ */}
      {org.status === "DRAFT" && isOwner ? (
        <Card className="mb-6 border-l-[3px] border-l-coral-500">
          <div className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium text-navy-800">ฉบับร่าง — ยังไม่ได้นำส่ง</p>
              <p className="mt-0.5 text-sm text-ink-muted">
                กรอกให้ครบแล้วกด &ldquo;ตรวจสอบและสร้างแบบฟอร์ม&rdquo; เพื่อนำส่งให้ BDI ตรวจสอบ
              </p>
            </div>
            <Button className="shrink-0" onClick={() => router.push(`/organizations/${org.id}/edit`)}>
              กรอกข้อมูลต่อ
            </Button>
          </div>
        </Card>
      ) : null}

      {org.status === "RETURNED" && org.revisionNote ? (
        <div className="mb-6 rounded-xl border-l-[3px] border-danger bg-danger-bg p-5">
          <p className="text-[13px] font-semibold text-danger">สิ่งที่ต้องแก้ไข</p>
          <p className="mt-1.5 whitespace-pre-wrap break-words text-[15px] leading-relaxed text-ink">{org.revisionNote}</p>
          {/* บอกให้ครบว่าแก้เรื่องอะไร **โดยใคร เมื่อไหร่** เหมือนฝั่งชุดข้อมูล
              — ข้อความล้วนไม่พอเมื่อคำขอถูกส่งกลับหลายรอบจากคนละด่าน */}
          {lastRevision ? (
            <p className="mt-2 text-[13px] text-ink-muted">
              โดย {lastRevision.actor ? lastRevision.actor.name : "ระบบ"} ·{" "}
              {formatThaiDate(lastRevision.completedAt ?? lastRevision.createdAt)}
            </p>
          ) : null}
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
              <Button onClick={() => setModal(ability.signing ? "sign" : "approve")}>
                {ability.approveLabel}
              </Button>
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
              ["ถนน", org.road],
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

        {org.status !== "DRAFT" ? (
          <LegalDocumentsCard
            documents={legalDocuments}
            reloadKey={documentRound}
            error={legalDocumentsError}
            onRetry={reloadLegalDocuments}
          />
        ) : null}

        <Card>
          <CardHeader title="ประวัติการดำเนินการ" description={`ยื่นเมื่อ ${formatThaiDate(org.submittedAt ?? org.createdAt)}`} />
          <Timeline events={org.events} />
        </Card>
      </div>

      {legalDocuments && legalDocuments.length > 0 ? (
        <SigningDialog
          open={modal === "sign"}
          onClose={() => setModal(null)}
          onSigned={() => {
            setModal(null);
            show({
              tone: "success",
              title: "ลงนามเรียบร้อย",
              detail: "ระบบประทับลายมือชื่อของคุณลงในเอกสารและแจ้งผู้เกี่ยวข้องแล้ว",
            });
            setDocumentRound((r) => r + 1);
            reloadLegalDocuments();
            void load();
          }}
          onStale={(message) => {
            setModal(null);
            show({ tone: "error", title: "คำขอเดินไปขั้นถัดไปแล้ว", detail: message });
            reloadLegalDocuments();
            void load();
          }}
          requestId={org.id}
          documents={legalDocuments}
          perDocument={ability.perDocument ?? false}
          signLabel={ability.approveLabel ?? "ลงนาม"}
        />
      ) : null}

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
          <dd className={value ? "break-words text-[15px] text-ink" : "text-[15px] text-ink-subtle"}>
            {value || "—"}
          </dd>
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
