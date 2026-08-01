import clsx from "clsx";

export function Spinner({ className }: { className?: string }) {
  return (
    <div className={clsx("grid min-h-[60vh] place-items-center", className)}>
      <svg viewBox="0 0 24 24" className="h-7 w-7 animate-spin text-navy-300" aria-label="กำลังโหลด">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" fill="none" opacity=".3" />
        <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      </svg>
    </div>
  );
}

/** โครงร่างระหว่างโหลด — ใช้แทน spinner ในตาราง เพื่อไม่ให้จอกระพริบ */
export function SkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="divide-y divide-line">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-6 py-4">
          <div className="h-4 flex-1 animate-pulse rounded bg-navy-50" />
          <div className="h-4 w-40 animate-pulse rounded bg-navy-50" />
          <div className="h-6 w-32 animate-pulse rounded-full bg-navy-50" />
        </div>
      ))}
    </div>
  );
}
