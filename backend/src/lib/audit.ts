/**
 * Immutable audit event — schema `audit`, sheet `audit.audit_event`
 *
 * แทน activity_logs เดิม ต่างกันสี่เรื่อง:
 *   - action code ละเอียดขึ้นมาก (~25 ค่า แทน 10 ค่าหยาบ)
 *   - มี actor_type และ result (SUCCESS/FAILURE) ทำให้บันทึกความล้มเหลวได้
 *   - correlation_id และ source_component เป็น NOT NULL
 *   - ไม่มีคอลัมน์ actor_name / actor_roles อีกแล้ว
 *
 * เรื่องสุดท้ายสำคัญ: ของเดิมคัดลอกชื่อและ role ของผู้กระทำลงแถวโดยตั้งใจ เพื่อให้ log
 * ยังอ่านถูกแม้ผู้ใช้เปลี่ยนชื่อหรือถูกถอน role ภายหลัง ดีไซน์ใหม่มีแต่ actor_id
 * → เก็บชื่อกับ role ต่อใน metadata_json ไม่งั้นเสียคุณสมบัตินั้นไป
 */
import {
  AuditActorType,
  AuditResult,
  RoleAssignmentStatus,
  type Prisma,
} from "@prisma/client";

import { prisma, withDatabaseDeadline } from "../db.js";
import { recordLogReadFallback, reportAuditWriteFailure } from "./audit-fallback.js";
import { addBreadcrumb, correlationId, currentContext, sourceComponent } from "./context.js";
import { NAME_FIELDS, fullNameTh } from "./person-name.js";

/** action code ตามตัวอย่างใน sheet `audit.audit_event` */
export const AuditAction = {
  /**
   * สร้างบัญชี `PENDING` ให้คนที่ถูกเชิญ — `POST /api/admin/invitations` (`created_via: ADMIN_API`)
   * หรือตอนผู้ประสานงานของ BDI ตรวจคำขอหน่วยงานผ่านแล้วผู้มีอำนาจฯ ยังไม่มีบัญชี (`REVIEW_API`,
   * `ensureApproverAccount()` ใน routes/organizations.ts)
   *
   * บัญชีนี้ยึดอีเมลกับเลขบัตรไว้ตั้งแต่ตอนเชิญ (unique ทั้งคู่) แต่ก่อนหน้านี้ไม่มีแถวไหนบอกว่ามันเกิด
   * เมื่อไรจากคำสั่งของใคร `after` คือค่าตอนสร้าง เลขบัตรผ่าน `sanitizeState()` แล้ว
   */
  USER_ACCOUNT_CREATED: "USER_ACCOUNT_CREATED",
  USER_ACCOUNT_ACTIVATED: "USER_ACCOUNT_ACTIVATED",
  USER_ACCOUNT_DEACTIVATED: "USER_ACCOUNT_DEACTIVATED",

  /**
   * การจัดการบัญชีที่เปิดใช้งานแล้ว — เพิ่มจากรายการใน sheet พร้อม `/api/admin/users`
   *
   * `USER_ACCOUNT_DEACTIVATED` มีอยู่ก่อนแล้วแต่ไม่มีใครเขียน เพราะการระงับบัญชีเคยทำ
   * ผ่านฐานข้อมูลตรง ๆ (คอมเมนต์ใน `middleware/auth.ts` เขียนไว้เอง) สี่ตัวนี้เติมให้ครบวง
   * เพราะทุกคำสั่งที่ตัดสิทธิ์คนต้องตอบได้ว่าใครสั่ง เมื่อไร ด้วยเหตุผลอะไร
   */
  USER_ACCOUNT_SUSPENDED: "USER_ACCOUNT_SUSPENDED",
  USER_ACCOUNT_REINSTATED: "USER_ACCOUNT_REINSTATED",
  USER_ACCOUNT_REACTIVATED: "USER_ACCOUNT_REACTIVATED",
  USER_ACCOUNT_UPDATED: "USER_ACCOUNT_UPDATED",
  /**
   * ปล่อยอีเมลของบัญชีให้กลับไปใช้ใหม่ได้ (กล่องจดหมายกลางเปลี่ยนมือ)
   *
   * `before` เก็บอีเมลเดิมไว้ เพราะหลังจากนี้แถวนั้นไม่มีอีเมลเดิมอีกแล้ว —
   * เหตุผลเดียวกับที่ `INVITATION_DELETED` ต้องเก็บอีเมลกับเลขบัตรไว้ในตัวเอง
   * **เลขบัตรไม่มีทางถูกปล่อย** เลขบัตรคือคน ไม่ใช่ตำแหน่ง
   */
  USER_IDENTITY_RELEASED: "USER_IDENTITY_RELEASED",

  ACTIVATION_KEY_ISSUED: "ACTIVATION_KEY_ISSUED",
  /**
   * คีย์ถูกใช้เปิดบัญชีแล้ว — `POST /api/auth/activate` เขียนหลัง commit คู่กับ `USER_ACCOUNT_ACTIVATED`
   * (subject คือบัญชี) และ `ROLE_ASSIGNED` (subject คือ assignment) ด้วย correlation id เดียวกัน
   *
   * แยกแถวไว้ให้ประวัติที่อ่านจาก subject ของคีย์ใบเดียวจบที่ USED — ISSUED · IDENTITY_VERIFIED · USED
   * before/after เป็น `ISSUED` → `USED` เสมอ เพราะ `completeActivation()` พลิกเฉพาะคีย์ที่ยัง ISSUED
   * ตอนเขียน คีย์ที่ถูกเพิกถอนหรือถูกใช้ไประหว่างนั้นได้ 410 และไม่มีแถวนี้ หนึ่งคีย์จึงมีแถวนี้ไม่เกินหนึ่งแถว
   */
  ACTIVATION_KEY_USED: "ACTIVATION_KEY_USED",
  /**
   * คีย์ที่ยังใช้ได้ถูกเพิกถอน — หนึ่งแถวต่อคีย์ เขียนหลัง commit ด้วย `logKeysRevoked()` ใน lib/iam.ts
   *
   * เดิมทุกทางที่เพิกถอนคีย์เปลี่ยนสถานะเงียบ ๆ เหลือแค่ `revoked_reason` บนแถวคีย์ ซึ่งตอบไม่ได้ว่าใคร
   * สั่ง: `POST /api/admin/invitations/:id/revoke` · ออกใบใหม่แทน (resend และคำเชิญผู้มีอำนาจฯ รอบใหม่
   * — `metadata.replaced_by_key_id` ชี้ใบใหม่) · ยุติบัญชี · สั่งคำขอกลับเป็นร่าง · ยกเลิกผลการตรวจสอบ
   * `metadata.revoked_via` เป็นช่องทางเดียวกับแถวต้นเรื่อง (ADMIN_API · ADMIN_RESET_API · REVIEW_API)
   * และ `metadata.reason` คือค่าเดียวกับ `revoked_reason` แถวต้นเรื่องหาได้จาก correlation id เดียวกัน
   *
   * คีย์ที่ถูกเพิกถอนตอนเลขบัตรจาก ThaID ไม่ตรง (§2.4) ไม่เขียนแถวนี้ — แถว CID_MISMATCH ของ
   * `IDENTITY_VERIFICATION_FAILED` บันทึกเหตุการณ์นั้นแล้ว
   */
  ACTIVATION_KEY_REVOKED: "ACTIVATION_KEY_REVOKED",
  /**
   * คีย์เลยกำหนดแล้วถูกพลิกเป็น `EXPIRED` — ไม่มี job มาไล่เก็บ สถานะเปลี่ยนตอนมีคนเปิดลิงก์
   * (`evaluateActivationKey()` ใน lib/iam.ts) แถวนี้จึงบอกด้วยว่ามีคนกดลิงก์ที่ตายแล้ว เขียน
   * เฉพาะครั้งที่สถานะเปลี่ยนจริง การเปิดลิงก์เดิมซ้ำไม่เพิ่มแถว
   */
  ACTIVATION_KEY_EXPIRED: "ACTIVATION_KEY_EXPIRED",

  /**
   * คำเชิญถูกลบทิ้ง (`DELETE /api/admin/invitations/:id`) — เพิ่มจากรายการใน sheet
   * ไม่ใช่ ACTIVATION_KEY_REVOKED: revoke ทำให้คีย์ใช้ไม่ได้แต่แถวยังอยู่ให้ตรวจสอบ
   * ส่วนอันนี้คือแถวนั้นหายไปแล้ว (บางครั้งพร้อมบัญชี PENDING ที่ยึดอีเมลกับเลขบัตรไว้)
   * จึงเป็นที่เดียวที่ยังเหลือหลักฐานว่าใครถูกเชิญไว้ก่อน — `before` เก็บอีเมล เลขบัตร
   * และ role ของใบที่ลบไว้ด้วยเหตุนี้
   */
  INVITATION_DELETED: "INVITATION_DELETED",

  /**
   * คำเชิญผู้มีอำนาจกระทำการแทนถูกยกเลิกพร้อมกับผลการตรวจสอบของผู้ประสานงานของ BDI
   *
   * แยกจาก `INVITATION_DELETED` เพราะคนละคนสั่งและคนละเหตุ: อันนั้นคือผู้ดูแลระบบลบ
   * คำเชิญที่ออกผิด ส่วนอันนี้คือผู้ประสานงานของ BDI ถอนผลการตรวจสอบของตัวเองเพื่อปลดคำขอ
   * ที่ค้างอยู่กับคนที่เข้าระบบไม่ได้ และมันเกิดพร้อมกับ `REQUEST_RETURNED` เสมอ
   *
   * เก็บอีเมล เลขบัตร และชื่อของผู้ถูกเชิญไว้ในตัวเอง เพราะบัญชี PENDING ใบนั้นมัก
   * ถูกลบทิ้งไปด้วย (เพื่อคืนอีเมลกับเลขบัตรให้กรอกใหม่) แถวนี้จึงเป็นหลักฐานเดียว
   * ที่เหลือว่าเคยมีคำเชิญไปหาที่อยู่ไหน — จำเป็นทั้งตอนสอบทานและตอนตอบเรื่อง PDPA
   */
  APPROVER_INVITATION_RECALLED: "APPROVER_INVITATION_RECALLED",

  ROLE_ASSIGNED: "ROLE_ASSIGNED",
  ROLE_REVOKED: "ROLE_REVOKED",

  /**
   * หน่วยงานใหม่ในทะเบียน — ผู้ดูแลระบบสร้างล่วงหน้า (`created_via: ADMIN_API`) หรือผู้ใช้เปิดคำขอ
   * จดทะเบียนพร้อมหน่วยงานใหม่ (`WEB_FORM`, มี `REQUEST_CREATED` ของคำขอคู่กัน) subject คือแถว
   * `organization` เสมอ `after` เก็บค่าที่เขียนลงทะเบียนตอนสร้าง ทุกช่องเป็นของหน่วยงาน ไม่มีข้อมูลบุคคล
   *
   * แถวทาง WEB_FORM ที่เขียนก่อนการ์ด activity log มี subject เป็น **คำขอ** และไม่มี `REQUEST_CREATED` คู่
   */
  ORGANIZATION_CREATED: "ORGANIZATION_CREATED",
  /**
   * ผู้ดูแลระบบแก้ทะเบียนหน่วยงาน (`PATCH /api/admin/organizations/:id`) — before/after เป็นช่องที่
   * เปลี่ยนจริง เทียบกับค่าที่ **เขียนลง** (ที่อยู่เป็นรหัส ไม่ใช่ชื่อที่ส่งมา) `metadata.fields` คือช่องที่ส่งมา
   *
   * แถวที่เขียนก่อนการ์ด activity log เก็บแค่รหัสกับชื่อไทยไม่ว่าจะแก้ช่องไหน และแถวที่ subject เป็น
   * `ORGANIZATION_REGISTRATION_REQUEST` คือการเปิดคำขอจากหน่วยงานที่ admin สร้างไว้ ซึ่งตอนนี้เป็น
   * `REQUEST_CREATED`
   */
  ORGANIZATION_UPDATED: "ORGANIZATION_UPDATED",
  /**
   * หน่วยงานเปิดใช้งาน — BDI อนุมัติขั้นสุดท้ายของคำขอจดทะเบียน (`POST /api/organizations/:id/review`)
   *
   * ขั้นนี้ไม่ได้แค่เปลี่ยนสถานะ: ค่าในคำขอถูกเขียนทับทะเบียนหน่วยงานทั้งชุด (รหัส ชื่อ ที่อยู่ ช่องทาง
   * ติดต่อ) ซึ่ง `REQUEST_APPROVED` ของคำขอไม่ได้บอก before/after จึงเป็น diff ของแถวหน่วยงานที่อ่าน
   * ไว้ก่อน transaction กับค่าที่เขียนลง และ subject คือหน่วยงาน ไม่ใช่คำขอ
   */
  ORGANIZATION_ACTIVATED: "ORGANIZATION_ACTIVATED",

  /**
   * เปิดคำขอใบใหม่ — ทั้งคำขอลงทะเบียนชุดข้อมูลและคำขอจดทะเบียนหน่วยงาน (`POST /api/organizations`)
   *
   * ฝั่งหน่วยงานมีสองแบบ: เปิดให้หน่วยงานที่ผู้ดูแลระบบสร้างไว้ (`metadata.prefilled_from` บอกว่าค่า
   * ตั้งต้นคัดลอกมาจากทะเบียน) หรือเปิดพร้อมหน่วยงานใหม่ ซึ่งมี `ORGANIZATION_CREATED` และ
   * `ROLE_ASSIGNED` ของผู้เปิดในคำขอเดียวกัน แถวก่อนการ์ด activity log ของสองกรณีนี้เป็น
   * `ORGANIZATION_UPDATED` และ `ORGANIZATION_CREATED` ตามลำดับ
   */
  REQUEST_CREATED: "REQUEST_CREATED",

  /**
   * คำขอถูกลบออกจากระบบทั้งใบ (`DELETE /api/admin/registrations/datasets/:id`)
   * — เพิ่มจากรายการใน sheet
   *
   * ไม่ใช่ REQUEST_REJECTED และไม่ใช่การยกเลิก: ทั้งสองอย่างนั้นแถวยังอยู่ให้ย้อนดูได้
   * ส่วนอันนี้คือแถวนั้นหายไปแล้ว แถวนี้จึงเป็นหลักฐานชิ้นเดียวที่เหลือว่าเคยมีคำขอเลขนี้
   * `before` จึงเก็บเลขที่คำขอ ชื่อชุดข้อมูล และวันที่สร้างของใบที่ลบไว้ด้วยเหตุนี้
   *
   * ตั้งแต่ 2026-09-25 เส้นทางของหน่วยงานยกเลิกทุกใบ ไม่ลบอีกแล้ว การลบจึงเป็นอำนาจของ
   * ผู้ดูแลระบบอย่างเดียว และทำได้ถึงใบที่อนุมัติแล้ว — `before` จึงเก็บรหัส dataset ที่ถูกลบ
   * ตามไปด้วย และ storage key ของไฟล์ที่ถูกถอดออก (object ยังอยู่ใน bucket)
   */
  REQUEST_DELETED: "REQUEST_DELETED",

  /**
   * คำขอถูกยกเลิก — โดยหน่วยงานเอง (`DELETE /api/dataset-requests/:id`) หรือโดยผู้ดูแลระบบ
   * (`POST /api/admin/registrations/datasets/:id/cancel`) คนละอย่างกับ `REQUEST_DELETED`
   * ข้างบน ตรงที่แถวยังอยู่
   *
   * และคนละอย่างกับ `REQUEST_REJECTED`: ที่นี่ผู้ยื่นเป็นคนถอนเรื่องเอง ไม่ใช่ผู้ตรวจ
   * ปฏิเสธ — `actor_id` จึงเป็นผู้ประสานงานของหน่วยงาน ไม่ใช่เจ้าหน้าที่ BDI
   *
   * ตั้งแต่ 2026-09-25 รวมถึงร่างที่ **ยังไม่เคยนำส่ง** ด้วย (เดิมร่างแบบนั้นถูกลบทิ้ง) —
   * `metadata.cancelled_via` แยก ORGANIZATION ออกจาก ADMIN_API และ `had_submitted`
   * ตอบได้ว่าใบนั้นเคยเดินผ่านการตรวจหรือไม่
   */
  REQUEST_CANCELLED: "REQUEST_CANCELLED",

  /**
   * ฝั่งหน่วยงานบันทึกร่าง (`PATCH /api/organizations/:id` และ
   * `PATCH /api/dataset-requests/:id`) — เพิ่มจากรายการใน sheet
   *
   * PATCH นี้มาจากปุ่ม "บันทึกแบบร่าง" **หรือ** จากปุ่มสร้างเอกสาร ("ตรวจสอบข้อมูล" ฝั่งหน่วยงาน
   * "ตรวจสอบคำขอ" ฝั่งชุดข้อมูล) ซึ่งบันทึกร่างก่อนแล้วค่อยเรียก `generate-form` แถวนี้ไม่บอกว่า
   * กดปุ่มไหน: ถ้าเป็นปุ่มสร้างเอกสารและสร้างสำเร็จ จะมี `REQUEST_FORM_GENERATED` ของคำขอเดียวกัน
   * ตามมาในไม่กี่วินาที (คนละ correlation id เพราะเป็นคนละ request) ถ้าสร้างไม่สำเร็จ ร่างก็ถูก
   * บันทึกไปแล้วจริง แถวนี้จึงยังถูกต้อง แค่ไม่มีแถวสร้างเอกสารตาม
   *
   * ไม่ใช่ `REQUEST_UPDATED`: อันนั้นคือผู้ดูแลระบบเขียนทับได้ทุกสถานะ ส่วนอันนี้คือคนใน
   * หน่วยงานแก้ร่างของตัวเองตอน DRAFT/RETURNED (ฝั่งชุดข้อมูลผู้มีอำนาจฯ ก็บันทึกได้ ดู
   * `mayEdit`) — รวมเป็นรหัสเดียวแล้วแถวจะไม่บอกว่าใครใช้อำนาจแบบไหน
   *
   * `before`/`after` คำนวณที่เซิร์ฟเวอร์จากแถวเดิมกับค่าที่ **เขียนลงจริง** ไม่ใช่จาก body:
   * ฟอร์มหน่วยงานส่งเฉพาะช่องที่ไม่ว่าง ฟอร์มชุดข้อมูลส่งครบทุกช่อง ไม่มีฝั่งไหนรู้ว่าอะไร
   * เปลี่ยน ค่าที่กฎในชีท conditions ล้างให้เองก็อยู่ใน diff ด้วย เพราะมันถูกเขียนจริง
   * `""` นับเท่ากับ null และเลขบัตรผ่าน `sanitizeDiff()` ก่อนลงแถว กดบันทึกโดยไม่มีอะไร
   * เปลี่ยนไม่เขียนแถว — ที่หน่วยงานอยากรู้คือ "ใครแก้อะไร" ไม่ใช่ "ใครกดปุ่ม"
   *
   * `metadata.fields_changed` คือช่องที่เปลี่ยนตามที่ผู้กรอกส่งมา ฝั่งหน่วยงานมีอีกกลุ่มที่
   * route เขียนจากบัญชีทับเสมอ (ผู้ประสานงาน และอีเมล/เลขบัตรของผู้มีอำนาจฯ ที่เปิดบัญชีแล้ว)
   * ช่องกลุ่มนั้นที่เปลี่ยนอยู่ใน `metadata.synced_from_account` แทน และช่องที่เปลี่ยนแค่รูปเพราะ
   * route แปลงค่าเดิมที่ส่งกลับมา (อีเมลเป็นตัวพิมพ์เล็ก เบอร์เป็นตัวเลขล้วน ตัดช่องว่าง — ดู
   * `changedOnlyInForm()`) อยู่ใน `metadata.normalised_by_route` — ทั้งสามรวมกันเท่ากับ key ของ
   * before/after พอดี snapshot ที่ไม่ตรงกับบัญชี (ร่างเก่า หรือบัญชีถูกแก้ชื่อ) หรือเก็บไว้ก่อนมีการแปลง
   * จึงเกิดแถวตอนบันทึกครั้งแรกแม้ไม่ได้พิมพ์อะไร โดย `fields_changed` เป็น `[]` — ตารางเปลี่ยนจริง
   * แต่ไม่ใช่ฝีมือผู้กรอก
   *
   * ชื่อบนแถว `organization` ที่ตามร่างของหน่วยงานที่เปิดเองไปด้วยอยู่ใน
   * `metadata.organization_master_changed` ไม่ใช่ใน before/after เพราะเป็นคนละแถวกับ subject
   */
  REQUEST_DRAFT_SAVED: "REQUEST_DRAFT_SAVED",

  /**
   * สร้างเอกสารจาก template ให้ตรวจก่อนนำส่ง (`POST /:id/generate-form` ทั้งสองเส้นทาง)
   * — เพิ่มจากรายการใน sheet
   *
   * ฉบับที่สร้างรอบนี้คือสิ่งที่ผู้มีอำนาจฯ จะอ่านและลงนาม และกดสร้างซ้ำเมื่อไรฉบับเดิมก็
   * กลายเป็น REPLACED ไม่มีแถวนี้ก็ตอบไม่ได้ว่าฉบับที่ลงนามถูกสร้างจากร่างรอบไหน
   * `metadata.documents` เก็บรหัสเอกสาร เวอร์ชัน template และ attachment ที่ได้ การ render
   * ซ้ำหลังลงนามไม่เขียนแถวนี้ — นั่นเป็นผลของ `DOCUMENT_SIGNED` ไม่ใช่การกดของใคร
   */
  REQUEST_FORM_GENERATED: "REQUEST_FORM_GENERATED",

  REQUEST_SUBMITTED: "REQUEST_SUBMITTED",
  REQUEST_RETURNED: "REQUEST_RETURNED",

  /**
   * ผู้ประสานงานของ BDI ขอความเห็นจากผู้เชี่ยวชาญด้านข้อมูล หรือถอนการขอ
   * (`POST /api/dataset-requests/:id/assign`) — เพิ่มจากรายการใน sheet
   *
   * การมอบหมายไม่ใช่ด่าน จึงไม่มี review_task ให้ย้อนดู และ `assigned_specialist_id` ถูก
   * เขียนทับทุกครั้ง แถวนี้จึงเป็นที่เดียวที่บอกว่าเคยขอใครไว้ก่อน `after.assignedSpecialistId`
   * เป็น null แปลว่าถอน เขียนเฉพาะเมื่อชื่อเปลี่ยนจริง และก่อนอีเมลที่ส่ง inline ซึ่ง throw ได้
   */
  REQUEST_ASSIGNED: "REQUEST_ASSIGNED",

  /**
   * ผู้ดูแลระบบแก้ snapshot ของคำขอโดยตรง (`PUT /api/admin/registrations/...`)
   * — เพิ่มจากรายการใน sheet พร้อมการ์ด "Admin API for registration" (2026-09-20)
   *
   * ไม่ใช่ `REQUEST_CREATED` และไม่ใช่ `ORGANIZATION_UPDATED`: เส้นทางนี้เขียนทับค่าที่
   * ฟอร์มของหน่วยงานล็อกไว้ (รหัสหน่วยงาน · ส่วนผู้ดำเนินการ · อีเมลกับเลขบัตรของ
   * ผู้มีอำนาจฯ) และทำได้ทุกสถานะ รวมถึงตอนคำขอค้างอยู่ในคิวของผู้ตรวจ ทุกครั้งจึงต้อง
   * ตอบได้ว่าช่องไหนเปลี่ยนจากอะไรเป็นอะไร — `before`/`after` เก็บเฉพาะช่องที่เปลี่ยนจริง
   * (`diffFields()`) เพราะเก็บทั้งใบทุกครั้งทำให้ log อ่านไม่ออก
   */
  REQUEST_UPDATED: "REQUEST_UPDATED",

  /**
   * คำขอถูกพากลับไปเป็นฉบับร่าง — สองทาง แยกด้วย `metadata.reset_via`
   *
   * - `ADMIN_API`: ผู้ดูแลระบบสั่งเอง (`POST /api/admin/registrations/.../reset`) ทั้งสองเส้นทาง
   *   `metadata` เก็บด่านที่ถูกยกเลิก (`cancelled_task_type`) และฝั่งหน่วยงานมี `is_remove_approver`
   *   กับสิ่งที่เกิดกับผู้มีอำนาจฯ (`approver_outcome`)
   * - `ADMIN_TRANSFER` (เพิ่มในการ์ด activity log): ผลข้างเคียงของ `POST /api/admin/users/:id/transfer`
   *   คำขอจดทะเบียนหน่วยงานที่ค้างอยู่ที่ด่านของคนที่ย้ายถูกดันกลับเป็นร่าง หนึ่งแถวต่อใบ `metadata`
   *   เป็นคนละรูป: ไม่มี `cancelled_task_type` (ด่านที่ถูกปิดหาได้จาก `review_task`) มี
   *   `transferred_user_account_id` ชี้คนที่ย้าย และ `approver_cleared: true` แปลว่าอีเมลผู้มีอำนาจฯ ใน
   *   snapshot ถูกล้างเพราะเป็นคนที่ย้ายเอง — แถวนี้ไม่เก็บอีเมลนั้น `reason` คือเหตุผลของการย้าย
   *   แถวแบบนี้ที่เขียนก่อนการ์ดไม่มี เหลือแค่เลขคำขอใน `ROLE_ASSIGNED` ของคนที่ย้าย
   *
   * ทั้งสองทาง `before` คือสถานะกับ `submittedAt` เดิม แยกจาก `REQUEST_RETURNED` เพราะคนละคนสั่งและคนละ
   * ความหมาย: การส่งกลับเป็น**ผล**ของด่านหนึ่ง มีผู้ตัดสินและเหตุผลที่หน่วยงานอ่านได้ ส่วนอันนี้คือการลบรอบที่
   * กำลังเดินอยู่ทิ้งทั้งรอบ ด่านที่ค้างถูกปิดเป็น `CANCELLED` ไม่มีผลการตรวจใด ๆ เกิดขึ้น
   */
  REQUEST_RESET_TO_DRAFT: "REQUEST_RESET_TO_DRAFT",
  REQUEST_APPROVED: "REQUEST_APPROVED",
  REQUEST_REJECTED: "REQUEST_REJECTED",

  ATTACHMENT_UPLOADED: "ATTACHMENT_UPLOADED",
  ATTACHMENT_REPLACED: "ATTACHMENT_REPLACED",
  ATTACHMENT_DELETED: "ATTACHMENT_DELETED",

  LOGIN_SUCCEEDED: "LOGIN_SUCCEEDED",
  LOGIN_FAILED: "LOGIN_FAILED",

  /**
   * ออก OTP ทางอีเมลให้ขั้นที่สองของการเข้าสู่ระบบ — เพิ่มจากรายการตัวอย่างใน sheet
   *
   * ไม่มีแถวนี้ ช่วงระหว่าง "รหัสผ่านถูก" กับ `LOGIN_SUCCEEDED` มองไม่เห็นเลย: ตอบไม่ได้ว่า
   * รหัสผ่านของบัญชีหนึ่งถูกใช้สำเร็จกี่ครั้งโดยที่ไม่มีใครผ่าน OTP ต่อ ซึ่งเป็นสัญญาณแรกว่า
   * รหัสผ่านหลุด `metadata.resend` แยกการกดขอรหัสใหม่ออกจากรอบแรก
   *
   * **ไม่เก็บตัวรหัส** แม้แต่ hash และ "ออก" ไม่ได้แปลว่า "ส่งถึง" — แถวนี้เขียนก่อนส่งอีเมล
   * เพราะการส่งทำ inline และล้มได้ (กติกาของทั้ง catalogue: audit มาก่อน SMTP ที่ throw ได้)
   */
  LOGIN_OTP_ISSUED: "LOGIN_OTP_ISSUED",

  /**
   * ตั้งรหัสผ่านใหม่ผ่านลิงก์ที่ผู้ดูแลระบบสั่งออกให้ — เพิ่มจากรายการตัวอย่างใน sheet
   * (การ์ด "API ให้ system admin reset password ให้ user" 2026-09-18)
   *
   * สองเหตุการณ์ คนละคนทำ: REQUESTED คือแอดมินสั่งออกลิงก์ (actor = ระบบ เพราะมาทาง
   * `x-admin-token` ดู docs/09 §4) COMPLETED คือเจ้าของบัญชีกดลิงก์แล้วตั้งรหัสสำเร็จ
   * ระยะห่างระหว่างสองแถวนี้ และแถว REQUESTED ที่ไม่มี COMPLETED **ที่ `result = SUCCESS`** ตามมา
   * คือสิ่งที่ต้องดูเวลาสอบสวนว่าลิงก์ถูกส่งไปหาใครแล้วใครเป็นคนใช้
   *
   * COMPLETED มีแถว `result = FAILURE` ด้วย (ตั้งแต่การ์ด activity log): ลิงก์ที่กดแล้วใช้ไม่ได้ ได้ actor
   * ANONYMOUS (คนถือลิงก์ยังไม่ได้พิสูจน์ว่าเป็นเจ้าของบัญชี) `failure_reason` เป็นรหัสเดียวกับ `error`
   * ที่ตอบไป (`expired` · `revoked` · `used` · `inactive` · `not_found`) และ subject เป็นบัญชีของลิงก์นั้น
   * (ว่างเมื่อ `not_found`) — REQUESTED ตามด้วย COMPLETED ที่ล้มเหลวแปลว่ามีคนกดลิงก์แต่รหัสผ่าน
   * **ไม่ได้** เปลี่ยน คิวรีที่หา "ลิงก์ที่ไม่มีใครใช้" จึงต้องกรอง `result = 'SUCCESS'` เสมอ
   */
  PASSWORD_RESET_REQUESTED: "PASSWORD_RESET_REQUESTED",
  PASSWORD_RESET_COMPLETED: "PASSWORD_RESET_COMPLETED",

  /**
   * session ถูกเพิกถอน — เพิ่มจากรายการตัวอย่างใน sheet พร้อมตาราง `iam.session`
   * เหตุผลอยู่ใน `metadata_json.reason` (LOGOUT · LOGOUT_ALL · PASSWORD_CHANGED ·
   * ACCOUNT_SUSPENDED · ROTATED · EXPIRED) ไม่ได้แยกเป็น action คนละตัว เพราะทั้งหมด
   * คือเหตุการณ์เดียวกันที่มีสาเหตุต่างกัน และ sheet ไม่มี action ไหนตรงความหมายอยู่แล้ว
   */
  SESSION_REVOKED: "SESSION_REVOKED",

  /**
   * ยืนยันตัวตนกับ ThaID — เพิ่มจากรายการตัวอย่างใน sheet
   * §2.4 สั่งให้ "บันทึก Log การทำรายการ" ตอนเลขบัตรไม่ตรงโดยเฉพาะ ซึ่งไม่มี action
   * เดิมอันไหนตรงความหมาย (LOGIN_FAILED คนละเรื่อง — ยังไม่มีบัญชีให้ล็อกอินด้วยซ้ำ)
   *
   * FAILED ครอบ **ทุก** ความล้มเหลวของ callback ทั้งขา activate และขา login
   * (`metadata.purpose` บอกว่าขาไหน) และเขียนจากที่เดียว: `failThaidOperation()` ใน
   * lib/thaid-flow.ts ซึ่งเป็นจุดที่ทุกความล้มเหลวต้องผ่านอยู่แล้วเพื่อปิดแถว
   * integration_operation — `failure_reason` จึงเป็นรหัสเดียวกับ `last_error_code` ของแถวนั้น
   * และไม่เก็บ `error_description` ที่ ThaID ส่งมา (เป็นข้อความอิสระที่เราคุมไม่ได้) ส่วน `error`
   * ที่ไม่ใช่รูปรหัส OAuth ลงเป็น `thaid_error_unrecognised` (ดู `thaidCallbackErrorCode()`)
   * ยกเว้นสองกรณีที่เขียนแถวของตัวเองอยู่แล้ว (CID_MISMATCH และ LOGIN_FAILED ตอนไม่พบบัญชี)
   * กับ `state_*` ที่ callback เขียนเองเพราะบางกรณีไม่มีแถว integration_operation ให้ปิด
   */
  IDENTITY_VERIFIED: "IDENTITY_VERIFIED",
  IDENTITY_VERIFICATION_FAILED: "IDENTITY_VERIFICATION_FAILED",
  /**
   * พาผู้ใช้ออกไปยืนยันตัวตนที่ ThaID (`POST /api/auth/thaid/start`) — เพิ่มจากรายการตัวอย่างใน sheet
   *
   * คู่เปิดของสองตัวข้างบน: คนที่ไปถึงหน้า ThaID แล้วปิดแท็บทิ้งไม่เคยกลับมาที่ callback
   * ถ้าไม่มีจุดเริ่ม ความพยายามแบบนั้นไม่เหลือร่องรอยใน audit เลย (เหลือแค่แถว PENDING ใน
   * integration_operation) subject คือแถว integration_operation ไม่ใช่บัญชี เพราะขา login
   * ยังไม่รู้ว่าเป็นใครจนกว่าจะกลับมาพร้อมเลขบัตร
   */
  IDENTITY_VERIFICATION_STARTED: "IDENTITY_VERIFICATION_STARTED",

  /**
   * `x-admin-token` ผิดหรือไม่ได้ส่งมา — เพิ่มจากรายการตัวอย่างใน sheet
   *
   * token นี้เปิดได้ทุกอย่างใต้ `/api/admin` ไม่หมดอายุ และเคยหลุดออกไปแล้วครั้งหนึ่ง (ดู Traps
   * ใน CLAUDE.md) การเดาหรือการใช้ค่าเก่าหลังหมุนต้องมองเห็นได้ `metadata.token_fp` คือ 12
   * ตัวแรกของ SHA-256 ของค่าที่ส่งมา — พอจับคู่กับ fingerprint ของ token เก่าที่รู้อยู่ได้
   * โดยไม่ต้องเก็บค่าจริง
   *
   * 401 เป็นสิ่งที่คนนอกยิงได้ไม่จำกัด และตารางนี้ไม่มี retention จึงเขียนแบบ throttle
   * (เหตุผลเต็มอยู่หัว lib/token-rejection.ts):
   *   - หน้าต่าง 10 นาทีต่อ IP: ครั้งแรกเขียนทันที ที่เหลือนับไว้ แล้วเขียนแถวสรุปแถวเดียวตอน
   *     หน้าต่างปิด (`suppressed_count` · `token_fps` · `paths`)
   *   - แถวทันทีรวมทุก IP ไม่เกิน 20 แถวในช่วง 10 นาทีใด ๆ เกินแล้วนับรวมในถังเดียว แถวของถังนั้นมี
   *     `throttle_overflow: true` และ **ไม่มี IP กับ user agent** เพราะ IP ปลอมได้ทุกคำขอ
   *   - fingerprint ใน `ADMIN_TOKEN_WATCH_FPS` (token ที่ปลดแล้ว) ได้แถวของตัวเองนอกงบข้างบน
   *     พร้อม `watched_token: true` — IP ละแถวต่อนาที รวมไม่เกิน 60 แถวในช่วง 10 นาทีใด ๆ (งบเป็น
   *     หน้าต่างเลื่อน จับเวลายิงคร่อมรอบก็ไม่ได้เพิ่ม) ค่ามั่ว ๆ ที่ยิงเข้ามาก่อนจึงเบียด token เก่าให้
   *     หายไปจากแถวสรุปไม่ได้ IP เดิมยิงซ้ำภายในนาทีนั้นถูกนับเข้าหน้าต่างเงียบของ IP นั้น ซึ่งแยกจาก
   *     หน้าต่างปกติ (token อื่นจาก IP เดียวกันยังได้แถวทันทีของตัวเอง) แถวสรุปของมันมี
   *     `suppressed_count` เท่ากับ `watched_suppressed_count` ส่วนที่เกิน 60 ไปทางปกติ ใช้งบ 20 แถว
   *     ร่วมกัน และแถวทันทีของมันมี `watched_over_budget: true` แทน — `watched_token` จึงไม่เกิน 60
   *     จริง ครั้งที่ถูกนับทั้งหมดอยู่ใน `watched_suppressed_count` ของแถวสรุป
   *
   * `metadata.path` เป็นรูปแบบ ไม่ใช่ข้อความที่ผู้ยิงพิมพ์: ถอด `%xx` แล้ว UUID → `:id` ตัวอักษรนอก
   * ชุดที่ URL ปกติใช้ → `_` กลุ่มเลขที่ชี้ตัวคนได้ → `:n` (ติดกัน 6 หลัก หรือรวม 9 หลักขึ้นไปแม้มีขีด
   * จุด หรือช่องว่างคั่น) และถ้าทั้ง path ยังเหลือเลขรวม 9 ตัวขึ้นไป (คั่นด้วย `/` หรือ encode ซ้อน)
   * เลขทุกช่วงเป็น `:n` ยาวไม่เกิน 120 ตัว ตัวอักษรยังเหลืออยู่ — ช่องนี้เป็นข้อความของผู้ยิงเสมอ
   *
   * `user_agent` ก็เป็นข้อความของผู้ยิง ยาวไม่เกิน 512 ตัว และเลขบัตร/เบอร์โทรในรูปที่คนพิมพ์ถูกปิด
   * แต่เลขที่คั่นด้วยจุดและตัวอักษรยังผ่าน (`storedUserAgent()` ใช้กับทุกแถว ไม่ใช่แค่แถวนี้)
   *
   * `ip_address` คือค่าสุดท้ายของ X-Forwarded-For ซึ่งผู้เรียกตั้งเองได้ ทั้งตอนยิง backend ตรงและ
   * ตอนยิงผ่านหน้าเว็บ (ดู `parseClientIp()` ใน lib/context.ts)
   */
  ADMIN_TOKEN_REJECTED: "ADMIN_TOKEN_REJECTED",

  /**
   * `x-log-token` ผิดหรือไม่ได้ส่งมาที่ `/api/admin/logs/*` — เพิ่มจากรายการตัวอย่างใน sheet
   *
   * token นี้เปิดอ่าน log ทั้งหมด (ทุกการกระทำของทุกคน และ error) จึงต้องเห็นการเดาได้เหมือน `ADMIN_TOKEN_REJECTED`
   * และเขียนด้วยตัวบันทึกเดียวกัน (lib/token-rejection.ts) — หน้าต่าง 10 นาทีต่อ IP งบแถวทันที 20 แถว ถังรวมที่ไม่มี IP
   * แถวสรุป `suppressed_count` `token_fps` `paths` ตัวนับแยกจากของ admin token ส่วน token ที่ปลดแล้วไม่มีรายการเฝ้า
   * (`watched_token` มีแค่ของ admin) subject `AUDIT_LOG` · `subject_id` null · แถวนิรนาม `source_component = web-portal`
   *
   * `LOG_READ_TOKEN` ที่ไม่ได้ตั้งไม่ใช่การปฏิเสธ: API ตอบ 503 `log_access_disabled` ก่อนดู token และไม่เขียนแถวนี้
   */
  LOG_TOKEN_REJECTED: "LOG_TOKEN_REJECTED",

  /**
   * มีคนอ่าน log ผ่าน `/api/admin/logs/*` — หนึ่งแถวต่อหนึ่งคำขอ เขียน**ก่อน**ส่งข้อมูลกลับ (`recordLogRead()`)
   *
   * log รวมทุกอย่างที่ admin API เห็นบวกประวัติการกระทำของทุกคน การอ่านจึงต้องทิ้งร่องรอยเสมอ (plan decision 9)
   * ต่างจากแถวอื่นตรงที่**ไม่กลืน error**: เขียน Postgres ไม่ได้ก็เขียนสำเนาลง log store (`source: "audit_fallback"`)
   * และรอผล ไม่ได้ทั้งคู่ API ตอบ 503 `log_read_unrecorded` โดยไม่ส่งข้อมูลใด ๆ — ซึ่งเกิดได้เฉพาะเมื่อ Mongo ล้มระหว่างคำขอ:
   * API ping Mongo ก่อนบันทึก Mongo ที่ล่มอยู่แล้วจึงได้ 503 `log_store_unavailable` ก่อนถึงแถวนี้ (ไม่มีอะไรให้ส่ง จึงไม่มี
   * การอ่านให้บันทึก) แม้ Postgres จะล่มด้วย · `GET /status` ไม่มีแถวนี้ (ไม่มีข้อมูลบุคคล)
   *
   * `metadata`: `reader` (อีเมลที่ผู้อ่าน**ประกาศ**ใน `x-log-reader` — ไม่ได้พิสูจน์) · `reason` (ข้อความจาก `x-log-reason`
   * อาจเป็น null บน endpoint ของ error ที่ไม่บังคับ) · `endpoint` (`GET /api/admin/logs/activity`) · `filters` (ค่าที่ใช้ค้น —
   * `cid` `email` เก็บเป็น key HMAC `cid#…` / `email#…` เท่านั้น · `person` ที่ส่งมาเป็นอีเมลของบัญชีเก็บเป็น uuid ของบัญชี
   * บวก `personEmailKey` (`email#…` เมื่อตั้ง LOG_HASH_KEY — ค้นทั้งสองทางจริง) อีเมลที่ไม่มีบัญชีเก็บเป็น `email#…` ไม่เคย
   * เป็นอีเมลจริง ส่วนเลขที่คำขอกับรหัสหน่วยงานเก็บตามจริงเพราะไม่ใช่ข้อมูลบุคคล) · `token_fp` (12 ตัวแรกของ SHA-256 ของ
   * `x-log-token` ที่ใช้) · `page`
   * actor เป็นระบบ (`SYSTEM`, ไม่มี id) เหมือนงานผ่าน admin token · `source_component = log-api` · subject `AUDIT_LOG`
   */
  AUDIT_LOG_READ: "AUDIT_LOG_READ",

  /**
   * เปลี่ยนสถานะของ error issue ผ่าน `PATCH /api/admin/logs/errors/issues/:fingerprint` — open · resolved · ignored
   *
   * สถานะตัดสินว่า issue จะเปิดกลับเองเมื่อเกิดซ้ำไหม และ (step 10) จะส่งอีเมลแจ้งเตือนไหม การปิดหรือละเว้นจึงเป็น
   * การตัดสินใจที่ต้องตอบได้ว่าใครทำด้วยเหตุผลอะไร `before`/`after` คือ `{status, statusReason}` ก่อนและหลัง
   * `metadata.fingerprint` คือ issue (`subject_id` เป็น null เพราะ fingerprint ไม่ใช่ uuid) `metadata.reason` คือเหตุผล
   * ที่ส่งมาใน body `metadata.reader` / `token_fp` เหมือน `AUDIT_LOG_READ`
   */
  ERROR_ISSUE_STATUS_CHANGED: "ERROR_ISSUE_STATUS_CHANGED",

  DATA_EXPORTED: "DATA_EXPORTED",
  DOCUMENT_DOWNLOADED: "DOCUMENT_DOWNLOADED",

  /**
   * เผยแพร่ template เอกสารกฎหมายฉบับใหม่ — เพิ่มจากรายการตัวอย่างใน sheet
   *
   * เนื้อความของเอกสารที่หน่วยงานลงนามเปลี่ยนได้โดยไม่ต้อง deploy จึงต้องมีร่องรอยว่า
   * ใครเปลี่ยนเป็นเวอร์ชันไหนเมื่อไร ไม่มี action เดิมอันไหนตรงความหมายนี้
   *
   * subject คือแถว **เวอร์ชัน** ที่เพิ่งออก `metadata.legal_document_id` จึงเก็บ id ของเอกสารไว้ด้วย
   * ให้ค้นแถวนี้คู่กับ `LEGAL_DOCUMENT_UPDATED` ของเอกสารเดียวกันได้ (แถวก่อนการ์ด activity log ไม่มี)
   */
  LEGAL_DOCUMENT_PUBLISHED: "LEGAL_DOCUMENT_PUBLISHED",

  /**
   * แก้ข้อมูลประจำตัวของเอกสารกฎหมาย (`PATCH /api/admin/legal-documents/:code`: ชื่อสั้น คำเตือนใน
   * กล่องลงนาม และบังคับหรือไม่) — เพิ่มจากรายการตัวอย่างใน sheet
   *
   * เดิมเส้นทางนี้เขียน `LEGAL_DOCUMENT_PUBLISHED` คนอ่าน log จึงเข้าใจว่ามีเนื้อความฉบับใหม่ออกมา
   * ทั้งที่ไม่มีเวอร์ชันใหม่เกิดขึ้น สองอย่างนี้ต้องแยกกัน เพราะอันนั้นเปลี่ยนสิ่งที่หน่วยงานลงนาม ส่วนอันนี้
   * เปลี่ยนป้าย คำเตือน และว่าผู้มีอำนาจฯ กดข้ามได้หรือไม่ subject คือแถว `legal_document` before/after
   * เก็บเฉพาะช่องที่เปลี่ยน แถวก่อนการ์ด activity log ของเส้นทางนี้ยังเป็นรหัสเดิม
   */
  LEGAL_DOCUMENT_UPDATED: "LEGAL_DOCUMENT_UPDATED",

  /** ลงนามอิเล็กทรอนิกส์บนเอกสารข้อตกลง (signature.signature_confirmation) */
  DOCUMENT_SIGNED: "DOCUMENT_SIGNED",

  /**
   * เพิ่ม แก้ หรือปิดตัวเลือกในแบบฟอร์มลงทะเบียนชุดข้อมูล — เพิ่มจากรายการตัวอย่างใน sheet
   *
   * ด้วยเหตุผลเดียวกับ LEGAL_DOCUMENT_PUBLISHED: ตัวเลือกที่หน่วยงานเห็นและเลือก
   * เปลี่ยนได้โดยไม่ต้อง deploy จึงต้องมีร่องรอยว่าใครเปลี่ยนอะไรเมื่อไร คำขอที่
   * นำส่งไปแล้วอ้างรหัสเหล่านี้ และเอกสารที่ลงนามแล้วพิมพ์ป้ายของมันลงกระดาษ
   */
  DATASET_CHOICE_CHANGED: "DATASET_CHOICE_CHANGED",

  /**
   * ผู้เชี่ยวชาญด้านข้อมูลบันทึกความเห็นต่อคำขอชุดข้อมูล
   *
   * ไม่ใช่ `REQUEST_APPROVED` และไม่ใช่ `REQUEST_RETURNED` — ความเห็นไม่ปิดด่านและไม่ย้าย
   * คำขอไปไหน (`recordAdvisoryNote()` ใน lib/workflow.ts) แต่มันคือสิ่งที่ผู้ประสานงานของ BDI
   * ใช้ประกอบการตัดสินใจที่ด่านถัดไป จึงต้องตอบได้ว่าใครเขียนเมื่อไร ก่อนหน้านี้เส้นทางนี้
   * ไม่เขียน audit_event เลยสักแถว
   */
  SPECIALIST_COMMENT_RECORDED: "SPECIALIST_COMMENT_RECORDED",
} as const;

export type AuditActionCode = (typeof AuditAction)[keyof typeof AuditAction];

/** subject_type ตามตัวอย่างใน sheet */
export const AuditSubject = {
  USER_ACCOUNT: "USER_ACCOUNT",
  USER_ROLE_ASSIGNMENT: "USER_ROLE_ASSIGNMENT",
  USER_ACTIVATION_KEY: "USER_ACTIVATION_KEY",
  /** แถว `iam.session` หนึ่งใบ — เพิ่มพร้อมตารางนั้น ไม่มีใน sheet */
  SESSION: "SESSION",
  ORGANIZATION: "ORGANIZATION",
  ORGANIZATION_REGISTRATION_REQUEST: "ORGANIZATION_REGISTRATION_REQUEST",
  DATASET: "DATASET",
  DATASET_REGISTRATION_REQUEST: "DATASET_REGISTRATION_REQUEST",
  DATA_REQUEST: "DATA_REQUEST",
  APPROVAL: "APPROVAL",
  ATTACHMENT: "ATTACHMENT",
  LEGAL_DOCUMENT: "LEGAL_DOCUMENT",
  /**
   * ตัวเลือกหนึ่งแถวใน `administration.dataset_choice` — ไม่มีใน sheet
   * `DATASET` หมายถึงชุดข้อมูลที่ลงทะเบียนแล้ว จึงใช้แทนกันไม่ได้
   */
  DATASET_CHOICE: "DATASET_CHOICE",
  NOTIFICATION: "NOTIFICATION",
  INTEGRATION_JOB: "INTEGRATION_JOB",
  /**
   * API ฝั่งผู้ดูแลระบบทั้งก้อน (`/api/admin/*`) — ไม่มีใน sheet เพิ่มพร้อม `ADMIN_TOKEN_REJECTED`
   * คำขอที่ถูกปฏิเสธไม่ได้แตะแถวไหนเลย `subject_id` จึงเป็น null เสมอ เส้นทางที่ถูกยิงอยู่ใน
   * `metadata.path` (ในรูปแบบที่ปรับแล้ว ดู `ADMIN_TOKEN_REJECTED`)
   */
  ADMIN_API: "ADMIN_API",
  /**
   * API อ่าน log (`/api/admin/logs/*`) — ไม่มีใน sheet เพิ่มพร้อม `AUDIT_LOG_READ` และ `LOG_TOKEN_REJECTED`
   * `subject_id` เป็น null เสมอ: สิ่งที่ถูกอ่านอยู่ใน `metadata.endpoint` กับ `metadata.filters`
   */
  AUDIT_LOG: "AUDIT_LOG",
  /**
   * error issue หนึ่งตัวใน log store (`error_issues`) — ไม่มีใน sheet เพิ่มพร้อม `ERROR_ISSUE_STATUS_CHANGED`
   * `subject_id` เป็น null เพราะคอลัมน์เป็น uuid แต่ id ของ issue คือ fingerprint — อยู่ใน `metadata.fingerprint`
   */
  ERROR_ISSUE: "ERROR_ISSUE",
} as const;

export type AuditSubjectType = (typeof AuditSubject)[keyof typeof AuditSubject];

export interface AuditInput {
  action: AuditActionCode;
  subjectType: AuditSubjectType;
  subjectId?: string | null;
  organizationId?: string | null;
  actorId?: string | null;
  actorType?: AuditActorType;
  result?: AuditResult;
  before?: unknown;
  after?: unknown;
  /** ข้อมูลเพิ่มเติม เช่น { failure_reason: "INVALID_CREDENTIAL" } */
  metadata?: Record<string, unknown>;
}

/** surrogate ครึ่งคู่ — ตัวหน้าที่ไม่มีตัวหลังตาม หรือตัวหลังที่ไม่มีตัวหน้านำ (ไม่ใช้ flag `u` เพราะต้องเทียบทีละ code unit) */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/**
 * ข้อความในรูปที่ Postgres เก็บได้ — ตัด U+0000 และแทน surrogate ครึ่งคู่ด้วย U+FFFD
 *
 * ทั้งสองอย่างทำให้ TEXT และ jsonb ปฏิเสธทั้งแถว: Postgres ไม่มี `\u0000` ใน UTF-8 และ surrogate ที่ไม่มีคู่
 * ไม่ใช่ UTF-8 ที่ถูกต้อง (Prisma ล้มด้วย "unexpected end of hex escape") ค่าที่อ่านมาจากฐานข้อมูลไม่มีสองตัวนี้
 * ตัวที่มาได้คือข้อความที่ผู้เรียกส่งมาใน JSON body (`"\ud83d"` เป็น JSON ที่ถูกต้อง) หรือการตัดความยาวที่ผ่า
 * อีโมจิกลางคู่ ทำเองแทน `String.prototype.toWellFormed()` เพราะ lib ของ tsconfig เป็น ES2023 ซึ่งยังไม่มีตัวนั้น
 */
export function storableText(text: string): string {
  return text.replaceAll("\u0000", "").replace(LONE_SURROGATE, "\uFFFD");
}

/**
 * Date และ undefined ลง Json column ไม่ได้ ต้องแปลงเป็นค่าที่ serialize ได้ก่อน
 *
 * ทุก string ผ่าน `storableText()` ไปด้วย ไม่งั้นข้อความเดียวที่ jsonb ไม่รับทำให้ INSERT ล้มทั้งแถว
 * และ logAudit กลืน error นั้นไว้ แถวจึงหายเงียบ ๆ
 */
function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  const json = JSON.stringify(value, (_key, v: unknown) =>
    typeof v === "string" ? storableText(v) : v,
  );
  return JSON.parse(json) as Prisma.InputJsonValue;
}

/**
 * ความยาวของคอลัมน์ VARCHAR ใน audit.audit_event (schema.prisma) — `user_agent` เป็น TEXT จึงไม่อยู่ในนี้
 * (ยาวแค่ไหน INSERT ก็ไม่ล้ม แต่ถูกตัดด้วยเหตุผลอื่น ดู `storedUserAgent()`)
 *
 * ค่าที่ยาวเกินไม่ได้ถูกตัดโดย Postgres แต่ทำให้ INSERT ล้มทั้งแถว และ logAudit กลืน error นั้นไว้
 * แถวจึงหายเงียบ ๆ ทั้งที่ส่วนที่เหลือถูกต้องหมด ต้นทางของแต่ละค่าตรวจไว้แล้ว (IP ผ่าน
 * `parseClientIp()` correlation id ต้องเป็น UUID) ตัวนี้คือด่านสุดท้าย: ค่าที่ผู้เรียกมีส่วนกำหนด
 * ต้องไม่มีทางทำให้บันทึกหายได้อีก ตัดทิ้งส่วนเกินยังดีกว่าไม่มีแถว
 */
const COLUMN_MAX = {
  action: 128,
  subjectType: 64,
  ipAddress: 64,
  correlationId: 64,
  sourceComponent: 64,
} as const;

function fit(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

/** user agent ของเบราว์เซอร์และแอปจริงยาวไม่เกินราว 350 ตัว (in-app browser ยาวที่สุด) */
const USER_AGENT_MAX = 512;
/**
 * กลุ่มเลขที่คั่นด้วย `-` `_` `:` หรือช่องว่าง — **ไม่รวม `.`** ต่างจากกฎของ path ใน
 * lib/token-rejection.ts เพราะ user agent จริงเต็มไปด้วยเลขเวอร์ชันแบบมีจุด
 */
const USER_AGENT_DIGIT_GROUP = /\d(?:[-_: ]{0,3}\d)*/g;

/**
 * user agent ในรูปที่เก็บลง audit_event: กลุ่มเลข 9 หลักขึ้นไป → `:n` แล้วตัดที่ `USER_AGENT_MAX`
 *
 * header นี้ผู้เรียกเขียนเองทั้งหมด และแถวที่ไม่ต้องล็อกอินก่อน (`LOGIN_FAILED`,
 * `ADMIN_TOKEN_REJECTED`) ใครก็เขียนได้ไม่จำกัดจำนวน ตารางนี้ไม่มี retention และห้าม update จึงเป็น
 * ช่องเดียวกับที่ `metadata.path` ของการปฏิเสธ token ถูกปิดไว้: ไม่งั้นใครก็เขียนเลขบัตรของคนอื่น
 * ลงหลักฐานได้ ยาวได้เท่าที่ Node รับ header (16 KB) ต่อแถว
 *
 * กฎเลขหลวมกว่าของ path เพราะต้องไม่แตะ user agent จริง: `.` ไม่นับเป็นตัวคั่น
 * (`Edg/151.0.3405.80` รวมได้ 10 หลัก) และเลขติดกัน 6–8 หลักไม่นับ (`Gecko/20100101`,
 * `Build/UP1A.231005.007`) ที่ถูกปิดคือเลขบัตรและเบอร์โทรในรูปที่คนพิมพ์ (ติดกัน มีขีด หรือเว้นวรรค)
 * ส่วนที่ยังผ่านได้: ตัวอักษรทั้งหมด เลขที่คั่นด้วย `.` หรือ `/` และตัวคั่นเกินสามตัว — อ่านคอลัมน์นี้
 * เป็นข้อความของผู้เรียกเสมอ เลขรุ่น build ยาว ๆ ของบางแอป (`FBBV/540101231`) โดนปิดไปด้วย ซึ่งไม่เสีย
 * อะไรในการสอบสวน
 *
 * ใช้กับทุกแถวของ audit_event ไม่ใช่เฉพาะแถวนิรนาม กฎเดียวง่ายกว่าให้คนอ่านรู้ว่าคอลัมน์นี้ผ่านอะไรมา
 * ส่วน `iam.session` กับหลักฐานการลงนามยังเก็บค่าที่ได้รับ เพราะเกิดได้หลังยืนยันตัวตนแล้วเท่านั้น
 */
export function storedUserAgent(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return raw
    .replace(USER_AGENT_DIGIT_GROUP, (group) => (group.replace(/\D/g, "").length >= 9 ? ":n" : group))
    .slice(0, USER_AGENT_MAX);
}

/**
 * metadata ในรูปที่ลงแถว — snapshot ของผู้กระทำ + ของผู้เรียก + สองคีย์ที่เติมจากบริบทเสมอ
 * (lib/audit-fallback.ts ประกอบสำเนาของแถวที่ Postgres ไม่รับด้วยลำดับเดียวกันนี้ — แก้ที่นี่ต้องแก้ที่นั่นด้วย)
 */
function auditMetadata(
  input: Pick<AuditInput, "metadata">,
  actorSnapshot: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const ctx = currentContext();
  return {
    ...actorSnapshot,
    ...input.metadata,
    // IP ที่ส่งมาไม่ใช่ IP (ดู parseClientIp) — บอกไว้ว่ามีค่ามาแต่ไม่เก็บ ไม่ใช่ไม่มีค่ามาเลย
    ...(ctx?.ipUnparsed ? { ip_unparsed: true } : {}),
    // มาทาง admin API — token ใบไหน (ดู requireAdminToken) มาหลัง input.metadata ให้ผู้เรียกทับไม่ได้
    ...(ctx?.adminTokenFp ? { admin_token_fp: ctx.adminTokenFp } : {}),
  };
}

/** แถวหนึ่งแถวในรูปที่ INSERT — ทางเดียวที่ประกอบแถว audit_event ทั้ง `logAudit()` และ `recordLogRead()` ใช้ */
function auditEventData(
  input: AuditInput,
  actorId: string | null,
  actorSnapshot: Record<string, unknown> | undefined,
  userAgent: string | null,
): Prisma.AuditEventUncheckedCreateInput {
  const ctx = currentContext();
  const metadata = auditMetadata(input, actorSnapshot);
  return {
    action: fit(input.action, COLUMN_MAX.action),
    actorType: input.actorType ?? (actorId ? AuditActorType.USER : AuditActorType.SYSTEM),
    actorId,
    subjectType: fit(input.subjectType, COLUMN_MAX.subjectType),
    subjectId: input.subjectId ?? null,
    organizationId: input.organizationId ?? null,
    result: input.result ?? AuditResult.SUCCESS,
    beforeSummaryJson: toJson(input.before),
    afterSummaryJson: toJson(input.after),
    ipAddress: ctx?.ipAddress ? fit(ctx.ipAddress, COLUMN_MAX.ipAddress) : null,
    userAgent,
    correlationId: fit(correlationId(), COLUMN_MAX.correlationId),
    sourceComponent: fit(sourceComponent(), COLUMN_MAX.sourceComponent),
    metadataJson: Object.keys(metadata).length > 0 ? toJson(metadata) : undefined,
  };
}

/**
 * เขียน audit event หนึ่งแถว
 *
 * ล้มเหลวแล้วไม่ throw ต่อ: การบันทึก log ต้องไม่ทำให้คำขอที่ผู้ใช้กดสำเร็จไปแล้วพัง แต่ก็ไม่หายเงียบ — ความล้มเหลว
 * ไปเป็น error event `audit.write-failed` กับสำเนาของแถวใน log store (lib/audit-fallback.ts) และทิ้ง breadcrumb ไว้
 * ให้ error ตัวถัดไปของคำขอเดียวกันเห็นว่า audit ของมันเขียนแล้วหรือยัง
 */
export async function logAudit(input: AuditInput): Promise<void> {
  const ctx = currentContext();
  const actorId = input.actorId ?? ctx?.actorId ?? null;
  const userAgent = storedUserAgent(ctx?.userAgent);
  // ชื่อและ role ณ เวลานั้น — ดีไซน์ไม่มีคอลัมน์ให้ จึงเก็บลง metadata_json
  let actorSnapshot: Record<string, unknown> | undefined;
  try {
    if (actorId) {
      const actor = await prisma.userAccount.findUnique({
        where: { id: actorId },
        select: {
          ...NAME_FIELDS,
          email: true,
          roleAssignments: {
            where: { status: RoleAssignmentStatus.ACTIVE },
            select: { role: { select: { code: true } }, organizationId: true },
          },
        },
      });
      if (actor) {
        actorSnapshot = {
          // audit ไม่เคยขึ้นหน้าจอ (ดู CLAUDE.md) อีเมลจึงเป็นตัวสำรองที่ดีกว่าค่าว่าง
          // ตรงนี้ — บันทึกต้องชี้ตัวคนได้แม้บัญชีนั้นยังไม่มีชื่อไทย
          actor_name: fullNameTh(actor) || actor.email,
          actor_roles: actor.roleAssignments.map((a) => a.role.code),
          actor_organization_id: actor.roleAssignments.find((a) => a.organizationId)?.organizationId,
        };
      }
    }

    await prisma.auditEvent.create({ data: auditEventData(input, actorId, actorSnapshot, userAgent) });
    addBreadcrumb("audit", input.action);
  } catch (err) {
    addBreadcrumb("audit", `${input.action} — เขียนไม่สำเร็จ`, false);
    /**
     * ไม่พิมพ์ `err` ดิบอีกแล้ว: `PrismaClientValidationError` ยก argument ทั้งก้อนของ INSERT มาในข้อความ ซึ่งก็คือ
     * before/after/metadata พร้อมอีเมลและเลขบัตร — captureError พิมพ์บรรทัดที่กวาดแล้วแทน พร้อม id ของ event
     */
    reportAuditWriteFailure(err, input, { actorId, actorSnapshot, userAgent });
  }
}

/** การอ่าน log หนึ่งครั้งตามที่ `recordLogRead()` บันทึก — ค่าใน `filters` ต้องผ่านการแปลงเป็น key HMAC มาแล้ว */
export interface LogReadRecord {
  /** อีเมลที่ผู้อ่านประกาศใน `x-log-reader` (ASCII ตัวพิมพ์เล็ก) — ไม่ได้พิสูจน์ */
  reader: string;
  /** ข้อความจาก `x-log-reason` ที่ถอด percent-encoding แล้ว — null บน endpoint ที่ไม่บังคับ */
  reason: string | null;
  /** `GET /api/admin/logs/activity` — method กับ route แบบแม่แบบ */
  endpoint: string;
  /**
   * ตัวกรองที่ใช้ — ไม่มีเลขบัตรหรืออีเมลจริง: `cid` `email` เป็น `cid#…` / `email#…` แล้ว · `person` ที่เป็นอีเมลของบัญชีเป็น
   * uuid ของบัญชี (บวก `personEmailKey`) อีเมลที่ไม่มีบัญชีเป็น `email#…` (`PersonRef.recorded` ใน routes/admin-logs.ts)
   */
  filters: Record<string, unknown>;
  page?: number | null;
  /** `tokenFingerprint()` ของ `x-log-token` ที่ใช้ */
  tokenFp: string;
}

/**
 * บันทึกการอ่าน log หนึ่งครั้ง **ก่อน** ส่งข้อมูลกลับ — `AUDIT_LOG_READ` (plan §6, decision 9)
 *
 * ต่างจาก `logAudit()` ตรงที่**ไม่กลืน error**: การอ่านที่ไม่มีร่องรอยห้ามเกิด ลำดับคือ
 *   1. INSERT ลง Postgres ตรง ๆ ภายในเพดานของ `withDatabaseDeadline()` (db.ts: 2 วินาที, 0.3 วินาทีถ้าเพิ่งติดต่อไม่ได้ —
 *      Postgres ที่ล่มจึงไม่ทำให้ทุกการอ่านรอเต็มเพดาน) — ได้ id ของแถวเป็น `readId` INSERT ที่เลิกรอแล้วยัง commit ทีหลังได้
 *      การอ่านครั้งนั้นจึงอาจมีสองบันทึก (ดู `recordLogReadFallback()`)
 *   2. ไม่ได้ → เก็บ error (`audit.log-read-failed`) แล้วเขียนสำเนาลง log store (`source: "audit_fallback"`) และรอผล
 *      ไม่เกิน 2 วินาที — ได้ `_id` ของสำเนาเป็น `readId`
 *   3. ไม่ได้ทั้งคู่ → คืน null ผู้เรียกตอบ 503 `log_read_unrecorded` โดยไม่ส่งข้อมูลใด ๆ — route ใน admin-logs.ts ping
 *      Mongo ก่อนเรียกที่นี่ ข้อนี้จึงเกิดเมื่อ Mongo ล้มระหว่างคำขอ Mongo ที่ล่มอยู่แล้วได้ `log_store_unavailable` ไปก่อน
 *
 * แถวมาจาก `auditEventData()` ตัวเดียวกับ logAudit (IP, user agent, correlation id, source_component ของคำขอ) actor
 * เป็น `SYSTEM` ไม่มี id — ผู้อ่านไม่ใช่บัญชีในระบบ ตัวตนที่ประกาศมาอยู่ใน `metadata.reader`
 */
export async function recordLogRead(
  read: LogReadRecord,
): Promise<{ readId: string; recordedIn: "postgres" | "log_store" } | null> {
  const input: AuditInput = {
    action: AuditAction.AUDIT_LOG_READ,
    subjectType: AuditSubject.AUDIT_LOG,
    actorType: AuditActorType.SYSTEM,
    metadata: {
      reader: read.reader,
      reason: read.reason,
      endpoint: read.endpoint,
      filters: read.filters,
      token_fp: read.tokenFp,
      ...(read.page === undefined || read.page === null ? {} : { page: read.page }),
    },
  };
  const userAgent = storedUserAgent(currentContext()?.userAgent);
  try {
    const row = await withDatabaseDeadline(() =>
      prisma.auditEvent.create({ data: auditEventData(input, null, undefined, userAgent), select: { id: true } }),
    );
    addBreadcrumb("audit", input.action);
    return { readId: row.id, recordedIn: "postgres" };
  } catch (err) {
    addBreadcrumb("audit", `${input.action} — เขียนไม่สำเร็จ`, false);
    const fallbackId = await recordLogReadFallback(err, input, userAgent);
    return fallbackId ? { readId: fallbackId, recordedIn: "log_store" } : null;
  }
}

/**
 * คืนเฉพาะฟิลด์ที่เปลี่ยนจริง — เก็บทั้ง record ทุกครั้งทำให้ log อ่านไม่ออก
 * เทียบด้วย JSON เพื่อให้ Date และ array เทียบได้โดยไม่ต้องแยกกรณี
 */
export function diffFields<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
): { before: Partial<T>; after: Partial<T> } | null {
  const changedBefore: Partial<T> = {};
  const changedAfter: Partial<T> = {};
  let changed = false;

  for (const key of Object.keys(after) as Array<keyof T>) {
    const a = JSON.stringify(before[key] ?? null);
    const b = JSON.stringify(after[key] ?? null);
    if (a !== b) {
      changedBefore[key] = before[key];
      changedAfter[key] = after[key];
      changed = true;
    }
  }

  return changed ? { before: changedBefore, after: changedAfter } : null;
}

/**
 * ตัด key ที่ไม่ได้ถูกเขียนออกก่อนเทียบว่าอะไรเปลี่ยน
 *
 * ตัวแปลงค่าอย่าง `toRequestData()` คืน **ทุก** key เสมอ โดยที่ช่องที่ไม่ได้ส่งมาเป็น
 * `undefined` — Prisma ข้าม `undefined` ให้อยู่แล้ว การอัปเดตจึงถูกต้อง แต่ `diffFields()`
 * เดินตาม `Object.keys(after)` และอ่าน `undefined` เป็น `null` แล้วต่างจากค่าเดิมทุกช่อง —
 * `fields_changed` จะบอกว่าแก้ทั้งใบทั้งที่แตะช่องเดียว บันทึกที่มีไว้ตอบว่า "อะไรเปลี่ยน" ก็ตอบผิด
 *
 * `null` **ไม่ถูกตัด** เพราะมันคือการสั่งล้างค่าจริง ๆ (`phoneExtensionSchema` แปลง `""`
 * เป็น `null`) ต่างจาก `providedOnly()` ในฟอร์มที่ตัดทั้งคู่ด้วยเหตุผลคนละเรื่อง
 */
export function sentOnly<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}

/**
 * `""` เป็น `null` ก่อนเทียบ — ใช้กับ diff ที่เพิ่มในการ์ด activity log เท่านั้น
 *
 * ร่างเก่าเก็บช่องว่างไว้ทั้งสองแบบ (แล้วแต่ว่าบันทึกผ่านทางไหน) และสำหรับคนอ่าน log ทั้งคู่
 * แปลว่า "ยังไม่ได้กรอก" เหมือนกัน ถ้าไม่ปรับ การกดบันทึกเฉย ๆ จะได้แถวที่บอกว่า `""` กลายเป็น
 * `null` ซึ่งไม่มีใครแก้อะไรเลย ไม่ได้ย้ายเข้าไปใน `diffFields()` เพราะนั่นจะเปลี่ยนเนื้อของ
 * `REQUEST_UPDATED` ที่เขียนอยู่แล้ว
 */
export function blankAsNull<T extends object>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [k, v === "" ? null : v]),
  ) as T;
}

/**
 * ชื่อ key ที่ถือเลขประจำตัวประชาชน — `approverCid` `userCid` `signatoryNationalId` `pid`
 * และ `thaid_subject` ซึ่งคือ `sub` ของ DOPA ที่เป็นเลขบัตร 13 หลักไม่ว่า `THAID_USE_PID`
 * จะตั้งไว้อย่างไร (ดู Traps ใน CLAUDE.md) ตัดสินจากชื่อ key ไม่ใช่จากรูปของค่า: ร่างที่กรอก
 * ครึ่ง ๆ กลาง ๆ มีเลขไม่ครบ 13 หลักได้ และมันก็ยังเป็นเลขบัตรของคนอยู่ดี
 */
const CID_KEY = /cid$|nationalid|^pid$|^thaid_subject$/i;

/** เหลือ 4 ตัวท้ายไว้ให้คนอ่าน log เทียบกับเอกสารได้ — ค่าที่สั้นกว่านั้นปิดทั้งหมด */
function maskCid(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  const text = String(value);
  const shown = text.length > 4 ? text.slice(-4) : "";
  return { masked: "x".repeat(text.length - shown.length) + shown, changed: true };
}

function sanitizeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeValue);
  // เฉพาะ object ธรรมดา — Date และ Decimal ของ Prisma ต้องผ่านไปทั้งตัวให้ toJson() แปลง
  const proto = value !== null && typeof value === "object" ? Object.getPrototypeOf(value) : undefined;
  if (proto === Object.prototype || proto === null) {
    return Object.fromEntries(
      Object.entries(value as object).map(([k, v]) => [k, CID_KEY.test(k) ? maskCid(v) : sanitizeValue(v)]),
    );
  }
  return value;
}

/**
 * ปิดเลขบัตรใน diff ก่อนลง `audit_event` — คอลัมน์ในดีไซน์ชื่อ "Sanitized state before/after"
 *
 * ไม่มีขั้นนี้ การบันทึกร่างของหน่วยงานทุกครั้งที่แตะช่องเลขบัตรของผู้มีอำนาจฯ จะเขียนเลขเต็ม
 * ลงตารางที่ไม่มี retention ค่าที่ถูกปิดเป็น `{masked: "xxxxxxxxx1234", changed: true}` —
 * `changed` บอกว่ามีการเปลี่ยนจริง แม้ 4 ตัวท้ายของค่าเก่ากับค่าใหม่จะบังเอิญตรงกัน
 *
 * ใช้กับ diff ที่เพิ่มในการ์ด activity log — ตัดสินที่ **จุดที่เขียน** ไม่ใช่ที่รหัส: จุดที่เขียนรหัสเดิมมาตั้งแต่
 * ก่อนการ์ด (`ACTIVATION_KEY_ISSUED` ของ `POST /api/admin/invitations`, `INVITATION_DELETED`,
 * `REQUEST_UPDATED` ฯลฯ) ยังเก็บเลขบัตรแบบเดิมจนกว่า BDI จะตัดสินเรื่องนั้น ส่วนจุดใหม่ที่เขียนรหัสเดิม
 * (`ACTIVATION_KEY_ISSUED` ของคำเชิญผู้มีอำนาจฯ) ปิดเหมือน diff ใหม่ทุกตัว
 */
export function sanitizeDiff(
  diff: { before: object; after: object } | null,
): { before: Record<string, unknown>; after: Record<string, unknown> } | null {
  if (!diff) return null;
  return {
    before: sanitizeState(diff.before),
    after: sanitizeState(diff.after),
  };
}

/**
 * กฎเดียวกับ `sanitizeDiff()` สำหรับแถวที่มีสถานะเดียว — การสร้าง (`USER_ACCOUNT_CREATED`,
 * `ACTIVATION_KEY_ISSUED` ที่เพิ่มในการ์ด activity log) ไม่มี before ให้ diff แต่ `after` ยังถือเลขบัตรอยู่
 */
export function sanitizeState(state: object): Record<string, unknown> {
  return sanitizeValue(state) as Record<string, unknown>;
}
