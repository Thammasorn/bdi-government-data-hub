"use client";

import { useParams } from "next/navigation";

import { OrganizationDetailView } from "@/components/organization/DetailView";

export default function AdminOrganizationPage() {
  const { id } = useParams<{ id: string }>();
  return <OrganizationDetailView id={id} backHref="/admin/organizations" />;
}
