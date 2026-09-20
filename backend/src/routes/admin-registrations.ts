/**
 * เส้นทางของผู้ดูแลระบบสำหรับ **คำขอลงทะเบียน** ทั้งสอง Journey — การ์ด
 * "Admin API for registration" (2026-09-20)
 *
 * มีสองคำสั่ง และทั้งคู่ทำสิ่งที่ฟอร์มของหน่วยงานทำไม่ได้โดยตั้งใจ:
 *
 *   PUT  /organizations/:id · /datasets/:id        แก้ snapshot ของคำขอ
 *   POST /organizations/:id/reset · /datasets/:id/reset   พากลับไปเป็นฉบับร่าง
 *
 * **นี่คือคำขอ ไม่ใช่หน่วยงาน** `:id` คือ id ของ `organization_registration_request` /
 * `dataset_registration_request` (หรือเลขที่คำขอ) แถว `organization.organization` เอง
 * แก้ที่ `PATCH /api/admin/organizations/:id` ซึ่งเป็นคนละตารางและคนละเรื่อง — เส้นทาง
 * ในไฟล์นี้ **ไม่แตะ master** แม้แต่ตอนแก้ชื่อหรือรหัสหน่วยงานในคำขอ
 *
 * ป้องกันด้วย `x-admin-token` เหมือน `/api/admin/*` ทุกตัว ผู้เรียกคือสคริปต์ฝั่งผู้ดูแล
 * ระบบ ไม่ใช่เบราว์เซอร์ — ข้อจำกัดของ token นั้น (ไม่หมดอายุ ไม่ผูกกับตัวบุคคล) อยู่ใน
 * `middleware/auth.ts` และเป็นเหตุผลที่ทุก endpoint ที่นี่บังคับ `reason`: `audit_event`
 * ตอบได้แค่ "ระบบทำ" เหตุผลที่พิมพ์มาจึงเป็นสิ่งเดียวที่บอกได้ว่าใครสั่งและทำไม
 */
import { z } from "zod";
import {
  ActivationKeyStatus,
  Prisma,
  RequestStatus,
  ReviewTaskStatus,
  SessionRevokeReason,
  SubjectType,
  UserAccountStatus,
} from "@prisma/client";

import { prisma } from "../db.js";
import { Router } from "../lib/async-route.js";
import { releaseApproverSeat, type ReleasedSeat } from "../lib/approver-seat.js";
import { AuditAction, AuditSubject, diffFields, logAudit } from "../lib/audit.js";
import {
  datasetDraftSchema,
  fromMetadataRow,
  mergeMetadata,
  toMetadataColumns,
} from "../lib/dataset.js";
import {
  activatedApprover,
  revokeRoleAssignments,
  roleIdByCode,
  roleSeatTaken,
} from "../lib/iam.js";
import { buildJourneyProgress, summariseProgress } from "../lib/journey-steps.js";
import { NotificationType, notifyUsers, organizationMemberIds } from "../lib/notify.js";
import { organizationDraftSchema, toRequestData } from "../lib/organization-form.js";
import { revokeSessionsFor } from "../lib/session.js";
import { ROLE_CODES, SYSTEM_USER_ID } from "../lib/system.js";
import { formatZodError, isUuid } from "../lib/validation.js";
import {
  ACTIVE_STATUSES,
  cancelActiveTask,
  deriveRequestStatus,
  taskHistory,
} from "../lib/workflow.js";
import { requireAdminToken } from "../middleware/auth.js";

export const adminRegistrationRouter = Router();
adminRegistrationRouter.use(requireAdminToken);

/**
 * เหตุผลบังคับทุกคำสั่ง — กติกาเดียวกับ `/api/admin/users`
 *
 * ไม่ใช่พิธีกรรม: มันเป็นสิ่งเดียวที่หน่วยงานได้เห็น (ไหลไปเป็นข้อความแจ้งเตือน) และ
 * เป็นสิ่งเดียวที่ตอบได้ว่าทำไม เมื่อมีคนมาถามย้อนหลังว่าคำขอใบนี้ทำไมกลับไปเป็นร่าง
 */
const reasonSchema = z
  .string({ error: "ต้องระบุ reason — เหตุผลนี้ถูกบันทึกลง audit และแจ้งให้หน่วยงานทราบ" })
  .trim()
  .min(10, "กรุณาระบุเหตุผลอย่างน้อย 10 ตัวอักษร — เหตุผลนี้ถูกบันทึกและแจ้งให้หน่วยงานทราบ")
  .max(500);

/**
 * `is_remove_approver` ตามการ์ด — รับทั้ง snake_case และ camelCase
 *
 * การ์ดเขียนเป็น snake_case ส่วน API ที่เหลือทั้งระบบเป็น camelCase สคริปต์ที่คัดลอก
 * ชื่อจากการ์ดมาตรง ๆ จึงต้องใช้ได้ ไม่ใช่เงียบ ๆ ตกไปเป็น `false` แล้วผู้เรียกเข้าใจว่า
 * ถอดผู้มีอำนาจฯ ไปแล้วทั้งที่ยังอยู่
 */
const resetSchema = z
  .object({
    reason: reasonSchema,
    isRemoveApprover: z.boolean().optional(),
    is_remove_approver: z.boolean().optional(),
  })
  .transform((v) => ({
    reason: v.reason,
    isRemoveApprover: v.isRemoveApprover ?? v.is_remove_approver ?? false,
  }));

/**
 * แก้ snapshot ของคำขอหน่วยงาน — ทุกช่องของฉบับร่าง บวกรหัสหน่วยงานที่ฟอร์มแก้ไม่ได้
 *
 * **strict** ต่างจาก schema ของฟอร์มที่ปล่อย key แปลกปลอมทิ้งเงียบ ๆ ตามค่าตั้งต้นของ zod
 * ฟอร์มต้องการแบบนั้น (แท็บเก่าที่ส่งช่องที่เลิกใช้แล้วมาต้องยังบันทึกได้) แต่ผู้เรียกทางนี้
 * เป็นสคริปต์ที่พิมพ์ชื่อช่องเอง พิมพ์ผิดแล้วได้ 200 กลับไปคือคำตอบที่หลอก — ผู้เรียกเชื่อว่า
 * แก้แล้วทั้งที่ไม่มีอะไรเกิดขึ้น (เจอจริงตอนทดสอบ: ส่ง `keywords` ซึ่งจริง ๆ ชื่อ `tagString`)
 */
const organizationEditSchema = organizationDraftSchema.extend({ reason: reasonSchema }).strict();

const datasetEditSchema = datasetDraftSchema.extend({ reason: reasonSchema }).strict();

/**
 * สถานะที่สั่งกลับเป็นฉบับร่างไม่ได้ พร้อมเหตุผลที่ผู้เรียกอ่านแล้วรู้ว่าต้องทำอะไรแทน
 *
 * `APPROVED` ถูกกันไว้เพราะค่าของคำขอถูกคัดลอกออกไปแล้ว — ฝั่งหน่วยงานคือแถว
 * `organization` ที่ ACTIVE พร้อม role ของผู้มีอำนาจฯ และ A0 ที่ลงนามแล้ว ฝั่งชุดข้อมูล
 * คือแถว `dataset` + `dataset_metadata` และงานส่ง DII ที่เข้าคิวไปแล้ว การถอยคำขอ
 * อย่างเดียวจะทิ้งของพวกนั้นค้างไว้โดยไม่มีคำขอที่ยังเดินอยู่เป็นเจ้าของ (ตัดสิน 2026-09-20)
 */
function resetRefusal(
  status: RequestStatus,
  /**
   * ยังมีงานให้ทำถึงแม้คำขอจะเป็นฉบับร่างอยู่แล้ว — คือ "ถอดผู้มีอำนาจฯ ที่เปิดใช้งานแล้ว"
   *
   * ลำดับที่เกิดขึ้นจริง: ผู้ดูแลระบบสั่งรีเซ็ตแบบปกติก่อน แล้วหน่วยงานถึงโทรมาบอกว่า
   * ต้องเปลี่ยนตัวผู้มีอำนาจฯ ด้วย พอถึงตอนนั้นคำขอเป็น DRAFT ไปแล้ว — ถ้า `already_draft`
   * ตัดจบทุกกรณี คำสั่งที่การ์ดบรรยายไว้ทั้งข้อจะเรียกไม่ได้เลยหลังรีเซ็ตรอบแรก
   * (และข้อความตอบกลับของรอบแรกก็บอกให้เรียกซ้ำด้วย `is_remove_approver = true` พอดี)
   */
  draftStillHasWork = false,
): { error: string; message: string } | null {
  if (status === RequestStatus.DRAFT && !draftStillHasWork) {
    return {
      error: "already_draft",
      message: "คำขอนี้เป็นฉบับร่างอยู่แล้ว ไม่มีอะไรต้องย้อนกลับ",
    };
  }
  if (status === RequestStatus.APPROVED) {
    return {
      error: "already_approved",
      message:
        "คำขอนี้ได้รับอนุมัติแล้ว ข้อมูลถูกคัดลอกไปเป็นหน่วยงาน/ชุดข้อมูลที่ใช้งานจริงเรียบร้อย " +
        "จึงย้อนกลับเป็นฉบับร่างไม่ได้ — ถ้าต้องยกเลิกของที่อนุมัติไปแล้ว ให้ดำเนินการกับ" +
        "หน่วยงานหรือชุดข้อมูลนั้นโดยตรง",
    };
  }
  return null;
}

/**
 * ตัด key ที่ไม่ได้ส่งมาออกก่อนเทียบว่าอะไรเปลี่ยน
 *
 * `toRequestData()` คืน **ทุก** key เสมอ โดยที่ช่องที่ผู้เรียกไม่ได้ส่งมาเป็น `undefined` —
 * Prisma ข้าม `undefined` ให้อยู่แล้ว การอัปเดตจึงถูกต้อง แต่ `diffFields()` เดินตาม
 * `Object.keys(after)` และเทียบด้วย `JSON.stringify(v ?? null)` ดังนั้น `undefined` จะ
 * อ่านเป็น `null` แล้วต่างจากค่าเดิมทุกช่อง — `fields_changed` ใน audit จะบอกว่าแก้ทั้งใบ
 * ทั้งที่แตะช่องเดียว ซึ่งทำให้บันทึกที่มีไว้เพื่อตอบว่า "อะไรเปลี่ยน" ตอบผิด
 *
 * `null` **ไม่ถูกตัด** เพราะมันคือการสั่งล้างค่าจริง ๆ (`phoneExtensionSchema` แปลง `""`
 * เป็น `null`) ต่างจาก `providedOnly()` ในฟอร์มที่ตัดทั้งคู่ด้วยเหตุผลคนละเรื่อง
 */
function sentOnly<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}

/** ค่าที่ต้องล้างทุกครั้งที่คำขอกลับไปเป็นฉบับร่าง — ไม่งั้น status ที่ derive ได้ไม่ใช่ DRAFT */
const DRAFT_RESET_COLUMNS = {
  submittedAt: null,
  rejectedAt: null,
  cancelledAt: null,
  cancelledBy: null,
  cancellationReason: null,
  updatedBy: SYSTEM_USER_ID,
} as const;

/** ความคืบหน้าที่ผู้เรียกใช้ตรวจว่าขั้นถูกรีเซ็ตจริง — อ่านจากแถวเดียวกับที่หน้าจอใช้ */
async function progressOf(subjectType: SubjectType, request: { id: string; status: RequestStatus }) {
  const tasks = await taskHistory(prisma, subjectType, request.id);
  const active = tasks.find((t) => ACTIVE_STATUSES.includes(t.status)) ?? null;
  return summariseProgress(
    buildJourneyProgress({ subjectType, status: request.status, tasks, active }),
  );
}

/**
 * `:id` รับได้ทั้ง uuid และ **เลขที่คำขอ** (ORG-REG-2026-0001)
 *
 * ผู้เรียกทางนี้เป็นคนที่กำลังไล่ปัญหาจากอีเมลหรือหน้าจอ ซึ่งพิมพ์เลขที่คำขอไว้ ส่วน uuid
 * ไม่เคยปรากฏที่ไหนนอกจาก URL — บังคับให้ไปหา uuid ก่อนคือบังคับให้เปิดฐานข้อมูล
 */
const byIdOrNumber = (id: string) =>
  isUuid(id) ? { id } : { requestNumber: id };

const notFound = (res: import("express").Response, message: string) =>
  res.status(404).json({ error: "not_found", message });

// ══════════════════════════════════════════════════════ คำขอลงทะเบียนหน่วยงาน

const ORG_SUBJECT = SubjectType.ORGANIZATION_REGISTRATION_REQUEST;

function organizationShape(request: {
  id: string;
  requestNumber: string;
  status: RequestStatus;
  organizationId: string;
  organizationCode: string | null;
  organizationNameTh: string | null;
  approverEmail: string | null;
  approverCid: string | null;
  userEmail: string | null;
  submittedAt: Date | null;
  updatedAt: Date;
}) {
  return {
    kind: "ORGANIZATION" as const,
    id: request.id,
    requestNumber: request.requestNumber,
    status: request.status,
    organizationId: request.organizationId,
    organizationCode: request.organizationCode,
    organizationNameTh: request.organizationNameTh,
    approverEmail: request.approverEmail,
    approverCid: request.approverCid,
    contactEmail: request.userEmail,
    submittedAt: request.submittedAt,
    updatedAt: request.updatedAt,
  };
}

/**
 * แก้ snapshot ของคำขอลงทะเบียนหน่วยงาน — **ข้ามกฎล็อกของฟอร์มทั้งสามข้อ**
 *
 * ฟอร์มของหน่วยงานล็อกไว้สามที่ และเส้นทางนี้เขียนทับได้ทั้งหมด (ตัดสิน 2026-09-20):
 *   1. `organizationCode` ฟอร์มแก้ไม่ได้เลย — ที่นี่เขียนลง snapshot ตามที่ส่งมา
 *   2. ส่วนผู้ดำเนินการ ฟอร์มเขียนทับจากบัญชีที่นำส่งเสมอ — ที่นี่รับค่าจาก body
 *   3. อีเมลกับเลขบัตรของผู้มีอำนาจฯ ที่เปิดใช้งานบัญชีแล้ว — ที่นี่รับค่าจาก body เช่นกัน
 *
 * ข้อ 3 คือข้อที่อันตรายจริง และ **ไม่ได้ถูกกันไว้ ตั้งใจให้ผ่าน**: คำขอจะระบุชื่อคนหนึ่ง
 * ขณะที่อีกบัญชีถือ `ORGANIZATION_APPROVER` และเป็นคนที่จะลงนาม A0 จริง ๆ ตอบกลับจึงมี
 * `warnings` บอกเมื่อเกิดสภาพนั้นขึ้น — ทางที่ตั้งใจให้ใช้เปลี่ยนตัวคนคือ
 * `POST /:id/reset` พร้อม `is_remove_approver = true`
 *
 * แก้ได้**ทุกสถานะ** รวมถึงตอนคำขอค้างอยู่ในคิวของผู้ตรวจและตอนอนุมัติไปแล้ว ด่านที่
 * ค้างอยู่ไม่ถูกแตะ — คำขอยังอยู่ที่เดิม เปลี่ยนแค่เนื้อใน
 */
adminRegistrationRouter.put("/organizations/:id", async (req, res) => {
  const parsed = organizationEditSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "validation", fields: formatZodError(parsed.error) });
    return;
  }
  const { reason, ...input } = parsed.data;

  const before = await prisma.organizationRegistrationRequest.findFirst({
    where: byIdOrNumber(req.params.id),
  });
  if (!before) {
    notFound(res, "ไม่พบคำขอลงทะเบียนหน่วยงานนี้");
    return;
  }

  /**
   * `organizationCode` ไม่ได้อยู่ในผลของ `toRequestData()` โดยตั้งใจ (ฟอร์มเขียนไม่ได้)
   * จึงต่อเข้ามาตรงนี้ — ที่เดียวในระบบที่เขียนคอลัมน์นี้บน snapshot ได้
   *
   * ไม่ตรวจว่าชนรหัสของหน่วยงานอื่นหรือไม่ที่นี่: คอลัมน์นี้บน **คำขอ** ไม่ unique
   * และ `POST /:id/submit` ตรวจให้อยู่แล้วก่อนที่มันจะไปถึงแถว `organization` ที่ unique จริง
   */
  const mapped = await toRequestData(input);

  /**
   * ที่อยู่ไม่ถูกแตะเลยเมื่อ body ไม่ได้พูดถึงมัน
   *
   * `resolveAddressCodes()` คืน **null** (ไม่ใช่ undefined) เมื่อไม่ได้รับชื่อจังหวัด/อำเภอ/
   * ตำบลมา — `sentOnly()` จึงตัดมันไม่ได้ และคำสั่งแก้เบอร์โทรช่องเดียวจะล้างรหัสที่อยู่
   * ทั้งสามคอลัมน์ทิ้งไปด้วยอย่างเงียบ ๆ (เจอตอนทดสอบ) ฟอร์มของหน่วยงานไม่เจอปัญหานี้
   * เพราะมันส่งทั้งใบทุกครั้ง แต่เส้นทางนี้โฆษณาว่าแก้เฉพาะช่องที่ส่งมา จึงต้องรักษาสัญญา
   *
   * ที่อยู่เป็นก้อนเดียวกันสามช่อง แก้ทีละช่องไม่ได้อยู่แล้ว (`lookupZipcode()` ต้องการครบทั้งสาม)
   * เงื่อนไขจึงเป็น "แตะที่อยู่ไหม" ไม่ใช่ "แตะช่องไหนบ้าง"
   */
  const ADDRESS_COLUMNS = [
    "organizationProvinceCode",
    "organizationDistrictCode",
    "organizationSubdistrictCode",
  ] as const;
  const touchedAddress =
    input.province !== undefined ||
    input.district !== undefined ||
    input.subdistrict !== undefined;
  if (!touchedAddress) for (const column of ADDRESS_COLUMNS) delete mapped[column];

  const snapshot = {
    ...sentOnly(mapped),
    ...(input.organizationCode !== undefined
      ? { organizationCode: input.organizationCode }
      : {}),
  };

  const after = await prisma.organizationRegistrationRequest.update({
    where: { id: before.id },
    data: { ...snapshot, updatedBy: SYSTEM_USER_ID },
  });

  const changed = diffFields(
    before as unknown as Record<string, unknown>,
    snapshot as Record<string, unknown>,
  );

  await logAudit({
    action: AuditAction.REQUEST_UPDATED,
    subjectType: AuditSubject.ORGANIZATION_REGISTRATION_REQUEST,
    subjectId: before.id,
    organizationId: before.organizationId,
    before: changed?.before,
    after: changed?.after,
    metadata: {
      reason,
      updated_via: "ADMIN_API",
      request_number: before.requestNumber,
      status: before.status,
      fields_changed: changed ? Object.keys(changed.after) : [],
    },
  });

  res.json({
    registration: organizationShape(after),
    fieldsChanged: changed ? Object.keys(changed.after) : [],
    warnings: await organizationEditWarnings(after),
    message: changed
      ? "บันทึกการแก้ไขคำขอแล้ว — ไม่ได้แตะด่านที่ค้างอยู่และไม่ได้แตะแถวหน่วยงาน"
      : "ไม่มีช่องไหนเปลี่ยนค่า",
  });
});

/**
 * สภาพที่เส้นทางนี้ยอมให้เกิดได้ แต่ผู้เรียกควรรู้ตัว
 *
 * ไม่ใช่ error — ผู้เรียกเลือกไว้แล้วว่าต้องการข้ามกฎล็อก หน้าที่ที่เหลือคือบอกว่าตอนนี้
 * ข้อมูลสองที่ไม่ตรงกันตรงไหน เพื่อให้ไม่ต้องไปพบเอาตอนที่คนอื่นกดอนุมัติ
 */
async function organizationEditWarnings(request: {
  status: RequestStatus;
  organizationId: string;
  approverEmail: string | null;
  approverCid: string | null;
}): Promise<string[]> {
  /**
   * ถามจาก**ที่นั่งของหน่วยงาน** ไม่ใช่จากอีเมลบนคำขอ
   *
   * `activatedApprover()` ค้นจาก `request.approverEmail` ซึ่งเป็นค่าที่ PUT ใบนี้เพิ่ง
   * เขียนทับไปเมื่อกี้ — พอแก้อีเมลเป็นคนใหม่ มันก็หาไม่เจอแล้วตอบ null เตือนจึงเงียบ
   * พอดีในเคสเดียวที่ต้องเตือน ที่นั่งเป็นสิ่งที่ตอบว่า "ใครจะลงนามจริง" ได้โดยไม่ขึ้นกับ
   * ค่าที่เพิ่งพิมพ์ลงไป (กติกาเดียวกับ `roleSeatTaken()` ใน `approverConflict()`)
   */
  const seatRoleId = await roleIdByCode(prisma, ROLE_CODES.ORGANIZATION_APPROVER);
  const seat = await roleSeatTaken(prisma, {
    organizationId: request.organizationId,
    roleId: seatRoleId,
  });
  const warnings: string[] = [];

  if (request.status === RequestStatus.APPROVED) {
    warnings.push(
      "คำขอนี้อนุมัติไปแล้ว ค่าที่เพิ่งแก้จึงอยู่แค่ใน snapshot ของคำขอ " +
        "ไม่ได้ไหลไปที่แถวหน่วยงานที่ใช้งานจริง — ถ้าต้องแก้ที่นั่นด้วย ใช้ PATCH /api/admin/organizations/:id",
    );
  }

  if (seat) {
    const holder = await prisma.userAccount.findUniqueOrThrow({
      where: { id: seat.userAccountId },
      select: { email: true, cid: true },
    });
    const emailDiffers =
      (request.approverEmail ?? "").toLowerCase() !== holder.email.toLowerCase();
    const cidDiffers = Boolean(request.approverCid) && request.approverCid !== holder.cid;
    if (emailDiffers || cidDiffers) {
      warnings.push(
        `ผู้มีอำนาจอนุมัติที่เปิดใช้งานบัญชีและถือสิทธิ์ของหน่วยงานนี้คือ ${holder.email} ` +
          "ซึ่งไม่ตรงกับที่คำขอระบุไว้แล้ว — คนที่จะลงนาม A0 คือเจ้าของบัญชีนั้น ไม่ใช่ชื่อในคำขอ " +
          "ถ้าต้องการเปลี่ยนตัวจริง ๆ ให้ใช้ POST /api/admin/registrations/organizations/:id/reset " +
          "พร้อม is_remove_approver = true",
      );
    }
  }

  return warnings;
}

/**
 * พาคำขอลงทะเบียนหน่วยงานกลับไปเป็นฉบับร่าง
 *
 * สี่อย่างเกิดพร้อมกันใน transaction เดียว ตามการ์ด:
 *
 *   1. ด่านที่ค้างอยู่ถูกปิดเป็น `CANCELLED` — ไม่เกิดผลการตรวจใด ๆ ต่างจากการส่งกลับ
 *      ซึ่งเป็น**ผล**ของด่านที่มีคนตัดสิน (`cancelActiveTask()` ใน lib/workflow.ts)
 *   2. `submitted_at` ถูกล้าง เพราะ `deriveRequestStatus()` อ่านค่านี้เป็น `hasSubmitted`
 *      ไม่ล้างแล้วสถานะจะออกมาเป็น SUBMITTED ทั้งที่ไม่มีด่านไหนเปิดอยู่ (บทเรียนเดียวกับ
 *      `revertStrandedWork()` ใน routes/admin-users.ts) — `rejected_at` / `cancelled_at`
 *      ด้วย ไม่งั้นใบที่ถูกปฏิเสธหรือยกเลิกจะไม่ยอมกลับมาเป็น DRAFT
 *   3. ที่นั่งผู้มีอำนาจกระทำการแทนถูกจัดการตาม `is_remove_approver` (ดูข้างล่าง)
 *   4. ขั้นตอนบนหน้าจอย้อนกลับไปขั้นที่ 1 — ไม่ต้องทำอะไรเพิ่ม `buildJourneyProgress()`
 *      ถือว่าคำขอที่เป็น DRAFT ยังไม่มีรอบไหนนับเลย (แก้คู่กันใน lib/journey-steps.ts)
 *
 * **ประวัติยังอยู่ครบ** ไม่มีแถว `review_task` ไหนถูกลบ ไทม์ไลน์จึงยังเล่าได้ว่ารอบที่แล้ว
 * เดินไปถึงไหนและจบลงเพราะอะไร — เหตุผลที่พิมพ์มาอยู่บน `cancellation_reason` ของด่านที่ถูก
 * ยกเลิก และใน `audit_event`
 *
 * **ที่นั่งผู้มีอำนาจกระทำการแทน** มีสามทางออก และทางที่ได้ขึ้นกับว่าเขาเปิดใช้งานบัญชีไปแล้วหรือยัง:
 *
 *   - ยังไม่เปิดใช้งาน (ทุกค่าของ `is_remove_approver`) — เพิกถอนคำเชิญและปล่อยที่นั่งคืน
 *     ผ่าน `releaseApproverSeat()` ซึ่งลบบัญชี PENDING ที่ยึด `email`/`cid` ไว้ทิ้งเมื่อมัน
 *     เกิดมาเพราะคำเชิญใบนี้และยังไม่ได้ทำอะไรเลย นี่คือเส้นทางเดียวกับ "ยกเลิกผลการตรวจสอบ"
 *     ของผู้ประสานงานของ BDI ที่การ์ดอ้างถึง ผลคือช่องอีเมลกับเลขบัตรกลับมาแก้ได้
 *   - เปิดใช้งานแล้ว + `is_remove_approver = false` (ค่าตั้งต้น) — **ไม่แตะเขาเลย** บัญชี
 *     ยังถือ role อยู่ `activatedApprover()` จึงยังตอบว่ามีคนนั่งอยู่ และฟอร์มยังล็อก
 *     สองช่องนั้นไว้ตามเดิม ซึ่งคือ "disable email และ cid" ที่การ์ดสั่ง
 *   - เปิดใช้งานแล้ว + `is_remove_approver = true` — เพิกถอน role, เพิกถอน session และ
 *     คำเชิญที่ยังใช้ได้ แล้วปิดบัญชีเป็น `DEACTIVATED` พอบัญชีไม่ ACTIVE ที่นั่งก็ว่าง
 *     (`roleSeatTaken()` ตัดสินจากสถานะบัญชี) และ `activatedApprover()` ตอบ null ช่องทั้งสอง
 *     จึงกลับมาแก้ได้ **อีเมลกับเลขบัตรยังผูกกับบัญชีที่ปิดไว้** เพื่อให้ประวัติอ่านกลับได้
 *     และให้ `POST /api/admin/users/:id/reactivate` พาคนเดิมกลับมาได้ถ้าเป็นการสั่งผิด
 *
 * ค่าที่กรอกไว้ในช่องผู้มีอำนาจฯ **ไม่ถูกล้าง** ทุกทาง — การ์ดสั่งให้ "enable field"
 * ไม่ใช่ล้างค่า และคนที่มากรอกใหม่ต้องเห็นว่าเดิมเป็นใครถึงจะรู้ว่าต้องแก้อะไร
 */
adminRegistrationRouter.post("/organizations/:id/reset", async (req, res) => {
  const parsed = resetSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "validation", fields: formatZodError(parsed.error) });
    return;
  }
  const { reason, isRemoveApprover } = parsed.data;

  const request = await prisma.organizationRegistrationRequest.findFirst({
    where: byIdOrNumber(req.params.id),
  });
  if (!request) {
    notFound(res, "ไม่พบคำขอลงทะเบียนหน่วยงานนี้");
    return;
  }

  const approver = await activatedApprover(prisma, request);

  const refusal = resetRefusal(request.status, Boolean(approver && isRemoveApprover));
  if (refusal) {
    res.status(409).json(refusal);
    return;
  }

  /**
   * ทุกด่านของคำขอใบนี้ ไม่ใช่แค่ใบที่ค้างอยู่ — รอบนี้ถูกทิ้งทั้งรอบ ดู `taskIds`
   * ใน `releaseApproverSeat()` ว่าทำไมการปลดเฉพาะด่านที่ active ถึงไม่พอที่นี่
   */
  const taskIds = (
    await prisma.reviewTask.findMany({
      where: { subjectType: ORG_SUBJECT, subjectId: request.id },
      select: { id: true },
    })
  ).map((t) => t.id);

  /**
   * สิ่งที่เกิดกับที่นั่ง — คืนออกมาจาก transaction ไม่ได้เก็บไว้ในตัวแปรข้างนอก
   *
   * `audit_event` กับการแจ้งเตือนเขียนผ่าน `prisma` ตัวหลัก ไม่ใช่ `tx` จึงต้องรอให้
   * commit ก่อน ไม่งั้น rollback แล้วจะเหลือหลักฐานของเหตุการณ์ที่ไม่เคยเกิด
   */
  const outcome = await prisma.$transaction(async (tx) => {
    let releasedSeat: ReleasedSeat | null = null;
    let deactivated: { id: string; email: string; rolesRevoked: number } | null = null;
    const cancelled = await cancelActiveTask(tx, {
      subjectType: ORG_SUBJECT,
      subjectId: request.id,
      actorId: SYSTEM_USER_ID,
      reason,
    });

    if (approver && isRemoveApprover) {
      const revoked = await revokeRoleAssignments(tx, {
        userAccountId: approver.id,
        actorId: SYSTEM_USER_ID,
        reason,
      });
      await tx.activationKey.updateMany({
        where: { userAccountId: approver.id, status: ActivationKeyStatus.ISSUED },
        data: {
          status: ActivationKeyStatus.REVOKED,
          revokedAt: new Date(),
          revokedBy: SYSTEM_USER_ID,
          revokedReason: reason,
          updatedBy: SYSTEM_USER_ID,
        },
      });
      await revokeSessionsFor(tx, {
        userAccountId: approver.id,
        reason: SessionRevokeReason.ACCOUNT_SUSPENDED,
      });
      /**
       * `review_task.assigned_user_id` เป็น FK แบบ Restrict — บัญชีไม่ได้ถูกลบที่นี่
       * (ต่างจาก `releaseApproverSeat()`) จึงไม่ต้องปลด แต่ต้องปลดอยู่ดี ไม่งั้นด่านที่
       * ถูกยกเลิกยังชี้ว่าคนที่เพิ่งถูกถอดเป็นผู้รับผิดชอบของคำขอที่กลับไปเป็นร่างแล้ว
       */
      await tx.reviewTask.updateMany({
        where: { id: { in: taskIds }, assignedUserId: approver.id, status: ReviewTaskStatus.CANCELLED },
        data: { assignedUserId: null, updatedBy: SYSTEM_USER_ID },
      });
      await tx.userAccount.update({
        where: { id: approver.id },
        data: {
          status: UserAccountStatus.DEACTIVATED,
          deactivatedAt: new Date(),
          updatedBy: SYSTEM_USER_ID,
        },
      });
      deactivated = { id: approver.id, email: approver.email, rolesRevoked: revoked.length };
    } else if (!approver) {
      releasedSeat = await releaseApproverSeat(tx, {
        email: request.approverEmail,
        organizationId: request.organizationId,
        taskIds,
        actorId: SYSTEM_USER_ID,
        reason,
      });
    }

    await tx.organizationRegistrationRequest.update({
      where: { id: request.id },
      data: DRAFT_RESET_COLUMNS,
    });

    // สถานะคำนวณใหม่เสมอ ไม่ตั้งค่าด้วยมือ — กติกาของ lib/workflow.ts
    const status = await deriveRequestStatus(tx, {
      subjectType: ORG_SUBJECT,
      subjectId: request.id,
      hasSubmitted: false,
      cancelled: false,
    });
    const updated = await tx.organizationRegistrationRequest.update({
      where: { id: request.id },
      data: { status, updatedBy: SYSTEM_USER_ID },
    });
    return { updated, cancelled, releasedSeat, deactivated };
  });

  const seat = outcome.releasedSeat;
  const removed = outcome.deactivated;

  await logAudit({
    action: AuditAction.REQUEST_RESET_TO_DRAFT,
    subjectType: AuditSubject.ORGANIZATION_REGISTRATION_REQUEST,
    subjectId: request.id,
    organizationId: request.organizationId,
    before: { status: request.status, submittedAt: request.submittedAt },
    after: { status: outcome.updated.status },
    metadata: {
      reason,
      reset_via: "ADMIN_API",
      request_number: request.requestNumber,
      is_remove_approver: isRemoveApprover,
      cancelled_task_type: outcome.cancelled?.taskType ?? null,
      approver_outcome: approverOutcomeCode(approver, isRemoveApprover, seat),
    },
  });

  /**
   * หลักฐานว่าคำเชิญไปหาที่อยู่ไหนและถูกยกเลิกไปแล้ว — แถวเดียวกับที่ "ยกเลิกผลการตรวจสอบ"
   * เขียน และด้วยเหตุผลเดียวกัน: บัญชี PENDING ใบนั้นมักถูกลบทิ้งไปด้วย แถวนี้จึงเป็น
   * ร่องรอยเดียวที่เหลือ
   */
  if (seat) {
    await logAudit({
      action: AuditAction.APPROVER_INVITATION_RECALLED,
      subjectType: AuditSubject.ORGANIZATION_REGISTRATION_REQUEST,
      subjectId: request.id,
      organizationId: request.organizationId,
      before: { email: seat.email, cid: seat.cid, displayName: seat.displayName, status: seat.status },
      after: { accountDeleted: seat.accountDeleted, keptBecause: seat.keptBecause ?? undefined },
      metadata: { reason, recalled_via: "ADMIN_RESET_API" },
    });
  }

  if (removed) {
    await logAudit({
      action: AuditAction.USER_ACCOUNT_DEACTIVATED,
      subjectType: AuditSubject.USER_ACCOUNT,
      subjectId: removed.id,
      organizationId: request.organizationId,
      before: { status: UserAccountStatus.ACTIVE, email: removed.email },
      after: { status: UserAccountStatus.DEACTIVATED },
      metadata: {
        reason,
        deactivated_via: "ADMIN_RESET_API",
        roles_revoked: removed.rolesRevoked,
        request_number: request.requestNumber,
      },
    });
  }

  await announceReset({
    subjectType: ORG_SUBJECT,
    subjectId: request.id,
    organizationId: request.organizationId,
    createdBy: request.createdBy,
    title: "คำขอลงทะเบียนหน่วยงานถูกปรับกลับเป็นฉบับร่าง",
    reason,
  });

  res.json({
    registration: organizationShape(outcome.updated),
    progress: await progressOf(ORG_SUBJECT, outcome.updated),
    cancelledTask: outcome.cancelled
      ? { id: outcome.cancelled.id, taskType: outcome.cancelled.taskType }
      : null,
    approver: {
      outcome: approverOutcomeCode(approver, isRemoveApprover, seat),
      email: approver?.email ?? seat?.email ?? request.approverEmail,
      accountDeleted: seat?.accountDeleted ?? false,
      keptBecause: seat?.keptBecause ?? null,
      fieldsEditable: !(approver && !isRemoveApprover),
    },
    message: resetMessage(approver, isRemoveApprover, seat, request.status === RequestStatus.DRAFT),
  });
});

type ApproverOutcome =
  | "NONE"
  | "INVITATION_REVOKED"
  | "ACCOUNT_DELETED"
  | "KEPT_ACTIVE"
  | "DEACTIVATED";

function approverOutcomeCode(
  approver: { id: string } | null,
  isRemoveApprover: boolean,
  seat: ReleasedSeat | null,
): ApproverOutcome {
  if (approver) return isRemoveApprover ? "DEACTIVATED" : "KEPT_ACTIVE";
  if (!seat) return "NONE";
  return seat.accountDeleted ? "ACCOUNT_DELETED" : "INVITATION_REVOKED";
}

function resetMessage(
  approver: { email: string } | null,
  isRemoveApprover: boolean,
  seat: ReleasedSeat | null,
  wasDraft: boolean,
): string {
  // คำขอที่เป็นร่างอยู่แล้วมาถึงตรงนี้ได้ทางเดียว — เรียกมาเพื่อถอดผู้มีอำนาจฯ อย่างเดียว
  const head = wasDraft
    ? "คำขอยังเป็นฉบับร่างตามเดิม "
    : "คำขอกลับไปเป็นฉบับร่างแล้ว ประวัติการตรวจสอบยังอยู่ครบ และขั้นตอนย้อนกลับไปขั้นที่ 1 ";

  if (approver && isRemoveApprover) {
    return (
      head +
      `— ถอดสิทธิ์และปิดบัญชีผู้มีอำนาจอนุมัติ (${approver.email}) แล้ว ` +
      "ช่องอีเมลและเลขบัตรประชาชนกลับมาแก้ไขได้ " +
      "ถ้าสั่งผิด ให้ใช้ POST /api/admin/users/:id/reactivate แล้วมอบ role คืน"
    );
  }
  if (approver) {
    return (
      head +
      `— ผู้มีอำนาจอนุมัติ (${approver.email}) เปิดใช้งานบัญชีแล้ว จึงยังถือสิทธิ์อยู่ตามเดิม ` +
      "ช่องอีเมลและเลขบัตรประชาชนยังล็อกไว้ ถ้าต้องเปลี่ยนตัวคน ให้เรียกซ้ำด้วย is_remove_approver = true"
    );
  }
  if (seat?.accountDeleted) {
    return head + "— เพิกถอนคำเชิญผู้มีอำนาจอนุมัติและคืนอีเมลกับเลขบัตรประชาชนให้กรอกใหม่ได้แล้ว";
  }
  if (seat) {
    return (
      head +
      `— เพิกถอนคำเชิญผู้มีอำนาจอนุมัติแล้ว แต่บัญชีที่ค้างอยู่ยังลบไม่ได้ (${seat.keptBecause}) ` +
      "อีเมลและเลขบัตรประชาชนจึงยังผูกกับบัญชีนั้น"
    );
  }
  return head + "— คำขอนี้ยังไม่มีผู้มีอำนาจอนุมัติที่ต้องจัดการ";
}

// ══════════════════════════════════════════════════════ คำขอลงทะเบียนชุดข้อมูล

const DATASET_SUBJECT = SubjectType.DATASET_REGISTRATION_REQUEST;

function datasetShape(request: {
  id: string;
  requestNumber: string;
  status: RequestStatus;
  organizationId: string;
  proposedTitle: string | null;
  createdDatasetId: string | null;
  submittedAt: Date | null;
  updatedAt: Date;
}) {
  return {
    kind: "DATASET" as const,
    id: request.id,
    requestNumber: request.requestNumber,
    status: request.status,
    organizationId: request.organizationId,
    proposedTitle: request.proposedTitle,
    createdDatasetId: request.createdDatasetId,
    submittedAt: request.submittedAt,
    updatedAt: request.updatedAt,
  };
}

/**
 * แก้ metadata ของคำขอลงทะเบียนชุดข้อมูล
 *
 * รวมกับค่าที่บันทึกไว้เดิมก่อนเสมอ (`mergeMetadata()`) ด้วยเหตุผลเดียวกับฟอร์มของ
 * หน่วยงาน: กฎในชีท conditions ตัดสินจากคำตอบทั้งใบ ไม่ใช่เฉพาะช่องที่เพิ่งแก้ —
 * ส่งมาแค่ `dataClassification` ช่องเดียวก็เปลี่ยนค่าที่ถูกต้องของอีกหกช่องได้
 *
 * ต่างจากฟอร์มตรงเดียว: **ทำได้ทุกสถานะ** ไม่ใช่แค่ DRAFT/RETURNED และไม่แตะด่านที่ค้างอยู่
 */
adminRegistrationRouter.put("/datasets/:id", async (req, res) => {
  const parsed = datasetEditSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "validation", fields: formatZodError(parsed.error) });
    return;
  }
  const { reason, ...input } = parsed.data;

  const before = await prisma.datasetRegistrationRequest.findFirst({
    where: byIdOrNumber(req.params.id),
    include: { metadata: true },
  });
  if (!before) {
    notFound(res, "ไม่พบคำขอลงทะเบียนชุดข้อมูลนี้");
    return;
  }

  const previous = fromMetadataRow(before.metadata);
  const values = mergeMetadata(previous, input);
  const { columns, extra } = toMetadataColumns(values, before.metadata?.additionalMetadataJson);

  const after = await prisma.$transaction(async (tx) => {
    await tx.datasetRegistrationMetadata.upsert({
      where: { datasetRegistrationRequestId: before.id },
      update: {
        ...columns,
        additionalMetadataJson: extra as Prisma.InputJsonValue,
        updatedBy: SYSTEM_USER_ID,
      },
      create: {
        datasetRegistrationRequestId: before.id,
        ...columns,
        ownerOrgId: before.organizationId,
        additionalMetadataJson: extra as Prisma.InputJsonValue,
        createdBy: SYSTEM_USER_ID,
        updatedBy: SYSTEM_USER_ID,
      },
    });
    return tx.datasetRegistrationRequest.update({
      where: { id: before.id },
      data: {
        proposedTitle: values.title ?? before.proposedTitle,
        updatedBy: SYSTEM_USER_ID,
      },
    });
  });

  const changed = diffFields(
    previous as unknown as Record<string, unknown>,
    values as unknown as Record<string, unknown>,
  );

  await logAudit({
    action: AuditAction.REQUEST_UPDATED,
    subjectType: AuditSubject.DATASET_REGISTRATION_REQUEST,
    subjectId: before.id,
    organizationId: before.organizationId,
    before: changed?.before,
    after: changed?.after,
    metadata: {
      reason,
      updated_via: "ADMIN_API",
      request_number: before.requestNumber,
      status: before.status,
      fields_changed: changed ? Object.keys(changed.after) : [],
    },
  });

  const warnings: string[] = [];
  if (before.status === RequestStatus.APPROVED) {
    warnings.push(
      "คำขอนี้อนุมัติไปแล้ว ค่าที่เพิ่งแก้จึงอยู่แค่ใน snapshot ของคำขอ " +
        "ไม่ได้ไหลไปที่ dataset_metadata ของชุดข้อมูลที่เผยแพร่อยู่",
    );
  }

  res.json({
    registration: datasetShape(after),
    fieldsChanged: changed ? Object.keys(changed.after) : [],
    warnings,
    message: changed
      ? "บันทึกการแก้ไขคำขอแล้ว — ไม่ได้แตะด่านที่ค้างอยู่"
      : "ไม่มีช่องไหนเปลี่ยนค่า",
  });
});

/**
 * พาคำขอลงทะเบียนชุดข้อมูลกลับไปเป็นฉบับร่าง — "for dataset, just reset request to draft"
 *
 * เหมือนเส้นทางหน่วยงานทุกอย่าง ลบเรื่องผู้มีอำนาจกระทำการแทนออก: Journey C ไม่มีที่นั่ง
 * ของตัวเอง ผู้ลงนามที่ด่าน `ORGANIZATION_APPROVAL` คือผู้มีอำนาจฯ ของหน่วยงานซึ่งมาจาก
 * การลงทะเบียนหน่วยงาน ไม่ใช่จากคำขอชุดข้อมูลใบนี้ การถอยคำขอชุดข้อมูลจึงต้องไม่แตะเขา
 *
 * ผู้เชี่ยวชาญที่ถูกขอความเห็นไว้ (`assigned_specialist_id`) ก็ไม่ถูกแตะ ด้วยเหตุผลเดียวกัน
 * กับที่การมอบหมายไม่ใช่ด่าน — ความเห็นที่เขาเขียนไว้เป็นส่วนหนึ่งของประวัติที่ต้องเก็บไว้
 */
adminRegistrationRouter.post("/datasets/:id/reset", async (req, res) => {
  const parsed = resetSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "validation", fields: formatZodError(parsed.error) });
    return;
  }
  const { reason } = parsed.data;

  const request = await prisma.datasetRegistrationRequest.findFirst({
    where: byIdOrNumber(req.params.id),
  });
  if (!request) {
    notFound(res, "ไม่พบคำขอลงทะเบียนชุดข้อมูลนี้");
    return;
  }

  const refusal = resetRefusal(request.status);
  if (refusal) {
    res.status(409).json(refusal);
    return;
  }

  const outcome = await prisma.$transaction(async (tx) => {
    const cancelled = await cancelActiveTask(tx, {
      subjectType: DATASET_SUBJECT,
      subjectId: request.id,
      actorId: SYSTEM_USER_ID,
      reason,
    });
    await tx.datasetRegistrationRequest.update({
      where: { id: request.id },
      data: DRAFT_RESET_COLUMNS,
    });
    const status = await deriveRequestStatus(tx, {
      subjectType: DATASET_SUBJECT,
      subjectId: request.id,
      hasSubmitted: false,
      cancelled: false,
    });
    const updated = await tx.datasetRegistrationRequest.update({
      where: { id: request.id },
      data: { status, updatedBy: SYSTEM_USER_ID },
    });
    return { updated, cancelled };
  });

  await logAudit({
    action: AuditAction.REQUEST_RESET_TO_DRAFT,
    subjectType: AuditSubject.DATASET_REGISTRATION_REQUEST,
    subjectId: request.id,
    organizationId: request.organizationId,
    before: { status: request.status, submittedAt: request.submittedAt },
    after: { status: outcome.updated.status },
    metadata: {
      reason,
      reset_via: "ADMIN_API",
      request_number: request.requestNumber,
      cancelled_task_type: outcome.cancelled?.taskType ?? null,
    },
  });

  await announceReset({
    subjectType: DATASET_SUBJECT,
    subjectId: request.id,
    organizationId: request.organizationId,
    createdBy: request.createdBy,
    title: "คำขอลงทะเบียนชุดข้อมูลถูกปรับกลับเป็นฉบับร่าง",
    reason,
  });

  res.json({
    registration: datasetShape(outcome.updated),
    progress: await progressOf(DATASET_SUBJECT, outcome.updated),
    cancelledTask: outcome.cancelled
      ? { id: outcome.cancelled.id, taskType: outcome.cancelled.taskType }
      : null,
    message: "คำขอกลับไปเป็นฉบับร่างแล้ว ประวัติการตรวจสอบยังอยู่ครบ และขั้นตอนย้อนกลับไปขั้นที่ 1",
  });
});

/**
 * บอกฝั่งหน่วยงานว่าคำขออยู่ในมือเขาอีกครั้ง
 *
 * ใช้ชนิด `REQUEST_RETURNED` เพราะปลายทางของผู้รับเหมือนกันเป๊ะ — "คำขอกลับมาอยู่ที่คุณ
 * แล้ว ต้องแก้แล้วนำส่งใหม่" ชนิดนี้เป็นการจัดหมวดของการแจ้งเตือน ไม่ใช่ผลของด่าน
 * (ผลของด่านอยู่ที่ `review_task.result` ซึ่งเส้นทางนี้เขียนเป็น CANCELLED ไม่ใช่ RETURNED)
 * หัวเรื่องเป็นตัวบอกว่าใครสั่งและเพราะอะไร
 *
 * ไม่แจ้งฝั่ง BDI: งานหายไปจากคิวของเขาเอง และคนที่สั่งคือผู้ดูแลระบบซึ่งรู้อยู่แล้ว
 */
async function announceReset(params: {
  subjectType: SubjectType;
  subjectId: string;
  organizationId: string;
  createdBy: string;
  title: string;
  reason: string;
}) {
  const members = await organizationMemberIds(params.organizationId);
  await notifyUsers([...members.users, params.createdBy], {
    type: NotificationType.REQUEST_RETURNED,
    title: params.title,
    message: `ผู้ดูแลระบบปรับคำขอกลับเป็นฉบับร่าง เหตุผล: ${params.reason}`,
    subjectType: params.subjectType,
    subjectId: params.subjectId,
    organizationId: params.organizationId,
  });
}

export { adminRegistrationRouter as default };
