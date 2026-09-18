"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type FormEvent } from "react";

import { AuthLayout } from "@/components/AuthLayout";
import { PasswordRequirements } from "@/components/auth/PasswordRequirements";
import { useSession } from "@/components/SessionProvider";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { Spinner } from "@/components/ui/Spinner";
import { useToast } from "@/components/ui/Toast";
import { api, ApiError } from "@/lib/api";
import { passwordMeetsRules } from "@/lib/password";

/**
 * หน้าตั้งรหัสผ่านใหม่ — ปลายทางของลิงก์ที่ผู้ดูแลระบบสั่งออกให้
 * (การ์ด "API ให้ system admin reset password ให้ user")
 *
 *   ?token=... จากอีเมล → ตรวจลิงก์กับ GET /api/auth/password-reset → ฟอร์มสองช่อง
 *   ไม่มี token       → ไม่มีอะไรให้ทำ บอกให้ติดต่อ BDI (ไม่มี "ลืมรหัสผ่าน" ให้กดเอง)
 *
 * ตั้งเสร็จแล้ว**ไม่ได้เข้าสู่ระบบให้** — API ไม่ออก session และเพิกถอนใบเก่าทั้งหมด
 * (ดู routes/auth.ts) หน้านี้จึงพาไป `/login` ตามการ์ดข้อ 4 ให้เข้าด้วยรหัสใหม่ + OTP
 */
export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<Spinner className="min-h-screen" />}>
      <ResetFlow />
    </Suspense>
  );
}

interface ResetInfo {
  email: string;
  expiresAt: string;
}

function ResetFlow() {
  const token = useSearchParams().get("token") ?? "";
  const [info, setInfo] = useState<ResetInfo | null>(null);
  const [invalidReason, setInvalidReason] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    api
      .get<ResetInfo>(`/api/auth/password-reset?token=${encodeURIComponent(token)}`)
      .then(setInfo)
      .catch((err) =>
        setInvalidReason(err instanceof ApiError ? err.message : "ลิงก์ใช้งานไม่ได้"),
      );
  }, [token]);

  if (!token) return <NoToken />;
  if (invalidReason) return <InvalidLink reason={invalidReason} />;
  if (!info) return <Spinner className="min-h-screen" />;
  return <ResetForm token={token} email={info.email} />;
}

function ResetForm({ token, email }: { token: string; email: string }) {
  const router = useRouter();
  const { user, setUser } = useSession();
  const { show } = useToast();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const passwordOk = passwordMeetsRules(password);
  // ฟ้องเฉพาะเมื่อเริ่มพิมพ์ช่องยืนยันแล้ว — ไม่ใช่ตั้งแต่ตัวอักษรแรกของช่องบน
  const mismatch = confirmPassword.length > 0 && confirmPassword !== password;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setFields({});
    try {
      await api.post("/api/auth/password-reset", { token, password, confirmPassword });
      // session ของบัญชีนี้ถูกเพิกถอนหมดแล้ว ถ้าแท็บนี้ล็อกอินเป็นคนเดียวกันอยู่ก็ให้รู้ตัว
      if (user && user.email.toLowerCase() === email.toLowerCase()) setUser(null);
      show({
        tone: "success",
        title: "ตั้งรหัสผ่านใหม่แล้ว",
        detail: "กรุณาเข้าสู่ระบบด้วยรหัสผ่านใหม่",
      });
      router.push("/login");
    } catch (err) {
      if (err instanceof ApiError) {
        setFields(err.fields);
        if (Object.keys(err.fields).length === 0) {
          show({ tone: "error", title: "ตั้งรหัสผ่านใหม่ไม่สำเร็จ", detail: err.message });
        }
      }
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout
      title="ตั้งรหัสผ่านใหม่"
      description={
        <>
          สำหรับบัญชี <span className="font-semibold text-ink">{email}</span> — เมื่อตั้งเสร็จ
          อุปกรณ์ทุกเครื่องที่เข้าสู่ระบบด้วยบัญชีนี้อยู่จะถูกออกจากระบบ
        </>
      }
      footer={
        <Link href="/login" className="font-medium text-navy-700 hover:underline">
          ไปหน้าเข้าสู่ระบบ
        </Link>
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
        <div className="flex flex-col gap-3">
          <TextField
            label="รหัสผ่านใหม่"
            type="password"
            required
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={fields.password}
            valid={passwordOk}
          />
          <PasswordRequirements value={password} />
        </div>

        <TextField
          label="ยืนยันรหัสผ่านใหม่"
          type="password"
          required
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          error={mismatch ? "รหัสผ่านทั้งสองช่องไม่ตรงกัน" : fields.confirmPassword}
          valid={confirmPassword.length > 0 && !mismatch && passwordOk}
          hint="พิมพ์รหัสผ่านเดิมอีกครั้ง เพื่อกันการพิมพ์ผิดโดยไม่รู้ตัว"
        />

        <Button type="submit" size="lg" loading={submitting} className="mt-1 w-full">
          บันทึกรหัสผ่านใหม่
        </Button>
      </form>
    </AuthLayout>
  );
}

/** เข้ามาโดยไม่มีโทเคน — หน้านี้ไม่มีฟอร์ม "ลืมรหัสผ่าน" ระบบเปิดให้แอดมินเป็นคนสั่งเท่านั้น */
function NoToken() {
  return (
    <AuthLayout
      title="ตั้งรหัสผ่านใหม่"
      description="การตั้งรหัสผ่านใหม่ทำได้จากลิงก์ในอีเมลที่ผู้ประสานงานของ BDI ส่งให้เท่านั้น"
      footer={
        <Link href="/login" className="font-medium text-navy-700 hover:underline">
          ไปหน้าเข้าสู่ระบบ
        </Link>
      }
    >
      <div className="rounded-xl bg-canvas p-5">
        <p className="text-sm leading-relaxed text-ink">
          หากลืมรหัสผ่าน กรุณาติดต่อผู้ประสานงานของ BDI เพื่อขอให้ส่งลิงก์ตั้งรหัสผ่านใหม่ไปยังอีเมล
          ของบัญชีของคุณ ลิงก์ใช้ได้ครั้งเดียวและมีอายุจำกัด
        </p>
      </div>
    </AuthLayout>
  );
}

function InvalidLink({ reason }: { reason: string }) {
  return (
    <AuthLayout
      title="ลิงก์ใช้งานไม่ได้"
      description={reason}
      footer={
        <Link href="/login" className="font-medium text-navy-700 hover:underline">
          ไปหน้าเข้าสู่ระบบ
        </Link>
      }
    >
      <div className="rounded-xl bg-danger-bg p-5">
        <p className="text-sm leading-relaxed text-danger">
          หากคุณคิดว่านี่เป็นข้อผิดพลาด กรุณาติดต่อผู้ประสานงานของ BDI เพื่อขอลิงก์ตั้งรหัสผ่านใหม่
        </p>
      </div>
    </AuthLayout>
  );
}
