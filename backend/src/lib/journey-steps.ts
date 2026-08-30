/**
 * เส้นทางการอนุมัติทั้งเส้น — "มีกี่ขั้น ตอนนี้อยู่ขั้นไหน ขั้นต่อไปคือใคร"
 *
 * `review_task` ตอบได้แค่ว่าเกิดอะไรไปแล้วและค้างอยู่ที่ด่านไหน ส่วนลำดับด่านทั้งเส้นทาง
 * เดิมไม่ได้มีอยู่เป็นข้อมูลที่ไหนเลย มีแต่ control flow ใน `POST /:id/review` ของทั้งสอง
 * route ไฟล์นี้คือที่เดียวที่ประกาศลำดับนั้นออกมาเป็นข้อมูล — **แก้ที่นี่ต้องแก้คู่กับ
 * `nextStageAfter()` ใน routes/dataset-requests.ts และ if-chain ใน routes/organizations.ts**
 * ไม่งั้นหน้าจอจะสัญญาเส้นทางที่ backend ไม่ได้เดิน
 *
 * จนถึง 2026-08-30 Journey C มีด่านเจ้าหน้าที่ BDI สองด่าน (ตรวจเบื้องต้น กับ "ตรวจซ้ำ"
 * หลังหน่วยงานลงนาม) ซึ่งใช้ task_type เดียวกันและต้องแยกด้วยประวัติ ด่านตรวจซ้ำถูกยกเลิก
 * ไปแล้ว — ลงนามเสร็จแล้วส่งให้ผู้อนุมัติ BDI ทันที หนึ่ง task_type จึงเป็นหนึ่งช่องพอดี
 * ทั้งสองเส้นทาง และไฟล์นี้ไม่ต้องอ่านประวัติเพื่อตอบว่า task หนึ่งตกช่องไหนอีกต่อไป
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
  /** ชื่อสั้นที่กล่องในแผนภาพและ badge ในแถวใช้ร่วมกัน — ดู StepPlan.shortLabel */
  shortLabel: string;
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
  | "SPECIALIST_REVIEW"
  | "ORGANIZATION_APPROVAL"
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
 * สามด่านเท่ากับเส้นทางหน่วยงาน ต่างกันแค่ทางแยกผู้เชี่ยวชาญที่ไม่บังคับ — ด่านตรวจซ้ำของ
 * เจ้าหน้าที่ BDI ที่เคยคั่นระหว่างการลงนามกับการอนุมัติถูกยกเลิกเมื่อ 2026-08-30
 */
const DATASET_PLAN: StepPlan[] = [
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
 * คำนามที่ใช้นับของในเส้นทางนี้ — "จำนวน: 20 หน่วยงาน" / "จำนวน: 20 ชุดข้อมูล"
 *
 * อยู่ตรงนี้เพราะ `planFor()` เป็นที่เดียวที่รู้ว่า subject ไหนเป็นเส้นทางไหน ถ้าไปเขียน
 * ฝั่งหน้าเว็บก็จะเป็นตารางคำใบที่สองที่ต้องคอยไล่ให้ตรงกัน
 */
export const journeyUnit = (subjectType: SubjectType): string =>
  subjectType === SubjectType.ORGANIZATION_REGISTRATION_REQUEST ? "หน่วยงาน" : "ชุดข้อมูล";

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
 * หนึ่ง task_type คือหนึ่งช่องตั้งแต่ด่านตรวจซ้ำถูกยกเลิก — `ORGANIZATION_REVISION` เป็น
 * ข้อยกเว้นเดียว เพราะไม่เคยถูกเปิดเป็น task จึงไม่มีช่องของตัวเองในเส้นทาง
 */
export function slotOf(taskType: ReviewTaskType, plan: StepPlan[]): StepKey | null {
  if (taskType === ReviewTaskType.ORGANIZATION_REVISION) return null;
  return plan.find((s) => s.taskType === taskType)?.key ?? null;
}

/**
 * แถวล่าสุดของแต่ละช่อง
 *
 * เดินตาม sequenceNumber เพื่อให้ "ล่าสุด" หมายถึงล่าสุดจริง ไม่ใช่ลำดับที่ query คืนมา
 * แถว CANCELLED / REASSIGNED ไม่ถูกเก็บเป็นแถวล่าสุดของช่อง เพราะไม่ได้ให้ผลอะไร —
 * การถอนมอบหมายผู้เชี่ยวชาญจึงไม่ทำให้ขั้นนั้นดูเหมือนจบ
 */
function latestBySlot(tasks: JourneyTaskRow[], plan: StepPlan[]) {
  const latest = new Map<StepKey, JourneyTaskRow>();
  const slotOfTaskId = new Map<string, StepKey>();

  for (const task of [...tasks].sort((a, b) => a.sequenceNumber - b.sequenceNumber)) {
    const slot = slotOf(task.taskType, plan);
    if (!slot) continue;
    slotOfTaskId.set(task.id, slot);
    if (task.status === ReviewTaskStatus.COMPLETED || ACTIVE_TASK_STATUSES.includes(task.status)) {
      latest.set(slot, task);
    }
  }

  return { latest, slotOfTaskId };
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
  const { latest, slotOfTaskId } = latestBySlot(params.tasks, plan);
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
      shortLabel: step.shortLabel,
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
    nextStep: nextStepFor({ steps, currentStep, phase, byKey }),
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
 * `BDI_OFFICER_REVIEW` เสมอ** ไม่ว่าจะถูกส่งกลับจากด่านไหน — รวมถึงใบที่หน่วยงานลงนาม
 * ไปแล้ว ซึ่งจะต้องเดินผ่านการลงนามอีกครั้งเพราะเนื้อหาที่ลงนามไว้เปลี่ยนไปแล้ว
 */
function nextStepFor(params: {
  steps: JourneyStep[];
  currentStep: JourneyStep | null;
  phase: JourneyPhase;
  byKey: (key: StepKey) => JourneyStep | null;
}): JourneyStep | null {
  if (params.phase === "APPROVED" || params.phase === "REJECTED" || params.phase === "CANCELLED") {
    return null;
  }

  // ผู้เชี่ยวชาญพิจารณาเสร็จแล้วคืนให้เจ้าหน้าที่ตัดสินใจเสมอ ไม่ได้เดินต่อไปด่านถัดไปเอง
  if (params.currentStep?.key === "SPECIALIST_REVIEW") return params.byKey("OFFICER_REVIEW");

  if (params.currentStep) {
    const from = params.steps.indexOf(params.currentStep);
    return params.steps.slice(from + 1).find((s) => !s.optional) ?? null;
  }

  return params.byKey("OFFICER_REVIEW");
}

/** ย่อให้พอสำหรับตารางและการ์ด — หน้ารายการไม่ต้องแบกรายการขั้นทั้งชุด */
export interface JourneyProgressSummary {
  totalSteps: number;
  currentOrder: number | null;
  /**
   * ช่องที่คำขอค้างอยู่ — **คีย์เดียวกับโหนดในแผนภาพ** ไม่ใช่ task_type
   *
   * badge ของแถวกับกล่องในแผนภาพต้องเรียกสิ่งเดียวกันด้วยคำเดียวกัน คีย์นี้คือสิ่งที่
   * ผูกทั้งสองเข้าด้วยกัน — TASK_TYPE_META เหลือหน้าที่แค่เลือกสี
   */
  currentKey: StepKey | null;
  currentLabel: string | null;
  /**
   * ชื่อสั้นของช่องปัจจุบัน — badge ในแถวใช้ตัวนี้ ส่วนชื่อเต็มไปอยู่ใน hover
   *
   * badge ที่ใส่ชื่อเต็ม ("รอเจ้าหน้าที่ BDI ตรวจสอบเอกสาร") ล้นคอลัมน์ 12rem แล้วไป
   * ทับคอลัมน์ความคืบหน้า และคำก็ไม่ตรงกับกล่องในแผนภาพที่ผู้ใช้กดเข้ามาด้วย
   */
  currentShortLabel: string | null;
  nextLabel: string | null;
  phase: JourneyPhase;
}

export function summariseProgress(progress: JourneyProgress): JourneyProgressSummary {
  return {
    totalSteps: progress.totalSteps,
    currentOrder: progress.currentOrder,
    currentKey: (progress.currentStep?.key as StepKey | undefined) ?? null,
    currentLabel: progress.currentStep?.waitingLabel ?? null,
    currentShortLabel: progress.currentStep?.shortLabel ?? null,
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

/** ช่องที่ task ที่ยัง active หนึ่งแถวตกอยู่ — หน้ารายการใช้ตัวนี้ ไม่ต้องเดินประวัติทั้งใบ */
export const currentSlotOf = (params: {
  subjectType: SubjectType;
  taskType: ReviewTaskType;
}): StepKey | null => slotOf(params.taskType, planFor(params.subjectType));

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
   * แก้แล้วนำส่งใหม่กลับเข้าด่านตรวจของเจ้าหน้าที่เสมอ ไม่ว่าจะถูกส่งกลับจากด่านไหน —
   * ใบที่หน่วยงานลงนามไปแล้วก็เดินผ่านการลงนามใหม่อีกรอบ เพราะเนื้อหาที่ลงนามไว้เปลี่ยนไปแล้ว
   */
  for (const step of plan) {
    if (step.taskType === SUBMIT_OPENS) {
      edges.push({ from: "RETURNED", to: step.key, kind: "resubmit" });
    }
  }

  return { nodes, edges };
}
