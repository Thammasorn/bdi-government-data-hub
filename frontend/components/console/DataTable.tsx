"use client";

import clsx from "clsx";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

import { Pagination } from "@/components/list/Pagination";
import { SkeletonRows } from "@/components/ui/Spinner";

import { EmptyState } from "./ui";

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  className?: string;
}

/**
 * ตารางของหน้ารายการใน /console — กดแถวไหนก็ได้เพื่อเปิดรายละเอียด
 *
 * ทั้งแถวกดได้ด้วยเมาส์ (`rowHref`) ส่วนคีย์บอร์ดและโปรแกรมอ่านจอใช้ลิงก์ในคอลัมน์แรกที่หน้าเป็นคนวาง — `<tr>` เป็นลิงก์
 * ไม่ได้ และห่อทั้งแถวด้วย `<a>` ก็ไม่ใช่ HTML ที่ถูก จอแคบเลื่อนตารางในกรอบของมันเอง หน้าไม่เลื่อนข้าง
 *
 * ปุ่มในแถว (`onClick` ที่ `stopPropagation`) ไม่พาไปหน้ารายละเอียด
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  rowHref,
  loading,
  empty,
  page,
  pageSize,
  total,
  onPage,
  onPageSize,
}: {
  columns: Column<T>[];
  rows: T[] | null;
  rowKey: (row: T) => string;
  rowHref?: (row: T) => string;
  loading: boolean;
  empty: ReactNode;
  page?: number;
  pageSize?: number;
  total?: number;
  onPage?: (page: number) => void;
  onPageSize?: (size: number) => void;
}) {
  const router = useRouter();
  const showSkeleton = loading && !rows;

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-[14px]">
          <thead>
            <tr className="border-b border-line bg-canvas/60 text-[12.5px] font-semibold text-ink-muted">
              {columns.map((c) => (
                <th key={c.key} scope="col" className={clsx("px-4 py-2.5 first:pl-5 last:pr-5", c.className)}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          {showSkeleton ? null : (
            <tbody className={clsx("divide-y divide-line", loading && "opacity-60 transition-opacity")}>
              {(rows ?? []).map((row) => (
                <tr
                  key={rowKey(row)}
                  onClick={rowHref ? () => router.push(rowHref(row)) : undefined}
                  className={clsx("align-top", rowHref && "cursor-pointer hover:bg-navy-50/50")}
                >
                  {columns.map((c) => (
                    <td key={c.key} className={clsx("px-4 py-3 first:pl-5 last:pr-5", c.className)}>
                      {c.cell(row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          )}
        </table>
      </div>
      {showSkeleton ? <SkeletonRows rows={6} /> : null}
      {!loading && rows && rows.length === 0 ? empty : null}
      {onPage && onPageSize && page && pageSize && total !== undefined && total > 0 ? (
        <div className="border-t border-line px-5 py-3">
          <Pagination
            info={{ page, pageSize, total, pageCount: Math.max(1, Math.ceil(total / pageSize)) }}
            onPage={onPage}
            pageSize={pageSize}
            onPageSize={onPageSize}
          />
        </div>
      ) : null}
    </div>
  );
}

export { EmptyState };
