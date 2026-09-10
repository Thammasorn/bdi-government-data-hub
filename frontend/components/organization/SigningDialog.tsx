"use client";

import { useState } from "react";

import { DocumentStack } from "@/components/organization/DocumentStack";
import { LegalNotice } from "@/components/organization/LegalNotice";
import { PdfViewer } from "@/components/organization/PdfViewer";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { api, ApiError } from "@/lib/api";
import { documentLabel } from "@/lib/legal-document";
import type { LegalDocument } from "@/lib/types";

/**
 * ข้อความยืนยันที่ผู้ลงนามเห็นตอนกดลงนาม — ตรงตามภาพในการ์ด Notion ข้อ 3
 *
 * ส่งขึ้นไปเก็บที่ signature_confirmation.confirmation_text ด้วย เพราะหลักฐานการลงนาม
 * ต้องบอกได้ว่าเขายืนยัน**ข้อความอะไร** ถ้าเก็บแค่ "ลงนามแล้ว" แล้ววันหนึ่งข้อความนี้
 * ถูกแก้ หลักฐานเก่าจะเปลี่ยนความหมายตามไปด้วย
 */
export const CONFIRMATION_TEXT =
  "ข้าพเจ้าได้พิจารณาข้อตกลงนี้แล้ว และมีเจตนาลงนามด้วยวิธีอิเล็กทรอนิกส์";

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
 *   false — BDI อ่านเอกสารทั้งชุดในกล่องนี้เอง (ต่อกันลงมา) แล้วลงนามทีเดียว การ์ดชุดเดิม
 *           เขียนไว้ชัดว่า "ไม่ต้องมีขึ้น เห็นชอบ ทีละเอกสาร" — คือไม่ต้องติ๊กรายฉบับ
 *           ไม่ได้แปลว่าไม่ต้องเห็นเอกสาร (2026-09-09)
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
  /**
   * ฉบับที่กด "ไม่เกี่ยวข้อง" — เก็บเป็น set ของ version id
   *
   * ไม่รวมเข้ากับ `attested` เพราะสองอย่างนี้คนละความหมาย: ติ๊กแล้วคือ "อ่านและเห็นชอบ"
   * ซึ่งจะกลายเป็น legal_acceptance ส่วนอันนี้คือ "ฉบับนี้ไม่เกี่ยวกับหน่วยงานเรา"
   * ซึ่งไม่ใช่การยอมรับ จึงไม่ลงตารางนั้น
   */
  const [notApplicable, setNotApplicable] = useState<string[]>([]);

  const reset = () => {
    setAcknowledged(0);
    setError(null);
    setAttested({});
    setNotApplicable([]);
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
          acknowledgements: documents
            .filter((d) => !notApplicable.includes(d.versionId))
            .map((d) => ({
              versionId: d.versionId,
              // ฝ่าย BDI ไม่มีการติ๊กรายฉบับ จึงใช้เวลาที่กดลงนามเป็นเวลายอมรับ
              attestedAt: attested[d.versionId] ?? new Date().toISOString(),
            })),
          notApplicable: notApplicable.map((versionId) => ({ versionId })),
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
        title={documentLabel(current)}
        description={`เอกสารฉบับที่ ${acknowledged + 1} จาก ${documents.length} — โปรดอ่านให้ครบก่อนกดเห็นชอบ`}
      >
        {/* คำเตือนของเอกสารฉบับนี้ — อยู่ใต้บรรทัด "เอกสารฉบับที่ n จาก m" ตามที่ขอไว้
            **ที่เดียวในระบบที่คำเตือนขึ้น** เพราะที่นี่ที่เดียวที่มีปุ่ม "ไม่เกี่ยวข้อง" ให้กด
            ตามที่คำเตือนของผนวก 3 สั่ง (BDI แจ้งเมื่อ 2026-09-07 ว่าการ์ดเอกสารเป็นที่ผิด)
            ยังไม่ผูกกับ `is_required` — ฉบับบังคับที่มีคำเตือนก็ขึ้น มันแค่จะไม่มีปุ่มให้กด */}
        <LegalNotice document={current} className="mb-4" />
        {current.fileUrl ? (
          <PdfViewer
            url={api.fileUrl(current.fileUrl)}
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
          <div className="flex gap-3">
            {/*
              ฉบับไม่บังคับข้ามได้ — ปุ่มอยู่ซ้ายของ "เห็นชอบ" ตามการ์ด
              กดแล้วเดินไปฉบับถัดไปเหมือนกัน ต่างกันแค่ฉบับนี้จะไม่ถูกนับเป็นการยอมรับ
              และจะไม่ถูกส่งต่อไปให้ฝ่าย BDI เห็นชอบ
            */}
            {current.isRequired === false ? (
              <Button
                variant="secondary"
                onClick={() => {
                  setNotApplicable((prev) =>
                    prev.includes(current.versionId) ? prev : [...prev, current.versionId],
                  );
                  setAttested((prev) => {
                    const next = { ...prev };
                    delete next[current.versionId];
                    return next;
                  });
                  setAcknowledged(acknowledged + 1);
                }}
              >
                ไม่เกี่ยวข้อง
              </Button>
            ) : null}
            <Button
              disabled={!current.fileUrl || !attested[current.versionId]}
              onClick={() => {
                setNotApplicable((prev) => prev.filter((id) => id !== current.versionId));
                setAcknowledged(acknowledged + 1);
              }}
            >
              เห็นชอบ
            </Button>
          </div>
        </div>
      </Modal>
    );
  }

  /**
   * ฝั่ง BDI — อ่านเอกสารทั้งชุดในกล่องนี้ก่อน แล้วกดอนุมัติทีเดียว
   *
   * เดิมกล่องนี้มีแต่ประโยคยืนยัน เอกสารต้องไปเปิดอ่านจากการ์ดในหน้ารายละเอียดก่อนแล้ว
   * ค่อยกลับมากด — BDI ขอให้เห็นเอกสารที่กำลังจะอนุมัติอยู่ตรงหน้าตอนกด (2026-09-09)
   *
   * ยังไม่มีการติ๊กรายฉบับ ตามที่การ์ดชุดเดิมเขียนไว้ว่าฝั่ง BDI "ไม่ต้องมีขึ้น เห็นชอบ
   * ทีละเอกสาร" — `legal_acceptance` เป็นตารางของฝั่งหน่วยงาน backend ไม่เคยเขียนให้ BDI
   */
  if (!perDocument) {
    return (
      <Modal
        open={open}
        onClose={close}
        size="lg"
        title={signLabel}
        description="ตรวจเอกสารทุกฉบับให้ครบก่อนอนุมัติ"
      >
        <DocumentStack documents={documents} />
        <p className="mt-5 text-center text-[17px] font-semibold leading-relaxed text-navy-800">
          {CONFIRMATION_TEXT}
        </p>
        <p className="mt-4 text-[13px] leading-relaxed text-ink-muted">
          ระบบจะบันทึกชื่อ เวลา และเอกสารทุกฉบับที่คุณเห็นชอบไว้เป็นหลักฐาน
          และประทับลายมือชื่อของคุณลงในเอกสารข้อตกลง
        </p>
        {error ? (
          <p className="mt-4 rounded-xl bg-danger-bg p-4 text-sm leading-relaxed text-danger">
            {error}
          </p>
        ) : null}
        <div className="mt-6 flex justify-between gap-3">
          <Button variant="secondary" onClick={close}>
            ปิด
          </Button>
          <Button loading={busy} onClick={sign}>
            {signLabel}
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
      {/*
        ไม่ไล่รหัสเอกสารตรงนี้ — "A0 · A1 · A2 · A3" ไม่ได้สื่ออะไรกับผู้ลงนาม (เขาเพิ่งอ่าน
        มาทีละฉบับ และการ์ดเอกสารด้านหลังก็มีแท็บบอกอยู่) และมันเคยเป็นต้นเหตุให้ข้อความ
        ผิดตั้งแต่แรก: ฝั่ง BDI เห็นรหัสของฉบับที่หน่วยงานข้ามไปแล้วรวมอยู่ในบรรทัดนี้ด้วย
      */}
      <p className="mt-4 text-[13px] leading-relaxed text-ink-muted">
        ระบบจะบันทึกชื่อ เวลา และเอกสารทุกฉบับที่คุณเห็นชอบไว้เป็นหลักฐาน
        และประทับลายมือชื่อของคุณลงในเอกสารข้อตกลง
      </p>
      {notApplicable.length > 0 ? (
        <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">
          เอกสารที่คุณระบุว่าไม่เกี่ยวข้อง จะไม่ถูกบันทึกเป็นการยอมรับ
          และจะไม่ถูกส่งต่อให้ BDI พิจารณา
        </p>
      ) : null}
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
