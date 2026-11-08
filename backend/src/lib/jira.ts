/**
 * การ์ด Jira ของการขอความเห็นผู้เชี่ยวชาญ — ฝั่งที่ route เรียก (การ์ด "[Enhance] JIRA integration" 2026-11-08)
 *
 * **route ไม่เคยเรียก Jira เอง** ทุกอย่างที่ต้องทำกับ Jira เป็นแถวใน `integration.integration_operation` (integration_type JIRA)
 * ที่เขียนใน transaction เดียวกับการกระทำในระบบ แล้ว `workers/jira.ts` ส่ง — Jira ล่มหรือ token หมดอายุจึงไม่มีวันทำให้การมอบหมาย
 * การส่งต่อ หรือการส่งกลับล้มเหลว และงานของคำขอเดียวกันถูกส่งตามลำดับที่เกิด (comment ไม่มีวันไปก่อนการ์ดถูกสร้าง)
 *
 * การ์ดหนึ่งใบคือแถวหนึ่งใน `integration.jira_issue_link`:
 *   มอบหมาย            → แถวใหม่ OPEN + งาน CREATE_ISSUE
 *   เปลี่ยนผู้เชี่ยวชาญ     → แถวเดิม + งาน UPDATE_ISSUE (ผู้รับผิดชอบ) + ADD_COMMENT
 *   การ์ดถึง Done        → (worker) คัดลอก comment ทั้งหมดเข้าไทม์ไลน์ แถวเป็น DONE
 *   ดำเนินการต่อ / ถอน / ผู้ดูแลระบบปิดคำขอ ก่อน Done → แถวเป็น ENDED + ADD_COMMENT + TRANSITION_ISSUE (ไป Archived)
 *
 * ปิดการเชื่อมต่ออยู่ = ไม่สร้างงานใหม่ (แถว link ยังถูกปิดตามจริง เพื่อไม่ให้ติดตามการ์ดของคำขอที่เดินไปแล้ว) งานที่ค้างอยู่รอจนเปิดใหม่
 */
import { randomUUID } from "node:crypto";

import { IntegrationStatus, IntegrationType, JiraIssueState, Prisma, type PrismaClient } from "@prisma/client";

import { env } from "../env.js";
import { correlationId } from "./context.js";
import { readJiraConfig } from "./jira-config.js";

type Db = PrismaClient | Prisma.TransactionClient;

export const JIRA_SUBJECT_TYPE = "DATASET_REGISTRATION_REQUEST";

/** รหัสงาน — สามตัวแรกตรงกับภาพใน sheet `integration_operation` (CREATE_ISSUE · UPDATE_ISSUE · SYNC_STATUS) */
export const JiraOperation = {
  CREATE_ISSUE: "CREATE_ISSUE",
  /** เปลี่ยนผู้รับผิดชอบ */
  UPDATE_ISSUE: "UPDATE_ISSUE",
  /** การ์ดถึง Done — คัดลอก comment เข้าไทม์ไลน์ หรือบันทึกว่าการ์ดถูกเก็บ/ลบใน Jira */
  SYNC_STATUS: "SYNC_STATUS",
  ADD_COMMENT: "ADD_COMMENT",
  /** ย้ายการ์ดไปสถานะเก็บ (Archived) */
  TRANSITION_ISSUE: "TRANSITION_ISSUE",
} as const;
export type JiraOperation = (typeof JiraOperation)[keyof typeof JiraOperation];

/** ป้ายของหน้าบันทึกการทำงาน */
export const JIRA_OPERATION_LABELS: Record<JiraOperation, string> = {
  CREATE_ISSUE: "สร้างการ์ด",
  UPDATE_ISSUE: "เปลี่ยนผู้รับผิดชอบ",
  SYNC_STATUS: "ดึง comment (Done)",
  ADD_COMMENT: "เขียน comment",
  TRANSITION_ISSUE: "ย้ายไป Archived",
};

/** เหตุที่ระบบเลิกติดตามการ์ดก่อน Done — เป็นทั้ง `jira_issue_link.end_reason` และรหัสข้อความ comment */
export type JiraEndReason =
  | "WITHDRAWN"
  | "FORWARDED"
  | "RETURNED"
  | "REJECTED"
  | "ADMIN_RESET"
  | "ADMIN_CANCELLED"
  | "ADMIN_DELETED";

export type JiraCommentCode = JiraEndReason | "REASSIGNED";

/** ข้อความ comment ที่ระบบเขียนลงการ์ด — ถ้อยคำตรงกับปุ่มและไทม์ไลน์ของระบบ (ตกลงกับ BDI 2026-11-08) */
const COMMENT_TEXT: Record<JiraEndReason, string> = {
  FORWARDED: "ผู้ประสานงานของ BDI ผ่านการตรวจสอบแล้ว คำขอถูกส่งต่อให้ผู้อนุมัติของหน่วยงานลงนาม",
  RETURNED: "ผู้ประสานงานของ BDI ส่งคำขอกลับให้หน่วยงานแก้ไข",
  REJECTED: "ผู้ประสานงานของ BDI ไม่อนุมัติคำขอ และปิดเรื่องแล้ว",
  WITHDRAWN: "ผู้ประสานงานของ BDI ถอนการขอความเห็นจากผู้เชี่ยวชาญแล้ว",
  ADMIN_RESET: "ผู้ดูแลระบบรีเซ็ตคำขอเป็นฉบับร่าง",
  ADMIN_CANCELLED: "ผู้ดูแลระบบยกเลิกคำขอ",
  ADMIN_DELETED: "ผู้ดูแลระบบลบคำขอออกจากระบบ",
};

/** สิ่งที่งานหนึ่งพกไป — ไม่มีความลับ (ดู `integration_operation.request_payload_json`) */
export interface JiraPayload {
  linkId: string;
  requestNumber: string;
  /** เลขการ์ด ถ้ารู้แล้วตอนเข้าคิว — จำเป็นสำหรับงานของคำขอที่ถูกลบ (แถว link หายไปพร้อมคำขอ) */
  issueKey?: string | null;
  code?: JiraCommentCode;
  /** เวลาที่เกิดเหตุในระบบ (ISO) — comment เล่าเวลานี้ ไม่ใช่เวลาที่ worker ส่งได้ */
  at: string;
  fromName?: string;
  toName?: string;
  /** ผู้ประสานงานที่กดมอบหมาย — ชื่อพิมพ์ลงรายละเอียดการ์ด */
  assignedById?: string;
  /** ผลของ SYNC_STATUS ที่ไม่ได้คัดลอก comment — ARCHIVED_IN_JIRA / DELETED_IN_JIRA */
  outcome?: string;
}

export const requestDetailUrl = (requestId: string) => `${env.appUrl}/admin/datasets/${requestId}`;
export const issueUrl = (domain: string, issueKey: string) => `${domain.replace(/\/+$/, "")}/browse/${issueKey}`;

const thaiDateTime = new Intl.DateTimeFormat("th-TH", {
  dateStyle: "long",
  timeStyle: "short",
  timeZone: "Asia/Bangkok",
});
export const formatThaiDateTime = (d: Date) => `${thaiDateTime.format(d)} น.`;

/** บรรทัดของ comment ที่ระบบเขียน — ท้ายด้วยวันที่และลิงก์คำขอ (คำขอที่ถูกลบไม่มีลิงก์ เพราะจะเปิดได้ 404) */
export function commentLines(payload: JiraPayload, requestId: string): string[] {
  const code = payload.code ?? "REASSIGNED";
  const headline =
    code === "REASSIGNED"
      ? `เปลี่ยนผู้เชี่ยวชาญจาก ${payload.fromName ?? "—"} เป็น ${payload.toName ?? "—"}`
      : COMMENT_TEXT[code];
  const lines = [headline, `คำขอ ${payload.requestNumber} · ${formatThaiDateTime(new Date(payload.at))}`];
  if (code !== "REASSIGNED") lines.push("การ์ดนี้ถูกย้ายไป Archived และระบบเลิกติดตามแล้ว");
  if (code !== "ADMIN_DELETED") lines.push(requestDetailUrl(requestId));
  return lines;
}

async function enqueue(
  tx: Db,
  request: { id: string; organizationId: string | null },
  operation: JiraOperation,
  payload: JiraPayload,
  options: { idempotencyKey?: string; status?: IntegrationStatus; completedAt?: Date; message?: string } = {},
) {
  return tx.integrationOperation.create({
    data: {
      integrationType: IntegrationType.JIRA,
      operation,
      subjectType: JIRA_SUBJECT_TYPE,
      subjectId: request.id,
      organizationId: request.organizationId,
      idempotencyKey: options.idempotencyKey ?? `JIRA:${operation}:${randomUUID()}`,
      requestPayloadJson: payload as unknown as Prisma.InputJsonValue,
      externalReference: payload.issueKey ?? null,
      correlationId: correlationId(),
      ...(options.status ? { status: options.status } : {}),
      ...(options.completedAt ? { completedAt: options.completedAt, lastAttemptAt: options.completedAt } : {}),
      ...(options.message ? { lastErrorMessage: options.message } : {}),
    },
  });
}

/** เพิ่มงานจาก worker (เช่น SYNC_STATUS เมื่อพบการ์ด Done) — idempotency key กันเข้าคิวซ้ำทุกรอบที่ยังเห็นว่า Done */
export async function enqueueJiraOperation(
  db: Db,
  request: { id: string; organizationId: string | null },
  operation: JiraOperation,
  payload: JiraPayload,
  options: { idempotencyKey?: string; status?: IntegrationStatus; completedAt?: Date; message?: string } = {},
): Promise<boolean> {
  try {
    await enqueue(db, request, operation, payload, options);
    return true;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return false;
    throw err;
  }
}

interface RequestRef {
  id: string;
  organizationId: string;
  requestNumber: string;
}

const nameOf = async (db: Db, userId: string | null | undefined): Promise<string> => {
  if (!userId) return "—";
  const u = await db.userAccount.findUnique({
    where: { id: userId },
    select: { email: true, prefixTh: true, firstnameTh: true, lastnameTh: true },
  });
  if (!u) return "—";
  return [u.prefixTh, u.firstnameTh, u.lastnameTh].filter(Boolean).join(" ") || u.email;
};

/**
 * ผู้ประสานงานกดบันทึกผู้เชี่ยวชาญ (`POST /dataset-requests/:id/assign`) — เรียกใน transaction ของการมอบหมาย
 *
 * ใหม่ → การ์ดใหม่ · เปลี่ยนคน → การ์ดเดิมเปลี่ยนผู้รับผิดชอบ · ถอน → ปิดการ์ด ผู้เชี่ยวชาญคนเดิมที่ถูกบันทึกซ้ำไม่ทำอะไร
 */
export async function jiraOnAssign(
  tx: Prisma.TransactionClient,
  params: { request: RequestRef; specialistId: string | null; actorId: string },
): Promise<void> {
  const { request, specialistId, actorId } = params;
  const open = await tx.jiraIssueLink.findFirst({
    where: { datasetRegistrationRequestId: request.id, state: JiraIssueState.OPEN },
    orderBy: { createdAt: "desc" },
  });

  if (!specialistId) {
    if (open) await endJiraLinks(tx, request, "WITHDRAWN");
    return;
  }

  const config = await readJiraConfig(tx);
  const at = new Date().toISOString();

  if (open) {
    if (open.specialistId === specialistId) return;
    const [fromName, toName] = await Promise.all([nameOf(tx, open.specialistId), nameOf(tx, specialistId)]);
    await tx.jiraIssueLink.update({ where: { id: open.id }, data: { specialistId, assigneeFound: null } });
    if (!config.enabled) return;
    const base = { linkId: open.id, requestNumber: request.requestNumber, issueKey: open.issueKey, at };
    await enqueue(tx, request, JiraOperation.UPDATE_ISSUE, base);
    await enqueue(tx, request, JiraOperation.ADD_COMMENT, { ...base, code: "REASSIGNED", fromName, toName });
    return;
  }

  // การมอบหมายที่เกิดตอนปิดการเชื่อมต่ออยู่ไม่สร้างการ์ด — และไม่สร้างย้อนหลังเมื่อเปิดใหม่
  if (!config.enabled) return;
  const link = await tx.jiraIssueLink.create({
    data: { datasetRegistrationRequestId: request.id, specialistId, createdBy: actorId },
  });
  await enqueue(tx, request, JiraOperation.CREATE_ISSUE, {
    linkId: link.id,
    requestNumber: request.requestNumber,
    at,
    assignedById: actorId,
  });
}

/**
 * เลิกติดตามการ์ดที่ยังเปิดของคำขอ — ผู้ประสานงานกดผ่าน/ส่งกลับ/ไม่อนุมัติ ถอนผู้เชี่ยวชาญ หรือผู้ดูแลระบบรีเซ็ต/ยกเลิก/ลบคำขอ
 *
 * เรียกใน transaction ของการกระทำนั้น แถว link เปลี่ยนเป็น ENDED ทันที ตัวติดตามจึงไม่คัดลอก comment ของการ์ดที่ Done หลังจากนี้
 * การ์ดที่ยังไม่ถูกสร้าง (งาน CREATE_ISSUE ยังรอ) → ยกเลิกงานนั้น ไม่มีการ์ดเกิดใน Jira เลย ถ้า worker กำลังสร้างอยู่พอดี worker
 * เห็นว่าแถวไม่ OPEN แล้วหลังสร้างเสร็จ และเข้าคิว comment + Archived เอง (`workers/jira.ts`)
 *
 * คืนจำนวนการ์ดที่ถูกปิด — หน้าจอใช้บอกว่ามีอะไรเกิดกับ Jira ไหม
 */
export async function endJiraLinks(
  tx: Prisma.TransactionClient,
  request: RequestRef,
  reason: JiraEndReason,
): Promise<number> {
  const links = await tx.jiraIssueLink.findMany({
    where: { datasetRegistrationRequestId: request.id, state: JiraIssueState.OPEN },
  });
  if (links.length === 0) return 0;

  const config = await readJiraConfig(tx);
  const at = new Date().toISOString();
  for (const link of links) {
    // updateMany + state ใน WHERE — สองการกระทำพร้อมกันปิดการ์ดใบเดียวได้ครั้งเดียว
    const { count } = await tx.jiraIssueLink.updateMany({
      where: { id: link.id, state: JiraIssueState.OPEN },
      data: { state: JiraIssueState.ENDED, endReason: reason, endedAt: new Date() },
    });
    if (count === 0) continue;

    if (!link.issueKey) {
      await tx.integrationOperation.updateMany({
        where: {
          integrationType: IntegrationType.JIRA,
          operation: JiraOperation.CREATE_ISSUE,
          subjectId: request.id,
          status: { in: [IntegrationStatus.PENDING, IntegrationStatus.FAILED, IntegrationStatus.DEAD_LETTER] },
          requestPayloadJson: { path: ["linkId"], equals: link.id },
        },
        data: {
          status: IntegrationStatus.CANCELLED,
          nextRetryAt: null,
          lastErrorCode: "ENDED_BEFORE_CREATE",
          lastErrorMessage: "ยกเลิก — คำขอเดินต่อไปก่อนสร้างการ์ดได้",
        },
      });
      continue;
    }
    if (!config.enabled) continue;
    await enqueueEndOperations(tx, request, link.id, link.issueKey, reason, at);
  }
  return links.length;
}

/** comment + ย้ายไป Archived — ใช้ทั้งตอนปิดจาก route และตอน worker สร้างการ์ดเสร็จแล้วพบว่าแถวถูกปิดไประหว่างนั้น */
export async function enqueueEndOperations(
  db: Db,
  request: { id: string; organizationId: string | null; requestNumber: string },
  linkId: string,
  issueKey: string,
  reason: JiraEndReason,
  at: string,
): Promise<void> {
  const base = { linkId, requestNumber: request.requestNumber, issueKey, at };
  await enqueue(db, request, JiraOperation.ADD_COMMENT, { ...base, code: reason });
  await enqueue(db, request, JiraOperation.TRANSITION_ISSUE, base);
}

/** แปลผลของด่านผู้ประสานงาน → เหตุที่ปิดการ์ด */
export function endReasonForOfficerResult(result: string): JiraEndReason {
  if (result === "RETURNED") return "RETURNED";
  if (result === "REJECTED") return "REJECTED";
  return "FORWARDED";
}

// ------------------------------------------------------------ สิ่งที่หน้าคำขอแสดง

export type JiraDelivery = "sent" | "pending" | "failed";

export interface RequestJiraStatus {
  issueKey: string | null;
  url: string | null;
  state: JiraIssueState;
  endReason: string | null;
  /** false = หาบัญชี Jira ของผู้เชี่ยวชาญไม่เจอ การ์ดไม่มีผู้รับผิดชอบ */
  assigneeFound: boolean | null;
  delivery: JiraDelivery;
  doneAt: Date | null;
}

/**
 * การ์ดล่าสุดของคำขอ — `null` เมื่อไม่เคยมี (เชื่อมต่อปิดอยู่ หรือไม่เคยขอความเห็น) เฉพาะฝั่ง BDI ผู้เรียกตัดสินว่าใครเห็น
 *
 * `delivery` มาจากงานของการ์ดใบนี้ที่ยังไม่จบ: มีงานที่เลิกลองแล้ว (DEAD_LETTER) = failed, มีงานรอ = pending, ไม่มีเลย = sent
 */
export async function jiraStatusForRequest(db: Db, requestId: string): Promise<RequestJiraStatus | null> {
  const link = await db.jiraIssueLink.findFirst({
    where: { datasetRegistrationRequestId: requestId },
    orderBy: { createdAt: "desc" },
  });
  if (!link) return null;

  const unfinished = await db.integrationOperation.findMany({
    where: {
      integrationType: IntegrationType.JIRA,
      subjectId: requestId,
      status: { notIn: [IntegrationStatus.SUCCEEDED, IntegrationStatus.CANCELLED] },
      requestPayloadJson: { path: ["linkId"], equals: link.id },
    },
    select: { status: true },
  });
  const delivery: JiraDelivery = unfinished.some((o) => o.status === IntegrationStatus.DEAD_LETTER)
    ? "failed"
    : unfinished.length > 0
      ? "pending"
      : "sent";

  const config = link.issueKey ? await readJiraConfig(db) : null;
  return {
    issueKey: link.issueKey,
    url: link.issueKey && config?.domain ? issueUrl(config.domain, link.issueKey) : null,
    state: link.state,
    endReason: link.endReason,
    assigneeFound: link.assigneeFound,
    delivery,
    doneAt: link.doneAt,
  };
}
