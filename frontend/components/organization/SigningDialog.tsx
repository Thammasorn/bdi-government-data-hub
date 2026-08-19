"use client";

import { useState } from "react";

import { PdfViewer } from "@/components/organization/PdfViewer";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { api, ApiError } from "@/lib/api";
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
 * คำยืนยันรายฉบับ — ติ๊กก่อนจึงกด "เห็นชอบ" ได้
 *
 * เลือกวิธีนี้แทนการวัดว่าเลื่อนอ่านถึงท้ายเอกสารหรือยัง เพราะการวัดต้องเลิกใช้ตัวอ่าน PDF
 * ของเบราว์เซอร์แล้วมาวาดเอกสารเองด้วย pdf.js (หน้าเว็บอ่านตำแหน่งการเลื่อนใน iframe
 * ข้าม origin ไม่ได้) ซึ่งลองแล้วมันวาดหน้าเปล่าออกมาโดยไม่แจ้งอะไรเลย — ประตูที่บอกว่า
 * "เลื่อนถึงท้ายแล้ว" บนตัวอ่านที่อาจโชว์หน้าเปล่าเงียบ ๆ แย่กว่าไม่มีประตู เพราะมันสร้าง
 * หลักฐานว่าอ่านแล้วขึ้นมาเอง ส่วนการติ๊กเป็นการกระทำที่ผู้ลงนามตั้งใจทำ และเก็บเป็น
 * หลักฐานได้ตรง ๆ ใน legal_acceptance (acceptance_method = CHECKBOX)
 *
 * ข้อความนี้ถูกส่งขึ้นไปเก็บด้วย ไม่ได้เก็บแค่ว่า "ติ๊กแล้ว"
 */
export const ATTESTATION_TEXT = "ข้าพเจ้าได้อ่านเอกสารฉบับนี้ครบถ้วนแล้ว";

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
  onStale,
  requestId,
  documents,
  perDocument,
  signLabel,
}: {
  open: boolean;
  onClose: () => void;
  onSigned: () => void;
  /** คำขอเดินผ่านด่านนี้ไปแล้ว — หน้าจอที่ถืออยู่เป็นข้อมูลเก่า ต้องโหลดใหม่ */
  onStale: (message: string) => void;
  requestId: string;
  documents: LegalDocument[];
  perDocument: boolean;
  signLabel: string;
}) {
  /** จำนวนฉบับที่กดเห็นชอบไปแล้ว — เป็น index ของฉบับที่กำลังแสดงด้วย */
  const [acknowledged, setAcknowledged] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * เวลาที่ติ๊กยืนยันของแต่ละฉบับ (version id -> ISO)
   *
   * เก็บเป็นแผนที่ต่อฉบับ ไม่ใช่ boolean ของฉบับปัจจุบัน เพื่อให้ย้อนกลับไปดูฉบับก่อน
   * แล้วไม่ต้องติ๊กใหม่ และเพื่อส่งเวลาที่ติ๊กจริงของแต่ละฉบับขึ้นไปเป็นหลักฐาน
   */
  const [attested, setAttested] = useState<Record<string, string>>({});

  const reset = () => {
    setAcknowledged(0);
    setError(null);
    setAttested({});
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
          acknowledgements: documents.map((d) => ({
            versionId: d.versionId,
            // ฝ่าย BDI ไม่มีการติ๊กรายฉบับ จึงใช้เวลาที่กดลงนามเป็นเวลายอมรับ
            attestedAt: attested[d.versionId] ?? new Date().toISOString(),
          })),
          ...(perDocument ? { attestationText: ATTESTATION_TEXT } : {}),
          confirmationText: CONFIRMATION_TEXT,
        },
      });
      reset();
      onSigned();
    } catch (err) {
      // คำขอถูกปิดด่านไปแล้วระหว่างที่หน้านี้เปิดอยู่ — ปิดกล่องแล้วให้หน้าโหลดสถานะจริง
      // ค้างกล่องไว้กับข้อความ error จะทำให้เขากดลงนามซ้ำไปเรื่อย ๆ กับด่านที่ปิดแล้ว
      if (err instanceof ApiError && err.code === "stage_completed") {
        reset();
        onStale(err.message);
        return;
      }
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
        <div className="mt-5 rounded-xl bg-canvas p-4">
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={Boolean(attested[current.versionId])}
              disabled={!current.fileUrl}
              onChange={(e) =>
                setAttested((prev) => {
                  const next = { ...prev };
                  if (e.target.checked) next[current.versionId] = new Date().toISOString();
                  else delete next[current.versionId];
                  return next;
                })
              }
              className="mt-1 h-4 w-4 shrink-0 rounded border-line text-coral-500 focus:ring-2 focus:ring-navy-100"
            />
            <span className="text-[15px] leading-relaxed text-ink">
              {ATTESTATION_TEXT}
              <span className="ml-1 text-coral-500">*</span>
            </span>
          </label>
        </div>
        <div className="mt-5 flex justify-between gap-3">
          <Button variant="secondary" onClick={close}>
            ปิด
          </Button>
          <Button
            disabled={!current.fileUrl || !attested[current.versionId]}
            onClick={() => setAcknowledged(acknowledged + 1)}
          >
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
