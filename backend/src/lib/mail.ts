import { readFileSync } from "node:fs";

import nodemailer, { type Transporter } from "nodemailer";

import { env } from "../env.js";
import type { JourneyProgress } from "./journey-steps.js";

/**
 * โลโก้ต้องแนบไปกับอีเมลแต่ละฉบับแล้วอ้างด้วย cid: ไม่ใช่ลิงก์ไปที่เว็บ
 * เพราะเมลไคลเอนต์ส่วนใหญ่บล็อกรูปจากภายนอกจนกว่าผู้รับจะกดอนุญาต
 *
 * อ่านไฟล์ครั้งเดียวตอนโหลดโมดูล ถ้าอ่านไม่ได้ (เช่น build ลืม copy src/assets)
 * จะถอยไปใช้หัวจดหมายแบบตัวอักษรแทน — ดีกว่าให้อีเมลทั้งระบบส่งไม่ออกเพราะรูปใบเดียว
 */
const LOGO_CID = "bdi-logo";
const logo = ((): Buffer | null => {
  try {
    return readFileSync(new URL("../assets/brand/bdi-logo.png", import.meta.url));
  } catch (err) {
    console.warn("[mail] อ่านไฟล์โลโก้ไม่ได้ จะใช้หัวจดหมายแบบตัวอักษรแทน", err);
    return null;
  }
})();

const NAVY = "#192768";
const CORAL = "#E5775A";
const TEXT = "#141A33";
const MUTED = "#5B6178";
const BORDER = "#E2E4EC";
/** โทนคำเตือน — ค่าเดียวกับ --color-warning / --color-warning-bg ใน globals.css */
const WARNING = "#B26A00";
const WARNING_BG = "#FFF3E0";

/**
 * ช่องทางติดต่อที่ท้ายอีเมลบอกไว้
 *
 * เบอร์โทรปล่อยว่างได้ และเมื่อว่าง **ทุกที่ที่พิมพ์มันต้องหายไปทั้งวรรค** ไม่ใช่พิมพ์
 * "ติดต่อโทรศัพท์  หรืออีเมล …" ทิ้งช่องโหว่ไว้ให้ผู้รับอ่าน
 */
const SUPPORT_EMAIL = env.support.email;
const SUPPORT_PHONE = env.support.phone;
const contactLine = (lead: string) =>
  SUPPORT_PHONE
    ? `${lead}โทรศัพท์ ${escapeHtml(SUPPORT_PHONE)} หรืออีเมล ${SUPPORT_EMAIL}`
    : `${lead}อีเมล ${SUPPORT_EMAIL}`;

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (!env.smtp.enabled) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.smtp.host,
      port: env.smtp.port,
      secure: env.smtp.secure,
      auth: { user: env.smtp.user, pass: env.smtp.pass },
    });
  }
  return transporter;
}

/**
 * หน่วยงานที่อีเมลฉบับหนึ่งพูดถึง — ชื่อกับรหัสเดินทางด้วยกันเสมอ
 *
 * แยกเป็นชนิดเดียวเพราะทุกฉบับของ Journey B ต้องพิมพ์ทั้งคู่ ถ้าปล่อยเป็นพารามิเตอร์
 * `orgName` เดี่ยว ๆ เหมือนเดิม การเพิ่มรหัสจะกลายเป็นการเติมอาร์กิวเมนต์ที่ห้าให้ทุกฟังก์ชัน
 * และที่เรียกใช้ลืมได้ทีละที่ · `code` เป็น null ได้จริง — คำขอที่ยังไม่ได้ออกรหัสให้
 */
export interface OrgIdentity {
  name: string;
  /** รหัสหน่วยงาน — null ได้ ถ้าคำขอใบนั้นยังไม่มีรหัส */
  code: string | null;
}

interface Button {
  label: string;
  url: string;
  /**
   * ลิงก์ที่พิมพ์ให้ตาเห็นใต้ปุ่ม เผื่อปุ่มกดไม่ได้
   *
   * ไม่ส่งมา = ใช้ `url` เหมือนเดิม · ส่ง `null` = ไม่ต้องพิมพ์บล็อกนี้เลย ซึ่งอีเมลคำเชิญ
   * ใช้ เพราะที่อยู่สำหรับลงทะเบียนกับ Activation Key ถูกพิมพ์แยกกันไว้ในเนื้อความแล้ว
   * และลิงก์ของมันมี token ต่อท้าย — ยาว อ่านไม่รู้เรื่อง และติดไปกับภาพที่ผู้รับแคปหน้าจอ
   */
  fallback?: string | null;
}

/**
 * เทมเพลตกลางตาม CI ของ BDI
 * ใช้ table layout กับ inline style เพราะ Gmail/Outlook ตัด <style> ทิ้ง
 */
function layout(opts: {
  title: string;
  intro: string;
  /**
   * รหัสหน่วยงานที่เรื่องนี้เกี่ยวข้อง — พิมพ์ใต้ย่อหน้าเปิดเสมอ ไม่ว่าจะเป็นอีเมลฉบับไหน
   *
   * อยู่ที่ layout ไม่ใช่ที่ template แต่ละฉบับ เพื่อให้ตำแหน่งบนหน้าจดหมายเป็นที่เดียวกันหมด
   * ผู้รับที่ดูแลหลายหน่วยงาน (เจ้าหน้าที่ BDI ทุกคน) จึงกวาดตาหาที่เดิมได้โดยไม่ต้องอ่านทั้งฉบับ
   */
  orgCode?: string | null;
  body?: string;
  /** บล็อกขั้นตอนจาก stepsBlock() — วางใต้ body และเหนือปุ่มเสมอ */
  steps?: string;
  button?: Button;
  /**
   * ข้อความที่ต้องอยู่ **ใต้ปุ่ม** — คำลงท้ายของหนังสือนำส่ง
   *
   * อีเมลคำเชิญเขียนเป็นหนังสือราชการ คำลงท้าย ("จึงเรียนมาเพื่อโปรดดำเนินการ /
   * ขอแสดงความนับถือ") จึงต้องปิดท้ายจดหมายจริง ๆ ถ้าวางไว้ใน `body` ปุ่มจะไปโผล่
   * ใต้ลายเซ็น ซึ่งอ่านแล้วเหมือนจดหมายจบไปแล้วแต่ยังมีของต่อท้าย
   */
  closing?: string;
  /**
   * บรรทัดหมายเหตุบรรทัดแรกของท้ายอีเมล — แทนที่ "ส่งจากระบบอัตโนมัติ กรุณาอย่าตอบกลับ"
   *
   * **ไม่ใช่ที่อยู่ของช่องทางติดต่อ** ช่องทางติดต่อพิมพ์ต่อจากบรรทัดนี้เสมอ ตอนที่ทั้งสองอย่าง
   * ยังรวมกันอยู่ อีเมลทุกฉบับที่ส่ง footnote ของตัวเองมา (OTP, ถอดสิทธิ์, คำขอไม่ผ่าน,
   * แจ้งความคืบหน้า) จึงไม่มีช่องทางติดต่อเลยสักช่องทางเดียว
   */
  footnote?: string;
  /**
   * พิมพ์ช่องทางติดต่อที่ท้ายอีเมลหรือไม่ — ปิดเฉพาะฉบับที่พิมพ์ไว้ในเนื้อจดหมายแล้ว
   *
   * อีเมลคำเชิญเขียนเป็นหนังสือนำส่ง ช่องทางติดต่อจึงอยู่เหนือคำลงท้ายตามรูปแบบหนังสือ
   * ถ้าท้ายอีเมลพิมพ์ซ้ำอีกที ผู้รับจะเห็นเบอร์กับอีเมลชุดเดิมสองรอบห่างกันไม่กี่บรรทัด
   */
  contact?: boolean;
}): string {
  const {
    title,
    intro,
    orgCode,
    body = "",
    steps = "",
    button,
    closing,
    footnote,
    contact = true,
  } = opts;
  return `<!doctype html>
<html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#F6F7FB;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F6F7FB;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="max-width:560px;background:#FFFFFF;border:1px solid ${BORDER};border-radius:16px;overflow:hidden;">
        <tr><td style="height:4px;background:linear-gradient(90deg,${CORAL},${NAVY});font-size:0;line-height:0;">&nbsp;</td></tr>
        <tr><td style="padding:32px 32px 0;">
          ${
            logo
              ? `<img src="cid:${LOGO_CID}" width="88" height="64" alt="สถาบันข้อมูลขนาดใหญ่ (องค์การมหาชน)"
                      style="display:block;border:0;outline:none;text-decoration:none;">`
              : `<div style="font:700 20px/1.3 'Helvetica Neue',Arial,sans-serif;color:${NAVY};letter-spacing:-0.01em;">
                   BDI<span style="color:${CORAL};">.</span>
                 </div>`
          }
          <div style="margin-top:10px;font:600 14px/1.3 'Helvetica Neue',Arial,sans-serif;color:${MUTED};">
            ระบบกลางเพื่อการแบ่งปันข้อมูลดิจิทัล (D2)
          </div>
        </td></tr>
        <tr><td style="padding:24px 32px 0;">
          <h1 style="margin:0 0 12px;font:600 22px/1.4 'Helvetica Neue',Arial,sans-serif;color:${TEXT};">${title}</h1>
          <p style="margin:0;font:400 15px/1.7 'Helvetica Neue',Arial,sans-serif;color:${MUTED};">${intro}</p>
          ${orgCodeLine(orgCode)}
        </td></tr>
        ${body ? `<tr><td style="padding:20px 32px 0;">${body}</td></tr>` : ""}
        ${steps ? `<tr><td style="padding:20px 32px 0;">${steps}</td></tr>` : ""}
        ${
          button
            ? `<tr><td style="padding:28px 32px 0;">
                 <a href="${button.url}"
                    style="display:inline-block;background:${CORAL};color:#FFFFFF;text-decoration:none;
                           font:600 15px/1 'Helvetica Neue',Arial,sans-serif;padding:15px 28px;border-radius:999px;">
                   ${button.label}
                 </a>
                 ${
                   button.fallback === null
                     ? ""
                     : `<p style="margin:16px 0 0;font:400 12px/1.6 'Helvetica Neue',Arial,sans-serif;color:${MUTED};word-break:break-all;">
                   หากปุ่มด้านบนไม่ทำงาน กรุณาคัดลอกลิงก์ต่อไปนี้และเปิดในเบราว์เซอร์ของคุณ:<br>
                   <span style="color:${NAVY};">${button.fallback ?? button.url}</span>
                 </p>`
                 }
               </td></tr>`
            : ""
        }
        ${closing ? `<tr><td style="padding:24px 32px 0;">${closing}</td></tr>` : ""}
        <tr><td style="padding:32px;">
          <div style="border-top:1px solid ${BORDER};padding-top:16px;
                      font:400 12px/1.6 'Helvetica Neue',Arial,sans-serif;color:${MUTED};">
            ${footnote ?? "อีเมลฉบับนี้ส่งจากระบบอัตโนมัติ กรุณาอย่าตอบกลับอีเมลฉบับนี้"}<br>
            ${contact ? `${contactLine("หากมีข้อสงสัยหรือประสบปัญหาในการดำเนินการ สามารถติดต่อ")}<br>` : ""}
            สถาบันข้อมูลขนาดใหญ่ (องค์การมหาชน) — Big Data Institute (Public Organization)
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

/**
 * บรรทัด "รหัสหน่วยงาน" ใต้ย่อหน้าเปิด
 *
 * คืนสตริงว่างเมื่อไม่มีรหัส — ป้ายเปล่า ๆ ที่ตามด้วยความว่างอ่านเหมือนระบบทำข้อมูลหาย
 * ส่วนอีเมลที่ไม่ได้พูดถึงหน่วยงานใดเลย (OTP, สิ่งที่ตกมาที่ sendRaw) ไม่ส่งค่านี้มาตั้งแต่แรก
 */
function orgCodeLine(code: string | null | undefined): string {
  if (!code) return "";
  return `<p style="margin:10px 0 0;font:400 13px/1.6 'Helvetica Neue',Arial,sans-serif;color:${MUTED};">
            รหัสหน่วยงาน <strong style="color:${TEXT};">${escapeHtml(code)}</strong>
          </p>`;
}

async function send(to: string, subject: string, html: string): Promise<void> {
  const tx = getTransporter();
  if (!tx) {
    // ยังไม่ตั้งค่า SMTP — พิมพ์ลง log เพื่อให้ทดสอบ flow ได้โดยไม่ต้องมีเมลจริง
    console.log(`\n[mail:dry-run] ถึง: ${to}\n[mail:dry-run] เรื่อง: ${subject}`);
    const link = /href="([^"]+)"/.exec(html)?.[1];
    if (link) console.log(`[mail:dry-run] ลิงก์: ${link}`);
    const otp = /letter-spacing:8px[^>]*>(\d{6})</.exec(html)?.[1];
    if (otp) console.log(`[mail:dry-run] รหัส OTP: ${otp}`);
    console.log("");
    return;
  }
  await tx.sendMail({
    from: env.smtp.from,
    to,
    subject,
    html,
    attachments: logo
      ? [{ filename: "bdi-logo.png", content: logo, cid: LOGO_CID, contentType: "image/png" }]
      : [],
  });
}

/**
 * บล็อก "ขั้นตอนทั้งหมด" ท้ายอีเมล
 *
 * ผู้รับอีเมลส่วนใหญ่ไม่ได้เปิดหน้าจอตาม จึงต้องเห็นตรงนี้ว่าคำขอมีทั้งหมดกี่ขั้น
 * อยู่ขั้นไหน และหลังจากนี้ใครทำอะไร — ข้อมูลชุดเดียวกับ stepper บนหน้าจอ
 *
 * เป็นตารางกับ inline style ล้วน: Gmail และ Outlook ตัด `<style>` ทิ้ง และรองรับ
 * flex/grid ไม่ได้ เครื่องหมายใช้ตัวอักษรธรรมดา ไม่ใช่อิโมจิ เพราะไคลเอนต์บางตัว
 * เรนเดอร์อิโมจิเป็นบิตแมปสีที่สูงกว่าบรรทัด
 */
export function stepsBlock(progress: JourneyProgress | null | undefined): string {
  if (!progress || progress.steps.length === 0) return "";

  /**
   * หัวบล็อกบอกทั้งตำแหน่งและสิ่งที่คำขอกำลังรออยู่ — "ขั้นตอนที่ 4 จาก 4" ลอย ๆ
   * ตอบได้แค่ว่าเดินมาไกลแค่ไหน ไม่ได้ตอบว่าตอนนี้ค้างอยู่ที่ใคร
   */
  const heading =
    progress.currentOrder && progress.currentStep
      ? `ขั้นตอนที่ ${progress.currentOrder} จาก ${progress.totalSteps} — ${escapeHtml(progress.currentStep.shortLabel)}`
      : `กระบวนการนี้มีทั้งหมด ${progress.totalSteps} ขั้นตอน`;

  const rows = progress.steps
    .map((step) => {
      const mark =
        step.state === "DONE"
          ? { glyph: "&#10003;", color: "#1B7F5A" }
          : step.state === "REJECTED"
            ? { glyph: "&#10007;", color: "#B3261E" }
            : step.state === "CURRENT"
              ? { glyph: "&#9654;", color: CORAL }
              : { glyph: "&#9675;", color: MUTED };
      const emphasis = step.state === "CURRENT" ? 600 : 400;
      const color = step.state === "UPCOMING" ? MUTED : TEXT;
      const number = step.order ? `${step.order}. ` : "";
      const suffix = step.optional ? " (เมื่อเจ้าหน้าที่มอบหมาย)" : "";
      // ขั้นที่ยังไม่เกิดขึ้นต้องอ่านว่า "รอ" — เดิมทุกขั้นเขียน "โดย…" เหมือนกันหมด
      // ขั้นที่คำขอค้างอยู่จึงอ่านเหมือนทำไปแล้ว
      const doer = step.state === "CURRENT" ? "รอดำเนินการโดย" : "ดำเนินการโดย";

      return `<tr>
        <td width="24" valign="top" style="padding:6px 0;font:600 14px/1.6 'Helvetica Neue',Arial,sans-serif;color:${mark.color};">${mark.glyph}</td>
        <td valign="top" style="padding:6px 0;font:${emphasis} 14px/1.6 'Helvetica Neue',Arial,sans-serif;color:${color};">
          ${number}${escapeHtml(step.label)}${suffix}
          <div style="font:400 12px/1.6 'Helvetica Neue',Arial,sans-serif;color:${MUTED};">${doer}${escapeHtml(step.roleLabel)}</div>
        </td>
      </tr>`;
    })
    .join("");

  const next = progress.nextStep
    ? `<div style="margin-top:12px;font:400 13px/1.6 'Helvetica Neue',Arial,sans-serif;color:${MUTED};">
         ขั้นต่อไป: <span style="color:${TEXT};">${escapeHtml(progress.nextStep.label)}</span>
       </div>`
    : "";

  return `<div style="font:600 16px/1.4 'Helvetica Neue',Arial,sans-serif;color:${TEXT};margin-bottom:12px;">สถานะคำขอ</div>
  <div style="border:1px solid ${BORDER};border-radius:12px;padding:16px;">
    <div style="font:600 13px/1.5 'Helvetica Neue',Arial,sans-serif;color:${NAVY};margin-bottom:12px;">${heading}</div>
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">${rows}</table>
    ${next}
  </div>`;
}

/**
 * ส่งอีเมลจากแถวใน notification outbox
 *
 * delivery worker เรียกตัวนี้ — มันมีแค่ title กับ message ของ notification
 * ไม่ได้ถือ template ของแต่ละเหตุการณ์ จึงห่อด้วย layout กลางให้หน้าตาเหมือนฉบับอื่น
 * ไม่รับ HTML จากผู้เรียก เพราะข้อความมาจากฐานข้อมูล ต้อง escape ก่อนเสมอ
 */
export async function sendRaw(to: string, title: string, message: string): Promise<void> {
  await send(to, title, layout({ title, intro: escapeHtml(message) }));
}

/**
 * ตารางสรุป "ป้าย: ค่า" — ใช้ยกข้อมูลที่ผู้อ่านต้องเห็นออกมาจากย่อหน้า
 *
 * เกิดมาเพื่ออีเมลของ Journey C แต่ไม่มีอะไรเป็นเรื่องชุดข้อมูลอยู่ในนี้เลย อีเมลคำเชิญ
 * ใช้ตัวเดียวกันยกบทบาทกับหน่วยงานขึ้นบรรทัดของตัวเอง (เดิมชื่อ `datasetSummary`)
 */
function summaryTable(rows: Array<[string, string]>): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border:1px solid ${BORDER};border-radius:12px;border-collapse:separate;overflow:hidden;">
    ${rows
      .map(
        ([label, value]) => `<tr>
          <td style="padding:10px 14px;background:#F6F7FB;font:400 13px/1.6 'Helvetica Neue',Arial,sans-serif;color:${MUTED};width:38%;">${escapeHtml(label)}</td>
          <td style="padding:10px 14px;font:600 13px/1.6 'Helvetica Neue',Arial,sans-serif;color:${TEXT};">${escapeHtml(value)}</td>
        </tr>`,
      )
      .join("")}
  </table>`;
}

// ------------------------------------------------------------------ อีเมลแต่ละชนิด

/**
 * คำเชิญเข้าใช้งานระบบ — ฉบับเดียวที่ถือ Activation Key ตัวจริง
 *
 * เขียนใหม่ตามการ์ด "แก้เนื้อหา invitation email" ให้เป็นหนังสือนำส่งอย่างที่หน่วยงานรัฐ
 * คุ้นเคย ไม่ใช่ข้อความเชิญสั้น ๆ สิ่งที่การ์ดสั่งไว้และมีผลต่อรูปร่างของอีเมลฉบับนี้
 *
 * - **URL กับ Activation Key แยกบรรทัด** และ URL ที่พิมพ์ให้อ่านต้องเป็น `/activate` เปล่า ๆ
 *   ไม่ใช่ลิงก์ที่มี token ต่อท้าย (`fallback: null` จึงตัดบล็อกลิงก์สำรองใต้ปุ่มทิ้ง) —
 *   หน้า `/activate` มีช่องกรอกคีย์อยู่แล้ว เส้นทาง "เปิด URL แล้วกรอกคีย์" จึงเดินได้จริง
 *   ส่วนปุ่มยังพา token ไปให้เหมือนเดิม คนที่เปิดอีเมลบนเครื่องตัวเองกดครั้งเดียวจบ
 * - **ชื่อบทบาทต้องเด่น** เดิมฝังอยู่กลางย่อหน้า ตอนนี้อยู่ในตารางสรุปบรรทัดของตัวเอง
 * - **วันหมดอายุจริง** ไม่ใช่ "ใช้ได้ 7 วัน" ให้ผู้รับนับเอง ใช้ `expiresAt` ของคีย์ใบนั้น
 * - **คำเตือนคำเชิญที่ไม่ได้คาดหมาย** ผู้รับที่ไม่รู้จักเรื่องนี้ต้องมีทางไปที่ไม่ใช่การกดลิงก์
 *
 * `internal` แยกสำนวนของย่อหน้าเปิด: BDI ไม่ได้ "แจ้งความประสงค์ขอเชื่อมโยงระบบ" กับตัวเอง
 * ทุกอย่างที่เหลือ (คีย์ วันหมดอายุ บทบาท คำเตือน ท้ายจดหมาย) เหมือนกันทั้งสองฉบับ
 */
export async function sendInvitationEmail(
  to: string,
  key: string,
  info: { roleLabel: string; organizationName: string; expiresAt: Date; internal: boolean },
) {
  const organizationName = escapeHtml(info.organizationName);
  const activateUrl = `${env.appUrl}/activate`;
  // วันที่แบบ "11 กันยายน 2569" — อีเมลมีตัวจัดรูปแบบของตัวเอง ไม่พึ่ง thaiLongDate()
  // ของเอกสารข้อตกลง เพราะอีเมลไม่ควรผูกกับรูปแบบที่ฝ่ายกฎหมายสั่งเปลี่ยนได้
  const expiresOn = new Intl.DateTimeFormat("th-TH", {
    dateStyle: "long",
    timeZone: "Asia/Bangkok",
  }).format(info.expiresAt);

  const paragraph = (html: string) =>
    `<p style="margin:0 0 16px;font:400 15px/1.7 'Helvetica Neue',Arial,sans-serif;color:${MUTED};">${html}</p>`;

  const opening = info.internal
    ? `ตามที่ท่านได้รับมอบหมายให้ปฏิบัติหน้าที่ในระบบกลางเพื่อการแบ่งปันข้อมูลดิจิทัล (D2) นั้น ` +
      `สถาบันข้อมูลขนาดใหญ่ (องค์การมหาชน) (สขญ) ขอนำส่ง Activation Key ` +
      `สำหรับใช้ในการลงทะเบียนเข้าใช้งานระบบ`
    : `ตามที่ <strong style="color:${TEXT};">${organizationName}</strong> ได้แจ้งความประสงค์` +
      `ขอเชื่อมโยงระบบสารสนเทศของหน่วยงานกับระบบกลางเพื่อการแบ่งปันข้อมูลดิจิทัล (D2) นั้น ` +
      `สถาบันข้อมูลขนาดใหญ่ (องค์การมหาชน) (สขญ) ขอนำส่ง Activation Key ` +
      `สำหรับใช้ในการลงทะเบียนเข้าใช้งานระบบ`;

  await send(
    to,
    "คำเชิญเข้าใช้งานระบบกลางเพื่อการแบ่งปันข้อมูลดิจิทัล (D2)",
    layout({
      title: "ขอนำส่ง Activation Key สำหรับเข้าใช้งานระบบ",
      intro: info.internal
        ? `เรียน เจ้าหน้าที่${organizationName}`
        : `เรียน ผู้ใช้งาน ${organizationName}`,
      body: [
        paragraph(opening),
        summaryTable([
          ["หน่วยงาน", info.organizationName],
          ["บทบาทในระบบ", info.roleLabel],
        ]),
        `<div style="margin-top:20px;background:#F6F7FB;border:1px solid ${BORDER};border-radius:12px;padding:20px;">
           <div style="font:400 13px/1.6 'Helvetica Neue',Arial,sans-serif;color:${MUTED};">URL สำหรับลงทะเบียน</div>
           <div style="margin-top:4px;font:600 15px/1.6 'Helvetica Neue',Arial,sans-serif;color:${NAVY};word-break:break-all;">${activateUrl}</div>
           <div style="margin-top:14px;font:400 13px/1.6 'Helvetica Neue',Arial,sans-serif;color:${MUTED};">Activation Key</div>
           <div style="margin-top:4px;font:700 15px/1.6 'Courier New',Courier,monospace;color:${TEXT};word-break:break-all;">${escapeHtml(key)}</div>
         </div>`,
        `<p style="margin:20px 0 16px;font:400 15px/1.7 'Helvetica Neue',Arial,sans-serif;color:${MUTED};">
           ท่านสามารถเริ่มต้นการใช้งานระบบได้จากปุ่มด้านล่าง หรือเปิด URL ข้างต้นแล้วกรอก Activation Key
           ด้วยตนเอง จากนั้นยืนยันตัวตนด้วย ThaID แล้วตั้งรหัสผ่าน
         </p>`,
        paragraph(
          `ทั้งนี้ ขอให้${info.internal ? "ท่าน" : "หน่วยงาน"}เก็บรักษา Activation Key ไว้เป็นความลับ และโปรดลงทะเบียนภายใน ` +
            `${env.auth.activationKeyTtlDays} วัน — <strong style="color:${TEXT};">Activation Key นี้ใช้ได้ถึงวันที่ ${expiresOn}</strong>`,
        ),
        `<div style="background:${WARNING_BG};border-left:3px solid ${WARNING};border-radius:8px;padding:16px;">
           <div style="font:400 14px/1.7 'Helvetica Neue',Arial,sans-serif;color:${TEXT};">
             หากท่านไม่ได้คาดหมายว่าจะได้รับคำเชิญนี้ กรุณาอย่ากดลิงก์และอย่าใช้ Activation Key นี้
             ${contactLine("และโปรดแจ้งสถาบันข้อมูลขนาดใหญ่ (องค์การมหาชน) ที่")}
           </div>
         </div>`,
      ].join(""),
      button: {
        label: "เปิดใช้งานบัญชี",
        url: `${activateUrl}?token=${key}`,
        fallback: null,
      },
      closing: `<p style="margin:0;font:400 15px/1.7 'Helvetica Neue',Arial,sans-serif;color:${MUTED};">
           ${contactLine("หากมีข้อสงสัยหรือประสบปัญหาในการดำเนินการ สามารถติดต่อ")}<br><br>
           จึงเรียนมาเพื่อโปรดดำเนินการ<br><br>
           ขอแสดงความนับถือ<br>
           <span style="color:${TEXT};">สถาบันข้อมูลขนาดใหญ่ (องค์การมหาชน)</span>
         </p>`,
      contact: false,
    }),
  );
}

export async function sendOtpEmail(to: string, code: string) {
  await send(
    to,
    `รหัสยืนยันตัวตน ${code} — ระบบกลางเพื่อการแบ่งปันข้อมูลดิจิทัล (D2)`,
    layout({
      title: "รหัสยืนยันตัวตน",
      intro: "ใช้รหัสนี้เพื่อยืนยันตัวตนในระบบ:",
      body: `<div style="background:#F6F7FB;border:1px solid ${BORDER};border-radius:12px;padding:20px;text-align:center;">
               <span style="font:700 32px/1 'Helvetica Neue',Arial,sans-serif;color:${NAVY};letter-spacing:8px;">${code}</span>
             </div>
             <p style="margin:20px 0 0;font:400 15px/1.7 'Helvetica Neue',Arial,sans-serif;color:${MUTED};">
               รหัสนี้ใช้ได้ภายใน <strong style="color:${TEXT};">${env.auth.otpTtlMinutes} นาที</strong>
             </p>
             <p style="margin:8px 0 0;font:400 15px/1.7 'Helvetica Neue',Arial,sans-serif;color:${MUTED};">
               กรุณาอย่าเปิดเผยรหัสนี้แก่ผู้อื่น
             </p>`,
      footnote: "หากคุณไม่ได้เป็นผู้ขอรหัสนี้ คุณสามารถเพิกเฉยต่ออีเมลฉบับนี้ได้",
    }),
  );
}

export async function sendSubmittedToOfficers(
  to: string[],
  org: OrgIdentity,
  submitter: string,
  orgId: string,
  progress?: JourneyProgress | null,
) {
  if (to.length === 0) return;
  const orgName = escapeHtml(org.name);
  await Promise.all(
    to.map((addr) =>
      send(
        addr,
        `มีคำขอสร้างหน่วยงานใหม่: ${org.name}`,
        layout({
          title: "มีคำขอสร้างหน่วยงานรอตรวจสอบ",
          intro: `<strong style="color:${TEXT};">${orgName}</strong> ยื่นคำขอเข้ามาในระบบ โดย ${escapeHtml(submitter)}`,
          orgCode: org.code,
          steps: stepsBlock(progress),
          button: { label: "เปิดดูคำขอ", url: `${env.appUrl}/admin/organizations/${orgId}` },
        }),
      ),
    ),
  );
}

export async function sendRevisionRequested(
  to: string,
  org: OrgIdentity,
  note: string,
  orgId: string,
  progress?: JourneyProgress | null,
) {
  await send(
    to,
    `ต้องปรับปรุงข้อมูลหน่วยงาน: ${org.name}`,
    layout({
      title: "คำขอของคุณต้องปรับปรุง",
      intro: `ผู้ตรวจสอบขอให้แก้ไขข้อมูลของ <strong style="color:${TEXT};">${escapeHtml(org.name)}</strong> ก่อนดำเนินการต่อ`,
      orgCode: org.code,
      body: `<div style="background:#FDECEA;border-left:3px solid #B3261E;border-radius:8px;padding:16px;">
               <div style="font:600 13px/1 'Helvetica Neue',Arial,sans-serif;color:#B3261E;margin-bottom:8px;">สิ่งที่ต้องแก้ไข</div>
               <div style="font:400 15px/1.7 'Helvetica Neue',Arial,sans-serif;color:${TEXT};white-space:pre-wrap;">${escapeHtml(note)}</div>
             </div>`,
      steps: stepsBlock(progress),
      button: { label: "แก้ไขข้อมูล", url: `${env.appUrl}/organizations/${orgId}` },
    }),
  );
}

export async function sendSignatoryRequest(
  to: string,
  org: OrgIdentity,
  orgId: string,
  registerToken?: string,
  progress?: JourneyProgress | null,
) {
  const url = registerToken
    ? `${env.appUrl}/register?token=${registerToken}`
    : `${env.appUrl}/organizations/${orgId}`;
  await send(
    to,
    `ขอความเห็นชอบการสร้างหน่วยงาน: ${org.name}`,
    layout({
      title: "ขอความเห็นชอบในฐานะผู้มีอำนาจกระทำการแทนของหน่วยงาน",
      intro: `<strong style="color:${TEXT};">${escapeHtml(org.name)}</strong> ระบุว่าคุณเป็นผู้มีอำนาจกระทำการแทนของหน่วยงาน และคำขอผ่านการตรวจสอบจากเจ้าหน้าที่ BDI แล้ว`,
      orgCode: org.code,
      body: registerToken
        ? `<p style="margin:0;font:400 15px/1.7 'Helvetica Neue',Arial,sans-serif;color:${MUTED};">
             คุณยังไม่มีบัญชีในระบบ กรุณาลงทะเบียนเพื่อตรวจสอบเอกสารและให้ความเห็นชอบ
           </p>`
        : "",
      steps: stepsBlock(progress),
      button: { label: registerToken ? "ลงทะเบียนและตรวจสอบ" : "ตรวจสอบเอกสาร", url },
    }),
  );
}

export async function sendFinalApprovalRequest(
  to: string[],
  org: OrgIdentity,
  orgId: string,
  progress?: JourneyProgress | null,
) {
  if (to.length === 0) return;
  const orgName = escapeHtml(org.name);
  await Promise.all(
    to.map((addr) =>
      send(
        addr,
        `รอลงนาม: ${org.name}`,
        layout({
          title: "มีคำขอรอการลงนาม",
          intro: `ผู้มีอำนาจกระทำการแทนของ <strong style="color:${TEXT};">${orgName}</strong> ให้ความเห็นชอบแล้ว`,
          orgCode: org.code,
          steps: stepsBlock(progress),
          button: { label: "ตรวจสอบและลงนาม", url: `${env.appUrl}/admin/organizations/${orgId}` },
        }),
      ),
    ),
  );
}

export async function sendActivated(
  to: string[],
  org: OrgIdentity,
  orgId: string,
  progress?: JourneyProgress | null,
) {
  const unique = [...new Set(to.filter(Boolean))];
  if (unique.length === 0) return;
  const orgName = escapeHtml(org.name);
  await Promise.all(
    unique.map((addr) =>
      send(
        addr,
        `หน่วยงาน ${org.name} เปิดใช้งานแล้ว`,
        layout({
          title: "หน่วยงานของคุณเปิดใช้งานแล้ว",
          intro: `<strong style="color:${TEXT};">${orgName}</strong> ผ่านการอนุมัติครบทุกขั้นตอนและพร้อมใช้งานบนแพลตฟอร์มแล้ว`,
          orgCode: org.code,
          steps: stepsBlock(progress),
          button: { label: "เข้าสู่ระบบ", url: `${env.appUrl}/organizations/${orgId}` },
        }),
      ),
    ),
  );
}

/**
 * แจ้งคนที่ถูกถอดออกจากหน่วยงานเพราะมีคนมารับ role แทน
 *
 * ไม่มีปุ่มพาไปไหน — คนรับอีเมลนี้ไม่มีหน่วยงานให้เปิดแล้ว และปุ่ม "สร้างหน่วยงาน"
 * คือสิ่งที่ทำให้เกิดหน่วยงานซ้ำมาแล้ว ทางไปต่อที่ถูกคือติดต่อผู้ดูแลระบบ
 */
export async function sendRoleRemoved(
  to: string,
  info: { organizationName: string; roleLabel: string; successorName: string | null; removedAt: Date | null },
) {
  const when = info.removedAt
    ? new Intl.DateTimeFormat("th-TH", { dateStyle: "long", timeStyle: "short" }).format(info.removedAt)
    : null;
  // ชื่อหน่วยงานและชื่อคนมาจากฐานข้อมูล ผู้ใช้พิมพ์เองได้ จึง escape ก่อนวางลง HTML เสมอ
  const organizationName = escapeHtml(info.organizationName);
  const roleLabel = escapeHtml(info.roleLabel);
  const successor = escapeHtml(info.successorName ?? "เจ้าหน้าที่คนใหม่");

  await send(
    to,
    `บัญชีของคุณถูกถอดออกจาก ${info.organizationName}`,
    layout({
      title: "บัญชีของคุณถูกถอดออกจากหน่วยงาน",
      intro:
        `ผู้ดูแลระบบได้มอบหน้าที่ <strong style="color:${TEXT};">${roleLabel}</strong> ของ ` +
        `<strong style="color:${TEXT};">${organizationName}</strong> ให้ ${successor} แทนคุณ` +
        (when ? ` เมื่อ ${when}` : "") +
        ` บัญชีของคุณจึงไม่ได้สังกัดหน่วยงานใดในระบบขณะนี้`,
      body:
        `<p style="margin:0;font:400 15px/1.7 'Helvetica Neue',Arial,sans-serif;color:${MUTED};">` +
        `ข้อมูลและคำขอทั้งหมดของ ${organizationName} ยังอยู่ครบ เพียงแต่คุณเปิดดูไม่ได้` +
        `จนกว่าจะได้รับสิทธิ์คืน</p>`,
      footnote: "หากคิดว่าไม่ถูกต้อง โปรดติดต่อผู้ดูแลระบบ BDI เพื่อขอสิทธิ์ในหน่วยงานเดิมคืน",
    }),
  );
}

// ------------------------------------------------------------------ Journey C — ชุดข้อมูล

/** ส่งฉบับเดียวกันให้หลายคน — ตัดอีเมลซ้ำออกก่อนเสมอ */
async function sendMany(to: string[], subject: string, html: string) {
  const unique = [...new Set(to.filter(Boolean))];
  if (unique.length === 0) return;
  await Promise.all(unique.map((addr) => send(addr, subject, html)));
}

const orgLink = (id: string) => `${env.appUrl}/datasets/${id}`;
const bdiLink = (id: string) => `${env.appUrl}/admin/datasets/${id}`;

/** หัวเรื่องอ้างเลขที่คำขอเสมอ เพื่อให้ผู้รับที่มีหลายคำขอแยกออกจากกันได้ */
const datasetSubject = (requestNumber: string, text: string) => `[${requestNumber}] ${text}`;

export async function sendDatasetSubmitted(
  to: string[],
  info: {
    requestNumber: string;
    organizationCode: string | null;
    datasetName: string;
    organizationName: string;
    submitter: string;
    id: string;
  },
  progress?: JourneyProgress | null,
) {
  await sendMany(
    to,
    datasetSubject(info.requestNumber, `มีคำขอลงทะเบียนชุดข้อมูลรอตรวจสอบ: ${info.datasetName}`),
    layout({
      title: "มีคำขอลงทะเบียนชุดข้อมูลรอตรวจสอบ",
      orgCode: info.organizationCode,
      intro: `<strong style="color:${TEXT};">${escapeHtml(info.organizationName)}</strong> นำส่งคำขอลงทะเบียนชุดข้อมูลเข้ามาในระบบ`,
      body: summaryTable([
        ["เลขที่คำขอ", info.requestNumber],
        ["ชื่อชุดข้อมูล", info.datasetName],
        ["ผู้นำส่ง", info.submitter],
      ]),
      steps: stepsBlock(progress),
      button: { label: "เปิดดูคำขอ", url: bdiLink(info.id) },
    }),
  );
}

export async function sendDatasetRevisionRequested(
  to: string[],
  info: {
    requestNumber: string;
    organizationCode: string | null;
    datasetName: string;
    note: string;
    byName: string;
    at: Date;
    id: string;
  },
  progress?: JourneyProgress | null,
) {
  const when = new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  }).format(info.at);

  await sendMany(
    to,
    datasetSubject(info.requestNumber, `ต้องปรับปรุงคำขอลงทะเบียนชุดข้อมูล: ${info.datasetName}`),
    layout({
      title: "คำขอของคุณต้องปรับปรุง",
      orgCode: info.organizationCode,
      intro: `ผู้ตรวจสอบขอให้แก้ไขคำขอ <strong style="color:${TEXT};">${escapeHtml(info.datasetName)}</strong> ก่อนดำเนินการต่อ`,
      // สเปกกำหนดว่าต้องบอกให้ครบว่า "แก้เรื่องอะไร โดยใคร เมื่อไหร่"
      body: `<div style="background:#FDECEA;border-left:3px solid #B3261E;border-radius:8px;padding:16px;">
               <div style="font:600 13px/1 'Helvetica Neue',Arial,sans-serif;color:#B3261E;margin-bottom:8px;">สิ่งที่ต้องแก้ไข</div>
               <div style="font:400 15px/1.7 'Helvetica Neue',Arial,sans-serif;color:${TEXT};white-space:pre-wrap;">${escapeHtml(info.note)}</div>
               <div style="margin-top:12px;font:400 12px/1.6 'Helvetica Neue',Arial,sans-serif;color:${MUTED};">
                 โดย ${escapeHtml(info.byName)} · ${when}
               </div>
             </div>`,
      steps: stepsBlock(progress),
      button: { label: "แก้ไขคำขอ", url: orgLink(info.id) },
    }),
  );
}

export async function sendDatasetSpecialistAssigned(
  to: string,
  info: {
    requestNumber: string;
    organizationCode: string | null;
    datasetName: string;
    organizationName: string;
    id: string;
  },
  progress?: JourneyProgress | null,
) {
  await sendMany(
    [to],
    datasetSubject(info.requestNumber, `ขอความเห็นต่อชุดข้อมูล: ${info.datasetName}`),
    layout({
      title: "เจ้าหน้าที่ BDI ขอความเห็นของคุณ",
      orgCode: info.organizationCode,
      /**
       * ถ้อยคำต้องไม่ทำให้เข้าใจว่าคำขอมารอเขาอยู่ — มันยังอยู่ที่เจ้าหน้าที่ BDI และ
       * เจ้าหน้าที่จะกดผ่านหรือส่งกลับเมื่อไรก็ได้ ไม่ว่าความเห็นจะมาแล้วหรือยัง
       */
      intro:
        "เจ้าหน้าที่ BDI ขอความเห็นของคุณต่อคำขอนี้ในฐานะผู้เชี่ยวชาญด้านข้อมูล " +
        "คุณเปิดดูรายละเอียดและบันทึกความเห็นไว้ให้เจ้าหน้าที่ได้ — การตัดสินผ่านหรือส่งกลับ " +
        "ยังเป็นของเจ้าหน้าที่ BDI ตามเดิม",
      body: summaryTable([
        ["เลขที่คำขอ", info.requestNumber],
        ["ชื่อชุดข้อมูล", info.datasetName],
        ["หน่วยงานเจ้าของข้อมูล", info.organizationName],
      ]),
      steps: stepsBlock(progress),
      button: { label: "เปิดดูคำขอ", url: bdiLink(info.id) },
    }),
  );
}

export async function sendDatasetPendingOrgApprover(
  to: string[],
  info: {
    requestNumber: string;
    organizationCode: string | null;
    datasetName: string;
    organizationName: string;
    id: string;
  },
  progress?: JourneyProgress | null,
) {
  await sendMany(
    to,
    datasetSubject(info.requestNumber, `ขอความเห็นชอบชุดข้อมูล: ${info.datasetName}`),
    layout({
      title: "ขอความเห็นชอบในฐานะผู้มีอำนาจกระทำการแทนของหน่วยงาน",
      orgCode: info.organizationCode,
      intro: `คำขอลงทะเบียนชุดข้อมูลของ <strong style="color:${TEXT};">${escapeHtml(info.organizationName)}</strong> ผ่านการตรวจสอบเบื้องต้นจากเจ้าหน้าที่ BDI แล้ว`,
      body: summaryTable([
        ["เลขที่คำขอ", info.requestNumber],
        ["ชื่อชุดข้อมูล", info.datasetName],
      ]),
      steps: stepsBlock(progress),
      button: { label: "ตรวจสอบและลงนาม", url: orgLink(info.id) },
    }),
  );
}

/**
 * หน่วยงานลงนามแล้ว รอผู้อนุมัติ BDI
 *
 * ต่างจาก `sendDatasetPendingBdiApproval()` ตรงที่บอก **ชื่อผู้ลงนาม** ซึ่งเป็นข้อมูลที่
 * ผู้อนุมัติต้องใช้ตัดสิน — ฉบับนั้นเป็น template กลางที่ delivery worker ประกอบเองจาก
 * subject_id จึงไม่รู้จักชื่อคน ฉบับนี้จึงถูกส่งอินไลน์จาก route
 */
export async function sendDatasetSignedPendingApproval(
  to: string[],
  info: {
    requestNumber: string;
    organizationCode: string | null;
    datasetName: string;
    organizationName: string;
    signedBy: string;
    id: string;
  },
  progress?: JourneyProgress | null,
) {
  await sendMany(
    to,
    datasetSubject(info.requestNumber, `รอการพิจารณาชุดข้อมูล: ${info.datasetName}`),
    layout({
      title: "มีคำขอลงทะเบียนชุดข้อมูลรอการพิจารณา",
      orgCode: info.organizationCode,
      intro:
        `ผู้มีอำนาจของ <strong style="color:${TEXT};">${escapeHtml(info.organizationName)}</strong> ` +
        `ได้ลงนามเห็นชอบคำขอลงทะเบียนชุดข้อมูลแล้ว และคำขออยู่ระหว่างรอการพิจารณาจาก BDI`,
      body: summaryTable([
        ["เลขที่คำขอ", info.requestNumber],
        ["ชื่อชุดข้อมูล", info.datasetName],
        ["หน่วยงานเจ้าของข้อมูล", info.organizationName],
        ["ผู้ลงนามเห็นชอบ", info.signedBy],
      ]),
      steps: stepsBlock(progress),
      button: { label: "ตรวจสอบคำขอ", url: bdiLink(info.id) },
    }),
  );
}

export async function sendDatasetPendingBdiApproval(
  to: string[],
  info: {
    requestNumber: string;
    organizationCode: string | null;
    datasetName: string;
    organizationName: string;
    id: string;
  },
  progress?: JourneyProgress | null,
) {
  await sendMany(
    to,
    datasetSubject(info.requestNumber, `รอการพิจารณาชุดข้อมูล: ${info.datasetName}`),
    layout({
      title: "มีคำขอลงทะเบียนชุดข้อมูลรอการพิจารณา",
      orgCode: info.organizationCode,
      intro:
        "คำขอลงทะเบียนชุดข้อมูลผ่านการตรวจสอบและการลงนามเห็นชอบของหน่วยงานครบแล้ว " +
        "และอยู่ระหว่างรอการพิจารณาจาก BDI",
      body: summaryTable([
        ["เลขที่คำขอ", info.requestNumber],
        ["ชื่อชุดข้อมูล", info.datasetName],
        ["หน่วยงานเจ้าของข้อมูล", info.organizationName],
      ]),
      steps: stepsBlock(progress),
      button: { label: "ตรวจสอบคำขอ", url: bdiLink(info.id) },
    }),
  );
}

export async function sendDatasetApproved(
  to: string[],
  info: {
    requestNumber: string;
    organizationCode: string | null;
    datasetName: string;
    organizationName: string;
    id: string;
  },
  progress?: JourneyProgress | null,
) {
  await sendMany(
    to,
    datasetSubject(info.requestNumber, `อนุมัติชุดข้อมูลแล้ว: ${info.datasetName}`),
    layout({
      title: "ชุดข้อมูลได้รับอนุมัติแล้ว",
      orgCode: info.organizationCode,
      intro: `คำขอลงทะเบียนชุดข้อมูล <strong style="color:${TEXT};">${escapeHtml(info.datasetName)}</strong> ผ่านการอนุมัติครบทุกขั้นตอนแล้ว`,
      body: summaryTable([
        ["เลขที่คำขอ", info.requestNumber],
        ["หน่วยงานเจ้าของข้อมูล", info.organizationName],
      ]),
      steps: stepsBlock(progress),
      button: { label: "เปิดดูและดาวน์โหลดเอกสาร", url: orgLink(info.id) },
    }),
  );
}

export async function sendDatasetRejected(
  to: string[],
  info: {
    requestNumber: string;
    organizationCode: string | null;
    datasetName: string;
    reason: string;
    id: string;
  },
  progress?: JourneyProgress | null,
) {
  await sendMany(
    to,
    datasetSubject(info.requestNumber, `ไม่อนุมัติชุดข้อมูล: ${info.datasetName}`),
    layout({
      title: "คำขอลงทะเบียนชุดข้อมูลไม่ได้รับอนุมัติ",
      orgCode: info.organizationCode,
      intro: `คำขอ <strong style="color:${TEXT};">${escapeHtml(info.datasetName)}</strong> สิ้นสุดกระบวนการโดยไม่ได้รับอนุมัติ`,
      body: `<div style="background:#FDECEA;border-left:3px solid #B3261E;border-radius:8px;padding:16px;">
               <div style="font:600 13px/1 'Helvetica Neue',Arial,sans-serif;color:#B3261E;margin-bottom:8px;">เหตุผล</div>
               <div style="font:400 15px/1.7 'Helvetica Neue',Arial,sans-serif;color:${TEXT};white-space:pre-wrap;">${escapeHtml(info.reason)}</div>
             </div>`,
      steps: stepsBlock(progress),
      button: { label: "เปิดดูรายละเอียด", url: orgLink(info.id) },
      footnote: "หากต้องการยื่นใหม่ กรุณาสร้างคำขอฉบับใหม่และแก้ไขตามเหตุผลข้างต้น",
    }),
  );
}

/**
 * "คำขอเดินหน้าไปอีกขั้น" — ฉบับที่ฝั่งหน่วยงานได้รับทุกครั้งที่คำขอผ่านด่านหนึ่ง
 *
 * ไม่มีปุ่มพาไปทำอะไร เพราะคนอ่านไม่ได้ต้องทำอะไร มีแค่ลิงก์ไปดูคำขอ — เจตนาคือ
 * ตอบคำถาม "เรื่องของเราไปถึงไหนแล้ว" ซึ่งเดิมไม่มีอีเมลฉบับไหนตอบเลย
 */
export async function sendRequestProgressed(
  to: string,
  /** `path` คือ path ภายในแอปจาก linkFor() — โดเมนต่อให้ที่นี่ เพราะ appUrl เปลี่ยนได้ */
  info: { title: string; message: string; path: string; orgCode: string | null },
  progress?: JourneyProgress | null,
): Promise<void> {
  await send(
    to,
    info.title,
    layout({
      title: info.title,
      intro: escapeHtml(info.message),
      orgCode: info.orgCode,
      steps: stepsBlock(progress),
      button: { label: "เปิดดูคำขอ", url: `${env.appUrl}${info.path}` },
      footnote: "อีเมลฉบับนี้แจ้งความคืบหน้าเท่านั้น ยังไม่มีสิ่งที่คุณต้องดำเนินการ",
    }),
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}
