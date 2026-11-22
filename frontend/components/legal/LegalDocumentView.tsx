"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { LegalHistoryDialog } from "@/components/legal/LegalHistoryDialog";
import { RequestJoinDialog } from "@/components/legal/RequestJoinDialog";
import { LegalDocumentsCard } from "@/components/organization/LegalDocuments";
import { Breadcrumb, type Crumb } from "@/components/ui/Breadcrumb";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Spinner } from "@/components/ui/Spinner";
import { api } from "@/lib/api";
import { documentLabel } from "@/lib/legal-document";
import { APPROVAL_STATUS_META, NOT_JOINED_META, thaiDate, type LegalDocumentDetail } from "@/lib/legal-status";
import type { LegalDocument } from "@/lib/types";

/**
 * "ดูรายละเอียด" ของเอกสารที่ไม่มีงานค้าง และของประวัติที่ลงนามตอนลงทะเบียน (feedback 2026-11-22)
 *
 * การ์ด "เอกสารที่เกี่ยวข้อง" ตัวเดียวกับหน้างานลงนาม — เวอร์ชันที่ลงนาม วันที่ ผู้อนุมัติทั้งสองฝ่าย และปุ่ม "ดูเอกสาร"
 * มีงานลงนามเวอร์ชันใหม่ค้างอยู่ = กล่องบอกพร้อมปุ่มไปหน้างานนั้น · ยังไม่ได้เข้าร่วม = บอกว่ายังไม่ได้เข้าร่วม ไม่มีไฟล์ให้เปิด
 */
export function LegalDocumentView({
  organizationId,
  documentId,
  versionId,
  base,
  crumbs,
}: {
  organizationId: string;
  documentId: string;
  /** null = เวอร์ชันที่ใช้อยู่ */
  versionId: string | null;
  /** หน้ารายการที่หน้านี้อยู่ใต้ — "/legal-documents" หรือ "/console/legal-status" */
  base: string;
  crumbs: Crumb[];
}) {
  const router = useRouter();
  const [detail, setDetail] = useState<LegalDocumentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [round, setRound] = useState(0);

  useEffect(() => {
    const query = versionId ? `?versionId=${versionId}` : "";
    api
      .get<LegalDocumentDetail>(`/api/legal-status/${organizationId}/${documentId}/detail${query}`)
      .then((d) => {
        setDetail(d);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "โหลดข้อมูลไม่สำเร็จ"));
  }, [organizationId, documentId, versionId, round]);

  if (error && !detail) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <Breadcrumb items={crumbs} />
        <p className="mt-6 rounded-xl bg-danger-bg p-5 text-sm text-danger">{error}</p>
      </div>
    );
  }
  if (!detail) return <Spinner />;

  const { signed, pending } = detail;
  const label = documentLabel(detail.document as LegalDocument);
  // ป้ายเดียวกับตาราง: ใช้อยู่และไม่มีงานค้าง = เปิดใช้งาน · ถูกแทนที่หรือมีเวอร์ชันใหม่รอ = สิ้นผลใช้บังคับ (คำเดียวกับหน้างานลงนาม)
  const badge = !signed
    ? NOT_JOINED_META
    : signed.isCurrent && !pending
      ? APPROVAL_STATUS_META.ACTIVE
      : { label: "สิ้นผลใช้บังคับ", className: "bg-navy-50 text-ink-muted" };

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <Breadcrumb items={[...crumbs, { label }]} />

      <header className="mb-7 mt-4 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="break-words text-[26px] font-semibold text-navy-800">{label}</h1>
          <p className="mt-1 text-sm text-ink-muted">{detail.organizationName}</p>
        </div>
        {/* ประวัติการลงนาม — popup เดียวกับปุ่ม "ประวัติ" ในตาราง · ยังไม่เคยลงนามและไม่มีงานค้างก็ไม่มีอะไรให้ดู (feedback 2026-11-22) */}
        {signed || pending ? (
          <Button size="sm" variant="secondary" className="shrink-0" onClick={() => setHistoryOpen(true)}>
            ดูประวัติ
          </Button>
        ) : null}
      </header>

      <LegalHistoryDialog
        target={
          historyOpen
            ? {
                organizationId: detail.organizationId,
                documentId: detail.documentId,
                documentLabel: label,
                organizationName: detail.organizationName,
              }
            : null
        }
        base={base}
        onClose={() => setHistoryOpen(false)}
      />

      {pending ? (
        <Card className="mb-6 border-l-[3px] border-l-coral-500">
          <div className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium text-navy-800">มีเอกสารเวอร์ชันใหม่ {pending.versionDisplay}</p>
              <p className="mt-0.5 text-sm text-ink-muted">{APPROVAL_STATUS_META[pending.status].label}</p>
            </div>
            <Button className="shrink-0" variant="secondary" onClick={() => router.push(`${base}/approvals/${pending.approvalId}`)}>
              ดูรายละเอียด
            </Button>
          </div>
        </Card>
      ) : null}

      {/* เอกสาร optional ที่หน่วยงานยังไม่ได้เข้าร่วม — ผู้มีอำนาจอนุมัติขอเข้าร่วมจากหน้านี้ได้ เหมือนปุ่มในตาราง (feedback 2026-11-22) */}
      {detail.canRequest ? (
        <Card className="mb-6 border-l-[3px] border-l-coral-500">
          <div className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium text-navy-800">ขอเข้าร่วมเอกสารนี้</p>
              <p className="mt-0.5 text-sm text-ink-muted">
                หน่วยงานไม่ได้เข้าร่วมเอกสารฉบับนี้ตอนลงทะเบียน กด "ขอเข้าร่วม" เพื่ออ่านและอนุมัติเอกสารเวอร์ชันล่าสุด
              </p>
            </div>
            <Button className="shrink-0" onClick={() => setJoining(true)}>
              ขอเข้าร่วม
            </Button>
          </div>
        </Card>
      ) : null}

      <RequestJoinDialog
        target={joining ? { organizationId: detail.organizationId, documentId: detail.documentId } : null}
        approvalBase={`${base}/approvals`}
        onClose={() => setJoining(false)}
        onChanged={() => setRound((r) => r + 1)}
      />

      <LegalDocumentsCard
        documents={null}
        sections={[
          {
            key: "signed",
            title: !signed || signed.isCurrent ? "เอกสารเวอร์ชันปัจจุบัน" : "เอกสารเวอร์ชันก่อนหน้า",
            badge,
            document: signed ? (detail.document as LegalDocument) : null,
            emptyText: "หน่วยงานยังไม่ได้เข้าร่วมเอกสารนี้",
            facts: signed
              ? [
                  { label: "เวอร์ชัน", value: signed.versionDisplay },
                  { label: "วันที่มีผล", value: thaiDate(signed.effectiveAt) },
                  { label: "วันที่อนุมัติ", value: thaiDate(signed.bdiApprovedAt) },
                  { label: "ผู้มีอำนาจอนุมัติของหน่วยงาน", value: signed.orgApproverName ?? "—" },
                  { label: "ผู้มีอำนาจอนุมัติของ BDI", value: signed.bdiApproverName ?? "—" },
                  {
                    label: "ลงนามผ่าน",
                    value: signed.registration ? `คำขอลงทะเบียน ${signed.registration.requestNumber}` : "การลงนามเอกสารเวอร์ชันใหม่",
                  },
                ]
              : [],
          },
        ]}
      />
    </div>
  );
}
