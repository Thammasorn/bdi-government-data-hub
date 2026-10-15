# ระบบกลางเพื่อการแบ่งปันข้อมูลดิจิทัล (D2)

แพลตฟอร์มรวบรวมข้อมูลจากหน่วยงานรัฐ ของสถาบันข้อมูลขนาดใหญ่ (องค์การมหาชน)

สเปกต้นทางอยู่ใน Notion — ที่ขยายเป็นเอกสารพร้อมพัฒนาแล้วอยู่ใน `docs/`:

| เอกสาร | เนื้อหา |
| --- | --- |
| [`docs/01-user-journey.md`](docs/01-user-journey.md) | roles, state machine, ทุกขั้นตอนของสามเส้นทาง, อีเมลที่ระบบส่ง, คำถามที่ยังค้าง |
| [`docs/02-ui-spec.md`](docs/02-ui-spec.md) | design tokens จาก CI จริง, รายการหน้าจอ, รายละเอียดหน้าสำคัญ |
| [`docs/03-demo-walkthrough.md`](docs/03-demo-walkthrough.md) | **วิธีเดินระบบทีละขั้น** — เตรียมข้อมูล, บัญชีทดสอบ, สาธิตทั้งสาม flow, แก้ปัญหาที่เจอบ่อย · **หัวข้อ 10 = สคริปต์สำหรับสาธิตสด** |
| [`docs/04-dataset-registration-plan.md`](docs/04-dataset-registration-plan.md) | แผนการพัฒนาเส้นทางชุดข้อมูล — สคีมา, endpoint, หน้าจอ, การตรวจสอบ |
| [`docs/05-sit-report.md`](docs/05-sit-report.md) | ผล SIT ทั้งสามเส้นทาง (48 กรณี) ข้อบกพร่องและปัญหาการจัดแนวที่แก้แล้ว — ภาพหน้าจอเก็บนอก repo |
| [`docs/06-db-migration-plan.md`](docs/06-db-migration-plan.md) | การย้ายสคีมาไปตาม Excel ออกแบบฐานข้อมูลของ BDI |
| [`docs/07-thaid-integration.md`](docs/07-thaid-integration.md) | การเชื่อม ThaID, การตั้งค่า, สิ่งที่ DOPA ยังไม่อนุญาต และผล SIT กับ sandbox |
| [`docs/08-database-access.md`](docs/08-database-access.md) | ต่อ DBeaver / psql เข้าฐานข้อมูลของแต่ละ checkout — พอร์ตไหนของใคร, โครงสคีมา |
| [`docs/09-auth-tokens.md`](docs/09-auth-tokens.md) | token ทุกตัวในระบบ — เก็บที่ไหน hash อย่างไร หมดอายุเมื่อไร |
| [`docs/10-admin-prefill-organization.md`](docs/10-admin-prefill-organization.md) | หน่วยงานที่ admin สร้างไว้ล่วงหน้า และข้อมูลที่ไปเติมในฟอร์มของผู้ใช้ |
| [`docs/11-metadata-registration-form.md`](docs/11-metadata-registration-form.md) | ฟอร์ม metadata ชุดข้อมูล — ทุกช่อง, code list, เงื่อนไขบังคับ/ซ่อน |
| [`docs/17-legal-document-rendering.md`](docs/17-legal-document-rendering.md) | เอกสารข้อตกลง A0–A3: `.docx` → LibreOffice (Gotenberg) → PDF, template ในฐานข้อมูล |
| [`docs/19-azure-blob-storage.md`](docs/19-azure-blob-storage.md) | ไฟล์แนบบน Azure Blob Storage และ Azurite ในเครื่อง dev |
| [`docs/bdi-admin-portal.postman_collection.json`](docs/bdi-admin-portal.postman_collection.json) | Postman collection ของ admin API (คำเชิญ, ผู้ใช้, เอกสารข้อตกลง, คำขอลงทะเบียน) พร้อม environment สามชุด |
| [`notebooks/journey-a-admin-create-user.ipynb`](notebooks/journey-a-admin-create-user.ipynb) | ยิง API ของ Journey A ทีละขั้นด้วยอีเมลจริง — ใช้แทนหน้าจอที่สเปกไม่ได้ให้ทำ |

**คู่มือสำหรับผู้ทดสอบระบบ** (ภาษาไทย พร้อมภาพหน้าจอจริง เขียนให้คนที่ไม่เคยใช้ระบบมาก่อน)

| เอกสาร | เนื้อหา |
| --- | --- |
| [`docs/12-tester-manual-overview.md`](docs/12-tester-manual-overview.md) | ภาพรวม · บัญชีทดสอบ · การเข้าสู่ระบบและ OTP · ปัญหาที่พบบ่อย — **อ่านเล่มนี้ก่อน** |
| [`docs/13-tester-manual-journey-a.md`](docs/13-tester-manual-journey-a.md) | ผู้ดูแลระบบสร้างหน่วยงานและเชิญผู้ใช้ (มีคำสั่ง `curl`) + การเปิดใช้งานบัญชีด้วย ThaID |
| [`docs/14-tester-manual-journey-b.md`](docs/14-tester-manual-journey-b.md) | หน่วยงานลงทะเบียนตัวเองจนได้รับอนุมัติ |
| [`docs/15-tester-manual-journey-c.md`](docs/15-tester-manual-journey-c.md) | ลงทะเบียนชุดข้อมูลจนได้รับอนุมัติ รวมเส้นทางส่งกลับแก้และไม่อนุมัติ |

ทั้งสี่เล่มมี **ฉบับ .docx จัดหน้าพร้อมส่ง** อยู่ที่ [`docs/manuals-docx/`](docs/manuals-docx/)
(A4 · ฟอนต์ Sarabun ฝังมาในไฟล์) ต้นฉบับยังเป็น Markdown — แก้ที่ `.md` แล้วสร้าง `.docx` ใหม่
ด้วย `docs/tools/manual-to-docx.py`

**คู่มือสำหรับผู้เขียนเอกสารต้นแบบ** —
[`docs/18-document-template-variables.md`](docs/18-document-template-variables.md) ตัวแปรที่
template A0–A4 ใช้ได้ วิธีพิมพ์ placeholder และวิธีอัปโหลดเวอร์ชันใหม่ ฉบับ A4 พร้อมส่งมอบอยู่ที่
[`docs/manuals-pdf/`](docs/manuals-pdf/)

## สิ่งที่ทำงานแล้ว

**Journey A — Admin เชิญผู้ใช้** (สเปกระบุว่าไม่มี UI มีแต่ API)
`POST /api/admin/invitations` (ต้องระบุเลขบัตรประชาชนของผู้ถูกเชิญ และหน่วยงานสำหรับ role
ระดับหน่วยงาน) → อีเมลคำเชิญ →
ยืนยันตัวตนด้วย **ThaID** แล้วเทียบเลขบัตรกับที่บันทึกไว้ → ตั้งรหัสผ่าน → บัญชี `ACTIVE`
เข้าสู่ระบบได้สองทาง: รหัสผ่าน + OTP ทางอีเมล หรือ ThaID
จัดการบัญชีหลังจากนั้นผ่าน `/api/admin/users` (ระงับ · ยุติ · ย้ายหน่วยงาน · ตัด session ฯลฯ)
หนึ่งคนมีได้หนึ่ง role และหนึ่งหน่วยงานมีผู้ประสานงานกับผู้มีอำนาจอนุมัติอย่างละหนึ่งคน

**Journey B — สร้างหน่วยงาน**
ฟอร์ม 3 ส่วน → บันทึกร่าง → สร้าง PDF จากข้อมูลที่กรอก → นำส่ง →
BDI Officer ตรวจ → ผู้มีอำนาจกระทำการแทนเห็นชอบ → BDI Approver ลงนาม → เปิดใช้งาน
ทุกการเปลี่ยนสถานะบันทึก timeline และส่งอีเมลแจ้งผู้เกี่ยวข้อง

**Journey C — ขอลงทะเบียนชุดข้อมูล**
ฟอร์ม 4 ส่วน (metadata · วิธีนำส่ง · เงื่อนไขทางกฎหมาย · เอกสารแนบ) → บันทึกร่าง → สร้าง PDF →
นำส่ง → BDI Officer ตรวจสอบ (ขอความเห็นผู้เชี่ยวชาญได้ — เป็นความเห็นประกอบ ไม่ใช่ด่านอนุมัติ) →
ผู้มีอำนาจของหน่วยงานลงนาม →
BDI Approver อนุมัติ/ไม่อนุมัติ → ได้เอกสาร A4 ฉบับอนุมัติ
คำขอที่นำส่งแล้วยกเลิกได้ (สถานะ `CANCELLED`) แทนการลบ
มีทั้งการแจ้งเตือนในระบบ (กระดิ่งบน header) และ audit log ที่เก็บ diff ของข้อมูลกับ IP
อีเมลทุกฉบับออกผ่านตาราง outbox ที่ `delivery-worker` หยิบไปส่ง ไม่ได้ส่งใน request
audit log มีสำเนาที่ค้นได้ใน MongoDB คู่กับ error ของระบบ (แบบ Sentry) อ่านผ่าน API ที่บันทึกทุกการอ่าน —
ไม่มีหน้าจอ ดู [`docs/21-activity-log.md`](docs/21-activity-log.md)

## Stack

| Service           | Stack                                                  | Port (main) |
| ----------------- | ------------------------------------------------------ | ----------- |
| `postgres`        | Postgres 16                                            | 5432        |
| `mongo`           | MongoDB 7.0 — log store: สำเนา audit log กับ error ของระบบ | ภายในเท่านั้น |
| `azurite`         | Azure Blob Storage (emulator ตอน dev)                  | 9000        |
| `gotenberg`       | LibreOffice แปลง `.docx` → PDF                         | ภายในเท่านั้น |
| `backend`         | Node.js · Express · TypeScript · Prisma · docxtemplater | 4000        |
| `delivery-worker` | ตัวเดียวกับ backend — ส่งอีเมลจาก outbox คัดลอก audit log ไป MongoDB และส่งอีเมลสรุป error | —           |
| `frontend`        | Next.js 16 · React 19 · TypeScript · Tailwind 4        | 3000        |

พอร์ตในตารางเป็นของ checkout `main` ซึ่งเปิดสู่สาธารณะ checkout อื่นได้ช่วงพอร์ตของตัวเอง —
ดู [Working alongside other developers](#working-alongside-other-developers)

ธีมและฟอนต์มาจาก `assets/theme_ci_design/` โดยตรง — ค่าสีสกัดจากไฟล์ `.ai` ด้วยการ render
แล้ว sample พิกเซล ไม่ได้กะด้วยตา (navy `#192768`, coral `#E5775A`)

## Getting started

```bash
cp .env.example .env       # adjust credentials if you like
docker compose up --build

# first run, and after any `migrate reset`
docker compose exec backend npm run seed:masters   # dataset choices, roles, BDI org, legal docs, addresses
docker compose exec backend npm run seed:demo      # optional: wipes data, rebuilds demo fixtures
```

Restart the backend after seeding — it caches the dataset choices at boot. See
[`docs/03-demo-walkthrough.md`](docs/03-demo-walkthrough.md) for the demo accounts.

Then:

- Frontend — <http://localhost:3000> (renders live service health)
- Backend — <http://localhost:4000>
- Readiness probe — <http://localhost:4000/health/ready>
- Object storage — Azurite blob endpoint at <http://localhost:9000/devstoreaccount1>.
  There is no web console; browse it with Azure Storage Explorer or the `az storage blob`
  CLI, pointing either at `AZURE_STORAGE_CONNECTION_STRING` from `.env` or at the emulator
  shortcut `--connection-string UseDevelopmentStorage=true`.

Source is bind-mounted, so both the backend (`tsx watch`) and the frontend
(`next dev`) hot-reload on save.

## Working alongside other developers

On the shared box the repository is checked out once per task — one task, one branch, one
checkout, all named after the card on the Notion Task Board:

```
/hdd1tb/bdi-project/
├── main/                          # the main branch — the one exposed publicly
├── dev/
│   └── dev_<YYYYMMDD>_<branch>/   # one clone per task, on its own branch
└── new-dev.sh                     # creates a dev checkout
```

Every checkout is an independent clone with its own `.env`. Two settings must
differ between them or the stacks will fight over Docker names and host ports:

- `COMPOSE_PROJECT_NAME` — namespaces containers, networks and volumes.
- the `*_PORT` values — `main` keeps 3000 / 4000; port slot `NN` gets
  `31N0 / 41N0 / 55N0 / 91N0` (frontend / backend / Postgres / Azurite).

`new-dev.sh` handles both, and writes a `docker-compose.override.yml` for the ports. Run it
from the layout root with a free two-digit port slot and the branch name:

```bash
./new-dev.sh 04 setup-database-from-bdi-schema
# -> dev/dev_<today>_setup-database-from-bdi-schema, on branch setup-database-from-bdi-schema
git -C dev/dev_<today>_setup-database-from-bdi-schema push -u origin setup-database-from-bdi-schema
```

Stacks are fully isolated, so `docker compose up` in your own checkout never
touches anyone else's database or bucket. Once the branch is merged, remove the checkout
with `docker compose down -v --rmi local` before deleting the directory, and never rename
one — the compose project name is derived from it.

## Layout

```
.
├── docker-compose.yml
├── docker-compose.prod.yml     # production overrides (runner images)
├── .env.example
├── backend/
│   ├── Dockerfile              # deps → dev → build → runner
│   ├── prisma/schema.prisma
│   └── src/
│       ├── index.ts            # express app + graceful shutdown
│       ├── env.ts              # env parsing, fails fast on boot
│       ├── db.ts               # PrismaClient + pingDatabase()
│       ├── storage.ts          # Azure Blob client + ensureContainer()/pingStorage()
│       ├── routes/             # organizations (B), dataset-requests (C), auth, admin*, health …
│       ├── lib/                # workflow, journey steps, mail, audit, document rendering …
│       ├── workers/            # delivery (outbox email)
│       └── scripts/            # seed-masters, seed-demo, backfills
├── frontend/
│   ├── Dockerfile              # deps → dev → build → runner (standalone)
│   ├── app/                    # App Router
│   ├── components/
│   └── lib/
├── gotenberg/                  # .docx → PDF converter image
├── docs/                       # specs, tester manuals, Postman collection
└── notebooks/                  # Journey A walked one API call at a time
```

## Health endpoints

- `GET /health/live` — liveness, touches no dependencies.
- `GET /health/ready` — checks Postgres (`SELECT 1`) and Azure Blob Storage (container exists).
  Returns `200` when both are up, `503` otherwise, with one word per check. It also reports
  `datasetChoices` (`defaults` = `seed:masters` has not run) and `logStore` (`up` · `down` ·
  `disabled` · `over_quota`), which never decide the status: a MongoDB outage must not take the
  site out of rotation.

## เชิญผู้ใช้คนแรก

ยังไม่มี UI สำหรับ admin ตามสเปก ให้ยิง API ตรง ๆ (ค่า token อยู่ใน `.env`) หรือใช้
Postman collection ใน `docs/`:

```bash
source .env
curl -X POST "http://localhost:${BACKEND_PORT}/api/admin/invitations" \
  -H "x-admin-token: $ADMIN_API_TOKEN" -H 'Content-Type: application/json' \
  -d '{"email":"officer@bdi.or.th","role":"BDI_OFFICER","cid":"<เลขบัตรประชาชน 13 หลัก>"}'
```

`cid` บังคับทุก role — ระบบเทียบกับเลขบัตรที่ ThaID ส่งกลับมาตอนเปิดใช้งาน
`prefixTh` / `firstnameTh` / `lastnameTh` ส่งได้ถ้ามี (ใช้ prefill ฟอร์มเปิดใช้งาน)

`role` เลือกได้: `BDI_OFFICER` · `BDI_FINAL_APPROVER` · `BDI_DATASET_SPECIALIST` ·
`BDI_LEGAL_OFFICER` · `SYSTEM_ADMINISTRATOR` · `ORGANIZATION_USER` · `ORGANIZATION_APPROVER`

role ระดับหน่วยงาน (`ORGANIZATION_*`) ต้องส่ง `organizationId` ด้วย — ถ้ายังไม่มีหน่วยงาน
สร้างก่อนด้วย `POST /api/admin/organizations` (บังคับแค่ `organizationCode` กับ `nameTh`)
ผู้มีอำนาจอนุมัติเชิญได้เฉพาะหน่วยงานที่เปิดใช้งานแล้ว และถ้าที่นั่งของ role นั้นมีคนอยู่ ระบบตอบ `409`

ถ้ายังไม่ได้ตั้ง `SMTP_USER` ระบบจะ**ไม่ส่งอีเมลจริง** แต่พิมพ์ลิงก์คำเชิญและรหัส OTP
ลง log ของ `delivery-worker` ให้แทน ทดสอบได้ครบโดยไม่ต้องมีเมล:

```bash
docker compose logs -f backend delivery-worker | grep 'mail:dry-run'
```

เมื่อจะส่งจริงผ่าน Gmail ให้ตั้ง `SMTP_USER` / `SMTP_PASS` (ต้องเป็น App Password —
ดูขั้นตอนใน `.env.example`)

## Database

Schema อยู่ที่ `backend/prisma/schema.prisma` แก้แล้วรัน:

```bash
docker compose exec backend npm run prisma:migrate -- --name <ชื่อ>
```

บน production ใช้ `npm run prisma:deploy` แทน ดูข้อมูลด้วย
`docker compose exec backend npm run prisma:studio`

> ติดตั้ง dependency ต้องทำ**ในคอนเทนเนอร์** เพราะ `node_modules` เป็น named volume
> ที่ docker สร้างเป็น root: `docker compose exec backend npm install <pkg>`

## Object storage

Attachments live in **Azure Blob Storage**. `src/storage.ts` wraps the SDK and is the only
file that imports it — everything else goes through `putObject()` / `getObjectStream()` /
`getObjectBuffer()` and the `CONTAINER` constant. The backend calls `ensureContainer()` at
boot, so there is no init service to run first (S3's *bucket* and *object* are Azure's
**container** and **blob**; the `storage_bucket` / `storage_key` columns keep their Excel
names and now hold the container and blob names).

Locally, Compose runs **Azurite**, Microsoft's own Azure Storage emulator, and points the
backend at it — no Azure subscription needed. To use a real storage account, set
`AZURE_STORAGE_ACCOUNT_URL` (managed identity via `DefaultAzureCredential`, the right choice
in production) or `AZURE_STORAGE_CONNECTION_STRING` in `.env`; see the comments there.

## Common commands

```bash
docker compose up --build          # start everything
docker compose logs -f backend     # tail one service
docker compose exec backend sh     # shell into the backend
docker compose down                # stop
docker compose down -v             # stop and wipe volumes (DB + blob container)
```

Running a service directly on the host works too — `cd backend && npm install &&
npm run dev` — as long as `DATABASE_URL` and `AZURE_STORAGE_CONNECTION_STRING` point at
`localhost` rather than the Compose hostnames.

## Production images

Both Dockerfiles carry a `runner` target that builds a slim, non-root image.
`docker-compose.prod.yml` switches every service to it — this is what `main` runs:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
docker compose exec backend npm run seed:masters:prod
docker compose exec backend npm run seed:demo:prod     # plain seed:demo needs tsx, a devDependency
```

`ACTIVATION_KEY_SECRET` must be set in `.env` first — the backend refuses to boot in
production without it.
