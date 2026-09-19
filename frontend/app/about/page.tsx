import type { Metadata } from "next";

import { LandingPage } from "@/components/landing/LandingPage";

export const metadata: Metadata = { title: "ข้อมูลโครงการ" };

/**
 * ข้อมูลโครงการ — ปลายทางของเมนูที่ทุกบทบาทเห็นหลังล็อกอิน
 *
 * เนื้อหาคือหน้าแนะนำโครงการชุดเดียวกับหน้าแรกของคนนอก ไม่ได้ลอกมาไว้สองที่: ถ้าฝ่ายสื่อสาร
 * แก้ถ้อยคำใน `components/landing/content.ts` ทั้งสองหน้าก็เปลี่ยนตามพร้อมกัน ที่ต่างกันคือ
 * แถบหัวกับ footer ซึ่งหน้านี้ยกให้ AppShell ทำ (ดู `variant` ใน LandingPage)
 *
 * ไม่ได้บังคับให้ล็อกอิน — คนที่ยังไม่ได้ล็อกอินเปิดลิงก์นี้ตรง ๆ ก็อ่านได้ แค่ได้แถบหัวแบบ
 * มีปุ่มเข้าสู่ระบบแทน ไม่มีอะไรในหน้านี้เป็นข้อมูลของผู้ใช้
 */
export default function AboutPage() {
  return <LandingPage variant="embedded" />;
}
