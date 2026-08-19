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
export function useLegalDocuments(requestId: string) {
  const [documents, setDocuments] = useState<LegalDocument[] | null>(null);
  const [error, setError] = useState(false);
  const [round, setRound] = useState(0);

  useEffect(() => {
    let alive = true;
    api
      .get<{ documents: LegalDocument[] }>(`/api/organizations/${requestId}/legal-documents`)
      .then((d) => {
        if (alive) setDocuments(d.documents);
      })
      .catch(() => {
        if (alive) setError(true);
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
}: {
  documents: LegalDocument[] | null;
  description?: string;
  /** เพิ่มค่าเมื่อไฟล์ถูกสร้างใหม่ เพื่อไม่ให้ iframe เสิร์ฟฉบับที่ cache ไว้ */
  reloadKey?: number;
}) {
  const [active, setActive] = useState(0);

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
      <div className="flex flex-wrap gap-2 border-b border-line px-6 pb-4">
        {documents.map((doc, index) => (
          <button
            key={doc.versionId}
            type="button"
            onClick={() => setActive(index)}
            className={`rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition-colors ${
              index === active
                ? "border-navy-700 bg-navy-700 text-white"
                : "border-line text-navy-700 hover:bg-navy-50"
            }`}
          >
            {doc.code}
            {doc.acceptedAt ? " ✓" : ""}
          </button>
        ))}
      </div>
      <div className="p-6">
        <div className="mb-4">
          <p className="text-[15px] font-medium text-ink">
            {current.code} · {current.name}
          </p>
          <p className="mt-0.5 text-[13px] text-ink-muted">
            ฉบับที่ {current.versionNumber}
            {current.acceptedAt ? ` · เห็นชอบเมื่อ ${formatThaiDate(current.acceptedAt)}` : ""}
          </p>
        </div>
        {current.fileUrl ? (
          <PdfViewer
            /**
             * `reloadKey` เกาะกับรอบที่โหลดรายการ — URL ของ A0 ไม่เปลี่ยนเมื่อไฟล์ถูกสร้างทับ
             * (attachment id ใหม่แต่ path เดิมของคำขอ) เบราว์เซอร์จึงเสิร์ฟ PDF ที่ cache ไว้
             * และผู้ที่เพิ่งลงนามจะเห็นฉบับที่ยังไม่มีลายมือชื่อของตัวเอง
             */
            url={`${api.fileUrl(current.fileUrl)}?v=${reloadKey}`}
            filename={`${current.code} ${current.name}`}
            title={current.name}
          />
        ) : (
          <p className="rounded-xl bg-warning-bg p-5 text-sm text-warning">
            ยังไม่ได้สร้างเอกสารฉบับนี้ กรุณากลับไปกด &ldquo;ตรวจสอบและสร้าง PDF&rdquo; อีกครั้ง
          </p>
        )}
      </div>
      <p className="px-6 pb-6 text-[13px] text-ink-muted">
        เอกสาร {documents.map((d) => d.code).join(" · ")} รวม {documents.length} ฉบับ — ทุกฉบับเป็นส่วนหนึ่งของข้อตกลงเดียวกัน
      </p>
    </Card>
  );
}
