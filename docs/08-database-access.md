# เปิดฐานข้อมูลด้วย DBeaver

ฐานข้อมูลอยู่ใน container ของแต่ละ checkout และเปิดพอร์ตออกมาที่เครื่อง host แล้ว
DBeaver จึงต่อได้ตรง ๆ ไม่ต้อง `docker exec`

> **เปิดฐานข้อมูลของ checkout ไหน = เลือกที่พอร์ต** ทุก checkout ใช้ชื่อฐานข้อมูล
> ผู้ใช้ และรหัสผ่านชุดเดียวกันหมด ต่างกันแค่พอร์ต ต่อผิดพอร์ตคือกำลังดูข้อมูล
> ของงานคนอื่นโดยไม่รู้ตัว **ตรวจพอร์ตก่อนทุกครั้งที่จะแก้อะไร**

---

## 1. ค่าที่ใช้ต่อ

อ่านจาก `.env` ของ checkout นั้น (`POSTGRES_*`) ค่าตั้งต้นบนเครื่องนี้คือ

| ช่อง | ค่า |
|---|---|
| Host | `localhost` (ถ้า DBeaver อยู่คนละเครื่อง ดูข้อ 3) |
| Port | **ต่างกันตาม checkout** — ดูตารางข้างล่าง |
| Database | `bdi` |
| Username | `bdi` |
| Password | `bdi_dev_password` |

พอร์ตของ Postgres มาจาก port slot ที่ `new-dev.sh` กำหนดให้ตอนสร้าง checkout
สูตรคือ `5500 + slot × 10` (`new-dev.sh` บรรทัด 52)

| checkout | พอร์ต |
|---|---|
| `main` | **5432** |
| `dev/dev_01` (slot 01) | 5510 |
| slot 06 | 5560 |
| slot `NN` | `55N0` — คือ `5500 + NN × 10` |

ดูพอร์ตจริงของ checkout ที่ถืออยู่:

```bash
grep POSTGRES_PORT .env
docker compose ps postgres        # คอลัมน์ PORTS บอกพอร์ตที่ผูกไว้จริง
```

## 2. สร้าง connection ใน DBeaver

1. **Database → New Database Connection → PostgreSQL → Next**
2. กรอก Host / Port / Database / Username / Password ตามข้อ 1
3. ติ๊ก **Save password** ถ้าไม่อยากพิมพ์ซ้ำ
4. **Test Connection** — ครั้งแรก DBeaver จะขอโหลด driver ของ PostgreSQL ให้กด Download
5. **Finish**

ตั้งชื่อ connection ให้ตรงกับ checkout (คลิกขวา → Edit Connection → General → Connection name)
เช่น `bdi-main (5432)` หรือ `bdi-thaid (5560)` — ชื่อที่บอกพอร์ตช่วยกันต่อผิดตัวได้จริง

**แนะนำให้ตั้ง `main` เป็น read-only**: Edit Connection → General → ติ๊ก
**Read-only connection** `main` คือตัวที่เปิดให้คนนอกดู การพิมพ์ `update` ผิดที่นั่น
ไม่มีใครเห็นจนกว่าจะมีคนบ่นว่าจอเพี้ยน

## 3. ต่อจากเครื่องอื่น

Postgres ผูกพอร์ตไว้ที่ `0.0.0.0` ทุก checkout เครื่องอื่นในวงแลนจึงต่อได้เลย
โดยเปลี่ยน Host เป็น IP ของเครื่องนี้ (**`192.168.1.97`** ณ วันที่เขียน — `hostname -I` เพื่อดูค่าปัจจุบัน)

ถ้าไม่ได้อยู่วงแลนเดียวกัน ใช้ SSH tunnel ที่ DBeaver มีมาให้:

**Edit Connection → SSH → Use SSH Tunnel** แล้วกรอก host/user/key ของเครื่องนี้
ส่วนแท็บ Main ให้คงไว้ที่ `localhost` + พอร์ตตามตาราง เพราะ DBeaver จะต่อจาก "ในเครื่องนี้"
วิธีนี้ปลอดภัยกว่าและไม่ต้องเปิดพอร์ตเพิ่ม

> ⚠️ รหัสผ่านคือ `bdi_dev_password` เหมือนกันทุก checkout และพอร์ตเปิดกว้างที่ `0.0.0.0`
> ตราบใดที่เครื่องนี้อยู่หลัง NAT ก็ยังพอรับได้ แต่ **ห้าม forward พอร์ต 5432 ออกอินเทอร์เน็ต**
> ถ้าวันหนึ่งต้องเปิดจริง ให้เปลี่ยนรหัสผ่านใน `.env` แล้ว `docker compose up -d postgres` ก่อน

## 4. สิ่งแรกที่ต้องรู้ — ตารางไม่ได้อยู่ใน `public`

สคีมาแยกตามโดเมนตามที่ดีไซน์กำหนด (ดู `docs/06-db-migration-plan.md`) `public` มีแค่
ตารางประวัติ migration ของ Prisma เท่านั้น

| schema | ตาราง |
|---|---|
| `iam` | `user_account`, `role`, `user_role_assignment`, `activation_key`, `otp_code` |
| `organization` | `organization`, `organization_registration_request` |
| `dataset` | `dataset`, `dataset_metadata`, `dataset_registration_request`, `dataset_registration_metadata` |
| `review` | `review_task` |
| `legal` | `legal_document`, `legal_document_version`, `legal_acceptance` |
| `signature` | `signature_confirmation` |
| `attachment` | `attachment` |
| `notification` | `notification`, `notification_delivery` |
| `integration` | `integration_operation` |
| `audit` | `audit_event` |
| `administration` | `province`, `district`, `sub_district` |
| `public` | `_prisma_migrations` — **อย่าแตะ** ดูข้อ 6 |

ใน Database Navigator เปิดตามลำดับ **connection → `bdi` → Schemas** แล้วจะเห็นครบทั้งหมด
ถ้าเห็นแค่ `public` ให้ดูที่ปุ่มมุมล่างของ Navigator แล้วสลับจาก **Simple view** เป็น
**Advanced view** (หรือ Edit Connection → PostgreSQL → ติ๊ก **Show all databases**)

**กับดักที่เจอทุกคน:** `search_path` เป็น `public` ตามค่าตั้งต้น เขียน

```sql
select * from user_account;     -- ERROR: relation "user_account" does not exist
```

ต้องใส่ชื่อ schema เสมอ

```sql
select * from iam.user_account;
```

หรือตั้ง search_path ไว้ต้น SQL editor แล้วค่อยพิมพ์สั้น ๆ (มีผลเฉพาะ session นั้น)

```sql
set search_path to iam, organization, dataset, review, public;
```

## 5. คิวรีที่ใช้บ่อย

```sql
-- บัญชีผู้ใช้และสิทธิ์ที่ยังใช้งานอยู่
select ua.email, ua.status, r.code, ura.status as assignment_status, o.name_th
from iam.user_account ua
left join iam.user_role_assignment ura on ura.user_account_id = ua.id
left join iam.role r on r.id = ura.role_id
left join organization.organization o on o.id = ura.organization_id
order by ua.created_at desc;

-- คำขอจดทะเบียนหน่วยงานค้างอยู่ที่ด่านไหน
-- review_task เก็บงานของทุก journey ไว้ตารางเดียว ต้องกรอง subject_type ด้วยเสมอ
select orr.request_number, orr.status, rt.task_type, rt.round_number, rt.status as task_status
from organization.organization_registration_request orr
left join review.review_task rt
       on rt.subject_id = orr.id
      and rt.subject_type = 'ORGANIZATION_REGISTRATION_REQUEST'
      and rt.completed_at is null
order by orr.created_at desc;

-- อีเมลที่ค้างอยู่ใน outbox (worker ยังส่งไม่สำเร็จ)
select nd.status, nd.attempt_count, nd.last_error_message, n.subject_type, n.created_at
from notification.notification_delivery nd
join notification.notification n on n.id = nd.notification_id
where nd.status <> 'SENT'
order by n.created_at desc;

-- ผลการคุยกับ ThaiD ล่าสุด (ดู docs/07-thaid-integration.md)
select operation, status, last_error_code, external_reference, created_at
from integration.integration_operation
order by created_at desc limit 20;

-- audit ล่าสุด
select occurred_at, action, result, subject_type, metadata_json
from audit.audit_event order by occurred_at desc limit 50;
```

## 6. ห้ามทำ

- **อย่าแก้ `status` ของคำขอด้วยมือ** สถานะของคำขอถูกคำนวณจาก `review.review_task`
  โดย `lib/workflow.ts` (`deriveRequestStatus()`) แก้ตรง ๆ ในตารางแล้วหน้าจอกับ backend
  จะเห็นไม่ตรงกัน และไม่มีอะไรฟ้อง — ใช้ API `POST /:id/review` แทน
- **อย่าลบหรือแก้ `public._prisma_migrations`** Prisma เทียบแถวในตารางนี้กับไฟล์ใน
  `backend/prisma/migrations` ถ้าไม่ตรง `migrate deploy` จะปฏิเสธการบูตทั้งหมด
  (เคยเจอมาแล้ว — `CLAUDE.md` หัวข้อ Commands)
- **อย่าลบแถว `attachment.attachment` เพื่อลบไฟล์** ไฟล์จริงอยู่ใน MinIO การลบแถวทิ้ง
  ทำให้ object ค้างอยู่โดยไม่มีใครอ้างถึง ระบบออกแบบให้ไฟล์เก่าเป็น `REPLACED` ไม่ใช่ถูกลบ
- **อย่าแก้ `audit.audit_event`** มันคือบันทึกว่าเกิดอะไรขึ้น ไม่ใช่ข้อมูลที่แก้ได้
- **อย่ารัน `docker compose down -v`** ถ้ายังอยากได้ข้อมูลในนั้น `-v` ลบ volume ทิ้งทั้งก้อน
  สร้างข้อมูลใหม่ได้ด้วย `seed:masters` แล้วตามด้วย `seed:demo` (ดู `CLAUDE.md`)

ถ้าต้องการแค่ "ดู" จริง ๆ สร้าง role อ่านอย่างเดียวไว้ใช้กับ DBeaver ก็ได้

```sql
create role readonly login password 'เปลี่ยนรหัสด้วย';
grant connect on database bdi to readonly;
grant usage on schema iam, organization, dataset, review, legal, signature,
      attachment, notification, integration, audit, administration to readonly;
grant select on all tables in schema iam, organization, dataset, review, legal,
      signature, attachment, notification, integration, audit, administration to readonly;
```

## 7. ทางเลือกที่ไม่ต้องใช้ DBeaver

```bash
docker compose exec postgres psql -U bdi -d bdi          # psql ใน container
docker compose exec backend npm run prisma:studio        # Prisma Studio บนเบราว์เซอร์
```

`prisma:studio` อ่านชื่อจาก `schema.prisma` จึงเห็นเป็นชื่อโมเดล (`UserAccount`)
ไม่ใช่ชื่อตารางจริง (`iam.user_account`) — สะดวกกว่าตอนไล่ความสัมพันธ์ แต่คิวรีเองไม่ได้
