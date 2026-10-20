# How a session works

What happens between "the user proved who they are" and "the user is logged out". The full
inventory of every token in the system is in `docs/09-auth-tokens.md`; this page follows only the
session, end to end, and is the reference for the two settings that control its lifetime.

Code: `backend/src/lib/session.ts` (lifecycle) · `backend/src/lib/auth.ts` (cookie, id generation) ·
`backend/src/middleware/auth.ts` (`requireAuth`) · `backend/src/routes/auth.ts` (`issueSession()`,
logout routes) · table `iam.session` in `backend/prisma/schema.prisma`.

---

## 1. The short version

```
 browser                         backend                              iam.session
 ───────                         ───────                              ───────────
 login (password+OTP / ThaID) ─▶ issueSession()
                                   ├─ revoke the session it arrived with (ROTATED)
                                   ├─ createSession() ──────────────▶ INSERT row
                                   │    token_hash   = SHA-256(raw)       expires_at   = now + TTL
                                   │                                      last_seen_at = now
 ◀── Set-Cookie: bdi_session=<raw 32 bytes, base64url>; HttpOnly; SameSite=Lax; Max-Age=TTL

 any API call  ─ cookie ───────▶ requireAuth → resolveSession(raw)
                                   ├─ find row by SHA-256(raw) ─────▶ SELECT
                                   ├─ revoked?            → 401
                                   ├─ expires_at <= now?  → close as EXPIRED (ABSOLUTE) → 401
                                   ├─ last_seen_at + IDLE <= now? → close as EXPIRED (IDLE) → 401
                                   ├─ touch last_seen_at (at most once a minute) ─▶ UPDATE
                                   └─ re-read account status, roles, organisation from DB
                                        → req.session = { sub, email, roles, organizationId, sessionId }

 logout / logout-all / admin revoke / password reset / suspend ─▶ UPDATE revoked_at, revoked_reason
```

- The cookie carries **an opaque random value and nothing else** — no user id, no roles, no
  signature. It is a pointer to one row in `iam.session`.
- The server stores only the **SHA-256** of that value, so a leaked database contains no usable
  cookie.
- Every check happens **on the server, on every request**. That is what makes logout real: once
  the row is revoked, every copy of the cookie stops working at once.

## 2. The cookie

| Attribute | Value | Why |
|---|---|---|
| name | `bdi_session` | `SESSION_COOKIE` in `lib/auth.ts`; the frontend's `app/layout.tsx` checks only that it exists |
| value | 32 random bytes, base64url | `generateSessionId()` — same generator as activation keys |
| `HttpOnly` | yes | JavaScript (and therefore XSS) cannot read it |
| `SameSite` | `Lax` | `bdi.thammasorn.org` and `bdi-api.thammasorn.org` are the same site already; `None` would be wider than needed |
| `Secure` | when `APP_URL` is https | override with `COOKIE_SECURE` |
| `Max-Age` | `SESSION_TTL_SECONDS` | the browser drops it at the same moment the server would refuse it |

The cookie is never sent as `Authorization: Bearer` and never stored in `localStorage`.

## 3. Lifetime — two expiries, both enforced

A session is valid only while **both** of these hold:

| Expiry | Column | Setting (seconds) | Default | Renewable? |
|---|---|---|---|---|
| absolute | `expires_at` | `SESSION_TTL_SECONDS` | `604800` (7 days) | No. Fixed at login; when it passes, log in again. |
| idle | `last_seen_at` | `SESSION_IDLE_SECONDS` | `28800` (8 hours) | Yes. Every authenticated request moves it forward. |

So with the defaults: a user who keeps working is logged out 7 days after logging in; a user who
leaves the tab overnight is logged out 8 hours after their last request.

### 3.1 Both values are in seconds

Seconds are the standard unit for session lifetimes (the cookie's own `Max-Age`, OAuth's
`expires_in`), and they let a tester set a short idle window without touching code.

```bash
SESSION_TTL_SECONDS=604800    # 7 days
SESSION_IDLE_SECONDS=28800    # 8 hours
```

Handy values: 15 min = `900` · 1 h = `3600` · 8 h = `28800` · 1 day = `86400` · 7 days = `604800`.

Rules, enforced by `seconds()` in `backend/src/env.ts`:

- Must be a **positive whole number**. `0`, `-5`, `1.5` or `abc` stops the backend at start-up
  with `SESSION_IDLE_SECONDS must be a positive whole number of seconds, got "…"` — better than
  issuing sessions that die instantly or never.
- **The old names are gone.** Until 2026-10-20 the settings were `SESSION_TTL_DAYS` (days) and
  `SESSION_IDLE_HOURS` (hours). They are no longer read at all: a `.env` that still sets them
  gets the defaults above, silently. Rename them wherever they are set (every `.env`, the Azure
  container app settings).

### 3.2 How `last_seen_at` moves

`last_seen_at` is **not** written on every request — one page load fires dozens of API calls.
`resolveSession()` writes it only when it is at least `TOUCH_INTERVAL_MS` old, which is
**60 seconds, or half of the idle window if that is shorter**. The cap matters only for very
short test values: with `SESSION_IDLE_SECONDS=30` and a fixed one-minute touch, a session in
constant use would still die after 30 seconds.

Consequence: idle expiry is accurate to about a minute, which is irrelevant at 8 hours.

### 3.3 Nobody sweeps expired rows

There is no cron. An expired session is closed **the first time someone presents it**:
`resolveSession()` sets `revoked_at`, `revoked_reason = EXPIRED`, and writes a `SESSION_REVOKED`
audit event whose `metadata.expiry_kind` is `ABSOLUTE` or `IDLE`. A session that expires and is
never used again keeps `revoked_at = NULL`, which is why `activeSessionsFor()` filters on time as
well as on the column.

### 3.4 What keeps a session idle-alive

Any authenticated API call. Note the one poller in the frontend,
`frontend/lib/use-request-watch.ts` (request detail page, every 15 s), **stops while the tab is
hidden** — otherwise a parked tab would hold the session open forever against
`SESSION_IDLE_SECONDS`. Don't add a background poller that ignores `document.hidden`.

## 4. Where a session starts

`issueSession()` in `routes/auth.ts` is called from exactly three places, each one a completed
proof of identity:

| Route | What had to succeed first |
|---|---|
| `POST /api/auth/login/verify-otp` | password **and** the emailed OTP |
| `POST /api/auth/thaid/callback` (`purpose: login`) | ThaID, and the citizen id matches the account |
| `POST /api/auth/activate` | ThaID, and the password has just been set |

`POST /api/auth/login` (the first step) does **not** issue a session; a password alone is not
enough. A password reset deliberately issues none either — the user goes back through login and
OTP.

`issueSession()` first revokes whatever session the request arrived with (`ROTATED`), so logging in
always produces a new value. This blocks session fixation.

## 5. What happens on every request

`requireAuth` (`middleware/auth.ts`):

1. No `bdi_session` cookie → **401** `unauthenticated`.
2. `resolveSession()` — not found, revoked, absolute-expired or idle-expired → **401**.
3. Load the account. Missing or not `ACTIVE` → revoke **all** its sessions
   (`ACCOUNT_SUSPENDED`) and **401**. Suspension takes effect on the very next request.
4. Read roles and organisation **fresh from the database** (active assignments only, inactive
   master roles dropped) and put them on `req.session`.

Step 4 is deliberate: roles and organisation change while a session is still valid. Don't move
them back into the cookie, and don't cache this read away.

The 401 is the same for every reason, on purpose — the client learns nothing about why. The
reason is in the audit log.

## 6. Where a session ends

Every way out sets `revoked_at` + `revoked_reason` on the row and writes one `SESSION_REVOKED`
audit event.

| Reason | Trigger | Scope |
|---|---|---|
| `LOGOUT` | `POST /api/auth/logout` | this session |
| `LOGOUT_ALL` | `POST /api/auth/logout-all` | every session of the user |
| `ROTATED` | a new login from a browser that already had a session | the old one |
| `PASSWORD_CHANGED` | `POST /api/auth/password-reset` | every session of the account |
| `ACCOUNT_SUSPENDED` | suspend/deactivate, or `requireAuth` finding a non-active account | every session of the account |
| `EXPIRED` | presented after `expires_at` or after the idle window | this session |

An administrator can also list and revoke another user's sessions:
`GET /api/admin/users/:id/sessions` and `DELETE /api/admin/users/:id/sessions`. A user sees
their own with `GET /api/auth/sessions`.

## 7. The `iam.session` row

| Column | Meaning |
|---|---|
| `token_hash` | SHA-256 of the cookie value — the lookup key |
| `user_account_id` | owner |
| `issued_at` | when it was created |
| `expires_at` | absolute deadline = `issued_at + SESSION_TTL_SECONDS` |
| `last_seen_at` | last touch; idle deadline = `last_seen_at + SESSION_IDLE_SECONDS` |
| `revoked_at`, `revoked_reason` | set once, when it ends (§6) |
| `ip_address`, `user_agent` | from the request context at login, for investigation |

Changing `SESSION_TTL_SECONDS` affects only sessions issued **after** the restart — `expires_at`
is stored. Changing `SESSION_IDLE_SECONDS` affects **every** session immediately — the idle
deadline is computed on each request.

## 8. Testing a short session locally

```bash
# in your checkout's .env
SESSION_IDLE_SECONDS=60
SESSION_TTL_SECONDS=300

docker compose up -d --force-recreate backend
```

Log in, wait a minute without touching the app, then click anything: the API returns 401 and the
frontend sends you to `/login`. The audit log shows `SESSION_REVOKED` with `reason: EXPIRED`,
`expiry_kind: IDLE`. Keep clicking instead and you are thrown out at five minutes with
`expiry_kind: ABSOLUTE`. Put the defaults back afterwards.
