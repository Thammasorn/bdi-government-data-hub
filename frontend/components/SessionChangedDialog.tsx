"use client";

import { usePathname } from "next/navigation";

import { useSession } from "@/components/SessionProvider";
import { Button } from "@/components/ui/Button";

/**
 * กล่องที่ขึ้นเมื่อแท็บนี้ไม่ได้เป็นตัวตนที่ backend ใช้จริงอีกต่อไป
 *
 * **ปิดไม่ได้โดยตั้งใจ** — ทั้งประเด็นของบั๊กนี้คือแท็บที่ยังใช้งานต่อได้ในนามที่ผิด
 * ชื่อบนหน้าจอบอกว่าเป็นผู้ดำเนินการของหน่วยงาน แต่ปุ่มที่กดถูกบันทึกในนามผู้มีอำนาจ
 * กระทำการแทน กล่องที่กด Esc ปิดแล้วทำงานต่อได้ ก็ไม่ได้แก้อะไรเลย จึงไม่ใช้
 * `Modal` ที่ปิดด้วย Esc และคลิกพื้นหลังได้
 *
 * ไม่ reload ให้เองเงียบ ๆ ด้วย — ผู้ใช้อาจกรอกฟอร์มลงทะเบียนหน่วยงานค้างอยู่
 * การโหลดใหม่จะล้างทิ้งโดยไม่มีใครบอก ปุ่มที่เขากดเองบอกเหตุผลได้ก่อน
 */
export function SessionChangedDialog() {
  const { changed } = useSession();
  const pathname = usePathname();

  if (!changed) return null;

  const signedOut = changed.nextName === null;

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center p-4 sm:items-center">
      <div className="absolute inset-0 bg-navy-900/50 frost-2" aria-hidden="true" />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={signedOut ? "เซสชันสิ้นสุดแล้ว" : "บัญชีที่ใช้งานเปลี่ยนไปแล้ว"}
        className="animate-in-up relative w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-pop"
      >
        <div className="bg-brand-gradient h-1" />
        <div className="px-6 pt-5">
          <h2 className="text-lg font-semibold text-navy-800">
            {signedOut ? "เซสชันสิ้นสุดแล้ว" : "บัญชีที่ใช้งานเปลี่ยนไปแล้ว"}
          </h2>
        </div>
        <div className="p-6">
          {signedOut ? (
            <p className="text-[15px] leading-relaxed text-ink">
              บัญชี <strong className="font-semibold">{changed.previousName}</strong> ออกจากระบบแล้ว
              หน้านี้จึงใช้งานต่อไม่ได้ กรุณาเข้าสู่ระบบอีกครั้ง
            </p>
          ) : (
            <p className="text-[15px] leading-relaxed text-ink">
              ขณะนี้เบราว์เซอร์นี้เข้าสู่ระบบในชื่อ{" "}
              <strong className="font-semibold">{changed.nextName}</strong> แล้ว บัญชี{" "}
              <strong className="font-semibold">{changed.previousName}</strong> ออกจากระบบเรียบร้อย
              สิ่งที่แสดงอยู่บนหน้านี้เป็นข้อมูลของบัญชีเดิม กรุณาโหลดหน้าใหม่ก่อนดำเนินการต่อ
            </p>
          )}
          <div className="mt-6 flex justify-end gap-3">
            {signedOut ? (
              <Button
                onClick={() => {
                  window.location.href = `/login?next=${encodeURIComponent(pathname)}`;
                }}
              >
                เข้าสู่ระบบ
              </Button>
            ) : (
              <>
                {/* หน้าที่เปิดค้างอยู่อาจไม่ใช่หน้าของสิทธิ์ใหม่ จึงมีทางออกไปหน้าแรกด้วย */}
                <Button variant="secondary" onClick={() => (window.location.href = "/")}>
                  ไปหน้าแรก
                </Button>
                {/*
                  โหลดทั้งหน้า ไม่ใช่ router.refresh() — layout เป็น server component ที่อ่าน
                  cookie เอง และ state ของหน้าเดิมทั้งหมดต้องถูกล้างจริง ไม่ใช่แค่ข้อมูลที่ fetch
                */}
                <Button onClick={() => window.location.reload()}>โหลดหน้านี้ใหม่</Button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
