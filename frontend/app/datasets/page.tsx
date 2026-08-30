"use client";

import { useRouter } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { DatasetRequestTable } from "@/components/dataset/RequestTable";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { useToast } from "@/components/ui/Toast";
import { api, ApiError } from "@/lib/api";
import { useRequireAuth } from "@/lib/require-auth";
import { isBdiStaff } from "@/lib/status";

export default function DatasetsPage() {
  // ตารางอ่านสถานะของตัวเองจาก query string ผ่าน useSearchParams จึงต้องมี Suspense ครอบ
  // ไม่งั้น next build ล้ม (ผ่าน tsc และผ่าน next dev — เห็นตอน production build เท่านั้น)
  return (
    <Suspense fallback={<Spinner />}>
      <DatasetList />
    </Suspense>
  );
}

function DatasetList() {
  const router = useRouter();
  const { user, loading } = useRequireAuth();
  const { show } = useToast();

  const [eligibility, setEligibility] = useState<{ eligible: boolean; reason: string | null } | null>(
    null,
  );
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (loading || !user) return;
    if (isBdiStaff(user.roles)) router.replace("/admin/datasets");
  }, [user, loading, router]);

  useEffect(() => {
    api
      .get<{ eligible: boolean; reason: string | null }>("/api/dataset-requests/eligibility")
      .then(setEligibility)
      .catch(() => undefined);
  }, []);

  if (loading || !user) return <Spinner />;

  const canCreate = user.roles.includes("ORGANIZATION_USER");

  const create = async () => {
    setCreating(true);
    try {
      const data = await api.post<{ request: { id: string } }>("/api/dataset-requests", {});
      router.push(`/datasets/${data.request.id}/edit`);
    } catch (err) {
      show({
        tone: "error",
        title: "สร้างคำขอไม่สำเร็จ",
        detail: err instanceof ApiError ? err.message : undefined,
      });
      setCreating(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <header className="mb-7">
        <h1 className="text-[26px] font-semibold text-navy-800">ชุดข้อมูล</h1>
        <p className="mt-1.5 text-[15px] text-ink-muted">
          คำขอลงทะเบียนชุดข้อมูลทั้งหมดของหน่วยงานคุณ ผู้ใช้ทุกคนในหน่วยงานจัดการคำขอเหล่านี้ได้
        </p>
      </header>

      {/* ปุ่มยังอยู่แม้กดไม่ได้ พร้อมบอกว่าติดอะไร — ซ่อนปุ่มแล้วผู้ใช้จะไม่รู้ว่าต้องทำอะไรต่อ
          แต่ผู้มีอำนาจกระทำการแทนไม่ได้เป็นคนยื่นอยู่แล้ว จึงไม่ต้องเห็นทั้งปุ่มและคำเตือน */}
      {canCreate && eligibility && !eligibility.eligible ? (
        <div className="mb-6 rounded-xl border-l-[3px] border-warning bg-warning-bg p-5">
          <p className="text-[13px] font-semibold text-warning">ยังลงทะเบียนชุดข้อมูลไม่ได้</p>
          <p className="mt-1.5 text-[15px] leading-relaxed text-ink">{eligibility.reason}</p>
        </div>
      ) : null}

      <DatasetRequestTable
        basePath="/datasets"
        showOrganization={false}
        emptyHint="กดปุ่ม ลงทะเบียนชุดข้อมูล เพื่อเริ่มยื่นคำขอฉบับแรก"
        action={
          canCreate ? (
            <Button
              onClick={create}
              loading={creating}
              disabled={eligibility ? !eligibility.eligible : true}
            >
              ลงทะเบียนชุดข้อมูล
            </Button>
          ) : null
        }
      />
    </div>
  );
}
