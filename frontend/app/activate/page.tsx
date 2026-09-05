"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState, type FormEvent } from "react";

import { AuthLayout } from "@/components/AuthLayout";
import { ThaidButton, storeActivationToken } from "@/components/auth/Thaid";
import { sessionUserName, useSession, type SessionUser } from "@/components/SessionProvider";
import { Button } from "@/components/ui/Button";
import { SelectField, TextField } from "@/components/ui/Field";
import { Spinner } from "@/components/ui/Spinner";
import { useToast } from "@/components/ui/Toast";
import { api, ApiError } from "@/lib/api";
import { PREFIXES } from "@/lib/status";

/**
 * หน้าจอ Account Activation (§2.3–2.5 ของสเปก ThaiD)
 *
 *   ?token=... มาจากลิงก์ในอีเมล  → ตรวจคีย์ แล้วเข้าขั้นยืนยันตัวตนด้วย ThaiD ทันที
 *   ไม่มี token (เข้ามาจากหน้า login) → ให้กรอก activation key ก่อน แล้วเดินเส้นทางเดียวกัน
 *
 * "ยืนยันตัวตนแล้วหรือยัง" ถามจาก backend เสมอ (`identityVerified`) ไม่ได้จำไว้ในหน้าเว็บ
 * เพราะกลับมาจาก ThaiD คนละ page load กัน และค่าที่เบราว์เซอร์อ้างเองก็เชื่อไม่ได้อยู่ดี
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
  const load = useCallback(async () => {
    if (!token) return;
    try {
      setInvitation(
        await api.get<InvitationInfo>(`/api/auth/invitation?token=${encodeURIComponent(token)}`),
      );
    } catch (err) {
      setInvalidReason(err instanceof ApiError ? err.message : "ลิงก์ใช้งานไม่ได้");
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!token) return <KeyEntry />;
  if (invalidReason) return <InvalidLink reason={invalidReason} />;
  if (!invitation) return <Spinner className="min-h-screen" />;

  return invitation.identityVerified ? (
    <AccountCreationStep token={token} invitation={invitation} />
  ) : (
    <IdentityStep token={token} invitation={invitation} />
  );
}

/**
 * เตือนก่อนเริ่ม เมื่อเบราว์เซอร์นี้มีคนล็อกอินค้างอยู่ และไม่ใช่คนในคำเชิญ
 *
 * การเปิดใช้งานบัญชีจบด้วย `issueSession()` ซึ่งหมุน cookie ใบเดียวของเบราว์เซอร์ทิ้ง
 * คนที่ล็อกอินค้างอยู่จึงหลุดออกจากระบบทุกแท็บจริง ๆ — คนที่กดลิงก์มาจากอีเมลแทบไม่มีทาง
 * เดาได้เอง บอกที่ต้นทางถูกกว่ามาบอกทีหลังว่าเกิดอะไรขึ้นไปแล้ว
 *
 * ไม่ปิดทางให้ต้องออกจากระบบก่อน — "เครื่องเดียว หลายคนใช้ต่อกัน" เป็นเคสที่ถูกต้อง
 */
function SignedInWarning({ invitationEmail }: { invitationEmail: string }) {
  const { user, setUser } = useSession();
  const [busy, setBusy] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  if (!user || acknowledged) return null;
  if (user.email.toLowerCase() === invitationEmail.toLowerCase()) return null;

  const name = sessionUserName(user);
  const logout = async () => {
    setBusy(true);
    await api.post("/api/auth/logout").catch(() => undefined);
    setUser(null);
    setBusy(false);
  };

  return (
    <div className="rounded-xl bg-warning-bg p-5">
      <p className="text-sm leading-relaxed text-warning">
        เบราว์เซอร์นี้กำลังเข้าสู่ระบบในชื่อ <span className="font-semibold">{name}</span> —
        การเปิดใช้งานบัญชี {invitationEmail} จะทำให้ {name} ออกจากระบบทุกแท็บ
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <Button variant="secondary" loading={busy} onClick={logout}>
          ออกจากระบบก่อน
        </Button>
        <Button variant="secondary" onClick={() => setAcknowledged(true)}>
          ดำเนินการต่อ
        </Button>
      </div>
    </div>
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

// ------------------------------------------------------------------ §2.4 ThaiD

function IdentityStep({ token, invitation }: { token: string; invitation: InvitationInfo }) {
  return (
    <AuthLayout
      title="ยืนยันตัวตนด้วย ThaiD"
      description={`เปิดใช้งานบัญชี ${invitation.email} ในสิทธิ์ ${invitation.roleLabel}`}
      footer={
        <p>
          ยังไม่มีแอปพลิเคชัน ThaiD? ลงทะเบียนได้ที่แอป ThaiD ของกรมการปกครอง
          หรือติดต่อเจ้าหน้าที่ BDI ที่เชิญคุณเข้าระบบ
        </p>
      }
    >
      <div className="flex flex-col gap-5">
        <SignedInWarning invitationEmail={invitation.email} />
        <div className="rounded-xl border border-line bg-canvas p-5">
          <p className="text-sm leading-relaxed text-ink-muted">
            ระบบจะเปรียบเทียบเลขประจำตัวประชาชนที่ได้จาก ThaiD
            กับเลขที่เจ้าหน้าที่บันทึกไว้ตอนสร้างบัญชีของคุณ
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
            และต้องขอลิงก์ใหม่จากเจ้าหน้าที่
          </p>
        </div>

        <ThaidButton
          purpose="activate"
          token={token}
          onBeforeRedirect={() => storeActivationToken(token)}
          label="ยืนยันตัวตนด้วย ThaiD"
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

  /**
   * ตั้งต้นด้วยสิ่งที่ระบบรู้อยู่แล้ว ไม่ใช่ฟอร์มเปล่า
   *
   * ผู้มีอำนาจกระทำการแทนถูกเจ้าหน้าที่ของหน่วยงานกรอกชื่อ นามสกุล และเบอร์โทรไว้แล้ว
   * ตั้งแต่ตอนลงทะเบียนหน่วยงาน — ให้เขาพิมพ์ซ้ำคือให้โอกาสพิมพ์ไม่ตรงกับที่ลงทะเบียนไว้
   * เติมให้เป็นค่าตั้งต้น แก้ได้ทุกช่อง
   */
  const [form, setForm] = useState({
    // คำนำหน้าเป็น dropdown ที่มีตัวเลือกจำกัด ค่าที่ไม่อยู่ในรายการ (เช่น "นายแพทย์"
    // ที่มาจากข้อมูลนำเข้า) จะทำให้ช่องแสดงเป็นว่างแล้วส่งค่าว่างไปโดยที่คนกรอกไม่ทันเห็น
    prefix: PREFIXES.includes(invitation.profile.prefix ?? "") ? invitation.profile.prefix! : "",
    firstName: invitation.profile.firstName ?? "",
    lastName: invitation.profile.lastName ?? "",
    phone: invitation.profile.phone ?? "",
    password: "",
  });
  const [fields, setFields] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  /**
   * ชื่อจาก ThaiD ที่หน้า callback ฝากไว้ ใช้เติมฟอร์มให้ตรงกับบัตร
   * ไม่มีก็ไม่เป็นไร — ผู้ใช้กรอกเองได้ และฝั่ง server ไม่ได้เชื่อค่านี้อยู่แล้ว
   *
   * **ทับค่าที่มาจากคำเชิญ** สำหรับชื่อ นามสกุล และคำนำหน้า — บัตรประชาชนมีน้ำหนักกว่า
   * สิ่งที่เพื่อนร่วมงานพิมพ์ให้ ส่วนเบอร์โทรไม่มีใน ThaiD จึงเหลือค่าจากคำเชิญไว้อย่างเดิม
   * ค่าที่ ThaiD ไม่ได้ส่งมา (คำนำหน้าอยู่นอก scope ที่ขอ) ก็ไม่ล้างของเดิมทิ้ง
   */
  useEffect(() => {
    const raw = sessionStorage.getItem("thaid:profile");
    if (!raw) return;
    try {
      const profile = JSON.parse(raw) as Record<string, string | null>;
      setForm((f) => ({
        ...f,
        prefix: PREFIXES.includes(profile.prefix ?? "") ? profile.prefix! : f.prefix,
        firstName: profile.firstName ?? f.firstName,
        lastName: profile.lastName ?? f.lastName,
      }));
    } catch {
      /* ค่าเสีย = ไม่เติม */
    }
  }, []);

  const set = (key: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [key]: v }));

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setFields({});
    try {
      const data = await api.post<{ user: SessionUser }>("/api/auth/activate", { token, ...form });
      sessionStorage.removeItem("thaid:profile");
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
      description={`ยืนยันตัวตนกับ ThaiD เรียบร้อยแล้ว เหลือเพียงตั้งรหัสผ่านสำหรับ ${invitation.email}`}
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
        <SignedInWarning invitationEmail={invitation.email} />
        <div className="rounded-xl bg-success-bg px-4 py-3 text-[13px] leading-relaxed text-success">
          ยืนยันตัวตนด้วย ThaiD สำเร็จ — เลขประจำตัวประชาชนตรงกับที่บันทึกไว้ในระบบ
        </div>

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
          เปิดใช้งานบัญชี
        </Button>
      </form>
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
