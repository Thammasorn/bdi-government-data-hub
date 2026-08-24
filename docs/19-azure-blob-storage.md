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

## 6. ที่ยังค้าง

- [ ] ยังไม่ได้ยิงกับ storage account จริงสักครั้ง — ทดสอบทั้งหมดรันบน Azurite
      เส้นทาง `DefaultAzureCredential` (§3.1) จึงยังไม่มีการยืนยันจากของจริง
      ต้องรอ subscription / resource group ของโครงการก่อน
- [ ] ยังไม่มีคำตอบว่า storage account จะอยู่ region ไหนและใครเป็นเจ้าของ subscription
- [ ] soft delete / versioning ของ Azure ยังไม่ได้เปิด ระบบพึ่ง `status = REPLACED` ในฐานข้อมูล
      อย่างเดียวเหมือนเดิม ถ้าเปิด soft delete จะได้ตาข่ายอีกชั้นโดยไม่ต้องแก้โค้ด
- [ ] การ deploy ยังเป็น docker compose บนเครื่องเดียว การ์ดชื่อ “Migrate to Azure” แต่
      ขอบเขตที่เขียนไว้บนการ์ดคือ storage อย่างเดียว — ย้าย compute ไป Azure Container Apps
      เป็นงานคนละใบ
