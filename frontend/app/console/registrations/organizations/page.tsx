"use client";

import { PageHeader } from "@/components/console/ui";
import { OrganizationRequestTable } from "@/components/organization/RequestTable";

/**
 * ตารางเดียวกับคิวของเจ้าหน้าที่ BDI (`/admin/organizations`) — API เปิดให้ผู้ดูแลระบบเห็นทุกคำขอ (`seesAllRequests()`) และ
 * แท็บ "ที่ต้องดำเนินการ" ว่างเสมอ เพราะผู้ดูแลไม่มีด่านของตัวเอง แถวพาไปหน้ารายละเอียดใต้ /console ที่มีคำสั่งของผู้ดูแล
 */
export default function ConsoleRegistrationList() {
  return (
    <div>
      <PageHeader
        eyebrow="หน่วยงานและคำขอ"
        title="คำขอลงทะเบียนหน่วยงาน"
        description="ทุกคำขอของทุกหน่วยงาน อ่านได้ทั้งหมดแต่ไม่มีปุ่มของด่านตรวจ — เปิดคำขอเพื่อแก้เนื้อ ปรับกลับเป็นฉบับร่าง หรือยกเลิกแทนหน่วยงาน"
      />
      <OrganizationRequestTable basePath="/console/registrations/organizations" />
    </div>
  );
}
