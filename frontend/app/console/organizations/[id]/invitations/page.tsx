"use client";

import { redirect, useParams, useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { Spinner } from "@/components/ui/Spinner";

/**
 * หน้าคำเชิญของหน่วยงานเดิม — ตอนนี้รวมอยู่ในหน้า "สมาชิกและคำเชิญ" (`/members`, การ์ด Issue 20261031-04)
 *
 * เก็บไว้เพราะลิงก์ไปหน้านี้ถูกส่งต่อกันไปแล้ว (รวมถึงฐานข้อมูล "ผลของการกระทำของผู้ดูแลระบบ" ใน Notion) `?email=` ของหน้าเดิม
 * กลายเป็นช่องค้นหา `?q=` ของหน้าใหม่ ซึ่งค้นอีเมลได้เหมือนกัน ส่วน `?new=1` เปิดกล่องเชิญเหมือนเดิม
 */
export default function OrganizationInvitationsRedirectPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <InvitationsRedirect />
    </Suspense>
  );
}

function InvitationsRedirect() {
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  const next = new URLSearchParams();
  const email = params.get("email");
  if (email) next.set("q", email);
  if (params.get("new") === "1") next.set("new", "1");
  const query = next.toString();
  redirect(`/console/organizations/${id}/members${query ? `?${query}` : ""}`);
  // redirect() โยนออกไปเสมอ บรรทัดนี้มีไว้ให้ TypeScript เห็นว่าเป็น component
  return null;
}
