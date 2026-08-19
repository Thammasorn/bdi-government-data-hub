"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

import { useSession } from "@/components/SessionProvider";

/**
 * ปลายทางหลังล็อกอินที่รับได้ — ต้องเป็น path ภายในเว็บนี้เท่านั้น
 *
 * ค่านี้มาจาก query string ซึ่งใครก็ใส่มาได้ ถ้ารับดื้อ ๆ ลิงก์
 * `/login?next=https://evil.example` จะกลายเป็นช่องทางพาผู้ใช้ออกไปเว็บอื่น
 * ทั้งที่เพิ่งกรอกรหัสผ่านบนโดเมนของเรา (open redirect)
 *
 * "//host" กับ "/\host" ก็เป็นโดเมนอื่นเหมือนกันในสายตาเบราว์เซอร์ แม้จะขึ้นต้น
 * ด้วย "/" จึงต้องดูอักขระตัวที่สองด้วย ไม่ใช่แค่ตัวแรก
 */
export function safeNextPath(raw: string | null | undefined): string | null {
  if (!raw || !raw.startsWith("/")) return null;
  if (raw[1] === "/" || raw[1] === "\\") return null;
  return raw;
}

/** `/login` ที่จำไว้ว่าผู้ใช้ตั้งใจจะไปหน้าไหน */
export function loginHref(next: string | null): string {
  const safe = safeNextPath(next);
  return safe ? `/login?next=${encodeURIComponent(safe)}` : "/login";
}

/** ปลายทางที่ฝากไว้ตอนถูกเด้งมาหน้าล็อกอิน — อ่านตอนล็อกอินสำเร็จ */
export function nextFromLocation(): string | null {
  if (typeof window === "undefined") return null;
  return safeNextPath(new URLSearchParams(window.location.search).get("next"));
}

/**
 * หน้าไหนที่ไม่มีอะไรให้ดูเลยถ้ายังไม่ล็อกอิน ให้เรียกฮุกนี้
 *
 * ลิงก์ในอีเมลทุกฉบับชี้ตรงเข้าหน้ารายละเอียด (เช่น ปุ่ม "ตรวจสอบและลงนาม")
 * ผู้รับที่ยังไม่ได้ล็อกอินจึงมาถึงหน้านั้นก่อนเสมอ เดิมหน้าเหล่านี้เขียนไว้ว่า
 * `if (!org || !user) return <Spinner />` ซึ่งเป็นจริงตลอดกาลเมื่อไม่มี session:
 * API ตอบ 401 ข้อมูลจึงไม่มีวันมา และ user ก็เป็น null อยู่อย่างนั้น
 * ผลคือหน้าหมุนค้างไม่จบ ไม่ได้พาไปล็อกอินให้ — ต้องเดาเองว่าต้องกดปุ่ม
 * "เข้าสู่ระบบ" มุมขวาบน แล้วยังต้องหาทางกลับมาหน้านี้เองอีก
 *
 * เด้งไป `/login?next=<หน้านี้>` แทน แล้วหน้าล็อกอินจะพากลับมาที่เดิมให้เอง
 *
 * อ่าน query string จาก `window.location` ไม่ใช่ `useSearchParams()` โดยตั้งใจ —
 * ฮุกนี้ถูกเรียกจากหน้าที่เป็น dynamic route ทุกหน้า การใช้ `useSearchParams()`
 * บังคับให้ทุกหน้าต้องมี <Suspense> ครอบ ไม่งั้น build ไม่ผ่าน ส่วนโค้ดตรงนี้
 * รันใน effect ซึ่งเกิดหลัง mount แล้ว `window` จึงมีแน่นอน
 */
export function useRequireAuth() {
  const { user, loading } = useSession();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (loading || user) return;
    router.replace(loginHref(`${pathname}${window.location.search}`));
  }, [loading, user, pathname, router]);

  /**
   * `ready` = ล็อกอินแล้วจริง ๆ เท่านั้น ระหว่างที่ยังไม่รู้ผล (หรือกำลังจะถูกเด้ง)
   * หน้าเรียกใช้ควรแสดง spinner ไปก่อน — ไม่ใช่แสดงหน้าเปล่าให้เห็นแวบหนึ่ง
   */
  return { user, loading, ready: !loading && Boolean(user) };
}
