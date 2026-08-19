"use client";

import { useState } from "react";

import { PdfViewer } from "@/components/organization/PdfViewer";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { api } from "@/lib/api";
import type { LegalDocument } from "@/lib/types";

/**
 * ข้อความยืนยันที่ผู้ลงนามเห็นตอนกดลงนาม — ตรงตามภาพในการ์ด Notion ข้อ 3
 *
 * ส่งขึ้นไปเก็บที่ signature_confirmation.confirmation_text ด้วย เพราะหลักฐานการลงนาม
 * ต้องบอกได้ว่าเขายืนยัน**ข้อความอะไร** ถ้าเก็บแค่ "ลงนามแล้ว" แล้ววันหนึ่งข้อความนี้
 * ถูกแก้ หลักฐานเก่าจะเปลี่ยนความหมายตามไปด้วย
 */
export const CONFIRMATION_TEXT =
  "ข้าพเจ้าได้อ่านและเข้าใจข้อความรายละเอียดของข้อตกลงโดยละเอียดแล้ว จึงได้ลงลายมือชื่อด้วยวิธีการทางอิเล็กทรอนิกส์";

/**
 * ขั้นตอนลงนามของผู้มีอำนาจกระทำการแทน (การ์ดข้อ 3) และของผู้อนุมัติ BDI (ข้อ 4)
 *
 * ต่างกันที่ `perDocument`:
 *   true  — ขึ้นเอกสารทีละฉบับให้กด "เห็นชอบ" หรือ "ปิด" แล้วจบด้วยหน้าลงนาม
 *   false — BDI อ่านเอกสารทั้งชุดจากหน้าหลักแล้วลงนามทีเดียว การ์ดเขียนไว้ชัดว่า
 *           "ไม่ต้องมีขึ้น เห็นชอบ ทีละเอกสาร"
 *
 * กด "ปิด" กลับไปหน้าที่มีปุ่มส่งผลการตรวจสอบ ตามที่การ์ดกำหนด — และการเห็นชอบที่กดค้าง
 * ไว้จะถูกล้าง ไม่ใช่เก็บไว้ครึ่งทาง เพราะยังไม่มีการลงนามเกิดขึ้นเลย
 */
export function SigningDialog({
  open,
  onClose,
  onSigned,
  requestId,
  documents,
  perDocument,
  signLabel,
}: {
  open: boolean;
  onClose: () => void;
  onSigned: () => void;
  requestId: string;
  documents: LegalDocument[];
  perDocument: boolean;
  signLabel: string;
}) {
  /** จำนวนฉบับที่กดเห็นชอบไปแล้ว — เป็น index ของฉบับที่กำลังแสดงด้วย */
  const [acknowledged, setAcknowledged] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setAcknowledged(0);
    setError(null);
  };

  const close = () => {
    reset();
    onClose();
  };

  const sign = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/organizations/${requestId}/review`, {
        action: "approve",
        signature: {
          acknowledgedVersionIds: documents.map((d) => d.versionId),
          confirmationText: CONFIRMATION_TEXT,
        },
      });
      reset();
      onSigned();
    } catch (err) {
      setError(err instanceof Error ? err.message : "ลงนามไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };

  const reviewing = perDocument && acknowledged < documents.length;
  const current = reviewing ? documents[acknowledged]! : null;

  if (current) {
    return (
      <Modal
        open={open}
        onClose={close}
        size="lg"
        title={`${current.code} · ${current.name}`}
        description={`เอกสารฉบับที่ ${acknowledged + 1} จาก ${documents.length} — โปรดอ่านให้ครบก่อนกดเห็นชอบ`}
      >
        {current.fileUrl ? (
          <PdfViewer
            url={api.fileUrl(current.fileUrl)}
            filename={`${current.code} ${current.name}`}
            title={current.name}
          />
        ) : (
          <p className="rounded-xl bg-warning-bg p-5 text-sm text-warning">
            ยังไม่มีไฟล์ของเอกสารฉบับนี้ กรุณาแจ้งผู้ดูแลระบบ
          </p>
        )}
        <div className="mt-6 flex justify-between gap-3">
          <Button variant="secondary" onClick={close}>
            ปิด
          </Button>
          <Button disabled={!current.fileUrl} onClick={() => setAcknowledged(acknowledged + 1)}>
            เห็นชอบ
          </Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open={open} onClose={close} title={signLabel} description={undefined}>
      <p className="text-center text-[17px] font-semibold leading-relaxed text-navy-800">
        {CONFIRMATION_TEXT}
      </p>
      <p className="mt-4 text-[13px] leading-relaxed text-ink-muted">
        ระบบจะบันทึกชื่อ เวลา และเอกสารทุกฉบับที่คุณเห็นชอบไว้เป็นหลักฐาน
        และประทับลายมือชื่อของคุณลงในเอกสาร {documents.map((d) => d.code).join(" · ")}
      </p>
      {error ? (
        <p className="mt-4 rounded-xl bg-danger-bg p-4 text-sm leading-relaxed text-danger">{error}</p>
      ) : null}
      <div className="mt-6 flex justify-between gap-3">
        <Button variant="secondary" onClick={close}>
          ปิด
        </Button>
        <Button loading={busy} onClick={sign}>
          ลงนาม
        </Button>
      </div>
    </Modal>
  );
}
