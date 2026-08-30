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
      assignedUser: {
        select: {
          id: true,
          displayName: true,
          email: true,
          firstnameTh: true,
          lastnameTh: true,
        },
      },
    },
  });
}

export async function taskHistory(db: Db, subjectType: SubjectType, subjectId: string) {
  return db.reviewTask.findMany({
    where: { subjectType, subjectId },
    orderBy: { sequenceNumber: "asc" },
    include: {
      assignedUser: {
        select: {
          id: true,
          displayName: true,
          email: true,
          firstnameTh: true,
          lastnameTh: true,
        },
      },
    },
  });
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
    assignedUserId: string;
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

  return db.reviewTask.create({
    data: {
      subjectType,
      subjectId,
      taskType,
      sequenceNumber: totalTasks + 1,
      roundNumber: sameTypeTasks + 1,
      assignedUserId: params.assignedUserId,
      assignedRole: params.assignedRole,
      assignedById: params.assignedById ?? null,
      assignmentSource: params.assignmentSource ?? AssignmentSource.SYSTEM,
      status: ReviewTaskStatus.PENDING,
      dueAt: params.dueAt ?? null,
      createdBy: params.actorId,
      updatedBy: params.actorId,
    },
  });
}

/**
 * ผู้รับผิดชอบเริ่มลงมือ — PENDING → IN_PROGRESS
 *
 * นี่คือจุดที่ทำให้ request.status เปลี่ยนจาก SUBMITTED เป็น UNDER_REVIEW
 * เรียกซ้ำได้ ไม่เปลี่ยน started_at ที่บันทึกไว้แล้ว
 */
export async function startTask(db: Db, taskId: string, actorId: string) {
  const task = await db.reviewTask.findUniqueOrThrow({ where: { id: taskId } });
  if (task.status !== ReviewTaskStatus.PENDING) return task;

  return db.reviewTask.update({
    where: { id: taskId },
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
) {
  const task = await db.reviewTask.findUniqueOrThrow({ where: { id: params.taskId } });

  if (!ACTIVE_STATUSES.includes(task.status)) {
    throw new WorkflowError("task_closed", "ขั้นตอนนี้ถูกปิดไปแล้ว", 409);
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

  return db.reviewTask.update({
    where: { id: params.taskId },
    data: {
      status: ReviewTaskStatus.COMPLETED,
      result: params.result,
      resultComment: comment,
      commentVisibility: params.commentVisibility ?? null,
      ...(params.resultDetail !== undefined ? { resultDetailJson: params.resultDetail } : {}),
      startedAt: task.startedAt ?? new Date(),
      completedAt: new Date(),
      updatedBy: params.actorId,
    },
  });
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

  return db.reviewTask.update({
    where: { id: task.id },
    data: {
      status: ReviewTaskStatus.CANCELLED,
      cancelledAt: new Date(),
      cancelledBy: params.actorId,
      cancellationReason: params.reason,
      updatedBy: params.actorId,
    },
  });
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
    throw new WorkflowError("task_closed", "ขั้นตอนนี้ถูกปิดไปแล้ว", 409);
  }

  await db.reviewTask.update({
    where: { id: previous.id },
    data: {
      status: ReviewTaskStatus.REASSIGNED,
      cancellationReason: params.reason ?? "เปลี่ยนผู้รับมอบหมาย",
      updatedBy: params.actorId,
    },
  });

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
export function isAssignee(task: { assignedUserId: string } | null, userId: string): boolean {
  return task?.assignedUserId === userId;
}

/** ความเห็นที่ผู้ใช้ฝั่งหน่วยงานเห็นได้ — sheet `review_task` คอลัมน์ comment_visibility */
export function isCommentVisibleToOrganization(task: {
  commentVisibility: CommentVisibility | null;
}): boolean {
  return (
    task.commentVisibility === CommentVisibility.ORGANIZATION ||
    task.commentVisibility === CommentVisibility.ALL
  );
}
