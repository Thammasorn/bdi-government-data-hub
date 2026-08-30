/**
 * เส้นทางการอนุมัติทั้งเส้น — "มีกี่ขั้น ตอนนี้อยู่ขั้นไหน ขั้นต่อไปคือใคร"
 *
 * `review_task` ตอบได้แค่ว่าเกิดอะไรไปแล้วและค้างอยู่ที่ด่านไหน ส่วนลำดับด่านทั้งเส้นทาง
 * เดิมไม่ได้มีอยู่เป็นข้อมูลที่ไหนเลย มีแต่ control flow ใน `POST /:id/review` ของทั้งสอง
 * route ไฟล์นี้คือที่เดียวที่ประกาศลำดับนั้นออกมาเป็นข้อมูล — **แก้ที่นี่ต้องแก้คู่กับ
 * `nextStageAfter()` ใน routes/dataset-requests.ts และ if-chain ใน routes/organizations.ts**
 * ไม่งั้นหน้าจอจะสัญญาเส้นทางที่ backend ไม่ได้เดิน
 *
 * กับดักที่ไฟล์นี้มีอยู่เพื่อกันโดยเฉพาะ: `BDI_OFFICER_REVIEW` เป็นสองด่านคนละด่านใน
 * Journey C ("ตรวจเบื้องต้น" กับ "ตรวจซ้ำหลังหน่วยงานลงนาม") อาเรย์ลำดับ task_type
 * แบบตรงไปตรงมาจึงใช้ไม่ได้ ต้องแยกด้วยว่ามี ORGANIZATION_APPROVAL ที่ APPROVED แล้ว
 * หรือยัง — **ไม่ใช่ด้วย round_number** เพราะรอบเพิ่มทุกครั้งที่ส่งกลับให้แก้ไขและทุกครั้ง
 * ที่มอบหมาย/ถอนผู้เชี่ยวชาญ (กติกาเดียวกับ nextStageAfter() ทุกประการ)
 *
 * ฟังก์ชันนี้ไม่ query เอง — รับแถวที่ route ดึงมาอยู่แล้วจาก taskHistory() และ activeTask()
 * ใน lib/workflow.ts เพื่อไม่ให้หน้าจอหนึ่งหน้ายิงคำถามเดิมซ้ำ
 */
import {
  RequestStatus,
  ReviewResult,
  ReviewTaskStatus,
  ReviewTaskType,
  SubjectType,
} from "@prisma/client";

import { ROLE_LABELS } from "./roles.js";
import { ROLE_CODES, type RoleCode } from "./system.js";
import { ALLOWED_RESULTS } from "./workflow.js";

/** แถวที่ฟังก์ชันนี้อ่าน — เป็น subset ของ review_task ที่ taskHistory()/activeTask() คืนมา */
export interface JourneyTaskRow {
  id: string;
  taskType: ReviewTaskType;
  sequenceNumber: number;
  roundNumber: number;
  status: ReviewTaskStatus;
  result: ReviewResult | null;
  completedAt: Date | null;
}

export type StepState = "DONE" | "CURRENT" | "UPCOMING" | "REJECTED";

/**
 * ช่วงที่คำขออยู่ ณ ตอนนี้ — หยาบกว่า step เพราะบางช่วงไม่มี review_task ค้างอยู่เลย
 *
 * WAITING_REVISION คือช่วงที่ถูกส่งกลับให้แก้ไข ซึ่ง **ไม่มี task ไหน active** —
 * `ORGANIZATION_REVISION` มีอยู่ใน enum แต่ไม่เคยถูก openTask จริงในโค้ดชุดนี้
 */
export type JourneyPhase =
  | "DRAFT"
  | "IN_PROGRESS"
  | "WAITING_REVISION"
  | "APPROVED"
  | "REJECTED"
  | "CANCELLED";

export interface JourneyStep {
  /** id ของช่องในเส้นทาง ไม่ใช่ id ของ task — คงที่ตลอดอายุคำขอ */
  key: StepKey;
  taskType: ReviewTaskType;
  /** เลขที่แสดงบนหน้าจอ; null สำหรับขั้นไม่บังคับซึ่งไม่ถูกนับ */
  order: number | null;
  optional: boolean;
  /** ชื่อกลาง ๆ ใช้ได้ทั้งกับขั้นที่ผ่านไปแล้วและขั้นที่ยังไม่ถึง */
  label: string;
  /** สำนวน "รอ…" ใช้ตอนขั้นนี้เป็นขั้นปัจจุบัน */
  waitingLabel: string;
  /** บทบาทที่รับผิดชอบ — ไม่เปิดเผยชื่อผู้ตรวจ */
  roleCode: RoleCode;
  roleLabel: string;
  state: StepState;
  result: ReviewResult | null;
  completedAt: Date | null;
  roundNumber: number | null;
}

export interface JourneyProgress {
  steps: JourneyStep[];
  /** จำนวนขั้นบังคับ — Journey B = 3, Journey C = 4 (ขั้นผู้เชี่ยวชาญไม่ถูกนับ) */
  totalSteps: number;
  currentOrder: number | null;
  currentStep: JourneyStep | null;
  nextStep: JourneyStep | null;
  phase: JourneyPhase;
}

export type StepKey =
  | "OFFICER_REVIEW"
  | "OFFICER_INITIAL"
  | "SPECIALIST_REVIEW"
  | "ORGANIZATION_APPROVAL"
  | "OFFICER_RECHECK"
  | "FINAL_APPROVAL";

export interface StepPlan {
  key: StepKey;
  taskType: ReviewTaskType;
  optional: boolean;
  label: string;
  /**
   * คำบนโหนดของแผนภาพเส้นทาง — สั้นพอจะอยู่ในกล่องเล็ก ๆ ได้
   *
   * `label` กับ `waitingLabel` เขียนไว้ให้อ่านเป็นประโยคในไทม์ไลน์และในอีเมล ยาวเกินกล่อง
   * แต่ต้องมาจากตารางเดียวกัน ไม่ใช่ตารางคำใบที่สองฝั่งหน้าเว็บ — โหนดกับ badge เรียกสิ่ง
   * เดียวกันคนละชื่อคือบั๊กที่เพิ่งกำจัดไปรอบก่อน
   */
  shortLabel: string;
  waitingLabel: string;
  roleCode: RoleCode;
}

/**
 * Journey B — `docs/01-user-journey.md` §3
 * ตรงกับ organizations.ts: submit → BDI_OFFICER_REVIEW → ORGANIZATION_APPROVAL → BDI_FINAL_APPROVAL
 */
const ORGANIZATION_PLAN: StepPlan[] = [
  {
    key: "OFFICER_REVIEW",
    taskType: ReviewTaskType.BDI_OFFICER_REVIEW,
    optional: false,
    label: "เจ้าหน้าที่ BDI ตรวจสอบเอกสาร",
    shortLabel: "รอ BDI ตรวจสอบ",
    waitingLabel: "รอเจ้าหน้าที่ BDI ตรวจสอบเอกสาร",
    roleCode: ROLE_CODES.BDI_OFFICER,
  },
  {
    key: "ORGANIZATION_APPROVAL",
    taskType: ReviewTaskType.ORGANIZATION_APPROVAL,
    optional: false,
    label: "ผู้มีอำนาจของหน่วยงานลงนามเห็นชอบ",
    shortLabel: "รอหน่วยงานลงนาม",
    waitingLabel: "รอผู้มีอำนาจของหน่วยงานลงนามเห็นชอบ",
    roleCode: ROLE_CODES.ORGANIZATION_APPROVER,
  },
  {
    key: "FINAL_APPROVAL",
    taskType: ReviewTaskType.BDI_FINAL_APPROVAL,
    optional: false,
    label: "BDI อนุมัติขั้นสุดท้าย",
    shortLabel: "รอ BDI อนุมัติ",
    waitingLabel: "รอ BDI อนุมัติขั้นสุดท้าย",
    roleCode: ROLE_CODES.BDI_FINAL_APPROVER,
  },
];

/**
 * Journey C — `docs/01-user-journey.md` §4
 * ตรงกับ nextStageAfter() ใน dataset-requests.ts
 *
 * สเปกเรียกเส้นทางนี้ว่า "สามด่าน + Final Check คั่นระหว่างด่าน 2 กับ 3" หน้าจอนับ 1–4
 * เรียงตรง ๆ จึงตรงกับสเปกแต่เลขไม่ตรงกัน — ดู §4 ของเอกสารที่แก้ไว้แล้ว
 */
const DATASET_PLAN: StepPlan[] = [
  {
    key: "OFFICER_INITIAL",
    taskType: ReviewTaskType.BDI_OFFICER_REVIEW,
    optional: false,
    label: "เจ้าหน้าที่ BDI ตรวจสอบเบื้องต้น",
    shortLabel: "รอ BDI ตรวจเบื้องต้น",
    waitingLabel: "รอเจ้าหน้าที่ BDI ตรวจสอบเบื้องต้น",
    roleCode: ROLE_CODES.BDI_OFFICER,
  },
  {
    key: "SPECIALIST_REVIEW",
    taskType: ReviewTaskType.DATASET_SPECIALIST_REVIEW,
    optional: true,
    label: "ผู้เชี่ยวชาญด้านข้อมูลพิจารณา",
    shortLabel: "รอผู้เชี่ยวชาญ",
    waitingLabel: "รอผู้เชี่ยวชาญด้านข้อมูลพิจารณา",
    roleCode: ROLE_CODES.BDI_DATASET_SPECIALIST,
  },
  {
    key: "ORGANIZATION_APPROVAL",
    taskType: ReviewTaskType.ORGANIZATION_APPROVAL,
    optional: false,
    label: "ผู้มีอำนาจของหน่วยงานลงนามเห็นชอบ",
    shortLabel: "รอหน่วยงานลงนาม",
    waitingLabel: "รอผู้มีอำนาจของหน่วยงานลงนามเห็นชอบ",
    roleCode: ROLE_CODES.ORGANIZATION_APPROVER,
  },
  {
    key: "OFFICER_RECHECK",
    taskType: ReviewTaskType.BDI_OFFICER_REVIEW,
    optional: false,
    label: "เจ้าหน้าที่ BDI ตรวจซ้ำหลังลงนาม",
    shortLabel: "รอ BDI ตรวจซ้ำ",
    waitingLabel: "รอเจ้าหน้าที่ BDI ตรวจซ้ำหลังลงนาม",
    roleCode: ROLE_CODES.BDI_OFFICER,
  },
  {
    key: "FINAL_APPROVAL",
    taskType: ReviewTaskType.BDI_FINAL_APPROVAL,
    optional: false,
    label: "BDI อนุมัติขั้นสุดท้าย",
    shortLabel: "รอ BDI อนุมัติ",
    waitingLabel: "รอ BDI อนุมัติขั้นสุดท้าย",
    roleCode: ROLE_CODES.BDI_FINAL_APPROVER,
  },
];

export function planFor(subjectType: SubjectType): StepPlan[] {
  return subjectType === SubjectType.ORGANIZATION_REGISTRATION_REQUEST
    ? ORGANIZATION_PLAN
    : DATASET_PLAN;
}

/**
 * เงื่อนไขที่ชี้ขาดว่า `BDI_OFFICER_REVIEW` ที่ค้างอยู่คือ **ด่านตรวจเบื้องต้น** หรือ
 * **ด่านตรวจซ้ำ** — คำขอที่ผู้มีอำนาจของหน่วยงานลงนามผ่านไปแล้วคือด่านตรวจซ้ำ
 *
 * เป็นเงื่อนไขเดียวกับที่ slotOf() ใช้ (`orgApprovedBefore === 0`) เขียนไว้ตรงนี้ในรูปที่
 * ยกไปเป็น `where` ของ Prisma ได้ตรง ๆ เพื่อให้หน้ารายการนับสองช่องแยกกันได้โดยไม่ต้อง
 * เดินทุกแถวของทุกคำขอ
 *
 * **ห้ามใช้ `round_number` แทน** — round เพิ่มทุกครั้งที่คำขอถูกส่งกลับด้วย ใบที่ถูกส่งกลับ
 * ตั้งแต่ยังไม่ได้ลงนามจึงมี round 2 ทั้งที่ยังอยู่ด่านตรวจเบื้องต้น
 */
export const ORGANIZATION_SIGNED_OFF = {
  taskType: ReviewTaskType.ORGANIZATION_APPROVAL,
  result: ReviewResult.APPROVED,
} as const;

/** เส้นทางนี้แยกด่านเจ้าหน้าที่ BDI เป็นสองรอบไหม — มีเฉพาะเส้นทางชุดข้อมูล */
export const hasRecheckStep = (subjectType: SubjectType): boolean =>
  planFor(subjectType).some((s) => s.key === "OFFICER_RECHECK");

/**
 * ผลที่ถือว่า "ผ่านด่านนี้ไปแล้ว"
 *
 * PASSED สำหรับด่านตรวจ, APPROVED สำหรับด่านอนุมัติ และ **CONFIRMED ก็นับด้วย** —
 * `recordComment()` ปิด task ของผู้เชี่ยวชาญด้วย CONFIRMED แล้วเปิดด่านถัดไปทันที
 * และ ALLOWED_RESULTS ก็ยอมให้ BDI_OFFICER_REVIEW จบด้วย CONFIRMED ได้เช่นกัน
 * ตกข้อนี้ไปแล้วด่านที่ทำเสร็จจริงจะขึ้นว่า "ยังไม่ถึง" ทั้งที่คำขอเดินผ่านไปแล้ว
 * COMPLETED เป็นของ ORGANIZATION_REVISION ซึ่งยังไม่มีโค้ดเส้นไหนเปิด — ใส่ไว้ให้ครบตาราง
 */
const PASSING_RESULTS: ReviewResult[] = [
  ReviewResult.PASSED,
  ReviewResult.APPROVED,
  ReviewResult.CONFIRMED,
  ReviewResult.COMPLETED,
];

const ACTIVE_TASK_STATUSES: ReviewTaskStatus[] = [
  ReviewTaskStatus.PENDING,
  ReviewTaskStatus.IN_PROGRESS,
];

/**
 * task หนึ่งแถวตกช่องไหนในเส้นทาง
 *
 * `orgApprovedBefore` คือจำนวน ORGANIZATION_APPROVAL ที่ APPROVED **ก่อนหน้า** แถวนี้
 * ซึ่งเป็นตัวเดียวกับที่ nextStageAfter() นับ ณ ตอนตัดสินว่าจะเปิดด่านอะไรต่อ
 */
export function slotOf(
  taskType: ReviewTaskType,
  orgApprovedBefore: number,
  plan: StepPlan[],
): StepKey | null {
  if (taskType === ReviewTaskType.ORGANIZATION_REVISION) return null;

  // เส้นทางที่มีด่านตรวจซ้ำเท่านั้นที่ต้องแยกสองความหมายของ BDI_OFFICER_REVIEW
  if (
    taskType === ReviewTaskType.BDI_OFFICER_REVIEW &&
    plan.some((s) => s.key === "OFFICER_RECHECK")
  ) {
    return orgApprovedBefore === 0 ? "OFFICER_INITIAL" : "OFFICER_RECHECK";
  }

  return plan.find((s) => s.taskType === taskType)?.key ?? null;
}

/**
 * แถวล่าสุดของแต่ละช่อง พร้อมจำนวน ORGANIZATION_APPROVAL ที่ผ่านแล้วทั้งหมด
 *
 * เดินตาม sequenceNumber เพราะ orgApproved ต้องนับตามลำดับเวลาจริง ไม่ใช่ตามลำดับที่ query คืนมา
 * แถว CANCELLED / REASSIGNED ยังเดินผ่าน (เพื่อไม่ให้นับ orgApproved ผิด) แต่ไม่ถูกเก็บเป็น
 * แถวล่าสุดของช่อง เพราะไม่ได้ให้ผลอะไร — การถอนมอบหมายผู้เชี่ยวชาญจึงไม่ทำให้ขั้นนั้นดูเหมือนจบ
 */
function latestBySlot(tasks: JourneyTaskRow[], plan: StepPlan[]) {
  const latest = new Map<StepKey, JourneyTaskRow>();
  const slotOfTaskId = new Map<string, StepKey>();
  let orgApproved = 0;

  for (const task of [...tasks].sort((a, b) => a.sequenceNumber - b.sequenceNumber)) {
    const slot = slotOf(task.taskType, orgApproved, plan);
    if (slot) {
      slotOfTaskId.set(task.id, slot);
      if (
        task.status === ReviewTaskStatus.COMPLETED ||
        ACTIVE_TASK_STATUSES.includes(task.status)
      ) {
        latest.set(slot, task);
      }
    }

    if (
      task.taskType === ReviewTaskType.ORGANIZATION_APPROVAL &&
      task.result === ReviewResult.APPROVED
    ) {
      orgApproved += 1;
    }
  }

  return { latest, slotOfTaskId, orgApproved };
}

function phaseFor(status: RequestStatus): JourneyPhase {
  switch (status) {
    case RequestStatus.DRAFT:
      return "DRAFT";
    case RequestStatus.RETURNED:
      return "WAITING_REVISION";
    case RequestStatus.APPROVED:
      return "APPROVED";
    case RequestStatus.REJECTED:
      return "REJECTED";
    case RequestStatus.CANCELLED:
      return "CANCELLED";
    default:
      // SUBMITTED / UNDER_REVIEW
      return "IN_PROGRESS";
  }
}

/**
 * ประกอบเส้นทางทั้งเส้นพร้อมสถานะของแต่ละขั้น
 *
 * ขั้นผู้เชี่ยวชาญของ Journey C แสดงเสมอแต่ไม่มีเลขกำกับและไม่ถูกนับใน totalSteps —
 * มันเป็นทางแยกที่เจ้าหน้าที่เลือกได้ ไม่ใช่ด่านที่ทุกคำขอต้องผ่าน ถ้านับรวมด้วย
 * "จาก N" จะเปลี่ยนกลางคันตอนมีการมอบหมาย ซึ่งอ่านแล้วเหมือนระบบเปลี่ยนกติกา
 */
export function buildJourneyProgress(params: {
  subjectType: SubjectType;
  status: RequestStatus;
  tasks: JourneyTaskRow[];
  active: JourneyTaskRow | null;
}): JourneyProgress {
  const plan = planFor(params.subjectType);
  const { latest, slotOfTaskId, orgApproved } = latestBySlot(params.tasks, plan);
  const activeSlot = params.active ? (slotOfTaskId.get(params.active.id) ?? null) : null;

  let order = 0;
  const steps: JourneyStep[] = plan.map((step) => {
    const task = latest.get(step.key) ?? null;
    const isCurrent = activeSlot === step.key;

    let state: StepState;
    if (isCurrent) {
      state = "CURRENT";
    } else if (task?.result && PASSING_RESULTS.includes(task.result)) {
      state = "DONE";
    } else if (task?.result === ReviewResult.REJECTED) {
      state = "REJECTED";
    } else {
      state = "UPCOMING";
    }

    return {
      key: step.key,
      taskType: step.taskType,
      order: step.optional ? null : ++order,
      optional: step.optional,
      label: step.label,
      waitingLabel: step.waitingLabel,
      roleCode: step.roleCode,
      roleLabel: ROLE_LABELS[step.roleCode],
      state,
      // ขั้นที่กำลังทำอยู่ยังไม่มีผล — อย่าเอาผลของรอบก่อนหน้ามาแสดงว่าเป็นผลของรอบนี้
      result: isCurrent ? null : (task?.result ?? null),
      completedAt: isCurrent ? null : (task?.completedAt ?? null),
      roundNumber: task?.roundNumber ?? null,
    };
  });

  const currentStep = steps.find((s) => s.state === "CURRENT") ?? null;
  const phase = phaseFor(params.status);
  const byKey = (key: StepKey) => steps.find((s) => s.key === key) ?? null;

  return {
    steps,
    totalSteps: order,
    currentOrder: currentStep?.order ?? null,
    currentStep,
    nextStep: nextStepFor({ steps, currentStep, phase, orgApproved, byKey }),
    phase,
  };
}

/**
 * ขั้นบังคับถัดไปที่คำขอจะไปถึง
 *
 * กำลังเดินอยู่ → ขั้นบังคับถัดจากขั้นปัจจุบัน (ข้ามขั้นผู้เชี่ยวชาญ เพราะเป็นทางแยก
 * ที่เจ้าหน้าที่เลือก ไม่ใช่ปลายทางที่รับประกันได้)
 *
 * ร่างหรือถูกส่งกลับ → ปลายทางคือด่านที่ `POST /:id/submit` จะเปิด ซึ่ง **เปิด
 * `BDI_OFFICER_REVIEW` เสมอ** ไม่ว่าจะถูกส่งกลับจากด่านไหน ช่องของมันจึงถูกเลือกด้วย
 * กติกา orgApproved เดียวกับตอนอ่านประวัติ — คำขอที่หน่วยงานลงนามไปแล้วกลับไปที่
 * "ตรวจซ้ำ" ไม่ใช่ "ตรวจเบื้องต้น" การไล่หา "ขั้นแรกที่ยังไม่ DONE" ตอบผิดตรงจุดนี้
 */
function nextStepFor(params: {
  steps: JourneyStep[];
  currentStep: JourneyStep | null;
  phase: JourneyPhase;
  orgApproved: number;
  byKey: (key: StepKey) => JourneyStep | null;
}): JourneyStep | null {
  if (params.phase === "APPROVED" || params.phase === "REJECTED" || params.phase === "CANCELLED") {
    return null;
  }

  const officerSlot = () => {
    const hasRecheck = params.steps.some((s) => s.key === "OFFICER_RECHECK");
    if (!hasRecheck) return params.byKey("OFFICER_REVIEW");
    return params.orgApproved === 0
      ? params.byKey("OFFICER_INITIAL")
      : params.byKey("OFFICER_RECHECK");
  };

  // ผู้เชี่ยวชาญพิจารณาเสร็จแล้วคืนให้เจ้าหน้าที่ตัดสินใจเสมอ ไม่ได้เดินต่อไปด่านถัดไปเอง
  // — และเจ้าหน้าที่คนนั้นอาจเป็นด่านตรวจซ้ำถ้าถูกมอบหมายหลังหน่วยงานลงนามแล้ว
  if (params.currentStep?.key === "SPECIALIST_REVIEW") return officerSlot();

  if (params.currentStep) {
    const from = params.steps.indexOf(params.currentStep);
    return params.steps.slice(from + 1).find((s) => !s.optional) ?? null;
  }

  return officerSlot();
}

/** ย่อให้พอสำหรับตารางและการ์ด — หน้ารายการไม่ต้องแบกรายการขั้นทั้งชุด */
export interface JourneyProgressSummary {
  totalSteps: number;
  currentOrder: number | null;
  /**
   * ช่องที่คำขอค้างอยู่ — **คีย์เดียวกับโหนดในแผนภาพ** ไม่ใช่ task_type ที่กำกวม
   *
   * badge ของแถวเคยอ่านจาก TASK_TYPE_META ซึ่งไม่รู้จักรอบ ใบที่ค้างด่านตรวจซ้ำจึงขึ้นว่า
   * "รอเจ้าหน้าที่ BDI ตรวจสอบ" เหมือนใบที่ยังอยู่ด่านแรกเป๊ะ พอแผนภาพมีโหนด "รอ BDI
   * ตรวจซ้ำ" แล้วกดเข้าไปเจอ badge คนละคำ ก็คือความไม่ตรงกันแบบเดียวกับที่เพิ่งกำจัดไป
   */
  currentKey: StepKey | null;
  currentLabel: string | null;
  nextLabel: string | null;
  phase: JourneyPhase;
}

export function summariseProgress(progress: JourneyProgress): JourneyProgressSummary {
  return {
    totalSteps: progress.totalSteps,
    currentOrder: progress.currentOrder,
    currentKey: (progress.currentStep?.key as StepKey | undefined) ?? null,
    currentLabel: progress.currentStep?.waitingLabel ?? null,
    nextLabel: progress.nextStep?.label ?? null,
    phase: progress.phase,
  };
}

/**
 * ย่อความคืบหน้าของทั้งหน้ารายการในครั้งเดียว
 *
 * หน้ารายการดึง review_task ของทุกแถวมาด้วย query เดียวอยู่แล้ว (เดิมดึงเฉพาะแถวที่ active
 * เพื่อทำ badge) — ขยายให้ดึงประวัติทั้งหมดแล้วส่งเข้ามาที่นี่ ไม่ต้องยิงต่อแถว
 */
export function summariseMany(params: {
  subjectType: SubjectType;
  requests: { id: string; status: RequestStatus }[];
  tasks: (JourneyTaskRow & { subjectId: string })[];
}): Map<string, JourneyProgressSummary> {
  const bySubject = new Map<string, JourneyTaskRow[]>();
  for (const task of params.tasks) {
    const list = bySubject.get(task.subjectId);
    if (list) list.push(task);
    else bySubject.set(task.subjectId, [task]);
  }

  return new Map(
    params.requests.map((request) => {
      const tasks = bySubject.get(request.id) ?? [];
      const active =
        tasks.find((t) => ACTIVE_TASK_STATUSES.includes(t.status)) ?? null;
      return [
        request.id,
        summariseProgress(
          buildJourneyProgress({
            subjectType: params.subjectType,
            status: request.status,
            tasks,
            active,
          }),
        ),
      ];
    }),
  );
}


// ────────────────────────────────────────────────────── แผนภาพของเส้นทาง

/**
 * โหนดหนึ่งโหนดในแผนภาพ = หนึ่งช่องของเส้นทาง หรือหนึ่งปลายทางที่ไม่มีด่านค้าง
 *
 * `StepKey` ตอบเฉพาะช่องที่มี task ส่วนฉบับร่างกับปลายทางไม่มี task เลย จึงต้องมาจาก
 * `RequestStatus` — ปนกันสองชนิดโดยตั้งใจ เหมือนที่ badge ของแถวก็เลือกระหว่างสองชนิดนี้
 */
export type JourneyNodeKey = StepKey | TerminalKey;

export type TerminalKey = "DRAFT" | "RETURNED" | "APPROVED" | "REJECTED" | "CANCELLED";

/** ช่องของแผนภาพที่โหนดไปอยู่ — หน้าเว็บวาดจากค่านี้อย่างเดียว ไม่รู้จัก journey ไหนเลย */
export type NodeLane = "main" | "branch" | "revision" | "closed";

/** สีของโหนด ส่งเป็นชื่อโทน ไม่ใช่คลาส — Tailwind สแกน static คลาสต้องเป็นสตริงเต็มฝั่งหน้าเว็บ */
export type NodeTone = "neutral" | "review" | "approval" | "success" | "danger";

export interface JourneyNodeShape {
  key: JourneyNodeKey;
  lane: NodeLane;
  /** โหนดที่ทางแยกนี้ห้อยอยู่ — มีเฉพาะ lane "branch" */
  anchor: JourneyNodeKey | null;
  /** เลขขั้นที่ผู้ใช้เห็น — ทางแยกและปลายทางไม่มีเลข */
  order: number | null;
  optional: boolean;
  terminal: boolean;
  label: string;
  short: string;
  waitingLabel: string | null;
  roleCode: RoleCode | null;
  roleLabel: string | null;
  tone: NodeTone;
}

export type EdgeKind = "chain" | "branch" | "return" | "resubmit";

export interface JourneyEdge {
  from: JourneyNodeKey;
  to: JourneyNodeKey;
  kind: EdgeKind;
}

/**
 * ปลายทางที่ไม่มี task — คำต้องตรงกับ badge ที่แถวเดียวกันแสดง
 *
 * **อย่าใช้ `REQUEST_STATUS_LABELS` ใน roles.ts แทน** ตารางนั้นเขียนไว้สำหรับอีเมล
 * (`RETURNED` = "ส่งกลับให้แก้ไข") ส่วน badge บนจอเขียน "รอการแก้ไข" ถ้าหยิบผิดตาราง
 * โหนดกับ badge ของแถวเดียวกันจะเรียกสิ่งเดียวกันคนละชื่อ ซึ่งเป็นบั๊กที่เพิ่งกำจัดไป
 * ตารางนี้ต้องเดินคู่กับ REQUEST_STATUS_META ใน frontend/lib/status.ts
 */
const TERMINAL_NODES: Record<TerminalKey, { label: string; short: string; tone: NodeTone }> = {
  DRAFT: { label: "ฉบับร่าง", short: "ฉบับร่าง", tone: "neutral" },
  RETURNED: { label: "รอการแก้ไข", short: "รอการแก้ไข", tone: "danger" },
  APPROVED: { label: "อนุมัติแล้ว", short: "อนุมัติแล้ว", tone: "success" },
  REJECTED: { label: "ไม่อนุมัติ", short: "ไม่อนุมัติ", tone: "danger" },
  CANCELLED: { label: "ยกเลิกแล้ว", short: "ยกเลิกแล้ว", tone: "neutral" },
};

/** ด่านที่ `POST /:id/submit` เปิดเสมอ — ทั้งสอง route ตรงกัน */
const SUBMIT_OPENS = ReviewTaskType.BDI_OFFICER_REVIEW;

const toneOf = (taskType: ReviewTaskType): NodeTone =>
  taskType === ReviewTaskType.BDI_FINAL_APPROVAL ||
  taskType === ReviewTaskType.ORGANIZATION_APPROVAL
    ? "approval"
    : "review";

/** คีย์ของช่องทั้งหมดในเส้นทางนี้ ตามลำดับที่คำขอเดินผ่าน */
export const journeyNodeKeys = (subjectType: SubjectType): StepKey[] =>
  planFor(subjectType).map((s) => s.key);

/**
 * ช่องที่ task ที่ยัง active หนึ่งแถวตกอยู่
 *
 * `orgApproved` คือจำนวน ORGANIZATION_APPROVAL ที่ APPROVED **ทั้งใบ** ซึ่งสำหรับแถวที่
 * ยัง active เท่ากับ "ก่อนหน้าแถวนี้" เสมอ เพราะ openTask() ให้ sequenceNumber =
 * totalTasks + 1 แถวที่ active จึงมี sequence สูงสุดของใบนั้นตลอด — หน้ารายการจึงถามได้
 * ด้วย boolean ต่อคำขอหนึ่งตัว ไม่ต้องเดินประวัติทั้งใบเหมือน latestBySlot()
 */
export const currentSlotOf = (params: {
  subjectType: SubjectType;
  taskType: ReviewTaskType;
  orgApproved: number;
}): StepKey | null =>
  slotOf(params.taskType, params.orgApproved, planFor(params.subjectType));

/**
 * รูปร่างของเส้นทางทั้งเส้น — โหนดกับเส้นเชื่อม
 *
 * **ทุกเส้นถูก derive ไม่ได้เขียนมือ** โดยเฉพาะเส้น "ส่งกลับให้แก้ไข" ที่อ่านจาก
 * ALLOWED_RESULTS ของแต่ละด่าน แผนภาพจึงเป็นภาพของ state machine จริง ไม่ใช่ภาพของ
 * ความทรงจำว่า state machine เป็นอย่างไร วันที่ด่านไหนเลิกส่งกลับได้ เส้นก็หายเอง
 *
 * ไม่มีเส้นไหนวิ่งเข้า REJECTED / CANCELLED ทั้งที่สี่ด่านปฏิเสธได้ — สี่เส้นตัดกันจะทำ
 * ภาพอ่านไม่ออกเพื่อบอกสิ่งที่ไม่มีใครใช้กรอง สองโหนดนั้นจึงวางแยกไว้ท้ายแถวล่าง
 */
export function journeyGraph(subjectType: SubjectType): {
  nodes: JourneyNodeShape[];
  edges: JourneyEdge[];
} {
  const plan = planFor(subjectType);
  const nodes: JourneyNodeShape[] = [];
  const edges: JourneyEdge[] = [];

  const terminal = (key: TerminalKey, lane: NodeLane, roleCode: RoleCode | null = null) => ({
    key,
    lane,
    anchor: null,
    order: null,
    optional: false,
    terminal: key !== "RETURNED",
    label: TERMINAL_NODES[key].label,
    short: TERMINAL_NODES[key].short,
    waitingLabel: null,
    roleCode,
    roleLabel: roleCode ? ROLE_LABELS[roleCode] : null,
    tone: TERMINAL_NODES[key].tone,
  });

  nodes.push(terminal("DRAFT", "main"));

  let order = 0;
  let previousMandatory: JourneyNodeKey = "DRAFT";
  for (const step of plan) {
    nodes.push({
      key: step.key,
      lane: step.optional ? "branch" : "main",
      anchor: step.optional ? previousMandatory : null,
      order: step.optional ? null : ++order,
      optional: step.optional,
      terminal: false,
      label: step.label,
      short: step.shortLabel,
      waitingLabel: step.waitingLabel,
      roleCode: step.roleCode,
      roleLabel: ROLE_LABELS[step.roleCode],
      tone: toneOf(step.taskType),
    });

    if (step.optional) {
      // ทางแยกออกไปแล้วกลับเข้าด่านเดิมเสมอ — ผู้เชี่ยวชาญให้ความเห็น ไม่ได้ตัดสินใจแทน
      edges.push({ from: previousMandatory, to: step.key, kind: "branch" });
      edges.push({ from: step.key, to: previousMandatory, kind: "branch" });
    } else {
      edges.push({ from: previousMandatory, to: step.key, kind: "chain" });
      previousMandatory = step.key;
    }

    // ด่านนี้ส่งกลับให้แก้ไขได้ไหม — ถามตารางผลลัพธ์ ไม่ใช่เดาจากชนิดของด่าน
    if (ALLOWED_RESULTS[step.taskType].includes(ReviewResult.RETURNED)) {
      edges.push({ from: step.key, to: "RETURNED", kind: "return" });
    }
  }

  nodes.push(terminal("APPROVED", "main"));
  edges.push({ from: previousMandatory, to: "APPROVED", kind: "chain" });

  nodes.push(terminal("RETURNED", "revision", ROLE_CODES.ORGANIZATION_USER));
  nodes.push(terminal("REJECTED", "closed"));
  nodes.push(terminal("CANCELLED", "closed"));

  /**
   * แก้แล้วนำส่งใหม่กลับเข้าด่านตรวจของเจ้าหน้าที่เสมอ — แต่ **ช่องไหน** ขึ้นกับว่า
   * หน่วยงานลงนามไปแล้วหรือยัง (กติกาเดียวกับ slotOf) เส้นทางชุดข้อมูลจึงมีลูกศรกลับ
   * สองเส้น ไม่ใช่เส้นเดียว และนั่นคือความจริงของระบบ ไม่ใช่ความกำกวมของแผนภาพ
   */
  for (const step of plan) {
    if (step.taskType === SUBMIT_OPENS) {
      edges.push({ from: "RETURNED", to: step.key, kind: "resubmit" });
    }
  }

  return { nodes, edges };
}
