"use client";

import clsx from "clsx";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";

import { AuthLayout } from "@/components/AuthLayout";
import { ThaidButton, storeActivationToken } from "@/components/auth/Thaid";
import { sessionUserName, useSession, type SessionUser } from "@/components/SessionProvider";
import { Button } from "@/components/ui/Button";
import { SelectField, TextField } from "@/components/ui/Field";
import { Spinner } from "@/components/ui/Spinner";
import { useToast } from "@/components/ui/Toast";
import { api, ApiError } from "@/lib/api";
import { PASSWORD_RULES, passwordMeetsRules } from "@/lib/password";
import { PREFIXES } from "@/lib/status";

/**
 * หน้าจอ Account Activation (§2.3–2.5 ของสเปก ThaID)
 *
 *   ?token=... มาจากลิงก์ในอีเมล  → ตรวจคีย์ แล้วเข้าขั้นยืนยันตัวตนด้วย ThaID ทันที
 *   ไม่มี token (เข้ามาจากหน้า login) → ให้กรอก activation key ก่อน แล้วเดินเส้นทางเดียวกัน
 *
 * "ยืนยันตัวตนแล้วหรือยัง" ถามจาก backend เสมอ (`identityVerified`) ไม่ได้จำไว้ในหน้าเว็บ
 * เพราะกลับมาจาก ThaID คนละ page load กัน และค่าที่เบราว์เซอร์อ้างเองก็เชื่อไม่ได้อยู่ดี
 */
interface InvitationInfo {
  email: string;
  role: string;
  roleLabel: string;
  organizationName: string;
  expiresAt: string;
  cidHint: string | null;
  identityVerified: boolean;
  /** ข้อมูลที่ถูกกรอกไว้ให้บัญชีนี้แล้ว — ผู้มีอำนาจได้มาจากฟอร์มลงทะเบียนหน่วยงาน */
  profile: {
    prefix: string | null;
    firstName: string | null;
    lastName: string | null;
    phone: string | null;
  };
  /**
   * ช่องไหนแก้ไม่ได้ — ตัดสินที่ backend (`lockedProfile()` ใน routes/auth.ts) ไม่ใช่
   * ที่นี่ ค่าที่ล็อกคือชื่อจากบัตรที่ ThaID ส่งมา ตกมาที่ชื่อที่เจ้าหน้าที่กรอกไว้
   * ตอนเชิญ `POST /activate` ทิ้งค่าใน body ของช่องเหล่านี้อยู่แล้ว หน้าเว็บทำให้เห็น
   */
  profileLocked: {
    prefix: boolean;
    firstName: boolean;
    lastName: boolean;
  };
}

export default function ActivatePage() {
  return (
    <Suspense fallback={<Spinner className="min-h-screen" />}>
      <ActivateFlow />
    </Suspense>
  );
}

function ActivateFlow() {
  const token = useSearchParams().get("token") ?? "";
  const [invitation, setInvitation] = useState<InvitationInfo | null>(null);
  const [invalidReason, setInvalidReason] = useState<string | null>(null);
  /**
   * ลิงก์ยังดี แต่ที่นั่งของบทบาทนี้ในหน่วยงานมีคนใช้งานอยู่ — คนละเรื่องกับลิงก์ตาย
   *
   * `GET /invitation` ตอบ 409 `role_occupied` โดย **ไม่** ทำลายคีย์ (ดู routes/auth.ts)
   * ถ้าแสดงเป็น "ลิงก์ใช้งานไม่ได้ ขอลิงก์ใหม่" ผู้รับจะไปขอคำเชิญใหม่ทั้งที่ใบเดิมกดซ้ำได้
   * ทันทีที่ผู้ประสานงานของ BDI ระงับคนเดิม — ข้อความจึงต้องบอกให้รอ ไม่ใช่ให้ขอใหม่
   */
  const [occupiedReason, setOccupiedReason] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!token) return;
    try {
      setInvitation(
        await api.get<InvitationInfo>(`/api/auth/invitation?token=${encodeURIComponent(token)}`),
      );
    } catch (err) {
      if (err instanceof ApiError && err.code === "role_occupied") {
        setOccupiedReason(err.message);
        return;
      }
      setInvalidReason(err instanceof ApiError ? err.message : "ลิงก์ใช้งานไม่ได้");
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!token) return <KeyEntry />;
  if (occupiedReason) return <SeatOccupied reason={occupiedReason} />;
  if (invalidReason) return <InvalidLink reason={invalidReason} />;
  if (!invitation) return <Spinner className="min-h-screen" />;

  return (
    <SignedInGate invitationEmail={invitation.email}>
      {invitation.identityVerified ? (
        <AccountCreationStep token={token} invitation={invitation} />
      ) : (
        <IdentityStep token={token} invitation={invitation} />
      )}
    </SignedInGate>
  );
}

/**
 * ปิดทางเปิดใช้งานบัญชี ตราบใดที่เบราว์เซอร์นี้ยังมีคนอื่นล็อกอินค้างอยู่
 *
 * การเปิดใช้งานบัญชีจบด้วย `issueSession()` ซึ่งหมุน cookie ใบเดียวของเบราว์เซอร์ทิ้ง
 * คนที่ล็อกอินค้างอยู่จึงหลุดออกจากระบบทุกแท็บจริง ๆ โดยไม่เคยกดอะไรเลย
 *
 * เดิมตรงนี้เป็นเพียงกล่องเตือน มีปุ่ม "ดำเนินการต่อ" ให้กดผ่านไปได้ทั้งที่ session เดิม
 * ยังอยู่ — ปุ่มนั้นไม่ได้ทำอะไรนอกจากซ่อนคำเตือน ปลายทางก็ยังเตะคนเดิมออกอยู่ดี
 * (การ์ด "Have current Session while activate new account") ทางที่ตรงกับสิ่งที่เกิดขึ้นจริง
 * คือให้ออกจากระบบเสียก่อน แล้วค่อยเริ่ม — เจ้าของ session เดิมจึงได้เลือกเองว่าจะออกเมื่อไร
 * ไม่ใช่รู้ตัวอีกทีตอนถูกเตะออกไปแล้ว "เครื่องเดียว หลายคนใช้ต่อกัน" ยังทำได้ตามเดิม
 * เพียงแต่ต้องออกจากระบบก่อนหนึ่งครั้ง
 */
function SignedInGate({
  invitationEmail,
  children,
}: {
  invitationEmail: string;
  children: ReactNode;
}) {
  const { user, loading, setUser } = useSession();
  const [busy, setBusy] = useState(false);

  // ยังไม่รู้ว่าใครล็อกอินอยู่ — อย่าเพิ่งวาดอะไรทั้งสองทาง ไม่งั้นหน้าจะกะพริบสลับกัน
  if (loading) return <Spinner className="min-h-screen" />;
  if (!user) return <>{children}</>;
  if (user.email.toLowerCase() === invitationEmail.toLowerCase()) return <>{children}</>;

  const name = sessionUserName(user);
  const logout = async () => {
    setBusy(true);
    await api.post("/api/auth/logout").catch(() => undefined);
    // ไม่ต้องประกาศให้แท็บอื่นรู้เอง — effect ใน SessionProvider ที่เฝ้า `user` ทำให้แล้ว
    setUser(null);
    setBusy(false);
  };

  return (
    <AuthLayout
      title="ต้องออกจากระบบก่อน"
      description={`เบราว์เซอร์นี้กำลังเข้าสู่ระบบในชื่อ ${name}`}
      footer={
        <Link href="/" className="font-medium text-navy-700 hover:underline">
          ← กลับไปหน้าแรก
        </Link>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="rounded-xl bg-warning-bg p-5">
          <p className="text-sm leading-relaxed text-warning">
            การเปิดใช้งานบัญชี <span className="font-semibold">{invitationEmail}</span>{" "}
            จะทำให้ <span className="font-semibold">{name}</span> ออกจากระบบทุกแท็บ
            จึงต้องออกจากระบบให้เรียบร้อยก่อน แล้วจึงเริ่มเปิดใช้งานบัญชีใหม่ได้
          </p>
          <p className="mt-3 text-[13px] leading-relaxed text-warning">
            ถ้ายังมีงานค้างอยู่ในอีกแท็บหนึ่ง ให้บันทึกงานนั้นก่อน
            ลิงก์เปิดใช้งานนี้ยังใช้ได้อยู่ กลับมากดใหม่ได้ตลอด
          </p>
        </div>
        <Button size="lg" loading={busy} onClick={logout} className="w-full">
          ออกจากระบบแล้วดำเนินการต่อ
        </Button>
      </div>
    </AuthLayout>
  );
}

// ------------------------------------------------- เข้ามาจากหน้า login: กรอกคีย์เอง

function KeyEntry() {
  const router = useRouter();
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setChecking(true);
    setError(null);
    const trimmed = key.trim();
    try {
      // ตรวจก่อนพาไป เพื่อให้คีย์ผิดขึ้นใต้ช่องกรอก แทนที่จะเด้งไปหน้า "ลิงก์ใช้งานไม่ได้"
      await api.get(`/api/auth/invitation?token=${encodeURIComponent(trimmed)}`);
      router.push(`/activate?token=${encodeURIComponent(trimmed)}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "ตรวจสอบ Activation Key ไม่สำเร็จ");
      setChecking(false);
    }
  };

  return (
    <AuthLayout
      title="เปิดใช้งานบัญชี"
      description="กรอก Activation Key ที่ได้รับทางอีเมล เพื่อเริ่มยืนยันตัวตน"
      footer={
        <Link href="/login" className="font-medium text-navy-700 hover:underline">
          ← กลับไปหน้าเข้าสู่ระบบ
        </Link>
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
        <TextField
          label="Activation Key"
          required
          autoComplete="one-time-code"
          spellCheck={false}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          error={error ?? undefined}
          hint="คัดลอกจากอีเมลคำเชิญ หรือกดปุ่มในอีเมลเพื่อข้ามขั้นตอนนี้"
        />
        <Button type="submit" size="lg" loading={checking} className="mt-1 w-full">
          ถัดไป
        </Button>
      </form>
    </AuthLayout>
  );
}

// ------------------------------------------------------------------ §2.4 ThaID

function IdentityStep({ token, invitation }: { token: string; invitation: InvitationInfo }) {
  return (
    <AuthLayout
      title="ยืนยันตัวตนด้วย ThaID"
      description={`เปิดใช้งานบัญชี ${invitation.email} ในสิทธิ์ ${invitation.roleLabel}`}
      footer={
        <p>
          ยังไม่มีแอปพลิเคชัน ThaID? ลงทะเบียนได้ที่แอป ThaID ของกรมการปกครอง
          หรือติดต่อผู้ประสานงานของ BDI ที่เชิญคุณเข้าระบบ
        </p>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="rounded-xl border border-line bg-canvas p-5">
          <p className="text-sm leading-relaxed text-ink-muted">
            ระบบจะเปรียบเทียบเลขประจำตัวประชาชนที่ได้จาก ThaID
            กับเลขที่ผู้ประสานงานของ BDI บันทึกไว้ตอนสร้างบัญชีของคุณ
            {invitation.cidHint ? (
              <>
                {" "}
                (ลงท้ายด้วย{" "}
                <span className="font-medium tabular-nums text-ink">
                  {invitation.cidHint.slice(-4)}
                </span>
                )
              </>
            ) : null}
          </p>
          <p className="mt-3 text-[13px] leading-relaxed text-ink-subtle">
            หากเลขไม่ตรงกัน ลิงก์เปิดใช้งานนี้จะถูกยกเลิกทันทีเพื่อความปลอดภัย
            และต้องขอลิงก์ใหม่จากผู้ประสานงานของ BDI
          </p>
        </div>

        <ThaidButton
          purpose="activate"
          token={token}
          onBeforeRedirect={() => storeActivationToken(token)}
          label="ยืนยันตัวตนด้วย ThaID"
        />
      </div>
    </AuthLayout>
  );
}

// ------------------------------------------------------- §2.5 ตั้งรหัสผ่าน + เปิดใช้งาน

function AccountCreationStep({ token, invitation }: { token: string; invitation: InvitationInfo }) {
  const router = useRouter();
  const { setUser } = useSession();
  const { show } = useToast();
  const locked = invitation.profileLocked;

  /**
   * ตั้งต้นด้วยสิ่งที่ระบบรู้อยู่แล้ว ไม่ใช่ฟอร์มเปล่า
   *
   * คำนำหน้า ชื่อ นามสกุล มาจาก `GET /invitation` ซึ่งอ่านจากแถวบัญชี — callback ของ
   * ThaID เขียน claim จากบัตรลงไปตั้งแต่ตอนยืนยันตัวตนผ่าน แล้วตกมาที่ชื่อที่เจ้าหน้าที่
   * กรอกไว้ตอนเชิญเมื่อ ThaID ไม่ได้ส่ง claim นั้นมา ช่องที่มีค่าแล้วจึงถูกล็อก
   * (การ์ด "แก้ form user registration") ส่วนเบอร์โทร ThaID ไม่มีให้ ยังแก้ได้ตามเดิม
   *
   * ไม่ต้องกรอง `PREFIXES` อีกแล้ว: คำนำหน้าที่มีค่าอยู่แล้วแสดงเป็นข้อความอ่านอย่างเดียว
   * ค่านอกรายการอย่าง "นายแพทย์" จึงไม่ทำให้ dropdown ว่างแล้วส่งค่าว่างไปอย่างเงียบ ๆ
   */
  const [form, setForm] = useState({
    prefix: (invitation.profile.prefix ?? "").trim(),
    firstName: (invitation.profile.firstName ?? "").trim(),
    lastName: (invitation.profile.lastName ?? "").trim(),
    phone: invitation.profile.phone ?? "",
    password: "",
    confirmPassword: "",
  });
  const [fields, setFields] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const set = (key: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [key]: v }));

  const passwordOk = passwordMeetsRules(form.password);
  // ฟ้องเฉพาะเมื่อเริ่มพิมพ์ช่องยืนยันแล้ว — ไม่ใช่ตั้งแต่ตัวอักษรแรกของช่องบน
  const mismatch = form.confirmPassword.length > 0 && form.confirmPassword !== form.password;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setFields({});
    try {
      const data = await api.post<{ user: SessionUser }>("/api/auth/activate", { token, ...form });
      setUser(data.user);
      show({ tone: "success", title: "เปิดใช้งานบัญชีสำเร็จ" });
      // ทุก role มีหน้าแรกที่ `/` แล้ว
      router.push("/");
    } catch (err) {
      if (err instanceof ApiError) {
        setFields(err.fields);
        if (Object.keys(err.fields).length === 0) {
          show({ tone: "error", title: "เปิดใช้งานบัญชีไม่สำเร็จ", detail: err.message });
        }
        // ใบยืนยันตัวตนหมดอายุระหว่างกรอกฟอร์ม — ให้กลับไปยืนยันใหม่แทนที่จะติดค้าง
        if (err.code === "identity_required") router.refresh();
      }
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout
      title="สร้างบัญชีผู้ใช้"
      description={`ยืนยันตัวตนกับ ThaID เรียบร้อยแล้ว เหลือเพียงตั้งรหัสผ่านสำหรับ ${invitation.email}`}
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
        <div className="rounded-xl bg-success-bg px-4 py-3 text-[13px] leading-relaxed text-success">
          ยืนยันตัวตนด้วย ThaID สำเร็จ — เลขประจำตัวประชาชนตรงกับที่บันทึกไว้ในระบบ
        </div>

        <TextField label="อีเมล" value={invitation.email} readOnly disabled hint="อีเมลนี้มาจากคำเชิญ แก้ไขไม่ได้" />

        <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-3">
          {locked.prefix ? (
            <TextField label="คำนำหน้า" value={form.prefix} readOnly />
          ) : (
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
          )}
          {locked.firstName ? (
            <TextField label="ชื่อ" value={form.firstName} readOnly />
          ) : (
            <TextField
              label="ชื่อ"
              required
              autoComplete="given-name"
              value={form.firstName}
              onChange={(e) => set("firstName")(e.target.value)}
              error={fields.firstName}
            />
          )}
        </div>

        {locked.lastName ? (
          <TextField label="นามสกุล" value={form.lastName} readOnly />
        ) : (
          <TextField
            label="นามสกุล"
            required
            autoComplete="family-name"
            value={form.lastName}
            onChange={(e) => set("lastName")(e.target.value)}
            error={fields.lastName}
          />
        )}

        {/*
          บอกครั้งเดียวว่าทำไมช่องข้างบนแก้ไม่ได้ แทนที่จะเขียน hint ซ้ำใต้ทุกช่อง —
          เหตุผลเป็นเรื่องเดียวกันทั้งกลุ่ม และช่องที่ยังไม่ล็อก (คำนำหน้าเป็นปกติ
          เพราะ ThaID ไม่ส่ง claim นั้นมา) ต้องไม่ถูกอ่านว่าล็อกไปด้วย
        */}
        {locked.prefix || locked.firstName || locked.lastName ? (
          <p className="-mt-2 text-[13px] leading-relaxed text-ink-muted">
            {locked.prefix && locked.firstName && locked.lastName
              ? "คำนำหน้า ชื่อ และนามสกุล"
              : locked.firstName && locked.lastName
                ? "ชื่อและนามสกุล"
                : "ข้อมูลที่แสดงไว้แล้ว"}{" "}
            เป็นข้อมูลที่ระบบได้รับมาแล้ว จึงแก้ไขในหน้านี้ไม่ได้ —
            หากไม่ตรงกับบัตรประชาชน กรุณาติดต่อผู้ประสานงานของ BDI ที่เชิญคุณเข้าระบบ
          </p>
        ) : null}

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

        <div className="flex flex-col gap-3">
          <TextField
            label="ตั้งรหัสผ่าน"
            type="password"
            required
            autoComplete="new-password"
            value={form.password}
            onChange={(e) => set("password")(e.target.value)}
            error={fields.password}
            valid={passwordOk}
          />
          <PasswordRequirements value={form.password} />
        </div>

        <TextField
          label="ยืนยันรหัสผ่าน"
          type="password"
          required
          autoComplete="new-password"
          value={form.confirmPassword}
          onChange={(e) => set("confirmPassword")(e.target.value)}
          error={mismatch ? "รหัสผ่านทั้งสองช่องไม่ตรงกัน" : fields.confirmPassword}
          valid={form.confirmPassword.length > 0 && !mismatch && passwordOk}
          hint="พิมพ์รหัสผ่านเดิมอีกครั้ง เพื่อกันการพิมพ์ผิดโดยไม่รู้ตัว"
        />

        <Button type="submit" size="lg" loading={submitting} className="mt-1 w-full">
          เปิดใช้งานบัญชี
        </Button>
      </form>
    </AuthLayout>
  );
}

/**
 * ข้อกำหนดรหัสผ่านที่ติ๊กเองระหว่างพิมพ์
 *
 * แสดงทั้งห้าข้อตลอดเวลา ไม่ใช่โผล่มาเฉพาะข้อที่ยังไม่ผ่าน — คนตั้งรหัสผ่านต้องเห็น
 * ข้อกำหนดทั้งชุดก่อนเริ่มพิมพ์ ไม่ใช่ค่อย ๆ รู้ทีละข้อจากข้อความ error
 *
 * สถานะไม่ได้บอกด้วยสีอย่างเดียว (docs/02-ui-spec.md): ข้อที่ผ่านแล้วมีเครื่องหมายถูก
 * ข้อที่ยังไม่ผ่านเป็นวงกลมว่าง และมีข้อความสำหรับโปรแกรมอ่านหน้าจอกำกับทุกข้อ
 */
function PasswordRequirements({ value }: { value: string }) {
  return (
    <ul className="flex flex-col gap-1.5 rounded-xl bg-canvas px-4 py-3">
      {PASSWORD_RULES.map((rule) => {
        const met = rule.test(value);
        return (
          <li
            key={rule.id}
            className={clsx(
              "flex items-start gap-2 text-[13px] leading-relaxed",
              met ? "text-success" : "text-ink-muted",
            )}
          >
            <span aria-hidden="true" className="mt-[3px] shrink-0">
              {met ? (
                <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <path d="m3 8.5 3.2 3.2L13 5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : (
                <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <circle cx="8" cy="8" r="4" />
                </svg>
              )}
            </span>
            <span>
              {rule.label}
              <span className="sr-only">{met ? " — ผ่านแล้ว" : " — ยังไม่ผ่าน"}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** ที่นั่งไม่ว่าง — ลิงก์ใบนี้ยังใช้ได้ กดซ้ำได้เมื่อ BDI ระงับหรือยุติบัญชีคนเดิมแล้ว */
function SeatOccupied({ reason }: { reason: string }) {
  return (
    <AuthLayout
      title="ยังเปิดใช้งานบัญชีไม่ได้ในขณะนี้"
      description={reason}
      footer={
        <Link href="/login" className="font-medium text-navy-700 hover:underline">
          ไปหน้าเข้าสู่ระบบ
        </Link>
      }
    >
      <div className="rounded-xl bg-warning-bg p-5">
        <p className="text-sm leading-relaxed text-ink">
          หนึ่งหน่วยงานมีผู้ดำเนินการและผู้มีอำนาจอนุมัติได้อย่างละหนึ่งคน
          ลิงก์คำเชิญของคุณยังใช้ได้อยู่ — เมื่อผู้ประสานงานของ BDI ระงับหรือยุติบัญชีของผู้ถือบทบาทคนเดิมแล้ว
          ให้เปิดลิงก์เดิมอีกครั้งได้ทันที ไม่ต้องขอคำเชิญใหม่
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
          หากคุณคิดว่านี่เป็นข้อผิดพลาด กรุณาติดต่อผู้ประสานงานของ BDI ที่เชิญคุณเข้าระบบ
          เพื่อขอลิงก์คำเชิญใหม่
        </p>
      </div>
    </AuthLayout>
  );
}
