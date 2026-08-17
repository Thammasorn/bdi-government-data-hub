-- แบบฟอร์มลงทะเบียน metadata ตามชีท A4_dataset_metadata
--
-- dataset_registration_metadata และ dataset_metadata เปลี่ยนชุดคอลัมน์ทั้งตาราง จากฉบับ
-- assets/db_schema/draft_db_design_downloaded_on_2026-08-11.xlsx มาเป็นฉบับ 2026-08-16
-- ซึ่งเลิกใช้คอลัมน์ที่ตั้งชื่อเอง (title_th/description_th/access_level/…) แล้วเดินตาม
-- ชื่อฟิลด์ในชีท A4_dataset_metadata ของ assets/metadata_registration_form/metadata_mapping.xlsx
-- ทีละช่อง เพื่อให้ metadata ที่เก็บตรงกับมาตรฐานบัญชีข้อมูลเปิดภาครัฐและส่งต่อ DGA/DII ได้
--
-- **migration นี้ทำลายข้อมูลเดิม** 16 คอลัมน์ถูก DROP ทิ้งโดยไม่มีการ backfill: คอลัมน์ใหม่
-- ไม่ได้แค่เปลี่ยนชื่อ แต่เปลี่ยนความหมายและเปลี่ยนชุดรหัสด้วย (เช่น access_level เก็บ
-- PUBLIC/INTERNAL/CONFIDENTIAL/SECRET ส่วน data_classification เก็บ 01–05 ตาม
-- พ.ร.บ.ข้อมูลข่าวสาร และหมวดหมู่ตามธรรมาภิบาลข้อมูลถูกแยกออกมาเป็น data_category ต่างหาก)
-- การเดาค่าจากของเดิมจึงเป็นการกรอกแบบฟอร์มแทนหน่วยงาน ซึ่งเป็นเอกสารที่เขาต้องลงนาม
-- ที่ไหนที่ข้อมูลมีความหมาย ต้องให้หน่วยงานกรอกใหม่ ไม่ใช่ backfill
--
-- บน checkout ที่เป็นข้อมูลสาธิต ให้ down -v แล้ว seed ใหม่จะตรงไปตรงมากว่า

-- AlterTable
ALTER TABLE "dataset"."dataset_metadata" DROP COLUMN "access_level",
DROP COLUMN "contact_email",
DROP COLUMN "contact_name",
DROP COLUMN "contact_phone",
DROP COLUMN "contains_sensitive_data",
DROP COLUMN "coverage_end_date",
DROP COLUMN "coverage_start_date",
DROP COLUMN "data_owner_department",
DROP COLUMN "dataset_category_code",
DROP COLUMN "delivery_method",
DROP COLUMN "description_en",
DROP COLUMN "description_th",
DROP COLUMN "geographic_scope",
DROP COLUMN "title_en",
DROP COLUMN "title_th",
DROP COLUMN "update_frequency",
ADD COLUMN     "allow_aggregated_data_sharing" BOOLEAN,
ADD COLUMN     "allow_original_raw_data_retention" BOOLEAN,
ADD COLUMN     "allow_original_raw_data_sharing" BOOLEAN,
ADD COLUMN     "allow_transformed_raw_data_gdx_sharing" BOOLEAN,
ADD COLUMN     "allow_transformed_raw_data_sharing" BOOLEAN,
ADD COLUMN     "authorize_personal_data_anonymization" BOOLEAN,
ADD COLUMN     "data_category" VARCHAR(8),
ADD COLUMN     "data_classification" VARCHAR(8),
ADD COLUMN     "data_format_other" VARCHAR(150),
ADD COLUMN     "data_source" TEXT,
ADD COLUMN     "data_subject_categories" TEXT,
ADD COLUMN     "data_topic" VARCHAR(8),
ADD COLUMN     "data_topic_other" VARCHAR(150),
ADD COLUMN     "data_type" VARCHAR(8),
ADD COLUMN     "delivery_frequency" VARCHAR(8),
ADD COLUMN     "geo_coverage" VARCHAR(8),
ADD COLUMN     "license_id" VARCHAR(16),
ADD COLUMN     "maintainer" VARCHAR(150),
ADD COLUMN     "maintainer_email" VARCHAR(50),
ADD COLUMN     "name" VARCHAR(150),
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "owner_org" UUID,
ADD COLUMN     "personal_data_processing_period" VARCHAR(8),
ADD COLUMN     "personal_data_processing_period_month" INTEGER,
ADD COLUMN     "personal_data_processing_period_year" INTEGER,
ADD COLUMN     "personal_data_types" TEXT,
ADD COLUMN     "tag_string" TEXT,
ADD COLUMN     "title" VARCHAR(150),
ADD COLUMN     "update_frequency_interval" INTEGER,
ADD COLUMN     "update_frequency_unit" VARCHAR(8),
ALTER COLUMN "data_format" SET DATA TYPE VARCHAR(8);

-- AlterTable
ALTER TABLE "dataset"."dataset_registration_metadata" DROP COLUMN "access_level",
DROP COLUMN "contact_email",
DROP COLUMN "contact_name",
DROP COLUMN "contact_phone",
DROP COLUMN "contains_sensitive_data",
DROP COLUMN "coverage_end_date",
DROP COLUMN "coverage_start_date",
DROP COLUMN "data_owner_department",
DROP COLUMN "dataset_category_code",
DROP COLUMN "delivery_method",
DROP COLUMN "description_en",
DROP COLUMN "description_th",
DROP COLUMN "geographic_scope",
DROP COLUMN "title_en",
DROP COLUMN "title_th",
DROP COLUMN "update_frequency",
ADD COLUMN     "allow_aggregated_data_sharing" BOOLEAN,
ADD COLUMN     "allow_original_raw_data_retention" BOOLEAN,
ADD COLUMN     "allow_original_raw_data_sharing" BOOLEAN,
ADD COLUMN     "allow_transformed_raw_data_gdx_sharing" BOOLEAN,
ADD COLUMN     "allow_transformed_raw_data_sharing" BOOLEAN,
ADD COLUMN     "authorize_personal_data_anonymization" BOOLEAN,
ADD COLUMN     "data_category" VARCHAR(8),
ADD COLUMN     "data_classification" VARCHAR(8),
ADD COLUMN     "data_format_other" VARCHAR(150),
ADD COLUMN     "data_source" TEXT,
ADD COLUMN     "data_subject_categories" TEXT,
ADD COLUMN     "data_topic" VARCHAR(8),
ADD COLUMN     "data_topic_other" VARCHAR(150),
ADD COLUMN     "data_type" VARCHAR(8),
ADD COLUMN     "delivery_frequency" VARCHAR(8),
ADD COLUMN     "geo_coverage" VARCHAR(8),
ADD COLUMN     "license_id" VARCHAR(16),
ADD COLUMN     "maintainer" VARCHAR(150),
ADD COLUMN     "maintainer_email" VARCHAR(50),
ADD COLUMN     "name" VARCHAR(150),
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "owner_org" UUID,
ADD COLUMN     "personal_data_processing_period" VARCHAR(8),
ADD COLUMN     "personal_data_processing_period_month" INTEGER,
ADD COLUMN     "personal_data_processing_period_year" INTEGER,
ADD COLUMN     "personal_data_types" TEXT,
ADD COLUMN     "tag_string" TEXT,
ADD COLUMN     "title" VARCHAR(150),
ADD COLUMN     "update_frequency_interval" INTEGER,
ADD COLUMN     "update_frequency_unit" VARCHAR(8),
ALTER COLUMN "data_format" SET DATA TYPE VARCHAR(8);

-- AddForeignKey
ALTER TABLE "dataset"."dataset_registration_metadata" ADD CONSTRAINT "dataset_registration_metadata_owner_org_fkey" FOREIGN KEY ("owner_org") REFERENCES "organization"."organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dataset"."dataset_metadata" ADD CONSTRAINT "dataset_metadata_owner_org_fkey" FOREIGN KEY ("owner_org") REFERENCES "organization"."organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

