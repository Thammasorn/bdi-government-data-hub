/**
 * แบบฟอร์มลงทะเบียน metadata ของชุดข้อมูล — ฝั่งหน้าเว็บ
 *
 * **สำเนาของ *เครื่องยนต์เงื่อนไข* ใน `backend/src/lib/dataset.ts`** คือกฎในชีท
 * `conditions` ของ `assets/metadata_registration_form/metadata_mapping.xlsx`
 * แก้ที่ไฟล์ใดไฟล์หนึ่งแล้วต้องแก้อีกไฟล์ด้วยเสมอ
 *
 * ที่ต้องซ้ำเพราะหน้าเว็บต้องรู้ผลของเงื่อนไข "ทันทีที่ผู้ใช้เลือก" — ถ้าไปถาม API
 * ทุกครั้งที่เปลี่ยน dropdown ฟอร์มจะกระตุกและใช้ออฟไลน์ไม่ได้ ส่วน backend ก็เชื่อ
 * ค่าที่หน้าเว็บส่งมาไม่ได้อยู่ดี (normaliseMetadata() บังคับซ้ำก่อนเขียนฐานข้อมูลเสมอ)
 * แบบเดียวกับสีของ CI ที่ซ้ำอยู่ใน globals.css / mail.ts / pdf.ts
 *
 * **แต่ไม่ใช่สำเนาของ code list อีกต่อไป** — รหัสกับป้ายภาษาไทยย้ายไปอยู่ในฐานข้อมูล
 * ตั้งแต่การ์ด "Choice master data สำหรับ choice ในหน้า dataset registration" หน้าเว็บ
 * ดึงผ่าน `lib/dataset-choices.ts` เพราะป้ายเป็น *ข้อมูล* ที่ BDI แก้เองได้โดยไม่ต้อง
 * deploy ส่วนเงื่อนไขเป็น *ตรรกะ* ที่อ้างรหัสตรง ๆ และเปลี่ยนไปพร้อมโค้ดเสมอ
 *
 * ป้าย Y/N ข้างล่างยังอยู่ที่นี่โดยตั้งใจ: backend เก็บช่องเหล่านั้นเป็น Boolean ไม่ใช่รหัส
 * จึงไม่ใช่ code list และไม่มีแถวในตาราง
 */

import { labelOf, type ChoiceOption } from "./dataset-choices";

// ------------------------------------------------------------------ รหัสและป้าย

/** หน่วยที่ไม่มี "ทุก ๆ กี่หน่วย" ให้กรอก */
export const FREQUENCY_UNITS_WITHOUT_INTERVAL: string[] = ["R", "O", "U"];

export const DATA_FORMAT_OTHER_CODE = "4";
export const DATA_TOPIC_OTHER_CODE = "99";
/** ข้อ 10 รหัส "อื่น ๆ" — คนละรายการรหัสกับข้อ 1.2 ถึงจะเลขเท่ากัน */
export const GEO_COVERAGE_OTHER_CODE = "99";

export const PERSONAL_DATA_PERIOD_FIXED = "b";

/** ป้ายของคำตอบ Y/N ต่างกันไปตามคำถาม — "อนุญาต" กับ "มอบหมาย" ไม่ใช่คำเดียวกัน */
export const GRANT_LABELS = { Y: "อนุญาต", N: "ไม่อนุญาต" } as const;
export const ASSIGN_LABELS = { Y: "มอบหมาย", N: "ไม่มอบหมาย" } as const;
export const HAVE_LABELS = { Y: "มี", N: "ไม่มี" } as const;

// ------------------------------------------------------------------ รูปของฟอร์ม

/** ค่าที่เก็บใน state ของฟอร์ม — ทุกช่องเป็นสตริงเพราะมาจาก <input> โดยตรง */
export interface FormState {
  dataType: string;
  dataTopic: string;
  dataTopicOther: string;
  title: string;
  name: string;
  dataFields: string;
  maintainer: string;
  maintainerEmail: string;
  tagString: string;
  notes: string;
  objective: string;
  updateFrequencyUnit: string;
  updateFrequencyInterval: string;
  deliveryFrequency: string;
  geoCoverage: string;
  geoCoverageOther: string;
  dataSource: string;
  dataFormat: string;
  dataFormatOther: string;
  dataCategory: string;
  /** คำถาม Y/N เก็บเป็น "Y" | "N" | "" (ยังไม่ตอบ) */
  containsPersonalData: string;
  personalDataTypes: string;
  dataSubjectCategories: string;
  personalDataProcessingPeriod: string;
  personalDataProcessingPeriodYear: string;
  personalDataProcessingPeriodMonth: string;
  dataClassification: string;
  licenseId: string;
  allowOriginalRawDataRetention: string;
  allowOriginalRawDataSharing: string;
  allowTransformedRawDataSharing: string;
  allowTransformedRawDataGdxSharing: string;
  allowAggregatedDataSharing: string;
  authorizePersonalDataAnonymization: string;
  allowTransformedRawDataSharingSpecifiedPlatforms: string;
}

export type FormField = keyof FormState;

export const EMPTY_FORM: FormState = {
  dataType: "",
  dataTopic: "",
  dataTopicOther: "",
  title: "",
  name: "",
  dataFields: "",
  maintainer: "",
  maintainerEmail: "",
  tagString: "",
  notes: "",
  objective: "",
  updateFrequencyUnit: "",
  updateFrequencyInterval: "",
  deliveryFrequency: "",
  geoCoverage: "",
  geoCoverageOther: "",
  dataSource: "",
  dataFormat: "",
  dataFormatOther: "",
  dataCategory: "",
  containsPersonalData: "",
  personalDataTypes: "",
  dataSubjectCategories: "",
  personalDataProcessingPeriod: "",
  personalDataProcessingPeriodYear: "",
  personalDataProcessingPeriodMonth: "",
  dataClassification: "",
  licenseId: "",
  allowOriginalRawDataRetention: "",
  allowOriginalRawDataSharing: "",
  allowTransformedRawDataSharing: "",
  allowTransformedRawDataGdxSharing: "",
  allowAggregatedDataSharing: "",
  authorizePersonalDataAnonymization: "",
  allowTransformedRawDataSharingSpecifiedPlatforms: "",
};

/** ช่องที่เป็นตัวเลข — ส่งขึ้น API เป็น number ไม่ใช่สตริง */
const NUMBER_FIELDS: FormField[] = [
  "updateFrequencyInterval",
  "personalDataProcessingPeriodYear",
  "personalDataProcessingPeriodMonth",
];

/** ช่องที่เป็นคำถาม Y/N */
const FLAG_FIELDS: FormField[] = [
  "containsPersonalData",
  "allowOriginalRawDataRetention",
  "allowOriginalRawDataSharing",
  "allowTransformedRawDataSharing",
  "allowTransformedRawDataGdxSharing",
  "allowAggregatedDataSharing",
  "authorizePersonalDataAnonymization",
];

const flag = (value: string): boolean | null => (value === "" ? null : value === "Y");
const toFlag = (value: boolean | null | undefined): string =>
  value === null || value === undefined ? "" : value ? "Y" : "N";

// ------------------------------------------------------------------ ชีท conditions

export interface FieldRule {
  visible: boolean;
  /** ค่าที่ระบบบังคับ ("" = ผู้ใช้เลือกเอง) — ยังต้องแสดงบนหน้าจอ ไม่ใช่ซ่อน */
  forced: string;
}

export interface ChoiceRule extends FieldRule {
  options: string[];
}

export interface FormRules {
  containsPersonalData: FieldRule;
  personalDataDetail: FieldRule;
  personalDataPeriodAmount: FieldRule;
  dataClassification: ChoiceRule;
  licenseId: ChoiceRule;
  allowOriginalRawDataRetention: FieldRule;
  allowOriginalRawDataSharing: FieldRule;
  allowTransformedRawDataSharing: FieldRule;
  allowTransformedRawDataGdxSharing: FieldRule;
  allowAggregatedDataSharing: FieldRule;
  authorizePersonalDataAnonymization: FieldRule;
  allowTransformedRawDataSharingSpecifiedPlatforms: FieldRule;
  geoCoverageOther: FieldRule;
  dataTopicOther: FieldRule;
  dataFormatOther: FieldRule;
  updateFrequencyInterval: FieldRule;
}

const free = (visible = true): FieldRule => ({ visible, forced: "" });

/**
 * ชีท `conditions` ทั้งตาราง — คู่แฝดของ metadataRules() ฝั่ง backend
 * ที่ชีทเขียนว่า "default" หมายถึงบังคับ ผู้ใช้เปลี่ยนไม่ได้
 */
export function formRules(f: FormState): FormRules {
  const category = f.dataCategory;

  const personalForced = category === "a" ? "N" : "";
  const personalValue = personalForced || f.containsPersonalData;
  const personal = personalValue === "" ? null : personalValue === "Y";

  let classificationOptions: string[] = [];
  if (category === "a") classificationOptions = ["01"];
  else if (category === "b") {
    classificationOptions = personal ? ["02", "03", "04", "05"] : ["01", "02", "03", "04", "05"];
  } else if (category === "c" || category === "d") classificationOptions = ["03", "04", "05"];

  const classificationForced = classificationOptions.length === 1 ? classificationOptions[0]! : "";
  const classification =
    classificationForced ||
    (f.dataClassification && classificationOptions.includes(f.dataClassification)
      ? f.dataClassification
      : "");

  let licenseOptions: string[] = [];
  if (classification === "01") licenseOptions = ["G0"];
  else if (classification === "02") licenseOptions = ["G0", "G2"];
  else if (classification) licenseOptions = ["G5"];

  const fullyOpen = category === "a" || classification === "01";
  const internalNoPersonal = classification === "02" && personal === false;
  const derivedForced = fullyOpen || internalNoPersonal ? "Y" : "";

  const originalSharingForced = fullyOpen
    ? "Y"
    : f.allowOriginalRawDataRetention === "N"
      ? "N"
      : "";

  /** 16.1 ถามต่อว่า "ระบบไหนบ้าง" เมื่ออนุญาต และเฉพาะชุดข้อมูลที่มีข้อมูลส่วนบุคคล */
  const specifiedPlatforms = (value: string): FieldRule => ({
    visible: personal === true && (derivedForced || value) === "Y",
    forced: "",
  });

  return {
    containsPersonalData: { visible: true, forced: personalForced },
    personalDataDetail: free(personal === true),
    personalDataPeriodAmount: free(
      personal === true && f.personalDataProcessingPeriod === PERSONAL_DATA_PERIOD_FIXED,
    ),
    dataClassification: {
      visible: true,
      forced: classificationForced,
      options: classificationOptions,
    },
    licenseId: {
      visible: true,
      forced: licenseOptions.length === 1 ? licenseOptions[0]! : "",
      options: licenseOptions,
    },
    allowOriginalRawDataRetention: { visible: true, forced: fullyOpen ? "Y" : "" },
    allowOriginalRawDataSharing: { visible: true, forced: originalSharingForced },
    allowTransformedRawDataSharing: { visible: true, forced: derivedForced },
    allowTransformedRawDataGdxSharing: { visible: true, forced: derivedForced },
    allowAggregatedDataSharing: { visible: true, forced: derivedForced },
    authorizePersonalDataAnonymization: { visible: personal === true, forced: "" },
    allowTransformedRawDataSharingSpecifiedPlatforms: specifiedPlatforms(
      f.allowTransformedRawDataSharing,
    ),
    geoCoverageOther: free(f.geoCoverage === GEO_COVERAGE_OTHER_CODE),
    dataTopicOther: free(f.dataTopic === DATA_TOPIC_OTHER_CODE),
    dataFormatOther: free(f.dataFormat === DATA_FORMAT_OTHER_CODE),
    updateFrequencyInterval: free(
      f.updateFrequencyUnit !== "" &&
        !FREQUENCY_UNITS_WITHOUT_INTERVAL.includes(f.updateFrequencyUnit),
    ),
  };
}

/** ช่องที่ชีท conditions บังคับค่าได้ เรียงตามลำดับที่ช่องหลังขึ้นกับช่องหน้า */
const FORCEABLE_FIELDS = [
  "containsPersonalData",
  "dataClassification",
  "licenseId",
  "allowOriginalRawDataRetention",
  "allowOriginalRawDataSharing",
  "allowTransformedRawDataSharing",
  "allowTransformedRawDataGdxSharing",
  "allowAggregatedDataSharing",
] as const;

/**
 * เติมค่าที่ถูกบังคับและล้างช่องที่ไม่ต้องถาม — เรียกทุกครั้งที่ผู้ใช้เปลี่ยนค่า
 * ผู้ใช้จึงเห็นผลของเงื่อนไขทันที ไม่ต้องกดบันทึกก่อนถึงจะรู้ว่าระบบกำหนดอะไรให้
 * (คู่แฝดของ normaliseMetadata() ฝั่ง backend)
 *
 * `previous` คือค่าก่อนการเปลี่ยนแปลงครั้งนี้ ใช้ตอบคำถามเดียว: ช่องไหนที่ "เคยถูกบังคับ
 * แล้วตอนนี้เลือกเองได้" — ค่าพวกนั้นต้องถูกล้าง ไม่ใช่ค้างไว้เป็นคำตอบของผู้ใช้
 * เอกสารฉบับนี้คือหนังสือให้สิทธิ์ที่หน่วยงานลงนาม คำตอบที่ผู้ใช้ไม่เคยเลือกเองต้องไม่ติดไป
 */
export function applyRules(input: FormState, previous?: FormState): FormState {
  const f = { ...input };

  if (previous) {
    const before = formRules(previous);
    // ล้างทีละช่องตามลำดับ แล้วคำนวณกฎใหม่ทุกครั้ง เพราะการล้างระดับชั้นข้อมูล
    // ทำให้ข้อ 15–17 หลุดจากการถูกบังคับตามไปด้วย
    for (const key of FORCEABLE_FIELDS) {
      if (before[key].forced !== "" && formRules(f)[key].forced === "") f[key] = "";
    }
  }

  const first = formRules(f);
  if (first.containsPersonalData.forced) f.containsPersonalData = first.containsPersonalData.forced;
  if (first.dataClassification.forced) f.dataClassification = first.dataClassification.forced;
  else if (f.dataClassification && !first.dataClassification.options.includes(f.dataClassification)) {
    f.dataClassification = "";
  }

  const rules = formRules(f);
  if (rules.licenseId.forced) f.licenseId = rules.licenseId.forced;
  else if (f.licenseId && !rules.licenseId.options.includes(f.licenseId)) f.licenseId = "";

  const allowKeys = [
    "allowOriginalRawDataRetention",
    "allowOriginalRawDataSharing",
    "allowTransformedRawDataSharing",
    "allowTransformedRawDataGdxSharing",
    "allowAggregatedDataSharing",
  ] as const;
  for (const key of allowKeys) if (rules[key].forced) f[key] = rules[key].forced;

  if (!rules.personalDataDetail.visible) {
    f.personalDataTypes = "";
    f.dataSubjectCategories = "";
    f.personalDataProcessingPeriod = "";
  }
  if (!rules.personalDataPeriodAmount.visible) {
    f.personalDataProcessingPeriodYear = "";
    f.personalDataProcessingPeriodMonth = "";
  }
  if (!rules.authorizePersonalDataAnonymization.visible) f.authorizePersonalDataAnonymization = "";
  if (!rules.dataTopicOther.visible) f.dataTopicOther = "";
  if (!rules.dataFormatOther.visible) f.dataFormatOther = "";
  if (!rules.updateFrequencyInterval.visible) f.updateFrequencyInterval = "";
  if (!rules.geoCoverageOther.visible) f.geoCoverageOther = "";
  if (!rules.allowTransformedRawDataSharingSpecifiedPlatforms.visible) {
    f.allowTransformedRawDataSharingSpecifiedPlatforms = "";
  }

  return f;
}

// ------------------------------------------------------------------ แปลงค่าเข้า/ออก

/** ค่าที่ API คืนมา → state ของฟอร์ม */
export function toFormState(request: Partial<Record<FormField, unknown>>): FormState {
  const f = { ...EMPTY_FORM };
  for (const key of Object.keys(EMPTY_FORM) as FormField[]) {
    const value = request[key];
    if (value === null || value === undefined) continue;
    if (FLAG_FIELDS.includes(key)) f[key] = toFlag(value as boolean);
    else f[key] = String(value);
  }
  return applyRules(f);
}

/** state ของฟอร์ม → body ที่ส่งขึ้น API (ว่าง = null เพื่อล้างค่าเดิม) */
export function toPayload(f: FormState): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const key of Object.keys(EMPTY_FORM) as FormField[]) {
    const raw = f[key].trim();
    if (FLAG_FIELDS.includes(key)) body[key] = flag(raw);
    else if (NUMBER_FIELDS.includes(key)) body[key] = raw === "" ? null : Number(raw);
    else body[key] = raw === "" ? null : raw;
  }
  return body;
}

// ------------------------------------------------------------------ การตรวจข้อมูล

/**
 * ช่วง U+0E01–U+0E5B คือบล็อกภาษาไทยทั้งบล็อก — คู่แฝดของ containsThai()
 * ใน `backend/src/lib/validation.ts` และสำเนาเดียวกับใน `organization-form.ts`
 */
export function containsThai(value: string): boolean {
  return /[ก-๛]/.test(value);
}

/** นับแค่ a–z A–Z ไม่รวมอักษรละตินที่มีเครื่องหมายเสริม — ช่องนี้ขอภาษาอังกฤษ ไม่ใช่อักษรละตินทั้งบล็อก */
export function containsEnglish(value: string): boolean {
  return /[A-Za-z]/.test(value);
}

/**
 * ข้อความเดียวกับที่ `datasetSubmitSchema` ตอบกลับมา — ช่องเดียวกันต้องไม่พูดคนละอย่างสองรอบ
 * แล้วแต่ว่าผู้ใช้เห็นของฝั่งไหนก่อน
 */
export const TITLE_LANGUAGE_MESSAGE =
  "ชื่อชุดข้อมูลภาษาไทยต้องมีอักษรไทย (มีภาษาอังกฤษปนได้ เช่น สถิติผู้ป่วยนอกรายเดือน (OPD))";
export const NAME_LANGUAGE_MESSAGE =
  "ชื่อชุดข้อมูลภาษาอังกฤษต้องมีอักษรภาษาอังกฤษ (มีตัวเลขและอักษรไทยปนได้ เช่น Monthly Outpatient Statistics)";

/**
 * ผลตรวจฝั่งหน้าเว็บของทั้งฟอร์ม — คืนแต่ช่องที่ผิด
 *
 * **ตัวตัดสินจริงยังเป็น `datasetSubmitSchema` ฝั่ง API** ซึ่งตรวจซ้ำทุกครั้งตอนกด
 * "ตรวจสอบคำขอ" และตอนนำส่ง ที่นี่มีไว้ให้ฟอร์มเตือนได้ทันทีที่ผู้ใช้ออกจากช่อง
 * ไม่ต้องกรอกจนจบแล้วค่อยรู้ว่าพิมพ์ผิดช่อง — เหมือนที่ `organization-form.ts` ทำ
 * **กฎที่นี่ต้องตรงกับฝั่ง API เสมอ แก้ที่หนึ่งต้องแก้อีกที่ด้วย**
 *
 * วันนี้มีอยู่สองช่อง คือชื่อชุดข้อมูลไทยกับอังกฤษ ที่หน้าเว็บตัดสินเองได้จากค่าในช่องเดียว
 * ความครบถ้วนของช่องบังคับอื่น ๆ ไม่ได้อยู่ที่นี่ เพราะแถบความคืบหน้าด้านซ้ายบอกอยู่แล้ว
 * ว่าส่วนไหนยังไม่ครบ (ดู REQUIRED_BY_SECTION ในหน้าฟอร์ม) การขึ้น error แดงใต้ทุกช่อง
 * ที่ยังไม่ได้กรอกจะกลายเป็นหน้าจอแดงทั้งหน้าตั้งแต่เพิ่งเปิดฟอร์ม
 *
 * ช่องที่ยัง **ว่าง** คืน null ทุกช่อง — "ยังไม่ได้กรอก" ไม่ใช่ "กรอกผิดภาษา" และข้อความ
 * "กรุณากรอก…" เป็นของฝั่ง API ตอนนำส่ง
 */
export function validateDatasetForm(f: FormState): Partial<Record<FormField, string>> {
  const errors: Partial<Record<FormField, string>> = {};

  const title = f.title.trim();
  if (title && !containsThai(title)) errors.title = TITLE_LANGUAGE_MESSAGE;

  const name = f.name.trim();
  if (name && !containsEnglish(name)) errors.name = NAME_LANGUAGE_MESSAGE;

  return errors;
}

// ------------------------------------------------------------------ การแสดงผล

/**
 * 9.1 + 9.2 อ่านคู่กันเสมอ — "ทุก 2 ปี" ไม่ใช่ "ปี" กับ "2" คนละบรรทัด
 * รับรายการหน่วยความถี่เข้ามา เพราะป้ายของมันอยู่ในฐานข้อมูลแล้ว
 */
export function formatUpdateFrequency(
  units: ChoiceOption[],
  unit: string | null | undefined,
  interval: number | string | null | undefined,
): string {
  if (!unit) return "";
  const label = labelOf(units, unit) ?? unit;
  const count = typeof interval === "string" ? Number(interval) : interval;
  if (FREQUENCY_UNITS_WITHOUT_INTERVAL.includes(unit) || !count) return label;
  return `ทุก ${count.toLocaleString("th-TH")} ${label}`;
}

/** คำสำคัญเก็บเป็นสตริงเดียวคั่นด้วย "," ตามชีท — หน้าจอแสดงเป็นชิป */
export const splitTags = (value: string | null | undefined): string[] =>
  (value ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

/**
 * ตัวช่วยทำ <option> เฉพาะรหัสที่เงื่อนไขยังอนุญาต
 *
 * ลำดับมาจาก `display_order` ในฐานข้อมูล เซิร์ฟเวอร์เรียงมาให้แล้ว — ก่อนหน้านี้มีตาราง
 * `CHOICE_ORDER` ที่เปิดหาด้วย **object identity** ของ map ป้าย ซึ่งใช้กับข้อมูลที่ fetch
 * มาไม่ได้เลย การย้ายลำดับไปอยู่ในฐานข้อมูลจึงลบตารางนั้นทิ้งได้ทั้งตาราง
 *
 * `allowed` คือการหรี่ตัวเลือกตามเงื่อนไข (ข้อ 13.3 และ 14) ซึ่งยังเป็นตรรกะในโค้ด
 */
export function optionsFor(
  options: ChoiceOption[],
  allowed?: string[],
): Array<[string, string]> {
  return options
    .filter(({ code }) => !allowed || allowed.includes(code))
    .map(({ code, label }): [string, string] => [code, label]);
}
