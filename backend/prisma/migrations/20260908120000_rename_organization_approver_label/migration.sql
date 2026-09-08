-- เปลี่ยนชื่อไทยของบทบาท ORGANIZATION_APPROVER จาก "ผู้มีอำนาจอนุมัติของหน่วยงาน"
-- เป็น "ผู้มีอำนาจกระทำการแทนของหน่วยงาน"
--
-- ค่านี้อยู่ใน ROLE_DEFINITIONS (lib/system.ts) ด้วย แต่ seed:masters ทำงานแค่ตอนตั้งฐานใหม่
-- ฐานที่ seed ไปแล้วจึงยังค้างชื่อเดิม และชื่อนี้ผู้ใช้เห็นจริง — หน้าจัดการผู้ใช้ของผู้ดูแลระบบ
-- อ่าน iam.role.name_th ตรง ๆ (routes/admin.ts, routes/admin-users.ts, lib/iam.ts)
--
-- name_en ไม่เปลี่ยน การ์ดสั่งเฉพาะข้อความภาษาไทย
UPDATE "iam"."role"
SET "name_th" = 'ผู้มีอำนาจกระทำการแทนของหน่วยงาน',
    "updated_at" = now()
WHERE "code" = 'ORGANIZATION_APPROVER';
