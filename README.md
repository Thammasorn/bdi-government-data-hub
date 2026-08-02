# Government Datahub Platform

แพลตฟอร์มรวบรวมข้อมูลจากหน่วยงานรัฐ ของสถาบันข้อมูลขนาดใหญ่ (องค์การมหาชน)

สเปกต้นทางอยู่ใน Notion — ที่ขยายเป็นเอกสารพร้อมพัฒนาแล้วอยู่ใน `docs/`:

| เอกสาร | เนื้อหา |
| --- | --- |
| [`docs/01-user-journey.md`](docs/01-user-journey.md) | roles, state machine, ทุกขั้นตอนของสองเส้นทาง, อีเมลที่ระบบส่ง, คำถามที่ยังค้าง |
| [`docs/02-ui-spec.md`](docs/02-ui-spec.md) | design tokens จาก CI จริง, รายการหน้าจอ, รายละเอียดหน้าสำคัญ |
| [`docs/03-demo-walkthrough.md`](docs/03-demo-walkthrough.md) | **วิธีเดินระบบทีละขั้น** — เตรียมข้อมูล, บัญชีทดสอบ, สาธิตทั้งสอง flow, แก้ปัญหาที่เจอบ่อย |

## สิ่งที่ทำงานแล้ว

**Journey A — Admin เชิญผู้ใช้** (สเปกระบุว่าไม่มี UI มีแต่ API)
`POST /api/admin/invitations` → อีเมลคำเชิญ → ตั้งรหัสผ่าน → ยืนยันตัวตนด้วย OTP ทางอีเมล
(ThaiD เตรียมที่ไว้ใน UI แล้วแต่ยังไม่มี credentials)

**Journey B — สร้างหน่วยงาน**
ฟอร์ม 3 ส่วน → บันทึกร่าง → สร้าง PDF จากข้อมูลที่กรอก → นำส่ง →
BDI Officer ตรวจ → ผู้มีอำนาจกระทำการแทนเห็นชอบ → BDI Approver ลงนาม → เปิดใช้งาน
ทุกการเปลี่ยนสถานะบันทึก timeline และส่งอีเมลแจ้งผู้เกี่ยวข้อง

## Stack

| Service    | Stack                          | Port(s)      |
| ---------- | ------------------------------ | ------------ |
| `postgres` | Postgres 16                    | 5432         |
| `minio`    | MinIO object storage           | 9000 / 9001  |
| `backend`  | Node.js · Express · TypeScript · Prisma · PDFKit | 4000 |
| `frontend` | Next.js 16 · React 19 · TypeScript · Tailwind 4 | 3000 |

ธีมและฟอนต์มาจาก `assets/theme_ci_design/` โดยตรง — ค่าสีสกัดจากไฟล์ `.ai` ด้วยการ render
แล้ว sample พิกเซล ไม่ได้กะด้วยตา (navy `#192768`, coral `#E5775A`)

## Getting started

```bash
cp .env.example .env       # adjust credentials if you like
docker compose up --build
```

Then:

- Frontend — <http://localhost:3000> (renders live service health)
- Backend — <http://localhost:4000>
- Readiness probe — <http://localhost:4000/health/ready>
- MinIO console — <http://localhost:9001> (`minioadmin` / `minioadmin`)

Source is bind-mounted, so both the backend (`tsx watch`) and the frontend
(`next dev`) hot-reload on save.

## Working alongside other developers

On the shared box the repository is checked out once per person:

```
/hdd1tb/bdi-project/
├── main/            # the main branch, kept clean
├── dev/
│   ├── dev_01/      # one clone per developer, on their own branch
│   └── dev_02/
└── new-dev.sh       # creates the next dev clone
```

Every checkout is an independent clone with its own `.env`. Two settings must
differ between them or the stacks will fight over Docker names and host ports:

- `COMPOSE_PROJECT_NAME` — namespaces containers, networks and volumes.
- the five `*_PORT` values — see the convention in `.env.example`.

`new-dev.sh` handles both. Run it from the layout root:

```bash
/hdd1tb/bdi-project/new-dev.sh 02          # clones dev/dev_02, branch dev_02
```

Stacks are fully isolated, so `docker compose up` in your own checkout never
touches anyone else's database or bucket.

## Layout

```
.
├── docker-compose.yml
├── .env.example
├── backend/
│   ├── Dockerfile              # deps → dev → build → runner
│   ├── prisma/schema.prisma
│   └── src/
│       ├── index.ts            # express app + graceful shutdown
│       ├── env.ts              # env parsing, fails fast on boot
│       ├── db.ts               # PrismaClient + pingDatabase()
│       ├── storage.ts          # MinIO client + ensureBucket()/pingStorage()
│       └── routes/health.ts    # /health/live, /health/ready
└── frontend/
    ├── Dockerfile              # deps → dev → build → runner (standalone)
    └── app/                    # App Router
```

## Health endpoints

- `GET /health/live` — liveness, touches no dependencies.
- `GET /health/ready` — checks Postgres (`SELECT 1`) and MinIO (bucket exists).
  Returns `200` when both are up, `503` otherwise, with per-check detail.

## เชิญผู้ใช้คนแรก

ยังไม่มี UI สำหรับ admin ตามสเปก ให้ยิง API ตรง ๆ (ค่า token อยู่ใน `.env`):

```bash
source .env
curl -X POST "http://localhost:${BACKEND_PORT}/api/admin/invitations" \
  -H "x-admin-token: $ADMIN_API_TOKEN" -H 'Content-Type: application/json' \
  -d '{"email":"officer@bdi.or.th","role":"BDI_OFFICER"}'
```

`role` เลือกได้: `BDI_OFFICER` · `BDI_APPROVER` · `BDI_SPECIALIST` ·
`ORGANIZATION_USER` · `ORGANIZATION_APPROVER`

ถ้ายังไม่ได้ตั้ง `SMTP_USER` ระบบจะ**ไม่ส่งอีเมลจริง** แต่พิมพ์ลิงก์คำเชิญและรหัส OTP
ลง log ให้แทน ทดสอบได้ครบโดยไม่ต้องมีเมล:

```bash
docker compose logs -f backend | grep 'mail:dry-run'
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

The `minio-init` one-shot service creates the `$MINIO_BUCKET` bucket on startup;
the backend also calls `ensureBucket()` at boot so it works outside Compose.
Use the exported `minio` client and `BUCKET` from `src/storage.ts`.

## Common commands

```bash
docker compose up --build          # start everything
docker compose logs -f backend     # tail one service
docker compose exec backend sh     # shell into the backend
docker compose down                # stop
docker compose down -v             # stop and wipe volumes (DB + buckets)
```

Running a service directly on the host works too — `cd backend && npm install &&
npm run dev` — as long as `DATABASE_URL` and the `MINIO_*` vars point at
`localhost` rather than the Compose hostnames.

## Production images

Both Dockerfiles carry a `runner` target that builds a slim, non-root image.
Build with `docker build --target runner ./backend`.
