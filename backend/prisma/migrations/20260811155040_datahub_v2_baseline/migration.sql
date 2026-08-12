-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "administration";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "attachment";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "audit";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "dataset";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "iam";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "integration";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "legal";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "notification";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "organization";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "review";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "signature";

-- CreateEnum
CREATE TYPE "iam"."AccountType" AS ENUM ('ORGANIZATION', 'BDI', 'SYSTEM');

-- CreateEnum
CREATE TYPE "iam"."UserAccountStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "iam"."ActivationKeyStatus" AS ENUM ('ISSUED', 'USED', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "iam"."RoleAssignmentStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- CreateEnum
CREATE TYPE "iam"."OtpPurpose" AS ENUM ('REGISTRATION', 'LOGIN');

-- CreateEnum
CREATE TYPE "organization"."OrganizationStatus" AS ENUM ('PENDING_REGISTRATION', 'ACTIVE', 'SUSPENDED', 'INACTIVE');

-- CreateEnum
CREATE TYPE "review"."SubjectType" AS ENUM ('ORGANIZATION_REGISTRATION_REQUEST', 'DATASET_REGISTRATION_REQUEST', 'DATASET_REQUEST');

-- CreateEnum
CREATE TYPE "review"."RequestStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'RETURNED', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "review"."ReviewTaskType" AS ENUM ('BDI_OFFICER_REVIEW', 'DATASET_SPECIALIST_REVIEW', 'ORGANIZATION_APPROVAL', 'BDI_FINAL_APPROVAL', 'ORGANIZATION_REVISION');

-- CreateEnum
CREATE TYPE "review"."AssignmentSource" AS ENUM ('SYSTEM', 'MANUAL', 'JIRA');

-- CreateEnum
CREATE TYPE "review"."ReviewTaskStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'REASSIGNED');

-- CreateEnum
CREATE TYPE "review"."ReviewResult" AS ENUM ('PASSED', 'APPROVED', 'RETURNED', 'REJECTED', 'CONFIRMED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "review"."CommentVisibility" AS ENUM ('ORGANIZATION', 'BDI_INTERNAL', 'ALL');

-- CreateEnum
CREATE TYPE "attachment"."AttachmentOwnerType" AS ENUM ('ORGANIZATION_REGISTRATION_REQUEST', 'DATASET_REGISTRATION_REQUEST', 'DATASET_REQUEST', 'LEGAL_DOCUMENT_VERSION', 'DATASET');

-- CreateEnum
CREATE TYPE "attachment"."AttachmentType" AS ENUM ('AUTHORIZED_REPRESENTATIVE_APPOINTMENT_ORDER', 'POWER_OF_ATTORNEY', 'DATA_DICTIONARY', 'EXAMPLE_DATA', 'GENERATED_FORM', 'LEGAL_DOCUMENT');

-- CreateEnum
CREATE TYPE "attachment"."AttachmentStatus" AS ENUM ('ACTIVE', 'REPLACED', 'DELETED');

-- CreateEnum
CREATE TYPE "attachment"."ScanStatus" AS ENUM ('PENDING', 'CLEAN', 'REJECTED', 'QUARANTINED');

-- CreateEnum
CREATE TYPE "dataset"."DatasetStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "legal"."LegalDocumentStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');

-- CreateEnum
CREATE TYPE "legal"."LegalDocumentVersionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'SUPERSEDED', 'RETIRED');

-- CreateEnum
CREATE TYPE "legal"."AcceptanceMethod" AS ENUM ('CHECKBOX', 'BUTTON');

-- CreateEnum
CREATE TYPE "signature"."ConfirmationType" AS ENUM ('ORGANIZATION_APPROVAL', 'BDI_FINAL_APPROVAL');

-- CreateEnum
CREATE TYPE "audit"."AuditActorType" AS ENUM ('USER', 'SYSTEM', 'EXTERNAL', 'ANONYMOUS');

-- CreateEnum
CREATE TYPE "audit"."AuditResult" AS ENUM ('SUCCESS', 'FAILURE');

-- CreateEnum
CREATE TYPE "notification"."NotificationStatus" AS ENUM ('UNREAD', 'READ', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "notification"."DeliveryChannel" AS ENUM ('EMAIL', 'SMS', 'LINE', 'WEBHOOK');

-- CreateEnum
CREATE TYPE "notification"."DeliveryStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'DELIVERED', 'FAILED', 'DEAD_LETTER', 'CANCELLED');

-- CreateEnum
CREATE TYPE "integration"."IntegrationType" AS ENUM ('THAID', 'JIRA', 'DII');

-- CreateEnum
CREATE TYPE "integration"."IntegrationStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'DEAD_LETTER', 'CANCELLED');

-- CreateTable
CREATE TABLE "iam"."user_account" (
    "id" UUID NOT NULL,
    "cid" VARCHAR(13),
    "prefix_th" VARCHAR(64),
    "firstname_th" VARCHAR(255),
    "lastname_th" VARCHAR(255),
    "email" VARCHAR(255) NOT NULL,
    "phone_number" VARCHAR(32),
    "department_th" VARCHAR(255),
    "position_th" VARCHAR(255),
    "display_name" VARCHAR(255) NOT NULL,
    "account_type" "iam"."AccountType" NOT NULL,
    "status" "iam"."UserAccountStatus" NOT NULL DEFAULT 'PENDING',
    "last_login_at" TIMESTAMPTZ(6),
    "activated_at" TIMESTAMPTZ(6),
    "suspended_at" TIMESTAMPTZ(6),
    "suspended_by" UUID,
    "suspension_reason" TEXT,
    "deactivated_at" TIMESTAMPTZ(6),
    "external_subject" VARCHAR(255),
    "password_hash" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "user_account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "iam"."role" (
    "id" UUID NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "name_th" VARCHAR(255) NOT NULL,
    "name_en" VARCHAR(255) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "iam"."activation_key" (
    "id" UUID NOT NULL,
    "user_account_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "key_hash" VARCHAR(255) NOT NULL,
    "status" "iam"."ActivationKeyStatus" NOT NULL DEFAULT 'ISSUED',
    "issued_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "revoked_by" UUID,
    "revoked_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "activation_key_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "iam"."user_role_assignment" (
    "id" UUID NOT NULL,
    "user_account_id" UUID NOT NULL,
    "organization_id" UUID,
    "role_id" UUID NOT NULL,
    "effective_from" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effective_until" TIMESTAMPTZ(6),
    "status" "iam"."RoleAssignmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "revoked_by" UUID,
    "revoked_at" TIMESTAMPTZ(6),
    "revocation_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "user_role_assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "iam"."otp_code" (
    "id" UUID NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "code_hash" TEXT NOT NULL,
    "purpose" "iam"."OtpPurpose" NOT NULL DEFAULT 'REGISTRATION',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_code_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization"."organization" (
    "id" UUID NOT NULL,
    "parent_organization_id" UUID,
    "organization_code" VARCHAR(64) NOT NULL,
    "organization_type" VARCHAR(64),
    "name_th" VARCHAR(255) NOT NULL,
    "name_en" VARCHAR(255),
    "status" "organization"."OrganizationStatus" NOT NULL DEFAULT 'PENDING_REGISTRATION',
    "address_line" VARCHAR(500),
    "sub_district_code" VARCHAR(16),
    "district_code" VARCHAR(16),
    "province_code" VARCHAR(16),
    "postal_code" VARCHAR(16),
    "phone" VARCHAR(32),
    "email" VARCHAR(255),
    "website_url" VARCHAR(500),
    "activated_at" TIMESTAMPTZ(6),
    "activated_by" UUID,
    "suspended_at" TIMESTAMPTZ(6),
    "suspended_by" UUID,
    "suspension_reason" TEXT,
    "deactivated_at" TIMESTAMPTZ(6),
    "deactivated_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review"."review_task" (
    "id" UUID NOT NULL,
    "subject_type" "review"."SubjectType" NOT NULL,
    "subject_id" UUID NOT NULL,
    "task_type" "review"."ReviewTaskType" NOT NULL,
    "sequence_number" INTEGER NOT NULL,
    "round_number" INTEGER NOT NULL DEFAULT 1,
    "assigned_user_id" UUID NOT NULL,
    "assigned_role" VARCHAR(64) NOT NULL,
    "assigned_by" UUID,
    "assignment_source" "review"."AssignmentSource" NOT NULL,
    "status" "review"."ReviewTaskStatus" NOT NULL DEFAULT 'PENDING',
    "result" "review"."ReviewResult",
    "result_comment" TEXT,
    "result_detail_json" JSONB,
    "comment_visibility" "review"."CommentVisibility",
    "reassigned_from_action_id" UUID,
    "assigned_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "due_at" TIMESTAMPTZ(6),
    "cancelled_at" TIMESTAMPTZ(6),
    "cancelled_by" UUID,
    "cancellation_reason" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "review_task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization"."organization_registration_request" (
    "id" UUID NOT NULL,
    "request_number" VARCHAR(64) NOT NULL,
    "organization_id" UUID NOT NULL,
    "status" "review"."RequestStatus" NOT NULL DEFAULT 'DRAFT',
    "organization_code" VARCHAR(64),
    "organization_type" VARCHAR(64),
    "organization_name_th" VARCHAR(255),
    "organization_name_en" VARCHAR(255),
    "organization_address_line" VARCHAR(500),
    "organization_subdistrict_code" VARCHAR(16),
    "organization_district_code" VARCHAR(16),
    "organization_province_code" VARCHAR(16),
    "organization_postal_code" VARCHAR(16),
    "organization_phone" VARCHAR(32),
    "organization_email" VARCHAR(255),
    "organization_website" VARCHAR(500),
    "approver_cid" VARCHAR(13),
    "approver_prefix_th" VARCHAR(64),
    "approver_firstname_th" VARCHAR(255),
    "approver_lastname_th" VARCHAR(255),
    "approver_email" VARCHAR(255),
    "approver_phone_number" VARCHAR(32),
    "approver_department_th" VARCHAR(255),
    "approver_position_th" VARCHAR(255),
    "user_cid" VARCHAR(13),
    "user_prefix_th" VARCHAR(64),
    "user_firstname_th" VARCHAR(255),
    "user_lastname_th" VARCHAR(255),
    "user_email" VARCHAR(255),
    "user_phone_number" VARCHAR(32),
    "user_department_th" VARCHAR(255),
    "user_position_th" VARCHAR(255),
    "additional_detail_json" JSONB,
    "authorized_representative_appointment_attachment_id" UUID,
    "power_of_attorney_attachment_id" UUID,
    "submitted_at" TIMESTAMPTZ(6),
    "approved_at" TIMESTAMPTZ(6),
    "rejected_at" TIMESTAMPTZ(6),
    "cancelled_at" TIMESTAMPTZ(6),
    "cancelled_by" UUID,
    "cancellation_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "organization_registration_request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachment"."attachment" (
    "id" UUID NOT NULL,
    "owner_type" "attachment"."AttachmentOwnerType" NOT NULL,
    "owner_id" UUID NOT NULL,
    "attachment_type" "attachment"."AttachmentType" NOT NULL,
    "original_file_name" VARCHAR(500) NOT NULL,
    "storage_bucket" VARCHAR(128) NOT NULL,
    "storage_key" VARCHAR(1024) NOT NULL,
    "mime_type" VARCHAR(255) NOT NULL,
    "file_extension" VARCHAR(32),
    "file_size_bytes" BIGINT NOT NULL,
    "content_hash" VARCHAR(128) NOT NULL,
    "status" "attachment"."AttachmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "replaced_attachment_id" UUID,
    "scan_status" "attachment"."ScanStatus" NOT NULL DEFAULT 'PENDING',
    "scan_completed_at" TIMESTAMPTZ(6),
    "scan_result_detail" JSONB,
    "uploaded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploaded_by" UUID NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_by" UUID,
    "deletion_reason" TEXT,

    CONSTRAINT "attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dataset"."dataset_registration_request" (
    "id" UUID NOT NULL,
    "request_number" VARCHAR(64) NOT NULL,
    "organization_id" UUID NOT NULL,
    "status" "review"."RequestStatus" NOT NULL DEFAULT 'DRAFT',
    "proposed_title" VARCHAR(500),
    "data_dictionary_attachment_id" UUID,
    "example_data_attachment_id" UUID,
    "additional_detail_json" JSONB,
    "created_dataset_id" UUID,
    "submitted_at" TIMESTAMPTZ(6),
    "approved_at" TIMESTAMPTZ(6),
    "rejected_at" TIMESTAMPTZ(6),
    "cancelled_at" TIMESTAMPTZ(6),
    "cancelled_by" UUID,
    "cancellation_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "dataset_registration_request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dataset"."dataset_registration_metadata" (
    "id" UUID NOT NULL,
    "dataset_registration_request_id" UUID NOT NULL,
    "title_th" VARCHAR(500),
    "title_en" VARCHAR(500),
    "description_th" TEXT,
    "description_en" TEXT,
    "objective" TEXT,
    "dataset_category_code" VARCHAR(64),
    "data_owner_department" VARCHAR(255),
    "contact_name" VARCHAR(255),
    "contact_email" VARCHAR(255),
    "contact_phone" VARCHAR(32),
    "update_frequency" VARCHAR(64),
    "coverage_start_date" DATE,
    "coverage_end_date" DATE,
    "geographic_scope" VARCHAR(64),
    "contains_personal_data" BOOLEAN,
    "contains_sensitive_data" BOOLEAN,
    "access_level" VARCHAR(64),
    "delivery_method" VARCHAR(64),
    "data_format" VARCHAR(64),
    "additional_metadata_json" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "dataset_registration_metadata_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dataset"."dataset" (
    "id" UUID NOT NULL,
    "dataset_code" VARCHAR(64) NOT NULL,
    "organization_id" UUID NOT NULL,
    "status" "dataset"."DatasetStatus" NOT NULL DEFAULT 'ACTIVE',
    "data_dictionary_attachment_id" UUID,
    "example_data_attachment_id" UUID,
    "additional_detail_json" JSONB,
    "source_dataset_registration_request_id" UUID NOT NULL,
    "activated_at" TIMESTAMPTZ(6),
    "activated_by" UUID,
    "deactivated_at" TIMESTAMPTZ(6),
    "deactivated_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "dataset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dataset"."dataset_metadata" (
    "id" UUID NOT NULL,
    "dataset_id" UUID NOT NULL,
    "title_th" VARCHAR(500),
    "title_en" VARCHAR(500),
    "description_th" TEXT,
    "description_en" TEXT,
    "objective" TEXT,
    "dataset_category_code" VARCHAR(64),
    "data_owner_department" VARCHAR(255),
    "contact_name" VARCHAR(255),
    "contact_email" VARCHAR(255),
    "contact_phone" VARCHAR(32),
    "update_frequency" VARCHAR(64),
    "coverage_start_date" DATE,
    "coverage_end_date" DATE,
    "geographic_scope" VARCHAR(64),
    "contains_personal_data" BOOLEAN,
    "contains_sensitive_data" BOOLEAN,
    "access_level" VARCHAR(64),
    "delivery_method" VARCHAR(64),
    "data_format" VARCHAR(64),
    "additional_metadata_json" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "dataset_metadata_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legal"."legal_document" (
    "id" UUID NOT NULL,
    "document_type" VARCHAR(64) NOT NULL,
    "document_code" VARCHAR(16) NOT NULL,
    "name_th" VARCHAR(500) NOT NULL,
    "name_en" VARCHAR(500),
    "application_scope" VARCHAR(64) NOT NULL,
    "display_order" INTEGER NOT NULL,
    "is_required" BOOLEAN NOT NULL DEFAULT true,
    "requires_signature_confirmation" BOOLEAN NOT NULL DEFAULT false,
    "status" "legal"."LegalDocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,

    CONSTRAINT "legal_document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legal"."legal_document_version" (
    "id" UUID NOT NULL,
    "legal_document_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "attachment_id" UUID NOT NULL,
    "content_hash" VARCHAR(128) NOT NULL,
    "status" "legal"."LegalDocumentVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "requires_reacceptance" BOOLEAN NOT NULL DEFAULT false,
    "effective_at" TIMESTAMPTZ(6),
    "published_at" TIMESTAMPTZ(6),
    "published_by" UUID,
    "superseded_at" TIMESTAMPTZ(6),
    "retired_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,

    CONSTRAINT "legal_document_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legal"."legal_acceptance" (
    "id" UUID NOT NULL,
    "legal_document_version_id" UUID NOT NULL,
    "user_account_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "subject_type" "review"."SubjectType" NOT NULL,
    "subject_id" UUID NOT NULL,
    "review_task_id" UUID NOT NULL,
    "signature_confirmation_id" UUID,
    "acceptance_method" "legal"."AcceptanceMethod" NOT NULL,
    "accepted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip_address" VARCHAR(64),
    "user_agent" TEXT,
    "acceptance_context_json" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,

    CONSTRAINT "legal_acceptance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "signature"."signature_confirmation" (
    "id" UUID NOT NULL,
    "review_task_id" UUID NOT NULL,
    "subject_type" "review"."SubjectType" NOT NULL,
    "subject_id" UUID NOT NULL,
    "user_account_id" UUID NOT NULL,
    "organization_id" UUID,
    "confirmation_type" "signature"."ConfirmationType" NOT NULL,
    "confirmation_text" TEXT NOT NULL,
    "confirmation_payload_json" JSONB,
    "payload_hash" VARCHAR(128),
    "confirmed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip_address" VARCHAR(64),
    "user_agent" TEXT,
    "confirmation_context_json" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,

    CONSTRAINT "signature_confirmation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit"."audit_event" (
    "id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_type" "audit"."AuditActorType" NOT NULL,
    "actor_id" UUID,
    "action" VARCHAR(128) NOT NULL,
    "subject_type" VARCHAR(64) NOT NULL,
    "subject_id" UUID,
    "organization_id" UUID,
    "result" "audit"."AuditResult" NOT NULL,
    "before_summary_json" JSONB,
    "after_summary_json" JSONB,
    "ip_address" VARCHAR(64),
    "user_agent" TEXT,
    "correlation_id" VARCHAR(64) NOT NULL,
    "source_component" VARCHAR(64) NOT NULL,
    "metadata_json" JSONB,

    CONSTRAINT "audit_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification"."notification" (
    "id" UUID NOT NULL,
    "recipient_user_id" UUID NOT NULL,
    "notification_type" VARCHAR(64) NOT NULL,
    "title" VARCHAR(500) NOT NULL,
    "message" TEXT NOT NULL,
    "subject_type" VARCHAR(64),
    "subject_id" UUID,
    "organization_id" UUID,
    "status" "notification"."NotificationStatus" NOT NULL DEFAULT 'UNREAD',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "read_at" TIMESTAMPTZ(6),
    "archived_at" TIMESTAMPTZ(6),
    "correlation_id" UUID NOT NULL,

    CONSTRAINT "notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification"."notification_delivery" (
    "id" UUID NOT NULL,
    "notification_id" UUID NOT NULL,
    "channel" "notification"."DeliveryChannel" NOT NULL,
    "destination" VARCHAR(500) NOT NULL,
    "status" "notification"."DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "scheduled_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processing_at" TIMESTAMPTZ(6),
    "sent_at" TIMESTAMPTZ(6),
    "delivered_at" TIMESTAMPTZ(6),
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "next_retry_at" TIMESTAMPTZ(6),
    "last_attempt_at" TIMESTAMPTZ(6),
    "provider" VARCHAR(64),
    "provider_reference" VARCHAR(255),
    "last_error_code" VARCHAR(64),
    "last_error_message" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "correlation_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "notification_delivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration"."integration_operation" (
    "id" UUID NOT NULL,
    "integration_type" "integration"."IntegrationType" NOT NULL,
    "operation" VARCHAR(64) NOT NULL,
    "subject_type" VARCHAR(64) NOT NULL,
    "subject_id" UUID NOT NULL,
    "organization_id" UUID,
    "idempotency_key" VARCHAR(255) NOT NULL,
    "status" "integration"."IntegrationStatus" NOT NULL DEFAULT 'PENDING',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "scheduled_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processing_at" TIMESTAMPTZ(6),
    "next_retry_at" TIMESTAMPTZ(6),
    "last_attempt_at" TIMESTAMPTZ(6),
    "external_reference" VARCHAR(255),
    "last_error_code" VARCHAR(64),
    "last_error_message" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "completed_at" TIMESTAMPTZ(6),
    "correlation_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "integration_operation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "administration"."province" (
    "code" VARCHAR(16) NOT NULL,
    "name_th" VARCHAR(255) NOT NULL,
    "name_en" VARCHAR(255),

    CONSTRAINT "province_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "administration"."district" (
    "code" VARCHAR(16) NOT NULL,
    "name_th" VARCHAR(255) NOT NULL,
    "name_en" VARCHAR(255),
    "province_code" VARCHAR(16) NOT NULL,

    CONSTRAINT "district_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "administration"."sub_district" (
    "code" VARCHAR(16) NOT NULL,
    "name_th" VARCHAR(255) NOT NULL,
    "name_en" VARCHAR(255),
    "district_code" VARCHAR(16) NOT NULL,
    "postal_code" VARCHAR(16),

    CONSTRAINT "sub_district_pkey" PRIMARY KEY ("code")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_account_email_key" ON "iam"."user_account"("email");

-- CreateIndex
CREATE UNIQUE INDEX "user_account_external_subject_key" ON "iam"."user_account"("external_subject");

-- CreateIndex
CREATE INDEX "user_account_status_idx" ON "iam"."user_account"("status");

-- CreateIndex
CREATE INDEX "user_account_account_type_idx" ON "iam"."user_account"("account_type");

-- CreateIndex
CREATE INDEX "user_account_cid_idx" ON "iam"."user_account"("cid");

-- CreateIndex
CREATE UNIQUE INDEX "role_code_key" ON "iam"."role"("code");

-- CreateIndex
CREATE INDEX "activation_key_key_hash_idx" ON "iam"."activation_key"("key_hash");

-- CreateIndex
CREATE INDEX "activation_key_user_account_id_organization_id_role_id_idx" ON "iam"."activation_key"("user_account_id", "organization_id", "role_id");

-- CreateIndex
CREATE INDEX "user_role_assignment_user_account_id_status_idx" ON "iam"."user_role_assignment"("user_account_id", "status");

-- CreateIndex
CREATE INDEX "user_role_assignment_organization_id_role_id_status_idx" ON "iam"."user_role_assignment"("organization_id", "role_id", "status");

-- CreateIndex
CREATE INDEX "otp_code_email_purpose_idx" ON "iam"."otp_code"("email", "purpose");

-- CreateIndex
CREATE UNIQUE INDEX "organization_organization_code_key" ON "organization"."organization"("organization_code");

-- CreateIndex
CREATE INDEX "organization_status_idx" ON "organization"."organization"("status");

-- CreateIndex
CREATE INDEX "organization_province_code_idx" ON "organization"."organization"("province_code");

-- CreateIndex
CREATE INDEX "review_task_subject_type_subject_id_sequence_number_idx" ON "review"."review_task"("subject_type", "subject_id", "sequence_number");

-- CreateIndex
CREATE INDEX "review_task_assigned_user_id_status_idx" ON "review"."review_task"("assigned_user_id", "status");

-- CreateIndex
CREATE INDEX "review_task_status_task_type_idx" ON "review"."review_task"("status", "task_type");

-- CreateIndex
CREATE UNIQUE INDEX "organization_registration_request_request_number_key" ON "organization"."organization_registration_request"("request_number");

-- CreateIndex
CREATE INDEX "organization_registration_request_organization_id_status_idx" ON "organization"."organization_registration_request"("organization_id", "status");

-- CreateIndex
CREATE INDEX "organization_registration_request_status_idx" ON "organization"."organization_registration_request"("status");

-- CreateIndex
CREATE UNIQUE INDEX "attachment_replaced_attachment_id_key" ON "attachment"."attachment"("replaced_attachment_id");

-- CreateIndex
CREATE INDEX "attachment_owner_type_owner_id_attachment_type_idx" ON "attachment"."attachment"("owner_type", "owner_id", "attachment_type");

-- CreateIndex
CREATE INDEX "attachment_content_hash_idx" ON "attachment"."attachment"("content_hash");

-- CreateIndex
CREATE UNIQUE INDEX "dataset_registration_request_request_number_key" ON "dataset"."dataset_registration_request"("request_number");

-- CreateIndex
CREATE UNIQUE INDEX "dataset_registration_request_created_dataset_id_key" ON "dataset"."dataset_registration_request"("created_dataset_id");

-- CreateIndex
CREATE INDEX "dataset_registration_request_organization_id_status_idx" ON "dataset"."dataset_registration_request"("organization_id", "status");

-- CreateIndex
CREATE INDEX "dataset_registration_request_status_idx" ON "dataset"."dataset_registration_request"("status");

-- CreateIndex
CREATE UNIQUE INDEX "dataset_registration_metadata_dataset_registration_request__key" ON "dataset"."dataset_registration_metadata"("dataset_registration_request_id");

-- CreateIndex
CREATE UNIQUE INDEX "dataset_dataset_code_key" ON "dataset"."dataset"("dataset_code");

-- CreateIndex
CREATE INDEX "dataset_organization_id_status_idx" ON "dataset"."dataset"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "dataset_metadata_dataset_id_key" ON "dataset"."dataset_metadata"("dataset_id");

-- CreateIndex
CREATE UNIQUE INDEX "legal_document_document_code_key" ON "legal"."legal_document"("document_code");

-- CreateIndex
CREATE INDEX "legal_document_application_scope_status_display_order_idx" ON "legal"."legal_document"("application_scope", "status", "display_order");

-- CreateIndex
CREATE INDEX "legal_document_version_status_idx" ON "legal"."legal_document_version"("status");

-- CreateIndex
CREATE UNIQUE INDEX "legal_document_version_legal_document_id_version_number_key" ON "legal"."legal_document_version"("legal_document_id", "version_number");

-- CreateIndex
CREATE INDEX "legal_acceptance_organization_id_legal_document_version_id_idx" ON "legal"."legal_acceptance"("organization_id", "legal_document_version_id");

-- CreateIndex
CREATE INDEX "legal_acceptance_subject_type_subject_id_idx" ON "legal"."legal_acceptance"("subject_type", "subject_id");

-- CreateIndex
CREATE INDEX "legal_acceptance_review_task_id_accepted_at_idx" ON "legal"."legal_acceptance"("review_task_id", "accepted_at");

-- CreateIndex
CREATE INDEX "signature_confirmation_subject_type_subject_id_idx" ON "signature"."signature_confirmation"("subject_type", "subject_id");

-- CreateIndex
CREATE INDEX "signature_confirmation_user_account_id_confirmed_at_idx" ON "signature"."signature_confirmation"("user_account_id", "confirmed_at");

-- CreateIndex
CREATE INDEX "audit_event_subject_type_subject_id_occurred_at_idx" ON "audit"."audit_event"("subject_type", "subject_id", "occurred_at");

-- CreateIndex
CREATE INDEX "audit_event_actor_id_occurred_at_idx" ON "audit"."audit_event"("actor_id", "occurred_at");

-- CreateIndex
CREATE INDEX "audit_event_correlation_id_idx" ON "audit"."audit_event"("correlation_id");

-- CreateIndex
CREATE INDEX "notification_recipient_user_id_status_idx" ON "notification"."notification"("recipient_user_id", "status");

-- CreateIndex
CREATE INDEX "notification_recipient_user_id_created_at_idx" ON "notification"."notification"("recipient_user_id", "created_at");

-- CreateIndex
CREATE INDEX "notification_delivery_status_scheduled_at_idx" ON "notification"."notification_delivery"("status", "scheduled_at");

-- CreateIndex
CREATE INDEX "notification_delivery_notification_id_idx" ON "notification"."notification_delivery"("notification_id");

-- CreateIndex
CREATE UNIQUE INDEX "integration_operation_idempotency_key_key" ON "integration"."integration_operation"("idempotency_key");

-- CreateIndex
CREATE INDEX "integration_operation_status_scheduled_at_idx" ON "integration"."integration_operation"("status", "scheduled_at");

-- CreateIndex
CREATE INDEX "integration_operation_subject_type_subject_id_idx" ON "integration"."integration_operation"("subject_type", "subject_id");

-- CreateIndex
CREATE INDEX "district_province_code_idx" ON "administration"."district"("province_code");

-- CreateIndex
CREATE INDEX "sub_district_district_code_idx" ON "administration"."sub_district"("district_code");

-- AddForeignKey
ALTER TABLE "iam"."activation_key" ADD CONSTRAINT "activation_key_user_account_id_fkey" FOREIGN KEY ("user_account_id") REFERENCES "iam"."user_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "iam"."activation_key" ADD CONSTRAINT "activation_key_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"."organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "iam"."activation_key" ADD CONSTRAINT "activation_key_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "iam"."role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "iam"."user_role_assignment" ADD CONSTRAINT "user_role_assignment_user_account_id_fkey" FOREIGN KEY ("user_account_id") REFERENCES "iam"."user_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "iam"."user_role_assignment" ADD CONSTRAINT "user_role_assignment_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"."organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "iam"."user_role_assignment" ADD CONSTRAINT "user_role_assignment_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "iam"."role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization"."organization" ADD CONSTRAINT "organization_parent_organization_id_fkey" FOREIGN KEY ("parent_organization_id") REFERENCES "organization"."organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review"."review_task" ADD CONSTRAINT "review_task_assigned_user_id_fkey" FOREIGN KEY ("assigned_user_id") REFERENCES "iam"."user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review"."review_task" ADD CONSTRAINT "review_task_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "iam"."user_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review"."review_task" ADD CONSTRAINT "review_task_reassigned_from_action_id_fkey" FOREIGN KEY ("reassigned_from_action_id") REFERENCES "review"."review_task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization"."organization_registration_request" ADD CONSTRAINT "organization_registration_request_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"."organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization"."organization_registration_request" ADD CONSTRAINT "organization_registration_request_authorized_representativ_fkey" FOREIGN KEY ("authorized_representative_appointment_attachment_id") REFERENCES "attachment"."attachment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization"."organization_registration_request" ADD CONSTRAINT "organization_registration_request_power_of_attorney_attach_fkey" FOREIGN KEY ("power_of_attorney_attachment_id") REFERENCES "attachment"."attachment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachment"."attachment" ADD CONSTRAINT "attachment_replaced_attachment_id_fkey" FOREIGN KEY ("replaced_attachment_id") REFERENCES "attachment"."attachment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dataset"."dataset_registration_request" ADD CONSTRAINT "dataset_registration_request_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"."organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dataset"."dataset_registration_request" ADD CONSTRAINT "dataset_registration_request_data_dictionary_attachment_id_fkey" FOREIGN KEY ("data_dictionary_attachment_id") REFERENCES "attachment"."attachment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dataset"."dataset_registration_request" ADD CONSTRAINT "dataset_registration_request_example_data_attachment_id_fkey" FOREIGN KEY ("example_data_attachment_id") REFERENCES "attachment"."attachment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dataset"."dataset_registration_request" ADD CONSTRAINT "dataset_registration_request_created_dataset_id_fkey" FOREIGN KEY ("created_dataset_id") REFERENCES "dataset"."dataset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dataset"."dataset_registration_metadata" ADD CONSTRAINT "dataset_registration_metadata_dataset_registration_request_fkey" FOREIGN KEY ("dataset_registration_request_id") REFERENCES "dataset"."dataset_registration_request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dataset"."dataset" ADD CONSTRAINT "dataset_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"."organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dataset"."dataset" ADD CONSTRAINT "dataset_data_dictionary_attachment_id_fkey" FOREIGN KEY ("data_dictionary_attachment_id") REFERENCES "attachment"."attachment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dataset"."dataset" ADD CONSTRAINT "dataset_example_data_attachment_id_fkey" FOREIGN KEY ("example_data_attachment_id") REFERENCES "attachment"."attachment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dataset"."dataset" ADD CONSTRAINT "dataset_source_dataset_registration_request_id_fkey" FOREIGN KEY ("source_dataset_registration_request_id") REFERENCES "dataset"."dataset_registration_request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dataset"."dataset_metadata" ADD CONSTRAINT "dataset_metadata_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "dataset"."dataset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal"."legal_document_version" ADD CONSTRAINT "legal_document_version_legal_document_id_fkey" FOREIGN KEY ("legal_document_id") REFERENCES "legal"."legal_document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal"."legal_document_version" ADD CONSTRAINT "legal_document_version_attachment_id_fkey" FOREIGN KEY ("attachment_id") REFERENCES "attachment"."attachment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal"."legal_acceptance" ADD CONSTRAINT "legal_acceptance_legal_document_version_id_fkey" FOREIGN KEY ("legal_document_version_id") REFERENCES "legal"."legal_document_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal"."legal_acceptance" ADD CONSTRAINT "legal_acceptance_user_account_id_fkey" FOREIGN KEY ("user_account_id") REFERENCES "iam"."user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal"."legal_acceptance" ADD CONSTRAINT "legal_acceptance_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"."organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal"."legal_acceptance" ADD CONSTRAINT "legal_acceptance_review_task_id_fkey" FOREIGN KEY ("review_task_id") REFERENCES "review"."review_task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal"."legal_acceptance" ADD CONSTRAINT "legal_acceptance_signature_confirmation_id_fkey" FOREIGN KEY ("signature_confirmation_id") REFERENCES "signature"."signature_confirmation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signature"."signature_confirmation" ADD CONSTRAINT "signature_confirmation_review_task_id_fkey" FOREIGN KEY ("review_task_id") REFERENCES "review"."review_task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signature"."signature_confirmation" ADD CONSTRAINT "signature_confirmation_user_account_id_fkey" FOREIGN KEY ("user_account_id") REFERENCES "iam"."user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signature"."signature_confirmation" ADD CONSTRAINT "signature_confirmation_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"."organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification"."notification" ADD CONSTRAINT "notification_recipient_user_id_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "iam"."user_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification"."notification" ADD CONSTRAINT "notification_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"."organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification"."notification_delivery" ADD CONSTRAINT "notification_delivery_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "notification"."notification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration"."integration_operation" ADD CONSTRAINT "integration_operation_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"."organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "administration"."district" ADD CONSTRAINT "district_province_code_fkey" FOREIGN KEY ("province_code") REFERENCES "administration"."province"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "administration"."sub_district" ADD CONSTRAINT "sub_district_district_code_fkey" FOREIGN KEY ("district_code") REFERENCES "administration"."district"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- ═══════════════════════════════════════════════════════════════════════════
-- Constraints ที่ Excel ระบุไว้แต่ Prisma schema เขียนไม่ได้
-- ทุกข้อด้านล่างอ้างอิงภาพ/ข้อความในไฟล์
-- assets/db_schema/draft_db_design_downloaded_on_2026-08-11.xlsx
-- ═══════════════════════════════════════════════════════════════════════════

-- sheet `activation_key` — "One usable key per user, organization, and role"
CREATE UNIQUE INDEX "uq_active_activation_key"
    ON "iam"."activation_key" ("user_account_id", "organization_id", "role_id")
    WHERE "status" = 'ISSUED';

-- sheet `review_task` — "หนึ่ง Request ควรมี Active Task ได้ไม่เกินหนึ่งรายการ"
CREATE UNIQUE INDEX "uq_active_review_task_per_subject"
    ON "review"."review_task" ("subject_type", "subject_id")
    WHERE "status" IN ('PENDING', 'IN_PROGRESS');

-- sheet `attachment` — "จำกัดให้มี Active Attachment ได้หนึ่งรายการต่อ attachment slot"
CREATE UNIQUE INDEX "uq_active_attachment_per_slot"
    ON "attachment"."attachment" ("owner_type", "owner_id", "attachment_type")
    WHERE "status" = 'ACTIVE';

-- sheet `user_account` — Business rule ท้าย sheet:
--   "หนึ่ง Organization มี Operational User ที่ ACTIVE ได้ไม่เกิน 1 คน"
--   "หนึ่ง Organization มี Organization Approver ที่ ACTIVE ได้ไม่เกิน 1 คน"
-- organization_id เป็น NULL สำหรับ role ฝั่ง BDI/SYSTEM และ Postgres นับ NULL ว่าไม่ซ้ำกัน
-- เจ้าหน้าที่ BDI จึงมีได้หลายคนตามเดิม
-- **ข้อนี้ขัดกับ docs/01-user-journey.md §1 ที่เขียนว่ามี ORG_USER ได้หลายคน — ยึดตาม Excel**
CREATE UNIQUE INDEX "uq_active_org_scoped_role_assignment"
    ON "iam"."user_role_assignment" ("organization_id", "role_id")
    WHERE "status" = 'ACTIVE';

-- sheet `review_task` — "result IN ('RETURNED', 'REJECTED') ต้องมี result_comment เสมอ"
ALTER TABLE "review"."review_task"
    ADD CONSTRAINT "review_task_returned_rejected_needs_comment"
    CHECK (
        "result" IS NULL
        OR "result" NOT IN ('RETURNED', 'REJECTED')
        OR ("result_comment" IS NOT NULL AND btrim("result_comment") <> '')
    );

-- sheet `review_task` — COMPLETED เท่านั้นที่มี result, CANCELLED/REASSIGNED ต้องไม่มี
ALTER TABLE "review"."review_task"
    ADD CONSTRAINT "review_task_result_only_when_completed"
    CHECK (
        ("status" = 'COMPLETED' AND "result" IS NOT NULL)
        OR ("status" <> 'COMPLETED' AND "result" IS NULL)
    );

-- sheet `review_task` — "round_number ... เริ่มต้นที่ 1"
ALTER TABLE "review"."review_task"
    ADD CONSTRAINT "review_task_round_number_positive" CHECK ("round_number" >= 1);

-- sheet `notification` — "เมื่อ status = READ ต้องมีค่า read_at"
--                        "เมื่อ status = ARCHIVED ควรมีค่า archived_at"
ALTER TABLE "notification"."notification"
    ADD CONSTRAINT "notification_read_at_present_when_read"
    CHECK ("status" <> 'READ' OR "read_at" IS NOT NULL);

ALTER TABLE "notification"."notification"
    ADD CONSTRAINT "notification_archived_at_present_when_archived"
    CHECK ("status" <> 'ARCHIVED' OR "archived_at" IS NOT NULL);

-- sheet `notification_delivery` — "attempt_count ต้องเริ่มต้นที่ 0"
--                                 "เมื่อ status = SENT ควรมีค่า sent_at"
--                                 "เมื่อ status = DELIVERED ต้องมีค่า delivered_at"
ALTER TABLE "notification"."notification_delivery"
    ADD CONSTRAINT "notification_delivery_attempt_count_non_negative"
    CHECK ("attempt_count" >= 0);

ALTER TABLE "notification"."notification_delivery"
    ADD CONSTRAINT "notification_delivery_sent_at_present_when_sent"
    CHECK ("status" <> 'SENT' OR "sent_at" IS NOT NULL);

ALTER TABLE "notification"."notification_delivery"
    ADD CONSTRAINT "notification_delivery_delivered_at_present_when_delivered"
    CHECK ("status" <> 'DELIVERED' OR "delivered_at" IS NOT NULL);

-- sheet `attachment` — ACTIVE ใช้เป็นไฟล์ปัจจุบันได้ "เมื่อ scan_status = CLEAN"
--                      REPLACED ต้องมี replaced_attachment_id ชี้ไฟล์เดิม
ALTER TABLE "attachment"."attachment"
    ADD CONSTRAINT "attachment_file_size_non_negative" CHECK ("file_size_bytes" >= 0);

-- sheet `legal_document_version` — PUBLISHED ต้องมี published_at
ALTER TABLE "legal"."legal_document_version"
    ADD CONSTRAINT "legal_document_version_published_at_present_when_published"
    CHECK ("status" <> 'PUBLISHED' OR "published_at" IS NOT NULL);

-- sheet `legal_document` — display_order ใช้เรียงภายใน application_scope
ALTER TABLE "legal"."legal_document"
    ADD CONSTRAINT "legal_document_display_order_non_negative"
    CHECK ("display_order" >= 0);

-- sheet `user_role_assignment` — ช่วงเวลาต้องเรียงถูกต้อง
ALTER TABLE "iam"."user_role_assignment"
    ADD CONSTRAINT "user_role_assignment_effective_range"
    CHECK ("effective_until" IS NULL OR "effective_until" > "effective_from");

-- sheet `activation_key` — คีย์ต้องหมดอายุหลังออก
ALTER TABLE "iam"."activation_key"
    ADD CONSTRAINT "activation_key_expires_after_issue"
    CHECK ("expires_at" > "issued_at");
