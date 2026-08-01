"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { AuthLayout } from "@/components/AuthLayout";
import { useSession } from "@/components/SessionProvider";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { api, ApiError } from "@/lib/api";
import { isBdiStaff } from "@/lib/status";
import type { SessionUser } from "@/components/SessionProvider";

export default function LoginPage() {
  const router = useRouter();
  const { setUser } = useSession();
  const { show } = useToast();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setFields({});
    try {
      const data = await api.post<{ user: SessionUser }>("/api/auth/login", { email, password });
      setUser(data.user);
      router.push(isBdiStaff(data.user.roles) ? "/admin/organizations" : "/");
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
      footer={
        <p>
          ยังไม่มีบัญชี? ระบบนี้เปิดใช้งานด้วยคำเชิญเท่านั้น
          กรุณาติดต่อเจ้าหน้าที่ BDI เพื่อขอลิงก์ลงทะเบียน
        </p>
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
    </AuthLayout>
  );
}
