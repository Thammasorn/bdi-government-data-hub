/**
 * ส่งอีเมล — transport (SMTP / dry-run) และอีเมลแต่ละชนิดที่ระบบส่ง
 *
 * **เนื้อความไม่ได้อยู่ที่นี่แล้ว** (การ์ด "[New Feature] Admin Email Template Edit", 2026-11-08): ทุกฉบับ render จากเทมเพลตที่ผู้ดูแลระบบแก้ได้
 * ที่ /console → ตั้งค่า › เทมเพลตอีเมล (`lib/email/`) ฟังก์ชันในไฟล์นี้เหลือหน้าที่เตรียม**ค่า**ให้เทมเพลต — ตัวแปร (`vars`, ข้อความดิบ
 * escape ตอนเติม) บล็อกของระบบ (`blocks`) และลิงก์ของปุ่ม — ผ่าน `*Context()` ซึ่ง preview กับอีเมลทดสอบเรียกด้วยข้อมูลตัวอย่าง
 * (`lib/email/samples.ts`) อีเมลจริงกับ preview จึงประกอบด้วยโค้ดชุดเดียวกัน
 *
 * signature ของฟังก์ชัน `send*` ไม่เปลี่ยน ผู้เรียก (routes, workers/render.ts) จึงไม่ต้องรู้ว่ามีเทมเพลต
 */
import net from "node:net";

import nodemailer, { type Transporter } from "nodemailer";

import { prisma } from "../db.js";
import { env } from "../env.js";
import { addBreadcrumb } from "./context.js";
import { thaiDuration } from "./duration.js";
import {
  LOGO_CID,
  activationBlock,
  escapeHtml,
  logo,
  noteBlock,
  orgCodeBlock,
  otpBlock,
  stepsBlock,
  summaryBlock,
} from "./email/blocks.js";
import { INVITATION_SUBJECT_DEFAULT } from "./email/catalogue.js";
import { composeEmail, defaultLayout } from "./email/compose.js";
import { renderEmail, renderSubject, type EmailContext } from "./email/render.js";
import { contentAt } from "./email/store.js";
import type { JourneyProgress } from "./journey-steps.js";

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

/** การส่งที่มีเพดานเวลาทั้งฉบับ (`sendRaw(…, {timeoutMs})`) ไม่จบในเวลา — ตอนที่ error นี้ออกมา การเชื่อมต่อของมันถูกปิดแล้ว */
export class SendDeadlineError extends Error {
  constructor(ms: number) {
    super(`ส่งอีเมลเกิน ${ms / 1000} วินาที — ปิดการเชื่อมต่อแล้ว`);
    this.name = "SendDeadlineError";
  }
}

/**
 * ส่งหนึ่งฉบับให้จบภายใน `timeoutMs` ทั้งฉบับ ไม่งั้นปิดการเชื่อมต่อทิ้ง — ของอีเมลสรุป error (workers/error-alerts.ts)
 * เพราะ SMTP ของจริงคือ Office 365 ซึ่งรับการเชื่อมต่อพร้อมกันได้ราวสามตัว
 *
 * timeout ของ nodemailer เป็นเพดาน**ต่อช่วงเงียบ** ไม่ใช่ทั้งฉบับ: `socketTimeout` เริ่มนับใหม่ทุกครั้งที่ server ตอบ server ที่ตอบ
 * ทุก 19 วินาทีจึงถือการเชื่อมต่อไว้ได้ขั้นละเกือบ 20 วินาที ทุกขั้นของ SMTP (EHLO, STARTTLS, AUTH, MAIL, RCPT, DATA …) — รวม
 * กันเป็นนาที การเลิกรอด้วย `Promise.race` ก็ไม่ได้ปิดอะไร และ `close()` ของ transport แบบไม่ใช้ pool ไม่แตะการเชื่อมต่อที่กำลัง
 * ส่งเลย (nodemailer 9: แค่ emit `close`) เดิมตรงนี้เป็น transport ที่ตั้ง timeout สั้นลงอย่างเดียว ความเห็นเดิมเขียนว่า Office 365
 * "ไม่เห็นการเชื่อมต่อที่ค้างนานกว่าการรอ" ซึ่งไม่จริง: ตรวจแบบค้าน 2026-10-01 ด้วย server ที่ตอบทุก 19 วินาที การส่งอยู่ต่อหลัง
 * 30 วินาทีที่เลิกรอไปแล้ว
 *
 * ที่นี่จึงเปิด socket เอง (`getSocket` ของ nodemailer ส่ง socket ที่เปิดแล้วเข้าไปเป็น `connection`) แล้วทำลายมันเมื่อครบเวลา
 * TLS ที่ห่อ socket นั้น (STARTTLS ของ Office 365 หรือพอร์ต 465 — nodemailer upgrade บน socket ที่ส่งเข้าไป ชื่อ SNI มาจาก
 * `host`) ปิดตามเมื่อ socket ข้างล่างปิด transport สร้างใหม่ต่อฉบับเพราะ socket ผูกกับการส่งครั้งนั้น timeout ของ nodemailer ยังอยู่
 * (ต่อจนได้คำทักทาย 10 วินาที, เงียบกลางการคุย 20 วินาที) ให้ server ที่เงียบสนิทล้มเร็วกว่าเพดานรวม ลองแล้ว 2026-10-01 กับ
 * SMTP ปลอมที่ตอบทุก 19 วินาทีหลัง RCPT ทั้งแบบ plain และ STARTTLS: server เห็นการเชื่อมต่อถูกปิดที่ 30.0 วินาทีพอดี
 * ส่งสำเร็จแล้วรอ QUIT ให้ socket ปิดก่อนคืน (`QUIT_WAIT_MS`) — ผู้เรียกที่ส่งทีละฉบับจึงไม่มีสองการเชื่อมต่อซ้อนกันแม้แต่ช่วงสั้น ๆ
 * ไม่เปลี่ยน transport ปกติ: อีเมลของ outbox กับอีเมลที่ส่งจากคำขอไม่มีเพดานเวลา และค่าที่สั้นลงเปลี่ยนพฤติกรรมของมัน
 */
async function sendWithDeadline(to: string, subject: string, html: string, timeoutMs: number): Promise<void> {
  const sockets: net.Socket[] = [];
  const tx = nodemailer.createTransport({
    host: env.smtp.host,
    port: env.smtp.port,
    secure: env.smtp.secure,
    auth: { user: env.smtp.user, pass: env.smtp.pass },
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    getSocket: (_options: unknown, callback: (err: Error | null, socketOptions: { connection: net.Socket }) => void) => {
      const socket = net.connect({ host: env.smtp.host, port: env.smtp.port });
      sockets.push(socket);
      callback(null, { connection: socket });
    },
  });
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      for (const socket of sockets) socket.destroy();
      reject(new SendDeadlineError(timeoutMs));
    }, timeoutMs);
  });
  const work = sendMailVia(tx, to, subject, html);
  // การส่งที่ถูกตัดล้มตามมาทีหลัง ("Connection closed") — ผลออกไปทาง deadline แล้ว ต้องไม่กลายเป็น unhandled rejection
  work.catch(() => undefined);
  try {
    await Promise.race([work, deadline]);
    // `sendMail` จบเมื่อ server รับฉบับแล้ว แต่ socket ยังคุย QUIT อยู่ราวร้อยมิลลิวินาที — รอให้ปิดก่อนคืน (ไม่เกิน QUIT_WAIT_MS)
    // ไม่งั้นผู้รับคนถัดไปเปิดการเชื่อมต่อที่สองซ้อนตอนนั้นพอดี (เห็นจาก server ปลอม 2026-10-01: สองตัวเปิดพร้อมกันทุกครั้ง)
    await Promise.race([Promise.all(sockets.map(closed)), new Promise((resolve) => setTimeout(resolve, QUIT_WAIT_MS))]);
  } finally {
    clearTimeout(timer);
    for (const socket of sockets) socket.destroy();
    tx.close();
  }
}

/** รอ QUIT ของฉบับที่ส่งแล้วได้ไม่เกินเท่านี้ ครบแล้วตัดทิ้ง — ฉบับนั้น server รับไปแล้ว */
const QUIT_WAIT_MS = 2_000;

function closed(socket: net.Socket): Promise<void> {
  if (socket.destroyed) return Promise.resolve();
  return new Promise((resolve) => socket.once("close", () => resolve()));
}
/** `timeoutMs`: เพดานเวลาทั้งฉบับ ครบแล้วปิดการเชื่อมต่อ (`sendWithDeadline`) — ไม่ส่งมา = transport ปกติ ไม่มีเพดาน */
async function send(to: string, subject: string, html: string, timeoutMs?: number): Promise<void> {
  const tx = getTransporter();
  if (!tx) {
    // ยังไม่ตั้งค่า SMTP — พิมพ์ลง log เพื่อให้ทดสอบ flow ได้โดยไม่ต้องมีเมลจริง
    console.log(`\n[mail:dry-run] ถึง: ${to}\n[mail:dry-run] เรื่อง: ${subject}`);
    const link = /href="([^"]+)"/.exec(html)?.[1];
    if (link) console.log(`[mail:dry-run] ลิงก์: ${link}`);
    const otp = /letter-spacing:8px[^>]*>(\d{6})</.exec(html)?.[1];
    if (otp) console.log(`[mail:dry-run] รหัส OTP: ${otp}`);
    console.log("");
    addBreadcrumb("smtp", "ไม่ได้ตั้ง SMTP — พิมพ์อีเมลลง log แทน (dry-run)");
    return;
  }
  /**
   * breadcrumb บอกแค่ส่งได้หรือไม่ได้กับรหัสตอบกลับของ SMTP — **ไม่มีที่อยู่ผู้รับหรือหัวเรื่อง** เพราะ breadcrumb
   * ลง error event ทั้งก้อน inline SMTP หลัง commit ที่ล้ม (ตอบ 500 ทั้งที่งานสำเร็จแล้ว, plan §13 #6) จึงเห็นได้จาก
   * breadcrumb ของ event ว่า audit เขียนแล้ว แล้วค่อยมาล้มที่อีเมล
   */
  try {
    if (timeoutMs === undefined) await sendMailVia(tx, to, subject, html);
    else await sendWithDeadline(to, subject, html, timeoutMs);
  } catch (err) {
    const code = (err as { responseCode?: unknown; code?: unknown }).responseCode ?? (err as { code?: unknown }).code;
    addBreadcrumb("smtp", `ส่งอีเมลไม่สำเร็จ${typeof code === "string" || typeof code === "number" ? ` (${code})` : ""}`, false);
    throw err;
  }
  addBreadcrumb("smtp", "ส่งอีเมลสำเร็จ");
}

async function sendMailVia(tx: Transporter, to: string, subject: string, html: string): Promise<void> {
  await tx.sendMail({
    from: env.smtp.from,
    /**
     * คำตอบต้องไปที่กล่องที่มีคนอ่าน ไม่ใช่กล่องที่ระบบใช้ส่ง (feedback 2026-09-23 แถว 2)
     *
     * `SMTP_FROM` เขียนว่า no-reply@ แต่ Exchange เขียน From ทับด้วยบัญชีที่ล็อกอิน
     * (`SMTP_USER`) เมื่อบัญชีนั้นไม่มีสิทธิ์ send-as ผู้รับที่กด reply จึงได้กล่องส่งของ
     * ระบบ Reply-To ไม่ถูกเขียนทับแบบนั้น และไคลเอนต์ทุกตัวเคารพมันเหนือ From
     *
     * ไม่ตั้ง `SMTP_REPLY_TO` = ไม่ส่งหัวข้อนี้เลย (`undefined` ไม่ใช่สตริงว่าง — สตริงว่าง
     * จะกลายเป็นหัวข้อ `Reply-To:` เปล่า ๆ ที่ไคลเอนต์บางตัวอ่านเป็นที่อยู่ผิดรูป)
     */
    replyTo: env.smtp.replyTo || undefined,
    to,
    subject,
    html,
    attachments: logo
      ? [{ filename: "bdi-logo.png", content: logo, cid: LOGO_CID, contentType: "image/png" }]
      : [],
  });
}

/**
 * หน่วยงานที่อีเมลฉบับหนึ่งพูดถึง — ชื่อกับรหัสเดินทางด้วยกันเสมอ
 * `code` เป็น null ได้จริง — คำขอที่ยังไม่ได้ออกรหัสให้
 */
export interface OrgIdentity {
  name: string;
  /** รหัสหน่วยงาน — null ได้ ถ้าคำขอใบนั้นยังไม่มีรหัส */
  code: string | null;
}

const BKK = "Asia/Bangkok";
/** "11 กันยายน 2569" — อีเมลมีตัวจัดรูปแบบของตัวเอง ไม่พึ่ง thaiLongDate() ของเอกสารข้อตกลงที่ฝ่ายกฎหมายสั่งเปลี่ยนได้ */
const dateLong = (d: Date) => new Intl.DateTimeFormat("th-TH", { dateStyle: "long", timeZone: BKK }).format(d);
/** "11 กันยายน 2569 16:30" — ไม่มี "น." ต่อท้าย เทมเพลตเติมเองถ้าต้องการ */
const dateTimeLong = (d: Date) =>
  new Intl.DateTimeFormat("th-TH", { dateStyle: "long", timeStyle: "short", timeZone: BKK }).format(d);
const dateTimeMedium = (d: Date) =>
  new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: BKK }).format(d);

/** ประกอบจากเทมเพลตที่ใช้งานอยู่แล้วส่งถึงทุกคน (ไม่ซ้ำ) — render ครั้งเดียว ทุกคนได้ฉบับเดียวกัน */
async function deliver(to: string | string[], ctx: EmailContext): Promise<void> {
  const recipients = [...new Set((Array.isArray(to) ? to : [to]).filter(Boolean))];
  if (recipients.length === 0) return;
  const { subject, html } = await composeEmail(ctx);
  await Promise.all(recipients.map((addr) => send(addr, subject, html)));
}

/** ส่งอีเมลที่ประกอบแล้ว — อีเมลทดสอบของหน้าแก้เทมเพลต (`POST /api/admin/email-templates/:key/test-send`) */
export async function sendRendered(to: string, subject: string, html: string): Promise<void> {
  await send(to, subject, html);
}

/**
 * ส่งอีเมลจากแถวใน notification outbox และสรุป error (workers/error-alerts.ts)
 *
 * **ไม่ใช่เทมเพลตที่แก้ได้** และใช้แม่แบบกลางฉบับตั้งต้นในโค้ด ไม่อ่านฐานข้อมูล: สรุป error ต้องส่งได้แม้ฐานข้อมูลล่ม ไม่รับ HTML จากผู้เรียก
 * เพราะข้อความมาจากฐานข้อมูล ต้อง escape ก่อนเสมอ (`{` escape ด้วย เพื่อไม่ให้ข้อความที่มี `{{…}}` ถูกอ่านเป็น placeholder)
 */
export async function sendRaw(
  to: string,
  title: string,
  message: string,
  options: { lineBreaks?: boolean; timeoutMs?: number } = {},
): Promise<void> {
  const text = (s: string) => escapeHtml(s).replace(/\{/g, "&#123;");
  const intro = options.lineBreaks ? text(message).replace(/\n/g, "<br>") : text(message);
  const { html } = renderEmail({
    content: {
      subject: "",
      bodyHtml:
        `<h1 style="margin:0 0 12px;font:600 22px/1.4 'Helvetica Neue',Arial,sans-serif;color:#141A33;">${text(title)}</h1>` +
        `<p style="margin:0;font:400 15px/1.7 'Helvetica Neue',Arial,sans-serif;color:#5B6178;">${intro}</p>`,
      buttonLabel: null,
      footnoteHtml:
        "อีเมลฉบับนี้ส่งจากระบบอัตโนมัติ กรุณาอย่าตอบกลับอีเมลฉบับนี้<br>หากมีข้อสงสัยหรือประสบปัญหาในการดำเนินการ สามารถติดต่อ{{support.contact}}",
    },
    layout: defaultLayout(),
    ctx: { key: "raw", vars: {}, blocks: {} },
  });
  await send(to, title, html, options.timeoutMs);
}

// ------------------------------------------------------------------ บัญชีผู้ใช้

export interface InvitationInfo {
  roleLabel: string;
  organizationName: string;
  expiresAt: Date;
  internal: boolean;
}

/**
 * คำเชิญเข้าใช้งานระบบ — ฉบับเดียวที่ถือ Activation Key ตัวจริง
 *
 * ปุ่มพา token ไปให้ (กดครั้งเดียวจบ) แต่ลิงก์สำรองใต้ปุ่มไม่พิมพ์ (`fallback: null`) เพราะ URL `/activate` เปล่า ๆ กับคีย์พิมพ์แยกกันไว้ใน
 * `{{block.activation}}` แล้ว ลิงก์ที่มี token ต่อท้ายยาว อ่านไม่รู้เรื่อง และติดไปกับภาพที่ผู้รับแคปหน้าจอ
 */
export function invitationContext(key: string, info: InvitationInfo): EmailContext {
  const activateUrl = `${env.appUrl}/activate`;
  return {
    key: info.internal ? "invitation_internal" : "invitation_external",
    vars: {
      "org.name": info.organizationName,
      "role.label": info.roleLabel,
      "expires.date": dateLong(info.expiresAt),
      "activation.validFor": thaiDuration(env.auth.activationKeyTtlSeconds),
    },
    blocks: {
      summary: summaryBlock([
        ["หน่วยงาน", info.organizationName],
        ["บทบาทในระบบ", info.roleLabel],
      ]),
      activation: activationBlock(activateUrl, key),
    },
    button: { url: `${activateUrl}?token=${key}`, fallback: null },
  };
}

export async function sendInvitationEmail(to: string, key: string, info: InvitationInfo) {
  await deliver(to, invitationContext(key, info));
}

export interface InvitationReminderInfo {
  roleLabel: string;
  organizationName: string;
  issuedAt: Date;
  expiresAt: Date;
  internal: boolean;
}

export function invitationReminderContext(info: InvitationReminderInfo, invitationSubject: string): EmailContext {
  const sentAt = `${dateTimeLong(info.issuedAt)} น.`;
  const expiresAt = `${dateTimeLong(info.expiresAt)} น.`;
  return {
    key: "invitation_reminder",
    vars: {
      "org.name": info.organizationName,
      "recipient.greeting": info.internal ? `เจ้าหน้าที่${info.organizationName}` : `ผู้ใช้งาน ${info.organizationName}`,
      "role.label": info.roleLabel,
      "invitation.subject": invitationSubject,
      "invitation.sentAt": dateTimeLong(info.issuedAt),
      "expires.dateTime": dateTimeLong(info.expiresAt),
    },
    blocks: {
      summary: summaryBlock([
        ["หน่วยงาน", info.organizationName],
        ["บทบาทในระบบ", info.roleLabel],
        ["หัวข้ออีเมลคำเชิญ", invitationSubject],
        ["วันที่ส่งอีเมลคำเชิญ", sentAt],
        ["ใช้ได้ถึง", expiresAt],
      ]),
    },
  };
}

/**
 * หัวเรื่องของคำเชิญฉบับที่ผู้รับได้รับจริง — เวอร์ชันของเทมเพลตคำเชิญที่ใช้งานอยู่ตอนออกคีย์ (`issuedAt`) ไม่ใช่เวอร์ชันปัจจุบัน
 *
 * ผู้ดูแลอาจเปลี่ยนหัวเรื่องหลังส่งคำเชิญ ถ้าอีเมลเตือนพิมพ์หัวเรื่องใหม่ ผู้รับจะค้นกล่องจดหมายแล้วไม่เจอ อ่านไม่ได้ = หัวเรื่องตั้งต้น
 */
async function invitationSubjectAt(info: InvitationReminderInfo): Promise<string> {
  const vars = {
    "org.name": info.organizationName,
    "role.label": info.roleLabel,
    "expires.date": dateLong(info.expiresAt),
    "activation.validFor": thaiDuration(env.auth.activationKeyTtlSeconds),
  };
  try {
    const content = await contentAt(prisma, info.internal ? "invitation_internal" : "invitation_external", info.issuedAt);
    return renderSubject(content.subject, vars);
  } catch {
    return renderSubject(INVITATION_SUBJECT_DEFAULT, vars);
  }
}

/**
 * เตือนว่าคำเชิญใกล้หมดอายุ — ส่งครั้งเดียวต่อคีย์ N วันก่อนหมดอายุ (`invitation_reminder_days`)
 *
 * **ไม่มีลิงก์และไม่มี Activation Key** ระบบเก็บแค่ HMAC ของคีย์ จึงสร้างลิงก์เดิมซ้ำไม่ได้ อีเมลจึงบอกสิ่งที่ผู้รับใช้หาอีเมลคำเชิญฉบับเดิม
 * ได้ — หัวเรื่องและวันเวลาที่ส่ง `issuedAt` คือวันที่ของคีย์ใบที่ยังใช้ได้ (คำเชิญที่ถูกส่งซ้ำได้คีย์ใบใหม่)
 */
export async function sendInvitationReminderEmail(to: string, info: InvitationReminderInfo) {
  await deliver(to, invitationReminderContext(info, await invitationSubjectAt(info)));
}

export interface PasswordResetInfo {
  displayName: string | null;
  expiresAt: Date;
}

/**
 * ลิงก์ตั้งรหัสผ่านใหม่ — ออกให้โดยผู้ดูแลระบบ ไม่ใช่เจ้าตัวกด "ลืมรหัสผ่าน" เอง ลิงก์ใช้ได้ครั้งเดียวและอายุเป็นนาที
 * จึงพิมพ์เวลาหมดอายุเป็นเวลาไทยไม่ใช่แค่วันที่
 */
export function passwordResetContext(to: string, token: string, info: PasswordResetInfo): EmailContext {
  return {
    key: "password_reset",
    vars: {
      "recipient.name": info.displayName || "ผู้ใช้งานระบบ",
      "account.email": to,
      "expires.dateTime": dateTimeLong(info.expiresAt),
    },
    blocks: {},
    button: { url: `${env.appUrl}/reset-password?token=${token}` },
  };
}

export async function sendPasswordResetEmail(to: string, token: string, info: PasswordResetInfo) {
  await deliver(to, passwordResetContext(to, token, info));
}

export function otpContext(code: string): EmailContext {
  return {
    key: "otp",
    vars: { "otp.code": code, "otp.validFor": thaiDuration(env.auth.otpTtlSeconds) },
    blocks: { otp: otpBlock(code) },
  };
}

export async function sendOtpEmail(to: string, code: string) {
  await deliver(to, otpContext(code));
}

export interface RoleRemovedInfo {
  organizationName: string;
  roleLabel: string;
  successorName: string | null;
  removedAt: Date | null;
}

/**
 * แจ้งคนที่ถูกถอดออกจากหน่วยงานเพราะมีคนมารับ role แทน — ไม่มีปุ่มพาไปไหน คนรับอีเมลนี้ไม่มีหน่วยงานให้เปิดแล้ว
 * และปุ่ม "สร้างหน่วยงาน" คือสิ่งที่ทำให้เกิดหน่วยงานซ้ำมาแล้ว ทางไปต่อที่ถูกคือติดต่อผู้ดูแลระบบ
 */
export function roleRemovedContext(info: RoleRemovedInfo): EmailContext {
  return {
    key: "role_removed",
    vars: {
      "org.name": info.organizationName,
      "role.label": info.roleLabel,
      "successor.name": info.successorName ?? "ผู้ใช้รายใหม่",
      "removed.atPhrase": info.removedAt ? ` เมื่อ ${dateTimeLong(info.removedAt)}` : "",
    },
    blocks: {},
  };
}

export async function sendRoleRemoved(to: string, info: RoleRemovedInfo) {
  await deliver(to, roleRemovedContext(info));
}

// ------------------------------------------------------------------ คำขอหน่วยงาน (Journey B)

function orgContext(
  key: string,
  org: OrgIdentity,
  progress: JourneyProgress | null | undefined,
  url: string,
  extra: { vars?: Record<string, string>; blocks?: EmailContext["blocks"] } = {},
): EmailContext {
  return {
    key,
    vars: { "org.name": org.name, "org.code": org.code ?? "", ...extra.vars },
    blocks: { orgCode: orgCodeBlock(org.code), steps: stepsBlock(progress), ...extra.blocks },
    button: { url },
  };
}

const orgAdminLink = (id: string) => `${env.appUrl}/admin/organizations/${id}`;
const orgUserLink = (id: string) => `${env.appUrl}/organizations/${id}`;

export function orgSubmittedContext(org: OrgIdentity, submitter: string, orgId: string, progress?: JourneyProgress | null) {
  return orgContext("org_submitted", org, progress, orgAdminLink(orgId), { vars: { "submitter.name": submitter } });
}

export async function sendSubmittedToOfficers(
  to: string[],
  org: OrgIdentity,
  submitter: string,
  orgId: string,
  progress?: JourneyProgress | null,
) {
  await deliver(to, orgSubmittedContext(org, submitter, orgId, progress));
}

export function orgRevisionContext(org: OrgIdentity, note: string, orgId: string, progress?: JourneyProgress | null) {
  return orgContext("org_revision", org, progress, orgUserLink(orgId), {
    blocks: { note: noteBlock({ heading: "สิ่งที่ต้องแก้ไข", text: note, tone: "danger" }) },
  });
}

export async function sendRevisionRequested(
  to: string,
  org: OrgIdentity,
  note: string,
  orgId: string,
  progress?: JourneyProgress | null,
) {
  await deliver(to, orgRevisionContext(org, note, orgId, progress));
}

/** ผู้มีอำนาจที่ยังไม่มีบัญชีได้ปุ่มลงทะเบียน (`org_signatory_register`) — คนละเทมเพลตกับคนที่มีบัญชีแล้ว */
export function signatoryRequestContext(
  org: OrgIdentity,
  orgId: string,
  registerToken?: string,
  progress?: JourneyProgress | null,
) {
  return registerToken
    ? orgContext("org_signatory_register", org, progress, `${env.appUrl}/register?token=${registerToken}`)
    : orgContext("org_signatory_request", org, progress, orgUserLink(orgId));
}

export async function sendSignatoryRequest(
  to: string,
  org: OrgIdentity,
  orgId: string,
  registerToken?: string,
  progress?: JourneyProgress | null,
) {
  await deliver(to, signatoryRequestContext(org, orgId, registerToken, progress));
}

export function finalApprovalContext(org: OrgIdentity, orgId: string, progress?: JourneyProgress | null) {
  return orgContext("org_final_approval", org, progress, orgAdminLink(orgId));
}

export async function sendFinalApprovalRequest(
  to: string[],
  org: OrgIdentity,
  orgId: string,
  progress?: JourneyProgress | null,
) {
  await deliver(to, finalApprovalContext(org, orgId, progress));
}

export function activatedContext(org: OrgIdentity, orgId: string, progress?: JourneyProgress | null) {
  return orgContext("org_activated", org, progress, orgUserLink(orgId));
}

export async function sendActivated(to: string[], org: OrgIdentity, orgId: string, progress?: JourneyProgress | null) {
  await deliver(to, activatedContext(org, orgId, progress));
}

// ------------------------------------------------------------------ คำขอชุดข้อมูล (Journey C)

const datasetOrgLink = (id: string) => `${env.appUrl}/datasets/${id}`;
const datasetBdiLink = (id: string) => `${env.appUrl}/admin/datasets/${id}`;

interface DatasetBase {
  requestNumber: string;
  organizationCode: string | null;
  datasetName: string;
  id: string;
}

function datasetContext(
  key: string,
  info: DatasetBase & { organizationName?: string },
  progress: JourneyProgress | null | undefined,
  url: string,
  extra: { vars?: Record<string, string>; blocks?: EmailContext["blocks"] } = {},
): EmailContext {
  return {
    key,
    vars: {
      "request.number": info.requestNumber,
      "dataset.name": info.datasetName,
      "org.name": info.organizationName ?? "",
      "org.code": info.organizationCode ?? "",
      ...extra.vars,
    },
    blocks: { orgCode: orgCodeBlock(info.organizationCode), steps: stepsBlock(progress), ...extra.blocks },
    button: { url },
  };
}

type WithOrg = DatasetBase & { organizationName: string };

export function datasetSubmittedContext(info: WithOrg & { submitter: string }, progress?: JourneyProgress | null) {
  return datasetContext("dataset_submitted", info, progress, datasetBdiLink(info.id), {
    vars: { "submitter.name": info.submitter },
    blocks: {
      summary: summaryBlock([
        ["เลขที่คำขอ", info.requestNumber],
        ["ชื่อชุดข้อมูล", info.datasetName],
        ["ผู้นำส่ง", info.submitter],
      ]),
    },
  });
}

export async function sendDatasetSubmitted(
  to: string[],
  info: WithOrg & { submitter: string },
  progress?: JourneyProgress | null,
) {
  await deliver(to, datasetSubmittedContext(info, progress));
}

export function datasetRevisionContext(
  info: DatasetBase & { note: string; byName: string; at: Date },
  progress?: JourneyProgress | null,
) {
  return datasetContext("dataset_revision", info, progress, datasetOrgLink(info.id), {
    blocks: {
      note: noteBlock({
        heading: "สิ่งที่ต้องแก้ไข",
        text: info.note,
        tone: "danger",
        byline: `โดย ${info.byName} · ${dateTimeMedium(info.at)}`,
      }),
    },
  });
}

export async function sendDatasetRevisionRequested(
  to: string[],
  info: DatasetBase & { note: string; byName: string; at: Date },
  progress?: JourneyProgress | null,
) {
  await deliver(to, datasetRevisionContext(info, progress));
}

const datasetSummary = (info: WithOrg, more: Array<[string, string]> = []) =>
  summaryBlock([
    ["เลขที่คำขอ", info.requestNumber],
    ["ชื่อชุดข้อมูล", info.datasetName],
    ["หน่วยงานเจ้าของข้อมูล", info.organizationName],
    ...more,
  ]);

export function datasetSpecialistCommentedContext(
  info: WithOrg & { note: string; byName: string; at: Date },
  progress?: JourneyProgress | null,
) {
  return datasetContext("dataset_specialist_commented", info, progress, datasetBdiLink(info.id), {
    blocks: {
      note: noteBlock({
        heading: "ความเห็นของผู้เชี่ยวชาญ",
        text: info.note,
        tone: "info",
        byline: `โดย ${info.byName} · ${dateTimeMedium(info.at)}`,
      }),
      summary: datasetSummary(info),
    },
  });
}

export async function sendDatasetSpecialistCommented(
  to: string[],
  info: WithOrg & { note: string; byName: string; at: Date },
  progress?: JourneyProgress | null,
) {
  await deliver(to, datasetSpecialistCommentedContext(info, progress));
}

export function datasetSpecialistAssignedContext(info: WithOrg, progress?: JourneyProgress | null) {
  return datasetContext("dataset_specialist_assigned", info, progress, datasetBdiLink(info.id), {
    blocks: { summary: datasetSummary(info) },
  });
}

export async function sendDatasetSpecialistAssigned(to: string, info: WithOrg, progress?: JourneyProgress | null) {
  await deliver(to, datasetSpecialistAssignedContext(info, progress));
}

export function datasetPendingOrgApproverContext(info: WithOrg, progress?: JourneyProgress | null) {
  return datasetContext("dataset_pending_org_approver", info, progress, datasetOrgLink(info.id), {
    blocks: {
      summary: summaryBlock([
        ["เลขที่คำขอ", info.requestNumber],
        ["ชื่อชุดข้อมูล", info.datasetName],
      ]),
    },
  });
}

export async function sendDatasetPendingOrgApprover(to: string[], info: WithOrg, progress?: JourneyProgress | null) {
  await deliver(to, datasetPendingOrgApproverContext(info, progress));
}

export function datasetSignedPendingContext(info: WithOrg & { signedBy: string }, progress?: JourneyProgress | null) {
  return datasetContext("dataset_signed_pending", info, progress, datasetBdiLink(info.id), {
    vars: { "signer.name": info.signedBy },
    blocks: { summary: datasetSummary(info, [["ผู้ลงนามเห็นชอบ", info.signedBy]]) },
  });
}

export async function sendDatasetSignedPendingApproval(
  to: string[],
  info: WithOrg & { signedBy: string },
  progress?: JourneyProgress | null,
) {
  await deliver(to, datasetSignedPendingContext(info, progress));
}

export function datasetPendingBdiContext(info: WithOrg, progress?: JourneyProgress | null) {
  return datasetContext("dataset_pending_bdi", info, progress, datasetBdiLink(info.id), {
    blocks: { summary: datasetSummary(info) },
  });
}

export async function sendDatasetPendingBdiApproval(to: string[], info: WithOrg, progress?: JourneyProgress | null) {
  await deliver(to, datasetPendingBdiContext(info, progress));
}

export function datasetApprovedContext(info: WithOrg, progress?: JourneyProgress | null) {
  return datasetContext("dataset_approved", info, progress, datasetOrgLink(info.id), {
    blocks: {
      summary: summaryBlock([
        ["เลขที่คำขอ", info.requestNumber],
        ["หน่วยงานเจ้าของข้อมูล", info.organizationName],
      ]),
    },
  });
}

export async function sendDatasetApproved(to: string[], info: WithOrg, progress?: JourneyProgress | null) {
  await deliver(to, datasetApprovedContext(info, progress));
}

export function datasetRejectedContext(info: DatasetBase & { reason: string }, progress?: JourneyProgress | null) {
  return datasetContext("dataset_rejected", info, progress, datasetOrgLink(info.id), {
    blocks: { note: noteBlock({ heading: "เหตุผล", text: info.reason, tone: "danger" }) },
  });
}

export async function sendDatasetRejected(
  to: string[],
  info: DatasetBase & { reason: string },
  progress?: JourneyProgress | null,
) {
  await deliver(to, datasetRejectedContext(info, progress));
}

// ------------------------------------------------------------------ ทั่วไป

export interface ProgressInfo {
  title: string;
  message: string;
  path: string;
  orgCode: string | null;
}

export function requestProgressedContext(info: ProgressInfo, progress?: JourneyProgress | null): EmailContext {
  return {
    key: "request_progressed",
    vars: { "progress.title": info.title, "progress.message": info.message, "org.code": info.orgCode ?? "" },
    blocks: { orgCode: orgCodeBlock(info.orgCode), steps: stepsBlock(progress) },
    button: { url: `${env.appUrl}${info.path}` },
  };
}

export async function sendRequestProgressed(to: string, info: ProgressInfo, progress?: JourneyProgress | null): Promise<void> {
  await deliver(to, requestProgressedContext(info, progress));
}
