/**
 * ตัวช่วยของ schema `attachment` — ตารางเดียวแบบ polymorphic แทน
 * attachments + dataset_attachments เดิม
 *
 * สองเรื่องที่เปลี่ยนพฤติกรรมจากของเดิม และทั้งคู่มาจาก sheet `attachment` ตรง ๆ:
 *
 * 1. **อัปโหลดทับไม่ลบ object เดิมอีกต่อไป** ของเดิมเรียก minio.removeObject() แล้ว
 *    ลบแถวทิ้ง แบบใหม่แถวเดิมเปลี่ยนเป็น status = REPLACED และไฟล์ยังอยู่ใน MinIO
 *    ไฟล์ใหม่ชี้กลับด้วย replaced_attachment_id — ทำให้ย้อนดูของเดิมได้
 *
 * 2. **storage key มี attachment_id อยู่ใน path** จึงไม่มีวันเขียนทับ object เดิม
 *    (ภาพ "ทำไมต้องมี attachment_id" ใน sheet อธิบายเหตุผลนี้ไว้)
 */
import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";

import {
  AttachmentOwnerType,
  AttachmentStatus,
  AttachmentType,
  ScanStatus,
  type Prisma,
  type PrismaClient,
} from "@prisma/client";

import { env } from "../env.js";
import { BUCKET, minio } from "../storage.js";

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

  await minio.putObject(BUCKET, storageKey, params.file.buffer, params.file.size, {
    "Content-Type": params.file.mimetype,
  });

  const previous = await db.attachment.findFirst({
    where: {
      ownerType: params.ownerType,
      ownerId: params.ownerId,
      attachmentType: params.attachmentType,
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
      storageBucket: BUCKET,
      storageKey,
      mimeType: params.file.mimetype,
      fileExtension: extension,
      fileSizeBytes: BigInt(params.file.size),
      contentHash: sha256(params.file.buffer),
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
 */
export async function streamAttachment(
  res: import("express").Response,
  attachment: { storageBucket: string; storageKey: string; mimeType: string; originalFileName: string },
  disposition: "inline" | "attachment" = "inline",
) {
  const stream = await minio.getObject(attachment.storageBucket, attachment.storageKey);
  res.setHeader("Content-Type", attachment.mimeType);
  res.setHeader(
    "Content-Disposition",
    `${disposition}; filename*=UTF-8''${encodeURIComponent(attachment.originalFileName)}`,
  );
  stream.pipe(res);
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
