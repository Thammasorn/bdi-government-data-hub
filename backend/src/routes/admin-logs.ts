/**
 * API อ่าน log — `/api/admin/logs/*` (plan §6, decision 9 และ 19, docs/21 §3.11)
 *
 * อ่านสำเนาใน log store (MongoDB: `activity`, `error_events`, `error_issues`, `relay_state`) บวกสองตารางของ Postgres ที่
 * ผูกกับ correlation id (`notification_delivery`, `integration_operation`) ไม่มี UI — ใช้ผ่าน Postman collection แยก
 * (`docs/bdi-activity-log.postman_collection.json`) ที่ไม่แจกพร้อม admin token
 *
 * **กติกาของไฟล์นี้**
 *   - ติดตั้ง**ก่อน** `adminRouter` ใน index.ts และจบด้วย 404 ของตัวเอง — path ที่พิมพ์ผิดใต้ `/api/admin/logs` จึงไม่ตกไป
 *     ถึง `requireAdminToken` ซึ่งจะเขียน `ADMIN_TOKEN_REJECTED` ที่ชวนเข้าใจผิด proxy ของหน้าเว็บตอบ 404 ให้ทั้งก้อนนี้
 *     (frontend/app/api/[...path]/route.ts) — เรียกได้ทาง backend ตรงเท่านั้น
 *   - ทุกคำขอผ่าน `requireLogReader` (token แยก ผู้อ่าน เหตุผล) activity · timeline · trace ต้องมีเหตุผลด้วย (`requireReadReason`)
 *   - ตัวระบุบุคคล (`person` `cid` `email`) มาทาง header `x-log-*` เท่านั้น เหมือนเหตุผล — ไม่อยู่ใน URL (`SUBJECT_HEADERS`)
 *     และรับเฉพาะที่ endpoint กรองด้วยมันได้จริง (`SUBJECT_ENDPOINTS`) ที่อื่นตอบ 400 ไม่เพิกเฉยเงียบ ๆ
 *   - **ทุกการอ่านถูกบันทึกก่อนส่งข้อมูล** ลำดับในแต่ละ route: ตรวจพารามิเตอร์ → log store ตอบได้ไหม (`store()`) →
 *     แปลงตัวระบุ (Postgres — คำขอที่ถูกลบไปแล้วจาก log store) → บันทึก (`recordRead()`) → อ่าน — คำขอที่ผิดรูปหรืออ่าน
 *     ไม่ได้อยู่แล้วจึงไม่เกิดบันทึกเปล่า ๆ
 *     ผลจึงแยกตามว่าอะไรล่มก่อน: Mongo ล่มหรือค้างอยู่แล้ว (จะมี Postgres หรือไม่) = 503 `log_store_unavailable` ก่อนบันทึก
 *     เพราะไม่มีอะไรให้ส่ง · Postgres ล่มแต่ Mongo ตอบ = บันทึกลง log store แทนแล้วอ่านตามปกติ · `log_read_unrecorded`
 *     เกิดเฉพาะเมื่อ Postgres บันทึกไม่ได้**และ**การเขียนสำเนาลง Mongo ล้มหลังจากที่ `store()` ping ผ่านไปแล้ว (Mongo ล่ม
 *     ระหว่างคำขอ) ส่วน `GET /status` ไม่ถูกบันทึก (ไม่มีข้อมูลบุคคล)
 *   - ค่าที่ค้นด้วยเลขบัตรหรืออีเมล (`cid` `email` `person` ที่เป็นอีเมล) ไม่ลงบันทึกเป็นค่าจริง — เป็น key HMAC (`cidKey`
 *     `emailKey`) และ `person` ที่เป็นอีเมลของบัญชีเป็น uuid ของบัญชี (`PersonRef`) บันทึกการอ่านต้องไม่กลายเป็นที่เก็บเลขบัตร
 *     แห่งใหม่ สำเนาของบันทึกใน log store ค้นกลับด้วยค่าเดียวกันได้ (`x-log-cid: X` คู่กับ `?action=AUDIT_LOG_READ` — lib/activity-shape.ts)
 *   - ทุกคำสั่งอ่านของ Mongo มี `maxTimeMS` (READ_MAX_MS) ไม่มีอะไรที่นี่แก้ `activity` ได้ มีแค่สถานะของ issue — เหตุผลที่
 *     ลง `error_issues.statusReason` ผ่านกฎเลขบัตรของสำเนากิจกรรมก่อน (`maskCidText`)
 *   - Mongo หยุดหรือค้าง = 503 `log_store_unavailable` ภายในราว 2 วินาที (เพดานของ `store()` — STORE_CHECK_MS) Mongo ที่
 *     ค้างหลังจาก ping ผ่านแล้ว คำขอนั้นรอได้ถึง socketTimeoutMS 5 วินาทีของ driver (`maxTimeMS` ไม่ช่วย: server ที่ค้างไม่ได้
 *     นับเวลาให้) แล้วจึงได้ 503 เดียวกันจาก `storeRoute()` · ปิด log store = 503 `log_store_disabled`
 *   - Postgres ล่มหรือค้าง: ทุกคำสั่งของ Postgres ที่คำขอรอมีเพดาน (`withDatabaseDeadline()` ใน db.ts — 2 วินาที,
 *     0.3 วินาทีเมื่อเพิ่งติดต่อไม่ได้) บันทึกการอ่านไปลง log store แทน ตัวระบุที่ต้องแปลง (อีเมล เลขที่คำขอ รหัสหน่วยงาน)
 *     ตอบ 503 `database_unavailable` ส่วน Postgres ของ trace เป็น `postgres: "unavailable"` · PATCH ของ issue เขียนแถว
 *     `ERROR_ISSUE_STATUS_CHANGED` ภายในเพดานเดียวกัน (`logAudit(…, { deadline: true })`) ไม่ทันก็ไปทางสำรอง `audit_fallback`
 *
 * ข้อตกลงของรายการ (ตามรายการของ admin API): zod แบบ strict — พารามิเตอร์ที่ไม่รู้จักก็ 400 `{error:"validation", fields}`
 * · `page` เริ่ม 1 · `pageSize` 50 สูงสุด 200 · เรียง `occurredAt` ใหม่ไปเก่าแล้ว `_id` · `total` จาก `countDocuments` ตัดที่
 * 10,000 พร้อม `totalIsLowerBound`
 *
 * **เปิดหน้าถัดไปของ `/activity` ด้วย `before=<nextBefore>` ไม่ใช่ `page`** — log โตตลอดเวลา และทุกการอ่านเองก็เพิ่มแถว
 * `AUDIT_LOG_READ` ที่ relay คัดลอกขึ้นมาอยู่บนสุดในราว 2–7 วินาที ช่วงที่ไม่ระบุ `to` คิด `to` = ตอนนี้ใหม่ทุกคำขอ `page=2`
 * ที่เปิดช้ากว่านั้นจึงเห็นท้ายของหน้า 1 ซ้ำ `before` เป็นตำแหน่ง (เวลา + `_id`) ของแถวสุดท้ายที่เห็น จึงไม่ซ้ำและไม่ข้ามแถว
 * ที่มีอยู่แล้ว — แถวที่มาทีหลังซึ่งใหม่กว่าหน้าที่เห็นไปแล้วแค่ไม่แสดง **ส่ง `to` เท่ากับ `window.to` ของหน้าแรกก็ยังไม่ทำให้
 * `page` นิ่ง**: `window.to` เป็นเวลาของคำขอ แต่สำเนาตามหลังแถวของมันไม่กี่วินาที แถวที่เกิดก่อน `to` แต่ยังไม่ถูกคัดลอก
 * (ปกติคือบันทึกการอ่านครั้งก่อนของผู้อ่านเอง หรือทั้งก้อนหลัง Mongo ล่ม) จึงเข้ามาในช่วงทีหลังแล้วดันหน้าถัดไป (ตรวจแบบค้าน
 * ขั้น 7, 2026-09-30: หน้า 2–3 ซ้ำ 1–2 แถว) `page` นิ่งเฉพาะช่วงที่ไม่มีอะไรมาเพิ่มแล้ว — `to` ที่ผ่านไปเกินสองนาที (หน้าต่าง
 * tail ของ relay) ในเวลาปกติ ไม่ได้ตัด `to` ตั้งต้นให้เหลือแค่จุดที่ relay ตามทัน: สำเนา `audit_fallback` (และ `http`
 * ของขั้น 8) มาทางคิวของ backend ไม่ผ่าน relay และ relay ที่ค้างจะพาช่วงตั้งต้นค้างไปด้วย การตัดนั้นจึงยังไม่ทำให้ `page` นิ่ง
 * แต่ซ่อนแถวล่าสุดจากคนที่เพิ่งเห็น error — `before` คือทางที่นิ่ง
 */
import type { Prisma } from "@prisma/client";
import type { Request, Response } from "express";
import type { Db, Document, Filter } from "mongodb";
import { z } from "zod";

import { isDatabaseUnreachable, prisma, withDatabaseDeadline } from "../db.js";
import { env } from "../env.js";
import { adminAccessStats } from "../lib/admin-access.js";
import { hashKeyOf, type ActivityCategory, type ActivitySource, type ActivityVia } from "../lib/activity-shape.js";
import { Router } from "../lib/async-route.js";
import { AuditAction, AuditSubject, logAudit, recordLogRead } from "../lib/audit.js";
import { captureError, errorCaptureStats } from "../lib/error-capture.js";
import { MONGO_COMMAND_MAX_MS, logDb, logStoreStatus } from "../lib/log-store.js";
import { maskCidText, scrubClipped } from "../lib/redact.js";
import { requireLogReader, requireReadReason } from "../middleware/auth.js";

export const adminLogRouter = Router();

/** ที่ติดตั้ง router นี้ (index.ts) — `metadata.endpoint` ของบันทึกการอ่านประกอบจากค่านี้ ไม่ใช่จาก path ที่ผู้เรียกพิมพ์ */
export const LOG_API_PATH = "/api/admin/logs";

// --------------------------------------------------------------------------------------------- ค่าคงที่

const PAGE_SIZE_DEFAULT = 50;
const PAGE_SIZE_MAX = 200;
/** นับจำนวนไม่เกินนี้ — เกินแล้ว `totalIsLowerBound: true` และห้ามเปิดหน้าที่เริ่มเลยจากนี้ (ให้แคบตัวกรองแทน) */
const TOTAL_CAP = 10_000;
/** เพดานของทุกคำสั่งอ่านฝั่ง server — ต่ำกว่า socketTimeoutMS ของ driver โดยตั้งใจ (`MONGO_COMMAND_MAX_MS` ใน lib/log-store.ts) */
const READ_MAX_MS = MONGO_COMMAND_MAX_MS;
/**
 * เพดานของ `store()` (ต่อ + ping) — Mongo ที่หยุดตอบภายใน serverSelectionTimeoutMS 2 วินาทีอยู่แล้ว แต่ Mongo ที่ค้าง (ต่อได้
 * แต่ไม่ตอบ: `docker compose pause`, เครื่องแกว่ง) ค้าง ping ไว้จนถึง socketTimeoutMS 5 วินาที เพดานนี้ทำให้ทั้งสองกรณีตอบ 503
 * ในราว 2 วินาทีเท่ากัน ping ที่เลิกรอยังวิ่งต่อจนหมดเวลาของ driver เอง ซึ่งปิดแค่การเชื่อมต่อของมัน — pool ถูกล้างก็ต่อเมื่อ
 * monitor ของ driver รอ heartbeat เกินกำหนด (server ที่หยุดตอบคร่อมจังหวะนั้นนานกว่าราว 2 วินาที — lib/log-store.ts
 * `MONGO_COMMAND_MAX_MS`)
 */
const STORE_CHECK_MS = 2_000;
const DAY_MS = 24 * 60 * 60_000;
const WINDOW_MAX_DAYS = 366;
/** activity ที่ไม่มีตัวกรองที่แคบลง (คน คำขอ หน่วยงาน …) ดูย้อนหลังเท่านี้ถ้าไม่ระบุ from/to */
const ACTIVITY_DEFAULT_DAYS = 30;
/** timeline ของคนหรือหน่วยงานที่ไม่ระบุช่วง — ของคำขอดูทั้งชีวิตของคำขอ */
const TIMELINE_DEFAULT_DAYS = 7;
const TIMELINE_MAX_ITEMS = 500;
const TRACE_ACTIVITY_MAX = 200;
const TRACE_ERRORS_MAX = 50;
/** แถวของ Postgres ต่อชนิดใน trace — คลิกเดียวไม่ควรมีมากกว่านี้ */
const TRACE_ROWS_MAX = 50;
const TRACE_CANDIDATES_MAX = 10;
/** error ของ Next server ที่ trace หาจาก digest ของรายงาน (`serverErrors`) — ห่างจากรายงานไม่เกินนี้ และไม่เกินกี่ตัว */
const TRACE_DIGEST_WINDOW_MS = 60 * 60_000;
const TRACE_SERVER_ERRORS_MAX = 20;
const ISSUE_EVENTS_DEFAULT = 20;
const ISSUE_EVENTS_MAX = 100;
const BANGKOK_OFFSET_MS = 7 * 60 * 60_000;

const STORE_MESSAGE = "ระบบบันทึกกิจกรรมยังไม่พร้อมใช้งาน กรุณาลองใหม่อีกครั้ง";
const DATABASE_MESSAGE =
  "ฐานข้อมูลหลักไม่พร้อม จึงแปลงอีเมล เลขที่คำขอ หรือรหัสหน่วยงานเป็น id ไม่ได้ — ระหว่างนี้ค้นด้วย uuid ผ่าน actorId หรือ " +
  "subjectType+subjectId ได้ หรือลองใหม่อีกครั้ง";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_TEMPLATE = "00000000-0000-0000-0000-000000000000";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** ค่าที่ route ใช้ร่วมกับ lib/activity-shape.ts — `satisfies` ให้ typecheck จับค่าที่พิมพ์ผิด */
const CATEGORIES = [
  "auth",
  "session",
  "account",
  "role",
  "invitation",
  "organization",
  "request",
  "document",
  "review",
  "config",
  "log-access",
  "admin-access",
  "system",
  "other",
] as const satisfies readonly ActivityCategory[];
const VIAS = [
  "SESSION",
  "ADMIN_TOKEN",
  "LOG_TOKEN",
  "WORKER",
  "SCRIPT",
  "ANONYMOUS",
  "SYSTEM",
] as const satisfies readonly ActivityVia[];
const SOURCES = ["audit_event", "audit_fallback", "http"] as const satisfies readonly ActivitySource[];
const REQUEST_SUBJECTS = ["ORGANIZATION_REGISTRATION_REQUEST", "DATASET_REGISTRATION_REQUEST"];

// --------------------------------------------------------------------------------------------- พารามิเตอร์

const uuidParam = z
  .string()
  .trim()
  .regex(UUID, "ต้องเป็น UUID")
  .transform((value) => value.toLowerCase());
const isoParam = z.iso.datetime({ offset: true, error: "ต้องเป็นเวลา ISO 8601 ที่มี offset เช่น 2026-09-30T00:00:00+07:00" });
const pageParam = z.coerce.number().int("ต้องเป็นจำนวนเต็ม").min(1, "เริ่มที่ 1").default(1);
const pageSizeParam = z.coerce
  .number()
  .int("ต้องเป็นจำนวนเต็ม")
  .min(1, "อย่างน้อย 1")
  .max(PAGE_SIZE_MAX, `ไม่เกิน ${PAGE_SIZE_MAX}`)
  .default(PAGE_SIZE_DEFAULT);

/** `person` = uuid ของบัญชี หรืออีเมล (อีเมลที่มีบัญชีแปลงเป็น id ที่ server — `resolvePerson`) */
const personParam = z
  .string()
  .trim()
  .max(254, "ยาวเกิน")
  .refine((value) => UUID.test(value) || EMAIL.test(value), "ต้องเป็น UUID ของบัญชี หรืออีเมล");
/** `request` = uuid ของคำขอ หรือเลขที่คำขอ (`ORG-REG-2026-0002`, `DS-REG-2026-0010`) */
const requestParam = z
  .string()
  .trim()
  .refine((value) => UUID.test(value) || /^[A-Za-z]+(?:-[A-Za-z]+)*-\d{4}-\d{1,8}$/.test(value), "ต้องเป็น UUID หรือเลขที่คำขอ เช่น ORG-REG-2026-0002");
/** `organization` = uuid ของหน่วยงาน หรือรหัสหน่วยงาน (`organization_code`) */
const organizationParam = z
  .string()
  .trim()
  .min(1)
  .max(64, "ยาวเกิน 64 ตัว")
  .refine((value) => UUID.test(value) || /^[A-Za-z0-9._-]+$/.test(value), "ต้องเป็น UUID หรือรหัสหน่วยงาน");
/** เลขบัตร 13 หลัก — เว้นวรรคหรือขีดคั่นได้ ไม่ตรวจ checksum: สำเนาทำ key ให้ทุกเลข 13 หลักที่มันปิด รวมเลขที่พิมพ์ผิด */
const cidParam = z
  .string()
  .transform((value) => value.replace(/[\s-]/g, ""))
  .refine((value) => /^\d{13}$/.test(value), "ต้องเป็นเลขบัตร 13 หลัก");
const emailParam = z
  .string()
  .trim()
  .max(254, "ยาวเกิน")
  .refine((value) => EMAIL.test(value), "ต้องเป็นอีเมล")
  .transform((value) => value.toLowerCase());
/**
 * ตำแหน่งต่อจากหน้าก่อน = `nextBefore` ของคำตอบ (`<occurredAt ISO>,<_id>` ของแถวสุดท้ายที่เห็น) — ได้แถวที่อยู่ถัดลงไป
 * ตามลำดับ `occurredAt desc, _id desc` ดูหัวไฟล์ว่าทำไมไม่ใช้ `page`
 */
const beforeParam = z
  .string()
  .trim()
  .transform((value, ctx) => {
    const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z),([0-9A-Za-z-]{1,64})$/.exec(value);
    const at = match ? new Date(match[1]!) : null;
    if (!match || !at || Number.isNaN(at.getTime())) {
      ctx.addIssue({ code: "custom", message: "ใส่ค่า nextBefore จากคำตอบของหน้าก่อนตามที่ได้มา (<เวลา ISO>,<id>)" });
      return z.NEVER;
    }
    return { at, id: match[2]!, raw: value };
  });
/** correlation id เต็ม หรือ prefix ตั้งแต่ 8 ตัว (รหัสอ้างอิงบนข้อความ 5xx) — ขีดใส่หรือไม่ใส่ก็ได้ */
const correlationParam = z
  .string()
  .trim()
  .transform((value, ctx) => {
    const prefix = canonicalPrefix(value);
    if (prefix === null) {
      ctx.addIssue({ code: "custom", message: "ต้องเป็น correlation id หรือฐานสิบหกอย่างน้อย 8 ตัว" });
      return z.NEVER;
    }
    return prefix;
  });

const activityQuery = z
  .object({
    action: z
      .string()
      .trim()
      .regex(/^[A-Z][A-Z_]{1,63}(?:,[A-Z][A-Z_]{1,63}){0,19}$/, "รหัส action ตัวพิมพ์ใหญ่ คั่นด้วย comma ไม่เกิน 20 รหัส")
      .transform((value) => value.split(","))
      .optional(),
    category: z.enum(CATEGORIES, { error: `ต้องเป็นหนึ่งใน ${CATEGORIES.join(" ")}` }).optional(),
    result: z.enum(["SUCCESS", "FAILURE"], { error: "SUCCESS หรือ FAILURE" }).optional(),
    via: z.enum(VIAS, { error: `ต้องเป็นหนึ่งใน ${VIAS.join(" ")}` }).optional(),
    person: personParam.optional(),
    actorId: uuidParam.optional(),
    subjectType: z
      .string()
      .trim()
      .regex(/^[A-Z][A-Z_]{1,63}$/, "ชนิดของ subject ตัวพิมพ์ใหญ่ เช่น USER_ACCOUNT")
      .optional(),
    subjectId: uuidParam.optional(),
    request: requestParam.optional(),
    organization: organizationParam.optional(),
    cid: cidParam.optional(),
    email: emailParam.optional(),
    tokenFp: z.string().trim().regex(/^[0-9a-f]{12}$/, "fingerprint ฐานสิบหกตัวเล็ก 12 ตัว").optional(),
    correlationId: correlationParam.optional(),
    source: z.enum(SOURCES, { error: `ต้องเป็นหนึ่งใน ${SOURCES.join(" ")}` }).optional(),
    from: isoParam.optional(),
    to: isoParam.optional(),
    before: beforeParam.optional(),
    page: pageParam,
    pageSize: pageSizeParam,
  })
  .strict()
  .refine((q) => !q.subjectId || q.subjectType, {
    path: ["subjectType"],
    error: "ต้องระบุ subjectType คู่กับ subjectId (index ค้นด้วยทั้งคู่)",
  })
  .refine((q) => !q.before || q.page === 1, {
    path: ["page"],
    error: "ใช้ page คู่กับ before ไม่ได้ — before คือหน้าถัดไปอยู่แล้ว เอา page ออก",
  });

const timelineQuery = z
  .object({
    person: personParam.optional(),
    request: requestParam.optional(),
    organization: organizationParam.optional(),
    from: isoParam.optional(),
    to: isoParam.optional(),
  })
  .strict()
  .refine((q) => [q.person, q.request, q.organization].filter(Boolean).length === 1, {
    path: ["person"],
    error: "ต้องระบุอย่างใดอย่างหนึ่ง: header x-log-person หรือ query request หรือ organization",
  });

const noQuery = z.object({}).strict();

const issuesQuery = z
  .object({
    status: z.enum(["open", "resolved", "ignored", "all"], { error: "open resolved ignored หรือ all" }).default("open"),
    service: z
      .enum(["backend", "delivery-worker", "frontend-server", "browser"], {
        error: "backend delivery-worker frontend-server หรือ browser",
      })
      .optional(),
    level: z.enum(["fatal", "error", "warning"], { error: "fatal error หรือ warning" }).optional(),
    release: z.string().trim().min(1).max(64, "ยาวเกิน").optional(),
    since: isoParam.optional(),
    sort: z.enum(["lastSeen", "count", "firstSeen"], { error: "lastSeen count หรือ firstSeen" }).default("lastSeen"),
    page: pageParam,
    pageSize: pageSizeParam,
  })
  .strict();

const issueQuery = z
  .object({
    events: z.coerce
      .number()
      .int("ต้องเป็นจำนวนเต็ม")
      .min(0, "ไม่ติดลบ")
      .max(ISSUE_EVENTS_MAX, `ไม่เกิน ${ISSUE_EVENTS_MAX}`)
      .default(ISSUE_EVENTS_DEFAULT),
  })
  .strict();

/** fingerprint มาจาก path ที่ Express ถอด `%xx` ให้แล้ว — `prisma:P2002:POST /api/…` มีช่องว่างและ `/` ได้ */
const fingerprintParam = z
  .string()
  .min(1, "ว่าง")
  .max(300, "ยาวเกิน")
  .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), "มีอักขระควบคุม");

const issueStatusBody = z
  .object({
    status: z.enum(["open", "resolved", "ignored"], { error: "open resolved หรือ ignored" }),
    reason: z
      .string({ error: "ต้องระบุเหตุผล" })
      .trim()
      .min(10, "เหตุผลอย่างน้อย 10 ตัวอักษร")
      .max(500, "เหตุผลไม่เกิน 500 ตัวอักษร")
      // ตัวอย่างที่ยังไม่ได้แก้ (`<SHA>`) หรือตัวแปร Postman ที่ไม่มีค่า (`{{issueReason}}`) ยาวพอผ่านข้อข้างบน — การเปลี่ยน
      // สถานะที่ไม่มีเหตุผลจริงคือสิ่งที่เหตุผลบังคับไว้กัน
      .refine(
        (value) => !/<[^<>]{1,200}>|\{\{[^{}]*\}\}/.test(value),
        "เหตุผลยังมีตัวยึดตำแหน่ง (<…> หรือ {{…}}) — แทนด้วยข้อความจริง",
      ),
  })
  .strict();

// --------------------------------------------------------------------------------------------- ตัวช่วย

/**
 * ข้อผิดของ zod ในรูป `{ชื่อพารามิเตอร์: ข้อความ}` — พารามิเตอร์ที่ไม่รู้จักได้ชื่อของมันเอง ไม่ใช่ `_` ก้อนเดียว
 * (formatZodError ใน lib/validation.ts รวม unrecognized_keys ไว้ที่ path ว่าง ซึ่งไม่บอกว่าตัวไหนผิด)
 */
function fieldsOf(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    if (issue.code === "unrecognized_keys") {
      for (const key of issue.keys) fields[key] ??= "ไม่รู้จักพารามิเตอร์นี้";
      continue;
    }
    const key = issue.path.join(".") || "_";
    fields[key] ??= issue.message;
  }
  return fields;
}

function invalid(res: Response, fields: Record<string, string>) {
  res.status(400).json({ error: "validation", message: "พารามิเตอร์ไม่ถูกต้อง", fields });
}

/** `names` เปลี่ยนชื่อช่องในข้อผิด — ตัวระบุบุคคลมาทาง header ข้อผิดจึงต้องชี้ชื่อ header (`SUBJECT_HEADERS`) ไม่ใช่ชื่อใน schema */
function parse<T extends z.ZodType>(
  schema: T,
  value: unknown,
  res: Response,
  names: Readonly<Record<string, string>> = {},
): z.output<T> | null {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const fields = fieldsOf(parsed.error);
    invalid(res, Object.fromEntries(Object.entries(fields).map(([field, message]) => [names[field] ?? field, message])));
    return null;
  }
  return parsed.data;
}

/**
 * ตัวระบุบุคคลที่รับทาง **header เท่านั้น** — เลขบัตร อีเมล หรือ uuid ของคนที่ถูกสอบสวน (plan decision 9 ใช้เหตุผลเดียวกันกับ
 * `x-log-reason`: URL ไปอยู่ใน log ของ proxy และ edge ทุกชั้นระหว่างทาง และ production เรียกผ่าน `bdi-api.thammasorn.org`
 * ซึ่งผ่าน Cloudflare) · ชื่อเดียวกันใน query ถูกปฏิเสธที่ `requireLogReader` · ค่า ASCII ส่งตรง ๆ ได้ (เลขบัตร uuid อีเมล
 * ทั่วไป — `%` ในค่าถูกถอดเป็น percent-encoding) ค่าที่มีอักษรอื่นต้อง `encodeURIComponent`
 *
 * เดิมสามตัวนี้เป็น query (`?cid=` `?email=` `?person=`) ตาม plan §6 — ตรวจแบบค้านขั้น 7 (2026-09-30) ชี้ว่า G2 G4 ของ Postman
 * ส่งอีเมลและเลขบัตรไปใน URL ผ่าน Cloudflare ทั้งที่เหตุผลของการอ่านซึ่งไวน้อยกว่าถูกกันไม่ให้อยู่ใน URL แล้ว
 */
const SUBJECT_HEADERS = { person: "x-log-person", cid: "x-log-cid", email: "x-log-email" } as const;
type SubjectName = keyof typeof SUBJECT_HEADERS;

/**
 * endpoint ที่รับตัวระบุแต่ละตัว — ที่เดียวที่บอก ข้อความ 400 ทุกข้อ (header ผิดที่ และชื่อเดียวกันใน query) อ่านจากตารางนี้
 * ต้องตรงกับ `withSubjectHeaders(req, res, [...])` ของแต่ละ route: `/activity` รับทั้งสาม `/timeline` รับแค่ `person`
 * (เส้นเวลาของคนเปิดด้วยเลขบัตรหรืออีเมลที่ไม่มีบัญชีไม่ได้ — ต้องแปลงเป็นคนก่อน) endpoint อื่นไม่รับเลย
 */
const SUBJECT_ENDPOINTS: Readonly<Record<SubjectName, readonly string[]>> = {
  person: [`GET ${LOG_API_PATH}/activity`, `GET ${LOG_API_PATH}/timeline`],
  cid: [`GET ${LOG_API_PATH}/activity`],
  email: [`GET ${LOG_API_PATH}/activity`],
};

/** "ใช้ได้เฉพาะ GET …/activity และ GET …/timeline" ของตัวระบุหนึ่งตัว — ใช้ในข้อความ 400 ทุกข้อของตัวระบุ */
function whereAccepted(name: SubjectName): string {
  return `${SUBJECT_HEADERS[name]} ใช้ได้เฉพาะ ${SUBJECT_ENDPOINTS[name].join(" และ ")}`;
}

/** ชื่อใน query ที่เป็นตัวระบุบุคคล (ไม่สนตัวพิมพ์ — `?Person=` ก็นับ) */
const SUBJECT_IN_QUERY = /^(?:person|cid|email)$/i;

/**
 * ตัวระบุบุคคลใน URL → 400 ทุก endpoint (ติดตั้งต่อจาก `requireLogReader` ให้ token ผิดยังได้ 401 ก่อน) — ด้วยเหตุผลเดียวกับ
 * `x-log-reason`: URL ไปจบใน log ของ proxy และ edge ทุกชั้น และ production เรียกผ่าน Cloudflare ปฏิเสธดัง ๆ ให้คนแก้ Postman
 * ไม่ใช่ทิ้งค่าเงียบ ๆ ซึ่งได้ผลที่ไม่ได้กรอง การปฏิเสธไม่ลบ URL ที่ส่งไปแล้ว มันกันไม่ให้ใครสร้างงานบนทางนั้น
 *
 * ข้อความบอก header ที่ใช้แทน **และ endpoint ที่รับมัน** — เดิมบอกแค่ "ส่งใน header x-log-person" คนที่ส่ง `?person=` ไปที่
 * `/errors/issues` ทำตามแล้วได้ผลเต็มที่ไม่ได้กรอง (header ถูกเพิกเฉยเงียบ ๆ) ตอนนี้ endpoint นั้นตอบ 400 ด้วย
 * (`withSubjectHeaders`) แต่ข้อความที่พาไปถูกที่ตั้งแต่แรกดีกว่าข้อความที่พาไปชนอีกข้อ
 */
function refuseSubjectsInQuery(req: Request, res: Response, next: () => void) {
  const key = Object.keys(req.query).find((name) => SUBJECT_IN_QUERY.test(name));
  if (key === undefined) {
    next();
    return;
  }
  const name = key.toLowerCase() as SubjectName;
  const message =
    `ห้ามส่ง ${key} ใน URL (URL ถูกเก็บใน log ของ proxy และ edge ทุกชั้น) — ส่งใน header ${SUBJECT_HEADERS[name]} แทน ` +
    `(ค่าที่ไม่ใช่ ASCII ให้ encodeURIComponent) · ${whereAccepted(name)}`;
  res.status(400).json({ error: "validation", message, fields: { [key]: message } });
}

/** ค่าของ header ตัวระบุ — ASCII ที่พิมพ์ได้ ถอด percent-encoding แล้ว หรือ null ถ้าใช้ไม่ได้ */
function decodeSubjectHeader(raw: string): string | null {
  if (/[^\x20-\x7e]/.test(raw)) return null;
  try {
    return decodeURIComponent(raw).trim();
  } catch {
    return null;
  }
}

/**
 * query รวมกับตัวระบุบุคคลจาก header ที่ endpoint นี้รับ (`accepted`) — ตอบ 400 เองแล้วคืน null ถ้า header ถอดไม่ได้ หรือเป็นตัวที่
 * endpoint นี้ไม่รับ **รวมถึง endpoint ที่ไม่รับตัวไหนเลย** (`accepted` ว่าง — ทุก route นอกจาก `/activity` กับ `/timeline`
 * เรียกด้วย `[]`): header ที่ถูกเพิกเฉยเงียบ ๆ ทำให้ผลที่ไม่ได้กรองดูเหมือนผลที่กรองแล้ว เดิมห้า endpoint (`/errors/issues`
 * `/trace/:ref` `/activity/:id` `/errors/…` `/status`) ไม่ได้ดู header เลย ตอบเต็มโดยไม่มีอะไรบอกว่าตัวกรองไม่ได้ใช้ (ตรวจขั้น 7
 * แบบค้าน, 2026-09-30) · header ว่างส่งต่อเป็นค่าว่าง ให้ schema ตอบว่าต้องใส่อะไร (ตัวแปร Postman ที่ยังไม่ได้กรอก)
 * header ที่ Postman ปิดไว้ (`disabled`) ไม่ถูกส่ง จึงไม่ชนข้อนี้
 */
function withSubjectHeaders(req: Request, res: Response, accepted: readonly SubjectName[]): Record<string, unknown> | null {
  const input: Record<string, unknown> = { ...req.query };
  for (const name of Object.keys(SUBJECT_HEADERS) as SubjectName[]) {
    const header = SUBJECT_HEADERS[name];
    const raw = req.header(header);
    if (raw === undefined) continue;
    if (!accepted.includes(name)) {
      invalid(res, {
        [header]:
          `endpoint นี้ไม่กรองด้วย ${header} — ${whereAccepted(name)} ส่งมาที่นี่ผลจะไม่ได้กรองตามคนนั้น ` +
          "เอา header นี้ออก หรือเรียก endpoint ข้างต้นแทน",
      });
      return null;
    }
    const value = decodeSubjectHeader(raw);
    if (value === null) {
      invalid(res, { [header]: `${header} ต้องเป็น ASCII หรือค่าที่ผ่าน encodeURIComponent แล้ว` });
      return null;
    }
    input[name] = value;
  }
  return input;
}

/** endpoint ที่ไม่รับตัวระบุบุคคล — ตอบ 400 เองแล้วคืน false ถ้ามี `x-log-person` / `x-log-cid` / `x-log-email` มา */
function noSubjectHeaders(req: Request, res: Response): boolean {
  return withSubjectHeaders(req, res, []) !== null;
}

/** ค่าจาก path (`:id`, `:fingerprint`) — ข้อผิดลงชื่อพารามิเตอร์นั้น ไม่ใช่ `_` */
function parseParam<T extends z.ZodType>(schema: T, value: unknown, field: string, res: Response): z.output<T> | null {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    invalid(res, { [field]: parsed.error.issues[0]?.message ?? "ไม่ถูกต้อง" });
    return null;
  }
  return parsed.data;
}

/**
 * correlation id ในรูปมาตรฐาน (ตัวพิมพ์เล็ก ขีดตรงตำแหน่งของ UUID) จากค่าที่ใส่ขีดหรือไม่ใส่ก็ได้ — null ถ้าไม่ใช่ฐานสิบหก
 * หรือสั้นกว่า 8 ตัว คนอ่านรหัสอ้างอิงจาก toast มักพิมพ์ต่อกันโดยไม่มีขีด
 */
function canonicalPrefix(raw: string): string | null {
  const hex = raw.toLowerCase().replace(/-/g, "");
  if (!/^[0-9a-f]{8,32}$/.test(hex)) return null;
  let out = "";
  let i = 0;
  for (const slot of UUID_TEMPLATE) {
    if (i >= hex.length) break;
    if (slot === "-") out += "-";
    else out += hex[i++];
  }
  return out;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** เวลาไทยในรูป ISO พร้อม offset — ให้คนอ่านใน Postman ไม่ต้องบวกเจ็ดชั่วโมงเอง */
function bangkok(value: unknown): string | null {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return null;
  return new Date(value.getTime() + BANGKOK_OFFSET_MS).toISOString().replace("Z", "+07:00");
}

function activityDto(doc: Document): Document {
  const { _id, ...rest } = doc;
  return { id: _id, ...rest, occurredAtBangkok: bangkok(doc.occurredAt) };
}

function errorEventDto(doc: Document): Document {
  const { _id, ...rest } = doc;
  return { id: _id, ...rest, occurredAtBangkok: bangkok(doc.occurredAt) };
}

function issueDto(doc: Document): Document {
  const { _id, ...rest } = doc;
  return { fingerprint: _id, ...rest, lastSeenBangkok: bangkok(doc.lastSeen) };
}

/** error event ย่อสำหรับ timeline — ตัวเต็มเปิดด้วย `GET /errors/events/:id` */
const ERROR_SUMMARY_PROJECTION = {
  _id: 1,
  occurredAt: 1,
  fingerprint: 1,
  level: 1,
  service: 1,
  tag: 1,
  "error.name": 1,
  "error.message": 1,
  "request.method": 1,
  "request.route": 1,
  "request.status": 1,
  "request.correlationId": 1,
  "request.reference": 1,
  "actor.id": 1,
} as const;

function errorSummary(doc: Document): Document {
  const error = (doc.error ?? {}) as Document;
  const request = (doc.request ?? null) as Document | null;
  return {
    id: doc._id,
    occurredAt: doc.occurredAt,
    occurredAtBangkok: bangkok(doc.occurredAt),
    fingerprint: doc.fingerprint,
    level: doc.level,
    service: doc.service,
    tag: doc.tag ?? null,
    name: error.name ?? null,
    message: error.message ?? null,
    request,
    actorId: (doc.actor as Document | null)?.id ?? null,
  };
}

/** error ของ driver Mongo (ต่อไม่ได้ หมดเวลา pool ถูกล้าง server ปฏิเสธคำสั่ง) — แยกจาก error ของ Prisma และของโค้ดเรา */
function isStoreError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return err.name.startsWith("Mongo") || err.name.includes("PoolCleared");
}

/**
 * ครอบ handler: error ของ Mongo ระหว่างอ่านเป็น 503 `log_store_unavailable` (เก็บเป็น warning) ไม่ใช่ 500 — Mongo เป็นของเสริม
 * ล่มได้ · Postgres ที่ติดต่อไม่ได้หรือไม่ทันเพดานตอนแปลงตัวระบุเป็น 503 `database_unavailable` (DatabaseDeadlineExceeded ไม่ใช่
 * error ของ Prisma — ถ้าไม่จับที่นี่ index.ts ตอบ 500) error อื่น (Prisma, โค้ดเรา) ไปตามทางเดิมของ index.ts
 */
function storeRoute(fn: (req: Request, res: Response) => Promise<void>) {
  return async (req: Request, res: Response) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (res.headersSent) throw err;
      if (isStoreError(err)) {
        captureError(err, {
          req,
          level: "warning",
          status: 503,
          tag: "log-api.store",
          fingerprint: `log-api:store:${(err as Error).name}`,
        });
        res.status(503).json({ error: "log_store_unavailable", message: STORE_MESSAGE });
        return;
      }
      if (isDatabaseUnreachable(err)) {
        captureError(err, {
          req,
          level: "warning",
          status: 503,
          tag: "log-api.database",
          fingerprint: `log-api:database:${(err as Error).name}`,
        });
        res.status(503).json({ error: "database_unavailable", message: DATABASE_MESSAGE });
        return;
      }
      throw err;
    }
  };
}

/**
 * ฐานข้อมูลของ log store ที่ตอบ ping ได้จริง หรือตอบ 503 เองแล้วคืน null
 *
 * ping ก่อนทุกครั้ง (หนึ่ง round trip) แทนการเชื่อสถานะที่ log-store.ts จำไว้ทุก 30 วินาที: สถานะนั้นอาจเก่าได้ทั้งสองทาง
 * และถ้าไม่ ping การอ่านจะถูกบันทึกก่อนแล้วค่อยพบว่า Mongo ล่ม — บันทึกการอ่านที่ไม่มีใครได้อะไร ผลตามมาคือ Mongo ที่ล่ม
 * อยู่แล้วตอบ `log_store_unavailable` เสมอ แม้ Postgres จะล่มด้วย — `log_read_unrecorded` ของ `recordRead()` เหลือไว้ให้
 * Mongo ที่ล่มหลังจากนี้ (หัวไฟล์) Mongo ที่หยุดหรือค้างตอบภายในราว 2 วินาที (STORE_CHECK_MS)
 */
async function store(res: Response): Promise<Db | null> {
  if (!env.logStore.enabled) {
    res.status(503).json({ error: "log_store_disabled", message: STORE_MESSAGE });
    return null;
  }
  const db = await answeredWithin(async () => {
    const db = await logDb();
    if (!db) return null;
    await db.command({ ping: 1 });
    return db;
  }, STORE_CHECK_MS);
  if (db) return db;
  // ไม่เรียก captureError เอง: `res.json` ของ 5xx ถูกเก็บเป็น warning `http:5xx:<route>:log_store_unavailable` พร้อมรหัส
  // อ้างอิงอยู่แล้ว (index.ts) ส่วนสาเหตุอยู่ในบรรทัด [log-store] ของรอบตรวจถัดไป
  res.status(503).json({ error: "log_store_unavailable", message: STORE_MESSAGE });
  return null;
}

/**
 * ผลของ `work` ถ้าจบภายใน `ms` — ไม่ทัน หรือ reject ได้ null ตัวจับเวลาถูกล้างทันทีที่ work จบ และ work ที่ถูกทิ้งแล้ว reject
 * ทีหลังไม่กลายเป็น unhandled rejection (มี catch ผูกไว้ใน race แล้ว)
 */
function answeredWithin<T>(work: () => Promise<T | null>, ms: number): Promise<T | null> {
  let handle: NodeJS.Timeout | undefined;
  const deadline = new Promise<null>((resolve) => {
    handle = setTimeout(() => resolve(null), ms);
  });
  return Promise.race([work().catch(() => null), deadline]).finally(() => clearTimeout(handle));
}

/**
 * แม่แบบของ route ที่ถูกเรียก — ลง `metadata.endpoint` (`GET /api/admin/logs/activity/:id`) ไม่ใช่ path ที่มี id จริง ประกอบจาก
 * LOG_API_PATH กับแม่แบบของ route ไม่ใช่ `req.baseUrl`: Express จับ path แบบไม่สนตัวพิมพ์ `/API/Admin/LOGS/ACTIVITY` จึงเข้า
 * route เดียวกันได้ แต่ `baseUrl` เป็นตัวพิมพ์ตามที่ผู้เรียกพิมพ์ — endpoint เดียวจะถูกบันทึกเป็นหลายชื่อ
 */
function endpointOf(req: Request): string {
  const template: unknown = req.route?.path;
  return `${req.method} ${LOG_API_PATH}${typeof template === "string" ? template : "/?"}`;
}

/**
 * บันทึกการอ่าน — คืน `readId` หรือตอบ 503 `log_read_unrecorded` เองแล้วคืน null (ผู้เรียกต้องหยุดทันที ไม่ส่งข้อมูลใด ๆ)
 * ถึงที่นี่ได้ `store()` ต้อง ping ผ่านแล้ว: 503 นี้จึงแปลว่า Postgres บันทึกไม่ได้และ Mongo ล้มระหว่างเขียนสำเนา
 */
async function recordRead(
  req: Request,
  res: Response,
  filters: Record<string, unknown>,
  page: number | null = null,
): Promise<string | null> {
  const reader = req.logReader;
  if (!reader) throw new Error("requireLogReader ไม่ได้ติดตั้งก่อน route นี้");
  const recorded = await recordLogRead({
    reader: reader.reader,
    reason: reader.reason,
    endpoint: endpointOf(req),
    filters,
    page,
    tokenFp: reader.tokenFp,
  });
  if (!recorded) {
    res.status(503).json({
      error: "log_read_unrecorded",
      message: "บันทึกการอ่านไม่ได้ทั้งในฐานข้อมูลหลักและใน log store — ไม่ส่งข้อมูลจนกว่าจะบันทึกได้ กรุณาลองใหม่อีกครั้ง",
    });
    return null;
  }
  return recorded.readId;
}

function hashSearchUnavailable(res: Response, field: SubjectName) {
  const header = SUBJECT_HEADERS[field];
  res.status(503).json({
    error: "hash_search_unavailable",
    message: `ค้นด้วย ${header} ไม่ได้บนระบบนี้ — ไม่ได้ตั้ง LOG_HASH_KEY สำเนาจึงไม่มี key ค้นหา cid#/email#`,
    fields: { [header]: "ไม่มี LOG_HASH_KEY" },
  });
}

async function countCapped(db: Db, collection: string, filter: Filter<Document>) {
  const counted = await db
    .collection(collection)
    .countDocuments(filter, { limit: TOTAL_CAP + 1, maxTimeMS: READ_MAX_MS });
  return counted > TOTAL_CAP
    ? { total: TOTAL_CAP, totalIsLowerBound: true }
    : { total: counted, totalIsLowerBound: false };
}

function beyondCap(page: number, pageSize: number, res: Response): boolean {
  if ((page - 1) * pageSize < TOTAL_CAP) return false;
  invalid(res, { page: `เปิดได้ถึงรายการที่ ${TOTAL_CAP.toLocaleString("en-US")} — แคบช่วงเวลาหรือตัวกรองลงแทน` });
  return true;
}

// --------------------------------------------------------------------------------------------- ช่วงเวลา

interface TimeWindow {
  from: Date | null;
  to: Date | null;
}

/**
 * ช่วงเวลาที่ใช้จริง — ตอบ 400 เองแล้วคืน null ถ้าใช้ไม่ได้
 *   - ไม่ระบุทั้งคู่: มีตัวกรองที่แคบลง = ไม่จำกัด (ทั้งประวัติ ใช้ index ของตัวกรองนั้น) · ไม่มี = `defaultDays` ล่าสุด
 *   - ระบุ `from` อย่างเดียว: ถึงตอนนี้ · ระบุ `to` อย่างเดียว: ย้อนไป `defaultDays` (หรือไม่จำกัดถ้ามีตัวกรองที่แคบลง)
 *   - ช่วงที่มีทั้งสองปลายยาวไม่เกิน 366 วัน และ `from` ต้องไม่อยู่หลัง `to`
 */
function windowOf(
  query: { from?: string; to?: string },
  options: { narrowed: boolean; defaultDays: number },
  res: Response,
): TimeWindow | null {
  const now = new Date();
  let from = query.from ? new Date(query.from) : null;
  let to = query.to ? new Date(query.to) : null;
  if (!from && !to && !options.narrowed) {
    to = now;
    from = new Date(now.getTime() - options.defaultDays * DAY_MS);
  } else if (from && !to) {
    to = now;
  } else if (!from && to && !options.narrowed) {
    from = new Date(to.getTime() - options.defaultDays * DAY_MS);
  }
  if (from && to) {
    if (from.getTime() > to.getTime()) {
      invalid(res, { from: "from ต้องไม่อยู่หลัง to" });
      return null;
    }
    if (to.getTime() - from.getTime() > WINDOW_MAX_DAYS * DAY_MS) {
      invalid(res, { from: `ช่วงเวลายาวได้ไม่เกิน ${WINDOW_MAX_DAYS} วัน` });
      return null;
    }
  }
  return { from, to };
}

function timeFilter(field: string, window: TimeWindow): Filter<Document> | null {
  if (!window.from && !window.to) return null;
  return {
    [field]: {
      ...(window.from ? { $gte: window.from } : {}),
      ...(window.to ? { $lte: window.to } : {}),
    },
  };
}

function windowRecord(window: TimeWindow) {
  return { from: window.from?.toISOString() ?? null, to: window.to?.toISOString() ?? null };
}

function anyOf(branches: Filter<Document>[]): Filter<Document> {
  return branches.length === 1 ? branches[0]! : { $or: branches };
}

function allOf(parts: Array<Filter<Document> | null>): Filter<Document> {
  const kept = parts.filter((part): part is Filter<Document> => part !== null);
  if (kept.length === 0) return {};
  return kept.length === 1 ? kept[0]! : { $and: kept };
}

// --------------------------------------------------------------------------------------------- ตัวระบุ

/**
 * คน — uuid ของบัญชี หรืออีเมล อีเมลที่มีบัญชีได้ id ของบัญชี (index `relatedUserIds`) **และ** key `email#` (แถวที่มีแค่
 * อีเมลของบัญชี: resend ของคำเชิญ คำเชิญที่ถูกลบ — lib/activity-shape.ts) อีเมลที่ไม่มีบัญชีได้แค่ `email#`
 * ไม่มี LOG_HASH_KEY: มีบัญชีก็ยังค้นด้วย id ได้ ไม่มีบัญชีตอบ 503 `hash_search_unavailable`
 */
interface PersonRef {
  accountId: string | null;
  emailKey: string | null;
  /**
   * ค่าที่ลงตัวกรองของบันทึกการอ่าน — `person` เป็น uuid ของบัญชีเมื่อรู้ว่าเป็นบัญชีไหน (ส่งมาเป็น uuid หรืออีเมลที่มีบัญชี)
   * ไม่งั้นเป็น key `email#` · บัญชีที่รู้ตัวได้ `personEmailKey` / `personCidKey` ของอีเมลและเลขบัตรของบัญชีนั้นด้วย (เมื่อมีกุญแจ
   * และบัญชีมีค่านั้น — `accountKeysOf`) ไม่เคยเป็นอีเมลหรือเลขบัตรจริง และไม่เคยเป็นค่าที่ไม่บอกว่าใคร: บันทึกการอ่านต้อง
   * ตอบได้ว่าอ่านประวัติของใคร แม้ระบบจะไม่ได้ตั้ง LOG_HASH_KEY
   */
  recorded: Record<string, string>;
}

/**
 * บัญชีหนึ่งบัญชีในรูปที่บันทึกการอ่านเก็บ — id กับ key ค้นหา (`email#` `cid#`) ของอีเมลและเลขบัตรของบัญชี
 *
 * มีไว้ให้ "ใครเคยค้นประวัติของคนนี้" ไม่ขึ้นกับว่าคนค้นพิมพ์อะไรมา: บันทึกของการค้นด้วย uuid ด้วยอีเมล หรือด้วยเลขบัตร
 * ได้ครบทั้งสามอย่างของบัญชีนั้นเสมอ (lib/activity-shape.ts `logReadTargets` ยก key เข้า `hashKeys` และ id เข้า
 * `relatedUserIds`) `?action=AUDIT_LOG_READ` คู่กับตัวระบุตัวไหนก็ได้จึงเจอทุกการค้นของคนนั้น เดิมบันทึกแค่ค่าที่พิมพ์มา
 * ค้นด้วย uuid แล้วถามด้วยอีเมลไม่เจอ ค้นด้วยเลขบัตรแล้วถามด้วย uuid ไม่เจอ (ตรวจขั้น 7 แบบค้าน, 2026-09-30)
 */
interface AccountKeys {
  id: string;
  emailKey: string | null;
  cidKey: string | null;
}

/** ผลของการหาบัญชี — `unavailable` เมื่อ Postgres ติดต่อไม่ได้หรือไม่ทันเพดานของ db.ts */
type AccountLookup = { account: AccountKeys | null } | { unavailable: true };

/** บัญชีที่ตรง `where` หรือ null — Postgres ติดต่อไม่ได้ก็ throw ต่อ (ภายในเพดานของ `withDatabaseDeadline()`) */
async function accountKeysOf(where: Prisma.UserAccountWhereInput): Promise<AccountKeys | null> {
  const account = await withDatabaseDeadline(() =>
    prisma.userAccount.findFirst({ where, select: { id: true, email: true, cid: true } }),
  );
  if (!account) return null;
  const hashKey = env.logStore.hashKey;
  return {
    id: account.id,
    emailKey: hashKeyOf("email", account.email, hashKey),
    cidKey: account.cid ? hashKeyOf("cid", account.cid, hashKey) : null,
  };
}

/** แบบเดียวกัน แต่ Postgres ติดต่อไม่ได้ได้ `unavailable` แทน error — ใช้ที่การค้นยังทำต่อได้โดยไม่มีบัญชี */
async function accountKeysIfReachable(where: Prisma.UserAccountWhereInput): Promise<AccountLookup> {
  try {
    return { account: await accountKeysOf(where) };
  } catch (err) {
    if (isDatabaseUnreachable(err)) return { unavailable: true };
    throw err;
  }
}

/**
 * คนที่ค้น → id และ key ของบัญชี — ค้นด้วย uuid ก็ถาม Postgres หาอีเมลกับเลขบัตรของบัญชีด้วย ถาม Postgres ไม่ได้ก็ยังค้นด้วย
 * uuid ได้ตามเดิม (`accountLookup: "unavailable"` ในบันทึกบอกว่าไม่ได้ key ของบัญชี) ส่วนอีเมลต้องแปลงเป็นบัญชีก่อนค้น จึงยัง
 * ต้องการ Postgres (ไม่ได้ → 503 `database_unavailable` ของ `storeRoute`)
 *
 * ค้นด้วย uuid ของบัญชีที่มีอยู่ ตัวกรองรวม `email#` ของบัญชีด้วย เหมือนค้นด้วยอีเมลของบัญชีนั้น — คนเดียวกันต้องได้ผล
 * เดียวกันไม่ว่าจะพิมพ์อะไรมา (แถวที่มีแค่อีเมลของบัญชี: resend ของคำเชิญ คำเชิญที่ถูกลบ) `cid#` ของบัญชีไม่เข้าตัวกรอง
 * เพราะไม่เคยเข้า: มันลงบันทึกไว้ตอบว่าใครค้นใคร ไม่ได้เปลี่ยนสิ่งที่การค้นด้วยคนตอบ
 */
async function resolvePerson(value: string, res: Response): Promise<PersonRef | null> {
  const recordAccount = (account: AccountKeys): Record<string, string> => ({
    person: account.id,
    ...(account.emailKey ? { personEmailKey: account.emailKey } : {}),
    ...(account.cidKey ? { personCidKey: account.cidKey } : {}),
  });
  if (UUID.test(value)) {
    const id = value.toLowerCase();
    const lookup = await accountKeysIfReachable({ id });
    if ("unavailable" in lookup) return { accountId: id, emailKey: null, recorded: { person: id, accountLookup: "unavailable" } };
    if (!lookup.account) return { accountId: id, emailKey: null, recorded: { person: id } };
    return { accountId: id, emailKey: lookup.account.emailKey, recorded: recordAccount(lookup.account) };
  }
  const email = value.trim().toLowerCase();
  // ต้องรู้ว่าอีเมลนี้เป็นของบัญชีไหนก่อนค้น — Postgres ตอบไม่ได้ error ออกไปถึง storeRoute (503 database_unavailable)
  const account = await accountKeysOf({ email: { equals: email, mode: "insensitive" } });
  const emailKey = hashKeyOf("email", email, env.logStore.hashKey);
  if (account) {
    return { accountId: account.id, emailKey, recorded: recordAccount(account) };
  }
  if (!emailKey) {
    hashSearchUnavailable(res, "person");
    return null;
  }
  return { accountId: null, emailKey, recorded: { person: emailKey } };
}

/**
 * บัญชีที่เลขบัตรหรืออีเมลที่ค้น (`x-log-cid` / `x-log-email`) เป็นของ — ลงบันทึกการอ่านเท่านั้น ไม่เปลี่ยนตัวกรอง (ค้นด้วย key
 * ตามเดิม) ชื่อใน `filters`: `<ตัวกรอง>AccountId` กับ key ของอีกค่าหนึ่งของบัญชี (`cidAccountEmailKey`, `emailAccountCidKey`)
 * Postgres ติดต่อไม่ได้ก็ยังค้นได้ (การค้นด้วย key ไม่ต้องใช้ Postgres) — บันทึกได้ `accountLookup: "unavailable"` แทน
 */
async function recordedAccountOf(kind: "cid" | "email", value: string): Promise<Record<string, string>> {
  const lookup = await accountKeysIfReachable(
    kind === "cid" ? { cid: value } : { email: { equals: value, mode: "insensitive" } },
  );
  if ("unavailable" in lookup) return { accountLookup: "unavailable" };
  const account = lookup.account;
  if (!account) return {};
  const otherKey = kind === "cid" ? account.emailKey : account.cidKey;
  const otherName = kind === "cid" ? "cidAccountEmailKey" : "emailAccountCidKey";
  return { [`${kind}AccountId`]: account.id, ...(otherKey ? { [otherName]: otherKey } : {}) };
}

function personFilter(person: PersonRef): Filter<Document> {
  const branches: Filter<Document>[] = [];
  if (person.accountId) branches.push({ relatedUserIds: person.accountId });
  if (person.emailKey) branches.push({ hashKeys: person.emailKey });
  return anyOf(branches);
}

/**
 * คำขอ — uuid หรือเลขที่คำขอ ค้นทั้งสองตาราง
 *
 * คำขอที่ถูกลบไปแล้ว (`DELETE /api/admin/registrations/datasets/:id`) ไม่มีใน Postgres — ส่วนที่หายไป (id ของมันเมื่อค้นด้วย
 * เลขที่ หรือเลขที่เมื่อค้นด้วย id และวันที่สร้าง) มาจากเอกสาร `REQUEST_DELETED` ของมันใน log store (`deletedRequest`) ค้นด้วย
 * อะไรก็ได้ทั้งสองทาง: แถวที่ subject เป็นคำขอนั้น และแถวที่มีเลขที่ของมัน (ไฟล์แนบ การลงนาม) เดิมเลขที่ที่ไม่มีในตารางได้
 * `id: null` ตัวกรองจึงจับได้แค่ `requestNumber` — แถวของคำขอที่สำเนาไม่มีเลขที่ (คัดลอกหลังการลบ ก่อนที่ relay จะหาเลขที่จาก
 * `REQUEST_DELETED` ได้) หายไปจาก timeline ทั้งที่ subject คือคำขอนั้นเอง
 *
 * **เลขที่คำขอถูกใช้ซ้ำได้** — เลขถัดไปคือเลขสูงสุดที่มีอยู่บวกหนึ่ง (lib/request-number.ts) ลบคำขอที่เลขสูงสุดแล้วคำขอใหม่ได้
 * เลขเดิม เลขที่จึงชี้คำขอเดียวเฉพาะช่วงชีวิตของคำขอนั้น `numberWindow` คือช่วงนั้น: ตั้งแต่วันที่สร้าง ถึงเวลาที่ถูกลบ (หรือไม่มี
 * ปลายถ้ายังอยู่) — ตัดสินแล้วว่า**จำกัดช่วง** ไม่ใช่ "ตัดสาขาเลขที่ทิ้งเมื่อมีคำขอที่ยังอยู่ถือเลขนั้น": แบบหลังทำให้ไฟล์แนบ
 * และการลงนามของคำขอที่ถูกลบ (ซึ่งผูกด้วยเลขที่อย่างเดียวในสำเนาบางใบ) หายจาก timeline ของมันทันทีที่เลขถูกใช้ซ้ำ และแก้แค่
 * ทางเดียว: timeline ของคำขอที่**ยังอยู่**ก็ดึงแถวของคำขอที่ถูกลบซึ่งเคยถือเลขเดียวกันเข้ามาด้วย (ตรวจขั้น 7 แบบค้าน,
 * 2026-09-30 — DS-REG-2026-0011 ลบแล้วสร้างใหม่ ทั้งสองทางเห็นแถวของกันและกัน) ช่วงชีวิตแยกได้ทั้งสองทาง เพราะเลขถูกใช้ซ้ำ
 * ได้หลังการลบเท่านั้น ระหว่างที่คำขอยังอยู่เลขของมัน unique · สาขา subject ไม่จำกัดช่วง: id ไม่ถูกใช้ซ้ำ
 */
interface RequestRef {
  id: string | null;
  number: string | null;
  createdAt: Date | null;
  /** ช่วงที่เลขที่นี้เป็นของคำขอนี้ — null ที่ปลายไหนคือไม่จำกัดปลายนั้น (ไม่รู้วันสร้าง หรือยังไม่ถูกลบ) */
  numberWindow: TimeWindow;
}

async function resolveRequest(value: string, db: Db): Promise<RequestRef> {
  const select = { id: true, requestNumber: true, createdAt: true } as const;
  const live = (found: { id: string; requestNumber: string; createdAt: Date }): RequestRef => ({
    id: found.id,
    number: found.requestNumber,
    createdAt: found.createdAt,
    numberWindow: { from: found.createdAt, to: null },
  });
  if (UUID.test(value)) {
    const id = value.toLowerCase();
    const found = await withDatabaseDeadline(
      async () =>
        (await prisma.organizationRegistrationRequest.findUnique({ where: { id }, select })) ??
        (await prisma.datasetRegistrationRequest.findUnique({ where: { id }, select })),
    );
    if (found) return live(found);
    const deleted = await deletedRequest(db, { "subject.type": { $in: REQUEST_SUBJECTS }, "subject.id": id });
    return {
      id,
      number: deleted?.number ?? null,
      createdAt: deleted?.createdAt ?? null,
      numberWindow: { from: deleted?.numberFrom ?? null, to: deleted?.deletedAt ?? null },
    };
  }
  const number = value.toUpperCase();
  const found = await withDatabaseDeadline(
    async () =>
      (await prisma.organizationRegistrationRequest.findUnique({ where: { requestNumber: number }, select })) ??
      (await prisma.datasetRegistrationRequest.findUnique({ where: { requestNumber: number }, select })),
  );
  if (found) return live(found);
  // ไม่มีคำขอที่ยังอยู่ถือเลขนี้ — คือคำขอที่ถูกลบครั้งล่าสุดที่ถือเลขนี้ (เลขที่ถูกลบและใช้ซ้ำหลายรอบ: รอบก่อน ๆ ค้นด้วย uuid)
  const deleted = await deletedRequest(db, { requestNumber: number });
  return {
    id: deleted?.id ?? null,
    number,
    createdAt: deleted?.createdAt ?? null,
    numberWindow: { from: deleted?.numberFrom ?? null, to: deleted?.deletedAt ?? null },
  };
}

/**
 * คำขอที่ถูกลบ ตามเอกสาร `REQUEST_DELETED` ของมันใน log store — id (subject) เลขที่ (`requestNumber`) วันที่สร้าง
 * (`before.createdAt` ที่แถวนั้นเก็บไว้) และเวลาที่ถูกลบ หรือ null ถ้าไม่เคยถูกลบ (หรือสำเนายังมาไม่ถึง) ใช้ index
 * `requestNumber` หรือ `subject.type+id` ของ activity
 *
 * `numberFrom` = ต้นช่วงที่เลขที่เป็นของคำขอนี้: วันที่สร้าง หรือถ้าแถวไม่ได้เก็บไว้ (แถวก่อนการ์ดนี้) เวลาที่คำขอ**ก่อนหน้า**ที่
 * ถือเลขเดียวกันถูกลบ (null ถ้าไม่มี) — คำขอหนึ่งเริ่มถือเลขได้ไม่ก่อนที่คนถือคนก่อนจะถูกลบ
 */
async function deletedRequest(
  db: Db,
  filter: Filter<Document>,
): Promise<{
  id: string | null;
  number: string | null;
  createdAt: Date | null;
  deletedAt: Date | null;
  numberFrom: Date | null;
} | null> {
  const activity = db.collection("activity");
  const doc = await activity.findOne(
    { ...filter, action: AuditAction.REQUEST_DELETED },
    {
      projection: { subject: 1, requestNumber: 1, occurredAt: 1, "before.createdAt": 1 },
      sort: { occurredAt: -1 },
      maxTimeMS: READ_MAX_MS,
    },
  );
  if (!doc) return null;
  const subject = (doc.subject ?? null) as Document | null;
  const createdAtText = ((doc.before ?? null) as Document | null)?.createdAt;
  const parsed = typeof createdAtText === "string" ? new Date(createdAtText) : null;
  const createdAt = parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
  const deletedAt = doc.occurredAt instanceof Date ? doc.occurredAt : null;
  const number = typeof doc.requestNumber === "string" ? doc.requestNumber : null;

  let numberFrom = createdAt;
  if (!numberFrom && number && deletedAt) {
    const previous = await activity.findOne(
      { requestNumber: number, action: AuditAction.REQUEST_DELETED, occurredAt: { $lt: deletedAt } },
      { projection: { occurredAt: 1 }, sort: { occurredAt: -1 }, maxTimeMS: READ_MAX_MS },
    );
    numberFrom = previous?.occurredAt instanceof Date ? previous.occurredAt : null;
  }
  return { id: typeof subject?.id === "string" ? subject.id : null, number, createdAt, deletedAt, numberFrom };
}

/**
 * แถวของคำขอ: subject เป็นคำขอนั้น (index subject.type+id) หรือเลขที่คำขอตรง**ภายในช่วงชีวิตของคำขอนั้น** (ไฟล์แนบ การลงนาม
 * คำขอที่ถูกลบ — `RequestRef.numberWindow` บอกว่าทำไมต้องจำกัดช่วง) ช่วงนั้นรวมทั้งสองปลาย: แถว `REQUEST_DELETED` เองอยู่ที่ปลาย
 */
function requestFilter(request: RequestRef): Filter<Document> {
  const branches: Filter<Document>[] = [];
  if (request.id) branches.push({ "subject.type": { $in: REQUEST_SUBJECTS }, "subject.id": request.id });
  if (request.number) {
    branches.push(allOf([{ requestNumber: request.number }, timeFilter("occurredAt", request.numberWindow)]));
  }
  return anyOf(branches);
}

/** หน่วยงาน — uuid ตามจริง (หน่วยงานที่ไม่มีแล้วก็ค้นได้) รหัสหน่วยงานต้องมีในทะเบียน ไม่งั้น 404 */
async function resolveOrganization(value: string, res: Response): Promise<string | null> {
  if (UUID.test(value)) return value.toLowerCase();
  const found = await withDatabaseDeadline(() =>
    prisma.organization.findFirst({
      where: { organizationCode: { equals: value, mode: "insensitive" } },
      select: { id: true },
    }),
  );
  if (!found) {
    res.status(404).json({ error: "not_found", message: `ไม่พบหน่วยงานรหัส ${value}`, fields: { organization: "ไม่พบ" } });
    return null;
  }
  return found.id;
}

/** แถวของหน่วยงาน: คอลัมน์ organization_id ของแถว หรือ subject เป็นหน่วยงานนั้นเอง */
function organizationFilter(organizationId: string): Filter<Document> {
  return anyOf([{ organizationId }, { "subject.type": "ORGANIZATION", "subject.id": organizationId }]);
}

function correlationFilter(prefix: string): Filter<Document> {
  return prefix.length === 36
    ? { "request.correlationId": prefix }
    : { "request.correlationId": { $regex: `^${escapeRegExp(prefix)}` } };
}

// --------------------------------------------------------------------------------------------- routes

adminLogRouter.use(requireLogReader, refuseSubjectsInQuery);

/**
 * สถานะของ log store — **ไม่บันทึกการอ่าน** (ไม่มีข้อมูลบุคคล) รายละเอียดที่ `/health/ready` ไม่แสดงต่อสาธารณะอยู่ที่นี่
 * `buffered` / `dropped` เป็นของ backend process ที่ตอบเท่านั้น (คิวของ worker แยกกัน) · `relayLagSeconds` = ตอนนี้ลบเวลาที่
 * forward pass ของ relay อ่านจนสุดครั้งล่าสุด (`relay_state.caughtUpAt`) — null ถ้า relay ยังไม่เคยตามทัน
 */
adminLogRouter.get("/status", async (req, res) => {
  if (!noSubjectHeaders(req, res) || !parse(noQuery, req.query, res)) return;
  const stats = errorCaptureStats();
  const logStore: Record<string, unknown> = {
    status: logStoreStatus().status,
    buffered: stats.buffered,
    bufferedBytes: stats.bufferedBytes,
    pendingIssues: stats.pendingIssues,
    dropped: stats.dropped,
    // รายงานเบราว์เซอร์ที่เดินได้แค่ตัวนับของ issue เดิม (เกินร้อย fingerprint ต่อชั่วโมง หรือเกินเพดานขนาด) — ของ process นี้
    browserReportsNotCreatingIssues: stats.browserReportsNotCreatingIssues,
    writing: stats.writing,
    hashKey: env.logStore.hashKey ? "set" : "missing",
    relayLagSeconds: null,
    relayLastRunAt: null,
    relayLastError: null,
    storageMb: null,
    allocatedMb: null,
    maxMb: env.logStore.maxMb,
    overQuota: null,
    quotaCheckedAt: null,
  };
  /**
   * ลูปอีเมลสรุป error ของ worker (workers/error-alerts.ts) ตามที่ worker บอกไว้เอง — backend อ่าน ERROR_ALERT_EMAILS ไม่ได้ (เป็น env
   * ของ worker) `enabled` คือคำของ worker ณ `checkedAt`: เปิดอยู่เขียนทุกนาที (และก่อนทุกฉบับระหว่างรอบที่กำลังส่ง — ช่วงห่าง
   * มากสุดราวหนึ่งนาที, workers/error-alerts.ts `heartbeatOf`) ปิดอยู่เขียนครั้งเดียวตอน worker เริ่ม ·
   * `enabled: true` ที่ `checkedAt` เก่ากว่าสามนาที = ลูปไม่ได้วิ่งแล้ว (worker ดับ หรือ Mongo ของ worker ต่อไม่ได้) ·
   * `lastDigestAt` = สรุปฉบับใหม่ล่าสุด (การส่งซ้ำของฉบับที่ค้างไม่ขยับค่านี้) ·
   * null ทั้งก้อน = worker ยังไม่เคยเขียน (log store ใหม่) · `enabled: null` = เอกสารจาก worker รุ่นก่อนที่ยังไม่บอกค่านี้
   */
  let alerts: Record<string, unknown> | null = null;
  const db = env.logStore.enabled ? await logDb() : null;
  if (db) {
    try {
      const state = await db
        .collection<{ _id: string } & Document>("relay_state")
        .findOne({ _id: "audit_event" }, { maxTimeMS: READ_MAX_MS });
      if (state) {
        const caughtUpAt = state.caughtUpAt instanceof Date ? state.caughtUpAt : null;
        logStore.relayLagSeconds = caughtUpAt ? Math.max(0, Math.round((Date.now() - caughtUpAt.getTime()) / 1000)) : null;
        logStore.relayLastRunAt = state.lastRunAt ?? null;
        logStore.relayLastError = typeof state.lastError === "string" ? state.lastError : null;
        logStore.storageMb = typeof state.storageMb === "number" ? state.storageMb : null;
        logStore.allocatedMb = typeof state.allocatedMb === "number" ? state.allocatedMb : null;
        if (typeof state.maxMb === "number") logStore.maxMb = state.maxMb;
        logStore.overQuota = typeof state.overQuota === "boolean" ? state.overQuota : null;
        logStore.quotaCheckedAt = state.quotaCheckedAt ?? null;
      }
      const alertState = await db
        .collection<{ _id: string } & Document>("relay_state")
        .findOne(
          { _id: "error_alerts" },
          {
            projection: { enabled: 1, recipients: 1, checkedAt: 1, enabledAt: 1, lastDigestAt: 1, lastError: 1 },
            maxTimeMS: READ_MAX_MS,
          },
        );
      if (alertState) {
        alerts = {
          enabled: typeof alertState.enabled === "boolean" ? alertState.enabled : null,
          recipients: typeof alertState.recipients === "number" ? alertState.recipients : null,
          checkedAt: alertState.checkedAt ?? null,
          enabledAt: alertState.enabledAt ?? null,
          lastDigestAt: alertState.lastDigestAt ?? null,
          lastError: typeof alertState.lastError === "string" ? alertState.lastError : null,
        };
      }
    } catch {
      // Mongo ตอบไม่ทัน — ตัวเลขของ relay และเพดานเป็น null ส่วน status มาจากรอบตรวจของ log-store.ts อยู่แล้ว
    }
  }
  // บันทึกการเรียก admin API ของ backend process นี้ (lib/admin-access.ts `adminAccessStats`) — `overCap` / `queueFull` =
  // เก็บเป็นตัวเดี่ยวไม่ได้จึงพับลงบันทึกสรุป · `evicted` = เข้าคิวแล้วถูกเบียดออก จึงพับลงสรุป · `notStored` = ไม่ได้เก็บที่ไหน
  // เลย (เกินเพดานขนาด)
  res.json({ logStore, adminAccess: adminAccessStats(), alerts, release: env.release });
});

/**
 * ค้นกิจกรรม — ตัวกรองทั้งหมด AND กัน `person` `request` `organization` แปลงที่ server (Postgres) `cid` `email` จับด้วย key
 * HMAC เท่านั้น ไม่ระบุช่วงเวลาและไม่มีตัวกรองที่แคบลง = 30 วันล่าสุด · `person` `cid` `email` มาทาง header
 * (`x-log-person` `x-log-cid` `x-log-email` — `SUBJECT_HEADERS`) ที่เหลือเป็น query
 *
 * คำตอบบอกช่วงที่ใช้จริง (`window`) และตำแหน่งของหน้าถัดไป (`nextBefore` — null เมื่อหน้านี้ไม่เต็ม) `total` นับทั้งช่วงของ
 * ตัวกรอง ไม่ขึ้นกับ `before`
 */
adminLogRouter.get(
  "/activity",
  requireReadReason,
  storeRoute(async (req, res) => {
    const input = withSubjectHeaders(req, res, ["person", "cid", "email"]);
    if (!input) return;
    const q = parse(activityQuery, input, res, SUBJECT_HEADERS);
    if (!q) return;
    if (beyondCap(q.page, q.pageSize, res)) return;
    const hashKey = env.logStore.hashKey;
    if (q.cid && !hashKey) return hashSearchUnavailable(res, "cid");
    if (q.email && !hashKey) return hashSearchUnavailable(res, "email");

    const db = await store(res);
    if (!db) return;

    const person = q.person ? await resolvePerson(q.person, res) : null;
    if (q.person && !person) return;
    const request = q.request ? await resolveRequest(q.request, db) : null;
    const organizationId = q.organization ? await resolveOrganization(q.organization, res) : null;
    if (q.organization && !organizationId) return;
    const cidKey = q.cid ? hashKeyOf("cid", q.cid, hashKey) : null;
    const emailKey = q.email ? hashKeyOf("email", q.email, hashKey) : null;
    // บัญชีของเลขบัตร / อีเมลที่ค้น — ลงบันทึกการอ่านอย่างเดียว ให้ "ใครค้นคนนี้" ตอบได้ด้วยตัวระบุตัวไหนก็ได้ (`AccountKeys`)
    const cidAccount = q.cid ? await recordedAccountOf("cid", q.cid) : {};
    const emailAccount = q.email ? await recordedAccountOf("email", q.email) : {};

    const narrowed = Boolean(
      person || request || organizationId || q.actorId || q.subjectId || cidKey || emailKey || q.tokenFp || q.correlationId,
    );
    const window = windowOf(q, { narrowed, defaultDays: ACTIVITY_DEFAULT_DAYS }, res);
    if (!window) return;

    const filter = allOf([
      q.action ? { action: { $in: q.action } } : null,
      q.category ? { category: q.category } : null,
      q.result ? { result: q.result } : null,
      q.via ? { via: q.via } : null,
      q.source ? { source: q.source } : null,
      q.actorId ? { "actor.id": q.actorId } : null,
      q.subjectType ? { "subject.type": q.subjectType } : null,
      q.subjectId ? { "subject.id": q.subjectId } : null,
      person ? personFilter(person) : null,
      request ? requestFilter(request) : null,
      organizationId ? organizationFilter(organizationId) : null,
      cidKey ? { hashKeys: cidKey } : null,
      emailKey ? { hashKeys: emailKey } : null,
      q.tokenFp ? { tokenFps: q.tokenFp } : null,
      q.correlationId ? correlationFilter(q.correlationId) : null,
      timeFilter("occurredAt", window),
    ]);
    const pageFilter = q.before
      ? allOf([
          filter,
          // `_id` ของ activity เป็น string (uuid) — Filter<Document> ของ driver ถือว่า `_id` เป็น ObjectId
          {
            $or: [{ occurredAt: { $lt: q.before.at } }, { occurredAt: q.before.at, _id: { $lt: q.before.id } }],
          } as Document as Filter<Document>,
        ])
      : filter;

    const readId = await recordRead(
      req,
      res,
      {
        ...(q.action ? { action: q.action } : {}),
        ...(q.category ? { category: q.category } : {}),
        ...(q.result ? { result: q.result } : {}),
        ...(q.via ? { via: q.via } : {}),
        ...(q.source ? { source: q.source } : {}),
        ...(q.actorId ? { actorId: q.actorId } : {}),
        ...(q.subjectType ? { subjectType: q.subjectType } : {}),
        ...(q.subjectId ? { subjectId: q.subjectId } : {}),
        ...(person ? person.recorded : {}),
        ...(q.request ? { request: q.request } : {}),
        ...(q.organization ? { organization: q.organization } : {}),
        // ชื่อ `cidKey` / `emailKey` ไม่ใช่ `cid` / `email`: ชื่อที่ลงท้าย `cid` เข้ากฎ key เลขบัตรของสำเนา (lib/redact.ts)
        // แล้ว key ถูกปิดทิ้งใน log store — lib/activity-shape.ts `logReadTargets`
        ...(cidKey ? { cidKey, ...cidAccount } : {}),
        ...(emailKey ? { emailKey, ...emailAccount } : {}),
        ...(q.tokenFp ? { tokenFp: q.tokenFp } : {}),
        ...(q.correlationId ? { correlationId: q.correlationId } : {}),
        ...(q.before ? { before: q.before.raw } : {}),
        window: windowRecord(window),
        pageSize: q.pageSize,
      },
      q.page,
    );
    if (!readId) return;

    const collection = db.collection("activity");
    const [events, counted] = await Promise.all([
      collection
        .find(pageFilter)
        .sort({ occurredAt: -1, _id: -1 })
        .skip((q.page - 1) * q.pageSize)
        .limit(q.pageSize)
        .maxTimeMS(READ_MAX_MS)
        .toArray(),
      countCapped(db, "activity", filter),
    ]);
    const last = events.length === q.pageSize ? events[events.length - 1] : undefined;
    res.json({
      events: events.map(activityDto),
      ...counted,
      page: q.page,
      pageSize: q.pageSize,
      window: windowRecord(window),
      nextBefore: last && last.occurredAt instanceof Date ? `${last.occurredAt.toISOString()},${String(last._id)}` : null,
      readId,
    });
  }),
);

adminLogRouter.get(
  "/activity/:id",
  requireReadReason,
  storeRoute(async (req, res) => {
    if (!noSubjectHeaders(req, res) || !parse(noQuery, req.query, res)) return;
    const id = parseParam(uuidParam, req.params.id, "id", res);
    if (!id) return;
    const db = await store(res);
    if (!db) return;
    const readId = await recordRead(req, res, { id });
    if (!readId) return;
    const event = await db.collection<{ _id: string } & Document>("activity").findOne({ _id: id }, { maxTimeMS: READ_MAX_MS });
    if (!event) {
      res.status(404).json({ error: "not_found", message: "ไม่พบกิจกรรมนี้ใน log store", readId });
      return;
    }
    res.json({ event: activityDto(event), readId });
  }),
);

/**
 * เส้นเวลาของคน คำขอ หรือหน่วยงาน — กิจกรรมกับ error เรียงเก่าไปใหม่รวมกันไม่เกิน 500 รายการ
 *
 * error ที่เข้าเส้นเวลา: error ของคำขอ HTTP เดียวกับกิจกรรมที่พบ (correlation id) และ — เพราะคำขอที่ล้มก่อน commit ไม่มีแถว
 * กิจกรรมให้จับคู่ — error ของผู้ใช้คนนั้น (`actor.id`) · ของคนในหน่วยงานนั้น (`actor.organizationId`) · หรือที่ path มี uuid
 * ของคำขอนั้น ส่วนหลังนี้ไม่มี index จึงทำเฉพาะเมื่อมีช่วงเวลา (คำขอที่ไม่ระบุช่วง ใช้ตั้งแต่วันที่สร้างคำขอ)
 * ถูกตัดที่ 500 แล้ว `truncated: true` และตัดทิ้งรายการหลังรายการสุดท้ายของแหล่งที่ถูกตัด — ไม่งั้นช่วงท้ายจะดูครบทั้งที่ขาด
 */
adminLogRouter.get(
  "/timeline",
  requireReadReason,
  storeRoute(async (req, res) => {
    const input = withSubjectHeaders(req, res, ["person"]);
    if (!input) return;
    const q = parse(timelineQuery, input, res, SUBJECT_HEADERS);
    if (!q) return;
    const db = await store(res);
    if (!db) return;

    const person = q.person ? await resolvePerson(q.person, res) : null;
    if (q.person && !person) return;
    const request = q.request ? await resolveRequest(q.request, db) : null;
    const organizationId = q.organization ? await resolveOrganization(q.organization, res) : null;
    if (q.organization && !organizationId) return;

    // คำขอดูทั้งชีวิต (ไม่จำกัดช่วง) คนกับหน่วยงาน 7 วันล่าสุด — ช่วงที่ระบุเองใช้กติกาเดียวกับ /activity
    const window = windowOf(q, { narrowed: Boolean(request), defaultDays: TIMELINE_DEFAULT_DAYS }, res);
    if (!window) return;

    const readId = await recordRead(req, res, {
      ...(person ? person.recorded : {}),
      ...(q.request ? { request: q.request } : {}),
      ...(q.organization ? { organization: q.organization } : {}),
      window: windowRecord(window),
    });
    if (!readId) return;

    const subjectFilter = person
      ? personFilter(person)
      : request
        ? requestFilter(request)
        : organizationFilter(organizationId!);
    const activity = await db
      .collection("activity")
      .find(allOf([subjectFilter, timeFilter("occurredAt", window)]))
      .sort({ occurredAt: 1, _id: 1 })
      .limit(TIMELINE_MAX_ITEMS + 1)
      .maxTimeMS(READ_MAX_MS)
      .toArray();

    const correlationIds = [
      ...new Set(
        activity
          .map((doc) => (doc.request as Document | undefined)?.correlationId)
          .filter((id): id is string => typeof id === "string"),
      ),
    ];
    // error ไม่มีทางแคบลงด้วย index นอกจาก correlation id — ช่วงเวลาของ error จึงต้องมีขอบล่างเสมอ
    const errorWindow: TimeWindow = {
      from: window.from ?? request?.createdAt ?? null,
      to: window.to,
    };
    const errorBranches: Filter<Document>[] = [];
    if (correlationIds.length > 0) errorBranches.push({ "request.correlationId": { $in: correlationIds } });
    if (errorWindow.from) {
      if (person?.accountId) errorBranches.push({ "actor.id": person.accountId });
      if (organizationId) errorBranches.push({ "actor.organizationId": organizationId });
      if (request?.id) errorBranches.push({ "request.path": { $regex: escapeRegExp(request.id) } });
    }
    const errors =
      errorBranches.length === 0
        ? []
        : await db
            .collection("error_events")
            .find(allOf([anyOf(errorBranches), timeFilter("occurredAt", errorWindow)]), {
              projection: ERROR_SUMMARY_PROJECTION,
            })
            .sort({ occurredAt: 1, _id: 1 })
            .limit(TIMELINE_MAX_ITEMS + 1)
            .maxTimeMS(READ_MAX_MS)
            .toArray();

    const time = (doc: Document) => (doc.occurredAt instanceof Date ? doc.occurredAt.getTime() : 0);
    let truncated = false;
    let cutoff = Number.POSITIVE_INFINITY;
    for (const source of [activity, errors]) {
      if (source.length > TIMELINE_MAX_ITEMS) {
        truncated = true;
        source.length = TIMELINE_MAX_ITEMS;
        cutoff = Math.min(cutoff, time(source[source.length - 1]!));
      }
    }
    const merged = [
      ...activity.map((doc) => ({ at: time(doc), id: String(doc._id), item: { type: "activity", ...activityDto(doc) } })),
      ...errors.map((doc) => ({ at: time(doc), id: String(doc._id), item: { type: "error", ...errorSummary(doc) } })),
    ]
      .filter((entry) => entry.at <= cutoff)
      .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
    if (merged.length > TIMELINE_MAX_ITEMS) truncated = true;
    res.json({ items: merged.slice(0, TIMELINE_MAX_ITEMS).map((entry) => entry.item), truncated, readId });
  }),
);

/**
 * ไล่ตามรหัสอ้างอิง — ทุกอย่างที่คำขอ HTTP หนึ่งครั้งทิ้งไว้: กิจกรรม error อีเมลในคิว และงานกับระบบภายนอก
 *
 * `ref` = correlation id เต็ม หรือ prefix ฐานสิบหกตั้งแต่ 8 ตัว (รหัสอ้างอิงบนข้อความ 5xx) prefix ที่ตรงหลาย id ตอบรายชื่อ
 * ให้เลือก (`ambiguous`) ไม่เดาเอง อีเมลและงานภายนอกอ่านจาก Postgres ด้วย id **ตรงตัว** เท่านั้น — Postgres ล่มก็ยังได้ส่วน
 * ของ log store (`deliveries`/`integrations` เป็น null)
 *
 * `mixedActors: true` = แถวของ id นี้มาจากผู้กระทำหรือช่องทางมากกว่าหนึ่ง ผู้เรียก API ตรงส่ง `x-correlation-id` เองได้
 * (lib/context.ts) id เดียวกันจึงไม่ใช่หลักฐานว่าเป็นคลิกเดียว — docs/21 §2.5
 *
 * `reports` = รายงานจากเบราว์เซอร์ที่**อ้าง**รหัสนี้ (`browser.reference` — 8 ตัวแรกของ ref) แยกจาก `errors` เพราะรหัสนั้นผู้ส่ง
 * เขียนเอง ไม่ใช่ correlation id ที่ระบบออกให้: 502 ของ proxy ที่เบราว์เซอร์ส่งตามมาหลัง backend กลับมา (Postman G6 หาเจอ
 * ทางนี้ทางเดียว — backend ไม่เคยเห็นคำขอนั้น) และรหัสที่หน้า global-error สร้างเอง ใครก็ส่งรายงานอ้างรหัสของคนอื่นได้
 * (routes/client-errors.ts) จึงอ่านเป็นคำบอกเล่า ไม่ใช่หลักฐาน · มีแต่ `reports` (ไม่มี activity/error ของรหัสนั้น) ตอบ 200 พร้อม
 * `correlationId: null` ไม่ใช่ 404
 *
 * `serverErrors` = error ของ Next server ที่ `digest` ของรายงานใน `reports` ชี้ถึง (`serverErrorsOf`) — หน้า global-error ของ
 * production ได้จาก server แค่ digest ไม่มีข้อความ ข้อความจริงอยู่ที่ event ของ Next server ตัวนี้
 */
adminLogRouter.get(
  "/trace/:ref",
  requireReadReason,
  storeRoute(async (req, res) => {
    if (!noSubjectHeaders(req, res) || !parse(noQuery, req.query, res)) return;
    const ref = canonicalPrefix(String(req.params.ref ?? ""));
    if (!ref) {
      invalid(res, { ref: "ต้องเป็น correlation id หรือรหัสอ้างอิงฐานสิบหกอย่างน้อย 8 ตัว" });
      return;
    }
    const db = await store(res);
    if (!db) return;
    const readId = await recordRead(req, res, { ref });
    if (!readId) return;

    const reports = (
      await db
        .collection("error_events")
        .find({ "browser.reference": ref.slice(0, 8) })
        .sort({ occurredAt: -1, _id: -1 })
        .limit(TRACE_ERRORS_MAX)
        .maxTimeMS(READ_MAX_MS)
        .toArray()
    ).map(errorEventDto);
    const serverErrors = await serverErrorsOf(db, reports);

    let correlationId = ref;
    if (ref.length < 36) {
      const pipeline = [
        { $match: { "request.correlationId": { $regex: `^${escapeRegExp(ref)}` } } },
        { $group: { _id: "$request.correlationId", firstAt: { $min: "$occurredAt" }, count: { $sum: 1 } } },
        { $sort: { firstAt: -1 } },
        { $limit: TRACE_CANDIDATES_MAX + 1 },
      ];
      const [inActivity, inErrors] = await Promise.all([
        db.collection("activity").aggregate(pipeline, { maxTimeMS: READ_MAX_MS }).toArray(),
        db.collection("error_events").aggregate(pipeline, { maxTimeMS: READ_MAX_MS }).toArray(),
      ]);
      const candidates = new Map<string, { correlationId: string; firstAt: Date | null; activity: number; errors: number }>();
      for (const [rows, kind] of [
        [inActivity, "activity"],
        [inErrors, "errors"],
      ] as const) {
        for (const row of rows) {
          if (typeof row._id !== "string") continue;
          const entry = candidates.get(row._id) ?? { correlationId: row._id, firstAt: null, activity: 0, errors: 0 };
          const firstAt = row.firstAt instanceof Date ? row.firstAt : null;
          if (firstAt && (!entry.firstAt || firstAt < entry.firstAt)) entry.firstAt = firstAt;
          entry[kind] += typeof row.count === "number" ? row.count : 0;
          candidates.set(row._id, entry);
        }
      }
      if (candidates.size === 0 && reports.length === 0) {
        res.status(404).json({ error: "not_found", message: `ไม่พบรหัสอ้างอิง ${ref} ใน log store`, readId });
        return;
      }
      if (candidates.size === 0) {
        // มีแต่รายงานที่อ้างรหัสนี้ — คำขอที่ backend ไม่เคยเห็น (502 ของ proxy) หรือรหัสที่หน้า global-error สร้างเอง
        res.json({
          correlationId: null,
          reference: ref.slice(0, 8),
          actors: [],
          mixedActors: false,
          activity: [],
          activityTruncated: false,
          errors: [],
          errorsTruncated: false,
          reports,
          serverErrors,
          deliveries: null,
          integrations: null,
          postgres: "not_applicable",
          readId,
        });
        return;
      }
      if (candidates.size > 1) {
        const list = [...candidates.values()]
          .sort((a, b) => (b.firstAt?.getTime() ?? 0) - (a.firstAt?.getTime() ?? 0))
          .slice(0, TRACE_CANDIDATES_MAX)
          .map((c) => ({ ...c, firstAtBangkok: bangkok(c.firstAt) }));
        res.json({
          ambiguous: true,
          ref,
          candidates: list,
          candidatesTruncated: candidates.size > TRACE_CANDIDATES_MAX,
          reports,
          serverErrors,
          readId,
        });
        return;
      }
      correlationId = [...candidates.keys()][0]!;
    }

    const byCorrelation = { "request.correlationId": correlationId };
    const [activity, errors] = await Promise.all([
      db
        .collection("activity")
        .find(byCorrelation)
        .sort({ occurredAt: 1, _id: 1 })
        .limit(TRACE_ACTIVITY_MAX + 1)
        .maxTimeMS(READ_MAX_MS)
        .toArray(),
      db
        .collection("error_events")
        .find(byCorrelation)
        .sort({ occurredAt: 1, _id: 1 })
        .limit(TRACE_ERRORS_MAX + 1)
        .maxTimeMS(READ_MAX_MS)
        .toArray(),
    ]);
    const activityTruncated = activity.length > TRACE_ACTIVITY_MAX;
    const errorsTruncated = errors.length > TRACE_ERRORS_MAX;
    activity.length = Math.min(activity.length, TRACE_ACTIVITY_MAX);
    errors.length = Math.min(errors.length, TRACE_ERRORS_MAX);

    const actors = new Map<string, { id: string | null; via: string | null; count: number }>();
    for (const doc of activity) {
      const id = typeof (doc.actor as Document | undefined)?.id === "string" ? ((doc.actor as Document).id as string) : null;
      const via = typeof doc.via === "string" ? doc.via : null;
      const key = `${id ?? "-"}|${via ?? "-"}`;
      const entry = actors.get(key) ?? { id, via, count: 0 };
      entry.count += 1;
      actors.set(key, entry);
    }

    // correlation id ในสำเนาเป็นข้อความ แต่คอลัมน์ของสองตารางนั้นเป็น uuid — ค่าที่ไม่ใช่ uuid ไม่ต้องถาม Postgres
    // อ่าน Postgres ไม่ได้ ส่วนของ log store ยังตอบได้ (`postgres: "unavailable"`) ไม่ใช่ 503 ทั้งก้อน
    const postgres = UUID.test(correlationId) ? await postgresOfTrace(correlationId) : null;
    res.json({
      correlationId,
      reference: correlationId.slice(0, 8),
      actors: [...actors.values()],
      mixedActors: actors.size > 1,
      activity: activity.map(activityDto),
      activityTruncated,
      errors: errors.map(errorEventDto),
      errorsTruncated,
      reports,
      serverErrors,
      deliveries: postgres?.deliveries ?? null,
      integrations: postgres?.integrations ?? null,
      postgres: postgres ? "ok" : UUID.test(correlationId) ? "unavailable" : "not_applicable",
      readId,
    });
  }),
);

/**
 * error ของ Next server ที่รายงานใน trace ชี้ถึงด้วย `digest` — ตัวที่หน้า global-error ได้จาก Next และส่งมาใน `browser.digest`
 * ตรงกับ `extra.digest` ของ event ที่ Next server รายงานเอง (routes/client-errors.ts เก็บเฉพาะของที่ `x-report-token` ยืนยันแล้ว)
 *
 * digest ของ Next คือ hash ของข้อความกับ stack ไม่ใช่ id ของคำขอ: error เดียวกันของคนอื่นได้ digest เดียวกัน จึงดูแค่ในช่วง
 * `TRACE_DIGEST_WINDOW_MS` รอบเวลาของรายงาน ใหม่ไปเก่า ไม่เกิน `TRACE_SERVER_ERRORS_MAX` ตัว ไม่มีดัชนีบน `extra.digest`
 * (plan §3 "Indexes") ช่วงเวลาคือตัวที่ทำให้ค้นเร็ว (`{occurredAt: -1}`) · digest ของรายงานผู้ส่งเขียนเองได้เหมือน `reference`
 */
async function serverErrorsOf(db: Db, reports: Document[]): Promise<Document[]> {
  const digests = new Set<string>();
  let earliest = Number.POSITIVE_INFINITY;
  let latest = Number.NEGATIVE_INFINITY;
  for (const report of reports) {
    const digest = (report.browser as Document | null | undefined)?.digest;
    const at = report.occurredAt instanceof Date ? report.occurredAt.getTime() : Number.NaN;
    if (typeof digest !== "string" || digest === "" || Number.isNaN(at)) continue;
    digests.add(digest);
    earliest = Math.min(earliest, at);
    latest = Math.max(latest, at);
  }
  if (digests.size === 0) return [];
  const docs = await db
    .collection("error_events")
    .find({
      occurredAt: { $gte: new Date(earliest - TRACE_DIGEST_WINDOW_MS), $lte: new Date(latest + TRACE_DIGEST_WINDOW_MS) },
      service: "frontend-server",
      "extra.digest": { $in: [...digests] },
    })
    .sort({ occurredAt: -1, _id: -1 })
    .limit(TRACE_SERVER_ERRORS_MAX)
    .maxTimeMS(READ_MAX_MS)
    .toArray();
  return docs.map(errorEventDto);
}

/**
 * อีเมลในคิวและงานกับระบบภายนอกของ correlation id ตรงตัว — null ถ้า Postgres ตอบไม่ได้ภายในเพดานของ db.ts (trace ยังคืน
 * ส่วนของ log store)
 * ไม่มีที่อยู่ปลายทางของอีเมล (`destination`) และข้อความ error ผ่าน `scrubClipped` — SMTP ยกที่อยู่ผู้รับมาในข้อความได้
 * (workers/delivery.ts เขียน `last_error_message` ดิบ)
 */
async function postgresOfTrace(correlationId: string) {
  try {
    const [deliveries, integrations] = await withDatabaseDeadline(() =>
      Promise.all([
        prisma.notificationDelivery.findMany({
          where: { correlationId },
          orderBy: { createdAt: "asc" },
          take: TRACE_ROWS_MAX,
          select: {
            id: true,
            channel: true,
            status: true,
            attemptCount: true,
            lastErrorCode: true,
            lastErrorMessage: true,
            createdAt: true,
            sentAt: true,
            notification: { select: { notificationType: true } },
          },
        }),
        prisma.integrationOperation.findMany({
          where: { correlationId },
          orderBy: { createdAt: "asc" },
          take: TRACE_ROWS_MAX,
          select: {
            id: true,
            integrationType: true,
            operation: true,
            status: true,
            lastErrorCode: true,
            createdAt: true,
            completedAt: true,
          },
        }),
      ]),
    );
    return {
      deliveries: deliveries.map(({ notification, lastErrorMessage, ...rest }) => ({
        ...rest,
        notificationType: notification.notificationType,
        lastErrorMessage: lastErrorMessage === null ? null : scrubClipped(lastErrorMessage, 1_000),
      })),
      integrations: integrations.map(({ integrationType, ...rest }) => ({ ...rest, type: integrationType })),
    };
  } catch (err) {
    captureError(err, { level: "warning", tag: "log-api.trace-postgres" });
    return null;
  }
}

/** รายการ issue — ค่าตั้งต้นเฉพาะที่ยังเปิด เรียงตามที่เห็นล่าสุด (หรือจำนวน, ที่เห็นครั้งแรก) ใหม่ไปเก่า */
adminLogRouter.get(
  "/errors/issues",
  storeRoute(async (req, res) => {
    if (!noSubjectHeaders(req, res)) return;
    const q = parse(issuesQuery, req.query, res);
    if (!q) return;
    if (beyondCap(q.page, q.pageSize, res)) return;
    const db = await store(res);
    if (!db) return;
    const readId = await recordRead(
      req,
      res,
      {
        status: q.status,
        sort: q.sort,
        ...(q.service ? { service: q.service } : {}),
        ...(q.level ? { level: q.level } : {}),
        ...(q.release ? { release: q.release } : {}),
        ...(q.since ? { since: q.since } : {}),
        pageSize: q.pageSize,
      },
      q.page,
    );
    if (!readId) return;
    const filter = allOf([
      q.status === "all" ? null : { status: q.status },
      q.service ? { service: q.service } : null,
      q.level ? { level: q.level } : null,
      q.release ? { $or: [{ firstRelease: q.release }, { lastRelease: q.release }] } : null,
      q.since ? { lastSeen: { $gte: new Date(q.since) } } : null,
    ]);
    const [issues, counted] = await Promise.all([
      db
        .collection("error_issues")
        .find(filter)
        .sort({ [q.sort]: -1, _id: -1 })
        .skip((q.page - 1) * q.pageSize)
        .limit(q.pageSize)
        .maxTimeMS(READ_MAX_MS)
        .toArray(),
      countCapped(db, "error_issues", filter),
    ]);
    res.json({ issues: issues.map(issueDto), ...counted, page: q.page, pageSize: q.pageSize, readId });
  }),
);

/** issue หนึ่งตัวกับ event ล่าสุดของมัน (ย่อ — ตัวเต็มเปิดด้วย `/errors/events/:id`) */
adminLogRouter.get(
  "/errors/issues/:fingerprint",
  storeRoute(async (req, res) => {
    if (!noSubjectHeaders(req, res)) return;
    const q = parse(issueQuery, req.query, res);
    if (!q) return;
    const fingerprint = parseParam(fingerprintParam, req.params.fingerprint, "fingerprint", res);
    if (fingerprint === null) return;
    const db = await store(res);
    if (!db) return;
    const readId = await recordRead(req, res, { fingerprint, events: q.events });
    if (!readId) return;
    const issue = await db
      .collection<{ _id: string } & Document>("error_issues")
      .findOne({ _id: fingerprint }, { maxTimeMS: READ_MAX_MS });
    if (!issue) {
      res.status(404).json({ error: "not_found", message: "ไม่พบ issue นี้", readId });
      return;
    }
    const recentEvents =
      q.events === 0
        ? []
        : await db
            .collection("error_events")
            .find({ fingerprint }, { projection: ERROR_SUMMARY_PROJECTION })
            .sort({ occurredAt: -1, _id: -1 })
            .limit(q.events)
            .maxTimeMS(READ_MAX_MS)
            .toArray();
    res.json({ issue: issueDto(issue), recentEvents: recentEvents.map(errorSummary), readId });
  }),
);

adminLogRouter.get(
  "/errors/events/:id",
  storeRoute(async (req, res) => {
    if (!noSubjectHeaders(req, res) || !parse(noQuery, req.query, res)) return;
    const id = parseParam(uuidParam, req.params.id, "id", res);
    if (!id) return;
    const db = await store(res);
    if (!db) return;
    const readId = await recordRead(req, res, { id });
    if (!readId) return;
    const event = await db
      .collection<{ _id: string } & Document>("error_events")
      .findOne({ _id: id }, { maxTimeMS: READ_MAX_MS });
    if (!event) {
      res.status(404).json({ error: "not_found", message: "ไม่พบ error event นี้ (อาจถูกลบตามอายุแล้ว — 90 วัน)", readId });
      return;
    }
    res.json({ event: errorEventDto(event), readId });
  }),
);

/**
 * เปลี่ยนสถานะของ issue — ตั้ง `status` `statusChangedAt` `statusReason` พร้อมกันเสมอ: การเปิดกลับเมื่อเกิดซ้ำ
 * (lib/error-capture.ts) ดู `statusChangedAt` เทียบกับ `lastSeen` ของก้อนที่เขียน ปิดโดยไม่ตั้งเวลา ค่าเก่าจะทำให้ error ที่
 * เกิดก่อนปิดเปิดมันกลับทันที · ตั้งสถานะเดิมซ้ำก็เขียน (เวลากับเหตุผลเปลี่ยน) และได้แถว `ERROR_ISSUE_STATUS_CHANGED`
 *
 * แถวเขียนด้วย `logAudit()` หลังเปลี่ยนแล้ว ไม่ใช่ `recordLogRead()`: นี่คือการแก้ ไม่ใช่การอ่าน — การแก้เกิดไปแล้วใน
 * Mongo แถวที่เขียนไม่ได้จึงไปตามทางสำรองปกติ (`audit_fallback` ผ่านคิว) ไม่ย้อนการแก้ รอ Postgres ไม่เกินเพดานของ
 * `withDatabaseDeadline()` (`deadline: true`): route นี้ไม่แตะ Postgres ที่อื่นเลย Postgres ที่ค้าง (ไม่ใช่ล่ม) เคยทำให้คำขอ
 * ค้างไม่มีกำหนดทั้งที่สถานะเปลี่ยนไปแล้ว (ตรวจแบบค้านขั้น 7: เกิน 45 วินาที) INSERT ที่เลิกรอแล้วยัง commit ทีหลังได้ — การ
 * เปลี่ยนครั้งนั้นจึงอาจมีสองบันทึก (แถวใน Postgres กับสำเนา `audit_fallback`) แบบเดียวกับ `recordLogRead()`
 *
 * เหตุผลที่ลง `error_issues.statusReason` (และที่คำตอบส่งกลับ) ผ่าน `maskCidText` ก่อน — กฎเลขบัตรตัวเดียวกับที่สำเนา
 * กิจกรรมใช้กับ `reason` (plan §7.6) เดิมเหตุผลลงตามที่พิมพ์ เป็นข้อความอิสระทางเดียวที่เข้า Mongo โดยไม่ผ่าน lib/redact.ts
 * เลขบัตรที่พิมพ์ในเหตุผลจึงอยู่ครบใน log store และออกทาง `GET /errors/issues` (ตรวจแบบค้านขั้น 7) ส่วนแถว
 * `ERROR_ISSUE_STATUS_CHANGED` ใน Postgres เก็บข้อความตามที่พิมพ์ เหมือนเหตุผลของแถวอื่น
 */
adminLogRouter.patch(
  "/errors/issues/:fingerprint",
  storeRoute(async (req, res) => {
    if (!noSubjectHeaders(req, res) || !parse(noQuery, req.query, res)) return;
    const fingerprint = parseParam(fingerprintParam, req.params.fingerprint, "fingerprint", res);
    if (fingerprint === null) return;
    const body = parse(issueStatusBody, req.body ?? {}, res);
    if (!body) return;
    const db = await store(res);
    if (!db) return;

    const changedAt = new Date();
    const storedReason = maskCidText(body.reason);
    const before = await db
      .collection<{ _id: string } & Document>("error_issues")
      .findOneAndUpdate(
        { _id: fingerprint },
        { $set: { status: body.status, statusChangedAt: changedAt, statusReason: storedReason } },
        { returnDocument: "before", maxTimeMS: READ_MAX_MS },
      );
    if (!before) {
      res.status(404).json({ error: "not_found", message: "ไม่พบ issue นี้" });
      return;
    }

    const reader = req.logReader!;
    await logAudit(
      {
        action: AuditAction.ERROR_ISSUE_STATUS_CHANGED,
        subjectType: AuditSubject.ERROR_ISSUE,
        actorType: "SYSTEM",
        before: { status: before.status ?? null, statusReason: before.statusReason ?? null },
        after: { status: body.status, statusReason: body.reason },
        metadata: {
          fingerprint,
          reason: body.reason,
          reader: reader.reader,
          token_fp: reader.tokenFp,
        },
      },
      { deadline: true },
    );

    const issue = { ...before, status: body.status, statusChangedAt: changedAt, statusReason: storedReason };
    res.json({ issue: issueDto(issue) });
  }),
);

/** path ใต้ `/api/admin/logs` ที่ไม่มีจริง — ตอบที่นี่ ไม่ตกไปถึง `adminRouter` (ดูหัวไฟล์) */
adminLogRouter.use((_req, res) => {
  res.status(404).json({ error: "not_found", message: "ไม่พบเส้นทางนี้ใน API อ่าน log" });
});
