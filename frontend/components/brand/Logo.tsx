import Image from "next/image";
import clsx from "clsx";

import logoDark from "./bdi-logo-sqr-dark.png";
import logoNormal from "./bdi-logo-sqr.png";
import d2Dark from "./d2-logo-white.png";
import d2Normal from "./d2-logo.png";

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
 * (`sqr-logo-white-with-label.png` — ดูคอมเมนต์ของ tone ข้างล่าง)
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
  /**
   * พื้นเข้มต้องใช้ไฟล์คนละใบ ไม่ใช่ฟิลเตอร์ — CI มีเวอร์ชันสำหรับพื้นเข้มมาให้แล้ว
   *
   * ใช้ `sqr-logo-white-with-label.png` ไม่ใช่ `-for-dark-bg-` ที่การ์ดระบุไว้ตอนแรก:
   * ตัว `-for-dark-bg-` เป็นโทนคอรัล แต่ที่เดียวที่ใช้มันคือ aside ของหน้า auth ซึ่งพื้น
   * ไล่สีจากคอรัลไปกรมท่า โลโก้จึงไปตกบนคอรัลพอดีและแทบมองไม่เห็น (ดูภาพเทียบใน
   * sit-evidence/logo-20260905/) เวอร์ชันขาวอ่านออกตลอดช่วงไล่สี
   */
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

/**
 * เครื่องหมาย D2 — โลโก้ของตัวระบบ ต่างจาก `LogoImage` ที่เป็นโลโก้ของสถาบัน
 *
 * `assets/theme_ci_design/D2 logo/Logo_DII_Color.png` (พื้นขาว) และ `Logo_DII_White.png`
 * (พื้นเข้ม) คัดลอกมาไว้ข้างคอมโพเนนต์แล้ว import ตรง ๆ ด้วยเหตุผลเดียวกับโลโก้สถาบัน
 * ตั้งแต่ 2026-09-18 การ์ด "ใช้โลโก้ D2 แทนคำว่า D2" สั่งให้ทุกที่ที่เคยพิมพ์คำว่า `D2`
 * เดี่ยว ๆ เป็นเครื่องหมายแบรนด์ (ข้างโลโก้สถาบันบนแถบหัวและ footer) ใช้ภาพนี้แทน —
 * `D2` ที่เป็นคำในประโยค (`<title>`, aria-label, เนื้อหา) ยังเป็นตัวหนังสือเหมือนเดิม
 *
 * ไฟล์เป็นจัตุรัส 1001×1001 มีขอบว่างรอบตัวอักษรราว 4% บน-ล่าง และ 9% ซ้าย-ขวา
 * ความสูงตั้งต้นเคยเป็น h-12 ให้ตัวอักษรสูงราวเท่าเครื่องหมาย B ของโลโก้สถาบันที่ h-14 —
 * แต่พอวางจริงมันเด่นกว่าโลโก้สถาบันที่ยืนอยู่ข้าง ๆ การ์ด "Adjust D2 logo and Navbar"
 * (2026-09-18) จึงให้ลดเหลือราว 75% → h-9 (36px) ทุกที่ที่มันอยู่ข้างโลโก้สถาบัน
 */
export function D2Mark({
  className,
  tone = "navy",
}: {
  className?: string;
  tone?: "navy" | "white";
}) {
  return (
    <Image
      src={tone === "white" ? d2Dark : d2Normal}
      alt="D2"
      priority
      className={clsx("w-auto", className ?? "h-9")}
    />
  );
}

/**
 * โลโก้สถาบัน + เครื่องหมาย D2 + ชื่อระบบ — ใช้บนแถบหัวและ footer ในระบบ
 *
 * ชื่อระบบตั้งต้นไม่มี `(D2)` ต่อท้ายแล้ว เพราะเครื่องหมาย D2 อยู่ข้าง ๆ พอดี
 * พิมพ์ซ้ำจะอ่านเป็น "D2 ระบบกลาง… (D2)"
 *
 * แถบหัวหลังล็อกอินไม่แสดงชื่อระบบอีกแล้ว (การ์ด "Adjust D2 logo and Navbar" 2026-09-18) —
 * โลโก้สองอันบอกอยู่แล้วว่านี่คือระบบอะไร และชื่อยาวราวเท่าป้ายเมนูสองป้าย ที่ยังแสดงคือ
 * หน้า login บนจอแคบ ซึ่งไม่มีเมนูมาเบียด จึงไม่ต้องมี prop ซ่อนตาม breakpoint อีก
 */
export function Logo({
  className,
  subtitle = "ระบบกลางเพื่อการแบ่งปันข้อมูลดิจิทัล",
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
      <D2Mark tone={tone} />
      {subtitle ? (
        <span className="inline-flex items-center gap-3">
          <span aria-hidden="true" className={clsx("h-6 w-px", white ? "bg-white/30" : "bg-line")} />
          <span
            className={clsx(
              "text-[13px] font-medium leading-tight",
              white ? "text-white/75" : "text-ink-muted",
            )}
          >
            {subtitle}
          </span>
        </span>
      ) : null}
    </span>
  );
}
