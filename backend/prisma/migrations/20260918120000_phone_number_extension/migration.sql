-- เลขต่อของเบอร์โทรศัพท์ (การ์ด "Field เบอร์โทร ให้เพิ่ม ต่อ-1232 ของเบอร์โทรศัพท์" 2026-09-18)
--
-- เบอร์ราชการส่วนใหญ่เป็นเบอร์กลางที่ต้องกดต่อ (02-141-1444 ต่อ 1232) แต่ทุกช่องเบอร์ในระบบ
-- รับได้แค่ตัวเลข 9–10 หลักตามกฎเบอร์ไทย คนกรอกจึงต้องเลือกระหว่างทิ้งเลขต่อ หรือยัดลงไปแล้ว
-- ฟอร์มปฏิเสธ — ทางออกคือช่องแยกข้างเบอร์ ตัวเลขล้วน ว่างได้ (ไม่มีเลขต่อคือเรื่องปกติ)
--
-- เบอร์มีอยู่ห้าคอลัมน์ในสามตาราง เลขต่อจึงมีห้าคอลัมน์ตามกัน ตั้งชื่อด้วยการต่อท้าย
-- คอลัมน์เบอร์ที่มันเป็นของ: user_account.phone_number -> phone_number_extension ฯลฯ
-- คอลัมน์ snapshot ในคำขอลงทะเบียนตามไปด้วยครบ เพราะตอนอนุมัติขั้นสุดท้ายค่าจะถูกคัดลอก
-- ลง master (organization) และลงบัญชีของผู้มีอำนาจ (ensureApproverAccount) — เก็บเบอร์
-- โดยไม่เก็บเลขต่อไว้ข้าง ๆ เท่ากับทำเลขต่อหล่นหายระหว่างทาง
--
-- ทั้งหมด nullable ไม่มี backfill: แถวที่มีอยู่ไม่เคยเก็บเลขต่อไว้ที่ไหนให้ย้ายมา

ALTER TABLE "iam"."user_account"
  ADD COLUMN "phone_number_extension" VARCHAR(16);

ALTER TABLE "organization"."organization"
  ADD COLUMN "phone_extension" VARCHAR(16);

ALTER TABLE "organization"."organization_registration_request"
  ADD COLUMN "organization_phone_extension" VARCHAR(16),
  ADD COLUMN "approver_phone_number_extension" VARCHAR(16),
  ADD COLUMN "user_phone_number_extension" VARCHAR(16);
