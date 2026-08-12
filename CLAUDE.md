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
- `docs/03-demo-walkthrough.md` — how to run any journey end to end, seed data, public deploy;
  its §10 is the script for demoing live, and the only part written for an audience
- `notebooks/journey-a-admin-create-user.ipynb` — Journey A has no UI by design, so this walks
  its API calls one cell at a time against a checkout with real SMTP configured
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
docker compose exec backend npm run seed:masters       # roles, BDI org, legal docs, addresses
docker compose exec backend npm run seed:demo          # wipes data, rebuilds demo fixtures
docker compose logs -f delivery-worker                 # outbox email sender
```

`seed:masters` must run before `seed:demo` and after any `migrate reset` — the demo seed fails
fast if `iam.role` is empty. Both are idempotent.

Production build (also what a public deployment must use):

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
docker compose exec backend npm run seed:masters:prod  # must run first
docker compose exec backend npm run seed:demo:prod     # seed:demo needs tsx, a devDependency
```

`ACTIVATION_KEY_SECRET` must be set in `.env` before starting production — the backend throws
at boot without it rather than falling back to the development value.

The baseline migration replaced the two that came before it, so a database still carrying the
old `_prisma_migrations` rows cannot be brought forward: `migrate deploy` refuses when recorded
migrations are missing from disk. On a disposable deployment the fix is `down -v` then `up`,
which is what main was given. Anywhere the data mattered this would need a written backfill —
see `docs/06-db-migration-plan.md` §7.

The production image installs production dependencies only, so `tsx` is not there and
`npm run seed:demo` fails with `tsx: not found`. `seed:demo:prod` runs the compiled
`dist/scripts/seed-demo.js` instead — same script, same result. `main` runs in production
mode, so that is the variant to use there.

There is **no test framework and no ESLint config** in this repo. Verification so far has been
typecheck + production build + driving the real API. If you add tests, wire them into
`backend/package.json` / `frontend/package.json` and mention it here.

## Architecture

### The schema follows the Excel design, not the markdown docs

`assets/db_schema/draft_db_design_downloaded_on_2026-08-11.xlsx` is the authority for the data
model — 20 tables across 10 Postgres schemas (`iam`, `organization`, `dataset`, `review`,
`legal`, `signature`, `attachment`, `notification`, `integration`, `audit`) plus an
`administration` schema for the address masters. Where it contradicts `docs/01-user-journey.md`,
**the Excel wins**; every deliberate deviation carries a `เบี่ยงจากดีไซน์:` comment in
`schema.prisma`. `docs/06-db-migration-plan.md` records the gap analysis and the open questions.

Prisma's `multiSchema` is GA from 6.19, so there is no preview flag — just `@@schema(...)` on
every model and enum, and a `schemas` list in the datasource.

### Each workflow is one state machine in one file

`backend/src/routes/organizations.ts` holds the whole organization approval flow, and
`backend/src/routes/dataset-requests.ts` the whole dataset registration flow. In both,
`POST /:id/review` is a single endpoint for every approval stage. Keep it that way; splitting
it scatters the state machine.

**Who may act is decided by the active `review.review_task`, not by `status`.** `status` is
down to seven coarse values shared by both journeys (`DRAFT` · `SUBMITTED` · `UNDER_REVIEW` ·
`RETURNED` · `APPROVED` · `REJECTED` · `CANCELLED`); which gate the request sits at lives in
`review_task.task_type`. A partial unique index allows only one active task per request.

`lib/workflow.ts` owns that engine — opening/closing/reassigning tasks and enforcing the
allowed-`result`-per-`task_type` matrix from the Excel. `status` is always recomputed by
`deriveRequestStatus()` after a transition; never set it by hand.

The `OrganizationEvent` / `DatasetRequestEvent` tables are gone. The UI timeline is rendered
from `review_task` rows, so every transition must go through `lib/workflow.ts`.

Journey B: `BDI_OFFICER_REVIEW` → `ORGANIZATION_APPROVAL` → `BDI_FINAL_APPROVAL`.
Journey C: the same plus an optional `DATASET_SPECIALIST_REVIEW`, and a second
`BDI_OFFICER_REVIEW` round for the re-check after the organisation signs. "Initial review" and
"re-check" share one `task_type`; they are told apart by whether an `ORGANIZATION_APPROVAL` has
already completed, not by `round_number` (rounds also increment on every return).

### Audit log, notifications and the outbox

`audit.audit_event` replaces `ActivityLog`. It is never shown on screen. `correlation_id` and
`source_component` are NOT NULL, so `lib/context.ts` puts a request-scoped correlation id in an
`AsyncLocalStorage` — don't thread it through function arguments. The Excel dropped the
`actor_name` / `actor_roles` columns, so `lib/audit.ts` snapshots them into `metadata_json`
instead; without that, old log rows change meaning when a user is renamed.

**Email is no longer sent from request handlers.** `notifyUsers()` writes a `notification` row
plus a `notification_delivery` row (the outbox), and `src/workers/delivery.ts` sends it — a
separate `delivery-worker` compose service, claiming rows with `FOR UPDATE SKIP LOCKED`, with
retry/backoff and `DEAD_LETTER`. The delivery table has no body column on purpose: the worker
rebuilds the email from `subject_type`/`subject_id` at send time (`src/workers/render.ts`), so
no token or credential is ever stored in plain text. Activation-key emails are the exception —
they are sent inline because the raw key only exists in memory at that moment.

Notifications need not be real time, so the bell fetches on page load and on navigation — there
is no polling loop, no websocket. Don't add one without a requirement.

### Auth

Invite-only. There is no self-signup and no admin UI — the spec says so explicitly.
`POST /api/admin/invitations` is guarded by a shared secret (`x-admin-token`), not a session,
because the caller is an operator script.

**The session cookie identifies the user and nothing else.** `requireAuth` re-reads roles and
organisation from the database on every request and overwrites whatever the JWT carried,
because both change while a session is still valid. Roles now come from a join on
`iam.user_role_assignment` filtered by `status = 'ACTIVE' AND (effective_until IS NULL OR
effective_until > now())` — the source moved, the rule did not. Don't reintroduce reads of
`session.roles` / `session.organizationId` that bypass this, and don't "optimise" it away.

Roles are rows in `iam.role`, not an enum. Two codes changed from the old model:
`BDI_APPROVER` → `BDI_FINAL_APPROVER` and `BDI_SPECIALIST` → `BDI_DATASET_SPECIALIST`; two are
new (`BDI_LEGAL_OFFICER`, `SYSTEM_ADMINISTRATOR`). A partial unique index enforces the Excel's
rule that one organisation has at most one active `ORGANIZATION_USER` and one active
`ORGANIZATION_APPROVER` — this contradicts `docs/01-user-journey.md` §1, and the Excel wins.

`Invitation` is replaced by `iam.activation_key`, following the lifecycle in that sheet: create
the `user_account` as `PENDING` first, then issue a key for (account, organisation, role).
The key is hashed with **HMAC-SHA-256** (`ACTIVATION_KEY_SECRET`), not bare SHA-256, so a
database leak alone cannot produce a usable key. `organization_id` is NOT NULL there, which is
why BDI itself is a row in `organization.organization` (`lib/system.ts`).

Registration is still two steps: `/register` fills in the profile, `/verify-otp` flips the
account to `ACTIVE`, creates the role assignment and marks the key `USED` — all in one
transaction. **`password_hash` and `iam.otp_code` are deliberate additions not present in the
Excel**, kept because ThaID has no client credentials yet and §A.2 requires 2FA; both come out
when ThaID lands. `cid` and `external_subject` are nullable for the same reason.

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

The schema stores `province_code` / `district_code` / `sub_district_code`, but that file has
only names, and the Excel has no sheet for the address masters. `seed:masters` therefore
populates `administration.province/district/sub_district` from it and **generates the codes**
(2/4/6 digits, TIS-1099 shaped) from the file order. These are not real government codes —
replacing them is a data swap, not a schema change. `lib/address.ts` converts names↔codes so
the form contract stayed the same.

### Attachments

One polymorphic `attachment.attachment` table replaces the two per-domain tables, keyed by
`owner_type` + `owner_id` (a logical reference, not an FK). Storage keys follow the Excel's
convention — `{env}/{owner_type}/{owner_id}/{attachment_type}/{attachment_id}/document.{ext}`.

**Uploading a replacement no longer deletes the old object.** The previous row becomes
`REPLACED` and the new one points back via `replaced_attachment_id`, so history is auditable.
A partial unique index allows one `ACTIVE` attachment per slot. `content_hash` (SHA-256) is
computed on upload. There is no virus scanner yet, so `scan_status` is set straight to `CLEAN`
— that is a marked TODO in `lib/attachment.ts`, not an oversight.

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
- Every service that has its own `build:` block gets its own image, even when the Dockerfile is
  shared. `delivery-worker` builds `bdi-<project>-delivery-worker`, not the backend image, so
  `up -d delivery-worker` without `--build` will happily start a stale image built from a
  different target — the symptom is `Cannot find module /app/dist/...` for a file that is
  demonstrably in the backend image.
- A new service added to `docker-compose.yml` is not in `docker-compose.prod.yml` until it is
  put there. Until then it runs its development command on a production deployment.
- Zod v4: `z.nativeEnum(X, { error: "..." })`. `errorMap` no longer exists.
- Where `APP_URL` is https (that is `main`), the session cookie is issued `Secure`, so a script
  that logs in over `http://localhost:4000` gets a 200 and then 401 on every later call — the
  browser or client never sends the cookie back. Drive that deployment through
  `https://bdi-api.thammasorn.org` instead. `curl /health/ready` on localhost is still fine;
  it needs no session.
- Route params beat query strings for anything the first client render needs.
  `useSearchParams()` is empty on that render; a page that redirected when its `?id=` was
  missing bounced users away before hydration finished.


## Notion

Work is tracked in Notion, not in this repo's issues.

- Project page: **Government Datahub Platform**
  https://app.notion.com/p/3aeee3954ee8800d9468cbb1982655e3
- Task database on that page: **Task Board**
  https://app.notion.com/p/3b9ee3954ee880b2a324ffad3a38e1ae

The spec pages (user journeys, Authentication & User Account, Database Design, Admin Portal)
hang off the project page. `docs/` is the expanded, buildable version of those — when the two
disagree, ask; don't silently follow one.

Each Task Board card is one unit of work. Post progress, open questions and remaining items
back onto the card as you go, so the board is readable without opening the repo.

## Starting a task

One task, one branch, one checkout. Both the branch and the directory are named after the
Task Board card, so `git branch` and `ls dev/` answer the same question.

```bash
./new-dev.sh 04 setup-database-from-bdi-schema
#            ^^ port slot, still two digits — see the machine notes
```

That creates `dev/dev_<YYYYMMDD>_<branch>/`, checks out the branch, and writes the port
overrides. Then publish the branch immediately, before writing any code:

```bash
git push -u origin setup-database-from-bdi-schema
```

Pushing first is the point: it means the work is recoverable from the moment it starts, and
other people can see the task is being worked on rather than discovering it at merge time.

**Branch name** — the card title in kebab-case. "Setup Database from BDI Schema" becomes
`setup-database-from-bdi-schema`. No prefixes; the card title already says what it is.

**Directory** — `dev/dev_<YYYYMMDD>_<branchname>`, where the date is the day the checkout was
made. Two checkouts of the same branch on different days are a normal thing to want; the date
keeps them apart, and it makes stale checkouts obvious in `ls dev/`.

Checkouts made before this convention (`dev/dev_01`, `dev_02`, `dev_03`) keep their names.
Don't rename them — the compose project name is derived from the directory, so renaming
orphans the containers and volumes.

## Commits

Subject lines are plain statements of what changed, in the imperative, with no `feat:` /
`fix:` prefixes — read `git log` before writing one. The body explains **why**: what was
observed, what the cause turned out to be, what was decided and what was rejected. A commit
that only restates its diff in prose is not worth the body.

Cutovers that break the build halfway (a schema replacement, say) are still split into
reviewable commits, but say so in the message — someone will try to bisect it eventually.