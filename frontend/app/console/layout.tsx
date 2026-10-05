"use client";

import { Suspense, type ReactNode } from "react";

import { ConsoleShell } from "@/components/console/ConsoleShell";
import { Spinner } from "@/components/ui/Spinner";

/**
 * หน้าผู้ดูแลระบบ (การ์ด Admin Console 2026-10-05) — ทุกอย่างที่เคยทำได้แค่ผ่าน /api/admin/* ด้วย Postman
 *
 * Suspense ครอบไว้ที่นี่ที่เดียว: หน้ารายการทุกหน้าอ่านตัวกรองจาก query string ด้วย `useSearchParams()` ซึ่ง `next build`
 * บังคับให้มี Suspense ครอบ (ผ่าน tsc และ next dev แต่ล้มตอน production build — ดู app/admin/organizations/page.tsx)
 */
export default function ConsoleLayout({ children }: { children: ReactNode }) {
  return (
    <ConsoleShell>
      <Suspense fallback={<Spinner />}>{children}</Suspense>
    </ConsoleShell>
  );
}
