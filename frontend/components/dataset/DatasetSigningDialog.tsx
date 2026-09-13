"use client";

import { useState } from "react";

import { DocumentStack } from "@/components/organization/DocumentStack";
import { PdfViewer } from "@/components/organization/PdfViewer";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { api, ApiError } from "@/lib/api";
import { documentLabel } from "@/lib/legal-document";
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
export const DATASET_CONFIRMATION_TEXT = "ยืนยันส่งแบบนำส่งข้อมูล";

/**
 * ฝั่ง BDI ยืนยันด้วยคำเดียว — กล่องมีแต่หัวข้อ "อนุมัติ" ไม่มีประโยคกลางกล่องแล้ว
 *
 * แยกค่าคงที่ออกมาเพราะ `confirmation_text` คือหลักฐานว่า**เขายืนยันข้อความอะไร**
 * ถ้าปล่อยให้ทั้งสองฝั่งส่งข้อความเดียวกัน หลักฐานของฝั่ง BDI จะอ้างประโยคที่กล่องของเขา
 * ไม่ได้แสดงเลย (BDI ขอตัดออกเมื่อ 2026-09-04)
 */
export const DATASET_APPROVAL_TEXT = "อนุมัติ";

/** คำยืนยันว่าอ่านเอกสารครบ — ติ๊กก่อนจึงกดยืนยันได้ (แบบเดียวกับเส้นทางหน่วยงาน) */
export const DATASET_ATTESTATION_TEXT = "ข้าพเจ้าได้อ่านเอกสารฉบับนี้ครบถ้วนแล้ว";

/**
 * ขั้นตอนยืนยันแบบนำส่งข้อมูลของผู้มีอำนาจกระทำการแทน และของผู้อนุมัติ BDI
 *
 * ต่างกันที่ `perDocument` เหมือนเส้นทางจดทะเบียนหน่วยงาน:
 *   true  — ฝั่งหน่วยงาน อ่านแบบนำส่งข้อมูลในกล่องนี้ ติ๊กยืนยันว่าอ่านครบ แล้วกดยืนยัน
 *   false — ฝั่ง BDI อ่านเอกสารทั้งชุดในกล่องนี้เหมือนกัน แต่ไม่ต้องติ๊ก และมีปุ่มไม่อนุมัติด้วย
 *
 * เส้นทางนี้มีเอกสารฉบับเดียว จึงไม่มีการเดินอ่านทีละฉบับแบบเส้นทางหน่วยงาน — `perDocument`
 * ที่นี่จึงหมายถึง "ต้องติ๊กว่าอ่านครบก่อนไหม" ไม่ใช่ "เดินทีละฉบับไหม"
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
  perDocument,
  onReject,
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
  /** true = ต้องอ่านเอกสารในกล่องนี้และติ๊กยืนยันก่อน (ฝั่งหน่วยงาน) */
  perDocument: boolean;
  /**
   * ผู้อนุมัติ BDI กด "ไม่อนุมัติ" — พาไปกรอกเหตุผล
   *
   * ปุ่มย้ายเข้ามาอยู่ในกล่องนี้ (การ์ด 2026-09-09 ข้อ 2) แต่**ตัวขั้นตอนไม่ได้ย้ายตามมา**
   * การกรอกเหตุผลกับกฎ 10 ตัวอักษรยังเป็นของ `DetailView` ที่เดียวเหมือนเดิม กล่องนี้แค่
   * ปิดตัวเองแล้วส่งต่อ — เขียนขั้นตอนนั้นซ้ำที่นี่คือมีกฎเดียวกันอยู่สองที่ให้ไม่ตรงกันทีหลัง
   */
  onReject?: () => void;
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
            // ฝั่ง BDI ไม่มีการติ๊กรายฉบับ จึงใช้เวลาที่กดยืนยันเป็นเวลายอมรับ
            attestedAt: attested[d.versionId] ?? new Date().toISOString(),
          })),
          /**
           * ส่งข้อความติ๊กขึ้นไปเฉพาะตอนที่มีการติ๊กจริง
           *
           * `attestationText` คือหลักฐานว่า "ผู้ใช้ยืนยันข้อความอะไรตอนติ๊ก" ถ้าฝั่ง BDI
           * ซึ่งไม่มีช่องติ๊กส่งค่านี้ไปด้วย มันจะกลายเป็นหลักฐานของการกระทำที่ไม่ได้เกิดขึ้น
           */
          ...(perDocument ? { attestationText: DATASET_ATTESTATION_TEXT } : {}),
          confirmationText: perDocument ? DATASET_CONFIRMATION_TEXT : DATASET_APPROVAL_TEXT,
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

  /**
   * ฝั่ง BDI — อ่านเอกสารทั้งชุดในกล่องนี้ แล้วตัดสินในกล่องเดียวกัน
   *
   * เดิมกล่องนี้มีแต่ประโยคยืนยัน เอกสารต้องไปเปิดอ่านจากการ์ดในหน้ารายละเอียดก่อน
   * แล้วค่อยกลับมากด และปุ่ม "ไม่อนุมัติ" อยู่บนการ์ดข้างบนคนละที่กับปุ่มอนุมัติ
   * BDI ขอให้ทั้งเอกสารและทั้งสองทางเลือกมาอยู่ตรงหน้าตอนตัดสิน (2026-09-09)
   *
   * **ยังไม่มีช่องติ๊ก** ช่องติ๊กเป็นหลักฐานว่า**หน่วยงาน**อ่านแล้วจึงยอมรับ ซึ่งลงเป็นแถวใน
   * `legal_acceptance` — backend ไม่เคยเขียนตารางนั้นให้ฝั่ง BDI เลย เพราะการอนุมัติของ
   * BDI เป็นการเห็นชอบของสำนักงาน ไม่ใช่การยอมรับเงื่อนไข ประตูที่ไม่ได้สร้างหลักฐาน
   * อะไรขึ้นมาเลยมีค่าเท่ากับความหน่วง
   */
  if (!perDocument) {
    return (
      <Modal
        open={open}
        onClose={close}
        size="lg"
        title={title}
        description="ตรวจแบบนำส่งข้อมูลให้ครบก่อนตัดสิน"
      >
        <DocumentStack documents={documents} />
        {/* ไม่มีประโยคกลางกล่องแล้ว — หัวข้อ "อนุมัติ" พูดแทนทั้งหมด (BDI ขอเมื่อ 2026-09-04) */}
        <p className="mt-5 text-[13px] leading-relaxed text-ink-muted">
          ระบบจะบันทึกชื่อ เวลา และแบบนำส่งข้อมูลที่คุณเห็นชอบไว้เป็นหลักฐาน
          แล้วแจ้งผู้เกี่ยวข้องในขั้นถัดไป
        </p>
        {error ? (
          <p className="mt-4 rounded-xl bg-danger-bg p-4 text-sm leading-relaxed text-danger">
            {error}
          </p>
        ) : null}
        {/*
          "ไม่อนุมัติ" อยู่คนละฝั่งกับ "อนุมัติ" (การ์ด "BDI APPROVER UI")

          เดิมสองปุ่มนี้ติดกันที่มุมขวา ห่างกัน 12px และเป็นคำตอบคนละทางของคำถามเดียวกัน
          บนมือถือหรือไอแพดจึงกดพลาดข้ามปุ่มได้ง่าย ตอนนี้ "ปิด" ซึ่งไม่ตัดสินอะไรเลย
          มาคั่นไว้ และ gap-x-6 ทำให้ระยะห่างมากกว่าช่องไฟระหว่างปุ่มปกติเท่าตัว

          พอจอแคบจนต้องขึ้นบรรทัดใหม่ "ไม่อนุมัติ" ไปอยู่บรรทัดบนฝั่งซ้าย ส่วน "ปิด"
          กับ "อนุมัติ" อยู่บรรทัดล่าง — สองปุ่มที่ตัดสินจึงไม่เคยอยู่ติดกันไม่ว่าจอกว้างเท่าไร
        */}
        <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3">
          {onReject ? (
            <Button
              variant="danger"
              disabled={busy}
              onClick={() => {
                close();
                onReject();
              }}
            >
              ไม่อนุมัติ
            </Button>
          ) : null}
          <div className="ml-auto flex flex-wrap gap-3">
            <Button variant="secondary" onClick={close}>
              ปิด
            </Button>
            <Button loading={busy} onClick={submit}>
              {title}
            </Button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open={open} onClose={close} size="lg" title={title}>
      <p className="text-center text-[17px] font-semibold leading-relaxed text-navy-800">
        {DATASET_CONFIRMATION_TEXT}
      </p>

      {current?.fileUrl ? (
        <div className="mt-5">
          <PdfViewer
            url={api.fileUrl(current.fileUrl)}
            filename={documentLabel(current)}
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
          {readAll ? "อ่านครบแล้ว — กดยืนยันเพื่อดำเนินการต่อ" : "กรุณาติ๊กช่องยืนยันว่าอ่านเอกสารครบแล้วก่อน จึงจะกดยืนยันต่อได้"}
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
