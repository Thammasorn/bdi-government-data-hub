import { Prisma } from "@prisma/client";
import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { MulterError } from "multer";

import { prisma } from "./db.js";
import { env } from "./env.js";
import { adminTokenLooksWeak } from "./lib/auth.js";
import { DocumentRenderError } from "./lib/document-render.js";
import { correlationMiddleware, currentContext, referenceOf } from "./lib/context.js";
import { loadChoices } from "./lib/dataset-choices.js";
import {
  FLUSH_ON_EXIT_MS,
  captureError,
  exitAfterFatal,
  flushErrors,
  initErrorCapture,
  recordRuntimeEvent,
} from "./lib/error-capture.js";
import { closeLogStore, startLogStore } from "./lib/log-store.js";
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

/**
 * body ที่อ่านไม่ได้ด้วยความผิดของคำขอ — ตัวแปลง body ล้มด้วย status 4xx
 *
 * ตัวนี้**ไม่ถือ error เดิมไว้** ตั้งใจ: error ของ `entity.parse.failed` ถือ body ดิบไว้ทั้งก้อน
 * (และข้อความของ V8 ก็ยกบางส่วนมา) ห่อไว้ก็ยังมีทางหลุดไปถึง `console.error` สักวัน ทิ้งไปเลย
 * เหลือแค่ status ที่ใช้ตอบ
 */
class RequestBodyError extends Error {
  constructor(readonly status: number) {
    super(`request body rejected with ${status}`);
  }
}

const jsonBody = express.json({ limit: "1mb" });

/**
 * `express.json` ที่ติดป้าย error **จากต้นทาง** — ไม่ใช่เดาจากรูปร่างของ error ที่ปลายทาง
 *
 * เดิมตัวจัดการ error ท้ายไฟล์ดูว่า error มี `type` เป็นข้อความหรือเปล่า แต่ body-parser ไม่ได้ใส่
 * `type` ให้ทุกตัว: body ที่บีบอัดมาเสีย (`Content-Encoding: gzip`/`deflate` แต่ข้างในไม่ใช่) ออกมาเป็น
 * `createError(400, zlibError)` ซึ่งมีแค่ `status` กับ `expose` ไม่มี `type` จึงหลุดไปถึง 500 `internal`
 * แถมถูกพิมพ์เป็น unhandled error (ลองกับ stack ที่รันอยู่แล้ว 2026-09-29) — การเดาจากรูปร่างพลาดได้
 * อีกเมื่อ body-parser เปลี่ยนรุ่น ส่วนการดูว่ามาจากไหนไม่พลาด
 *
 * 4xx ทุกตัวจากตรงนี้คือความผิดของคำขอ (อ่านไม่ออก · ใหญ่เกิน · charset/การบีบอัดที่ไม่รองรับ ·
 * ส่งมาไม่ครบ) ส่วน 5xx ของมัน (เช่น stream ถูกอ่านไปก่อนแล้ว) เป็นความผิดของเรา ปล่อยผ่านไปตามเดิม
 * ให้ถูกพิมพ์ — error กลุ่มนั้นของ raw-body ไม่ได้ถือ body ไว้
 *
 * callback ของ body-parser กลับมาใน store ของ `correlationMiddleware` อยู่แล้ว (ดูข้างล่าง) การห่อ
 * ชั้นนี้ไม่ได้เปลี่ยนเรื่องนั้น
 */
function parseJsonBody(req: Request, res: Response, next: NextFunction) {
  jsonBody(req, res, (err?: unknown) => {
    if (!err) return next();
    const status = (err as { status?: unknown }).status;
    next(typeof status === "number" && status >= 400 && status < 500 ? new RequestBodyError(status) : err);
  });
}

/**
 * ทุกคำตอบ 5xx ของ API มีรหัสอ้างอิง — `reference` ในตัว body และต่อท้าย `message` (decision 18 ใน plan)
 *
 * toast ของหน้าเว็บส่วนใหญ่แสดง `message` ของ ApiError ตรง ๆ รหัสที่อยู่ในข้อความจึงถึงตาผู้ใช้โดยไม่ต้องแก้หน้าไหน
 * ผู้ใช้อ่านรหัสให้เจ้าหน้าที่ฟังแล้วค้นย้อนหา error event และแถว audit ของคำขอนั้นได้ (8 ตัวแรกของ correlation id)
 * ทำที่ `res.json` ของทุกคำขอแทนการไล่เติมทีละจุด: 503 ของ route เอง (`no_reviewer`, ตัวแปลงเอกสารไม่พร้อม, ThaID 502)
 * ได้ด้วยโดยไม่ต้องจำ แตะเฉพาะ body ที่เป็น error ของ API (`{error: "…"}`) — `/health/ready` ที่ตอบ 503 ไม่เปลี่ยนรูป
 */
function referenceOnServerErrors(_req: Request, res: Response, next: NextFunction) {
  const ctx = currentContext();
  if (!ctx) return next();
  const reference = referenceOf(ctx.correlationId);
  const json = res.json.bind(res);
  res.json = ((body?: unknown) => {
    if (res.statusCode < 500 || !body || typeof body !== "object" || Array.isArray(body)) return json(body);
    const fields = body as Record<string, unknown>;
    if (typeof fields.error !== "string") return json(body);
    const message =
      typeof fields.message === "string" && !fields.message.includes("รหัสอ้างอิง")
        ? `${fields.message} (รหัสอ้างอิง ${reference})`
        : fields.message;
    return json({ ...fields, message, reference });
  }) as Response["json"];
  next();
}

app.set("trust proxy", 1);
/**
 * credentials: true บังคับให้ต้องระบุ origin เจาะจง ใช้ "*" ไม่ได้
 * `x-correlation-id` ต้องประกาศว่าให้เบราว์เซอร์อ่านได้ — checkout dev เรียก backend ข้าม origin (new-dev.sh) และ
 * header ที่ไม่ได้ประกาศถูกซ่อนจาก JavaScript ทั้งที่มาถึงเบราว์เซอร์แล้ว
 */
app.use(cors({ origin: env.corsOrigins, credentials: true, exposedHeaders: ["x-correlation-id"] }));
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
app.use(referenceOnServerErrors);
app.use(parseJsonBody);
app.use(cookieParser());

app.get("/", (_req, res) => {
  // release = SHA ที่ build image นี้ (dev: `dev`) — บอกได้จากภายนอกว่ากำลังรันรุ่นไหนอยู่ ดู env.ts
  res.json({ service: "d2-api", version: "0.1.0", release: env.release });
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
 * ที่เกิดของ error ในรูปที่ใช้จัดกลุ่ม — method + route แบบแม่แบบที่ `wrap()` จดไว้ ไม่ใช่ path จริงที่มี id
 * error จาก guard ที่ติดตั้งด้วย `router.use` (ยังไม่ถึง route) ไม่มีแม่แบบ ได้ `-` แทน ไม่ใช้ path เพราะ id ใน path
 * จะทำให้ issue แตกเป็นหนึ่งตัวต่อหนึ่ง id
 */
function routeKey(req: Request): string {
  return `${req.method} ${currentContext()?.route ?? "-"}`;
}

app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  /**
   * ส่งหัวคำตอบไปแล้ว (route ที่เริ่มเขียน body แล้วค่อยล้ม หรือตอบเสร็จแล้วค่อย throw) — ตอบใหม่ไม่ได้ และ
   * `res.status()` ข้างล่างจะ throw ซ้อนเข้าไปอีกชั้น เก็บ (captureError พิมพ์บรรทัดที่กวาดแล้วหนึ่งบรรทัด) แล้วปิดการ
   * เชื่อมต่อเองถ้าคำตอบยังค้างครึ่งทาง ผู้เรียกจะได้ไม่รอ body ที่ไม่มีวันมาครบ
   *
   * **ไม่ส่งต่อ `next(err)`** ให้ตัวจัดการของ Express อย่างที่เคยทำ: finalhandler ของมันพิมพ์ `err.stack` ดิบ
   * (`logerror`) ก่อนปิด socket และ stack ดิบของ Prisma ยกแถวทั้งแถวมาได้ — ที่นี่ทำสิ่งเดียวกับที่มันทำ (ทำลาย socket)
   * โดยไม่พิมพ์ สตรีมไฟล์แนบที่ขาดกลางทาง**ไม่**มาถึงที่นี่: `streamAttachment()` ใช้ `pipe()` ซึ่งไม่ส่ง error ต่อให้ `next`
   */
  if (res.headersSent) {
    captureError(err, { req, status: res.statusCode, tag: "http.after-headers-sent" });
    if (!res.writableEnded) res.destroy();
    return;
  }

  /**
   * body ที่อ่านไม่ออก ใหญ่เกิน หรือเข้ารหัสแบบที่ไม่รองรับ — ความผิดของคำขอ ไม่ใช่ของระบบ จึงไม่ใช่ 500
   *
   * **ไม่พิมพ์อะไรเลย** เพราะ error ต้นทางถือ body ดิบไว้: `entity.parse.failed` เก็บทั้งก้อนใน `err.body`
   * และข้อความก็ยกบางส่วนของ body มา เดิมมันตกไปที่ `console.error(err)` ข้างล่าง JSON ของหน้า login
   * ที่ส่งมาไม่ครบจึงพา**รหัสผ่านตัวจริง**ลง docker logs ไปด้วย เหตุผลมีแค่นั้น — ไม่ใช่ว่า 4xx ของ
   * ไฟล์นี้ไม่พิมพ์กันทั้งหมด: `DocumentRenderError` 400 กับรหัส Prisma ที่แปลงเป็น 4xx ข้างล่างพิมพ์เสมอ
   * เพราะเป็นร่องรอยเดียวของ route ที่ยังไม่ดักเคสของตัวเอง
   *
   * `RequestBodyError` ไม่ถือ error เดิมไว้ตั้งแต่ `parseJsonBody()` แล้ว สาขานี้จึงไม่มีอะไรให้พิมพ์พลาด
   *
   * เก็บลง log store เป็น warning (ไม่มี body เพราะมันไม่ถืออะไรไว้ และไม่พิมพ์ — ผู้เรียกยิงถี่ได้เท่าที่ต้องการ)
   * ให้เห็นว่ามีคนส่ง JSON เสียมาบ่อยแค่ไหน แยก issue ตาม status
   */
  if (err instanceof RequestBodyError) {
    captureError(err, {
      req,
      level: "warning",
      status: err.status,
      tag: "http.request-body",
      fingerprint: `http:request-body:${err.status}`,
      print: false,
    });
    if (err.status === 413) {
      res.status(413).json({
        error: "payload_too_large",
        message: "ข้อมูลที่ส่งมามีขนาดเกิน 1 MB — ไฟล์แนบให้อัปโหลดผ่านช่องแนบไฟล์ ไม่ใช่ส่งรวมมากับข้อมูล",
      });
      return;
    }
    // charset หรือ Content-Encoding ที่ตัวแปลงไม่รู้จัก — ตอบ 415 ตามที่มันบอก ไม่ใช่ 400 เพราะแก้คนละที่
    if (err.status === 415) {
      res.status(415).json({
        error: "unsupported_media_type",
        message: "รูปแบบการเข้ารหัสของข้อมูลที่ส่งมาไม่รองรับ — ส่งเป็น JSON แบบ UTF-8 (บีบอัดได้เฉพาะ gzip หรือ deflate)",
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
   *
   * 5xx เก็บเป็น issue ต่อรหัส (`render:converter_unavailable`) — ตัวแปลงล่มครั้งเดียวกระทบทุก route ที่สร้างเอกสาร
   * และเป็นปัญหาเดียวกัน breadcrumb บอกว่าคำขอนั้นทำอะไรไปแล้วก่อนถึงขั้นเรนเดอร์ 4xx พิมพ์บรรทัดเดิมเหมือนเคย
   */
  if (err instanceof DocumentRenderError) {
    if (err.status >= 500) {
      captureError(err, { req, status: err.status, tag: `render.${err.code}`, fingerprint: `render:${err.code}` });
    } else {
      console.error(`[backend] ${err.code}:`, err.message);
    }
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
    /**
     * เก็บทุกครั้ง (captureError พิมพ์หนึ่งบรรทัดที่กวาดแล้ว): การหลุดมาถึงตะแกรงนี้แปลว่ามี route ที่ยังไม่ได้ดักเคส
     * ของตัวเอง issue แยกตามรหัสและ route (`prisma:P2002:POST /api/…`) จึงชี้ route ที่ต้องแก้ได้ตรงตัว
     * รหัสที่แปลเป็น 4xx เป็น warning ส่วนรหัสของฐานข้อมูลที่ติดต่อไม่ได้ (503) เป็น error เพราะนั่นคือระบบล่ม
     */
    captureError(err, {
      req,
      level: known.status >= 500 ? "error" : "warning",
      status: known.status,
      tag: `prisma.${prismaCode}`,
      fingerprint: `prisma:${prismaCode}:${routeKey(req)}`,
    });
    res.status(known.status).json({ error: known.error, message: known.message });
    return;
  }

  // เริ่มต้น client ไม่สำเร็จเลย = ระบบยังไม่พร้อม ไม่ใช่ความผิดของคำขอ ตอบ 503 ไว้ก่อน
  // แม้จะไม่รู้รหัส เพราะ 500 จะทำให้คนเรียกไปหาสาเหตุผิดที่
  if (err instanceof Prisma.PrismaClientInitializationError) {
    captureError(err, { req, status: 503, tag: "prisma.init" });
    res
      .status(503)
      .json({ error: "unavailable", message: "ระบบฐานข้อมูลไม่พร้อมใช้งาน กรุณาลองใหม่อีกครั้ง" });
    return;
  }

  /**
   * ไม่รู้ว่าเป็นอะไร — เก็บแล้วตอบ 500 พร้อมรหัสอ้างอิง **ไม่พิมพ์ `err` ดิบ** อย่างที่เคยทำ: error ของ Prisma ยก
   * argument ของ query มาทั้งก้อน ซึ่งมีอีเมลและเลขบัตรปน captureError พิมพ์บรรทัดเดียวที่กวาดแล้วพร้อม id ของ event
   * ส่วน stack เต็ม (ที่กวาดแล้ว) อยู่ใน log store
   */
  captureError(err, { req, status: 500 });
  const reference = referenceOf(currentContext()?.correlationId ?? "");
  res.status(500).json({
    error: "internal",
    message: `เกิดข้อผิดพลาดภายในระบบ (รหัสอ้างอิง ${reference})`,
    reference,
  });
});

async function main() {
  /**
   * ก่อนอย่างอื่นทั้งหมด: ตัวดัก unhandledRejection / uncaughtException และคิวของ error ที่เกิดระหว่างบูต
   * (อ่านตัวเลือกไม่ได้, container ของ storage) — คิวรอจนกว่า log store ข้างล่างจะต่อได้
   */
  initErrorCapture({ service: "backend" });

  /**
   * ตัวเลือกของแบบฟอร์มชุดข้อมูลอยู่ในฐานข้อมูล แต่ผู้ใช้ของมัน (zod schema, ชื่อช่องติ๊ก)
   * ถูกประเมินตั้งแต่ตอน import แล้ว จึงต้องโหลดเข้า cache ให้เสร็จก่อนเปิดรับ request
   * โหลดไม่ได้ก็ไม่ล้ม — ใช้ค่าตั้งต้นในโค้ดไปก่อนและเตือนไว้ ดู lib/dataset-choices.ts
   */
  await loadChoices();

  // Best-effort: don't block startup if Azure Blob Storage is briefly unavailable —
  // /health/ready will report it.
  await ensureContainer().catch((err: unknown) => {
    // ข้อความของ Azure SDK ยก URL ของบัญชีมาได้ — บรรทัด [capture] ถัดไปคือฉบับที่กวาดแล้ว
    console.warn("[startup] could not ensure container — ดูบรรทัด [capture] ถัดไป");
    captureError(err, { level: "warning", tag: "storage.ensure-container" });
  });

  /**
   * log store (MongoDB) — best-effort แบบเดียวกัน: รอผลตรวจครั้งแรกไม่เกิน ~3 วินาทีเพื่อให้ /health/ready ตอบสถานะที่
   * ถูกตั้งแต่คำขอแรก แล้วเดินต่อไม่ว่าผลจะเป็นอะไร ไม่ reject — Mongo ล่มหรือปิดอยู่ backend ก็บูตตามปกติ
   */
  await startLogStore({ service: "backend", maxPoolSize: 5 });

  const server = app.listen(env.port, () => {
    console.log(`[backend] listening on http://localhost:${env.port}`);
    // บันทึกของ process — การเริ่มที่ไม่มี shutdown นำหน้าคือการล่มแล้ววนกลับมา (step 10 ใช้จับ crash loop)
    recordRuntimeEvent("start", { node: process.version });
    if (!env.smtp.enabled) {
      console.log("[backend] SMTP ยังไม่ได้ตั้งค่า — อีเมลจะถูกพิมพ์ลง log แทนการส่งจริง");
    }
    // บอกไว้ตั้งแต่บูตว่าเลขบัตรจะมาจาก claim ไหน เวลาไล่ปัญหาจะได้ไม่ต้องเดา
    if (!env.thaid.usePid) {
      console.log("[backend] THAID_USE_PID=false — ใช้ claim `sub` เป็นเลขประจำตัวประชาชน");
    }
    /**
     * fingerprint ของ token นี้ลงทุกแถวของ admin API (`admin_token_fp`) — ถ้า token เดาได้ ใครที่อ่าน log ได้
     * ก็ทดสอบคำเดาแบบ offline แล้วได้ token ที่เปิด /api/admin ทั้งหมด เตือนเฉพาะ production เพราะ dev
     * checkout ใช้ค่าตัวอย่างอยู่แล้ว และเตือนแทนการไม่ยอมบูต: deploy ที่ออกก่อนหมุน token ต้องไม่ทำให้
     * backend วนรีสตาร์ตจนหน้าเว็บล่ม ไม่พิมพ์ค่าหรือความยาวของ token
     */
    if (env.nodeEnv === "production" && adminTokenLooksWeak(env.auth.adminApiToken)) {
      console.warn(
        "[backend] คำเตือน: ADMIN_API_TOKEN สั้นกว่า 32 ตัวหรือยังเป็นค่าตัวอย่าง dev-… — fingerprint ที่ลง " +
          "audit_event ใช้เดาย้อนกลับได้ ให้หมุนเป็นค่าจาก `openssl rand -hex 32` (docs/09 §4.1)",
      );
    }
  });

  const shutdown = async (signal: string) => {
    console.log(`[backend] ${signal} received, shutting down`);
    server.close();
    recordRuntimeEvent("shutdown", { signal });
    // แถวสรุปของ token ที่ถูกปฏิเสธยังค้างอยู่ในหน่วยความจำ — เขียนให้เท่าที่ทันภายใน 2 วินาที
    // ไม่รอนานกว่านั้น เพราะ compose ให้เวลาทั้งหมด 10 วินาทีก่อน SIGKILL
    await Promise.race([flushTokenRejections(), new Promise((resolve) => setTimeout(resolve, 2_000))]);
    // คิวของ error + บันทึก shutdown ข้างบน ไม่เกิน 2 วินาที แล้วปิด client ไม่เกิน 1.5 — รวมกันยังอยู่ใน 10 วินาที
    await flushErrors(FLUSH_ON_EXIT_MS);
    await closeLogStore();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err: unknown) => {
  console.error("[backend] fatal startup error — ดูบรรทัด [capture] ถัดไป");
  exitAfterFatal(err, { mechanism: "captured", tag: "startup" });
});
