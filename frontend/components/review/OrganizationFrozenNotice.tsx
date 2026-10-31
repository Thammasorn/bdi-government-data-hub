import { ORGANIZATION_STATUS_META, frozenOrganizationMessage, type OrganizationStatus } from "@/lib/status";

/**
 * "หน่วยงานถูกระงับการใช้งานอยู่" — แทนที่ปุ่มทุกปุ่มที่เปลี่ยนคำขอ (การ์ด "ระงับหน่วยงาน" 2026-10-31)
 *
 * แสดงเมื่อ `isOrganizationFrozen()` เป็นจริงเท่านั้น ผู้เรียกเป็นคนตัดสินว่าจะแสดงหรือไม่ ไม่มีปุ่มปิด เพราะสิ่งที่มันอธิบาย
 * (ทำไมไม่มีปุ่มให้กด) ยังจริงอยู่ตราบที่หน่วยงานยังถูกระงับ ข้อความตรงกับที่ backend ตอบ 409 `organization_frozen`
 */
export function OrganizationFrozenNotice({
  status,
  className = "mb-6",
}: {
  status: OrganizationStatus;
  className?: string;
}) {
  return (
    <div role="status" className={`${className} rounded-xl border-l-[3px] border-danger bg-danger-bg p-5`}>
      <p className="text-[13px] font-semibold text-danger">
        หน่วยงาน{ORGANIZATION_STATUS_META[status].label}
      </p>
      <p className="mt-1.5 text-[15px] leading-relaxed text-ink">{frozenOrganizationMessage(status)}</p>
    </div>
  );
}
