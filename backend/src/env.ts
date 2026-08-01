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

  databaseUrl: required("DATABASE_URL"),

  minio: {
    endPoint: optional("MINIO_ENDPOINT", "minio"),
    port: Number(optional("MINIO_PORT", "9000")),
    useSSL: optional("MINIO_USE_SSL", "false") === "true",
    accessKey: required("MINIO_ROOT_USER"),
    secretKey: required("MINIO_ROOT_PASSWORD"),
    bucket: optional("MINIO_BUCKET", "bdi-uploads"),
  },
} as const;
