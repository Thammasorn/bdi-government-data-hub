-- ทำให้ `updated_at` ของคำขอเป็น "วันที่คำขอเปลี่ยนแปลงล่าสุด" ย้อนหลังด้วย
--
-- คอลัมน์ใหม่ในหน้ารายการอ่านค่านี้ และการเรียงตามคอลัมน์นั้นเรียงใน SQL ด้วยคอลัมน์นี้
-- ตัวเดียว ทุกทางที่ทำให้คำขอขยับจบด้วย syncStatus() ซึ่งเขียนแถวคำขอ **ยกเว้นทางเดียว**:
-- ความเห็นของผู้เชี่ยวชาญ (recordAdvisoryNote()) ที่เขียนแค่ review_task — ปิดไปแล้วในโค้ด
-- รอบนี้ แต่แถวที่เกิดก่อนหน้านั้นยังค้างค่าเก่าอยู่ ถ้าไม่ไล่เก็บ คำขอที่ได้ความเห็นล่าสุด
-- ก่อนดีพลอยจะแสดงวันที่ของ transition ก่อนหน้า และเรียงลงไปอยู่ผิดที่แบบที่ไม่มีใครเห็นว่าผิด
--
-- GREATEST() ไม่ใช่การเขียนทับ — ค่าไหนใหม่กว่าอยู่แล้วก็อยู่เหมือนเดิม รันซ้ำได้
-- review_task.subject_id เป็น logical reference ไม่ใช่ FK จึงต้อง join ด้วย subject_type เอง

UPDATE "organization"."organization_registration_request" AS r
SET "updated_at" = GREATEST(r."updated_at", t."last_touch")
FROM (
  SELECT "subject_id", MAX("updated_at") AS "last_touch"
  FROM "review"."review_task"
  WHERE "subject_type" = 'ORGANIZATION_REGISTRATION_REQUEST'
  GROUP BY "subject_id"
) AS t
WHERE r."id" = t."subject_id"
  AND t."last_touch" > r."updated_at";

UPDATE "dataset"."dataset_registration_request" AS r
SET "updated_at" = GREATEST(r."updated_at", t."last_touch")
FROM (
  SELECT "subject_id", MAX("updated_at") AS "last_touch"
  FROM "review"."review_task"
  WHERE "subject_type" = 'DATASET_REGISTRATION_REQUEST'
  GROUP BY "subject_id"
) AS t
WHERE r."id" = t."subject_id"
  AND t."last_touch" > r."updated_at";

-- การเรียงหน้ารายการมีคีย์ที่สองแล้ว — `submitted_at` ไม่เคยมี index เพราะจำนวนแถวยังน้อย
-- แต่คอลัมน์นี้เป็นคีย์ของทุกหน้าที่เปิดด้วยค่าเริ่มต้นได้ในอนาคต และ index ราคาถูก
CREATE INDEX IF NOT EXISTS "organization_registration_request_updated_at_idx"
  ON "organization"."organization_registration_request" ("updated_at");
CREATE INDEX IF NOT EXISTS "dataset_registration_request_updated_at_idx"
  ON "dataset"."dataset_registration_request" ("updated_at");
