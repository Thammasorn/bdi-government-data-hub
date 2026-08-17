/**
 * แบบฟอร์มลงทะเบียน metadata ของชุดข้อมูล — ฝั่งหน้าเว็บ
 *
 * **สำเนาของ `backend/src/lib/dataset.ts`** ทั้งรายการรหัส ป้ายภาษาไทย และกฎในชีท
 * `conditions` ของ `assets/metadata_registration_form/metadata_mapping.xlsx`
 * แก้ที่ไฟล์ใดไฟล์หนึ่งแล้วต้องแก้อีกไฟล์ด้วยเสมอ
 *
 * ที่ต้องซ้ำเพราะหน้าเว็บต้องรู้ผลของเงื่อนไข "ทันทีที่ผู้ใช้เลือก" — ถ้าไปถาม API
 * ทุกครั้งที่เปลี่ยน dropdown ฟอร์มจะกระตุกและใช้ออฟไลน์ไม่ได้ ส่วน backend ก็เชื่อ
 * ค่าที่หน้าเว็บส่งมาไม่ได้อยู่ดี (normaliseMetadata() บังคับซ้ำก่อนเขียนฐานข้อมูลเสมอ)
 * แบบเดียวกับสีของ CI ที่ซ้ำอยู่ใน globals.css / mail.ts / pdf.ts
 */

// ------------------------------------------------------------------ รหัสและป้าย

export const DATA_TYPE_LABELS = {
  "1": "ข้อมูลระเบียน",
  "2": "ข้อมูลภูมิสารสนเทศ",
  "3": "ข้อมูลรวม (สถิติ)",
  "9": "ข้อมูลอื่น ๆ",
} as const;

export const DATA_TOPIC_LABELS = {
  "01": "ทรัพยากรน้ำ",
  "02": "อุตุนิยมวิทยา",
  "03": "ภัยพิบัติ",
  "04": "สภาพพื้นที่",
  "05": "โครงสร้างพื้นฐาน",
  "06": "การวางแผนและเยียวยา",
  "07": "ด้านสาธารณสุข",
  "99": "อื่น ๆ",
} as const;

export const UPDATE_FREQUENCY_UNIT_LABELS = {
  A: "ปี",
  S: "ครึ่งปี",
  Q: "ไตรมาส",
  M: "เดือน",
  W: "สัปดาห์",
  D: "วัน",
  B: "วันทำการ",
  H: "ชั่วโมง",
  N: "นาที",
  R: "ตามเวลาจริง",
  O: "ไม่มีการปรับปรุงหลังจากการจัดเก็บข้อมูล",
  U: "ไม่ทราบ",
} as const;

/** หน่วยที่ไม่มี "ทุก ๆ กี่หน่วย" ให้กรอก */
export const FREQUENCY_UNITS_WITHOUT_INTERVAL: string[] = ["R", "O", "U"];

export const DELIVERY_FREQUENCY_LABELS = {
  "1": "เมื่อมีการร้องขอ หรือเมื่อมีคำสั่ง",
  "2": "ต่อเนื่องรายเดือน",
  "3": "ต่อเนื่องรายไตรมาส",
  "4": "ต่อเนื่องรายครึ่งปี",
  "5": "ต่อเนื่องรายปี",
} as const;

export const GEO_COVERAGE_LABELS = {
  "00": "ไม่มี",
  "01": "โลก",
  "02": "ทวีป/กลุ่มประเทศในทวีป",
  "03": "กลุ่มประเทศทางเศรษฐกิจ",
  "04": "ประเทศ",
  "05": "ภาค",
  "06": "จังหวัด",
  "07": "อำเภอ",
  "08": "ตำบล",
  "09": "หมู่บ้าน",
  "10": "องค์กรปกครองส่วนท้องถิ่น",
  "11": "พิกัด",
  "98": "ไม่ทราบ",
  "99": "อื่น ๆ",
} as const;

export const DATA_FORMAT_LABELS = {
  "1": "วางไฟล์",
  "2": "Database synchronization",
  "3": "Batch API",
  "4": "ผ่านระบบเชื่อมโยงข้อมูลอื่น",
} as const;

export const DATA_FORMAT_OTHER_CODE = "4";
export const DATA_TOPIC_OTHER_CODE = "99";

export const DATA_CATEGORY_LABELS = {
  a: "ข้อมูลสาธารณะ",
  b: "ข้อมูลใช้ภายใน",
  c: "ข้อมูลความลับทางราชการ",
  d: "ข้อมูลความมั่นคง",
} as const;

export const PERSONAL_DATA_PERIOD_LABELS = {
  a: "จนกว่าจะมีคำสั่งยุติการประมวลผล",
  b: "ระบุระยะเวลา (ปี/เดือน)",
} as const;

export const PERSONAL_DATA_PERIOD_FIXED = "b";

export const DATA_CLASSIFICATION_LABELS = {
  "01": "เปิดเผย",
  "02": "เผยแพร่ภายในองค์กร",
  "03": "ลับ",
  "04": "ลับมาก",
  "05": "ลับที่สุด",
} as const;

export const LICENSE_LABELS = {
  G0: "Open Data Common",
  G2: "Creative Commons Attribution-NonCommercial",
  G5: "Others License",
} as const;

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
  maintainer: string;
  maintainerEmail: string;
  tagString: string;
  notes: string;
  objective: string;
  updateFrequencyUnit: string;
  updateFrequencyInterval: string;
  deliveryFrequency: string;
  geoCoverage: string;
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
  transformedRawDataRecipients: string;
  transformedRawDataGdxRecipients: string;
  aggregatedDataRecipients: string;
}

export type FormField = keyof FormState;

export const EMPTY_FORM: FormState = {
  dataType: "",
  dataTopic: "",
  dataTopicOther: "",
  title: "",
  name: "",
  maintainer: "",
  maintainerEmail: "",
  tagString: "",
  notes: "",
  objective: "",
  updateFrequencyUnit: "",
  updateFrequencyInterval: "",
  deliveryFrequency: "",
  geoCoverage: "",
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
  transformedRawDataRecipients: "",
  transformedRawDataGdxRecipients: "",
  aggregatedDataRecipients: "",
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
  transformedRawDataRecipients: FieldRule;
  transformedRawDataGdxRecipients: FieldRule;
  aggregatedDataRecipients: FieldRule;
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

  const recipients = (value: string): FieldRule => ({
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
    transformedRawDataRecipients: recipients(f.allowTransformedRawDataSharing),
    transformedRawDataGdxRecipients: recipients(f.allowTransformedRawDataGdxSharing),
    aggregatedDataRecipients: recipients(f.allowAggregatedDataSharing),
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
  if (!rules.transformedRawDataRecipients.visible) f.transformedRawDataRecipients = "";
  if (!rules.transformedRawDataGdxRecipients.visible) f.transformedRawDataGdxRecipients = "";
  if (!rules.aggregatedDataRecipients.visible) f.aggregatedDataRecipients = "";

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

// ------------------------------------------------------------------ การแสดงผล

/** 9.1 + 9.2 อ่านคู่กันเสมอ — "ทุก 2 ปี" ไม่ใช่ "ปี" กับ "2" คนละบรรทัด */
export function formatUpdateFrequency(
  unit: string | null | undefined,
  interval: number | string | null | undefined,
): string {
  if (!unit) return "";
  const label = UPDATE_FREQUENCY_UNIT_LABELS[unit as keyof typeof UPDATE_FREQUENCY_UNIT_LABELS] ?? unit;
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

/** ตัวช่วยทำ <option> เฉพาะรหัสที่เงื่อนไขยังอนุญาต โดยคงลำดับที่ประกาศไว้ */
export function optionsFor(
  labels: Record<string, string>,
  allowed?: string[],
): Array<[string, string]> {
  return Object.entries(labels).filter(([code]) => !allowed || allowed.includes(code));
}
