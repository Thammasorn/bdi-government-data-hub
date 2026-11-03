-- AlterTable
ALTER TABLE "iam"."activation_key" ADD COLUMN     "reminded_at" TIMESTAMPTZ(6);

-- CreateTable
CREATE TABLE "administration"."system_setting" (
    "key" VARCHAR(64) NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "system_setting_pkey" PRIMARY KEY ("key")
);
