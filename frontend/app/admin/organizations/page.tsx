"use client";

import { useRouter } from "next/navigation";
import { Suspense, useEffect } from "react";

import { OrganizationRequestTable } from "@/components/organization/RequestTable";
import { Spinner } from "@/components/ui/Spinner";
import { useRequireAuth } from "@/lib/require-auth";
import { isBdiStaff } from "@/lib/status";

export default function AdminOrganizationsPage() {
  // ตารางอ่านสถานะของตัวเองจาก query string ผ่าน useSearchParams จึงต้องมี Suspense ครอบ
  // ไม่งั้น next build ล้ม (ผ่าน tsc และผ่าน next dev — เห็นตอน production build เท่านั้น)
  return (
    <Suspense fallback={<Spinner />}>
      <AdminOrganizationList />
    </Suspense>
  );
}

function AdminOrganizationList() {
  const router = useRouter();
  const { user, loading } = useRequireAuth();

  useEffect(() => {
    if (loading || !user) return;
    if (!isBdiStaff(user.roles)) router.replace("/");
  }, [user, loading, router]);

  if (loading || !user) return <Spinner />;

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <header className="mb-7">
        <h1 className="text-[26px] font-semibold text-navy-800">หน่วยงาน</h1>
        <p className="mt-1.5 text-[15px] text-ink-muted">
          คำขอสร้างหน่วยงานทั้งหมดในระบบ กรองตามขั้นตอนที่คำขอค้างอยู่ หรือค้นหาจากชื่อหน่วยงานและผู้ยื่น
        </p>
      </header>

      <OrganizationRequestTable basePath="/admin/organizations" />
    </div>
  );
}
