import cors from "cors";
import express from "express";

import { prisma } from "./db.js";
import { env } from "./env.js";
import { healthRouter } from "./routes/health.js";
import { ensureBucket } from "./storage.js";

const app = express();

app.use(cors({ origin: env.corsOrigin }));
app.use(express.json());

app.get("/", (_req, res) => {
  res.json({ service: "bdi-backend", version: "0.1.0" });
});

app.use("/health", healthRouter);

app.use((_req, res) => {
  res.status(404).json({ error: "Not Found" });
});

async function main() {
  // Best-effort: don't block startup if MinIO is briefly unavailable —
  // /health/ready will report it.
  await ensureBucket().catch((err) => {
    console.warn(`[startup] could not ensure bucket: ${err.message}`);
  });

  const server = app.listen(env.port, () => {
    console.log(`[backend] listening on http://localhost:${env.port}`);
  });

  const shutdown = async (signal: string) => {
    console.log(`[backend] ${signal} received, shutting down`);
    server.close();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("[backend] fatal startup error:", err);
  process.exit(1);
});
