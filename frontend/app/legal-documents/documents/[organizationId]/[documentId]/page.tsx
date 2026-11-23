"use client";

import { useParams, useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { LegalDocumentView } from "@/components/legal/LegalDocumentView";
import { Spinner } from "@/components/ui/Spinner";
import { useRequireAuth } from "@/lib/require-auth";

// useSearchParams (?version=) ต้องมี Suspense ครอบ ไม่งั้น build ของ Next ไม่ผ่าน
export default function LegalDocumentPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <Inner />
    </Suspense>
  );
}

function Inner() {
  const { organizationId, documentId } = useParams<{ organizationId: string; documentId: string }>();
  const versionId = useSearchParams().get("version");
  const { user, loading } = useRequireAuth();
  if (loading || !user) return <Spinner />;
  return (
    <LegalDocumentView
      organizationId={organizationId}
      documentId={documentId}
      versionId={versionId}
      base="/legal-documents"
      crumbs={[{ label: "เอกสารทางกฎหมาย", href: "/legal-documents" }]}
    />
  );
}
