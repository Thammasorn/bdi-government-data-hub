-- CreateEnum
CREATE TYPE "administration"."EmailTemplateVersionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'SUPERSEDED');

-- CreateTable
CREATE TABLE "administration"."email_template_version" (
    "id" UUID NOT NULL,
    "template_key" VARCHAR(64) NOT NULL,
    "version_number" INTEGER NOT NULL,
    "status" "administration"."EmailTemplateVersionStatus" NOT NULL,
    "subject" TEXT NOT NULL,
    "body_html" TEXT NOT NULL,
    "button_label" TEXT,
    "footnote_html" TEXT,
    "restored_from_version" INTEGER,
    "restore_reason" TEXT,
    "published_at" TIMESTAMPTZ(6),
    "published_by" UUID,
    "publish_reason" TEXT,
    "superseded_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "email_template_version_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "email_template_version_template_key_status_idx" ON "administration"."email_template_version"("template_key", "status");

-- CreateIndex
CREATE INDEX "email_template_version_template_key_published_at_idx" ON "administration"."email_template_version"("template_key", "published_at");

-- CreateIndex
CREATE UNIQUE INDEX "email_template_version_template_key_version_number_key" ON "administration"."email_template_version"("template_key", "version_number");

-- เพิ่มมือ: แต่ละเทมเพลตมีฉบับที่ใช้งานอยู่ได้หนึ่งฉบับ และฉบับร่างได้หนึ่งฉบับ — การเผยแพร่หรือบันทึกพร้อมกันสองคนชนกันที่นี่แทนการได้สองฉบับ
CREATE UNIQUE INDEX "uq_email_template_published" ON "administration"."email_template_version"("template_key") WHERE "status" = 'PUBLISHED';
CREATE UNIQUE INDEX "uq_email_template_draft" ON "administration"."email_template_version"("template_key") WHERE "status" = 'DRAFT';
