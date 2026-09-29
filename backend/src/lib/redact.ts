/**
 * redaction — กฎเดียวของ "อะไรออกจาก process ไปถึง log store หรือ stdout ได้บ้าง" (plan §7)
 *
 * ทุกทางที่เขียน error หรือสำเนากิจกรรมลง Mongo ผ่านไฟล์นี้: การเก็บ error (lib/error-capture.ts), สำเนา audit ที่เขียน
 * ลง Postgres ไม่สำเร็จ (lib/audit-fallback.ts) และทางที่จะตามมา (relay, รายงานจากเบราว์เซอร์, บันทึกการเรียก admin
 * API) กฎอยู่ที่เดียวเพื่อให้คนตรวจอ่านที่เดียวแล้วรู้ครบว่าอะไรหลุดได้ อะไรหลุดไม่ได้
 *
 * หลักการเป็น allowlist ไม่ใช่ blocklist ทุกที่ที่ทำได้:
 *   1. body ของคำขอ — เก็บแค่ "รูปร่าง" (ชื่อ key กับชนิด/ความยาว) ไม่เก็บค่าเลย และ key ที่อ่อนไหวเหลือแค่ present/absent
 *      ไม่บอกแม้แต่ความยาวของรหัสผ่านหรือ OTP (`bodyShape`)
 *   2. URL — path กับ**ชื่อ** ของ query เท่านั้น ค่าของ `?token=` `?cid=` `?code&state` ไม่ออกไป (`requestTarget`)
 *   3. header — เฉพาะ user-agent, content-type, content-length (`allowedHeaders`)
 *   4. error object — เฉพาะ property ที่อยู่ในรายการ ไม่เคยเอา `body` ของ body-parser หรือ buffer ของไฟล์ (`scrubError`)
 *   5. ข้อความอิสระ (message, stack, cause) — ผ่านตารางกวาด `scrubText` ซึ่งเป็นชั้นเดียวที่เป็น blocklist
 *      จึงเป็นชั้นสำรอง ไม่ใช่ชั้นหลัก: ข้อความที่มีค่าที่ผู้ใช้กรอกไม่ควรมาถึงตรงนี้ตั้งแต่แรก
 */

/** ข้อความที่ยาวกว่านี้ถูกตัดก่อนกวาด — regex ทุกตัวข้างล่างเป็นเส้นตรง แต่ก็ไม่ควรวิ่งบนข้อความขนาดเมกะไบต์ */
const SCRUB_INPUT_MAX = 20_000;

/** UUID ต้องรอดการกวาดทั้งตัว: มันคือ id ที่ใช้ตามรอย และตัวเลขข้างในหน้าตาเหมือนเบอร์โทรหรือเลขบัตรได้ */
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const UUID_EXACT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * ตารางกวาดข้อความอิสระ (plan §7.5) — ลำดับมีผล: userinfo ของ URI กับ JWT ก่อน (ไม่งั้นท่อนข้างในโดนกฎอื่นกินไปครึ่งเดียว)
 * แล้ว `key=value` แล้วอีเมล แล้วกฎตัวเลข/ความลับที่รันหลังกัน UUID ไว้แล้ว (`scrubText`)
 *
 * ทุกกฎที่มี `+` ขึ้นต้นด้วย lookbehind ว่าต้องเริ่มที่ขอบของก้อน — ไม่งั้นข้อความยาว 20 KB ที่ไม่มีอะไรตรงจะถูกลอง
 * ทุกตำแหน่งเริ่มจนถึงท้ายก้อน (กำลังสอง) และ captureError เป็น synchronous บนเส้นทางของคำขอ
 */
const BEFORE_UUID_RULES: Array<[RegExp, string]> = [
  // `scheme://user:pass@host` — connection string ของ Postgres/Mongo/SMTP ที่ error บางตัวยกมา
  [/(?<![A-Za-z0-9+.-])([a-z][a-z0-9+.-]*:\/\/)[^\s/@"'<>]+@/gi, "$1***@"],
  [/(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{5,}(?:\.[A-Za-z0-9_-]*){0,2}/g, "[jwt]"],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [redacted]"],
  // token=… · apiKey=… · "password":"…" · state=… · code=… — เก็บชื่อไว้ให้รู้ว่ามีค่า แต่ไม่เก็บค่า
  // code ที่ไม่ใช่ความลับ (`code=P2002`) ก็โดนไปด้วย ยอมรับ (plan §7.5)
  [
    /(?<![A-Za-z0-9_-])([A-Za-z0-9_-]*(?:token|key|secret|passw(?:or)?d|otp|code|state))("?\s*[=:]\s*"?)([^\s&"',;}<>]+)/gi,
    "$1$2[redacted]",
  ],
  [/(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g, "[email]"],
];

/**
 * ความลับยาว ๆ (ฐานสิบหกหรือ base64url ตั้งแต่ 32 ตัว) — ต้องมีตัวเลขอย่างน้อยหนึ่งตัว ไม่งั้นชื่อฟังก์ชันหรือชื่อคลาส
 * ยาว ๆ ใน stack (`PrismaClientInitializationError`) โดนไปด้วย token สุ่มยาว 32 ตัวที่ไม่มีเลขเลยแทบไม่มีทางเกิด
 */
const LONG_RUN = /(?<![A-Za-z0-9_+-])[A-Za-z0-9_+-]{32,}={0,2}/g;
/** เลขบัตร 13 หลัก ทั้งแบบติดกันและแบบมีขีด/ช่องว่างคั่น (`1-2345-67890-12-3`) */
const CID_RUN = /(?<!\d)\d(?:[- ]?\d){12}(?!\d)/g;
/** เบอร์โทรไทย `0` ตามด้วยอีก 8–9 หลัก (ขีด/ช่องว่างคั่นได้) */
const PHONE_RUN = /(?<!\d)0\d(?:[- ]?\d){7,8}(?!\d)/g;

/** ตัวคั่นที่ไม่มีกฎไหนจับได้ (private use area) ใช้แทน UUID ระหว่างกวาด แล้วใส่คืนทีหลัง */
const HOLD_OPEN = "\uE000";
const HOLD_CLOSE = "\uE001";
const HELD = /\uE000(\d+)\uE001/g;

/**
 * กวาดข้อมูลส่วนบุคคลและความลับออกจากข้อความอิสระ — ไม่ throw
 *
 * | รูปแบบ | กลายเป็น |
 * |---|---|
 * | userinfo ใน URI (`postgresql://u:p@host`) | `postgresql://***@host` |
 * | JWT `eyJ…` | `[jwt]` |
 * | `Bearer …` / `Basic …` | `Bearer [redacted]` |
 * | `token=` `key=` `secret=` `password=` `otp=` `code=` `state=` (และ `"password":"…"`) | `…=[redacted]` |
 * | อีเมล | `[email]` |
 * | ฐานสิบหก/base64url ยาว 32 ตัวขึ้นไปที่มีตัวเลข (ยกเว้น UUID) | `[secret]` |
 * | เลข 13 หลัก / เลขบัตรแบบมีขีด | `[cid]` |
 * | `0` + 8–9 หลัก | `[phone]` |
 */
export function scrubText(text: string): string {
  let out = text.length > SCRUB_INPUT_MAX ? text.slice(0, SCRUB_INPUT_MAX) : text;
  for (const [pattern, replacement] of BEFORE_UUID_RULES) out = out.replace(pattern, replacement);

  const held: string[] = [];
  out = out.replace(UUID, (uuid) => `${HOLD_OPEN}${held.push(uuid) - 1}${HOLD_CLOSE}`);
  out = out
    .replace(LONG_RUN, (run) => (/\d/.test(run) ? "[secret]" : run))
    .replace(CID_RUN, "[cid]")
    .replace(PHONE_RUN, "[phone]");
  return out.replace(HELD, (_all, index: string) => held[Number(index)] ?? "");
}

// ------------------------------------------------------------------------------------ error object

/** property ของ error ที่ออกไปได้ — นอกจากนี้ไม่ออกเลย (`body` ของ body-parser, `response` ของ nodemailer ที่ยกที่อยู่ผู้รับมา ฯลฯ) */
const ERROR_PROPS = ["code", "status", "statusCode", "type", "errorCode", "responseCode", "command", "syscall"] as const;

export interface ScrubbedCause {
  name: string;
  message: string;
  props: Record<string, unknown>;
}

export interface ScrubbedError extends ScrubbedCause {
  /** stack ที่ประกอบใหม่: บรรทัดหัวจาก name + message ที่กวาดแล้ว ตามด้วยเฉพาะบรรทัด `at …` */
  stack: string | null;
  /** เฟรมแรกที่เป็นโค้ดของเรา (`lib/audit:logAudit`) — ไม่มีเลขบรรทัด ใช้จัดกลุ่ม */
  topFrame: string | null;
  causes: ScrubbedCause[];
}

const MESSAGE_MAX = 2_048;
const CAUSE_MESSAGE_MAX = 1_024;
const STACK_MAX = 16_384;
const CAUSES_MAX = 3;

/**
 * ชื่อของ error — คลาสลูกที่ไม่ได้ตั้ง `name` เอง (DocumentRenderError, ThaidError, WorkflowError …) ได้ `name` เป็น
 * "Error" จาก prototype ใช้ชื่อ constructor แทน ไม่งั้นทุกตัวรวมเป็นชื่อเดียวกันหมดทั้งในบรรทัด log และใน fingerprint
 */
function nameOf(err: unknown): string {
  if (err instanceof Error) {
    const ctor = (err.constructor as { name?: unknown } | undefined)?.name;
    const name = err.name && err.name !== "Error" ? err.name : typeof ctor === "string" && ctor ? ctor : "Error";
    return name.slice(0, 100);
  }
  if (err && typeof err === "object") {
    const name = (err as { name?: unknown }).name;
    if (typeof name === "string" && name) return scrubText(name).slice(0, 100);
  }
  return "NonError";
}

/**
 * ข้อความของ error ที่กวาดแล้ว
 *
 * `PrismaClientValidationError` เหลือบรรทัดแรกบรรทัดเดียว เพราะบรรทัดถัดไปคือ argument ทั้งก้อนที่ส่งให้ query
 * พร้อมค่า (อีเมล เลขบัตร ที่อยู่ …) — ตารางกวาดจับได้บางรูปเท่านั้น ตัดทิ้งทั้งท่อนแน่นอนกว่า
 */
function messageOf(err: unknown, max: number): string {
  let raw: string;
  if (err instanceof Error) raw = err.message;
  else if (typeof err === "string") raw = err;
  else if (err && typeof err === "object" && typeof (err as { message?: unknown }).message === "string") {
    raw = (err as { message: string }).message;
  } else raw = Object.prototype.toString.call(err);

  if (nameOf(err) === "PrismaClientValidationError") {
    raw = raw.split("\n").find((line) => line.trim() !== "") ?? "";
  }
  const scrubbed = scrubText(raw);
  return scrubbed.length > max ? `${scrubbed.slice(0, max)}…` : scrubbed;
}

function propsOf(err: unknown): Record<string, unknown> {
  if (!err || typeof err !== "object") return {};
  const source = err as Record<string, unknown>;
  const props: Record<string, unknown> = {};
  for (const key of ERROR_PROPS) {
    const value = source[key];
    if (typeof value === "number" || typeof value === "boolean") props[key] = value;
    else if (typeof value === "string") props[key] = scrubText(value).slice(0, 200);
  }
  // Prisma: ชื่อคอลัมน์หรือ index ที่ชน (P2002) — ชื่อ ไม่ใช่ค่า
  const target = (source.meta as { target?: unknown } | undefined)?.target;
  if (typeof target === "string") props.metaTarget = target.slice(0, 200);
  else if (Array.isArray(target)) {
    props.metaTarget = target.filter((t): t is string => typeof t === "string").slice(0, 10);
  }
  return props;
}

/** บรรทัด `at …` ของ stack ดิบ — บรรทัดหัว (ซึ่งมี message ดิบอยู่) ถูกทิ้ง */
function framesOf(err: unknown): string[] {
  const stack = err instanceof Error ? err.stack : undefined;
  if (typeof stack !== "string") return [];
  return stack.split("\n").filter((line) => /^\s+at /.test(line));
}

/**
 * เฟรมแรกที่เป็นโค้ดของเรา ในรูป `lib/audit:logAudit` — ตัด `/app/src/` หรือ `/app/dist/` และนามสกุลทิ้ง
 * dev (tsx: `.ts`) กับ production (`dist/*.js` ที่ source map พากลับไป `.ts`) จึงได้ค่าเดียวกัน ไม่มีเลขบรรทัด:
 * แก้บรรทัดข้างบนแล้ว issue เดิมต้องยังเป็น issue เดิม
 */
function topFrameOf(frames: string[]): string | null {
  for (const frame of frames) {
    const match = /at (?:async )?(?:(.+?) \()?(?:file:\/\/)?([^()\s]+?):\d+:\d+\)?$/.exec(frame.trim());
    if (!match) continue;
    const file = match[2] ?? "";
    if (file.includes("node_modules") || file.startsWith("node:")) continue;
    const inApp = /\/(?:src|dist)\/(.+?)\.[cm]?[jt]s$/.exec(file);
    if (!inApp) continue;
    const fn = (match[1] ?? "<anonymous>").replace(/^new /, "").slice(0, 100);
    return `${inApp[1]}:${fn}`;
  }
  return null;
}

/**
 * บรรทัดเดียวที่บอกเรื่องได้ดีที่สุดของข้อความ — ใช้เป็นหัวเรื่องของ issue บรรทัดใน stdout และ fingerprint
 *
 * ปกติคือบรรทัดแรกที่ไม่ว่าง แต่ error ของ Prisma ขึ้นต้นด้วยบรรทัดว่าง ตามด้วย "Invalid `prisma.x.y()` invocation in"
 * กับโค้ดรอบจุดที่เรียก และบอกสาเหตุจริงไว้บรรทัด**สุดท้าย** ("Can't reach database server at …",
 * "Unique constraint failed on the fields: (`email`)") — หัวเรื่องจากบรรทัดแรกจึงว่างหรือเหมือนกันหมดทุกสาเหตุ
 */
export function headlineOf(name: string, message: string): string {
  const lines = message.split("\n").map((line) => line.trim()).filter(Boolean);
  const line = name.startsWith("Prisma") ? lines[lines.length - 1] : lines[0];
  return line ?? "";
}

/** error อะไรก็ได้ (รวมค่าที่ไม่ใช่ Error ที่ถูก throw หรือ reject มา) → รูปที่เก็บได้ — ไม่ throw */
export function scrubError(err: unknown): ScrubbedError {
  const name = nameOf(err);
  const message = messageOf(err, MESSAGE_MAX);
  const frames = framesOf(err);
  let stack: string | null = null;
  if (frames.length > 0) {
    stack = scrubText(`${name}: ${message}\n${frames.join("\n")}`);
    if (stack.length > STACK_MAX) stack = `${stack.slice(0, STACK_MAX)}…`;
  }

  const causes: ScrubbedCause[] = [];
  const seen = new Set<unknown>([err]);
  let cause = err instanceof Error ? err.cause : undefined;
  while (cause !== undefined && cause !== null && causes.length < CAUSES_MAX && !seen.has(cause)) {
    seen.add(cause);
    causes.push({ name: nameOf(cause), message: messageOf(cause, CAUSE_MESSAGE_MAX), props: propsOf(cause) });
    cause = cause instanceof Error ? cause.cause : undefined;
  }

  return { name, message, props: propsOf(err), stack, topFrame: topFrameOf(frames), causes };
}

// ------------------------------------------------------------------------------------ คำขอ HTTP

/**
 * key ของ body ที่เก็บได้แค่ว่ามีหรือไม่มี (plan §7.1, error-paths §1.6) — ไม่เก็บชนิดหรือความยาวด้วยซ้ำ
 * ความยาวของรหัสผ่านหรือ OTP ก็เป็นข้อมูลที่ไม่ควรออกไป ชื่อคนทุกรูป (`firstName`, `contactLastName`, `nameTh`)
 * ติดกฎ `name` ไปด้วย รวมถึงชื่อหน่วยงานซึ่งไม่ได้อ่อนไหว — เสียแค่ความยาว ไม่เสียอะไรในการไล่ error
 */
const SENSITIVE_BODY_KEY =
  /passw(?:or)?d|token|secret|otp|^code$|^state$|^error$|^error_?description$|cid$|nationalid|^pid$|signature|phone|email|name|key$/i;

const BODY_KEYS_MAX = 50;

function shapeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `array(${value.length})`;
  if (typeof value === "string") return `string(${value.length})`;
  if (typeof value === "object") return `object(${Object.keys(value).length})`;
  return typeof value;
}

/**
 * รูปร่างของ body — `{title: "string(12)", password: "present", tags: "array(3)"}` หรือ null ถ้าไม่ใช่ object
 *
 * ลงไปแค่ชั้นบนสุด: object ข้างในเหลือแค่จำนวน key (`object(5)`) ไม่ไล่ชื่อ key ข้างใน `signature.*` จึงเป็น
 * present/absent ทั้งก้อนตามชื่อของมันเอง ชื่อ key ผ่านตารางกวาดด้วย เพราะผู้เรียกตั้งชื่อ key เป็นอะไรก็ได้
 */
export function bodyShape(body: unknown): Record<string, string> | null {
  if (!body || typeof body !== "object" || Array.isArray(body) || Buffer.isBuffer(body)) return null;
  const entries = Object.entries(body as Record<string, unknown>);
  const shape: Record<string, string> = {};
  for (const [key, value] of entries.slice(0, BODY_KEYS_MAX)) {
    const safeKey = scrubText(key).slice(0, 64);
    shape[safeKey] = SENSITIVE_BODY_KEY.test(key)
      ? value === undefined || value === null || value === ""
        ? "absent"
        : "present"
      : shapeOf(value);
  }
  if (entries.length > BODY_KEYS_MAX) shape["…"] = `+${entries.length - BODY_KEYS_MAX} keys`;
  return Object.keys(shape).length > 0 ? shape : null;
}

/**
 * path ของคำขอ (ไม่มี query) กับ**ชื่อ** ของ query — ค่าของ query ไม่ออกไปเลย (`?token=` `?cid=` `?code&state`)
 * path ผ่านตารางกวาด เพราะผู้เรียกเขียนอะไรลงไปใน path ก็ได้ (เลขบัตร อีเมล)
 */
export function requestTarget(originalUrl: string): { path: string; queryKeys: string[] } {
  const cut = originalUrl.indexOf("?");
  const rawPath = cut === -1 ? originalUrl : originalUrl.slice(0, cut);
  const query = cut === -1 ? "" : originalUrl.slice(cut + 1);
  const keys = new Set<string>();
  if (query) {
    try {
      for (const key of new URLSearchParams(query).keys()) {
        keys.add(scrubText(key).slice(0, 64));
        if (keys.size >= 20) break;
      }
    } catch {
      keys.add("(อ่าน query ไม่ออก)");
    }
  }
  return { path: scrubText(rawPath).slice(0, 300), queryKeys: [...keys] };
}

/** header ที่ออกไปได้ — ไม่มี cookie, x-admin-token, x-log-token, authorization, referer หรืออะไรนอกรายการ */
const HEADER_ALLOWLIST = ["user-agent", "content-type", "content-length"] as const;

export function allowedHeaders(headers: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of HEADER_ALLOWLIST) {
    const value = headers[name];
    if (typeof value === "string") out[name] = scrubText(value).slice(0, 512);
  }
  return out;
}

// ------------------------------------------------------------------------------------ สำเนากิจกรรม

/**
 * ชื่อ key ที่ถือเลขประจำตัวประชาชน — กฎเดียวกับ `CID_KEY` ใน lib/audit.ts (ซึ่งปิดเลขใน diff ใหม่ของ Postgres)
 * `thaid_subject` คือ `sub` ของ DOPA ซึ่งเป็นเลขบัตร 13 หลักไม่ว่า THAID_USE_PID จะตั้งไว้อย่างไร
 */
const CID_KEY = /cid$|nationalid|^pid$|^thaid_subject$/i;
/** ข้อความอิสระในสำเนากิจกรรมที่ plan §7.6 ให้ปิดเลข 13 หลักข้างใน */
const FREE_TEXT_KEY = /^(note|reason)$/i;

function maskedCid(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  // ปิดไว้แล้วตั้งแต่ Postgres (`sanitizeDiff()` → `{masked, changed}`) — อย่าปิดซ้ำจนกลายเป็น "[object Object]"
  if (typeof value === "object" && value !== null && "masked" in value) return value;
  const text = String(value);
  const shown = text.length > 4 ? text.slice(-4) : "";
  return { masked: "x".repeat(text.length - shown.length) + shown };
}

/** อีเมลที่ผู้ใช้**พิมพ์เอง** (อาจไม่ใช่ของบัญชีไหน) — `so***@domain` เหลือโดเมนไว้ให้เห็นว่ามาจากหน่วยงานไหน */
export function maskedTypedEmail(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const at = value.lastIndexOf("@");
  if (at <= 0) return { masked: "***" };
  return { masked: `${value.slice(0, Math.min(2, at))}***${value.slice(at)}` };
}

/**
 * ปิดเลขบัตรตามชื่อ key (ทุกชั้น) และเลข 13 หลักใน `note` / `reason` — plan §7.6 ข้อที่ใช้ได้โดยไม่มี LOG_HASH_KEY
 * (key ค้นหา `cid#…` มากับงานสำเนา audit ใน step 6) อีเมลของบัญชี ชื่อ เบอร์ IP และ UA ไม่ถูกแตะ ตามที่ตัดสินไว้
 */
export function maskForLogStore(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[ลึกเกิน]";
  if (Array.isArray(value)) return value.map((v) => maskForLogStore(v, depth + 1));
  const proto = value !== null && typeof value === "object" ? Object.getPrototypeOf(value) : undefined;
  if (proto === Object.prototype || proto === null) {
    return Object.fromEntries(
      Object.entries(value as object).map(([k, v]) => {
        if (CID_KEY.test(k)) return [k, maskedCid(v)];
        if (FREE_TEXT_KEY.test(k) && typeof v === "string") return [k, v.replace(CID_RUN, "[cid]")];
        return [k, maskForLogStore(v, depth + 1)];
      }),
    );
  }
  return value;
}

/** ใช้ใน lib/error-capture.ts: id ที่หน้าตาเป็น UUID ให้ผ่าน ที่เหลือถือเป็นข้อความอิสระ */
export function isUuid(value: string): boolean {
  return UUID_EXACT.test(value);
}
