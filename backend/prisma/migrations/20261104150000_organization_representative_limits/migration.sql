-- จำนวนผู้แทนสูงสุดของหน่วยงานที่ ACTIVE แล้ว ผู้ดูแลระบบตั้งต่อหน่วยงานได้
-- ก่อน ACTIVE ใช้ 1/1 เสมอ — ดู `roleSeatLimit()` ใน lib/iam.ts
ALTER TABLE "organization"."organization"
    ADD COLUMN "max_organization_user_count" INTEGER NOT NULL DEFAULT 3,
    ADD COLUMN "max_organization_approver_count" INTEGER NOT NULL DEFAULT 1;
