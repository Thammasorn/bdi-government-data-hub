"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { useSession } from "@/components/SessionProvider";
import { Button } from "@/components/ui/Button";
import { DotDecoration } from "@/components/ui/Card";
import { Spinner } from "@/components/ui/Spinner";
import { useToast } from "@/components/ui/Toast";
import { api, ApiError } from "@/lib/api";
import { isBdiStaff } from "@/lib/status";

export default function HomePage() {
  const { user, loading } = useSession();
  const router = useRouter();
  const { show } = useToast();
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    if (isBdiStaff(user.roles)) {
      router.replace("/admin/organizations");
      return;
    }
    if (user.organizationId) {
      router.replace(`/organizations/${user.organizationId}`);
    }
  }, [user, loading, router]);

  const createOrganization = async () => {
    setCreating(true);
    try {
      const data = await api.post<{ organization: { id: string } }>("/api/organizations", {});
      router.push(`/organizations/${data.organization.id}/edit`);
    } catch (err) {
      if (err instanceof ApiError && err.code === "exists") {
        router.push(`/organizations/${err.organizationId}/edit`);
        return;
      }
      show({
        tone: "error",
        title: "สร้างหน่วยงานไม่สำเร็จ",
        detail: err instanceof ApiError ? err.message : undefined,
      });
      setCreating(false);
    }
  };

  if (loading || !user || isBdiStaff(user.roles) || user.organizationId) {
    return <Spinner />;
  }

  // สเปก: "ระบบจะแสดงปุ่มสร้างหน่วยงานตรงกลางหน้าจอ ซึ่งเป็นเมนูเดียวที่ผู้ใช้เห็นและทำได้"
  return (
    <div className="relative mx-auto flex min-h-[calc(100vh-8.5rem)] max-w-2xl items-center justify-center px-4 py-16">
      <DotDecoration className="right-0 top-4 h-52 w-52 text-navy-500" />
      <DotDecoration className="bottom-4 left-0 h-40 w-40 text-coral-500" />

      <div className="relative text-center">
        <div className="mx-auto grid h-24 w-24 place-items-center rounded-full bg-coral-50">
          <svg
            viewBox="0 0 48 48"
            className="h-11 w-11 text-navy-800"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            aria-hidden="true"
          >
            <path d="M8 42V14l12-6 12 6v28" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M32 42V22h8v20M4 42h40" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M16 20h8M16 27h8M16 34h8" strokeLinecap="round" />
          </svg>
        </div>

        <h1 className="mt-7 text-[28px] font-semibold text-navy-800 sm:text-[30px]">
          ยังไม่มีหน่วยงานในระบบ
        </h1>
        <p className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-ink-muted">
          เริ่มต้นด้วยการสร้างหน่วยงานของคุณ เพื่อเข้าใช้งานแพลตฟอร์มข้อมูลภาครัฐ
          ระบบจะพาคุณกรอกข้อมูลทีละขั้นและสร้างแบบฟอร์มให้อัตโนมัติ
        </p>

        <Button size="lg" className="mt-8" loading={creating} onClick={createOrganization}>
          สร้างหน่วยงาน
        </Button>
      </div>
    </div>
  );
}
