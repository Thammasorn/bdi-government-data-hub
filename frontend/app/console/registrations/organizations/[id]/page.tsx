"use client";

import { useParams } from "next/navigation";
import { useState } from "react";

import { RegistrationAdminPanel } from "@/components/console/RegistrationAdminPanel";
import { OrganizationDetailView } from "@/components/organization/DetailView";

/**
 * คำขอหนึ่งใบ — แถบคำสั่งของผู้ดูแลอยู่บน หน้ารายละเอียดตัวเดียวกับของเจ้าหน้าที่ BDI อยู่ล่าง
 *
 * หน้ารายละเอียดถือสถานะของตัวเองไว้ข้างใน หลังผู้ดูแลสั่งอะไรสำเร็จจึงสร้างมันใหม่ด้วย `key` แทนการรอ poll ของ
 * `use-request-watch` ซึ่งเดินทุก 15 วินาที — ผู้ดูแลต้องเห็นผลของคำสั่งตัวเองทันที
 */
export default function ConsoleRegistrationPage() {
  const { id } = useParams<{ id: string }>();
  const [version, setVersion] = useState(0);
  return (
    <div>
      <RegistrationAdminPanel kind="organizations" id={id} onChanged={() => setVersion((v) => v + 1)} />
      {/* หน้ารายละเอียดวางขอบของหน้าเต็มของมันเอง (max-w-4xl px-4 py-10) — หักขอบนั้นออกให้ชิดกับแถบคำสั่งข้างบน */}
      <div className="-mx-4 -mt-10 sm:-mx-6">
        <OrganizationDetailView key={version} id={id} backHref="/console/registrations/organizations" />
      </div>
    </div>
  );
}
