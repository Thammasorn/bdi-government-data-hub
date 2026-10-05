/**
 * บันทึกการเรียก `/api/admin*` ทุกครั้ง รวมการอ่าน — `ADMIN_API_REQUEST` ใน `activity` (`source: "http"`, plan step 8)
 *
 * ทำไมต้องมี: admin API ตอบเลขบัตรและอีเมลแบบไม่ปิดของทุกบัญชี (`GET /api/admin/users?cid=…`, `/invitations`) และ admin token
 * เคยหลุดมาแล้ว — `audit_event` บันทึกแค่การเปลี่ยนแปลง การเปิดดูไม่มีร่องรอยเลย ตัวนี้ตอบ "ใครค้นเลขบัตรนี้ผ่าน admin API"
 * และ "token ใบนี้ถูกใช้ทำอะไรบ้าง" ได้ (Postman G8: `tokenFp=`) เก็บใน Mongo อย่างเดียว ไม่ผ่าน `logAudit()` และไม่แตะ Postgres
 *
 * **ไม่มีคำขอไหนรอ Mongo:** ตัวนี้แค่ผูก listener ตอนคำขอเข้า แล้วสร้างเอกสารตอนคำตอบจบ (`finish`/`close`) วางลงคิวของ
 * lib/error-capture.ts (ชั้นที่ 1 — ทิ้งก่อนทุกอย่างของ server เอง) ซึ่งเขียนทุก 2 วินาที Mongo ล่ม admin API ก็ตอบตามปกติ
 *
 * ต้องจับ store ของ AsyncLocalStorage ไว้ตอนผูก listener (`currentContext()` ตอนเข้า) — event `finish` ของ socket วิ่งนอก
 * บริบทของคำขอ (กับดักเดียวกับ multer ใน CLAUDE.md) วัตถุเดียวกันนั้นถูกเติมระหว่างทาง: `requireAdminToken` ใส่ fingerprint
 * ของ token และ `admin-portal`, `wrap()` ใส่ route แบบแม่แบบ ตอนคำตอบจบจึงอ่านได้ครบ
 *
 * เก็บอะไร (plan §7 — ผ่าน lib/redact.ts ทั้งหมด):
 *   - route แบบแม่แบบ (`/api/admin/users/:id`) ถ้าถึง route — ส่วน mount เป็นตัวเล็กเสมอ (`wrap()` ใน lib/async-route.ts) ·
 *     path แบบรูปแบบ (`pathPattern()` — อีเมล → `:email` UUID → `:id` เลขยาว → `:n`) เสมอ ตัวพิมพ์ตามที่ผู้เรียกพิมพ์ คำขอที่
 *     token ไม่ผ่าน (401 ที่ guard) ไม่ถึง route จึงมีแค่ path
 *   - **ชื่อ**ของ query ทุกตัว (ผ่าน `requestTarget()` — ชื่อที่เป็นอีเมลในรูปใดก็ตามเหลือ `[email]`) ค่าเก็บเฉพาะห้าชื่อที่ไม่ใช่
 *     ข้อมูลบุคคล และเฉพาะเมื่อค่าเป็นค่าที่ API รับจริง (`QUERY_VALUE_SHAPES` — นอกนั้น `[other]`) — `cid` ได้แค่ key `cid#`
 *     และ `email` / `q` ที่เป็นอีเมลเต็มได้ key `email#` (`q` ที่เป็นเลขบัตร 13 หลักได้ `cid#`) ค่าจริงไม่ถูกเก็บ ค้นบางส่วนไม่ได้ key
 *   - subject จากแม่แบบของ route (`SUBJECT_BY_ROUTE`) กับ `:id` ที่ Express จับได้ (`routeId` ของบริบท — ถอด `%xx` แล้ว ไม่ใช่
 *     ท่อนของ path ดิบ) — `/users/:id` เข้า `relatedUserIds` ให้ `x-log-person` หาเจอว่าใครเปิดดู เดิมแกะ id จาก path ดิบและเทียบ
 *     route แบบสนตัวพิมพ์: `/API/Admin/Users/<id>`, `/api/admin/users/%65…` และ request target แบบเต็ม
 *     (`GET http://host/api/admin/users/<id>`) ได้อีเมลกับเลขบัตรไปครบแต่บันทึกไม่บอกว่าของใคร (ตรวจขั้น 8, 2026-10-01)
 *   - status, เวลาที่ใช้, IP และ user agent (กฎเดียวกับ `audit_event`), fingerprint ของ token ทั้งที่ผ่านและไม่ผ่าน
 *   - ไม่มี body ไม่มี header อื่น — การเปลี่ยนแปลงที่ body สั่งอยู่ใน `audit_event` แล้วพร้อม diff
 *
 * **ติดตั้งก่อนตัวอ่าน body** (index.ts): คำขอที่ body อ่านไม่ออก ใหญ่เกิน หรือ encoding ที่ไม่รู้จัก (400 `validation`, 413, 415
 * จาก `parseJsonBody`) ไม่ถึง router ของ admin เลย เดิมตัวนี้ติดตั้งหลังตัวอ่าน คำขอพวกนั้นจึงไม่มีบันทึกที่ไหนทั้งสิ้น ทั้งที่ plan
 * step 8 ว่าบันทึก "ทุก" การเรียก (ตรวจขั้น 8 แบบค้านรอบสอง, 2026-10-01) — ตอนนี้ได้บันทึกพร้อม `metadata.token_checked: false`
 * เพราะ `requireAdminToken` ไม่ได้ตรวจ token ของคำขอนั้น (`token_accepted: false` ของมันไม่ได้แปลว่า token ผิด) และไม่มีแถว
 * `ADMIN_TOKEN_REJECTED` ใน Postgres ด้วยเหตุเดียวกัน: ไม่มีใครตัดสิน token นั้น ไม่มีโค้ดของ admin วิ่งและไม่มีข้อมูลออกไป
 *
 * ไม่บันทึกคำขอที่ถึง router ของ log (`/api/admin/logs*`) — API อ่าน log บันทึกตัวเองเป็น `AUDIT_LOG_READ` อยู่แล้ว (สองบันทึก
 * ต่อการอ่านหนึ่งครั้งคือเสียงรบกวน) ตัดสินจาก**สิ่งที่ Express ทำจริง**: index.ts ติด `markLogApiRequest` ไว้ที่ mount เดียวกับ
 * router ของ log คำขอที่ถึงตรงนั้นถูกจำไว้ แล้วตอนคำตอบจบจึงข้าม เดิมเทียบ regex กับ `req.originalUrl` ซึ่งไม่ใช่ path ที่ Express
 * ใช้: request target แบบเต็ม (`GET http://host/api/admin/logs/activity`) หรือ `#` ต่อท้าย `/logs` ถึง router ของ log แต่ regex
 * ไม่ตรง การอ่าน log จึงได้ `ADMIN_API_REQUEST` แบบ `ANONYMOUS` ติดมาด้วย (ตรวจขั้น 8, 2026-10-01) ผลที่ตามมา:
 * `/API/Admin/LOGS/x` ถึง router ของ log (Express ไม่สนตัวพิมพ์) จึงไม่ถูกบันทึกที่นี่ · `/api/admin/%6Cogs` ไม่ถึง (Express
 * ไม่ถอด `%xx` ก่อนเทียบ mount path) จึงเป็นการเรียก admin · คำขอของ log API ที่ตัวอ่าน body ปฏิเสธก็ไม่ถึง router ของ log
 * จึงถูกบันทึกที่นี่แบบ `token_checked: false` — การอ่านไม่เกิดและไม่มี `AUDIT_LOG_READ` นี่คือร่องรอยเดียวของมัน
 *
 * เพดานต่อ process (`admit`): token ที่ผ่าน ไม่เกิน 600 ต่อนาที · ไม่ผ่านหรือไม่มี token ไม่เกิน 60 ต่อนาที แถว
 * `ADMIN_TOKEN_REJECTED` ใน Postgres (throttle ของ lib/token-rejection.ts) ยังนับทุกครั้ง
 *
 * **การเรียกที่ token ไม่ผ่านกินที่ได้ไม่เกินงบไบต์ของมัน** (lib/untrusted-budget.ts — 5% ของ LOG_STORE_MAX_MB ต่ออายุ 90 วัน
 * ของมัน, lib/log-retention.ts) เพดานต่อนาทีคุมแค่ความถี่: หกสิบตัวต่อนาทีที่อยู่ได้ 400 วันคือหลายสิบ GB และใบสรุปเดิมเปิดใบใหม่
 * ไม่จำกัด (ดู `fold`) ถึงเพดานขนาดแล้วธง over_quota เคยปิดบันทึกของ token ที่ผ่านด้วย — ตอนนี้ token ที่ผ่านเก็บแม้เกินเพดาน
 * (lib/error-capture.ts `enqueueAccessRecord`) งบหมดแล้วตัวเดี่ยวพับลงใบสรุป ใบสรุปรองบ (นับต่อ ไม่ทิ้ง) ใบที่ยังรองบตอนปิด
 * process หายไปพร้อม process — แถวใน Postgres ยังนับไว้
 *
 * **token ที่ผ่านเก็บเกินเพดานได้แค่ส่วนยกเว้นของมัน** (ถัง `admin-token` ของ lib/untrusted-budget.ts — 5% ของเพดานต่ออายุ 400 วัน
 * หักเฉพาะตอนเกินเพดาน) หมดแล้วเหมือนกัน: ตัวเดี่ยวพับลงใบสรุป ใบสรุปรองบ ต่างกันที่ใบที่รองบตอนปิด process ถูกเขียนโดยไม่หักงบ
 * (`flushAdminAccessSummaries`) ร่องรอยของ token ที่ผ่านไม่มีที่อื่นให้นับ — Postgres มีแค่การเปลี่ยนแปลง ไม่มีการอ่าน
 *
 * **ที่เกินเพดาน หรือที่คิวเต็มรับไม่ได้ ไม่หายเงียบ — พับลงบันทึกสรุป** (`metadata.summary: true`, หนึ่งใบต่อชนิด token ต่อ
 * ราวหนึ่งนาที `SUMMARY_AFTER_MS`) ซึ่งเก็บ key ค้นหาของทุกตัวที่พับ (`hashKeys` `relatedUserIds` `tokenFps` รวมกัน มีเพดาน)
 * subject ที่มี id, route กับจำนวน, status กับจำนวน และ IP เดิมทิ้งทั้งใบเหลือแค่ตัวเลข `suppressed_before` บนบันทึกถัดไป:
 * คนถือ token ที่หลุดยิงของถูก ๆ ให้ครบ 600 ในนาทีเดียว แล้ว `?cid=` หรือ `/users/:id` ตามหลังได้โดยไม่เหลืออะไรให้ `x-log-cid`
 * หรือ `x-log-person` ค้นเจอ ยิงเร็วพอให้คิวเต็ม (ห้าร้อยใบใน 2 วินาที) ก็ได้ผลเดียวกันโดยไม่ต้องถึงเพดาน — ทดลองจริงทั้งสอง
 * ทาง (ตรวจขั้น 8, 2026-10-01) สรุปอยู่ชั้นเดียวกับคำเตือนในคิว (lib/error-capture.ts) คิวยังเต็มก็ถือไว้แล้วลองใหม่
 * ปิด process ก็เขียนก่อน (`flushAdminAccessSummaries` ใน shutdown ของ index.ts) สิ่งที่สรุปเสีย: เวลาทีละคำขอ (เหลือช่วง
 * `first_at`–`last_at`) correlation id และ user agent · เกินเพดานขนาด (`over_quota`) token ที่ไม่ผ่านไม่เก็บเลยทั้งตัวเดี่ยวและสรุป
 * (plan §3) token ที่ผ่านเก็บต่อภายในส่วนยกเว้นของมัน
 *
 * **ตัวที่เข้าคิวแล้วถูกเบียดออกก็พับด้วย** (`onAccessRecordEvicted` ของ lib/error-capture.ts — `evicted` ใน `/status`): ของที่ชั้นสูง
 * กว่ามาทีหลัง ซึ่งรวมบันทึกสรุปเอง ไล่ตัวเดี่ยวชั้น 1 ออกจากคิวที่เต็ม เดิมตัวนั้นหายไปเหลือแค่ตัวเลข — ตรวจขั้น 8 รอบสามเห็น
 * สรุปที่เข้าคิวตอน Mongo ล่มไล่บันทึก `?cid=` ตัวแรกออก ค้นด้วย `x-log-cid` ไม่เจอเลย สรุปที่ถูกเบียดออกกลับมารอเข้าคิวใหม่ทั้งใบ
 *
 * **ใบสรุปเต็มแล้วปิด ขึ้นใบใหม่** แทนการตัด key ทิ้ง: `hashKeys` `relatedUserIds` ใบละไม่เกิน 200 `tokenFps` 20 subject 50
 * (ขนาดที่เอกสารหนึ่งใบรับได้) การเรียกที่ key ใหม่ของมันไม่พอที่ในใบ ปิดใบนั้นให้เข้าคิวในวินาทีถัดไปแล้วเปิดใบใหม่ เดิม key
 * ที่เกินหายไป เหลือ `truncated_lists`: คนถือ token ยิงให้ครบเพดาน แล้ว `?cid=` ขยะสองร้อยตัวก่อนตัวจริง ตัวจริงก็ค้นไม่เจอ (ตรวจขั้น
 * 8 รอบสาม ราว 810 คำขอในสองวินาที) ใบที่ปิดเข้าคิวในรอบถัดไปของ event loop ใบที่รอจึงสะสมเฉพาะตอนคิวรับไม่ได้ มีได้ไม่เกิน
 * 20 ใบต่อชนิด token เกินนั้นใบที่มีอยู่รับต่อแบบตัด key และบอกใน `truncated_lists` — เหลือเป็นความเสี่ยงที่ยอมรับ: ต้องยิง
 * การเรียกที่ key ไม่ซ้ำเกินสี่พันตัวระหว่างที่คิวเต็ม (Mongo ล่ม) **เฉพาะ token ที่ผ่าน** — ใบของ token ที่ไม่ผ่านไม่ปิดเพราะเต็ม
 * (`fold`)
 */
import { randomUUID } from "node:crypto";

import { ActivationKeyStatus, OrganizationStatus, UserAccountStatus } from "@prisma/client";
import type { NextFunction, Request, Response } from "express";

import { env } from "../env.js";
import { SCHEMA_VERSION, fitDocument, hashKeyOf, isTrustedAccess, type ActivityDoc } from "./activity-shape.js";
import { storedUserAgent } from "./audit.js";
import { tokenFingerprint } from "./auth.js";
import { currentContext, referenceOf, type RequestContext } from "./context.js";
import { enqueueAccessRecord, onAccessRecordEvicted } from "./error-capture.js";
import { maskCidText, requestTarget } from "./redact.js";
import { ROLE_CODES } from "./system.js";
import { pathPattern } from "./token-rejection.js";

/** รหัสของบันทึก — ไม่อยู่ใน `AuditAction` เพราะไม่เคยลง `audit_event` (category อยู่ใน lib/activity-shape.ts) */
export const ADMIN_API_REQUEST = "ADMIN_API_REQUEST";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * subject ของบันทึกตามแม่แบบของ route — `:id` ที่ Express จับได้และเป็น UUID คือ id ของ subject ที่เหลือ (รายการ, route ที่ไม่มี
 * id) เป็น `ADMIN_API` ไม่มี id ตัวแรกที่ตรงชนะ route มาจาก `wrap()` ซึ่งทำส่วน mount เป็นตัวเล็กแล้ว `/i` ที่นี่กันไว้อีกชั้น:
 * ตารางนี้ต้องไม่พลาดเพราะตัวพิมพ์ ไม่ว่าวันหนึ่งใครจะแก้ `wrap()` อย่างไร
 */
const SUBJECT_BY_ROUTE: Array<[RegExp, string]> = [
  [/^\/api\/admin\/users\/:id(?:\/|$)/i, "USER_ACCOUNT"],
  [/^\/api\/admin\/organizations\/:id(?:\/|$)/i, "ORGANIZATION"],
  [/^\/api\/admin\/invitations\/:id(?:\/|$)/i, "USER_ACTIVATION_KEY"],
  [/^\/api\/admin\/registrations\/organizations\/:id(?:\/|$)/i, "ORGANIZATION_REGISTRATION_REQUEST"],
  [/^\/api\/admin\/registrations\/datasets\/:id(?:\/|$)/i, "DATASET_REGISTRATION_REQUEST"],
  [/^\/api\/admin\/legal-documents(?:\/|$)/i, "LEGAL_DOCUMENT"],
  [/^\/api\/admin\/dataset-choices(?:\/|$)/i, "DATASET_CHOICE"],
];

/**
 * query ที่เก็บค่าได้ **เฉพาะเมื่อค่าอยู่ในรูปที่ admin API รับจริง** — สถานะ role หน่วยงาน การแบ่งหน้า ตัวอื่นเก็บแค่ชื่อ
 * ค่านอกรูปเก็บเป็น `QUERY_VALUE_OTHER` (มีค่าส่งมา แต่ไม่ใช่ค่าที่ API รู้จัก — API ตอบ 400 ไปแล้ว)
 *
 * เดิมเก็บทุกค่าของห้าชื่อนี้หลังกวาดอย่างเดียว ค่าคือข้อความที่ผู้เรียกพิมพ์เอง อีเมลที่เขียนด้วย `＠` หรือ `%2540` รอดกฎอีเมล:
 * `?status=v8.status%EF%BC%A0example.go.th` เก็บ `status: "v8.status＠example.go.th"` 400 วัน (ตรวจขั้น 8 แบบค้านรอบสอง,
 * 2026-10-01) ชุดค่าจึงมาจาก enum ตัวเดียวกับที่ route ตรวจ ไม่ใช่รูปแบบคร่าว ๆ: ข้อความตัวใหญ่ล้วนยังเป็นชื่อคนได้
 */
const QUERY_VALUE_SHAPES = new Map<string, (value: string) => boolean>([
  // `/users?status=` (UserAccountStatus) · `/invitations?status=` (ActivationKeyStatus) · `/organizations?status=`
  ["status", (value) => STATUS_VALUES.has(value)],
  ["role", (value) => ROLE_VALUES.has(value)],
  ["organizationId", (value) => UUID.test(value)],
  ["page", (value) => /^\d{1,6}$/.test(value)],
  ["pageSize", (value) => /^\d{1,6}$/.test(value)],
]);
const STATUS_VALUES = new Set<string>([
  ...Object.values(UserAccountStatus),
  ...Object.values(ActivationKeyStatus),
  ...Object.values(OrganizationStatus),
]);
const ROLE_VALUES = new Set<string>(Object.values(ROLE_CODES));
const QUERY_VALUE_OTHER = "[other]";

const PER_MINUTE_ACCEPTED = 600;
const PER_MINUTE_REJECTED = 60;

let window = { start: 0, accepted: 0, rejected: 0 };

/**
 * ตัวเลขของ process นี้ — `GET /api/admin/logs/status` แสดง (ไม่มีข้อมูลบุคคล)
 *   recorded   — เข้าคิวเป็นบันทึกเดี่ยว
 *   overCap    — เกินเพดานต่อนาที จึงพับลงบันทึกสรุป
 *   queueFull  — คิวเต็ม จึงพับลงบันทึกสรุป
 *   evicted    — เข้าคิวเป็นบันทึกเดี่ยวแล้ว (นับใน `recorded`) แต่ถูกของชั้นสูงกว่าเบียดออก จึงพับลงบันทึกสรุป
 *   overBudget — งบไบต์หมด จึงพับลงบันทึกสรุป (lib/untrusted-budget.ts): token ไม่ผ่าน (`anonymous-admin`) หรือ token ผ่านตอนเกิน
 *                เพดานขนาด (`admin-token`)
 *   summaries  — บันทึกสรุปที่เข้าคิวแล้ว (ใบที่ถูกเบียดออกแล้วกลับมารอ นับใหม่ตอนเข้าคิวอีกครั้ง)
 *   pendingInSummary — การเรียกที่รออยู่ในสรุปที่ยังไม่เข้าคิว (รวมสรุปของ token ไม่ผ่านที่รองบอยู่)
 *   notStored  — ไม่ได้เก็บที่ไหนเลย: log store เกินเพดานขนาดและ token ไม่ผ่าน (ทั้งตัวเดี่ยวและที่อยู่ในสรุป)
 */
const stats = { recorded: 0, overCap: 0, queueFull: 0, evicted: 0, overBudget: 0, summaries: 0, notStored: 0 };

export function adminAccessStats(): {
  recorded: number;
  overCap: number;
  queueFull: number;
  evicted: number;
  overBudget: number;
  summaries: number;
  pendingInSummary: number;
  notStored: number;
} {
  let pendingInSummary = 0;
  for (const list of summaries.values()) for (const summary of list) pendingInSummary += summary.count;
  return { ...stats, pendingInSummary };
}

/** คำขอที่ถึง router ของ log — ดูหัวไฟล์ WeakSet: คำขอที่จบแล้วถูกเก็บกวาดเอง ไม่ต้องลบ */
const logApiRequests = new WeakSet<Request>();

/**
 * middleware — index.ts ติดไว้ที่ mount เดียวกับ router ของ log (`app.use(LOG_API_PATH, markLogApiRequest, adminLogRouter)`)
 * คำขอที่ Express ส่งมาถึงตรงนี้คือคำขอที่ router ของ log รับไป ไม่ว่าผู้เรียกจะเขียน path แบบไหน
 */
export function markLogApiRequest(req: Request, _res: Response, next: NextFunction): void {
  logApiRequests.add(req);
  next();
}

/**
 * middleware — ติดตั้งด้วย `app.use("/api/admin", recordAdminAccess)` หลัง `correlationMiddleware` ก่อนตัวอ่าน body และ router ของ
 * admin ทุกตัว (index.ts) ไม่ throw ไม่ await ไม่เปลี่ยนคำตอบ ยังไม่รู้ตอนนี้ว่าคำขอจะถึง router ของ log ไหม — ตัดสินตอนคำตอบจบ
 */
export function recordAdminAccess(req: Request, res: Response, next: NextFunction): void {
  const ctx = currentContext();
  if (!env.logStore.enabled || !ctx) {
    next();
    return;
  }
  const provided = req.header("x-admin-token");
  let recorded = false;
  const record = () => {
    if (recorded) return;
    recorded = true;
    if (logApiRequests.has(req)) return;
    try {
      write(req, res, ctx, provided);
    } catch {
      // บันทึกการเข้าถึงหายได้ ห้ามทำให้คำตอบสะดุด — คำตอบออกไปแล้วด้วยซ้ำ
    }
  };
  res.once("finish", record);
  // ผู้เรียกตัดสายก่อนคำตอบจบ — ไม่มี finish มีแต่ close (หลัง finish ก็มี close ตามมา ซึ่ง `recorded` กันไว้)
  res.once("close", record);
  next();
}

/** นับเข้าเพดานของนาทีนี้ — false ถ้าเกิน */
function admit(accepted: boolean, now: number): boolean {
  if (now - window.start >= 60_000) window = { start: now, accepted: 0, rejected: 0 };
  if (accepted) {
    if (window.accepted >= PER_MINUTE_ACCEPTED) return false;
    window.accepted += 1;
  } else {
    if (window.rejected >= PER_MINUTE_REJECTED) return false;
    window.rejected += 1;
  }
  return true;
}

function write(req: Request, res: Response, ctx: RequestContext, provided: string | undefined): void {
  // ผ่าน guard แล้วไม่ว่าทางไหน — token หรือ session ของผู้ดูแลระบบ (requireAdmin) ทั้งสองทางอ่านเลขบัตรได้เหมือนกัน
  // จึงได้การยกเว้นเดียวกันตอนเกินเพดาน และนับเพดานต่อนาทีถังเดียวกัน
  const accepted = ctx.adminTokenFp !== null || ctx.adminVia === "SESSION";
  const doc = buildRecord(req, res, ctx, provided, accepted);
  fitDocument(doc);
  if (!admit(accepted, doc.mirroredAt.getTime())) {
    stats.overCap += 1;
    fold(doc, accepted, "over_cap");
    return;
  }
  const outcome = enqueueAccessRecord(doc);
  if (outcome === "queued") stats.recorded += 1;
  else if (outcome === "full") {
    stats.queueFull += 1;
    fold(doc, accepted, "queue_full");
  } else if (outcome === "over_budget") {
    stats.overBudget += 1;
    fold(doc, accepted, "over_budget");
  } else stats.notStored += 1;
}

function buildRecord(
  req: Request,
  res: Response,
  ctx: RequestContext,
  provided: string | undefined,
  accepted: boolean,
): ActivityDoc {
  const now = new Date();
  const finished = res.writableFinished;
  const status = finished ? res.statusCode : null;
  const route = ctx.route;
  // `requireAdminToken` ตัดสิน token นี้แล้วหรือยัง — ผ่าน (fingerprint อยู่ในบริบท) หรือไม่ผ่าน (401 มีที่มาทางเดียวใต้ /api/admin
  // คือ guard นั้น) ที่เหลือคือคำขอที่ตัวอ่าน body ปฏิเสธก่อนถึง router (หัวไฟล์ "ติดตั้งก่อนตัวอ่าน body") หรือที่ตัดสายระหว่างส่ง body
  const checked = accepted || status === 401;
  const target = requestTarget(req.originalUrl);
  const hashKey = env.logStore.hashKey;
  const hashKeys = new Set<string>();
  const query: Record<string, string> = {};
  for (const [name, raw] of Object.entries(req.query)) {
    const value = typeof raw === "string" ? raw.trim() : null;
    if (value === null) continue;
    // Map ไม่ใช่ object: ชื่อ query อย่าง `constructor` ต้องไม่ได้ฟังก์ชันของ Object.prototype มาเป็นตัวตรวจ
    const shape = QUERY_VALUE_SHAPES.get(name);
    if (shape) {
      query[name] = shape(value) ? value : QUERY_VALUE_OTHER;
      continue;
    }
    // ค่าที่ชี้ตัวคนได้ — เก็บเป็น key ค้นหาเท่านั้น ค่าที่ไม่ครบ (ค้นบางส่วน) ไม่ได้ key และไม่ถูกเก็บ
    const cidKey = name === "cid" || name === "q" ? hashKeyOf("cid", value, hashKey) : null;
    const emailKey = (name === "email" || name === "q") && EMAIL.test(value) ? hashKeyOf("email", value, hashKey) : null;
    if (cidKey && (name === "cid" || /^[\d\s-]+$/.test(value))) hashKeys.add(cidKey);
    if (emailKey) hashKeys.add(emailKey);
  }

  const viaSession = accepted && ctx.adminVia === "SESSION";
  const subject = subjectOf(route, ctx.routeId);
  const tokenFp = ctx.adminTokenFp ?? (provided ? tokenFingerprint(provided) : null);
  const organizationId =
    subject.type === "ORGANIZATION" && subject.id
      ? subject.id
      : typeof query.organizationId === "string" && UUID.test(query.organizationId)
        ? query.organizationId.toLowerCase()
        : null;

  return {
    _id: randomUUID(),
    source: "http",
    schemaVersion: SCHEMA_VERSION,
    occurredAt: new Date(ctx.startedAt),
    action: ADMIN_API_REQUEST,
    category: "admin-access",
    result: status !== null && status < 400 ? "SUCCESS" : "FAILURE",
    // admin token ไม่ผูกกับคน (CLAUDE.md, Auth) — ผู้กระทำคือ "ระบบ" แบบเดียวกับแถว audit ของเส้นทางนี้ ส่วนหน้า /console
    // มาด้วย session ผู้กระทำจึงเป็นผู้ดูแลคนนั้น (ชื่อกับ role อยู่ในแถว audit ของคำขอเดียวกัน — ที่นี่ไม่อ่านฐานข้อมูล)
    actor: viaSession
      ? { type: "USER", id: ctx.actorId, name: null, roles: [], organizationId: null }
      : { type: accepted ? "SYSTEM" : "ANONYMOUS", id: null, name: null, roles: [], organizationId: null },
    via: viaSession ? "ADMIN_SESSION" : accepted ? "ADMIN_TOKEN" : "ANONYMOUS",
    tokenFps: tokenFp ? [tokenFp] : [],
    subject,
    organizationId,
    requestNumber: null,
    gate: null,
    before: null,
    after: null,
    changedFields: [],
    reason: null,
    metadata: {
      path: pathPattern(req),
      queryKeys: target.queryKeys,
      ...(Object.keys(query).length > 0 ? { query } : {}),
      token_present: Boolean(provided),
      token_accepted: accepted && !viaSession,
      ...(viaSession ? { admin_via: "SESSION" } : {}),
      ...(checked ? {} : { token_checked: false }),
      ...(finished ? {} : { aborted: true }),
    },
    request: {
      correlationId: ctx.correlationId,
      reference: referenceOf(ctx.correlationId),
      ip: ctx.ipAddress,
      userAgent: ctx.userAgent ? maskCidText(storedUserAgent(ctx.userAgent) ?? "") : null,
      method: req.method,
      route,
      status,
      durationMs: now.getTime() - ctx.startedAt,
    },
    sourceComponent: ctx.sourceComponent,
    relatedUserIds: subject.type === "USER_ACCOUNT" && subject.id ? [subject.id] : [],
    hashKeys: [...hashKeys],
    mirroredAt: now,
  };
}

/**
 * subject จากแม่แบบของ route กับ `:id` ที่ Express จับได้ (`RequestContext.routeId` — ถอด `%xx` แล้ว) id ที่ไม่ใช่ UUID
 * (404 ของ id ผิดรูป, `:code` ของเอกสาร) ไม่ถูกเก็บ UUID ตัวใหญ่เก็บเป็นตัวเล็ก ให้ตรงกับ id ในฐานข้อมูลและ `x-log-person`
 */
function subjectOf(route: string | null, routeId: string | null): { type: string; id: string | null } {
  if (!route) return { type: "ADMIN_API", id: null };
  const match = SUBJECT_BY_ROUTE.find(([pattern]) => pattern.test(route));
  if (!match) return { type: "ADMIN_API", id: null };
  return { type: match[1], id: routeId && UUID.test(routeId) ? routeId.toLowerCase() : null };
}

// --------------------------------------------------------------------------------------------- บันทึกสรุป

/** พับอยู่นานเท่านี้แล้วเข้าคิว — หนึ่งนาทีเท่ากับหน้าต่างของเพดาน คนอ่านเห็นสรุปไม่ช้ากว่าบันทึกเดี่ยวราวหนึ่งนาที */
const SUMMARY_AFTER_MS = 60_000;
/**
 * มีใบที่เต็มแล้วปิด — เข้าคิวในรอบถัดไปของ event loop ไม่รอครบนาที ใบที่รอจึงสะสมได้ก็ต่อเมื่อคิวรับไม่ได้ (Mongo ล่ม คิวเต็ม)
 * หรืองบไบต์ไม่พอ ไม่ใช่เพราะยิงเร็วกว่าตัวจับเวลา (0 ไม่ใช่ทันที: ถูกเรียกจากกลางลูปไล่ของในคิวได้ — `onEvicted`)
 *
 * ปิดแล้วเปิดใบใหม่ได้ไม่จำกัดเฉพาะใต้เพดานขนาด ซึ่งทุกใบนับเข้าเพดานเหมือนข้อมูลอื่น เกินเพดานแล้วทุกใบหักส่วนยกเว้น `admin-token`
 * (lib/error-capture.ts `enqueueAccessRecord`) หมดแล้วใบที่ปิดรองบ ไม่เกิน `SUMMARIES_PENDING_MAX` ใบ
 */
const SUMMARY_CLOSED_MS = 0;
/** คิวยังเต็ม (Mongo ล่มนาน คิวเต็มไปด้วย error) — ลองใหม่ถี่กว่านั้น ระหว่างนี้การเรียกใหม่พับเข้าใบเดิม */
const SUMMARY_RETRY_MS = 10_000;
/** รายการค้นหา — เท่ากับเพดานที่ `fitDocument()` ยอมให้เอกสารหนึ่งใบ (SEARCH_LIST_MAX ใน lib/activity-shape.ts) */
const SUMMARY_SEARCH_MAX = 200;
const SUMMARY_TOKEN_MAX = 20;
const SUMMARY_IP_MAX = 20;
const SUMMARY_SUBJECT_MAX = 50;
/** ชนิดของ route และ status ที่แยกนับ — ที่เกินรวมเป็น `[other]` */
const SUMMARY_KINDS_MAX = 50;
const SUMMARY_OTHER = "[other]";
/**
 * ใบที่รอเข้าคิวได้ต่อชนิด token — ใบละไม่เกิน 200 key ค้นหาต่อรายการ ยี่สิบใบคือสี่พันการเรียกที่ key ไม่ซ้ำ ราว 1 MB ในหน่วยความจำ
 * เกินนี้ (คิวเต็มนานและมีคนยิงไม่หยุด) ใบสุดท้ายรับต่อแบบตัด key (`truncated_lists`) — หน่วยความจำของ process ต้องมีเพดาน
 */
const SUMMARIES_PENDING_MAX = 20;

type SummaryKind = "accepted" | "rejected";

interface Summary {
  firstAt: Date;
  lastAt: Date;
  count: number;
  overCap: number;
  queueFull: number;
  evicted: number;
  overBudget: number;
  /** มีสักคำขอที่ได้ 2xx/3xx — ข้อมูลออกไปแล้ว */
  succeeded: boolean;
  tokenFps: Set<string>;
  hashKeys: Set<string>;
  relatedUserIds: Set<string>;
  ips: Set<string>;
  subjects: Map<string, { type: string; id: string }>;
  routes: Map<string, number>;
  statuses: Map<string, number>;
  /** รายการที่เต็มเพดานแล้วมีค่าใหม่ตกไป — `x-log-*` / `tokenFp=` ค้นค่าที่ตกไปไม่เจอ */
  truncated: Set<string>;
}

/**
 * ใบที่รอเข้าคิว แยกตาม token ผ่าน (`accepted`) กับไม่ผ่าน — `via` ของสองกลุ่มต่างกัน รวมใบเดียวกันแล้ว G5 จะอ่านผิด ตัวสุดท้าย
 * ของรายการคือใบที่กำลังพับ ตัวก่อนหน้าคือใบที่เต็มแล้วหรือที่คิวยังรับไม่ได้
 */
const summaries = new Map<SummaryKind, Summary[]>();
/** ใบสรุปที่เข้าคิวไปแล้ว — ถูกเบียดออกจากคิวก่อนเขียนก็เอาใบเดิมกลับมารอ (`onEvicted`) WeakMap: เขียนแล้วก็หายไปเอง */
const queuedSummaries = new WeakMap<object, { kind: SummaryKind; summary: Summary }>();
let summaryTimer: NodeJS.Timeout | null = null;
let summaryDue = 0;

function emptySummary(at: Date): Summary {
  return {
    firstAt: at,
    lastAt: at,
    count: 0,
    overCap: 0,
    queueFull: 0,
    evicted: 0,
    overBudget: 0,
    succeeded: false,
    tokenFps: new Set(),
    hashKeys: new Set(),
    relatedUserIds: new Set(),
    ips: new Set(),
    subjects: new Map(),
    routes: new Map(),
    statuses: new Map(),
    truncated: new Set(),
  };
}

function subjectKeyOf(doc: ActivityDoc): string | null {
  return doc.subject.id ? `${doc.subject.type}:${doc.subject.id}` : null;
}

/** key ค้นหาทุกตัวของการเรียกนี้ลงใบนี้ได้ครบไหม — ไม่ได้ก็ปิดใบแล้วเปิดใหม่ ไม่ตัดทิ้ง */
function fits(summary: Summary, doc: ActivityDoc): boolean {
  const room = (set: Set<string>, values: string[], max: number) =>
    set.size + values.filter((value) => !set.has(value)).length <= max;
  const subjectKey = subjectKeyOf(doc);
  return (
    room(summary.hashKeys, doc.hashKeys, SUMMARY_SEARCH_MAX) &&
    room(summary.relatedUserIds, doc.relatedUserIds, SUMMARY_SEARCH_MAX) &&
    room(summary.tokenFps, doc.tokenFps, SUMMARY_TOKEN_MAX) &&
    (subjectKey === null || summary.subjects.has(subjectKey) || summary.subjects.size < SUMMARY_SUBJECT_MAX)
  );
}

/**
 * พับการเรียกหนึ่งครั้งลงใบสรุปของชนิด token ของมัน
 *
 * **ใบของ token ที่ไม่ผ่านไม่ปิดเพราะเต็ม** — มีใบเดียวที่รับต่อแบบตัด key (`truncated_lists`) เข้าคิวราวนาทีละใบ ใบที่เต็มแล้ว
 * ปิด-เปิดใหม่มีไว้ให้คนถือ token ที่ผ่านซ่อนการค้นจริงไว้หลังขยะไม่ได้ (หัวไฟล์ "ใบสรุปเต็มแล้วปิด") ซึ่งไม่มีความหมายกับการเรียก
 * ที่ถูกปฏิเสธ: ไม่มีข้อมูลออกไป เดิมใช้กติกาเดียวกัน คนที่ไม่มี token ยิง `?cid=` `?q=` `?email=` สุ่ม (สาม key ต่อคำขอ) หรือ
 * `x-admin-token` สุ่ม (ยี่สิบ fingerprint ต่อใบ) ได้ใบใหม่ทุกหกสิบกว่าคำขอ ใบละราว 7 KB บวก index สองร้อยรายการ ไม่มีอะไรคุมนอก
 * จากความเร็วที่ยิง (ตรวจขั้น 8-10 แบบค้าน 2026-10-01: สามพันคำขอได้แปดสิบใบ) ใบนั้นยังหักงบไบต์ของการเรียกที่ไม่มี token ด้วย
 * (`emitSummaries`, lib/untrusted-budget.ts)
 */
function fold(doc: ActivityDoc, accepted: boolean, reason: "over_cap" | "queue_full" | "evicted" | "over_budget"): void {
  const kind: SummaryKind = accepted ? "accepted" : "rejected";
  let list = summaries.get(kind);
  if (!list) {
    list = [];
    summaries.set(kind, list);
  }
  let summary = list[list.length - 1];
  let closed = false;
  if (!summary || (accepted && !fits(summary, doc) && list.length < SUMMARIES_PENDING_MAX)) {
    closed = summary !== undefined;
    summary = emptySummary(doc.occurredAt);
    list.push(summary);
  }
  summary.count += 1;
  if (reason === "over_cap") summary.overCap += 1;
  else if (reason === "queue_full") summary.queueFull += 1;
  else if (reason === "over_budget") summary.overBudget += 1;
  else summary.evicted += 1;
  if (doc.occurredAt < summary.firstAt) summary.firstAt = doc.occurredAt;
  if (doc.occurredAt > summary.lastAt) summary.lastAt = doc.occurredAt;
  if (doc.result === "SUCCESS") summary.succeeded = true;

  addCapped(summary, "tokenFps", summary.tokenFps, doc.tokenFps, SUMMARY_TOKEN_MAX);
  addCapped(summary, "hashKeys", summary.hashKeys, doc.hashKeys, SUMMARY_SEARCH_MAX);
  addCapped(summary, "relatedUserIds", summary.relatedUserIds, doc.relatedUserIds, SUMMARY_SEARCH_MAX);
  if (doc.request.ip) addCapped(summary, "ips", summary.ips, [doc.request.ip], SUMMARY_IP_MAX);
  const subjectKey = subjectKeyOf(doc);
  if (subjectKey && doc.subject.id) addSubject(summary, subjectKey, { type: doc.subject.type, id: doc.subject.id });
  const path = typeof doc.metadata?.path === "string" ? doc.metadata.path : "-";
  bump(summary.routes, `${doc.request.method ?? "-"} ${doc.request.route ?? path}`, 1);
  bump(summary.statuses, doc.request.status === null ? "aborted" : String(doc.request.status), 1);

  scheduleSummaries(closed ? SUMMARY_CLOSED_MS : SUMMARY_AFTER_MS);
}

function addCapped(summary: Summary, name: string, set: Set<string>, values: Iterable<string>, max: number): void {
  for (const value of values) {
    if (set.has(value)) continue;
    if (set.size < max) set.add(value);
    else summary.truncated.add(name);
  }
}

function addSubject(summary: Summary, key: string, subject: { type: string; id: string }): void {
  if (summary.subjects.has(key)) return;
  if (summary.subjects.size < SUMMARY_SUBJECT_MAX) summary.subjects.set(key, subject);
  else summary.truncated.add("subjects");
}

function bump(counts: Map<string, number>, key: string, by: number): void {
  const slot = counts.has(key) || counts.size < SUMMARY_KINDS_MAX ? key : SUMMARY_OTHER;
  counts.set(slot, (counts.get(slot) ?? 0) + by);
}

/** ใบสรุปที่ยังเข้าคิวไม่ได้ (หรือถูกเบียดออกมา) กลับไปรอ — หน้าใบที่กำลังพับ เต็มยี่สิบใบแล้วรวมเข้ากับใบที่เก่าที่สุด */
function putBack(kind: SummaryKind, summary: Summary): void {
  let list = summaries.get(kind);
  if (!list) {
    list = [];
    summaries.set(kind, list);
  }
  const oldest = list[0];
  if (list.length < SUMMARIES_PENDING_MAX || !oldest) {
    list.unshift(summary);
    return;
  }
  oldest.count += summary.count;
  oldest.overCap += summary.overCap;
  oldest.queueFull += summary.queueFull;
  oldest.evicted += summary.evicted;
  oldest.overBudget += summary.overBudget;
  if (summary.firstAt < oldest.firstAt) oldest.firstAt = summary.firstAt;
  if (summary.lastAt > oldest.lastAt) oldest.lastAt = summary.lastAt;
  oldest.succeeded ||= summary.succeeded;
  addCapped(oldest, "tokenFps", oldest.tokenFps, summary.tokenFps, SUMMARY_TOKEN_MAX);
  addCapped(oldest, "hashKeys", oldest.hashKeys, summary.hashKeys, SUMMARY_SEARCH_MAX);
  addCapped(oldest, "relatedUserIds", oldest.relatedUserIds, summary.relatedUserIds, SUMMARY_SEARCH_MAX);
  addCapped(oldest, "ips", oldest.ips, summary.ips, SUMMARY_IP_MAX);
  for (const [key, subject] of summary.subjects) addSubject(oldest, key, subject);
  for (const [key, count] of summary.routes) bump(oldest.routes, key, count);
  for (const [key, count] of summary.statuses) bump(oldest.statuses, key, count);
  for (const name of summary.truncated) oldest.truncated.add(name);
}

/**
 * lib/error-capture.ts ส่งบันทึกที่เข้าคิวแล้วแต่หลุดออกมากลับมาที่นี่ — ใบสรุปกลับไปรอทั้งใบ ตัวเดี่ยวพับลงสรุป ห้ามเรียก
 * `enqueueAccessRecord` ตรงนี้ (ถูกเรียกจากกลางลูปไล่ของในคิว) — แค่พับแล้วตั้งเวลา
 */
function onEvicted(raw: { _id: string } & Record<string, unknown>): void {
  const queued = queuedSummaries.get(raw);
  if (queued) {
    queuedSummaries.delete(raw);
    stats.summaries -= 1;
    putBack(queued.kind, queued.summary);
    scheduleSummaries(SUMMARY_RETRY_MS);
    return;
  }
  const doc = raw as unknown as ActivityDoc;
  stats.evicted += 1;
  fold(doc, isTrustedAccess(raw), "evicted");
}

onAccessRecordEvicted(onEvicted);

/** ตั้งเวลาเข้าคิว — มีตัวจับเวลาที่ครบช้ากว่านี้อยู่ก็เลื่อนให้เร็วขึ้น เร็วกว่าอยู่แล้วก็ปล่อยไว้ */
function scheduleSummaries(ms: number): void {
  const due = Date.now() + ms;
  if (summaryTimer) {
    if (summaryDue <= due) return;
    clearTimeout(summaryTimer);
  }
  summaryDue = due;
  summaryTimer = setTimeout(() => {
    summaryTimer = null;
    emitSummaries();
  }, ms);
  // ตัวจับเวลานี้ต้องไม่ถือ process ไว้ — ตอนปิด `flushAdminAccessSummaries()` เขียนให้แทน
  summaryTimer.unref();
}

/**
 * เข้าคิวทุกใบที่รออยู่ รวมใบที่กำลังพับ — คิวเต็มก็กลับไปรอแล้วลองใหม่ log store ปิด หรือเกินเพดานขนาดกับใบของ token ที่ไม่ผ่าน
 * ก็ทิ้ง (นับใน `notStored`)
 * หยิบทั้งหมดออกก่อนแล้วค่อยเข้าคิว: ใบสรุปที่เข้าคิวเบียดตัวเดี่ยวออกได้ ตัวนั้นพับลงใบใหม่ (`onEvicted`) ไม่ใช่ใบที่กำลังส่ง
 * ซึ่งเอกสารของมันสร้างเสร็จไปแล้ว ใบที่งบไบต์ไม่พอก็กลับไปรอ — รับการเรียกต่อ (ตัวนับเดิน key ถูกตัด) แล้วลองใหม่รอบหน้า ไม่ทิ้ง
 * ตัวนับ ระหว่างนั้นทั้งช่วงจึงเป็นใบเดียวที่ `first_at`–`last_at` กว้างขึ้น (ของ token ที่ไม่ผ่านเสมอ ของ token ที่ผ่านเฉพาะตอนเกิน
 * เพดานขนาด — รอได้ไม่เกินยี่สิบใบต่อชนิด token) · `final` = ตอนปิด process (`flushAdminAccessSummaries`)
 */
function emitSummaries(final = false): void {
  const work = [...summaries];
  summaries.clear();
  // คิวเต็มลองใหม่ถี่ (Mongo กลับมาเมื่อไรก็ได้) งบไบต์เติมช้า — ลองใหม่ตามรอบปกติ มีทั้งสองแบบก็เอาตัวที่เร็วกว่า
  let retryMs = SUMMARY_AFTER_MS;
  for (const [kind, list] of work) {
    for (const summary of list) {
      let outcome: "queued" | "full" | "over_budget" | "off" = "off";
      let doc: ActivityDoc | null = null;
      try {
        doc = summaryRecord(kind === "accepted", summary);
        fitDocument(doc);
        outcome = enqueueAccessRecord(doc, true, final);
      } catch {
        // สร้างไม่ได้ก็สร้างไม่ได้ทุกรอบ — ทิ้ง ไม่วนลองตลอดไป
      }
      if (outcome === "full" || outcome === "over_budget") {
        putBack(kind, summary);
        if (outcome === "full") retryMs = SUMMARY_RETRY_MS;
        continue;
      }
      if (outcome === "queued" && doc) {
        stats.summaries += 1;
        queuedSummaries.set(doc, { kind, summary });
      } else stats.notStored += summary.count;
    }
  }
  if (summaries.size > 0) scheduleSummaries(retryMs);
}

function summaryRecord(accepted: boolean, summary: Summary): ActivityDoc {
  const id = randomUUID();
  return {
    _id: id,
    source: "http",
    schemaVersion: SCHEMA_VERSION,
    // เวลาของการเรียกแรกที่พับ — เรียงอยู่ตรงที่เหตุการณ์เริ่ม ไม่ใช่ตอนที่สรุปเข้าคิว
    occurredAt: summary.firstAt,
    action: ADMIN_API_REQUEST,
    category: "admin-access",
    result: summary.succeeded ? "SUCCESS" : "FAILURE",
    actor: { type: accepted ? "SYSTEM" : "ANONYMOUS", id: null, name: null, roles: [], organizationId: null },
    via: accepted ? "ADMIN_TOKEN" : "ANONYMOUS",
    tokenFps: [...summary.tokenFps],
    // หลายคำขอ หลาย subject — ตัวที่มี id อยู่ใน `metadata.subjects` ผู้ใช้อยู่ใน `relatedUserIds` ด้วย
    subject: { type: "ADMIN_API", id: null },
    organizationId: null,
    requestNumber: null,
    gate: null,
    before: null,
    after: null,
    changedFields: [],
    reason: null,
    metadata: {
      summary: true,
      count: summary.count,
      over_cap: summary.overCap,
      queue_full: summary.queueFull,
      ...(summary.evicted > 0 ? { evicted: summary.evicted } : {}),
      ...(summary.overBudget > 0 ? { over_budget: summary.overBudget } : {}),
      first_at: summary.firstAt,
      last_at: summary.lastAt,
      token_accepted: accepted,
      routes: [...summary.routes].map(([route, count]) => ({ route, count })),
      statuses: [...summary.statuses].map(([status, count]) => ({ status, count })),
      subjects: [...summary.subjects.values()],
      ips: [...summary.ips],
      ...(summary.truncated.size > 0 ? { truncated_lists: [...summary.truncated] } : {}),
    },
    // ไม่ใช่คำขอเดียว — correlation id เป็นของใบสรุปเอง (ค้นด้วย trace เจอแค่ใบนี้)
    request: {
      correlationId: id,
      reference: referenceOf(id),
      ip: null,
      userAgent: null,
      method: null,
      route: null,
      status: null,
      durationMs: null,
    },
    sourceComponent: accepted ? "admin-portal" : "web-portal",
    relatedUserIds: [...summary.relatedUserIds],
    hashKeys: [...summary.hashKeys],
    mirroredAt: new Date(),
  };
}

/**
 * เข้าคิวสรุปที่ค้างอยู่ทันที — shutdown ใน index.ts เรียกก่อนเขียนคิวครั้งสุดท้าย ตัวจับเวลาของสรุปถูก `unref` ไว้ ถ้าไม่เรียก
 * การเรียกที่พับไว้ในนาทีสุดท้ายก่อน deploy หายไปกับ process · ใบของ token ที่ผ่านที่รอส่วนยกเว้นตอนเกินเพดานเข้าคิวโดยไม่หักงบ
 * (`final` ของ `enqueueAccessRecord` — ไม่เกินยี่สิบใบ) ใบของ token ที่ไม่ผ่านที่รองบยังหายไปพร้อม process เหมือนเดิม
 */
export function flushAdminAccessSummaries(): void {
  if (summaryTimer) {
    clearTimeout(summaryTimer);
    summaryTimer = null;
  }
  try {
    // ใบสรุปที่เข้าคิวเบียดตัวเดี่ยวออกได้ ตัวนั้นพับลงใบใหม่ — ส่งซ้ำอีกไม่กี่รอบให้ใบใหม่นั้นเข้าคิวด้วย
    for (let round = 0; round < 3 && summaries.size > 0; round++) emitSummaries(true);
  } catch {
    // ตอนปิด process — ไม่มีอะไรให้ทำต่อ
  }
  if (summaryTimer) {
    clearTimeout(summaryTimer);
    summaryTimer = null;
  }
}
