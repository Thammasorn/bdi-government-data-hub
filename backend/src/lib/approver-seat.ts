/**
 * ปล่อยที่นั่งผู้มีอำนาจกระทำการแทนที่คำขอใบหนึ่งจองไว้
 *
 * เดิมอยู่ใน `routes/organizations.ts` คู่กับ "ยกเลิกผลการตรวจสอบ" ของผู้ประสานงานของ BDI
 * ย้ายมาที่นี่เมื่อ 2026-09-20 (การ์ด "Admin API for registration") เพราะมีผู้เรียกทางที่สอง
 * คือ `POST /api/admin/registrations/organizations/:id/reset` ซึ่งต้องปล่อยที่นั่งด้วยกติกา
 * เดียวกันเป๊ะ — กติกานี้เป็นเรื่องของ unique constraint บน `email`/`cid` ไม่ใช่ของด่านไหน
 */
import { ActivationKeyStatus, Prisma, UserAccountStatus } from "@prisma/client";

import { WorkflowError } from "./workflow.js";

/** ที่นั่งผู้มีอำนาจฯ ที่ถูกปล่อยคืน — ผู้เรียกเอาไปเขียน audit หลัง commit */
export interface ReleasedSeat {
  accountId: string;
  email: string;
  cid: string | null;
  displayName: string;
  status: UserAccountStatus;
  accountDeleted: boolean;
  keptBecause: string | null;
}

/**
 * ปล่อยที่นั่งผู้มีอำนาจกระทำการแทนที่คำขอใบนี้จองไว้ ให้หน่วยงานกรอกใหม่ได้
 *
 * **เพิกถอน activation key อย่างเดียวไม่พอ** บัญชี PENDING ที่ `ensureApproverAccount()`
 * สร้างขึ้นยึด `email` และ `cid` เอาไว้ ซึ่ง unique ทั้งคู่ ถ้าไม่ลบทิ้ง พอผู้ดำเนินการแก้อีเมล
 * แล้วนำส่งใหม่ `approverConflict()` จะหาบัญชีจากอีเมลใหม่ไม่เจอ แล้วไปเจอบัญชีนี้จากเลขบัตร
 * และตอบว่า "เลขบัตรประชาชนนี้ใช้ไม่ได้" ทั้งที่เป็นเลขที่ถูกต้อง — คำขอติดค้างที่เดิมโดยที่
 * คนกรอกไม่มีทางเดาได้ว่าติดอะไร นี่คือเหตุผลทั้งหมดที่ฟังก์ชันนี้มีอยู่
 *
 * `review_task.assigned_user_id` เป็น FK แบบ `Restrict` จึงต้องปลดออกจากด่านที่เพิ่งปิดก่อน
 * ไม่งั้นลบบัญชีไม่ผ่าน ตัวตนของผู้ถูกเชิญไม่ได้หายไปไหน — `completed_by` บันทึกว่าเจ้าหน้าที่
 * BDI เป็นคนปิดด่าน และ `APPROVER_INVITATION_RECALLED` เก็บอีเมลกับเลขบัตรไว้ครบ
 */
export async function releaseApproverSeat(
  tx: Prisma.TransactionClient,
  params: {
    email: string | null;
    organizationId: string;
    /**
     * ด่านที่ต้องปลดการมอบหมายออกก่อนนับว่าบัญชีนี้ยังมีอะไรผูกอยู่
     *
     * "ยกเลิกผลการตรวจสอบ" ส่งมาใบเดียว — ด่านที่มันเพิ่งปิด ส่วนการสั่งกลับเป็นฉบับร่าง
     * ของผู้ดูแลระบบส่งมาทุกใบของคำขอนั้น เพราะมันทิ้งทั้งรอบ ไม่ใช่แค่ด่านที่ค้างอยู่:
     * คำขอที่ถูกส่งกลับไว้ก่อนแล้วไม่มีด่านไหน active เลย ถ้าไม่ปลดใบที่ปิดไปแล้วด้วย
     * `assignedReviewTasks` จะยังนับได้ แล้วบัญชี PENDING ที่ยึด `email`/`cid` ไว้ก็
     * ไม่ถูกลบ — ซึ่งคือปัญหาที่ฟังก์ชันนี้มีไว้แก้พอดี
     */
    taskIds: string[];
    actorId: string;
    reason: string;
  },
): Promise<ReleasedSeat | null> {
  const { email, organizationId, taskIds, actorId } = params;
  if (!email) return null;

  const found = await tx.userAccount.findUnique({ where: { email }, select: { id: true } });
  if (!found) return null;

  // ปลดการมอบหมายออกจากด่านที่เพิ่งปิด **ก่อน** นับว่าบัญชีนี้ยังมีอะไรผูกอยู่บ้าง
  await tx.reviewTask.updateMany({
    where: { id: { in: taskIds }, assignedUserId: found.id },
    data: { assignedUserId: null, updatedBy: actorId },
  });

  const account = await tx.userAccount.findUniqueOrThrow({
    where: { id: found.id },
    select: {
      id: true,
      email: true,
      cid: true,
      displayName: true,
      status: true,
      _count: {
        select: {
          roleAssignments: true,
          assignedReviewTasks: true,
          legalAcceptances: true,
          signatures: true,
        },
      },
    },
  });

  /**
   * ตาข่ายของ `recallRefusal()` ข้อ 4 ไม่ใช่ทางเลือกที่นี่ — ลบบัญชีที่เปิดใช้งานแล้วคือ
   * ลบคนจริงออกจากระบบ ถ้าวันไหนมีผู้เรียกใหม่ที่ลืมเช็ค ให้ล้มทั้ง transaction ดีกว่า
   */
  if (account.status === UserAccountStatus.ACTIVE) {
    throw new WorkflowError(
      "approver_active",
      "บัญชีผู้มีอำนาจอนุมัติเปิดใช้งานแล้ว ปล่อยที่นั่งด้วยวิธีนี้ไม่ได้",
      409,
    );
  }

  /**
   * ลบได้เฉพาะบัญชีที่ "เกิดมาเพราะคำเชิญใบนี้ และยังไม่ได้ทำอะไรเลย" — เงื่อนไขเดียวกับ
   * `DELETE /api/admin/invitations/:id` บวกอีกข้อ: ต้องไม่มีคำเชิญของหน่วยงานอื่นค้างอยู่
   * ไม่งั้นการล้างที่นั่งของหน่วยงานนี้จะไปลบคำเชิญของหน่วยงานอื่นทิ้งไปด้วย
   */
  const keysElsewhere = await tx.activationKey.count({
    where: { userAccountId: account.id, NOT: { organizationId } },
  });
  const counts = account._count;
  const keptBecause =
    keysElsewhere > 0
      ? "บัญชีนี้มีคำเชิญของหน่วยงานอื่นค้างอยู่"
      : counts.roleAssignments > 0
        ? "บัญชีนี้มีสิทธิ์ (role) ผูกอยู่แล้ว"
        : counts.assignedReviewTasks > 0
          ? "บัญชีนี้ยังถูกมอบหมายงานอื่นในสายอนุมัติอยู่"
          : counts.legalAcceptances > 0 || counts.signatures > 0
            ? "บัญชีนี้มีลายเซ็นหรือการยอมรับเอกสารบันทึกไว้แล้ว"
            : null;

  const base = {
    accountId: account.id,
    email: account.email,
    cid: account.cid,
    displayName: account.displayName,
    status: account.status,
  };

  if (keptBecause) {
    /**
     * ลบไม่ได้ ก็ต้องอย่างน้อยทำให้ลิงก์ที่อยู่ในกล่องจดหมายผิด ๆ นั้นใช้ไม่ได้ —
     * คนที่ได้เมลไปคือคนที่ไม่ควรได้ ปล่อยคีย์ที่ยังใช้ได้ทิ้งไว้คือปล่อยทางเข้าไว้ให้เขา
     */
    await tx.activationKey.updateMany({
      where: { userAccountId: account.id, organizationId, status: ActivationKeyStatus.ISSUED },
      data: {
        status: ActivationKeyStatus.REVOKED,
        revokedAt: new Date(),
        revokedBy: actorId,
        revokedReason: params.reason,
        updatedBy: actorId,
      },
    });
    return { ...base, accountDeleted: false, keptBecause };
  }

  // activation_key ตามไปเองด้วย onDelete: Cascade — ไม่ต้องลบแยก
  await tx.userAccount.delete({ where: { id: account.id } });
  return { ...base, accountDeleted: true, keptBecause: null };
}

