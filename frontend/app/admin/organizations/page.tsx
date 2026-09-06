"use client";

import { useRouter } from "next/navigation";
import { Suspense, useEffect } from "react";

import { OrganizationRequestTable } from "@/components/organization/RequestTable";
import { ListPageHeader } from "@/components/list/ListPageHeader";
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
      <ListPageHeader
        tone="organization"
        eyebrow="หน่วยงาน"
        title="คำขอลงทะเบียนหน่วยงาน"
        description="คำขอลงทะเบียนหน่วยงานทั้งหมดในระบบ"
      />

      <OrganizationRequestTable basePath="/admin/organizations" />
    </div>
  );
}
