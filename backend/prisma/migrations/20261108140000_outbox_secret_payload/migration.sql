-- AlterTable
ALTER TABLE "notification"."notification_delivery" ADD COLUMN     "secret_expires_at" TIMESTAMPTZ(6),
ADD COLUMN     "secret_payload" TEXT;
