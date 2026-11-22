"use client";

import { Suspense } from "react";

import { LegalStatusTable } from "@/components/legal/LegalStatusTable";
import { ListPageHeader } from "@/components/list/ListPageHeader";
import { Spinner } from "@/components/ui/Spinner";
import { useRequireAuth } from "@/lib/require-auth";
import { isBdiStaff } from "@/lib/status";

/** เมนู "เอกสารทางกฎหมาย" — หน่วยงานเห็นของตัวเอง เจ้าหน้าที่และผู้มีอำนาจอนุมัติของ BDI เห็นทุกหน่วยงาน */
export default function LegalDocumentsPage() {
  const { user, loading } = useRequireAuth();
  if (loading || !user) return <Spinner />;
  const bdi = isBdiStaff(user.roles);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <ListPageHeader
        tone="organization"
        eyebrow="เอกสารทางกฎหมาย"
        title="สถานะเอกสารทางกฎหมายของหน่วยงาน"
        description={
          bdi
            ? "เวอร์ชันเอกสารทางกฎหมายที่แต่ละหน่วยงานลงนาม และเอกสารที่รอการอนุมัติ"
            : "เวอร์ชันเอกสารทางกฎหมายที่หน่วยงานของคุณลงนาม และเอกสารที่รอการอนุมัติ"
        }
      />
      {/* ตารางอ่านตัวกรองเริ่มต้นจาก query string (useSearchParams) จึงต้องมี Suspense ครอบ */}
      <Suspense fallback={<Spinner />}>
        <LegalStatusTable />
      </Suspense>
    </div>
  );
}
