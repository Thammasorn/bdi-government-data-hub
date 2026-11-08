-- การ์ด "[Enhance] JIRA integration" (2026-11-08)

-- สิ่งที่งานใน integration_operation ต้องส่ง (ไม่มีความลับ)
ALTER TABLE "integration"."integration_operation" ADD COLUMN "request_payload_json" JSONB;

CREATE TYPE "integration"."JiraIssueState" AS ENUM ('OPEN', 'DONE', 'ENDED');

CREATE TABLE "integration"."jira_issue_link" (
    "id" UUID NOT NULL,
    "dataset_registration_request_id" UUID NOT NULL,
    "specialist_id" UUID,
    "issue_key" VARCHAR(64),
    "issue_id" VARCHAR(64),
    "state" "integration"."JiraIssueState" NOT NULL DEFAULT 'OPEN',
    "end_reason" VARCHAR(32),
    "assignee_found" BOOLEAN,
    "done_at" TIMESTAMPTZ(6),
    "ended_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "jira_issue_link_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "jira_issue_link_dataset_registration_request_id_idx" ON "integration"."jira_issue_link"("dataset_registration_request_id");
CREATE INDEX "jira_issue_link_state_idx" ON "integration"."jira_issue_link"("state");

ALTER TABLE "integration"."jira_issue_link" ADD CONSTRAINT "jira_issue_link_dataset_registration_request_id_fkey" FOREIGN KEY ("dataset_registration_request_id") REFERENCES "dataset"."dataset_registration_request"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "integration"."jira_issue_link" ADD CONSTRAINT "jira_issue_link_specialist_id_fkey" FOREIGN KEY ("specialist_id") REFERENCES "iam"."user_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- งาน Jira ของคำขอหนึ่งต้องทำตามลำดับ — ตัวหยิบงานถามว่า "มีงานก่อนหน้าของคำขอนี้ที่ยังไม่จบไหม"
CREATE INDEX "integration_operation_jira_queue_idx" ON "integration"."integration_operation"("integration_type", "subject_id", "created_at")
  WHERE "status" NOT IN ('SUCCEEDED', 'CANCELLED');
