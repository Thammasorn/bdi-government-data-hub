-- อีเมลของบัญชีและของผู้มีอำนาจฯ ใน snapshot คำขอ ให้เป็นตัวพิมพ์เล็กย้อนหลัง
--
-- `user_account.email` เป็น unique แบบ case-sensitive และทุกทางที่**ค้น**บัญชีด้วยอีเมลค้นด้วย
-- ค่าที่ `emailSchema` แปลงเป็นตัวพิมพ์เล็กแล้ว (ล็อกอิน · approverConflict() ตอนนำส่ง ·
-- recallRefusal()) แต่ร่างคำขอ (PATCH /:id) เคยเก็บอีเมลตามที่พิมพ์ และ ensureApproverAccount()
-- สร้างบัญชีผู้มีอำนาจฯ จากค่านั้นตรง ๆ ผลบน production 2026-09-18: บัญชี
-- "Pattarasaya.kr+org_approver@…" ล็อกอินด้วยรหัสผ่านไม่ได้ และตอนหน่วยงานนำส่งคำขอใบเดิมซ้ำ
-- ระบบค้นบัญชีจากอีเมลตัวพิมพ์เล็กไม่เจอ จึงนับว่าที่นั่งผู้มีอำนาจฯ เป็นของ "คนอื่น"
-- (การ์ด "BUG ส่งชื่อ approver ไม่ได้")
--
-- โค้ดเขียนตัวพิมพ์เล็กเสมอตั้งแต่ migration นี้ (draftEmailSchema) ตรงนี้เก็บแถวที่เกิดก่อนหน้า
--
-- ข้ามบัญชีที่ตัวพิมพ์เล็กของมันชนกับบัญชีอื่นที่มีอยู่แล้ว — สองบัญชีที่ต่างกันแค่ตัวพิมพ์
-- เป็นข้อมูลที่ต้องให้คนตัดสิน ไม่ใช่ให้ migration ล้มทั้งชุดหรือรวมเงียบ ๆ; รันซ้ำได้

UPDATE "iam"."user_account" AS u
SET "email" = lower(u."email")
WHERE u."email" <> lower(u."email")
  AND NOT EXISTS (
    SELECT 1 FROM "iam"."user_account" AS o
    WHERE o."email" = lower(u."email") AND o."id" <> u."id"
  );

UPDATE "organization"."organization_registration_request"
SET "approver_email" = lower("approver_email")
WHERE "approver_email" IS NOT NULL AND "approver_email" <> lower("approver_email");
