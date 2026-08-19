"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { PdfViewer } from "@/components/organization/PdfViewer";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { Spinner } from "@/components/ui/Spinner";
import { useToast } from "@/components/ui/Toast";
import { api, ApiError } from "@/lib/api";
import { useRequireAuth } from "@/lib/require-auth";
import { DATASET_ATTACHMENT_LABELS, datasetTitle, type DatasetRequest } from "@/lib/types";

export default function DatasetPreviewPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { show } = useToast();

  const { ready } = useRequireAuth();
  const [request, setRequest] = useState<DatasetRequest | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    // ยังไม่ล็อกอิน = API ตอบได้แค่ 401 และหน้านี้จะหมุนค้างตลอดกาล
    // useRequireAuth พาไป /login?next=<หน้านี้> ให้แล้ว
    if (!ready) return;
    api
      .get<{ request: DatasetRequest }>(`/api/dataset-requests/${id}`)
      .then((d) => setRequest(d.request))
      .catch(() => show({ tone: "error", title: "โหลดข้อมูลไม่สำเร็จ" }));
  }, [id, show, ready]);

  if (!request) return <Spinner />;

  const form = request.attachments.find((a) => a.kind === "GENERATED_FORM");
  const supporting = request.attachments.filter((a) => a.kind !== "GENERATED_FORM");

  const submit = async () => {
    setSubmitting(true);
    try {
      await api.post(`/api/dataset-requests/${id}/submit`);
      show({
        tone: "success",
        title: "นำส่งคำขอเรียบร้อย",
        detail: "ระบบแจ้งเจ้าหน้าที่ BDI ให้เข้ามาตรวจสอบแล้ว",
      });
      router.push(`/datasets/${id}`);
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
      <Link
        href={`/datasets/${id}/edit`}
        className="text-sm font-medium text-navy-700 hover:underline"
      >
        ← กลับไปแก้ไขข้อมูล
      </Link>

      <header className="mb-7 mt-4">
        <p className="text-[13px] font-semibold uppercase tracking-wide text-coral-500">
          {request.requestNumber}
        </p>
        <h1 className="mt-1 text-[26px] font-semibold text-navy-800">ตรวจสอบคำขอก่อนนำส่ง</h1>
        <p className="mt-1.5 text-[15px] leading-relaxed text-ink-muted">
          ระบบสร้างแบบฟอร์มจากข้อมูลที่คุณกรอก กรุณาตรวจสอบทั้งแบบฟอร์มและเอกสารแนบให้เรียบร้อย
          เมื่อนำส่งแล้วจะแก้ไขไม่ได้จนกว่าผู้ตรวจสอบจะส่งกลับ
        </p>
      </header>

      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader title="แบบฟอร์มลงทะเบียนชุดข้อมูล" description={datasetTitle(request)} />
          <div className="p-6">
            {form ? (
              <PdfViewer
                url={api.fileUrl(`/api/dataset-requests/${request.id}/attachments/${form.id}`)}
                filename={form.filename}
                title="แบบฟอร์มลงทะเบียนชุดข้อมูล"
              />
            ) : (
              <p className="rounded-xl bg-warning-bg p-5 text-sm text-warning">
                ยังไม่มีแบบฟอร์ม กรุณากลับไปกด &ldquo;ตรวจสอบและสร้าง PDF&rdquo; อีกครั้ง
              </p>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="เอกสารแนบ" description="ตรวจว่าไฟล์ที่แนบเป็นฉบับล่าสุด" />
          {supporting.length === 0 ? (
            <p className="px-6 py-5 text-sm text-ink-muted">ยังไม่มีเอกสารแนบ</p>
          ) : (
            <ul className="divide-y divide-line">
              {supporting.map((a) => (
                <li key={a.id} className="flex items-center gap-3 px-6 py-3.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-ink">{DATASET_ATTACHMENT_LABELS[a.kind]}</p>
                    <p className="truncate text-[13px] text-ink-muted">{a.filename}</p>
                  </div>
                  <a
                    href={api.fileUrl(`/api/dataset-requests/${request.id}/attachments/${a.id}`)}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 rounded-full border border-line px-3.5 py-1.5 text-[13px] font-medium text-navy-700 transition-colors hover:bg-navy-50"
                  >
                    เปิดดู
                  </a>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={() => router.push(`/datasets/${id}/edit`)}>
          แก้ไขข้อมูล
        </Button>
        <Button onClick={submit} loading={submitting} disabled={!form}>
          นำส่งคำขอ
        </Button>
      </div>
    </div>
  );
}
