"use client";

import type { AdminOrganizationDetail } from "@/lib/admin";
import { useAdminData } from "@/lib/use-admin";

/**
 * บริบท "หน้านี้กำลังพูดถึงหน่วยงานไหน" — ใช้ทั้งหน้าย่อยของหน่วยงาน (`/console/organizations/[id]/members`)
 * และหน้ารายการรวมที่ถูกกรองด้วย `?organizationId=`
 *
 * มีขึ้นเพราะหน้ารายการรวมเคยกรองด้วยหน่วยงานโดยบอกแค่ "เฉพาะหน่วยงานที่เลือก" (หรือไม่บอกเลย) และไม่มีลิงก์กลับ — ผู้ดูแลที่มา
 * จากหน้าหน่วยงานต้องเริ่มใหม่จากเมนู "หน่วยงาน" (การ์ด Issue 2026-10-25) ตอนนี้ทุกหน้าที่อยู่ในบริบทของหน่วยงานหนึ่งพูดชื่อ
 * หน่วยงานนั้นและมีทางกลับไปหน้าของมันเสมอ
 *
 * `id` ว่าง = ไม่อยู่ในบริบทของหน่วยงาน ไม่ยิงคำขอ (`useAdminData(null)`) และคืน `null` ทุกช่อง
 */
export function useOrganizationScope(id: string | null | undefined) {
  const { data, error, loading, reload } = useAdminData<AdminOrganizationDetail>(
    id ? `/api/admin/organizations/${id}` : null,
  );
  if (!id) return { id: null, organization: null, detail: null, error: null, loading: false, reload, back: null, chipLabel: null };
  const organization = data?.organization ?? null;
  const name = organization?.nameTh;
  return {
    id,
    organization,
    detail: data,
    error,
    loading,
    reload,
    /** `PageHeader back` — ระหว่างโหลดยังเป็นลิงก์ที่กดได้ แค่ยังไม่มีชื่อ */
    back: { href: `/console/organizations/${id}`, label: name ? `หน่วยงาน ${name}` : "กลับไปหน่วยงาน" },
    /** ป้ายในแถวตัวกรองของหน้ารายการรวม */
    chipLabel: name ? `เฉพาะ ${name}` : "เฉพาะหน่วยงานที่เลือก",
  };
}

/** ป้ายตัวกรอง "เฉพาะ <หน่วยงาน> ✕" ในแถวตัวกรองของหน้ารายการรวม — กดเพื่อเลิกกรอง */
export function OrganizationChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <button
      type="button"
      onClick={onClear}
      className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-navy-50 px-3 py-1.5 text-[13px] text-navy-700 hover:bg-navy-100"
      aria-label={`${label} — กดเพื่อเลิกกรอง`}
    >
      <span className="truncate">{label}</span>
      {/* กากบาทเป็น SVG ไม่ใช่ตัวอักษร × — line-height ของฟอนต์ไทยดันตัวอักษรในปุ่มเตี้ย ๆ ให้ตกต่ำกว่ากึ่งกลาง */}
      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <path d="m4 4 8 8M12 4l-8 8" strokeLinecap="round" />
      </svg>
    </button>
  );
}
