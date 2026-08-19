"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";

import { AuthLayout } from "@/components/AuthLayout";
import { ThaidButton } from "@/components/auth/Thaid";
import { useSession } from "@/components/SessionProvider";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { OtpInput } from "@/components/ui/OtpInput";
import { useToast } from "@/components/ui/Toast";
import { api, ApiError } from "@/lib/api";
import { nextFromLocation } from "@/lib/require-auth";
import { bdiLandingPath, isBdiStaff } from "@/lib/status";
import type { SessionUser } from "@/components/SessionProvider";

/**
 * เข้าสู่ระบบสองทาง ตาม "Login Step" ของสเปก
 *   1. รหัสผ่าน + OTP ทางอีเมล  (สองขั้น — /login แล้ว /login/verify-otp)
 *   2. ThaiD                    (จับคู่บัญชีด้วยเลขประจำตัวประชาชน)
 */
export default function LoginPage() {
  const [step, setStep] = useState<"credentials" | "otp">("credentials");
  const [email, setEmail] = useState("");

  return step === "credentials" ? (
    <CredentialsStep email={email} setEmail={setEmail} onSent={() => setStep("otp")} />
  ) : (
    <OtpStep email={email} onBack={() => setStep("credentials")} />
  );
}

function CredentialsStep({
  email,
  setEmail,
  onSent,
}: {
  email: string;
  setEmail: (v: string) => void;
  onSent: () => void;
}) {
  const { show } = useToast();
  const [password, setPassword] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  // โหมด SIT ปิดปุ่ม ThaiD ตรงหน้าล็อกอิน — จับคู่บัญชีด้วยเลขบัตรผ่าน DOPA ไม่ได้
  // อ่านค่าจาก backend ไม่ใช่ build flag จะได้สลับโหมดโดยไม่ต้อง build frontend ใหม่
  const [thaidBypass, setThaidBypass] = useState(false);
  useEffect(() => {
    api
      .get<{ thaidBypass: boolean }>("/api/auth/config")
      .then((c) => setThaidBypass(c.thaidBypass))
      .catch(() => setThaidBypass(false));
  }, []);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setFields({});
    try {
      await api.post("/api/auth/login", { email, password });
      show({ tone: "success", title: "ส่งรหัสยืนยันแล้ว", detail: `ตรวจสอบอีเมล ${email}` });
      onSent();
    } catch (err) {
      if (err instanceof ApiError) {
        setFields(err.fields);
        if (Object.keys(err.fields).length === 0) {
          show({ tone: "error", title: "เข้าสู่ระบบไม่สำเร็จ", detail: err.message });
        }
      }
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout
      title="เข้าสู่ระบบ"
      description="ใช้อีเมลที่ได้รับคำเชิญจากสถาบันข้อมูลขนาดใหญ่"
      back={{ href: "/", label: "กลับไปหน้าแรก" }}
      footer={
        <div className="flex flex-col gap-2">
          <p>
            ได้รับคำเชิญแล้วแต่ยังไม่ได้เปิดใช้งานบัญชี?{" "}
            <Link href="/activate" className="font-medium text-navy-700 hover:underline">
              กรอก Activation Key
            </Link>
          </p>
          <p>ยังไม่มีบัญชี? ระบบนี้เปิดใช้งานด้วยคำเชิญเท่านั้น กรุณาติดต่อเจ้าหน้าที่ BDI</p>
        </div>
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
        <TextField
          label="อีเมล"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={fields.email}
          placeholder="name@agency.go.th"
        />
        <TextField
          label="รหัสผ่าน"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={fields.password}
          placeholder="••••••••"
        />
        <Button type="submit" size="lg" loading={submitting} className="mt-1 w-full">
          เข้าสู่ระบบ
        </Button>
      </form>

      {thaidBypass ? null : (
        <>
          <div className="my-6 flex items-center gap-3 text-[13px] text-ink-subtle">
            <span className="h-px flex-1 bg-line" />
            หรือ
            <span className="h-px flex-1 bg-line" />
          </div>

          <ThaidButton purpose="login" variant="secondary" label="เข้าสู่ระบบด้วย ThaiD" />
          <p className="mt-2.5 text-center text-[13px] text-ink-muted">
            ใช้ได้กับบัญชีที่เปิดใช้งานด้วย ThaiD แล้ว
          </p>
        </>
      )}
    </AuthLayout>
  );
}

// ---------------------------------------------------------------- OTP (2FA)

function OtpStep({ email, onBack }: { email: string; onBack: () => void }) {
  const router = useRouter();
  const { setUser } = useSession();
  const { show } = useToast();

  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [cooldown, setCooldown] = useState(60);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const submit = useCallback(
    async (value: string) => {
      setSubmitting(true);
      setError(null);
      try {
        const data = await api.post<{ user: SessionUser }>("/api/auth/login/verify-otp", {
          email,
          code: value,
        });
        setUser(data.user);
        /**
         * ลิงก์ในอีเมลชี้ตรงเข้าหน้ารายละเอียด ผู้ที่ยังไม่ล็อกอินจึงถูกพามาที่นี่
         * พร้อม ?next=<หน้านั้น> — พากลับไปให้ถึงที่ ไม่ใช่ทิ้งไว้ที่หน้าแรกแล้ว
         * ให้ไปหาคำขอเองในตาราง (สเปกบนการ์ดเขียนไว้ตรง ๆ ว่าต้องพาไปเลย)
         *
         * อ่านจาก window.location ไม่ใช่ useSearchParams() — หน้านี้เป็น client
         * component ที่ไม่มี <Suspense> ครอบ และตอนนี้คือหลังกดยืนยัน OTP แล้ว
         * เบราว์เซอร์พร้อมมานานแล้ว
         */
        const next = nextFromLocation();
        router.push(next ?? (isBdiStaff(data.user.roles) ? bdiLandingPath(data.user.roles) : "/"));
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "ยืนยันไม่สำเร็จ");
        setCode("");
        setSubmitting(false);
      }
    },
    [email, setUser, router],
  );

  // ครบ 6 หลักแล้วส่งเลย ไม่ต้องให้กดปุ่มซ้ำ
  useEffect(() => {
    if (code.length === 6 && !submitting) void submit(code);
  }, [code, submitting, submit]);

  const resend = async () => {
    try {
      await api.post("/api/auth/login/resend-otp", { email });
      setCooldown(60);
      setError(null);
      show({ tone: "success", title: "ส่งรหัสใหม่แล้ว" });
    } catch (err) {
      show({
        tone: "error",
        title: "ส่งรหัสไม่สำเร็จ",
        detail: err instanceof ApiError ? err.message : undefined,
      });
    }
  };

  return (
    <AuthLayout
      title="ยืนยันการเข้าสู่ระบบ"
      description={`เราส่งรหัส 6 หลักไปที่ ${email} กรุณากรอกเพื่อเข้าสู่ระบบ`}
      footer={
        <button type="button" onClick={onBack} className="font-medium text-navy-700 hover:underline">
          ← ใช้อีเมลอื่น
        </button>
      }
    >
      <div className="flex flex-col gap-5">
        <OtpInput value={code} onChange={setCode} invalid={Boolean(error)} disabled={submitting} />

        {error ? (
          <p className="text-center text-[13px] text-danger" role="alert">
            {error}
          </p>
        ) : null}

        <div className="text-center text-sm text-ink-muted">
          ไม่ได้รับรหัส?{" "}
          {cooldown > 0 ? (
            <span className="tabular-nums">ขอใหม่ได้ใน {cooldown} วินาที</span>
          ) : (
            <button type="button" onClick={resend} className="font-medium text-navy-700 hover:underline">
              ส่งรหัสอีกครั้ง
            </button>
          )}
        </div>
      </div>
    </AuthLayout>
  );
}
