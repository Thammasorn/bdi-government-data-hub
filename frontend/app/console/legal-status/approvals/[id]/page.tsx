"use client";

import { useParams } from "next/navigation";

import { LegalApprovalView } from "@/components/legal/LegalApprovalView";

export default function ConsoleLegalApprovalPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <LegalApprovalView
      approvalId={id}
      base="/console/legal-status"
      crumbs={[{ label: "สถานะเอกสารทางกฎหมายของหน่วยงาน", href: "/console/legal-status" }]}
    />
  );
}
