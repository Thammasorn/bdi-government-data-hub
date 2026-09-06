-- ชื่อสั้นที่ผู้ใช้เห็นแทนรหัส A0–A4 และคำเตือนต่อเอกสารหนึ่งฉบับ
--
-- shortname เป็น nullable ทั้งที่การ์ดขอให้ required เพราะค่าที่การ์ดให้มาเองบอกว่า A4
-- เป็น null — required กับ null พร้อมกันไม่ได้ ดูคอมเมนต์ที่ schema.prisma
--
-- unique index ไม่นับ NULL ใน Postgres ฉบับที่ไม่มีชื่อสั้นจึงมีได้มากกว่าหนึ่งฉบับ
ALTER TABLE "legal"."legal_document" ADD COLUMN "shortname" VARCHAR(200);
ALTER TABLE "legal"."legal_document" ADD COLUMN "legal_notice" TEXT;

CREATE UNIQUE INDEX "legal_document_shortname_key" ON "legal"."legal_document"("shortname");
