"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { HomeSection, type SectionTone } from "@/components/home/HomeSection";
import { ApprovalStepsCompact } from "@/components/review/ApprovalSteps";
import { StatusBadge } from "@/components/ui/Card";
import { daysSince, formatThaiDate, isPendingDatasetStatus } from "@/lib/status";
import { organizationTitle, type OrganizationListItem } from "@/lib/types";

/**
 * หนึ่ง section ของรายการคำขอลงทะเบียนหน่วยงานบนหน้าแรก
 *
 * คู่แฝดของ `DatasetSection` — คอลัมน์เรียงเหมือนกันทุกช่อง เพื่อให้สอง section ที่วางซ้อนกัน
 * บนหน้าเดียวอ่านเป็นตารางเดียว ต่างกันแค่ช่องสุดท้าย: คำขอหน่วยงานไม่มีปุ่มดาวน์โหลด
 * เพราะเอกสารข้อตกลง A0 ถูกสร้างใหม่ทุกครั้งที่มีคนลงนาม และดึงเป็นรายใบจากหน้ารายละเอียด
 * (`OrganizationListItem` จึงไม่มี `generatedForm` ต่างจาก `DatasetRequestListItem`)
 */
export function OrganizationSection({
  title,
  description,
  rows,
  count,
  emptyText,
  tone = "plain",
  footer,
  basePath,
}: {
  title: string;
  description: string;
  rows: OrganizationListItem[];
  /** จำนวนจริงทั้งหมด — section แสดงแค่ไม่กี่แถวแรก `rows.length` จึงพูดแทนไม่ได้ */
  count?: number;
  emptyText: string;
  tone?: SectionTone;
  footer?: ReactNode;
  /** `/organizations` ฝั่งหน่วยงาน `/admin/organizations` ฝั่ง BDI */
  basePath: string;
}) {
  return (
    <HomeSection
      title={title}
      description={description}
      count={count ?? rows.length}
      empty={rows.length === 0}
      emptyText={emptyText}
      tone={tone}
      footer={footer}
    >
      <ul className="divide-y divide-line">
        {rows.map((row) => (
          <OrganizationRow key={row.id} row={row} basePath={basePath} />
        ))}
      </ul>
    </HomeSection>
  );
}

function OrganizationRow({ row, basePath }: { row: OrganizationListItem; basePath: string }) {
  // วันที่คำขอเข้ามา = วันที่นำส่ง ร่างที่ยังไม่ได้ส่งยังไม่มี จึงถอยไปใช้วันที่สร้าง
  const enteredAt = row.submittedAt ?? row.createdAt;
  const enteredLabel = row.submittedAt ? "นำส่งเมื่อ" : "สร้างร่างเมื่อ";
  // นับอายุเฉพาะคำขอที่ยังค้างอยู่ในสายพาน — ใบที่จบแล้วไม่ได้ "รอ" อะไรอีก
  const waiting =
    row.submittedAt && isPendingDatasetStatus(row.status) ? daysSince(row.submittedAt) : null;

  return (
    <li className="group relative grid grid-cols-1 items-center gap-3 px-6 py-4 transition-colors hover:bg-navy-50/50 md:grid-cols-[minmax(0,2.1fr)_15rem_minmax(0,1.1fr)_auto] md:gap-4">
      <div className="min-w-0">
        <Link
          href={`${basePath}/${row.id}`}
          // ครอบทั้งแถวเพื่อให้คลิกตรงไหนก็เข้าคำขอได้ ยกเว้นปุ่มที่ยกตัวเองขึ้นมาด้วย z-10
          className="before:absolute before:inset-0 before:content-[''] focus-visible:outline-none"
        >
          <span className="block truncate font-medium text-ink group-hover:text-navy-800">
            {organizationTitle(row)}
          </span>
        </Link>
        {/* เลขที่คำขอเท่านั้น เหมือนแถวชุดข้อมูลที่วางอยู่ถัดลงไป — รหัสหน่วยงาน
            (`ORG-2026-0001`) หน้าตาเกือบเหมือนเลขที่คำขอ (`ORG-REG-2026-0001`)
            สองสตริงนี้เรียงติดกันจึงอ่านเป็นการพิมพ์ซ้ำ ไม่ใช่ข้อมูลสองชิ้น
            ตารางของเจ้าหน้าที่แสดงรหัสหน่วยงานอยู่แล้วสำหรับคนที่ต้องใช้มัน */}
        <span className="mt-0.5 block truncate text-[13px] text-ink-muted">
          {row.requestNumber}
        </span>
      </div>

      <div className="min-w-0">
        <StatusBadge
          status={row.status}
          currentTaskType={row.currentTaskType}
          className="max-w-full"
        />
        {row.progress ? (
          // บอกทั้งว่าอยู่ขั้นไหนจากกี่ขั้น และขั้นต่อไปคืออะไร
          <div className="mt-1.5">
            <ApprovalStepsCompact progress={row.progress} />
          </div>
        ) : null}
      </div>

      <div className="text-[13px] leading-relaxed text-ink-muted">
        <div className="truncate">
          <span className="text-ink-subtle">{enteredLabel} </span>
          {formatThaiDate(enteredAt)}
        </div>
        <div className="truncate">
          <span className="text-ink-subtle">อัปเดตล่าสุด </span>
          {formatThaiDate(row.updatedAt)}
        </div>
        {waiting !== null && waiting >= 7 ? (
          <div className="mt-0.5 font-medium text-warning">รอมาแล้ว {waiting} วัน</div>
        ) : null}
      </div>

      <div className="z-10 flex shrink-0 items-center gap-2 justify-self-start md:justify-self-end">
        <Link
          href={`${basePath}/${row.id}`}
          className="rounded-full border border-line bg-white px-3.5 py-1.5 text-[13px] font-medium text-navy-700 transition-colors hover:bg-navy-50"
        >
          ดูรายละเอียด
        </Link>
      </div>
    </li>
  );
}
