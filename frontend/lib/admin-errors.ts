/**
 * คำตอบที่ไม่สำเร็จของ /api/admin/* → หัวข้อสั้น ๆ กับ "ทำอะไรต่อ" สำหรับหน้า /console
 *
 * ข้อความของ backend (`ApiError.message`) ยังแสดงอยู่ใต้หัวข้อเสมอ — มันบอกชื่อและอีเมลที่ชนกัน ซึ่งหัวข้อที่นี่ไม่รู้
 * สิ่งที่ไฟล์นี้เพิ่มคือลิงก์ไปยังสิ่งที่ต้องแก้ก่อน: 409 ของ API นี้ส่วนใหญ่แปลว่า "มีอย่างอื่นขวางอยู่" และ body แนบ id
 * ของสิ่งนั้นมาแล้ว (ดู `ApiError.details`) ผู้ดูแลไม่ต้องไปค้นหาเองว่าใครถือที่นั่งนั้นอยู่
 */
import { ApiError } from "./api";

export interface AdminErrorView {
  title: string;
  message: string;
  /** ลิงก์ไปสิ่งที่ขวางอยู่ — ไม่มีถ้าไม่มีอะไรให้ไปดู */
  next?: { label: string; href: string };
  /** ข้อความใต้ช่องกรอกแต่ละช่อง (400 `validation`) */
  fields: Record<string, string>;
}

const str = (value: unknown) => (typeof value === "string" && value ? value : null);

const TITLES: Record<string, string> = {
  validation: "ข้อมูลยังไม่ครบหรือไม่ถูกต้อง",
  not_found: "ไม่พบข้อมูลนี้แล้ว",
  invalid_state: "ทำคำสั่งนี้กับสถานะปัจจุบันไม่ได้",
  role_occupied: "ตำแหน่งนี้มีผู้ถืออยู่แล้ว",
  invitation_pending: "มีคำเชิญตำแหน่งนี้ค้างอยู่",
  cid_exists: "เลขบัตรประชาชนนี้มีบัญชีอยู่แล้ว",
  email_exists: "อีเมลนี้มีบัญชีอยู่แล้ว",
  code_exists: "รหัสนี้ถูกใช้แล้ว",
  organization_not_active: "หน่วยงานยังไม่เปิดใช้งาน",
  organization_clash: "บัญชีนี้สังกัดหน่วยงานอื่นอยู่",
  role_clash: "บัญชีนี้มีบทบาทอื่นอยู่แล้ว",
  already_there: "บัญชีอยู่ที่ตำแหน่งนี้แล้ว",
  last_holder: "เป็นผู้ถือบทบาทนี้คนสุดท้าย",
  self_action: "ทำกับบัญชีของตัวเองไม่ได้",
  activated: "ผู้รับเปิดใช้งานบัญชีแล้ว",
  identity_released: "อีเมลของบัญชีนี้ถูกปล่อยไปแล้ว",
  not_deactivated: "ต้องยุติการใช้งานบัญชีก่อน",
  already_approved: "คำขอนี้อนุมัติแล้ว",
  already_cancelled: "คำขอนี้ถูกยกเลิกแล้ว",
  already_draft: "คำขอนี้เป็นฉบับร่างอยู่แล้ว",
  already_current: "เวอร์ชันนี้เผยแพร่อยู่แล้ว",
  rule_bound_field: "ช่องนี้เพิ่มตัวเลือกเองไม่ได้",
  bdi_organization: "หน่วยงาน BDI เปลี่ยนสถานะไม่ได้",
  csrf_origin: "คำขอไม่ได้มาจากหน้านี้",
  forbidden: "ไม่มีสิทธิ์ทำคำสั่งนี้",
  unauthenticated: "เซสชันหมดอายุ",
};

export function adminErrorView(err: unknown): AdminErrorView {
  if (!(err instanceof ApiError)) {
    return { title: "เกิดข้อผิดพลาด", message: "กรุณาลองใหม่อีกครั้ง", fields: {} };
  }
  const d = err.details;
  const view: AdminErrorView = {
    title: TITLES[err.code] ?? (err.status >= 500 ? "ระบบขัดข้อง" : "ทำคำสั่งนี้ไม่สำเร็จ"),
    message: err.message,
    fields: err.fields,
  };

  switch (err.code) {
    case "role_occupied": {
      const id = str(d.holderUserAccountId);
      if (id) view.next = { label: "ไปที่บัญชีของผู้ถือตำแหน่ง", href: `/console/users/${id}` };
      break;
    }
    case "invitation_pending": {
      const email = str(d.pendingEmail);
      if (email) view.next = { label: "ดูคำเชิญที่ค้างอยู่", href: `/console/invitations?email=${encodeURIComponent(email)}` };
      break;
    }
    case "cid_exists":
    case "email_exists": {
      const id = str(d.userAccountId);
      if (id) view.next = { label: "ไปที่บัญชีนั้น", href: `/console/users/${id}` };
      break;
    }
    case "last_holder": {
      const role = str(d.roleCode);
      view.next = {
        label: "เชิญผู้ถือบทบาทนี้อีกคนก่อน",
        href: `/console/invitations?new=1${role ? `&role=${role}` : ""}`,
      };
      break;
    }
    case "unauthenticated":
      view.next = { label: "เข้าสู่ระบบอีกครั้ง", href: "/login?next=/console" };
      break;
  }
  return view;
}
