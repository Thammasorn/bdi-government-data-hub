"use client";

import { useRouter } from "next/navigation";
import { Suspense, useEffect } from "react";

import { DatasetRequestTable } from "@/components/dataset/RequestTable";
import { ListPageHeader } from "@/components/list/ListPageHeader";
import { Spinner } from "@/components/ui/Spinner";
import { useRequireAuth } from "@/lib/require-auth";
import { isBdiStaff } from "@/lib/status";

export default function AdminDatasetsPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <AdminDatasetList />
    </Suspense>
  );
}

function AdminDatasetList() {
  const router = useRouter();
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
      <ListPageHeader
        tone="dataset"
        eyebrow="ชุดข้อมูล"
        title="คำขอส่งชุดข้อมูล"
        description={
          isSpecialistOnly
            ? "คำขอที่ผู้ประสานงานของ BDI ขอความเห็นของคุณในฐานะผู้เชี่ยวชาญด้านข้อมูล"
            : "คำขอทั้งหมดในระบบ กรองตามขั้นตอนที่คำขอค้างอยู่ หรือค้นหาจากชื่อชุดข้อมูล เลขที่คำขอ และหน่วยงาน"
        }
      />

      <DatasetRequestTable
        basePath="/admin/datasets"
        showOrganization
        emptyHint={
          isSpecialistOnly
            ? "เมื่อผู้ประสานงานของ BDI ขอความเห็นของคุณกับคำขอใด รายการจะแสดงที่นี่"
            : "เมื่อหน่วยงานนำส่งคำขอเข้ามา รายการจะแสดงที่นี่"
        }
      />
    </div>
  );
}
