/**
 * แบบฟอร์มลงทะเบียน metadata ของชุดข้อมูล — รหัส ป้ายภาษาไทย เงื่อนไข และการตรวจสอบ
 *
 * ที่มาของทุกอย่างในไฟล์นี้คือ `assets/metadata_registration_form/metadata_mapping.xlsx`
 *
 *   ชีท `A4_dataset_metadata` — ช่องที่ผู้ใช้ต้องกรอก (display) คู่กับคอลัมน์ที่เก็บผล
 *     (field_name) และรายการรหัสของแต่ละช่อง หมายเลขข้อ (1.1, 13.2.3, …) ในคอมเมนต์
 *     ข้างล่างคือหมายเลขในชีทนั้น ใช้อ้างกลับได้ตรง ๆ
 *   ชีท `conditions` — เลือกอะไรแล้วช่องไหนเปิด ปิด หรือถูกบังคับค่า อยู่ใน metadataRules()
 *   ชีท `สัญญาอนุญาต` — รายการสัญญาอนุญาตและเหตุผลที่ตัด G1/G3/G4 ออก
 *
 * **เก็บเป็นรหัสของมาตรฐาน ไม่ใช่ enum ที่ตั้งชื่อเอง** ("1", "01", "A", "G0", "a")
 * รหัสเหล่านี้คือของมาตรฐานบัญชีข้อมูลเปิดภาครัฐ การเก็บรหัสตรง ๆ ทำให้ส่งต่อ DGA/DII
 * ได้โดยไม่ต้องมีตารางแปลง และเพิ่มรหัสใหม่ได้โดยไม่ต้อง migrate ฐานข้อมูล
 *
 * ป้ายภาษาไทยชุดเดียวกันนี้ถูกคัดลอกไว้ที่ `frontend/lib/dataset-form.ts` ด้วย
 * (หน้าเว็บต้องแสดงผลแบบ synchronous ไม่ผ่าน API) — **แก้ที่นี่แล้วต้องแก้ที่นั่นด้วย**
 * เหมือนกับสีของ CI ที่ซ้ำอยู่ใน globals.css / mail.ts / pdf.ts
 */
import { z } from "zod";

// ------------------------------------------------------------------ รหัสและป้าย

/** 1.1 ประเภทข้อมูล — ปรับจาก code list มาตรฐาน: ใช้ "ข้อมูลรวม" แทน "สถิติ" และไม่รับ "หลากหลายประเภท" */
export const DATA_TYPE_LABELS: Record<string, string> = {
  "1": "ข้อมูลระเบียน",
  "2": "ข้อมูลภูมิสารสนเทศ",
  "3": "ข้อมูลรวม (สถิติ)",
  "9": "ข้อมูลอื่น ๆ",
};

/** 1.2 ประเด็น — อิงตามระเบียบสำนักนายกรัฐมนตรีว่าด้วยการแบ่งปันข้อมูลฯ */
export const DATA_TOPIC_LABELS: Record<string, string> = {
  "01": "ทรัพยากรน้ำ",
  "02": "อุตุนิยมวิทยา",
  "03": "ภัยพิบัติ",
  "04": "สภาพพื้นที่",
  "05": "โครงสร้างพื้นฐาน",
  "06": "การวางแผนและเยียวยา",
  "07": "ด้านสาธารณสุข",
  "99": "อื่น ๆ",
};

/** 9.1 หน่วยความถี่ของการปรับปรุงข้อมูลต้นทาง */
export const UPDATE_FREQUENCY_UNIT_LABELS: Record<string, string> = {
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
};

/**
 * หน่วยที่ไม่มี "ทุก ๆ กี่หน่วย" ให้กรอก — ถามว่าข้อมูลตามเวลาจริงปรับปรุงทุกกี่ครั้ง
 * ไม่มีคำตอบที่ถูก ทั้งสามค่านี้จึงซ่อนช่อง 9.2 และไม่บังคับกรอก
 * [สมมติฐาน] ชีทมาร์ก update_frequency_interval เป็น Required โดยไม่แยกกรณีนี้ไว้
 */
export const FREQUENCY_UNITS_WITHOUT_INTERVAL = ["R", "O", "U"];

/** 9.3 ความถี่ของการนำส่งข้อมูลเข้าสู่ระบบกลาง */
export const DELIVERY_FREQUENCY_LABELS: Record<string, string> = {
  "1": "เมื่อมีการร้องขอ หรือเมื่อมีคำสั่ง",
  "2": "ต่อเนื่องรายเดือน",
  "3": "ต่อเนื่องรายไตรมาส",
  "4": "ต่อเนื่องรายครึ่งปี",
  "5": "ต่อเนื่องรายปี",
};

/** 10 ความละเอียดเชิงภูมิศาสตร์ — ระดับย่อยที่สุดที่จัดเก็บหรือนำเสนอข้อมูล */
export const GEO_COVERAGE_LABELS: Record<string, string> = {
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
};

/** 12.1 รูปแบบการนำส่งข้อมูล */
export const DATA_FORMAT_LABELS: Record<string, string> = {
  "1": "วางไฟล์",
  "2": "Database synchronization",
  "3": "Batch API",
  "4": "ผ่านระบบเชื่อมโยงข้อมูลอื่น",
};

/** รูปแบบการนำส่งที่ต้องระบุชื่อระบบเชื่อมโยง */
export const DATA_FORMAT_OTHER_CODE = "4";

/**
 * 13.1 หมวดหมู่ข้อมูลตามธรรมาภิบาลข้อมูลภาครัฐ
 * "ข้อมูลส่วนบุคคล" ในมาตรฐานเป็นหมวด ค. แต่ชีทให้ถามเป็นคำถามแยก (13.2) รหัส c/d
 * ในนี้จึงเป็นความลับทางราชการกับความมั่นคง ตรงตามชีท ไม่ใช่ตามมาตรฐานต้นทาง
 */
export const DATA_CATEGORY_LABELS: Record<string, string> = {
  a: "ข้อมูลสาธารณะ",
  b: "ข้อมูลใช้ภายใน",
  c: "ข้อมูลความลับทางราชการ",
  d: "ข้อมูลความมั่นคง",
};

/** 13.2.3 ระยะเวลาประมวลผลข้อมูลส่วนบุคคล */
export const PERSONAL_DATA_PERIOD_LABELS: Record<string, string> = {
  a: "จนกว่าจะมีคำสั่งยุติการประมวลผล",
  b: "ระบุระยะเวลา (ปี/เดือน)",
};

/** 13.2.3 ตัวเลือก b ต้องระบุจำนวนปีและเดือน */
export const PERSONAL_DATA_PERIOD_FIXED = "b";

/** 13.3 ระดับชั้นข้อมูลตาม พ.ร.บ.ข้อมูลข่าวสารของราชการ พ.ศ. 2540 */
export const DATA_CLASSIFICATION_LABELS: Record<string, string> = {
  "01": "เปิดเผย",
  "02": "เผยแพร่ภายในองค์กร",
  "03": "ลับ",
  "04": "ลับมาก",
  "05": "ลับที่สุด",
};

/**
 * 14 สัญญาอนุญาตให้ใช้ข้อมูล — ชีท "สัญญาอนุญาต" รับเพียงสามฉบับ
 * G1 ตัดออกเพราะระบบไม่ให้ใช้เชิงพาณิชย์ (เว้นแต่เป็น open data)
 * G3 (ShareAlike) ขัดกับสิทธิของ BDI ในการกำหนด metadata และ G4 (NoDerivs) ขัดกับการจัดการข้อมูลดิบ
 */
export const LICENSE_LABELS: Record<string, string> = {
  G0: "Open Data Common",
  G2: "Creative Commons Attribution-NonCommercial",
  G5: "Others License",
};

const codes = (labels: Record<string, string>) => Object.keys(labels) as [string, ...string[]];

const DATA_TYPES = codes(DATA_TYPE_LABELS);
const DATA_TOPICS = codes(DATA_TOPIC_LABELS);
const UPDATE_FREQUENCY_UNITS = codes(UPDATE_FREQUENCY_UNIT_LABELS);
const DELIVERY_FREQUENCIES = codes(DELIVERY_FREQUENCY_LABELS);
const GEO_COVERAGES = codes(GEO_COVERAGE_LABELS);
const DATA_FORMATS = codes(DATA_FORMAT_LABELS);
const DATA_CATEGORIES = codes(DATA_CATEGORY_LABELS);
const PERSONAL_DATA_PERIODS = codes(PERSONAL_DATA_PERIOD_LABELS);
const DATA_CLASSIFICATIONS = codes(DATA_CLASSIFICATION_LABELS);
const LICENSES = codes(LICENSE_LABELS);

/** รหัสที่บอกว่าต้องกรอกช่อง "อื่น ๆ" ต่อ */
export const DATA_TOPIC_OTHER_CODE = "99";

// ------------------------------------------------------------------ ไฟล์แนบ

export const DATASET_MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/**
 * ชนิดไฟล์ที่รับได้ต่อประเภทเอกสาร — เบราว์เซอร์กับ Excel ส่ง MIME ของ CSV
 * มาได้หลายแบบ (text/csv, application/csv, application/vnd.ms-excel) จึงต้องรับทั้งชุด
 */
export const DATASET_ALLOWED_MIME: Record<"DATA_DICTIONARY" | "EXAMPLE_DATA", string[]> = {
  DATA_DICTIONARY: [
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
    "text/csv",
    "application/csv",
  ],
  EXAMPLE_DATA: [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
    "text/csv",
    "application/csv",
    "application/json",
    "text/plain",
  ],
};

export const DATASET_ATTACHMENT_LABELS: Record<string, string> = {
  DATA_DICTIONARY: "พจนานุกรมข้อมูล (Data Dictionary)",
  EXAMPLE_DATA: "ตัวอย่างข้อมูล",
  GENERATED_FORM: "แบบฟอร์มที่ระบบสร้าง",
};

// ------------------------------------------------------------------ รูปข้อมูล

/**
 * ค่าทุกช่องของแบบฟอร์มในรูปเดียว — ชื่อฟิลด์ตรงกับคอลัมน์ในชีท A4_dataset_metadata
 * ทั้งฐานข้อมูล API และหน้าเว็บใช้ชื่อชุดนี้ร่วมกัน จะได้ไม่ต้องแปลงชื่อไปมา
 */
export interface MetadataValues {
  dataType: string | null;
  dataTopic: string | null;
  dataTopicOther: string | null;
  title: string | null;
  name: string | null;
  maintainer: string | null;
  maintainerEmail: string | null;
  tagString: string | null;
  notes: string | null;
  objective: string | null;
  updateFrequencyUnit: string | null;
  updateFrequencyInterval: number | null;
  deliveryFrequency: string | null;
  geoCoverage: string | null;
  dataSource: string | null;
  dataFormat: string | null;
  dataFormatOther: string | null;
  dataCategory: string | null;
  containsPersonalData: boolean | null;
  personalDataTypes: string | null;
  dataSubjectCategories: string | null;
  personalDataProcessingPeriod: string | null;
  personalDataProcessingPeriodYear: number | null;
  personalDataProcessingPeriodMonth: number | null;
  dataClassification: string | null;
  licenseId: string | null;
  allowOriginalRawDataRetention: boolean | null;
  allowOriginalRawDataSharing: boolean | null;
  allowTransformedRawDataSharing: boolean | null;
  allowTransformedRawDataGdxSharing: boolean | null;
  allowAggregatedDataSharing: boolean | null;
  authorizePersonalDataAnonymization: boolean | null;

  /** ── ไม่มีคอลัมน์ในดีไซน์ เก็บใน additional_metadata_json ── */
  transformedRawDataRecipients: string | null;
  transformedRawDataGdxRecipients: string | null;
  aggregatedDataRecipients: string | null;
}

export const EMPTY_METADATA: MetadataValues = {
  dataType: null,
  dataTopic: null,
  dataTopicOther: null,
  title: null,
  name: null,
  maintainer: null,
  maintainerEmail: null,
  tagString: null,
  notes: null,
  objective: null,
  updateFrequencyUnit: null,
  updateFrequencyInterval: null,
  deliveryFrequency: null,
  geoCoverage: null,
  dataSource: null,
  dataFormat: null,
  dataFormatOther: null,
  dataCategory: null,
  containsPersonalData: null,
  personalDataTypes: null,
  dataSubjectCategories: null,
  personalDataProcessingPeriod: null,
  personalDataProcessingPeriodYear: null,
  personalDataProcessingPeriodMonth: null,
  dataClassification: null,
  licenseId: null,
  allowOriginalRawDataRetention: null,
  allowOriginalRawDataSharing: null,
  allowTransformedRawDataSharing: null,
  allowTransformedRawDataGdxSharing: null,
  allowAggregatedDataSharing: null,
  authorizePersonalDataAnonymization: null,
  transformedRawDataRecipients: null,
  transformedRawDataGdxRecipients: null,
  aggregatedDataRecipients: null,
};

/** ฟิลด์ที่ดีไซน์ไม่มีคอลัมน์ให้ — เก็บรวมใน additional_metadata_json */
export const EXTRA_METADATA_KEYS = [
  "transformedRawDataRecipients",
  "transformedRawDataGdxRecipients",
  "aggregatedDataRecipients",
] as const;

// ------------------------------------------------------------------ ชีท conditions

/** สิ่งที่หน้าจอต้องรู้เกี่ยวกับช่องหนึ่งช่อง หลังคำนวณเงื่อนไขแล้ว */
export interface FieldRule<T> {
  /** false = ไม่ต้องถาม และค่าที่เคยกรอกไว้จะถูกล้าง */
  visible: boolean;
  /**
   * ค่าที่ระบบบังคับ ผู้ใช้เปลี่ยนไม่ได้ — null คือผู้ใช้เลือกเอง
   * ชีท conditions หมายเหตุไว้ว่า "default จะเป็นอะไร ก็ต้องแสดงหน้าจอให้ user เห็น"
   * ค่าที่ถูกบังคับจึงยังต้องแสดง ไม่ใช่ซ่อน
   */
  forced: T | null;
}

export interface ChoiceRule extends FieldRule<string> {
  /** ตัวเลือกที่เหลือหลังกรองด้วยเงื่อนไข — ว่างแปลว่ายังตอบข้อก่อนหน้าไม่ครบ */
  options: string[];
}

export interface MetadataRules {
  containsPersonalData: FieldRule<boolean>;
  /** 13.2.1–13.2.3 ถามต่อเมื่อเป็นข้อมูลส่วนบุคคล */
  personalDataDetail: FieldRule<never>;
  personalDataPeriodAmount: FieldRule<never>;
  dataClassification: ChoiceRule;
  licenseId: ChoiceRule;
  allowOriginalRawDataRetention: FieldRule<boolean>;
  allowOriginalRawDataSharing: FieldRule<boolean>;
  allowTransformedRawDataSharing: FieldRule<boolean>;
  allowTransformedRawDataGdxSharing: FieldRule<boolean>;
  allowAggregatedDataSharing: FieldRule<boolean>;
  authorizePersonalDataAnonymization: FieldRule<boolean>;
  transformedRawDataRecipients: FieldRule<never>;
  transformedRawDataGdxRecipients: FieldRule<never>;
  aggregatedDataRecipients: FieldRule<never>;
  dataTopicOther: FieldRule<never>;
  dataFormatOther: FieldRule<never>;
  updateFrequencyInterval: FieldRule<never>;
}

const free = <T>(visible = true): FieldRule<T> => ({ visible, forced: null });

/**
 * ค่าที่กฎในชีทอ่านเพื่อคำนวณ — ทุกช่องเป็น optional เพราะเรียกได้ทั้งจากแถวที่กรอกครบแล้ว
 * และจากฟอร์มที่ผู้ใช้เพิ่งเปิดขึ้นมา
 */
export type MetadataRuleInput = Partial<
  Pick<
    MetadataValues,
    | "dataCategory"
    | "containsPersonalData"
    | "dataClassification"
    | "dataTopic"
    | "dataFormat"
    | "updateFrequencyUnit"
    | "personalDataProcessingPeriod"
    | "allowOriginalRawDataRetention"
    | "allowTransformedRawDataSharing"
    | "allowTransformedRawDataGdxSharing"
    | "allowAggregatedDataSharing"
  >
>;

/**
 * ชีท `conditions` ทั้งตาราง เขียนเป็นฟังก์ชันเดียว
 *
 * อ่านจากซ้ายไปขวาแบบเดียวกับชีท: 13.1 หมวดหมู่ → 13.2 ข้อมูลส่วนบุคคล → 13.3 ระดับชั้น
 * → 14 สัญญาอนุญาต → 15–17 สิทธิการเก็บและส่งต่อ → 18 การมอบหมายให้แปลงข้อมูล
 *
 * ที่ชีทเขียนว่า "default" หมายถึงบังคับ ไม่ใช่ค่าตั้งต้นที่เปลี่ยนได้ (ตามที่การ์ดระบุไว้)
 */
export function metadataRules(v: MetadataRuleInput): MetadataRules {
  const category = v.dataCategory;

  // 13.2 — หมวด ก. ข้อมูลสาธารณะ บังคับว่าไม่มีข้อมูลส่วนบุคคล
  const personalForced = category === "a" ? false : null;
  const personal = personalForced ?? v.containsPersonalData ?? null;

  // 13.3 — ตัวเลือกระดับชั้นข้อมูลขึ้นกับหมวดหมู่ และแคบลงอีกเมื่อเป็นข้อมูลส่วนบุคคล
  let classificationOptions: string[] = [];
  if (category === "a") classificationOptions = ["01"];
  else if (category === "b") {
    classificationOptions = personal ? ["02", "03", "04", "05"] : ["01", "02", "03", "04", "05"];
  } else if (category === "c" || category === "d") classificationOptions = ["03", "04", "05"];

  const classificationForced =
    classificationOptions.length === 1 ? (classificationOptions[0] ?? null) : null;
  const classification =
    classificationForced ??
    (v.dataClassification && classificationOptions.includes(v.dataClassification)
      ? v.dataClassification
      : null);

  // 14 — สัญญาอนุญาตขึ้นกับระดับชั้นข้อมูล
  let licenseOptions: string[] = [];
  if (classification === "01") licenseOptions = ["G0"];
  else if (classification === "02") licenseOptions = ["G0", "G2"];
  else if (classification) licenseOptions = ["G5"];

  // 15–17 — ชุดข้อมูลที่เปิดเผยได้ทั้งฉบับ ให้สิทธิ์ทุกข้อโดยอัตโนมัติ
  const fullyOpen = category === "a" || classification === "01";
  // ระดับชั้น "เผยแพร่ภายในองค์กร" ที่ไม่มีข้อมูลส่วนบุคคล — ข้อมูลแปลงสภาพและข้อมูลรวมส่งต่อได้เสมอ
  const internalNoPersonal = classification === "02" && personal === false;
  const derivedForced = fullyOpen || internalNoPersonal ? true : null;

  // 15.2 ถามได้ก็ต่อเมื่อยอมให้เก็บข้อมูลดิบต้นฉบับไว้ก่อน — ไม่เก็บก็ส่งต่อไม่ได้
  const originalSharingForced = fullyOpen
    ? true
    : v.allowOriginalRawDataRetention === false
      ? false
      : null;

  const recipients = (allowed: boolean | null | undefined): FieldRule<never> => ({
    visible: personal === true && allowed === true,
    forced: null,
  });

  return {
    containsPersonalData: { visible: true, forced: personalForced },
    personalDataDetail: free(personal === true),
    personalDataPeriodAmount: free(
      personal === true && v.personalDataProcessingPeriod === PERSONAL_DATA_PERIOD_FIXED,
    ),
    dataClassification: {
      visible: true,
      forced: classificationForced,
      options: classificationOptions,
    },
    licenseId: {
      visible: true,
      forced: licenseOptions.length === 1 ? (licenseOptions[0] ?? null) : null,
      options: licenseOptions,
    },
    allowOriginalRawDataRetention: { visible: true, forced: fullyOpen ? true : null },
    allowOriginalRawDataSharing: { visible: true, forced: originalSharingForced },
    allowTransformedRawDataSharing: { visible: true, forced: derivedForced },
    allowTransformedRawDataGdxSharing: { visible: true, forced: derivedForced },
    allowAggregatedDataSharing: { visible: true, forced: derivedForced },
    // 18 ถามเฉพาะชุดข้อมูลที่มีข้อมูลส่วนบุคคล
    authorizePersonalDataAnonymization: { visible: personal === true, forced: null },
    transformedRawDataRecipients: recipients(
      derivedForced ?? v.allowTransformedRawDataSharing,
    ),
    transformedRawDataGdxRecipients: recipients(
      derivedForced ?? v.allowTransformedRawDataGdxSharing,
    ),
    aggregatedDataRecipients: recipients(derivedForced ?? v.allowAggregatedDataSharing),
    dataTopicOther: free(v.dataTopic === DATA_TOPIC_OTHER_CODE),
    dataFormatOther: free(v.dataFormat === DATA_FORMAT_OTHER_CODE),
    updateFrequencyInterval: free(
      Boolean(v.updateFrequencyUnit) &&
        !FREQUENCY_UNITS_WITHOUT_INTERVAL.includes(v.updateFrequencyUnit!),
    ),
  };
}

/**
 * บังคับค่าตามชีท conditions แล้วล้างช่องที่ไม่ต้องถาม
 *
 * เรียกทุกครั้งก่อนเขียนฐานข้อมูล ไม่ใช่แค่ตอนวาดหน้าจอ — client ส่งอะไรมาก็ได้
 * ถ้าเชื่อหน้าเว็บอย่างเดียว จะได้แถวที่ขัดกันเอง (เช่น หมวดสาธารณะแต่ไม่ให้ส่งต่อข้อมูลรวม)
 */
export function normaliseMetadata(input: MetadataValues): MetadataValues {
  const v = { ...input };

  // ทำสองรอบ: รอบแรกตัดสิน 13.2/13.3 ซึ่งเป็นตัวตั้งของ 14 และ 15–17
  const first = metadataRules(v);
  if (first.containsPersonalData.forced !== null) {
    v.containsPersonalData = first.containsPersonalData.forced;
  }
  if (first.dataClassification.forced !== null) {
    v.dataClassification = first.dataClassification.forced;
  } else if (
    v.dataClassification !== null &&
    !first.dataClassification.options.includes(v.dataClassification)
  ) {
    // เปลี่ยนหมวดหมู่แล้วระดับชั้นเดิมใช้ไม่ได้อีก — ล้างทิ้ง ไม่ใช่เก็บค่าที่ผิดกติกาไว้
    v.dataClassification = null;
  }

  const rules = metadataRules(v);
  if (rules.licenseId.forced !== null) v.licenseId = rules.licenseId.forced;
  else if (v.licenseId !== null && !rules.licenseId.options.includes(v.licenseId)) {
    v.licenseId = null;
  }

  const allowKeys = [
    "allowOriginalRawDataRetention",
    "allowOriginalRawDataSharing",
    "allowTransformedRawDataSharing",
    "allowTransformedRawDataGdxSharing",
    "allowAggregatedDataSharing",
  ] as const;
  for (const key of allowKeys) {
    if (rules[key].forced !== null) v[key] = rules[key].forced;
  }

  if (!rules.personalDataDetail.visible) {
    v.personalDataTypes = null;
    v.dataSubjectCategories = null;
    v.personalDataProcessingPeriod = null;
  }
  if (!rules.personalDataPeriodAmount.visible) {
    v.personalDataProcessingPeriodYear = null;
    v.personalDataProcessingPeriodMonth = null;
  }
  if (!rules.authorizePersonalDataAnonymization.visible) {
    v.authorizePersonalDataAnonymization = null;
  }
  if (!rules.dataTopicOther.visible) v.dataTopicOther = null;
  if (!rules.dataFormatOther.visible) v.dataFormatOther = null;
  if (!rules.updateFrequencyInterval.visible) v.updateFrequencyInterval = null;
  if (!rules.transformedRawDataRecipients.visible) v.transformedRawDataRecipients = null;
  if (!rules.transformedRawDataGdxRecipients.visible) v.transformedRawDataGdxRecipients = null;
  if (!rules.aggregatedDataRecipients.visible) v.aggregatedDataRecipients = null;

  return v;
}

// ------------------------------------------------------------------ zod

/** null = ผู้ใช้ล้างค่าทิ้ง, undefined = ไม่ได้แตะช่องนี้ */
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();
/**
 * ค่าที่ผู้ใช้เลือกจากหน้าเว็บมาถูกเสมอ ข้อความนี้จึงไว้รับ client อื่นที่ส่งรหัสนอกรายการ —
 * ยังต้องเป็นภาษาไทย เพราะข้อความ validation ทุกอันถูกผูกกับช่องแล้วแสดงบนฟอร์ม
 */
const optionalCode = (values: [string, ...string[]]) =>
  z
    .enum(values, { error: "ค่าที่ส่งมาไม่อยู่ในรายการรหัสที่ระบบรองรับ" })
    .nullable()
    .optional();
const optionalFlag = z.boolean().nullable().optional();
const optionalCount = (max?: number, maxMessage?: string) => {
  const base = z.number().int("ต้องเป็นจำนวนเต็ม").min(0, "ต้องไม่ติดลบ");
  return (max === undefined ? base : base.max(max, maxMessage ?? `ต้องไม่เกิน ${max}`))
    .nullable()
    .optional();
};

/** ตอนบันทึกร่างยอมให้ว่างได้ทุกช่อง — ความครบถ้วนบังคับตอนสร้าง PDF และตอนนำส่ง */
export const datasetDraftSchema = z.object({
  dataType: optionalCode(DATA_TYPES),
  dataTopic: optionalCode(DATA_TOPICS),
  dataTopicOther: optionalText(150),
  title: optionalText(150),
  name: optionalText(150),
  maintainer: optionalText(150),
  maintainerEmail: optionalText(50),
  tagString: optionalText(200),
  notes: optionalText(1000),
  objective: optionalText(1000),
  updateFrequencyUnit: optionalCode(UPDATE_FREQUENCY_UNITS),
  updateFrequencyInterval: optionalCount(),
  deliveryFrequency: optionalCode(DELIVERY_FREQUENCIES),
  geoCoverage: optionalCode(GEO_COVERAGES),
  dataSource: optionalText(200),
  dataFormat: optionalCode(DATA_FORMATS),
  dataFormatOther: optionalText(150),
  dataCategory: optionalCode(DATA_CATEGORIES),
  containsPersonalData: optionalFlag,
  personalDataTypes: optionalText(1000),
  dataSubjectCategories: optionalText(1000),
  personalDataProcessingPeriod: optionalCode(PERSONAL_DATA_PERIODS),
  personalDataProcessingPeriodYear: optionalCount(),
  personalDataProcessingPeriodMonth: optionalCount(11, "จำนวนเดือนต้องอยู่ระหว่าง 0–11 ถ้ามากกว่านั้นให้กรอกเป็นจำนวนปี"),
  dataClassification: optionalCode(DATA_CLASSIFICATIONS),
  licenseId: optionalCode(LICENSES),
  allowOriginalRawDataRetention: optionalFlag,
  allowOriginalRawDataSharing: optionalFlag,
  allowTransformedRawDataSharing: optionalFlag,
  allowTransformedRawDataGdxSharing: optionalFlag,
  allowAggregatedDataSharing: optionalFlag,
  authorizePersonalDataAnonymization: optionalFlag,
  transformedRawDataRecipients: optionalText(500),
  transformedRawDataGdxRecipients: optionalText(500),
  aggregatedDataRecipients: optionalText(500),

  legalAccepted: z.boolean().optional(),
});

export type DatasetDraftInput = z.infer<typeof datasetDraftSchema>;

/**
 * รวมค่าที่ผู้ใช้ส่งมาเข้ากับค่าที่บันทึกไว้เดิม แล้วบังคับกฎของชีท conditions
 * `undefined` แปลว่าไม่ได้แตะช่องนั้น ต่างจาก `null` ที่แปลว่าล้างค่าทิ้ง
 */
export function mergeMetadata(current: MetadataValues, input: DatasetDraftInput): MetadataValues {
  const next = { ...current };
  for (const key of Object.keys(EMPTY_METADATA) as Array<keyof MetadataValues>) {
    const value = input[key as keyof DatasetDraftInput];
    if (value !== undefined) (next as Record<string, unknown>)[key] = value;
  }
  return normaliseMetadata(next);
}

/** แยกค่าที่กรอกออกเป็นคอลัมน์จริงกับ additional_metadata_json */
export function toMetadataColumns(values: MetadataValues, previousExtra?: unknown) {
  const columns = { ...values } as Partial<MetadataValues>;
  const extra: Record<string, unknown> = {
    ...(typeof previousExtra === "object" && previousExtra !== null ? previousExtra : {}),
  };
  for (const key of EXTRA_METADATA_KEYS) {
    extra[key] = values[key];
    delete columns[key];
  }
  return { columns: columns as Omit<MetadataValues, (typeof EXTRA_METADATA_KEYS)[number]>, extra };
}

/** แถวจากฐานข้อมูล (คอลัมน์ + JSON) กลับเป็นรูปที่ API และ zod ชุดนำส่งใช้ */
export function fromMetadataRow(
  row: (Partial<MetadataValues> & { additionalMetadataJson?: unknown }) | null,
): MetadataValues {
  if (!row) return { ...EMPTY_METADATA };
  const extra = (
    typeof row.additionalMetadataJson === "object" && row.additionalMetadataJson !== null
      ? row.additionalMetadataJson
      : {}
  ) as Record<string, unknown>;

  const values = { ...EMPTY_METADATA };
  for (const key of Object.keys(EMPTY_METADATA) as Array<keyof MetadataValues>) {
    const stored = EXTRA_METADATA_KEYS.includes(key as (typeof EXTRA_METADATA_KEYS)[number])
      ? extra[key]
      : row[key];
    if (stored !== undefined) (values as Record<string, unknown>)[key] = stored ?? null;
  }
  return values;
}

/**
 * ช่องที่ยังว่างในฐานข้อมูลมาเป็น null ไม่ใช่ undefined — ถ้าไม่ระบุ `error` ไว้
 * zod จะตอบข้อความ invalid_type เป็นภาษาอังกฤษ ซึ่งผู้ใช้อ่านไม่รู้เรื่อง
 */
const required = (message: string) => z.string({ error: message }).trim().min(1, message);
const requiredCode = (values: [string, ...string[]], message: string) =>
  z.enum(values, { error: message });
const requiredFlag = (message: string) => z.boolean({ error: message });

const requiredEmail = (message: string) =>
  required(message)
    .max(50, "อีเมลต้องยาวไม่เกิน 50 ตัวอักษร")
    .email("รูปแบบอีเมลไม่ถูกต้อง")
    .transform((v) => v.toLowerCase());

/**
 * ตรวจความครบถ้วนก่อนสร้าง PDF และก่อนนำส่ง — parse ผลของ fromMetadataRow()
 * ช่องที่ชีทมาร์ก Required บังคับที่นี่ ส่วนช่องที่ Required แบบมีเงื่อนไขอยู่ใน superRefine
 */
export const datasetSubmitSchema = z
  .object({
    dataType: requiredCode(DATA_TYPES, "กรุณาเลือกประเภทข้อมูล"),
    dataTopic: requiredCode(DATA_TOPICS, "กรุณาเลือกประเด็นของข้อมูล"),
    dataTopicOther: optionalText(150),
    title: required("กรุณากรอกชื่อชุดข้อมูลภาษาไทย").max(150, "ชื่อชุดข้อมูลต้องยาวไม่เกิน 150 ตัวอักษร"),
    name: required("กรุณากรอกชื่อชุดข้อมูลภาษาอังกฤษ").max(150, "ชื่อชุดข้อมูลต้องยาวไม่เกิน 150 ตัวอักษร"),
    maintainer: required("กรุณากรอกชื่อผู้ติดต่อ (กอง สำนัก หรือฝ่ายที่รับผิดชอบข้อมูล)"),
    maintainerEmail: requiredEmail("กรุณากรอกอีเมลผู้ติดต่อ"),
    tagString: required("กรุณาระบุคำสำคัญอย่างน้อย 1 คำ").max(200, "คำสำคัญรวมกันต้องยาวไม่เกิน 200 ตัวอักษร"),
    notes: required("กรุณากรอกรายละเอียดของชุดข้อมูล")
      .min(30, "รายละเอียดต้องมีอย่างน้อย 30 ตัวอักษร")
      .max(1000, "รายละเอียดต้องยาวไม่เกิน 1,000 ตัวอักษร"),
    objective: required("กรุณากรอกวัตถุประสงค์ของการจัดทำชุดข้อมูล")
      .min(30, "วัตถุประสงค์ต้องมีอย่างน้อย 30 ตัวอักษร")
      .max(1000, "วัตถุประสงค์ต้องยาวไม่เกิน 1,000 ตัวอักษร"),
    updateFrequencyUnit: requiredCode(
      UPDATE_FREQUENCY_UNITS,
      "กรุณาเลือกหน่วยความถี่ของการปรับปรุงข้อมูลต้นทาง",
    ),
    updateFrequencyInterval: optionalCount(),
    deliveryFrequency: requiredCode(
      DELIVERY_FREQUENCIES,
      "กรุณาเลือกความถี่ของการนำส่งข้อมูลเข้าสู่ระบบกลาง",
    ),
    geoCoverage: requiredCode(GEO_COVERAGES, "กรุณาเลือกความละเอียดเชิงภูมิศาสตร์"),
    dataSource: required("กรุณาระบุแหล่งที่มาของข้อมูล").max(200, "แหล่งที่มาต้องยาวไม่เกิน 200 ตัวอักษร"),
    dataFormat: requiredCode(DATA_FORMATS, "กรุณาเลือกรูปแบบการนำส่งข้อมูล"),
    dataFormatOther: optionalText(150),
    dataCategory: requiredCode(DATA_CATEGORIES, "กรุณาเลือกหมวดหมู่ข้อมูลตามธรรมาภิบาลภาครัฐ"),
    containsPersonalData: requiredFlag("กรุณาระบุว่าชุดข้อมูลนี้มีข้อมูลส่วนบุคคลหรือไม่"),
    personalDataTypes: optionalText(1000),
    dataSubjectCategories: optionalText(1000),
    personalDataProcessingPeriod: optionalCode(PERSONAL_DATA_PERIODS),
    personalDataProcessingPeriodYear: optionalCount(),
    personalDataProcessingPeriodMonth: optionalCount(11, "จำนวนเดือนต้องอยู่ระหว่าง 0–11 ถ้ามากกว่านั้นให้กรอกเป็นจำนวนปี"),
    dataClassification: requiredCode(DATA_CLASSIFICATIONS, "กรุณาเลือกระดับชั้นข้อมูล"),
    licenseId: requiredCode(LICENSES, "กรุณาเลือกสัญญาอนุญาตให้ใช้ข้อมูล"),
    allowOriginalRawDataRetention: requiredFlag(
      "กรุณาระบุว่าอนุญาตให้สำนักงานจัดเก็บข้อมูลดิบต้นฉบับหรือไม่",
    ),
    allowOriginalRawDataSharing: requiredFlag(
      "กรุณาระบุว่าอนุญาตให้ส่งต่อข้อมูลดิบต้นฉบับให้หน่วยงานของรัฐอื่นหรือไม่",
    ),
    allowTransformedRawDataSharing: requiredFlag(
      "กรุณาระบุว่าอนุญาตให้ส่งต่อข้อมูลดิบแปลงสภาพไปยังระบบเชื่อมโยงข้อมูลอื่นหรือไม่",
    ),
    allowTransformedRawDataGdxSharing: requiredFlag(
      "กรุณาระบุว่าอนุญาตให้ส่งต่อข้อมูลดิบแปลงสภาพไปยัง GDX หรือไม่",
    ),
    allowAggregatedDataSharing: requiredFlag("กรุณาระบุว่าอนุญาตให้ส่งต่อข้อมูลรวมหรือไม่"),
    authorizePersonalDataAnonymization: optionalFlag,
    transformedRawDataRecipients: optionalText(500),
    transformedRawDataGdxRecipients: optionalText(500),
    aggregatedDataRecipients: optionalText(500),
  })
  .superRefine((value, ctx) => {
    const rules = metadataRules(value);
    const missing = (path: keyof MetadataValues, message: string) =>
      ctx.addIssue({ code: "custom", path: [path], message });

    if (rules.dataTopicOther.visible && !value.dataTopicOther) {
      missing("dataTopicOther", "เลือกประเด็นเป็น “อื่น ๆ” แล้วต้องระบุประเด็นด้วย");
    }
    if (rules.dataFormatOther.visible && !value.dataFormatOther) {
      missing("dataFormatOther", "เลือกนำส่งผ่านระบบเชื่อมโยงข้อมูลอื่น แล้วต้องระบุชื่อระบบด้วย");
    }
    if (rules.updateFrequencyInterval.visible && !value.updateFrequencyInterval) {
      missing(
        "updateFrequencyInterval",
        `กรุณากรอกค่าความถี่ เช่น ปรับปรุงทุก 2 ${UPDATE_FREQUENCY_UNIT_LABELS[value.updateFrequencyUnit]} ให้กรอก 2`,
      );
    }
    if (rules.personalDataDetail.visible) {
      if (!value.personalDataTypes) {
        missing("personalDataTypes", "กรุณาระบุประเภทของข้อมูลส่วนบุคคลที่อยู่ในชุดข้อมูล");
      }
      if (!value.dataSubjectCategories) {
        missing("dataSubjectCategories", "กรุณาระบุกลุ่มหรือประเภทของเจ้าของข้อมูลส่วนบุคคล");
      }
      if (!value.personalDataProcessingPeriod) {
        missing("personalDataProcessingPeriod", "กรุณาเลือกระยะเวลาประมวลผลข้อมูลส่วนบุคคล");
      }
      if (value.authorizePersonalDataAnonymization === null ||
        value.authorizePersonalDataAnonymization === undefined) {
        missing(
          "authorizePersonalDataAnonymization",
          "กรุณาระบุว่ามอบหมายให้สำนักงานแปลงข้อมูลส่วนบุคคลให้ไม่สามารถระบุตัวตนได้หรือไม่",
        );
      }
    }
    if (rules.personalDataPeriodAmount.visible) {
      const years = value.personalDataProcessingPeriodYear ?? 0;
      const months = value.personalDataProcessingPeriodMonth ?? 0;
      if (years === 0 && months === 0) {
        missing(
          "personalDataProcessingPeriodYear",
          "กรุณาระบุระยะเวลาประมวลผลอย่างน้อย 1 เดือน โดยกรอกจำนวนปีหรือจำนวนเดือน",
        );
      }
    }
    const recipientChecks: Array<[keyof MetadataRules & keyof MetadataValues, string]> = [
      ["transformedRawDataRecipients", "กรุณาระบุหน่วยงานที่อนุญาตให้ส่งต่อข้อมูลดิบแปลงสภาพ"],
      ["transformedRawDataGdxRecipients", "กรุณาระบุหน่วยงานที่อนุญาตให้รับข้อมูลผ่าน GDX"],
      ["aggregatedDataRecipients", "กรุณาระบุหน่วยงานที่อนุญาตให้ส่งต่อข้อมูลรวม"],
    ];
    for (const [key, message] of recipientChecks) {
      if (rules[key].visible && !value[key]) missing(key, message);
    }
  });

/** คำสำคัญเก็บเป็นสตริงเดียวคั่นด้วย "," ตามชีท — หน้าจอกับ PDF แสดงเป็นรายการ */
export const splitTags = (value: string | null | undefined): string[] =>
  (value ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

/** 9.1 + 9.2 อ่านคู่กันเสมอ — "ทุก 2 ปี" ไม่ใช่ "ปี" กับ "2" คนละบรรทัด */
export function formatUpdateFrequency(
  unit: string | null | undefined,
  interval: number | null | undefined,
): string {
  if (!unit) return "";
  const label = UPDATE_FREQUENCY_UNIT_LABELS[unit] ?? unit;
  if (FREQUENCY_UNITS_WITHOUT_INTERVAL.includes(unit) || !interval) return label;
  return `ทุก ${interval.toLocaleString("th-TH")} ${label}`;
}
