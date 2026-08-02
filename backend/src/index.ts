import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { MulterError } from "multer";

import { prisma } from "./db.js";
import { env } from "./env.js";
import { adminRouter } from "./routes/admin.js";
import { addressRouter } from "./routes/address.js";
import { authRouter } from "./routes/auth.js";
import { healthRouter } from "./routes/health.js";
import { organizationRouter } from "./routes/organizations.js";
import { ensureBucket } from "./storage.js";

const app = express();

app.set("trust proxy", 1);
// credentials: true บังคับให้ต้องระบุ origin เจาะจง ใช้ "*" ไม่ได้
app.use(cors({ origin: env.corsOrigins, credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

app.get("/", (_req, res) => {
  res.json({ service: "bdi-datahub-api", version: "0.1.0" });
});

app.use("/health", healthRouter);
app.use("/api/auth", authRouter);
app.use("/api/admin", adminRouter);
app.use("/api/address", addressRouter);
app.use("/api/organizations", organizationRouter);

app.use((_req, res) => {
  res.status(404).json({ error: "not_found", message: "ไม่พบเส้นทางนี้" });
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof MulterError) {
    const message =
      err.code === "LIMIT_FILE_SIZE" ? "ไฟล์มีขนาดเกิน 10 MB" : "อัปโหลดไฟล์ไม่สำเร็จ";
    res.status(400).json({ error: "upload", message });
    return;
  }
  console.error("[backend] unhandled error:", err);
  res.status(500).json({ error: "internal", message: "เกิดข้อผิดพลาดภายในระบบ" });
});

async function main() {
  // Best-effort: don't block startup if MinIO is briefly unavailable —
  // /health/ready will report it.
  await ensureBucket().catch((err) => {
    console.warn(`[startup] could not ensure bucket: ${err.message}`);
  });

  const server = app.listen(env.port, () => {
    console.log(`[backend] listening on http://localhost:${env.port}`);
    if (!env.smtp.enabled) {
      console.log("[backend] SMTP ยังไม่ได้ตั้งค่า — อีเมลจะถูกพิมพ์ลง log แทนการส่งจริง");
    }
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
