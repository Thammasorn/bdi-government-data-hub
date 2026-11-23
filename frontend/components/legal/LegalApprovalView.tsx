"use client";

import clsx from "clsx";
import { useCallback, useEffect, useState } from "react";

import { LegalHistoryDialog } from "@/components/legal/LegalHistoryDialog";
import { LegalDocumentsCard } from "@/components/organization/LegalDocuments";
import { SigningDialog, type SigningPayload } from "@/components/organization/SigningDialog";
import { ApprovalSteps } from "@/components/review/ApprovalSteps";
import { Breadcrumb, type Crumb } from "@/components/ui/Breadcrumb";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { Spinner } from "@/components/ui/Spinner";
import { useToast } from "@/components/ui/Toast";
import { api, ApiError } from "@/lib/api";
import { documentLabel } from "@/lib/legal-document";
import { APPROVAL_STATUS_META, thaiDate, type LegalApprovalDetail } from "@/lib/legal-status";
import { useSession } from "@/components/SessionProvider";

/**
 * งานลงนามเอกสารกฎหมายเวอร์ชันใหม่หนึ่งงาน — โครงเดียวกับหน้ารายละเอียดคำขอลงทะเบียน:
 * การ์ด "รอการพิจารณาของคุณ" · การ์ดเอกสารที่เกี่ยวข้อง · ขั้นตอนการอนุมัติ และกล่องลงนามตัวเดียวกัน (`SigningDialog`)
 *
 * ผู้มีอำนาจอนุมัติของหน่วยงานอ่านและติ๊กรายฉบับ (`perDocument`) · ผู้มีอำนาจอนุมัติของ BDI อ่านแล้วกดอนุมัติ (ไม่มีส่งกลับ ไม่มีไม่อนุมัติ)
 */
export function LegalApprovalView({
  approvalId,
  crumbs,
  base,
}: {
  approvalId: string;
  crumbs: Crumb[];
  /** หน้ารายการที่หน้านี้อยู่ใต้ — "/legal-documents" หรือ "/console/legal-status" (ลิงก์ในประวัติ) */
  base: string;
}) {
  const { show } = useToast();
  const { refresh } = useSession();
  const [detail, setDetail] = useState<LegalApprovalDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const [round, setRound] = useState(0);
  const [historyOpen, setHistoryOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      setDetail(await api.get<LegalApprovalDetail>(`/api/legal-status/approvals/${approvalId}`));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "โหลดข้อมูลไม่สำเร็จ");
    }
  }, [approvalId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error && !detail) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <Breadcrumb items={crumbs} />
        <p className="mt-6 rounded-xl bg-danger-bg p-5 text-sm text-danger">{error}</p>
      </div>
    );
  }
  if (!detail) return <Spinner />;

  const { approval, document } = detail;
  const meta = APPROVAL_STATUS_META[approval.status];
  const actor = detail.canSign ? "organization" : detail.canApprove ? "bdi" : null;
  const settled = approval.status === "ACTIVE" || approval.status === "SUPERSEDED";
  const pending = approval.status === "PENDING_ORG_APPROVAL" || approval.status === "PENDING_BDI_APPROVAL";

  const submit = async (signature: SigningPayload) => {
    await api.post(`/api/legal-status/approvals/${approval.id}/${actor === "bdi" ? "approve" : "sign"}`, signature);
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <Breadcrumb items={[...crumbs, { label: documentLabel(document) }]} />

      <header className="mb-7 mt-4 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="break-words text-[26px] font-semibold text-navy-800">{documentLabel(document)}</h1>
          <p className="mt-1 text-sm text-ink-muted">{approval.organizationName}</p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span
            className={clsx(
              "inline-flex items-start gap-1.5 rounded-2xl px-3 py-1 text-[13px] font-medium leading-snug",
              meta.className,
            )}
          >
            <span className="mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-70" aria-hidden="true" />
            <span>{meta.label}</span>
          </span>
          {/* ประวัติการลงนามของหน่วยงานกับเอกสารนี้ — popup เดียวกับปุ่ม "ประวัติ" ในตาราง (feedback 2026-11-22) */}
          <Button size="sm" variant="secondary" onClick={() => setHistoryOpen(true)}>
            ดูประวัติ
          </Button>
        </div>
      </header>

      {actor ? (
        <Card className="mb-6 border-l-[3px] border-l-coral-500">
          <div className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium text-navy-800">รอการพิจารณาของคุณ</p>
              <p className="mt-0.5 text-sm text-ink-muted">
                {actor === "organization"
                  ? approval.optionalRequest
                    ? "อ่านเอกสารให้ครบแล้วอนุมัติ เพื่อให้หน่วยงานเข้าร่วมเอกสารฉบับนี้"
                    : "BDI เผยแพร่เอกสารเวอร์ชันใหม่ อ่านให้ครบแล้วอนุมัติ หน่วยงานจะทำรายการชุดข้อมูลได้อีกครั้งเมื่อ BDI อนุมัติแล้ว"
                  : "หน่วยงานลงนามเอกสารเวอร์ชันนี้แล้ว ตรวจเอกสารแล้วอนุมัติ"}
              </p>
            </div>
            <Button className="shrink-0" onClick={() => setSigning(true)}>
              อนุมัติ
            </Button>
          </div>
        </Card>
      ) : null}

      <div className="flex flex-col gap-6">
        <LegalDocumentsCard
          documents={[document]}
          reloadKey={round}
          sections={[
            {
              key: "current",
              // งานที่จบแล้ว เวอร์ชันใหม่กลายเป็นของปัจจุบัน — ส่วนนี้จึงเป็นเวอร์ชันที่ถูกแทนที่
              title: settled ? "เอกสารเวอร์ชันก่อนหน้า" : "เอกสารเวอร์ชันปัจจุบัน",
              // ศัพท์ทางกฎหมาย: ฉบับเดิมไม่มีผลบังคับแล้วเมื่อ BDI เผยแพร่ฉบับใหม่ — ใช้คำเดียวทั้งระหว่างรอและหลังอนุมัติ (BDI ขอ 2026-11-20)
              badge: detail.current ? { label: "สิ้นผลใช้บังคับ", className: "bg-navy-50 text-ink-muted" } : undefined,
              document: detail.current
                ? { ...document, versionId: detail.current.versionId, fileUrl: detail.current.fileUrl }
                : null,
              emptyText: "หน่วยงานยังไม่ได้เข้าร่วมเอกสารนี้",
              facts: detail.current
                ? [
                    { label: "เวอร์ชัน", value: detail.current.versionDisplay },
                    { label: "วันที่มีผล", value: thaiDate(detail.current.effectiveAt) },
                    { label: "วันที่อนุมัติ", value: thaiDate(detail.current.approvedAt) },
                  ]
                : [],
            },
            {
              key: "new",
              title: "เอกสารใหม่",
              // ป้ายเดียวกับคอลัมน์สถานะในหน้ารายการ — รอใคร หรือมีผลแล้ว
              badge: meta,
              highlight: pending,
              note: actor
                ? actor === "organization"
                  ? "ฉบับนี้ต้องดำเนินการ — เปิดอ่านให้ครบแล้วกด \"อนุมัติ\" ด้านบน"
                  : "ฉบับนี้ต้องดำเนินการ — ตรวจเอกสารแล้วกด \"อนุมัติ\" ด้านบน"
                : undefined,
              document,
              facts: [
                { label: "เวอร์ชัน", value: approval.versionDisplay },
                { label: "วันที่มีผล", value: thaiDate(approval.effectiveAt) },
                { label: "วันที่อนุมัติ", value: approval.activatedAt
                    ? thaiDate(approval.activatedAt)
                    : approval.status === "CANCELLED"
                      ? "ยกเลิกแล้ว"
                      : "รออนุมัติ",
                },
              ],
            },
          ]}
        />
        <Card>
          <CardHeader title="ขั้นตอนการอนุมัติ" />
          <ApprovalSteps progress={detail.progress} />
        </Card>
      </div>

      <LegalHistoryDialog
        target={
          historyOpen
            ? {
                organizationId: approval.organizationId,
                documentId: approval.legalDocumentId,
                documentLabel: documentLabel(document),
                organizationName: approval.organizationName,
              }
            : null
        }
        base={base}
        onClose={() => setHistoryOpen(false)}
      />

      {actor ? (
        <SigningDialog
          open={signing}
          onClose={() => setSigning(false)}
          onSigned={() => {
            setSigning(false);
            show({
              tone: "success",
              title: actor === "bdi" ? "อนุมัติเรียบร้อย" : "ลงนามเรียบร้อย",
              detail: "ระบบบันทึกการอนุมัติและแจ้งผู้เกี่ยวข้องแล้ว",
            });
            setRound((r) => r + 1);
            void load();
            // ปลดล็อกหน่วยงานแล้วเมนูและกล่องแจ้งต้องเปลี่ยนตาม
            void refresh();
          }}
          onStale={(message) => {
            setSigning(false);
            show({ tone: "info", title: "รายการนี้ถูกดำเนินการไปแล้ว", detail: message });
            void load();
          }}
          requestId={approval.id}
          documents={[document]}
          perDocument={actor === "organization"}
          signLabel="อนุมัติ"
          submit={async (payload) => {
            try {
              await submit(payload);
            } catch (err) {
              if (err instanceof ApiError && err.code === "stale_documents") {
                setRound((r) => r + 1);
              }
              throw err;
            }
          }}
        />
      ) : null}
    </div>
  );
}
