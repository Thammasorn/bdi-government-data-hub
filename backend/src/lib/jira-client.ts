/**
 * ตัวเรียก Jira Cloud REST API v3 — ไฟล์เดียวที่รู้จัก URL และรูปข้อมูลของ Jira (การ์ด "[Enhance] JIRA integration" 2026-11-08)
 *
 * ตัวอย่างการเรียกที่ BDI ให้มาอยู่ใน `assets/jira/` (Postman collection "JIRA d2share" + `example_get_d2s.py`) — basic auth ด้วย
 * อีเมล + API token ทุกคำสั่งมีเพดาน 20 วินาที (`AbortSignal.timeout`) worker จึงไม่ค้างกับ Jira ที่ไม่ตอบ
 *
 * error ทุกแบบกลายเป็น `JiraError` ที่มี `kind` บอกว่าผู้เรียกควรทำอะไร:
 *   RETRY      ลองใหม่ภายหลัง — Jira ไม่ตอบ, 5xx
 *   RATE_LIMIT รอตาม Retry-After ของ Jira แล้วทำต่อ (429) — เพดานของ Jira Cloud: developer.atlassian.com/cloud/jira/platform/rate-limiting/
 *   AUTH       token/สิทธิ์ใช้ไม่ได้ (401/403) — ลองซ้ำไม่มีประโยชน์จนกว่าผู้ดูแลระบบจะแก้ค่าตั้ง
 *   PERMANENT  คำสั่งนี้ไม่มีวันผ่าน (400/404, ไม่พบสถานะ) — เลิกทำงานนี้
 * `message` เป็นภาษาไทยสำหรับหน้าบันทึกการทำงาน ไม่มี token และไม่ยกเนื้อคำขอมา
 */
import type { JiraConfig } from "./jira-config.js";

const TIMEOUT_MS = 20_000;

export type JiraErrorKind = "RETRY" | "RATE_LIMIT" | "AUTH" | "PERMANENT";

export class JiraError extends Error {
  constructor(
    readonly kind: JiraErrorKind,
    /** สั้น ๆ สำหรับ `last_error_code` — HTTP status หรือชื่อสาเหตุ */
    readonly code: string,
    message: string,
    readonly retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = "JiraError";
  }
}

/** เนื้อเอกสารแบบ Atlassian Document Format — รูปที่ v3 ใช้กับ description และ comment */
export interface AdfDoc {
  type: "doc";
  version: 1;
  content: unknown[];
}

interface Credentials {
  domain: string;
  email: string;
  token: string;
}

export function credentialsOf(config: Pick<JiraConfig, "domain" | "email" | "token">): Credentials {
  if (!config.domain || !config.email || !config.token) {
    throw new JiraError("AUTH", "NOT_CONFIGURED", "ยังตั้งค่าการเชื่อมต่อ Jira ไม่ครบ (domain, อีเมล หรือ API token)");
  }
  return { domain: config.domain.replace(/\/+$/, ""), email: config.email, token: config.token };
}

/** ข้อความ error ที่ Jira ส่งมา — `errorMessages` + `errors` รวมเป็นบรรทัดเดียว ตัดความยาว */
function jiraMessage(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const b = body as { errorMessages?: unknown; errors?: unknown; message?: unknown };
  const parts: string[] = [];
  if (Array.isArray(b.errorMessages)) parts.push(...b.errorMessages.filter((m): m is string => typeof m === "string"));
  if (b.errors && typeof b.errors === "object") {
    for (const [k, v] of Object.entries(b.errors as Record<string, unknown>)) parts.push(`${k}: ${String(v)}`);
  }
  if (typeof b.message === "string") parts.push(b.message);
  return parts.join(" · ").slice(0, 300);
}

function retryAfterMs(res: Response): number {
  const header = res.headers.get("retry-after");
  const seconds = header ? Number(header) : NaN;
  // ไม่มี header หรืออ่านไม่ได้ → รอหนึ่งนาที (Jira ไม่รับประกันว่าจะส่ง header นี้ทุกครั้ง)
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 3600) * 1000 : 60_000;
}

async function call<T>(
  creds: Credentials,
  method: "GET" | "POST" | "PUT",
  path: string,
  body?: unknown,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${creds.domain}${path}`, {
      method,
      headers: {
        Authorization: `Basic ${Buffer.from(`${creds.email}:${creds.token}`).toString("base64")}`,
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const timeout = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    throw new JiraError(
      "RETRY",
      timeout ? "TIMEOUT" : "NETWORK",
      timeout ? "Jira ไม่ตอบภายใน 20 วินาที" : "เชื่อมต่อ Jira ไม่ได้ (ตรวจ domain หรือเครือข่าย)",
    );
  }

  /**
   * token ผิดไม่ได้ได้ 401 เสมอ — Jira ทำคำสั่งต่อในฐานะผู้ไม่ได้เข้าสู่ระบบ แล้วตอบตามนั้น (สร้างการ์ดได้ 400 "ไม่มี project นี้หรือไม่มีสิทธิ์"
   * ค้นผู้ใช้ได้รายการว่าง) ซึ่งจะถูกอ่านเป็นความผิดของคำสั่งแทนที่จะเป็นของ token สิ่งเดียวที่บอกได้คือ header นี้ ซึ่ง Jira ใส่ในทุกคำตอบ
   * ของการเข้าสู่ระบบที่ล้ม (พบตอนทดสอบ 2026-11-08: `x-seraph-loginreason: AUTHENTICATED_FAILED` บนคำตอบ 400)
   */
  const loginReason = res.headers.get("x-seraph-loginreason") ?? "";
  if (/AUTHENTICATED_FAILED|AUTHENTICATION_DENIED/i.test(loginReason)) {
    throw new JiraError("AUTH", "401", "token ไม่ถูกต้องหรือหมดอายุ — Jira ไม่รับการเข้าสู่ระบบ");
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  if (res.ok) return parsed as T;

  const detail = jiraMessage(parsed);
  const suffix = detail ? ` — ${detail}` : "";
  if (res.status === 401) {
    throw new JiraError("AUTH", "401", "token ไม่ถูกต้องหรือหมดอายุ (401)");
  }
  if (res.status === 403) {
    throw new JiraError("AUTH", "403", `บัญชี Jira ไม่มีสิทธิ์ทำรายการนี้ (403)${suffix}`);
  }
  if (res.status === 429) {
    throw new JiraError("RATE_LIMIT", "429", "Jira ขอให้รอ (429)", retryAfterMs(res));
  }
  if (res.status >= 500) {
    throw new JiraError("RETRY", String(res.status), `Jira ขัดข้อง (${res.status})${suffix}`);
  }
  if (res.status === 404) {
    throw new JiraError("PERMANENT", "404", `ไม่พบใน Jira (404)${suffix}`);
  }
  throw new JiraError("PERMANENT", String(res.status), `Jira ปฏิเสธคำสั่ง (${res.status})${suffix}`);
}

// ------------------------------------------------------------------ คำสั่ง

export async function getMyself(creds: Credentials) {
  return call<{ accountId: string; displayName: string; emailAddress?: string }>(creds, "GET", "/rest/api/3/myself");
}

export async function getProject(creds: Credentials, projectKey: string) {
  return call<{ id: string; key: string; name: string }>(
    creds,
    "GET",
    `/rest/api/3/project/${encodeURIComponent(projectKey)}`,
  );
}

/** ชื่อสถานะทั้งหมดของ project — ปุ่มทดสอบใช้ตรวจว่าสถานะ Done / Archived ที่ตั้งไว้มีอยู่จริง */
export async function getProjectStatusNames(creds: Credentials, projectKey: string): Promise<string[]> {
  const types = await call<Array<{ statuses: Array<{ name: string }> }>>(
    creds,
    "GET",
    `/rest/api/3/project/${encodeURIComponent(projectKey)}/statuses`,
  );
  return [...new Set(types.flatMap((t) => t.statuses.map((s) => s.name)))];
}

/**
 * ผู้ใช้ Jira ที่อีเมลตรงกับผู้เชี่ยวชาญ และมอบหมายงานใน project นี้ได้ — null เมื่อไม่พบ หรือพบมากกว่าหนึ่งคน
 *
 * ใช้ `user/assignable/search` ของ project ไม่ใช่ `user/search`: ทดสอบกับบัญชี jira-vela เมื่อ 2026-11-08 แล้ว `user/search` และ
 * `user/picker` ค้นจากอีเมลไม่เจอใครเลย (ต้องมีสิทธิ์ระดับ site ที่บัญชีนี้ไม่มี) ขณะที่ `assignable/search` เจอ และยังตอบตรงกับสิ่งที่ต้องการ
 * กว่า — คนที่ไม่อยู่ใน project ก็รับการ์ดไม่ได้อยู่ดี Jira ซ่อน `emailAddress` ตามการตั้งค่าความเป็นส่วนตัวของแต่ละคน จึงรับผลที่ไม่มี
 * อีเมลกำกับเมื่อเหลือคนเดียว ผลที่มีอีเมลแต่ไม่ตรงถูกตัดทิ้ง
 */
export async function findUserByEmail(creds: Credentials, email: string, projectKey: string): Promise<string | null> {
  const users = await call<Array<{ accountId: string; accountType?: string; emailAddress?: string; active?: boolean }>>(
    creds,
    "GET",
    `/rest/api/3/user/assignable/search?project=${encodeURIComponent(projectKey)}&query=${encodeURIComponent(email)}&maxResults=10`,
  );
  const wanted = email.toLowerCase();
  const candidates = users.filter(
    (u) =>
      u.accountType !== "app" &&
      u.active !== false &&
      (!u.emailAddress || u.emailAddress.toLowerCase() === wanted),
  );
  const exact = candidates.filter((u) => u.emailAddress?.toLowerCase() === wanted);
  if (exact.length === 1) return exact[0]!.accountId;
  return candidates.length === 1 ? candidates[0]!.accountId : null;
}

export async function createIssue(
  creds: Credentials,
  input: { projectKey: string; summary: string; description: AdfDoc; assigneeAccountId: string | null },
): Promise<{ id: string; key: string }> {
  return call<{ id: string; key: string }>(creds, "POST", "/rest/api/3/issue", {
    fields: {
      project: { key: input.projectKey },
      issuetype: { name: "Task" },
      summary: input.summary.slice(0, 254),
      description: input.description,
      ...(input.assigneeAccountId ? { assignee: { accountId: input.assigneeAccountId } } : {}),
    },
  });
}

export async function assignIssue(creds: Credentials, issueKey: string, accountId: string | null): Promise<void> {
  await call(creds, "PUT", `/rest/api/3/issue/${encodeURIComponent(issueKey)}/assignee`, { accountId });
}

export async function addComment(creds: Credentials, issueKey: string, body: AdfDoc): Promise<void> {
  await call(creds, "POST", `/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment`, { body });
}

export async function getIssueStatus(creds: Credentials, issueKey: string): Promise<string> {
  const issue = await call<{ fields: { status: { name: string } } }>(
    creds,
    "GET",
    `/rest/api/3/issue/${encodeURIComponent(issueKey)}?fields=status`,
  );
  return issue.fields.status.name;
}

/**
 * ย้ายการ์ดไปสถานะชื่อนี้ — การ์ดที่อยู่ในสถานะนั้นแล้วนับว่าสำเร็จ (งานที่ถูกลองซ้ำหลังสำเร็จไปแล้วครั้งหนึ่งต้องไม่ล้ม)
 */
export async function transitionTo(creds: Credentials, issueKey: string, statusName: string): Promise<void> {
  const current = await getIssueStatus(creds, issueKey);
  if (current.toLowerCase() === statusName.toLowerCase()) return;
  const { transitions } = await call<{ transitions: Array<{ id: string; name: string; to?: { name: string } }> }>(
    creds,
    "GET",
    `/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`,
  );
  const wanted = statusName.toLowerCase();
  const transition =
    transitions.find((t) => t.to?.name.toLowerCase() === wanted) ?? transitions.find((t) => t.name.toLowerCase() === wanted);
  if (!transition) {
    throw new JiraError(
      "PERMANENT",
      "NO_TRANSITION",
      `ย้ายการ์ดจาก "${current}" ไป "${statusName}" ไม่ได้ — ไม่มีเส้นทางนี้ใน workflow (ตรวจชื่อสถานะในหน้าตั้งค่า)`,
    );
  }
  await call(creds, "POST", `/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`, {
    transition: { id: transition.id },
  });
}

/**
 * สถานะปัจจุบันของการ์ดหลายใบในคำสั่งเดียว — หนึ่งรอบของตัวติดตามคือคำสั่งนี้หนึ่งครั้งต่อ 100 ใบ ไม่ถามทีละใบ
 *
 * JQL `key in (...)` ล้มทั้งคำสั่งถ้ามีเลขการ์ดสักใบที่ไม่มีอยู่แล้ว (มีคนลบการ์ดใน Jira) — กรณีนั้นถอยไปถามทีละใบ
 * ใบที่ได้ 404 ตอบเป็น `null` ให้ผู้เรียกตัดสิน
 */
export async function issueStatuses(creds: Credentials, keys: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  for (let i = 0; i < keys.length; i += 100) {
    const batch = keys.slice(i, i + 100);
    try {
      const res = await call<{ issues: Array<{ key: string; fields: { status: { name: string } } }> }>(
        creds,
        "POST",
        "/rest/api/3/search/jql",
        { jql: `key in (${batch.join(",")})`, fields: ["status"], maxResults: 100 },
      );
      for (const issue of res.issues) out.set(issue.key, issue.fields.status.name);
      // ใบที่ไม่อยู่ในผลค้น (ถูกย้าย project หรือไม่มีสิทธิ์เห็น) — ไม่ใส่ลงผล ผู้เรียกถือว่ายังไม่เปลี่ยน
    } catch (err) {
      if (!(err instanceof JiraError) || err.kind !== "PERMANENT") throw err;
      for (const key of batch) {
        try {
          out.set(key, await getIssueStatus(creds, key));
        } catch (inner) {
          if (inner instanceof JiraError && inner.code === "404") out.set(key, null);
          else throw inner;
        }
      }
    }
  }
  return out;
}

export interface JiraComment {
  id: string;
  author: string;
  authorAccountId: string | null;
  created: string;
  body: unknown;
}

/** comment ทั้งหมดของการ์ด เรียงจากเก่าไปใหม่ */
export async function getComments(creds: Credentials, issueKey: string): Promise<JiraComment[]> {
  const out: JiraComment[] = [];
  for (let startAt = 0; startAt < 5000; ) {
    const page = await call<{
      total: number;
      comments: Array<{ id: string; created: string; body: unknown; author?: { displayName?: string; accountId?: string } }>;
    }>(
      creds,
      "GET",
      `/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment?orderBy=created&startAt=${startAt}&maxResults=100`,
    );
    for (const c of page.comments) {
      out.push({
        id: c.id,
        author: c.author?.displayName ?? "ไม่ทราบชื่อ",
        authorAccountId: c.author?.accountId ?? null,
        created: c.created,
        body: c.body,
      });
    }
    startAt += page.comments.length;
    if (page.comments.length === 0 || startAt >= page.total) break;
  }
  return out;
}

// --------------------------------------------------------------- ADF ⇄ ข้อความ

/** ข้อความหลายบรรทัด → ADF หนึ่งย่อหน้าต่อบรรทัด บรรทัดที่เป็น URL ล้วนกลายเป็นลิงก์ */
export function adfFromLines(lines: string[]): AdfDoc {
  return {
    type: "doc",
    version: 1,
    content: lines.map((line) => {
      if (line === "") return { type: "paragraph", content: [] };
      const url = /^https?:\/\/\S+$/.test(line);
      return {
        type: "paragraph",
        content: [url ? { type: "text", text: line, marks: [{ type: "link", attrs: { href: line } }] } : { type: "text", text: line }],
      };
    }),
  };
}

/**
 * ADF → ข้อความธรรมดา สำหรับไทม์ไลน์ (เก็บเป็นข้อความใน `review_task.result_comment`)
 *
 * รูป ไฟล์แนบ และสื่ออื่นไม่ถูกคัดลอก — `hasMedia` บอกผู้เรียกให้เขียน "มีไฟล์แนบ — ดูใน Jira"
 */
export function adfToText(doc: unknown): { text: string; hasMedia: boolean } {
  let hasMedia = false;
  const walk = (node: unknown): string => {
    if (!node || typeof node !== "object") return "";
    const n = node as { type?: string; text?: string; attrs?: Record<string, unknown>; content?: unknown[] };
    const inner = () => (n.content ?? []).map(walk).join("");
    switch (n.type) {
      case "text":
        return n.text ?? "";
      case "hardBreak":
        return "\n";
      case "mention":
        return String(n.attrs?.text ?? "");
      case "emoji":
        return String(n.attrs?.text ?? n.attrs?.shortName ?? "");
      case "inlineCard":
      case "blockCard":
        return String(n.attrs?.url ?? "");
      case "media":
      case "mediaSingle":
      case "mediaGroup":
      case "mediaInline":
        hasMedia = true;
        return "";
      case "paragraph":
      case "heading":
      case "codeBlock":
      case "blockquote":
      case "panel":
        return `${inner()}\n`;
      case "listItem":
        return `• ${inner().trim()}\n`;
      default:
        return inner();
    }
  };
  const text = walk(doc)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text, hasMedia };
}
