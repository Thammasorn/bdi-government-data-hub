import PDFDocument from "pdfkit";
import type { DatasetRequest, Organization } from "@prisma/client";

import {
  CLASSIFICATION_LABELS,
  DATASET_ATTACHMENT_LABELS,
  DATASET_CATEGORY_LABELS,
  DATASET_TYPE_LABELS,
  DATA_FORMAT_LABELS,
  DELIVERY_METHOD_LABELS,
  FREQUENCY_LABELS,
  GEO_COVERAGE_LABELS,
  LICENSE_LABELS,
} from "./dataset.js";

const FONT_DIR = new URL("../assets/fonts/", import.meta.url);
const font = (file: string) => new URL(file, FONT_DIR).pathname;

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

/**
 * สร้าง PDF แบบฟอร์มขอสร้างหน่วยงานจากข้อมูลที่ผู้ใช้กรอก
 * สเปกใน Notion มีภาพตัวอย่างแต่ไม่มีไฟล์ template จริง จึงวางเลย์เอาต์ใหม่ให้ตรงกับ CI
 */
export function renderOrganizationForm(org: Organization): Promise<Buffer> {
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
    title(doc, org);

    section(doc, "ส่วนที่ 1", "ข้อมูลหน่วยงาน");
    rows(doc, [
      ["ชื่อหน่วยงาน", org.name],
      ["ที่อยู่", org.addressLine],
      ["ตำบล/แขวง", org.subdistrict],
      ["อำเภอ/เขต", org.district],
      ["จังหวัด", org.province],
      ["รหัสไปรษณีย์", org.postalCode],
      ["อีเมลหน่วยงาน", org.email],
    ]);

    section(doc, "ส่วนที่ 2", "ผู้มีอำนาจกระทำการแทน");
    rows(doc, [
      ["ชื่อ-นามสกุล", fullName(org.signatoryPrefix, org.signatoryFirstName, org.signatoryLastName)],
      ["ตำแหน่ง", org.signatoryPosition],
      ["เลขบัตรประชาชน", formatNationalId(org.signatoryNationalId)],
      ["อีเมล", org.signatoryEmail],
      ["เบอร์โทรศัพท์", org.signatoryPhone],
    ]);

    section(doc, "ส่วนที่ 3", "ผู้กรอกข้อมูล");
    rows(doc, [
      ["ชื่อ-นามสกุล", fullName(org.contactPrefix, org.contactFirstName, org.contactLastName)],
      ["ตำแหน่ง", org.contactPosition],
      ["ฝ่าย/กอง/สำนัก", org.contactDepartment],
      ["อีเมล", org.contactEmail],
      ["เบอร์โทรศัพท์", org.contactPhone],
    ]);

    signatureBlock(doc, org);
    footer(doc);

    doc.end();
  });
}

// ------------------------------------------------------------------ ชุดข้อมูล

export type DatasetFormInput = DatasetRequest & {
  organization: { name: string };
  attachments: Array<{ kind: string; filename: string }>;
};

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

    section(doc, "ส่วนที่ 1", "ข้อมูลชุดข้อมูล");
    rows(doc, [
      ["ชื่อชุดข้อมูล", request.nameTh],
      ["ชื่อภาษาอังกฤษ", request.nameEn],
      ["คำอธิบาย", request.description],
      ["ประเภทชุดข้อมูล", label(DATASET_TYPE_LABELS, request.datasetType)],
      ["หมวดหมู่", label(DATASET_CATEGORY_LABELS, request.category)],
      ["คำสำคัญ", request.keywords.join(" · ")],
      ["ความถี่ในการปรับปรุงข้อมูล", label(FREQUENCY_LABELS, request.updateFrequency)],
      ["ขอบเขตเชิงพื้นที่", label(GEO_COVERAGE_LABELS, request.geoCoverage)],
      ["ช่วงเวลาของข้อมูล", dateRange(request.dataStartDate, request.dataEndDate)],
      [
        "จำนวนรายการโดยประมาณ",
        request.estimatedRecords === null ? "" : request.estimatedRecords.toLocaleString("th-TH"),
      ],
      ["ผู้ประสานงานชุดข้อมูล", request.stewardName],
      ["อีเมลผู้ประสานงาน", request.stewardEmail],
      ["เบอร์โทรผู้ประสานงาน", request.stewardPhone],
    ]);

    section(doc, "ส่วนที่ 2", "วิธีการนำส่งข้อมูล");
    rows(doc, [
      ["วิธีการนำส่ง", label(DELIVERY_METHOD_LABELS, request.deliveryMethod)],
      ["รูปแบบข้อมูล", label(DATA_FORMAT_LABELS, request.dataFormat)],
      ["ความถี่ในการนำส่ง", label(FREQUENCY_LABELS, request.deliveryFrequency)],
      ["ปลายทาง / endpoint", request.deliveryEndpoint],
      ["ผู้รับผิดชอบทางเทคนิค", request.technicalContactName],
      ["อีเมลผู้รับผิดชอบทางเทคนิค", request.technicalContactEmail],
      ["หมายเหตุการนำส่ง", request.deliveryNote],
    ]);

    section(doc, "ส่วนที่ 3", "เงื่อนไขทางกฎหมาย");
    rows(doc, [
      ["ชั้นความลับของข้อมูล", label(CLASSIFICATION_LABELS, request.dataClassification)],
      [
        "มีข้อมูลส่วนบุคคล",
        request.hasPersonalData === null ? "" : request.hasPersonalData ? "มี" : "ไม่มี",
      ],
      ["มาตรการคุ้มครองข้อมูลส่วนบุคคล", request.personalDataMeasure],
      ["ฐานอำนาจตามกฎหมาย", request.legalBasis],
      ["สัญญาอนุญาตให้ใช้ข้อมูล", label(LICENSE_LABELS, request.licenseType)],
      ["ข้อจำกัดการใช้ข้อมูล", request.usageRestriction],
      [
        "ยอมรับเงื่อนไขการนำส่งข้อมูล",
        request.legalAcceptedAt ? `ยอมรับเมื่อ ${thaiDate(new Date(request.legalAcceptedAt))}` : "",
      ],
    ]);

    section(doc, "ส่วนที่ 4", "เอกสารแนบ");
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

  column(PAGE_MARGIN, "ผู้ยื่นคำขอ", request.stewardName ?? "", request.submittedAt);
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

function dateRange(start: Date | null, end: Date | null): string {
  if (!start && !end) return "";
  const s = start ? thaiDate(new Date(start)) : "ไม่ระบุ";
  const e = end ? thaiDate(new Date(end)) : "ปัจจุบัน";
  return `${s} – ${e}`;
}

// ------------------------------------------------------------------ ส่วนประกอบ

function header(doc: PDFKit.PDFDocument) {
  // แถบ gradient ประจำแบรนด์
  const grad = doc.linearGradient(PAGE_MARGIN, 0, PAGE_MARGIN + CONTENT_WIDTH, 0);
  grad.stop(0, CORAL).stop(1, NAVY);
  doc.rect(PAGE_MARGIN, 34, CONTENT_WIDTH, 3).fill(grad);

  doc.font("heading").fontSize(15).fillColor(NAVY).text("BDI", PAGE_MARGIN, 52, { continued: true });
  doc.fillColor(CORAL).text(".", { continued: false });

  doc
    .font("body")
    .fontSize(9)
    .fillColor(MUTED)
    .text("สถาบันข้อมูลขนาดใหญ่ (องค์การมหาชน)", PAGE_MARGIN, 56, {
      width: CONTENT_WIDTH,
      align: "right",
    });
}

function title(doc: PDFKit.PDFDocument, org: Organization) {
  documentTitle(doc, "แบบฟอร์มขอสร้างหน่วยงานในระบบ", [
    `วันที่จัดทำ ${thaiDate(new Date(org.submittedAt ?? org.createdAt ?? new Date()))}`,
  ]);
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
  const labelWidth = 150;
  for (const [label, value] of entries) {
    ensureSpace(doc, 34);
    const y = doc.y;
    doc.font("body").fontSize(10).fillColor(MUTED).text(label, PAGE_MARGIN + 4, y + 5, {
      width: labelWidth,
    });
    doc
      .font("body")
      .fontSize(10.5)
      .fillColor(value ? TEXT : "#A6ABBD")
      .text(value || "—", PAGE_MARGIN + labelWidth + 12, y + 5, {
        width: CONTENT_WIDTH - labelWidth - 16,
      });

    const bottom = Math.max(doc.y, y + 22) + 5;
    doc
      .moveTo(PAGE_MARGIN + 4, bottom)
      .lineTo(PAGE_MARGIN + CONTENT_WIDTH - 4, bottom)
      .lineWidth(0.5)
      .strokeColor(BORDER)
      .stroke();
    doc.y = bottom + 4;
  }
}

function signatureBlock(doc: PDFKit.PDFDocument, org: Organization) {
  ensureSpace(doc, 150);
  doc.y += 24;
  const y = doc.y;
  const colWidth = (CONTENT_WIDTH - 40) / 2;

  const column = (x: number, role: string, name: string) => {
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
  };

  column(PAGE_MARGIN, "ผู้กรอกข้อมูล", fullName(org.contactPrefix, org.contactFirstName, org.contactLastName));
  column(
    PAGE_MARGIN + colWidth + 40,
    "ผู้มีอำนาจกระทำการแทน",
    fullName(org.signatoryPrefix, org.signatoryFirstName, org.signatoryLastName),
  );
  doc.y = y + 96;
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
