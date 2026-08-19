/**
 * PDF ที่ระบบวาดเอง — เหลือเฉพาะแบบฟอร์มลงทะเบียนชุดข้อมูล (Journey C)
 *
 * แบบฟอร์มขอสร้างหน่วยงานเคยอยู่ในไฟล์นี้ด้วย (renderOrganizationForm) โดยวางเลย์เอาต์
 * ขึ้นมาเองเพราะสเปกมีแต่ภาพตัวอย่าง ไม่มีไฟล์ template ตอนนี้ได้ไฟล์จริงมาแล้ว เอกสาร
 * ของเส้นทาง B จึงเป็นเอกสาร A0 ที่ render จาก .docx ของฝ่ายกฎหมาย —
 * ดู lib/organization-agreement.ts และ lib/document-render.ts
 */
import PDFDocument from "pdfkit";

import {
  DATASET_ATTACHMENT_LABELS,
  DATA_CATEGORY_LABELS,
  DATA_CLASSIFICATION_LABELS,
  DATA_FORMAT_LABELS,
  DATA_TOPIC_LABELS,
  DATA_TYPE_LABELS,
  DELIVERY_FREQUENCY_LABELS,
  GEO_COVERAGE_LABELS,
  LICENSE_LABELS,
  PERSONAL_DATA_PERIOD_LABELS,
  formatUpdateFrequency,
  metadataRules,
  splitTags,
  type MetadataValues,
} from "./dataset.js";

const FONT_DIR = new URL("../assets/fonts/", import.meta.url);
const font = (file: string) => new URL(file, FONT_DIR).pathname;

/**
 * เครื่องหมาย B) จาก assets/theme_ci_design/LOGO — PDFKit ฝัง SVG ไม่ได้
 * จึงใช้ PNG ที่ครอปพื้นที่ว่างรอบโลโก้ออกแล้ว ตำแหน่งใน header จะได้คุมได้จริง
 */
const MARK = new URL("../assets/brand/bdi-mark.png", import.meta.url).pathname;

const NAVY = "#192768";
const CORAL = "#E5775A";
const TEXT = "#141A33";
const MUTED = "#5B6178";
const BORDER = "#E2E4EC";

const PAGE_MARGIN = 56;
const CONTENT_WIDTH = 595.28 - PAGE_MARGIN * 2; // A4 width in points

/** locale th-TH คืนปี พ.ศ. มาให้แล้ว ไม่ต้องบวก 543 ซ้ำ */
const thaiDate = (d: Date) =>
  new Intl.DateTimeFormat("th-TH", { dateStyle: "long", timeZone: "Asia/Bangkok" }).format(d);

// ------------------------------------------------------------------ ชุดข้อมูล

/**
 * ข้อมูลที่แบบฟอร์มชุดข้อมูลต้องพิมพ์ — structural type เช่นเดียวกับฝั่งหน่วยงาน
 *
 * ช่องของ metadata ทั้งหมดมาจาก MetadataValues (คอลัมน์ของ dataset_registration_metadata
 * รวมกับค่าที่อยู่ใน additional_metadata_json) เอกสารฉบับนี้คือสิ่งที่หน่วยงานลงนาม
 * จึงต้องพิมพ์ครบทุกช่องที่ถามไป ไม่ใช่เฉพาะช่องที่มีคอลัมน์ของตัวเอง
 */
export interface DatasetFormInput extends MetadataValues {
  requestNumber: string;
  organization: { name: string };
  submittedAt: Date | null;
  createdAt: Date | null;

  legalAcceptedAt: Date | null;

  /** ชื่อผู้ยื่นคำขอ ณ เวลาที่สร้างเอกสาร — ไม่ใช่ชื่อกองที่รับผิดชอบข้อมูล (maintainer) */
  submitterName: string | null;

  /**
   * ผู้ลงนามและผู้อนุมัติ — เดิมเป็นคอลัมน์บน dataset_requests
   * ตอนนี้มาจาก signature.signature_confirmation กับ review.review_task ที่ปิดแล้ว
   * ยังต้องเก็บ "ชื่อ ณ เวลานั้น" เพื่อให้ PDF ฉบับอนุมัติพิมพ์ชื่อได้ถูกแม้ผู้ใช้เปลี่ยนชื่อภายหลัง
   */
  orgApproverSignedName: string | null;
  orgApproverSignedAt: Date | null;
  approvedByName: string | null;
  approvedAt: Date | null;

  attachments: Array<{ kind: string; filename: string }>;
}

/**
 * แบบฟอร์มขอลงทะเบียนชุดข้อมูล (docs/01-user-journey.md §4)
 *
 * ข้อความยาว ๆ (คำอธิบาย ฐานอำนาจตามกฎหมาย) ถูกตัดบรรทัดโดย `rows()` ซึ่งกำหนดความกว้างไว้
 * และ `ensureSpace()` จะขึ้นหน้าใหม่ให้เองเมื่อพื้นที่เหลือไม่พอ — สเปกกำหนดไว้ทั้งสองข้อ
 */
export function renderDatasetRegistrationForm(request: DatasetFormInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: PAGE_MARGIN, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.registerFont("body", font("Sarabun-Regular.ttf"));
    doc.registerFont("bodyBold", font("Sarabun-SemiBold.ttf"));
    doc.registerFont("heading", font("Prompt-SemiBold.ttf"));

    header(doc);
    documentTitle(doc, "แบบฟอร์มขอลงทะเบียนชุดข้อมูล", [
      `เลขที่คำขอ ${request.requestNumber}`,
      `หน่วยงาน ${request.organization.name}`,
      `วันที่จัดทำ ${thaiDate(new Date(request.submittedAt ?? request.createdAt ?? new Date()))}`,
    ]);

    // ช่องที่ชีท conditions สั่งซ่อน จะไม่ถูกพิมพ์ลงเอกสารเลย ไม่ใช่พิมพ์หัวข้อทิ้งว่างไว้ —
    // เอกสารที่หน่วยงานลงนามไม่ควรมีคำถามที่ระบบไม่ได้ถาม
    const rules = metadataRules(request);
    const grant = (value: boolean | null) =>
      value === null ? "" : value ? "อนุญาต" : "ไม่อนุญาต";

    section(doc, "ส่วนที่ 1", "ประเภทและชื่อชุดข้อมูล");
    rows(doc, [
      ["ประเภทข้อมูล", label(DATA_TYPE_LABELS, request.dataType)],
      ["ประเด็น", label(DATA_TOPIC_LABELS, request.dataTopic)],
      ...(rules.dataTopicOther.visible
        ? ([["ประเด็นอื่น ๆ", request.dataTopicOther]] as Array<[string, string | null]>)
        : []),
      ["ชื่อชุดข้อมูล (ภาษาไทย)", request.title],
      ["ชื่อชุดข้อมูล (ภาษาอังกฤษ)", request.name],
      ["องค์กร", request.organization.name],
      ["ชื่อผู้ติดต่อ", request.maintainer],
      ["อีเมลผู้ติดต่อ", request.maintainerEmail],
      ["คำสำคัญ", splitTags(request.tagString).join(" · ")],
      ["รายละเอียด", request.notes],
      ["วัตถุประสงค์", request.objective],
    ]);

    section(doc, "ส่วนที่ 2", "ความถี่ ขอบเขต และรูปแบบการนำส่ง");
    rows(doc, [
      [
        "ความถี่ของการปรับปรุงข้อมูลต้นทาง",
        formatUpdateFrequency(request.updateFrequencyUnit, request.updateFrequencyInterval),
      ],
      [
        "ความถี่ของการนำส่งข้อมูลเข้าสู่ระบบกลาง",
        label(DELIVERY_FREQUENCY_LABELS, request.deliveryFrequency),
      ],
      ["ความละเอียดเชิงภูมิศาสตร์", label(GEO_COVERAGE_LABELS, request.geoCoverage)],
      ["แหล่งที่มาของข้อมูล", request.dataSource],
      ["รูปแบบการนำส่งข้อมูล", label(DATA_FORMAT_LABELS, request.dataFormat)],
      ...(rules.dataFormatOther.visible
        ? ([["ชื่อระบบเชื่อมโยงข้อมูล", request.dataFormatOther]] as Array<[string, string | null]>)
        : []),
    ]);

    section(doc, "ส่วนที่ 3", "หมวดหมู่ ระดับชั้น และสัญญาอนุญาต");
    rows(doc, [
      ["หมวดหมู่ข้อมูลตามธรรมาภิบาลภาครัฐ", label(DATA_CATEGORY_LABELS, request.dataCategory)],
      [
        "มีข้อมูลส่วนบุคคลหรือไม่",
        request.containsPersonalData === null ? "" : request.containsPersonalData ? "มี" : "ไม่มี",
      ],
      ...((rules.personalDataDetail.visible
        ? [
            ["ประเภทของข้อมูลส่วนบุคคล", request.personalDataTypes],
            ["กลุ่มหรือประเภทของเจ้าของข้อมูลส่วนบุคคล", request.dataSubjectCategories],
            [
              "ระยะเวลาประมวลผลข้อมูลส่วนบุคคล",
              rules.personalDataPeriodAmount.visible
                ? personalDataPeriod(request)
                : label(PERSONAL_DATA_PERIOD_LABELS, request.personalDataProcessingPeriod),
            ],
          ]
        : []) as Array<[string, string | null]>),
      ["ระดับชั้นข้อมูล", label(DATA_CLASSIFICATION_LABELS, request.dataClassification)],
      ["สัญญาอนุญาตให้ใช้ข้อมูล", label(LICENSE_LABELS, request.licenseId)],
    ]);

    section(doc, "ส่วนที่ 4", "การจัดเก็บและส่งต่อข้อมูล");
    rows(doc, [
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
        ? ([
            ["หน่วยงานปลายทางที่อนุญาต", request.transformedRawDataRecipients],
          ] as Array<[string, string | null]>)
        : []),
      [
        "ส่งต่อข้อมูลดิบแปลงสภาพไปยังศูนย์แลกเปลี่ยนข้อมูลกลางภาครัฐ (GDX)",
        grant(request.allowTransformedRawDataGdxSharing),
      ],
      ...(rules.transformedRawDataGdxRecipients.visible
        ? ([
            ["หน่วยงานที่อนุญาตให้รับข้อมูลผ่าน GDX", request.transformedRawDataGdxRecipients],
          ] as Array<[string, string | null]>)
        : []),
      ["ส่งต่อข้อมูลรวม (aggregated data)", grant(request.allowAggregatedDataSharing)],
      ...(rules.aggregatedDataRecipients.visible
        ? ([
            ["หน่วยงานปลายทางที่อนุญาตให้รับข้อมูลรวม", request.aggregatedDataRecipients],
          ] as Array<[string, string | null]>)
        : []),
      ...(rules.authorizePersonalDataAnonymization.visible
        ? ([
            [
              "มอบหมายให้สำนักงานแปลงข้อมูลส่วนบุคคลให้ไม่สามารถระบุตัวตนได้",
              request.authorizePersonalDataAnonymization === null
                ? ""
                : request.authorizePersonalDataAnonymization
                  ? "มอบหมาย"
                  : "ไม่มอบหมาย",
            ],
          ] as Array<[string, string | null]>)
        : []),
      [
        "ยอมรับเงื่อนไขการนำส่งข้อมูล",
        request.legalAcceptedAt ? `ยอมรับเมื่อ ${thaiDate(new Date(request.legalAcceptedAt))}` : "",
      ],
    ]);

    section(doc, "ส่วนที่ 5", "เอกสารแนบ");
    rows(
      doc,
      request.attachments
        .filter((a) => a.kind !== "GENERATED_FORM")
        .map(
          (a) =>
            [
              DATASET_ATTACHMENT_LABELS[a.kind as keyof typeof DATASET_ATTACHMENT_LABELS] ?? a.kind,
              a.filename,
            ] as [string, string],
        ),
    );

    datasetSignatures(doc, request);
    if (request.approvedAt) approvalStamp(doc, request);
    footer(doc);

    doc.end();
  });
}

function datasetSignatures(doc: PDFKit.PDFDocument, request: DatasetFormInput) {
  ensureSpace(doc, 150);
  doc.y += 24;
  const y = doc.y;
  const colWidth = (CONTENT_WIDTH - 40) / 2;

  const column = (x: number, role: string, name: string, when: Date | null) => {
    doc
      .moveTo(x, y + 52)
      .lineTo(x + colWidth, y + 52)
      .lineWidth(0.7)
      .strokeColor("#9AA0B5")
      .stroke();
    doc
      .font("body")
      .fontSize(9.5)
      .fillColor(MUTED)
      .text(`(${name || "....................................."})`, x, y + 58, {
        width: colWidth,
        align: "center",
      });
    doc.font("bodyBold").fontSize(9.5).fillColor(TEXT).text(role, x, y + 74, {
      width: colWidth,
      align: "center",
    });
    if (when) {
      doc
        .font("body")
        .fontSize(8.5)
        .fillColor(MUTED)
        .text(thaiDate(new Date(when)), x, y + 88, { width: colWidth, align: "center" });
    }
  };

  column(PAGE_MARGIN, "ผู้ยื่นคำขอ", request.submitterName ?? "", request.submittedAt);
  column(
    PAGE_MARGIN + colWidth + 40,
    "ผู้มีอำนาจกระทำการแทน",
    request.orgApproverSignedName ?? "",
    request.orgApproverSignedAt,
  );
  doc.y = y + 108;
}

/** ตราประทับผลการอนุมัติ — ใส่เฉพาะ PDF ฉบับที่สร้างใหม่หลังอนุมัติ (§4.6) */
function approvalStamp(doc: PDFKit.PDFDocument, request: DatasetFormInput) {
  ensureSpace(doc, 90);
  const y = doc.y + 8;
  doc.rect(PAGE_MARGIN, y, CONTENT_WIDTH, 62).fill("#E3F4ED");
  doc.rect(PAGE_MARGIN, y, 3, 62).fill("#1B7F5A");
  doc
    .font("heading")
    .fontSize(12)
    .fillColor("#1B7F5A")
    .text("อนุมัติให้ลงทะเบียนชุดข้อมูล", PAGE_MARGIN + 16, y + 12);
  doc
    .font("body")
    .fontSize(9.5)
    .fillColor(TEXT)
    .text(
      `โดย ${request.approvedByName ?? "-"} · ${thaiDate(new Date(request.approvedAt!))}`,
      PAGE_MARGIN + 16,
      y + 32,
      { width: CONTENT_WIDTH - 32 },
    );
  doc.y = y + 62 + 10;
}

function label<T extends string>(map: Record<T, string>, value: T | null): string {
  return value ? (map[value] ?? value) : "";
}

/** 13.2.3 ตัวเลือก "ระบุระยะเวลา" — ปีกับเดือนอ่านรวมเป็นประโยคเดียว */
function personalDataPeriod(request: DatasetFormInput): string {
  const parts: string[] = [];
  if (request.personalDataProcessingPeriodYear) {
    parts.push(`${request.personalDataProcessingPeriodYear.toLocaleString("th-TH")} ปี`);
  }
  if (request.personalDataProcessingPeriodMonth) {
    parts.push(`${request.personalDataProcessingPeriodMonth.toLocaleString("th-TH")} เดือน`);
  }
  return parts.length > 0 ? parts.join(" ") : "";
}

// ------------------------------------------------------------------ ส่วนประกอบ

function header(doc: PDFKit.PDFDocument) {
  // แถบ gradient ประจำแบรนด์
  const grad = doc.linearGradient(PAGE_MARGIN, 0, PAGE_MARGIN + CONTENT_WIDTH, 0);
  grad.stop(0, CORAL).stop(1, NAVY);
  doc.rect(PAGE_MARGIN, 34, CONTENT_WIDTH, 3).fill(grad);

  doc.image(MARK, PAGE_MARGIN, 50, { height: 22 });

  doc
    .font("body")
    .fontSize(9)
    .fillColor(MUTED)
    .text("สถาบันข้อมูลขนาดใหญ่ (องค์การมหาชน)", PAGE_MARGIN, 58, {
      width: CONTENT_WIDTH,
      align: "right",
    });
}

/** หัวเอกสารกลางของทุกแบบฟอร์ม — บรรทัดย่อยใส่ได้หลายบรรทัด */
function documentTitle(doc: PDFKit.PDFDocument, heading: string, lines: string[]) {
  doc.moveDown(2);
  doc.font("heading").fontSize(19).fillColor(TEXT).text(heading, PAGE_MARGIN, 92, {
    width: CONTENT_WIDTH,
    align: "center",
  });
  doc
    .font("body")
    .fontSize(10)
    .fillColor(MUTED)
    .text("Government Datahub Platform", { width: CONTENT_WIDTH, align: "center" });

  for (const line of lines) {
    doc.fontSize(9).text(line, { width: CONTENT_WIDTH, align: "center" });
  }
  doc.moveDown(1.2);
}

function section(doc: PDFKit.PDFDocument, tag: string, label: string) {
  ensureSpace(doc, 80);
  const y = doc.y + 8;

  doc.rect(PAGE_MARGIN, y, CONTENT_WIDTH, 26).fill("#F6F7FB");
  doc.rect(PAGE_MARGIN, y, 3, 26).fill(CORAL);

  doc.font("bodyBold").fontSize(9).fillColor(CORAL).text(tag, PAGE_MARGIN + 14, y + 8);
  doc.font("heading").fontSize(11).fillColor(NAVY).text(label, PAGE_MARGIN + 56, y + 7);

  doc.y = y + 26 + 10;
}

function rows(doc: PDFKit.PDFDocument, entries: Array<[string, string | null | undefined]>) {
  // PDFKit ตัดบรรทัดภาษาไทยที่ตัวอักษรใดก็ได้ (ไทยไม่มีช่องว่างระหว่างคำ) หัวข้อยาว ๆ
  // จึงขาดกลางคำ คอลัมน์หัวข้อกว้างขึ้นช่วยให้หัวข้อส่วนใหญ่จบในบรรทัดเดียว
  const labelWidth = 195;
  for (const [label, value] of entries) {
    ensureSpace(doc, 34);
    const y = doc.y;
    doc.font("body").fontSize(10).fillColor(MUTED).text(label, PAGE_MARGIN + 4, y + 5, {
      width: labelWidth,
    });
    // หัวข้อยาวกว่าค่าได้ — ถ้าวัดจากค่าอย่างเดียว เส้นคั่นจะลากผ่านบรรทัดที่สองของหัวข้อ
    // แล้วแถวถัดไปทับกัน (เจอกับ "ความถี่ของการนำส่งข้อมูลเข้าสู่ระบบกลาง")
    const labelBottom = doc.y;
    doc
      .font("body")
      .fontSize(10.5)
      .fillColor(value ? TEXT : "#A6ABBD")
      .text(value || "—", PAGE_MARGIN + labelWidth + 12, y + 5, {
        width: CONTENT_WIDTH - labelWidth - 16,
      });

    const bottom = Math.max(doc.y, labelBottom, y + 22) + 5;
    doc
      .moveTo(PAGE_MARGIN + 4, bottom)
      .lineTo(PAGE_MARGIN + CONTENT_WIDTH - 4, bottom)
      .lineWidth(0.5)
      .strokeColor(BORDER)
      .stroke();
    doc.y = bottom + 4;
  }
}

function footer(doc: PDFKit.PDFDocument) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    // y=800 อยู่ต่ำกว่าขอบล่างของ content — ถ้าไม่ปิด margin ชั่วคราว PDFKit
    // จะถือว่าข้อความล้นหน้าแล้วแทรกหน้าเปล่าเพิ่มให้ทุกหน้า
    const bottomMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc
      .font("body")
      .fontSize(8)
      .fillColor("#9AA0B5")
      .text(
        `เอกสารนี้สร้างโดยระบบ Government Datahub Platform · หน้า ${i - range.start + 1} จาก ${range.count}`,
        PAGE_MARGIN,
        800,
        { width: CONTENT_WIDTH, align: "center" },
      );
    doc.page.margins.bottom = bottomMargin;
  }
}

// ------------------------------------------------------------------ helpers

function ensureSpace(doc: PDFKit.PDFDocument, needed: number) {
  if (doc.y + needed > 770) doc.addPage();
}

function fullName(prefix?: string | null, first?: string | null, last?: string | null): string {
  return [prefix, first, last].filter(Boolean).join(" ").trim();
}

function formatNationalId(id?: string | null): string {
  if (!id) return "";
  const d = id.replace(/\D/g, "");
  if (d.length !== 13) return id;
  return `${d[0]}-${d.slice(1, 5)}-${d.slice(5, 10)}-${d.slice(10, 12)}-${d[12]}`;
}
