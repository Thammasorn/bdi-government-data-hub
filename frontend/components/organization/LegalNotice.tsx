import { legalNoticeOf } from "@/lib/legal-document";
import type { LegalDocument } from "@/lib/types";

/**
 * คำเตือนของเอกสารฉบับหนึ่ง — กล่องเดียวกันทุกที่ที่เอกสารถูกยื่นให้อ่าน
 *
 * มีที่เดียวเพราะสองที่ต้องหน้าตาเหมือนกัน: การ์ด "เอกสารข้อตกลง" ในหน้ารายละเอียด และ
 * กล่องอ่าน/ลงนามของผู้มีอำนาจ ถ้าแยกกันเขียน อันหนึ่งจะถูกลืมตอนถ้อยคำเปลี่ยน
 *
 * ไม่มีคำเตือน = ไม่มีกล่อง ไม่ใช่กล่องว่าง
 */
export function LegalNotice({ document, className = "" }: { document: LegalDocument; className?: string }) {
  const notice = legalNoticeOf(document);
  if (!notice) return null;
  return (
    <p
      className={`rounded-xl bg-warning-bg p-4 text-[13px] leading-relaxed text-warning ${className}`}
    >
      {notice}
    </p>
  );
}
