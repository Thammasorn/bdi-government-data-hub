/**
 * ไอคอนที่ใช้มากกว่าหนึ่งที่ — ระบบไม่มี icon library (package.json มีแค่ clsx/next/react) จึงวาดเป็น inline SVG
 * ตามแบบที่ Field.tsx ทำมาตลอด สีตาม `currentColor` ขนาดตาม `className`
 *
 * ลูกตาคู่นี้ใช้ทั้งปุ่มแสดง/ซ่อนรหัสผ่าน และปุ่มซ่อน/แสดงเอกสาร (feedback "features 1 full" แถว 2 และ 20)
 * ความหมายเดียวกันทั้งสองที่: ลูกตา = มองเห็นอยู่ ลูกตามีขีด = ซ่อนอยู่
 */

export function EyeIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M1.75 10S4.75 4.25 10 4.25 18.25 10 18.25 10 15.25 15.75 10 15.75 1.75 10 1.75 10Z" />
      <circle cx="10" cy="10" r="2.6" />
    </svg>
  );
}

export function EyeSlashIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8.2 4.45A8 8 0 0 1 10 4.25C15.25 4.25 18.25 10 18.25 10a14 14 0 0 1-2.4 3.2M5.6 5.65C3.1 7.2 1.75 10 1.75 10S4.75 15.75 10 15.75a7.9 7.9 0 0 0 4.4-1.4" />
      <path d="M8.15 8.2a2.6 2.6 0 0 0 3.65 3.65" />
      <path d="m2.5 2.5 15 15" />
    </svg>
  );
}

/**
 * ถังขยะเป็น SVG ไม่ใช่อักขระ — ฟอนต์ไทยดันเส้นฐานลงต่ำกว่าปุ่มเล็ก ๆ ทุกครั้ง
 * ตัวอักษรสัญลักษณ์ในปุ่มความสูงเท่านี้จึงลอยต่ำกว่าข้อความข้าง ๆ เสมอ
 */
export function TrashIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" fill="none">
      <path
        d="M4 7h16M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7m-9 0 .8 11.2A2 2 0 0 0 8.8 20h6.4a2 2 0 0 0 2-1.8L18 7M10 11v5m4-5v5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
