-- ลิงก์ตั้งรหัสผ่านใหม่ที่ผู้ดูแลระบบสั่งออกให้ (การ์ด "API ให้ system admin reset password ให้ user" 2026-09-18)
--
-- ก่อนหน้านี้คนที่ลืมรหัสผ่านไม่มีทางกลับเข้าระบบเลย: การเปิดใช้งานบัญชีเป็นทางเดียวที่ตั้ง
-- รหัสผ่านได้ และ activation key ใบเดิมถูกเผาไปแล้ว (`docs/09-auth-tokens.md` §2)
-- ทางเลือกคือ ThaID ซึ่งใช้ได้เฉพาะเครื่องที่มีแอป
--
-- เป็นตารางของตัวเอง ไม่ยืมของที่มีอยู่:
--   activation_key  บังคับ organization_id + role_id (NOT NULL) — การรีเซ็ตรหัสผ่านไม่มีสองอย่างนั้น
--   otp_code        hash เป็น bcrypt (salt ต่างกันทุกครั้ง) ค้นด้วยโทเคนในลิงก์ตรง ๆ ไม่ได้
--                   และผูกกับอีเมล ไม่ใช่บัญชี
--
-- token_hash คือ HMAC-SHA-256 ด้วย ACTIVATION_KEY_SECRET เหมือน activation key ด้วยเหตุผลเดียวกัน
-- ค่าดิบอยู่ในอีเมลฉบับเดียวและไม่เคยถูกเขียนลงฐานข้อมูล
--
-- ไม่มี status enum: ใช้ได้ = used_at IS NULL AND revoked_at IS NULL AND expires_at > now()
-- สามคอลัมน์บอกได้ครบว่าใบนี้จบด้วยอะไร (ใช้แล้ว / ถูกใบใหม่แทน / หมดอายุ) โดยไม่ต้อง
-- มีงานเก็บกวาดมาเปลี่ยนสถานะเมื่อเลยเวลา

CREATE TABLE "iam"."password_reset_token" (
  "id"              UUID          NOT NULL,
  "user_account_id" UUID          NOT NULL,
  "token_hash"      VARCHAR(64)   NOT NULL,
  "issued_at"       TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at"      TIMESTAMPTZ(6) NOT NULL,
  "used_at"         TIMESTAMPTZ(6),
  "revoked_at"      TIMESTAMPTZ(6),
  "requested_via"   VARCHAR(32)   NOT NULL,
  "created_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by"      UUID          NOT NULL,

  CONSTRAINT "password_reset_token_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "password_reset_token_token_hash_key"
  ON "iam"."password_reset_token" ("token_hash");

-- ใบที่ยังใช้ได้ของบัญชีหนึ่ง — เส้นทางของ "ออกใบใหม่แล้วยกเลิกใบเก่า"
CREATE INDEX "password_reset_token_user_account_id_used_at_revoked_at_idx"
  ON "iam"."password_reset_token" ("user_account_id", "used_at", "revoked_at");

ALTER TABLE "iam"."password_reset_token"
  ADD CONSTRAINT "password_reset_token_user_account_id_fkey"
  FOREIGN KEY ("user_account_id") REFERENCES "iam"."user_account" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
