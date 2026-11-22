"use client";

import { useParams } from "next/navigation";

import { LegalApprovalView } from "@/components/legal/LegalApprovalView";
import { Spinner } from "@/components/ui/Spinner";
import { useRequireAuth } from "@/lib/require-auth";

export default function LegalApprovalPage() {
  const { id } = useParams<{ id: string }>();
  const { user, loading } = useRequireAuth();
  if (loading || !user) return <Spinner />;
  return <LegalApprovalView approvalId={id} base="/legal-documents" crumbs={[{ label: "เอกสารทางกฎหมาย", href: "/legal-documents" }]} />;
}
