/**
 * เลขที่อ้างอิงเชิงธุรกิจของแต่ละคำขอและของ dataset
 *
 * รูปแบบ ORG-REG-<ปี ค.ศ.>-<ลำดับ 4 หลัก> มาจากตัวอย่าง payload ใน sheet
 * `signature_confirmation` ("requestNumber": "ORG-REG-2026-0001")
 * ชุด dataset ใช้รูปเดียวกันเพื่อให้อ่านออกว่าเป็นคำขอชนิดไหนตั้งแต่ prefix
 *
 * ออกเลขด้วยการนับแถวของปีนั้นแล้ว +1 ภายใน transaction เดียวกับที่สร้างคำขอ
 * ชนกันได้ในทางทฤษฎีถ้ามีสองคำขอเกิดพร้อมกันพอดี — คอลัมน์เป็น unique
 * จึงล้มด้วย constraint แทนที่จะออกเลขซ้ำเงียบ ๆ แล้ว retry ได้
 */
import type { Prisma, PrismaClient } from "@prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;

const year = () => new Date().getFullYear();
const serial = (n: number) => String(n).padStart(4, "0");

export async function nextOrganizationRequestNumber(db: Db): Promise<string> {
  const prefix = `ORG-REG-${year()}-`;
  const count = await db.organizationRegistrationRequest.count({
    where: { requestNumber: { startsWith: prefix } },
  });
  return `${prefix}${serial(count + 1)}`;
}

export async function nextDatasetRequestNumber(db: Db): Promise<string> {
  const prefix = `DS-REG-${year()}-`;
  const count = await db.datasetRegistrationRequest.count({
    where: { requestNumber: { startsWith: prefix } },
  });
  return `${prefix}${serial(count + 1)}`;
}

/** dataset_code — sheet `dataset` เรียกว่า "Unique business identifier" */
export async function nextDatasetCode(db: Db): Promise<string> {
  const prefix = `DS-${year()}-`;
  const count = await db.dataset.count({ where: { datasetCode: { startsWith: prefix } } });
  return `${prefix}${serial(count + 1)}`;
}

/**
 * organization_code — sheet ถามคำถามนี้ไว้เอง ("ปรึกษาพี่แก้ว มีรหัสหน่วยงานไหม ??")
 * ระหว่างรอคำตอบระบบออกให้เองในรูป ORG-<ปี>-<ลำดับ>
 * ถ้าได้รหัสราชการจริงมาแล้ว ให้รับค่าจากผู้ใช้แทนการ generate
 */
export async function nextOrganizationCode(db: Db): Promise<string> {
  const prefix = `ORG-${year()}-`;
  const count = await db.organization.count({
    where: { organizationCode: { startsWith: prefix } },
  });
  return `${prefix}${serial(count + 1)}`;
}
