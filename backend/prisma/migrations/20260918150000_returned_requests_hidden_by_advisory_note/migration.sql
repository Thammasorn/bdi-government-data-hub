-- คืนสถานะ RETURNED ให้คำขอชุดข้อมูลที่ถูกส่งกลับแล้ว แต่ค้างเป็น UNDER_REVIEW
--
-- deriveRequestStatus() หาว่า "ด่านล่าสุดที่ปิดไป" ปิดด้วยผลอะไร โดยเรียง review_task ตาม
-- sequence_number ความเห็นของผู้เชี่ยวชาญ (DATASET_SPECIALIST_REVIEW, ปิดด้วย CONFIRMED
-- ตั้งแต่เกิด) ได้เลขลำดับถัดจากแถวล่าสุด **ขณะที่ด่านของเจ้าหน้าที่ยังเปิดอยู่** พอเจ้าหน้าที่
-- ส่งคำขอกลับ แถว RETURNED ของเขาจึงมีเลขน้อยกว่าความเห็นที่บันทึกไว้ก่อน และถูกบังไว้:
-- ฟังก์ชันเห็น CONFIRMED แล้วตกไปบรรทัดสุดท้าย = UNDER_REVIEW ทั้งที่ไม่มี task ไหน active
-- คำขอนั้นหายจากทุกโหนดของตัวกรอง และขั้นที่ 1 บนไทม์ไลน์ขึ้นว่าเสร็จสิ้น
-- (การ์ด "BUG registration step" 2026-09-18)
--
-- โค้ดรอบนี้กรองแถวความเห็นออกจากคำถามนั้นแล้ว (ADVISORY_TASK_TYPES ใน lib/workflow.ts)
-- แต่คำขอที่ถูกส่งกลับก่อนดีพลอยยังค้างค่าเดิม เพราะ status ถูกคำนวณใหม่เฉพาะตอนมี
-- transition — และคำขอพวกนี้จะไม่มี transition จนกว่าหน่วยงานจะเห็นมันอีกครั้ง ซึ่งเป็น
-- สิ่งที่บั๊กกันไว้พอดี
--
-- เงื่อนไขทุกข้อคือกฎของ requestStatusFor() เขียนเป็น SQL: ไม่มี task active, ด่านล่าสุด
-- ที่ไม่ใช่ความเห็นปิดด้วย RETURNED เฉพาะคำขอชุดข้อมูล — เส้นทางหน่วยงานไม่มีแถวความเห็น
-- จึงไม่มีทางเกิดแบบนี้ รันซ้ำได้: รอบสองไม่เหลือแถวที่เข้าเงื่อนไข

UPDATE "dataset"."dataset_registration_request" AS r
SET "status" = 'RETURNED',
    "updated_by" = '00000000-0000-0000-0000-000000000001'::uuid
WHERE r."status" = 'UNDER_REVIEW'
  AND NOT EXISTS (
    SELECT 1 FROM "review"."review_task" a
    WHERE a."subject_type" = 'DATASET_REGISTRATION_REQUEST'
      AND a."subject_id" = r."id"
      AND a."status" IN ('PENDING', 'IN_PROGRESS')
  )
  AND (
    SELECT t."result"
    FROM "review"."review_task" t
    WHERE t."subject_type" = 'DATASET_REGISTRATION_REQUEST'
      AND t."subject_id" = r."id"
      AND t."status" = 'COMPLETED'
      AND t."task_type" <> 'DATASET_SPECIALIST_REVIEW'
    ORDER BY t."sequence_number" DESC
    LIMIT 1
  ) = 'RETURNED';
