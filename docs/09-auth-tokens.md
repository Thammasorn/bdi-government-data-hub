# โทเคนทั้งหมดในระบบ — ออกที่ไหน เก็บอย่างไร หมดอายุเมื่อไร

> **ระบบนี้ไม่มี refresh token** — และไม่ต้องมี เพราะ session เป็น opaque session id
> ที่มีตารางอยู่ฝั่ง server เพิกถอนได้ทีละใบ (ข้อ 1.4) refresh token มีไว้แก้ปัญหาของ
> access token อายุสั้นที่เพิกถอนไม่ได้ ซึ่งเป็นปัญหาที่ระบบนี้ไม่มีแล้ว

ระบบมีของที่เป็น "โทเคน" อยู่ 9 อย่าง แต่ละอย่างตอบคำถามคนละข้อ

| # | โทเคน | ตอบว่า | อายุ | เก็บที่ฝั่ง server |
|---|---|---|---|---|
| 1 | Session id (opaque) | "คุณคือใคร" (หลังเข้าสู่ระบบแล้ว) | 7 วัน / ไม่ใช้งาน 8 ชม. | SHA-256 ใน `iam.session` |
| 2 | Activation key | "คุณคือคนที่ถูกเชิญ" | 7 วัน | HMAC-SHA-256 |
| 3 | OTP | "อีเมลนี้เป็นของคุณจริง" | 10 นาที | bcrypt |
| 4 | `x-admin-token` | "ผู้เรียกคือสคริปต์ฝั่ง admin" | ไม่หมดอายุ | ค่าคงที่ใน env |
| 5 | โทเคนจาก ThaID | "กรมการปกครองยืนยันตัวตนให้แล้ว" | ใช้ครั้งเดียวแล้วทิ้ง | **ไม่เก็บ** |
| 6 | OAuth `state` | "callback นี้มาจากคำขอที่เราเป็นคนเริ่ม" | 15 นาที | `integration_operation` |
| 7 | OIDC `nonce` | "id_token ใบนี้ออกให้คำขอของเราจริง" | 15 นาที | `integration_operation` |
| 8 | `x-log-token` | "ผู้เรียกมีสิทธิ์อ่าน activity log และ error" | ไม่หมดอายุ | ค่าคงที่ใน env (`LOG_READ_TOKEN`) |
| 9 | `x-report-token` | "รายงาน error นี้มาจาก Next server ของเราเอง" | ไม่หมดอายุ | ค่าคงที่ใน env ของ backend และ frontend (`INGEST_SERVER_TOKEN`) |

โค้ดที่เกี่ยวข้องอยู่ใน `backend/src/lib/auth.ts` (สร้าง/แฮช/ตรวจ),
`backend/src/lib/session.ts` (วงจรชีวิตของ session), `backend/src/middleware/auth.ts`
(บังคับใช้) และ `backend/src/routes/auth.ts` (เส้นทางทั้งหมด) · ทุกขั้นของการพิสูจน์ตัวตน รวมความล้มเหลว ลง `audit_event`
(ข้อ 4.2 และ `docs/21-activity-log.md` หมวด 4)

---

## 1. Session id — โทเคนเดียวที่ใช้เรียก API ทั่วไป

### 1.1 หน้าตาและที่อยู่

เป็น **ค่าสุ่ม 32 ไบต์ เข้ารหัส base64url** ไม่มีข้อมูลอยู่ในตัวมันเอง อยู่ใน
**cookie ชื่อ `bdi_session`** เท่านั้น ไม่เคยอยู่ใน `Authorization: Bearer`
ไม่เคยอยู่ใน localStorage และ JavaScript อ่านไม่ได้

```js
// lib/auth.ts
{ httpOnly: true, sameSite: "lax", secure: env.auth.cookieSecure, path: "/",
  maxAge: SESSION_TTL_DAYS * 24 * 60 * 60 * 1000 }
```

- **`httpOnly`** — XSS ที่รันสคริปต์ในหน้าเว็บได้ ก็ยังขโมย cookie ออกไปใช้ที่อื่นไม่ได้
- **`sameSite: "lax"`** — `bdi.thammasorn.org` กับ `bdi-api.thammasorn.org` อยู่ใต้
  registrable domain เดียวกัน จึงนับเป็น same-site อยู่แล้ว ไม่ต้องใช้ `None` ซึ่งเปิดกว้างเกิน
- **`secure`** — เปิดอัตโนมัติเมื่อ `APP_URL` เป็น https (ตั้งทับได้ด้วย `COOKIE_SECURE`)

ฝั่ง server มีแถวใน **`iam.session`** ที่เก็บ `SHA-256` ของค่านั้น (ไม่ใช่ค่าดิบ) พร้อม
`expires_at` · `last_seen_at` · `revoked_at` · `revoked_reason` · `ip_address` · `user_agent`
ฐานข้อมูลที่รั่วออกไปจึงไม่มี cookie ที่ใช้ได้อยู่ในนั้น เหตุผลที่ใช้ SHA-256 ไม่ใช่ bcrypt
เหมือนกับ activation key: ค่านี้เป็นค่าสุ่มความยาวเต็ม ไม่ใช่รหัสผ่านที่คนตั้งเอง

**เดิมเป็น JWT ลงลายเซ็น HS256** ที่แบก `sub`/`email`/`roles`/`organizationId` มาในตัว
เปลี่ยนเมื่อ 2026-08-16 — payload นั้นถูก `requireAuth` เขียนทับทุก request อยู่แล้ว
จึงมีแต่โอกาสทำให้เข้าใจผิด และการไม่มีสถานะฝั่ง server แปลว่า logout จริง ๆ ทำไม่ได้
**`JWT_SECRET` ไม่มีอีกแล้ว** (`jsonwebtoken` ยังอยู่ ใช้ตรวจลายเซ็น id_token ของ ThaID)

### 1.2 ออกเมื่อไร

`issueSession()` ถูกเรียกจากสามที่เท่านั้น ทุกที่คือ "ยืนยันตัวตนผ่านแล้ว" จริง ๆ

| เส้นทาง | ก่อนหน้านั้นต้องผ่านอะไร |
|---|---|
| `POST /api/auth/login/verify-otp` | รหัสผ่านถูก **และ** OTP ในอีเมลถูก |
| `POST /api/auth/thaid/callback` (`purpose: login`) | ThaID ยืนยัน + เลขบัตรตรงกับบัญชี |
| `POST /api/auth/activate` | ThaID ยืนยัน + ตั้งรหัสผ่านเสร็จ |

`POST /api/auth/login` (ขั้นแรก) **ไม่ออก session** — ตอบ `202` กับ `nextStep: "verify_otp"`
รหัสผ่านอย่างเดียวไม่พอเข้าระบบ

### 1.3 สิ่งที่อยู่ใน JWT เชื่อไม่ได้ทั้งหมด ยกเว้น `sub`

`requireAuth` **อ่าน role กับหน่วยงานใหม่จากฐานข้อมูลทุก request** แล้วเขียนทับค่าที่มากับ JWT

```ts
// middleware/auth.ts — ย่อ
const { session } = await resolveSession(rawSessionId);   // แถวใน iam.session หรือ null
if (!session) return 401;                                 // ถูกเพิกถอน / หมดอายุ / ไม่มีอยู่จริง
const user = await prisma.userAccount.findUnique({ where: { id: session.userAccountId }, ... });
if (!user || user.status !== ACTIVE) return 401;          // บัญชีถูกระงับ = ตัดสิทธิ์ทันที
req.session = { sub, email, roles: <จาก DB>, organizationId: <จาก DB>, sessionId };
```

เหตุผลคือทั้ง role และหน่วยงานเปลี่ยนได้ระหว่างที่ session ยังไม่หมดอายุ (ผู้ใช้สร้างหน่วยงาน
หรือถูกเพิ่มเป็นผู้มีอำนาจ) ถ้าเชื่อค่าใน cookie ต่อไป คนที่เพิ่งสร้างหน่วยงานเสร็จจะยังทำอะไร
ไม่ได้จนกว่าจะออกจากระบบแล้วเข้าใหม่

**ห้าม optimise การอ่านนี้ทิ้ง** และห้ามย้าย `roles` / `organizationId` กลับไปเก็บใน cookie
(ย้ำไว้ใน `CLAUDE.md` ด้วย เพราะเป็นของที่ดู "เกินจำเป็น" สำหรับคนที่เพิ่งอ่านโค้ด)

การเปลี่ยนมาใช้ตาราง session เพิ่ม query อีกหนึ่งครั้งต่อ request ซึ่งแทบไม่มีความหมายที่นี่ —
ระบบนี้อ่านฐานข้อมูลทุก request อยู่แล้วโดยตั้งใจ เหตุผลปกติที่คนเลือก stateless JWT
("ไม่ต้องแตะฐานข้อมูล") จึงเป็นราคาที่จ่ายไปโดยไม่เคยได้ของแลกตั้งแต่แรก

### 1.4 ตาราง `iam.session` — เพิกถอนได้ทีละใบ

> เดิมหัวข้อนี้ชื่อ "ไม่มี refresh token และไม่มีตาราง session" และอธิบายข้อจำกัดของ JWT
> อายุยาวใบเดียวที่เพิกถอนไม่ได้ การ์ด **Session and Token Hardening** (2026-08-16)
> คือการไปแก้มัน ข้อความข้างล่างนี้คือสิ่งที่เป็นจริงหลังการ์ดนั้น

session หนึ่งใบ = แถวหนึ่งแถวใน `iam.session` cookie ถือแค่ค่าสุ่มที่ชี้มาที่แถวนั้น
ทุก request `requireAuth` อ่านแถวนี้ ถ้า `revoked_at` ไม่เป็น null หรือหมดอายุ → 401 ทันที

**อายุมีสองชั้น ต้องผ่านทั้งคู่**

| ชั้น | คอลัมน์ | ค่าตั้งต้น | ต่ออายุได้ไหม |
|---|---|---|---|
| absolute | `expires_at` | `SESSION_TTL_DAYS` = 7 วัน | ไม่ได้ ครบแล้วต้องเข้าสู่ระบบใหม่ |
| idle | `last_seen_at` | `SESSION_IDLE_HOURS` = 8 ชั่วโมง | ขยับทุกครั้งที่ใช้งาน |

`last_seen_at` ถูกเขียนอย่างมากทุก 1 นาที (`TOUCH_INTERVAL_MS` ใน `lib/session.ts`)
ไม่ใช่ทุก request — หน้าเว็บหน้าเดียวยิง API หลายสิบครั้ง และ idle ที่นับเป็นชั่วโมง
ไม่ต้องการความละเอียดกว่านั้น ใบที่หมดอายุถูกปิดเป็น `EXPIRED` ตอนมีคนเอามายิง
จึงไม่ต้องมี cron มาไล่เก็บ

**สิ่งที่ทำได้แล้ว** (ทั้งหมดทำไม่ได้ก่อน 2026-08-16)

| ต้องทำได้ | ทำอย่างไร |
|---|---|
| logout แล้ว session นั้นใช้ไม่ได้อีกจริง ๆ | `POST /api/auth/logout` ปิดแถว (`LOGOUT`) |
| ออกจากระบบทุกอุปกรณ์ | `POST /api/auth/logout-all` (`LOGOUT_ALL`) |
| ดูว่ามีใบไหนค้างอยู่บ้าง | `GET /api/auth/sessions` |
| หมดอายุแบบ idle | ตารางข้างบน |
| หมุนใบตอนสิทธิ์เปลี่ยนระดับ | `issueSession()` เพิกถอนใบที่ผู้เรียกถือมา (`ROTATED`) กัน session fixation |
| ระงับบัญชีแล้วตัดสิทธิ์ทันที | เหมือนเดิม — `requireAuth` เช็ก `status !== ACTIVE` ทุก request<br>และตอนนี้ปิดแถว session ที่ค้างอยู่ให้ด้วย (`ACCOUNT_SUSPENDED`) |

การเพิกถอนทุกครั้งลง `audit_event` ด้วย action `SESSION_REVOKED` และเหตุผลอยู่ใน
`metadata_json.reason` — แยก logout · logout ทุกอุปกรณ์ · เปลี่ยนรหัสผ่าน · ระงับบัญชี ·
หมุนใบ · หมดอายุ (ซึ่งยังแยกต่อได้อีกว่า `ABSOLUTE` หรือ `IDLE`)

`PASSWORD_CHANGED` มีผู้เรียกแล้วตั้งแต่ 2026-09-18 — `POST /api/auth/password-reset`
(ข้อ 3.1) เพิกถอน**ทุกใบ**ของบัญชีตอนตั้งรหัสผ่านใหม่ ไม่เว้นใบไหน เพราะไม่ได้ออก session
ให้ตรงนั้น `revokeSessionsFor(..., { exceptSessionId })` จึงยังไม่มีใครใช้ — มันรอ endpoint
"เปลี่ยนรหัสผ่านขณะล็อกอินอยู่" ซึ่งยังไม่มี (ตัดสินไว้ 2026-08-16 ว่าไม่เพิ่ม)

**ยังไม่มี refresh token และไม่ตั้งใจจะมี** — refresh token คู่กับ access token อายุสั้น
มีไว้แก้ปัญหา "เพิกถอน token ที่กระจายไปแล้วไม่ได้" ซึ่งตารางนี้แก้ไปแล้วโดยตรง
รูปแบบนั้นเหมาะกับ API ที่มี client หลายชนิด ไม่ใช่ browser app ที่มี cookie อยู่แล้ว

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

**คีย์ดิบไม่เคยถูกเขียนลงฐานข้อมูลและไม่เคยถูกส่งไป ThaID** — callback ของ ThaID หาทางกลับ
เข้าเรื่องเดิมด้วย `subject_id` ซึ่งเป็น id ของแถว activation_key ไม่ใช่ตัวคีย์
อีเมลที่มีคีย์จึงถูกส่งแบบ inline ไม่ผ่าน outbox เพราะคีย์ดิบมีอยู่แค่ในหน่วยความจำชั่วขณะนั้น

`ACTIVATION_KEY_SECRET` ต้องตั้งเองบน production — backend โยน error ตอนบูตถ้าไม่มี
แทนที่จะ fallback เป็นค่า dev เงียบ ๆ

### 2.1 ยกเลิก (revoke) กับ ลบ (delete) คำเชิญ — คนละเรื่องกัน

| อยากได้อะไร | ใช้อะไร | เหลืออะไรไว้ |
|---|---|---|
| ให้ลิงก์ใบนั้นใช้ไม่ได้ แต่ยังตรวจสอบย้อนหลังได้ | `POST /api/admin/invitations/:id/revoke` | แถว `activation_key` สถานะ `REVOKED` + บัญชี `PENDING` เดิม |
| เอาคำเชิญออกจากระบบ และคืนอีเมล/เลขบัตรให้ใช้ใหม่ | `DELETE /api/admin/invitations/:id` | ไม่เหลือแถว — เหลือแต่ `audit_event` `INVITATION_DELETED` |

ที่ต้องมีตัวลบเพราะ `user_account.email` และ `user_account.cid` เป็น unique ทั้งคู่: เชิญผิดอีเมล
หนึ่งครั้ง บัญชี `PENDING` ใบนั้นก็ยึดทั้งสองค่าไว้ revoke ไม่ได้คืนให้ และเมื่อก่อนทางออก
เดียวคือลบในฐานข้อมูลด้วยมือ ซึ่ง `docs/08-database-access.md` ห้ามไว้

ลบบัญชีให้เฉพาะบัญชีที่ "เกิดมาเพราะคำเชิญใบนี้และยังไม่ได้ทำอะไร": ยัง `PENDING` · ไม่มีคีย์
ใบอื่น · ไม่มี role · ไม่ถูกมอบหมาย review task · ไม่มีลายเซ็นหรือการยอมรับเอกสาร ถ้าติดข้อใด
ข้อหนึ่ง คำเชิญถูกลบแต่บัญชียังอยู่ และคำตอบบอกเหตุผลว่าเพราะอะไร บัญชีที่ `ACTIVE` แล้ว
ตอบ 409 — การลบบัญชีที่ใช้งานอยู่ไม่ใช่การลบคำเชิญ ให้ระงับบัญชีแทน

หน่วยงานเปล่า (`หน่วยงานใหม่`) กับร่างคำขอที่คำเชิญแบบไม่ระบุหน่วยงานสร้างไว้ ถูกลบไปด้วย
ถ้ายังไม่มีใครแตะ — ไม่ลบก็จะค้างโดยที่ `created_by` ชี้บัญชีที่ไม่มีอยู่แล้ว และการเชิญคนเดิม
ครั้งต่อไปจะสร้างหน่วยงานเปล่าเพิ่มอีกใบ

## 3. OTP — ชั้นที่สองของการเข้าสู่ระบบด้วยรหัสผ่าน

6 หลักจาก `randomInt` (ไม่ใช่ `Math.random`) เก็บเป็น **bcrypt cost 8** ในตาราง `iam.otp_code`
อายุ 10 นาที (`OTP_TTL_MINUTES`) ผิดได้ 5 ครั้ง (`OTP_MAX_ATTEMPTS`) แล้วรหัสนั้นถูกเผาทิ้ง

- ขอรหัสใหม่ = ปิด (`consumed_at`) รหัสเก่าที่ยังไม่ถูกใช้ทั้งหมด ไม่มีรหัสใช้ได้พร้อมกันหลายตัว
- `POST /api/auth/login/resend-otp` **ต้องมี OTP ของรอบนั้นค้างอยู่ก่อน** ไม่งั้นตอบ 409
  มิฉะนั้น endpoint นี้จะกลายเป็นเครื่องยิงอีเมลไปที่อยู่ใดก็ได้
- ข้อความตอบกลับตอนรหัสผ่านผิดเหมือนกันทุกกรณี ไม่บอกว่าอีเมลนั้นมีอยู่จริงหรือไม่

`OtpPurpose` มีสองค่า — `LOGIN` ใช้อยู่จริง ส่วน `REGISTRATION` เหลือจากตอนที่การเปิดใช้งาน
บัญชียังใช้ OTP ทางอีเมล ตอนนี้การเปิดใช้งานเป็น ThaID ทางเดียว ไม่มีเส้นทางไหนออก
OTP แบบ `REGISTRATION` อีกแล้ว

### 3.1 ลิงก์ตั้งรหัสผ่านใหม่ — ผู้ดูแลระบบสั่งออก เจ้าตัวตั้งเอง

การ์ด "API ให้ system admin reset password ให้ user" (2026-09-18) ก่อนหน้านั้นคนที่ลืมรหัสผ่าน
ไม่มีทางกลับเข้าระบบเลยนอกจาก ThaID — activation key ใบเดิมถูกเผาไปแล้ว และไม่มีปุ่ม
"ลืมรหัสผ่าน" ระบบเป็น invite-only จึงให้ผู้ดูแลระบบเป็นคนเริ่ม ไม่เปิดให้กดขอเอง

| | |
|---|---|
| ออกที่ไหน | `POST /api/admin/users/password-reset` `{ email }` ด้วย `x-admin-token` — 202 พร้อม `expiresAt` **ไม่มีโทเคนในคำตอบ** (checkout ที่ไม่ตั้ง SMTP พิมพ์ลิงก์ลง log เหมือนคำเชิญ) |
| หน้าตา | 32 ไบต์ base64url ในลิงก์ `{APP_URL}/reset-password?token=…` |
| เก็บอย่างไร | `iam.password_reset_token.token_hash` = HMAC-SHA-256(`ACTIVATION_KEY_SECRET`, token) — กุญแจเดียวกับ activation key เหตุผลเดียวกัน |
| อายุ | `PASSWORD_RESET_TTL_MINUTES` (60) — นาที ไม่ใช่วัน เพราะแอดมินเพิ่งคุยกับเจ้าตัว |
| ใช้ได้กี่ครั้ง | ครั้งเดียว (`used_at`) หนึ่งบัญชีมีใบที่ใช้ได้ทีละใบ ออกใบใหม่ = ใบเก่า `revoked_at` |
| รับบัญชีไหน | `ACTIVE` เท่านั้น — `PENDING` ยังไม่มีรหัสผ่าน (ให้ resend คำเชิญ) `SUSPENDED`/`DEACTIVATED` ตั้งไปก็เข้าไม่ได้ (409 `invalid_state` บอกทางออก) |
| ใช้ที่ไหน | `GET /api/auth/password-reset?token=` ตรวจลิงก์ (410 `expired`/`used`/`revoked`/`not_found`) แล้ว `POST /api/auth/password-reset` `{ token, password, confirmPassword }` กฎรหัสผ่านชุดเดียวกับ `/activate` |
| ผลข้างเคียง | เขียน `password_hash`, เผาโทเคน, **เพิกถอน session ทุกใบ** (`PASSWORD_CHANGED`) ใน transaction เดียว — `updateMany` ที่มี `used_at IS NULL` ใน WHERE กันสองคำขอพร้อมกันด้วยลิงก์เดียว |
| ไม่ทำอะไร | **ไม่ออก session** ต้องไปเข้าสู่ระบบด้วยรหัสใหม่ + OTP เหมือนปกติ ไม่งั้นลิงก์ในอีเมลฉบับเดียวจะข้ามชั้นที่สองของการเข้าสู่ระบบไป |
| audit | `PASSWORD_RESET_REQUESTED` (actor = ระบบ ตามข้อ 4) แล้ว `PASSWORD_RESET_COMPLETED` (actor = เจ้าของบัญชี) — ใบ REQUESTED ที่ไม่มี COMPLETED **`result = SUCCESS`** ตามมาคือลิงก์ที่ไม่มีใครใช้สำเร็จ ลิงก์ที่กดแล้วใช้ไม่ได้ก็ได้ `PASSWORD_RESET_COMPLETED` เหมือนกันแต่ `result = FAILURE`, actor `ANONYMOUS` และ `failure_reason` เป็นรหัสเดียวกับ `error` ที่ตอบไป (`expired` · `revoked` · `used` · `inactive` · `not_found`) subject เป็นบัญชีของลิงก์นั้น (ว่างเมื่อ `not_found`) — แถวนี้แปลว่ามีคนกดลิงก์ ไม่ได้แปลว่ารหัสผ่านเปลี่ยน |

เป็นตารางของตัวเองเพราะ `activation_key` บังคับ `organization_id` + `role_id` และ `otp_code`
เก็บ bcrypt ค้นด้วยโทเคนในลิงก์ตรง ๆ ไม่ได้ Postman: `U15`

## 4. `x-admin-token` — shared secret ไม่ใช่ session

`/api/admin/*` ทั้งหมด (ยกเว้น `/api/admin/logs/*` ที่ใช้ token ของตัวเอง — 4.3) ป้องกันด้วย header `x-admin-token` เทียบกับ `ADMIN_API_TOKEN`
ตรง ๆ เพราะสเปกระบุว่าขั้นตอนเชิญผู้ใช้ "ไม่มี UI แต่ต้องมี api" ผู้เรียกจึงเป็นสคริปต์
ไม่ใช่เบราว์เซอร์ที่มี session

ข้อจำกัดที่ควรรู้ (ยอมรับไว้ ไม่ใช่มองข้าม): ไม่หมดอายุ ไม่หมุน ไม่ผูกกับตัวบุคคล —
`audit_event` ของงานที่ทำผ่านเส้นทางนี้จึงบอกได้แค่ว่า "ระบบทำ" ไม่ได้บอกว่าเจ้าหน้าที่คนไหน
ถ้าวันหนึ่งต้องรู้ตัวบุคคล ต้องเปลี่ยนไปใช้บัญชีจริงที่มี role `SYSTEM_ADMINISTRATOR`

**สิ่งที่บอกได้คือ token ใบไหน** — `requireAdminToken` ที่ token ผ่านประทับคำขอเป็น `source_component = admin-portal`
และ `logAudit` เติม `metadata.admin_token_fp` (12 ตัวแรกของ SHA-256 ของ token — `tokenFingerprint()` ใน `lib/auth.ts`)
ลงทุกแถวของคำขอนั้น รวมแถวที่ helper ลงชื่อบัญชีเป้าหมายเป็น actor (`docs/21-activity-log.md` §2.3 §3.4) หมุน token แล้ว
แถวใหม่จึงแยกจากแถวเก่าได้ และการใช้ token เก่าเห็นได้ (4.1) · **ทุกการเรียก `/api/admin*` ไม่ว่าอ่านหรือเขียน token ผ่านหรือไม่**
(ยกเว้นคำขอที่ถึง router ของ `/api/admin/logs` ซึ่งบันทึกตัวเองเป็น `AUDIT_LOG_READ` และ CORS preflight `OPTIONS`)
ถูกบันทึกเป็น `ADMIN_API_REQUEST` ใน log store ด้วย (`docs/21` §4.11) — `GET /api/admin/users?cid=…` ตอบเลขบัตรและอีเมลแบบไม่ปิด
บันทึกนี้จึงตอบได้ว่า token ใบไหนค้นเลขบัตรของใคร (เก็บเป็น key HMAC ไม่ใช่เลขจริง)

**token ต้องยาวอย่างน้อย 128 บิต** — ใช้ `openssl rand -hex 32` (256 บิต) fingerprint ข้างบนไม่มีกุญแจ ใครอ่าน log ได้จึงทดสอบ
คำเดาแบบ offline ได้ถ้า token สั้นหรือเดาได้ backend ที่รันแบบ production พร้อม token ที่สั้นกว่า 32 ตัวหรือขึ้นต้นด้วย `dev-`
พิมพ์คำเตือนตอนบูต (4.1)

การเทียบใช้ `timingSafeEqual` แล้วตั้งแต่ 2026-08-16 (เดิมเป็น `!==` ธรรมดา)
โดย hash ทั้งสองฝั่งก่อนเทียบ — `timingSafeEqual` โยนเมื่อความยาวไม่เท่ากัน ซึ่งเท่ากับ
บอกความยาวของความลับออกไป การ hash ก่อนทำให้ buffer ยาวเท่ากันเสมอและความยาวจริงหายไปด้วย
(`activationKeyMatches()` ไม่ต้องทำขั้นนี้เพราะเทียบ hash กับ hash อยู่แล้ว)

**ตัดสินแล้วว่ายอมรับข้อจำกัดข้างบนต่อไปในตอนนี้** (2026-08-16): การย้ายไปใช้บัญชีจริง
ที่มี role `SYSTEM_ADMINISTRATOR` เป็นงานของการ์ด Admin Portal ซึ่งยังไม่มีหน้าจอ —
ทำตอนนี้จะพัง Postman collection และ notebook ที่ใช้เส้นทางนี้อยู่ โดยยังไม่มีอะไรมาแทน

**อัปเดต 2026-10-05 (การ์ด Admin Console):** ทำแล้วโดยไม่ถอด token — guard ของ `/api/admin/*` เปลี่ยนเป็น `requireAdmin`
ซึ่งรับได้สองทาง: `x-admin-token` (หรือคำขอที่ไม่มี cookie เลย) ไปทาง `requireAdminToken` เหมือนเดิมทุกอย่าง ส่วนคำขอที่มี
session ของบัญชีที่ถือ `SYSTEM_ADMINISTRATOR` คือหน้า `/console` — actor ในแถว audit เป็นคนนั้น (`adminActorId()`),
`metadata.admin_via = SESSION`, via ใน log store เป็น `ADMIN_SESSION` และคำขอที่ไม่ใช่ GET ต้องมี `Origin` ของระบบ (403
`csrf_origin`) เพราะ cookie เป็น `SameSite=lax` ซึ่งไม่กันโดเมนย่อยของไซต์เดียวกัน token จึงเหลือไว้สำหรับ Postman, notebook
และการตั้งผู้ดูแลระบบคนแรกของ deployment ใหม่ (`POST /api/admin/invitations` ด้วย role `SYSTEM_ADMINISTRATOR`)

คอลเลกชัน Postman ของ endpoint กลุ่มนี้อยู่ที่ `docs/bdi-admin-portal.postman_collection.json`
(สร้างหน่วยงาน + ส่งลิงก์เปิดใช้งาน + ดู/ยกเลิกคำเชิญ)

### 4.1 คำขอที่ถูกปฏิเสธ — และการเฝ้า token ตัวที่ปลดไปแล้ว

`x-admin-token` ที่ผิดหรือไม่ได้ส่งมาถูกนับทุกครั้ง และลง `audit_event` เป็น `ADMIN_TOKEN_REJECTED`
(`backend/src/lib/token-rejection.ts`) โดยไม่เก็บค่าที่ส่งมา เก็บแค่ `token_fp` คือ 12 ตัวแรกของ
SHA-256 ของค่านั้น (`tokenFingerprint()` ใน `lib/auth.ts`) ซึ่งพอบอกได้ว่า "ค่านี้คือ token เก่าหรือ
เปล่า" fingerprint แบบไม่มีกุญแจของค่าสั้น ๆ เดาย้อนกลับได้ token จึงต้องยาวอย่างน้อย 128 บิต
(`openssl rand -hex 32`) — fingerprint ของ token ที่ใช้อยู่ก็ลงทุกแถวของ admin API ด้วย
(`metadata.admin_token_fp`) token ที่เดาได้จึงให้ใครก็ตามที่อ่าน log ได้ทดสอบคำเดาแบบ offline จนได้ token
ที่เปิด `/api/admin` ทั้งหมด backend ที่รันแบบ production พร้อม token ที่สั้นกว่า 32 ตัวหรือขึ้นต้นด้วย `dev-`
พิมพ์ `[backend] คำเตือน: ADMIN_API_TOKEN …` ตอนบูต (`adminTokenLooksWeak()` ใน `lib/auth.ts` เกณฑ์หยาบ:
วลียาว 32 ตัวก็ยังเดาได้) แค่เตือน ไม่ปฏิเสธการบูต เพราะ deploy ที่ออกก่อนหมุน token ต้องไม่ทำให้ backend
วนรีสตาร์ตจนหน้าเว็บล่ม **หมุน token ก่อน deploy ที่เริ่มเขียน fingerprint** ไม่ใช่หลังจากนั้น

ไม่ได้เขียนทุกครั้ง เพราะ 401 ใครก็ยิงได้ไม่จำกัด และตารางนี้ไม่มี retention:

| สิ่งที่เกิด | แถวที่ได้ |
|---|---|
| ครั้งแรกจาก IP หนึ่งในหน้าต่าง 10 นาที | แถวทันทีหนึ่งแถว |
| ครั้งถัดไปจาก IP เดิมในหน้าต่างเดิม | นับอย่างเดียว แล้วได้แถวสรุปแถวเดียวตอนหน้าต่างปิด (`suppressed_count` · `token_fps` · `paths`) |
| แถวทันทีรวมทุก IP ครบ 20 แถวในช่วง 10 นาทีที่ผ่านมาแล้ว | IP ที่ยังไม่มีหน้าต่างนับรวมในถังเดียว แถวของถังมี `throttle_overflow: true` และไม่มี IP กับ user agent |
| ค่าที่ได้เป็น IP มาไม่ใช่ IP | ทุกค่าใช้หน้าต่างเดียวกัน แถวไม่มี IP แต่มี `ip_unparsed: true` |
| fingerprint อยู่ใน `ADMIN_TOKEN_WATCH_FPS` | แถวของตัวเองทันที มี `watched_token: true` และอยู่นอกงบข้างบน — ที่มาละแถวต่อนาที รวมไม่เกิน 60 แถวในช่วง 10 นาทีใด ๆ |
| ↳ ที่มาเดิมยิง token นั้นซ้ำภายในนาทีเดียวกัน | ไม่มีแถวใหม่ นับเข้าหน้าต่างเงียบของที่มานั้น ซึ่งแยกจากหน้าต่างปกติของที่มาเดียวกัน (ไม่เขียนแถวทันทีและไม่กินงบ 20 แถว) แล้วได้แถวสรุปที่มี IP และมี `suppressed_count` เท่ากับ `watched_suppressed_count` — token อื่นจากที่มาเดียวกันยังไปทางปกติ ได้แถวทันทีของตัวเองเหมือนไม่เคยมี T |
| ↳ งบ 60 แถวของ token ที่เฝ้าไว้หมดแล้ว | ไปทางปกติเหมือนคำขออื่น: ใช้งบ 20 แถวร่วมกัน แถวทันทีที่ได้มี `watched_over_budget: true` (**ไม่ใช่** `watched_token`) งบนั้นหมดด้วยก็ลงถังรวม ครั้งที่ถูกนับอยู่ใน `watched_suppressed_count` ของแถวสรุป |

งบทั้งสองเป็นหน้าต่างเลื่อน ไม่ใช่รอบ 10 นาทีที่ล้างงบเมื่อครบกำหนด (`createBudget()`) — ใช้งบหมด
ก่อนรอบปิดหนึ่งวินาทีแล้วยิงอีกชุดหลังรอบใหม่เปิดจึงไม่ได้แถวเพิ่มอีกเท่าตัว ช่วง 10 นาทีใด ๆ ก็ตาม
ได้แถวไม่เกิน: แถวทันที 20 + ของถังรวม 1 + แถวสรุปของหน้าต่างเหล่านั้น + แถว `watched_token` 60 +
แถวสรุปของที่มาที่ยิง token ที่เฝ้าไว้ซ้ำ (ไม่เกินจำนวนที่มาที่ได้แถว `watched_token`) คนที่ไม่ได้ถือ
token เก่าจริงทำได้แค่ส่วนแรก

**เพดานข้างบนเป็นของ `ADMIN_TOKEN_REJECTED` อย่างเดียว ไม่ได้คุ้มครองทั้งตาราง** (ยอมรับไว้ 2026-09-29
ไม่ใช่มองข้าม) แถวต่อไปนี้ใครก็เขียนได้โดยไม่ต้องมีอะไรอยู่ในมือ หนึ่งคำขอหนึ่งแถว ไม่มีหน้าต่าง ไม่มีงบ
และ backend ไม่มี rate limit เลย:

| แถว | สิ่งที่ผู้ยิงต้องมี |
|---|---|
| `LOGIN_FAILED` `INVALID_CREDENTIAL` (มีมาก่อนการ์ด activity log) | อีเมลใดก็ได้ — อีเมลที่ไม่มีบัญชีไม่ต้องรอ bcrypt ด้วยซ้ำ |
| `LOGIN_FAILED` `OTP_NOT_PENDING` | อีเมลใดก็ได้ แถวเก็บอีเมลที่พิมพ์มา |
| `IDENTITY_VERIFICATION_FAILED` `state_not_found` | `state` ใดก็ได้ |
| `PASSWORD_RESET_COMPLETED` `FAILURE` `not_found` | โทเคนใดก็ได้ |
| `IDENTITY_VERIFICATION_STARTED` | ไม่มี — ทุก `POST /thaid/start` ขา login พร้อมแถว `integration_operation` ของมัน (แถวนั้นมีมาก่อนการ์ด) |

**ขนาดของแต่ละแถวมีเพดาน ไม่ใช่แค่จำนวน** ข้อความที่ผู้ยิงเขียนเองลงแถวเหล่านี้ได้มีสามช่อง: อีเมลที่พิมพ์มา
(ไม่เกิน 254 ตัว ตาม `emailSchema`) `user_agent` (ไม่เกิน 512 ตัว ตาม `storedUserAgent()`) และ `ip_address`
(ต้องเป็น IP จริงตาม `net.isIP()` ไม่งั้นเป็น null) ส่วน `state` กับโทเคนไม่ลงแถว มีแค่ id และ `failure_reason`
ของ ThaID ถูกตัดที่ 64 ตัว แถวหนึ่งจึงพาข้อความของผู้ยิงมาได้ราว 1 KB ต่อคำขอ ก่อน 2026-09-29 อีเมลไม่มีเพดาน
เพดานเดียวคือ body 1 MB — ลองแล้ว อีเมลสุ่ม 20,000 ตัวผ่าน `login` และ `verify-otp` ได้แถวละ 20 KB การยิงถล่ม
จึงโตเป็นหลายพันเท่าของที่คำว่า "หนึ่งคำขอหนึ่งแถว" ฟังดู เพิ่มช่องใหม่ที่เก็บข้อความจากคำขอที่ยังไม่ล็อกอิน
ต้องมีเพดานความยาวของมันเองด้วย

วนยิงตรงเข้า backend ก็ขยาย `audit_event` ได้เท่าอัตราคำขอ และตั้งแต่มีสำเนาใน MongoDB ก็ขยายที่นั่นด้วย
ที่ไม่ throttle แบบ `ADMIN_TOKEN_REJECTED`: throttle แค่บางแถวไม่ได้กันอะไร ตราบที่ทางอื่นในกลุ่มเดียวกันยังเปิด —
`INVALID_CREDENTIAL` ของบัญชีที่มีอยู่จริงคือหลักฐานว่ามีคนเดารหัสผ่านของคนคนหนึ่ง ซึ่งเป็นสิ่งที่ log นี้ต้องเก็บ
ทีละแถว และ `integration_operation` ของ `/thaid/start` ก็โตตามคำขออยู่ดี ขอบเขตที่ได้ผลจริงคือ rate limit ของ
`/api/auth/*` ซึ่งต้องมีที่อยู่ของผู้เรียกที่เชื่อได้ก่อน: IP ในระบบนี้ผู้เรียกเขียนเอง (ย่อหน้าถัดไป) limit ต่อ IP
จึงถูกเลี่ยงได้ด้วยการยิงตรง ส่วน limit รวมทั้งระบบกลายเป็นคันโยกที่ทำให้ทุกคนเข้าสู่ระบบไม่ได้ จึงรอจนตัดสินเรื่อง
X-Forwarded-For และการปิดพอร์ต 4000 จากภายนอก ระหว่างนี้ดูว่ามีการยิงถล่มหรือไม่ด้วย:

```sql
select date_trunc('minute', occurred_at) as minute, action,
       metadata_json->>'failure_reason' as reason, count(*)
from audit.audit_event
where actor_type = 'ANONYMOUS' and occurred_at > now() - interval '1 hour'
group by 1, 2, 3 order by 1 desc, 4 desc;
```

**IP ในแถวเหล่านี้คือสิ่งที่ผู้เรียกเขียนมาเอง** เว้นแต่ชั้นนอกสุดต่อท้ายที่อยู่จริงให้
`trust proxy 1` อ่านค่าสุดท้ายของ X-Forwarded-For และไม่มีชั้นไหนในระบบเราต่อท้ายที่อยู่จริงเลย:
backend ยิงตรงได้ และ proxy ของหน้าเว็บ (`frontend/app/api/[...path]/route.ts`) ส่ง
X-Forwarded-For ของเบราว์เซอร์ต่อไปทั้งดุ้น — Next เติม header นี้จาก socket ก็ต่อเมื่อไม่มีมา
(`??=`) ยิงผ่านหน้าเว็บของ dev checkout พร้อม `X-Forwarded-For: 198.51.100.200` จึงได้แถวที่ IP
เป็น `198.51.100.200` บน production ค่านี้ถูกเท่าที่ Cloudflare ต่อท้ายที่อยู่ของผู้ที่ต่อเข้ามาจริง
(เอกสารของ Cloudflare บอกว่าต่อท้าย ยังไม่ได้ยืนยันกับ tunnel ของเรา) ส่วนใครที่เข้าถึงพอร์ต 3000 หรือ
4000 ของเครื่องได้ตรง ๆ ตั้งค่าเองได้ทั้งหมด

`metadata.path` เป็นรูปแบบ ไม่ใช่ข้อความที่ผู้ยิงพิมพ์ — ถอด `%xx` ซ้ำจนไม่เปลี่ยน (ไม่เกินสี่รอบ แต่ละรอบผ่าน NFKC
`＠` `﹫` และเลขเต็มความกว้างจึงเป็นตัวจริง) แล้วอีเมล → `:email` ท่อนที่ยังมี `@` → `:email` ทั้งท่อน UUID → `:id`
ตัวอักษรนอก `A-Z a-z 0-9 / _ . : -` → `_` กลุ่มเลขที่ชี้ตัวคนได้ → `:n` และยาวไม่เกิน 120 ตัว
"กลุ่มเลข" คือเลขที่ติดกันหรือคั่นด้วย `-` `.` `_` `:` ไม่เกินสามตัวติดกัน (ช่องว่างกลายเป็น `_`
ไปก่อนแล้ว) และนับเป็นเลขชี้ตัวคนเมื่อมีเลขติดกัน 6 หลัก หรือรวมทั้งกลุ่ม 9 หลักขึ้นไป —
`1-1017-00203-45-1`, `1101700203451`, `1 1017 00203 45 1` และ `081-234-5678` กลายเป็น `:n` ทั้งหมด

กฎกลุ่มไม่รวมเลขที่คั่นด้วย `/` หรือด้วยตัวคั่นสี่ตัวขึ้นไป และ `%xx` ที่ encode ซ้อนเกินสี่ชั้น
(`%252525252D` ถอดสี่รอบแล้วยังเหลือ `%2D` ซึ่งกลายเป็น `_2D` และตัว `D` ตัดกลุ่ม) จึงมีชั้นที่สอง: ถ้าทั้ง path ยังเหลือเลขรวม 9 ตัวขึ้นไป
เลขทุกช่วงใน path กลายเป็น `:n` — `/users/1/1017/00203/45/1` และ `/users/1----1017----00203----45----1`
ได้ `/users/:n/:n/:n/:n/:n` (หรือ `:n----:n…`) ส่วนแบบ encode ห้าชั้นได้ `:n_:nD:n…` · encode ซ้อนไม่เกินสี่ชั้น
(`/users/1%252D1017%252D00203%252D45%252D1`) ถอดจนเหลือ `-` แล้วเข้ากฎกลุ่มชั้นแรกเป็น `/users/:n` (ลองแล้ว 2026-10-01) เส้นทางของ admin API ที่มีจริงมีเลขไม่เกิน 8 ตัว (UUID เป็น `:id` ไปก่อนแล้ว และ
`ORG-REG-2026-0002` กับวันที่ `2026-09-28` มี 8 หลัก) จึงยังอ่านได้ เลขที่ encode ไว้กี่ชั้นก็เหลือเป็น
เลขฐานสิบหกให้นับเสมอ เลขบัตรครบ 13 หลักในรูปตัวเลขจึงไม่มีทางผ่าน **แต่ตัวอักษรยังเหลือได้ถึง 120
ตัว**: คนที่ตั้งใจสะกดเลขเป็นตัวอักษร (หรือ base64) ยังเขียนลงช่องนี้ได้ อ่านมันเป็นข้อความของผู้ยิงเสมอ

`user_agent` ของแถวเหล่านี้ (และของ `LOGIN_FAILED` และแถวอื่นก่อนล็อกอิน) ก็เป็นข้อความที่ผู้ยิง
เขียนเอง `logAudit` ตัดให้เหลือไม่เกิน 512 ตัว และแทนกลุ่มเลขที่คั่นด้วย `-` `_` `:` หรือช่องว่าง
ซึ่งรวม 9 หลักขึ้นไปด้วย `:n` ก่อนเก็บ (`storedUserAgent()` ใน `lib/audit.ts` ใช้กับทุกแถวของ
`audit_event`) กฎหลวมกว่าของ path เพราะต้องไม่แตะ user agent จริง: เลขเวอร์ชันมีจุด
(`Edg/151.0.3405.80`) และมีเลขติดกัน 8 หลัก (`Gecko/20100101`) ที่ยังผ่านได้คือ ตัวอักษร เลขที่คั่น
ด้วย `.` หรือ `/` และตัวคั่นสี่ตัวขึ้นไป ส่วน `iam.session` และหลักฐานการลงนามเก็บค่าที่ได้รับ
เพราะเกิดได้หลังยืนยันตัวตนแล้วเท่านั้น

**ทุกครั้งที่ปลด token ให้เพิ่ม fingerprint ของตัวเก่าลง `ADMIN_TOKEN_WATCH_FPS`** แถวสรุปจด
fingerprint ได้แค่ 20 ค่าต่อหน้าต่าง คนที่ยิงค่ามั่ว ๆ 20 ค่าก่อนแล้วค่อยใช้ token เก่า จะเหลือ
ร่องรอยแค่ `token_fps_truncated: true` รายการเฝ้าทำให้ token เก่าได้แถวของตัวเองเสมอ

คำนวณ **ก่อน** เปลี่ยนค่าใน `.env` จากไดเรกทอรีของ deployment นั้น คำสั่งนี้อ่านค่าจาก `.env`
ทาง stdin ค่าจริงจึงไม่ขึ้นจอ ไม่อยู่ใน argv ของ process ไหน และไม่เข้า shell history ผลที่ได้
เท่ากับ `tokenFingerprint()` ทุกตัวอักษร:

```bash
grep '^ADMIN_API_TOKEN=' .env | cut -d= -f2- | docker compose exec -T backend node -e 'let s="";process.stdin.on("data",(c)=>(s+=c)).on("end",()=>console.log(require("node:crypto").createHash("sha256").update(s.trim().replace(/^["\x27]|["\x27]$/g,"")).digest("hex").slice(0,12)))'
```

ถ้า token ที่จะเฝ้าไม่ได้อยู่ใน `.env` (เช่นหลุดมาจากไฟล์ Postman ของใครสักคน) ใช้
`read -rs T && printf %s "$T" | node -e '…'` ด้วยสคริปต์เดียวกัน — `read -s` ไม่แสดงค่าที่วาง
แล้วแก้ `.env` ครั้งเดียวให้ได้ทั้งสองบรรทัด:

```bash
ADMIN_API_TOKEN=<ค่าใหม่จาก openssl rand -hex 32>
ADMIN_TOKEN_WATCH_FPS=<fingerprint ตัวที่เพิ่งปลด>,<fingerprint ที่เคยใส่ไว้ก่อนหน้า>
```

จากนั้น recreate container ของ backend (`restart` ไม่อ่าน `.env` ใหม่) แถวที่ได้ดูด้วย:

```sql
select occurred_at, ip_address,
       case when metadata_json ? 'watched_token' then 'งบของ token ที่เฝ้า'
            when metadata_json ? 'watched_over_budget' then 'เกินงบ 60 — ใช้งบรวม'
            else 'แถวสรุป' end as row_kind,
       metadata_json->>'path' as path,
       metadata_json->>'watched_suppressed_count' as counted_only
from audit.audit_event
where action = 'ADMIN_TOKEN_REJECTED'
  and (metadata_json ? 'watched_token' or metadata_json ? 'watched_over_budget'
       or metadata_json ? 'watched_suppressed_count')
order by occurred_at desc limit 50;
```

แถว `watched_token` ไม่เกิน 60 ในช่วง 10 นาทีใด ๆ ถ้าเห็นครบ 60 หรือเห็น `watched_over_budget` แปลว่า
token เก่าถูกใช้จากที่มามากกว่าที่งบให้แถวได้ ให้ดู `counted_only` ของแถวสรุปประกอบ แถวสรุปของ
ถังรวมไม่มี IP

ค่าที่ไม่ใช่ฐานสิบหก 12 ตัวถูกข้ามพร้อมคำเตือนตอนบูต (`[env] ADMIN_TOKEN_WATCH_FPS: ข้าม …`)
โดยไม่พิมพ์ค่านั้นออกมา เผื่อเป็น token จริงที่วางผิดช่อง

### 4.2 การพิสูจน์ตัวตนที่ถูกบันทึก

ทุกขั้นของทุกโทเคนในเอกสารนี้ลง `audit_event` **รวมความล้มเหลว** (การ์ด activity log ขั้น 1) ยกเว้นคำขอที่ zod ปฏิเสธรูป (400
`validation`) และ body ที่อ่านไม่ออก รายละเอียดของแต่ละแถวอยู่ใน `docs/21-activity-log.md` หมวด 4:

| โทเคน | แถว |
|---|---|
| รหัสผ่าน + OTP | `LOGIN_OTP_ISSUED` (ออก OTP ไม่เก็บรหัส) · `LOGIN_SUCCEEDED` · `LOGIN_FAILED` แยกด้วย `failure_reason`: `INVALID_CREDENTIAL` · `ACCOUNT_PENDING` / `ACCOUNT_SUSPENDED` / `ACCOUNT_DEACTIVATED` · `OTP_NOT_PENDING` · `OTP_EXPIRED` · `OTP_LOCKED` · `OTP_INVALID` · `ACCOUNT_INACTIVE` — อีเมลที่**พิมพ์มา**เก็บดิบใน Postgres (สำเนาใน log store ปิดไว้) |
| Session id | `SESSION_REVOKED` ทุกการเพิกถอน พร้อม `reason` (ข้อ 1.4) — การสร้าง session ไม่มีแถวของตัวเอง |
| Activation key | `ACTIVATION_KEY_ISSUED` · `USED` · `REVOKED` · `EXPIRED` (เขียนตอนมีคนเปิดลิงก์เก่า) · `INVITATION_DELETED` |
| ลิงก์ตั้งรหัสผ่าน | `PASSWORD_RESET_REQUESTED` · `PASSWORD_RESET_COMPLETED` (`SUCCESS` หรือ `FAILURE` ข้อ 3.1) |
| ThaID · `state` · `nonce` | `IDENTITY_VERIFICATION_STARTED` · `IDENTITY_VERIFIED` · `IDENTITY_VERIFICATION_FAILED` (รวม `state_not_found` `state_expired` `CID_MISMATCH` `nonce_mismatch`) · `LOGIN_SUCCEEDED` `method: THAID` · `LOGIN_FAILED` `THAID_NO_MATCHING_ACCOUNT` — `metadata.thaid_subject` คือ `sub` ของ DOPA ซึ่งเป็นเลขบัตร 13 หลักเต็มไม่ว่า `THAID_USE_PID` จะเป็นอะไร |
| `x-admin-token` | งานที่ token ผ่าน: `admin-portal` + `admin_token_fp` บนแถวของงานนั้น · ไม่ผ่าน: `ADMIN_TOKEN_REJECTED` (4.1) · ทุกการเรียกยกเว้น `/api/admin/logs/*` และ `OPTIONS`: `ADMIN_API_REQUEST` ใน log store |
| `x-log-token` | ทุกการอ่านที่ส่งข้อมูล: `AUDIT_LOG_READ` ก่อนส่ง — `GET /status` (ไม่มีข้อมูลบุคคล) ไม่มีบันทึกใดเลย และคำขอที่ถูกปฏิเสธก่อนขั้นอ่านก็ไม่มี (`docs/21` §4.12) · ไม่ผ่าน: `LOG_TOKEN_REJECTED` (4.3) |

แถวเหล่านี้ใครก็สร้างได้บางส่วนโดยไม่ต้องมีอะไรในมือ — ตารางกับข้อจำกัดอยู่ใน 4.1

### 4.3 `x-log-token` — token ของ API อ่าน log

`/api/admin/logs/*` (`backend/src/routes/admin-logs.ts`) อ่าน activity log ทุกการกระทำของทุกคน และ error ของระบบ — ป้องกันด้วย
`x-log-token` เทียบกับ `LOG_READ_TOKEN` **แยกจาก `ADMIN_API_TOKEN` โดยตั้งใจ**: admin token เคยหลุดมาแล้ว และคนถือ admin token ไม่ควร
ได้สิทธิ์อ่าน log ไปด้วย Postman ของมันก็แยก (`docs/bdi-activity-log.postman_collection.json`) และ proxy ของหน้าเว็บตอบ 404 ให้ path นี้

- เทียบด้วย `secretMatches()` (hash ทั้งสองฝั่งก่อน `timingSafeEqual` แบบเดียวกับ admin token) ไม่ผ่าน → 401 และ `LOG_TOKEN_REJECTED`
  ด้วยตัวบันทึกเดียวกับ `ADMIN_TOKEN_REJECTED` (หน้าต่างและงบแยกกัน ไม่มีรายการเฝ้า)
- ไม่ใช่ตัวตน: ทุกคำขอต้องมี `x-log-reader` (อีเมลที่**ประกาศ** ไม่ได้พิสูจน์) endpoint ที่เปิดประวัติของคนบังคับ `x-log-reason` ด้วย
  (เหตุผล 10–500 ตัว percent-encode — ใน URL ไม่รับ) ทั้งคู่ลงแถว
  `AUDIT_LOG_READ` พร้อม `token_fp` ของ token ที่ใช้ — ตัวที่ผูกกับ token จริงคือ fingerprint
- **production ไม่รับค่าตัวอย่าง** (`dev-…`, `…change-me`) และค่าที่สั้นกว่า 32 ตัว — ถือว่าไม่ได้ตั้ง API ตอบ 503 `log_access_disabled`
  พร้อมคำเตือนตอนบูต (เข้มกว่าของ admin token ที่แค่เตือน: token นี้ใหม่ ไม่มีอะไรพังถ้าปฏิเสธ) dev มีค่า `dev-log-token-change-me`
- ไม่หมดอายุ ไม่หมุนเอง — หมุนด้วยการเปลี่ยน `.env` แล้วสร้าง backend ใหม่ ใช้ `tokenFp=<fp เก่า>` ของ Postman G8 ดูการใช้ค่าเก่า

### 4.4 `x-report-token` — Next server รายงาน error ของตัวเอง

`POST /api/client-errors` ไม่ต้องล็อกอิน (error เกิดได้ตั้งแต่หน้า login) รายงานจากเบราว์เซอร์จึงเชื่อไม่ได้ทั้งก้อน รายงานที่มี `x-report-token`
ตรงกับ `INGEST_SERVER_TOKEN` (และ `x-report-source: frontend-server`) ถูกเก็บเป็น `service: "frontend-server"` นอกนั้นทุกตัวเป็น `browser`
ที่ `ingest.verified: false` — backend เรียกได้ตรงไม่ผ่านหน้าเว็บ header อย่างเดียวจึงพิสูจน์อะไรไม่ได้ (`docs/21` §5.12)

- **ค่าเดียวกันทั้ง backend และ frontend** Next server อ่านตอนรัน — ห้ามเป็น `NEXT_PUBLIC_` ไม่งั้นค่าลงบันเดิลของเบราว์เซอร์
- proxy ของหน้าเว็บลบ `x-report-*` ที่เบราว์เซอร์ส่งมาทิ้ง
- production ไม่รับค่าตัวอย่างหรือที่สั้นกว่า 32 ตัว (ถือว่าไม่ได้ตั้ง) · ไม่ได้ตั้งหรือไม่ตรงกันระหว่างสองฝั่ง: รายงานของ Next server ยังถูกเก็บ
  แค่เป็น browser ที่ยืนยันไม่ได้ ไม่มีอะไรบูตไม่ขึ้น — **แต่ไม่ใช่แค่ป้าย**: route ถูกทิ้ง (error ข้อความเดียวกันของทุกหน้ารวมเป็น issue เดียว) และติดกติกาของ
  เบราว์เซอร์ทั้งหมด (30 ต่อนาทีของ IP ของ container frontend · งบไบต์ `browser` · อีเมลแจ้งเตือนไม่เกิน 5 ต่อหกชั่วโมงแบบไม่มีข้อความ — `docs/21` §5.12)

## 5. โทเคนจาก ThaID — รับมาแล้วทิ้งทันที

`resolveIdentity()` ใน `lib/thaid.ts` ทำสามอย่างแล้วจบ

1. เอา `code` ไปแลกที่ `/api/v2/oauth2/token/` ด้วย Basic auth (`client_id:client_secret`)
2. ตรวจลายเซ็น **ES256** ของ `id_token` กับ JWKS ของกรมการปกครอง (แคช 1 ชั่วโมง เลือกคีย์
   ตาม `kid` ถ้าเจอ kid ที่ไม่รู้จักให้ล้างแคชแล้วดึงใหม่หนึ่งครั้ง) พร้อมตรวจ `aud` และ `iss`
3. ตรวจ claim `nonce` กับที่บันทึกไว้ตอนเริ่มคำขอ (ข้อ 7)
4. เรียก `/api/v2/oauth2/revoke/` คืน **ทั้ง access token และ refresh token** ทิ้ง
   แต่ละใบส่ง `token_type_hint` ตาม RFC 7009 แบบไม่รอผลและไม่ให้พัง flow

**access token, refresh token และ id_token ไม่เคยถูกเก็บลงฐานข้อมูล** ระบบนี้ใช้ ThaID เพื่อ
"ยืนยันตัวตนครั้งเดียว" ไม่ได้ใช้เรียก API อื่นของกรมการปกครองต่อ

ก่อน 2026-08-16 `revokeToken()` ส่งเฉพาะ access token — ถ้ากรมการปกครองออก refresh token
มาด้วย ใบนั้นจะถูกทิ้งเฉย ๆ แล้วยังมีชีวิตอยู่ฝั่งเขาจนหมดอายุ RFC 7009 §2.1 บอกว่าการ
เพิกถอน refresh token *ควร* ทำให้ access token ที่ออกจากใบเดียวกันตายตามไปด้วย แต่ "ควร"
ไม่ใช่ "ต้อง" และเราไม่รู้ว่าเขาทำแบบไหน จึงส่งทั้งสองใบ ไม่ใช่ใบเดียวแล้วหวังผลพลอยได้

**ยังไม่เคยเห็น refresh token จริง** — `TokenResponse` ประกาศไว้เป็น optional ตามสเปก
`resolveIdentity()` จึงเขียนลง log ว่ารอบนี้ได้มาหรือไม่ (แค่ "มี"/"ไม่มี" ไม่ใช่ตัว token)
เพื่อให้การยิงจริงบน `main` ตอบคำถามนี้ได้ — แต่ discovery document ของ sandbox
ประกาศ `grant_types_supported: ["authorization_code", "refresh_token"]` แล้ว
(`docs/07-thaid-integration.md` §4.4) การ revoke ใบที่สองจึงไม่ใช่โค้ดที่เขียนเผื่อลม ๆ แล้ง ๆ

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
อายุ 15 นาที (`THAID_STATE_TTL_MINUTES`) ยาวพอให้เปิดแอป ThaID บนมือถือแล้วกลับมา

หลังยืนยันผ่าน แถวเดิมทำหน้าที่เป็น "ใบเสร็จ" ให้ขั้นตั้งรหัสผ่านอีก 30 นาที
(`THAID_VERIFICATION_TTL_MINUTES`) — `POST /api/auth/activate` เรียก `latestVerification()`
อ่านจากฐานข้อมูล ไม่เชื่อคำบอกเล่าจากเบราว์เซอร์

## 7. OIDC `nonce` — ผูก id_token เข้ากับคำขอที่เราเริ่ม

`state` ตอบว่า "callback นี้มาจากคำขอที่เราเป็นคนเริ่ม" แต่ไม่ได้ตอบว่า "id_token ใบนี้
ออกให้คำขอนั้น" `nonce` (OIDC Core §3.1.2.1, RECOMMENDED สำหรับ code flow) ตอบข้อหลัง:
สุ่ม 24 ไบต์คู่กับ `state` เก็บใน `integration_operation.request_nonce` ส่งไปกับ
authorization request แล้วต้องกลับมาเป็น claim ใน id_token

**claim ที่ไม่ตรง กับ claim ที่ไม่มีมาเลย คนละเรื่องกัน**

| กรณี | ผล |
|---|---|
| `nonce` ไม่ตรง | ปฏิเสธ 403 เสมอ — id_token ใบนี้ไม่ได้ออกให้คำขอนี้ |
| `nonce` ไม่มีมา | เตือนใน log แล้วไปต่อ · ตั้ง `THAID_REQUIRE_NONCE=true` ให้ปฏิเสธ |

ที่ยอมให้ผ่านเมื่อ claim ไม่มา เพราะ **ยังไม่ได้ยืนยันว่ากรมการปกครองสะท้อน `nonce` กลับมา**
ปฏิเสธไว้ก่อนเท่ากับพังการยืนยันตัวตนทั้งระบบเพราะของที่สเปกเรียกว่า RECOMMENDED
เมื่อยิงจริงแล้วเห็นว่ามีมา ให้เปิดตัวแปรนั้นเป็น `true`

ทั้งสองกรณี **ไม่เพิกถอน activation key** ด้วยเหตุผลเดียวกับ `cid_unavailable`:
ผู้ใช้ไม่ได้ทำอะไรผิด ความผิดพลาดอยู่ฝั่งการตั้งค่าหรือฝั่ง IdP — และถ้าเป็นการยัด
id_token มาจริง การทำลายลิงก์ของเหยื่อก็จะกลายเป็นวิธียกเลิกลิงก์ของคนอื่นเสียเอง

**PKCE (RFC 7636) ยังไม่ได้ทำ** — OAuth 2.1 บังคับกับทุก client แต่ discovery document
ของ sandbox **ไม่ประกาศ** `code_challenge_methods_supported` ซึ่ง RFC 8414 §2 กำหนดให้เป็น
ที่ประกาศเรื่องนี้ ส่ง `code_challenge` ไปแล้ว authorize ยังผ่านก็จริง แต่พารามิเตอร์มั่ว ๆ
ก็ผ่านเหมือนกัน — endpoint เพิกเฉยของที่ไม่รู้จัก ดังนั้น "ส่งไปแล้วไม่พัง" พิสูจน์อะไรไม่ได้
รายละเอียดการทดลองอยู่ใน `docs/07-thaid-integration.md` §4.4

## 8. ตัวแปรที่เกี่ยวข้องทั้งหมด

```bash
SESSION_TTL_DAYS=7             # absolute expiry ของ session
SESSION_IDLE_HOURS=8           # ไม่ได้ใช้งานนานเท่านี้แล้วตาย
COOKIE_SECURE=                 # ว่าง = เปิดเองเมื่อ APP_URL เป็น https
OTP_TTL_MINUTES=10
OTP_MAX_ATTEMPTS=5
ACTIVATION_KEY_TTL_DAYS=7
ACTIVATION_KEY_SECRET=         # HMAC ของ activation key — บังคับบน production
PASSWORD_RESET_TTL_MINUTES=60  # ลิงก์ตั้งรหัสผ่านใหม่ (ข้อ 3.1) hash ด้วย secret ตัวเดียวกัน
ADMIN_API_TOKEN=               # ค่าใน header x-admin-token
ADMIN_TOKEN_WATCH_FPS=         # fingerprint ของ token ที่ปลดแล้ว คั่นด้วย comma (ข้อ 4.1)
LOG_READ_TOKEN=                # ค่าใน header x-log-token (ข้อ 4.3) — openssl rand -hex 32
INGEST_SERVER_TOKEN=           # ค่าใน header x-report-token ค่าเดียวกันใน frontend (ข้อ 4.4)
LOG_HASH_KEY=                  # กุญแจ HMAC ของ key ค้นหาเลขบัตร/อีเมลใน log store (ไม่ใช่โทเคน แต่เป็นความลับ)
THAID_STATE_TTL_MINUTES=15
THAID_VERIFICATION_TTL_MINUTES=30
THAID_REQUIRE_NONCE=false      # ดูข้อ 7
```

**ไม่มี `JWT_SECRET` แล้ว** ตั้งแต่ 2026-08-16 — session ไม่ใช่ JWT อีกต่อไป ถ้ายังมีค่านี้
ค้างอยู่ใน `.env` ก็ไม่มีอะไรอ่านมัน ลบทิ้งได้

`ACTIVATION_KEY_SECRET` `ADMIN_API_TOKEN` `LOG_READ_TOKEN` `INGEST_SERVER_TOKEN` และ `LOG_HASH_KEY` อยู่ใน `.env` ซึ่ง git ไม่ติดตาม
**ห้ามย้ายไปไฟล์ที่ track ไว้**

## 9. สรุปสั้น ๆ สำหรับคนที่มาจากระบบที่มี refresh token

| คำถามที่มักถาม | คำตอบของระบบนี้ |
|---|---|
| access token อยู่ที่ไหน | cookie `bdi_session` เท่านั้น เป็นค่าสุ่ม opaque อ่านจาก JS ไม่ได้ |
| refresh token อยู่ที่ไหน | ไม่มี และไม่ต้องมี — ดูข้อ 1.4 |
| ต่ออายุ session อย่างไร | absolute ต่อไม่ได้ (7 วัน) · idle ขยับเองทุกครั้งที่ใช้งาน (8 ชม.) |
| บังคับให้ผู้ใช้คนหนึ่งออกจากระบบทันที | `POST /api/auth/logout-all` หรือตั้ง `user_account.status` เป็น `SUSPENDED`/`DEACTIVATED` |
| ให้ session ใบเดียวตาย | `POST /api/auth/logout` — หรือ `UPDATE iam.session SET revoked_at = now()` |
| บังคับให้ทุกคนออกจากระบบ | `UPDATE iam.session SET revoked_at = now() WHERE revoked_at IS NULL` (ไม่ต้องรีสตาร์ต ไม่ต้องหมุนความลับ) |
| เรียก API ด้วย Bearer token ได้ไหม | ไม่ได้ ยกเว้น `/api/admin/*` ที่ใช้ `x-admin-token` และ `/api/admin/logs/*` ที่ใช้ `x-log-token` |

## Session กับการจัดการบัญชีของแอดมิน

`/api/admin/users` ปิด session ของบัญชีในสามจังหวะ และเหตุผลที่บันทึกต่างกันทุกครั้ง:

| คำสั่ง | `SessionRevokeReason` | ทำไม |
| --- | --- | --- |
| `suspend` · `deactivate` | `ACCOUNT_SUSPENDED` | บัญชีเข้าระบบไม่ได้แล้ว ใบที่ค้างอยู่ต้องตายทันที |
| `identity` (แก้อีเมล/เลขบัตร) · `transfer` | `ROTATED` | ตัวตนหรือระดับสิทธิ์เปลี่ยน — ออกใบใหม่กัน session fixation |
| `DELETE /users/:id/sessions` | `LOGOUT_ALL` | บังคับออกจากระบบโดยไม่ระงับบัญชี ใช้ตอนสงสัยว่า session ถูกขโมย |

`middleware/auth.ts` ปิด session ให้อยู่แล้วทุกครั้งที่เจอบัญชีสถานะไม่ใช่ `ACTIVE` —
สามคำสั่งข้างบนปิดตั้งแต่ตอนสั่ง ไม่ต้องรอให้เจ้าตัวยิง request มาก่อน
