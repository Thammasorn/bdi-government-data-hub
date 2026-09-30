import { Router } from "../lib/async-route.js";

import { pingDatabase } from "../db.js";
import { choiceStatus } from "../lib/dataset-choices.js";
import { captureError } from "../lib/error-capture.js";
import { logStoreStatus } from "../lib/log-store.js";
import { pingStorage } from "../storage.js";

export const healthRouter = Router();

/** Liveness: is the process up? No dependencies touched. */
healthRouter.get("/live", (_req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

/**
 * ผลของแต่ละการตรวจ — **คำเดียว** เหมือน logStore ข้างล่าง ไม่มีข้อความของ error
 *
 * endpoint นี้เปิดสาธารณะ (เว็บสาธารณะชี้มาที่ backend ตรง) เดิมตอบ `err.message` ดิบ ซึ่งบอกคนนอกว่าข้างในมีอะไร:
 * `getaddrinfo EAI_AGAIN azurite` (หยุด azurite แล้วลองจริง 2026-09-30), ชื่อ host กับพอร์ตของ Postgres จาก Prisma
 * (`Can't reach database server at …`) และข้อความของ Azure SDK ที่ยก URL ของบัญชีมาได้ สาเหตุไปอยู่ที่ captureError แทน
 * (บรรทัด `[capture]` ใน log ของ backend และ error_events) ซึ่งคนในหาได้
 */
type CheckResult = { status: "up" | "down" };

/** สาเหตุของการตรวจที่ล้มเก็บได้ไม่ถี่กว่านี้ต่อการตรวจ — probe ที่ยิงทุกไม่กี่วินาทีระหว่างที่ระบบล่มต้องไม่ท่วม log */
const CAPTURE_EVERY_MS = 60_000;
const lastCaptured = new Map<string, number>();

async function check(name: "database" | "storage", fn: () => Promise<unknown>): Promise<CheckResult> {
  try {
    await fn();
    return { status: "up" };
  } catch (err) {
    const now = Date.now();
    if (now - (lastCaptured.get(name) ?? 0) >= CAPTURE_EVERY_MS) {
      lastCaptured.set(name, now);
      captureError(err, { tag: `health.${name}`, fingerprint: `health:${name}` });
    }
    return { status: "down" };
  }
}

/** Readiness: can we actually serve traffic? Checks Postgres and Azure Blob Storage. */
healthRouter.get("/ready", async (_req, res) => {
  const [database, storage] = await Promise.all([check("database", pingDatabase), check("storage", pingStorage)]);

  /**
   * ตัวเลือกของแบบฟอร์มชุดข้อมูลรายงานไว้ให้เห็น แต่ **ไม่ร่วมตัดสิน** healthy —
   * source: "defaults" แปลว่ายังไม่ได้รัน seed:masters ซึ่งควรแก้ แต่ระบบยังให้บริการได้
   * ถ้าปล่อยให้ตอบ 503 reverse proxy จะถอนเว็บสาธารณะออก ซึ่งตรงข้ามกับเหตุผลที่มี fallback
   */
  const datasetChoices = choiceStatus();

  /**
   * log store (MongoDB) ก็รายงานไว้ให้เห็นแต่ **ไม่ร่วมตัดสิน** healthy ด้วยเหตุผลเดียวกัน และแรงกว่า: สคริปต์
   * deploy รัน `curl -fsS /health/ready` ใต้ `set -e` ถ้า Mongo ล่มแล้วตัวนี้ตอบ 503 การ deploy ทั้งหมดจะหยุด
   * กลางทาง ทั้งที่เว็บให้บริการได้ครบ
   *
   * อ่านจากสถานะที่ log-store.ts ตรวจไว้เบื้องหลังทุก 30 วินาที probe นี้จึงไม่รอ Mongo เลย และตอบแค่คำเดียว
   * (up / down / disabled / over_quota) — endpoint นี้เปิดสาธารณะ ข้อความของ error อยู่ใน log ของ process
   */
  const logStore = logStoreStatus();

  const healthy = database.status === "up" && storage.status === "up";
  res.status(healthy ? 200 : 503).json({
    status: healthy ? "ok" : "degraded",
    checks: { database, storage, datasetChoices, logStore },
  });
});
