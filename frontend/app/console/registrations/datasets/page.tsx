"use client";

import { PageHeader } from "@/components/console/ui";
import { DatasetRequestTable } from "@/components/dataset/RequestTable";

/**
 * ตารางเดียวกับคิวของเจ้าหน้าที่ BDI (`/admin/datasets`) — API เปิดให้ผู้ดูแลระบบเห็นทุกคำขอ (`seesAllRequests()`) และ
 * แท็บ "ที่ต้องดำเนินการ" ว่างเสมอ เพราะผู้ดูแลไม่มีด่านของตัวเอง แถวพาไปหน้ารายละเอียดใต้ /console ที่มีคำสั่งของผู้ดูแล
 */
export default function ConsoleRegistrationList() {
  return (
    <div>
      <PageHeader
        eyebrow="คำขอ"
        title="คำขอส่งชุดข้อมูล"
        description="ทุกคำขอของทุกหน่วยงาน อ่านได้ทั้งหมดแต่ไม่มีปุ่มของด่านตรวจ — เปิดคำขอเพื่อแก้เนื้อ ปรับกลับเป็นฉบับร่าง ยกเลิก หรือลบออกจากระบบ"
      />
      <DatasetRequestTable
        basePath="/console/registrations/datasets"
        showOrganization
        emptyHint="ยังไม่มีคำขอส่งชุดข้อมูลที่ตรงกับตัวกรอง"
      />
    </div>
  );
}
