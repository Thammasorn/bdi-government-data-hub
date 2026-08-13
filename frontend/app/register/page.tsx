"use client";

import { redirect, useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { Spinner } from "@/components/ui/Spinner";

/**
 * เส้นทางเดิมของการลงทะเบียน — ตอนนี้ย้ายไป /activate ทั้งหมด
 *
 * เก็บไว้เพราะอีเมลคำเชิญที่ส่งออกไปก่อนหน้านี้ชี้มาที่ `/register?token=...`
 * ลิงก์พวกนั้นยังใช้ได้ 7 วันตามอายุของ activation key จึงต้องพาไปให้ถูกที่
 */
export default function RegisterRedirectPage() {
  return (
    <Suspense fallback={<Spinner className="min-h-screen" />}>
      <RegisterRedirect />
    </Suspense>
  );
}

function RegisterRedirect() {
  const token = useSearchParams().get("token");
  redirect(token ? `/activate?token=${encodeURIComponent(token)}` : "/activate");
  // redirect() โยนออกไปเสมอ บรรทัดนี้มีไว้ให้ TypeScript เห็นว่าเป็น component
  return null;
}
