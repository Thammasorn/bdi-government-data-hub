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
    jwtSecret: required("JWT_SECRET"),
    sessionTtlDays: Number(optional("SESSION_TTL_DAYS", "7")),
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
    /**
     * ข้ามการเรียก ThaiD จริงแล้วสมมติว่า "เลขบัตรตรง" — สำหรับ deployment ที่ยังไม่มี
     * client credentials เท่านั้น ต้องเป็น false ทุกที่ที่ไม่ใช่เครื่อง dev
     * มิฉะนั้นการยืนยันตัวตนทั้งขั้นตอนกลายเป็นแค่การกดปุ่ม
     */
    mock: optional("THAID_MOCK", "false") === "true",
    rootUrl: optional("THAID_ROOT_URL", "https://imauthsbx.bora.dopa.go.th").replace(/\/$/, ""),
    clientId: optional("THAID_CLIENT_ID", ""),
    clientSecret: optional("THAID_CLIENT_SECRET", ""),
    /** บาง environment ของ BORA ต้องแนบ api key มาด้วย ปล่อยว่างได้ถ้าไม่ต้อง */
    apiKey: optional("THAID_API_KEY", ""),
    redirectUri: optional("THAID_REDIRECT_URI", `${APP_URL}/auth/callback/thaid`),
    scope: optional(
      "THAID_SCOPE",
      "openid pid title given_name middle_name family_name name given_name_en family_name_en name_en",
    ),
    /** อายุของ state ที่ค้างรอ callback — ยาวพอให้เปิดแอป ThaiD บนมือถือแล้วกลับมา */
    stateTtlMinutes: Number(optional("THAID_STATE_TTL_MINUTES", "15")),
    /** ยืนยันตัวตนแล้วมีเวลาเท่านี้ในการตั้งรหัสผ่านให้จบ ก่อนต้องยืนยันใหม่ */
    verificationTtlMinutes: Number(optional("THAID_VERIFICATION_TTL_MINUTES", "30")),
  },

  minio: {
    endPoint: optional("MINIO_ENDPOINT", "minio"),
    port: Number(optional("MINIO_PORT", "9000")),
    useSSL: optional("MINIO_USE_SSL", "false") === "true",
    accessKey: required("MINIO_ROOT_USER"),
    secretKey: required("MINIO_ROOT_PASSWORD"),
    bucket: optional("MINIO_BUCKET", "bdi-uploads"),
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
