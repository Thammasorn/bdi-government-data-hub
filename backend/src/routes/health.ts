import { Router } from "express";

import { pingDatabase } from "../db.js";
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

/** Readiness: can we actually serve traffic? Checks Postgres and MinIO. */
healthRouter.get("/ready", async (_req, res) => {
  const [database, storage] = await Promise.all([check(pingDatabase), check(pingStorage)]);

  const healthy = database.status === "up" && storage.status === "up";
  res.status(healthy ? 200 : 503).json({
    status: healthy ? "ok" : "degraded",
    checks: { database, storage },
  });
});
