/**
 * Audit log ตาม docs/01-user-journey.md §4.9
 *
 * แยกจาก timeline ที่ผู้ใช้เห็น (DatasetRequestEvent / OrganizationEvent) โดยตั้งใจ —
 * ตารางนี้เก็บ diff ของข้อมูลและ IP ไว้ตอบคำถามการตรวจสอบ ไม่ได้เอาไปแสดงบนหน้าจอ
 */
import type { ActivityAction, Prisma } from "@prisma/client";
import type { Request } from "express";

import { prisma } from "../db.js";

interface LogInput {
  action: ActivityAction;
  actorId: string | null;
  targetType: "DatasetRequest" | "Organization" | "User";
  targetId: string;
  targetRef?: string | null;
  before?: unknown;
  after?: unknown;
  req?: Request;
}

/** IP จริงของผู้ใช้ — app ตั้ง trust proxy ไว้แล้ว req.ip จึงข้าม reverse proxy ให้เอง */
function clientIp(req?: Request): string | null {
  return req?.ip ?? null;
}

/** Date และ undefined ลง Json column ไม่ได้ ต้องแปลงเป็นค่าที่ serialize ได้ก่อน */
function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

/**
 * เขียน log หนึ่งแถว
 *
 * ชื่อและ role ของผู้กระทำถูกคัดลอกลงแถว ณ เวลานั้น — ถ้าอ้างอิงอย่างเดียว log จะเปลี่ยนความหมาย
 * เมื่อผู้ใช้เปลี่ยนชื่อหรือถูกถอน role ภายหลัง
 *
 * ล้มเหลวแล้วไม่ throw ต่อ: การบันทึก log ต้องไม่ทำให้คำขอที่ผู้ใช้กดสำเร็จไปแล้วพัง
 */
export async function logActivity(input: LogInput): Promise<void> {
  try {
    const actor = input.actorId
      ? await prisma.user.findUnique({
          where: { id: input.actorId },
          select: { firstName: true, lastName: true, email: true, roles: true, organizationId: true },
        })
      : null;

    await prisma.activityLog.create({
      data: {
        action: input.action,
        actorId: input.actorId,
        actorName: actor
          ? [actor.firstName, actor.lastName].filter(Boolean).join(" ") || actor.email
          : null,
        actorRoles: actor?.roles ?? [],
        actorOrganizationId: actor?.organizationId ?? null,
        targetType: input.targetType,
        targetId: input.targetId,
        targetRef: input.targetRef ?? null,
        before: toJson(input.before),
        after: toJson(input.after),
        ipAddress: clientIp(input.req),
      },
    });
  } catch (err) {
    console.error("[activity] บันทึก audit log ไม่สำเร็จ:", err);
  }
}

/**
 * คืนเฉพาะฟิลด์ที่เปลี่ยนจริง — เก็บทั้ง record ทุกครั้งทำให้ log อ่านไม่ออก
 * เทียบด้วย JSON เพื่อให้ Date และ array เทียบได้โดยไม่ต้องแยกกรณี
 */
export function diffFields<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
): { before: Partial<T>; after: Partial<T> } | null {
  const changedBefore: Partial<T> = {};
  const changedAfter: Partial<T> = {};
  let changed = false;

  for (const key of Object.keys(after) as Array<keyof T>) {
    const a = JSON.stringify(before[key] ?? null);
    const b = JSON.stringify(after[key] ?? null);
    if (a !== b) {
      changedBefore[key] = before[key];
      changedAfter[key] = after[key];
      changed = true;
    }
  }

  return changed ? { before: changedBefore, after: changedAfter } : null;
}
