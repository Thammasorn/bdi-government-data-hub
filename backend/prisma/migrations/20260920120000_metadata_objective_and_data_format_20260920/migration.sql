-- ชุด metadata 2026-09-20 — การ์ด "Update Metadata and Legal document"
--
-- ข้อ 8 วัตถุประสงค์ เปลี่ยนจากข้อความอิสระ 1,000 ตัวอักษร เป็นรหัสเลือกได้หลายข้อ
-- (01–12 · 98 ไม่ทราบ · 99 อื่น ๆ) เก็บคั่นด้วย "," ในคอลัมน์เดิม และเพิ่ม objective_other (200)
-- ให้ระบุเมื่อเลือก 99 ข้อความที่หน่วยงานเคยกรอกไว้ **ไม่ทิ้ง**: ย้ายไป objective_other
-- (ตัดที่ 200 ตัวอักษร — BDI ตัดสินใจเมื่อ 2026-09-20 ว่ารับได้ เพราะยังไม่เปิดใช้จริง)
-- แล้วตั้งรหัสเป็น 99 คำขอเดิมจึงยังนำส่งได้โดยไม่ต้องกลับไปกรอกใหม่
--
-- ข้อ 12.1 รูปแบบการนำส่ง แยก "วางไฟล์" เป็น "ในพื้นที่ที่หน่วยงานกำหนด" (1) กับ "ในพื้นที่ที่
-- BDI กำหนด" (2) รหัสเดิม 2–4 จึงเลื่อนเป็น 3–5 แถวที่เคยเลือก 1 คงเป็น 1 (BDI 2026-09-20)
-- เลื่อนทั้งค่าที่คำขอเก็บไว้และแถวใน administration.dataset_choice ในทรานแซกชันเดียว —
-- ถ้าเลื่อนแค่ป้ายไม่เลื่อนรหัส คำขอเก่าจะพิมพ์ ✔ ผิดข้อบน A4 ฉบับใหม่
--
-- แถวตัวเลือกใหม่ (dataFormat 2 และ objective ทั้ง 14 รหัส) ใส่ที่นี่ด้วย ไม่รอ seed:masters
-- เพราะ production บูตด้วย `migrate deploy` อย่างเดียว created_by ใช้ SYSTEM_USER_ID
-- ตัวเดียวกับ seed (lib/system.ts) ฐานข้อมูลใหม่ที่ยังว่างก็ได้แถวเหล่านี้ไปก่อน แล้ว
-- seed:masters เติมที่เหลือ (upsert ที่ไม่ทับของเดิม)

-- AlterTable
ALTER TABLE "dataset"."dataset_metadata" ADD COLUMN "objective_other" VARCHAR(200);

-- AlterTable
ALTER TABLE "dataset"."dataset_registration_metadata" ADD COLUMN "objective_other" VARCHAR(200);

-- 8 — ข้อความเดิม → 99 อื่น ๆ + objective_other
UPDATE "dataset"."dataset_registration_metadata"
SET "objective_other" = left(btrim("objective"), 200), "objective" = '99'
WHERE "objective" IS NOT NULL AND btrim("objective") <> '';
UPDATE "dataset"."dataset_registration_metadata"
SET "objective" = NULL
WHERE "objective" IS NOT NULL AND btrim("objective") = '';

UPDATE "dataset"."dataset_metadata"
SET "objective_other" = left(btrim("objective"), 200), "objective" = '99'
WHERE "objective" IS NOT NULL AND btrim("objective") <> '';
UPDATE "dataset"."dataset_metadata"
SET "objective" = NULL
WHERE "objective" IS NOT NULL AND btrim("objective") = '';

-- 12.1 — เลื่อนรหัส 2→3 · 3→4 · 4→5 ใน CASE เดียว จะได้ไม่เลื่อนซ้อนกัน
UPDATE "dataset"."dataset_registration_metadata"
SET "data_format" = CASE "data_format" WHEN '2' THEN '3' WHEN '3' THEN '4' WHEN '4' THEN '5' END
WHERE "data_format" IN ('2', '3', '4');

UPDATE "dataset"."dataset_metadata"
SET "data_format" = CASE "data_format" WHEN '2' THEN '3' WHEN '3' THEN '4' WHEN '4' THEN '5' END
WHERE "data_format" IN ('2', '3', '4');

-- 12.1 — แถวตัวเลือก: เลื่อนจากมากไปน้อย ไม่งั้นชน unique (field_key, code)
UPDATE "administration"."dataset_choice" SET "code" = '5', "display_order" = 5, "updated_at" = now()
WHERE "field_key" = 'dataFormat' AND "code" = '4';
UPDATE "administration"."dataset_choice" SET "code" = '4', "display_order" = 4, "updated_at" = now()
WHERE "field_key" = 'dataFormat' AND "code" = '3';
UPDATE "administration"."dataset_choice" SET "code" = '3', "display_order" = 3, "updated_at" = now()
WHERE "field_key" = 'dataFormat' AND "code" = '2';
UPDATE "administration"."dataset_choice" SET "label_th" = 'วางไฟล์ในพื้นที่ที่หน่วยงานกำหนด', "updated_at" = now()
WHERE "field_key" = 'dataFormat' AND "code" = '1';

INSERT INTO "administration"."dataset_choice"
  ("id", "field_key", "code", "label_th", "display_order", "is_active", "created_at", "created_by", "updated_at", "updated_by")
VALUES
  (gen_random_uuid(), 'dataFormat', '2', 'วางไฟล์ในพื้นที่ที่ BDI กำหนด', 2, true, now(),
   '00000000-0000-0000-0000-000000000001', now(), '00000000-0000-0000-0000-000000000001')
ON CONFLICT ("field_key", "code") DO NOTHING;

-- 8 — แถวตัวเลือกวัตถุประสงค์ ตามตารางในการ์ด 2026-09-20
INSERT INTO "administration"."dataset_choice"
  ("id", "field_key", "code", "label_th", "display_order", "is_active", "created_at", "created_by", "updated_at", "updated_by")
SELECT gen_random_uuid(), 'objective', v.code, v.label_th, v.ord, true, now(),
       '00000000-0000-0000-0000-000000000001', now(), '00000000-0000-0000-0000-000000000001'
FROM (VALUES
  ('01', 'ยุทธศาสตร์ชาติ', 1),
  ('02', 'แผนพัฒนาเศรษฐกิจและสังคมแห่งชาติ', 2),
  ('03', 'แผนความมั่นคงแห่งชาติ', 3),
  ('04', 'แผนแม่บทภายใต้ยุทธศาสตร์ชาติ', 4),
  ('05', 'แผนปฏิรูปประเทศ', 5),
  ('06', 'แผนระดับที่ 3 (มติ ครม. 4 ธ.ค. 2560)', 6),
  ('07', 'นโยบายรัฐบาล/ข้อสั่งการนายกรัฐมนตรี', 7),
  ('08', 'มติคณะรัฐมนตรี', 8),
  ('09', 'เพื่อการให้บริการประชาชน', 9),
  ('10', 'กฎหมายที่เกี่ยวข้อง', 10),
  ('11', 'พันธกิจหน่วยงาน', 11),
  ('12', 'ดัชนี/ตัวชี้วัดระดับนานาชาติ', 12),
  ('98', 'ไม่ทราบ', 13),
  ('99', 'อื่น ๆ', 14)
) AS v(code, label_th, ord)
ON CONFLICT ("field_key", "code") DO NOTHING;
