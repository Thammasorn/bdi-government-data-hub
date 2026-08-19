"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";

import { DatasetRequestTable } from "@/components/dataset/RequestTable";
import { Spinner } from "@/components/ui/Spinner";
import { useRequireAuth } from "@/lib/require-auth";
import { isBdiStaff, type DatasetRequestStatus } from "@/lib/status";

export default function AdminDatasetsPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <AdminDatasetList />
    </Suspense>
  );
}

function AdminDatasetList() {
  const router = useRouter();
  const params = useSearchParams();
  const { user, loading } = useRequireAuth();

  useEffect(() => {
    if (loading || !user) return;
    if (!isBdiStaff(user.roles)) router.replace("/datasets");
  }, [user, loading, router]);

  if (loading || !user) return <Spinner />;

  const isSpecialistOnly =
    user.roles.includes("BDI_DATASET_SPECIALIST") &&
    !user.roles.includes("BDI_OFFICER") &&
    !user.roles.includes("BDI_FINAL_APPROVER");

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <header className="mb-7">
        <h1 className="text-[26px] font-semibold text-navy-800">คำขอลงทะเบียนชุดข้อมูล</h1>
        <p className="mt-1.5 text-[15px] text-ink-muted">
          {isSpecialistOnly
            ? "คำขอที่คุณได้รับมอบหมายให้ตรวจในฐานะผู้เชี่ยวชาญข้อมูล"
            : "คำขอทั้งหมดในระบบ กรองตามสถานะหรือค้นหาจากชื่อชุดข้อมูล เลขที่คำขอ และหน่วยงาน"}
        </p>
      </header>

      <DatasetRequestTable
        basePath="/admin/datasets"
        showOrganization
        initialStatuses={
          (params.get("status")?.split(",").filter(Boolean) as DatasetRequestStatus[]) ?? []
        }
        emptyHint={
          isSpecialistOnly
            ? "เมื่อเจ้าหน้าที่ BDI มอบหมายคำขอให้คุณ รายการจะแสดงที่นี่"
            : "เมื่อหน่วยงานนำส่งคำขอเข้ามา รายการจะแสดงที่นี่"
        }
      />
    </div>
  );
}
