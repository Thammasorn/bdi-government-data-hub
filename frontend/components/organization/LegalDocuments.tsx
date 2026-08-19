"use client";

import { useEffect, useState } from "react";

import { PdfViewer } from "@/components/organization/PdfViewer";
import { Card, CardHeader } from "@/components/ui/Card";
import { Spinner } from "@/components/ui/Spinner";
import { api } from "@/lib/api";
import { formatThaiDate } from "@/lib/status";
import type { LegalDocument } from "@/lib/types";

/**
 * โหลดชุดเอกสารกฎหมายของคำขอหนึ่งใบ — ใช้ทั้งหน้าตรวจสอบก่อนนำส่งและหน้ารายละเอียด
 *
 * คืน `reload` มาด้วยเพราะการลงนามเปลี่ยนสองอย่างในรายการนี้: เอกสารแต่ละฉบับได้
 * `acceptedAt` และไฟล์ A0 ถูกสร้างทับด้วยฉบับที่มีลายมือชื่อ ถ้าไม่โหลดใหม่ ผู้ใช้ที่เพิ่ง
 * กดลงนามจะเห็นหน้าเดิมทุกอย่างและไม่รู้ว่าการลงนามมีผลแล้วหรือยัง
 */
export function useLegalDocuments(requestId: string | null) {
  const [documents, setDocuments] = useState<LegalDocument[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [round, setRound] = useState(0);

  useEffect(() => {
    if (!requestId) return;
    let alive = true;
    setError(null);
    api
      .get<{ documents: LegalDocument[] }>(`/api/organizations/${requestId}/legal-documents`)
      .then((d) => {
        if (alive) setDocuments(d.documents);
      })
      .catch((err) => {
        // ต้องเก็บข้อความไว้ ไม่ใช่แค่ธง — การ์ดเคยแสดง spinner ตลอดไปเมื่อโหลดไม่สำเร็จ
        // ผู้ใช้จึงนึกว่าระบบกำลังทำงานอยู่ ทั้งที่มันหยุดไปแล้วและไม่มีทางเสร็จ
        if (alive) setError(err instanceof Error ? err.message : "โหลดเอกสารไม่สำเร็จ");
      });
    return () => {
      alive = false;
    };
  }, [requestId, round]);

  return { documents, error, reload: () => setRound((r) => r + 1) };
}

/**
 * เอกสารข้อตกลงทั้งชุด พร้อมแท็บสลับฉบับ
 *
 * ทำเป็นแท็บไม่ใช่วางต่อกันลงมา เพราะรวมกันสิบเจ็ดหน้า — หน้าที่ต้องเลื่อนผ่านเอกสาร
 * ทั้งชุดเพื่อไปหาปุ่มนำส่งคือหน้าที่ไม่มีใครอ่านเอกสารเลย
 */
export function LegalDocumentsCard({
  documents,
  description,
  reloadKey = 0,
  error = null,
  onRetry,
}: {
  documents: LegalDocument[] | null;
  description?: string;
  /** เพิ่มค่าเมื่อไฟล์ถูกสร้างใหม่ เพื่อไม่ให้ iframe เสิร์ฟฉบับที่ cache ไว้ */
  reloadKey?: number;
  /** ข้อความจาก useLegalDocuments เมื่อโหลดไม่สำเร็จ */
  error?: string | null;
  onRetry?: () => void;
}) {
  const [active, setActive] = useState(0);

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

  if (documents.length === 0) {
    return (
      <Card>
        <CardHeader title="เอกสารข้อตกลง" description={description} />
        <div className="p-6">
          <p className="rounded-xl bg-warning-bg p-5 text-sm text-warning">
            ยังไม่มีเอกสารข้อตกลงที่เผยแพร่ในระบบ กรุณาแจ้งผู้ดูแลระบบ
          </p>
        </div>
      </Card>
    );
  }

  const current = documents[Math.min(active, documents.length - 1)]!;

  return (
    <Card>
      <CardHeader title="เอกสารข้อตกลง" description={description} />
      {/* แถบเลือกเอกสารเป็นแถวของตัวเอง มี padding บนล่างเท่ากัน — เดิมมีแต่ pb
          ปุ่มจึงไปชิดกับเส้นใต้หัวการ์ดจนดูเหมือนหลุดจากกริด */}
      <div className="border-b border-line bg-canvas px-6 py-4">
        <div role="tablist" aria-label="เลือกเอกสารข้อตกลง" className="flex flex-wrap gap-2">
          {documents.map((doc, index) => (
            <button
              key={doc.versionId}
              type="button"
              role="tab"
              aria-selected={index === active}
              onClick={() => setActive(index)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-4 py-1.5 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy-700 focus-visible:ring-offset-2 ${
                index === active
                  ? "border-navy-700 bg-navy-700 text-white"
                  : "border-line bg-white text-navy-700 hover:border-navy-300 hover:bg-navy-50"
              }`}
            >
              {doc.code}
              {doc.acceptedAt ? (
                <>
                  <span aria-hidden="true">✓</span>
                  <span className="sr-only">เห็นชอบแล้ว</span>
                </>
              ) : null}
            </button>
          ))}
        </div>
      </div>
      <div className="p-6">
        {/* ไม่พิมพ์ชื่อเอกสารซ้ำเหนือตัวอ่าน — หัวของ PdfViewer แสดงชื่อเดียวกันอยู่แล้ว
            และแท็บที่เลือกก็บอกรหัสอยู่ เหลือไว้เฉพาะสิ่งที่ผู้ใช้ทำเอง คือการเห็นชอบ
            (เลขเวอร์ชันของ template ไม่ได้บอกอะไรกับเขา ระบบบันทึกไว้ในฐานข้อมูลแล้วว่า
            ลงนามรับเอกสารเวอร์ชันใด) */}
        {current.acceptedAt ? (
          <p className="mb-4 text-[13px] text-ink-muted">
            เห็นชอบเมื่อ {formatThaiDate(current.acceptedAt)}
          </p>
        ) : null}
        {current.fileUrl ? (
          <PdfViewer
            /**
             * `reloadKey` เกาะกับรอบที่โหลดรายการ — URL ของ A0 ไม่เปลี่ยนเมื่อไฟล์ถูกสร้างทับ
             * (attachment id ใหม่แต่ path เดิมของคำขอ) เบราว์เซอร์จึงเสิร์ฟ PDF ที่ cache ไว้
             * และผู้ที่เพิ่งลงนามจะเห็นฉบับที่ยังไม่มีลายมือชื่อของตัวเอง
             */
            url={`${api.fileUrl(current.fileUrl)}?v=${reloadKey}`}
            filename={`${current.code} · ${current.name}`}
            title={current.name}
          />
        ) : (
          <p className="rounded-xl bg-warning-bg p-5 text-sm text-warning">
            ยังไม่ได้สร้างเอกสารฉบับนี้ กรุณากลับไปกด &ldquo;ตรวจสอบและสร้าง PDF&rdquo; อีกครั้ง
          </p>
        )}
      </div>
    </Card>
  );
}
