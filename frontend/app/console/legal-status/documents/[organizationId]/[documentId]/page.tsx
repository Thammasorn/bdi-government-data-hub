"use client";

import { useParams, useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { LegalDocumentView } from "@/components/legal/LegalDocumentView";
import { Spinner } from "@/components/ui/Spinner";

// useSearchParams (?version=) ต้องมี Suspense ครอบ ไม่งั้น build ของ Next ไม่ผ่าน
export default function ConsoleLegalDocumentPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <Inner />
    </Suspense>
  );
}

function Inner() {
  const { organizationId, documentId } = useParams<{ organizationId: string; documentId: string }>();
  const versionId = useSearchParams().get("version");
  return (
    <LegalDocumentView
      organizationId={organizationId}
      documentId={documentId}
      versionId={versionId}
      base="/console/legal-status"
      crumbs={[{ label: "สถานะเอกสารทางกฎหมายของหน่วยงาน", href: "/console/legal-status" }]}
    />
  );
}
