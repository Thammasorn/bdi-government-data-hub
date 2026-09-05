import Image from "next/image";
import clsx from "clsx";

import logoDark from "./bdi-logo-sqr-dark.png";
import logoNormal from "./bdi-logo-sqr.png";

/**
 * โลโก้ทางการของ BDI — ใช้ไฟล์ภาพจาก CI ตรง ๆ
 *
 * ก่อนหน้านี้ไฟล์นี้เป็น SVG ที่คัดพิกัดมาจาก `assets/theme_ci_design/LOGO/SVG`
 * แล้ววาดเป็นคอมโพเนนต์ (เครื่องหมาย B) อย่างเดียว และเวอร์ชันแนวนอนพร้อมชื่อไทย)
 * ตั้งแต่ 2026-09-05 การ์ด "แก้ชื่อองค์กรและโลโก้" สั่งให้ทุกที่ใช้โลโก้ทรงจัตุรัส
 * พร้อมบรรทัดชื่อองค์กร ซึ่ง CI ส่งมาเป็น PNG — เวอร์ชัน SVG จึงถูกถอดออกทั้งคู่
 * (หาได้จากประวัติ git ถ้าวันหนึ่งต้องใช้เครื่องหมายเปล่า ๆ อีก)
 */

/**
 * โลโก้จัตุรัสพร้อมชื่อองค์กร — ไฟล์จริงจาก CI ไม่ใช่ SVG ที่วาดตาม
 *
 * `assets/theme_ci_design/LOGO/1x/sqr-logo-normal-with-label.png` และคู่สำหรับพื้นเข้ม
 * คัดลอกมาไว้ข้างคอมโพเนนต์ แล้ว import ตรง ๆ แทนการอ้าง path ใน `public/` ด้วยเหตุผล
 * เดียวกับแผนภาพในหน้าแรก: Next ใส่ content hash ให้เอง จึงไม่เสิร์ฟรูปเก่าที่แคชไว้
 * ต่อเมื่อเปลี่ยนไฟล์ และอ่านความกว้าง/สูงจากไฟล์จริงจึงจองพื้นที่ถูกสัดส่วน
 *
 * โลโก้ทรงจัตุรัสสูงกว่าโลโก้แนวนอนของเดิมมาก ความสูงตั้งต้นจึงเป็น h-14 ไม่ใช่ h-7
 * มิฉะนั้นบรรทัด "BIG DATA INSTITUTE" ใต้เครื่องหมาย (สูงราวหนึ่งในสิบของภาพ)
 * จะเล็กจนอ่านไม่ออก — แถบหัวทั้งสองแบบถูกขยายตามไปด้วยด้วยเหตุผลเดียวกัน
 */
export function LogoImage({
  className,
  tone = "navy",
}: {
  className?: string;
  /** พื้นเข้มต้องใช้ไฟล์คนละใบ ไม่ใช่ฟิลเตอร์ — CI มีเวอร์ชันสำหรับพื้นเข้มมาให้แล้ว */
  tone?: "navy" | "white";
}) {
  return (
    <Image
      src={tone === "white" ? logoDark : logoNormal}
      alt="สถาบันข้อมูลขนาดใหญ่ (องค์การมหาชน)"
      priority
      className={clsx("w-auto", className ?? "h-14")}
    />
  );
}

export function Logo({
  className,
  subtitle = "Government Datahub",
  tone = "navy",
}: {
  className?: string;
  subtitle?: string | null;
  tone?: "navy" | "white";
}) {
  const white = tone === "white";
  return (
    <span className={clsx("inline-flex items-center gap-3", className)}>
      <LogoImage tone={tone} />
      {subtitle ? (
        <>
          <span aria-hidden="true" className={clsx("h-6 w-px", white ? "bg-white/30" : "bg-line")} />
          <span
            className={clsx(
              "text-[13px] font-medium leading-tight",
              white ? "text-white/75" : "text-ink-muted",
            )}
          >
            {subtitle}
          </span>
        </>
      ) : null}
    </span>
  );
}
