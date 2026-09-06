# 19 — ที่เก็บไฟล์: ย้ายจาก MinIO ไป Azure Blob Storage

การ์ด Task Board **“Migrate to Azure”** (`Change minio to Azure Blob Storage`) · branch
`migrate-to-azure` · 2026-08-24

เอกสารนี้เขียนสำหรับคนที่ต้อง deploy หรือแก้โค้ดที่แตะไฟล์แนบ ไม่ใช่คู่มือผู้ใช้ ถ้าอยากรู้ว่า
ไฟล์แนบถูกจัดเก็บอย่างไรในเชิงข้อมูล ให้อ่าน sheet `attachment` ของ Excel และหัวข้อ
Attachments ใน `CLAUDE.md` ก่อน

---

## 1. สรุปสิ่งที่เปลี่ยน

| | เดิม | ใหม่ |
| --- | --- | --- |
| บริการ | MinIO (S3 API) | Azure Blob Storage |
| ตอน dev | คอนเทนเนอร์ `minio` + `minio-init` | คอนเทนเนอร์ `azurite` (emulator ของไมโครซอฟท์เอง) |
| SDK | `minio` ^8 | `@azure/storage-blob` ^12 + `@azure/identity` ^4 |
| คำศัพท์ | bucket / object | **container / blob** |
| ตั้งค่า | `MINIO_ENDPOINT` `MINIO_PORT` `MINIO_USE_SSL` `MINIO_ROOT_USER` `MINIO_ROOT_PASSWORD` `MINIO_BUCKET` | `AZURE_STORAGE_CONNECTION_STRING` **หรือ** `AZURE_STORAGE_ACCOUNT_URL` + `AZURE_STORAGE_CONTAINER` |
| console | <http://localhost:9001> | **ไม่มี** — ใช้ Azure Storage Explorer หรือ `az storage blob` |

**ไม่มีอะไรเปลี่ยนในฐานข้อมูล** `attachment.storage_bucket` / `storage_key` ยังชื่อเดิมและยัง
เก็บค่าเดิมทุกประการ ค่าใน `storage_bucket` คือชื่อ container (`bdi-uploads` ซึ่งผ่านกติกา
การตั้งชื่อของ Azure อยู่แล้ว) และ `storage_key` คือชื่อ blob (path ที่ `buildStorageKey()` สร้าง)
จึง **ไม่ต้องมี migration และไม่ต้อง backfill** — ดู §5 เรื่องการย้ายไฟล์ที่มีอยู่แล้ว

---

## 2. โค้ดอยู่ที่ไหน

`backend/src/storage.ts` เป็น **ไฟล์เดียว** ที่ `import` SDK ของ Azure ที่เหลือของระบบเรียกผ่าน:

```ts
CONTAINER                              // ชื่อ container ที่ไฟล์ใหม่ถูกเขียนลงไป
ensureContainer()                      // สร้างถ้ายังไม่มี — เรียกตอนบูตและใน seed:demo
pingStorage()                          // ใช้โดย GET /health/ready
putObject(key, buffer, contentType)
getObjectStream(container, key)        // สตรีมต่อให้เบราว์เซอร์
getObjectBuffer(container, key)        // อ่านทั้งก้อน (template .docx)
```

ของเดิมก็ห่อไว้แบบเดียวกัน ซึ่งเป็นเหตุผลที่งานย้ายทั้งหมดจบใน `storage.ts` + `env.ts` และ
`lib/attachment.ts` อีกห้าบรรทัด **ให้มันอยู่แบบนี้ต่อไป** — อย่า import
`@azure/storage-blob` จากที่อื่น

การอ่านไฟล์ใช้ `attachment.storage_bucket` ของแถวนั้นเสมอ ไม่ใช่ `CONTAINER` ปัจจุบัน
ย้าย container เมื่อไรไฟล์เดิมก็ยังเปิดได้

---

## 3. การตั้งค่า

ต้องมีอย่างน้อยหนึ่งทาง ไม่งั้น `env.ts` โยน error ตั้งแต่บูต (ทุก process ที่ `import env.ts`
รวมถึง `delivery-worker` ที่ไม่ได้แตะไฟล์เลย — ของเดิมบังคับ `MINIO_ROOT_USER` แบบเดียวกัน)

### 3.1 `AZURE_STORAGE_ACCOUNT_URL` — ทางที่ควรใช้บน production

```
AZURE_STORAGE_ACCOUNT_URL=https://<account>.blob.core.windows.net
```

ไม่มีความลับอยู่ใน `.env` เลย ตัวตนมาจาก `DefaultAzureCredential` ซึ่งบน Azure คือ
**managed identity** ของ Container App / App Service / VM ที่รันอยู่ ต้องมอบ role
**Storage Blob Data Contributor** ให้ identity นั้นบน storage account หรือเฉพาะ container

ข้อดีที่ทำให้เลือกทางนี้: ไม่มี key ให้หลุด ไม่ต้องหมุน key และเพิกถอนสิทธิ์ได้จาก Azure
โดยไม่ต้อง deploy ใหม่

### 3.2 `AZURE_STORAGE_CONNECTION_STRING` — ทางสำหรับเครื่อง dev

ถือ account key ไว้ในไฟล์ ใช้ตอนไล่ปัญหาในเครื่อง หรือที่ที่ยังไม่มี managed identity
ตั้งมาทั้งคู่ = ตัวนี้ชนะ (ตั้งใจให้ทับได้)

### 3.3 `AZURE_STORAGE_CONTAINER`

ค่าตั้งต้น `bdi-uploads` กติกาของ Azure เข้มกว่า bucket ของ MinIO: **ตัวพิมพ์เล็ก ตัวเลข
ขีดกลาง ยาว 3–63 ตัวอักษร** ตั้งชื่อผิดกติกาจะได้ `InvalidResourceName` ตอน
`ensureContainer()` ไม่ใช่ตอนอัปโหลดไฟล์แรก

Container ถูกสร้างเป็น **private** (ค่าตั้งต้นของ Azure) ตั้งใจให้เป็นแบบนั้น — ไฟล์แนบทุกไฟล์
ต้องผ่าน backend ที่ตรวจสิทธิ์ก่อน ไม่มี URL สาธารณะให้เดา

---

## 4. ตอน dev: Azurite

`docker-compose.yml` รัน `mcr.microsoft.com/azure-storage/azurite` และตั้ง connection string
ของ emulator ให้ backend เอง **จึงไม่ต้องมี subscription ของ Azure เพื่อรันโครงการนี้**
account name/key ของ Azurite (`devstoreaccount1` / `Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1…`) เป็น
ค่าคงที่สาธารณะที่ไมโครซอฟท์ประกาศไว้ในเอกสาร ไม่ใช่ความลับ และเขียนไว้ตรง ๆ ใน compose
ได้อย่างปลอดภัย

สามเรื่องที่ต่างจาก MinIO และจะสะดุดถ้าไม่รู้:

1. **ไม่มีหน้าคอนโซล** — MinIO มีเว็บให้เปิดดู bucket ที่พอร์ต 9001 Azurite ไม่มี ใช้
   [Azure Storage Explorer](https://azure.microsoft.com/products/storage/storage-explorer)
   (มันมีโหมด “Local & Attached → Storage Accounts → Emulator” มาให้อยู่แล้ว) หรือ Azure CLI:

   ```bash
   az storage blob list -c bdi-uploads --connection-string 'UseDevelopmentStorage=true' -o table
   ```

   `.env.example` จึงเหลือพอร์ตเดียว (`AZURITE_BLOB_PORT`) แทน `MINIO_API_PORT` /
   `MINIO_CONSOLE_PORT` — เปิดเฉพาะ blob ไม่เปิด queue/table เพราะระบบไม่ได้ใช้

2. **ไม่มีบริการ init** — `minio-init` เคยรัน `mc mb` เพื่อสร้าง bucket ก่อน backend บูต
   Azurite ไม่มี CLI ติดมาใน image และ backend เรียก `ensureContainer()` ตอนบูตอยู่แล้ว
   จึงตัดบริการนั้นทิ้ง

3. **ไม่ได้เปิด `--loose`** ตั้งใจ — โหมดนั้นผ่อนการตรวจ header ให้หลวมกว่า Azure จริง
   ซึ่งจะทำให้บั๊กที่ควรเจอในเครื่องไปโผล่บน production แทน และนั่นทำลายเหตุผลทั้งหมด
   ของการใช้ emulator ที่เจ้าของ API ทำเอง

### พอร์ตกับ `new-dev.sh`

`new-dev.sh` **อยู่นอก repo** (อยู่ที่ `/hdd1tb/bdi-project/new-dev.sh` ซึ่งเป็นของเครื่อง
ไม่ใช่ของโค้ด) และยังเขียน `MINIO_API_PORT` / `MINIO_CONSOLE_PORT` ลง `.env` ของ checkout ใหม่
อยู่ — ตัวแปรที่ไม่มีอะไรอ่านแล้ว **ยังไม่ได้แก้โดยตั้งใจ เพราะ branch นี้ยังไม่ merge และ
สคริปต์นั้นใช้ร่วมกันทุก checkout รวมถึงที่ยังรัน MinIO อยู่**

จนกว่าจะ merge: checkout ที่ทำงานบน branch นี้ต้อง **ตั้ง `AZURITE_BLOB_PORT` เองใน `.env`**
ให้เป็น `91N0` ของ slot ตัวเอง ถ้าปล่อยว่าง compose จะพยายามเปิดพอร์ต 10000 ซึ่งชนกันทันที
ที่มี checkout ที่สอง

ตอน merge ให้แก้ `new-dev.sh` สองที่: ตัวแปรที่ `sed` เขียนลง `.env` และรายการพอร์ตที่มันเช็ค
ก่อนสร้าง checkout (`MINIO_CONSOLE_PORT` ไม่ต้องจองอีกแล้ว) — พร้อมกับ
`/hdd1tb/bdi-project/CLAUDE.md` ที่ยังเขียนว่า slot หนึ่งได้ห้าพอร์ต

---

## 5. ไฟล์ที่มีอยู่แล้วใน MinIO

**ยังไม่ได้ย้าย และ branch นี้ไม่ได้ย้ายให้** — ทุก deployment ที่มีข้อมูลจริงจะเห็นไฟล์เก่า
หายไปทันทีที่สลับ เพราะแถวใน `attachment` ชี้ไปที่ container ที่ยังว่างเปล่า

`main` เป็น deployment แบบใช้แล้วทิ้ง (ดู `CLAUDE.md` หัวข้อ Commands เรื่อง `down -v`) ทางที่
ถูกที่สุดคือ **seed ใหม่** ไม่ใช่ย้ายไฟล์ ถ้าวันหนึ่งข้อมูลมีค่า ให้คัดลอกด้วย `azcopy` ซึ่ง
รับ S3 เป็นต้นทางได้ตรง ๆ:

```bash
azcopy copy 'https://<minio-host>/bdi-uploads/*' \
            'https://<account>.blob.core.windows.net/bdi-uploads' --recursive
```

key ของ blob เหมือนกันทุกตัวอักษร จึงไม่ต้องแตะฐานข้อมูลเลยหลังคัดลอกเสร็จ

---

## 6. storage account จริง

สร้างเมื่อ **2026-09-07** ด้วย `az cli` บน subscription ที่ล็อกอินอยู่บนเครื่องพัฒนา

| | |
| --- | --- |
| Subscription | `Azure subscription 1` · `b1f2fd2e-e3d5-4526-8d1d-ae45a4fbb0b9` (tenant `thammasornhoutlook.onmicrosoft.com`) |
| Resource group | `bdi-datahub` |
| Storage account | `bdidatahub` · StorageV2 · Standard_LRS · southeastasia |
| Blob endpoint | `https://bdidatahub.blob.core.windows.net` |
| Container | `bdi-uploads` · private |
| ความปลอดภัย | HTTPS only · TLS 1.2 ขั้นต่ำ · `allowBlobPublicAccess=false` |
| ตาข่าย | soft delete 30 วัน + blob versioning **เปิดแล้ว** (ไม่ต้องแก้โค้ด) |

```bash
az group create -n bdi-datahub -l southeastasia
az storage account create -n bdidatahub -g bdi-datahub -l southeastasia \
  --sku Standard_LRS --kind StorageV2 \
  --https-only true --min-tls-version TLS1_2 --allow-blob-public-access false
az storage container create --account-name bdidatahub -n bdi-uploads --auth-mode login
az storage account blob-service-properties update -n bdidatahub -g bdi-datahub \
  --enable-delete-retention true --delete-retention-days 30 --enable-versioning true
```

**Owner บน subscription ไม่ได้แปลว่าอ่านข้อมูลใน blob ได้** สิทธิ์ระดับข้อมูลเป็นคนละชั้นกับ
สิทธิ์ระดับ control plane ต้องมอบ role แยกก่อนถึงจะใช้ `--auth-mode login` ได้:

```bash
az role assignment create --assignee <upn-หรือ-object-id> \
  --role "Storage Blob Data Contributor" \
  --scope $(az storage account show -n bdidatahub -g bdi-datahub --query id -o tsv)
```

ไม่มี role นั้นก็ยังใช้ `--auth-mode key --account-key $(az storage account keys list …)` ได้

### 6.1 ที่ทดสอบไปแล้วกับของจริง (2026-09-07)

รันบน checkout `dev_20260824_migrate-to-azure` ที่ตั้ง `AZURE_STORAGE_CONNECTION_STRING`
ชี้ไป `bdidatahub` โดย **ไม่ได้สตาร์ต Azurite ให้ backend ใช้เลย**

- `GET /health/ready` → `{"database":"up","storage":"up"}`
- `npm run typecheck` ผ่าน
- `seed:masters` อัปโหลด template `.docx` ห้าฉบับและ render กลับมาเป็น PDF ได้ครบ —
  11 blob อยู่ใน container จริง ทั้งขาเขียนและขาอ่านเป็น Buffer
- `seed:demo` ผ่าน
- **ขับเบราว์เซอร์จริง** เข้าสู่ระบบเป็น `user@nso.go.th` (รหัสผ่าน + OTP) → เปิดคำขอ
  `DS-REG-2026-0001` → อัปโหลดพจนานุกรมข้อมูล `.csv` → blob โผล่ที่
  `dev/dataset-registration-request/<id>/data-dictionary/<attachment-id>/document.csv`
  ขนาด 229 ไบต์ `text/csv` → โหลดกลับมา **sha256 ตรงกันทุกไบต์** พร้อม
  `Content-Disposition: inline; filename*=UTF-8''data-dictionary-sit.csv` → กด
  “ตรวจสอบคำขอ” ได้ A4 ขนาด 64,148 ไบต์ ขึ้นต้นด้วย `%PDF` สตรีมเข้า `<iframe>` สำเร็จ
  และปุ่ม “นำส่งคำขอ” ปลดล็อก · ไม่มี console error และไม่มี HTTP ≥ 400

## 7. ที่ยังค้าง

- [ ] **เส้นทาง `AZURE_STORAGE_ACCOUNT_URL` + `DefaultAzureCredential` (§3.1) ยังไม่ได้ยืนยัน**
      ที่ทดสอบข้างบนทั้งหมดเดินผ่าน connection string เพราะเครื่องพัฒนาไม่มี managed identity
      และใน container ก็ไม่มี `az` ให้ `AzureCliCredential` ทำงาน วิธียืนยันโดยไม่ต้องรอ ACA
      คือสร้าง service principal แล้วส่ง `AZURE_TENANT_ID` / `AZURE_CLIENT_ID` /
      `AZURE_CLIENT_SECRET` เข้า container — `EnvironmentCredential` จะหยิบไปใช้ แล้วเดิน
      `BlobServiceClient(url, TokenCredential)` เส้นเดียวกับ managed identity เป๊ะ
      ต่างแค่แหล่งที่มาของตัวตน:

      ```bash
      az ad sp create-for-rbac -n bdi-datahub-dev \
        --role "Storage Blob Data Contributor" \
        --scopes $(az storage account show -n bdidatahub -g bdi-datahub --query id -o tsv)
      ```

- [ ] subscription ที่ใช้อยู่ผูกกับบัญชี outlook.com ส่วนตัว ไม่ใช่ tenant ขององค์กร
      ถ้าระบบจะขึ้นจริงต้องย้ายไป subscription ขององค์กร ซึ่งก็คือทำ §6 ซ้ำอีกรอบ
- [ ] การ deploy ยังเป็น docker compose บนเครื่องเดียว การ์ดชื่อ “Migrate to Azure” แต่
      ขอบเขตที่เขียนไว้บนการ์ดคือ storage อย่างเดียว — ย้าย compute ไป Azure Container Apps
      เป็นงานคนละใบ
