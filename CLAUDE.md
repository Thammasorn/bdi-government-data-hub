# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Government Datahub Platform for BDI (สถาบันข้อมูลขนาดใหญ่). Government agencies register
themselves, and their registration is approved through a multi-stage workflow.

The spec lives in Notion, not here. `docs/` holds the expanded, buildable version:

- `docs/01-user-journey.md` — roles, both state machines, every step of the three journeys,
  the fifteen emails the system sends, and **open questions still awaiting an answer**
  (marked `[สมมติฐาน]` where the Notion spec was silent or contradictory)
- `docs/02-ui-spec.md` — design tokens measured from the CI artwork, screen inventory
- `docs/03-demo-walkthrough.md` — how to run any journey end to end, seed data, public deploy
- `docs/04-dataset-registration-plan.md` — how Journey C maps onto schema, endpoints and screens

Read `docs/01-user-journey.md` before touching anything in `backend/src/routes/organizations.ts`
or `backend/src/routes/dataset-requests.ts`.

## Commands

**Everything runs inside the containers.** `node_modules` is a named volume that shadows
whatever the image baked in, so host-side `npm install` writes to a root-owned stub directory
and fails.

```bash
docker compose up -d --build              # start (dev mode, hot reload both sides)
docker compose logs -f backend

docker compose exec backend npm run typecheck
docker compose exec frontend npx tsc --noEmit

docker compose exec backend npm install <pkg>          # NOT on the host
docker compose exec backend npm run prisma:migrate -- --name <name>
docker compose exec backend npm run prisma:studio
docker compose exec backend npm run seed:demo          # wipes data, rebuilds demo fixtures
```

Production build (also what a public deployment must use):

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

There is **no test framework and no ESLint config** in this repo. Verification so far has been
typecheck + production build + driving the real API. If you add tests, wire them into
`backend/package.json` / `frontend/package.json` and mention it here.

## Architecture

### Each workflow is one state machine in one file

`backend/src/routes/organizations.ts` holds the whole organization approval flow, and
`backend/src/routes/dataset-requests.ts` the whole dataset registration flow. In both,
`POST /:id/review` is a single endpoint for every approval stage — who may act is decided by
the record's *current status*, not by separate routes. Keep it that way; splitting it scatters
the state machine. In the dataset router that decision table lives in one `decide()` function.

Every transition writes an `OrganizationEvent` / `DatasetRequestEvent` (actor, from-status,
to-status, note). The UI timeline is rendered from those tables, so never mutate `status`
without recording the event.

### Audit log and in-app notifications (dataset flow)

`ActivityLog` is deliberately **separate** from the event tables: it stores the changed fields
(before/after) and the caller's IP, and is never shown on screen. `lib/activity.ts` copies the
actor's name and roles into each row rather than only referencing the user, so old rows stay
truthful after a rename.

Notifications are written next to every dataset email in `lib/notify.ts`. The spec says they
need not be real time, so the bell fetches on page load and on navigation — there is no polling
loop, no websocket. Don't add one without a requirement.

### Auth

Invite-only. There is no self-signup and no admin UI — the spec says so explicitly.
`POST /api/admin/invitations` is guarded by a shared secret (`x-admin-token`), not a session,
because the caller is an operator script.

Registration is two steps: `/register` creates the user as `INVITED`, then `/verify-otp`
flips it to `ACTIVE` and issues the session. Invitation tokens are stored **hashed**
(SHA-256, not bcrypt — they need to be looked up by value, and they are 32 random bytes,
not a human-chosen password).

`POST /api/auth/thaid/verify` is a stand-in for ThaiD, which has no client credentials yet.
It is gated on `THAID_MOCK` and returns 501 when off. It must be `false` anywhere real.

### Email

`backend/src/lib/mail.ts`. With `SMTP_USER` unset the mailer prints the body, the invite link
and the OTP to stdout instead of sending — that is the normal way to exercise the flows.
Templates are table-based with inline styles because Gmail and Outlook strip `<style>`.

### PDF

`backend/src/lib/pdf.ts` uses PDFKit with Sarabun/Prompt TTFs copied into
`backend/src/assets/fonts/`. Thai will not render without embedding a Thai face. `npm run build`
copies `src/data` and `src/assets` into `dist/` because `tsc` does not.

The page footer is drawn at `y=800`, below the bottom margin. PDFKit treats that as overflow
and appends a blank page per page unless the bottom margin is zeroed for that one write —
`footer()` does exactly that. Don't "simplify" it away.

### Thai addresses

`backend/src/data/thai-address.json` (77 provinces / 927 amphoes / 7,423 tambons) is vendored
deliberately. The obvious npm package lists `mocha` in its runtime dependencies, which pulls a
vulnerable `serialize-javascript` into production. Do not reintroduce it.

### Frontend

Design tokens in `frontend/app/globals.css` under Tailwind 4's `@theme`. The colors were
sampled from the `.ai` files in `assets/theme_ci_design/`, not chosen by eye —
navy `#192768`, coral `#E5775A`. The same values are duplicated as constants in
`mail.ts` and `pdf.ts` (email clients have no CSS, PDFKit has no CSS); change all three together.

Fonts are self-hosted via `next/font/local` from `frontend/public/fonts/` — no Google Fonts,
so it works behind a firewall.

Two API base URLs, and they are not interchangeable:

- `NEXT_PUBLIC_API_URL` — what the **browser** calls. Inlined into the client bundle at build
  time, so changing it requires `--build`, never just a restart.
- `INTERNAL_API_URL` — what Next's server side calls, over the compose network.

## Conventions

- All user-facing copy is Thai. Body line-height is 1.7 — Thai tone marks need the room.
- Validation errors come back as `{ error: "validation", fields: { <name>: <message> } }` so the
  frontend can bind each message to its input. Messages say how to fix the problem, not just
  that something is wrong.
- Status is never communicated by color alone; badges always carry text.

## Traps that have already cost time

- `optional()` in `backend/src/env.ts` treats an empty string as unset. Compose emits `FOO=`
  for every `${FOO:-}`, and `??` would let that empty value override the default.
- The frontend `build` stage sets `NODE_ENV=production`. Without it, prerendering
  `/_global-error` dies with `Cannot read properties of null (reading 'useContext')`.
- In `docker-compose.prod.yml`, clearing mounts needs `volumes: !reset []`. A plain `volumes: []`
  is appended, not substituted, and the source bind mount keeps shadowing `dist/`.
- Zod v4: `z.nativeEnum(X, { error: "..." })`. `errorMap` no longer exists.
- Route params beat query strings for anything the first client render needs.
  `useSearchParams()` is empty on that render; a page that redirected when its `?id=` was
  missing bounced users away before hydration finished.
