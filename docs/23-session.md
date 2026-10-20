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
**60 seconds, or half of the idle window if that is shorter**.

The stored value can therefore trail the real last request by up to one interval, so the
effective idle timeout lies between *idle − interval* and *idle*. In production that is between
59 and 60 minutes, which nobody notices.

#### Worked example — production's values

`main/.env` on 2026-10-20: `SESSION_IDLE_SECONDS=3600` (1 hour), `SESSION_TTL_SECONDS=604800`
(7 days). Interval = min(60 s, 3600 ÷ 2) = **60 s**.

A user logs in at 09:00:00 on 20 Oct:

| Time | User does | `last_seen_at` age | Written? | Stored `last_seen_at` | Idle deadline (+3600 s) |
|---|---|---|---|---|---|
| 09:00:00 | logs in (OTP verified) | — | created | 09:00:00 | **10:00:00** |
| 09:00:10 | opens the request list (~20 API calls) | 10 s | no, < 60 s | 09:00:00 | 10:00:00 |
| 09:00:40 | opens one request | 40 s | no | 09:00:00 | 10:00:00 |
| 09:01:05 | clicks a tab | 65 s | **yes**, ≥ 60 s | 09:01:05 | **10:01:05** |
| 09:01:30 | scrolls, loads attachments | 25 s | no | 09:01:05 | 10:01:05 |
| 09:01:50 | last click, goes to a meeting | 45 s | no | 09:01:05 | 10:01:05 |

The last real activity was 09:01:50, but the stored value is 09:01:05, so the session ends
45 s earlier than "exactly one hour after the last click". About 60 API calls in those
110 seconds cost **one** write.

The user comes back:

| Returns at | Check | Result |
|---|---|---|
| **10:01:00** | 10:01:05 > now → valid; value is 3595 s old → written | stays logged in; new deadline **11:01:00** |
| **10:01:10** | 10:01:05 ≤ now → expired | **401**, frontend sends them to `/login`; row closed `EXPIRED`, audit `expiry_kind: IDLE` |

The absolute expiry runs alongside, untouched by activity: `expires_at` = 20 Oct 09:00:00 +
604800 s = **27 Oct 09:00:00**, and the cookie's `Max-Age` is the same 604800. Someone who clicks
every minute for a week is still logged out then, with `expiry_kind: ABSOLUTE`.

#### Why the interval is capped at half the idle window

The cap matters only for very short test values. With `SESSION_IDLE_SECONDS=30` and a fixed
60 s interval, a session in constant use dies anyway:

| Time | Stored `last_seen_at` | Deadline |
|---|---|---|
| 0 s login | 0 | 30 s |
| 1–29 s, clicking constantly — value < 60 s old, never written | 0 | 30 s |
| 30 s next click | — | **expired** |

With the cap the interval is 15 s, so a write always lands before the deadline (15 s → deadline
45 s, 30 s → 60 s, …). The window is still coarse: the session ends anywhere from 15 to 30 s
after the last click. A short test value proves idle expiry happens, not exactly when.

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
