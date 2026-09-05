"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { HomeSection, type SectionTone } from "@/components/home/HomeSection";
import { ApprovalStepsCompact } from "@/components/review/ApprovalSteps";
import { DatasetStatusBadge } from "@/components/ui/Card";
import { api } from "@/lib/api";
import { datasetPendingOwner, daysSince, formatThaiDate, isPendingDatasetStatus } from "@/lib/status";
import { datasetTitle, type DatasetRequestListItem } from "@/lib/types";

/**
 * หนึ่ง section ของรายการคำขอลงทะเบียนชุดข้อมูลบนหน้าแรก
 *
 * ทุกแถวมีครบตามสเปก: ชื่อชุดข้อมูลที่ขอลงทะเบียน, สถานะ, วันเวลาที่นำเข้ามา,
 * วันเวลาที่อัปเดตล่าสุด และปุ่ม view / download
 *
 * แถวไม่ได้ทำเป็นปุ่มทั้งแถวเหมือนตารางในหน้า /datasets เพราะแถวนี้มีปุ่มของตัวเองอยู่ข้างใน
 * ซ้อน interactive element ในกันไม่ได้ — ชื่อชุดข้อมูลจึงเป็นลิงก์ที่ขยาย hit area เต็มช่อง
 */
export function DatasetSection({
  title,
  description,
  rows,
  count,
  emptyText,
  tone = "plain",
  footer,
  basePath = "/datasets",
}: {
  title: string;
  description: string;
  rows: DatasetRequestListItem[];
  /** จำนวนจริงทั้งหมด — section แสดงแค่ไม่กี่แถวแรก `rows.length` จึงพูดแทนไม่ได้ */
  count?: number;
  emptyText: string;
  tone?: SectionTone;
  footer?: ReactNode;
  /**
   * หน้ารายละเอียดที่แถวนี้พาไป — ฝั่งหน่วยงานคือ `/datasets` ฝั่ง BDI คือ `/admin/datasets`
   * สองหน้านั้นเป็นคอมโพเนนต์เดียวกัน ต่างกันแค่ปุ่มย้อนกลับและด่านที่กดได้ แต่หน้าที่
   * ผู้อ่านไม่มีสิทธิ์เข้าจะเด้งเขากลับ ลิงก์จึงต้องตรงกับฝั่งที่เขายืนอยู่
   */
  basePath?: string;
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
          <DatasetRow key={row.id} row={row} basePath={basePath} />
        ))}
      </ul>
    </HomeSection>
  );
}

function DatasetRow({ row, basePath }: { row: DatasetRequestListItem; basePath: string }) {
  const owner = datasetPendingOwner(row.status, row.currentTaskType);
  // วันที่นำข้อมูลเข้ามา = วันที่นำส่งคำขอ ร่างที่ยังไม่ได้ส่งยังไม่มี จึงถอยไปใช้วันที่สร้าง
  const enteredAt = row.submittedAt ?? row.createdAt;
  const enteredLabel = row.submittedAt ? "นำส่งเมื่อ" : "สร้างร่างเมื่อ";
  // นับอายุเฉพาะคำขอที่ยังค้างอยู่ในสายพาน — คำขอที่อนุมัติหรือไม่อนุมัติแล้วไม่ได้ "รอ" อะไรอีก
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
            {datasetTitle(row)}
          </span>
        </Link>
        <span className="mt-0.5 block truncate text-[13px] text-ink-muted">{row.requestNumber}</span>
      </div>

      <div className="min-w-0">
        <DatasetStatusBadge
          status={row.status}
          currentTaskType={row.currentTaskType}
          shortLabel={row.progress?.currentShortLabel}
          waitingLabel={row.progress?.currentLabel}
          className="max-w-full"
        />
        {row.progress ? (
          // แทนที่ประโยค "รอใคร" เดิม — บอกทั้งว่าอยู่ขั้นไหนจากกี่ขั้นและขั้นต่อไปคืออะไร
          <div className="mt-1.5">
            <ApprovalStepsCompact progress={row.progress} />
          </div>
        ) : owner ? (
          // ปล่อยให้ตัดบรรทัดได้ ข้อความบอกด่านยาวกว่าความกว้างคอลัมน์ ตัดท้ายทิ้งแล้วอ่านไม่รู้เรื่อง
          <span className="mt-1 block text-[12.5px] leading-snug text-ink-muted">{owner}</span>
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
        {row.generatedForm ? (
          <a
            href={api.fileUrl(
              `/api/dataset-requests/${row.id}/attachments/${row.generatedForm.id}?download=1`,
            )}
            download={row.generatedForm.filename}
            className="rounded-full border border-line bg-white px-3.5 py-1.5 text-[13px] font-medium text-navy-700 transition-colors hover:bg-navy-50"
          >
            ดาวน์โหลด
          </a>
        ) : (
          // ปุ่มยังอยู่แม้กดไม่ได้ พร้อมบอกว่าติดอะไร — ซ่อนแล้วผู้ใช้จะไม่รู้ว่าต้องทำอะไรต่อ
          <span
            title="ยังไม่มีเอกสาร — จะดาวน์โหลดได้เมื่อกดตรวจสอบและสร้าง PDF แล้ว"
            aria-label="ยังไม่มีเอกสารให้ดาวน์โหลด"
            className="cursor-not-allowed rounded-full border border-line px-3.5 py-1.5 text-[13px] font-medium text-ink-subtle opacity-60"
          >
            ดาวน์โหลด
          </span>
        )}
      </div>
    </li>
  );
}

/** จำนวนวันเต็มนับจากเวลาที่ให้มาถึงตอนนี้ */
