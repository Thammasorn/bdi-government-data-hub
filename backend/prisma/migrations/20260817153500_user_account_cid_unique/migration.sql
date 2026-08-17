-- หนึ่งเลขบัตรประชาชน = หนึ่งบัญชี (ตัดสินใจ 2026-08-17)
--
-- ฐานข้อมูลของ main มี UNIQUE CONSTRAINT ชื่อ "user_account_unique" บน (cid) อยู่ก่อนแล้ว
-- โดยไม่มี migration ไหนสร้าง — มีใครเพิ่มด้วยมือผ่าน client ฐานข้อมูล ผลคือ main
-- ตอบ 500 (P2002 ที่ไม่มีใครดัก) ในเคสที่ checkout อื่นตอบ 201 ลบตัวที่เพิ่มด้วยมือทิ้ง
-- แล้วสร้างใหม่ในชื่อที่ Prisma เป็นเจ้าของ ทุกฐานข้อมูลจึงกลับมาเหมือนกันและ
-- `migrate deploy` ครั้งต่อไปไม่เห็น drift อีก
ALTER TABLE "iam"."user_account" DROP CONSTRAINT IF EXISTS "user_account_unique";

-- unique index ค้นหาด้วย cid ได้อยู่แล้ว ไม่ต้องมี index ธรรมดาซ้อนอีกตัว
DROP INDEX IF EXISTS "iam"."user_account_cid_idx";

CREATE UNIQUE INDEX "user_account_cid_key" ON "iam"."user_account"("cid");
