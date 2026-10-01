# 21 — Activity log: บันทึกอะไร ในรูปไหน และสำเนาใน MongoDB

การ์ด Task Board **“พัฒนา activity log บน mongo db”** (โปรเจกต์ *Government Datahub Platform*) ·
branch `develop-activity-log-on-mongo-db` · เขียนจากโค้ดที่ commit **`7cf9020`** · 2026-10-01

เอกสารนี้เขียนสำหรับนักพัฒนาและผู้ดูแลระบบของ BDI ที่ต้องตอบให้ได้ว่า **ระบบจดอะไรไว้บ้าง จดเมื่อไร
และแต่ละแถวหน้าตาเป็นอย่างไร** ไม่ใช่คู่มือผู้ใช้ — audit ไม่เคยขึ้นหน้าจอ (`CLAUDE.md` หัวข้อ *Audit log, notifications and the outbox*)
อ่านได้สามทาง: **API อ่าน log** `/api/admin/logs/*` ผ่าน Postman collection `docs/bdi-activity-log.postman_collection.json` (3.11 — ทางหลัก และทางเดียว
ที่ทิ้งร่องรอยว่าใครอ่าน) · `psql` สำหรับคอลัมน์ดิบของ Postgres `audit.audit_event` (2.10) · `mongosh` สำหรับงานของผู้ดูแลที่ API ไม่มี (5.11) — API เดียวในแอป
ที่อ่าน `audit_event` ตรงคือ `recentAudit` ของ `GET /api/admin/users/:id` (20 แถวล่าสุดที่ subject เป็นบัญชีนั้น — ข้อจำกัดอยู่ที่ 2.10)

> **สถานะ ณ `7cf9020`**
>
> - **สร้างครบทั้งสิบขั้นของแผนบน branch นี้แล้ว แต่ยังไม่ merge เข้า `main` และยังไม่ deploy** — production (`main/` ที่ `a715f9d`) ยังเขียนชุดก่อนการ์ด:
>   ไม่มี service `mongo` ไม่มีรหัสที่เกิดในการ์ดนี้ (`LOGIN_OTP_ISSUED` `REQUEST_DRAFT_SAVED` `ADMIN_TOKEN_REJECTED` `AUDIT_LOG_READ` ฯลฯ) และแถวของ admin ยังเป็น
>   `web-portal` ไม่มี `admin_token_fp` (6.2) ทุกอย่างในเอกสารนี้เป็นของโค้ดที่ commit นี้
> - สิ่งที่สร้าง ตามขั้นของแผน: 1–3 audit ของ auth ครบทุกขั้นรวมความล้มเหลว · diff ของการบันทึกร่าง · ช่องโหว่ฝั่ง admin และ event ที่ติดป้ายผิด (หมวด 2, 4) ·
>   4 service `mongo` และ `lib/log-store.ts` (3.12, 3.13) · 5 error แบบ Sentry (หมวด 5) · 6 relay `audit_event` → `activity` พร้อม projection `hashKeys` reconcile
>   rebuild และ prune (3.2–3.9) · 7 API อ่าน log ที่บันทึกทุกการอ่าน (3.11, 4.12) · 8 บันทึกการเรียก `/api/admin*` ทุกครั้ง (4.11) · 9 รายงานจากเบราว์เซอร์และ
>   Next server กับรหัสอ้างอิงบนจอ (5.12) · 10 อีเมลสรุป error (5.14) — และงบไบต์ของสิ่งที่ใครก็ส่งได้ (5.13) ที่เพิ่มในรอบตรวจ
> - **merge main ที่ `7259c09`** (2026-10-01) — กฎ BDI 2026-09-30 ว่าหน่วยงานเกิดจากผู้ดูแลระบบเท่านั้น (`POST /api/admin/organizations`):
>   `POST /api/organizations` เหลือทางเดียว คือผู้ประสานงานของหน่วยงาน (`ORGANIZATION_USER`) ที่มีหน่วยงานแล้วเปิดคำขอให้หน่วยงานของตัวเอง
>   (`REQUEST_CREATED` + `prefilled_from`) ผู้เรียกอื่นที่ไม่ใช่บัญชี BDI ได้ 403 `no_organization` และ**ไม่มีแถว** (เหมือนการปฏิเสธ 4xx อื่นของ
>   เส้นทางธุรกิจ — 6.1) ทาง “ผู้ใช้เปิดหน่วยงานใหม่” ถูกถอด แถว `ORGANIZATION_CREATED` `created_via: WEB_FORM` · `REQUEST_CREATED` ที่ตามมา ·
>   `ROLE_ASSIGNED` `assigned_via: ORGANIZATION_CREATED` และ `ROLE_REVOKED` รูปแบบ A/B จากเส้นทางนี้จึงมีแค่ในแถวที่เขียนก่อนหน้า หัวข้อที่พูดถึง
>   ติดป้าย **ถอดแล้วที่ `7259c09`** ไว้ และอ้างเลขบรรทัดของโค้ดที่ถอดไปด้วย `2cab0a7`
> - **ตอน deploy** (แผน §10 — Deploy A ถึง D ทำทีละขั้นได้):
>   - ก่อน merge ขั้น 4 ขึ้นไปเข้า `main/` ตั้ง `MONGO_ROOT_PASSWORD` `MONGO_BACKEND_PASSWORD` `MONGO_WORKER_PASSWORD` และ `LOG_HASH_KEY` ใน `main/.env` ด้วย
>     `openssl rand -hex 32` — prod overlay ไม่ยอมเริ่ม mongo ด้วยรหัสผ่านตัวอย่าง (3.12) รหัสผ่านมีผลครั้งเดียวตอน volume ว่าง และ `LOG_HASH_KEY` ต้องมีก่อน relay
>     เติมครั้งแรก ไม่งั้นสำเนาทั้งชุดไม่มี key ค้นหาจนกว่าจะ rebuild (3.6, 3.8)
>   - `LOG_READ_TOKEN` และ `INGEST_SERVER_TOKEN` (production ไม่รับค่าตัวอย่างหรือที่สั้นกว่า 32 ตัว) · `ERROR_ALERT_EMAILS` — ตารางตัวแปรอยู่ที่ 3.13
>   - build เป็นขั้นแยกก่อน `up -d` ด้วย `TMPDIR=/hdd1tb/tmp GIT_SHA=$(git rev-parse --short HEAD)` — ไม่มี `GIT_SHA` ทุก event ได้ release `unknown` (5.10) และ `/`
>     ของเครื่องนี้เต็มง่าย (`CLAUDE.md` Traps)
>   - migration `20260930013712_audit_event_relay_cursor_index` วิ่งเองตอนบูต (`migrate deploy`) · relay เติม `activity` จากแถวแรกของ `audit_event` เอง
>   - **ห้าม `down -v` ที่ `main/`** — volume `mongo-data` คือ log ของ production และสำเนา `audit_fallback` / `http` สร้างใหม่จาก Postgres ไม่ได้
>   - จด commit และเวลา (UTC) ของ Deploy A ลงการ์ดและ 6.2 — เป็นเส้นแบ่งของแถวก่อนและหลังการ์ด
> - **ยังไม่ได้ยืนยันกับ image ของ production ของ backend** (ด่าน prod-build T ของแผน): `npm ci --omit=dev` ดึง `mongodb` มาด้วย · `RELEASE` กับ
>   `NODE_OPTIONS=--enable-source-maps` อยู่ใน image ของ runner · เฟรมของ stack ชี้ `/app/src/*.ts` จน `topFrame` และ fingerprint ตรงกับ dev (5.2, 5.4) · backend
>   ของ prod overlay ได้ SIGTERM ถึง `shutdown()` (5.10) — ฝั่ง frontend ลอง `next build` + `output: "standalone"` จริงแล้ว 2026-10-01 (5.12)
> - ป้าย: **[ต้องตัดสิน]** = ค่าที่สร้างไว้เป็นค่าตั้งต้น รอ BDI หรือ DPO ยืนยัน · **[ยังไม่ได้ลอง]** = อ่านจากโค้ด ยังไม่ได้ยืนยันกับของจริง · **ต่างจากแบบ:** = โค้ดต่าง
>   จากแผน เอกสารตามโค้ด · คำถามถึง DPO รวมอยู่ใน 9.8

เลขบรรทัดทุกตัวในเอกสารนี้อ้างถึง `7cf9020` (ยกเว้นที่เขียนกำกับว่า “ของ `2cab0a7`” — โค้ดที่ merge ถอดไปแล้ว) path ที่ขึ้นต้นด้วย `routes/` `lib/` `middleware/` `scripts/`
`workers/` อยู่ใต้ `backend/src/` คำว่า “แผน” หมายถึงแผนของการ์ดนี้ (ฉบับ final หลัง review 2026-09-25) ซึ่ง**แนบอยู่ในการ์ด
Notion เป็นไฟล์ `activity-log-plan-2026-09-25.md`** ไม่ได้อยู่ใน repo และ §N / “ขั้น N” / Qn อ้างหัวข้อ ขั้นงาน และคำถามถึง
BDI ในแผนนั้น

---

## 1. ภาพรวม — เหตุการณ์หนึ่งเดินทางไปที่ไหนบ้าง

```
 เบราว์เซอร์ · Postman · สคริปต์
        │   x-correlation-id ที่เป็น UUID ถูกรับไว้เป็นตัวพิมพ์เล็ก ไม่งั้นสร้างใหม่ (lib/context.ts)
        │   proxy ของหน้าเว็บตั้งค่าใหม่ทุกคำขอ และตอบ 404 ให้ /api/admin/logs*
        ▼
 backend ─ correlationMiddleware ─► requireAuth ─────────────► route handler
           (web-portal, IP, UA)      setActor(ผู้ใช้)             │  wrap() จด route แม่แบบลงบริบท
                                  └► requireAdminToken           │ ธุรกรรมของ route commit แล้ว
                                     admin-portal + token fp     ▼
                                  └► requireLogReader     logAudit(input) — ไม่ throw ไม่ retry
                                     log-api + reader            │ INSERT ผ่าน prisma ตัวหลัก
                                                                 ▼
                                              Postgres audit.audit_event   ◄── ระบบบันทึกหลัก (ไม่มี retention)
                                                                 │
                         delivery-worker: relay ทุก 5 วินาที อ่านตาม cursor (occurred_at, id)            (3.8)
                                                                 ▼
                                              mongo bdi_logs.activity {source:"audit_event"}
 INSERT สำเร็จ ─► breadcrumb "audit" (ชื่อ action) ในบริบทของคำขอ
 อ่าน snapshot หรือ INSERT ล้ม ─► breadcrumb ok:false ─► captureError (audit.write-failed)
        + activity {source:"audit_fallback"} เข้าคิว                                               (3.14)
 /api/admin/logs/* ─► ping Mongo (ไม่ตอบ = 503 log_store_unavailable ก่อนบันทึกอะไร)
        ─► recordLogRead() ─► Postgres AUDIT_LOG_READ (ไม่กลืน error · ≤ 2 วินาที)
           └ ไม่ได้ ─► await เขียน activity {source:"audit_fallback"} ตรง ไม่ผ่านคิว (≤ 2 วินาที)
             ไม่ได้อีก ─► 503 log_read_unrecorded ไม่ส่งข้อมูล  · ได้ ─► อ่าน               (3.11)
 ทุก /api/admin* ที่ไม่ได้ถึง router ของ log (ตอน res 'finish' / 'close') ─► คิว
        ─► activity {source:"http", action:"ADMIN_API_REQUEST"} · เกินเพดานพับลงใบสรุป              (4.11)
 error middleware · 5xx ที่ route ตอบเอง · จุดที่กลืน error · process handlers ─► captureError()
 เบราว์เซอร์ · Next server ─► POST /api/client-errors (204 เสมอ) ─► captureReport()               (5.12)
        ─► บรรทัด [capture] ที่กวาดแล้วใน log ของ container (ไม่มีของรายงานที่รับเข้ามา)
        ─► คิวในหน่วยความจำ (≤ 500 รายการ / 2 MB ทิ้งตามชั้น · งบไบต์ของสิ่งที่ใครก็ส่งได้ 5.13)
        ─► flush ทุก 2 วินาที ทีละก้อน ─► error_events + error_issues · runtime_events · activity
 backend + worker เริ่ม / ปิด / fatal ─► runtime_events (ผ่านคิวเดียวกัน)
 delivery-worker: log-upkeep ทุก 60 วินาที ─► index ทุก collection · เพดานขนาดรายชั่วโมง ─► relay_state
                  งานดูแลทุก 60 วินาที ─► reconcile รายชั่วโมง · prune วันละครั้งหลัง 03:00 น.       (3.8, 3.9)
                  loop แจ้งเตือนทุก 60 วินาที ─► อีเมลสรุปถึง ERROR_ALERT_EMAILS                     (5.14)
 /health/ready ◄── สถานะ logStore ที่ตรวจเบื้องหลังทุก 30 วินาที (ไม่นับใน healthy)
```

กติกาที่ภาพนี้ตั้งอยู่:

- **Postgres `audit.audit_event` เป็นระบบบันทึกหลัก** MongoDB `activity` เป็น**สำเนาที่ค้นได้** (แผน §2 ข้อ 1) หลักฐานของการลบแบบถาวร (`INVITATION_DELETED`,
  `REQUEST_DELETED`) จึงยังอยู่ในฐานข้อมูลที่มี transaction และมี `pg_dump` · rebuild สร้างใหม่จาก Postgres ได้**เฉพาะเอกสาร `source:"audit_event"`** (3.8)
  เอกสาร `audit_fallback` และ `http` ไม่มีใน Postgres จึงสร้างใหม่ไม่ได้ และแถวที่ `seed:demo` ลบจาก Postgres ไปแล้วเหลืออยู่ใน Mongo ที่เดียว
- **ทางของ request ไม่รอ MongoDB** — `captureError()` synchronous แค่วางลงคิว `/health/ready` อ่านสถานะที่จำไว้ สำเนา `audit_fallback` และบันทึกการเรียก admin API
  เข้าคิวเดียวกัน relay อยู่ใน delivery-worker และอ่านแถวที่ commit แล้ว ไม่ใช่ `logAudit()` เขียนสองที่ MongoDB ตาย คำขอของผู้ใช้ไม่รู้สึกอะไร · ข้อยกเว้นเดียวคือ
  API อ่าน log ซึ่งต้องบันทึกการอ่านได้ก่อนตอบ
- **ไม่มี service ไหน `depends_on: mongo`** และ `LOG_STORE_ENABLED=false` ปิดทั้งหมดได้โดยไม่ต้อง build ใหม่ (สร้าง backend กับ worker ใหม่ — 3.13)
- **สัญญาของ `logAudit()` ไม่เปลี่ยน**: เขียนหลัง commit และไม่ throw การ์ดนี้เพิ่มแค่ breadcrumb `audit` และทางสำรองในทางที่ล้ม (2.8) ส่วน**ผู้เขียนคนที่สอง**ของ
  `audit.audit_event` คือ `recordLogRead()` ใน `lib/audit.ts` ซึ่ง**ไม่กลืน error** (ต้องบันทึกได้ก่อนส่งข้อมูล)
- relay **คัดลอกสิ่งที่ commit แล้วตามจริง** รวมถึงแถวที่แปลกอยู่แล้วใน Postgres (6.2) ไม่ได้ซ่อมให้

---

## 2. รูปแบบแถว `audit.audit_event`

ตารางอยู่ใน schema `audit` (model `AuditEvent` ใน `backend/prisma/schema.prisma`, DDL ใน migration
`20260811155040_datahub_v2_baseline`) **ผู้เขียนมีสองคน**: `logAudit()` — 88 จุดเรียกใน 12 ไฟล์ — และ `recordLogRead()` (`AUDIT_LOG_READ`, 4.12)
ทั้งคู่ประกอบแถวด้วย `auditEventData()` (`lib/audit.ts:640`) ไม่มี raw SQL และไม่มี `prisma.auditEvent.create` ที่อื่น ผู้อ่านในแอปนอกจาก relay (3.8)
มีจุดเดียว:
`GET /api/admin/users/:id` คืน 20 แถวล่าสุดที่ subject เป็นบัญชีนั้นใน `recentAudit` (`routes/admin-users.ts:455`)
ซึ่ง**ไม่เห็น**สิ่งที่คนนั้นทำเองในฐานะ actor และไม่เห็นแถวที่ subject เป็น assignment คีย์ หรือ session ของเขา (2.10)

“ห้ามแก้ห้ามลบ” เป็น **ข้อตกลง ไม่ใช่กลไก**: ไม่มี trigger ไม่มี REVOKE ไม่มี FK และ `seed:demo`
ลบทุกแถวด้วย `prisma.auditEvent.deleteMany()` (`scripts/seed-demo.ts:214`)

### 2.1 คอลัมน์

| คอลัมน์ | ชนิด | ใครเติม | หมายเหตุ |
|---|---|---|---|
| `id` | UUID PK | Prisma `uuid()` ฝั่ง client | DDL ไม่มี default |
| `occurred_at` | TIMESTAMPTZ(6) | Prisma `@default(now())` — engine ของ Prisma สร้างค่าเองจากนาฬิกาของ process (backend หรือ worker) ตอน `create()` แล้วส่งเป็นพารามิเตอร์ DDL `DEFAULT CURRENT_TIMESTAMP` มีผลเฉพาะ INSERT ที่ไม่ผ่าน Prisma (เช่นแถว `admin-script`) | เวลาที่ `logAudit` สร้าง INSERT แถวนี้ ไม่ใช่เวลาของธุรกรรมที่ถูกบันทึก (2.8) · เก็บเป็น UTC (ดูข้างล่าง) · ยืนยันด้วย query log แล้ว (2026-10-01 ในธุรกรรมที่ rollback): INSERT ส่ง `occurred_at` เป็น `$2` เอง แถวที่ Prisma เขียนจึงละเอียดแค่มิลลิวินาที (หลักไมโครวินาทีเป็น `000` เสมอ) — cursor ระดับไมโครวินาทีของ relay (3.8) มีผลจริงกับแถวที่ได้ค่า DEFAULT ของ DDL เท่านั้น |
| `actor_type` | enum `USER` `SYSTEM` `EXTERNAL` `ANONYMOUS` | `input.actorType` หรือคำนวณ | ดู 2.2 · `EXTERNAL` ไม่เคยถูกเขียน |
| `actor_id` | UUID null | `input.actorId` → actor ใน context → null | ไม่มี FK |
| `action` | VARCHAR(128) | `input.action` | รหัสจาก `AuditAction` (หมวด 4) |
| `subject_type` | VARCHAR(64) | `input.subjectType` | รหัสจาก `AuditSubject` |
| `subject_id` | UUID null | `input.subjectId` | ไม่มี FK — แถวที่ถูกลบแล้วก็ยังชี้ได้ |
| `organization_id` | UUID null | `input.organizationId` **เท่านั้น** | ไม่เคยเดาจาก actor หรือ context |
| `result` | enum `SUCCESS` `FAILURE` | `input.result` หรือ `SUCCESS` | |
| `before_summary_json` | JSONB null | `input.before` | ดู 2.7 เรื่องการแปลงค่า |
| `after_summary_json` | JSONB null | `input.after` | |
| `ip_address` | VARCHAR(64) null | context (`parseClientIp`) | ดู 2.6 |
| `user_agent` | TEXT null | context → `storedUserAgent()` | ดู 2.6 |
| `correlation_id` | **VARCHAR(64)** | context หรือ UUID ใหม่ | ไม่ใช่ชนิด UUID ต่างจากอีกสามตาราง (2.5) |
| `source_component` | VARCHAR(64) | context หรือ `request-service` | ดู 2.4 |
| `metadata_json` | JSONB null | ประกอบตาม 2.3 | NULL เมื่อไม่มีคีย์เลย |

index ที่มี: `(subject_type, subject_id, occurred_at)` · `(actor_id, occurred_at)` · `(correlation_id)` · `(occurred_at, id)` ของ relay
(migration `20260930013712_audit_event_relay_cursor_index`) — **ไม่มี** index บน `action` หรือบน `organization_id`

**เขตเวลา** `occurred_at` เป็น TIMESTAMPTZ ซึ่งเก็บเป็นจุดเวลาแบบ UTC — `psql` แสดงตาม `TimeZone` ของ session นั้น (ตัวอย่างใน
2.9 จึงลงท้าย `+00:00`) อ่านเป็นเวลาไทยด้วย `occurred_at AT TIME ZONE 'Asia/Bangkok'` หรือ `SET TIME ZONE 'Asia/Bangkok';`
ก่อนคิวรี และกรองช่วงวันด้วยค่าที่มี offset เช่น `'2026-09-29 00:00+07'` ไม่งั้นวันหนึ่งของไทยจะเลื่อนไป 7 ชั่วโมง ค่าเวลาใน JSON
(`expires_at` `window_start` ฯลฯ) เป็นสตริง ISO แบบ UTC (`…Z`) API อ่าน log คืน `occurredAtBangkok` ให้ด้วย (3.11)

### 2.2 `actor_type` กับ `actor_id`

```ts
actorId   = input.actorId ?? currentContext()?.actorId ?? null
actorType = input.actorType ?? (actorId ? "USER" : "SYSTEM")
```

actor ใน context มาจาก `setActor(user.id)` ซึ่งมีผู้เรียกคนเดียวคือ `requireAuth` (`middleware/auth.ts:123`)
หลังตรวจ session ผ่าน ผลที่ตามมา:

| ที่มาของคำขอ | actor ที่ได้ |
|---|---|
| route ที่อยู่หลัง `requireAuth` (`/api/organizations/*`, `/api/dataset-requests/*`, `/api/notifications/*`, `/api/auth/logout-all` `/sessions` `/me`) | `USER` = ผู้ที่ล็อกอิน พร้อม snapshot |
| `SESSION_REVOKED` ที่ `requireAuth` เขียนเอง**ก่อน** `setActor()` — `EXPIRED` ผ่าน `resolveSession()` และ `ACCOUNT_SUSPENDED` (`middleware/auth.ts:93`) รวมถึง `EXPIRED` จาก `resolveSession()` บน `/logout` `/password-reset` และ `issueSession()` | `USER` = **เจ้าของ session หรือบัญชี** (helper ส่ง `actorId` เอง) ไม่ใช่ผู้ที่ล็อกอิน — คำขอที่ `requireAuth` ปฏิเสธจบด้วย 401 |
| `/api/admin/*` (หลัง `requireAdminToken`) | `SYSTEM` · `actor_id` null — token ไม่ผูกกับตัวคน (docs/09 §4) |
| `/api/admin/logs/*` (หลัง `requireLogReader`) — `AUDIT_LOG_READ` · `ERROR_ISSUE_STATUS_CHANGED` | `SYSTEM` · `actor_id` null — ผู้อ่านไม่ใช่บัญชีในระบบ ตัวตนที่**ประกาศ**อยู่ใน `metadata.reader` (4.12) |
| `/api/auth/*` ขาที่ยังไม่ล็อกอิน — แถวที่ route เขียนเอง | ส่ง `actorType: "ANONYMOUS"` เอง หรือส่ง `actorId` ของบัญชีที่เพิ่งพิสูจน์ตัวตนได้ → `USER` (`LOGIN_SUCCEEDED` · `USER_ACCOUNT_ACTIVATED` `ACTIVATION_KEY_USED` `ROLE_ASSIGNED` ของ `/activate` · `PASSWORD_RESET_COMPLETED` ที่สำเร็จ) |
| `/api/auth/*` ขาที่ยังไม่ล็อกอิน — แถวที่ helper ใน `lib/` เขียน | **ไม่ส่ง actor เลย จึงได้ `SYSTEM` + null**: `ACTIVATION_KEY_EXPIRED` (`GET /invitation` `/thaid/start` `/thaid/callback` `/activate`) · `SESSION_REVOKED` `LOGOUT` (`/logout`) และ `ROTATED` (`issueSession()` ของ verify-otp `/activate` และ ThaID login) · `ROLE_REVOKED` รูปแบบ B บน `/activate` ยกเว้น `SESSION_REVOKED` `EXPIRED` ที่เป็น `USER` ตามแถวที่สองของตารางนี้ |
| ฟังก์ชันใน `lib/` ที่ส่ง `actorId` มาเอง (`revokeSessionsFor()` = บัญชีเป้าหมาย · `revokeRoleAssignments()` = actorId ที่ผู้เรียกส่ง) | `USER` แม้คำสั่งจะมาทาง admin token — ดูหมวด 6.2 |
| helper ใน `lib/` ที่ไม่ส่ง actor (`logKeysRevoked()` `evaluateActivationKey()` `announceRoleReplacement()` `revokeSession()`) | ตาม context: `SYSTEM` + null บนเส้นทาง admin และเส้นทางสาธารณะ · `USER` = ผู้ที่ล็อกอินบนเส้นทาง session |

`ANONYMOUS` มีได้ก็ต่อเมื่อจุดเรียกส่งมาเองเท่านั้น (`logAudit` ไม่เดาให้) และ `EXTERNAL` ไม่มีจุดไหนเขียน แถว `SYSTEM` + null
จึงมีสามที่มาที่คอลัมน์ actor แยกไม่ออก: admin token (มี `admin_token_fp` ตั้งแต่การ์ดนี้) · helper บนเส้นทางสาธารณะ ·
และแถวเก่าก่อนการ์ด (6.2) — วิธีสืบว่า “ใครทำจริง” ของแต่ละแบบอยู่ที่ 6.2

### 2.3 `metadata_json` — ประกอบอย่างไร และคีย์ที่ `logAudit` เติมเอง

```ts
metadata = {
  ...actorSnapshot,                                   // 1. ชื่อและ role ของ actor ณ ตอนเขียน
  ...input.metadata,                                  // 2. คีย์ของจุดเรียก (หมวด 4)
  ...(ctx.ipUnparsed  ? { ip_unparsed: true } : {}),  // 3.
  ...(ctx.adminTokenFp ? { admin_token_fp } : {}),    // 4. มาหลังสุด ผู้เรียกทับไม่ได้
}
```

**คีย์ระบบ** — มีในแถวทุกแถวที่เงื่อนไขตรง หมวด 4 จึงไม่เขียนซ้ำในตารางของแต่ละ event:

| คีย์ | มีเมื่อ | ความหมาย | ตัวอย่าง |
|---|---|---|---|
| `actor_name` | มี `actor_id` และพบบัญชี | `fullNameTh(actor)` (คำนำหน้า ชื่อ นามสกุล คั่นด้วยช่องว่าง ตามที่ BDI สั่งเมื่อ 2026-09-06) ถ้าว่างใช้**อีเมล**ของบัญชีแทน | `"นางสาว สมหญิง ตัวอย่าง"` |
| `actor_roles` | เหมือนข้างบน | role code ของ assignment ที่ `status = ACTIVE` | `["ORGANIZATION_USER"]` |
| `actor_organization_id` | เหมือนข้างบน และมี assignment ที่ผูกหน่วยงาน | `organizationId` ของ assignment ACTIVE **ตัวแรก**ที่มีหน่วยงาน (ไม่เลือกตามชนิด role แบบ `requireAuth`) | `"2c8e4a10-…"` |
| `ip_unparsed` | `req.ip` มีค่าแต่ไม่ใช่ IP | บอกว่ามีค่ามาแต่ไม่เก็บ | `true` |
| `admin_token_fp` | คำขอผ่าน `requireAdminToken` | 12 ตัวแรกของ SHA-256 ของ `x-admin-token` ที่ผ่าน (`tokenFingerprint()`, `lib/auth.ts:57`) | `"3f9a0c1b7d2e"` |

รายละเอียดของ snapshot (`audit.ts:687-711`) ที่คนอ่านต้องรู้:

- อ่านด้วย prisma ตัวหลัก **ตอนเขียนแถว** ซึ่งส่วนใหญ่คือหลังการกระทำ การยุติบัญชีหรือการถอน role ตัวเอง
  จึงเห็น role หลังเปลี่ยน ส่วนแถวที่เขียนระหว่าง transaction ยังเปิดอยู่เห็นสถานะ**ก่อน**เปลี่ยน (6.2)
- กรองแค่ `status = ACTIVE` ไม่ดู `effectiveUntil` และไม่ดู `role.isActive` ต่างจาก `requireAuth`
- `actor_organization_id` ที่เป็น `undefined` หายไปจาก JSON ทั้งคีย์ ไม่ใช่ `null`
- บัญชีระบบ `SYSTEM_USER_ID` (`00000000-0000-0000-0000-000000000001`) ไม่มีชื่อไทย `actor_name` ของมัน
  จึงเป็นอีเมลของบัญชีนั้น และ `actor_roles` มักเป็น `[]`
- snapshot ถูกเก็บลง metadata เพราะ Excel ตัดคอลัมน์ `actor_name` / `actor_roles` ออก ไม่เก็บไว้ แถวเก่าจะ
  เปลี่ยนความหมายเมื่อผู้ใช้เปลี่ยนชื่อ (หัวไฟล์ `audit.ts`)
- **ลำดับการรวมมีผล**: `input.metadata` ถูกกระจาย**หลัง** snapshot คีย์ของจุดเรียกที่ชื่อ `actor_name` `actor_roles` หรือ
  `actor_organization_id` จึงทับ snapshot ได้เงียบ ๆ (`audit.ts:629-636`) มีแค่ `ip_unparsed` กับ `admin_token_fp` ที่มาหลังสุดและ
  ทับไม่ได้ วันนี้ไม่มีจุดเรียกไหนใช้ชื่อเหล่านั้น — ข้อควรระวังเมื่อเพิ่ม event ใหม่ (หมวด 8)

### 2.4 `source_component`

| ค่า | ใครตั้ง | อยู่ใน `audit_event` ไหม |
|---|---|---|
| `web-portal` | `correlationMiddleware` ตั้งให้ทุกคำขอ HTTP (`lib/context.ts:186`) | ใช่ — ทุกแถวของหน้าเว็บและของคนที่ยังไม่ล็อกอิน **รวมทั้ง `ADMIN_TOKEN_REJECTED`** เพราะ token ไม่ผ่านจึงไม่ถูกเปลี่ยน แถวสรุปที่ตัวกวาดเขียนภายหลังนอกคำขอก็ยังเป็น `web-portal` เพราะ recorder จำ `sourceComponent` ของคำขอแรกไว้ใน origin แล้วส่งต่อเข้า `runWithContext()` (`lib/token-rejection.ts:368` `:410`) ไม่ตกไปเป็น `request-service` |
| `admin-portal` | `requireAdminToken` เมื่อ token ผ่าน (`middleware/auth.ts:189`) | ใช่ — ทุกแถวของ `/api/admin/*` ที่ token ผ่าน (รวมแถวของ helper ที่ actor เป็น `USER`) · แถวก่อนการ์ดของ admin เป็น `web-portal` ทั้งหมด (6.2) |
| `log-api` | `requireLogReader` เมื่อ token ผ่าน (`middleware/auth.ts:297`) | ใช่ — `AUDIT_LOG_READ` และ `ERROR_ISSUE_STATUS_CHANGED` · `LOG_TOKEN_REJECTED` เป็น `web-portal` (token ไม่ผ่านจึงไม่ถูกเปลี่ยน) |
| `request-service` | ค่าตั้งต้นเมื่อไม่มี context (`context.ts:100`) และของ `runWithContext()` | ไม่มีทางเขียนที่รู้จักในโค้ด commit นี้ แต่แถวเก่าบน production มีได้: ก่อน `261bd98` (commit ใน branch นี้) คำขออัปโหลดไฟล์ขนาดจริงหลุด context ใน multer แถวจึงได้ `SYSTEM` · `request-service` · ไม่มี IP · correlation id ใหม่ (Traps ใน `CLAUDE.md`) |
| `seed-demo` | `scripts/seed-demo.ts:1005` | เฉพาะเมื่อ `assignRole` ไปแทนที่ผู้ถือ role ระหว่าง seed (ปกติไม่มี และ seed ลบตารางก่อนอยู่แล้ว) |
| `notification-worker` | `workers/delivery.ts:181-182` ต่อแถว delivery | **ไม่** — worker ไม่เขียน audit เลย (error ต่อแถว `delivery.send-failed` `delivery.dead-letter` เกิดในบริบทนี้ ส่วน `delivery.tick` `delivery.main` และงานดูแล log store ไม่มีบริบท — 5.1) |
| `admin-script` | ไม่มีโค้ดไหนตั้ง | พบหกแถวบน production ที่ดูเหมือนถูก INSERT ด้วยมือ (แผน §13 ข้อ 22) |

ค่าอื่นใน Excel (`iam-service` `organization-service` `approval-service` `jira-integration`
`dii-integration` `activation-expiry-job`) ไม่มีโค้ดไหนตั้ง

### 2.5 `correlation_id`

- `correlationMiddleware` (`context.ts:168-198`) รับ header `x-correlation-id` **เฉพาะเมื่อเป็นรูป UUID**
  (`/^[0-9a-f]{8}-…-[0-9a-f]{12}$/i` — version ไหนก็ได้ รวม nil) แล้วเก็บเป็น**ตัวพิมพ์เล็ก** (ตั้งแต่ `74f751f` — แถวก่อนหน้านั้นเก็บตัวพิมพ์
  ตามที่ผู้เรียกส่ง) ไม่งั้นสร้าง
  `randomUUID()` ใหม่ และตอบกลับใน header `x-correlation-id` เสมอ · backend ประกาศ header นี้ใน `exposedHeaders` ของ CORS
  (`index.ts:145`) หน้าเว็บที่เรียกข้าม origin จึงอ่านได้ · 8 ตัวแรกของมันคือรหัสอ้างอิงที่ผู้ใช้เห็นบนคำตอบ 5xx (5.8)
- ทุกแถวของคำขอ HTTP เดียวกันจึงมี id เดียวกัน และ**แต่ละคำขอได้ id ของตัวเอง** — การกระทำที่กินหลายคำขอ (ล็อกอินสองขั้น
  · ThaID start/callback/activate · admin ออกลิงก์แล้วเจ้าของบัญชีกดทีหลัง · ปุ่มสร้างเอกสารที่ PATCH ก่อนเรียก generate)
  จึงมีหลาย correlation id โค้ดฝั่งเบราว์เซอร์ไม่ส่ง `x-correlation-id` เลย (proxy ตั้งค่าใหม่ให้ทุกคำขอ — ข้างล่าง · `lib/api.ts` แค่อ่านจากคำตอบ) ไม่มีอะไรผูกคำขอของคลิกเดียวกันไว้
- `correlationId()` นอก context (`context.ts:85`) ได้ UUID ใหม่ทุกครั้งที่เรียก แต่ไม่มีทางเขียน audit ที่รู้จักทางไหนไปถึงตรงนั้น
  แถวสรุปของ `ADMIN_TOKEN_REJECTED` เขียนใน `runWithContext({...origin, correlationId: undefined})` ซึ่งสร้าง UUID ใหม่
  หนึ่งค่าต่อแถวสรุป (`context.ts:107`, `lib/token-rejection.ts:264` `:271`) ผลเหมือนกัน: id ที่ไม่ตรงกับคำขอใดเลย
- proxy ของหน้าเว็บ (`frontend/app/api/[...path]/route.ts`) **ตั้ง `x-correlation-id` ใหม่ทุกคำขอ** (5.12) คำขอที่ผ่านหน้าเว็บจึงเลือก id เองไม่ได้ —
  แต่ผู้เรียก backend ตรง (Postman สคริปต์ หรือใครก็ตามที่เข้าถึงพอร์ต API ได้) ยังเลือกเองได้ รวมถึงใช้ซ้ำหรือชนกับของคนอื่น id เดียวกันจึงไม่ใช่หลักฐานว่า
  เป็นคลิกเดียวกัน (`mixedActors` ของ trace — 3.11) · แถวก่อน deploy ของการ์ดนี้ proxy ยังส่ง header ของเบราว์เซอร์ต่อทั้งหมด
- delivery-worker ห่อแต่ละแถวที่ส่งด้วย `runWithContext({correlationId: row.correlation_id, …})` (`workers/delivery.ts:181-182`)
  งานส่งอีเมลจึงถือ id ของคำขอที่สร้างการแจ้งเตือนนั้น — worker ไม่เขียน audit แต่ `error_events` ของมัน (`delivery.send-failed`
  `delivery.dead-letter`) ถือ id นี้ใน `request.correlationId` dead letter จึงค้นเจอด้วยรหัสอ้างอิงของคลิกต้นเรื่อง (5.1)
- ตารางอื่นที่มี correlation id ให้ join: `notification.notification` · `notification.notification_delivery` ·
  `integration.integration_operation` — สามตารางนี้เป็นชนิด UUID (เก็บตัวพิมพ์เล็ก) และ **ไม่มี index** บน
  คอลัมน์นี้ แถวก่อน `74f751f` ที่ผู้เรียกส่ง id ตัวพิมพ์ใหญ่มา `audit_event` เก็บตามนั้น ให้เทียบด้วย
  `a.correlation_id::uuid = n.correlation_id` หรือ `lower()`
- **ThaID ข้ามคำขอ**: `IDENTITY_VERIFICATION_STARTED` กับแถว `integration_operation` ได้ id ของคำขอ
  `/thaid/start` (`integration_operation.correlation_id` ถูกตั้งครั้งเดียวตอนสร้าง `thaid-flow.ts:80` ไม่มีฟังก์ชันไหนแก้อีก)
  ส่วนแถวของ callback ได้ id ของคำขอ callback ซึ่งไม่ตรงกับอะไรเลย ให้ join ด้วย `metadata.integration_operation_id`
  (หรือ `subject_id` ของแถวที่ subject เป็น `INTEGRATION_JOB`) ไม่ใช่ด้วย correlation id — ได้เฉพาะแถวที่มีคีย์นั้น:
  `IDENTITY_VERIFIED` · `IDENTITY_VERIFICATION_FAILED` (ทุกแบบยกเว้น `state_not_found`) · `USER_ACCOUNT_UPDATED` ขา THAID
  **`LOGIN_SUCCEEDED` (THAID) และ `LOGIN_FAILED` `THAID_NO_MATCHING_ACCOUNT` ไม่มี `integration_operation_id` และไม่มี
  correlation id ร่วมกับใคร** ความพยายามล็อกอินด้วย ThaID จึงจับคู่ STARTED กับผลได้แค่แบบประมาณ (4.1)
- **DII**: การอนุมัติขั้นสุดท้ายของชุดข้อมูลสร้างแถว `integration_operation` (`PUBLISH_DATASET_REFERENCE`)
  ด้วย correlation id เดียวกับแถว `REQUEST_APPROVED` ซึ่งมี `metadata.integration_operation_id` อยู่ด้วย

### 2.6 `ip_address` และ `user_agent`

- `ip_address` = `parseClientIp(req.ip)` (`context.ts:146-150`): ไม่มีค่า → null · ไม่ใช่ IP ตาม `isIP()` →
  null + `metadata.ip_unparsed: true` (ค่าดิบไม่ถูกเก็บที่ไหนเลย) · เป็น IP → ตัด zone ของ IPv6 ออก
  คง `::ffff:` ไว้ ยาวไม่เกิน 45 ตัว
- `trust proxy 1` ทำให้ `req.ip` เป็นค่าสุดท้ายของ `X-Forwarded-For` **ซึ่งผู้เรียกเขียนเองได้** ทั้งตอนยิง
  backend ตรงและตอนยิงผ่านหน้าเว็บ บน dev checkout ค่านี้คือสิ่งที่ผู้เรียกพิมพ์มา บน production ถูกเท่าที่
  Cloudflare ต่อท้ายที่อยู่จริงให้ ซึ่ง**ยังไม่ได้ยืนยันกับ tunnel ของเรา** (docs/09 §4.1) อ่านคอลัมน์นี้เป็น
  “ที่อยู่ที่อ้างมา” เสมอ
- `user_agent` = `storedUserAgent(header)` (`audit.ts:613`): กลุ่มเลขที่คั่นด้วย `-` `_` `:` หรือช่องว่าง
  ไม่เกินสามตัวติดกัน ซึ่งรวมกันได้ 9 หลักขึ้นไป → `:n` แล้วตัดที่ 512 ตัว `.` และ `/` ไม่นับเป็นตัวคั่น
  เลขเวอร์ชัน (`Edg/151.0.3405.80`, `Gecko/20100101`) จึงรอด เลขบัตรหรือเบอร์โทรที่คนพิมพ์ไม่รอด ใช้กับ
  **ทุกแถว** ส่วน `iam.session` และหลักฐานการลงนามเก็บ user agent ดิบ
- แถวทันทีและแถวสรุปของ “ถังรวม” ใน `ADMIN_TOKEN_REJECTED` ไม่มีทั้ง IP และ user agent โดยตั้งใจ (4.11)

### 2.7 การแปลงค่าและเพดานความยาว

- `action` ตัดที่ 128 · `subject_type` `ip_address` `correlation_id` `source_component` ตัดที่ 64 (`fit()`)
  ค่าที่ยาวเกินจะทำให้ INSERT ล้มทั้งแถว จึงตัดทิ้งส่วนเกินก่อน
- `before` / `after` / `metadata` ผ่าน `toJson()` (`audit.ts:558`): `JSON.stringify` แล้ว `JSON.parse`
  — `Date` กลายเป็นสตริง ISO · คีย์ที่ค่าเป็น `undefined` หายไป · `null` หรือ `undefined` ทั้งก้อนเป็น SQL
  NULL · ทุก**ค่า**ที่เป็นสตริงผ่าน `storableText()` (ตัด U+0000 และแทน surrogate ครึ่งคู่ด้วย U+FFFD) ไม่งั้น jsonb ปฏิเสธทั้งแถว
  — replacer ของ `JSON.stringify` แตะแค่ค่า **ชื่อคีย์ไม่ผ่าน** (`audit.ts:560-562`) วันนี้ไม่มีผลเพราะคีย์มาจากโค้ดหรือจาก shape ที่ zod ตรวจแล้ว
- `storableText()` **ไม่**ใช้กับคอลัมน์สเกลาร์ (`action`, `subject_type`, `user_agent` …)
- คอลัมน์ UUID (`actor_id`, `subject_id`, `organization_id`) ไม่ถูกตรวจรูป ค่าที่ไม่ใช่ UUID ทำให้ INSERT ล้ม
  และแถวหาย — fingerprint หรือรหัสอื่นที่ไม่ใช่ UUID ต้องไปอยู่ใน `metadata`
- `logAudit()` **ไม่ sanitize อะไรให้เลย** การปิดเลขบัตรทำที่จุดเรียก (`sanitizeDiff()` / `sanitizeState()`)
  และ `metadata` ไม่ผ่านขั้นไหนที่ปิดข้อมูลให้ทั้งก้อน — ข้อยกเว้นเดียวคือคีย์ `organization_master_changed` ของ
  `REQUEST_DRAFT_SAVED` ที่จุดเรียกประกอบจาก `sanitizeDiff()` เอง (`routes/organizations.ts:1447-1454` `:1474`) (หมวด 7) · สำเนา
  `audit_fallback` ใน Mongo ปิดเลขบัตรเองอีกชั้นก่อนออกจาก process (3.14)

### 2.8 เวลาที่เขียน และสิ่งที่ `logAudit()` ไม่ทำ

- **ไม่ throw ไม่ retry และ Postgres ไม่ได้แถวคืน** การอ่าน snapshot กับ INSERT อยู่ใน `try` · INSERT ที่สำเร็จทิ้ง breadcrumb `audit`
  (ชื่อ action) ไว้ในบริบทของคำขอ (5.2) · `catch` (`audit.ts:718-725`) ทิ้ง breadcrumb `"<action> — เขียนไม่สำเร็จ"` แล้วส่งให้
  `reportAuditWriteFailure()` (`lib/audit-fallback.ts`) ซึ่ง (1) `captureError()` tag `audit.write-failed` พร้อม input ของแถวที่ปิดเลขบัตรแล้วใน
  `extra.audit` — พิมพ์บรรทัด `[capture]` ที่กวาดแล้วหนึ่งบรรทัดลง stderr **เสมอ** แต่ตัว event เข้าคิวเฉพาะเมื่อผ่านเพดาน (50 ตัวต่อชั่วโมงของ
  fingerprint · 600 ตัวต่อนาทีของ process · ไม่เกินเพดานขนาด · งบไบต์ `anonymous-request` ยังพอเมื่อคำขอไม่มีตัวตน ซึ่งรวมทุก route ของ `/api/auth/*`
  และแถวทันทีของ `ADMIN_TOKEN_REJECTED` / `LOG_TOKEN_REJECTED` — 5.13 · คิวรับ — 5.7) ตอน Postgres ล่มนาน event ส่วนใหญ่จึงเหลือแค่ตัวนับของ issue และ
  `extra` ที่เกิน 16 KB (`note` ยาว diff ของแบบฟอร์มใหญ่) เหลือ `{truncated, bytes, keys}` ไม่มี input ของแถว (3.14) และ (2) วางเอกสาร `activity`
  `source: "audit_fallback"` ลงคิวเดียวกัน ซึ่งไม่ติดเพดานการสุ่มเก็บหรือเพดานขนาด (ยังหายได้ถ้าคิวเต็มด้วยรายการชั้นเดียวกัน หรือ process ตายก่อน flush — ใหญ่เกินไม่ได้: ขั้นสุดท้ายของ `fitDocument()` คุมไว้ราว 40 KB) —
  เนื้อของแถวจึงเหลืออยู่ที่เอกสารนี้ (≤ 64 KB, 3.14) ·
  **ไม่พิมพ์ `err` ดิบอีกแล้ว** — `PrismaClientValidationError` ยก argument ของ INSERT
  (before/after/metadata พร้อมอีเมลและเลขบัตร) มาทั้งก้อน · ไม่มีทางไหนเขียนแถวนั้นกลับลง Postgres คำขอของผู้ใช้ยังสำเร็จตามเดิม ·
  ปิด log store (`LOG_STORE_ENABLED=false`) แล้วเหลือแค่บรรทัด `[capture]` ใน log ของ container (หายเมื่อ deploy `main/`) ซึ่งมีแค่ระดับ รหัสอ้างอิง
  fingerprint route และหัวเรื่องของ error **ไม่มี action subject หรือผู้กระทำของแถว** — สิ่งที่แถวนั้นบันทึกหายทั้งหมด · error บางชนิดของ
  Prisma ได้บรรทัด `prisma:error <target> — …` ที่กวาดแล้วของ Prisma เองด้วย (`db.ts`, 5.1) · capture นี้ตั้ง `errorCaptured` ของคำขอ: ถ้า route
  ตอบ 5xx เองทีหลังในคำขอเดียวกัน 5xx นั้นไม่ถูกเก็บเป็น `http.route-5xx` และรหัสอ้างอิงที่ผู้ใช้เห็นพาไปเจอ event `audit.write-failed` ตัวนี้ (5.8)
- **ใช้ prisma ตัวหลักเสมอ ไม่เคยใช้ `tx` ของผู้เรียก** INSERT จึง commit ด้วยตัวเอง `occurred_at` คือเวลาที่ `logAudit`
  สร้าง INSERT นั้น (2.1) ไม่ใช่เวลาของธุรกรรมที่ถูกบันทึก
- **แถวของการหมดอายุเขียนตอนมีคนมาเจอ ไม่ใช่ตอนหมด** — `SESSION_REVOKED` `EXPIRED` เกิดเมื่อมีคนยื่น cookie เก่า
  (`session.ts:86-93` `:106-124`) และ `ACTIVATION_KEY_EXPIRED` เกิดเมื่อมีคนเปิดลิงก์เก่า (`iam.ts:577-598`) `occurred_at` ของมัน
  จึงเป็นเวลาที่พบ ไม่ใช่เวลาที่หมดจริง (เวลาหมดจริงอยู่ใน `metadata.expires_at` ของคีย์ หรือ `iam.session.expires_at`
  / `last_seen_at`) และ session หรือคีย์ที่ไม่มีใครยื่นอีก**ไม่มีแถวเลย** (แผน §13 ข้อ 26)
- **`DOCUMENT_DOWNLOADED` เขียนก่อนส่งไฟล์** — เป็นข้อยกเว้นของกติกา “เขียนหลังการกระทำ” ข้างล่าง การดาวน์โหลดที่
  ล้มก็มีแถว และหน้าจอที่แสดงหลายฉบับเขียนหลายแถวต่อการเปิดหนึ่งครั้ง (4.8, แผน §13 ข้อ 18)
- ข้อตกลงของทั้ง catalogue คือ **เขียนหลัง commit และก่อนอีเมลที่ส่ง inline ซึ่ง throw ได้** (`CLAUDE.md`)
  ยกเว้นสองฟังก์ชันที่เขียนระหว่าง transaction ยังเปิดอยู่ (`revokeRoleAssignments()` และ
  `revokeSessionsFor()` ที่ถูกเรียกด้วย `tx`) — แถวของมัน `occurred_at` มาก่อนการ commit และ**รอดแม้
  transaction ถูก rollback** (6.2)
- จุดเรียกส่วนใหญ่ `await` ยกเว้น `ADMIN_TOKEN_REJECTED` และ `LOG_TOKEN_REJECTED` (ตัวบันทึกเดียวกัน `lib/token-rejection.ts`) ที่ยิงแล้วไม่รอ (`void write(...)`)
  คำตอบ 401 จึงไม่รอฐานข้อมูล
- สิ่งที่ทำให้แถวหายได้: INSERT ล้ม (Postgres ล่ม · ค่าไม่ใช่ UUID ในคอลัมน์ UUID · `BigInt` ใน JSON ที่
  `JSON.stringify` แปลงไม่ได้) · process ตายก่อน `await` จบ · สำหรับแถวที่ยิงแล้วไม่รอ process ถูก kill ·
  **ตอน shutdown** `shutdown()` (`index.ts:444-458`) เรียก `server.close()` บันทึก `shutdown` ลงคิว แล้วรอ `flushTokenRejections()` ไม่เกิน
  2 วินาที เข้าคิวใบสรุปของการเรียก admin API เขียนคิวของ log store ไม่เกิน 2 วินาที ปิด client ของ Mongo ไม่เกิน 1.5 วินาที จากนั้น `prisma.$disconnect()` และ `process.exit(0)`
  (5.10) โดยไม่รอคำขอที่กำลังวิ่ง — `logAudit` ที่ยังไม่จบของคำขอเหล่านั้นหายได้ และสำเนา `audit_fallback` ที่ยังค้างคิวหลัง 2 วินาทีก็หาย · ตัวนับของ `ADMIN_TOKEN_REJECTED` และ `LOG_TOKEN_REJECTED` ที่ยังไม่ถึงรอบสรุปอยู่ในหน่วยความจำอย่างเดียว process ตายหรือ
  restart แบบไม่ graceful = ครั้งที่นับไว้หายทั้งหมด และ flush ตอน shutdown ที่เกิน 2 วินาทีก็ถูกตัด

### 2.9 ตัวอย่างแถวเต็ม (ข้อมูลสมมติ)

เจ้าหน้าที่หน่วยงานแก้เบอร์โทรหน่วยงานและเลขบัตรผู้มีอำนาจฯ ในร่างคำขอจดทะเบียน แล้วกด “บันทึกแบบร่าง”
(`PATCH /api/organizations/:id` → `REQUEST_DRAFT_SAVED`, 4.7):

```json
{
  "id": "5f2c9a1e-3b7d-4e0a-9c14-2d8e6f7a0b31",
  "occurred_at": "2026-09-29T03:21:07.412+00:00",
  "actor_type": "USER",
  "actor_id": "c3d4e5f6-a7b8-4c9d-8e0f-1a2b3c4d5e6f",
  "action": "REQUEST_DRAFT_SAVED",
  "subject_type": "ORGANIZATION_REGISTRATION_REQUEST",
  "subject_id": "d4e5f6a7-b8c9-4d0e-9f1a-2b3c4d5e6f7a",
  "organization_id": "2c8e4a10-7f3b-4d6e-9a15-b0c9d8e7f6a5",
  "result": "SUCCESS",
  "before_summary_json": {
    "organizationPhone": "021234567",
    "approverCid": { "masked": "xxxxxxxxx0934", "changed": true }
  },
  "after_summary_json": {
    "organizationPhone": "021234599",
    "approverCid": { "masked": "xxxxxxxxx7710", "changed": true }
  },
  "ip_address": "203.0.113.77",
  "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  "correlation_id": "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
  "source_component": "web-portal",
  "metadata_json": {
    "actor_name": "นางสาว สมหญิง ตัวอย่าง",
    "actor_roles": ["ORGANIZATION_USER"],
    "actor_organization_id": "2c8e4a10-7f3b-4d6e-9a15-b0c9d8e7f6a5",
    "saved_via": "WEB_FORM",
    "request_number": "ORG-REG-2026-0021",
    "status": "DRAFT",
    "fields_changed": ["organizationPhone", "approverCid"]
  }
}
```

อ่านได้ว่า: ใคร (`actor_id` + `actor_name` ณ ตอนนั้น) ทำอะไร (`action`) กับอะไร (`subject_*`) ของหน่วยงาน
ไหน ผลเป็นอย่างไร เปลี่ยนจากอะไรเป็นอะไร (เลขบัตรเหลือแค่ 4 ตัวท้าย) จากที่ไหน (IP/UA ที่อ้างมา) และแถวอื่น
ของคำขอ HTTP เดียวกันหาได้จาก `correlation_id` (คำขอเดียว ไม่ใช่ทั้งการกระทำ — 2.5)

### 2.10 “คนนี้ทำอะไร เมื่อไร เปลี่ยนอะไร” — ค้นใน Postgres

**ทางหลักคือ API อ่าน log** — G2 หรือ `GET /timeline` ด้วย `x-log-person` ได้ทุกแถวในตาราง “คนอยู่ตรงไหน” ข้างล่างจากสำเนา (`relatedUserIds` และ
`email#` — 3.2) และทิ้งร่องรอย `AUDIT_LOG_READ` · `psql` ข้างล่างเป็นทางสำรองเมื่อ log store ไม่พร้อม หรือเมื่อต้องการคอลัมน์ดิบของ Postgres และ
**ไม่ทิ้งร่องรอย**

**เข้า `psql` ของ production** — `main/` คือ production (compose project `bdi-main`) container ของ postgres มี
`POSTGRES_USER` / `POSTGRES_DB` อยู่ใน env ของมันเอง:

```bash
cd /hdd1tb/bdi-project/main
docker compose exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

```sql
SET default_transaction_read_only = on;   -- กันพิมพ์ผิดแล้วแก้หรือลบแถว (ตารางนี้ไม่มี REVOKE หรือ trigger กันไว้)
SET TIME ZONE 'Asia/Bangkok';              -- ให้ occurred_at แสดงเป็นเวลาไทย (2.1)
```

ข้อควรระวัง: การเข้าแบบนี้**ไม่ทิ้งร่องรอยใด ๆ** (6.1) ผลลัพธ์มีข้อมูลส่วนบุคคล (อีเมล ชื่อ เลขบัตรเต็มในบางแถว — 7.1)
อย่าคัดลอกออกนอกเครื่อง · `audit_event` ไม่มี index บน `action` หรือ `organization_id` คิวรีเหล่านั้นอ่านทั้งตาราง (วันละราว
110 แถว จึงยังเร็ว) · อย่ารันระหว่างที่มีคน deploy `main/`

**คนหนึ่งคน** — คนปรากฏในแถวได้หลายที่ ค้นแค่ `actor_id` หรือแค่ subject ไม่พอ:

| ที่ที่ id หรืออีเมลของคนปรากฏ | แถวที่ใช้ที่นั้น |
|---|---|
| `actor_id` | ทุกอย่างที่เขาทำผ่าน session และแถวที่ helper ลงชื่อเขาเป็น actor (`SESSION_REVOKED` ของ `revokeSessionsFor()` แม้ admin เป็นคนสั่ง — 6.2) |
| `subject_id` เมื่อ `subject_type = 'USER_ACCOUNT'` | `LOGIN_*` · `LOGIN_OTP_ISSUED` · `PASSWORD_RESET_*` · `USER_ACCOUNT_*` · `USER_IDENTITY_RELEASED` · `SESSION_REVOKED` แบบ UA · `ROLE_ASSIGNED` ของ admin |
| `metadata.user_account_id` | `SESSION_REVOKED` `LOGOUT`/`ROTATED` · `ACTIVATION_KEY_USED` `REVOKED` `EXPIRED` · `IDENTITY_VERIFICATION_STARTED` `IDENTITY_VERIFIED` `IDENTITY_VERIFICATION_FAILED` ขา activate |
| `metadata.revoked_user_account_id` | `ROLE_REVOKED` รูปแบบ B |
| `metadata.transferred_user_account_id` | `REQUEST_RESET_TO_DRAFT` ทาง `ADMIN_TRANSFER` |
| `after.userAccountId` | `ROLE_ASSIGNED` ที่ subject เป็น assignment (activate · review · เปิดหน่วยงานในแถวก่อน `7259c09`) · `ACTIVATION_KEY_ISSUED` ของ invitation และ review |
| `before.userAccountId` | `ROLE_REVOKED` รูปแบบ A และ C |
| `before` / `after.assignedSpecialistId` | `REQUEST_ASSIGNED` |
| `metadata.filters.person` · `cidAccountId` · `emailAccountId` · `actorId` · `subjectId` (เมื่อ `subjectType = USER_ACCOUNT`) | `AUDIT_LOG_READ` — มีคนอ่านประวัติของเขา (4.12) |
| อีเมล: `metadata.email` · `before`/`after.email` | `LOGIN_FAILED` (ที่พิมพ์) · `PASSWORD_RESET_REQUESTED` · `USER_ACCOUNT_CREATED` · `ACTIVATION_KEY_ISSUED` ทุกแบบ (resend มี**แค่**อีเมล) · `INVITATION_DELETED` · `APPROVER_INVITATION_RECALLED` · `USER_ACCOUNT_DEACTIVATED` · `USER_IDENTITY_RELEASED` · `USER_ACCOUNT_UPDATED` แบบอีเมล/เลขบัตร |

```sql
\set uid   '5c3e0a4b-…'                -- id ของบัญชี
\set email 'somchai@agency.go.th'
SELECT occurred_at, action, result, actor_type, actor_id, metadata_json->>'actor_name' AS actor_name,
       subject_type, subject_id, before_summary_json, after_summary_json, metadata_json, correlation_id
FROM audit.audit_event
WHERE actor_id = :'uid'
   OR (subject_type = 'USER_ACCOUNT' AND subject_id = :'uid')
   OR metadata_json->>'user_account_id'             = :'uid'
   OR metadata_json->>'revoked_user_account_id'     = :'uid'
   OR metadata_json->>'transferred_user_account_id' = :'uid'
   OR after_summary_json->>'userAccountId'          = :'uid'
   OR before_summary_json->>'userAccountId'         = :'uid'
   OR before_summary_json->>'assignedSpecialistId'  = :'uid'
   OR after_summary_json->>'assignedSpecialistId'   = :'uid'
   OR metadata_json->'filters'->>'person'           = :'uid'
   OR metadata_json->'filters'->>'cidAccountId'     = :'uid'   -- อ่านด้วยเลขบัตร / อีเมลของเขา
   OR metadata_json->'filters'->>'emailAccountId'   = :'uid'
   OR metadata_json->'filters'->>'actorId'          = :'uid'
   OR (metadata_json->'filters'->>'subjectType' = 'USER_ACCOUNT' AND metadata_json->'filters'->>'subjectId' = :'uid')
   OR lower(metadata_json->>'email')       = lower(:'email')
   OR lower(before_summary_json->>'email') = lower(:'email')
   OR lower(after_summary_json->>'email')  = lower(:'email')
ORDER BY occurred_at, id;
```

บัญชี PENDING ที่ถูกลบไปแล้ว (`INVITATION_DELETED`, `APPROVER_INVITATION_RECALLED` ที่ `accountDeleted: true`) ไม่เหลือ id ให้ค้น
และแถว resend ของ `ACTIVATION_KEY_ISSUED` ก็ไม่มี id ของบัญชี — ต้องค้นด้วยอีเมล หรือเลขบัตรใน `before.cid` / `after.cid` (4.5)

**`recentAudit` ของ `GET /api/admin/users/:id` ไม่ใช่คำตอบของคำถามนี้** — มันคืนแค่ 20 แถวล่าสุดที่ `subject_type = 'USER_ACCOUNT'`
และ `subject_id` = บัญชีนั้น (`admin-users.ts:455-468`) จึงไม่เห็นทุกอย่างที่เขาทำในฐานะ actor และไม่เห็นแถวที่ subject เป็น assignment
(การได้หรือเสีย role) คีย์ (ออก ใช้ หมดอายุ เพิกถอน) หรือ session (logout, หมดอายุ)

**คำขอหนึ่งใบ** (เลขที่คำขอ) — แถวผลการตรวจ (`REQUEST_APPROVED` `REQUEST_RETURNED` `REQUEST_REJECTED` และ `REQUEST_SUBMITTED` ทั้งสองแบบ)
`DOCUMENT_SIGNED` และ `SPECIALIST_COMMENT_RECORDED` ไม่มี `metadata.request_number` ต้องจับจาก `subject_id` ส่วน `ATTACHMENT_*` และ `DOCUMENT_DOWNLOADED` มี subject เป็นไฟล์ ต้องผ่าน `attachment.owner_id`:

```sql
\set rn 'ORG-REG-2026-0004'
WITH r AS (
  SELECT id FROM organization.organization_registration_request WHERE request_number = :'rn'
  UNION ALL
  SELECT id FROM dataset.dataset_registration_request WHERE request_number = :'rn'
)
SELECT a.occurred_at, a.action, a.actor_type, a.metadata_json->>'actor_name' AS actor_name,
       a.after_summary_json->>'taskType' AS gate, a.after_summary_json->>'result' AS review_result,
       a.subject_type, a.before_summary_json, a.after_summary_json, a.metadata_json, a.correlation_id
FROM audit.audit_event a
WHERE a.subject_id IN (SELECT id FROM r)
   OR a.metadata_json->>'request_number' = :'rn'                       -- รวม REQUEST_DELETED ที่แถวคำขอหายแล้ว
   OR (a.subject_type = 'ATTACHMENT'
       AND a.subject_id IN (SELECT id FROM attachment.attachment WHERE owner_id IN (SELECT id FROM r)))
ORDER BY a.occurred_at, a.id;
```

`DOCUMENT_DOWNLOADED` ของ**ไฟล์กลาง**ของเวอร์ชันเอกสารกฎหมายไม่ผูกกับคำขอใดเลย (subject เป็นไฟล์ที่ทุกหน่วยงานใช้ร่วม) — หาได้แค่จาก
`organization_id` กับเวลา · ไฟล์ที่ `owner_type = 'DATASET'` (ของชุดข้อมูลที่เกิดจากคำขอ) คิวรีนี้ไม่ตาม

**หน่วยงานหนึ่งแห่ง** — `organization_id` คือหน่วยงานที่แถวนั้น**เกี่ยวกับ** ไม่ใช่หน่วยงานของผู้กระทำ (ของผู้กระทำอยู่ใน
`metadata.actor_organization_id`) แถวล็อกอิน (`LOGIN_*` `LOGIN_OTP_ISSUED`) รหัสผ่าน และ session มี `organization_id` null เสมอ ต้องค้นผ่านคน:

```sql
\set org '2c8e4a10-…'
SELECT occurred_at, action, actor_type, metadata_json->>'actor_name' AS actor_name, subject_type, subject_id, metadata_json
FROM audit.audit_event
WHERE organization_id = :'org' OR (subject_type = 'ORGANIZATION' AND subject_id = :'org')
ORDER BY occurred_at, id;
```

**คำขอ HTTP หนึ่งครั้ง** (correlation id เต็ม หรือรหัสอ้างอิง 8 ตัว) — G6 ได้ทุกอย่างของคำขอนั้นในครั้งเดียว รวม error ใน Mongo (3.11) · ใน `psql`:
แถวก่อน `74f751f` ที่ผู้เรียกส่ง id ตัวพิมพ์ใหญ่ถูกเก็บตามนั้นใน `audit_event` แต่สามตารางอื่นเป็นชนิด UUID (2.5):

```sql
\set cid '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d'
SELECT occurred_at, action, actor_type, actor_id, subject_type, subject_id, result, metadata_json
FROM audit.audit_event WHERE lower(correlation_id) = lower(:'cid') ORDER BY occurred_at, id;
-- รหัสอ้างอิง 8 ตัว:  WHERE lower(correlation_id) LIKE '9a8b7c6d%'
SELECT id, channel, status, attempt_count, last_error_code, last_attempt_at
FROM notification.notification_delivery WHERE correlation_id = :'cid'::uuid;
SELECT id, integration_type, operation, status, last_error_code, completed_at
FROM integration.integration_operation WHERE correlation_id = :'cid'::uuid;
```

**subject_type → ตาราง** (สำหรับ join กลับไปดูสถานะปัจจุบัน — ไม่มี FK แถวที่ถูกลบแล้วจึง join ไม่เจอ):

| `subject_type` | ตาราง | หมายเหตุ |
|---|---|---|
| `USER_ACCOUNT` | `iam.user_account` | |
| `USER_ROLE_ASSIGNMENT` | `iam.user_role_assignment` | คนคือ `user_account_id` |
| `USER_ACTIVATION_KEY` | `iam.activation_key` | แถวของ `INVITATION_DELETED` ถูกลบไปแล้ว |
| `SESSION` | `iam.session` | มี IP และ user agent **ดิบ** ของตอนสร้าง session |
| `ORGANIZATION` | `organization.organization` | |
| `ORGANIZATION_REGISTRATION_REQUEST` | `organization.organization_registration_request` | `request_number` |
| `DATASET_REGISTRATION_REQUEST` | `dataset.dataset_registration_request` | แถวของ `REQUEST_DELETED` ถูกลบไปแล้ว |
| `ATTACHMENT` | `attachment.attachment` | คำขอเจ้าของ = `owner_type` + `owner_id` · ไฟล์ที่ถูกแทน = `replaced_attachment_id` |
| `LEGAL_DOCUMENT` | `legal.legal_document` (`LEGAL_DOCUMENT_UPDATED`) หรือ `legal.legal_document_version` (`LEGAL_DOCUMENT_PUBLISHED`) | |
| `DATASET_CHOICE` | `administration.dataset_choice` | |
| `INTEGRATION_JOB` | `integration.integration_operation` | `state_not_found` มี `subject_id` null |
| `ADMIN_API` | — | `subject_id` null เสมอ |
| `AUDIT_LOG` | — | `AUDIT_LOG_READ` `LOG_TOKEN_REJECTED` · `subject_id` null เสมอ — สิ่งที่ถูกอ่านอยู่ใน `metadata.endpoint` กับ `filters` (4.12) |
| `ERROR_ISSUE` | — (`error_issues` ใน Mongo) | `ERROR_ISSUE_STATUS_CHANGED` · `subject_id` null เสมอ — fingerprint อยู่ใน `metadata.fingerprint` |

**session และอุปกรณ์** — การสร้าง session **ไม่ถูกบันทึก** `LOGIN_SUCCEEDED` ไม่มี id ของ session และ `/activate` เปิด session ให้โดยไม่มี
`LOGIN_SUCCEEDED` เลย (จำนวนการเข้าสู่ระบบ = `LOGIN_SUCCEEDED` + `USER_ACCOUNT_ACTIVATED`) แถวเดียวที่มี id ของ session คือ
`SESSION_REVOKED` แบบ subject `SESSION` คำถาม “ใช้เครื่องไหน” จึงต้องไปที่ `iam.session` (`user_account_id` `created_at` `ip_address`
`user_agent`) แล้วจับกับแถว audit ด้วยเวลาหรือ IP — ไม่มีอะไรผูกแถว audit ของการกระทำหนึ่งเข้ากับ session ที่ใช้

**อีเมลถึงผู้รับหรือไม่** — ทุกแถว “ออก…” แปลว่าออก ไม่ใช่ส่งถึง การแจ้งเตือนที่เข้าคิว (`notifyUsers()`) อยู่ใน
`notification.notification` + `notification.notification_delivery` (`status` `PENDING` → `SENT` / `FAILED` / `DEAD_LETTER`,
`attempt_count`, `last_error_code`) join กับแถว audit ด้วย `correlation_id` ของคำขอเดียวกัน — ใน Mongo ทุกครั้งที่ส่งไม่ผ่าน worker เรียก
`captureError` เป็น warning `delivery.send-failed` (fingerprint `smtp:<รหัส>` เมื่อ error มี `responseCode` หรือรหัส `E…` ไม่งั้นค่าตั้งต้น เช่น P2025
เมื่อแถว notification หายไป) และครบรอบเป็น error `delivery.dead-letter` ด้วย correlation id เดียวกัน (5.1) — ตัวนับของ issue เดินทุกครั้งที่ log store เปิดอยู่ แต่เอกสาร
event ติดเพดาน 50 ตัวต่อชั่วโมงของ fingerprint และ 600 ตัวต่อนาที และไม่ถูกเก็บตอนเกินเพดานขนาด ปิดอยู่ หรือคิวเต็ม (5.7) ·
`last_error_message` ของตารางนั้นยังเป็นข้อความดิบของ SMTP ซึ่งยกที่อยู่ผู้รับที่ถูกปฏิเสธมาได้ (5.6) ส่วนอีเมลที่ส่ง inline — OTP
คำเชิญ (admin และผู้มีอำนาจฯ) ลิงก์ตั้งรหัสผ่าน และอีเมลขอความเห็นผู้เชี่ยวชาญ — **ไม่มีบันทึกใน Postgres เลย** ความล้มเหลวของมันเหลือคำตอบ
500 พร้อมรหัสอ้างอิง บรรทัด `[capture]` ใน log ของ container (หายเมื่อ deploy `main/`) และ `error_events` ของคำขอนั้นที่มี breadcrumb `smtp`
`"ส่งอีเมลไม่สำเร็จ (<รหัส>)"` ตามหลัง breadcrumb `audit` ของแถวที่เขียนไปแล้ว (5.2) · คำเชิญผู้มีอำนาจฯ ที่ส่งแบบไม่รอได้ tag `mail.approver-invitation`
· อีเมลที่ส่งสำเร็จไม่มีบันทึกที่ไหน (breadcrumb อยู่ใน event ที่เกิดเฉพาะเมื่อคำขอนั้นล้ม)

---

## 3. รูปแบบเอกสารใน MongoDB

> **สร้างครบแล้ว (ขั้น 4–9)**: ฐานข้อมูล collection และผู้ใช้สองคน (3.1) · เอกสาร `activity` จากสามแหล่ง — สำเนาของทุกแถว
> `audit_event` ที่ relay คัดลอก (3.2–3.8) สำเนาของแถวที่ Postgres ไม่รับ (3.14) และบันทึกการเรียก `/api/admin*` (4.11) · index retention
> และ prune (3.9) · API อ่าน (3.11) · service `mongo` (3.12) · การเชื่อมต่อ ตัวแปร และสวิตช์ปิด (3.13) — collection ของ error อยู่ในหมวด 5
> ส่วนงานของผู้ดูแลที่ API ไม่มีอยู่ที่ 5.11

### 3.1 ฐานข้อมูล collection และผู้ใช้

ฐานข้อมูล `MONGODB_DB` (ค่าตั้งต้น `bdi_logs`) บน service `mongo` ของแต่ละ stack (3.12) · `_id` ทุกตัวเป็นสตริง (UUID · fingerprint ของ
`error_issues` · `"audit_event"` หรือ `"error_alerts"` ใน `relay_state`) · เอกสารละไม่เกิน 64 KB **เมื่อวัดเป็น BSON** (`lib/bson-size.ts` —
ตัดก่อนเขียน 3.2, 5.2) · driver ทางการ `mongodb` 6.21 ซึ่ง `lib/log-store.ts` เป็นไฟล์เดียวที่โหลด และโหลดด้วย `import()` เฉพาะเมื่อเปิดใช้
(ไฟล์อื่น import แค่ type) · **ไม่มีใครเรียก `createCollection`**: insert หรือ `createIndex` ครั้งแรกสร้าง collection เอง

| collection | เก็บอะไร | ใครเขียน (process → ผู้ใช้ Mongo) |
|---|---|---|
| `activity` | สำเนาของทุกแถว `audit_event` (`source:"audit_event"`) | relay ใน delivery-worker → `bdi_worker` (3.8) |
| | สำเนาของแถวที่ `logAudit` เขียนลง Postgres ไม่สำเร็จ (`source:"audit_fallback"`) | คิวของ backend → `bdi_backend` (3.14) |
| | บันทึกการอ่าน log ตอน Postgres ไม่รับ (`source:"audit_fallback"` · `action:"AUDIT_LOG_READ"`) | `recordLogRead()` เขียนตรงและรอผลไม่เกิน 2 วินาที **ไม่ผ่านคิว** → `bdi_backend` (3.11) |
| | การเรียก `/api/admin*` ทุกครั้งที่ไม่ได้ถึง router ของ log (`source:"http"` · `action:"ADMIN_API_REQUEST"`) | คิวของ backend → `bdi_backend` (4.11) |
| `error_events` | error หนึ่งครั้งต่อเอกสาร รวมรายงานจากเบราว์เซอร์และ Next server (5.2, 5.12) | คิวของ backend → `bdi_backend` · คิวของ worker → `bdi_worker` |
| `error_issues` | หนึ่งเอกสารต่อ fingerprint (5.3) | ตัว flush ของ backend และ worker (ตัวนับ) · `PATCH` ของ API อ่าน log (สถานะ — `bdi_backend`) · loop แจ้งเตือน (`alertedAt` `alertCount`) และ prune (`bdi_worker`) |
| `runtime_events` | process เริ่ม · ปิด · ตายกะทันหัน (5.5) | backend และ worker ของตัวเอง |
| `relay_state` | `_id:"audit_event"` — cursor สุขภาพของ relay reconcile prune rebuild และตัวเลขเพดานขนาด (3.8) · `_id:"error_alerts"` — สถานะของ loop แจ้งเตือน (5.14) | worker เท่านั้น → `bdi_worker` · backend อ่านอย่างเดียว |

**ผู้ใช้ Mongo สองคน** (role ใน `mongo/init/01-users.js`) — process ที่รับคำขอจากอินเทอร์เน็ตลบหรือเขียนทับ `activity` ไม่ได้ และ**ไม่มีใครในสองคนนี้
drop อะไรได้**:

| ผู้ใช้ → role (ในฐาน `bdi_logs`) | สิทธิ์ | ใช้โดย |
|---|---|---|
| `bdi_backend` → `bdiLogBackend` | `find` ทุก collection · `insert` เฉพาะ `activity` `error_events` `error_issues` `runtime_events` (`BACKEND_WRITES`) · `update` เฉพาะ `error_issues` (ตัวนับ และสถานะ open/resolved/ignored) — **ไม่มี** insert บน `relay_state` | backend |
| `bdi_worker` → `bdiLogWorker` | `find` `insert` `update` `remove` `createIndex` `listIndexes` `listCollections` `collStats` `dbStats` ทุก collection | delivery-worker |
| ไม่มีใครในสองคนได้ | `dropCollection` `dropDatabase` `dropIndex` `createCollection` `renameCollectionSameDB` `compact` สิทธิ์ข้ามฐาน และการจัดการผู้ใช้ | ต้องใช้ root (5.11) |

- ไม่มี API ใดลบหรือแก้ `activity` · `remove` ของ worker มีไว้ให้ prune ตามอายุและ rebuild (3.8, 3.9)
- collection ใหม่ที่ backend ต้องเขียนต้องเพิ่มใน `BACKEND_WRITES` แล้วรัน `01-users.js` ซ้ำด้วย root (3.12) บน volume เดิม ไม่งั้นได้
  `not authorized on bdi_logs to execute command { insert: … }` — volume ใหม่ได้ role ใหม่ตอน init เอง
- backend ไม่มี insert บน `relay_state` โดยตั้งใจ: backend ที่ถูกยึดเคยวางเอกสารปลอมได้ตอนที่มันยังไม่มี (cursor ที่เป็นเวลาปัจจุบันทำให้ relay ข้าม backfill
  ทั้งหมด · `overQuota: true` ทำให้ error ทั้งระบบเหลือแค่ตัวนับ) relay และ log-upkeep ยังตรวจค่าที่อ่านซ้ำอีกชั้น (3.8)
- **ต่างจากแบบ:** แผนให้ worker เพิ่มแค่ update remove createIndex ที่สร้างเพิ่ม `listIndexes` `listCollections` `collStats` `dbStats` — โค้ดใช้แค่ `dbStats`
  (log-upkeep) สามตัวที่เหลือยังไม่มีผู้ใช้ เป็นสิทธิ์เกินที่ตัดออกได้

### 3.2 เอกสาร `activity` — ฟิลด์

รูปเดียวทั้งสามแหล่ง (`ActivityDoc`, `lib/activity-shape.ts:255`) API อ่าน log จึงค้นด้วยตัวกรองเดียวกันได้ทั้งหมด

| ฟิลด์ | ชนิด | ค่า |
|---|---|---|
| `_id` | string | `audit_event.id` · `audit_fallback` และ `http` ได้ UUID ใหม่ |
| `source` | `"audit_event"` \| `"audit_fallback"` \| `"http"` | ทางที่เขียน |
| `schemaVersion` | int | `SCHEMA_VERSION` = 1 (`lib/activity-shape.ts:32`) — เพิ่มเมื่อรูปเปลี่ยนจนของเดิมต้อง rebuild (3.8) |
| `occurredAt` | Date | `occurred_at` · `audit_fallback` = เวลาที่ INSERT ล้ม · `http` = เวลาที่คำขอเข้ามา (ใบสรุป = การเรียกแรกที่พับ) |
| `action` | string | `action` · `http` = `"ADMIN_API_REQUEST"` |
| `category` | string | `categoryOf()` ตาราง 3.5 |
| `result` | `SUCCESS` \| `FAILURE` | `result` · `http`: status < 400 = `SUCCESS` · 4xx 5xx และคำขอที่ผู้เรียกตัดสายก่อนจบ = `FAILURE` |
| `actor.type` · `actor.id` | string · string \| null | `actor_type` · `actor_id` · `http`: `SYSTEM` เมื่อ token ผ่าน ไม่งั้น `ANONYMOUS` · id null |
| `actor.name` | string \| null | ยกจาก `metadata.actor_name` ผ่านกฎเลขบัตร (3.6) |
| `actor.roles` | string[] | ยกจาก `metadata.actor_roles` (`[]` ถ้าไม่มี) |
| `actor.organizationId` | string \| null | ยกจาก `metadata.actor_organization_id` |
| `via` | `SESSION` `ADMIN_TOKEN` `LOG_TOKEN` `WORKER` `SCRIPT` `ANONYMOUS` `SYSTEM` | 3.4 |
| `tokenFps` | string[] | fingerprint 12 ตัวของ token ที่แถวนี้เกี่ยว: `metadata.admin_token_fp` (งานผ่าน admin token) · `token_fp` (แถวปฏิเสธทันที `AUDIT_LOG_READ` และ `ERROR_ISSUE_STATUS_CHANGED` — `tokenFp=<fp ของ log token>` จึงได้การเปลี่ยนสถานะ issue มาด้วย) · `token_fps` (แถวสรุปของการปฏิเสธ) · `http`: token ที่ส่งมา ผ่านหรือไม่ผ่าน — `tokenFp=` ของ API (G8) ค้นด้วยฟิลด์นี้ |
| `subject.type` · `subject.id` | string · string \| null | `subject_type` · `subject_id` · `http`: ตาม route (4.11) |
| `organizationId` | string \| null | `organization_id` · `http`: หน่วยงานของ `/organizations/:id` หรือ `?organizationId=` |
| `requestNumber` | string \| null | relay: เลขที่ของคำขอที่เป็น subject หรือที่ไฟล์แนบที่เป็น subject เป็นของ คำขอที่ถูกลบแล้วเอาจากแถว `REQUEST_DELETED` ของมัน (`metadata.request_number` สำรองด้วย `before.requestNumber`) ไม่ได้ทั้งหมดใช้ `metadata.request_number` · `audit_fallback` ใช้ `metadata.request_number` อย่างเดียว (ไม่ถาม Postgres ซ้ำ) · `http` null |
| `gate` | string \| null | `after.taskType` ของแถวการตรวจ: `BDI_OFFICER_REVIEW` · `DATASET_SPECIALIST_REVIEW` · `ORGANIZATION_APPROVAL` · `BDI_FINAL_APPROVAL` |
| `before` / `after` | object \| null | `before_summary_json` / `after_summary_json` **ปิดข้อมูลแล้ว** (3.6) |
| `changedFields` | string[] | แถวที่บอกเองว่าอะไรเปลี่ยน (มี `metadata.fields_changed`): `fields_changed` + `synced_from_account` + `normalised_by_route` · แถวที่มีทั้ง before และ after: คีย์ที่อยู่ทั้งสองข้างและค่าดิบต่างกัน (`{masked, changed: true}` นับว่าเปลี่ยน) — แถวที่เก็บทั้ง state หรือคนละรูปจึงได้แค่คีย์ที่เปลี่ยนจริง (`USER_ACCOUNT_DEACTIVATED` `{status, email, cid}` → `{status}` ได้ `["status"]`) · นอกนั้น `[]` |
| `reason` | string \| null | `metadata.reason` ถ้าเป็นสตริง ผ่านกฎเลขบัตร ไม่เกิน 1,000 ตัว (ตัวเต็มที่ปิดแล้วอยู่ใน `metadata`) — **ปนรหัสกับข้อความที่คนพิมพ์** (ตาราง “ความหมายของ reason” ใน 4.0) ข้อความที่อยู่คีย์อื่น (`admin_reason` `note` `after.reason`) ไม่ถูกยกมา |
| `metadata` | object \| null | `metadata_json` ปิดแล้ว ตัด `actor_*` ออก (`ip_unparsed` กับ `admin_token_fp` ยังอยู่) · `http`: 4.11 |
| `request.correlationId` · `request.reference` | string | `correlation_id` · 8 ตัวแรกของมัน — “รหัสอ้างอิง” ที่ผู้ใช้เห็นบน 5xx |
| `request.ip` · `request.userAgent` | string \| null | `ip_address` ผ่านกฎเลขบัตร · `user_agent` ผ่าน `storedUserAgent()` ซ้ำแล้วผ่านกฎเลขบัตร · `http`: IP ของบริบทตามที่เป็น (ผ่าน `isIP()` แล้ว ไม่ผ่านกฎเลขบัตร — `admin-access.ts:321`) user agent กฎเดียวกัน · ถูก `$unset` หรือลบทั้งเอกสารตามอายุ (3.9) |
| `request.method` `route` `status` `durationMs` | string / string / int / int \| null | relay: null ทั้งสี่ (`audit_event` ไม่มีคอลัมน์เหล่านี้) · `audit_fallback`: `method` `route` จากบริบท · `http`: ครบ — `route` เป็นแม่แบบที่ Express จับได้ ส่วน mount เป็นตัวเล็ก (`/api/admin/users/:id`) หรือ null เมื่อไม่ถึง route (401 ที่ guard, 404) |
| `sourceComponent` | string | `source_component` |
| `relatedUserIds` | string[] | คนที่แถวนี้เกี่ยวข้อง (index ของ `x-log-person`) อ่านจากค่าดิบ: `actor.id` · `subject.id` เมื่อ subject เป็น `USER_ACCOUNT` · `metadata.user_account_id` `revoked_user_account_id` `transferred_user_account_id` · `before`/`after.userAccountId` · `before`/`after.assignedSpecialistId` · ของ `AUDIT_LOG_READ`: บัญชีที่การอ่านครั้งนั้นเปิดประวัติ (4.12) — แถวที่มีแค่อีเมลของบัญชีที่ถูกลบไปแล้ว (resend ของคำเชิญ `INVITATION_DELETED` `APPROVER_INVITATION_RECALLED`) ไม่มี id ให้ใส่ หาเจอด้วย `email#` แทน (3.6) |
| `hashKeys` | string[] | key ค้นหา `cid#…` `email#…` (3.6) · `[]` เมื่อไม่ตั้ง `LOG_HASH_KEY` |
| `mirroredAt` | Date | เวลาที่เขียนครั้งแรก (`$setOnInsert`) |
| `truncated` · `hashKeysTruncated` · `relatedUserIdsTruncated` · `tokenFpsTruncated` | `true` | มีเฉพาะเมื่อถูกตัด (ข้างล่าง) — ค่าที่ตกไปจากรายการค้นด้วย `x-log-*` หรือ `tokenFp=` ไม่เจอ |
| `projectionFailed` | `true` | relay แปลงแถวไม่ได้ (ข้อมูลรูปที่ไม่มีใครคาด) — เอกสารย่อที่มีแค่ใคร ทำอะไร เมื่อไร กับ subject แถวเต็มยังอยู่ใน Postgres และเก็บ error `log-relay.project` |
| `fallback.errorEventId` | string \| null | เฉพาะ `audit_fallback` (3.14) |

**เพดาน 64 KB** (`fitDocument()`, `lib/activity-shape.ts:625`) วัดเป็น BSON (ขนาดที่ Mongo เก็บ) และตัดแบบกำหนดได้ ไม่ทิ้งทั้งใบ ทีละขั้น หยุดทันทีที่ผ่าน:

1. ย่อ `before` `after` `metadata` — ข้อความ 2,048 → 256 → 32 ตัว · array และ object 500 → 100 → 20 ใบ (ส่วนที่ตัดเหลือเครื่องหมาย `…(+N)` หรือคีย์ `…`)
2. ยังเกินและมีรายการที่ยาวผิดปกติ: `hashKeys` `relatedUserIds` `tokenFps` เหลือ 200 ใบแรกพร้อมธง · `changedFields` 200 ชื่อ ชื่อละไม่เกิน 64 ตัว —
   แล้วย่อสามก้อนใหม่ตามข้อ 1 จากตัวตั้งต้น (แถวที่ข้อความมีเลขบัตรสี่พันตัวได้ `cid#` สี่พันตัวที่ข้อ 1 แตะไม่ได้)
3. ยังเกิน: สามก้อนเหลือ `{truncated: true, keys}` (ชื่อคีย์ของตัวตั้งต้นไม่เกิน 50)
4. ยังเกิน (ข้อความยาวมากในฟิลด์ชั้นบน): โครงของเอกสาร (`skeletonOf`) — ทุกฟิลด์ยังอยู่ ข้อความไม่เกิน 64 ตัว รายการไม่เกิน 20 ใบ ขนาดมีขอบบนตามโครงสร้าง

แถวเดิมได้ผลเดิมทุกครั้ง (rebuild ได้เอกสารเดียวกัน) และ `truncated: true` บอกว่าถูกตัด ตัวเต็มยังอยู่ใน Postgres — ยกเว้น `audit_fallback` ซึ่งไม่มีใน
Postgres ส่วนที่ถูกตัดจึงหายจริง · วัดแล้ว แถว 100 KB ได้เอกสาร 13.7 KB ที่ยังอ่านข้อความ 2 KB แรกได้

### 3.3 แถว `audit_event` → เอกสาร `activity` (`projectAuditRow()`, `lib/activity-shape.ts:449`)

| คอลัมน์ `audit.audit_event` | → ฟิลด์ `activity` | การแปลง |
|---|---|---|
| `id` | `_id` | คัดลอก |
| — | `source` · `schemaVersion` | `"audit_event"` · `1` |
| `occurred_at` | `occurredAt` | Date (มิลลิวินาที — cursor ของ relay เก็บไมโครวินาทีแยกเอง 3.8) |
| `actor_type` · `actor_id` | `actor.type` · `actor.id` | คัดลอก |
| `metadata_json.actor_name` / `actor_roles` / `actor_organization_id` | `actor.name` / `actor.roles` / `actor.organizationId` | ยกขึ้นมา แล้วลบออกจาก `metadata` · ชื่อผ่านกฎเลขบัตร |
| `action` | `action` · `category` | คัดลอก · 3.5 |
| `subject_type` · `subject_id` | `subject.type` · `subject.id` | คัดลอก |
| `organization_id` | `organizationId` | คัดลอก |
| `result` | `result` | คัดลอก |
| `before_summary_json` | `before` | ปิดข้อมูล (3.6) |
| `after_summary_json` | `after` · `gate` | ปิดข้อมูล · `after.taskType` → `gate` |
| `ip_address` | `request.ip` | กฎเลขบัตร — แถวก่อน 2026-09-28 เก็บ X-Forwarded-For ข้อความอะไรก็ได้ (`CLAUDE.md` Traps) |
| `user_agent` | `request.userAgent` | `storedUserAgent()` ซ้ำแล้วกฎเลขบัตร — แถวที่เขียนก่อน `a0a0578` (production วันนี้ทั้งหมด) เก็บ header ดิบ · ทำซ้ำได้ ค่าที่ผ่านแล้วไม่เปลี่ยน |
| `correlation_id` | `request.correlationId` · `request.reference` | คัดลอก และ 8 ตัวแรก |
| `source_component` | `sourceComponent` · `via` | คัดลอก · 3.4 |
| `metadata_json` | `metadata` · `tokenFps` · `reason` · `requestNumber` (สำรอง) · `relatedUserIds` · `hashKeys` · `changedFields` | ปิดข้อมูล ตัด `actor_*` |
| (ตารางคำขอ · ไฟล์แนบ · แถว `REQUEST_DELETED`) | `requestNumber` | `requestNumbers()` (`workers/log-relay.ts:660`) — `findMany` ครั้งเดียวต่อตารางต่อหน้า ถามแถว `REQUEST_DELETED` เฉพาะเมื่อมี id ที่หาไม่เจอ · ไฟล์ของชุดข้อมูลที่อนุมัติแล้ว (`DATASET`) และไฟล์ของเอกสารกฎหมายไม่ได้เลขที่ |
| — | `request.method/route/status/durationMs` | `null` |
| — | `mirroredAt` | นาฬิกาของ relay |

ค่าดิบใช้หา `relatedUserIds` `tokenFps` `changedFields` และ `hashKeys` ก่อน แล้วจึงปิด ค่าดิบไม่ออกจาก process ทางอื่น · projection ไม่ throw บนข้อมูลแปลก
(ค่าที่ชนิดไม่ตรงได้ null หรือ `[]`) แถวที่แปลงไม่ได้ทั้งแถวได้เอกสาร `projectionFailed` แทน ไม่ทำให้ทั้งหน้าล้ม — หน้าที่ล้มทุกรอบคือ cursor ที่ไม่มีวันขยับ

### 3.4 `via` — มาทางไหน (`viaOf()`, `lib/activity-shape.ts:177`)

ไล่ตามลำดับ ข้อแรกที่ตรงชนะ:

1. `sourceComponent` เป็น `seed-demo` หรือ `admin-script` → `SCRIPT`
2. `sourceComponent` เป็น `notification-worker` หรือ `activation-expiry-job` → `WORKER` — กฎเผื่ออนาคต วันนี้**ไม่มีแถวแบบนี้**: worker ไม่เขียน audit และ
   `activation-expiry-job` มีอยู่แค่ในคอมเมนต์ของ `schema.prisma`
3. `action` เป็น `AUDIT_LOG_READ` หรือ `ERROR_ISSUE_STATUS_CHANGED` → `LOG_TOKEN`
4. `sourceComponent = admin-portal` หรือมี `metadata.admin_token_fp` → `ADMIN_TOKEN` — มาก่อน actor โดยตั้งใจ: แถวที่ helper เขียนระหว่างคำสั่งของ
   admin มี `actor_type USER` (บัญชีเป้าหมาย — 6.2) ถ้าดูแค่ actor จะได้ `SESSION` ทั้งที่มาทาง admin token
5. `actor.type = ANONYMOUS` → `ANONYMOUS` — `ADMIN_TOKEN_REJECTED` `LOG_TOKEN_REJECTED` และแถวก่อนล็อกอินที่ route ส่ง `ANONYMOUS` เอง ·
   **ไม่ใช่ทุกแถวก่อนล็อกอิน**: แถวที่ส่ง `actorId` ของบัญชีที่เพิ่งพิสูจน์ตัวตน (`LOGIN_SUCCEEDED` · `USER_ACCOUNT_ACTIVATED` `ACTIVATION_KEY_USED`
   `ROLE_ASSIGNED` ของ `/activate` · `PASSWORD_RESET_COMPLETED` ที่สำเร็จ) เป็น `USER` จึงได้ `SESSION` ทั้งที่ยังไม่มี session
6. `actor.type = USER` → `SESSION`
7. ที่เหลือ → `SYSTEM` — แถว `SYSTEM` ของ helper บนเส้นทางสาธารณะ (`ACTIVATION_KEY_EXPIRED` · `SESSION_REVOKED` LOGOUT/ROTATED · `ROLE_REVOKED`
   รูปแบบ B บน `/activate` — 2.2) แถว `request-service` และ `EXTERNAL`

สำเนา `audit_fallback` ใช้ฟังก์ชันเดียวกัน (3.14) · เอกสาร `http` ตั้งเอง: token ผ่าน = `ADMIN_TOKEN` นอกนั้น `ANONYMOUS` (4.11)

**แถวที่เขียนก่อน deploy ของการ์ดนี้** (ทุกแถวของ production วันนี้ — relay เติมจากแถวแรก) ได้ `via` ที่บอกน้อยกว่า: แถวของ admin token ก่อนการ์ดเป็น
`SYSTEM` + `web-portal` ไม่มี fingerprint → `SYSTEM` · แถวของ helper ระหว่างคำสั่ง admin ก่อนการ์ด (`revokeSessionsFor()` …) → `SESSION` ·
`LOGIN_FAILED` ก่อนการ์ดเป็น `SYSTEM` → `SYSTEM` · 42 แถว `request-service` (การอัปโหลดไฟล์ที่หลุด context — 2.4) → `SYSTEM` — `via=ADMIN_TOKEN`
จึงไม่เจองานของ admin ก่อนเส้นแบ่งใน 6.2 อ่าน `via` ของแถวก่อนเส้นนั้นด้วยความระวัง

### 3.5 ตาราง action → category (`CATEGORY_BY_ACTION`, `lib/activity-shape.ts:66`)

ตารางเป็น `Record<AuditActionCode, …>` — รหัสใหม่ใน `AuditAction` ที่ไม่ได้ใส่ตรงนี้ typecheck ไม่ผ่าน ไม่ใช่ตกไปเป็น `other` เงียบ ๆ แล้วถูกลบที่ 400 วัน ·
category ตัดสินจาก `action` ไม่ใช่ `source_component` และเป็นตัวที่ retention ผูกอยู่ (3.9)

| category | รหัส |
|---|---|
| `auth` | `LOGIN_SUCCEEDED` · `LOGIN_FAILED` · `LOGIN_OTP_ISSUED` · `PASSWORD_RESET_REQUESTED` · `PASSWORD_RESET_COMPLETED` · `IDENTITY_VERIFICATION_STARTED` · `IDENTITY_VERIFIED` · `IDENTITY_VERIFICATION_FAILED` |
| `session` | `SESSION_REVOKED` |
| `account` | `USER_ACCOUNT_CREATED` · `USER_ACCOUNT_ACTIVATED` · `USER_ACCOUNT_UPDATED` · `USER_ACCOUNT_SUSPENDED` · `USER_ACCOUNT_REINSTATED` · `USER_ACCOUNT_DEACTIVATED` · `USER_ACCOUNT_REACTIVATED` · `USER_IDENTITY_RELEASED` |
| `role` | `ROLE_ASSIGNED` · `ROLE_REVOKED` |
| `invitation` | `ACTIVATION_KEY_ISSUED` · `ACTIVATION_KEY_USED` · `ACTIVATION_KEY_REVOKED` · `ACTIVATION_KEY_EXPIRED` · `INVITATION_DELETED` · `APPROVER_INVITATION_RECALLED` |
| `organization` | `ORGANIZATION_CREATED` · `ORGANIZATION_UPDATED` · `ORGANIZATION_ACTIVATED` |
| `request` | `REQUEST_CREATED` · `REQUEST_DRAFT_SAVED` · `REQUEST_FORM_GENERATED` · `REQUEST_SUBMITTED` (ยกเว้นข้อล่าง) · `REQUEST_UPDATED` · `REQUEST_RESET_TO_DRAFT` · `REQUEST_CANCELLED` · `REQUEST_DELETED` |
| `review` | `REQUEST_ASSIGNED` · `REQUEST_APPROVED` · `REQUEST_RETURNED` · `REQUEST_REJECTED` · `SPECIALIST_COMMENT_RECORDED` · **`REQUEST_SUBMITTED` ที่มี `after.taskType`** (`categoryOf()`) |
| `document` | `ATTACHMENT_UPLOADED` · `ATTACHMENT_REPLACED` · `ATTACHMENT_DELETED` · `DOCUMENT_DOWNLOADED` · `DOCUMENT_SIGNED` · `DATA_EXPORTED` (ยังไม่มีใครเขียน) |
| `config` | `LEGAL_DOCUMENT_PUBLISHED` · `LEGAL_DOCUMENT_UPDATED` · `DATASET_CHOICE_CHANGED` |
| `log-access` | `AUDIT_LOG_READ` · `ERROR_ISSUE_STATUS_CHANGED` |
| `admin-access` | `ADMIN_TOKEN_REJECTED` · `LOG_TOKEN_REJECTED` · `ADMIN_API_REQUEST` (Mongo อย่างเดียว — `CATEGORY_OF_LATER_ACTIONS`) |
| `other` | รหัสที่ไม่อยู่ในตาราง — รหัสของ `AuditAction` ตกมาที่นี่ไม่ได้ (typecheck) เหลือแค่แถวที่ `action` ในฐานข้อมูลไม่ใช่รหัสของโค้ดนี้ |
| `system` | ยังไม่มีรหัสใดใช้ |

**[ต้องตัดสิน]** ค่าที่เลือกไว้ 2026-09-30 เป็นค่าตั้งต้นให้ BDI ยืนยัน: วงจรของคีย์เปิดใช้งานทั้งหมดอยู่ `invitation` รวม `USED`/`EXPIRED` (แผน §1 จัดสองตัวนี้
ไว้ใน authentication log — ถ้าเป็น `auth` จะถูกลบที่ 400 วันแล้ววงจรของคีย์ขาดเป็นสองท่อน) · `REQUEST_ASSIGNED` เป็น `review` (การตรวจ) ไม่ใช่ `request` ·
token ที่ถูกปฏิเสธเป็น `admin-access` คู่กับบันทึกการเรียก admin API ไม่ใช่ `auth` ของผู้ใช้ · `system` กับ `other` เก็บแบบ `auth` (3.9)

**`REQUEST_SUBMITTED` มีสองความหมาย** — การนำส่งจริงมี `after = {requestNumber}` ส่วนการตรวจคำขอหน่วยงานที่ผ่านด่านที่ยังไม่ใช่ด่านสุดท้ายก็เขียนรหัสนี้
ด้วย `after = {taskType, result, note}` (4.9) category จึงดู `after.taskType` ไม่ใช่ดูแค่รหัส

### 3.6 การปิดข้อมูลในสำเนา และ `hashKeys`

ทำใน `lib/redact.ts` (`maskForLogStore` `maskCidText` `maskedTypedEmail`) กับ `lib/activity-shape.ts` ใช้กฎเดียวกันทั้งสามแหล่งของ `activity` —
**Postgres ไม่ถูกแตะ**: ทุกอย่างที่นี่ทำกับสำเนา (แผน Q4)

| อะไร | อยู่ที่ไหน | รูปในสำเนา | hash key |
|---|---|---|---|
| ค่าใต้คีย์ที่ชื่อตรง `CID_KEY = /cid$\|nationalid\|^pid$\|^thaid_subject$/i` ทุกระดับความลึก (`lib/redact.ts:771` — กฎเดียวกับ `CID_KEY` ของ `lib/audit.ts`) | `cid` `approverCid` `userCid` `signatoryNationalId` `pid` · `thaid_subject` (`sub` ของ DOPA คือเลขบัตร 13 หลักไม่ว่า `THAID_USE_PID` เป็นอะไร) | `{"masked":"xxxxxxxxx1234"}` (4 ตัวท้าย) · object หรือ array ปิดทีละใบ | `cid#` |
| `{masked, changed: true}` ที่ Postgres ปิดมาแล้ว (`sanitizeDiff()` — 7.2) | `REQUEST_DRAFT_SAVED` ของคำขอหน่วยงาน · `USER_ACCOUNT_CREATED` · `ACTIVATION_KEY_ISSUED` ของคำเชิญผู้มีอำนาจฯ … | ผ่านไปตามเดิม (ยังผ่านกฎเลขในข้อความข้างล่าง) | **ไม่มี** — ค่าจริงไม่เหลือให้ทำ key `x-log-cid` จึงไม่เจอแถวเหล่านี้ |
| เลขบัตรในข้อความ**ทุกค่า** (`CID_RUN`, `lib/redact.ts:298`: 13 หลักติดกัน หรือคั่นด้วย `-` `.` `_` ช่องว่าง ไม่เกินสามตัวระหว่างเลข · เลขไทยและเลขเต็มความกว้างนับเป็นเลข) และ number ที่มี 13 หลัก | ทุกค่าใน `before` `after` `metadata` (`notes` `objectiveOther` ความเห็น เหตุผล …) · ชื่อคีย์ · `reason` `actor.name` `changedFields` `request.ip` `request.userAgent` | `[cid]` | `cid#` |
| เลขบัตรใน**ชื่อไฟล์** — ค่าใต้คีย์ `FILE_KEY = /(?:file_?name\|storage_?key\|original_?name)s?$/i` (`lib/redact.ts:777`) | `after.filename` (อัปโหลด ดาวน์โหลด ลงนาม) · `before.attachments[].originalFileName` / `storageKey` (`REQUEST_DELETED`) | `[cid]` เฉพาะ 13 หลักติดกัน หรือคั่นด้วย `-`/ช่องว่างตัวเดียว (`FILENAME_CID_RUN`) — `scan_20260930_12345.pdf` รอด `1101700203451.pdf` ไม่รอด | `cid#` |
| อีเมลที่**พิมพ์มา**ตอนล็อกอิน (อาจไม่ใช่ของบัญชีไหน) | `LOGIN_FAILED.metadata.email` เท่านั้น | `{"masked":"so***@agency.go.th"}` (2 ตัวแรกของ local part) | `email#` |
| อีเมลอื่นทุกตัวใต้คีย์ที่ลงท้าย `email` / `e-mail` ทุกชั้น (`emailsIn()`, `lib/activity-shape.ts:219`) | อีเมลบัญชี — `PASSWORD_RESET_REQUESTED.metadata.email` · `before.email` ของ `INVITATION_DELETED` · `ACTIVATION_KEY_ISSUED.after.email` … | **คงไว้** อ่านได้ | `email#` — แถวที่มีแค่อีเมลบัญชีจึงค้นด้วย `x-log-person` (อีเมล) หรือ `x-log-email` เจอ |
| key ที่บันทึกการอ่านเขียนไว้เอง (`metadata.filters` ของ `AUDIT_LOG_READ`: `cidKey` `emailKey` `personEmailKey` `personCidKey` `cidAccountEmailKey` `emailAccountCidKey` และ `person` ที่เป็น `email#…`) | 4.12 | ไม่ผ่านการปิด (เป็น HMAC อยู่แล้ว — ฐานสิบหก 16 ตัวราวหนึ่งในสี่ร้อยมีเลขติดกัน 13 ตัวซึ่งกฎเลขบัตรจะทำลาย) | ยกเข้า `hashKeys` ตามเดิม |
| ชื่อ เบอร์โทร ที่อยู่ | ทุกที่ | คงไว้ (decision 10 ของแผน) | — |
| IP และ user agent | `request.ip` `request.userAgent` | คงไว้ ถูกตัดหรือลบตามอายุ (3.9) | — |
| `actor_*` | `metadata` | ย้ายไป `actor` | — |

- **key ค้นหา** (`hashKeyOf()`, `lib/activity-shape.ts:202`) = `cid#` หรือ `email#` + 16 ตัวแรก (64 บิต) ของ HMAC-SHA256 ด้วยกุญแจ `LOG_HASH_KEY` ของค่าที่
  normalise แล้ว — เลขบัตร: เลขไทยและเลขเต็มความกว้างเป็นอารบิก เหลือแต่ตัวเลข ต้องครบ 13 หลัก (เลขที่กรอกไม่ครบไม่ได้ key) · อีเมล: ตัดช่องว่างหัวท้าย
  ตัวพิมพ์เล็ก ต้องมี `@` ไม่เกิน 254 ตัว ฟังก์ชันเดียวกันใช้ทั้งตอนเขียนและตอนค้น (3.11) กุญแจลับทำให้ไล่ย้อนเลขบัตร 10¹³ ค่าจาก `hashKeys` ไม่ได้
- **ไม่ตั้ง `LOG_HASH_KEY`** (production ไม่มีค่าตั้งต้น — dev มี `dev-log-hash-key`) = ปิดอย่างเดียว `hashKeys` ว่าง ทุก process พิมพ์
  `[log-store] <service>: คำเตือน: ไม่ได้ตั้ง LOG_HASH_KEY …` ตอนบูต `/status` แสดง `hashKey: "missing"` และ `x-log-cid` `x-log-email` กับ `x-log-person`
  ที่เป็นอีเมลที่ไม่มีบัญชีตอบ 503 `hash_search_unavailable` (อีเมลที่มีบัญชียังค้นผ่าน id ได้) · backend กับ worker ต้องใช้ค่าเดียวกัน
- **เปลี่ยนกุญแจ = ต้อง rebuild** (3.8) — relay เทียบ `relay_state.hashKeyFp` (`hashKeyFingerprint()` — HMAC ของข้อความคงที่ ไม่ใช่กุญแจ) แล้วเตือนครั้งเดียว
  ต่อ process · rebuild สร้างใหม่ได้เฉพาะ `source:"audit_event"` เอกสาร `audit_fallback` และ `http` ไม่มีใน Postgres จึงค้าง key ของกุญแจเก่า — ข้อจำกัดที่ยอมรับ
- **ราคาของกฎตัวกว้าง**: เลขอื่นที่มี 13 หลักคั่นด้วยจุดหรือขีดล่าง (ทศนิยมยาว วันเวลาแบบ `30.09.2026 12.34.567`) กลายเป็น `[cid]` และได้ `cid#` ที่ไม่มีใครค้น ·
  เบอร์โทร 10 หลักที่ตามด้วยช่องว่างกับเลขสามตัว (`0812345678 123`) เป็น `[cid]` — ตัวเต็มยังอยู่ใน Postgres ปิดเกินไว้ก่อน รอ DPO (9.8)
- **ยังรอด**: อีเมลในข้อความอิสระ (บันทึก เหตุผล) ไม่ได้ key และไม่ถูกปิด · เลขบัตรที่คั่นด้วย `/` หรือตัวคั่นสี่ตัวขึ้นไป · อีเมลใน array ใต้คีย์พหูพจน์
  ไม่ได้ key (วันนี้ audit ไม่มีแถวแบบนี้)
- **ต่างจากแบบ:** แผน §7.6 ปิดเลข 13 หลักเฉพาะใน `note` และ `reason` และเหลือ 4 ตัวท้าย ที่สร้างปิดทุกค่าเป็น `[cid]` — ผู้ตรวจพิมพ์เลขบัตรลง `notes` ของร่าง
  คำขอแล้วเลขเต็มไปถึงสำเนา (พบ 2026-09-30) · แผนให้ hash แค่อีเมลที่พิมพ์ตอนล็อกอิน ที่สร้างทำ `email#` ให้อีเมลทุกตัวใต้คีย์ `*email` เพราะแถวของบัญชีที่ถูก
  ลบแล้วไม่มี id ให้ `relatedUserIds`

### 3.7 ตัวอย่างเอกสาร (ข้อมูลสมมติ)

**แถวใน 2.9 หลังผ่าน relay** — ค่าที่ Postgres ปิดแล้วผ่านไปตามเดิม จึงไม่มี `cid#`:

```json
{
  "_id": "5f2c9a1e-3b7d-4e0a-9c14-2d8e6f7a0b31",
  "source": "audit_event",
  "schemaVersion": 1,
  "occurredAt": { "$date": "2026-09-29T03:21:07.412Z" },
  "action": "REQUEST_DRAFT_SAVED",
  "category": "request",
  "result": "SUCCESS",
  "actor": { "type": "USER", "id": "c3d4e5f6-a7b8-4c9d-8e0f-1a2b3c4d5e6f",
             "name": "นางสาว สมหญิง ตัวอย่าง", "roles": ["ORGANIZATION_USER"],
             "organizationId": "2c8e4a10-7f3b-4d6e-9a15-b0c9d8e7f6a5" },
  "via": "SESSION",
  "tokenFps": [],
  "subject": { "type": "ORGANIZATION_REGISTRATION_REQUEST", "id": "d4e5f6a7-b8c9-4d0e-9f1a-2b3c4d5e6f7a" },
  "organizationId": "2c8e4a10-7f3b-4d6e-9a15-b0c9d8e7f6a5",
  "requestNumber": "ORG-REG-2026-0021",
  "gate": null,
  "before": { "organizationPhone": "021234567", "approverCid": { "masked": "xxxxxxxxx0934", "changed": true } },
  "after":  { "organizationPhone": "021234599", "approverCid": { "masked": "xxxxxxxxx7710", "changed": true } },
  "changedFields": ["organizationPhone", "approverCid"],
  "reason": null,
  "metadata": { "saved_via": "WEB_FORM", "request_number": "ORG-REG-2026-0021", "status": "DRAFT",
                "fields_changed": ["organizationPhone", "approverCid"] },
  "request": { "correlationId": "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d", "reference": "9a8b7c6d",
               "ip": "203.0.113.77", "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) …",
               "method": null, "route": null, "status": null, "durationMs": null },
  "sourceComponent": "web-portal",
  "relatedUserIds": ["c3d4e5f6-a7b8-4c9d-8e0f-1a2b3c4d5e6f"],
  "hashKeys": [],
  "mirroredAt": { "$date": "2026-09-29T03:21:12.030Z" }
}
```

**`LOGIN_FAILED` ที่อีเมลพิมพ์มาถูกปิดและได้ hash key** (แสดงเฉพาะฟิลด์ที่ต่างจากข้างบน):

```json
{
  "action": "LOGIN_FAILED", "category": "auth", "result": "FAILURE",
  "actor": { "type": "ANONYMOUS", "id": null, "name": null, "roles": [], "organizationId": null },
  "via": "ANONYMOUS",
  "subject": { "type": "USER_ACCOUNT", "id": "4b9e2d17-0a3c-4f58-b6e1-7c2d9a8f0e31" },
  "metadata": { "failure_reason": "OTP_INVALID", "email": { "masked": "so***@example.go.th" },
                "otp_code_id": "0f6d2a3b-8c4e-4d1f-a9b7-5e2c1d0a9b88", "attempts_left": 2 },
  "relatedUserIds": ["4b9e2d17-0a3c-4f58-b6e1-7c2d9a8f0e31"],
  "hashKeys": ["email#a41c9e07d2b35f68"]
}
```

ตัวอย่างของ `audit_fallback` อยู่ที่ 3.14 ของ `ADMIN_API_REQUEST` (ตัวเดี่ยวและใบสรุป) ที่ 4.11 และของ `AUDIT_LOG_READ` ที่ 4.12

### 3.8 relay — ทางเขียน `activity` (`workers/log-relay.ts`)

relay กับงานดูแลเป็น**สองลูปของตัวเอง**ใน delivery-worker แยกจากลูปส่งอีเมล (`startLogRelay()` จาก `main()` ของ `workers/delivery.ts:203`): relay
ทุก 5 วินาที (รอบแรก 3 วินาทีหลังบูต) งานดูแลทุก 60 วินาที (รอบแรก 20 วินาที) แต่ละลูปนัดรอบถัดไปหลังรอบนี้จบ (ไม่ซ้อน) ไม่ throw ออกไป ทุกคำสั่ง
ของ Postgres มีเพดาน 15 วินาที (`withTimeout` — เลิกรอ ไม่ได้ยกเลิก) และของ Mongo มี `maxTimeMS` 4 วินาที (`MONGO_COMMAND_MAX_MS`) — Mongo ล่ม ช้า
หรือถูก pause อีเมลยังส่งตามปกติ · ปิด log store แล้วไม่เริ่มทั้งสองลูป

**หนึ่งรอบของ relay** (`relayTick()`, `workers/log-relay.ts:260`):

1. อ่าน `relay_state` ถ้ามี `rebuildRequestedAt` ทำ rebuild (ข้างล่าง) แทนการคัดลอก · ตรวจ `hashKeyFp` กับ `schemaVersion` (`checkIdentity()`) — ยังไม่มีก็บันทึก
   ค่าปัจจุบัน ไม่ตรงเตือนครั้งเดียวต่อ process และเก็บ error `log-relay:hash-key-changed` / warning `log-relay:schema-changed`
2. **forward pass** — จาก `relay_state.cursor {at, exact, id}` อ่านแถว `occurred_at ≤ now − 2 วินาที` เรียงตาม `(occurred_at, id)` ทีละ 500 ไม่เกิน 20 หน้าต่อรอบ
   ด้วย index `(occurred_at, id)` (migration `20260930013712_audit_event_relay_cursor_index`) เวลาเทียบกันด้วยข้อความถึง**ไมโครวินาที** (`exact`) ไม่ผ่าน Date
   ของ JavaScript — ไม่งั้นแถวที่ต่างกันแค่ไมโครวินาทีถูกอ่านซ้ำไม่จบ แถว `occurred_at` เดียวกันเป็นพัน (transaction เดียว seed) จึงไม่ทำให้ค้าง ·
   บันทึก cursor หลังทุกหน้า**เฉพาะเมื่อค่าที่เก็บยังเป็นตัวที่รอบนี้อ่าน** (`advanceCursor()` — compare-and-set) ไม่งั้นพิมพ์
   `[log-relay] cursor ใน relay_state เปลี่ยนไประหว่างรอบนี้ … ทิ้งรอบนี้` แล้วรอบถัดไปอ่านต่อจากค่าที่บันทึกไว้ — relay สองตัวซ้อนกันระหว่าง deploy หรือ
   rebuild ที่เกิดกลางรอบจึงไม่พา cursor ถอยหลัง
3. **tail pass** — อ่านซ้ำแถว `occurred_at > now − 120 วินาที` ไม่เกิน 10 หน้า เก็บแถวที่ commit หลังจาก cursor ผ่านเวลาของมันไปแล้ว (`occurred_at` มาจาก
   นาฬิกาของ process ที่เขียน ตอนสร้าง INSERT ไม่ใช่ตอน commit — 2.1) แถวที่ย้อนเวลาเกิน 120 วินาทีรอ reconcile
4. **เขียน** (`writeRows()`) — ถาม `_id` ที่มีใน Mongo แล้วก่อน (tail pass อ่านสองนาทีล่าสุดซ้ำทุกรอบ) แปลงเฉพาะที่ขาด (`projectAuditRow()` +
   `requestNumbers()`) แล้ว `bulkWrite` ของ `updateOne({_id}, {$setOnInsert: doc}, {upsert: true})` แบบ unordered — อ่านซ้ำกี่รอบก็ไม่เปลี่ยนอะไร
   `_id` ซ้ำ (11000) = อีกตัวเขียนไปแล้ว · เอกสารที่ Mongo ปฏิเสธด้วยรหัสที่ลองซ้ำก็ไม่ผ่านถูกข้ามพร้อมบรรทัดเตือนและ error `log-relay.rejected` (แถวยังอยู่
   ใน Postgres) · ความล้มอื่นทั้งหน้าลองใหม่รอบหน้า
5. จด `lastRunAt` `lastBatch` (เอกสารที่รอบนี้เขียนใหม่) `lastError: null` · forward pass ที่อ่านจนสุดจด `caughtUpAt` (เฉพาะเมื่อ cursor ยังเป็นของรอบนี้)

**เริ่มจากแถวแรก** เมื่อไม่มี cursor (volume ใหม่ หลัง rebuild) หรือ cursor เสีย — รูปผิด หรืออยู่ในอนาคตเกิน 5 นาที (เก็บเป็น error `log-relay.cursor`) —
ล้าง cursor และ `caughtUpAt` ก่อนอ่านหน้าแรก upsert ซ้ำได้ ราคาแค่การอ่านทั้งตาราง

**งานดูแล** (`maintenanceTick()`, `workers/log-relay.ts:795`):

- **prune** ตามอายุวันละครั้ง — 3.9
- **reconcile** ทุกชั่วโมง เฉพาะเมื่อมี cursor ไม่มี rebuild ค้าง และ forward pass ตามทันภายในนาทีที่ผ่านมา (`caughtUpAt`) — นับแถวของ 24 ชั่วโมงที่จบเมื่อ
  **สองนาทีก่อน** ปัดเป็นวินาทีเต็ม ช่วงครึ่งเปิด `[from, to)` ทั้งสองฝั่ง (แถวที่ใหม่กว่านั้นเป็นของ tail pass) ไม่เท่ากันแล้วอ่านช่วงนั้นซ้ำ (แถวที่มีแล้วถูกข้าม)
  เติมได้ = relay พลาดจริง (transaction ที่เปิดค้างเกินสองนาที): พิมพ์ `[log-relay] reconcile: สำเนาขาดไป N แถว …` และเก็บ warning `log-relay.reconcile` ·
  Mongo มากกว่าเป็นเรื่องปกติหลัง `seed:demo` ลบ Postgres — ยังอ่านซ้ำ เพราะแถวที่ขาดซ่อนอยู่หลังตัวนับที่เกินได้ · ผลอยู่ใน `relay_state.lastReconcile`
- ค่าเวลาใน `relay_state` ที่ไม่ใช่ Date หรืออยู่ในอนาคตเกิน 5 นาที (`lastPruneAt` `lastReconcileAt` `caughtUpAt`) ถือว่าไม่มี และเก็บเป็น error `log-relay.state.<ฟิลด์>`
  — ค่าปลอมในอนาคตเคยทำให้ prune หยุดเงียบ ๆ

**rebuild** — เมื่อเปลี่ยน `LOG_HASH_KEY` หรือ `SCHEMA_VERSION` (`$setOnInsert` ไม่แก้เอกสารเดิม relay จึงแก้เองไม่ได้) **คำสั่งเดียว** ด้วยผู้ใช้ root หรือ `bdi_worker`
(วิธีเปิด mongosh ใน 5.11):

```js
db.relay_state.updateOne({ _id: "audit_event" }, { $set: { rebuildRequestedAt: new Date() } })
```

ภายในราว 5 วินาที worker ลบเอกสาร `source:"audit_event"` ทีละก้อน (5,000 ไม่เกิน 40 ก้อนต่อรอบ — เหลือก็ลบต่อรอบถัดไป) แล้วใน `updateOne` เดียว `$unset`
`cursor` `hashKeyFp` `schemaVersion` `caughtUpAt` กับ `rebuildRequestedAt` และจด `lastRebuild` รอบถัดไปเติมใหม่ตั้งแต่แถวแรก ไม่ต้องเริ่ม worker ใหม่ ·
ระหว่างลบ relay ไม่คัดลอกและ reconcile ไม่วิ่ง · สั่งซ้ำระหว่างลบได้อีกรอบ ไม่ถูกล้างทิ้ง · บรรทัดที่พิมพ์: `[log-relay] rebuild: …` · บรรทัดเติมของค้าง
(`กำลังเติมของค้าง — ถึง <exact> แล้ว` ทุกรอบจน `เติมของค้างครบแล้ว — ตามทันถึง <exact>`) พิมพ์**เฉพาะเมื่อ forward pass รอบแรกอ่านครบ 20 หน้า** คือมีแถวค้าง
เกิน 10,000 แถว — store ที่เล็กกว่านั้น (production ราว 110 แถวต่อวัน) เติมจบในรอบเดียวโดยไม่พิมพ์ทั้งสองบรรทัด · **สัญญาณที่มีเสมอว่าเติมครบ** คือ
`relay_state.caughtUpAt` ที่ rebuild ล้างไปกลับมามีค่าใหม่กว่า `lastRebuild.completedAt` (`markCaughtUp()`) — S1 เห็นเป็น `relayLagSeconds` ที่เล็กและไม่เป็น null

- **อย่าลบเอกสาร `relay_state` ทั้งใบ** — ใบเดียวกันถือตัวเลขเพดานขนาดและ `lastPruneAt` (ลบแล้ว log-upkeep ตรวจเพดานใหม่ในนาทีถัดไป ธงเกินเพดานหายไประหว่างนั้น
  และ prune วิ่งทันที)
- **อย่าใช้สองคำสั่งแบบเดิม** (`deleteMany` แล้ว `$unset` cursor ด้วยมือ) — ระหว่างสองคำสั่ง cursor ยังอยู่ reconcile ที่ถึงกำหนดตรงช่วงนั้นนับ Mongo 0 เทียบ
  Postgres N เติมเอง แล้วเตือนว่า relay พลาด N แถว (ลองแล้ว 2026-10-01: ได้คำเตือน 43,498 แถว)
- rebuild **สร้างคืนไม่ได้**: แถวที่ `seed:demo` ลบจาก Postgres ไปแล้ว (หายจากสำเนาถาวร) · เอกสาร `audit_fallback` และ `http` (ไม่มีใน Postgres และ rebuild
  ไม่ลบ — ค้าง key ของกุญแจเก่า 3.6)
- เอกสารที่ prune ลบไปแล้ว (และ IP/UA ที่ตัดไปแล้ว) กลับมาจนกว่า prune รอบถัดไป ซึ่งคือรอบแรกหลัง 03:00 น. ครั้งถัดไป (ช้าสุดราว 24 ชั่วโมง) — ตัดสินแล้วว่าไม่แก้
  ต้องการให้ลบทันที รอจน `caughtUpAt` ใหม่กว่า `lastRebuild.completedAt` ก่อน (`db.relay_state.findOne({_id: "audit_event"}, {caughtUpAt: 1, lastRebuild: 1})`
  — บรรทัด `เติมของค้างครบแล้ว` ไม่มีเสมอ ข้างบน) แล้ว `$unset` `lastPruneAt` (prune วิ่งในรอบงานดูแลถัดไป)
- ช่องที่เหลือ: rebuild สองครั้งห่างกันไม่กี่วินาที ระหว่างหน้าแรกของรอบที่เริ่มจาก “ไม่มี cursor” ทำให้แถวไม่เกิน 500 แถวไม่ถูกเติม — สั่งซ้ำอีกครั้งถ้าเผลอสั่งสองครั้ง

**เอกสาร `relay_state` `_id:"audit_event"`** — worker เป็นผู้เขียนคนเดียว ทุกส่วนเขียนด้วย `$set` ของตัวเอง ไม่มี index รอง ไม่ถูก prune:

```json
{
  "_id": "audit_event",
  "cursor": { "at": { "$date": "2026-10-16T04:12:30.004Z" }, "exact": "2026-10-16T04:12:30.004213Z",
              "id": "ffe1d2c3-b4a5-4968-8776-655443322110" },
  "lastRunAt": { "$date": "2026-10-16T04:12:35.010Z" }, "lastBatch": 3, "lastError": null,
  "caughtUpAt": { "$date": "2026-10-16T04:12:35.004Z" },
  "lastReconcileAt": { "$date": "2026-10-16T04:00:00.233Z" },
  "lastReconcile": { "from": { "$date": "2026-10-15T03:58:00Z" }, "to": { "$date": "2026-10-16T03:58:00Z" },
                     "postgres": 112, "mongo": 112, "inserted": 0 },
  "lastPruneAt": { "$date": "2026-10-15T20:00:41.412Z" },
  "lastPrune": { "at": { "$date": "2026-10-15T20:00:41.412Z" }, "startedAt": { "$date": "2026-10-15T20:00:41.412Z" },
                 "complete": true, "activityDeleted": 0, "activityStripped": 0, "errorEventsDeleted": 31,
                 "runtimeEventsDeleted": 4, "issuesDeleted": 0 },
  "hashKeyFp": "3c9e1a7b20d4", "schemaVersion": 1,
  "storageMb": 41.7, "allocatedMb": 58.2, "sizeBasis": "in_use", "maxMb": 5120, "overQuota": false,
  "quotaCheckedAt": { "$date": "2026-10-16T04:00:05.118Z" }
}
```

| ฟิลด์ | ใครเขียน | ความหมาย |
|---|---|---|
| `cursor {at, exact, id}` | relay | ตำแหน่งใน `audit_event` — แถวถัดไปคือแถวแรกที่ `(occurred_at, id)` มากกว่านี้ · `exact` ISO ถึงไมโครวินาทีคือตัวที่ใช้เทียบ `at` มีไว้ให้คนอ่าน |
| `lastRunAt` `lastBatch` `lastError` | relay | รอบล่าสุด · เอกสารที่เขียนใหม่ · ชื่อ error ของรอบที่ล้ม (ไม่มีข้อความ) |
| `caughtUpAt` | relay | forward pass อ่านจนสุดครั้งล่าสุด — ความล่าช้าของสำเนา ≈ ตอนนี้ลบค่านี้ (`relayLagSeconds` ของ `/status`) · ล้างเมื่อเริ่มจากแถวแรก |
| `lastReconcileAt` `lastReconcile {from, to, postgres, mongo, inserted}` | งานดูแล | reconcile รอบล่าสุด |
| `lastPruneAt` `lastPrune {at, startedAt, complete, error?, activityDeleted, activityStripped, errorEventsDeleted, runtimeEventsDeleted, issuesDeleted}` | งานดูแล | prune ครั้งล่าสุด — ยอดของทั้งครั้งข้ามหลายรอบ (3.9) |
| `hashKeyFp` · `schemaVersion` | relay | กุญแจและรูปเอกสารที่สำเนานี้ใช้ — `none` = ไม่มีกุญแจ |
| `rebuildRequestedAt` · `lastRebuild {requestedAt, startedAt, completedAt, deleted}` | คน · relay | rebuild ที่สั่งไว้ · rebuild ล่าสุด |
| `storageMb` `allocatedMb` `sizeBasis` `maxMb` `overQuota` `quotaCheckedAt` | log-upkeep | เพดานขนาด (5.9) |

**บรรทัด `[log-relay]` ใน log ของ delivery-worker**: `คัดลอกไม่สำเร็จ (<ชื่อ error>) — ลองใหม่ทุก 5 วินาที` ครั้งเดียวตอนเริ่มล้ม และ `คัดลอก audit_event ลง log store
ได้อีกครั้ง — อ่านต่อจาก cursor ที่บันทึกไว้ (<exact>)` (หรือ `ไม่มี cursor ที่ใช้ได้ … เริ่มจากแถวแรก`) ครั้งเดียวตอนกลับมา · `กำลังเติมของค้าง …` ทุกรอบที่ forward pass
อ่านครบ 20 หน้าแล้วยังไม่ถึงปลาย และ `เติมของค้างครบแล้ว …` ครั้งเดียวหลังรอบแบบนั้น — ของค้างไม่เกิน 10,000 แถวไม่มีทั้งคู่ (ดู `caughtUpAt` แทน) · `prune ตามอายุ: …`
เมื่อ prune ทำอะไรได้ · error ของรอบที่ล้มเก็บไม่ถี่กว่าสิบนาทีต่อ tag

**เพดานขนาดไม่คุม `activity`** — relay ไม่อ่าน `overQuota` คัดลอกทุกแถวไม่ว่า log store จะใหญ่แค่ไหน (activity เล็ก ราว 40 MB ต่อปีที่อัตราของ production และ
เป็นบันทึกที่ค้นได้) ผลที่ต้องรู้: แถวของคำขอที่ไม่ต้องล็อกอินและไม่มี throttle (`LOGIN_FAILED` `OTP_NOT_PENDING` · `IDENTITY_VERIFICATION_FAILED` `state_not_found` ·
`PASSWORD_RESET_COMPLETED` `not_found` — docs/09 §4.1) คือแถวหนึ่งใน Postgres (ราว 440 ไบต์) **และ**เอกสารหนึ่งใบที่นี่ (ราว 970 ไบต์ บวก index 540–640 ไบต์)
— คำขอที่วนยิงกิน `/hdd1tb` เร็วขึ้นสามถึงสี่เท่าของตอนที่มีแค่ Postgres ตัวแก้คือ rate limit ของ `/api/auth/*` (แผน §13 ข้อ 30) ไม่ใช่ที่นี่

**PrismaClient ตัวเดียวกับลูปอีเมล** — แต่ละลูปถือ connection ครั้งละหนึ่งตัวตามปกติ แต่ Postgres ที่ช้าจนคำสั่งเกิน 15 วินาทีทำให้ relay ถือได้หลายตัว (คำสั่งที่
เลิกรอยังวิ่งต่อ) และลูปอีเมลรอ connection นานขึ้น

### 3.9 index และ retention

**index** — `workers/log-upkeep.ts:34` สร้างทีละตัวตอนต่อ Mongo ได้ครั้งแรก ซ้ำทุกชั่วโมง และทันทีที่เห็นว่า log store ถูกล้าง (`relay_state` ไม่ใช่อย่างที่มันเขียนไว้) ·
ตัวที่ล้มชั่วคราวลองใหม่รอบหน้า ตัวที่ถูกปฏิเสธเตือนครั้งเดียวแล้วข้าม · index ธรรมดาทั้งหมด ไม่มี partial/sparse/`$text`/TTL — ของ `activity` (บวก `_id`):

`{occurredAt:-1,_id:-1}` · `{"subject.type":1,"subject.id":1,occurredAt:-1}` · `{relatedUserIds:1,occurredAt:-1}` · `{"actor.id":1,occurredAt:-1}` ·
`{organizationId:1,occurredAt:-1}` · `{action:1,occurredAt:-1}` · `{category:1,result:1,occurredAt:-1}` · `{requestNumber:1,occurredAt:-1}` ·
`{"request.correlationId":1}` · `{hashKeys:1,occurredAt:-1}` · `{tokenFps:1,occurredAt:-1}` — สามตัวเป็น array (multikey) · รหัสอ้างอิง 8 ตัวค้นด้วย regex
แบบยึดหัวบน `request.correlationId` · ของ collection error อยู่ใน 5.2 5.3 5.5

**retention** — ตารางเดียวที่ BDI แก้ตัวเลขได้ `lib/log-retention.ts` **[ต้องตัดสิน]** ตัวเลขทั้งหมดเป็นค่าตั้งต้นรอ BDI ยืนยัน (แผน Q3):

| เอกสาร | กติกา |
|---|---|
| `activity` category `account` `role` `invitation` `organization` `request` `document` `review` `config` `log-access` | **ไม่ลบ** · `$unset` `request.ip` และ `request.userAgent` เมื่อครบ 365 วัน |
| `activity` category `auth` `session` `admin-access` `system` `other` | ลบทั้งเอกสารเมื่อครบ 400 วัน (ปีเต็มของประวัติการเดารหัสผ่าน และนานกว่า 90 วันของ พ.ร.บ.คอมพิวเตอร์ ม.26 ถ้าใช้บังคับ — 9.4) |
| `activity` `ADMIN_API_REQUEST` ที่ token ไม่ผ่านหรือไม่ได้ตรวจ (`source:"http"` · `via:"ANONYMOUS"`) | 90 วัน (`ANONYMOUS_ADMIN_ACCESS_DAYS`) — ใครก็สร้างได้ และไม่มีข้อมูลออกไป ประวัติการเดา token ปีเต็มยังอยู่ที่ `ADMIN_TOKEN_REJECTED` (Postgres และสำเนา 400 วัน) |
| `error_events` | 90 วัน · `service:"browser"` 30 วัน |
| `error_issues` | ที่ `resolved` / `ignored` ลบเมื่อ `lastSeen` ครบ 365 วัน · ที่ยัง `open` ไม่ลบ — ยกเว้นของเบราว์เซอร์ที่ยัง `open` ลบเมื่อไม่เกิดอีก 30 วัน (ใครก็สร้างได้) |
| `runtime_events` | 90 วัน |
| `relay_state` | ไม่ลบ |
| Postgres `audit_event` | **ไม่เปลี่ยน — ไม่มี retention** สำเนาที่ถูกลบตามอายุ relay ไม่คัดลอกกลับ (cursor ผ่านไปแล้ว) ยกเว้นตอน rebuild |

**prune** (`runPrune()` / `pruneLogStore()`, `workers/log-relay.ts:926` `:1010`) — ไม่ใช้ TTL index (ทำงานเหมือนกันทั้งบน mongo ในเครื่อง Atlas และ Cosmos) ในรอบงานดูแล
แรกหลัง 20:00 UTC (03:00 น. เวลาไทย) ของแต่ละวัน หรือรอบแรกที่ worker ขึ้นหลังจากนั้น · ทั้งการลบและการตัด IP/UA ทำทีละก้อน 5,000 `_id` ไม่เกิน 40 ก้อนต่อเงื่อนไขต่อรอบ
(คำสั่งเดียวที่แตะเป็นแสนเกินเพดานเวลาของ driver แล้ว server ยังทำต่อเบื้องหลัง) ค้างมากกว่านั้นหรือล้มกลางรอบ: ไม่เลื่อน `lastPruneAt` รอบถัดไปในหนึ่งนาทีทำต่อ
และ `lastPrune` เป็นยอดของทั้งครั้ง (ก้อนที่ถูกตัดกลางคำสั่งไม่ถูกนับ ยอดจึงต่ำกว่าจริงได้ไม่เกิน 5,000 ต่อครั้งที่ล้ม) · `request.ip`/`userAgent` ถูก `$unset`
ไม่ใช่ตั้งเป็น null เอกสารที่ตัดแล้วจึงไม่ถูกแตะซ้ำ

### 3.10 เมื่อ MongoDB ไม่พร้อม

| สถานการณ์ | ผล |
|---|---|
| Mongo ล่ม | คำขอของผู้ใช้และลูปอีเมลไม่กระทบ · error `runtime_events` สำเนา `audit_fallback` และบันทึกการเรียก admin API ค้างในคิว (≤ 500 รายการ / 2 MB ต่อ process) ถอยห่างเป็นเท่าตัวจนถึง 60 วินาที บรรทัด `[capture]` ยังพิมพ์ (5.8) · คิวล้นแล้วทิ้งตามชั้น หลังฟื้นมี event สรุป “ทิ้งไป N รายการ” (5.7) · `/health/ready` แสดง `logStore:{status:"down"}` ภายในรอบตรวจ 30 วินาที แต่ยังตอบ 200 · relay หยุดแล้วตามต่อจาก cursor โดยไม่หาย · API อ่าน log ตอบ 503 `log_store_unavailable` ภายในราว 2 วินาที ทั้ง Mongo ที่หยุดและที่ค้าง (`STORE_CHECK_MS`) ก่อนบันทึกการอ่าน — **ยกเว้น `GET /status`** ซึ่งไม่ผ่าน `store()`: ตอบ 200 เสมอ `logStore.status` มาจากรอบตรวจ 30 วินาที ตัวเลขของ relay และเพดานเป็น null (การอ่าน `relay_state` ที่ล้มถูกกลืน) และ Mongo ที่ค้างทำให้รอได้ถึง 5 วินาที (`socketTimeoutMS`) |
| Mongo ช้า หรือหยุดตอบชั่วครู่ | driver ตั้ง `serverSelectionTimeoutMS` 2000 · `connectTimeoutMS` 2000 · `socketTimeoutMS` 5000 · `maxPoolSize` 5 (backend) / 3 (worker) · คำสั่งของ API อ่าน log relay prune log-upkeep และ loop แจ้งเตือนมี `maxTimeMS` 4000 (`MONGO_COMMAND_MAX_MS` — ที่ไม่มี: `createIndex` `dbStats` ทั้งสามจุด และ `updateOne` ที่จดตัวเลขเพดานขนาดของ log-upkeep · การเขียนคิวของ error · `ping` ของ `store()` และ `insertOne` ของ `recordLogReadFallback()` ซึ่งมีเส้นตาย 2 วินาทีของตัวเองแทน — เลิกรอ ไม่ได้ยกเลิก) ให้ server ที่ยังตอบได้แต่ช้ายกเลิกเอง · **แต่ Mongo ที่หยุดตอบคร่อม heartbeat นานกว่าราว 2 วินาที ทำให้ monitor ของ driver ล้าง pool และตัดทุกคำสั่งที่ค้าง** (`PoolClearedOnNetworkError`) ไม่ว่า `maxTimeMS` จะเป็นเท่าไร — อ่านลองซ้ำหนึ่งครั้ง เขียนไม่ลองซ้ำ (mongod ตัวเดียว ไม่ใช่ replica set) งานที่มีหลายคำสั่ง (prune rebuild) จึงหยุดกลางทางได้และนับส่วนที่ทำไปแล้วไว้ · health อ่านสถานะที่จำไว้ probe ไม่รอ Mongo · ก้อน flush ไม่มี timeout ครอบ เกิน 15 วินาทีได้บรรทัดเตือนและก้อนใหม่ไม่เริ่มซ้อน (ตัวนับของ issue อาจนับซ้ำทั้งก้อน — 5.7) · งานดูแลของ log-upkeep เลิกรอหลัง 45 วินาที · tick ของ relay ที่ล้มลองใหม่รอบหน้า อีเมลยังเดิน · API อ่าน log: Mongo ที่ค้างหลัง ping ผ่านแล้วทำให้คำขอนั้นรอได้ถึง 5 วินาทีแล้วได้ 503 เดียวกัน |
| container `mongo` เริ่มไม่ขึ้น (รวมด่านปฏิเสธรหัสผ่านบน production — 3.12) | ไม่มีอะไรพึ่งมัน backend worker และ frontend เริ่มตามปกติ · backend บูตช้าลงไม่เกินราว 3 วินาที (รอผลตรวจแรก) · สถานะ `down` |
| โหลดแพ็กเกจ `mongodb` ไม่ได้ | โหลดด้วย `import()` เฉพาะเมื่อเปิดใช้ ความล้มเป็นสถานะ `down` กับบรรทัด `[log-store]` · ลูปอีเมลกับ backend ทำงานต่อ |
| เกินเพดานขนาด | 5.9 — error เดินแค่ตัวนับของ issue · `runtime_events` สำเนา `audit_fallback` และบันทึกการเรียกที่ token ผ่าน (ภายในส่วนยกเว้น) ยังเขียน · relay ยังเขียน `activity` · `/ready` แสดง `over_quota` |
| ไม่ตั้ง `LOG_HASH_KEY` | ทุก process เตือนตอนบูต · `hashKeys` ว่าง · `/status` แสดง `hashKey:"missing"` · การค้นด้วยเลขบัตรหรืออีเมลที่ไม่มีบัญชีตอบ 503 `hash_search_unavailable` (3.6) · เอกสารที่เขียนระหว่างนี้ค้นด้วยเลขบัตรไม่เจอไปตลอดจนกว่าจะ rebuild |
| Postgres ล่ม | `logAudit` ที่ล้มได้ error `audit.write-failed` + สำเนา `audit_fallback` (3.14) · error P1001 ของคำขอเก็บเป็น error `prisma:P1001:<METHOD route>` ตอบ 503 พร้อมรหัสอ้างอิง · `/health/ready` ตอบ 503 เพราะ database · relay ล้มทุกรอบ (`lastError`) แล้วตามต่อเมื่อกลับมา · API อ่าน log: บันทึกการอ่านลง Mongo แทน (ภายใน 2 + 2 วินาที) แล้วอ่านตามปกติ · ตัวระบุที่ต้องแปลงผ่าน Postgres (อีเมล · คำขอทั้งเลขที่และ uuid — uuid ถามสองตารางคำขอก่อนไปหา `REQUEST_DELETED` ใน Mongo · รหัสหน่วยงาน) ตอบ 503 `database_unavailable` — uuid ของหน่วยงานไม่ถาม Postgres · `trace` ตอบส่วนของ Mongo พร้อม `postgres:"unavailable"` |
| ทั้ง Mongo และ Postgres ล่ม | API อ่าน log ตอบ 503 `log_store_unavailable` ก่อนบันทึกอะไร (ไม่มีอะไรให้ส่ง จึงไม่มีการอ่าน) — `log_read_unrecorded` เกิดเฉพาะเมื่อ Postgres ไม่รับ**และ** Mongo ล้มหลังจาก ping ผ่านแล้ว |
| `LOG_STORE_ENABLED=false` | ไม่โหลด driver เลย · `/ready` แสดง `disabled` · `captureError` ยังพิมพ์บรรทัด `[capture] … event=- (log store ปิดอยู่)` · ไม่มีคิว ไม่มี `runtime_events` ไม่มี `audit_fallback` ไม่มีบันทึกการเรียก admin API — แถวที่ Postgres ไม่รับเหลือแค่บรรทัดนั้น ซึ่ง**ไม่มี action subject หรือผู้กระทำของแถว** (2.8) · worker ไม่เริ่ม relay งานดูแล log-upkeep และ loop แจ้งเตือน · API อ่าน log ตอบ 503 `log_store_disabled` ยกเว้น `GET /status` ที่ตอบ 200 พร้อม `logStore.status: "disabled"` · `POST /api/client-errors` ยังตอบ 204 แต่ไม่เก็บอะไร |
| worker ล่ม | ไม่มีใครสร้าง index ตรวจเพดาน คัดลอก prune หรือแจ้งเตือน · ธง `overQuota` ค้างค่าเดิม · สำเนาล่าช้า (`relayLagSeconds` โต) · อีเมลในคิวหยุด · คำขอไม่กระทบ · `/status` แสดง `alerts.checkedAt` เก่ากว่าสามนาที |
| ปิด process (deploy) | backend `shutdown()` (`index.ts:444-458`): `server.close()` → บันทึก `shutdown` (+ ป้าย “ปิดตามปกติ” ในไฟล์ของ container — 5.5) → แถวสรุปของ token ≤ 2 วินาที → เข้าคิวใบสรุปของการเรียก admin API → คิว ≤ 2 วินาที → ปิด Mongo ≤ 1.5 วินาที → `prisma.$disconnect()` → exit · worker `stop()`: หยุดลูปอีเมล log-upkeep และ loop แจ้งเตือน → รอรอบของ relay ≤ 1.5 วินาที → บันทึก `shutdown` → คิว → ปิด → disconnect — ทั้งคู่อยู่ใน 10 วินาทีของ compose · handler ทำงานเฉพาะเมื่อ SIGTERM ถึง node (5.10) |

### 3.11 API อ่าน log — `/api/admin/logs/*` (`routes/admin-logs.ts`)

ไม่มีหน้าจอ อ่านผ่าน Postman collection แยก `docs/bdi-activity-log.postman_collection.json` ซึ่ง**ไม่แจกพร้อม admin token** · router ติดตั้ง**ก่อน** router ของ admin
(`index.ts:189`) และจบด้วย 404 ของตัวเอง path ที่พิมพ์ผิดใต้ `/api/admin/logs` จึงไม่ตกไปเขียน `ADMIN_TOKEN_REJECTED` · proxy ของหน้าเว็บตอบ 404 ให้ทุก
`/api/admin/logs*` (ไม่สนตัวพิมพ์ ทั้งรูปดิบและรูปที่ถอด `%xx` แล้ว) — **เรียกได้ทาง backend ตรงเท่านั้น** บน production คือ `https://bdi-api.thammasorn.org`
(ผ่าน Cloudflare) หรือ `localhost:4000` บนเครื่อง · การจำกัดทางเครือข่าย (Cloudflare Access, bind 127.0.0.1) เป็นงานของ infra (แผน Q17)

**ด่าน** (`requireLogReader`, `middleware/auth.ts:254`) — ทุกคำขอ ตามลำดับ:

1. ไม่ได้ตั้ง `LOG_READ_TOKEN` (หรือ production ตั้งเป็นค่าตัวอย่าง `dev-…`/`…change-me` หรือสั้นกว่า 32 ตัว — `env.ts`) → 503 `log_access_disabled` ไม่เคยเปิดให้อ่าน
   โดยไม่มี token
2. `x-log-token` ผิดหรือไม่ได้ส่ง → 401 `unauthenticated` และ `LOG_TOKEN_REJECTED` แบบ throttle (4.11) เทียบด้วย `secretMatches` ใช้เวลาเท่ากันเสมอ
3. ชื่อ query ที่มีคำว่า `reason` → 400: เหตุผลรับทาง header เท่านั้น (URL ไปจบใน log ของ proxy และ edge ทุกชั้น)
4. `x-log-reader` = อีเมล ASCII ไม่เกิน 100 ตัว — **ประกาศเอง ไม่ได้พิสูจน์** ผู้ถือ token ใส่ชื่อใครก็ได้ ตัวที่ผูกกับ token จริงคือ `token_fp`
5. `x-log-reason` ถ้าส่งมา = UTF-8 ที่ผ่าน `encodeURIComponent` ยาว 10–500 ตัว ไม่มีอักขระควบคุม (ภาษาไทยดิบใน header มาถึงเป็น latin1 จึงปฏิเสธ) ·
   `activity` `timeline` `trace` **บังคับ** (`requireReadReason`) endpoint ของ error ไม่บังคับ แต่ส่งมาก็ถูกบันทึก
6. ตัวระบุบุคคลใน URL (`?person=` `?cid=` `?email=` ไม่สนตัวพิมพ์) → 400 พร้อมชื่อ header ที่ใช้แทนและ endpoint ที่รับ (`refuseSubjectsInQuery`)

ผ่านแล้วประทับคำขอเป็น `log-api` (`source_component` ของ `AUDIT_LOG_READ` และ `ERROR_ISSUE_STATUS_CHANGED`) ด่านนี้ไม่รอ Postgres หรือ Mongo

**ตัวระบุบุคคลมาทาง header เท่านั้น** — `x-log-person` (uuid ของบัญชี หรืออีเมล) · `x-log-cid` (เลข 13 หลัก ขีดหรือช่องว่างคั่นได้ ไม่ตรวจ checksum) · `x-log-email`
ค่า ASCII ส่งตรง ๆ ได้ ค่าอื่น `encodeURIComponent` · **`/activity` รับทั้งสาม `/timeline` รับแค่ `x-log-person` endpoint อื่นตอบ 400** เมื่อมี header เหล่านี้ —
ตัวกรองที่ถูกเพิกเฉยเงียบ ๆ ให้ผลที่ไม่ได้กรองแต่ดูเหมือนกรองแล้ว

**แปลงที่เซิร์ฟเวอร์**: `person` ที่เป็นอีเมลของบัญชี → id ของบัญชี **และ** `email#` ของอีเมลนั้น · uuid ของบัญชีที่มีอยู่ → id **และ** `email#` ของบัญชี (คนเดียวกันได้
ผลเดียวกันไม่ว่าพิมพ์อะไรมา) · อีเมลที่ไม่มีบัญชี → `email#` อย่างเดียว · `cid` → `cid#` (จับด้วย HMAC อย่างเดียว ไม่ค้นผ่านบัญชี) · `email` → `email#` ·
`request` = uuid หรือเลขที่คำขอ (คำขอที่ถูกลบแล้วหาจากเอกสาร `REQUEST_DELETED` ใน Mongo ทั้งสองทาง) · `organization` = uuid หรือ `organization_code`
(รหัสที่ไม่มีในทะเบียน = 404) · การแปลงที่ต้องใช้ Postgres มีเพดาน 2 วินาที (0.3 วินาทีเมื่อเพิ่งติดต่อไม่ได้ — `withDatabaseDeadline()` ใน `db.ts`) ไม่ทันได้
503 `database_unavailable` ยกเว้นการหาบัญชีของ uuid เลขบัตร และอีเมลที่ใช้แค่เพื่อบันทึก ซึ่งค้นต่อได้และจด `accountLookup:"unavailable"`

**เลขที่คำขอถูกใช้ซ้ำได้** หลังคำขอที่เลขสูงสุดถูกลบ (`lib/request-number.ts`) สาขาเลขที่ของตัวกรองคำขอจึงจำกัดอยู่ในช่วงชีวิตของคำขอนั้น — ตั้งแต่วันที่สร้างถึงแถว
`REQUEST_DELETED` ของมัน (ไม่มีปลายถ้ายังอยู่ · แถวลบรุ่นเก่าที่ไม่มี `before.createdAt` เริ่มที่การลบครั้งก่อนของเลขเดียวกัน) ส่วนสาขา subject ไม่จำกัด: id ไม่ถูกใช้ซ้ำ

**ลำดับในทุก route ยกเว้น `/status`** (ไม่ผ่าน `store()` และไม่บันทึก — ข้างล่าง): ตรวจพารามิเตอร์ → log store ตอบได้ไหม (`store()` — ping ≤ 2 วินาที) → แปลงตัวระบุ → **บันทึกการอ่าน** (`recordLogRead()`) → อ่าน
คำขอที่ผิดรูปหรืออ่านไม่ได้อยู่แล้วจึงไม่เกิดบันทึกเปล่า ๆ · บันทึก: INSERT `AUDIT_LOG_READ` ลง Postgres ภายใน 2 วินาที (0.3 เมื่อเพิ่งติดต่อไม่ได้) ไม่ได้ (ล้ม หมดเวลา
หรือถูกปฏิเสธ) → เก็บ error `audit.log-read-failed` แล้วเขียนสำเนา `audit_fallback` ลง Mongo ตรงและรอไม่เกิน 2 วินาที (`fallback.errorEventId` ชี้ event นั้น) ไม่ได้อีก
→ 503 `log_read_unrecorded` โดยไม่ส่งข้อมูล · กรณีเลวร้ายราว 4 วินาทีก่อนได้ 503 · INSERT ที่เลิกรอแล้วยัง commit ทีหลังได้ การอ่านครั้งนั้นจึงอาจมี**สองบันทึก**
(แถวกับสำเนา — คนละ `_id` โดยตั้งใจ) · กลับกัน `insertOne` ของสำเนาที่เลิกรอที่ 2 วินาทีก็ไม่ถูกยกเลิก คำขอที่ได้ 503 `log_read_unrecorded` (ไม่มีข้อมูลออกไป)
จึงอาจมีสำเนา `AUDIT_LOG_READ` ที่เขียนเสร็จทีหลัง — บันทึกของการอ่านที่ไม่ได้เกิด ซึ่งผู้เรียกถูกบอกว่าไม่ได้บันทึก · ทุกคำตอบที่บันทึกแล้วมี `readId` (= id ของแถว หรือ `_id` ของสำเนา) · `GET /status` **ไม่ถูกบันทึก** (ไม่มีข้อมูลบุคคล)

**ข้อตกลงร่วม**: zod แบบ strict — พารามิเตอร์ที่ไม่รู้จักหรือผิด = 400 `{error:"validation", message, fields:{<ชื่อ>: <ข้อความ>}}` (ข้อผิดของตัวระบุชี้ชื่อ header) ·
`page` เริ่ม 1 · `pageSize` 50 สูงสุด 200 · เรียง `occurredAt desc, _id desc` · `total` จาก `countDocuments` ตัดที่ 10,000 พร้อม `totalIsLowerBound` และเปิดหน้าที่เริ่มเลย
10,000 ไม่ได้ (ให้แคบตัวกรองลง) · `from` `to` เป็น ISO 8601 ที่มี offset · ช่วงที่มีทั้งสองปลายยาวไม่เกิน 366 วัน · ทุกคำสั่งอ่านมี `maxTimeMS` 4000 · ทุกเอกสาร
ได้ `id` แทน `_id` และ `occurredAtBangkok` (เวลาไทยพร้อม `+07:00`)

| endpoint | พารามิเตอร์ | คืน |
|---|---|---|
| `GET /activity` | query: `action` (CSV ≤ 20) `category` `result` `via` `actorId` `subjectType` `subjectId` (`subjectId` ต้องมี `subjectType` คู่ — `subjectType` เดี่ยว ๆ กรองได้แต่ไม่นับเป็นตัวกรองที่แคบลง) `request` `organization` `tokenFp` `correlationId` (เต็ม หรือฐานสิบหก 8 ตัวขึ้นไป ขีดหรือไม่ก็ได้) `source` `from` `to` `before` `page` `pageSize` · header: `x-log-person` `x-log-cid` `x-log-email` | `{events, total, totalIsLowerBound, page, pageSize, window:{from,to}, nextBefore, readId}` — ทุกตัวกรอง AND กัน · ไม่ระบุช่วงและไม่มีตัวกรองที่แคบลง (คน คำขอ หน่วยงาน actor subject cid email tokenFp correlationId) = 30 วันล่าสุด มีตัวกรองที่แคบลง = ทั้งประวัติ · ระบุ `from` อย่างเดียว = ถึงตอนนี้ · ระบุ `to` อย่างเดียว = ย้อน 30 วันจาก `to` (มีตัวกรองที่แคบลง = ไม่มีขอบล่าง) |
| `GET /activity/:id` | — | `{event, readId}` · 404 `not_found` |
| `GET /timeline` | `x-log-person` **หรือ** query `request` **หรือ** `organization` อย่างใดอย่างหนึ่ง · `from` `to` (ตั้งต้น: คำขอ = ทั้งชีวิต · คน/หน่วยงาน = 7 วัน · `to` อย่างเดียว: คน/หน่วยงานย้อน 7 วันจาก `to` คำขอไม่มีขอบล่าง) | `{items:[{type:"activity", …} \| {type:"error", …}], truncated, readId}` เรียงเก่าไปใหม่ ≤ 500 — error ที่เข้า: correlation id เดียวกับกิจกรรมที่พบ และเมื่อมีขอบล่างของช่วง: error ของผู้ใช้คนนั้น (`actor.id`) · ของคนในหน่วยงานนั้น · ที่ path มี uuid ของคำขอ · error ย่อ (ตัวเต็มที่ `/errors/events/:id`) · ถูกตัดแล้วตัดรายการหลังรายการสุดท้ายของแหล่งที่ถูกตัดทิ้ง |
| `GET /trace/:ref` | uuid หรือฐานสิบหก 8–32 ตัว | `{correlationId, reference, actors:[{id, via, count}], mixedActors, activity[≤200], activityTruncated, errors[≤50], errorsTruncated, reports, serverErrors, deliveries, integrations, postgres, readId}` — `deliveries`/`integrations` อ่านจาก Postgres ด้วย id ตรงตัว (ไม่มีที่อยู่ปลายทาง ข้อความ error กวาดแล้ว) `postgres: "ok" \| "unavailable" \| "not_applicable"` · prefix ที่ตรงหลาย id = `{ambiguous:true, candidates[≤10], candidatesTruncated, reports, serverErrors, readId}` · `reports` = รายงานจากเบราว์เซอร์ที่**อ้าง**รหัสนี้ (`browser.reference` — ผู้ส่งเขียนเอง อ่านเป็นคำบอกเล่า) ใหม่ไปเก่า ≤ 50 ไม่มีธงบอกว่าถูกตัด มีแต่ `reports` ได้ 200 ที่ `correlationId: null` · `serverErrors` = error ของ Next server ที่ `extra.digest` ตรงกับ `digest` ของรายงานภายใน ±1 ชั่วโมง ≤ 20 (digest เป็น hash ของข้อความ ไม่ใช่ id ของคำขอ — ตรงกับของคนอื่นได้) · `mixedActors:true` = แถวของ id นี้มาจากหลายผู้กระทำหรือหลายช่องทาง (2.5) · prefix ที่ไม่ตรงอะไรเลยและไม่มีรายงาน = 404 (id เต็มที่ไม่เจอได้ 200 ที่รายการว่าง) |
| `GET /errors/issues` | `status` (`open` ตั้งต้น · `resolved` `ignored` `all`) `service` `level` `release` (ตรง `firstRelease` หรือ `lastRelease`) `since` (`lastSeen ≥`) `sort` (`lastSeen` `count` `firstSeen` ใหม่ไปเก่า) `page` `pageSize` | `{issues, total, totalIsLowerBound, page, pageSize, readId}` — issue มี `fingerprint` แทน `_id` และ `lastSeenBangkok` |
| `GET /errors/issues/:fingerprint` | `events` (20 ตั้งต้น 0–100) · fingerprint ที่มี `/` หรือช่องว่างต้อง percent-encode ใน path | `{issue, recentEvents, readId}` · 404 |
| `GET /errors/events/:id` | — | `{event, readId}` · 404 (อาจถูกลบตามอายุแล้ว) |
| `PATCH /errors/issues/:fingerprint` | body `{status: open\|resolved\|ignored, reason}` — `reason` 10–500 ตัว ไม่มีตัวยึดตำแหน่ง `<…>` หรือ `{{…}}` | `{issue}` — ตั้ง `status` `statusChangedAt` `statusReason` พร้อมกันเสมอ (ไม่งั้นการเปิดกลับเมื่อเกิดซ้ำผิด — 5.4) · `statusReason` ใน Mongo และในคำตอบผ่านกฎเลขบัตร (`maskCidText`) · ตั้งสถานะเดิมซ้ำก็เขียน · แถว `ERROR_ISSUE_STATUS_CHANGED` (4.12) เขียน**หลัง**เปลี่ยน ภายใน 2 วินาที ไม่ทันไปทางสำรอง `audit_fallback` (การเปลี่ยนเดียวอาจมีสองบันทึก) · **ไม่มี `readId`** — นี่คือการแก้ ไม่ใช่การอ่าน |
| `GET /status` | — | `{logStore, adminAccess, alerts, release}` — ข้างล่าง · ไม่บันทึก |

**`before` ไม่ใช่ `page` สำหรับหน้าถัดไปของ `/activity`** — log โตตลอด และทุกการอ่านเองก็เพิ่มแถว `AUDIT_LOG_READ` ที่ relay คัดลอกขึ้นมาบนสุดในราว 2–7 วินาที
ช่วงที่ไม่ระบุ `to` คิด `to` ใหม่ทุกคำขอ `page=2` ที่เปิดช้ากว่านั้นจึงเห็นท้ายหน้า 1 ซ้ำ ส่ง `before=<nextBefore>` (`<occurredAt ISO>,<_id>` ของแถวสุดท้ายที่เห็น) แทน
— ไม่ซ้ำและไม่ข้ามแถวที่มีอยู่แล้ว ใช้คู่กับ `page` ไม่ได้ (400) · ส่ง `to` เท่ากับ `window.to` ของหน้าแรกก็**ยังไม่ทำให้ `page` นิ่ง**: สำเนาตามหลังแถวไม่กี่วินาที
แถวที่เกิดก่อน `to` แต่ยังไม่ถูกคัดลอกเข้ามาในช่วงทีหลัง (ลองแล้ว หน้า 2–3 ซ้ำ 1–2 แถว) `page` นิ่งเฉพาะช่วงที่ `to` ผ่านไปเกินสองนาที

**ผลข้างเคียงที่ตั้งใจ**: การอ่านประวัติของ X เป็นแถวหนึ่งในผลของการค้นด้วย `x-log-person` / `x-log-cid` ของ X ครั้งถัดไป — การเปิดประวัติของเขาเป็นสิ่งที่เกิดกับข้อมูล
ของเขา (4.12) · “ใครเคยค้นประวัติของ X” = `action=AUDIT_LOG_READ` คู่กับตัวระบุของ X (G7) — ครบเฉพาะการอ่านที่ระบุตัว X ทาง header การอ่านด้วย
`actorId`/`subjectId` เจอแค่ทาง `x-log-person` และการอ่านผ่าน trace timeline ของคำขอหรือหน่วยงาน หรือเปิดเอกสารเดียวด้วย id ไม่ผูกกับ X เลย (4.12)

**`GET /status`** — ตัวเลขของ backend process ที่ตอบเท่านั้น (คิวของ worker และของ replica อื่นแยกกัน):

| ส่วน | ฟิลด์ |
|---|---|
| `logStore` | `status` (`up` `down` `disabled` `over_quota`) · `buffered` `bufferedBytes` `pendingIssues` `writing` (`ok`/`failing`) · `dropped` (ตั้งแต่ process เริ่ม) · `browserReportsNotCreatingIssues` · `browserReferencesLost` · `browserOverBudget` · `untrustedBudget` (5.13) · `adminTokenOverQuotaAllowance` (5.13) · `hashKey` (`set`/`missing`) · `relayLagSeconds` (ตอนนี้ลบ `caughtUpAt` — null ถ้า relay ยังไม่เคยตามทัน) `relayLastRunAt` `relayLastError` · `storageMb` `allocatedMb` `maxMb` `overQuota` `quotaCheckedAt` (จาก `relay_state`) |
| `adminAccess` | `recorded` `overCap` `queueFull` `evicted` `overBudget` `summaries` `pendingInSummary` `notStored` (4.11) |
| `alerts` | `enabled` `recipients` `checkedAt` `enabledAt` `lastDigestAt` `lastError` จากที่ worker เขียนไว้ (5.14) · null ทั้งก้อน = worker ยังไม่เคยเขียน · `enabled: true` ที่ `checkedAt` เก่ากว่าสามนาที = loop ไม่ได้วิ่ง |
| `release` | `RELEASE` ของ backend |

**รหัส error ของ API นี้**: 400 `validation` · 401 `unauthenticated` (+ `LOG_TOKEN_REJECTED`) · 404 `not_found` (path ที่ไม่มี · เอกสารหรือ issue ที่ไม่พบ · รหัสหน่วยงานที่ไม่มี
· รหัสอ้างอิงที่ไม่พบ) · 503 `log_access_disabled` (ไม่มี token) · 503 `log_store_disabled` (ปิด log store) · 503 `log_store_unavailable` (Mongo ไม่ตอบ หรือล้มกลางคำสั่ง
— เก็บเป็น warning `http:5xx:…:log_store_unavailable` หรือ `log-api:store:<ชื่อ error>`) · 503 `database_unavailable` (แปลงตัวระบุผ่าน Postgres ไม่ได้ — `log-api:database:*`)
· 503 `hash_search_unavailable` (ไม่มี `LOG_HASH_KEY`) · 503 `log_read_unrecorded` (บันทึกการอ่านไม่ได้ทั้งสองที่)

**Postman** — G1 ค้นหากิจกรรม · G2 ทุกอย่างของบุคคลนี้ (`x-log-person` อีเมล) · G3 เส้นเวลาของคำขอ (เลขที่คำขอ) · G4 ล็อกอินที่ล้มเหลวของอีเมลนี้ (`x-log-email`) ·
G5 งานผ่าน admin token สัปดาห์นี้ · G6 ไล่ตามรหัสอ้างอิง · G7 ใครเปิดอ่าน log · G8 การใช้ token ที่ถูกหมุนแล้ว (`tokenFp=<fp เก่า>` — ทั้ง `ADMIN_TOKEN_REJECTED`
และ `ADMIN_API_REQUEST`) · E1 ปัญหาที่เปิดอยู่ · E2 รายละเอียดปัญหา · E3 เหตุการณ์เดียว · E4 ปิด/ละเว้นปัญหา · S1 สถานะ — environment มีแค่ `baseUrl` `adminToken`
`logToken` `logReader` เหตุผลอยู่ในตัวแปร `readReason` ของ collection (ส่งเป็น header แบบ percent-encode) **E4 ไม่เคยใช้ค่าที่จับมาอัตโนมัติ** — ผู้อ่านพิมพ์ fingerprint
สถานะ และเหตุผลเอง (`CLAUDE.md` Traps)

### 3.12 service `mongo` — การติดตั้ง รหัสผ่าน และด่านปฏิเสธ

| เรื่อง | ค่า (`docker-compose.yml` · `docker-compose.prod.yml` · `mongo/`) |
|---|---|
| image | `mongo:7.0` — image ร่วมของทุก checkout `down -v --rmi local` ไม่ลบมัน (บนเครื่องนี้ image อยู่ใน containerd store บน `/` ขนาด 1.18 GB) |
| พอร์ต | `expose: 27017` เท่านั้น **ไม่ผูกพอร์ตออกโฮสต์** — เข้าได้จาก network ของ stack หรือ `docker compose exec mongo` (5.11) |
| ข้อมูล | volume `mongo-data` → `/data/db` · บน `main/` คือ `bdi-main_mongo-data` = log ของ production **ห้าม `down -v` ที่ `main/`** · volume เปล่าราว 300 MB (journal ของ WiredTiger จองล่วงหน้า) |
| cache ของ WiredTiger | 0.25 GB (dev) · 0.5 GB (prod overlay) — ตั้งเองเสมอ ค่าตั้งต้นของ MongoDB คือค่าที่มากกว่าระหว่าง 50% ของ (RAM − 1 GB) กับ 256 MB **ต่อหนึ่ง instance** (คอมเมนต์ใน compose เขียนว่า “ครึ่งหนึ่งของ RAM” ซึ่งหยาบไป) และเครื่องนี้รันหลาย stack · ขณะว่างใช้ RAM ราว 80 MiB |
| restart | `unless-stopped` · **ไม่มี service ไหน `depends_on: mongo`** |
| healthcheck | `mongosh --eval ping` แบบไม่ login ทุก 60 วินาที (`start_interval` 5 วินาที) — บอกแค่ว่า mongod รับคำสั่ง สุขภาพที่แอปเห็นดูที่ `logStore` (3.13) |
| log ของ container | json-file 10 MB × 3 (prod overlay ตั้ง backend frontend worker เป็น 50 MB × 5) |
| entrypoint | `sh /opt/bdi-mongo/entrypoint.sh` (ด่านปฏิเสธ ข้างล่าง) แล้ว `exec docker-entrypoint.sh` ของ image · **ทั้งสองสคริปต์ bind-mount จาก working tree ของ checkout** (`./mongo:/opt/bdi-mongo:ro` · `./mongo/init:/docker-entrypoint-initdb.d:ro`) ไม่ได้ฝังใน image — บน `main/` ไฟล์ใต้ `mongo/` ที่แก้ค้างไว้ยังไม่ commit มีผลตั้งแต่ container เริ่มครั้งถัดไป (กับดักเดียวกับ working tree ของ `main/` ที่ติดไปกับ deploy) |
| init | `mongo/init/01-users.js` — image รันด้วย mongosh ในฐานะ root **ครั้งเดียว ตอน volume ว่าง**: สร้าง (หรืออัปเดต) role สองตัวกับ user `bdi_backend` `bdi_worker` ในฐาน `bdi_logs` (3.1) |
| root | `MONGO_ROOT_USER` (ค่าตั้งต้น `bdi`) / `MONGO_ROOT_PASSWORD` → `MONGO_INITDB_ROOT_*` ในฐาน `admin` · ไม่มี process ไหนของแอปใช้ |
| URI ของแอป | compose ประกอบให้: backend `mongodb://bdi_backend:${MONGO_BACKEND_PASSWORD}@mongo:27017/bdi_logs?authSource=bdi_logs` · worker ใช้ `bdi_worker` กับ `MONGO_WORKER_PASSWORD` — ทับทั้งเส้นด้วย `MONGODB_BACKEND_URI` / `MONGODB_WORKER_URI` (managed Mongo) · **รหัสผ่านถูกแทนลง URI โดยไม่ encode** · ชุดตัวแปรของ worker เป็นสำเนาที่เขียนเองใน compose ต้องแก้คู่กับ backend |

**รหัสผ่าน** — ค่าตั้งต้นใน compose และ `.env.example` เป็นค่าตัวอย่างสาธารณะ (`dev-mongo-*-change-me`) · ทั้งสามตัวใช้**ครั้งเดียวตอน volume ว่าง** เปลี่ยน `.env`
ทีหลังไม่มีผลกับผู้ใช้เดิม · รหัสผ่านของ root เปลี่ยนด้วย `db.changeUserPassword` เท่านั้น · production ต้องใช้ค่าจาก
`openssl rand -hex 32` (ฐานสิบหกเพราะถูกแทนลง URI ตรง ๆ)

**เปลี่ยนรหัสผ่านหรือสิทธิ์ของ `bdi_backend` `bdi_worker`** ด้วยการรัน `01-users.js` ซ้ำ (สคริปต์รันซ้ำได้ — `updateRole` / `updateUser` ตามค่าปัจจุบัน
คำสั่งอยู่หัวไฟล์) — สคริปต์อ่านรหัสผ่านจาก **env ของ container `mongo`** ซึ่ง compose ใส่ไว้ตอนสร้าง container ไม่ได้อ่าน `.env` เอง จึงต้องทำตามลำดับ:

1. แก้ `.env` — อย่าเปลี่ยน `MONGO_ROOT_PASSWORD` ในรอบเดียวกัน (root ใน volume ยังใช้รหัสเดิม แต่คำสั่งในข้อ 3 login ด้วยค่าใน env)
2. สร้าง `mongo` ใหม่ให้รับค่าใหม่: `docker compose up -d --no-deps mongo` (บน `main/` ใส่ `-f docker-compose.yml -f docker-compose.prod.yml`) — volume
   ไม่ว่าง init จึงไม่รันเอง
3. รัน `01-users.js` ด้วยคำสั่งที่หัวไฟล์ ได้บรรทัด `[mongo] อัปเดต user bdi_logs.bdi_…`
4. สร้าง `backend` กับ `delivery-worker` ใหม่ (`up -d --no-deps backend delivery-worker` — บน `main/` ใส่ไฟล์ compose ทั้งสองและ dump log ของ backend
   ก่อน) เพราะ URI ของมันถูกประกอบตอนสร้าง container ระหว่างข้อ 3 กับ 4 สอง process นี้ login ไม่ผ่าน (`logStore` เป็น `down` ชั่วครู่)

ข้ามข้อ 2 แล้วสคริปต์ใส่รหัสผ่าน**เดิม**กลับเข้าไป พิมพ์ `อัปเดต user …` เหมือนสำเร็จ แต่ไม่ได้แก้อะไร

**ด่านปฏิเสธรหัสผ่านตัวอย่างบน production** — prod overlay ตั้ง `MONGO_REFUSE_DEV_PASSWORDS=true` แล้ว `mongo/entrypoint.sh` ตรวจ**ทุกครั้งที่ container เริ่ม**
ก่อน mongod แตะ volume:

- ปฏิเสธถ้า `MONGO_INITDB_ROOT_PASSWORD` `MONGO_BACKEND_PASSWORD` `MONGO_WORKER_PASSWORD` ตัวใดว่าง ขึ้นต้นด้วย `dev-` หรือมี `change-me` · และถ้ารหัสผ่านของ
  backend/worker มีอักขระนอก `[A-Za-z0-9._~-]` (ใส่ใน URI แบบไม่ encode ไม่ได้ — root ไม่ถูกตรวจข้อนี้เพราะไม่ลง URI)
- ปฏิเสธ = พิมพ์ `[mongo] ไม่เริ่ม MongoDB: รหัสผ่านต่อไปนี้ว่าง ยังเป็นค่าตัวอย่าง (dev-…/…change-me) หรือมีอักขระที่ใส่ใน URI ไม่ได้: <ชื่อตัวแปร>` (ชื่อเท่านั้น
  ไม่พิมพ์ค่า) กับวิธีแก้ แล้ว `exit 1` — container วนรีสตาร์ตภายใต้การหน่วงของ Docker เว็บขึ้นตามปกติ `logStore` เป็น `down` · ชื่อที่ข้อความพิมพ์เป็นชื่อ**ใน
  container**: `MONGO_INITDB_ROOT_PASSWORD` คือ `MONGO_ROOT_PASSWORD` ใน `.env` (compose แปลงชื่อให้) ส่วน `MONGO_BACKEND_PASSWORD` `MONGO_WORKER_PASSWORD`
  ชื่อตรงกันทั้งสองที่ — อย่าค้น `.env` หาชื่อ `MONGO_INITDB_…`
- `01-users.js` (`checkPasswords()`) ตรวจกติกาเดียวกันซ้ำตอน init แล้ว throw — กันคนที่รัน mongod โดยไม่ผ่าน entrypoint ของเรา · ด่านหน้าต้องมีเพราะสคริปต์ init
  ที่ล้มอย่างเดียวทิ้ง volume ครึ่ง ๆ กลาง ๆ: image สร้าง root ด้วยรหัสตัวอย่างไปแล้ว รีสตาร์ตรอบหน้าข้าม init เปิด mongod โดยไม่มีผู้ใช้ของแอป (ลองกับ `mongo:7.0` แล้ว)
- แก้: ตั้งรหัสผ่านทั้งสามใน `.env` แล้ว `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --no-deps mongo`
- dev ไม่มีด่านนี้ · และด่านนี้หยุดแค่ container `mongo` — compose ยังแทนรหัสผ่านดิบลง URI ของ backend/worker ทุกที่ รหัสผ่านที่มี `@` `/` หรือช่องว่างจึงไปถึง
  การแยก URI ของ driver ได้ (3.13 อธิบายว่าบรรทัด log ไม่พารหัสผ่านออกมาอย่างไร)
- backend และ worker บน production พิมพ์ `[log-store] <service>: คำเตือน: รหัสผ่านใน MONGODB_URI ยังเป็นค่าตัวอย่าง dev-…/…change-me …` ถ้ารหัสผ่านใน URI
  ขึ้นต้น `dev-` หรือมี `change-me` — เตือนเท่านั้น ไม่พิมพ์ค่าหรือความยาว (URI ที่ไม่มีรหัสผ่านถือว่าถูก เช่น managed Mongo ที่ใช้ identity)

**Azure** — `deploy/azure/backend.env` และ `delivery-worker.env` ตั้ง `LOG_STORE_ENABLED=false` จนกว่า BDI จะเลือกบริการ (Cosmos DB for MongoDB vCore หรือ
Atlas — ไม่ใช่ Cosmos RU และห้ามรัน mongo เป็น container app เพราะ Azure Files ใช้เป็นที่เก็บข้อมูลของ mongod ไม่ได้) · secretref แยกสองตัว
`mongodb-backend-uri` / `mongodb-worker-uri` เพราะสอง process ใช้คนละผู้ใช้ (**ต่างจากแบบ:** แผนมี `mongodb-uri` ตัวเดียว — docs/20 §4.3 §4.4) ·
`DEPLOY_ENV=azure` · ระหว่างปิด stdout ของ container ไปถึง Log Analytics อยู่แล้ว · ไฟล์ Azure ทั้งสอง**ไม่มี** `LOG_STORE_MAX_MB` วันที่เปิด log store
เพดานจึงเป็นค่าตั้งต้นของ `env.ts` ที่ `NODE_ENV=production` คือ 5120 MB — ถ้าบริการที่เลือกมีโควตาต่ำกว่านั้นต้องตั้งค่านี้ในทั้งสองไฟล์

### 3.13 การเชื่อมต่อ สถานะใน `/health/ready` และสวิตช์ปิด (`lib/log-store.ts`)

- **เปิดเมื่อ** `LOG_STORE_ENABLED` เป็นสตริง `true` พอดี (ค่าตั้งต้น — compose เติม `true` เมื่อว่าง) **และ** `MONGODB_URI` ไม่ว่าง ค่าอื่นทุกค่า (`false` `0`
  `TRUE`) = ปิด (`env.ts`) · ตัวแปรทุกตัวของ log store อ่านด้วย `optional()` ขาดตัวไหนก็ไม่ทำให้ process ใดบูตไม่ขึ้น
- **สวิตช์ปิด** `LOG_STORE_ENABLED=false` ใน `.env` แล้วสร้าง backend กับ delivery-worker ใหม่ ไม่ต้อง build (5.11 ข้อ 4) · การเว้น URI ให้ว่าง**ปิดไม่ได้**:
  compose ไม่อ่าน `MONGODB_URI` จาก `.env` เลย (บรรทัด `MONGODB_URI=` ใน `.env` ไม่มีผล) ตัวที่มันแทนค่าคือ `MONGODB_BACKEND_URI` / `MONGODB_WORKER_URI`
  และถ้าเว้นสองตัวนั้นให้ว่าง `${…:-…}` ถือค่าว่างว่าไม่ได้ตั้งแล้วเติม URI ที่ประกอบเองกลับมา (URI ว่างปิดได้เฉพาะนอก compose เช่นไฟล์ Azure) ·
  ปิดแล้ว driver ไม่ถูกโหลดเลย (ตรวจด้วย `require.cache` แล้ว) และผลอื่นอยู่ใน 3.10
- **การเชื่อมต่อ** client ถูกสร้างตอนใช้ครั้งแรก ต่อไม่ติดก็ทิ้งแล้วสร้างใหม่รอบหน้า · `serverSelectionTimeoutMS` 2000 · `connectTimeoutMS` 2000 · `socketTimeoutMS` 5000 ·
  `maxPoolSize` 5 (backend) / 3 (worker) · `appName` `bdi-backend` / `bdi-delivery-worker` · ผู้เรียกที่**อ่าน**ต้องใส่ `maxTimeMS` เอง (timeout ของ driver
  ไม่คุมคิวรีที่ server ทำนาน) · ไม่มีฟังก์ชันไหนของไฟล์นี้ throw ออกไปหาผู้เรียก — ต่อไม่ได้คือสถานะ `down` กับหนึ่งบรรทัดใน log · `error` ของ client ถูกฟังไว้
  (EventEmitter ที่ไม่มีใครฟังจะพา process ล่ม)
- **ตัวแปร** — ทุกตัวอ่านด้วย `optional()` (ขาดตัวไหนก็ไม่มี process ไหนบูตไม่ขึ้น) ทุกตัวที่ backend และ worker ใช้ร่วมต้องเพิ่มทั้งใน environment ของ backend และ
  สำเนาที่เขียนเองของ delivery-worker ใน `docker-compose.yml`:

| ตัวแปร | ใครอ่าน | ไม่ตั้ง / ค่าตั้งต้น | หมายเหตุ |
|---|---|---|---|
| `LOG_STORE_ENABLED` | backend · worker | `true` (compose เติมเมื่อว่าง) | สวิตช์ปิด — `false` แล้วสร้าง container ใหม่ ไม่ต้อง build · ค่าอื่นที่ไม่ใช่ `true` พอดีก็ปิด |
| `MONGODB_URI` | backend · worker | ว่าง = ปิด | compose ประกอบจาก `MONGO_BACKEND_PASSWORD` / `MONGO_WORKER_PASSWORD` หรือทับทั้งเส้นด้วย `MONGODB_BACKEND_URI` / `MONGODB_WORKER_URI` — ไม่อ่าน `MONGODB_URI` จาก `.env` · Azure: secretref `mongodb-backend-uri` / `mongodb-worker-uri` (คนละผู้ใช้) |
| `MONGODB_DB` | backend · worker · mongo (init) | `bdi_logs` | |
| `LOG_STORE_MAX_MB` | backend · worker | 5120 (production) · 512 | เพดานขนาด (5.9) และฐานของงบไบต์ (5.13) |
| `LOG_HASH_KEY` | backend · worker — **ค่าเดียวกัน** | `dev-log-hash-key` นอก production · production ว่าง = ไม่มี key ค้นหา (3.6) พร้อมคำเตือนตอนบูต | `openssl rand -hex 32` · เปลี่ยนแล้วต้อง rebuild (3.8) · เป็นกุญแจของ key ผู้รับใน loop แจ้งเตือนด้วย (5.14) |
| `LOG_READ_TOKEN` | backend | `dev-log-token-change-me` นอก production · production ว่าง ค่าตัวอย่าง หรือสั้นกว่า 32 ตัว = ถือว่าไม่ได้ตั้ง (503 `log_access_disabled`) พร้อมคำเตือนตอนบูต | `x-log-token` ของ API อ่าน log (3.11) แยกจาก `ADMIN_API_TOKEN` โดยตั้งใจ |
| `INGEST_SERVER_TOKEN` | backend · frontend — **ค่าเดียวกัน** | `dev-ingest-token-change-me` นอก production (frontend ของ compose เติมให้) · production ว่าง ค่าตัวอย่าง หรือสั้นกว่า 32 ตัว = รายงานของ Next server เก็บเป็น browser ที่ยืนยันไม่ได้ | `x-report-token` (5.12) · frontend อ่านตอนรัน ห้ามเป็น `NEXT_PUBLIC_` |
| `ERROR_ALERT_EMAILS` | worker | ว่าง = ปิดการแจ้งเตือน | คั่นด้วย comma ค่าที่ไม่ใช่อีเมลถูกข้ามพร้อมคำเตือน (5.14) |
| `DEPLOY_ENV` | backend · worker | compose: `${COMPOSE_PROJECT_NAME}` · นอก compose: `NODE_ENV` | 5.10 |
| `GIT_SHA` (build arg) → `RELEASE` · `NEXT_PUBLIC_RELEASE` | image ของ backend worker frontend | `unknown` ใน image ของ production · `dev` ใน dev checkout | 5.10 · **ห้ามใส่ `RELEASE` ใน environment ของ compose** |
| `MONGO_ROOT_USER` `MONGO_ROOT_PASSWORD` `MONGO_BACKEND_PASSWORD` `MONGO_WORKER_PASSWORD` | mongo (และ URI ที่ compose ประกอบ) | `bdi` · ค่าตัวอย่าง `dev-mongo-*-change-me` — prod overlay ไม่ยอมเริ่ม mongo ด้วยค่าเหล่านี้ | มีผลครั้งเดียวตอน volume ว่าง (3.12) · ต้องเป็นอักขระที่ใส่ใน URI ได้ (ใช้ฐานสิบหก) |

- **บูต** backend รอผลตรวจครั้งแรกไม่เกิน 3 วินาทีก่อน `listen` (Mongo ติดต่อไม่ได้ = บูตช้าลงราว 2–3 วินาที) — ถ้าการตรวจแรกจบใน 3 วินาที
  `/health/ready` ถูกตั้งแต่คำขอแรก ถ้านานกว่านั้น (Mongo ที่ช้าแต่ต่อได้ — รอบหนึ่งยาวได้ถึง 6 วินาที) backend `listen` ไปก่อนด้วยสถานะเริ่มต้น `down`
  จนกว่ารอบนั้นจะจบ · worker ไม่รอ loop อีเมลเริ่มทันที
- **ตรวจสถานะ** เบื้องหลังทุก 30 วินาที รอบละไม่เกิน 6 วินาที (เกินแล้วนับเป็น `down` โดยไม่ได้ยกเลิกคำสั่งที่ค้าง) ไม่เริ่มรอบใหม่ระหว่างที่รอบเดิมยังรออยู่: `ping` แล้ว `findOne({_id:"audit_event"})` ของ `relay_state` ด้วยสิทธิ์ของ process เอง
  (`maxTimeMS` 2000) — ได้ตรวจไปในตัวว่าผู้ใช้นั้น login และอ่านฐานได้จริง (URI ที่ไม่มีรหัสผ่าน ping ผ่านแต่ได้ `down`: `Command find requires authentication`)
  และเป็นที่มาของ `over_quota` · collection ที่ยังไม่มีคืน null ธรรมดา ไม่ใช่ error

| `checks.logStore.status` | ความหมาย |
|---|---|
| `up` | ต่อได้ login ผ่าน อ่านได้ |
| `down` | ต่อไม่ได้ login ไม่ผ่าน หรือโหลด driver ไม่ขึ้น — สาเหตุอยู่ในบรรทัด `[log-store]` ของ process |
| `disabled` | `LOG_STORE_ENABLED` ไม่ใช่ `true` หรือไม่มี `MONGODB_URI` |
| `over_quota` | ต่อได้ แต่ `relay_state.overQuota` เป็น `true` (5.9) |

`/health/ready` อ่านค่าที่จำไว้ ไม่รอ Mongo และตอบแค่คำเดียวเพราะ endpoint นี้เปิดสาธารณะ — check `database` และ `storage` ของ endpoint เดียวกันก็ตอบ
แค่ `up` / `down` สาเหตุไปที่ `captureError` (`health:database` / `health:storage` ไม่ถี่กว่านาทีละครั้งต่อการตรวจ — 5.1) · logStore **ไม่นับรวมใน `healthy`** — Mongo ล่มแล้ว `/ready` ยังตอบ 200
ถ้า Postgres กับ storage ปกติ เพราะสคริปต์ deploy รัน `curl -fsS /health/ready` ใต้ `set -e` · วัดแล้ว: รู้ว่า `down` ภายในราว 25 วินาที และกลับเป็น `up` ภายในราว
19 วินาที (ขึ้นกับจังหวะของรอบ 30 วินาที)

```json
{ "status": "ok",
  "checks": { "database": { "status": "up" }, "storage": { "status": "up" },
              "datasetChoices": { "source": "database", "count": 212 }, "logStore": { "status": "down" } } }
```

**บรรทัด `[log-store]`** — พิมพ์เมื่อสถานะเปลี่ยนและผลตรวจครั้งแรกของ process · สถานะเดิมแต่สาเหตุเปลี่ยนพิมพ์ได้ไม่ถี่กว่าสิบนาทีครั้ง (เทียบสาเหตุหลังแทน
ตัวเลขด้วย `#` — ข้อความของ driver ฝังเวลาที่ใช้และ IP ของ container) Mongo ที่ล่มนานจึงไม่ได้บรรทัดใหม่ทุก 30 วินาที:

- `[log-store] <service>: เชื่อมต่อ MongoDB ได้ (ฐานข้อมูล bdi_logs)`
- `[log-store] <service>: เชื่อมต่อได้ แต่ขนาดเกิน LOG_STORE_MAX_MB แล้ว (ฐานข้อมูล bdi_logs)`
- `[log-store] <service>: ใช้ MongoDB ไม่ได้ — <สาเหตุ>` — หลัง `docker compose stop mongo` บรรทัดแรกมักเป็น
  `MongoServerSelectionError: Socket 'connect' timed out after 2000ms (connectTimeoutMS: 2000)` · หลัง `docker compose pause mongo` เป็น
  `PoolClearedOnNetworkError: Connection to mongo:27017 interrupted due to server monitor timeout` · `interrupted at shutdown` เฉพาะเมื่อมีการตรวจค้างอยู่ตอน mongod ปิด
- `[log-store] <service>: ปิดอยู่ (LOG_STORE_ENABLED ไม่ใช่ true | ไม่ได้ตั้ง MONGODB_URI) — ไม่โหลด driver ของ Mongo`

บรรทัด `[log-store]` ที่ไม่ได้มาจากการตรวจสถานะ — พิมพ์โดยงานดูแลของ worker (`workers/log-upkeep.ts`, 5.9) และคำเตือนตอนบูต (3.12):

- `[log-store] delivery-worker: สร้าง index {…} ของ <collection> ไม่ได้ (<ชื่อ error>) — ข้ามไป ค้นได้แต่ช้าลง` — ครั้งเดียวต่อ index ต่อ process
- `[log-store] delivery-worker: log store ใช้พื้นที่ X MB (จองไว้ Y MB) เกินเพดาน LOG_STORE_MAX_MB Z MB — ต่อจากนี้เก็บแค่ตัวนับ…` ตอนธงเพิ่งตั้ง และ
  `… ต่ำกว่าเพดานแล้ว — กลับมาเก็บ error event ตามปกติ` ตอนธงลง
- `[log-store] <service>: คำเตือน: รหัสผ่านใน MONGODB_URI ยังเป็นค่าตัวอย่าง …` (production เท่านั้น)
- `[log-store] <service>: คำเตือน: ไม่ได้ตั้ง LOG_HASH_KEY — …` ทุกครั้งที่บูตเมื่อไม่มีกุญแจ (3.6)
- `[log-store] delivery-worker: relay_state ไม่ใช่อย่างที่เขียนไว้ …` · `dbStats ไม่รับ freeStorage …` / `dbStats แบบขอ freeStorage ล้ม …` (5.9)

**สาเหตุไม่พารหัสผ่านออกมา** (`describe()`): (1) error จากการแยก URI (`new MongoClient()`) พิมพ์แค่ชื่อ error กับ `driver แยก MONGODB_URI ไม่ได้ (…)` และวิธีแก้ —
ข้อความของ driver ออกได้เฉพาะหกประโยคตายตัว (`Password contains unescaped characters` · `URI malformed` · `Invalid scheme…` · `URI contained empty userinfo
section` · สองประโยคของ `mongodb+srv`) นอกนั้นเป็น `(ไม่พิมพ์ข้อความของ driver เพราะอาจยก URI มาด้วย)` — ข้อนี้มาก่อน URI ที่มี `@` เกินจึงได้บรรทัดของข้อ 1
(2) error อื่นทุกตัวหลังแยก URI ผ่านแล้ว (รวมโหลด driver ไม่ขึ้น) เมื่อ URI มี `@` เกินหนึ่งตัว (นับ `@` ใน query ด้วย) เหลือชื่อกับ
`… @ ในรหัสผ่านต้องเขียนเป็น %40` (3) นอกนั้นข้อความของ driver หลังลบ userinfo ของ URI ใด ๆ และรหัสผ่านที่ตั้งไว้ (ดิบ ถอด `%xx` และ
encode ใหม่ ไม่สนตัวพิมพ์) ตัดที่ 300 ตัว · ผลคือ URI ที่เขียนเองต้อง percent-encode อักขระพิเศษ (`@` → `%40` · `/` → `%2F` · ช่องว่าง → `%20`) และถ้าต้องการ
ข้อความเต็มของ driver ต้องรัน driver เอง ซึ่งพิมพ์ URI ทั้งเส้นรวมรหัสผ่านลงจอของคนรัน

### 3.14 เอกสาร `activity` แบบ `audit_fallback` (`lib/audit-fallback.ts`)

เกิดเมื่อ `logAudit()` ล้มที่ขั้นใดก็ตาม (อ่าน snapshot หรือ INSERT — Postgres ล่ม · ค่าไม่ใช่ UUID ในคอลัมน์ UUID · `BigInt` ใน JSON · เกินเพดานเวลาของ
`logAudit(…, {deadline: true})` ฯลฯ 2.8) `reportAuditWriteFailure()` (`lib/audit-fallback.ts:91`) ทำสองอย่าง ไม่ await ไม่ throw และ**ไม่เรียก `logAudit()` กลับ**
(ความล้มเหลวหนึ่งครั้งวนไม่ได้):

1. `captureError(err, {tag: "audit.write-failed", extra: {audit}})` — error event ระดับ `error` fingerprint ตั้งต้น · `extra.audit` =
   `{action, subjectType, subjectId, organizationId, actorId, actorType, result, before, after, metadata}` ปิดด้วย `maskForErrorCopy()` (กฎเลขบัตรตัวกว้าง
   กับ**ทุกค่า** ชื่อไฟล์ด้วย — ต่างจากสำเนาข้อ 2 แค่ชื่อไฟล์) และอีเมลที่พิมพ์ของ `LOGIN_FAILED` ถูกปิด — **เฉพาะเมื่อ `extra` ทั้งก้อนไม่เกิน 16 KB** เกินแล้วเหลือ
   `{truncated: true, bytes, keys: ["audit"]}` (5.2) — diff ใหญ่หรือ `note` ยาวจึงเหลือเนื้อของแถวแค่ในเอกสารข้อ 2 · event นี้อยู่ใต้เพดานการสุ่มเก็บ
   และเพดานขนาดเหมือน event อื่น (5.7)
2. เอกสาร `activity` หนึ่งใบเข้าคิวเดียวกัน — ประกอบเป็นแถวแบบที่ `logAudit` จะเขียน (metadata = snapshot ของผู้กระทำ + ของจุดเรียก + `ip_unparsed` +
   `admin_token_fp` ลำดับเดียวกับ `auditMetadata()`) แล้วผ่าน **`projectAuditRow()` ตัวเดียวกับ relay** — category `via` การปิดข้อมูล `hashKeys`
   `relatedUserIds` `changedFields` และเพดาน 64 KB จึงเป็นกฎเดียวกับสำเนาของแถวที่ Postgres รับ (3.2–3.6) ค่าที่ต่างจากสำเนาของ relay:

| ฟิลด์ | ค่าในเอกสาร `audit_fallback` |
|---|---|
| `_id` | UUID ใหม่ — แถว Postgres ไม่เกิด จึงไม่มี id ให้ใช้ |
| `source` | `"audit_fallback"` |
| `occurredAt` | เวลาที่ล้ม ไม่ใช่เวลาที่ `logAudit` เริ่ม |
| `actor` | `id` = actor ที่ `logAudit` หามาได้ (input ก่อน แล้วบริบท) · `name` `roles` `organizationId` จาก snapshot **ถ้าอ่านทันก่อนล้ม** ไม่งั้น null / `[]` / null |
| `requestNumber` | `metadata.request_number` เท่านั้น — ทางนี้วิ่งบนเส้นทางของคำขอหลัง Postgres เพิ่งปฏิเสธ จึงไม่ถามตารางคำขออีก แถวที่ไม่ได้ใส่คีย์นั้น (อัปโหลด ดาวน์โหลด …) ได้ null ขณะที่สำเนาของ relay มี |
| `request.method` · `request.route` | จากบริบทของคำขอ (relay ได้ null เพราะ `audit_event` ไม่มีสองคอลัมน์นี้) |
| `sourceComponent` | บริบท หรือ `request-service` |
| `fallback.errorEventId` | id ของ event ข้อ 1 ถ้ามันได้เข้าคิว — **null** เมื่อไม่ได้เข้า: เกินเพดานขนาด · ติดเพดาน 50/ชั่วโมงหรือ 600/นาที · งบไบต์ `anonymous-request` หมด (คำขอที่ไม่มีตัวตน เช่น `/api/auth/*` — `anonymous_budget`, 5.13) · คิวเต็ม · issue ที่รอเขียนครบ (`issue_backlog`) · ตัว `captureError` เองล้ม · **id ที่ไม่ null ก็อาจชี้ event ที่ไม่เคยถูกเขียน**: id ถูกจดตอนเข้าคิว แล้ว event (ชั้น 3) ยังถูกไล่ออกทีหลังด้วยรายการชั้น 4 เมื่อคิวเต็ม ถูกข้ามตอนเขียนถ้าธงเกินเพดานตั้งก่อน flush หรือ Mongo ไม่รับ — ขณะที่เอกสารนี้ (ชั้น 4 เขียนแม้เกินเพดาน) ถูกเขียน |

**ในคิว** สำเนาเหล่านี้อยู่ชั้นเดียวกับ fatal — ถูกทิ้ง**ท้ายสุด**เมื่อคิวเต็ม และ**ยังเขียนแม้เกินเพดานขนาด** (5.7, 5.9) ถ้าหายนับใน `auditCopies` ของ event สรุป
“ทิ้งไป N” · process ตายก่อน flush = หาย · Postgres **ไม่ได้แถวคืน** และ rebuild สร้างเอกสารนี้ใหม่ไม่ได้ · มีแค่ใน backend (worker ไม่เขียน audit) ·
`seed:demo` ไม่แตะ Mongo เอกสารเหล่านี้จึงอยู่ข้าม seed · เพดาน 64 KB ตัดจริง: ส่วนที่ถูกตัดไม่มีที่อื่นให้กลับไปอ่าน

**บันทึกการอ่าน log ที่ Postgres ไม่รับ** (`recordLogReadFallback()`, `lib/audit-fallback.ts:167`) ใช้รูปเดียวกันแต่**เขียนตรงและรอผลไม่เกิน 2 วินาที ไม่ผ่านคิว** — คำขอ
อ่านต้องรู้ว่าการอ่านถูกบันทึกแล้วก่อนส่งข้อมูล (3.11) · error event ของมันคือ `audit.log-read-failed` ไม่มี `extra.audit` (ผู้อ่าน เหตุผล และตัวกรองอยู่ในสำเนาแล้ว) ·
`_id` ใหม่ ไม่ใช่ id ที่ Postgres จะได้: INSERT ที่หมดเวลารอแล้วยัง commit ทีหลัง relay คัดลอกมาเป็นอีกใบ — การอ่านครั้งนั้นมีสองบันทึก ซึ่งดีกว่าไม่มีเลย และ
reconcile ไม่นับเพี้ยน · เส้นตาย 2 วินาทีแค่เลิกรอ `insertOne` ที่ช้าเขียนเสร็จทีหลังได้ คำขอที่ตอบ 503 `log_read_unrecorded` ไปแล้วจึงอาจมีสำเนานี้ (3.11)

ค้น: `GET /api/admin/logs/activity?source=audit_fallback` (G1) · ตามรหัสอ้างอิงด้วย G6 · หรือ `db.activity.find({ source: "audit_fallback" })` (5.11)

ตัวอย่าง (ข้อมูลสมมติ) — การบันทึกร่างใน 2.9 ที่ connection ของ Postgres หลุดหลัง route commit แล้ว ก่อน `logAudit` จะอ่าน snapshot (`actor.name` `roles` ว่าง
`relatedUserIds` ยังมีผู้กระทำ เพราะ id มาจากบริบท):

```json
{
  "_id": "7e1d2c3b-4a59-4687-9a0b-1c2d3e4f5a6b",
  "source": "audit_fallback",
  "schemaVersion": 1,
  "occurredAt": { "$date": "2026-09-29T03:21:07.455Z" },
  "action": "REQUEST_DRAFT_SAVED",
  "category": "request",
  "result": "SUCCESS",
  "actor": { "type": "USER", "id": "c3d4e5f6-a7b8-4c9d-8e0f-1a2b3c4d5e6f", "name": null, "roles": [], "organizationId": null },
  "via": "SESSION",
  "tokenFps": [],
  "subject": { "type": "ORGANIZATION_REGISTRATION_REQUEST", "id": "d4e5f6a7-b8c9-4d0e-9f1a-2b3c4d5e6f7a" },
  "organizationId": "2c8e4a10-7f3b-4d6e-9a15-b0c9d8e7f6a5",
  "requestNumber": "ORG-REG-2026-0021",
  "gate": null,
  "before": { "organizationPhone": "021234567", "approverCid": { "masked": "xxxxxxxxx0934", "changed": true } },
  "after":  { "organizationPhone": "021234599", "approverCid": { "masked": "xxxxxxxxx7710", "changed": true } },
  "changedFields": ["organizationPhone", "approverCid"],
  "reason": null,
  "metadata": { "saved_via": "WEB_FORM", "request_number": "ORG-REG-2026-0021", "status": "DRAFT",
                "fields_changed": ["organizationPhone", "approverCid"] },
  "request": { "correlationId": "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d", "reference": "9a8b7c6d",
               "ip": "203.0.113.77", "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) …",
               "method": "PATCH", "route": "/api/organizations/:id", "status": null, "durationMs": null },
  "sourceComponent": "web-portal",
  "relatedUserIds": ["c3d4e5f6-a7b8-4c9d-8e0f-1a2b3c4d5e6f"],
  "hashKeys": [],
  "mirroredAt": { "$date": "2026-09-29T03:21:07.455Z" },
  "fallback": { "errorEventId": "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e" }
}
```

---

## 4. แคตตาล็อกเหตุการณ์

รหัส `AuditAction` มี **54 ตัว** (`lib/audit.ts:27-477` — หัวไฟล์ยังเขียนว่า “~25” ซึ่งล้าสมัย) ถูกเขียนจริง **53 ตัว** จาก 89 จุดเรียก (88 ของ
`logAudit()` + 1 ของ `recordLogRead()`) — `DATA_EXPORTED` ประกาศไว้แต่ไม่มีใครเขียน (4.13) ทุกแถวในหมวดนี้ลง Postgres และ relay คัดลอกลง `activity`
(ปิดข้อมูลตาม 3.6 category ตาม 3.5) · แถวที่ `logAudit` เขียนลง Postgres ไม่สำเร็จได้สำเนา `audit_fallback` (3.14) · รหัสที่ห้าสิบห้า `ADMIN_API_REQUEST`
อยู่ใน Mongo อย่างเดียว (4.11)

### 4.0 วิธีอ่าน และแถวที่มาเป็นชุด

คำย่อที่ใช้ในตารางของแต่ละ event:

| คำย่อ | แปลว่า |
|---|---|
| **แถว session** | `actor_type USER` = ผู้ที่ล็อกอิน (จาก `requireAuth`) · มี snapshot `actor_*` · `source_component web-portal` |
| **แถว admin** | มาทาง `x-admin-token`: `actor_type SYSTEM` · `actor_id` null · ไม่มี snapshot · `source_component admin-portal` · มี `admin_token_fp` |
| **แถวนิรนาม** | `actor_type ANONYMOUS` (จุดเรียกส่งเอง) · ไม่มี snapshot · `web-portal` |
| UA / URA / UAK / ORR / DRR / ATT | subject `USER_ACCOUNT` / `USER_ROLE_ASSIGNMENT` / `USER_ACTIVATION_KEY` / `ORGANIZATION_REGISTRATION_REQUEST` / `DATASET_REGISTRATION_REQUEST` / `ATTACHMENT` |

- ตาราง metadata ของแต่ละ event แสดง**เฉพาะคีย์ของจุดเรียก** คีย์ระบบ (`actor_*` `ip_unparsed`
  `admin_token_fp`) อยู่ที่ 2.3 และมีทุกแถวที่เงื่อนไขตรง
- คีย์ `*_via` บอกช่องทาง ค่าที่ใช้อยู่: `ADMIN_API` · `ADMIN_RESET_API` · `ADMIN_TRANSFER` · `REVIEW_API` ·
  `WEB_FORM` · `THAID` · `ACTIVATION` · `ORGANIZATION` · `ORGANIZATION_CREATED`
- ตัวอย่างแสดงแค่ `before` / `after` / `metadata` (ไม่รวมคีย์ระบบ) ข้อมูลสมมติทั้งหมด คอลัมน์อื่นดู 2.9
- “ในธุรกรรม” = แถวถูกเขียนขณะ transaction ของ route ยังไม่ commit และรอดแม้ rollback (6.2)

**แถวที่มาเป็นชุด** — การกระทำหนึ่งครั้งเขียนหลายแถว `[…]` = มีเมื่อเงื่อนไขตรง `→` = ลำดับภายใน**คำขอ HTTP เดียวกัน**
(correlation id เดียวกัน) **`·` = ขึ้นคำขอใหม่** ซึ่งได้ correlation id ใหม่ (2.5) — ช่วงที่คั่นด้วย `·` ต้องผูกกันด้วย subject
`integration_operation_id` หรือเวลา ไม่ใช่ด้วย correlation id

`[EXPIRED]` ย่อจาก [`SESSION_REVOKED` EXPIRED] — เกิดได้ในคำขอที่เรียก `resolveSession()` กับ cookie ที่เบราว์เซอร์ถืออยู่แล้ว
หมดอายุ (`issueSession()` `routes/auth.ts:1349-1352` และท้าย `POST /password-reset` `:971-973`) เป็นของ**เจ้าของ cookie** ซึ่งอาจเป็นคนอื่น

| การกระทำ | แถวตามลำดับ |
|---|---|
| เข้าสู่ระบบด้วยรหัสผ่าน | `POST /login`: `LOGIN_OTP_ISSUED` · `POST /login/verify-otp`: `LOGIN_SUCCEEDED` → [`[EXPIRED]` หรือ `SESSION_REVOKED` ROTATED] |
| เข้าสู่ระบบด้วย ThaID | `/thaid/start`: `IDENTITY_VERIFICATION_STARTED` (`purpose: login` · subject `INTEGRATION_JOB`) · `/thaid/callback` อย่างใดอย่างหนึ่ง: `LOGIN_SUCCEEDED` `method: THAID` → [`[EXPIRED]` หรือ `SESSION_REVOKED` ROTATED] · หรือ `LOGIN_FAILED` `THAID_NO_MATCHING_ACCOUNT` · หรือ `IDENTITY_VERIFICATION_FAILED` (`ambiguous_account` และรหัสอื่นของ callback) — **สองแถวแรกผูกกลับไปที่ STARTED ไม่ได้** (4.1) |
| เปิดใช้งานบัญชี | `/thaid/start`: `IDENTITY_VERIFICATION_STARTED` (คีย์เพิ่งหมดอายุ = [`ACTIVATION_KEY_EXPIRED`] แทน แล้ว 410) · `/thaid/callback`: `IDENTITY_VERIFIED` → [`USER_ACCOUNT_UPDATED` THAID] (หรือ [`ACTIVATION_KEY_EXPIRED`] → `IDENTITY_VERIFICATION_FAILED`) · `/activate` (คีย์เพิ่งหมดอายุ = [`ACTIVATION_KEY_EXPIRED`] แล้ว 410): [`ROLE_REVOKED` A ในธุรกรรม] → `USER_ACCOUNT_ACTIVATED` → `ACTIVATION_KEY_USED` → [`ROLE_ASSIGNED`] → [`ROLE_REVOKED` B จาก announce] → [`[EXPIRED]` หรือ `SESSION_REVOKED` ROTATED] |
| admin เชิญผู้ใช้ | `USER_ACCOUNT_CREATED` → `ACTIVATION_KEY_ISSUED` |
| admin ส่งคำเชิญใหม่ | [`ACTIVATION_KEY_REVOKED`] → `ACTIVATION_KEY_ISSUED` |
| ลิงก์ตั้งรหัสผ่านใหม่ | admin: `PASSWORD_RESET_REQUESTED` · เจ้าของบัญชีภายหลัง: [`SESSION_REVOKED` PASSWORD_CHANGED ในธุรกรรม] → `PASSWORD_RESET_COMPLETED` → [`[EXPIRED]` ของ cookie ของบัญชีอื่นที่เบราว์เซอร์ถืออยู่] |
| admin ระงับบัญชี | [`SESSION_REVOKED` ACCOUNT_SUSPENDED ในธุรกรรม] → `USER_ACCOUNT_SUSPENDED` |
| admin แก้อีเมล/เลขบัตร | [`SESSION_REVOKED` ROTATED ในธุรกรรม] → `USER_ACCOUNT_UPDATED` (`identity_change: true`) |
| admin บังคับออกจากระบบ | [`SESSION_REVOKED` LOGOUT_ALL ของ helper] → `SESSION_REVOKED` LOGOUT_ALL ของ route (เขียนเสมอ) |
| admin มอบ role | [`ROLE_REVOKED` A ในธุรกรรม — ผู้ถือที่นั่งเดิมที่บัญชีไม่ ACTIVE] → `ROLE_ASSIGNED` (subject UA) — **ไม่มีรูปแบบ B** |
| admin ถอน role | `ROLE_REVOKED` รูปแบบ C |
| admin ยุติบัญชี | [`ROLE_REVOKED` ×n ในธุรกรรม] → [`SESSION_REVOKED` ในธุรกรรม] → `USER_ACCOUNT_DEACTIVATED` → [`ACTIVATION_KEY_REVOKED` ×n] |
| admin ย้ายหน่วยงาน | [`ROLE_REVOKED` ×n] → [`ROLE_REVOKED` ของผู้ถือที่นั่งเดิม] → [`SESSION_REVOKED` ROTATED] (ทั้งหมดในธุรกรรม) → `ROLE_ASSIGNED` → [`REQUEST_RESET_TO_DRAFT` ×n] |
| admin สั่งคำขอหน่วยงานกลับเป็นร่าง | [`ROLE_REVOKED` + `SESSION_REVOKED` ในธุรกรรม] → `REQUEST_RESET_TO_DRAFT` → [`APPROVER_INVITATION_RECALLED`] → [`USER_ACCOUNT_DEACTIVATED`] → [`ACTIVATION_KEY_REVOKED` ×n] |
| ผู้ใช้เปิดหน่วยงานใหม่ (**ถอดแล้วที่ `7259c09`** — แถวเก่าเท่านั้น) | [`ROLE_REVOKED` A ในธุรกรรม] → [`ROLE_REVOKED` B] → `ORGANIZATION_CREATED` → `REQUEST_CREATED` → `ROLE_ASSIGNED` (สองแถวแรกในทางปฏิบัติไม่เกิด — หน่วยงานเพิ่งสร้าง) |
| กด “ตรวจสอบข้อมูล” / “ตรวจสอบคำขอ” | PATCH: [`REQUEST_DRAFT_SAVED`] · generate: `REQUEST_FORM_GENERATED` |
| นำส่งคำขอ | `REQUEST_SUBMITTED` (`after = {requestNumber}`) — ฝั่งชุดข้อมูลเขียนหลังการแจ้งเตือน (4.7) |
| ผู้ประสานงาน BDI ตรวจคำขอหน่วยงานผ่าน | [`ROLE_REVOKED` ในธุรกรรม] → `REQUEST_SUBMITTED` (`after.taskType BDI_OFFICER_REVIEW`) → [`USER_ACCOUNT_CREATED`] → [`ACTIVATION_KEY_REVOKED`] → [`ACTIVATION_KEY_ISSUED`] หรือ [`ROLE_ASSIGNED`] → [`ROLE_REVOKED` จาก announce] |
| ผู้มีอำนาจฯ ลงนามคำขอหน่วยงาน | `REQUEST_SUBMITTED` (`ORGANIZATION_APPROVAL`, `APPROVED`) → `DOCUMENT_SIGNED` |
| BDI อนุมัติขั้นสุดท้ายคำขอหน่วยงาน | `REQUEST_APPROVED` → `ORGANIZATION_ACTIVATED` → `DOCUMENT_SIGNED` |
| ผู้ประสานงาน BDI ยกเลิกผลการตรวจ (recall) | `REQUEST_RETURNED` → [`APPROVER_INVITATION_RECALLED`] → [`ACTIVATION_KEY_REVOKED`] |
| ลงนามคำขอชุดข้อมูล (ผู้มีอำนาจฯ / BDI ขั้นสุดท้าย) | `REQUEST_APPROVED` → `DOCUMENT_SIGNED` |

แถว `SESSION_REVOKED` ของ helper ทุกแถวข้างบน (`[…]` ในแถวของ admin) เขียน**เฉพาะเมื่อมี session ที่ยังไม่ถูกเพิกถอนอย่างน้อยหนึ่งใบ**
(`session.ts:176-193`) บัญชีที่ไม่มี session ค้างอยู่จึงไม่มีแถวนั้น

**แถวที่ `result = FAILURE` ได้** มีแค่ `LOGIN_FAILED` · `IDENTITY_VERIFICATION_FAILED` · `PASSWORD_RESET_COMPLETED` (ลิงก์ที่ใช้ไม่ได้) ·
`ADMIN_TOKEN_REJECTED` · `LOG_TOKEN_REJECTED` (และ `ADMIN_API_REQUEST` ใน Mongo ที่ status ≥ 400) ทุกรหัสอื่นเป็น `SUCCESS` เสมอ — รวมผลการตรวจ “ส่งกลับ” และ
“ไม่อนุมัติ” ซึ่งผลจริงอยู่ใน `after.result` (4.9) คิวรีหา “สิ่งที่ล้ม” ด้วย `result = 'FAILURE'` จึงไม่เจอการตรวจที่ไม่ผ่าน

**ความหมายของ `reason`** — คีย์ชื่อเดียวกันถือของสองแบบ และข้อความที่คนพิมพ์บางจุดอยู่คีย์อื่น:

| ที่อยู่ | เป็นรหัส | เป็นข้อความที่คนพิมพ์ |
|---|---|---|
| `metadata.reason` | `SESSION_REVOKED` (`SessionRevokeReason`) · `ROLE_REVOKED` รูปแบบ B (`REPLACED_BY_NEW_HOLDER`) · `ACTIVATION_KEY_ISSUED` (`INVITATION` `RESEND` `APPROVER_INVITATION`) | admin: `USER_ACCOUNT_SUSPENDED` `REACTIVATED` `DEACTIVATED` `UPDATED` (อีเมล/เลขบัตร) · `USER_IDENTITY_RELEASED` · `ROLE_ASSIGNED` ของ admin · `ROLE_REVOKED` A และ C (A ของการแทนที่ที่นั่งเป็นข้อความคงที่ `"มีผู้รับผิดชอบคนใหม่แทน"`) · `ACTIVATION_KEY_REVOKED` (ข้อความของ admin, `note` ของ recall หรือข้อความคงที่ภาษาไทยของโค้ด) · `REQUEST_UPDATED` `RESET_TO_DRAFT` `CANCELLED` (admin) `DELETED` · `APPROVER_INVITATION_RECALLED` (admin reset) · ผู้อ่าน log: `AUDIT_LOG_READ` (จาก `x-log-reason`) · `ERROR_ISSUE_STATUS_CHANGED` (จาก body — ซ้ำใน `after.statusReason`) — ในสำเนาทั้งสองก็ถูกยกขึ้น `reason` ชั้นบนเหมือนแถวอื่น |
| `metadata.admin_reason` | — | `SESSION_REVOKED` ของ `DELETE /api/admin/users/:id/sessions` (ที่นั่น `reason` = `LOGOUT_ALL`) |
| `metadata.note` | — | `APPROVER_INVITATION_RECALLED` ขา recall |
| `after.note` | — | ผลการตรวจทุกรหัส (4.9) · `SPECIALIST_COMMENT_RECORDED` |
| `after.reason` | ข้อความคงที่ `"หน่วยงานยกเลิกคำขอเอง"` | `REQUEST_CANCELLED` ของหน่วยงาน |
| `before.suspensionReason` | — | `USER_ACCOUNT_REINSTATED` |

**ค่า enum ที่พบใน `before` / `after` / `metadata`**

| enum | ค่า |
|---|---|
| สถานะคำขอ (`RequestStatus`) | `DRAFT` ฉบับร่าง · `SUBMITTED` นำส่งแล้ว · `UNDER_REVIEW` กำลังพิจารณา · `RETURNED` ส่งกลับให้แก้ไข · `APPROVED` อนุมัติแล้ว · `REJECTED` ไม่อนุมัติ · `CANCELLED` ยกเลิกแล้ว |
| ด่าน (`ReviewTaskType`, `after.taskType`) | `BDI_OFFICER_REVIEW` ผู้ประสานงาน BDI ตรวจ · `DATASET_SPECIALIST_REVIEW` ความเห็นผู้เชี่ยวชาญ (มีแค่ใน `SPECIALIST_COMMENT_RECORDED`) · `ORGANIZATION_APPROVAL` ผู้มีอำนาจฯ ของหน่วยงานลงนาม · `BDI_FINAL_APPROVAL` BDI อนุมัติขั้นสุดท้าย · (`ORGANIZATION_REVISION` มีใน enum ไม่พบใน audit) |
| ผลการตรวจ (`ReviewResult`, `after.result`) | `PASSED` ผ่านด่านแรก · `APPROVED` อนุมัติ/ลงนาม · `RETURNED` ส่งกลับ · `REJECTED` ไม่อนุมัติ — `CONFIRMED` และ `COMPLETED` อยู่แค่บนแถว `review_task` ไม่เคยลง audit |
| สถานะบัญชี (`UserAccountStatus`) | `PENDING` ถูกเชิญ ยังไม่เปิดใช้ · `ACTIVE` · `SUSPENDED` ระงับชั่วคราว (role ยังอยู่) · `DEACTIVATED` ยุติ |
| สถานะคีย์ (`ActivationKeyStatus`) | `ISSUED` · `USED` · `EXPIRED` · `REVOKED` |
| สถานะหน่วยงาน (`OrganizationStatus`) | `PENDING_REGISTRATION` อยู่ระหว่างลงทะเบียน · `ACTIVE` เปิดใช้งาน · `SUSPENDED` · `INACTIVE` |
| สถานะ assignment | `ACTIVE` · `REVOKED` |
| เหตุผลการปิด session (`SessionRevokeReason`) | `LOGOUT` · `LOGOUT_ALL` · `PASSWORD_CHANGED` · `ACCOUNT_SUSPENDED` · `ROTATED` · `EXPIRED` (4.2) |
| role | `ORGANIZATION_USER` ผู้ประสานงานของหน่วยงาน · `ORGANIZATION_APPROVER` ผู้มีอำนาจอนุมัติของหน่วยงาน · `BDI_OFFICER` ผู้ประสานงานของ BDI · `BDI_DATASET_SPECIALIST` ผู้เชี่ยวชาญด้านข้อมูลของ BDI · `BDI_FINAL_APPROVER` ผู้มีอำนาจอนุมัติของ BDI · `BDI_LEGAL_OFFICER` ผู้เชี่ยวชาญด้านกฎหมายของ BDI · `SYSTEM_ADMINISTRATOR` ผู้ดูแลระบบ |

---

### 4.1 หมวด auth — การเข้าสู่ระบบและการยืนยันตัวตน

#### `LOGIN_SUCCEEDED` — เข้าสู่ระบบสำเร็จ

ผ่านขั้นสุดท้ายของการเข้าสู่ระบบแล้ว เขียน**ก่อน** `issueSession()` ซึ่งอาจเขียน `SESSION_REVOKED` ต่อ: `ROTATED` เมื่อเบราว์เซอร์ถือ
cookie ที่ยังใช้ได้ หรือ `EXPIRED` (actor = เจ้าของ cookie นั้น) เมื่อ cookie ที่ถืออยู่หมดอายุแล้ว (`routes/auth.ts:1349-1353`)
`POST /api/auth/activate` ก็เปิด session ให้ด้วย `issueSession()` เหมือนกัน**โดยไม่มีแถวนี้** — นับการเข้าสู่ระบบต้องรวม `USER_ACCOUNT_ACTIVATED`

**เกิดเมื่อ**
- `POST /api/auth/login/verify-otp` — OTP ถูกและบัญชียัง `ACTIVE` (`method: PASSWORD_OTP`)
- `POST /api/auth/thaid/callback` ขา login — มีบัญชี `ACTIVE` ที่ `cid` ตรงกับเลขบัตรจาก ThaID **หนึ่งบัญชีพอดี** (`method: THAID`)

| ช่อง | ค่า |
|---|---|
| actor | `USER` = บัญชีที่เข้าสู่ระบบ (ส่ง `actorId` เอง) · มี snapshot |
| subject | UA · id ของบัญชีนั้น |
| organization_id | null (หน่วยงานดูจาก `actor_organization_id`) |
| result | `SUCCESS` |
| before / after | null / null |

| metadata | ความหมาย | ตัวอย่าง |
|---|---|---|
| `method` | ช่องทาง | `"PASSWORD_OTP"` · `"THAID"` |

- **ข้อมูลส่วนบุคคล** ชื่อ (หรืออีเมล) ใน `actor_name` · ขา ThaID ไม่เก็บ `thaid_subject` และไม่เก็บ `integration_operation_id`
- **ขา ThaID ผูกกลับไปที่ `IDENTITY_VERIFICATION_STARTED` ไม่ได้** — ไม่มี `integration_operation_id` และ correlation id เป็นของคำขอ
  callback ซึ่งไม่ตรงกับแถว STARTED หรือแถว `integration_operation` (2.5) ต่างจากขา activate ที่ `IDENTITY_VERIFIED`/`..._FAILED`
  มี `integration_operation_id` ทางประมาณ: แถว `integration.integration_operation` ที่ `operation = 'AUTHENTICATE'` `status = 'SUCCEEDED'` `external_reference` = `sub` ของบัตร
  (เท่ากับ `iam.user_account.external_subject` ถ้าบัญชีเคยผูกไว้) และ `completed_at` ใกล้ `occurred_at` ของแถวนี้
- ไม่มี id ของ session ที่ออกให้ (2.10)
- **ตัวอย่าง** `{"metadata": {"method": "PASSWORD_OTP"}}`
- **โค้ด** `routes/auth.ts:1133` (OTP) · `:627` (ThaID) — การเขียน `external_subject` ครั้งแรกของขา ThaID ไม่มีแถว `USER_ACCOUNT_UPDATED`

#### `LOGIN_FAILED` — เข้าสู่ระบบไม่สำเร็จ

ทุกความล้มเหลวของขั้นรหัสผ่าน ขั้น OTP และขา login ของ ThaID ที่หาบัญชีไม่เจอ แยกด้วย `failure_reason` — ยกเว้น body ที่ไม่ผ่าน
zod (400 `validation` เช่นอีเมลผิดรูปหรือยาวเกิน 254 ตัว หรือรหัส OTP ไม่ครบ 6 หลัก) ของ `/login` และ `/login/verify-otp` ซึ่ง**ไม่มีแถว** (`auth.ts:992-994`
`:1047-1050`) · body ที่อ่านไม่ออก ใหญ่เกิน 1 MB หรือเข้ารหัสแบบที่ไม่รองรับก็**ไม่มีแถว** — ไม่ถึง route เลย `RequestBodyError` ตอบ 400/413/415 จากตัวจัดการ
error ท้าย `index.ts` (แยกตามที่มาตั้งแต่ `76245a3`) และเก็บเป็น warning ที่ไม่พิมพ์ fingerprint `http:request-body:<status>` ใน Mongo (5.1)

| `failure_reason` | เกิดเมื่อ | `subject_id` | metadata อื่น | โค้ด |
|---|---|---|---|---|
| `INVALID_CREDENTIAL` | `POST /api/auth/login`: ไม่มีบัญชีของอีเมลนี้ · บัญชีไม่มีรหัสผ่าน · รหัสผ่านผิด | บัญชีของอีเมลนั้น หรือ null | `email` | `auth.ts:1000` |
| `ACCOUNT_PENDING` · `ACCOUNT_SUSPENDED` · `ACCOUNT_DEACTIVATED` | `POST /login`: รหัสผ่านถูกแต่บัญชีไม่ `ACTIVE` — บัญชี PENDING ที่ถูกเชิญจริงยังไม่มี `password_hash` จนกว่าจะ `/activate` (`admin.ts:826` และ `organizations.ts:3114` สร้างโดยไม่มีรหัสผ่าน) จึงได้ `INVALID_CREDENTIAL` แทน `ACCOUNT_PENDING` เกิดได้แค่กับบัญชี PENDING ของ `seed:demo` ซึ่งตั้งรหัสผ่านให้ทุกสถานะ | บัญชีนั้น | — | `auth.ts:1019` |
| `OTP_NOT_PENDING` | `POST /login/verify-otp`: ไม่มี OTP `LOGIN` ที่ยังไม่ถูกใช้ของอีเมลนี้ | ค้นจากอีเมล หรือ null | `email` | `auth.ts:1065` |
| `OTP_EXPIRED` | OTP ล่าสุดหมดเวลา | เหมือนข้างบน | `email` `otp_code_id` `expires_at` | `auth.ts:1065` |
| `OTP_LOCKED` | ผิดครบ `OTP_MAX_ATTEMPTS` แล้ว (รหัสถูกเผา) | เหมือนข้างบน | `email` `otp_code_id` `attempts` | `auth.ts:1065` |
| `OTP_INVALID` | รหัสผิด | เหมือนข้างบน | `email` `otp_code_id` `attempts_left` | `auth.ts:1065` |
| `ACCOUNT_INACTIVE` | OTP ถูก แต่บัญชีหายหรือถูกระงับระหว่างสองขั้น | บัญชีนั้น หรือ null | `account_status` `email` `otp_code_id` | `auth.ts:1111` |
| `THAID_NO_MATCHING_ACCOUNT` | `/thaid/callback` ขา login: ไม่มีบัญชี `ACTIVE` ที่ `cid` ตรง | null | `thaid_subject` | `auth.ts:593` |

| ช่อง | ค่า |
|---|---|
| actor | **แถวนิรนาม** |
| subject | UA · ตามตาราง (ค้นจากอีเมลเฉพาะในทางที่ล้มเหลว error ของการค้นถูกกลืน) |
| organization_id | null |
| result | `FAILURE` |
| before / after | null / null |

| metadata | ความหมาย | ตัวอย่าง |
|---|---|---|
| `failure_reason` | รหัสในตารางบน | `"OTP_INVALID"` |
| `email` | อีเมลที่**พิมพ์มา** (trim + lowercase แล้ว ยาวไม่เกิน 254 ตัว — `emailSchema` ตั้งแต่ `fc16d0f` ยาวกว่านั้นตอบ 400 และไม่มีแถว) มีแม้ไม่มีบัญชี | `"someone@agency.go.th"` |
| `otp_code_id` | id ของแถว `iam.otp_code` | `"b1e0c7d2-…"` |
| `expires_at` | เวลาหมดอายุของ OTP (ISO) | `"2026-09-29T03:15:00.000Z"` |
| `attempts` | จำนวนครั้งที่ผิดก่อนถูกล็อก | `5` |
| `attempts_left` | `max(OTP_MAX_ATTEMPTS − attempts − 1, 0)` | `2` |
| `account_status` | สถานะของบัญชีตอนนั้น หรือ null | `"SUSPENDED"` |
| `thaid_subject` | `sub` ของ DOPA = **เลขบัตร 13 หลัก** ของคนที่สแกนบัตร | `"1234567890123"` |

- **ข้อมูลส่วนบุคคล** อีเมลที่พิมพ์มาเก็บดิบใน Postgres รวมถึงอีเมลที่ไม่มีบัญชี (พิมพ์ผิด หรือผู้เดา) ·
  `thaid_subject` คือเลขบัตรเต็มของคนที่**ไม่มีบัญชีในระบบ** · สำเนาใน Mongo ปิดทั้งสองอย่างและทำ key ค้นหาให้ (3.6)
- **ตัวอย่าง** `{"metadata": {"failure_reason": "INVALID_CREDENTIAL", "email": "someone@agency.go.th"}}`
- แถว `THAID_NO_MATCHING_ACCOUNT` ไม่มี `subject_id` ไม่มี `integration_operation_id` และ**เชื่อมด้วย correlation id ก็ไม่ได้**:
  `integration_operation.correlation_id` ถูกตั้งครั้งเดียวจากคำขอ `/thaid/start` (`thaid-flow.ts:80`) ไม่มีฟังก์ชันไหนแก้อีก และหน้าเว็บไม่ส่ง
  `x-correlation-id` แถวนี้จึงไม่มี id ร่วมกับทั้งแถว operation และแถว `IDENTITY_VERIFICATION_STARTED` ทางเดียวคือประมาณเอา:
  operation `AUTHENTICATE` ที่ `status = 'FAILED'` `last_error_code = 'account_not_found'` และ `completed_at` ใกล้ `occurred_at`
  ของแถวนี้ ส่วนขา login ที่เจอ**หลาย**บัญชีเป็น `IDENTITY_VERIFICATION_FAILED` `ambiguous_account` ไม่ใช่รหัสนี้
- ไม่มี rate limit: แถว `INVALID_CREDENTIAL` และ `OTP_NOT_PENDING` ใครก็เขียนได้ไม่จำกัด (docs/09 §4.1) · แต่ละแถวใส่ข้อความของผู้ยิงได้ราว
  1 KB (อีเมล ≤ 254 · user agent ≤ 512 · IP เฉพาะที่แยกได้) — ก่อน `fc16d0f` อีเมลยาวได้ถึงเพดาน body 1 MB (วัดได้แถวละ 20–200 KB)

#### `LOGIN_OTP_ISSUED` — ออก OTP ให้ขั้นที่สอง

“ออก” ไม่ได้แปลว่า “ส่งถึง” — แถวเขียน**ก่อน** `sendOtpEmail()` ซึ่งส่ง inline และ throw ได้ ถ้า SMTP ล้ม แถวยังอยู่
และคำขอตอบ 500 ใช้ตอบคำถามว่ารหัสผ่านของบัญชีหนึ่งถูกใช้สำเร็จกี่ครั้งโดยไม่มีใครผ่าน OTP ต่อ

**เกิดเมื่อ**
- `POST /api/auth/login` — รหัสผ่านถูกและบัญชี `ACTIVE` (`resend: false`)
- `POST /api/auth/login/resend-otp` — มี OTP `LOGIN` ที่ยังไม่ถูกใช้ค้างอยู่ของอีเมลนั้น (`resend: true`) กรณี 409 ไม่มีแถว

| ช่อง | ค่า |
|---|---|
| actor | **แถวนิรนาม** |
| subject | UA · บัญชีของอีเมลนั้น (ขา resend เป็น null ถ้าค้นไม่เจอ) |
| organization_id | null |
| result | `SUCCESS` |
| before / after | null / null |

| metadata | ความหมาย | ตัวอย่าง |
|---|---|---|
| `resend` | กดขอรหัสใหม่หรือไม่ | `false` |
| `otp_code_id` | id ของแถว `iam.otp_code` ใหม่ | `"b1e0c7d2-…"` |
| `expires_at` | now + `OTP_TTL_MINUTES` (ISO) | `"2026-09-29T03:15:00.000Z"` |

- **ข้อมูลส่วนบุคคล** ไม่มีอีเมล **ไม่มีตัวรหัสหรือ hash**
- ก่อนออกรหัสใหม่ `issueOtp()` ตั้ง `consumed_at` ให้ OTP `LOGIN` ที่ยังไม่ถูกใช้**ทุกใบ**ของอีเมลนั้น (`auth.ts:97-100`) การยกเลิกนี้**ไม่มีแถว**
  ผู้ที่กรอกรหัสใบเก่าหลังจากนั้นจึงได้ `OTP_INVALID` (เทียบกับรหัสใบใหม่) หรือ `OTP_NOT_PENDING` โดยไม่มีอะไรบอกว่าใบเก่าถูกยกเลิก
  ให้ดู `LOGIN_OTP_ISSUED` ใบใหม่ของบัญชีเดียวกันที่มาก่อน
- **ตัวอย่าง** `{"metadata": {"resend": false, "otp_code_id": "b1e0c7d2-4c1f-4a8e-9d2b-7f3e5a6c8d90", "expires_at": "2026-09-29T03:15:00.000Z"}}`
- **โค้ด** `routes/auth.ts:109` (`issueOtp()`, ผู้เรียก `:1037` และ `:1168`)

#### `PASSWORD_RESET_REQUESTED` — admin สั่งออกลิงก์ตั้งรหัสผ่านใหม่

**เกิดเมื่อ**
- `POST /api/admin/users/password-reset` `{email}` — มีบัญชีของอีเมลนั้นและ `ACTIVE` (400/404/409 ไม่มีแถว)

| ช่อง | ค่า |
|---|---|
| actor | **แถว admin** |
| subject | UA · บัญชีที่ลิงก์ออกให้ |
| organization_id | null |
| result | `SUCCESS` |
| before / after | null / null |

| metadata | ความหมาย | ตัวอย่าง |
|---|---|---|
| `email` | อีเมลของ**บัญชี**ที่ลิงก์ถูกส่งไป | `"somchai@agency.go.th"` |
| `password_reset_token_id` | id ของแถว `iam.password_reset_token` ใหม่ | `"6b1f0c2e-…"` |
| `expires_at` | now + `PASSWORD_RESET_TTL_MINUTES` (ISO) | `"2026-09-29T16:30:00.000Z"` |
| `requested_via` | `PASSWORD_RESET_VIA_ADMIN` | `"ADMIN_API"` |

- **ข้อมูลส่วนบุคคล** อีเมลของบัญชี (ไม่ปิด ทั้งใน Postgres และในสำเนา)
- เขียนก่อน `sendPasswordResetEmail()` ที่ส่ง inline — แถวนี้แปลว่าสั่งออก ไม่ใช่ส่งถึง · โทเคนเก่าที่ถูกเพิกถอนไปพร้อมกันไม่มีแถว
- **โค้ด** `routes/admin-users.ts:343`

#### `PASSWORD_RESET_COMPLETED` — ตั้งรหัสผ่านใหม่ผ่านลิงก์ (สำเร็จ หรือกดแล้วใช้ไม่ได้)

รหัสเดียวสองผล: `SUCCESS` = รหัสผ่านเปลี่ยนแล้ว · `FAILURE` = มีคนกดลิงก์แต่รหัสผ่าน**ไม่ได้**เปลี่ยน
คิวรีหา “ลิงก์ที่ไม่มีใครใช้” ต้องกรอง `result = 'SUCCESS'` เสมอ

**เกิดเมื่อ** (`POST /api/auth/password-reset`)
- โทเคนใช้ได้ บัญชี `ACTIVE` และ transaction เผาโทเคน เขียน `password_hash` และเพิกถอน session ทุกใบ → `SUCCESS`
- หาโทเคนที่ใช้ได้ไม่เจอ → `FAILURE` `not_found` · `used` · `revoked` · `expired`
- โทเคนใช้ได้แต่บัญชีไม่ `ACTIVE` → `FAILURE` `inactive`
- `updateMany` ในธุรกรรมได้ 0 แถว (เงื่อนไข `used_at IS NULL AND revoked_at IS NULL`) → `FAILURE` `used` — มีสองสาเหตุที่แถวแยกไม่ออก:
  อีกคำขอเผาโทเคนเดียวกันไปก่อนเสี้ยววินาที **หรือ**โทเคนถูกเพิกถอนระหว่างที่อ่านกับตอนเขียน เช่น admin ออกลิงก์ใหม่พอดี
  (`issuePasswordResetToken()` เพิกถอนใบที่ยังเปิดทุกใบ `lib/password-reset.ts:35-38`) ซึ่งควรเป็น `revoked` แต่ลงเป็น `used`

| ช่อง | `SUCCESS` | `FAILURE` |
|---|---|---|
| actor | `USER` = เจ้าของบัญชี (ส่ง `actorId` เอง) · มี snapshot | **แถวนิรนาม** |
| subject | UA · บัญชีของลิงก์ | UA · บัญชีของลิงก์ · null เมื่อ `not_found` |
| organization_id | null | null |
| before / after | null / null | null / null |

| metadata | ความหมาย | ตัวอย่าง |
|---|---|---|
| `password_reset_token_id` | id ของโทเคน (null เมื่อ `not_found`) | `"c4d2…"` |
| `requested_via` | *SUCCESS เท่านั้น* — ช่องทางที่ออกโทเคน | `"ADMIN_API"` |
| `sessions_revoked` | *SUCCESS เท่านั้น* — จำนวน session ที่ถูกปิด | `2` |
| `failure_reason` | *FAILURE เท่านั้น* — รหัสเดียวกับ `error` ที่ตอบไป | `"expired"` |

- **ข้อมูลส่วนบุคคล** id เท่านั้น (+ `actor_name` ในแถวสำเร็จ) ไม่มีข้อมูลรหัสผ่าน
- **ตัวอย่าง** `{"metadata": {"password_reset_token_id": "c4d2a9e1-…", "requested_via": "ADMIN_API", "sessions_revoked": 2}}`
- แถว `SESSION_REVOKED` `PASSWORD_CHANGED` ถูกเขียน**ก่อน**แถวนี้ จากในธุรกรรม (4.2) — เฉพาะเมื่อมี session ที่ยังเปิดอยู่
- หลังแถวนี้ route เรียก `resolveSession()` กับ cookie ที่เบราว์เซอร์ถือ (`auth.ts:971-973`) ถ้าเป็น cookie หมดอายุของ**บัญชีอื่น**
  (ของเจ้าของลิงก์ถูก `PASSWORD_CHANGED` ปิดไปแล้ว) ได้ `SESSION_REVOKED` `EXPIRED` ของบัญชีนั้นตามมาในคำขอเดียวกัน
- **โค้ด** `routes/auth.ts:954` (สำเร็จ) · `:905` (`resetFailed()`, ผู้เรียก `:916` `:921` `:949`)

#### `IDENTITY_VERIFICATION_STARTED` — พาผู้ใช้ออกไปยืนยันตัวตนที่ ThaID

คู่เปิดของ `IDENTITY_VERIFIED` / `..._FAILED`: คนที่ไปถึงหน้า ThaID แล้วปิดแท็บไม่เคยกลับมาที่ callback ไม่มีแถวนี้ก็ไม่เหลือร่องรอย
**ใน audit** (เหลือแค่แถว `integration_operation` ที่ค้าง `PENDING` ซึ่งสร้างตอน `/thaid/start` — `thaid-flow.ts:66-82`) ขา activate จับคู่
กับผลได้ด้วย `integration_operation_id` ส่วนขา login จับคู่ไม่ได้ (`LOGIN_SUCCEEDED`, `LOGIN_FAILED`)

**เกิดเมื่อ**
- `POST /api/auth/thaid/start` `{purpose, token?}` — ThaID ตั้งค่าไว้ · ขา `activate` ต้องมีคีย์ที่ใช้ได้และบัญชีมี `cid` · เขียนหลังสร้างแถว `integration_operation` (400/501/410/409 ไม่มีแถวนี้)

| ช่อง | ค่า |
|---|---|
| actor | **แถวนิรนาม** |
| subject | `INTEGRATION_JOB` · id ของแถว `integration.integration_operation` |
| organization_id | ขา activate = หน่วยงานของคีย์ · ขา login = null |
| result | `SUCCESS` |
| before / after | null / null |

| metadata | ความหมาย | ตัวอย่าง |
|---|---|---|
| `purpose` | ขาไหน | `"activate"` · `"login"` |
| `activation_key_id` | *activate เท่านั้น* | `"9a1f…"` |
| `user_account_id` | *activate เท่านั้น* — บัญชีของคีย์ | `"5c3e…"` |

- **ข้อมูลส่วนบุคคล** id เท่านั้น
- **ตัวอย่าง** `{"metadata": {"purpose": "activate", "activation_key_id": "9a1f…", "user_account_id": "5c3e…"}}`
- ขา activate อาจมี `ACTIVATION_KEY_EXPIRED` ของคำขอเดียวกันแทน ถ้าคีย์เพิ่งหมดอายุ (4.5)
- **โค้ด** `routes/auth.ts:289`

#### `IDENTITY_VERIFIED` — ThaID ยืนยันตัวตนผ่าน และเลขบัตรตรง

**เกิดเมื่อ**
- `POST /api/auth/thaid/callback` ขา activate — คีย์ยังใช้ได้และเลขบัตรจาก ThaID ตรงกับ `cid` ของบัญชี · เขียนหลัง `succeedThaidOperation()`

| ช่อง | ค่า |
|---|---|
| actor | **แถวนิรนาม** |
| subject | UAK · id ของคีย์ |
| organization_id | หน่วยงานของคีย์ |
| result | `SUCCESS` |
| before / after | null / null |

| metadata | ความหมาย | ตัวอย่าง |
|---|---|---|
| `user_account_id` | บัญชีของคีย์ | `"5c3e…"` |
| `thaid_subject` | `sub` ของ DOPA = **เลขบัตร 13 หลัก** | `"1234567890123"` |
| `integration_operation_id` | แถวของความพยายามนี้ | `"e7d4…"` |
| `cid_source` | claim ที่ใช้เทียบเลขบัตร (`THAID_USE_PID`) | `"pid"` · `"sub"` |

- **ข้อมูลส่วนบุคคล** **เลขบัตรเต็มใน `metadata` ไม่ถูกปิดใน Postgres** (`metadata` ไม่ผ่าน sanitize) — `sub` ของ DOPA
  คือเลขบัตร (`CLAUDE.md` Traps) คอมเมนต์ที่ `auth.ts:467` (บนแถว `CID_MISMATCH`) ที่ว่าไม่บันทึกเลขบัตรจึงผิด สำเนา Mongo ปิดให้
- **โค้ด** `routes/auth.ts:482` · ตามด้วย `USER_ACCOUNT_UPDATED` (`updated_via: THAID`) ถ้าชื่อบนบัตรต่างจากที่กรอกไว้

#### `IDENTITY_VERIFICATION_FAILED` — ความล้มเหลวของ callback ThaID

ครอบความล้มเหลวของ callback ทั้งสองขา**ที่ผ่าน `failThaidOperation()`** (ยกเว้น body ที่ไม่ผ่าน zod — 400 `validation` ไม่มีแถว `auth.ts:319-322` — และขา login
ที่ไม่พบบัญชี ซึ่งเขียนเป็น `LOGIN_FAILED` `THAID_NO_MATCHING_ACCOUNT` แทน) · **ไม่ครอบ** error ที่ throw ออกจาก callback หลัง `claimThaidState()` โดยไม่ผ่าน
hook นั้น — P2002 ของ `external_subject` ใน `userAccount.update` ของขา login (`auth.ts:617`) · Postgres ล้มใน `usableActivationKeyById()` หรือ `revokeActivationKey()`
— ตอบ 409/500 ผ่าน `index.ts` operation ค้าง `PROCESSING` และไม่มีทั้งแถวนี้และ `LOGIN_FAILED` (มีแค่ error event) · เขียนจาก
`logThaidFailure()` ผ่าน `failThaidOperation()` `failure_reason` จึงเป็นรหัสเดียวกับ `integration_operation.last_error_code` —
**ยกเว้น** แถว `CID_MISMATCH` ที่เขียนเอง และแถว `state_*` ที่ callback เขียนเอง (doc comment ของรหัสนับเป็นข้อยกเว้นเหมือนกัน
`audit.ts:328-330`): `state_not_found` ไม่มี operation เลย · `state_already_used` ชี้ operation ที่ `SUCCEEDED` แล้ว (`last_error_code` null)
`FAILED` แล้วด้วยรหัสอื่น หรือยัง `PROCESSING` · `state_expired` เขียน `last_error_code` ให้เฉพาะ operation ที่ยัง `PENDING` นอกนั้น
operation คงรหัสเดิมไว้ ข้อความอิสระจาก ThaID (`error_description`) **ไม่ถูกเก็บ** ในแถวนี้ (แต่ลง `last_error_message` หลังผ่าน `scrubText()` —
ถ้อยคำยังเป็นของผู้ยิง 5.6)

| `failure_reason` | เกิดเมื่อ (`POST /api/auth/thaid/callback`) | โค้ด |
|---|---|---|
| `state_not_found` · `state_expired` · `state_already_used` | หา `state` ไม่เจอ · หมดเวลา · ถูกใช้ไปแล้ว — ที่เดียวที่เขียน `state_*` อายุถูกตรวจ**ก่อน**สถานะ (`thaid-flow.ts:108-129`): เกิน `THAID_STATE_TTL_MINUTES` (ค่าตั้งต้น 15) แล้วได้ `state_expired` แม้ operation นั้นสำเร็จไปแล้ว · ก่อนนั้น `state_already_used` = operation ไม่ `PENDING` แล้ว ซึ่งอาจตามหลังความสำเร็จ ความล้มเหลว (`IDENTITY_VERIFICATION_FAILED` หรือ `LOGIN_FAILED`) ของความพยายามเดียวกัน หรือ callback อีกใบที่ยัง `PROCESSING` อยู่ | `auth.ts:329` |
| รหัสที่ส่งมาในช่อง `error` หลัง `trim()` + ตัวพิมพ์เล็ก ถ้าตรง `^[a-z][a-z_]{0,39}$` เก็บตามนั้น ไม่งั้น `thaid_error_unrecognised` | callback มี `error` — **ค่านี้ไม่ได้มาจาก ThaID โดยตรง** หน้า callback ของเบราว์เซอร์อ่านจาก query string แล้วส่งต่อ ใครที่มี `state` ของตัวเอง (เรียก `/thaid/start` ได้) ยิงค่าอะไรก็ได้ รหัสตัวพิมพ์เล็กยาวไม่เกิน 40 ตัวจึงถูกเก็บตามที่ส่ง (`thaid-flow.ts:158-176`) | `auth.ts:345` |
| `missing_code` | ไม่มีทั้ง `error` และ `code` | `auth.ts:356` |
| `network_error` · `http_<status>` · รหัส error ของ token endpoint · `no_id_token` · `jwks_unavailable` · `unknown_kid` · `invalid_id_token` · `nonce_missing` · `nonce_mismatch` · `unexpected` | แลก token หรือตรวจ id_token ไม่ผ่าน — `nonce_missing` เกิดเฉพาะเมื่อ `THAID_REQUIRE_NONCE=true` (ค่าตั้งต้น `false` ไม่งั้นแค่เตือนใน log แล้วไปต่อ `thaid.ts:308-316`) · `jwks_unavailable` เฉพาะเมื่อ JWKS ตอบ HTTP ไม่ ok ส่วนเครือข่ายล้มหรือ JSON เสียตอนดึง JWKS ออกมาเป็น `unexpected` (`fetch` ใน `fetchJwks()` ไม่ถูกห่อ `thaid.ts:220-223`) | `auth.ts:382` |
| `cid_unavailable` | ไม่มีเลขบัตรที่ผ่าน checksum ใน claim ที่เลือก | `auth.ts:415` |
| `key_not_found` · `key_used` · `key_revoked` · `key_expired` | ขา activate: คีย์ใช้ไม่ได้แล้ว — `key_expired` ที่คีย์เพิ่งเลยกำหนดมี `ACTIVATION_KEY_EXPIRED` นำหน้าในคำขอเดียวกัน (`usableActivationKeyById()` → `evaluateActivationKey()` `iam.ts:551-600`, เรียกที่ `auth.ts:440`) | `auth.ts:442` |
| `ambiguous_account` | ขา login: มีบัญชี `ACTIVE` หลายบัญชีที่ `cid` เดียวกัน | `auth.ts:608` |
| **`CID_MISMATCH`** (ตัวพิมพ์ใหญ่) | ขา activate: เลขบัตรไม่ตรงบัญชี — คีย์ถูกเพิกถอนโดย**ไม่มี** `ACTIVATION_KEY_REVOKED` แถวนี้คือหลักฐาน | `auth.ts:456` |

| ช่อง | ค่า |
|---|---|
| actor | **แถวนิรนาม** |
| subject | ขา activate: UAK · id ของคีย์ · ขา login: `INTEGRATION_JOB` · id ของ operation · `state_not_found`: `INTEGRATION_JOB` · null |
| organization_id | หน่วยงานของ operation (ขา login และ `state_not_found` = null) |
| result | `FAILURE` |
| before / after | null / null |

| metadata | ความหมาย | ตัวอย่าง |
|---|---|---|
| `failure_reason` | รหัสในตารางบน (ตัดที่ 64 ตัว) | `"nonce_mismatch"` |
| `purpose` | ขาไหน · null เมื่อหา operation ไม่เจอ · **ไม่มี**ในแถว `CID_MISMATCH` | `"activate"` |
| `integration_operation_id` | operation ของความพยายามนี้ หรือ null | `"e7d4…"` |
| `user_account_id` | *ขา activate เมื่อยังมีแถวคีย์* | `"5c3e…"` |
| `thaid_subject` | *`CID_MISMATCH` เท่านั้น* — เลขบัตรของคนที่สแกนบัตร (อาจไม่ใช่เจ้าของบัญชี) | `"1234567890123"` |

- **ข้อมูลส่วนบุคคล** id เท่านั้น ยกเว้น `thaid_subject` ของแถว `CID_MISMATCH` (เลขบัตรเต็ม ไม่ปิดใน Postgres)
- **ตัวอย่าง** `{"metadata": {"failure_reason": "key_expired", "purpose": "activate", "integration_operation_id": "e7d4…", "user_account_id": "5c3e…"}}`
- `state_already_used` ตามหลังผลใดก็ได้ของความพยายามเดียวกัน (`IDENTITY_VERIFIED` `LOGIN_SUCCEEDED` `IDENTITY_VERIFICATION_FAILED`
  `LOGIN_FAILED`) ถ้าผู้ใช้กด refresh ภายในอายุของ state หลังจากนั้นเป็น `state_expired` · callback สองใบที่มาพร้อมกันได้ใบหนึ่งทำงาน
  อีกใบ `state_already_used` ขณะที่ใบแรกยัง `PROCESSING`
- **โค้ด** `lib/thaid-flow.ts:246` (`logThaidFailure()`) · `routes/auth.ts:456` (CID_MISMATCH) — จุดที่ส่ง `audit: false`
  และไม่เขียนแถวจาก hook: `thaid-flow.ts:113` (`state_expired` ใน `claimThaidState()`), `auth.ts:453`, `auth.ts:590`
- แลก code / ตรวจ id_token ไม่ผ่านได้ error event `thaid.resolve-identity` ด้วย (warning สำหรับ `nonce_mismatch` `nonce_missing` นอกนั้น error) และ
  `cid_unavailable` ได้ `thaid:cid-unavailable:<claim>` — บรรทัด `[thaid] <code>` ใน log ของ container ไม่มีข้อความของ error แล้ว ดูบรรทัด `[capture]`
  ถัดไป (5.1)

---

### 4.2 หมวด session

#### `SESSION_REVOKED` — session ถูกเพิกถอน

เหตุผลอยู่ใน `metadata.reason` ไม่แยกเป็นรหัสคนละตัว มีสามฟังก์ชันใน `lib/session.ts` และหนึ่งแถวของ route
แถวของ helper เขียน**เฉพาะเมื่อปิดได้อย่างน้อยหนึ่งใบ** (`session.ts:176-193`) — ทุกลำดับในตารางอื่นที่มี `SESSION_REVOKED` นำหน้า
(ระงับ ยุติ แก้อีเมล/เลขบัตร ย้าย reset) จึงไม่มีแถวนี้เลยถ้าบัญชีเป้าหมายไม่มี session เปิดอยู่

| `reason` | เกิดเมื่อ | subject | actor | โค้ด |
|---|---|---|---|---|
| `EXPIRED` | มีคนยื่น cookie ของ session ที่เลย `expires_at` (ABSOLUTE) หรือว่างเกิน `SESSION_IDLE_HOURS` (IDLE) — ผ่าน `requireAuth` ทุก route, `/logout`, `/password-reset`, `issueSession()` | `SESSION` · id ของแถว session | `USER` = เจ้าของ session | `session.ts:115` |
| `LOGOUT` | `POST /api/auth/logout` กับ session ที่ยังใช้ได้ | `SESSION` | `SYSTEM` (null) | `session.ts:147` ← `auth.ts:1188` |
| `ROTATED` | ออก session ใหม่ขณะเบราว์เซอร์ถือ cookie ที่ยังใช้ได้ (verify-otp, `/activate`, ThaID login) | `SESSION` · **ใบเก่า** | `SYSTEM` (null) | `session.ts:147` ← `auth.ts:1352` |
| `LOGOUT_ALL` | `POST /api/auth/logout-all` | UA | `USER` = เจ้าของบัญชี | `session.ts:182` ← `auth.ts:1196` |
| `PASSWORD_CHANGED` | `POST /api/auth/password-reset` สำเร็จ — **ในธุรกรรม** | UA | `USER` = เจ้าของบัญชี (ทั้งที่ผู้ยิงถือแค่ลิงก์) | `session.ts:182` ← `auth.ts:942` |
| `ACCOUNT_SUSPENDED` | `requireAuth` พบบัญชีหายหรือไม่ `ACTIVE` | UA | `USER` = บัญชีนั้น | `session.ts:182` ← `middleware/auth.ts:93` |
| `ACCOUNT_SUSPENDED` | admin `suspend` · `deactivate` · reset คำขอหน่วยงานที่ถอดผู้มีอำนาจฯ — **ในธุรกรรม** | UA | `USER` = **บัญชีเป้าหมาย** + `admin_token_fp` | `session.ts:182` ← `admin-users.ts:747` `:855` · `admin-registrations.ts:475` |
| `ROTATED` | admin `identity` เมื่อ `diffFields()` ไม่ว่าง — ซึ่ง**รวมการส่งมาช่องเดียวแม้ค่าเท่าเดิม** (ช่องที่ไม่ได้ส่งถูกเทียบเป็น null กับค่าในบัญชี ดูข้อบกพร่องใน 4.3) ไม่เข้าทางนี้แค่เมื่อส่งมาครบทั้งสองช่องและไม่เปลี่ยน (หรือส่งแค่อีเมลเท่าเดิมให้บัญชีที่ไม่มีเลขบัตร) · `transfer` — **ในธุรกรรม** | UA | `USER` = บัญชีเป้าหมาย + `admin_token_fp` | `session.ts:182` ← `admin-users.ts:622` `:1422` |
| `LOGOUT_ALL` | admin `DELETE /api/admin/users/:id/sessions` (แถวของ helper) | UA | `USER` = บัญชีเป้าหมาย + `admin_token_fp` | `session.ts:182` ← `admin-users.ts:988` |
| `LOGOUT_ALL` | route เดียวกัน — **แถวที่สอง** ของ route เขียน**ทุกครั้ง** แม้ปิดได้ 0 ใบ | UA | **แถว admin** | `admin-users.ts:993` |

| ช่อง | ค่า |
|---|---|
| organization_id | null ทุกแบบ |
| result | `SUCCESS` |
| before / after | null / null |

| metadata | มีในแบบ | ความหมาย | ตัวอย่าง |
|---|---|---|---|
| `reason` | ทุกแบบ | `SessionRevokeReason` | `"EXPIRED"` |
| `session_count` | ทุกแบบยกเว้นแถว route | จำนวนใบที่ปิด (EXPIRED/LOGOUT/ROTATED ใบเดียว = 1) | `2` |
| `expiry_kind` | `EXPIRED` | ชนิดของการหมดอายุ | `"IDLE"` · `"ABSOLUTE"` |
| `user_account_id` | `LOGOUT` · `ROTATED` จาก `revokeSession()` | เจ้าของ session — ที่เดียวที่บอกว่าใคร เพราะ `actor_id` เป็น null | `"9d0f…"` |
| `kept_session_id` | แถวของ `revokeSessionsFor()` | ใบที่ละไว้ · ไม่มีใครส่งมา จึงเป็น null เสมอ | `null` |
| `admin_reason` | แถว route `:993` | เหตุผลที่ admin พิมพ์ | `"สงสัยว่า session ถูกขโมย"` |
| `revoked_via` | แถว route `:993` | ช่องทาง | `"ADMIN_API"` |

- **ข้อมูลส่วนบุคคล** id ของบัญชี · `actor_name` ของเจ้าของ session · `admin_reason` เป็นข้อความอิสระ
- **ตัวอย่าง** `{"metadata": {"reason": "EXPIRED", "expiry_kind": "IDLE", "session_count": 1}}` ·
  `{"metadata": {"reason": "LOGOUT", "session_count": 1, "user_account_id": "9d0f5a2c-…"}}`
- ข้อควรรู้ (รายละเอียด 6.2): actor ของแถวที่ admin สั่งคือ**ผู้ถูกกระทำ** · `ROTATED` อาจเป็น session ของ**คนอื่น**
  ที่ใช้เบราว์เซอร์เครื่องเดียวกัน · `EXPIRED` ซ้ำได้เมื่อหลายคำขอยื่น cookie เก่าพร้อมกัน (update ไม่มีเงื่อนไข
  `revoked_at IS NULL`) · session ที่หมดอายุโดยไม่มีใครยื่นอีกไม่มีแถว · logout ด้วย cookie ที่หมดอายุแล้วได้แถว
  `EXPIRED` ไม่ใช่ `LOGOUT` · การค้นด้วย `actor_id` ไม่เจอ logout ของตัวเอง ต้องดู `metadata.user_account_id`

---

### 4.3 หมวด account — บัญชีผู้ใช้

#### `USER_ACCOUNT_CREATED` — สร้างบัญชี `PENDING` ให้คนที่ถูกเชิญ

บัญชีนี้ยึดอีเมลและเลขบัตรไว้ตั้งแต่ตอนเชิญ (unique ทั้งคู่) `after` คือค่าตอนสร้าง เลขบัตรผ่าน `sanitizeState()` ทั้งสองจุด

**เกิดเมื่อ**
- `POST /api/admin/invitations` — หลังธุรกรรมที่สร้างบัญชี `PENDING` และออกคีย์ commit (400/404/409 ไม่มีแถว)
- `POST /api/organizations/:id/review` — ผู้ประสานงาน BDI กดผ่านด่าน `BDI_OFFICER_REVIEW` และยังไม่มีบัญชีของ `approverEmail`

| ช่อง | admin invitation | review |
|---|---|---|
| actor | **แถว admin** | **แถว session** = ผู้ประสานงาน BDI |
| subject | UA · บัญชีใหม่ | UA · บัญชีใหม่ |
| organization_id | หน่วยงานของคำเชิญ (role ของ BDI = หน่วยงาน BDI) | หน่วยงานของคำขอ |
| result | `SUCCESS` | `SUCCESS` |
| before / after | null / `{email, cid, displayName, accountType, status: "PENDING"}` | เหมือนกัน (`accountType: "ORGANIZATION"`) |

| metadata | ความหมาย | ตัวอย่าง |
|---|---|---|
| `created_via` | ช่องทาง | `"ADMIN_API"` · `"REVIEW_API"` |
| `activation_key_id` | คีย์ที่ออกพร้อมบัญชี | `"8d1c…"` |
| `role` | role ที่เชิญ | `"ORGANIZATION_APPROVER"` |
| `request_number` | *review เท่านั้น* | `"ORG-REG-2026-0004"` |

- **ข้อมูลส่วนบุคคล** อีเมลและชื่อ (`displayName` อาจเป็น `""`) ไม่ปิด · เลขบัตรเหลือ 4 ตัวท้าย
- **ตัวอย่าง** `{"after": {"email": "approver@agency.go.th", "cid": {"masked": "xxxxxxxxx4821", "changed": true}, "displayName": "นาย ผู้มีอำนาจ ตัวอย่าง", "accountType": "ORGANIZATION", "status": "PENDING"}, "metadata": {"created_via": "REVIEW_API", "request_number": "ORG-REG-2026-0004", "activation_key_id": "8d1c…", "role": "ORGANIZATION_APPROVER"}}`
- ตามด้วย `ACTIVATION_KEY_ISSUED` เสมอ · ขา admin เขียนก่อนอีเมลเชิญ inline ถ้า SMTP ล้ม ตอบ 500 แต่แถวอยู่แล้ว
- ถ้าบัญชีนี้ถูกลบภายหลัง (`INVITATION_DELETED`, `APPROVER_INVITATION_RECALLED` ที่ `accountDeleted: true`) แถวลบเหล่านั้นไม่มี id ของบัญชี
  ต่อเรื่องได้ด้วยอีเมลหรือเลขบัตรเท่านั้น — แถวของรหัสนี้เก็บเลขบัตรแบบปิดแล้วทั้งสองจุด จับกับ `before.cid` เต็มของแถวลบได้แค่ 4 ตัวท้าย
  (`ACTIVATION_KEY_ISSUED` ขา admin ยังเก็บเต็ม ใช้แทนได้ — 4.5)
- **โค้ด** `routes/admin.ts:848` · `routes/organizations.ts:2748`

#### `USER_ACCOUNT_ACTIVATED` — เปิดใช้งานบัญชี

**เกิดเมื่อ**
- `POST /api/auth/activate` — คีย์ใช้ได้ มีใบเสร็จการยืนยัน ThaID ชื่อไม่ว่าง และธุรกรรมเปิดบัญชี commit

| ช่อง | ค่า |
|---|---|
| actor | `USER` = บัญชีที่เปิด (ส่ง `actorId` เอง) · snapshot เห็นชื่อและ role ที่เพิ่ง commit |
| subject | UA · บัญชีนั้น |
| organization_id | หน่วยงานของคีย์ |
| result | `SUCCESS` |
| before / after | null / null |

| metadata | ความหมาย | ตัวอย่าง |
|---|---|---|
| `method` | ช่องทางยืนยันตัวตน | `"THAID"` |
| `activation_key_id` | คีย์ที่ใช้ | `"9a1f…"` |

- **ข้อมูลส่วนบุคคล** `actor_name` · โปรไฟล์ที่เขียนในธุรกรรม (ชื่อ เบอร์โทร รหัสผ่าน `external_subject`) **ไม่ถูกบันทึก**
- **ไม่ได้แปลว่า PENDING → ACTIVE เสมอ** — `/activate` ปฏิเสธแค่บัญชีที่ `ACTIVE` อยู่แล้ว (`auth.ts:685`) และ
  `POST /api/admin/invitations/:id/resend` ก็ปฏิเสธแค่ `ACTIVE` (`admin.ts:992`) บัญชีที่ `SUSPENDED` หรือ `DEACTIVATED` จึงได้คีย์ใหม่
  ด้วย resend ผ่าน ThaID แล้ว `completeActivation()` ตั้งเป็น `ACTIVE` (`iam.ts:687-695`) ได้แถวนี้ที่ before/after เป็น null ไม่ใช่
  `USER_ACCOUNT_REINSTATED` หรือ `REACTIVATED` — แถวไม่บอกสถานะก่อนหน้า ต้องดูแถวสถานะล่าสุดของบัญชีเดียวกัน (ในกรณีนั้น `before.status`
  ของ `ACTIVATION_KEY_ISSUED` ขา resend อาจเป็น `"USED"`)
- **โค้ด** `routes/auth.ts:786`

#### `USER_ACCOUNT_UPDATED` — แก้ข้อมูลบัญชี

สามแบบ ไม่มีแบบไหนแก้อีเมลและเลขบัตรพร้อมโปรไฟล์ในแถวเดียวกัน

| แบบ | เกิดเมื่อ | actor | organization_id | before / after | metadata |
|---|---|---|---|---|---|
| โปรไฟล์ | `PATCH /api/admin/users/:id` — มีช่องที่เปลี่ยนจริง (ไม่เปลี่ยน = 200 `changed:false` ไม่มีแถว) | **แถว admin** | null | `diffFields()` ของ `prefixTh` `firstnameTh` `lastnameTh` `displayName` `phoneNumber` `phoneNumberExtension` `positionTh` `departmentTh` เฉพาะช่องที่เปลี่ยน | `updated_via: "ADMIN_API"` |
| อีเมล/เลขบัตร | `POST /api/admin/users/:id/identity` `{email?, cid?, reason}` — ไม่ชนบัญชีอื่น และ diff ไม่ว่าง | **แถว admin** | null | `diffFields(account, {email, cid})` **ดิบ ไม่ผ่าน sanitize** | `updated_via: "ADMIN_API"` · `identity_change: true` · `reason` |
| ชื่อจากบัตร | `POST /api/auth/thaid/callback` ขา activate — ชื่อบนบัตรต่างจากที่กรอกไว้ | **แถวนิรนาม** | หน่วยงานของคีย์ | `sanitizeDiff(diffFields())` ของ `prefixTh` `firstnameTh` `lastnameTh` | `updated_via: "THAID"` · `integration_operation_id` |

| ช่อง | ค่า |
|---|---|
| subject | UA · บัญชีนั้น |
| result | `SUCCESS` |

- **ข้อมูลส่วนบุคคล** ชื่อ เบอร์โทร ตำแหน่ง หน่วยงาน ก่อนและหลัง ไม่ปิด · แบบอีเมล/เลขบัตร**เก็บเลขบัตรเต็มทั้งเก่าและใหม่**
  (สำเนา Mongo ปิดให้) · `reason` เป็นข้อความอิสระ
- **ข้อบกพร่องของแบบอีเมล/เลขบัตร** `{email, cid}` มีสองคีย์เสมอ ช่องที่ไม่ได้ส่ง (`undefined` → เทียบเป็น null)
  จึงนับว่า “เปลี่ยน” ถ้าบัญชีมีค่า: ส่งแค่อีเมลได้ `before: {email: เก่า, cid: เลขบัตรปัจจุบัน}` `after: {email: ใหม่}`
  และส่งค่าเดิมมาช่องเดียวได้ `after: {}` ขณะที่ route ยังเพิกถอน session ทุกใบ
- **ตัวอย่าง** `{"before": {"firstnameTh": "สมชาย"}, "after": {"firstnameTh": "สมชัย"}, "metadata": {"updated_via": "THAID", "integration_operation_id": "e7d4…"}}`
- **โค้ด** `routes/admin-users.ts:533` (โปรไฟล์) · `:629` (อีเมล/เลขบัตร ตามหลัง [`SESSION_REVOKED` ROTATED ในธุรกรรม] ถ้าบัญชีมี session เปิดอยู่) · `routes/auth.ts:536` (ชื่อจากบัตร)

#### `USER_IDENTITY_RELEASED` — ปล่อยอีเมลของบัญชีให้ใช้ใหม่

กล่องจดหมายกลางเปลี่ยนมือ `before` เก็บอีเมลเดิมเพราะหลังจากนี้แถวบัญชีไม่มีมันแล้ว **เลขบัตรไม่มีทางถูกปล่อย**

**เกิดเมื่อ**
- `POST /api/admin/users/:id/release-identity` `{releaseEmail: true, reason}` — บัญชี `DEACTIVATED`

| ช่อง | ค่า |
|---|---|
| actor | **แถว admin** |
| subject | UA · บัญชีนั้น |
| organization_id | null |
| result | `SUCCESS` |
| before / after | `{email: <เดิม>}` / `{email: "released+<account id>@invalid.local"}` |

| metadata | ความหมาย | ตัวอย่าง |
|---|---|---|
| `released_via` | ช่องทาง | `"ADMIN_API"` |
| `reason` | เหตุผลที่ admin พิมพ์ (10–500 ตัว) | `"อีเมลกลางของฝ่ายส่งต่อให้เจ้าหน้าที่คนใหม่"` |
| `cid_retained` | ค่าคงที่ | `true` |

- **ข้อมูลส่วนบุคคล** อีเมลเดิม (ไม่ปิด) · `reason`
- ไม่มีตัวกันการปล่อยซ้ำ: ปล่อยบัญชีที่ปล่อยแล้วได้แถวที่ `before.email` เท่ากับ `after.email`
- **โค้ด** `routes/admin-users.ts:685`

#### `USER_ACCOUNT_SUSPENDED` · `USER_ACCOUNT_REINSTATED` · `USER_ACCOUNT_REACTIVATED` — ระงับ · คืนสถานะ · เปิดบัญชีที่ยุติกลับมา

ทั้งสามเป็น**แถว admin** subject UA · บัญชีนั้น · organization_id null · `SUCCESS`

| รหัส | เกิดเมื่อ | before → after | metadata |
|---|---|---|---|
| `USER_ACCOUNT_SUSPENDED` | `POST /api/admin/users/:id/suspend` `{reason}` — บัญชี `ACTIVE` และไม่ใช่ผู้ถือ role ของ BDI คนสุดท้าย | `{status: "ACTIVE"}` → `{status: "SUSPENDED"}` | `reason` · `suspended_via: "ADMIN_API"` |
| `USER_ACCOUNT_REINSTATED` | `POST /api/admin/users/:id/reinstate` (ไม่มี body) — บัญชี `SUSPENDED` | `{status: "SUSPENDED", suspensionReason}` → `{status: "ACTIVE"}` | `reinstated_via: "ADMIN_API"` (**ไม่มี** `reason`) |
| `USER_ACCOUNT_REACTIVATED` | `POST /api/admin/users/:id/reactivate` `{reason}` — บัญชี `DEACTIVATED` และอีเมลไม่ลงท้าย `@invalid.local` | `{status: "DEACTIVATED"}` → `{status: "ACTIVE"}` | `reason` · `reactivated_via: "ADMIN_API"` |

- **ข้อมูลส่วนบุคคล** `reason` และ `suspensionReason` เป็นข้อความอิสระที่อาจเอ่ยชื่อคน
- การระงับไม่ถอน role จึงไม่มี `ROLE_REVOKED` แต่มี [`SESSION_REVOKED` `ACCOUNT_SUSPENDED` ในธุรกรรม] ก่อนแถวนี้ถ้าบัญชีมี session
  เปิดอยู่ · การเปิดกลับไม่คืน role (ต้องมอบใหม่ผ่าน `POST /:id/roles`)
- ทั้งสาม route อ่านสถานะก่อนแล้วค่อย update ด้วย id **โดยไม่มีเงื่อนไขสถานะใน UPDATE** (`admin-users.ts:715`/`:735` · `:773`/`:784`
  · `:911`/`:928`) — จากการอ่านโค้ด ยังไม่ได้ลองยิงจริง: สองคำขอเหมือนกันที่มาพร้อมกันผ่านการตรวจทั้งคู่และได้แถวซ้ำสองแถว
  กติกา “หนึ่งการเปลี่ยนหนึ่งแถว” เป็นจริงเฉพาะที่ใช้ `UPDATE … RETURNING` หรือ `updateMany` ที่มีเงื่อนไข (คีย์ session โทเคน)
- **ตัวอย่าง** `{"before": {"status": "ACTIVE"}, "after": {"status": "SUSPENDED"}, "metadata": {"reason": "สงสัยว่าบัญชีถูกใช้งานโดยบุคคลอื่น", "suspended_via": "ADMIN_API"}}`
- **โค้ด** `routes/admin-users.ts:754` · `:796` · `:938`

#### `USER_ACCOUNT_DEACTIVATED` — ยุติบัญชี

(คอมเมนต์กลุ่มใน `audit.ts:43` ที่ว่า “มีอยู่ก่อนแล้วแต่ไม่มีใครเขียน” ล้าสมัยแล้ว — วันนี้มีสองจุดเขียน)

**เกิดเมื่อ**
- `POST /api/admin/users/:id/deactivate` `{reason}` — บัญชีไม่ใช่ `DEACTIVATED` และไม่ใช่ผู้ถือ role ของ BDI คนสุดท้าย
- `POST /api/admin/registrations/organizations/:id/reset` — มีผู้มีอำนาจฯ ที่เปิดบัญชีแล้ว **และ** `isRemoveApprover: true`

| ช่อง | `/users/:id/deactivate` | registration reset |
|---|---|---|
| actor | **แถว admin** | **แถว admin** |
| subject | UA · บัญชีนั้น | UA · บัญชีผู้มีอำนาจฯ |
| organization_id | null | หน่วยงานของคำขอ |
| before / after | `{status, email, cid}` / `{status: "DEACTIVATED"}` | `{status: "ACTIVE", email}` / `{status: "DEACTIVATED"}` |

| metadata | ความหมาย | ตัวอย่าง |
|---|---|---|
| `reason` | เหตุผลที่ admin พิมพ์ | `"ลาออกจากหน่วยงาน มีผลวันที่ 30 ก.ย. 2569"` |
| `deactivated_via` | ช่องทาง | `"ADMIN_API"` · `"ADMIN_RESET_API"` |
| `roles_revoked` | จำนวน `ROLE_REVOKED` ที่ถอนไปในธุรกรรม | `1` |
| `request_number` | *registration reset เท่านั้น* | `"ORG-REG-2026-0001"` |

- **ข้อมูลส่วนบุคคล** อีเมล · **เลขบัตรเต็มใน `before` ของ `/users/:id/deactivate`** (ไม่ปิดใน Postgres) · `reason`
- **โค้ด** `routes/admin-users.ts:871` · `routes/admin-registrations.ts:565`

---

### 4.4 หมวด role — บทบาท

#### `ROLE_ASSIGNED` — มอบบทบาท

subject **ไม่สม่ำเสมอ**: สองจุดที่ยังเขียนอยู่ (activate · review) ชี้แถว assignment (URA) เช่นเดียวกับแถวเก่าของทางเปิดหน่วยงานที่ถอดแล้ว อีกสองจุดของ
admin ชี้**บัญชี** (UA) และไม่บันทึก id ของ assignment

| จุด | เกิดเมื่อ | actor | subject | before / after | metadata |
|---|---|---|---|---|---|
| activate | `POST /api/auth/activate` — `assignRole` สร้าง assignment ใหม่จริง (มีอยู่แล้ว = ไม่มีแถว) | `USER` = บัญชีที่เปิด | URA | null / `{userAccountId, role, organizationId}` | `assigned_via: "ACTIVATION"` · `activation_key_id` · `replaced` |
| เปิดหน่วยงาน | **ถอดแล้วที่ `7259c09`** — แถวเก่าเท่านั้น: `POST /api/organizations` ทางหน่วยงานใหม่ | **แถว session** (ผู้ใช้ = ผู้รับ role) | URA | null / เหมือนข้างบน (`ORGANIZATION_USER`) | `assigned_via: "ORGANIZATION_CREATED"` · `request_number` · `replaced` |
| review | `POST /api/organizations/:id/review` ผ่านด่าน `BDI_OFFICER_REVIEW` และผู้มีอำนาจฯ มีบัญชี `ACTIVE` แล้ว และ `assignRole` สร้าง assignment ใหม่จริง — ผู้มีอำนาจฯ ที่ถือ `ORGANIZATION_APPROVER` ของหน่วยงานนี้อยู่แล้ว (เช่นผ่านด่านแรกรอบที่สองหลังคำขอถูกส่งกลับ) = `created: false` ไม่มีแถว (`organizations.ts:3150` `:2787`) | **แถว session** = ผู้ประสานงาน BDI | URA | null / เหมือนข้างบน (`ORGANIZATION_APPROVER`) | `assigned_via: "REVIEW_API"` · `request_number` · `replaced` |
| admin มอบ | `POST /api/admin/users/:id/roles` `{role, organizationId?, reason}` | **แถว admin** | **UA** | null / `{role, organizationId}` | `reason` · `assigned_via: "ADMIN_API"` · `replaced` |
| admin ย้าย | `POST /api/admin/users/:id/transfer` `{organizationId, role, reason}` | **แถว admin** | **UA** | `{organizationIds: [...]}` / `{organizationId, role}` | `reason` · `transferred_via: "ADMIN_API"` · `requests_reverted_to_draft` · `replaced` |

| ช่อง | ค่า |
|---|---|
| organization_id | หน่วยงานที่ได้ role (role ของ BDI = หน่วยงาน BDI `…0000b0`) |
| result | `SUCCESS` |

| metadata | ความหมาย | ตัวอย่าง |
|---|---|---|
| `assigned_via` / `transferred_via` | ช่องทาง | `"REVIEW_API"` |
| `replaced` | จำนวนผู้ถือที่นั่งเดิม (บัญชีไม่ `ACTIVE`) ที่ถูกถอนเพื่อเปิดทาง | `0` |
| `activation_key_id` | *activate* | `"9a1f…"` |
| `request_number` | *เปิดหน่วยงาน · review* | `"ORG-REG-2026-0012"` |
| `reason` | *admin* — ข้อความที่พิมพ์ | `"ได้รับแต่งตั้งตามหนังสือที่ …"` |
| `requests_reverted_to_draft` | *admin ย้าย* — เลขที่คำขอที่ถูกดันกลับเป็นร่าง | `["ORG-REG-2026-0002"]` |

- `before.organizationIds` ของการย้ายคือหน่วยงานของ assignment **ระดับหน่วยงาน** (`ORGANIZATION_USER` `ORGANIZATION_APPROVER`) ที่ยังใช้ได้
  ไม่รวมปลายทาง (`admin-users.ts:136-150` `:1357-1360`) `[]` แปลว่าแค่ “ไม่มี role ระดับหน่วยงานที่อื่น” ซึ่งเป็นได้ทั้งการเปลี่ยนบทบาทอยู่กับที่
  **และ**การย้ายเจ้าหน้าที่ BDI (`BDI_OFFICER` `BDI_FINAL_APPROVER` …) หรือบัญชีที่ไม่มี role เข้าหน่วยงาน เพราะธุรกรรมถอน**ทุก** role
  รวมของ BDI (`:1408-1412`) role เดิมทั้งหมด**ไม่อยู่ในแถวนี้** ต้องดู `ROLE_REVOKED` รูปแบบ A ที่ correlation id เดียวกัน
- **ข้อบกพร่องของ admin มอบ** มอบ (role, หน่วยงาน) ที่ผู้ใช้ถืออยู่แล้วซ้ำ: `assignRole` คืน `created: false` แต่ route
  ยังเขียนแถวนี้ (และแจ้งเตือน)
- **ข้อมูลส่วนบุคคล** id เท่านั้น + `reason` ของ admin
- **ตัวอย่าง** `{"after": {"userAccountId": "5c3e…", "role": "ORGANIZATION_APPROVER", "organizationId": "2c8e…"}, "metadata": {"assigned_via": "REVIEW_API", "request_number": "ORG-REG-2026-0004", "replaced": 0}}`
- **โค้ด** `routes/auth.ts:808` · `routes/organizations.ts:2788` · `routes/admin-users.ts:1223` · `:1430` · ทาง WEB_FORM ที่ถอดแล้วอยู่ที่ `organizations.ts:1175` ของ `2cab0a7`

#### `ROLE_REVOKED` — เพิกถอนบทบาท

สามรูปแบบจากสามที่ รูปแบบ A กับ B **ซ้อนกันได้**: การแทนที่ผู้ถือที่นั่งหนึ่งครั้งบนบางเส้นทางได้สองแถว (6.2)

| รูปแบบ | ที่เขียน | เวลา | actor | before / after | metadata |
|---|---|---|---|---|---|
| **A** `revokeRoleAssignments()` | `lib/iam.ts:380` หนึ่งแถวต่อ assignment | **ในธุรกรรม** | `USER` ด้วย `actorId` ที่ส่งมา (ดูข้างล่าง) | `{userAccountId, roleId, status: "ACTIVE"}` / `{status: "REVOKED"}` — `roleId` เป็น **uuid ของแถว role** ไม่ใช่รหัส | `reason` |
| **B** `announceRoleReplacement()` | `lib/notify.ts:194` | หลัง commit | จาก context: `SYSTEM` บน `/activate` · ผู้ใช้ของ session บนเส้นทางหน่วยงาน | null / null | `reason: "REPLACED_BY_NEW_HOLDER"` · `role_code` · `revoked_user_account_id` |
| **C** route | `routes/admin-users.ts:1279` | หลัง update | **แถว admin** | `{userAccountId, role: <รหัส>, status: "ACTIVE"}` / `{status: "REVOKED"}` | `reason` · `revoked_via: "ADMIN_API"` |

**เกิดเมื่อ** — รูปแบบ A ถอนตรง (ทุก assignment `ACTIVE` ของบัญชี `reason` = ที่ admin พิมพ์ actor = `SYSTEM_USER_ID`):
- `POST /api/admin/users/:id/deactivate` (`admin-users.ts:844`)
- `POST /api/admin/users/:id/transfer` ถอนทุก role ก่อนมอบใหม่ (`:1408`)
- `POST /api/admin/registrations/organizations/:id/reset` เมื่อผู้มีอำนาจฯ เปิดบัญชีแล้วและ `isRemoveApprover: true` (`admin-registrations.ts:465`) — ถอนทุก role ของบัญชีนั้น ทุกหน่วยงาน

รูปแบบ A แทนที่ที่นั่ง (ผ่าน `assignRole()` `iam.ts:227` · `reason` = `"มีผู้รับผิดชอบคนใหม่แทน"` · เฉพาะเมื่อผู้ถือเดิมบัญชีไม่ `ACTIVE`):
- `POST /api/auth/activate` (actor = บัญชีที่กำลังเปิด) — ตามด้วยรูปแบบ B
- `POST /api/organizations/:id/review` ผ่านด่านแรกกับผู้มีอำนาจฯ ที่บัญชี **`ACTIVE`** แล้ว (`organizations.ts:3140-3150`, actor = `SYSTEM_USER_ID`)
  — ตามด้วยรูปแบบ B · บัญชีที่มีอยู่แต่ `PENDING` `SUSPENDED` หรือ `DEACTIVATED` ไปทาง `issueActivationKey()` (`:3151-3159`) ซึ่งไม่เรียก
  `assignRole` จึงไม่มีทั้งรูปแบบ A และ B
- **ถอดแล้วที่ `7259c09`** `POST /api/organizations` (`:1133` ของ `2cab0a7`, actor = ผู้ใช้) — ตามด้วยรูปแบบ B (`:1146` เขียนก่อน `ORGANIZATION_CREATED`) หน่วยงานเพิ่งสร้าง
  ในทางปฏิบัติไม่เกิด
- `POST /api/admin/users/:id/roles` (`admin-users.ts:1215`) และ `/transfer` (`:1414`) — actor = `SYSTEM_USER_ID` **ไม่มี**รูปแบบ B และผู้ถูกแทนไม่ได้รับแจ้ง
- `seed:demo` (`scripts/seed-demo.ts:103`)

รูปแบบ C: `DELETE /api/admin/users/:id/roles/:assignmentId` `{reason}` — assignment เป็นของบัญชีนั้นและยังใช้ได้ route ค้นแล้ว update
ด้วย id โดยไม่มีเงื่อนไขสถานะ (`admin-users.ts:1259-1287`) — จากการอ่านโค้ด ยังไม่ได้ลอง: สองคำขอพร้อมกันได้รูปแบบ C ซ้ำสองแถว

| ช่อง | ค่า |
|---|---|
| subject | URA · id ของ assignment ที่ถูกถอน |
| organization_id | หน่วยงานของ assignment นั้น (อาจต่างจากหน่วยงานของคำขอ · แถวเก่าอาจเป็น null) |
| result | `SUCCESS` |

| metadata | ความหมาย | ตัวอย่าง |
|---|---|---|
| `reason` | A: ข้อความของ admin หรือ `ROLE_REPLACED_REASON` · B: รหัส · C: ข้อความของ admin | `"มีผู้รับผิดชอบคนใหม่แทน"` |
| `role_code` | *B* — รหัส role ที่ถูกถอน | `"ORGANIZATION_APPROVER"` |
| `revoked_user_account_id` | *B* — คนที่เสีย role (subject เป็น assignment ไม่ใช่คน) | `"2e7b…"` |
| `revoked_via` | *C* | `"ADMIN_API"` |

- **ข้อมูลส่วนบุคคล** id ของผู้ถือ · `reason` ของ admin · `actor_name` ของ `SYSTEM_USER_ID` คืออีเมลของบัญชีระบบ
- **ตัวอย่าง (A)** `{"before": {"userAccountId": "7f10…", "roleId": "3b9c…", "status": "ACTIVE"}, "after": {"status": "REVOKED"}, "metadata": {"reason": "มีผู้รับผิดชอบคนใหม่แทน"}}`
- **ตัวอย่าง (B)** `{"metadata": {"reason": "REPLACED_BY_NEW_HOLDER", "role_code": "ORGANIZATION_APPROVER", "revoked_user_account_id": "7f10…"}}`
- `revokeRoleAssignments` กรองแค่ `status = ACTIVE` ไม่ดู `effective_until` assignment ที่หมดวันแล้วจึงถูกถอนและบันทึกด้วย

---

### 4.5 หมวด invitation — คำเชิญและคีย์เปิดใช้งาน

#### `ACTIVATION_KEY_ISSUED` — ออกคีย์เปิดใช้งาน

**เกิดเมื่อ**
- `POST /api/admin/invitations` — ตามหลัง `USER_ACCOUNT_CREATED` เงื่อนไขเดียวกัน (`reason: INVITATION`)
- `POST /api/admin/invitations/:id/resend` — คีย์มีอยู่ บัญชีไม่ใช่ `ACTIVE` (รวม `SUSPENDED` และ `DEACTIVATED` — 4.3) ที่นั่งว่าง และ**ไม่มีคำเชิญของคนอื่น**
  ที่ยังไม่หมดอายุค้างอยู่ในที่นั่งเดียวกัน (มี = 409 `invitation_pending` ไม่มีแถว `admin.ts:1031-1047`) (`reason: RESEND`)
- `POST /api/organizations/:id/review` — ผ่านด่าน `BDI_OFFICER_REVIEW` และบัญชีผู้มีอำนาจฯ ยังไม่ `ACTIVE` (`reason: APPROVER_INVITATION`)

| ช่อง | invitation | resend | review |
|---|---|---|---|
| actor | **แถว admin** | **แถว admin** | **แถว session** = ผู้ประสานงาน BDI |
| subject | UAK · คีย์ใหม่ | UAK · **คีย์ใหม่** | UAK · คีย์ใหม่ |
| organization_id | หน่วยงานของคำเชิญ | หน่วยงานของคีย์ | หน่วยงานของคำขอ |
| before | null | `{activationKeyId: <คีย์ที่ระบุใน :id>, status: <สถานะที่อ่านไว้ก่อนธุรกรรม>}` | null |
| after | `{email, cid, role, name, userAccountId}` — **`cid` เต็ม ไม่ปิด** | `{email, role}` | `sanitizeState({email, cid, role, name, userAccountId})` — `cid` ปิด |

| metadata | ความหมาย | ตัวอย่าง |
|---|---|---|
| `issued_via` | ช่องทาง | `"ADMIN_API"` · `"REVIEW_API"` |
| `reason` | เหตุที่ออก | `"INVITATION"` · `"RESEND"` · `"APPROVER_INVITATION"` |
| `replaced_key_id` | *resend* — คีย์ที่ admin ระบุ | `"a4d2…"` |
| `request_number` | *review* | `"ORG-REG-2026-0004"` |

- **ข้อมูลส่วนบุคคล** อีเมลและชื่อผู้ถูกเชิญ ไม่ปิด · **เลขบัตรเต็ม**ในแถวของ `POST /api/admin/invitations` (จุดเขียนที่มีมาก่อนการ์ด
  เก็บแบบเดิมจนกว่า BDI จะตัดสิน — `CLAUDE.md`) ส่วนแถว review ปิดแล้ว
- ขา resend: `before.status` อาจเป็น `ISSUED` ทั้งที่คำขอเดียวกันเพิ่งเพิกถอนคีย์นั้น การพลิกจริงอยู่ในแถว `ACTIVATION_KEY_REVOKED`
  ที่มาก่อน · วันหมดอายุของคีย์ไม่ถูกบันทึก · ขา admin เขียนก่อนอีเมล inline
- **ขา review ส่งอีเมลก่อนมีแถว**: `ensureApproverAccount()` ส่งคำเชิญแบบไม่รอจาก**ใน** transaction ของ review (`organizations.ts:3168` — ต้องใช้ raw key) แถวนี้เขียน
  หลัง commit ถ้า transaction rollback ทีหลัง (เช่น `openTask` ที่ `:2615` ได้ 409 `task_closed`) อีเมลอาจออกไปแล้วโดยไม่มี `ACTIVATION_KEY_ISSUED` และคีย์ในอีเมลไม่มีในฐานข้อมูล
  (บัญชีและคีย์ rollback ไปด้วย ลิงก์ได้ `key_not_found`) — ไม่มีร่องรอยใน `audit_event` และ 409 ไม่เกิด error event ให้ breadcrumb `smtp` ติดไป
- **ขา resend ไม่มี id ของบัญชี** (`after` มีแค่ `{email, role}`) และ `INVITATION_DELETED` `APPROVER_INVITATION_RECALLED` ก็ไม่มี —
  ใน Postgres ชีวิตของบัญชี PENDING ที่จบด้วยการถูกลบจึงตามด้วย id ไม่ได้ ต้องจับด้วยอีเมล (หรือเลขบัตรเต็มในแถวที่ยังเก็บเต็ม) · **ในสำเนา Mongo
  หาเจอ**: อีเมลใต้คีย์ `email` ของ before/after/metadata ได้ `email#` (3.6) และเลขบัตรเต็มใน `before.cid` ถูกปิดแต่ได้ `cid#` — `x-log-person` ที่เป็นอีเมล
  หรือ uuid ของบัญชีที่ยังอยู่ (`resolvePerson()` เติม `email#` ของบัญชีให้ ตั้งใจไว้สำหรับแถวพวกนี้) `x-log-email` และ `x-log-cid` เจอแถวเหล่านี้
  เหลือแค่ `x-log-person` ที่เป็น uuid ของบัญชีที่ถูกลบไปแล้วที่ไม่เจอ (3.2 `relatedUserIds`)
- **ตัวอย่าง (review)** `{"after": {"email": "approver@agency.go.th", "cid": {"masked": "xxxxxxxxx4821", "changed": true}, "role": "ORGANIZATION_APPROVER", "name": "นาย ผู้มีอำนาจ ตัวอย่าง", "userAccountId": "5c3e…"}, "metadata": {"issued_via": "REVIEW_API", "reason": "APPROVER_INVITATION", "request_number": "ORG-REG-2026-0004"}}`
- **โค้ด** `routes/admin.ts:867` · `:1062` · `routes/organizations.ts:2767`

#### `ACTIVATION_KEY_USED` — คีย์ถูกใช้เปิดบัญชี

ประวัติของคีย์หนึ่งใบจึงจบที่ subject เดียว: ISSUED · IDENTITY_VERIFIED · USED `completeActivation()` พลิกเฉพาะคีย์ที่ยัง
`ISSUED` ตอนเขียน หนึ่งคีย์จึงมีแถวนี้ไม่เกินหนึ่งแถว

**เกิดเมื่อ**
- `POST /api/auth/activate` — ตามหลัง `USER_ACCOUNT_ACTIVATED` เงื่อนไขเดียวกัน

| ช่อง | ค่า |
|---|---|
| actor | `USER` = บัญชีที่เปิด (ส่ง `actorId` เอง) |
| subject | UAK · คีย์ |
| organization_id | หน่วยงานของคีย์ |
| result | `SUCCESS` |
| before / after | `{status: "ISSUED"}` / `{status: "USED"}` เสมอ |

| metadata | ความหมาย | ตัวอย่าง |
|---|---|---|
| `user_account_id` | บัญชีของคีย์ | `"5c3e…"` |
| `role` | role ของคีย์ | `"ORGANIZATION_USER"` |

- **ข้อมูลส่วนบุคคล** `actor_name` · **โค้ด** `routes/auth.ts:797`

#### `ACTIVATION_KEY_REVOKED` — คีย์ที่ยังใช้ได้ถูกเพิกถอน

หนึ่งแถวต่อคีย์ เขียนหลัง commit ด้วย `logKeysRevoked()` จากรายการที่ `revokeIssuedKeys()` (`UPDATE … RETURNING`)
พลิกได้จริงเท่านั้น คีย์ที่ไม่ใช่ `ISSUED` อยู่แล้วไม่ได้แถว

| เกิดเมื่อ | actor | `reason` | `revoked_via` | `replaced_by_key_id` | โค้ดผู้เรียก |
|---|---|---|---|---|---|
| `POST /api/admin/invitations/:id/resend` — คีย์เก่าที่ยัง ISSUED | **แถว admin** | `"ออกคีย์ใหม่แทน"` | `ADMIN_API` | มี | `admin.ts:1061` |
| `POST /api/admin/invitations/:id/revoke` — คีย์ `:id` ยัง ISSUED (ไม่ใช่ = 404) **ไม่ดู `expires_at`**: คีย์ที่เลยกำหนดแต่ยังไม่มีใครเปิดจึงถูกพลิกเป็น `REVOKED` ได้แถวนี้ ไม่เคยได้ `ACTIVATION_KEY_EXPIRED` | **แถว admin** | ที่ admin พิมพ์ หรือ `"ยกเลิกโดยผู้ดูแลระบบ"` | `ADMIN_API` | — | `admin.ts:1297` |
| `POST /api/admin/users/:id/deactivate` — คีย์ ISSUED ของบัญชี | **แถว admin** | `"บัญชียุติการใช้งาน"` | `ADMIN_API` | — | `admin-users.ts:883` |
| `POST /api/admin/registrations/organizations/:id/reset` — คีย์ของผู้มีอำนาจฯ ที่ถูกถอด หรือของบัญชี PENDING ที่ลบไม่ได้ | **แถว admin** | ที่ admin พิมพ์ | `ADMIN_RESET_API` | — | `admin-registrations.ts:582` |
| `POST /api/organizations/:id/review` ผ่านด่านแรกและเคยมีคำเชิญผู้มีอำนาจฯ ค้างอยู่ | **แถว session** = ผู้ประสานงาน BDI | `"ออกคีย์ใหม่แทน"` | `REVIEW_API` | มี | `organizations.ts:2763` |
| `POST /api/organizations/:id/review` `action: "recall"` และบัญชี PENDING ถูกเก็บไว้ | **แถว session** = ผู้ประสานงาน BDI | บันทึกของผู้ประสานงาน (note) | `REVIEW_API` | — | `organizations.ts:2824` |

| ช่อง | ค่า |
|---|---|
| subject | UAK · คีย์ที่ถูกเพิกถอน (ใบเก่า) |
| organization_id | หน่วยงานของคีย์ (ของ reset แบบถอดผู้มีอำนาจฯ อาจต่างจากหน่วยงานของคำขอ) |
| result | `SUCCESS` |
| before / after | `{status: "ISSUED"}` / `{status: "REVOKED"}` |

| metadata | ความหมาย | ตัวอย่าง |
|---|---|---|
| `reason` | ค่าเดียวกับ `activation_key.revoked_reason` | `"ออกคีย์ใหม่แทน"` |
| `revoked_via` | ช่องทางเดียวกับแถวต้นเรื่อง | `"ADMIN_RESET_API"` |
| `user_account_id` | บัญชีของคีย์ | `"7c1e…"` |
| `role` | role ของคีย์ | `"ORGANIZATION_APPROVER"` |
| `replaced_by_key_id` | คีย์ใหม่ที่มาแทน | `"a4d2…"` |

- **ข้อมูลส่วนบุคคล** id · `reason` ที่เป็นข้อความอิสระ (บันทึกของผู้ประสานงานตอน recall หน่วยงานก็เห็น)
- คีย์ที่ถูกเพิกถอนเพราะเลขบัตรจาก ThaID ไม่ตรง (`revokeActivationKey()`) **ไม่มีแถวนี้โดยตั้งใจ** —
  `IDENTITY_VERIFICATION_FAILED` `CID_MISMATCH` คือบันทึกของเหตุการณ์นั้น · คีย์ที่ถูกลบพร้อมบัญชีก็ไม่มีแถว
- **ตัวอย่าง** `{"before": {"status": "ISSUED"}, "after": {"status": "REVOKED"}, "metadata": {"reason": "ออกคีย์ใหม่แทน", "revoked_via": "ADMIN_API", "user_account_id": "7c1e…", "role": "ORGANIZATION_USER", "replaced_by_key_id": "a4d2…"}}`
- **โค้ด** `lib/iam.ts:467` (`logKeysRevoked()`)

#### `ACTIVATION_KEY_EXPIRED` — คีย์เลยกำหนดถูกพลิกเป็น `EXPIRED`

ไม่มี job ไล่เก็บ สถานะเปลี่ยนตอนมีคนเปิดลิงก์ แถวนี้จึงบอกด้วยว่ามีคนกดลิงก์ที่ตายแล้ว เขียนเฉพาะครั้งที่สถานะเปลี่ยนจริง
(`updateMany` มีเงื่อนไขสถานะเดิม เปิดพร้อมกันกี่คนก็ได้แถวเดียว) คีย์ที่ไม่มีใครเปิดค้าง `ISSUED` ต่อไปโดยไม่มีแถว

**เกิดเมื่อ** (คีย์มีอยู่ ไม่ใช่ USED/REVOKED และ `expires_at` ผ่านไปแล้ว)
- `GET /api/auth/invitation?token=` (`auth.ts:159`)
- `POST /api/auth/thaid/start` ขา activate (`auth.ts:264`)
- `POST /api/auth/thaid/callback` ขา activate (`auth.ts:440`) — ตามด้วย `IDENTITY_VERIFICATION_FAILED` `key_expired`
- `POST /api/auth/activate` (`auth.ts:680`)

| ช่อง | ค่า |
|---|---|
| actor | `SYSTEM` (ไม่มี actor บนเส้นทางสาธารณะเหล่านี้ — ดู 3.4 ข้อ 7) |
| subject | UAK · คีย์ |
| organization_id | หน่วยงานของคีย์ |
| result | `SUCCESS` |
| before / after | `{status: <เดิม ในทางปฏิบัติ "ISSUED">}` / `{status: "EXPIRED"}` |

| metadata | ความหมาย | ตัวอย่าง |
|---|---|---|
| `user_account_id` | บัญชีของคีย์ | `"7c1e…"` |
| `role` | role ของคีย์ | `"ORGANIZATION_USER"` |
| `expires_at` | วันหมดอายุของคีย์ (ISO string) | `"2026-09-20T03:12:44.120Z"` |

- **ข้อมูลส่วนบุคคล** id · IP ของคนที่กดลิงก์ · **โค้ด** `lib/iam.ts:586` (`evaluateActivationKey()`)

#### `INVITATION_DELETED` — คำเชิญถูกลบทิ้ง

ต่างจาก `ACTIVATION_KEY_REVOKED`: แถวคีย์หายไปแล้ว (บางครั้งพร้อมบัญชี PENDING) แถวนี้จึงเป็นหลักฐานเดียวว่าเคยเชิญใคร

**เกิดเมื่อ**
- `DELETE /api/admin/invitations/:id` — คีย์มีอยู่และบัญชียังไม่ `ACTIVE` (409 ไม่มีแถว)

| ช่อง | ค่า |
|---|---|
| actor | **แถว admin** |
| subject | UAK · id ของคีย์ที่ถูกลบแล้ว |
| organization_id | หน่วยงานของคีย์ (หน่วยงานนั้นอาจถูกลบไปด้วยถ้าเป็นหน่วยงานเปล่า) |
| result | `SUCCESS` |
| before / after | `{email, cid, role, keyStatus}` — **`cid` เต็ม ไม่ปิด** / null |

| metadata | ความหมาย | ตัวอย่าง |
|---|---|---|
| `deleted_via` | ช่องทาง | `"ADMIN_API"` |
| `user_account_deleted` | บัญชี PENDING ถูกลบไปด้วยหรือไม่ | `true` |
| `kept_account_because` | *เมื่อบัญชีไม่ถูกลบ* — เหตุผลภาษาไทย | `"บัญชีนี้มีสิทธิ์ (role) ผูกอยู่แล้ว"` |
| `placeholder_organization_deleted` | หน่วยงานเปล่าและร่างคำขอของมันถูกลบไปด้วยหรือไม่ | `false` |

- **ข้อมูลส่วนบุคคล** อีเมลและ**เลขบัตรเต็ม**ของผู้ถูกเชิญ (สำเนา Mongo ปิดเลขบัตร) · หน่วยงานเปล่าและร่างที่ถูกลบไม่มีแถวของตัวเอง
- **ไม่มี id ของบัญชี** แม้ `user_account_deleted: true` — ต่อกับ `USER_ACCOUNT_CREATED` / `ACTIVATION_KEY_ISSUED` ของบัญชีเดิมได้ด้วย `subject_id`
  (id ของคีย์ = subject ของ `ACTIVATION_KEY_ISSUED`) หรือด้วยอีเมล
- **โค้ด** `routes/admin.ts:1219`

#### `APPROVER_INVITATION_RECALLED` — คำเชิญผู้มีอำนาจฯ ถูกยกเลิก

เก็บอีเมล เลขบัตร และชื่อผู้ถูกเชิญไว้ในตัว เพราะบัญชี PENDING มักถูกลบไปด้วย แถวนี้จึงเป็นหลักฐานเดียวว่าคำเชิญไปหาที่อยู่ไหน

**เกิดเมื่อ** (มีบัญชีที่อีเมลตรง `approverEmail` ของคำขอ และบัญชีนั้นยังไม่ `ACTIVE`)
- `POST /api/organizations/:id/review` `action: "recall"` โดยผู้ประสานงาน BDI — ตามหลัง `REQUEST_RETURNED`
- `POST /api/admin/registrations/organizations/:id/reset` — ยังไม่มีผู้มีอำนาจฯ ที่เปิดบัญชีแล้ว

| ช่อง | recall | admin reset |
|---|---|---|
| actor | **แถว session** = ผู้ประสานงาน BDI | **แถว admin** |
| subject | ORR · คำขอ | ORR · คำขอ |
| organization_id | หน่วยงานของคำขอ | หน่วยงานของคำขอ |
| before / after | `{email, cid, displayName, status}` — **`cid` เต็ม** / `{accountDeleted, keptBecause?}` | เหมือนกัน |

| metadata | ความหมาย | ตัวอย่าง |
|---|---|---|
| `recalled_via` | ช่องทาง | `"REVIEW_API"` · `"ADMIN_RESET_API"` |
| `note` | *recall* — บันทึกของผู้ประสานงาน (อย่างน้อย 10 ตัว) | `"อีเมลผู้มีอำนาจฯ ไม่ถูกต้อง กรุณาแก้ไข"` |
| `reason` | *admin reset* — เหตุผลที่ admin พิมพ์ | `"หน่วยงานขอเปลี่ยนผู้มีอำนาจลงนาม"` |

- `after.keptBecause` มีเฉพาะเมื่อ `accountDeleted: false` (เช่น `"บัญชีนี้มีคำเชิญของหน่วยงานอื่นค้างอยู่"`) และตามด้วย
  [`ACTIVATION_KEY_REVOKED`] **เฉพาะเมื่อบัญชีนั้นยังมีคีย์ `ISSUED` ของหน่วยงานนี้** (`revokeIssuedKeys()` กรอง `{userAccountId,
  organizationId, status: ISSUED}` — `lib/approver-seat.ts:133-143`) คีย์ของหน่วยงานนี้ที่ `EXPIRED` `REVOKED` หรือ `USED` ไปแล้ว = แถวนี้
  ไม่มีอะไรตาม · ถ้าบัญชีถูกลบ คีย์หายตามไปโดยไม่มีแถว
- **ไม่มี id ของบัญชี** — `before` มีแค่ `{email, cid, displayName, status}` บัญชีที่ `accountDeleted: true` จึงตามต่อได้ด้วยอีเมลหรือเลขบัตรเท่านั้น (4.5 ข้างบน)
- **ข้อมูลส่วนบุคคล สูง** อีเมล ชื่อ และ**เลขบัตรเต็ม** ไม่ปิดใน Postgres + ข้อความอิสระ
- **โค้ด** `routes/organizations.ts:2814` · `routes/admin-registrations.ts:553`

---

### 4.6 หมวด organization — ทะเบียนหน่วยงาน

#### `ORGANIZATION_CREATED` — หน่วยงานใหม่ในทะเบียน

subject เป็นแถว `organization` เสมอ **แถวทาง WEB_FORM ที่เขียนก่อนการ์ดนี้มี subject เป็นคำขอ** และไม่มี `REQUEST_CREATED` คู่

**เกิดเมื่อ**
- `POST /api/admin/organizations` — รหัสไม่ซ้ำ หน่วยงานแม่มีอยู่ ชื่อที่อยู่แปลงเป็นรหัสได้ (`created_via: ADMIN_API`)
- **ถอดแล้วที่ `7259c09`** `POST /api/organizations` ทางหน่วยงานใหม่ — ผู้ใช้ยังไม่มีหน่วยงาน (`created_via: WEB_FORM`) ตามด้วย `REQUEST_CREATED` และ `ROLE_ASSIGNED`
  — ตั้งแต่ merge นั้นมีแต่แถวเก่า คอลัมน์ WEB_FORM ข้างล่างอธิบายแถวเหล่านั้น หน่วยงานใหม่ทุกแห่งมาจากขา admin

| ช่อง | admin | WEB_FORM |
|---|---|---|
| actor | **แถว admin** | **แถว session** (snapshot มี `ORGANIZATION_USER` แล้ว) |
| subject / organization_id | `ORGANIZATION` · หน่วยงานใหม่ / เดียวกัน | เหมือนกัน |
| before | null | null |
| after | `{organizationCode, organizationType, nameTh, nameEn, status, addressLine, road, provinceCode, districtCode, subDistrictCode, postalCode, phone, phoneExtension, email, websiteUrl, parentOrganizationId}` | `{organizationCode, organizationType, nameTh, nameEn, status}` |

| metadata | ความหมาย | ตัวอย่าง |
|---|---|---|
| `created_via` | ช่องทาง | `"ADMIN_API"` · `"WEB_FORM"` |
| `organization_code` | *admin* | `"MOT-001"` |
| `request_number` | *WEB_FORM* — คำขอที่เกิดพร้อมกัน | `"ORG-REG-2026-0012"` |

- `status` เป็น `"PENDING_REGISTRATION"` · ที่อยู่เป็น**รหัส**ที่แปลงแล้ว ไม่ใช่ชื่อที่ส่งมา · ชื่อหน่วยงานของ WEB_FORM อาจเป็น `"หน่วยงานใหม่"`
- **ข้อมูลส่วนบุคคล** อีเมลและเบอร์โทรของหน่วยงาน (ขา admin) ซึ่งอาจเป็นของคน
- **โค้ด** `routes/admin.ts:247` · ทาง WEB_FORM ที่ถอดแล้วอยู่ที่ `routes/organizations.ts:1153` ของ `2cab0a7`

#### `ORGANIZATION_UPDATED` — admin แก้ทะเบียนหน่วยงาน

**เกิดเมื่อ**
- `PATCH /api/admin/organizations/:id` — ผ่านทุกการตรวจ เขียน**ทุกครั้งที่ได้ 200** แม้ไม่มีอะไรเปลี่ยน

| ช่อง | ค่า |
|---|---|
| actor | **แถว admin** |
| subject / organization_id | `ORGANIZATION` · `:id` / เดียวกัน |
| result | `SUCCESS` |
| before / after | `sanitizeDiff(diffFields(แถวเดิม, sentOnly(ค่าที่เขียน)))` เฉพาะคอลัมน์ที่เปลี่ยน จาก `organizationCode` `nameTh` `nameEn` `organizationType` `addressLine` `road` `provinceCode` `districtCode` `subDistrictCode` `postalCode` `phone` `phoneExtension` `email` `websiteUrl` `parentOrganizationId` · ไม่เปลี่ยน = null / null |

| metadata | ความหมาย | ตัวอย่าง |
|---|---|---|
| `updated_via` | ช่องทาง | `"ADMIN_API"` |
| `fields` | ชื่อฟิลด์ของ API ที่**ส่งมา** | `["province", "district", "subdistrict", "phone"]` |
| `fields_changed` | ชื่อ**คอลัมน์**ที่เปลี่ยนจริง (`[]` ถ้าไม่มี) | `["provinceCode", "districtCode", "subDistrictCode", "postalCode"]` |

- แถวก่อนการ์ดเก็บแค่รหัสกับชื่อไทยไม่ว่าจะแก้ช่องไหน และแถวที่ subject เป็นคำขอคือการเปิดคำขอ (ตอนนี้เป็น `REQUEST_CREATED`)
- **ข้อมูลส่วนบุคคล** `email` และ `phone` ของหน่วยงานใน before/after ซึ่งอาจเป็นของคน ไม่ปิด
- **โค้ด** `routes/admin.ts:489`

#### `ORGANIZATION_ACTIVATED` — หน่วยงานเปิดใช้งาน

BDI อนุมัติขั้นสุดท้าย ค่าในคำขอ 14 คีย์ (ตามตารางข้างล่าง) ถูกเขียนทับทะเบียนหน่วยงาน ซึ่ง `REQUEST_APPROVED` ไม่ได้บอก — ไม่ใช่ทั้งชุด:
`organizationType` ในคำขอ**ไม่ถูกคัดลอก** และ `parentOrganizationId` ก็ไม่ (`organizations.ts:2650-2665`)

**เกิดเมื่อ**
- `POST /api/organizations/:id/review` อนุมัติที่ด่าน `BDI_FINAL_APPROVAL` — ตามหลัง `REQUEST_APPROVED` ก่อน `DOCUMENT_SIGNED`

| ช่อง | ค่า |
|---|---|
| actor | **แถว session** = ผู้อนุมัติขั้นสุดท้ายของ BDI |
| subject / organization_id | `ORGANIZATION` · หน่วยงานของคำขอ / เดียวกัน |
| result | `SUCCESS` |
| before / after | `sanitizeDiff(diffFields(แถวหน่วยงานที่อ่านก่อนธุรกรรม, ค่าที่เขียน))` จาก `status` `organizationCode` `nameTh` `nameEn` `addressLine` `road` `provinceCode` `districtCode` `subDistrictCode` `postalCode` `phone` `phoneExtension` `email` `websiteUrl` (ไม่มี `blankAsNull`) |

| metadata | ความหมาย | ตัวอย่าง |
|---|---|---|
| `activated_via` | ช่องทาง | `"REVIEW_API"` |
| `request_number` | คำขอที่อนุมัติ | `"ORG-REG-2026-0004"` |
| `fields_changed` | คีย์ของ `after` | `["status", "addressLine", "phone"]` |

- **ข้อมูลส่วนบุคคล** `email` และ `phone` ของหน่วยงานใน before/after ซึ่งอาจเป็นของคน ไม่ปิด
- **ตัวอย่าง** `{"before": {"status": "PENDING_REGISTRATION", "phone": null}, "after": {"status": "ACTIVE", "phone": "021112222"}, "metadata": {"activated_via": "REVIEW_API", "request_number": "ORG-REG-2026-0004", "fields_changed": ["status", "phone"]}}`
- **โค้ด** `routes/organizations.ts:2712`

---

### 4.7 หมวด request — คำขอจดทะเบียนหน่วยงานและคำขอลงทะเบียนชุดข้อมูล

#### `REQUEST_CREATED` — เปิดคำขอใบใหม่

**เกิดเมื่อ**
- `POST /api/dataset-requests` — ผู้ใช้มี `ORGANIZATION_USER` หน่วยงาน `ACTIVE` มีผู้ใช้และผู้มีอำนาจฯ ครบ (กดทุกครั้งได้ร่างใหม่)
- `POST /api/organizations` ทางหน่วยงานที่มีอยู่แล้ว — ผู้ใช้มีหน่วยงานใน session (`session.organizationId`) **และถือ `ORGANIZATION_USER`**
  (เงื่อนไขหลังมาจาก `7259c09` — ผู้มีอำนาจฯ และผู้ไม่มีหน่วยงานได้ 403 `no_organization` ไม่มีแถว) หน่วยงานนั้นยังไม่ `ACTIVE` และไม่มีคำขอเปิดค้าง
  (`prefilled_from`) ซึ่งรวมทั้งผู้ถูกเชิญเข้าหน่วยงานที่ admin สร้างไว้ **และ**ผู้ใช้ที่ยื่นใหม่หลังคำขอของหน่วยงานที่ตัวเองเปิดทาง WEB_FORM ถูก
  `REJECTED` (การปฏิเสธตั้งแค่ `rejected_at` ไม่ถอน `ORGANIZATION_USER` — `organizations.ts:2679-2683`)
- **ถอดแล้วที่ `7259c09`** `POST /api/organizations` ทางหน่วยงานใหม่ — ตามหลัง `ORGANIZATION_CREATED` (แถวเก่าเท่านั้น)

| ช่อง | ค่า |
|---|---|
| actor | **แถว session** |
| subject | DRR หรือ ORR · คำขอใหม่ |
| organization_id | หน่วยงานเจ้าของคำขอ |
| result | `SUCCESS` |
| before / after | null / ชุดข้อมูล `{requestNumber}` · หน่วยงาน `{requestNumber, name}` (`name` = ชื่อไทยของหน่วยงานในคำขอ หรือ null) |

| metadata | ความหมาย | ตัวอย่าง |
|---|---|---|
| `prefilled_from` | *ทางหน่วยงานที่มีอยู่แล้ว* — ค่าตั้งต้นคัดลอกจากทะเบียน ค่า**คงที่ในโค้ด** (`organizations.ts:1094`) จึงไม่ได้พิสูจน์ว่า admin เป็นผู้สร้างหน่วยงาน ดู `ORGANIZATION_CREATED` ของหน่วยงานนั้น (`created_via`) | `"ADMIN_ORGANIZATION"` |
| `organization_code` | *เหมือนข้างบน* | `"ORG-2026-0003"` |

- เนื้อหาของร่าง**ไม่ถูกบันทึก**ในแถวนี้ · แถวก่อนการ์ดของสองทางฝั่งหน่วยงานเป็น `ORGANIZATION_UPDATED` และ `ORGANIZATION_CREATED` ตามลำดับ
- **โค้ด** `routes/dataset-requests.ts:609` · `routes/organizations.ts:1087` · ทางหน่วยงานใหม่ที่ถอดแล้วอยู่ที่ `:1167` ของ `2cab0a7`

#### `REQUEST_DRAFT_SAVED` — ฝั่งหน่วยงานบันทึกร่าง

ใครแก้อะไร ไม่ใช่ใครกดปุ่ม: diff คำนวณที่เซิร์ฟเวอร์จากแถวเดิมกับค่าที่**เขียนลงจริง** (`""` เท่ากับ null) กดบันทึกโดยไม่มีอะไร
เปลี่ยนไม่มีแถว (ยกเว้น snapshot ฝั่งหน่วยงานที่ route ซิงก์จากบัญชีหรือแปลงรูป — ข้างล่าง) PATCH นี้มาจาก “บันทึกแบบร่าง” **และ**จากปุ่มสร้างเอกสารที่บันทึกก่อนเรียก `generate-form` แถวไม่บอกว่าปุ่มไหน

**เกิดเมื่อ**
- `PATCH /api/organizations/:id` — ผู้แก้อยู่หน่วยงานเดียวกันและถือ `ORGANIZATION_USER` คำขอ `DRAFT`/`RETURNED` และ diff ของคำขอหรือของชื่อหน่วยงานไม่ว่าง
- `PATCH /api/dataset-requests/:id` — `mayEdit` (`dataset-requests.ts:254`: session ที่ไม่ใช่เจ้าหน้าที่ BDI ซึ่ง `organizationId` ตรงหน่วยงานของคำขอ ไม่ว่าถือ role ใด
  **หรือ**ผู้สร้างคำขอเอง แม้ย้ายออกจากหน่วยงานไปแล้ว) คำขอ `DRAFT`/`RETURNED` และ diff ไม่ว่าง

| ช่อง | ค่า |
|---|---|
| actor | **แถว session** |
| subject | ORR หรือ DRR · คำขอ |
| organization_id | หน่วยงานของคำขอ |
| result | `SUCCESS` |
| before / after | `sanitizeDiff(diffFields(blankAsNull(เดิม), blankAsNull(ที่เขียน)))` เฉพาะคีย์ที่เปลี่ยน · ฝั่งหน่วยงานเป็น null เมื่อเปลี่ยนแค่ชื่อหน่วยงาน |

คีย์ที่ปรากฏใน `before`/`after` ได้:
- **หน่วยงาน** — คอลัมน์ snapshot ของคำขอ: `organizationType` `organizationNameTh` `organizationNameEn` `organizationAddressLine`
  `organizationRoad` `organizationProvinceCode` `organizationDistrictCode` `organizationSubdistrictCode` `organizationPostalCode`
  `organizationPhone` `organizationPhoneExtension` `organizationEmail` `organizationWebsite` `approverPrefixTh` `approverFirstnameTh`
  `approverLastnameTh` `approverPositionTh` `approverEmail` `approverCid` `approverPhoneNumber` `approverPhoneNumberExtension`
  `approverDepartmentTh` `userPrefixTh` `userFirstnameTh` `userLastnameTh` `userPositionTh` `userDepartmentTh` `userEmail`
  `userPhoneNumber` `userPhoneNumberExtension` `userCid` — `approverCid` `userCid` เป็น `{masked, changed: true}`
- **ชุดข้อมูล** — 36 คีย์ของ `MetadataValues` (`dataType` `dataTopic` `title` `name` `dataFields` `maintainer` `maintainerEmail`
  `objective` `containsPersonalData` `dataClassification` `licenseId` `allow*` ฯลฯ) ค่าเป็น string/number/boolean/null
  และรวมค่าที่กฎในชีท conditions ล้างหรือบังคับให้ด้วย เพราะถูกเขียนจริง ไม่มีคีย์ไหนถูกปิด

| metadata | ความหมาย | ตัวอย่าง |
|---|---|---|
| `saved_via` | ช่องทาง | `"WEB_FORM"` |
| `request_number` | เลขที่คำขอ | `"DS-REG-2026-0007"` |
| `status` | สถานะตอนบันทึก | `"DRAFT"` · `"RETURNED"` |
| `fields_changed` | **หน่วยงาน**: คีย์ที่เปลี่ยนเพราะผู้กรอก — ไม่รวมคีย์ที่ route เขียนจากบัญชี และคีย์ที่เปลี่ยนแค่รูปเพราะ route แปลงค่าเดิม (อาจเป็น `[]`) · **ชุดข้อมูล**: `Object.keys(after)` ทุกคีย์ที่เปลี่ยน รวมค่าที่กฎในชีท conditions ล้างหรือบังคับให้เองซึ่งผู้กรอกไม่ได้ส่ง ไม่เคยเป็น `[]` เพราะแถวเขียนเฉพาะเมื่อมี diff (`dataset-requests.ts:856-867`) | `["title", "maintainerEmail"]` |
| `synced_from_account` | *หน่วยงาน เมื่อไม่ว่าง* — คีย์ที่ route เขียนจาก**บัญชี**ทับเสมอ (ผู้ประสานงาน และอีเมล/เลขบัตรของผู้มีอำนาจฯ ที่เปิดบัญชีแล้ว) | `["userFirstnameTh", "userPhoneNumber"]` |
| `normalised_by_route` | *หน่วยงาน เมื่อไม่ว่าง* (ตั้งแต่ `d3c1ee0`) — คีย์ที่เปลี่ยนแค่รูปเพราะ route แปลงค่าเดิมที่ฟอร์มแสดงแล้วส่งกลับมา: อีเมลเป็นตัวพิมพ์เล็ก (ร่างก่อน 2026-09-18) เบอร์เป็นตัวเลขล้วน (ก่อน 2026-08-29) ตัดช่องว่างหัวท้าย — ตัดสินโดย `changedOnlyInForm()` (`lib/organization-form.ts`): ค่าเดิมผ่านตัวแปลงของฟอร์ม (`draftEmailSchema` · `draftPhone()`) แล้วเท่ากับค่าที่เขียนลงหรือไม่ · ผู้กรอกที่พิมพ์ค่าเดิมใหม่ต่างแค่ตัวพิมพ์หรือขีดก็นับกลุ่มนี้ (ความหมายไม่เปลี่ยน) | `["organizationEmail", "approverPhoneNumber"]` |
| `organization_master_changed` | *หน่วยงาน เมื่อชื่อบนแถว organization เปลี่ยนตาม* — `{before, after}` ของ `nameTh` `nameEn` `organizationType` · เปลี่ยนตามเฉพาะเมื่อ `nameOwnedByForm()` (`organizations.ts:483`): หน่วยงานที่ผู้สร้างคำขอเปิดเอง ตั้งแต่ `7259c09` คือหน่วยงานเก่าที่เปิดผ่านทาง WEB_FORM ที่ถอดแล้วเท่านั้น — หน่วยงานที่ admin สร้าง (`createdBy` = บัญชีระบบ) ไม่มีวันได้คีย์นี้ | `{"before": {"nameTh": "หน่วยงานใหม่"}, "after": {"nameTh": "กรมตัวอย่าง"}}` |

- **ฝั่งหน่วยงานเท่านั้น**: `fields_changed` + `synced_from_account` + `normalised_by_route` = คีย์ของ before/after พอดี (before/after ยังเก็บค่าดิบที่
  เปลี่ยนจริงในตาราง) snapshot ที่ไม่ตรงกับบัญชี หรือเก็บไว้ก่อนมีการแปลงรูป จึงได้แถวตอนบันทึกครั้งแรกแม้ไม่ได้พิมพ์อะไร โดย `fields_changed: []`
  (ข้อยกเว้นของ “ไม่เปลี่ยน = ไม่มีแถว” — 6.1) บันทึกครั้งถัดไปโดยไม่แตะอะไรไม่มีแถว · แถวที่เปลี่ยนแค่ชื่อหน่วยงานก็มี `fields_changed: []` กับ
  `organization_master_changed` · ตัวแปลงใหม่ของช่องในร่างต้องเพิ่มใน `changedOnlyInForm()` ด้วย ไม่งั้นบันทึกครั้งแรกหลังจากนั้นโทษผู้กรอกอีก ·
  ฝั่งชุดข้อมูลไม่มี `synced_from_account` และ `normalised_by_route` และ `fields_changed` = คีย์ของ `after`
- **ข้อมูลส่วนบุคคล สูง** ชื่อ ตำแหน่ง อีเมล เบอร์โทรของผู้มีอำนาจฯ และผู้ประสานงาน ไม่ปิด · เลขบัตรเหลือ 4 ตัวท้าย ·
  ฝั่งชุดข้อมูลมี `maintainer` `maintainerEmail` และข้อความอิสระหลายช่อง
- **ตัวอย่าง** ดู 2.9
- **โค้ด** `routes/organizations.ts:1457` (แยกสามกลุ่มที่ `:1432-1446` · `changedOnlyInForm()` ใน `lib/organization-form.ts:127`) · `routes/dataset-requests.ts:857`

#### `REQUEST_FORM_GENERATED` — สร้างเอกสารจาก template ให้ตรวจก่อนนำส่ง

ฉบับที่สร้างรอบนี้คือสิ่งที่ผู้มีอำนาจฯ จะอ่านและลงนาม กดซ้ำเมื่อไรฉบับเดิมกลายเป็น REPLACED การ render ซ้ำหลังลงนามและ
การ render อัตโนมัติตอน `GET /:id/legal-documents` **ไม่เขียนแถวนี้**

**เกิดเมื่อ**
- `POST /api/organizations/:id/generate-form` — `canEdit` (หน่วยงานเดียวกัน + `ORGANIZATION_USER` ไม่ผ่าน = 404) ข้อมูลผ่าน `submitSchema`
  ที่อยู่ถูกต้องตามฐานข้อมูล (`isValidAddress`, `organizations.ts:1721`) อีเมล/เลขบัตรของผู้มีอำนาจฯ ไม่ชนใคร (`approverConflict`, `:1740`)
  มีคำสั่งแต่งตั้งที่ ACTIVE และ render ได้อย่างน้อยหนึ่งฉบับ — ข้อใดไม่ผ่านได้ 4xx ไม่มีแถว
- `POST /api/dataset-requests/:id/generate-form` — `mayEdit` (กติกาเดียวกับ `REQUEST_DRAFT_SAVED` ข้างบน · ไม่ผ่าน = 404) ข้อมูลผ่าน `datasetSubmitSchema` มี `DATA_DICTIONARY` ที่ ACTIVE และ render ได้อย่างน้อยหนึ่งฉบับ

ทั้งสองทางไม่ตรวจสถานะของคำขอ render ไม่ได้เลย = 503 ไม่มีแถว render ล้มกลางทาง = ไม่มีแถว (ฉบับที่ render ไปแล้วยังอยู่)

| ช่อง | ค่า |
|---|---|
| actor | **แถว session** |
| subject | ORR หรือ DRR · คำขอ |
| organization_id | หน่วยงานของคำขอ |
| result / before / after | `SUCCESS` / null / null |

| metadata | ความหมาย | ตัวอย่าง |
|---|---|---|
| `request_number` | เลขที่คำขอ | `"ORG-REG-2026-0004"` |
| `documents` | ทุกฉบับที่ render: `[{code, version_id, attachment_id}]` | `[{"code": "A0", "version_id": "9b0e…", "attachment_id": "c41a…"}]` |

- **ข้อมูลส่วนบุคคล** id เท่านั้น · ไฟล์ที่ render ไม่มีแถว `ATTACHMENT_*` ของตัวเอง แถวนี้คือบันทึกเดียวของมัน
- **โค้ด** `routes/organizations.ts:1789` · `routes/dataset-requests.ts:1291`

#### `REQUEST_SUBMITTED` — นำส่งคำขอ (และด่านของหน่วยงานที่ผ่านแต่ยังไม่จบ)

**เกิดเมื่อ**
- `POST /api/organizations/:id/submit` — คำขอ `DRAFT`/`RETURNED` ผ่าน `submitSchema` รหัสหน่วยงานไม่เป็นของหน่วยงานอื่น (`organizations.ts:2125`)
  ผู้มีอำนาจฯ ไม่ชนใคร (`approverConflict`, `:2143`) มีเอกสารที่สร้างแล้ว มีผู้ประสานงาน BDI อย่างน้อยหนึ่งคน — ข้อใดไม่ผ่านได้ 4xx ไม่มีแถว
- `POST /api/dataset-requests/:id/submit` — คำขอ `DRAFT`/`RETURNED` ผ่าน `datasetSubmitSchema` มี `DATA_DICTIONARY` และ `GENERATED_FORM` ที่ ACTIVE มีผู้ประสานงาน BDI
- **`POST /api/organizations/:id/review`** — ผลเป็น `PASSED` หรือ `APPROVED` แต่คำขอยังไม่ถึง `APPROVED` (ด่าน `BDI_OFFICER_REVIEW` และ `ORGANIZATION_APPROVAL`) รายละเอียดที่ 4.9

| ช่อง | นำส่ง | ด่านตรวจของหน่วยงาน |
|---|---|---|
| actor | **แถว session** = ผู้นำส่ง | **แถว session** = ผู้ตรวจ |
| subject | ORR หรือ DRR · คำขอ | ORR · คำขอ |
| organization_id | หน่วยงานของคำขอ | หน่วยงานของคำขอ |
| before / after | null / `{requestNumber}` | null / `{taskType, result, note}` |
| metadata | ไม่มี (มีแต่คีย์ระบบ) | ไม่มี |

- **รูปของ `after` คือทางเดียวที่แยกการนำส่งจริงออกจากการผ่านด่าน** — สำเนายก `after.taskType` ขึ้นเป็น `gate` และจัดแถวที่มีมันเป็น category `review` (3.5)
- นำส่งครั้งแรกกับนำส่งใหม่หลัง `RETURNED` แยกกันไม่ได้ในแถว ต้องดูว่ามี `REQUEST_RETURNED` มาก่อนหรือไม่ · การเปิดด่าน
  `BDI_OFFICER_REVIEW` ไม่มีแถวของตัวเอง
- ฝั่งชุดข้อมูลเขียน**หลัง** `notifyUsers()` ถ้าการแจ้งเตือน throw การนำส่ง commit แล้วแต่ไม่มีแถว
- **โค้ด** `routes/organizations.ts:2191` · `routes/dataset-requests.ts:1420` · `routes/organizations.ts:2689` (ด่านตรวจ)

#### `REQUEST_UPDATED` — admin แก้ snapshot ของคำขอโดยตรง

เขียนทับค่าที่ฟอร์มของหน่วยงานล็อกไว้ได้ ทำได้ทุกสถานะรวม `APPROVED` ต่างจาก `REQUEST_DRAFT_SAVED` ที่เป็นคนในหน่วยงานแก้ร่างตัวเอง

**เกิดเมื่อ**
- `PUT /api/admin/registrations/organizations/:id` (`:id` เป็น uuid หรือเลขที่คำขอ) — body ผ่าน schema และมี `reason` 10–500 ตัว
- `PUT /api/admin/registrations/datasets/:id` — เหมือนกัน

เขียน**ทุกครั้งที่ได้ 200** แม้ไม่มีอะไรเปลี่ยน

| ช่อง | ค่า |
|---|---|
| actor | **แถว admin** |
| subject | ORR หรือ DRR · คำขอ |
| organization_id | หน่วยงานของคำขอ |
| result | `SUCCESS` |
| before / after | `diffFields()` **ดิบ** ไม่มี `sanitizeDiff` ไม่มี `blankAsNull` (`""` กับ null นับว่าต่าง) · ไม่เปลี่ยน = null / null · คีย์ชุดเดียวกับ `REQUEST_DRAFT_SAVED` (หน่วยงานมี `organizationCode` เพิ่ม) |

| metadata | ความหมาย | ตัวอย่าง |
|---|---|---|
| `reason` | เหตุผลที่ admin พิมพ์ | `"หน่วยงานแจ้งแก้เบอร์โทรผู้ประสานงานทางอีเมล"` |
| `updated_via` | ช่องทาง | `"ADMIN_API"` |
| `request_number` | เลขที่คำขอ | `"ORG-REG-2026-0001"` |
| `status` | สถานะตอนอ่าน (การแก้ไม่เปลี่ยนสถานะ) | `"UNDER_REVIEW"` |
| `fields_changed` | คีย์ของ `after` (`[]` ถ้าไม่เปลี่ยน) | `["userPhoneNumber", "approverCid"]` |

- **ข้อมูลส่วนบุคคล สูง** `approverCid` `userCid` **เต็ม**เมื่อเปลี่ยน พร้อมชื่อ ตำแหน่ง อีเมล เบอร์โทร · ฝั่งชุดข้อมูลมี `maintainer` `maintainerEmail`
  · `reason` เป็นข้อความอิสระ ไม่ปิดใน Postgres สำเนา Mongo ปิดเลข 13 หลักใน `metadata.reason` (แผน §7.6 · 3.6) — กติกาเดียวกันกับ `reason`
  ของ `REQUEST_RESET_TO_DRAFT` `REQUEST_CANCELLED` และ `REQUEST_DELETED` ข้างล่าง
- **โค้ด** `routes/admin-registrations.ts:293` (หน่วยงาน) · `:754` (ชุดข้อมูล)

#### `REQUEST_RESET_TO_DRAFT` — คำขอถูกพากลับเป็นร่าง

ลบรอบที่กำลังเดินทิ้งทั้งรอบ ด่านที่ค้างถูกปิดเป็น `CANCELLED` ไม่มีผลการตรวจเกิดขึ้น ต่างจาก `REQUEST_RETURNED` ที่เป็นผลของด่าน

**เกิดเมื่อ**
- `POST /api/admin/registrations/organizations/:id/reset` `{reason, isRemoveApprover?}` — ไม่ใช่ `DRAFT` (ยกเว้นทางถอดผู้มีอำนาจฯ) และไม่ใช่ `APPROVED`
- `POST /api/admin/registrations/datasets/:id/reset` `{reason}` — ไม่ใช่ `DRAFT` และไม่ใช่ `APPROVED`
- `POST /api/admin/users/:id/transfer` — หนึ่งแถวต่อคำขอจดทะเบียนหน่วยงานที่ค้างอยู่ที่ด่านของคนที่ย้าย และ `cancelActiveTask()` ของธุรกรรมนี้ปิดด่านได้จริง

| ช่อง | ค่า |
|---|---|
| actor | **แถว admin** |
| subject | ORR หรือ DRR · คำขอ |
| organization_id | หน่วยงานของคำขอ (ทาง transfer = หน่วยงานต้นทาง) |
| result | `SUCCESS` |
| before / after | `{status: <เดิม>, submittedAt: <ISO หรือ null>}` / `{status: "DRAFT"}` |

| metadata | มีใน | ความหมาย | ตัวอย่าง |
|---|---|---|---|
| `reason` | ทุกทาง | เหตุผลที่ admin พิมพ์ (ทาง transfer = เหตุผลของการย้าย) | `"หน่วยงานขอแก้ข้อมูลผู้มีอำนาจ"` |
| `reset_via` | ทุกทาง | `ADMIN_API` = สั่งเอง · `ADMIN_TRANSFER` = ผลข้างเคียงของการย้าย | `"ADMIN_API"` |
| `request_number` | ทุกทาง | | `"ORG-REG-2026-0001"` |
| `cancelled_task_type` | `ADMIN_API` | ด่านที่ถูกยกเลิก หรือ null | `"ORGANIZATION_APPROVAL"` |
| `is_remove_approver` | `ADMIN_API` หน่วยงาน | boolean ที่ resolve แล้ว: `isRemoveApprover ?? is_remove_approver ?? false` — รับทั้งสองชื่อ ไม่ส่งมาเลย = `false` (`admin-registrations.ts:88-98`) | `true` |
| `approver_outcome` | `ADMIN_API` หน่วยงาน | `NONE` · `INVITATION_REVOKED` · `ACCOUNT_DELETED` · `KEPT_ACTIVE` · `DEACTIVATED` | `"DEACTIVATED"` |
| `transferred_user_account_id` | `ADMIN_TRANSFER` | คนที่ย้าย | `"9c1e…"` |
| `approver_cleared` | `ADMIN_TRANSFER` | อีเมลผู้มีอำนาจฯ ใน snapshot ถูกล้างเพราะเป็นคนที่ย้าย (ไม่เก็บอีเมลนั้น) | `true` |

- แถวที่ตามมาตาม `approver_outcome`: `DEACTIVATED` → `USER_ACCOUNT_DEACTIVATED` + `ACTIVATION_KEY_REVOKED` (และ `ROLE_REVOKED` +
  `SESSION_REVOKED` ในธุรกรรมก่อนหน้า) · `INVITATION_REVOKED` → `APPROVER_INVITATION_RECALLED` + `ACTIVATION_KEY_REVOKED` ·
  `ACCOUNT_DELETED` → `APPROVER_INVITATION_RECALLED` · `KEPT_ACTIVE` และ `NONE` ไม่มีแถวตาม (แถว `ACTIVATION_KEY_REVOKED` และ
  `SESSION_REVOKED` ในลำดับนี้มีเมื่อมีคีย์ `ISSUED` หรือ session เปิดอยู่เท่านั้น)
- **ข้อมูลส่วนบุคคล** `reason` ข้อความอิสระ (สำเนา Mongo ปิดเลข 13 หลัก)
- **โค้ด** `routes/admin-registrations.ts:530` · `:844` · `routes/admin-users.ts:1452`

#### `REQUEST_CANCELLED` — คำขอชุดข้อมูลถูกยกเลิก (แถวยังอยู่)

ผู้ยื่นหรือ admin ถอนเรื่อง ไม่ใช่ผู้ตรวจปฏิเสธ ตั้งแต่ 2026-09-25 รวมร่างที่ยังไม่เคยนำส่งด้วย

**เกิดเมื่อ**
- `DELETE /api/dataset-requests/:id` — ผู้ใช้ถือ `ORGANIZATION_USER` คำขอ `DRAFT`/`RETURNED` (`cancelled_via: ORGANIZATION`)
- `POST /api/admin/registrations/datasets/:id/cancel` `{reason}` — คำขอยังไม่ถูกยกเลิกและยังไม่อนุมัติ (`cancelled_via: ADMIN_API`)

| ช่อง | หน่วยงาน | admin |
|---|---|---|
| actor | **แถว session** = ผู้ใช้ของหน่วยงาน | **แถว admin** |
| subject / organization_id | DRR · คำขอ / หน่วยงานของคำขอ | เหมือนกัน |
| before | `{status, submittedAt}` | `{status}` |
| after | `{status: "CANCELLED", reason: "หน่วยงานยกเลิกคำขอเอง"}` | `{status: "CANCELLED"}` |

| metadata | ความหมาย | ตัวอย่าง |
|---|---|---|
| `request_number` | เลขที่คำขอ | `"DS-REG-2026-0007"` |
| `cancelled_via` | ช่องทาง | `"ORGANIZATION"` · `"ADMIN_API"` |
| `had_submitted` | *หน่วยงานเท่านั้น* — เคยเดินผ่านการตรวจหรือไม่ (`Boolean(submittedAt)`) ทาง admin ไม่เขียนคีย์นี้ ดู `before.status` แทน | `false` |
| `reason` | *admin* — เหตุผลที่พิมพ์ | `"หน่วยงานโทรแจ้งขอถอนคำขอ"` |
| `cancelled_task_type` | *admin* — ด่านที่ถูกยกเลิก หรือ null | `"BDI_OFFICER_REVIEW"` |

- **ข้อมูลส่วนบุคคล** `metadata.reason` ของทาง admin เป็นข้อความอิสระ (สำเนา Mongo ปิดเลข 13 หลัก) ส่วน `after.reason` ของทางหน่วยงานเป็นข้อความคงที่
- **โค้ด** `routes/dataset-requests.ts:1001` · `routes/admin-registrations.ts:974`

#### `REQUEST_DELETED` — คำขอชุดข้อมูลถูกลบทั้งใบ

แถวนี้เป็นหลักฐานชิ้นเดียวว่าเคยมีคำขอเลขนี้ ชุดข้อมูล ลายเซ็น การยอมรับเอกสาร review task การแจ้งเตือน และไฟล์แนบที่ถูกลบตาม
**ไม่มีแถวของตัวเอง**

**เกิดเมื่อ**
- `DELETE /api/admin/registrations/datasets/:id` `{reason}` — ทุกสถานะรวม `APPROVED`

| ช่อง | ค่า |
|---|---|
| actor | **แถว admin** |
| subject | DRR · id ของคำขอที่ไม่มีอยู่แล้ว |
| organization_id | หน่วยงานของคำขอ |
| result | `SUCCESS` |
| before / after | `{requestNumber, status, title, createdAt, createdBy, submittedAt, approvedAt, datasets: [{id, datasetCode, status}], attachments: [{id, attachmentType, storageBucket, storageKey, originalFileName}]}` / null |

| metadata | ความหมาย | ตัวอย่าง |
|---|---|---|
| `reason` | เหตุผลที่ admin พิมพ์ | `"คำขอทดสอบหลุดขึ้น production"` |
| `deleted_via` | ช่องทาง | `"ADMIN_API"` |
| `request_number` | เลขที่คำขอ — ที่เดียวที่เหลือ เพราะแถวคำขอหายแล้ว relay จึงเอาเลขที่ของทุกแถวของคำขอนั้นจากแถวนี้ (3.3) และ API อ่าน log ใช้แถวนี้หา id กับช่วงชีวิตของเลขที่ (3.11) | `"DS-REG-2026-0003"` |
| `removed_counts` | จำนวนที่ถูกลบตาม `{legalAcceptances, signatures, reviewTasks, notifications, integrationOperations, attachments, datasets}` | `{"reviewTasks": 4, "attachments": 3, …}` |

- object ของไฟล์ยังอยู่ใน bucket — `storageKey` ในแถวนี้มีไว้ตามไปเก็บกวาด แต่ `attachments` มีแค่ไฟล์ที่ยัง **ACTIVE** (ของคำขอและของ
  ชุดข้อมูลที่เกิดจากมัน `admin-registrations.ts:1066-1083`) ไฟล์ที่ `REPLACED` หรือถูกลบจากฟอร์มไปก่อนหน้าไม่อยู่ในรายการ รายการนี้จึง
  **ไม่ใช่บัญชีครบ**ของ object ที่ต้องเก็บกวาด — ไฟล์ที่เหลือหาได้จาก `attachment.attachment` ที่ `owner_id` = id ของคำขอ
- **ข้อมูลส่วนบุคคล** `createdBy` ชื่อไฟล์ `reason` — สำเนาแทนเลขบัตรในทุกค่าที่เป็นข้อความด้วย `[cid]` รวม
  `title` · ชื่อไฟล์ใน `attachments[]` ใช้กฎแคบ — เลขบัตรที่คั่นด้วยจุดหรือขีดล่างในชื่อไฟล์รอด (3.6)
- **โค้ด** `routes/admin-registrations.ts:1169`

---

### 4.8 หมวด document — ไฟล์แนบ การดาวน์โหลด และการลงนาม

#### `ATTACHMENT_UPLOADED` · `ATTACHMENT_REPLACED` — อัปโหลดไฟล์แนบ

เขียนจากจุดเดียวกัน รหัสเลือกตาม `attachment.replacedAttachmentId`: ไม่มีไฟล์ ACTIVE ในช่องนั้นมาก่อน = `UPLOADED` มี = `REPLACED`
รูปของแถวเหมือนกันทุกอย่าง

**เกิดเมื่อ**
- `POST /api/organizations/:id/attachments` (multipart `file` + `kind`) — `kind` เป็นคำสั่งแต่งตั้งหรือหนังสือมอบอำนาจ ไฟล์ PDF ≤ 10 MB คำขอ `DRAFT`/`RETURNED`
- `POST /api/dataset-requests/:id/attachments` — `kind` เป็น `DATA_DICTIONARY` หรือ `EXAMPLE_DATA` ชนิดไฟล์ผ่าน ≤ 10 MB คำขอ `DRAFT`/`RETURNED`

| ช่อง | ค่า |
|---|---|
| actor | **แถว session** |
| subject | ATT · **ไฟล์ใหม่** |
| organization_id | หน่วยงานของคำขอ |
| result | `SUCCESS` |
| before / after | null / `{attachmentType, filename}` — `attachmentType` เป็น `AUTHORIZED_REPRESENTATIVE_APPOINTMENT_ORDER` `POWER_OF_ATTORNEY` `DATA_DICTIONARY` หรือ `EXAMPLE_DATA` |
| metadata | ไม่มี (มีแต่คีย์ระบบ) |

- แถวไม่มี id หรือเลขที่ของคำขอ (subject คือไฟล์) และไม่บันทึกไฟล์ที่ถูกแทน ชนิด MIME ขนาด หรือ hash — ต้อง join
  `attachment.owner_id` / `replaced_attachment_id` · สำเนาหา `requestNumber` ผ่านเจ้าของไฟล์ (relay — 3.3) แต่สำเนา `audit_fallback` ไม่มี
- **ข้อมูลส่วนบุคคล** `filename` เป็นข้อความที่ผู้ใช้ตั้งเอง อาจมีชื่อคนหรือเลขบัตร ไม่ปิด
- **ตัวอย่าง** `{"after": {"attachmentType": "DATA_DICTIONARY", "filename": "พจนานุกรมข้อมูล_OPD.xlsx"}}`
- **โค้ด** `routes/organizations.ts:1550` · `routes/dataset-requests.ts:1081`

#### `ATTACHMENT_DELETED` — ลบไฟล์แนบออกจากฟอร์ม

**เกิดเมื่อ**
- `DELETE /api/organizations/:id/attachments/:attachmentId` — คำขอ `DRAFT`/`RETURNED` ไฟล์เป็นคำสั่งแต่งตั้งหรือหนังสือมอบอำนาจที่ยัง ACTIVE
- `DELETE /api/dataset-requests/:id/attachments/:attachmentId` — คำขอ `DRAFT`/`RETURNED` ไฟล์เป็น `DATA_DICTIONARY` หรือ `EXAMPLE_DATA` ที่ยัง ACTIVE

ไฟล์ที่ไม่ ACTIVE แล้วได้ 204 **โดยไม่มีแถว** · เป็น soft delete object ยังอยู่ใน storage

| ช่อง | ค่า |
|---|---|
| actor | **แถว session** |
| subject / organization_id | ATT · ไฟล์ / หน่วยงานของคำขอ |
| before / after | `{attachmentType, filename}` / null |
| metadata | ไม่มี — เหตุผล `"ผู้กรอกลบไฟล์ออกจากฟอร์ม"` อยู่บนแถวไฟล์ ไม่อยู่ในแถวนี้ |

- **โค้ด** `routes/organizations.ts:1683` · `routes/dataset-requests.ts:1211`

#### `DOCUMENT_DOWNLOADED` — เปิดหรือดาวน์โหลดไฟล์

เขียน**ก่อน**ส่งไฟล์หรือ render ไฟล์ที่ส่งไม่สำเร็จก็มีแถว การพรีวิวใน `<iframe>` ก็ใช้เส้นทางเดียวกัน หน้าจอที่แสดงเอกสารหลายฉบับ
จึงเขียนหลายแถวต่อการเปิดหนึ่งครั้ง (320 จาก 1,467 แถวของ SIT เป็นรหัสนี้ — แผน §13)

**เกิดเมื่อ**
- `GET /api/organizations/:id/attachments/:attachmentId` — ผู้เรียกดูคำขอได้ ไฟล์เป็นของคำขอนั้น (ทุกชนิด ทุกสถานะ)
- `GET /api/dataset-requests/:id/attachments/:attachmentId` — เหมือนกัน (`?download` หรือ inline ก็ได้แถวเหมือนกัน)
- `GET /api/organizations/:id/legal-documents/:versionId/file` — มีฉบับ render ของคำขอนี้ (ส่งฉบับ render สด)
- `GET /api/organizations/:id/legal-documents/:versionId/file` — ไม่มีฉบับของคำขอ ส่ง**ไฟล์กลางของเวอร์ชัน**แทน
- `GET /api/dataset-requests/:id/legal-documents/:versionId/file` — สองทางเหมือนฝั่งหน่วยงาน

| ช่อง | ค่า |
|---|---|
| actor | **แถว session** = ใครก็ตามที่ดูคำขอได้ (หน่วยงาน · เจ้าหน้าที่ BDI · ผู้เชี่ยวชาญที่ได้รับมอบหมาย · ผู้มีอำนาจฯ) |
| subject | ATT · ไฟล์ที่ส่ง — **ทางไฟล์กลาง subject เป็นไฟล์เดียวกันของทุกหน่วยงาน** |
| organization_id | หน่วยงานของคำขอ (ไม่ใช่ของผู้อ่าน) |
| result | `SUCCESS` |
| before / after | null / ไฟล์แนบ: `{filename}` · เอกสารกฎหมาย: `{filename, legalDocumentVersionId}` |
| metadata | ไม่มี (มีแต่คีย์ระบบ) |

- แยกพรีวิวออกจากดาวน์โหลดจริงไม่ได้ · แถวไม่มี id ของคำขอ ทางไฟล์กลางต้องใช้ `organization_id` กับเวลาหรือ correlation id
- `:id` ของ `GET /api/organizations/:id/legal-documents/:versionId/file` เป็นได้ทั้ง id ของคำขอ**และ id ของหน่วยงาน**
  (`findRequestByRequestOrOrganizationId()`, `organizations.ts:1994`) — แถวไม่บันทึกว่าเรียกด้วยแบบไหน
- **โค้ด** `routes/organizations.ts:1585` · `:2050` · `:2086` · `routes/dataset-requests.ts:1115` · `:1710` · `:1744`

#### `DOCUMENT_SIGNED` — ลงนามอิเล็กทรอนิกส์

รูปเดียวกันทั้งสองเส้นทาง ค้นการลงนามทุกทางได้ด้วยรหัสเดียว หลักฐานเต็ม (ชื่อที่ลงนาม ข้อความยืนยัน IP) อยู่ใน
`signature.signature_confirmation` และ `legal_acceptance` ไม่ได้อยู่ในแถวนี้

**เกิดเมื่อ** (อนุมัติพร้อม `signature` ที่ครอบทุกเอกสารที่เผยแพร่อยู่)
- `POST /api/organizations/:id/review` ที่ด่าน `ORGANIZATION_APPROVAL` หรือ `BDI_FINAL_APPROVAL`
- `POST /api/dataset-requests/:id/review` ที่ด่าน `ORGANIZATION_APPROVAL` หรือ `BDI_FINAL_APPROVAL` — ตามหลัง `REQUEST_APPROVED`

| ช่อง | ค่า |
|---|---|
| actor | **แถว session** = ผู้ลงนาม |
| subject / organization_id | ORR หรือ DRR · คำขอ / หน่วยงานของคำขอ |
| before / after | null / `{confirmationType, documentVersionIds}` |
| metadata | ไม่มี (มีแต่คีย์ระบบ) |

- `confirmationType` = `ORGANIZATION_APPROVAL` หรือ `BDI_FINAL_APPROVAL` · `documentVersionIds` = id ของ `legal_document_version` ที่ลงนาม
  (ฝั่งหน่วยงานไม่รวมฉบับที่ข้ามว่าไม่เกี่ยวข้อง) · id ของ `signature_confirmation` ไม่ถูกบันทึก · การ render ฉบับลงนามซ้ำไม่มีแถว
- **render ฉบับลงนามหลัง commit ล้ม** (ตัวแปลงล่มหลังบันทึกการลงนาม) — คำขอยังตอบ **200** พร้อม `agreementRendered: false` (หน่วยงาน) หรือ
  `documentRendered: false` (ชุดข้อมูล) แถวผลการตรวจและ `DOCUMENT_SIGNED` มีครบ ฉบับลงนามที่ขาดไปเห็นได้จาก error event
  `render.agreement-after-commit` / `render.dataset-document-after-commit` (`organizations.ts:2861` · `dataset-requests.ts:2176`, 5.1) เท่านั้น ·
  ถ้าล้ม**ก่อน** commit ไม่มีแถวใดถูกเขียน และ 5xx นั้นถูกเก็บเป็น `render:<code>` ที่ตัวจัดการท้าย `index.ts` — route ตรวจของหน่วยงานส่ง
  `DocumentRenderError` ต่อด้วย `next(err)` ตั้งแต่ขั้น 5 (ตัวอย่างใน 5.2)
- **ตัวอย่าง** `{"after": {"confirmationType": "ORGANIZATION_APPROVAL", "documentVersionIds": ["9b0e…"]}}`
- **โค้ด** `routes/organizations.ts:2728` · `routes/dataset-requests.ts:2136`

---

### 4.9 หมวด review — การตรวจ

ทั้งสองเส้นทางเขียนผลการตรวจจาก `logAudit` **จุดเดียว**ต่อเส้นทาง รหัสเลือกด้วยสูตร และ `after` เป็น `{taskType, result, note}`
เสมอ (`note` หายจาก JSON ถ้าไม่ได้ส่ง) **รหัสกับ `after.result` ไม่ตรงกันเสมอไป** อ่านตารางนี้ก่อนค้น:

| เส้นทาง · ด่าน (`after.taskType`) | action ของผู้ตรวจ | `after.result` | รหัสที่เขียน |
|---|---|---|---|
| หน่วยงาน · `BDI_OFFICER_REVIEW` | `approve` | `PASSED` | **`REQUEST_SUBMITTED`** |
| หน่วยงาน · `ORGANIZATION_APPROVAL` | `approve` + ลงนาม | `APPROVED` | **`REQUEST_SUBMITTED`** (+ `DOCUMENT_SIGNED`) |
| หน่วยงาน · `BDI_FINAL_APPROVAL` | `approve` + ลงนาม | `APPROVED` | `REQUEST_APPROVED` (+ `ORGANIZATION_ACTIVATED` + `DOCUMENT_SIGNED`) |
| หน่วยงาน · ด่านใดก็ได้ | `request_revision` (note ≥ 10 ตัว) | `RETURNED` | `REQUEST_RETURNED` |
| หน่วยงาน · `ORGANIZATION_APPROVAL` | `recall` (note ≥ 10 ตัว) โดยผู้ประสานงาน BDI | `RETURNED` | `REQUEST_RETURNED` (+ [`APPROVER_INVITATION_RECALLED`]) |
| หน่วยงาน · ด่านใดก็ได้ | `reject` (note ≥ 10 ตัว) | `REJECTED` | `REQUEST_REJECTED` |
| ชุดข้อมูล · `BDI_OFFICER_REVIEW` | `approve` · `forward` · `confirm` | `PASSED` | **`REQUEST_APPROVED`** |
| ชุดข้อมูล · `ORGANIZATION_APPROVAL` | เหมือนกัน + ลงนาม | `APPROVED` | `REQUEST_APPROVED` (+ `DOCUMENT_SIGNED`) |
| ชุดข้อมูล · `BDI_FINAL_APPROVAL` | เหมือนกัน + ลงนาม | `APPROVED` | `REQUEST_APPROVED` + `dataset_id` (+ `DOCUMENT_SIGNED`) |
| ชุดข้อมูล · ด่านใดก็ได้ | `request_revision` | `RETURNED` | `REQUEST_RETURNED` |
| ชุดข้อมูล · ด่านใดก็ได้ | `reject` | `REJECTED` | `REQUEST_REJECTED` |

ใช้ `after.taskType` (ในสำเนาคือ `gate`) บอกว่าด่านไหน อย่าใช้รหัสอย่างเดียว คอลัมน์ `result` ของแถวเป็น `SUCCESS` เสมอ
ผลของการตรวจอยู่ใน `after.result` · recall กับ `request_revision` ที่ `ORGANIZATION_APPROVAL` หน้าตาเหมือนกัน (ทั้งสองต้องมี note ≥ 10 ตัว
เหมือนทุก action ที่ไม่ใช่ `approve` `organizations.ts:2296`) — ตัวแยกที่เชื่อได้คือ **`actor_roles` ที่มี `BDI_OFFICER`** (ผู้มีอำนาจฯ ไม่มี role นั้น)
แถว `APPROVER_INVITATION_RECALLED` ที่ correlation id เดียวกันมี**เฉพาะ**เมื่อ `releaseApproverSeat()` คืนที่นั่ง — ไม่มีเมื่อคำขอไม่มี
`approverEmail` หรือหาบัญชีของอีเมลนั้นไม่เจอ (`lib/approver-seat.ts:63-66`) การไม่มีแถวนั้นจึงไม่ได้แปลว่าไม่ใช่ recall

#### `REQUEST_APPROVED` · `REQUEST_RETURNED` · `REQUEST_REJECTED` — ผลของด่าน

**เกิดเมื่อ** — `POST /api/organizations/:id/review` และ `POST /api/dataset-requests/:id/review` ตามตารางข้างบน หลังธุรกรรมของการตรวจ commit
(WorkflowError เช่นไม่มีผู้ตรวจของด่านถัดไป = rollback ไม่มีแถว · render ฉบับลงนามที่ล้ม**หลัง** commit ไม่ย้อนอะไร แถวอยู่ครบและคำขอตอบ 200 — `DOCUMENT_SIGNED` ใน 4.8)

| ช่อง | ค่า |
|---|---|
| actor | **แถว session** = ผู้ถือ role ของด่าน (`BDI_OFFICER` · `ORGANIZATION_APPROVER` · `BDI_FINAL_APPROVER`) — **ยกเว้น recall**: `REQUEST_RETURNED` ที่ `after.taskType ORGANIZATION_APPROVAL` เขียนโดย `BDI_OFFICER` ซึ่งไม่ได้ถือ role ของด่านนั้น (ทาง recall ข้ามการตรวจ role ไปใช้ `recallRefusal()` แทน `organizations.ts:2349-2354`) |
| subject / organization_id | ORR หรือ DRR · คำขอ / หน่วยงานของคำขอ |
| result | `SUCCESS` |
| before / after | null / `{taskType, result, note?}` |

| metadata | ความหมาย | ตัวอย่าง |
|---|---|---|
| `dataset_id` | *ชุดข้อมูล `BDI_FINAL_APPROVAL` เท่านั้น* — ชุดข้อมูลที่การอนุมัตินี้สร้าง | `"a8e3…"` |
| `integration_operation_id` | *เหมือนข้างบน* — งาน DII `PUBLISH_DATASET_REFERENCE` ที่รอส่ง (correlation id เดียวกับแถวนี้) | `"51fd…"` |

- **ข้อมูลส่วนบุคคล** `note` เป็นข้อความอิสระของผู้ตรวจ (ส่งกลับและปฏิเสธต้องมี) ไม่ปิดใน Postgres สำเนา Mongo ปิดเลข 13 หลักในนั้น
- `note` ไม่มีเพดานใน zod ยาวได้เท่าเพดาน body 1 MB (`index.ts:54`) ขณะที่เอกสาร `activity` หนึ่งตัวต้องไม่เกิน 64 KB (แผน §3) —
  สำเนาตัดแถวที่ใหญ่เกินแบบกำหนดได้ (`fitDocument` — ข้อความเหลือ 2 KB 256 หรือ 32 ตัวตามที่ต้อง แล้วจึงสรุปเป็นชื่อคีย์ — 3.2) ไม่ข้ามและไม่ล้ม
  ตัวเต็มอยู่ใน Postgres ใช้กับ `SPECIALIST_COMMENT_RECORDED` ด้วย
- **ตัวอย่าง** `{"after": {"taskType": "BDI_FINAL_APPROVAL", "result": "APPROVED", "note": "ข้อมูลครบถ้วน อนุมัติ"}, "metadata": {"dataset_id": "e1f2…", "integration_operation_id": "0a1b…"}}`
- **โค้ด** `routes/organizations.ts:2689` · `routes/dataset-requests.ts:2115`

#### `REQUEST_ASSIGNED` — ผู้ประสานงาน BDI ขอความเห็นผู้เชี่ยวชาญด้านข้อมูล หรือถอน

การมอบหมายไม่ใช่ด่าน ไม่มี review task ให้ย้อนดู และ `assigned_specialist_id` ถูกเขียนทับ แถวนี้จึงเป็นประวัติเดียวว่าเคยขอใคร

**เกิดเมื่อ**
- `POST /api/dataset-requests/:id/assign` `{specialistId: uuid | null}` — ผู้เรียกถือ `BDI_OFFICER` ด่านปัจจุบันคือ `BDI_OFFICER_REVIEW`
  และผู้เชี่ยวชาญ**เปลี่ยนจริง** (มอบ · เปลี่ยนคน · ถอน) มอบคนเดิมซ้ำไม่มีแถว

| ช่อง | ค่า |
|---|---|
| actor | **แถว session** = ผู้ประสานงาน BDI |
| subject / organization_id | DRR · คำขอ / หน่วยงานของคำขอ |
| before / after | `{assignedSpecialistId: <เดิม หรือ null>}` / `{assignedSpecialistId: <ใหม่ หรือ null>}` — `after` null = ถอน |

| metadata | ความหมาย | ตัวอย่าง |
|---|---|---|
| `request_number` | เลขที่คำขอ | `"DS-REG-2026-0007"` |

- เขียนก่อนการแจ้งเตือนและก่อนอีเมล inline · **โค้ด** `routes/dataset-requests.ts:1529`

#### `SPECIALIST_COMMENT_RECORDED` — ผู้เชี่ยวชาญบันทึกความเห็น

ความเห็นไม่ปิดด่านและไม่ย้ายคำขอ แต่เป็นสิ่งที่ผู้ประสานงานใช้ตัดสินต่อ

**เกิดเมื่อ**
- `POST /api/dataset-requests/:id/review` `{action: "comment", note}` — ผู้เรียกคือผู้เชี่ยวชาญที่ได้รับมอบหมาย ด่านปัจจุบันคือ
  `BDI_OFFICER_REVIEW` และ `note` ไม่ว่าง

| ช่อง | ค่า |
|---|---|
| actor | **แถว session** = ผู้เชี่ยวชาญ (`BDI_DATASET_SPECIALIST`) |
| subject / organization_id | DRR · คำขอ / หน่วยงานของคำขอ |
| before / after | null / `{taskType: "DATASET_SPECIALIST_REVIEW", note}` |
| metadata | ไม่มี (มีแต่คีย์ระบบ) |

- **ข้อมูลส่วนบุคคล** `note` ไม่จำกัดความยาว (ดูเพดาน 64 KB ของสำเนาใน `REQUEST_APPROVED` ข้างบน) — บน review task มันเป็น `BDI_INTERNAL`
  แต่ในแถวนี้ไม่มีข้อจำกัดนั้น และ**สำเนา Mongo ก็ไม่พาข้อจำกัดนั้นไปด้วย** ใครอ่าน `activity` ได้ก็อ่านความเห็นได้ · สำเนาปิดเลข 13 หลักใน
  `after.note` นี้ด้วย (กฎเลขบัตรของสำเนาใช้กับทุกค่าที่เป็นข้อความ — 3.6)
- **โค้ด** `routes/dataset-requests.ts:1884`

---

### 4.10 หมวด config — ค่าที่เปลี่ยนได้โดยไม่ต้อง deploy

ทั้งสามรหัสเป็น**แถว admin** organization_id null result `SUCCESS`

#### `LEGAL_DOCUMENT_PUBLISHED` — เผยแพร่ template เอกสารกฎหมายเวอร์ชันใหม่

**เกิดเมื่อ** `POST /api/admin/legal-documents/:code/versions` (อัปโหลด `.docx`) — `publishVersion()` สำเร็จ

| ช่อง | ค่า |
|---|---|
| subject | `LEGAL_DOCUMENT` · **id ของเวอร์ชัน** (`legal_document_version`) ไม่ใช่ของเอกสาร |
| before / after | null / `{documentCode, versionNumber, filename, placeholders}` |

| metadata | ความหมาย | ตัวอย่าง |
|---|---|---|
| `legal_document_id` | id ของเอกสาร ใช้จับคู่กับ `LEGAL_DOCUMENT_UPDATED` (แถวก่อนการ์ดไม่มี) | `"3e7a…"` |

- ไม่มีคีย์ `*_via` ต่างจากแถว admin อื่น · **โค้ด** `routes/admin.ts:1552`

#### `LEGAL_DOCUMENT_UPDATED` — แก้ข้อมูลประจำตัวของเอกสารกฎหมาย

**เกิดเมื่อ** `PATCH /api/admin/legal-documents/:code` — `shortname` `legalNotice` หรือ `isRequired` เปลี่ยนจริงอย่างน้อยหนึ่งช่อง
(ไม่เปลี่ยน = 200 `changed:false` ไม่มีแถว) แถวก่อนการ์ดของเส้นทางนี้ใช้รหัส `LEGAL_DOCUMENT_PUBLISHED`

| ช่อง | ค่า |
|---|---|
| subject | `LEGAL_DOCUMENT` · id ของเอกสาร |
| before / after | เฉพาะช่องที่เปลี่ยน จาก `shortname` (string\|null) `legalNotice` (string\|null) `isRequired` (boolean) |

| metadata | ความหมาย | ตัวอย่าง |
|---|---|---|
| `document_code` | รหัสเอกสาร | `"A3"` |
| `changed_via` | ช่องทาง | `"ADMIN_API"` |

- **โค้ด** `routes/admin.ts:1450`

#### `DATASET_CHOICE_CHANGED` — เพิ่มหรือแก้ตัวเลือกของแบบฟอร์มชุดข้อมูล

**เกิดเมื่อ**
- `POST /api/admin/dataset-choices/:fieldKey` — เพิ่มตัวเลือก (`operation: CREATE`) ฟิลด์ที่ผูกกฎ (`dataClassification`, `licenseId`) ได้ 409
- `PATCH /api/admin/dataset-choices/:fieldKey/:code` — แก้ป้าย ลำดับ หรือเปิด/ปิด (`operation: UPDATE`) เขียนทุกครั้งแม้ค่าไม่เปลี่ยน

| ช่อง | ค่า |
|---|---|
| subject | `DATASET_CHOICE` · id ของแถว `administration.dataset_choice` |
| before / after | CREATE: null / แถวใหม่ทั้งแถว · UPDATE: แถว**ทั้งแถว**ก่อน / หลัง (ไม่ใช่ diff) — `{id, fieldKey, code, labelTh, labelEn, displayOrder, isActive}` |

| metadata | ความหมาย | ตัวอย่าง |
|---|---|---|
| `field_key` | ฟิลด์ของฟอร์ม | `"dataFormat"` |
| `code` | รหัสตัวเลือก | `"09"` |
| `changed_via` | ช่องทาง | `"ADMIN_API"` |
| `operation` | ชนิดการเปลี่ยน | `"CREATE"` · `"UPDATE"` |

- **โค้ด** `routes/admin.ts:1779` · `:1857` · `POST /api/admin/dataset-choices/refresh` ไม่เขียนแถว (แตะแค่แคช)

---

### 4.11 หมวด admin-access — token ที่ถูกปฏิเสธ และการเรียก admin API

สามรหัสใน category `admin-access` ของสำเนา (ลบที่ 400 วัน · `ADMIN_API_REQUEST` ที่ token ไม่ผ่าน 90 วัน — 3.9): สองรหัสแรกลง Postgres แบบ throttle
รหัสที่สามอยู่ใน Mongo อย่างเดียว

#### `ADMIN_TOKEN_REJECTED` — `x-admin-token` ผิดหรือไม่ได้ส่ง

token นี้เปิดทุกอย่างใต้ `/api/admin` ไม่หมดอายุ และเคยหลุดมาแล้ว การเดาหรือการใช้ค่าเก่าหลังหมุนต้องมองเห็นได้ แต่ 401 ใครก็ยิงได้
ไม่จำกัด จึงเขียนแบบ throttle (เหตุผลเต็มอยู่ docs/09 §4.1 และหัวไฟล์ `lib/token-rejection.ts`) ในสำเนาอยู่ category `admin-access` via `ANONYMOUS`
(ลบที่ 400 วัน — 3.5, 3.9)

**เกิดเมื่อ**
- คำขอใดก็ได้ใต้ `/api/admin/*` `/api/admin/users/*` `/api/admin/registrations/*` (รวม path ที่ไม่มีจริง) ที่ `x-admin-token` ผิดหรือไม่มี —
  `requireAdminToken` เรียก `adminTokenRejections.record()` แล้วตอบ 401 ทันที — **ไม่เกิด**กับคำขอที่ตัวอ่าน body ปฏิเสธก่อนถึง router (ได้แค่
  `ADMIN_API_REQUEST` แบบ `token_checked: false`) และกับ CORS preflight (`OPTIONS` — `cors()` ตอบก่อน ไม่มีบันทึกใดเลย) การตัดสินว่าได้แถวไหมอยู่ในตารางนี้:

| ชนิดแถว | เมื่อไร | `correlation_id` | IP / UA | metadata |
|---|---|---|---|---|
| **ทันที** | ครั้งแรกของที่มา (IP) ในหน้าต่าง 10 นาที และงบแถวทันทีรวมทุก IP (20 แถวในช่วง 10 นาทีใด ๆ แบบหน้าต่างเลื่อน) ยังเหลือ | ของคำขอ | มี — ยกเว้นที่มาที่ไม่ใช่ IP: `req.ip` ที่ไม่ใช่รูป IP ทุกค่าใช้หน้าต่างเดียวกัน (`UNPARSED_KEY`) แถวได้ IP null + `ip_unparsed: true` · คำขอที่ไม่มี `req.ip` เลยใช้อีกถัง (`NO_ADDRESS_KEY`) IP null ไม่มีธง (`token-rejection.ts:83-84` `:361-369`) | `method` `path` `token_present` `token_fp` [+ `watched_over_budget`] |
| **ทันที · ถังรวม** | งบ 20 แถวหมด และถังรวมยังไม่เปิด — ที่มาใหม่หลังจากนั้นถูกนับรวมในถังเดียว | ของคำขอ | **ไม่มีทั้งคู่** | เหมือนข้างบน + `throttle_overflow: true` |
| **token ที่เฝ้า** | fingerprint อยู่ใน `ADMIN_TOKEN_WATCH_FPS` ที่มานี้ยังไม่ได้แถวในนาทีนี้ และงบ 60 แถว/10 นาทียังเหลือ — นอกงบ 20 | ของคำขอ | มี | `method` `path` `token_present` `token_fp` `watched_token: true` |
| **สรุป** | หน้าต่างปิด (ตัวกวาดทุก 60 วินาที · คำขอถัดไปของที่มาเดิมเจอหน้าต่างหมดอายุ · `flushTokenRejections()` ตอน shutdown ภายใน 2 วินาที) และมีครั้งที่ถูกนับ > 0 | **UUID ใหม่** ไม่ตรงคำขอใด | ของคำขอแรกในหน้าต่าง (ถังรวม: ไม่มี) | `suppressed_count` `window_start` `window_end` `last_rejected_at` `token_fps` `paths` [+ `token_fps_truncated` `paths_truncated` `watched_suppressed_count` `throttle_overflow`] |

| ช่อง | ค่า |
|---|---|
| actor | **แถวนิรนาม** · `source_component` = `web-portal` (token ไม่ผ่านจึงไม่ถูกประทับ `admin-portal`) · **ไม่มี** `admin_token_fp` |
| subject | `ADMIN_API` · `subject_id` null เสมอ |
| organization_id | null |
| result | `FAILURE` |
| before / after | null / null |

| metadata | ความหมาย | ตัวอย่าง |
|---|---|---|
| `method` | HTTP method | `"POST"` |
| `path` | **รูปแบบ** ของ path ไม่ใช่ข้อความดิบ (`pathPattern()`): ตัด query ถอด `%xx` ซ้ำจนไม่เปลี่ยน (≤ 4 รอบ) พร้อม NFKC (`＠` `﹫` เลขเต็มความกว้าง เป็นตัวจริง) อีเมล → `:email` ท่อนที่ยังมี `@` → `:email` ทั้งท่อน UUID → `:id` ตัวอักษรนอก `A-Za-z0-9/_.:-` → `_` กลุ่มเลขที่ชี้ตัวคน → `:n` แล้ว**ชั้นที่สอง**: ถ้าเลขที่เหลือทั้ง path ยังรวมได้ 9 หลักขึ้นไป เลขทุกช่วงกลายเป็น `:n` (จับเลขบัตรที่แยกด้วย `/` หรือ encode ซ้อน `token-rejection.ts:184-185`) ยาวไม่เกิน 120 | `"/api/admin/users/:id/suspend"` |
| `token_present` | ส่ง header มาหรือไม่ | `true` |
| `token_fp` | 12 ตัวแรกของ SHA-256 ของค่าที่ส่งมา หรือ null | `"a1b2c3d4e5f6"` |
| `watched_token` | แถวจากงบของ token ที่เฝ้า | `true` |
| `watched_over_budget` | token ที่เฝ้าแต่งบ 60 หมด จึงมาทางงบรวม | `true` |
| `throttle_overflow` | แถวของถังรวม | `true` |
| `suppressed_count` | จำนวนครั้งที่นับไว้ในหน้าต่าง (ไม่นับแถวทันที) | `57` |
| `window_start` · `window_end` · `last_rejected_at` | เวลา ISO · `window_end` ก่อน start+10 นาที = หน้าต่างถูกตัดตอน shutdown (มี deploy/restart) | `"2026-09-29T03:10:00.000Z"` |
| `token_fps` · `paths` | fingerprint และ `"METHOD path"` ที่ต่างกัน อย่างละไม่เกิน 20 | `["a1b2c3d4e5f6"]` · `["POST /api/admin/invitations"]` |
| `token_fps_truncated` · `paths_truncated` | เกิน 20 ค่า | `true` |
| `watched_suppressed_count` | ครั้งที่นับไว้ที่เป็น token ที่เฝ้า (แถวสรุปของ “ยิงซ้ำในนาทีเดียว” มีค่าเท่ากับ `suppressed_count`) | `3` |

- **ข้อมูลส่วนบุคคล** IP ที่อ้างมา (ปลอมได้) · user agent และ `path` เป็นข้อความของผู้ยิง (ปิดเลขแล้วแต่ตัวอักษรยังอยู่) · fingerprint ของ token
- ตัวนับอยู่ในหน่วยความจำต่อ process — restart ล้าง, หลาย replica นับแยก · kill แบบไม่ graceful = แถวสรุปที่ค้างหายไป
- **ตัวอย่าง (ทันที)** `{"metadata": {"method": "POST", "path": "/api/admin/invitations/:id/resend", "token_present": true, "token_fp": "a1b2c3d4e5f6"}}`
- **ตัวอย่าง (สรุป)** `{"metadata": {"suppressed_count": 37, "window_start": "2026-09-29T03:10:00.000Z", "window_end": "2026-09-29T03:20:00.000Z", "last_rejected_at": "2026-09-29T03:19:42.000Z", "token_fps": ["a1b2c3d4e5f6"], "paths": ["POST /api/admin/invitations"]}}`
- **โค้ด** `lib/token-rejection.ts:265` (`write()` จุดเดียว · แถวทันที `:413` · token ที่เฝ้า `:380` · สรุป `:271` · flush `:349`) · recorder สร้างที่ `middleware/auth.ts:156-160`
  · แถวที่เขียนไม่สำเร็จ (ทันที สรุปของตัวกวาด หรือ flush ตอน shutdown) ล้มใน `logAudit` จึงได้ `audit.write-failed` กับสำเนา `audit_fallback` เหมือนแถวอื่น (3.14)
  — `write()` ถูกยิงด้วย `void` และ `logAudit` ไม่ reject · error `audit.token-rejection` (`lib/token-rejection.ts:422`) คือ catch รอบตัว `record()` ที่เป็น synchronous: ความล้มเหลวของ
  การทำบัญชีของตัวบันทึกเอง (`tokenFingerprint` `pathPattern` `parseClientIp` หน้าต่างและงบ) ไม่ใช่การเขียนแถวที่ล้ม (5.1)

#### `LOG_TOKEN_REJECTED` — `x-log-token` ผิดหรือไม่ได้ส่ง

token ของ API อ่าน log เปิดประวัติการกระทำของทุกคน การเดาจึงต้องมองเห็นได้เหมือน admin token — เขียนด้วยตัวบันทึกเดียวกัน
(`createTokenRejectionRecorder()`, `lib/token-rejection.ts:224`) แต่ตัวนับ หน้าต่าง และงบแยกจากของ admin token (`middleware/auth.ts:195`)

**เกิดเมื่อ** คำขอใดก็ได้ใต้ `/api/admin/logs/*` (รวม path ที่ไม่มีจริง — router ของ log ตรวจ token ก่อน 404 ของตัวเอง) ที่ `x-log-token` ผิดหรือไม่ได้ส่ง —
`requireLogReader` เรียก `record()` แล้วตอบ 401 · **ไม่เกิด** เมื่อไม่ได้ตั้ง `LOG_READ_TOKEN` (ตอบ 503 `log_access_disabled` ก่อนดู token) และเมื่อตัวอ่าน body
ปฏิเสธคำขอก่อนถึง router (ได้แค่ `ADMIN_API_REQUEST` แบบ `token_checked: false` — ข้างล่าง)

- รูปของแถวทุกชนิด (ทันที · ถังรวม · สรุป) และความหมายของ metadata เหมือน `ADMIN_TOKEN_REJECTED` ข้างบนทุกข้อ ยกเว้น**ไม่มีรายการเฝ้า** — ไม่มีแถว
  `watched_token` / `watched_over_budget` / `watched_suppressed_count`
- subject `AUDIT_LOG` · `subject_id` null · **แถวนิรนาม** `FAILURE` · `source_component` = `web-portal` (token ไม่ผ่านจึงไม่ถูกประทับ `log-api`) · ในสำเนา
  category `admin-access` via `ANONYMOUS` ลบที่ 400 วัน
- **โค้ด** `middleware/auth.ts:195` (recorder) · `:265` (`record()`)

#### `ADMIN_API_REQUEST` — การเรียก `/api/admin*` หนึ่งครั้ง (**Mongo เท่านั้น**)

admin API ตอบเลขบัตรและอีเมลแบบไม่ปิดของทุกบัญชี (`GET /api/admin/users?cid=…`, `/invitations`) และ admin token เคยหลุดมาแล้ว — `audit_event` บันทึกแค่การ
เปลี่ยนแปลง การเปิดดูไม่มีร่องรอยเลย รหัสนี้ตอบ “ใครค้นเลขบัตรนี้ผ่าน admin API” และ “token ใบนี้ถูกใช้ทำอะไรบ้าง” (G8) **ไม่อยู่ใน `AuditAction`** ไม่ผ่าน
`logAudit()` ไม่แตะ Postgres (`lib/admin-access.ts`) · ไม่มีคำขอไหนรอ Mongo: listener ผูกตอนคำขอเข้า เอกสารสร้างตอนคำตอบจบแล้ววางลงคิว

**เกิดเมื่อ** ทุกคำขอใต้ `/api/admin*` ทั้งอ่านและเขียน ไม่ว่า token จะผ่านหรือไม่ — `recordAdminAccess` ติดตั้ง**หลัง `correlationMiddleware` ก่อนตัวอ่าน body**
และก่อน router ของ admin ทุกตัว (`index.ts:164`) จดตอน `finish` (หรือ `close` เมื่อผู้เรียกตัดสายก่อนจบ):

- **ยกเว้นคำขอที่ถึง router ของ log** — API อ่าน log บันทึกตัวเองเป็น `AUDIT_LOG_READ` อยู่แล้ว ตัดสินจากสิ่งที่ Express ทำจริง (`markLogApiRequest` ติดที่ mount
  เดียวกับ router ของ log — `index.ts:189`) ไม่ใช่จากข้อความของ URL: `/API/Admin/LOGS/x` ถึง router ของ log (Express ไม่สนตัวพิมพ์) จึงไม่ถูกบันทึกที่นี่ ·
  `/api/admin/%6Cogs/x` ไม่ถึง จึงเป็นการเรียก admin · คำขอของ log API ที่ตัวอ่าน body ปฏิเสธไม่ถึง router ของ log จึงถูกบันทึกที่นี่และไม่มี `AUDIT_LOG_READ` ·
  กลับกัน คำขอที่ถึง router ของ log แล้วถูกปฏิเสธก่อนขั้นอ่าน (400 404 503 — 4.12) ไม่มีทั้งสองบันทึก
- **ยกเว้น CORS preflight** — `OPTIONS` ทุกตัวใต้ `/api/admin*` ถูก `cors()` (`index.ts:145`) ตอบ 204 ก่อนถึง `recordAdminAccess` และก่อนการตรวจ token
  จึงไม่มีทั้ง `ADMIN_API_REQUEST` และ `ADMIN_TOKEN_REJECTED` (ไม่มีข้อมูลออกไป)
- คำขอที่ตัวอ่าน body ปฏิเสธ (400 `validation` / 413 / 415 — `parseJsonBody`) ไม่ถึง router ของ admin ได้บันทึกพร้อม `token_checked: false` —
  `requireAdminToken` ไม่ได้ตรวจ token ของมัน (`token_accepted: false` จึงไม่ได้แปลว่า token ผิด) และไม่มี `ADMIN_TOKEN_REJECTED`
- log store ปิดอยู่ = ไม่บันทึก

| ช่อง | ค่า |
|---|---|
| `source` · `category` · `action` | `"http"` · `"admin-access"` · `"ADMIN_API_REQUEST"` |
| `occurredAt` | เวลาที่คำขอ**เข้ามา** (`ctx.startedAt`) ไม่ใช่เวลาที่จบ — จบเมื่อ `occurredAt + durationMs` |
| `actor` · `via` | token ผ่าน: `SYSTEM` · `ADMIN_TOKEN` · ไม่ผ่าน ไม่มี หรือไม่ได้ตรวจ: `ANONYMOUS` · `ANONYMOUS` — id ชื่อ และ role ว่างเสมอ (admin token ไม่ผูกกับคน) |
| `tokenFps` | fingerprint ของ token ที่ส่งมา ผ่านหรือไม่ผ่าน (`[]` เมื่อไม่ได้ส่ง) |
| `subject` | จากแม่แบบของ route (`SUBJECT_BY_ROUTE`, `lib/admin-access.ts:105`): `/users/:id` → `USER_ACCOUNT` · `/organizations/:id` → `ORGANIZATION` · `/invitations/:id` → `USER_ACTIVATION_KEY` · `/registrations/organizations/:id` · `/registrations/datasets/:id` → คำขอ · `/legal-documents…` → `LEGAL_DOCUMENT` · `/dataset-choices…` → `DATASET_CHOICE` · id = `:id` ที่ Express จับและถอด `%xx` แล้ว (`RequestContext.routeId`) เฉพาะที่เป็น UUID เก็บตัวพิมพ์เล็ก · นอกนั้น (รายการ, 401 ที่ไม่ถึง route) `ADMIN_API` / null · **`/registrations/*` ที่เรียกด้วยเลขที่คำขอ** (ทางปกติของผู้ดูแล) ได้ subject ของคำขอแต่ id null และ `requestNumber` ของเอกสาร `http` เป็น null เสมอ — timeline ของคำขอและการค้นด้วย subject จึงไม่เจอการอ่านหรือแก้คำขอด้วยเลขที่ เลขที่เหลืออยู่แค่ใน `metadata.path` (`pathPattern()` ไม่แตะรูปเลขที่คำขอ) |
| `organizationId` | หน่วยงานของ `/organizations/:id` หรือ `?organizationId=` ที่เป็น UUID |
| `relatedUserIds` | บัญชีของ `/users/:id` — `x-log-person` ของคนนั้นจึงเจอว่าใครเปิดดูเขาผ่าน admin API |
| `hashKeys` | `cid#` ของ `?cid=` และของ `?q=` ที่เป็นเลขบัตร 13 หลัก · `email#` ของ `?email=` / `?q=` ที่เป็นอีเมลเต็ม — ค่าจริงไม่ถูกเก็บ ค้นบางส่วนไม่ได้ key |
| `request` | `method` · `route` แม่แบบ (mount เป็นตัวเล็ก — `/API/Admin/Users/<id>` ได้ `/api/admin/users/:id`) หรือ null เมื่อไม่ถึง route · `status` (null = ตัดสาย) · `durationMs` · `ip` (กฎเดียวกับ `audit_event` — ผู้เรียกเขียนเองได้ทุกที่ที่ไม่ผ่าน Cloudflare, 2.6) · `userAgent` (`storedUserAgent()` + กฎเลขบัตร) · `correlationId` `reference` |
| `result` | `SUCCESS` เมื่อ status < 400 |
| `sourceComponent` | `admin-portal` เมื่อ token ผ่าน ไม่งั้น `web-portal` |
| `metadata.path` | **รูปแบบ** ของ path ไม่ใช่ข้อความดิบ (`pathPattern()` ตัวเดียวกับ `ADMIN_TOKEN_REJECTED`) ตัวพิมพ์ตามที่ผู้เรียกพิมพ์ — target แบบเต็ม (`GET http://host/…`) เก็บ scheme กับ host ด้วย |
| `metadata.queryKeys` | **ชื่อ**ของ query ทุกตัว ≤ 20 (ถอดและพับตัวที่หน้าตาเหมือนกันก่อนกวาด ชื่อที่มี `@` เหลือ `[email]`) |
| `metadata.query` | ค่าเฉพาะห้าชื่อที่ไม่ใช่ข้อมูลบุคคล **และเฉพาะเมื่อค่าเป็นค่าที่ API รับจริง**: `status` (สถานะบัญชี คีย์ หรือหน่วยงาน) · `role` (รหัส role) · `organizationId` (UUID) · `page` `pageSize` (เลขไม่เกิน 6 หลัก) — ค่านอกรูปเป็น `"[other]"` |
| `metadata.token_present` · `token_accepted` | ส่ง header มาไหม · ผ่านไหม |
| `metadata.token_checked` | มีเฉพาะ `false` — ตัวอ่าน body ปฏิเสธก่อน หรือตัดสายระหว่างส่ง body |
| `metadata.aborted` | มีเฉพาะ `true` — ผู้เรียกตัดสายก่อนคำตอบจบ |

ไม่มี body ไม่มี header อื่น — การเปลี่ยนแปลงที่ body สั่งอยู่ใน `audit_event` พร้อม diff อยู่แล้ว

**เพดาน และบันทึกสรุป** — ต่อ backend process: token ผ่านไม่เกิน 600 ต่อนาที · ไม่ผ่านหรือไม่มี token ไม่เกิน 60 ต่อนาที · ในคิวอยู่ชั้น 1 (ทิ้งหลังรายงานเบราว์เซอร์
ก่อนทุกอย่างของ server — 5.7) · การเรียกที่ token ไม่ผ่านกินงบไบต์ `anonymous-admin` (5.13) **ที่เก็บเป็นตัวเดี่ยวไม่ได้ไม่หายเงียบ — พับลงบันทึกสรุป** หนึ่งใบต่อชนิด
token (ผ่าน / ไม่ผ่าน) ต่อราวหนึ่งนาที: เกินเพดานต่อนาที (`over_cap`) · คิวเต็ม (`queue_full`) · เข้าคิวแล้วถูกของชั้นสูงกว่าเบียดออก (`evicted`) · งบไบต์หมด
(`over_budget`) — ใบสรุป:

| ช่อง | ค่า |
|---|---|
| `metadata.summary` | `true` |
| `metadata.count` · `over_cap` · `queue_full` · [`evicted`] · [`over_budget`] | จำนวนการเรียกที่พับ และแยกตามเหตุ |
| `metadata.first_at` · `last_at` | ช่วงของการเรียกที่พับ — `occurredAt` ของใบ = `first_at` |
| `metadata.token_accepted` | ชนิดของใบ |
| `result` · `sourceComponent` | `SUCCESS` เมื่อการเรียกที่พับ**อย่างน้อยหนึ่งครั้ง**สำเร็จ ไม่งั้น `FAILURE` (ผลรายตัวอยู่ใน `statuses`) · `admin-portal` / `web-portal` ตามชนิดของใบ |
| `metadata.routes` · `statuses` | `[{route, count}]` (`"METHOD route"` หรือ path pattern) · `[{status, count}]` (`aborted` = ตัดสาย) ชนิดละไม่เกิน 50 ที่เกินรวมเป็น `[other]` |
| `metadata.subjects` · `ips` | subject ที่มี id ไม่เกิน 50 · IP ไม่เกิน 20 |
| `metadata.truncated_lists` | รายการที่เต็มแล้วมีค่าใหม่ตกไป (ค่าที่ตกไปค้นด้วย `x-log-*` / `tokenFp=` ไม่เจอ) |
| `hashKeys` · `relatedUserIds` · `tokenFps` | รวมของทุกตัวที่พับ ไม่เกิน 200 / 200 / 20 |
| `subject` · `organizationId` | `ADMIN_API` / null · null (หน่วยงานอยู่ใน `metadata.subjects`) |
| `request` | `correlationId` = id ของใบสรุปเอง (trace เจอแค่ใบนี้) · ip userAgent method route status เป็น null |

- **ใบของ token ที่ผ่าน**เต็มแล้ว (key ค้นหาของการเรียกใหม่ไม่พอที่) ปิดแล้วเปิดใบใหม่ — ใบที่ปิดเข้าคิวในรอบถัดไปของ event loop ใบที่รอสะสมได้เฉพาะตอนคิวรับไม่ได้
  ไม่เกิน 20 ใบ เกินนั้นใบสุดท้ายรับต่อแบบตัด key (`truncated_lists`) — คนถือ token ที่หลุดจึงซ่อน `?cid=` จริงไว้หลังขยะไม่ได้ เว้นแต่ยิงการเรียกที่ key ไม่ซ้ำเกินสี่พัน
  ตัวระหว่างที่คิวเต็ม
- **ใบของ token ที่ไม่ผ่าน**มีใบเดียว ไม่ปิดเพราะเต็ม รับต่อแบบตัด key — ไม่มีข้อมูลออกไปกับคำขอพวกนี้ ใบใหม่ต่อการเรียกขยะทุกหกสิบตัวเคยไม่มีขอบ
- ใบที่คิวเต็มรับไม่ได้รอแล้วลองใหม่ทุก 10 วินาที · ใบที่งบไบต์ไม่พอรอแล้วลองใหม่ราวนาทีละครั้ง (นับต่อ ไม่ทิ้ง) · ตอนปิด process เข้าคิวทุกใบก่อนเขียนครั้งสุดท้าย
  (`flushAdminAccessSummaries`) — ใบของ token ที่ผ่านที่รอส่วนยกเว้นเข้าคิวโดยไม่หักงบ ใบของ token ที่ไม่ผ่านที่รองบหายไปกับ process (แถว `ADMIN_TOKEN_REJECTED`
  ใน Postgres ยังนับการเรียกเหล่านั้น)
- สิ่งที่สรุปเสีย: เวลาทีละคำขอ (เหลือ `first_at`–`last_at`) correlation id และ user agent
- **เกินเพดานขนาด** (`over_quota`): token ที่ไม่ผ่านไม่เก็บเลย ทั้งตัวเดี่ยวและสรุป (นับใน `notStored`) · token ที่ผ่าน**ยังเก็บ**เหมือนสำเนา audit แต่หักส่วนยกเว้น
  `admin-token` (5% ของเพดานต่ออายุ 400 วัน — 5.13) หมดแล้วตัวเดี่ยวพับลงใบสรุปที่รองบ — **ต่างจากแบบ:** แผน §3 ไม่เก็บอะไรเลยตอนเกินเพดาน ซึ่งเปิดช่องให้คน
  ไม่มี token ยิงจนถึงเพดาน แล้วคนถือ token ที่หลุดอ่านเลขบัตรของทุกบัญชีได้โดยไม่เหลือบันทึก
- การเรียกที่พับลงสรุปเพราะคิวเต็ม (ตัวเดี่ยวที่เข้าคิวไม่ได้ และใบสรุปที่เข้าไม่ได้แล้วรอ) และที่ถูกเบียดออกแล้วพับ **ไม่นับ**ใน event `ErrorCaptureDropped` —
  ตัวนับเดียวคือ `adminAccess.queueFull` / `evicted` ของ `/status` (`enqueue()` คืน false ก่อน `noteDropped` ตั้งแต่ `1e0f081`) · นับเป็น `queue_full` เฉพาะตัวที่
  ส่งต่อให้ `lib/admin-access.ts` พับไม่ได้ (`handOverAccessRecord()` ไม่มีผู้รับหรือผู้รับล้ม) ซึ่งหายจริง
- `GET /api/admin/logs/status` → `adminAccess {recorded, overCap, queueFull, evicted, overBudget, summaries, pendingInSummary, notStored}` ของ backend process นั้น
- retention: token ผ่าน 400 วัน · token ไม่ผ่านหรือไม่ได้ตรวจ 90 วัน (3.9)
- **ข้อมูลส่วนบุคคล** id ของบัญชีที่ถูกเปิดดู · IP และ user agent ของผู้เรียก · key ค้นหา (ไม่ใช่ค่าจริง)
- **ตัวอย่าง (ตัวเดี่ยว)** `{"source": "http", "action": "ADMIN_API_REQUEST", "category": "admin-access", "result": "SUCCESS", "via": "ADMIN_TOKEN", "tokenFps": ["7c1e0f9a2b4d"], "subject": {"type": "USER_ACCOUNT", "id": "5c3e0a4b-…"}, "metadata": {"path": "/api/admin/users/:id", "queryKeys": [], "token_present": true, "token_accepted": true}, "request": {"method": "GET", "route": "/api/admin/users/:id", "status": 200, "durationMs": 38, "ip": "198.51.100.7", "userAgent": "PostmanRuntime/7.43.0", …}, "relatedUserIds": ["5c3e0a4b-…"], "hashKeys": [], "sourceComponent": "admin-portal"}`
- **ตัวอย่าง (ค้นด้วยเลขบัตร)** `GET /api/admin/users?cid=…` ได้ `"route": "/api/admin/users/"` (route ที่รากของ router ลงท้ายด้วย `/`) `"metadata": {"path": "/api/admin/users", "queryKeys": ["cid"], …}` และ `"hashKeys": ["cid#5d0e8b3a91c47f26"]`
- **ตัวอย่าง (สรุป)** `{"via": "ANONYMOUS", "tokenFps": ["a1b2c3d4e5f6", …], "subject": {"type": "ADMIN_API", "id": null}, "metadata": {"summary": true, "count": 412, "over_cap": 352, "queue_full": 0, "over_budget": 60, "first_at": "2026-10-16T04:11:00.120Z", "last_at": "2026-10-16T04:11:59.870Z", "token_accepted": false, "routes": [{"route": "GET /api/admin/users", "count": 412}], "statuses": [{"status": "401", "count": 412}], "subjects": [], "ips": ["198.51.100.7"]}}`
- **โค้ด** `lib/admin-access.ts:189` (`recordAdminAccess`) · `:246` (`buildRecord`) · `:455` (`fold`) · `:584` (`emitSummaries`) · `lib/error-capture.ts:485` (`enqueueAccessRecord`)

---

### 4.12 หมวด log-access — การอ่านและการแก้ผ่าน API อ่าน log

สองรหัสนี้เขียนจาก API อ่าน log (3.11) ทั้งคู่: actor `SYSTEM` ไม่มี id (ผู้อ่านไม่ใช่บัญชีในระบบ ตัวตนที่**ประกาศ**อยู่ใน `metadata.reader`) · `source_component`
= `log-api` · ในสำเนา category `log-access` (ไม่ลบ IP/UA ตัดที่ 365 วัน) via `LOG_TOKEN`

#### `AUDIT_LOG_READ` — มีคนอ่าน log

**เกิดเมื่อ** ทุกคำขอที่ผ่านด่านของ `/api/admin/logs/*` แล้วถึงขั้นอ่าน — **หนึ่งแถวต่อคำขอ เขียนก่อนส่งข้อมูลกลับ** (`recordLogRead()`, `lib/audit.ts:762`) ยกเว้น
`GET /status` (ไม่มีข้อมูลบุคคล) และ `PATCH` ของ issue (เขียน `ERROR_ISSUE_STATUS_CHANGED` แทน) · **ไม่มีแถว** เมื่อถูกปฏิเสธก่อนขั้นอ่าน — ทุกกรณีไม่มีข้อมูล
ออกไป: 400 (พารามิเตอร์ผิด `?reason=` `x-log-reader` ผิด ตัวระบุบุคคลใน query) · 404 ของรหัสหน่วยงานที่ไม่มี · 503 `log_access_disabled` (ก่อนดู token) `log_store_*`
`hash_search_unavailable` และ `database_unavailable` ตอนแปลงตัวระบุ — และเพราะคำขอพวกนี้ถึง router ของ log แล้ว จึงไม่มี `ADMIN_API_REQUEST` ด้วย (4.11)
**ไม่เหลือบันทึกที่ไหนเลย** · token ผิดได้ `LOG_TOKEN_REJECTED` (4.11) ·
**ไม่กลืน error**: Postgres ไม่รับ → สำเนา `audit_fallback` ใน Mongo ตรงและรอผล (3.14) ไม่ได้ทั้งคู่ → 503 `log_read_unrecorded` ไม่ส่งข้อมูล

| ช่อง | ค่า |
|---|---|
| actor | `SYSTEM` + null · ไม่มี snapshot |
| subject / organization_id | `AUDIT_LOG` · `subject_id` null (สิ่งที่ถูกอ่านอยู่ใน `metadata.endpoint` กับ `filters`) / null |
| result | `SUCCESS` |
| before / after | null / null |

| metadata | ความหมาย | ตัวอย่าง |
|---|---|---|
| `reader` | อีเมลจาก `x-log-reader` ตัวพิมพ์เล็ก — **ประกาศ ไม่ได้พิสูจน์** | `"dev-somchai@bdi.or.th"` |
| `reason` | ข้อความจาก `x-log-reason` ที่ถอดแล้ว · null บน endpoint ของ error ที่ไม่ได้ส่งมา | `"สอบเรื่องร้องเรียนเลขที่ 12/2569"` |
| `endpoint` | method + แม่แบบของ route ประกอบจาก mount ของ router ไม่ใช่ path ที่พิมพ์ | `"GET /api/admin/logs/activity"` |
| `filters` | ตัวกรองที่ใช้จริง — ไม่มีเลขบัตรหรืออีเมลจริงเลย: `cidKey` `emailKey` = `cid#…` / `email#…` (ไม่ใช่ชื่อ `cid` `email`: ชื่อที่ลงท้าย `cid` เข้ากฎ key เลขบัตรของสำเนาแล้ว key ถูกปิดทิ้ง) · `person` = uuid ของบัญชีเมื่อรู้ว่าบัญชีไหน บวก `personEmailKey` / `personCidKey` ของบัญชีนั้น (อีเมลที่ไม่มีบัญชี: `person` = `email#…`) · `cidKey` / `emailKey` ที่ตรงกับบัญชีได้ `cidAccountId` + `cidAccountEmailKey` / `emailAccountId` + `emailAccountCidKey` · Postgres ตอบไม่ได้ตอนหาบัญชี = `accountLookup: "unavailable"` · เลขที่คำขอ รหัสหน่วยงาน action category ฯลฯ เก็บตามจริง · `window {from, to}` `pageSize` `before` ของ `/activity` · `ref` ของ trace · `id` ของ `/activity/:id` และ `/errors/events/:id` · `fingerprint` `events` ของ issue | `{"action": ["LOGIN_FAILED"], "emailKey": "email#a41c…", "emailAccountId": "4b9e…", "emailAccountCidKey": "cid#5d0e…", "window": {"from": null, "to": null}, "pageSize": 200}` |
| `token_fp` | 12 ตัวแรกของ SHA-256 ของ `x-log-token` ที่ใช้ | `"9e0d1c2b3a4f"` |
| `page` | หน้าที่เปิด (endpoint ที่มีหน้า) | `1` |

- **key ไม่ต้องตั้งก็ตอบได้ว่าอ่านของใคร**: `person` เป็น uuid เสมอเมื่อรู้ว่าเป็นบัญชีไหน · key (`*Key`) มีเฉพาะเมื่อตั้ง `LOG_HASH_KEY`
- **ในสำเนา** key ทุกตัวใน `filters` ถูกยกเข้า `hashKeys` (ไม่ผ่านการปิด) และบัญชีที่ประวัติถูกเปิด (`person` `actorId` `subjectId` ของ `USER_ACCOUNT` `cidAccountId`
  `emailAccountId`) เข้า `relatedUserIds` (`logReadTargets()`, `lib/activity-shape.ts:375`) — `?action=AUDIT_LOG_READ` คู่กับตัวระบุของคนคนหนึ่งจึงตอบได้ว่าใคร
  ค้นประวัติของเขา (G7) **ครบแค่บางทาง**:
  - อ่านด้วย `x-log-person` `x-log-cid` `x-log-email` — บันทึกทั้ง id และ key ของบัญชี (`personEmailKey` `personCidKey` `cidAccountEmailKey` `emailAccountCidKey`)
    เจอด้วยตัวระบุตัวไหนก็ได้ของเขา (uuid อีเมล หรือเลขบัตร) ไม่ว่าการค้นครั้งนั้นจะพิมพ์อะไรมา
  - อ่านด้วย `?actorId=<uuid>` หรือ `?subjectType=USER_ACCOUNT&subjectId=<uuid>` — บันทึกแค่ uuid ดิบ ไม่หาบัญชีและไม่มี key: เจอด้วย `x-log-person` (uuid หรือ
    อีเมลของบัญชีที่ยังอยู่ — ค้นผ่าน `relatedUserIds`) แต่**ไม่เจอ**ด้วย `x-log-cid` / `x-log-email` ซึ่งค้นด้วย `hashKeys` อย่างเดียว
  - อ่านโดยไม่ระบุคน — `/activity/:id` `/trace/:ref` `/timeline?request=` `?organization=` และ `/activity` ที่กรองด้วยอย่างอื่น — **ไม่บันทึกว่าเป็นประวัติของใคร**
    แม้คำตอบจะมีแถวของเขา เหลือแค่ `endpoint` กับ `filters` (id ref เลขที่คำขอ หน่วยงาน) ให้ไล่เองว่าผลมีใคร
  · ผลข้างเคียง: การอ่านประวัติของ X ปรากฏในผลของการค้น X ครั้งถัดไป
- **คนหนึ่งคนในตาราง “คนอยู่ตรงไหน” (2.10)** — `metadata.filters.person` · `cidAccountId` · `emailAccountId` · `actorId` · `subjectId` (ของ `USER_ACCOUNT`)
  ของแถวนี้คือบัญชีที่ถูกอ่านประวัติ
- **สองบันทึกต่อการอ่านหนึ่งครั้งได้**: INSERT ที่เลิกรอที่ 2 วินาทีแล้ว commit ทีหลัง + สำเนา `audit_fallback` (คนละ `_id`)
- **ข้อมูลส่วนบุคคล** อีเมลของผู้อ่าน (ที่ประกาศ) · เหตุผลที่พิมพ์ (อาจมีชื่อคนที่ถูกสอบสวน — ไม่ปิดใน Postgres สำเนาปิดเลข 13 หลัก) · id ของบัญชีที่ถูกอ่าน ·
  IP และ user agent ของผู้อ่าน
- **ตัวอย่าง** `{"metadata": {"reader": "dev-somchai@bdi.or.th", "reason": "ตรวจการล็อกอินที่ผู้ใช้แจ้งว่าไม่ได้ทำ", "endpoint": "GET /api/admin/logs/activity", "filters": {"person": "4b9e2d17-…", "personEmailKey": "email#a41c9e07d2b35f68", "personCidKey": "cid#5d0e8b3a91c47f26", "window": {"from": null, "to": null}, "pageSize": 200}, "token_fp": "9e0d1c2b3a4f", "page": 1}}`
- **โค้ด** `lib/audit.ts:762` (`recordLogRead`) · `routes/admin-logs.ts:651` (`recordRead`) · `lib/audit-fallback.ts:167` (ทางสำรอง)

#### `ERROR_ISSUE_STATUS_CHANGED` — เปลี่ยนสถานะของ error issue

**เกิดเมื่อ** `PATCH /api/admin/logs/errors/issues/:fingerprint` `{status, reason}` เปลี่ยน `error_issues` ใน Mongo สำเร็จ (ตั้งสถานะเดิมซ้ำก็เขียน) — เขียน**หลัง**
การเปลี่ยนด้วย `logAudit(…, {deadline: true})` (`routes/admin-logs.ts:1780`): ภายใน 2 วินาที (0.3 เมื่อเพิ่งติดต่อไม่ได้) ไม่ทันไปทางสำรองปกติ (`audit.write-failed` +
`audit_fallback` ผ่านคิว) ไม่ย้อนการเปลี่ยน · INSERT ที่เลิกรอแล้ว commit ทีหลังได้ การเปลี่ยนครั้งเดียวจึงอาจมีสองบันทึก · issue ที่ไม่พบ (404) ไม่มีแถว

| ช่อง | ค่า |
|---|---|
| actor | `SYSTEM` + null |
| subject / organization_id | `ERROR_ISSUE` · **`subject_id` null** — fingerprint ไม่ใช่ uuid อยู่ใน `metadata.fingerprint` (การค้นด้วย subject จึงหาไม่เจอ ใช้ `action` กับ `filters` แทน) / null |
| result | `SUCCESS` |
| before / after | `{status, statusReason}` ก่อน (อ่านจาก Mongo — ผ่านกฎเลขบัตรแล้ว) / `{status, statusReason}` หลัง (**ข้อความตามที่พิมพ์**) |

| metadata | ความหมาย | ตัวอย่าง |
|---|---|---|
| `fingerprint` | issue | `"render:converter_unavailable"` |
| `reason` | เหตุผลที่ส่งใน body ตามที่พิมพ์ | `"แก้แล้วในรุ่น 5e8a1c2 — เพิ่ม retry ของ gotenberg"` |
| `reader` · `token_fp` | เหมือน `AUDIT_LOG_READ` | |

- `error_issues.statusReason` ใน Mongo และ `issue` ในคำตอบผ่าน `maskCidText` (เลข 13 หลักเป็น `[cid]`) ส่วนแถวนี้ใน Postgres เก็บข้อความตามที่พิมพ์ เหมือนเหตุผลของแถวอื่น
- สถานะตัดสินว่า issue จะเปิดกลับเองเมื่อเกิดซ้ำไหม (5.4) และจะถูกแจ้งเตือนไหม (5.14) — การปิดหรือละเว้นจึงต้องตอบได้ว่าใครทำด้วยเหตุผลอะไร
- **โค้ด** `routes/admin-logs.ts:1754`

---

### 4.13 ที่ประกาศไว้แต่ไม่มีใครเขียน

| อะไร | ชนิด | หมายเหตุ |
|---|---|---|
| `DATA_EXPORTED` | action | มีในรายการตัวอย่างของ Excel ยังไม่มีฟีเจอร์ส่งออกข้อมูล |
| `DATASET` | subject | ชุดข้อมูลที่ลงทะเบียนแล้ว — การสร้างชุดข้อมูลบันทึกผ่าน `REQUEST_APPROVED.metadata.dataset_id` แทน |
| `DATA_REQUEST` | subject | คำขอใช้ข้อมูล — ยังไม่มีฟีเจอร์ |
| `APPROVAL` | subject | ผลการตรวจบันทึกบน subject ของคำขอแทน |
| `NOTIFICATION` | subject | ไม่มีจุดใดใช้ใน `audit_event` |
| `EXTERNAL` | `actor_type` | ความหมายตาม Excel ของผู้เรียกทาง admin token — งานของการ์ด Admin Portal |

---

## 5. Error events (แบบ Sentry)

> **สร้างครบแล้ว** (ขั้น 5, 9, 10): `lib/error-capture.ts` (เก็บ คิว ตัวนับของ issue งบไบต์) · `lib/redact.ts` (การกวาด) · `workers/log-upkeep.ts` (index และเพดาน
> ขนาด) · รหัสอ้างอิงบนคำตอบ 5xx (5.8) · breadcrumb · process handler · รายงานจากเบราว์เซอร์และ Next server ผ่าน `POST /api/client-errors` (5.12) · งบไบต์ของ
> สิ่งที่ใครก็ส่งได้ (5.13) · อีเมลสรุป (5.14) · อ่านและเปลี่ยนสถานะผ่าน API อ่าน log (E1–E4, 3.11) · prune ตามอายุ (3.9)
>
> error **ไม่ผ่าน Postgres** เพื่อให้ยังเก็บได้ตอน Postgres ล่ม ก่อนการ์ดนี้ error ไปที่ `console.error` / `docker logs` อย่างเดียว ซึ่งหายทุกครั้งที่
> deploy `main/` และพิมพ์ error ดิบที่มีข้อมูลส่วนบุคคลปน (แถวทั้งแถวที่ Postgres ปฏิเสธ อีเมลผู้รับที่ SMTP ปฏิเสธ) วันนี้ทุกจุดพิมพ์บรรทัด
> `[capture]` ที่กวาดแล้วแทน และห้ามส่ง error หรือ `message` ของมันให้ `console.*` ตรง ๆ (`CLAUDE.md` Traps)

### 5.1 เก็บจากที่ไหน

`captureError(err, options)` (`lib/error-capture.ts:389`) ทำงานแบบ synchronous และไม่ throw: กวาด error (5.6) นับเข้า issue พิมพ์**บรรทัดเดียว**
ลง log ของ container (5.8 — เว้นแต่จุดเก็บส่ง `print: false`) แล้ววางลงคิวในหน่วยความจำ (5.7) — ไม่มีอะไรบนเส้นทางของคำขอรอ Mongo คืน id ของ event หรือ null ถ้าไม่ได้เข้าคิว
ไฟล์นี้ไม่เรียก `logAudit()` ทางใดเลย ความล้มเหลวของ audit จึงวนกลับมาไม่ได้ · รายงานจากเบราว์เซอร์และ Next server เข้าทาง `captureReport()` (5.12)

**backend**

| จุดเก็บ | level | tag | fingerprint | โค้ด |
|---|---|---|---|---|
| 500 ทั่วไปของ error middleware ตัวสุดท้าย | error | — | ตั้งต้น | `index.ts:382` |
| Prisma known code ที่แปลงเป็น 4xx (`P2002` `P2003` `P2000` `P2025` `P2023`) — สัญญาณว่า route ยังไม่ดักเคสของตัวเอง | warning | `prisma.<code>` | `prisma:<code>:<METHOD route>` | `index.ts:356` |
| Prisma ที่แปลงเป็น 503 (`P1001` `P1002` `P1008` `P1017` `P2024` — ฐานข้อมูลติดต่อไม่ได้ หรือ pool เต็ม) | **error** | `prisma.<code>` | `prisma:<code>:<METHOD route>` | `index.ts:356` |
| `PrismaClientInitializationError` ที่ไม่มีรหัสในตาราง | error | `prisma.init` | ตั้งต้น | `index.ts:370` |
| `DocumentRenderError` ≥ 500 (4xx ยังพิมพ์บรรทัด `[backend] <code>:` แบบเดิม ไม่เก็บ) | error | `render.<code>` | `render:<code>` | `index.ts:328` |
| error หลังส่งหัวคำตอบไปแล้ว — ปิด socket เอง **ไม่ส่งต่อ `next(err)`** เพราะ finalhandler ของ Express พิมพ์ `err.stack` ดิบ | error | `http.after-headers-sent` | ตั้งต้น | `index.ts:260` |
| body ที่อ่านไม่ออก ใหญ่เกิน หรือเข้ารหัสแบบที่ไม่รองรับ (`RequestBodyError` 400/413/415) — **ไม่พิมพ์** ผู้เรียกยิงถี่ได้เท่าที่ต้องการ | warning | `http.request-body` | `http:request-body:<status>` | `index.ts:280` |
| 5xx ที่ route ตอบเองด้วย `res.json({error: "<สตริง>", …})` โดยยังไม่มีอะไรในคำขอนั้นถูกเก็บ (503 `no_reviewer` `no_legal_documents` · 501 ThaID ยังไม่ตั้งค่า · 503 ของ API อ่าน log …) | warning | `http.route-5xx` | `http:5xx:<METHOD route>:<error ≤ 64 ตัว>` (ส่วน mount ของ route เป็นตัวเล็ก ผู้เรียกแตก issue ด้วยตัวพิมพ์ไม่ได้) | `index.ts:121` (5.8) |
| `/health/ready` ตรวจ database หรือ storage ไม่ผ่าน — endpoint ตอบแค่ `down` สาเหตุมาที่นี่ ไม่ถี่กว่านาทีละครั้งต่อการตรวจ | error | `health.database` · `health.storage` | `health:database` · `health:storage` | `routes/health.ts:38` |
| storage เปิด blob ไม่ได้ (ตอบ 503 `storage_unavailable`) หรือล้มกลางการดาวน์โหลด (ก่อนหัวคำตอบ = 503 · หลังหัวคำตอบ = ปิด socket) — ผู้เรียกตัดสายเองไม่เก็บ · blob ที่ไม่มี (404 ของ storage) ตอบ 500 `internal` | error | `storage.stream` | ตั้งต้น | `lib/attachment.ts:284` `:346` |
| `logAudit` ล้ม — อ่าน snapshot ของผู้กระทำ INSERT หรือเกินเพดานเวลา | error | `audit.write-failed` | ตั้งต้น | `lib/audit-fallback.ts:97` (3.14) |
| `recordLogRead` เขียน `AUDIT_LOG_READ` ลง Postgres ไม่ได้ | error | `audit.log-read-failed` | ตั้งต้น | `lib/audit-fallback.ts:172` (3.14) |
| ตัวบันทึกของ `ADMIN_TOKEN_REJECTED` / `LOG_TOKEN_REJECTED` ล้มในงานของตัวเอง (catch รอบ `record()`) — แถวที่เขียนไม่สำเร็จล้มใน `logAudit` จึงเป็น `audit.write-failed` | error | `audit.token-rejection` | ตั้งต้น | `lib/token-rejection.ts:422` |
| API อ่าน log: Mongo ล้มกลางคำสั่ง (ตอบ 503 `log_store_unavailable`) · Postgres ไม่ทันตอนแปลงตัวระบุ (503 `database_unavailable`) · Postgres ของ trace (ตอบส่วนของ Mongo ต่อ) | warning | `log-api.store` · `log-api.database` · `log-api.trace-postgres` | `log-api:store:<ชื่อ error>` · `log-api:database:<ชื่อ error>` · ตั้งต้น | `routes/admin-logs.ts:573` `:584` `:1631` |
| render เอกสารฉบับลงนามหลัง commit ไม่สำเร็จ (คำขอยังตอบ 200) | error | `render.agreement-after-commit` · `render.dataset-document-after-commit` | ตั้งต้น | `routes/organizations.ts:2861` · `routes/dataset-requests.ts:2176` |
| อีเมลเชิญผู้มีอำนาจฯ ที่ส่งแบบไม่รอ ส่งไม่สำเร็จ | error | `mail.approver-invitation` | ตั้งต้น | `routes/organizations.ts:3177` |
| แลก code หรือตรวจ id_token ของ ThaID ไม่ผ่าน | warning (`nonce_mismatch` `nonce_missing`) · error (อื่น) | `thaid.resolve-identity` | ตั้งต้น | `routes/auth.ts:377` |
| ThaID ไม่ส่งเลขบัตรใน claim ที่เลือก — ตั้งค่าผิดฝั่งเรา ทุกคนติดเหมือนกัน | error | `thaid.cid-unavailable` | `thaid:cid-unavailable:<claim>` | `routes/auth.ts:422` |
| revoke token ของ ThaID ไม่สำเร็จ (ข้ามไป ไม่กระทบผู้ใช้) | warning | `thaid.revoke` | ตั้งต้น | `lib/thaid.ts:181` |
| อ่านตาราง `administration.dataset_choice` ไม่ได้ · บูตแล้วยังใช้ค่าตั้งต้นในโค้ด | warning | `dataset-choices.read-failed` · `dataset-choices.defaults` | ตั้งต้น · `dataset-choices:defaults` | `lib/dataset-choices.ts:157` `:181` |
| `ensureContainer()` ตอนบูตไม่สำเร็จ | warning | `storage.ensure-container` | ตั้งต้น | `index.ts:410` |
| `main()` ล้มตอนบูต | fatal แล้ว exit 1 | `startup` | ตั้งต้น | `index.ts:467` |
| `unhandledRejection` | error · `handled: false` | — | ตั้งต้น | process ทำงานต่อ (5.10) |
| `uncaughtException` | fatal · `handled: false` | — | ตั้งต้น | exit 1 (5.10) |

**delivery-worker**

| จุดเก็บ | level | tag | fingerprint |
|---|---|---|---|
| ส่งอีเมลไม่สำเร็จ**ทุกครั้ง** (ล้มแล้ว retry ผ่านเป็นเรื่องปกติ) | warning | `delivery.send-failed` | `smtp:<responseCode หรือ E-code>` เช่น `smtp:535` `smtp:ECONNECTION` · ไม่มีรหัส = ตั้งต้น · `extra {deliveryId, attempt, notificationType}` |
| ครบ `DELIVERY_MAX_ATTEMPTS` แล้วเลิกส่ง (`DEAD_LETTER`) | error | `delivery.dead-letter` | `delivery:dead-letter:<notificationType>` · error ต้นทางอยู่ใน `causes` |
| รอบของลูปส่งอีเมลล้ม | error | `delivery.tick` | ตั้งต้น |
| `main()` ล้ม | fatal แล้ว exit 1 | `delivery.main` | ตั้งต้น |
| relay — รอบที่ล้ม (warning) · cursor เสีย (error) · Mongo ไม่รับเอกสาร (error) · แปลงแถวไม่ได้ (error) · งานดูแลล้ม (warning) · ค่าเวลาใน `relay_state` เสีย (error) · reconcile เติมแถวที่พลาด (warning) | ตามวงเล็บ | `log-relay.tick` `.cursor` `.rejected` `.project` `.maintenance` `.state.<ฟิลด์>` `.reconcile` | ตั้งต้น · ไม่ถี่กว่าครั้งละสิบนาทีต่อ tag (3.8) |
| `LOG_HASH_KEY` ไม่ใช่ตัวที่สร้างสำเนา · `SCHEMA_VERSION` เปลี่ยน — ครั้งเดียวต่อ process จนกว่าจะ rebuild | error · warning | `log-relay.hash-key` · `log-relay.schema` | `log-relay:hash-key-changed` · `log-relay:schema-changed` |
| สร้าง index ไม่ได้ด้วยเหตุที่ลองใหม่ก็ไม่ผ่าน | warning | `log-upkeep.index` | ตั้งต้น · ครั้งเดียวต่อ index ต่อ process |
| `dbStats` ไม่รับ `freeStorage` (จำไว้จนเริ่มใหม่) · ล้มด้วยเหตุอื่นแต่แบบไม่ขอผ่าน (ครั้งเดียวต่อชนิด) | warning | `log-upkeep.free-storage` | `log-store:free-storage-rejected` · `log-store:free-storage-failed` (5.9) |
| รอบของงานดูแล log store ล้ม | warning | `log-upkeep.tick` | ตั้งต้น · ไม่ถี่กว่าครั้งละ 10 นาที |
| ขนาดเกินเพดาน ตอนธงเพิ่งตั้ง — ไม่พิมพ์ (บรรทัด `[log-store]` ของตัวเองพิมพ์ไปแล้ว) | warning | `log-store.over-quota` | `log-store:over-quota` |
| loop แจ้งเตือน — อ่านหรือเขียนสถานะ · รอบที่ล้ม · ส่งไม่สำเร็จ | warning | `error-alerts.state` `.tick` `.send` | ตั้งต้น · ไม่ถี่กว่าครั้งละ 10 นาทีต่อ tag |
| `unhandledRejection` · `uncaughtException` | เหมือน backend | — | ตั้งต้น |

ทั้งสอง process ยังเขียน event สรุป `error-capture.dropped` (fingerprint `error-capture:dropped:<service>`) หลังช่วงที่ทิ้งของ (5.7)
`delivery.send-failed` และ `delivery.dead-letter` เกิดใน `runWithContext` ของแถว (`workers/delivery.ts:181-182`) จึงถือ correlation id ของคำขอที่สร้างการแจ้งเตือน
นั้น — dead letter ค้นเจอด้วยรหัสอ้างอิงเดียวกับคลิกต้นเรื่อง · **ที่เหลือของ worker ไม่มีบริบท**: `delivery.tick` `delivery.main` และทุก capture ของ relay
งานดูแล และ loop แจ้งเตือนได้ `request: null` และบรรทัด `[capture]` ไม่มี `ref=`

จุดที่เคยพิมพ์ error ดิบยังพิมพ์บรรทัดบอกที่เกิดเป็นภาษาไทย แต่จบด้วย `— ดูบรรทัด [capture] ถัดไป` แทนข้อความของ error
(เช่น `[thaid] <code>` · `[delivery] ส่งไม่สำเร็จ ครั้งที่ 3 (535)` · `[startup] could not ensure container`) และ log ของ Prisma เอง
(`db.ts`) ออกเป็น event แล้วพิมพ์ `prisma:error <target> — <บรรทัดที่กวาดแล้ว>` (`databaseLogLine()`, 5.6) — **ไม่ถูกเก็บลง log store**

**ต่างจากแบบ:** Prisma ที่แปลงเป็น 503 เก็บเป็น error ไม่ใช่ warning (ระบบล่มต้องไม่ดูเป็นคำเตือน) · `RequestBodyError` ถูกเก็บเป็น warning ที่ไม่พิมพ์
(แบบเขียนว่าไม่พิมพ์และไม่เก็บ) · capture ระดับ route (ThaID, render หลัง commit, คำเชิญ) มี `request.status` เป็น null เพราะเก็บก่อน route เลือก status
ส่วน capture ของ middleware มี status

### 5.2 `error_events` — หนึ่งเอกสารต่อหนึ่งครั้งที่เกิด

| ฟิลด์ | ชนิด | ค่า |
|---|---|---|
| `_id` | UUID string | อยู่ในบรรทัด `[capture]` ด้วย (`event=…`) |
| `occurredAt` | Date | เวลาที่ `captureError` ถูกเรียก |
| `fingerprint` | string | 5.4 |
| `level` | `fatal` \| `error` \| `warning` | จุดเก็บกำหนด ค่าตั้งต้น `error` · `warning` ไม่มีวันแจ้งเตือน (ขั้น 10) |
| `handled` | bool | `false` สำหรับ `unhandledRejection` `uncaughtException` และ**ทุกรายงานที่รับเข้ามา** (`captureReport()` — เบราว์เซอร์และ Next server ทุกกลไก รวม `window` `global-error` `proxy` `onRequestError`) · `true` นอกนั้น รวม error middleware และ fatal ของ `startup` |
| `tag` | string \| null | 5.1 · null สำหรับ 500 ทั่วไปและ process handler ของ backend/worker · รายงานที่รับเข้ามา = `ingest.<mechanism>` (`ingest.window` `ingest.proxy` `ingest.onRequestError` … — `client-errors.ts:217`) |
| `service` | `backend` \| `delivery-worker` \| `frontend-server` \| `browser` | สองตัวหลังมาจาก `POST /api/client-errors` (5.12) |
| `environment` · `release` | string | `DEPLOY_ENV` · `RELEASE` (5.10) — รายงานที่รับเข้ามาได้ `release` ของรายงานเอง (`NEXT_PUBLIC_RELEASE` ของบันเดิลหรือ Next server, 5.12) |
| `host` | `{containerId, startedAt}` | `os.hostname()` ซึ่งใน container คือ id สั้นของ container · เวลาที่ process เริ่ม |
| `mechanism` | `express` \| `captured` \| `unhandledRejection` \| `uncaughtException` · รายงาน: `window` `unhandledrejection` `global-error` `proxy` (เบราว์เซอร์) `onRequestError` `unhandledRejection` `uncaughtException` (Next server) | `express` เมื่อจุดเก็บส่ง `req` มา · `captured` เมื่อไม่ส่ง |
| `error.name` | string | `name` ของ error หรือชื่อ constructor เมื่อ `name` เป็น `"Error"` (`DocumentRenderError` `ThaidError` …) ≤ 100 ตัว · ค่าที่ไม่ใช่ Error แต่เป็น object ที่มี `name` เป็นสตริงไม่ว่าง ได้ชื่อนั้น (กวาดแล้ว ≤ 100) · นอกนั้น (สตริง ตัวเลข object ไม่มีชื่อ) ได้ `NonError` |
| `error.message` | string | กวาดแล้ว (5.6) ≤ 2,048 ตัว · `PrismaClientValidationError` เหลือบรรทัดแรกที่ไม่ว่าง (บรรทัดถัดไปคือ argument ของ query พร้อมค่า) |
| `error.stack` | string \| null | **ประกอบใหม่** ไม่ใช่ stack ดิบ: บรรทัดหัว `name: message` ที่กวาดแล้ว + เฉพาะบรรทัด `at …` ที่อยู่ใต้หัว ไม่เกิน 50 เฟรม แต่ละเฟรมกวาดแยกแล้วตัดที่ 1,024 ตัว รวม ≤ 16,384 ตัว (5.6) · รายงานจากเบราว์เซอร์: stack ที่ผู้ส่งส่งมา กวาดทีละบรรทัด ≤ 200 บรรทัด (5.12) · image ของ production **ตั้งไว้**ให้รันด้วย `--enable-source-maps` (`backend/Dockerfile` · `tsconfig` ออก `.map`) เพื่อให้เฟรมชี้ `/app/src/*.ts` — **[ยังไม่ได้ลอง]** กับ image ของ production ถ้าไม่ได้ผล เฟรมเป็น `/app/dist/*.js` |
| `error.props` | object | เฉพาะ `code` `status` `statusCode` `type` `errorCode` `responseCode` `command` `syscall` (สตริงกวาดแล้ว ≤ 200) + `metaTarget` จาก `meta.target` ของ Prisma (ชื่อคอลัมน์ ไม่ใช่ค่า) |
| `error.causes` | array ≤ 3 | `{name, message ≤ 1,024, props}` ตามสาย `cause` |
| `request` | object \| null | null เมื่อไม่มีบริบทของคำขอและไม่ได้ส่ง `req` (ตอนบูต) · `{method, route, path, queryKeys, status, durationMs, correlationId, reference, ip, userAgent, bodyShape}` — `route` คือแม่แบบที่ `wrap()` จด (`lib/async-route.ts`) null ถ้ายังไม่ถึง route (guard ของ `router.use`) · `path` ไม่มี query กวาดแล้ว ≤ 300 · `queryKeys` เฉพาะ**ชื่อ** ≤ 20 · `status` ที่จุดเก็บส่งมา · `durationMs` จากต้นคำขอถึงตอนเก็บ · `ip` ตาม `parseClientIp` (2.6) · `userAgent` กวาดแล้ว ≤ 512 · **`path` `queryKeys` `bodyShape` มีเฉพาะเมื่อจุดเก็บส่ง `req`** (5.6) — capture ในคำขอที่ไม่ส่ง `req` (`audit.write-failed` `audit.token-rejection` `thaid.revoke` `mail.approver-invitation` `dataset-choices.*` ตอน refresh) ได้ `method` `route` `correlationId` จากบริบท แต่ `path` null `queryKeys` `[]` `bodyShape` null · ใน worker `method` `route` `path` เป็น null แต่ `correlationId` เป็นของแถวที่ส่ง |
| `actor` | object \| null | `{id, roles, organizationId, sessionId}` จาก session ที่ `requireAuth` ตั้ง — `roles` คือ role ที่มีผลในคำขอนั้น · `sessionId` คือ id ของแถว `iam.session` **ไม่ใช่ค่า cookie** · capture ที่ไม่ส่ง `req` ได้ id จาก `actorId` ของบริบท จึงเป็น `{id, roles: [], organizationId: null, sessionId: null}` แม้ผู้ใช้จะล็อกอินอยู่ · null บนเส้นทาง admin token เส้นทางสาธารณะ และใน worker · ไม่มีชื่อคน |
| `breadcrumbs` | array ≤ 30 | ของคำขอนั้น ล่าสุด 30 รายการ (ตารางข้างล่าง) |
| `extra` | object \| null | ข้อมูลที่จุดเก็บส่งมา**ซึ่งต้องกวาดมาเอง** ≤ 16 KB ไม่งั้นเหลือ `{truncated: true, bytes, keys}` (`keys` ชื่อคีย์ชั้นบนไม่เกิน 20 ชื่อ) · `JSON.stringify` ไม่ผ่าน (อ้างวนกลับตัวเอง · `BigInt`) = `{unserialisable: true}` · `{audit}` ของ `audit.write-failed` (3.14) · `{referenceOnly, capped, issueCapped?}` ของตัวย่อ (5.8, 5.12) · `{capped: "browser_fingerprints"}` ของรายงานที่ issue ไม่ถูกสร้าง · `{digest}` ของ Next server · `{dropped, from, to, reasons, auditCopies}` ของ event สรุป (5.7) |
| `browser` · `ingest` | object \| null | เฉพาะรายงานที่รับเข้ามา (5.12): `browser {pathname, digest, reference, release, lastApi[≤5]}` (ของเบราว์เซอร์) · `ingest {verified, claimedService, ip, userAgent}` |

เอกสารที่เกิน 64 KB ถูกตัดตามลำดับ: `extra` เหลือ `{truncated: true}` → `stack` เหลือ 4,096 ตัว → ทิ้ง `breadcrumbs` `bodyShape` และ `causes` · ยังเกินอีก
= ไม่เข้าคิว (`too_large`, 5.7)

**breadcrumb** — `{at, type, message ≤ 200, ok}` ที่คำขอหนึ่งทิ้งไว้ระหว่างทาง ตอบคำถาม “commit ไปแล้วหรือยังก่อนจะได้ 500” ข้อความเป็นของโค้ดเราเองทั้งหมด
**ไม่มีที่อยู่อีเมล หัวเรื่อง ชื่อไฟล์ key ของ blob code หรือ token** (ลง event ทั้งก้อนโดยไม่ผ่านตัวกรองอีกชั้น) · เกิน 30 ทิ้งตัวเก่า · นอกบริบทของคำขอ
(ตอนบูต) ไม่ถูกจด · แต่ละแถว delivery ของ worker มีบริบทและ breadcrumb ของตัวเอง

| `type` | จดเมื่อ | `message` |
|---|---|---|
| `audit` | `logAudit` เขียนแถวสำเร็จ / ล้ม | `"REQUEST_SUBMITTED"` · `"REQUEST_SUBMITTED — เขียนไม่สำเร็จ"` (`ok: false`) |
| `outbox` | `notifyUsers()` ลงตาราง notification | `"<ชนิดการแจ้งเตือน> → 3 คน + คิวอีเมล"` · ต่อท้าย `— เขียนไม่สำเร็จ` เมื่อล้ม |
| `smtp` | ส่งอีเมล (`lib/mail.ts`) | `"ส่งอีเมลสำเร็จ"` · `"ส่งอีเมลไม่สำเร็จ (535)"` · `"ไม่ได้ตั้ง SMTP — พิมพ์อีเมลลง log แทน (dry-run)"` |
| `render` | แปลง .docx เป็น PDF ที่ gotenberg | `"แปลง .docx → PDF สำเร็จ (840 ms)"` · `"… — HTTP 503 (…)"` · `"… — ติดต่อตัวแปลงไม่ได้ (…)"` |
| `storage` | เขียนหรืออ่าน blob | `"เขียนไฟล์ 182344 ไบต์"` · `"เปิดไฟล์เพื่ออ่านแบบสตรีม"` · `"อ่านไฟล์ทั้งก้อน"` · ต่อท้าย `— ไม่สำเร็จ` เมื่อล้ม · `"สตรีมไฟล์ขาดกลางทาง"` (`ok: false`) เมื่อสตรีมดาวน์โหลดล้มกลางทาง (`lib/attachment.ts:345`) |
| `thaid` | แลก code เป็น token | `"แลก code เป็น token — HTTP 200"` · `"… — ติดต่อ ThaID ไม่ได้"` |

ตัวอย่าง (ข้อมูลสมมติ) — ผู้ประสานงาน BDI กดผ่านคำขอหน่วยงาน ตัวแปลงเอกสารล่มระหว่างสร้างเอกสารก่อน commit (breadcrumb ไม่มี `audit` = ยังไม่มีแถวใดถูกเขียน):

```json
{
  "_id": "0c7d4b1e-2f5a-4c1d-9e3b-6a8f7d2c1b40",
  "occurredAt": { "$date": "2026-10-14T03:12:45.118Z" },
  "fingerprint": "render:converter_unavailable",
  "level": "error", "handled": true, "tag": "render.converter_unavailable",
  "service": "backend", "environment": "bdi-main", "release": "5e8a1c2",
  "host": { "containerId": "3f1a9b2c4d5e", "startedAt": { "$date": "2026-10-14T01:00:03.502Z" } },
  "mechanism": "express",
  "error": {
    "name": "DocumentRenderError",
    "message": "ตัวแปลงเอกสารเป็น PDF ไม่ตอบสนอง กรุณาลองอีกครั้ง หากยังเป็นเหมือนเดิมโปรดแจ้งผู้ดูแลระบบ",
    "stack": "DocumentRenderError: ตัวแปลงเอกสารเป็น PDF ไม่ตอบสนอง …\n    at docxToPdf (/app/src/lib/document-render.ts:517:11)\n    at …",
    "props": { "code": "converter_unavailable", "status": 503 },
    "causes": [
      { "name": "TypeError", "message": "fetch failed", "props": {} },
      { "name": "Error", "message": "getaddrinfo ENOTFOUND gotenberg", "props": { "code": "ENOTFOUND", "syscall": "getaddrinfo" } }
    ]
  },
  "request": {
    "method": "POST", "route": "/api/organizations/:id/review",
    "path": "/api/organizations/d4e5f6a7-b8c9-4d0e-9f1a-2b3c4d5e6f7a/review", "queryKeys": [],
    "status": 503, "durationMs": 2184,
    "correlationId": "1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d", "reference": "1a2b3c4d",
    "ip": "203.0.113.24", "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) …",
    "bodyShape": { "action": "string(7)", "note": "string(42)", "signature": "present" }
  },
  "actor": { "id": "91a2b3c4-d5e6-4f70-8192-a3b4c5d6e7f8", "roles": ["BDI_OFFICER"],
             "organizationId": null, "sessionId": "aa11bb22-cc33-4d44-8e55-ff6677889900" },
  "breadcrumbs": [
    { "at": { "$date": "2026-10-14T03:12:43.020Z" }, "type": "storage", "message": "อ่านไฟล์ทั้งก้อน", "ok": true },
    { "at": { "$date": "2026-10-14T03:12:45.110Z" }, "type": "render",
      "message": "แปลง .docx → PDF — ติดต่อตัวแปลงไม่ได้ (41 ms)", "ok": false }
  ],
  "extra": null, "browser": null, "ingest": null
}
```

index (worker สร้างตอนบูตทีละตัว — 5.9): `{fingerprint:1,occurredAt:-1}` · `{occurredAt:-1}` · `{"request.correlationId":1}` · `{"browser.reference":1}`

### 5.3 `error_issues` — หนึ่งเอกสารต่อ fingerprint

ตัว flush ของแต่ละ process เขียน issue ทีละก้อน: ทุก fingerprint ในก้อนได้สอง operation — upsert ตัวนับ แล้ว update แบบมีเงื่อนไขที่เปิด issue ที่
`resolved` กลับ (5.4)

| ฟิลด์ | เขียนด้วย | ค่า |
|---|---|---|
| `_id` | — | fingerprint |
| `service` · `firstRelease` | `$setOnInsert` | process และ `RELEASE` ของครั้งแรกที่เขียน — issue ของรายงานได้ `service` และรุ่นของรายงาน |
| `title` | `$set` ทุก flush | `<name>: <หัวเรื่องที่ normalize แล้ว>` ≤ 200 (5.4) ของการเกิดครั้งแรก**ในก้อนนั้น** |
| `culprit` | `$set` | `METHOD route` · หรือ tag · หรือเฟรมแรกในโค้ดเรา · หรือชื่อ service ≤ 200 |
| `level` · `tag` | `$set` | `level` ของการเกิดล่าสุดในก้อน · `tag` ของการเกิดครั้งแรกในก้อน |
| `count` | `$inc` | จำนวนในก้อน รวมตัวที่ติดเพดานการสุ่มเก็บและตอนเกินเพดานขนาด — **ค่าประมาณ** นับซ้ำได้ทั้งก้อนหลัง Mongo ค้าง (5.7) |
| `firstSeen` / `lastSeen` | `$min` / `$max` | |
| `lastRelease` | `$set` | `RELEASE` ของ process ที่ flush — issue ของรายงานที่รับเข้ามาได้รุ่นของรายงาน (`NEXT_PUBLIC_RELEASE` ของบันเดิลหรือ Next server) ไม่ใช่ของ backend |
| `lastEventId` | `$set` เฉพาะเมื่อก้อนนั้นมี event ที่เข้าคิว | ตอนสร้าง null · อาจเก่ากว่า `lastSeen` เมื่อติดเพดาน · ไม่เคยชี้ตัวย่อ (5.8) · **อาจชี้เอกสารที่ไม่มีอยู่**: id ถูกจดตอน event เข้าคิว แล้ว event นั้นยังถูกไล่ออกเมื่อคิวเต็ม (`queue_full`) ถูกข้ามตอนเขียนเพราะธงเกินเพดานตั้งก่อน flush หรือ Mongo ไม่รับ (`rejected`) ได้ |
| `status` | `$setOnInsert` / regression / PATCH | `open` ตอนสร้าง · กลับเป็น `open` เองเมื่อ issue ที่ `resolved` เกิดซ้ำ (5.4) · `open` `resolved` `ignored` ด้วย PATCH (E4, 3.11) |
| `statusChangedAt` · `statusReason` | `$setOnInsert` / regression / PATCH | ตอนสร้าง = `firstSeen` · null · regression ตั้งเป็น `lastSeen` ของก้อน · `"เกิดซ้ำหลังปิด (regression)"` · PATCH ตั้งเป็นเวลาที่เปลี่ยน · เหตุผลที่ส่งมาผ่านกฎเลขบัตร (`maskCidText`) |
| `regressedAt` | regression | null · ตั้งเมื่อ issue ที่ `resolved` เกิดซ้ำ |
| `alertedAt` · `alertCount` | `$setOnInsert` / loop แจ้งเตือน | null · 0 ตอนสร้าง · `$set alertedAt` `$inc alertCount` เมื่อ issue อยู่ในอีเมลสรุปที่ถึงผู้รับอย่างน้อยหนึ่งคน (5.14) |

```json
{
  "_id": "render:converter_unavailable",
  "service": "backend",
  "title": "DocumentRenderError: ตัวแปลงเอกสารเป็น PDF ไม่ตอบสนอง กรุณาลองอีกครั้ง หากยังเป็นเหมือนเดิมโปรดแจ้งผู้ดูแลระบบ",
  "culprit": "POST /api/organizations/:id/review",
  "level": "error", "tag": "render.converter_unavailable", "count": 7,
  "firstSeen": { "$date": "2026-10-14T03:12:45.118Z" }, "lastSeen": { "$date": "2026-10-14T05:40:02.771Z" },
  "firstRelease": "5e8a1c2", "lastRelease": "5e8a1c2",
  "lastEventId": "4d5e6f70-8192-4a3b-9c4d-5e6f708192a3",
  "status": "open", "statusChangedAt": { "$date": "2026-10-14T03:12:45.118Z" }, "statusReason": null,
  "regressedAt": null, "alertedAt": null, "alertCount": 0
}
```

index: `{status:1,lastSeen:-1}` · `{service:1,lastSeen:-1}` · ตัวนับยังเดินตอนเกินเพดานขนาด (5.9)

### 5.4 fingerprint และสถานะ

- **ค่าตั้งต้น** `sha1(service | error.name | normalize(หัวเรื่อง) | เฟรมแรกในโค้ดเรา | METHOD route หรือ tag)` ฐานสิบหก 40 ตัว (บรรทัด `[capture]`
  แสดง 12 ตัวแรก) — ไม่มีเลขบรรทัด แก้โค้ดบรรทัดข้างบนแล้ว issue เดิมยังเป็น issue เดิม
- **หัวเรื่อง** (`headlineOf()`) บรรทัดแรกที่ไม่ว่างของ message ที่กวาดแล้ว — **ยกเว้น error ที่ชื่อขึ้นต้นด้วย `Prisma`** ใช้บรรทัด**สุดท้าย** เพราะ Prisma
  ขึ้นต้นด้วยบรรทัดว่างกับโค้ดรอบจุดที่เรียก และบอกสาเหตุจริงไว้ท้ายสุด (`Can't reach database server at …` · `Unique constraint failed on the fields: (…)`) ·
  **ข้อยกเว้นของข้อยกเว้น**: `PrismaClientValidationError` ถูกตัดเหลือบรรทัดแรกที่ไม่ว่างตั้งแต่ก่อนกวาด (5.2 `error.message`) กฎบรรทัดสุดท้ายจึงได้บรรทัดเดียวที่เหลือ
  คือ ``Invalid `prisma.x.y()` invocation in`` — สาเหตุจริง (บรรทัดท้ายของข้อความดิบ) ไม่ถูกเก็บที่ไหน และ validation error ทุกชนิดจากจุดเรียกเดียวกันได้
  title เดียวกัน (fingerprint ยังแยกได้ด้วยเฟรมและ route เท่านั้น)
- **normalize** UUID → `<uuid>` · ตัวเลขทุกชุด → `<n>` · ตัดที่ 200 ตัว
- **เฟรมแรกในโค้ดเรา** (`topFrame`) บรรทัด `at` แรกที่ไฟล์อยู่ใต้ `/src/` หรือ `/dist/` และไม่ใช่ `node_modules` หรือ `node:` ในรูป
  `<path ไม่มี src/ และนามสกุล>:<ชื่อฟังก์ชัน>` เช่น `lib/document-render:docxToPdf` · ฟังก์ชันไม่มีชื่อ = `<anonymous>` · ตั้งใจให้ dev (tsx, `.ts`) กับ
  production (`dist/*.js` ที่ source map พากลับไป `.ts`) ได้ค่าเดียวกัน — **[ยังไม่ได้ลอง]** กับ image ของ production ของ backend path ตัด
  `src/` หรือ `dist/` ทิ้งเหมือนกันอยู่แล้ว แต่ถ้า source map ไม่ทำงาน ชื่อฟังก์ชันจาก `.js` ที่ tsc ออกอาจต่างจาก `.ts` และ fingerprint ของ dev กับ production จะแยกกัน
- **ต่างจากแบบ:** แผน normalize ทั้ง message ที่สร้างใช้แค่หัวเรื่อง — message ของ Prisma ทั้งก้อนทำให้ title ว่างและ fingerprint เปลี่ยนทุกครั้งที่แก้บรรทัดข้างเคียง

**fingerprint ตายตัว** (ส่งมาจากจุดเก็บแทนค่าตั้งต้น):

| fingerprint | ใช้กับ |
|---|---|
| `prisma:<code>:<METHOD route>` | Prisma known code ที่ตะแกรงของ middleware จับ — route ของ guard ที่ยังไม่ถึงแม่แบบเป็น `-` |
| `render:<code>` | `DocumentRenderError` ≥ 500 |
| `http:request-body:<status>` | body ที่อ่านไม่ออก 400 / 413 / 415 |
| `http:5xx:<METHOD route>:<error>` | 5xx ที่ route ตอบเอง (5.8) — ส่วน mount ของ route เป็นตัวเล็ก |
| `health:database` · `health:storage` | `/health/ready` ตรวจไม่ผ่าน |
| `smtp:<responseCode\|E-code>` · `delivery:dead-letter:<notificationType>` | worker ส่งอีเมลไม่สำเร็จ · ส่งไม่ได้จนหมดรอบ |
| `thaid:cid-unavailable:<claim>` | ThaID ไม่ส่งเลขบัตรใน claim ที่ตั้งไว้ |
| `dataset-choices:defaults` | บูตแล้วยังใช้ตัวเลือกตั้งต้นในโค้ด |
| `log-store:over-quota` · `log-store:free-storage-rejected` · `log-store:free-storage-failed` | ขนาดเกินเพดาน · `dbStats` กับ `freeStorage` (5.9) |
| `log-relay:hash-key-changed` · `log-relay:schema-changed` | กุญแจหรือรูปเอกสารของสำเนาไม่ตรง (3.8) |
| `log-api:store:<ชื่อ error>` · `log-api:database:<ชื่อ error>` | API อ่าน log: Mongo ล้มกลางคำสั่ง · Postgres ไม่ทันตอนแปลงตัวระบุ |
| `error-capture:dropped:<service>` | event สรุปของที่ถูกทิ้ง (5.7) |
| `browser:chunk-load` · `proxy:backend_unreachable` · `frontend-server:eacces` | chunk ที่โหลดไม่ขึ้น (warning ไม่แจ้งเตือน) · 502 ของ proxy · `EACCES` ของ `.next/cache` (5.12) — รายงานอื่นของเบราว์เซอร์และ Next server ใช้ `sha1(service \| ชื่อ \| หัวเรื่องที่ normalize \| หน้าหรือ route)` |

**สถานะ**

```
ครั้งแรก ──$setOnInsert──► open  (statusChangedAt = firstSeen)
resolved ──ก้อนที่ lastSeen > statusChangedAt──► open + regressedAt = lastSeen
                                                   + statusChangedAt = lastSeen
                                                   + statusReason "เกิดซ้ำหลังปิด (regression)"
ignored  ──เกิดซ้ำ──► ยัง ignored · count / lastSeen / lastEventId เดินต่อ · ไม่เปิดกลับ · ไม่แจ้งเตือน
สถานะใดก็ได้ ──PATCH /api/admin/logs/errors/issues/:fingerprint (E4)──► open | resolved | ignored
             + statusChangedAt = ตอนนั้น · statusReason (ปิดเลขบัตรแล้ว) · แถว ERROR_ISSUE_STATUS_CHANGED
```

การเปิดกลับดูจาก `lastSeen` ของก้อนเทียบ `statusChangedAt` เท่านั้น — PATCH ตั้ง `statusChangedAt` เป็นเวลาที่เปลี่ยนเสมอ error ที่เกิดก่อนปิดแต่ถูก flush หลังปิดจึงไม่เปิด
issue กลับ · ถ้าแก้สถานะด้วย mongosh (ไม่ควร — 5.11) ต้องตั้ง `statusChangedAt` เองด้วย ไม่งั้นค่าเก่าทำให้ก้อนใดก็ตามที่ flush หลังปิดเปิดมันกลับ · issue ที่ปิดแล้วเกิดซ้ำถูก
แจ้งเตือนเป็น `regressed` เฉพาะเมื่อมันเป็นระดับที่แจ้งอยู่แล้ว (5.14)

retention ของ `error_events` `error_issues` อยู่ที่ 3.9 · เพดานขนาด (5.9) และงบไบต์ (5.13) คุมขนาดรวม

### 5.5 `runtime_events` — process เริ่ม ปิด และตาย

การ restart ไม่ถูกบันทึกที่ไหนเลยก่อนการ์ดนี้ collection นี้ป้อนการตรวจวนรีสตาร์ตของ loop แจ้งเตือน (5.14)

| ฟิลด์ | ค่า |
|---|---|
| `_id` · `at` | UUID · เวลา |
| `service` | `backend` \| `delivery-worker` |
| `host` · `release` | เหมือน `error_events` — `host.containerId` คงเดิมเมื่อ Docker restart container เดิม เปลี่ยนเมื่อสร้าง container ใหม่ |
| `kind` | `start` — backend ตอน `listen` · worker ทันทีหลังสั่ง `startLogStore()` (ไม่รอให้ต่อได้ — เอกสารรอในคิว, `workers/delivery.ts:201-207`) · `shutdown` — ใน `shutdown()` / `stop()` ของ SIGTERM หรือ SIGINT ก่อน flush · `fatal-exit` — ใน `exitAfterFatal()` หลังเก็บ fatal ก่อน flush และ `exit(1)` |
| `detail` | `start` `{node: "v22.…"}` (+ `cleanExit: true, cleanExitAt` เมื่อพบป้ายของการปิดตามปกติ — ข้างล่าง) · `shutdown` `{signal}` · `fatal-exit` `{mechanism, tag}` |

```json
{ "_id": "6a7b8c9d-0e1f-4a2b-8c3d-4e5f6a7b8c9d", "at": { "$date": "2026-10-14T01:00:03.910Z" },
  "service": "backend", "host": { "containerId": "3f1a9b2c4d5e", "startedAt": { "$date": "2026-10-14T01:00:03.502Z" } },
  "release": "5e8a1c2", "kind": "start",
  "detail": { "node": "v22.20.0", "cleanExit": true, "cleanExitAt": { "$date": "2026-10-14T01:00:01.220Z" } } }
```

- **ป้าย “ปิดตามปกติ”** (`lib/error-capture.ts:421`) — บันทึก `shutdown` อยู่ในคิวในหน่วยความจำ ถ้า Mongo หยุดหรือล่มพร้อมกันตอนปิด มันหายไปกับ process แล้ว `start`
  ถัดไปจะดูเหมือนตามหลังการตาย `shutdown` จึงเขียนป้ายลงไฟล์ `/tmp/bdi-<service>.clean-exit.json` ใน container ด้วย (`fatal-exit` ลบมัน) process ถัดไปใน**ชื่อเครื่องเดียวกัน**
  อ่านแล้วลบ และประทับ `cleanExit: true` บน `start` · ป้ายอยู่รอด `docker compose restart` stop/start และการรีบูตเครื่อง (container เดิม) หายเมื่อสร้าง container ใหม่ (ได้ชื่อ
  เครื่องใหม่ จึงไม่มีบันทึกก่อนหน้าให้นับอยู่แล้ว) · ช่วยไม่ได้เมื่อระบบเริ่ม container ใหม่ด้วยชั้นที่เขียนได้ชุดใหม่ในชื่อเครื่องเดิม (Container Apps) หรือเขียนไฟล์ไม่ได้
- **SIGTERM ที่มาระหว่าง fatal กำลังออกไม่บันทึกอะไร** — ทั้งป้ายและ `shutdown`: process นั้นออกเพราะ fatal การเริ่มถัดไปจึงนับเป็นการเริ่มที่ไม่มีคำอธิบาย บวกกับ
  `fatal-exit` ของมัน (container ที่ docker หยุดตรงจังหวะที่กำลังตายด้วย fatal จึงนับเข้ากฎวนรีสตาร์ตด้วย)
- เข้าคิวชั้นบนสุด (5.7) · **ยังเขียนตอนเกินเพดานขนาด** (เล็ก และจำเป็นต่อการจับวนรีสตาร์ต) · ไม่มีเมื่อปิด log store · index `{at:-1}` · ลบที่ 90 วัน (3.9)

### 5.6 การกวาดข้อมูล (`lib/redact.ts`)

ทุกทางที่ข้อความออกจาก process ไปถึง **log store** ผ่านไฟล์นี้: capture (`scrubError` `bodyShape` `requestTarget`) · สำเนา
`activity` ทั้งสามแหล่ง (`maskForLogStore` `maskCidText` — 3.6) · ingest ของรายงาน (5.12) · บันทึกการเรียก admin API (`requestTarget` `foldForMasking` —
4.11) · `failThaidOperation()` ใช้ `scrubClipped` กับข้อความที่ลง Postgres (ข้อ 7) · ฝั่ง **log ของ container** ที่ผ่านไฟล์นี้คือบรรทัด `[capture]` และ `prisma:error` ของ Prisma ตัวหลัก (`databaseLogLine`, `db.ts`)
แต่**ไม่ใช่ทุกทาง**: บรรทัด `[log-store]` ใช้กฎของ `describe()` ใน `lib/log-store.ts` เอง (3.13) · dry-run ของ `lib/mail.ts` (เฉพาะเมื่อไม่ได้ตั้ง SMTP)
พิมพ์ผู้รับ หัวเรื่อง ลิงก์ และรหัส OTP ลง stdout โดยตั้งใจ · `PrismaClient` ของ worker (`workers/delivery.ts:34`) สร้างโดยไม่มี `log` option จึงไม่ผ่าน
`databaseLogLine()` แบบ `db.ts` · `DocumentRenderError` 4xx ของ error middleware พิมพ์ `[backend] <code>: <message>` ด้วยข้อความดิบ ไม่ผ่าน capture และไม่ถูกกวาด (`index.ts:330`, 5.1)

หลักการเป็น allowlist ทุกที่ที่ทำได้ ตารางกวาดข้อความอิสระเป็นชั้นเดียวที่เป็น blocklist จึงเป็น**ชั้นสำรอง**

1. **body** ไม่เก็บค่าเลย — `bodyShape`: ชั้นบนสุดเท่านั้น ≤ 50 คีย์ (ส่วนเกินเป็น `"…": "+N keys"`) · ชื่อคีย์กวาดแล้วตัดที่ 64 · ค่าเป็นรูปร่าง
   `string(n)` `number` `boolean` `null` `array(n)` `object(n)` · คีย์ที่ตรง
   `/passw(?:or)?d|token|secret|otp|^code$|^state$|^error$|^error_?description$|cid$|nationalid|^pid$|signature|phone|email|name|key$/i`
   (`SENSITIVE_BODY_KEY` — ตรงทั้ง `password` และ `passwd`) เหลือแค่
   `"present"` / `"absent"` (absent = ไม่มี null หรือ `""`) ไม่บอกแม้ความยาว — กฎ `name` ติดชื่อทุกรูป (`firstName` `contactLastName` `nameTh`) รวมชื่อ
   หน่วยงานไปด้วย · body ที่ไม่ใช่ object ได้ null
2. **URL** `path` ไม่มี query (กวาดแล้ว ≤ 300) + **ชื่อ**ของ query ≤ 20 ตัว (กวาดแล้ว ≤ 64) — ค่าของ `?token=` `?cid=` `?code&state` ไม่ออกไปเลย ·
   ก่อนกวาด path และชื่อถูกถอด `%xx` ซ้ำจนไม่เปลี่ยน พร้อม NFKC ลบอักษรที่มองไม่เห็นและช่องว่างข้าง `@` (`foldForMasking`) แล้วท่อนหรือชื่อที่ยังมี `@` เหลือ
   `[email]` — `%2540` `＠` zero-width space เคยพาอีเมลรอดกฎ
3. **header** ใน `error_events` มีแค่ `request.userAgent` (กวาดแล้ว ≤ 512) และ `ingest.userAgent` ของรายงาน · ไม่เคยเก็บ `cookie` `x-admin-token`
   `x-log-token` `x-log-reason` `x-report-token` `authorization` `referer`
4. **error object** เฉพาะ property ใน allowlist (5.2 `error.props`) — ไม่เคยเอา `body` ของ body-parser, `response` ของ nodemailer (ยกที่อยู่ผู้รับ) หรือ buffer
   ของไฟล์ · stack ประกอบใหม่จากบรรทัด `at` เท่านั้น บรรทัดหัวดิบ (ซึ่งมี message ดิบ) ถูกทิ้ง
5. **ข้อความอิสระ** (message · stack · cause · ชื่อ error ที่ไม่ใช่ Error · ค่าใน `error.props`) ผ่าน `scrubText()` ตามลำดับในตาราง — UUID ถูกกันไว้ก่อน
   กฎตัวเลขและใส่คืนทีหลัง จึงรอดทั้งตัว:

| รูป | กลายเป็น |
|---|---|
| `detail: Some("Failing row contains (…)")` · `hint: Some("…")` ที่ Prisma ยกแถวที่ Postgres ปฏิเสธมา — **กฎแรกสุด** | `detail: [ตัดทิ้ง]` (หาเครื่องหมายปิดไม่เจอก็ตัดจนสุดข้อความ) |
| บรรทัด `DETAIL:` `HINT:` `CONTEXT:` `WHERE:` ของ raw query (`P2010`) | ` (รายละเอียดของแถวตัดทิ้ง)` — ตัดจากหัวนั้น**จนสุดข้อความ** ไม่หยุดที่อะไรเลย (ค่าในแถวมีบรรทัดที่หน้าตาเป็นเฟรมได้) |
| `PostgresError { code: "23514",` · ``Raw query failed. Code: `23514`.`` · เปลือก `ConnectorError(…)` ทั้งก้อน | `SQLSTATE 23514` (ไม่งั้นกฎ `code` ข้างล่างกลบ) · `Postgres SQLSTATE 23514: <ข้อความของ Postgres>` |
| userinfo ของ URI `scheme://user:pass@host` ถึง `@` **ตัวสุดท้าย**ก่อน `/` หรือช่องว่าง | `scheme://***@host` |
| JWT `eyJ…` | `[jwt]` |
| `Bearer …` · `Basic …` | `Bearer [redacted]` |
| ค่าของคีย์ที่**ลงท้าย**ด้วย `token` `key` `secret` `password` `passwd` `passcode` `passphrase` `otp` `code` `state` `nonce` `auth` `authorization` `cookie` หรือเป็นทั้งคำ (หรือมี `_` `-` นำหน้า) `pwd` `pin` `pass` `pw` `sid` `session` · camelCase `…Pass` `…Pwd` `…Pw` `…Pin` `…Sid` `…Session` (`newPass=` `oldPw=`) — รูป `k=v` `k: v` `"k":"v"` `k='v'` ``k: `v` `` `{\"k\":\"v\"}` ค่าในเครื่องหมายคำพูดวิ่งถึงเครื่องหมายปิด · คีย์กลุ่มวลี (`secret` `password` `passcode` `passphrase` `authorization` `cookie` `pwd` `pass`) ที่ไม่มีเครื่องหมายคำพูดวิ่งถึงสุดบรรทัดหรือ `&` | `k=[redacted]` |
| `otp 482913` · `code 482913` · `pin …` · `passcode …` (เลข 4–8 หลักหลังช่องว่าง — `status code 500` รอด) | `otp [redacted]` |
| อีเมล | `[email]` |
| ก้อน `[A-Za-z0-9_+-]` ยาว ≥ 32 ที่มีตัวเลข · base64 ยาว ≥ 32 ที่มี `/` หรือ `+` และมีทั้งตัวใหญ่ ตัวเล็ก ตัวเลข | `[secret]` |
| เลข 13 หลัก ติดกัน หรือคั่นด้วย `-` `.` `_` ช่องว่าง ไม่เกินสามตัวระหว่างเลข (ไม่นับ `:` — เวลา) · ทุกกฎตัวเลขนับเลขไทยและเลขเต็มความกว้างเป็นเลข | `[cid]` |
| `+66` ตามด้วย 8–9 หลัก · `0` ตามด้วย 8–9 หลัก (ขีด/ช่องว่างคั่นได้) | `[phone]` |

   - ข้อความยาวกว่า 20,000 ตัวกวาดแบบตัด (`scrubClipped`) · ข้อความที่**ผู้เรียก API เลือกเองได้** (ชื่อคีย์ของ body และ query, path, user agent,
     ชื่อ error ที่ไม่ใช่ Error, ค่าใน props) และแต่ละบรรทัดของ stack ผ่าน `scrubClipped(text, max)`: กวาด `text[0:max]` และ `text[0:max+256]` แล้วเก็บส่วนหน้า
     ที่สองรอบตรงกัน — ของที่คร่อมจุดตัดไม่เหลือแม้ท่อนหน้า และ regex ไม่วิ่งบนข้อความขนาดเมกะไบต์บนเส้นทางของคำขอ · regex ทุกตัวเป็นเส้นตรง (ข้อความ 1 MB
     แบบปั่นใช้ 5–6 ms) ข้อจำกัดเดียวที่เหลือ: ของที่ต้องมองไกลกว่า 256 ตัวถึงจะจำได้
   - **stack** (`scrubError`) อ่านแค่ส่วนที่อยู่**ใต้**บรรทัดหัว (`name: message`) ไม่เกิน 64 KB ตัดก้อน DETAIL ทิ้งก่อน เก็บไม่เกิน 50 เฟรม บรรทัดละไม่เกิน 1,024 ตัว
     (ตัดหลังกวาด) รวมไม่เกิน 16 KB · หัวกับแต่ละเฟรมกวาดแยกกัน · ตัวแยกเฟรม (`frameParts`) หาตำแหน่งตรง ๆ ไม่ใช้ regex ที่ย้อนรอยได้ — บรรทัดในข้อความที่หน้าตา
     เป็นเฟรมไม่ถูกหยิบเป็นเฟรมอีก · stack ที่หัวไม่ตรงกับข้อความถูกอ่านทั้งก้อน (ตัด DETAIL ก่อน): เฟรมที่อยู่ใต้ก้อน `DETAIL`/`HINT`/`CONTEXT`/`WHERE` หายไปพร้อม
     ก้อนนั้น ส่วน stack ที่ไม่มีก้อนแบบนั้นยังได้เฟรมและ `topFrame` (และบรรทัดในข้อความที่หน้าตาเป็นเฟรมถูกหยิบได้ เพราะหาจุดสิ้นสุดของข้อความไม่เจอ)
   - อักขระ U+E000 / U+E001 ที่มากับข้อความถูกแทนด้วย U+FFFD ก่อนกัน UUID (`neutraliseHolds`) — ตัวคั่นที่ผู้เรียกเขียนเองเคยถูกลบตอนใส่ UUID คืน แล้วสองท่อน
     ที่มันแยกไว้ต่อกันเป็นเลขบัตร อีเมล หรือ `password=` ดิบ
   - ตั้งใจกวาดเกิน: `code: 'EAUTH'` ในข้อความของ `util.inspect` · ทุกอย่างหลัง `pass=` ในบรรทัดเดียวกัน · URL ที่มี `@` ใน query หลัง host · วันเวลาหรือเลขอื่น
     ที่มี 13 หลักคั่นด้วยจุดหรือขีดล่างเป็น `[cid]`
   - **ยังหลุด** (รู้แล้ว): คีย์กับค่าที่คั่นด้วยช่องว่างอย่างเดียว (`userPw OPv6` `nonce Nq7fF2kX`) · เลขบัตรที่คั่นด้วย `/` (`1/1017/00203/45/1`) · รหัสผ่านใน URI
     ที่มี `/` ไม่ได้ encode · อีเมลที่สะกดโดยไม่มี `@`
   - **ต่างจากแบบ:** แผนมีแค่ `(token|key|secret|password|otp|code|state)=…` `[cid]` `[email]` `[jwt]` `[secret]` `[phone]` ที่สร้างเพิ่มการตัด DETAIL ของ
     Postgres userinfo ของ URI `Bearer`/`Basic` รูปในเครื่องหมายคำพูด คีย์กลุ่มวลี และ `+66`
6. **log ของ Prisma เอง** `databaseLogLine()` ข้อความ ≤ 64 KB → ตัด DETAIL ทั้งก้อน → บรรทัดสุดท้าย → `scrubClipped(…, 500)` (`db.ts`)
7. **`integration_operation.last_error_message`** `failThaidOperation()` เขียน `storableText(scrubClipped(message, 500))` —
   เลขบัตร อีเมล เบอร์ ความลับที่ฝังใน `error_description` ไม่ลงคอลัมน์นี้แล้ว แต่ถ้อยคำที่เหลือยังเป็นของผู้ยิง อย่าอ่านเป็นคำของ ThaID
   (แผนขั้น 5 · §13 ข้อ 39) · **ยังไม่ถูกกวาด**: `notification.notification_delivery.last_error_message` ที่ worker เขียนข้อความดิบของ SMTP 500 ตัว
   (`workers/delivery.ts:134`) ซึ่งยกที่อยู่ผู้รับที่ถูกปฏิเสธมาได้ — API อ่าน log กวาดมันก่อนตอบ (`deliveries` ของ trace)
8. **รายงานที่รับเข้ามา** (`POST /api/client-errors`) กวาดซ้ำที่เซิร์ฟเวอร์ทุกช่อง URL ในข้อความเหลือแค่ path stack ไม่เกิน 200 บรรทัด (5.12)

### 5.7 คิว เพดาน และการทิ้ง

| เพดาน | ค่า | เกินแล้ว |
|---|---|---|
| คิวในหน่วยความจำต่อ process | 500 รายการ / 2 MB | ไล่ตามลำดับชั้นข้างล่าง (`queue_full`) |
| issue ที่รอเขียน | 1,000 fingerprint — ของรายงานเบราว์เซอร์ไม่เกิน 200 · fatal ได้ที่เสมอ | การเกิดครั้งนั้นไม่เข้าแม้ตัวนับ (`issue_backlog` · ของเบราว์เซอร์ `browser_backlog`) |
| event ที่เก็บต่อ fingerprint | 50 ต่อชั่วโมง | นับอย่างเดียว (`capped_issue`) — fatal ไม่ติด |
| event ที่เก็บต่อ process | 600 ต่อนาที — ในนั้นเป็นรายงานจากเบราว์เซอร์ไม่เกิน 60 | นับอย่างเดียว (`capped_process`) — fatal ไม่ติด |
| issue ใหม่จากรายงานเบราว์เซอร์ | 100 fingerprint ต่อชั่วโมงต่อ process · ไม่สร้างตอนเกินเพดานขนาด | เดินแค่ตัวนับของ issue เดิม (5.12) |
| ตัวย่อของรหัสอ้างอิง | 120 ต่อนาทีต่อ process (คำขอที่ไม่มีตัวตนไม่เกิน 60) · ของรายงานเบราว์เซอร์อีก 240 แยกกัน | ไม่เก็บตัวย่อ (5.8, 5.12) |
| ไบต์ของสิ่งที่ใครก็ส่งได้ | งบต่อชนิด (5.13) | ตัวเต็มไม่เก็บ ตัวย่อและใบสรุปใช้ส่วนที่เหลือไว้ |
| เอกสารหนึ่งตัว · `extra` | 64 KB · 16 KB | ตัดตาม 5.2 · เกินหลังตัดแล้ว = ทิ้ง (`too_large`) |
| log store เกินเพดานขนาด | 5.9 | นับอย่างเดียว ไม่เก็บ event ไม่เก็บตัวย่อ — fatal ก็ไม่เก็บ |

เพดาน 50 ต่อชั่วโมงและ 600 ต่อนาทีเป็น**หน้าต่างตายตัว** ไม่ใช่หน้าต่างเลื่อน (`admit()`): หน้าต่างเริ่มที่ event ตัวแรกที่ถูกเก็บหลังหน้าต่างเก่าหมด แล้วนับจนครบ
ชั่วโมง/นาทีนั้น — ช่วงที่คร่อมรอยต่อจึงเก็บได้เกือบสองเท่า · หน้าต่างรายชั่วโมงที่หมดแล้วถูกล้างออกจากหน่วยความจำเฉพาะหลัง flush ที่สำเร็จ (ไม่มีผลกับการนับ)

**ลำดับการทิ้งเมื่อคิวเต็ม** — ชั้นต่ำถูกไล่ก่อน (ตัวเก่าสุดในชั้นนั้น) ตัวที่เข้ามาใหม่ไล่ได้เฉพาะชั้นที่**ต่ำกว่า**ตัวเอง ชั้นเท่ากันแปลว่าตัวใหม่ถูกทิ้ง
(ตัวอย่างแรก ๆ ของเหตุการณ์บอกได้มากกว่าตัวที่ห้าร้อย):

| ชั้น | อะไร |
|---|---|
| 0 | รายงานจากเบราว์เซอร์ (รวมตัวย่อของมัน) |
| 1 | บันทึกการเรียก admin API ตัวเดี่ยว — ที่ถูกเบียดออกพับลงใบสรุป ไม่หาย (4.11) |
| 2 | warning · ตัวย่อของรหัสอ้างอิงของ server · ใบสรุปการเรียก admin API |
| 3 | error |
| 4 | fatal · `runtime_events` · สำเนา `audit_fallback` · event สรุป “ทิ้งไป N” — **เก็บไว้ท้ายสุด** |

**การเขียน** ตัวจับเวลาทุก 2 วินาทีหยิบหนึ่งก้อน (≤ 500 รายการ + issue ที่รอทั้งหมด) **ทีละก้อน ไม่ซ้อน**: `error_events` → `runtime_events` → `activity`
(`insertMany` แบบ unordered) → `error_issues` (`bulkWrite` แบบ ordered) · `_id` ซ้ำ (11000) = เขียนไปแล้วรอบก่อน ถือว่าสำเร็จ · เอกสารที่ Mongo ปฏิเสธ
ด้วยรหัสที่ลองซ้ำก็ไม่ผ่าน (2 9 52 121 10334 17280) ถูกทิ้ง (`rejected`) · ความล้มอื่นทั้งหมด **รวม `MongoBulkWriteError` ที่ `writeErrors` ว่าง** (server
กำลังปิด ต่อหลุดกลางทาง) = ส่วนที่ยังไม่ได้เขียนกลับเข้าคิว แล้วถอยห่าง 4 → 8 → … สูงสุด 60 วินาที · ไม่มี timeout ครอบก้อน (driver คุมแต่ละคำสั่งเอง)
ก้อนที่นานเกิน 15 วินาทีได้บรรทัดเตือนและก้อนใหม่รอจนก้อนเดิมจบ · event และบันทึกการเรียกที่ token ไม่ผ่านที่ค้างคิวอยู่ตอนธงเกินเพดานตั้งถูกข้ามตอนเขียน
(ไม่นับเป็น “ทิ้ง”) ส่วน `runtime_events` สำเนา `audit_fallback` และบันทึกของ token ที่ผ่านเขียนตามปกติ · คิวอยู่ในหน่วยความจำ process ตายแบบไม่ graceful (kill, OOM) = หายทั้งคิว

บรรทัดที่ตัวเขียนพิมพ์ — คู่แรกพิมพ์ครั้งเดียวต่อช่วง (ธง `failing`) ที่เหลือพิมพ์**ทุกครั้ง**ที่เกิด:
- `[capture] <service>: ยังเขียน log store ไม่ได้ (<ชื่อ error และรหัส | log store down>) — เก็บไว้ในหน่วยความจำ N รายการ (เพดาน 500) ลองใหม่ถอยห่างไม่เกิน 60 วินาที` — ครั้งแรกของช่วงที่ล้ม
- `[capture] <service>: เขียน log store ได้อีกครั้ง — ค้างอยู่ N รายการ` — ครั้งแรกที่เขียนได้หลังช่วงนั้น
- `[capture] <service>: Mongo ไม่รับเอกสาร N ตัวใน <collection> — ทิ้งแล้ว` — ทุกก้อนที่มีเอกสารถูกปฏิเสธ
- `[capture] <service>: เขียน log store ก้อนนี้เกิน 15 วินาทีแล้ว — รอให้จบก่อน ไม่เริ่มก้อนใหม่ซ้อน` — ทุกก้อนที่ช้า
- `[capture] <service>: เก็บ error ไม่สำเร็จ (<ชื่อ>) — error เดิมไม่ได้ถูกบันทึก` — ทุกครั้งที่ตัว capture เองล้ม

**event สรุป “ทิ้งไป N”** — หลังเขียนสำเร็จครั้งแรกหลังช่วงที่มีการทิ้ง process วาง event หนึ่งตัว (ชั้น 4 · ไม่ผ่านเพดานการสุ่มเก็บ แต่**ไม่ได้รอดทุกทาง**:
ถูกข้ามตอนเขียนเหมือน event อื่นถ้าธงเกินเพดานขนาดตั้งอยู่ (ตัวนับของ issue ยังเดิน) และ `enqueue` ยังปฏิเสธได้ถ้าคิวเต็มด้วยรายการชั้น 4 หรือเอกสาร
ใหญ่เกิน — กรณีนี้ตัวนับไม่เดิน และตัวเลขที่สะสมไว้ถูกล้างไปแล้ว เหลือแค่บรรทัดใน stdout) และพิมพ์บรรทัดรูปของตัวเอง ไม่ใช่รูปใน 5.8 (ไม่มี `ref=` route/tag หรือ `<Name>:`):
`[capture] <service> warning event=<uuid> issue=error-capture:dropped:<service> — <message>`

- `error.name` `ErrorCaptureDropped` · `level` warning · `tag` `error-capture.dropped` · fingerprint `error-capture:dropped:<service>` · issue ของมันได้
  `title` ตายตัว `ErrorCaptureDropped: ทิ้งสิ่งที่ควรเก็บไป (สาเหตุแยกอยู่ใน event)` และ `culprit` = ชื่อ service (ไม่ใช่กฎ title ของ 5.4)
- `error.message` `ทิ้งไป N รายการระหว่าง <ISO> ถึง <ISO> — <สาเหตุแยกตามชนิด>` [+ ` · ในนั้นเป็นสำเนา audit ที่ Postgres ไม่รับ K รายการ`]
- `extra` `{dropped, from, to, reasons: {queue_full, too_large, rejected, issue_backlog, browser_backlog}, auditCopies}`

| `reasons.*` | แปลว่า |
|---|---|
| `queue_full` | คิวเต็ม (500 รายการ / 2 MB) — Mongo เขียนไม่ได้นาน **หรือ** error มาเร็วกว่าที่เขียนทันแม้ Mongo ปกติ (พายุ error) อย่าอ่านว่า Mongo ล่มเสมอ · **ไม่นับ**การเรียก admin API ที่พับลงใบสรุปเพราะคิวเต็มหรือถูกเบียด (ไม่ได้หาย — `adminAccess.queueFull` `evicted` ของ S1, 4.11) |
| `too_large` | เอกสารตัวเดียวเกิน 64 KB หลังตัดแล้ว |
| `rejected` | Mongo ปฏิเสธตัวเอกสาร ลองซ้ำก็ไม่ผ่าน |
| `issue_backlog` | issue ที่รอเขียนครบ 1,000 fingerprint — ครั้งนั้นไม่ได้เข้าตัวนับด้วย · บรรทัดใน stdout คือ `issue ที่รอเขียนครบ 1000 fingerprint: ไม่ได้นับ` |
| `browser_backlog` | รายงานเบราว์เซอร์ที่ issue ของเบราว์เซอร์ที่รอเขียนครบ 200 fingerprint |
| `auditCopies` | ในจำนวนที่ทิ้ง เป็นสำเนา `audit_fallback` กี่ตัว — **สำเนาเดียวที่เหลือของแถวที่ Postgres ไม่รับ หายแล้วหายเลย** |

วัดแล้ว (2026-09-30): error 600 ตัวระหว่าง mongo ล่ม ได้ event 500 ตัว ตัวนับ 600 และ “ทิ้งไป 100” · คำขอใช้เวลา 12–66 ms ตลอด

**ตัวนับของ issue เป็นค่าประมาณ** — `$inc` ไม่ idempotent: คำสั่งที่ driver เลิกรอแล้ว (`socketTimeoutMS` 5 วินาที) แต่ server ได้รับไว้ถูกทำจริงทีหลัง
แล้วรอบที่ลองซ้ำก็ `$inc` อีกครั้ง หลัง Mongo ค้าง (pause ช้า หรือคำสั่งเดียวเกิน 5 วินาที) ทั้งก้อนจึงนับซ้ำได้ — วัดแล้ว `docker compose pause mongo`
ราว 17 วินาทีระหว่าง error 20 ตัว ตัวนับขึ้น 40 · **เอกสาร event ไม่เคยซ้ำ** (`_id` เดิม) · ตัวเลขตรงต้องให้ก้อนของ issue มี id แล้วกรองด้วย id ที่ใช้แล้ว
ซึ่งเพิ่มฟิลด์ใน `error_issues` — ข้อจำกัดที่ยอมรับ

### 5.8 รหัสอ้างอิงบน 5xx และบรรทัดใน log ของ container

**รหัสอ้างอิง** = 8 ตัวแรกของ correlation id ของคำขอ (`referenceOf()` — ตัวพิมพ์เล็กเสมอ: ตั้งแต่ `74f751f` middleware เก็บ id ที่ผู้เรียกส่งมาเป็นตัวเล็ก
`context.ts:172` · id ที่เก็บก่อนนั้นอาจเป็นตัวใหญ่ 5.11) `referenceOnServerErrors` (`index.ts:110-137`)
ห่อ `res.json` ของทุกคำขอ เมื่อ status ≥ 500 และ body เป็น object ที่มี `error` เป็นสตริง:

1. ถ้ายังไม่มีอะไรในคำขอนี้ถูก `captureError` (`RequestContext.errorCaptured`) เก็บ `RouteServerError` เป็น warning tag `http.route-5xx` fingerprint
   `http:5xx:<METHOD route>:<error>` ข้อความ `<status> <error>: <ข้อความไทยของ route>` ไม่มี stack — dev checkout ที่ไม่ได้ตั้ง ThaID จึงได้ warning
   หนึ่งตัวทุกครั้งที่กดเริ่ม ThaID (501 `not_configured` · เพดาน 50 ตัวต่อชั่วโมงของ fingerprint ใช้ตามปกติ)
2. `keepReference(status)` — ถ้า capture ของคำขอนี้ติดเพดานการสุ่มเก็บ เก็บ**ตัวย่อ**แทน (ข้างล่าง)
3. ต่อ ` (รหัสอ้างอิง xxxxxxxx)` ท้าย `message` (ถ้ายังไม่มีคำนี้) และเพิ่มฟิลด์ `reference` — toast ของหน้าเว็บแสดง `message` จึงถึงตาผู้ใช้โดยไม่ต้องแก้หน้าไหน

500 ทั่วไปตอบ `{"error": "internal", "message": "เกิดข้อผิดพลาดภายในระบบ (รหัสอ้างอิง 1a2b3c4d)", "reference": "1a2b3c4d"}` · 501 ก็ได้ ·
503 ของ `/health/ready` ไม่มีคีย์ `error` จึงไม่ถูกแตะ (ตั้งใจ) · header `x-correlation-id` อยู่ใน `exposedHeaders` ของ CORS (`index.ts:145`)
**ต่างจากแบบ:** แผนให้แก้ข้อความเฉพาะ 500 ทั่วไป ที่สร้างเติมให้ทุก 5xx ที่มี `error` (decision 18 ของแผน) toast ของ 502/503 ของ route จึงมีรหัสด้วย

**5xx ที่ไม่ได้รหัสอ้างอิง** — ตัวห่อแตะแค่ `res.json`: 5xx ที่ส่งทาง `res.send` `res.end` หรือ `sendStatus` และ body JSON ที่ไม่มี `error` เป็นสตริง ไม่ได้ทั้ง
`reference` และ capture `http.route-5xx` (ถ้าไม่มีใครเก็บไว้ก่อน ก็ไม่มีร่องรอยใน Mongo) · error ที่เกิดหลังส่งหัวคำตอบไปแล้วจบด้วย `res.destroy()` ไม่มี
body (มี event `http.after-headers-sent` ที่ถือ correlation id แต่ผู้ใช้ไม่ได้รหัสไปอ่านให้ฟัง)

**ตัวย่อ (`extra.referenceOnly: true`)** — event ที่ติดเพดาน 50/ชั่วโมงหรือ 600/นาที หรืองบไบต์ `anonymous-request` ไม่พอสำหรับตัวเต็ม ไม่มีเอกสารของตัวเอง ถ้าคำขอนั้นจบด้วย 5xx ที่มีรหัสอ้างอิง ตอนตอบ
จะเก็บตัวย่อหนึ่งตัว: `_id` `fingerprint` `level` `tag` `actor` เวลา และ `request` เดิม (`status` = status ที่ตอบ, `bodyShape` null) · `error` เหลือ
`{name, message, props}` (`stack` null, `causes` `[]`) · `breadcrumbs` `[]` · `extra {referenceOnly: true, capped: "capped_issue" | "capped_process" | "anonymous_budget"}`
(ตัวย่อของรายงานเบราว์เซอร์: `capped` เป็น `capped_issue` `capped_process` หรือ `browser_budget` บวก `issueCapped: "browser_fingerprints"` ได้ — 5.12)
ตัวอย่างเต็มของ issue นั้นหาได้จาก fingerprint เดียวกัน · อยู่ชั้น warning ในคิว · ≤ 120 ตัวต่อนาทีต่อ process — คำขอที่ไม่มีตัวตน (`isAnonymousRequest`) ไม่เกิน 60
และหักงบ `anonymous-request` (5.13) · ไม่เก็บตอนเกินเพดานขนาด · คำขอที่จบด้วย
status < 500 ไม่ได้ตัวย่อ · คำขอหนึ่งจำเฉพาะ capture ที่ติดเพดาน**ตัวล่าสุด** และไม่ลบมันเมื่อ capture ตัวหลังของคำขอเดียวกันถูกเก็บเต็ม — คำขอที่มีทั้งตัวที่ติดเพดาน
และตัวที่เก็บได้ แล้วจบด้วย 5xx จึงได้ทั้งเอกสารเต็มและตัวย่อภายใต้ correlation id เดียวกัน

**รหัสค้นไม่เจอเมื่อ**: log store ปิด หรือ down นานจนคิวล้น หรือ process restart ก่อน flush · เกินเพดานขนาด · คิวเต็ม · ตัวย่อเกิน 120 ตัวต่อนาที (60 ของคำขอที่ไม่มี
ตัวตน) · งบไบต์ของคำขอที่ไม่มีตัวตนหมด ·
capture ตกเป็น `issue_backlog` เอกสารใหญ่เกิน 64 KB หลังตัด หรือ Mongo ไม่รับเอกสาร · และ**ชี้ผิดตัว**ได้: ถ้ามี capture อื่นในคำขอเดียวกันก่อนหน้า (เช่น `audit.write-failed`
`thaid.revoke`) `errorCaptured` ตั้งแล้ว 5xx ของ route เองจึงไม่ถูกเก็บ รหัสจะพาไปเจอ event ตัวก่อนหน้านั้นแทน · ทางสำรอง: issue ที่ `culprit` เป็น route นั้น
ในช่วงเวลานั้น บรรทัด `[capture] … ref=xxxxxxxx` ใน log ของ container และแถว audit ด้วย `LIKE` (2.10, 5.11)

**502 `backend_unreachable` ของ proxy** — backend ไม่เคยเห็นคำขอนั้น proxy จึงออกรหัสเองจาก correlation id ใหม่ของมัน พิมพ์ `[frontend-proxy]` ลง stdout ของ frontend
และเบราว์เซอร์ส่งรายงานที่อ้างรหัสนั้นตามมาหลังคำขอที่สำเร็จครั้งถัดไป (5.12) — G6 หาเจอใน `reports` · หาไม่เจอถ้าผู้ใช้ปิดแท็บก่อนมีคำขอที่สำเร็จ หรือคิว 5 รายการ
ของเบราว์เซอร์เต็มแล้วรหัสนั้นถูกทิ้ง

**บรรทัดใน log ของ container** — ทุก `captureError` พิมพ์หนึ่งบรรทัดที่กวาดแล้ว (ยกเว้น `http.request-body` และ `log-store.over-quota`) warning ออกทาง
`console.warn` ที่เหลือ `console.error` — **ทั้งคู่ลง stderr** `docker compose logs` เห็นทั้งสองทาง:

```
[capture] <service> <level> <event> [ref=<8 ตัว>] issue=<fingerprint> <METHOD route | tag | -> — <Name>: <หัวเรื่อง ≤ 300>[ @ <topFrame>]
```

| `<event>` | แปลว่า |
|---|---|
| `event=<uuid>` | เข้าคิวแล้ว — `_id` ของเอกสาร |
| `event=- (log store ปิดอยู่)` | `LOG_STORE_ENABLED` ไม่ใช่ `true` **หรือ** `MONGODB_URI` ว่าง (3.13) |
| `event=- (log store เกินเพดานขนาด: นับอย่างเดียว)` | 5.9 |
| `event=- (เก็บตัวอย่างของ issue นี้ครบ 50 ตัวในชั่วโมงนี้แล้ว: นับอย่างเดียว)` | `capped_issue` |
| `event=- (เกินเพดาน 600 ต่อนาทีของ process: นับอย่างเดียว)` | `capped_process` |
| `event=- (งบไบต์ของคำขอที่ไม่มีตัวตนไม่พอสำหรับตัวเต็ม: นับอย่างเดียว)` | `anonymous_budget` — คำขอที่ไม่มีตัวตน งบ `anonymous-request` หมด (5.13) |
| `event=- (issue ที่รอเขียนครบ 1000 fingerprint: ไม่ได้นับ)` | `issue_backlog` — ไม่เข้าแม้ตัวนับ (5.7) |
| `event=- (คิวเต็ม: ทิ้ง)` | ถูกทิ้งตอนเข้าคิว — คิวเต็มจริง (`queue_full`) **หรือ** เอกสารเกิน 64 KB หลังตัด (`too_large`) ข้อความเดียวกันทั้งสองเหตุ สาเหตุจริงอยู่ใน `reasons` ของ event สรุป (5.7) |

`ref=` มีเมื่อมี correlation id (คำขอ HTTP และแถวของ worker) · `issue=` เป็น 12 ตัวแรกของ fingerprint ตั้งต้น หรือ fingerprint ตายตัวทั้งตัว · `@ topFrame`
มีเมื่อหาเฟรมในโค้ดเราได้ ตัวอย่าง (ข้อมูลสมมติ):

```
[capture] backend error event=0c7d4b1e-2f5a-4c1d-9e3b-6a8f7d2c1b40 ref=1a2b3c4d issue=render:converter_unavailable POST /api/organizations/:id/review — DocumentRenderError: ตัวแปลงเอกสารเป็น PDF ไม่ตอบสนอง … @ lib/document-render:docxToPdf
[capture] delivery-worker warning event=- (เก็บตัวอย่างของ issue นี้ครบ 50 ตัวในชั่วโมงนี้แล้ว: นับอย่างเดียว) ref=9a8b7c6d issue=smtp:421 delivery.send-failed — Error: Message failed: 421 4.7.0 Try again later
```

### 5.9 เพดานขนาดของ log store

- **ค่า** `LOG_STORE_MAX_MB` — ว่าง = 5120 เมื่อ `NODE_ENV=production` ที่อื่น 512 · ค่าที่ไม่ใช่จำนวนบวกใช้ค่าตั้งต้นพร้อมบรรทัด
  `[env] LOG_STORE_MAX_MB: ไม่ใช่จำนวนบวก — ใช้ค่าตั้งต้น … แทน` · เป็นฐานของงบไบต์ด้วย (5.13)
- **ใครตรวจ** `workers/log-upkeep.ts` ใน delivery-worker: รอบแรก 5 วินาทีหลังบูต แล้วทุก 60 วินาที — รอบที่ต่อ Mongo ได้ครั้งแรกสร้าง index ของทุก collection
  (3.9) และตรวจเพดาน จากนั้นตรวจเพดานทุกชั่วโมง และ**ทันที**เมื่อ `relay_state.quotaCheckedAt` ไม่ใช่ค่าที่ process นี้เขียนไว้ (volume ใหม่ขณะ worker วิ่ง หรือมีคนลบ
  `relay_state` ทั้งใบ — พิมพ์ `[log-store] delivery-worker: relay_state ไม่ใช่อย่างที่เขียนไว้ …`) · รอบไม่ซ้อนกันด้วยธง `running` แต่รอบที่เกิน 45 วินาทีแค่**เลิกรอ**
  ไม่ได้ยกเลิก `createIndex` / `dbStats` ที่ค้าง (ทำซ้ำได้ ไม่เสียหาย) · **อยากให้ตรวจทันที ให้ restart worker** · backend ไม่สร้าง index และไม่ตั้งธง
- **วัดอะไร** (`readStorageSize()`, `workers/log-upkeep.ts:288`) `dbStats` แบบ `freeStorage: 1`: ขนาดที่**ใช้อยู่** = `storageSize + indexSize − (freeStorageSize +
  indexFreeStorageSize)` → `storageMb` (`sizeBasis: "in_use"`) · ขนาดที่**จองไว้** (= บนดิสก์) = `storageSize + indexSize` → `allocatedMb`
- **บริการที่ไม่รับ `freeStorage`** (mongo ปฏิเสธ field ที่ไม่รู้จักทั้งคำสั่ง — ลองกับ `mongo:7.0` แล้ว) ถอยไปเทียบขนาดที่จองไว้ (`sizeBasis: "allocated"` — มากกว่าหรือเท่ากับ
  ที่ใช้จริงเสมอ ธงอาจตั้งเร็วไป แต่ไม่มีวันไม่ตั้ง): error ชั่วคราว (เครือข่าย หมดเวลา mongod กำลังปิด) throw แล้วลองใหม่รอบหน้า (60 วินาที) · คำสั่งเปล่าก็ล้ม (เช่นไม่มีสิทธิ์)
  = throw error ของคำสั่งเปล่า · คำสั่งเปล่าผ่าน: รหัสที่แปลว่าไม่รับ option (2 9 14 72 40415) จำไว้จนกว่า worker จะเริ่มใหม่ เตือนหนึ่งบรรทัดและ warning
  `log-store:free-storage-rejected` ครั้งเดียว · รหัสอื่นไม่จำ (รอบตรวจชั่วโมงหน้าขอใหม่) เตือนและ warning `log-store:free-storage-failed` ครั้งเดียวต่อชนิด
- **เขียนที่** `relay_state` `_id:"audit_event"` ด้วย `$set` + upsert: `storageMb` `allocatedMb` `sizeBasis` `maxMb` `overQuota` `quotaCheckedAt`
- **ธง** ตั้งเมื่อ `storageMb > maxMb` · ลงเมื่อ `storageMb < 0.9 × maxMb` · ระหว่างนั้นคงค่าเดิม (กันธงกะพริบทุกชั่วโมงตอนขนาดอยู่แถวเพดาน) · บน `sizeBasis: "allocated"`
  ธงลงได้ทางเดียวคือ `compact` (ขนาดที่จองไว้ไม่ลดเมื่อลบ)
- **ตอนธงตั้ง** worker พิมพ์ `[log-store] delivery-worker: log store ใช้พื้นที่ X MB (จองไว้ Y MB) เกินเพดาน LOG_STORE_MAX_MB Z MB — ต่อจากนี้เก็บแค่ตัวนับ…`
  และเก็บ warning `log-store:over-quota` หนึ่งตัว (ไม่พิมพ์ซ้ำ) · loop แจ้งเตือนส่งอีเมลหนึ่งครั้งต่อครั้งที่เกิน (5.14) · ตอนธงลงพิมพ์ `… ต่ำกว่าเพดานแล้ว — กลับมาเก็บ error
  event ตามปกติ`
- **ผล** ทั้งสอง process เห็นธงในรอบตรวจสถานะถัดไป (≤ 30 วินาที) เป็น `over_quota` และพิมพ์บรรทัดสถานะ `[log-store] <service>: เชื่อมต่อได้ แต่ขนาดเกิน LOG_STORE_MAX_MB แล้ว …`
  (3.13) · error ของ server เดินแค่ตัวนับของ issue (issue ใหม่ของ server ยังถูกสร้าง) ไม่เก็บ event ไม่เก็บตัวย่อ event ที่ค้างคิวถูกข้าม · รายงานเบราว์เซอร์ไม่สร้าง issue ใหม่และไม่
  เก็บ · บันทึกการเรียก admin API ที่ token ไม่ผ่านไม่เก็บเลย · **ยังเขียน**: `runtime_events` · สำเนา `audit_fallback` · บันทึกการเรียกที่ token **ผ่าน** (ภายในส่วนยกเว้น
  `admin-token` — 4.11, 5.13) · relay ยังคัดลอก `activity` ทุกแถว (3.8) · `/health/ready` แสดง `over_quota` (ยังตอบ 200)
- **ต่างจากแบบ:** แผนเทียบ `storageSize` อย่างเดียว ที่สร้างเทียบข้อมูล + index ที่ใช้อยู่จริง เพราะ WiredTiger ไม่คืนพื้นที่ของเอกสารที่ลบให้ระบบ `storageSize` จึงไม่ลด
  หลังลบ ธงที่ตั้งแล้วจะไม่มีวันลง · แผนหยุดทุกอย่างของ `http` ตอนเกินเพดาน ที่สร้างเก็บของ token ที่ผ่านต่อ (4.11)
- **เพดานนี้คุมไบต์ที่ใช้อยู่ ไม่ได้คุมดิสก์** — WiredTiger ใช้พื้นที่ว่างซ้ำได้เฉพาะในไฟล์ของ collection (หรือ index) ที่ปล่อยมันออกมา หลัง prune ลบ `error_events` การโตของ
  `activity` หรือ `runtime_events` จองดิสก์ใหม่ ขนาดบนดิสก์ (`allocatedMb`) จึงเกิน `LOG_STORE_MAX_MB` ได้เท่ากับพื้นที่ว่างที่ collection อื่นถืออยู่ (ราวหนึ่งเพดานในกรณีเลวร้าย)
  · คืนดิสก์จริงได้ด้วย `compact` เท่านั้น (root) · ต้องการให้ดิสก์ไม่เกินค่าหนึ่งจริง ๆ ให้ตั้งเพดานราวครึ่งหนึ่งของค่านั้นแล้วเฝ้าดู `allocatedMb` (S1) · **เพดานนี้ไม่คุม
  `activity`** (3.8)

### 5.10 process handler การปิด process `RELEASE` และ `DEPLOY_ENV`

- `initErrorCapture()` เป็นบรรทัดแรกของ `main()` ทั้ง backend และ worker: ติดตั้งตัวดัก อ่านป้ายการปิดของ process ก่อนหน้า (5.5) แล้วเริ่มตัวจับเวลาเขียนคิว (เมื่อเปิด log
  store) — error ระหว่างบูตรอในคิวจน log store ต่อได้ · ก่อน `startLogStore()` ถูกเรียก `logDb()` คืน null (`log-store.ts:156`) — ใน backend นั่นคือหลัง `loadChoices()`
  และ `ensureContainer()` ถ้าสองขั้นนั้นกินเวลาเกิน 2 วินาทีและมีอะไรในคิวแล้ว รอบเขียนรอบแรกล้ม บูตจึงพิมพ์ `[capture] backend: ยังเขียน log store ไม่ได้ (log store down) …`
  ตามด้วย `เขียน log store ได้อีกครั้ง` ทั้งที่ Mongo ปกติ — ไม่ใช่สัญญาณว่า Mongo มีปัญหา
- **`unhandledRejection`** เก็บเป็น error (`handled: false`) แล้ว**ทำงานต่อ** — Node 22 ที่ไม่มีตัวดักจะออกทั้ง process พร้อมคำขออื่นที่ค้างอยู่ (decision 14)
- **`uncaughtException`** → `exitAfterFatal()`: เก็บเป็น fatal (ไม่ติดเพดานการสุ่มเก็บ แต่ติดเพดานขนาด) ลบป้ายการปิด เขียน `runtime_events` `fatal-exit` รอเขียนคิวไม่เกิน
  2 วินาที แล้ว `exit(1)` · exception ตัวที่สองระหว่างรอ = ออกทันที · มีเส้นตายสำรองที่ 3 วินาที · `main()` ที่ล้มตอนบูตใช้ทางเดียวกัน (`mechanism: captured`
  tag `startup` / `delivery.main`)
- **ใครปลุกกลับ** production (backend และ worker) และ worker ของ dev: restart policy ของ Docker — process ออก container ก็ออก ไม่ว่า PID 1 จะเป็น node หรือ `sh`
  (ลองแล้วกับ worker ได้ `RestartCount 1` · backend ของ production ยังไม่ได้ลอง) · **dev checkout: backend รันใต้ `tsx watch` ซึ่งไม่ restart ตัวลูกที่ออกเอง API จึงล่มค้าง
  จนกว่าจะมีไฟล์ source เปลี่ยน** และ Docker ไม่เห็นว่าล่มเพราะ tsx ยังอยู่ · **delivery-worker ของ dev รัน `tsx` แบบไม่มี watch** (`npm run worker:delivery`) — แก้โค้ดที่ worker
  ใช้ (relay prune loop แจ้งเตือน render ของอีเมล) แล้วต้อง `docker compose restart delivery-worker` เอง
- **storage ที่ล้มกลางการดาวน์โหลด** ไม่ใช่ `uncaughtException` อีกแล้ว (`lib/attachment.ts`): เปิด blob ไม่ได้ตั้งแต่ต้น = 503 `storage_unavailable` · ล้มก่อนส่งหัวคำตอบ = 503 ·
  ล้มหลังส่งหัวแล้ว = ปิด socket (curl ได้ exit 18) · ทั้งหมดเก็บเป็น `storage.stream` พร้อมผู้ใช้และคำขอ · ผู้เรียกตัดสายเองไม่เก็บ (ลองแล้ว: ดาวน์โหลด 80 MB แล้วหยุด azurite
  กลางทาง backend ยังขึ้น `/health/live` 200)
- **การปิด** (SIGTERM / SIGINT) — ลำดับอยู่ใน 3.10 ทั้งสอง process อยู่ใน 10 วินาทีของ compose · ยังไม่รอคำขอที่กำลังวิ่ง (2.8) · ทั้งหมดนี้เกิดเฉพาะเมื่อ SIGTERM ถึง node:
  worker ของ prod overlay (`command: ["node", "dist/workers/delivery.js"]`) node เป็น PID 1 ส่วน backend ของ prod overlay รันผ่าน
  `sh -c "npx prisma migrate deploy && node dist/index.js"` (ash ของ `node:22-alpine`) — node ได้ SIGTERM ก็ต่อเมื่อ ash `exec` คำสั่งสุดท้าย **[ยังไม่ได้ลอง]**
  ตรวจได้ด้วย `docker compose exec backend ps` บน image ของ production หรือดูว่ามีบันทึก `shutdown` หลัง deploy ถ้าไม่มี compose `SIGKILL` ที่ 10 วินาที และคิว แถวสรุปของ
  token ที่ค้าง ใบสรุปของการเรียก admin API กับบันทึก `shutdown` หายทั้งหมด (ป้ายการปิดก็ไม่ถูกเขียน — การเริ่มถัดไปนับเป็นการเริ่มที่ไม่มีคำอธิบาย 5.14)
- **`RELEASE`** `env.release = optional("RELEASE", "dev")` — ไม่ได้ตั้ง**หรือเป็นสตริงว่าง**ได้ `dev` · image ของ backend (stage runner): `ARG GIT_SHA=unknown` → `ENV
  RELEASE=$GIT_SHA NODE_OPTIONS=--enable-source-maps` · worker ใช้ image เดียวกัน · frontend: `GIT_SHA` → `NEXT_PUBLIC_RELEASE` (5.12) · prod overlay ส่ง
  `GIT_SHA: ${GIT_SHA:-unknown}` ให้ทั้งสาม สคริปต์ deploy จึง**ต้องตั้ง** `GIT_SHA=$(git rev-parse --short HEAD)` ใน shell ตอน build ไม่งั้นได้ `unknown` (Azure: `--build-arg
  GIT_SHA` — docs/20 §9) · dev checkout = `dev` · **ห้ามใส่ `RELEASE` ใน environment ของ compose**: ค่าว่างจาก `${RELEASE:-}` ทับค่าที่ image ฝังไว้แล้วกลายเป็น `dev` ·
  `GET /` คืน `{service, version, release}` · **ต่างจากแบบ:** ไม่มีส่วนต่อท้าย `-dirty`
- **`DEPLOY_ENV`** compose ตั้ง `${DEPLOY_ENV:-${COMPOSE_PROJECT_NAME:-bdi-project}}` — `bdi-main` บน `main/` และ `bdi-<ชื่อ checkout>` บน dev checkout · ค่าตั้งต้นใน
  `env.ts` (นอก compose) คือ `NODE_ENV` · Azure ตั้ง `DEPLOY_ENV=azure` · **ต่างจากแบบ:** `release` และ `deployEnv` อยู่ชั้นบนของ `env` ไม่ได้อยู่ใน `env.logStore`
- ปิด log store แล้วบรรทัด `[capture]` ยังพิมพ์ตามเดิม (บรรทัดไม่มี environment หรือ release)

### 5.11 runbook ของผู้ดูแลระบบ

**ทางหลักคือ API อ่าน log (3.11)** — ทุกการอ่านทิ้งร่องรอย `AUDIT_LOG_READ`:

| งาน | Postman | หมายเหตุ |
|---|---|---|
| หา error ของรหัสอ้างอิงที่ผู้ใช้อ่านให้ฟัง | G6 `trace/<8 ตัว>` | ได้ทั้งกิจกรรม error อีเมลในคิว งานกับระบบภายนอก และรายงานจากเบราว์เซอร์ที่อ้างรหัสนั้น · เอกสารที่ `extra.referenceOnly: true` คือตัวย่อ (5.8) ตัวอย่างเต็มของ issue เดียวกันดูที่ E2 · correlation id ที่เก็บก่อน `74f751f` อาจเป็นตัวพิมพ์ใหญ่ — prefix ในรูปตัวเล็กหาไม่เจอ ใช้ mongosh `/^1A2B3C4D/i` |
| ดู issue ที่เปิดอยู่ · ตัวอย่างล่าสุด · เหตุการณ์เดียว | E1 · E2 · E3 | `count` เป็นค่าประมาณ (5.7) และรวมครั้งที่ติดเพดาน · `level=` เทียบตรงตัว: `level=error` ซ่อน warning **และ fatal** ด้วย — ดู fatal ด้วย `level=fatal` อีกครั้ง |
| ปิด ละเว้น หรือเปิดกลับ issue | E4 | ตั้ง `statusChangedAt` ให้เอง และเขียน `ERROR_ISSUE_STATUS_CHANGED` — **อย่าแก้สถานะด้วย mongosh อีก** (ไม่มีร่องรอยในแอป และต้องตั้ง `statusChangedAt` เองให้ถูก 5.4) |
| สุขภาพของ log store relay คิว งบไบต์ และ loop แจ้งเตือน | S1 | ตัวเลขของ backend process ที่ตอบ |
| “คนนี้ทำอะไร” · เส้นเวลาของคำขอ · ใครอ่านประวัติของเขา | G2 · G3 · G7 | 2.10 สำหรับคำถามที่ต้องการคอลัมน์ดิบของ Postgres |

**mongosh — เฉพาะงานที่ API ไม่มี** (log store `down` · rebuild · ลดขนาด · ปิด log store) ทุกคำสั่งรันจากไดเรกทอรีของ stack นั้น (`main/` คือ production — อย่ารัน
ระหว่างที่มีคน deploy) · ผลลัพธ์มีข้อมูลส่วนบุคคลบางส่วน อย่าคัดลอกออกนอกเครื่อง · **การเข้าแบบนี้ไม่ทิ้งร่องรอยในแอป** (6.1) — จดในการ์ดว่าเข้าไปทำอะไร

mongo ไม่ผูกพอร์ตออกโฮสต์ จึงเข้าผ่าน container ด้วยรหัสผ่านที่อยู่ใน env ของ container อยู่แล้ว **ไม่พิมพ์รหัสผ่านลง command line ของเครื่อง**:

```bash
cd /hdd1tb/bdi-project/main
# root — drop ได้ทุกอย่าง ใช้เฉพาะงานที่ต้องใช้ (เปลี่ยนรหัสผ่าน compact)
docker compose exec mongo sh -c 'mongosh -u "$MONGO_INITDB_ROOT_USERNAME" -p "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin "$MONGODB_DB"'
# bdi_worker — ผู้ใช้ของ worker พอสำหรับ rebuild และลดขนาด (ลบได้ drop ไม่ได้)
docker compose exec mongo sh -c 'mongosh -u bdi_worker -p "$MONGO_WORKER_PASSWORD" --authenticationDatabase "$MONGODB_DB" "$MONGODB_DB"'
```

- `$…` อยู่ในเครื่องหมายคำพูดเดี่ยว จึงถูกแทนค่า**ใน container** ไม่ลง history ของเครื่อง — แต่ระหว่างที่ mongosh เปิดอยู่ รหัสผ่านอยู่ใน argument ของ process นั้น
  ซึ่ง `ps` บนเครื่องเห็นได้ เปิดสั้น ๆ แล้วออก
- `docker compose exec mongo mongosh` เปล่า ๆ ต่อได้ แต่เปิด auth ไว้: `ping` / `hello` ใช้ได้ (healthcheck พึ่งข้อนี้) คำสั่งที่อ่านข้อมูลหรือจัดการถูกปฏิเสธ
- รหัสผ่านใน env ของ container คือค่าใน `.env` **ตอนสร้าง container** — ลำดับที่ถูกเมื่อเปลี่ยนอยู่ใน 3.12

**1. `logStore` เป็น `down`**

1. ดูสถานะ: `curl -s localhost:<พอร์ต API>/health/ready` (`checks.logStore`) · `docker compose ps mongo` · `docker compose logs --tail 50 mongo`
2. ดูสาเหตุ: `docker compose logs backend delivery-worker | grep -E '\[log-store\]|\[log-relay\]|\[capture\]' | tail -30` (3.13) — **ไม่ใส่ `--since` สั้น ๆ**:
   บรรทัด `ใช้ MongoDB ไม่ได้ — <สาเหตุ>` พิมพ์ครั้งเดียวตอนสถานะเปลี่ยน แล้วพิมพ์ใหม่เฉพาะเมื่อสาเหตุเปลี่ยนและห่างกันเกินสิบนาที
3. สาเหตุที่พบบ่อย: container ไม่ขึ้นหรือวนรีสตาร์ต — บน production ดูบรรทัด `[mongo] ไม่เริ่ม MongoDB: …` แล้วตั้งรหัสผ่านตาม 3.12 · `Authentication failed` —
   รหัสผ่านใน `.env` ไม่ตรงกับผู้ใช้ใน volume (รหัสผ่านใช้ครั้งเดียวตอน volume ว่าง) ทำตามลำดับใน 3.12 · `driver แยก MONGODB_URI ไม่ได้` หรือ `@ เกินหนึ่งตัว` —
   encode อักขระพิเศษใน URI · ดิสก์เต็ม
4. ปลุก mongo อย่างเดียว: `docker compose up -d --no-deps mongo` (บน `main/` ใส่ `-f docker-compose.yml -f docker-compose.prod.yml` ด้วย) backend กับ worker ต่อใหม่เอง
   ในรอบตรวจ 30 วินาทีถัดไป relay ตามต่อจาก cursor ไม่ต้อง restart
5. ระหว่างที่ down: เว็บและอีเมลทำงานตามปกติ · capture ค้างคิว ≤ 500 รายการ / 2 MB ต่อ process แล้วทิ้งตามชั้น (5.7) · restart backend หรือ worker ระหว่างนี้ = คิวหาย ·
   หลังฟื้นดู issue `error-capture:dropped:<service>` (E2)

**2. `logStore` เป็น `over_quota`** — S1 ดู `storageMb` `allocatedMb` `maxMb` · **S1 ไม่คืน `sizeBasis`** (ตัวตัดสินว่าลบเอกสารแล้วธงลงได้ หรือต้อง `compact`) อ่านด้วย
mongosh: `db.relay_state.findOne({ _id: "audit_event" }, { sizeBasis: 1, storageMb: 1, allocatedMb: 1 })` — บน `allocated` `storageMb` เท่ากับ `allocatedMb` เสมอ · ทางออก: ขึ้น `LOG_STORE_MAX_MB` แล้วสร้าง worker ใหม่ (worker ตรวจตอนบูต)
หรือลด `error_events` ที่ไม่ต้องการแล้วด้วย `bdi_worker` (`db.error_events.deleteMany({ occurredAt: { $lt: ISODate("…") } })`) — **ห้ามลบ `activity`** (`audit_fallback`
และ `http` เป็นสำเนาเดียว) ธงลงเมื่อรอบตรวจถัดไปเห็นต่ำกว่า 90% (restart worker ให้ตรวจทันที) · บน `sizeBasis: "allocated"` ธงลงได้ทางเดียวคือ `compact` ด้วย root (5.9) ·
ดู `untrustedBudget` ว่าของที่ใครก็ส่งได้กำลังถูกปฏิเสธไหม (5.13)

**3. rebuild สำเนาของ `audit_event`** (เปลี่ยน `LOG_HASH_KEY` หรือ `SCHEMA_VERSION`) — คำสั่งเดียวใน 3.8 **อย่าลบเอกสาร `relay_state` ทั้งใบ**

**4. ปิด log store** — ตั้ง `LOG_STORE_ENABLED=false` ใน `.env` แล้วสร้าง backend กับ delivery-worker ใหม่: `docker compose up -d --no-deps backend delivery-worker`
(บน `main/` ใส่ไฟล์ compose ทั้งสอง และ dump log ของ backend ก่อน เพราะ container ใหม่ไม่มี log เก่า) ไม่ต้อง build · ตรวจว่า `/health/ready` แสดง `disabled` และ
มีบรรทัด `[log-store] backend: ปิดอยู่ (LOG_STORE_ENABLED ไม่ใช่ true)` · mongo ปล่อยรันต่อหรือ `docker compose stop mongo` ก็ได้ · **อย่าปิดด้วยการเว้น URI ให้ว่าง** —
compose ไม่อ่าน `MONGODB_URI` จาก `.env` และเติม URI ตั้งต้นกลับมาเมื่อ `MONGODB_BACKEND_URI` / `MONGODB_WORKER_URI` ว่าง (3.13) · เปิดคืน = ลบบรรทัดนั้น (หรือตั้ง `true`)
แล้วสร้างสอง service ใหม่อีกครั้ง

**5. รหัสอ้างอิงที่ G6 หาไม่เจอ** (เหตุผลใน 5.8) — บรรทัดใน log ของ container: `docker compose logs --since 24h backend delivery-worker | grep 'ref=1a2b3c4d'` (log ของ backend
บน `main/` หายทุกครั้งที่ deploy) แล้วดู issue ของ route นั้นในช่วงเวลานั้น (E1 `since=`) · 502 ของ proxy ที่ยังไม่ถูกส่งมาอยู่ใน `sessionStorage` ของเบราว์เซอร์ผู้ใช้ (5.12)
และใน stdout ของ frontend: `docker compose logs frontend | grep 'frontend-proxy'`

### 5.12 รายงานจากเบราว์เซอร์และ Next server (ขั้น 9)

**`POST /api/client-errors`** (`routes/client-errors.ts`) — ติดตั้งต่อจาก `correlationMiddleware` และ**ก่อน** `express.json` ของทั้ง app มีตัวอ่าน body ของตัวเอง
(`text/plain` ของ `sendBeacon` ซึ่งไม่ต้อง preflight ข้าม origin และ `application/json`) **เพดาน 16 KB** · **ตอบ 204 เสมอ** ไม่ว่าจะรับ ไม่รับ อ่านไม่ออก หรือเกินเพดาน ·
ไม่ต้องล็อกอิน (error เกิดได้ตั้งแต่หน้า login, activate, callback ของ ThaID) ไม่ audit และ**ไม่พิมพ์รายงานลง stdout** (ใครก็ยิงถี่ได้)

- **ข้อมูลเชื่อไม่ได้ทั้งก้อน**: zod แบบ strict แล้วกวาดซ้ำฝั่ง server ทุกช่องที่เป็นข้อความ (`scrubClipped`) · URL ในข้อความและในทุกบรรทัดของ stack เหลือแค่ path —
  query และ `#…` ถูกตัด เหลือ `:บรรทัด:คอลัมน์` (`withoutUrlQueries` — ตัดเฉพาะคำที่มี `/` ก่อน `?`/`#` ตัวแรก) กฎเดียวกันใช้ในเบราว์เซอร์และในบรรทัด stdout ของ Next
  server ด้วย · stack กวาดได้ไม่เกิน 200 บรรทัด (ตัดก่อนกวาด — body 16 KB ของบรรทัดสั้นห้าพันบรรทัดเคยถือ event loop 20–75 ms ต่อรายงาน) บรรทัดละ 1 KB รวม 16 KB ·
  หน้าเหลือรูปที่จัดกลุ่มได้ (`pagePattern`: ไม่มี query UUID → `:id` เลขตั้งแต่ 4 หลัก → `:n`) · `release` ที่ไม่ใช่รูป SHA หรือชื่อสั้นเป็น `unknown` · เวลาที่ผู้ส่งบอก
  (`at`) เชื่อเฉพาะเมื่อไม่อยู่ในอนาคตและไม่เก่ากว่าหนึ่งวัน
- **`service: "frontend-server"` เฉพาะเมื่อ `x-report-token` ตรง `INGEST_SERVER_TOKEN`** (`secretMatches`) และ `x-report-source: frontend-server` — backend เรียกได้ตรง
  header อย่างเดียวจึงพิสูจน์อะไรไม่ได้ นอกนั้นเป็น `browser` พร้อม `ingest {verified: false, claimedService}` · proxy ของหน้าเว็บลบ `x-report-*` ของเบราว์เซอร์ทิ้งอยู่แล้ว ·
  **รายงานของ Next server ที่ยืนยันไม่ได้** (token ไม่ได้ตั้งหรือไม่ตรงสองฝั่ง) เป็น `browser` เต็มตัว: route ถูกทิ้ง (`where` มาจาก `pathname` ซึ่ง Next server ไม่ส่ง
  fingerprint จึงตกไปใช้ mechanism — error ข้อความเดียวกันของทุก route รวมเป็น issue เดียว) และติดกติกาของเบราว์เซอร์ทั้งหมด: 30 ต่อนาทีของ IP ของ container
  frontend · งบไบต์ `browser` · `isChunkLoadReport` · โควตาแจ้งเตือน 5 ต่อหกชั่วโมงที่ส่งโดยไม่มีข้อความ (5.14)
- **เพดานต่อ backend process**: รายงานจากเบราว์เซอร์ 30 ต่อนาทีต่อ IP (IP คือค่าท้ายของ `X-Forwarded-For` ที่ผู้เรียกเขียนเองได้ — นับแยกได้ไม่เกิน 5,000 IP ต่อนาที
  เกินนั้นและทุกรายงานที่ไม่มี IP ที่ใช้ได้ เช่น `X-Forwarded-For` ที่ไม่ใช่รูป IP ใช้ถัง `(อื่น ๆ)` ถังเดียว 30 ต่อนาที ใครก็ใช้ถังนี้หมดได้) และ 300 ต่อนาทีรวม · Next server ที่ยืนยันแล้ว
  120 ต่อนาที · เกินแล้วไม่เก็บแม้ตัวนับ · จากนั้น `captureReport()` (`lib/error-capture.ts:811`) ใช้กติกาของ `captureError` (นับเข้า issue ก่อน แล้วจึงตัดสินว่าจะเก็บตัว
  event) บวกกติกาของรายงานเบราว์เซอร์:
  - เก็บตัว event ได้ไม่เกิน 60 ต่อนาที (ในจำนวน 600 ของ process) อยู่ชั้นล่างสุดของคิว (ทิ้งก่อนทุกอย่าง) และทุกตัวหักงบไบต์ `browser` (5.13)
  - **สร้าง issue ใหม่ได้ไม่เกิน 100 fingerprint ต่อชั่วโมง และไม่สร้างเลยตอนเกินเพดานขนาด** — fingerprint ของเบราว์เซอร์คือข้อความที่ผู้ส่งเขียน ข้อความไม่ซ้ำหนึ่งตัวคือ
    issue ใหม่หนึ่งใบ ที่เกินเดินได้แค่ตัวนับของ issue เดิม (`browserReportsNotCreatingIssues` ใน S1) · issue ที่รอเขียนของเบราว์เซอร์ไม่เกิน 200 จาก 1,000 ที่ (5.7) ·
    worker ลบ issue เบราว์เซอร์ที่ยังเปิดแต่ไม่เกิดอีก 30 วัน (3.9)
  - fingerprint ตายตัว `browser:chunk-load` และ `proxy:backend_unreachable` ไม่กินที่ในร้อยตัว — สร้าง issue ได้เสมอ
  - **รายงานที่มีรหัสอ้างอิง** (`browser.reference` — หน้า global-error, 502 ของ proxy) เก็บตัว event เสมอเมื่อไม่เกินเพดานขนาด แม้ issue ไม่ถูกสร้าง
    (`extra.capped: "browser_fingerprints"`) และไม่ติดเพดาน 50 ต่อ fingerprint · ที่เกินเพดานต่อนาที หรือตัวเต็มเกินงบไบต์ เก็บเป็น**ตัวย่อ** (ชื่อ ข้อความ ≤ 300 ตัว
    ไม่มี stack ไม่มี `lastApi` · `extra {referenceOnly: true, capped, issueCapped?}`) ไม่เกิน 240 ต่อนาที แยกจากตัวย่อ 120 ตัวของ server — G6 ค้นเจอเหมือนตัวเต็ม ·
    ที่ไม่ได้เก็บทั้งสองแบบนับใน `browserReferencesLost` ของ S1
- fingerprint (`fingerprintOf`): `proxy:backend_unreachable` (กลไก `proxy`) · `browser:chunk-load` · `frontend-server:eacces` (`EACCES` ของ `.next/cache` ใน image —
  แผน §13 ข้อ 5) · นอกนั้น `sha1(service | ชื่อ | หัวเรื่องที่ normalize | หน้าหรือ route ของ Next)` ไม่ใช้เฟรม (บันเดิลเปลี่ยนทุก build) · issue ได้ `service` และ `release`
  ของรายงาน ไม่ใช่ของ backend
- **chunk ที่โหลดไม่ขึ้น** (deploy ใหม่ระหว่างที่หน้าเก่ายังเปิด) เป็น warning ใน `browser:chunk-load` ซึ่ง**ไม่แจ้งเตือน** — มีสองถ้อยคำ: webpack ของ `next dev --webpack`
  (`Loading chunk 123 failed.`) และ Turbopack ของ `next build` ใน production (`Failed to load chunk /_next/static/chunks/<hash>.js from module …`) ตรวจทั้งชื่อ
  (`ChunkLoadError`) และถ้อยคำ ทั้งใน `isChunkLoadReport` (backend) และ `isChunkLoadError` (`frontend/lib/report-error.ts`) — ต้องแก้คู่กัน · เฉพาะ `browser`: Next
  server ที่โหลด chunk ของตัวเองไม่ขึ้นคือ image เสีย
- เก็บใน `error_events` ด้วยรูปของ 5.2: `browser {pathname, digest, reference, release, lastApi[≤5 — method, path ไม่มี query, status, correlationId]}` ·
  `ingest {verified, claimedService, ip, userAgent}` · `actor` null · `breadcrumbs` `[]` · ของ Next server: `request {method, route, path, queryKeys}` และ
  `extra.digest` · เก็บเป็น JSON ตอบเป็น JSON ไม่มีอะไร render เป็น HTML

**เบราว์เซอร์** (`frontend/lib/report-error.ts`, `instrumentation-client.ts`, `app/global-error.tsx`, `lib/api.ts`):

- รายงาน `error` / `unhandledrejection` ของ `window` ที่ไม่มีใครจับ และหน้า global-error (แสดงรหัสอ้างอิงที่เบราว์เซอร์สร้างเองแล้วส่งรายงานที่อ้างรหัสนั้น)
- **ไม่รายงาน `ApiError`** — 5xx ของ backend ถูกเก็บพร้อมรหัสอ้างอิงแล้ว ยกเว้น **502 `backend_unreachable` ของ proxy** ซึ่ง backend ไม่เคยเห็น: เข้าคิวใน `sessionStorage`
  (`bdi.pendingErrorReports` ไม่เกิน 5 รายการ) แล้วส่งหลังคำขอ API ถัดไปที่สำเร็จด้วย `fetch` (keepalive ไม่แนบ cookie) ลบออกจากคิวเฉพาะเมื่อ backend ตอบ 2xx ล้มเกิน 5 ครั้ง
  ทิ้ง · คิวเต็มทิ้งรหัสที่**ไม่เคยขึ้นจอ**ก่อน — ห้าวินาทีหลังแต่ละ 502 `MutationObserver` ดูว่ารหัสโผล่ที่ไหนในหน้า (toast ข้อความใน login) ลำดับการทิ้ง: ไม่เคยขึ้นจอ →
  ขึ้นจอแล้วแต่ไม่ใช่ตัวล่าสุด → ที่ยังอยู่ในห้าวินาที → ตัวล่าสุดที่ขึ้นจอ · status 0 (เชื่อมต่อไม่ได้เลย) ไม่รายงาน
- ส่งแค่ `location.pathname` · ซ้ำกัน (ข้อความ + เฟรมแรก) ส่งครั้งเดียว · ไม่เกิน 10 รายงานต่อการเปิดหน้า และรายงานที่มีรหัสอ้างอิงมีโควตา 10 ของตัวเอง ไม่ถูกตัดเป็นตัวซ้ำ ·
  body ไม่เกิน 15,000 **ไบต์** (`lib/report-body.ts` ตัดเฟรมทั้งบรรทัดก่อน — ingest ทิ้งทั้งก้อนที่เกิน 16 KB เงียบ ๆ) · `navigator.sendBeacon` แบบ `text/plain` ไม่ได้ก็ `fetch`
- **dev checkout ไม่ผ่านทาง proxy เป็นค่าตั้งต้น**: `new-dev.sh` เขียน `NEXT_PUBLIC_API_URL=http://localhost:41N0` เบราว์เซอร์เรียก backend ตรง backend ที่หยุดได้ status 0
  ไม่มีรหัสและไม่มีอะไรเข้าคิว ลองทาง 502 → รหัส → G6 ด้วย `NEXT_PUBLIC_API_URL= docker compose up -d --no-build --no-deps frontend` แล้วรันคำสั่งเดิมโดยไม่มีตัวแปรนั้นเมื่อเสร็จ

**proxy ของหน้าเว็บ** (`frontend/app/api/[...path]/route.ts`): ตั้ง `x-correlation-id` ใหม่ทุกคำขอ (เบราว์เซอร์เลือก id เองไม่ได้ — 2.5) · ลบ `x-report-*` ของเบราว์เซอร์ ·
ตอบ 404 ให้ `/api/admin/logs*` · backend ติดต่อไม่ได้ = 502 `{error: "backend_unreachable", message: "… (รหัสอ้างอิง xxxxxxxx)", reference}` พร้อมบรรทัด
`[frontend-proxy] {…}` ใน stdout · ส่ง `X-Forwarded-For` ของเบราว์เซอร์ต่อตามเดิม (ตัดสิน 2026-09-30 — ทิ้งแล้วทุกคนจะได้ที่อยู่ของ container ของ frontend) IP ในทุกบันทึกจึง
เป็นค่าที่ผู้เรียกเขียนเองได้ ยกเว้นที่ edge ต่อท้ายที่อยู่จริงให้ — **[ต้องตัดสิน]** ยืนยันกับ Cloudflare tunnel ของ `main` ว่าต่อท้ายจริง หรือเลือกเชื่อ `cf-connecting-ip`
ที่ทางเข้ามีแค่ Cloudflare (`CLAUDE.md` Traps, docs/09 §4.1, แผนขั้น 9)

**Next server** (`frontend/instrumentation.ts`, `lib/server-error-report.ts` — โหลดเฉพาะ runtime ของ Node): `onRequestError` (มี `digest`) ตัวฟัง `unhandledRejection` และ
`uncaughtExceptionMonitor` พิมพ์บรรทัด `[frontend-error] {…}` ที่กวาดแล้ว (มี `level`) และ POST แบบยิงแล้วไม่รอ (timeout 1 วินาที) พร้อม `x-report-token` — คำตอบ error ของ Next
ไม่รอรายงาน · ฝั่ง Next จำกัดเองไม่เกิน 60 รายงานต่อนาทีต่อ process และ mechanism + ชื่อ + ข้อความ + route เดียวกันรายงานครั้งเดียวต่อนาที (`admit()` ใน
`lib/server-error-report.ts`) เกินแล้วไม่มีทั้งบรรทัด `[frontend-error]` และการ POST · ส่งชื่อคีย์ของ query (`request.queryKeys`) ไม่ส่งค่า · `digest` ของ Next ลง `extra.digest` — หน้า global-error ของ production ได้จาก server แค่ digest
ไม่มีข้อความ G6 จึงโยงรายงานของเบราว์เซอร์ไปหา error จริงด้วย `serverErrors` (3.11) · **คำขอที่ผิดรูปเป็น warning ไม่ใช่ error** (`malformedRequest()`): RSC request ที่มี
`Next-Router-State-Tree` แปลก (รหัส `E10` `E142` `E418` ของ Next 16.2.12 หรือถ้อยคำของมัน) ใครก็ส่งได้ ยังเก็บและนับ แต่ไม่แจ้งเตือน · ลองแล้วใต้ `output: "standalone"`
ของ `next build` จริง (2026-10-01): ทั้งสามทางรายงานถึง และ server ทำงานต่อหลัง uncaught exception · `INGEST_SERVER_TOKEN` อ่านตอนรัน **ห้ามเป็น `NEXT_PUBLIC_`**

**รุ่น**: `frontend/Dockerfile` `ARG GIT_SHA` → `ENV NEXT_PUBLIC_RELEASE` (อยู่เหนือ `RUN npm run build` หลัง `COPY` ทั้งสอง) ฝังในบันเดิลของเบราว์เซอร์และใน Next server ·
dev = `dev` · prod overlay ส่ง `GIT_SHA: ${GIT_SHA:-unknown}` ให้ทั้งสาม service ที่ build

### 5.13 งบไบต์ของสิ่งที่ใครก็ส่งได้ (`lib/untrusted-budget.ts`)

เพดานต่อนาทีคุมความถี่ ไม่ได้คุมปริมาณสะสม และของที่เก็บอยู่ได้ 30 ถึง 400 วัน — คนที่ไม่มีอะไรนอกจาก URL ยิงไม่หยุดก็เติม log store ได้ไม่จบ แล้วพอถึง
`LOG_STORE_MAX_MB` ธง `over_quota` ปิดของที่สำคัญกว่า: error event ของ server ทุกตัว (และการแจ้ง “5xx ต่อเนื่อง” ที่นับจาก event) งบไบต์ทำให้สิ่งที่ใครก็ส่งได้**พาเพดาน
ไปถึงเองไม่ได้**

| ถัง | ของอะไร | ส่วนของเพดาน | อายุที่ใช้คิด | production (5 GB) ต่อวัน |
|---|---|---|---|---|
| `browser` | รายงานจากเบราว์เซอร์ (ไม่มี `x-report-token` ที่ตรง) ทั้งตัวเต็มและตัวย่อของรหัสอ้างอิง | 15% | 30 วัน | ราว 26 MB |
| `anonymous-admin` | `ADMIN_API_REQUEST` ที่ token ไม่ผ่านหรือไม่ได้ตรวจ ทั้งตัวเดี่ยวและใบสรุป | 5% | 90 วัน | ราว 2.8 MB |
| `anonymous-request` | error event ของ backend ในคำขอ HTTP ที่ไม่มีตัวตน (`isAnonymousRequest()` ใน `lib/context.ts`: ไม่มีผู้ใช้จาก session ไม่มี admin token หรือ log token ที่ผ่าน) ทั้งตัวเต็มและตัวย่อของรหัสอ้างอิง — fatal ไม่หัก | 5% | 90 วัน | ราว 2.8 MB |
| `admin-token` (**ไม่ใช่**ของที่ใครก็ส่งได้) | `ADMIN_API_REQUEST` ที่ token **ผ่าน** ซึ่งเขียน**ตอนเกินเพดานขนาด**เท่านั้น — ใต้เพดานไม่หัก | 5% (นอกเพดาน) | 400 วัน | ราว 650 KB |

- **กลไก**: ถังต่อชนิดต่อ backend process เติมต่อเนื่องวันละ `LOG_STORE_MAX_MB × ส่วน ÷ อายุ` จุได้หนึ่งวัน เริ่มเต็ม — ของชนิดนั้นที่ค้างในคลังจึงไม่เกิน `LOG_STORE_MAX_MB ×
  ส่วน` บวกหนึ่งวันต่อการเริ่ม process ใหม่หนึ่งครั้ง · ราคาของเอกสาร = ขนาด BSON + 64 ไบต์ต่อรายการ index (`error_events` ห้ารายการ · `activity` สิบสองตัวที่สามตัวเป็น
  array) · **ตัวเดี่ยวและตัวเต็มหยุดเมื่อเหลือ 25% ของถัง** ส่วนนั้นเก็บไว้ให้ใบสรุป (นับทุกการเรียกในใบเดียว) และตัวย่อของรหัสอ้างอิง (ตัวที่ผู้ใช้อ่านให้เจ้าหน้าที่ฟัง)
  ใช้ได้ถึงก้นถัง · คิวเต็มคืนงบที่หักไป
- **ต่อ process**: backend หลาย replica ได้คนละถัง — สาม replica บน Azure × 25% = 75% ของเพดาน ยังไม่ถึงเพดานเอง
- **ราคาที่จ่าย**: คนที่ยิงขยะไม่หยุดในอัตราเท่ากับการเติม (production ราว 18 KB ต่อนาทีของรายงานเบราว์เซอร์ — ตัวเต็มขนาดใหญ่สุดราวหนึ่งตัวต่อนาที · ราว 2 KB ต่อนาทีของ
  error ในคำขอที่ไม่มีตัวตน) ทำให้ของจริงในช่องเดียวกันไม่ถูกเก็บเป็นเอกสาร: รายงานจริงจากเบราว์เซอร์รวมรหัสอ้างอิง · error ที่ผู้ใช้ที่ยังไม่ได้เข้าสู่ระบบเจอ (หน้า login
  activate callback ของ ThaID) และรหัสของมัน — issue ยังนับครบ issue ระดับ error ยังแจ้งเป็นใบใหม่ได้ แต่การแจ้ง “5xx ต่อเนื่อง” ของ route ที่มีแต่คำขอไม่มีตัวตนเงียบระหว่างนั้น ·
  แลกกันโดยตั้งใจ: ช่องที่ใครก็ส่งได้เป็นตัวที่เสียเอง ไม่ใช่ error ของ server ทั้งหมดกับร่องรอยของ admin token
- **“ไม่มีตัวตน” ตัดสินตอน capture**: route ที่ไม่อ่าน session (`/api/auth/*`) นับเป็นไม่มีตัวตนแม้มี cookie และความล้มเหลวใน `requireAuth` เองก็เช่นกัน · ตัวย่อของรหัสอ้างอิง
  ของคำขอไม่มีตัวตนได้ไม่เกิน 60 ใน 120 ต่อนาที อีกครึ่งเป็นของผู้ใช้ที่เข้าสู่ระบบแล้วเสมอ
- **ไม่อยู่ในงบนี้** (มีเพดานความถี่ของตัวเองแต่ยังกินที่สะสม): issue ใหม่ที่รายงานเบราว์เซอร์สร้าง (≤ 100 ต่อชั่วโมงต่อ process ราว 50 MB ที่เพดาน) · แถว `ADMIN_TOKEN_REJECTED`
  / `LOG_TOKEN_REJECTED` ที่ relay คัดลอก · สำเนา `audit_fallback` (เกิดได้เฉพาะตอนที่ Postgres ไม่รับแถวอยู่แล้ว) · แถว `audit_event` ของคำขอที่ไม่ต้องล็อกอิน (3.8)
- S1: `logStore.untrustedBudget.{browser, anonymous-admin, anonymous-request}` และ `logStore.adminTokenOverQuotaAllowance` = `{dailyBytes, availableBytes, refused,
  refusedBytes}` — `refused` ที่ขึ้นเรื่อย ๆ = มีคนยิงขยะอยู่ หรืองบน้อยไป (ใบสรุปที่รองบนับซ้ำทุกครั้งที่ลองใหม่) · `logStore.browserOverBudget` · `adminAccess.overBudget`

### 5.14 อีเมลสรุป error (ขั้น 10, `workers/error-alerts.ts`)

ลูปของตัวเองใน delivery-worker ทุก 60 วินาที (รอบแรก 30 วินาทีหลังบูต) แยกจาก `tick()` ของ outbox · **ปิดอยู่จนกว่าจะตั้ง `ERROR_ALERT_EMAILS`** (worker เท่านั้น
คั่นด้วย comma) และไม่ทำอะไรขณะปิด log store · อีเมลนี้ไม่ผ่าน outbox เพราะผู้รับไม่ใช่บัญชีในระบบ (`notification_delivery.recipient_user_id` เป็น NOT NULL)

**อะไรทำให้แจ้ง** (รอบทุกนาทีอ่านแค่สถานะของการแจ้งเตือนกับธงเกินเพดาน — issue (`collect()`) และ `runtime_events` (`crashLoopsOf()`) อ่านเฉพาะรอบที่ถึงเวลาฉบับใหม่
คือครบ 15 นาทีจาก `lastDigestAt`):

1. issue ใหม่ระดับ error ขึ้นไปที่ยังไม่เคยแจ้ง (`new`)
2. issue ที่ปิดแล้วเกิดซ้ำหลังการแจ้งครั้งล่าสุด (`regressed`) ข้ามช่วงพักหกชั่วโมง — **เฉพาะ issue ที่ข้ออื่นจะแจ้งอยู่แล้ว** (ระดับ error ขึ้นไป หรือ 5xx ต่อเนื่องตามข้อ 4)
3. fatal ที่เกิดอีกหลังแจ้งไปแล้ว (`fatal`) · อีเมลที่ส่งไม่สำเร็จครบทุกครั้ง `delivery:dead-letter:*` (`dead_letter`)
4. 5xx ที่ route ตอบเองต่อเนื่อง — issue `http:5xx:…` ที่มี event ตั้งแต่ 5 ตัวใน 15 นาที (`sustained_5xx` — 503 `no_reviewer` `no_legal_documents` 501 ThaID ที่ไม่ได้ตั้งค่า)
5. **วนรีสตาร์ต** — ในชั่วโมงที่ผ่านมา service หนึ่งมี `fatal-exit` ตั้งแต่ 2 ครั้ง หรือ `start` ที่บันทึกก่อนหน้าของ **container เดียวกัน** (service + `host.containerId`)
   ไม่ใช่ `shutdown` และไม่มีป้าย `cleanExit` ตั้งแต่ 3 ครั้ง — restart ปกติ หยุดแล้วเปิดทีหลังนานเท่าไรก็ตาม และ container ใหม่ตอน deploy (ยังไม่มีบันทึกของตัวเอง) ไม่นับ ·
   ย้อนหาบันทึกก่อนหน้าได้ไกลเท่าอายุของ `runtime_events` (90 วัน) ในชั่วโมงอ่านใหม่ไปเก่าไม่เกิน 2,000 ตัว · ข้อจำกัด: crash ที่ระบบเริ่มใหม่เป็น container ใหม่นับได้แค่ทาง
   `fatal-exit` · SIGTERM ที่มาระหว่าง fatal กำลังออกไม่ทิ้งทั้งป้ายและบันทึก `shutdown` การเริ่มถัดไปจึงนับเป็นการเริ่มที่ไม่มีคำอธิบายด้วย (5.5)
6. log store เกินเพดานขนาด (`relay_state.overQuota`) — ครั้งเดียวต่อครั้งที่เกิน

warning อื่นไม่แจ้ง · issue ที่ `ignored` ไม่แจ้ง · **ไม่แจ้งด้วยข้อไหนทั้งสิ้น**: `browser:chunk-load` และ `http:5xx:…:log_access_disabled` (คนลองเรียก API อ่าน log ที่ปิดไว้)
· issue ที่เห็นล่าสุดก่อนเปิดการแจ้งเตือน (`enabledAt`) ไม่ถูกแจ้งย้อนหลัง

**อัตรา**: สรุปฉบับใหม่ไม่เกินหนึ่งฉบับต่อ 15 นาที (นับจาก `lastDigestAt`) ฉบับละไม่เกิน 20 issue (ลำดับ: fatal → regressed → dead letter → new → 5xx ต่อเนื่อง ที่เกินรอฉบับหน้า) ·
issue หนึ่งแจ้งไม่เกินครั้งละหกชั่วโมงเว้นแต่เกิดซ้ำหลังปิด · วนรีสตาร์ตของ service เดียวกันหกชั่วโมง · **issue ของเบราว์เซอร์** (ใครก็สร้างได้) ไม่เกิน 5 ต่อหกชั่วโมงรวมทุกฉบับ
อ่านแยกจาก issue ของ server (พายุของเบราว์เซอร์จึงไม่เบียด error ของ server) และ**ลงอีเมลโดยไม่มีข้อความของมัน** — เหลือชื่อ error กับหน้าเฉพาะที่อยู่ในรูปที่รู้จัก จำนวน เวลา
และ fingerprint ให้เปิดดูที่ E2 · **[ต้องตัดสิน]** BDI ต้องการให้ error ของเบราว์เซอร์แจ้งเตือนเลยหรือไม่ (แผน Q9 ตั้งต้นให้เก็บ ไม่ได้ระบุเรื่องแจ้ง)

**การส่ง**: ทีละผู้รับ ทีละฉบับ ไม่มีสองการเชื่อมต่อซ้อนกัน (Office 365 รับได้ราวสามการเชื่อมต่อ) ผ่าน `sendRaw(…, {timeoutMs: 30_000})` — เส้นตายจริงต่อฉบับ (`sendWithDeadline()`
ใน `lib/mail.ts` ทำลาย socket เอง) · ฉบับที่เกิน 30 วินาทีจบแค่ผู้รับคนนั้น คนถัดไปได้ส่งต่อ · ทั้งรอบไม่เริ่มฉบับใหม่หลัง 90 วินาที (`ROUND_BUDGET_MS`) · ลำดับในรอบ: ผู้รับที่ไม่ค้าง
อะไร → ผู้ที่ค้างฉบับเก่า → ผู้ที่ช้าในรอบก่อน (อยู่ท้าย) · **ผู้รับหนึ่งคนได้ไม่เกินหนึ่งอีเมลต่อรอบ**: ฉบับใหม่ต่อท้ายด้วยฉบับที่เขายังค้าง (เก่าไปใหม่ แต่ละฉบับประทับเวลา) หรือถ้าไม่มีฉบับใหม่
ส่งฉบับที่ค้างลำพังโดยหัวเรื่องบอก “ส่งช้า” ไม่ถี่กว่า 15 นาทีต่อผู้รับ (นับจาก `triedAt` ของเขา — จังหวะคนละตัวกับ `lastDigestAt` ฉบับที่ค้างจึงไม่กั้นฉบับใหม่ และผู้รับหนึ่งคนได้ไม่เกิน
สองอีเมลในช่วง 15 นาทีใด ๆ) · ฉบับที่ค้าง (`pending`) เก็บไม่เกิน 3 ฉบับ ฉบับละไม่เกินหกชั่วโมง เนื้อความไม่เกิน 32 KB · **5xx ที่ตอบ `RCPT TO` หรือ `DATA` เป็นการปฏิเสธถาวร**
ไม่ลองซ้ำ ฉบับที่เขาค้างถูกทิ้งพร้อมบรรทัดเตือน · ความล้มอื่นทุกชนิดลองใหม่ รวม 5xx ตอน login (530/535 — รหัสผ่านของบัญชีส่งเปลี่ยน) หรือ `MAIL FROM` ซึ่งเป็นของฝั่งเรา ·
issue ในฉบับใหม่นับว่าแจ้งแล้ว (`$set alertedAt` `$inc alertCount` ใน `error_issues`) เมื่อฉบับนั้นถึงผู้รับอย่างน้อยหนึ่งคน ถึงไม่ได้สักคน ไม่มีอะไรถูกเก็บ ฉบับหน้าประกอบใหม่ทั้งชุด

**สถานะ** อยู่ใน `relay_state` `_id:"error_alerts"` — worker เริ่มใหม่ก็ไม่ส่งซ้ำ: `enabled` `recipients` `checkedAt` (คำของ worker เองว่าเปิดอยู่ไหม เขียนทุกนาทีและก่อนทุกฉบับ
ระหว่างรอบ) · `enabledAt` · `lastDigestAt` · `lastDigest` · `crashLoopAlertedAt` · `overQuotaAlertedAt` · `lastError` (ประกอบใหม่ทุกรอบจาก `lastRound` และสิ่งที่ยังค้าง: ฉบับที่ถึงใคร
ไม่ได้เลย ผู้รับที่ค้าง N ฉบับ ผู้รับที่ช้า ผู้รับที่ไม่ได้ลองเพราะงบหมด) · `lastRound {unreached, rejected, skipped}` · `pending` · `slow` · `triedAt` — **ผู้รับถูกเก็บเป็น HMAC
ของที่อยู่** (กุญแจ `LOG_HASH_KEY` นำหน้าด้วย `error-alert-recipient\0` จึงไม่ตรงกับ `email#` ของ `activity` จับคู่กันไม่ได้) ไม่ใช่ตัวที่อยู่ ไม่ตั้งกุญแจใช้กุญแจสุ่มต่อ process
และฉบับที่ค้างหายเมื่อ worker เริ่มใหม่ · หมุน `LOG_HASH_KEY` ทิ้งฉบับที่ค้างหนึ่งครั้งพร้อมคำเตือน · ปิดการแจ้งเตือน (worker เริ่มด้วย `ERROR_ALERT_EMAILS` ว่าง) ล้าง `enabledAt`
`lastError` `lastRound` แต่เก็บ `pending` ไว้ — เปิดกลับมาภายในหกชั่วโมงยังส่งฉบับที่ค้าง · S1 แสดง `alerts` (3.11) — `enabled: true` ที่ `checkedAt` เก่ากว่าสามนาที = loop
ไม่ได้วิ่ง

**เนื้อหาไม่มีข้อมูลบุคคล**: หัวเรื่องของ issue ของ server (ข้อความที่กวาดแล้วตัด id กับตัวเลข) service ที่เกิด (แม่แบบของ route) จำนวน เวลา รุ่น id ของ event และ fingerprint —
ไม่มีผู้ใช้ IP หรืออีเมล · **dry-run** (ไม่ได้ตั้ง `SMTP_USER`) พิมพ์ทั้งฉบับลง `docker compose logs delivery-worker`

---

## 6. สิ่งที่ตั้งใจไม่บันทึก และแถวแปลกที่คนอ่านต้องรู้

### 6.1 ตั้งใจไม่บันทึก

| อะไร | ทำไม |
|---|---|
| การเรียก HTTP ทั่วไป · การอ่านที่ไม่ใช่ admin · poller (`/state`, `/api/auth/me`, `/api/notifications`) · ไม่มี `REQUEST_VIEWED` | การ์ดหมายถึงการเปลี่ยนสถานะ ไม่ใช่ access log · การเรียกทุกครั้งของ `/api/admin*` ถูกบันทึกเป็น `ADMIN_API_REQUEST` ใน Mongo (4.11) เพราะการอ่านของ admin ได้ เลขบัตรเต็ม และทุกการอ่าน log เป็น `AUDIT_LOG_READ` (4.12) · **ข้อยกเว้นที่มีอยู่แล้ววันนี้**: การอ่านไฟล์เขียน `DOCUMENT_DOWNLOADED` (GET หกเส้นทางที่ต้องล็อกอิน 4.8) · `GET /api/auth/invitation` เขียน `ACTIVATION_KEY_EXPIRED` ได้ · และ 401 ของ `requireAuth` **เขียนแถวได้** เมื่อ cookie ที่ยื่นมาหมดอายุ (`SESSION_REVOKED` `EXPIRED` ผ่าน `resolveSession()` `middleware/auth.ts:64`) หรือบัญชีไม่ `ACTIVE` แล้ว (`ACCOUNT_SUSPENDED` `:92-96`) — poller ที่ถือ cookie เก่าจึงสร้างแถวเหล่านี้ (แผน §13 ข้อ 26) |
| การพิมพ์ทีละตัว การเปิดหน้า autosave | ไม่มี autosave บันทึกเฉพาะการกดบันทึกที่เปลี่ยนค่าจริง |
| `POST /api/notifications/:id/read` · `/read-all` | งานเก็บบ้านของ UI เป็นเสียงรบกวน |
| `POST /api/admin/dataset-choices/refresh` | แตะแค่แคชในหน่วยความจำ |
| สคริปต์ `seed-masters` · `backfill-display-name` | รันด้วยมือและนาน ๆ ครั้ง เลื่อนไว้ก่อน |
| การกดบันทึกร่างที่ไม่มีอะไรเปลี่ยน (`REQUEST_DRAFT_SAVED`) · `LEGAL_DOCUMENT_UPDATED` / `USER_ACCOUNT_UPDATED` แบบโปรไฟล์ที่ไม่เปลี่ยน · `REQUEST_ASSIGNED` คนเดิม | สิ่งที่ต้องตอบคือ “ใครแก้อะไร” ไม่ใช่ “ใครกดปุ่ม” · ข้อยกเว้น: ร่างหน่วยงานที่ snapshot ถูกซิงก์จากบัญชีหรือถูก route แปลงรูปยังได้แถว `fields_changed: []` + `synced_from_account` / `normalised_by_route` แม้ผู้กรอกไม่ได้พิมพ์อะไร (4.7) · ส่วนการแก้**ทะเบียนหน่วยงาน** (`ORGANIZATION_UPDATED`) `REQUEST_UPDATED` และ `DATASET_CHOICE_CHANGED` ของ admin **เขียนเสมอ**แม้ไม่มีอะไรเปลี่ยน — ไม่มีทางแก้ทะเบียนไหนที่ข้ามการบันทึกที่ไม่เปลี่ยน |
| ตัวรหัส OTP · hash ของมัน · ค่า token · รหัสผ่าน · `error_description` ของ ThaID | ความลับหรือข้อความที่คุมไม่ได้ เก็บแค่ id, fingerprint หรือรหัส (`error_description` ยังลง `integration_operation.last_error_message` นอก audit หลังผ่าน `scrubText()` — 5.6) |
| คำสั่งเปลี่ยนข้อมูลที่ถูกปฏิเสธด้วย 4xx บนเส้นทางธุรกิจ (เช่น 409 `role_occupied` `invitation_pending` · 400 `validation` · 404 ของสิทธิ์ · 403 `no_organization` ของ `POST /api/organizations` รวมผู้ประสานงานที่ถูกแทนที่ซึ่งพยายามเปิดหน่วยงานเอง — `7259c09`) | ไม่มีที่บันทึก — ข้อเสนอ `REQUEST_REFUSED` เป็นงานถัดไป (แผน §13 ข้อ 29) · ความล้มเหลวของการยืนยันตัวตน**ถูกบันทึก**แม้ตอบ 4xx: `LOGIN_FAILED` (401/403/400/429) · `PASSWORD_RESET_COMPLETED` `FAILURE` (410/409) · `IDENTITY_VERIFICATION_FAILED` (400/403/409/410/502) · `ADMIN_TOKEN_REJECTED` (401) — ยกเว้น 400 `validation` ของ body ที่ผิดรูป (4.1) |
| แถวใหม่ของ review task · การเปิดด่าน · การยกเลิกด่านด้วย `cancelActiveTask()` · แถว `legal_acceptance` · การ render ซ้ำหลังลงนาม · การ render ตอน GET | ถูกบันทึกผ่านแถวของเหตุการณ์ต้นเรื่องเท่านั้น (ผลการตรวจ `DOCUMENT_SIGNED` `REQUEST_FORM_GENERATED`) |
| โทเคนตั้งรหัสผ่านเก่าที่ถูกเพิกถอนตอนออกใบใหม่ · การเขียน `external_subject` ครั้งแรก · โปรไฟล์ที่เขียนตอน `/activate` | ช่องว่างที่รู้แล้ว ไม่ใช่การตัดสินใจ |
| การเข้าถึงฐานข้อมูลด้วย `docker exec` / `psql` / `mongosh` บนเครื่อง (รวมงานใน mongosh ของ 5.11) | อยู่นอกแอป ไม่มีร่องรอย (ความเสี่ยงที่ BDI ต้องยอมรับ แผน Q13) |
| ข้อบกพร่องของ QA A4 (แถว `ROLE_REVOKED` ซ้ำและในธุรกรรม · ผู้ถูกกระทำเป็น actor) | **ปล่อยไว้ตามเดิมโดยตั้งใจ** เป็นงานของการ์ด QA A4 สำเนา Mongo คัดลอกตามจริง — วิธีอ่านอยู่ 6.2 |

### 6.2 แถวแปลกที่มีอยู่จริง

**แถวที่เขียนระหว่าง transaction ยังเปิด (ในธุรกรรม)** — `revokeRoleAssignments()` (`iam.ts:380`) และ `revokeSessionsFor(tx, …)`
(`session.ts:182`) รับ `tx` มาใช้แก้ข้อมูล แต่ `logAudit` เขียนด้วย prisma ตัวหลัก แถว audit จึง commit ทันทีบนอีก connection:

- `occurred_at` มาก่อนการ commit ของธุรกรรมจริง
- ถ้าธุรกรรมถูก rollback ภายหลัง แถว `ROLE_REVOKED` / `SESSION_REVOKED` **ยังอยู่** ทั้งที่การเพิกถอนไม่เคยเกิด — ตรวจได้โดยดูว่า
  แถวต้นเรื่องของ correlation id เดียวกัน (`USER_ACCOUNT_DEACTIVATED` `ROLE_ASSIGNED` `REQUEST_RESET_TO_DRAFT`
  `PASSWORD_RESET_COMPLETED` ฯลฯ) มีหรือไม่ ไม่มี = น่าสงสัยว่าเป็นแถวผี
- snapshot `actor_*` อ่านสถานะที่ commit แล้ว จึงเห็น role และหน่วยงาน**ก่อน**เปลี่ยน (แถวของการย้ายหน่วยงานแสดงหน่วยงานเก่า)
- relay คัดลอกแถวเหล่านี้ตามจริง รวมแถวผี (3.8)

จุดที่เป็นแบบนี้: `admin-registrations.ts:465` `:475` · `admin-users.ts:622` `:747` `:844` `:855` `:1408` `:1422` · `auth.ts:942` ·
และทุกทางที่ `assignRole(tx)` ไปแทนที่ผู้ถือที่นั่ง (4.4) คอมเมนต์ของ `revokeRoleAssignments()` (`iam.ts:329-331`) ที่ว่าไม่เขียน audit
ในธุรกรรมขัดกับโค้ดของมันเอง และคอมเมนต์เหนือ `removedFromOrganization()` (`routes/auth.ts:1275`) ที่ว่า `revokeRoleAssignments()`
“ยังไม่เขียน audit_event” ก็ล้าสมัยเหมือนกัน (แผน §13 ข้อ 12)

**`ROLE_REVOKED` สองแถวต่อการแทนที่หนึ่งครั้ง** — บน `/api/auth/activate`, `POST /api/organizations` และการตรวจคำขอหน่วยงาน การแทนที่ผู้ถือ
ที่นั่งได้ทั้งรูปแบบ A (ในธุรกรรม `reason` ไทย `before.roleId`) และรูปแบบ B (หลัง commit `reason: REPLACED_BY_NEW_HOLDER`
`role_code` `revoked_user_account_id`) บน subject เดียวกัน correlation id เดียวกัน actor ของสองแถวขึ้นกับเส้นทาง:

| เส้นทาง | actor ของ A | actor ของ B |
|---|---|---|
| `POST /api/auth/activate` | `USER` = บัญชีที่กำลังเปิด (`iam.ts:697-702`) | `SYSTEM` + null (ไม่มี actor ใน context — `notify.ts:194`) |
| `POST /api/organizations` (**ถอดแล้วที่ `7259c09`** — แถวเก่าเท่านั้น) | `USER` = ผู้สร้างหน่วยงาน (`session.sub`, `organizations.ts:1133-1138` ของ `2cab0a7`) | `USER` = คนเดียวกัน (จาก context ของ session `:1146` ของ `2cab0a7`) |
| `POST /api/organizations/:id/review` | `USER` = `SYSTEM_USER_ID` (`:3143-3148`) snapshot เป็นอีเมลของบัญชีระบบ | `USER` = ผู้ประสานงาน BDI ที่กดตรวจ (`:2827`) |

นับการเพิกถอนด้วย `DISTINCT subject_id` ต่อ correlation id อย่านับแถว ส่วน `POST /api/admin/users/:id/roles` และ `/transfer` ได้แค่รูปแบบ A
และผู้ถูกแทนไม่ได้รับแจ้ง

**`SESSION_REVOKED` ที่ผู้ถูกกระทำเป็น actor** — `revokeSessionsFor()` ส่ง `actorId` = บัญชีเป้าหมายเสมอ แถวของคำสั่ง admin
(ระงับ · ยุติ · แก้อีเมล/เลขบัตร · ย้าย · บังคับออก · reset คำขอ) จึงอ่านเหมือนเจ้าตัวเพิกถอน session ของตัวเอง ทั้งที่แถวเดียวกันมี
`admin_token_fp` และ `source_component admin-portal` และ IP/UA เป็นของ admin — ให้เชื่อ `admin_token_fp` ก่อน `actor_type` (สำเนา
Mongo ทำแบบนั้นใน 3.4) `PASSWORD_CHANGED` ก็ลงเจ้าของบัญชีเป็น actor ทั้งที่ผู้ยิงถือแค่ลิงก์ · `DELETE /api/admin/users/:id/sessions`
ได้ `SESSION_REVOKED` **สองแถว** (helper = actor เป้าหมาย มี `session_count` · route = SYSTEM มี `admin_reason` แม้ปิดได้ 0 ใบ)

**การเข้ารหัส actor ของ “ระบบ” ไม่สม่ำเสมอ** — `/api/admin/*` = `SYSTEM` + null · `revokeRoleAssignments()` (`ROLE_REVOKED` รูปแบบ A
— helper เดียวใน `lib/iam.ts` ที่รับ `actorId`) เมื่อผู้เรียกส่ง `SYSTEM_USER_ID` (admin deactivate/transfer/roles, registration reset และ
review) = `USER` + `00000000-0000-0000-0000-000000000001` (snapshot เป็นอีเมลของบัญชีระบบ) · helper อื่นใน `lib/iam.ts`
(`logKeysRevoked()` → `ACTIVATION_KEY_REVOKED`, `evaluateActivationKey()` → `ACTIVATION_KEY_EXPIRED`) ไม่ส่ง actor จึงได้ตาม context:
`SYSTEM` + null บนเส้นทาง admin และสาธารณะ `USER` บนเส้นทาง session (`iam.ts:380-390` `:467-481` `:586-597`) · เส้นทางสาธารณะที่ไม่มี
actor = `SYSTEM` + null

**ใครทำจริง — วิธีสืบตามรูปของ actor**

| รูปของแถว | ผู้กระทำที่เป็นไปได้ | หลักฐานที่มี |
|---|---|---|
| `USER` + snapshot บน `web-portal` ไม่มี `admin_token_fp` | ผู้ถือ session ของบัญชีนั้น (หรือ helper ที่ลงชื่อเขาแทน — `SESSION_REVOKED` ของ `revokeSessionsFor()`, `PASSWORD_CHANGED`) | `actor_id` · IP/UA ที่อ้างมา · `iam.session` ของบัญชีนั้น (2.10) |
| มี `admin_token_fp` (actor เป็น `SYSTEM` + null **หรือ** `USER` = บัญชีเป้าหมาย / `SYSTEM_USER_ID` ของ helper) | ใครก็ได้ที่ถือ admin token ใบนั้น — **ตัวคนรู้ไม่ได้จากแถว** | `admin_token_fp` บอกว่า token ใบไหน · IP/UA ที่อ้างมา (ปลอมได้) · `reason` ที่ admin พิมพ์ · แถวอื่นของ correlation id เดียวกัน (แถวของ helper มี actor เป็นบัญชีเป้าหมายหรือ `SYSTEM_USER_ID` อย่าอ่านว่าเป็นผู้สั่ง) · ต้องจับกับบันทึกนอกระบบว่าใครถือ token ตอนนั้น |
| `SYSTEM` + null บน `web-portal` ไม่มี fingerprint | helper บนเส้นทางสาธารณะ (คนที่เปิดลิงก์ ออกจากระบบ หรือเปิดบัญชี — 2.2) **หรือ**แถว admin token ก่อนการ์ด | `action` บอกว่าเป็นแบบไหน · IP/UA · แถวที่ route เขียนใน correlation id เดียวกัน |
| `ANONYMOUS` | ผู้ที่ยังไม่พิสูจน์ตัวตน | `metadata.email` ที่พิมพ์ · `thaid_subject` · IP/UA · `subject_id` คือบัญชีที่ถูก**ลอง** ไม่ใช่ผู้ลอง |
| `SYSTEM` + `request-service` ไม่มี IP | แถวเก่าของการอัปโหลดไฟล์ที่หลุด context (2.4) | ไม่มี — ต้องจับกับ `attachment.uploaded_by` ของไฟล์นั้น (subject ของแถว) |

**subject เปลี่ยนตามจุดเขียน** — `ROLE_ASSIGNED` เป็น URA หรือ UA · `SESSION_REVOKED` เป็น `SESSION` หรือ UA ·
`DOCUMENT_DOWNLOADED` ของไฟล์กลางชี้ไฟล์ที่ทุกหน่วยงานใช้ร่วม · `LEGAL_DOCUMENT_PUBLISHED` ชี้เวอร์ชันไม่ใช่เอกสาร

**`seed:demo` ล้างตาราง** — `prisma.auditEvent.deleteMany()` (`scripts/seed-demo.ts:214`) ทุกครั้งที่รัน รวม `seed:demo:prod` บน
production (แผน Q12) ประวัติก่อนหน้าหายจาก Postgres · `seed:demo` **ไม่แตะ Mongo** — `error_events` `error_issues` `runtime_events` และสำเนา
`audit_fallback` อยู่ข้าม seed · สำเนาจาก relay ยังเก็บแถวที่ถูกลบไว้ (rebuild ลบมันถาวร — 3.8) และ reconcile เห็น Mongo มากกว่าซึ่งเป็นเรื่องปกติ

**IP ที่ผู้เรียกกำหนดเอง** — บน dev checkout `ip_address` คือค่าสุดท้ายของ `X-Forwarded-For` ที่ผู้เรียกพิมพ์มา (ยิงผ่านหน้าเว็บก็ได้) บน
production ถูกต้องเท่าที่ Cloudflare ต่อท้ายให้ ซึ่ง**ยังไม่ได้ยืนยัน**กับ tunnel ของเรา และใครเข้าถึงพอร์ต 3000/4000 ตรงได้ก็ตั้งเองได้ ·
แถวทันทีและแถวสรุปของถังรวม `ADMIN_TOKEN_REJECTED` ไม่มี IP เลยโดยตั้งใจ

**correlation id ไม่ใช่หลักฐานว่าเป็นคลิกเดียว** — ผู้เรียกส่ง UUID ของตัวเองได้ (รวมใช้ซ้ำหรือชนกับคนอื่น) แถวสรุปได้ id ใหม่ที่ไม่ตรง
คำขอใด ThaID ข้ามคำขอ และปุ่มสร้างเอกสารเป็นสองคำขอ (PATCH บันทึกร่างก่อน แล้ว `generate-form` — 2.5 และ `REQUEST_DRAFT_SAVED` ใน 4.7)
กลับกัน การกระทำเดียวที่กินหลายคำขอก็มีหลาย id (ตาราง “แถวที่มาเป็นชุด” ใน 4.0)

**บัญชี PENDING ที่ถูกลบไม่เหลือ id** — `INVITATION_DELETED` `APPROVER_INVITATION_RECALLED` (`accountDeleted: true`) และ `ACTIVATION_KEY_ISSUED`
ขา resend ไม่มี id ของบัญชี ชีวิตของบัญชีที่จบด้วยการถูกลบจึงต่อกันได้ด้วยอีเมลหรือเลขบัตรเท่านั้น — ในสำเนาค้นได้ด้วย `email#` ของอีเมลบัญชี
(`x-log-person` ที่เป็นอีเมล หรือ `x-log-email` — 3.6) ส่วนเลขบัตรถูกปิด (3.2 · 4.5)

**แถวเก่าก่อนการ์ด** — บน production วันนี้ (และแถวที่เขียนก่อน deploy ของการ์ดนี้): `ORGANIZATION_CREATED` ทาง WEB_FORM มี subject เป็นคำขอ ·
`ORGANIZATION_UPDATED` ที่ subject เป็นคำขอคือการเปิดคำขอ · `LEGAL_DOCUMENT_PUBLISHED` ของ PATCH คือการแก้ข้อมูลเอกสาร ·
`ORGANIZATION_UPDATED` ของ admin เก็บแค่รหัสกับชื่อ · แถวของ admin ทุกแถวเป็น `web-portal` · `LOGIN_FAILED` `INVALID_CREDENTIAL`
เป็น `SYSTEM` · แถวอัปโหลดไฟล์ขนาดจริงเป็น `SYSTEM` + `request-service` + ไม่มี IP · มีหกแถว `admin-script` ที่ใส่ด้วยมือ · user agent ไม่ถูกปิดเลข

**แยกแถวก่อนและหลัง deploy ของการ์ดนี้** — Postgres ไม่มี `schemaVersion` ถ้าไม่รู้วันที่ deploy จะใช้รายการข้างบนไม่ได้
เมื่อ Deploy A ขึ้น production ให้จด commit และเวลา (UTC) ลงหัวข้อนี้และการ์ด แล้วใช้ `occurred_at` เป็นเส้นแบ่ง ระหว่างนี้
ใช้สัญญาณในแถวเอง: แถวหลัง deploy ตรวจได้จาก (1) รหัสที่เพิ่งมีในการ์ด — เจ็ดตัวที่ไม่มีใน `AuditAction` ของ `4eeb8d3`: `ADMIN_TOKEN_REJECTED`
`IDENTITY_VERIFICATION_STARTED` `LEGAL_DOCUMENT_UPDATED` `LOGIN_OTP_ISSUED` `REQUEST_ASSIGNED` `REQUEST_DRAFT_SAVED` `REQUEST_FORM_GENERATED`
(และ `LOG_TOKEN_REJECTED` `AUDIT_LOG_READ` `ERROR_ISSUE_STATUS_CHANGED` เมื่อ Deploy C) — แถวแรกของรหัสเหล่านี้บอกจุดเริ่มคร่าว ๆ (2) แถวของ
admin มี `admin_token_fp` และ `admin-portal` ส่วนแถวที่เป็นของเส้นทาง admin (`*_via: "ADMIN_API"`) แต่เป็น `web-portal` และไม่มี
fingerprint คือแถวก่อนการ์ด (3) `LOGIN_FAILED` ที่เป็น `SYSTEM` คือก่อนการ์ด (4) user agent ที่มีกลุ่มเลข 9 หลักขึ้นไปไม่ถูกแทนด้วย `:n`
คือก่อน `a0a0578`

---

## 7. ข้อมูลส่วนบุคคลและการปิดบัง

### 7.1 ข้อมูลส่วนบุคคลอยู่ตรงไหน

| ส่วน | Postgres `audit_event` | Mongo `activity` | Mongo `error_events` |
|---|---|---|---|
| ตัวตนของผู้กระทำ | `actor_id` + `actor_name` (ชื่อไทย หรืออีเมล) + role | `actor.*` เหมือนกัน (ชื่อผ่านกฎเลขบัตร) | `actor {id, roles, organizationId, sessionId}` ไม่มีชื่อ · รายงานจากเบราว์เซอร์ไม่มี actor |
| IP · user agent | IP ที่อ้างมา (2.6) · UA ปิดกลุ่มเลข ≥ 9 หลัก ตัดที่ 512 (แถวก่อน `a0a0578` เก็บ UA ดิบ) · `iam.session` เก็บ UA ดิบ | เหมือน Postgres (UA ผ่าน `storedUserAgent()` ซ้ำ) · category ธุรกิจและ `log-access` `$unset` ที่ 365 วัน · `auth` `session` `admin-access` ลบทั้งเอกสารที่ 400 วัน (การเรียก admin ที่ token ไม่ผ่าน 90 วัน) | IP ตามที่แยกได้ · UA กวาดแล้ว ≤ 512 · ของรายงานจากเบราว์เซอร์อยู่ใน `ingest.ip` `ingest.userAgent` · ลบทั้งเอกสารที่ 90 วัน (เบราว์เซอร์ 30) |
| เลขบัตรประชาชน | ปิดที่จุดเขียนใหม่ (7.2) · **เต็ม**ที่จุดเขียนเดิมและใน `thaid_subject` | คีย์ที่ชื่อตรงเหลือ 4 ตัวท้าย · เลขบัตรในข้อความทุกค่าเป็น `[cid]` · `cid#` ของทุกค่าที่สำเนาปิดเอง (ค่าที่ Postgres ปิดมาแล้วไม่ได้ `cid#`) — 3.6 | กวาดเป็น `[cid]` · `extra.audit` ปิดด้วยกฎตัวกว้างทุกค่า |
| อีเมล | อีเมลบัญชีในหลายแถว · อีเมลที่พิมพ์ตอนล็อกอิน (`LOGIN_FAILED`) ดิบ | อีเมลที่พิมพ์ปิด (`so***@…`) + `email#` · อีเมลบัญชีคงไว้ + `email#` | กวาดเป็น `[email]` · body เก็บแค่ `present` · `extra.audit` คงอีเมลบัญชีไว้เหมือน `activity` |
| ชื่อ เบอร์โทร ตำแหน่ง อีเมลบัญชี ที่อยู่ | ใน diff ของร่าง/`REQUEST_UPDATED`/`USER_ACCOUNT_UPDATED` · และนอก diff: `ACTIVATION_KEY_ISSUED.after.name`/`email` · `USER_ACCOUNT_CREATED.after.displayName`/`email` · `APPROVER_INVITATION_RECALLED.before.displayName`/`email` · `INVITATION_DELETED.before.email` · `USER_ACCOUNT_DEACTIVATED.before.email` · `USER_IDENTITY_RELEASED` `before`/`after.email` · `PASSWORD_RESET_REQUESTED.metadata.email` · เบอร์โทร อีเมล และที่อยู่ของหน่วยงานใน `ORGANIZATION_CREATED` `UPDATED` `ACTIVATED` — ไม่ปิดทั้งหมด | คงไว้ | ไม่เก็บ (body เป็น shape) ยกเว้นใน `extra.audit` ของ `audit.write-failed` ที่คงไว้เหมือน `activity` |
| ข้อความอิสระ | `reason` · `note` · `admin_reason` · `suspensionReason` · ชื่อไฟล์ · `path` และ user agent ของผู้ยิง · เหตุผลของการอ่าน log | เลขบัตรในทุกค่าที่เป็นข้อความเป็น `[cid]` (ชื่อไฟล์ใช้กฎแคบ — 3.6) อย่างอื่นคงไว้ | กวาดตาม 5.6 · ข้อความและ stack ของรายงานจากเบราว์เซอร์ผู้ส่งเขียนเอง (5.12) |
| ใครเปิดดูข้อมูลของใคร | `AUDIT_LOG_READ`: อีเมลของผู้อ่าน (ที่ประกาศ) เหตุผล และ id ของบัญชีที่ถูกอ่าน — เลขบัตรและอีเมลที่ค้นเป็น key HMAC (4.12) | สำเนาของแถวนั้น + `ADMIN_API_REQUEST`: id ของบัญชีที่ admin เปิดดู · key ของ `?cid=` / `?email=` · IP UA ของผู้เรียก (4.11) | — |

### 7.2 ปิดที่ไหน อย่างไร

**Postgres — ปิดที่จุดเขียน ไม่ใช่ใน `logAudit`:**

- `sanitizeDiff()` / `sanitizeState()` (`audit.ts:888`, `:902`) แทนค่าของคีย์ที่ชื่อตรง `CID_KEY = /cid$|nationalid|^pid$|^thaid_subject$/i`
  (ทุกระดับความลึกของ object ธรรมดาและ array) ด้วย `{masked: "x…" + 4 ตัวท้าย, changed: true}` — ตัดสินจาก**ชื่อคีย์** ไม่ใช่รูปของค่า
  ค่าที่ยาวไม่เกิน 4 ตัวถูกปิดทั้งหมด และ `changed: true` เป็นค่าคงที่ (มีทั้งสองฝั่งและในแถวสร้าง) — **ยกเว้นค่า null** ซึ่ง `maskCid()`
  คืนตามเดิม (`audit.ts:857-862`): ฝั่งที่เลขบัตรว่าง (กรอกครั้งแรก หรือล้างค่า) เป็น `null` ธรรมดา ไม่ใช่ object `{masked, changed}`
- ใช้ที่: `REQUEST_DRAFT_SAVED` ทั้งสองเส้นทาง · `REQUEST_ASSIGNED` · `ORGANIZATION_UPDATED` ·
  `ORGANIZATION_ACTIVATED` · `USER_ACCOUNT_UPDATED` ขา ThaID · `USER_ACCOUNT_CREATED` ทั้งสองจุด · `ACTIVATION_KEY_ISSUED` ของ review
- **`logAudit` และไม่มีขั้นกลางใด sanitize `metadata`** — คีย์เดียวที่ผ่าน `sanitizeDiff()` คือ `organization_master_changed` ของ
  `REQUEST_DRAFT_SAVED` ซึ่งจุดเรียกประกอบเอง (`organizations.ts:1447-1454` `:1474`) และจุดเขียนที่มีมาก่อนการ์ด**ยังเก็บเลขบัตรเต็ม**
  จนกว่า BDI จะตัดสิน (แผน Q4 · `CLAUDE.md`):

| จุด | ฟิลด์ |
|---|---|
| `ACTIVATION_KEY_ISSUED` ของ `POST /api/admin/invitations` (`admin.ts:867`) | `after.cid` |
| `INVITATION_DELETED` (`admin.ts:1219`) | `before.cid` |
| `USER_ACCOUNT_UPDATED` แบบอีเมล/เลขบัตร (`admin-users.ts:629`) | `before.cid` · `after.cid` |
| `USER_ACCOUNT_DEACTIVATED` (`admin-users.ts:871`) | `before.cid` |
| `APPROVER_INVITATION_RECALLED` (`admin-registrations.ts:553`, `organizations.ts:2814`) | `before.cid` |
| `REQUEST_UPDATED` (`admin-registrations.ts:293`, `:754`) | `approverCid` `userCid` ใน diff |
| `IDENTITY_VERIFIED` · `IDENTITY_VERIFICATION_FAILED` CID_MISMATCH · `LOGIN_FAILED` THAID_NO_MATCHING_ACCOUNT (`auth.ts:482` `:456` `:593`) | `metadata.thaid_subject` |

- ปิดอย่างอื่นกับทุกแถว: `storedUserAgent()` · `ADMIN_TOKEN_REJECTED` เก็บ `token_fp` ไม่ใช่ token และ `path` เป็นรูปแบบ ·
  `LOGIN_OTP_ISSUED` ไม่เก็บรหัส · `IDENTITY_VERIFICATION_FAILED` ไม่เก็บข้อความจาก ThaID
- **อีเมลไม่ถูกปิดเลย** ใน Postgres

**Mongo `activity` — ปิดก่อนออกจาก process** ทั้งสามแหล่ง (`projectAuditRow()` + `maskForLogStore()` — 3.6):
เลขบัตรทุกคีย์ที่ชื่อตรง (รวม `thaid_subject`) และเลข 13 หลักในข้อความ · อีเมลที่พิมพ์ของ `LOGIN_FAILED` · ค่าที่ Postgres ปิดมาแล้วผ่านไปตามเดิม ·
user agent ของแถวก่อน `a0a0578` ผ่าน `storedUserAgent()` ซ้ำ (3.3) · key ค้นหาแทนค่าจริง · Postgres ไม่ถูกแก้

**Mongo `error_events` — กวาดตอนเก็บ (5.6)** body เป็นรูปร่าง · ค่าของ query ไม่ออก · stack ประกอบใหม่ · `extra.audit` ปิดแบบ `activity`

### 7.3 retention

ตารางเต็มและกลไกของ prune อยู่ที่ 3.9 (`lib/log-retention.ts`) **[ต้องตัดสิน]** ตัวเลขทุกตัวเป็นค่าตั้งต้นรอ BDI ยืนยัน (แผน Q3):

| ข้อมูล | เก็บนาน |
|---|---|
| Postgres `audit_event` | **ไม่มี retention** (ไม่เปลี่ยนในการ์ดนี้) · `seed:demo` ล้างทั้งตาราง |
| `activity` — `account` `role` `invitation` `organization` `request` `review` `document` `config` `log-access` | ไม่ลบ · IP/UA ถูกตัดที่ 365 วัน |
| `activity` — `auth` `session` `admin-access` `system` `other` | 400 วัน (ปีเต็มของประวัติการเดารหัส และนานกว่า 90 วันของ พ.ร.บ.คอมพิวเตอร์ ม.26 ถ้าใช้บังคับ — 9.4) |
| `activity` — `ADMIN_API_REQUEST` ที่ token ไม่ผ่านหรือไม่ได้ตรวจ | 90 วัน |
| `error_events` · `runtime_events` | 90 วัน (รายงานจากเบราว์เซอร์ 30 วัน) |
| `error_issues` | ที่ปิดหรือละเว้น 365 วันหลัง `lastSeen` · ที่ยัง `open` ไม่ลบ ยกเว้นของเบราว์เซอร์ 30 วัน |
| บรรทัดใน log ของ container (`[capture]` `[log-relay]` `[frontend-error]` …) | prod overlay จำกัด backend frontend worker ที่ json-file 50 MB × 5 — และหายทุกครั้งที่ deploy `main/` สร้าง container ใหม่ |

เรื่องที่รอ BDI และ DPO (ปิดเลขบัตรในแถว Postgres เดิม — Q4 · อีเมลที่พิมพ์ใน Postgres — Q11 · ความเสี่ยงที่เหลือ — Q13 · ฐานทางกฎหมาย ประกาศความเป็นส่วนตัว
ข้อยกเว้นการลบ) รวมอยู่ในหมวด 9

---

## 8. เพิ่ม event ใหม่ต้องทำอะไร

1. **เลือกรหัส** ใช้ของเดิมเมื่อความหมาย**เท่ากันจริง** (ผู้สั่งและอำนาจเดียวกัน) ไม่งั้นเพิ่มใน `AuditAction` (`lib/audit.ts`) พร้อม
   **doc comment ภาษาไทย**: เกิดเมื่อไร ต่างจากรหัสใกล้เคียงอย่างไร before/after และ metadata มีอะไร subject ใหม่เพิ่มใน `AuditSubject`
   พร้อมคอมเมนต์ คอลัมน์เป็น VARCHAR ไม่ต้องมี migration
2. **เขียนหลัง commit** ด้วย `logAudit()` นอก callback ของ `$transaction` ของที่สร้างในธุรกรรม (บัญชี คีย์ role) ให้คืนออกมาเป็นผลของ
   ธุรกรรมแล้วค่อยบันทึก และเขียน**ก่อน**อีเมลที่ส่ง inline ซึ่ง throw ได้ อย่าย้าย `logAudit` เข้าไปใน `tx`
3. **actor** ปล่อยให้มาจาก context (`requireAuth`) ขาที่ยังไม่ล็อกอินส่ง `actorType: "ANONYMOUS"` เสมอ (ไม่งั้นได้ `SYSTEM`) — รวม helper
   ใน `lib/` ที่ถูกเรียกจากเส้นทางสาธารณะ ซึ่งวันนี้หลายตัวไม่ส่ง (2.2) ส่ง `actorId` เองเฉพาะเมื่อผู้กระทำคือบัญชีที่เพิ่งพิสูจน์ตัวตนได้ในคำขอนั้น
4. **diff** ใช้ `diffFields()` (+ `sentOnly()` เมื่อค่าที่เขียนมี `undefined` + `blankAsNull()` เมื่อร่างเก่าเก็บ `""`) แล้วผ่าน
   `sanitizeDiff()` เสมอ แถวสร้างใช้ `sanitizeState()` ไม่มีอะไรเปลี่ยน = ไม่เขียนแถว **ห้ามใส่เลขบัตรหรือ token ใน `metadata`** เพราะ
   ไม่มีขั้นไหน sanitize มัน
5. **รูปของแถว** `subject_id` / `organization_id` / `actor_id` ต้องเป็น uuid (ค่าอื่นทำให้แถวหาย) รหัสที่ไม่ใช่ uuid ไปไว้ใน `metadata` ·
   `organization_id` ต้องส่งเอง · คีย์ใน `metadata` เป็น snake_case มี `*_via` บอกช่องทาง `reason` เมื่อมีคนพิมพ์เหตุผล (อย่าใช้
   `reason` เก็บรหัส — ตาราง “ความหมายของ reason” ใน 4.0) และ `request_number` เมื่อเกี่ยวกับคำขอ (ที่เดียวที่เหลือถ้าแถวคำขอถูกลบ และค่าที่สำเนา
   ใช้เมื่อหาเลขที่จาก subject ไม่ได้ — 3.2) · ใส่ id ของ**คน**
   ที่ได้รับผลไว้เสมอ (`user_account_id` หรือ `before`/`after.userAccountId`) แม้บัญชีจะถูกลบในคำขอเดียวกัน · ห้ามตั้งชื่อคีย์
   `actor_name` `actor_roles` `actor_organization_id` เพราะทับ snapshot (2.3) · ห้ามใส่ `BigInt`
6. **ตาราง category** เพิ่มรหัสลง `CATEGORY_BY_ACTION` ใน `lib/activity-shape.ts` — typecheck ไม่ผ่านจนกว่าจะเพิ่ม และ category ตัดสิน retention (3.5, 3.9)
   ถ้ามีคีย์ใหม่ที่ถือเลขบัตร อีเมลที่พิมพ์มา หรือชื่อไฟล์ ให้ตรวจว่ากฎของสำเนาครอบ (`lib/redact.ts`): ชื่อคีย์ต้องตรง `CID_KEY` (ตรงกับ `CID_KEY` ใน `lib/audit.ts`) ·
   อีเมลใต้คีย์ที่ลงท้าย `email` ได้ `email#` เอง แต่อีเมลที่**พิมพ์มา**ถูกปิดเฉพาะ `LOGIN_FAILED.metadata.email` (`projectAuditRow`) คีย์ใหม่ต้องเพิ่มที่นั่น ·
   ชื่อไฟล์ต้องตรง `FILE_KEY` · id ของคนที่ได้รับผลต้องอยู่ในคีย์ที่ `relatedUserIdsOf()` อ่าน ไม่งั้น `x-log-person` ไม่เจอ · คีย์ใน `metadata` ที่ชื่อลงท้าย `cid`
   ถูกปิดทั้งค่าในสำเนา
7. **เอกสารนี้** เพิ่มหัวข้อในหมวด 4 ตามแบบเดียวกัน (เกิดเมื่อ · actor · subject · before/after · metadata · ข้อมูลส่วนบุคคล · โค้ด) และ
   แก้ตารางใน 3.5 และ 4.0 ถ้าเกี่ยว และรายการใน 2.10 ถ้าคนอยู่ในคีย์ใหม่
8. **`CLAUDE.md`** ถ้า event ใหม่ตั้งกติกาใหม่ (ลำดับการเขียน ข้อยกเว้นของการปิดข้อมูล ความหมายที่แยกจากรหัสอื่น) เพิ่มในหัวข้อ
   *Audit log, notifications and the outbox*
9. **ตรวจของจริง** เดินผ่าน UI หรือ API แล้วดูแถวใน `psql` (`select action, actor_type, subject_type, before_summary_json,
   after_summary_json, metadata_json from audit.audit_event order by occurred_at desc limit 5;`) · แล้วดูสำเนาด้วย G1 `action=<รหัสใหม่>` ว่า
   `category` `via` `relatedUserIds` ถูก และค่าที่ควรปิดถูกปิด
10. **error ของโค้ดใหม่** ห้ามส่ง error หรือ `message` ของมันให้ `console.*` — ใช้ `captureError(err, {tag})` (`lib/error-capture.ts`) ซึ่งพิมพ์บรรทัดที่
   กวาดแล้วเอง บรรทัดภาษาไทยข้าง ๆ บอกแค่ที่เกิดแล้วชี้ `— ดูบรรทัด [capture] ถัดไป` · `extra` ต้องกวาดมาเอง · breadcrumb ใหม่ห้ามมีอีเมล ชื่อ
   หรือค่าที่ผู้ใช้กรอก (5.2) · fingerprint ตายตัวใช้เมื่อ error ของที่เดียวกันแตก issue ตามข้อความ (5.4)

---

## 9. ชุดเอกสาร PDPA สำหรับ DPO ของ BDI

**ร่างจากทีมพัฒนาให้ DPO ของ BDI ตรวจและตัดสิน ไม่ใช่ความเห็นทางกฎหมาย** (แผน §7 และ Q13) — ทุกมาตราที่อ้างคือ พ.ร.บ.คุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562
(PDPA) เว้นแต่ระบุอื่น ข้อเท็จจริงทางเทคนิคในหมวดนี้มาจากโค้ดที่ `7cf9020` และอ้างหัวข้อที่อธิบายละเอียดไว้

### 9.1 รายการใน ROPA (ม.39) — “บันทึกกิจกรรมและความปลอดภัยของระบบ”

| ช่องของ ROPA | ร่าง |
|---|---|
| ผู้ควบคุมข้อมูล | สถาบันข้อมูลขนาดใหญ่ (องค์การมหาชน) — ผู้ให้บริการ ระบบกลางเพื่อการแบ่งปันข้อมูลดิจิทัล (D2) |
| วัตถุประสงค์ | (1) ตรวจสอบย้อนหลังว่าใครทำอะไรกับคำขอจดทะเบียนหน่วยงาน คำขอลงทะเบียนชุดข้อมูล บัญชีผู้ใช้ และเอกสารข้อตกลง เมื่อไร เปลี่ยนจากอะไรเป็นอะไร · (2) ความมั่นคงปลอดภัยของระบบ — การเข้าสู่ระบบและความพยายามที่ล้มเหลว การเดารหัสผ่านและ token การเข้าถึงข้อมูลผ่านช่องทางของผู้ดูแลระบบ และการอ่านบันทึกเอง · (3) แก้ไขข้อขัดข้องของระบบ (error ของ server และเบราว์เซอร์ ไล่ด้วยรหัสอ้างอิงที่ผู้ใช้แจ้ง) |
| ฐานทางกฎหมายที่เสนอ | **ม.24(4)** — การดำเนินภารกิจเพื่อประโยชน์สาธารณะของ BDI ในการให้บริการระบบกลาง ซึ่งต้องตรวจสอบย้อนหลังได้ · **ม.24(5)** — ประโยชน์โดยชอบด้วยกฎหมายในการรักษาความปลอดภัยของระบบและข้อมูลของผู้ใช้ (บันทึกการเข้าสู่ระบบที่ล้มเหลว การเรียก admin API) — **DPO ยืนยัน** และพิจารณาว่าข้อใดต้องทำการประเมินประโยชน์โดยชอบ (LIA) |
| เจ้าของข้อมูล | ผู้ใช้ทุกบทบาท (เจ้าหน้าที่ของหน่วยงาน ผู้มีอำนาจฯ เจ้าหน้าที่ของ BDI) · ผู้ถูกเชิญที่ยังไม่เปิดบัญชี · บุคคลที่ถูกระบุในแบบฟอร์ม (ผู้ประสานงาน ผู้มีอำนาจฯ ผู้ดูแลชุดข้อมูล) · ผู้ที่พยายามเข้าสู่ระบบ (อีเมลที่พิมพ์อาจไม่ใช่ของผู้ใช้คนใด) · ผู้อ่านบันทึก (อีเมลที่ประกาศ) · ผู้เข้าชมเว็บไซต์ที่เกิด error |
| ประเภทข้อมูล | ตัวตน (id ชื่อ role หน่วยงาน) · ติดต่อ (อีเมล เบอร์โทร) · เลขประจำตัวประชาชน (ปิดในสำเนา — เต็มในแถว Postgres บางชนิด 7.2) · เครือข่ายและอุปกรณ์ (IP user agent) · การกระทำ (รหัส เวลา ค่าก่อนและหลังการแก้ไข) · ข้อความที่พิมพ์ (เหตุผล บันทึก ความเห็น) · ข้อมูลทางเทคนิค (error หน้าเว็บที่เกิด) — ไม่มีข้อมูลอ่อนไหวตาม ม.26 โดยการออกแบบ แต่ข้อความที่ผู้ใช้พิมพ์ควบคุมไม่ได้ |
| ที่เก็บ | Postgres `audit.audit_event` (หมวด 2) · MongoDB `bdi_logs` ในเครื่องเดียวกัน (หมวด 3, 5) · log ของ container (หายทุกครั้งที่ deploy) · ไฟล์ backup ใน `/hdd1tb/bdi-project/backups/` |
| ระยะเวลาเก็บ | 7.3 — Postgres ไม่มีกำหนด · สำเนาใน Mongo ตามหมวด (ไม่ลบ ตัด IP/UA ที่ 365 วัน · 400 วัน · 90 วัน · 30 วัน) |
| ผู้เข้าถึง | นักพัฒนาและผู้ดูแลระบบที่ถือ `LOG_READ_TOKEN` (ทุกการอ่านถูกบันทึกพร้อมผู้อ่านที่ประกาศและเหตุผล — 4.12) · ผู้ถือ admin token เห็นข้อมูลบัญชีผ่าน admin API (ทุกการเรียกถูกบันทึก — 4.11) · ผู้มีสิทธิ์เข้าเครื่อง (docker) อ่านฐานข้อมูลได้โดยไม่ทิ้งร่องรอย (9.7) · ผู้รับอีเมลสรุป error ได้แค่ข้อมูลทางเทคนิค ไม่มีข้อมูลบุคคล (5.14) |
| การส่งออกนอกประเทศ | ไม่มีสำหรับ log store บนเครื่องนี้ (9.6) |
| มาตรการความปลอดภัย | ปิดเลขบัตรและอีเมลที่พิมพ์ในสำเนา ค้นด้วย HMAC แทนค่าจริง (3.6) · กวาดข้อความ error ไม่เก็บ body และค่าของ query (5.6) · token แยกสำหรับการอ่าน บังคับผู้อ่านและเหตุผล บันทึกทุกการอ่านก่อนส่งข้อมูล (3.11) · proxy ของเว็บไม่เปิด API อ่าน log · ผู้ใช้ Mongo ของ backend ลบหรือแก้บันทึกไม่ได้ (3.1) · Mongo ไม่เปิดพอร์ตออกนอกเครื่อง · prune ตามอายุ |

### 9.2 ข้อความในประกาศความเป็นส่วนตัว (privacy notice) — ร่างให้เพิ่ม

> **การบันทึกการใช้งานระบบ** สถาบันบันทึกการใช้งานระบบกลางเพื่อการแบ่งปันข้อมูลดิจิทัล ได้แก่ การเข้าสู่ระบบและความพยายามเข้าสู่ระบบ (รวมอีเมลที่กรอก)
> การดำเนินการต่อคำขอ ชุดข้อมูล เอกสาร และบัญชีผู้ใช้ พร้อมข้อมูลก่อนและหลังการแก้ไข วันและเวลา หมายเลข IP และข้อมูลของอุปกรณ์และเบราว์เซอร์ที่ใช้ (user agent)
> รวมถึงข้อผิดพลาดของระบบที่เกิดระหว่างการใช้งานและหน้าเว็บที่เกิด เพื่อการตรวจสอบย้อนหลัง การรักษาความมั่นคงปลอดภัยของระบบ และการแก้ไขข้อขัดข้อง
> เลขประจำตัวประชาชนในสำเนาบันทึกที่ใช้ค้นหาถูกปิดบัง บันทึกการดำเนินการและการเข้าสู่ระบบ รวมหมายเลข IP และข้อมูลอุปกรณ์ เก็บไว้ในฐานข้อมูลหลัก
> ตลอดอายุของระบบเพื่อเป็นหลักฐาน (สำเนาที่ใช้ค้นหาตัดหมายเลข IP และข้อมูลอุปกรณ์ออกเมื่อครบหนึ่งปี และลบบันทึกการเข้าสู่ระบบเมื่อครบ 400 วัน) บันทึกข้อผิดพลาด
> ของระบบเก็บไม่เกิน 90 วัน การเข้าถึงบันทึกจำกัดเฉพาะผู้ที่ได้รับอนุญาตและทุกการเข้าถึงถูกบันทึก ท่านขอสำเนาบันทึกที่เกี่ยวกับท่านได้ที่ [ช่องทางของ DPO]

ตัวเลขในร่างต้องตรงกับที่ BDI ยืนยันใน 7.3 · **ระยะ 365/400 วันเป็นของสำเนาใน Mongo เท่านั้น**: `audit.audit_event` ใน Postgres ซึ่งเป็นระเบียนหลักไม่มี retention และเก็บ
`ip_address` `user_agent` ทุกแถวการเข้าสู่ระบบ (รวม `LOGIN_FAILED` กับอีเมลที่พิมพ์มาดิบ) และ `SESSION_REVOKED` ไว้ตลอด (3.9 · 7.3 · 9.1) — ร่างจึงไม่สัญญาการลบที่ระบบ
ไม่ได้ทำ ถ้า BDI ต้องการประกาศว่าลบ IP หรือบันทึกการเข้าสู่ระบบ ต้องมีงาน retention ของ Postgres (และของ backup) ก่อน · ถ้าเปิดใช้บน Azure ต้องเพิ่มข้อความเรื่องที่เก็บ (9.6)

### 9.3 คำขอให้ลบ (ม.33) — ข้อยกเว้นที่ต้องเขียนไว้

- บันทึกนี้เป็นหลักฐานว่าใครทำอะไรกับคำขอ ข้อตกลง และสิทธิ์ของบัญชี — ทีมพัฒนาเข้าใจว่าการเก็บไว้เข้าข้อยกเว้นของ ม.33 ในส่วนที่เป็นการดำเนินภารกิจตาม ม.24(4) และ
  การก่อตั้งหรือใช้สิทธิเรียกร้องตามกฎหมาย **DPO ยืนยันข้อยกเว้นและถ้อยคำที่จะตอบเจ้าของข้อมูล**
- ข้อเท็จจริงทางเทคนิค: ไม่มี API ใดลบหรือแก้บันทึก (3.1) · ลบบัญชี (`DELETE /api/admin/invitations/:id` ของบัญชี PENDING) ไม่ลบแถว audit โดยตั้งใจ — แถว
  `INVITATION_DELETED` คือหลักฐานเดียวที่เหลือ · สำเนาใน Mongo ถูกลบตามอายุเท่านั้น
- ถ้า DPO ตัดสินให้ลบรายการใด **ยังไม่มีเครื่องมือ**: ต้องลบด้วยมือทั้ง Postgres (ไม่มี REVOKE หรือ trigger กัน — 2) สำเนาใน Mongo (`source` ทั้งสาม) และ backup
  และ rebuild สำเนาจะนำแถวที่ยังอยู่ใน Postgres กลับมา (3.8)

### 9.4 พ.ร.บ.ว่าด้วยการกระทำความผิดเกี่ยวกับคอมพิวเตอร์ ม.26 — คำถาม

ม.26 ให้ผู้ให้บริการเก็บข้อมูลจราจรทางคอมพิวเตอร์ไม่น้อยกว่า 90 วัน (ขยายได้ตามคำสั่ง) **คำถามถึง DPO / ฝ่ายกฎหมาย**: BDI ในฐานะผู้ให้บริการระบบนี้เข้านิยาม
“ผู้ให้บริการ” ตามกฎหมายนั้นและประกาศของกระทรวงฯ ที่เกี่ยวข้องหรือไม่ และต้องเก็บอะไร · สิ่งที่มีวันนี้: การเข้าสู่ระบบ session และการเข้าถึง admin API 400 วัน · การเรียก admin
ที่ token ไม่ผ่าน 90 วัน · error 90 วัน · **ข้อจำกัด**: IP ในทุกบันทึกเป็นค่าที่ผู้เรียกเขียนเองได้ เว้นแต่ Cloudflare ต่อท้ายที่อยู่จริงให้ ซึ่งยังไม่ได้ยืนยันกับ tunnel ของ
`main` (5.12 **[ต้องตัดสิน]**) — ถ้าต้องเก็บตามกฎหมายนี้ ข้อนี้ต้องปิดก่อน และบันทึกการเข้าถึงหน้าเว็บทั่วไปไม่ถูกเก็บเลย (6.1)

### 9.5 การขอเข้าถึงข้อมูลของเจ้าของข้อมูล (ม.30)

- ผู้ดูแลเรียก **G2** (`x-log-person` = อีเมลหรือ uuid ของบัญชี) หรือ `GET /timeline` ด้วย `x-log-person` — ได้ทุกแถวที่คนนั้นเป็นผู้กระทำ ผู้ถูกกระทำ หรือถูกระบุ
  (`relatedUserIds` และ `email#` ของอีเมลบัญชี — 3.2) รวมบันทึกว่าใครเคยอ่านประวัติของเขา**โดยระบุตัวเขา** — การอ่านผ่าน trace timeline ของคำขอหรือหน่วยงาน
  หรือเปิดเอกสารเดียวด้วย id ไม่ถูกผูกกับเขา (4.12) · เหตุผลที่ใส่ใน `x-log-reason` ควรอ้างเลขที่คำขอใช้สิทธิ การอ่าน
  ครั้งนั้นถูกบันทึกเอง
- ผลลัพธ์มีข้อมูลของ**คนอื่น**ปน (ชื่อเจ้าหน้าที่ที่ตรวจคำขอ IP ของผู้ดูแล อีเมลของผู้อ่านบันทึก ความเห็นภายในของ BDI) — **DPO ตัดสินว่าตัดอะไรออกก่อนส่งให้เจ้าของข้อมูล**
- ข้อจำกัด: แถวที่ `seed:demo` ลบจาก Postgres ไปแล้วอยู่ในสำเนาเท่านั้น · เลขบัตรในสำเนาถูกปิด (ค้นด้วยเลขบัตรได้ผ่าน `x-log-cid` เมื่อมี `LOG_HASH_KEY`) · error ของ
  เบราว์เซอร์ไม่ผูกกับคน (ไม่มีผู้กระทำ)

### 9.6 เก็บในระบบเอง ไม่มีการโอนไปต่างประเทศ (ม.28)

- error และสำเนาบันทึกเก็บใน MongoDB ที่รันในเครื่องเดียวกับ Postgres ของ production (`/hdd1tb`) ไม่ส่งไปบริการภายนอก — บริการแบบ SaaS เช่น Sentry จะเป็นการส่ง
  ข้อมูลส่วนบุคคลไปต่างประเทศที่ต้องเข้าเงื่อนไขของ ม.28 ซึ่งการเลือกเก็บเองหลีกเลี่ยงได้ (แผน §2)
- อีเมลสรุป error ผ่าน SMTP ของ Office 365 แต่ไม่มีข้อมูลบุคคล (5.14)
- **คำถามที่ยังเปิด**: (1) ทราฟฟิกของ production ผ่าน Cloudflare (tunnel) ซึ่ง IP และ header ของผู้ใช้ผ่านโครงข่ายนอกประเทศ · (2) แผนย้ายไป Azure Container Apps
  (docs/20) — region ที่เลือก (เช่น Southeast Asia ที่สิงคโปร์) ทำให้ทั้ง Postgres ไฟล์แนบ และ log store อยู่นอกประเทศ และบริการ MongoDB ที่จะเลือก (Q2) ก็เช่นกัน
  — DPO พิจารณาก่อนเปิดใช้

### 9.7 ความเสี่ยงที่เหลือ (ให้ BDI ยอมรับ — แผน Q13)

- ผู้ที่เข้าถึง docker บนเครื่องที่ใช้ร่วมกันนี้อ่าน Postgres และ MongoDB ของ production ได้โดยไม่ทิ้งร่องรอย — MongoDB Community ไม่มี audit log (6.1)
- Postgres ของ production เปิดที่ `0.0.0.0:5432` azurite ที่ `0.0.0.0:10000` และ backend ที่ `0.0.0.0:4000` (ตรวจด้วย `docker port`)
- ดิสก์และไฟล์ backup (`/hdd1tb/bdi-project/backups/*.sql`) ไม่ได้เข้ารหัส
- API อ่าน log เรียกได้จากอินเทอร์เน็ตผ่าน `bdi-api.thammasorn.org` ด้วย token ใบเดียว (ป้องกันด้วยผู้อ่านที่ประกาศ เหตุผล และการบันทึก แต่ผู้อ่านไม่ได้ถูกพิสูจน์ตัวตน) — การจำกัดทาง
  เครือข่ายคือ Q17
- IP ในบันทึกเป็นค่าที่ผู้เรียกเขียนเองได้ทุกที่ที่ไม่ผ่าน Cloudflare (2.6)
- ทุกการอ่าน log ถูกบันทึก แต่**ผูกกับเจ้าของประวัติเฉพาะการอ่านที่ระบุตัวเขา** — การอ่านผ่าน trace หรือ timeline ของคำขอหรือหน่วยงาน หรือเปิดเอกสารเดียวด้วย id
  ตอบคำถาม “ใครเคยอ่านประวัติของ X” ไม่ได้ ต้องไล่จาก `endpoint` กับ `filters` เอง (4.12)
- แถว Postgres ก่อนการ์ดและบางรหัสยังเก็บเลขบัตรเต็ม (Q4) และอีเมลที่พิมพ์ตอนล็อกอินดิบ (Q11) — ตารางนี้ไม่มี retention
- `seed:demo:prod` ล้างบันทึกใน Postgres ของ production ทุกครั้งที่รัน (Q12)
- ข้อความที่ผู้ใช้พิมพ์ (เหตุผล บันทึก ความเห็น) อาจมีข้อมูลบุคคลที่การปิดอัตโนมัติไม่รู้จัก
- ข้อเสนอของทีมพัฒนา: ยอมรับสำหรับช่วงทดสอบ (SIT) และย้าย production ออกจากเครื่องนี้ก่อนข้อมูลบุคคลจริงสะสม หรือปิดพอร์ตที่เปิด `0.0.0.0` เข้ารหัส backup และจำกัด
  การเข้าถึง docker (งาน infra แยก)

### 9.8 คำถามที่ DPO ต้องตอบ

1. ฐานทางกฎหมาย ม.24(4) / ม.24(5) ของแต่ละวัตถุประสงค์ใน 9.1
2. ตัวเลข retention ทุกตัวใน 7.3 (Q3) และการตัด IP/UA ที่ 365 วัน · ต้องมี retention ของ `audit_event` ใน Postgres ด้วยหรือไม่ (วันนี้ไม่มี — ตัดสินถ้อยคำของ 9.2)
3. ปิดเลขบัตรในแถว Postgres เดิมและรหัสเดิมด้วยหรือไม่ (Q4) · อีเมลที่พิมพ์ตอนล็อกอินใน Postgres (Q11)
4. กฎเลขบัตรของสำเนา (3.6) ปิดเกินไว้ก่อน — เลขอื่นที่มี 13 หลักคั่นด้วยจุดหรือขีดล่างก็กลายเป็น `[cid]` ในสำเนา ยอมรับหรือให้แคบลง
5. ถ้อยคำของประกาศความเป็นส่วนตัว (9.2) และข้อยกเว้นการลบ (9.3)
6. ข้อมูลของคนอื่นที่ต้องตัดออกก่อนส่งผลการขอเข้าถึง (9.5)
7. พ.ร.บ.คอมพิวเตอร์ ม.26 (9.4)
8. การผ่าน Cloudflare และ region ของ Azure (9.6)
9. ยอมรับความเสี่ยงที่เหลือ (9.7, Q13)
