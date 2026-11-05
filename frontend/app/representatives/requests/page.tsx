"use client";

import { useRouter } from "next/navigation";
import { Suspense, useState } from "react";

import { ChangeRequestTable } from "@/components/representatives/RequestTable";
import { RepresentativeShell } from "@/components/representatives/Shell";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { useToast } from "@/components/ui/Toast";
import { api, ApiError } from "@/lib/api";
import { useRequireAuth } from "@/lib/require-auth";

export default function ChangeRequestsPage() {
  // ตารางอ่านตัวกรองจาก query string ผ่าน useSearchParams — ต้องอยู่ใน Suspense ไม่งั้น next build ล้ม
  return (
    <Suspense fallback={<Spinner />}>
      <ChangeRequests />
    </Suspense>
  );
}

function ChangeRequests() {
  const router = useRouter();
  const { show } = useToast();
  const { user, loading } = useRequireAuth();
  const [creating, setCreating] = useState(false);

  if (loading || !user) return <Spinner />;

  const create = async () => {
    setCreating(true);
    try {
      const { request } = await api.post<{ request: { id: string } }>("/api/representative-changes", {});
      router.push(`/representatives/requests/${request.id}/edit`);
    } catch (err) {
      show({ tone: "error", title: "สร้างคำขอไม่สำเร็จ", detail: err instanceof ApiError ? err.message : undefined });
      setCreating(false);
    }
  };

  return (
    <RepresentativeShell
      title="ฟอร์มเปลี่ยนแปลงผู้แทนหน่วยงาน"
      description="คำขอยกเลิกผู้แทนเดิมและเพิ่มผู้แทนใหม่ของหน่วยงาน"
    >
      {user.roles.includes("ORGANIZATION_USER") ? (
        <Button className="mb-4 h-auto min-h-11 py-2" onClick={create} loading={creating}>
          กรอกคำขอเปลี่ยนแปลงผู้แทนหน่วยงาน
        </Button>
      ) : null}
      <ChangeRequestTable />
    </RepresentativeShell>
  );
}
