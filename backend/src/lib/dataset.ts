/**
 * ป้ายภาษาไทยและกฎการตรวจสอบของคำขอลงทะเบียนชุดข้อมูล
 *
 * **เปลี่ยนจาก enum เป็นรหัสข้อความตามดีไซน์** sheet `dataset_registration_metadata`
 * เก็บ dataset_category_code / update_frequency / geographic_scope / delivery_method /
 * data_format / access_level เป็น VARCHAR ไม่ใช่ enum และหลายช่องยังมาร์ก TO REVIEW ไว้
 * ค่าที่รับได้จึงบังคับที่ชั้น zod แทนที่จะบังคับด้วย PostgreSQL enum
 *
 * **12 ฟิลด์ที่ดีไซน์ตัดออก** (keywords, datasetType, estimatedRecords, licenseType,
 * legalBasis, personalDataMeasure, usageRestriction, deliveryEndpoint,
 * technicalContactName/Email, deliveryNote, deliveryFrequency) ทั้งหมดมาจาก
 * docs/01-user-journey.md §4.3 ที่มาร์ก [สมมติฐาน] ไว้ตั้งแต่ต้น
 * → ยึด Excel เก็บลง additional_metadata_json (คอลัมน์ "Optional non-core metadata")
 *   ดู toMetadataColumns() ท้ายไฟล์
 */
import { z } from "zod";

import { isValidThaiPhone } from "./validation.js";

// ------------------------------------------------------------------ ป้ายภาษาไทย

export const DATASET_TYPE_LABELS: Record<string, string> = {
  RECORD: "ข้อมูลระเบียน",
  STATISTIC: "ข้อมูลสถิติ",
  GEOGRAPHIC: "ข้อมูลภูมิสารสนเทศ",
  MULTIMEDIA: "ข้อมูลมัลติมีเดีย",
  OTHER: "อื่น ๆ",
};

export const DATASET_CATEGORY_LABELS: Record<string, string> = {
  ECONOMY_FINANCE: "เศรษฐกิจ การเงินและการคลัง",
  AGRICULTURE: "เกษตรกรรม",
  HEALTH: "สาธารณสุข",
  EDUCATION: "การศึกษา",
  TRANSPORT: "คมนาคมและขนส่ง",
  ENERGY: "พลังงาน",
  ENVIRONMENT: "ทรัพยากรธรรมชาติและสิ่งแวดล้อม",
  SOCIETY: "สังคมและสวัสดิการ",
  PUBLIC_SAFETY: "ความมั่นคงและความปลอดภัย",
  SCIENCE_TECH: "วิทยาศาสตร์ เทคโนโลยีและดิจิทัล",
  TOURISM_SPORT: "การท่องเที่ยวและกีฬา",
  GOVERNMENT: "การบริหารราชการ",
};

export const FREQUENCY_LABELS: Record<string, string> = {
  REAL_TIME: "ทันที (real-time)",
  DAILY: "รายวัน",
  WEEKLY: "รายสัปดาห์",
  MONTHLY: "รายเดือน",
  QUARTERLY: "รายไตรมาส",
  BIANNUAL: "ราย 6 เดือน",
  YEARLY: "รายปี",
  AS_NEEDED: "ตามความจำเป็น",
};

export const GEO_COVERAGE_LABELS: Record<string, string> = {
  NATIONAL: "ทั้งประเทศ",
  REGIONAL: "รายภาค",
  PROVINCIAL: "รายจังหวัด",
  DISTRICT: "รายอำเภอ/เขต",
  OTHER: "อื่น ๆ",
};

export const DELIVERY_METHOD_LABELS: Record<string, string> = {
  API: "API",
  SFTP: "SFTP",
  DATABASE: "เชื่อมต่อฐานข้อมูลโดยตรง",
  FILE_UPLOAD: "อัปโหลดไฟล์เข้าระบบ",
  OTHER: "อื่น ๆ",
};

export const DATA_FORMAT_LABELS: Record<string, string> = {
  CSV: "CSV",
  JSON: "JSON",
  XLSX: "Excel (XLSX)",
  XML: "XML",
  PARQUET: "Parquet",
  SHAPEFILE: "Shapefile",
  OTHER: "อื่น ๆ",
};

/** sheet เรียกคอลัมน์นี้ว่า access_level — "Access or disclosure classification" */
export const CLASSIFICATION_LABELS: Record<string, string> = {
  PUBLIC: "สาธารณะ",
  INTERNAL: "ใช้ภายในหน่วยงาน",
  CONFIDENTIAL: "ลับ",
  SECRET: "ลับมาก",
};

export const LICENSE_LABELS: Record<string, string> = {
  OPEN_GOVERNMENT: "Open Government License",
  CC_BY: "CC-BY",
  CC_BY_SA: "CC-BY-SA",
  CC_BY_NC: "CC-BY-NC",
  INTERNAL_ONLY: "ใช้ภายในเท่านั้น",
  OTHER: "อื่น ๆ",
};

const codes = (labels: Record<string, string>) => Object.keys(labels) as [string, ...string[]];

const DATASET_TYPES = codes(DATASET_TYPE_LABELS);
const CATEGORIES = codes(DATASET_CATEGORY_LABELS);
const FREQUENCIES = codes(FREQUENCY_LABELS);
const GEO_SCOPES = codes(GEO_COVERAGE_LABELS);
const DELIVERY_METHODS = codes(DELIVERY_METHOD_LABELS);
const DATA_FORMATS = codes(DATA_FORMAT_LABELS);
const ACCESS_LEVELS = codes(CLASSIFICATION_LABELS);
const LICENSES = codes(LICENSE_LABELS);

/** ปลายทางบังคับกรอกเฉพาะวิธีนำส่งที่ต้องเชื่อมต่อทางเทคนิค */
export const ENDPOINT_REQUIRED = ["API", "SFTP", "DATABASE"];

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

// ------------------------------------------------------------------ zod

/** null = ผู้ใช้ล้างค่าทิ้ง, undefined = ไม่ได้แตะช่องนี้ */
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();
const optionalCode = (values: [string, ...string[]]) => z.enum(values).nullable().optional();
/** ค่าที่มาจากฐานข้อมูลเป็น null ได้ ต่างจากค่าที่ผู้ใช้ส่งเข้ามาซึ่งเป็น undefined */
const nullableDate = z.date().nullable().optional();

/** วันที่จากฟอร์มมาเป็น "YYYY-MM-DD" — ว่างแปลว่าลบค่าเดิมทิ้ง */
const dateInput = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "รูปแบบวันที่ต้องเป็น ปี-เดือน-วัน")
  .transform((v) => new Date(`${v}T00:00:00.000Z`))
  .nullable()
  .optional();

/** ตอนบันทึกร่างยอมให้ว่างได้ทุกช่อง — แบบเดียวกับ Journey B */
export const datasetDraftSchema = z.object({
  nameTh: optionalText(500),
  nameEn: optionalText(500),
  description: optionalText(4000),
  descriptionEn: optionalText(4000),
  objective: optionalText(4000),
  category: optionalCode(CATEGORIES),
  dataOwnerDepartment: optionalText(255),
  updateFrequency: optionalCode(FREQUENCIES),
  geoCoverage: optionalCode(GEO_SCOPES),
  dataStartDate: dateInput,
  dataEndDate: dateInput,
  stewardName: optionalText(255),
  stewardEmail: optionalText(255),
  stewardPhone: optionalText(32),

  deliveryMethod: optionalCode(DELIVERY_METHODS),
  dataFormat: optionalCode(DATA_FORMATS),

  hasPersonalData: z.boolean().nullable().optional(),
  hasSensitiveData: z.boolean().nullable().optional(),
  dataClassification: optionalCode(ACCESS_LEVELS),

  // ── ต่อไปนี้ลง additional_metadata_json ทั้งหมด (ดีไซน์ไม่มีคอลัมน์ให้) ──
  datasetType: optionalCode(DATASET_TYPES),
  keywords: z.array(z.string().trim().min(1).max(60)).max(10).optional(),
  estimatedRecords: z.number().int().min(0).nullable().optional(),
  deliveryFrequency: optionalCode(FREQUENCIES),
  deliveryEndpoint: optionalText(500),
  technicalContactName: optionalText(255),
  technicalContactEmail: optionalText(255),
  deliveryNote: optionalText(2000),
  personalDataMeasure: optionalText(2000),
  legalBasis: optionalText(2000),
  licenseType: optionalCode(LICENSES),
  usageRestriction: optionalText(2000),

  legalAccepted: z.boolean().optional(),
});

export type DatasetDraftInput = z.infer<typeof datasetDraftSchema>;

/** ฟิลด์ที่ไม่มีคอลัมน์ของตัวเองในดีไซน์ — เก็บรวมใน additional_metadata_json */
export const EXTRA_METADATA_KEYS = [
  "datasetType",
  "keywords",
  "estimatedRecords",
  "deliveryFrequency",
  "deliveryEndpoint",
  "technicalContactName",
  "technicalContactEmail",
  "deliveryNote",
  "personalDataMeasure",
  "legalBasis",
  "licenseType",
  "usageRestriction",
] as const;

/**
 * แยกค่าที่ผู้ใช้กรอกออกเป็น "คอลัมน์จริง" กับ "additional_metadata_json"
 * ตามที่ sheet `dataset_registration_metadata` กำหนดคอลัมน์ไว้
 */
export function toMetadataColumns(input: DatasetDraftInput, previousExtra?: unknown) {
  const extra: Record<string, unknown> = {
    ...(typeof previousExtra === "object" && previousExtra !== null ? previousExtra : {}),
  };
  for (const key of EXTRA_METADATA_KEYS) {
    if (input[key] !== undefined) extra[key] = input[key];
  }

  return {
    columns: {
      titleTh: input.nameTh,
      titleEn: input.nameEn,
      descriptionTh: input.description,
      descriptionEn: input.descriptionEn,
      objective: input.objective,
      datasetCategoryCode: input.category,
      dataOwnerDepartment: input.dataOwnerDepartment,
      contactName: input.stewardName,
      contactEmail: input.stewardEmail,
      contactPhone: input.stewardPhone,
      updateFrequency: input.updateFrequency,
      coverageStartDate: input.dataStartDate,
      coverageEndDate: input.dataEndDate,
      geographicScope: input.geoCoverage,
      containsPersonalData: input.hasPersonalData,
      containsSensitiveData: input.hasSensitiveData,
      accessLevel: input.dataClassification,
      deliveryMethod: input.deliveryMethod,
      dataFormat: input.dataFormat,
    },
    extra,
  };
}

/** แปลงแถว metadata กลับเป็นรูปที่ frontend และ zod ชุด submit ใช้ */
export function fromMetadataRow(row: {
  titleTh: string | null;
  titleEn: string | null;
  descriptionTh: string | null;
  descriptionEn: string | null;
  objective: string | null;
  datasetCategoryCode: string | null;
  dataOwnerDepartment: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  updateFrequency: string | null;
  coverageStartDate: Date | null;
  coverageEndDate: Date | null;
  geographicScope: string | null;
  containsPersonalData: boolean | null;
  containsSensitiveData: boolean | null;
  accessLevel: string | null;
  deliveryMethod: string | null;
  dataFormat: string | null;
  additionalMetadataJson: unknown;
}) {
  const extra = (
    typeof row.additionalMetadataJson === "object" && row.additionalMetadataJson !== null
      ? row.additionalMetadataJson
      : {}
  ) as Record<string, unknown>;

  return {
    nameTh: row.titleTh,
    nameEn: row.titleEn,
    description: row.descriptionTh,
    descriptionEn: row.descriptionEn,
    objective: row.objective,
    category: row.datasetCategoryCode,
    dataOwnerDepartment: row.dataOwnerDepartment,
    stewardName: row.contactName,
    stewardEmail: row.contactEmail,
    stewardPhone: row.contactPhone,
    updateFrequency: row.updateFrequency,
    dataStartDate: row.coverageStartDate,
    dataEndDate: row.coverageEndDate,
    geoCoverage: row.geographicScope,
    hasPersonalData: row.containsPersonalData,
    hasSensitiveData: row.containsSensitiveData,
    dataClassification: row.accessLevel,
    deliveryMethod: row.deliveryMethod,
    dataFormat: row.dataFormat,

    datasetType: (extra.datasetType as string | null) ?? null,
    keywords: (extra.keywords as string[] | undefined) ?? [],
    estimatedRecords: (extra.estimatedRecords as number | null) ?? null,
    deliveryFrequency: (extra.deliveryFrequency as string | null) ?? null,
    deliveryEndpoint: (extra.deliveryEndpoint as string | null) ?? null,
    technicalContactName: (extra.technicalContactName as string | null) ?? null,
    technicalContactEmail: (extra.technicalContactEmail as string | null) ?? null,
    deliveryNote: (extra.deliveryNote as string | null) ?? null,
    personalDataMeasure: (extra.personalDataMeasure as string | null) ?? null,
    legalBasis: (extra.legalBasis as string | null) ?? null,
    licenseType: (extra.licenseType as string | null) ?? null,
    usageRestriction: (extra.usageRestriction as string | null) ?? null,
  };
}

/**
 * ช่องที่ยังว่างในฐานข้อมูลมาเป็น null ไม่ใช่ undefined — ถ้าไม่ระบุ `error` ไว้
 * zod จะตอบข้อความ invalid_type เป็นภาษาอังกฤษ ซึ่งผู้ใช้อ่านไม่รู้เรื่อง
 */
const required = (message: string) => z.string({ error: message }).trim().min(1, message);

const requiredEmail = (message: string) =>
  required(message)
    .email("รูปแบบอีเมลไม่ถูกต้อง")
    .transform((v) => v.toLowerCase());

const requiredPhone = (message: string) =>
  required(message).refine(
    isValidThaiPhone,
    "เบอร์โทรศัพท์ไม่ถูกต้อง กรุณากรอกเลข 9–10 หลักขึ้นต้นด้วย 0",
  );

const requiredCode = (values: [string, ...string[]], message: string) =>
  z.enum(values, { error: message });

/** ตรวจความครบถ้วนก่อนสร้าง PDF และก่อนนำส่ง — parse ผลของ fromMetadataRow() */
export const datasetSubmitSchema = z
  .object({
    nameTh: required("กรุณากรอกชื่อชุดข้อมูล")
      .min(3, "ชื่อชุดข้อมูลต้องมีอย่างน้อย 3 ตัวอักษร")
      .max(500),
    nameEn: z.string().trim().max(500).nullable().optional(),
    description: required("กรุณากรอกคำอธิบายชุดข้อมูล").min(
      30,
      "คำอธิบายต้องมีอย่างน้อย 30 ตัวอักษร",
    ),
    category: requiredCode(CATEGORIES, "กรุณาเลือกหมวดหมู่"),
    updateFrequency: requiredCode(FREQUENCIES, "กรุณาเลือกความถี่ในการปรับปรุงข้อมูล"),
    geoCoverage: requiredCode(GEO_SCOPES, "กรุณาเลือกขอบเขตเชิงพื้นที่"),
    dataStartDate: nullableDate,
    dataEndDate: nullableDate,
    stewardName: required("กรุณากรอกชื่อผู้ประสานงานชุดข้อมูล"),
    stewardEmail: requiredEmail("กรุณากรอกอีเมลผู้ประสานงานชุดข้อมูล"),
    stewardPhone: requiredPhone("กรุณากรอกเบอร์โทรผู้ประสานงานชุดข้อมูล"),

    deliveryMethod: requiredCode(DELIVERY_METHODS, "กรุณาเลือกวิธีการนำส่งข้อมูล"),
    dataFormat: requiredCode(DATA_FORMATS, "กรุณาเลือกรูปแบบข้อมูล"),

    // sheet มาร์กสามช่องนี้เป็น Required
    hasPersonalData: z.boolean({ error: "กรุณาระบุว่ามีข้อมูลส่วนบุคคลหรือไม่" }),
    hasSensitiveData: z.boolean({ error: "กรุณาระบุว่ามีข้อมูลอ่อนไหวหรือไม่" }),
    dataClassification: requiredCode(ACCESS_LEVELS, "กรุณาเลือกชั้นความลับของข้อมูล"),

    keywords: z.array(z.string().trim().min(1)).min(1, "กรุณาระบุคำสำคัญอย่างน้อย 1 คำ").max(10),
    estimatedRecords: z.number().int().min(0).nullable().optional(),
    deliveryFrequency: requiredCode(FREQUENCIES, "กรุณาเลือกความถี่ในการนำส่ง"),
    deliveryEndpoint: z.string().trim().max(500).nullable().optional(),
    technicalContactName: required("กรุณากรอกชื่อผู้รับผิดชอบทางเทคนิค"),
    technicalContactEmail: requiredEmail("กรุณากรอกอีเมลผู้รับผิดชอบทางเทคนิค"),
    deliveryNote: z.string().trim().max(2000).nullable().optional(),
    personalDataMeasure: z.string().trim().nullable().optional(),
    legalBasis: required("กรุณาระบุฐานอำนาจตามกฎหมาย").min(
      10,
      "กรุณาระบุฐานอำนาจตามกฎหมายอย่างน้อย 10 ตัวอักษร",
    ),
    licenseType: requiredCode(LICENSES, "กรุณาเลือกสัญญาอนุญาตให้ใช้ข้อมูล"),
    usageRestriction: z.string().trim().max(2000).nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.deliveryMethod && ENDPOINT_REQUIRED.includes(value.deliveryMethod) && !value.deliveryEndpoint) {
      ctx.addIssue({
        code: "custom",
        path: ["deliveryEndpoint"],
        message: `วิธีการนำส่งแบบ ${DELIVERY_METHOD_LABELS[value.deliveryMethod]} ต้องระบุปลายทางหรือ endpoint`,
      });
    }
    if (value.hasPersonalData && (value.personalDataMeasure ?? "").length < 20) {
      ctx.addIssue({
        code: "custom",
        path: ["personalDataMeasure"],
        message: "ชุดข้อมูลที่มีข้อมูลส่วนบุคคลต้องระบุมาตรการคุ้มครองอย่างน้อย 20 ตัวอักษร",
      });
    }
    if (value.dataStartDate && value.dataEndDate && value.dataStartDate > value.dataEndDate) {
      ctx.addIssue({
        code: "custom",
        path: ["dataEndDate"],
        message: "วันสิ้นสุดของข้อมูลต้องไม่มาก่อนวันเริ่มต้น",
      });
    }
  });
