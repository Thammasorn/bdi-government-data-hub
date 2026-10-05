"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { api } from "@/lib/api";
import { useDatasetChoices, type ChoiceFieldKey } from "@/lib/dataset-choices";
import type { RequestStatus } from "@/lib/status";
import { useAdminData } from "@/lib/use-admin";

import { ActionDialog } from "./ActionDialog";
import { SnapshotEditor, type SnapshotSection } from "./SnapshotEditor";
import { WarningList } from "./ui";

type Kind = "organizations" | "datasets";

interface RequestValues extends Record<string, unknown> {
  id: string;
  requestNumber: string;
  status: RequestStatus;
}

/**
 * แถบคำสั่งของผู้ดูแลระบบเหนือหน้ารายละเอียดคำขอ — สิ่งที่หน่วยงานและเจ้าหน้าที่ BDI ทำเองไม่ได้
 *
 * หน้ารายละเอียดข้างล่างเป็นตัวเดียวกับของเจ้าหน้าที่ BDI (`DetailView`) แต่ไม่มีปุ่มของด่านไหน เพราะผู้ดูแลระบบไม่อยู่ใน
 * `TASK_TYPE_ROLES` ผู้ดูแลจึงอ่านได้ทุกอย่างที่ผู้ตรวจเห็น แล้วสั่งได้เฉพาะสี่อย่างนี้:
 *
 * - **แก้เนื้อคำขอ** — `PUT` ทุกสถานะ ด่านไม่ขยับ
 * - **ปรับกลับเป็นฉบับร่าง** — ปิดรอบนี้ (ด่านที่ค้างเป็น CANCELLED) คืนคำขอให้หน่วยงานแก้แล้วนำส่งใหม่ ฝั่งหน่วยงานเลือกได้ว่า
 *   จะถอดผู้มีอำนาจฯ ที่เปิดใช้งานแล้วด้วยไหม
 * - **ยกเลิกคำขอ** — ปิดเรื่อง แถวยังอยู่ ทางกลับคือปรับกลับเป็นฉบับร่าง
 * - **ลบ** (เฉพาะชุดข้อมูล) — เอาคำขอออกจากระบบทั้งใบ รวมชุดข้อมูลที่อนุมัติไปแล้ว
 *
 * ปุ่มที่ API จะปฏิเสธด้วยสถานะ (อนุมัติแล้ว ยกเลิกแล้ว) ไม่แสดง แทนที่จะกดแล้วได้ 409
 */
export function RegistrationAdminPanel({
  kind,
  id,
  onChanged,
}: {
  kind: Kind;
  id: string;
  onChanged: () => void;
}) {
  const router = useRouter();
  const { show } = useToast();
  const detailPath = kind === "organizations" ? `/api/organizations/${id}` : `/api/dataset-requests/${id}`;
  const { data, reload } = useAdminData<{ organization?: RequestValues; request?: RequestValues }>(detailPath);
  const values = data ? (kind === "organizations" ? data.organization : data.request) : undefined;
  const { choices } = useDatasetChoices();
  const sections = useMemo(
    () => (kind === "organizations" ? ORGANIZATION_SECTIONS : datasetSections(choices)),
    [kind, choices],
  );
  const [dialog, setDialog] = useState<"edit" | "reset" | "cancel" | "delete" | null>(null);
  const [removeApprover, setRemoveApprover] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);

  if (!values) return null;
  const status = values.status;
  const base = `/api/admin/registrations/${kind}/${values.id}`;
  const close = () => setDialog(null);
  const after = (title: string, detail?: string, w: string[] = []) => {
    setWarnings(w);
    show({ tone: "success", title, detail });
    reload();
    onChanged();
  };

  const canReset = status !== "APPROVED" && (status !== "DRAFT" || kind === "organizations");
  const canCancel = status !== "APPROVED" && status !== "CANCELLED";

  return (
    <section className="mb-6 rounded-2xl bg-navy-800 px-5 py-4 text-white shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-coral-300">คำสั่งของผู้ดูแลระบบ</p>
          <p className="text-[14px] text-navy-100">
            {values.requestNumber} — ทุกคำสั่งต้องระบุเหตุผล และหน่วยงานได้รับแจ้งพร้อมเหตุผลนั้น
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => setDialog("edit")}>
            แก้เนื้อคำขอ
          </Button>
          {canReset ? (
            <Button size="sm" variant="secondary" onClick={() => setDialog("reset")}>
              ปรับกลับเป็นฉบับร่าง
            </Button>
          ) : null}
          {canCancel ? (
            <Button size="sm" variant="secondary" onClick={() => setDialog("cancel")}>
              ยกเลิกคำขอ
            </Button>
          ) : null}
          {kind === "datasets" ? (
            <Button size="sm" variant="danger" onClick={() => setDialog("delete")}>
              ลบออกจากระบบ
            </Button>
          ) : null}
        </div>
      </div>
      <WarningList warnings={warnings} className="mt-3 text-ink" />

      <SnapshotEditor
        open={dialog === "edit"}
        onClose={close}
        title={`แก้เนื้อคำขอ ${values.requestNumber}`}
        sections={sections}
        values={values}
        onSubmit={async (changed, reason) => {
          const res = await api.put<{ fieldsChanged?: string[]; warnings?: string[] }>(base, { ...changed, reason });
          after("บันทึกการแก้ไขแล้ว", `${res.fieldsChanged?.length ?? 0} ช่อง`, res.warnings ?? []);
        }}
      />
      <ActionDialog
        open={dialog === "reset"}
        onClose={close}
        title="ปรับกลับเป็นฉบับร่าง"
        description="ด่านที่ค้างอยู่ถูกปิด ประวัติการตรวจยังอยู่ครบ คำขอกลับไปให้หน่วยงานแก้แล้วนำส่งใหม่ตั้งแต่ขั้นแรก"
        confirmLabel="ปรับกลับเป็นฉบับร่าง"
        tone="danger"
        reasonHint="หน่วยงานเห็นเหตุผลนี้ในการแจ้งเตือน"
        onConfirm={async (reason) => {
          const res = await api.post<{ message?: string }>(`${base}/reset`, {
            reason,
            ...(kind === "organizations" ? { isRemoveApprover: removeApprover } : {}),
          });
          setRemoveApprover(false);
          after("ปรับกลับเป็นฉบับร่างแล้ว", undefined, res.message ? [res.message] : []);
        }}
      >
        {kind === "organizations" ? (
          <label className="flex items-start gap-2.5 rounded-xl bg-canvas px-4 py-3 text-[14px]">
            <input
              type="checkbox"
              className="mt-1"
              checked={removeApprover}
              onChange={(e) => setRemoveApprover(e.target.checked)}
            />
            <span>
              <span className="font-medium text-ink">ถอดผู้มีอำนาจอนุมัติที่เปิดใช้งานบัญชีแล้วด้วย</span>
              <span className="block text-[13px] text-ink-muted">
                ใช้เมื่อหน่วยงานต้องเปลี่ยนตัวผู้ลงนาม — บัญชีของเขาถูกยุติการใช้งาน ช่องอีเมลและเลขบัตรในฟอร์มกลับมาแก้ได้
                ถ้ายังไม่เปิดใช้งาน คำเชิญถูกยกเลิกอยู่แล้วโดยไม่ต้องติ๊ก
              </span>
            </span>
          </label>
        ) : null}
      </ActionDialog>
      <ActionDialog
        open={dialog === "cancel"}
        onClose={close}
        title="ยกเลิกคำขอ"
        description="ปิดเรื่องโดยไม่มีใครต้องทำอะไรต่อ คำขอยังอยู่ในระบบในสถานะ “ยกเลิกแล้ว” — ถ้าสั่งผิด ปรับกลับเป็นฉบับร่างได้"
        confirmLabel="ยกเลิกคำขอ"
        tone="danger"
        reasonHint="หน่วยงานเห็นเหตุผลนี้"
        onConfirm={async (reason) => {
          const res = await api.post<{ warnings?: string[] }>(`${base}/cancel`, { reason });
          after("ยกเลิกคำขอแล้ว", undefined, res.warnings ?? []);
        }}
      />
      <ActionDialog
        open={dialog === "delete"}
        onClose={close}
        title="ลบคำขอออกจากระบบ"
        description={
          status === "APPROVED"
            ? "คำขอนี้อนุมัติแล้ว — ชุดข้อมูลที่เกิดจากคำขอถูกลบไปด้วย ย้อนกลับไม่ได้ ใช้กับคำขอที่ไม่ควรมีอยู่ (ยื่นผิด ทดสอบ) เท่านั้น"
            : "ลบทั้งใบพร้อมประวัติการตรวจและการแจ้งเตือน ย้อนกลับไม่ได้ ถ้าแค่ต้องการปิดเรื่อง ให้ใช้ “ยกเลิกคำขอ”"
        }
        confirmLabel="ลบถาวร"
        tone="danger"
        confirmPhrase={values.requestNumber}
        onConfirm={async (reason) => {
          await api.remove(base, { reason });
          show({ tone: "success", title: `ลบ ${values.requestNumber} แล้ว` });
          router.push("/console/registrations/datasets");
        }}
      />
    </section>
  );
}

const ORGANIZATION_SECTIONS: SnapshotSection[] = [
  {
    title: "ข้อมูลหน่วยงาน",
    fields: [
      { key: "organizationCode", label: "รหัสหน่วยงาน", type: "text" },
      { key: "organizationType", label: "ประเภทหน่วยงาน", type: "text" },
      { key: "name", label: "ชื่อหน่วยงาน", type: "text", wide: true },
      { key: "nameEn", label: "ชื่อหน่วยงาน (อังกฤษ)", type: "text", wide: true },
      { key: "addressLine", label: "ที่อยู่ (เลขที่ / อาคาร / ซอย)", type: "text" },
      { key: "road", label: "ถนน", type: "text" },
      { key: "province", label: "จังหวัด", type: "text" },
      { key: "district", label: "อำเภอ/เขต", type: "text" },
      { key: "subdistrict", label: "ตำบล/แขวง", type: "text" },
      { key: "postalCode", label: "รหัสไปรษณีย์", type: "text" },
      { key: "phone", label: "เบอร์โทรศัพท์", type: "text" },
      { key: "phoneExtension", label: "ต่อ", type: "text" },
      { key: "email", label: "อีเมลหน่วยงาน", type: "text" },
      { key: "websiteUrl", label: "เว็บไซต์", type: "text" },
    ],
  },
  {
    title: "ผู้มีอำนาจอนุมัติของหน่วยงาน",
    note: "ถ้าผู้มีอำนาจฯ เปิดใช้งานบัญชีแล้ว การเปลี่ยนอีเมลหรือเลขบัตรที่นี่ไม่เปลี่ยนตัวคนที่ลงนาม — ให้ปรับกลับเป็นฉบับร่างพร้อมถอดผู้มีอำนาจฯ แทน",
    fields: [
      { key: "signatoryPrefix", label: "คำนำหน้า", type: "text" },
      { key: "signatoryFirstName", label: "ชื่อ", type: "text" },
      { key: "signatoryLastName", label: "นามสกุล", type: "text" },
      { key: "signatoryPosition", label: "ตำแหน่ง", type: "text" },
      { key: "signatoryDepartment", label: "ฝ่าย/กอง/สำนัก", type: "text" },
      { key: "signatoryEmail", label: "อีเมล", type: "text" },
      { key: "signatoryNationalId", label: "เลขบัตรประชาชน", type: "text" },
      { key: "signatoryPhone", label: "เบอร์โทรศัพท์", type: "text" },
      { key: "signatoryPhoneExtension", label: "ต่อ", type: "text" },
    ],
  },
  {
    title: "ผู้ประสานงานของหน่วยงาน",
    fields: [
      { key: "contactPrefix", label: "คำนำหน้า", type: "text" },
      { key: "contactFirstName", label: "ชื่อ", type: "text" },
      { key: "contactLastName", label: "นามสกุล", type: "text" },
      { key: "contactPosition", label: "ตำแหน่ง", type: "text" },
      { key: "contactDepartment", label: "ฝ่าย/กอง/สำนัก", type: "text" },
      { key: "contactEmail", label: "อีเมล", type: "text" },
      { key: "contactNationalId", label: "เลขบัตรประชาชน", type: "text" },
      { key: "contactPhone", label: "เบอร์โทรศัพท์", type: "text" },
      { key: "contactPhoneExtension", label: "ต่อ", type: "text" },
    ],
  },
];

/** ช่องของแบบฟอร์มชุดข้อมูล — ชื่อตรงกับ `datasetDraftSchema` (backend/src/lib/dataset.ts) ป้ายตามหน้าฟอร์มของหน่วยงาน */
function datasetSections(choices: Record<ChoiceFieldKey, Array<{ code: string; label: string }>>): SnapshotSection[] {
  const choice = (key: ChoiceFieldKey, label: string) => ({ key, label, type: "choice" as const, options: choices[key] });
  return [
    {
      title: "ข้อมูลทั่วไป",
      fields: [
        choice("dataType", "ประเภทข้อมูล"),
        choice("dataTopic", "ประเด็น"),
        { key: "dataTopicOther", label: "ระบุประเด็นอื่น ๆ", type: "text" },
        { key: "title", label: "ชื่อชุดข้อมูล (ภาษาไทย)", type: "text", wide: true },
        { key: "name", label: "ชื่อชุดข้อมูล (ภาษาอังกฤษ)", type: "text", wide: true },
        { key: "notes", label: "คำอธิบายชุดข้อมูล", type: "textarea" },
        { key: "dataFields", label: "รายการฟิลด์ข้อมูล", type: "textarea" },
        { key: "tagString", label: "คำสำคัญ", type: "text", wide: true },
        { key: "maintainer", label: "ผู้ดูแลชุดข้อมูล", type: "text" },
        { key: "maintainerEmail", label: "อีเมลผู้ดูแล", type: "text" },
      ],
    },
    {
      title: "วัตถุประสงค์และการส่งข้อมูล",
      fields: [
        { key: "objective", label: "วัตถุประสงค์", type: "choices", options: choices.objective },
        { key: "objectiveOther", label: "ระบุวัตถุประสงค์อื่น ๆ", type: "text", wide: true },
        choice("updateFrequencyUnit", "ความถี่ในการปรับปรุง (หน่วย)"),
        { key: "updateFrequencyInterval", label: "ความถี่ในการปรับปรุง (จำนวน)", type: "number" },
        choice("deliveryFrequency", "ความถี่ในการส่งข้อมูล"),
        choice("geoCoverage", "ขอบเขตเชิงพื้นที่"),
        { key: "geoCoverageOther", label: "ระบุขอบเขตอื่น ๆ", type: "text" },
        { key: "dataSource", label: "แหล่งที่มา", type: "text" },
        choice("dataFormat", "รูปแบบการส่งข้อมูล"),
        { key: "dataFormatOther", label: "ระบุรูปแบบอื่น ๆ", type: "text" },
      ],
    },
    {
      title: "ข้อมูลส่วนบุคคลและการจัดชั้น",
      fields: [
        choice("dataCategory", "หมวดหมู่ข้อมูล"),
        { key: "containsPersonalData", label: "มีข้อมูลส่วนบุคคล", type: "flag" },
        { key: "personalDataTypes", label: "ประเภทข้อมูลส่วนบุคคล", type: "textarea" },
        { key: "dataSubjectCategories", label: "กลุ่มเจ้าของข้อมูล", type: "textarea" },
        choice("personalDataProcessingPeriod", "ระยะเวลาประมวลผล"),
        { key: "personalDataProcessingPeriodYear", label: "จำนวนปี", type: "number" },
        { key: "personalDataProcessingPeriodMonth", label: "จำนวนเดือน", type: "number" },
        choice("dataClassification", "ระดับชั้นข้อมูล"),
        choice("licenseId", "สัญญาอนุญาต"),
      ],
    },
    {
      title: "การอนุญาต",
      fields: [
        { key: "allowOriginalRawDataRetention", label: "เก็บข้อมูลดิบต้นฉบับ", type: "flag" },
        { key: "allowOriginalRawDataSharing", label: "แบ่งปันข้อมูลดิบต้นฉบับ", type: "flag" },
        { key: "allowTransformedRawDataSharing", label: "แบ่งปันข้อมูลดิบที่แปลงแล้ว", type: "flag" },
        { key: "allowTransformedRawDataGdxSharing", label: "แบ่งปันผ่าน GDX", type: "flag" },
        { key: "allowAggregatedDataSharing", label: "แบ่งปันข้อมูลสรุป", type: "flag" },
        { key: "authorizePersonalDataAnonymization", label: "มอบหมายให้ทำข้อมูลนิรนาม", type: "flag" },
        {
          key: "allowTransformedRawDataSharingSpecifiedPlatforms",
          label: "แพลตฟอร์มที่อนุญาตให้แบ่งปัน",
          type: "textarea",
        },
      ],
    },
  ];
}
