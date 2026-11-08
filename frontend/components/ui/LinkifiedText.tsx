import { Fragment } from "react";

/**
 * ข้อความธรรมดาที่ URL `http(s)://…` กดได้ — ความเห็นของผู้เชี่ยวชาญที่คัดลอกจาก Jira มีลิงก์ไปการ์ด (การ์ด "[Enhance] JIRA integration")
 * และความเห็นที่พิมพ์ในระบบก็อาจมีลิงก์
 *
 * แยกด้วย regex แล้ววาดเป็น `<a>` เอง ไม่ใช้ `dangerouslySetInnerHTML` — ข้อความมาจากผู้ใช้และจาก Jira จึงต้องไม่ถูกตีความเป็น HTML
 * เครื่องหมายวรรคตอนท้าย URL (`.` `,` `)` …) ไม่นับเป็นส่วนของลิงก์ ผู้เรียกยังเป็นคนกำหนด `whitespace-pre-wrap` ของกล่องเอง
 */
const URL_PATTERN = /(https?:\/\/[^\s<>"]+)/g;
const TRAILING = /[.,;:!?)\]}'"]+$/;

export function LinkifiedText({ text }: { text: string }) {
  const parts = text.split(URL_PATTERN);
  return (
    <>
      {parts.map((part, i) => {
        // split ด้วยกลุ่มจับ — ช่องเลขคี่คือ URL
        if (i % 2 === 0) return <Fragment key={i}>{part}</Fragment>;
        const trailing = part.match(TRAILING)?.[0] ?? "";
        const url = trailing ? part.slice(0, -trailing.length) : part;
        return (
          <Fragment key={i}>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="break-all font-medium text-navy-700 underline hover:text-navy-900"
            >
              {url}
            </a>
            {trailing}
          </Fragment>
        );
      })}
    </>
  );
}
