/** Fail fast at boot rather than at first use with a confusing stack trace. */
function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/**
 * ตัวแปรที่ตั้งเป็นค่าว่างถือว่า "ไม่ได้ตั้ง" — docker compose ส่ง `FOO=` มาเสมอ
 * เมื่อเขียน `${FOO:-}` ไว้ ถ้าใช้ `??` ค่าว่างจะทับ default โดยไม่ตั้งใจ
 */
function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === "" ? fallback : value;
}

/**
 * ความลับที่มีค่า default ให้ตอน dev เพื่อความสะดวก แต่ห้ามใช้ค่านั้นจริง
 *
 * ปล่อยให้ fallback เงียบ ๆ บน production คือสิ่งที่แย่ที่สุดของทั้งสองทาง —
 * ระบบบูตได้ตามปกติ ดูเหมือนทุกอย่างเรียบร้อย ทั้งที่ค่าที่ใช้อยู่เขียนไว้ในซอร์ส
 */
function requiredInProduction(name: string, devFallback: string): string {
  const value = process.env[name];
  if (value) return value;
  if (process.env.NODE_ENV === "production") {
    throw new Error(`Missing required environment variable in production: ${name}`);
  }
  return devFallback;
}

/**
 * รายการ fingerprint ของ token (ฐานสิบหก 12 ตัว คั่นด้วย comma) — ค่าที่ผิดรูปถูกข้ามพร้อมคำเตือนตอนบูต
 *
 * ไม่ throw: รายการนี้ช่วยเฝ้าดู ไม่ใช่สิ่งที่ระบบขาดไม่ได้ พิมพ์ผิดตัวเดียวไม่ควรทำให้ API บูตไม่ขึ้น
 * แต่ต้องบอก ไม่งั้นคนตั้งจะเชื่อว่ากำลังเฝ้าอยู่ทั้งที่ค่านั้นไม่มีวันตรง คำเตือน **ไม่พิมพ์ค่าที่ผิดรูป**
 * เพราะความผิดที่น่าจะเกิดที่สุดคือวาง token จริงลงไปแทน fingerprint ของมัน
 */
function fingerprintList(name: string): string[] {
  const entries = optional(name, "")
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
  const valid = entries.filter((v) => /^[0-9a-f]{12}$/.test(v));
  if (valid.length < entries.length) {
    console.warn(
      `[env] ${name}: ข้าม ${entries.length - valid.length} ค่าที่ไม่ใช่ fingerprint ฐานสิบหก 12 ตัว ` +
        "(ไม่พิมพ์ค่านั้น เผื่อเป็น token จริง)",
    );
  }
  return valid;
}

/**
 * จำนวนบวกจาก env — ค่าที่อ่านไม่ออกใช้ค่าตั้งต้นแทนพร้อมคำเตือน ไม่ throw
 *
 * `Number("5GB")` ได้ NaN และการเทียบกับ NaN เป็นเท็จเสมอ เพดานที่ตั้งผิดรูปจึงกลายเป็น "ไม่มีเพดาน" เงียบ ๆ
 * ค่านี้ไม่ใช่ความลับ พิมพ์ชื่อตัวแปรกับค่าตั้งต้นที่ใช้แทนได้
 */
function positiveNumber(name: string, fallback: number): number {
  const raw = optional(name, "");
  if (raw === "") return fallback;
  const value = Number(raw);
  if (Number.isFinite(value) && value > 0) return value;
  console.warn(`[env] ${name}: ไม่ใช่จำนวนบวก — ใช้ค่าตั้งต้น ${fallback} แทน`);
  return fallback;
}

/**
 * รายการอีเมลคั่นด้วย comma — ค่าที่ไม่ใช่อีเมลถูกข้ามพร้อมคำเตือน (บอกจำนวน ไม่พิมพ์ค่า) ตัวพิมพ์เล็ก ไม่ซ้ำ
 */
function emailList(name: string): string[] {
  const entries = optional(name, "")
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
  const valid = [...new Set(entries.filter((v) => /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(v)))];
  if (valid.length < new Set(entries).size) {
    console.warn(`[env] ${name}: ข้าม ${new Set(entries).size - valid.length} ค่าที่ไม่ใช่อีเมล`);
  }
  return valid;
}

/** อ่านก่อนสร้าง env เพราะ redirect_uri ของ ThaID ตั้งต้นจากค่านี้ */
const APP_URL = optional("APP_URL", "http://localhost:3000").replace(/\/$/, "");
/** อ่านก่อนสร้าง env เพราะค่าตั้งต้นบางตัว (เพดานของ log store) ต่างกันระหว่าง production กับที่อื่น */
const NODE_ENV = optional("NODE_ENV", "development");
const MONGODB_URI = optional("MONGODB_URI", "");

/**
 * LOG_READ_TOKEN ที่ใช้ได้จริง — ดู `logStore.readToken` ข้างล่าง
 *
 * production: ค่าตัวอย่าง (`dev-…`, `…change-me`) หรือสั้นกว่า 32 ตัว (128 บิตเมื่อเป็นฐานสิบหก — fingerprint 12 ตัวที่ลง
 * `AUDIT_LOG_READ.metadata.token_fp` เดาย้อนกลับได้ถ้า token สั้น) ถือเป็น**ไม่ได้ตั้ง** API อ่าน log จึงปิด (503) แทนที่จะเปิด
 * ด้วยค่าที่ใครก็รู้ ต่างจาก ADMIN_API_TOKEN ที่แค่เตือน: token นี้ใหม่ ไม่มีใครพึ่งมันอยู่ ปฏิเสธจึงไม่ทำให้อะไรที่ใช้งาน
 * อยู่พัง ไม่พิมพ์ค่าหรือความยาว
 */
function logReadToken(): string {
  return productionSecret(
    "LOG_READ_TOKEN",
    "dev-log-token-change-me",
    "ปิด API อ่าน log (/api/admin/logs ตอบ 503 log_access_disabled)",
  );
}

/**
 * ความลับที่ dev มีค่าตัวอย่าง แต่ production ไม่รับค่าตัวอย่าง (`dev-…`, `…change-me`) หรือค่าที่สั้นกว่า 32 ตัว — ถือเป็น
 * **ไม่ได้ตั้ง** พร้อมคำเตือนตอนบูตที่บอกผล (`effect`) ไม่พิมพ์ค่าหรือความยาว ไม่ throw: สิ่งที่ความลับนี้เปิดแค่ปิดไป
 */
function productionSecret(name: string, devValue: string, effect: string): string {
  const value = optional(name, NODE_ENV === "production" ? "" : devValue);
  if (NODE_ENV !== "production" || value === "") return value;
  if (value.length < 32 || value.startsWith("dev-") || value.includes("change-me")) {
    console.warn(
      `[env] ${name} ยังเป็นค่าตัวอย่างหรือสั้นกว่า 32 ตัว — ${effect} จนกว่าจะตั้งเป็นค่าจาก \`openssl rand -hex 32\``,
    );
    return "";
  }
  return value;
}

export const env = {
  nodeEnv: NODE_ENV,
  /**
   * รุ่นของโค้ดที่รันอยู่ — SHA ของ commit ที่ build image นี้ (`GIT_SHA` → `ENV RELEASE` ใน backend/Dockerfile)
   * ติดไปกับทุก error event และ `GET /` เพื่อบอกได้ว่า error เกิดกับรุ่นไหน และ issue ที่ปิดไปแล้วกลับมาในรุ่นไหน
   * dev (tsx จาก source) ไม่ได้ build image จึงเป็น `dev` · **อย่าใส่ใน environment ของ compose**: ค่าว่างจาก `${…:-}`
   * จะทับค่าที่ image ฝังไว้แล้ว optional() อ่านเป็นไม่ได้ตั้ง กลายเป็น `dev` บน production
   */
  release: optional("RELEASE", "dev"),
  /** ชื่อ deployment ที่ error เกิด (ค่าตั้งต้นใน compose คือ COMPOSE_PROJECT_NAME เช่น `bdi-main`) — แยก checkout ออกจากกัน */
  deployEnv: optional("DEPLOY_ENV", NODE_ENV),
  port: Number(optional("PORT", "4000")),
  /**
   * รับได้หลาย origin คั่นด้วย comma เพราะตอนเปิดสู่สาธารณะยังต้องเข้าจาก
   * localhost ได้ด้วย เช่น "https://bdi.thammasorn.org,http://localhost:3001"
   */
  corsOrigins: optional("CORS_ORIGIN", "http://localhost:3000")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),
  /** ใช้สร้างลิงก์ในอีเมล ต้องเป็น URL ที่ผู้รับเปิดจากเครื่องตัวเองได้ */
  appUrl: APP_URL,

  databaseUrl: required("DATABASE_URL"),

  auth: {
    /**
     * อายุสูงสุดของ session นับจากตอนออก — ต่ออายุไม่ได้ ครบแล้วต้องเข้าสู่ระบบใหม่
     * (ไม่มี JWT_SECRET แล้ว: session ไม่ใช่ JWT อีกต่อไป สถานะจริงอยู่ในตาราง iam.session)
     */
    sessionTtlDays: Number(optional("SESSION_TTL_DAYS", "7")),
    /**
     * ไม่ได้ใช้งานนานเท่านี้แล้ว session ตาย แม้ยังไม่ถึง absolute expiry
     * ตัดสินไว้ 2026-08-16: absolute 7 วัน + idle 8 ชั่วโมง — เครื่องที่เปิดค้างข้ามคืน
     * ต้องเข้าสู่ระบบใหม่ ทั้งสองค่าตั้งผ่าน env ได้เพื่อให้เจ้าของสเปกปรับได้เองภายหลัง
     */
    sessionIdleHours: Number(optional("SESSION_IDLE_HOURS", "8")),
    invitationTtlDays: Number(optional("INVITATION_TTL_DAYS", "7")),
    otpTtlMinutes: Number(optional("OTP_TTL_MINUTES", "10")),
    otpMaxAttempts: Number(optional("OTP_MAX_ATTEMPTS", "5")),
    /** shared secret สำหรับ API ฝั่ง admin ที่สเปกระบุว่ายังไม่มี UI */
    adminApiToken: required("ADMIN_API_TOKEN"),
    /**
     * fingerprint (`tokenFingerprint()`) ของ token ผู้ดูแลระบบที่ปลดไปแล้ว ว่างได้ — การปฏิเสธที่ตรง
     * รายการนี้ได้แถว `ADMIN_TOKEN_REJECTED` ของตัวเองเสมอ (lib/token-rejection.ts) คนที่ยังถือค่าเก่า
     * อยู่จึงไม่หายไปในแถวสรุป วิธีคำนวณ fingerprint อยู่ใน docs/09 §4.1
     */
    adminTokenWatchFps: fingerprintList("ADMIN_TOKEN_WATCH_FPS"),
    /**
     * server_secret ของ activation key
     * sheet `activation_key` กำหนดว่า key_hash = HMAC-SHA-256(server_secret, raw_activation_key)
     * ต่างจาก invitation เดิมที่ใช้ SHA-256 เปล่า — HMAC ทำให้ hash ในฐานข้อมูลใช้ไม่ได้เลย
     * ถ้าไม่มี secret ฝั่ง server
     * ค่า default มีไว้ให้ dev เท่านั้น ที่ production ต้องตั้งจริง
     */
    activationKeySecret: requiredInProduction(
      "ACTIVATION_KEY_SECRET",
      "dev-activation-key-secret",
    ),
    activationKeyTtlDays: Number(optional("ACTIVATION_KEY_TTL_DAYS", "7")),
    /**
     * อายุลิงก์ตั้งรหัสผ่านใหม่ที่ผู้ดูแลระบบสั่งออก — สั้นกว่าคำเชิญมาก (นาที ไม่ใช่วัน)
     * เพราะแอดมินเพิ่งคุยกับเจ้าตัวอยู่ กดไม่ทันก็ขอใหม่ได้ทันที ลิงก์ที่ค้างอยู่ในกล่อง
     * จดหมายเป็นวัน ๆ มีแต่โอกาสถูกคนอื่นใช้ (hash ด้วย activationKeySecret ตัวเดียวกัน)
     */
    passwordResetTtlMinutes: Number(optional("PASSWORD_RESET_TTL_MINUTES", "60")),
    /**
     * ตั้ง Secure ให้ session cookie โดยอัตโนมัติเมื่อ APP_URL เป็น https
     * (เบราว์เซอร์ทิ้ง cookie ที่มี Secure ถ้าเชื่อมต่อผ่าน http ธรรมดา
     * จึงเปิดตายตัวไม่ได้ ต้องดูจากที่อยู่จริงที่ผู้ใช้เข้า)
     */
    cookieSecure:
      optional("COOKIE_SECURE", optional("APP_URL", "").startsWith("https://") ? "true" : "false") ===
      "true",
  },

  /**
   * ThaID (DOPA IdP) — OAuth 2.0 authorization code flow
   *
   * ทุกค่าอ่านจาก environment เพราะ sandbox กับของจริงคนละ host คนละ client และ
   * redirect_uri ต้อง "ตรงตัวอักษร" กับที่ลงทะเบียนไว้กับกรมการปกครอง ไม่งั้นได้
   * invalid_request ตั้งแต่ขั้น authorize (ทดลองแล้วเป็นแบบนั้นจริง)
   *
   * scope ตั้งต้นรวม `pid` เพราะทั้ง flow ตั้งอยู่บนการเทียบเลขประจำตัวประชาชน
   * ถ้า client ที่ใช้ยังไม่ได้รับสิทธิ์ scope นี้ กรมการปกครองจะตอบ invalid_scope
   * ตั้งแต่ขั้น authorize — แก้ที่การลงทะเบียน ไม่ใช่ที่โค้ด
   */
  thaid: {
    rootUrl: optional("THAID_ROOT_URL", "https://imauthsbx.bora.dopa.go.th").replace(/\/$/, ""),
    clientId: optional("THAID_CLIENT_ID", ""),
    clientSecret: optional("THAID_CLIENT_SECRET", ""),
    /** บาง environment ของ BORA ต้องแนบ api key มาด้วย ปล่อยว่างได้ถ้าไม่ต้อง */
    apiKey: optional("THAID_API_KEY", ""),
    redirectUri: optional("THAID_REDIRECT_URI", `${APP_URL}/auth/callback/thaid`),
    /**
     * scope ที่ขอจากกรมการปกครอง — ตั้งไว้เท่าที่ระบบใช้จริง
     *
     * เดิมขอกว้างกว่านี้ (`title` `middle_name` `name` `name_en` ด้วย) แต่รายการที่
     * ตกลงกันไว้ตามการ์ด Enhance คือหกตัวนี้ ผลที่ตามมาคือ **ไม่ได้ claim `title`**
     * ฟอร์มสร้างบัญชีจึงเติมชื่อกับนามสกุลให้ ส่วนคำนำหน้าผู้ใช้เลือกเอง
     * (`toIdentity()` ยังอ่าน claim เหล่านั้นอยู่ ถ้าวันหนึ่งกรมการปกครองส่งมาให้
     * โดยไม่ต้องขอ ก็ได้ค่าเพิ่มมาฟรี ไม่ต้องแก้โค้ด)
     */
    scope: optional(
      "THAID_SCOPE",
      "openid pid given_name family_name given_name_en family_name_en",
    ),
    /**
     * เลขบัตรที่เอาไปเทียบกับ `user_account.cid` มาจาก claim ไหนของ id_token
     *
     *   true  (ค่าตั้งต้น) — claim `pid` ตามคู่มือ §6.2.2 ต้องได้ scope `pid` มาด้วย
     *   false — claim `sub`
     *
     * มีให้เลือกเพราะกรมการปกครองยังไม่อนุมัติ scope `pid` ให้ client ของโครงการ
     * (ขอ scope ที่มี `pid` แล้วได้ 400 invalid_scope ตั้งแต่ขั้น authorize ทดสอบซ้ำ
     * 2026-08-16 ยังเหมือนเดิม) แต่ `sub` ที่ได้กลับมาเป็นเลขบัตร 13 หลักตรง ๆ
     * ทั้งกับ client ตัวอย่างของ sandbox และ client ของโครงการ จึงเทียบตาม §2.4 ได้
     * โดยไม่ต้องรอ scope `pid`
     *
     * **การเทียบเลขบัตรทำเสมอไม่ว่าตั้งค่าไหน** ตัวแปรนี้เลือกแค่ "ที่มาของเลข"
     * ไม่ใช่สวิตช์ปิดการตรวจ และถ้าค่าที่ได้มาไม่ใช่เลขบัตรที่ถูกต้อง (เช่น IdP ออก `sub`
     * เป็นค่าทึบ) ระบบจะปฏิเสธการยืนยันไปเลย ไม่ใช่เทียบแล้วบอกว่า "ไม่ตรง" —
     * เพราะนั่นจะยกเลิกคีย์ของคนที่ไม่ได้ทำอะไรผิด ดู `lib/thaid.ts` toIdentity()
     */
    usePid: optional("THAID_USE_PID", "true") === "true",
    /**
     * บังคับให้ id_token ต้องมี claim `nonce` หรือไม่
     *
     * ระบบส่ง `nonce` ไปกับ authorization request เสมอ และ **nonce ที่ไม่ตรงถูกปฏิเสธเสมอ**
     * ไม่ว่าตั้งค่านี้ไว้อย่างไร ตัวแปรนี้ตัดสินเฉพาะกรณี "ไม่มี claim กลับมาเลย" ซึ่งแปลว่า
     * กรมการปกครองไม่ได้สะท้อน nonce กลับมา — ยังไม่ได้ยืนยันว่าเขาทำหรือไม่ทำ ค่าตั้งต้น
     * จึงเป็น false (เตือนใน log แล้วไปต่อ) เปิดเป็น true เมื่อเห็นจากการยิงจริงแล้วว่ามีมา
     */
    requireNonce: optional("THAID_REQUIRE_NONCE", "false") === "true",
    /** อายุของ state ที่ค้างรอ callback — ยาวพอให้เปิดแอป ThaID บนมือถือแล้วกลับมา */
    stateTtlMinutes: Number(optional("THAID_STATE_TTL_MINUTES", "15")),
    /** ยืนยันตัวตนแล้วมีเวลาเท่านี้ในการตั้งรหัสผ่านให้จบ ก่อนต้องยืนยันใหม่ */
    verificationTtlMinutes: Number(optional("THAID_VERIFICATION_TTL_MINUTES", "30")),
  },

  /**
   * Azure Blob Storage — ที่เก็บไฟล์แนบทั้งหมด (แทน MinIO เดิม ตามการ์ด "Migrate to Azure")
   *
   * ต่อได้สองทาง และต้องมีอย่างน้อยหนึ่งทาง ไม่งั้น backend ไม่ยอมบูต:
   *
   *   AZURE_STORAGE_CONNECTION_STRING — connection string เต็ม ๆ ใช้ได้ทั้งกับ
   *     storage account จริงและกับ Azurite (emulator ที่รันใน compose ตอน dev)
   *     ทางนี้ถือ account key ไว้ในมือ จึงเหมาะกับเครื่อง dev มากกว่า production
   *
   *   AZURE_STORAGE_ACCOUNT_URL — เช่น https://bdidatahub.blob.core.windows.net
   *     ไม่มีความลับใน env เลย ตัวตนมาจาก DefaultAzureCredential ซึ่งบน Azure
   *     คือ managed identity ของ Container App/VM ที่รันอยู่ นี่คือทางที่ควรใช้จริง
   *     ตอนขึ้น production เพราะไม่ต้องหมุน key และเพิกถอนสิทธิ์ได้จาก Azure เอง
   *
   * ตั้งมาทั้งคู่ = connection string ชนะ (ตั้งใจให้ทับได้เวลาไล่ปัญหาในเครื่อง)
   *
   * ชื่อ container ต้องเป็นตัวพิมพ์เล็ก ตัวเลข และขีดกลาง ยาว 3–63 ตัวอักษร ตามกติกาของ
   * Azure — ไม่เหมือน bucket ของ MinIO ที่ปล่อยผ่านมากกว่านี้ ค่าเดิม `bdi-uploads`
   * ผ่านกติกาใหม่พอดี คอลัมน์ attachment.storage_bucket ที่เก็บชื่อไว้จึงไม่ต้อง backfill
   */
  azure: {
    connectionString: optional("AZURE_STORAGE_CONNECTION_STRING", ""),
    accountUrl: optional("AZURE_STORAGE_ACCOUNT_URL", "").replace(/\/$/, ""),
    container: optional("AZURE_STORAGE_CONTAINER", "bdi-uploads"),
  },

  /**
   * ตัวแปลง .docx -> PDF (gotenberg ที่ห่อ LibreOffice) — บริการแยกใน compose
   *
   * เอกสารกฎหมาย A0–A3 เป็น template .docx ที่ BDI แก้เองได้ เลย์เอาต์จึงต้องมาจาก
   * LibreOffice ที่จัดหน้าจากไฟล์ต้นฉบับ ไม่ใช่โค้ดที่วาดทับตามพิกัด
   *
   * ไม่มี fallback: ถ้าบริการนี้ไม่ขึ้น การสร้างเอกสารจะตอบ 503 พร้อมบอกว่าเพราะอะไร
   * ดีกว่าปล่อยไฟล์ที่เลย์เอาต์เพี้ยนออกไปให้หน่วยงานลงนาม
   */
  gotenberg: {
    url: optional("GOTENBERG_URL", "http://gotenberg:3000").replace(/\/$/, ""),
    /** LibreOffice เย็น ๆ ครั้งแรกใช้เวลาหลายวินาที เอกสาร A2 ยาวหกหน้า */
    timeoutMs: Number(optional("GOTENBERG_TIMEOUT_MS", "60000")),
  },

  smtp: {
    host: optional("SMTP_HOST", "smtp.gmail.com"),
    port: Number(optional("SMTP_PORT", "587")),
    secure: optional("SMTP_SECURE", "false") === "true",
    user: optional("SMTP_USER", ""),
    pass: optional("SMTP_PASS", ""),
    from: optional("SMTP_FROM", "ระบบกลางเพื่อการแบ่งปันข้อมูลดิจิทัล <no-reply@bdi.or.th>"),
    /**
     * ที่อยู่ที่ผู้รับจะได้เมื่อกด reply (feedback 2026-09-23 แถว 2)
     *
     * ต้องมีบนของจริง เพราะกล่องที่ระบบใช้ส่ง (`SMTP_USER`) ไม่มีคนอ่าน และ Exchange
     * เขียน From ทับด้วยกล่องที่ล็อกอินเมื่อบัญชีไม่มีสิทธิ์ send-as — `SMTP_FROM` ที่
     * เขียนว่า no-reply@ จึงไม่รับประกันว่าคำตอบจะไปถูกที่ ส่วน Reply-To ไม่ถูกเขียนทับ
     * และไคลเอนต์ทุกตัวเคารพมันเหนือ From
     *
     * **ไม่มีค่าตั้งต้นในโค้ดโดยตั้งใจ** (ตัดสิน 2026-09-23) — ต่างจาก `SUPPORT_EMAIL`
     * ที่ตั้งต้นเป็นของจริงไว้ ไม่ตั้งตัวแปรนี้ = ไม่ส่งหัวข้อ Reply-To ออกไปเลย ซึ่งเป็น
     * พฤติกรรมเดิมก่อนการ์ดใบนี้ ที่อยู่ที่รับคำตอบเป็นเรื่องของกล่องจดหมายจริงในแต่ละ
     * deployment ไม่ใช่ค่าที่โค้ดควรเดาให้ — `.env.example` บอกค่าที่ของจริงต้องใช้
     */
    replyTo: optional("SMTP_REPLY_TO", ""),
    /** ไม่ตั้ง SMTP_USER = พิมพ์อีเมลลง log แทนการส่งจริง (สะดวกตอน dev) */
    enabled: Boolean(optional("SMTP_USER", "")),
  },
  /**
   * ช่องทางติดต่อที่พิมพ์อยู่ท้ายอีเมลทุกฉบับ
   *
   * อีเมลมาจากการ์ด "แก้เนื้อหา invitation email" เบอร์โทรมาจากการ์ด "ในอีเมล์ที่ส่งไปให้
   * ผู้ใช้ต่าง ๆ ช่วยเพิ่มเบอร์ให้ด้วย" — 02-480-8833 คือเบอร์กลางของ BDI
   *
   * ทั้งคู่มีค่าตั้งต้นเป็นของจริงตรงนี้ ไม่ได้รอค่าจาก .env เพราะ deploy ที่ลืมตั้งไม่ควร
   * ส่งอีเมลที่ไม่มีทางติดต่อกลับออกไป ทับด้วย SUPPORT_EMAIL / SUPPORT_PHONE ได้ แล้ว
   * รีสตาร์ต backend กับ delivery-worker ก็ขึ้นทันที ไม่ต้อง build ใหม่ (ทั้งสอง service
   * ประกอบอีเมลเอง จึงต้องได้ตัวแปรครบทั้งคู่) โค้ดที่รองรับเบอร์ว่างยังอยู่ เผื่อวันที่เบอร์เลิกใช้
   */
  support: {
    email: optional("SUPPORT_EMAIL", "d2share-support@bdi.or.th"),
    phone: optional("SUPPORT_PHONE", "02-480-8833"),
  },

  /**
   * log store — MongoDB ที่เก็บสำเนาค้นหาได้ของ audit.audit_event และ error ของระบบ (lib/log-store.ts, docs/21)
   *
   * **ใช้ `optional()` เท่านั้น ห้าม `required()` / `requiredInProduction()`** — log store เป็นของเสริม และไฟล์นี้
   * ถูก import โดย backend, delivery-worker, seed ทุกตัว และ job seed บน ACA ตัวแปรที่ขาดตัวเดียวต้องไม่ทำให้
   * process ไหนบูตไม่ขึ้น ขาดแล้วผลคือ log store ปิด (`disabled`) เท่านั้น
   */
  logStore: {
    /**
     * สวิตช์ปิดคือ `LOG_STORE_ENABLED=false` — ปิดแล้วไม่โหลด driver ของ Mongo เลย ใช้ได้ทั้งตอน Mongo มีปัญหา
     * และบน Azure ที่ยังไม่ได้เลือกบริการ ต้องมี URI ด้วยถึงจะเปิด: URI ว่างก็ถือว่าปิด ไม่ใช่ error
     */
    enabled: optional("LOG_STORE_ENABLED", "true") === "true" && MONGODB_URI !== "",
    /** มีรหัสผ่านอยู่ข้างใน — ห้ามพิมพ์ลง log (lib/log-store.ts พิมพ์ได้แค่ชื่อฐานข้อมูล) */
    uri: MONGODB_URI,
    db: optional("MONGODB_DB", "bdi_logs"),
    /**
     * เพดานขนาดของ log store (MB ที่ข้อมูลกับ index ใช้อยู่จริงจาก dbStats — ไม่นับพื้นที่ว่างที่ WiredTiger จองไว้
     * ใช้ซ้ำหลังลบ ซึ่งคืนให้ดิสก์ได้ด้วย `compact` เท่านั้น บริการที่ไม่บอกพื้นที่ว่างเทียบขนาดที่จองไว้แทน) มีเพดานเพราะ
     * /hdd1tb ที่ Mongo อยู่คือดิสก์เดียวกับ Postgres ของ production แต่มันคุมไบต์ที่ใช้อยู่ ไม่ใช่ขนาดบนดิสก์: พื้นที่ว่าง
     * ของ collection หนึ่งไม่ถูกอีก collection ใช้ ขนาดบนดิสก์จึงเกินค่านี้ได้ (`checkQuota` ใน workers/log-upkeep.ts)
     * · 5 GB บน production 512 MB ที่อื่น · บน managed Mongo โควตาของบริการเป็นตัวคุมอีกชั้น
     *
     * worker เทียบค่านี้ทุกชั่วโมงและตอนบูต (workers/log-upkeep.ts) เกินแล้วตั้งธง `overQuota` ใน relay_state ซึ่ง
     * backend กับ worker อ่านเป็นสถานะ `over_quota` (lib/log-store.ts) และระหว่างนั้นเก็บแค่ตัวนับของ issue
     * ธงลงเมื่อขนาดต่ำกว่า 90% ของเพดาน
     */
    maxMb: positiveNumber("LOG_STORE_MAX_MB", NODE_ENV === "production" ? 5120 : 512),
    /**
     * กุญแจ HMAC ของ key ค้นหาในสำเนากิจกรรม — `cid#…` / `email#…` ใน `activity.hashKeys` (lib/activity-shape.ts) ที่ทำให้
     * การค้นด้วยเลขบัตรหรืออีเมล (`x-log-cid` `x-log-email`) หาแถวเจอโดยไม่ต้องเก็บเลขบัตรหรืออีเมลที่พิมพ์มาไว้ตรง ๆ ใช้ทั้ง backend (สำเนาของแถวที่ Postgres
     * ไม่รับ) และ delivery-worker (relay) ต้องเป็นค่าเดียวกัน
     *
     * ไม่ตั้ง → ปิดค่าอย่างเดียว `hashKeys` ว่าง บรรทัดเตือนตอนบูต (lib/log-store.ts) และ `x-log-cid` / `x-log-email` ตอบ 503
     * `hash_search_unavailable` — ไม่ทำให้ process ไหนบูตไม่ขึ้น dev มีค่าตั้งต้น production ไม่มี: กุญแจที่อยู่ในซอร์สคือ
     * กุญแจที่ทุกคนรู้ และเลขบัตรมีแค่ 10¹³ ค่า ใครได้ hashKeys ไปก็ไล่ย้อนหาเลขบัตรได้ทั้งหมด
     * **เปลี่ยนค่าแล้วต้อง rebuild สำเนา** — key เดิมหาด้วยกุญแจใหม่ไม่เจอ (workers/log-relay.ts เตือนเมื่อเห็นว่าเปลี่ยน)
     */
    hashKey: optional("LOG_HASH_KEY", NODE_ENV === "production" ? "" : "dev-log-hash-key"),
    /**
     * ความลับของ API อ่าน log (`x-log-token` ของ `/api/admin/logs/*` — routes/admin-logs.ts) แยกจาก ADMIN_API_TOKEN
     * โดยตั้งใจ (plan decision 9): log รวมทุกอย่างที่ admin API เห็นบวกประวัติการกระทำของทุกคน และ admin token เคยหลุดมาแล้ว
     * คนถือ admin token จึงไม่ได้สิทธิ์อ่าน log ไปด้วย
     *
     * ว่าง = API ตอบ 503 `log_access_disabled` ทุกคำขอ (ไม่เปิดให้ใครอ่าน และไม่ทำให้บูตไม่ขึ้น) · dev มีค่าตัวอย่าง
     * `dev-log-token-change-me` (ตรงกับ `.env.example` และ Postman environment ของ dev checkout) · **production ไม่รับค่า
     * ตัวอย่างและค่าที่สั้นกว่า 32 ตัว** — ถือเป็นว่างพร้อมคำเตือนตอนบูต (`logReadToken()`) เพราะคนที่คัดลอก `.env.example`
     * ไปเป็น `.env` ของ main/ จะได้ token ที่เขียนอยู่ใน repo สาธารณะ ค่าจริงคือ `openssl rand -hex 32`
     */
    readToken: logReadToken(),
    /**
     * ความลับที่ Next server แนบมากับรายงาน error ของตัวเอง (`x-report-token` ของ `POST /api/client-errors` —
     * routes/client-errors.ts) รายงานที่ token ตรงถูกเก็บเป็น `service: "frontend-server"` ที่เหลือทุกตัวเป็น `browser`
     * `ingest.verified: false` — backend เรียกได้ตรงไม่ผ่านหน้าเว็บ header อย่างเดียวจึงพิสูจน์อะไรไม่ได้ ต้องเป็นค่าเดียวกับ
     * `INGEST_SERVER_TOKEN` ของ frontend · ว่าง (หรือค่าตัวอย่างบน production) = ไม่มีรายงานไหนได้เป็น frontend-server
     * ไม่กระทบอย่างอื่น
     */
    /**
     * ผู้รับอีเมลสรุป error (workers/error-alerts.ts — delivery-worker เท่านั้น) คั่นด้วย comma **ว่าง = ปิดการแจ้งเตือน**
     * ทั้งหมด (issue ยังถูกเก็บตามปกติ) ค่าที่ไม่ใช่อีเมลถูกข้ามพร้อมคำเตือนตอนบูต ไม่ throw — ผู้รับพิมพ์ผิดคนเดียวต้องไม่ทำให้
     * worker บูตไม่ขึ้นแล้วอีเมลทั้งระบบหยุดตาม
     */
    alertEmails: emailList("ERROR_ALERT_EMAILS"),
    ingestToken: productionSecret(
      "INGEST_SERVER_TOKEN",
      "dev-ingest-token-change-me",
      "รายงาน error จาก Next server ถูกเก็บเป็นของเบราว์เซอร์ที่ยืนยันไม่ได้ (ingest.verified: false)",
    ),
  },
} as const;

/**
 * ต้องมีทางต่อ Azure Blob Storage อย่างน้อยหนึ่งทาง
 *
 * เช็คที่นี่เพื่อให้ล้มตั้งแต่บูตพร้อมข้อความที่บอกได้ว่าต้องตั้งตัวแปรอะไร — ดีกว่าปล่อย
 * ให้บูตผ่านแล้วไปล้มตอนมีคนอัปโหลดไฟล์แรก ด้วย stack trace จากข้างใน SDK ที่อ่านไม่ออก
 * (ตัวแปรเดิม MINIO_ROOT_USER/MINIO_ROOT_PASSWORD ก็บังคับด้วย required() แบบเดียวกัน
 * ทุก process ที่ import env.ts จึงต้องได้ค่านี้ รวมถึง delivery-worker ที่ไม่ได้แตะไฟล์เลย)
 */
if (!env.azure.connectionString && !env.azure.accountUrl) {
  throw new Error(
    "Missing Azure Blob Storage configuration: set AZURE_STORAGE_CONNECTION_STRING " +
      "(account key, or the Azurite emulator in compose) or AZURE_STORAGE_ACCOUNT_URL " +
      "(managed identity via DefaultAzureCredential)",
  );
}
