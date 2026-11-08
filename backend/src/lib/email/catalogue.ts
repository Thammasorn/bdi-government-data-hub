/**
 * รายการเทมเพลตอีเมลทั้งหมดที่ผู้ดูแลระบบแก้ได้ (การ์ด "[New Feature] Admin Email Template Edit", 2026-11-08)
 *
 * **ไฟล์นี้คือสัญญาระหว่างเทมเพลตกับโค้ด** แบบเดียวกับ `TEMPLATE_VARIABLES` ของเอกสารข้อตกลง: แต่ละเทมเพลตบอกว่าใช้ตัวแปรอะไร บล็อกอะไร
 * บล็อกไหนบังคับ และเนื้อหาตั้งต้นคืออะไร การตรวจตอนบันทึก (`validateContent()`) หน้าจอ (`GET /api/admin/email-templates/:key`)
 * และตัวอย่างใน preview อ่านจากที่นี่ที่เดียว การเพิ่ม*ชื่อ*ตัวแปรยังต้องแก้โค้ด เพราะโค้ดที่ส่งอีเมลต้องเติมค่าให้มัน
 *
 * **เนื้อหาตั้งต้น = เวอร์ชัน 1 ของทุกเทมเพลต** คือถ้อยคำเดิมที่เคยเขียนอยู่ใน `mail.ts` ยกมาเป็น HTML ทั้งก้อน deploy แล้วผู้ใช้จึงไม่เห็น
 * อะไรเปลี่ยน เทมเพลตที่ไม่มีแถวในฐานข้อมูลส่งด้วยค่านี้ และเมื่อเวอร์ชันที่ใช้งานอยู่ render ไม่ได้ อีเมลก็ถอยมาใช้ค่านี้เช่นกัน
 *
 * ไม่มีเงื่อนไขในเทมเพลต: อีเมลที่โค้ดเดิมมีสองแบบ (คำเชิญภายนอก/ภายใน, ขอความเห็นชอบมีบัญชี/ต้องลงทะเบียน) แยกเป็นสองเทมเพลต
 * ส่วนค่าที่บางทีว่าง (เบอร์โทร, วันที่ถูกถอด) ระบบประกอบเป็นตัวแปรสำเร็จรูปให้ (`support.contact`, `removed.atPhrase`)
 */
import { CORAL, FONT, MUTED, NAVY, TEXT, WARNING, WARNING_BG } from "./blocks.js";

export const BLOCK_NAMES = ["logo", "button", "orgCode", "steps", "summary", "activation", "otp", "note"] as const;
export type BlockName = (typeof BLOCK_NAMES)[number];

/** คำอธิบายบล็อกบนหน้าจอแก้ — ตรงกับตารางในการ์ด */
export const BLOCK_LABELS: Record<BlockName, string> = {
  logo: "โลโก้ BDI (แนบไปกับอีเมล)",
  button: "ปุ่มพร้อมลิงก์ — ลิงก์มาจากระบบ แก้ได้แค่ข้อความบนปุ่ม",
  orgCode: "บรรทัด \"รหัสหน่วยงาน\" (ไม่แสดงเมื่อคำขอยังไม่มีรหัส)",
  steps: "สถานะคำขอ: ขั้นตอนทั้งหมด อยู่ขั้นไหน ขั้นต่อไป",
  summary: "ตารางสรุป ป้าย: ค่า",
  activation: "กล่อง URL ลงทะเบียน + Activation Key",
  otp: "กล่องรหัส OTP",
  note: "กล่องข้อความของผู้ตรวจสอบ (สิ่งที่ต้องแก้ไข / เหตุผล / ความเห็น)",
};

/** ตัวแปรทั้งหมดที่มีได้ — ค่าตัวอย่างใช้ใน preview และอีเมลทดสอบ (ข้อมูลสมมติ ไม่ใช่ของคนจริง) */
export const VARIABLES = {
  "org.name": { label: "ชื่อหน่วยงาน", sample: "กรมตัวอย่าง" },
  "org.code": { label: "รหัสหน่วยงาน", sample: "ORG-0001" },
  "recipient.name": { label: "ชื่อผู้รับ (ไม่มีชื่อ = \"ผู้ใช้งานระบบ\")", sample: "นาย สมชาย ใจดี" },
  "recipient.greeting": {
    label: "ผู้รับในคำขึ้นต้น — \"ผู้ใช้งาน <หน่วยงาน>\" หรือ \"เจ้าหน้าที่<หน่วยงาน>\" สำหรับเจ้าหน้าที่ BDI",
    sample: "ผู้ใช้งาน กรมตัวอย่าง",
  },
  "account.email": { label: "อีเมลบัญชีของผู้รับ", sample: "somchai@example.go.th" },
  "role.label": { label: "บทบาทในระบบ", sample: "ผู้ประสานงานของหน่วยงาน" },
  "expires.date": { label: "วันหมดอายุ (วันที่)", sample: "15 พฤศจิกายน 2569" },
  "expires.dateTime": { label: "วันเวลาหมดอายุ", sample: "15 พฤศจิกายน 2569 16:30" },
  "activation.validFor": { label: "ระยะเวลาที่ Activation Key ใช้ได้", sample: "7 วัน" },
  "invitation.subject": { label: "หัวเรื่องของอีเมลคำเชิญฉบับที่ผู้รับได้รับจริง", sample: "คำเชิญเข้าใช้งานระบบกลางเพื่อการแบ่งปันข้อมูลดิจิทัล (D2)" },
  "invitation.sentAt": { label: "วันเวลาที่ส่งอีเมลคำเชิญ", sample: "8 พฤศจิกายน 2569 16:30" },
  "otp.code": { label: "รหัส OTP (ใช้ในหัวเรื่องได้)", sample: "482916" },
  "otp.validFor": { label: "ระยะเวลาที่รหัส OTP ใช้ได้", sample: "5 นาที" },
  "request.number": { label: "เลขที่คำขอ", sample: "DS-2569-0001" },
  "dataset.name": { label: "ชื่อชุดข้อมูล", sample: "ข้อมูลสถิติการท่องเที่ยวรายจังหวัด" },
  "submitter.name": { label: "ผู้นำส่งคำขอ", sample: "นาง สมหญิง รักดี" },
  "signer.name": { label: "ผู้ลงนามเห็นชอบ", sample: "นาย ประเสริฐ มั่นคง" },
  "successor.name": { label: "ผู้ที่รับหน้าที่แทน", sample: "นางสาว วิไล ใจงาม" },
  "removed.atPhrase": { label: "วันเวลาที่ถูกถอด เช่น \" เมื่อ 8 พ.ย. 2569 16:30\" (ว่างถ้าไม่ทราบ)", sample: " เมื่อ 8 พฤศจิกายน 2569 16:30" },
  "progress.title": { label: "หัวข้อความคืบหน้า (จากระบบแจ้งเตือน)", sample: "คำขอของคุณเดินหน้าไปอีกขั้น" },
  "progress.message": { label: "ข้อความความคืบหน้า (จากระบบแจ้งเตือน)", sample: "คำขอ ORG-0001 ผ่านการตรวจสอบของผู้ประสานงานของ BDI แล้ว และรอผู้มีอำนาจอนุมัติของหน่วยงาน" },
  "support.contact": { label: "ช่องทางติดต่อ เช่น \"โทรศัพท์ 02-… หรืออีเมล …\" (ไม่มีเบอร์ = อีเมลอย่างเดียว)", sample: "โทรศัพท์ 02-480-8833 หรืออีเมล d2share-support@bdi.or.th" },
  "support.email": { label: "อีเมลฝ่ายสนับสนุน", sample: "d2share-support@bdi.or.th" },
  "app.url": { label: "ที่อยู่เว็บของระบบ", sample: "https://d2.bdi.or.th" },
} as const;
export type VariableName = keyof typeof VARIABLES;

/** ตัวแปรที่ทุกเทมเพลตใช้ได้ — ระบบเติมให้เองทุกฉบับ */
export const GLOBAL_VARIABLES: VariableName[] = ["support.contact", "support.email", "app.url"];

export type TemplateGroup = "layout" | "account" | "organization" | "dataset" | "general";
export const GROUP_LABELS: Record<TemplateGroup, string> = {
  layout: "แม่แบบกลาง",
  account: "บัญชีผู้ใช้",
  organization: "คำขอหน่วยงาน (Journey B)",
  dataset: "คำขอชุดข้อมูล (Journey C)",
  general: "ทั่วไป",
};

export interface TemplateContent {
  subject: string;
  bodyHtml: string;
  buttonLabel: string | null;
  footnoteHtml: string | null;
}

export interface TemplateDefinition {
  key: string;
  group: TemplateGroup;
  label: string;
  /** ส่งเมื่อไร ถึงใคร — แสดงบนหน้าจอ */
  description: string;
  variables: VariableName[];
  blocks: BlockName[];
  /** บล็อกที่ต้องมีในเนื้อหา ไม่งั้นบันทึกไม่ได้ — ลบแล้วผู้รับใช้งานต่อไม่ได้ */
  required: BlockName[];
  /** มีปุ่ม = ช่อง "ข้อความบนปุ่ม" ต้องกรอก */
  hasButton: boolean;
  defaults: TemplateContent;
}

// ------------------------------------------------------------------ ชิ้นส่วนของเนื้อหาตั้งต้น

const H1 = `margin:0 0 12px;font:600 22px/1.4 ${FONT};color:${TEXT};`;
const INTRO = `margin:0;font:400 15px/1.7 ${FONT};color:${MUTED};`;
const P = `margin:0 0 16px;font:400 15px/1.7 ${FONT};color:${MUTED};`;
const strong = (s: string) => `<strong style="color:${TEXT};">${s}</strong>`;
const p = (html: string) => `<p style="${P}">${html}</p>`;
const warningBox = (html: string) =>
  `<div style="background:${WARNING_BG};border-left:3px solid ${WARNING};border-radius:8px;padding:16px;">
  <div style="font:400 14px/1.7 ${FONT};color:${TEXT};">${html}</div>
</div>`;
const greyBox = (html: string) =>
  `<div style="margin-bottom:16px;background:#F6F7FB;border:1px solid #E2E4EC;border-radius:12px;padding:16px;">
  <div style="font:400 14px/1.7 ${FONT};color:${TEXT};">${html}</div>
</div>`;
const letterClosing = (contact: boolean) =>
  `<div style="margin-top:24px;">
<p style="margin:0;font:400 15px/1.7 ${FONT};color:${MUTED};">
${contact ? "หากมีข้อสงสัยหรือประสบปัญหาในการดำเนินการ สามารถติดต่อ{{support.contact}}<br><br>\n" : ""}จึงเรียนมาเพื่อโปรดดำเนินการ<br><br>
ขอแสดงความนับถือ<br>
<span style="color:${TEXT};">สถาบันข้อมูลขนาดใหญ่ (องค์การมหาชน)</span>
</p>
</div>`;

/** เนื้อหาตั้งต้นของอีเมลแจ้งงานทั่วไป: หัวข้อ ย่อหน้าเปิด รหัสหน่วยงาน เนื้อ ขั้นตอน ปุ่ม */
function standardBody(opts: { title: string; intro: string; body?: string; steps?: boolean; button?: boolean; orgCode?: boolean }): string {
  return [
    `<h1 style="${H1}">${opts.title}</h1>`,
    `<p style="${INTRO}">${opts.intro}</p>`,
    opts.orgCode === false ? "" : "{{block.orgCode}}",
    opts.body ? `<div style="margin-top:20px;">\n${opts.body}\n</div>` : "",
    opts.steps === false ? "" : `<div style="margin-top:20px;">{{block.steps}}</div>`,
    opts.button === false ? "" : `<div style="margin-top:28px;">{{block.button}}</div>`,
  ]
    .filter(Boolean)
    .join("\n");
}

const AUTO_NOTE = "อีเมลฉบับนี้ส่งจากระบบอัตโนมัติ กรุณาอย่าตอบกลับอีเมลฉบับนี้";
const CONTACT_NOTE = "หากมีข้อสงสัยหรือประสบปัญหาในการดำเนินการ สามารถติดต่อ{{support.contact}}";
const footnote = (first: string, contact = true) => (contact ? `${first}<br>\n${CONTACT_NOTE}` : first);

const D2 = "ระบบกลางเพื่อการแบ่งปันข้อมูลดิจิทัล (D2)";
const BDI_FULL = "สถาบันข้อมูลขนาดใหญ่ (องค์การมหาชน)";

// ------------------------------------------------------------------ แม่แบบกลาง

/**
 * กรอบที่ห่ออีเมลทุกฉบับ — table layout กับ inline style เพราะ Gmail/Outlook ตัด `<style>` ทิ้ง
 * `{{content}}` คือเนื้อหาของอีเมลฉบับนั้น `{{footnote}}` คือหมายเหตุท้ายอีเมลของฉบับนั้น
 */
const LAYOUT_DEFAULT = `<html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#F6F7FB;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F6F7FB;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="max-width:560px;background:#FFFFFF;border:1px solid #E2E4EC;border-radius:16px;overflow:hidden;">
        <tr><td style="height:4px;background:linear-gradient(90deg,${CORAL},${NAVY});font-size:0;line-height:0;">&nbsp;</td></tr>
        <tr><td style="padding:32px 32px 0;">
          {{block.logo}}
          <div style="margin-top:10px;font:600 14px/1.3 ${FONT};color:${MUTED};">
            ${D2}
          </div>
        </td></tr>
        <tr><td style="padding:24px 32px 0;">
{{content}}
        </td></tr>
        <tr><td style="padding:32px;">
          <div style="border-top:1px solid #E2E4EC;padding-top:16px;font:400 12px/1.6 ${FONT};color:${MUTED};">
            {{footnote}}<br>
            ${BDI_FULL} — Big Data Institute (Public Organization)
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

export const LAYOUT_KEY = "layout";
/** สิ่งที่แม่แบบกลางใช้ได้ — นอกจากตัวแปรกลาง */
export const LAYOUT_PLACEHOLDERS = ["content", "footnote"] as const;

// ------------------------------------------------------------------ เทมเพลตทั้งหมด

const invitationBody = (internal: boolean) =>
  [
    `<h1 style="${H1}">ขอนำส่ง Activation Key สำหรับเข้าใช้งานระบบ</h1>`,
    `<p style="${INTRO}">เรียน ${internal ? "เจ้าหน้าที่{{org.name}}" : "ผู้ใช้งาน {{org.name}}"}</p>`,
    `<div style="margin-top:20px;">`,
    p(
      internal
        ? `ตามที่ท่านได้รับมอบหมายให้ปฏิบัติหน้าที่ใน${D2} นั้น ${BDI_FULL} (สขญ) ขอนำส่ง Activation Key สำหรับใช้ในการลงทะเบียนเข้าใช้งานระบบ`
        : `ตามที่ ${strong("{{org.name}}")} ได้แจ้งความประสงค์ขอเชื่อมโยงระบบสารสนเทศของหน่วยงานกับ${D2} นั้น ${BDI_FULL} (สขญ) ขอนำส่ง Activation Key สำหรับใช้ในการลงทะเบียนเข้าใช้งานระบบ`,
    ),
    `{{block.summary}}`,
    `<div style="margin-top:20px;">{{block.activation}}</div>`,
    `<p style="margin:20px 0 16px;font:400 15px/1.7 ${FONT};color:${MUTED};">ท่านสามารถเริ่มต้นการใช้งานระบบได้จากปุ่มด้านล่าง หรือเปิด URL ข้างต้นแล้วกรอก Activation Key ด้วยตนเอง จากนั้นยืนยันตัวตนด้วย ThaID และกำหนดรหัสผ่านสำหรับระบบ D2</p>`,
    p(
      `ทั้งนี้ ขอให้${internal ? "ท่าน" : "หน่วยงาน"}เก็บรักษา Activation Key ไว้เป็นความลับ และโปรดลงทะเบียนภายใน {{activation.validFor}} — ${strong("Activation Key นี้ใช้ได้ถึงวันที่ {{expires.date}}")}`,
    ),
    warningBox(
      `หากท่านไม่ได้คาดหมายว่าจะได้รับคำเชิญนี้ กรุณาอย่ากดลิงก์และอย่าใช้ Activation Key นี้ และโปรดแจ้ง${BDI_FULL} ที่{{support.contact}}`,
    ),
    `</div>`,
    `<div style="margin-top:28px;">{{block.button}}</div>`,
    letterClosing(true),
  ].join("\n");

export const INVITATION_SUBJECT_DEFAULT = `คำเชิญเข้าใช้งาน${D2}`;

const DATASET_VARS: VariableName[] = ["request.number", "dataset.name", "org.name", "org.code"];
const ORG_VARS: VariableName[] = ["org.name", "org.code"];
const JOURNEY_BLOCKS: BlockName[] = ["orgCode", "steps", "button"];

export const TEMPLATES: TemplateDefinition[] = [
  {
    key: LAYOUT_KEY,
    group: "layout",
    label: "แม่แบบกลาง",
    description:
      "กรอบ HTML ที่ห่ออีเมลทุกฉบับ (หัวจดหมาย โลโก้ ท้ายอีเมล) — ต้องมี {{content}} คือตำแหน่งเนื้อหาของแต่ละฉบับ และ {{footnote}} คือหมายเหตุท้ายอีเมลของฉบับนั้น",
    variables: [],
    blocks: ["logo"],
    required: [],
    hasButton: false,
    defaults: { subject: "", bodyHtml: LAYOUT_DEFAULT, buttonLabel: null, footnoteHtml: null },
  },

  // ---------------------------------------------------------------- บัญชีผู้ใช้
  {
    key: "invitation_external",
    group: "account",
    label: "คำเชิญ (หน่วยงานภายนอก)",
    description: "ส่งพร้อม Activation Key เมื่อเชิญผู้ใช้ของหน่วยงานภายนอก (ผู้ดูแลระบบเชิญ, ผู้มีอำนาจอนุมัติ, คำขอเปลี่ยนผู้แทน)",
    variables: ["org.name", "role.label", "expires.date", "activation.validFor"],
    blocks: ["summary", "activation", "button"],
    required: ["activation"],
    hasButton: true,
    defaults: { subject: INVITATION_SUBJECT_DEFAULT, bodyHtml: invitationBody(false), buttonLabel: "เปิดใช้งานบัญชี", footnoteHtml: AUTO_NOTE },
  },
  {
    key: "invitation_internal",
    group: "account",
    label: "คำเชิญ (เจ้าหน้าที่ BDI)",
    description: "ส่งพร้อม Activation Key เมื่อเชิญเจ้าหน้าที่ของ BDI",
    variables: ["org.name", "role.label", "expires.date", "activation.validFor"],
    blocks: ["summary", "activation", "button"],
    required: ["activation"],
    hasButton: true,
    defaults: { subject: INVITATION_SUBJECT_DEFAULT, bodyHtml: invitationBody(true), buttonLabel: "เปิดใช้งานบัญชี", footnoteHtml: AUTO_NOTE },
  },
  {
    key: "invitation_reminder",
    group: "account",
    label: "เตือนคำเชิญใกล้หมดอายุ",
    description:
      "ส่งครั้งเดียวก่อน Activation Key หมดอายุตามจำนวนวันในตั้งค่าระบบ — ไม่มีลิงก์และไม่มีคีย์ {{invitation.subject}} คือหัวเรื่องของคำเชิญฉบับที่ผู้รับได้รับจริง",
    variables: ["org.name", "recipient.greeting", "role.label", "invitation.subject", "invitation.sentAt", "expires.dateTime"],
    blocks: ["summary"],
    required: [],
    hasButton: false,
    defaults: {
      subject: `Activation Key ของท่านใกล้หมดอายุ — ${D2}`,
      bodyHtml: [
        `<h1 style="${H1}">แจ้งเตือน Activation Key ใกล้หมดอายุ</h1>`,
        `<p style="${INTRO}">เรียน {{recipient.greeting}}</p>`,
        `<div style="margin-top:20px;">`,
        p(
          `ตามที่${BDI_FULL} (สขญ) ได้นำส่ง Activation Key สำหรับใช้ในการลงทะเบียนเข้าใช้งาน${D2} ให้แก่ท่านทางอีเมลนั้น ขณะนี้ท่านยังมิได้ลงทะเบียน และ ${strong("Activation Key ดังกล่าวจะหมดอายุในวันที่ {{expires.dateTime}} น.")}`,
        ),
        `{{block.summary}}`,
        `<p style="margin:20px 0 16px;font:400 15px/1.7 ${FONT};color:${MUTED};">กรุณาค้นหาอีเมลที่มีหัวข้อและวันที่ส่งตามตารางข้างต้นในกล่องจดหมายของท่าน (รวมถึงโฟลเดอร์จดหมายขยะ) แล้วลงทะเบียนตามขั้นตอนในอีเมลฉบับนั้นก่อนวันหมดอายุ</p>`,
        greyBox("อีเมลฉบับนี้เป็นการแจ้งเตือนเท่านั้น จึงไม่มี Activation Key และไม่มีลิงก์สำหรับลงทะเบียน"),
        p(`หากไม่พบอีเมลคำเชิญ หรือ Activation Key หมดอายุแล้ว โปรดติดต่อ${BDI_FULL} ที่{{support.contact}} เพื่อขอ Activation Key ฉบับใหม่`),
        warningBox(`หากท่านไม่ได้คาดหมายว่าจะได้รับคำเชิญนี้ กรุณาเพิกเฉยต่ออีเมลฉบับนี้ และโปรดแจ้ง${BDI_FULL} ตามช่องทางข้างต้น`),
        `</div>`,
        letterClosing(false),
      ].join("\n"),
      buttonLabel: null,
      footnoteHtml: AUTO_NOTE,
    },
  },
  {
    key: "password_reset",
    group: "account",
    label: "ตั้งรหัสผ่านใหม่",
    description: "ผู้ดูแลระบบส่งลิงก์ตั้งรหัสผ่านใหม่ให้ผู้ใช้ — ลิงก์ใช้ได้ครั้งเดียว",
    variables: ["recipient.name", "account.email", "expires.dateTime"],
    blocks: ["button"],
    required: ["button"],
    hasButton: true,
    defaults: {
      subject: `ตั้งรหัสผ่านใหม่ — ${D2}`,
      bodyHtml: standardBody({
        title: "ตั้งรหัสผ่านใหม่สำหรับบัญชีของท่าน",
        intro: "เรียน {{recipient.name}}",
        orgCode: false,
        steps: false,
        body: [
          p(
            `${BDI_FULL} (สขญ) ได้รับแจ้งให้ตั้งรหัสผ่านใหม่สำหรับบัญชี ${strong("{{account.email}}")} ในระบบ D2 กรุณากดปุ่มด้านล่างเพื่อกำหนดรหัสผ่านใหม่ แล้วเข้าสู่ระบบด้วยรหัสผ่านนั้น`,
          ),
          p(`ลิงก์นี้ใช้ได้ครั้งเดียว และ${strong("ใช้ได้ถึง {{expires.dateTime}}")} หากเลยเวลาแล้ว กรุณาติดต่อผู้ประสานงานของ BDI เพื่อขอลิงก์ใหม่`),
          warningBox(
            `หากท่านไม่ได้ติดต่อขอตั้งรหัสผ่านใหม่ กรุณาอย่ากดลิงก์นี้ — รหัสผ่านเดิมของท่านยังใช้ได้ตามปกติ และโปรดแจ้ง${BDI_FULL} ที่{{support.contact}}`,
          ),
        ].join("\n"),
      }),
      buttonLabel: "ตั้งรหัสผ่านใหม่",
      footnoteHtml: footnote(AUTO_NOTE),
    },
  },
  {
    key: "otp",
    group: "account",
    label: "รหัส OTP",
    description: "รหัสยืนยันตัวตนตอนเข้าสู่ระบบ",
    variables: ["otp.code", "otp.validFor"],
    blocks: ["otp"],
    required: ["otp"],
    hasButton: false,
    defaults: {
      subject: `รหัสยืนยันตัวตน {{otp.code}} — ${D2}`,
      bodyHtml: standardBody({
        title: "รหัสยืนยันตัวตน",
        intro: "ใช้รหัสนี้เพื่อยืนยันตัวตนในระบบ:",
        orgCode: false,
        steps: false,
        button: false,
        body: [
          `{{block.otp}}`,
          `<p style="margin:20px 0 0;font:400 15px/1.7 ${FONT};color:${MUTED};">รหัสนี้ใช้ได้ภายใน ${strong("{{otp.validFor}}")}</p>`,
          `<p style="margin:8px 0 0;font:400 15px/1.7 ${FONT};color:${MUTED};">กรุณาอย่าเปิดเผยรหัสนี้แก่ผู้อื่น</p>`,
        ].join("\n"),
      }),
      buttonLabel: null,
      footnoteHtml: footnote("หากคุณไม่ได้เป็นผู้ขอรหัสนี้ คุณสามารถเพิกเฉยต่ออีเมลฉบับนี้ได้"),
    },
  },
  {
    key: "role_removed",
    group: "account",
    label: "ถูกถอดออกจากหน่วยงาน",
    description: "แจ้งคนที่ถูกถอดออกจากหน่วยงานเพราะผู้ดูแลระบบมอบหน้าที่ให้คนอื่นแทน — ไม่มีปุ่ม",
    variables: ["org.name", "role.label", "successor.name", "removed.atPhrase"],
    blocks: [],
    required: [],
    hasButton: false,
    defaults: {
      subject: "บัญชีของคุณถูกถอดออกจาก {{org.name}}",
      bodyHtml: standardBody({
        title: "บัญชีของคุณถูกถอดออกจากหน่วยงาน",
        intro: `ผู้ดูแลระบบได้มอบหน้าที่ ${strong("{{role.label}}")} ของ ${strong("{{org.name}}")} ให้ {{successor.name}} แทนคุณ{{removed.atPhrase}} บัญชีของคุณจึงไม่ได้สังกัดหน่วยงานใดในระบบขณะนี้`,
        orgCode: false,
        steps: false,
        button: false,
        body: `<p style="margin:0;font:400 15px/1.7 ${FONT};color:${MUTED};">ข้อมูลและคำขอทั้งหมดของ {{org.name}} ยังอยู่ครบ เพียงแต่คุณเปิดดูไม่ได้จนกว่าจะได้รับสิทธิ์คืน</p>`,
      }),
      buttonLabel: null,
      footnoteHtml: footnote("หากคิดว่าไม่ถูกต้อง โปรดติดต่อผู้ดูแลระบบ BDI เพื่อขอสิทธิ์ในหน่วยงานเดิมคืน"),
    },
  },

  // ---------------------------------------------------------------- คำขอหน่วยงาน
  {
    key: "org_submitted",
    group: "organization",
    label: "แจ้ง BDI มีคำขอใหม่",
    description: "ถึงผู้ประสานงานของ BDI ทุกคน เมื่อหน่วยงานนำส่งคำขอสร้างหน่วยงาน",
    variables: [...ORG_VARS, "submitter.name"],
    blocks: JOURNEY_BLOCKS,
    required: [],
    hasButton: true,
    defaults: {
      subject: "มีคำขอสร้างหน่วยงานใหม่: {{org.name}}",
      bodyHtml: standardBody({
        title: "มีคำขอสร้างหน่วยงานรอตรวจสอบ",
        intro: `${strong("{{org.name}}")} ยื่นคำขอเข้ามาในระบบ โดย {{submitter.name}}`,
      }),
      buttonLabel: "เปิดดูคำขอ",
      footnoteHtml: footnote(AUTO_NOTE),
    },
  },
  {
    key: "org_revision",
    group: "organization",
    label: "ส่งกลับแก้ไข (หน่วยงาน)",
    description: "ถึงผู้ประสานงานของหน่วยงาน เมื่อคำขอสร้างหน่วยงานถูกส่งกลับให้แก้ไข",
    variables: ORG_VARS,
    blocks: [...JOURNEY_BLOCKS, "note"],
    required: [],
    hasButton: true,
    defaults: {
      subject: "ต้องปรับปรุงข้อมูลหน่วยงาน: {{org.name}}",
      bodyHtml: standardBody({
        title: "คำขอของคุณต้องปรับปรุง",
        intro: `ผู้ตรวจสอบขอให้แก้ไขข้อมูลของ ${strong("{{org.name}}")} ก่อนดำเนินการต่อ`,
        body: "{{block.note}}",
      }),
      buttonLabel: "แก้ไขข้อมูล",
      footnoteHtml: footnote(AUTO_NOTE),
    },
  },
  {
    key: "org_signatory_request",
    group: "organization",
    label: "ขอความเห็นชอบ (มีบัญชีแล้ว)",
    description: "ถึงผู้มีอำนาจอนุมัติของหน่วยงานที่มีบัญชีแล้ว เมื่อคำขอผ่านการตรวจสอบของผู้ประสานงานของ BDI",
    variables: ORG_VARS,
    blocks: JOURNEY_BLOCKS,
    required: [],
    hasButton: true,
    defaults: {
      subject: "ขอความเห็นชอบการสร้างหน่วยงาน: {{org.name}}",
      bodyHtml: standardBody({
        title: "ขอความเห็นชอบในฐานะผู้มีอำนาจอนุมัติของหน่วยงาน",
        intro: `${strong("{{org.name}}")} ระบุว่าคุณเป็นผู้มีอำนาจอนุมัติของหน่วยงาน และคำขอผ่านการตรวจสอบจากผู้ประสานงานของ BDI แล้ว`,
      }),
      buttonLabel: "ตรวจสอบเอกสาร",
      footnoteHtml: footnote(AUTO_NOTE),
    },
  },
  {
    key: "org_signatory_register",
    group: "organization",
    label: "ขอความเห็นชอบ (ต้องลงทะเบียนก่อน)",
    description: "ถึงผู้มีอำนาจอนุมัติของหน่วยงานที่ยังไม่มีบัญชี — ปุ่มพาไปลงทะเบียนก่อนตรวจสอบ",
    variables: ORG_VARS,
    blocks: JOURNEY_BLOCKS,
    required: ["button"],
    hasButton: true,
    defaults: {
      subject: "ขอความเห็นชอบการสร้างหน่วยงาน: {{org.name}}",
      bodyHtml: standardBody({
        title: "ขอความเห็นชอบในฐานะผู้มีอำนาจอนุมัติของหน่วยงาน",
        intro: `${strong("{{org.name}}")} ระบุว่าคุณเป็นผู้มีอำนาจอนุมัติของหน่วยงาน และคำขอผ่านการตรวจสอบจากผู้ประสานงานของ BDI แล้ว`,
        body: `<p style="margin:0;font:400 15px/1.7 ${FONT};color:${MUTED};">คุณยังไม่มีบัญชีในระบบ กรุณาลงทะเบียนเพื่อตรวจสอบเอกสารและให้ความเห็นชอบ</p>`,
      }),
      buttonLabel: "ลงทะเบียนและตรวจสอบ",
      footnoteHtml: footnote(AUTO_NOTE),
    },
  },
  {
    key: "org_final_approval",
    group: "organization",
    label: "รอลงนาม (หน่วยงาน)",
    description: "ถึงผู้อนุมัติของ BDI ทุกคน เมื่อผู้มีอำนาจอนุมัติของหน่วยงานให้ความเห็นชอบแล้ว",
    variables: ORG_VARS,
    blocks: JOURNEY_BLOCKS,
    required: [],
    hasButton: true,
    defaults: {
      subject: "รอลงนาม: {{org.name}}",
      bodyHtml: standardBody({
        title: "มีคำขอรอการลงนาม",
        intro: `ผู้มีอำนาจอนุมัติของ ${strong("{{org.name}}")} ให้ความเห็นชอบแล้ว`,
      }),
      buttonLabel: "ตรวจสอบและลงนาม",
      footnoteHtml: footnote(AUTO_NOTE),
    },
  },
  {
    key: "org_activated",
    group: "organization",
    label: "หน่วยงานเปิดใช้งานแล้ว",
    description: "ถึงผู้ประสานงานและผู้มีอำนาจอนุมัติของหน่วยงาน เมื่อคำขอผ่านการอนุมัติครบทุกขั้นตอน",
    variables: ORG_VARS,
    blocks: JOURNEY_BLOCKS,
    required: [],
    hasButton: true,
    defaults: {
      subject: "หน่วยงาน {{org.name}} เปิดใช้งานแล้ว",
      bodyHtml: standardBody({
        title: "หน่วยงานของคุณเปิดใช้งานแล้ว",
        intro: `${strong("{{org.name}}")} ผ่านการอนุมัติครบทุกขั้นตอนและพร้อมใช้งานบนแพลตฟอร์มแล้ว`,
      }),
      buttonLabel: "เข้าสู่ระบบ",
      footnoteHtml: footnote(AUTO_NOTE),
    },
  },

  // ---------------------------------------------------------------- คำขอชุดข้อมูล
  {
    key: "dataset_submitted",
    group: "dataset",
    label: "นำส่งคำขอชุดข้อมูล",
    description: "ถึงผู้ประสานงานของ BDI ทุกคน เมื่อหน่วยงานนำส่งคำขอลงทะเบียนชุดข้อมูล",
    variables: [...DATASET_VARS, "submitter.name"],
    blocks: [...JOURNEY_BLOCKS, "summary"],
    required: [],
    hasButton: true,
    defaults: {
      subject: "[{{request.number}}] มีคำขอลงทะเบียนชุดข้อมูลรอตรวจสอบ: {{dataset.name}}",
      bodyHtml: standardBody({
        title: "มีคำขอลงทะเบียนชุดข้อมูลรอตรวจสอบ",
        intro: `${strong("{{org.name}}")} นำส่งคำขอลงทะเบียนชุดข้อมูลเข้ามาในระบบ`,
        body: "{{block.summary}}",
      }),
      buttonLabel: "เปิดดูคำขอ",
      footnoteHtml: footnote(AUTO_NOTE),
    },
  },
  {
    key: "dataset_revision",
    group: "dataset",
    label: "ส่งกลับแก้ไข (ชุดข้อมูล)",
    description: "ถึงผู้ใช้ของหน่วยงาน เมื่อคำขอชุดข้อมูลถูกส่งกลับให้แก้ไข",
    variables: DATASET_VARS,
    blocks: [...JOURNEY_BLOCKS, "note"],
    required: [],
    hasButton: true,
    defaults: {
      subject: "[{{request.number}}] ต้องปรับปรุงคำขอลงทะเบียนชุดข้อมูล: {{dataset.name}}",
      bodyHtml: standardBody({
        title: "คำขอของคุณต้องปรับปรุง",
        intro: `ผู้ตรวจสอบขอให้แก้ไขคำขอ ${strong("{{dataset.name}}")} ก่อนดำเนินการต่อ`,
        body: "{{block.note}}",
      }),
      buttonLabel: "แก้ไขคำขอ",
      footnoteHtml: footnote(AUTO_NOTE),
    },
  },
  {
    key: "dataset_specialist_assigned",
    group: "dataset",
    label: "มอบหมายผู้เชี่ยวชาญ",
    description: "ถึงผู้เชี่ยวชาญด้านข้อมูล เมื่อผู้ประสานงานของ BDI ขอความเห็น",
    variables: DATASET_VARS,
    blocks: [...JOURNEY_BLOCKS, "summary"],
    required: [],
    hasButton: true,
    defaults: {
      subject: "[{{request.number}}] ขอความเห็นต่อชุดข้อมูล: {{dataset.name}}",
      bodyHtml: standardBody({
        title: "ผู้ประสานงานของ BDI ขอความเห็นของคุณ",
        intro:
          "ผู้ประสานงานของ BDI ขอความเห็นของคุณต่อคำขอนี้ในฐานะผู้เชี่ยวชาญด้านข้อมูล คุณเปิดดูรายละเอียดและบันทึกความเห็นไว้ให้ผู้ประสานงานของ BDI ได้ — การตัดสินผ่านหรือส่งกลับ ยังเป็นของผู้ประสานงานของ BDI ตามเดิม",
        body: "{{block.summary}}",
      }),
      buttonLabel: "เปิดดูคำขอ",
      footnoteHtml: footnote(AUTO_NOTE),
    },
  },
  {
    key: "dataset_specialist_commented",
    group: "dataset",
    label: "ผู้เชี่ยวชาญให้ความเห็น",
    description: "ถึงผู้ประสานงานของ BDI เมื่อผู้เชี่ยวชาญด้านข้อมูลบันทึกความเห็น",
    variables: DATASET_VARS,
    blocks: [...JOURNEY_BLOCKS, "note", "summary"],
    required: [],
    hasButton: true,
    defaults: {
      subject: "[{{request.number}}] ผู้เชี่ยวชาญให้ความเห็นต่อชุดข้อมูล: {{dataset.name}}",
      bodyHtml: standardBody({
        title: "ผู้เชี่ยวชาญให้ความเห็นกลับมาแล้ว",
        intro: `ผู้เชี่ยวชาญด้านข้อมูลบันทึกความเห็นต่อคำขอ ${strong("{{dataset.name}}")} ไว้ให้ประกอบการตัดสินใจแล้ว คำขอยังอยู่ที่ขั้นตรวจสอบของผู้ประสานงานของ BDI ตามเดิม`,
        body: "{{block.note}}\n{{block.summary}}",
      }),
      buttonLabel: "เปิดดูคำขอ",
      footnoteHtml: footnote(AUTO_NOTE),
    },
  },
  {
    key: "dataset_pending_org_approver",
    group: "dataset",
    label: "รอผู้มีอำนาจลงนาม (ชุดข้อมูล)",
    description: "ถึงผู้มีอำนาจอนุมัติของหน่วยงาน เมื่อคำขอชุดข้อมูลผ่านการตรวจสอบของผู้ประสานงานของ BDI",
    variables: DATASET_VARS,
    blocks: [...JOURNEY_BLOCKS, "summary"],
    required: [],
    hasButton: true,
    defaults: {
      subject: "[{{request.number}}] ขอความเห็นชอบชุดข้อมูล: {{dataset.name}}",
      bodyHtml: standardBody({
        title: "ขอความเห็นชอบในฐานะผู้มีอำนาจอนุมัติของหน่วยงาน",
        intro: `คำขอลงทะเบียนชุดข้อมูลของ ${strong("{{org.name}}")} ผ่านการตรวจสอบเบื้องต้นจากผู้ประสานงานของ BDI แล้ว`,
        body: "{{block.summary}}",
      }),
      buttonLabel: "ตรวจสอบและลงนาม",
      footnoteHtml: footnote(AUTO_NOTE),
    },
  },
  {
    key: "dataset_signed_pending",
    group: "dataset",
    label: "ลงนามแล้วรอ BDI",
    description: "ถึงผู้ประสานงานของ BDI เมื่อผู้มีอำนาจของหน่วยงานลงนามเห็นชอบคำขอชุดข้อมูล",
    variables: [...DATASET_VARS, "signer.name"],
    blocks: [...JOURNEY_BLOCKS, "summary"],
    required: [],
    hasButton: true,
    defaults: {
      subject: "[{{request.number}}] รอการพิจารณาชุดข้อมูล: {{dataset.name}}",
      bodyHtml: standardBody({
        title: "มีคำขอลงทะเบียนชุดข้อมูลรอการพิจารณา",
        intro: `ผู้มีอำนาจของ ${strong("{{org.name}}")} ได้ลงนามเห็นชอบคำขอลงทะเบียนชุดข้อมูลแล้ว และคำขออยู่ระหว่างรอการพิจารณาจาก BDI`,
        body: "{{block.summary}}",
      }),
      buttonLabel: "ตรวจสอบคำขอ",
      footnoteHtml: footnote(AUTO_NOTE),
    },
  },
  {
    key: "dataset_pending_bdi",
    group: "dataset",
    label: "รอ BDI พิจารณา",
    description: "ถึงผู้อนุมัติของ BDI เมื่อคำขอชุดข้อมูลผ่านการตรวจสอบและการลงนามของหน่วยงานครบแล้ว",
    variables: DATASET_VARS,
    blocks: [...JOURNEY_BLOCKS, "summary"],
    required: [],
    hasButton: true,
    defaults: {
      subject: "[{{request.number}}] รอการพิจารณาชุดข้อมูล: {{dataset.name}}",
      bodyHtml: standardBody({
        title: "มีคำขอลงทะเบียนชุดข้อมูลรอการพิจารณา",
        intro: "คำขอลงทะเบียนชุดข้อมูลผ่านการตรวจสอบและการลงนามเห็นชอบของหน่วยงานครบแล้ว และอยู่ระหว่างรอการพิจารณาจาก BDI",
        body: "{{block.summary}}",
      }),
      buttonLabel: "ตรวจสอบคำขอ",
      footnoteHtml: footnote(AUTO_NOTE),
    },
  },
  {
    key: "dataset_approved",
    group: "dataset",
    label: "อนุมัติชุดข้อมูล",
    description: "ถึงผู้ใช้ของหน่วยงาน เมื่อคำขอชุดข้อมูลผ่านการอนุมัติครบทุกขั้นตอน",
    variables: DATASET_VARS,
    blocks: [...JOURNEY_BLOCKS, "summary"],
    required: [],
    hasButton: true,
    defaults: {
      subject: "[{{request.number}}] อนุมัติชุดข้อมูลแล้ว: {{dataset.name}}",
      bodyHtml: standardBody({
        title: "ชุดข้อมูลได้รับอนุมัติแล้ว",
        intro: `คำขอลงทะเบียนชุดข้อมูล ${strong("{{dataset.name}}")} ผ่านการอนุมัติครบทุกขั้นตอนแล้ว`,
        body: "{{block.summary}}",
      }),
      buttonLabel: "เปิดดูและดาวน์โหลดเอกสาร",
      footnoteHtml: footnote(AUTO_NOTE),
    },
  },
  {
    key: "dataset_rejected",
    group: "dataset",
    label: "ไม่อนุมัติชุดข้อมูล",
    description: "ถึงผู้ใช้ของหน่วยงาน เมื่อคำขอชุดข้อมูลไม่ได้รับอนุมัติ",
    variables: DATASET_VARS,
    blocks: [...JOURNEY_BLOCKS, "note"],
    required: [],
    hasButton: true,
    defaults: {
      subject: "[{{request.number}}] ไม่อนุมัติชุดข้อมูล: {{dataset.name}}",
      bodyHtml: standardBody({
        title: "คำขอลงทะเบียนชุดข้อมูลไม่ได้รับอนุมัติ",
        intro: `คำขอ ${strong("{{dataset.name}}")} สิ้นสุดกระบวนการโดยไม่ได้รับอนุมัติ`,
        body: "{{block.note}}",
      }),
      buttonLabel: "เปิดดูรายละเอียด",
      footnoteHtml: footnote("หากต้องการยื่นใหม่ กรุณาสร้างคำขอฉบับใหม่และแก้ไขตามเหตุผลข้างต้น"),
    },
  },

  // ---------------------------------------------------------------- ทั่วไป
  {
    key: "request_progressed",
    group: "general",
    label: "แจ้งความคืบหน้าคำขอ",
    description:
      "ถึงฝั่งหน่วยงาน เมื่อคำขอเดินหน้าไปอีกขั้น — หัวข้อกับข้อความมาจากระบบแจ้งเตือน ({{progress.title}}, {{progress.message}})",
    variables: ["progress.title", "progress.message", "org.code"],
    blocks: JOURNEY_BLOCKS,
    required: [],
    hasButton: true,
    defaults: {
      subject: "{{progress.title}}",
      bodyHtml: standardBody({ title: "{{progress.title}}", intro: "{{progress.message}}" }),
      buttonLabel: "เปิดดูคำขอ",
      footnoteHtml: footnote("อีเมลฉบับนี้แจ้งความคืบหน้าเท่านั้น ยังไม่มีสิ่งที่คุณต้องดำเนินการ"),
    },
  },
];

export const TEMPLATE_BY_KEY = new Map(TEMPLATES.map((t) => [t.key, t]));
export const EMAIL_TEMPLATE_KEYS = TEMPLATES.map((t) => t.key);
export type EmailTemplateKey = string;

export function templateDefinition(key: string): TemplateDefinition | undefined {
  return TEMPLATE_BY_KEY.get(key);
}

/** ตัวแปรที่เทมเพลตหนึ่งใช้ได้จริง — ของตัวเอง + ตัวแปรกลาง */
export function allowedVariables(def: TemplateDefinition): VariableName[] {
  return [...new Set([...def.variables, ...GLOBAL_VARIABLES])];
}
