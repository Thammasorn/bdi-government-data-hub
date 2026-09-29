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
 * ข้อความ error ของฐานข้อมูลที่ยก**แถวทั้งแถว**มา — ต้องตัดก่อนกฎอื่นทุกตัว เพราะในนั้นคือค่าจริงของทุกคอลัมน์
 * (id ผู้กระทำ, before/after เป็น JSON, IP, UA, ชื่อ) ซึ่งตารางกวาดข้างล่างจับได้แค่บางรูป
 *
 * Postgres แนบ DETAIL มากับ error ที่ปฏิเสธแถว (`Failing row contains (…)` ของ CHECK/NOT NULL,
 * `Key (email)=(…) already exists` ของ unique) และ Prisma ยกมาสองรูป — ลองกับ stack ที่รันอยู่แล้ว 2026-09-30:
 *   - `PrismaClientUnknownRequestError` (INSERT/UPDATE ผ่าน model): Rust debug print
 *     `PostgresError { code: "23514", message: "…", severity: "ERROR", detail: Some("Failing row contains (…)"), … }`
 *   - `P2010` (raw query): ``Raw query failed. Code: `23514`. Message: `ERROR: …\nDETAIL: Failing row contains (…)` ``
 *
 * `message` ของ Postgres (ชื่อ constraint, ชื่อ relation) กับรหัส SQLSTATE เก็บไว้ — ใช้ไล่ปัญหาได้และไม่มีค่าของแถว
 * รหัสถูกเขียนใหม่เป็น `SQLSTATE 23514` เพราะกฎ `code: "…"` ข้างล่างจะกลบมันเป็น `[redacted]`
 * ตัดแล้วบรรทัดสุดท้ายของข้อความ (หัวเรื่องของ issue และ fingerprint — `headlineOf`) ก็ไม่มี id กับเวลาของแถวอีก
 * error เดียวกันจึงรวมเป็น issue เดียว ไม่แตกตามแถว
 *
 * `(?:"\)|$)` — ข้อความที่ถูกตัดความยาวมาก่อนถึงนี่อาจไม่มีเครื่องหมายปิด ก็ยังตัดจนสุดข้อความ ไม่ปล่อยท่อนที่เหลือ
 */
const DATABASE_DETAIL_RULES: Array<[RegExp, string]> = [
  [/\b(detail|hint): Some\("(?:[^"\\]|\\[\s\S])*(?:"\)|$)/g, "$1: [ตัดทิ้ง]"],
  // ตาข่ายชั้นที่สอง: ถ้ารูปข้างบนไม่ตรง (Prisma เปลี่ยนวิธีพิมพ์ ข้อความเพี้ยน) ตัดตั้งแต่ตรงนั้นจนสุดข้อความ
  [/\b(detail|hint): Some\("[\s\S]*$/g, "$1: [ตัดทิ้ง]"],
  // DETAIL/HINT/CONTEXT ของ raw query อยู่บรรทัดของตัวเอง ค่าในแถวมีขึ้นบรรทัดใหม่ได้ — ตัดไปจนสุดข้อความ หรือจนถึง
  // บรรทัด `at …` ของ stack ถ้ามีคนส่ง stack ทั้งก้อนมา
  [/\n(?:DETAIL|HINT|CONTEXT|WHERE):(?:(?!\n\s+at )[\s\S])*/g, " (รายละเอียดของแถวตัดทิ้ง)"],
  [/PostgresError \{ code: "([0-9A-Z]{5})",/g, "PostgresError { SQLSTATE $1,"],
  [/(Raw query failed\.) Code: `([0-9A-Z]{5})`\./g, "$1 SQLSTATE $2."],
  // เปลือก Rust ทั้งก้อนเหลือแค่รหัสกับข้อความ — ไม่งั้นหัวเรื่องของ issue (200 ตัว) ถูกตัดก่อนถึงชื่อ constraint
  // รูปไม่ตรง (Prisma เปลี่ยนวิธีพิมพ์) ก็แค่ไม่ย่อ กฎข้างบนตัดค่าของแถวไปแล้ว
  [
    /ConnectorError\(ConnectorError \{ user_facing_error: None, kind: QueryError\(PostgresError \{ SQLSTATE ([0-9A-Z]{5}), message: "((?:[^"\\]|\\.)*)"[^{}]*\}\), transient: (?:true|false) \}\)/g,
    "Postgres SQLSTATE $1: $2",
  ],
];

/**
 * ชื่อ key ที่ค่าของมันเป็นความลับ — ชื่อที่**ลงท้าย**ด้วยคำเหล่านี้ (`apiKey`, `access_token`, `newPassword`,
 * `x-auth`, `set-cookie`) คำสั้นที่เป็นท้ายคำธรรมดาได้ (`mapping`, `bypass`, `compass`, `upsid`) นับเฉพาะเมื่อเป็นทั้งคำ
 * หรือมี `_`/`-` นำหน้า: `pwd` `pin` `pass` `pw` `sid` และ `session` (ชื่อ cookie ของเราคือ `bdi_session`)
 */
const SECRET_KEY =
  "[A-Za-z0-9_-]*(?:token|key|secret|passw(?:or)?d|passcode|passphrase|otp|code|state|auth|authorization|cookie)" +
  "|(?:[A-Za-z0-9_-]*[_-])?(?:pwd|pin|pass|pw|sid|session)";
/**
 * key ที่ค่าเป็นวลีได้ (มีช่องว่าง จุลภาค) — ค่าที่ไม่มีเครื่องหมายคำพูดครอบถูกตัดไปจนสุดบรรทัด
 * `authorization` (`Digest username=…, response=…`) กับ `cookie` (`a=1; bdi_session=…`) ค่าเป็นหลายท่อนต่อกันเสมอ
 */
const PHRASE_KEY =
  "[A-Za-z0-9_-]*(?:secret|passw(?:or)?d|passcode|passphrase|authorization|cookie)|(?:[A-Za-z0-9_-]*[_-])?(?:pwd|pass)";

/**
 * ตารางกวาดข้อความอิสระ (plan §7.5) — ลำดับมีผล: userinfo ของ URI กับ JWT ก่อน (ไม่งั้นท่อนข้างในโดนกฎอื่นกินไปครึ่งเดียว)
 * แล้ว `key=value` แล้วอีเมล แล้วกฎตัวเลข/ความลับที่รันหลังกัน UUID ไว้แล้ว (`scrubText`)
 *
 * ทุกกฎที่มี `+` ขึ้นต้นด้วย lookbehind ว่าต้องเริ่มที่ขอบของก้อน — ไม่งั้นข้อความยาว 20 KB ที่ไม่มีอะไรตรงจะถูกลอง
 * ทุกตำแหน่งเริ่มจนถึงท้ายก้อน (กำลังสอง) และ captureError เป็น synchronous บนเส้นทางของคำขอ
 */
const BEFORE_UUID_RULES: Array<[RegExp, string]> = [
  /**
   * `scheme://user:pass@host` — connection string ของ Postgres/Mongo/SMTP ที่ error บางตัวยกมา
   * ตัดถึง `@` **ตัวสุดท้าย**ก่อน `/` หรือช่องว่าง ไม่ใช่ตัวแรก: รหัสผ่านที่มี `@` ไม่ได้ encode (`u:pa@ss@mongo`)
   * ตัดที่ตัวแรกแล้วท่อนหลังของรหัสผ่านหลุดออกมา (`***@ss@mongo`) ข้อความที่มี `@` ต่อจาก host โดยไม่มี `/` คั่น
   * (`https://host?email=a@b.com`) โดนตัดเกินไปถึงตรงนั้น ยอมรับ — ตัดเกินดีกว่าตัดขาด
   */
  [/(?<![A-Za-z0-9+.-])([a-z][a-z0-9+.-]*:\/\/)[^\s/"'<>]+@/gi, "$1***@"],
  [/(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{5,}(?:\.[A-Za-z0-9_-]*){0,2}/g, "[jwt]"],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [redacted]"],
  // เก็บชื่อไว้ให้รู้ว่ามีค่า แต่ไม่เก็บค่า — code ที่ไม่ใช่ความลับ (`code=P2002`) ก็โดนไปด้วย ยอมรับ (plan §7.5)
  // `"password":"ab,cd ef"` · `token="ab cd"` — ค่าในเครื่องหมายคำพูดวิ่งไปจนถึงเครื่องหมายปิดที่ไม่ได้ escape
  // ไม่ใช่แค่ถึงจุลภาคหรือช่องว่าง ชื่อ key จะมีเครื่องหมายคำพูดปิดท้าย (JSON) หรือไม่มี (`key="…"`) ก็ได้
  [new RegExp(`(?<![A-Za-z0-9_-])(${SECRET_KEY})("?\\s*[:=]\\s*")((?:[^"\\\\]|\\\\[\\s\\S])*)`, "gi"), "$1$2[redacted]"],
  // เครื่องหมายคำพูดเดี่ยว — object ที่ `util.inspect` พิมพ์ (`{ token: 'ab', password: 'cd' }`), `key='…'` ของ
  // shell/SQL ค่าวิ่งไปจนถึง `'` ปิดที่ไม่ได้ escape เหมือนแบบข้างบน ก่อนหน้านี้กฎคำเดียวข้างล่างหยุดที่ `'` เปิดพอดี
  // ค่าจึงหลุดออกไปทั้งตัว
  [new RegExp(`(?<![A-Za-z0-9_-])(${SECRET_KEY})('?\\s*[:=]\\s*')((?:[^'\\\\]|\\\\[\\s\\S])*)`, "gi"), "$1$2[redacted]"],
  // JSON ที่ถูก escape ซ้อนอยู่ในข้อความอีกชั้น — `{\"password\":\"ab,cd\"}` ค่าจบที่ `\"`
  [new RegExp(`(?<![A-Za-z0-9_-])(${SECRET_KEY})(\\\\"\\s*[:=]\\s*\\\\")((?:[^"\\\\]|\\\\[^"])*)`, "gi"), "$1$2[redacted]"],
  // `password: my secret phrase` — รหัสผ่านที่ไม่มีเครื่องหมายคำพูดครอบ ถึงสุดบรรทัด (หรือ `&` ของ query string)
  // ค่าที่ขึ้นต้นด้วยเครื่องหมายคำพูดไม่นับ: กฎข้างบนตัดไปแล้ว ถ้านับซ้ำจะกินทุกอย่างที่ตามมาในบรรทัดไปด้วย
  // ตัวแรกของค่าห้ามเป็นช่องว่างด้วย ไม่งั้น `\s*` ถอยคืนช่องว่างให้แล้วค่าก็ "ขึ้นต้น" ด้วยช่องว่างแทนเครื่องหมายคำพูด
  [new RegExp(`(?<![A-Za-z0-9_-])(${PHRASE_KEY})(\\s*[=:]\\s*)([^\\s&"'][^\\r\\n&]*)`, "gi"), "$1$2[redacted]"],
  // token=… · apiKey=… · state=… · code=… · pin=… · 'sid': … — ค่าเป็นคำเดียว
  [new RegExp(`(?<![A-Za-z0-9_-])(${SECRET_KEY})(['"]?\\s*[=:]\\s*['"]?)([^\\s&"',;}<>]+)`, "gi"), "$1$2[redacted]"],
  // `otp 482913` · `code 482913` — คั่นด้วยช่องว่าง นับเฉพาะเลข 4–8 หลัก: `status code 500` ต้องรอด
  [/(?<![A-Za-z0-9_-])(otp|code|pin|passcode)(\s+)\d{4,8}(?!\d)/gi, "$1$2[redacted]"],
  [/(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g, "[email]"],
];

/**
 * ความลับยาว ๆ (ฐานสิบหกหรือ base64url ตั้งแต่ 32 ตัว) — ต้องมีตัวเลขอย่างน้อยหนึ่งตัว ไม่งั้นชื่อฟังก์ชันหรือชื่อคลาส
 * ยาว ๆ ใน stack (`PrismaClientInitializationError`) โดนไปด้วย token สุ่มยาว 32 ตัวที่ไม่มีเลขเลยแทบไม่มีทางเกิด
 */
const LONG_RUN = /(?<![A-Za-z0-9_+-])[A-Za-z0-9_+-]{32,}={0,2}/g;
/**
 * base64 มาตรฐานที่มี `/` (หรือ `+`) — LONG_RUN ไม่รับ `/` เพราะ path ใน stack และใน URL ก็เป็นก้อนยาวที่มี `/`
 * ก้อนนี้จึงนับเฉพาะเมื่อมีทั้งตัวพิมพ์ใหญ่ ตัวพิมพ์เล็ก และตัวเลขปนกัน ซึ่ง base64 ของค่าสุ่มยาว 32 ตัวแทบไม่มีทาง
 * ขาดตัวไหน ส่วน path ของเรา (`/app/src/routes/…`) เป็นตัวเล็กล้วนและถูก `.` `-` `_` `@` ตัดเป็นท่อนสั้นอยู่แล้ว
 */
const BASE64_RUN = /(?<![A-Za-z0-9+/])[A-Za-z0-9+/]{32,}={0,2}/g;

function looksLikeBase64Secret(run: string): boolean {
  return /[+/]/.test(run) && /\d/.test(run) && /[A-Z]/.test(run) && /[a-z]/.test(run);
}
/** เลขบัตร 13 หลัก ทั้งแบบติดกันและแบบมีขีด/ช่องว่างคั่น (`1-2345-67890-12-3`) */
const CID_RUN = /(?<!\d)\d(?:[- ]?\d){12}(?!\d)/g;
/** เบอร์โทรไทย `0` ตามด้วยอีก 8–9 หลัก (ขีด/ช่องว่างคั่นได้) */
const PHONE_RUN = /(?<!\d)0\d(?:[- ]?\d){7,8}(?!\d)/g;
/** รูปสากล `+66` ตามด้วยเลขที่ตัด `0` ตัวหน้าแล้ว 8–9 หลัก (`+66812345678`, `+66 81-234-5678`, `+66 2 123 4567`) */
const INTL_PHONE_RUN = /(?<![\d+])\+66[- ]?\d(?:[- ]?\d){7,8}(?!\d)/g;

/** ตัวคั่นที่ไม่มีกฎไหนจับได้ (private use area) ใช้แทน UUID ระหว่างกวาด แล้วใส่คืนทีหลัง */
const HOLD_OPEN = "\uE000";
const HOLD_CLOSE = "\uE001";
const HELD = /\uE000(\d+)\uE001/g;

/**
 * กวาดข้อมูลส่วนบุคคลและความลับออกจากข้อความอิสระ — ไม่ throw
 *
 * | รูปแบบ | กลายเป็น |
 * |---|---|
 * | `detail: Some("Failing row contains …")` / `DETAIL: …` ของ Postgres ที่ Prisma ยกมา | `detail: [ตัดทิ้ง]` |
 * | userinfo ใน URI (`postgresql://u:p@host`, ถึง `@` ตัวสุดท้ายก่อน `/`) | `postgresql://***@host` |
 * | JWT `eyJ…` | `[jwt]` |
 * | `Bearer …` / `Basic …` | `Bearer [redacted]` |
 * | `token=` `key=` `secret=` `password=` `pwd=` `pass=` `pw=` `pin=` `passcode=` `otp=` `code=` `state=` `auth=` `authorization:` `cookie:` `sid=` `bdi_session=` | `…=[redacted]` |
 * | `"password":"ab,cd ef"` · `token='ab cd'` (ทั้งค่าจนถึงเครื่องหมายปิด) · `password: วลี มี ช่องว่าง` · `Cookie: a=1; b=2` (จนสุดบรรทัด) | `…[redacted]` |
 * | `otp 482913` / `code 482913` (เลข 4–8 หลักหลังช่องว่าง) | `otp [redacted]` |
 * | อีเมล | `[email]` |
 * | ฐานสิบหก/base64url ยาว 32 ตัวขึ้นไปที่มีตัวเลข (ยกเว้น UUID) · base64 ที่มี `/` `+` และตัวใหญ่ ตัวเล็ก ตัวเลขปนกัน | `[secret]` |
 * | เลข 13 หลัก / เลขบัตรแบบมีขีด | `[cid]` |
 * | `0` + 8–9 หลัก · `+66` + 8–9 หลัก | `[phone]` |
 */
export function scrubText(text: string): string {
  let out = text.length > SCRUB_INPUT_MAX ? text.slice(0, SCRUB_INPUT_MAX) : text;
  for (const [pattern, replacement] of DATABASE_DETAIL_RULES) out = out.replace(pattern, replacement);
  for (const [pattern, replacement] of BEFORE_UUID_RULES) out = out.replace(pattern, replacement);

  const held: string[] = [];
  out = out.replace(UUID, (uuid) => `${HOLD_OPEN}${held.push(uuid) - 1}${HOLD_CLOSE}`);
  out = out
    .replace(LONG_RUN, (run) => (/\d/.test(run) ? "[secret]" : run))
    .replace(BASE64_RUN, (run) => (looksLikeBase64Secret(run) ? "[secret]" : run))
    .replace(CID_RUN, "[cid]")
    .replace(INTL_PHONE_RUN, "[phone]")
    .replace(PHONE_RUN, "[phone]");
  return out.replace(HELD, (_all, index: string) => held[Number(index)] ?? "");
}

/**
 * บรรทัดเดียวของ log ของ Prisma เอง (`prisma:error`, db.ts) — ข้อความเต็มของมันยกโค้ดรอบจุดที่เรียก และ DETAIL ของแถว
 * ที่ Postgres ปฏิเสธมาทั้งแถว จึงตัด DETAIL ก่อน (ทั้งก้อน) แล้วค่อยหยิบบรรทัดสุดท้าย (สาเหตุจริง เหมือน `headlineOf`)
 * แล้วกวาด ไม่ตัดความยาวก่อนตัด DETAIL: ถ้าตัดก่อน บรรทัดสุดท้ายที่เหลืออาจเป็นกลางแถวพอดี
 */
export function databaseLogLine(message: string): string {
  let stripped = message;
  for (const [pattern, replacement] of DATABASE_DETAIL_RULES) stripped = stripped.replace(pattern, replacement);
  return scrubText(headlineOf("Prisma", stripped)).slice(0, 500);
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
 * error ที่ Postgres ปฏิเสธแถว (`PrismaClientUnknownRequestError`, `P2010`) ยกแถวมาใน DETAIL — `scrubText`
 * ตัดท่อนนั้นทิ้งเป็นกฎแรก (`DATABASE_DETAIL_RULES`) จึงไม่ต้องมีสาขาของตัวเองที่นี่
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

/**
 * เลข 13 หลักใน**ทุก**ค่าที่เป็นข้อความ ไม่ใช่แค่ `note` / `reason` อย่างที่ plan §7.6 เขียนไว้ — ช่องข้อความอิสระที่
 * audit บันทึกมีอีกมาก (`notes`, `objectiveOther`, `dataFields`, `title`, ความเห็น) ผู้ตรวจพิมพ์เลขบัตรลง `notes`
 * ของร่างคำขอแล้วเลขนั้นไปถึงทั้ง `activity` และ `error_events.extra.audit` ครบทั้ง 13 หลัก (2026-09-30)
 * ตัวเลข (number) 13 หลักก็นับ — audit ส่งวันเวลามาเป็น ISO string (`plain()` ใน audit-fallback) ไม่ใช่ epoch ms
 * จึงไม่มีอะไรถูกปิดผิดตัวในวันนี้ และ key ของ object ก็ผ่านกฎเดียวกัน (object ที่ใช้เลขบัตรเป็น key)
 */
function maskCidRuns(value: unknown): unknown {
  if (typeof value === "string") return value.replace(CID_RUN, "[cid]");
  if (typeof value === "number" && Number.isInteger(value) && Math.abs(value) >= 1e12 && Math.abs(value) < 1e13) {
    return "[cid]";
  }
  return value;
}

/**
 * ค่าใต้ key ที่ชื่อบอกว่าถือเลขบัตร — ทุกใบของมันถือเป็นเลขบัตร ไม่ว่าจะซ้อนอยู่ลึกแค่ไหน
 *
 * ค่าที่เป็น object หรือ array ลงไปปิดทีละใบ (`{contactCid: ["…", "…"]}` → สองตัวที่ปิดแล้ว) เดิม `String(value)`
 * ทำให้ object กลายเป็น `"[object Object]"` แล้วปิดเป็น `xxxxxxxxxxxect]` ซึ่งไม่บอกอะไร และ array ที่ถูกต่อเป็นข้อความ
 * เดียวก็เหลือท้ายของใบสุดท้ายแค่ใบเดียว `{masked}` ที่ปิดไว้แล้วตั้งแต่ Postgres (`sanitizeDiff()` →
 * `{masked, changed}`) ไม่ปิดซ้ำ แต่ยังผ่านกฎเลข 13 หลักของ `maskForLogStore` — `masked` ที่ใครส่งมาเป็นเลขเต็มจึงไม่หลุด
 */
function maskedCid(value: unknown, depth: number): unknown {
  if (value === null || value === undefined) return value;
  if (depth > 8) return "[ลึกเกิน]";
  if (Array.isArray(value)) return value.map((v) => maskedCid(v, depth + 1));
  if (typeof value === "object") {
    const proto = Object.getPrototypeOf(value);
    if (proto === Object.prototype || proto === null) {
      if ("masked" in value) return maskForLogStore(value, depth + 1);
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k.replace(CID_RUN, "[cid]"), maskedCid(v, depth + 1)]),
      );
    }
    // Date, Buffer, … — `plain()` ของ audit-fallback แปลงเป็นข้อความมาก่อนแล้ว ถึงตรงนี้ได้ก็ไม่รู้ว่าข้างในคืออะไร
    return { masked: "***" };
  }
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
 * ปิดเลขบัตรในสิ่งที่จะออกไปเป็นสำเนากิจกรรม — plan §7.6 ข้อที่ใช้ได้โดยไม่มี LOG_HASH_KEY
 * (key ค้นหา `cid#…` มากับงานสำเนา audit ใน step 6)
 *   - key ที่ชื่อบอกว่าถือเลขบัตร (ทุกชั้น) → `{masked: "xxxxxxxxx1234"}` เหลือ 4 ตัวท้ายไว้เทียบกับคนได้
 *     ค่าที่เป็น object หรือ array ปิดทีละใบข้างใน (`maskedCid`)
 *   - เลข 13 หลักที่อยู่ในค่าอื่นทุกตัว → `[cid]` (`maskCidRuns`)
 * อีเมลของบัญชี ชื่อ เบอร์ IP และ UA ไม่ถูกแตะ ตามที่ตัดสินไว้ (decision 10, plan §7.6)
 */
export function maskForLogStore(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[ลึกเกิน]";
  if (Array.isArray(value)) return value.map((v) => maskForLogStore(v, depth + 1));
  const proto = value !== null && typeof value === "object" ? Object.getPrototypeOf(value) : undefined;
  if (proto === Object.prototype || proto === null) {
    return Object.fromEntries(
      Object.entries(value as object).map(([k, v]) => {
        const key = k.replace(CID_RUN, "[cid]");
        if (CID_KEY.test(k)) return [key, maskedCid(v, depth + 1)];
        return [key, maskForLogStore(v, depth + 1)];
      }),
    );
  }
  return maskCidRuns(value);
}

/** ใช้ใน lib/error-capture.ts: id ที่หน้าตาเป็น UUID ให้ผ่าน ที่เหลือถือเป็นข้อความอิสระ */
export function isUuid(value: string): boolean {
  return UUID_EXACT.test(value);
}
