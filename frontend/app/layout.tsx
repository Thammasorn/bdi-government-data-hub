import type { Metadata } from "next";
import { cookies } from "next/headers";

import { AppShell } from "@/components/AppShell";
import { SessionProvider } from "@/components/SessionProvider";
import { ToastProvider } from "@/components/ui/Toast";

import { prompt, sarabun } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Government Datahub Platform",
    template: "%s · Government Datahub",
  },
  description: "แพลตฟอร์มรวบรวมข้อมูลจากหน่วยงานรัฐ โดยสถาบันข้อมูลขนาดใหญ่ (องค์การมหาชน)",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // ชื่อคุกกี้ตรงกับ SESSION_COOKIE ใน backend/src/lib/auth.ts
  const hasSessionCookie = (await cookies()).has("bdi_session");

  return (
    <html lang="th" className={`${prompt.variable} ${sarabun.variable}`}>
      <body>
        <SessionProvider hasSessionCookie={hasSessionCookie}>
          <ToastProvider>
            <AppShell>{children}</AppShell>
          </ToastProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
