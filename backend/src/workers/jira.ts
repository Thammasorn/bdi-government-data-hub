/**
 * ตัวส่งงาน Jira และตัวติดตามการ์ด — สองลูปใน delivery-worker (การ์ด "[Enhance] JIRA integration" 2026-11-08)
 *
 * **ลูปส่งงาน** (ทุก 15 วินาที) หยิบแถว `integration_operation` ของ JIRA ที่ถึงเวลา ด้วย `FOR UPDATE SKIP LOCKED` เหมือน outbox อีเมล
 * หยิบได้เฉพาะงานแรกที่ยังไม่จบของแต่ละคำขอ งานของคำขอเดียวกันจึงทำตามลำดับเสมอ และงานที่เลิกลองแล้ว (DEAD_LETTER) กั้นงานหลังจากมัน
 * ไว้จนกว่าผู้ดูแลระบบกด "ลองอีกครั้ง" — comment ที่ไปถึงการ์ดที่ยังไม่ถูกสร้างไม่มีความหมาย
 *
 *   ล้มแบบลองใหม่ได้ (Jira ไม่ตอบ, 5xx) → ลองใหม่ 1, 5, 15, 60 นาที แล้วทุกชั่วโมง ครบ 24 ชั่วโมงนับจาก scheduled_at → DEAD_LETTER
 *   429                              → รอตาม Retry-After แล้วหยุดรอบนี้
 *   token/สิทธิ์ใช้ไม่ได้ (401/403)      → DEAD_LETTER ทันที (`last_error_code` ขึ้นต้นด้วย AUTH) บันทึก `authFailedAt` และหยุดทุกงาน
 *                                     จนกว่าผู้ดูแลระบบจะบันทึก credential ใหม่ — ตอนนั้นงานที่ล้มเพราะ AUTH กลับเข้าคิวเอง (`routes/admin-jira.ts`)
 *   ไม่มีวันผ่าน (400/404)              → DEAD_LETTER ทันที
 * ทุกครั้งที่เลิกลองเป็น error ใน log store (อีเมลสรุป error ไปถึงผู้ดูแลระบบตามระบบเดิม)
 *
 * **ลูปติดตาม** ถามสถานะของการ์ดทุกใบที่ OPEN และมีเลขแล้ว ในคำสั่งค้นเดียว ทุก `jira_sync_interval_seconds` (ค่าตั้งระบบ) การ์ดที่ถึง
 * สถานะ Done → เข้าคิว SYNC_STATUS ซึ่งคัดลอก comment ทั้งหมดเข้าไทม์ไลน์เป็นความเห็นของผู้เชี่ยวชาญ การ์ดที่ถูกย้ายไปสถานะเก็บหรือถูกลบใน
 * Jira → เลิกติดตาม ไม่คัดลอกอะไร และเขียนแถวบันทึกไว้หนึ่งแถว
 *
 * ปิดการเชื่อมต่ออยู่ = ทั้งสองลูปไม่ทำอะไร งานที่ค้างรออยู่ในคิว
 */
import { randomUUID } from "node:crypto";

import {
  IntegrationStatus,
  JiraIssueState,
  ReviewTaskType,
  type IntegrationOperation,
  type PrismaClient,
} from "@prisma/client";

import { AuditAction, AuditSubject, logAudit, sanitizeState } from "../lib/audit.js";
import { runWithContext } from "../lib/context.js";
import { choiceLabel, loadChoices } from "../lib/dataset-choices.js";
import { captureError } from "../lib/error-capture.js";
import {
  JiraError,
  addComment,
  adfFromLines,
  adfToText,
  assignIssue,
  createIssue,
  credentialsOf,
  findUserByEmail,
  getComments,
  getMyself,
  issueStatuses,
  transitionTo,
} from "../lib/jira-client.js";
import { isJiraUsable, readJiraConfig, readJiraStatus, writeJiraStatus, type JiraConfig } from "../lib/jira-config.js";
import {
  JiraOperation,
  commentLines,
  enqueueEndOperations,
  enqueueJiraOperation,
  formatThaiDateTime,
  issueUrl,
  requestDetailUrl,
  type JiraEndReason,
  type JiraPayload,
} from "../lib/jira.js";
import { NotificationType, bdiOfficerIds, notifyUsers } from "../lib/notify.js";
import { readSystemSetting } from "../lib/system-settings.js";
import { ROLE_CODES, SYSTEM_USER_ID } from "../lib/system.js";
import { deriveRequestStatus, recordAdvisoryNote } from "../lib/workflow.js";

const QUEUE_TICK_MS = Number(process.env.JIRA_QUEUE_POLL_MS ?? 15_000);
/** ลูปติดตามตื่นทุก 30 วินาทีเพื่อดูว่าครบรอบที่ตั้งไว้หรือยัง — ค่าตั้งเปลี่ยนแล้วมีผลโดยไม่ต้อง restart */
const SYNC_CHECK_MS = 30_000;
const FIRST_TICK_MS = 20_000;
const BATCH_SIZE = 10;
/** งานที่ค้าง PROCESSING นานกว่านี้ = worker ตัวที่หยิบไปตายกลางทาง หยิบใหม่ได้ */
const STUCK_PROCESSING_MS = 10 * 60_000;
const RETRY_WINDOW_MS = 24 * 60 * 60_000;
const BACKOFF_MINUTES = [1, 5, 15, 60];

const SUBJECT = "DATASET_REGISTRATION_REQUEST" as const;

let timers: NodeJS.Timeout[] = [];
let queueRunning = false;
let syncRunning = false;
let choicesLoaded = false;

export function startJiraWorker(prisma: PrismaClient): void {
  if (timers.length > 0) return;
  const first = setTimeout(() => {
    void queueTick(prisma);
    void syncTick(prisma);
  }, FIRST_TICK_MS);
  const queue = setInterval(() => void queueTick(prisma), QUEUE_TICK_MS);
  const sync = setInterval(() => void syncTick(prisma), SYNC_CHECK_MS);
  timers = [first, queue, sync];
  for (const t of timers) t.unref();
}

export function stopJiraWorker(): void {
  for (const t of timers) clearTimeout(t);
  timers = [];
}

/**
 * หยุดเรียก Jira ไหม — ปิดการเชื่อมต่อ ตั้งค่าไม่ครบ หรือ token ล้มแล้วยังไม่มีใครแก้
 * (credential ที่บันทึกหลัง `authFailedAt` ถือว่าแก้แล้ว)
 */
async function pausedReason(prisma: PrismaClient, config: JiraConfig): Promise<string | null> {
  if (!config.enabled) return "disabled";
  if (!isJiraUsable(config)) return "incomplete";
  const status = await readJiraStatus(prisma);
  if (status.authFailedAt) {
    const failedAt = new Date(status.authFailedAt);
    if (!config.credentialsChangedAt || config.credentialsChangedAt <= failedAt) return "auth";
  }
  return null;
}

// ================================================================ ลูปส่งงาน

async function queueTick(prisma: PrismaClient): Promise<void> {
  if (queueRunning) return;
  queueRunning = true;
  try {
    const config = await readJiraConfig(prisma);
    if (await pausedReason(prisma, config)) return;

    const claimed = await prisma.$queryRaw<Array<{ id: string; correlation_id: string }>>`
      UPDATE integration.integration_operation o
         SET status = 'PROCESSING'::integration."IntegrationStatus",
             processing_at = now(),
             updated_at = now(),
             version = o.version + 1
       WHERE o.id IN (
         SELECT op.id
           FROM integration.integration_operation op
          WHERE op.integration_type = 'JIRA'::integration."IntegrationType"
            AND (
                 (op.status IN ('PENDING'::integration."IntegrationStatus", 'FAILED'::integration."IntegrationStatus")
                  AND op.scheduled_at <= now()
                  AND (op.next_retry_at IS NULL OR op.next_retry_at <= now()))
              OR (op.status = 'PROCESSING'::integration."IntegrationStatus"
                  AND op.processing_at < now() - make_interval(secs => ${STUCK_PROCESSING_MS / 1000}::int))
            )
            AND NOT EXISTS (
              SELECT 1 FROM integration.integration_operation earlier
               WHERE earlier.integration_type = op.integration_type
                 AND earlier.subject_id = op.subject_id
                 AND earlier.status NOT IN ('SUCCEEDED'::integration."IntegrationStatus", 'CANCELLED'::integration."IntegrationStatus")
                 AND (earlier.created_at, earlier.id) < (op.created_at, op.id)
            )
          ORDER BY op.created_at
          LIMIT ${BATCH_SIZE}
            FOR UPDATE OF op SKIP LOCKED
       )
      RETURNING o.id, o.correlation_id`;

    for (const row of claimed) {
      const stop = await runWithContext({ correlationId: row.correlation_id, sourceComponent: "jira-worker" }, () =>
        processOne(prisma, config, row.id),
      );
      if (stop) {
        // งานที่หยิบไว้แล้วแต่ยังไม่ได้ทำ — คืนเข้าคิวทันที ไม่ต้องรอ 10 นาทีของงานค้าง
        const rest = claimed.slice(claimed.indexOf(row) + 1).map((r) => r.id);
        if (rest.length > 0) {
          await prisma.integrationOperation.updateMany({
            where: { id: { in: rest }, status: IntegrationStatus.PROCESSING },
            data: { status: IntegrationStatus.PENDING, processingAt: null },
          });
        }
        break;
      }
    }
  } catch (err) {
    console.error("[jira] รอบส่งงานล้มเหลว — ดูบรรทัด [capture] ถัดไป");
    captureError(err, { tag: "jira.queue-tick" });
  } finally {
    queueRunning = false;
  }
}

/** ทำงานหนึ่งแถว — คืน true เมื่อควรหยุดรอบนี้ (token ใช้ไม่ได้ หรือ Jira ขอให้รอ) */
async function processOne(prisma: PrismaClient, config: JiraConfig, id: string): Promise<boolean> {
  const op = await prisma.integrationOperation.findUnique({ where: { id } });
  if (!op) return false;
  const payload = (op.requestPayloadJson ?? {}) as unknown as JiraPayload;
  const attempt = op.attemptCount + 1;

  try {
    const outcome = await perform(prisma, config, op, payload);
    await prisma.integrationOperation.update({
      where: { id },
      data: {
        status: outcome.cancelled ? IntegrationStatus.CANCELLED : IntegrationStatus.SUCCEEDED,
        attemptCount: attempt,
        lastAttemptAt: new Date(),
        completedAt: new Date(),
        nextRetryAt: null,
        processingAt: null,
        externalReference: outcome.issueKey ?? op.externalReference,
        lastErrorCode: outcome.cancelled ? outcome.cancelled.code : null,
        lastErrorMessage: outcome.cancelled ? outcome.cancelled.message : (outcome.note ?? null),
      },
    });
    if (!outcome.cancelled) await writeJiraStatus(prisma, { ok: true, message: null, code: null, at: new Date().toISOString() });
    return false;
  } catch (err) {
    return handleFailure(prisma, op, payload, attempt, err);
  }
}

async function handleFailure(
  prisma: PrismaClient,
  op: IntegrationOperation,
  payload: JiraPayload,
  attempt: number,
  err: unknown,
): Promise<boolean> {
  const jira = err instanceof JiraError ? err : null;
  const kind = jira?.kind ?? "RETRY";
  const message = jira?.message ?? "เกิดข้อผิดพลาดในระบบระหว่างส่งไป Jira";
  const now = new Date();
  const extra = { operationId: op.id, operation: op.operation, requestNumber: payload.requestNumber, attempt };

  if (kind === "RATE_LIMIT") {
    await prisma.integrationOperation.update({
      where: { id: op.id },
      data: {
        status: IntegrationStatus.FAILED,
        attemptCount: attempt,
        lastAttemptAt: now,
        processingAt: null,
        nextRetryAt: new Date(now.getTime() + (jira?.retryAfterMs ?? 60_000)),
        lastErrorCode: "429",
        lastErrorMessage: message,
      },
    });
    return true;
  }

  if (kind === "AUTH") {
    await prisma.integrationOperation.update({
      where: { id: op.id },
      data: {
        status: IntegrationStatus.DEAD_LETTER,
        attemptCount: attempt,
        lastAttemptAt: now,
        processingAt: null,
        nextRetryAt: null,
        lastErrorCode: `AUTH:${jira?.code ?? "?"}`,
        lastErrorMessage: message,
      },
    });
    await writeJiraStatus(prisma, {
      ok: false,
      message,
      code: jira?.code ?? null,
      at: now.toISOString(),
      authFailedAt: now.toISOString(),
    });
    console.error(`[jira] ${message} — หยุดส่งงาน Jira จนกว่าผู้ดูแลระบบจะแก้ค่าตั้ง`);
    captureError(new Error(`Jira: ${message} — หยุดส่งงานจนกว่าจะแก้ค่าตั้งใน /console → ตั้งค่าระบบ → Jira`), {
      level: "error",
      tag: "jira.auth",
      fingerprint: "jira:auth",
      extra,
    });
    return true;
  }

  const windowStart = op.scheduledAt.getTime();
  const exhausted = kind === "PERMANENT" || now.getTime() - windowStart >= RETRY_WINDOW_MS;
  const backoff = BACKOFF_MINUTES[Math.min(attempt - 1, BACKOFF_MINUTES.length - 1)]! * 60_000;
  await prisma.integrationOperation.update({
    where: { id: op.id },
    data: {
      status: exhausted ? IntegrationStatus.DEAD_LETTER : IntegrationStatus.FAILED,
      attemptCount: attempt,
      lastAttemptAt: now,
      processingAt: null,
      nextRetryAt: exhausted ? null : new Date(now.getTime() + backoff),
      lastErrorCode: jira?.code ?? "ERROR",
      lastErrorMessage: exhausted && kind !== "PERMANENT" ? `${message} — ลองครบ 24 ชั่วโมงแล้ว เลิกลอง` : message,
    },
  });
  await writeJiraStatus(prisma, { ok: false, message, code: jira?.code ?? null, at: now.toISOString() });

  console.error(`[jira] ${op.operation} ของ ${payload.requestNumber} ไม่สำเร็จ ครั้งที่ ${attempt} — ดูบรรทัด [capture] ถัดไป`);
  captureError(err, {
    level: exhausted ? "error" : "warning",
    tag: exhausted ? "jira.dead-letter" : "jira.send-failed",
    fingerprint: exhausted ? `jira:dead-letter:${op.operation}` : `jira:${jira?.code ?? "error"}`,
    extra,
  });
  return false;
}

interface Outcome {
  issueKey?: string;
  cancelled?: { code: string; message: string };
  /** ข้อความประกอบของงานที่สำเร็จ — เช่น "ไม่พบบัญชี Jira ของผู้เชี่ยวชาญ" */
  note?: string;
}

async function perform(
  prisma: PrismaClient,
  config: JiraConfig,
  op: IntegrationOperation,
  payload: JiraPayload,
): Promise<Outcome> {
  const creds = credentialsOf(config);
  const link = payload.linkId ? await prisma.jiraIssueLink.findUnique({ where: { id: payload.linkId } }) : null;
  const issueKey = payload.issueKey ?? link?.issueKey ?? null;

  switch (op.operation) {
    case JiraOperation.CREATE_ISSUE: {
      if (!link) return { cancelled: { code: "REQUEST_GONE", message: "ยกเลิก — คำขอถูกลบไปแล้ว" } };
      if (link.issueKey) return { issueKey: link.issueKey };
      if (link.state !== JiraIssueState.OPEN) {
        return { cancelled: { code: "ENDED_BEFORE_CREATE", message: "ยกเลิก — คำขอเดินต่อไปก่อนสร้างการ์ดได้" } };
      }
      const request = await prisma.datasetRegistrationRequest.findUnique({
        where: { id: op.subjectId },
        include: {
          metadata: true,
          organization: { select: { nameTh: true, organizationCode: true } },
        },
      });
      if (!request) return { cancelled: { code: "REQUEST_GONE", message: "ยกเลิก — คำขอถูกลบไปแล้ว" } };
      const specialist = link.specialistId
        ? await prisma.userAccount.findUnique({
            where: { id: link.specialistId },
            select: { email: true, prefixTh: true, firstnameTh: true, lastnameTh: true },
          })
        : null;
      const accountId = specialist?.email ? await findUserByEmail(creds, specialist.email, config.projectKey) : null;
      const assignedBy = await personName(prisma, payload.assignedById);

      if (!choicesLoaded) {
        await loadChoices();
        choicesLoaded = true;
      }
      const m = request.metadata;
      const label = (field: Parameters<typeof choiceLabel>[0], code: string | null | undefined) =>
        code ? choiceLabel(field, code) : "—";
      const datasetName = m?.title || m?.name || "(ยังไม่ระบุชื่อชุดข้อมูล)";
      const specialistName = specialist
        ? `${[specialist.prefixTh, specialist.firstnameTh, specialist.lastnameTh].filter(Boolean).join(" ") || specialist.email} (${specialist.email})`
        : "—";
      const frequency = m?.updateFrequencyUnit
        ? `${label("updateFrequencyUnit", m.updateFrequencyUnit)}${m.updateFrequencyInterval ? ` (ทุก ${m.updateFrequencyInterval})` : ""}`
        : "—";

      const lines = [
        `คำขอส่งชุดข้อมูล: ${request.requestNumber}`,
        `ชุดข้อมูล: ${datasetName}`,
        `หน่วยงาน: ${request.organization.nameTh}${request.organization.organizationCode ? ` (${request.organization.organizationCode})` : ""}`,
        `ผู้ขอความเห็น: ${assignedBy}`,
        `วันที่ขอความเห็น: ${formatThaiDateTime(new Date(payload.at))}`,
        `ผู้เชี่ยวชาญ: ${specialistName}`,
        ...(accountId ? [] : ["ไม่พบบัญชี Jira ที่ใช้อีเมลของผู้เชี่ยวชาญใน project นี้ — การ์ดยังไม่มีผู้รับผิดชอบ"]),
        "เปิดคำขอในระบบ:",
        requestDetailUrl(request.id),
        "",
        "ข้อมูลชุดข้อมูล",
        `คำอธิบาย: ${m?.notes || "—"}`,
        `รูปแบบข้อมูล: ${label("dataFormat", m?.dataFormat)}${m?.dataFormatOther ? ` — ${m.dataFormatOther}` : ""}`,
        `ความถี่การปรับปรุง: ${frequency}`,
        `ระดับชั้นข้อมูล: ${label("dataClassification", m?.dataClassification)}`,
        "",
        'เมื่อตรวจสอบเสร็จ ให้เขียนความเห็นเป็น comment ในการ์ดนี้ แล้วย้ายการ์ดไป "' +
          config.doneStatus +
          '" — ระบบจะคัดลอก comment ทั้งหมดไปไว้ในประวัติของคำขอ',
      ];

      const created = await createIssue(creds, {
        projectKey: config.projectKey,
        summary: `[${request.requestNumber}] ตรวจสอบชุดข้อมูล ${datasetName}`,
        description: adfFromLines(lines),
        assigneeAccountId: accountId,
      });
      const after = await prisma.jiraIssueLink.update({
        where: { id: link.id },
        data: { issueKey: created.key, issueId: created.id, assigneeFound: Boolean(accountId) },
      });
      // คำขอเดินต่อไประหว่างที่กำลังสร้าง — route ยกเลิกงานนี้ไม่ทันเพราะมันถูกหยิบไปแล้ว จึงปิดการ์ดที่เพิ่งเกิดเองที่นี่
      if (after.state === JiraIssueState.ENDED && after.endReason) {
        await enqueueEndOperations(
          prisma,
          { id: request.id, organizationId: request.organizationId, requestNumber: request.requestNumber },
          link.id,
          created.key,
          after.endReason as JiraEndReason,
          (after.endedAt ?? new Date()).toISOString(),
        );
      }
      return {
        issueKey: created.key,
        note: accountId ? undefined : "ไม่พบบัญชี Jira ที่ใช้อีเมลของผู้เชี่ยวชาญ — สร้างการ์ดแบบไม่มีผู้รับผิดชอบ",
      };
    }

    case JiraOperation.UPDATE_ISSUE: {
      if (!link || !issueKey) return { cancelled: { code: "NO_ISSUE", message: "ยกเลิก — ไม่มีการ์ดให้เปลี่ยน" } };
      const specialist = link.specialistId
        ? await prisma.userAccount.findUnique({ where: { id: link.specialistId }, select: { email: true } })
        : null;
      const accountId = specialist?.email ? await findUserByEmail(creds, specialist.email, config.projectKey) : null;
      await assignIssue(creds, issueKey, accountId);
      await prisma.jiraIssueLink.update({ where: { id: link.id }, data: { assigneeFound: Boolean(accountId) } });
      return {
        issueKey,
        note: accountId ? undefined : "ไม่พบบัญชี Jira ที่ใช้อีเมลของผู้เชี่ยวชาญ — การ์ดไม่มีผู้รับผิดชอบ",
      };
    }

    case JiraOperation.ADD_COMMENT: {
      if (!issueKey) return { cancelled: { code: "NO_ISSUE", message: "ยกเลิก — ไม่มีการ์ดให้เขียน" } };
      await addComment(creds, issueKey, adfFromLines(commentLines(payload, op.subjectId)));
      return { issueKey };
    }

    case JiraOperation.TRANSITION_ISSUE: {
      if (!issueKey) return { cancelled: { code: "NO_ISSUE", message: "ยกเลิก — ไม่มีการ์ดให้ย้าย" } };
      await transitionTo(creds, issueKey, config.archiveStatus);
      return { issueKey };
    }

    case JiraOperation.SYNC_STATUS:
      return copyCommentsToTimeline(prisma, config, op, payload, link?.id ?? null, issueKey);

    default:
      return { cancelled: { code: "UNKNOWN_OPERATION", message: `ไม่รู้จักงาน ${op.operation}` } };
  }
}

async function personName(prisma: PrismaClient, userId: string | undefined | null): Promise<string> {
  if (!userId) return "—";
  const u = await prisma.userAccount.findUnique({
    where: { id: userId },
    select: { email: true, prefixTh: true, firstnameTh: true, lastnameTh: true },
  });
  return u ? [u.prefixTh, u.firstnameTh, u.lastnameTh].filter(Boolean).join(" ") || u.email : "—";
}

/**
 * การ์ดถึง Done — comment ทั้งหมดกลายเป็นความเห็นของผู้เชี่ยวชาญหนึ่งรายการในไทม์ไลน์ (มองเห็นเฉพาะ BDI เหมือนความเห็นที่บันทึกในระบบ)
 *
 * แถว link เปลี่ยน OPEN → DONE ด้วย updateMany ที่มี state ใน WHERE ภายใน transaction เดียวกับที่เขียน review_task: ถ้าผู้ประสานงานกด
 * ดำเนินการต่อระหว่างนี้ (แถวเป็น ENDED แล้ว) จะไม่มีอะไรถูกเขียน — ความเห็นมาไม่ทันรอบนั้น ตรงกับสิ่งที่ผู้ประสานงานยืนยันไว้
 * ทุกทางที่เขียน review_task จบด้วยการคำนวณสถานะคำขอใหม่ (กติกาเดียวกับ `syncStatus()` ใน routes/dataset-requests.ts)
 */
async function copyCommentsToTimeline(
  prisma: PrismaClient,
  config: JiraConfig,
  op: IntegrationOperation,
  payload: JiraPayload,
  linkId: string | null,
  issueKey: string | null,
): Promise<Outcome> {
  if (!linkId || !issueKey) return { cancelled: { code: "REQUEST_GONE", message: "ยกเลิก — คำขอหรือการ์ดไม่มีอยู่แล้ว" } };
  const link = await prisma.jiraIssueLink.findUnique({ where: { id: linkId } });
  if (!link || link.state !== JiraIssueState.OPEN) {
    return { cancelled: { code: "NOT_TRACKED", message: "ยกเลิก — ระบบเลิกติดตามการ์ดนี้ก่อนคัดลอก comment" } };
  }

  /**
   * comment ที่ระบบเขียนเองไม่ใช่ความเห็นของผู้เชี่ยวชาญ — "เปลี่ยนผู้เชี่ยวชาญจาก … เป็น …" และข้อความอื่นที่บัญชีเชื่อมต่อ (jira-vela) เขียน
   * ถูกตัดออกด้วย accountId ของบัญชีนั้น พบเมื่อ 2026-11-08: การ์ดที่ผู้เชี่ยวชาญไม่ได้เขียนอะไรเลยถูกย้ายไป Done แล้วไทม์ไลน์ได้ comment
   * ของระบบเองสามรายการในนามผู้เชี่ยวชาญ
   */
  const creds = credentialsOf(config);
  const me = await getMyself(creds);
  const comments = (await getComments(creds, issueKey)).filter((c) => c.authorAccountId !== me.accountId);
  const blocks = comments.map((c) => {
    const { text, hasMedia } = adfToText(c.body);
    return [
      `${c.author} · ${formatThaiDateTime(new Date(c.created))}`,
      text || "(ไม่มีข้อความ)",
      ...(hasMedia ? ["มีไฟล์แนบ — ดูใน Jira"] : []),
    ].join("\n");
  });
  const url = issueUrl(config.domain, issueKey);
  const note = [
    `ความเห็นของผู้เชี่ยวชาญ (จาก Jira ${issueKey})`,
    url,
    "",
    blocks.length > 0 ? blocks.join("\n\n") : `ผู้เชี่ยวชาญย้ายการ์ดไป ${config.doneStatus} โดยไม่มี comment`,
  ].join("\n");

  const request = await prisma.datasetRegistrationRequest.findUnique({
    where: { id: op.subjectId },
    select: { id: true, organizationId: true, submittedAt: true, cancelledAt: true, assignedSpecialistById: true },
  });
  if (!request) return { cancelled: { code: "REQUEST_GONE", message: "ยกเลิก — คำขอถูกลบไปแล้ว" } };

  // ผู้เชี่ยวชาญที่การ์ดอยู่กับ — ไทม์ไลน์บอกชื่อเขาเป็นผู้ให้ความเห็น (ชื่อผู้เขียนแต่ละ comment อยู่ในเนื้อความ)
  const authorId = link.specialistId ?? SYSTEM_USER_ID;
  const written = await prisma.$transaction(async (tx) => {
    const { count } = await tx.jiraIssueLink.updateMany({
      where: { id: link.id, state: JiraIssueState.OPEN },
      data: { state: JiraIssueState.DONE, doneAt: new Date() },
    });
    if (count === 0) return false;
    await recordAdvisoryNote(tx, {
      subjectType: SUBJECT,
      subjectId: request.id,
      taskType: ReviewTaskType.DATASET_SPECIALIST_REVIEW,
      assignedUserId: authorId,
      assignedRole: ROLE_CODES.BDI_DATASET_SPECIALIST,
      comment: note,
      actorId: authorId,
    });
    const status = await deriveRequestStatus(tx, {
      subjectType: SUBJECT,
      subjectId: request.id,
      hasSubmitted: Boolean(request.submittedAt),
      cancelled: Boolean(request.cancelledAt),
    });
    await tx.datasetRegistrationRequest.update({
      where: { id: request.id },
      data: { status, updatedBy: SYSTEM_USER_ID },
    });
    return true;
  });
  if (!written) {
    return { cancelled: { code: "NOT_TRACKED", message: "ยกเลิก — ระบบเลิกติดตามการ์ดนี้ก่อนคัดลอก comment" } };
  }

  await logAudit({
    action: AuditAction.SPECIALIST_COMMENT_RECORDED,
    subjectType: AuditSubject.DATASET_REGISTRATION_REQUEST,
    subjectId: request.id,
    organizationId: request.organizationId,
    after: sanitizeState({ taskType: ReviewTaskType.DATASET_SPECIALIST_REVIEW, note }),
    metadata: { source: "JIRA", issue_key: issueKey, comment_count: comments.length },
  });
  // คนเดียวกับที่ได้แจ้งเมื่อผู้เชี่ยวชาญบันทึกความเห็นในระบบ — ผู้ที่กดขอ + ผู้ประสานงานของ BDI ทุกคน (ผ่าน outbox)
  await notifyUsers([request.assignedSpecialistById, ...(await bdiOfficerIds())], {
    type: NotificationType.SPECIALIST_COMMENTED,
    title: "ผู้เชี่ยวชาญให้ความเห็นต่อคำขอ",
    message: note,
    subjectType: SUBJECT,
    subjectId: request.id,
    organizationId: request.organizationId,
  });
  return { issueKey, note: `คัดลอก ${comments.length} comment เข้าประวัติของคำขอ` };
}

// ================================================================ ลูปติดตาม

async function syncTick(prisma: PrismaClient): Promise<void> {
  if (syncRunning) return;
  syncRunning = true;
  try {
    const config = await readJiraConfig(prisma);
    if (await pausedReason(prisma, config)) return;

    const intervalSeconds = await readSystemSetting(prisma, "jira_sync_interval_seconds");
    const status = await readJiraStatus(prisma);
    if (status.lastSyncAt && Date.now() - new Date(status.lastSyncAt).getTime() < intervalSeconds * 1000) return;

    await runWithContext({ correlationId: randomUUID(), sourceComponent: "jira-sync" }, () => syncOnce(prisma, config));
  } catch (err) {
    console.error("[jira] รอบติดตามการ์ดล้มเหลว — ดูบรรทัด [capture] ถัดไป");
    captureError(err, { tag: "jira.sync-tick" });
  } finally {
    syncRunning = false;
  }
}

async function syncOnce(prisma: PrismaClient, config: JiraConfig): Promise<void> {
  const startedAt = new Date().toISOString();
  const links = await prisma.jiraIssueLink.findMany({
    where: { state: JiraIssueState.OPEN, issueKey: { not: null } },
    include: { datasetRegistrationRequest: { select: { id: true, organizationId: true, requestNumber: true } } },
    take: 2000,
  });
  if (links.length === 0) {
    await writeJiraStatus(prisma, { lastSyncAt: startedAt });
    return;
  }

  let statuses: Map<string, string | null>;
  try {
    statuses = await issueStatuses(credentialsOf(config), links.map((l) => l.issueKey!));
  } catch (err) {
    const jira = err instanceof JiraError ? err : null;
    const now = new Date().toISOString();
    if (jira?.kind === "AUTH") {
      await writeJiraStatus(prisma, { ok: false, message: jira.message, code: jira.code, at: now, authFailedAt: now });
      captureError(new Error(`Jira: ${jira.message} — หยุดติดตามการ์ดจนกว่าจะแก้ค่าตั้ง`), {
        level: "error",
        tag: "jira.auth",
        fingerprint: "jira:auth",
      });
    } else {
      // รอบนี้ถือว่าทำแล้ว — Jira ที่ล่มจะถูกถามอีกครั้งในรอบถัดไป ไม่ใช่ทุก 30 วินาที (429 ก็เช่นกัน)
      await writeJiraStatus(prisma, {
        ok: false,
        message: jira?.message ?? "ตรวจสถานะการ์ดไม่สำเร็จ",
        code: jira?.code ?? null,
        at: now,
        lastSyncAt: startedAt,
      });
      captureError(err, { level: "warning", tag: "jira.sync-failed", fingerprint: `jira:sync:${jira?.code ?? "error"}` });
    }
    return;
  }

  const done = config.doneStatus.toLowerCase();
  const archived = config.archiveStatus.toLowerCase();
  for (const link of links) {
    const key = link.issueKey!;
    if (!statuses.has(key)) continue;
    const current = statuses.get(key) ?? null;
    const request = link.datasetRegistrationRequest;
    const payload: JiraPayload = {
      linkId: link.id,
      requestNumber: request.requestNumber,
      issueKey: key,
      at: new Date().toISOString(),
    };

    if (current?.toLowerCase() === done) {
      // หนึ่งการ์ดคัดลอกครั้งเดียว — รอบถัดไปที่ยังเห็น Done ก่อนงานนี้เสร็จชน idempotency key แล้วข้ามไป
      await enqueueJiraOperation(prisma, request, JiraOperation.SYNC_STATUS, payload, {
        idempotencyKey: `JIRA:SYNC_STATUS:${link.id}`,
      });
      continue;
    }

    if (current === null || current.toLowerCase() === archived) {
      const outcome = current === null ? "DELETED_IN_JIRA" : "ARCHIVED_IN_JIRA";
      const { count } = await prisma.jiraIssueLink.updateMany({
        where: { id: link.id, state: JiraIssueState.OPEN },
        data: { state: JiraIssueState.ENDED, endReason: outcome, endedAt: new Date() },
      });
      if (count === 0) continue;
      await enqueueJiraOperation(
        prisma,
        request,
        JiraOperation.SYNC_STATUS,
        { ...payload, outcome },
        {
          idempotencyKey: `JIRA:SYNC_STATUS:${link.id}`,
          status: IntegrationStatus.SUCCEEDED,
          completedAt: new Date(),
          message:
            current === null
              ? "การ์ดถูกลบใน Jira — ระบบเลิกติดตาม ไม่ได้คัดลอก comment"
              : `การ์ดถูกย้ายไป ${config.archiveStatus} ใน Jira — ระบบเลิกติดตาม ไม่ได้คัดลอก comment`,
        },
      );
    }
  }
  await writeJiraStatus(prisma, { lastSyncAt: startedAt, ok: true, message: null, code: null, at: new Date().toISOString() });
}

