# แผนการย้ายฐานข้อมูล — draft_db_design (2026-08-11)

ต้นทาง: `assets/db_schema/draft_db_design_downloaded_on_2026-08-11.xlsx`
(21 sheet — `_index` + 20 ตาราง + ภาพประกอบฝังในแต่ละ sheet)

เอกสารนี้เทียบสคีมาที่ออกแบบไว้กับสคีมาที่ใช้งานจริงใน `backend/prisma/schema.prisma`
แล้วแปลงส่วนต่างเป็นลำดับงานที่ลงมือทำได้ พร้อมระบุ **สิ่งที่ยังตอบไม่ได้ถ้าไม่ถามเจ้าของสเปก**

`docs/01-user-journey.md` §6 ข้อ 11 คาดการณ์การย้ายครั้งนี้ไว้แล้ว — เอกสารนั้นเขียนว่า
ER-diagram ใน Notion "วางไว้เป็นภาพรวมของเฟสถัดไป" และเฟสก่อนหน้าเลือกทำตามโครงเดิม
เพื่อไม่ต้องรื้อของที่ใช้อยู่ **เฟสนี้คือการรื้อนั้น**

---

## 1. สรุปผู้บริหาร

**นี่ไม่ใช่ ALTER TABLE — เป็นการเปลี่ยนสคีมาทั้งชุดพร้อมเขียน business logic ใหม่**

เหตุผลสามข้อ:

1. **Workflow engine เปลี่ยนแนวคิด** ปัจจุบัน "ขั้นตอนที่คำขออยู่" ถูกเข้ารหัสไว้ใน `status`
   เอง (`PENDING_OFFICER_REVIEW`, `PENDING_ORG_APPROVER`, `PENDING_OFFICER_FINAL_CHECK`, …)
   ในแบบใหม่ `status` เหลือแค่หยาบ ๆ 7 ค่า (`DRAFT`/`SUBMITTED`/`UNDER_REVIEW`/`RETURNED`/
   `APPROVED`/`REJECTED`/`CANCELLED`) แล้วย้าย "อยู่ด่านไหน ใครถือ" ไปไว้ที่ `review.review_task`
   → `decide()` ใน `dataset-requests.ts` และ state machine ใน `organizations.ts` ต้องเขียนใหม่ทั้งคู่
2. **Auth model เปลี่ยน** แบบใหม่ไม่มี password และไม่มี OTP — มี `iam.activation_key`
   กับ `user_account.external_subject` (ThaID) แทน `Invitation` + `OtpCode`
3. **10 ตารางไม่มีของเดิมให้ย้าย** (`review_task`, `legal_*` 3 ตาราง, `signature_confirmation`,
   `dataset`, `dataset_metadata`, `notification_delivery`, `integration_operation`,
   `activation_key`) — เป็นการ**สร้างฟีเจอร์ใหม่** ไม่ใช่ย้ายข้อมูล

**ข้อมูลใน `main` ทิ้งได้** — ตรวจแล้วมี users=14 orgs=7 dataset_requests=10 attachments=30
ทั้งหมดเป็น fixture จาก `seed:demo` กับข้อมูล SIT ที่สร้างซ้ำได้
→ **แนะนำให้ rebuild ไม่ต้อง backfill** เขียน `seed-demo.ts` ใหม่ให้ผลิต fixture ชุดเดิมบนสคีมาใหม่
สคริปต์ backfill (§7) ทำไว้เผื่อกรณีทีมยืนยันว่าข้อมูล SIT ต้องอยู่ต่อเท่านั้น

**ขนาดงานโดยประมาณ** backend ~5,100 บรรทัด แตะเกือบทุกไฟล์ · frontend ~6,100 บรรทัด
แตะ `lib/types.ts`, `lib/status.ts` และทุก DetailView · แบ่งเป็น 9 เฟส (§6) เดินทีละเฟสได้
โดยระบบยัง typecheck ผ่านและ demo ได้ทุกจุดตัด

### 1.1 ข้อตัดสินใจที่ยืนยันแล้ว (2026-08-11)

สามข้อนี้ตัดสินแล้ว ไม่ต้องถามซ้ำ — ที่เหลือใน §5 ยังเปิดอยู่

| # | เรื่อง | มติ |
| --- | --- | --- |
| 1 | **ขอบเขต** | ทำครบทั้ง 20 ตาราง แต่แบ่งเป็นเฟสตาม §6 — เฟสท้าย (legal, signature, integration) เลื่อนได้โดยไม่ต้องรื้อเฟสต้น |
| 2 | **ข้อมูล** | **rebuild ไม่ backfill** — squash เป็น baseline migration เดียว แล้วเขียน `seed-demo.ts` ใหม่ · §7 เหลือไว้เป็น fallback ที่ไม่ได้ตั้งใจใช้ |
| 3 | **auth** | เก็บ `password_hash` และ `iam.otp_code` ต่อ เป็น **ส่วนขยายที่จงใจเพิ่มจากดีไซน์** · `cid` และ `external_subject` ทำเป็น nullable ไปก่อน → §5 ข้อ 1–3 ปิดแล้ว |

---

## 2. สคีมาปลายทาง

20 ตารางใน 11 PostgreSQL schema (ภาพ "5. Schema Overview" ใน sheet `_index`)

| Schema | ตาราง | มีของเดิมไหม |
| --- | --- | --- |
| `iam` | `user_account` · `role` · `activation_key` · `user_role_assignment` | บางส่วน (`users`) |
| `organization` | `organization` · `organization_registration_request` | บางส่วน (`organizations`) |
| `dataset` | `dataset_registration_request` · `dataset_registration_metadata` · `dataset` · `dataset_metadata` | บางส่วน (`dataset_requests`) |
| `review` | `review_task` | **ไม่มี** |
| `legal` | `legal_document` · `legal_document_version` · `legal_acceptance` | **ไม่มี** |
| `signature` | `signature_confirmation` | **ไม่มี** |
| `attachment` | `attachment` | บางส่วน (2 ตารางแยก) |
| `notification` | `notification` · `notification_delivery` | บางส่วน (`notifications`) |
| `integration` | `integration_operation` | **ไม่มี** |
| `audit` | `audit_event` | บางส่วน (`activity_logs`) |
| `administration` | — (มีใน overview ยังไม่มี sheet) | — |

`_index` ยังอ้างถึง schema `data_request` (Journey D) ที่ยังไม่มี sheet แต่ค่า
`DATASET_REQUEST` โผล่ใน `owner_type` / `subject_type` / `application_scope` ของหลายตารางแล้ว
→ ออกแบบ polymorphic column ให้รองรับได้ตั้งแต่ตอนนี้ แต่ยังไม่สร้างตาราง

---

## 3. Gap analysis รายตาราง

### 3.1 `iam.user_account` ← `users`

| แบบใหม่ | ของเดิม | หมายเหตุ |
| --- | --- | --- |
| `cid` **Required** | ไม่มี (มีแต่ `Organization.signatoryNationalId`) | **backfill ไม่ได้** — ดู §5 ข้อ 1 |
| `external_subject` **Required** | ไม่มี | **backfill ไม่ได้** — ดู §5 ข้อ 2 |
| `prefix_th`/`firstname_th`/`lastname_th` | `prefix`/`firstName`/`lastName` | rename ตรง ๆ |
| `display_name` Required | ไม่มี | derive จากชื่อ-สกุล |
| `account_type` (ORGANIZATION/BDI/SYSTEM) | ไม่มี | derive จาก role |
| `status` PENDING/ACTIVE/SUSPENDED/DEACTIVATED | INVITED/ACTIVE/SUSPENDED | `INVITED`→`PENDING`, เพิ่ม `DEACTIVATED` |
| `department_th`/`position_th` | มีบน `Organization.contact*` | ย้ายมาที่ user |
| — | `passwordHash` | **แบบใหม่ไม่มีที่เก็บ** — ดู §5 ข้อ 3 |
| — | `organizationId` | ย้ายไป `user_role_assignment.organization_id` |
| — | `roles: Role[]` | ย้ายไป `user_role_assignment` |
| — | `emailVerifiedAt` | ไม่มีที่เก็บ (`activated_at` ใกล้เคียงที่สุด) |

`suspended_by` / `created_by` / `updated_by` เป็น UUID actor ทุกตาราง — ของเดิมมีเฉพาะ
`createdById` บาง entity เท่านั้น ต้องเพิ่มทั้งชุด

**เพิ่มเมื่อ 2026-08-17 — `cid` เป็น unique** sheet ไม่ได้บอกไว้ แต่ไปเจอว่าฐานข้อมูลของ `main`
มี `UNIQUE CONSTRAINT` บน `cid` ที่ไม่มี migration ไหนสร้าง (ใครเพิ่มด้วยมือ) ทำให้ `main` ตอบ
500 จาก P2002 ในเคสที่ checkout อื่นตอบ 201 — ตัดสินว่า **หนึ่งเลขบัตร = หนึ่งบัญชี** ตามที่
constraint นั้นบังคับไว้ แล้วย้ายกฎเข้ามาอยู่ใน `schema.prisma` + migration
`20260817153500_user_account_cid_unique` (ลบตัวที่เพิ่มด้วยมือทิ้งก่อนสร้างใหม่ ทุกฐานข้อมูล
จึงเหมือนกันและไม่มี drift) ค่า `NULL` ยังซ้ำได้ตามปกติของ Postgres จึงไม่กระทบบัญชี BDI
ที่ยังไม่มีเลขบัตรตาม §5 ข้อ 1

### 3.2 `iam.role` + `iam.user_role_assignment` ← `User.roles: Role[]`

role กลายเป็นตาราง master พร้อม `is_active` และรหัสเปลี่ยนสองตัว:

| ของเดิม | แบบใหม่ |
| --- | --- |
| `BDI_OFFICER` | `BDI_OFFICER` |
| `BDI_APPROVER` | **`BDI_FINAL_APPROVER`** |
| `BDI_SPECIALIST` | **`BDI_DATASET_SPECIALIST`** |
| `ORGANIZATION_USER` | `ORGANIZATION_USER` |
| `ORGANIZATION_APPROVER` | `ORGANIZATION_APPROVER` |
| — | **`BDI_LEGAL_OFFICER`** (ใหม่ — เจ้าของ `legal_document`) |
| — | **`SYSTEM_ADMINISTRATOR`** (ใหม่ — ออก activation key) |

`user_role_assignment` มี `effective_from`/`effective_until`/`status` + derived `EXPIRED`
→ **`requireAuth` ใน `middleware/auth.ts` ต้องเปลี่ยนจากอ่าน `user.roles` เป็น join**
พร้อมเงื่อนไข `status='ACTIVE' AND (effective_until IS NULL OR effective_until > now())`
ตามที่ sheet เขียนไว้ กฎ "cookie บอกได้แค่ว่าใคร" ใน `main/CLAUDE.md` ยังคงเดิม — แค่แหล่งข้อมูลย้าย

### 3.3 `iam.activation_key` ← `Invitation` + `OtpCode`

- `key_hash` = **HMAC-SHA-256(server_secret, raw_key)** — ของเดิมใช้ SHA-256 เปล่า
  (เหตุผลที่เลือก SHA-256 ใน `main/CLAUDE.md` ยังใช้ได้: lookup by value, 32 random bytes)
  แบบใหม่แค่เติม server secret เข้าไป → ต้องเพิ่ม env var
- unique partial index: `(user_account_id, organization_id, role_id) WHERE status='ISSUED'`
- lifecycle 8 ขั้นใน sheet จบที่ ThaID verify — **ไม่มี OTP** ดู §5 ข้อ 3
- `Invitation` ของเดิมผูกกับ *อีเมล* แบบใหม่ผูกกับ *user_account ที่สร้างไว้ล่วงหน้าแล้ว*
  → `POST /api/admin/invitations` เปลี่ยน contract: สร้าง `user_account` (PENDING) ก่อน แล้วค่อยออก key

### 3.4 `organization.organization` ← `organizations`

แยกเป็นสองตารางชัดเจน: **`organization` เก็บสถานะปัจจุบัน · `organization_registration_request`
เก็บ snapshot ของคำขอ** ของเดิมยัดรวมไว้ในตารางเดียว

- ฟิลด์ `signatory*` (7 ช่อง) และ `contact*` (7 ช่อง) บน `organizations`
  → ย้ายไป `org_registration_request.approver_*` / `user_*` (snapshot)
  และไปเป็น `user_account` จริงสองแถว
- `status` เหลือ `PENDING_REGISTRATION`/`ACTIVE`/`SUSPENDED`/`INACTIVE`
- ที่อยู่เปลี่ยนจาก **ชื่อ** เป็น **รหัส**: `province`→`province_code`, `district`→`district_code`,
  `subdistrict`→`sub_district_code` → map ผ่าน `backend/src/data/thai-address.json` ได้
  แต่ **ยังไม่มีตาราง master ของ province/district/tambon ใน design** (อยู่ใน schema
  `administration` ที่ยังไม่มี sheet) ดู §5 ข้อ 6
- `organization_code` **Required** — sheet เขียนคำถามไว้เอง *"ปรึกษาพี่แก้ว มีรหัสหน่วยงานไหม ??"*
  ดู §5 ข้อ 4
- `parent_organization_id` ใหม่ (hierarchy) — ไม่มีของเดิม ปล่อย NULL ได้

### 3.5 `review.review_task` — ตารางแกนกลางของงานนี้

ไม่มีของเดิม แต่กลืน 3 อย่างเข้ามา: state machine ทั้งสองเส้นทาง, `assignedSpecialistId`,
และ `revisionNote`

`task_type`: `BDI_OFFICER_REVIEW` · `DATASET_SPECIALIST_REVIEW` · `ORGANIZATION_APPROVAL` ·
`BDI_FINAL_APPROVEAL` *(สะกดผิดใน sheet — ดู §5 ข้อ 12)* · `ORGANIZATION_REVISION`

`result` ที่อนุญาตต่อ `task_type` (จากภาพใน sheet `review_task`):

| task_type | result ที่ใช้ได้ |
| --- | --- |
| `BDI_OFFICER_REVIEW` | PASSED · RETURNED · REJECTED · CONFIRMED |
| `DATASET_SPECIALIST_REVIEW` | PASSED · RETURNED · REJECTED · CONFIRMED |
| `ORGANIZATION_APPROVAL` | APPROVED · RETURNED · REJECTED |
| `BDI_FINAL_APPROVAL` | APPROVED · RETURNED · REJECTED |
| `ORGANIZATION_REVISION` | COMPLETED หรือ CONFIRMED |

**`round_number` คือคำตอบของ Final Check** — `PENDING_OFFICER_FINAL_CHECK` ของเดิม
ไม่มี `task_type` ของตัวเองในแบบใหม่ ให้ใช้ `BDI_OFFICER_REVIEW` + `round_number = 2`
+ `result = CONFIRMED` แทน

> **2026-08-30** — เอกสารนี้เป็นบันทึกของการย้ายสคีมาเมื่อ 2026-08-13 จึงเก็บข้อความข้างบน
> ไว้ตามเดิม แต่ **ด่าน Final Check ถูกยกเลิกไปแล้วทั้งหมด** (การ์ด *แก้ flow dataset
> registration*) เส้นทางชุดข้อมูลปัจจุบันไม่มีด่านเจ้าหน้าที่ BDI รอบสอง — ข้อความนี้ใช้
> อ่านย้อนหลังว่าข้อมูลเก่าถูกแปลงมาอย่างไรเท่านั้น ไม่ใช่กติกาที่ใช้อยู่

การ assign specialist ของเดิม (field เดียวบน request) เคยกลายเป็นการสร้าง
`DATASET_SPECIALIST_REVIEW` task — **กลับมาเป็น field บน request อีกครั้งเมื่อ 2026-08-30**
(`assigned_specialist_id`, การ์ด *Make Data Specialist Review Advisory*) เพราะการขอความเห็น
ไม่ใช่การย้ายด่าน และหนึ่งคำขอมี active task ได้ตัวเดียว ส่วน comment ยังเป็นแถวใน
`review_task` เหมือนเดิม (`result = CONFIRMED` · `comment_visibility = BDI_INTERNAL`)
แต่เป็นแถวที่ปิดตั้งแต่เกิด ไม่เคย active

### 3.6 `dataset.*` (4 ตาราง) ← `dataset_requests`

- `dataset_registration_request` ผอมลงมาก — metadata ทั้งหมดย้ายไป
  `dataset_registration_metadata` (1:1)
- **`dataset` + `dataset_metadata` เป็นของใหม่** — คำขอที่ `APPROVED` ต้อง materialize
  เป็นชุดข้อมูลจริง (`dataset_code`, `source_dataset_registration_request_id`)
  ปัจจุบันอนุมัติแล้วจบแค่ตรงนั้น ไม่มีตารางปลายทาง
- sheet เขียน `dataset.status` ไว้ว่า *"ไม่ได้คิดกรณีมีการ update ข้อมูล > ให้สร้างเป็นชุดใหม่ไปเลย"*
  → ไม่มี dataset versioning ในเฟสนี้ ตั้งใจแล้ว

**ฟิลด์ที่หายไปจากของเดิม** (มีใน `dataset_requests` ไม่มีใน `dataset_registration_metadata`):

`keywords[]` · `datasetType` · `estimatedRecords` · `licenseType` · `legalBasis` ·
`personalDataMeasure` · `usageRestriction` · `deliveryEndpoint` · `technicalContactName` ·
`technicalContactEmail` · `deliveryNote` · `deliveryFrequency`

12 ฟิลด์นี้ทั้งหมดมาจาก §4.3 ที่ `docs/01-user-journey.md` ทำเครื่องหมาย **[สมมติฐาน]** ไว้อยู่แล้ว
→ ยัดลง `additional_metadata_json` ได้ แต่จะ query ไม่ได้ (keywords ใช้ค้นหา) ดู §5 ข้อ 5

**ฟิลด์ที่เพิ่มมา**: `contains_sensitive_data` · `access_level` *(≠ `dataClassification` เดิม
คนละความหมาย)* · `data_owner_department` · `objective` · `title_en`/`description_en`

`metadata_json` บน `dataset_registration_request` มาร์ก Required แต่ note เขียนว่า
*"แยกอีกตาราง"* → **ตัดคอลัมน์นี้ทิ้ง** ขัดกันเอง

### 3.7 `attachment.attachment` ← `attachments` + `dataset_attachments`

รวมสองตารางเป็น polymorphic ตารางเดียว (`owner_type` + `owner_id`)

| แบบใหม่ | ของเดิม |
| --- | --- |
| `storage_bucket` + `storage_key` | `objectKey` (bucket มาจาก env) |
| `content_hash` **Required** | ไม่มี → ต้องคำนวณตอนย้าย |
| `file_size_bytes` BIGINT | `sizeBytes` Int |
| `status` ACTIVE/REPLACED/DELETED + `replaced_attachment_id` | ไม่มี — ของเดิม **ลบไฟล์เก่าทิ้ง** |
| `scan_status` + `scan_completed_at` + `scan_result_detail` | ไม่มี (sheet เขียนเอง *"น่าจะยังไม่มี"*) |
| `deleted_at`/`deleted_by`/`deletion_reason` | ไม่มี |

**storage key convention ใหม่** (ภาพใน sheet `attachment`):

```
{environment}/{owner_type}/{owner_id}/{attachment_type}/{attachment_id}/{stored_file_name}
```

ของเดิมคือ `organizations/{orgId}/{kind}/{uuid}` และ `dataset-requests/{reqId}/{kind}/{uuid}`
— ไม่มี environment prefix ไม่มีชื่อไฟล์ และ**ลบ object เดิมทิ้งตอนอัปโหลดทับ**
(`organizations.ts:329`, `dataset-requests.ts:465`) แบบใหม่ไม่ลบ เก็บเป็น `REPLACED`

**`attachment_type` ขาดสองค่า**: sheet ระบุแค่ 4 ค่า
(`AUTHORIZED_REPRESENTATIVE_APPOINTMENT_ORDER`, `POWER_OF_ATTORNEY`, `DATA_DICTIONARY`,
`EXAMPLE_DATA`) แต่ระบบยังต้องเก็บ (ก) PDF ที่ระบบ generate — ของเดิมคือ `GENERATED_FORM`
และ (ข) ไฟล์เอกสารกฎหมาย เพราะ `legal_document_version.attachment_id` ชี้มาที่ตารางนี้
ดู §5 ข้อ 7

### 3.8 `legal.*` (3 ตาราง) + `signature.signature_confirmation` — ของใหม่ทั้งหมด

ปัจจุบันการยอมรับเงื่อนไขคือสองคอลัมน์บน `DatasetRequest`
(`legalAcceptedAt` / `legalAcceptedById`) และการลงนามคือ `orgApproverSignedAt/ById/Name`

แบบใหม่เป็นระบบเต็ม: เอกสารมี version, hash, ต้อง re-accept เมื่อออก version ใหม่,
มี derived compliance status (`COMPLIANT` / `PENDING_ACCEPTANCE`) ที่**บล็อกการยื่นคำขอ**
และ `signature_confirmation` เก็บ snapshot payload + hash + IP + user agent
(ตัวอย่าง payload เต็มอยู่ในภาพ sheet `signature_confirmation`)

`organization.status` มี note *"TO REVIEW ตอนเพิ่ม legal doc versioning"* — เพราะ
หน่วยงานที่ ACTIVE อยู่แล้วอาจกลายเป็น non-compliant เมื่อ legal officer publish version ใหม่

### 3.9 `notification.*` + `integration.integration_operation`

- `notification` เพิ่ม `subject_type`/`subject_id`/`correlation_id`/`status`
  (ของเดิมใช้ `readAt` nullable + `link`) — `link` หายไป ให้ derive จาก subject
- **`notification_delivery` คือ outbox queue** — ปัจจุบัน `lib/mail.ts` ส่งอีเมลแบบ inline
  synchronous ในตัว request handler
  → ต้องมี worker + retry + dead letter **นี่คือการเปลี่ยน runtime architecture ไม่ใช่แค่สคีมา**
- `integration_operation` (THAID/JIRA/DII) — `docs/01-user-journey.md` §6 ข้อ 9, 10 บอกว่า
  ทั้งสองยัง `[Next Phase]` → **สร้างแค่ตาราง ยังไม่ต้องมี worker**

### 3.10 `audit.audit_event` ← `activity_logs`

| แบบใหม่ | ของเดิม |
| --- | --- |
| `actor_type` (USER/SYSTEM/EXTERNAL/ANONYMOUS) | ไม่มี |
| `action` — ~25 ค่าละเอียด (`ACTIVATION_KEY_REVOKED`, `LOGIN_FAILED`, …) | 10 ค่าหยาบ |
| `result` SUCCESS/FAILURE | ไม่มี |
| `correlation_id` **Required** | ไม่มี → ต้องมี request-scoped id ทั้งแอป |
| `source_component` **Required** | ไม่มี |
| `occurred_at` | `createdAt` |
| — | `actorName` · `actorRoles` · `actorOrganizationId` |

**ข้อควรระวัง**: `lib/activity.ts` คัดลอกชื่อ+role ของ actor ลงแถวโดยตั้งใจ เพื่อให้ log
ยังอ่านถูกแม้ผู้ใช้เปลี่ยนชื่อ (`main/CLAUDE.md` และ §4.9) แบบใหม่มีแค่ `actor_id`
→ ต้องเก็บ denormalized fields ต่อใน `metadata_json` มิฉะนั้นเสียคุณสมบัตินี้

### 3.11 ตารางที่หายไปเฉย ๆ

| ของเดิม | แบบใหม่มีไหม |
| --- | --- |
| `otp_codes` | **ไม่มี** — ดู §5 ข้อ 3 |
| `invitations` | แทนด้วย `activation_key` |
| `organization_events` | **ไม่มี** — timeline ต้อง derive จาก `review_task` + `audit_event` |
| `dataset_request_events` | **ไม่มี** — เหมือนกัน |

`main/CLAUDE.md` เขียนไว้ว่า *"UI timeline is rendered from those tables, so never mutate
`status` without recording the event"* — กฎนี้ต้องเขียนใหม่เป็น *"ทุก transition ต้องปิด
review_task และเขียน audit_event"* ดู §4 ข้อ 3

---

## 4. การตัดสินใจเชิงเทคนิค (ทีมตัดสินเองได้)

**1. multi-schema — ใช้** `previewFeatures = ["multiSchema"]` ของ Prisma 6
พร้อม `schemas = [...]` ใน datasource และ `@@schema("iam")` ต่อ model
ยังเป็น preview อยู่ ถ้าไม่อยากพึ่ง preview feature ให้ใช้ schema `public` ตารางเดียว
แล้วตั้งชื่อ `iam_user_account` แทน — เสียความตรงกับเอกสาร แต่ปลอดภัยกว่า
*แนะนำ: ใช้ multiSchema* เพราะเอกสารอ้าง `schema.table` ตลอดและ Prisma 6 stable พอ

**2. enum ของ Prisma vs VARCHAR** — sheet เขียน `VARCHAR` ทุกคอลัมน์สถานะ พร้อมลิสต์ค่าใน
คำอธิบาย ของเดิมใช้ Prisma enum (→ PG enum) ซึ่งได้ type safety แต่แก้ยาก
*แนะนำ: คง Prisma enum* สำหรับค่าที่นิ่ง (`status`, `task_type`, `result`) และใช้ `String`
เฉพาะที่ sheet ยังเขียน TO REVIEW (`document_type`, `organization_type`, `access_level`)

**3. เก็บ event table ไว้หรือไม่** — `review_task` ตอบได้แค่ "ใครถือด่านไหน ผลอะไร"
ตอบไม่ได้ว่า "ใครกดบันทึกร่างเมื่อไหร่" ซึ่ง timeline ปัจจุบันแสดงอยู่
*แนะนำ: ทิ้ง event table ตามดีไซน์ แล้ว render timeline จาก `review_task` UNION `audit_event`*
โดยเพิ่ม view `review.request_timeline` ให้ frontend อ่านหน้าตาเดิม — จุดที่ต้องระวังที่สุด
ในงานนี้เพราะ `audit_event` ออกแบบมาเพื่อไม่แสดงบนจอ (sanitized, internal)

**4. `correlation_id`** — บังคับทั้ง `audit_event`, `notification`, `notification_delivery`,
`integration_operation` → เพิ่ม express middleware ที่ออก UUID ต่อ request
แล้วส่งผ่าน `AsyncLocalStorage` (อย่าส่งเป็น argument ทุกชั้น)

**5. `created_by`/`updated_by` ทุกตาราง** — ใช้ Prisma extension (`$extends` query hook)
เติมอัตโนมัติจาก AsyncLocalStorage เดียวกัน อย่าเขียนมือ 20 ตาราง

**6. Circular FK สองคู่** ต้องรู้ตัวก่อนเขียน migration:
- `org_registration_request.authorized_representative_appointment_attachment_id`
  → `attachment.attachment.owner_id` → กลับมาที่ request
- `dataset_registration_request.created_dataset_id` ↔ `dataset.source_dataset_registration_request_id`

  แก้ด้วยการให้ฝั่งหนึ่ง nullable แล้ว UPDATE ทีหลังใน transaction เดียว
  (`attachment.owner_id` เป็น logical reference ไม่ใช่ FK จริงอยู่แล้วเพราะ polymorphic)

**7. ข้อมูล** — rebuild ผ่าน seed ใหม่ ไม่ backfill (§7 เป็น fallback)

---

## 5. คำถามที่ต้องได้คำตอบก่อน (blocker)

เรียงตามความรุนแรง — **ข้อ 1–3 ปิดแล้วด้วยมติ §1.1 ข้อ 3** เหลือข้อ 4 ที่บล็อกการเขียน schema
ข้อ 5+ บล็อกแค่บางเฟส

1. ~~**`user_account.cid` Required แต่ไม่มีข้อมูล**~~ — **ตัดสินแล้ว: nullable**
   แล้วบังคับที่ชั้น zod เฉพาะ `account_type='ORGANIZATION'`
   *ปรับปรุง 2026-08-13:* `POST /api/admin/invitations` บังคับ `cid` **ทุก role** แล้ว
   (การเทียบเลขบัตรกับ ThaID ต้องมีเลขตั้งต้น) คอลัมน์ยัง nullable เพราะบัญชีเก่ายังไม่มีค่า
   (เหตุผลเดิม: ปัจจุบันเก็บเลขบัตรเฉพาะของผู้มีอำนาจกระทำการแทน บน `Organization` ถ้าบังคับจริง
   คนของ BDI จะสมัครไม่ได้) — ยังควรแจ้งเจ้าของสเปกว่าเบี่ยงจากดีไซน์ตรงนี้

2. ~~**`external_subject` Required แต่ ThaID ยังไม่มี credentials**~~ — **ตัดสินแล้ว:
   nullable + unique**
   *ปรับปรุง 2026-08-13:* เชื่อม ThaID จริงแล้ว (`docs/07-thaid-integration.md`) บัญชีที่เปิด
   ใช้งานตั้งแต่นี้ไปจะมี `external_subject` = `sub` จาก id_token เสมอ ยังคง nullable ไว้
   เพราะบัญชีเก่าที่ seed มาก่อนหน้านี้ไม่มีค่า

3. ~~**แบบใหม่ไม่มี password และไม่มี OTP**~~ — **ตัดสินแล้ว: เก็บทั้งคู่ไว้เป็นส่วนขยาย**
   `iam.user_account.password_hash` และตาราง `iam.otp_code` อยู่ต่อ พร้อม doc comment ในสคีมา
   ว่า *"ไม่มีในดีไซน์ 2026-08-11 — เพิ่มไว้เพราะ ThaID ยังไม่มี client credentials
   และ §A.2 บังคับ 2FA"* เมื่อ ThaID พร้อมค่อยถอดออกทั้งชุด
   สเปกที่รองรับมติข้อนี้: `docs/01-user-journey.md` §A.2 *"ต้องมี two factor authen ด้วย
   email หรือ ThaID"* — ดีไซน์รองรับแค่ทางหลัง
   *ปรับปรุง 2026-08-13:* การ์ด **ThaID Integration** ยืนยันให้เก็บทั้งคู่ไว้ — Login Step
   เขียนไว้ตรง ๆ ว่า *"login โดยวิธี password + otp จาก email หรือจะผ่าน ThaID ก็ได้"*
   ทั้งสองอย่างจึงไม่ใช่ส่วนขยายชั่วคราวอีกต่อไป แต่ **ขั้นเปิดใช้งานบัญชีเลิกใช้ OTP แล้ว**
   ใช้ ThaID ทางเดียว

4. **`organization_code` Required — มีรหัสหน่วยงานจริงไหม?**
   sheet ถามคำถามนี้ไว้เอง (*"ปรึกษาพี่แก้ว มีรหัสหน่วยงานไหม ??"*) และเป็น unique key เชิงธุรกิจ
   ข้อมูล 7 หน่วยงานที่มีอยู่ไม่มีค่านี้
   → *ถ้าไม่ได้คำตอบ: generate `ORG-<ปี>-<ลำดับ>` แบบเดียวกับ `request_number` ไปก่อน*
   คำถามเดียวกันกับ `organization_type` (*"ต้องการเก็บประเภทหน่วยงานแบบไหนบ้าง ?"*)

5. **12 ฟิลด์ metadata ที่หายไป (§3.6) — ตัดจริงหรือลืม?**
   ทั้งชุดมาจาก §4.3 ที่ทำเครื่องหมาย [สมมติฐาน] ไว้ตั้งแต่ต้น และ §6 ข้อ 7 ขอให้เจ้าของสเปก
   *"ยืนยันหรือแทนที่ทั้งชุด"* — นี่คือการแทนที่ทั้งชุดหรือเปล่า?
   ที่ต้องถามชัดคือ **`keywords`** เพราะ UI ใช้ค้นหา ถ้ายัดลง JSONB จะค้นไม่ได้
   → *ถ้าไม่ได้คำตอบ: เก็บ `keywords` เป็นคอลัมน์จริง ที่เหลือลง `additional_metadata_json`*

6. **ตาราง master ที่อยู่** — design ใช้ `province_code`/`district_code`/`sub_district_code`
   แต่ schema `administration` ยังไม่มี sheet และ `main/CLAUDE.md` เขียนชัดว่า
   `thai-address.json` vendored ไว้โดยตั้งใจ (ห้ามเอา npm package กลับมา)
   → *แนะนำ: seed `administration.province/district/sub_district` จาก `thai-address.json`
     ตัวเดิม ไม่เพิ่ม dependency*

7. **`attachment_type` ขาด `GENERATED_FORM` และประเภทเอกสารกฎหมาย** (§3.7)
   → *ถ้าไม่ได้คำตอบ: เพิ่ม `GENERATED_FORM` และ `LEGAL_DOCUMENT` เข้าไปเอง*

8. **`review_task.assigned_user_id` Required — แล้ว "รอ BDI Officer ทุกคน" ล่ะ?**
   §4.4 เขียนว่า *"BDI Officer ทุกคนเห็นคำขอทั้งหมดในระบบ"* ใครว่างก่อนหยิบก่อน
   ถ้าบังคับต้องมีผู้รับมอบหมายคนเดียว ต้องเปลี่ยน UX เป็น assign ก่อนถึงจะตรวจได้
   → *ถ้าไม่ได้คำตอบ: nullable ตอน PENDING แล้วเซ็ตตอนคนแรกกด "เริ่มตรวจ" (→ IN_PROGRESS)*
   ซึ่งเข้ากับ `started_at` ที่มีอยู่แล้วพอดี

9. **`legal_acceptance.review_task_id` Required — แต่ตอนยอมรับยังไม่มี task**
   ผู้ใช้กดยอมรับเงื่อนไขตอน submit คำขอ ซึ่งเป็นก่อนที่ review task แรกจะถูกสร้าง
   → *ถ้าไม่ได้คำตอบ: nullable*

10. **"หนึ่ง Organization มี ORGANIZATION_USER ที่ ACTIVE ได้ไม่เกิน 1 คน"** (business rule
    ใน sheet `user_account`) — **ขัดกับ `docs/01-user-journey.md` §1 และ §4.3 โดยตรง**
    ซึ่งตัดสินไว้ว่า *"หน่วยงานหนึ่งมี ORG_USER ได้หลายคน"* และ §4.3 เขียนว่า
    *"Org User เห็นและจัดการคำขอทุกรายการในหน่วยงานของตัวเอง ไม่จำเป็นต้องเป็นคนสร้าง"*
    ซึ่งจะไม่มีความหมายถ้ามีได้คนเดียว
    → ต้องเลือกข้างก่อนเขียน unique index

11. **`request_number` / `dataset_code` format** — ของเดิมใช้ `DR-<ปี>-<4หลัก>`
    ตัวอย่างใน payload ของ `signature_confirmation` ใช้ `ORG-REG-2026-0001`
    → ยืนยัน format ทั้งสามชุด (org request, dataset request, dataset code)

12. **สะกดผิดใน sheet** ให้แก้ก่อนโค้ดอ้างถึง:
    `BDI_FINAL_APPROVEAL` → `BDI_FINAL_APPROVAL` ·
    `review_task.subject_type` มี note ว่า `task_type` (คัดลอกมาผิดช่อง) ·
    `legal_document.display_order` type เขียน `INTEGAR` ·
    `_index` บอก `activation_key` อยู่ schema `iam` แต่ SQL ในชีตเขียน `organization.activation_key`

---

## 6. ลำดับงาน

ทุกเฟสจบด้วย `docker compose exec backend npm run typecheck` +
`docker compose exec frontend npx tsc --noEmit` ผ่าน และ `seed:demo` รันจบ
ทำใน `dev/dev_01` — **`main` ห้ามแตะจนกว่าจะครบทุกเฟส** เพราะ `main` เสิร์ฟ demo สาธารณะอยู่

### เฟส 0 — เตรียมและเคลียร์คำถาม (ไม่แตะโค้ด)

- `git merge origin/main` ใน `dev/dev_01` (ตอนนี้ตามหลัง 8 commit, ไม่มี commit ของตัวเอง
  → fast-forward)
- ส่ง §5 ให้เจ้าของสเปก ตั้งเป้าได้คำตอบ **ข้อ 4** ก่อนเริ่มเฟส 1 (ข้อ 1–3 ปิดแล้วตาม §1.1
  แต่ยังต้องแจ้งให้ทราบว่าเบี่ยงจากดีไซน์) ข้อที่ไม่ได้คำตอบ ให้เดินตาม *"ถ้าไม่ได้คำตอบ:"*
  แล้วมาร์ก `[สมมติฐาน]` ในโค้ดตามธรรมเนียมโปรเจกต์
- ตัดสินใจ §4 ข้อ 1–3 กับทีม (ข้อ 7 ปิดแล้ว — rebuild)

### เฟส 1 — สคีมาใหม่ล้วน ๆ (ยังไม่มีโค้ดเรียก)

- เขียน `prisma/schema.prisma` ใหม่ทั้งไฟล์: 20 model + enum ตาม §4 ข้อ 2
- `prisma migrate dev --name new_datahub_schema` บน database เปล่า
- **ยังไม่ลบสคีมาเดิม** — ทำเป็น migration แยก reset ทีเดียวตอนเฟส 8
  (ระหว่างทางใช้ `docker compose down -v` ใน dev checkout ได้อิสระ)
- seed master data: `iam.role` 7 แถว, `administration.*` จาก `thai-address.json`

  *เสร็จเมื่อ*: `prisma generate` ผ่าน, `prisma studio` เปิดเห็นครบ 20 ตาราง

### เฟส 2 — IAM cutover

`iam.user_account` · `role` · `user_role_assignment` · `activation_key`

- `middleware/auth.ts` — `requireAuth` join `user_role_assignment` แทนอ่าน `user.roles`
  (คงกฎ "อ่านใหม่ทุก request" ไว้)
- `lib/roles.ts` — rename 2 role, เพิ่ม 2 role ใหม่ + label ไทย
- `routes/admin.ts` — invitation → สร้าง `user_account` PENDING + ออก `activation_key`
  (HMAC-SHA-256, env var ใหม่ `ACTIVATION_KEY_SECRET`)
- `routes/auth.ts` — activate/thaid + login OTP ตามผลของ §5 ข้อ 3

  *เสร็จเมื่อ*: `notebooks/journey-a-admin-create-user.ipynb` รันผ่านทุก cell

### เฟส 3 — attachment รวมศูนย์

- ตารางเดียว polymorphic + storage key convention ใหม่ (§3.7)
- เปลี่ยนพฤติกรรม replace: **ไม่ลบ object เดิม** → `status = REPLACED` + `replaced_attachment_id`
- คำนวณ `content_hash` (SHA-256) ตอนอัปโหลด, `scan_status = PENDING` แล้วตั้งเป็น `CLEAN`
  ทันที (ยังไม่มี scanner จริง — มาร์ก TODO)
- `storage.ts` — เพิ่ม `buildStorageKey()` ตาม convention

  *เสร็จเมื่อ*: อัปโหลดทับไฟล์เดิมแล้ว object เก่ายังอยู่ใน MinIO และมีแถว REPLACED

### เฟส 4 — review_task engine (หัวใจของงาน)

- `lib/workflow.ts` ใหม่ — สร้าง/ปิด/reassign task, ตรวจ `result` ที่อนุญาตต่อ `task_type`
  (ตาราง §3.5), ผูก `sequence_number` / `round_number`
- ตารางแมป request.status ↔ review_task (ภาพใน sheet `org_registration_request`):

  | request.status | review_task |
  | --- | --- |
  | `DRAFT` | ยังไม่มี active task |
  | `SUBMITTED` | active task = `PENDING` |
  | `UNDER_REVIEW` | active task = `IN_PROGRESS` |
  | `RETURNED` | task ล่าสุด `COMPLETED` + `result = RETURNED` |
  | `APPROVED` | final approval task `COMPLETED` + `result = APPROVED` |
  | `REJECTED` | task ล่าสุด `COMPLETED` + `result = REJECTED` |
  | `CANCELLED` | ไม่มี active task หรือถูก `CANCELLED` |

- API ต้องส่ง **derived stage** ออกไปด้วย (`currentTaskType` + `round`) ไม่งั้น
  badge ฝั่ง frontend ที่พึ่ง `PENDING_ORG_APPROVER` ฯลฯ จะหายไปหมด
- คง `POST /:id/review` เป็น endpoint เดียวต่อ router ตามที่ `main/CLAUDE.md` สั่งไว้
  — เปลี่ยนแค่ว่า `decide()` อ่าน active `review_task` แทนอ่าน `status`

  *เสร็จเมื่อ*: unit-drive Journey B ครบ 4 ด่านผ่าน API ได้ (ยังไม่ต้องมี UI)

### เฟส 5 — Journey B บนสคีมาใหม่

- แยก `organizations` → `organization` + `organization_registration_request` (snapshot 20 คอลัมน์)
- ที่อยู่เป็นรหัส, `signatory*`/`contact*` → `approver_*`/`user_*` + สร้าง `user_account` จริง
- `organization.status` แยกจาก request status
- `routes/organizations.ts` (658 บรรทัด) เขียนใหม่ราวครึ่งไฟล์

  *เสร็จเมื่อ*: สร้างหน่วยงานผ่านทั้ง journey บน UI ได้จนถึง `ACTIVE`

### เฟส 6 — Journey C บนสคีมาใหม่ + `dataset`

- `dataset_registration_request` + `dataset_registration_metadata` (1:1)
- materialize `dataset` + `dataset_metadata` ตอน `APPROVED` พร้อมออก `dataset_code`
- specialist assignment → `DATASET_SPECIALIST_REVIEW` task (ย้อนกลับเมื่อ 2026-08-30 — ดู §3.5)
- Final Check → `BDI_OFFICER_REVIEW` `round_number = 2`
- `routes/dataset-requests.ts` (1,122 บรรทัด) เขียนใหม่ราวสองในสาม

  *เสร็จเมื่อ*: คำขอที่อนุมัติแล้วมีแถวใน `dataset.dataset` และ PDF ฉบับสมบูรณ์ยังสร้างได้

### เฟส 7 — legal + signature

- 3 ตาราง legal + `signature_confirmation` + derived compliance gate
- seed เอกสาร A0–A4 เป็น `DRAFT` (ยังไม่มีเนื้อหาจริง — sheet เขียน TODO ที่ `name_th`/`name_en`)
- `legalAcceptedAt/ById` เดิม → `legal_acceptance` แถวจริง
- `orgApproverSigned*` เดิม → `signature_confirmation` พร้อม payload snapshot + hash

  *เสร็จเมื่อ*: publish version ใหม่แล้วหน่วยงานที่ยอมรับ version เก่าถูกบล็อกไม่ให้ยื่นคำขอ

### เฟส 8 — audit · notification outbox · integration

- `activity_logs` → `audit.audit_event` + correlation middleware + `source_component`
- `notification_delivery` outbox + worker (`node dist/workers/delivery.js`) แทนการส่งอีเมล inline
  — เพิ่ม service ใน compose
- `integration_operation` สร้างแค่ตาราง
- ลบสคีมาเดิมทิ้งใน migration สุดท้าย

  *เสร็จเมื่อ*: ปิด SMTP แล้วอีเมลค้างเป็น `PENDING` ใน outbox แล้วส่งต่อได้เมื่อเปิดกลับ

### เฟส 9 — frontend · seed · เอกสาร

- `frontend/lib/status.ts` + `types.ts` — enum ชุดใหม่ + label ไทย + สี (คงกฎ "ไม่สื่อด้วยสีอย่างเดียว")
- `components/*/DetailView.tsx` — timeline อ่านจาก endpoint ใหม่ (§4 ข้อ 3)
- `seed-demo.ts` (891 บรรทัด) เขียนใหม่ให้ผลิต fixture ชุดเดิมบนสคีมาใหม่
- อัปเดต `docs/01-user-journey.md` §3.1/§4.2 (state machine เปลี่ยน), §4.9, §6 ข้อ 11
  และ `main/CLAUDE.md` (กฎ event table → review_task)
- รัน SIT ซ้ำทั้งชุดตาม `docs/05-sit-report.md`

---

## 7. ถ้าต้อง backfill จริง (fallback)

ใช้เมื่อทีมยืนยันว่าข้อมูล 7 หน่วยงาน / 10 คำขอ ต้องอยู่ต่อ เขียนเป็น
`backend/src/scripts/migrate-to-v2.ts` อ่านจาก database เดิม เขียนลง database ใหม่
(สองการเชื่อมต่อ ไม่ใช่ in-place) ลำดับ:

1. `role` 7 แถว → `user_account` (cid/external_subject ตาม §5 ข้อ 1–2)
   → `user_role_assignment` แตกจาก `roles[]`
2. `organization` (สถานะแมปตามตารางล่าง) → `organization_registration_request` snapshot
   จากฟิลด์ `signatory*`/`contact*`
3. `attachment` — **ต้องอ่าน object ทุกตัวจาก MinIO เพื่อคำนวณ `content_hash`**
   (~30 object, ถูก) แล้ว copy ไป key ใหม่ตาม convention
4. `review_task` — สังเคราะห์ย้อนหลังจาก `organization_events` / `dataset_request_events`
   ที่มีอยู่ (34 + 36 แถว) แมป event type → task_type + result
5. `dataset_registration_request` + metadata; คำขอที่ `APPROVED` สร้าง `dataset` ตามไปด้วย
6. `audit_event` ← `activity_logs` (`correlation_id` เติมค่า synthetic ต่อแถว)
7. legal / signature — สร้าง `legal_acceptance` และ `signature_confirmation` ย้อนหลัง
   จาก `legalAcceptedAt` / `orgApproverSignedAt` เท่าที่มี (payload snapshot จะไม่ครบ
   — ยอมรับได้ เพราะเป็นข้อมูล demo)

การแมปสถานะ:

| `OrganizationStatus` เดิม | `organization.status` | request.status | active review_task |
| --- | --- | --- | --- |
| `DRAFT` | PENDING_REGISTRATION | DRAFT | — |
| `PENDING_BDI_REVIEW` | PENDING_REGISTRATION | SUBMITTED | `BDI_OFFICER_REVIEW` PENDING |
| `NEEDS_REVISION` | PENDING_REGISTRATION | RETURNED | — (task ก่อนหน้า result=RETURNED) |
| `PENDING_SIGNATORY_REVIEW` | PENDING_REGISTRATION | UNDER_REVIEW | `ORGANIZATION_APPROVAL` PENDING |
| `PENDING_BDI_APPROVAL` | PENDING_REGISTRATION | UNDER_REVIEW | `BDI_FINAL_APPROVAL` PENDING |
| `ACTIVE` | ACTIVE | APPROVED | — |

| `DatasetRequestStatus` เดิม | request.status | active review_task |
| --- | --- | --- |
| `DRAFT` | DRAFT | — |
| `PENDING_OFFICER_REVIEW` | SUBMITTED | `BDI_OFFICER_REVIEW` round 1 |
| `PENDING_ORG_APPROVER` | UNDER_REVIEW | `ORGANIZATION_APPROVAL` |
| `PENDING_OFFICER_FINAL_CHECK` | UNDER_REVIEW | `BDI_OFFICER_REVIEW` round 2 |
| `PENDING_BDI_APPROVAL` | UNDER_REVIEW | `BDI_FINAL_APPROVAL` |
| `NEEDS_REVISION` | RETURNED | `ORGANIZATION_REVISION` (ถ้าเลือกสร้าง) |
| `APPROVED` | APPROVED | — (+ สร้าง `dataset`) |
| `REJECTED` | REJECTED | — |

---

## 8. ความเสี่ยง

| ความเสี่ยง | ผลกระทบ | การรับมือ |
| --- | --- | --- |
| เจ้าของสเปกยืนยันภายหลังว่าตั้งใจให้เป็น ThaID-only จริง (สวนมติ §1.1 ข้อ 3) | ต้องถอด `password_hash` + `otp_code` ออกทีหลัง | ความเสี่ยงต่ำ — แยกไว้ใน `routes/auth.ts` ทางเดียว ถอดได้โดยไม่แตะสคีมาส่วนอื่น |
| timeline หายเพราะทิ้ง event table | ผู้ใช้เสียข้อมูลที่เคยเห็น | §4 ข้อ 3 — ทำ view ก่อนลบตารางเดิม |
| `review_task` ไม่ครอบคลุมทุก transition ที่ UI แสดง (บันทึกร่าง, assign, comment) | timeline โหว่ | ตรวจกับ `EVENT_LABELS` ใน `frontend/lib/status.ts` ทีละค่า ก่อนเฟส 9 |
| Prisma `multiSchema` เป็น preview | migration แตกตอน upgrade Prisma | pin เวอร์ชัน Prisma · §4 ข้อ 1 มีทางถอย |
| `main` ยังเสิร์ฟ demo อยู่ตลอด | merge กลางคันทำของสาธารณะพัง | merge เฟสเดียวจบตอนครบ 9 เฟส · demo ตาม `docs/03` §10 ต้องผ่านก่อน |
| ~12 ฟิลด์ metadata หาย | ฟอร์มที่ผู้ใช้กรอกไว้ query ไม่ได้ | §5 ข้อ 5 |
| `notification_delivery` เป็น outbox แต่ยังไม่มี worker | อีเมลไม่ออก | เฟส 8 ต้องมี worker จริง ไม่ใช่แค่ตาราง |

---

## 9. ที่มาของข้อมูลในเอกสารนี้

- สคีมาปลายทาง: 21 sheet ในไฟล์ Excel รวมภาพประกอบ 21 ภาพ
  (state table, allowed-result matrix, storage key convention, payload ตัวอย่าง)
- สคีมาปัจจุบัน: `backend/prisma/schema.prisma` (578 บรรทัด) + 2 migration
- จำนวนแถวจริง: query `bdi-main-postgres-1` เมื่อ 2026-08-11
- ข้อขัดแย้งกับสเปก: `docs/01-user-journey.md` §1, §4.3, §4.9, §6 และ `main/CLAUDE.md`

---

## 10. สถานะการดำเนินการ (อัปเดต 2026-08-11)

ย้ายแล้วบน `dev/dev_01` — `main` ยังไม่แตะตามที่ §6 กำหนด

| เฟส | สถานะ | หลักฐาน |
| --- | --- | --- |
| 0 merge origin/main | ✅ | fast-forward 8 commit · Journey C เข้ามาครบ |
| 1 สคีมาใหม่ | ✅ | 24 ตารางใน 11 schema (20 ตามดีไซน์ + `administration` 3 + `iam.otp_code`) |
| 1b baseline migration + master seed | ✅ | `20260811155040_datahub_v2_baseline` · 4 partial unique index · 13 CHECK |
| 2 IAM cutover | ✅ | `requireAuth` join `user_role_assignment` · activation key HMAC-SHA-256 |
| 3 attachment รวมศูนย์ | ✅ | ตาราง polymorphic · storage key ใหม่ · replace ไม่ลบ object |
| 4 review_task engine | ✅ | `lib/workflow.ts` · allowed-result matrix · `deriveRequestStatus()` |
| 5 Journey B | ✅ | แยก organization / organization_registration_request |
| 6 Journey C + dataset | ✅ | metadata 1:1 · materialise dataset ตอนอนุมัติ · integration operation |
| 7 legal + signature | 🟡 | ตารางครบ · seed A0–A4 เป็น DRAFT · `signature_confirmation` เขียนจริงใน seed **แต่ compliance gate ยังไม่บังคับ** |
| 8 audit · outbox · integration | ✅ | `audit_event` + correlation middleware · `delivery-worker` service · `integration_operation` |
| 9 frontend · seed · เอกสาร | ✅ | badge จาก `stageMeta()` · timeline จาก review_task · seed ใหม่ · CLAUDE.md |

**ยืนยันด้วย**: `npm run typecheck` ทั้งสองฝั่งผ่าน (0 error) · `npm run build` ผ่าน ·
`seed:masters` + `seed:demo` รันจบ · login/me ผ่าน API จริง · เดิน workflow จริงหนึ่งรอบ
(officer forward → เปิด `ORGANIZATION_APPROVAL` · request_revision → `RETURNED`) ·
outbox หยิบงานแล้วส่งจริง (`PENDING` → `SENT` พร้อม `sent_at`)

### สิ่งที่ยังไม่ได้ทำ

1. **Legal compliance gate ยังไม่บังคับ** — สามตาราง `legal_*` มีครบและ seed เอกสาร A0–A4 แล้ว
   แต่ยังไม่มีโค้ดที่บล็อกการยื่นคำขอเมื่อหน่วยงานยอมรับ version ไม่ครบ
   (ทำไม่ได้จริงตอนนี้เพราะยังไม่มีไฟล์เอกสารจริง — `legal_document_version.attachment_id`
   เป็น NOT NULL เอกสารทุกฉบับจึงยังเป็น DRAFT ซึ่งตามตารางท้าย sheet แปลว่า "ยังไม่ต้องยอมรับ")
   → เปิดใช้เมื่อฝ่ายกฎหมายส่งไฟล์มา
2. **`signature_confirmation` ยังไม่ถูกเขียนตอน runtime** — seed สร้างให้เพื่อให้ PDF
   พิมพ์ชื่อผู้ลงนามได้ แต่ `POST /:id/review` ของด่าน `ORGANIZATION_APPROVAL`
   ยังไม่สร้างแถวพร้อม payload snapshot + hash
3. **Journey D (`data_request`)** ยังไม่มีตาราง — ค่า `DATASET_REQUEST` ถูกใส่ไว้ใน enum
   ของ `owner_type` / `subject_type` แล้วเพื่อไม่ต้อง migrate ซ้ำตอนทำ
4. **รหัสที่อยู่เป็นรหัสที่ระบบสร้างเอง** ไม่ใช่ TIS-1099 จริง (§5 ข้อ 6)
5. **`organization_code` ระบบออกให้เป็น `ORG-<ปี>-<ลำดับ>`** รอคำตอบ §5 ข้อ 4
6. **ไม่มี virus scanner** — `scan_status` ถูกตั้งเป็น `CLEAN` ทันทีตอนอัปโหลด (มาร์ก TODO ไว้)
7. **ยังไม่ได้รัน SIT ซ้ำทั้งชุด** ตาม `docs/05-sit-report.md`

### ข้อขัดแย้งที่ตัดสินโดยยึด Excel

ตามคำสั่ง "ให้เชื่อ Excel มากกว่า markdown / user journey":

| เรื่อง | Excel | docs/01-user-journey.md | ผล |
| --- | --- | --- | --- |
| จำนวน ORG_USER ต่อหน่วยงาน | ไม่เกิน 1 คนที่ ACTIVE | มีได้หลายคน (§1, §4.3) | **ยึด Excel** — partial unique index `uq_active_org_scoped_role_assignment` |
| 12 ฟิลด์ metadata ชุดข้อมูล | ไม่มีคอลัมน์ให้ | มีครบใน §4.3 (มาร์ก [สมมติฐาน]) | **ยึด Excel** — เก็บลง `additional_metadata_json` |
| enum ของชุดข้อมูล | VARCHAR + TO REVIEW | enum เต็มชุด | **ยึด Excel** — บังคับค่าที่ชั้น zod แทน PostgreSQL enum |
| ผู้รับผิดชอบ review | `assigned_user_id` NOT NULL | "BDI Officer ทุกคนเห็นทั้งหมด" ใครว่างก่อนหยิบก่อน | **ยึด Excel** — มอบหมายอัตโนมัติให้คนที่ task ค้างน้อยสุด แล้ว reassign ได้ |
| สถานะคำขอ | 7 ค่าหยาบ + review_task | PENDING_* แยกทุกด่าน | **ยึด Excel** — badge แสดงด่านจาก `currentTaskType` แทน |
