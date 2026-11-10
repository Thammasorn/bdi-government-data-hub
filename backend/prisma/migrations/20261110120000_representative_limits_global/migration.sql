-- จำนวนผู้แทนสูงสุดย้ายไปเป็นค่าตั้งระบบ (administration.system_setting: organization_max_coordinators / organization_max_approvers)
-- ไม่มีแถว = ค่าเริ่มต้น 3 และ 1 ซึ่งเท่ากับค่าเริ่มต้นของสองคอลัมน์นี้
ALTER TABLE "organization"."organization" DROP COLUMN "max_organization_user_count",
  DROP COLUMN "max_organization_approver_count";
