-- CreateTable
CREATE TABLE "legal"."request_document_snapshot" (
    "id" UUID NOT NULL,
    "subject_type" "review"."SubjectType" NOT NULL,
    "subject_id" UUID NOT NULL,
    "submission_no" INTEGER NOT NULL,
    "legal_document_version_id" UUID NOT NULL,
    "display_order" INTEGER NOT NULL,
    "is_required" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "request_document_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "request_document_snapshot_subject_type_subject_id_submissio_idx" ON "legal"."request_document_snapshot"("subject_type", "subject_id", "submission_no");

-- CreateIndex
CREATE INDEX "request_document_snapshot_legal_document_version_id_idx" ON "legal"."request_document_snapshot"("legal_document_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "request_document_snapshot_subject_type_subject_id_submissio_key" ON "legal"."request_document_snapshot"("subject_type", "subject_id", "submission_no", "legal_document_version_id");

-- AddForeignKey
ALTER TABLE "legal"."request_document_snapshot" ADD CONSTRAINT "request_document_snapshot_legal_document_version_id_fkey" FOREIGN KEY ("legal_document_version_id") REFERENCES "legal"."legal_document_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
