"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState, type FormEvent } from "react";

import { AuthLayout } from "@/components/AuthLayout";
import { useSession, type SessionUser } from "@/components/SessionProvider";
import { Button } from "@/components/ui/Button";
import { SelectField, TextField } from "@/components/ui/Field";
import { OtpInput } from "@/components/ui/OtpInput";
import { Spinner } from "@/components/ui/Spinner";
import { useToast } from "@/components/ui/Toast";
import { api, ApiError } from "@/lib/api";
import { PREFIXES, isBdiStaff, isOrganizationScopedRole } from "@/lib/status";

interface InvitationInfo {
  email: string;
  /** รหัส role ของคำเชิญ — ใช้ตัดสินว่าต้องกรอกเลขประจำตัวประชาชนไหม */
  role: string;
  roleLabel: string;
}

/** ยังไม่มี ThaiD จริง — เปิดปุ่มจำลองเฉพาะตอนตั้ง NEXT_PUBLIC_THAID_MOCK=true */
const THAID_MOCK = process.env.NEXT_PUBLIC_THAID_MOCK === "true";

export default function RegisterPage() {
  return (
    <Suspense fallback={<Spinner className="min-h-screen" />}>
      <RegisterFlow />
    </Suspense>
  );
}

function RegisterFlow() {
  const token = useSearchParams().get("token") ?? "";
  const [invitation, setInvitation] = useState<InvitationInfo | null>(null);
  const [invalidReason, setInvalidReason] = useState<string | null>(null);
  const [step, setStep] = useState<"details" | "otp">("details");

  useEffect(() => {
    if (!token) {
      setInvalidReason("ลิงก์ไม่สมบูรณ์ กรุณาเปิดจากอีเมลคำเชิญโดยตรง");
      return;
    }
    api
      .get<InvitationInfo>(`/api/auth/invitation?token=${encodeURIComponent(token)}`)
      .then(setInvitation)
      .catch((err) => setInvalidReason(err instanceof ApiError ? err.message : "ลิงก์ใช้งานไม่ได้"));
  }, [token]);

  if (invalidReason) return <InvalidLink reason={invalidReason} />;
  if (!invitation) return <Spinner className="min-h-screen" />;

  return step === "details" ? (
    <DetailsStep token={token} invitation={invitation} onDone={() => setStep("otp")} />
  ) : (
    <OtpStep token={token} email={invitation.email} onBack={() => setStep("details")} />
  );
}

// ---------------------------------------------------------------- ขั้นที่ 1

function DetailsStep({
  token,
  invitation,
  onDone,
}: {
  token: string;
  invitation: InvitationInfo;
  onDone: () => void;
}) {
  const { show } = useToast();
  const [form, setForm] = useState({
    prefix: "",
    firstName: "",
    lastName: "",
    phone: "",
    password: "",
    cid: "",
  });
  // บัญชีฝั่งหน่วยงานต้องมีเลขประจำตัวประชาชน ฝั่ง BDI ยังไม่เก็บ
  const needsCid = isOrganizationScopedRole(invitation.role);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const set = (key: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [key]: v }));

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setFields({});
    try {
      const { cid, ...rest } = form;
      await api.post("/api/auth/register", {
        token,
        ...rest,
        ...(needsCid ? { cid: cid.replace(/\D/g, "") } : {}),
      });
      show({ tone: "success", title: "ส่งรหัสยืนยันแล้ว", detail: `ตรวจสอบอีเมล ${invitation.email}` });
      onDone();
    } catch (err) {
      if (err instanceof ApiError) {
        setFields(err.fields);
        /**
         * ถ้า backend ตีกลับช่องที่ฟอร์มนี้ไม่มี ข้อความจะไม่ถูกแสดงที่ไหนเลย
         * ผู้ใช้เห็นแค่ "กรุณาตรวจสอบข้อมูลที่กรอก" โดยไม่มีช่องไหนขึ้นแดง —
         * เคยเกิดมาแล้วกับ cid จึงเอาข้อความพวกนั้นขึ้น toast แทนที่จะทิ้ง
         */
        const unbound = Object.entries(err.fields)
          .filter(([key]) => !(key in form))
          .map(([, message]) => message);
        if (Object.keys(err.fields).length === 0) {
          show({ tone: "error", title: "ลงทะเบียนไม่สำเร็จ", detail: err.message });
        } else {
          show({
            tone: "error",
            title: "กรุณาตรวจสอบข้อมูลที่กรอก",
            detail: unbound.length ? unbound.join(" · ") : undefined,
          });
        }
      }
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout
      title="ลงทะเบียนเข้าใช้งาน"
      description={`คุณได้รับเชิญในสิทธิ์ ${invitation.roleLabel}`}
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
        {/* อีเมลล็อกไว้ กัน invite ถูกใช้ผิดคน (docs/01-user-journey.md §A.2) */}
        <TextField label="อีเมล" value={invitation.email} readOnly disabled hint="อีเมลนี้มาจากคำเชิญ แก้ไขไม่ได้" />

        <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-3">
          <SelectField
            label="คำนำหน้า"
            required
            value={form.prefix}
            onChange={(e) => set("prefix")(e.target.value)}
            error={fields.prefix}
          >
            <option value="">เลือก</option>
            {PREFIXES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </SelectField>
          <TextField
            label="ชื่อ"
            required
            autoComplete="given-name"
            value={form.firstName}
            onChange={(e) => set("firstName")(e.target.value)}
            error={fields.firstName}
          />
        </div>

        <TextField
          label="นามสกุล"
          required
          autoComplete="family-name"
          value={form.lastName}
          onChange={(e) => set("lastName")(e.target.value)}
          error={fields.lastName}
        />
        <TextField
          label="เบอร์โทรศัพท์"
          required
          inputMode="tel"
          autoComplete="tel"
          placeholder="081-234-5678"
          value={form.phone}
          onChange={(e) => set("phone")(e.target.value)}
          error={fields.phone}
        />
        {needsCid ? (
          <TextField
            label="เลขประจำตัวประชาชน"
            required
            inputMode="numeric"
            maxLength={13}
            placeholder="1234567890123"
            value={form.cid}
            onChange={(e) => set("cid")(e.target.value.replace(/\D/g, "").slice(0, 13))}
            error={fields.cid}
            hint="ตัวเลข 13 หลัก ตามที่ปรากฏบนบัตรประชาชน"
          />
        ) : null}
        <TextField
          label="ตั้งรหัสผ่าน"
          type="password"
          required
          autoComplete="new-password"
          value={form.password}
          onChange={(e) => set("password")(e.target.value)}
          error={fields.password}
          hint="อย่างน้อย 8 ตัวอักษร ประกอบด้วยตัวอักษรและตัวเลข"
        />

        <Button type="submit" size="lg" loading={submitting} className="mt-1 w-full">
          ถัดไป — ยืนยันตัวตน
        </Button>
      </form>
    </AuthLayout>
  );
}

// ---------------------------------------------------------------- ขั้นที่ 2 (2FA)

function OtpStep({ token, email, onBack }: { token: string; email: string; onBack: () => void }) {
  const router = useRouter();
  const { setUser } = useSession();
  const { show } = useToast();

  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [thaidBusy, setThaidBusy] = useState(false);
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
        const data = await api.post<{ user: SessionUser }>("/api/auth/verify-otp", { token, code: value });
        setUser(data.user);
        show({ tone: "success", title: "ยืนยันตัวตนสำเร็จ" });
        router.push(isBdiStaff(data.user.roles) ? "/admin/organizations" : "/");
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "ยืนยันไม่สำเร็จ");
        setCode("");
        setSubmitting(false);
      }
    },
    [token, setUser, show, router],
  );

  // ครบ 6 หลักแล้วส่งเลย ไม่ต้องให้กดปุ่มซ้ำ
  useEffect(() => {
    if (code.length === 6 && !submitting) void submit(code);
  }, [code, submitting, submit]);

  const verifyWithThaiD = async () => {
    setThaidBusy(true);
    setError(null);
    try {
      const data = await api.post<{ user: SessionUser }>("/api/auth/thaid/verify", { token });
      setUser(data.user);
      show({ tone: "success", title: "ยืนยันตัวตนด้วย ThaiD สำเร็จ", detail: "โหมดจำลองสำหรับทดสอบ" });
      router.push(isBdiStaff(data.user.roles) ? "/admin/organizations" : "/");
    } catch (err) {
      show({
        tone: "error",
        title: "ยืนยันด้วย ThaiD ไม่สำเร็จ",
        detail: err instanceof ApiError ? err.message : undefined,
      });
      setThaidBusy(false);
    }
  };

  const resend = async () => {
    try {
      await api.post("/api/auth/resend-otp", { token });
      setCooldown(60);
      setError(null);
      show({ tone: "success", title: "ส่งรหัสใหม่แล้ว" });
    } catch (err) {
      show({ tone: "error", title: "ส่งรหัสไม่สำเร็จ", detail: err instanceof ApiError ? err.message : undefined });
    }
  };

  return (
    <AuthLayout
      title="ยืนยันตัวตน"
      description={`เราส่งรหัส 6 หลักไปที่ ${email} กรุณากรอกเพื่อยืนยัน`}
      footer={
        <button type="button" onClick={onBack} className="font-medium text-navy-700 hover:underline">
          ← กลับไปแก้ไขข้อมูล
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

        {/* ThaiD ยังไม่มี client credentials จริง — เปิด mock ไว้ให้ทดลอง flow ได้ */}
        <div className="mt-2 rounded-xl border border-dashed border-line bg-canvas p-4 text-center">
          <p className="text-[13px] text-ink-muted">
            หรือยืนยันตัวตนด้วย <span className="font-medium text-ink">ThaiD</span>
          </p>
          {THAID_MOCK ? (
            <>
              <Button
                variant="secondary"
                size="sm"
                className="mt-2.5"
                loading={thaidBusy}
                onClick={verifyWithThaiD}
              >
                ยืนยันด้วย ThaiD
              </Button>
              <p className="mt-2 text-[11px] text-ink-subtle">
                โหมดจำลองสำหรับทดสอบ ยังไม่ได้เชื่อมต่อระบบจริง
              </p>
            </>
          ) : (
            <Button variant="secondary" size="sm" disabled className="mt-2.5">
              เร็ว ๆ นี้
            </Button>
          )}
        </div>
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
          หากคุณคิดว่านี่เป็นข้อผิดพลาด กรุณาติดต่อเจ้าหน้าที่ BDI ที่เชิญคุณเข้าระบบ
          เพื่อขอลิงก์คำเชิญใหม่
        </p>
      </div>
    </AuthLayout>
  );
}
