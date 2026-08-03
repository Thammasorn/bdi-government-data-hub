/**
 * ป้ายภาษาไทยและกฎการตรวจสอบของคำขอลงทะเบียนชุดข้อมูล
 * อ้างอิง docs/01-user-journey.md §4.3 — ฟิลด์ทั้งหมดเป็น [สมมติฐาน] รอเจ้าของสเปกยืนยัน
 */
import {
  DataClassification,
  DataFormat,
  DatasetCategory,
  DatasetRequestStatus,
  DatasetType,
  DeliveryMethod,
  GeoCoverage,
  LicenseType,
  UpdateFrequency,
} from "@prisma/client";
import { z } from "zod";

import { isValidThaiPhone } from "./validation.js";

// ------------------------------------------------------------------ ป้ายภาษาไทย

export const DATASET_STATUS_LABELS: Record<DatasetRequestStatus, string> = {
  [DatasetRequestStatus.DRAFT]: "ฉบับร่าง",
  [DatasetRequestStatus.PENDING_OFFICER_REVIEW]: "รอ BDI ตรวจสอบเบื้องต้น",
  [DatasetRequestStatus.PENDING_ORG_APPROVER]: "รอผู้มีอำนาจของหน่วยงานพิจารณา",
  [DatasetRequestStatus.PENDING_OFFICER_FINAL_CHECK]: "รอ BDI ตรวจสอบขั้นสุดท้าย",
  [DatasetRequestStatus.PENDING_BDI_APPROVAL]: "รอ BDI อนุมัติ",
  [DatasetRequestStatus.NEEDS_REVISION]: "รอการแก้ไข",
  [DatasetRequestStatus.APPROVED]: "อนุมัติแล้ว",
  [DatasetRequestStatus.REJECTED]: "ไม่อนุมัติ",
};

export const DATASET_TYPE_LABELS: Record<DatasetType, string> = {
  RECORD: "ข้อมูลระเบียน",
  STATISTIC: "ข้อมูลสถิติ",
  GEOGRAPHIC: "ข้อมูลภูมิสารสนเทศ",
  MULTIMEDIA: "ข้อมูลมัลติมีเดีย",
  OTHER: "อื่น ๆ",
};

export const DATASET_CATEGORY_LABELS: Record<DatasetCategory, string> = {
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

export const FREQUENCY_LABELS: Record<UpdateFrequency, string> = {
  REAL_TIME: "ทันที (real-time)",
  DAILY: "รายวัน",
  WEEKLY: "รายสัปดาห์",
  MONTHLY: "รายเดือน",
  QUARTERLY: "รายไตรมาส",
  BIANNUAL: "ราย 6 เดือน",
  YEARLY: "รายปี",
  AS_NEEDED: "ตามความจำเป็น",
};

export const GEO_COVERAGE_LABELS: Record<GeoCoverage, string> = {
  NATIONAL: "ทั้งประเทศ",
  REGIONAL: "รายภาค",
  PROVINCIAL: "รายจังหวัด",
  DISTRICT: "รายอำเภอ/เขต",
  OTHER: "อื่น ๆ",
};

export const DELIVERY_METHOD_LABELS: Record<DeliveryMethod, string> = {
  API: "API",
  SFTP: "SFTP",
  DATABASE: "เชื่อมต่อฐานข้อมูลโดยตรง",
  FILE_UPLOAD: "อัปโหลดไฟล์เข้าระบบ",
  OTHER: "อื่น ๆ",
};

export const DATA_FORMAT_LABELS: Record<DataFormat, string> = {
  CSV: "CSV",
  JSON: "JSON",
  XLSX: "Excel (XLSX)",
  XML: "XML",
  PARQUET: "Parquet",
  SHAPEFILE: "Shapefile",
  OTHER: "อื่น ๆ",
};

export const CLASSIFICATION_LABELS: Record<DataClassification, string> = {
  PUBLIC: "สาธารณะ",
  INTERNAL: "ใช้ภายในหน่วยงาน",
  CONFIDENTIAL: "ลับ",
  SECRET: "ลับมาก",
};

export const LICENSE_LABELS: Record<LicenseType, string> = {
  OPEN_GOVERNMENT: "Open Government License",
  CC_BY: "CC-BY",
  CC_BY_SA: "CC-BY-SA",
  CC_BY_NC: "CC-BY-NC",
  INTERNAL_ONLY: "ใช้ภายในเท่านั้น",
  OTHER: "อื่น ๆ",
};

/** ปลายทางบังคับกรอกเฉพาะวิธีนำส่งที่ต้องเชื่อมต่อทางเทคนิค */
export const ENDPOINT_REQUIRED: DeliveryMethod[] = [
  DeliveryMethod.API,
  DeliveryMethod.SFTP,
  DeliveryMethod.DATABASE,
];

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

export const DATASET_ATTACHMENT_LABELS = {
  DATA_DICTIONARY: "พจนานุกรมข้อมูล (Data Dictionary)",
  EXAMPLE_DATA: "ตัวอย่างข้อมูล",
  GENERATED_FORM: "แบบฟอร์มที่ระบบสร้าง",
} as const;

// ------------------------------------------------------------------ zod

/** null = ผู้ใช้ล้างค่าทิ้ง, undefined = ไม่ได้แตะช่องนี้ */
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();
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
  nameTh: optionalText(200),
  nameEn: optionalText(200),
  description: optionalText(4000),
  datasetType: z.nativeEnum(DatasetType).nullable().optional(),
  category: z.nativeEnum(DatasetCategory).nullable().optional(),
  keywords: z.array(z.string().trim().min(1).max(60)).max(10).optional(),
  updateFrequency: z.nativeEnum(UpdateFrequency).nullable().optional(),
  geoCoverage: z.nativeEnum(GeoCoverage).nullable().optional(),
  dataStartDate: dateInput,
  dataEndDate: dateInput,
  estimatedRecords: z.number().int().min(0).nullable().optional(),
  stewardName: optionalText(200),
  stewardEmail: optionalText(200),
  stewardPhone: optionalText(30),

  deliveryMethod: z.nativeEnum(DeliveryMethod).nullable().optional(),
  dataFormat: z.nativeEnum(DataFormat).nullable().optional(),
  deliveryFrequency: z.nativeEnum(UpdateFrequency).nullable().optional(),
  deliveryEndpoint: optionalText(500),
  technicalContactName: optionalText(200),
  technicalContactEmail: optionalText(200),
  deliveryNote: optionalText(2000),

  dataClassification: z.nativeEnum(DataClassification).nullable().optional(),
  hasPersonalData: z.boolean().nullable().optional(),
  personalDataMeasure: optionalText(2000),
  legalBasis: optionalText(2000),
  licenseType: z.nativeEnum(LicenseType).nullable().optional(),
  usageRestriction: optionalText(2000),
  legalAccepted: z.boolean().optional(),
});

export type DatasetDraftInput = z.infer<typeof datasetDraftSchema>;

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

/**
 * ตรวจความครบถ้วนของ "แถวในฐานข้อมูล" ก่อนสร้าง PDF และก่อนนำส่ง
 * (parse ตัว record ตรง ๆ เหมือน submitSchema ของหน่วยงาน)
 */
export const datasetSubmitSchema = z
  .object({
    nameTh: required("กรุณากรอกชื่อชุดข้อมูล")
      .min(3, "ชื่อชุดข้อมูลต้องมีอย่างน้อย 3 ตัวอักษร")
      .max(200),
    nameEn: z.string().trim().max(200).nullable().optional(),
    description: required("กรุณากรอกคำอธิบายชุดข้อมูล").min(
      30,
      "คำอธิบายต้องมีอย่างน้อย 30 ตัวอักษร",
    ),
    datasetType: z.nativeEnum(DatasetType, { error: "กรุณาเลือกประเภทชุดข้อมูล" }),
    category: z.nativeEnum(DatasetCategory, { error: "กรุณาเลือกหมวดหมู่" }),
    keywords: z.array(z.string().trim().min(1)).min(1, "กรุณาระบุคำสำคัญอย่างน้อย 1 คำ").max(10),
    updateFrequency: z.nativeEnum(UpdateFrequency, { error: "กรุณาเลือกความถี่ในการปรับปรุงข้อมูล" }),
    geoCoverage: z.nativeEnum(GeoCoverage, { error: "กรุณาเลือกขอบเขตเชิงพื้นที่" }),
    dataStartDate: nullableDate,
    dataEndDate: nullableDate,
    estimatedRecords: z.number().int().min(0).nullable().optional(),
    stewardName: required("กรุณากรอกชื่อผู้ประสานงานชุดข้อมูล"),
    stewardEmail: requiredEmail("กรุณากรอกอีเมลผู้ประสานงานชุดข้อมูล"),
    stewardPhone: requiredPhone("กรุณากรอกเบอร์โทรผู้ประสานงานชุดข้อมูล"),

    deliveryMethod: z.nativeEnum(DeliveryMethod, { error: "กรุณาเลือกวิธีการนำส่งข้อมูล" }),
    dataFormat: z.nativeEnum(DataFormat, { error: "กรุณาเลือกรูปแบบข้อมูล" }),
    deliveryFrequency: z.nativeEnum(UpdateFrequency, { error: "กรุณาเลือกความถี่ในการนำส่ง" }),
    deliveryEndpoint: z.string().trim().max(500).nullable().optional(),
    technicalContactName: required("กรุณากรอกชื่อผู้รับผิดชอบทางเทคนิค"),
    technicalContactEmail: requiredEmail("กรุณากรอกอีเมลผู้รับผิดชอบทางเทคนิค"),
    deliveryNote: z.string().trim().max(2000).nullable().optional(),

    dataClassification: z.nativeEnum(DataClassification, { error: "กรุณาเลือกชั้นความลับของข้อมูล" }),
    hasPersonalData: z.boolean({ error: "กรุณาระบุว่ามีข้อมูลส่วนบุคคลหรือไม่" }),
    personalDataMeasure: z.string().trim().nullable().optional(),
    legalBasis: required("กรุณาระบุฐานอำนาจตามกฎหมาย").min(
      10,
      "กรุณาระบุฐานอำนาจตามกฎหมายอย่างน้อย 10 ตัวอักษร",
    ),
    licenseType: z.nativeEnum(LicenseType, { error: "กรุณาเลือกสัญญาอนุญาตให้ใช้ข้อมูล" }),
    usageRestriction: z.string().trim().max(2000).nullable().optional(),
    legalAcceptedAt: z.date({ error: "กรุณากดยอมรับเงื่อนไขการนำส่งข้อมูล" }),
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

/**
 * เลขที่คำขอ DR-<ปี>-<ลำดับ 4 หลัก> นับแยกรายปี
 * มีโอกาสชนกันเมื่อสองคนกดพร้อมกัน — ผู้เรียกต้องลองใหม่เมื่อเจอ unique violation (P2002)
 */
export function nextRequestNumber(year: number, countThisYear: number): string {
  return `DR-${year}-${String(countThisYear + 1).padStart(4, "0")}`;
}
