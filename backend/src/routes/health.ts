import { Router } from "../lib/async-route.js";

import { pingDatabase } from "../db.js";
import { choiceStatus } from "../lib/dataset-choices.js";
import { logStoreStatus } from "../lib/log-store.js";
import { pingStorage } from "../storage.js";

export const healthRouter = Router();

/** Liveness: is the process up? No dependencies touched. */
healthRouter.get("/live", (_req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

type CheckResult = { status: "up" } | { status: "down"; error: string };

async function check(fn: () => Promise<unknown>): Promise<CheckResult> {
  try {
    await fn();
    return { status: "up" };
  } catch (err) {
    return { status: "down", error: err instanceof Error ? err.message : String(err) };
  }
}

/** Readiness: can we actually serve traffic? Checks Postgres and Azure Blob Storage. */
healthRouter.get("/ready", async (_req, res) => {
  const [database, storage] = await Promise.all([check(pingDatabase), check(pingStorage)]);

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
