import type { Metadata } from "next";

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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th" className={`${prompt.variable} ${sarabun.variable}`}>
      <body>
        <SessionProvider>
          <ToastProvider>
            <AppShell>{children}</AppShell>
          </ToastProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
