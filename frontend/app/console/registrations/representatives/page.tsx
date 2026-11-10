"use client";

import { Suspense } from "react";

import { PageHeader } from "@/components/console/ui";
import { ChangeRequestTable } from "@/components/representatives/RequestTable";
import { CONSOLE_LIST } from "@/components/representatives/DetailView";
import { Spinner } from "@/components/ui/Spinner";

/**
 * คำขอเปลี่ยนแปลงผู้แทนของทุกหน่วยงาน — ตารางเดียวกับของ BDI (`/representatives/requests`)
 *
 * แท็บ "ที่ต้องดำเนินการ" ไม่ขึ้น เพราะผู้ดูแลระบบไม่ได้ถือด่านไหน ตารางอ่านตัวกรองจาก query string จึงต้องอยู่ใน Suspense
 */
export default function ConsoleRepresentativeChangeList() {
  return (
    <div>
      <PageHeader
        eyebrow="คำขอ"
        title="คำขอเปลี่ยนแปลงผู้แทนหน่วยงาน"
        description="คำขอเพิ่มและยกเลิกผู้ประสานงานและผู้มีอำนาจของทุกหน่วยงาน"
      />
      <Suspense fallback={<Spinner />}>
        <ChangeRequestTable basePath={CONSOLE_LIST} />
      </Suspense>
    </div>
  );
}
