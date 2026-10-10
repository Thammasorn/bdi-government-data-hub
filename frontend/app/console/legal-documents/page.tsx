"use client";

import clsx from "clsx";
import Link from "next/link";
import { useState } from "react";

import { Badge, ErrorNotice, PageHeader, Panel } from "@/components/console/ui";
import { Spinner } from "@/components/ui/Spinner";
import { useToast } from "@/components/ui/Toast";
import { adminErrorView } from "@/lib/admin-errors";
import { api } from "@/lib/api";
import {
  ACTIVE_META,
  INACTIVE_META,
  SCOPE_ORDER,
  SCOPE_TITLES,
  type LegalDocument,
  type LegalScope,
} from "@/lib/legal-admin";
import { useAdminData } from "@/lib/use-admin";

/**
 * เอกสารข้อตกลง (A0–A3), แบบนำส่งข้อมูล (A4) และเอกสารที่เพิ่มเอง — หมวด "ตั้งค่าเอกสาร"
 *
 * หน้านี้เป็นรายการ: ชื่อเอกสาร แก้ไข และจัดลำดับ (card "Enhance Legal document management" ข้อ 2) ทุกอย่างของเอกสารหนึ่งฉบับ —
 * ข้อมูลประจำตัว เปิด/ปิดใช้ อัปโหลดเวอร์ชันใหม่ ประวัติเวอร์ชัน — อยู่ที่หน้าแก้ไข `/console/legal-documents/:code` เอกสารที่ปิดใช้แยกเป็นกลุ่มของตัวเองใต้กลุ่มที่ใช้งาน
 * (ยังแก้และอัปโหลดเวอร์ชันได้ และเปิดใช้กลับมาได้) ลำดับจัดแยกในแต่ละกลุ่ม แล้วส่งทั้งหมวดไปบันทึกทีเดียว — มีผลกับคำขอที่นำส่งจากนี้ไปเท่านั้น
 */
export default function ConsoleLegalDocumentsPage() {
  const { data, error, loading, reload } = useAdminData<{ documents: LegalDocument[] }>("/api/admin/legal-documents");
  const [moving, setMoving] = useState(false);
  const { show } = useToast();

  if (loading && !data) return <Spinner />;
  if (error && !data) return <ErrorNotice view={adminErrorView(error)} />;
  if (!data) return null;

  /** สลับตำแหน่งในกลุ่มเดียวกัน แล้วส่งลำดับทั้งหมวด (ที่ใช้งานก่อน ตามด้วยที่ปิดใช้) — ตรงกับที่เห็นบนหน้าจอ */
  const move = async (scope: LegalScope, group: LegalDocument[], index: number, dir: -1 | 1) => {
    const other = group[index + dir];
    const current = group[index];
    if (!other || !current) return;
    const swapped = group.slice();
    swapped[index] = other;
    swapped[index + dir] = current;
    const all = data.documents.filter((d) => d.scope === scope);
    const active = (swapped[0]?.isActive ? swapped : all.filter((d) => d.isActive)).map((d) => d.code);
    const inactive = (swapped[0]?.isActive ? all.filter((d) => !d.isActive) : swapped).map((d) => d.code);
    setMoving(true);
    try {
      await api.put("/api/admin/legal-documents/order", { scope, codes: [...active, ...inactive] });
      reload();
    } catch (err) {
      show({ tone: "error", title: "จัดลำดับไม่สำเร็จ", detail: adminErrorView(err).message });
    } finally {
      setMoving(false);
    }
  };

  const rows = (scope: LegalScope, group: LegalDocument[]) => (
    <ul className="divide-y divide-line">
      {group.map((doc, i) => (
        <li key={doc.code} className={clsx("flex flex-wrap items-center gap-3 px-5 py-4", !doc.isActive && "bg-canvas/70")}>
          <div className="flex shrink-0 flex-col">
            <button
              type="button"
              aria-label="เลื่อนขึ้น"
              disabled={i === 0 || moving}
              onClick={() => void move(scope, group, i, -1)}
              className="rounded px-1.5 text-ink-muted hover:bg-navy-50 disabled:opacity-25"
            >
              ▲
            </button>
            <button
              type="button"
              aria-label="เลื่อนลง"
              disabled={i === group.length - 1 || moving}
              onClick={() => void move(scope, group, i, 1)}
              className="rounded px-1.5 text-ink-muted hover:bg-navy-50 disabled:opacity-25"
            >
              ▼
            </button>
          </div>
          <p className={clsx("min-w-0 flex-1 font-medium", doc.isActive ? "text-ink" : "text-ink-muted")}>{doc.name}</p>
          <div className="flex flex-wrap items-center gap-1">
            <Link
              href={`/console/legal-documents/${encodeURIComponent(doc.code)}`}
              className="inline-flex h-9 items-center rounded-full px-4 text-sm font-medium text-navy-700 hover:bg-navy-50"
            >
              แก้ไข
            </Link>
          </div>
        </li>
      ))}
    </ul>
  );

  return (
    <div>
      <PageHeader eyebrow="ตั้งค่าเอกสาร" title="เอกสารข้อตกลง" />

      <div className="space-y-6">
        {SCOPE_ORDER.map((scope) => {
          const docs = data.documents.filter((d) => d.scope === scope).sort((a, b) => a.displayOrder - b.displayOrder);
          const active = docs.filter((d) => d.isActive);
          const inactive = docs.filter((d) => !d.isActive);
          return (
            <Panel
              key={scope}
              title={SCOPE_TITLES[scope]}
              actions={
                <Link
                  href={`/console/legal-documents/new/${scope}`}
                  className="inline-flex h-9 items-center justify-center rounded-full border border-line bg-white px-4 text-sm font-medium text-navy-800 hover:bg-navy-50"
                >
                  เพิ่มเอกสาร
                </Link>
              }
              flush
            >
              <GroupHeading meta={ACTIVE_META} count={active.length} />
              {active.length === 0 ? (
                <p className="px-5 py-6 text-center text-[14px] text-ink-muted">ยังไม่มีเอกสารที่ใช้งานในหัวข้อนี้</p>
              ) : (
                rows(scope, active)
              )}
              {inactive.length > 0 ? (
                <>
                  <GroupHeading meta={INACTIVE_META} count={inactive.length} className="border-t" />
                  {rows(scope, inactive)}
                </>
              ) : null}
            </Panel>
          );
        })}
      </div>

    </div>
  );
}

/** หัวกลุ่ม "ใช้งาน" / "ปิดใช้" — แถบสีจางคั่นให้เห็นชัดว่าสองกลุ่มต่างกัน (จัดลำดับได้เฉพาะภายในกลุ่ม) */
function GroupHeading({
  meta,
  count,
  className,
}: {
  meta: { label: string; className: string };
  count: number;
  className?: string;
}) {
  return (
    <div className={clsx("flex items-center gap-2 border-b border-line bg-navy-50/60 px-5 py-2", className)}>
      <Badge meta={meta} />
      <span className="text-[13px] text-ink-muted">{count} ฉบับ</span>
    </div>
  );
}
