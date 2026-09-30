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

/**
 * ข้อความที่ยาวกว่านี้ถูกตัดก่อนกวาด (แบบ `scrubClipped()` — เผื่อข้อความหลังจุดตัดไว้ให้กฎจำได้) — regex ทุกตัวข้างล่าง
 * เป็นเส้นตรง (ดูหมายเหตุเหนือ BEFORE_UUID_RULES) แต่ก็ไม่ควรวิ่งบนข้อความขนาดเมกะไบต์ ข้อความที่มาจากคำขอ (ชื่อ key,
 * path, UA) ไม่ได้มาถึงขนาดนี้: ผู้เรียกตัดก่อนด้วย `scrubClipped()` เพราะ captureError เป็น synchronous บนเส้นทางของ
 * คำขอ และคำขอเดียวส่งชื่อ key มาได้ห้าสิบตัว
 */
const SCRUB_INPUT_MAX = 20_000;
/**
 * ข้อความที่เผื่อไว้หลังจุดตัดของ `scrubClipped()` — ของที่คร่อมจุดตัดต้องยังครบพอให้กฎจำได้ (อีเมลยาวได้ 254 ตัว,
 * ความลับยาว ๆ ต้องครบ 32 ตัว, เลขบัตรแบบมีตัวคั่น 13 ตัวบวกตัวคั่นไม่เกิน 36 ตัว) ไม่งั้นท่อนหน้าของมันหลุดออกไปโดย
 * ไม่ถูกกวาด ของที่ต้องมองไกลกว่านี้ถึงจะจำได้ไม่มีในตาราง
 */
const CLIP_CONTEXT = 256;

/** UUID ต้องรอดการกวาดทั้งตัว: มันคือ id ที่ใช้ตามรอย และตัวเลขข้างในหน้าตาเหมือนเบอร์โทรหรือเลขบัตรได้ */
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const UUID_EXACT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * ตัวเลขหนึ่งหลักในทุกรูปที่คนพิมพ์หรือวางมาได้ — อารบิก `0-9` เลขไทย `๐-๙` (U+0E50–0E59) และเลขเต็มความกว้าง `０-９`
 * (U+FF10–FF19 ของแป้นญี่ปุ่น/จีน และเอกสารที่คัดลอกมาจากระบบพวกนั้น) ใช้แทน `\d` ในทุกกฎที่หาเลขบัตร เบอร์โทร และ OTP
 * (`\d` ที่เหลือในไฟล์นี้อ่านของที่เป็นอารบิกเสมอ: เลขบรรทัดของ stack, ดัชนีที่กันไว้, ความลับ base64)
 *
 * `\d` ของ JavaScript คือ `[0-9]` เท่านั้น แม้มี flag `u` — เลขบัตรที่เขียนด้วยเลขไทย ซึ่งเป็นเรื่องปกติของหนังสือราชการ
 * และข้อความที่เจ้าหน้าที่หน่วยงานพิมพ์หรือวางลงบันทึก เคยผ่านทุกกฎไปถึง Mongo ครบ 13 หลัก และไม่ได้ key ค้นหา
 * (ตรวจขั้น 6, 2026-09-30) `hashKeyOf()` ใน lib/activity-shape.ts แปลงเลขพวกนี้เป็นอารบิกก่อน (`asciiDigits`) key ของ
 * `๑๑๐๑…` จึงเป็นตัวเดียวกับของ `1101…` ที่ `?cid=` ค้น — ทั้งสามช่วงเป็นอักขระ BMP ตัวเดียว ใช้ในวงเล็บเหลี่ยมได้โดยไม่ต้องมี `u`
 *
 * ต้องประกาศก่อนตารางกฎทุกตาราง: ตารางถูกสร้างตอนโหลดไฟล์ และ `const` ที่ประกาศทีหลังยังใช้ไม่ได้ตอนนั้น
 */
const DIGIT = "[0-9\\u0E50-\\u0E59\\uFF10-\\uFF19]";
/** ศูนย์ในสามรูปข้างบน — ตัวแรกของเบอร์โทรไทย */
const ZERO = "[0\\u0E50\\uFF10]";
/** หก ในสามรูป — `+66` */
const SIX = "[6\\u0E56\\uFF16]";
/** ขีดเต็มความกว้าง `－` (U+FF0D) มากับเลขเต็มความกว้างที่วางมาจากที่เดียวกัน นับเป็นขีดธรรมดา — ใช้ในวงเล็บเหลี่ยม */
const DASH = "\\-\\uFF0D";

/** เลขไทยและเลขเต็มความกว้าง → อารบิก ตัวอื่นไม่แตะ — ใช้ normalise เลขบัตรก่อนทำ key ค้นหา (lib/activity-shape.ts) */
export function asciiDigits(text: string): string {
  return text.replace(/[\u0E50-\u0E59\uFF10-\uFF19]/g, (digit) => {
    const code = digit.charCodeAt(0);
    return String(code >= 0xff10 ? code - 0xff10 : code - 0x0e50);
  });
}

/**
 * DETAIL/HINT/CONTEXT/WHERE ของ raw query อยู่บรรทัดของตัวเอง และค่าในแถวมีขึ้นบรรทัดใหม่ได้ — ตัด**จนสุดข้อความ**
 * ไม่หยุดที่อะไรเลย ใช้ทั้งในตารางข้างล่าง และกับส่วน stack ที่ `framesOf()` อ่าน
 *
 * เดิมหยุดที่บรรทัดที่ขึ้นต้นด้วยช่องว่างตามด้วย `at ` เผื่อมีคนส่ง stack ทั้งก้อนมากวาด (ให้เฟรมจริงข้างล่างรอด) แต่บรรทัด
 * แบบนั้นเขียนลงในแถวได้: `Failing row contains (…,\n    at evil (/app/src/routes/evil.ts:1:1) … row-secret)` — การตัด
 * หยุดตรงนั้น บรรทัดนั้นกับทุกบรรทัดหลังมันจึงรอดอยู่ในข้อความ แล้วตามไปอยู่ในหัวของ stack ที่เก็บ มีแค่ตารางกวาดคุม
 * (ลองแล้ว 2026-09-30) ไม่มีใครต้องการจุดหยุดนั้นแล้ว: `scrubError()` กวาดข้อความกับเฟรมแยกกัน ไม่เคยส่ง stack ทั้งก้อน
 * มาที่ `scrubText()` ตัดจนสุดข้อความเป็นเส้นตรงด้วย (เดิมที่เป็น lookahead ในวง — `(?:(?!\n\s+at )[\s\S])*` — ไล่บรรทัด
 * ว่างที่ตามมาทุกตัวอักษร: ใช้ 8.8 วินาทีต่อคำขอที่มีห้าสิบ key วัด 2026-09-30)
 */
const DETAIL_BLOCK = /\n(?:DETAIL|HINT|CONTEXT|WHERE):[\s\S]*/;

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
  // กินจนสุดข้อความ การแทนครั้งแรกจึงเป็นครั้งเดียว ไม่ต้องมี flag `g`
  [DETAIL_BLOCK, " (รายละเอียดของแถวตัดทิ้ง)"],
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
  "[A-Za-z0-9_-]*(?:token|key|secret|passw(?:or)?d|passcode|passphrase|otp|code|state|nonce|auth|authorization|cookie)" +
  "|(?:[A-Za-z0-9_-]*[_-])?(?:pwd|pin|pass|pw|sid|session)";
/**
 * key ที่ค่าเป็นวลีได้ (มีช่องว่าง จุลภาค) — ค่าที่ไม่มีเครื่องหมายคำพูดครอบถูกตัดไปจนสุดบรรทัด
 * `authorization` (`Digest username=…, response=…`) กับ `cookie` (`a=1; bdi_session=…`) ค่าเป็นหลายท่อนต่อกันเสมอ
 */
const PHRASE_KEY =
  "[A-Za-z0-9_-]*(?:secret|passw(?:or)?d|passcode|passphrase|authorization|cookie)|(?:[A-Za-z0-9_-]*[_-])?(?:pwd|pass)";
/**
 * คำสั้นเดียวกันแบบ camelCase (`newPass` `userPass` `oldPw` `userPin` `appSid`) — ต้องแยกเป็นกฎที่ไม่ใช้ flag `i`
 * เพราะตัวพิมพ์ใหญ่คือสิ่งเดียวที่บอกว่าเป็นท้ายคำ ไม่ใช่ `bypass` `compass` `upsid` ในข้อความธรรมดา
 * (JavaScript บน Node 22 ยังเปิด/ปิด `i` เฉพาะบางส่วนของ regex ไม่ได้) `…Password`, `…Token` มีกฎตัวพิมพ์ไม่สนอยู่แล้ว
 */
const CAMEL_SECRET_KEY = "[A-Za-z0-9_-]*[a-z0-9](?:Pass|PASS|Pwd|PWD|Pw|PW|Pin|PIN|Sid|SID|Session)";
const CAMEL_PHRASE_KEY = "[A-Za-z0-9_-]*[a-z0-9](?:Pass|PASS|Pwd|PWD)";

/**
 * กฎ `key=value` ทุกรูปของค่า สำหรับชุด key หนึ่งชุด — ชุดที่ไม่สนตัวพิมพ์ (`gi`) กับชุด camelCase (`g`) ใช้รูปเดียวกัน
 *   1. ในเครื่องหมายคำพูดคู่ · 2. เดี่ยว · 3. backtick — ค่าวิ่งไปจนถึงเครื่องหมายปิดที่ไม่ได้ escape ไม่ใช่แค่ถึงช่องว่าง
 *      (`token: \`ab cd\`` เคยหลุด ` cd\`` ออกไป)
 *   4. JSON ที่ถูก escape ซ้อนอยู่ในข้อความอีกชั้น — `{\"password\":\"ab,cd\"}` ค่าจบที่ `\"`
 *   5. key ที่ค่าเป็นวลีได้ ไม่มีเครื่องหมายคำพูดครอบ — ถึงสุดบรรทัด (หรือ `&` ของ query string) ค่าที่ขึ้นต้นด้วย
 *      เครื่องหมายคำพูดไม่นับ (กฎ 1–3 ตัดไปแล้ว ถ้านับซ้ำจะกินทุกอย่างที่ตามมาในบรรทัด) ตัวแรกห้ามเป็นช่องว่างด้วย
 *      ไม่งั้น `\s*` ถอยคืนช่องว่างให้แล้วค่าก็ "ขึ้นต้น" ด้วยช่องว่างแทนเครื่องหมายคำพูด
 *   6. ค่าคำเดียว — `token=…` `apiKey=…` `state=…` `code=…` `pin=…` `'sid': …`
 * ชื่อยังอยู่ให้รู้ว่ามีค่า แต่ค่าไม่อยู่ — code ที่ไม่ใช่ความลับ (`code=P2002`) ก็โดนไปด้วย ยอมรับ (plan §7.5)
 */
function keyValueRules(key: string, phraseKey: string, flags: string): Array<[RegExp, string]> {
  const start = "(?<![A-Za-z0-9_-])";
  return [
    [new RegExp(`${start}(${key})("?\\s*[:=]\\s*")((?:[^"\\\\]|\\\\[\\s\\S])*)`, flags), "$1$2[redacted]"],
    [new RegExp(`${start}(${key})('?\\s*[:=]\\s*')((?:[^'\\\\]|\\\\[\\s\\S])*)`, flags), "$1$2[redacted]"],
    [new RegExp(`${start}(${key})(\`?\\s*[:=]\\s*\`)((?:[^\`\\\\]|\\\\[\\s\\S])*)`, flags), "$1$2[redacted]"],
    [new RegExp(`${start}(${key})(\\\\"\\s*[:=]\\s*\\\\")((?:[^"\\\\]|\\\\[^"])*)`, flags), "$1$2[redacted]"],
    [new RegExp(`${start}(${phraseKey})(\\s*[=:]\\s*)([^\\s&"'\`][^\\r\\n&]*)`, flags), "$1$2[redacted]"],
    [new RegExp(`${start}(${key})(['"\`]?\\s*[=:]\\s*['"\`]?)([^\\s&"'\`,;}<>]+)`, flags), "$1$2[redacted]"],
  ];
}

/**
 * ตารางกวาดข้อความอิสระ (plan §7.5) — ลำดับมีผล: userinfo ของ URI กับ JWT ก่อน (ไม่งั้นท่อนข้างในโดนกฎอื่นกินไปครึ่งเดียว)
 * แล้ว `key=value` แล้วอีเมล แล้วกฎตัวเลข/ความลับที่รันหลังกัน UUID ไว้แล้ว (`scrubText`)
 *
 * ทุกกฎที่มี `+` ขึ้นต้นด้วย lookbehind ว่าต้องเริ่มที่ขอบของก้อน — ไม่งั้นข้อความยาว 20 KB ที่ไม่มีอะไรตรงจะถูกลอง
 * ทุกตำแหน่งเริ่มจนถึงท้ายก้อน (กำลังสอง) และ captureError เป็น synchronous บนเส้นทางของคำขอ
 * อีกรูปของกำลังสองคือ lookahead ที่อยู่**ในวง** `*` แล้วมองไปข้างหน้าได้ไม่จำกัด (`(?:(?!\n\s+at )[\s\S])*` ของ
 * DATABASE_DETAIL_RULES เคยเป็นแบบนี้) — lookahead ในวงต้องมองได้แค่ระยะสั้นหรือหยุดที่ขอบบรรทัด
 * กฎใหม่ต้องผ่านชุดทดสอบข้อความ 20 KB แบบปั่น (ตัวอักษรซ้ำ ๆ ของทุกกฎ) ให้จบในหลักมิลลิวินาทีก่อนใช้
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
  // `key=value` ทุกรูป (keyValueRules) — ชุดที่ไม่สนตัวพิมพ์ก่อน แล้วชุด camelCase ซึ่งชุดแรกไม่แตะเลย
  ...keyValueRules(SECRET_KEY, PHRASE_KEY, "gi"),
  ...keyValueRules(CAMEL_SECRET_KEY, CAMEL_PHRASE_KEY, "g"),
  // `otp 482913` · `code 482913` — คั่นด้วยช่องว่าง นับเฉพาะเลข 4–8 หลัก (ทุกรูปของ DIGIT): `status code 500` ต้องรอด
  [new RegExp(`(?<![A-Za-z0-9_-])(otp|code|pin|passcode)(\\s+)${DIGIT}{4,8}(?!${DIGIT})`, "gi"), "$1$2[redacted]"],
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
/**
 * เลขบัตร 13 หลัก ทั้งแบบติดกันและแบบมีตัวคั่น — ขีด จุด ขีดล่าง หรือช่องว่าง ไม่เกินสามตัวระหว่างเลข
 * (`1-2345-67890-12-3`, `1.1017.00203.45.1`, `1 - 1017 - 00203 - 45 - 1`) รูปเดียวกับกลุ่มเลขที่ `pathPattern()` ของ
 * lib/token-rejection.ts ปิด ยกเว้น `:` ซึ่งไม่นับที่นี่: เวลา `2026-09-30 12:34:56.789` มีเลขพอดี 13 หลักหลังขีดตัวแรก
 * และข้อความ error มีเวลาแบบนี้บ่อยกว่าเลขบัตรที่คั่นด้วย `:` มาก เดิมรับแค่ขีดหรือช่องว่างตัวเดียว เลขบัตรแบบมีจุดจึงหลุด
 * ตัวเลขเป็นได้ทั้งสามรูปของ DIGIT ปนกันได้ ใช้ทั้งกับข้อความ error (`scrubText`) และกับข้อความทุกค่าของสำเนากิจกรรม
 * ยกเว้นชื่อไฟล์ (`maskForLogStore`, `maskCidText`)
 */
const CID_RUN = new RegExp(`(?<!${DIGIT})${DIGIT}(?:[${DASH}._ ]{0,3}${DIGIT}){12}(?!${DIGIT})`, "g");
/**
 * เลขบัตรใน**ชื่อไฟล์**ของสำเนากิจกรรม (ค่าใต้ key แบบ `FILE_KEY` — `filename`, `originalFileName`, `storageKey`) —
 * แคบกว่า CID_RUN โดยตั้งใจ: ติดกัน หรือคั่นด้วยขีดหรือช่องว่าง**ตัวเดียว** (`1-2345-67890-12-3`, `1 2345 67890 12 3`)
 * ตัวเลขเป็นได้ทั้งสามรูปของ DIGIT
 *
 * ชื่อไฟล์มีวันที่กับเลขลำดับคั่นด้วยขีดล่างหรือจุดเป็นปกติ — CID_RUN ตัวกว้างทำให้ `scan_20260930_12345.pdf` ใน
 * `after.filename` ของ DOCUMENT_DOWNLOADED กลายเป็น `scan_[cid].pdf` และได้ `cid#` ปลอมหนึ่งตัว (ลองแล้ว 2026-09-30)
 * ส่วนชื่อไฟล์ที่เป็นเลขบัตรตรง ๆ (`1101700203451.pdf`) ยังถูกปิด
 *
 * เดิมตัวนี้ใช้กับข้อความ**ทุกค่า**ของสำเนากิจกรรม เลขบัตรที่คั่นด้วยจุด ขีดล่าง หรือตัวคั่นหลายตัวใน `notes` ของร่าง
 * จึงไปถึง `activity` ครบ 13 หลักและไม่ได้ `cid#` (ตรวจขั้น 6, 2026-09-30: สี่แถวจริงใน REQUEST_DRAFT_SAVED) — ตอนนี้
 * ข้อความอื่นทุกค่าใช้ CID_RUN ตัวกว้าง เหลือตัวแคบไว้แค่ชื่อไฟล์ ราคาของตัวกว้างในข้อความอิสระ: เลขอื่นที่มี 13 หลัก
 * คั่นด้วยจุดหรือขีดล่าง (ทศนิยมยาว ๆ, วันเวลาแบบ `30.09.2026 12.34.567`) กลายเป็น `[cid]` ในสำเนาและได้ `cid#` ที่ไม่มีใคร
 * ค้น ตัวเต็มยังอยู่ใน Postgres (ปิดเกินไว้ก่อน รอ DPO ยืนยัน — docs/21)
 * เบอร์โทร 10 หลักที่ตามด้วยช่องว่างกับเลขอีก 3 ตัว (`0812345678 123`) ถูกปิดเป็น `[cid]` ทั้งสองตัว
 */
const FILENAME_CID_RUN = new RegExp(`(?<!${DIGIT})${DIGIT}(?:[${DASH} ]?${DIGIT}){12}(?!${DIGIT})`, "g");
/** เบอร์โทรไทย `0` ตามด้วยอีก 8–9 หลัก (ขีด/ช่องว่างคั่นได้) — เลขไทยและเลขเต็มความกว้างด้วย (DIGIT) */
const PHONE_RUN = new RegExp(`(?<!${DIGIT})${ZERO}${DIGIT}(?:[${DASH} ]?${DIGIT}){7,8}(?!${DIGIT})`, "g");
/** รูปสากล `+66` ตามด้วยเลขที่ตัด `0` ตัวหน้าแล้ว 8–9 หลัก (`+66812345678`, `+66 81-234-5678`, `+66 2 123 4567`) */
const INTL_PHONE_RUN = new RegExp(
  `(?<!${DIGIT}|[+\\uFF0B])[+\\uFF0B]${SIX}${SIX}[${DASH} ]?${DIGIT}(?:[${DASH} ]?${DIGIT}){7,8}(?!${DIGIT})`,
  "g",
);

/** ตัวคั่นที่ไม่มีกฎไหนจับได้ (private use area) ใช้แทน UUID ระหว่างกวาด แล้วใส่คืนทีหลัง */
const HOLD_OPEN = "\uE000";
const HOLD_CLOSE = "\uE001";
const HELD = /\uE000(\d+)\uE001/g;
const HOLD_MARKS = /[\uE000\uE001]/g;

/**
 * ตัวคั่นสองตัวข้างบนที่มากับข้อความเอง → U+FFFD ก่อนเริ่มกัน UUID — ทุกทางที่กันแล้วใส่คืน (`applyRules`,
 * `maskCidText`) เรียกตัวนี้ก่อนเสมอ
 *
 * ไม่งั้นตอนใส่คืน ตัวคั่นกับเลขที่ผู้เรียกเขียนมาเอง (`\uE000999\uE001`) ถูกมองเป็นของที่กันไว้ ไม่มีตัวที่ 999
 * จึงถูกแทนด้วยข้อความว่าง — หายไปหลังกฎทุกตัวผ่านไปแล้ว และสองท่อนที่มันแยกไว้ต่อกันเป็นของดิบ: `110170‹999›0203451`
 * ออกมาเป็นเลขบัตรเต็ม อีเมลกับ `password=` ก็แบบเดียวกัน (ลองแล้ว 2026-09-30 ทั้ง scrubText, requestTarget, bodyShape
 * และสำเนากิจกรรม) ข้อความจริงไม่มีสองตัวนี้ (private use area ไม่มีความหมายกลาง) การแทนจึงไม่เสียอะไร
 */
function neutraliseHolds(text: string): string {
  return text.includes(HOLD_OPEN) || text.includes(HOLD_CLOSE) ? text.replace(HOLD_MARKS, "\uFFFD") : text;
}

/**
 * กวาดข้อมูลส่วนบุคคลและความลับออกจากข้อความอิสระ — ไม่ throw
 *
 * | รูปแบบ | กลายเป็น |
 * |---|---|
 * | `detail: Some("Failing row contains …")` / `DETAIL: …` ของ Postgres ที่ Prisma ยกมา | `detail: [ตัดทิ้ง]` |
 * | userinfo ใน URI (`postgresql://u:p@host`, ถึง `@` ตัวสุดท้ายก่อน `/`) | `postgresql://***@host` |
 * | JWT `eyJ…` | `[jwt]` |
 * | `Bearer …` / `Basic …` | `Bearer [redacted]` |
 * | `token=` `key=` `secret=` `password=` `pwd=` `pass=` `pw=` `pin=` `passcode=` `otp=` `code=` `state=` `nonce=` `auth=` `authorization:` `cookie:` `sid=` `bdi_session=` · camelCase `newPass=` `oldPw=` `userPin=` `appSid=` | `…=[redacted]` |
 * | `"password":"ab,cd ef"` · `token='ab cd'` · ``token: `ab cd` `` (ทั้งค่าจนถึงเครื่องหมายปิด) · `password: วลี มี ช่องว่าง` · `Cookie: a=1; b=2` (จนสุดบรรทัด) | `…[redacted]` |
 * | `otp 482913` / `code 482913` (เลข 4–8 หลักหลังช่องว่าง) | `otp [redacted]` |
 * | อีเมล | `[email]` |
 * | ฐานสิบหก/base64url ยาว 32 ตัวขึ้นไปที่มีตัวเลข (ยกเว้น UUID) · base64 ที่มี `/` `+` และตัวใหญ่ ตัวเล็ก ตัวเลขปนกัน | `[secret]` |
 * | เลข 13 หลัก / เลขบัตรที่คั่นด้วยขีด จุด ขีดล่าง หรือช่องว่าง | `[cid]` |
 * | `0` + 8–9 หลัก · `+66` + 8–9 หลัก | `[phone]` |
 *
 * ทุกกฎตัวเลขนับเลขไทย (`๑๑๐๑…`) และเลขเต็มความกว้าง (`１１０１…`) เป็นตัวเลขด้วย (DIGIT)
 */
export function scrubText(text: string): string {
  return text.length > SCRUB_INPUT_MAX ? scrubClipped(text, SCRUB_INPUT_MAX) : applyRules(text);
}

/** ตารางกวาดทั้งตารางบนข้อความทั้งก้อน ไม่ตัด — ผู้เรียกตัดมาแล้วเสมอ (`scrubText`, `scrubClipped`) */
function applyRules(text: string): string {
  let out = neutraliseHolds(text);
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
 * กวาดข้อความยาวไม่จำกัด แล้วเหลือไม่เกิน `max` ตัว — ใช้กับข้อความที่**ผู้เรียก API เลือกเองได้** (ชื่อ key ของ body
 * และของ query, path, user-agent) กับบรรทัดเฟรมของ stack และเป็นทางที่ `scrubText()` ใช้กับข้อความเกิน SCRUB_INPUT_MAX
 * ตัดก่อนกวาด ไม่ใช่กวาดก่อนตัด: ค่าเหล่านี้ยาวได้ถึงเพดานของ body (1 MB) หรือของ header (16 KB) และ captureError
 * เรียกตัวนี้บนเส้นทางของคำขอก่อนเพดานการเก็บตัวไหนจะได้ดู แม้ log store ปิดอยู่
 *
 * การตัดต้องไม่ผ่ากลางของที่กฎจำได้แล้วปล่อยท่อนหน้าไป (ความลับ 40 ตัวที่เหลือ 20 ตัวไม่ครบ 32 ตัว อีเมลที่ขาดโดเมน)
 * จึงกวาดสองรอบ: รอบหนึ่งบนข้อความถึงจุดตัด อีกรอบเผื่อข้อความหลังจุดตัดไว้ CLIP_CONTEXT ตัว แล้วเก็บเฉพาะส่วนหน้าที่
 * สองรอบได้ตรงกัน — ทุกตัวในนั้นมาจากข้อความก่อนจุดตัด และไม่มีกฎไหนเห็นต่างเพราะรู้ว่ามีอะไรต่อ ของที่คร่อมจุดตัดซึ่ง
 * รอบที่เผื่อจำได้ (`[secret]`, `[phone]`) ทำให้สองรอบแยกกันตรงจุดเริ่มของมัน จึงไม่เหลือแม้แต่ท่อนหน้า
 *
 * เดิมกวาดรอบเดียวที่ `max + CLIP_CONTEXT` แล้วนับตัดที่ `max` ตัวของ**ผลลัพธ์** — ถ้าก่อนหน้านั้นมีก้อนยาวที่ถูกย่อ
 * (ความลับ 400 ตัวเหลือ `[secret]` 8 ตัว) ตัวที่ `max` ของผลลัพธ์ก็เลยจุดตัดเดิมไป แล้วท่อนหน้าของความลับที่คร่อมจุดตัด
 * ก็ติดมาด้วย (ลองแล้ว 2026-09-30) ส่วน `scrubText()` กับบรรทัดเฟรมตัดเฉย ๆ ไม่เผื่ออะไรเลย: เฟรมที่มีความลับ
 * คร่อมคอลัมน์ 1,024 ได้ `[phone]abcdef0123`
 */
export function scrubClipped(text: string, max: number): string {
  const limit = Math.min(max, SCRUB_INPUT_MAX);
  if (text.length <= limit) return applyRules(text).slice(0, limit);
  const withContext = applyRules(text.slice(0, limit + CLIP_CONTEXT));
  const atCut = applyRules(text.slice(0, limit));
  return commonPrefix(withContext, atCut).slice(0, limit);
}

function commonPrefix(a: string, b: string): string {
  const end = Math.min(a.length, b.length);
  let i = 0;
  while (i < end && a.charCodeAt(i) === b.charCodeAt(i)) i++;
  return a.slice(0, i);
}

/** ข้อความของ Prisma ที่ยาวกว่านี้ถูกตัดหางก่อนตัด DETAIL — ข้อความปกติ (โค้ดรอบจุดที่เรียกกับสาเหตุ) ไม่ถึงหลักพัน */
const DATABASE_LOG_INPUT_MAX = 64 * 1024;

/**
 * บรรทัดเดียวของ log ของ Prisma เอง (`prisma:error`, db.ts) — ข้อความเต็มของมันยกโค้ดรอบจุดที่เรียก และ DETAIL ของแถว
 * ที่ Postgres ปฏิเสธมาทั้งแถว จึงตัด DETAIL ก่อน (ทั้งก้อน) แล้วค่อยหยิบบรรทัดสุดท้าย (สาเหตุจริง เหมือน `headlineOf`)
 * แล้วกวาด ไม่ตัดเหลือ 500 ตัวก่อนตัด DETAIL: ถ้าตัดก่อน บรรทัดสุดท้ายที่เหลืออาจเป็นกลางแถวพอดี
 *
 * แต่ก็ไม่วิ่งบนข้อความยาวไม่จำกัด (ค่าในแถวมาจากสิ่งที่ผู้ใช้กรอก): เกิน 64 KB ถูกตัด**หาง**ทิ้งก่อน ซึ่งไม่ทำให้
 * ค่าของแถวหลุด — หัว `DETAIL:` / `detail: Some("` มาก่อนค่าของแถวเสมอ และกฎของมันตัดไปจนสุดข้อความเมื่อหาตัวปิด
 * ไม่เจอ ที่เสียคือบรรทัดสุดท้ายของข้อความที่ยาวขนาดนั้นไม่ใช่สาเหตุจริง — ยอมรับ ข้อความปกติไม่มีทางยาวถึง
 */
export function databaseLogLine(message: string): string {
  let stripped = message.length > DATABASE_LOG_INPUT_MAX ? message.slice(0, DATABASE_LOG_INPUT_MAX) : message;
  for (const [pattern, replacement] of DATABASE_DETAIL_RULES) stripped = stripped.replace(pattern, replacement);
  return scrubClipped(headlineOf("Prisma", stripped), 500);
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
    if (typeof name === "string" && name) return scrubClipped(name, 100);
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
    else if (typeof value === "string") props[key] = scrubClipped(value, 200);
  }
  // Prisma: ชื่อคอลัมน์หรือ index ที่ชน (P2002) — ชื่อ ไม่ใช่ค่า
  const target = (source.meta as { target?: unknown } | undefined)?.target;
  if (typeof target === "string") props.metaTarget = target.slice(0, 200);
  else if (Array.isArray(target)) {
    props.metaTarget = target.filter((t): t is string => typeof t === "string").slice(0, 10);
  }
  return props;
}

/**
 * เพดานของการอ่าน stack — หลังตัดส่วนหัว (ข้อความ) ทิ้งแล้ว อ่านแค่ STACK_PARSE_MAX ตัวแรก เก็บไม่เกิน FRAMES_MAX
 * เฟรม และบรรทัดละไม่เกิน FRAME_LINE_MAX ตัว (ตัดหลังกวาด — `scrubClipped`) stack จริงของเรามีสิบเฟรม
 * (Error.stackTraceLimit) บรรทัดละไม่ถึง 200 ตัว `err.stack` ไม่มีเพดานของตัวเอง: มันถือข้อความทั้งก้อน ซึ่งมาจากค่าที่
 * ผู้เรียกส่งมาได้ (ถึง 1 MB ของ body)
 */
const STACK_PARSE_MAX = 64 * 1024;
const FRAMES_MAX = 50;
const FRAME_LINE_MAX = 1_024;

/**
 * ส่วนของ stack ที่อยู่**ใต้**ข้อความ — V8 เขียนหัวเป็น `${name}: ${message}` (หรือ `${name}` เมื่อข้อความว่าง) แล้วตามด้วยเฟรม
 *
 * เดิมหยิบทุกบรรทัดของ stack ดิบที่ขึ้นต้นด้วยช่องว่าง + `at ` ซึ่งรวมบรรทัดในข้อความด้วย: ข้อความที่มีบรรทัด
 * `    at evil (/app/src/routes/evil.ts:1:1)` กลายเป็น topFrame (fingerprint ของ issue) และบรรทัดนั้นถูกยกไปเก็บใน stack
 * โดยไม่ผ่านการตัด DETAIL ที่ข้อความผ่าน ตัดหัวทิ้งด้วยการเทียบตรงตำแหน่ง (`startsWith` เส้นตรง ไม่ค้นหา)
 * stack ที่หัวไม่ตรงกับข้อความ (ถูกแต่งเอง หรือข้อความถูกแก้หลัง V8 เขียนหัวไปแล้ว — V8 เขียนหัวตอนอ่าน `stack` ครั้งแรก)
 * อ่านทั้งก้อนเหมือนเดิม แต่ยังอยู่ใต้เพดานทุกตัว และ `framesOf()` ตัดก้อน DETAIL ในนั้นทิ้งก่อนหยิบเฟรม
 */
function belowMessage(stack: string, message: string): string {
  if (message === "") {
    const newline = stack.indexOf("\n");
    return newline === -1 ? "" : stack.slice(newline + 1);
  }
  const colon = stack.indexOf(": ");
  if (colon !== -1 && colon <= 200 && stack.startsWith(message, colon + 2)) {
    return stack.slice(colon + 2 + message.length);
  }
  return stack;
}

/**
 * บรรทัด `at …` ของ stack **ดิบ** — ไม่รวมบรรทัดหัวหรือบรรทัดในข้อความ และไม่เกินเพดานข้างบน ผู้เรียกกวาดเองทีละบรรทัด
 *
 * ก้อน DETAIL ของ raw query (`DETAIL_BLOCK`) ถูกตัดทิ้งจากส่วนที่อ่านก่อนหยิบบรรทัด — ส่วนใต้ข้อความของ stack ปกติไม่มี
 * ก้อนแบบนั้น จึงไม่เสียอะไร แต่ stack ที่หัวไม่ตรงกับข้อความถูกอ่านทั้งก้อน และบรรทัดในแถวที่หน้าตาเป็นเฟรม
 * (`    at evil (…) row-secret`) จะถูกหยิบเป็นเฟรมโดยไม่ผ่านการตัด DETAIL เลย ตัดแล้วเฟรมจริงที่อยู่ใต้ก้อนนั้นหายไปด้วย —
 * ยอมเสีย stack ของ error แบบนั้นดีกว่าเก็บค่าของแถว บรรทัดที่เกิน FRAME_LINE_MAX เก็บเผื่อไว้ CLIP_CONTEXT ตัวให้
 * `scrubClipped()` ใช้จำของที่คร่อมจุดตัด
 */
function framesOf(err: unknown): string[] {
  if (!(err instanceof Error) || typeof err.stack !== "string") return [];
  const message = typeof err.message === "string" ? err.message : "";
  const region = belowMessage(err.stack, message).slice(0, STACK_PARSE_MAX).replace(DETAIL_BLOCK, "");
  const keep = FRAME_LINE_MAX + CLIP_CONTEXT;
  const frames: string[] = [];
  for (const line of region.split("\n")) {
    if (!/^\s+at /.test(line)) continue;
    frames.push(line.length > keep ? line.slice(0, keep) : line);
    if (frames.length >= FRAMES_MAX) break;
  }
  return frames;
}

const DIGITS = /^\d+$/;

/**
 * แยกเฟรมหนึ่งบรรทัดเป็นชื่อฟังก์ชันกับไฟล์ ด้วยการหาตำแหน่งตรง ๆ ไม่ใช้ regex ที่ย้อนรอยได้
 *
 * เดิมเป็น `/at (?:async )?(?:(.+?) \()?…:\d+:\d+\)?$/` ที่ไม่ยึดหัว: ทุกตำแหน่งของ `at ` ในบรรทัด `.+?` ไล่ไปจน
 * สุดบรรทัด บรรทัดที่มี `at ` ซ้ำหมื่นครั้ง (30 KB) ใช้ 122 ms ยี่สิบบรรทัดแบบนั้น 400 ms (วัด 2026-09-30) ขณะที่
 * captureError เป็น synchronous บนเส้นทางของคำขอ ผลของรูปปกติเท่าเดิมทุกรูป: `at fn (/app/src/x.ts:1:2)`,
 * `at async fn (file:///…)`, `at /app/src/x.ts:1:2`, `at new Foo (…)`, `at A.b [as c] (…)`
 */
function frameParts(frame: string): { fn: string | null; file: string } | null {
  let text = frame.trim();
  if (!text.startsWith("at ")) return null;
  text = text.slice(3);
  if (text.startsWith("async ")) text = text.slice(6);
  let fn: string | null = null;
  let location = text;
  if (text.endsWith(")")) {
    const open = text.indexOf(" (");
    if (open === -1) return null;
    fn = text.slice(0, open);
    location = text.slice(open + 2, -1);
  }
  if (location.startsWith("file://")) location = location.slice(7);
  const column = location.lastIndexOf(":");
  const line = column <= 0 ? -1 : location.lastIndexOf(":", column - 1);
  if (line <= 0) return null;
  if (!DIGITS.test(location.slice(column + 1)) || !DIGITS.test(location.slice(line + 1, column))) return null;
  const file = location.slice(0, line);
  if (/[()\s]/.test(file)) return null;
  return { fn, file };
}

/** `/app/src/lib/audit.ts` → `lib/audit` — ส่วนหลัง `/src/` หรือ `/dist/` ตัวแรก ไม่รวมนามสกุล หรือ null ถ้าไม่ใช่โค้ดเรา */
function inAppModule(file: string): string | null {
  const starts = [file.indexOf("/src/"), file.indexOf("/dist/")].filter((index) => index !== -1);
  if (starts.length === 0) return null;
  const start = Math.min(...starts);
  const bodyStart = start + (file.startsWith("/src/", start) ? 5 : 6);
  const extension = /\.[cm]?[jt]s$/.exec(file);
  if (!extension || extension.index <= bodyStart) return null;
  return file.slice(bodyStart, extension.index);
}

/**
 * เฟรมแรกที่เป็นโค้ดของเรา ในรูป `lib/audit:logAudit` — ตัด `/app/src/` หรือ `/app/dist/` และนามสกุลทิ้ง
 * dev (tsx: `.ts`) กับ production (`dist/*.js` ที่ source map พากลับไป `.ts`) จึงได้ค่าเดียวกัน ไม่มีเลขบรรทัด:
 * แก้บรรทัดข้างบนแล้ว issue เดิมต้องยังเป็น issue เดิม
 */
function topFrameOf(frames: string[]): string | null {
  for (const frame of frames) {
    const parts = frameParts(frame);
    if (!parts) continue;
    if (parts.file.includes("node_modules") || parts.file.startsWith("node:")) continue;
    const module = inAppModule(parts.file);
    if (!module) continue;
    const fn = (parts.fn ?? "<anonymous>").replace(/^new /, "").slice(0, 100);
    return `${module}:${fn}`;
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
    // หัวกับเฟรมกวาดแยกกัน: ข้อความกวาดมาแล้ว (DETAIL ตัดจนสุดข้อความ) และแต่ละเฟรมถูกตัดที่ FRAME_LINE_MAX **หลัง**กวาด
    // ไม่ใช่ก่อน เดิมต่อทั้งหมดแล้วกวาดทีเดียว ซึ่งเกิน SCRUB_INPUT_MAX ได้ (ห้าสิบเฟรม) และเฟรมถูกตัดดิบ ๆ มาก่อนแล้ว
    // หยุดกวาดเมื่อยาวเกิน STACK_MAX — เฟรมที่เหลือไม่ถูกเก็บอยู่แล้ว
    const header = scrubText(`${name}: ${message}`);
    const lines = [header];
    let length = header.length;
    for (const frame of frames) {
      if (length > STACK_MAX) break;
      const line = scrubClipped(frame, FRAME_LINE_MAX);
      lines.push(line);
      length += line.length + 1;
    }
    stack = lines.join("\n");
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
 * present/absent ทั้งก้อนตามชื่อของมันเอง ชื่อ key ผ่านตารางกวาดด้วย เพราะผู้เรียกตั้งชื่อ key เป็นอะไรก็ได้ — และยาว
 * แค่ไหนก็ได้ภายใน 1 MB ของ body จึงตัดก่อนกวาด (`scrubClipped`)
 */
export function bodyShape(body: unknown): Record<string, string> | null {
  if (!body || typeof body !== "object" || Array.isArray(body) || Buffer.isBuffer(body)) return null;
  const entries = Object.entries(body as Record<string, unknown>);
  const shape: Record<string, string> = {};
  for (const [key, value] of entries.slice(0, BODY_KEYS_MAX)) {
    const safeKey = scrubClipped(key, 64);
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
        keys.add(scrubClipped(key, 64));
        if (keys.size >= 20) break;
      }
    } catch {
      keys.add("(อ่าน query ไม่ออก)");
    }
  }
  return { path: scrubClipped(rawPath, 300), queryKeys: [...keys] };
}

/** header ที่ออกไปได้ — ไม่มี cookie, x-admin-token, x-log-token, authorization, referer หรืออะไรนอกรายการ */
const HEADER_ALLOWLIST = ["user-agent", "content-type", "content-length"] as const;

export function allowedHeaders(headers: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of HEADER_ALLOWLIST) {
    const value = headers[name];
    if (typeof value === "string") out[name] = scrubClipped(value, 512);
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
 * ชื่อ key ที่ถือชื่อไฟล์หรือ storage key — ค่าข้างใต้ (ทุกชั้น) ใช้ FILENAME_CID_RUN ตัวแคบแทน CID_RUN ในสำเนากิจกรรม
 * ชื่อที่ audit เขียนวันนี้: `after.filename` (อัปโหลด ดาวน์โหลด ลงนาม) และ `before.attachments[].originalFileName` /
 * `storageKey` ของ REQUEST_DELETED — `storedFileName` `file_name` `storage_keys` ก็เข้า
 */
const FILE_KEY = /(?:file_?name|storage_?key|original_?name)s?$/i;

/**
 * ค่าจริงที่การปิดของสำเนากิจกรรมปิดไปเอง — lib/activity-shape.ts ทำ key ค้นหา `cid#…` จากค่าพวกนี้ (ก่อนปิด)
 * ค่าที่ถูกปิดมาแล้วตั้งแต่ Postgres (`{masked, changed}`) ไม่อยู่ในนี้: ค่าจริงของมันไม่เหลือให้ทำ key
 */
export interface MaskFindings {
  /** ค่าใต้ key ที่ชื่อบอกว่าถือเลขบัตร และเลข 13 หลักที่พบในข้อความอื่น — ตามที่เจอ ยังไม่ normalise */
  cids: string[];
}

/**
 * เลขบัตรในข้อความ (CID_RUN ตัวกว้าง — กฎเดียวกับข้อความ error) → `[cid]` โดยไม่แตะ UUID — กันไว้ก่อนแล้วใส่คืน
 * แบบเดียวกับ `scrubText` ใช้กับข้อความชั้นบนของสำเนากิจกรรมที่ไม่ได้อยู่ใน before/after/metadata (`reason`, ชื่อผู้กระทำ,
 * ชื่อช่องที่เปลี่ยน, user agent — lib/activity-shape.ts) `findings` ได้ค่าจริงของตัวที่ถูกปิด ไว้ทำ `cid#`
 *
 * UUID ที่ขึ้นต้นด้วยเลขล้วน 12 ตัว (`12345678-1234-4abc-…`: กลุ่มที่สามของ v4 ขึ้นต้นด้วยเลข 4 เสมอ) คือเลข 13 หลักที่
 * คั่นด้วยขีด — เดิมกลายเป็น `[cid]abc-9def-…` ทั้ง id ใน metadata (`user_account_id`,
 * `integration_operation_id`) และ id ในข้อความ ลองกับ UUID สุ่มสองแสนตัว (2026-09-30) โดนไป 1.2% — id ที่ใช้ตามรอยและ
 * join กลับไป Postgres ทุกตัวที่ร้อยเสียไปหนึ่ง
 */
export function maskCidText(text: string, findings?: MaskFindings): string {
  return maskCidTextWith(text, { run: CID_RUN, findings });
}

/**
 * การปิดรอบหนึ่ง — กฎเลขบัตรในข้อความที่ใช้ กับที่เก็บค่าจริงที่ถูกปิด
 *   - สำเนากิจกรรม (`maskForLogStore`): `CID_RUN` ตัวกว้าง ยกเว้นค่าใต้ key ชื่อไฟล์ (`FILE_KEY`) ที่ใช้
 *     `FILENAME_CID_RUN` ตัวแคบ (`fileRun`) — ชื่อไฟล์ที่มีวันที่กับเลขลำดับต้องรอด
 *   - สำเนาใน error (`maskForErrorCopy`): `CID_RUN` ตัวกว้างทุกค่า ชื่อไฟล์ด้วย เท่ากับข้อความ error ที่ `scrubText` กวาด
 */
interface MaskPass {
  run: RegExp;
  /** กฎของค่าใต้ key ชื่อไฟล์ — ไม่มี = ใช้ `run` */
  fileRun?: RegExp;
  findings?: MaskFindings;
}

function maskCidTextWith(text: string, pass: MaskPass): string {
  if (UUID_EXACT.test(text)) return text;
  const held: string[] = [];
  const out = neutraliseHolds(text)
    .replace(UUID, (uuid) => `${HOLD_OPEN}${held.push(uuid) - 1}${HOLD_CLOSE}`)
    .replace(pass.run, (run) => {
      pass.findings?.cids.push(run);
      return "[cid]";
    });
  return held.length > 0 ? out.replace(HELD, (_all, index: string) => held[Number(index)] ?? "") : out;
}

/**
 * เลข 13 หลักใน**ทุก**ค่าที่เป็นข้อความ ไม่ใช่แค่ `note` / `reason` อย่างที่ plan §7.6 เขียนไว้ — ช่องข้อความอิสระที่
 * audit บันทึกมีอีกมาก (`notes`, `objectiveOther`, `dataFields`, `title`, ความเห็น) ผู้ตรวจพิมพ์เลขบัตรลง `notes`
 * ของร่างคำขอแล้วเลขนั้นไปถึงทั้ง `activity` และ `error_events.extra.audit` ครบทั้ง 13 หลัก (2026-09-30)
 * ตัวเลข (number) 13 หลักก็นับ — audit ส่งวันเวลามาเป็น ISO string (`plain()` ใน audit-fallback) ไม่ใช่ epoch ms
 * จึงไม่มีอะไรถูกปิดผิดตัวในวันนี้ และ key ของ object ก็ผ่านกฎเดียวกัน (object ที่ใช้เลขบัตรเป็น key)
 */
function maskCidRuns(value: unknown, pass: MaskPass): unknown {
  if (typeof value === "string") return maskCidTextWith(value, pass);
  if (typeof value === "number" && Number.isInteger(value) && Math.abs(value) >= 1e12 && Math.abs(value) < 1e13) {
    pass.findings?.cids.push(String(Math.abs(value)));
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
function maskedCid(value: unknown, depth: number, pass: MaskPass): unknown {
  if (value === null || value === undefined) return value;
  if (depth > 8) return "[ลึกเกิน]";
  if (Array.isArray(value)) return value.map((v) => maskedCid(v, depth + 1, pass));
  if (typeof value === "object") {
    const proto = Object.getPrototypeOf(value);
    if (proto === Object.prototype || proto === null) {
      if ("masked" in value) return maskValue(value, depth + 1, pass);
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [maskCidTextWith(k, pass), maskedCid(v, depth + 1, pass)]),
      );
    }
    // Date, Buffer, … — `plain()` ของ audit-fallback แปลงเป็นข้อความมาก่อนแล้ว ถึงตรงนี้ได้ก็ไม่รู้ว่าข้างในคืออะไร
    return { masked: "***" };
  }
  const text = String(value);
  pass.findings?.cids.push(text);
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
 * ปิดเลขบัตรในสิ่งที่จะออกไปเป็นสำเนากิจกรรม — plan §7.6
 *   - key ที่ชื่อบอกว่าถือเลขบัตร (ทุกชั้น) → `{masked: "xxxxxxxxx1234"}` เหลือ 4 ตัวท้ายไว้เทียบกับคนได้
 *     ค่าที่เป็น object หรือ array ปิดทีละใบข้างใน (`maskedCid`)
 *   - เลขบัตรที่อยู่ในค่าอื่นทุกตัว → `[cid]` (`maskCidRuns`) ด้วย CID_RUN ตัวกว้าง (ติดกัน หรือคั่นด้วยขีด จุด ขีดล่าง
 *     ช่องว่าง ไม่เกินสามตัว) — ยกเว้นค่าใต้ key ชื่อไฟล์ (`FILE_KEY`) ที่ใช้ FILENAME_CID_RUN ตัวแคบ
 * อีเมลของบัญชี ชื่อ เบอร์ IP และ UA ไม่ถูกแตะ ตามที่ตัดสินไว้ (decision 10, plan §7.6)
 *
 * `findings` (ถ้าส่งมา) ได้ค่าจริงของทุกตัวที่ถูกปิดที่นี่ — lib/activity-shape.ts ทำ key ค้นหา `cid#…` จากมัน
 * ค่าจริงไม่ออกจาก process ทางอื่น
 */
export function maskForLogStore(value: unknown, findings?: MaskFindings): unknown {
  return maskValue(value, 0, { run: CID_RUN, fileRun: FILENAME_CID_RUN, findings });
}

/**
 * แบบเดียวกับ `maskForLogStore` แต่ชื่อไฟล์ก็ใช้ CID_RUN ตัวกว้าง — สำหรับ input ของแถว audit ที่ Postgres ไม่รับ ซึ่งไปอยู่
 * ใน `error_events.extra.audit` (lib/audit-fallback.ts) สำเนานั้นเป็นข้อมูลของ error ไม่ใช่บันทึกที่คนค้นและอ่าน ปิดเกินได้
 * เหมือนข้อความ error (ชื่อไฟล์ที่มีวันที่กับเลขลำดับกลายเป็น `[cid]` — ยอมรับ) ไม่ทำ key ค้นหา
 */
export function maskForErrorCopy(value: unknown): unknown {
  return maskValue(value, 0, { run: CID_RUN });
}

function maskValue(value: unknown, depth: number, pass: MaskPass): unknown {
  if (depth > 8) return "[ลึกเกิน]";
  if (Array.isArray(value)) return value.map((v) => maskValue(v, depth + 1, pass));
  const proto = value !== null && typeof value === "object" ? Object.getPrototypeOf(value) : undefined;
  if (proto === Object.prototype || proto === null) {
    return Object.fromEntries(
      Object.entries(value as object).map(([k, v]) => {
        const key = maskCidTextWith(k, pass);
        if (CID_KEY.test(k)) return [key, maskedCid(v, depth + 1, pass)];
        if (pass.fileRun && FILE_KEY.test(k)) return [key, maskValue(v, depth + 1, { ...pass, run: pass.fileRun })];
        return [key, maskValue(v, depth + 1, pass)];
      }),
    );
  }
  return maskCidRuns(value, pass);
}

/** ใช้ใน lib/error-capture.ts: id ที่หน้าตาเป็น UUID ให้ผ่าน ที่เหลือถือเป็นข้อความอิสระ */
export function isUuid(value: string): boolean {
  return UUID_EXACT.test(value);
}
