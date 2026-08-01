# BDI Project

A Docker Compose stack with four services:

| Service    | Stack                          | Port(s)      |
| ---------- | ------------------------------ | ------------ |
| `postgres` | Postgres 16                    | 5432         |
| `minio`    | MinIO object storage           | 9000 / 9001  |
| `backend`  | Node.js · Express · TypeScript · Prisma | 4000 |
| `frontend` | Next.js 15 · React 19 · TypeScript | 3000     |

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

## Database

`prisma/schema.prisma` has no models yet. Add one, then:

```bash
docker compose exec backend npm run prisma:migrate -- --name init
```

In production use `npm run prisma:deploy` instead. To browse data:
`docker compose exec backend npm run prisma:studio`.

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
