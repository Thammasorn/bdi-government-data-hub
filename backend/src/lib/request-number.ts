/**
 * เลขที่อ้างอิงเชิงธุรกิจของแต่ละคำขอและของ dataset
 *
 * รูปแบบ ORG-REG-<ปี ค.ศ.>-<ลำดับ 4 หลัก> มาจากตัวอย่าง payload ใน sheet
 * `signature_confirmation` ("requestNumber": "ORG-REG-2026-0001")
 * ชุด dataset ใช้รูปเดียวกันเพื่อให้อ่านออกว่าเป็นคำขอชนิดไหนตั้งแต่ prefix
 *
 * **ออกเลขจากเลขที่สูงสุดของปีนั้น +1 ไม่ใช่จากจำนวนแถว +1**
 *
 * เดิมนับแถว ซึ่งเท่ากันก็ต่อเมื่อไม่มีแถวไหนหายไปเลย พอมีเส้นทางลบจริง
 * (`DELETE /api/dataset-requests/:id` ลบคำขอฉบับร่าง และ
 * `DELETE /api/admin/invitations/:id` ลบคำขอกับหน่วยงานที่คำเชิญผิดใบสร้างค้างไว้)
 * จำนวนแถวก็ต่ำกว่าเลขที่ออกไปแล้ว คำขอใบถัดไปจึงได้เลขที่มีเจ้าของอยู่แล้ว ชน unique
 * แล้วตอบ 409 — และตอบแบบนั้นตลอดไป เพราะการสร้างที่ล้มไม่ทำให้จำนวนแถวเพิ่มขึ้น
 * เลขที่ลบไปแล้วจึงไม่ถูกนำกลับมาใช้ซ้ำ ซึ่งเป็นสิ่งที่ถูกต้องอยู่แล้วสำหรับเลขที่อ้างอิง:
 * แถว audit ของคำขอที่ถูกลบยังอ้างเลขนั้นอยู่
 *
 * ยังชนกันได้ในทางทฤษฎีถ้ามีสองคำขอเกิดพร้อมกันพอดี — คอลัมน์เป็น unique
 * จึงล้มด้วย constraint แทนที่จะออกเลขซ้ำเงียบ ๆ แล้ว retry ได้
 */
import type { Prisma, PrismaClient } from "@prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;

const year = () => new Date().getFullYear();
const serial = (n: number) => String(n).padStart(4, "0");

/**
 * ลำดับถัดไปจากค่าที่มากที่สุดใน `values` ที่ขึ้นต้นด้วย prefix
 *
 * เรียงด้วย string ไม่ใช่ตัวเลข ใช้ได้เพราะลำดับถูก pad เป็นสี่หลักเสมอ — และถ้า
 * วันหนึ่งมีเลขหลักที่ห้า การ parse ทีละแถวข้างล่างนี้ก็ยังอ่านถูก ตัวเรียงเป็นแค่
 * ตัวจำกัดจำนวนแถวที่ต้องอ่าน
 */
const nextSerialFrom = (prefix: string, highest: string | undefined): string => {
  const current = highest ? Number.parseInt(highest.slice(prefix.length), 10) : 0;
  return `${prefix}${serial((Number.isFinite(current) ? current : 0) + 1)}`;
};

export async function nextOrganizationRequestNumber(db: Db): Promise<string> {
  const prefix = `ORG-REG-${year()}-`;
  const highest = await db.organizationRegistrationRequest.findFirst({
    where: { requestNumber: { startsWith: prefix } },
    orderBy: { requestNumber: "desc" },
    select: { requestNumber: true },
  });
  return nextSerialFrom(prefix, highest?.requestNumber);
}

export async function nextDatasetRequestNumber(db: Db): Promise<string> {
  const prefix = `DS-REG-${year()}-`;
  const highest = await db.datasetRegistrationRequest.findFirst({
    where: { requestNumber: { startsWith: prefix } },
    orderBy: { requestNumber: "desc" },
    select: { requestNumber: true },
  });
  return nextSerialFrom(prefix, highest?.requestNumber);
}

/** dataset_code — sheet `dataset` เรียกว่า "Unique business identifier" */
export async function nextDatasetCode(db: Db): Promise<string> {
  const prefix = `DS-${year()}-`;
  const highest = await db.dataset.findFirst({
    where: { datasetCode: { startsWith: prefix } },
    orderBy: { datasetCode: "desc" },
    select: { datasetCode: true },
  });
  return nextSerialFrom(prefix, highest?.datasetCode);
}

/**
 * organization_code — sheet ถามคำถามนี้ไว้เอง ("ปรึกษาพี่แก้ว มีรหัสหน่วยงานไหม ??")
 * ระหว่างรอคำตอบระบบออกให้เองในรูป ORG-<ปี>-<ลำดับ>
 * ถ้าได้รหัสราชการจริงมาแล้ว ให้รับค่าจากผู้ใช้แทนการ generate
 */
export async function nextOrganizationCode(db: Db): Promise<string> {
  const prefix = `ORG-${year()}-`;
  /**
   * ตัวเดียวในไฟล์นี้ที่ไม่ได้อ่านแค่แถวบนสุด — `organization_code` เป็นค่าที่ผู้ดูแล
   * ระบบกรอกเองได้ (`POST /api/admin/organizations` รับรหัสมา ไม่ได้ generate ให้)
   * รหัสอย่าง ORG-2026-NSO จึงมีได้จริง และมันเรียงอยู่**เหนือ**ตัวเลขทุกตัว
   * การอ่านแถวบนสุดแถวเดียวจะได้ NaN แล้วถอยไปเริ่มที่ 0001 ใหม่ทั้งที่มีคนใช้อยู่
   * หน่วยงานมีไม่กี่สิบแถวต่อปี การอ่านทั้งคอลัมน์ที่ขึ้นต้นด้วย prefix จึงถูกกว่าความเสี่ยง
   */
  const codes = await db.organization.findMany({
    where: { organizationCode: { startsWith: prefix } },
    select: { organizationCode: true },
  });
  const highest = codes
    .map((o) => Number.parseInt(o.organizationCode.slice(prefix.length), 10))
    .filter((n) => Number.isInteger(n))
    .reduce((a, b) => Math.max(a, b), 0);
  return `${prefix}${serial(highest + 1)}`;
}
