"use client";

import { useParams, useRouter } from "next/navigation";

import { AddDocumentForm } from "@/components/console/LegalUpload";
import { PageHeader } from "@/components/console/ui";
import { useToast } from "@/components/ui/Toast";
import { SCOPE_ORDER, SCOPE_TITLES, type LegalScope } from "@/lib/legal-admin";

/**
 * เพิ่มเอกสารใหม่ — หน้าของตัวเองแทน modal (BDI 2026-10-10) มีทางย้อนกลับเหมือนหน้าแก้ไข
 * `:scope` คือหมวดที่กดเพิ่มมา ชื่อเดียวกับ `application_scope` ในฐานข้อมูล
 */
export default function ConsoleNewLegalDocumentPage() {
  const params = useParams<{ scope: string }>();
  const router = useRouter();
  const { show } = useToast();
  const scope = SCOPE_ORDER.find((s) => s === params.scope) as LegalScope | undefined;

  if (!scope) {
    return (
      <PageHeader
        title="ไม่พบหมวดเอกสาร"
        back={{ href: "/console/legal-documents", label: "เอกสารข้อตกลง" }}
        description="เลือกหมวดจากปุ่ม “เพิ่มเอกสาร” ในหน้าเอกสารข้อตกลง"
      />
    );
  }

  return (
    <div>
      <PageHeader
        eyebrow="ตั้งค่าเอกสาร"
        title="เพิ่มเอกสาร"
        description={SCOPE_TITLES[scope]}
        back={{ href: "/console/legal-documents", label: "เอกสารข้อตกลง" }}
      />
      <AddDocumentForm
        scope={scope}
        onDone={(res) => {
          show({ tone: "success", title: `สร้างเอกสาร ${res.document.code} แล้ว`, detail: res.message });
          router.push(`/console/legal-documents/${encodeURIComponent(res.document.code)}`);
        }}
      />
    </div>
  );
}
