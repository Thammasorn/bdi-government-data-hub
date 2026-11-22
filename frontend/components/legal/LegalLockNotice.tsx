import Link from "next/link";

/**
 * "ต้องลงนามเอกสารกฎหมายเวอร์ชันใหม่" — ทุกคนในหน่วยงานเห็น ทรงเดียวกับ `OrganizationFrozenNotice`
 * ข้อความตรงกับที่ backend ตอบ 409 `legal_docs_update_required` (lib/legal-reacceptance.ts)
 */
export function LegalLockNotice({ className = "mb-6" }: { className?: string }) {
  return (
    <div role="status" className={`${className} rounded-xl border-l-[3px] border-warning bg-warning-bg p-5`}>
      <p className="text-[13px] font-semibold text-warning">มีเอกสารกฎหมายเวอร์ชันใหม่ที่ต้องลงนาม</p>
      <p className="mt-1.5 text-[15px] leading-relaxed text-ink">
        หน่วยงานต้องลงนามเอกสารกฎหมายเวอร์ชันใหม่ก่อนจึงจะทำรายการชุดข้อมูลได้ ผู้มีอำนาจอนุมัติของหน่วยงานอนุมัติได้ที่หน้า{" "}
        <Link href="/legal-documents" className="font-medium text-navy-700 underline underline-offset-2">
          เอกสารทางกฎหมาย
        </Link>
      </p>
    </div>
  );
}

export const isLegalLocked = (organization: { accessStatus?: string } | null | undefined) =>
  organization?.accessStatus === "LEGAL_DOCS_UPDATE_REQUIRED";
