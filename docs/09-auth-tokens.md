# โทเคนทั้งหมดในระบบ — ออกที่ไหน เก็บอย่างไร หมดอายุเมื่อไร

> **ระบบนี้ไม่มี refresh token** และไม่มีตาราง session — ดูข้อ 1.4 ว่าทำไม และมันแปลว่าอะไร
> ถ้าเข้ามาหาว่า "access token กับ refresh token คู่กันทำงานยังไง" คำตอบคือไม่มีคู่นั้น

ระบบมีของที่เป็น "โทเคน" อยู่ 6 อย่าง แต่ละอย่างตอบคำถามคนละข้อ

| # | โทเคน | ตอบว่า | อายุ | เก็บที่ฝั่ง server |
|---|---|---|---|---|
| 1 | Session JWT | "คุณคือใคร" (หลังเข้าสู่ระบบแล้ว) | 7 วัน | **ไม่เก็บ** |
| 2 | Activation key | "คุณคือคนที่ถูกเชิญ" | 7 วัน | HMAC-SHA-256 |
| 3 | OTP | "อีเมลนี้เป็นของคุณจริง" | 10 นาที | bcrypt |
| 4 | `x-admin-token` | "ผู้เรียกคือสคริปต์ฝั่ง admin" | ไม่หมดอายุ | ค่าคงที่ใน env |
| 5 | โทเคนจาก ThaiD | "กรมการปกครองยืนยันตัวตนให้แล้ว" | ใช้ครั้งเดียวแล้วทิ้ง | **ไม่เก็บ** |
| 6 | OAuth `state` | "callback นี้มาจากคำขอที่เราเป็นคนเริ่ม" | 15 นาที | `integration_operation` |

โค้ดที่เกี่ยวข้องอยู่ใน `backend/src/lib/auth.ts` (สร้าง/แฮช/ตรวจ),
`backend/src/middleware/auth.ts` (บังคับใช้) และ `backend/src/routes/auth.ts` (เส้นทางทั้งหมด)

---

## 1. Session JWT — โทเคนเดียวที่ใช้เรียก API ทั่วไป

### 1.1 หน้าตาและที่อยู่

เป็น JWT ลงลายเซ็น HS256 ด้วย `JWT_SECRET` อยู่ใน **cookie ชื่อ `bdi_session`** เท่านั้น
ไม่เคยอยู่ใน `Authorization: Bearer` ไม่เคยอยู่ใน localStorage และ JavaScript อ่านไม่ได้

```js
// lib/auth.ts
{ httpOnly: true, sameSite: "lax", secure: env.auth.cookieSecure, path: "/",
  maxAge: SESSION_TTL_DAYS * 24 * 60 * 60 * 1000 }
```

- **`httpOnly`** — XSS ที่รันสคริปต์ในหน้าเว็บได้ ก็ยังขโมย cookie ออกไปใช้ที่อื่นไม่ได้
- **`sameSite: "lax"`** — `bdi.thammasorn.org` กับ `bdi-api.thammasorn.org` อยู่ใต้
  registrable domain เดียวกัน จึงนับเป็น same-site อยู่แล้ว ไม่ต้องใช้ `None` ซึ่งเปิดกว้างเกิน
- **`secure`** — เปิดอัตโนมัติเมื่อ `APP_URL` เป็น https (ตั้งทับได้ด้วย `COOKIE_SECURE`)

payload มีแค่ `sub` `email` `roles` `organizationId` — ดู 1.3 ว่าทำไมสองอันหลังแทบไม่มีความหมาย

### 1.2 ออกเมื่อไร

`issueSession()` ถูกเรียกจากสามที่เท่านั้น ทุกที่คือ "ยืนยันตัวตนผ่านแล้ว" จริง ๆ

| เส้นทาง | ก่อนหน้านั้นต้องผ่านอะไร |
|---|---|
| `POST /api/auth/login/verify-otp` | รหัสผ่านถูก **และ** OTP ในอีเมลถูก |
| `POST /api/auth/thaid/callback` (`purpose: login`) | ThaiD ยืนยัน + เลขบัตรตรงกับบัญชี |
| `POST /api/auth/activate` | ThaiD ยืนยัน + ตั้งรหัสผ่านเสร็จ |

`POST /api/auth/login` (ขั้นแรก) **ไม่ออก session** — ตอบ `202` กับ `nextStep: "verify_otp"`
รหัสผ่านอย่างเดียวไม่พอเข้าระบบ

### 1.3 สิ่งที่อยู่ใน JWT เชื่อไม่ได้ทั้งหมด ยกเว้น `sub`

`requireAuth` **อ่าน role กับหน่วยงานใหม่จากฐานข้อมูลทุก request** แล้วเขียนทับค่าที่มากับ JWT

```ts
// middleware/auth.ts — ย่อ
const session = verifySession(token);              // ได้ sub มาเท่านั้นที่นับ
const user = await prisma.userAccount.findUnique({ where: { id: session.sub }, ... });
if (!user || user.status !== ACTIVE) return 401;   // บัญชีถูกระงับ = ตัดสิทธิ์ทันที
req.session = { sub, email, roles: <จาก DB>, organizationId: <จาก DB> };
```

เหตุผลคือทั้ง role และหน่วยงานเปลี่ยนได้ระหว่างที่ session ยังไม่หมดอายุ (ผู้ใช้สร้างหน่วยงาน
หรือถูกเพิ่มเป็นผู้มีอำนาจ) ถ้าเชื่อค่าใน cookie ต่อไป คนที่เพิ่งสร้างหน่วยงานเสร็จจะยังทำอะไร
ไม่ได้จนกว่าจะออกจากระบบแล้วเข้าใหม่

**ห้าม optimise การอ่านนี้ทิ้ง** และห้ามอ่าน `roles` / `organizationId` จาก JWT ตรง ๆ
(ย้ำไว้ใน `CLAUDE.md` ด้วย เพราะเป็นของที่ดู "เกินจำเป็น" สำหรับคนที่เพิ่งอ่านโค้ด)

### 1.4 ไม่มี refresh token และไม่มีตาราง session

ทางเลือกที่ระบบนี้เลือกคือ **JWT อายุยาว (7 วัน) ตัวเดียว ไม่มีการต่ออายุ ไม่มีการหมุน**
ไม่มีตาราง `session` ไม่มี blacklist ไม่มี jti

ผลที่ตามมา ต้องรู้ให้ครบทั้งสองด้าน

- ✅ ตรวจ session ไม่ต้องแตะฐานข้อมูลสำหรับตัว token เอง (แต่ก็ยัง query user ทุก request
  ตามข้อ 1.3 อยู่ดี — ประโยชน์ด้าน performance จึงน้อยกว่าที่คนมักคิด)
- ✅ `POST /api/auth/logout` ล้าง cookie แล้วจบ ไม่มี state ค้าง
- ❌ **logout ฝั่ง server ทำไม่ได้** ถ้ามีคนคัดลอก cookie ออกไป มันใช้ได้จนครบ 7 วัน
  การ logout ล้างแค่ cookie ในเบราว์เซอร์ตัวเอง ไม่ได้ทำให้ token ใบนั้นใช้ไม่ได้
- ❌ **เปลี่ยนรหัสผ่านไม่ได้เตะ session เดิมออก** เพราะไม่มีอะไรผูก session กับรหัสผ่าน
- ✅ **สวิตช์ที่มีจริงคือสถานะบัญชี** — `requireAuth` เช็ก `status !== ACTIVE` ทุก request
  ตั้งบัญชีเป็น `SUSPENDED` หรือ `DEACTIVATED` แล้ว token ทุกใบของคนนั้นตายทันที
  เช่นเดียวกับการถอน role assignment ซึ่งมีผลทันทีเหมือนกัน
- ❌ **เปลี่ยน `JWT_SECRET` = เตะทุกคนออกพร้อมกัน** เป็นวิธี revoke แบบเหวี่ยงแหที่มีอยู่วิธีเดียว

ถ้าวันหนึ่งต้องการ revoke รายคนจริง ๆ ทางที่ตรงที่สุดคือใส่ `jti` ลง JWT แล้วเก็บตาราง
session ที่ถูกเพิกถอน — ยังไม่ทำเพราะยังไม่มีข้อกำหนดที่ต้องใช้ และ "ระงับบัญชี" ครอบคลุม
เคสที่นึกออกทั้งหมดแล้ว

### 1.5 ฝั่งเบราว์เซอร์

`frontend/lib/api.ts` เรียกด้วย `credentials: "include"` ทุกครั้ง cookie จึงถูกแนบไปเอง
ไม่มีโค้ดที่ไหนอ่านหรือเขียน token ตรง ๆ — เพิ่ม header `Authorization` เข้าไปก็ไม่มีผล
เพราะ backend ไม่ได้อ่าน

> **กับดักที่เคยเสียเวลาไปแล้ว:** เมื่อ `APP_URL` เป็น https (คือ `main`) cookie จะถูกออกแบบ
> `Secure` สคริปต์ที่ยิง `http://localhost:4000` จะได้ 200 ตอน login แล้ว 401 ทุกครั้งถัดไป
> เพราะ client ไม่ส่ง cookie กลับ — เบราว์เซอร์บน `localhost` ไม่เจอปัญหานี้เพราะ Chrome
> ถือว่า localhost เป็น secure context

## 2. Activation key — ใบเบิกทางครั้งเดียวสำหรับเปิดใช้งานบัญชี

สุ่ม 32 ไบต์ เข้ารหัส base64url ส่งให้ผู้ใช้ทางอีเมลในรูป `{APP_URL}/activate?token=<key>`

**เก็บเป็น `HMAC-SHA-256(ACTIVATION_KEY_SECRET, key)`** ไม่ใช่ SHA-256 เปล่า ต่างกันตรงที่
ถ้าฐานข้อมูลรั่วโดย server secret ไม่รั่วไปด้วย ผู้โจมตีสร้าง key ที่ตรงกับ hash ไม่ได้เลย
การเทียบใช้ `timingSafeEqual` (`activationKeyMatches()`)

วงจรชีวิตอยู่ในตาราง `iam.activation_key`: `ISSUED` → `USED` / `REVOKED` / หมดอายุใน 7 วัน
(`ACTIVATION_KEY_TTL_DAYS`) ออกใบใหม่ให้ (บัญชี, หน่วยงาน, role) เดิมจะ `REVOKED` ใบเก่าอัตโนมัติ

**คีย์ดิบไม่เคยถูกเขียนลงฐานข้อมูลและไม่เคยถูกส่งไป ThaiD** — callback ของ ThaiD หาทางกลับ
เข้าเรื่องเดิมด้วย `subject_id` ซึ่งเป็น id ของแถว activation_key ไม่ใช่ตัวคีย์
อีเมลที่มีคีย์จึงถูกส่งแบบ inline ไม่ผ่าน outbox เพราะคีย์ดิบมีอยู่แค่ในหน่วยความจำชั่วขณะนั้น

`ACTIVATION_KEY_SECRET` ต้องตั้งเองบน production — backend โยน error ตอนบูตถ้าไม่มี
แทนที่จะ fallback เป็นค่า dev เงียบ ๆ

## 3. OTP — ชั้นที่สองของการเข้าสู่ระบบด้วยรหัสผ่าน

6 หลักจาก `randomInt` (ไม่ใช่ `Math.random`) เก็บเป็น **bcrypt cost 8** ในตาราง `iam.otp_code`
อายุ 10 นาที (`OTP_TTL_MINUTES`) ผิดได้ 5 ครั้ง (`OTP_MAX_ATTEMPTS`) แล้วรหัสนั้นถูกเผาทิ้ง

- ขอรหัสใหม่ = ปิด (`consumed_at`) รหัสเก่าที่ยังไม่ถูกใช้ทั้งหมด ไม่มีรหัสใช้ได้พร้อมกันหลายตัว
- `POST /api/auth/login/resend-otp` **ต้องมี OTP ของรอบนั้นค้างอยู่ก่อน** ไม่งั้นตอบ 409
  มิฉะนั้น endpoint นี้จะกลายเป็นเครื่องยิงอีเมลไปที่อยู่ใดก็ได้
- ข้อความตอบกลับตอนรหัสผ่านผิดเหมือนกันทุกกรณี ไม่บอกว่าอีเมลนั้นมีอยู่จริงหรือไม่

`OtpPurpose` มีสองค่า — `LOGIN` ใช้อยู่จริง ส่วน `REGISTRATION` เหลือจากตอนที่การเปิดใช้งาน
บัญชียังใช้ OTP ทางอีเมล ตอนนี้การเปิดใช้งานเป็น ThaiD ทางเดียว ไม่มีเส้นทางไหนออก
OTP แบบ `REGISTRATION` อีกแล้ว

## 4. `x-admin-token` — shared secret ไม่ใช่ session

`POST /api/admin/*` ทั้งหมดป้องกันด้วย header `x-admin-token` เทียบกับ `ADMIN_API_TOKEN`
ตรง ๆ เพราะสเปกระบุว่าขั้นตอนเชิญผู้ใช้ "ไม่มี UI แต่ต้องมี api" ผู้เรียกจึงเป็นสคริปต์
ไม่ใช่เบราว์เซอร์ที่มี session

ข้อจำกัดที่ควรรู้ (ยอมรับไว้ ไม่ใช่มองข้าม): ไม่หมดอายุ ไม่หมุน ไม่ผูกกับตัวบุคคล —
`audit_event` ของงานที่ทำผ่านเส้นทางนี้จึงบอกได้แค่ว่า "ระบบทำ" ไม่ได้บอกว่าเจ้าหน้าที่คนไหน
ถ้าวันหนึ่งต้องรู้ตัวบุคคล ต้องเปลี่ยนไปใช้บัญชีจริงที่มี role `SYSTEM_ADMINISTRATOR`

การเทียบใช้ `!==` ธรรมดา ไม่ใช่ `timingSafeEqual` — ต่างจาก activation key ตรงนี้
ยังไม่ได้แก้ ถ้าจะแก้ก็ควรแก้ (`middleware/auth.ts` → `requireAdminToken`)

คอลเลกชัน Postman ของ endpoint กลุ่มนี้อยู่ที่ `docs/bdi-admin-portal.postman_collection.json`
(สร้างหน่วยงาน + ส่งลิงก์เปิดใช้งาน + ดู/ยกเลิกคำเชิญ)

## 5. โทเคนจาก ThaiD — รับมาแล้วทิ้งทันที

`resolveIdentity()` ใน `lib/thaid.ts` ทำสามอย่างแล้วจบ

1. เอา `code` ไปแลกที่ `/api/v2/oauth2/token/` ด้วย Basic auth (`client_id:client_secret`)
2. ตรวจลายเซ็น **ES256** ของ `id_token` กับ JWKS ของกรมการปกครอง (แคช 1 ชั่วโมง เลือกคีย์
   ตาม `kid` ถ้าเจอ kid ที่ไม่รู้จักให้ล้างแคชแล้วดึงใหม่หนึ่งครั้ง) พร้อมตรวจ `aud` และ `iss`
3. เรียก `/api/v2/oauth2/revoke/` คืน access token ทิ้ง แบบไม่รอผลและไม่ให้พัง flow

**access token, refresh token และ id_token ไม่เคยถูกเก็บลงฐานข้อมูล** ระบบนี้ใช้ ThaiD เพื่อ
"ยืนยันตัวตนครั้งเดียว" ไม่ได้ใช้เรียก API อื่นของกรมการปกครองต่อ `refresh_token` มีอยู่ใน
type ของ response เพราะสเปกส่งมา แต่ไม่มีโค้ดไหนอ่านมันเลย

สิ่งเดียวที่เหลือไว้คือ `sub` ลงคอลัมน์ `user_account.external_subject` และ
`integration_operation.external_reference` — เลขบัตรที่ใช้เทียบไม่ถูกเก็บ
(ดู `docs/07-thaid-integration.md` §4.2 ว่าตอนนี้เลขบัตรอ่านมาจาก claim ไหน)

id_token มาถึงเราทาง back channel ผ่าน TLS มาตรฐาน OIDC ยอมให้ข้ามการตรวจลายเซ็นได้
แต่มันคือหลักฐานชิ้นเดียวที่ใช้ตัดสินว่าจะสร้างบัญชีให้หรือไม่ จึงตรวจ

## 6. OAuth `state` — กัน CSRF และผูก callback กลับเข้าคำขอเดิม

สุ่ม 24 ไบต์ base64url เก็บเป็น `idempotency_key = thaid:<state>` ในตาราง
`integration.integration_operation` ซึ่ง **unique** จึงกันการยิง `code` ซ้ำได้ที่ชั้นฐานข้อมูล
ไม่ต้องพึ่งโค้ด

`claimThaidState()` จองด้วย `updateMany` ที่กรอง `status = PENDING` — เป็น atomic
กด refresh ที่หน้า callback รอบสองจะได้ `already_used` แทนที่จะแลก token ซ้ำ
อายุ 15 นาที (`THAID_STATE_TTL_MINUTES`) ยาวพอให้เปิดแอป ThaiD บนมือถือแล้วกลับมา

หลังยืนยันผ่าน แถวเดิมทำหน้าที่เป็น "ใบเสร็จ" ให้ขั้นตั้งรหัสผ่านอีก 30 นาที
(`THAID_VERIFICATION_TTL_MINUTES`) — `POST /api/auth/activate` เรียก `latestVerification()`
อ่านจากฐานข้อมูล ไม่เชื่อคำบอกเล่าจากเบราว์เซอร์

## 7. ตัวแปรที่เกี่ยวข้องทั้งหมด

```bash
JWT_SECRET=                    # ลงลายเซ็น session — เปลี่ยนค่า = เตะทุกคนออก
SESSION_TTL_DAYS=7
COOKIE_SECURE=                 # ว่าง = เปิดเองเมื่อ APP_URL เป็น https
OTP_TTL_MINUTES=10
OTP_MAX_ATTEMPTS=5
ACTIVATION_KEY_TTL_DAYS=7
ACTIVATION_KEY_SECRET=         # HMAC ของ activation key — บังคับบน production
ADMIN_API_TOKEN=               # ค่าใน header x-admin-token
THAID_STATE_TTL_MINUTES=15
THAID_VERIFICATION_TTL_MINUTES=30
```

`JWT_SECRET` และ `ADMIN_API_TOKEN` อยู่ใน `.env` ซึ่ง git ไม่ติดตาม **ห้ามย้ายไปไฟล์ที่ track ไว้**

## 8. สรุปสั้น ๆ สำหรับคนที่มาจากระบบที่มี refresh token

| คำถามที่มักถาม | คำตอบของระบบนี้ |
|---|---|
| access token อยู่ที่ไหน | cookie `bdi_session` เท่านั้น อ่านจาก JS ไม่ได้ |
| refresh token อยู่ที่ไหน | ไม่มี |
| ต่ออายุ session อย่างไร | ไม่ต่อ ครบ 7 วันแล้วเข้าสู่ระบบใหม่ |
| บังคับให้ผู้ใช้คนหนึ่งออกจากระบบทันที | ตั้ง `user_account.status` เป็น `SUSPENDED`/`DEACTIVATED` |
| บังคับให้ทุกคนออกจากระบบ | เปลี่ยน `JWT_SECRET` แล้วรีสตาร์ต backend |
| เรียก API ด้วย Bearer token ได้ไหม | ไม่ได้ ยกเว้น `/api/admin/*` ที่ใช้ `x-admin-token` |
