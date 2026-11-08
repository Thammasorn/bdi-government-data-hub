/**
 * บล็อกของระบบในเทมเพลตอีเมล (`{{block.*}}`) — ส่วนที่ผู้ดูแลระบบ**วางตำแหน่งได้แต่แก้เนื้อในไม่ได้** (การ์ด "[New Feature] Admin
 * Email Template Edit", 2026-11-08)
 *
 * ทุกบล็อกเป็น HTML ที่ระบบสร้างเอง ค่าที่มาจากผู้ใช้ escape ที่นี่ก่อนวางเสมอ เหตุที่ไม่ให้แก้: ลิงก์ของปุ่มมี token ของคำเชิญและการตั้ง
 * รหัสผ่าน, ขั้นตอนมาจาก `journey-steps.ts`, และกล่อง OTP ต้องคงรูปเดิมเพราะ dry-run ของ `send()` หาเลขรหัสจาก markup ของมัน
 *
 * ตารางกับ inline style ล้วน เพราะ Gmail/Outlook ตัด `<style>` ทิ้งและรองรับ flex/grid ไม่ได้ บล็อกไม่มีระยะห่างด้านนอกของตัวเอง —
 * เนื้อหาตั้งต้นห่อด้วย `<div style="margin-top:…">` ผู้ดูแลที่ย้ายบล็อกจึงย้ายระยะห่างไปด้วย
 */
import { readFileSync } from "node:fs";

import type { JourneyProgress } from "../journey-steps.js";

/** สีตาม CI ของ BDI — ค่าเดียวกับ `frontend/app/globals.css` (เปลี่ยนพร้อมกันทุกที่ ดู CLAUDE.md) */
export const NAVY = "#192768";
export const CORAL = "#E5775A";
export const TEXT = "#141A33";
export const MUTED = "#5B6178";
export const BORDER = "#E2E4EC";
export const WARNING = "#B26A00";
export const WARNING_BG = "#FFF3E0";
export const DANGER = "#B3261E";
export const DANGER_BG = "#FDECEA";
export const FONT = "'Helvetica Neue',Arial,sans-serif";

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

/**
 * โลโก้ต้องแนบไปกับอีเมลแต่ละฉบับแล้วอ้างด้วย cid: ไม่ใช่ลิงก์ไปที่เว็บ เพราะเมลไคลเอนต์ส่วนใหญ่บล็อกรูปจากภายนอกจนกว่าผู้รับจะกดอนุญาต
 *
 * อ่านไฟล์ครั้งเดียวตอนโหลดโมดูล ถ้าอ่านไม่ได้ (เช่น build ลืม copy src/assets) จะถอยไปใช้หัวจดหมายแบบตัวอักษรแทน
 */
export const LOGO_CID = "bdi-logo";
export const logo = ((): Buffer | null => {
  try {
    return readFileSync(new URL("../../assets/brand/bdi-logo.png", import.meta.url));
  } catch (err) {
    console.warn("[mail] อ่านไฟล์โลโก้ไม่ได้ จะใช้หัวจดหมายแบบตัวอักษรแทน", err);
    return null;
  }
})();

/** หัวจดหมายแบบตัวอักษร — `{{block.logo}}` เมื่อไม่มีรูปโลโก้ให้ใช้เลย (build ลืม copy src/assets และไม่มีใครอัปโหลด) */
export function textLogo(): string {
  return `<div style="font:700 20px/1.3 ${FONT};color:${NAVY};letter-spacing:-0.01em;">BDI<span style="color:${CORAL};">.</span></div>`;
}

export interface ButtonSpec {
  url: string;
  /**
   * ลิงก์ที่พิมพ์ให้ตาเห็นใต้ปุ่ม เผื่อปุ่มกดไม่ได้ — ไม่ส่งมา = ใช้ `url` · `null` = ไม่พิมพ์บล็อกนี้เลย
   *
   * อีเมลคำเชิญใช้ `null` เพราะที่อยู่สำหรับลงทะเบียนกับ Activation Key พิมพ์แยกไว้ในเนื้อความแล้ว และลิงก์ของมันมี token ต่อท้าย
   */
  fallback?: string | null;
}

/** `{{block.button}}` — ข้อความบนปุ่มมาจากช่อง "ข้อความบนปุ่ม" ของเทมเพลต (escape แล้ว) ส่วน URL มาจากระบบเสมอ */
export function buttonBlock(button: ButtonSpec, labelHtml: string): string {
  const fallback =
    button.fallback === null
      ? ""
      : `<p style="margin:16px 0 0;font:400 12px/1.6 ${FONT};color:${MUTED};word-break:break-all;">
                   หากปุ่มด้านบนไม่ทำงาน กรุณาคัดลอกลิงก์ต่อไปนี้และเปิดในเบราว์เซอร์ของคุณ:<br>
                   <span style="color:${NAVY};">${escapeHtml(button.fallback ?? button.url)}</span>
                 </p>`;
  return `<a href="${escapeHtml(button.url)}"
                    style="display:inline-block;background:${CORAL};color:#FFFFFF;text-decoration:none;
                           font:600 15px/1 ${FONT};padding:15px 28px;border-radius:999px;">
                   ${labelHtml}
                 </a>${fallback}`;
}

/**
 * `{{block.orgCode}}` — บรรทัด "รหัสหน่วยงาน" ใต้ย่อหน้าเปิด
 *
 * คืนสตริงว่างเมื่อไม่มีรหัส — ป้ายเปล่า ๆ ที่ตามด้วยความว่างอ่านเหมือนระบบทำข้อมูลหาย ผู้รับที่ดูแลหลายหน่วยงาน (เจ้าหน้าที่ BDI)
 * กวาดตาหาที่เดิมได้ทุกฉบับ จึงอยู่ตำแหน่งเดียวกันในเนื้อหาตั้งต้นทุกฉบับ
 */
export function orgCodeBlock(code: string | null | undefined): string {
  if (!code) return "";
  return `<p style="margin:10px 0 0;font:400 13px/1.6 ${FONT};color:${MUTED};">
            รหัสหน่วยงาน <strong style="color:${TEXT};">${escapeHtml(code)}</strong>
          </p>`;
}

/** `{{block.summary}}` — ตารางสรุป "ป้าย: ค่า" ที่ยกข้อมูลที่ผู้อ่านต้องเห็นออกมาจากย่อหน้า */
export function summaryBlock(rows: Array<[string, string]>): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border:1px solid ${BORDER};border-radius:12px;border-collapse:separate;overflow:hidden;">
    ${rows
      .map(
        ([label, value]) => `<tr>
          <td style="padding:10px 14px;background:#F6F7FB;font:400 13px/1.6 ${FONT};color:${MUTED};width:38%;">${escapeHtml(label)}</td>
          <td style="padding:10px 14px;font:600 13px/1.6 ${FONT};color:${TEXT};">${escapeHtml(value)}</td>
        </tr>`,
      )
      .join("")}
  </table>`;
}

/** `{{block.activation}}` — กล่อง URL สำหรับลงทะเบียน + Activation Key (ฉบับเดียวที่ถือคีย์ตัวจริง) */
export function activationBlock(activateUrl: string, key: string): string {
  return `<div style="background:#F6F7FB;border:1px solid ${BORDER};border-radius:12px;padding:20px;">
           <div style="font:400 13px/1.6 ${FONT};color:${MUTED};">URL สำหรับลงทะเบียน</div>
           <div style="margin-top:4px;font:600 15px/1.6 ${FONT};color:${NAVY};word-break:break-all;">${escapeHtml(activateUrl)}</div>
           <div style="margin-top:14px;font:400 13px/1.6 ${FONT};color:${MUTED};">Activation Key</div>
           <div style="margin-top:4px;font:700 15px/1.6 'Courier New',Courier,monospace;color:${TEXT};word-break:break-all;">${escapeHtml(key)}</div>
         </div>`;
}

/** `{{block.otp}}` — **อย่าเปลี่ยน markup** `send()` ใน dry-run หาเลขรหัสด้วย `letter-spacing:8px` */
export function otpBlock(code: string): string {
  return `<div style="background:#F6F7FB;border:1px solid ${BORDER};border-radius:12px;padding:20px;text-align:center;">
               <span style="font:700 32px/1 ${FONT};color:${NAVY};letter-spacing:8px;">${escapeHtml(code)}</span>
             </div>`;
}

/**
 * `{{block.note}}` — กล่องข้อความของผู้ตรวจสอบ (สิ่งที่ต้องแก้ไข / เหตุผล / ความเห็นของผู้เชี่ยวชาญ)
 *
 * หัวกล่องและโทนสีเป็นของแต่ละเทมเพลต (กำหนดในโค้ดที่ส่ง) ข้อความเป็นของคนพิมพ์ จึงไม่ใช่ตัวแปรธรรมดา: มันต้อง `pre-wrap` อยู่ในกล่อง
 */
export function noteBlock(opts: { heading: string; text: string; tone: "danger" | "info"; byline?: string | null }): string {
  const accent = opts.tone === "danger" ? DANGER : NAVY;
  const bg = opts.tone === "danger" ? DANGER_BG : "#F3F5FB";
  const byline = opts.byline
    ? `<div style="margin-top:12px;font:400 12px/1.6 ${FONT};color:${MUTED};">${escapeHtml(opts.byline)}</div>`
    : "";
  return `<div style="background:${bg};border-left:3px solid ${accent};border-radius:8px;padding:16px;">
               <div style="font:600 13px/1 ${FONT};color:${accent};margin-bottom:8px;">${escapeHtml(opts.heading)}</div>
               <div style="font:400 15px/1.7 ${FONT};color:${TEXT};white-space:pre-wrap;">${escapeHtml(opts.text)}</div>${byline}
             </div>`;
}

/**
 * `{{block.steps}}` — บล็อก "สถานะคำขอ"
 *
 * ผู้รับอีเมลส่วนใหญ่ไม่ได้เปิดหน้าจอตาม จึงต้องเห็นตรงนี้ว่าคำขอมีทั้งหมดกี่ขั้น อยู่ขั้นไหน และหลังจากนี้ใครทำอะไร — ข้อมูลชุดเดียวกับ
 * stepper บนหน้าจอ เครื่องหมายใช้ตัวอักษรธรรมดา ไม่ใช่อิโมจิ เพราะไคลเอนต์บางตัวเรนเดอร์อิโมจิเป็นบิตแมปสีที่สูงกว่าบรรทัด
 */
export function stepsBlock(progress: JourneyProgress | null | undefined): string {
  if (!progress || progress.steps.length === 0) return "";

  // หัวบล็อกบอกทั้งตำแหน่งและสิ่งที่คำขอกำลังรออยู่ — "ขั้นตอนที่ 4 จาก 4" ลอย ๆ ไม่ได้ตอบว่าตอนนี้ค้างอยู่ที่ใคร
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
            ? { glyph: "&#10007;", color: DANGER }
            : step.state === "CURRENT"
              ? { glyph: "&#9654;", color: CORAL }
              : { glyph: "&#9675;", color: MUTED };
      const emphasis = step.state === "CURRENT" ? 600 : 400;
      const color = step.state === "UPCOMING" ? MUTED : TEXT;
      const number = step.order ? `${step.order}. ` : "";
      const suffix = step.optional ? " (เมื่อผู้ประสานงานของ BDI มอบหมาย)" : "";
      // ขั้นที่ยังไม่เกิดขึ้นต้องอ่านว่า "รอ" — เดิมทุกขั้นเขียน "โดย…" เหมือนกันหมด ขั้นที่คำขอค้างอยู่จึงอ่านเหมือนทำไปแล้ว
      const doer = step.state === "CURRENT" ? "รอดำเนินการโดย" : "ดำเนินการโดย";

      return `<tr>
        <td width="24" valign="top" style="padding:6px 0;font:600 14px/1.6 ${FONT};color:${mark.color};">${mark.glyph}</td>
        <td valign="top" style="padding:6px 0;font:${emphasis} 14px/1.6 ${FONT};color:${color};">
          ${number}${escapeHtml(step.label)}${suffix}
          <div style="font:400 12px/1.6 ${FONT};color:${MUTED};">${doer}${escapeHtml(step.roleLabel)}</div>
        </td>
      </tr>`;
    })
    .join("");

  const next = progress.nextStep
    ? `<div style="margin-top:12px;font:400 13px/1.6 ${FONT};color:${MUTED};">
         ขั้นต่อไป: <span style="color:${TEXT};">${escapeHtml(progress.nextStep.label)}</span>
       </div>`
    : "";

  return `<div style="font:600 16px/1.4 ${FONT};color:${TEXT};margin-bottom:12px;">สถานะคำขอ</div>
  <div style="border:1px solid ${BORDER};border-radius:12px;padding:16px;">
    <div style="font:600 13px/1.5 ${FONT};color:${NAVY};margin-bottom:12px;">${heading}</div>
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">${rows}</table>
    ${next}
  </div>`;
}
