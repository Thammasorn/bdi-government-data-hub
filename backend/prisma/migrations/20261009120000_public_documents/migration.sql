-- เอกสารดาวน์โหลดบนหน้าแรก — ย้ายจาก frontend/components/landing/content.ts มาเป็นแถวที่ผู้ดูแลระบบแก้ได้ (การ์ด Admin Console 2026-10-09)
ALTER TYPE "attachment"."AttachmentOwnerType" ADD VALUE 'PUBLIC_DOCUMENT';
ALTER TYPE "attachment"."AttachmentType" ADD VALUE 'PUBLIC_DOCUMENT_FILE';

CREATE TABLE "administration"."public_document" (
    "id" UUID NOT NULL,
    "section" VARCHAR(32) NOT NULL,
    "code" VARCHAR(16),
    "title" VARCHAR(500) NOT NULL,
    "version_label" VARCHAR(100),
    "static_path" VARCHAR(500),
    "display_order" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "public_document_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "public_document_section_is_active_display_order_idx"
    ON "administration"."public_document"("section", "is_active", "display_order");

-- หกรายการที่หน้าแรกแสดงอยู่วันนี้ ชี้ไฟล์เดิมใน frontend/public/documents จนกว่าผู้ดูแลจะอัปโหลดฉบับใหม่ (static_path)
-- ผู้สร้างคือบัญชี SYSTEM (lib/system.ts SYSTEM_USER_ID) — ไม่มีคนสั่ง เป็นการย้ายข้อมูล
INSERT INTO "administration"."public_document"
    ("id", "section", "code", "title", "version_label", "static_path", "display_order", "created_by", "updated_at", "updated_by")
VALUES
    (gen_random_uuid(), 'REGULATION', NULL,
     'ระเบียบสำนักนายกรัฐมนตรีว่าด้วยการแบ่งปันข้อมูลดิจิทัล พ.ศ. 2569', NULL,
     '/documents/ระเบียบสำนักนายก Data sharing.pdf', 1,
     '00000000-0000-0000-0000-000000000001', CURRENT_TIMESTAMP, '00000000-0000-0000-0000-000000000001'),
    (gen_random_uuid(), 'REGULATION', NULL,
     'ประกาศสถาบันข้อมูลขนาดใหญ่ (องค์การมหาชน) เรื่อง รายการชุดข้อมูลดิจิทัล ด้านการจัดการภัยพิบัติและสถานการณ์ฉุกเฉิน', NULL,
     '/documents/ประกาศสถาบันฯ - รายการชุดข้อมูลดิจิทัลด้านการจัดการภัยพิบัติและสถานการณ์ฉุกเฉิน.pdf', 2,
     '00000000-0000-0000-0000-000000000001', CURRENT_TIMESTAMP, '00000000-0000-0000-0000-000000000001'),
    (gen_random_uuid(), 'PRIMARY', 'A0',
     'ข้อตกลงหลักในการบริหารจัดการและแบ่งปันข้อมูล', 'ฉบับที่ 1 · 5 ต.ค. 2569',
     '/documents/A[0] ข้อตกลง_version_01_25691005.pdf', 1,
     '00000000-0000-0000-0000-000000000001', CURRENT_TIMESTAMP, '00000000-0000-0000-0000-000000000001'),
    (gen_random_uuid(), 'ANNEX', 'A1',
     'ผนวก 1 ข้อตกลงรักษาความลับ (Non-Disclosure Agreement)', 'ฉบับที่ 1 · 5 ต.ค. 2569',
     '/documents/A[1] ผนวก_1_NDA_version_01_25691005.pdf', 1,
     '00000000-0000-0000-0000-000000000001', CURRENT_TIMESTAMP, '00000000-0000-0000-0000-000000000001'),
    (gen_random_uuid(), 'ANNEX', 'A2',
     'ผนวก 2 ข้อตกลงในการประมวลผลข้อมูล (Data Processing Agreement)', 'ฉบับที่ 1 · 5 ต.ค. 2569',
     '/documents/A[2] ผนวก_2_DPA_version_01_25691005.pdf', 2,
     '00000000-0000-0000-0000-000000000001', CURRENT_TIMESTAMP, '00000000-0000-0000-0000-000000000001'),
    (gen_random_uuid(), 'ANNEX', 'A3',
     'ผนวก 3 ข้อตกลงประมวลผลข้อมูลส่วนบุคคล (Personal Data Processing Agreement)', 'ฉบับที่ 1 · 5 ต.ค. 2569',
     '/documents/A[3] ผนวก_3_PDPA_version_01_25691005.pdf', 3,
     '00000000-0000-0000-0000-000000000001', CURRENT_TIMESTAMP, '00000000-0000-0000-0000-000000000001');
