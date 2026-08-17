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
- `docs/07-thaid-integration.md` — the ThaiD flow, its configuration, what DOPA has not
  granted us yet, and the SIT run that exercised it against their sandbox
- `docs/08-database-access.md` — connecting DBeaver (or psql) to a checkout's database:
  which port belongs to which checkout, the schema layout, and what not to edit by hand
- `docs/09-auth-tokens.md` — every token in the system (session id, activation key, OTP,
  admin token, ThaiD's tokens, OAuth `state`, OIDC `nonce`): where each lives, how it is
  hashed, when it expires. **There is no refresh token and no need for one**; §1.4 explains
  the session table that replaced the old JWT
- `docs/10-admin-prefill-organization.md` — organizations an admin creates ahead of time,
  and how their data reaches the user's registration form
- `docs/11-metadata-registration-form.md` — the dataset metadata form: which sheet of
  `metadata_mapping.xlsx` decides what, every field and its code list, the conditions table
  (what forces or hides what), and the open questions left in it
- `docs/bdi-admin-portal.postman_collection.json` — Journey A as a runnable collection,
  with three `*.postman_environment.json` files beside it (dev checkout / main / public).
  The admin token is left empty in the last two on purpose — it is a real secret from `.env`

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
model, **except for `dataset_registration_metadata` and `dataset_metadata`, which follow the
2026-08-16 download** of the same workbook — those two tables were re-cut to match the metadata
registration form (`docs/11-metadata-registration-form.md`). Everything else is unchanged
between the two files. Together: 20 tables across 10 Postgres schemas (`iam`, `organization`, `dataset`, `review`,
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
organisation from the database on every request, because both change while a session is still
valid. Roles come from a join on `iam.user_role_assignment` filtered by `status = 'ACTIVE' AND
(effective_until IS NULL OR effective_until > now())`. Don't put roles or organisation back into
the cookie, and don't "optimise" this read away.

**The cookie holds an opaque random value, not a JWT.** It points at a row in `iam.session`,
which is what makes revocation possible at all; there is no `JWT_SECRET` any more
(`jsonwebtoken` stays, for ThaiD's `id_token`). `lib/session.ts` owns the lifecycle. Two
expiries, both enforced: absolute (`SESSION_TTL_DAYS`, 7 days, not renewable) and idle
(`SESSION_IDLE_HOURS`, 8 hours, `last_seen_at` moves — written at most once a minute, not per
request). `issueSession()` revokes whatever session the caller arrived with, so logging in
always rotates the value. Every revocation writes an `audit_event` whose
`metadata_json.reason` says which of LOGOUT · LOGOUT_ALL · PASSWORD_CHANGED ·
ACCOUNT_SUSPENDED · ROTATED · EXPIRED it was. `PASSWORD_CHANGED` has no caller yet — there is
no change-password endpoint; the helper is written and waiting for one.
`docs/09-auth-tokens.md` §1.4 is the full account.

Roles are rows in `iam.role`, not an enum. Two codes changed from the old model:
`BDI_APPROVER` → `BDI_FINAL_APPROVER` and `BDI_SPECIALIST` → `BDI_DATASET_SPECIALIST`; two are
new (`BDI_LEGAL_OFFICER`, `SYSTEM_ADMINISTRATOR`).

**Every role assignment carries an organisation, BDI staff included** — they belong to the BDI
organisation row, the same one their activation key has always pointed at. It was `NULL` until
2026-08-16, which meant the database could not answer "which organisation is this person in?"
for BDI staff.

The Excel's rule that one organisation has at most one active `ORGANIZATION_USER` and one
active `ORGANIZATION_APPROVER` (this contradicts `docs/01-user-journey.md` §1; the Excel wins)
is now enforced in `assignRole`, not by a database index. `uq_active_org_scoped_role_assignment`
covered *every* role rather than those two, and only missed BDI staff because their
organisation was NULL and Postgres counts NULLs as distinct; giving them a real organisation
would have capped BDI at one officer in total. A partial index cannot express "these two roles"
because `role.id` is regenerated per database. **The BDI organisation is exempt from the rule** —
many officers per role is normal there. The trade-off is that concurrent writes no longer have
a database-level net; `assignRole` runs inside the activation transaction, which covers the
paths that exist.

`Invitation` is replaced by `iam.activation_key`, following the lifecycle in that sheet: create
the `user_account` as `PENDING` first, then issue a key for (account, organisation, role).
The key is hashed with **HMAC-SHA-256** (`ACTIVATION_KEY_SECRET`), not bare SHA-256, so a
database leak alone cannot produce a usable key. `organization_id` is NOT NULL there, which is
why BDI itself is a row in `organization.organization` (`lib/system.ts`).

Activation is ThaiD-first and has no email-OTP variant. `POST /api/auth/thaid/start` →
the user verifies on ThaiD → `POST /api/auth/thaid/callback` compares the `pid` claim with
`user_account.cid` → `POST /api/auth/activate` sets the password and flips the account to
`ACTIVE`, creates the role assignment and marks the key `USED`, all in one transaction.
**`password_hash` and `iam.otp_code` are deliberate additions not present in the Excel**;
they now carry the password + OTP login path, not activation.

An admin can create the organization before anyone registers
(`POST /api/admin/organizations`) and bind it to the invitation with `organizationId`.
Only `organization_code` and `name_th` are required there — the two columns the database
itself makes NOT NULL — and the code is supplied, not generated. When that user starts
registering, `POST /api/organizations` opens the draft **against their existing
organization** and copies its columns into the request snapshot; it no longer creates a
second organization. It also looks for an in-flight request by organization, not just by
`created_by`, so the second person invited into the same organization edits the same
request rather than starting a rival one. `docs/10-admin-prefill-organization.md` has the
decisions behind it.

`POST /api/admin/invitations` therefore **requires `cid`** for every role. The whole flow
rests on comparing against a CID recorded when the account was created — a CID the user
typed themselves would prove nothing.

**One national ID is one account** — `iam.user_account.cid` is `@unique`. The Excel never said
so; the constraint was found in `main`'s database, added by hand and present in no migration,
which is why `main` answered 500 (an uncaught P2002) on an invitation whose CID was already
taken while every fresh checkout answered 201 and made a second account. Settled on
2026-08-17 in favour of keeping the rule, so `20260817153500_user_account_cid_unique` drops
the hand-made constraint and recreates it as Prisma's own — every database now agrees. Two
paths have to say so in words rather than letting the constraint fire: `POST
/api/admin/invitations` answers 409 `cid_exists` naming the address that holds the number, and
`ensureApproverAccount()` in `organizations.ts` answers 409 `approver_cid_exists`, because a
signatory's CID only collides at **officer approval** — several screens and days away from the
form where it was typed, so the message has to say which account and what to change.

Because both `email` and `cid` are unique, a mistyped invitation used to leave both values
locked to a `PENDING` account for good — `revoke` only kills the key, and the account keeps the
pair. `DELETE /api/admin/invitations/:id` is the way out: it removes the key, and the account
too when that account exists only because of this invitation (still `PENDING`, no other key, no
role, no assigned review task, no signature or legal acceptance), along with the placeholder
organization and untouched draft an organization-less invitation had created. Anything else and
it removes the invitation only, saying which of those held the account back. An `ACTIVE`
account answers 409 — deleting a working account is not "removing an invitation". The
`INVITATION_DELETED` audit event carries the email, CID and role, because after the delete it
is the only record that the invitation ever existed. `docs/09-auth-tokens.md` §2.1 has the
table.

Activation does **not** touch `organization.status`. An organisation goes `ACTIVE` only when
its registration request clears `BDI_FINAL_APPROVAL` (Journey B). The Notion card §2.5 says
otherwise; that was raised and settled on 2026-08-13 in favour of Journey B.

### ThaiD

`lib/thaid.ts` talks to DOPA (authorize URL, token exchange, ES256 id_token verification
against their JWKS, revoke); `lib/thaid-flow.ts` keeps the in-flight state. Both the OAuth
`state` and the "identity verified" receipt live in `integration.integration_operation`
(`THAID` / `VERIFY_IDENTITY` for activation, `AUTHENTICATE` for login) rather than a new
table — the sheet already designates that table for this, and every attempt, including the
failures, lands in it for free.

The raw activation key is never sent to ThaiD and never stored: the callback finds its way
back through `subject_id`, which is the `activation_key` row id.

Every authorization request carries a random `nonce` alongside `state`, stored in
`integration_operation.request_nonce` and compared against the `id_token` claim. A **mismatch**
is always rejected; a **missing** claim only warns, because it is not yet confirmed that DOPA
echoes `nonce` back — `THAID_REQUIRE_NONCE=true` turns that into a rejection once it is. Neither
case revokes the activation key, for the same reason `cid_unavailable` doesn't. Tokens are
revoked on the way out with `token_type_hint`, refresh token included when one comes back.
PKCE is not implemented: it needs an answer from DOPA first.

A CID mismatch is not just a rejection — §2.4 of the card requires the key to be `REVOKED`
and the attempt logged (`IDENTITY_VERIFICATION_FAILED` with `failure_reason: CID_MISMATCH`),
so a wrong card cannot be retried against the same link.

**There is no mock mode.** Every deployment talks to DOPA for real; one without client
credentials answers 501 `not_configured` at `POST /api/auth/thaid/start` rather than waving
the user through. A previous `THAID_MOCK` did the latter and was removed — a switch that
turns identity verification into a button is not something to leave lying in a repo.

`THAID_USE_PID` chooses **which claim the CID is read from** — `pid` (the manual's answer,
needs the `pid` scope) or `sub`. It is not a switch that disables the check: the comparison
against `user_account.cid` runs either way, and a mismatch revokes the key either way. It
exists because DOPA has not granted this project's client the `pid` scope, while `sub` comes
back as the 13-digit national ID.

Whichever claim it reads, the value must pass the national-ID checksum before it counts
(`toIdentity()` in `lib/thaid.ts`). A claim that is missing or opaque yields 502
`cid_unavailable` and **does not** revoke the activation key — an unreadable CID means our
configuration is wrong, not that the user presented the wrong card, and their link must not
be destroyed for our mistake. `docs/07-thaid-integration.md` §4.2 has the full table.

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

The logo is the real artwork from `assets/theme_ci_design/LOGO/`, not a redrawing.
`components/brand/Logo.tsx` inlines the SVG paths (navy on `currentColor`, the coral dot on its
own class, so one file covers every tone); the PDF and email headers use trimmed PNGs in
`backend/src/assets/brand/` because neither PDFKit nor an email client can render SVG.
`docs/02-ui-spec.md` §1.6 maps each surface to the source file it came from — regenerate from
those originals rather than editing path coordinates by hand.

`frontend/lib/dataset-form.ts` is a **deliberate copy** of the code lists and the conditions
engine in `backend/src/lib/dataset.ts` — the form has to show what a choice forces the moment
it is made, so it cannot ask the API on every change. The backend re-applies the same rules
before every write (`normaliseMetadata`), so a stale copy is a UI bug, never a data bug.
Change both files together, like the CI colors.

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
- **A database condition we can name never answers 500.** `index.ts` maps Prisma's own codes to
  a status and a Thai message (unique → 409, missing row → 404, unreachable database → 503).
  Routes still catch their own cases first and say which field collided — the middleware is the
  last net, and it logs when it catches something, because that means a route is missing a case.

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
- Deploying the session change logs **everybody** out at once: the cookie format changed, so
  every value issued by the old build is meaningless to the new one. That is expected and
  cannot be avoided, but it is not something to do on a demo day without warning people.
- Where `APP_URL` is https (that is `main`), the session cookie is issued `Secure`, so a script
  that logs in over `http://localhost:4000` gets a 200 and then 401 on every later call — the
  browser or client never sends the cookie back. Drive that deployment through
  `https://bdi-api.thammasorn.org` instead. `curl /health/ready` on localhost is still fine;
  it needs no session.
- Replacing a file in `public/` under the same name does not reliably replace what
  `next/image` serves. The optimized derivatives live in `.next/cache`, which is a named
  volume that survives `restart`, and clearing that directory did not evict all of them —
  some widths kept returning the previous image while others were correct, which looks like
  a rendering bug rather than a cache. Import images instead (`import x from "./x.webp"`):
  Next fingerprints the URL from the file contents, so a changed file is a changed URL, and
  it reads `width`/`height` off the file rather than trusting numbers typed by hand. Both
  problems bit at once when the diagram was swapped for one with a different aspect ratio.
- Route params beat query strings for anything the first client render needs.
  `useSearchParams()` is empty on that render; a page that redirected when its `?id=` was
  missing bounced users away before hydration finished.
- **Express 4 does not catch async handler rejections** — an `async` route that throws
  produces an unhandled rejection, and Node 22 exits on those, so the whole API dies
  instead of returning 500 and the error middleware in `index.ts` never runs.
  `GET /api/organizations/mine` was enough to do it: no such route, so it matched
  `GET /:id`, and Prisma raised P2023 on a non-UUID. Route files therefore import
  `Router` from `lib/async-route.js`, not from `express` — keep it that way for new
  route files. Both routers also 404 a non-UUID `:id` in `router.param()`.
- The ThaiD sandbox sits behind a WAF that blocks any user agent containing
  `HeadlessChrome` — it answers with an HTML page saying "Web Page Blocked!" instead of
  redirecting, which reads like a broken client. Screenshot runs must override the user
  agent. Its login page also polls for the QR scan forever, so `waitUntil: "networkidle"`
  never resolves there.
- The client credentials registered for this project (`assets/thaid/env_dev.txt`) are
  **not granted the `pid` scope** and are pinned to `http://localhost:3000/auth/callback/thaid`.
  Asking for `pid` with them returns `invalid_scope` at the authorize step, and no CID means
  no CID matching. Development therefore runs on DOPA's sandbox demo client, which accepts
  any `redirect_uri` and grants `pid`. Both gaps are DOPA-side registration changes, not code.
  Because of the pinned redirect URI, **the project's own credentials can only be exercised
  from `main`** (it owns port 3000); no dev checkout can be used with them.
- DOPA's `sub` is the 13-digit national ID — verified on both the demo client and the
  project's client, with `scope=openid` and nothing else. So the CID comparison is
  recoverable without the `pid` scope. It is deliberately not wired up yet: OIDC does not
  promise `sub` is anything in particular, and if production issued a pairwise opaque `sub`
  instead, comparing it to `cid` would revoke activation keys for legitimate users. Ask DOPA
  what `sub` is before relying on it — `docs/07-thaid-integration.md` §4.3. Their sandbox
  does publish `/.well-known/openid-configuration`, and it says
  `subject_type_supported: ["public"]`, so the pairwise scenario is off the table there;
  production is still a different system. That document also answers PKCE (not advertised)
  and refresh tokens (the grant is supported) — §4.4 has the whole reading of it.
- Giving BDI staff a real organisation broke every automatic assignment. `pickAssignee()` was
  called with `organizationId: null` to mean "BDI side, no organisation", which after
  2026-08-16 matches nobody — `POST /:id/submit` answered 503 `no_reviewer` on both journeys
  while the officers were sitting right there. BDI picks now pass `BDI_ORGANIZATION_ID`.
- `publicAttachment()` used to return the slot as `attachmentType`, but every screen (and the
  `Attachment` type in `frontend/lib/types.ts`) reads `kind`. `a.kind` was `undefined`
  everywhere, so the preview page never found the generated PDF and **"นำส่งคำขอ" stayed
  disabled in both journeys** although the API had built the file. It returns `kind` now.
- `decodeOriginalName()` (multer hands `originalname` over as latin1) must only touch names
  that came in over multipart. Running it on a filename the code wrote itself turns Thai into
  mojibake — that is why uploads go through `uploadedFile(req.file)` and `storeAttachment`
  no longer decodes.
- `rows()` in `pdf.ts` measured only the value column, so a label that wrapped to two lines had
  the divider drawn through it and the next row on top of it. It takes the taller of the two now.
- Postman reads `{{var}}` from the environment before the collection, so a name declared in
  **both** scopes always comes from the environment. All three
  `docs/*.postman_environment.json` files declared an empty `organizationId` and
  `activationKeyId` — the two ids the collection's own Tests scripts capture — which shadowed
  every captured value: `POST /api/admin/invitations` went out with `"organizationId": ""` and
  answered 400 `validation`, revoke and PATCH answered 404, and `D` quietly listed *all*
  organizations instead of fetching one and still passed. Ids captured at runtime belong in
  collection variables only; an environment carries `baseUrl` and `adminToken` and nothing
  else. The requests that depend on a captured id now refuse to send in a pre-request script
  that names the request to run first, so the next occurrence says what it is.
- Prisma reports "cannot reach the database" as **two** classes that keep the code in different
  fields. A pool that was connected and then lost the server raises
  `PrismaClientKnownRequestError` with `code: "P1001"`; a client that never connected raises
  `PrismaClientInitializationError`, which carries `errorCode` instead. Handling only the first
  looks correct — until the database is down at boot, when the API answers 500 again. Both are
  mapped in `index.ts`, and an initialization failure answers 503 even when it carries no code.
- The two `BDI_OFFICER_REVIEW` rounds look identical to anything reading `task_type`.
  Round one goes to the organization for signature, the re-check after signing goes to
  BDI final approval. Backend and `components/dataset/DetailView.tsx` both decide by
  whether an `ORGANIZATION_APPROVAL` has completed — a screen keyed on `task_type`
  alone will show the wrong button and nothing will fail loudly.


## Notion

Work is tracked in Notion, not in this repo's issues.

- Project page: **Government Datahub Platform**
  https://app.notion.com/p/3aeee3954ee8800d9468cbb1982655e3
- Task database on that page: **Task Board**
  https://app.notion.com/p/3b9ee3954ee880b2a324ffad3a38e1ae

The spec pages (user journeys, Authentication & User Account, Database Design, Admin Portal)
hang off the project page. `docs/` is the expanded, buildable version of those — when the two
disagree, ask; don't silently follow one.

Each Task Board card is one unit of work. **Write progress back onto its card as you go — every
time, not only when asked.** The board is how everyone who is not reading the repo sees what is
happening; work that exists only as commits is invisible to them, and the questions raised along
the way get lost.

Append a dated section rather than rewriting the card, so the history reads in order. Cover what
was done, what was decided and why, what broke, what was verified, and what is still outstanding
as checkboxes. Correct anything earlier on the card that the new work has made untrue — a card
that contradicts itself is worse than one that is out of date. Say plainly when something is
*not* finished (a branch not pushed, work not merged); a card listing only successes reads as
done. Open questions belong on the card too, since that is where the person who can answer them
will look.

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