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

/** อ่านก่อนสร้าง env เพราะ redirect_uri ของ ThaiD ตั้งต้นจากค่านี้ */
const APP_URL = optional("APP_URL", "http://localhost:3000").replace(/\/$/, "");

export const env = {
  nodeEnv: optional("NODE_ENV", "development"),
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
     * ตั้ง Secure ให้ session cookie โดยอัตโนมัติเมื่อ APP_URL เป็น https
     * (เบราว์เซอร์ทิ้ง cookie ที่มี Secure ถ้าเชื่อมต่อผ่าน http ธรรมดา
     * จึงเปิดตายตัวไม่ได้ ต้องดูจากที่อยู่จริงที่ผู้ใช้เข้า)
     */
    cookieSecure:
      optional("COOKIE_SECURE", optional("APP_URL", "").startsWith("https://") ? "true" : "false") ===
      "true",
  },

  /**
   * ThaiD (DOPA IdP) — OAuth 2.0 authorization code flow
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
    /** อายุของ state ที่ค้างรอ callback — ยาวพอให้เปิดแอป ThaiD บนมือถือแล้วกลับมา */
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
    from: optional("SMTP_FROM", "BDI Datahub <no-reply@bdi.or.th>"),
    /** ไม่ตั้ง SMTP_USER = พิมพ์อีเมลลง log แทนการส่งจริง (สะดวกตอน dev) */
    enabled: Boolean(optional("SMTP_USER", "")),
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
