"use client";

/** ฝัง PDF ที่ระบบสร้างไว้ในหน้า — ใช้ทั้งเส้นทางหน่วยงานและเส้นทางชุดข้อมูล */
export function PdfViewer({
  url,
  filename,
  title = "เอกสารที่ระบบสร้าง",
}: {
  url: string;
  filename?: string;
  title?: string;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-navy-50">
      <div className="flex items-center justify-between gap-3 border-b border-line bg-white px-4 py-2.5">
        <p className="truncate text-sm font-medium text-ink">{filename ?? title}</p>
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 rounded-full px-3 py-1.5 text-[13px] font-medium text-navy-700 transition-colors hover:bg-navy-50"
        >
          เปิดในแท็บใหม่
        </a>
      </div>
      <iframe src={url} title={title} className="h-[62vh] w-full bg-white" />
    </div>
  );
}
