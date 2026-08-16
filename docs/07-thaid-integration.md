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
THAID_REQUIRE_CID_MATCH=true   # false = ยอมเปิดใช้งานบัญชีทั้งที่ไม่มี pid ให้เทียบ (ดูข้อ 4.2)
THAID_MOCK=false               # true = ข้าม ThaiD และถือว่าเลขบัตรตรงเสมอ (เครื่อง dev เท่านั้น)
```

`redirect_uri` ต้องตรงตัวอักษรกับที่ลงทะเบียนไว้กับกรมการปกครอง ไม่งั้นได้
`invalid_request — The redirect or callback url mismatch` ตั้งแต่ขั้น authorize

### 4.1 ข้อจำกัดของ credentials ชุดที่ลงทะเบียนไว้ (ยังไม่ได้แก้ ต้องคุยกับกรมการปกครอง)

ทดลองยิงจริงกับ sandbox เมื่อ 2026-08-13 พบว่า client ของโครงการใน `assets/thaid/env_dev.txt`

- **ไม่ได้รับ scope `pid`** — ขอแล้วได้ `invalid_scope` ตั้งแต่ authorize ได้เฉพาะ
  `openid given_name family_name given_name_en family_name_en` ตามที่ไฟล์เขียนไว้
  ไม่มี `pid` = ไม่มีเลขบัตรให้เทียบ = ทำตาม §2.4 ไม่ได้เลย
- **ผูก redirect_uri ไว้กับ `http://localhost:3000/auth/callback/thaid`** พอร์ตอื่นถูกปฏิเสธ
  ซึ่งเป็นพอร์ตของ checkout `main` ไม่ใช่ของ dev checkout ไหน

จึงพัฒนาและทำ SIT ด้วย **client ตัวอย่างของ sandbox** (`assets/thaid/thaid sandbox.postman_environment.json`)
ซึ่งรับ `redirect_uri` อะไรก็ได้และให้ scope ครบรวม `pid`
ทั้งสองข้อเป็นเรื่องการลงทะเบียนฝั่งกรมการปกครอง ไม่ใช่เรื่องโค้ด

ยิงซ้ำด้วย client ของโครงการอีกครั้งเมื่อ **2026-08-16** — ยังเหมือนเดิมทุกข้อ:

| scope ที่ขอ | ผลจาก `/api/v2/oauth2/auth/` |
|---|---|
| `openid` | 302 ไปหน้า QR ✅ |
| `openid given_name family_name given_name_en family_name_en` | 302 ไปหน้า QR ✅ |
| `pid` · `openid pid` · `openid pid name` | 400 `invalid_scope` ❌ |

ยืนยันด้วยว่า `redirect_uri=http://localhost:3000/auth/callback/thaid` ผ่าน ไม่ถูกปฏิเสธ

### 4.2 โหมดที่ไม่เทียบเลขบัตร (`THAID_REQUIRE_CID_MATCH=false`)

ผลของข้อ 4.1 คือ deployment ที่ใช้ client ของโครงการจะได้ `pid_missing` ทุกครั้ง
เปิดใช้งานบัญชีไม่ได้เลย ตัดสินใจเมื่อ 2026-08-16 ให้มีสวิตช์ปิดการเทียบ เพื่อให้เดโมด้วย
credentials จริงได้ระหว่างรอกรมการปกครอง

ตั้ง `false` แล้วเปลี่ยนไปดังนี้

| | `true` (ค่าตั้งต้น ตาม §2.4) | `false` |
|---|---|---|
| `/thaid/start` กับบัญชีที่ไม่มี `cid` | 409 `cid_missing` | ผ่าน |
| callback ที่ไม่มี claim `pid` | 502 `pid_missing` | ผ่าน บันทึก `cid_verified: false` |
| callback ที่มี `pid` แต่ไม่ตรง | 403 + คีย์ `REVOKED` | **เหมือนกัน** |
| เข้าสู่ระบบด้วย ThaiD | จับคู่บัญชีจาก `cid` | จับคู่จาก `external_subject` (`sub`) |

สองอย่างที่ต้องรู้

1. **การยืนยันตัวตนอ่อนลงจริง ไม่ใช่แค่ในทางเทคนิค** — มันพิสูจน์ว่าผู้ใช้ยืนยันกับ ThaiD ได้
   แต่ไม่ได้พิสูจน์ว่าเป็นเจ้าของบัตรใบที่เจ้าหน้าที่บันทึกไว้ ใครก็ตามที่ได้ลิงก์เปิดใช้งานไป
   และมีบัญชี ThaiD ของตัวเอง จะเปิดใช้งานบัญชีนั้นได้ ความปลอดภัยจึงเหลือแค่ "ลิงก์ในอีเมล
   ถึงมือคนที่ถูกต้อง" เท่ากับระบบก่อนมี ThaiD หน้า `/activate` ถูกแก้ให้พูดตามนี้แล้ว —
   ไม่บอกผู้ใช้ว่ากำลังเทียบเลขบัตรอยู่ทั้งที่ไม่ได้เทียบ
2. **เข้าสู่ระบบด้วย ThaiD ได้เฉพาะบัญชีที่เปิดใช้งานผ่าน ThaiD ด้วย client ชุดเดียวกันมาก่อน**
   เพราะจับคู่จาก `sub` ที่บันทึกไว้ตอนนั้น และ `sub` ผูกกับ client เปลี่ยน client
   เมื่อไรบัญชีเดิมก็จับคู่ไม่ได้อีก

### 4.3 `sub` คือเลขบัตร — เทียบได้โดยไม่ต้องมี scope `pid`

ข้อสังเกตจาก `external_reference` ของ SIT รอบ 2026-08-13 คือ `sub` เท่ากับเลขบัตร 13 หลัก
**ยืนยันแล้วเมื่อ 2026-08-16 ว่าจริงกับ client ของโครงการด้วย** ไม่ใช่แค่ client ตัวอย่าง:
ยิงบน `main` ด้วย credentials จริงและ `THAID_SCOPE=openid` เลขที่กรอกในหน้า sandbox คือ
`1101700207129` และ `sub` ที่ได้กลับมาก็เป็น `1101700207129` ตรงตัว (checksum มอดุโล 11 ผ่าน)

แปลว่า **§2.4 ทำได้โดยไม่ต้องรอ scope `pid`** — เทียบ `sub` กับ `user_account.cid` แทน
ยังไม่ได้ทำ เพราะยังไม่รู้ว่ากรมการปกครองรับประกันหรือไม่ว่า `sub` เป็นเลขบัตรเสมอ
มาตรฐาน OIDC ไม่ได้กำหนดไว้ และ IdP หลายเจ้าออก `sub` เป็นค่าทึบต่อ client (pairwise)
ถ้า production ทำแบบนั้นแล้วเราเทียบตรง ๆ ผลคือ "ไม่ตรง" → คีย์ถูกยกเลิก ซึ่งแย่กว่าไม่เทียบ

ถ้าจะทำ ทางที่ปลอดภัยคือรับ `sub` เป็นเลขบัตรเฉพาะเมื่อผ่าน checksum เลขประจำตัวประชาชน
13 หลักเท่านั้น ค่าทึบจะตกเงื่อนไขนี้เองแล้วกลับไปเป็น `pid_missing` ตามเดิม ไม่ใช่ยกเลิกคีย์
**ถามกรมการปกครองก่อนว่า `sub` คืออะไรกันแน่** แล้วค่อยตัดสิน — บันทึกไว้ในข้อ 6

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

### ผล SIT รอบสอง (2026-08-16) — โหมดไม่เทียบเลขบัตร

`sit-evidence/thaid-20260816/` (นอก git) · ไม่ได้เปิด `THAID_MOCK` ทั้งสองรอบ

| # | กรณี | ที่ไหน | ผล |
|---|---|---|---|
| 6 | เปิดใช้งานบัญชีด้วย `THAID_SCOPE=openid` (client ตัวอย่าง) | dev checkout 3160 | ผ่าน — `ACTIVE / USED`, `external_subject` ลงแล้ว, audit `cid_verified: false` |
| 7 | เข้าสู่ระบบด้วย ThaiD เมื่อไม่มี `pid` | dev checkout 3160 | ผ่าน — จับคู่บัญชีจาก `external_subject` แล้วออก session |
| 8 | `sub` ซ้ำกับบัญชีที่ผูกไว้แล้ว | dev checkout 3160 | ผ่าน — 409 `identity_in_use` บัญชียัง `PENDING` ไม่ค้างครึ่งทาง |
| 9 | **เปิดใช้งานบัญชีด้วย credentials จริงของโครงการ** | `main` 3000 | ผ่าน — authorize/token/ตรวจลายเซ็นครบ `VERIFY_IDENTITY SUCCEEDED`, บัญชี `ACTIVE`, ได้ session |

กรณีที่ 9 คือครั้งแรกที่ client ของโครงการเดินจนจบ — `redirect_uri` ที่ลงทะเบียนไว้เป็น
`http://localhost:3000/...` จึงทดสอบได้เฉพาะบน `main` เท่านั้น และเป็นที่มาของข้อ 4.3

`main` ส่งอีเมลจริง (Gmail SMTP) การเชิญผ่าน `POST /api/admin/invitations` จึงส่งเมลออกไปจริง
ระหว่างทดสอบจึงออก activation key ตรง ๆ ด้วย `issue-key.mjs` แทน ไม่ผ่าน endpoint นั้น

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

- [ ] ขอ scope `pid` และ redirect URI ของ deployment จริงจากกรมการปกครอง (ดูข้อ 4.1)
      **ทั้งสองข้อคือเงื่อนไขเดียวที่ทำให้ปิด `THAID_REQUIRE_CID_MATCH=false` ได้** —
      ได้มาเมื่อไรให้ลบค่านั้นออกจาก `.env` ของทุก deployment ทันที
- [x] ~~ตรวจว่า `sub` ของ client โครงการเป็นเลขบัตร 13 หลักหรือไม่~~ **เป็น** (ข้อ 4.3)
- [ ] ถามกรมการปกครองว่า `sub` เป็นเลขประจำตัวประชาชนเสมอหรือไม่ ทั้ง sandbox และ production
      ถ้าใช่ ให้เทียบจาก `sub` แล้วเปิดการเทียบกลับ (`THAID_REQUIRE_CID_MATCH=true`) ได้เลย
      โดยไม่ต้องรอ scope `pid` — ข้อนี้สั้นกว่าและอยู่ในมือเราเองมากกว่าข้อบน
- [ ] บัญชีที่ seed ไว้ก่อนหน้านี้บางบัญชี (เจ้าหน้าที่ BDI ใน `seed:demo`) ไม่มี `cid`
      จึงเปิดใช้งานผ่าน ThaiD ไม่ได้ — endpoint ตอบ 409 `cid_missing` พร้อมบอกให้ติดต่อเจ้าหน้าที่
      ถ้าจะสาธิตด้วยบัญชีเหล่านั้นต้องเติม `cid` ให้ก่อน (ข้อนี้หายไปเองเมื่อปิดการเทียบ)
- [ ] `main` ชี้ `THAID_REDIRECT_URI` ไปที่ `http://localhost:3000/auth/callback/thaid` ตามที่
      ลงทะเบียนไว้ ผู้ใช้ที่เข้าจาก `https://bdi.thammasorn.org` แล้วกดปุ่ม ThaiD จึงถูกส่งกลับ
      มาที่ localhost ของเครื่องตัวเอง = ใช้ไม่ได้ ThaiD บน `main` จึงใช้ได้เฉพาะเบราว์เซอร์
      บนเครื่องนี้ จนกว่า redirect URI ของโดเมนจริงจะลงทะเบียนเสร็จ
