import { Prisma } from "@prisma/client";
import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { MulterError } from "multer";

import { prisma } from "./db.js";
import { env } from "./env.js";
import { DocumentRenderError } from "./lib/document-render.js";
import { correlationMiddleware } from "./lib/context.js";
import { loadChoices } from "./lib/dataset-choices.js";
import { flushTokenRejections } from "./lib/token-rejection.js";
import { adminRegistrationRouter } from "./routes/admin-registrations.js";
import { adminRouter } from "./routes/admin.js";
import { adminUserRouter } from "./routes/admin-users.js";
import { addressRouter } from "./routes/address.js";
import { authRouter } from "./routes/auth.js";
import { datasetChoiceRouter } from "./routes/dataset-choices.js";
import { datasetRequestRouter } from "./routes/dataset-requests.js";
import { healthRouter } from "./routes/health.js";
import { notificationRouter } from "./routes/notifications.js";
import { organizationRouter } from "./routes/organizations.js";
import { ensureContainer } from "./storage.js";

const app = express();

app.set("trust proxy", 1);
// credentials: true บังคับให้ต้องระบุ origin เจาะจง ใช้ "*" ไม่ได้
app.use(cors({ origin: env.corsOrigins, credentials: true }));
/**
 * ต้องมาก่อน router ทุกตัว — audit_event, notification และ integration_operation บังคับ
 * correlation_id เป็น NOT NULL และอ่านค่าผ่าน AsyncLocalStorage
 *
 * และต้องมาก่อน `express.json` ด้วย: body ที่อ่านไม่ออกล้มตั้งแต่ตัวแปลง ถ้าตัวนี้อยู่ข้างหลัง คำตอบ 400
 * นั้นไม่มี `x-correlation-id` ให้ผู้เรียกอ้างถึง บริบทไม่หายระหว่างรออ่าน body เพราะ raw-body 2.5.3
 * ผูก callback ด้วย `AsyncResource` (`node_modules/raw-body/index.js` ตรง `AsyncResource.bind`)
 * ตัวแปลงจึงคืนมาใน store เดิม
 */
app.use(correlationMiddleware);
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

app.get("/", (_req, res) => {
  res.json({ service: "d2-api", version: "0.1.0" });
});

app.use("/health", healthRouter);
app.use("/api/auth", authRouter);
app.use("/api/admin/users", adminUserRouter);
// ต้องมาก่อน adminRouter ที่จับ /api/admin ทั้งก้อน ไม่งั้น /registrations/* ตกไปที่ 404 ของมัน
app.use("/api/admin/registrations", adminRegistrationRouter);
app.use("/api/admin", adminRouter);
app.use("/api/address", addressRouter);
app.use("/api/dataset-choices", datasetChoiceRouter);
app.use("/api/organizations", organizationRouter);
app.use("/api/dataset-requests", datasetRequestRouter);
app.use("/api/notifications", notificationRouter);

app.use((_req, res) => {
  res.status(404).json({ error: "not_found", message: "ไม่พบเส้นทางนี้" });
});

/**
 * ข้อผิดพลาดที่ Prisma บอกความหมายมาแล้ว ไม่ควรออกไปเป็น 500
 *
 * 500 `internal` แปลว่า "ระบบพัง ไม่รู้ว่าอะไร" — ถ้าเอาไปตอบเคสที่รู้อยู่แล้วว่าเกิดอะไร
 * (ข้อมูลชนของเดิม · ไม่พบแถวที่อ้าง · ฐานข้อมูลติดต่อไม่ได้) คนเรียกจะไม่มีทางรู้ว่า
 * ต้องแก้อะไร และ log ฝั่งเราคือที่เดียวที่มีคำตอบ ทุก route ควรดักเคสของตัวเองพร้อม
 * ข้อความที่บอกวิธีแก้อยู่แล้ว — ตัวนี้เป็นตะแกรงชั้นสุดท้ายกันเคสที่หลุดมา
 */
const PRISMA_ERRORS: Record<string, { status: number; error: string; message: string }> = {
  // unique constraint — เจอบ่อยสุด: อีเมล/เลขบัตร/รหัสหน่วยงานที่มีอยู่แล้ว
  P2002: { status: 409, error: "conflict", message: "ข้อมูลนี้มีอยู่ในระบบแล้ว" },
  // foreign key — อ้างถึงแถวที่ไม่มีอยู่ หรือลบแถวที่ยังมีคนอ้างถึง
  P2003: { status: 409, error: "conflict", message: "ข้อมูลนี้เชื่อมโยงกับรายการอื่นอยู่" },
  // ค่าที่ยาวเกินความกว้างของคอลัมน์
  P2000: { status: 400, error: "validation", message: "ข้อมูลที่ส่งมายาวเกินกว่าที่ระบบเก็บได้" },
  // อ่าน/เขียนแถวที่ไม่มีอยู่
  P2025: { status: 404, error: "not_found", message: "ไม่พบข้อมูลที่อ้างถึง" },
  // ค่าที่ไม่ใช่รูปแบบของคอลัมน์ เช่น ข้อความที่ไม่ใช่ UUID
  P2023: { status: 400, error: "validation", message: "รูปแบบข้อมูลที่ส่งมาไม่ถูกต้อง" },
  // ต่อฐานข้อมูลไม่ได้ — เป็นเรื่องของ deployment ไม่ใช่ของคำขอ
  P1001: { status: 503, error: "unavailable", message: "ระบบฐานข้อมูลไม่พร้อมใช้งาน กรุณาลองใหม่อีกครั้ง" },
  P1002: { status: 503, error: "unavailable", message: "ระบบฐานข้อมูลไม่พร้อมใช้งาน กรุณาลองใหม่อีกครั้ง" },
  P1008: { status: 503, error: "unavailable", message: "ระบบฐานข้อมูลตอบช้าเกินกำหนด กรุณาลองใหม่อีกครั้ง" },
  P1017: { status: 503, error: "unavailable", message: "ระบบฐานข้อมูลไม่พร้อมใช้งาน กรุณาลองใหม่อีกครั้ง" },
  /**
   * connection pool เต็ม — รอ connection จนหมดเวลา
   *
   * เป็นเรื่องของภาระ ไม่ใช่ของคำขอ จึงเป็น 503 เหมือน P1001 ไม่ใช่ 500 เพิ่มเข้ามาเมื่อ
   * หน้ารายละเอียดคำขอเริ่ม poll สถานะทุก 15 วินาที ซึ่งทำให้จำนวน request พร้อมกันขึ้นกับ
   * จำนวนคนที่เปิดหน้าค้างไว้ ไม่ใช่จำนวนคนที่กดปุ่มอีกต่อไป — pool ใช้ค่า default ของ
   * Prisma (`cpus*2+1`) ยังไม่เคยตั้งใน DATABASE_URL
   */
  P2024: { status: 503, error: "unavailable", message: "ระบบกำลังมีผู้ใช้งานหนาแน่น กรุณาลองใหม่อีกครั้ง" },
};

/**
 * error ของตัวแปลง body (`express.json`) — มี `status` เป็นตัวเลขต่ำกว่า 500 และ `type` เป็นข้อความ
 * เช่น `entity.parse.failed` หรือ `entity.too.large` (ตาม http-errors ที่ body-parser ใช้)
 */
function isBodyParserError(err: unknown): err is { status: number; type: string } {
  if (typeof err !== "object" || err === null) return false;
  const { status, type } = err as { status?: unknown; type?: unknown };
  return typeof status === "number" && status < 500 && typeof type === "string";
}

app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  /**
   * ส่งหัวคำตอบไปแล้ว (เช่นสตรีมไฟล์ขาดกลางทาง) — ตอบใหม่ไม่ได้ ส่งต่อให้ตัวจัดการของ Express ซึ่ง
   * ปิดการเชื่อมต่อ ไม่งั้น `res.status()` ข้างล่างจะ throw ซ้อนเข้าไปอีกชั้น
   */
  if (res.headersSent) {
    console.error("[backend] error after the response had started:", err);
    next(err);
    return;
  }

  /**
   * body ที่อ่านไม่ออกหรือใหญ่เกิน — ความผิดของคำขอ ไม่ใช่ของระบบ จึงไม่ใช่ 500
   *
   * **ห้ามพิมพ์ error ตัวนี้** แม้แต่ข้อความ: error ของ `entity.parse.failed` ถือ `body` ดิบไว้ทั้งก้อน
   * และข้อความก็ยกบางส่วนของ body มา เดิมมันตกไปที่ `console.error(err)` ข้างล่าง JSON ของหน้า login
   * ที่ส่งมาไม่ครบจึงพา**รหัสผ่านตัวจริง**ลง docker logs ไปด้วย 4xx อื่นของระบบก็ไม่พิมพ์อยู่แล้ว
   */
  if (isBodyParserError(err)) {
    if (err.status === 413) {
      res.status(413).json({
        error: "payload_too_large",
        message: "ข้อมูลที่ส่งมามีขนาดเกิน 1 MB — ไฟล์แนบให้อัปโหลดผ่านช่องแนบไฟล์ ไม่ใช่ส่งรวมมากับข้อมูล",
      });
      return;
    }
    res.status(400).json({
      error: "validation",
      message: "อ่านข้อมูลที่ส่งมาไม่ได้ — ต้องเป็น JSON ที่สมบูรณ์ กรุณาตรวจสอบแล้วส่งใหม่อีกครั้ง",
    });
    return;
  }

  if (err instanceof MulterError) {
    const message =
      err.code === "LIMIT_FILE_SIZE" ? "ไฟล์มีขนาดเกิน 10 MB" : "อัปโหลดไฟล์ไม่สำเร็จ";
    res.status(400).json({ error: "upload", message });
    return;
  }

  /**
   * เอกสารกฎหมาย: template ผิดรูป ตัวแปลงไม่ตอบ หรือยังไม่มีเอกสารเผยแพร่
   *
   * ทุกกรณีมีสาเหตุที่บอกได้เป็นคำพูด และ DocumentRenderError ถือ status มาเองแล้ว
   * (400 = ไฟล์ที่อัปโหลดผิด · 503 = ตัวแปลงหรือเอกสารต้นแบบยังไม่พร้อม)
   */
  if (err instanceof DocumentRenderError) {
    console.error(`[backend] ${err.code}:`, err.message);
    res.status(err.status).json({ error: err.code, message: err.message, fields: err.fields });
    return;
  }

  /**
   * ต่อฐานข้อมูลไม่ติดมาได้สองคลาส และมันไม่ได้เก็บรหัสไว้ในฟิลด์ชื่อเดียวกัน:
   * ถ้า pool เคยต่อติดแล้วสายหลุด Prisma โยน `PrismaClientKnownRequestError` code P1001
   * แต่ถ้าต่อไม่ติดตั้งแต่แรกจะเป็น `PrismaClientInitializationError` ที่เก็บรหัสไว้ใน
   * `errorCode` — ดักแค่คลาสแรกจึงยังตอบ 500 อยู่ตอนฐานข้อมูลดับทั้งตัว
   */
  const prismaCode =
    err instanceof Prisma.PrismaClientKnownRequestError
      ? err.code
      : err instanceof Prisma.PrismaClientInitializationError
        ? err.errorCode
        : undefined;

  const known = prismaCode ? PRISMA_ERRORS[prismaCode] : undefined;
  if (known) {
    // log ไว้ทุกครั้ง: การหลุดมาถึงตะแกรงนี้แปลว่ามี route ที่ยังไม่ได้ดักเคสของตัวเอง
    console.error(`[backend] ${prismaCode} not handled by its route:`, (err as Error).message);
    res.status(known.status).json({ error: known.error, message: known.message });
    return;
  }

  // เริ่มต้น client ไม่สำเร็จเลย = ระบบยังไม่พร้อม ไม่ใช่ความผิดของคำขอ ตอบ 503 ไว้ก่อน
  // แม้จะไม่รู้รหัส เพราะ 500 จะทำให้คนเรียกไปหาสาเหตุผิดที่
  if (err instanceof Prisma.PrismaClientInitializationError) {
    console.error("[backend] prisma could not initialise:", err.message);
    res
      .status(503)
      .json({ error: "unavailable", message: "ระบบฐานข้อมูลไม่พร้อมใช้งาน กรุณาลองใหม่อีกครั้ง" });
    return;
  }

  console.error("[backend] unhandled error:", err);
  res.status(500).json({ error: "internal", message: "เกิดข้อผิดพลาดภายในระบบ" });
});

async function main() {
  /**
   * ตัวเลือกของแบบฟอร์มชุดข้อมูลอยู่ในฐานข้อมูล แต่ผู้ใช้ของมัน (zod schema, ชื่อช่องติ๊ก)
   * ถูกประเมินตั้งแต่ตอน import แล้ว จึงต้องโหลดเข้า cache ให้เสร็จก่อนเปิดรับ request
   * โหลดไม่ได้ก็ไม่ล้ม — ใช้ค่าตั้งต้นในโค้ดไปก่อนและเตือนไว้ ดู lib/dataset-choices.ts
   */
  await loadChoices();

  // Best-effort: don't block startup if Azure Blob Storage is briefly unavailable —
  // /health/ready will report it.
  await ensureContainer().catch((err) => {
    console.warn(`[startup] could not ensure container: ${err.message}`);
  });

  const server = app.listen(env.port, () => {
    console.log(`[backend] listening on http://localhost:${env.port}`);
    if (!env.smtp.enabled) {
      console.log("[backend] SMTP ยังไม่ได้ตั้งค่า — อีเมลจะถูกพิมพ์ลง log แทนการส่งจริง");
    }
    // บอกไว้ตั้งแต่บูตว่าเลขบัตรจะมาจาก claim ไหน เวลาไล่ปัญหาจะได้ไม่ต้องเดา
    if (!env.thaid.usePid) {
      console.log("[backend] THAID_USE_PID=false — ใช้ claim `sub` เป็นเลขประจำตัวประชาชน");
    }
  });

  const shutdown = async (signal: string) => {
    console.log(`[backend] ${signal} received, shutting down`);
    server.close();
    // แถวสรุปของ token ที่ถูกปฏิเสธยังค้างอยู่ในหน่วยความจำ — เขียนให้เท่าที่ทันภายใน 2 วินาที
    // ไม่รอนานกว่านั้น เพราะ compose ให้เวลาทั้งหมด 10 วินาทีก่อน SIGKILL
    await Promise.race([flushTokenRejections(), new Promise((resolve) => setTimeout(resolve, 2_000))]);
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
