"use client";

import { useEffect, useState } from "react";

import { PdfViewer } from "@/components/organization/PdfViewer";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";
import { api } from "@/lib/api";
import { documentLabel } from "@/lib/legal-document";
import { formatThaiDate } from "@/lib/status";
import type { LegalDocument, SkippedLegalDocument } from "@/lib/types";

/**
 * โหลดชุดเอกสารกฎหมายของคำขอหนึ่งใบ — ใช้ทั้งหน้าตรวจสอบก่อนนำส่งและหน้ารายละเอียด
 *
 * คืน `reload` มาด้วยเพราะการลงนามเปลี่ยนสองอย่างในรายการนี้: เอกสารแต่ละฉบับได้
 * `acceptedAt` และไฟล์ A0 ถูกสร้างทับด้วยฉบับที่มีลายมือชื่อ ถ้าไม่โหลดใหม่ ผู้ใช้ที่เพิ่ง
 * กดลงนามจะเห็นหน้าเดิมทุกอย่างและไม่รู้ว่าการลงนามมีผลแล้วหรือยัง
 */
export function useLegalDocuments(
  requestId: string | null,
  /** ชุด endpoint ที่จะถาม — ทั้งสองเส้นทางมีเอกสารของตัวเองที่รูปแบบเหมือนกัน */
  base: "organizations" | "dataset-requests" = "organizations",
) {
  const [documents, setDocuments] = useState<LegalDocument[] | null>(null);
  /** ฉบับที่หน่วยงานระบุว่าไม่เกี่ยวข้อง — ไม่อยู่ใน `documents` แต่ยังต้องบอกผู้ใช้ว่ามีอยู่ */
  const [notApplicable, setNotApplicable] = useState<SkippedLegalDocument[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [round, setRound] = useState(0);

  useEffect(() => {
    if (!requestId) return;
    let alive = true;
    setError(null);
    api
      // เส้นทางชุดข้อมูลไม่มีการกดข้ามเอกสาร จึงไม่ส่งคีย์นี้มา — ถือว่าไม่มีฉบับที่ถูกข้าม
      .get<{ documents: LegalDocument[]; notApplicable?: SkippedLegalDocument[] }>(
        `/api/${base}/${requestId}/legal-documents`,
      )
      .then((d) => {
        if (!alive) return;
        setDocuments(d.documents);
        setNotApplicable(d.notApplicable ?? []);
      })
      .catch((err) => {
        // ต้องเก็บข้อความไว้ ไม่ใช่แค่ธง — การ์ดเคยแสดง spinner ตลอดไปเมื่อโหลดไม่สำเร็จ
        // ผู้ใช้จึงนึกว่าระบบกำลังทำงานอยู่ ทั้งที่มันหยุดไปแล้วและไม่มีทางเสร็จ
        if (alive) setError(err instanceof Error ? err.message : "โหลดเอกสารไม่สำเร็จ");
      });
    return () => {
      alive = false;
    };
  }, [requestId, base, round]);

  return { documents, notApplicable, error, reload: () => setRound((r) => r + 1) };
}

/**
 * เอกสารข้อตกลงทั้งชุด — รายชื่อฉบับ พร้อมปุ่มเปิดอ่านทีละฉบับใน modal
 *
 * **ไม่ฝังตัวอ่าน PDF ไว้ในหน้า** (BDI ขอเมื่อ 2026-09-10) เดิมการ์ดนี้เป็นแท็บสลับฉบับ
 * โดยมี `<iframe>` ของฉบับที่เลือกฝังอยู่ตลอด ทุกครั้งที่เปิดหน้ารายละเอียดจึงมีการโหลด
 * เอกสารหนึ่งฉบับเสมอ ไม่ว่าคนเปิดหน้าจะตั้งใจอ่านเอกสารหรือไม่
 *
 * ราคานั้นเพิ่งแพงขึ้นมาก: เอกสารที่มี placeholder ถูก **render สดทุกครั้งที่เปิดอ่าน**
 * เพื่อประทับชื่อผู้เปิดกับวันที่ (การ์ด "Document Print Date") ซึ่งเป็นงานของ LibreOffice
 * ระดับวินาที การฝังไว้เฉย ๆ จึงเท่ากับให้ทุกคนที่เปิดหน้ารายละเอียดจ่ายค่านั้นฟรี
 *
 * กดแล้วค่อยโหลดยังตอบโจทย์เดิมของแท็บด้วย — เอกสารทั้งชุดรวมกันสิบเจ็ดหน้า หน้าที่ต้อง
 * เลื่อนผ่านเอกสารทั้งชุดเพื่อไปหาปุ่มนำส่งคือหน้าที่ไม่มีใครอ่านเอกสารเลย
 */
export function LegalDocumentsCard({
  documents,
  notApplicable = [],
  description,
  reloadKey = 0,
  error = null,
  onRetry,
  regenerateLabel = "ตรวจสอบและสร้าง PDF",
}: {
  documents: LegalDocument[] | null;
  /** ฉบับที่หน่วยงานระบุว่าไม่เกี่ยวข้อง — แสดงเป็นบรรทัดบอก ไม่ใช่แท็บให้เปิดอ่าน */
  notApplicable?: SkippedLegalDocument[];
  description?: string;
  /** เพิ่มค่าเมื่อไฟล์ถูกสร้างใหม่ เพื่อไม่ให้ iframe เสิร์ฟฉบับที่ cache ไว้ */
  reloadKey?: number;
  /** ข้อความจาก useLegalDocuments เมื่อโหลดไม่สำเร็จ */
  error?: string | null;
  onRetry?: () => void;
  /**
   * ชื่อปุ่มที่พาไปสร้างเอกสารใหม่ — การ์ดนี้ใช้ร่วมกันทั้งเส้นทางหน่วยงานและชุดข้อมูล
   * ซึ่งตั้งชื่อปุ่มไม่เหมือนกัน บอกให้กดปุ่มที่ไม่มีอยู่บนหน้าจอคือทางตันสำหรับผู้ใช้
   */
  regenerateLabel?: string;
}) {
  /** ฉบับที่เปิดอ่านอยู่ — null คือยังไม่ได้กดเปิดฉบับไหน จึงยังไม่มีการ render */
  const [open, setOpen] = useState<LegalDocument | null>(null);

  // โหลดไม่สำเร็จต้องบอกและให้ลองใหม่ได้ ไม่ใช่หมุนค้างไว้เฉย ๆ
  if (error) {
    return (
      <Card>
        <CardHeader title="เอกสารข้อตกลง" description={description} />
        <div className="p-6">
          <p className="rounded-xl bg-danger-bg p-5 text-sm leading-relaxed text-danger">
            โหลดเอกสารข้อตกลงไม่สำเร็จ — {error}
          </p>
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="mt-4 rounded-full border border-line px-4 py-2 text-[13px] font-medium text-navy-700 transition-colors hover:bg-navy-50"
            >
              ลองโหลดอีกครั้ง
            </button>
          ) : null}
        </div>
      </Card>
    );
  }

  if (!documents) {
    return (
      <Card>
        <CardHeader title="เอกสารข้อตกลง" description={description} />
        <div className="p-6">
          <Spinner />
        </div>
      </Card>
    );
  }

  /**
   * ฉบับที่ถูกข้ามหายไปจากรายการ จึงต้องมีบรรทัดบอกว่ามันหายไปไหน
   *
   * ผู้อนุมัติ BDI เห็นบรรทัดนี้ด้วย — เขาควรรู้ว่าหน่วยงานระบุฉบับไหนว่าไม่เกี่ยวข้อง
   * เขาแค่ไม่ต้องอ่านและลงนามรับรองมัน
   */
  const skippedNote =
    notApplicable.length > 0 ? (
      <p className="text-[13px] leading-relaxed text-ink-muted">
        หน่วยงานระบุว่า &ldquo;{notApplicable.map(documentLabel).join(" · ")}&rdquo;
        ไม่เกี่ยวข้องกับหน่วยงาน จึงไม่อยู่ในชุดที่ต้องเห็นชอบและลงนาม
      </p>
    ) : null;

  if (documents.length === 0) {
    return (
      <Card>
        <CardHeader title="เอกสารข้อตกลง" description={description} />
        <div className="p-6">
          {skippedNote ?? (
            <p className="rounded-xl bg-warning-bg p-5 text-sm text-warning">
              ยังไม่มีเอกสารข้อตกลงที่เผยแพร่ในระบบ กรุณาแจ้งผู้ดูแลระบบ
            </p>
          )}
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader title="เอกสารข้อตกลง" description={description} />
      <ul className="divide-y divide-line">
        {documents.map((doc) => (
          <li
            key={doc.versionId}
            className="flex flex-wrap items-center justify-between gap-3 px-6 py-4"
          >
            <div className="min-w-0">
              <p className="text-[15px] font-medium text-navy-800">{documentLabel(doc)}</p>
              {doc.acceptedAt ? (
                <p className="mt-0.5 text-[13px] text-ink-muted">
                  เห็นชอบเมื่อ {formatThaiDate(doc.acceptedAt)}
                </p>
              ) : null}
            </div>
            {doc.fileUrl ? (
              <Button size="sm" variant="secondary" onClick={() => setOpen(doc)}>
                ดูเอกสาร
              </Button>
            ) : (
              /* ปุ่มที่กดแล้วไม่มีอะไรให้อ่านแย่กว่าไม่มีปุ่ม — บอกวิธีทำให้มีไฟล์แทน */
              <p className="text-[13px] text-warning">
                ยังไม่ได้สร้างเอกสารฉบับนี้ — กด &ldquo;{regenerateLabel}&rdquo; อีกครั้ง
              </p>
            )}
          </li>
        ))}
      </ul>
      {skippedNote ? <div className="border-t border-line px-6 py-4">{skippedNote}</div> : null}

      {/*
        การ์ดนี้เป็นตัวอ่านอย่างเดียว ไม่มีปุ่ม "ไม่เกี่ยวข้อง" และไม่แสดง `legal_notice` —
        คำเตือนของผนวก 3 สั่งให้กดปุ่มนั้น ซึ่งมีอยู่ในกล่องลงนามของผู้มีอำนาจเท่านั้น
      */}
      <Modal
        open={open !== null}
        onClose={() => setOpen(null)}
        size="lg"
        title={open ? documentLabel(open) : ""}
        description={open?.name}
      >
        {open?.fileUrl ? (
          <PdfViewer
            /**
             * `reloadKey` เกาะกับรอบที่โหลดรายการ — URL ของ A0 ไม่เปลี่ยนเมื่อไฟล์ถูกสร้างทับ
             * ฉบับที่ render สดส่ง `Cache-Control: no-store` มาเองอยู่แล้ว แต่ผนวกที่ไม่มี
             * placeholder ยังเสิร์ฟจากที่เก็บและ cache ได้ตามปกติ จึงยังต้องมีตัวนี้
             */
            url={`${api.fileUrl(open.fileUrl)}?v=${reloadKey}`}
            filename={documentLabel(open)}
            title={open.name}
          />
        ) : null}
        <div className="mt-5 flex justify-end">
          <Button variant="secondary" onClick={() => setOpen(null)}>
            ปิด
          </Button>
        </div>
      </Modal>
    </Card>
  );
}
