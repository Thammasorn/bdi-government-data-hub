# 21 — Activity log: บันทึกอะไร ในรูปไหน และสำเนาใน MongoDB

การ์ด Task Board **“พัฒนา activity log บน mongo db”** (โปรเจกต์ *Government Datahub Platform*) ·
branch `develop-activity-log-on-mongo-db` · เขียนจากโค้ดที่ commit **`2cab0a7`** · 2026-09-30

เอกสารนี้เขียนสำหรับนักพัฒนาและผู้ดูแลระบบของ BDI ที่ต้องตอบให้ได้ว่า **ระบบจดอะไรไว้บ้าง จดเมื่อไร
และแต่ละแถวหน้าตาเป็นอย่างไร** ไม่ใช่คู่มือผู้ใช้ audit ไม่เคยขึ้นหน้าจอ (`CLAUDE.md` หัวข้อ
*Audit log, notifications and the outbox*) การอ่านวันนี้จึงทำผ่าน `psql` (คิวรีพร้อมใช้อยู่ที่ 2.10) · `mongosh` สำหรับ error และสำเนาที่
Postgres ไม่รับ (runbook 5.11) · และ API ตัวเดียวคือ `recentAudit` ของ `GET /api/admin/users/:id` ที่คืน 20 แถวล่าสุดซึ่ง subject เป็นบัญชีนั้น
(ข้อจำกัดของมันอยู่ที่ 2.10) และจะอ่านผ่าน API ที่ออกแบบไว้ในขั้น 7 (3.11)

> **สถานะ ณ `2cab0a7`**
>
> - **ทุกเหตุการณ์ยังลง Postgres ตาราง `audit.audit_event` ซึ่งเป็นระบบบันทึกหลัก** ผ่าน `logAudit()`
>   (`backend/src/lib/audit.ts:563`) หมวด 2 และหมวด 4 อธิบายสิ่งที่โค้ดที่ commit นี้เขียนจริง
> - ขั้น 1–5 ของแผน**เสร็จบน branch นี้แล้ว แต่ยังไม่ merge และยังไม่ deploy**: ขั้น 1–3 (auth ครบทุกขั้นรวมความล้มเหลว · diff ของการบันทึกร่าง ·
>   ช่องโหว่ฝั่ง admin และ event ที่ติดป้ายผิด) กับการแก้สี่ข้อหลัง review (`76245a3` body ที่อ่านไม่ออกแยกตามที่มา · `fc16d0f` อีเมลยาวไม่เกิน 254 ตัว ·
>   `d3c1ee0` `normalised_by_route` ของการบันทึกร่าง · `5481723` ตัวตรวจความลับของ Postman) · ขั้น 4 (MongoDB) · ขั้น 5 (เก็บ error แบบ Sentry) —
>   production (`main/`) ยังเขียนชุดก่อนการ์ด รหัสที่เพิ่งเกิดในการ์ดนี้ (`LOGIN_OTP_ISSUED` · `REQUEST_DRAFT_SAVED` · `ADMIN_TOKEN_REJECTED` ฯลฯ)
>   จึงยังไม่มีในฐานข้อมูล production และ production ยังไม่มี service `mongo`
> - **MongoDB ที่มีในโค้ดแล้ว** (ขั้น 4–5): service `mongo` ในทุก stack พร้อมผู้ใช้สิทธิ์น้อยสองคนที่ drop อะไรไม่ได้ และด่านปฏิเสธรหัสผ่านตัวอย่าง
>   บน production (3.1, 3.12) · `lib/log-store.ts` สถานะ `logStore` ใน `/health/ready` และสวิตช์ปิด `LOG_STORE_ENABLED=false` (3.13) · collection
>   `error_events` `error_issues` `runtime_events` (หมวด 5) · เอกสาร `activity` ที่ `source: "audit_fallback"` เมื่อ `logAudit` ล้ม
>   (อ่าน snapshot ของผู้กระทำหรือ INSERT — 3.14) · ฟิลด์เพดานขนาดใน `relay_state` (`storageMb` `allocatedMb` `maxMb` `overQuota` `quotaCheckedAt` — 5.9) ·
>   รหัสอ้างอิงบนคำตอบ 5xx ที่ส่งผ่าน `res.json` และมีคีย์ `error` เป็นสตริง — ซึ่งคือคำตอบ error ของ API แทบทั้งหมด (ข้อยกเว้นอยู่ที่ 5.8)
> - **ยังเป็นแบบที่ออกแบบไว้เท่านั้น** ติดป้าย **[ออกแบบ · ยังไม่สร้าง]** (หรือ **[ออกแบบ]** ในตาราง): relay ที่คัดลอก `audit_event` ลง `activity`
>   พร้อม `hashKeys` index ของ `activity` และ retention/prune ทั้งหมด (ขั้น 6) · API อ่าน `/api/admin/logs/*` รวม `AUDIT_LOG_READ` `LOG_TOKEN_REJECTED`
>   `ERROR_ISSUE_STATUS_CHANGED` (ขั้น 7) · บันทึกการเรียก `/api/admin*` (`ADMIN_API_REQUEST` ขั้น 8) · error จากเบราว์เซอร์และ Next server (ขั้น 9) ·
>   อีเมลแจ้งเตือน error (ขั้น 10)
> - **merge main ที่ `7259c09`** (2026-10-01) — กฎ BDI 2026-09-30 ว่าหน่วยงานเกิดจากผู้ดูแลระบบเท่านั้น (`POST /api/admin/organizations`):
>   `POST /api/organizations` เหลือทางเดียว คือผู้ประสานงานของหน่วยงาน (`ORGANIZATION_USER`) ที่มีหน่วยงานแล้วเปิดคำขอให้หน่วยงานของตัวเอง
>   (`REQUEST_CREATED` + `prefilled_from`) ผู้เรียกอื่นที่ไม่ใช่บัญชี BDI ได้ 403 `no_organization` และ**ไม่มีแถว** (เหมือนการปฏิเสธ 4xx อื่นของ
>   เส้นทางธุรกิจ — 6.1) ทาง “ผู้ใช้เปิดหน่วยงานใหม่” ถูกถอด แถว `ORGANIZATION_CREATED` `created_via: WEB_FORM` · `REQUEST_CREATED` ที่ตามมา ·
>   `ROLE_ASSIGNED` `assigned_via: ORGANIZATION_CREATED` และ `ROLE_REVOKED` รูปแบบ A/B จากเส้นทางนี้จึงมีแค่ในแถวที่เขียนก่อนหน้า หัวข้อที่พูดถึง
>   ติดป้าย **ถอดแล้วที่ `7259c09`** ไว้ ส่วนเลขบรรทัดยังอ้าง `2cab0a7` ตามเดิม
> - หัวข้อที่สร้างแล้วอธิบายสิ่งที่โค้ดทำจริง เมื่อโค้ดต่างจากแบบ เอกสารตามโค้ดและบอกความต่างในบรรทัดที่ขึ้นต้นด้วย **ต่างจากแบบ:**
> - สิ่งที่แผนไม่ได้เขียนไว้และเอกสารนี้เสนอเองติดป้าย **[ข้อเสนอ]** ส่วนที่ต้องมีคนตัดสินก่อนสร้าง ติดป้าย **[ต้องตัดสิน]**
> - ก่อน merge ขั้น 4 เข้า `main/` ต้องตั้ง `MONGO_ROOT_PASSWORD` `MONGO_BACKEND_PASSWORD` `MONGO_WORKER_PASSWORD` ใน `main/.env` ด้วย
>   `openssl rand -hex 32` ไม่งั้น mongo บน production ไม่ยอมเริ่ม (3.12) — เว็บยังขึ้น แต่ log store เป็น `down` · และ**ห้าม `down -v` ที่ `main/`**
>   เพราะ volume `mongo-data` คือ log ของ production · shell ที่ build image ของ production ต้องตั้ง `GIT_SHA=$(git rev-parse --short HEAD)`
>   ไม่งั้น `RELEASE` ของทุก event เป็น `unknown` (5.10) · **ด่าน prod-build (T) ยังไม่เคยรันที่ `2cab0a7`** — สิ่งที่ยังไม่ได้ยืนยันกับ image จริง:
>   `npm ci --omit=dev` ดึง `mongodb` 6.21 มาด้วย · `RELEASE` กับ `NODE_OPTIONS=--enable-source-maps` อยู่ใน image ของ runner · เฟรมของ stack ชี้
>   `/app/src/*.ts` จน `topFrame` และ fingerprint ตรงกับ dev (5.2, 5.4) · backend ของ prod overlay ได้ SIGTERM ถึง `shutdown()` (3.10)

เลขบรรทัดทุกตัวในเอกสารนี้อ้างถึง `2cab0a7` path ที่ขึ้นต้นด้วย `routes/` `lib/` `middleware/` `scripts/`
`workers/` อยู่ใต้ `backend/src/` คำว่า “แผน” หมายถึงแผนของการ์ดนี้ (ฉบับ final หลัง review 2026-09-25) ซึ่ง**แนบอยู่ในการ์ด
Notion เป็นไฟล์ `activity-log-plan-2026-09-25.md`** ไม่ได้อยู่ใน repo และ §N / “ขั้น N” / Qn อ้างหัวข้อ ขั้นงาน และคำถามถึง
BDI ในแผนนั้น

---

## 1. ภาพรวม — เหตุการณ์หนึ่งเดินทางไปที่ไหนบ้าง

```
 เบราว์เซอร์ · Postman · สคริปต์
        │   x-correlation-id ที่เป็น UUID ถูกรับไว้ ไม่งั้นสร้างใหม่ (lib/context.ts)
        ▼
 backend ─ correlationMiddleware ─► requireAuth ─────────────► route handler
           (web-portal, IP, UA)      setActor(ผู้ใช้)             │  wrap() จด route แม่แบบลงบริบท
                                  └► requireAdminToken           │ ธุรกรรมของ route commit แล้ว
                                     admin-portal + token fp     ▼
                                                        logAudit(input) — ไม่ throw ไม่ retry
                                                                 │ INSERT ผ่าน prisma ตัวหลัก
                                                                 ▼
                                              Postgres audit.audit_event   ◄── ระบบบันทึกหลัก
                                                                 │             (ไม่มี retention)
 ─────── สร้างแล้ว (ขั้น 4–5) ────────────────────────────────────│───────────────────────────
 INSERT สำเร็จ ─► breadcrumb "audit" (ชื่อ action) ในบริบทของคำขอ
 อ่าน snapshot หรือ INSERT ล้ม ─► breadcrumb "audit" ok:false "<ACTION> — เขียนไม่สำเร็จ"
        ─► captureError (tag audit.write-failed) + activity {source:"audit_fallback"}
 error middleware · 5xx ที่ route ตอบเอง · จุดที่กลืน error · process handlers ─► captureError()
        ─► บรรทัด [capture] ที่กวาดแล้วใน log ของ container (ทุกตัว ยกเว้นที่ส่ง print:false —
           body ที่อ่านไม่ออก และ over-quota ของ worker)
        ─► คิวในหน่วยความจำ (≤ 500 รายการ / 2 MB) ─► flush ทุก 2 วินาที ทีละก้อน
        ─► mongo bdi_logs: error_events + error_issues · runtime_events · activity
 backend + worker เริ่ม / ปิด / fatal ─► runtime_events (ผ่านคิวเดียวกัน)
 delivery-worker: log-upkeep ทุก 60 วินาที ─► index ของ collection error
                                           ─► เพดานขนาดรายชั่วโมง ─► relay_state.overQuota
 /health/ready ◄── สถานะ logStore ที่ตรวจเบื้องหลังทุก 30 วินาที (ไม่นับใน healthy)
 ═══════ ทุกอย่างใต้เส้นนี้ [ออกแบบ · ยังไม่สร้าง] ══════════════════════════════════════════
 delivery-worker: relay ทุก 5 วินาที ── อ่านตาม cursor (occurred_at, id) ──► mongo activity
                                                                  {source:"audit_event"}   ขั้น 6
 /api/admin/logs/* (x-log-token) ─► recordLogRead() ─► Postgres AUDIT_LOG_READ (ไม่กลืน error)
        └ INSERT ล้ม ─► await เขียน activity {source:"audit_fallback"} ตรง ไม่ผ่านคิว (≤ 2 วินาที)
          ล้มทั้งคู่ ─► 503 log_read_unrecorded และไม่ส่งข้อมูล                                  ขั้น 7
 ทุก /api/admin* ยกเว้น /api/admin/logs* (ตอน res 'finish') ─► คิว
        ─► activity {source:"http", action:"ADMIN_API_REQUEST"}                           ขั้น 8
 เบราว์เซอร์ · Next server ─► POST /api/client-errors ─► คิว ─► error_events              ขั้น 9
 delivery-worker: loop แจ้งเตือนของตัวเอง อ่าน error_issues / runtime_events
        ─► sendRaw() ทีละฉบับ ─► ERROR_ALERT_EMAILS · เขียน alertedAt alertCount กลับ        ขั้น 10
```

กติกาที่ภาพนี้ตั้งอยู่ และจะไม่เปลี่ยนเมื่อสร้างส่วนที่เหลือ — ข้อที่ติด [ออกแบบ] ยังไม่มีในโค้ดที่ `2cab0a7`:

- **Postgres `audit.audit_event` เป็นระบบบันทึกหลักต่อไป** MongoDB `activity` เป็น **สำเนาที่ค้นได้** (แผน §2 ข้อ 1) — วันนี้มีแค่เอกสาร
  `audit_fallback` ส่วนสำเนาของทุกแถว [ออกแบบ] หลักฐานของการลบแบบถาวร (`INVITATION_DELETED`, `REQUEST_DELETED`) จึงยังอยู่ในฐานข้อมูลที่มี
  transaction และมี `pg_dump` สร้างใหม่จาก Postgres ได้**เฉพาะเอกสาร `source:"audit_event"`** (rebuild ของแผนคือ `deleteMany({source:"audit_event"})`)
  เอกสาร `audit_fallback` (สร้างแล้ว) และ `http` [ออกแบบ] ไม่มีใน Postgres จึงสร้างใหม่ไม่ได้ และแถวที่ `seed:demo` ลบจาก Postgres ไปแล้วเหลืออยู่ใน
  Mongo ที่เดียว (3.8)
- **ทางของ request ไม่รอ MongoDB เลย** — สร้างแล้วสำหรับส่วนที่มี: `captureError()` synchronous แค่วางลงคิว `/health/ready` อ่านสถานะที่จำไว้
  และสำเนา `audit_fallback` ก็เข้าคิวเดียวกัน MongoDB ตาย คำขอของผู้ใช้ไม่รู้สึกอะไร · relay [ออกแบบ] อยู่ใน delivery-worker ซึ่งอ่านแถวที่ commit แล้ว
  ไม่ใช่ `logAudit()` เขียนสองที่ · ข้อยกเว้นเดียวคือการอ่าน log ขั้น 7 [ออกแบบ] ที่ต้องบันทึกได้ก่อนตอบ
- **ไม่มี service ไหน `depends_on: mongo`** และ `LOG_STORE_ENABLED=false` ปิดทั้งหมดได้โดยไม่ต้อง build ใหม่ (สร้าง backend กับ worker ใหม่) — สร้างแล้ว (3.13)
- **สัญญาของ `logAudit()` ไม่เปลี่ยน**: เขียนหลัง commit และไม่ throw ขั้น 5 (สร้างแล้ว) เพิ่มแค่ breadcrumb `audit` (ทั้งทางสำเร็จและทางล้ม) และ
  `captureError` กับเอกสาร `audit_fallback` ในทางที่ล้ม (2.8) ส่วนขั้น 7 [ออกแบบ] เพิ่ม**ผู้เขียนคนที่สอง**ของ `audit.audit_event` คือ `recordLogRead()` ใน `lib/audit.ts` ซึ่ง
  **ไม่กลืน error** (ต้องบันทึกได้ก่อนส่งข้อมูล)
- relay **คัดลอกสิ่งที่ commit แล้วตามจริง** [ออกแบบ] รวมถึงแถวที่แปลกอยู่แล้วใน Postgres (หมวด 6.2) ไม่ได้ซ่อมให้

---

## 2. รูปแบบแถว `audit.audit_event`

ตารางอยู่ใน schema `audit` (model `AuditEvent` ใน `backend/prisma/schema.prisma`, DDL ใน migration
`20260811155040_datahub_v2_baseline`) **ที่ `2cab0a7` ผู้เขียนมีคนเดียวคือ `logAudit()`** — 90 จุดเรียกใน 11 ไฟล์
ไม่มี raw SQL และไม่มี `prisma.auditEvent.create` ที่อื่น (ขั้น 7 จะเพิ่ม `recordLogRead()` เป็นคนที่สอง — หมวด 1) ผู้อ่านในโค้ดมีจุดเดียว:
`GET /api/admin/users/:id` คืน 20 แถวล่าสุดที่ subject เป็นบัญชีนั้นใน `recentAudit` (`routes/admin-users.ts:455`)
ซึ่ง**ไม่เห็น**สิ่งที่คนนั้นทำเองในฐานะ actor และไม่เห็นแถวที่ subject เป็น assignment คีย์ หรือ session ของเขา (2.10)

“ห้ามแก้ห้ามลบ” เป็น **ข้อตกลง ไม่ใช่กลไก**: ไม่มี trigger ไม่มี REVOKE ไม่มี FK และ `seed:demo`
ลบทุกแถวด้วย `prisma.auditEvent.deleteMany()` (`scripts/seed-demo.ts:214`)

### 2.1 คอลัมน์

| คอลัมน์ | ชนิด | ใครเติม | หมายเหตุ |
|---|---|---|---|
| `id` | UUID PK | Prisma `uuid()` ฝั่ง client | DDL ไม่มี default |
| `occurred_at` | TIMESTAMPTZ(6) | Prisma `@default(now())` — engine ของ Prisma สร้างค่าเองจากนาฬิกาของ process (backend หรือ worker) ตอน `create()` แล้วส่งเป็นพารามิเตอร์ DDL `DEFAULT CURRENT_TIMESTAMP` มีผลเฉพาะ INSERT ที่ไม่ผ่าน Prisma (เช่นแถว `admin-script`) | เวลาที่ `logAudit` สร้าง INSERT แถวนี้ ไม่ใช่เวลาของธุรกรรมที่ถูกบันทึก (2.8) · เก็บเป็น UTC (ดูข้างล่าง) · ยังไม่ได้ยืนยันด้วย query log ว่า Prisma 6 ส่งคอลัมน์นี้เอง |
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

index ที่มี: `(subject_type, subject_id, occurred_at)` · `(actor_id, occurred_at)` · `(correlation_id)`
**ไม่มี** index บน `occurred_at` เดี่ยว ๆ บน `action` หรือบน `organization_id` (ขั้น 6 จะเพิ่ม
`(occurred_at, id)` ให้ relay)

**เขตเวลา** `occurred_at` เป็น TIMESTAMPTZ ซึ่งเก็บเป็นจุดเวลาแบบ UTC — `psql` แสดงตาม `TimeZone` ของ session นั้น (ตัวอย่างใน
2.9 จึงลงท้าย `+00:00`) อ่านเป็นเวลาไทยด้วย `occurred_at AT TIME ZONE 'Asia/Bangkok'` หรือ `SET TIME ZONE 'Asia/Bangkok';`
ก่อนคิวรี และกรองช่วงวันด้วยค่าที่มี offset เช่น `'2026-09-29 00:00+07'` ไม่งั้นวันหนึ่งของไทยจะเลื่อนไป 7 ชั่วโมง ค่าเวลาใน JSON
(`expires_at` `window_start` ฯลฯ) เป็นสตริง ISO แบบ UTC (`…Z`) API ขั้น 7 จะคืน `occurredAtBangkok` ให้ด้วย

### 2.2 `actor_type` กับ `actor_id`

```ts
actorId   = input.actorId ?? currentContext()?.actorId ?? null
actorType = input.actorType ?? (actorId ? "USER" : "SYSTEM")
```

actor ใน context มาจาก `setActor(user.id)` ซึ่งมีผู้เรียกคนเดียวคือ `requireAuth` (`middleware/auth.ts:112`)
หลังตรวจ session ผ่าน ผลที่ตามมา:

| ที่มาของคำขอ | actor ที่ได้ |
|---|---|
| route ที่อยู่หลัง `requireAuth` (`/api/organizations/*`, `/api/dataset-requests/*`, `/api/notifications/*`, `/api/auth/logout-all` `/sessions` `/me`) | `USER` = ผู้ที่ล็อกอิน พร้อม snapshot |
| `SESSION_REVOKED` ที่ `requireAuth` เขียนเอง**ก่อน** `setActor()` — `EXPIRED` ผ่าน `resolveSession()` และ `ACCOUNT_SUSPENDED` (`middleware/auth.ts:82`) รวมถึง `EXPIRED` จาก `resolveSession()` บน `/logout` `/password-reset` และ `issueSession()` | `USER` = **เจ้าของ session หรือบัญชี** (helper ส่ง `actorId` เอง) ไม่ใช่ผู้ที่ล็อกอิน — คำขอที่ `requireAuth` ปฏิเสธจบด้วย 401 |
| `/api/admin/*` (หลัง `requireAdminToken`) | `SYSTEM` · `actor_id` null — token ไม่ผูกกับตัวคน (docs/09 §4) |
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

รายละเอียดของ snapshot (`audit.ts:567-591`) ที่คนอ่านต้องรู้:

- อ่านด้วย prisma ตัวหลัก **ตอนเขียนแถว** ซึ่งส่วนใหญ่คือหลังการกระทำ การยุติบัญชีหรือการถอน role ตัวเอง
  จึงเห็น role หลังเปลี่ยน ส่วนแถวที่เขียนระหว่าง transaction ยังเปิดอยู่เห็นสถานะ**ก่อน**เปลี่ยน (6.2)
- กรองแค่ `status = ACTIVE` ไม่ดู `effectiveUntil` และไม่ดู `role.isActive` ต่างจาก `requireAuth`
- `actor_organization_id` ที่เป็น `undefined` หายไปจาก JSON ทั้งคีย์ ไม่ใช่ `null`
- บัญชีระบบ `SYSTEM_USER_ID` (`00000000-0000-0000-0000-000000000001`) ไม่มีชื่อไทย `actor_name` ของมัน
  จึงเป็นอีเมลของบัญชีนั้น และ `actor_roles` มักเป็น `[]`
- snapshot ถูกเก็บลง metadata เพราะ Excel ตัดคอลัมน์ `actor_name` / `actor_roles` ออก ไม่เก็บไว้ แถวเก่าจะ
  เปลี่ยนความหมายเมื่อผู้ใช้เปลี่ยนชื่อ (หัวไฟล์ `audit.ts`)
- **ลำดับการรวมมีผล**: `input.metadata` ถูกกระจาย**หลัง** snapshot คีย์ของจุดเรียกที่ชื่อ `actor_name` `actor_roles` หรือ
  `actor_organization_id` จึงทับ snapshot ได้เงียบ ๆ (`audit.ts:593-600`) มีแค่ `ip_unparsed` กับ `admin_token_fp` ที่มาหลังสุดและ
  ทับไม่ได้ วันนี้ไม่มีจุดเรียกไหนใช้ชื่อเหล่านั้น — ข้อควรระวังเมื่อเพิ่ม event ใหม่ (หมวด 8)

### 2.4 `source_component`

| ค่า | ใครตั้ง | อยู่ใน `audit_event` ที่ `2cab0a7` ไหม |
|---|---|---|
| `web-portal` | `correlationMiddleware` ตั้งให้ทุกคำขอ HTTP (`lib/context.ts:175`) | ใช่ — ทุกแถวของหน้าเว็บและของคนที่ยังไม่ล็อกอิน **รวมทั้ง `ADMIN_TOKEN_REJECTED`** เพราะ token ไม่ผ่านจึงไม่ถูกเปลี่ยน แถวสรุปที่ตัวกวาดเขียนภายหลังนอกคำขอก็ยังเป็น `web-portal` เพราะ recorder จำ `sourceComponent` ของคำขอแรกไว้ใน origin แล้วส่งต่อเข้า `runWithContext()` (`lib/token-rejection.ts:372` `:414`) ไม่ตกไปเป็น `request-service` |
| `admin-portal` | `requireAdminToken` เมื่อ token ผ่าน (`middleware/auth.ts:178`) | ใช่ — ทุกแถวของ `/api/admin/*` ที่ token ผ่าน (รวมแถวของ helper ที่ actor เป็น `USER`) · แถวก่อนการ์ดของ admin เป็น `web-portal` ทั้งหมด (6.2) |
| `request-service` | ค่าตั้งต้นเมื่อไม่มี context (`context.ts:94`) และของ `runWithContext()` | ไม่มีทางเขียนที่รู้จักในโค้ด commit นี้ แต่แถวเก่าบน production มีได้: ก่อน `261bd98` (commit ใน branch นี้) คำขออัปโหลดไฟล์ขนาดจริงหลุด context ใน multer แถวจึงได้ `SYSTEM` · `request-service` · ไม่มี IP · correlation id ใหม่ (Traps ใน `CLAUDE.md`) |
| `seed-demo` | `scripts/seed-demo.ts:1005` | เฉพาะเมื่อ `assignRole` ไปแทนที่ผู้ถือ role ระหว่าง seed (ปกติไม่มี และ seed ลบตารางก่อนอยู่แล้ว) |
| `notification-worker` | `workers/delivery.ts:179-180` ต่อแถว delivery | **ไม่** — worker ไม่เขียน audit เลย (error ต่อแถว `delivery.send-failed` `delivery.dead-letter` เกิดในบริบทนี้ ส่วน `delivery.tick` `delivery.main` และงานดูแล log store ไม่มีบริบท — 5.1) |
| `admin-script` | ไม่มีโค้ดไหนตั้ง | พบหกแถวบน production ที่ดูเหมือนถูก INSERT ด้วยมือ (แผน §13 ข้อ 22) |

ค่าอื่นใน Excel (`iam-service` `organization-service` `approval-service` `jira-integration`
`dii-integration` `activation-expiry-job`) ไม่มีโค้ดไหนตั้ง

### 2.5 `correlation_id`

- `correlationMiddleware` (`context.ts:157-186`) รับ header `x-correlation-id` **เฉพาะเมื่อเป็นรูป UUID**
  (`/^[0-9a-f]{8}-…-[0-9a-f]{12}$/i` — version ไหนก็ได้ รวม nil และ**คงตัวพิมพ์เดิม**) ไม่งั้นสร้าง
  `randomUUID()` ใหม่ และตอบกลับใน header `x-correlation-id` เสมอ · backend ประกาศ header นี้ใน `exposedHeaders` ของ CORS
  (`index.ts:139`) หน้าเว็บที่เรียกข้าม origin จึงอ่านได้ · 8 ตัวแรกของมันคือรหัสอ้างอิงที่ผู้ใช้เห็นบนคำตอบ 5xx (5.8)
- ทุกแถวของคำขอ HTTP เดียวกันจึงมี id เดียวกัน และ**แต่ละคำขอได้ id ของตัวเอง** — การกระทำที่กินหลายคำขอ (ล็อกอินสองขั้น
  · ThaID start/callback/activate · admin ออกลิงก์แล้วเจ้าของบัญชีกดทีหลัง · ปุ่มสร้างเอกสารที่ PATCH ก่อนเรียก generate)
  จึงมีหลาย correlation id โค้ดหน้าเว็บไม่ตั้ง `x-correlation-id` เองเลย (ไม่มีใน `frontend/`) ไม่มีอะไรผูกคำขอของคลิกเดียวกันไว้
- `correlationId()` นอก context (`context.ts:79`) ได้ UUID ใหม่ทุกครั้งที่เรียก แต่ไม่มีทางเขียน audit ที่รู้จักทางไหนไปถึงตรงนั้น
  แถวสรุปของ `ADMIN_TOKEN_REJECTED` เขียนใน `runWithContext({...origin, correlationId: undefined})` ซึ่งสร้าง UUID ใหม่
  หนึ่งค่าต่อแถวสรุป (`context.ts:101`, `lib/token-rejection.ts:268` `:275`) ผลเหมือนกัน: id ที่ไม่ตรงกับคำขอใดเลย
- proxy ของหน้าเว็บ (`frontend/app/api/[...path]/route.ts`) ส่ง header ของเบราว์เซอร์ต่อทั้งหมด
  **เบราว์เซอร์จึงเลือก id เองได้** รวมถึงใช้ซ้ำหรือชนกับของคนอื่น id เดียวกันจึงไม่ใช่หลักฐานว่าเป็นคลิกเดียวกัน
  (ขั้น 9 จะให้ proxy ตั้งค่าใหม่ทุกครั้ง)
- delivery-worker ห่อแต่ละแถวที่ส่งด้วย `runWithContext({correlationId: row.correlation_id, …})` (`workers/delivery.ts:179-180`)
  งานส่งอีเมลจึงถือ id ของคำขอที่สร้างการแจ้งเตือนนั้น — worker ไม่เขียน audit แต่ `error_events` ของมัน (`delivery.send-failed`
  `delivery.dead-letter`) ถือ id นี้ใน `request.correlationId` dead letter จึงค้นเจอด้วยรหัสอ้างอิงของคลิกต้นเรื่อง (5.1)
- ตารางอื่นที่มี correlation id ให้ join: `notification.notification` · `notification.notification_delivery` ·
  `integration.integration_operation` — สามตารางนี้เป็นชนิด UUID (เก็บตัวพิมพ์เล็ก) และ **ไม่มี index** บน
  คอลัมน์นี้ ถ้าผู้เรียกส่ง id ตัวพิมพ์ใหญ่มา `audit_event` เก็บตามนั้น ให้เทียบด้วย
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

- `ip_address` = `parseClientIp(req.ip)` (`context.ts:139-143`): ไม่มีค่า → null · ไม่ใช่ IP ตาม `isIP()` →
  null + `metadata.ip_unparsed: true` (ค่าดิบไม่ถูกเก็บที่ไหนเลย) · เป็น IP → ตัด zone ของ IPv6 ออก
  คง `::ffff:` ไว้ ยาวไม่เกิน 45 ตัว
- `trust proxy 1` ทำให้ `req.ip` เป็นค่าสุดท้ายของ `X-Forwarded-For` **ซึ่งผู้เรียกเขียนเองได้** ทั้งตอนยิง
  backend ตรงและตอนยิงผ่านหน้าเว็บ บน dev checkout ค่านี้คือสิ่งที่ผู้เรียกพิมพ์มา บน production ถูกเท่าที่
  Cloudflare ต่อท้ายที่อยู่จริงให้ ซึ่ง**ยังไม่ได้ยืนยันกับ tunnel ของเรา** (docs/09 §4.1) อ่านคอลัมน์นี้เป็น
  “ที่อยู่ที่อ้างมา” เสมอ
- `user_agent` = `storedUserAgent(header)` (`audit.ts:549`): กลุ่มเลขที่คั่นด้วย `-` `_` `:` หรือช่องว่าง
  ไม่เกินสามตัวติดกัน ซึ่งรวมกันได้ 9 หลักขึ้นไป → `:n` แล้วตัดที่ 512 ตัว `.` และ `/` ไม่นับเป็นตัวคั่น
  เลขเวอร์ชัน (`Edg/151.0.3405.80`, `Gecko/20100101`) จึงรอด เลขบัตรหรือเบอร์โทรที่คนพิมพ์ไม่รอด ใช้กับ
  **ทุกแถว** ส่วน `iam.session` และหลักฐานการลงนามเก็บ user agent ดิบ
- แถวทันทีและแถวสรุปของ “ถังรวม” ใน `ADMIN_TOKEN_REJECTED` ไม่มีทั้ง IP และ user agent โดยตั้งใจ (4.11)

### 2.7 การแปลงค่าและเพดานความยาว

- `action` ตัดที่ 128 · `subject_type` `ip_address` `correlation_id` `source_component` ตัดที่ 64 (`fit()`)
  ค่าที่ยาวเกินจะทำให้ INSERT ล้มทั้งแถว จึงตัดทิ้งส่วนเกินก่อน
- `before` / `after` / `metadata` ผ่าน `toJson()` (`audit.ts:494`): `JSON.stringify` แล้ว `JSON.parse`
  — `Date` กลายเป็นสตริง ISO · คีย์ที่ค่าเป็น `undefined` หายไป · `null` หรือ `undefined` ทั้งก้อนเป็น SQL
  NULL · ทุก**ค่า**ที่เป็นสตริงผ่าน `storableText()` (ตัด U+0000 และแทน surrogate ครึ่งคู่ด้วย U+FFFD) ไม่งั้น jsonb ปฏิเสธทั้งแถว
  — replacer ของ `JSON.stringify` แตะแค่ค่า **ชื่อคีย์ไม่ผ่าน** (`audit.ts:496-498`) วันนี้ไม่มีผลเพราะคีย์มาจากโค้ดหรือจาก shape ที่ zod ตรวจแล้ว
- `storableText()` **ไม่**ใช้กับคอลัมน์สเกลาร์ (`action`, `subject_type`, `user_agent` …)
- คอลัมน์ UUID (`actor_id`, `subject_id`, `organization_id`) ไม่ถูกตรวจรูป ค่าที่ไม่ใช่ UUID ทำให้ INSERT ล้ม
  และแถวหาย — fingerprint หรือรหัสอื่นที่ไม่ใช่ UUID ต้องไปอยู่ใน `metadata`
- `logAudit()` **ไม่ sanitize อะไรให้เลย** การปิดเลขบัตรทำที่จุดเรียก (`sanitizeDiff()` / `sanitizeState()`)
  และ `metadata` ไม่ผ่านขั้นไหนที่ปิดข้อมูลให้ทั้งก้อน — ข้อยกเว้นเดียวคือคีย์ `organization_master_changed` ของ
  `REQUEST_DRAFT_SAVED` ที่จุดเรียกประกอบจาก `sanitizeDiff()` เอง (`routes/organizations.ts:1541-1548` `:1568`) (หมวด 7) · สำเนา
  `audit_fallback` ใน Mongo ปิดเลขบัตรเองอีกชั้นก่อนออกจาก process (3.14)

### 2.8 เวลาที่เขียน และสิ่งที่ `logAudit()` ไม่ทำ

- **ไม่ throw ไม่ retry และ Postgres ไม่ได้แถวคืน** การอ่าน snapshot กับ INSERT อยู่ใน `try` · INSERT ที่สำเร็จทิ้ง breadcrumb `audit`
  (ชื่อ action) ไว้ในบริบทของคำขอ (5.2) · `catch` (`audit.ts:621-628`) ทิ้ง breadcrumb `"<action> — เขียนไม่สำเร็จ"` แล้วส่งให้
  `reportAuditWriteFailure()` (`lib/audit-fallback.ts`) ซึ่ง (1) `captureError()` tag `audit.write-failed` พร้อม input ของแถวที่ปิดเลขบัตรแล้วใน
  `extra.audit` — พิมพ์บรรทัด `[capture]` ที่กวาดแล้วหนึ่งบรรทัดลง stderr **เสมอ** แต่ตัว event เข้าคิวเฉพาะเมื่อผ่านเพดาน (50 ตัวต่อชั่วโมงของ
  fingerprint · 600 ตัวต่อนาทีของ process · ไม่เกินเพดานขนาด · คิวรับ — 5.7) ตอน Postgres ล่มนาน event ส่วนใหญ่จึงเหลือแค่ตัวนับของ issue และ
  `extra` ที่เกิน 16 KB (`note` ยาว diff ของแบบฟอร์มใหญ่) เหลือ `{truncated, bytes, keys}` ไม่มี input ของแถว (3.14) และ (2) วางเอกสาร `activity`
  `source: "audit_fallback"` ลงคิวเดียวกัน ซึ่งไม่ติดเพดานการสุ่มเก็บหรือเพดานขนาด (ยังหายได้ถ้าคิวเต็มด้วยรายการชั้นเดียวกัน ใหญ่เกินหลังตัด หรือ process ตายก่อน flush) —
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
- จุดเรียกส่วนใหญ่ `await` ยกเว้น `ADMIN_TOKEN_REJECTED` ที่ยิงแล้วไม่รอ (`void write(...)`) คำตอบ 401 จึงไม่รอฐานข้อมูล
- สิ่งที่ทำให้แถวหายได้: INSERT ล้ม (Postgres ล่ม · ค่าไม่ใช่ UUID ในคอลัมน์ UUID · `BigInt` ใน JSON ที่
  `JSON.stringify` แปลงไม่ได้) · process ตายก่อน `await` จบ · สำหรับแถวที่ยิงแล้วไม่รอ process ถูก kill ·
  **ตอน shutdown** `shutdown()` (`index.ts:414-425`) เรียก `server.close()` บันทึก `shutdown` ลงคิว แล้วรอ `flushTokenRejections()` ไม่เกิน
  2 วินาที เขียนคิวของ log store ไม่เกิน 2 วินาที ปิด client ของ Mongo ไม่เกิน 1.5 วินาที จากนั้น `prisma.$disconnect()` และ `process.exit(0)`
  (5.10) โดยไม่รอคำขอที่กำลังวิ่ง — `logAudit` ที่ยังไม่จบของคำขอเหล่านั้นหายได้ และสำเนา `audit_fallback` ที่ยังค้างคิวหลัง 2 วินาทีก็หาย · ตัวนับของ `ADMIN_TOKEN_REJECTED` ที่ยังไม่ถึงรอบสรุปอยู่ในหน่วยความจำอย่างเดียว process ตายหรือ
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

### 2.10 ค้นแถวใน Postgres วันนี้ — “คนนี้ทำอะไร เมื่อไร เปลี่ยนอะไร”

ก่อนขั้น 7 ไม่มี API ค้น log ทางเดียวคือ `psql` บนเครื่อง

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

**คำขอ HTTP หนึ่งครั้ง** (correlation id เต็ม หรือรหัสอ้างอิง 8 ตัว) — header ที่ผู้เรียกส่งมาเป็นตัวพิมพ์ใหญ่ถูกเก็บตามนั้นใน
`audit_event` แต่สามตารางอื่นเป็นชนิด UUID (2.5) · error และสำเนา `audit_fallback` ของคำขอเดียวกันอยู่ใน Mongo (5.11 ข้อ 1):

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

> **สร้างแล้วที่ `2cab0a7` (ขั้น 4–5)**: ฐานข้อมูล collection และผู้ใช้สองคน (3.1) · service `mongo` รหัสผ่านและด่านปฏิเสธ (3.12) ·
> การเชื่อมต่อ สถานะ `logStore` และสวิตช์ปิด (3.13) · เอกสาร `activity` แบบ `audit_fallback` (3.14) · ฟิลด์เพดานขนาดใน `relay_state` (3.8, 5.9) ·
> index ของ collection error (3.9) — collection ของ error อธิบายในหมวด 5 และ runbook อยู่ที่ 5.11
> **ยัง [ออกแบบ · ยังไม่สร้าง]** จากแผน §3 §6 §7: relay ที่คัดลอก `audit_event` (3.3, 3.8) · `via` (3.4) · ตาราง category (3.5) · การปิดข้อมูลและ
> `hashKeys` ของสำเนา (3.6) · index และ retention ของ `activity` (3.9) · การอ่าน (3.11) — ขั้น 6 เพิ่ม relay, index ของ `activity` และ retention ·
> ขั้น 7 เพิ่ม API อ่าน · ขั้น 8 เพิ่มเอกสาร `source:"http"` · รูปของเอกสาร `activity` ใน 3.2 ใช้กับทั้งสามแหล่ง เอกสาร `audit_fallback` ที่สร้างแล้วมีทุกฟิลด์
> ของรูปนั้น ต่างที่ค่าของบางฟิลด์ (3.14)

### 3.1 ฐานข้อมูล collection และผู้ใช้ · สร้างแล้ว (ยกเว้นแถวที่ติดป้าย)

ฐานข้อมูล `MONGODB_DB` (ค่าตั้งต้น `bdi_logs`) บน service `mongo` ของแต่ละ stack (3.12) · `_id` ทุกตัวเป็นสตริง (UUID · fingerprint ของ
`error_issues` · หรือ `"audit_event"` ของเอกสารเดียวใน `relay_state`) ·
เอกสารละไม่เกิน 64 KB (ตัดก่อนเขียน — 5.2, 3.14) · driver ทางการ `mongodb` 6.21 ซึ่ง `lib/log-store.ts` เป็นไฟล์เดียวที่โหลด และโหลดด้วย `import()`
เฉพาะเมื่อเปิดใช้ (ไฟล์อื่น import แค่ type) · **ไม่มีใครเรียก `createCollection`**: insert หรือ `createIndex` ครั้งแรกสร้าง collection เอง (ลองกับ `mongo:7.0`
แล้ว) ฐานที่เพิ่งสร้างจึงมีแค่ collection ที่เคยถูกเขียน

| collection | เก็บอะไร | ใครเขียน (process → ผู้ใช้ Mongo) | สถานะ |
|---|---|---|---|
| `activity` | สำเนาของแถวที่ `logAudit` เขียนไม่สำเร็จ — อ่าน snapshot หรือ INSERT ล้ม (`source:"audit_fallback"`, 3.14) | คิวของ backend → `bdi_backend` (worker ไม่เขียน audit จึงไม่มีของ worker) | สร้างแล้ว (ขั้น 5) |
| | สำเนาของทุกแถว `audit_event` (`source:"audit_event"`) | relay ใน delivery-worker → `bdi_worker` | [ออกแบบ] ขั้น 6 |
| | บันทึกการอ่าน log ตอน Postgres ล่ม (`source:"audit_fallback"`) | `recordLogRead()` เขียนตรงและ `await` ไม่เกิน 2 วินาที **ไม่ผ่านคิว** (คำขออ่านต้องรู้ผลก่อนตอบ) → `bdi_backend` | [ออกแบบ] ขั้น 7 |
| | การเรียก `/api/admin*` ทุกครั้ง ยกเว้น `/api/admin/logs*` (`source:"http"`) | คิวของ backend → `bdi_backend` | [ออกแบบ] ขั้น 8 |
| `error_events` | error หนึ่งครั้งต่อเอกสาร (5.2) | คิวของ backend → `bdi_backend` · คิวของ worker → `bdi_worker` | สร้างแล้ว (ขั้น 5) · เบราว์เซอร์และ Next [ออกแบบ] ขั้น 9 |
| `error_issues` | หนึ่งเอกสารต่อ fingerprint (5.3) | ตัว flush ของ backend และ worker (นับ) | สร้างแล้ว · PATCH สถานะ (ขั้น 7) และ `alertedAt` `alertCount` ของ loop แจ้งเตือน (ขั้น 10) [ออกแบบ] — วันนี้แก้สถานะด้วยมือ (5.11) |
| `runtime_events` | process เริ่ม · ปิด · ตายกะทันหัน (5.5) | backend และ worker ของตัวเอง | สร้างแล้ว (ขั้น 5) |
| `relay_state` | เอกสารเดียว `_id:"audit_event"` — ฟิลด์เพดานขนาด (5.9) · cursor และสุขภาพของ relay | ตัวตรวจเพดานของ worker (`workers/log-upkeep.ts`) → `bdi_worker` · backend อ่านแค่ `overQuota` | ฟิลด์เพดานสร้างแล้ว · cursor [ออกแบบ] ขั้น 6 |

**ผู้ใช้ Mongo สองคน** (role ใน `mongo/init/01-users.js`) — process ที่รับคำขอจากอินเทอร์เน็ตลบหรือเขียนทับ `activity` ไม่ได้ และ**ไม่มีใครในสองคนนี้
drop อะไรได้**:

| ผู้ใช้ → role (ในฐาน `bdi_logs`) | สิทธิ์ (ทุก collection ของฐานนี้ ยกเว้นที่ระบุ) | ใช้โดย |
|---|---|---|
| `bdi_backend` → `bdiLogBackend` | `find` `insert` · `update` **เฉพาะ `error_issues`** (ตัวนับ และสถานะ open/resolved/ignored) | backend |
| `bdi_worker` → `bdiLogWorker` | `find` `insert` `update` `remove` `createIndex` `listIndexes` `listCollections` `collStats` `dbStats` | delivery-worker |
| ไม่มีใครในสองคนได้ | `dropCollection` `dropDatabase` `dropIndex` `createCollection` `renameCollectionSameDB` `compact` สิทธิ์ข้ามฐาน และการจัดการผู้ใช้ | ต้องใช้ root (5.11) |

- ไม่มี API ใดลบหรือแก้ `activity` · `remove` ของ worker มีไว้ให้ prune ตามอายุ (ขั้น 6 [ออกแบบ]) — วันนี้ยังไม่มีโค้ดไหนลบอะไร
- **ต่างจากแบบ:** แผนให้ worker เพิ่มแค่ “update, remove และ createIndex” ที่สร้างเพิ่ม `listIndexes` `listCollections` `collStats` `dbStats` — โค้ดที่
  `2cab0a7` ใช้แค่ `dbStats` (ตัวตรวจเพดาน `db.command({dbStats: 1, freeStorage: 1})`) ส่วน `ensureIndexes()` เรียก `createIndex` ตรงโดยไม่ list ก่อน
  (คอมเมนต์หัว `01-users.js` ที่ว่ามันใช้ `listIndexes` ไม่ตรงกับโค้ด) **`listIndexes` `listCollections` `collStats` จึงไม่มีผู้ใช้** — เป็นสิทธิ์เกินที่ตัดออกได้
  หรือต้องบอกว่าเก็บไว้ให้งานไหน **[ต้องตัดสิน]**
- ช่องที่รู้แล้ว: `bdi_backend` มี `insert` บน `relay_state` ด้วย backend ที่ถูกยึดจึงวางเอกสาร `relay_state` ปลอม (เช่น `overQuota: true` หรือ `cursor`
  ในอนาคต) ได้**เฉพาะตอนที่ยังไม่มีเอกสารนั้น** — worker upsert มันตั้งแต่รอบตรวจเพดานแรกหลังบูต และ backend ไม่มี `update` บน collection นี้ ช่องจะเปิดอีกครั้ง
  หลัง rebuild ของขั้น 6 ที่ลบ `relay_state` จนกว่า worker จะตรวจรอบถัดไป

### 3.2 เอกสาร `activity` — ฟิลด์ · [ออกแบบ] (เอกสาร `audit_fallback` ที่สร้างแล้วใช้รูปนี้ — 3.14)

| ฟิลด์ | ชนิด | มาจาก |
|---|---|---|
| `_id` | string | `audit_event.id` · เอกสาร `audit_fallback` และ `http` ได้ UUID ใหม่ |
| `source` | `"audit_event"` \| `"audit_fallback"` \| `"http"` | ผู้เขียน |
| `schemaVersion` | int | `1` |
| `occurredAt` | Date | `occurred_at` · `audit_fallback` = เวลาที่ `logAudit` ล้ม **[ข้อเสนอ — สร้างตามนี้แล้ว]** · `http` = เวลา `res 'finish'` **[ข้อเสนอ]** |
| `action` | string | `action` · เอกสาร `http` = `"ADMIN_API_REQUEST"` |
| `category` | enum | ตาราง 3.5 · รหัสที่ไม่อยู่ในตารางได้ `other` |
| `result` | `SUCCESS` \| `FAILURE` | `result` · `http`: status < 400 = SUCCESS **[ข้อเสนอ]** |
| `actor.type` | `USER` `SYSTEM` `EXTERNAL` `ANONYMOUS` | `actor_type` |
| `actor.id` | string \| null | `actor_id` |
| `actor.name` | string \| null | ยกมาจาก `metadata.actor_name` |
| `actor.roles` | string[] | ยกมาจาก `metadata.actor_roles` (`[]` ถ้าไม่มี) |
| `actor.organizationId` | string \| null | ยกมาจาก `metadata.actor_organization_id` |
| `via` | `SESSION` `ADMIN_TOKEN` `LOG_TOKEN` `WORKER` `SCRIPT` `ANONYMOUS` | 3.4 |
| `tokenFp` | string \| null | แผนให้แค่ชื่อฟิลด์ — **[ข้อเสนอ]** `metadata.admin_token_fp` หรือ `metadata.token_fp` (ดูข้อจำกัดของแถวสรุปใน 3.7) |
| `subject.type` / `subject.id` | string / string \| null | `subject_type` / `subject_id` · `http` = `ADMIN_API` / null |
| `organizationId` | string \| null | `organization_id` |
| `requestNumber` | string \| null | ค้นจากตารางคำขอเมื่อ subject เป็นคำขอ ไม่เจอใช้ `metadata.request_number` **[ข้อเสนอ]** (จำเป็นกับ `REQUEST_DELETED`) |
| `gate` | string \| null | `after.taskType` ของแถวการตรวจ: `BDI_OFFICER_REVIEW` · `DATASET_SPECIALIST_REVIEW` · `ORGANIZATION_APPROVAL` · `BDI_FINAL_APPROVAL` |
| `before` / `after` | object \| null | `before_summary_json` / `after_summary_json` **ปิดข้อมูลแล้ว** (3.6) |
| `changedFields` | string[] | **[ข้อเสนอ]** ใช้ `metadata.fields_changed` เมื่อแถวมี (บวก `synced_from_account` และ `normalised_by_route` ถ้ามี) · แถวที่ `before`/`after` เป็น diff ใช้ union ของคีย์ชั้นบนสุด · แถวที่เก็บ**ทั้งแถว**หรือคนละรูป (`DATASET_CHOICE_CHANGED` UPDATE · `USER_ACCOUNT_DEACTIVATED` `{status, email, cid}`→`{status}` · `USER_ACCOUNT_REINSTATED` · `REQUEST_RESET_TO_DRAFT` · `APPROVER_INVITATION_RECALLED`) ต้องเทียบค่ารายคีย์ ไม่งั้นได้ชื่อฟิลด์ที่ไม่ได้เปลี่ยน · อย่างอื่น `[]` |
| `reason` | string \| null | **[ข้อเสนอ]** `metadata.reason` ถ้าเป็นสตริง โดยปิดเลข 13 หลัก — ระวัง: ค่านี้**ปนรหัสกับข้อความที่คนพิมพ์** (ตาราง “ความหมายของ reason” ใน 4.0) และข้อความที่ admin พิมพ์บางจุดอยู่คีย์อื่น (`admin_reason` `note` `after.reason`) ซึ่งฟิลด์นี้ไม่ยกมา |
| `metadata` | object \| null | `metadata_json` ปิดข้อมูลแล้ว และตัด `actor_*` ออก (`ip_unparsed` กับ `admin_token_fp` ยังอยู่) |
| `request.correlationId` | string | `correlation_id` |
| `request.reference` | string | 8 ตัวแรกของ correlation id — “รหัสอ้างอิง” ที่ผู้ใช้เห็นบน 5xx |
| `request.ip` / `request.userAgent` | string \| null | `ip_address` / `user_agent` · category ธุรกิจและ `log-access` ถูก `$unset` เมื่ออายุครบ 365 วัน ส่วน `auth` `session` `ADMIN_API_REQUEST` `*_TOKEN_REJECTED` ถูกลบทั้งเอกสารที่ 400 วัน (3.9) |
| `request.method` `route` `status` `durationMs` | string / string / int / int \| null | null สำหรับ `audit_event` · `audit_fallback` ที่สร้างแล้วมี `method` กับ `route` จากบริบท (3.14) · มีค่าครบเฉพาะ `http` — `route` เป็น template เมื่อคำขอจับคู่ route ได้ ส่วน 401 ของ token ผิดยังไม่ถึง route จึงเป็น**รูปแบบของ path** (แผนขั้น 8) |
| `sourceComponent` | string | `source_component` |
| `relatedUserIds` | string[] | คนที่แถวนี้เกี่ยวข้อง — **[ข้อเสนอ]** `actor.id` · `subject.id` เมื่อ subject เป็น `USER_ACCOUNT` · `metadata.user_account_id` `revoked_user_account_id` `transferred_user_account_id` · `after.userAccountId` (ผู้ได้ role ใน `ROLE_ASSIGNED` ที่ subject เป็น assignment และผู้ถูกเชิญใน `ACTIVATION_KEY_ISSUED`) · `before.userAccountId` (ผู้เสีย role ใน `ROLE_REVOKED` รูปแบบ A และ C) · `before`/`after.assignedSpecialistId` ตัดซ้ำ ใช้เป็น index ของ `person=` (ตารางเต็มของ “คนอยู่ตรงไหน” อยู่ที่ 2.10) · **ข้อจำกัด**: `ACTIVATION_KEY_ISSUED` ขา resend `INVITATION_DELETED` และ `APPROVER_INVITATION_RECALLED` ไม่มี id ของบัญชีเลย มีแค่อีเมลกับเลขบัตร และอีเมลบัญชีไม่ถูก hash (3.6) แถวเหล่านี้จึงไม่เข้า `person=` ด้วย id — **[ต้องตัดสิน]** ให้ relay ค้น id จากอีเมล หรือเพิ่ม `email#` ให้อีเมลบัญชีในแถวเหล่านี้ |
| `hashKeys` | string[] | `"cid#<hmac16>"` และ `"email#<hmac16>"` ของทุกค่าที่**สำเนาปิดเอง** (ค่าที่ Postgres ปิดมาแล้วไม่ได้ key — 3.6) · `[]` ถ้าไม่ตั้ง `LOG_HASH_KEY` |
| `mirroredAt` | Date | เวลาที่เขียนครั้งแรก (อยู่ใน `$setOnInsert`) |

เอกสาร `audit_fallback` ที่สร้างแล้วมีทุกฟิลด์ในตารางนี้**บวก** `fallback.errorEventId` — ค่าที่ต่างจากคอลัมน์ “มาจาก” อยู่ในตารางของ 3.14

### 3.3 แถว `audit_event` → เอกสาร `activity` (relay, `src/lib/activity-shape.ts` ขั้น 6) · [ออกแบบ]

| คอลัมน์ `audit.audit_event` | → ฟิลด์ `activity` | การแปลง |
|---|---|---|
| `id` | `_id` | คัดลอก |
| — | `source` · `schemaVersion` | `"audit_event"` · `1` |
| `occurred_at` | `occurredAt` | เป็น BSON Date |
| `actor_type` · `actor_id` | `actor.type` · `actor.id` | คัดลอก |
| `metadata_json.actor_name` / `actor_roles` / `actor_organization_id` | `actor.name` / `actor.roles` / `actor.organizationId` | ยกขึ้นมา แล้วลบออกจาก `metadata` |
| `action` | `action`, `category` | คัดลอก · category จากตาราง 3.5 |
| `subject_type` · `subject_id` | `subject.type` · `subject.id` | คัดลอก |
| `organization_id` | `organizationId` | คัดลอก |
| `result` | `result` | คัดลอก |
| `before_summary_json` | `before` | ปิดข้อมูล (3.6) |
| `after_summary_json` | `after`, `gate` | ปิดข้อมูล · `after.taskType` → `gate` |
| `ip_address` · `user_agent` | `request.ip` · `request.userAgent` | คัดลอก — user agent ถูกปิดเลขมาแล้วตั้งแต่ Postgres **เฉพาะแถวที่เขียนด้วยโค้ดที่มี `a0a0578`** (branch นี้ ยังไม่ merge) แถวที่ production (`main` ที่ `4eeb8d3`) เขียนเก็บ header ดิบ และ relay เติมจากแถวแรกสุด user agent เก่าจึงถึง Mongo โดยไม่ถูกปิด เพราะการปิดของสำเนา (แผน §7.6) ไม่แตะ UA — **[ต้องตัดสิน]** ให้ relay ผ่าน `storedUserAgent()` ซ้ำ |
| `correlation_id` | `request.correlationId`, `request.reference` | คัดลอก และ 8 ตัวแรก |
| `source_component` | `sourceComponent`, และใช้คำนวณ `via` | คัดลอก |
| `metadata_json` | `metadata` | ปิดข้อมูล ตัด `actor_*` · และเป็นที่มาของ `tokenFp` `reason` `requestNumber` (สำรอง) `relatedUserIds` `hashKeys` |
| (ค้นตารางคำขอ) | `requestNumber` | `findMany({id:{in}})` ครั้งเดียวต่อตารางต่อ batch |
| — | `request.method/route/status/durationMs` | `null` |
| — | `mirroredAt` | นาฬิกาของ relay |

### 3.4 `via` — มาทางไหน [ข้อเสนอ: แผนกำหนดแค่ค่าใน enum และ “SCRIPT = seed-demo / admin-script”] · [ออกแบบ]

ไล่ตามลำดับ ข้อแรกที่ตรงชนะ:

1. `sourceComponent` เป็น `seed-demo` หรือ `admin-script` → `SCRIPT`
2. `sourceComponent` เป็นของ worker หรือ job (`notification-worker`, `activation-expiry-job`) → `WORKER` — กฎเผื่ออนาคต
   วันนี้**ไม่มีแถวแบบนี้**: worker ไม่เขียน audit และ `activation-expiry-job` มีอยู่แค่ในคอมเมนต์ของ `schema.prisma`
3. `action` เป็น `AUDIT_LOG_READ` หรือ `ERROR_ISSUE_STATUS_CHANGED` → `LOG_TOKEN`
4. `sourceComponent = admin-portal` หรือมี `metadata.admin_token_fp` → `ADMIN_TOKEN`
5. `actor.type = ANONYMOUS` → `ANONYMOUS` — `ADMIN_TOKEN_REJECTED` และแถวก่อนล็อกอินที่ route ส่ง `ANONYMOUS` เอง
   **ไม่ใช่ทุกแถวก่อนล็อกอิน**: แถวที่ส่ง `actorId` ของบัญชีที่เพิ่งพิสูจน์ตัวตน (`LOGIN_SUCCEEDED` · `USER_ACCOUNT_ACTIVATED`
   `ACTIVATION_KEY_USED` `ROLE_ASSIGNED` ของ `/activate` · `PASSWORD_RESET_COMPLETED` ที่สำเร็จ) เป็น `USER` จึงตกไปข้อ 6 ได้
   `SESSION` ทั้งที่ยังไม่มี session และแถวก่อนล็อกอินที่เป็น `SYSTEM` ตกไปข้อ 7 (2.2)
6. `actor.type = USER` → `SESSION`
7. **[ต้องตัดสิน]** `actor.type = SYSTEM` ใต้ `web-portal` ไม่มีค่าใน enum — เกิดจริงกับ `ACTIVATION_KEY_EXPIRED`
   `SESSION_REVOKED` (LOGOUT, ROTATED) และ `ROLE_REVOKED` ของ `announceRoleReplacement()` บน `/activate`
   ข้อเสนอ: ใช้ `ANONYMOUS` เมื่อไม่มี actor หรือเพิ่มค่า `SYSTEM`

ข้อ 4 มาก่อนข้อ 6 โดยตั้งใจ: แถวที่ helper เขียนระหว่างคำสั่งของ admin มี `actor_type USER` (6.2)
ถ้าดูแค่ `actor.type` จะได้ `SESSION` ทั้งที่มาทาง admin token

**กฎชุดนี้ออกแบบจากแถวของโค้ดใน branch นี้ แต่ relay เติมจากแถวแรกสุด** และแถวบน production วันนี้ทุกแถวเขียนก่อนการ์ดนี้ (6.2):

- แถวของ admin token ก่อนการ์ดเป็น `SYSTEM` + `web-portal` และไม่มี `admin_token_fp` ข้อ 4 จับไม่ได้ จึงตกข้อ 7
- แถวของ helper ระหว่างคำสั่ง admin ก่อนการ์ด (เช่น `revokeSessionsFor()` ที่ actor = บัญชีเป้าหมาย) เป็น `USER` ไม่มี fingerprint จึงได้
  `SESSION` จากข้อ 6
- `LOGIN_FAILED` ก่อนการ์ด (ก่อน A5) เป็น `SYSTEM` จึงตกข้อ 7
- 42 แถว `request-service` (`SYSTEM` ไม่มี IP — การอัปโหลดไฟล์ที่หลุด context, 2.4) **ไม่ตรงข้อไหนเลย** เพราะข้อ 7 ระบุแค่ `web-portal`

**[ต้องตัดสิน]** ต้องมีข้อสุดท้ายที่รับทุกแถวที่เหลือ และต้องเลือกว่าจะให้ `via` ของแถวก่อน deploy ของการ์ด “ถูก” (ใช้วันที่ deploy
เป็นเกณฑ์ — 6.2) หรือประกาศว่า `via` ของแถวก่อนวันนั้นเชื่อไม่ได้

**ที่สร้างแล้ว — เอกสาร `audit_fallback` เท่านั้น** (`viaOf()` ใน `lib/audit-fallback.ts`) ดูจากบริบทของคำขอ ไม่ใช่จาก `sourceComponent` ของแถว:
มี `adminTokenFp` → `ADMIN_TOKEN` · `notification-worker` → `WORKER` · `seed-demo` / `admin-script` → `SCRIPT` · actor `ANONYMOUS` หรือไม่มี
`actorId` → `ANONYMOUS` · นอกนั้น `SESSION` — **ต่างจากแบบ:** ข้อ 7 ข้างบน (`SYSTEM` ใต้ `web-portal`) จึงได้ `ANONYMOUS` ชั่วคราว ไม่มี `LOG_TOKEN`
(ยังไม่มีรหัสของขั้น 7) และทุกแถวได้ค่าใดค่าหนึ่งเสมอ

### 3.5 ตาราง action → category · [ออกแบบ]

แผนระบุค่า category ไว้แต่**ไม่มีตารางรายรหัส** ที่แผนบอกเป็นนัยมีแค่กลุ่ม authentication log (§1),
`ADMIN_API_REQUEST` กับ `*_TOKEN_REJECTED` (ตาราง retention) และ `AUDIT_LOG_READ` ที่เหลือเป็น **[ข้อเสนอ]**
ซึ่งจะอยู่ใน `activity-shape.ts` ในขั้น 6 — retention ผูกกับ category (3.9) การเลือกจึงมีผลจริง

| category | รหัส |
|---|---|
| `auth` | `LOGIN_SUCCEEDED` · `LOGIN_FAILED` · `LOGIN_OTP_ISSUED` · `PASSWORD_RESET_REQUESTED` · `PASSWORD_RESET_COMPLETED` · `IDENTITY_VERIFICATION_STARTED` · `IDENTITY_VERIFIED` · `IDENTITY_VERIFICATION_FAILED` · `ADMIN_TOKEN_REJECTED` · `LOG_TOKEN_REJECTED` (ขั้น 7) |
| `session` | `SESSION_REVOKED` |
| `account` | `USER_ACCOUNT_CREATED` · `USER_ACCOUNT_ACTIVATED` · `USER_ACCOUNT_UPDATED` · `USER_ACCOUNT_SUSPENDED` · `USER_ACCOUNT_REINSTATED` · `USER_ACCOUNT_DEACTIVATED` · `USER_ACCOUNT_REACTIVATED` · `USER_IDENTITY_RELEASED` |
| `role` | `ROLE_ASSIGNED` · `ROLE_REVOKED` |
| `invitation` | `ACTIVATION_KEY_ISSUED` · `ACTIVATION_KEY_USED` · `ACTIVATION_KEY_REVOKED` · `ACTIVATION_KEY_EXPIRED` · `INVITATION_DELETED` · `APPROVER_INVITATION_RECALLED` |
| `organization` | `ORGANIZATION_CREATED` · `ORGANIZATION_UPDATED` · `ORGANIZATION_ACTIVATED` |
| `request` | `REQUEST_CREATED` · `REQUEST_DRAFT_SAVED` · `REQUEST_FORM_GENERATED` · `REQUEST_SUBMITTED` (ยกเว้นข้อล่าง) · `REQUEST_UPDATED` · `REQUEST_RESET_TO_DRAFT` · `REQUEST_CANCELLED` · `REQUEST_DELETED` |
| `review` | `REQUEST_ASSIGNED` · `REQUEST_APPROVED` · `REQUEST_RETURNED` · `REQUEST_REJECTED` · `SPECIALIST_COMMENT_RECORDED` · **`REQUEST_SUBMITTED` ที่มี `after.taskType`** |
| `document` | `ATTACHMENT_UPLOADED` · `ATTACHMENT_REPLACED` · `ATTACHMENT_DELETED` · `DOCUMENT_DOWNLOADED` · `DOCUMENT_SIGNED` · `DATA_EXPORTED` (ยังไม่มีใครเขียน) |
| `config` | `LEGAL_DOCUMENT_PUBLISHED` · `LEGAL_DOCUMENT_UPDATED` · `DATASET_CHOICE_CHANGED` |
| `log-access` | `AUDIT_LOG_READ` · `ERROR_ISSUE_STATUS_CHANGED` (ขั้น 7) |
| `admin-access` | `ADMIN_API_REQUEST` (ขั้น 8, อยู่ใน Mongo อย่างเดียว) |
| `other` | รหัสใดที่ไม่อยู่ในตารางนี้ — ตารางนี้ครอบรหัส `AuditAction` ครบทั้ง 51 ตัวของ `2cab0a7` (บวกสี่รหัสของขั้น 7–8) จึงยังไม่มีแถวที่รู้จักแถวไหนตกมาที่นี่ category ตัดสินจาก `action` ไม่ใช่ `source_component` แถว `admin-script` หกแถวบน production (`ACTIVATION_KEY_ISSUED` 3 · `IDENTITY_VERIFIED` 3) จึงได้ `invitation` และ `auth` ตามรหัส |
| `system` | ยังไม่มีรหัสใดใช้ **[ต้องตัดสิน]** |

ข้อที่ต้องระวัง:

- **`REQUEST_SUBMITTED` มีสองความหมาย** การนำส่งจริงมี `after = {requestNumber}` แต่การตรวจคำขอ
  หน่วยงานที่ผ่านด่านที่ยังไม่ใช่ด่านสุดท้ายก็เขียนรหัสนี้ด้วย `after = {taskType, result, note}` (4.9)
  category ต้องดู `after.taskType` ไม่ใช่ดูแค่รหัส
- **[ต้องตัดสิน]** แผน §1 จัด `ACTIVATION_KEY_USED` / `ACTIVATION_KEY_EXPIRED` ไว้ใน authentication log
  ถ้าเป็น `auth` จะถูกลบที่ 400 วันและตัดวงจรชีวิตของคีย์ออกเป็นสองท่อน ตารางนี้เสนอ `invitation`
- **[ต้องตัดสิน]** `REQUEST_ASSIGNED` อยู่ใน `review` หรือ `request` ก็อธิบายได้ทั้งคู่

**ตารางชั่วคราวที่สร้างแล้ว** (`CATEGORY_RULES` ใน `lib/audit-fallback.ts`) ใช้กับเอกสาร `audit_fallback` เท่านั้น จนกว่าตารางจริงจะไปอยู่ใน
`activity-shape.ts` ขั้น 6 — จับด้วย prefix ของรหัส และ**ต่างจากตารางข้างบน**สี่จุด: `ACTIVATION_KEY_*` เป็น `account` (ข้างบนเสนอ `invitation`) ·
`REQUEST_SUBMITTED` เป็น `request` เสมอแม้มี `after.taskType` · `REQUEST_ASSIGNED` เป็น `request` · `ERROR_ISSUE_STATUS_CHANGED` (ขั้น 7) จะได้ `other`
รหัสที่ขึ้นต้นด้วย prefix ที่ตารางไม่รู้จักได้ `other` · สามข้อ [ต้องตัดสิน] ข้างบนจึงยังเปิดอยู่ ตารางชั่วคราวแค่เลือกไว้ก่อน

### 3.6 การปิดข้อมูลในสำเนา และ `hashKeys` · [ออกแบบ]

ทำใน `src/lib/redact.ts` + `activity-shape.ts` **Postgres ไม่ถูกแตะ** — ส่วนที่ไม่ต้องใช้กุญแจสร้างแล้วเป็น `maskForLogStore()` และ
`maskedTypedEmail()` ใน `lib/redact.ts` ซึ่งเอกสาร `audit_fallback` ใช้อยู่ (3.14 — **ต่างจากตารางนี้**: เลข 13 หลักในข้อความทุกค่ากลายเป็น `[cid]`
ทั้งก้อน ไม่ใช่เหลือ 4 ตัวท้าย) · `hashKeys` และการใช้กับสำเนาของทุกแถวรอขั้น 6

| อะไร | อยู่ที่ไหน | รูปในสำเนา | hash key |
|---|---|---|---|
| คีย์ที่ถือเลขบัตรใน `before` `after` `metadata` (ชื่อตรง `/cid$\|nationalid\|^pid$/i`) — แผนระบุแค่รูปของชื่อคีย์ การไล่ **ทุกระดับความลึก** เป็น **[ข้อเสนอ]** ให้ตรงกับ `sanitizeValue()` ของ Postgres | เช่น `cid`, `approverCid`, `userCid`, `userAccount.cid` ข้างใน object, `signatoryNationalId`, `pid` | `{"masked":"xxxxxxxxx1234"}` (4 ตัวท้าย) | `cid#<hmac16>` |
| `thaid_subject` | `metadata` ของ `IDENTITY_VERIFIED`, `IDENTITY_VERIFICATION_FAILED` (CID_MISMATCH), `LOGIN_FAILED` (THAID_NO_MATCHING_ACCOUNT) | เหมือนข้างบน — `sub` ของ DOPA คือเลข 13 หลักไม่ว่า `THAID_USE_PID` เป็นอะไร | `cid#<hmac16>` |
| เลข 13 หลักในข้อความอิสระ | แผนเขียนว่า “`note` และ `reason`” — **[ข้อเสนอ]** ตีความเป็น `after.note` ของการตรวจและของ `SPECIALIST_COMMENT_RECORDED` · `metadata.note` (recall) · `metadata.reason` · `after.reason` · `metadata.admin_reason` (ข้อความที่ admin พิมพ์ใน `SESSION_REVOKED` ของการบังคับออก ซึ่ง `metadata.reason` เป็นรหัส `LOGOUT_ALL`) · `suspensionReason` | ปิดเหลือ 4 ตัวท้าย **[รูปแบบเป็นข้อเสนอ]** | ไม่ได้ระบุ |
| อีเมลที่ **พิมพ์มา**ตอนล็อกอิน | **เฉพาะ** `LOGIN_FAILED.metadata.email` | `{"masked":"so***@example.go.th"}` (2 ตัวแรกของ local part) | `email#<hmac16>` |
| คง**ไว้**ตามเดิม | อีเมลของบัญชี (เช่น `PASSWORD_RESET_REQUESTED.metadata.email`) ชื่อ เบอร์โทร | — | — |
| IP และ user agent | `request.ip` `request.userAgent` | คงไว้ · category ธุรกิจและ `log-access` `$unset` เมื่อครบ 365 วัน · `auth` `session` `ADMIN_API_REQUEST` `*_TOKEN_REJECTED` ลบทั้งเอกสารที่ 400 วัน (3.9) · user agent ของแถวก่อน `a0a0578` ยังไม่ถูกปิดเลข (3.3) | — |
| `actor_*` | `metadata` | ย้ายไป `actor` แล้วลบออก | — |

- `hashKeys` คือ `"cid#"` หรือ `"email#"` ตามด้วย 16 ตัวฐานสิบหกของ HMAC ที่ใช้กุญแจ `LOG_HASH_KEY`
  ทำให้ `?cid=` `?email=` หาเจอโดยไม่ต้องเก็บค่าจริง **[ต้องตัดสิน]** อัลกอริทึม (สมมติ HMAC-SHA256 ตัด 16 ตัว)
  และการ normalise อีเมลก่อน hash (lowercase, trim) ยังไม่ได้เขียนไว้ — `?email=` ขึ้นกับข้อนี้
- ไม่ตั้ง `LOG_HASH_KEY` = ปิดอย่างเดียว `hashKeys` ว่าง และตอบ 503 `hash_search_unavailable` กับ `?cid=` **ทุกกรณี** (cid จับคู่
  ด้วย HMAC อย่างเดียว ไม่เคยค้นผ่านบัญชี) และกับ `?email=` ของคนที่ไม่มีบัญชี (อีเมลที่มีบัญชีค้นผ่าน id ได้) — boot เตือนไว้และ
  `/status` แสดง `hashKey: "missing"`
- เปลี่ยนกุญแจเมื่อไรต้อง rebuild — แต่ rebuild สร้างใหม่ได้**เฉพาะ** `source:"audit_event"` เอกสาร `audit_fallback` และ `http` ไม่มีใน
  Postgres จึงค้าง `hashKeys` ของกุญแจเก่าไว้ และ `?cid=` `?email=` หาไม่เจออีก เช่นเดียวกับแถวที่ `seed:demo` ลบจาก Postgres ไปแล้ว
  (หายจากสำเนาถาวรถ้า rebuild) **[ต้องตัดสิน]** คำนวณ `hashKeys` ของสองแหล่งนั้นใหม่ในที่ หรือยอมรับข้อจำกัดนี้
- **ค่าที่ถูกปิดมาแล้วใน Postgres** (`{"masked":"…1234","changed":true}` จาก `sanitizeDiff()` /
  `sanitizeState()`) ต้อง**ผ่านไปทั้งก้อน** — ถ้าปิดซ้ำด้วย `String(value)` จะได้ `"[object Object]"` ที่ถูกปิด
  และสำเนาสร้าง `cid#` จากค่าที่เหลือ 4 ตัวไม่ได้ `?cid=` จึง**หาแถวเหล่านี้ไม่เจอ**: `REQUEST_DRAFT_SAVED`
  ของคำขอหน่วยงาน (`approverCid` `userCid`) · `USER_ACCOUNT_CREATED` ทั้งสองจุด · `ACTIVATION_KEY_ISSUED`
  ของคำเชิญผู้มีอำนาจฯ

### 3.7 ตัวอย่างเอกสาร (ข้อมูลสมมติ) · [ออกแบบ]

**แถวใน 2.9 หลังผ่าน relay** — ค่าที่ถูกปิดใน Postgres แล้วผ่านไปตามเดิม จึงไม่มี `cid#`:

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
  "tokenFp": null,
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

**เอกสาร `audit_fallback`** — สร้างแล้ว ตัวอย่างเต็มและค่าที่ต่างจากแถวที่ relay จะคัดลอกอยู่ใน 3.14 · ที่มาจาก `logAudit` ที่ล้มชี้ไปที่
`error_events` คู่ของมัน (tag `audit.write-failed`) ด้วย `fallback.errorEventId` แต่ไม่เสมอไป: event ติดเพดาน 50 ตัวต่อ fingerprint ต่อชั่วโมงและ 600
ตัวต่อ process ต่อนาที และไม่ถูกเก็บเลยตอนเกินเพดานขนาด ขณะที่สำเนาอยู่ชั้นบนสุดของคิวและยังเขียนตอนเกินเพดาน (5.7) — ตอน Postgres ล่มนาน ๆ
สำเนาส่วนใหญ่จึงมี `errorEventId: null` และ id ที่ไม่ null ก็อาจชี้ event ที่ไม่เคยถูกเขียน (ตารางใน 3.14) · fallback ของ `recordLogRead()` (ขั้น 7 [ออกแบบ]) แผนไม่ได้บอกว่ามี `error_events` คู่ · `actor.name` /
`actor.roles` ว่างเมื่อการอ่าน snapshot เป็นขั้นที่ล้ม · `captureError` ไม่เรียก `logAudit` กลับ (ไม่วนซ้ำ)

**เอกสาร `http` (ขั้น 8)** — แผนกำหนดแค่ `action "ADMIN_API_REQUEST"` · `category "admin-access"` · `via=ADMIN_TOKEN` เมื่อ token
ผ่าน · route template status และ `tokenFp` · 401 ได้เอกสารที่มี**รูปแบบของ path** (ยังไม่ถึง route จึงไม่มี template) ·
**ค่าใน query string ไม่ถูกเก็บ** `?cid=` เหลือแค่ `cid#` ใน `hashKeys` ที่เหลือเป็น **[ข้อเสนอ]**: `actor.type SYSTEM` ·
`subject {type:"ADMIN_API", id:null}` · การเก็บชื่อคีย์ของ query · `sourceComponent` ตาม context ซึ่งที่ `2cab0a7` เปลี่ยนเป็น
`admin-portal` **เฉพาะหลัง token ผ่าน** (`middleware/auth.ts:171-179`) เอกสารของ 401 จึงเป็น `web-portal` · `via` ของ 401
**[ต้องตัดสิน]**: ถ้าใช้กฎ 3.4 ตรง ๆ จะตกข้อ 7 (`SYSTEM` ใต้ `web-portal`) ไม่ใช่ `ANONYMOUS` — ข้อเสนอ: ให้เอกสาร `http` ที่
status 401 เป็น `actor.type ANONYMOUS` ข้อ 5 จึงให้ `ANONYMOUS`:

```json
{
  "_id": "e2b7c9d4-1f3a-4b5c-9d6e-7f8a9b0c1d2e", "source": "http", "schemaVersion": 1,
  "occurredAt": { "$date": "2026-10-16T04:11:09.870Z" },
  "action": "ADMIN_API_REQUEST", "category": "admin-access", "result": "SUCCESS",
  "actor": { "type": "SYSTEM", "id": null, "name": null, "roles": [], "organizationId": null },
  "via": "ADMIN_TOKEN", "tokenFp": "7c1e0f9a2b4d",
  "subject": { "type": "ADMIN_API", "id": null },
  "organizationId": null, "requestNumber": null, "gate": null,
  "before": null, "after": null, "changedFields": [], "reason": null,
  "metadata": { "queryKeys": ["cid"] },
  "request": { "correlationId": "1f2e3d4c-5b6a-4798-8a7b-6c5d4e3f2a1b", "reference": "1f2e3d4c",
               "ip": "198.51.100.7", "userAgent": "PostmanRuntime/7.43.0",
               "method": "GET", "route": "/api/admin/users", "status": 200, "durationMs": 38 },
  "sourceComponent": "admin-portal", "relatedUserIds": [], "hashKeys": ["cid#5d0e8b3a91c47f26"],
  "mirroredAt": { "$date": "2026-10-16T04:11:11.902Z" }
}
```

**[ต้องตัดสิน]** บน 401 context ยังไม่มี `adminTokenFp` เอกสาร `http` จึงได้ `tokenFp: null` fingerprint ของ
token ที่ส่งมามีอยู่แค่ในแถว `ADMIN_TOKEN_REJECTED` คู่กัน และแถวสรุปของ `ADMIN_TOKEN_REJECTED` มี
`token_fps[]` ไม่ใช่ `token_fp` ฟิลด์ `tokenFp` แบบค่าเดียวจึงหา “การใช้ token เก่า” ในแถวสรุปไม่เจอ —
ควรเป็น array

### 3.8 relay — ทางเขียน `activity` (`src/workers/log-relay.ts`, เริ่มจาก `main()` ของ `delivery.ts`) · [ออกแบบ]

loop ของตัวเองทุก 5 วินาที แยกจาก loop อีเมล มี try/catch ของตัวเอง tick ไม่ซ้อนกัน และทุกการเรียก
Prisma/Mongo มี timeout

1. **Forward pass** เริ่มจาก `relay_state.cursor {at, id}` อ่านแถว `occurred_at ≤ now − 2 วินาที` เรียงตาม
   `(occurred_at, id)` ทีละ 500 แถว ไม่เกิน 20 หน้าต่อ tick บันทึก cursor หลังทุกหน้า (ต้องมี index
   `(occurred_at, id)` ซึ่ง migration ของขั้น 6 เพิ่ม)
2. **Tail pass** อ่านซ้ำแถว `occurred_at > now − 120 วินาที` ไม่เกิน 10 หน้า เก็บแถวที่ commit ช้ากว่าเวลาของมัน — รวมถึงแถวที่
   `occurred_at` มาจากนาฬิกาของ process อื่นที่เดินช้ากว่า (2.1: ค่ามาจาก process ที่เขียน ไม่ใช่จาก Postgres) ถ้านาฬิกาของ
   backend หลาย replica หรือของ worker ต่างกันเกิน 120 วินาที แถวอาจหลุดจาก cursor และรอ reconcile รายชั่วโมง
3. แปลงและปิดข้อมูล (3.3, 3.6) ค้นเลขที่คำขอเป็น batch
4. `bulkWrite` ของ `updateOne({_id}, {$setOnInsert: doc}, {upsert: true})` แบบ `ordered: false` — อ่านซ้ำกี่รอบ
   ก็ไม่เปลี่ยนอะไร relay สองตัวซ้อนกันระหว่าง deploy ก็ไม่เสียหาย
5. **Reconcile ทุกชั่วโมง** เทียบจำนวน 24 ชั่วโมงล่าสุด Mongo น้อยกว่า = สแกนช่วงนั้นซ้ำ มากกว่า = ปกติหลัง
   `seed:demo` ลบ Postgres แค่รายงาน
6. **Rebuild** (เปลี่ยน projection หรือหมุน `LOG_HASH_KEY`): `deleteMany({source:"audit_event"})` แล้วลบ
   `relay_state` relay จะเติมใหม่ตั้งแต่ต้น **[ต้องตัดสิน]** เพราะ `$setOnInsert` ไม่แก้เอกสารเดิม rebuild จะ
   นำเอกสารที่ถูก prune ไปแล้ว (และ IP/UA ที่เกิน 365 วัน) กลับมาจนกว่า prune รอบถัดไปจะวิ่ง · rebuild ไม่แตะ `audit_fallback` และ
   `http` (สร้างใหม่ไม่ได้ ดู 3.6) และทำให้เอกสารของแถวที่ `seed:demo` ลบจาก Postgres ไปแล้ว**หายถาวร**

เอกสาร `relay_state` มีใบเดียว:

```json
{
  "_id": "audit_event",
  "cursor": { "at": { "$date": "2026-10-16T04:12:30.004Z" }, "id": "ffe1d2c3-b4a5-4968-8776-655443322110" },
  "lastRunAt": { "$date": "2026-10-16T04:12:35.010Z" },
  "lastBatch": 3,
  "lastError": null,
  "lastPruneAt": { "$date": "2026-10-15T20:00:00.412Z" },
  "lastReconcileAt": { "$date": "2026-10-16T04:00:00.233Z" },
  "storageMb": 41.7,
  "allocatedMb": 58.2,
  "maxMb": 5120,
  "overQuota": false,
  "quotaCheckedAt": { "$date": "2026-10-16T04:00:05.118Z" }
}
```

อยู่ใน Mongo โดยตั้งใจ: ล้าง Mongo = ล้าง cursor = relay เติมใหม่จากต้นเอง ไม่มี index รอง ไม่ถูก prune · **ที่มีแล้ววันนี้** มีแค่ `storageMb`
`allocatedMb` `maxMb` `overQuota` `quotaCheckedAt` ซึ่งตัวตรวจเพดานของ worker เขียนด้วย `$set` + upsert (5.9) ฟิลด์ของ relay (`cursor` `lastRunAt`
`lastBatch` `lastError` `lastPruneAt` `lastReconcileAt`) ต้องเขียนด้วย `$set` เช่นกันจะได้ไม่ทับกัน

### 3.9 index และ retention · [ออกแบบ] (index ของ collection error สร้างแล้ว)

index ของ `error_events` `error_issues` `runtime_events` **สร้างแล้ว** — `workers/log-upkeep.ts` สร้างตอนบูตทีละตัวตามแบบนี้พอดี (5.2 5.3 5.5 5.9)
ส่วนของ `activity` ยังไม่มีแม้ collection จะมีเอกสาร `audit_fallback` แล้ว (ขั้น 6)

index ของ `activity` (worker สร้างด้วย `ensureIndexes()` ตอนบูต ทีละตัว ตัวไหนล้มแค่เตือนแล้วไปต่อ ไม่มี
partial/sparse/`$text`):

`{occurredAt:-1,_id:-1}` · `{"subject.type":1,"subject.id":1,occurredAt:-1}` · `{relatedUserIds:1,occurredAt:-1}` ·
`{"actor.id":1,occurredAt:-1}` · `{organizationId:1,occurredAt:-1}` · `{action:1,occurredAt:-1}` ·
`{category:1,result:1,occurredAt:-1}` · `{requestNumber:1,occurredAt:-1}` · `{"request.correlationId":1}` ·
`{hashKeys:1,occurredAt:-1}` · `{tokenFp:1,occurredAt:-1}` — การค้นด้วยรหัสอ้างอิง 8 ตัวใช้ regex แบบยึดหัว
บน `request.correlationId`

**วันนี้ยังไม่มี prune ใด ๆ ใน Mongo** — retention เป็น job รายวัน 03:00 น. ใน worker (ไม่ใช้ TTL index) ค่าอยู่ใน `src/lib/log-retention.ts`
BDI ยืนยันตัวเลขได้ (คำถาม Q3 ในแผน):

| เอกสาร | กติกา |
|---|---|
| `activity` category `account` `role` `invitation` `organization` `request` `review` `document` `config` `log-access` | **ไม่ลบ** · `$unset` `request.ip` และ `request.userAgent` เมื่อครบ 365 วัน |
| `activity` category `auth` `session` · `ADMIN_API_REQUEST` · `*_TOKEN_REJECTED` | ลบเมื่อครบ 400 วัน |
| `activity` category `system` `other` | **[ต้องตัดสิน]** ข้อเสนอ: ถือเป็นธุรกิจ ไม่ลบ |
| `error_events` | 90 วัน (`service:"browser"` 30 วัน) |
| `error_issues` | 365 วันหลัง `lastSeen` เว้นแต่ยัง `open` |
| `runtime_events` | 90 วัน |
| Postgres `audit_event` | **ไม่เปลี่ยน — ไม่มี retention** |

เพดานขนาด `LOG_STORE_MAX_MB` (production 5120 MB ที่อื่น 512 MB) **สร้างแล้ว — 5.9** · **ต่างจากแบบ:** เทียบขนาดข้อมูล + index ที่ใช้อยู่จริง
ไม่ใช่ `storageSize` และไม่มีอีเมลเตือน (มีแค่บรรทัด log กับ warning `log-store:over-quota`) · ระหว่างเกินเพดาน `error_events` เหลือแค่ตัวนับของ
`error_issues` ส่วน `runtime_events` และ `audit_fallback` ยังเขียน (ตอบ [ต้องตัดสิน] เดิม) · [ออกแบบ] relay ยังเขียน `activity` ต่อ (โตราว 40 MB/ปี)
และเอกสาร `http` ไม่ถูกเก็บ

### 3.10 เมื่อ MongoDB ไม่พร้อม · สร้างแล้ว (ยกเว้นส่วนที่ติดป้าย)

| สถานการณ์ | ผล |
|---|---|
| Mongo ล่ม | คำขอของผู้ใช้และ loop อีเมลไม่กระทบ · error, `runtime_events` และสำเนา `audit_fallback` ค้างในคิว (≤ 500 รายการ / 2 MB ต่อ process) ถอยห่างเป็นเท่าตัวจนถึง 60 วินาที และบรรทัด `[capture]` ยังพิมพ์ทุกตัว (ยกเว้นที่ไม่พิมพ์อยู่แล้ว: `http.request-body` · `log-store.over-quota` — 5.8) · คิวล้นแล้วทิ้งตามชั้น หลังฟื้นมี event สรุป “ทิ้งไป N รายการ” (5.7) · `/health/ready` แสดง `logStore:{status:"down"}` ภายในรอบตรวจ 30 วินาที แต่ยังตอบ 200 · [ออกแบบ] relay หยุดแล้วตามต่อจาก cursor โดยไม่หาย · API อ่าน log ตอบ 503 `log_store_unavailable` ภายในราว 3 วินาที |
| Mongo ช้า | driver ตั้ง `serverSelectionTimeoutMS 2000` `connectTimeoutMS 2000` `socketTimeoutMS 5000` `maxPoolSize` 5 (backend) / 3 (worker) · ตรวจสถานะรอบละไม่เกิน 6 วินาที · health อ่านสถานะที่จำไว้ probe จึงไม่รอ Mongo · ก้อน flush ไม่มี timeout ครอบ เกิน 15 วินาทีได้บรรทัดเตือนและก้อนใหม่ไม่เริ่มซ้อน — ตัวนับของ issue อาจนับซ้ำทั้งก้อน (5.7) · งานดูแลของ worker เลิกรอหลัง 45 วินาทีแต่ไม่ได้ยกเลิกงานที่ค้าง (5.9) · [ออกแบบ] คิวรีอ่านของ API `maxTimeMS 5000` · tick ของ relay ที่ timeout ถูกข้าม อีเมลยังเดิน |
| container `mongo` เริ่มไม่ขึ้น (รวมด่านปฏิเสธรหัสผ่านบน production — 3.12) | ไม่มีอะไรพึ่งมัน backend worker และ frontend เริ่มตามปกติ · backend บูตช้าลงไม่เกินราว 3 วินาที (รอผลตรวจแรก) · สถานะ `down` |
| โหลดแพ็กเกจ `mongodb` ไม่ได้ | โหลดด้วย `import()` เฉพาะเมื่อเปิดใช้ ความล้มเป็นสถานะ `down` กับบรรทัด `[log-store]` · loop อีเมลกับ backend ทำงานต่อ |
| เกินเพดานขนาด | เก็บแค่ตัวนับของ issue · `runtime_events` และ `audit_fallback` ยังเขียน · `/ready` แสดง `logStore:{status:"over_quota"}` (5.9) |
| ไม่ตั้ง `LOG_HASH_KEY` | [ออกแบบ] ขั้น 6: boot เตือน · `/status` แสดง `hashKey:"missing"` · `?cid=` ทุกกรณี และ `?email=` ของคนที่ไม่มีบัญชี ตอบ 503 (3.6) — วันนี้ตัวแปรนี้ยังไม่มีใน `env.ts` และ `hashKeys` ของ `audit_fallback` ว่างเสมอ |
| Postgres ล่ม | `logAudit` ที่ล้มได้ error `audit.write-failed` + สำเนา `audit_fallback` (3.14) · error P1001 ของคำขอเก็บเป็น error `prisma:P1001:<METHOD route>` ตอบ 503 พร้อมรหัสอ้างอิง · `/health/ready` ตอบ 503 เพราะ database · [ออกแบบ] relay หยุดและรายงานความล่าช้า · การอ่าน log ถูกบันทึกลง Mongo แทน ถ้าล่มทั้งคู่ API อ่านตอบ 503 `log_read_unrecorded` |
| `LOG_STORE_ENABLED=false` | ไม่โหลด driver เลย · `/ready` แสดง `disabled` · `captureError` ยังพิมพ์บรรทัด `[capture] … event=- (log store ปิดอยู่)` · ไม่มีคิว ไม่มี `runtime_events` ไม่มี `audit_fallback` — แถวที่ Postgres ไม่รับเหลือแค่บรรทัดนั้น ซึ่งมีแค่ระดับ รหัสอ้างอิง fingerprint route และหัวเรื่องกับเฟรมของ error **ไม่มี action subject หรือผู้กระทำของแถว** สิ่งที่แถวบันทึกจึงหายทั้งหมด (2.8) · worker ไม่เริ่มงานดูแล · [ออกแบบ] API อ่าน 503 `log_store_disabled` |
| worker ล่ม | ไม่มีใครสร้าง index และตรวจเพดาน ธง `overQuota` ค้างค่าเดิม · อีเมลในคิวหยุด · คำขอไม่กระทบ · [ออกแบบ] relay ล่าช้า การแจ้งเตือนหยุด |
| ปิด process (deploy) | backend `shutdown()`: `server.close()` → บันทึก `shutdown` → แถวสรุปของ token ≤ 2 วินาที → คิว ≤ 2 วินาที → ปิด Mongo ≤ 1.5 วินาที → `prisma.$disconnect()` → exit · worker `stop()`: หยุด loop → หยุดงานดูแล → บันทึก `shutdown` → คิว → ปิด → disconnect — ทั้งคู่อยู่ในเวลา 10 วินาทีของ compose · handler ทำงานเฉพาะเมื่อ SIGTERM ถึง node: worker ของ prod overlay รันแบบ exec form (node เป็น PID 1) ส่วน backend ของ prod overlay รันผ่าน `sh -c "npx prisma migrate deploy && node dist/index.js"` บน `node:22-alpine` — node ได้สัญญาณก็ต่อเมื่อ ash `exec` คำสั่งสุดท้ายของ `&&` **[ยังไม่ได้ลอง]** ถ้าไม่ SIGTERM ค้างที่ `sh` แล้ว compose `SIGKILL` ที่ 10 วินาที: ไม่มีบันทึก `shutdown` คิวและแถวสรุปของ token หาย (5.10) |

### 3.11 การอ่าน (ขั้น 7) · [ออกแบบ]

`/api/admin/logs/*` ใช้ token แยก (`x-log-token` = `LOG_READ_TOKEN` ไม่ตั้ง = 503 `log_access_disabled`) และต้องมี `x-log-reader`
(อีเมล ASCII ไม่เกิน 100 ตัว — แค่ประกาศ ไม่ได้พิสูจน์) กับ `x-log-reason` (10–500 ตัว percent-encoded ห้ามอยู่ใน URL) บน activity ·
timeline · trace **ทุกการอ่านถูกบันทึกก่อนส่งข้อมูล** เป็น `AUDIT_LOG_READ` ใน Postgres (ถ้าเขียนไม่ได้ลง Mongo `audit_fallback`
ภายใน 2 วินาที ถ้าไม่ได้ทั้งคู่ตอบ 503 `log_read_unrecorded`) ทุกคำตอบมี `readId` token ผิดตอบ 401 พร้อม `LOG_TOKEN_REJECTED`
แบบ throttle ส่วน `GET /status` ไม่ถูกบันทึกเพราะไม่มีข้อมูลบุคคล router นี้มี 404 ของตัวเอง path ที่พิมพ์ผิดจึงไม่ไปเขียน
`ADMIN_TOKEN_REJECTED` และ proxy ของหน้าเว็บตอบ 404 ให้ทุก `/api/admin/logs*` รายละเอียดของรหัสอยู่ที่ 4.13

**ตัวระบุที่เซิร์ฟเวอร์แปลงให้**: `person` = uuid หรืออีเมล (อีเมลที่มีบัญชี → id ของบัญชี ไม่มีบัญชี → HMAC `email#`) ·
`request` = uuid หรือเลขที่คำขอ · `organization` = uuid หรือ `organization_code` · `cid` = เลข 13 หลัก จับด้วย HMAC อย่างเดียว

**ข้อตกลงร่วม**: zod แบบ strict (ผิด = 400 `{error:"validation", fields}`) · `page` เริ่ม 1 · `pageSize` 50 สูงสุด 200 · เรียง
`occurredAt desc, _id desc` · `from` `to` เป็น ISO 8601 ที่มี offset ช่วงไม่เกิน 366 วัน ค่าตั้งต้น 30 วันเมื่อไม่มีตัวกรองที่แคบลง ·
`total` จาก `countDocuments` ตัดที่ 10,000 พร้อม `totalIsLowerBound`

| endpoint | พารามิเตอร์ | คืน |
|---|---|---|
| `GET /activity` | `action` (CSV) `category` `result` `via` `person` `actorId` `subjectType`+`subjectId` `request` `organization` `cid` `email` `tokenFp` `correlationId` (เต็ม หรือ hex 8 ตัวขึ้นไป) `source` `from` `to` `page` `pageSize` | `{events, total, totalIsLowerBound, page, pageSize, readId}` — เอกสาร 3.2 ที่ `_id`→`id` บวก `occurredAtBangkok` |
| `GET /activity/:id` | — | `{event, readId}` |
| `GET /timeline` | `person` **หรือ** `request` **หรือ** `organization` อย่างใดอย่างหนึ่ง · `from`/`to` (ค่าตั้งต้น: ทั้งชีวิตของคำขอ อย่างอื่น 7 วัน) | `{items:[{type:"activity"\|"error", …}] (เรียงเก่าไปใหม่ ≤ 500), truncated, readId}` |
| `GET /trace/:ref` | uuid หรือ hex 8–36 ตัว | `{correlationId, actors[], mixedActors, activity[≤200], errors[≤50], deliveries[], integrations[], readId}` — `deliveries`/`integrations` อ่านจาก Postgres ด้วย correlation id ตรงตัว · prefix กำกวม = `{ambiguous:true, candidates[≤10]}` · `mixedActors:true` เตือนว่า id เดียวกันมาจากหลาย actor (2.5) |
| `GET /errors/issues` · `/errors/issues/:fingerprint` · `/errors/events/:id` | `status` (ตั้งต้น `open`) `service` `level` `release` `since` `sort` · `events` (20 สูงสุด 100) | issue · เหตุการณ์ล่าสุด · เหตุการณ์เดียว พร้อม `readId` |
| `PATCH /errors/issues/:fingerprint` | body `{status, reason}` | `{issue}` + แถว `ERROR_ISSUE_STATUS_CHANGED` — ต้องตั้ง `status` `statusChangedAt` `statusReason` ครบ ไม่งั้นการเปิดกลับเมื่อเกิดซ้ำไม่ทำงาน (5.4) |
| `GET /status` | — | `{logStore:{status, buffered, dropped, relayLagSeconds, hashKey, storageMb, overQuota}, release}` — `buffered` `dropped` ต้องมีตัวอ่านใหม่ใน `lib/error-capture.ts` (วันนี้ตัวนับอยู่ในโมดูลแต่ไม่มีทางอ่านจากนอก) และควรแสดง `allocatedMb` คู่กับ `storageMb` (5.9) |

Postman collection แยก `docs/bdi-activity-log.postman_collection.json` (ไม่แจกพร้อม admin token) มีคำขอสำเร็จรูป G1 ค้นหากิจกรรม ·
G2 ทุกอย่างของบุคคลนี้ (ด้วยอีเมล) · G3 เส้นเวลาของคำขอ (ด้วยเลขที่คำขอ) · G4 ล็อกอินที่ล้มเหลวของอีเมลนี้ · G5 งานผ่าน admin
token สัปดาห์นี้ · G6 ไล่ตามรหัสอ้างอิง · G7 ใครเปิดอ่าน log · G8 การใช้ token ที่ถูกหมุนแล้ว (`tokenFp=<fp เก่า>`) · E1–E4 ของ error ·
S1 สถานะ — เมื่อขั้น 7 เสร็จ คำถาม “คนนี้ทำอะไร เมื่อไร เปลี่ยนอะไร” คือ G2 หรือ `timeline?person=` แทนคิวรีใน 2.10 · **จนกว่าจะถึงวันนั้น**
อ่าน Postgres ด้วย `psql` (2.10) และอ่าน Mongo ด้วย `mongosh` (5.11)

### 3.12 service `mongo` — การติดตั้ง รหัสผ่าน และด่านปฏิเสธ · สร้างแล้ว

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
`mongodb-backend-uri` / `mongodb-worker-uri` เพราะสอง process ใช้คนละผู้ใช้ (**ต่างจากแบบ:** แผนมี `mongodb-uri` ตัวเดียว — docs/20 ยังไม่ได้แก้) ·
`DEPLOY_ENV=azure` · ระหว่างปิด stdout ของ container ไปถึง Log Analytics อยู่แล้ว · ไฟล์ Azure ทั้งสอง**ไม่มี** `LOG_STORE_MAX_MB` วันที่เปิด log store
เพดานจึงเป็นค่าตั้งต้นของ `env.ts` ที่ `NODE_ENV=production` คือ 5120 MB — ถ้าบริการที่เลือกมีโควตาต่ำกว่านั้นต้องตั้งค่านี้ในทั้งสองไฟล์

### 3.13 การเชื่อมต่อ สถานะใน `/health/ready` และสวิตช์ปิด (`lib/log-store.ts`) · สร้างแล้ว

- **เปิดเมื่อ** `LOG_STORE_ENABLED` เป็นสตริง `true` พอดี (ค่าตั้งต้น — compose เติม `true` เมื่อว่าง) **และ** `MONGODB_URI` ไม่ว่าง ค่าอื่นทุกค่า (`false` `0`
  `TRUE`) = ปิด (`env.ts`) · ตัวแปรทุกตัวของ log store อ่านด้วย `optional()` ขาดตัวไหนก็ไม่ทำให้ process ใดบูตไม่ขึ้น
- **สวิตช์ปิด** `LOG_STORE_ENABLED=false` ใน `.env` แล้วสร้าง backend กับ delivery-worker ใหม่ ไม่ต้อง build (5.11 ข้อ 6) · การเว้น URI ให้ว่าง**ปิดไม่ได้**:
  compose ไม่อ่าน `MONGODB_URI` จาก `.env` เลย (บรรทัด `MONGODB_URI=` ใน `.env` ไม่มีผล) ตัวที่มันแทนค่าคือ `MONGODB_BACKEND_URI` / `MONGODB_WORKER_URI`
  และถ้าเว้นสองตัวนั้นให้ว่าง `${…:-…}` ถือค่าว่างว่าไม่ได้ตั้งแล้วเติม URI ที่ประกอบเองกลับมา (URI ว่างปิดได้เฉพาะนอก compose เช่นไฟล์ Azure) ·
  ปิดแล้ว driver ไม่ถูกโหลดเลย (ตรวจด้วย `require.cache` แล้ว) และผลอื่นอยู่ใน 3.10
- **การเชื่อมต่อ** client ถูกสร้างตอนใช้ครั้งแรก ต่อไม่ติดก็ทิ้งแล้วสร้างใหม่รอบหน้า · `serverSelectionTimeoutMS` 2000 · `connectTimeoutMS` 2000 · `socketTimeoutMS` 5000 ·
  `maxPoolSize` 5 (backend) / 3 (worker) · `appName` `bdi-backend` / `bdi-delivery-worker` · ผู้เรียกที่**อ่าน**ต้องใส่ `maxTimeMS` เอง (timeout ของ driver
  ไม่คุมคิวรีที่ server ทำนาน) · ไม่มีฟังก์ชันไหนของไฟล์นี้ throw ออกไปหาผู้เรียก — ต่อไม่ได้คือสถานะ `down` กับหนึ่งบรรทัดใน log · `error` ของ client ถูกฟังไว้
  (EventEmitter ที่ไม่มีใครฟังจะพา process ล่ม)
- **ตัวแปรที่ต่อแล้ว** `LOG_STORE_ENABLED` `MONGODB_URI` (+ `MONGODB_BACKEND_URI` / `MONGODB_WORKER_URI` ใน compose) `MONGODB_DB` `LOG_STORE_MAX_MB`
  `DEPLOY_ENV` (และ `RELEASE` จาก image — 5.10) · ตัวแปรของขั้นถัดไป (`LOG_HASH_KEY` `LOG_READ_TOKEN` `INGEST_SERVER_TOKEN` `ERROR_ALERT_EMAILS`)
  **ยังไม่มี**ใน `env.ts` compose และไฟล์ Azure — ตอนเพิ่มต้องเพิ่มทั้งใน environment ของ backend และสำเนาที่เขียนเองของ delivery-worker
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

`/health/ready` อ่านค่าที่จำไว้ ไม่รอ Mongo และตอบแค่คำเดียวเพราะ endpoint นี้เปิดสาธารณะ — **แต่ check `database` และ `storage` ของ endpoint เดียวกัน
ยังคืน `error: err.message` ดิบ** เมื่อเป็น `down` (`routes/health.ts` `check()` มีมาก่อนการ์ดนี้ ข้อความของ Prisma หรือ Azure SDK ออกไปถึงใครก็ได้ที่เรียก)
· **ไม่นับรวมใน `healthy`** — Mongo ล่มแล้ว `/ready` ยังตอบ 200
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

**สาเหตุไม่พารหัสผ่านออกมา** (`describe()`): (1) error จากการแยก URI (`new MongoClient()`) พิมพ์แค่ชื่อ error กับ `driver แยก MONGODB_URI ไม่ได้ (…)` และวิธีแก้ —
ข้อความของ driver ออกได้เฉพาะหกประโยคตายตัว (`Password contains unescaped characters` · `URI malformed` · `Invalid scheme…` · `URI contained empty userinfo
section` · สองประโยคของ `mongodb+srv`) นอกนั้นเป็น `(ไม่พิมพ์ข้อความของ driver เพราะอาจยก URI มาด้วย)` — ข้อนี้มาก่อน URI ที่มี `@` เกินจึงได้บรรทัดของข้อ 1
(2) error อื่นทุกตัวหลังแยก URI ผ่านแล้ว (รวมโหลด driver ไม่ขึ้น) เมื่อ URI มี `@` เกินหนึ่งตัว (นับ `@` ใน query ด้วย) เหลือชื่อกับ
`… @ ในรหัสผ่านต้องเขียนเป็น %40` (3) นอกนั้นข้อความของ driver หลังลบ userinfo ของ URI ใด ๆ และรหัสผ่านที่ตั้งไว้ (ดิบ ถอด `%xx` และ
encode ใหม่ ไม่สนตัวพิมพ์) ตัดที่ 300 ตัว · ผลคือ URI ที่เขียนเองต้อง percent-encode อักขระพิเศษ (`@` → `%40` · `/` → `%2F` · ช่องว่าง → `%20`) และถ้าต้องการ
ข้อความเต็มของ driver ต้องรัน driver เอง ซึ่งพิมพ์ URI ทั้งเส้นรวมรหัสผ่านลงจอของคนรัน

### 3.14 เอกสาร `activity` แบบ `audit_fallback` ตามที่สร้าง (`lib/audit-fallback.ts`) · สร้างแล้ว

เกิดเมื่อ `logAudit()` ล้มที่ขั้นใดก็ตาม (อ่าน snapshot หรือ INSERT — Postgres ล่ม · ค่าไม่ใช่ UUID ในคอลัมน์ UUID · `BigInt` ใน JSON ฯลฯ 2.8)
`reportAuditWriteFailure()` ทำสองอย่าง ไม่ await ไม่ throw และ**ไม่เรียก `logAudit()` กลับ** (ความล้มเหลวหนึ่งครั้งวนไม่ได้):

1. `captureError(err, {tag: "audit.write-failed", extra: {audit}})` — error event ระดับ `error` fingerprint ตั้งต้น · `extra.audit` =
   `{action, subjectType, subjectId, organizationId, actorId, actorType, result, before, after, metadata}` ที่ผ่านการปิดชุดเดียวกับข้างล่าง — **เฉพาะเมื่อ
   `extra` ทั้งก้อนไม่เกิน 16 KB** เกินแล้วเหลือ `{truncated: true, bytes, keys: ["audit"]}` และถ้าเอกสาร event ยังเกิน 64 KB `extra` เหลือ `{truncated: true}`
   (5.2) — diff ใหญ่หรือ `note` ยาวจึงเหลือเนื้อของแถวแค่ในเอกสารข้อ 2 (ซึ่งมีเพดาน 64 KB ของตัวเอง) · event นี้อยู่ใต้เพดานการสุ่มเก็บและเพดานขนาดเหมือน event อื่น (2.8)
2. เอกสาร `activity` หนึ่งตัวเข้าคิวเดียวกัน:

| ฟิลด์ (รูปเดียวกับ 3.2) | ค่าในเอกสาร `audit_fallback` | ต่างจากแบบ |
|---|---|---|
| `_id` | UUID ใหม่ (แถว Postgres ไม่เกิด จึงไม่มี id ให้ใช้) | — |
| `source` · `schemaVersion` | `"audit_fallback"` · `1` | — |
| `occurredAt` · `mirroredAt` | เวลาที่ล้ม ทั้งสองฟิลด์ค่าเดียวกัน | ตรงกับ [ข้อเสนอ] |
| `action` · `result` | `input.action` · `input.result ?? "SUCCESS"` | — |
| `category` | ตารางชั่วคราว `CATEGORY_RULES` (3.5) | ตารางต่างจาก 3.5 |
| `actor` | `type` = `input.actorType ?? (actorId ? "USER" : "SYSTEM")` · `id` = actor ที่ `logAudit` หามาได้ (input ก่อน แล้วบริบท) · `name` `roles` `organizationId` จาก snapshot ถ้าอ่านทันก่อนล้ม ไม่งั้น null / `[]` / null | — |
| `via` | `viaOf()` (3.4) | ลำดับต่าง ไม่มี `LOG_TOKEN` |
| `tokenFp` | `adminTokenFp` ของบริบท หรือ null | — |
| `subject` · `organizationId` | จาก input | — |
| `requestNumber` | `metadata.request_number` ถ้าเป็นสตริง ไม่ค้นตารางคำขอ | แถวที่ไม่มีคีย์นั้นได้ null |
| `gate` | `after.taskType` ถ้าเป็นสตริง | — |
| `before` · `after` | ปิดแล้ว (ข้างล่าง) | — |
| `changedFields` | union ของคีย์ชั้นบนสุดของ `before` และ `after` | ไม่อ่าน `fields_changed` |
| `reason` | `metadata.reason` ถ้าเป็นสตริง (หลังปิดเลข 13 หลัก) | — |
| `metadata` | `input.metadata` ที่ปิดแล้ว — **ไม่มีคีย์ระบบ** `actor_*` `ip_unparsed` `admin_token_fp` (คีย์เหล่านี้ `logAudit` เติมตอน INSERT) · ว่าง = null | fingerprint ของ admin token อยู่ที่ `tokenFp` เท่านั้น |
| `request` | `correlationId` `reference` `ip` จากบริบท · `userAgent` ผ่าน `storedUserAgent()` แล้ว (ค่าเดียวกับที่ Postgres จะได้) · `method` `route` (แม่แบบ) จากบริบท · `status` `durationMs` null | `method` `route` มีค่า |
| `sourceComponent` | บริบท หรือ `request-service` | — |
| `relatedUserIds` · `hashKeys` | `[]` เสมอ | ยังไม่มี `LOG_HASH_KEY` (ขั้น 6) |
| `fallback.errorEventId` | id ของ event ข้อ 1 ถ้ามันได้เข้าคิว — **null** เมื่อไม่ได้เข้า: เกินเพดานขนาด · ติดเพดาน 50/ชั่วโมงหรือ 600/นาที · คิวเต็ม · issue ที่รอเขียนครบ 1,000 fingerprint (`issue_backlog`) · ตัว `captureError` เองล้ม (log store ปิดไม่อยู่ในรายการนี้ เพราะตอนปิดไม่มีเอกสาร fallback เลย) · **id ที่ไม่ null ก็อาจชี้ event ที่ไม่เคยถูกเขียน**: id ถูกจดตอนเข้าคิว แล้ว event (ชั้น 3) ยังถูกไล่ออกทีหลังได้ด้วยรายการชั้น 4 (สำเนา audit ตัวอื่น · fatal · `runtime_events`) เมื่อคิวเต็ม ถูกข้ามตอนเขียนถ้าธงเกินเพดานตั้งก่อน flush หรือ Mongo ไม่รับ — ขณะที่เอกสาร fallback (ชั้น 4 เขียนแม้เกินเพดาน) ถูกเขียน | ฟิลด์ใหม่ |

เอกสารเกิน 64 KB → `before` `after` เป็น `{truncated: true}` ถ้ายังเกินอีก `metadata` เป็น `{truncated: true}` ด้วย · ถ้ายังเกินหลังจากนั้น (ที่เหลือเป็นฟิลด์สั้น
`reason` ที่คัดลอกไว้ และ `changedFields` ที่ไม่ถูกตัด — ในทางปฏิบัติแทบไม่เกิด) `enqueue()` ทิ้งมันเป็น `too_large` นับใน `reasons.too_large` และ `auditCopies`
ของ event สรุป (5.7) และ**ไม่ถึง Mongo**

**การปิดข้อมูล** (`maskForLogStore()` และ `maskedTypedEmail()` ใน `lib/redact.ts` — plan §7.6 ส่วนที่ทำได้โดยไม่มี `LOG_HASH_KEY`):

- คีย์ที่ชื่อตรง `/cid$|nationalid|^pid$|^thaid_subject$/i` ทุกระดับความลึก → `{"masked": "xxxxxxxxx1234"}` (4 ตัวท้าย ไม่มี `changed`) · ค่าที่เป็น object
  หรือ array ปิดทีละใบ · `{masked, changed}` ที่ Postgres ปิดมาแล้วไม่ปิดซ้ำ แต่ยังผ่านกฎเลข 13 หลักข้างล่าง
- เลข 13 หลัก (ติดกัน หรือคั่นด้วยขีด/ช่องว่าง) ใน**ทุก**ค่าที่เป็นข้อความ และ number 13 หลัก → `"[cid]"` · ชื่อคีย์ที่มีเลข 13 หลักก็ถูกแทน
- `LOGIN_FAILED.metadata.email` (อีเมลที่พิมพ์) → `{"masked": "so***@agency.go.th"}`
- อีเมลของบัญชี ชื่อ เบอร์โทร IP และ UA **ไม่ถูกแตะ** · ลึกเกิน 8 ชั้น → `"[ลึกเกิน]"`
- **ต่างจากแบบ:** แผน §7.6 ให้ปิดเลข 13 หลักเฉพาะใน `note` และ `reason` และเหลือ 4 ตัวท้าย ที่สร้างปิดทุกข้อความเป็น `[cid]` ทั้งก้อน — ผู้ตรวจพิมพ์เลขบัตรลง
  `notes` ของร่างคำขอแล้วเลขเต็มไปถึงสำเนา (พบ 2026-09-30)

**ในคิว** สำเนาเหล่านี้อยู่ชั้นเดียวกับ fatal — ถูกทิ้ง**ท้ายสุด**เมื่อคิวเต็ม และ**ยังเขียนแม้เกินเพดานขนาด** (5.7, 5.9) ถ้าหายจะนับใน `auditCopies` ของ event สรุป
“ทิ้งไป N” · process ตายก่อน flush = หาย · Postgres **ไม่ได้แถวคืน** และ relay (ขั้น 6) สร้างเอกสารนี้ใหม่ไม่ได้ · มีแค่ใน backend (worker ไม่เขียน audit) ·
`seed:demo` ไม่แตะ Mongo เอกสารเหล่านี้จึงอยู่ข้าม seed · งานที่ส่งต่อให้ขั้น 6: ย้ายตาราง category ไป `activity-shape.ts` และเติม `hashKeys` เมื่อมี `LOG_HASH_KEY`

ค้น: `db.activity.find({ source: "audit_fallback" }).sort({ occurredAt: -1 })` · ตามรหัสอ้างอิง `{"request.reference": "<8 ตัว>"}` (5.11)

ตัวอย่าง (ข้อมูลสมมติ) — การบันทึกร่างใน 2.9 ที่ connection ของ Postgres หลุดหลัง route commit แล้ว ก่อน `logAudit` จะอ่าน snapshot (การอ่าน snapshot ล้ม จึงไม่ได้ไปถึง INSERT — `actor.name` `roles` ว่าง):

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
  "tokenFp": null,
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
  "relatedUserIds": [],
  "hashKeys": [],
  "mirroredAt": { "$date": "2026-09-29T03:21:07.455Z" },
  "fallback": { "errorEventId": "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e" }
}
```

---

## 4. แคตตาล็อกเหตุการณ์

ที่ `2cab0a7` มีรหัส `AuditAction` **51 ตัว** (`lib/audit.ts:27-423` — หัวไฟล์ยังเขียนว่า “~25” ซึ่งล้าสมัย)
ถูกเขียนจริง **50 ตัว** จาก 90 จุดเรียก `DATA_EXPORTED` ประกาศไว้แต่ไม่มีใครเขียน (4.12) รหัสสี่ตัวที่ขั้น 7–8
จะเพิ่มอยู่ที่ 4.13 ทุกแถวในหมวดนี้ลง Postgres วันนี้ และจะถูก relay คัดลอกลง `activity` ตั้งแต่ขั้น 6 [ออกแบบ]
(ปิดข้อมูลตาม 3.6) · แถวที่ `logAudit` เขียนลง Postgres ไม่สำเร็จได้สำเนา `audit_fallback` ใน Mongo แล้ววันนี้ (3.14)

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
หมดอายุ (`issueSession()` `routes/auth.ts:1363-1366` และท้าย `POST /password-reset` `:972-974`) เป็นของ**เจ้าของ cookie** ซึ่งอาจเป็นคนอื่น

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
`ADMIN_TOKEN_REJECTED` และ `LOG_TOKEN_REJECTED` ของขั้น 7 ทุกรหัสอื่นเป็น `SUCCESS` เสมอ — รวมผลการตรวจ “ส่งกลับ” และ
“ไม่อนุมัติ” ซึ่งผลจริงอยู่ใน `after.result` (4.9) คิวรีหา “สิ่งที่ล้ม” ด้วย `result = 'FAILURE'` จึงไม่เจอการตรวจที่ไม่ผ่าน

**ความหมายของ `reason`** — คีย์ชื่อเดียวกันถือของสองแบบ และข้อความที่คนพิมพ์บางจุดอยู่คีย์อื่น:

| ที่อยู่ | เป็นรหัส | เป็นข้อความที่คนพิมพ์ |
|---|---|---|
| `metadata.reason` | `SESSION_REVOKED` (`SessionRevokeReason`) · `ROLE_REVOKED` รูปแบบ B (`REPLACED_BY_NEW_HOLDER`) · `ACTIVATION_KEY_ISSUED` (`INVITATION` `RESEND` `APPROVER_INVITATION`) | admin: `USER_ACCOUNT_SUSPENDED` `REACTIVATED` `DEACTIVATED` `UPDATED` (อีเมล/เลขบัตร) · `USER_IDENTITY_RELEASED` · `ROLE_ASSIGNED` ของ admin · `ROLE_REVOKED` A และ C (A ของการแทนที่ที่นั่งเป็นข้อความคงที่ `"มีผู้รับผิดชอบคนใหม่แทน"`) · `ACTIVATION_KEY_REVOKED` (ข้อความของ admin, `note` ของ recall หรือข้อความคงที่ภาษาไทยของโค้ด) · `REQUEST_UPDATED` `RESET_TO_DRAFT` `CANCELLED` (admin) `DELETED` · `APPROVER_INVITATION_RECALLED` (admin reset) |
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
cookie ที่ยังใช้ได้ หรือ `EXPIRED` (actor = เจ้าของ cookie นั้น) เมื่อ cookie ที่ถืออยู่หมดอายุแล้ว (`routes/auth.ts:1363-1367`)
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
- **โค้ด** `routes/auth.ts:1134` (OTP) · `:628` (ThaID) — การเขียน `external_subject` ครั้งแรกของขา ThaID ไม่มีแถว `USER_ACCOUNT_UPDATED`

#### `LOGIN_FAILED` — เข้าสู่ระบบไม่สำเร็จ

ทุกความล้มเหลวของขั้นรหัสผ่าน ขั้น OTP และขา login ของ ThaID ที่หาบัญชีไม่เจอ แยกด้วย `failure_reason` — ยกเว้น body ที่ไม่ผ่าน
zod (400 `validation` เช่นอีเมลผิดรูปหรือยาวเกิน 254 ตัว หรือรหัส OTP ไม่ครบ 6 หลัก) ของ `/login` และ `/login/verify-otp` ซึ่ง**ไม่มีแถว** (`auth.ts:993-995`
`:1048-1051`) · body ที่อ่านไม่ออก ใหญ่เกิน 1 MB หรือเข้ารหัสแบบที่ไม่รองรับก็**ไม่มีแถว** — ไม่ถึง route เลย `RequestBodyError` ตอบ 400/413/415 จากตัวจัดการ
error ท้าย `index.ts` (แยกตามที่มาตั้งแต่ `76245a3`) และเก็บเป็น warning ที่ไม่พิมพ์ fingerprint `http:request-body:<status>` ใน Mongo (5.1)

| `failure_reason` | เกิดเมื่อ | `subject_id` | metadata อื่น | โค้ด |
|---|---|---|---|---|
| `INVALID_CREDENTIAL` | `POST /api/auth/login`: ไม่มีบัญชีของอีเมลนี้ · บัญชีไม่มีรหัสผ่าน · รหัสผ่านผิด | บัญชีของอีเมลนั้น หรือ null | `email` | `auth.ts:1001` |
| `ACCOUNT_PENDING` · `ACCOUNT_SUSPENDED` · `ACCOUNT_DEACTIVATED` | `POST /login`: รหัสผ่านถูกแต่บัญชีไม่ `ACTIVE` — บัญชี PENDING ที่ถูกเชิญจริงยังไม่มี `password_hash` จนกว่าจะ `/activate` (`admin.ts:826` และ `organizations.ts:3208` สร้างโดยไม่มีรหัสผ่าน) จึงได้ `INVALID_CREDENTIAL` แทน `ACCOUNT_PENDING` เกิดได้แค่กับบัญชี PENDING ของ `seed:demo` ซึ่งตั้งรหัสผ่านให้ทุกสถานะ | บัญชีนั้น | — | `auth.ts:1020` |
| `OTP_NOT_PENDING` | `POST /login/verify-otp`: ไม่มี OTP `LOGIN` ที่ยังไม่ถูกใช้ของอีเมลนี้ | ค้นจากอีเมล หรือ null | `email` | `auth.ts:1066` |
| `OTP_EXPIRED` | OTP ล่าสุดหมดเวลา | เหมือนข้างบน | `email` `otp_code_id` `expires_at` | `auth.ts:1066` |
| `OTP_LOCKED` | ผิดครบ `OTP_MAX_ATTEMPTS` แล้ว (รหัสถูกเผา) | เหมือนข้างบน | `email` `otp_code_id` `attempts` | `auth.ts:1066` |
| `OTP_INVALID` | รหัสผิด | เหมือนข้างบน | `email` `otp_code_id` `attempts_left` | `auth.ts:1066` |
| `ACCOUNT_INACTIVE` | OTP ถูก แต่บัญชีหายหรือถูกระงับระหว่างสองขั้น | บัญชีนั้น หรือ null | `account_status` `email` `otp_code_id` | `auth.ts:1112` |
| `THAID_NO_MATCHING_ACCOUNT` | `/thaid/callback` ขา login: ไม่มีบัญชี `ACTIVE` ที่ `cid` ตรง | null | `thaid_subject` | `auth.ts:594` |

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
  `thaid_subject` คือเลขบัตรเต็มของคนที่**ไม่มีบัญชีในระบบ** · สำเนา Mongo ปิดทั้งสองอย่าง (3.6 — สำเนา `audit_fallback` ที่สร้างแล้วก็ปิด 3.14)
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
- ก่อนออกรหัสใหม่ `issueOtp()` ตั้ง `consumed_at` ให้ OTP `LOGIN` ที่ยังไม่ถูกใช้**ทุกใบ**ของอีเมลนั้น (`auth.ts:98-101`) การยกเลิกนี้**ไม่มีแถว**
  ผู้ที่กรอกรหัสใบเก่าหลังจากนั้นจึงได้ `OTP_INVALID` (เทียบกับรหัสใบใหม่) หรือ `OTP_NOT_PENDING` โดยไม่มีอะไรบอกว่าใบเก่าถูกยกเลิก
  ให้ดู `LOGIN_OTP_ISSUED` ใบใหม่ของบัญชีเดียวกันที่มาก่อน
- **ตัวอย่าง** `{"metadata": {"resend": false, "otp_code_id": "b1e0c7d2-4c1f-4a8e-9d2b-7f3e5a6c8d90", "expires_at": "2026-09-29T03:15:00.000Z"}}`
- **โค้ด** `routes/auth.ts:110` (`issueOtp()`, ผู้เรียก `:1038` และ `:1169`)

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
- หลังแถวนี้ route เรียก `resolveSession()` กับ cookie ที่เบราว์เซอร์ถือ (`auth.ts:972-974`) ถ้าเป็น cookie หมดอายุของ**บัญชีอื่น**
  (ของเจ้าของลิงก์ถูก `PASSWORD_CHANGED` ปิดไปแล้ว) ได้ `SESSION_REVOKED` `EXPIRED` ของบัญชีนั้นตามมาในคำขอเดียวกัน
- **โค้ด** `routes/auth.ts:955` (สำเร็จ) · `:906` (`resetFailed()`, ผู้เรียก `:917` `:922` `:950`)

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
- **โค้ด** `routes/auth.ts:290`

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
  คือเลขบัตร (`CLAUDE.md` Traps) คอมเมนต์ที่ `auth.ts:468` (บนแถว `CID_MISMATCH`) ที่ว่าไม่บันทึกเลขบัตรจึงผิด สำเนา Mongo ปิดให้
- **โค้ด** `routes/auth.ts:483` · ตามด้วย `USER_ACCOUNT_UPDATED` (`updated_via: THAID`) ถ้าชื่อบนบัตรต่างจากที่กรอกไว้

#### `IDENTITY_VERIFICATION_FAILED` — ความล้มเหลวของ callback ThaID

ครอบ**ทุก**ความล้มเหลวของ callback ทั้งสองขา (ยกเว้น body ที่ไม่ผ่าน zod — 400 `validation` ไม่มีแถว `auth.ts:320-323` — และขา login
ที่ไม่พบบัญชี ซึ่งเขียนเป็น `LOGIN_FAILED` `THAID_NO_MATCHING_ACCOUNT` แทน) เขียนจาก
`logThaidFailure()` ผ่าน `failThaidOperation()` `failure_reason` จึงเป็นรหัสเดียวกับ `integration_operation.last_error_code` —
**ยกเว้น** แถว `CID_MISMATCH` ที่เขียนเอง และแถว `state_*` ที่ callback เขียนเอง (doc comment ของรหัสนับเป็นข้อยกเว้นเหมือนกัน
`audit.ts:325-327`): `state_not_found` ไม่มี operation เลย · `state_already_used` ชี้ operation ที่ `SUCCEEDED` แล้ว (`last_error_code` null)
`FAILED` แล้วด้วยรหัสอื่น หรือยัง `PROCESSING` · `state_expired` เขียน `last_error_code` ให้เฉพาะ operation ที่ยัง `PENDING` นอกนั้น
operation คงรหัสเดิมไว้ ข้อความอิสระจาก ThaID (`error_description`) **ไม่ถูกเก็บ** ในแถวนี้ (แต่ลง `last_error_message` หลังผ่าน `scrubText()` —
ถ้อยคำยังเป็นของผู้ยิง 5.6)

| `failure_reason` | เกิดเมื่อ (`POST /api/auth/thaid/callback`) | โค้ด |
|---|---|---|
| `state_not_found` · `state_expired` · `state_already_used` | หา `state` ไม่เจอ · หมดเวลา · ถูกใช้ไปแล้ว — ที่เดียวที่เขียน `state_*` อายุถูกตรวจ**ก่อน**สถานะ (`thaid-flow.ts:108-129`): เกิน `THAID_STATE_TTL_MINUTES` (ค่าตั้งต้น 15) แล้วได้ `state_expired` แม้ operation นั้นสำเร็จไปแล้ว · ก่อนนั้น `state_already_used` = operation ไม่ `PENDING` แล้ว ซึ่งอาจตามหลังความสำเร็จ ความล้มเหลว (`IDENTITY_VERIFICATION_FAILED` หรือ `LOGIN_FAILED`) ของความพยายามเดียวกัน หรือ callback อีกใบที่ยัง `PROCESSING` อยู่ | `auth.ts:330` |
| รหัสที่ส่งมาในช่อง `error` หลัง `trim()` + ตัวพิมพ์เล็ก ถ้าตรง `^[a-z][a-z_]{0,39}$` เก็บตามนั้น ไม่งั้น `thaid_error_unrecognised` | callback มี `error` — **ค่านี้ไม่ได้มาจาก ThaID โดยตรง** หน้า callback ของเบราว์เซอร์อ่านจาก query string แล้วส่งต่อ ใครที่มี `state` ของตัวเอง (เรียก `/thaid/start` ได้) ยิงค่าอะไรก็ได้ รหัสตัวพิมพ์เล็กยาวไม่เกิน 40 ตัวจึงถูกเก็บตามที่ส่ง (`thaid-flow.ts:158-176`) | `auth.ts:346` |
| `missing_code` | ไม่มีทั้ง `error` และ `code` | `auth.ts:357` |
| `network_error` · `http_<status>` · รหัส error ของ token endpoint · `no_id_token` · `jwks_unavailable` · `unknown_kid` · `invalid_id_token` · `nonce_missing` · `nonce_mismatch` · `unexpected` | แลก token หรือตรวจ id_token ไม่ผ่าน — `nonce_missing` เกิดเฉพาะเมื่อ `THAID_REQUIRE_NONCE=true` (ค่าตั้งต้น `false` ไม่งั้นแค่เตือนใน log แล้วไปต่อ `thaid.ts:308-316`) · `jwks_unavailable` เฉพาะเมื่อ JWKS ตอบ HTTP ไม่ ok ส่วนเครือข่ายล้มหรือ JSON เสียตอนดึง JWKS ออกมาเป็น `unexpected` (`fetch` ใน `fetchJwks()` ไม่ถูกห่อ `thaid.ts:220-223`) | `auth.ts:383` |
| `cid_unavailable` | ไม่มีเลขบัตรที่ผ่าน checksum ใน claim ที่เลือก | `auth.ts:416` |
| `key_not_found` · `key_used` · `key_revoked` · `key_expired` | ขา activate: คีย์ใช้ไม่ได้แล้ว — `key_expired` ที่คีย์เพิ่งเลยกำหนดมี `ACTIVATION_KEY_EXPIRED` นำหน้าในคำขอเดียวกัน (`usableActivationKeyById()` → `evaluateActivationKey()` `iam.ts:551-600`, เรียกที่ `auth.ts:441`) | `auth.ts:443` |
| `ambiguous_account` | ขา login: มีบัญชี `ACTIVE` หลายบัญชีที่ `cid` เดียวกัน | `auth.ts:609` |
| **`CID_MISMATCH`** (ตัวพิมพ์ใหญ่) | ขา activate: เลขบัตรไม่ตรงบัญชี — คีย์ถูกเพิกถอนโดย**ไม่มี** `ACTIVATION_KEY_REVOKED` แถวนี้คือหลักฐาน | `auth.ts:457` |

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
- **โค้ด** `lib/thaid-flow.ts:246` (`logThaidFailure()`) · `routes/auth.ts:457` (CID_MISMATCH) — จุดที่ส่ง `audit: false`
  และไม่เขียนแถวจาก hook: `thaid-flow.ts:113` (`state_expired` ใน `claimThaidState()`), `auth.ts:454`, `auth.ts:591`
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
| `LOGOUT` | `POST /api/auth/logout` กับ session ที่ยังใช้ได้ | `SESSION` | `SYSTEM` (null) | `session.ts:147` ← `auth.ts:1189` |
| `ROTATED` | ออก session ใหม่ขณะเบราว์เซอร์ถือ cookie ที่ยังใช้ได้ (verify-otp, `/activate`, ThaID login) | `SESSION` · **ใบเก่า** | `SYSTEM` (null) | `session.ts:147` ← `auth.ts:1366` |
| `LOGOUT_ALL` | `POST /api/auth/logout-all` | UA | `USER` = เจ้าของบัญชี | `session.ts:182` ← `auth.ts:1197` |
| `PASSWORD_CHANGED` | `POST /api/auth/password-reset` สำเร็จ — **ในธุรกรรม** | UA | `USER` = เจ้าของบัญชี (ทั้งที่ผู้ยิงถือแค่ลิงก์) | `session.ts:182` ← `auth.ts:943` |
| `ACCOUNT_SUSPENDED` | `requireAuth` พบบัญชีหายหรือไม่ `ACTIVE` | UA | `USER` = บัญชีนั้น | `session.ts:182` ← `middleware/auth.ts:82` |
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
- **โค้ด** `routes/admin.ts:848` · `routes/organizations.ts:2842`

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
- **ไม่ได้แปลว่า PENDING → ACTIVE เสมอ** — `/activate` ปฏิเสธแค่บัญชีที่ `ACTIVE` อยู่แล้ว (`auth.ts:686`) และ
  `POST /api/admin/invitations/:id/resend` ก็ปฏิเสธแค่ `ACTIVE` (`admin.ts:992`) บัญชีที่ `SUSPENDED` หรือ `DEACTIVATED` จึงได้คีย์ใหม่
  ด้วย resend ผ่าน ThaID แล้ว `completeActivation()` ตั้งเป็น `ACTIVE` (`iam.ts:687-695`) ได้แถวนี้ที่ before/after เป็น null ไม่ใช่
  `USER_ACCOUNT_REINSTATED` หรือ `REACTIVATED` — แถวไม่บอกสถานะก่อนหน้า ต้องดูแถวสถานะล่าสุดของบัญชีเดียวกัน (ในกรณีนั้น `before.status`
  ของ `ACTIVATION_KEY_ISSUED` ขา resend อาจเป็น `"USED"`)
- **โค้ด** `routes/auth.ts:787`

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
- **โค้ด** `routes/admin-users.ts:533` (โปรไฟล์) · `:629` (อีเมล/เลขบัตร ตามหลัง [`SESSION_REVOKED` ROTATED ในธุรกรรม] ถ้าบัญชีมี session เปิดอยู่) · `routes/auth.ts:537` (ชื่อจากบัตร)

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

subject **ไม่สม่ำเสมอ**: สามจุดชี้แถว assignment (URA) อีกสองจุดของ admin ชี้**บัญชี** (UA) และไม่บันทึก id ของ assignment

| จุด | เกิดเมื่อ | actor | subject | before / after | metadata |
|---|---|---|---|---|---|
| activate | `POST /api/auth/activate` — `assignRole` สร้าง assignment ใหม่จริง (มีอยู่แล้ว = ไม่มีแถว) | `USER` = บัญชีที่เปิด | URA | null / `{userAccountId, role, organizationId}` | `assigned_via: "ACTIVATION"` · `activation_key_id` · `replaced` |
| เปิดหน่วยงาน | **ถอดแล้วที่ `7259c09`** — แถวเก่าเท่านั้น: `POST /api/organizations` ทางหน่วยงานใหม่ | **แถว session** (ผู้ใช้ = ผู้รับ role) | URA | null / เหมือนข้างบน (`ORGANIZATION_USER`) | `assigned_via: "ORGANIZATION_CREATED"` · `request_number` · `replaced` |
| review | `POST /api/organizations/:id/review` ผ่านด่าน `BDI_OFFICER_REVIEW` และผู้มีอำนาจฯ มีบัญชี `ACTIVE` แล้ว และ `assignRole` สร้าง assignment ใหม่จริง — ผู้มีอำนาจฯ ที่ถือ `ORGANIZATION_APPROVER` ของหน่วยงานนี้อยู่แล้ว (เช่นผ่านด่านแรกรอบที่สองหลังคำขอถูกส่งกลับ) = `created: false` ไม่มีแถว (`organizations.ts:3244` `:2881`) | **แถว session** = ผู้ประสานงาน BDI | URA | null / เหมือนข้างบน (`ORGANIZATION_APPROVER`) | `assigned_via: "REVIEW_API"` · `request_number` · `replaced` |
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
- **โค้ด** `routes/auth.ts:809` · `routes/organizations.ts:1175` · `:2882` · `routes/admin-users.ts:1223` · `:1430`

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
- `POST /api/organizations/:id/review` ผ่านด่านแรกกับผู้มีอำนาจฯ ที่บัญชี **`ACTIVE`** แล้ว (`organizations.ts:3234-3244`, actor = `SYSTEM_USER_ID`)
  — ตามด้วยรูปแบบ B · บัญชีที่มีอยู่แต่ `PENDING` `SUSPENDED` หรือ `DEACTIVATED` ไปทาง `issueActivationKey()` (`:3245-3253`) ซึ่งไม่เรียก
  `assignRole` จึงไม่มีทั้งรูปแบบ A และ B
- **ถอดแล้วที่ `7259c09`** `POST /api/organizations` (`:1133`, actor = ผู้ใช้) — ตามด้วยรูปแบบ B (`:1146` เขียนก่อน `ORGANIZATION_CREATED`) หน่วยงานเพิ่งสร้าง
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
- **ขา resend ไม่มี id ของบัญชี** (`after` มีแค่ `{email, role}`) และ `INVITATION_DELETED` `APPROVER_INVITATION_RECALLED` ก็ไม่มี —
  ชีวิตของบัญชี PENDING ที่จบด้วยการถูกลบจึงตามด้วย id ไม่ได้ ต้องจับด้วยอีเมล (หรือเลขบัตรเต็มในแถวที่ยังเก็บเต็ม) ส่วนในสำเนา Mongo
  เลขบัตรถูกปิดและอีเมลบัญชีไม่ถูก hash แถวเหล่านี้จึงเข้า `person=` ไม่ได้ (3.2 `relatedUserIds`)
- **ตัวอย่าง (review)** `{"after": {"email": "approver@agency.go.th", "cid": {"masked": "xxxxxxxxx4821", "changed": true}, "role": "ORGANIZATION_APPROVER", "name": "นาย ผู้มีอำนาจ ตัวอย่าง", "userAccountId": "5c3e…"}, "metadata": {"issued_via": "REVIEW_API", "reason": "APPROVER_INVITATION", "request_number": "ORG-REG-2026-0004"}}`
- **โค้ด** `routes/admin.ts:867` · `:1062` · `routes/organizations.ts:2861`

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

- **ข้อมูลส่วนบุคคล** `actor_name` · **โค้ด** `routes/auth.ts:798`

#### `ACTIVATION_KEY_REVOKED` — คีย์ที่ยังใช้ได้ถูกเพิกถอน

หนึ่งแถวต่อคีย์ เขียนหลัง commit ด้วย `logKeysRevoked()` จากรายการที่ `revokeIssuedKeys()` (`UPDATE … RETURNING`)
พลิกได้จริงเท่านั้น คีย์ที่ไม่ใช่ `ISSUED` อยู่แล้วไม่ได้แถว

| เกิดเมื่อ | actor | `reason` | `revoked_via` | `replaced_by_key_id` | โค้ดผู้เรียก |
|---|---|---|---|---|---|
| `POST /api/admin/invitations/:id/resend` — คีย์เก่าที่ยัง ISSUED | **แถว admin** | `"ออกคีย์ใหม่แทน"` | `ADMIN_API` | มี | `admin.ts:1061` |
| `POST /api/admin/invitations/:id/revoke` — คีย์ `:id` ยัง ISSUED (ไม่ใช่ = 404) **ไม่ดู `expires_at`**: คีย์ที่เลยกำหนดแต่ยังไม่มีใครเปิดจึงถูกพลิกเป็น `REVOKED` ได้แถวนี้ ไม่เคยได้ `ACTIVATION_KEY_EXPIRED` | **แถว admin** | ที่ admin พิมพ์ หรือ `"ยกเลิกโดยผู้ดูแลระบบ"` | `ADMIN_API` | — | `admin.ts:1297` |
| `POST /api/admin/users/:id/deactivate` — คีย์ ISSUED ของบัญชี | **แถว admin** | `"บัญชียุติการใช้งาน"` | `ADMIN_API` | — | `admin-users.ts:883` |
| `POST /api/admin/registrations/organizations/:id/reset` — คีย์ของผู้มีอำนาจฯ ที่ถูกถอด หรือของบัญชี PENDING ที่ลบไม่ได้ | **แถว admin** | ที่ admin พิมพ์ | `ADMIN_RESET_API` | — | `admin-registrations.ts:582` |
| `POST /api/organizations/:id/review` ผ่านด่านแรกและเคยมีคำเชิญผู้มีอำนาจฯ ค้างอยู่ | **แถว session** = ผู้ประสานงาน BDI | `"ออกคีย์ใหม่แทน"` | `REVIEW_API` | มี | `organizations.ts:2857` |
| `POST /api/organizations/:id/review` `action: "recall"` และบัญชี PENDING ถูกเก็บไว้ | **แถว session** = ผู้ประสานงาน BDI | บันทึกของผู้ประสานงาน (note) | `REVIEW_API` | — | `organizations.ts:2918` |

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
- `GET /api/auth/invitation?token=` (`auth.ts:160`)
- `POST /api/auth/thaid/start` ขา activate (`auth.ts:265`)
- `POST /api/auth/thaid/callback` ขา activate (`auth.ts:441`) — ตามด้วย `IDENTITY_VERIFICATION_FAILED` `key_expired`
- `POST /api/auth/activate` (`auth.ts:681`)

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
- **โค้ด** `routes/organizations.ts:2908` · `routes/admin-registrations.ts:553`

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
- **โค้ด** `routes/admin.ts:247` · `routes/organizations.ts:1153`

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
`organizationType` ในคำขอ**ไม่ถูกคัดลอก** และ `parentOrganizationId` ก็ไม่ (`organizations.ts:2744-2759`)

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
- **โค้ด** `routes/organizations.ts:2806`

---

### 4.7 หมวด request — คำขอจดทะเบียนหน่วยงานและคำขอลงทะเบียนชุดข้อมูล

#### `REQUEST_CREATED` — เปิดคำขอใบใหม่

**เกิดเมื่อ**
- `POST /api/dataset-requests` — ผู้ใช้มี `ORGANIZATION_USER` หน่วยงาน `ACTIVE` มีผู้ใช้และผู้มีอำนาจฯ ครบ (กดทุกครั้งได้ร่างใหม่)
- `POST /api/organizations` ทางหน่วยงานที่มีอยู่แล้ว — ผู้ใช้มีหน่วยงานใน session (`session.organizationId`) **และถือ `ORGANIZATION_USER`**
  (เงื่อนไขหลังมาจาก `7259c09` — ผู้มีอำนาจฯ และผู้ไม่มีหน่วยงานได้ 403 `no_organization` ไม่มีแถว) หน่วยงานนั้นยังไม่ `ACTIVE` และไม่มีคำขอเปิดค้าง
  (`prefilled_from`) ซึ่งรวมทั้งผู้ถูกเชิญเข้าหน่วยงานที่ admin สร้างไว้ **และ**ผู้ใช้ที่ยื่นใหม่หลังคำขอของหน่วยงานที่ตัวเองเปิดทาง WEB_FORM ถูก
  `REJECTED` (การปฏิเสธตั้งแค่ `rejected_at` ไม่ถอน `ORGANIZATION_USER` — `organizations.ts:2773-2777`)
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
| `prefilled_from` | *ทางหน่วยงานที่มีอยู่แล้ว* — ค่าตั้งต้นคัดลอกจากทะเบียน ค่า**คงที่ในโค้ด** (`organizations.ts:1075`) จึงไม่ได้พิสูจน์ว่า admin เป็นผู้สร้างหน่วยงาน ดู `ORGANIZATION_CREATED` ของหน่วยงานนั้น (`created_via`) | `"ADMIN_ORGANIZATION"` |
| `organization_code` | *เหมือนข้างบน* | `"ORG-2026-0003"` |

- เนื้อหาของร่าง**ไม่ถูกบันทึก**ในแถวนี้ · แถวก่อนการ์ดของสองทางฝั่งหน่วยงานเป็น `ORGANIZATION_UPDATED` และ `ORGANIZATION_CREATED` ตามลำดับ
- **โค้ด** `routes/dataset-requests.ts:609` · `routes/organizations.ts:1068` · `:1167`

#### `REQUEST_DRAFT_SAVED` — ฝั่งหน่วยงานบันทึกร่าง

ใครแก้อะไร ไม่ใช่ใครกดปุ่ม: diff คำนวณที่เซิร์ฟเวอร์จากแถวเดิมกับค่าที่**เขียนลงจริง** (`""` เท่ากับ null) กดบันทึกโดยไม่มีอะไร
เปลี่ยนไม่มีแถว (ยกเว้น snapshot ฝั่งหน่วยงานที่ route ซิงก์จากบัญชีหรือแปลงรูป — ข้างล่าง) PATCH นี้มาจาก “บันทึกแบบร่าง” **และ**จากปุ่มสร้างเอกสารที่บันทึกก่อนเรียก `generate-form` แถวไม่บอกว่าปุ่มไหน

**เกิดเมื่อ**
- `PATCH /api/organizations/:id` — ผู้แก้อยู่หน่วยงานเดียวกันและถือ `ORGANIZATION_USER` คำขอ `DRAFT`/`RETURNED` และ diff ของคำขอหรือของชื่อหน่วยงานไม่ว่าง
- `PATCH /api/dataset-requests/:id` — `mayEdit` (ผู้ใช้หรือผู้มีอำนาจฯ ของหน่วยงาน) คำขอ `DRAFT`/`RETURNED` และ diff ไม่ว่าง

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
| `organization_master_changed` | *หน่วยงาน เมื่อชื่อบนแถว organization เปลี่ยนตาม* — `{before, after}` ของ `nameTh` `nameEn` `organizationType` | `{"before": {"nameTh": "หน่วยงานใหม่"}, "after": {"nameTh": "กรมตัวอย่าง"}}` |

- **ฝั่งหน่วยงานเท่านั้น**: `fields_changed` + `synced_from_account` + `normalised_by_route` = คีย์ของ before/after พอดี (before/after ยังเก็บค่าดิบที่
  เปลี่ยนจริงในตาราง) snapshot ที่ไม่ตรงกับบัญชี หรือเก็บไว้ก่อนมีการแปลงรูป จึงได้แถวตอนบันทึกครั้งแรกแม้ไม่ได้พิมพ์อะไร โดย `fields_changed: []`
  (ข้อยกเว้นของ “ไม่เปลี่ยน = ไม่มีแถว” — 6.1) บันทึกครั้งถัดไปโดยไม่แตะอะไรไม่มีแถว · แถวที่เปลี่ยนแค่ชื่อหน่วยงานก็มี `fields_changed: []` กับ
  `organization_master_changed` · ตัวแปลงใหม่ของช่องในร่างต้องเพิ่มใน `changedOnlyInForm()` ด้วย ไม่งั้นบันทึกครั้งแรกหลังจากนั้นโทษผู้กรอกอีก ·
  ฝั่งชุดข้อมูลไม่มี `synced_from_account` และ `normalised_by_route` และ `fields_changed` = คีย์ของ `after`
- **ข้อมูลส่วนบุคคล สูง** ชื่อ ตำแหน่ง อีเมล เบอร์โทรของผู้มีอำนาจฯ และผู้ประสานงาน ไม่ปิด · เลขบัตรเหลือ 4 ตัวท้าย ·
  ฝั่งชุดข้อมูลมี `maintainer` `maintainerEmail` และข้อความอิสระหลายช่อง
- **ตัวอย่าง** ดู 2.9
- **โค้ด** `routes/organizations.ts:1551` (แยกสามกลุ่มที่ `:1526-1540` · `changedOnlyInForm()` ใน `lib/organization-form.ts:127`) · `routes/dataset-requests.ts:857`

#### `REQUEST_FORM_GENERATED` — สร้างเอกสารจาก template ให้ตรวจก่อนนำส่ง

ฉบับที่สร้างรอบนี้คือสิ่งที่ผู้มีอำนาจฯ จะอ่านและลงนาม กดซ้ำเมื่อไรฉบับเดิมกลายเป็น REPLACED การ render ซ้ำหลังลงนามและ
การ render อัตโนมัติตอน `GET /:id/legal-documents` **ไม่เขียนแถวนี้**

**เกิดเมื่อ**
- `POST /api/organizations/:id/generate-form` — `canEdit` (หน่วยงานเดียวกัน + `ORGANIZATION_USER` ไม่ผ่าน = 404) ข้อมูลผ่าน `submitSchema`
  ที่อยู่ถูกต้องตามฐานข้อมูล (`isValidAddress`, `organizations.ts:1815`) อีเมล/เลขบัตรของผู้มีอำนาจฯ ไม่ชนใคร (`approverConflict`, `:1834`)
  มีคำสั่งแต่งตั้งที่ ACTIVE และ render ได้อย่างน้อยหนึ่งฉบับ — ข้อใดไม่ผ่านได้ 4xx ไม่มีแถว
- `POST /api/dataset-requests/:id/generate-form` — `mayEdit` (ไม่ผ่าน = 404) ข้อมูลผ่าน `datasetSubmitSchema` มี `DATA_DICTIONARY` ที่ ACTIVE และ render ได้อย่างน้อยหนึ่งฉบับ

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
- **โค้ด** `routes/organizations.ts:1883` · `routes/dataset-requests.ts:1291`

#### `REQUEST_SUBMITTED` — นำส่งคำขอ (และด่านของหน่วยงานที่ผ่านแต่ยังไม่จบ)

**เกิดเมื่อ**
- `POST /api/organizations/:id/submit` — คำขอ `DRAFT`/`RETURNED` ผ่าน `submitSchema` รหัสหน่วยงานไม่เป็นของหน่วยงานอื่น (`organizations.ts:2219`)
  ผู้มีอำนาจฯ ไม่ชนใคร (`approverConflict`, `:2237`) มีเอกสารที่สร้างแล้ว มีผู้ประสานงาน BDI อย่างน้อยหนึ่งคน — ข้อใดไม่ผ่านได้ 4xx ไม่มีแถว
- `POST /api/dataset-requests/:id/submit` — คำขอ `DRAFT`/`RETURNED` ผ่าน `datasetSubmitSchema` มี `DATA_DICTIONARY` และ `GENERATED_FORM` ที่ ACTIVE มีผู้ประสานงาน BDI
- **`POST /api/organizations/:id/review`** — ผลเป็น `PASSED` หรือ `APPROVED` แต่คำขอยังไม่ถึง `APPROVED` (ด่าน `BDI_OFFICER_REVIEW` และ `ORGANIZATION_APPROVAL`) รายละเอียดที่ 4.9

| ช่อง | นำส่ง | ด่านตรวจของหน่วยงาน |
|---|---|---|
| actor | **แถว session** = ผู้นำส่ง | **แถว session** = ผู้ตรวจ |
| subject | ORR หรือ DRR · คำขอ | ORR · คำขอ |
| organization_id | หน่วยงานของคำขอ | หน่วยงานของคำขอ |
| before / after | null / `{requestNumber}` | null / `{taskType, result, note}` |
| metadata | ไม่มี (มีแต่คีย์ระบบ) | ไม่มี |

- **รูปของ `after` คือทางเดียวที่แยกการนำส่งจริงออกจากการผ่านด่าน** (แผนยก `after.taskType` ขึ้นเป็น `gate` ในสำเนา Mongo ส่วนการใช้มัน
  จัด category เป็น `review` ตามตาราง 3.5 เป็น **[ข้อเสนอ]**)
- นำส่งครั้งแรกกับนำส่งใหม่หลัง `RETURNED` แยกกันไม่ได้ในแถว ต้องดูว่ามี `REQUEST_RETURNED` มาก่อนหรือไม่ · การเปิดด่าน
  `BDI_OFFICER_REVIEW` ไม่มีแถวของตัวเอง
- ฝั่งชุดข้อมูลเขียน**หลัง** `notifyUsers()` ถ้าการแจ้งเตือน throw การนำส่ง commit แล้วแต่ไม่มีแถว
- **โค้ด** `routes/organizations.ts:2285` · `routes/dataset-requests.ts:1420` · `routes/organizations.ts:2783` (ด่านตรวจ)

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
| `request_number` | เลขที่คำขอ — ที่เดียวที่เหลือ เพราะแถวคำขอหายแล้ว relay ของแผนหา `requestNumber` จากตารางคำขอด้วย id เท่านั้น จึงได้ null การใช้คีย์นี้เป็นค่าสำรองเป็น **[ข้อเสนอ]** (3.2) | `"DS-REG-2026-0003"` |
| `removed_counts` | จำนวนที่ถูกลบตาม `{legalAcceptances, signatures, reviewTasks, notifications, integrationOperations, attachments, datasets}` | `{"reviewTasks": 4, "attachments": 3, …}` |

- object ของไฟล์ยังอยู่ใน bucket — `storageKey` ในแถวนี้มีไว้ตามไปเก็บกวาด แต่ `attachments` มีแค่ไฟล์ที่ยัง **ACTIVE** (ของคำขอและของ
  ชุดข้อมูลที่เกิดจากมัน `admin-registrations.ts:1066-1083`) ไฟล์ที่ `REPLACED` หรือถูกลบจากฟอร์มไปก่อนหน้าไม่อยู่ในรายการ รายการนี้จึง
  **ไม่ใช่บัญชีครบ**ของ object ที่ต้องเก็บกวาด — ไฟล์ที่เหลือหาได้จาก `attachment.attachment` ที่ `owner_id` = id ของคำขอ
- **ข้อมูลส่วนบุคคล** `createdBy` ชื่อไฟล์ `reason` — สำเนา `audit_fallback` ที่สร้างแล้วแทนเลข 13 หลักในทุกค่าที่เป็นข้อความด้วย `[cid]` รวม
  `title` และ `attachments[].originalFileName` (3.14) · relay ตามแบบ (3.6 [ออกแบบ]) ปิดแค่ใน `reason` ไม่แตะชื่อไฟล์
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
  `attachment.owner_id` / `replaced_attachment_id` · สำเนา Mongo หา `requestNumber` ของแถวนี้จาก subject ไม่ได้
- **ข้อมูลส่วนบุคคล** `filename` เป็นข้อความที่ผู้ใช้ตั้งเอง อาจมีชื่อคนหรือเลขบัตร ไม่ปิด
- **ตัวอย่าง** `{"after": {"attachmentType": "DATA_DICTIONARY", "filename": "พจนานุกรมข้อมูล_OPD.xlsx"}}`
- **โค้ด** `routes/organizations.ts:1644` · `routes/dataset-requests.ts:1081`

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

- **โค้ด** `routes/organizations.ts:1777` · `routes/dataset-requests.ts:1211`

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
  (`findRequestByRequestOrOrganizationId()`, `organizations.ts:2088`) — แถวไม่บันทึกว่าเรียกด้วยแบบไหน
- **โค้ด** `routes/organizations.ts:1679` · `:2144` · `:2180` · `routes/dataset-requests.ts:1115` · `:1710` · `:1744`

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
  `render.agreement-after-commit` / `render.dataset-document-after-commit` (`organizations.ts:2955` · `dataset-requests.ts:2176`, 5.1) เท่านั้น ·
  ถ้าล้ม**ก่อน** commit ไม่มีแถวใดถูกเขียน และ 5xx นั้นถูกเก็บเป็น `render:<code>` ที่ตัวจัดการท้าย `index.ts` — route ตรวจของหน่วยงานส่ง
  `DocumentRenderError` ต่อด้วย `next(err)` ตั้งแต่ขั้น 5 (ตัวอย่างใน 5.2)
- **ตัวอย่าง** `{"after": {"confirmationType": "ORGANIZATION_APPROVAL", "documentVersionIds": ["9b0e…"]}}`
- **โค้ด** `routes/organizations.ts:2822` · `routes/dataset-requests.ts:2136`

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
เหมือนทุก action ที่ไม่ใช่ `approve` `organizations.ts:2390`) — ตัวแยกที่เชื่อได้คือ **`actor_roles` ที่มี `BDI_OFFICER`** (ผู้มีอำนาจฯ ไม่มี role นั้น)
แถว `APPROVER_INVITATION_RECALLED` ที่ correlation id เดียวกันมี**เฉพาะ**เมื่อ `releaseApproverSeat()` คืนที่นั่ง — ไม่มีเมื่อคำขอไม่มี
`approverEmail` หรือหาบัญชีของอีเมลนั้นไม่เจอ (`lib/approver-seat.ts:63-66`) การไม่มีแถวนั้นจึงไม่ได้แปลว่าไม่ใช่ recall

#### `REQUEST_APPROVED` · `REQUEST_RETURNED` · `REQUEST_REJECTED` — ผลของด่าน

**เกิดเมื่อ** — `POST /api/organizations/:id/review` และ `POST /api/dataset-requests/:id/review` ตามตารางข้างบน หลังธุรกรรมของการตรวจ commit
(WorkflowError เช่นไม่มีผู้ตรวจของด่านถัดไป = rollback ไม่มีแถว · render ฉบับลงนามที่ล้ม**หลัง** commit ไม่ย้อนอะไร แถวอยู่ครบและคำขอตอบ 200 — `DOCUMENT_SIGNED` ใน 4.8)

| ช่อง | ค่า |
|---|---|
| actor | **แถว session** = ผู้ถือ role ของด่าน (`BDI_OFFICER` · `ORGANIZATION_APPROVER` · `BDI_FINAL_APPROVER`) — **ยกเว้น recall**: `REQUEST_RETURNED` ที่ `after.taskType ORGANIZATION_APPROVAL` เขียนโดย `BDI_OFFICER` ซึ่งไม่ได้ถือ role ของด่านนั้น (ทาง recall ข้ามการตรวจ role ไปใช้ `recallRefusal()` แทน `organizations.ts:2443-2448`) |
| subject / organization_id | ORR หรือ DRR · คำขอ / หน่วยงานของคำขอ |
| result | `SUCCESS` |
| before / after | null / `{taskType, result, note?}` |

| metadata | ความหมาย | ตัวอย่าง |
|---|---|---|
| `dataset_id` | *ชุดข้อมูล `BDI_FINAL_APPROVAL` เท่านั้น* — ชุดข้อมูลที่การอนุมัตินี้สร้าง | `"a8e3…"` |
| `integration_operation_id` | *เหมือนข้างบน* — งาน DII `PUBLISH_DATASET_REFERENCE` ที่รอส่ง (correlation id เดียวกับแถวนี้) | `"51fd…"` |

- **ข้อมูลส่วนบุคคล** `note` เป็นข้อความอิสระของผู้ตรวจ (ส่งกลับและปฏิเสธต้องมี) ไม่ปิดใน Postgres สำเนา Mongo ปิดเลข 13 หลักในนั้น
- `note` ไม่มีเพดานใน zod ยาวได้เท่าเพดาน body 1 MB (`index.ts:51`) ขณะที่เอกสาร `activity` หนึ่งตัวต้องไม่เกิน 64 KB (แผน §3) —
  **[ต้องตัดสิน]** relay ทำอย่างไรกับแถวที่ใหญ่เกิน (ตัด ข้าม หรือล้ม) แผนและเอกสารนี้ยังไม่ได้กำหนด ใช้กับ `SPECIALIST_COMMENT_RECORDED` ด้วย ·
  ทาง `audit_fallback` ที่สร้างแล้วแทน `before`/`after` ด้วย `{truncated: true}` (3.14)
- **ตัวอย่าง** `{"after": {"taskType": "BDI_FINAL_APPROVAL", "result": "APPROVED", "note": "ข้อมูลครบถ้วน อนุมัติ"}, "metadata": {"dataset_id": "e1f2…", "integration_operation_id": "0a1b…"}}`
- **โค้ด** `routes/organizations.ts:2783` · `routes/dataset-requests.ts:2115`

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
  `after.note` นี้ด้วย (แผน §7.6 เขียนแค่ “`note`” การรวมรหัสนี้เป็น **[ข้อเสนอ]** ตาม 3.6)
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

### 4.11 หมวด admin token

#### `ADMIN_TOKEN_REJECTED` — `x-admin-token` ผิดหรือไม่ได้ส่ง

token นี้เปิดทุกอย่างใต้ `/api/admin` ไม่หมดอายุ และเคยหลุดมาแล้ว การเดาหรือการใช้ค่าเก่าหลังหมุนต้องมองเห็นได้ แต่ 401 ใครก็ยิงได้
ไม่จำกัด จึงเขียนแบบ throttle (เหตุผลเต็มอยู่ docs/09 §4.1 และหัวไฟล์ `lib/token-rejection.ts`) ในสำเนา Mongo อยู่ category `auth`
**[ข้อเสนอ]** (แผนระบุแค่ว่า `*_TOKEN_REJECTED` ถูกลบที่ 400 วันคู่กับ auth และ session — 3.5 · ตารางชั่วคราวของ `audit_fallback` ก็ให้ `auth`)

**เกิดเมื่อ**
- คำขอใดก็ได้ใต้ `/api/admin/*` `/api/admin/users/*` `/api/admin/registrations/*` (รวม path ที่ไม่มีจริง) ที่ `x-admin-token` ผิดหรือไม่มี —
  `requireAdminToken` เรียก `adminTokenRejections.record()` แล้วตอบ 401 ทันที การตัดสินว่าได้แถวไหมอยู่ในตารางนี้:

| ชนิดแถว | เมื่อไร | `correlation_id` | IP / UA | metadata |
|---|---|---|---|---|
| **ทันที** | ครั้งแรกของที่มา (IP) ในหน้าต่าง 10 นาที และงบแถวทันทีรวมทุก IP (20 แถวในช่วง 10 นาทีใด ๆ แบบหน้าต่างเลื่อน) ยังเหลือ | ของคำขอ | มี — ยกเว้นที่มาที่ไม่ใช่ IP: `req.ip` ที่ไม่ใช่รูป IP ทุกค่าใช้หน้าต่างเดียวกัน (`UNPARSED_KEY`) แถวได้ IP null + `ip_unparsed: true` · คำขอที่ไม่มี `req.ip` เลยใช้อีกถัง (`NO_ADDRESS_KEY`) IP null ไม่มีธง (`token-rejection.ts:82-83` `:365-373`) | `method` `path` `token_present` `token_fp` [+ `watched_over_budget`] |
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
| `path` | **รูปแบบ** ของ path ไม่ใช่ข้อความดิบ: ตัด query ถอด `%xx` UUID → `:id` ตัวอักษรนอก `A-Za-z0-9/_.:-` → `_` กลุ่มเลขที่ชี้ตัวคน → `:n` แล้ว**ชั้นที่สอง**: ถ้าเลขที่เหลือทั้ง path ยังรวมได้ 9 หลักขึ้นไป เลขทุกช่วงกลายเป็น `:n` (จับเลขบัตรที่แยกด้วย `/` หรือ encode ซ้อน `token-rejection.ts:188-189`) ยาวไม่เกิน 120 | `"/api/admin/users/:id/suspend"` |
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
- **โค้ด** `lib/token-rejection.ts:269` (`write()` จุดเดียว · แถวทันที `:417` · token ที่เฝ้า `:384` · สรุป `:275` · flush `:353`) · recorder สร้างที่ `middleware/auth.ts:145-149`
  · แถวที่เขียนไม่สำเร็จ (ทันที สรุปของตัวกวาด หรือ flush ตอน shutdown) ล้มใน `logAudit` จึงได้ `audit.write-failed` กับสำเนา `audit_fallback` เหมือนแถวอื่น (3.14)
  — `write()` ถูกยิงด้วย `void` และ `logAudit` ไม่ reject · error `audit.token-rejection` (`:426`) คือ catch รอบตัว `record()` ที่เป็น synchronous: ความล้มเหลวของ
  การทำบัญชีของตัวบันทึกเอง (`tokenFingerprint` `pathPattern` `parseClientIp` หน้าต่างและงบ) ไม่ใช่การเขียนแถวที่ล้ม (5.1)

---

### 4.12 ที่ประกาศไว้แต่ไม่มีใครเขียน

| อะไร | ชนิด | หมายเหตุ |
|---|---|---|
| `DATA_EXPORTED` | action | มีในรายการตัวอย่างของ Excel ยังไม่มีฟีเจอร์ส่งออกข้อมูล |
| `DATASET` | subject | ชุดข้อมูลที่ลงทะเบียนแล้ว — การสร้างชุดข้อมูลบันทึกผ่าน `REQUEST_APPROVED.metadata.dataset_id` แทน |
| `DATA_REQUEST` | subject | คำขอใช้ข้อมูล — ยังไม่มีฟีเจอร์ |
| `APPROVAL` | subject | ผลการตรวจบันทึกบน subject ของคำขอแทน |
| `NOTIFICATION` | subject | ไม่มีจุดใดใช้ใน `audit_event` |
| `EXTERNAL` | `actor_type` | ความหมายตาม Excel ของผู้เรียกทาง admin token — งานของการ์ด Admin Portal |

### 4.13 รหัสที่จะมาในขั้นถัดไป — **ยังไม่มีในโค้ด**

| รหัส | ขั้น | ลงที่ไหน | เกิดเมื่อ | รูปที่ออกแบบไว้ |
|---|---|---|---|---|
| `AUDIT_LOG_READ` | 7 | Postgres (สำรองลง Mongo `audit_fallback`) | ทุกการอ่าน `/api/admin/logs/*` ยกเว้น `/status` **ก่อน**ส่งข้อมูล | subject `AUDIT_LOG` (subject ใหม่) · `metadata {reader, reason, endpoint, filters, token_fp, page}` · ใน `filters` ค่า `cid` `email` และ `person` ที่เป็นอีเมลเก็บเป็น HMAC key เท่านั้น · category `log-access` · `via LOG_TOKEN` |
| `LOG_TOKEN_REJECTED` | 7 | Postgres | `x-log-token` ผิด (401) — throttle แบบเดียวกับ `ADMIN_TOKEN_REJECTED` | แถวนิรนาม `FAILURE` · category `auth` **[ข้อเสนอ]** · ลบที่ 400 วันในสำเนา (ตาราง retention ของแผน) |
| `ERROR_ISSUE_STATUS_CHANGED` | 7 | Postgres | `PATCH /api/admin/logs/errors/issues/:fingerprint` `{status, reason}` | subject `ERROR_ISSUE` (ใหม่) · **`subject_id` null** เพราะ fingerprint 40 ตัวไม่ใช่ uuid · `metadata.fingerprint` · category `log-access` **[ข้อเสนอ]** — การค้นด้วย subject จึงหาไม่เจอ |
| `ADMIN_API_REQUEST` | 8 | **Mongo เท่านั้น** (`activity`, `source:"http"`) | ทุก `/api/admin*` รวมการอ่าน ยกเว้น `/api/admin/logs*` (การอ่าน admin ได้เลขบัตรเต็ม) | ดู 3.7 · ไม่เก็บตอนเกินเพดาน · ลบที่ 400 วัน |

---

## 5. Error events (แบบ Sentry)

> **สร้างแล้วที่ `2cab0a7` (ขั้น 5)** สำหรับ backend และ delivery-worker: `lib/error-capture.ts` (เก็บ คิว และตัวนับของ issue) ·
> `lib/redact.ts` (การกวาด) · `workers/log-upkeep.ts` (index และเพดานขนาด) · รหัสอ้างอิงบนคำตอบ 5xx แบบ `{error}` ที่ส่งผ่าน `res.json` (5.8) ·
> breadcrumb · process handler
> **ยัง [ออกแบบ · ยังไม่สร้าง]**: error จากเบราว์เซอร์และ Next server กับ `POST /api/client-errors` (ขั้น 9) · API อ่านและเปลี่ยนสถานะ issue
> (ขั้น 7) · อีเมลแจ้งเตือน (ขั้น 10) · prune ตามอายุ (ขั้น 6)
>
> error **ไม่ผ่าน Postgres** เพื่อให้ยังเก็บได้ตอน Postgres ล่ม ก่อนการ์ดนี้ error ไปที่ `console.error` / `docker logs` อย่างเดียว ซึ่งหายทุกครั้งที่
> deploy `main/` และพิมพ์ error ดิบที่มีข้อมูลส่วนบุคคลปน (แถวทั้งแถวที่ Postgres ปฏิเสธ อีเมลผู้รับที่ SMTP ปฏิเสธ) วันนี้ทุกจุดพิมพ์บรรทัด
> `[capture]` ที่กวาดแล้วแทน และห้ามส่ง error หรือ `message` ของมันให้ `console.*` ตรง ๆ (`CLAUDE.md` Traps)

### 5.1 เก็บจากที่ไหน · สร้างแล้ว (ยกเว้นแถวที่ติดป้าย)

`captureError(err, options)` (`lib/error-capture.ts:260`) ทำงานแบบ synchronous และไม่ throw: กวาด error (5.6) นับเข้า issue พิมพ์**บรรทัดเดียว**
ลง log ของ container (5.8 — เว้นแต่จุดเก็บส่ง `print: false`) แล้ววางลงคิวในหน่วยความจำ (5.7) — ไม่มีอะไรบนเส้นทางของคำขอรอ Mongo คืน id ของ event หรือ null ถ้าไม่ได้เข้าคิว
ไฟล์นี้ไม่เรียก `logAudit()` ทางใดเลย ความล้มเหลวของ audit จึงวนกลับมาไม่ได้

**backend**

| จุดเก็บ | level | tag | fingerprint | โค้ด |
|---|---|---|---|---|
| 500 ทั่วไปของ error middleware ตัวสุดท้าย | error | — | ตั้งต้น | `index.ts:352` |
| Prisma known code ที่แปลงเป็น 4xx (`P2002` `P2003` `P2000` `P2025` `P2023`) — สัญญาณว่า route ยังไม่ดักเคสของตัวเอง | warning | `prisma.<code>` | `prisma:<code>:<METHOD route>` | `index.ts:326` |
| Prisma ที่แปลงเป็น 503 (`P1001` `P1002` `P1008` `P1017` `P2024` — ฐานข้อมูลติดต่อไม่ได้ หรือ pool เต็ม) | **error** | `prisma.<code>` | `prisma:<code>:<METHOD route>` | `index.ts:326` |
| `PrismaClientInitializationError` ที่ไม่มีรหัสในตาราง | error | `prisma.init` | ตั้งต้น | `index.ts:340` |
| `DocumentRenderError` ≥ 500 (4xx ยังพิมพ์บรรทัด `[backend] <code>:` แบบเดิม ไม่เก็บ) | error | `render.<code>` | `render:<code>` | `index.ts:298` |
| error หลังส่งหัวคำตอบไปแล้ว — ปิด socket เอง **ไม่ส่งต่อ `next(err)`** เพราะ finalhandler ของ Express พิมพ์ `err.stack` ดิบ | error | `http.after-headers-sent` | ตั้งต้น | `index.ts:230` |
| body ที่อ่านไม่ออก ใหญ่เกิน หรือเข้ารหัสแบบที่ไม่รองรับ (`RequestBodyError` 400/413/415) — **ไม่พิมพ์** ผู้เรียกยิงถี่ได้เท่าที่ต้องการ | warning | `http.request-body` | `http:request-body:<status>` | `index.ts:250` |
| 5xx ที่ route ตอบเองด้วย `res.json({error: "<สตริง>", …})` โดยยังไม่มีอะไรในคำขอนั้นถูกเก็บ (503 `no_reviewer` `no_legal_documents` · 501 ThaID ยังไม่ตั้งค่า · 502 ของ ThaID ที่ไม่ได้ถูกเก็บ) — 5xx ที่ส่งทาง `res.send` `res.end` `sendStatus` หรือ body ที่ไม่มี `error` เป็นสตริงไม่ถูกเก็บ | warning | `http.route-5xx` | `http:5xx:<METHOD route>:<error ≤ 64 ตัว>` | `index.ts:115` (5.8) |
| `logAudit` ล้ม — อ่าน snapshot ของผู้กระทำหรือ INSERT | error | `audit.write-failed` | ตั้งต้น | `lib/audit-fallback.ts:116` (3.14) |
| ตัวบันทึกของ `ADMIN_TOKEN_REJECTED` ล้มในงานของตัวเอง (catch รอบ `record()`: fingerprint แม่แบบ path แยก IP หน้าต่างและงบ) — แถวที่เขียนไม่สำเร็จไม่มาที่นี่ มันล้มใน `logAudit` จึงเป็น `audit.write-failed` | error | `audit.token-rejection` | ตั้งต้น | `lib/token-rejection.ts:426` |
| render เอกสารฉบับลงนามหลัง commit ไม่สำเร็จ (คำขอยังตอบ 200) | error | `render.agreement-after-commit` · `render.dataset-document-after-commit` | ตั้งต้น | `routes/organizations.ts:2955` · `routes/dataset-requests.ts:2176` |
| อีเมลเชิญผู้มีอำนาจฯ ที่ส่งแบบไม่รอ ส่งไม่สำเร็จ | error | `mail.approver-invitation` | ตั้งต้น | `routes/organizations.ts:3271` |
| แลก code หรือตรวจ id_token ของ ThaID ไม่ผ่าน | warning (`nonce_mismatch` `nonce_missing`) · error (อื่น) | `thaid.resolve-identity` | ตั้งต้น | `routes/auth.ts:378` |
| ThaID ไม่ส่งเลขบัตรใน claim ที่เลือก — ตั้งค่าผิดฝั่งเรา ทุกคนติดเหมือนกัน | error | `thaid.cid-unavailable` | `thaid:cid-unavailable:<claim>` | `routes/auth.ts:423` |
| revoke token ของ ThaID ไม่สำเร็จ (ข้ามไป ไม่กระทบผู้ใช้) | warning | `thaid.revoke` | ตั้งต้น | `lib/thaid.ts:181` |
| อ่านตาราง `administration.dataset_choice` ไม่ได้ · บูตแล้วยังใช้ค่าตั้งต้นในโค้ด | warning | `dataset-choices.read-failed` · `dataset-choices.defaults` | ตั้งต้น · `dataset-choices:defaults` | `lib/dataset-choices.ts:157` `:181` |
| `ensureContainer()` ตอนบูตไม่สำเร็จ | warning | `storage.ensure-container` | ตั้งต้น | `index.ts:380` |
| `main()` ล้มตอนบูต | fatal แล้ว exit 1 | `startup` | ตั้งต้น | `index.ts:434` |
| `unhandledRejection` | error · `handled: false` | — | ตั้งต้น | process ทำงานต่อ (5.10) |
| `uncaughtException` | fatal · `handled: false` | — | ตั้งต้น | exit 1 (5.10) |

**delivery-worker**

| จุดเก็บ | level | tag | fingerprint |
|---|---|---|---|
| ส่งอีเมลไม่สำเร็จ**ทุกครั้ง** (ล้มแล้ว retry ผ่านเป็นเรื่องปกติ) | warning | `delivery.send-failed` | `smtp:<responseCode หรือ E-code>` เช่น `smtp:535` `smtp:ECONNECTION` · ไม่มีรหัส = ตั้งต้น · `extra {deliveryId, attempt, notificationType}` |
| ครบ `DELIVERY_MAX_ATTEMPTS` แล้วเลิกส่ง (`DEAD_LETTER`) | error | `delivery.dead-letter` | `delivery:dead-letter:<notificationType>` · error ต้นทางอยู่ใน `causes` |
| รอบของ loop ส่งอีเมลล้ม | error | `delivery.tick` | ตั้งต้น |
| `main()` ล้ม | fatal แล้ว exit 1 | `delivery.main` | ตั้งต้น |
| สร้าง index ไม่ได้ด้วยเหตุที่ลองใหม่ก็ไม่ผ่าน | warning | `log-upkeep.index` | ตั้งต้น · ครั้งเดียวต่อ index ต่อ process |
| รอบของงานดูแล log store ล้ม | warning | `log-upkeep.tick` | ตั้งต้น · ไม่ถี่กว่าครั้งละ 10 นาที |
| ขนาดเกินเพดาน ตอนธงเพิ่งตั้ง — ไม่พิมพ์ (บรรทัด `[log-store]` ของตัวเองพิมพ์ไปแล้ว) | warning | `log-store.over-quota` | `log-store:over-quota` |
| `unhandledRejection` · `uncaughtException` | เหมือน backend | — | ตั้งต้น |

ทั้งสอง process ยังเขียน event สรุป `error-capture.dropped` (fingerprint `error-capture:dropped:<service>`) หลังช่วงที่ทิ้งของ (5.7)
`delivery.send-failed` และ `delivery.dead-letter` เกิดใน `runWithContext` ของแถว (`workers/delivery.ts:179-180`) จึงถือ correlation id ของคำขอที่สร้างการแจ้งเตือน
นั้น — dead letter ค้นเจอด้วยรหัสอ้างอิงเดียวกับคลิกต้นเรื่อง · **ที่เหลือของ worker ไม่มีบริบท**: `delivery.tick` (`claimBatch()` ล้ม หรือ error ที่หลุดจาก catch
ของ `deliver()` เอง เช่นเขียนสถานะ `FAILED` ไม่ได้ — `:215-222`) `delivery.main` และทุก capture ของงานดูแล log store ได้ `request: null` และบรรทัด `[capture]`
ไม่มี `ref=`

จุดที่เคยพิมพ์ error ดิบยังพิมพ์บรรทัดบอกที่เกิดเป็นภาษาไทย แต่จบด้วย `— ดูบรรทัด [capture] ถัดไป` แทนข้อความของ error
(เช่น `[thaid] <code>` · `[delivery] ส่งไม่สำเร็จ ครั้งที่ 3 (535)` · `[startup] could not ensure container`) และ log ของ Prisma เอง
(`db.ts`) ออกเป็น event แล้วพิมพ์ `prisma:error <target> — <บรรทัดที่กวาดแล้ว>` (`databaseLogLine()`, 5.6) — **ไม่ถูกเก็บลง log store**

**ต่างจากแบบ:** Prisma ที่แปลงเป็น 503 เก็บเป็น error ไม่ใช่ warning (ระบบล่มต้องไม่ดูเป็นคำเตือน และขั้น 10 ไม่แจ้งเตือน warning) ·
`RequestBodyError` ถูกเก็บเป็น warning ที่ไม่พิมพ์ (แบบเขียนว่าไม่พิมพ์และไม่เก็บ) · fingerprint ที่เพิ่มจากแผน: `http:request-body:*` `http:5xx:*`
`thaid:cid-unavailable:*` `dataset-choices:defaults` `log-store:over-quota` `error-capture:dropped:*` · capture ระดับ route (ThaID, render หลัง
commit, คำเชิญ) มี `request.status` เป็น null เพราะเก็บก่อน route เลือก status ส่วน capture ของ middleware มี status

| process | จุดเก็บ [ออกแบบ · ยังไม่สร้าง] |
|---|---|
| Next server (ขั้น 9) | `onRequestError` และ listener ของ process ใน `register()` → บรรทัด stdout + POST ที่ลงนามด้วย `INGEST_SERVER_TOKEN` ไป `/api/client-errors` — `CaptureService` วันนี้รับแค่ `backend` `delivery-worker` |
| เบราว์เซอร์ (ขั้น 9) | `window` `error` / `unhandledrejection` · `global-error` · รหัสอ้างอิงของ 502 จาก proxy ที่ค้างไว้ส่งทีหลัง — **ไม่รายงาน**: `ApiError` ที่ status < 500 · 5xx ของ backend (backend เก็บไปแล้ว) ยกเว้น `backend_unreachable` ที่ backend ไม่เคยเห็น · รายงานซ้ำ (ตัดด้วยข้อความ + frame แรก) ไม่เกิน 10 ต่อการโหลดหน้า · ส่งแค่ `pathname` ไม่อ่าน `search` `hash` หรือ `sessionStorage` นอกจากคิวของตัวเอง `bdi.pendingErrorReports` (≤ 5 รายการ) · ในคิวถูกทิ้งก่อนทุกอย่าง (ชั้น 0 — 5.7) |

### 5.2 `error_events` — หนึ่งเอกสารต่อหนึ่งครั้งที่เกิด · สร้างแล้ว

| ฟิลด์ | ชนิด | ค่า |
|---|---|---|
| `_id` | UUID string | อยู่ในบรรทัด `[capture]` ด้วย (`event=…`) |
| `occurredAt` | Date | เวลาที่ `captureError` ถูกเรียก |
| `fingerprint` | string | 5.4 |
| `level` | `fatal` \| `error` \| `warning` | จุดเก็บกำหนด ค่าตั้งต้น `error` · `warning` ไม่มีวันแจ้งเตือน (ขั้น 10) |
| `handled` | bool | `false` เฉพาะ `unhandledRejection` และ `uncaughtException` · `true` นอกนั้น รวม error middleware และ fatal ของ `startup` |
| `tag` | string \| null | 5.1 · null สำหรับ 500 ทั่วไปและ process handler |
| `service` | `backend` \| `delivery-worker` | (`frontend-server` `browser` ขั้น 9 [ออกแบบ]) |
| `environment` · `release` | string | `DEPLOY_ENV` · `RELEASE` (5.10) |
| `host` | `{containerId, startedAt}` | `os.hostname()` ซึ่งใน container คือ id สั้นของ container · เวลาที่ process เริ่ม |
| `mechanism` | `express` \| `captured` \| `unhandledRejection` \| `uncaughtException` | `express` เมื่อจุดเก็บส่ง `req` มา · `captured` เมื่อไม่ส่ง |
| `error.name` | string | `name` ของ error หรือชื่อ constructor เมื่อ `name` เป็น `"Error"` (`DocumentRenderError` `ThaidError` …) ≤ 100 ตัว · ค่าที่ไม่ใช่ Error แต่เป็น object ที่มี `name` เป็นสตริงไม่ว่าง ได้ชื่อนั้น (กวาดแล้ว ≤ 100) · นอกนั้น (สตริง ตัวเลข object ไม่มีชื่อ) ได้ `NonError` |
| `error.message` | string | กวาดแล้ว (5.6) ≤ 2,048 ตัว · `PrismaClientValidationError` เหลือบรรทัดแรกที่ไม่ว่าง (บรรทัดถัดไปคือ argument ของ query พร้อมค่า) |
| `error.stack` | string \| null | **ประกอบใหม่** ไม่ใช่ stack ดิบ: บรรทัดหัว `name: message` ที่กวาดแล้ว + เฉพาะบรรทัด `at …` แล้วกวาดอีกรอบ ≤ 16,384 ตัว · image ของ production **ตั้งไว้**ให้รันด้วย `--enable-source-maps` (`backend/Dockerfile` · `tsconfig` ออก `.map`) เพื่อให้เฟรมชี้ `/app/src/*.ts` — **[ยังไม่ได้ลอง]** ด่าน prod-build (T) ยังไม่เคยรัน ถ้าไม่ได้ผล เฟรมเป็น `/app/dist/*.js` |
| `error.props` | object | เฉพาะ `code` `status` `statusCode` `type` `errorCode` `responseCode` `command` `syscall` (สตริงกวาดแล้ว ≤ 200) + `metaTarget` จาก `meta.target` ของ Prisma (ชื่อคอลัมน์ ไม่ใช่ค่า) |
| `error.causes` | array ≤ 3 | `{name, message ≤ 1,024, props}` ตามสาย `cause` |
| `request` | object \| null | null เมื่อไม่มีบริบทของคำขอและไม่ได้ส่ง `req` (ตอนบูต) · `{method, route, path, queryKeys, status, durationMs, correlationId, reference, ip, userAgent, bodyShape}` — `route` คือแม่แบบที่ `wrap()` จด (`lib/async-route.ts`) null ถ้ายังไม่ถึง route (guard ของ `router.use`) · `path` ไม่มี query กวาดแล้ว ≤ 300 · `queryKeys` เฉพาะ**ชื่อ** ≤ 20 · `status` ที่จุดเก็บส่งมา · `durationMs` จากต้นคำขอถึงตอนเก็บ · `ip` ตาม `parseClientIp` (2.6) · `userAgent` กวาดแล้ว ≤ 512 · **`path` `queryKeys` `bodyShape` มีเฉพาะเมื่อจุดเก็บส่ง `req`** (5.6) — capture ในคำขอที่ไม่ส่ง `req` (`audit.write-failed` `audit.token-rejection` `thaid.revoke` `mail.approver-invitation` `dataset-choices.*` ตอน refresh) ได้ `method` `route` `correlationId` จากบริบท แต่ `path` null `queryKeys` `[]` `bodyShape` null · ใน worker `method` `route` `path` เป็น null แต่ `correlationId` เป็นของแถวที่ส่ง |
| `actor` | object \| null | `{id, roles, organizationId, sessionId}` จาก session ที่ `requireAuth` ตั้ง — `roles` คือ role ที่มีผลในคำขอนั้น · `sessionId` คือ id ของแถว `iam.session` **ไม่ใช่ค่า cookie** · capture ที่ไม่ส่ง `req` ได้ id จาก `actorId` ของบริบท จึงเป็น `{id, roles: [], organizationId: null, sessionId: null}` แม้ผู้ใช้จะล็อกอินอยู่ · null บนเส้นทาง admin token เส้นทางสาธารณะ และใน worker · ไม่มีชื่อคน |
| `breadcrumbs` | array ≤ 30 | ของคำขอนั้น ล่าสุด 30 รายการ (ตารางข้างล่าง) |
| `extra` | object \| null | ข้อมูลที่จุดเก็บส่งมา**ซึ่งต้องกวาดมาเอง** ≤ 16 KB ไม่งั้นเหลือ `{truncated: true, bytes, keys}` (`keys` ชื่อคีย์ชั้นบนไม่เกิน 20 ชื่อ) · `JSON.stringify` ไม่ผ่าน (อ้างวนกลับตัวเอง · `BigInt`) = `{unserialisable: true}` · `{audit}` ของ `audit.write-failed` (3.14) · `{referenceOnly, capped}` ของตัวย่อ (5.8) · `{dropped, from, to, reasons, auditCopies}` ของ event สรุป (5.7) |
| `browser` · `ingest` | null | ขั้น 9 [ออกแบบ]: `{pathname, digest, reference, lastApi[≤5]}` · `{verified, claimedService}` |

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
| `storage` | เขียนหรืออ่าน blob | `"เขียนไฟล์ 182344 ไบต์"` · `"เปิดไฟล์เพื่ออ่านแบบสตรีม"` · `"อ่านไฟล์ทั้งก้อน"` · ต่อท้าย `— ไม่สำเร็จ` เมื่อล้ม |
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

### 5.3 `error_issues` — หนึ่งเอกสารต่อ fingerprint · สร้างแล้ว

ตัว flush ของแต่ละ process เขียน issue ทีละก้อน: ทุก fingerprint ในก้อนได้สอง operation — upsert ตัวนับ แล้ว update แบบมีเงื่อนไขที่เปิด issue ที่
`resolved` กลับ (5.4)

| ฟิลด์ | เขียนด้วย | ค่า |
|---|---|---|
| `_id` | — | fingerprint |
| `service` · `firstRelease` | `$setOnInsert` | process และ `RELEASE` ของครั้งแรกที่เขียน |
| `title` | `$set` ทุก flush | `<name>: <หัวเรื่องที่ normalize แล้ว>` ≤ 200 (5.4) ของการเกิดครั้งแรก**ในก้อนนั้น** |
| `culprit` | `$set` | `METHOD route` · หรือ tag · หรือเฟรมแรกในโค้ดเรา · หรือชื่อ service ≤ 200 |
| `level` · `tag` | `$set` | `level` ของการเกิดล่าสุดในก้อน · `tag` ของการเกิดครั้งแรกในก้อน |
| `count` | `$inc` | จำนวนในก้อน รวมตัวที่ติดเพดานการสุ่มเก็บและตอนเกินเพดานขนาด — **ค่าประมาณ** นับซ้ำได้ทั้งก้อนหลัง Mongo ค้าง (5.7) |
| `firstSeen` / `lastSeen` | `$min` / `$max` | |
| `lastRelease` | `$set` | `RELEASE` ของ process ที่ flush |
| `lastEventId` | `$set` เฉพาะเมื่อก้อนนั้นมี event ที่เข้าคิว | ตอนสร้าง null · อาจเก่ากว่า `lastSeen` เมื่อติดเพดาน · ไม่เคยชี้ตัวย่อ (5.8) · **อาจชี้เอกสารที่ไม่มีอยู่**: id ถูกจดตอน event เข้าคิว แล้ว event นั้นยังถูกไล่ออกเมื่อคิวเต็ม (`queue_full`) ถูกข้ามตอนเขียนเพราะธงเกินเพดานตั้งก่อน flush หรือ Mongo ไม่รับ (`rejected`) ได้ |
| `status` | `$setOnInsert` / regression / มือ | `open` ตอนสร้าง · กลับเป็น `open` เองเมื่อ issue ที่ `resolved` เกิดซ้ำ (5.4) · `resolved` / `ignored` ด้วยมือ (5.11) จนกว่าจะมี PATCH ของขั้น 7 |
| `statusChangedAt` · `statusReason` | `$setOnInsert` / regression / มือ | ตอนสร้าง = `firstSeen` · null · regression ตั้งเป็น `lastSeen` ของก้อน · `"เกิดซ้ำหลังปิด (regression)"` |
| `regressedAt` | regression | null · ตั้งเมื่อ issue ที่ `resolved` เกิดซ้ำ |
| `alertedAt` · `alertCount` | `$setOnInsert` | null · 0 — loop แจ้งเตือนของขั้น 10 [ออกแบบ] ยังไม่มีใครเขียน |

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

### 5.4 fingerprint และสถานะ · สร้างแล้ว (ยกเว้น PATCH และการแจ้งเตือน)

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
  production (`dist/*.js` ที่ source map พากลับไป `.ts`) ได้ค่าเดียวกัน — **[ยังไม่ได้ลอง]** กับ image ของ production (ด่าน prod-build T ยังไม่รัน) path ตัด
  `src/` หรือ `dist/` ทิ้งเหมือนกันอยู่แล้ว แต่ถ้า source map ไม่ทำงาน ชื่อฟังก์ชันจาก `.js` ที่ tsc ออกอาจต่างจาก `.ts` และ fingerprint ของ dev กับ production จะแยกกัน
- **ต่างจากแบบ:** แผน normalize ทั้ง message ที่สร้างใช้แค่หัวเรื่อง — message ของ Prisma ทั้งก้อนทำให้ title ว่างและ fingerprint เปลี่ยนทุกครั้งที่แก้บรรทัดข้างเคียง

**fingerprint ตายตัว** (ส่งมาจากจุดเก็บแทนค่าตั้งต้น):

| fingerprint | ใช้กับ | สถานะ |
|---|---|---|
| `prisma:<code>:<METHOD route>` | Prisma known code ที่ตะแกรงของ middleware จับ — route ของ guard ที่ยังไม่ถึงแม่แบบเป็น `-` | สร้างแล้ว |
| `render:<code>` | `DocumentRenderError` ≥ 500 | สร้างแล้ว |
| `http:request-body:<status>` | body ที่อ่านไม่ออก 400 / 413 / 415 | สร้างแล้ว |
| `http:5xx:<METHOD route>:<error>` | 5xx ที่ route ตอบเอง (5.8) | สร้างแล้ว |
| `smtp:<responseCode\|E-code>` | worker ส่งอีเมลไม่สำเร็จ | สร้างแล้ว |
| `delivery:dead-letter:<notificationType>` | worker ส่งไม่ได้จนหมดรอบ | สร้างแล้ว |
| `thaid:cid-unavailable:<claim>` | ThaID ไม่ส่งเลขบัตรใน claim ที่ตั้งไว้ | สร้างแล้ว |
| `dataset-choices:defaults` | บูตแล้วยังใช้ตัวเลือกตั้งต้นในโค้ด | สร้างแล้ว |
| `log-store:over-quota` | ขนาดเกินเพดาน (5.9) | สร้างแล้ว |
| `error-capture:dropped:<service>` | event สรุปของที่ถูกทิ้ง (5.7) | สร้างแล้ว |
| `browser:chunk-load` · `proxy:backend_unreachable` · `frontend-server:eacces` | `ChunkLoadError` (warning) · 502 ของ proxy · `EACCES mkdir '/app/.next/cache'` ที่รู้กันอยู่ | [ออกแบบ] ขั้น 9 — ของเบราว์เซอร์ใช้ `service \| name \| normalize(message) \| รูปแบบของ pathname` |

**สถานะ**

```
ครั้งแรก ──$setOnInsert──► open  (statusChangedAt = firstSeen)
resolved ──ก้อนที่ lastSeen > statusChangedAt──► open + regressedAt = lastSeen
                                                   + statusChangedAt = lastSeen
                                                   + statusReason "เกิดซ้ำหลังปิด (regression)"
ignored  ──เกิดซ้ำ──► ยัง ignored · count / lastSeen / lastEventId เดินต่อ · ไม่เปิดกลับ
สถานะใดก็ได้ ──แก้ด้วยมือใน mongosh (5.11)──► open | resolved | ignored   (ไม่มีแถว audit)
             ──PATCH ของขั้น 7 + แถว ERROR_ISSUE_STATUS_CHANGED──► …   [ออกแบบ]
```

การเปิดกลับดูจาก `lastSeen` ของก้อนเทียบ `statusChangedAt` เท่านั้น — regression เลื่อน `statusChangedAt` ไปเป็น `lastSeen` เอง ปิดด้วยมือจึงต้องตั้ง
`statusChangedAt` เป็นเวลาที่ปิดทุกครั้ง (5.11) — ตั้งแล้ว error ที่เกิดก่อนปิดแต่ถูก flush หลังปิดไม่เปิด issue กลับ ไม่ตั้ง ค่าเก่าที่ค้างอยู่ทำให้ก้อนใดก็ตาม
ที่ flush หลังปิด (รวม error ที่เกิดก่อนปิด) เปิดมันกลับ

**[ออกแบบ · ยังไม่สร้าง]** แจ้งเตือน (ขั้น 10 ปิดอยู่ถ้าไม่ตั้ง `ERROR_ALERT_EMAILS`): issue ใหม่ระดับ error ขึ้นไป · regression · fatal · dead letter · crash loop
(`fatal-exit` หรือ `start` ที่ไม่มี `shutdown` ของ `host.containerId` เดียวกันนำหน้าภายใน 60 วินาที) · `log-store:over-quota` — warning ไม่แจ้ง · ไม่เกิน
หนึ่งฉบับต่อ 15 นาที 20 issue ต่อฉบับ และหนึ่งครั้งต่อ issue ต่อ 6 ชั่วโมงเว้นแต่ regress · ไม่มีข้อมูลบุคคลในอีเมล · ข้อควรรู้จากที่สร้างแล้ว: 5xx ที่ route
ตอบเองเก็บเป็น **warning** ปัญหาการตั้งค่าที่กระทบทุกคน (503 `no_reviewer` เมื่อไม่มีใครถือ `BDI_OFFICER` · `no_legal_documents` · 501 ThaID
`not_configured` บน production) จึงจะไม่ได้อีเมลแจ้งเตือนถ้ากติกาไม่เปลี่ยน **[ต้องตัดสิน]**

retention [ออกแบบ]: `error_events` 90 วัน (เบราว์เซอร์ 30) · `error_issues` 365 วันหลัง `lastSeen` เว้นแต่ยัง `open` — **วันนี้ไม่มี prune ใด ๆ** (ขั้น 6)
เพดานขนาด (5.9) เป็นตัวคุมเดียว

### 5.5 `runtime_events` — process เริ่ม ปิด และตาย · สร้างแล้ว

การ restart ไม่ถูกบันทึกที่ไหนเลยก่อนการ์ดนี้ collection นี้จะป้อนการตรวจ crash loop ของขั้น 10 [ออกแบบ]

| ฟิลด์ | ค่า |
|---|---|
| `_id` · `at` | UUID · เวลา |
| `service` | `backend` \| `delivery-worker` |
| `host` · `release` | เหมือน `error_events` — `host.containerId` คงเดิมเมื่อ Docker restart container เดิม เปลี่ยนเมื่อสร้าง container ใหม่ |
| `kind` | `start` — backend ตอน `listen` · worker ทันทีหลังสั่ง `startLogStore()` (ไม่รอให้ต่อได้ — เอกสารรอในคิว, `workers/delivery.ts:196-198`) · `shutdown` — ใน `shutdown()` / `stop()` ของ SIGTERM หรือ SIGINT ก่อน flush · `fatal-exit` — ใน `exitAfterFatal()` หลังเก็บ fatal ก่อน flush และ `exit(1)` |
| `detail` | `start` `{node: "v22.…"}` · `shutdown` `{signal}` · `fatal-exit` `{mechanism, tag}` |

```json
{ "_id": "6a7b8c9d-0e1f-4a2b-8c3d-4e5f6a7b8c9d", "at": { "$date": "2026-10-14T01:00:03.910Z" },
  "service": "backend", "host": { "containerId": "3f1a9b2c4d5e", "startedAt": { "$date": "2026-10-14T01:00:03.502Z" } },
  "release": "5e8a1c2", "kind": "start", "detail": { "node": "v22.20.0" } }
```

เข้าคิวชั้นบนสุด (5.7) · **ยังเขียนตอนเกินเพดานขนาด** (เล็ก และจำเป็นต่อการจับ crash loop — ตอบ [ต้องตัดสิน] เดิมของแผน) · ไม่มีเมื่อปิด log store ·
index `{at:-1}` · retention 90 วัน [ออกแบบ]

### 5.6 การกวาดข้อมูล (`lib/redact.ts`) · สร้างแล้ว

ทุกทางที่ข้อความออกจาก process ไปถึง **log store** ผ่านไฟล์นี้: capture (`scrubError` `bodyShape` `requestTarget`) · สำเนา
`audit_fallback` (`maskForLogStore` — 3.14) — relay ingest และเอกสาร `http` [ออกแบบ] จะใช้ไฟล์เดียวกัน · `failThaidOperation()` ใช้ `scrubText` กับข้อความ
ที่ลง Postgres (ข้อ 7) · ฝั่ง **log ของ container** ที่ผ่านไฟล์นี้คือบรรทัด `[capture]` และ `prisma:error` ของ Prisma ตัวหลัก (`databaseLogLine`, `db.ts`)
แต่**ไม่ใช่ทุกทาง**: บรรทัด `[log-store]` ใช้กฎของ `describe()` ใน `lib/log-store.ts` เอง (3.13) · dry-run ของ `lib/mail.ts` (เฉพาะเมื่อไม่ได้ตั้ง SMTP)
พิมพ์ผู้รับ หัวเรื่อง ลิงก์ และรหัส OTP ลง stdout โดยตั้งใจ · `PrismaClient` ของ worker (`workers/delivery.ts:32`) สร้างโดยไม่มี `log` option จึงไม่ผ่าน
`databaseLogLine()` แบบ `db.ts`

หลักการเป็น allowlist ทุกที่ที่ทำได้ ตารางกวาดข้อความอิสระเป็นชั้นเดียวที่เป็น blocklist จึงเป็น**ชั้นสำรอง**

1. **body** ไม่เก็บค่าเลย — `bodyShape`: ชั้นบนสุดเท่านั้น ≤ 50 คีย์ (ส่วนเกินเป็น `"…": "+N keys"`) · ชื่อคีย์กวาดแล้วตัดที่ 64 · ค่าเป็นรูปร่าง
   `string(n)` `number` `boolean` `null` `array(n)` `object(n)` · คีย์ที่ตรง
   `/passw(?:or)?d|token|secret|otp|^code$|^state$|^error$|^error_?description$|cid$|nationalid|^pid$|signature|phone|email|name|key$/i`
   (`SENSITIVE_BODY_KEY` — ตรงทั้ง `password` และ `passwd`) เหลือแค่
   `"present"` / `"absent"` (absent = ไม่มี null หรือ `""`) ไม่บอกแม้ความยาว — กฎ `name` ติดชื่อทุกรูป (`firstName` `contactLastName` `nameTh`) รวมชื่อ
   หน่วยงานไปด้วย · body ที่ไม่ใช่ object ได้ null
2. **URL** `path` ไม่มี query (กวาดแล้ว ≤ 300) + **ชื่อ**ของ query ≤ 20 ตัว (กวาดแล้ว ≤ 64) — ค่าของ `?token=` `?cid=` `?code&state` ไม่ออกไปเลย
3. **header** ใน `error_events` มีแค่ `request.userAgent` (กวาดแล้ว ≤ 512) · `allowedHeaders()` (`user-agent` `content-type` `content-length`) มีไว้ให้
   ขั้น 8–9 ยังไม่มีใครใช้ · ไม่เคยเก็บ `cookie` `x-admin-token` `x-log-token` `authorization` `referer`
4. **error object** เฉพาะ property ใน allowlist (5.2 `error.props`) — ไม่เคยเอา `body` ของ body-parser, `response` ของ nodemailer (ยกที่อยู่ผู้รับ) หรือ buffer
   ของไฟล์ · stack ประกอบใหม่จากบรรทัด `at` เท่านั้น บรรทัดหัวดิบ (ซึ่งมี message ดิบ) ถูกทิ้ง
5. **ข้อความอิสระ** (message · stack · cause · ชื่อ error ที่ไม่ใช่ Error · ค่าใน `error.props`) ผ่าน `scrubText()` ตามลำดับในตาราง — UUID ถูกกันไว้ก่อน
   กฎตัวเลขและใส่คืนทีหลัง จึงรอดทั้งตัว:

| รูป | กลายเป็น |
|---|---|
| `detail: Some("Failing row contains (…)")` · `hint: Some("…")` ที่ Prisma ยกแถวที่ Postgres ปฏิเสธมา — **กฎแรกสุด** | `detail: [ตัดทิ้ง]` (หาเครื่องหมายปิดไม่เจอก็ตัดจนสุดข้อความ) |
| บรรทัด `DETAIL:` `HINT:` `CONTEXT:` `WHERE:` ของ raw query (`P2010`) | ` (รายละเอียดของแถวตัดทิ้ง)` — ตัดทีละบรรทัดจนถึงบรรทัด `    at …` แรกหรือสุดข้อความ |
| `PostgresError { code: "23514",` · ``Raw query failed. Code: `23514`.`` · เปลือก `ConnectorError(…)` ทั้งก้อน | `SQLSTATE 23514` (ไม่งั้นกฎ `code` ข้างล่างกลบ) · `Postgres SQLSTATE 23514: <ข้อความของ Postgres>` |
| userinfo ของ URI `scheme://user:pass@host` ถึง `@` **ตัวสุดท้าย**ก่อน `/` หรือช่องว่าง | `scheme://***@host` |
| JWT `eyJ…` | `[jwt]` |
| `Bearer …` · `Basic …` | `Bearer [redacted]` |
| ค่าของคีย์ที่**ลงท้าย**ด้วย `token` `key` `secret` `password` `passwd` `passcode` `passphrase` `otp` `code` `state` `auth` `authorization` `cookie` หรือเป็นทั้งคำ (หรือมี `_` `-` นำหน้า) `pwd` `pin` `pass` `pw` `sid` `session` — รูป `k=v` `k: v` `"k":"v"` `k='v'` `{\"k\":\"v\"}` ค่าในเครื่องหมายคำพูดวิ่งถึงเครื่องหมายปิด · คีย์กลุ่มวลี (`secret` `password` `passcode` `passphrase` `authorization` `cookie` `pwd` `pass`) ที่ไม่มีเครื่องหมายคำพูดวิ่งถึงสุดบรรทัดหรือ `&` | `k=[redacted]` |
| `otp 482913` · `code 482913` · `pin …` · `passcode …` (เลข 4–8 หลักหลังช่องว่าง — `status code 500` รอด) | `otp [redacted]` |
| อีเมล | `[email]` |
| ก้อน `[A-Za-z0-9_+-]` ยาว ≥ 32 ที่มีตัวเลข · base64 ยาว ≥ 32 ที่มี `/` หรือ `+` และมีทั้งตัวใหญ่ ตัวเล็ก ตัวเลข | `[secret]` |
| เลข 13 หลัก ติดกัน หรือคั่นด้วยขีด/ช่องว่าง | `[cid]` |
| `+66` ตามด้วย 8–9 หลัก · `0` ตามด้วย 8–9 หลัก (ขีด/ช่องว่างคั่นได้) | `[phone]` |

   - ข้อความยาวกว่า 20,000 ตัวถูกตัดก่อนกวาด · ข้อความที่**ผู้เรียก API เลือกเองได้** (ชื่อคีย์ของ body และ query, path, user agent, ชื่อ error ที่ไม่ใช่ Error,
     ค่าใน props) ผ่าน `scrubClipped(text, max)` ซึ่งตัดเหลือ `max + 256` ตัว**ก่อน**กวาดแล้วค่อยตัดเหลือ `max` — ของที่คร่อมจุดตัดยังถูกกวาดครบ
     และ regex ไม่วิ่งบนข้อความขนาดเมกะไบต์บนเส้นทางของคำขอ · regex ของตารางกวาดเป็นเส้นตรง (กฎ DETAIL เดิมใช้ 8.8 วินาทีต่อคำขอที่มีห้าสิบคีย์ — แก้แล้ว)
     **แต่ตัวแยกเฟรมของ `scrubError()` ไม่เป็น**: `topFrameOf()` รัน regex ที่ไม่ยึดหัวบรรทัด (`redact.ts:312`) บนทุกบรรทัดที่ `framesOf()` หยิบจาก `err.stack`
     ดิบซึ่งไม่ถูกจำกัดความยาว (`:299-303`) — เวลาโตเป็นกำลังสองกับความยาวบรรทัด (วัดแล้ว 2026-09-30: บรรทัด `at x (` ซ้ำ 18 KB ≈ 40 ms · 36 KB ≈ 150 ms ·
     72 KB ≈ 600 ms) บรรทัดแบบนี้มาจาก message ที่มีบรรทัดขึ้นต้นด้วยช่องว่างตามด้วย `at ` (ข้อ “ยังหลุด” ข้างล่าง)
   - ตั้งใจกวาดเกิน: `code: 'EAUTH'` ในข้อความของ `util.inspect` · ทุกอย่างหลัง `pass=` ในบรรทัดเดียวกัน · URL ที่มี `@` ใน query หลัง host
   - **ยังหลุด** (รู้แล้ว): คีย์ camelCase ที่ลงท้าย `Pass` / `Pw` (`newPass=` `oldPw=`) · `nonce=` · เลขบัตรที่คั่นด้วยจุด · ค่าในเครื่องหมาย backtick ที่มี
     ช่องว่าง · รหัสผ่านใน URI ที่มี `/` ไม่ได้ encode · ตัวแยกเฟรมของ `scrubError()` ถือบรรทัดของ message ที่ขึ้นต้นด้วยช่องว่างตามด้วย `at ` เป็นเฟรม
     บรรทัดนั้นจึงข้ามการตัด DETAIL ไปอยู่ใน stack ที่มีแค่ตารางกวาดคุม (และ `err.stack` ดิบไม่ถูกจำกัดความยาวก่อนแยก)
   - **ต่างจากแบบ:** แผนมีแค่ `(token|key|secret|password|otp|code|state)=…` `[cid]` `[email]` `[jwt]` `[secret]` `[phone]` ที่สร้างเพิ่มการตัด DETAIL ของ
     Postgres userinfo ของ URI `Bearer`/`Basic` รูปในเครื่องหมายคำพูด คีย์กลุ่มวลี และ `+66`
6. **log ของ Prisma เอง** `databaseLogLine()` ข้อความ ≤ 64 KB → ตัด DETAIL ทั้งก้อน → บรรทัดสุดท้าย → กวาด → ≤ 500 ตัว (`db.ts`)
7. **`integration_operation.last_error_message`** `failThaidOperation()` เขียน `storableText(scrubText(message ≤ 2,000 ตัว) ≤ 500 ตัว)` —
   เลขบัตร อีเมล เบอร์ ความลับที่ฝังใน `error_description` ไม่ลงคอลัมน์นี้แล้ว แต่ถ้อยคำที่เหลือยังเป็นของผู้ยิง อย่าอ่านเป็นคำของ ThaID
   (แผนขั้น 5 · §13 ข้อ 39) · **ยังไม่ถูกกวาด**: `notification.notification_delivery.last_error_message` ที่ worker เขียนข้อความดิบของ SMTP 500 ตัว
   (`workers/delivery.ts:132`) ซึ่งยกที่อยู่ผู้รับที่ถูกปฏิเสธมาได้
8. **[ออกแบบ · ยังไม่สร้าง] ingest `POST /api/client-errors`** body ≤ 16 KB ตรวจด้วย zod แบบ strict · scrub ซ้ำที่เซิร์ฟเวอร์ · จำกัด 30/นาทีต่อ IP และ
   300/นาทีรวม · ตอบ 204 เสมอ · ไม่ต้องล็อกอินและไม่เขียน audit · เก็บเป็นสตริง JSON ไม่เคย render เป็น HTML

### 5.7 คิว เพดาน และการทิ้ง · สร้างแล้ว

| เพดาน | ค่า | เกินแล้ว |
|---|---|---|
| คิวในหน่วยความจำต่อ process | 500 รายการ / 2 MB | ไล่ตามลำดับชั้นข้างล่าง (`queue_full`) |
| issue ที่รอเขียน | 1,000 fingerprint | การเกิดครั้งนั้นไม่เข้าแม้ตัวนับ (`issue_backlog`) |
| event ที่เก็บต่อ fingerprint | 50 ต่อชั่วโมง | นับอย่างเดียว (`capped_issue`) — fatal ไม่ติด |
| event ที่เก็บต่อ process | 600 ต่อนาที | นับอย่างเดียว (`capped_process`) — fatal ไม่ติด |
| ตัวย่อของรหัสอ้างอิง | 120 ต่อนาทีต่อ process | ไม่เก็บตัวย่อ (5.8) |
| เอกสารหนึ่งตัว · `extra` | 64 KB · 16 KB | ตัดตาม 5.2 · เกินหลังตัดแล้ว = ทิ้ง (`too_large`) |
| log store เกินเพดานขนาด | 5.9 | นับอย่างเดียว ไม่เก็บ event ไม่เก็บตัวย่อ — fatal ก็ไม่เก็บ |

เพดาน 50 ต่อชั่วโมงและ 600 ต่อนาทีเป็น**หน้าต่างตายตัว** ไม่ใช่หน้าต่างเลื่อน (`admit()`): หน้าต่างเริ่มที่ event ตัวแรกที่ถูกเก็บหลังหน้าต่างเก่าหมด แล้วนับจนครบ
ชั่วโมง/นาทีนั้น — ช่วงที่คร่อมรอยต่อจึงเก็บได้เกือบสองเท่า · หน้าต่างรายชั่วโมงที่หมดแล้วถูกล้างออกจากหน่วยความจำเฉพาะหลัง flush ที่สำเร็จ (ไม่มีผลกับการนับ)

**ลำดับการทิ้งเมื่อคิวเต็ม** — ชั้นต่ำถูกไล่ก่อน (ตัวเก่าสุดในชั้นนั้น) ตัวที่เข้ามาใหม่ไล่ได้เฉพาะชั้นที่**ต่ำกว่า**ตัวเอง ชั้นเท่ากันแปลว่าตัวใหม่ถูกทิ้ง
(ตัวอย่างแรก ๆ ของเหตุการณ์บอกได้มากกว่าตัวที่ห้าร้อย):

| ชั้น | อะไร |
|---|---|
| 0 · 1 | รายงานจากเบราว์เซอร์ · เอกสาร `http` ของการเรียก admin API — [ออกแบบ] ขั้น 9 และ 8 |
| 2 | warning · ตัวย่อของรหัสอ้างอิง |
| 3 | error |
| 4 | fatal · `runtime_events` · สำเนา `audit_fallback` · event สรุป “ทิ้งไป N” — **เก็บไว้ท้ายสุด** |

**การเขียน** ตัวจับเวลาทุก 2 วินาทีหยิบหนึ่งก้อน (≤ 500 รายการ + issue ที่รอทั้งหมด) **ทีละก้อน ไม่ซ้อน**: `error_events` → `runtime_events` → `activity`
(`insertMany` แบบ unordered) → `error_issues` (`bulkWrite` แบบ ordered) · `_id` ซ้ำ (11000) = เขียนไปแล้วรอบก่อน ถือว่าสำเร็จ · เอกสารที่ Mongo ปฏิเสธ
ด้วยรหัสที่ลองซ้ำก็ไม่ผ่าน (2 9 52 121 10334 17280) ถูกทิ้ง (`rejected`) · ความล้มอื่นทั้งหมด **รวม `MongoBulkWriteError` ที่ `writeErrors` ว่าง** (server
กำลังปิด ต่อหลุดกลางทาง) = ส่วนที่ยังไม่ได้เขียนกลับเข้าคิว แล้วถอยห่าง 4 → 8 → … สูงสุด 60 วินาที · ไม่มี timeout ครอบก้อน (driver คุมแต่ละคำสั่งเอง)
ก้อนที่นานเกิน 15 วินาทีได้บรรทัดเตือนและก้อนใหม่รอจนก้อนเดิมจบ · event ที่ค้างคิวอยู่ตอนธงเกินเพดานตั้งถูกข้ามตอนเขียน (ไม่นับเป็น “ทิ้ง”)
ส่วน `runtime_events` และ `activity` เขียนตามปกติ · คิวอยู่ในหน่วยความจำ process ตายแบบไม่ graceful (kill, OOM) = หายทั้งคิว

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
- `extra` `{dropped, from, to, reasons: {queue_full, too_large, rejected, issue_backlog}, auditCopies}`

| `reasons.*` | แปลว่า |
|---|---|
| `queue_full` | คิวเต็ม (500 รายการ / 2 MB) — Mongo เขียนไม่ได้นาน **หรือ** error มาเร็วกว่าที่เขียนทันแม้ Mongo ปกติ (พายุ error) อย่าอ่านว่า Mongo ล่มเสมอ |
| `too_large` | เอกสารตัวเดียวเกิน 64 KB หลังตัดแล้ว |
| `rejected` | Mongo ปฏิเสธตัวเอกสาร ลองซ้ำก็ไม่ผ่าน |
| `issue_backlog` | issue ที่รอเขียนครบ 1,000 fingerprint — ครั้งนั้นไม่ได้เข้าตัวนับด้วย |
| `auditCopies` | ในจำนวนที่ทิ้ง เป็นสำเนา `audit_fallback` กี่ตัว — **สำเนาเดียวที่เหลือของแถวที่ Postgres ไม่รับ หายแล้วหายเลย** |

วัดแล้ว (2026-09-30): error 600 ตัวระหว่าง mongo ล่ม ได้ event 500 ตัว ตัวนับ 600 และ “ทิ้งไป 100” · คำขอใช้เวลา 12–66 ms ตลอด

**ตัวนับของ issue เป็นค่าประมาณ** — `$inc` ไม่ idempotent: คำสั่งที่ driver เลิกรอแล้ว (`socketTimeoutMS` 5 วินาที) แต่ server ได้รับไว้ถูกทำจริงทีหลัง
แล้วรอบที่ลองซ้ำก็ `$inc` อีกครั้ง หลัง Mongo ค้าง (pause ช้า หรือคำสั่งเดียวเกิน 5 วินาที) ทั้งก้อนจึงนับซ้ำได้ — วัดแล้ว `docker compose pause mongo`
ราว 17 วินาทีระหว่าง error 20 ตัว ตัวนับขึ้น 40 · **เอกสาร event ไม่เคยซ้ำ** (`_id` เดิม) · ตัวเลขตรงต้องให้ก้อนของ issue มี id แล้วกรองด้วย id ที่ใช้แล้ว
ซึ่งเพิ่มฟิลด์ใน `error_issues` **[ต้องตัดสิน]**

### 5.8 รหัสอ้างอิงบน 5xx และบรรทัดใน log ของ container · สร้างแล้ว

**รหัสอ้างอิง** = 8 ตัวแรกของ correlation id ของคำขอ (`referenceOf()`, ตัวพิมพ์ตามที่ผู้เรียกส่งมา) `referenceOnServerErrors` (`index.ts:104-131`)
ห่อ `res.json` ของทุกคำขอ เมื่อ status ≥ 500 และ body เป็น object ที่มี `error` เป็นสตริง:

1. ถ้ายังไม่มีอะไรในคำขอนี้ถูก `captureError` (`RequestContext.errorCaptured`) เก็บ `RouteServerError` เป็น warning tag `http.route-5xx` fingerprint
   `http:5xx:<METHOD route>:<error>` ข้อความ `<status> <error>: <ข้อความไทยของ route>` ไม่มี stack — dev checkout ที่ไม่ได้ตั้ง ThaID จึงได้ warning
   หนึ่งตัวทุกครั้งที่กดเริ่ม ThaID (501 `not_configured` · เพดาน 50 ตัวต่อชั่วโมงของ fingerprint ใช้ตามปกติ)
2. `keepReference(status)` — ถ้า capture ของคำขอนี้ติดเพดานการสุ่มเก็บ เก็บ**ตัวย่อ**แทน (ข้างล่าง)
3. ต่อ ` (รหัสอ้างอิง xxxxxxxx)` ท้าย `message` (ถ้ายังไม่มีคำนี้) และเพิ่มฟิลด์ `reference` — toast ของหน้าเว็บแสดง `message` จึงถึงตาผู้ใช้โดยไม่ต้องแก้หน้าไหน

500 ทั่วไปตอบ `{"error": "internal", "message": "เกิดข้อผิดพลาดภายในระบบ (รหัสอ้างอิง 1a2b3c4d)", "reference": "1a2b3c4d"}` · 501 ก็ได้ ·
503 ของ `/health/ready` ไม่มีคีย์ `error` จึงไม่ถูกแตะ (ตั้งใจ) · header `x-correlation-id` อยู่ใน `exposedHeaders` ของ CORS (`index.ts:139`)
**ต่างจากแบบ:** แผนให้แก้ข้อความเฉพาะ 500 ทั่วไป ที่สร้างเติมให้ทุก 5xx ที่มี `error` (decision 18 ของแผน) toast ของ 502/503 ของ route จึงมีรหัสด้วย

**5xx ที่ไม่ได้รหัสอ้างอิง** — ตัวห่อแตะแค่ `res.json`: 5xx ที่ส่งทาง `res.send` `res.end` หรือ `sendStatus` และ body JSON ที่ไม่มี `error` เป็นสตริง ไม่ได้ทั้ง
`reference` และ capture `http.route-5xx` (ถ้าไม่มีใครเก็บไว้ก่อน ก็ไม่มีร่องรอยใน Mongo) · error ที่เกิดหลังส่งหัวคำตอบไปแล้วจบด้วย `res.destroy()` ไม่มี
body (มี event `http.after-headers-sent` ที่ถือ correlation id แต่ผู้ใช้ไม่ได้รหัสไปอ่านให้ฟัง)

**ตัวย่อ (`extra.referenceOnly: true`)** — event ที่ติดเพดาน 50/ชั่วโมงหรือ 600/นาทีไม่มีเอกสารของตัวเอง ถ้าคำขอนั้นจบด้วย 5xx ที่มีรหัสอ้างอิง ตอนตอบ
จะเก็บตัวย่อหนึ่งตัว: `_id` `fingerprint` `level` `tag` `actor` เวลา และ `request` เดิม (`status` = status ที่ตอบ, `bodyShape` null) · `error` เหลือ
`{name, message, props}` (`stack` null, `causes` `[]`) · `breadcrumbs` `[]` · `extra {referenceOnly: true, capped: "capped_issue" | "capped_process"}`
ตัวอย่างเต็มของ issue นั้นหาได้จาก fingerprint เดียวกัน · อยู่ชั้น warning ในคิว · ≤ 120 ตัวต่อนาทีต่อ process · ไม่เก็บตอนเกินเพดานขนาด · คำขอที่จบด้วย
status < 500 ไม่ได้ตัวย่อ · คำขอหนึ่งจำเฉพาะ capture ที่ติดเพดาน**ตัวล่าสุด** และไม่ลบมันเมื่อ capture ตัวหลังของคำขอเดียวกันถูกเก็บเต็ม — คำขอที่มีทั้งตัวที่ติดเพดาน
และตัวที่เก็บได้ แล้วจบด้วย 5xx จึงได้ทั้งเอกสารเต็มและตัวย่อภายใต้ correlation id เดียวกัน

**รหัสค้นไม่เจอเมื่อ**: log store ปิด หรือ down นานจนคิวล้น หรือ process restart ก่อน flush · เกินเพดานขนาด · คิวเต็ม · ตัวย่อเกิน 120 ตัวต่อนาที ·
capture ตกเป็น `issue_backlog` เอกสารใหญ่เกิน 64 KB หลังตัด หรือ Mongo ไม่รับเอกสาร · และ**ชี้ผิดตัว**ได้: ถ้ามี capture อื่นในคำขอเดียวกันก่อนหน้า (เช่น `audit.write-failed`
`thaid.revoke`) `errorCaptured` ตั้งแล้ว 5xx ของ route เองจึงไม่ถูกเก็บ รหัสจะพาไปเจอ event ตัวก่อนหน้านั้นแทน · 502 `backend_unreachable` ของ proxy
หน้าเว็บ backend ไม่เคยเห็น (ขั้น 9) — ทางสำรอง: issue ที่ `culprit` เป็น route นั้นในช่วงเวลานั้น บรรทัด `[capture] … ref=xxxxxxxx` ใน log ของ container
และแถว audit ด้วย `LIKE` (2.10, 5.11)

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
| `event=- (คิวเต็ม: ทิ้ง)` | ถูกทิ้งตอนเข้าคิวด้วยเหตุใดก็ได้ — คิวเต็มจริง (`queue_full`) · issue ที่รอเขียนครบ 1,000 (`issue_backlog`) · เอกสารเกิน 64 KB หลังตัด (`too_large`) — ข้อความเดียวกันทั้งสามเหตุ สาเหตุจริงอยู่ใน `reasons` ของ event สรุป (5.7) |

`ref=` มีเมื่อมี correlation id (คำขอ HTTP และแถวของ worker) · `issue=` เป็น 12 ตัวแรกของ fingerprint ตั้งต้น หรือ fingerprint ตายตัวทั้งตัว · `@ topFrame`
มีเมื่อหาเฟรมในโค้ดเราได้ ตัวอย่าง (ข้อมูลสมมติ):

```
[capture] backend error event=0c7d4b1e-2f5a-4c1d-9e3b-6a8f7d2c1b40 ref=1a2b3c4d issue=render:converter_unavailable POST /api/organizations/:id/review — DocumentRenderError: ตัวแปลงเอกสารเป็น PDF ไม่ตอบสนอง … @ lib/document-render:docxToPdf
[capture] delivery-worker warning event=- (เก็บตัวอย่างของ issue นี้ครบ 50 ตัวในชั่วโมงนี้แล้ว: นับอย่างเดียว) ref=9a8b7c6d issue=smtp:421 delivery.send-failed — Error: Message failed: 421 4.7.0 Try again later
```

### 5.9 เพดานขนาดของ log store · สร้างแล้ว

- **ค่า** `LOG_STORE_MAX_MB` — ว่าง = 5120 เมื่อ `NODE_ENV=production` ที่อื่น 512 · ค่าที่ไม่ใช่จำนวนบวกใช้ค่าตั้งต้นพร้อมบรรทัด
  `[env] LOG_STORE_MAX_MB: ไม่ใช่จำนวนบวก — ใช้ค่าตั้งต้น … แทน`
- **ใครตรวจ** `workers/log-upkeep.ts` ใน delivery-worker: รอบแรก 5 วินาทีหลังบูต แล้วทุก 60 วินาที — รอบที่ต่อ Mongo ได้
  ครั้งแรกสร้าง index ของ collection error (ทีละตัว ตัวที่ล้มเพราะเครือข่ายลองใหม่รอบหน้า ตัวที่ถูกปฏิเสธพิมพ์
  `[log-store] delivery-worker: สร้าง index {…} ของ <collection> ไม่ได้ (<ชื่อ>) — ข้ามไป ค้นได้แต่ช้าลง` และเก็บ warning `log-upkeep.index` ครั้งเดียวแล้วข้าม)
  และตรวจเพดาน จากนั้นตรวจเพดานทุกชั่วโมง · รอบไม่ซ้อนกันด้วยธง `running` แต่รอบที่เกิน 45 วินาทีแค่**เลิกรอ** — `withTimeout` ไม่ได้ยกเลิก `createIndex` /
  `dbStats` ที่ค้าง แล้ว `running` ถูกล้าง รอบถัดไปจึงวิ่งซ้อนกับงานที่ค้างได้ (ไม่เสียหาย เพราะทั้งสองคำสั่งทำซ้ำได้) · **อยากให้ตรวจทันที ให้ restart worker** ·
  backend ไม่สร้าง index และไม่ตั้งธง
- **วัดอะไร** `dbStats` แบบ `freeStorage: 1`: ขนาดที่**ใช้อยู่** = `storageSize + indexSize − (freeStorageSize + indexFreeStorageSize)` → `storageMb` ·
  ขนาดที่**จองไว้** (= บนดิสก์) = `storageSize + indexSize` → `allocatedMb`
- **เขียนที่** `relay_state` `_id:"audit_event"` ด้วย `$set` + upsert: `storageMb` `allocatedMb` `maxMb` `overQuota` `quotaCheckedAt`
- **ธง** ตั้งเมื่อ `storageMb > maxMb` · ลงเมื่อ `storageMb < 0.9 × maxMb` · ระหว่างนั้นคงค่าเดิม (กันธงกะพริบทุกชั่วโมงตอนขนาดอยู่แถวเพดาน)
- **ตอนธงตั้ง** worker พิมพ์ `[log-store] delivery-worker: log store ใช้พื้นที่ X MB (จองไว้ Y MB) เกินเพดาน LOG_STORE_MAX_MB Z MB — ต่อจากนี้เก็บแค่ตัวนับ…`
  และเก็บ warning `log-store:over-quota` หนึ่งตัว (ไม่พิมพ์ซ้ำ) · ตอนธงลงพิมพ์ `… ต่ำกว่าเพดานแล้ว — กลับมาเก็บ error event ตามปกติ` · **ไม่มีอีเมล** (ขั้น 10)
- **ผล** ทั้งสอง process เห็นธงในรอบตรวจสถานะถัดไป (≤ 30 วินาที) เป็น `over_quota` และแต่ละตัวพิมพ์บรรทัดสถานะ
  `[log-store] <service>: เชื่อมต่อได้ แต่ขนาดเกิน LOG_STORE_MAX_MB แล้ว (ฐานข้อมูล …)` (3.13): error เดินแค่ตัวนับของ issue (issue ใหม่ก็ถูกสร้าง) ไม่เก็บ event
  ไม่เก็บตัวย่อ event ที่ค้างคิวถูกข้าม · **`runtime_events` และสำเนา `audit_fallback` ยังเขียน** · `/health/ready` แสดง `over_quota` (ยังตอบ 200)
- **ต่างจากแบบ:** แผนเทียบ `storageSize` อย่างเดียว ที่สร้างเทียบข้อมูล + index ที่ใช้อยู่จริง เพราะ WiredTiger ไม่คืนพื้นที่ของเอกสารที่ลบให้ระบบ `storageSize`
  จึงไม่ลดหลังลบ (ลองกับ `mongo:7.0` แล้ว — ลบหมดทั้ง collection `storageSize` ไม่ขยับ) ธงที่ตั้งแล้วจะไม่มีวันลง · แผนให้ส่งอีเมลเตือน ที่สร้างมีแค่บรรทัดกับ warning
- **เพดานนี้ไม่ได้คุมดิสก์ด้วยตัวเองอีกต่อไป** — WiredTiger ใช้พื้นที่ว่างซ้ำได้เฉพาะในไฟล์ของ collection เดิม หลังลบ `error_events` ไปครึ่งหนึ่ง การโตของ
  `activity` หรือ `runtime_events` จองดิสก์ใหม่ ขนาดบนดิสก์ (`allocatedMb`) จึงเกิน `LOG_STORE_MAX_MB` ได้เท่ากับพื้นที่ว่างที่ collection อื่นถืออยู่ (ราวหนึ่ง
  เพดานในกรณีเลวร้าย) · คืนดิสก์จริงได้ด้วย `compact` เท่านั้น (root — ผู้ใช้ของแอปทำไม่ได้) · บริการ managed ที่ไม่ส่งตัวเลข free มาก็เท่ากับเทียบขนาดที่จอง ·
  ถ้าบริการใดปฏิเสธ `freeStorage` ทั้งคำสั่ง `dbStats` จะล้ม — `checkQuota()` throw ก่อนจด `lastQuotaCheckAt` จึงถูกลองใหม่**ทุกรอบ 60 วินาที** ไม่ใช่รายชั่วโมง
  (warning `log-upkeep.tick` ถูกเก็บไม่ถี่กว่าสิบนาทีครั้ง) และเพดานไม่ถูกประเมินเลย — **[ยังไม่ได้ลอง]** กับบริการจริง
- คอมเมนต์ใน `.env.example` ยังเขียนว่าเพดานคือ `storageSize + indexSize` — ตัวที่เทียบจริงคือขนาดที่ใช้อยู่ตามข้างบน

### 5.10 process handler การปิด process `RELEASE` และ `DEPLOY_ENV` · สร้างแล้ว

- `initErrorCapture()` เป็นบรรทัดแรกของ `main()` ทั้ง backend และ worker: ติดตั้งตัวดัก แล้วเริ่มตัวจับเวลาเขียนคิว (เมื่อเปิด log store) — error ระหว่างบูตรอในคิว
  จน log store ต่อได้ · ก่อน `startLogStore()` ถูกเรียก `logDb()` คืน null (`log-store.ts:127`) — ใน backend นั่นคือหลัง `loadChoices()` และ `ensureContainer()`
  ถ้าสองขั้นนั้นกินเวลาเกิน 2 วินาทีและมีอะไรในคิวแล้ว (เช่น `dataset-choices.read-failed` ตอน Postgres ช้า) รอบเขียนรอบแรกล้ม บูตจึงพิมพ์
  `[capture] backend: ยังเขียน log store ไม่ได้ (log store down) …` ตามด้วย `เขียน log store ได้อีกครั้ง` ทั้งที่ Mongo ปกติ — ไม่ใช่สัญญาณว่า Mongo มีปัญหา
- **`unhandledRejection`** เก็บเป็น error (`handled: false`) แล้ว**ทำงานต่อ** — Node 22 ที่ไม่มีตัวดักจะออกทั้ง process พร้อมคำขออื่นที่ค้างอยู่ (decision 14)
- **`uncaughtException`** → `exitAfterFatal()`: เก็บเป็น fatal (ไม่ติดเพดานการสุ่มเก็บ แต่ติดเพดานขนาด) เขียน `runtime_events` `fatal-exit` รอเขียนคิวไม่เกิน
  2 วินาที แล้ว `exit(1)` · exception ตัวที่สองระหว่างรอ = ออกทันที · มีเส้นตายสำรองที่ 3 วินาที · `main()` ที่ล้มตอนบูตใช้ทางเดียวกัน (`mechanism: captured`
  tag `startup` / `delivery.main`)
- **ใครปลุกกลับ** production (backend และ worker) และ worker ของ dev: restart policy ของ Docker — process ออก container ก็ออก ไม่ว่า PID 1 จะเป็น node หรือ `sh`
  (ลองแล้วกับ worker ได้ `RestartCount 1` · backend ของ production ยังไม่ได้ลอง) · **dev checkout:
  backend รันใต้ `tsx watch` ซึ่งไม่ restart ตัวลูกที่ออกเอง API จึงล่มค้างจนกว่าจะมีไฟล์ source เปลี่ยน** และ Docker ไม่เห็นว่าล่มเพราะ tsx ยังอยู่
- ข้อที่รู้: `streamAttachment()` `pipe()` stream ของ blob โดยไม่มีตัวฟัง `'error'` storage ที่ล้มกลางการดาวน์โหลดจึงเป็น `uncaughtException` — วันนี้กลายเป็น
  fatal + process ออก พาคำขอที่ค้างอยู่ทั้งหมดไปด้วย (มีมาก่อนขั้น 5 แค่ตอนนี้เห็นเป็น fatal)
- **การปิด** (SIGTERM / SIGINT) backend (`index.ts:414-425`): `server.close()` → บันทึก `shutdown` → แถวสรุปของ token ที่ถูกปฏิเสธ ≤ 2 วินาที → คิวของ
  log store ≤ 2 วินาที (ไม่เกินสามก้อน) → ปิด client ของ Mongo ≤ 1.5 วินาที → `prisma.$disconnect()` → `exit(0)` · worker: หยุด loop → หยุด log-upkeep →
  บันทึก `shutdown` → คิว ≤ 2 วินาที → ปิด client ≤ 1.5 วินาที → disconnect → `exit(0)` — อยู่ใน 10 วินาทีของ compose · ยังไม่รอคำขอที่กำลังวิ่ง (2.8) ·
  ทั้งหมดนี้เกิดเฉพาะเมื่อ SIGTERM ถึง node: worker ของ prod overlay (`command: ["node", "dist/workers/delivery.js"]`) node เป็น PID 1 ส่วน backend ของ prod overlay
  รันผ่าน `sh -c "npx prisma migrate deploy && node dist/index.js"` (ash ของ `node:22-alpine`) — node ได้ SIGTERM ก็ต่อเมื่อ ash `exec` คำสั่งสุดท้าย
  **[ยังไม่ได้ลอง]** ตรวจได้ด้วย `docker compose exec backend ps` บน image ของ production หรือดูว่ามีบันทึก `shutdown` หลัง deploy ถ้าไม่มี
  compose `SIGKILL` ที่ 10 วินาที และคิว แถวสรุปของ token ที่ค้าง กับบันทึก `shutdown` หายทั้งหมด
- **`RELEASE`** `env.release = optional("RELEASE", "dev")` — ไม่ได้ตั้ง**หรือเป็นสตริงว่าง**ได้ `dev` · image ของ backend (stage runner): `ARG GIT_SHA=unknown` → `ENV RELEASE=$GIT_SHA
  NODE_OPTIONS=--enable-source-maps` · prod overlay ส่ง `GIT_SHA: ${GIT_SHA:-unknown}` สคริปต์ deploy จึง**ต้องตั้ง** `GIT_SHA=$(git rev-parse --short HEAD)`
  ใน shell ตอน build ไม่งั้นได้ `unknown` · dev checkout (tsx จาก source) = `dev` · **ห้ามใส่ `RELEASE` ใน environment ของ compose**: ค่าว่างจาก `${RELEASE:-}`
  ทับค่าที่ image ฝังไว้แล้วกลายเป็น `dev` · `GET /` คืน `{service, version, release}` · **ต่างจากแบบ:** ไม่มีส่วนต่อท้าย `-dirty` · `GIT_SHA` ของ frontend เป็นขั้น 9
- **`DEPLOY_ENV`** compose ตั้ง `${DEPLOY_ENV:-${COMPOSE_PROJECT_NAME:-bdi-project}}` — `bdi-main` บน `main/` และ `bdi-<ชื่อ checkout>` บน dev checkout · ค่าตั้งต้นใน
  `env.ts` (นอก compose) คือ `NODE_ENV` · Azure ตั้ง `DEPLOY_ENV=azure` · **ต่างจากแบบ:** `release` และ `deployEnv` อยู่ชั้นบนของ `env` ไม่ได้อยู่ใน `env.logStore`
- ปิด log store แล้วบรรทัด `[capture]` ยังพิมพ์ตามเดิม (บรรทัดไม่มี environment หรือ release)

### 5.11 runbook ของผู้ดูแลระบบ — จนกว่า API ขั้น 7 จะมา

ทุกคำสั่งรันจากไดเรกทอรีของ stack นั้น (`main/` คือ production — อย่ารันระหว่างที่มีคน deploy) · ผลลัพธ์มีข้อมูลส่วนบุคคลบางส่วน (id ของคน IP UA และ
ข้อความที่กวาดแล้ว) อย่าคัดลอกออกนอกเครื่อง · การเข้าแบบนี้ไม่ทิ้งร่องรอยในแอป (6.1)

**เปิด mongosh** — mongo ไม่ผูกพอร์ตออกโฮสต์ จึงเข้าผ่าน container และใช้รหัสผ่านที่อยู่ใน env ของ container อยู่แล้วแบบเดียวกับคำแนะนำใน `.env.example`
**ไม่พิมพ์รหัสผ่านลง command line ของเครื่อง** ซึ่ง shell history และ `ps` เห็น:

```bash
cd /hdd1tb/bdi-project/main
# root — คำสั่งที่ .env.example แนะนำ
docker compose exec mongo sh -c 'mongosh -u "$MONGO_INITDB_ROOT_USERNAME" -p "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin "$MONGODB_DB"'
# [ข้อเสนอ · ยังไม่ได้ลอง] สิทธิ์น้อยกว่า — bdi_backend อ่านได้ทุก collection แก้ได้แค่ error_issues ลบอะไรไม่ได้ พอสำหรับข้อ 1–3 ข้างล่าง
docker compose exec mongo sh -c 'mongosh -u bdi_backend -p "$MONGO_BACKEND_PASSWORD" --authenticationDatabase "$MONGODB_DB" "$MONGODB_DB"'
```

- `$…` อยู่ในเครื่องหมายคำพูดเดี่ยว จึงถูกแทนค่า**ใน container** ไม่ลง history ของเครื่อง — แต่ระหว่างที่ mongosh เปิดอยู่ รหัสผ่านอาจอยู่ใน argument ของ
  process นั้นซึ่ง `ps` บนเครื่องเห็นได้ เปิดสั้น ๆ แล้วออก
- `docker compose exec mongo mongosh` เปล่า ๆ ต่อได้ แต่เปิด auth ไว้: `ping` / `hello` ใช้ได้ (healthcheck ของ service พึ่งข้อนี้) คำสั่งที่อ่านข้อมูลหรือจัดการ
  ถูกปฏิเสธ · `show collections` ของ `bdi_backend` **[ยังไม่ได้ลอง]** — role ไม่มี `listCollections` แต่ mongosh ขอรายชื่อแบบ `nameOnly` + `authorizedCollections`
  ซึ่งตามเอกสารของ MongoDB ไม่ต้องใช้สิทธิ์นั้น และคืนทุก collection ให้ผู้ใช้ที่มีสิทธิ์ระดับทั้งฐาน (`find` `insert`) จึงน่าจะใช้ได้
- รหัสผ่านใน env ของ container คือค่าใน `.env` **ตอนสร้าง container** — แก้ `.env` แล้วค่าใน container ยังเป็นค่าเก่าจนกว่าจะสร้าง container ใหม่ และหลัง volume
  ถูก init แล้วค่าใหม่ไม่ตรงกับผู้ใช้จริงจนกว่าจะรัน `01-users.js` ซ้ำ (ลำดับที่ถูกอยู่ใน 3.12) · ใช้ root เฉพาะงานที่ต้องใช้ (เปลี่ยนรหัสผ่าน `compact` ลบข้อมูล) —
  root drop ได้ทุกอย่าง

**1. หา error ของรหัสอ้างอิงที่ผู้ใช้อ่านให้ฟัง**

```js
db.error_events.find({ "request.correlationId": /^1a2b3c4d/ }).sort({ occurredAt: 1 })   // ใช้ index ของ request.correlationId
db.activity.find({ "request.reference": "1a2b3c4d" })   // สำเนาของแถว audit ที่ Postgres ไม่รับในคำขอเดียวกัน (3.14)
```

- ได้เอกสารที่ `extra.referenceOnly: true` = ตัวย่อ (5.8) — ตัวอย่างเต็มของ issue เดียวกัน:
  `db.error_events.find({ fingerprint: "<fp>", "extra.referenceOnly": { $ne: true } }).sort({ occurredAt: -1 }).limit(5)`
- issue ของมัน: `db.error_issues.findOne({ _id: "<fingerprint>" })` · แถว audit ของคำขอเดียวกัน: คิวรี “คำขอ HTTP หนึ่งครั้ง” ใน 2.10
- ไม่เจอ (เหตุผลใน 5.8): บรรทัดใน log ของ container — `docker compose logs --since 24h backend delivery-worker | grep 'ref=1a2b3c4d'` (log ของ backend บน
  `main/` หายทุกครั้งที่ deploy) — แล้ว issue ของ route นั้นในช่วงเวลานั้น:
  `db.error_issues.find({ culprit: "<METHOD route>", lastSeen: { $gte: ISODate("2026-10-14T03:00:00Z") } })`
- correlation id ที่ผู้เรียกส่งมาเป็นตัวพิมพ์ใหญ่ถูกเก็บตามนั้น (2.5) — ใช้ `/^1A2B3C4D/i` ถ้าหาไม่เจอ

**2. ดู issue ที่เปิดอยู่**

```js
db.error_issues.find({ status: "open" },
  { title: 1, culprit: 1, level: 1, count: 1, lastSeen: 1, lastRelease: 1 }).sort({ lastSeen: -1 }).limit(50)
db.error_issues.find({ status: "open", level: { $in: ["error", "fatal"] } }).sort({ lastSeen: -1 })   // ข้าม warning
db.error_events.find({ fingerprint: "<fp>" }).sort({ occurredAt: -1 }).limit(3)                    // ตัวอย่างล่าสุด
```

`count` เป็นค่าประมาณ (5.7) และรวมครั้งที่ติดเพดาน

**3. ปิด issue ด้วยมือ**

```js
db.error_issues.updateOne(
  { _id: "<fingerprint>" },
  { $set: { status: "resolved", statusChangedAt: new Date(), statusReason: "แก้ใน <commit> — <ชื่อผู้ปิด>" } }
)
```

- **ต้องตั้ง `statusChangedAt: new Date()`** — การเปิดกลับเมื่อเกิดซ้ำดูจาก `lastSeen > statusChangedAt` (5.4) · `ignored` = นับต่อแต่ไม่เปิดกลับ · เปิดกลับเอง = `open`
- แก้แค่สามฟิลด์นี้ อย่าแตะตัวนับหรือลบ issue · **ไม่มีแถว audit บันทึกการแก้นี้** (`ERROR_ISSUE_STATUS_CHANGED` มากับ PATCH ของขั้น 7) `statusReason` คือร่องรอย
  เดียว จดไว้ในการ์ดด้วย

**4. `logStore` เป็น `down`**

1. ดูสถานะ: `curl -s localhost:<พอร์ต API>/health/ready` (`checks.logStore`) · `docker compose ps mongo` · `docker compose logs --tail 50 mongo`
2. ดูสาเหตุ: `docker compose logs backend delivery-worker | grep -E '\[log-store\]|\[capture\]' | tail -30` (3.13) — **ไม่ใส่ `--since` สั้น ๆ**:
   บรรทัด `ใช้ MongoDB ไม่ได้ — <สาเหตุ>` พิมพ์ครั้งเดียวตอนสถานะเปลี่ยน แล้วพิมพ์ใหม่เฉพาะเมื่อสาเหตุเปลี่ยนและห่างกันเกินสิบนาที ถ้าล่มมานานกว่าช่วงที่
   `--since` ครอบ บรรทัดสาเหตุจะไม่อยู่ในผล (ต้องการจำกัดช่วงก็ให้ย้อนไปถึงตอนที่ `logStore` เริ่มเป็น `down`)
3. สาเหตุที่พบบ่อย: container ไม่ขึ้นหรือวนรีสตาร์ต — บน production ดูบรรทัด `[mongo] ไม่เริ่ม MongoDB: …` แล้วตั้งรหัสผ่านตาม 3.12 · `Authentication failed` —
   รหัสผ่านใน `.env` ไม่ตรงกับผู้ใช้ใน volume (มักเพราะแก้ `.env` แล้วสร้าง backend/worker ใหม่) — ทำตามลำดับใน 3.12: สร้าง `mongo` ใหม่ก่อนให้รับ `.env` ใหม่
   แล้วรัน `01-users.js` แล้วสร้าง backend กับ worker ใหม่ถ้ายังถือ URI เก่า (รัน `01-users.js` โดยไม่สร้าง `mongo` ใหม่ = ใส่รหัสเดิมกลับ ไม่ได้แก้อะไร) ·
   `driver แยก MONGODB_URI ไม่ได้` หรือ `@ เกินหนึ่งตัว` — encode อักขระพิเศษใน URI · ดิสก์เต็ม
4. ปลุก mongo อย่างเดียว: `docker compose up -d --no-deps mongo` (บน `main/` ใส่ `-f docker-compose.yml -f docker-compose.prod.yml` ด้วย) backend กับ worker ต่อใหม่เอง
   ในรอบตรวจ 30 วินาทีถัดไป ไม่ต้อง restart
5. ระหว่างที่ down: เว็บและอีเมลทำงานตามปกติ · capture ค้างคิว ≤ 500 รายการ / 2 MB ต่อ process แล้วทิ้งตามชั้น (5.7) · restart backend หรือ worker ระหว่างนี้ = คิวหาย ·
   หลังฟื้นหา `db.error_events.find({ fingerprint: /^error-capture:dropped/ }).sort({ occurredAt: -1 })`

**5. `logStore` เป็น `over_quota`** — `db.relay_state.findOne()` ดู `storageMb` `allocatedMb` `maxMb` · ทางออก: ขึ้น `LOG_STORE_MAX_MB` แล้วสร้าง worker ใหม่ (worker
ตรวจตอนบูต) หรือลด `error_events` ที่เก่ากว่า 90 วัน (retention ที่ออกแบบไว้ 7.3) ด้วย root หรือผู้ใช้ `bdi_worker` — **ห้ามลบ `activity`** (`audit_fallback` เป็นสำเนา
เดียวของแถวนั้น) ธงลงเมื่อรอบตรวจถัดไปเห็นต่ำกว่า 90% (restart worker เพื่อให้ตรวจทันที)

**6. ปิด log store** — ตั้ง `LOG_STORE_ENABLED=false` ใน `.env` แล้วสร้าง backend กับ delivery-worker ใหม่: `docker compose up -d --no-deps backend delivery-worker`
(บน `main/` ใส่ไฟล์ compose ทั้งสอง และ dump log ของ backend ก่อน เพราะ container ใหม่ไม่มี log เก่า) ไม่ต้อง build · ตรวจว่า `/health/ready` แสดง `disabled` และ
มีบรรทัด `[log-store] backend: ปิดอยู่ (LOG_STORE_ENABLED ไม่ใช่ true)` · mongo ปล่อยรันต่อหรือ `docker compose stop mongo` ก็ได้ · **อย่าปิดด้วยการเว้น URI ให้ว่าง** —
compose ไม่อ่าน `MONGODB_URI` จาก `.env` และเติม URI ตั้งต้นกลับมาเมื่อ `MONGODB_BACKEND_URI` / `MONGODB_WORKER_URI` ว่าง (3.13) · เปิดคืน = ลบบรรทัดนั้น (หรือตั้ง `true`) แล้วสร้างสอง service ใหม่อีกครั้ง

---

## 6. สิ่งที่ตั้งใจไม่บันทึก และแถวแปลกที่คนอ่านต้องรู้

### 6.1 ตั้งใจไม่บันทึก

| อะไร | ทำไม |
|---|---|
| การเรียก HTTP ทั่วไป · การอ่านที่ไม่ใช่ admin · poller (`/state`, `/api/auth/me`, `/api/notifications`) · ไม่มี `REQUEST_VIEWED` | การ์ดหมายถึงการเปลี่ยนสถานะ ไม่ใช่ access log การเรียกทุกครั้งของ `/api/admin*` จะถูกบันทึกในขั้น 8 เพราะการอ่านของ admin ได้เลขบัตรเต็ม · **ข้อยกเว้นที่มีอยู่แล้ววันนี้**: การอ่านไฟล์เขียน `DOCUMENT_DOWNLOADED` (GET หกเส้นทางที่ต้องล็อกอิน 4.8) · `GET /api/auth/invitation` เขียน `ACTIVATION_KEY_EXPIRED` ได้ · และ 401 ของ `requireAuth` **เขียนแถวได้** เมื่อ cookie ที่ยื่นมาหมดอายุ (`SESSION_REVOKED` `EXPIRED` ผ่าน `resolveSession()` `middleware/auth.ts:53`) หรือบัญชีไม่ `ACTIVE` แล้ว (`ACCOUNT_SUSPENDED` `:81-85`) — poller ที่ถือ cookie เก่าจึงสร้างแถวเหล่านี้ (แผน §13 ข้อ 26) |
| การพิมพ์ทีละตัว การเปิดหน้า autosave | ไม่มี autosave บันทึกเฉพาะการกดบันทึกที่เปลี่ยนค่าจริง |
| `POST /api/notifications/:id/read` · `/read-all` | งานเก็บบ้านของ UI เป็นเสียงรบกวน |
| `POST /api/admin/dataset-choices/refresh` | แตะแค่แคชในหน่วยความจำ |
| สคริปต์ `seed-masters` · `backfill-display-name` | รันด้วยมือและนาน ๆ ครั้ง เลื่อนไว้ก่อน |
| การกดบันทึกร่างที่ไม่มีอะไรเปลี่ยน (`REQUEST_DRAFT_SAVED`) · `LEGAL_DOCUMENT_UPDATED` / `USER_ACCOUNT_UPDATED` แบบโปรไฟล์ที่ไม่เปลี่ยน · `REQUEST_ASSIGNED` คนเดิม | สิ่งที่ต้องตอบคือ “ใครแก้อะไร” ไม่ใช่ “ใครกดปุ่ม” · ข้อยกเว้น: ร่างหน่วยงานที่ snapshot ถูกซิงก์จากบัญชีหรือถูก route แปลงรูปยังได้แถว `fields_changed: []` + `synced_from_account` / `normalised_by_route` แม้ผู้กรอกไม่ได้พิมพ์อะไร (4.7) · ส่วนการแก้**ทะเบียนหน่วยงาน** (`ORGANIZATION_UPDATED`) `REQUEST_UPDATED` และ `DATASET_CHOICE_CHANGED` ของ admin **เขียนเสมอ**แม้ไม่มีอะไรเปลี่ยน — ไม่มีทางแก้ทะเบียนไหนที่ข้ามการบันทึกที่ไม่เปลี่ยน |
| ตัวรหัส OTP · hash ของมัน · ค่า token · รหัสผ่าน · `error_description` ของ ThaID | ความลับหรือข้อความที่คุมไม่ได้ เก็บแค่ id, fingerprint หรือรหัส (`error_description` ยังลง `integration_operation.last_error_message` นอก audit หลังผ่าน `scrubText()` — 5.6) |
| คำสั่งเปลี่ยนข้อมูลที่ถูกปฏิเสธด้วย 4xx บนเส้นทางธุรกิจ (เช่น 409 `role_occupied` `invitation_pending` · 400 `validation` · 404 ของสิทธิ์ · 403 `no_organization` ของ `POST /api/organizations` รวมผู้ประสานงานที่ถูกแทนที่ซึ่งพยายามเปิดหน่วยงานเอง — `7259c09`) | ไม่มีที่บันทึก — ข้อเสนอ `REQUEST_REFUSED` เป็นงานถัดไป (แผน §13 ข้อ 29) · ความล้มเหลวของการยืนยันตัวตน**ถูกบันทึก**แม้ตอบ 4xx: `LOGIN_FAILED` (401/403/400/429) · `PASSWORD_RESET_COMPLETED` `FAILURE` (410/409) · `IDENTITY_VERIFICATION_FAILED` (400/403/409/410/502) · `ADMIN_TOKEN_REJECTED` (401) — ยกเว้น 400 `validation` ของ body ที่ผิดรูป (4.1) |
| แถวใหม่ของ review task · การเปิดด่าน · การยกเลิกด่านด้วย `cancelActiveTask()` · แถว `legal_acceptance` · การ render ซ้ำหลังลงนาม · การ render ตอน GET | ถูกบันทึกผ่านแถวของเหตุการณ์ต้นเรื่องเท่านั้น (ผลการตรวจ `DOCUMENT_SIGNED` `REQUEST_FORM_GENERATED`) |
| โทเคนตั้งรหัสผ่านเก่าที่ถูกเพิกถอนตอนออกใบใหม่ · การเขียน `external_subject` ครั้งแรก · โปรไฟล์ที่เขียนตอน `/activate` | ช่องว่างที่รู้แล้ว ไม่ใช่การตัดสินใจ |
| การเข้าถึงฐานข้อมูลด้วย `docker exec` / `psql` / `mongosh` บนเครื่อง (รวมการปิด issue ด้วยมือ — 5.11) | อยู่นอกแอป ไม่มีร่องรอย (ความเสี่ยงที่ BDI ต้องยอมรับ แผน Q13) |
| ข้อบกพร่องของ QA A4 (แถว `ROLE_REVOKED` ซ้ำและในธุรกรรม · ผู้ถูกกระทำเป็น actor) | **ปล่อยไว้ตามเดิมโดยตั้งใจ** เป็นงานของการ์ด QA A4 สำเนา Mongo คัดลอกตามจริง — วิธีอ่านอยู่ 6.2 |

### 6.2 แถวแปลกที่มีอยู่จริง

**แถวที่เขียนระหว่าง transaction ยังเปิด (ในธุรกรรม)** — `revokeRoleAssignments()` (`iam.ts:380`) และ `revokeSessionsFor(tx, …)`
(`session.ts:182`) รับ `tx` มาใช้แก้ข้อมูล แต่ `logAudit` เขียนด้วย prisma ตัวหลัก แถว audit จึง commit ทันทีบนอีก connection:

- `occurred_at` มาก่อนการ commit ของธุรกรรมจริง
- ถ้าธุรกรรมถูก rollback ภายหลัง แถว `ROLE_REVOKED` / `SESSION_REVOKED` **ยังอยู่** ทั้งที่การเพิกถอนไม่เคยเกิด — ตรวจได้โดยดูว่า
  แถวต้นเรื่องของ correlation id เดียวกัน (`USER_ACCOUNT_DEACTIVATED` `ROLE_ASSIGNED` `REQUEST_RESET_TO_DRAFT`
  `PASSWORD_RESET_COMPLETED` ฯลฯ) มีหรือไม่ ไม่มี = น่าสงสัยว่าเป็นแถวผี
- snapshot `actor_*` อ่านสถานะที่ commit แล้ว จึงเห็น role และหน่วยงาน**ก่อน**เปลี่ยน (แถวของการย้ายหน่วยงานแสดงหน่วยงานเก่า)
- relay [ออกแบบ] จะคัดลอกแถวเหล่านี้ตามจริง รวมแถวผี

จุดที่เป็นแบบนี้: `admin-registrations.ts:465` `:475` · `admin-users.ts:622` `:747` `:844` `:855` `:1408` `:1422` · `auth.ts:943` ·
และทุกทางที่ `assignRole(tx)` ไปแทนที่ผู้ถือที่นั่ง (4.4) คอมเมนต์ของ `revokeRoleAssignments()` (`iam.ts:329-331`) ที่ว่าไม่เขียน audit
ในธุรกรรมขัดกับโค้ดของมันเอง และคอมเมนต์เหนือ `removedFromOrganization()` (`routes/auth.ts:1276`) ที่ว่า `revokeRoleAssignments()`
“ยังไม่เขียน audit_event” ก็ล้าสมัยเหมือนกัน (แผน §13 ข้อ 12)

**`ROLE_REVOKED` สองแถวต่อการแทนที่หนึ่งครั้ง** — บน `/api/auth/activate`, `POST /api/organizations` และการตรวจคำขอหน่วยงาน การแทนที่ผู้ถือ
ที่นั่งได้ทั้งรูปแบบ A (ในธุรกรรม `reason` ไทย `before.roleId`) และรูปแบบ B (หลัง commit `reason: REPLACED_BY_NEW_HOLDER`
`role_code` `revoked_user_account_id`) บน subject เดียวกัน correlation id เดียวกัน actor ของสองแถวขึ้นกับเส้นทาง:

| เส้นทาง | actor ของ A | actor ของ B |
|---|---|---|
| `POST /api/auth/activate` | `USER` = บัญชีที่กำลังเปิด (`iam.ts:697-702`) | `SYSTEM` + null (ไม่มี actor ใน context — `notify.ts:194`) |
| `POST /api/organizations` (**ถอดแล้วที่ `7259c09`** — แถวเก่าเท่านั้น) | `USER` = ผู้สร้างหน่วยงาน (`session.sub`, `organizations.ts:1133-1138`) | `USER` = คนเดียวกัน (จาก context ของ session `:1146`) |
| `POST /api/organizations/:id/review` | `USER` = `SYSTEM_USER_ID` (`:3237-3242`) snapshot เป็นอีเมลของบัญชีระบบ | `USER` = ผู้ประสานงาน BDI ที่กดตรวจ (`:2921`) |

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
`audit_fallback` อยู่ข้าม seed · เมื่อมีสำเนาจาก relay [ออกแบบ] สำเนายังเก็บไว้ และ reconcile ของ relay จะรายงานว่า Mongo มากกว่า

**IP ที่ผู้เรียกกำหนดเอง** — บน dev checkout `ip_address` คือค่าสุดท้ายของ `X-Forwarded-For` ที่ผู้เรียกพิมพ์มา (ยิงผ่านหน้าเว็บก็ได้) บน
production ถูกต้องเท่าที่ Cloudflare ต่อท้ายให้ ซึ่ง**ยังไม่ได้ยืนยัน**กับ tunnel ของเรา และใครเข้าถึงพอร์ต 3000/4000 ตรงได้ก็ตั้งเองได้ ·
แถวทันทีและแถวสรุปของถังรวม `ADMIN_TOKEN_REJECTED` ไม่มี IP เลยโดยตั้งใจ

**correlation id ไม่ใช่หลักฐานว่าเป็นคลิกเดียว** — ผู้เรียกส่ง UUID ของตัวเองได้ (รวมใช้ซ้ำหรือชนกับคนอื่น) แถวสรุปได้ id ใหม่ที่ไม่ตรง
คำขอใด ThaID ข้ามคำขอ และปุ่มสร้างเอกสารเป็นสองคำขอ (PATCH บันทึกร่างก่อน แล้ว `generate-form` — 2.5 และ `REQUEST_DRAFT_SAVED` ใน 4.7)
กลับกัน การกระทำเดียวที่กินหลายคำขอก็มีหลาย id (ตาราง “แถวที่มาเป็นชุด” ใน 4.0)

**บัญชี PENDING ที่ถูกลบไม่เหลือ id** — `INVITATION_DELETED` `APPROVER_INVITATION_RECALLED` (`accountDeleted: true`) และ `ACTIVATION_KEY_ISSUED`
ขา resend ไม่มี id ของบัญชี ชีวิตของบัญชีที่จบด้วยการถูกลบจึงต่อกันได้ด้วยอีเมลหรือเลขบัตรเท่านั้น และในสำเนา Mongo เลขบัตรถูกปิด
อีเมลบัญชีไม่ถูก hash (3.2 · 4.5)

**แถวเก่าก่อนการ์ด** — บน production วันนี้ (และแถวที่เขียนก่อน deploy ของการ์ดนี้): `ORGANIZATION_CREATED` ทาง WEB_FORM มี subject เป็นคำขอ ·
`ORGANIZATION_UPDATED` ที่ subject เป็นคำขอคือการเปิดคำขอ · `LEGAL_DOCUMENT_PUBLISHED` ของ PATCH คือการแก้ข้อมูลเอกสาร ·
`ORGANIZATION_UPDATED` ของ admin เก็บแค่รหัสกับชื่อ · แถวของ admin ทุกแถวเป็น `web-portal` · `LOGIN_FAILED` `INVALID_CREDENTIAL`
เป็น `SYSTEM` · แถวอัปโหลดไฟล์ขนาดจริงเป็น `SYSTEM` + `request-service` + ไม่มี IP · มีหกแถว `admin-script` ที่ใส่ด้วยมือ · user agent ไม่ถูกปิดเลข

**แยกแถวก่อนและหลัง deploy ของการ์ดนี้** — Postgres ไม่มี `schemaVersion` ถ้าไม่รู้วันที่ deploy จะใช้รายการข้างบนไม่ได้
**[ต้องตัดสิน]** เมื่อ Deploy A ขึ้น production ให้จด commit และเวลา (UTC) ลงหัวข้อนี้และการ์ด แล้วใช้ `occurred_at` เป็นเส้นแบ่ง ระหว่างนี้
ใช้สัญญาณในแถวเอง: แถวหลัง deploy ตรวจได้จาก (1) รหัสที่เพิ่งมีในการ์ด — เจ็ดตัวที่ไม่มีใน `AuditAction` ของ `4eeb8d3`: `ADMIN_TOKEN_REJECTED`
`IDENTITY_VERIFICATION_STARTED` `LEGAL_DOCUMENT_UPDATED` `LOGIN_OTP_ISSUED` `REQUEST_ASSIGNED` `REQUEST_DRAFT_SAVED` `REQUEST_FORM_GENERATED`
— แถวแรกของรหัสเหล่านี้บอกจุดเริ่มคร่าว ๆ (2) แถวของ
admin มี `admin_token_fp` และ `admin-portal` ส่วนแถวที่เป็นของเส้นทาง admin (`*_via: "ADMIN_API"`) แต่เป็น `web-portal` และไม่มี
fingerprint คือแถวก่อนการ์ด (3) `LOGIN_FAILED` ที่เป็น `SYSTEM` คือก่อนการ์ด (4) user agent ที่มีกลุ่มเลข 9 หลักขึ้นไปไม่ถูกแทนด้วย `:n`
คือก่อน `a0a0578`

---

## 7. ข้อมูลส่วนบุคคลและการปิดบัง

### 7.1 ข้อมูลส่วนบุคคลอยู่ตรงไหน

| ส่วน | Postgres `audit_event` (วันนี้) | Mongo `activity` (`audit_fallback` สร้างแล้ว · relay ออกแบบ) | Mongo `error_events` (สร้างแล้ว) |
|---|---|---|---|
| ตัวตนของผู้กระทำ | `actor_id` + `actor_name` (ชื่อไทย หรืออีเมล) + role | `actor.*` เหมือนกัน | `actor {id, roles, organizationId, sessionId}` ไม่มีชื่อ |
| IP · user agent | IP ดิบ (ที่อ้างมา) · UA ปิดกลุ่มเลข ≥ 9 หลัก ตัดที่ 512 (แถวก่อน `a0a0578` เก็บ UA ดิบ) · `iam.session` เก็บ UA ดิบ | เหมือน Postgres · [ออกแบบ] category ธุรกิจ `$unset` เมื่อครบ 365 วัน · auth/session ลบทั้งเอกสารที่ 400 วัน | IP ตามที่แยกได้ · UA กวาดแล้ว ≤ 512 · [ออกแบบ] ลบทั้งเอกสารที่ 90 วัน — **วันนี้ยังไม่มี prune** |
| เลขบัตรประชาชน | ปิดที่จุดเขียนใหม่ (7.2) · **เต็ม**ที่จุดเขียนเดิมและใน `thaid_subject` | คีย์ที่ชื่อตรงเหลือ 4 ตัวท้าย · เลข 13 หลักในข้อความทุกค่าเป็น `[cid]` (3.14) · [ออกแบบ] `cid#` (ค่าที่ Postgres ปิดมาแล้วไม่ได้ `cid#` — 3.6) | กวาดเป็น `[cid]` · ใน `extra.audit` ปิดแบบเดียวกับ `activity` |
| อีเมล | อีเมลบัญชีในหลายแถว · อีเมลที่พิมพ์ตอนล็อกอิน (`LOGIN_FAILED`) ดิบ | อีเมลที่พิมพ์ปิด (`so***@…`) + [ออกแบบ] `email#` · อีเมลบัญชีคงไว้ | กวาดเป็น `[email]` · body เก็บแค่ `present` · `extra.audit` คงอีเมลบัญชีไว้เหมือน `activity` |
| ชื่อ เบอร์โทร ตำแหน่ง อีเมลบัญชี ที่อยู่ | ใน diff ของร่าง/`REQUEST_UPDATED`/`USER_ACCOUNT_UPDATED` · และนอก diff: `ACTIVATION_KEY_ISSUED.after.name`/`email` · `USER_ACCOUNT_CREATED.after.displayName`/`email` · `APPROVER_INVITATION_RECALLED.before.displayName`/`email` · `INVITATION_DELETED.before.email` · `USER_ACCOUNT_DEACTIVATED.before.email` · `USER_IDENTITY_RELEASED` `before`/`after.email` · `PASSWORD_RESET_REQUESTED.metadata.email` · เบอร์โทร อีเมล และที่อยู่ของหน่วยงานใน `ORGANIZATION_CREATED` `UPDATED` `ACTIVATED` — ไม่ปิดทั้งหมด | คงไว้ | ไม่เก็บ (body เป็น shape) ยกเว้นใน `extra.audit` ของ `audit.write-failed` ที่คงไว้เหมือน `activity` |
| ข้อความอิสระ | `reason` · `note` · `admin_reason` · `suspensionReason` · ชื่อไฟล์ · `path` และ user agent ของผู้ยิง | `audit_fallback` (3.14): เลข 13 หลักในทุกค่าที่เป็นข้อความ รวมชื่อไฟล์ เป็น `[cid]` · relay ตาม 3.6 [ออกแบบ]: ปิดเลข 13 หลักเฉพาะใน `note` `reason` และคีย์ที่ระบุ (เหลือ 4 ตัวท้าย) ชื่อไฟล์ไม่ถูกแตะ | กวาดตาม 5.6 |

### 7.2 ปิดที่ไหน อย่างไร

**Postgres — ปิดที่จุดเขียน ไม่ใช่ใน `logAudit`:**

- `sanitizeDiff()` / `sanitizeState()` (`audit.ts:727`, `:741`) แทนค่าของคีย์ที่ชื่อตรง `CID_KEY = /cid$|nationalid|^pid$|^thaid_subject$/i`
  (ทุกระดับความลึกของ object ธรรมดาและ array) ด้วย `{masked: "x…" + 4 ตัวท้าย, changed: true}` — ตัดสินจาก**ชื่อคีย์** ไม่ใช่รูปของค่า
  ค่าที่ยาวไม่เกิน 4 ตัวถูกปิดทั้งหมด และ `changed: true` เป็นค่าคงที่ (มีทั้งสองฝั่งและในแถวสร้าง) — **ยกเว้นค่า null** ซึ่ง `maskCid()`
  คืนตามเดิม (`audit.ts:696-701`): ฝั่งที่เลขบัตรว่าง (กรอกครั้งแรก หรือล้างค่า) เป็น `null` ธรรมดา ไม่ใช่ object `{masked, changed}`
- ใช้ที่: `REQUEST_DRAFT_SAVED` ทั้งสองเส้นทาง · `REQUEST_ASSIGNED` · `ORGANIZATION_UPDATED` ·
  `ORGANIZATION_ACTIVATED` · `USER_ACCOUNT_UPDATED` ขา ThaID · `USER_ACCOUNT_CREATED` ทั้งสองจุด · `ACTIVATION_KEY_ISSUED` ของ review
- **`logAudit` และไม่มีขั้นกลางใด sanitize `metadata`** — คีย์เดียวที่ผ่าน `sanitizeDiff()` คือ `organization_master_changed` ของ
  `REQUEST_DRAFT_SAVED` ซึ่งจุดเรียกประกอบเอง (`organizations.ts:1541-1548` `:1568`) และจุดเขียนที่มีมาก่อนการ์ด**ยังเก็บเลขบัตรเต็ม**
  จนกว่า BDI จะตัดสิน (แผน Q4 · `CLAUDE.md`):

| จุด | ฟิลด์ |
|---|---|
| `ACTIVATION_KEY_ISSUED` ของ `POST /api/admin/invitations` (`admin.ts:867`) | `after.cid` |
| `INVITATION_DELETED` (`admin.ts:1219`) | `before.cid` |
| `USER_ACCOUNT_UPDATED` แบบอีเมล/เลขบัตร (`admin-users.ts:629`) | `before.cid` · `after.cid` |
| `USER_ACCOUNT_DEACTIVATED` (`admin-users.ts:871`) | `before.cid` |
| `APPROVER_INVITATION_RECALLED` (`admin-registrations.ts:553`, `organizations.ts:2908`) | `before.cid` |
| `REQUEST_UPDATED` (`admin-registrations.ts:293`, `:754`) | `approverCid` `userCid` ใน diff |
| `IDENTITY_VERIFIED` · `IDENTITY_VERIFICATION_FAILED` CID_MISMATCH · `LOGIN_FAILED` THAID_NO_MATCHING_ACCOUNT (`auth.ts:483` `:457` `:594`) | `metadata.thaid_subject` |

- ปิดอย่างอื่นกับทุกแถว: `storedUserAgent()` · `ADMIN_TOKEN_REJECTED` เก็บ `token_fp` ไม่ใช่ token และ `path` เป็นรูปแบบ ·
  `LOGIN_OTP_ISSUED` ไม่เก็บรหัส · `IDENTITY_VERIFICATION_FAILED` ไม่เก็บข้อความจาก ThaID
- **อีเมลไม่ถูกปิดเลย** ใน Postgres

**Mongo `activity` — ปิดก่อนออกจาก process** สร้างแล้วสำหรับเอกสาร `audit_fallback` (`maskForLogStore()` — 3.14) และจะใช้กับ relay (3.6 [ออกแบบ]):
เลขบัตรทุกคีย์ที่ชื่อตรง (รวม `thaid_subject`) และเลข 13 หลักในข้อความ · อีเมลที่พิมพ์ของ `LOGIN_FAILED` · ค่าที่ Postgres ปิดมาแล้วผ่านไปตามเดิม ·
user agent ของแถวก่อน `a0a0578` **ไม่ถูกปิด** (3.3) · Postgres ไม่ถูกแก้

**Mongo `error_events` — กวาดตอนเก็บ (5.6) สร้างแล้ว** body เป็นรูปร่าง · ค่าของ query ไม่ออก · stack ประกอบใหม่ · `extra.audit` ปิดแบบ `activity`

### 7.3 retention [ออกแบบ · BDI ยืนยันตัวเลข]

| ข้อมูล | เก็บนาน |
|---|---|
| Postgres `audit_event` | **ไม่มี retention** (ไม่เปลี่ยนในการ์ดนี้) · `seed:demo` ล้างทั้งตาราง |
| `activity` — `account` `role` `invitation` `organization` `request` `review` `document` `config` `log-access` | ไม่ลบ · IP/UA ถูกลบที่ 365 วัน |
| `activity` — `auth` `session` · `ADMIN_API_REQUEST` · `*_TOKEN_REJECTED` | 400 วัน (ปีเต็มของประวัติการเดารหัส และนานกว่า 90 วันของ พ.ร.บ.คอมพิวเตอร์ ม.26 ถ้าใช้บังคับ) |
| `activity` — `system` `other` | **[ต้องตัดสิน]** |
| `error_events` · `runtime_events` | 90 วัน (รายงานจากเบราว์เซอร์ 30 วัน) |
| `error_issues` | 365 วันหลัง `lastSeen` เว้นแต่ยัง `open` |

**วันนี้ยังไม่มีอะไรถูกลบใน Mongo** — prune มากับขั้น 6 ระหว่างนี้เพดานขนาด (5.9) เป็นตัวคุมเดียว และลดด้วยมือได้ตาม 5.11 ข้อ 5

เรื่องที่รอ BDI: ปิดเลขบัตรในแถว Postgres เดิมด้วยหรือไม่ (Q4) · อีเมลที่พิมพ์ใน Postgres (Q11) · ตัวเลข retention (Q3) · ความเสี่ยงที่เหลือ
(docker exec บนเครื่องที่ใช้ร่วม พอร์ตที่เปิด `0.0.0.0` backup ที่ไม่เข้ารหัส — Q13) · ชุดเอกสาร PDPA (ROPA ม.39 · ประกาศความเป็นส่วนตัว ·
ข้อยกเว้นการลบ ม.33 · การขอดูข้อมูลของเจ้าของข้อมูลผ่าน timeline) จะเพิ่มในเอกสารนี้ที่ขั้น 11 หลัง DPO ยืนยัน

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
   `reason` เก็บรหัส — ตาราง “ความหมายของ reason” ใน 4.0) และ `request_number` เมื่อเกี่ยวกับคำขอ (ที่เดียวที่เหลือถ้าแถวคำขอถูกลบ การที่
   สำเนา Mongo ใช้มันเติม `requestNumber` สำรองเป็น **[ข้อเสนอ]** ของ 3.2 relay ในแผนค้นจากตารางคำขอด้วย subject id) · ใส่ id ของ**คน**
   ที่ได้รับผลไว้เสมอ (`user_account_id` หรือ `before`/`after.userAccountId`) แม้บัญชีจะถูกลบในคำขอเดียวกัน · ห้ามตั้งชื่อคีย์
   `actor_name` `actor_roles` `actor_organization_id` เพราะทับ snapshot (2.3) · ห้ามใส่ `BigInt`
6. **ตาราง category** เพิ่มรหัสลงตาราง action → category ใน `src/lib/activity-shape.ts` (มีตั้งแต่ขั้น 6) ไม่งั้นได้ `other` และ
   retention ไม่ตรงตั้งใจ — วันนี้ตารางชั่วคราวอยู่ที่ `CATEGORY_RULES` ใน `lib/audit-fallback.ts` (จับด้วย prefix รหัสที่ขึ้นต้นด้วย prefix ใหม่ได้ `other`)
   ถ้ามีคีย์ใหม่ที่ถือเลขบัตรหรืออีเมลที่พิมพ์มา ให้ตรวจว่ากฎการปิดของสำเนาครอบ — กฎอยู่ใน `lib/redact.ts`: `CID_KEY` ของ `maskForLogStore()`
   ต้องตรงกับ `CID_KEY` ใน `lib/audit.ts` · อีเมลที่พิมพ์ถูกปิดเฉพาะ `LOGIN_FAILED.metadata.email` (`lib/audit-fallback.ts`) คีย์ใหม่ที่ถืออีเมลที่พิมพ์ต้อง
   เพิ่มที่นั่น · `hashKeys` มากับ `activity-shape.ts` ในขั้น 6
7. **เอกสารนี้** เพิ่มหัวข้อในหมวด 4 ตามแบบเดียวกัน (เกิดเมื่อ · actor · subject · before/after · metadata · ข้อมูลส่วนบุคคล · โค้ด) และ
   แก้ตารางใน 3.5 และ 4.0 ถ้าเกี่ยว
8. **`CLAUDE.md`** ถ้า event ใหม่ตั้งกติกาใหม่ (ลำดับการเขียน ข้อยกเว้นของการปิดข้อมูล ความหมายที่แยกจากรหัสอื่น) เพิ่มในหัวข้อ
   *Audit log, notifications and the outbox*
9. **ตรวจของจริง** เดินผ่าน UI หรือ API แล้วดูแถวใน `psql` (`select action, actor_type, subject_type, before_summary_json,
   after_summary_json, metadata_json from audit.audit_event order by occurred_at desc limit 5;`) · หลังขั้น 6 ดูเอกสารใน `mongosh` ว่า
   `category` ถูกและค่าที่ควรปิดถูกปิด
10. **error ของโค้ดใหม่** ห้ามส่ง error หรือ `message` ของมันให้ `console.*` — ใช้ `captureError(err, {tag})` (`lib/error-capture.ts`) ซึ่งพิมพ์บรรทัดที่
   กวาดแล้วเอง บรรทัดภาษาไทยข้าง ๆ บอกแค่ที่เกิดแล้วชี้ `— ดูบรรทัด [capture] ถัดไป` · `extra` ต้องกวาดมาเอง · breadcrumb ใหม่ห้ามมีอีเมล ชื่อ
   หรือค่าที่ผู้ใช้กรอก (5.2) · fingerprint ตายตัวใช้เมื่อ error ของที่เดียวกันแตก issue ตามข้อความ (5.4)
