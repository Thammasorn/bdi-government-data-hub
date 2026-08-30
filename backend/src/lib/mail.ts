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

interface Button {
  label: string;
  url: string;
}

/**
 * เทมเพลตกลางตาม CI ของ BDI
 * ใช้ table layout กับ inline style เพราะ Gmail/Outlook ตัด <style> ทิ้ง
 */
function layout(opts: {
  title: string;
  intro: string;
  body?: string;
  /** บล็อกขั้นตอนจาก stepsBlock() — วางใต้ body และเหนือปุ่มเสมอ */
  steps?: string;
  button?: Button;
  footnote?: string;
}): string {
  const { title, intro, body = "", steps = "", button, footnote } = opts;
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
              ? `<img src="cid:${LOGO_CID}" width="200" height="34" alt="สถาบันข้อมูลขนาดใหญ่"
                      style="display:block;border:0;outline:none;text-decoration:none;">`
              : `<div style="font:700 20px/1.3 'Helvetica Neue',Arial,sans-serif;color:${NAVY};letter-spacing:-0.01em;">
                   BDI<span style="color:${CORAL};">.</span>
                 </div>`
          }
          <div style="margin-top:10px;font:600 14px/1.3 'Helvetica Neue',Arial,sans-serif;color:${MUTED};">
            Government Datahub
          </div>
        </td></tr>
        <tr><td style="padding:24px 32px 0;">
          <h1 style="margin:0 0 12px;font:600 22px/1.4 'Helvetica Neue',Arial,sans-serif;color:${TEXT};">${title}</h1>
          <p style="margin:0;font:400 15px/1.7 'Helvetica Neue',Arial,sans-serif;color:${MUTED};">${intro}</p>
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
                 <p style="margin:16px 0 0;font:400 12px/1.6 'Helvetica Neue',Arial,sans-serif;color:${MUTED};word-break:break-all;">
                   หากปุ่มใช้งานไม่ได้ ให้คัดลอกลิงก์นี้ไปวางในเบราว์เซอร์<br>
                   <span style="color:${NAVY};">${button.url}</span>
                 </p>
               </td></tr>`
            : ""
        }
        <tr><td style="padding:32px;">
          <div style="border-top:1px solid ${BORDER};padding-top:16px;
                      font:400 12px/1.6 'Helvetica Neue',Arial,sans-serif;color:${MUTED};">
            ${footnote ?? "อีเมลฉบับนี้ส่งจากระบบอัตโนมัติ กรุณาอย่าตอบกลับ"}<br>
            สถาบันข้อมูลขนาดใหญ่ (องค์การมหาชน) — Big Data Institute
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
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

  const heading = progress.currentOrder
    ? `ขั้นที่ ${progress.currentOrder} จาก ${progress.totalSteps}`
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

      return `<tr>
        <td width="24" valign="top" style="padding:6px 0;font:600 14px/1.6 'Helvetica Neue',Arial,sans-serif;color:${mark.color};">${mark.glyph}</td>
        <td valign="top" style="padding:6px 0;font:${emphasis} 14px/1.6 'Helvetica Neue',Arial,sans-serif;color:${color};">
          ${number}${escapeHtml(step.label)}${suffix}
          <div style="font:400 12px/1.6 'Helvetica Neue',Arial,sans-serif;color:${MUTED};">โดย${escapeHtml(step.roleLabel)}</div>
        </td>
      </tr>`;
    })
    .join("");

  const next = progress.nextStep
    ? `<div style="margin-top:12px;font:400 13px/1.6 'Helvetica Neue',Arial,sans-serif;color:${MUTED};">
         ขั้นต่อไป: <span style="color:${TEXT};">${escapeHtml(progress.nextStep.label)}</span>
       </div>`
    : "";

  return `<div style="border:1px solid ${BORDER};border-radius:12px;padding:16px;">
    <div style="font:600 13px/1 'Helvetica Neue',Arial,sans-serif;color:${NAVY};margin-bottom:12px;">${heading}</div>
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

// ------------------------------------------------------------------ อีเมลแต่ละชนิด

export async function sendInvitationEmail(to: string, token: string, roleLabel: string) {
  const url = `${env.appUrl}/activate?token=${token}`;
  await send(
    to,
    "คำเชิญเข้าใช้งาน Government Datahub Platform",
    layout({
      title: "คุณได้รับเชิญให้เข้าใช้งานระบบ",
      intro: `สถาบันข้อมูลขนาดใหญ่ (BDI) เชิญคุณเข้าใช้งาน Government Datahub Platform ในสิทธิ์ <strong style="color:${TEXT};">${roleLabel}</strong>`,
      body: `<p style="margin:0;font:400 15px/1.7 'Helvetica Neue',Arial,sans-serif;color:${MUTED};">
               กดปุ่มด้านล่างเพื่อยืนยันตัวตนด้วย ThaiD แล้วตั้งรหัสผ่าน
               ลิงก์นี้ใช้ได้ ${env.auth.activationKeyTtlDays} วัน
             </p>`,
      button: { label: "เปิดใช้งานบัญชี", url },
    }),
  );
}

export async function sendOtpEmail(to: string, code: string) {
  await send(
    to,
    `รหัสยืนยันตัวตน ${code} — BDI Datahub`,
    layout({
      title: "รหัสยืนยันตัวตน",
      intro: `กรอกรหัสนี้เพื่อยืนยันตัวตน รหัสมีอายุ ${env.auth.otpTtlMinutes} นาที`,
      body: `<div style="background:#F6F7FB;border:1px solid ${BORDER};border-radius:12px;padding:20px;text-align:center;">
               <span style="font:700 32px/1 'Helvetica Neue',Arial,sans-serif;color:${NAVY};letter-spacing:8px;">${code}</span>
             </div>`,
      footnote: "หากคุณไม่ได้เป็นผู้ขอรหัสนี้ ให้เพิกเฉยต่ออีเมลฉบับนี้",
    }),
  );
}

export async function sendSubmittedToOfficers(
  to: string[],
  orgName: string,
  submitter: string,
  orgId: string,
  progress?: JourneyProgress | null,
) {
  if (to.length === 0) return;
  await Promise.all(
    to.map((addr) =>
      send(
        addr,
        `มีคำขอสร้างหน่วยงานใหม่: ${orgName}`,
        layout({
          title: "มีคำขอสร้างหน่วยงานรอตรวจสอบ",
          intro: `<strong style="color:${TEXT};">${orgName}</strong> ยื่นคำขอเข้ามาในระบบ โดย ${submitter}`,
          steps: stepsBlock(progress),
          button: { label: "เปิดดูคำขอ", url: `${env.appUrl}/admin/organizations/${orgId}` },
        }),
      ),
    ),
  );
}

export async function sendRevisionRequested(
  to: string,
  orgName: string,
  note: string,
  orgId: string,
  progress?: JourneyProgress | null,
) {
  await send(
    to,
    `ต้องปรับปรุงข้อมูลหน่วยงาน: ${orgName}`,
    layout({
      title: "คำขอของคุณต้องปรับปรุง",
      intro: `ผู้ตรวจสอบขอให้แก้ไขข้อมูลของ <strong style="color:${TEXT};">${orgName}</strong> ก่อนดำเนินการต่อ`,
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
  orgName: string,
  orgId: string,
  registerToken?: string,
  progress?: JourneyProgress | null,
) {
  const url = registerToken
    ? `${env.appUrl}/register?token=${registerToken}`
    : `${env.appUrl}/organizations/${orgId}`;
  await send(
    to,
    `ขอความเห็นชอบการสร้างหน่วยงาน: ${orgName}`,
    layout({
      title: "ขอความเห็นชอบในฐานะผู้มีอำนาจกระทำการแทน",
      intro: `<strong style="color:${TEXT};">${orgName}</strong> ระบุว่าคุณเป็นผู้มีอำนาจกระทำการแทน และคำขอผ่านการตรวจสอบจากเจ้าหน้าที่ BDI แล้ว`,
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
  orgName: string,
  orgId: string,
  progress?: JourneyProgress | null,
) {
  if (to.length === 0) return;
  await Promise.all(
    to.map((addr) =>
      send(
        addr,
        `รอลงนาม: ${orgName}`,
        layout({
          title: "มีคำขอรอการลงนาม",
          intro: `ผู้มีอำนาจกระทำการแทนของ <strong style="color:${TEXT};">${orgName}</strong> ให้ความเห็นชอบแล้ว`,
          steps: stepsBlock(progress),
          button: { label: "ตรวจสอบและลงนาม", url: `${env.appUrl}/admin/organizations/${orgId}` },
        }),
      ),
    ),
  );
}

export async function sendActivated(
  to: string[],
  orgName: string,
  orgId: string,
  progress?: JourneyProgress | null,
) {
  const unique = [...new Set(to.filter(Boolean))];
  if (unique.length === 0) return;
  await Promise.all(
    unique.map((addr) =>
      send(
        addr,
        `หน่วยงาน ${orgName} เปิดใช้งานแล้ว`,
        layout({
          title: "หน่วยงานของคุณเปิดใช้งานแล้ว",
          intro: `<strong style="color:${TEXT};">${orgName}</strong> ผ่านการอนุมัติครบทุกขั้นตอนและพร้อมใช้งานบนแพลตฟอร์มแล้ว`,
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

function datasetSummary(rows: Array<[string, string]>): string {
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

export async function sendDatasetSubmitted(
  to: string[],
  info: { requestNumber: string; datasetName: string; organizationName: string; submitter: string; id: string },
  progress?: JourneyProgress | null,
) {
  await sendMany(
    to,
    datasetSubject(info.requestNumber, `มีคำขอลงทะเบียนชุดข้อมูลรอตรวจสอบ: ${info.datasetName}`),
    layout({
      title: "มีคำขอลงทะเบียนชุดข้อมูลรอตรวจสอบ",
      intro: `<strong style="color:${TEXT};">${escapeHtml(info.organizationName)}</strong> นำส่งคำขอลงทะเบียนชุดข้อมูลเข้ามาในระบบ`,
      body: datasetSummary([
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
  info: { requestNumber: string; datasetName: string; note: string; byName: string; at: Date; id: string },
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
  info: { requestNumber: string; datasetName: string; organizationName: string; id: string },
  progress?: JourneyProgress | null,
) {
  await sendMany(
    [to],
    datasetSubject(info.requestNumber, `ขอความเห็นต่อชุดข้อมูล: ${info.datasetName}`),
    layout({
      title: "เจ้าหน้าที่ BDI ขอความเห็นของคุณ",
      /**
       * ถ้อยคำต้องไม่ทำให้เข้าใจว่าคำขอมารอเขาอยู่ — มันยังอยู่ที่เจ้าหน้าที่ BDI และ
       * เจ้าหน้าที่จะกดผ่านหรือส่งกลับเมื่อไรก็ได้ ไม่ว่าความเห็นจะมาแล้วหรือยัง
       */
      intro:
        "เจ้าหน้าที่ BDI ขอความเห็นของคุณต่อคำขอนี้ในฐานะผู้เชี่ยวชาญด้านข้อมูล " +
        "คุณเปิดดูรายละเอียดและบันทึกความเห็นไว้ให้เจ้าหน้าที่ได้ — การตัดสินผ่านหรือส่งกลับ " +
        "ยังเป็นของเจ้าหน้าที่ BDI ตามเดิม",
      body: datasetSummary([
        ["เลขที่คำขอ", info.requestNumber],
        ["ชื่อชุดข้อมูล", info.datasetName],
        ["หน่วยงาน", info.organizationName],
      ]),
      steps: stepsBlock(progress),
      button: { label: "เปิดดูคำขอ", url: bdiLink(info.id) },
    }),
  );
}

export async function sendDatasetPendingOrgApprover(
  to: string[],
  info: { requestNumber: string; datasetName: string; organizationName: string; id: string },
  progress?: JourneyProgress | null,
) {
  await sendMany(
    to,
    datasetSubject(info.requestNumber, `ขอความเห็นชอบชุดข้อมูล: ${info.datasetName}`),
    layout({
      title: "ขอความเห็นชอบในฐานะผู้มีอำนาจกระทำการแทน",
      intro: `คำขอลงทะเบียนชุดข้อมูลของ <strong style="color:${TEXT};">${escapeHtml(info.organizationName)}</strong> ผ่านการตรวจสอบเบื้องต้นจากเจ้าหน้าที่ BDI แล้ว`,
      body: datasetSummary([
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
  info: { requestNumber: string; datasetName: string; organizationName: string; signedBy: string; id: string },
  progress?: JourneyProgress | null,
) {
  await sendMany(
    to,
    datasetSubject(info.requestNumber, `รออนุมัติชุดข้อมูล: ${info.datasetName}`),
    layout({
      title: "มีคำขอรอการอนุมัติ",
      intro: `ผู้มีอำนาจของ <strong style="color:${TEXT};">${escapeHtml(info.organizationName)}</strong> ลงนามเห็นชอบแล้ว`,
      body: datasetSummary([
        ["เลขที่คำขอ", info.requestNumber],
        ["ชื่อชุดข้อมูล", info.datasetName],
        ["ผู้ลงนาม", info.signedBy],
      ]),
      steps: stepsBlock(progress),
      button: { label: "ตรวจสอบและอนุมัติ", url: bdiLink(info.id) },
    }),
  );
}

export async function sendDatasetPendingBdiApproval(
  to: string[],
  info: { requestNumber: string; datasetName: string; organizationName: string; id: string },
  progress?: JourneyProgress | null,
) {
  await sendMany(
    to,
    datasetSubject(info.requestNumber, `รออนุมัติชุดข้อมูล: ${info.datasetName}`),
    layout({
      title: "มีคำขอรอการอนุมัติ",
      intro: `คำขอผ่านการตรวจสอบครบทุกด่านแล้ว รอการพิจารณาขั้นสุดท้ายจากผู้อนุมัติ BDI`,
      body: datasetSummary([
        ["เลขที่คำขอ", info.requestNumber],
        ["ชื่อชุดข้อมูล", info.datasetName],
        ["หน่วยงาน", info.organizationName],
      ]),
      steps: stepsBlock(progress),
      button: { label: "ตรวจสอบและอนุมัติ", url: bdiLink(info.id) },
    }),
  );
}

export async function sendDatasetApproved(
  to: string[],
  info: { requestNumber: string; datasetName: string; organizationName: string; id: string },
  progress?: JourneyProgress | null,
) {
  await sendMany(
    to,
    datasetSubject(info.requestNumber, `อนุมัติชุดข้อมูลแล้ว: ${info.datasetName}`),
    layout({
      title: "ชุดข้อมูลได้รับอนุมัติแล้ว",
      intro: `คำขอลงทะเบียนชุดข้อมูล <strong style="color:${TEXT};">${escapeHtml(info.datasetName)}</strong> ผ่านการอนุมัติครบทุกขั้นตอนแล้ว`,
      body: datasetSummary([
        ["เลขที่คำขอ", info.requestNumber],
        ["หน่วยงาน", info.organizationName],
      ]),
      steps: stepsBlock(progress),
      button: { label: "เปิดดูและดาวน์โหลดเอกสาร", url: orgLink(info.id) },
    }),
  );
}

export async function sendDatasetRejected(
  to: string[],
  info: { requestNumber: string; datasetName: string; reason: string; id: string },
  progress?: JourneyProgress | null,
) {
  await sendMany(
    to,
    datasetSubject(info.requestNumber, `ไม่อนุมัติชุดข้อมูล: ${info.datasetName}`),
    layout({
      title: "คำขอลงทะเบียนชุดข้อมูลไม่ได้รับอนุมัติ",
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
  info: { title: string; message: string; path: string },
  progress?: JourneyProgress | null,
): Promise<void> {
  await send(
    to,
    info.title,
    layout({
      title: info.title,
      intro: escapeHtml(info.message),
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
