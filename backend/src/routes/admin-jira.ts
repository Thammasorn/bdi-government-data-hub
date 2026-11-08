/**
 * ค่าตั้งและบันทึกการทำงานของ Jira — `/api/admin/settings/jira` (หน้า /console → ตั้งค่าระบบ → Jira)
 * การ์ด "[Enhance] JIRA integration" (2026-11-08)
 *
 *   GET  /                       ค่าตั้ง (ไม่มี token) + สถานะการเชื่อมต่อ + จำนวนงานที่ล้ม/รอ
 *   PUT  /                       บันทึกค่าตั้ง — token ส่งเฉพาะตอนพิมพ์ใหม่ บันทึก credential ใหม่แล้วงานที่ค้างเพราะ token กลับเข้าคิวเอง
 *   POST /test                   ทดสอบการเชื่อมต่อด้วยค่าที่บันทึกไว้ หรือค่าที่ยังไม่บันทึกจากฟอร์ม
 *   GET  /operations             บันทึกการทำงานกับ Jira ย้อนหลัง 30 วัน (?status=failed|pending|all)
 *   POST /operations/:id/retry   ส่งงานที่ล้มอีกครั้ง
 *
 * ผู้ดูแลระบบเท่านั้น (`requireAdmin`) ติดตั้งก่อน `/api/admin/settings` ใน index.ts เพราะ `PUT /:key` ของ router นั้นจะกิน `/jira` ไป
 *
 * บันทึกการทำงานนี้ไม่ใช่ audit log — มันคือแถวของ `integration.integration_operation` (คิว + ผลของการเรียกระบบภายนอก ซึ่ง sheet กำหนด
 * ตารางนี้ไว้ให้ Jira อยู่แล้ว) ไม่มีข้อมูลส่วนบุคคลนอกจากเลขคำขอและเลขการ์ด กติกา "audit ไม่ขึ้นหน้าจอ" จึงไม่เกี่ยว
 */
import { IntegrationStatus, IntegrationType, Prisma } from "@prisma/client";
import { z } from "zod";

import { prisma } from "../db.js";
import { Router } from "../lib/async-route.js";
import { AuditAction, AuditSubject, logAudit } from "../lib/audit.js";
import { adminActorId } from "../lib/context.js";
import { getMyself, getProject, getProjectStatusNames, JiraError } from "../lib/jira-client.js";
import {
  JIRA_CONFIG_KEY,
  isJiraUsable,
  normaliseDomain,
  publicJiraConfig,
  readJiraConfig,
  readJiraStatus,
  saveJiraConfig,
  writeJiraStatus,
  type JiraConfig,
} from "../lib/jira-config.js";
import { JIRA_OPERATION_LABELS, issueUrl, type JiraOperation, type JiraPayload } from "../lib/jira.js";
import { formatZodError } from "../lib/validation.js";
import { fullNameTh } from "../lib/person-name.js";
import { readSystemSetting } from "../lib/system-settings.js";
import { requireAdmin } from "../middleware/auth.js";

export const adminJiraRouter = Router();
adminJiraRouter.use(requireAdmin);

const LOG_DAYS = 30;

const optionalText = (max: number) => z.string().trim().max(max);

const configSchema = z
  .object({
    enabled: z.boolean(),
    domain: optionalText(255).refine((v) => v === "" || /^https:\/\/[^\s/]+\/?$/.test(v), {
      message: "ต้องเป็น https://<ชื่อ>.atlassian.net",
    }),
    email: optionalText(255).refine((v) => v === "" || z.string().email().safeParse(v).success, {
      message: "รูปแบบอีเมลไม่ถูกต้อง",
    }),
    token: z.string().trim().min(1, "กรุณากรอก API token").max(2000),
    projectKey: optionalText(64).refine((v) => v === "" || /^[A-Za-z][A-Za-z0-9_]*$/.test(v), {
      message: "Project key มีได้เฉพาะตัวอักษรอังกฤษ ตัวเลข และ _ เช่น D2S",
    }),
    doneStatus: optionalText(64).min(1, "กรุณากรอกชื่อสถานะ"),
    archiveStatus: optionalText(64).min(1, "กรุณากรอกชื่อสถานะ"),
  })
  .partial()
  .strict();

/** สิ่งที่ยังขาดก่อนเปิดการเชื่อมต่อได้ — ข้อความต่อช่อง ใช้ทั้งตอนบันทึกและตอนทดสอบ */
function missingFields(c: Pick<JiraConfig, "domain" | "email" | "projectKey"> & { hasToken: boolean }) {
  const fields: Record<string, string> = {};
  if (!c.domain) fields.domain = "กรุณากรอก Jira domain";
  if (!c.email) fields.email = "กรุณากรอกอีเมลบัญชี Jira";
  if (!c.hasToken) fields.token = "กรุณากรอก API token";
  if (!c.projectKey) fields.projectKey = "กรุณากรอก Project key";
  return fields;
}

async function pendingCounts() {
  const since = new Date(Date.now() - LOG_DAYS * 24 * 60 * 60_000);
  const [failed, pending] = await Promise.all([
    prisma.integrationOperation.count({
      where: { integrationType: IntegrationType.JIRA, status: IntegrationStatus.DEAD_LETTER, createdAt: { gte: since } },
    }),
    prisma.integrationOperation.count({
      where: {
        integrationType: IntegrationType.JIRA,
        status: { in: [IntegrationStatus.PENDING, IntegrationStatus.FAILED, IntegrationStatus.PROCESSING] },
      },
    }),
  ]);
  return { failed, pending };
}

async function snapshot() {
  const [config, status, syncIntervalSeconds, counts] = await Promise.all([
    readJiraConfig(prisma),
    readJiraStatus(prisma),
    readSystemSetting(prisma, "jira_sync_interval_seconds"),
    pendingCounts(),
  ]);
  const authBlocked =
    Boolean(status.authFailedAt) &&
    (!config.credentialsChangedAt || config.credentialsChangedAt <= new Date(status.authFailedAt!));
  const updatedByName = config.updatedBy
    ? fullNameTh(
        await prisma.userAccount.findUnique({
          where: { id: config.updatedBy },
          select: { prefixTh: true, firstnameTh: true, lastnameTh: true },
        }),
      ) || null
    : null;
  return {
    config: { ...publicJiraConfig(config), updatedBy: updatedByName },
    status: {
      ...status,
      /** ส่งงานไม่ได้จนกว่าจะแก้ token — หน้าจอแสดงเป็นบรรทัดสีแดง */
      authBlocked,
      usable: isJiraUsable(config),
    },
    syncIntervalSeconds,
    counts,
  };
}

/** งานที่ล้มเพราะ token/สิทธิ์กลับเข้าคิว — เรียกเมื่อ credential เปลี่ยน หรือทดสอบค่าที่บันทึกไว้แล้วผ่าน */
async function requeueAuthFailures(): Promise<number> {
  const { count } = await prisma.integrationOperation.updateMany({
    where: {
      integrationType: IntegrationType.JIRA,
      status: IntegrationStatus.DEAD_LETTER,
      lastErrorCode: { startsWith: "AUTH" },
    },
    data: { status: IntegrationStatus.PENDING, nextRetryAt: null, processingAt: null, scheduledAt: new Date() },
  });
  await writeJiraStatus(prisma, { authFailedAt: null });
  return count;
}

adminJiraRouter.get("/", async (_req, res) => {
  res.json(await snapshot());
});

adminJiraRouter.put("/", async (req, res) => {
  const parsed = configSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "validation", fields: formatZodError(parsed.error) });
    return;
  }
  const patch = parsed.data;

  const current = await readJiraConfig(prisma);
  const merged = {
    enabled: patch.enabled ?? current.enabled,
    domain: patch.domain !== undefined ? normaliseDomain(patch.domain) : current.domain,
    email: patch.email ?? current.email,
    projectKey: patch.projectKey ?? current.projectKey,
    hasToken: patch.token !== undefined || current.token !== null,
  };
  if (merged.enabled) {
    const fields = missingFields(merged);
    if (Object.keys(fields).length > 0) {
      res.status(400).json({
        error: "validation",
        message: "เปิดการเชื่อมต่อได้เมื่อกรอกค่าครบทุกช่อง",
        fields,
      });
      return;
    }
    if (patch.token === undefined && current.tokenUnreadable) {
      res.status(400).json({
        error: "validation",
        message: "API token ที่เก็บไว้อ่านไม่ได้แล้ว (กุญแจของเซิร์ฟเวอร์เปลี่ยน) กรุณากรอกใหม่",
        fields: { token: "กรุณากรอก API token ใหม่" },
      });
      return;
    }
  }

  const saved = await saveJiraConfig(prisma, patch, adminActorId());
  let requeued = 0;
  if (saved.credentialsChanged) requeued = await requeueAuthFailures();

  if (saved.changed.length > 0) {
    await logAudit({
      action: AuditAction.SYSTEM_SETTING_UPDATED,
      subjectType: AuditSubject.SYSTEM_SETTING,
      before: saved.before,
      after: saved.after,
      metadata: { key: JIRA_CONFIG_KEY, fields_changed: saved.changed, requeued_operations: requeued },
    });
  }

  const enabledNow = saved.after.enabled;
  res.json({
    ...(await snapshot()),
    message: !enabledNow
      ? "บันทึกแล้ว — ปิดการเชื่อมต่อ Jira อยู่ ระบบไม่สร้างการ์ด"
      : requeued > 0
        ? `บันทึกแล้ว — ส่งงานที่ค้างอยู่ ${requeued} รายการอีกครั้ง`
        : "บันทึกแล้ว",
  });
});

const testSchema = configSchema.omit({ enabled: true });

interface TestStep {
  label: string;
  ok: boolean;
  detail: string | null;
}

adminJiraRouter.post("/test", async (req, res) => {
  const parsed = testSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "validation", fields: formatZodError(parsed.error) });
    return;
  }
  const o = parsed.data;
  const saved = await readJiraConfig(prisma);
  const config = {
    domain: o.domain !== undefined ? normaliseDomain(o.domain) : saved.domain,
    email: o.email ?? saved.email,
    token: o.token ?? saved.token,
    projectKey: o.projectKey ?? saved.projectKey,
    doneStatus: o.doneStatus ?? saved.doneStatus,
    archiveStatus: o.archiveStatus ?? saved.archiveStatus,
  };
  const usesSaved = Object.keys(o).length === 0;

  const fields = missingFields({ ...config, hasToken: Boolean(config.token) });
  if (Object.keys(fields).length > 0) {
    res.status(400).json({ error: "validation", message: "กรอกค่าให้ครบก่อนทดสอบ", fields });
    return;
  }
  const creds = { domain: config.domain, email: config.email, token: config.token! };
  const steps: TestStep[] = [];
  const fail = (err: unknown) => (err instanceof JiraError ? err.message : "เกิดข้อผิดพลาดระหว่างทดสอบ");

  try {
    const me = await getMyself(creds);
    steps.push({ label: "เข้าสู่ระบบ Jira", ok: true, detail: me.displayName });
  } catch (err) {
    steps.push({ label: "เข้าสู่ระบบ Jira", ok: false, detail: fail(err) });
  }
  if (steps.every((s) => s.ok)) {
    try {
      const project = await getProject(creds, config.projectKey);
      steps.push({ label: "Project", ok: true, detail: `${project.name} (${project.key})` });
    } catch (err) {
      steps.push({ label: "Project", ok: false, detail: fail(err) });
    }
  }
  if (steps.every((s) => s.ok)) {
    try {
      const names = await getProjectStatusNames(creds, config.projectKey);
      const has = (n: string) => names.some((x) => x.toLowerCase() === n.toLowerCase());
      steps.push({
        label: `สถานะ "${config.doneStatus}"`,
        ok: has(config.doneStatus),
        detail: has(config.doneStatus) ? null : `ไม่มีใน project — สถานะที่มี: ${names.join(", ")}`,
      });
      steps.push({
        label: `สถานะ "${config.archiveStatus}"`,
        ok: has(config.archiveStatus),
        detail: has(config.archiveStatus) ? null : `ไม่มีใน project — สถานะที่มี: ${names.join(", ")}`,
      });
    } catch (err) {
      steps.push({ label: "สถานะของ project", ok: false, detail: fail(err) });
    }
  }

  const ok = steps.every((s) => s.ok);
  let requeued = 0;
  // ทดสอบค่าที่บันทึกไว้จริงแล้วผ่าน = ปัญหา token ที่เคยเจอหายแล้ว (เช่น ผู้ดูแลบัญชี Jira คืนสิทธิ์ให้) งานที่ค้างเดินต่อได้
  if (usesSaved) {
    const now = new Date().toISOString();
    if (ok) {
      const status = await readJiraStatus(prisma);
      if (status.authFailedAt) requeued = await requeueAuthFailures();
      await writeJiraStatus(prisma, { ok: true, message: null, code: null, at: now });
    } else {
      await writeJiraStatus(prisma, { ok: false, message: steps.find((s) => !s.ok)?.detail ?? null, at: now });
    }
  }
  res.json({ ok, steps, requeued, usesSaved });
});

const listSchema = z.object({
  status: z.enum(["failed", "pending", "all"]).default("all"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

const STATUS_FILTER: Record<"failed" | "pending" | "all", Prisma.IntegrationOperationWhereInput> = {
  failed: { status: IntegrationStatus.DEAD_LETTER },
  pending: { status: { in: [IntegrationStatus.PENDING, IntegrationStatus.FAILED, IntegrationStatus.PROCESSING] } },
  all: {},
};

adminJiraRouter.get("/operations", async (req, res) => {
  const parsed = listSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "validation", fields: formatZodError(parsed.error) });
    return;
  }
  const { status, page, pageSize } = parsed.data;
  const where: Prisma.IntegrationOperationWhereInput = {
    integrationType: IntegrationType.JIRA,
    createdAt: { gte: new Date(Date.now() - LOG_DAYS * 24 * 60 * 60_000) },
    ...STATUS_FILTER[status],
  };
  const [total, rows, config] = await Promise.all([
    prisma.integrationOperation.count({ where }),
    prisma.integrationOperation.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    readJiraConfig(prisma),
  ]);
  // คำขอที่ยังอยู่ — เลขคำขอของใบที่ถูกลบไปแล้วแสดงได้ (มาจาก payload) แต่ไม่มีลิงก์
  const existing = new Set(
    (
      await prisma.datasetRegistrationRequest.findMany({
        where: { id: { in: [...new Set(rows.map((r) => r.subjectId))] } },
        select: { id: true },
      })
    ).map((r) => r.id),
  );

  res.json({
    total,
    page,
    pageSize,
    operations: rows.map((r) => {
      const payload = (r.requestPayloadJson ?? {}) as Partial<JiraPayload>;
      const issueKey = r.externalReference ?? payload.issueKey ?? null;
      return {
        id: r.id,
        createdAt: r.createdAt,
        lastAttemptAt: r.lastAttemptAt,
        nextRetryAt: r.nextRetryAt,
        operation: r.operation,
        operationLabel: JIRA_OPERATION_LABELS[r.operation as JiraOperation] ?? r.operation,
        requestId: existing.has(r.subjectId) ? r.subjectId : null,
        requestNumber: payload.requestNumber ?? null,
        issueKey,
        issueUrl: issueKey && config.domain ? issueUrl(config.domain, issueKey) : null,
        status: r.status,
        attemptCount: r.attemptCount,
        errorCode: r.lastErrorCode,
        message: r.lastErrorMessage,
        retryable: r.status === IntegrationStatus.DEAD_LETTER || r.status === IntegrationStatus.FAILED,
      };
    }),
  });
});

adminJiraRouter.post("/operations/:id/retry", async (req, res) => {
  const id = String(req.params.id ?? "");
  if (!z.string().uuid().safeParse(id).success) {
    res.status(404).json({ error: "not_found", message: "ไม่พบงานนี้" });
    return;
  }
  const { count } = await prisma.integrationOperation.updateMany({
    where: {
      id,
      integrationType: IntegrationType.JIRA,
      status: { in: [IntegrationStatus.DEAD_LETTER, IntegrationStatus.FAILED] },
    },
    // scheduled_at = ตอนนี้ — ช่วง 24 ชั่วโมงของการลองซ้ำเริ่มนับใหม่จากการกดครั้งนี้
    data: { status: IntegrationStatus.PENDING, nextRetryAt: null, processingAt: null, scheduledAt: new Date() },
  });
  if (count === 0) {
    res.status(409).json({ error: "not_retryable", message: "งานนี้ไม่ได้อยู่ในสถานะที่ลองใหม่ได้ (อาจสำเร็จหรือกำลังส่งอยู่แล้ว)" });
    return;
  }
  // ผู้ดูแลระบบสั่งเองว่าให้ลอง — ถ้าระบบหยุดเพราะ token อยู่ ให้ลองอีกครั้ง ล้มอีกก็หยุดอีก
  await writeJiraStatus(prisma, { authFailedAt: null });
  res.json({ message: "ส่งงานเข้าคิวแล้ว ระบบจะลองภายในไม่กี่วินาที" });
});
