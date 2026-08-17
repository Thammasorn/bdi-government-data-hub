# โทเคนทั้งหมดในระบบ — ออกที่ไหน เก็บอย่างไร หมดอายุเมื่อไร

> **ระบบนี้ไม่มี refresh token** — และไม่ต้องมี เพราะ session เป็น opaque session id
> ที่มีตารางอยู่ฝั่ง server เพิกถอนได้ทีละใบ (ข้อ 1.4) refresh token มีไว้แก้ปัญหาของ
> access token อายุสั้นที่เพิกถอนไม่ได้ ซึ่งเป็นปัญหาที่ระบบนี้ไม่มีแล้ว

ระบบมีของที่เป็น "โทเคน" อยู่ 7 อย่าง แต่ละอย่างตอบคำถามคนละข้อ

| # | โทเคน | ตอบว่า | อายุ | เก็บที่ฝั่ง server |
|---|---|---|---|---|
| 1 | Session id (opaque) | "คุณคือใคร" (หลังเข้าสู่ระบบแล้ว) | 7 วัน / ไม่ใช้งาน 8 ชม. | SHA-256 ใน `iam.session` |
| 2 | Activation key | "คุณคือคนที่ถูกเชิญ" | 7 วัน | HMAC-SHA-256 |
| 3 | OTP | "อีเมลนี้เป็นของคุณจริง" | 10 นาที | bcrypt |
| 4 | `x-admin-token` | "ผู้เรียกคือสคริปต์ฝั่ง admin" | ไม่หมดอายุ | ค่าคงที่ใน env |
| 5 | โทเคนจาก ThaiD | "กรมการปกครองยืนยันตัวตนให้แล้ว" | ใช้ครั้งเดียวแล้วทิ้ง | **ไม่เก็บ** |
| 6 | OAuth `state` | "callback นี้มาจากคำขอที่เราเป็นคนเริ่ม" | 15 นาที | `integration_operation` |
| 7 | OIDC `nonce` | "id_token ใบนี้ออกให้คำขอของเราจริง" | 15 นาที | `integration_operation` |

โค้ดที่เกี่ยวข้องอยู่ใน `backend/src/lib/auth.ts` (สร้าง/แฮช/ตรวจ),
`backend/src/lib/session.ts` (วงจรชีวิตของ session), `backend/src/middleware/auth.ts`
(บังคับใช้) และ `backend/src/routes/auth.ts` (เส้นทางทั้งหมด)

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
**`JWT_SECRET` ไม่มีอีกแล้ว** (`jsonwebtoken` ยังอยู่ ใช้ตรวจลายเซ็น id_token ของ ThaiD)

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

**ที่ยังไม่มี**: endpoint เปลี่ยนรหัสผ่าน `SessionRevokeReason.PASSWORD_CHANGED` และ
`revokeSessionsFor(..., { exceptSessionId })` เขียนรออยู่แล้ว แต่ยังไม่มีเส้นทางไหนเรียก
เพราะระบบยังไม่มีการเปลี่ยนรหัสผ่าน (ตัดสินไว้ 2026-08-16 ว่าไม่เพิ่มในการ์ดนี้)
เมื่อเพิ่ม endpoint นั้น สิ่งที่ต้องทำคือเรียกฟังก์ชันนั้นหนึ่งบรรทัด

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

**คีย์ดิบไม่เคยถูกเขียนลงฐานข้อมูลและไม่เคยถูกส่งไป ThaiD** — callback ของ ThaiD หาทางกลับ
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
บัญชียังใช้ OTP ทางอีเมล ตอนนี้การเปิดใช้งานเป็น ThaiD ทางเดียว ไม่มีเส้นทางไหนออก
OTP แบบ `REGISTRATION` อีกแล้ว

## 4. `x-admin-token` — shared secret ไม่ใช่ session

`POST /api/admin/*` ทั้งหมดป้องกันด้วย header `x-admin-token` เทียบกับ `ADMIN_API_TOKEN`
ตรง ๆ เพราะสเปกระบุว่าขั้นตอนเชิญผู้ใช้ "ไม่มี UI แต่ต้องมี api" ผู้เรียกจึงเป็นสคริปต์
ไม่ใช่เบราว์เซอร์ที่มี session

ข้อจำกัดที่ควรรู้ (ยอมรับไว้ ไม่ใช่มองข้าม): ไม่หมดอายุ ไม่หมุน ไม่ผูกกับตัวบุคคล —
`audit_event` ของงานที่ทำผ่านเส้นทางนี้จึงบอกได้แค่ว่า "ระบบทำ" ไม่ได้บอกว่าเจ้าหน้าที่คนไหน
ถ้าวันหนึ่งต้องรู้ตัวบุคคล ต้องเปลี่ยนไปใช้บัญชีจริงที่มี role `SYSTEM_ADMINISTRATOR`

การเทียบใช้ `timingSafeEqual` แล้วตั้งแต่ 2026-08-16 (เดิมเป็น `!==` ธรรมดา)
โดย hash ทั้งสองฝั่งก่อนเทียบ — `timingSafeEqual` โยนเมื่อความยาวไม่เท่ากัน ซึ่งเท่ากับ
บอกความยาวของความลับออกไป การ hash ก่อนทำให้ buffer ยาวเท่ากันเสมอและความยาวจริงหายไปด้วย
(`activationKeyMatches()` ไม่ต้องทำขั้นนี้เพราะเทียบ hash กับ hash อยู่แล้ว)

**ตัดสินแล้วว่ายอมรับข้อจำกัดข้างบนต่อไปในตอนนี้** (2026-08-16): การย้ายไปใช้บัญชีจริง
ที่มี role `SYSTEM_ADMINISTRATOR` เป็นงานของการ์ด Admin Portal ซึ่งยังไม่มีหน้าจอ —
ทำตอนนี้จะพัง Postman collection และ notebook ที่ใช้เส้นทางนี้อยู่ โดยยังไม่มีอะไรมาแทน

คอลเลกชัน Postman ของ endpoint กลุ่มนี้อยู่ที่ `docs/bdi-admin-portal.postman_collection.json`
(สร้างหน่วยงาน + ส่งลิงก์เปิดใช้งาน + ดู/ยกเลิกคำเชิญ)

## 5. โทเคนจาก ThaiD — รับมาแล้วทิ้งทันที

`resolveIdentity()` ใน `lib/thaid.ts` ทำสามอย่างแล้วจบ

1. เอา `code` ไปแลกที่ `/api/v2/oauth2/token/` ด้วย Basic auth (`client_id:client_secret`)
2. ตรวจลายเซ็น **ES256** ของ `id_token` กับ JWKS ของกรมการปกครอง (แคช 1 ชั่วโมง เลือกคีย์
   ตาม `kid` ถ้าเจอ kid ที่ไม่รู้จักให้ล้างแคชแล้วดึงใหม่หนึ่งครั้ง) พร้อมตรวจ `aud` และ `iss`
3. ตรวจ claim `nonce` กับที่บันทึกไว้ตอนเริ่มคำขอ (ข้อ 7)
4. เรียก `/api/v2/oauth2/revoke/` คืน **ทั้ง access token และ refresh token** ทิ้ง
   แต่ละใบส่ง `token_type_hint` ตาม RFC 7009 แบบไม่รอผลและไม่ให้พัง flow

**access token, refresh token และ id_token ไม่เคยถูกเก็บลงฐานข้อมูล** ระบบนี้ใช้ ThaiD เพื่อ
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
อายุ 15 นาที (`THAID_STATE_TTL_MINUTES`) ยาวพอให้เปิดแอป ThaiD บนมือถือแล้วกลับมา

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
ADMIN_API_TOKEN=               # ค่าใน header x-admin-token
THAID_STATE_TTL_MINUTES=15
THAID_VERIFICATION_TTL_MINUTES=30
THAID_REQUIRE_NONCE=false      # ดูข้อ 7
```

**ไม่มี `JWT_SECRET` แล้ว** ตั้งแต่ 2026-08-16 — session ไม่ใช่ JWT อีกต่อไป ถ้ายังมีค่านี้
ค้างอยู่ใน `.env` ก็ไม่มีอะไรอ่านมัน ลบทิ้งได้

`ACTIVATION_KEY_SECRET` และ `ADMIN_API_TOKEN` อยู่ใน `.env` ซึ่ง git ไม่ติดตาม
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
| เรียก API ด้วย Bearer token ได้ไหม | ไม่ได้ ยกเว้น `/api/admin/*` ที่ใช้ `x-admin-token` |
