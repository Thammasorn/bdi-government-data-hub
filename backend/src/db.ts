import { PrismaClient } from "@prisma/client";

import { env } from "./env.js";

export const prisma = new PrismaClient({
  log: env.nodeEnv === "development" ? ["warn", "error"] : ["error"],
});

/** Cheap round-trip that works even before any models exist. */
export async function pingDatabase(): Promise<void> {
  await prisma.$queryRaw`SELECT 1`;
}
