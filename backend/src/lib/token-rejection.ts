/**
 * บันทึกการปฏิเสธ shared-secret token (`x-admin-token`) ลง audit_event — แบบ throttle
 *
 * ต้องบันทึก: token ผู้ดูแลระบบเปิดได้ทุกอย่าง ไม่หมดอายุ และเคยหลุดมาแล้ว การเดาหรือการเอา
 * ค่าเก่ามาใช้หลังหมุนจึงต้องเห็นได้ แต่ห้ามเขียนทุกครั้ง: 401 เป็นสิ่งที่ใครก็ยิงได้ไม่จำกัด
 * สคริปต์เดารหัสตัวเดียวก็ท่วม audit_event ได้ ทั้งที่ตารางนั้นไม่มี retention และห้าม update
 *
 * จึงแบ่งเป็นหน้าต่าง 10 นาทีต่อ IP:
 *   - ครั้งแรกในหน้าต่าง → เขียนแถวทันที (เห็นได้ภายในวินาที ไม่ต้องรอ)
 *   - ครั้งถัด ๆ ไปในหน้าต่างเดียวกัน → นับอย่างเดียว
 *   - ตัวกวาดทุก 60 วินาทีปิดหน้าต่างที่ครบ 10 นาที แล้วเขียน **แถวสรุปแถวเดียว**
 *     (`suppressed_count`) ถ้ามีอะไรถูกนับไว้ — แถวที่เขียนไปแล้วไม่ถูกแก้ ตารางเป็น append-only
 *
 * แถวสรุปเก็บ `token_fps` ที่ต่างกันไว้ด้วย (ไม่เกิน 20) ไม่ใช่แค่จำนวน รายการที่เต็มแล้วตัดทิ้ง
 * เงียบ ๆ ไม่ได้ — `token_fps_truncated` บอกว่ามีค่าที่ไม่ได้อยู่ในรายการ คนอ่านจะได้ไม่สรุปผิดว่า
 * token เก่าไม่ถูกลอง ทั้งที่แค่ไม่มีที่ให้จด แต่ธงนั้นบอกได้แค่ว่า "อาจมี" คนที่ยิงค่ามั่ว ๆ 20 ค่า
 * ก่อนแล้วค่อยลอง token เก่ายังซ่อนมันไว้หลังธงได้ จึงมีทางที่สามข้างล่าง (fingerprint ที่เฝ้าไว้)
 *
 * หน้าต่างต่อ IP อย่างเดียวคุมจำนวนแถวไม่ได้: `trust proxy 1` ทำให้ `req.ip` มาจาก
 * X-Forwarded-For และ backend ของ main เปิดตรงที่ 0.0.0.0:4000 คนที่ยิงตรงไม่ผ่าน proxy จึงตั้ง
 * IP เองได้ทุกคำขอ แต่ละค่าได้หน้าต่างใหม่และแถวใหม่ ตัวที่คุมจำนวนแถวจริงคืองบรวม
 * `MAX_IMMEDIATE_ROWS` ต่อ 10 นาที — IP ในแถวเหล่านี้จึงเชื่อได้เท่าที่ X-Forwarded-For เชื่อได้
 * ค่าที่ไม่ใช่ IP เลย (`parseClientIp()`) ใช้หน้าต่างเดียวกันหมด (`UNPARSED_KEY`) ไม่ใช่หน้าต่าง
 * ละค่า และแถวของมันไม่มี IP แต่มี `ip_unparsed: true`
 *
 * แถวของถังรวม (`throttle_overflow`) ทั้งแถวทันทีและแถวสรุปจึง **ไม่มี IP และ user agent**:
 * ถังนั้นรวมทุกแหล่งที่มาหลังงบหมด และเกิดได้เฉพาะตอนถูกยิงจากหลายที่ ซึ่งคือตอนที่ IP ถูกปลอมได้
 * ถ้าแถวทันทีใส่ IP ของคำขอแรกที่ตกลงถังไว้ คนอ่านจะโยนทั้งถังให้ที่อยู่เดียวซึ่งสุ่มมาและอาจปลอม
 *
 * **fingerprint ที่เฝ้าไว้** (`watchedFps`, ของ admin คือ `ADMIN_TOKEN_WATCH_FPS` = token ที่ปลด
 * แล้ว) ได้แถวของตัวเองเสมอ พร้อม `watched_token: true` นอกงบข้างบนทั้งหมด ค่ามั่วจึงเบียดมันไม่ได้
 * เพราะต้องถือ token เก่าตัวจริงถึงจะเข้าทางนี้ งบของมันแยกต่างหาก: ที่มาละแถวต่อนาที รวมไม่เกิน
 * `MAX_WATCHED_ROWS` ต่อ 10 นาที ส่วนที่เกินงบนี้ไหลไปทางปกติ ถูกนับและสรุปเหมือนคำขออื่น แต่ยัง
 * นับแยกไว้ใน `watched_suppressed_count` ของแถวสรุป
 *
 * `path` ที่เก็บเป็นรูปแบบ ไม่ใช่ข้อความที่ผู้ยิงพิมพ์ (`pathPattern()`) — ตารางไม่มี retention
 * ข้อความอิสระในนั้นคือช่องให้คนนอกเขียนอะไรก็ได้ลงหลักฐาน รวมถึงเลขบัตรของคนอื่น
 *
 * ค่าทั้งหมดอยู่ในหน่วยความจำของ process เดียว — backend หลาย replica นับแยกกัน ตัวเลขจึงเป็น
 * ค่าประมาณ (ยอมรับไว้ในแผน) รีสตาร์ตแล้วตัวนับหาย `flushTokenRejections()` ตอน shutdown
 * เขียนสรุปที่ค้างอยู่ให้เท่าที่ทัน
 */
import type { Request } from "express";

import { AuditSubject, logAudit, type AuditActionCode, type AuditSubjectType } from "./audit.js";
import { tokenFingerprint } from "./auth.js";
import { currentContext, parseClientIp, runWithContext } from "./context.js";

const WINDOW_MS = 10 * 60_000;
const SWEEP_MS = 60_000;
/**
 * แถวที่เขียนทันที (ครั้งแรกของหน้าต่าง) ได้ไม่เกินเท่านี้ต่อ 10 นาที **รวมทุก IP** — เกินแล้ว IP
 * ที่ยังไม่มีหน้าต่างไปรวมกันในถังเดียว (`OVERFLOW_KEY`) ซึ่งยังนับและยังได้แถวสรุป
 *
 * กรณีที่ใช้จริง (คนตั้งค่า Postman ผิด token เก่าหลังหมุน) มาจากไม่กี่ที่ 20 แหล่งใน 10 นาทีคือ
 * การยิงแล้ว ตัวเลขนี้จึงไม่บังของจริง แต่ต่อให้ปลอม IP ทุกคำขอ แถวก็ไม่เกินราว 40 ต่อ 10 นาที
 * (ทันที + สรุป + ของถังรวม) ไม่ใช่หนึ่งแถวต่อ IP ปลอม — และเพราะหน้าต่างใหม่เปิดได้เฉพาะตอนที่ยัง
 * มีงบ แผนที่ในหน่วยความจำจึงไม่โตเกินหลักสิบไปด้วย ไม่ต้องมีเพดานจำนวน IP แยกอีกตัว
 */
const MAX_IMMEDIATE_ROWS = 20;
const OVERFLOW_KEY = "\u0000overflow";
/**
 * หน้าต่างเดียวของทุกคำขอที่ `req.ip` ไม่ใช่ IP — ถ้าใช้ค่าดิบเป็น key ทุกค่าที่แต่งขึ้นใหม่จะได้
 * หน้าต่างใหม่และแถวใหม่จนงบหมด ส่วนคำขอที่ไม่มี `req.ip` เลย (socket ปิดไปก่อน) แยกไว้อีกถัง
 * เพราะแถวของมันไม่ควรมีธง `ip_unparsed`
 */
const UNPARSED_KEY = "\u0000unparsed";
const NO_ADDRESS_KEY = "\u0000no-address";
/** fingerprint ที่เฝ้าไว้: แต่ละที่มาได้แถวของตัวเองไม่เกินหนึ่งแถวต่อช่วงนี้ */
const WATCHED_PER_SOURCE_MS = 60_000;
/**
 * ...และรวมทุกที่มาไม่เกินเท่านี้ต่อ 10 นาที — คนที่ถือ token เก่าอยู่จริงก็ใช้การปลอม IP ขยายมัน
 * เป็นน้ำท่วมไม่ได้ หกสิบแถวพอให้เห็นว่ามีการใช้จากกี่ที่ ส่วนที่เกินยังถูกนับในแถวสรุป
 */
const MAX_WATCHED_ROWS = 60;
/** รายการในแถวสรุป (fingerprint · เส้นทาง) เก็บได้ไม่เกินเท่านี้ต่อหน้าต่าง */
const MAX_LISTED = 20;
/** path มาจากผู้ยิง ยาวเท่าไรก็ได้ — ตัดหลังแปลงเป็นรูปแบบแล้ว */
const MAX_PATH = 120;

const UUID_IN_PATH = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
/** เลขบัตรประชาชน เบอร์โทร หรือเลขอะไรก็ตามที่ยาวพอจะชี้ตัวคน — เลขคำขอ (`-2026-0002`) สั้นกว่านี้ */
const LONG_NUMBER = /\d{6,}/g;
const OUTSIDE_PATH_CHARS = /[^A-Za-z0-9/_.:-]/g;

/** บริบทที่แถวหนึ่งถูกเขียนจาก — แถวสรุปเขียนจาก timer ซึ่งไม่มี request ให้อ่าน จึงต้องเก็บไว้ */
interface Origin {
  ipAddress: string | null;
  ipUnparsed: boolean;
  userAgent: string | null;
  sourceComponent: string;
}

interface RejectionWindow {
  startedAt: number;
  lastAt: number;
  suppressed: number;
  /** ในจำนวน `suppressed` มีกี่ครั้งที่เป็น fingerprint ที่เฝ้าไว้ (เกินงบของตัวเองแล้ว) */
  watchedSuppressed: number;
  tokenFps: Set<string>;
  paths: Set<string>;
  /** มีค่าที่ไม่ได้จดเพราะรายการเต็ม — ต้องบอกในแถวสรุป ไม่ใช่ทิ้งเงียบ ๆ */
  truncated: { tokenFps: boolean; paths: boolean };
  /** ถังรวมของ IP ที่มาหลังงบ `MAX_IMMEDIATE_ROWS` หมด — ไม่ได้เป็นของ IP ไหน */
  overflow: boolean;
  /** บริบทของครั้งแรก — ถังรวมไม่มี IP และ user agent (ดูหัวไฟล์) */
  origin: Origin;
}

/** เพิ่มค่าลงรายการของแถวสรุปถ้ายังมีที่ ถ้าเต็มแล้วและเป็นค่าใหม่ให้เรียก `onFull` */
function remember(list: Set<string>, value: string | null, onFull: () => void) {
  if (value === null || list.has(value)) return;
  if (list.size < MAX_LISTED) list.add(value);
  else onFull();
}

/**
 * เส้นทางที่ถูกยิงในรูปที่จัดกลุ่มได้: ไม่เอา query string, UUID → `:id`, เลข 6 หลักขึ้นไป → `:n`,
 * ตัวอักษรนอกชุดที่ path ปกติใช้ → `_` (รวมถึง `%xx` ที่ยังไม่ถอดรหัส) แล้วตัดที่ `MAX_PATH`
 */
function pathPattern(req: Request): string {
  const path = (req.originalUrl ?? req.url).split("?")[0] ?? "";
  return path
    .replace(UUID_IN_PATH, ":id")
    .replace(LONG_NUMBER, ":n")
    .replace(OUTSIDE_PATH_CHARS, "_")
    .slice(0, MAX_PATH);
}

/** งบแถวต่อ `WINDOW_MS` รวมทุกที่มา — คืน false เมื่อหมด */
function createBudget(max: number): (now: number) => boolean {
  let startedAt = 0;
  let used = 0;
  return (now) => {
    if (now - startedAt >= WINDOW_MS) {
      startedAt = now;
      used = 0;
    }
    if (used >= max) return false;
    used += 1;
    return true;
  };
}

export interface TokenRejectionRecorder {
  /** เรียกทุกครั้งที่ปฏิเสธ — ไม่ await ไม่ throw (เขียน audit แบบ fire-and-forget) */
  record(req: Request, provided: string | undefined): void;
}

export interface TokenRejectionOptions {
  /** fingerprint (`tokenFingerprint()`) ของ token ที่ปลดแล้ว — ได้แถวของตัวเองเสมอ ดูหัวไฟล์ */
  watchedFps?: readonly string[];
}

const flushers: Array<() => Promise<void>> = [];

/**
 * สร้างตัวบันทึกหนึ่งตัวต่อชนิด token — ตัวนับของแต่ละชนิดแยกกัน
 * การปฏิเสธ token ผู้ดูแลระบบจึงไม่ไปกินโควตาหน้าต่างของ token ชนิดอื่นจาก IP เดียวกัน
 */
export function createTokenRejectionRecorder(
  action: AuditActionCode,
  subjectType: AuditSubjectType = AuditSubject.ADMIN_API,
  options: TokenRejectionOptions = {},
): TokenRejectionRecorder {
  const windows = new Map<string, RejectionWindow>();
  let sweeper: NodeJS.Timeout | null = null;
  /** งบแถวทันทีของ 10 นาทีปัจจุบัน รวมทุก IP — ดู `MAX_IMMEDIATE_ROWS` */
  const takeBudget = createBudget(MAX_IMMEDIATE_ROWS);

  const watched = new Set(options.watchedFps ?? []);
  const takeWatchedBudget = createBudget(MAX_WATCHED_ROWS);
  /** เวลาที่แต่ละที่มาได้แถว watched ล่าสุด — โตได้ไม่เกินงบ เพราะเพิ่มเฉพาะตอนเขียนแถว */
  const watchedLastAt = new Map<string, number>();

  function takeWatched(source: string, now: number): boolean {
    const last = watchedLastAt.get(source);
    if (last !== undefined && now - last < WATCHED_PER_SOURCE_MS) return false;
    if (!takeWatchedBudget(now)) return false;
    for (const [key, at] of watchedLastAt) {
      if (now - at >= WATCHED_PER_SOURCE_MS) watchedLastAt.delete(key);
    }
    watchedLastAt.set(source, now);
    return true;
  }

  /**
   * เขียนจากที่มาที่ระบุ ไม่ใช่จากบริบทของคำขอ — ไม่งั้นแถวทันทีของถังรวมได้ IP ของคำขอนี้ไปจาก ALS
   * ทั้งที่แถวสรุปของถังเดียวกันไม่มี correlation id ของแถวทันทียังเป็นของคำขอนั้น ตรงกับ header
   * ที่ตอบกลับไป ส่วนแถวสรุปไม่ได้เป็นของคำขอไหน จึงได้ค่าใหม่
   */
  function write(
    origin: Origin,
    correlationId: string | undefined,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    return runWithContext({ ...origin, correlationId }, () =>
      logAudit({ action, subjectType, actorType: "ANONYMOUS", result: "FAILURE", metadata }),
    );
  }

  function summarise(window: RejectionWindow, now: number): Promise<void> {
    if (window.suppressed === 0) return Promise.resolve();
    return write(window.origin, undefined, {
      suppressed_count: window.suppressed,
      window_start: new Date(window.startedAt).toISOString(),
      // ปิดก่อนครบกำหนดได้ตอน shutdown — ใช้เวลาจริงที่ปิด ไม่ใช่เวลาที่ควรปิด
      window_end: new Date(Math.min(now, window.startedAt + WINDOW_MS)).toISOString(),
      last_rejected_at: new Date(window.lastAt).toISOString(),
      token_fps: [...window.tokenFps],
      paths: [...window.paths],
      ...(window.truncated.tokenFps ? { token_fps_truncated: true } : {}),
      ...(window.truncated.paths ? { paths_truncated: true } : {}),
      ...(window.watchedSuppressed > 0 ? { watched_suppressed_count: window.watchedSuppressed } : {}),
      ...(window.overflow ? { throttle_overflow: true } : {}),
    });
  }

  function sweep(now: number) {
    for (const [key, window] of windows) {
      if (now - window.startedAt < WINDOW_MS) continue;
      windows.delete(key);
      void summarise(window, now);
    }
  }

  /**
   * นับเข้าหน้าต่างที่ยังเปิดอยู่ของ `key` — คืน false ถ้าไม่มีหน้าต่างให้นับ ผู้เรียกต้องเปิดใหม่
   * หน้าต่างที่หมดเวลาแต่ตัวกวาดยังไม่มาถึงถูกสรุปทิ้งตรงนี้ก่อน ลำดับแถวจะได้ถูก
   */
  function countInto(
    key: string,
    now: number,
    fp: string | null,
    entry: string,
    watchedToken: boolean,
  ): boolean {
    const open = windows.get(key);
    if (!open) return false;
    if (now - open.startedAt >= WINDOW_MS) {
      windows.delete(key);
      void summarise(open, now);
      return false;
    }
    open.suppressed += 1;
    if (watchedToken) open.watchedSuppressed += 1;
    open.lastAt = now;
    remember(open.tokenFps, fp, () => (open.truncated.tokenFps = true));
    remember(open.paths, entry, () => (open.truncated.paths = true));
    return true;
  }

  flushers.push(async () => {
    const now = Date.now();
    const pending = [...windows.values()];
    windows.clear();
    await Promise.all(pending.map((window) => summarise(window, now)));
  });

  return {
    record(req, provided) {
      try {
        const now = Date.now();
        const fp = provided ? tokenFingerprint(provided) : null;
        const watchedToken = fp !== null && watched.has(fp);
        const path = pathPattern(req);
        const entry = `${req.method} ${path}`;
        // ตัวเดียวกับที่ correlationMiddleware ใช้ — key ของหน้าต่างกับ IP ในแถวจึงตรงกันเสมอ
        const client = parseClientIp(req.ip);
        const source = client.ip ?? (client.unparsed ? UNPARSED_KEY : NO_ADDRESS_KEY);
        const ctx = currentContext();
        const requestOrigin: Origin = {
          ipAddress: client.ip,
          ipUnparsed: client.unparsed,
          userAgent: ctx?.userAgent ?? null,
          sourceComponent: ctx?.sourceComponent ?? "web-portal",
        };
        const details = {
          method: req.method,
          path,
          token_present: Boolean(provided),
          token_fp: fp,
          ...(watchedToken ? { watched_token: true } : {}),
        };

        // token ที่ปลดแล้วได้แถวของตัวเองก่อนอย่างอื่น และไม่แตะหน้าต่างปกติ — แถวนี้ไม่ต้องรอสรุป
        if (watchedToken && takeWatched(source, now)) {
          void write(requestOrigin, ctx?.correlationId, details);
          return;
        }

        let key = source;
        if (countInto(key, now, fp, entry, watchedToken)) return;
        // หน้าต่างใหม่ = แถวทันทีหนึ่งแถว ใช้งบรวมหนึ่งหน่วย งบหมดแล้วนับรวมในถัง overflow แทน
        if (!takeBudget(now)) {
          key = OVERFLOW_KEY;
          if (countInto(key, now, fp, entry, watchedToken)) return;
        }

        const overflow = key === OVERFLOW_KEY;
        const origin: Origin = overflow
          ? { ipAddress: null, ipUnparsed: false, userAgent: null, sourceComponent: requestOrigin.sourceComponent }
          : requestOrigin;
        windows.set(key, {
          startedAt: now,
          lastAt: now,
          suppressed: 0,
          watchedSuppressed: 0,
          tokenFps: new Set(),
          paths: new Set(),
          truncated: { tokenFps: false, paths: false },
          overflow,
          origin,
        });
        if (!sweeper) {
          sweeper = setInterval(() => sweep(Date.now()), SWEEP_MS);
          // ไม่ให้ตัวกวาดเป็นเหตุที่ process ไม่ยอมจบ
          sweeper.unref();
        }

        void write(origin, ctx?.correlationId, {
          ...details,
          ...(overflow ? { throttle_overflow: true } : {}),
        });
      } catch (err) {
        // การบันทึกต้องไม่ทำให้คำตอบ 401 พัง — logAudit กลืน error ของตัวเองอยู่แล้ว ที่นี่กันส่วนที่เหลือ
        console.error("[audit] บันทึกการปฏิเสธ token ไม่สำเร็จ:", err);
      }
    },
  };
}

/** เขียนแถวสรุปของทุกหน้าต่างที่ยังเปิดอยู่ — เรียกตอน shutdown ไม่ throw */
export async function flushTokenRejections(): Promise<void> {
  await Promise.all(flushers.map((flush) => flush().catch(() => undefined)));
}
