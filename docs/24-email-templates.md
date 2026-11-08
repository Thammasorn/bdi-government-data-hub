# 24 — เทมเพลตอีเมลที่ผู้ดูแลระบบแก้ได้

การ์ด Notion: **[New Feature] Admin Email Template Edit** (Task Board, 2026-11-08) — requirement ทั้งหมดอยู่บนการ์ด เอกสารนี้คือ
ฉบับที่สร้างแล้ว: อะไรอยู่ที่ไหน ทำงานอย่างไร และอะไรที่เปลี่ยนจากการ์ด

หน้าจอ: `/console` → ตั้งค่าระบบ → **เทมเพลตอีเมล** (`/console/settings/email-templates`) เฉพาะ `SYSTEM_ADMINISTRATOR`

## 1. ภาพรวม

ก่อนการ์ดนี้ เนื้ออีเมลทั้งหมดเขียนอยู่ใน `backend/src/lib/mail.ts` แก้ได้ด้วยการ deploy เท่านั้น ตอนนี้ทุกฉบับ render จากเทมเพลต:

```
mail.ts  send*(…)  ──►  *Context(…)  ──►  composeEmail(ctx)  ──►  send()
           (ผู้เรียกไม่เปลี่ยน)   ค่าตัวแปร + บล็อก     เวอร์ชันที่ใช้งานอยู่      SMTP / dry-run
                                + ลิงก์ปุ่ม           + แม่แบบกลาง
```

| ไฟล์ | หน้าที่ |
|---|---|
| `lib/email/catalogue.ts` | **สัญญาระหว่างเทมเพลตกับโค้ด** — 23 เทมเพลต: กลุ่ม ชื่อ ตัวแปรที่ใช้ได้ บล็อก บล็อกบังคับ และเนื้อหาตั้งต้น (= เวอร์ชัน 1) |
| `lib/email/blocks.ts` | บล็อกของระบบ (`{{block.*}}`) และสีตาม CI |
| `lib/email/render.ts` | เติมค่า ตรวจตอนบันทึก sanitize HTML |
| `lib/email/store.ts` | เวอร์ชันในฐานข้อมูล: ฉบับร่าง เผยแพร่ นำกลับ และ "เวอร์ชันที่ใช้งาน ณ เวลาหนึ่ง" |
| `lib/email/compose.ts` | ประกอบอีเมลจริง + ถอยไปเนื้อหาตั้งต้นเมื่อเวอร์ชันในฐานข้อมูลใช้ไม่ได้ |
| `lib/email/samples.ts` | ข้อมูลตัวอย่างของ preview และอีเมลทดสอบ (ของสมมติทั้งหมด) |
| `routes/admin-email-templates.ts` | `/api/admin/email-templates/*` |
| `frontend/app/console/settings/email-templates/` | หน้ารายการ และหน้าแก้ (แก้ไข / ประวัติเวอร์ชัน) |

signature ของ `send*` ใน `mail.ts` ไม่เปลี่ยน ผู้เรียก (routes ทั้งหมด, `workers/render.ts`) จึงไม่ได้แก้

## 2. เทมเพลต

| กลุ่ม | key |
|---|---|
| แม่แบบกลาง | `layout` |
| บัญชีผู้ใช้ | `invitation_external` · `invitation_internal` · `invitation_reminder` · `password_reset` · `otp` · `role_removed` |
| คำขอหน่วยงาน | `org_submitted` · `org_revision` · `org_signatory_request` · `org_signatory_register` · `org_final_approval` · `org_activated` |
| คำขอชุดข้อมูล | `dataset_submitted` · `dataset_revision` · `dataset_specialist_assigned` · `dataset_specialist_commented` · `dataset_pending_org_approver` · `dataset_signed_pending` · `dataset_pending_bdi` · `dataset_approved` · `dataset_rejected` |
| ทั่วไป | `request_progressed` |

**ไม่อยู่ในรายการ:** สรุป error (`workers/error-alerts.ts`) และ `sendRaw()` — ทั้งสองใช้แม่แบบกลาง**ฉบับตั้งต้นในโค้ด**และไม่อ่านฐานข้อมูล
เพราะสรุป error ต้องส่งได้แม้ฐานข้อมูลล่ม

อีเมลที่โค้ดเดิมมีสองแบบ (คำเชิญภายนอก/ภายใน, ขอความเห็นชอบมีบัญชี/ต้องลงทะเบียน) แยกเป็นสองเทมเพลต — **ไม่มี if/else ในเทมเพลต**

## 3. รูปแบบเทมเพลต

แต่ละเทมเพลตมีสี่ช่อง: หัวเรื่อง (ข้อความ + ตัวแปร), เนื้อหา (HTML + ตัวแปร + บล็อก), ข้อความบนปุ่ม (ข้อความ), หมายเหตุท้ายอีเมล (HTML สั้น)
แม่แบบกลางมีช่องเดียวคือ HTML ทั้งกรอบ ต้องมี `{{content}}` และวาง `{{footnote}}` ของแต่ละฉบับ

- `{{org.name}}` — ตัวแปร **escape HTML เสมอ** (ชื่อหน่วยงานหรือข้อความที่ผู้ใช้พิมพ์แทรก HTML ไม่ได้) หัวเรื่องเติมแบบข้อความล้วน
- `{{block.steps}}` — บล็อกของระบบ วางตำแหน่งได้ แก้เนื้อในไม่ได้: `logo` (แม่แบบกลาง) · `button` (ลิงก์มาจากระบบเสมอ) · `orgCode` ·
  `steps` · `summary` · `activation` · `otp` · `note`
- ตัวแปรกลางที่ทุกเทมเพลตใช้ได้: `support.contact` (ไม่มีเบอร์โทร = อีเมลอย่างเดียว) · `support.email` · `app.url`

**บล็อกบังคับ** — บันทึกไม่ได้ถ้าไม่มี: `otp` ต้องมี `block.otp` · คำเชิญทั้งสองต้องมี `block.activation` · `password_reset` และ
`org_signatory_register` ต้องมี `block.button` · `layout` ต้องมี `{{content}}`

## 4. การตรวจตอนบันทึก (`validateContent()`)

ปฏิเสธ (400 `validation`, พร้อม `issues` ทุกข้อ) เมื่อ: ใช้ตัวแปร/บล็อกที่เทมเพลตนั้นไม่มี, ขาดบล็อกบังคับ, หัวเรื่องว่างหรือมี `<>`,
มีปุ่มแต่ไม่มีข้อความบนปุ่ม, และ HTML มีสิ่งนอก allowlist:

- แท็ก: `table tr td th thead tbody tfoot p div span strong b em i u a br hr ul ol li h1–h4 blockquote small center font`
  (+ `html head body meta title` เฉพาะแม่แบบกลาง) — **ไม่มี `<img>`** รูปจากภายนอกถูกเมลไคลเอนต์บล็อกและเป็นตัวติดตามการเปิดอ่าน
- attribute: `style align valign width height bgcolor border cellpadding cellspacing role lang dir title colspan rowspan color face size`
  + `href target rel name` ของ `<a>` — ไม่มี `on*`
- `href` ต้องขึ้นต้น `https://` หรือ `mailto:` · `style` ห้าม `url(` `expression(` `@import` `javascript:` · ตัวแปรใน attribute
  ใส่ได้เฉพาะใน `href`

ระบบ**ปฏิเสธแทนการตัดเงียบ ๆ** เพื่อให้สิ่งที่ส่งจริงตรงกับที่ผู้ดูแลพิมพ์ และยังรัน sanitize-html (allowlist เดียวกัน) กับสิ่งที่ผ่านแล้วก่อน
เก็บเป็นชั้นที่สอง preview ไม่ปฏิเสธ — แสดง issue พร้อมผลหลัง sanitize ขณะพิมพ์ เนื้อหาเกิน 80 KB ได้คำเตือน (Gmail ตัดที่ 102 KB)

## 5. เวอร์ชัน — `administration.email_template_version`

- **ไม่มีแถว = เวอร์ชัน 1 คือเนื้อหาตั้งต้นในโค้ด** deploy แล้วไม่ต้อง seed อีเมลทุกฉบับหน้าตาเหมือนเดิม เวอร์ชัน 1 ถูกเขียนลงตาราง
  (`created_by` = SYSTEM) ตอนมีคนบันทึกฉบับร่างแรกของเทมเพลตนั้น
- **ฉบับร่างมีได้หนึ่งฉบับต่อเทมเพลต** บันทึกซ้ำ = เขียนทับฉบับร่างเดิม (ฉบับร่างไม่เคยถูกส่ง จึงไม่มีอะไรต้องเก็บเป็นหลักฐาน)
- **เผยแพร่** (เหตุผล ≥ 10 ตัวอักษร) ฉบับร่าง → `PUBLISHED`, ฉบับเดิม → `SUPERSEDED` ตรวจเนื้อหาซ้ำก่อนเผยแพร่
- **นำกลับมาใช้** (เหตุผล ≥ 10) คัดลอกเวอร์ชันเก่าไปเป็นฉบับร่าง ไม่แก้ประวัติเดิม **คืนค่าเริ่มต้น = นำเวอร์ชัน 1 กลับมา** ไม่มีปุ่มแยก
- **ไม่มีการลบเวอร์ชัน** partial unique index `uq_email_template_published` / `uq_email_template_draft` กันสองคนกดพร้อมกัน
  (ชน = 409 `concurrent_edit`)
- อ่านทุกครั้งที่ส่ง ไม่ cache — API กับ delivery-worker เป็นคนละ process

**อีเมลเตือนคำเชิญพิมพ์หัวเรื่องของคำเชิญฉบับที่ส่งไปจริง** `contentAt(key, issued_at)` หาเวอร์ชันล่าสุดที่ `published_at ≤ issued_at`
ของคีย์ (ไม่มี = เวอร์ชัน 1) แล้ว render หัวเรื่องนั้น การ์ดเขียนว่า "บันทึกหัวเรื่องตอนส่ง" — ทำจากประวัติเวอร์ชันแทนการเพิ่มคอลัมน์บน
`activation_key` ผลเท่ากันและไม่ต้องแก้ผู้ส่งคำเชิญสี่ที่

**อีเมลต้องออกเสมอ** ถ้าเวอร์ชันในฐานข้อมูลอ่านหรือ render ไม่ได้ `composeEmail()` ส่งด้วยเนื้อหาตั้งต้นและเก็บ error
(`email.template-fallback`, fingerprint `email:template-fallback:<key>`)

## 6. API — `/api/admin/email-templates` (`requireAdmin`)

```
GET    /                              รายการ + เวอร์ชันที่ใช้งาน / ฉบับร่าง
GET    /:key                          นิยาม (ตัวแปร บล็อก) + ทุกเวอร์ชัน
PUT    /:key/draft                    {subject, bodyHtml, buttonLabel, footnoteHtml}
POST   /:key/publish                  {reason}
POST   /:key/versions/:n/restore      {reason}
POST   /:key/preview                  {content} หรือ {versionNumber} — ไม่บันทึก
POST   /:key/test-send                {content} — ถึงอีเมลของ session เท่านั้น
```

test-send ทาง admin token ตอบ 400 `session_required` (token ไม่ใช่คน การ์ดห้ามพิมพ์ที่อยู่อื่น) หัวเรื่องขึ้นต้น `[ทดสอบ]` ข้อมูลตัวอย่าง

audit: `EMAIL_TEMPLATE_PUBLISHED` · `EMAIL_TEMPLATE_RESTORED` · `EMAIL_TEMPLATE_TEST_SENT` (subject `EMAIL_TEMPLATE`, หมวด `config`)
การบันทึกฉบับร่างไม่มีแถวของตัวเอง — ทุกคำขอ `/api/admin` ลง `ADMIN_API_REQUEST` ใน Mongo อยู่แล้ว

## 7. ต่างจากการ์ด

- **ไม่มี `{{block.warning}}`** กล่องส้ม "หากท่านไม่ได้คาดหมาย…" ของสามฉบับมีถ้อยคำต่างกัน จึงเป็น HTML ธรรมดาในเนื้อหาตั้งต้น
  แก้ข้อความในกล่องได้ — แก้ได้มากกว่าที่การ์ดเขียน
- **เพิ่ม `{{block.orgCode}}`** บรรทัด "รหัสหน่วยงาน" ที่ไม่แสดงเมื่อคำขอยังไม่มีรหัส (ตัวแปรเปล่าจะพิมพ์ป้ายลอย ๆ)
- **ฉบับร่างหนึ่งฉบับต่อเทมเพลต** การ์ดเขียน "บันทึก = เวอร์ชันใหม่สถานะฉบับร่าง" — บันทึกครั้งแรกได้เวอร์ชันใหม่ ครั้งต่อไปเขียนทับฉบับร่างนั้น
- หัวเรื่องคำเชิญที่ส่งจริงมาจากประวัติเวอร์ชัน ไม่ใช่คอลัมน์ใหม่ (§5)

## 8. เพิ่มเทมเพลตหรือตัวแปร

ต้องแก้โค้ด: เพิ่มรายการใน `TEMPLATES` / `VARIABLES` (`catalogue.ts`), เติมค่าใน `*Context()` ของ `mail.ts`, และเพิ่มตัวอย่างใน
`samples.ts` หน้าจอวาดตาม API เอง ถ้าเนื้อหาตั้งต้นเปลี่ยน เทมเพลตที่ยังไม่มีใครแก้ (ไม่มีแถว) ได้เนื้อหาใหม่ทันที ส่วนที่มีแถวแล้วยังใช้
เวอร์ชันที่เผยแพร่อยู่ — ตั้งใจ: ถ้อยคำที่ BDI แก้แล้วต้องไม่ถูก deploy ทับ

## 9. ตรวจแล้ว (dev checkout slot 17, 2026-11-08)

- เนื้อหาตั้งต้นทั้ง 23 ฉบับผ่าน `validateContent()` และ render ได้ไม่มี issue
- ปฏิเสธ: ตัวแปรไม่รู้จัก, บล็อกผิดเทมเพลต, `<script>`, `onclick`, `<img>`, `http://`, `url()` ใน style, ตัวแปรใน `title`, OTP ไม่มี
  `block.otp`, แม่แบบกลางไม่มี `{{content}}`, ปุ่มไม่มีข้อความ, เผยแพร่ไม่มีเหตุผล / ไม่มีฉบับร่าง
- เผยแพร่ OTP ใหม่แล้ว login จริง → dry-run พิมพ์หัวเรื่องใหม่ และยังดึงรหัส OTP ออกมาได้
- เปลี่ยนหัวเรื่องคำเชิญ → `contentAt()` ให้หัวเรื่องเดิมกับคีย์ที่ออกก่อน และหัวเรื่องใหม่กับคีย์ที่ออกหลัง
- ผ่านเบราว์เซอร์ (`sit-evidence/email-template-check.mjs`, Chrome 105 headless): รายการ → แก้ → preview ตาม → แทรกตัวแปร → issue → บันทึก
  → ส่งทดสอบ → เผยแพร่ → ประวัติ → เปรียบเทียบ (preview สองฝั่ง + diff โค้ด) → นำเวอร์ชัน 1 กลับ → สลับมือถือ
- **ยังไม่ได้ทดสอบกับ SMTP จริง** (Office 365) และยังไม่ได้เปิดดูในไคลเอนต์อีเมลจริง (Gmail / Outlook)
