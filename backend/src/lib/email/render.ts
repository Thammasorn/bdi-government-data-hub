/**
 * เติมค่าเทมเพลตอีเมล ตรวจตอนบันทึก และ sanitize HTML ที่ผู้ดูแลระบบเขียน (การ์ด "[New Feature] Admin Email Template Edit", 2026-11-08)
 *
 * รูปแบบ placeholder คือ `{{ชื่อ}}` อย่างเดียว ไม่มีเงื่อนไข ไม่มี loop:
 *   - `{{org.name}}` ตัวแปร — **escape HTML เสมอ** ชื่อหน่วยงานหรือข้อความที่ผู้ใช้พิมพ์จึงแทรก HTML ไม่ได้
 *   - `{{block.steps}}` บล็อกของระบบ — HTML ที่ระบบสร้าง (lib/email/blocks.ts)
 *   - `{{content}}` / `{{footnote}}` — เฉพาะแม่แบบกลาง
 *
 * HTML ผ่าน sanitize-html แบบ allowlist ก่อนเก็บ และ**ถูกปฏิเสธ**ถ้ามีสิ่งที่ allowlist ตัด (แทนที่จะตัดเงียบ ๆ) — ผู้ดูแลต้องเห็นว่าอีเมลที่
 * ส่งจริงตรงกับที่พิมพ์ ไม่ใช่ตรงกับสิ่งที่เหลือหลังระบบตัด ตัวตรวจ (`scanHtml`) กับ sanitize-html จึงใช้ allowlist ชุดเดียวกัน และ
 * sanitize-html ยังรันกับสิ่งที่ผ่านแล้วอีกรอบเป็นชั้นที่สอง
 */
import sanitizeHtml from "sanitize-html";

import { env } from "../../env.js";
import { buttonBlock, escapeHtml, textLogo, type ButtonSpec } from "./blocks.js";
import { LOGO_CODE, type EmailAttachment, type ImageAsset } from "./images.js";
import {
  BLOCK_NAMES,
  GLOBAL_VARIABLES,
  LAYOUT_KEY,
  LAYOUT_PLACEHOLDERS,
  allowedVariables,
  type BlockName,
  type TemplateContent,
  type TemplateDefinition,
} from "./catalogue.js";

/** สิ่งที่โค้ดที่ส่งอีเมลเตรียมให้เทมเพลตหนึ่งฉบับ — ค่าตัวแปรเป็นข้อความดิบ escape ตอนเติม */
export interface EmailContext {
  key: string;
  vars: Record<string, string>;
  blocks: Partial<Record<BlockName, string>>;
  button?: ButtonSpec;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  /** รูปที่อีเมลฉบับนี้อ้างจริง (`cid:`) — ส่งเป็นไฟล์แนบ */
  attachments: EmailAttachment[];
}

const PLACEHOLDER = /\{\{\s*([^{}]+?)\s*\}\}/g;

/** ช่องทางติดต่อ — ไม่มีเบอร์โทร ต้องหายไปทั้งวรรค ไม่ใช่ "โทรศัพท์  หรืออีเมล …" */
export function supportContact(): string {
  return env.support.phone ? `โทรศัพท์ ${env.support.phone} หรืออีเมล ${env.support.email}` : `อีเมล ${env.support.email}`;
}

function globalVars(): Record<string, string> {
  return { "support.contact": supportContact(), "support.email": env.support.email, "app.url": env.appUrl };
}

/**
 * `<img>` ของรูปหนึ่ง — width/height เป็น attribute (Outlook ไม่อ่านขนาดจาก CSS) `preview` = data URI เพราะ iframe ของหน้าแก้ไม่มีไฟล์แนบ
 * ให้อ้าง อีเมลจริงไม่มีวันได้ data URI: Gmail บล็อกรูปแบบนั้น
 */
function imageTag(asset: ImageAsset, preview: boolean): string {
  const src = preview ? `data:${asset.contentType};base64,${asset.content.toString("base64")}` : `cid:${asset.cid}`;
  return `<img src="${src}" width="${asset.width}" height="${asset.height}" alt="${escapeHtml(asset.altText)}" style="display:block;border:0;outline:none;text-decoration:none;">`;
}

/** เติมเทมเพลตในบริบท HTML — ตัวแปร escape, บล็อก รูป และ `extra` (content/footnote) วางตามที่ได้มา, ชื่อที่ไม่รู้จักกลายเป็นว่าง */
function fillHtml(
  template: string,
  vars: Record<string, string>,
  blocks: Partial<Record<string, string>>,
  extra: Record<string, string> = {},
  images: Partial<Record<string, string>> = {},
): string {
  return template.replace(PLACEHOLDER, (_m, raw: string) => {
    const name = raw.trim();
    if (name.startsWith("block.")) return blocks[name.slice(6)] ?? "";
    if (name.startsWith("image.")) return images[name.slice(6)] ?? "";
    if (name in extra) return extra[name] ?? "";
    return escapeHtml(vars[name] ?? "");
  });
}

/** เติมหัวเรื่อง — ข้อความล้วน ไม่ escape (หัวเรื่องไม่ใช่ HTML) และยุบช่องว่าง/ขึ้นบรรทัดให้เป็นบรรทัดเดียว */
function fillPlain(template: string, vars: Record<string, string>): string {
  return template
    .replace(PLACEHOLDER, (_m, raw: string) => vars[raw.trim()] ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

/** เติมหัวเรื่องหนึ่งบรรทัด (มีตัวแปรกลางให้) — อีเมลเตือนใช้ประกอบหัวเรื่องของคำเชิญฉบับเดิม */
export function renderSubject(subject: string, vars: Record<string, string>): string {
  return fillPlain(subject, { ...globalVars(), ...vars });
}

/**
 * ประกอบอีเมลหนึ่งฉบับจากเนื้อหาของเทมเพลต + แม่แบบกลาง + ค่าที่โค้ดเตรียมให้
 * `preview` = โลโก้เป็น data URI (iframe ของหน้าแก้ไม่มีไฟล์แนบให้อ้าง `cid:`)
 */
export function renderEmail(opts: {
  content: TemplateContent;
  layout: TemplateContent;
  ctx: EmailContext;
  /** รูปที่เทมเพลตอ้าง (`loadImages()`) — ไม่ส่งมา = ไม่มีรูป โลโก้กลายเป็นหัวจดหมายแบบตัวอักษร */
  images?: Map<string, ImageAsset>;
  preview?: boolean;
}): RenderedEmail {
  const preview = opts.preview ?? false;
  const assets = opts.images ?? new Map<string, ImageAsset>();
  const vars = { ...globalVars(), ...opts.ctx.vars };
  const imgs: Record<string, string> = {};
  for (const [code, asset] of assets) imgs[code] = imageTag(asset, preview);
  const logoAsset = assets.get(LOGO_CODE);
  const logo = logoAsset ? imgs[LOGO_CODE]! : textLogo();
  const label = fillHtml(opts.content.buttonLabel ?? "", vars, {});
  const blocks: Partial<Record<string, string>> = {
    ...opts.ctx.blocks,
    logo,
    button: opts.ctx.button ? buttonBlock(opts.ctx.button, label) : "",
  };
  const body = fillHtml(opts.content.bodyHtml, vars, blocks, {}, imgs);
  const footnote = fillHtml(opts.content.footnoteHtml ?? "", vars, {});
  const html = `<!doctype html>\n${fillHtml(opts.layout.bodyHtml, vars, { logo }, { content: body, footnote }, imgs)}`;
  // แนบเฉพาะรูปที่ html ฉบับนี้อ้างจริง — preview ไม่มีไฟล์แนบ (ใช้ data URI)
  const attachments = preview
    ? []
    : [...assets.values()]
        .filter((a) => html.includes(`cid:${a.cid}`))
        .map((a) => ({
          filename: `${a.code}.${a.contentType === "image/png" ? "png" : "jpg"}`,
          content: a.content,
          cid: a.cid,
          contentType: a.contentType,
        }));
  return { subject: fillPlain(opts.content.subject, vars), html, attachments };
}

// ------------------------------------------------------------------ allowlist + การตรวจ

const BASE_TAGS = [
  "table", "thead", "tbody", "tfoot", "tr", "td", "th", "p", "div", "span", "strong", "b", "em", "i", "u", "a", "br", "hr",
  "ul", "ol", "li", "h1", "h2", "h3", "h4", "blockquote", "small", "center", "font",
];
/** แท็กโครงเอกสารที่แม่แบบกลางเท่านั้นใช้ได้ */
const LAYOUT_TAGS = ["html", "head", "body", "meta", "title"];
/** แม่แบบกลางวางโลโก้ด้วย `{{block.logo}}` — `<img>` ที่เขียนเองโหลดรูปจากภายนอก ซึ่งเมลไคลเอนต์บล็อก และเป็นตัวติดตามการเปิดอ่าน */
const COMMON_ATTRS = [
  "style", "align", "valign", "width", "height", "bgcolor", "border", "cellpadding", "cellspacing", "role", "lang", "dir",
  "title", "colspan", "rowspan", "color", "face", "size",
];
const TAG_ATTRS: Record<string, string[]> = {
  a: ["href", "target", "rel", "name"],
  meta: ["charset", "name", "content"],
};

function policy(layout: boolean): sanitizeHtml.IOptions {
  return {
    allowedTags: layout ? [...BASE_TAGS, ...LAYOUT_TAGS] : BASE_TAGS,
    allowedAttributes: { "*": COMMON_ATTRS, ...TAG_ATTRS },
    allowedSchemes: ["https", "mailto"],
    allowedSchemesAppliedToAttributes: ["href"],
    allowProtocolRelative: false,
    // style ตรวจเอง (`url(`, `expression(`) — ไม่ให้ postcss เขียน style ของเนื้อหาตั้งต้นใหม่ทุกครั้งที่บันทึก
    parseStyleAttributes: false,
  };
}

export type ContentField = keyof TemplateContent;
export interface ContentIssue {
  field: ContentField;
  message: string;
}

const STRIP_COMMENTS = /<!--[\s\S]*?-->/g;
const TAG = /<\s*\/?\s*([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>/g;
const ATTR = /([^\s"'=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
const DANGEROUS_STYLE = /url\s*\(|expression\s*\(|javascript:|@import|behavior\s*:/i;

/** หาสิ่งที่ allowlist ไม่ยอม — คืนข้อความภาษาไทยหนึ่งข้อต่อปัญหา (ไม่ซ้ำ) */
function scanHtml(html: string, layout: boolean): string[] {
  const tags = new Set(layout ? [...BASE_TAGS, ...LAYOUT_TAGS] : BASE_TAGS);
  const found = new Set<string>();
  for (const m of html.replace(STRIP_COMMENTS, "").matchAll(TAG)) {
    const tag = m[1]!.toLowerCase();
    if (!tags.has(tag)) {
      found.add(
        tag === "img"
          ? "ใส่รูปด้วย <img> ไม่ได้ — รูปจากภายนอกถูกเมลไคลเอนต์บล็อก ใช้ {{block.logo}} สำหรับโลโก้"
          : `ไม่อนุญาตแท็ก <${tag}>`,
      );
      continue;
    }
    const allowedAttrs = new Set([...COMMON_ATTRS, ...(TAG_ATTRS[tag] ?? [])]);
    for (const a of (m[2] ?? "").matchAll(ATTR)) {
      const name = a[1]!.toLowerCase();
      if (name === "/") continue;
      const value = a[2] ?? a[3] ?? a[4] ?? "";
      if (!allowedAttrs.has(name)) {
        found.add(name.startsWith("on") ? `ไม่อนุญาต ${name} (สคริปต์) ใน <${tag}>` : `ไม่อนุญาต attribute "${name}" ใน <${tag}>`);
        continue;
      }
      if (name === "href" && !/^(https:\/\/|mailto:)/i.test(value.trim())) {
        found.add(`ลิงก์ต้องขึ้นต้นด้วย https:// หรือ mailto: — พบ href="${value.slice(0, 60)}"`);
        continue;
      }
      if (name !== "href" && /\{\{/.test(value)) {
        found.add(`ใส่ตัวแปรใน attribute "${name}" ไม่ได้ — ใช้ตัวแปรในข้อความหรือในลิงก์ (href) เท่านั้น`);
        continue;
      }
      if (name === "style" && DANGEROUS_STYLE.test(value)) {
        found.add("style ห้ามมี url(), expression(), @import หรือ javascript:");
      }
    }
  }
  return [...found];
}

/** ชื่อ placeholder ทั้งหมดในข้อความ (ซ้ำได้) */
function placeholders(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER)].map((m) => m[1]!.trim());
}

/** เกินเท่านี้เตือน — Gmail ตัดอีเมลที่เกิน 102 KB ("[ข้อความถูกตัด] ดูข้อความทั้งหมด") */
export const SIZE_WARNING_BYTES = 80 * 1024;
const MAX_BODY_BYTES = 200 * 1024;

export interface ValidationResult {
  issues: ContentIssue[];
  warnings: string[];
  /** เนื้อหาหลัง trim และ sanitize — สิ่งที่เก็บลงฐานข้อมูลเมื่อไม่มี issue */
  clean: TemplateContent;
}

/**
 * ตรวจเนื้อหาของเทมเพลตหนึ่งตัว — ใช้ตอนบันทึก เผยแพร่ ส่งทดสอบ และ preview (preview แสดง issue แต่ไม่ปฏิเสธ)
 */
export function validateContent(
  def: TemplateDefinition,
  input: TemplateContent,
  /** รหัสรูปที่มีอยู่ (`imageCodes()`) — `{{image.<code>}}` อ้างได้เฉพาะในเนื้อหา */
  imageCodes: ReadonlySet<string> = new Set([LOGO_CODE]),
): ValidationResult {
  const layout = def.key === LAYOUT_KEY;
  const issues: ContentIssue[] = [];
  const warnings: string[] = [];
  const vars = new Set<string>(layout ? GLOBAL_VARIABLES : allowedVariables(def));
  const blocks = new Set<string>(def.blocks);

  const subject = (input.subject ?? "").trim();
  const bodyHtml = (input.bodyHtml ?? "").trim();
  const buttonLabel = (input.buttonLabel ?? "").trim();
  const footnoteHtml = (input.footnoteHtml ?? "").trim();

  const checkNames = (field: ContentField, text: string, allowBlocks: boolean) => {
    const unknown = new Set<string>();
    for (const name of placeholders(text)) {
      if (vars.has(name)) continue;
      if (allowBlocks && name.startsWith("block.") && blocks.has(name.slice(6))) continue;
      if (allowBlocks && name.startsWith("image.") && imageCodes.has(name.slice(6))) continue;
      if (layout && field === "bodyHtml" && (LAYOUT_PLACEHOLDERS as readonly string[]).includes(name)) continue;
      unknown.add(name);
    }
    for (const name of unknown) {
      const isBlock = name.startsWith("block.") && (BLOCK_NAMES as readonly string[]).includes(name.slice(6));
      if (name.startsWith("image.")) {
        issues.push({
          field,
          message: allowBlocks
            ? `ไม่มีรูป {{${name}}} — เพิ่มรูปที่หน้า "รูปภาพในอีเมล" ก่อน`
            : `ช่องนี้ใส่รูป {{${name}}} ไม่ได้ — รูปอยู่ในเนื้อหาเท่านั้น`,
        });
        continue;
      }
      issues.push({
        field,
        message: isBlock
          ? allowBlocks
            ? `เทมเพลตนี้ใช้ {{${name}}} ไม่ได้`
            : `ช่องนี้ใส่บล็อก {{${name}}} ไม่ได้ — บล็อกอยู่ในเนื้อหาเท่านั้น`
          : `ไม่รู้จักตัวแปร {{${name}}} — ใช้ได้เฉพาะรายการทางขวา`,
      });
    }
  };

  if (!layout) {
    if (!subject) issues.push({ field: "subject", message: "กรุณาใส่หัวเรื่อง" });
    else if (subject.length > 300) issues.push({ field: "subject", message: "หัวเรื่องยาวเกิน 300 ตัวอักษร" });
    if (/[<>]/.test(subject)) issues.push({ field: "subject", message: "หัวเรื่องเป็นข้อความล้วน ใส่ HTML ไม่ได้" });
    checkNames("subject", subject, false);
  }

  if (!bodyHtml) issues.push({ field: "bodyHtml", message: "กรุณาใส่เนื้อหา" });
  else if (Buffer.byteLength(bodyHtml) > MAX_BODY_BYTES) issues.push({ field: "bodyHtml", message: "เนื้อหาใหญ่เกิน 200 KB" });
  checkNames("bodyHtml", bodyHtml, true);
  for (const message of scanHtml(bodyHtml, layout)) issues.push({ field: "bodyHtml", message });

  const used = new Set(placeholders(bodyHtml));
  if (layout) {
    if (!used.has("content")) issues.push({ field: "bodyHtml", message: "แม่แบบกลางต้องมี {{content}} — ตำแหน่งเนื้อหาของอีเมลแต่ละฉบับ" });
  }
  for (const block of def.required) {
    if (!used.has(`block.${block}`)) {
      issues.push({ field: "bodyHtml", message: `ต้องมี {{block.${block}}} — ไม่มีแล้วผู้รับใช้งานต่อไม่ได้` });
    }
  }

  if (def.hasButton) {
    if (used.has("block.button") && !buttonLabel) issues.push({ field: "buttonLabel", message: "กรุณาใส่ข้อความบนปุ่ม" });
    if (buttonLabel.length > 100) issues.push({ field: "buttonLabel", message: "ข้อความบนปุ่มยาวเกิน 100 ตัวอักษร" });
    if (/[<>]/.test(buttonLabel)) issues.push({ field: "buttonLabel", message: "ข้อความบนปุ่มเป็นข้อความล้วน ใส่ HTML ไม่ได้" });
    checkNames("buttonLabel", buttonLabel, false);
  }

  if (!layout) {
    if (footnoteHtml.length > 2000) issues.push({ field: "footnoteHtml", message: "หมายเหตุท้ายอีเมลยาวเกิน 2,000 ตัวอักษร" });
    checkNames("footnoteHtml", footnoteHtml, false);
    for (const message of scanHtml(footnoteHtml, false)) issues.push({ field: "footnoteHtml", message });
  }

  if (Buffer.byteLength(bodyHtml) > SIZE_WARNING_BYTES) {
    warnings.push("เนื้อหาใหญ่เกิน 80 KB — Gmail ตัดอีเมลที่เกิน 102 KB และซ่อนส่วนที่เหลือไว้หลังลิงก์ \"ดูข้อความทั้งหมด\"");
  }

  return {
    issues,
    warnings,
    clean: {
      subject: layout ? "" : subject,
      bodyHtml: sanitizeHtml(bodyHtml, policy(layout)),
      buttonLabel: def.hasButton ? buttonLabel || null : null,
      footnoteHtml: layout ? null : footnoteHtml ? sanitizeHtml(footnoteHtml, policy(false)) : null,
    },
  };
}
