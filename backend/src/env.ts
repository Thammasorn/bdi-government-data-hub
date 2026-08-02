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
  appUrl: optional("APP_URL", "http://localhost:3000"),

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
     * ยังไม่มี client credentials ของ ThaiD จริง เปิดตัวนี้เพื่อให้ทดลอง flow ได้
     * ต้องเป็น false บน production มิฉะนั้นข้ามการยืนยันตัวตนได้ทั้งหมด
     */
    thaidMock: optional("THAID_MOCK", "false") === "true",
    /**
     * ตั้ง Secure ให้ session cookie โดยอัตโนมัติเมื่อ APP_URL เป็น https
     * (เบราว์เซอร์ทิ้ง cookie ที่มี Secure ถ้าเชื่อมต่อผ่าน http ธรรมดา
     * จึงเปิดตายตัวไม่ได้ ต้องดูจากที่อยู่จริงที่ผู้ใช้เข้า)
     */
    cookieSecure:
      optional("COOKIE_SECURE", optional("APP_URL", "").startsWith("https://") ? "true" : "false") ===
      "true",
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
