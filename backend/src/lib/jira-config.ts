/**
 * ค่าตั้งการเชื่อมต่อ Jira — /console → ตั้งค่าระบบ → Jira (การ์ด "[Enhance] JIRA integration" 2026-11-08)
 *
 * เก็บเป็นแถวเดียวใน `administration.system_setting` (key `jira_config`, ค่าเป็น JSON) ไม่ใช่ใน `SYSTEM_SETTINGS` ของ
 * `lib/system-settings.ts` ซึ่งรองรับแค่จำนวนเต็มในช่วง — ค่านี้มีหลายช่องและมีความลับ จึงมี route ของตัวเอง
 * (`routes/admin-jira.ts`) ช่วงตรวจสถานะการ์ด (`jira_sync_interval_seconds`) เป็นจำนวนเต็มธรรมดา จึงอยู่ใน `SYSTEM_SETTINGS`
 *
 * **API token ไม่เคยถูกเก็บหรือส่งออกเป็นข้อความเปล่า** — เข้ารหัส AES-256-GCM ด้วยกุญแจที่ derive จาก
 * `ACTIVATION_KEY_SECRET` (HKDF, info แยกของตัวเอง) ไม่เพิ่ม env ตัวใหม่ที่ต้องจำตั้งตอน deploy ผลข้างเคียงที่ยอมรับ: ถ้าเปลี่ยน
 * `ACTIVATION_KEY_SECRET` token ที่เก็บไว้ถอดไม่ได้ ระบบรายงานว่า "token ใช้ไม่ได้" และผู้ดูแลระบบกรอกใหม่ — คำเชิญที่ค้างก็ใช้ไม่ได้
 * ด้วยเหตุเดียวกันอยู่แล้ว API ตอบเพียง `tokenSet: true/false`
 *
 * อ่านจากฐานข้อมูลทุกครั้ง ไม่มี cache — API กับ worker เป็นคนละ process และค่าที่แก้ต้องมีผลรอบถัดไป
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

import type { Prisma, PrismaClient } from "@prisma/client";

import { env } from "../env.js";
import { SYSTEM_USER_ID } from "./system.js";

type Db = PrismaClient | Prisma.TransactionClient;

export const JIRA_CONFIG_KEY = "jira_config";
export const JIRA_STATUS_KEY = "jira_status";

/** สิ่งที่เก็บในแถว — token อยู่ในรูปเข้ารหัสเท่านั้น */
interface StoredJiraConfig {
  enabled: boolean;
  domain: string;
  email: string;
  tokenCipher: string | null;
  projectKey: string;
  doneStatus: string;
  archiveStatus: string;
  /** เวลาที่ domain / อีเมล / token เปลี่ยนครั้งล่าสุด — งานที่ค้างเพราะ token ใช้ไม่ได้ก่อนเวลานี้ถูกส่งใหม่ */
  credentialsChangedAt: string | null;
}

/** ค่าที่ผู้ใช้ภายใน backend ได้ — token ถอดแล้ว (null = ไม่ได้ตั้ง หรือถอดไม่ได้) */
export interface JiraConfig {
  enabled: boolean;
  domain: string;
  email: string;
  token: string | null;
  /** มี token เก็บไว้แต่ถอดไม่ได้ — ACTIVATION_KEY_SECRET ถูกเปลี่ยน */
  tokenUnreadable: boolean;
  projectKey: string;
  doneStatus: string;
  archiveStatus: string;
  credentialsChangedAt: Date | null;
  updatedAt: Date | null;
  updatedBy: string | null;
}

const DEFAULTS: StoredJiraConfig = {
  enabled: false,
  domain: "",
  email: "",
  tokenCipher: null,
  projectKey: "",
  /** ชื่อสถานะใน workflow ของ project D2share — production ที่ตั้ง Jira ใหม่อาจตั้งชื่ออื่น จึงแก้ได้ */
  doneStatus: "Done",
  archiveStatus: "Archived",
  credentialsChangedAt: null,
};

const key = (): Buffer =>
  Buffer.from(hkdfSync("sha256", env.auth.activationKeySecret, "bdi-jira", "jira-api-token", 32));

export function encryptToken(token: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), body.toString("base64")].join(":");
}

function decryptToken(stored: string): string | null {
  try {
    const [version, iv, tag, body] = stored.split(":");
    if (version !== "v1" || !iv || !tag || !body) return null;
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(body, "base64")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

function asStored(value: unknown): StoredJiraConfig {
  const v = (value && typeof value === "object" ? value : {}) as Partial<StoredJiraConfig>;
  return {
    enabled: typeof v.enabled === "boolean" ? v.enabled : DEFAULTS.enabled,
    domain: typeof v.domain === "string" ? v.domain : DEFAULTS.domain,
    email: typeof v.email === "string" ? v.email : DEFAULTS.email,
    tokenCipher: typeof v.tokenCipher === "string" ? v.tokenCipher : null,
    projectKey: typeof v.projectKey === "string" ? v.projectKey : DEFAULTS.projectKey,
    doneStatus: typeof v.doneStatus === "string" && v.doneStatus ? v.doneStatus : DEFAULTS.doneStatus,
    archiveStatus: typeof v.archiveStatus === "string" && v.archiveStatus ? v.archiveStatus : DEFAULTS.archiveStatus,
    credentialsChangedAt: typeof v.credentialsChangedAt === "string" ? v.credentialsChangedAt : null,
  };
}

export async function readJiraConfig(db: Db): Promise<JiraConfig> {
  const row = await db.systemSetting.findUnique({ where: { key: JIRA_CONFIG_KEY } });
  const stored = asStored(row?.value);
  const token = stored.tokenCipher ? decryptToken(stored.tokenCipher) : null;
  return {
    enabled: stored.enabled,
    domain: stored.domain,
    email: stored.email,
    token,
    tokenUnreadable: Boolean(stored.tokenCipher) && token === null,
    projectKey: stored.projectKey,
    doneStatus: stored.doneStatus,
    archiveStatus: stored.archiveStatus,
    credentialsChangedAt: stored.credentialsChangedAt ? new Date(stored.credentialsChangedAt) : null,
    updatedAt: row?.updatedAt ?? null,
    updatedBy: row ? row.updatedBy : null,
  };
}

/** ตั้งครบพอจะเรียก Jira ได้ไหม (ไม่ได้บอกว่าเรียกแล้วผ่าน) */
export function isJiraUsable(config: JiraConfig): boolean {
  return config.enabled && Boolean(config.domain && config.email && config.token && config.projectKey);
}

/** สิ่งที่ส่งให้หน้าจอ — ไม่มี token ในรูปใด ๆ */
export function publicJiraConfig(config: JiraConfig) {
  return {
    enabled: config.enabled,
    domain: config.domain,
    email: config.email,
    tokenSet: config.token !== null || config.tokenUnreadable,
    tokenUnreadable: config.tokenUnreadable,
    projectKey: config.projectKey,
    doneStatus: config.doneStatus,
    archiveStatus: config.archiveStatus,
    updatedAt: config.updatedAt,
    updatedBy: config.updatedBy,
  };
}

export interface JiraConfigPatch {
  enabled?: boolean;
  domain?: string;
  email?: string;
  /** undefined = คงค่าเดิม — หน้าจอไม่เคยได้ค่าเดิมไป จึงส่งเฉพาะตอนผู้ดูแลระบบพิมพ์ใหม่ */
  token?: string;
  projectKey?: string;
  doneStatus?: string;
  archiveStatus?: string;
}

/** `https://x.atlassian.net/` → `https://x.atlassian.net` — ทุกที่ต่อ path ด้วย `/rest/...` */
export function normaliseDomain(domain: string): string {
  return domain.trim().replace(/\/+$/, "");
}

/**
 * รวมค่าที่ส่งมากับค่าเดิมแล้วเขียน — คืนว่าช่องไหนเปลี่ยน (ใช้เขียน audit โดยไม่มี token) และ credential เปลี่ยนไหม
 */
export async function saveJiraConfig(db: Db, patch: JiraConfigPatch, actorId: string) {
  const row = await db.systemSetting.findUnique({ where: { key: JIRA_CONFIG_KEY } });
  const before = asStored(row?.value);
  const next: StoredJiraConfig = {
    ...before,
    ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
    ...(patch.domain !== undefined ? { domain: normaliseDomain(patch.domain) } : {}),
    ...(patch.email !== undefined ? { email: patch.email.trim() } : {}),
    ...(patch.projectKey !== undefined ? { projectKey: patch.projectKey.trim() } : {}),
    ...(patch.doneStatus !== undefined ? { doneStatus: patch.doneStatus.trim() } : {}),
    ...(patch.archiveStatus !== undefined ? { archiveStatus: patch.archiveStatus.trim() } : {}),
    ...(patch.token !== undefined ? { tokenCipher: encryptToken(patch.token.trim()) } : {}),
  };

  const changed: string[] = [];
  for (const field of ["enabled", "domain", "email", "projectKey", "doneStatus", "archiveStatus"] as const) {
    if (before[field] !== next[field]) changed.push(field);
  }
  if (patch.token !== undefined) changed.push("token");

  const credentialsChanged = changed.some((f) => f === "domain" || f === "email" || f === "token");
  if (credentialsChanged) next.credentialsChangedAt = new Date().toISOString();

  await db.systemSetting.upsert({
    where: { key: JIRA_CONFIG_KEY },
    create: { key: JIRA_CONFIG_KEY, value: next as unknown as Prisma.InputJsonValue, updatedBy: actorId },
    update: { value: next as unknown as Prisma.InputJsonValue, updatedBy: actorId },
  });

  /** ค่าที่ audit เก็บได้ — ไม่มี token */
  const auditable = (c: StoredJiraConfig) => ({
    enabled: c.enabled,
    domain: c.domain,
    email: c.email,
    projectKey: c.projectKey,
    doneStatus: c.doneStatus,
    archiveStatus: c.archiveStatus,
    tokenSet: Boolean(c.tokenCipher),
  });
  return { changed, credentialsChanged, before: auditable(before), after: auditable(next) };
}

// ------------------------------------------------------------ สถานะการเชื่อมต่อ

/** สิ่งที่บรรทัดสถานะบนหน้าตั้งค่าแสดง — worker และปุ่มทดสอบเขียน */
export interface JiraStatus {
  ok: boolean | null;
  /** ข้อความภาษาไทยของปัญหาล่าสุด */
  message: string | null;
  code: string | null;
  at: string | null;
  /** token ใช้ไม่ได้ ณ เวลานี้ — worker หยุดเรียก Jira จนกว่า credential จะเปลี่ยน */
  authFailedAt: string | null;
  lastSyncAt: string | null;
}

const EMPTY_STATUS: JiraStatus = { ok: null, message: null, code: null, at: null, authFailedAt: null, lastSyncAt: null };

export async function readJiraStatus(db: Db): Promise<JiraStatus> {
  const row = await db.systemSetting.findUnique({ where: { key: JIRA_STATUS_KEY } });
  return { ...EMPTY_STATUS, ...((row?.value as Partial<JiraStatus> | null) ?? {}) };
}

export async function writeJiraStatus(db: Db, patch: Partial<JiraStatus>): Promise<void> {
  const current = await readJiraStatus(db);
  const value = { ...current, ...patch } as unknown as Prisma.InputJsonValue;
  await db.systemSetting.upsert({
    where: { key: JIRA_STATUS_KEY },
    create: { key: JIRA_STATUS_KEY, value, updatedBy: SYSTEM_USER_ID },
    update: { value, updatedBy: SYSTEM_USER_ID },
  });
}
