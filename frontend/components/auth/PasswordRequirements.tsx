import clsx from "clsx";

import { PASSWORD_RULES } from "@/lib/password";

/**
 * ข้อกำหนดรหัสผ่านที่ติ๊กเองระหว่างพิมพ์
 *
 * แสดงทั้งห้าข้อตลอดเวลา ไม่ใช่โผล่มาเฉพาะข้อที่ยังไม่ผ่าน — คนตั้งรหัสผ่านต้องเห็น
 * ข้อกำหนดทั้งชุดก่อนเริ่มพิมพ์ ไม่ใช่ค่อย ๆ รู้ทีละข้อจากข้อความ error
 *
 * สถานะไม่ได้บอกด้วยสีอย่างเดียว (docs/02-ui-spec.md): ข้อที่ผ่านแล้วมีเครื่องหมายถูก
 * ข้อที่ยังไม่ผ่านเป็นวงกลมว่าง และมีข้อความสำหรับโปรแกรมอ่านหน้าจอกำกับทุกข้อ
 */
export function PasswordRequirements({ value }: { value: string }) {
  return (
    <ul className="flex flex-col gap-1.5 rounded-xl bg-canvas px-4 py-3">
      {PASSWORD_RULES.map((rule) => {
        const met = rule.test(value);
        return (
          <li
            key={rule.id}
            className={clsx(
              "flex items-start gap-2 text-[13px] leading-relaxed",
              met ? "text-success" : "text-ink-muted",
            )}
          >
            <span aria-hidden="true" className="mt-[3px] shrink-0">
              {met ? (
                <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <path d="m3 8.5 3.2 3.2L13 5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : (
                <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <circle cx="8" cy="8" r="4" />
                </svg>
              )}
            </span>
            <span>
              {rule.label}
              <span className="sr-only">{met ? " — ผ่านแล้ว" : " — ยังไม่ผ่าน"}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
