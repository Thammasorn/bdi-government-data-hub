# 20 — Deploying D2 to Azure Container Apps

A complete runbook: from an empty resource group to a system somebody can log into.

Every command here is `az` CLI. Replace the placeholders in `<angle brackets>`; everything else
is literal. Values that must match something else in the system are called out where they appear.

> **This guide assumes the images already exist on Docker Hub.** Building and pushing them is a
> separate procedure — see `assets/docker-push-manual/manual.txt` on the build machine. The four
> repositories are `gbdi/d2s-portal-backend`, `gbdi/d2s-delivery-worker`,
> `gbdi/d2s-portal-frontend` and `gbdi/d2s-gotenberg`, and they are **private**, which is why
> §4.1 sets registry credentials on every container app.

---

## 1. What you are deploying

| Component | Azure service | Ingress | Port | Notes |
| --- | --- | --- | --- | --- |
| `frontend` | Container App | **external** | 3000 | the public site; proxies `/api/*` to the backend |
| `backend` | Container App | **external** | 4000 | REST API; also reachable internally |
| `delivery-worker` | Container App | **none** | — | polling loop, no HTTP server |
| `gotenberg` | Container App | **internal** | 3000 | `.docx` → PDF; must never be public |
| database | Azure Database for **PostgreSQL** Flexible Server | — | 5432 | |
| attachments | Storage account → Blob container | — | — | reached with managed identity |

### 1.1 It must be PostgreSQL, not Azure SQL

"Azure SQL" is Microsoft SQL Server. This system cannot run on it: `backend/prisma/schema.prisma`
declares `provider = "postgresql"`, uses ten Postgres schemas through Prisma's `multiSchema`, and
`workers/delivery.ts` claims queue rows with `FOR UPDATE SKIP LOCKED`. The product you want is
**Azure Database for PostgreSQL — Flexible Server**.

### 1.2 Request path

```
browser ──HTTPS──> frontend (external)
                      │  server-side rewrite of /api/*  (INTERNAL_API_URL)
                      ▼
                   backend (internal FQDN) ──> PostgreSQL
                      │                    ──> Blob Storage
                      └──> gotenberg (internal FQDN)

delivery-worker ──> PostgreSQL (outbox)  ──> SMTP
```

The browser never calls the backend directly. It calls `https://<frontend>/api/...`, and the
frontend's Node process forwards to the backend over the Container Apps internal network. This is
deliberate: same origin means no CORS, and the session cookie stays first-party
(`SameSite=Lax` would not be sent cross-site).

`https://<backend-fqdn>` stays available for external API callers (Postman, scripts).

---

## 2. Prerequisites

```bash
az login
az account set --subscription "<subscription-id>"
az extension add --name containerapp --upgrade
az provider register --namespace Microsoft.App
az provider register --namespace Microsoft.OperationalInsights
```

Choose names once and reuse them. This guide uses:

```bash
export RG=RG-d2DSP-nonprod
export LOC=southeastasia
export ENVNAME=cae-d2dsp-dev          # Container Apps environment
export PGNAME=psql-d2dsp-dev
export SANAME=std2dspdev              # storage account: 3-24 chars, lowercase+digits only
export TAG=<image-tag>                # the git short SHA the images were built from (and passed as GIT_SHA — §9)
```

---

## 3. Platform resources

### 3.1 Resource group and Container Apps environment

```bash
az group create -n $RG -l $LOC

az containerapp env create -n $ENVNAME -g $RG -l $LOC
```

All four apps must be in **this one environment**. Internal ingress only resolves within an
environment — an app in a different environment cannot reach `*.internal.*` names at all.

Note the environment's default domain now; every internal FQDN is built from it:

```bash
az containerapp env show -n $ENVNAME -g $RG --query properties.defaultDomain -o tsv
# e.g. proudsky-1a2b3c4d.southeastasia.azurecontainerapps.io
```

### 3.2 PostgreSQL Flexible Server

```bash
az postgres flexible-server create \
  -n $PGNAME -g $RG -l $LOC \
  --tier Burstable --sku-name Standard_B2s \
  --storage-size 32 \
  --version 16 \
  --admin-user d2admin \
  --admin-password '<strong-password>' \
  --public-access 0.0.0.0 \
  --yes

az postgres flexible-server db create -g $RG -s $PGNAME -d bdi
```

`--public-access 0.0.0.0` opens the firewall to **Azure services only**, which is what Container
Apps needs when it has no VNet integration. If you put the environment in a VNet, use
`--public-access None` and a private endpoint instead.

Two settings matter to this application:

- **TLS is mandatory.** The connection string must carry `sslmode=require` or Prisma fails to
  connect with a message about the server requiring SSL.
- **The `bdi` database must exist before the first migration.** `prisma migrate deploy` creates
  schemas and tables, never the database itself.

Build the URL once and keep it — it goes into three container apps:

```bash
export DATABASE_URL="postgresql://d2admin:<url-encoded-password>@${PGNAME}.postgres.database.azure.com:5432/bdi?schema=public&sslmode=require"
```

If the password contains `@ : / ? # & %`, percent-encode it or the URL parses wrongly and the
error you get back names the wrong host.

### 3.3 Storage account and blob container

```bash
az storage account create -n $SANAME -g $RG -l $LOC \
  --sku Standard_LRS --kind StorageV2 \
  --https-only true --min-tls-version TLS1_2 --allow-blob-public-access false

az storage container create --account-name $SANAME -n bdi-uploads --auth-mode login

# safety net — costs nothing until something is deleted
az storage account blob-service-properties update -n $SANAME -g $RG \
  --enable-delete-retention true --delete-retention-days 30 --enable-versioning true
```

**Being Owner on the subscription does not let you read blob data.** Data-plane access is a
separate role. Grant it to yourself before using `--auth-mode login`:

```bash
az role assignment create --assignee <your-upn-or-object-id> \
  --role "Storage Blob Data Contributor" \
  --scope $(az storage account show -n $SANAME -g $RG --query id -o tsv)
```

The container name must equal `AZURE_STORAGE_CONTAINER` (default `bdi-uploads`). Azure container
names are lowercase letters, digits and hyphens, 3–63 characters — stricter than the S3 bucket
names this system used before the move, though `bdi-uploads` satisfies both.

### 3.4 Generate the application secrets

```bash
export ADMIN_API_TOKEN=$(openssl rand -base64 48)
export ACTIVATION_KEY_SECRET=$(openssl rand -base64 48)
export LOG_READ_TOKEN=$(openssl rand -hex 32)
export INGEST_SERVER_TOKEN=$(openssl rand -hex 32)
```

Keep all four. `ACTIVATION_KEY_SECRET` is the HMAC key behind every activation link
(`key_hash = HMAC-SHA-256(secret, raw_key)`) — **rotating it invalidates every activation key
that has not been used yet**, and the backend refuses to boot without it when
`NODE_ENV=production`.

`LOG_READ_TOKEN` is the `x-log-token` of the log read API (`/api/admin/logs/*`,
`docs/21-activity-log.md` §3.11) — a **different** secret from `ADMIN_API_TOKEN` on purpose, so
holding the admin token does not open the activity log. Hand it only to the people who
investigate. Empty, the `dev-…-change-me` sample, or shorter than 32 characters, and that API
answers 503 `log_access_disabled` while everything else runs normally; the backend never
refuses to boot over it.

`INGEST_SERVER_TOKEN` is the `x-report-token` the Next server attaches to its own error reports
(`POST /api/client-errors`); the **backend and the frontend both get the same value** (§4.3,
§4.5). A report whose token matches is stored as `service: "frontend-server"`; anything else,
including every report from a browser, is stored as an unverified `browser` report, because the
backend is reachable without the frontend and a header on its own proves nothing. Empty, the
`dev-…-change-me` sample or anything under 32 characters in production (the backend then treats
it as empty), or a mismatch between the two apps: Next server errors are still stored, only as
unverified browser reports. Nothing refuses to boot over it. That is more than a label, though: the
report's route is discarded, so the same message on every page becomes one issue, and the browser's
limits apply — 30 a minute from the frontend's IP, the `browser` byte budget, and alert mails capped
at five per six hours without the message text (`docs/21` §5.12).

`LOG_HASH_KEY` is not generated here. It belongs to the log store, which stays off on Azure for now
(§3.5), and it is generated on the day the log store is turned on.

### 3.5 MongoDB — the log store, off for now

The backend and the delivery-worker can keep a searchable copy of the audit trail and of the
system's errors in MongoDB (`docs/21-activity-log.md`). **On Azure it stays off until BDI chooses a
managed MongoDB service**: both apps get `LOG_STORE_ENABLED=false` (§4.3, §4.4), so the MongoDB
driver never loads. Nothing else depends on it:

- Postgres `audit.audit_event` is the system of record and stays complete. MongoDB only ever holds
  a copy of it.
- `/health/ready` reports `logStore: disabled` and does not count it towards `healthy`.
- Container stdout already reaches Log Analytics, and every captured error still prints one
  `[capture]` line there with its reference and issue.
- The log read API (`/api/admin/logs/*`) answers 503 `log_store_disabled` (except `GET /status`,
  which answers 200 with `logStore.status: "disabled"`), `POST /api/client-errors`
  answers 204 and stores nothing, and the error digest (§4.4) sends nothing.

When it is turned on, the service must be one of:

- **Azure Cosmos DB for MongoDB (vCore)**, if it has to be Azure-native or use Entra, or
- **MongoDB Atlas** in an Azure region, for exact parity with the `mongo:7.0` that compose runs.

**Not Cosmos DB for MongoDB RU**: TTL only on `_ts`, 2 MB documents, `retryWrites=false` and
throttling (error 16500) all differ from what was built and tested. **And not `mongo` as a
container app**: Container Apps storage is Azure Files, which mongod does not support for its data
files.

What turning it on involves:

1. **Two users, not one.** `bdi_backend` (find everywhere, insert into four collections, update
   only `error_issues`, no remove) for the backend, which faces the internet and so must not be able
   to delete or rewrite the copy; `bdi_worker` (adds update, remove, createIndex and the stats
   commands) for the delivery-worker, which runs the relay and the daily prune. The roles are in
   `mongo/init/01-users.js`. That script uses `createRole`, which compose's `mongo` allows. **On a
   managed service, check first that custom roles can be created**. Atlas manages database users
   and custom roles in its own console and Admin API rather than through mongosh. If no custom role
   is possible, the split falls back to built-in roles, and the guarantee that the backend cannot
   delete has to be re-established some other way. That is a decision for BDI, not a setting.
2. **Secrets.** Each app gets its own URI secret, `mongodb-backend-uri` and `mongodb-worker-uri`,
   plus one shared `log-hash-key`:

   ```bash
   export LOG_HASH_KEY=$(openssl rand -hex 32)   # keep it: changing it later needs a rebuild of the copy

   az containerapp secret set -n ca-backend-dev -g $RG --secrets \
       mongodb-backend-uri="<uri of bdi_backend>" log-hash-key="$LOG_HASH_KEY"
   az containerapp update -n ca-backend-dev -g $RG --set-env-vars \
       LOG_STORE_ENABLED=true MONGODB_URI=secretref:mongodb-backend-uri MONGODB_DB=bdi_logs \
       LOG_HASH_KEY=secretref:log-hash-key

   az containerapp secret set -n ca-delivery-worker-dev -g $RG --secrets \
       mongodb-worker-uri="<uri of bdi_worker>" log-hash-key="$LOG_HASH_KEY"
   az containerapp update -n ca-delivery-worker-dev -g $RG --set-env-vars \
       LOG_STORE_ENABLED=true MONGODB_URI=secretref:mongodb-worker-uri MONGODB_DB=bdi_logs \
       LOG_HASH_KEY=secretref:log-hash-key
   ```

   `LOG_HASH_KEY` must be **the same value in both apps**. It keys the `cid#` and `email#` search
   keys, so a copy written under one key cannot be searched with another. Changing it means
   rebuilding the copy (`docs/21` §3.8).
3. **Size ceiling.** Without `LOG_STORE_MAX_MB` the apps assume 5120 MB, counted as data plus
   indexes. If the chosen tier holds less, set `LOG_STORE_MAX_MB` on both apps to below its quota.
4. **Connections.** Each backend replica opens up to 5 connections and the worker up to 3, so 18 at
   `--max-replicas 3`.
5. **Verify.** `/health/ready` should show `logStore: up` within 30 seconds. The worker's relay
   then backfills all of `audit_event`, at most 10,000 rows every 5 seconds (`docs/21` §3.8).
   `S1` in `docs/bdi-activity-log.postman_collection.json` shows how far behind the copy is
   (`relayLagSeconds`).

Q2 on the card (which MongoDB service on Azure) is still open. Until it is answered, none of this
applies.

---

## 4. Deploy the container apps

Deploy in this order. Each step needs an FQDN produced by the one before it.

### 4.1 Registry credentials

The `gbdi/*` repositories are private, so every app needs pull credentials. Use a Docker Hub
access token, not the account password:

```bash
export DOCKERHUB_USER=<user>
export DOCKERHUB_PAT=<access-token>
```

Each `az containerapp create` below carries `--registry-server docker.io
--registry-username --registry-password`. Container Apps stores the password as a secret named
`docker.io-<username>` automatically.

### 4.2 gotenberg — internal only

```bash
az containerapp create \
  -n ca-gotenberg-dev -g $RG --environment $ENVNAME \
  --image docker.io/gbdi/d2s-gotenberg:$TAG \
  --registry-server docker.io \
  --registry-username $DOCKERHUB_USER --registry-password $DOCKERHUB_PAT \
  --ingress internal --target-port 3000 --transport auto \
  --min-replicas 1 --max-replicas 3 \
  --cpu 1 --memory 2Gi \
  --command "/usr/bin/tini" --args "--","gotenberg","--api-timeout=60s"
```

Three things are deliberate:

- **`--ingress internal`.** Gotenberg has no authentication of any kind. Exposing it publicly
  hands anyone a document-conversion service running LibreOffice on your bill.
- **`--args "--api-timeout=60s"`.** Gotenberg's own default is **30 s**, but the backend waits
  60 s (`GOTENBERG_TIMEOUT_MS`). Without this flag a slow conversion — a six-page A2 while
  LibreOffice is cold — is cut off by gotenberg at 30 s while the backend is still waiting, and
  the user sees a 503 half a minute later than necessary.
- **`--memory 2Gi`.** LibreOffice is not small. It will start with less and then fail on real
  documents.
- **Keep `tini` as PID 1.** It reaps the LibreOffice processes gotenberg spawns. Overriding the
  command with a bare `gotenberg` runs, but leaves nothing to reap them. Verified: the form above
  gives `tini` at PID 1 with `gotenberg` as its child. Passing only `--api-timeout=60s` as the
  argument **replaces the command entirely** and the container dies at once.

Gotenberg is configured entirely through command-line flags; it reads almost no environment
variables. Capture its FQDN:

```bash
export GOTENBERG_FQDN=$(az containerapp show -n ca-gotenberg-dev -g $RG \
  --query properties.configuration.ingress.fqdn -o tsv)
echo $GOTENBERG_FQDN     # ca-gotenberg-dev.internal.<default-domain>
```

### 4.3 backend

```bash
az containerapp create \
  -n ca-backend-dev -g $RG --environment $ENVNAME \
  --image docker.io/gbdi/d2s-portal-backend:$TAG \
  --registry-server docker.io \
  --registry-username $DOCKERHUB_USER --registry-password $DOCKERHUB_PAT \
  --ingress external --target-port 4000 \
  --min-replicas 1 --max-replicas 3 \
  --cpu 1 --memory 2Gi \
  --system-assigned \
  --secrets \
      database-url="$DATABASE_URL" \
      admin-api-token="$ADMIN_API_TOKEN" \
      activation-key-secret="$ACTIVATION_KEY_SECRET" \
      log-read-token="$LOG_READ_TOKEN" \
      ingest-server-token="$INGEST_SERVER_TOKEN" \
      smtp-pass="<gmail-app-password>" \
      thaid-client-secret="<thaid-client-secret>" \
      thaid-api-key="<thaid-api-key>" \
  --env-vars \
      NODE_ENV=production \
      PORT=4000 \
      DATABASE_URL=secretref:database-url \
      ADMIN_API_TOKEN=secretref:admin-api-token \
      ACTIVATION_KEY_SECRET=secretref:activation-key-secret \
      LOG_READ_TOKEN=secretref:log-read-token \
      INGEST_SERVER_TOKEN=secretref:ingest-server-token \
      LOG_STORE_ENABLED=false DEPLOY_ENV=azure \
      AZURE_STORAGE_ACCOUNT_URL="https://${SANAME}.blob.core.windows.net" \
      AZURE_STORAGE_CONTAINER=bdi-uploads \
      GOTENBERG_URL="https://${GOTENBERG_FQDN}" \
      GOTENBERG_TIMEOUT_MS=60000 \
      SMTP_HOST=smtp.gmail.com SMTP_PORT=587 SMTP_SECURE=false \
      SMTP_USER="<gmail-address>" SMTP_PASS=secretref:smtp-pass \
      SMTP_FROM="ระบบกลางเพื่อการแบ่งปันข้อมูลดิจิทัล <no-reply@bdi.or.th>" \
      SUPPORT_EMAIL=d2share-support@bdi.or.th \
      SESSION_TTL_DAYS=7 SESSION_IDLE_HOURS=8 \
      INVITATION_TTL_DAYS=7 ACTIVATION_KEY_TTL_DAYS=7 \
      OTP_TTL_MINUTES=10 OTP_MAX_ATTEMPTS=5 \
      THAID_ROOT_URL=https://imauthsbx.bora.dopa.go.th \
      THAID_CLIENT_ID="<thaid-client-id>" \
      THAID_CLIENT_SECRET=secretref:thaid-client-secret \
      THAID_API_KEY=secretref:thaid-api-key \
      THAID_SCOPE="openid pid given_name family_name given_name_en family_name_en" \
      THAID_USE_PID=true THAID_REQUIRE_NONCE=false \
      THAID_STATE_TTL_MINUTES=15 THAID_VERIFICATION_TTL_MINUTES=30
```

`GOTENBERG_URL` is **`https://` with no port**. Container Apps terminates TLS at 443 on the
internal ingress and routes to the target port itself; writing `:3000` there fails to connect.

`APP_URL`, `CORS_ORIGIN` and `THAID_REDIRECT_URI` are missing on purpose — they need the
frontend's hostname, which does not exist yet. §4.5 fills them in.

`LOG_READ_TOKEN` goes to the **backend only** — the delivery-worker and the frontend never read
it. On its own it opens nothing yet: the log read API also needs the log store, which stays off on
Azure until BDI chooses a managed MongoDB service (`LOG_STORE_ENABLED=false` here and in
`deploy/azure/backend.env`, which also lists `MONGODB_URI` and `LOG_HASH_KEY` for that day — §3.5),
so the API answers 503 `log_store_disabled` until then (only `GET /status` answers 200, reporting
`disabled`). Setting the token now means turning the log
store on later needs no second secret. `INGEST_SERVER_TOKEN` is set now for the same reason: with
the log store off, `POST /api/client-errors` still answers 204 and stores nothing, and the frontend
(§4.5) must carry the same value.

`DEPLOY_ENV=azure` is the deployment name stored as `environment` on every error event, issue and
runtime event, and shown in the subject of the error digest. Without it the name falls back to
`NODE_ENV`, which is `production`. Compose deployments set their project name (`bdi-main`), so
`azure` keeps the two apart. The release comes from the image (§9), not from a variable.

Now grant the backend's identity access to blob data:

```bash
export BACKEND_PRINCIPAL=$(az containerapp show -n ca-backend-dev -g $RG \
  --query identity.principalId -o tsv)

az role assignment create --assignee $BACKEND_PRINCIPAL \
  --role "Storage Blob Data Contributor" \
  --scope $(az storage account show -n $SANAME -g $RG --query id -o tsv)
```

`AZURE_STORAGE_ACCOUNT_URL` with no key is what selects the managed-identity path:
`storage.ts` builds a `BlobServiceClient` with `DefaultAzureCredential`, which on Container Apps
resolves to this identity. **Do not also set `AZURE_STORAGE_CONNECTION_STRING`** — when both are
present the connection string wins, and you will have tested the wrong path.

Role assignments take a minute or two to propagate. Until then `/health/ready` reports storage
`down` while the database is `up`; that is expected, not a misconfiguration.

Capture the backend's names — you need both the public one and the internal one:

```bash
export BACKEND_FQDN=$(az containerapp show -n ca-backend-dev -g $RG \
  --query properties.configuration.ingress.fqdn -o tsv)
export ENVDOMAIN=$(az containerapp env show -n $ENVNAME -g $RG \
  --query properties.defaultDomain -o tsv)
export BACKEND_INTERNAL="ca-backend-dev.internal.${ENVDOMAIN}"
```

> The internal name is built from the **container app's own name**, not from the word `backend`.
> An earlier version of the deployment guide showed `backend.internal.<env>…` as the example and
> it cost the team an afternoon.

### 4.4 delivery-worker

Same image as the backend, different command.

```bash
az containerapp create \
  -n ca-delivery-worker-dev -g $RG --environment $ENVNAME \
  --image docker.io/gbdi/d2s-delivery-worker:$TAG \
  --registry-server docker.io \
  --registry-username $DOCKERHUB_USER --registry-password $DOCKERHUB_PAT \
  --ingress disabled \
  --min-replicas 1 --max-replicas 1 \
  --cpu 0.5 --memory 1Gi \
  --command "node" --args "dist/workers/delivery.js" \
  --secrets \
      database-url="$DATABASE_URL" \
      admin-api-token="$ADMIN_API_TOKEN" \
      activation-key-secret="$ACTIVATION_KEY_SECRET" \
      smtp-pass="<gmail-app-password>" \
  --env-vars \
      NODE_ENV=production \
      DATABASE_URL=secretref:database-url \
      APP_URL="https://<frontend-fqdn-from-4.5>" \
      SMTP_HOST=smtp.gmail.com SMTP_PORT=587 SMTP_SECURE=false \
      SMTP_USER="<gmail-address>" SMTP_PASS=secretref:smtp-pass \
      SMTP_FROM="ระบบกลางเพื่อการแบ่งปันข้อมูลดิจิทัล <no-reply@bdi.or.th>" \
      SUPPORT_EMAIL=d2share-support@bdi.or.th \
      DELIVERY_POLL_INTERVAL_MS=15000 DELIVERY_MAX_ATTEMPTS=5 \
      ADMIN_API_TOKEN=secretref:admin-api-token \
      ACTIVATION_KEY_SECRET=secretref:activation-key-secret \
      AZURE_STORAGE_ACCOUNT_URL="https://${SANAME}.blob.core.windows.net" \
      LOG_STORE_ENABLED=false DEPLOY_ENV=azure \
      ERROR_ALERT_EMAILS="<team-list-comma-separated>"
```

`ERROR_ALERT_EMAILS` is the list that gets the error digest (`workers/error-alerts.ts`: new
errors, regressions, fatals, dead letters, sustained 5xx, crash loops, the log store over its
size ceiling — at most one new digest per 15 minutes; a recipient still owed an earlier digest
may also get that one resent, so at most two mails per recipient in any 15 minutes). It is not a
secret, and it belongs to the **delivery-worker only**. Empty switches alerting off. It also does
nothing while the log store is off (`LOG_STORE_ENABLED=false` in `deploy/azure/delivery-worker.env`), since the digest is built
from the issues stored there. The digest goes through the same `SMTP_*` settings as every other
mail, one message at a time.

The worker is also the log store's relay. Once the log store is on (§3.5), it copies every
`audit_event` row into MongoDB and prunes old documents daily. With the log store off it does
neither, and the email queue is unaffected either way. `DEPLOY_ENV=azure` works as on the backend.

Four details decide whether this app works at all:

- **`--command "node" --args "dist/workers/delivery.js"` is mandatory.** The image's built-in
  `CMD` is `node dist/index.js`. Deploy it without the override and you get a second copy of the
  API that nobody routes traffic to, while the email queue silently never drains.
- **`--min-replicas 1 --max-replicas 1`.** This is a polling loop, not an HTTP service. Container
  Apps scales to zero by default, and nothing will ever wake this app up. Pinning to one replica
  is also honest about the design: the code claims rows with `FOR UPDATE SKIP LOCKED` so several
  replicas would be safe, but there is no reason to run them.
- **`ADMIN_API_TOKEN` and `AZURE_STORAGE_ACCOUNT_URL` are required even though the worker never
  uses them.** `workers/render.ts` imports `lib/mail.ts`, which imports `env.ts`, and `env.ts`
  builds its whole configuration object at import time — `ADMIN_API_TOKEN` is `required()` and a
  check at the bottom of the file throws unless one of the two Azure Storage variables is set.
  Miss either and the container crash-loops at boot with `Missing required environment variable`.
  The worker needs **no role assignment** on the storage account: `DefaultAzureCredential` does
  not contact Azure when the client is constructed, only on first use, which never happens here.
- **`APP_URL` must be the public frontend URL.** Every button in every email is built from it.

### 4.5 frontend

```bash
az containerapp create \
  -n ca-frontend-dev -g $RG --environment $ENVNAME \
  --image docker.io/gbdi/d2s-portal-frontend:$TAG \
  --registry-server docker.io \
  --registry-username $DOCKERHUB_USER --registry-password $DOCKERHUB_PAT \
  --ingress external --target-port 3000 \
  --min-replicas 1 --max-replicas 3 \
  --cpu 0.5 --memory 1Gi \
  --secrets \
      ingest-server-token="$INGEST_SERVER_TOKEN" \
  --env-vars \
      NODE_ENV=production \
      PORT=3000 \
      HOSTNAME=0.0.0.0 \
      INTERNAL_API_URL="https://${BACKEND_INTERNAL}" \
      INGEST_SERVER_TOKEN=secretref:ingest-server-token
```

`INGEST_SERVER_TOKEN` must be the **same value as the backend's** (§3.4). The Next server reads it
at runtime and attaches it to its own error reports; it is never `NEXT_PUBLIC_`, so it never
reaches the browser bundle.

`HOSTNAME=0.0.0.0` is set explicitly. Next's standalone server defaults to `0.0.0.0` already, but
if anything ever binds it to localhost the ingress health check fails and the revision never goes
live — a failure that reads as "the image is broken".

**`NEXT_PUBLIC_API_URL` is not in this list, and must not be.** It is a build-time value: Next
substitutes it into the browser bundle during `next build`, so setting it here does nothing at
all. It is baked as an empty string, which is the correct production value — empty means the
browser calls `/api/*` on the same origin as the page. Putting a full domain in it would break
login, because the session cookie would become cross-site.

`INTERNAL_API_URL`, by contrast, **is** read at runtime. Change it and restart the revision; no
rebuild is needed. (This was not true before 10 September 2026 — see §8.)

### 4.6 Close the loop

Now that the frontend exists, feed its hostname back into the backend and the worker:

```bash
export FRONTEND_FQDN=$(az containerapp show -n ca-frontend-dev -g $RG \
  --query properties.configuration.ingress.fqdn -o tsv)

az containerapp update -n ca-backend-dev -g $RG --set-env-vars \
  APP_URL="https://${FRONTEND_FQDN}" \
  CORS_ORIGIN="https://${FRONTEND_FQDN}" \
  THAID_REDIRECT_URI="https://${FRONTEND_FQDN}/auth/callback/thaid"

az containerapp update -n ca-delivery-worker-dev -g $RG --set-env-vars \
  APP_URL="https://${FRONTEND_FQDN}"
```

`COOKIE_SECURE` is deliberately not set: `env.ts` turns it on by itself when `APP_URL` starts
with `https://`. Setting it by hand is how you end up with a cookie the browser silently drops.

If you later put a custom domain in front of the frontend, `APP_URL`, `CORS_ORIGIN` and
`THAID_REDIRECT_URI` must all move to it, and DOPA must be told about the new redirect URI
(§7.2).

---

## 5. Initialize the database

Nothing above has created a single table. `prisma migrate deploy` is **not** part of the image's
startup command on Azure — the compose production overlay runs it, but that overlay does not
exist here, so it has to be run once by hand.

### 5.1 Apply the migrations

```bash
az containerapp exec -n ca-backend-dev -g $RG --command /bin/sh
```

Then inside the container:

```sh
npx prisma migrate deploy
```

Expect it to report the baseline migration plus everything after it, and finish with
`All migrations have been successfully applied.`

> On a database that already carries `_prisma_migrations` rows from before the baseline was cut,
> `migrate deploy` refuses to run because recorded migrations are missing from disk. On a
> throwaway environment the fix is to drop and recreate the `bdi` database. Anywhere the data
> matters this needs a written backfill first — `docs/06-db-migration-plan.md` §7.

### 5.2 Seed the master data — required

```sh
npm run seed:masters:prod
```

This is not optional and not sample data. It creates:

- the **SYSTEM** user account, which owns audit rows written by the system itself
- the **BDI organization** row — `activation_key.organization_id` is `NOT NULL`, so BDI staff
  need an organization of their own to be invited into
- the seven **roles** (`ORGANIZATION_USER`, `ORGANIZATION_APPROVER`, `BDI_OFFICER`,
  `BDI_FINAL_APPROVER`, `BDI_DATASET_SPECIALIST`, `BDI_LEGAL_OFFICER`, `SYSTEM_ADMINISTRATOR`)
- the **legal documents** A0–A3 and A4, uploading each `.docx` template to blob storage and
  rendering it once to prove LibreOffice can read it
- the **Thai address masters** — 77 provinces, 927 districts, 7,423 sub-districts

It is idempotent; running it twice is safe. It exercises Postgres, Blob Storage and gotenberg in
one go, so **if `seed:masters:prod` succeeds, the three connections are all genuinely working.**
It is the best smoke test in the system.

**The blob container must already exist.** The API creates it on boot through `ensureContainer()`;
the seed script does not. Run against a storage endpoint with no container, the seed fails at the
legal-document step with `RestError: The specified container does not exist` / `ContainerNotFound`.
§3.3 creates it — if you skipped that, start the backend once first.

### 5.3 Demo data — non-production only

```sh
npm run seed:demo:prod
```

**`seed:demo` deletes application data before rebuilding its fixtures.** Never run it against an
environment that holds anything real. It must run after `seed:masters:prod` — it fails fast if
`iam.role` is empty.

Use `:prod` for both. The production image installs production dependencies only, so `tsx` is not
present and the plain `npm run seed:demo` fails with `tsx: not found`.

### 5.4 Running these as a Job instead

`az containerapp exec` is fine for a first deployment, but it needs a running replica and an
interactive terminal. For a repeatable pipeline, run the same commands as a Container Apps job on
the same image:

```bash
az containerapp job create \
  -n caj-d2dsp-migrate -g $RG --environment $ENVNAME \
  --trigger-type Manual --replica-timeout 1800 \
  --image docker.io/gbdi/d2s-portal-backend:$TAG \
  --registry-server docker.io \
  --registry-username $DOCKERHUB_USER --registry-password $DOCKERHUB_PAT \
  --cpu 1 --memory 2Gi \
  --secrets database-url="$DATABASE_URL" \
  --env-vars DATABASE_URL=secretref:database-url NODE_ENV=production \
  --command "/bin/sh" --args "-c","npx prisma migrate deploy"

az containerapp job start -n caj-d2dsp-migrate -g $RG
```

A job that runs `seed:masters:prod` needs the storage and gotenberg variables too, since the seed
uploads and renders the templates.

---

## 6. Create the first accounts

The system is invite-only by design. There is no self-signup and no admin UI: the first accounts
are made with the admin API, authenticated by the `x-admin-token` shared secret rather than a
session, because the caller is an operator script.

### 6.1 Create the organization first

```bash
curl -X POST "https://${BACKEND_FQDN}/api/admin/organizations" \
  -H "x-admin-token: ${ADMIN_API_TOKEN}" \
  -H "content-type: application/json" \
  -d '{"organizationCode":"NSO","nameTh":"สำนักงานสถิติแห่งชาติ"}'
```

Only `organizationCode` and `nameTh` are required. Keep the `id` from the response.

### 6.2 Invite a person into it

```bash
curl -X POST "https://${BACKEND_FQDN}/api/admin/invitations" \
  -H "x-admin-token: ${ADMIN_API_TOKEN}" \
  -H "content-type: application/json" \
  -d '{
        "email": "somchai@nso.go.th",
        "role": "ORGANIZATION_USER",
        "organizationId": "<id-from-6.1>",
        "cid": "1234567890121",
        "prefixTh": "นาย", "firstnameTh": "สมชาย", "lastnameTh": "ใจดี"
      }'
```

- **`cid` is mandatory for every role.** Activation compares the national ID on the person's
  ThaiD card against this value; a CID the user typed themselves would prove nothing.
- **Organization-scoped roles require `organizationId`.** `ORGANIZATION_USER` and
  `ORGANIZATION_APPROVER` are refused without it. BDI roles bind to the BDI organization
  automatically.
- **One national ID is one account, and one account holds exactly one role.** A second invitation
  for a CID that already exists answers 409 `cid_exists` and names the address holding it.

BDI staff are invited the same way, with no `organizationId`:

```bash
curl -X POST "https://${BACKEND_FQDN}/api/admin/invitations" \
  -H "x-admin-token: ${ADMIN_API_TOKEN}" -H "content-type: application/json" \
  -d '{"email":"officer@bdi.or.th","role":"BDI_OFFICER","cid":"1234567890122",
       "prefixTh":"นาง","firstnameTh":"สุดา","lastnameTh":"ตรวจสอบ"}'
```

For a usable environment, invite at least one `BDI_OFFICER` and one `BDI_FINAL_APPROVER` — both
approval gates refuse to open with 503 `no_reviewer` when nobody holds the role.

### 6.3 The invitation email

The invitation is emailed by `delivery-worker`, not by the request handler. If no mail arrives:

```bash
az containerapp logs show -n ca-delivery-worker-dev -g $RG --tail 100
```

With `SMTP_USER` unset the mailer **prints the message and the activation link to stdout instead
of sending it** — which is a perfectly good way to run a first environment, as long as everyone
knows the link is in the logs.

### 6.4 Activation needs ThaiD

The invited person opens the link, verifies with ThaiD, and only then sets a password. There is
**no email-OTP fallback and no mock mode** — an environment without working ThaiD credentials
answers 501 `not_configured` at `POST /api/auth/thaid/start`, and nobody can activate an account.
Read §7.2 before promising anyone a working environment.

---

## 7. Verify

### 7.1 Checklist

```bash
# 1. every app is running its intended revision
az containerapp list -g $RG --query "[].{name:name,running:properties.runningStatus,fqdn:properties.configuration.ingress.fqdn}" -o table

# 2. the backend can reach Postgres AND Blob Storage
curl -s "https://${BACKEND_FQDN}/health/ready" | jq
# {"status":"ok","checks":{"database":{"status":"up"},"storage":{"status":"up"},
#   "datasetChoices":{"source":"database","count":…},"logStore":{"status":"disabled"}}}
# only database and storage decide "ok"; datasetChoices "defaults" means seed:masters has not run (§5.2)

# 3. the frontend proxy reaches the backend — this is the one that used to fail
curl -s -o /dev/null -w '%{http_code}\n' "https://${FRONTEND_FQDN}/api/address/provinces"   # 200

# 4. no proxy errors in the frontend log
az containerapp logs show -n ca-frontend-dev -g $RG --tail 100 | grep -i proxy   # expect nothing

# 5. the worker is alive and polling
az containerapp logs show -n ca-delivery-worker-dev -g $RG --tail 20
# [delivery] เริ่มทำงาน — poll ทุก 15000 ms, retry สูงสุด 5 ครั้ง
```

**Health endpoints live at `/health/live` and `/health/ready` on the backend — not under
`/api`.** `https://<frontend>/api/health/ready` returns **404**, because the backend mounts the
health router at the root and the frontend only forwards `/api/*`. Do not point a Container Apps
health probe at that path; use `/` for the frontend and `/health/live` for the backend.

Then **open the site and log in for real.** A green API is not a working system: there has been at
least one occasion where every endpoint answered correctly while every detail page was dead.

### 7.2 ThaiD will not work on a new domain without DOPA

This is the one thing that cannot be fixed from the Azure side.

The client credentials registered for this project are pinned to exactly one redirect URI —
`https://bdi.thammasorn.org/auth/callback/thaid`. Any other host, any other port, and the plain
`http://` form all answer `400 invalid_request — redirect url mismatch`. A brand-new
`ca-frontend-dev.<region>.azurecontainerapps.io` is "any other host".

Two ways forward:

1. **Ask DOPA to register the new redirect URI** for the project's client. This is the real fix
   and it is not instantaneous.
2. **Use DOPA's sandbox demo client** for non-production. It accepts any `redirect_uri` and grants
   the `pid` scope. Credentials are in `assets/thaid/thaid sandbox.postman_environment.json` on
   the build machine. Set `THAID_CLIENT_ID`, `THAID_CLIENT_SECRET` and `THAID_ROOT_URL`
   accordingly and leave `THAID_USE_PID=true`.

When ThaiD misbehaves, probe the authorize endpoint with a deliberately wrong scope, client and
redirect URI: three separate 400s prove the endpoint is still validating rather than waving
everything through. `docs/07-thaid-integration.md` §4 has the detail.

---

## 8. Traps that have already cost time

| Symptom | Cause | Fix |
| --- | --- | --- |
| `getaddrinfo ENOTFOUND backend` in the frontend log, and setting `INTERNAL_API_URL` changes nothing | Fixed on 10 Sep 2026. Before that, `rewrites()` in `next.config.ts` was evaluated at `next build` and the destination baked into `routes-manifest.json` | Use an image built from `2327b50` or later, where the proxy is a route handler that reads the variable per request |
| Setting `NEXT_PUBLIC_API_URL` in Azure has no effect | By design — it is substituted into the browser bundle at build time | Leave it empty. It is the only variable in the system that still requires a rebuild to change |
| Backend or worker crash-loops with `Missing required environment variable` | `env.ts` builds everything at import time | Supply `DATABASE_URL`, `ADMIN_API_TOKEN`, `ACTIVATION_KEY_SECRET` and one of the two Azure Storage variables — the worker too, even though it uses neither of the last two |
| `/health/ready` reports `storage: down`, database `up` | Role assignment missing or still propagating — most often. `/health/ready` is public, so it answers one word per check and never the cause: read the cause from the backend log line `[capture] backend error … issue=health:storage GET /health/ready — <Error>: <message>` (at most one a minute per check), or from the log store: issue `health:storage`, events tagged `health.storage`. `database: down` works the same way, with `health:database` / `health.database` | If the cause is an authorisation error, grant **Storage Blob Data Contributor** to the backend's principal and wait a couple of minutes |
| Storage works, but you were testing the wrong path | `AZURE_STORAGE_CONNECTION_STRING` was also set and takes precedence over the account URL | Remove it entirely on Azure |
| Emails never arrive, no errors anywhere | `delivery-worker` scaled to zero, or its command was not overridden | `--min-replicas 1`, and `--command "node" --args "dist/workers/delivery.js"` |
| Document conversion fails at ~30 s with a 503 half a minute later | gotenberg's default `--api-timeout` is 30 s while the backend waits 60 s | `--args "--api-timeout=60s"` |
| `500` on the first upload, tables exist | `prisma migrate deploy` ran but `seed:masters:prod` did not | Run it; A0–A4 templates live in the database, not the repo |
| Everyone is logged out after a deploy | Session cookie format changed in a release | Expected and unavoidable; do not deploy that release on a demo day without warning |
| Internal calls fail between two apps that both look healthy | They are in different Container Apps environments | Internal ingress only resolves within one environment |
| `logStore` stays `disabled` after setting `MONGODB_URI` | `LOG_STORE_ENABLED=false` is still set. The log store is on only when that variable is `true` or unset **and** the URI is non-empty | `--set-env-vars LOG_STORE_ENABLED=true` on both apps (§3.5) |
| Every error from Azure reports release `unknown` | The image was built without `--build-arg GIT_SHA` | Rebuild with the argument (§9); setting `RELEASE` on the app is not the fix |

---

## 9. Updating to a new image

**Build the images with their commit SHA.** The images come from the Docker Hub procedure
(`assets/docker-push-manual/manual.txt` on the build machine, outside git). The backend and frontend
builds must pass the commit as the build argument `GIT_SHA`:

```bash
TAG=$(git rev-parse --short HEAD)
docker build --target runner --build-arg GIT_SHA=$TAG -t gbdi/d2s-portal-backend:$TAG ./backend
docker build --target runner --build-arg GIT_SHA=$TAG --build-arg NEXT_PUBLIC_API_URL= \
             -t gbdi/d2s-portal-frontend:$TAG ./frontend
```

`GIT_SHA` becomes `RELEASE` in the backend image, and so in the worker, which is the same image
re-tagged. In the frontend it becomes `NEXT_PUBLIC_RELEASE`, inlined into both the browser bundle
and the Next server. Every error event and issue in the log store records it as its release
(`docs/21`), which is how an issue tells you the build it first and last happened in, and whether a
resolved issue came back after a deploy. **Without the argument both Dockerfiles fall back to
`unknown`**, and every error from Azure reports release `unknown`. It is a build-time value only: do
not set `RELEASE` or `NEXT_PUBLIC_RELEASE` on a container app. On the frontend it would do nothing,
because Next inlines `NEXT_PUBLIC_*` during `next build`. `main/` gets the same argument from
`docker-compose.prod.yml`, which passes `GIT_SHA: ${GIT_SHA:-unknown}` to all three built services,
so its deploy shell must export `GIT_SHA` before `build`.

```bash
az containerapp update -n ca-backend-dev         -g $RG --image docker.io/gbdi/d2s-portal-backend:<new-tag>
az containerapp update -n ca-delivery-worker-dev -g $RG --image docker.io/gbdi/d2s-delivery-worker:<new-tag>
az containerapp update -n ca-frontend-dev        -g $RG --image docker.io/gbdi/d2s-portal-frontend:<new-tag>
az containerapp update -n ca-gotenberg-dev       -g $RG --image docker.io/gbdi/d2s-gotenberg:<new-tag>
```

Then run `npx prisma migrate deploy` again — a release that adds a migration will otherwise fail
at the first query against the new column.

**Deploy the four together and from the same tag.** The frontend and backend are one application
split across two containers; a frontend that is fifty commits ahead of its backend calls endpoints
that do not exist yet.

Prefer an immutable tag (the git short SHA) over `latest`. `latest` moves under you, and Container
Apps will not pull a new image when the tag string has not changed.

Rolling back is a revision switch, not a rebuild:

```bash
az containerapp revision list -n ca-frontend-dev -g $RG -o table
az containerapp revision activate -n ca-frontend-dev -g $RG --revision <older-revision>
```

---

## 10. Environment variable reference

`env.ts` treats an empty string as unset, so a variable set to `""` falls back to its default
rather than overriding it.

### backend

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `NODE_ENV` | | `development` | set to `production` |
| `PORT` | | `4000` | must equal `--target-port` |
| ~~`RELEASE`~~ | | baked into the image | set at build time from `--build-arg GIT_SHA` (§9); do not set it on the app |
| `DATABASE_URL` | **yes** | — | needs `sslmode=require` on Azure |
| `ADMIN_API_TOKEN` | **yes** | — | shared secret for `/api/admin/*` |
| `ADMIN_TOKEN_WATCH_FPS` | | empty | comma-separated 12-hex fingerprints of retired admin tokens; each gets its own `ADMIN_TOKEN_REJECTED` row (`docs/09` §4.1). Fingerprints only, never a token |
| `ACTIVATION_KEY_SECRET` | **in production** | dev value | HMAC key for activation keys |
| `LOG_READ_TOKEN` | | empty (dev value outside production) | `x-log-token` of `/api/admin/logs/*`, backend only; `openssl rand -hex 32`. Empty, `dev-…` or under 32 characters = 503 `log_access_disabled`. Useless until the log store is on (§4.3) |
| `INGEST_SERVER_TOKEN` | | empty (dev value outside production) | `x-report-token` of the Next server's error reports; `openssl rand -hex 32`, **same value in the frontend**. Empty, `dev-…`, under 32 characters or mismatched = those reports are stored as unverified browser reports (§3.4) |
| `DEPLOY_ENV` | | `NODE_ENV` | deployment name stored on every error event and in the digest's subject; `azure` (§4.3) |
| `LOG_STORE_ENABLED` | | `true` | **`false` on Azure** until a managed MongoDB service is chosen (§3.5). Any value other than `true` turns the log store off, and so does an empty `MONGODB_URI` |
| `MONGODB_URI` | | empty = log store off | secret `mongodb-backend-uri`: the `bdi_backend` user, which cannot remove or rewrite (§3.5). Holds a password, so never print it |
| `MONGODB_DB` | | `bdi_logs` | |
| `LOG_STORE_MAX_MB` | | `5120` in production, `512` elsewhere | ceiling on data plus indexes; set below the managed service's quota if that is smaller. Same value on the worker |
| `LOG_HASH_KEY` | | empty in production (dev value elsewhere) | secret `log-hash-key`, **same value on the worker**, `openssl rand -hex 32`. Empty = no `cid#`/`email#` search keys, and searches by ID number or email answer 503 `hash_search_unavailable`. Changing it needs a rebuild of the copy (§3.5) |
| `AZURE_STORAGE_ACCOUNT_URL` | one of the two | — | managed identity; the production answer |
| `AZURE_STORAGE_CONNECTION_STRING` | one of the two | — | account key; dev only. Wins if both are set |
| `AZURE_STORAGE_CONTAINER` | | `bdi-uploads` | must match the container that exists |
| `APP_URL` | | `http://localhost:3000` | public frontend URL; drives email links and cookie `Secure` |
| `CORS_ORIGIN` | | `http://localhost:3000` | comma-separated |
| `COOKIE_SECURE` | | derived | leave unset — derived from `APP_URL` |
| `GOTENBERG_URL` | | `http://gotenberg:3000` | `https://<internal-fqdn>`, no port |
| `GOTENBERG_TIMEOUT_MS` | | `60000` | keep ≤ gotenberg's `--api-timeout` |
| `SMTP_HOST` `SMTP_PORT` `SMTP_SECURE` `SMTP_USER` `SMTP_PASS` `SMTP_FROM` | | Gmail defaults | no `SMTP_USER` = log instead of send |
| `SUPPORT_EMAIL` `SUPPORT_PHONE` | | `d2share-support@bdi.or.th`, empty | printed at the foot of every email; empty phone omits the line |
| `SESSION_TTL_DAYS` `SESSION_IDLE_HOURS` | | `7`, `8` | absolute and idle expiry |
| `INVITATION_TTL_DAYS` `ACTIVATION_KEY_TTL_DAYS` | | `7`, `7` | |
| `OTP_TTL_MINUTES` `OTP_MAX_ATTEMPTS` | | `10`, `5` | |
| `THAID_ROOT_URL` | | sandbox | |
| `THAID_CLIENT_ID` `THAID_CLIENT_SECRET` `THAID_API_KEY` | | empty | empty = 501 `not_configured` |
| `THAID_REDIRECT_URI` | | `${APP_URL}/auth/callback/thaid` | must match DOPA's registration exactly |
| `THAID_SCOPE` | | see §4.3 | |
| `THAID_USE_PID` `THAID_REQUIRE_NONCE` | | `true`, `false` | |
| `THAID_STATE_TTL_MINUTES` `THAID_VERIFICATION_TTL_MINUTES` | | `15`, `30` | |

### delivery-worker

`NODE_ENV`, `DATABASE_URL`, `APP_URL`, all six `SMTP_*`, `SUPPORT_EMAIL`, `SUPPORT_PHONE`,
`DELIVERY_POLL_INTERVAL_MS` (default `15000`), `DELIVERY_MAX_ATTEMPTS` (default `5`), plus
`ADMIN_API_TOKEN`, `ACTIVATION_KEY_SECRET` and one Azure Storage variable that exist only to get
`env.ts` past its boot checks. `ERROR_ALERT_EMAILS` (default empty = no error digest; comma-separated,
worker only, inert while the log store is off — §4.4). `DEPLOY_ENV`, `LOG_STORE_ENABLED`,
`MONGODB_DB`, `LOG_STORE_MAX_MB` and `LOG_HASH_KEY` behave as on the backend. `MONGODB_URI` is the
worker's own secret, `mongodb-worker-uri`, for the `bdi_worker` user, which may delete for the
daily prune (§3.5).

### frontend

| Variable | Notes |
| --- | --- |
| `NODE_ENV=production` | |
| `PORT=3000` | must equal `--target-port` |
| `HOSTNAME=0.0.0.0` | |
| `INTERNAL_API_URL` | `https://<backend-internal-fqdn>`, no port. Read per request |
| `INGEST_SERVER_TOKEN` | secret, same value as the backend's (§4.5). Read at runtime, never `NEXT_PUBLIC_` |
| ~~`NEXT_PUBLIC_API_URL`~~ | build-time only, must stay empty — see §4.5 |
| ~~`NEXT_PUBLIC_RELEASE`~~ | build-time only, from `--build-arg GIT_SHA` — see §9 |
| ~~`ALLOWED_DEV_ORIGINS`~~ | affects `next dev` only; irrelevant in production |

### gotenberg

None. Configuration is command-line flags — `--api-timeout=60s` is the one that matters here.

---

## 11. Related documents

- `docs/19-azure-blob-storage.md` — the storage move, both configuration paths, and the
  verification runs against the real account
- `docs/07-thaid-integration.md` — the ThaiD flow, what DOPA has and has not granted
- `docs/09-auth-tokens.md` — every token in the system: where it lives, how it is hashed, when it
  expires
- `docs/21-activity-log.md` — the activity log and error store: what MongoDB holds, the relay, the
  log read API, and the PDPA pack
- `docs/03-demo-walkthrough.md` — running the same journeys against a compose deployment
- `docs/06-db-migration-plan.md` §7 — the migration baseline and what it means for existing data
