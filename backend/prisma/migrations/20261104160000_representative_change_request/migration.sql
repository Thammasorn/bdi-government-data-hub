-- CreateEnum
CREATE TYPE "organization"."RepresentativeChangeStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'RETURNED', 'CONFIRMED', 'PROCESSING', 'COMPLETED', 'PROCESSING_FAILED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "organization"."RepresentativeRemovalStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "organization"."RepresentativeAdditionStatus" AS ENUM ('PENDING', 'PROCESSING', 'INVITED', 'FAILED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "attachment"."AttachmentOwnerType" ADD VALUE 'REPRESENTATIVE_CHANGE_REQUEST';

-- AlterEnum
ALTER TYPE "attachment"."AttachmentType" ADD VALUE 'REPRESENTATIVE_CHANGE_REQUEST_LETTER';

-- AlterEnum
ALTER TYPE "review"."SubjectType" ADD VALUE 'REPRESENTATIVE_CHANGE_REQUEST';

-- CreateTable
CREATE TABLE "organization"."representative_change_request" (
    "id" UUID NOT NULL,
    "request_number" VARCHAR(64) NOT NULL,
    "organization_id" UUID NOT NULL,
    "status" "organization"."RepresentativeChangeStatus" NOT NULL DEFAULT 'DRAFT',
    "additional_detail_json" JSONB,
    "submitted_at" TIMESTAMPTZ(6),
    "confirmed_at" TIMESTAMPTZ(6),
    "confirmed_by" UUID,
    "rejected_at" TIMESTAMPTZ(6),
    "rejected_by" UUID,
    "cancelled_at" TIMESTAMPTZ(6),
    "cancelled_by" UUID,
    "cancellation_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "representative_change_request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization"."representative_change_removal" (
    "id" UUID NOT NULL,
    "change_request_id" UUID NOT NULL,
    "user_role_assignment_id" UUID,
    "activation_key_id" UUID,
    "status" "organization"."RepresentativeRemovalStatus" NOT NULL DEFAULT 'PENDING',
    "deactivated_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "representative_change_removal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization"."representative_change_addition" (
    "id" UUID NOT NULL,
    "change_request_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "status" "organization"."RepresentativeAdditionStatus" NOT NULL DEFAULT 'PENDING',
    "activation_key_id" UUID,
    "user_cid" VARCHAR(13),
    "user_prefix_th" VARCHAR(64),
    "user_firstname_th" VARCHAR(255),
    "user_lastname_th" VARCHAR(255),
    "user_email" VARCHAR(255),
    "user_phone_number" VARCHAR(32),
    "user_phone_number_extension" VARCHAR(16),
    "user_department_th" VARCHAR(255),
    "user_position_th" VARCHAR(255),
    "additional_detail_json" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "representative_change_addition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "representative_change_request_request_number_key" ON "organization"."representative_change_request"("request_number");

-- CreateIndex
CREATE INDEX "representative_change_request_organization_id_status_idx" ON "organization"."representative_change_request"("organization_id", "status");

-- CreateIndex
CREATE INDEX "representative_change_request_status_idx" ON "organization"."representative_change_request"("status");

-- CreateIndex
CREATE INDEX "representative_change_removal_change_request_id_idx" ON "organization"."representative_change_removal"("change_request_id");

-- CreateIndex
CREATE INDEX "representative_change_removal_user_role_assignment_id_idx" ON "organization"."representative_change_removal"("user_role_assignment_id");

-- CreateIndex
CREATE INDEX "representative_change_removal_activation_key_id_idx" ON "organization"."representative_change_removal"("activation_key_id");

-- CreateIndex
CREATE INDEX "representative_change_addition_change_request_id_idx" ON "organization"."representative_change_addition"("change_request_id");

-- CreateIndex
CREATE INDEX "representative_change_addition_activation_key_id_idx" ON "organization"."representative_change_addition"("activation_key_id");

-- CreateIndex
CREATE INDEX "representative_change_addition_user_cid_idx" ON "organization"."representative_change_addition"("user_cid");

-- AddForeignKey
ALTER TABLE "organization"."representative_change_request" ADD CONSTRAINT "representative_change_request_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"."organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization"."representative_change_removal" ADD CONSTRAINT "representative_change_removal_change_request_id_fkey" FOREIGN KEY ("change_request_id") REFERENCES "organization"."representative_change_request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization"."representative_change_removal" ADD CONSTRAINT "representative_change_removal_user_role_assignment_id_fkey" FOREIGN KEY ("user_role_assignment_id") REFERENCES "iam"."user_role_assignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization"."representative_change_removal" ADD CONSTRAINT "representative_change_removal_activation_key_id_fkey" FOREIGN KEY ("activation_key_id") REFERENCES "iam"."activation_key"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization"."representative_change_addition" ADD CONSTRAINT "representative_change_addition_change_request_id_fkey" FOREIGN KEY ("change_request_id") REFERENCES "organization"."representative_change_request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization"."representative_change_addition" ADD CONSTRAINT "representative_change_addition_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "iam"."role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization"."representative_change_addition" ADD CONSTRAINT "representative_change_addition_activation_key_id_fkey" FOREIGN KEY ("activation_key_id") REFERENCES "iam"."activation_key"("id") ON DELETE SET NULL ON UPDATE CASCADE;

