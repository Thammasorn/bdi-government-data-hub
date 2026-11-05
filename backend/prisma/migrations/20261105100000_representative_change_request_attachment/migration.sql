-- หนังสือนำของคำขอเปลี่ยนแปลงผู้แทน ตาม workbook — nullable เพราะร่างยังไม่มีไฟล์ได้
ALTER TABLE "organization"."representative_change_request"
  ADD COLUMN "representative_change_request_attachment_id" UUID;

ALTER TABLE "organization"."representative_change_request"
  ADD CONSTRAINT "representative_change_request_representative_change_reques_fkey"
  FOREIGN KEY ("representative_change_request_attachment_id")
  REFERENCES "attachment"."attachment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- คำขอที่อัปโหลดไว้แล้วก่อนมีคอลัมน์นี้
UPDATE "organization"."representative_change_request" r
SET "representative_change_request_attachment_id" = a."id"
FROM "attachment"."attachment" a
WHERE a."owner_type" = 'REPRESENTATIVE_CHANGE_REQUEST'
  AND a."owner_id" = r."id"
  AND a."attachment_type" = 'REPRESENTATIVE_CHANGE_REQUEST_LETTER'
  AND a."status" = 'ACTIVE';
