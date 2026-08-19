"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { LegalDocumentsCard, useLegalDocuments } from "@/components/organization/LegalDocuments";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { useToast } from "@/components/ui/Toast";
import { api, ApiError } from "@/lib/api";
import { useRequireAuth } from "@/lib/require-auth";
import type { Organization } from "@/lib/types";

/**
 * สถานะที่ยังแก้ฟอร์มได้ — ตรงกับที่ backend ยอมรับใน PATCH /:id และ POST /:id/submit
 *
 * เมื่อนำส่งไปแล้วหน้านี้ต้องไม่เปิดให้แก้อีก เดิมไม่ได้ดูสถานะเลย ผู้ใช้ที่กด back
 * หรือเปิดลิงก์เดิมค้างไว้จึงกลับเข้ามาแก้ได้ เห็นปุ่มบันทึก แล้วกดไปเจอ error ว่า
 * "คำขอนี้นำส่งไปแล้ว" — เสียเวลากรอกไปเปล่า ๆ แล้วยังดูเหมือนระบบพัง
 * หน้ารายละเอียดเป็นฉบับอ่านอย่างเดียวที่มีทั้งข้อมูลและเอกสารข้อตกลงครบอยู่แล้ว
 * จึงพาไปที่นั่นแทนการทำฟอร์มอ่านอย่างเดียวขึ้นมาอีกชุด
 */
const EDITABLE_STATUSES = new Set(["DRAFT", "RETURNED"]);

export default function PreviewPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { show } = useToast();

  const { ready } = useRequireAuth();
  const [org, setOrg] = useState<Organization | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // ผูกกับ id ของคำขอที่โหลดมาแล้ว ไม่ใช่พารามิเตอร์บน URL (รับได้ทั้งสอง id)
  const { documents, error: documentsError, reload: reloadDocuments } = useLegalDocuments(org?.id ?? null);

  useEffect(() => {
    // ยังไม่ล็อกอิน = API ตอบได้แค่ 401 และหน้านี้จะหมุนค้างตลอดกาล
    // useRequireAuth พาไป /login?next=<หน้านี้> ให้แล้ว
    if (!ready) return;
    api
      .get<{ organization: Organization }>(`/api/organizations/${id}`)
      .then((d) => {
        // ปุ่มนำส่งอยู่หน้านี้ — คำขอที่นำส่งแล้วต้องไม่มีทางกดซ้ำได้
        if (!EDITABLE_STATUSES.has(d.organization.status)) {
          show({
            tone: "info",
            title: "คำขอนี้นำส่งแล้ว",
            detail: "เปิดหน้ารายละเอียดเพื่อดูสถานะและเอกสารข้อตกลง",
          });
          router.replace(`/organizations/${d.organization.id}`);
          return;
        }
        setOrg(d.organization);
      })
      .catch(() => show({ tone: "error", title: "โหลดข้อมูลไม่สำเร็จ" }));
  }, [id, show, ready, router]);

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

      <LegalDocumentsCard
        documents={documents}
        description={org.name}
        error={documentsError}
        onRetry={reloadDocuments}
      />

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
