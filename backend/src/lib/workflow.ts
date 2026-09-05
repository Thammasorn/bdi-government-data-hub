/**
 * Workflow engine — schema `review`
 *
 * แนวคิดที่เปลี่ยนไปจากของเดิม: เดิม "คำขออยู่ด่านไหน" ถูกเข้ารหัสไว้ใน status เอง
 * (PENDING_OFFICER_REVIEW, PENDING_ORG_APPROVER, PENDING_OFFICER_FINAL_CHECK, …)
 * แบบใหม่ status เหลือเจ็ดค่าหยาบ ๆ ที่ใช้ร่วมกันทั้งสอง Journey ส่วน "ด่านไหน ใครถือ"
 * ย้ายมาอยู่ที่ review.review_task ทั้งหมด
 *
 * ความสัมพันธ์ระหว่างสองอย่างนี้กำหนดไว้ในภาพ "ความสัมพันธ์กับ review_task"
 * ใน sheet `org_registration_request` และ implement ที่ requestStatusFor() ท้ายไฟล์
 *
 * `PENDING_OFFICER_FINAL_CHECK` ของแบบเดิมไม่มีที่ลงในแบบใหม่เลย — ด่านตรวจซ้ำของ
 * เจ้าหน้าที่ BDI ถูกยกเลิกเมื่อ 2026-08-30 หน่วยงานลงนามแล้วไปที่ BDI_FINAL_APPROVAL ตรง ๆ
 */
import {
  AssignmentSource,
  CommentVisibility,
  Prisma,
  PrismaClient,
  RequestStatus,
  ReviewResult,
  ReviewTaskStatus,
  ReviewTaskType,
  SubjectType,
} from "@prisma/client";

import type { RoleCode } from "./system.js";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * ผลที่ใช้ได้ต่อ task_type — ตารางในภาพ "result" ของ sheet `review_task`
 *
 *   BDI_OFFICER_REVIEW        PASSED, RETURNED, REJECTED, CONFIRMED
 *   DATASET_SPECIALIST_REVIEW PASSED, RETURNED, REJECTED, CONFIRMED
 *   ORGANIZATION_APPROVAL     APPROVED, RETURNED, REJECTED
 *   BDI_FINAL_APPROVAL        APPROVED, RETURNED, REJECTED
 *   ORGANIZATION_REVISION     COMPLETED หรือ CONFIRMED
 */
export const ALLOWED_RESULTS: Record<ReviewTaskType, ReviewResult[]> = {
  [ReviewTaskType.BDI_OFFICER_REVIEW]: [
    ReviewResult.PASSED,
    ReviewResult.RETURNED,
    ReviewResult.REJECTED,
    ReviewResult.CONFIRMED,
  ],
  /**
   * ตารางนี้ตามชีทไว้ครบ แต่ตั้งแต่ 2026-08-30 แถวของผู้เชี่ยวชาญถูกเขียนด้วย CONFIRMED
   * อย่างเดียว (`recordAdvisoryNote()`) — ไม่มีเส้นทางไหนเรียก `completeTask()` กับด่านนี้
   * อีกแล้ว เพราะมันไม่ใช่ด่านที่คำขอค้างอยู่ได้
   */
  [ReviewTaskType.DATASET_SPECIALIST_REVIEW]: [
    ReviewResult.PASSED,
    ReviewResult.RETURNED,
    ReviewResult.REJECTED,
    ReviewResult.CONFIRMED,
  ],
  [ReviewTaskType.ORGANIZATION_APPROVAL]: [
    ReviewResult.APPROVED,
    ReviewResult.RETURNED,
    ReviewResult.REJECTED,
  ],
  [ReviewTaskType.BDI_FINAL_APPROVAL]: [
    ReviewResult.APPROVED,
    ReviewResult.RETURNED,
    ReviewResult.REJECTED,
  ],
  [ReviewTaskType.ORGANIZATION_REVISION]: [ReviewResult.COMPLETED, ReviewResult.CONFIRMED],
};

/** sheet: "result IN ('RETURNED', 'REJECTED') ต้องมี result_comment เสมอ" */
export const RESULTS_REQUIRING_COMMENT: ReviewResult[] = [
  ReviewResult.RETURNED,
  ReviewResult.REJECTED,
];

/** role ที่มีสิทธิ์ทำแต่ละด่าน — ใช้ตรวจก่อนเปิด/ปิด task */
export const TASK_TYPE_ROLES: Record<ReviewTaskType, RoleCode[]> = {
  [ReviewTaskType.BDI_OFFICER_REVIEW]: ["BDI_OFFICER"],
  [ReviewTaskType.DATASET_SPECIALIST_REVIEW]: ["BDI_DATASET_SPECIALIST"],
  [ReviewTaskType.ORGANIZATION_APPROVAL]: ["ORGANIZATION_APPROVER"],
  [ReviewTaskType.BDI_FINAL_APPROVAL]: ["BDI_FINAL_APPROVER"],
  [ReviewTaskType.ORGANIZATION_REVISION]: ["ORGANIZATION_USER"],
};

/**
 * ด่านที่แต่ละ role เป็นคนทำ — **คำนวณจาก TASK_TYPE_ROLES ไม่ได้เขียนซ้ำ**
 *
 * หน้ารายการต้องตอบว่า "ใบไหนค้างอยู่ที่ตำแหน่งของฉัน" ซึ่งเป็นคำถามกลับด้านของ
 * "ด่านนี้ใครทำได้" ที่ตารางข้างบนตอบอยู่ ถ้าเขียนแยกกันสองที่ วันที่เพิ่มด่านใหม่
 * ตารางหนึ่งจะรู้และอีกตารางไม่รู้ แล้วหน้าจอจะบอกคนผิดว่าไม่มีงาน
 */
export const ROLE_TASK_TYPES: Record<string, ReviewTaskType[]> = Object.entries(
  TASK_TYPE_ROLES,
).reduce<Record<string, ReviewTaskType[]>>((acc, [taskType, roles]) => {
  for (const role of roles) (acc[role] ??= []).push(taskType as ReviewTaskType);
  return acc;
}, {});

export class WorkflowError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

/**
 * ข้อความเดียวที่ทุกด่านใช้ตอบเมื่อมีคนอื่นชิงทำไปก่อน
 *
 * ทุกด่านเปิดให้ทุกคนที่ถือ role นั้นกดได้ การกดพร้อมกันจึงเป็นเรื่องปกติ ไม่ใช่ความผิดพลาด
 * ของใคร ข้อความจึงต้องบอกว่าเกิดอะไรขึ้นและให้ทำอะไรต่อ ไม่ใช่แค่บอกว่าล้มเหลว
 */
export const TASK_TAKEN_MESSAGE =
  "มีผู้ใช้ท่านอื่นดำเนินการขั้นตอนนี้ไปแล้ว หน้าจอที่เปิดอยู่เป็นข้อมูลก่อนหน้านั้น กรุณาโหลดหน้าใหม่";

/** field ของคนที่ต้องเอาชื่อไปแสดง — ใช้ร่วมกันทั้งผู้รับมอบหมายและผู้ปิดด่าน */
const TASK_PERSON = {
  id: true,
  displayName: true,
  email: true,
  firstnameTh: true,
  lastnameTh: true,
} as const;

/** สถานะของ task ที่ถือว่ายัง "ค้างอยู่" — lib/queue.ts ใช้ชุดเดียวกันนี้ */
export const ACTIVE_STATUSES: ReviewTaskStatus[] = [
  ReviewTaskStatus.PENDING,
  ReviewTaskStatus.IN_PROGRESS,
];

/** task ที่ยัง active ของคำขอหนึ่งฉบับ — มีได้ไม่เกินหนึ่ง (partial unique index บังคับไว้) */
export async function activeTask(db: Db, subjectType: SubjectType, subjectId: string) {
  return db.reviewTask.findFirst({
    where: { subjectType, subjectId, status: { in: ACTIVE_STATUSES } },
    include: {
      assignedUser: { select: TASK_PERSON },
      completedByUser: { select: TASK_PERSON },
    },
  });
}

export async function taskHistory(db: Db, subjectType: SubjectType, subjectId: string) {
  return db.reviewTask.findMany({
    where: { subjectType, subjectId },
    orderBy: { sequenceNumber: "asc" },
    include: {
      assignedUser: { select: TASK_PERSON },
      completedByUser: { select: TASK_PERSON },
    },
  });
}

/**
 * ค่าที่ตอบว่า "ข้อมูลที่หน้าจอถืออยู่เก่าหรือยัง"
 *
 * `GET /:id` กับ `GET /:id/state` ต้องคิดค่านี้แบบเดียวกันเป๊ะ ไม่งั้นหน้าจอที่เพิ่งโหลดเสร็จ
 * จะเทียบแล้วพบว่าต่าง แล้วขึ้นประกาศ "คำขอเปลี่ยนแปลง" ทั้งที่ไม่มีอะไรเกิดขึ้น
 *
 * เอาค่ามากสุดของแถวคำขอกับ review_task ของมัน — `syncStatus()` เขียนแถวคำขอทุกครั้งที่มี
 * transition ก็จริง แต่ความเห็นของผู้เชี่ยวชาญ (`recordAdvisoryNote()`) เขียนแค่ review_task
 * ถ้าดูแค่แถวคำขอ ไทม์ไลน์จะขยับโดยที่ไม่มีใครรู้
 */
export function stateVersionOf(requestUpdatedAt: Date, latestTaskUpdatedAt: Date | null): string {
  const latest =
    latestTaskUpdatedAt && latestTaskUpdatedAt > requestUpdatedAt
      ? latestTaskUpdatedAt
      : requestUpdatedAt;
  return latest.toISOString();
}

/** เวลาที่ task ล่าสุดของชุดนี้ถูกแตะ — null เมื่อยังไม่มี task เลย */
export function latestTaskTouch(tasks: { updatedAt: Date }[]): Date | null {
  return tasks.reduce<Date | null>(
    (max, t) => (max === null || t.updatedAt > max ? t.updatedAt : max),
    null,
  );
}

/**
 * id ของคนที่ถือ role นี้อยู่จริง ณ ตอนนี้ — null เมื่อไม่มีใครเลย
 *
 * แทนที่ `pickAssignee()` เดิมของทั้งสอง route ซึ่งเลือก "คนที่มี active task น้อยที่สุด"
 * มาใส่ `assigned_user_id` การเกลี่ยงานนั้นไม่เคยถูกใช้ตัดสินอะไร — `canAction()` ดู role
 * ล้วน ๆ, `lib/queue.ts` กรอง "งานของฉัน" ด้วย role, อีเมลก็ส่งหาทุกคนที่ถือ role อยู่แล้ว
 * ผลข้างเคียงเดียวที่มันมีคือทำให้ไทม์ไลน์ขึ้นชื่อคนที่ไม่ได้กด (เกิดจริง 2026-09-04)
 *
 * ใช้สองแบบ: ด่านฝั่ง BDI เรียกเพื่อถามว่า "มีคนทำไหม" แล้วเปิด task โดยไม่ใส่ผู้รับมอบหมาย
 * ส่วนด่านของหน่วยงานเรียกเพื่อเอา id จริง เพราะกติกาใน `assignRole()` บังคับว่าหนึ่ง
 * หน่วยงานมีผู้มีอำนาจลงนามที่ ACTIVE ได้คนเดียว ด่านนั้นจึงเป็นของคนคนนั้นจริง ๆ
 */
export async function roleHolderId(
  db: Db,
  roleCode: RoleCode,
  organizationId?: string | null,
): Promise<string | null> {
  const holder = await db.userRoleAssignment.findFirst({
    where: {
      role: { code: roleCode, isActive: true },
      status: "ACTIVE",
      OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: new Date() } }],
      userAccount: { status: "ACTIVE" },
      ...(organizationId !== undefined ? { organizationId } : {}),
    },
    // เรียงให้ผลนิ่ง — ไม่งั้นสองครั้งติดกันอาจได้คนละคนโดยไม่มีเหตุผล
    orderBy: { createdAt: "asc" },
    select: { userAccountId: true },
  });
  return holder?.userAccountId ?? null;
}

/**
 * เปิด task ใหม่
 *
 * sequence_number = ลำดับของ action ภายในคำขอ (นับรวมทุก task_type)
 * round_number    = รอบของ task_type เดียวกัน เริ่มที่ 1
 *
 * ปิด active task เดิมทิ้งก่อนเสมอ ไม่งั้นชน uq_active_review_task_per_subject
 */
export async function openTask(
  db: Db,
  params: {
    subjectType: SubjectType;
    subjectId: string;
    taskType: ReviewTaskType;
    /**
     * NULL = ด่านของ **บทบาท** ไม่ใช่ของคน
     *
     * ด่านฝั่ง BDI ส่ง null: `canAction()` ตัดสินจาก role ล้วน ๆ การใส่ชื่อใครลงไปคือการ
     * ตอบคำถามที่ระบบยังไม่รู้คำตอบ และเคยหลุดไปโผล่เป็นชื่อผู้ทำบนไทม์ไลน์
     */
    assignedUserId?: string | null;
    assignedRole: RoleCode;
    actorId: string;
    assignedById?: string | null;
    assignmentSource?: AssignmentSource;
    dueAt?: Date | null;
  },
) {
  const { subjectType, subjectId, taskType } = params;

  const existing = await activeTask(db, subjectType, subjectId);
  if (existing) {
    throw new WorkflowError(
      "active_task_exists",
      "คำขอนี้ยังมีขั้นตอนที่ค้างอยู่ ต้องปิดก่อนจึงจะเปิดขั้นตอนใหม่ได้",
      409,
    );
  }

  const [totalTasks, sameTypeTasks] = await Promise.all([
    db.reviewTask.count({ where: { subjectType, subjectId } }),
    db.reviewTask.count({ where: { subjectType, subjectId, taskType } }),
  ]);

  try {
    return await db.reviewTask.create({
      data: {
        subjectType,
        subjectId,
        taskType,
        sequenceNumber: totalTasks + 1,
        roundNumber: sameTypeTasks + 1,
        assignedUserId: params.assignedUserId ?? null,
        assignedRole: params.assignedRole,
        assignedById: params.assignedById ?? null,
        assignmentSource: params.assignmentSource ?? AssignmentSource.SYSTEM,
        status: ReviewTaskStatus.PENDING,
        dueAt: params.dueAt ?? null,
        createdBy: params.actorId,
        updatedBy: params.actorId,
      },
    });
  } catch (err) {
    /**
     * ตะแกรงจริงของ "หนึ่งคำขอ หนึ่ง active task" คือ uq_active_review_task_per_subject
     *
     * การอ่าน activeTask() ข้างบนเป็น read-then-write จึงกันสองคนที่มาพร้อมกันไม่ได้ —
     * ทั้งคู่เห็นว่าว่างแล้วทั้งคู่ก็ insert ตัว index เป็นคนปฏิเสธรายที่สอง ถ้าไม่ดักตรงนี้
     * ผู้ใช้จะได้ "ข้อมูลนี้มีอยู่ในระบบแล้ว" จาก middleware ซึ่งไม่ได้บอกว่าเกิดอะไรขึ้น
     */
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002" &&
      JSON.stringify(err.meta?.target ?? "").includes("uq_active_review_task_per_subject")
    ) {
      throw new WorkflowError("active_task_exists", TASK_TAKEN_MESSAGE, 409);
    }
    throw err;
  }
}

/**
 * ผู้รับผิดชอบเริ่มลงมือ — PENDING → IN_PROGRESS
 *
 * นี่คือจุดที่ทำให้ request.status เปลี่ยนจาก SUBMITTED เป็น UNDER_REVIEW
 * เรียกซ้ำได้ ไม่เปลี่ยน started_at ที่บันทึกไว้แล้ว
 */
export async function startTask(db: Db, taskId: string, actorId: string): Promise<void> {
  /**
   * เงื่อนไข "ยังเป็น PENDING อยู่" อยู่ใน WHERE ไม่ใช่ใน if ข้างนอก
   *
   * ตรงนี้เรียกซ้ำได้อยู่แล้วจึงไม่ใช่จุดที่อันตราย แต่เขียนให้ตรงแบบกับ completeTask() ไว้
   * จะได้ไม่มีใครหยิบรูปแบบอ่านก่อนเขียนทีหลังไปใช้ต่อโดยคิดว่ามันกันการชนกันได้
   */
  await db.reviewTask.updateMany({
    where: { id: taskId, status: ReviewTaskStatus.PENDING },
    data: { status: ReviewTaskStatus.IN_PROGRESS, startedAt: new Date(), updatedBy: actorId },
  });
}

/**
 * ปิด task พร้อมบันทึกผล — ตรวจว่า result ที่ส่งมาใช้ได้กับ task_type นี้จริง
 * และบังคับ comment เมื่อ RETURNED/REJECTED ตามที่ sheet เขียนไว้
 * (CHECK constraint ในฐานข้อมูลบังคับซ้ำอีกชั้น)
 */
export async function completeTask(
  db: Db,
  params: {
    taskId: string;
    result: ReviewResult;
    comment?: string | null;
    commentVisibility?: CommentVisibility | null;
    resultDetail?: Prisma.InputJsonValue;
    actorId: string;
  },
): Promise<void> {
  const task = await db.reviewTask.findUniqueOrThrow({ where: { id: params.taskId } });

  if (!ACTIVE_STATUSES.includes(task.status)) {
    throw new WorkflowError("task_closed", TASK_TAKEN_MESSAGE, 409);
  }

  if (!ALLOWED_RESULTS[task.taskType].includes(params.result)) {
    throw new WorkflowError(
      "invalid_result",
      `ผลการพิจารณา "${params.result}" ใช้กับขั้นตอน "${task.taskType}" ไม่ได้`,
    );
  }

  const comment = params.comment?.trim() || null;
  if (RESULTS_REQUIRING_COMMENT.includes(params.result) && !comment) {
    throw new WorkflowError("comment_required", "กรุณาระบุเหตุผลเมื่อส่งกลับหรือไม่อนุมัติ");
  }

  /**
   * ปิดด่านด้วย updateMany ที่มีเงื่อนไขสถานะอยู่ใน WHERE ไม่ใช่ update ธรรมดา
   *
   * การอ่านข้างบนบอกได้แค่ว่า "ตอนที่อ่าน ยังเปิดอยู่" — ภายใต้ READ COMMITTED สองคนที่กด
   * พร้อมกันผ่านด่านนั้นได้ทั้งคู่ แล้วคนที่สองก็รอ row lock และเขียนทับผลของคนแรก
   * ที่ด่านกลางทาง uq_active_review_task_per_subject ยังช่วยไว้ตอนเปิดด่านถัดไป แต่ที่
   * **ด่านปลายทาง (อนุมัติขั้นสุดท้าย / ไม่อนุมัติ) ไม่มีการเปิด task ใหม่ จึงไม่มีอะไรกันเลย**
   * ผลคือลายมือชื่อสองแถว เอกสารเรนเดอร์สองรอบ และอีเมลออกสองชุด
   *
   * UPDATE ประเมิน WHERE ใหม่หลังปล่อย row lock คนที่สองจึงตรง 0 แถวเสมอ
   */
  const { count } = await db.reviewTask.updateMany({
    where: { id: params.taskId, status: { in: ACTIVE_STATUSES } },
    data: {
      status: ReviewTaskStatus.COMPLETED,
      result: params.result,
      resultComment: comment,
      commentVisibility: params.commentVisibility ?? null,
      ...(params.resultDetail !== undefined ? { resultDetailJson: params.resultDetail } : {}),
      startedAt: task.startedAt ?? new Date(),
      completedAt: new Date(),
      // คนที่กดจริง ๆ ไม่ใช่คนที่ถูกมอบหมาย — ไทม์ไลน์อ่านคอลัมน์นี้
      completedBy: params.actorId,
      updatedBy: params.actorId,
    },
  });
  if (count === 0) {
    throw new WorkflowError("task_closed", TASK_TAKEN_MESSAGE, 409);
  }
}

/** ยกเลิก task ที่ยังค้าง — ไม่เกิดผล review หรือ approval */
export async function cancelActiveTask(
  db: Db,
  params: {
    subjectType: SubjectType;
    subjectId: string;
    actorId: string;
    reason: string;
  },
) {
  const task = await activeTask(db, params.subjectType, params.subjectId);
  if (!task) return null;

  const { count } = await db.reviewTask.updateMany({
    where: { id: task.id, status: { in: ACTIVE_STATUSES } },
    data: {
      status: ReviewTaskStatus.CANCELLED,
      cancelledAt: new Date(),
      cancelledBy: params.actorId,
      cancellationReason: params.reason,
      updatedBy: params.actorId,
    },
  });
  // ถูกปิดไปก่อนแล้วโดยคนอื่น — ไม่ใช่ข้อผิดพลาด ผู้เรียกอยากได้แค่ "ไม่มีด่านค้างแล้ว"
  return count === 0 ? null : task;
}

/**
 * เปลี่ยนผู้รับมอบหมาย — task เดิมปิดเป็น REASSIGNED และ task ใหม่ชี้กลับด้วย
 * reassigned_from_action_id ตามที่ sheet กำหนด
 *
 * ต้องปิดของเดิมก่อนสร้างของใหม่ ไม่งั้นชน uq_active_review_task_per_subject
 */
export async function reassignTask(
  db: Db,
  params: {
    taskId: string;
    assignedUserId: string;
    assignedRole: RoleCode;
    actorId: string;
    reason?: string;
  },
) {
  const previous = await db.reviewTask.findUniqueOrThrow({ where: { id: params.taskId } });
  if (!ACTIVE_STATUSES.includes(previous.status)) {
    throw new WorkflowError("task_closed", TASK_TAKEN_MESSAGE, 409);
  }

  const { count } = await db.reviewTask.updateMany({
    where: { id: previous.id, status: { in: ACTIVE_STATUSES } },
    data: {
      status: ReviewTaskStatus.REASSIGNED,
      cancellationReason: params.reason ?? "เปลี่ยนผู้รับมอบหมาย",
      updatedBy: params.actorId,
    },
  });
  if (count === 0) {
    throw new WorkflowError("task_closed", TASK_TAKEN_MESSAGE, 409);
  }

  const totalTasks = await db.reviewTask.count({
    where: { subjectType: previous.subjectType, subjectId: previous.subjectId },
  });

  return db.reviewTask.create({
    data: {
      subjectType: previous.subjectType,
      subjectId: previous.subjectId,
      taskType: previous.taskType,
      sequenceNumber: totalTasks + 1,
      // การ reassign ไม่นับเป็นรอบใหม่ — ยังเป็นการพิจารณาครั้งเดิม แค่เปลี่ยนคน
      roundNumber: previous.roundNumber,
      assignedUserId: params.assignedUserId,
      assignedRole: params.assignedRole,
      assignedById: params.actorId,
      assignmentSource: AssignmentSource.MANUAL,
      status: ReviewTaskStatus.PENDING,
      reassignedFromTaskId: previous.id,
      dueAt: previous.dueAt,
      createdBy: params.actorId,
      updatedBy: params.actorId,
    },
  });
}

/**
 * ความเห็นของผู้เชี่ยวชาญ — แถวที่เกิดมาแล้วปิดทันที ไม่เคยเป็น active task
 *
 * ตั้งแต่ 2026-08-30 การมอบหมายผู้เชี่ยวชาญด้านข้อมูลไม่ย้ายด่านอีกต่อไป: คำขอค้างอยู่ที่
 * ด่านของเจ้าหน้าที่ BDI ตลอด และตัวการมอบหมายเป็นคอลัมน์บนคำขอ แต่ไทม์ไลน์บนหน้าจอ
 * เรนเดอร์จาก review_task ล้วน ๆ ความเห็นที่เขาบันทึกจึงยังต้องเป็นแถวหนึ่งแถว
 * ปิดด้วย result = CONFIRMED ("ยืนยันการตรวจสอบ โดยไม่ถือเป็น Approval" ตาม sheet)
 *
 * **ไม่เรียก openTask() โดยตั้งใจ** — ฟังก์ชันนั้นปฏิเสธเมื่อมี active task ค้างอยู่ ซึ่งที่นี่
 * มีเสมอคือด่านของเจ้าหน้าที่ ส่วนแถวนี้ไม่เคย active จึงไม่ชนกับ
 * uq_active_review_task_per_subject
 */
export async function recordAdvisoryNote(
  db: Db,
  params: {
    subjectType: SubjectType;
    subjectId: string;
    taskType: ReviewTaskType;
    assignedUserId: string;
    assignedRole: RoleCode;
    comment: string;
    actorId: string;
    visibility?: CommentVisibility;
  },
) {
  const { subjectType, subjectId, taskType } = params;
  const [totalTasks, sameTypeTasks] = await Promise.all([
    db.reviewTask.count({ where: { subjectType, subjectId } }),
    db.reviewTask.count({ where: { subjectType, subjectId, taskType } }),
  ]);
  const now = new Date();

  return db.reviewTask.create({
    data: {
      subjectType,
      subjectId,
      taskType,
      sequenceNumber: totalTasks + 1,
      roundNumber: sameTypeTasks + 1,
      assignedUserId: params.assignedUserId,
      assignedRole: params.assignedRole,
      assignmentSource: AssignmentSource.MANUAL,
      status: ReviewTaskStatus.COMPLETED,
      result: ReviewResult.CONFIRMED,
      completedBy: params.actorId,
      resultComment: params.comment,
      commentVisibility: params.visibility ?? CommentVisibility.BDI_INTERNAL,
      assignedAt: now,
      startedAt: now,
      completedAt: now,
      createdBy: params.actorId,
      updatedBy: params.actorId,
    },
  });
}

/**
 * สถานะคำขอที่ derive จาก review_task — ภาพ "ความสัมพันธ์กับ review_task"
 * ใน sheet `org_registration_request`
 *
 *   DRAFT        ยังไม่มี Active Task
 *   SUBMITTED    Active Task เป็น PENDING
 *   UNDER_REVIEW Active Task เป็น IN_PROGRESS
 *   RETURNED     Task ล่าสุดเป็น COMPLETED และ result = RETURNED
 *   APPROVED     Final Approval Task เป็น COMPLETED และ result = APPROVED
 *   REJECTED     Task ล่าสุดเป็น COMPLETED และ result = REJECTED
 *   CANCELLED    ไม่มี Active Task หรือ Active Task ถูก CANCELLED
 *
 * ใช้ตรวจความสอดคล้องหลังทุก transition — คอลัมน์ status ยังเก็บค่าจริงไว้เพื่อ query
 * แต่ต้องตรงกับสิ่งที่ฟังก์ชันนี้คำนวณได้เสมอ
 */
export function requestStatusFor(params: {
  hasSubmitted: boolean;
  cancelled: boolean;
  active: { status: ReviewTaskStatus } | null;
  latestCompleted: { taskType: ReviewTaskType; result: ReviewResult | null } | null;
}): RequestStatus {
  if (params.cancelled) return RequestStatus.CANCELLED;
  if (!params.hasSubmitted) return RequestStatus.DRAFT;

  if (params.active) {
    return params.active.status === ReviewTaskStatus.IN_PROGRESS
      ? RequestStatus.UNDER_REVIEW
      : RequestStatus.SUBMITTED;
  }

  const latest = params.latestCompleted;
  if (!latest) return RequestStatus.DRAFT;

  if (latest.result === ReviewResult.REJECTED) return RequestStatus.REJECTED;
  if (latest.result === ReviewResult.RETURNED) return RequestStatus.RETURNED;
  if (
    latest.result === ReviewResult.APPROVED &&
    latest.taskType === ReviewTaskType.BDI_FINAL_APPROVAL
  ) {
    return RequestStatus.APPROVED;
  }

  // ผ่านด่านหนึ่งแล้วแต่ยังไม่ได้เปิดด่านถัดไป — ถือว่ายังอยู่ระหว่างพิจารณา
  return RequestStatus.UNDER_REVIEW;
}

/** อ่านสถานะที่ควรเป็นจากฐานข้อมูลจริง */
export async function deriveRequestStatus(
  db: Db,
  params: {
    subjectType: SubjectType;
    subjectId: string;
    hasSubmitted: boolean;
    cancelled: boolean;
  },
): Promise<RequestStatus> {
  const [active, latestCompleted] = await Promise.all([
    db.reviewTask.findFirst({
      where: {
        subjectType: params.subjectType,
        subjectId: params.subjectId,
        status: { in: ACTIVE_STATUSES },
      },
      select: { status: true },
    }),
    db.reviewTask.findFirst({
      where: {
        subjectType: params.subjectType,
        subjectId: params.subjectId,
        status: ReviewTaskStatus.COMPLETED,
      },
      orderBy: { sequenceNumber: "desc" },
      select: { taskType: true, result: true },
    }),
  ]);

  return requestStatusFor({ ...params, active, latestCompleted });
}

/** ผู้ใช้คนนี้เป็นเจ้าของ task ที่ค้างอยู่หรือไม่ */
/** ความเห็นที่ผู้ใช้ฝั่งหน่วยงานเห็นได้ — sheet `review_task` คอลัมน์ comment_visibility */
export function isCommentVisibleToOrganization(task: {
  commentVisibility: CommentVisibility | null;
}): boolean {
  return (
    task.commentVisibility === CommentVisibility.ORGANIZATION ||
    task.commentVisibility === CommentVisibility.ALL
  );
}
