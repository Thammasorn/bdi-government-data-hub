"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";

import { AuthLayout } from "@/components/AuthLayout";
import { ThaidButton } from "@/components/auth/Thaid";
import { useSession } from "@/components/SessionProvider";
import { Button } from "@/components/ui/Button";
import { PasswordField, TextField } from "@/components/ui/Field";
import { nextFromLocation } from "@/lib/require-auth";
import { OtpInput } from "@/components/ui/OtpInput";
import { useToast } from "@/components/ui/Toast";
import { api, ApiError } from "@/lib/api";
import type { SessionUser } from "@/components/SessionProvider";

/**
 * เข้าสู่ระบบสองทาง ตาม "Login Step" ของสเปก
 *   1. รหัสผ่าน + OTP ทางอีเมล  (สองขั้น — /login แล้ว /login/verify-otp)
 *   2. ThaID                    (จับคู่บัญชีด้วยเลขประจำตัวประชาชน)
 */
export default function LoginPage() {
  const [step, setStep] = useState<"credentials" | "otp">("credentials");
  const [email, setEmail] = useState("");
  // แถว outbox ของอีเมล OTP — หน้าขั้นที่สองถามสถานะการส่งจากตัวนี้ (การ์ด "Send every email through the delivery worker")
  const [otpDeliveryId, setOtpDeliveryId] = useState<string | null>(null);

  return step === "credentials" ? (
    <CredentialsStep
      email={email}
      setEmail={setEmail}
      onSent={(id) => {
        setOtpDeliveryId(id);
        setStep("otp");
      }}
    />
  ) : (
    <OtpStep
      email={email}
      deliveryId={otpDeliveryId}
      onResent={setOtpDeliveryId}
      onBack={() => setStep("credentials")}
    />
  );
}

function CredentialsStep({
  email,
  setEmail,
  onSent,
}: {
  email: string;
  setEmail: (v: string) => void;
  onSent: (otpDeliveryId: string | null) => void;
}) {
  const { show } = useToast();
  const [password, setPassword] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setFields({});
    try {
      const res = await api.post<{ otpDeliveryId?: string | null }>("/api/auth/login", { email, password });
      show({ tone: "success", title: "ส่งรหัสยืนยันแล้ว", detail: `ตรวจสอบอีเมล ${email}` });
      onSent(res.otpDeliveryId ?? null);
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
      description="ใช้อีเมลที่ได้รับคำเชิญจากสถาบันข้อมูลขนาดใหญ่ (องค์การมหาชน)"
      back={{ href: "/", label: "กลับไปหน้าแรก" }}
      footer={
        <div className="flex flex-col gap-2">
          <p>
            ได้รับคำเชิญแล้วแต่ยังไม่ได้เปิดใช้งานบัญชี?{" "}
            <Link href="/activate" className="font-medium text-navy-700 hover:underline">
              กรอก Activation Key
            </Link>
          </p>
          <p>ยังไม่มีบัญชี? ระบบนี้เปิดใช้งานด้วยคำเชิญเท่านั้น กรุณาติดต่อผู้ประสานงานของ BDI</p>
          <p>ลืมรหัสผ่าน? ติดต่อผู้ประสานงานของ BDI เพื่อขอลิงก์ตั้งรหัสผ่านใหม่ทางอีเมล</p>
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
        <PasswordField
          label="รหัสผ่าน"
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

      <div className="my-6 flex items-center gap-3 text-[13px] text-ink-subtle">
        <span className="h-px flex-1 bg-line" />
        หรือ
        <span className="h-px flex-1 bg-line" />
      </div>

      <ThaidButton purpose="login" variant="secondary" label="เข้าสู่ระบบด้วย ThaID" />
      <p className="mt-2.5 text-center text-[13px] text-ink-muted">
        ใช้ได้กับบัญชีที่เปิดใช้งานด้วย ThaID แล้ว
      </p>
    </AuthLayout>
  );
}

// ---------------------------------------------------------------- OTP (2FA)

type OtpDeliveryState = "queued" | "sent" | "retrying" | "failed" | "cancelled";

/**
 * อีเมล OTP ส่งโดย delivery-worker แล้ว คำตอบของ /login จึงบอกแค่ "เข้าคิว" — ถามสถานะทุกวินาทีจนส่งถึงหรือครบ 30 วินาที
 * ถ้าส่งไม่สำเร็จ หน้าจอบอกผู้ใช้และเปิดปุ่มขอรหัสใหม่ทันที แทนให้รอรหัสที่ไม่มีวันมา (การ์ดข้อ 3.5) — API ตอบแค่สถานะ ไม่มีอะไรอื่น
 */
function useOtpDelivery(id: string | null): OtpDeliveryState | null {
  const [state, setState] = useState<OtpDeliveryState | null>(null);
  useEffect(() => {
    setState(null);
    if (!id) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const started = Date.now();
    const tick = async () => {
      try {
        const res = await api.get<{ state: OtpDeliveryState }>(`/api/auth/otp-delivery/${id}`, { background: true });
        if (!alive) return;
        setState(res.state);
        if (res.state === "sent" || res.state === "failed" || res.state === "cancelled") return;
      } catch {
        // เงียบ — ไม่ใช่สิ่งที่ผู้ใช้ต้องรู้ถ้าเราถามสถานะไม่ได้
      }
      if (alive && Date.now() - started < 30_000) timer = setTimeout(() => void tick(), 1_000);
    };
    void tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [id]);
  return state;
}

function OtpStep({
  email,
  deliveryId,
  onResent,
  onBack,
}: {
  email: string;
  deliveryId: string | null;
  onResent: (id: string | null) => void;
  onBack: () => void;
}) {
  const router = useRouter();
  const { setUser } = useSession();
  const { show } = useToast();

  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [cooldown, setCooldown] = useState(60);
  const delivery = useOtpDelivery(deliveryId);
  const deliveryFailed = delivery === "failed" || delivery === "cancelled";
  // ส่งไม่สำเร็จ = ไม่ต้องรอนับถอยหลัง ให้ขอรหัสใหม่ได้เลย
  useEffect(() => {
    if (deliveryFailed) setCooldown(0);
  }, [deliveryFailed]);

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
         * มีปลายทางฝากไว้ก็ไปที่นั่น ไม่มีก็ไปหน้าแรก
         *
         * "หลัง login ให้ไปหน้าแรกเสมอ" ถูกอ่านเป็น `router.push("/")` เมื่อ 2026-09-06
         * ซึ่งตัดลิงก์ในอีเมลทิ้งไปด้วย — อีเมลทุกฉบับชี้ตรงเข้าหน้ารายละเอียด ผู้รับที่ยัง
         * ไม่ได้ล็อกอินจึงมาถึงที่นี่พร้อม `?next=<หน้านั้น>` แล้วถูกทิ้งไว้ที่หน้าแรกให้ไป
         * หาคำขอเองในตาราง BDI ยืนยันเมื่อ 2026-09-06 ว่าที่ต้องการคือสองอย่างพร้อมกัน
         * และบรรทัดนี้ให้ทั้งสองอย่างอยู่แล้ว:
         *
         *   ออกจากระบบแล้วล็อกอินใหม่ → ปุ่มออกจากระบบพาไป `/login` เปล่า ๆ ไม่มี `next`
         *                               (`AppShell` เจตนาไม่ใส่ ดูคอมเมนต์ที่นั่น) → หน้าแรก
         *   กดจากลิงก์ในอีเมล          → `/login?next=/datasets/…` → หน้านั้นเลย
         *
         * `safeNextPath()` กัน open redirect ไว้แล้ว ค่านี้จึงเป็น path ภายในเว็บนี้เสมอ
         *
         * อ่านจาก window.location ไม่ใช่ useSearchParams() — หน้านี้เป็น client component
         * ที่ไม่มี <Suspense> ครอบ และตอนนี้คือหลังกดยืนยัน OTP แล้ว เบราว์เซอร์พร้อมมานานแล้ว
         */
        const next = nextFromLocation();
        // ทุก role มีหน้าแรกที่ `/` แล้ว รวมถึงผู้ประสานงานของ BDI ที่เคยถูกส่งไปตารางคิวตรง ๆ
        router.push(next ?? "/");
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
      const res = await api.post<{ otpDeliveryId?: string | null }>("/api/auth/login/resend-otp", { email });
      onResent(res.otpDeliveryId ?? null);
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

        {deliveryFailed ? (
          <p className="rounded-xl bg-danger-bg px-4 py-3 text-center text-[13.5px] text-danger" role="alert">
            ส่งรหัสไม่สำเร็จ กรุณากดส่งรหัสอีกครั้ง — ถ้ายังไม่ได้รับ โปรดติดต่อผู้ดูแลระบบ
          </p>
        ) : delivery === "retrying" ? (
          <p className="text-center text-[13px] text-warning" role="status">
            เซิร์ฟเวอร์อีเมลตอบช้า ระบบกำลังส่งรหัสอีกครั้ง…
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
