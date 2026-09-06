-- ด่านของ BDI เป็นของบทบาท ไม่ใช่ของคน
--
-- `pickAssignee()` เคยสุ่มเกลี่ยงานให้เจ้าหน้าที่คนหนึ่งตอนเปิดด่าน แต่ `canAction()` ให้ใคร
-- ก็ตามที่ถือ role นั้นปิดด่านได้โดยไม่ดูค่านี้เลย ค่าที่ได้จึงไม่เคยเป็นคำตอบของคำถามไหน
-- และกลายเป็นชื่อผิดบนไทม์ไลน์ ด่านที่ยังเป็นของคนจริง ๆ เหลือ ORGANIZATION_APPROVAL
-- ซึ่งชี้ไปยังผู้มีอำนาจลงนามที่หน่วยงานระบุชื่อมาในฟอร์ม
ALTER TABLE "review"."review_task" ALTER COLUMN "assigned_user_id" DROP NOT NULL;

-- คนที่ปิดด่านจริง ๆ
ALTER TABLE "review"."review_task" ADD COLUMN "completed_by" UUID;

-- Backfill จาก `updated_by` ซึ่งเป็นค่าที่ `completeTask()` เขียนไว้ตอนปิด task
--
-- **ยกเว้นแถวของบัญชีระบบ** — seed:demo สร้าง review_task โดยตรงด้วย
-- updated_by = SYSTEM_USER_ID (96 แถว COMPLETED บน main มี 23 แถวเป็นแบบนี้ ทั้งหมด
-- ลงวันที่เดียวกับการ seed) แถวเหล่านั้นไม่มีคนกดจริง ปล่อยเป็น NULL ให้ไทม์ไลน์ไม่ขึ้นชื่อ
-- ดีกว่าใส่ชื่อ "ระบบ" ให้สิ่งที่ควรเป็นการกระทำของคน
UPDATE "review"."review_task"
   SET "completed_by" = "updated_by"
 WHERE "status" = 'COMPLETED'
   AND "updated_by" <> '00000000-0000-0000-0000-000000000001'::uuid;

-- RESTRICT เหมือน assigned_user_id — หลักฐานว่าใครเป็นคนอนุมัติต้องไม่หายไปเงียบ ๆ
-- เพราะมีคนไปลบบัญชีทีหลัง
ALTER TABLE "review"."review_task"
  ADD CONSTRAINT "review_task_completed_by_fkey"
  FOREIGN KEY ("completed_by") REFERENCES "iam"."user_account"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
