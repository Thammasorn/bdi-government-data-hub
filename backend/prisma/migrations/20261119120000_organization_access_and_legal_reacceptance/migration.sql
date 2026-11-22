-- การ์ด "[Enhance] Legal Document Management"
--
-- 1. organization.access_status — ค่าเริ่มต้น ACTIVE ทุกหน่วยงาน จึงไม่มีผลจนกว่า BDI จะเผยแพร่ version ที่ requires_reacceptance
-- 2. legal_document_version.display_version_number — backfill จากเลขระบบก่อน แล้วจึงบังคับ NOT NULL
-- 3. organization_legal_approval — งานลงนามต่อหน่วยงานต่อเอกสาร ไม่ backfill (เกิดเมื่อเผยแพร่ version ใหม่ครั้งแรกหลังปล่อย)
-- 4. review.SubjectType เพิ่ม ORGANIZATION_LEGAL_APPROVAL

CREATE TYPE "organization"."OrganizationAccessStatus" AS ENUM ('ACTIVE', 'LEGAL_DOCS_UPDATE_REQUIRED');

ALTER TABLE "organization"."organization"
  ADD COLUMN "access_status" "organization"."OrganizationAccessStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "access_status_changed_at" TIMESTAMPTZ(6);

ALTER TABLE "legal"."legal_document_version" ADD COLUMN "display_version_number" VARCHAR(64);
UPDATE "legal"."legal_document_version" SET "display_version_number" = "version_number"::text;
ALTER TABLE "legal"."legal_document_version" ALTER COLUMN "display_version_number" SET NOT NULL;

CREATE TYPE "legal"."OrganizationLegalApprovalStatus" AS ENUM (
  'PENDING_ORG_APPROVAL', 'PENDING_BDI_APPROVAL', 'ACTIVE', 'SUPERSEDED', 'CANCELLED'
);

CREATE TABLE "legal"."organization_legal_approval" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "legal_document_id" UUID NOT NULL,
    "legal_document_version_id" UUID NOT NULL,
    "previous_version_id" UUID,
    "status" "legal"."OrganizationLegalApprovalStatus" NOT NULL DEFAULT 'PENDING_ORG_APPROVAL',
    "requested_by_user_id" UUID,
    "org_approval_review_task_id" UUID,
    "bdi_approval_review_task_id" UUID,
    "activated_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "organization_legal_approval_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "organization_legal_approval_organization_id_status_idx"
  ON "legal"."organization_legal_approval"("organization_id", "status");
CREATE INDEX "organization_legal_approval_status_idx"
  ON "legal"."organization_legal_approval"("status");

ALTER TABLE "legal"."organization_legal_approval"
  ADD CONSTRAINT "organization_legal_approval_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organization"."organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "organization_legal_approval_legal_document_id_fkey"
    FOREIGN KEY ("legal_document_id") REFERENCES "legal"."legal_document"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "organization_legal_approval_legal_document_version_id_fkey"
    FOREIGN KEY ("legal_document_version_id") REFERENCES "legal"."legal_document_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "organization_legal_approval_previous_version_id_fkey"
    FOREIGN KEY ("previous_version_id") REFERENCES "legal"."legal_document_version"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "organization_legal_approval_requested_by_user_id_fkey"
    FOREIGN KEY ("requested_by_user_id") REFERENCES "iam"."user_account"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "organization_legal_approval_org_approval_review_task_id_fkey"
    FOREIGN KEY ("org_approval_review_task_id") REFERENCES "review"."review_task"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "organization_legal_approval_bdi_approval_review_task_id_fkey"
    FOREIGN KEY ("bdi_approval_review_task_id") REFERENCES "review"."review_task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Prisma เขียน partial index ไม่ได้ — สองตัวนี้อยู่ที่นี่ที่เดียว
-- งานค้างของเอกสารเดียวกันต่อหน่วยงานมีได้หนึ่งงาน (publish ซ้ำหรือกดพร้อมกันจะชนที่นี่ ไม่สร้างงานซ้ำ)
CREATE UNIQUE INDEX "uq_open_organization_legal_approval"
  ON "legal"."organization_legal_approval" ("organization_id", "legal_document_id")
  WHERE "status" IN ('PENDING_ORG_APPROVAL', 'PENDING_BDI_APPROVAL');

-- version ที่ใช้อยู่ต่อเอกสารต่อหน่วยงานมีได้ฉบับเดียว
CREATE UNIQUE INDEX "uq_active_organization_legal_approval"
  ON "legal"."organization_legal_approval" ("organization_id", "legal_document_id")
  WHERE "status" = 'ACTIVE';

ALTER TYPE "review"."SubjectType" ADD VALUE 'ORGANIZATION_LEGAL_APPROVAL';
