-- CreateEnum
CREATE TYPE "iam"."SessionRevokeReason" AS ENUM ('LOGOUT', 'LOGOUT_ALL', 'PASSWORD_CHANGED', 'ACCOUNT_SUSPENDED', 'ROTATED', 'EXPIRED');

-- AlterTable
ALTER TABLE "integration"."integration_operation" ADD COLUMN     "request_nonce" VARCHAR(255);

-- CreateTable
CREATE TABLE "iam"."session" (
    "id" UUID NOT NULL,
    "user_account_id" UUID NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "issued_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(6),
    "revoked_reason" "iam"."SessionRevokeReason",
    "user_agent" TEXT,
    "ip_address" VARCHAR(64),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "session_token_hash_key" ON "iam"."session"("token_hash");

-- CreateIndex
CREATE INDEX "session_user_account_id_revoked_at_idx" ON "iam"."session"("user_account_id", "revoked_at");

-- CreateIndex
CREATE INDEX "session_expires_at_idx" ON "iam"."session"("expires_at");

-- AddForeignKey
ALTER TABLE "iam"."session" ADD CONSTRAINT "session_user_account_id_fkey" FOREIGN KEY ("user_account_id") REFERENCES "iam"."user_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
