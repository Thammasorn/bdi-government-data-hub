"use client";

import { useParams } from "next/navigation";

import { ChangeRequestDetailView } from "@/components/representatives/DetailView";

/** คำขอหนึ่งใบใน /console — หน้ารายละเอียดเดียวกับของ BDI ผู้ดูแลระบบสั่งผ่าน admin API */
export default function ConsoleRepresentativeChangePage() {
  const { id } = useParams<{ id: string }>();
  return (
    // หน้ารายละเอียดวางขอบของตัวเอง เหมือนคำขอลงทะเบียนใน /console
    <div className="-mx-4 -mt-10 sm:-mx-6">
      <ChangeRequestDetailView id={id} />
    </div>
  );
}
