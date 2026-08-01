"use client";

import { useParams } from "next/navigation";

import { OrganizationDetailView } from "@/components/organization/DetailView";

export default function OrganizationPage() {
  const { id } = useParams<{ id: string }>();
  return <OrganizationDetailView id={id} />;
}
