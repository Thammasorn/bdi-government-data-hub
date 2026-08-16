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
  ASSIGN_LABELS,
  DATA_CATEGORY_LABELS,
  DATA_CLASSIFICATION_LABELS,
  DATA_FORMAT_LABELS,
  DATA_TOPIC_LABELS,
  DATA_TYPE_LABELS,
  DELIVERY_FREQUENCY_LABELS,
  EMPTY_FORM,
  GEO_COVERAGE_LABELS,
  GRANT_LABELS,
  HAVE_LABELS,
  LICENSE_LABELS,
  PERSONAL_DATA_PERIOD_LABELS,
  UPDATE_FREQUENCY_UNIT_LABELS,
  applyRules,
  formRules,
  optionsFor,
  splitTags,
  toFormState,
  toPayload,
  type FormField,
  type FormState,
} from "@/lib/dataset-form";
import type { DatasetRequest } from "@/lib/types";

const SECTIONS = [
  { id: "section-1", tag: "ส่วนที่ 1", title: "ประเภทและชื่อชุดข้อมูล" },
  { id: "section-2", tag: "ส่วนที่ 2", title: "ความถี่ ขอบเขต และการนำส่ง" },
  { id: "section-3", tag: "ส่วนที่ 3", title: "หมวดหมู่และระดับชั้นข้อมูล" },
  { id: "section-4", tag: "ส่วนที่ 4", title: "การจัดเก็บและส่งต่อข้อมูล" },
  { id: "section-5", tag: "ส่วนที่ 5", title: "เอกสารแนบ" },
];

/**
 * ช่องบังคับของแต่ละส่วน สำหรับแถบความคืบหน้าด้านซ้าย
 * ช่องที่ขึ้นกับเงื่อนไข (ประเด็นอื่น ๆ, รายละเอียดข้อมูลส่วนบุคคล ฯลฯ) ถูกเติมตอนคำนวณ
 * เพราะบังคับกรอกก็ต่อเมื่อชีท conditions สั่งให้ถาม
 */
const REQUIRED_BY_SECTION: Record<string, FormField[]> = {
  "section-1": [
    "dataType",
    "dataTopic",
    "title",
    "name",
    "maintainer",
    "maintainerEmail",
    "tagString",
    "notes",
    "objective",
  ],
  "section-2": ["updateFrequencyUnit", "deliveryFrequency", "geoCoverage", "dataSource", "dataFormat"],
  "section-3": ["dataCategory", "containsPersonalData", "dataClassification", "licenseId"],
  "section-4": [
    "allowOriginalRawDataRetention",
    "allowOriginalRawDataSharing",
    "allowTransformedRawDataSharing",
    "allowTransformedRawDataGdxSharing",
    "allowAggregatedDataSharing",
  ],
};

export default function EditDatasetRequestPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const { show } = useToast();

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [legalAccepted, setLegalAccepted] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [revisionNote, setRevisionNote] = useState<string | null>(null);
  const [requestNumber, setRequestNumber] = useState("");
  const [organizationName, setOrganizationName] = useState("");

  const [dictionary, setDictionary] = useState<UploadedFile | null>(null);
  const [example, setExample] = useState<UploadedFile | null>(null);
  const [uploadingKind, setUploadingKind] = useState<string | null>(null);

  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    api
      .get<{ request: DatasetRequest }>(`/api/dataset-requests/${id}`)
      .then(({ request }) => {
        setForm(toFormState(request as unknown as Partial<Record<FormField, unknown>>));
        setLegalAccepted(Boolean(request.legalAcceptedAt));
        setRevisionNote(request.revisionNote);
        setRequestNumber(request.requestNumber);
        setOrganizationName(request.organization?.name ?? "");
        const find = (kind: string) => request.attachments.find((a) => a.kind === kind) ?? null;
        setDictionary(find("DATA_DICTIONARY"));
        setExample(find("EXAMPLE_DATA"));
      })
      .catch(() => show({ tone: "error", title: "โหลดข้อมูลไม่สำเร็จ" }))
      .finally(() => setLoading(false));
  }, [id, show]);

  /**
   * ทุกการเปลี่ยนค่าเดินผ่าน applyRules() — เลือกหมวดหมู่ "ข้อมูลสาธารณะ" แล้วระดับชั้น
   * สัญญาอนุญาต และสิทธิการส่งต่อเปลี่ยนตามทันทีบนหน้าจอ ไม่ต้องรอบันทึกก่อน
   */
  const set = (key: FormField, value: string) => {
    setForm((f) => applyRules({ ...f, [key]: value }, f));
    clearError(key);
  };

  /** ล้าง error ของช่องที่เพิ่งแก้ ไม่งั้นขอบแดงค้างทั้งที่ผู้ใช้แก้ให้ถูกแล้ว */
  const clearError = (key: string) => setFields((f) => (f[key] ? { ...f, [key]: "" } : f));

  const rules = useMemo(() => formRules(form), [form]);

  const completion = useMemo(() => {
    const conditional: Record<string, FormField[]> = {
      "section-1": rules.dataTopicOther.visible ? ["dataTopicOther"] : [],
      "section-2": [
        ...(rules.updateFrequencyInterval.visible ? (["updateFrequencyInterval"] as FormField[]) : []),
        ...(rules.dataFormatOther.visible ? (["dataFormatOther"] as FormField[]) : []),
      ],
      "section-3": rules.personalDataDetail.visible
        ? ([
            "personalDataTypes",
            "dataSubjectCategories",
            "personalDataProcessingPeriod",
          ] as FormField[])
        : [],
      "section-4": [
        ...(rules.authorizePersonalDataAnonymization.visible
          ? (["authorizePersonalDataAnonymization"] as FormField[])
          : []),
        ...(rules.transformedRawDataRecipients.visible
          ? (["transformedRawDataRecipients"] as FormField[])
          : []),
        ...(rules.transformedRawDataGdxRecipients.visible
          ? (["transformedRawDataGdxRecipients"] as FormField[])
          : []),
        ...(rules.aggregatedDataRecipients.visible
          ? (["aggregatedDataRecipients"] as FormField[])
          : []),
      ],
    };

    const done: Record<string, boolean> = {};
    for (const [section, keys] of Object.entries(REQUIRED_BY_SECTION)) {
      done[section] = [...keys, ...(conditional[section] ?? [])].every(
        (k) => form[k].trim().length > 0,
      );
    }
    if (rules.personalDataPeriodAmount.visible) {
      const years = Number(form.personalDataProcessingPeriodYear || 0);
      const months = Number(form.personalDataProcessingPeriodMonth || 0);
      done["section-3"] = Boolean(done["section-3"]) && years + months > 0;
    }
    done["section-4"] = Boolean(done["section-4"]) && legalAccepted;
    done["section-5"] = dictionary !== null;
    return done;
  }, [form, rules, legalAccepted, dictionary]);

  // ---------- actions ----------
  const persist = () =>
    api.patch<{ request: DatasetRequest }>(`/api/dataset-requests/${id}`, {
      ...toPayload(form),
      legalAccepted,
    });

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
          กรอกข้อมูลให้ครบทั้งห้าส่วน ระบบจะสร้างแบบฟอร์ม PDF ให้ตรวจสอบก่อนนำส่ง
          บางช่องระบบกำหนดค่าให้เองตามหมวดหมู่และระดับชั้นของข้อมูล
        </p>
      </header>

      {revisionNote ? (
        <div className="mb-7 rounded-xl border-l-[3px] border-danger bg-danger-bg p-5">
          <p className="text-[13px] font-semibold text-danger">สิ่งที่ต้องแก้ไขตามที่ผู้ตรวจสอบระบุ</p>
          <p className="mt-1.5 whitespace-pre-wrap break-words text-[15px] leading-relaxed text-ink">{revisionNote}</p>
        </div>
      ) : null}

      <div className="grid gap-8 lg:grid-cols-[220px_minmax(0,1fr)]">
        <Stepper completion={completion} />

        <form ref={formRef} onSubmit={generateForm} className="flex flex-col gap-6" noValidate>
          {/* ---------------- ส่วนที่ 1 ---------------- */}
          <Card id={SECTIONS[0]!.id} className="scroll-mt-24">
            <CardHeader
              tag={SECTIONS[0]!.tag}
              title={SECTIONS[0]!.title}
              description="ข้อมูลที่ใช้อธิบายชุดข้อมูลในบัญชีข้อมูลภาครัฐ"
            />
            <div className="grid gap-5 p-6">
              <div className="grid gap-5 sm:grid-cols-2">
                <Wrap name="dataType">
                  <Choice
                    label="ประเภทข้อมูล"
                    required
                    value={form.dataType}
                    onChange={(v) => set("dataType", v)}
                    error={fields.dataType}
                    options={optionsFor(DATA_TYPE_LABELS)}
                  />
                </Wrap>
                <Wrap name="dataTopic">
                  <Choice
                    label="ประเด็น"
                    required
                    value={form.dataTopic}
                    onChange={(v) => set("dataTopic", v)}
                    error={fields.dataTopic}
                    options={optionsFor(DATA_TOPIC_LABELS)}
                  />
                </Wrap>
              </div>
              {rules.dataTopicOther.visible ? (
                <Wrap name="dataTopicOther">
                  <TextField
                    label="ระบุประเด็นอื่น ๆ"
                    required
                    maxLength={150}
                    value={form.dataTopicOther}
                    onChange={(e) => set("dataTopicOther", e.target.value)}
                    error={fields.dataTopicOther}
                  />
                </Wrap>
              ) : null}
              <div className="grid gap-5 sm:grid-cols-2">
                <Wrap name="title">
                  <TextField
                    label="ชื่อชุดข้อมูล (ภาษาไทย)"
                    required
                    maxLength={150}
                    value={form.title}
                    onChange={(e) => set("title", e.target.value)}
                    error={fields.title}
                    placeholder="เช่น สถิติผู้ป่วยนอกรายเดือน"
                  />
                </Wrap>
                <Wrap name="name">
                  <TextField
                    label="ชื่อชุดข้อมูล (ภาษาอังกฤษ)"
                    required
                    maxLength={150}
                    value={form.name}
                    onChange={(e) => set("name", e.target.value)}
                    error={fields.name}
                    placeholder="เช่น Monthly Outpatient Statistics"
                  />
                </Wrap>
              </div>
              <ReadOnlyField
                label="องค์กร"
                value={organizationName}
                hint="ชุดข้อมูลเป็นของหน่วยงานที่ท่านสังกัด ระบบกรอกให้อัตโนมัติ"
              />
              <div className="grid gap-5 sm:grid-cols-2">
                <Wrap name="maintainer">
                  <TextField
                    label="ชื่อผู้ติดต่อ"
                    required
                    maxLength={150}
                    value={form.maintainer}
                    onChange={(e) => set("maintainer", e.target.value)}
                    error={fields.maintainer}
                    hint="ชื่อกอง สำนัก หรือฝ่ายที่ได้รับมอบหมายให้รับผิดชอบข้อมูล"
                  />
                </Wrap>
                <Wrap name="maintainerEmail">
                  <TextField
                    label="อีเมลผู้ติดต่อ"
                    required
                    type="email"
                    maxLength={50}
                    value={form.maintainerEmail}
                    onChange={(e) => set("maintainerEmail", e.target.value)}
                    error={fields.maintainerEmail}
                    hint="อีเมลของกอง สำนัก หรือฝ่าย ไม่ใช่อีเมลส่วนตัว"
                  />
                </Wrap>
              </div>
              <Wrap name="tagString">
                <KeywordInput
                  value={form.tagString}
                  onChange={(next) => set("tagString", next)}
                  error={fields.tagString}
                />
              </Wrap>
              <Wrap name="notes">
                <TextAreaField
                  label="รายละเอียด"
                  required
                  maxLength={1000}
                  value={form.notes}
                  onChange={(e) => set("notes", e.target.value)}
                  error={fields.notes}
                  hint={counterHint(
                    form.notes,
                    1000,
                    "อธิบายว่าชุดข้อมูลนี้คืออะไร จัดเก็บอย่างไร และกลุ่มเป้าหมายผู้ใช้เป็นใคร (อย่างน้อย 30 ตัวอักษร)",
                  )}
                />
              </Wrap>
              <Wrap name="objective">
                <TextAreaField
                  label="วัตถุประสงค์"
                  required
                  maxLength={1000}
                  value={form.objective}
                  onChange={(e) => set("objective", e.target.value)}
                  error={fields.objective}
                  hint={counterHint(
                    form.objective,
                    1000,
                    "ที่มาและวัตถุประสงค์ของการจัดทำชุดข้อมูล เช่น กฎหมาย ภารกิจ หรือโครงการตามแผนยุทธศาสตร์ (อย่างน้อย 30 ตัวอักษร)",
                  )}
                />
              </Wrap>
            </div>
          </Card>

          {/* ---------------- ส่วนที่ 2 ---------------- */}
          <Card id={SECTIONS[1]!.id} className="scroll-mt-24">
            <CardHeader
              tag={SECTIONS[1]!.tag}
              title={SECTIONS[1]!.title}
              description="ความถี่ของข้อมูล ขอบเขตพื้นที่ แหล่งที่มา และรูปแบบที่จะนำส่ง"
            />
            <div className="grid gap-5 p-6">
              <div className="grid gap-5 sm:grid-cols-2">
                <Wrap name="updateFrequencyUnit">
                  <Choice
                    label="หน่วยความถี่ของการปรับปรุงข้อมูลต้นทาง"
                    required
                    value={form.updateFrequencyUnit}
                    onChange={(v) => set("updateFrequencyUnit", v)}
                    error={fields.updateFrequencyUnit}
                    options={optionsFor(UPDATE_FREQUENCY_UNIT_LABELS)}
                  />
                </Wrap>
                {rules.updateFrequencyInterval.visible ? (
                  <Wrap name="updateFrequencyInterval">
                    <TextField
                      label="ค่าความถี่ของการปรับปรุงข้อมูลต้นทาง"
                      required
                      inputMode="numeric"
                      value={form.updateFrequencyInterval}
                      onChange={(e) =>
                        set("updateFrequencyInterval", e.target.value.replace(/\D/g, ""))
                      }
                      error={fields.updateFrequencyInterval}
                      hint={`ปรับปรุงทุกกี่${
                        UPDATE_FREQUENCY_UNIT_LABELS[
                          form.updateFrequencyUnit as keyof typeof UPDATE_FREQUENCY_UNIT_LABELS
                        ] ?? "หน่วย"
                      } เช่น ทุก 2 ปี ให้กรอก 2`}
                    />
                  </Wrap>
                ) : null}
              </div>
              <div className="grid gap-5 sm:grid-cols-2">
                <Wrap name="deliveryFrequency">
                  <Choice
                    label="ความถี่ของการนำส่งข้อมูลเข้าสู่ระบบกลาง"
                    required
                    value={form.deliveryFrequency}
                    onChange={(v) => set("deliveryFrequency", v)}
                    error={fields.deliveryFrequency}
                    options={optionsFor(DELIVERY_FREQUENCY_LABELS)}
                  />
                </Wrap>
                <Wrap name="geoCoverage">
                  <Choice
                    label="ความละเอียดเชิงภูมิศาสตร์"
                    required
                    value={form.geoCoverage}
                    onChange={(v) => set("geoCoverage", v)}
                    error={fields.geoCoverage}
                    options={optionsFor(GEO_COVERAGE_LABELS)}
                    hint="มิติการจัดจำแนกพื้นที่ในระดับย่อยที่สุดที่จัดเก็บหรือนำเสนอ"
                  />
                </Wrap>
              </div>
              <Wrap name="dataSource">
                <TextField
                  label="แหล่งที่มาของข้อมูล"
                  required
                  maxLength={200}
                  value={form.dataSource}
                  onChange={(e) => set("dataSource", e.target.value)}
                  error={fields.dataSource}
                  hint="ระบุแหล่งที่มาพร้อมหน่วยงานที่จัดทำ เช่น สำรวจภาวะการทำงานของประชากร (สำนักงานสถิติแห่งชาติ)"
                />
              </Wrap>
              <div className="grid gap-5 sm:grid-cols-2">
                <Wrap name="dataFormat">
                  <Choice
                    label="รูปแบบการนำส่งข้อมูล"
                    required
                    value={form.dataFormat}
                    onChange={(v) => set("dataFormat", v)}
                    error={fields.dataFormat}
                    options={optionsFor(DATA_FORMAT_LABELS)}
                  />
                </Wrap>
                {rules.dataFormatOther.visible ? (
                  <Wrap name="dataFormatOther">
                    <TextField
                      label="ชื่อระบบเชื่อมโยงข้อมูล"
                      required
                      maxLength={150}
                      value={form.dataFormatOther}
                      onChange={(e) => set("dataFormatOther", e.target.value)}
                      error={fields.dataFormatOther}
                    />
                  </Wrap>
                ) : null}
              </div>
            </div>
          </Card>

          {/* ---------------- ส่วนที่ 3 ---------------- */}
          <Card id={SECTIONS[2]!.id} className="scroll-mt-24">
            <CardHeader
              tag={SECTIONS[2]!.tag}
              title={SECTIONS[2]!.title}
              description="หมวดหมู่ตามธรรมาภิบาลข้อมูลภาครัฐเป็นตัวกำหนดระดับชั้นและสัญญาอนุญาตที่เลือกได้"
            />
            <div className="grid gap-5 p-6">
              <Wrap name="dataCategory">
                <Choice
                  label="หมวดหมู่ข้อมูลตามธรรมาภิบาลภาครัฐ"
                  required
                  value={form.dataCategory}
                  onChange={(v) => set("dataCategory", v)}
                  error={fields.dataCategory}
                  options={optionsFor(DATA_CATEGORY_LABELS)}
                />
              </Wrap>
              <Wrap name="containsPersonalData">
                <YesNo
                  label="ชุดข้อมูลนี้มีข้อมูลส่วนบุคคลหรือไม่"
                  required
                  labels={HAVE_LABELS}
                  value={form.containsPersonalData}
                  forced={rules.containsPersonalData.forced}
                  onChange={(v) => set("containsPersonalData", v)}
                  error={fields.containsPersonalData}
                  hint="ข้อมูลส่วนบุคคลตาม พ.ร.บ.คุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562"
                  forcedHint="ข้อมูลสาธารณะต้องไม่มีข้อมูลส่วนบุคคล"
                />
              </Wrap>

              {rules.personalDataDetail.visible ? (
                <div className="grid gap-5 rounded-xl bg-canvas p-5">
                  <p className="text-[13px] font-semibold text-navy-800">
                    รายละเอียดข้อมูลส่วนบุคคล
                  </p>
                  <Wrap name="personalDataTypes">
                    <TextAreaField
                      label="ประเภทของข้อมูลส่วนบุคคล"
                      required
                      value={form.personalDataTypes}
                      onChange={(e) => set("personalDataTypes", e.target.value)}
                      error={fields.personalDataTypes}
                      hint="เช่น ชื่อ-นามสกุล เลขประจำตัวประชาชน ที่อยู่ เบอร์โทรศัพท์"
                    />
                  </Wrap>
                  <Wrap name="dataSubjectCategories">
                    <TextAreaField
                      label="กลุ่มหรือประเภทของเจ้าของข้อมูลส่วนบุคคล"
                      required
                      value={form.dataSubjectCategories}
                      onChange={(e) => set("dataSubjectCategories", e.target.value)}
                      error={fields.dataSubjectCategories}
                      hint="เช่น ผู้รับบริการของหน่วยงาน ผู้ประกอบการที่ขึ้นทะเบียน"
                    />
                  </Wrap>
                  <Wrap name="personalDataProcessingPeriod">
                    <Choice
                      label="ระยะเวลาประมวลผลข้อมูลส่วนบุคคล"
                      required
                      value={form.personalDataProcessingPeriod}
                      onChange={(v) => set("personalDataProcessingPeriod", v)}
                      error={fields.personalDataProcessingPeriod}
                      options={optionsFor(PERSONAL_DATA_PERIOD_LABELS)}
                    />
                  </Wrap>
                  {rules.personalDataPeriodAmount.visible ? (
                    <div className="grid gap-5 sm:grid-cols-2">
                      <Wrap name="personalDataProcessingPeriodYear">
                        <TextField
                          label="จำนวนปี"
                          inputMode="numeric"
                          value={form.personalDataProcessingPeriodYear}
                          onChange={(e) =>
                            set("personalDataProcessingPeriodYear", e.target.value.replace(/\D/g, ""))
                          }
                          error={fields.personalDataProcessingPeriodYear}
                          hint="นับจากวันที่เอกสารฉบับนี้มีผล"
                        />
                      </Wrap>
                      <Wrap name="personalDataProcessingPeriodMonth">
                        <TextField
                          label="จำนวนเดือน"
                          inputMode="numeric"
                          value={form.personalDataProcessingPeriodMonth}
                          onChange={(e) =>
                            set(
                              "personalDataProcessingPeriodMonth",
                              e.target.value.replace(/\D/g, ""),
                            )
                          }
                          error={fields.personalDataProcessingPeriodMonth}
                          hint="0–11 เดือน ถ้ามากกว่านั้นให้กรอกเป็นจำนวนปี"
                        />
                      </Wrap>
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div className="grid gap-5 sm:grid-cols-2">
                <Wrap name="dataClassification">
                  <Choice
                    label="ระดับชั้นข้อมูล"
                    required
                    value={form.dataClassification}
                    onChange={(v) => set("dataClassification", v)}
                    error={fields.dataClassification}
                    options={optionsFor(DATA_CLASSIFICATION_LABELS, rules.dataClassification.options)}
                    forced={Boolean(rules.dataClassification.forced)}
                    disabledHint={
                      form.dataCategory
                        ? "ระบบกำหนดให้ตามหมวดหมู่ข้อมูลที่เลือก"
                        : "เลือกหมวดหมู่ข้อมูลก่อน จึงจะเลือกระดับชั้นได้"
                    }
                    hint="ชั้นความลับตาม พ.ร.บ.ข้อมูลข่าวสารของราชการ พ.ศ. 2540"
                  />
                </Wrap>
                <Wrap name="licenseId">
                  <Choice
                    label="สัญญาอนุญาตให้ใช้ข้อมูล"
                    required
                    value={form.licenseId}
                    onChange={(v) => set("licenseId", v)}
                    error={fields.licenseId}
                    options={optionsFor(LICENSE_LABELS, rules.licenseId.options)}
                    forced={Boolean(rules.licenseId.forced)}
                    disabledHint={
                      form.dataClassification
                        ? "ระบบกำหนดให้ตามระดับชั้นข้อมูลที่เลือก"
                        : "เลือกระดับชั้นข้อมูลก่อน จึงจะเลือกสัญญาอนุญาตได้"
                    }
                  />
                </Wrap>
              </div>
            </div>
          </Card>

          {/* ---------------- ส่วนที่ 4 ---------------- */}
          <Card id={SECTIONS[3]!.id} className="scroll-mt-24">
            <CardHeader
              tag={SECTIONS[3]!.tag}
              title={SECTIONS[3]!.title}
              description="สิทธิที่หน่วยงานให้สำนักงานในการจัดเก็บและส่งต่อข้อมูล — “อนุญาต” คือส่งต่อได้ทันที “ไม่อนุญาต” คือต้องขออนุญาตเป็นครั้ง ๆ ไป"
            />
            <div className="grid gap-5 p-6">
              <Wrap name="allowOriginalRawDataRetention">
                <YesNo
                  label="ท่านอนุญาตให้สำนักงานยังคงจัดเก็บข้อมูลดิบต้นฉบับ (original raw data) แม้ถูกแปลงสภาพแล้วหรือไม่"
                  required
                  labels={GRANT_LABELS}
                  value={form.allowOriginalRawDataRetention}
                  forced={rules.allowOriginalRawDataRetention.forced}
                  onChange={(v) => set("allowOriginalRawDataRetention", v)}
                  error={fields.allowOriginalRawDataRetention}
                  forcedHint="ชุดข้อมูลที่เปิดเผยได้ทั้งฉบับ อนุญาตให้ทุกข้อโดยอัตโนมัติ"
                />
              </Wrap>
              <Wrap name="allowOriginalRawDataSharing">
                <YesNo
                  label="กรณีให้สำนักงานเก็บข้อมูลดิบต้นฉบับ ท่านอนุญาตให้ส่งต่อข้อมูลดิบต้นฉบับนั้นแก่หน่วยงานของรัฐอื่นใช้ประโยชน์หรือไม่"
                  required
                  labels={GRANT_LABELS}
                  value={form.allowOriginalRawDataSharing}
                  forced={rules.allowOriginalRawDataSharing.forced}
                  onChange={(v) => set("allowOriginalRawDataSharing", v)}
                  error={fields.allowOriginalRawDataSharing}
                  forcedHint={
                    form.allowOriginalRawDataRetention === "N"
                      ? "ไม่ได้ให้สำนักงานเก็บข้อมูลดิบต้นฉบับไว้ จึงส่งต่อไม่ได้"
                      : "ชุดข้อมูลที่เปิดเผยได้ทั้งฉบับ อนุญาตให้ทุกข้อโดยอัตโนมัติ"
                  }
                />
              </Wrap>
              <Wrap name="allowTransformedRawDataSharing">
                <YesNo
                  label="ท่านอนุญาตให้สำนักงานส่งต่อข้อมูลดิบแปลงสภาพที่สร้างจากข้อมูลดิบต้นฉบับของท่าน ไปยังระบบเชื่อมโยงข้อมูลอื่นหรือไม่"
                  required
                  labels={GRANT_LABELS}
                  value={form.allowTransformedRawDataSharing}
                  forced={rules.allowTransformedRawDataSharing.forced}
                  onChange={(v) => set("allowTransformedRawDataSharing", v)}
                  error={fields.allowTransformedRawDataSharing}
                  forcedHint="ข้อมูลระดับนี้ส่งต่อข้อมูลแปลงสภาพได้โดยอัตโนมัติ"
                />
              </Wrap>
              {rules.transformedRawDataRecipients.visible ? (
                <Wrap name="transformedRawDataRecipients">
                  <TextAreaField
                    label="หน่วยงานปลายทางที่อนุญาตให้ส่งต่อข้อมูลดิบแปลงสภาพ"
                    required
                    maxLength={500}
                    value={form.transformedRawDataRecipients}
                    onChange={(e) => set("transformedRawDataRecipients", e.target.value)}
                    error={fields.transformedRawDataRecipients}
                    hint="ชุดข้อมูลมีข้อมูลส่วนบุคคล จึงต้องระบุว่าอนุญาตให้ส่งต่อไปยังหน่วยงานใดบ้าง"
                  />
                </Wrap>
              ) : null}
              <Wrap name="allowTransformedRawDataGdxSharing">
                <YesNo
                  label="ท่านอนุญาตให้สำนักงานส่งต่อข้อมูลดิบแปลงสภาพ ไปยังศูนย์แลกเปลี่ยนข้อมูลกลางภาครัฐ (GDX) หรือไม่"
                  required
                  labels={GRANT_LABELS}
                  value={form.allowTransformedRawDataGdxSharing}
                  forced={rules.allowTransformedRawDataGdxSharing.forced}
                  onChange={(v) => set("allowTransformedRawDataGdxSharing", v)}
                  error={fields.allowTransformedRawDataGdxSharing}
                  forcedHint="ข้อมูลระดับนี้ส่งต่อข้อมูลแปลงสภาพได้โดยอัตโนมัติ"
                />
              </Wrap>
              {rules.transformedRawDataGdxRecipients.visible ? (
                <Wrap name="transformedRawDataGdxRecipients">
                  <TextAreaField
                    label="หน่วยงานที่อนุญาตให้รับข้อมูลผ่าน GDX"
                    required
                    maxLength={500}
                    value={form.transformedRawDataGdxRecipients}
                    onChange={(e) => set("transformedRawDataGdxRecipients", e.target.value)}
                    error={fields.transformedRawDataGdxRecipients}
                  />
                </Wrap>
              ) : null}
              <Wrap name="allowAggregatedDataSharing">
                <YesNo
                  label="ท่านอนุญาตให้สำนักงานส่งต่อข้อมูลรวม (aggregated data) ที่สร้างจากข้อมูลดิบต้นฉบับของท่านหรือไม่"
                  required
                  labels={GRANT_LABELS}
                  value={form.allowAggregatedDataSharing}
                  forced={rules.allowAggregatedDataSharing.forced}
                  onChange={(v) => set("allowAggregatedDataSharing", v)}
                  error={fields.allowAggregatedDataSharing}
                  forcedHint="ข้อมูลระดับนี้ส่งต่อข้อมูลรวมได้โดยอัตโนมัติ"
                />
              </Wrap>
              {rules.aggregatedDataRecipients.visible ? (
                <Wrap name="aggregatedDataRecipients">
                  <TextAreaField
                    label="หน่วยงานปลายทางที่อนุญาตให้รับข้อมูลรวม"
                    required
                    maxLength={500}
                    value={form.aggregatedDataRecipients}
                    onChange={(e) => set("aggregatedDataRecipients", e.target.value)}
                    error={fields.aggregatedDataRecipients}
                  />
                </Wrap>
              ) : null}
              {rules.authorizePersonalDataAnonymization.visible ? (
                <Wrap name="authorizePersonalDataAnonymization">
                  <YesNo
                    label="ท่านมอบหมายให้สำนักงานประมวลผลข้อมูลส่วนบุคคลซึ่งเป็นข้อมูลดิบต้นฉบับ ให้เป็นข้อมูลที่ไม่สามารถระบุตัวตนได้ เพื่อการใช้ประโยชน์เชิงวิเคราะห์ต่อไปหรือไม่"
                    required
                    labels={ASSIGN_LABELS}
                    value={form.authorizePersonalDataAnonymization}
                    forced=""
                    onChange={(v) => set("authorizePersonalDataAnonymization", v)}
                    error={fields.authorizePersonalDataAnonymization}
                    hint="ถ้าไม่มอบหมาย สำนักงานจะนำข้อมูลชุดนี้ไปใช้สร้างแบบจำลองไม่ได้"
                  />
                </Wrap>
              ) : null}

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

          {/* ---------------- ส่วนที่ 5 ---------------- */}
          <Card id={SECTIONS[4]!.id} className="scroll-mt-24">
            <CardHeader
              tag={SECTIONS[4]!.tag}
              title={SECTIONS[4]!.title}
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

/** ตัวนับตัวอักษรต่อท้ายคำแนะนำ — ช่องที่มีเพดานความยาวควรบอกว่าเหลือเท่าไร */
function counterHint(value: string, max: number, hint: string): string {
  return `${hint} · ${value.length.toLocaleString("th-TH")}/${max.toLocaleString("th-TH")}`;
}

function Choice({
  label,
  required,
  value,
  onChange,
  error,
  options,
  hint,
  forced,
  disabledHint,
}: {
  label: string;
  required?: boolean;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  options: Array<[string, string]>;
  hint?: string;
  /** true = ชีท conditions บังคับค่านี้ ผู้ใช้เปลี่ยนไม่ได้ แต่ยังต้องเห็น */
  forced?: boolean;
  disabledHint?: string;
}) {
  const locked = Boolean(forced) || options.length === 0;
  return (
    <SelectField
      label={label}
      required={required}
      value={value}
      error={error}
      disabled={locked}
      hint={locked ? (disabledHint ?? hint) : hint}
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

/**
 * คำถามใช่/ไม่ใช่ — ใช้ radio ไม่ใช่ dropdown เพราะคำถามยาวและมีแค่สองคำตอบ
 * ค่าที่ถูกบังคับยังแสดงเป็นตัวเลือกที่ถูกเลือกไว้ พร้อมเหตุผล ตามหมายเหตุท้ายชีท conditions
 */
function YesNo({
  label,
  required,
  labels,
  value,
  forced,
  onChange,
  error,
  hint,
  forcedHint,
}: {
  label: string;
  required?: boolean;
  labels: { Y: string; N: string };
  value: string;
  forced: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
  forcedHint?: string;
}) {
  const locked = forced !== "";
  return (
    <fieldset
      className={clsx(
        "rounded-xl border p-4",
        error ? "border-danger" : "border-line",
        locked && "bg-navy-50/40",
      )}
      aria-invalid={error ? true : undefined}
    >
      <legend className="px-1 text-sm font-medium leading-relaxed text-ink">
        {label}
        {required ? <span className="ml-1 text-coral-500">*</span> : null}
      </legend>
      <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2">
        {(["Y", "N"] as const).map((code) => (
          <label
            key={code}
            className={clsx(
              "flex items-center gap-2 text-[15px]",
              locked ? "text-ink-muted" : "cursor-pointer text-ink",
            )}
          >
            <input
              type="radio"
              name={label}
              value={code}
              checked={value === code}
              disabled={locked}
              onChange={() => onChange(code)}
              className="h-4 w-4 border-line text-coral-500 focus:ring-2 focus:ring-navy-100"
            />
            {labels[code]}
          </label>
        ))}
      </div>
      {error ? (
        <p className="mt-2 text-[13px] text-danger" role="alert">
          {error}
        </p>
      ) : locked ? (
        <p className="mt-2 flex items-start gap-1.5 text-[13px] text-ink-muted">
          <svg viewBox="0 0 16 16" className="mt-0.5 h-3.5 w-3.5 shrink-0" fill="currentColor" aria-hidden="true">
            <path d="M8 1a3 3 0 0 0-3 3v2H4.5A1.5 1.5 0 0 0 3 7.5v6A1.5 1.5 0 0 0 4.5 15h7a1.5 1.5 0 0 0 1.5-1.5v-6A1.5 1.5 0 0 0 11.5 6H11V4a3 3 0 0 0-3-3m0 1.5A1.5 1.5 0 0 1 9.5 4v2h-3V4A1.5 1.5 0 0 1 8 2.5" />
          </svg>
          <span>ระบบกำหนดให้เป็น “{labels[forced as "Y" | "N"]}” — {forcedHint}</span>
        </p>
      ) : hint ? (
        <p className="mt-2 text-[13px] text-ink-muted">{hint}</p>
      ) : null}
    </fieldset>
  );
}

/** ช่องที่ระบบกรอกให้และผู้ใช้แก้ไม่ได้ — แสดงเหมือนช่องอื่นเพื่อให้อ่านฟอร์มได้ต่อเนื่อง */
function ReadOnlyField({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-ink">{label}</span>
      <p className="flex h-11 items-center rounded-[10px] border border-line bg-navy-50/60 px-3.5 text-[15px] text-ink-muted">
        {value || "—"}
      </p>
      {hint ? <p className="text-[13px] text-ink-muted">{hint}</p> : null}
    </div>
  );
}

/**
 * คำสำคัญเป็นชิป — พิมพ์แล้วกด Enter หรือคอมมาเพื่อเพิ่ม
 * เก็บลงฐานข้อมูลเป็นสตริงเดียวคั่นด้วย "," ตามคอลัมน์ tag_string ในชีท
 */
function KeywordInput({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (next: string) => void;
  error?: string;
}) {
  const [draft, setDraft] = useState("");
  const tags = splitTags(value);

  const add = () => {
    const word = draft.trim().replace(/,$/, "");
    if (!word || tags.includes(word)) {
      setDraft("");
      return;
    }
    onChange([...tags, word].join(","));
    setDraft("");
  };

  const remaining = 200 - value.length;

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-ink">
        คำสำคัญ หรือคำค้น
        <span className="ml-1 text-coral-500">*</span>
      </span>
      <div
        className={clsx(
          "flex min-h-11 flex-wrap items-center gap-2 rounded-[10px] border bg-white p-2",
          error ? "border-danger" : "border-line",
        )}
      >
        {tags.map((word) => (
          <span
            key={word}
            className="inline-flex items-center gap-1.5 rounded-full bg-navy-50 py-1 pl-3 pr-2 text-[13px] text-navy-800"
          >
            {word}
            <button
              type="button"
              aria-label={`ลบคำสำคัญ ${word}`}
              onClick={() => onChange(tags.filter((w) => w !== word).join(","))}
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
          maxLength={Math.max(remaining, 0)}
          placeholder={tags.length === 0 ? "พิมพ์คำสำคัญแล้วกด Enter" : ""}
          className="h-8 min-w-40 flex-1 bg-transparent px-1.5 text-[15px] outline-none placeholder:text-ink-subtle"
        />
      </div>
      {error ? (
        <p className="text-[13px] text-danger" role="alert">
          {error}
        </p>
      ) : (
        <p className="text-[13px] text-ink-muted">
          อย่างน้อย 1 คำ · รวมกันไม่เกิน 200 ตัวอักษร (เหลือ {Math.max(remaining, 0).toLocaleString("th-TH")})
        </p>
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
