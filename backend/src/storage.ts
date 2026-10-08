/**
 * ที่เก็บไฟล์แนบ — Azure Blob Storage
 *
 * เดิมเป็น MinIO (S3) เปลี่ยนมาเป็น Azure ตามการ์ด "Migrate to Azure" คำศัพท์เปลี่ยนตามไปด้วย:
 * bucket ของ S3 = **container** ของ Azure และ object = **blob** คอลัมน์ในฐานข้อมูลยังชื่อ
 * `storage_bucket` / `storage_key` ตาม sheet `attachment` ของ Excel ที่เป็นเจ้าของสคีมา
 * จึงไม่ได้เปลี่ยนชื่อคอลัมน์ตาม — ค่าที่เก็บคือชื่อ container กับชื่อ blob
 *
 * โมดูลนี้ห่อ SDK ไว้ทั้งหมดโดยตั้งใจ ที่เหลือของ backend เรียกผ่านสี่ฟังก์ชันข้างล่างเท่านั้น
 * ไม่มีที่ไหนอีกที่ import `@azure/storage-blob` — ตอนย้ายจาก MinIO งานเกือบทั้งหมดอยู่ใน
 * ไฟล์นี้ไฟล์เดียวเพราะของเดิมก็ห่อไว้แบบนี้ ให้มันอยู่แบบนี้ต่อไป
 */
import { DefaultAzureCredential } from "@azure/identity";
import { BlobServiceClient, type ContainerClient } from "@azure/storage-blob";

import { env } from "./env.js";

/**
 * connection string ชนะ account URL เมื่อตั้งมาทั้งคู่ — ดู env.ts ว่าทางไหนใช้เมื่อไร
 *
 * `DefaultAzureCredential` ไม่ได้ไปคุยกับ Azure ตอนสร้าง มันไล่หา credential ตอนเรียกใช้ครั้งแรก
 * การประกาศไว้ตรงนี้จึงไม่ทำให้บูตช้าหรือล้มถ้ายังไม่มี managed identity
 */
const service = env.azure.connectionString
  ? BlobServiceClient.fromConnectionString(env.azure.connectionString)
  : new BlobServiceClient(env.azure.accountUrl, new DefaultAzureCredential());

/** ชื่อ container ที่ไฟล์ใหม่ทุกไฟล์ถูกเขียนลงไป (ของเดิมคือชื่อ bucket) */
export const CONTAINER = env.azure.container;

/**
 * ไฟล์เก่าอาจอยู่คนละ container กับค่าปัจจุบัน จึงอ่านจากชื่อที่แถวนั้นเก็บไว้เสมอ
 * ไม่ใช่จาก CONTAINER — ย้าย container เมื่อไรไฟล์เดิมยังเปิดได้
 */
function containerOf(name: string = CONTAINER): ContainerClient {
  return service.getContainerClient(name);
}

/**
 * สร้าง container ถ้ายังไม่มี
 *
 * ไม่ระบุ access level = private ซึ่งเป็นค่าตั้งต้นของ Azure และเป็นสิ่งที่ต้องการ:
 * ไฟล์แนบทุกไฟล์ต้องผ่าน backend ที่ตรวจสิทธิ์ก่อน ไม่มี URL สาธารณะให้เดา
 */
export async function ensureContainer(): Promise<void> {
  await containerOf().createIfNotExists();
}

export async function pingStorage(): Promise<void> {
  if (!(await containerOf().exists())) {
    throw new Error(`Container "${CONTAINER}" does not exist`);
  }
}

/** เขียนไฟล์ทับชื่อเดิมได้ แต่ storage key มี attachment_id อยู่ จึงไม่เกิดขึ้นจริง */
export async function putObject(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  await containerOf().getBlockBlobClient(key).uploadData(body, {
    blobHTTPHeaders: { blobContentType: contentType },
  });
}

/**
 * สตรีมไฟล์ออกมาโดยไม่ต้องโหลดทั้งก้อนขึ้น memory — ใช้กับการส่งไฟล์ต่อให้เบราว์เซอร์
 *
 * `download()` บน Node คืน `readableStreamBody` มาให้ ส่วนบนเบราว์เซอร์จะเป็น `blobBody`
 * แทน โค้ดนี้รันบน Node เท่านั้น แต่ type ของ SDK เผื่อไว้ทั้งสองทางจึงต้องเช็คก่อนใช้
 */
export async function getObjectStream(
  container: string,
  key: string,
): Promise<NodeJS.ReadableStream> {
  const response = await containerOf(container).getBlobClient(key).download();
  if (!response.readableStreamBody) {
    throw new Error(`Blob "${key}" in container "${container}" returned no readable body`);
  }
  return response.readableStreamBody;
}

/** ทั้งก้อนใน memory — ใช้กับ template .docx ที่ต้องเอาไปเติมค่าต่อ ไม่ใช่ส่งต่อทันที */
export async function getObjectBuffer(container: string, key: string): Promise<Buffer> {
  return containerOf(container).getBlobClient(key).downloadToBuffer();
}
