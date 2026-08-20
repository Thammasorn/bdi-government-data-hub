"use client";

import { useState } from "react";

import { PdfViewer } from "@/components/organization/PdfViewer";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { api, ApiError } from "@/lib/api";
import type { LegalDocument } from "@/lib/types";

/**
 * ข้อความยืนยันของเส้นทางลงทะเบียนชุดข้อมูล — ตรงตามภาพในการ์ด Notion
 *
 * ต่างจากเส้นทางลงทะเบียนหน่วยงานที่ยืนยันว่า "ได้อ่านและเข้าใจข้อตกลง" เพราะที่นี่
 * สิ่งที่ยืนยันคือการ**ส่งแบบนำส่งข้อมูล** ไม่ใช่การเข้าเป็นคู่สัญญา
 *
 * ส่งขึ้นไปเก็บที่ signature_confirmation.confirmation_text ด้วย — หลักฐานต้องบอกได้ว่า
 * เขายืนยันข้อความอะไร ไม่ใช่แค่ว่ากดยืนยันแล้ว
 */
export const DATASET_CONFIRMATION_TEXT =
  "ยืนยันส่งแบบนำส่งข้อมูล ตามระเบียบสำนักนายกรัฐมนตรีว่าด้วยการแบ่งปันข้อมูลดิจิทัล พ.ศ. 2569";

/** คำยืนยันว่าอ่านเอกสารครบ — ติ๊กก่อนจึงกดยืนยันได้ (แบบเดียวกับเส้นทางหน่วยงาน) */
export const DATASET_ATTESTATION_TEXT = "ข้าพเจ้าได้อ่านเอกสารฉบับนี้ครบถ้วนแล้ว";

/**
 * ขั้นตอนยืนยันแบบนำส่งข้อมูลของผู้มีอำนาจกระทำการแทน และของผู้อนุมัติ BDI
 *
 * เส้นทางนี้มีเอกสารฉบับเดียว จึงไม่มีการเดินอ่านทีละฉบับเหมือนเส้นทางหน่วยงาน —
 * อ่านเอกสารในกล่องนี้ ติ๊กยืนยันว่าอ่านครบ แล้วกดยืนยัน
 */
export function DatasetSigningDialog({
  open,
  onClose,
  onSigned,
  onStale,
  requestId,
  documents,
  title,
  action,
}: {
  open: boolean;
  onClose: () => void;
  onSigned: () => void;
  onStale: (message: string) => void;
  requestId: string;
  documents: LegalDocument[];
  title: string;
  /** ค่าที่ backend รับ — ด่านผู้อนุมัติใช้ approve เหมือนกันทั้งสองฝ่าย */
  action: "approve";
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** เวลาที่ติ๊กยืนยันของแต่ละฉบับ (version id -> ISO) */
  const [attested, setAttested] = useState<Record<string, string>>({});

  const current = documents[0];
  const readAll = documents.every((d) => attested[d.versionId]);

  const close = () => {
    setAttested({});
    setError(null);
    onClose();
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/dataset-requests/${requestId}/review`, {
        action,
        signature: {
          acknowledgements: documents.map((d) => ({
            versionId: d.versionId,
            attestedAt: attested[d.versionId] ?? new Date().toISOString(),
          })),
          attestationText: DATASET_ATTESTATION_TEXT,
          confirmationText: DATASET_CONFIRMATION_TEXT,
        },
      });
      setAttested({});
      onSigned();
    } catch (err) {
      // คำขอถูกปิดด่านไปแล้วระหว่างที่หน้านี้เปิดอยู่ — ปิดกล่องแล้วให้หน้าโหลดสถานะจริง
      if (err instanceof ApiError && err.code === "stage_completed") {
        setAttested({});
        onStale(err.message);
        return;
      }
      setError(err instanceof Error ? err.message : "ยืนยันไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={close} size="lg" title={title}>
      <p className="text-center text-[17px] font-semibold leading-relaxed text-navy-800">
        {DATASET_CONFIRMATION_TEXT}
      </p>

      {current?.fileUrl ? (
        <div className="mt-5">
          <PdfViewer
            url={api.fileUrl(current.fileUrl)}
            filename={`${current.code} ${current.name}`}
            title={current.name}
          />
        </div>
      ) : (
        <p className="mt-5 rounded-xl bg-warning-bg p-5 text-sm text-warning">
          ยังไม่มีไฟล์ของแบบนำส่งข้อมูล กรุณาแจ้งผู้ดูแลระบบ
        </p>
      )}

      <div className="mt-5 rounded-xl bg-canvas p-4">
        {documents.map((doc) => (
          <label key={doc.versionId} className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={Boolean(attested[doc.versionId])}
              disabled={!doc.fileUrl}
              onChange={(e) =>
                setAttested((prev) => {
                  const next = { ...prev };
                  if (e.target.checked) next[doc.versionId] = new Date().toISOString();
                  else delete next[doc.versionId];
                  return next;
                })
              }
              className="mt-1 h-4 w-4 shrink-0 rounded border-line text-coral-500 focus:ring-2 focus:ring-navy-100"
            />
            <span className="text-[15px] leading-relaxed text-ink">
              {DATASET_ATTESTATION_TEXT}
              <span className="ml-1 text-coral-500">*</span>
            </span>
          </label>
        ))}
      </div>

      {error ? (
        <p className="mt-4 rounded-xl bg-danger-bg p-4 text-sm leading-relaxed text-danger">{error}</p>
      ) : null}

      <div className="mt-5 flex items-center justify-between gap-3">
        {/* บอกเหตุผลที่ปุ่มกดไม่ได้ ปุ่มที่จางอยู่เฉย ๆ อ่านเหมือนระบบพัง */}
        <p className="text-[13px] leading-relaxed text-ink-muted">
          {readAll ? "อ่านครบแล้ว — กดยืนยันเพื่อดำเนินการต่อ" : "ติ๊กยืนยันว่าอ่านเอกสารครบแล้วก่อน จึงจะกดยืนยันได้"}
        </p>
        <div className="flex shrink-0 gap-3">
          <Button variant="secondary" onClick={close}>
            ปิด
          </Button>
          <Button loading={busy} disabled={!readAll} onClick={submit}>
            ยืนยัน
          </Button>
        </div>
      </div>
    </Modal>
  );
}
