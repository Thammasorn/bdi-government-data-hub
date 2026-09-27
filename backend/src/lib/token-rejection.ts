/**
 * บันทึกการปฏิเสธ shared-secret token (`x-admin-token`) ลง audit_event — แบบ throttle ต่อ IP
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
 * แถวสรุปเก็บ `token_fps` ที่ต่างกันไว้ด้วย (ไม่เกิน 20) ไม่ใช่แค่จำนวน: คนที่ยิงค่ามั่ว ๆ ก่อน
 * แล้วค่อยลอง token เก่าที่หลุดไป ต้องไม่ทำให้ fingerprint ของ token เก่าหายไปในตัวนับ รายการ
 * ที่เต็มแล้วตัดทิ้งเงียบ ๆ ไม่ได้ — `token_fps_truncated` บอกว่ามีค่าที่ไม่ได้อยู่ในรายการ
 * คนอ่านจะได้ไม่สรุปผิดว่า token เก่าไม่ถูกลอง ทั้งที่แค่ไม่มีที่ให้จด
 *
 * ค่าทั้งหมดอยู่ในหน่วยความจำของ process เดียว — backend หลาย replica นับแยกกัน ตัวเลขจึงเป็น
 * ค่าประมาณ (ยอมรับไว้ในแผน) รีสตาร์ตแล้วตัวนับหาย `flushTokenRejections()` ตอน shutdown
 * เขียนสรุปที่ค้างอยู่ให้เท่าที่ทัน
 */
import type { Request } from "express";

import { AuditSubject, logAudit, type AuditActionCode, type AuditSubjectType } from "./audit.js";
import { tokenFingerprint } from "./auth.js";
import { currentContext, runWithContext } from "./context.js";

const WINDOW_MS = 10 * 60_000;
const SWEEP_MS = 60_000;
/**
 * เกินจำนวนนี้ IP ใหม่ทั้งหมดไปรวมกันในถังเดียว (`OVERFLOW_KEY`) — ยังนับและยังได้แถวสรุป
 * แต่แผนที่ในหน่วยความจำไม่โตตามจำนวน IP ของคนที่ยิงกระจายมาจากหลายเครื่อง
 */
const MAX_TRACKED_IPS = 5_000;
const OVERFLOW_KEY = "\u0000overflow";
/** รายการในแถวสรุป (fingerprint · เส้นทาง) เก็บได้ไม่เกินเท่านี้ต่อหน้าต่าง */
const MAX_LISTED = 20;
/** path มาจากผู้ยิง ยาวเท่าไรก็ได้ — ตัดไว้ก่อนลงคอลัมน์ Json */
const MAX_PATH = 200;

const UUID_IN_PATH = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

interface RejectionWindow {
  startedAt: number;
  lastAt: number;
  suppressed: number;
  tokenFps: Set<string>;
  paths: Set<string>;
  /** มีค่าที่ไม่ได้จดเพราะรายการเต็ม — ต้องบอกในแถวสรุป ไม่ใช่ทิ้งเงียบ ๆ */
  truncated: { tokenFps: boolean; paths: boolean };
  /** ถังรวมของ IP ที่เกิน `MAX_TRACKED_IPS` — ไม่ได้เป็นของ IP ไหน */
  overflow: boolean;
  /** บริบทของครั้งแรก — แถวสรุปเขียนจาก timer ซึ่งไม่มี request ให้อ่าน */
  ipAddress: string | null;
  userAgent: string | null;
  sourceComponent: string;
}

/** เพิ่มค่าลงรายการของแถวสรุปถ้ายังมีที่ ถ้าเต็มแล้วและเป็นค่าใหม่ให้เรียก `onFull` */
function remember(list: Set<string>, value: string | null, onFull: () => void) {
  if (value === null || list.has(value)) return;
  if (list.size < MAX_LISTED) list.add(value);
  else onFull();
}

/** เส้นทางที่ถูกยิง ไม่เอา query string และแทน UUID ด้วย `:id` ให้จัดกลุ่มได้ */
function pathPattern(req: Request): string {
  const path = (req.originalUrl ?? req.url).split("?")[0] ?? "";
  return path.replace(UUID_IN_PATH, ":id").slice(0, MAX_PATH);
}

export interface TokenRejectionRecorder {
  /** เรียกทุกครั้งที่ปฏิเสธ — ไม่ await ไม่ throw (เขียน audit แบบ fire-and-forget) */
  record(req: Request, provided: string | undefined): void;
}

const flushers: Array<() => Promise<void>> = [];

/**
 * สร้างตัวบันทึกหนึ่งตัวต่อชนิด token — ตัวนับของแต่ละชนิดแยกกัน
 * การปฏิเสธ token ผู้ดูแลระบบจึงไม่ไปกินโควตาหน้าต่างของ token ชนิดอื่นจาก IP เดียวกัน
 */
export function createTokenRejectionRecorder(
  action: AuditActionCode,
  subjectType: AuditSubjectType = AuditSubject.ADMIN_API,
): TokenRejectionRecorder {
  const windows = new Map<string, RejectionWindow>();
  let sweeper: NodeJS.Timeout | null = null;

  function summarise(window: RejectionWindow, now: number): Promise<void> {
    if (window.suppressed === 0) return Promise.resolve();
    return runWithContext(
      {
        ipAddress: window.ipAddress,
        userAgent: window.userAgent,
        sourceComponent: window.sourceComponent,
      },
      () =>
        logAudit({
          action,
          subjectType,
          actorType: "ANONYMOUS",
          result: "FAILURE",
          metadata: {
            suppressed_count: window.suppressed,
            window_start: new Date(window.startedAt).toISOString(),
            // ปิดก่อนครบกำหนดได้ตอน shutdown — ใช้เวลาจริงที่ปิด ไม่ใช่เวลาที่ควรปิด
            window_end: new Date(Math.min(now, window.startedAt + WINDOW_MS)).toISOString(),
            last_rejected_at: new Date(window.lastAt).toISOString(),
            token_fps: [...window.tokenFps],
            paths: [...window.paths],
            ...(window.truncated.tokenFps ? { token_fps_truncated: true } : {}),
            ...(window.truncated.paths ? { paths_truncated: true } : {}),
            ...(window.overflow ? { throttle_overflow: true } : {}),
          },
        }),
    );
  }

  function sweep(now: number) {
    for (const [key, window] of windows) {
      if (now - window.startedAt < WINDOW_MS) continue;
      windows.delete(key);
      void summarise(window, now);
    }
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
        const path = pathPattern(req);

        let key = req.ip ?? "unknown";
        if (!windows.has(key) && windows.size >= MAX_TRACKED_IPS) key = OVERFLOW_KEY;

        const open = windows.get(key);
        if (open && now - open.startedAt < WINDOW_MS) {
          open.suppressed += 1;
          open.lastAt = now;
          remember(open.tokenFps, fp, () => (open.truncated.tokenFps = true));
          remember(open.paths, `${req.method} ${path}`, () => (open.truncated.paths = true));
          return;
        }
        // หน้าต่างเก่าหมดเวลาแต่ตัวกวาดยังไม่มาถึง — สรุปก่อนเปิดใหม่ ลำดับแถวจะได้ถูก
        if (open) {
          windows.delete(key);
          void summarise(open, now);
        }

        const ctx = currentContext();
        const overflow = key === OVERFLOW_KEY;
        windows.set(key, {
          startedAt: now,
          lastAt: now,
          suppressed: 0,
          tokenFps: new Set(),
          paths: new Set(),
          truncated: { tokenFps: false, paths: false },
          overflow,
          ipAddress: overflow ? null : (ctx?.ipAddress ?? req.ip ?? null),
          userAgent: ctx?.userAgent ?? null,
          sourceComponent: ctx?.sourceComponent ?? "web-portal",
        });
        if (!sweeper) {
          sweeper = setInterval(() => sweep(Date.now()), SWEEP_MS);
          // ไม่ให้ตัวกวาดเป็นเหตุที่ process ไม่ยอมจบ
          sweeper.unref();
        }

        void logAudit({
          action,
          subjectType,
          actorType: "ANONYMOUS",
          result: "FAILURE",
          metadata: {
            method: req.method,
            path,
            token_present: Boolean(provided),
            token_fp: fp,
            ...(overflow ? { throttle_overflow: true } : {}),
          },
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
