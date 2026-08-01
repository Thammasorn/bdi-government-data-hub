/** Fail fast at boot rather than at first use with a confusing stack trace. */
function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export const env = {
  nodeEnv: optional("NODE_ENV", "development"),
  port: Number(optional("PORT", "4000")),
  corsOrigin: optional("CORS_ORIGIN", "http://localhost:3000"),
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
