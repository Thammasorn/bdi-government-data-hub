# 24 — การ์ด Jira ของการขอความเห็นผู้เชี่ยวชาญ

การ์ด Notion: **[Enhance] JIRA integration** (Task Board, 2026-11-08) — requirement ฉบับเต็มอยู่ที่การ์ด เอกสารนี้อธิบายว่าโค้ดทำตามอย่างไร

## 1. ภาพรวม

| เหตุการณ์ในระบบ | สิ่งที่เกิดใน Jira |
|---|---|
| ผู้ประสานงานของ BDI มอบหมายผู้เชี่ยวชาญ | สร้างการ์ด (Task) ผู้รับผิดชอบ = ผู้ใช้ Jira ที่อีเมลตรงกับผู้เชี่ยวชาญ |
| เปลี่ยนผู้เชี่ยวชาญ | การ์ดใบเดิมเปลี่ยนผู้รับผิดชอบ + comment |
| ผู้เชี่ยวชาญย้ายการ์ดไป Done | (ระบบอ่าน) comment ทั้งหมดเข้าไทม์ไลน์เป็นความเห็นของผู้เชี่ยวชาญ (BDI เห็นเท่านั้น) + แจ้งผู้ประสานงาน |
| ถอนผู้เชี่ยวชาญ / ผ่านการตรวจสอบ / ส่งกลับแก้ไข / ไม่อนุมัติ ก่อนการ์ด Done | หน้าจอถามยืนยันก่อน → comment → ย้ายไป Archived → ระบบเลิกติดตาม |
| ผู้ดูแลระบบรีเซ็ต / ยกเลิก / ลบคำขอ | comment → Archived (ไม่ถามยืนยัน) |
| มีคนย้ายการ์ดไป Archived หรือลบการ์ดเองใน Jira | ระบบเลิกติดตาม ไม่คัดลอก comment และบันทึกแถวไว้หนึ่งแถว |

การขอความเห็นยังเป็นความเห็นประกอบ ไม่ใช่ด่าน (ตกลงกับ BDI 2026-11-08) — ผู้ประสานงานดำเนินการต่อได้เสมอ

## 2. ไฟล์

| ไฟล์ | หน้าที่ |
|---|---|
| `backend/src/lib/jira-config.ts` | ค่าตั้ง (แถว `jira_config` ใน `administration.system_setting`) · เข้ารหัส token · สถานะการเชื่อมต่อ (แถว `jira_status`) |
| `backend/src/lib/jira-client.ts` | ไฟล์เดียวที่รู้จัก REST API ของ Jira · แปลง error เป็น RETRY / RATE_LIMIT / AUTH / PERMANENT · ADF ⇄ ข้อความ |
| `backend/src/lib/jira.ts` | สิ่งที่ route เรียกใน transaction: `jiraOnAssign()`, `endJiraLinks()` · ข้อความ comment · `jiraStatusForRequest()` |
| `backend/src/workers/jira.ts` | ลูปส่งงาน (ทุก 15 วินาที) และลูปติดตาม Done (ทุก `jira_sync_interval_seconds`) ใน delivery-worker |
| `backend/src/routes/admin-jira.ts` | `/api/admin/settings/jira` — ค่าตั้ง, ทดสอบ, บันทึกการทำงาน, ลองใหม่ |
| `frontend/app/console/settings/jira/page.tsx` | หน้า /console → ตั้งค่าระบบ → Jira |
| `frontend/components/dataset/DetailView.tsx` | บรรทัด "การ์ด Jira" ในกล่องผู้เชี่ยวชาญ · คำเตือนในกล่องยืนยัน (`JiraLine`, `JiraOpenWarning`) |

ฐานข้อมูล (migration `20261108120000_jira_integration`):

- `integration.jira_issue_link` — หนึ่งแถวต่อการ์ด (เบี่ยงจากดีไซน์ — ไม่มีใน Excel) `state` OPEN → DONE หรือ ENDED (`end_reason` บอกเหตุ)
- `integration.integration_operation` — คิวและบันทึกของงาน Jira ทุกงาน (`integration_type = JIRA`) คอลัมน์ใหม่ `request_payload_json` เก็บ id ของ link, รหัสข้อความ, เลขคำขอ, เลขการ์ด — **ไม่มีความลับ**
- partial index `integration_operation_jira_queue_idx` สำหรับคำถาม "งานก่อนหน้าของคำขอนี้จบหรือยัง"

## 3. กติกาที่ต้องรักษา

**route ไม่เรียก Jira** — ทุกอย่างเป็นแถวในคิวที่เขียนใน transaction เดียวกับการกระทำในระบบ Jira ล่มหรือ token หมดอายุจึงไม่ทำให้การมอบหมาย
การส่งต่อ หรือการส่งกลับล้มเหลว

**งานของคำขอเดียวกันทำตามลำดับ** — ตัวหยิบงานหยิบเฉพาะงานแรกที่ยังไม่จบ (ไม่ใช่ SUCCEEDED/CANCELLED) ของแต่ละคำขอ งานที่เลิกลองแล้ว
(DEAD_LETTER) จึงกั้นงานหลังจากมันจนกว่าผู้ดูแลระบบกด "ลองอีกครั้ง"

**แถว link เปลี่ยนสถานะทันทีในระบบ ไม่รอ Jira** — `endJiraLinks()` ทำ OPEN → ENDED ใน transaction ของการกระทำ ตัวติดตามอ่านเฉพาะแถว OPEN
จึงไม่คัดลอก comment ของการ์ดที่ Done หลังผู้ประสานงานดำเนินการต่อไปแล้ว การคัดลอก comment เองก็เปลี่ยน OPEN → DONE ด้วย
`updateMany` ที่มี state ใน WHERE ใน transaction เดียวกับที่เขียน `review_task` — สองเหตุการณ์ชนกันได้ผลเดียว

**ปิดการ์ดที่ยังไม่ถูกสร้าง = ยกเลิกงานสร้าง** ไม่มีการ์ดเกิดใน Jira ถ้า worker กำลังสร้างอยู่พอดี worker เห็นหลังสร้างว่าแถวไม่ OPEN แล้ว
และเข้าคิว comment + Archived เอง

**ทุกทางที่เขียน `review_task` จบด้วยการคำนวณสถานะคำขอใหม่** — การคัดลอก comment ทำเหมือน `syncStatus()` ของ route (กติกาของ `updated_at`)

**ระบบติดตามเฉพาะการ์ดที่ตัวเองสร้าง** (เลขการ์ดในฐานข้อมูลของตัวเอง) dev และ production จึงใช้ project เดียวกันได้โดยไม่อ่านการ์ดของกันและกัน

**comment ของบัญชีเชื่อมต่อเองไม่ถูกคัดลอก** — ตอนการ์ดถึง Done ระบบตัด comment ที่ผู้เขียนคือบัญชี `jira-vela` (accountId จาก `myself`)
ออก ไม่งั้น "เปลี่ยนผู้เชี่ยวชาญจาก … เป็น …" ที่ระบบเขียนไว้กลายเป็นความเห็นของผู้เชี่ยวชาญ (พบ 2026-11-08 กับ D2S-13 ที่ผู้เชี่ยวชาญไม่ได้เขียน
อะไรเลย) หัวข้อ "ความเห็นของผู้เชี่ยวชาญ (จาก Jira …)" และลิงก์การ์ดระบบเขียนเอง ผู้เชี่ยวชาญไม่ต้องแนบ ลิงก์ในความเห็นกดได้ทั้งในไทม์ไลน์และ
การ์ด "ความเห็นล่าสุด" (`components/ui/LinkifiedText.tsx`)

## 4. เมื่อเรียก Jira ไม่สำเร็จ

| ผล | ทำอะไร |
|---|---|
| Jira ไม่ตอบ / 5xx | ลองใหม่ 1, 5, 15, 60 นาที แล้วทุกชั่วโมง ครบ 24 ชั่วโมงนับจาก `scheduled_at` → DEAD_LETTER |
| 429 | รอตาม `Retry-After` (ไม่มี header → 1 นาที) แล้วหยุดรอบนี้ |
| token / สิทธิ์ใช้ไม่ได้ | DEAD_LETTER ทันที (`last_error_code` = `AUTH:…`) บันทึก `authFailedAt` แล้ว**หยุดทุกงาน** จนกว่าจะบันทึก credential ใหม่ หรือทดสอบค่าที่บันทึกไว้แล้วผ่าน — งาน `AUTH:*` กลับเข้าคิวเอง |
| 400 / 404 / ไม่มี transition | DEAD_LETTER ทันที |

ทุกครั้งที่เลิกลองเป็น error ใน log store (`jira.dead-letter`, `jira.auth`) อีเมลสรุป error ไปถึงผู้ดูแลระบบตามระบบเดิม

**token ผิดไม่ได้ได้ 401 เสมอ** — Jira ทำคำสั่งต่อในฐานะผู้ไม่ได้เข้าสู่ระบบ (สร้างการ์ดได้ 400 "ไม่มี project หรือไม่มีสิทธิ์" เป็นภาษาจีน ค้นผู้ใช้ได้
รายการว่าง) สิ่งที่บอกได้คือ header `x-seraph-loginreason: AUTHENTICATED_FAILED` ซึ่ง `jira-client.ts` อ่านก่อนดู status code (พบตอนทดสอบ)

## 5. ผู้รับผิดชอบการ์ด

หาด้วย `GET /rest/api/3/user/assignable/search?project=<key>&query=<อีเมล>` — **ไม่ใช่** `user/search` หรือ `user/picker` ซึ่งค้นจากอีเมลไม่เจอใครเลย
ด้วยบัญชี `jira-vela` (ต้องมีสิทธิ์ระดับ site) ทดสอบเมื่อ 2026-11-08 ด้วยสมาชิก D2S จริง: `assignable/search` เจอ อีกสองตัวได้ 0 ผลที่ได้คือคนที่ไม่อยู่ใน
project ไม่ได้รับการ์ด (การ์ดไม่มีผู้รับผิดชอบ + หน้าคำขอเตือน) ซึ่งตรงกับ checklist ก่อนเปิดใช้

## 6. ค่าตั้ง

| ค่า | ที่เก็บ | หมายเหตุ |
|---|---|---|
| เปิด/ปิด, domain, อีเมล, project key, สถานะ Done, สถานะเก็บการ์ด | `system_setting.jira_config` | เปิดได้เมื่อกรอกครบ |
| API token | ในแถวเดียวกัน เข้ารหัส AES-256-GCM | กุญแจ = HKDF(`ACTIVATION_KEY_SECRET`) — เปลี่ยน secret แล้วต้องกรอก token ใหม่ API ตอบแค่ `tokenSet` |
| ตรวจสถานะการ์ดทุก (วินาที) | `system_setting.jira_sync_interval_seconds` (`SYSTEM_SETTINGS`) | ค่าเริ่มต้น 900 ช่วง 60–86,400 |

การแก้ค่าตั้งเขียน `SYSTEM_SETTING_UPDATED` (`metadata.key = jira_config`) โดยไม่มี token — ตรวจแล้วว่าไม่มีแถว audit ไหนมี token

ระยะนี้ dev และ production ใช้บัญชี `jira-vela@bdi.or.th` และ project D2share (D2S) — ก่อนปล่อยจริงจะตั้ง Jira ของ production ผ่านหน้านี้ ไม่ต้องแก้โค้ด

## 7. API

```
GET  /api/admin/settings/jira                       ค่าตั้ง + สถานะ + จำนวนงานล้ม/รอ
PUT  /api/admin/settings/jira                       {enabled?, domain?, email?, token?, projectKey?, doneStatus?, archiveStatus?}
POST /api/admin/settings/jira/test                  ช่องที่ส่งมาแทนค่าที่บันทึกไว้ (ทดสอบฟอร์มที่ยังไม่บันทึกได้)
GET  /api/admin/settings/jira/operations            ?status=failed|pending|all&page&pageSize — ย้อนหลัง 30 วัน
POST /api/admin/settings/jira/operations/:id/retry
PUT  /api/admin/settings/jira_sync_interval_seconds {value}
```

`GET /api/dataset-requests/:id` มี `jira` (ฝั่ง BDI เท่านั้น): `issueKey`, `url`, `state`, `assigneeFound`, `delivery` (`sent` / `pending` / `failed`)

## 8. ที่ทดสอบแล้ว (dev checkout, Jira จริง project D2S, 2026-11-08)

1. ทดสอบการเชื่อมต่อ — ผ่านทั้งสี่ขั้น
2. มอบหมาย → D2S-11 ถูกสร้าง เนื้อหาครบ ไม่มีผู้รับผิดชอบ (บัญชีทดสอบไม่มีใน Jira)
3. เขียน 2 comment + ย้ายไป Done → ไทม์ไลน์มีหนึ่งรายการ 2 comment (BDI_INTERNAL), แจ้งผู้ประสานงาน, audit `source: JIRA`
4. ส่งกลับแก้ไขขณะการ์ดเปิด (D2S-12) → comment ตามตาราง → Archived ตามลำดับ
5. token ผิด → งานเป็น `AUTH:401` ระบบหยุด หน้าคำขอ "ส่งไป Jira ไม่สำเร็จ" → บันทึก token ถูก → งานส่งใหม่เอง (D2S-13)
6. เปลี่ยนผู้เชี่ยวชาญ → การ์ดใบเดิมได้ comment "เปลี่ยนผู้เชี่ยวชาญจาก … เป็น …"
7. หน้า /console → ตั้งค่าระบบ → Jira และคำเตือนในกล่องยืนยันสามกล่อง (DOM, Chrome 105 headless — `sit-evidence/jira-check.mjs`)

ยังไม่ได้ทดสอบ: ผู้เชี่ยวชาญที่มีบัญชี Jira จริงได้รับการ์ด (ค้นด้วยอีเมลทดสอบแบบอ่านอย่างเดียวแล้วเจอ แต่ไม่ได้สร้างการ์ดให้คนจริง), 429 จาก Jira จริง
