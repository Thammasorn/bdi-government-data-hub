import { Client } from "minio";

import { env } from "./env.js";

export const minio = new Client({
  endPoint: env.minio.endPoint,
  port: env.minio.port,
  useSSL: env.minio.useSSL,
  accessKey: env.minio.accessKey,
  secretKey: env.minio.secretKey,
});

export const BUCKET = env.minio.bucket;

/**
 * Creates the app bucket if it is missing. The `minio-init` compose service
 * normally does this first; this keeps the backend usable outside compose.
 */
export async function ensureBucket(): Promise<void> {
  if (!(await minio.bucketExists(BUCKET))) {
    await minio.makeBucket(BUCKET);
  }
}

export async function pingStorage(): Promise<void> {
  const exists = await minio.bucketExists(BUCKET);
  if (!exists) {
    throw new Error(`Bucket "${BUCKET}" does not exist`);
  }
}
