"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { LegalDocumentsCard, useLegalDocuments } from "@/components/organization/LegalDocuments";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { useToast } from "@/components/ui/Toast";
import { api, ApiError } from "@/lib/api";
import type { Organization } from "@/lib/types";

export default function PreviewPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { show } = useToast();

  const [org, setOrg] = useState<Organization | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { documents } = useLegalDocuments(id);

  useEffect(() => {
    api
      .get<{ organization: Organization }>(`/api/organizations/${id}`)
      .then((d) => setOrg(d.organization))
      .catch(() => show({ tone: "error", title: "โหลดข้อมูลไม่สำเร็จ" }));
  }, [id, show]);

  if (!org) return <Spinner />;

  const form = org.attachments.find((a) => a.kind === "GENERATED_FORM");

  const submit = async () => {
    setSubmitting(true);
    try {
      await api.post(`/api/organizations/${id}/submit`);
      show({
        tone: "success",
        title: "นำส่งคำขอเรียบร้อย",
        detail: "ระบบแจ้งเจ้าหน้าที่ BDI ให้เข้ามาตรวจสอบแล้ว",
      });
      router.push(`/organizations/${id}`);
    } catch (err) {
      show({
        tone: "error",
        title: "นำส่งไม่สำเร็จ",
        detail: err instanceof ApiError ? err.message : undefined,
      });
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <Link href={`/organizations/${id}/edit`} className="text-sm font-medium text-navy-700 hover:underline">
        ← กลับไปแก้ไขข้อมูล
      </Link>

      <header className="mb-7 mt-4">
        <h1 className="text-[26px] font-semibold text-navy-800">ตรวจสอบเอกสารก่อนนำส่ง</h1>
        <p className="mt-1.5 text-[15px] leading-relaxed text-ink-muted">
          ระบบนำข้อมูลที่คุณกรอกไปเติมลงในข้อตกลง (A0) แล้ว กรุณาตรวจสอบความถูกต้องให้เรียบร้อย
          พร้อมอ่านผนวกแนบท้าย A1–A3 ซึ่งเป็นส่วนหนึ่งของข้อตกลงเดียวกัน
          เมื่อนำส่งแล้วจะแก้ไขไม่ได้จนกว่าผู้ตรวจสอบจะส่งกลับ
        </p>
      </header>

      <LegalDocumentsCard documents={documents} description={org.name} />

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={() => router.push(`/organizations/${id}/edit`)}>
          แก้ไขข้อมูล
        </Button>
        <Button onClick={submit} loading={submitting} disabled={!form}>
          นำส่งคำขอลงทะเบียนหน่วยงาน
        </Button>
      </div>
    </div>
  );
}
