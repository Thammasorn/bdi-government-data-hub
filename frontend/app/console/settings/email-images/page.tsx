import { redirect } from "next/navigation";

/** รูปภาพในอีเมลย้ายไปเป็นแท็บของหน้าเทมเพลตอีเมล (feedback 2026-11-08) — ที่อยู่เดิมยังพาไปถูกที่ */
export default function EmailImagesRedirect() {
  redirect("/console/settings/email-templates?tab=images");
}
