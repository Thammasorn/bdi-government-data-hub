"use client";

import { PdfViewer } from "@/components/organization/PdfViewer";
import { api } from "@/lib/api";
import { documentLabel } from "@/lib/legal-document";
import type { LegalDocument } from "@/lib/types";

/**
 * เอกสารทั้งชุดของคำขอ วางต่อกันลงมาให้อ่านรวดเดียว
 *
 * ใช้ในกล่องอนุมัติของผู้อนุมัติ BDI ทั้งสองเส้นทาง (การ์ด "BDI approver preview before
 * approve" 2026-09-09) — เขาต้องเห็นเอกสารทุกฉบับที่กำลังจะอนุมัติก่อนกด ไม่ใช่ไปเปิดอ่าน
 * ทีละฉบับจากการ์ดในหน้ารายละเอียดแล้วกลับมากด
 *
 * **วางต่อกัน ไม่ใช่แท็บ** ตามที่การ์ดสั่งว่า "ให้แสดงทั้ง 4 เอกสาร" — แท็บซ่อนสามในสี่ฉบับ
 * ไว้หลังการกด ซึ่งอ่านได้ว่าไม่ต้องเปิดก็ได้ ในขณะที่กล่องนี้มีอยู่เพื่อบอกว่าต้องดูให้ครบ
 *
 * ต่างจากการ์ด `LegalDocumentsCard` ที่โหลดเมื่อกดเท่านั้น — ที่นี่กดปุ่มอนุมัติแล้วถึงจะมาถึง
 * การเปิดกล่องนี้**คือ**การบอกว่าตั้งใจจะอ่านทั้งชุด
 */
export function DocumentStack({
  documents,
  /** ขยับเมื่อไฟล์ถูกสร้างใหม่ เพื่อไม่ให้ iframe เสิร์ฟฉบับที่ cache ไว้ */
  reloadKey = 0,
}: {
  documents: LegalDocument[];
  reloadKey?: number;
}) {
  if (documents.length === 0) {
    return (
      <p className="rounded-xl bg-warning-bg p-5 text-sm text-warning">
        ยังไม่มีเอกสารของคำขอนี้ กรุณาแจ้งผู้ดูแลระบบ
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {documents.map((doc, index) => (
        <div key={doc.versionId}>
          {/* เลขลำดับบอกว่าเหลืออีกกี่ฉบับ — กล่องนี้เลื่อนยาว ผู้อ่านต้องรู้ว่าอยู่ตรงไหน */}
          <p className="mb-2 text-[13px] font-medium text-ink-muted">
            เอกสารฉบับที่ {index + 1} จาก {documents.length}
          </p>
          {doc.fileUrl ? (
            <PdfViewer
              url={`${api.fileUrl(doc.fileUrl)}?v=${reloadKey}`}
              filename={documentLabel(doc)}
              title={doc.name}
            />
          ) : (
            <p className="rounded-xl bg-warning-bg p-5 text-sm text-warning">
              ยังไม่มีไฟล์ของ &ldquo;{documentLabel(doc)}&rdquo; กรุณาแจ้งผู้ดูแลระบบ
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
