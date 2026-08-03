-- CreateEnum
CREATE TYPE "DatasetRequestStatus" AS ENUM ('DRAFT', 'PENDING_OFFICER_REVIEW', 'PENDING_ORG_APPROVER', 'PENDING_OFFICER_FINAL_CHECK', 'PENDING_BDI_APPROVAL', 'NEEDS_REVISION', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "DatasetRequestEventType" AS ENUM ('CREATED', 'SUBMITTED', 'SPECIALIST_ASSIGNED', 'SPECIALIST_UNASSIGNED', 'SPECIALIST_COMMENTED', 'SPECIALIST_REVISION_REQUESTED', 'OFFICER_FORWARDED', 'OFFICER_REVISION_REQUESTED', 'ORG_APPROVER_SIGNED', 'ORG_APPROVER_REVISION_REQUESTED', 'OFFICER_CONFIRMED', 'OFFICER_FINAL_REVISION_REQUESTED', 'BDI_APPROVED', 'BDI_REJECTED', 'BDI_REVISION_REQUESTED');

-- CreateEnum
CREATE TYPE "DatasetAttachmentKind" AS ENUM ('DATA_DICTIONARY', 'EXAMPLE_DATA', 'GENERATED_FORM');

-- CreateEnum
CREATE TYPE "DatasetType" AS ENUM ('RECORD', 'STATISTIC', 'GEOGRAPHIC', 'MULTIMEDIA', 'OTHER');

-- CreateEnum
CREATE TYPE "DatasetCategory" AS ENUM ('ECONOMY_FINANCE', 'AGRICULTURE', 'HEALTH', 'EDUCATION', 'TRANSPORT', 'ENERGY', 'ENVIRONMENT', 'SOCIETY', 'PUBLIC_SAFETY', 'SCIENCE_TECH', 'TOURISM_SPORT', 'GOVERNMENT');

-- CreateEnum
CREATE TYPE "UpdateFrequency" AS ENUM ('REAL_TIME', 'DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'BIANNUAL', 'YEARLY', 'AS_NEEDED');

-- CreateEnum
CREATE TYPE "GeoCoverage" AS ENUM ('NATIONAL', 'REGIONAL', 'PROVINCIAL', 'DISTRICT', 'OTHER');

-- CreateEnum
CREATE TYPE "DeliveryMethod" AS ENUM ('API', 'SFTP', 'DATABASE', 'FILE_UPLOAD', 'OTHER');

-- CreateEnum
CREATE TYPE "DataFormat" AS ENUM ('CSV', 'JSON', 'XLSX', 'XML', 'PARQUET', 'SHAPEFILE', 'OTHER');

-- CreateEnum
CREATE TYPE "DataClassification" AS ENUM ('PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'SECRET');

-- CreateEnum
CREATE TYPE "LicenseType" AS ENUM ('OPEN_GOVERNMENT', 'CC_BY', 'CC_BY_SA', 'CC_BY_NC', 'INTERNAL_ONLY', 'OTHER');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('DATASET_SUBMITTED', 'DATASET_REVISION_REQUESTED', 'DATASET_SPECIALIST_ASSIGNED', 'DATASET_PENDING_ORG_APPROVER', 'DATASET_PENDING_FINAL_CHECK', 'DATASET_PENDING_BDI_APPROVAL', 'DATASET_APPROVED', 'DATASET_REJECTED', 'DATASET_COMMENTED');

-- CreateEnum
CREATE TYPE "ActivityAction" AS ENUM ('CREATE', 'UPDATE', 'SUBMIT', 'REVIEW', 'APPROVE', 'REJECT', 'RETURN_FOR_REVISION', 'ASSIGN', 'DELETE', 'DOWNLOAD');

-- CreateTable
CREATE TABLE "dataset_requests" (
    "id" TEXT NOT NULL,
    "status" "DatasetRequestStatus" NOT NULL DEFAULT 'DRAFT',
    "requestNumber" TEXT NOT NULL,
    "nameTh" TEXT,
    "nameEn" TEXT,
    "description" TEXT,
    "datasetType" "DatasetType",
    "category" "DatasetCategory",
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updateFrequency" "UpdateFrequency",
    "geoCoverage" "GeoCoverage",
    "dataStartDate" TIMESTAMP(3),
    "dataEndDate" TIMESTAMP(3),
    "estimatedRecords" INTEGER,
    "stewardName" TEXT,
    "stewardEmail" TEXT,
    "stewardPhone" TEXT,
    "deliveryMethod" "DeliveryMethod",
    "dataFormat" "DataFormat",
    "deliveryFrequency" "UpdateFrequency",
    "deliveryEndpoint" TEXT,
    "technicalContactName" TEXT,
    "technicalContactEmail" TEXT,
    "deliveryNote" TEXT,
    "dataClassification" "DataClassification",
    "hasPersonalData" BOOLEAN,
    "personalDataMeasure" TEXT,
    "legalBasis" TEXT,
    "licenseType" "LicenseType",
    "usageRestriction" TEXT,
    "legalAcceptedAt" TIMESTAMP(3),
    "legalAcceptedById" TEXT,
    "revisionNote" TEXT,
    "submittedAt" TIMESTAMP(3),
    "orgApproverSignedAt" TIMESTAMP(3),
    "orgApproverSignedById" TEXT,
    "orgApproverSignedName" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "approvedByName" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectedById" TEXT,
    "rejectedByName" TEXT,
    "rejectionReason" TEXT,
    "organizationId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "assignedSpecialistId" TEXT,
    "assignedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dataset_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dataset_attachments" (
    "id" TEXT NOT NULL,
    "kind" "DatasetAttachmentKind" NOT NULL,
    "objectKey" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "datasetRequestId" TEXT NOT NULL,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dataset_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dataset_request_events" (
    "id" TEXT NOT NULL,
    "type" "DatasetRequestEventType" NOT NULL,
    "fromStatus" "DatasetRequestStatus",
    "toStatus" "DatasetRequestStatus",
    "note" TEXT,
    "datasetRequestId" TEXT NOT NULL,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dataset_request_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "link" TEXT,
    "userId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_logs" (
    "id" TEXT NOT NULL,
    "action" "ActivityAction" NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT,
    "actorRoles" "Role"[] DEFAULT ARRAY[]::"Role"[],
    "actorOrganizationId" TEXT,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "targetRef" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "dataset_requests_requestNumber_key" ON "dataset_requests"("requestNumber");

-- CreateIndex
CREATE INDEX "dataset_requests_organizationId_status_idx" ON "dataset_requests"("organizationId", "status");

-- CreateIndex
CREATE INDEX "dataset_requests_status_idx" ON "dataset_requests"("status");

-- CreateIndex
CREATE INDEX "dataset_requests_assignedSpecialistId_idx" ON "dataset_requests"("assignedSpecialistId");

-- CreateIndex
CREATE INDEX "dataset_attachments_datasetRequestId_kind_idx" ON "dataset_attachments"("datasetRequestId", "kind");

-- CreateIndex
CREATE INDEX "dataset_request_events_datasetRequestId_createdAt_idx" ON "dataset_request_events"("datasetRequestId", "createdAt");

-- CreateIndex
CREATE INDEX "notifications_userId_readAt_idx" ON "notifications"("userId", "readAt");

-- CreateIndex
CREATE INDEX "notifications_userId_createdAt_idx" ON "notifications"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "activity_logs_targetType_targetId_createdAt_idx" ON "activity_logs"("targetType", "targetId", "createdAt");

-- CreateIndex
CREATE INDEX "activity_logs_actorId_createdAt_idx" ON "activity_logs"("actorId", "createdAt");

-- AddForeignKey
ALTER TABLE "dataset_requests" ADD CONSTRAINT "dataset_requests_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dataset_requests" ADD CONSTRAINT "dataset_requests_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dataset_requests" ADD CONSTRAINT "dataset_requests_assignedSpecialistId_fkey" FOREIGN KEY ("assignedSpecialistId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dataset_attachments" ADD CONSTRAINT "dataset_attachments_datasetRequestId_fkey" FOREIGN KEY ("datasetRequestId") REFERENCES "dataset_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dataset_attachments" ADD CONSTRAINT "dataset_attachments_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dataset_request_events" ADD CONSTRAINT "dataset_request_events_datasetRequestId_fkey" FOREIGN KEY ("datasetRequestId") REFERENCES "dataset_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dataset_request_events" ADD CONSTRAINT "dataset_request_events_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
