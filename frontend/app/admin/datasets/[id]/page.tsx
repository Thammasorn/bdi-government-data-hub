"use client";

import { useParams } from "next/navigation";

import { DatasetDetailView } from "@/components/dataset/DetailView";

export default function AdminDatasetPage() {
  const { id } = useParams<{ id: string }>();
  return <DatasetDetailView id={id} backHref="/admin/datasets" />;
}
