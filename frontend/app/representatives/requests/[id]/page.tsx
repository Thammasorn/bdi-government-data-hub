"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";

import { ChangeRequestDetailView, CONSOLE_LIST } from "@/components/representatives/DetailView";
import { useSession } from "@/components/SessionProvider";
import { Spinner } from "@/components/ui/Spinner";

export default function ChangeRequestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useSession();
  // ผู้ดูแลระบบทำงานใน /console — ลิงก์เก่าที่ชี้มาที่นี่พาไปหน้าเดียวกันในนั้น
  const admin = user?.roles.includes("SYSTEM_ADMINISTRATOR") ?? false;

  useEffect(() => {
    if (admin) router.replace(`${CONSOLE_LIST}/${id}`);
  }, [admin, id, router]);

  if (admin) return <Spinner />;
  return <ChangeRequestDetailView id={id} />;
}
