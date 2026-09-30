/**
 * ตัวช่วยของ schema `attachment` — ตารางเดียวแบบ polymorphic แทน
 * attachments + dataset_attachments เดิม
 *
 * สองเรื่องที่เปลี่ยนพฤติกรรมจากของเดิม และทั้งคู่มาจาก sheet `attachment` ตรง ๆ:
 *
 * 1. **อัปโหลดทับไม่ลบ object เดิมอีกต่อไป** ของเดิมเรียก removeObject() แล้ว
 *    ลบแถวทิ้ง แบบใหม่แถวเดิมเปลี่ยนเป็น status = REPLACED และไฟล์ยังอยู่ใน object storage
 *    ไฟล์ใหม่ชี้กลับด้วย replaced_attachment_id — ทำให้ย้อนดูของเดิมได้
 *
 * 2. **storage key มี attachment_id อยู่ใน path** จึงไม่มีวันเขียนทับ object เดิม
 *    (ภาพ "ทำไมต้องมี attachment_id" ใน sheet อธิบายเหตุผลนี้ไว้)
 */
import { AsyncResource } from "node:async_hooks";
import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";

import {
  AttachmentOwnerType,
  AttachmentStatus,
  AttachmentType,
  ScanStatus,
  type Prisma,
  type PrismaClient,
} from "@prisma/client";

import { env } from "../env.js";
import { CONTAINER, getObjectBuffer, getObjectStream, putObject } from "../storage.js";
import { addBreadcrumb } from "./context.js";
import { captureError } from "./error-capture.js";

type Db = PrismaClient | Prisma.TransactionClient;

/** ส่วน {environment} หน้าสุดของ storage key */
const ENVIRONMENT = env.nodeEnv === "production" ? "prod" : "dev";

const kebab = (value: string) => value.toLowerCase().replace(/_/g, "-");

/**
 * storage key ตามภาพ "รูปแบบที่แนะนำเต็ม ๆ" ใน sheet `attachment`:
 *
 *   {environment}/{owner_type}/{owner_id}/{attachment_type}/{attachment_id}/{stored_file_name}
 *
 * ตัวอย่างในเอกสาร:
 *   prod/organization-registration-request/1f02c58a-…/authorized-representative-appointment-order/
 *     5cd74afe-…/document.pdf
 */
export function buildStorageKey(params: {
  ownerType: AttachmentOwnerType;
  ownerId: string;
  attachmentType: AttachmentType;
  attachmentId: string;
  storedFileName: string;
}): string {
  return [
    ENVIRONMENT,
    kebab(params.ownerType),
    params.ownerId,
    kebab(params.attachmentType),
    params.attachmentId,
    params.storedFileName,
  ].join("/");
}

/** ชื่อไฟล์ที่เก็บจริง — ใช้ document.<ext> ตามตัวอย่างในเอกสาร ไม่เอาชื่อผู้ใช้มาเป็น path */
function storedFileName(extension: string | null): string {
  return extension ? `document.${extension}` : "document";
}

export function fileExtensionOf(originalName: string): string | null {
  const match = /\.([A-Za-z0-9]+)$/.exec(originalName);
  return match?.[1]?.toLowerCase() ?? null;
}

/**
 * multer เก็บ originalname มาเป็น latin1 — แปลงกลับเป็น utf8 ไม่งั้นชื่อไฟล์ไทยเพี้ยน
 *
 * **ใช้กับไฟล์ที่มาจาก multipart เท่านั้น** ชื่อไฟล์ที่โค้ดเราตั้งเอง (PDF ที่ระบบสร้าง)
 * เป็น utf8 อยู่แล้ว การอ่านมันเป็น latin1 จะเก็บแค่ไบต์ล่างของทุกตัวอักษร แล้วชื่อไทย
 * จะกลายเป็นขยะ — เคยหลุดไปแล้วครั้งหนึ่งกับ "แบบฟอร์มลงทะเบียนชุดข้อมูล-….pdf"
 * จึงเรียกที่ขอบ HTTP ผ่าน uploadedFile() ไม่ใช่ข้างใน storeAttachment()
 */
export function decodeOriginalName(originalName: string): string {
  return Buffer.from(originalName, "latin1").toString("utf8");
}

/** ไฟล์จาก multer → รูปที่ storeAttachment รับ พร้อมแก้ชื่อไฟล์ให้เป็น utf8 */
export function uploadedFile(file: {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}) {
  return { ...file, originalname: decodeOriginalName(file.originalname) };
}

export function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

/**
 * อัปโหลดไฟล์แล้วบันทึกแถว attachment
 *
 * ถ้า slot (owner_type, owner_id, attachment_type) มีไฟล์ ACTIVE อยู่แล้ว ไฟล์เดิมจะถูก
 * เปลี่ยนเป็น REPLACED ก่อน — partial unique index uq_active_attachment_per_slot
 * บังคับให้มี ACTIVE ได้แถวเดียวต่อ slot อยู่แล้ว
 */
export async function storeAttachment(
  db: Db,
  params: {
    ownerType: AttachmentOwnerType;
    ownerId: string;
    attachmentType: AttachmentType;
    file: { buffer: Buffer; originalname: string; mimetype: string; size: number };
    uploadedBy: string;
    /**
     * เอกสารกฎหมายฉบับไหนที่ไฟล์นี้ถูก render มาจาก
     *
     * ทำให้คำขอหนึ่งใบเก็บเอกสารที่ระบบสร้างได้หลายฉบับ — หนึ่งฉบับต่อหนึ่งเวอร์ชันเอกสาร
     * ไม่ใส่ = ไฟล์ที่ผู้ใช้อัปโหลด หรือเอกสารที่ไม่ได้ผูกกับเวอร์ชันใด
     */
    legalDocumentVersionId?: string | null;
  },
) {
  const attachmentId = randomUUID();
  const originalFileName = params.file.originalname;
  const extension = fileExtensionOf(originalFileName);

  const storageKey = buildStorageKey({
    ownerType: params.ownerType,
    ownerId: params.ownerId,
    attachmentType: params.attachmentType,
    attachmentId,
    storedFileName: storedFileName(extension),
  });

  await putObject(storageKey, params.file.buffer, params.file.mimetype);

  const previous = await db.attachment.findFirst({
    where: {
      ownerType: params.ownerType,
      ownerId: params.ownerId,
      attachmentType: params.attachmentType,
      // slot เดียวกันต้องรวมเอกสารฉบับเดียวกันด้วย ไม่งั้นการ render A1 จะไปแทนที่ A0
      legalDocumentVersionId: params.legalDocumentVersionId ?? null,
      status: AttachmentStatus.ACTIVE,
    },
    select: { id: true },
  });

  if (previous) {
    await db.attachment.update({
      where: { id: previous.id },
      data: { status: AttachmentStatus.REPLACED },
    });
  }

  return db.attachment.create({
    data: {
      id: attachmentId,
      ownerType: params.ownerType,
      ownerId: params.ownerId,
      attachmentType: params.attachmentType,
      originalFileName,
      storageBucket: CONTAINER,
      storageKey,
      mimeType: params.file.mimetype,
      fileExtension: extension,
      fileSizeBytes: BigInt(params.file.size),
      contentHash: sha256(params.file.buffer),
      legalDocumentVersionId: params.legalDocumentVersionId ?? null,
      status: AttachmentStatus.ACTIVE,
      // ยังไม่มี virus scanner จริงในระบบ — sheet เองก็เขียนกำกับว่า "น่าจะยังไม่มี"
      // TODO: ต่อ scanner จริงแล้วปล่อยให้ worker เป็นคนเปลี่ยนเป็น CLEAN/REJECTED/QUARANTINED
      scanStatus: ScanStatus.CLEAN,
      scanCompletedAt: new Date(),
      replacedAttachmentId: previous?.id ?? null,
      uploadedBy: params.uploadedBy,
    },
  });
}

/** ไฟล์ปัจจุบันของ owner หนึ่งราย — REPLACED/DELETED ไม่ติดมาด้วย */
export async function activeAttachments(
  db: Db,
  ownerType: AttachmentOwnerType,
  ownerId: string,
) {
  return db.attachment.findMany({
    where: { ownerType, ownerId, status: AttachmentStatus.ACTIVE },
    orderBy: { uploadedAt: "asc" },
  });
}

/**
 * เอกสารที่ระบบ render ไว้ให้คำขอนี้ จากเอกสารกฎหมายเวอร์ชันหนึ่ง
 *
 * `legalDocumentVersionId: null` ใน where จับเฉพาะไฟล์ที่ไม่ได้ผูกเวอร์ชัน จึงต้องแยกฟังก์ชัน
 * จาก activeAttachment() ที่ไม่สนใจคอลัมน์นี้ — ไม่งั้น A0 ฉบับเก่า (ก่อนมีคอลัมน์) กับ
 * ฉบับใหม่จะทับกัน
 */
export async function activeRenderedDocument(
  db: Db,
  ownerType: AttachmentOwnerType,
  ownerId: string,
  legalDocumentVersionId: string,
) {
  return db.attachment.findFirst({
    where: {
      ownerType,
      ownerId,
      legalDocumentVersionId,
      status: AttachmentStatus.ACTIVE,
    },
  });
}

export async function activeAttachment(
  db: Db,
  ownerType: AttachmentOwnerType,
  ownerId: string,
  attachmentType: AttachmentType,
) {
  return db.attachment.findFirst({
    where: { ownerType, ownerId, attachmentType, status: AttachmentStatus.ACTIVE },
  });
}

/**
 * ลบเชิงตรรกะ — ไฟล์ยังอยู่ใน object storage
 * sheet แยก DELETED ออกจาก REPLACED ชัดเจน: DELETED คือเลิกใช้ ไม่ใช่ถูกแทนที่
 */
export async function softDeleteAttachment(
  db: Db,
  attachmentId: string,
  params: { deletedBy: string; reason: string },
) {
  return db.attachment.update({
    where: { id: attachmentId },
    data: {
      status: AttachmentStatus.DELETED,
      deletedAt: new Date(),
      deletedBy: params.deletedBy,
      deletionReason: params.reason,
    },
  });
}

/** ใช้ได้จริงหรือไม่ — sheet: ACTIVE ใช้ได้ "เมื่อ scan_status = CLEAN" */
export function isUsable(attachment: { status: AttachmentStatus; scanStatus: ScanStatus }): boolean {
  return attachment.status === AttachmentStatus.ACTIVE && attachment.scanStatus === ScanStatus.CLEAN;
}

/**
 * ส่งไฟล์กลับให้ผู้ใช้
 *
 * ค่าปกติเป็น inline เพราะหน้ารายละเอียดฝัง PDF ไว้ใน <iframe> ส่วนปุ่มดาวน์โหลด
 * ในรายการต้องการ attachment เพื่อให้เบราว์เซอร์บันทึกไฟล์แทนที่จะเปิดดู
 *
 * `req` ไปถึง error ที่เก็บเมื่อ storage ล้ม — ผู้ดาวน์โหลด (บทบาท หน่วยงาน session) กับ path ของคำขออยู่ที่นั่น
 * ไม่ใช่ใน AsyncLocalStorage ซึ่งมีแค่ id ของผู้ใช้
 */
export async function streamAttachment(
  req: import("express").Request,
  res: import("express").Response,
  attachment: { storageBucket: string; storageKey: string; mimeType: string; originalFileName: string },
  disposition: "inline" | "attachment" = "inline",
) {
  const stream = await getObjectStream(attachment.storageBucket, attachment.storageKey);
  res.setHeader("Content-Type", attachment.mimeType);
  res.setHeader(
    "Content-Disposition",
    `${disposition}; filename*=UTF-8''${encodeURIComponent(attachment.originalFileName)}`,
  );
  pipeToResponse(req, stream as Readable, res);
}

/**
 * ส่งสตรีมของไฟล์จาก storage ต่อให้ผู้ใช้ — โดยที่ storage ล้มกลางทางต้องไม่พา process ล่ม
 *
 * `pipe()` ไม่ฟัง 'error' ของต้นทางให้ และ EventEmitter ที่ไม่มีใครฟัง 'error' จะ throw ออกมาเป็น uncaught
 * exception ซึ่งตั้งแต่ step 5 คือ fatal + `exit(1)` ของทั้ง backend (ลองแล้ว 2026-09-30: หยุด azurite ระหว่างดาวน์โหลด
 * ไฟล์ 80 MB — `AbortError` เป็น fatal แล้ว API ตอบไม่ได้ทุกคำขอ) error ของสตรีมไม่ผ่านตัวจัดการ error ของ Express
 * เพราะมันเกิดหลัง handler คืนค่าไปแล้ว จึงต้องจัดการตรงนี้:
 *   - ยังไม่ได้ส่งอะไรออกไป → ตอบ 503 `storage_unavailable` เป็น JSON ปกติ (ได้รหัสอ้างอิงจาก `referenceOnServerErrors`)
 *   - ส่งไปแล้วบางส่วน → ตอบใหม่ไม่ได้ ตัดการเชื่อมต่อทิ้ง ผู้ใช้ได้ไฟล์ขาด (curl ได้ exit 18) ไม่ใช่ไฟล์ที่ดูเหมือนครบ
 *   - เก็บ error ด้วย tag `storage.stream` ทั้งสองแบบ พร้อม `req` — เดิมเก็บโดยไม่มี `req` เอกสารจึงมีแค่ id ของผู้ใช้
 *     (จาก AsyncLocalStorage) ไม่มี path บทบาท หน่วยงาน หรือ session ของผู้ดาวน์โหลด
 * ผู้ใช้ปิดแท็บหรือยกเลิกกลางทางก็ปิดสตรีมของ storage ตามไป ไม่ปล่อย connection ค้างรอคนอ่าน และ error ที่ตามมาจาก
 * การปิดนั้นไม่ใช่ความล้มเหลวของ storage จึงไม่ถูกเก็บ
 *
 * ตัวฟังถูกผูกกับบริบทของคำขอ (`AsyncResource.bind`) — event ของสตรีมมาจาก socket ซึ่งอยู่นอก AsyncLocalStorage
 * (กับดักเดียวกับ multer ใน CLAUDE.md) ไม่ผูกแล้ว error ที่เก็บได้จะไม่มี correlation id ไม่มี route และคำตอบ 503
 * จะถูกเก็บซ้ำเป็น issue ที่สอง
 */
export function pipeToResponse(req: import("express").Request, source: Readable, res: import("express").Response) {
  let clientGone = false;
  let failed = false;
  res.on(
    "close",
    AsyncResource.bind(() => {
      if (res.writableFinished || failed) return;
      clientGone = true;
      source.destroy();
    }),
  );
  source.on(
    "error",
    AsyncResource.bind((err: unknown) => {
      if (failed || clientGone) return;
      failed = true;
      source.unpipe(res);
      addBreadcrumb("storage", "สตรีมไฟล์ขาดกลางทาง", false);
      captureError(err, {
        req,
        mechanism: "captured",
        tag: "storage.stream",
        status: res.headersSent ? res.statusCode : 503,
      });
      if (res.headersSent) {
        res.destroy();
        return;
      }
      // หัวของไฟล์ที่ตั้งไว้แล้วต้องออกก่อน — `res.json` ไม่ตั้ง Content-Type ทับค่าที่มีอยู่ JSON จะออกไปในชื่อ text/csv
      res.removeHeader("Content-Type");
      res.removeHeader("Content-Disposition");
      res.status(503).json({
        error: "storage_unavailable",
        message: "เปิดไฟล์ไม่สำเร็จ ระบบจัดเก็บไฟล์ไม่ตอบ กรุณาลองใหม่อีกครั้ง",
      });
    }),
  );
  source.pipe(res);
}

/**
 * ส่ง PDF ที่เพิ่ง render ในหน่วยความจำ โดยไม่ต้องเก็บเป็นไฟล์ก่อน
 *
 * ใช้กับเอกสารที่ประทับชื่อผู้เปิดอ่านและเวลาที่เปิด (การ์ด "Document Print Date") —
 * หัวเรื่องต้องเหมือน streamAttachment() ทุกประการ เพราะหน้าจอเดียวกันเรียกทั้งสองทาง
 * ผ่าน URL เดียวกัน และจะบอกไม่ได้ว่าฉบับที่ได้มาจากทางไหน
 *
 * `no-store` เป็นส่วนสำคัญ ไม่ใช่ของแถม: ฉบับที่ประทับชื่อคนหนึ่งไว้ต้องไม่ถูก cache
 * แล้วเสิร์ฟให้อีกคน และวันที่พิมพ์ก็ต้องเป็นวันนี้เสมอ
 */
export function sendRenderedPdf(
  res: import("express").Response,
  pdf: Buffer,
  filename: string,
  disposition: "inline" | "attachment" = "inline",
) {
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `${disposition}; filename*=UTF-8''${encodeURIComponent(filename)}`,
  );
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Length", String(pdf.length));
  res.end(pdf);
}

/**
 * อ่านไฟล์กลับมาเป็น Buffer
 *
 * ใช้กับ template .docx ของเอกสารกฎหมาย ซึ่งต้องเอามาเติมค่าแล้วแปลงเป็น PDF —
 * ไม่ใช่ส่งต่อให้เบราว์เซอร์อย่าง streamAttachment()
 */
export async function readAttachment(attachment: {
  storageBucket: string;
  storageKey: string;
}): Promise<Buffer> {
  return getObjectBuffer(attachment.storageBucket, attachment.storageKey);
}

/**
 * JSON ที่ frontend ใช้ — fileSizeBytes เป็น BigInt ซึ่ง JSON.stringify โยน error
 * จึงต้องแปลงเป็น number ทุกครั้งที่ส่งออก
 */
export function publicAttachment(attachment: {
  id: string;
  attachmentType: AttachmentType;
  originalFileName: string;
  mimeType: string;
  fileSizeBytes: bigint;
  contentHash: string;
  uploadedAt: Date;
}) {
  return {
    id: attachment.id,
    /**
     * หน้าเว็บทุกหน้าอ่านช่องนี้ว่า `kind` (และ type ฝั่งนั้นก็ประกาศไว้แบบนั้น)
     * เดิมส่งชื่อ `attachmentType` ออกไป ทำให้ `a.kind` เป็น undefined ทั้งระบบ:
     * หน้าตรวจสอบก่อนนำส่งหาแบบฟอร์มที่ระบบสร้างไม่เจอ ปุ่ม "นำส่งคำขอ" จึงกดไม่ได้
     * ทั้งสอง Journey ทั้งที่ backend สร้าง PDF ให้เรียบร้อยแล้ว
     */
    kind: attachment.attachmentType,
    filename: attachment.originalFileName,
    mimeType: attachment.mimeType,
    sizeBytes: Number(attachment.fileSizeBytes),
    contentHash: attachment.contentHash,
    uploadedAt: attachment.uploadedAt,
  };
}
