import { legalNoticeOf } from "@/lib/legal-document";
import type { LegalDocument } from "@/lib/types";

/**
 * คำเตือนของเอกสารฉบับหนึ่ง — ใช้ที่เดียว คือกล่องอ่าน/ลงนามของผู้มีอำนาจ (`SigningDialog`)
 *
 * เคยใช้สองที่ (การ์ด "เอกสารข้อตกลง" ด้วย) จน BDI แจ้งเมื่อ 2026-09-07 ว่าผิดที่ —
 * `legalNoticeOf()` มีเหตุผลเต็ม ๆ ไว้แล้ว ยังแยกเป็นคอมโพเนนต์อยู่แม้เหลือที่ใช้ที่เดียว
 * เพราะมันถือกฎ "ไม่มีคำเตือน = ไม่มีกล่อง ไม่ใช่กล่องว่าง" ซึ่งเป็นสิ่งที่ผู้เรียกลืมได้ง่าย
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
