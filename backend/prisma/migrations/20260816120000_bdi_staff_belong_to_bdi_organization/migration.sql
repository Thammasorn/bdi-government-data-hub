-- เจ้าหน้าที่ BDI สังกัดหน่วยงาน BDI เหมือนผู้ใช้คนอื่น ๆ
--
-- เดิม user_role_assignment.organization_id เป็น NULL สำหรับ role ฝั่ง BDI/SYSTEM ซึ่งทำให้
-- ตอบคำถาม "ผู้ใช้คนนี้อยู่หน่วยงานไหน" จากฐานข้อมูลตรง ๆ ไม่ได้ ทั้งที่ BDI เองก็เป็นแถวหนึ่ง
-- ใน organization.organization อยู่แล้ว (และ activation_key.organization_id ของเจ้าหน้าที่ BDI
-- ก็ชี้มาที่ BDI มาตลอด) — ตรงนี้จึงเป็นการทำให้สองตารางพูดตรงกัน
--
-- ทำแบบเดิมไม่ได้เพราะ uq_active_org_scoped_role_assignment เป็น
--   UNIQUE (organization_id, role_id) WHERE status = 'ACTIVE'
-- ซึ่งไม่ได้จำกัดเฉพาะ role ที่ผูกกับหน่วยงาน เจ้าหน้าที่ BDI รอดมาได้เพราะ organization_id
-- เป็น NULL และ Postgres นับ NULL ว่าไม่ซ้ำกัน พอเติมรหัสหน่วยงาน BDI ลงไป
-- เจ้าหน้าที่ BDI คนที่สองของ role เดิมจะชนทันที (ทดสอบแล้ว: main มี BDI_OFFICER 3 คน)
--
-- กติกา "หนึ่งหน่วยงานมี ORGANIZATION_USER / ORGANIZATION_APPROVER ที่ ACTIVE ได้อย่างละคน"
-- ยังอยู่ แต่ย้ายไปบังคับที่ชั้นแอปพลิเคชันแทน (lib/iam.ts → assignRole) ซึ่งเลือกได้ว่า
-- หน่วยงาน BDI ให้มีได้หลายคนต่อ role — เงื่อนไขที่ partial index เขียนไม่ได้ เพราะ
-- role.id ถูกสุ่มใหม่ทุกฐานข้อมูล (seed:masters ไม่ได้กำหนด id ตายตัว) จึงอ้างใน index ไม่ได้
--
-- ผลข้างเคียงที่ยอมรับ: การแข่งกันเขียนพร้อมกันสองรายการไม่มีตาข่ายที่ชั้นฐานข้อมูลรับอีกแล้ว
-- assignRole ถูกเรียกในทรานแซกชันเดียวกับการเปิดใช้งานบัญชีเสมอ ซึ่งครอบเคสที่มีจริงอยู่
DROP INDEX IF EXISTS "iam"."uq_active_org_scoped_role_assignment";

-- เติมหน่วยงาน BDI ให้ role ฝั่ง BDI/SYSTEM ที่ยังว่างอยู่
UPDATE "iam"."user_role_assignment" AS ura
   SET "organization_id" = '00000000-0000-0000-0000-0000000000b0',
       "updated_at"      = CURRENT_TIMESTAMP
  FROM "iam"."role" AS r
 WHERE r."id" = ura."role_id"
   AND r."code" NOT IN ('ORGANIZATION_USER', 'ORGANIZATION_APPROVER')
   AND ura."organization_id" IS NULL
   AND EXISTS (
     SELECT 1 FROM "organization"."organization"
      WHERE "id" = '00000000-0000-0000-0000-0000000000b0'
   );
