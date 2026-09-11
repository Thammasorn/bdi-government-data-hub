"use client";

import { useState, type ReactNode } from "react";

import { PdfViewer } from "@/components/organization/PdfViewer";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { api } from "@/lib/api";
import { documentLabel } from "@/lib/legal-document";
import type { LegalDocument } from "@/lib/types";

/**
 * ติ๊กว่าอ่านฉบับนี้แล้ว — ถ้อยคำเดียวกับที่กล่องลงนามใช้ แต่คนละความหมาย
 *
 * ของกล่องลงนาม (`ATTESTATION_TEXT` ใน SigningDialog) ถูกส่งขึ้นไปเก็บเป็นหลักฐานใน
 * `legal_acceptance` — มันคือ **การยอมรับเอกสาร** ของฝั่งหน่วยงาน ส่วนอันนี้เป็นประตู
 * บนหน้าจออย่างเดียว ไม่มี endpoint ไหนรับค่านี้ไปเก็บ จึงตั้งเป็นค่าคงที่ของตัวเอง
 * ไม่ได้ import ข้ามมา: ถ้าวันหนึ่งถ้อยคำของหลักฐานต้องเปลี่ยนตามที่ฝ่ายกฎหมายสั่ง
 * มันต้องเปลี่ยนได้โดยไม่ลากประตูบนหน้าจอของอีกสี่ที่ไปด้วย
 */
export const READ_ATTESTATION_TEXT = "ข้าพเจ้าได้อ่านเอกสารฉบับนี้ครบถ้วนแล้ว";

/**
 * อ่านเอกสารทีละฉบับก่อนตัดสินใจ — รูปแบบเดียวกับกล่องของผู้มีอำนาจอนุมัติของหน่วยงาน
 *
 * BDI สั่งเมื่อ 2026-09-11 ว่า "modal preview ของทุกคน ให้ดูทีละเอกสาร (เหมือน
 * organization approver) ยกเว้น bdi approver ขึ้นถูกแล้ว" — ผู้อนุมัติ BDI จึงยังอ่าน
 * ทั้งชุดต่อกันลงมาใน `DocumentStack` ตามเดิม ส่วนที่เหลือใช้กล่องนี้: ผู้ประสานงานของ
 * หน่วยงานตอนนำส่งคำขอ (ทั้งสองเส้นทาง) และผู้ประสานงานของ BDI ตอนผ่านการตรวจสอบ
 * (ทั้งสองเส้นทางเช่นกัน)
 *
 * **ไม่ได้รวมกล่องลงนามของผู้มีอำนาจฯ เข้ามาด้วย** ทั้งที่หน้าตาเหมือนกัน เพราะกล่องนั้น
 * ทำงานคนละอย่าง: มันเก็บเวลาที่ติ๊กของแต่ละฉบับส่งขึ้นไปเป็น `legal_acceptance` มีปุ่ม
 * "ไม่เกี่ยวข้อง" สำหรับฉบับที่ไม่บังคับ และมีคำเตือนรายฉบับซึ่งพูดถึงปุ่มนั้น การยุบสอง
 * ความหมายเข้าเป็นคอมโพเนนต์เดียวแปลว่าเส้นทางที่ออกหลักฐานทางกฎหมายกับเส้นทางที่เป็น
 * แค่ประตูบนหน้าจอ จะแก้ที่เดียวแล้วกระทบกันทั้งคู่ — ที่นี่จึงไม่มี `LegalNotice` ด้วย
 * เหตุผลเดียวกัน คำเตือนนั้นบอกวิธีใช้ปุ่ม "ไม่เกี่ยวข้อง" ที่กล่องนี้ไม่มี
 *
 * ไม่มีเอกสารสักฉบับ = ข้ามไปขั้นยืนยันเลย ไม่ใช่ค้างที่กล่องเปล่า
 */
export function DocumentWalkthrough({
  open,
  onClose,
  documents,
  reloadKey = 0,
  confirmTitle,
  confirmDescription,
  confirmBody,
  confirmLabel,
  busy = false,
  error = null,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  documents: LegalDocument[];
  /** ขยับเมื่อไฟล์ถูกสร้างใหม่ เพื่อไม่ให้ iframe เสิร์ฟฉบับที่ cache ไว้ */
  reloadKey?: number;
  confirmTitle: string;
  confirmDescription?: string;
  /** เนื้อหาเพิ่มของขั้นยืนยัน — เส้นทางชุดข้อมูลเอาไว้แสดงรายการเอกสารแนบ */
  confirmBody?: ReactNode;
  confirmLabel: string;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
}) {
  /** จำนวนฉบับที่อ่านผ่านไปแล้ว — เป็น index ของฉบับที่กำลังแสดงด้วย */
  const [read, setRead] = useState(0);
  const [attested, setAttested] = useState<Record<string, boolean>>({});

  const close = () => {
    setRead(0);
    setAttested({});
    onClose();
  };

  const current = read < documents.length ? documents[read]! : null;

  if (current) {
    const last = read === documents.length - 1;
    return (
      <Modal
        open={open}
        onClose={close}
        size="lg"
        title={documentLabel(current)}
        description={`เอกสารฉบับที่ ${read + 1} จาก ${documents.length} — โปรดอ่านให้ครบก่อนไปต่อ`}
      >
        {current.fileUrl ? (
          <PdfViewer
            url={`${api.fileUrl(current.fileUrl)}?v=${reloadKey}`}
            filename={documentLabel(current)}
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
                setAttested((prev) => ({ ...prev, [current.versionId]: e.target.checked }))
              }
              className="mt-1 h-4 w-4 shrink-0 rounded border-line text-coral-500 focus:ring-2 focus:ring-navy-100"
            />
            <span className="text-[15px] leading-relaxed text-ink">
              {READ_ATTESTATION_TEXT}
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
            onClick={() => setRead(read + 1)}
          >
            {/* ฉบับสุดท้ายพาไปขั้นยืนยัน ไม่ใช่ไปฉบับถัดไปที่ไม่มี — ปุ่มจึงต้องพูดต่างกัน */}
            {last ? "ถัดไป: ยืนยัน" : "ถัดไป"}
          </Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open={open} onClose={close} title={confirmTitle} description={confirmDescription}>
      {confirmBody}
      {error ? (
        <p className="mt-4 rounded-xl bg-danger-bg p-4 text-sm leading-relaxed text-danger">
          {error}
        </p>
      ) : null}
      <div className="mt-6 flex justify-between gap-3">
        <Button variant="secondary" onClick={close}>
          ปิด
        </Button>
        <Button loading={busy} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
