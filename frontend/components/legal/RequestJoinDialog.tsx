"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { SigningDialog } from "@/components/organization/SigningDialog";
import { useToast } from "@/components/ui/Toast";
import { api } from "@/lib/api";
import type { LegalDocumentDetail } from "@/lib/legal-status";
import type { LegalDocument } from "@/lib/types";

/**
 * "ขอเข้าร่วม" เอกสาร optional — เปิดกล่องลงนามทันที (feedback 2026-11-22) ตารางสถานะเอกสารและหน้ารายละเอียดใช้ตัวเดียวกัน
 *
 * อ่าน ติ๊ก แล้วกด "อนุมัติ" = สร้างงานและลงนามในคราวเดียว (POST /api/legal-status/join) แล้วไปหน้างานนั้นที่ "รอ BDI อนุมัติ"
 * ปิดกล่องกลางทาง = ไม่มีอะไรถูกบันทึก สถานะยังเป็น "ยังไม่ได้เข้าร่วม" — เดิมกด "ส่งคำขอ" แล้วงานค้างอยู่แม้ไม่ได้ลงนาม
 */
export function RequestJoinDialog({
  target,
  approvalBase,
  onClose,
  onChanged,
}: {
  /** null = ปิด */
  target: { organizationId: string; documentId: string } | null;
  /** เช่น "/legal-documents/approvals" */
  approvalBase: string;
  onClose: () => void;
  /** สิ่งที่หน้าถืออยู่เก่าแล้ว (มีคนขอเข้าร่วมไปก่อน ฯลฯ) — ให้ผู้เรียกโหลดใหม่ */
  onChanged?: () => void;
}) {
  const router = useRouter();
  const { show } = useToast();
  const [document, setDocument] = useState<LegalDocument | null>(null);
  /** งานที่ POST /join สร้าง — submit ได้มา onSigned ใช้พาไปหน้างาน */
  const approvalId = useRef<string | null>(null);

  // เวอร์ชันล่าสุดที่จะอ่านและลงนาม — ถามตอนเปิด ไม่ใช้ของที่หน้าโหลดไว้ก่อน (อาจมีเวอร์ชันใหม่ระหว่างนั้น)
  useEffect(() => {
    setDocument(null);
    if (!target) return;
    let alive = true;
    api
      .get<LegalDocumentDetail>(`/api/legal-status/${target.organizationId}/${target.documentId}/detail`)
      .then((detail) => {
        if (!alive) return;
        if (!detail.joinDocument) {
          show({ tone: "info", title: "ขอเข้าร่วมเอกสารนี้ไม่ได้แล้ว", detail: "รายการมีการเปลี่ยนแปลง หน้าจะโหลดใหม่" });
          onClose();
          onChanged?.();
          return;
        }
        setDocument(detail.joinDocument);
      })
      .catch((err) => {
        if (!alive) return;
        show({ tone: "error", title: "เปิดเอกสารไม่สำเร็จ", detail: err instanceof Error ? err.message : undefined });
        onClose();
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.organizationId, target?.documentId]);

  if (!target || !document) return null;
  return (
    <SigningDialog
      open
      onClose={onClose}
      requestId={`${target.organizationId}:${target.documentId}`}
      documents={[document]}
      perDocument
      signLabel="อนุมัติ"
      submit={async (payload) => {
        const result = await api.post<{ approvalId: string }>("/api/legal-status/join", {
          documentId: target.documentId,
          ...payload,
        });
        approvalId.current = result.approvalId;
      }}
      onSigned={() => {
        show({ tone: "success", title: "ลงนามเรียบร้อย", detail: "ส่งให้ผู้มีอำนาจอนุมัติของ BDI อนุมัติแล้ว" });
        onClose();
        if (approvalId.current) router.push(`${approvalBase}/${approvalId.current}`);
        else onChanged?.();
      }}
      onStale={(message) => {
        show({ tone: "info", title: "รายการนี้ถูกดำเนินการไปแล้ว", detail: message });
        onClose();
        onChanged?.();
      }}
    />
  );
}
