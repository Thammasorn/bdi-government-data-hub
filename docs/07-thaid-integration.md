# การเชื่อมต่อ ThaiD — ออกแบบ ตั้งค่า และผล SIT

การ์ด Notion: **ThaiD Integration** (Task Board, 2026-08-13)
คู่มือและ credentials ของกรมการปกครองอยู่ใน `assets/thaid/` (นอก git)

---

## 1. สิ่งที่เปลี่ยนไปจากของเดิม

| | ก่อนหน้านี้ | ตอนนี้ |
|---|---|---|
| เปิดใช้งานบัญชี | `/register` กรอกประวัติ + ตั้งรหัสผ่าน → OTP ทางอีเมล | `/activate` → **ThaiD** → เทียบเลขบัตร → ตั้งรหัสผ่าน |
| ที่มาของเลขบัตร | ผู้ใช้พิมพ์เองตอนลงทะเบียน | เจ้าหน้าที่บันทึกตอนสร้างบัญชี (`POST /api/admin/invitations` บังคับ `cid`) |
| เข้าสู่ระบบ | อีเมล + รหัสผ่าน (ขั้นเดียว) | รหัสผ่าน **+ OTP ทางอีเมล** หรือ **ThaiD** |
| ThaiD | `POST /api/auth/thaid/verify` โหมดจำลองอย่างเดียว | OAuth 2.0 code flow จริงกับ `imauthsbx.bora.dopa.go.th` |

เหตุผลที่ย้ายเลขบัตรไปอยู่ฝั่งเจ้าหน้าที่: §2.4 ของการ์ดให้เทียบเลขจาก ThaiD กับ
"CID ที่ถูกบันทึกไว้ในระบบตอนสร้างบัญชี" ถ้าผู้ใช้เป็นคนกรอกเอง การเทียบก็ไม่ได้พิสูจน์อะไร
เพราะเขากรอกเลขของบัตรที่ถืออยู่ในมือได้เสมอ

## 2. ลำดับการทำงาน

```
เจ้าหน้าที่  POST /api/admin/invitations {email, role, cid}
             └─ user_account (PENDING, cid) + activation_key (ISSUED, 7 วัน) + อีเมล

ผู้ใช้       เปิดลิงก์  /activate?token=<key>        ← จากอีเมล
             หรือ      /activate  แล้วกรอก key เอง   ← จากหน้า login
                │
                ├─ GET  /api/auth/invitation      ตรวจคีย์ (หมดอายุ/ถูกใช้/ถูกยกเลิก)
                ├─ POST /api/auth/thaid/start     → integration_operation (PENDING) + authorize URL
                │        เบราว์เซอร์ออกไป https://imauthsbx.bora.dopa.go.th/api/v2/oauth2/auth/
                ├─ ThaiD redirect กลับ /auth/callback/thaid?code=&state=
                ├─ POST /api/auth/thaid/callback  แลก token → ตรวจลายเซ็น id_token → อ่าน pid
                │        pid == user_account.cid ?
                │          ไม่ตรง → activation_key = REVOKED, audit FAILURE, ตอบ 403
                │          ตรง   → integration_operation = SUCCEEDED (ใบเสร็จ อายุ 30 นาที)
                └─ POST /api/auth/activate        ตั้งรหัสผ่าน → ACTIVE + role + key USED → session
```

เข้าสู่ระบบด้วย ThaiD ใช้เส้นทางเดียวกัน ต่างที่ `purpose: "login"` และจับคู่บัญชีจาก `pid`
กับ `user_account.cid` ของบัญชีที่ `ACTIVE` แล้ว

**สถานะหน่วยงานไม่ถูกแตะที่ขั้นนี้** — การ์ด §2.5 เขียนว่าให้ปรับเป็น `ACTIVE`
แต่ §1.1 และ Journey B ที่ทำไว้แล้วบอกว่าหน่วยงาน `ACTIVE` เมื่อคำขอจดทะเบียนผ่าน
`BDI_FINAL_APPROVAL` เท่านั้น ถามแล้วและตัดสินให้ยึด Journey B (2026-08-13)

## 3. ที่เก็บสถานะระหว่างทาง

ไม่มีตารางใหม่ ทั้ง `state` ของ OAuth และใบเสร็จ "ยืนยันตัวตนผ่านแล้ว" อยู่ใน
`integration.integration_operation` ซึ่ง sheet ระบุ `THAID → VERIFY_IDENTITY` ไว้อยู่แล้ว

| คอลัมน์ | ค่าที่ใช้ |
|---|---|
| `operation` | `VERIFY_IDENTITY` (เปิดใช้งานบัญชี) · `AUTHENTICATE` (เข้าสู่ระบบ) |
| `subject_type` / `subject_id` | `USER_ACTIVATION_KEY` + id ของแถว activation_key · `THAID_LOGIN` + UUID สุ่ม |
| `idempotency_key` | `thaid:<state>` — unique จึงกันการยิง code ซ้ำได้ที่ชั้นฐานข้อมูล |
| `external_reference` | `sub` จาก id_token (ลง `user_account.external_subject` ตอนสร้างบัญชี) |
| `status` | `PENDING` → `PROCESSING` (จอง state) → `SUCCEEDED` / `FAILED` |

จงใจไม่เก็บ: raw activation key (callback กลับเข้าเรื่องเดิมด้วย `subject_id`) และเลขบัตรจาก
ThaiD (ใช้เทียบแล้วทิ้ง audit เก็บแค่ `sub`)

## 4. ตั้งค่า

```bash
THAID_ROOT_URL=https://imauthsbx.bora.dopa.go.th
THAID_CLIENT_ID=…
THAID_CLIENT_SECRET=…
THAID_API_KEY=                 # ปล่อยว่างได้ ส่งเป็น x-api-key เมื่อมีค่า
THAID_REDIRECT_URI=            # ว่าง = ${APP_URL}/auth/callback/thaid
THAID_SCOPE=                   # ว่าง = openid pid title given_name middle_name family_name name …
THAID_MOCK=false               # true = ข้าม ThaiD และถือว่าเลขบัตรตรงเสมอ (เครื่อง dev เท่านั้น)
```

`redirect_uri` ต้องตรงตัวอักษรกับที่ลงทะเบียนไว้กับกรมการปกครอง ไม่งั้นได้
`invalid_request — The redirect or callback url mismatch` ตั้งแต่ขั้น authorize

### ข้อจำกัดของ credentials ชุดที่ลงทะเบียนไว้ (ยังไม่ได้แก้ ต้องคุยกับกรมการปกครอง)

ทดลองยิงจริงกับ sandbox เมื่อ 2026-08-13 พบว่า client ของโครงการใน `assets/thaid/env_dev.txt`

- **ไม่ได้รับ scope `pid`** — ขอแล้วได้ `invalid_scope` ตั้งแต่ authorize ได้เฉพาะ
  `openid given_name family_name given_name_en family_name_en` ตามที่ไฟล์เขียนไว้
  ไม่มี `pid` = ไม่มีเลขบัตรให้เทียบ = ทำตาม §2.4 ไม่ได้เลย
- **ผูก redirect_uri ไว้กับ `http://localhost:3000/auth/callback/thaid`** พอร์ตอื่นถูกปฏิเสธ
  ซึ่งเป็นพอร์ตของ checkout `main` ไม่ใช่ของ dev checkout ไหน

จึงพัฒนาและทำ SIT ด้วย **client ตัวอย่างของ sandbox** (`assets/thaid/thaid sandbox.postman_environment.json`)
ซึ่งรับ `redirect_uri` อะไรก็ได้และให้ scope ครบรวม `pid`
ทั้งสองข้อเป็นเรื่องการลงทะเบียนฝั่งกรมการปกครอง ไม่ใช่เรื่องโค้ด

## 5. ผล SIT (2026-08-13)

ยิงกับ sandbox จริง ไม่ได้เปิด `THAID_MOCK`
checkout `dev/dev_20260813_thaid-integration` (frontend 3160 / backend 4160)
ภาพหน้าจอ: `sit-evidence/thaid-20260813/shots/` (นอก git) · สคริปต์: `sit-thaid.mjs` ในโฟลเดอร์เดียวกัน

| # | กรณี | ผล | หลักฐาน |
|---|---|---|---|
| 1 | เปิดใช้งานบัญชี เลขบัตรตรง | ผ่าน — `user_account.status=ACTIVE`, `activation_key.status=USED`, มี `external_subject` | `01`–`05` |
| 2 | เข้าสู่ระบบ รหัสผ่าน + OTP | ผ่าน — ขั้นแรกตอบ 202 ไม่ออก session, OTP จากอีเมลผ่านแล้วจึงเข้าได้ | `06`–`08` |
| 3 | เข้าสู่ระบบด้วย ThaiD | ผ่าน — จับคู่บัญชีจาก `pid` แล้วออก session | `09`–`10` |
| 4 | เลขบัตรไม่ตรง | ผ่าน — 403, `activation_key=REVOKED`, บัญชียัง `PENDING`, audit `IDENTITY_VERIFICATION_FAILED / FAILURE / CID_MISMATCH`, `integration_operation=FAILED (cid_mismatch)` และลิงก์เดิมใช้ต่อไม่ได้ | `11`–`13` |
| 5 | เข้าจากหน้า login แล้วกรอก Activation Key | ผ่าน — เข้าหน้ายืนยันตัวตนด้วย ThaiD เหมือนกดจากอีเมล | `14`–`15` |

กรณีที่ 1 ยังตรวจเพิ่มว่า `organization.status` ยังเป็น `PENDING_REGISTRATION` หลังเปิดใช้งานบัญชี
ตามที่ตัดสินไว้ในข้อ 2

### วิธีรันซ้ำ

```bash
mkdir -p /tmp/sit-chrome-nat/profile
TMPDIR=/tmp/sit-chrome-nat google-chrome --headless --disable-gpu --no-sandbox \
  --disable-crash-reporter --remote-debugging-port=9224 \
  --user-data-dir=/tmp/sit-chrome-nat/profile about:blank &

cd /hdd1tb/bdi-project/sit-evidence/thaid-20260813
npm install --no-save --cache "$PWD/.npm-cache" playwright-core   # ครั้งแรกครั้งเดียว
node sit-thaid.mjs
```

สองเรื่องที่เสียเวลาไปแล้ว และเขียนไว้ในหัวสคริปต์ด้วย:

- WAF ของ `bora.dopa.go.th` **บล็อก user agent ที่มีคำว่า `HeadlessChrome`** ตอบหน้า
  "Web Page Blocked!" แทนที่จะ redirect — ต้อง override user agent เป็น Chrome ปกติ
- หน้า sandbox poll รอสแกน QR ตลอดเวลา `waitUntil: "networkidle"` จึงไม่มีวันจบ

## 6. ยังค้าง

- [ ] ขอ scope `pid` และ redirect URI ของ deployment จริงจากกรมการปกครอง (ดูข้อ 4)
- [ ] บัญชีที่ seed ไว้ก่อนหน้านี้บางบัญชี (เจ้าหน้าที่ BDI ใน `seed:demo`) ไม่มี `cid`
      จึงเปิดใช้งานผ่าน ThaiD ไม่ได้ — endpoint ตอบ 409 `cid_missing` พร้อมบอกให้ติดต่อเจ้าหน้าที่
      ถ้าจะสาธิตด้วยบัญชีเหล่านั้นต้องเติม `cid` ให้ก่อน
- [ ] `main` ใช้ `THAID_MOCK` ต่อไปจนกว่า redirect URI ของโดเมนจริงจะลงทะเบียนเสร็จ
