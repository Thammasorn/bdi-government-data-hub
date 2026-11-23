"use client";

import { Suspense } from "react";

import { PageHeader } from "@/components/console/ui";
import { LegalStatusTable } from "@/components/legal/LegalStatusTable";
import { Spinner } from "@/components/ui/Spinner";

/** สถานะเอกสารทางกฎหมายของทุกหน่วยงาน — ผู้ดูแลระบบและผู้เชี่ยวชาญด้านกฎหมายของ BDI ดูอย่างเดียว */
export default function ConsoleLegalStatusPage() {
  return (
    <>
      <PageHeader
        eyebrow="ตั้งค่าเอกสาร"
        title="สถานะเอกสารทางกฎหมายของหน่วยงาน"
        description="เวอร์ชันเอกสารทางกฎหมายที่แต่ละหน่วยงานลงนาม และเอกสารที่รอการอนุมัติ"
      />
      {/* ตารางอ่านตัวกรองเริ่มต้นจาก query string (useSearchParams) จึงต้องมี Suspense ครอบ */}
      <Suspense fallback={<Spinner />}>
        <LegalStatusTable base="/console/legal-status" />
      </Suspense>
    </>
  );
}
