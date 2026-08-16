# แผนการพัฒนา — Dataset Registration (Journey C)

เอกสารนี้แปลง [`01-user-journey.md` §4](01-user-journey.md) ให้เป็นรายการงานที่ลงมือทำได้
โครงสร้างทุกอย่างเดินตามของเดิมใน Journey B (`organizations.ts`) เพื่อให้คนที่อ่านโค้ดฝั่งหน่วยงาน
เข้าใจฝั่งชุดข้อมูลได้ทันทีโดยไม่ต้องเรียนรู้แบบแผนใหม่

> **§1 เป็นแผนตอนก่อนย้ายมาใช้สคีมาจาก Excel — ไม่ใช่สิ่งที่มีอยู่จริงแล้ว**
> enum และ model ในหัวข้อนั้นถูกแทนด้วยดีไซน์ใน `assets/db_schema/` ตั้งแต่ migration
> baseline (สถานะเหลือเจ็ดค่าใน `RequestStatus` ด่านอยู่ที่ `review.review_task`
> และ event table ถูกตัดออก) ส่วน **ช่อง metadata ทั้งชุดถูกแทนที่อีกครั้งเมื่อ 2026-08-16**
> ตามชีท `A4_dataset_metadata` — อ่าน [`11-metadata-registration-form.md`](11-metadata-registration-form.md)
> แทนสำหรับทุกเรื่องที่เกี่ยวกับช่องในแบบฟอร์ม รหัส และเงื่อนไข
> §2 (endpoint) และ §3 (หน้าจอ) ยังใช้ได้อยู่

---

## 1. ฐานข้อมูล

เพิ่มใน `backend/prisma/schema.prisma` — ไม่แก้ตารางเดิม มีแต่เพิ่มความสัมพันธ์ย้อนกลับบน `User`
และ `Organization`

### 1.1 enum

| enum | ค่า |
| --- | --- |
| `DatasetRequestStatus` | `DRAFT` · `PENDING_OFFICER_REVIEW` · `PENDING_ORG_APPROVER` · `PENDING_OFFICER_FINAL_CHECK` · `PENDING_BDI_APPROVAL` · `NEEDS_REVISION` · `APPROVED` · `REJECTED` |
| `DatasetRequestEventType` | `CREATED` · `SUBMITTED` · `SPECIALIST_ASSIGNED` · `SPECIALIST_UNASSIGNED` · `SPECIALIST_COMMENTED` · `OFFICER_FORWARDED` · `OFFICER_REVISION_REQUESTED` · `ORG_APPROVER_SIGNED` · `ORG_APPROVER_REVISION_REQUESTED` · `OFFICER_CONFIRMED` · `OFFICER_FINAL_REVISION_REQUESTED` · `BDI_APPROVED` · `BDI_REJECTED` · `BDI_REVISION_REQUESTED` |
| `DatasetAttachmentKind` | `DATA_DICTIONARY` · `EXAMPLE_DATA` · `GENERATED_FORM` |
| `DatasetType` | `RECORD` · `STATISTIC` · `GEOGRAPHIC` · `MULTIMEDIA` · `OTHER` |
| `UpdateFrequency` | `REAL_TIME` · `DAILY` · `WEEKLY` · `MONTHLY` · `QUARTERLY` · `BIANNUAL` · `YEARLY` · `AS_NEEDED` |
| `GeoCoverage` | `NATIONAL` · `REGIONAL` · `PROVINCIAL` · `DISTRICT` · `OTHER` |
| `DeliveryMethod` | `API` · `SFTP` · `DATABASE` · `FILE_UPLOAD` · `OTHER` |
| `DataFormat` | `CSV` · `JSON` · `XLSX` · `XML` · `PARQUET` · `SHAPEFILE` · `OTHER` |
| `DataClassification` | `PUBLIC` · `INTERNAL` · `CONFIDENTIAL` · `SECRET` |
| `LicenseType` | `OPEN_GOVERNMENT` · `CC_BY` · `CC_BY_SA` · `CC_BY_NC` · `INTERNAL_ONLY` · `OTHER` |
| `NotificationType` | ชนิดของ in-app notification (คู่กับอีเมลแต่ละฉบับ) |
| `ActivityAction` | `CREATE` · `UPDATE` · `SUBMIT` · `REVIEW` · `APPROVE` · `REJECT` · `RETURN_FOR_REVISION` · `ASSIGN` · `DELETE` · `DOWNLOAD` |

### 1.2 model

- **`DatasetRequest`** — ฟิลด์ตามตารางใน §4.3 ทั้งสามส่วน + `requestNumber` (unique) ·
  `status` · `organizationId` · `createdById` · `assignedSpecialistId` · `revisionNote` ·
  `submittedAt` · `orgApproverSignedAt/ById` · `approvedAt/ById` · `rejectedAt/ById` ·
  `rejectionReason` · `legalAcceptedAt/ById`
  ฟิลด์ทุกช่องเป็น optional ในระดับฐานข้อมูล เพราะร่างเก็บได้ทั้งที่ยังไม่ครบ —
  ความครบถ้วนบังคับตอน submit ด้วย zod (แบบเดียวกับ `draftSchema` / `submitSchema` ของหน่วยงาน)
- **`DatasetAttachment`** — เหมือน `Attachment` แต่ผูกกับคำขอ และ kind คนละชุด
- **`DatasetRequestEvent`** — timeline ที่ผู้ใช้เห็น (actor, from, to, note)
- **`Notification`** — `userId` · `type` · `title` · `body` · `link` · `readAt`
- **`ActivityLog`** — audit ตาม §4.9 เก็บ `before`/`after` เป็น `Json?`

### 1.3 migration

```bash
docker compose exec backend npm run prisma:migrate -- --name dataset_registration
```

---

## 2. Backend

| ไฟล์ | สิ่งที่ทำ |
| --- | --- |
| `src/lib/dataset.ts` | label ภาษาไทยของทุก enum, zod schema ของร่าง/นำส่ง, ตัวช่วยออกเลขที่คำขอ |
| `src/routes/dataset-requests.ts` | **state machine ทั้งเส้นทางอยู่ในไฟล์นี้ไฟล์เดียว** |
| `src/routes/notifications.ts` | list / mark read / mark all read |
| `src/lib/activity.ts` | `logActivity()` — เขียน `ActivityLog` พร้อม IP และ diff |
| `src/lib/notify.ts` | สร้าง notification หลายคนพร้อมกัน + หา stakeholders ของคำขอ |
| `src/lib/mail.ts` | เพิ่มอีเมลฉบับที่ 8–15 ใช้ `layout()` เดิม |
| `src/lib/pdf.ts` | `renderDatasetRegistrationForm()` ใช้ helper เดิม (`section`, `rows`, `ensureSpace`) |
| `src/index.ts` | mount `/api/dataset-requests` และ `/api/notifications` |
| `src/scripts/seed-demo.ts` | เพิ่มบัญชี specialist + คำขอตัวอย่างครบทุกสถานะ |

### 2.1 endpoint

| method | path | ใคร | ทำอะไร |
| --- | --- | --- | --- |
| `GET` | `/api/dataset-requests` | ทุก role (ขอบเขตตาม §4.7) | รายการ + filter สถานะ + ค้นหา |
| `POST` | `/api/dataset-requests` | `ORG_USER` | สร้างร่าง (ตรวจ pre-requisite §4.1) |
| `GET` | `/api/dataset-requests/:id` | ผู้ที่เห็นได้ | รายละเอียด + attachments + events |
| `PATCH` | `/api/dataset-requests/:id` | `ORG_USER` ในหน่วยงาน | บันทึกร่าง (เฉพาะ `DRAFT` / `NEEDS_REVISION`) |
| `POST` | `/api/dataset-requests/:id/attachments` | `ORG_USER` ในหน่วยงาน | อัปโหลด data dictionary / example data |
| `GET` | `/api/dataset-requests/:id/attachments/:attachmentId` | ผู้ที่เห็นได้ | สตรีมไฟล์จาก MinIO |
| `POST` | `/api/dataset-requests/:id/generate-form` | `ORG_USER` ในหน่วยงาน | validate ครบชุด แล้วสร้าง PDF |
| `POST` | `/api/dataset-requests/:id/submit` | `ORG_USER` ในหน่วยงาน | นำส่ง → `PENDING_OFFICER_REVIEW` |
| `POST` | `/api/dataset-requests/:id/review` | ตามสถานะปัจจุบัน | **จุดตัดสินใจเดียวของทุกด่าน** |
| `POST` | `/api/dataset-requests/:id/assign` | `BDI_OFFICER` | assign / ถอน data specialist |
| `GET` | `/api/dataset-requests/specialists` | `BDI_OFFICER` | รายชื่อ `BDI_DATASET_SPECIALIST` ที่ `ACTIVE` |
| `GET` | `/api/notifications` | ทุกคนที่ล็อกอิน | 20 รายการล่าสุด + จำนวนที่ยังไม่อ่าน |
| `POST` | `/api/notifications/:id/read`, `/api/notifications/read-all` | เจ้าของ notification | ทำเครื่องหมายว่าอ่านแล้ว |

### 2.2 `POST /:id/review` — action ที่รับได้

ทำตามแบบเดียวกับ `organizations.ts`: **สิทธิ์ตัดสินจากสถานะปัจจุบันของคำขอ ไม่ใช่จาก path**

| สถานะปัจจุบัน | ใครทำได้ | action | สถานะถัดไป |
| --- | --- | --- | --- |
| `PENDING_OFFICER_REVIEW` | `BDI_OFFICER` | `forward` | `PENDING_ORG_APPROVER` |
| | | `request_revision` | `NEEDS_REVISION` |
| | specialist ที่ถูก assign | `comment` | *(ไม่เปลี่ยนสถานะ)* |
| | | `request_revision` | `NEEDS_REVISION` |
| `PENDING_ORG_APPROVER` | ผู้มีอำนาจของหน่วยงาน | `approve` (ลงนาม) | `PENDING_OFFICER_FINAL_CHECK` |
| | | `request_revision` | `NEEDS_REVISION` |
| `PENDING_OFFICER_FINAL_CHECK` | `BDI_OFFICER` | `confirm` | `PENDING_BDI_APPROVAL` |
| | | `request_revision` | `NEEDS_REVISION` |
| `BDI_FINAL_APPROVAL` | `BDI_FINAL_APPROVER` | `approve` | `APPROVED` (+ สร้าง PDF ฉบับอนุมัติ) |
| | | `reject` | `REJECTED` |
| | | `request_revision` | `NEEDS_REVISION` |

`request_revision` และ `reject` บังคับ `note` ≥ 10 ตัวอักษร ทุกกรณี

---

## 3. Frontend

| เส้นทาง | หน้า |
| --- | --- |
| `/datasets` | รายการคำขอของหน่วยงานตนเอง + ปุ่มสร้าง |
| `/datasets/[id]` | รายละเอียด + timeline + ปุ่มตามสิทธิ์ |
| `/datasets/[id]/edit` | ฟอร์ม 4 ส่วน + stepper (โครงเดียวกับฟอร์มหน่วยงาน) |
| `/datasets/[id]/preview` | ตรวจ PDF ก่อนนำส่ง |
| `/admin/datasets` | รายการทั้งระบบสำหรับเจ้าหน้าที่ BDI (specialist เห็นเฉพาะที่ถูก assign) |
| `/admin/datasets/[id]` | หน้าตรวจสอบของฝั่ง BDI |

- `components/dataset/DetailView.tsx` ใช้ร่วมกันทั้งสองฝั่ง ต่างกันแค่ `backHref`
  (แบบเดียวกับ `components/organization/DetailView.tsx`)
- `components/NotificationBell.tsx` วางใน header ของ `AppShell`
- เมนู header เพิ่ม **ชุดข้อมูล** ให้ทั้งฝั่งหน่วยงานและฝั่ง BDI
- หน้ารายละเอียดหน่วยงานเพิ่มการ์ด **ลงทะเบียนชุดข้อมูล** — ปุ่ม disabled พร้อมเหตุผล
  เมื่อ pre-requisite ยังไม่ครบ (§4.1)
- `lib/status.ts` เพิ่ม `DATASET_STATUS_META` และ `DATASET_EVENT_LABELS`
  `lib/types.ts` เพิ่ม type ของคำขอ

---

## 4. การตรวจสอบ

ไม่มี test framework ในโปรเจกต์นี้ (ดู `CLAUDE.md`) จึงตรวจด้วยสามอย่างเดิม

1. `docker compose exec backend npm run typecheck` และ `frontend npx tsc --noEmit`
2. production build: `docker compose -f docker-compose.yml -f docker-compose.prod.yml build`
3. ขับ flow จริงผ่าน API ตั้งแต่สร้างร่าง → นำส่ง → ผ่านทั้งสี่ด่าน → ได้ PDF ฉบับอนุมัติ
   และตรวจว่า `DatasetRequestEvent`, `Notification`, `ActivityLog` ถูกเขียนครบทุกขั้น
