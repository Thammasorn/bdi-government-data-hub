/**
 * `POST /api/client-errors` — รับรายงาน error จากเบราว์เซอร์และจาก Next server ลง log store (plan §5 "Ingest", step 9)
 *
 * **ตอบ 204 เสมอ** ไม่ว่าจะรับ ไม่รับ อ่านไม่ออก หรือเกินเพดาน — ไม่มีอะไรให้ผู้ส่งเดา (endpoint นี้ไม่ต้อง login เพราะ error
 * เกิดได้ตั้งแต่หน้า login หน้า activate และ callback ของ ThaID) ไม่ audit และ**ไม่พิมพ์รายงานลง stdout** — ใครก็ยิงถี่ได้
 * บรรทัดของมันจะกลบ log ของระบบ (Next server พิมพ์บรรทัดของตัวเองอยู่แล้ว)
 *
 * ติดตั้งใน index.ts ต่อจาก `correlationMiddleware` และ**ก่อน** `express.json` ของทั้ง app — มีตัวอ่าน body ของตัวเอง
 * (`text/plain` ของ `navigator.sendBeacon` ซึ่งไม่ต้อง preflight ข้าม origin ใน checkout dev และ `application/json` ของ Next
 * server) เพดาน 16 KB ไม่ใช่ 1 MB ของ API ปกติ
 *
 * **ข้อมูลที่รับมาเชื่อไม่ได้ทั้งก้อน:**
 *   - zod แบบ strict แล้วกวาดซ้ำฝั่ง server ด้วย lib/redact.ts ทุกช่องที่เป็นข้อความ (เบราว์เซอร์กวาดมาหรือไม่ก็ตาม) path เหลือ
 *     แค่ pathname ไม่มี query (`requestTarget`)
 *   - `service: "frontend-server"` เฉพาะเมื่อ `x-report-token` ตรง `INGEST_SERVER_TOKEN` (`secretMatches`) — backend เรียกได้ตรง
 *     ไม่ผ่านหน้าเว็บ header `x-report-source` อย่างเดียวจึงพิสูจน์อะไรไม่ได้ นอกนั้นเป็น `browser` พร้อม
 *     `ingest: {verified: false, claimedService}` (proxy ของหน้าเว็บลบ `x-report-*` ของเบราว์เซอร์ทิ้งอยู่แล้ว)
 *   - รหัสอ้างอิงที่เบราว์เซอร์ส่งมา (`reference`) ลง `browser.reference` ไม่ใช่ `request.correlationId` — ใครก็อ้างรหัสของ
 *     คนอื่นได้ trace จึงแสดงมันแยกเป็น "รายงานที่อ้างรหัสนี้" (routes/admin-logs.ts)
 *   - เก็บเป็น JSON และตอบกลับเป็น JSON เท่านั้น ไม่มีอะไร render เป็น HTML
 *
 * เพดาน (ต่อ process — backend หลาย replica บน Azure ได้ราวคูณจำนวน replica): รายงานจากเบราว์เซอร์ 30 ต่อนาทีต่อ IP และ
 * 300 ต่อนาทีรวม (IP อาจเป็น proxy ตัวเดียวกัน) ของ Next server ที่ยืนยันแล้ว 120 ต่อนาที แล้ว lib/error-capture.ts เก็บ
 * ตัว event ของเบราว์เซอร์ได้อีกไม่เกิน 60 ต่อนาที (ตัวนับของ issue ยังเดิน) — รายงานที่มีรหัสอ้างอิงซึ่งเกิน 60 นั้นได้ตัวย่อแทน
 * (ไม่เกิน 240 ต่อนาที) รหัสบนจอผู้ใช้จึงหายเฉพาะเมื่อมีคนยิงเกินเพดานรวม 300 ซึ่งตรงนี้ทิ้งรายงานทุกตัวของนาทีนั้นอยู่แล้ว
 * IP ที่ใช้นับคือ `X-Forwarded-For` ตัวท้าย — ผู้เรียกเขียนเองได้ (CLAUDE.md, Traps) คนที่ตั้งใจจึงหลบเพดานต่อ IP ได้ แต่ไม่หลบ
 * เพดานรวม
 *
 * **issue ใหม่คือตัวที่ต้องคุม ไม่ใช่แค่จำนวนรายงาน:** fingerprint ของเบราว์เซอร์คือข้อความที่ผู้ส่งเขียน ข้อความไม่ซ้ำกันหนึ่งตัว
 * จึงเป็นเอกสาร `error_issues` ใหม่หนึ่งใบ lib/error-capture.ts ให้รายงานจากเบราว์เซอร์สร้าง issue ได้ไม่เกินร้อย fingerprint ต่อ
 * process ต่อชั่วโมง และไม่สร้างเลยตอนเกินเพดานขนาด (ที่เกินเดินได้แค่ตัวนับของ issue เดิม — ยกเว้น `browser:chunk-load` กับ
 * `proxy:backend_unreachable` ที่ไม่นับเข้าร้อยตัว และรายงานที่มีรหัสอ้างอิงยังเก็บตัว event ไว้ให้ G6 ค้นเจอ) worker ลบ issue เบราว์เซอร์ที่ยังเปิด
 * แต่ไม่เกิดอีก 30 วัน (lib/log-retention.ts) และอีเมลแจ้งเตือนรับ issue เบราว์เซอร์ได้ไม่เกินห้าต่อหกชั่วโมงโดยไม่มีข้อความของมัน
 * (workers/error-alerts.ts)
 */
import { createHash } from "node:crypto";

import express, { type Request, type Response } from "express";
import { z } from "zod";

import { env } from "../env.js";
import { Router } from "../lib/async-route.js";
import { currentContext } from "../lib/context.js";
import {
  captureReport,
  normalizeMessage,
  type BrowserContext,
  type ErrorLevel,
  type IngestedReport,
  type ReportMechanism,
} from "../lib/error-capture.js";
import { headlineOf, requestTarget, scrubClipped, type ScrubbedError } from "../lib/redact.js";
import { secretMatches } from "../middleware/auth.js";

export const clientErrorRouter = Router();

const BODY_LIMIT = "16kb";
const PER_IP_PER_MINUTE = 30;
const BROWSER_PER_MINUTE = 300;
const SERVER_PER_MINUTE = 120;
/** IP ที่นับพร้อมกันได้ไม่เกินนี้ — เกินแล้ว IP ใหม่ในนาทีนั้นนับรวมกันก้อนเดียว (X-Forwarded-For แต่งให้ใหม่ได้ทุกคำขอ) */
const TRACKED_IPS_MAX = 5_000;
/** รายงานที่มาช้า (502 ที่เบราว์เซอร์เก็บไว้ส่งทีหลัง) ย้อนเวลาได้ไม่เกินนี้ — เก่ากว่านั้นใช้เวลาที่รับ */
const LATE_REPORT_MAX_MS = 24 * 60 * 60_000;

const MESSAGE_MAX = 2_048;
const STACK_MAX = 16_384;
const FRAME_MAX = 1_024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_ANYWHERE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

const BROWSER_MECHANISMS = ["window", "unhandledrejection", "global-error", "proxy"] as const;
const SERVER_MECHANISMS = ["onRequestError", "unhandledRejection", "uncaughtException"] as const;

const reportSchema = z
  .object({
    mechanism: z.enum([...BROWSER_MECHANISMS, ...SERVER_MECHANISMS]),
    level: z.enum(["error", "warning"]).optional(),
    name: z.string().max(200).optional(),
    message: z.string().max(8_000).optional(),
    stack: z.string().max(32_000).optional(),
    pathname: z.string().max(2_000).optional(),
    digest: z.string().max(100).optional(),
    /** รหัสอ้างอิงที่ผู้ใช้เห็นบนจอ — 8 ตัวแรกของ correlation id (ฐานสิบหก) */
    reference: z.string().regex(/^[0-9a-f]{8}$/i).optional(),
    release: z.string().max(64).optional(),
    /** เวลาที่เกิด (รายงานที่ส่งตามมาทีหลัง) — ISO มี offset */
    at: z.iso.datetime({ offset: true }).optional(),
    lastApi: z
      .array(
        z
          .object({
            method: z.string().max(10),
            path: z.string().max(2_000),
            status: z.number().int().min(0).max(999),
            correlationId: z.string().max(64).nullable(),
          })
          .strict(),
      )
      .max(5)
      .optional(),
    /** ของ Next server (`onRequestError`) — route แบบแม่แบบ ชนิด และ method ของคำขอ */
    route: z
      .object({
        path: z.string().max(300).nullable().optional(),
        type: z.string().max(40).nullable().optional(),
        routerKind: z.string().max(40).nullable().optional(),
        method: z.string().max(10).nullable().optional(),
        requestPath: z.string().max(2_000).nullable().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

type Report = z.infer<typeof reportSchema>;

const textBody = express.text({ type: "text/plain", limit: BODY_LIMIT });
const jsonBody = express.json({ type: "application/json", limit: BODY_LIMIT });

/**
 * ตัวอ่าน body ล้ม (ใหญ่เกิน อ่านไม่ออก) ก็ 204 — ไม่ส่งต่อไปที่ตัวจัดการ error ท้าย index.ts เพราะ error ของ body-parser ถือ
 * body ดิบไว้ (CLAUDE.md, Traps: "Never print a body-parser error") และคนส่งไม่ควรได้คำตอบที่ต่างกัน
 */
clientErrorRouter.post("/", (req: Request, res: Response) => {
  const ctx = currentContext();
  const ip = ctx?.ipAddress ?? null;
  const userAgent = ctx?.userAgent ?? null;
  const done = () => {
    if (!res.headersSent) res.status(204).end();
  };
  textBody(req, res, (textError?: unknown) => {
    if (textError) return done();
    jsonBody(req, res, (jsonError?: unknown) => {
      if (jsonError) return done();
      try {
        ingest(req, ip, userAgent);
      } catch {
        // รายงานที่เก็บไม่ได้ก็แค่หายไป — ผู้ส่งได้ 204 เหมือนเดิม
      }
      done();
    });
  });
});

// --------------------------------------------------------------------------------------------- เพดาน

let minute = { start: 0, browser: 0, server: 0, perIp: new Map<string, number>() };

/** นับเข้าเพดานของนาทีนี้ — false ถ้าเกิน (รายงานนั้นไม่ถูกเก็บเลย แม้แต่ตัวนับของ issue) */
function admit(kind: "browser" | "server", ip: string | null, now: number): boolean {
  if (now - minute.start >= 60_000) minute = { start: now, browser: 0, server: 0, perIp: new Map() };
  if (kind === "server") {
    if (minute.server >= SERVER_PER_MINUTE) return false;
    minute.server += 1;
    return true;
  }
  if (minute.browser >= BROWSER_PER_MINUTE) return false;
  const key = ip && (minute.perIp.has(ip) || minute.perIp.size < TRACKED_IPS_MAX) ? ip : "(อื่น ๆ)";
  const used = minute.perIp.get(key) ?? 0;
  if (used >= PER_IP_PER_MINUTE) return false;
  minute.perIp.set(key, used + 1);
  minute.browser += 1;
  return true;
}

// --------------------------------------------------------------------------------------------- การรับ

function ingest(req: Request, ip: string | null, userAgent: string | null): void {
  let raw: unknown = req.body;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw) as unknown;
    } catch {
      return;
    }
  }
  const parsed = reportSchema.safeParse(raw);
  if (!parsed.success) return;
  const report = parsed.data;

  const token = req.header("x-report-token");
  const claimed = req.header("x-report-source");
  const verified =
    env.logStore.ingestToken !== "" &&
    typeof token === "string" &&
    claimed === "frontend-server" &&
    secretMatches(token, env.logStore.ingestToken);
  const service: IngestedReport["service"] = verified ? "frontend-server" : "browser";
  if (!admit(verified ? "server" : "browser", ip, Date.now())) return;

  const error = scrubbedError(report);
  const page = report.pathname ? pagePattern(report.pathname) : null;
  const serverRoute = verified ? (report.route ?? null) : null;
  const where = serverRoute?.path ? scrubClipped(serverRoute.path, 200) : page;
  const chunkLoad = service === "browser" && isChunkLoadReport(error);
  const level: ErrorLevel = chunkLoad ? "warning" : (report.level ?? "error");

  captureReport({
    service,
    level,
    mechanism: report.mechanism as ReportMechanism,
    fingerprint: fingerprintOf(service, report, error, where, chunkLoad),
    where,
    error,
    occurredAt: occurredAt(report.at),
    release: releaseOf(report.release),
    tag: `ingest.${report.mechanism}`,
    request: serverRoute
      ? {
          method: serverRoute.method ? scrubClipped(serverRoute.method, 10) : null,
          route: serverRoute.path ? scrubClipped(serverRoute.path, 200) : null,
          path: serverRoute.requestPath ? pagePattern(serverRoute.requestPath) : page,
          queryKeys: serverRoute.requestPath ? requestTarget(serverRoute.requestPath).queryKeys : [],
          status: null,
          durationMs: null,
          correlationId: null,
          reference: null,
          ip: null,
          userAgent: null,
          bodyShape: null,
        }
      : null,
    browser: verified ? null : browserContext(report, page),
    // digest ของ Next: ตัวเดียวกับที่หน้า global-error ได้และรายงานมาใน `browser.digest` (production ซ่อนข้อความของ error ฝั่ง
    // server จากเบราว์เซอร์ เหลือแค่ digest) — เก็บไว้ที่ event ของ Next server ด้วย ไม่งั้นรหัสบนจอผู้ใช้โยงถึงข้อความจริงได้
    // ผ่านบรรทัดใน stdout ของ Next อย่างเดียว ซึ่ง deploy ถัดไปลบทิ้ง · trace ใช้โยงสองฝั่ง (`serverErrors`, routes/admin-logs.ts)
    extra: verified && report.digest ? { digest: scrubClipped(report.digest, 100) } : null,
    ingest: {
      verified,
      claimedService: claimed ? scrubClipped(claimed, 40) : null,
      ip,
      userAgent: userAgent ? scrubClipped(userAgent, 512) : null,
    },
  });
}

/**
 * URL ในข้อความเหลือแค่ path — query และ `#…` ถูกตัดทิ้ง เหลือ `:บรรทัด:คอลัมน์` ท้ายเฟรมไว้ (ถ้ามี)
 *
 * เบราว์เซอร์ส่ง `location.pathname` อย่างเดียว (plan §7 ข้อ 2) แต่ URL เต็มของหน้ายังโผล่มาในข้อความและ stack ได้เอง: เฟรมของ
 * สคริปต์ในหน้า (`at http://…/activate?token=…:1:2`), ลิงก์ของ React (`…/errors/418?args[]=<ข้อความบนจอ>`), fetch ที่ล้ม
 * (`/api/…?cid=…`) กฎกวาดข้อความ (lib/redact.ts) ปิดได้เฉพาะชื่อที่รู้จัก (`token=` `code=` `state=`) และรูปที่รู้จัก (อีเมล
 * เลขบัตร) — `?q=ชื่อคน` หรือข้อความบนจอใน `args[]` รอด ตัดทั้ง query ปลอดภัยกว่าไล่ชื่อ ไม่มีรายงานไหนต้องใช้ค่าของ query
 * ตัดเฉพาะคำ (ช่วงที่ไม่มีช่องว่าง วงเล็บ หรือเครื่องหมายคำพูด) ที่มี `/` ก่อน `?`/`#` ตัวแรก — `ไหม?` ในประโยคไม่ถูกแตะ
 * ไล่ทีละคำ ไม่ใช่ regex ตัวเดียวที่ย้อนกลับได้: endpoint นี้ไม่ต้อง login ข้อความยาวที่มีแต่ `/` ต้องไม่กิน CPU เป็นวินาที
 */
const WORD = /[^\s"'`()<>]+/g;
const LINE_AND_COLUMN = /(?::\d{1,9}){1,2}$/;

function withoutUrlQueries(text: string): string {
  return text.replace(WORD, (word) => {
    const cut = word.search(/[?#]/);
    if (cut <= 0) return word;
    const path = word.slice(0, cut);
    if (!path.includes("/")) return word;
    return path + (LINE_AND_COLUMN.exec(word.slice(cut))?.[0] ?? "");
  });
}

/** ข้อความของรายงานในรูปเดียวกับ error ของ server (`scrubError`) — กวาดซ้ำทุกช่อง เฟรมละไม่เกิน 1 KB รวมไม่เกิน 16 KB */
function scrubbedError(report: Report): ScrubbedError {
  const name = scrubClipped(report.name?.trim() || "Error", 100);
  const message = scrubClipped(withoutUrlQueries(report.message ?? ""), MESSAGE_MAX);
  let stack: string | null = null;
  if (report.stack) {
    const lines: string[] = [];
    let length = 0;
    for (const line of report.stack.split("\n")) {
      if (length > STACK_MAX) break;
      const clean = scrubClipped(withoutUrlQueries(line), FRAME_MAX);
      lines.push(clean);
      length += clean.length + 1;
    }
    stack = lines.join("\n").slice(0, STACK_MAX);
  }
  // เฟรมของบันเดิลเบราว์เซอร์เปลี่ยนทุก build จึงไม่ใช้จัดกลุ่ม (plan §5 "Grouping") — topFrame ว่าง
  return { name, message, stack, props: {}, topFrame: null, causes: [] };
}

/**
 * รายงานจากเบราว์เซอร์นี้คือ chunk ของบันเดิลที่โหลดไม่ขึ้นไหม — deploy ใหม่ระหว่างที่หน้าเก่ายังเปิดอยู่ ไม่ใช่บั๊ก: คำเตือน
 * ใน issue เดียว `browser:chunk-load` ที่ไม่ส่งอีเมลแจ้งเตือน (plan §5, workers/error-alerts.ts) ไม่เชื่อ `level` ที่ผู้ส่งบอก
 *
 * **สองถ้อยคำ เพราะสอง bundler:** webpack (`next dev --webpack` ของ dev checkout) ข้อความ "Loading chunk 123 failed." /
 * "Loading CSS chunk …" ส่วน Turbopack (`next build` ของ production — ค่าตั้งต้นของ Next 16) ข้อความ "Failed to load chunk
 * /_next/static/chunks/<hash>.js from module 83412" (หรือ `.css`) ชื่อ `ChunkLoadError` ทั้งคู่ใน runtime ที่ Next 16.2.12
 * ใส่ลงบันเดิล (build จริง + Chrome, 2026-10-01) แต่ดูชื่ออย่างเดียวไม่พอ: runtime ของ Turbopack อีกชุดที่มากับ Next
 * (`next/dist/bundle-analyzer`) throw `Error` ชื่อ `Error` ด้วยถ้อยคำเดียวกัน และ `window` `error` ที่ไม่มี `event.error` ส่งมาแค่
 * ข้อความ ตัวที่หลุดเป็นระดับ error หนึ่ง issue ต่อ hash ต่อ build และส่งอีเมลทุก deploy ที่มีหน้าเปิดค้าง (ตรวจขั้น 9) จึงดู
 * ถ้อยคำด้วย ข้อความเดียวกันจาก Next server **ไม่ใช่**คำเตือน: server โหลด chunk ของตัวเองไม่ขึ้นคือ image เสีย จึงเช็กเฉพาะ
 * `browser` · คู่กับ `isChunkLoadError` ใน frontend/lib/report-error.ts — แก้ที่หนึ่งต้องแก้อีกที่
 */
function isChunkLoadReport(error: ScrubbedError): boolean {
  return (
    /ChunkLoadError/.test(error.name) ||
    /Loading (?:CSS )?chunk [\w-]+ failed/i.test(error.message) ||
    /Failed to load chunk\s/i.test(error.message)
  );
}

/**
 * fingerprint — ชื่อ + ข้อความที่ตัด id กับตัวเลข + หน้า (เบราว์เซอร์) หรือ route (Next server) ไม่ใช้เฟรม
 * กลุ่มที่ตั้งชื่อเอง: `browser:chunk-load` (deploy ใหม่ระหว่างที่หน้าเก่ายังเปิดอยู่ — ไม่ใช่บั๊ก), `proxy:backend_unreachable`
 * (502 ของ proxy), `frontend-server:eacces` (สิทธิ์เขียน `.next/cache` ใน image ของ production — plan §13 #5)
 */
function fingerprintOf(
  service: IngestedReport["service"],
  report: Report,
  error: ScrubbedError,
  where: string | null,
  chunkLoad: boolean,
): string {
  if (service === "browser" && report.mechanism === "proxy") return "proxy:backend_unreachable";
  if (service === "browser" && chunkLoad) return "browser:chunk-load";
  if (service === "frontend-server" && /\bEACCES\b/.test(error.message)) return "frontend-server:eacces";
  const headline = normalizeMessage(headlineOf(error.name, error.message));
  return createHash("sha1")
    .update([service, error.name, headline, where ?? report.mechanism].join("|"))
    .digest("hex");
}

/** หน้าในรูปที่จัดกลุ่มได้ — ไม่มี query/hash, กวาดแล้ว, UUID → `:id`, เลขยาวตั้งแต่ 4 หลัก → `:n` */
function pagePattern(pathname: string): string {
  const path = requestTarget(pathname.split("#")[0] ?? "").path;
  return path.replace(UUID_ANYWHERE, ":id").replace(/\d{4,}/g, ":n").slice(0, 200);
}

function browserContext(report: Report, page: string | null): BrowserContext {
  return {
    pathname: page,
    digest: report.digest ? scrubClipped(report.digest, 100) : null,
    reference: report.reference ? report.reference.toLowerCase() : null,
    release: report.release ? releaseOf(report.release) : null,
    lastApi: (report.lastApi ?? []).map((call) => ({
      method: /^[A-Z]{3,7}$/.test(call.method) ? call.method : "?",
      path: requestTarget(call.path).path,
      status: call.status,
      correlationId: call.correlationId && UUID.test(call.correlationId) ? call.correlationId.toLowerCase() : null,
    })),
  };
}

/** รุ่นที่ผู้ส่งบอก — SHA หรือชื่อสั้น ๆ เท่านั้น ที่เหลือเป็น `unknown` (ค่านี้ไปเป็น firstRelease/lastRelease ของ issue) */
function releaseOf(value: string | undefined): string {
  return value && /^[A-Za-z0-9._-]{1,64}$/.test(value) ? value : "unknown";
}

/** เวลาที่เกิดตามที่ผู้ส่งบอก ถ้าอยู่ในช่วงที่เชื่อได้ (ไม่อยู่ในอนาคต ไม่เก่ากว่าหนึ่งวัน) — ไม่งั้นเวลาที่รับ */
function occurredAt(at: string | undefined): Date {
  const now = Date.now();
  if (!at) return new Date(now);
  const claimed = Date.parse(at);
  if (Number.isNaN(claimed) || claimed > now + 60_000 || claimed < now - LATE_REPORT_MAX_MS) return new Date(now);
  return new Date(claimed);
}
