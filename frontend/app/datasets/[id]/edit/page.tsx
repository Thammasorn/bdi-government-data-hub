"use client";

import clsx from "clsx";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";

import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { SelectField, TextAreaField, TextField } from "@/components/ui/Field";
import { FileUpload, type UploadedFile } from "@/components/ui/FileUpload";
import { Spinner } from "@/components/ui/Spinner";
import { useToast } from "@/components/ui/Toast";
import { api, ApiError } from "@/lib/api";
import {
  CLASSIFICATION_LABELS,
  DATASET_CATEGORY_LABELS,
  DATASET_TYPE_LABELS,
  DATA_FORMAT_LABELS,
  DELIVERY_METHOD_LABELS,
  ENDPOINT_REQUIRED_METHODS,
  FREQUENCY_LABELS,
  GEO_COVERAGE_LABELS,
  LICENSE_LABELS,
  optionsOf,
} from "@/lib/status";
import type { DatasetRequest } from "@/lib/types";

const EMPTY = {
  nameTh: "",
  nameEn: "",
  description: "",
  datasetType: "",
  category: "",
  updateFrequency: "",
  geoCoverage: "",
  dataStartDate: "",
  dataEndDate: "",
  estimatedRecords: "",
  stewardName: "",
  stewardEmail: "",
  stewardPhone: "",

  deliveryMethod: "",
  dataFormat: "",
  deliveryFrequency: "",
  deliveryEndpoint: "",
  technicalContactName: "",
  technicalContactEmail: "",
  deliveryNote: "",

  dataClassification: "",
  hasPersonalData: "",
  personalDataMeasure: "",
  legalBasis: "",
  licenseType: "",
  usageRestriction: "",
};
type FormState = typeof EMPTY;

/** ช่องที่เก็บเป็น enum ในฐานข้อมูล — ค่าว่างต้องส่ง null ไม่ใช่สตริงว่าง */
const ENUM_KEYS: Array<keyof FormState> = [
  "datasetType",
  "category",
  "updateFrequency",
  "geoCoverage",
  "deliveryMethod",
  "dataFormat",
  "deliveryFrequency",
  "dataClassification",
  "licenseType",
];

const SECTIONS = [
  { id: "section-1", tag: "ส่วนที่ 1", title: "ข้อมูลชุดข้อมูล" },
  { id: "section-2", tag: "ส่วนที่ 2", title: "วิธีการนำส่งข้อมูล" },
  { id: "section-3", tag: "ส่วนที่ 3", title: "เงื่อนไขทางกฎหมาย" },
  { id: "section-4", tag: "ส่วนที่ 4", title: "เอกสารแนบ" },
];

const REQUIRED_BY_SECTION: Record<string, Array<keyof FormState>> = {
  "section-1": [
    "nameTh",
    "description",
    "datasetType",
    "category",
    "updateFrequency",
    "geoCoverage",
    "stewardName",
    "stewardEmail",
    "stewardPhone",
  ],
  "section-2": [
    "deliveryMethod",
    "dataFormat",
    "deliveryFrequency",
    "technicalContactName",
    "technicalContactEmail",
  ],
  "section-3": ["dataClassification", "hasPersonalData", "legalBasis", "licenseType"],
};

export default function EditDatasetRequestPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const { show } = useToast();

  const [form, setForm] = useState<FormState>(EMPTY);
  const [keywords, setKeywords] = useState<string[]>([]);
  const [legalAccepted, setLegalAccepted] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [revisionNote, setRevisionNote] = useState<string | null>(null);
  const [requestNumber, setRequestNumber] = useState("");

  const [dictionary, setDictionary] = useState<UploadedFile | null>(null);
  const [example, setExample] = useState<UploadedFile | null>(null);
  const [uploadingKind, setUploadingKind] = useState<string | null>(null);

  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    api
      .get<{ request: DatasetRequest }>(`/api/dataset-requests/${id}`)
      .then(({ request }) => {
        const next = { ...EMPTY };
        for (const key of Object.keys(EMPTY) as Array<keyof FormState>) {
          const value = request[key as keyof DatasetRequest];
          if (typeof value === "string") next[key] = key.endsWith("Date") ? value.slice(0, 10) : value;
          if (typeof value === "number") next[key] = String(value);
        }
        next.hasPersonalData =
          request.hasPersonalData === null ? "" : request.hasPersonalData ? "yes" : "no";
        setForm(next);
        setKeywords(request.keywords);
        setLegalAccepted(Boolean(request.legalAcceptedAt));
        setRevisionNote(request.revisionNote);
        setRequestNumber(request.requestNumber);
        const find = (kind: string) => request.attachments.find((a) => a.kind === kind) ?? null;
        setDictionary(find("DATA_DICTIONARY"));
        setExample(find("EXAMPLE_DATA"));
      })
      .catch(() => show({ tone: "error", title: "โหลดข้อมูลไม่สำเร็จ" }))
      .finally(() => setLoading(false));
  }, [id, show]);

  const set = (key: keyof FormState, value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    clearError(key);
  };

  /** ล้าง error ของช่องที่เพิ่งแก้ ไม่งั้นขอบแดงค้างทั้งที่ผู้ใช้แก้ให้ถูกแล้ว */
  const clearError = (key: string) => setFields((f) => (f[key] ? { ...f, [key]: "" } : f));

  const completion = useMemo(() => {
    const done: Record<string, boolean> = {};
    for (const [section, keys] of Object.entries(REQUIRED_BY_SECTION)) {
      done[section] = keys.every((k) => form[k].trim().length > 0);
    }
    done["section-1"] = done["section-1"] && keywords.length > 0;
    done["section-3"] = done["section-3"] && legalAccepted;
    done["section-4"] = dictionary !== null;
    return done;
  }, [form, keywords, legalAccepted, dictionary]);

  const endpointRequired = ENDPOINT_REQUIRED_METHODS.includes(form.deliveryMethod);

  // ---------- actions ----------
  const payload = () => {
    const body: Record<string, unknown> = { keywords, legalAccepted };
    for (const key of Object.keys(EMPTY) as Array<keyof FormState>) {
      const raw = form[key].trim();
      if (key === "hasPersonalData") {
        body[key] = raw === "" ? null : raw === "yes";
      } else if (key === "estimatedRecords") {
        body[key] = raw === "" ? null : Number(raw);
      } else if (ENUM_KEYS.includes(key) || key.endsWith("Date")) {
        body[key] = raw === "" ? null : raw;
      } else {
        body[key] = raw === "" ? null : raw;
      }
    }
    return body;
  };

  const persist = () => api.patch<{ request: DatasetRequest }>(`/api/dataset-requests/${id}`, payload());

  const saveDraft = async () => {
    setSaving(true);
    try {
      await persist();
      show({ tone: "success", title: "บันทึกฉบับร่างแล้ว", detail: "กลับมากรอกต่อได้ภายหลัง" });
    } catch (err) {
      handleApiError(err);
    } finally {
      setSaving(false);
    }
  };

  const uploadFile = async (kind: "DATA_DICTIONARY" | "EXAMPLE_DATA", file: File) => {
    if (file.size > 10 * 1024 * 1024) {
      show({ tone: "error", title: "ไฟล์ใหญ่เกินไป", detail: "ขนาดไฟล์ต้องไม่เกิน 10 MB" });
      return;
    }
    setUploadingKind(kind);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("kind", kind);
    try {
      const { attachment } = await api.upload<{ attachment: UploadedFile }>(
        `/api/dataset-requests/${id}/attachments`,
        fd,
      );
      if (kind === "DATA_DICTIONARY") setDictionary(attachment);
      else setExample(attachment);
      setFields((f) => ({ ...f, [kind]: "" }));
      show({ tone: "success", title: "อัปโหลดไฟล์แล้ว" });
    } catch (err) {
      handleApiError(err);
    } finally {
      setUploadingKind(null);
    }
  };

  const handleApiError = (err: unknown) => {
    if (!(err instanceof ApiError)) return;
    setFields(err.fields);
    const count = Object.keys(err.fields).length;
    show({
      tone: "error",
      title: count > 0 ? "ข้อมูลยังไม่ถูกต้อง" : "ดำเนินการไม่สำเร็จ",
      detail: count > 0 ? `กรุณาตรวจสอบ ${count} รายการที่ทำเครื่องหมายไว้` : err.message,
    });
    if (count > 0) {
      const first = Object.keys(err.fields)[0];
      requestAnimationFrame(() => {
        formRef.current
          ?.querySelector<HTMLElement>(`[data-field="${first}"]`)
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    }
  };

  const generateForm = async (e: FormEvent) => {
    e.preventDefault();
    setGenerating(true);
    setFields({});
    try {
      await persist();
      await api.post(`/api/dataset-requests/${id}/generate-form`);
      router.push(`/datasets/${id}/preview`);
    } catch (err) {
      handleApiError(err);
      setGenerating(false);
    }
  };

  if (loading) return <Spinner />;

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <header className="mb-8">
        <p className="text-[13px] font-semibold uppercase tracking-wide text-coral-500">
          {requestNumber}
        </p>
        <h1 className="mt-1 text-[26px] font-semibold text-navy-800">ลงทะเบียนชุดข้อมูล</h1>
        <p className="mt-1.5 text-[15px] text-ink-muted">
          กรอกข้อมูลให้ครบทั้งสี่ส่วน ระบบจะสร้างแบบฟอร์ม PDF ให้ตรวจสอบก่อนนำส่ง
        </p>
      </header>

      {revisionNote ? (
        <div className="mb-7 rounded-xl border-l-[3px] border-danger bg-danger-bg p-5">
          <p className="text-[13px] font-semibold text-danger">สิ่งที่ต้องแก้ไขตามที่ผู้ตรวจสอบระบุ</p>
          <p className="mt-1.5 whitespace-pre-wrap text-[15px] leading-relaxed text-ink">{revisionNote}</p>
        </div>
      ) : null}

      <div className="grid gap-8 lg:grid-cols-[220px_minmax(0,1fr)]">
        <Stepper completion={completion} />

        <form ref={formRef} onSubmit={generateForm} className="flex flex-col gap-6" noValidate>
          {/* ---------------- ส่วนที่ 1 ---------------- */}
          <Card id={SECTIONS[0].id} className="scroll-mt-24">
            <CardHeader
              tag={SECTIONS[0].tag}
              title={SECTIONS[0].title}
              description="ข้อมูลที่ใช้อธิบายชุดข้อมูลในทะเบียน"
            />
            <div className="grid gap-5 p-6">
              <Wrap name="nameTh">
                <TextField
                  label="ชื่อชุดข้อมูล (ภาษาไทย)"
                  required
                  value={form.nameTh}
                  onChange={(e) => set("nameTh", e.target.value)}
                  error={fields.nameTh}
                  placeholder="เช่น สถิติผู้ป่วยนอกรายเดือน"
                />
              </Wrap>
              <Wrap name="nameEn">
                <TextField
                  label="ชื่อชุดข้อมูล (ภาษาอังกฤษ)"
                  value={form.nameEn}
                  onChange={(e) => set("nameEn", e.target.value)}
                  error={fields.nameEn}
                />
              </Wrap>
              <Wrap name="description">
                <TextAreaField
                  label="คำอธิบายชุดข้อมูล"
                  required
                  value={form.description}
                  onChange={(e) => set("description", e.target.value)}
                  error={fields.description}
                  hint="อธิบายว่าชุดข้อมูลนี้คืออะไร เก็บจากที่ไหน และนำไปใช้ทำอะไรได้ (อย่างน้อย 30 ตัวอักษร)"
                />
              </Wrap>
              <div className="grid gap-5 sm:grid-cols-2">
                <Wrap name="datasetType">
                  <Choice
                    label="ประเภทชุดข้อมูล"
                    required
                    value={form.datasetType}
                    onChange={(v) => set("datasetType", v)}
                    error={fields.datasetType}
                    options={optionsOf(DATASET_TYPE_LABELS)}
                  />
                </Wrap>
                <Wrap name="category">
                  <Choice
                    label="หมวดหมู่"
                    required
                    value={form.category}
                    onChange={(v) => set("category", v)}
                    error={fields.category}
                    options={optionsOf(DATASET_CATEGORY_LABELS)}
                  />
                </Wrap>
              </div>
              <Wrap name="keywords">
                <KeywordInput
                  value={keywords}
                  onChange={(next) => {
                    setKeywords(next);
                    clearError("keywords");
                  }}
                  error={fields.keywords}
                />
              </Wrap>
              <div className="grid gap-5 sm:grid-cols-2">
                <Wrap name="updateFrequency">
                  <Choice
                    label="ความถี่ในการปรับปรุงข้อมูล"
                    required
                    value={form.updateFrequency}
                    onChange={(v) => set("updateFrequency", v)}
                    error={fields.updateFrequency}
                    options={optionsOf(FREQUENCY_LABELS)}
                  />
                </Wrap>
                <Wrap name="geoCoverage">
                  <Choice
                    label="ขอบเขตเชิงพื้นที่"
                    required
                    value={form.geoCoverage}
                    onChange={(v) => set("geoCoverage", v)}
                    error={fields.geoCoverage}
                    options={optionsOf(GEO_COVERAGE_LABELS)}
                  />
                </Wrap>
              </div>
              <div className="grid gap-5 sm:grid-cols-3">
                <Wrap name="dataStartDate">
                  <TextField
                    label="ข้อมูลเริ่มตั้งแต่"
                    type="date"
                    value={form.dataStartDate}
                    onChange={(e) => set("dataStartDate", e.target.value)}
                    error={fields.dataStartDate}
                  />
                </Wrap>
                <Wrap name="dataEndDate">
                  <TextField
                    label="ถึงวันที่"
                    type="date"
                    value={form.dataEndDate}
                    onChange={(e) => set("dataEndDate", e.target.value)}
                    error={fields.dataEndDate}
                    hint="เว้นว่างถ้ายังเก็บต่อเนื่อง"
                  />
                </Wrap>
                <Wrap name="estimatedRecords">
                  <TextField
                    label="จำนวนรายการโดยประมาณ"
                    inputMode="numeric"
                    value={form.estimatedRecords}
                    onChange={(e) => set("estimatedRecords", e.target.value.replace(/\D/g, ""))}
                    error={fields.estimatedRecords}
                  />
                </Wrap>
              </div>
              <div className="grid gap-5 border-t border-line pt-5 sm:grid-cols-3">
                <Wrap name="stewardName">
                  <TextField
                    label="ผู้ประสานงานชุดข้อมูล"
                    required
                    value={form.stewardName}
                    onChange={(e) => set("stewardName", e.target.value)}
                    error={fields.stewardName}
                  />
                </Wrap>
                <Wrap name="stewardEmail">
                  <TextField
                    label="อีเมล"
                    required
                    type="email"
                    value={form.stewardEmail}
                    onChange={(e) => set("stewardEmail", e.target.value)}
                    error={fields.stewardEmail}
                  />
                </Wrap>
                <Wrap name="stewardPhone">
                  <TextField
                    label="เบอร์โทรศัพท์"
                    required
                    inputMode="tel"
                    value={form.stewardPhone}
                    onChange={(e) => set("stewardPhone", e.target.value)}
                    error={fields.stewardPhone}
                  />
                </Wrap>
              </div>
            </div>
          </Card>

          {/* ---------------- ส่วนที่ 2 ---------------- */}
          <Card id={SECTIONS[1].id} className="scroll-mt-24">
            <CardHeader
              tag={SECTIONS[1].tag}
              title={SECTIONS[1].title}
              description="ช่องทางและรูปแบบที่หน่วยงานจะส่งข้อมูลเข้าสู่แพลตฟอร์ม"
            />
            <div className="grid gap-5 p-6">
              <div className="grid gap-5 sm:grid-cols-3">
                <Wrap name="deliveryMethod">
                  <Choice
                    label="วิธีการนำส่ง"
                    required
                    value={form.deliveryMethod}
                    onChange={(v) => set("deliveryMethod", v)}
                    error={fields.deliveryMethod}
                    options={optionsOf(DELIVERY_METHOD_LABELS)}
                  />
                </Wrap>
                <Wrap name="dataFormat">
                  <Choice
                    label="รูปแบบข้อมูล"
                    required
                    value={form.dataFormat}
                    onChange={(v) => set("dataFormat", v)}
                    error={fields.dataFormat}
                    options={optionsOf(DATA_FORMAT_LABELS)}
                  />
                </Wrap>
                <Wrap name="deliveryFrequency">
                  <Choice
                    label="ความถี่ในการนำส่ง"
                    required
                    value={form.deliveryFrequency}
                    onChange={(v) => set("deliveryFrequency", v)}
                    error={fields.deliveryFrequency}
                    options={optionsOf(FREQUENCY_LABELS)}
                  />
                </Wrap>
              </div>
              <Wrap name="deliveryEndpoint">
                <TextField
                  label="ปลายทาง / endpoint"
                  required={endpointRequired}
                  value={form.deliveryEndpoint}
                  onChange={(e) => set("deliveryEndpoint", e.target.value)}
                  error={fields.deliveryEndpoint}
                  hint={
                    endpointRequired
                      ? "เช่น https://api.agency.go.th/v1/datasets หรือชื่อเซิร์ฟเวอร์ SFTP"
                      : "กรอกเมื่อวิธีการนำส่งต้องเชื่อมต่อทางเทคนิค"
                  }
                />
              </Wrap>
              <div className="grid gap-5 sm:grid-cols-2">
                <Wrap name="technicalContactName">
                  <TextField
                    label="ผู้รับผิดชอบทางเทคนิค"
                    required
                    value={form.technicalContactName}
                    onChange={(e) => set("technicalContactName", e.target.value)}
                    error={fields.technicalContactName}
                  />
                </Wrap>
                <Wrap name="technicalContactEmail">
                  <TextField
                    label="อีเมลผู้รับผิดชอบทางเทคนิค"
                    required
                    type="email"
                    value={form.technicalContactEmail}
                    onChange={(e) => set("technicalContactEmail", e.target.value)}
                    error={fields.technicalContactEmail}
                  />
                </Wrap>
              </div>
              <Wrap name="deliveryNote">
                <TextAreaField
                  label="หมายเหตุการนำส่ง"
                  value={form.deliveryNote}
                  onChange={(e) => set("deliveryNote", e.target.value)}
                  error={fields.deliveryNote}
                />
              </Wrap>
            </div>
          </Card>

          {/* ---------------- ส่วนที่ 3 ---------------- */}
          <Card id={SECTIONS[2].id} className="scroll-mt-24">
            <CardHeader
              tag={SECTIONS[2].tag}
              title={SECTIONS[2].title}
              description="ชั้นความลับ ฐานอำนาจ และเงื่อนไขการใช้ข้อมูล"
            />
            <div className="grid gap-5 p-6">
              <div className="grid gap-5 sm:grid-cols-2">
                <Wrap name="dataClassification">
                  <Choice
                    label="ชั้นความลับของข้อมูล"
                    required
                    value={form.dataClassification}
                    onChange={(v) => set("dataClassification", v)}
                    error={fields.dataClassification}
                    options={optionsOf(CLASSIFICATION_LABELS)}
                  />
                </Wrap>
                <Wrap name="hasPersonalData">
                  <SelectField
                    label="มีข้อมูลส่วนบุคคลหรือไม่"
                    required
                    value={form.hasPersonalData}
                    onChange={(e) => set("hasPersonalData", e.target.value)}
                    error={fields.hasPersonalData}
                  >
                    <option value="">เลือก</option>
                    <option value="yes">มี</option>
                    <option value="no">ไม่มี</option>
                  </SelectField>
                </Wrap>
              </div>
              {form.hasPersonalData === "yes" ? (
                <Wrap name="personalDataMeasure">
                  <TextAreaField
                    label="มาตรการคุ้มครองข้อมูลส่วนบุคคล"
                    required
                    value={form.personalDataMeasure}
                    onChange={(e) => set("personalDataMeasure", e.target.value)}
                    error={fields.personalDataMeasure}
                    hint="เช่น การทำข้อมูลนิรนาม การจำกัดสิทธิ์เข้าถึง (อย่างน้อย 20 ตัวอักษร)"
                  />
                </Wrap>
              ) : null}
              <Wrap name="legalBasis">
                <TextAreaField
                  label="ฐานอำนาจตามกฎหมาย"
                  required
                  value={form.legalBasis}
                  onChange={(e) => set("legalBasis", e.target.value)}
                  error={fields.legalBasis}
                  hint="ระบุกฎหมายหรือระเบียบที่ให้อำนาจหน่วยงานเผยแพร่/แลกเปลี่ยนข้อมูลชุดนี้"
                />
              </Wrap>
              <div className="grid gap-5 sm:grid-cols-2">
                <Wrap name="licenseType">
                  <Choice
                    label="สัญญาอนุญาตให้ใช้ข้อมูล"
                    required
                    value={form.licenseType}
                    onChange={(v) => set("licenseType", v)}
                    error={fields.licenseType}
                    options={optionsOf(LICENSE_LABELS)}
                  />
                </Wrap>
                <Wrap name="usageRestriction">
                  <TextField
                    label="ข้อจำกัดการใช้ข้อมูล"
                    value={form.usageRestriction}
                    onChange={(e) => set("usageRestriction", e.target.value)}
                    error={fields.usageRestriction}
                  />
                </Wrap>
              </div>
              <div data-field="legalAcceptedAt" className="rounded-xl bg-canvas p-4">
                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={legalAccepted}
                    onChange={(e) => {
                      setLegalAccepted(e.target.checked);
                      clearError("legalAcceptedAt");
                    }}
                    className="mt-1 h-4 w-4 shrink-0 rounded border-line text-coral-500 focus:ring-2 focus:ring-navy-100"
                  />
                  <span className="text-[15px] leading-relaxed text-ink">
                    ข้าพเจ้ายืนยันว่าข้อมูลที่นำส่งถูกต้อง และหน่วยงานมีอำนาจนำส่งข้อมูลชุดนี้ตามที่ระบุไว้
                    <span className="ml-1 text-coral-500">*</span>
                  </span>
                </label>
                {fields.legalAcceptedAt ? (
                  <p className="mt-2 text-[13px] text-danger" role="alert">
                    {fields.legalAcceptedAt}
                  </p>
                ) : null}
              </div>
            </div>
          </Card>

          {/* ---------------- ส่วนที่ 4 ---------------- */}
          <Card id={SECTIONS[3].id} className="scroll-mt-24">
            <CardHeader
              tag={SECTIONS[3].tag}
              title={SECTIONS[3].title}
              description="พจนานุกรมข้อมูลบังคับแนบ ตัวอย่างข้อมูลแนบได้ถ้ามี"
            />
            <div className="grid gap-5 p-6 sm:grid-cols-2">
              <div data-field="DATA_DICTIONARY">
                <FileUpload
                  label="พจนานุกรมข้อมูล (Data Dictionary)"
                  required
                  value={dictionary}
                  error={fields.DATA_DICTIONARY}
                  uploading={uploadingKind === "DATA_DICTIONARY"}
                  onSelect={(f) => uploadFile("DATA_DICTIONARY", f)}
                  onRemove={() => setDictionary(null)}
                  accept=".pdf,.xlsx,.xls,.csv,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                  supportText="รองรับ PDF, XLSX หรือ CSV ขนาดไม่เกิน 10 MB"
                />
              </div>
              <div data-field="EXAMPLE_DATA">
                <FileUpload
                  label="ตัวอย่างข้อมูล (ถ้ามี)"
                  value={example}
                  error={fields.EXAMPLE_DATA}
                  uploading={uploadingKind === "EXAMPLE_DATA"}
                  onSelect={(f) => uploadFile("EXAMPLE_DATA", f)}
                  onRemove={() => setExample(null)}
                  accept=".csv,.xlsx,.xls,.json,text/csv,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  supportText="รองรับ CSV, XLSX หรือ JSON ขนาดไม่เกิน 10 MB"
                />
              </div>
            </div>
          </Card>

          {/* ทึบเต็ม ไม่ใช้ความโปร่ง — เนื้อหาข้างหลังทะลุมาแล้วอ่านยาก */}
          <div className="sticky bottom-0 -mx-4 flex flex-col gap-3 rounded-t-2xl border-t border-line bg-white px-4 py-4 shadow-[0_-4px_16px_rgb(20_26_51_/_0.06)] sm:mx-0 sm:flex-row sm:justify-end sm:px-6">
            <Button type="button" variant="secondary" loading={saving} onClick={saveDraft}>
              บันทึกแบบร่าง
            </Button>
            <Button type="submit" loading={generating}>
              ตรวจสอบและสร้าง PDF
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ ส่วนย่อย

function Wrap({ name, children }: { name: string; children: ReactNode }) {
  return <div data-field={name}>{children}</div>;
}

function Choice({
  label,
  required,
  value,
  onChange,
  error,
  options,
}: {
  label: string;
  required?: boolean;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  options: Array<[string, string]>;
}) {
  return (
    <SelectField
      label={label}
      required={required}
      value={value}
      error={error}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">เลือก</option>
      {options.map(([key, text]) => (
        <option key={key} value={key}>
          {text}
        </option>
      ))}
    </SelectField>
  );
}

/** คำสำคัญเป็นชิป — พิมพ์แล้วกด Enter หรือคอมมาเพื่อเพิ่ม */
function KeywordInput({
  value,
  onChange,
  error,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  error?: string;
}) {
  const [draft, setDraft] = useState("");

  const add = () => {
    const word = draft.trim().replace(/,$/, "");
    if (!word || value.includes(word) || value.length >= 10) {
      setDraft("");
      return;
    }
    onChange([...value, word]);
    setDraft("");
  };

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-ink">
        คำสำคัญ (keywords)
        <span className="ml-1 text-coral-500">*</span>
      </span>
      <div
        className={clsx(
          "flex min-h-11 flex-wrap items-center gap-2 rounded-[10px] border bg-white p-2",
          error ? "border-danger" : "border-line",
        )}
      >
        {value.map((word) => (
          <span
            key={word}
            className="inline-flex items-center gap-1.5 rounded-full bg-navy-50 py-1 pl-3 pr-2 text-[13px] text-navy-800"
          >
            {word}
            <button
              type="button"
              aria-label={`ลบคำสำคัญ ${word}`}
              onClick={() => onChange(value.filter((w) => w !== word))}
              className="grid h-4 w-4 place-items-center rounded-full text-navy-600 transition-colors hover:bg-navy-200"
            >
              ×
            </button>
          </span>
        ))}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              add();
            }
          }}
          onBlur={add}
          placeholder={value.length === 0 ? "พิมพ์คำสำคัญแล้วกด Enter" : ""}
          className="h-8 min-w-40 flex-1 bg-transparent px-1.5 text-[15px] outline-none placeholder:text-ink-subtle"
        />
      </div>
      {error ? (
        <p className="text-[13px] text-danger" role="alert">
          {error}
        </p>
      ) : (
        <p className="text-[13px] text-ink-muted">อย่างน้อย 1 คำ ไม่เกิน 10 คำ</p>
      )}
    </div>
  );
}

function Stepper({ completion }: { completion: Record<string, boolean> }) {
  return (
    <nav aria-label="ความคืบหน้า" className="hidden lg:block">
      <ol className="sticky top-24 flex flex-col gap-1">
        {SECTIONS.map((s, i) => {
          const done = completion[s.id];
          return (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                className="group flex items-start gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-white"
              >
                <span
                  className={clsx(
                    "mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-[12px] font-semibold transition-colors",
                    done ? "bg-success text-white" : "bg-navy-100 text-navy-600",
                  )}
                >
                  {done ? (
                    <svg
                      viewBox="0 0 16 16"
                      className="h-3.5 w-3.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.4"
                      aria-hidden="true"
                    >
                      <path d="m4 8.5 2.6 2.6L12 5.6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : (
                    i + 1
                  )}
                </span>
                <span className="flex flex-col leading-tight">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-coral-500">
                    {s.tag}
                  </span>
                  <span className="text-sm font-medium text-ink">{s.title}</span>
                  <span className="mt-0.5 text-[12px] text-ink-muted">
                    {done ? "กรอกครบแล้ว" : "ยังไม่ครบ"}
                  </span>
                </span>
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
