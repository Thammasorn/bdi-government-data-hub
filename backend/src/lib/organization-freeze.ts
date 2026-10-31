import { OrganizationStatus, type Prisma, type PrismaClient } from "@prisma/client";
import type { Response } from "express";

import { prisma } from "../db.js";
import { WorkflowError } from "./workflow.js";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * หน่วยงานที่ผู้ดูแลระบบระงับหรือยุติไว้ (`POST /api/admin/organizations/:id/{suspend,deactivate}`) ถูก "แช่แข็ง"
 * — การ์ด Admin Action Effect › Issue "ระงับหน่วยงาน" (2026-10-31): ข้อมูลและทุก action ค้างอยู่ที่สถานะตอนนั้น
 *
 * สิ่งที่หยุด: ทุกอย่างที่ฝั่งหน่วยงานและเจ้าหน้าที่ BDI ทำกับคำขอของหน่วยงานนั้น (แก้ แนบไฟล์ สร้างแบบฟอร์ม นำส่ง
 * ทุกด่านพิจารณา ลงนาม ดึงกลับ มอบหมายผู้เชี่ยวชาญ ยกเลิกคำขอเอง) และการเพิ่มคนเข้าหน่วยงาน (คำเชิญ การเปิดใช้บัญชี
 * การมอบ role / ย้ายคนเข้า) ส่วนชุดข้อมูลที่อนุมัติไปแล้วไม่แตะ
 *
 * สิ่งที่ไม่หยุด: ทางออกของผู้ดูแลระบบ — ยกเลิก / ปรับคำขอกลับเป็นฉบับร่าง ระงับ / ยุติบัญชีสมาชิก และเปิดใช้หน่วยงาน
 * อีกครั้ง ด้วยเหตุนี้ด่านนี้จึงอยู่ที่ route ฝั่งผู้ใช้ทีละตัว ไม่ได้อยู่ใน `openTask()` / `completeTask()` /
 * `cancelActiveTask()` ซึ่งทาง admin ใช้ร่วมด้วย (`revertStrandedWork()`, reset, cancel)
 *
 * เปิดใช้อีกครั้งแล้วคำขอเดินต่อจากด่านเดิม — ไม่มีอะไรถูกถอยหรือปิดตอนระงับ
 */
export const FROZEN_ORGANIZATION_STATUSES: readonly OrganizationStatus[] = [
  OrganizationStatus.SUSPENDED,
  OrganizationStatus.INACTIVE,
];

export function isOrganizationFrozen(status: OrganizationStatus): boolean {
  return FROZEN_ORGANIZATION_STATUSES.includes(status);
}

/** ข้อความบน banner ของการ์ด — ยุติการใช้งานใช้คำของสถานะนั้นแทน */
export function frozenOrganizationMessage(status: OrganizationStatus): string {
  return status === OrganizationStatus.INACTIVE
    ? "หน่วยงานถูกยุติการใช้งานแล้ว กรุณาติดต่อผู้ดูแลระบบสำหรับข้อมูลเพิ่มเติม"
    : "หน่วยงานถูกระงับการใช้งานอยู่ กรุณาติดต่อผู้ดูแลระบบสำหรับข้อมูลเพิ่มเติม";
}

export const ORGANIZATION_FROZEN = "organization_frozen";

export function organizationFrozenError(status: OrganizationStatus): WorkflowError {
  return new WorkflowError(ORGANIZATION_FROZEN, frozenOrganizationMessage(status), 409);
}

/**
 * โยน 409 `organization_frozen` ถ้าหน่วยงานถูกระงับหรือยุติ
 *
 * อ่านด้วย `FOR SHARE`: เรียกใน transaction แล้ว lock นี้อยู่จนจบ transaction การระงับที่เข้ามาพร้อมกัน (UPDATE ธรรมดา
 * ใน `organizationStatusRoute()`) จึงต้องรอให้การอนุมัติ commit ก่อน แทนที่จะแทรกระหว่างการตรวจกับการเขียน
 * เรียกนอก transaction ก็ใช้ได้ — lock ปล่อยทันทีเมื่อคำสั่งจบ
 */
export async function assertOrganizationOperable(db: Db, organizationId: string): Promise<void> {
  const rows = await db.$queryRaw<{ status: OrganizationStatus }[]>`
    SELECT status FROM organization.organization WHERE id = ${organizationId}::uuid FOR SHARE`;
  const status = rows[0]?.status;
  if (status && isOrganizationFrozen(status)) throw organizationFrozenError(status);
}

/**
 * รุ่นที่ตอบเองสำหรับ route ที่ไม่ได้อยู่ใน transaction และไม่ได้ครอบ `WorkflowError` ไว้ —
 * `if (await refuseIfOrganizationFrozen(res, request.organizationId)) return;`
 */
export async function refuseIfOrganizationFrozen(res: Response, organizationId: string): Promise<boolean> {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { status: true },
  });
  if (!organization || !isOrganizationFrozen(organization.status)) return false;
  res.status(409).json({
    error: ORGANIZATION_FROZEN,
    message: frozenOrganizationMessage(organization.status),
    organizationStatus: organization.status,
  });
  return true;
}
