"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";

import { AuthLayout } from "@/components/AuthLayout";
import { storeThaidProfile, takeActivationToken, takeNextPath } from "@/components/auth/Thaid";
import { useSession, type SessionUser } from "@/components/SessionProvider";
import { Spinner } from "@/components/ui/Spinner";
import { api, ApiError } from "@/lib/api";

/**
 * redirect_uri ที่ลงทะเบียนไว้กับกรมการปกครอง
 *
 * หน้านี้ไม่ตัดสินอะไรเอง — ส่ง code กับ state ต่อให้ backend แล้วทำตามคำตอบ
 * client secret และการเทียบเลขบัตรอยู่ฝั่ง server ทั้งหมด
 *
 * ThaiD ตอบกลับมาทาง query string เสมอ ทั้งกรณีสำเร็จ (code) และผิดพลาด (error)
 */
export default function ThaidCallbackPage() {
  return (
    <Suspense fallback={<Spinner className="min-h-screen" />}>
      <ThaidCallback />
    </Suspense>
  );
}

interface CallbackResult {
  purpose?: "activate";
  verified?: boolean;
  profile?: Record<string, string | null>;
  user?: SessionUser;
}

function ThaidCallback() {
  const params = useSearchParams();
  const router = useRouter();
  const { setUser } = useSession();
  const [error, setError] = useState<string | null>(null);
  // React 18 dev รัน effect สองครั้ง — code ใช้ได้ครั้งเดียว จึงกันไว้ไม่ให้ยิงซ้ำ
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const state = params.get("state") ?? "";
    if (!state) {
      setError("ไม่พบผลการยืนยันจาก ThaiD กรุณาเริ่มใหม่อีกครั้ง");
      return;
    }

    void (async () => {
      try {
        const result = await api.post<CallbackResult>("/api/auth/thaid/callback", {
          state,
          code: params.get("code") ?? undefined,
          error: params.get("error") ?? undefined,
          errorDescription: params.get("error_description") ?? undefined,
        });

        if (result.user) {
          setUser(result.user);
          // ปลายทางที่ฝากไว้ก่อนออกไป ThaiD — ผู้ที่มาจากลิงก์ในอีเมลต้องได้กลับ
          // ไปหน้าที่ตั้งใจ ไม่ใช่หน้าแรก (เหมือนทางรหัสผ่าน + OTP)
          const next = takeNextPath();
          router.replace(
            // ทุก role มีหน้าแรกที่ `/` แล้ว
            next ?? "/",
          );
          return;
        }

        if (result.profile) storeThaidProfile(result.profile);
        const token = takeActivationToken();
        router.replace(token ? `/activate?token=${encodeURIComponent(token)}` : "/activate");
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "ยืนยันตัวตนกับ ThaiD ไม่สำเร็จ");
      }
    })();
  }, [params, router, setUser]);

  if (error) {
    const token = typeof window === "undefined" ? null : takeActivationToken();
    return (
      <AuthLayout
        title="ยืนยันตัวตนไม่สำเร็จ"
        description="ระบบไม่สามารถยืนยันตัวตนของคุณกับ ThaiD ได้"
        footer={
          <div className="flex flex-col gap-2">
            {token ? (
              <Link
                href={`/activate?token=${encodeURIComponent(token)}`}
                className="font-medium text-navy-700 hover:underline"
              >
                ลองยืนยันตัวตนอีกครั้ง
              </Link>
            ) : null}
            <Link href="/login" className="font-medium text-navy-700 hover:underline">
              ไปหน้าเข้าสู่ระบบ
            </Link>
          </div>
        }
      >
        <div className="rounded-xl bg-danger-bg p-5">
          <p className="text-sm leading-relaxed text-danger">{error}</p>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="กำลังยืนยันตัวตน" description="ระบบกำลังตรวจสอบผลการยืนยันจาก ThaiD">
      <div className="flex justify-center py-6">
        <Spinner />
      </div>
    </AuthLayout>
  );
}
