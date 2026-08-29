-- ที่อยู่หน่วยงานกว้าง 500 ไม่พอสำหรับที่อยู่ราชการเต็มรูปแบบ
--
-- ฟอร์มลงทะเบียนจำกัดไว้ที่ 300 ตัวอักษร (แคบกว่าคอลัมน์เสียอีก) ทั้งที่ที่อยู่จริง
-- ของหน่วยงานราชการมักมีทั้งชื่ออาคาร ชั้น เลขห้อง ซอย และวงเล็บอธิบายทางเข้า
-- ขยายทั้งสองฝั่งเป็น 2000 พร้อมกัน — snapshot ของคำขอต้องเก็บสิ่งที่ master เก็บได้
--
-- การขยาย VARCHAR ใน Postgres ไม่ rewrite ตาราง (ALTER TABLE SET DATA TYPE ที่ขยาย
-- ความยาวอย่างเดียวเป็น metadata-only ตั้งแต่ 9.2) จึงไม่ล็อกยาวแม้ตารางโต
ALTER TABLE "organization"."organization"
  ALTER COLUMN "address_line" TYPE VARCHAR(2000);

ALTER TABLE "organization"."organization_registration_request"
  ALTER COLUMN "organization_address_line" TYPE VARCHAR(2000);
