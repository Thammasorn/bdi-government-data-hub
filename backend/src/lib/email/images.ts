/**
 * รูปภาพในอีเมล — `{{image.<code>}}` (`administration.email_image`, หน้า /console → ตั้งค่า › รูปภาพในอีเมล)
 *
 * ทุกรูป**แนบไปกับอีเมลและอ้างด้วย `cid:`** ไม่ใช่ลิงก์ไปที่เว็บ เพราะเมลไคลเอนต์ส่วนใหญ่บล็อกรูปจากภายนอกจนกว่าผู้รับจะกดอนุญาต — เหตุผลเดียวกับ
 * ที่โลโก้แนบมาตั้งแต่แรก อีเมลหนึ่งฉบับแนบเฉพาะรูปที่ฉบับนั้นใช้จริง
 *
 * `logo` เป็นรายการตายตัว: ไม่มีแถว = ไฟล์โลโก้ในโค้ด (`blocks.ts` อ่านตอนโหลดโมดูล) `{{block.logo}}` ของแม่แบบกลางคือรูปนี้
 * ถ้าอ่านรูปจากฐานข้อมูลไม่ได้ อีเมลยังส่งด้วยโลโก้ในโค้ด — รูปไม่ควรเป็นเหตุให้อีเมลไม่ออก
 */
import { createHash } from "node:crypto";

import { Prisma, type PrismaClient } from "@prisma/client";

import { logo as defaultLogo, LOGO_CID } from "./blocks.js";

type Db = PrismaClient | Prisma.TransactionClient;

export const LOGO_CODE = "logo";
export const IMAGE_CODE = /^[a-z][a-z0-9_]{1,39}$/;
export const MAX_IMAGE_BYTES = 500 * 1024;
export const DISPLAY_WIDTH_MIN = 16;
export const DISPLAY_WIDTH_MAX = 600;

const LOGO_DEFAULT_META = {
  name: "โลโก้ BDI",
  altText: "สถาบันข้อมูลขนาดใหญ่ (องค์การมหาชน)",
  displayWidth: 88,
};

/** รูปหนึ่งรูปในรูปที่ render ใช้ */
export interface ImageAsset {
  code: string;
  cid: string;
  content: Buffer;
  contentType: string;
  altText: string;
  /** ขนาดที่แสดงในอีเมล */
  width: number;
  height: number;
}

export interface EmailAttachment {
  filename: string;
  content: Buffer;
  cid: string;
  contentType: string;
}

export function cidOf(code: string): string {
  // โลโก้คง cid เดิม (`bdi-logo`) — อีเมลที่ส่งออกไปก่อนหน้านี้ใช้ชื่อนี้ และไม่มีเหตุให้เปลี่ยน
  return code === LOGO_CODE ? LOGO_CID : `img-${code}`;
}

/** ชนิดไฟล์จากไบต์แรก ไม่ใช่จากนามสกุลหรือ mimetype ที่เบราว์เซอร์บอก — PNG และ JPEG เท่านั้น */
export function detectImageType(buf: Buffer): "image/png" | "image/jpeg" | null {
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  return null;
}

/** ขนาดจริงของรูป (px) — อ่านจาก header ของ PNG (IHDR) หรือ JPEG (SOFn) คืน null ถ้าอ่านไม่ได้ */
export function imageDimensions(buf: Buffer, type: string): { width: number; height: number } | null {
  if (type === "image/png") {
    if (buf.length < 24) return null;
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (type === "image/jpeg") {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) return null;
      const marker = buf[i + 1]!;
      const length = buf.readUInt16BE(i + 2);
      // SOF0–SOF15 ยกเว้น DHT (C4), JPG (C8), DAC (CC)
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
      }
      i += 2 + length;
    }
  }
  return null;
}

export function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

function displayHeight(displayWidth: number, widthPx: number, heightPx: number): number {
  return widthPx > 0 ? Math.max(1, Math.round((displayWidth * heightPx) / widthPx)) : displayWidth;
}

/** โลโก้ในโค้ด — ใช้เมื่อยังไม่มีใครเปลี่ยน หรืออ่านฐานข้อมูลไม่ได้ (โค้ดเดิมกำหนด 88×64) */
export function defaultLogoAsset(): ImageAsset | null {
  if (!defaultLogo) return null;
  return {
    code: LOGO_CODE,
    cid: LOGO_CID,
    content: defaultLogo,
    contentType: "image/png",
    altText: LOGO_DEFAULT_META.altText,
    width: 88,
    height: 64,
  };
}

function assetOf(row: {
  code: string;
  content: Uint8Array;
  contentType: string;
  altText: string;
  displayWidth: number;
  widthPx: number;
  heightPx: number;
}): ImageAsset {
  return {
    code: row.code,
    cid: cidOf(row.code),
    content: Buffer.from(row.content),
    contentType: row.contentType,
    altText: row.altText,
    width: row.displayWidth,
    height: displayHeight(row.displayWidth, row.widthPx, row.heightPx),
  };
}

/** รูปตามรายชื่อ — โลโก้ที่ไม่มีแถวได้ไฟล์ในโค้ด รหัสที่ไม่มีอยู่ถูกข้าม (render แทนด้วยความว่าง) */
export async function loadImages(db: Db, codes: Iterable<string>): Promise<Map<string, ImageAsset>> {
  const wanted = [...new Set(codes)];
  const out = new Map<string, ImageAsset>();
  if (wanted.length === 0) return out;
  const rows = await db.emailImage.findMany({ where: { code: { in: wanted } } });
  for (const row of rows) out.set(row.code, assetOf(row));
  if (wanted.includes(LOGO_CODE) && !out.has(LOGO_CODE)) {
    const logo = defaultLogoAsset();
    if (logo) out.set(LOGO_CODE, logo);
  }
  return out;
}

/** รหัสรูปทั้งหมดที่มีอยู่ — สิ่งที่ `validateContent()` ยอมให้อ้าง (โลโก้มีเสมอ) */
export async function imageCodes(db: Db): Promise<Set<string>> {
  const rows = await db.emailImage.findMany({ select: { code: true } });
  return new Set([LOGO_CODE, ...rows.map((r) => r.code)]);
}

const IMAGE_PLACEHOLDER = /\{\{\s*image\.([a-z0-9_]+)\s*\}\}/g;
const LOGO_BLOCK = /\{\{\s*block\.logo\s*\}\}/;

/** รูปที่ข้อความหนึ่งอ้าง — `{{block.logo}}` นับเป็น `logo` */
export function referencedImages(...texts: Array<string | null | undefined>): Set<string> {
  const codes = new Set<string>();
  for (const text of texts) {
    if (!text) continue;
    for (const m of text.matchAll(IMAGE_PLACEHOLDER)) codes.add(m[1]!);
    if (LOGO_BLOCK.test(text)) codes.add(LOGO_CODE);
  }
  return codes;
}

/** แถวของหน้ารายการ — ไม่มีไบต์ของไฟล์ */
export interface ImageView {
  code: string;
  name: string;
  altText: string;
  displayWidth: number;
  contentType: string;
  sizeBytes: number;
  widthPx: number;
  heightPx: number;
  isDefault: boolean;
  isLogo: boolean;
  updatedAt: Date | null;
  updatedBy: string | null;
}

export async function listImages(db: Db): Promise<ImageView[]> {
  const rows = await db.emailImage.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      code: true,
      name: true,
      altText: true,
      displayWidth: true,
      contentType: true,
      sizeBytes: true,
      widthPx: true,
      heightPx: true,
      updatedAt: true,
      updatedBy: true,
    },
  });
  const views: ImageView[] = rows.map((r) => ({ ...r, isDefault: false, isLogo: r.code === LOGO_CODE }));
  if (!views.some((v) => v.isLogo)) {
    const dims = defaultLogo ? imageDimensions(defaultLogo, "image/png") : null;
    views.unshift({
      code: LOGO_CODE,
      ...LOGO_DEFAULT_META,
      contentType: "image/png",
      sizeBytes: defaultLogo?.length ?? 0,
      widthPx: dims?.width ?? 0,
      heightPx: dims?.height ?? 0,
      isDefault: true,
      isLogo: true,
      updatedAt: null,
      updatedBy: null,
    });
  }
  // โลโก้ขึ้นก่อนเสมอ
  return views.sort((a, b) => Number(b.isLogo) - Number(a.isLogo));
}

/** ไบต์ของรูปหนึ่ง (หน้า console แสดงรูปย่อ) — โลโก้ที่ไม่มีแถวได้ไฟล์ในโค้ด */
export async function imageFile(db: Db, code: string): Promise<{ content: Buffer; contentType: string } | null> {
  const row = await db.emailImage.findUnique({ where: { code }, select: { content: true, contentType: true } });
  if (row) return { content: Buffer.from(row.content), contentType: row.contentType };
  if (code === LOGO_CODE && defaultLogo) return { content: defaultLogo, contentType: "image/png" };
  return null;
}

export { LOGO_DEFAULT_META };
