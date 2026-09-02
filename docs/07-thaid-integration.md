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
| `request_nonce` | `nonce` ที่สุ่มคู่กับ `state` แล้วเอาไปเทียบกับ claim ใน id_token (ข้อ 4.3) |
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
THAID_SCOPE=                   # ว่าง = openid pid given_name family_name given_name_en family_name_en
THAID_USE_PID=true             # false = อ่านเลขบัตรจาก claim `sub` แทน `pid` (ดูข้อ 4.2)
THAID_REQUIRE_NONCE=false      # true = ปฏิเสธ id_token ที่ไม่มี claim nonce (ดูข้อ 4.3)
```

`redirect_uri` ต้องตรงตัวอักษรกับที่ลงทะเบียนไว้กับกรมการปกครอง ไม่งั้นได้
`invalid_request — The redirect or callback url mismatch` ตั้งแต่ขั้น authorize

### 4.1 credentials ชุดที่ลงทะเบียนไว้ — ทะเบียนถูกแก้ให้แล้วเมื่อ 2026-09-02

**สรุปที่ใช้ได้วันนี้:** client ของโครงการใน `assets/thaid/env_dev.txt` ได้ scope `pid`
และผูกกับ `https://bdi.thammasorn.org/auth/callback/thaid` เรียบร้อยแล้ว — `main` จึงใช้
ThaiD ของจริงได้ **แต่ `http://localhost:3000/...` ถูกถอดออกจากทะเบียนไปพร้อมกัน**
dev checkout จึงยังต้องใช้ client ตัวอย่างของ sandbox เหมือนเดิม (สลับข้างกับของเดิมพอดี)

#### สิ่งที่ยิงจริงเมื่อ 2026-09-02

| client · scope · redirect_uri | ผลจาก `/api/v2/oauth2/auth/` |
|---|---|
| โครงการ · `openid pid given_name family_name given_name_en family_name_en` · `https://bdi.thammasorn.org/auth/callback/thaid` | 302 ไปหน้า QR ✅ |
| โครงการ · scope เดียวกัน · `http://localhost:3000/auth/callback/thaid` | 400 `invalid_request` redirect mismatch ❌ |
| โครงการ · scope เดียวกัน · `http://bdi.thammasorn.org/...` (http ไม่ใช่ https) | 400 redirect mismatch ❌ |
| โครงการ · `openid nonsense_scope_zzz` · redirect ที่ถูก | 400 `invalid_scope` ❌ |
| `client_id` มั่ว | 401 `unauthorized_client` ❌ |
| ตัวอย่างของ sandbox · scope เต็ม · `localhost` พอร์ตอะไรก็ได้ | 302 ไปหน้า QR ✅ |

สามแถวล่างมีไว้เพื่อ **พิสูจน์ว่าด่านตรวจยังทำงานอยู่จริง** ไม่ใช่ระบบปล่อยผ่านทุกอย่าง —
ถ้าไม่ยิงสามแถวนั้น แถวแรกอ่านได้สองแบบ

#### ประวัติ (สิ่งที่เคยจริงและไม่จริงแล้ว)

ยิงเมื่อ 2026-08-13 และซ้ำเมื่อ 2026-08-16 ได้ผลตรงข้ามกับตารางข้างบนทุกข้อ: ขอ scope ที่มี
`pid` ได้ `invalid_scope` เสมอ และ redirect_uri ที่ผ่านมีแค่ `http://localhost:3000/...`
จึงพัฒนาและทำ SIT ด้วย **client ตัวอย่างของ sandbox**
(`assets/thaid/thaid sandbox.postman_environment.json`) ซึ่งรับ `redirect_uri` อะไรก็ได้
และให้ scope ครบ ทั้งสองข้อเป็นเรื่องทะเบียนฝั่งกรมการปกครอง ไม่ใช่เรื่องโค้ด — และ
กรมการปกครองก็แก้ทะเบียนให้แล้วโดยไม่ได้แจ้ง จึงต้องยิงดูเองถึงจะรู้

ระหว่างที่ยังใช้ ThaiD จริงบนโดเมนสาธารณะไม่ได้ มีโหมด `THAID_BYPASS` อยู่บน branch
`thaid-bypass-for-sit` เพื่อให้ SIT เดินต่อได้ **ถูกถอดออกทั้งหมดเมื่อ 2026-09-02**
พร้อมกับ `docs/16-thaid-bypass.md` เพราะเหตุผลที่ต้องมีหมดไปแล้ว — ระบบไม่มีทางไหนที่
เปิดใช้งานบัญชีได้โดยไม่เทียบเลขบัตรอีกต่อไป ตรงกับที่ `CLAUDE.md` เขียนไว้ว่าไม่มีโหมด mock

**ค่าตั้งต้นของ `THAID_SCOPE` เปลี่ยนเมื่อ 2026-08-24** เป็น
`openid pid given_name family_name given_name_en family_name_en` ตามการ์ด Enhance
(เดิมขอกว้างกว่านี้ มี `title` `middle_name` `name` `name_en` ด้วย) — ตั้งแต่ 2026-09-02
ค่าตั้งต้นนี้ใช้ได้กับ client ของโครงการตรง ๆ ไม่ต้องตั้ง env ทับอีกแล้ว

> ผลข้างเคียงของค่าตั้งต้นนี้: **ไม่มี claim `title`** ฟอร์มสร้างบัญชีจึงเติมชื่อกับ
> นามสกุลจากบัตรให้ ส่วนคำนำหน้าผู้ใช้เลือกเอง (`toIdentity()` ยังอ่าน `title` `name`
> `name_en` อยู่ ถ้าวันหนึ่งกรมการปกครองส่งมาให้เองก็ได้ค่าเพิ่มมาโดยไม่ต้องแก้โค้ด)
>
> **dev checkout ยังต้องใช้ client ตัวอย่างของ sandbox** — ตารางข้างบนบอกว่า `localhost`
> ทุกพอร์ตถูกปฏิเสธโดย client ของโครงการแล้ว ใส่ credentials ของโครงการใน dev checkout
> จะพังตั้งแต่ขั้น authorize

### 4.2 เลขบัตรมาจาก claim ไหน (`THAID_USE_PID`)

ตั้งแต่ทะเบียนถูกแก้เมื่อ 2026-09-02 client ของโครงการได้ scope `pid` แล้ว ค่าที่ใช้จริง
บน `main` จึงเป็น `THAID_USE_PID=true` ตามคู่มือ ส่วนทางลงมาที่ `sub` ยังอยู่เพราะเคย
จำเป็นและยังเป็นทางถอยที่ใช้ได้: **`sub` ที่ได้กลับมาคือเลขประจำตัวประชาชน 13 หลักตรง ๆ**
ยิงบน `main` ด้วย credentials จริงและ
`THAID_SCOPE=openid` เมื่อ 2026-08-16 กรอก `1101700207129` ที่หน้า sandbox แล้ว `sub`
ที่กลับมาก็เป็น `1101700207129` (ผ่าน checksum มอดุโล 11) เหมือนกับ client ตัวอย่างของ
sandbox ที่เจอตั้งแต่ SIT รอบแรก

`THAID_USE_PID` จึงเลือกว่าจะอ่านเลขบัตรจาก claim ไหน

| | `true` (ค่าตั้งต้น) | `false` |
|---|---|---|
| อ่านเลขบัตรจาก | claim `pid` (คู่มือ §6.2.2) | claim `sub` |
| ต้องมี scope `pid` | ใช่ | ไม่ |
| เทียบกับ `user_account.cid` | ✅ | ✅ **เหมือนกัน** |
| เลขไม่ตรง | 403 + คีย์ `REVOKED` | ✅ **เหมือนกัน** |
| `audit_event.metadata_json.cid_source` | `"pid"` | `"sub"` |

**นี่ไม่ใช่สวิตช์ปิดการตรวจ** §2.4 ทำงานเต็มรูปแบบทั้งสองค่า ต่างแค่ที่มาของเลข
จึงไม่มีโหมดไหนที่ระบบยอมเปิดใช้งานบัญชีโดยไม่เทียบเลขบัตรอีกต่อไป

**เลขที่อ่านมาต้องผ่าน checksum ก่อนถึงจะนับ** (`lib/thaid.ts` → `toIdentity()`)
ถ้า claim นั้นไม่มา หรือมาแล้วไม่ใช่เลขบัตรที่ถูกต้อง — เช่นวันหนึ่งกรมการปกครองเปลี่ยนไป
ออก `sub` เป็นค่าทึบต่อ client (pairwise) อย่างที่ IdP หลายเจ้าทำ เพราะ OIDC ไม่ได้กำหนดว่า
`sub` ต้องเป็นอะไร — ระบบตอบ **502 `cid_unavailable`** และ **ไม่ยกเลิกคีย์**
ต่างจากกรณี "เลขไม่ตรง" โดยตั้งใจ: เลขที่อ่านไม่ออกแปลว่าเราตั้งค่าผิด ไม่ใช่ผู้ใช้ถือบัตรผิดใบ
จะเอาลิงก์ของเขาไปยกเลิกไม่ได้ ข้อความใน log บอกให้ไปดู `THAID_USE_PID` กับ `THAID_SCOPE`

ยังควร **ถามกรมการปกครองว่า `sub` เป็นเลขบัตรเสมอหรือไม่** (ข้อ 6) — ตอนนี้ระบบพึ่ง
พฤติกรรมที่สังเกตเห็น ไม่ใช่สิ่งที่เอกสารรับประกัน แต่ถ้าวันหนึ่งมันเปลี่ยน ผลคือหยุดทำงาน
พร้อมข้อความที่ชัด ไม่ใช่ยกเลิกคีย์ของผู้ใช้ทิ้ง

**อัปเดต 2026-08-16:** discovery document ของ sandbox ประกาศ `subject_type_supported: ["public"]`
(ข้อ 4.4) ซึ่งแปลว่า `sub` **ไม่ใช่ pairwise** — ความกังวลย่อหน้าบนจึงเบาลงมาก
ยังไม่ใช่คำตอบสำหรับ production (คนละระบบ) และยังไม่ได้แปลว่า `sub` คือเลขบัตร
แต่ความเสี่ยงที่น่ากลัวที่สุด (client ต่างกันได้ `sub` ต่างกัน) ถูกตัดออกไปแล้ว

### 4.3 `nonce` และ PKCE

ตั้งแต่ 2026-08-16 authorization request มี `nonce` สุ่ม 24 ไบต์เสมอ เก็บคู่กับ `state`
ใน `integration_operation.request_nonce` แล้วเทียบกับ claim `nonce` ของ id_token ตอน callback

`state` กัน CSRF ได้อยู่แล้วผ่าน `idempotency_key` ที่ unique แต่ไม่ได้ผูก **id_token**
เข้ากับคำขอนั้น — `nonce` คือชิ้นที่ทำหน้าที่นั้น (OIDC Core §3.1.2.1, RECOMMENDED)

| กรณี | ผล |
|---|---|
| `nonce` ไม่ตรง | 403 `nonce_mismatch` · **ไม่เพิกถอน activation key** |
| `nonce` ไม่มีมาเลย | เตือนใน log แล้วไปต่อ · `THAID_REQUIRE_NONCE=true` ทำให้ 403 `nonce_missing` |

เหตุผลที่ยอมให้ผ่านเมื่อ claim ไม่มา และเหตุผลที่ไม่เพิกถอนคีย์ อยู่ใน
`docs/09-auth-tokens.md` §7 — สรุปคือเรายังไม่ยืนยันว่ากรมการปกครองสะท้อน `nonce` กลับมา
และความผิดพลาดฝั่งการตั้งค่าต้องไม่ทำลายลิงก์ของผู้ใช้ (หลักเดียวกับ `cid_unavailable`)

**PKCE (RFC 7636) ยังไม่ได้ทำ** OAuth 2.1 บังคับกับทุก client รวมทั้ง confidential client
แต่ sandbox **ไม่ประกาศว่ารองรับ** — ดูข้อ 4.4

### 4.4 สิ่งที่ discovery document ของ sandbox บอก (ยิงจริง 2026-08-16)

กรมการปกครองเผยแพร่ `/.well-known/openid-configuration` ไว้ ซึ่งตอบคำถามที่ค้างอยู่หลายข้อ
โดยไม่ต้องรอถามใคร สำเนาเก็บไว้ที่ `sit-evidence/thaid-discovery-20260816/`

```json
"grant_types_supported": ["authorization_code", "refresh_token"],
"response_types_supported": ["code"],
"subject_type_supported": ["public"],
"scopes_supported": ["openid", "pid", "address", "gender", "birthdate", …],
"id_token_signing_alg_values_supported": ["ES256"],
"token_endpoint_auth_methods_supported": ["client_secret_basic", "client_secret_post"]
```

| คำถาม | สิ่งที่เอกสารนี้บอก |
|---|---|
| **PKCE** | **ไม่มีฟิลด์ `code_challenge_methods_supported`** ซึ่ง RFC 8414 §2 กำหนดให้เป็นที่ประกาศว่ารองรับ PKCE → sandbox ไม่ประกาศว่ารองรับ |
| **`refresh_token`** | `grant_types_supported` มี `refresh_token` → ระบบเขาออก refresh token ได้จริง โค้ดที่ revoke ใบที่สองจึงไม่ใช่โค้ดตาย แต่ยังไม่ยืนยันว่าออกให้ client ของเราใน flow นี้ |
| **`sub` เป็น pairwise หรือไม่** | `subject_type_supported: ["public"]` → **public ไม่ใช่ pairwise** ซึ่งเป็นความเสี่ยงที่ข้อ 4.3 ของเดิมกังวลไว้ ยังต้องยืนยันกับ production แต่ข้อกังวลนั้นเบาลงมาก |
| **scope `pid`** | server รองรับ — ที่ขอไม่ได้คือสิทธิ์ของ client โครงการ ไม่ใช่ข้อจำกัดของระบบ |
| **nonce สะท้อนกลับไหม** | **ไม่ได้บอก** ไม่มี `claims_supported` ต้องดูจาก id_token จริง |

**ที่ทดลองยิงจริงเพิ่ม** (client ของโครงการ จาก `main`, 2026-08-16)

| ส่งอะไรไปที่ authorize | ผล |
|---|---|
| `nonce` (แบบที่ระบบส่งอยู่ตอนนี้) | ผ่าน — redirect ไปหน้า QR ตามปกติ ไม่พัง |
| `code_challenge` + `code_challenge_method=S256` | ผ่าน — แต่ **ไม่ได้แปลว่ารองรับ** |
| `zzz_probe_param=hello` (พารามิเตอร์มั่ว) | **ผ่านเหมือนกัน** → endpoint เพิกเฉยพารามิเตอร์ที่ไม่รู้จัก |
| `response_type=nonsense` | 400 `error` + `error_description` → ยืนยันว่าเขา validate ของที่รู้จักจริง |

แถวที่สามคือเหตุผลที่แถวที่สองพิสูจน์อะไรไม่ได้ **ส่ง PKCE ไปแล้วไม่พัง ≠ เขาบังคับใช้**
การพิสูจน์ว่าเขาบังคับใช้จริงต้องแลก `code` ด้วย `code_verifier` ที่**ผิด**แล้วดูว่าถูกปฏิเสธไหม
ซึ่งต้องมีคนสแกน ThaiD จริงหนึ่งครั้ง — หรือถามกรมการปกครองตรง ๆ ซึ่งควรถามอยู่ดีเพราะ
sandbox กับ production เป็นคนละระบบ

## 5. ผล SIT (2026-08-13)

ยิงกับ sandbox จริงทุกกรณี
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

### ผล SIT รอบสอง (2026-08-16) — เทียบเลขบัตรจาก `sub`

`sit-evidence/thaid-20260816/` (นอก git) · ยิงกับ sandbox จริงทุกกรณี
สคริปต์ `sit-usepid-false.mjs` · `THAID_SCOPE=openid` + `THAID_USE_PID=false`

| # | กรณี | ที่ไหน | ผล |
|---|---|---|---|
| 6 | เปิดใช้งานบัญชี เลขบัตรตรง (เลขมาจาก `sub`) | dev checkout 3160 | ผ่าน — `ACTIVE / USED`, `external_subject=3100600123450`, audit `cid_source: sub` |
| 7 | เข้าสู่ระบบด้วย ThaiD | dev checkout 3160 | ผ่าน — จับคู่บัญชีจาก `cid` แล้วออก session |
| 8 | **เลขบัตรไม่ตรง** | dev checkout 3160 | ผ่าน — 403, คีย์ `REVOKED`, บัญชียัง `PENDING`, audit `IDENTITY_VERIFICATION_FAILED / FAILURE / CID_MISMATCH`, `integration_operation=FAILED (cid_mismatch)` |
| 9 | **เปิดใช้งานบัญชีด้วย credentials จริงของโครงการ** | `main` 3000 | ผ่าน — authorize/token/ตรวจลายเซ็นครบ `VERIFY_IDENTITY SUCCEEDED`, บัญชี `ACTIVE`, ได้ session |
| 10 | `sub` ซ้ำกับบัญชีที่ผูกไว้แล้ว | dev checkout 3160 | ผ่าน — 409 `identity_in_use` บัญชียัง `PENDING` ไม่ค้างครึ่งทาง |

กรณีที่ 8 คือข้อสำคัญ: มันพิสูจน์ว่าอ่านเลขจาก `sub` แล้ว §2.4 ยังทำงานครบ ไม่ใช่แค่ "ผ่านได้"
กรณีที่ 9 คือครั้งแรกที่ client ของโครงการเดินจนจบ — `redirect_uri` ที่ลงทะเบียนไว้เป็น
`http://localhost:3000/...` จึงทดสอบได้เฉพาะบน `main` เท่านั้น และเป็นที่มาของข้อ 4.2
(กรณีที่ 9 กับ 10 รันตอนที่ยังใช้สวิตช์ตัวเก่าซึ่งไม่เทียบเลขบัตร ผลที่บันทึกไว้จึงเป็นของ
เส้นทางที่ยังเหมือนเดิมทั้งคู่ — การคุยกับกรมการปกครอง และ unique ของ `external_subject`)

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

- [x] ~~ขอ scope `pid` และ redirect URI ของ deployment จริงจากกรมการปกครอง~~ **ได้แล้ว**
      พบเมื่อยิงตรวจ 2026-09-02 (ข้อ 4.1) `main` จึงตั้ง `THAID_USE_PID=true` ตามคู่มือ
      ผลพลอยได้: `http://localhost:3000/...` ถูกถอดออกจากทะเบียนไปด้วย dev checkout
      จึงต้องใช้ client ตัวอย่างของ sandbox ต่อไป
- [x] ~~ตรวจว่า `sub` ของ client โครงการเป็นเลขบัตร 13 หลักหรือไม่~~ **เป็น** (ข้อ 4.2)
- [ ] ถามกรมการปกครองว่า `sub` เป็นเลขประจำตัวประชาชนเสมอหรือไม่ ทั้ง sandbox และ production
      ไม่เร่งแล้วเพราะ `main` อ่านจาก `pid` ตามคู่มือได้แล้ว แต่ `THAID_USE_PID=false`
      ยังเป็นทางถอยที่ตั้งได้ทาง env — ถ้าจะพึ่งทางนั้นเมื่อไรก็ต้องได้คำตอบนี้ก่อน
- [ ] บัญชีที่ seed ไว้ก่อนหน้านี้บางบัญชี (เจ้าหน้าที่ BDI ใน `seed:demo`) ไม่มี `cid`
      จึงเปิดใช้งานผ่าน ThaiD ไม่ได้ — endpoint ตอบ 409 `cid_missing` พร้อมบอกให้ติดต่อเจ้าหน้าที่
      ถ้าจะสาธิตด้วยบัญชีเหล่านั้นต้องเติม `cid` ให้ก่อน (ข้อนี้หายไปเองเมื่อปิดการเทียบ)
- [ ] **ถามกรมการปกครองว่ารองรับ PKCE หรือไม่** — discovery document ของ sandbox
      **ไม่ประกาศ** `code_challenge_methods_supported` (ข้อ 4.4) ซึ่งเป็นคำตอบที่ดีพอจะ
      ไม่ทำ PKCE ตอนนี้ แต่ยังต้องถามสำหรับ production (อีกสองเรื่องที่เคยรออยู่กับข้อนี้
      — scope `pid` และ redirect URI ของโดเมนจริง — ได้มาแล้ว)
- [ ] **ตรวจตอนยิงจริงว่า id_token มี claim `nonce` กลับมาหรือไม่** ถ้ามี ให้ตั้ง
      `THAID_REQUIRE_NONCE=true` ทุก deployment — ตอนนี้ระบบยอมให้ผ่านเมื่อไม่มี claim
- [ ] **ตรวจตอนยิงจริงว่า ThaiD ออก `refresh_token` มาด้วยหรือไม่** — discovery document
      บอกว่า server รองรับ grant `refresh_token` (ข้อ 4.4) เหลือแค่ยืนยันว่าออกให้ flow ของเรา
      `resolveIdentity()` เขียนลง log ไว้แล้วว่ารอบนั้นได้มาหรือไม่ (ไม่ใช่ตัว token)
- [ ] **ยังไม่มีใครสแกนบัตรจริงผ่านเส้นทางใหม่นี้** — ตรวจแล้วแค่ถึงขั้น authorize (302 ไป
      หน้า QR) ซึ่งพิสูจน์ว่าทะเบียนถูกต้อง แต่ไม่ได้พิสูจน์ว่า id_token มี claim `pid`
      กลับมาจริง ถ้าไม่มี ระบบตอบ 502 `cid_unavailable` และ **ไม่ยกเลิกคีย์** (ข้อ 4.2)
      ทางแก้คือ `THAID_USE_PID=false` ใน `.env` แล้วรีสตาร์ต backend ไม่ต้อง build ใหม่
