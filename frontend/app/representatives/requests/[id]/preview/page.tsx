"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { ChangeRequestSections } from "@/components/representatives/RequestSections";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { useToast } from "@/components/ui/Toast";
import { api, ApiError } from "@/lib/api";
import type { ChangeDetail } from "@/lib/representatives";
import { useRequireAuth } from "@/lib/require-auth";

/** หน้าตรวจสอบก่อนนำส่ง — ขั้นตอนเดียวกับ `/organizations/[id]/preview` */
export default function ChangeRequestPreviewPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { show } = useToast();
  const { user, loading } = useRequireAuth();
  const [request, setRequest] = useState<ChangeDetail | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (loading || !user) return;
    api
      .get<{ request: ChangeDetail }>(`/api/representative-changes/${id}`)
      .then(({ request: loaded }) => {
        // ปุ่มนำส่งอยู่หน้านี้ — คำขอที่นำส่งแล้วหรือคนที่แก้ไม่ได้ไปดูหน้ารายละเอียดแทน
        if (!loaded.canEdit) {
          router.replace(`/representatives/requests/${id}`);
          return;
        }
        setRequest(loaded);
      })
      .catch(() => show({ tone: "error", title: "โหลดข้อมูลไม่สำเร็จ" }));
  }, [id, user, loading, router, show]);

  if (!request) return <Spinner />;

  const editHref = `/representatives/requests/${id}/edit`;

  const submit = async () => {
    setSubmitting(true);
    try {
      await api.post(`/api/representative-changes/${id}/submit`, {});
      show({ tone: "success", title: "นำส่งคำขอเรียบร้อย", detail: "ระบบแจ้งผู้ประสานงานของ BDI ให้เข้ามาตรวจสอบแล้ว" });
      router.push(`/representatives/requests/${id}`);
    } catch (err) {
      const fields = err instanceof ApiError ? Object.values(err.fields) : [];
      show({
        tone: "error",
        title: "นำส่งไม่สำเร็จ",
        detail: fields[0] ?? (err instanceof ApiError ? err.message : undefined),
      });
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <Breadcrumb
        items={[
          { label: "ผู้แทนหน่วยงาน", href: "/representatives" },
          { label: "ฟอร์มเปลี่ยนแปลงผู้แทนหน่วยงาน", href: "/representatives/requests" },
          { label: request.requestNumber, href: editHref },
          { label: "ตรวจสอบก่อนนำส่ง" },
        ]}
      />

      <header className="mb-7 mt-4">
        <h1 className="text-[26px] font-semibold text-navy-800">ตรวจสอบข้อมูลก่อนนำส่ง</h1>
        <p className="mt-1.5 text-[15px] leading-relaxed text-ink-muted">
          ตรวจสอบรายชื่อและเอกสารแนบให้ถูกต้อง เมื่อนำส่งแล้วจะแก้ไขไม่ได้ เว้นแต่ BDI ส่งกลับให้แก้ไข
        </p>
      </header>

      <div className="flex flex-col gap-6">
        <ChangeRequestSections request={request} />
      </div>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={() => router.push(editHref)}>
          แก้ไขข้อมูล
        </Button>
        <Button onClick={submit} loading={submitting}>
          นำส่งคำขอเปลี่ยนแปลงผู้แทนหน่วยงาน
        </Button>
      </div>
    </div>
  );
}
