"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { PdfViewer } from "@/components/organization/PdfViewer";
import { Timeline } from "@/components/organization/Timeline";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, DatasetStatusBadge } from "@/components/ui/Card";
import { SelectField, TextAreaField } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";
import { useToast } from "@/components/ui/Toast";
import { api, ApiError } from "@/lib/api";
import { useRequireAuth } from "@/lib/require-auth";
import { taskEventLabel, formatThaiDate } from "@/lib/status";
import {
  DATA_CATEGORY_LABELS,
  DATA_CLASSIFICATION_LABELS,
  DATA_FORMAT_LABELS,
  DATA_TOPIC_LABELS,
  DATA_TYPE_LABELS,
  DELIVERY_FREQUENCY_LABELS,
  GEO_COVERAGE_LABELS,
  LICENSE_LABELS,
  PERSONAL_DATA_PERIOD_LABELS,
  formRules,
  formatUpdateFrequency,
  splitTags,
  toFormState,
} from "@/lib/dataset-form";
import {
  DATASET_ATTACHMENT_LABELS,
  datasetTitle,
  fullName,
  type DatasetRequest,
  type SpecialistOption,
} from "@/lib/types";

/** สิ่งที่ผู้ใช้ปัจจุบันทำได้กับคำขอนี้ — สะท้อน decide() ใน backend/src/routes/dataset-requests.ts */
function decideAbility(request: DatasetRequest, roles: string[], userId: string, email: string) {
  const isOfficer = roles.includes("BDI_OFFICER");
  const isSpecialist = request.assignedSpecialist?.id === userId;
  const isOrgApprover =
    request.organization.signatoryEmail?.toLowerCase() === email.toLowerCase() ||
    roles.includes("ORGANIZATION_APPROVER");

  /**
   * ด่าน BDI_OFFICER_REVIEW ถูกใช้สองรอบ และหน้าจอต้องพูดคนละอย่าง
   *
   * รอบแรกคือตรวจก่อนส่งให้หน่วยงานลงนาม รอบสองคือ "ตรวจซ้ำ" หลังลงนามแล้ว
   * ซึ่งกดแล้วไปหาผู้อนุมัติ BDI ไม่ได้ย้อนกลับไปหาผู้มีอำนาจอีก — ทั้งสองรอบใช้
   * task_type เดียวกัน จึงต้องดูจากว่า ORGANIZATION_APPROVAL ปิดไปแล้วหรือยัง
   * (กติกาเดียวกับที่ backend ใช้ตัดสิน ดู lib/workflow.ts)
   */
  const organizationSigned = request.events.some(
    (event) => event.taskType === "ORGANIZATION_APPROVAL" && event.result === "APPROVED",
  );

  switch (request.currentTaskType) {
    case "BDI_OFFICER_REVIEW":
      if (isOfficer) {
        return organizationSigned
          ? {
              advanceLabel: "ยืนยันผลการตรวจสอบ",
              hint: "ผู้มีอำนาจของหน่วยงานลงนามแล้ว ตรวจซ้ำแล้วยืนยันเพื่อส่งให้ผู้อนุมัติ BDI",
              canRevise: true,
              canAssign: false,
              canComment: false,
              canReject: false,
            }
          : {
              advanceLabel: "ส่งต่อให้ผู้มีอำนาจของหน่วยงาน",
              hint: "ตรวจว่าข้อมูลเพียงพอหรือไม่ มอบหมายผู้เชี่ยวชาญได้ก่อนส่งต่อ",
              canRevise: true,
              canAssign: true,
              canComment: false,
              canReject: false,
            };
      }
      return null;

    case "DATASET_SPECIALIST_REVIEW":
      if (isSpecialist || roles.includes("BDI_DATASET_SPECIALIST")) {
        return {
          advanceLabel: null,
          hint: "คุณได้รับมอบหมายให้ตรวจชุดข้อมูลนี้ บันทึกความเห็นหรือส่งกลับให้แก้ไขได้",
          canRevise: true,
          canAssign: false,
          canComment: true,
          canReject: false,
        };
      }
      /**
       * เจ้าหน้าที่ BDI ที่มอบหมายไป **ถอนการมอบหมายได้** (§4.4 ข้อ 2) และ backend
       * รองรับอยู่แล้วด้วย `specialistId: null` — แต่การ์ดนี้เคยหายไปทั้งใบเมื่อคำขอ
       * ย้ายไปด่านผู้เชี่ยวชาญ เจ้าหน้าที่จึงกดถอนไม่ได้เลย และคำขอค้างอยู่ที่
       * ผู้เชี่ยวชาญจนกว่าเขาจะลงมือ ไม่มีทางออกจากหน้าจอ
       */
      if (isOfficer) {
        return {
          advanceLabel: null,
          hint: "คำขอนี้อยู่ระหว่างการพิจารณาของผู้เชี่ยวชาญ ถอนการมอบหมายเพื่อดึงกลับมาตรวจเองได้",
          canRevise: false,
          canAssign: true,
          canComment: false,
          canReject: false,
        };
      }
      return null;

    case "ORGANIZATION_APPROVAL":
      return isOrgApprover
        ? {
            advanceLabel: "เห็นชอบและลงนาม",
            hint: "ตรวจแบบฟอร์มและเอกสารในฐานะผู้มีอำนาจกระทำการแทน",
            canRevise: true,
            canAssign: false,
            canComment: false,
            canReject: false,
          }
        : null;

    case "BDI_FINAL_APPROVAL":
      return roles.includes("BDI_FINAL_APPROVER")
        ? {
            advanceLabel: "อนุมัติ",
            hint: "ขั้นตอนสุดท้าย เมื่ออนุมัติแล้วระบบจะออกเอกสารฉบับสมบูรณ์ให้ดาวน์โหลด",
            canRevise: true,
            canAssign: false,
            canComment: false,
            canReject: true,
          }
        : null;

    default:
      return null;
  }
}

type ModalKind = "advance" | "revise" | "reject" | "comment" | "assign";

export function DatasetDetailView({ id, backHref }: { id: string; backHref?: string }) {
  const { user, ready } = useRequireAuth();
  const { show } = useToast();
  const router = useRouter();

  const [request, setRequest] = useState<DatasetRequest | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [specialists, setSpecialists] = useState<SpecialistOption[]>([]);
  const [modal, setModal] = useState<ModalKind | null>(null);
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState<string | undefined>();
  const [specialistId, setSpecialistId] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    () =>
      api
        .get<{ request: DatasetRequest }>(`/api/dataset-requests/${id}`)
        .then((d) => {
          setRequest(d.request);
          setSpecialistId(d.request.assignedSpecialist?.id ?? "");
        })
        .catch((err) => {
          // 404 = ไม่มีคำขอนี้ หรือไม่มีสิทธิ์เห็น — ต้องบอกให้ชัด
          // ปล่อยให้ค้างที่ spinner ผู้ใช้จะนึกว่าระบบแฮงก์
          if (err instanceof ApiError && err.status === 404) {
            setNotFound(true);
            return;
          }
          // 401 = ยังไม่ล็อกอิน หรือ session หมดอายุ — useRequireAuth พาไปหน้า
          // ล็อกอินอยู่แล้ว ไม่ต้องเตือนซ้ำ
          if (err instanceof ApiError && err.status === 401) return;
          show({ tone: "error", title: "โหลดข้อมูลไม่สำเร็จ" });
        }),
    [id, show],
  );

  useEffect(() => {
    // รอให้รู้ผลของ session ก่อน ยิงตอนยังไม่ล็อกอินได้แค่ 401
    if (!ready) return;
    void load();
  }, [load, ready]);

  useEffect(() => {
    if (!user?.roles.includes("BDI_OFFICER")) return;
    api
      .get<{ specialists: SpecialistOption[] }>("/api/dataset-requests/specialists")
      .then((d) => setSpecialists(d.specialists))
      .catch(() => undefined);
  }, [user]);

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
        <h1 className="mt-4 text-xl font-semibold text-navy-800">ไม่พบคำขอนี้</h1>
        <p className="mx-auto mt-2 max-w-md text-[15px] leading-relaxed text-ink-muted">
          คำขออาจถูกลบไปแล้ว หรือคุณไม่มีสิทธิ์เข้าถึงคำขอของหน่วยงานอื่น
        </p>
        <Link
          href={backHref ?? "/datasets"}
          className="mt-6 inline-block rounded-full border border-line px-5 py-2.5 text-sm font-medium text-navy-800 transition-colors hover:bg-navy-50"
        >
          กลับไปที่รายการ
        </Link>
      </div>
    );
  }

  if (!request || !user) return <Spinner />;

  const ability = decideAbility(request, user.roles, user.id, user.email);
  // ชีท conditions ตัดสินว่าช่องไหนถูกถามจริง — หน้ารายละเอียดจึงไม่ขึ้นหัวข้อที่ระบบไม่ได้ถาม
  // (เช่น รายละเอียดข้อมูลส่วนบุคคล เมื่อชุดข้อมูลตอบว่าไม่มีข้อมูลส่วนบุคคล)
  const rules = formRules(toFormState(request as unknown as Record<string, unknown>));
  const generated = request.attachments.find((a) => a.kind === "GENERATED_FORM");
  const supporting = request.attachments.filter((a) => a.kind !== "GENERATED_FORM");
  const editable = request.status === "DRAFT" || request.status === "RETURNED";
  const mayEdit =
    editable &&
    (request.createdBy?.id === user.id ||
      (user.roles.includes("ORGANIZATION_USER") && user.organizationId === request.organization.id));

  // §4.8 — เมื่อถูกส่งกลับต้องบอกให้ครบว่าแก้เรื่องอะไร โดยใคร เมื่อไหร่
  // "ขอให้ปรับปรุง" = review_task ที่ปิดด้วย result = RETURNED
  const lastRevision = [...request.events].reverse().find((e) => e.result === "RETURNED");

  const closeModal = () => {
    setModal(null);
    setNote("");
    setNoteError(undefined);
  };

  const act = async (action: "approve" | "request_revision" | "reject" | "comment") => {
    if ((action === "request_revision" || action === "reject") && note.trim().length < 10) {
      setNoteError(
        action === "reject"
          ? "กรุณาระบุเหตุผลที่ไม่อนุมัติอย่างน้อย 10 ตัวอักษร"
          : "กรุณาระบุสิ่งที่ต้องแก้ไขอย่างน้อย 10 ตัวอักษร",
      );
      return;
    }
    if (action === "comment" && note.trim().length === 0) {
      setNoteError("กรุณาพิมพ์ความเห็น");
      return;
    }

    setBusy(true);
    try {
      await api.post(`/api/dataset-requests/${id}/review`, {
        action,
        note: note.trim() || undefined,
      });
      show({
        tone: "success",
        title:
          action === "approve"
            ? "ดำเนินการเรียบร้อย"
            : action === "reject"
              ? "บันทึกผลไม่อนุมัติแล้ว"
              : action === "comment"
                ? "บันทึกความเห็นแล้ว"
                : "ส่งกลับให้แก้ไขแล้ว",
        detail: "ระบบแจ้งผู้เกี่ยวข้องทางอีเมลและในระบบแล้ว",
      });
      closeModal();
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

  const assign = async () => {
    setBusy(true);
    try {
      await api.post(`/api/dataset-requests/${id}/assign`, {
        specialistId: specialistId || null,
      });
      show({
        tone: "success",
        title: specialistId ? "มอบหมายผู้เชี่ยวชาญแล้ว" : "ยกเลิกการมอบหมายแล้ว",
      });
      closeModal();
      await load();
    } catch (err) {
      show({
        tone: "error",
        title: "มอบหมายไม่สำเร็จ",
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
          <p className="text-[13px] font-semibold uppercase tracking-wide text-coral-500">
            {request.requestNumber}
          </p>
          <h1 className="mt-1 break-words text-[26px] font-semibold text-navy-800">
            {datasetTitle(request)}
          </h1>
          <p className="mt-1.5 text-[15px] text-ink-muted">
            {request.organization.name}
            {request.createdBy ? (
              <>
                {" · ยื่นโดย "}
                {fullName(
                  request.createdBy.prefix,
                  request.createdBy.firstName,
                  request.createdBy.lastName,
                )}
              </>
            ) : null}
          </p>
        </div>
        <DatasetStatusBadge status={request.status} currentTaskType={request.currentTaskType} />
      </header>

      {request.status === "RETURNED" && request.revisionNote ? (
        <div className="mb-6 rounded-xl border-l-[3px] border-danger bg-danger-bg p-5">
          <p className="text-[13px] font-semibold text-danger">สิ่งที่ต้องแก้ไข</p>
          <p className="mt-1.5 whitespace-pre-wrap break-words text-[15px] leading-relaxed text-ink">
            {request.revisionNote}
          </p>
          {lastRevision ? (
            <p className="mt-2 text-[13px] text-ink-muted">
              โดย{" "}
              {lastRevision.actor ? lastRevision.actor.name : "ระบบ"}{" "}
              · {formatThaiDate(lastRevision.completedAt ?? lastRevision.createdAt)}
            </p>
          ) : null}
          {mayEdit ? (
            <Button size="sm" className="mt-4" onClick={() => router.push(`/datasets/${id}/edit`)}>
              แก้ไขคำขอ
            </Button>
          ) : null}
        </div>
      ) : null}

      {request.status === "REJECTED" && request.rejectionReason ? (
        <div className="mb-6 rounded-xl border-l-[3px] border-danger bg-danger-bg p-5">
          <p className="text-[13px] font-semibold text-danger">เหตุผลที่ไม่อนุมัติ</p>
          <p className="mt-1.5 whitespace-pre-wrap break-words text-[15px] leading-relaxed text-ink">
            {request.rejectionReason}
          </p>
          <p className="mt-2 text-[13px] text-ink-muted">
            โดย {request.rejectedByName ?? "—"} · {formatThaiDate(request.rejectedAt)}
          </p>
        </div>
      ) : null}

      {request.status === "APPROVED" ? (
        <div className="mb-6 rounded-xl border-l-[3px] border-success bg-success-bg p-5">
          <p className="text-[13px] font-semibold text-success">อนุมัติให้ลงทะเบียนชุดข้อมูลแล้ว</p>
          <p className="mt-1.5 text-[15px] text-ink">
            โดย {request.approvedByName ?? "—"} · {formatThaiDate(request.approvedAt)}
          </p>
        </div>
      ) : null}

      {request.status === "DRAFT" && mayEdit ? (
        <Card className="mb-6 border-l-[3px] border-l-coral-500">
          <div className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium text-navy-800">คำขอนี้ยังเป็นฉบับร่าง</p>
              <p className="mt-0.5 text-sm text-ink-muted">กรอกข้อมูลให้ครบแล้วนำส่งเพื่อเข้าสู่การตรวจสอบ</p>
            </div>
            <Button onClick={() => router.push(`/datasets/${id}/edit`)}>กรอกข้อมูลต่อ</Button>
          </div>
        </Card>
      ) : null}

      {ability ? (
        <Card className="mb-6 border-l-[3px] border-l-coral-500">
          <div className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium text-navy-800">รอการพิจารณาของคุณ</p>
              <p className="mt-0.5 text-sm text-ink-muted">{ability.hint}</p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-3">
              {ability.canAssign ? (
                <Button variant="ghost" onClick={() => setModal("assign")}>
                  {request.assignedSpecialist ? "เปลี่ยนหรือถอนผู้เชี่ยวชาญ" : "มอบหมายผู้เชี่ยวชาญ"}
                </Button>
              ) : null}
              {ability.canComment ? (
                <Button variant="ghost" onClick={() => setModal("comment")}>
                  บันทึกความเห็น
                </Button>
              ) : null}
              {ability.canRevise ? (
                <Button variant="secondary" onClick={() => setModal("revise")}>
                  ต้องปรับปรุง
                </Button>
              ) : null}
              {ability.canReject ? (
                <Button variant="danger" onClick={() => setModal("reject")}>
                  ไม่อนุมัติ
                </Button>
              ) : null}
              {ability.advanceLabel ? (
                <Button onClick={() => setModal("advance")}>{ability.advanceLabel}</Button>
              ) : null}
            </div>
          </div>
        </Card>
      ) : null}

      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader tag="ส่วนที่ 1" title="ประเภทและชื่อชุดข้อมูล" />
          <Rows
            rows={[
              ["ประเภทข้อมูล", pick(DATA_TYPE_LABELS, request.dataType)],
              ["ประเด็น", pick(DATA_TOPIC_LABELS, request.dataTopic)],
              ...(rules.dataTopicOther.visible
                ? ([["ประเด็นอื่น ๆ", request.dataTopicOther]] as DetailRow[])
                : []),
              ["ชื่อชุดข้อมูล (ภาษาไทย)", request.title],
              ["ชื่อชุดข้อมูล (ภาษาอังกฤษ)", request.name],
              ["องค์กร", request.organization.name],
              ["ชื่อผู้ติดต่อ", request.maintainer],
              ["อีเมลผู้ติดต่อ", request.maintainerEmail],
              ["คำสำคัญ", splitTags(request.tagString).join(" · ")],
              ["รายละเอียด", request.notes],
              ["วัตถุประสงค์", request.objective],
            ]}
          />
        </Card>

        <Card>
          <CardHeader tag="ส่วนที่ 2" title="ความถี่ ขอบเขต และรูปแบบการนำส่ง" />
          <Rows
            rows={[
              [
                "ความถี่ของการปรับปรุงข้อมูลต้นทาง",
                formatUpdateFrequency(request.updateFrequencyUnit, request.updateFrequencyInterval),
              ],
              [
                "ความถี่ของการนำส่งข้อมูลเข้าสู่ระบบกลาง",
                pick(DELIVERY_FREQUENCY_LABELS, request.deliveryFrequency),
              ],
              ["ความละเอียดเชิงภูมิศาสตร์", pick(GEO_COVERAGE_LABELS, request.geoCoverage)],
              ["แหล่งที่มาของข้อมูล", request.dataSource],
              ["รูปแบบการนำส่งข้อมูล", pick(DATA_FORMAT_LABELS, request.dataFormat)],
              ...(rules.dataFormatOther.visible
                ? ([["ชื่อระบบเชื่อมโยงข้อมูล", request.dataFormatOther]] as DetailRow[])
                : []),
            ]}
          />
        </Card>

        <Card>
          <CardHeader tag="ส่วนที่ 3" title="หมวดหมู่ ระดับชั้น และสัญญาอนุญาต" />
          <Rows
            rows={[
              ["หมวดหมู่ข้อมูลตามธรรมาภิบาลภาครัฐ", pick(DATA_CATEGORY_LABELS, request.dataCategory)],
              [
                "มีข้อมูลส่วนบุคคล",
                request.containsPersonalData === null
                  ? null
                  : request.containsPersonalData
                    ? "มี"
                    : "ไม่มี",
              ],
              ...((rules.personalDataDetail.visible
                ? [
                    ["ประเภทของข้อมูลส่วนบุคคล", request.personalDataTypes],
                    ["กลุ่มหรือประเภทของเจ้าของข้อมูลส่วนบุคคล", request.dataSubjectCategories],
                    [
                      "ระยะเวลาประมวลผลข้อมูลส่วนบุคคล",
                      rules.personalDataPeriodAmount.visible
                        ? personalDataPeriod(request)
                        : pick(PERSONAL_DATA_PERIOD_LABELS, request.personalDataProcessingPeriod),
                    ],
                  ]
                : []) as DetailRow[]),
              ["ระดับชั้นข้อมูล", pick(DATA_CLASSIFICATION_LABELS, request.dataClassification)],
              ["สัญญาอนุญาตให้ใช้ข้อมูล", pick(LICENSE_LABELS, request.licenseId)],
            ]}
          />
        </Card>

        <Card>
          <CardHeader tag="ส่วนที่ 4" title="การจัดเก็บและส่งต่อข้อมูล" />
          <Rows
            rows={[
              [
                "จัดเก็บข้อมูลดิบต้นฉบับไว้แม้ถูกแปลงสภาพแล้ว",
                grant(request.allowOriginalRawDataRetention),
              ],
              [
                "ส่งต่อข้อมูลดิบต้นฉบับให้หน่วยงานของรัฐอื่น",
                grant(request.allowOriginalRawDataSharing),
              ],
              [
                "ส่งต่อข้อมูลดิบแปลงสภาพไปยังระบบเชื่อมโยงข้อมูลอื่น",
                grant(request.allowTransformedRawDataSharing),
              ],
              ...(rules.transformedRawDataRecipients.visible
                ? ([["หน่วยงานปลายทางที่อนุญาต", request.transformedRawDataRecipients]] as DetailRow[])
                : []),
              [
                "ส่งต่อข้อมูลดิบแปลงสภาพไปยัง GDX",
                grant(request.allowTransformedRawDataGdxSharing),
              ],
              ...(rules.transformedRawDataGdxRecipients.visible
                ? ([
                    ["หน่วยงานที่อนุญาตให้รับข้อมูลผ่าน GDX", request.transformedRawDataGdxRecipients],
                  ] as DetailRow[])
                : []),
              ["ส่งต่อข้อมูลรวม (aggregated data)", grant(request.allowAggregatedDataSharing)],
              ...(rules.aggregatedDataRecipients.visible
                ? ([
                    ["หน่วยงานปลายทางที่อนุญาตให้รับข้อมูลรวม", request.aggregatedDataRecipients],
                  ] as DetailRow[])
                : []),
              ...(rules.authorizePersonalDataAnonymization.visible
                ? ([
                    [
                      "มอบหมายให้สำนักงานแปลงข้อมูลส่วนบุคคลให้ไม่สามารถระบุตัวตนได้",
                      request.authorizePersonalDataAnonymization === null
                        ? null
                        : request.authorizePersonalDataAnonymization
                          ? "มอบหมาย"
                          : "ไม่มอบหมาย",
                    ],
                  ] as DetailRow[])
                : []),
              [
                "ยอมรับเงื่อนไขการนำส่งข้อมูล",
                request.legalAcceptedAt ? `ยอมรับเมื่อ ${formatThaiDate(request.legalAcceptedAt)}` : null,
              ],
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
                    <p className="text-sm font-medium text-ink">{DATASET_ATTACHMENT_LABELS[a.kind]}</p>
                    <p className="truncate text-[13px] text-ink-muted">{a.filename}</p>
                  </div>
                  <a
                    href={api.fileUrl(`/api/dataset-requests/${request.id}/attachments/${a.id}`)}
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
            <CardHeader
              title={request.status === "APPROVED" ? "เอกสารฉบับอนุมัติ" : "แบบฟอร์มที่ระบบสร้าง"}
              description="เอกสาร A4 ดาวน์โหลดได้"
            />
            <div className="p-6">
              <PdfViewer
                url={api.fileUrl(`/api/dataset-requests/${request.id}/attachments/${generated.id}`)}
                filename={generated.filename}
                title="แบบฟอร์มลงทะเบียนชุดข้อมูล"
              />
            </div>
          </Card>
        ) : null}

        {request.assignedSpecialist ? (
          <Card>
            <CardHeader title="ผู้เชี่ยวชาญที่ได้รับมอบหมาย" />
            <Rows
              rows={[
                [
                  "ชื่อ",
                  fullName(
                    null,
                    request.assignedSpecialist.firstName,
                    request.assignedSpecialist.lastName,
                  ),
                ],
                ["อีเมล", request.assignedSpecialist.email],
                ["มอบหมายเมื่อ", request.assignedAt ? formatThaiDate(request.assignedAt) : null],
              ]}
            />
          </Card>
        ) : null}

        <Card>
          <CardHeader
            title="ประวัติการดำเนินการ"
            description={`สร้างเมื่อ ${formatThaiDate(request.createdAt)}`}
          />
          <Timeline events={request.events} />
        </Card>
      </div>

      <Modal
        open={modal === "revise"}
        onClose={closeModal}
        title="ระบุสิ่งที่ต้องปรับปรุง"
        description="ข้อความนี้จะถูกส่งทางอีเมลและแจ้งเตือนในระบบให้ผู้ใช้ของหน่วยงาน"
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
          placeholder="เช่น พจนานุกรมข้อมูลยังไม่ระบุชนิดข้อมูลของแต่ละคอลัมน์"
        />
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="secondary" onClick={closeModal}>
            ยกเลิก
          </Button>
          <Button variant="danger" loading={busy} onClick={() => act("request_revision")}>
            ยืนยันส่งกลับแก้ไข
          </Button>
        </div>
      </Modal>

      <Modal
        open={modal === "reject"}
        onClose={closeModal}
        title="ไม่อนุมัติคำขอ"
        description="เมื่อยืนยันแล้วคำขอจะสิ้นสุดกระบวนการและแก้ไขต่อไม่ได้"
      >
        <TextAreaField
          label="เหตุผลที่ไม่อนุมัติ"
          required
          value={note}
          error={noteError}
          onChange={(e) => {
            setNote(e.target.value);
            setNoteError(undefined);
          }}
        />
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="secondary" onClick={closeModal}>
            ยกเลิก
          </Button>
          <Button variant="danger" loading={busy} onClick={() => act("reject")}>
            ยืนยันไม่อนุมัติ
          </Button>
        </div>
      </Modal>

      <Modal
        open={modal === "comment"}
        onClose={closeModal}
        title="บันทึกความเห็นของผู้เชี่ยวชาญ"
        description="ความเห็นจะปรากฏในประวัติการดำเนินการ โดยไม่เปลี่ยนสถานะคำขอ"
      >
        <TextAreaField
          label="ความเห็น"
          required
          value={note}
          error={noteError}
          onChange={(e) => {
            setNote(e.target.value);
            setNoteError(undefined);
          }}
        />
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="secondary" onClick={closeModal}>
            ยกเลิก
          </Button>
          <Button loading={busy} onClick={() => act("comment")}>
            บันทึกความเห็น
          </Button>
        </div>
      </Modal>

      <Modal
        open={modal === "assign"}
        onClose={closeModal}
        title="มอบหมายผู้เชี่ยวชาญข้อมูล"
        description="เลือกจากบัญชีผู้เชี่ยวชาญที่เปิดใช้งานแล้วในระบบ — ไม่บังคับ"
      >
        <SelectField
          label="ผู้เชี่ยวชาญ"
          value={specialistId}
          onChange={(e) => setSpecialistId(e.target.value)}
        >
          <option value="">ไม่มอบหมาย</option>
          {specialists.map((s) => (
            <option key={s.id} value={s.id}>
              {fullName(s.prefix, s.firstName, s.lastName)} · {s.email}
            </option>
          ))}
        </SelectField>
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="secondary" onClick={closeModal}>
            ยกเลิก
          </Button>
          <Button loading={busy} onClick={assign}>
            บันทึก
          </Button>
        </div>
      </Modal>

      <Modal
        open={modal === "advance"}
        onClose={closeModal}
        title={ability?.advanceLabel ?? "ยืนยัน"}
        description="ยืนยันว่าคุณตรวจสอบข้อมูลและเอกสารทั้งหมดเรียบร้อยแล้ว"
      >
        <p className="text-[15px] leading-relaxed text-ink-muted">
          ระบบจะบันทึกการตัดสินใจนี้พร้อมชื่อและเวลาของคุณ และแจ้งผู้เกี่ยวข้องในขั้นถัดไป
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="secondary" onClick={closeModal}>
            ยกเลิก
          </Button>
          <Button loading={busy} onClick={() => act("approve")}>
            {ability?.advanceLabel}
          </Button>
        </div>
      </Modal>
    </div>
  );
}

/** ป้ายกับค่าคนละขนาดตัวอักษร ต้องจัดตามเส้นฐาน ไม่งั้นค่าจะดูต่ำกว่าป้ายเล็กน้อยทุกแถว */
type DetailRow = [string, string | null | undefined];

function Rows({ rows }: { rows: DetailRow[] }) {
  return (
    <dl className="divide-y divide-line">
      {rows.map(([label, value]) => (
        <div
          key={label}
          className="grid gap-1 px-6 py-3.5 sm:grid-cols-[13rem_minmax(0,1fr)] sm:items-baseline sm:gap-4"
        >
          <dt className="text-sm text-ink-muted">{label}</dt>
          <dd
            className={
              value
                ? // break-words: ค่าที่ผู้ใช้กรอกเองอาจเป็นสตริงยาวที่ไม่มีช่องว่างเลย
                  // (endpoint, อีเมล, หมายเหตุ) ซึ่งไม่มีจุดให้ตัดบรรทัดและจะดันทะลุการ์ดออกไป
                  "whitespace-pre-wrap break-words text-[15px] text-ink"
                : "text-[15px] text-ink-subtle"
            }
          >
            {value || "—"}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function pick<T extends Record<string, string>>(map: T, key: string | null): string | null {
  return key ? (map[key as keyof T] ?? key) : null;
}

/** 13.2.3 ปีกับเดือนอ่านรวมเป็นประโยคเดียว */
function personalDataPeriod(request: DatasetRequest): string | null {
  const parts: string[] = [];
  if (request.personalDataProcessingPeriodYear) {
    parts.push(`${request.personalDataProcessingPeriodYear.toLocaleString("th-TH")} ปี`);
  }
  if (request.personalDataProcessingPeriodMonth) {
    parts.push(`${request.personalDataProcessingPeriodMonth.toLocaleString("th-TH")} เดือน`);
  }
  return parts.length > 0 ? parts.join(" ") : null;
}

const grant = (value: boolean | null) => (value === null ? null : value ? "อนุญาต" : "ไม่อนุญาต");
