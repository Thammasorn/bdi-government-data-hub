"use client";

import clsx from "clsx";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";

import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { SelectField, TextAreaField, TextField } from "@/components/ui/Field";
import { FileUpload, type UploadedFile } from "@/components/ui/FileUpload";
import { IncompleteGate, type IncompleteItem } from "@/components/ui/IncompleteGate";
import { Spinner } from "@/components/ui/Spinner";
import { useToast } from "@/components/ui/Toast";
import { api, ApiError } from "@/lib/api";
import { useRequireAuth } from "@/lib/require-auth";
import { labelOf, useDatasetChoices } from "@/lib/dataset-choices";
import {
  ASSIGN_LABELS,
  EMPTY_FORM,
  GRANT_LABELS,
  HAVE_LABELS,
  applyRules,
  formRules,
  optionsFor,
  splitTags,
  toFormState,
  toPayload,
  validateDatasetForm,
  type FormField,
  type FormState,
} from "@/lib/dataset-form";
import type { DatasetRequest } from "@/lib/types";

/** ผูกปุ่มที่กดไม่ได้เข้ากับกล่องที่บอกว่าทำไม โปรแกรมอ่านหน้าจอจึงอ่านเหตุผลได้ด้วย */
const INCOMPLETE_HINT_ID = "dataset-form-incomplete";

const SECTIONS = [
  { id: "section-1", tag: "ส่วนที่ 1", title: "ข้อมูลทั่วไปของชุดข้อมูล" },
  { id: "section-2", tag: "ส่วนที่ 2", title: "แหล่งที่มา การปรับปรุง และการนำส่ง" },
  { id: "section-3", tag: "ส่วนที่ 3", title: "การจัดประเภทและระดับชั้นข้อมูล" },
  { id: "section-4", tag: "ส่วนที่ 4", title: "เงื่อนไขการจัดเก็บและการส่งต่อ" },
  { id: "section-5", tag: "ส่วนที่ 5", title: "เอกสารแนบ" },
];

/**
 * ช่องทั้งหมดของแต่ละส่วน สำหรับแถบความคืบหน้าด้านซ้าย — ทุกช่องใน `FormState` อยู่ที่นี่
 * ที่เดียว ทั้งช่องบังคับ ช่องที่ขึ้นกับเงื่อนไข และช่องที่ไม่บังคับ
 *
 * ส่วนหนึ่ง "ครบ" เมื่อไม่มีช่องไหนในส่วนนั้นเหลือข้อความผิดพลาด ไม่ใช่เมื่อทุกช่องมีค่า:
 * `validateDatasetField()` เป็นคนรู้อยู่แล้วว่าช่องไหนบังคับ ช่องไหนชีท conditions ซ่อนอยู่
 * (คืน null) และช่องไหนเว้นว่างได้ รายการนี้จึงไม่ต้องแยกกรณีเองอีก และแถบความคืบหน้า
 * ก็เลิกบอกว่า "กรอกครบแล้ว" ทั้งที่ยังมีช่องขอบแดงค้างอยู่ในส่วนนั้น
 */
const FIELDS_BY_SECTION: Record<string, FormField[]> = {
  "section-1": [
    "dataType",
    "dataTopic",
    "dataTopicOther",
    "title",
    "name",
    "dataFields",
    "maintainer",
    "maintainerEmail",
    "tagString",
    "notes",
    "objective",
    "objectiveOther",
  ],
  "section-2": [
    "updateFrequencyUnit",
    "updateFrequencyInterval",
    "deliveryFrequency",
    "geoCoverage",
    "geoCoverageOther",
    "dataSource",
    "dataFormat",
    "dataFormatOther",
  ],
  "section-3": [
    "dataCategory",
    "containsPersonalData",
    "personalDataTypes",
    "dataSubjectCategories",
    "personalDataProcessingPeriod",
    "personalDataProcessingPeriodYear",
    "personalDataProcessingPeriodMonth",
    "dataClassification",
    "licenseId",
  ],
  "section-4": [
    "allowOriginalRawDataRetention",
    "allowOriginalRawDataSharing",
    "allowTransformedRawDataSharing",
    "allowTransformedRawDataSharingSpecifiedPlatforms",
    "allowTransformedRawDataGdxSharing",
    "allowAggregatedDataSharing",
    "authorizePersonalDataAnonymization",
  ],
};

/**
 * ป้ายของแต่ละช่องอย่างที่เขียนอยู่บนฟอร์ม สำหรับกล่องที่บอกว่ายังต้องแก้อะไรบ้าง
 *
 * `clientErrors` ให้มาแต่ข้อความ ซึ่งบอกไม่ได้ว่าเป็นช่องไหน — "กรุณาเลือก" ตรงกับได้หลายช่อง
 * ในฟอร์มเดียว ป้ายคู่กับเลขส่วนจึงเป็นสิ่งที่บอกว่าต้องเลื่อนไปแก้ตรงไหน **แก้พร้อมกับป้ายบน
 * ฟอร์มเสมอ** ป้ายสองที่ที่พูดไม่ตรงกันทำให้ผู้ใช้หาช่องที่ระบบอ้างถึงไม่เจอ
 *
 * ข้อยกเว้นคือส่วนที่ 4: ป้ายของมันเป็นคำถามเต็มประโยคยาวเป็นบรรทัด ๆ ("ท่านอนุญาตให้สำนักงาน
 * ยังคงจัดเก็บ…หรือไม่") ที่นี่จึงเก็บเป็นชื่อเรื่องของคำถามแทน กล่องที่ยัดคำถามเต็มเจ็ดข้อจะยาว
 * กว่าหน้าจอและอ่านไม่ออก ตราบใดที่ชื่อเรื่องยังชี้ไปที่คำถามเดียวกันได้ก็พอ
 *
 * `DATA_DICTIONARY` ไม่ใช่ช่องใน `FormState` แต่เป็นไฟล์แนบที่บังคับ — มันไม่เคยอยู่ใน
 * `clientErrors` (ดู `missing` ข้างล่าง) จึงต้องมีป้ายของตัวเองที่นี่
 */
const FIELD_LABELS: Record<FormField | "DATA_DICTIONARY", string> = {
  dataType: "ประเภทข้อมูล",
  dataTopic: "ประเด็น",
  dataTopicOther: "ระบุประเด็นอื่น ๆ",
  title: "ชื่อชุดข้อมูล (ภาษาไทย)",
  name: "ชื่อชุดข้อมูล (ภาษาอังกฤษ)",
  dataFields: "รายการข้อมูล (ฟิลด์ข้อมูล) ที่ประสงค์จะนำส่ง",
  maintainer: "ชื่อผู้ติดต่อ",
  maintainerEmail: "อีเมลผู้ติดต่อ",
  tagString: "คำสำคัญ หรือคำค้น",
  notes: "รายละเอียด",
  objective: "วัตถุประสงค์",
  objectiveOther: "ระบุวัตถุประสงค์อื่น ๆ",
  updateFrequencyUnit: "หน่วยความถี่ของการปรับปรุงข้อมูลต้นทาง",
  updateFrequencyInterval: "ค่าความถี่ของการปรับปรุงข้อมูลต้นทาง",
  deliveryFrequency: "ความถี่ของการนำส่งข้อมูลเข้าสู่ระบบกลาง",
  geoCoverage: "ความละเอียดเชิงภูมิศาสตร์",
  geoCoverageOther: "ระบุความละเอียดเชิงภูมิศาสตร์อื่น ๆ",
  dataSource: "แหล่งที่มาของข้อมูล",
  dataFormat: "รูปแบบการนำส่งข้อมูล",
  dataFormatOther: "ชื่อระบบเชื่อมโยงข้อมูล",
  dataCategory: "หมวดหมู่ข้อมูลตามธรรมาภิบาลข้อมูลภาครัฐ",
  containsPersonalData: "ชุดข้อมูลนี้มีข้อมูลส่วนบุคคลหรือไม่",
  personalDataTypes: "ประเภทของข้อมูลส่วนบุคคล",
  dataSubjectCategories: "กลุ่มหรือประเภทของเจ้าของข้อมูลส่วนบุคคล",
  personalDataProcessingPeriod: "ระยะเวลาประมวลผลข้อมูลส่วนบุคคล",
  personalDataProcessingPeriodYear: "จำนวนปี",
  personalDataProcessingPeriodMonth: "จำนวนเดือน",
  dataClassification: "ระดับชั้นข้อมูล",
  licenseId: "สัญญาอนุญาตให้ใช้ข้อมูล",
  allowOriginalRawDataRetention: "การจัดเก็บข้อมูลดิบต้นฉบับ",
  allowOriginalRawDataSharing: "การส่งต่อข้อมูลดิบต้นฉบับแก่หน่วยงานของรัฐอื่น",
  allowTransformedRawDataSharing: "การส่งต่อข้อมูลดิบแปลงสภาพไปยังระบบเชื่อมโยงข้อมูลอื่น",
  allowTransformedRawDataSharingSpecifiedPlatforms: "ระบบเชื่อมโยงข้อมูลที่อนุญาต",
  allowTransformedRawDataGdxSharing: "การส่งต่อข้อมูลดิบแปลงสภาพไปยัง GDX",
  allowAggregatedDataSharing: "การส่งต่อข้อมูลรวม (aggregated data)",
  authorizePersonalDataAnonymization: "การมอบหมายให้ประมวลผลข้อมูลส่วนบุคคลให้ไม่ระบุตัวตน",
  DATA_DICTIONARY: "พจนานุกรมข้อมูล (Data Dictionary)",
};

export default function EditDatasetRequestPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const { show } = useToast();
  const { ready } = useRequireAuth();

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [fields, setFields] = useState<Record<string, string>>({});
  /** ช่องที่ผู้ใช้เข้าไปแล้วออกมา — ก่อนนั้นไม่เตือน ไม่งั้นขอบแดงขึ้นระหว่างพิมพ์ตัวแรก */
  const [touched, setTouched] = useState<Partial<Record<FormField, boolean>>>({});
  const [loading, setLoading] = useState(true);
  /** ตัวเลือกมาจาก /api/dataset-choices แล้ว ไม่ได้อยู่ในบันเดิลของหน้านี้ */
  const { choices, loaded: choicesLoaded } = useDatasetChoices();
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [revisionNote, setRevisionNote] = useState<string | null>(null);
  const [requestNumber, setRequestNumber] = useState("");
  const [organizationName, setOrganizationName] = useState("");

  const [dictionary, setDictionary] = useState<UploadedFile | null>(null);
  const [example, setExample] = useState<UploadedFile | null>(null);
  const [uploadingKind, setUploadingKind] = useState<string | null>(null);
  const [removingKind, setRemovingKind] = useState<string | null>(null);

  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    // ยังไม่ล็อกอิน = API ตอบได้แค่ 401 แล้วฟอร์มจะขึ้นมาเปล่า ๆ
    // useRequireAuth พาไป /login?next=<หน้านี้> ให้แล้ว
    if (!ready) return;
    api
      .get<{ request: DatasetRequest }>(`/api/dataset-requests/${id}`)
      .then(({ request }) => {
        setForm(toFormState(request as unknown as Partial<Record<FormField, unknown>>));
        setRevisionNote(request.revisionNote);
        setRequestNumber(request.requestNumber);
        setOrganizationName(request.organization?.name ?? "");
        const find = (kind: string) => request.attachments.find((a) => a.kind === kind) ?? null;
        setDictionary(find("DATA_DICTIONARY"));
        setExample(find("EXAMPLE_DATA"));
      })
      .catch(() => show({ tone: "error", title: "โหลดข้อมูลไม่สำเร็จ" }))
      .finally(() => setLoading(false));
  }, [id, show, ready]);

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

  const touch = (key: FormField) => setTouched((t) => (t[key] ? t : { ...t, [key]: true }));

  /**
   * เลือกค่าให้ช่องหนึ่ง แล้วนับว่า "แตะแล้ว" ทันที ไม่ต้องรอ blur
   *
   * dropdown กับปุ่มตัวเลือกไม่มีสถานะ "กำลังพิมพ์" แบบช่องข้อความ ที่ต้องรอจนออกจากช่อง
   * ก่อนจึงตัดสินได้ว่าค่าที่เห็นคือค่าที่ผู้ใช้ตั้งใจ — การเลือกคือการตอบเสร็จแล้ว การรอ blur
   * อีกทีแปลว่าช่องที่เพิ่งเลือกค้างอยู่โดยไม่มีขอบเขียว จนกว่าผู้ใช้จะไปแตะอย่างอื่น
   */
  const choose = (key: FormField, value: string) => {
    set(key, value);
    touch(key);
  };

  const rules = useMemo(() => formRules(form), [form]);

  /**
   * ผลตรวจฝั่งหน้าเว็บ คิดใหม่ทุกครั้งที่ฟอร์มเปลี่ยน — พิมพ์แก้ให้ถูกแล้วข้อความหายเอง
   * ไม่ต้องรอ blur อีกรอบ
   *
   * ป้ายของหน่วยความถี่ส่งเข้าไปด้วย เพราะข้อความของข้อ 9.2 อ้างถึงมัน ("ปรับปรุงทุก 2 ปี
   * ให้กรอก 2") และป้ายอยู่ในฐานข้อมูล ไม่ได้อยู่ในโค้ด
   */
  const clientErrors = useMemo(
    () =>
      validateDatasetForm(form, {
        updateFrequencyUnitLabel:
          labelOf(choices.updateFrequencyUnit, form.updateFrequencyUnit) ?? undefined,
      }),
    [form, choices],
  );

  /**
   * ข้อความของช่องหนึ่ง — **ของ API มาก่อนของหน้าเว็บเสมอ** มันคือคำตอบของตัวตัดสินจริง
   * และมีข้อที่หน้าเว็บรู้เองไม่ได้ · ของหน้าเว็บขึ้นเฉพาะช่องที่ผู้ใช้แตะแล้ว
   */
  const errorOf = (key: FormField) => fields[key] || (touched[key] ? clientErrors[key] : undefined);

  /**
   * สถานะของช่องหนึ่ง — ข้อความที่ผิด ขอบเขียวเมื่อผ่าน และการนับว่าแตะแล้ว
   *
   * **ทุกช่องผูกกับตัวนี้ ไม่ใช่กับ `fields` ตรง ๆ** เดิมมีเพียงชื่อชุดข้อมูลไทย/อังกฤษสองช่อง
   * ที่หน้าเว็บตรวจเองได้ ที่เหลือรอให้ API ตอบตอนกด "ตรวจสอบคำขอ" ผู้ใช้จึงต้องกรอกจนครบ
   * ทั้งห้าส่วนก่อน ถึงจะรู้ว่าอีเมลผู้ติดต่อในส่วนที่ 1 พิมพ์ผิด (การ์ด "frontend validate
   * ฟอร์มชุดข้อมูล") ตอนนี้ `validateDatasetField()` รู้กฎของทุกช่องแล้ว
   *
   * ขอบเขียวจึงกลับมาได้โดยไม่หลอกว่า "ระบบตรวจแค่สองช่องนี้" ซึ่งเป็นเหตุผลเดิมที่ไม่ส่ง
   * `valid` ต่อ · มันขึ้นเฉพาะช่องที่ผู้ใช้กรอกเองและผ่านแล้ว ไม่ใช่ทุกช่องที่ไม่มี error
   * ไม่งั้นฟอร์มเปล่าจะเขียวทั้งหน้าตั้งแต่ยังไม่ได้กรอกอะไร
   */
  const fieldProps = (key: FormField) => {
    const error = errorOf(key);
    return {
      error,
      valid: Boolean(touched[key]) && !error && form[key].trim().length > 0,
      onBlur: () => touch(key),
    };
  };

  /**
   * ช่องที่ตอบแล้วเห็นคำตอบอยู่ในตัว — คำถามใช่/ไม่ใช่ (ปุ่มวงกลมที่เลือกไว้) กับช่องแบบชิป
   * (คำสำคัญ และรายการข้อมูล (ฟิลด์ข้อมูล) — ชิปที่เพิ่มเข้าไป) จึงไม่ต้องมีขอบเขียวมาบอก
   * ซ้ำอีกชั้น ที่ยังต้องส่งคือข้อความผิดพลาดและการนับว่าแตะแล้ว
   */
  const answerProps = (key: FormField) => ({
    error: errorOf(key),
    onBlur: () => touch(key),
  });

  /**
   * ส่วนไหนกรอกครบแล้ว — อ่านจาก `clientErrors` ชุดเดียวกับที่ขึ้นใต้ช่อง ไม่ใช่จาก
   * "ทุกช่องมีค่า" เหมือนเดิม ไม่งั้นแถบซ้ายติ๊กเขียวว่าส่วนที่ 1 ครบแล้ว ขณะที่อีเมล
   * ผู้ติดต่อในส่วนนั้นยังขอบแดงอยู่
   */
  const completion = useMemo(() => {
    const done: Record<string, boolean> = {};
    for (const [section, keys] of Object.entries(FIELDS_BY_SECTION)) {
      done[section] = keys.every((k) => !clientErrors[k]);
    }
    done["section-5"] = dictionary !== null;
    return done;
  }, [clientErrors, dictionary]);

  /**
   * ทุกอย่างที่ยังขวางไม่ให้กด "ตรวจสอบคำขอ" เรียงตามลำดับที่อยู่บนฟอร์ม
   *
   * อ่านจาก `clientErrors` ชุดเดียวกับขอบแดงใต้ช่องและเครื่องหมายถูกของแถบซ้าย ปุ่มจึงปิดอยู่
   * ก็ต่อเมื่อมีช่องที่หน้าจอทำเครื่องหมายไว้จริง ๆ — ปุ่มที่ปิดโดยไม่มีอะไรแดงเลยอ่านว่าหน้าเว็บพัง
   * ช่องที่ชีท conditions ไม่ได้ถาม `validateDatasetField()` คืน null อยู่แล้ว จึงไม่โผล่มาที่นี่
   * โดยไม่ต้องแยกกรณีเพิ่ม
   *
   * เดิมปุ่มนี้ปิดเมื่อไม่มีพจนานุกรมข้อมูลอย่างเดียว (การ์ด "Disable ปุ่มตรวจสอบคำขอ ถ้าไม่แนบ
   * ไฟล์ data dict") ตอนนี้ไฟล์นั้นเป็นหนึ่งรายการในลิสต์นี้ ไม่ใช่เงื่อนไขเดียวอีกต่อไป
   */
  const missing = useMemo<IncompleteItem[]>(() => {
    const items: IncompleteItem[] = [];
    for (const section of SECTIONS) {
      for (const key of FIELDS_BY_SECTION[section.id] ?? []) {
        const message = clientErrors[key];
        if (message) items.push({ key, section: section.tag, label: FIELD_LABELS[key], message });
      }
      if (section.id === "section-5" && !dictionary) {
        items.push({
          key: "DATA_DICTIONARY",
          section: section.tag,
          label: FIELD_LABELS.DATA_DICTIONARY,
          message: "กรุณาอัปโหลดไฟล์",
        });
      }
    }
    return items;
  }, [clientErrors, dictionary]);

  // ---------- actions ----------
  const persist = () =>
    api.patch<{ request: DatasetRequest }>(`/api/dataset-requests/${id}`, toPayload(form));

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

  /**
   * ลบไฟล์ต้องยิงถึง API ไม่ใช่ล้างแต่ state — บั๊กเดียวกับฟอร์มลงทะเบียนหน่วยงาน
   * (การ์ด "Bug ลบไฟล์ในฟอร์มแล้วไม่หาย")
   *
   * ที่นี่มีผลกับปุ่ม "ตรวจสอบคำขอ" ด้วย: `dictionary` ที่เป็น null เป็นหนึ่งใน `missing` ซึ่งก่อน
   * หน้านี้เป็นการปิดตามสิ่งที่หน้าเว็บคิดว่าเกิดขึ้น ขณะที่เซิร์ฟเวอร์ยังเก็บไฟล์อยู่และ
   * ยอมให้นำส่ง ตอนนี้ทั้งสองฝั่งพูดเรื่องเดียวกัน
   */
  const removeFile = async (kind: "DATA_DICTIONARY" | "EXAMPLE_DATA", file: UploadedFile) => {
    setRemovingKind(kind);
    try {
      await api.del(`/api/dataset-requests/${id}/attachments/${file.id}`);
      if (kind === "DATA_DICTIONARY") setDictionary(null);
      else setExample(null);
      show({ tone: "success", title: "ลบไฟล์แล้ว" });
    } catch (err) {
      // ไม่เดินผ่าน handleApiError() เพราะมันเขียน `fields` ทับทั้งชุด แล้วขอบแดงของช่อง
      // ที่ผู้ใช้กำลังไล่แก้อยู่จะหายไปพร้อมกัน ทั้งที่การลบไฟล์ไม่เกี่ยวกับช่องเหล่านั้น
      show({
        tone: "error",
        title: "ลบไฟล์ไม่สำเร็จ",
        detail: err instanceof ApiError ? err.message : undefined,
      });
    } finally {
      setRemovingKind(null);
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

  /**
   * รอตัวเลือกด้วย ไม่ใช่รอแค่คำขอ — Choice ตีความ options ที่ว่างเปล่าว่า "ล็อก"
   * ฟอร์มที่ขึ้นมาก่อนตัวเลือกมาถึงจึงเป็นฟอร์มที่ทุก dropdown กดไม่ได้อยู่ครู่หนึ่ง
   */
  if (loading || !choicesLoaded) return <Spinner />;

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <header className="mb-8">
        <p className="text-[13px] font-semibold uppercase tracking-wide text-coral-500">
          {requestNumber}
        </p>
        <h1 className="mt-1 text-[26px] font-semibold text-navy-800">ลงทะเบียนชุดข้อมูล</h1>
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
              description="ระบุข้อมูลพื้นฐานที่ใช้ระบุ อธิบาย และค้นหาชุดข้อมูลใน D2"
            />
            <div className="grid gap-5 p-6">
              <div className="grid gap-5 sm:grid-cols-2">
                <Wrap name="dataType">
                  <Choice
                    label="ประเภทข้อมูล"
                    required
                    value={form.dataType}
                    onChange={(v) => choose("dataType", v)}
                    {...fieldProps("dataType")}
                    options={optionsFor(choices.dataType)}
                  />
                </Wrap>
                <Wrap name="dataTopic">
                  <Choice
                    label="ประเด็น"
                    required
                    value={form.dataTopic}
                    onChange={(v) => choose("dataTopic", v)}
                    {...fieldProps("dataTopic")}
                    options={optionsFor(choices.dataTopic)}
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
                    {...fieldProps("dataTopicOther")}
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
                    placeholder="เช่น สถิติผู้ป่วยนอกรายเดือน"
                    {...fieldProps("title")}
                  />
                </Wrap>
                <Wrap name="name">
                  <TextField
                    label="ชื่อชุดข้อมูล (ภาษาอังกฤษ)"
                    required
                    maxLength={150}
                    value={form.name}
                    onChange={(e) => set("name", e.target.value)}
                    placeholder="เช่น Monthly Outpatient Statistics"
                    {...fieldProps("name")}
                  />
                </Wrap>
              </div>
              <Wrap name="dataFields">
                <ChipInput
                  label="รายการข้อมูล (ฟิลด์ข้อมูล) ที่ประสงค์จะนำส่ง"
                  noun="ชื่อฟิลด์"
                  unit="ฟิลด์"
                  limit={1000}
                  value={form.dataFields}
                  onChange={(next) => set("dataFields", next)}
                  {...answerProps("dataFields")}
                />
              </Wrap>
              <ReadOnlyField label="องค์กร" value={organizationName} />
              <div className="grid gap-5 sm:grid-cols-2">
                <Wrap name="maintainer">
                  <TextField
                    label="ชื่อผู้ติดต่อ"
                    required
                    maxLength={150}
                    value={form.maintainer}
                    onChange={(e) => set("maintainer", e.target.value)}
                    {...fieldProps("maintainer")}
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
                    {...fieldProps("maintainerEmail")}
                    hint="อีเมลของกอง สำนัก หรือฝ่าย ไม่ใช่อีเมลส่วนตัว"
                  />
                </Wrap>
              </div>
              <Wrap name="tagString">
                <ChipInput
                  label="คำสำคัญ หรือคำค้น"
                  noun="คำสำคัญ"
                  unit="คำ"
                  limit={200}
                  value={form.tagString}
                  onChange={(next) => set("tagString", next)}
                  {...answerProps("tagString")}
                />
              </Wrap>
              <Wrap name="notes">
                <TextAreaField
                  label="รายละเอียด"
                  required
                  maxLength={1000}
                  value={form.notes}
                  onChange={(e) => set("notes", e.target.value)}
                  {...fieldProps("notes")}
                  hint={counterHint(
                    form.notes,
                    1000,
                    "คำอธิบายรายละเอียดที่สำคัญของชุดข้อมูลอย่างสั้น เช่น คำนิยาม ชุดข้อมูลเกี่ยวกับอะไร มีวิธีการจัดเก็บแบบใด กลุ่มเป้าหมายผู้ใช้งานข้อมูลเป็นใคร (อย่างน้อย 30 ตัวอักษร)",
                  )}
                />
              </Wrap>
              <Wrap name="objective">
                <MultiChoice
                  label="วัตถุประสงค์"
                  required
                  value={form.objective}
                  onChange={(v) => choose("objective", v)}
                  {...answerProps("objective")}
                  options={optionsFor(choices.objective)}
                  hint="ที่มาและวัตถุประสงค์ของการจัดทำชุดข้อมูล เช่น กฎหมาย ภารกิจ หรือโครงการตามแผนยุทธศาสตร์ — เลือกได้มากกว่า 1 ข้อ"
                />
              </Wrap>
              {rules.objectiveOther.visible ? (
                <Wrap name="objectiveOther">
                  <TextField
                    label="ระบุวัตถุประสงค์อื่น ๆ"
                    required
                    maxLength={200}
                    value={form.objectiveOther}
                    onChange={(e) => set("objectiveOther", e.target.value)}
                    {...fieldProps("objectiveOther")}
                    hint={counterHint(form.objectiveOther, 200, "วัตถุประสงค์ที่ไม่อยู่ในรายการข้างบน")}
                  />
                </Wrap>
              ) : null}
            </div>
          </Card>

          {/* ---------------- ส่วนที่ 2 ---------------- */}
          <Card id={SECTIONS[1]!.id} className="scroll-mt-24">
            <CardHeader
              tag={SECTIONS[1]!.tag}
              title={SECTIONS[1]!.title}
              description="ระบุแหล่งที่มา รอบการปรับปรุง ขอบเขตพื้นที่ และวิธีนำส่งข้อมูลเข้าสู่ D2"
            />
            <div className="grid gap-5 p-6">
              <div className="grid gap-5 sm:grid-cols-2">
                <Wrap name="updateFrequencyUnit">
                  <Choice
                    label="หน่วยความถี่ของการปรับปรุงข้อมูลต้นทาง"
                    required
                    value={form.updateFrequencyUnit}
                    onChange={(v) => choose("updateFrequencyUnit", v)}
                    {...fieldProps("updateFrequencyUnit")}
                    options={optionsFor(choices.updateFrequencyUnit)}
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
                      {...fieldProps("updateFrequencyInterval")}
                      hint={`ปรับปรุงทุกกี่${
                        labelOf(choices.updateFrequencyUnit, form.updateFrequencyUnit) ?? "หน่วย"
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
                    onChange={(v) => choose("deliveryFrequency", v)}
                    {...fieldProps("deliveryFrequency")}
                    options={optionsFor(choices.deliveryFrequency)}
                  />
                </Wrap>
                <Wrap name="geoCoverage">
                  <Choice
                    label="ความละเอียดเชิงภูมิศาสตร์"
                    required
                    value={form.geoCoverage}
                    onChange={(v) => choose("geoCoverage", v)}
                    {...fieldProps("geoCoverage")}
                    options={optionsFor(choices.geoCoverage)}
                    hint="มิติการจัดจำแนกพื้นที่ในระดับย่อยที่สุดที่จัดเก็บหรือนำเสนอ"
                  />
                </Wrap>
              </div>
              {rules.geoCoverageOther.visible ? (
                <Wrap name="geoCoverageOther">
                  <TextField
                    label="ระบุความละเอียดเชิงภูมิศาสตร์อื่น ๆ"
                    required
                    maxLength={300}
                    value={form.geoCoverageOther}
                    onChange={(e) => set("geoCoverageOther", e.target.value)}
                    {...fieldProps("geoCoverageOther")}
                  />
                </Wrap>
              ) : null}
              <Wrap name="dataSource">
                <TextField
                  label="แหล่งที่มาของข้อมูล"
                  required
                  maxLength={200}
                  value={form.dataSource}
                  onChange={(e) => set("dataSource", e.target.value)}
                  {...fieldProps("dataSource")}
                  hint="ระบุแหล่งที่มาพร้อมหน่วยงานที่จัดทำ เช่น สำรวจภาวะการทำงานของประชากร (สำนักงานสถิติแห่งชาติ)"
                />
              </Wrap>
              <div className="grid gap-5 sm:grid-cols-2">
                <Wrap name="dataFormat">
                  <Choice
                    label="รูปแบบการนำส่งข้อมูล"
                    required
                    value={form.dataFormat}
                    onChange={(v) => choose("dataFormat", v)}
                    {...fieldProps("dataFormat")}
                    options={optionsFor(choices.dataFormat)}
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
                      {...fieldProps("dataFormatOther")}
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
              description="ระบุประเภทและระดับชั้นของข้อมูลตามหลักธรรมาภิบาลข้อมูลภาครัฐ ระบบจะแสดงตัวเลือกที่เกี่ยวข้องตามข้อมูลที่คุณเลือก"
            />
            <div className="grid gap-5 p-6">
              <Wrap name="dataCategory">
                <Choice
                  label="หมวดหมู่ข้อมูลตามธรรมาภิบาลข้อมูลภาครัฐ"
                  required
                  value={form.dataCategory}
                  onChange={(v) => choose("dataCategory", v)}
                  {...fieldProps("dataCategory")}
                  options={optionsFor(choices.dataCategory)}
                />
              </Wrap>
              <Wrap name="containsPersonalData">
                <YesNo
                  label="ชุดข้อมูลนี้มีข้อมูลส่วนบุคคลหรือไม่"
                  required
                  labels={HAVE_LABELS}
                  value={form.containsPersonalData}
                  forced={rules.containsPersonalData.forced}
                  onChange={(v) => choose("containsPersonalData", v)}
                  {...answerProps("containsPersonalData")}
                  hint="ข้อมูลส่วนบุคคลตามกฎหมายว่าด้วยการคุ้มครองข้อมูลส่วนบุคคล"
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
                      {...fieldProps("personalDataTypes")}
                      hint="เช่น ชื่อ-นามสกุล เลขประจำตัวประชาชน ที่อยู่ เบอร์โทรศัพท์"
                    />
                  </Wrap>
                  <Wrap name="dataSubjectCategories">
                    <TextAreaField
                      label="กลุ่มหรือประเภทของเจ้าของข้อมูลส่วนบุคคล"
                      required
                      value={form.dataSubjectCategories}
                      onChange={(e) => set("dataSubjectCategories", e.target.value)}
                      {...fieldProps("dataSubjectCategories")}
                      hint="เช่น ผู้รับบริการของหน่วยงาน ผู้ประกอบการที่ขึ้นทะเบียน"
                    />
                  </Wrap>
                  <Wrap name="personalDataProcessingPeriod">
                    <Choice
                      label="ระยะเวลาประมวลผลข้อมูลส่วนบุคคล"
                      required
                      value={form.personalDataProcessingPeriod}
                      onChange={(v) => choose("personalDataProcessingPeriod", v)}
                      {...fieldProps("personalDataProcessingPeriod")}
                      options={optionsFor(choices.personalDataProcessingPeriod)}
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
                          {...fieldProps("personalDataProcessingPeriodYear")}
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
                          {...fieldProps("personalDataProcessingPeriodMonth")}
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
                    onChange={(v) => choose("dataClassification", v)}
                    {...fieldProps("dataClassification")}
                    options={optionsFor(choices.dataClassification, rules.dataClassification.options)}
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
                    onChange={(v) => choose("licenseId", v)}
                    {...fieldProps("licenseId")}
                    options={optionsFor(choices.licenseId, rules.licenseId.options)}
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
              description="กำหนดสิทธิที่หน่วยงานเจ้าของข้อมูลให้แก่สถาบันข้อมูลขนาดใหญ่ (องค์การมหาชน) หรือ BDI ในการจัดเก็บ ประมวลผล และส่งต่อข้อมูลผ่าน D2"
            />
            <div className="grid gap-5 p-6">
              <Wrap name="allowOriginalRawDataRetention">
                <YesNo
                  label="ท่านอนุญาตให้สำนักงานยังคงจัดเก็บข้อมูลดิบต้นฉบับ (original raw data) แม้ถูกแปลงสภาพแล้วหรือไม่"
                  required
                  labels={GRANT_LABELS}
                  value={form.allowOriginalRawDataRetention}
                  forced={rules.allowOriginalRawDataRetention.forced}
                  onChange={(v) => choose("allowOriginalRawDataRetention", v)}
                  {...answerProps("allowOriginalRawDataRetention")}
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
                  onChange={(v) => choose("allowOriginalRawDataSharing", v)}
                  {...answerProps("allowOriginalRawDataSharing")}
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
                  onChange={(v) => choose("allowTransformedRawDataSharing", v)}
                  {...answerProps("allowTransformedRawDataSharing")}
                  forcedHint="ข้อมูลระดับนี้ส่งต่อข้อมูลแปลงสภาพได้โดยอัตโนมัติ"
                />
              </Wrap>
              {rules.allowTransformedRawDataSharingSpecifiedPlatforms.visible ? (
                <Wrap name="allowTransformedRawDataSharingSpecifiedPlatforms">
                  <TextAreaField
                    label="ระบุระบบเชื่อมโยงข้อมูลที่อนุญาต (หากไม่ระบุถือว่าอนุญาตให้ส่งต่อได้ทุกระบบ)"
                    maxLength={1000}
                    value={form.allowTransformedRawDataSharingSpecifiedPlatforms}
                    onChange={(e) =>
                      set("allowTransformedRawDataSharingSpecifiedPlatforms", e.target.value)
                    }
                    {...fieldProps("allowTransformedRawDataSharingSpecifiedPlatforms")}
                    hint="เว้นว่างได้ — เว้นไว้แปลว่าอนุญาตให้ส่งต่อไปยังระบบเชื่อมโยงข้อมูลใดก็ได้"
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
                  onChange={(v) => choose("allowTransformedRawDataGdxSharing", v)}
                  {...answerProps("allowTransformedRawDataGdxSharing")}
                  forcedHint="ข้อมูลระดับนี้ส่งต่อข้อมูลแปลงสภาพได้โดยอัตโนมัติ"
                />
              </Wrap>
              <Wrap name="allowAggregatedDataSharing">
                <YesNo
                  label="ท่านอนุญาตให้สำนักงานส่งต่อข้อมูลรวม (aggregated data) ที่สร้างจากข้อมูลดิบต้นฉบับของท่านหรือไม่"
                  required
                  labels={GRANT_LABELS}
                  value={form.allowAggregatedDataSharing}
                  forced={rules.allowAggregatedDataSharing.forced}
                  onChange={(v) => choose("allowAggregatedDataSharing", v)}
                  {...answerProps("allowAggregatedDataSharing")}
                  forcedHint="ข้อมูลระดับนี้ส่งต่อข้อมูลรวมได้โดยอัตโนมัติ"
                />
              </Wrap>
              {rules.authorizePersonalDataAnonymization.visible ? (
                <Wrap name="authorizePersonalDataAnonymization">
                  <YesNo
                    label="ท่านมอบหมายให้ สขญ. ประมวลผลข้อมูลส่วนบุคคลซึ่งเป็นข้อมูลดิบต้นฉบับ (original raw data) ให้เป็นข้อมูลที่ไม่สามารถระบุตัวตนได้ เพื่อการใช้ประโยชน์เชิงวิเคราะห์ต่อไปหรือไม่"
                    required
                    labels={ASSIGN_LABELS}
                    value={form.authorizePersonalDataAnonymization}
                    forced=""
                    onChange={(v) => choose("authorizePersonalDataAnonymization", v)}
                    {...answerProps("authorizePersonalDataAnonymization")}
                    hint="ถ้าไม่มอบหมาย สำนักงานจะนำข้อมูลชุดนี้ไปใช้สร้างแบบจำลองไม่ได้"
                  />
                </Wrap>
              ) : null}
            </div>
          </Card>

          {/* ---------------- ส่วนที่ 5 ---------------- */}
          <Card id={SECTIONS[4]!.id} className="scroll-mt-24">
            <CardHeader
              tag={SECTIONS[4]!.tag}
              title={SECTIONS[4]!.title}
            />
            <div className="grid gap-5 p-6 sm:grid-cols-2">
              <div data-field="DATA_DICTIONARY">
                <FileUpload
                  label="พจนานุกรมข้อมูล (Data Dictionary)"
                  required
                  value={dictionary}
                  error={fields.DATA_DICTIONARY}
                  uploading={uploadingKind === "DATA_DICTIONARY"}
                  removing={removingKind === "DATA_DICTIONARY"}
                  onSelect={(f) => uploadFile("DATA_DICTIONARY", f)}
                  onRemove={() => dictionary && removeFile("DATA_DICTIONARY", dictionary)}
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
                  removing={removingKind === "EXAMPLE_DATA"}
                  onSelect={(f) => uploadFile("EXAMPLE_DATA", f)}
                  onRemove={() => example && removeFile("EXAMPLE_DATA", example)}
                  accept=".csv,.xlsx,.xls,.json,text/csv,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  supportText="รองรับ CSV, XLSX หรือ JSON ขนาดไม่เกิน 10 MB"
                />
              </div>
            </div>
          </Card>

          {/* ทึบเต็ม ไม่ใช้ความโปร่ง — เนื้อหาข้างหลังทะลุมาแล้วอ่านยาก */}
          <div className="sticky bottom-0 -mx-4 rounded-t-2xl border-t border-line bg-white px-4 py-4 shadow-[0_-4px_16px_rgb(20_26_51_/_0.06)] sm:mx-0 sm:px-6">
            {/*
              บรรทัดที่เคยบอกเรื่องพจนานุกรมข้อมูลอย่างเดียวถูกแทนด้วยกล่องของ IncompleteGate
              ซึ่งพูดแทนทุกเงื่อนไขรวมถึงไฟล์นั้น — คำอธิบายสองชุดของปุ่มเดียวกันจะขัดกันเอง

              แถวปุ่มทั้งแถวเป็นของ IncompleteGate เพราะกล่องรายการต้องงอกลงมา *ใต้แถว* ในแถบนี้
              (เหตุผลอยู่ในหัวคอมโพเนนต์) "บันทึกแบบร่าง" จึงเข้าไปเป็น secondaryAction แทนที่จะ
              วางไว้ข้าง ๆ ตรงนี้
            */}
            <IncompleteGate
              items={missing}
              actionLabel="ตรวจสอบคำขอ"
              hintId={INCOMPLETE_HINT_ID}
              secondaryAction={
                <Button type="button" variant="secondary" loading={saving} onClick={saveDraft}>
                  บันทึกแบบร่าง
                </Button>
              }
            >
              <Button
                type="submit"
                loading={generating}
                disabled={missing.length > 0}
                aria-describedby={missing.length > 0 ? INCOMPLETE_HINT_ID : undefined}
              >
                ตรวจสอบคำขอ
              </Button>
            </IncompleteGate>
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
  valid,
  onBlur,
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
  valid?: boolean;
  onBlur?: () => void;
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
      /* ค่าที่ระบบบังคับไม่ใช่คำตอบของผู้ใช้ ขอบเขียวจึงไม่ขึ้น — มีบรรทัดบอกเหตุผลแทนอยู่แล้ว */
      valid={valid && !locked}
      onBlur={onBlur}
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
 * ช่องเลือกได้หลายข้อ (ข้อ 8 วัตถุประสงค์ — ช่องเดียวในฟอร์มที่เป็น multi-select ตั้งแต่ชุด
 * 2026-09-20) เป็นกล่องติ๊กในกรอบเดียวกับคำถามใช่/ไม่ใช่ ไม่ใช่ dropdown ที่กด Ctrl ค้าง
 *
 * ค่าเป็นรหัสคั่นด้วย "," รูปเดียวกับที่ API เก็บ (`splitTags()` อ่าน) เรียงตามรหัสทุกครั้ง
 * ที่ติ๊ก จะได้ตรงกับที่ backend normalise แล้วส่งกลับมา — ฟอร์มจึงไม่เห็นค่า "เปลี่ยน" ทั้งที่
 * ผู้ใช้แค่ติ๊กลำดับต่างกัน
 */
function MultiChoice({
  label,
  required,
  value,
  onChange,
  error,
  onBlur,
  options,
  hint,
}: {
  label: string;
  required?: boolean;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  onBlur?: () => void;
  options: Array<[string, string]>;
  hint?: string;
}) {
  const selected = new Set(splitTags(value));
  const toggle = (code: string) => {
    const next = new Set(selected);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    onChange([...next].sort().join(","));
  };
  return (
    <fieldset
      className={clsx("rounded-xl border p-4", error ? "border-danger" : "border-line")}
      aria-invalid={error ? true : undefined}
    >
      <legend className="px-1 text-sm font-medium leading-relaxed text-ink">
        {label}
        {required ? <span className="ml-1 text-coral-500">*</span> : null}
      </legend>
      {options.length === 0 ? (
        <p className="mt-2 text-[13px] text-ink-muted">ยังไม่มีตัวเลือกให้เลือก</p>
      ) : (
        <div className="mt-2 grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {options.map(([code, text]) => (
            <label key={code} className="flex cursor-pointer items-start gap-2 text-[15px] text-ink">
              <input
                type="checkbox"
                name={label}
                value={code}
                checked={selected.has(code)}
                onChange={() => toggle(code)}
                onBlur={onBlur}
                className="mt-1 h-4 w-4 shrink-0 rounded border-line text-coral-500 focus:ring-2 focus:ring-navy-100"
              />
              <span>{text}</span>
            </label>
          ))}
        </div>
      )}
      {error ? (
        <p className="mt-2 text-[13px] text-danger" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="mt-2 text-[13px] text-ink-muted">{hint}</p>
      ) : null}
    </fieldset>
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
  onBlur,
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
  /** เรียกเมื่อออกจากกลุ่มตัวเลือก — คำถามที่เข้าไปแล้วไม่ตอบต้องเตือนได้เหมือนช่องอื่น */
  onBlur?: () => void;
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
              onBlur={onBlur}
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
function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-ink">{label}</span>
      <p className="flex h-11 items-center rounded-[10px] border border-line bg-navy-50/60 px-3.5 text-[15px] text-ink-muted">
        {value || "—"}
      </p>
    </div>
  );
}

/**
 * ช่องกรอกแบบชิป — พิมพ์แล้วกด Enter หรือคอมมาเพื่อเพิ่มทีละรายการ
 * เก็บลงฐานข้อมูลเป็นสตริงเดียวคั่นด้วย "," ตามชีท (`tag_string`, `data_fields`)
 *
 * ใช้ร่วมกันสองช่อง: คำสำคัญ และรายการข้อมูล (ฟิลด์ข้อมูล) — การ์ด "ปรับวิธีการกรอก
 * รายการข้อมูล (ฟิลด์ข้อมูล)" ขอให้ช่องหลังกรอกและแสดงผลแบบเดียวกับช่องแรก เพราะทั้งคู่
 * เป็นรายการคั่นด้วยจุลภาคเหมือนกัน แต่เดิมช่องฟิลด์เป็นกล่องข้อความยาว ๆ ที่ผู้กรอก
 * ต้องพิมพ์จุลภาคเอง และไม่เห็นว่าระบบตัดคำออกมาได้กี่รายการ
 *
 * ปุ่มลบเป็น `<svg>` ไม่ใช่ตัวอักษร "×": ตัวอักษรวางบนเส้นฐานของฟอนต์ และ body
 * ตั้ง line-height ไว้ 1.7 (22.1px) ให้สระกับวรรณยุกต์ไทย ซึ่งสูงกว่าปุ่ม 16px
 * — `place-items-center` จึงจัดกึ่งกลาง "กล่องบรรทัด" ไม่ใช่ตัวหมึก กากบาทเลย
 * ตกต่ำกว่าจุดกึ่งกลางวงกลมราว 4px และหลุดแนวเดียวกับตัวอักษรในชิป ไอคอน SVG
 * ไม่มีเส้นฐาน จึงอยู่กึ่งกลางตามเรขาคณิตเสมอ
 */
function ChipInput({
  label,
  noun,
  unit,
  limit,
  value,
  onChange,
  error,
  onBlur,
}: {
  label: string;
  /** สิ่งที่พิมพ์ลงไปหนึ่งชิป ใช้ในคำใบ้และป้ายปุ่มลบ เช่น "คำสำคัญ" "ชื่อฟิลด์" */
  noun: string;
  /** ลักษณนามของชิป ใช้นับ เช่น "คำ" "ฟิลด์" */
  unit: string;
  /** เพดานความยาวของสตริงที่เก็บจริง รวมจุลภาค — ต้องตรงกับกฎใน `dataset-form.ts` */
  limit: number;
  value: string;
  onChange: (next: string) => void;
  error?: string;
  /** เรียกหลังเก็บคำที่ค้างอยู่ในช่องพิมพ์แล้ว ไม่ใช่ก่อน — ไม่งั้นคำสุดท้ายยังไม่นับตอนตรวจ */
  onBlur?: () => void;
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

  const remaining = limit - value.length;

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-ink">
        {label}
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
              aria-label={`ลบ${noun} ${word}`}
              onClick={() => onChange(tags.filter((w) => w !== word).join(","))}
              className="grid h-4 w-4 shrink-0 place-items-center rounded-full text-navy-600 transition-colors hover:bg-navy-200 hover:text-navy-800"
            >
              <svg
                viewBox="0 0 20 20"
                className="h-2.5 w-2.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                aria-hidden="true"
              >
                <path d="M5 5 15 15M15 5 5 15" strokeLinecap="round" />
              </svg>
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
          onBlur={() => {
            add();
            onBlur?.();
          }}
          maxLength={Math.max(remaining, 0)}
          placeholder={tags.length === 0 ? `พิมพ์${noun}แล้วกด , หรือ Enter` : ""}
          className="h-8 min-w-40 flex-1 bg-transparent px-1.5 text-[15px] outline-none placeholder:text-ink-subtle"
        />
      </div>
      {error ? (
        <p className="text-[13px] text-danger" role="alert">
          {error}
        </p>
      ) : (
        <p className="text-[13px] text-ink-muted">
          {/* บอกตัวคั่นไว้ตรง ๆ — ผู้ทดสอบพิมพ์หลายคำเว้นวรรคแล้วได้ชิปเดียวยาว ๆ เพราะไม่รู้ว่าต้องคั่นด้วย "," (2026-09-18) */}
          พิมพ์ทีละ{unit}แล้วกด <kbd className="rounded border border-line bg-canvas px-1 font-mono text-[12px]">,</kbd> หรือ Enter{" "}
          {unit}นั้นถึงจะขึ้นเป็นแท็กแยกกัน — ถ้าไม่คั่นด้วยคอมมา ทั้งข้อความจะนับเป็น{noun}เดียว
          <br />
          อย่างน้อย 1 {unit} · รวมกันไม่เกิน {limit.toLocaleString("th-TH")} ตัวอักษร (เหลือ{" "}
          {Math.max(remaining, 0).toLocaleString("th-TH")})
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
