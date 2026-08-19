-- คำขอหนึ่งใบต้องเก็บเอกสารที่ระบบสร้างได้หลายฉบับ
--
-- เอกสารกฎหมายฉบับไหนก็มี placeholder ได้ ไม่ใช่แค่ A0 ฉบับที่มีต้องถูก render ด้วยข้อมูล
-- ของคำขอนั้นแล้วเก็บแยกกัน แต่ uq_active_attachment_per_slot เดิมยอมให้มี ACTIVE
-- ได้แถวเดียวต่อ (owner_type, owner_id, attachment_type) คำขอจึงเก็บ GENERATED_FORM
-- ได้ฉบับเดียว
ALTER TABLE "attachment"."attachment"
    ADD COLUMN "legal_document_version_id" UUID;

CREATE INDEX "attachment_owner_id_legal_document_version_id_idx"
    ON "attachment"."attachment" ("owner_id", "legal_document_version_id");

DROP INDEX "attachment"."uq_active_attachment_per_slot";

-- COALESCE ไม่ใช่คอลัมน์เปล่า ๆ โดยตั้งใจ
--
-- Postgres นับ NULL ว่าไม่ซ้ำกัน ถ้าใส่คอลัมน์ตรง ๆ ไฟล์ที่ไม่ได้มาจาก template
-- (คำสั่งแต่งตั้ง หนังสือมอบอำนาจ ซึ่ง legal_document_version_id เป็น NULL) จะมี ACTIVE
-- ได้หลายแถวต่อ slot ทันที — เป็นการคลายกฎเดิมที่ sheet `attachment` กำหนดไว้ว่า
-- "จำกัดให้มี Active Attachment ได้หนึ่งรายการต่อ attachment slot" โดยไม่ได้ตั้งใจ
-- ยุบ NULL ให้เป็นค่าเดียวกันจึงรักษากฎเดิมไว้ครบ และเพิ่มได้แค่ "หนึ่งฉบับต่อหนึ่งเวอร์ชันเอกสาร"
CREATE UNIQUE INDEX "uq_active_attachment_per_slot"
    ON "attachment"."attachment" (
        "owner_type",
        "owner_id",
        "attachment_type",
        COALESCE("legal_document_version_id", '00000000-0000-0000-0000-000000000000'::uuid)
    )
    WHERE "status" = 'ACTIVE';
