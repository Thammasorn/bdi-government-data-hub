-- AlterTable
ALTER TABLE "dataset"."dataset_registration_request" ADD COLUMN     "assigned_specialist_at" TIMESTAMPTZ(6),
ADD COLUMN     "assigned_specialist_by" UUID,
ADD COLUMN     "assigned_specialist_id" UUID;

-- CreateIndex
CREATE INDEX "dataset_registration_request_assigned_specialist_id_idx" ON "dataset"."dataset_registration_request"("assigned_specialist_id");

-- AddForeignKey
ALTER TABLE "dataset"."dataset_registration_request" ADD CONSTRAINT "dataset_registration_request_assigned_specialist_id_fkey" FOREIGN KEY ("assigned_specialist_id") REFERENCES "iam"."user_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------- backfill
--
-- การมอบหมายผู้เชี่ยวชาญเดิมถูกเก็บเป็นแถวใน review.review_task ตั้งแต่นี้ไปมันคือ
-- คอลัมน์บนคำขอ เพราะการขอความเห็นไม่ใช่การย้ายด่านอีกต่อไป
--
-- 1) คำขอที่เคยมอบหมาย ยังคงชื่อผู้เชี่ยวชาญคนล่าสุดไว้ — ยกเว้นใบที่ถูก "ถอนการมอบหมาย"
--    ซึ่งปิดแถวนั้นเป็น CANCELLED และแปลว่าไม่มีผู้เชี่ยวชาญอยู่แล้ว
WITH latest AS (
  SELECT DISTINCT ON (subject_id)
         subject_id, assigned_user_id, assigned_at, assigned_by
    FROM review.review_task
   WHERE subject_type = 'DATASET_REGISTRATION_REQUEST'
     AND task_type = 'DATASET_SPECIALIST_REVIEW'
     AND status <> 'CANCELLED'
   ORDER BY subject_id, sequence_number DESC
)
UPDATE dataset.dataset_registration_request r
   SET assigned_specialist_id = l.assigned_user_id,
       assigned_specialist_at = l.assigned_at,
       assigned_specialist_by = l.assigned_by
  FROM latest l
 WHERE r.id = l.subject_id;

-- 2) ใบที่ค้างอยู่ที่ด่านผู้เชี่ยวชาญ ณ ตอน migrate ต้องคืนด่านให้เจ้าหน้าที่ BDI
--    ไม่งั้นจะไม่มีใครกดต่อได้เลย: ด่านนั้นไม่มีอยู่ในเส้นทางอีกแล้ว
--    ปิดแถวเดิมเป็น CANCELLED แล้วเปิด BDI_OFFICER_REVIEW ใบใหม่ — ปิดก่อนเปิดเสมอ
--    เพราะ uq_active_review_task_per_subject ยอมให้มี active task ได้ใบเดียว
WITH cancelled AS (
  UPDATE review.review_task
     SET status = 'CANCELLED',
         cancelled_at = now(),
         cancelled_by = assigned_by,
         cancellation_reason = 'ด่านผู้เชี่ยวชาญถูกยกเลิก — เปลี่ยนเป็นการขอความเห็นโดยไม่ย้ายด่าน',
         updated_at = now()
   WHERE subject_type = 'DATASET_REGISTRATION_REQUEST'
     AND task_type = 'DATASET_SPECIALIST_REVIEW'
     AND status IN ('PENDING', 'IN_PROGRESS')
  RETURNING *
)
INSERT INTO review.review_task (
  id, subject_type, subject_id, task_type, sequence_number, round_number,
  assigned_user_id, assigned_role, assigned_by, assignment_source, status,
  assigned_at, created_at, created_by, updated_at, updated_by
)
SELECT gen_random_uuid(),
       c.subject_type,
       c.subject_id,
       'BDI_OFFICER_REVIEW',
       (SELECT count(*) FROM review.review_task x
         WHERE x.subject_type = c.subject_type AND x.subject_id = c.subject_id) + 1,
       (SELECT count(*) FROM review.review_task x
         WHERE x.subject_type = c.subject_type AND x.subject_id = c.subject_id
           AND x.task_type = 'BDI_OFFICER_REVIEW') + 1,
       -- เจ้าหน้าที่ที่กดมอบหมายคือคนที่ควรได้ด่านคืน ถ้าไม่มีก็เอา BDI_OFFICER คนใดก็ได้
       COALESCE(c.assigned_by, officer.user_account_id, c.assigned_user_id),
       'BDI_OFFICER',
       NULL,
       'SYSTEM',
       'PENDING',
       now(), now(),
       COALESCE(c.assigned_by, c.assigned_user_id),
       now(),
       COALESCE(c.assigned_by, c.assigned_user_id)
  FROM cancelled c
  LEFT JOIN LATERAL (
    SELECT ura.user_account_id
      FROM iam.user_role_assignment ura
      JOIN iam.role ro ON ro.id = ura.role_id
     WHERE ro.code = 'BDI_OFFICER' AND ura.status = 'ACTIVE'
     ORDER BY ura.created_at
     LIMIT 1
  ) officer ON true;
