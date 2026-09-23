import type { RequestStatus } from "./status";

/**
 * ปุ่มเดียวของผู้ประสานงานของหน่วยงานที่ "เอาคำขอชุดข้อมูลใบนี้ออกจากงานที่ค้างอยู่"
 * — ให้ผลสองอย่าง ขึ้นกับว่าคำขอเคยนำส่งไปแล้วหรือยัง
 *
 * เส้นแบ่งคือ `submittedAt` ไม่ใช่สถานะปัจจุบัน และเป็นเส้นเดียวกับที่
 * `DELETE /api/dataset-requests/:id` ใช้ตัดสินฝั่ง server — ที่นี่แค่เลือก**คำ**
 * ให้ตรงกับสิ่งที่จะเกิดขึ้นจริง ปุ่มที่เขียนว่า "ลบ" แล้วผลคือคำขอยังอยู่ในตัวกรอง
 * "ยกเลิกแล้ว" อ่านว่าระบบลบไม่สำเร็จ
 *
 * ร่างที่ยังไม่เคยนำส่งไม่มีใครนอกหน่วยงานเคยเห็น ลบทิ้งได้จริง — ส่วนใบที่เคยนำส่ง
 * มีเจ้าหน้าที่ BDI อ่านไปแล้วและมีไทม์ไลน์ `review_task` อยู่ จึงถูกยกเลิก ไม่ใช่ลบ
 * (feedback 2026-09-23 แถว 8: "ลบชุดข้อมูลแล้ว หายไปเลย ไม่อยู่ใน ยกเลิกแล้ว")
 */
export interface DatasetCloseAction {
  kind: "delete" | "cancel";
  /** คำบนปุ่มในตาราง — สั้นเพราะอยู่ในวงกลมมุมแถว */
  short: string;
  /** คำกริยาที่เอาไปต่อกับชื่อคำขอได้ ใช้ทั้งใน aria-label และในประโยคของกล่องยืนยัน */
  verb: string;
  modalTitle: string;
  modalDescription: string;
  /** บรรทัดที่บอกผลที่ตามมา ซึ่งต่างกันคนละเรื่องระหว่างสองทาง */
  note: string;
  confirmLabel: string;
  doneTitle: string;
  doneDetail: (requestNumber: string) => string;
  failTitle: string;
}

/**
 * สถานะที่ปุ่มนี้ขึ้น — คำขอที่อยู่ในมือของหน่วยงานเท่านั้น
 *
 * `SUBMITTED` / `UNDER_REVIEW` คือใบที่ค้างอยู่ที่ด่านของ BDI มีคนกำลังอ่านอยู่ และ
 * ฝั่ง server ปฏิเสธทั้งสองสถานะนี้ (ตัดสิน 2026-09-23) ปุ่มที่กดแล้วได้ 409 แย่กว่า
 * ไม่มีปุ่ม — กติกาเดียวกับที่ `canDelete` ใช้ซ่อนปุ่มจากเจ้าหน้าที่ BDI อยู่แล้ว
 */
export const CLOSEABLE_STATUSES: RequestStatus[] = ["DRAFT", "RETURNED"];

const DELETE: DatasetCloseAction = {
  kind: "delete",
  short: "ลบ",
  verb: "ลบ",
  modalTitle: "ลบคำขอฉบับร่าง",
  modalDescription: "คำขอและข้อมูลที่กรอกไว้จะถูกลบออกจากระบบ และกู้คืนไม่ได้",
  note: "คำขอนี้ยังไม่ได้นำส่ง จึงยังไม่มีผู้ตรวจสอบท่านใดเห็นข้อมูลในคำขอ",
  confirmLabel: "ยืนยันลบคำขอ",
  doneTitle: "ลบคำขอแล้ว",
  doneDetail: (n) => `${n} ถูกลบออกจากรายการเรียบร้อย`,
  failTitle: "ลบคำขอไม่สำเร็จ",
};

const CANCEL: DatasetCloseAction = {
  kind: "cancel",
  short: "ยกเลิก",
  verb: "ยกเลิก",
  modalTitle: "ยกเลิกคำขอ",
  modalDescription: "คำขอจะไม่ถูกลบ แต่จะถูกปิดไว้ในสถานะ “ยกเลิกแล้ว” และนำส่งต่อไม่ได้อีก",
  note: "คำขอนี้เคยนำส่งไปแล้ว ประวัติและเอกสารจึงยังอยู่ให้ย้อนดูได้ — ค้นหาได้จากตัวกรอง “ยกเลิกแล้ว”",
  confirmLabel: "ยืนยันยกเลิกคำขอ",
  doneTitle: "ยกเลิกคำขอแล้ว",
  doneDetail: (n) => `${n} ถูกปิดไว้ในสถานะ “ยกเลิกแล้ว”`,
  failTitle: "ยกเลิกคำขอไม่สำเร็จ",
};

export const closeActionFor = (request: { submittedAt: string | null }): DatasetCloseAction =>
  request.submittedAt ? CANCEL : DELETE;

/** ใช้ตอนที่ยังไม่มีแถวไหนถูกเลือก — กล่องที่ปิดอยู่ยังต้องมีข้อความให้ render */
export const DEFAULT_CLOSE_ACTION = DELETE;
