import clsx from "clsx";

/**
 * เครื่องหมาย BD ของ BDI สร้างใหม่เป็น SVG ตามสัดส่วนในหน้า construction grid
 * ของ assets/theme_ci_design/logo-final.ai (แท่ง X, โบว์ 1⅓X, D 1⅔X, สูง 4X, จุดมุมขวาบน)
 */
export function LogoMark({ className, dotClassName }: { className?: string; dotClassName?: string }) {
  return (
    <svg viewBox="0 0 104 84" fill="none" className={className} role="presentation" aria-hidden="true">
      <g fill="currentColor">
        <rect x="0" y="4" width="20" height="80" />
        <path d="M20 4h6a20 20 0 0 1 0 40h-6z" />
        <path d="M20 44h6a20 20 0 0 1 0 40h-6z" />
        <path d="M52 4h6a40 40 0 0 1 0 80h-6z" />
      </g>
      <circle cx="94" cy="13" r="10" className={clsx("fill-coral-500", dotClassName)} />
    </svg>
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
  return (
    <span className={clsx("inline-flex items-center gap-2.5", className)}>
      <LogoMark
        className={clsx("h-7 w-auto", tone === "white" ? "text-white" : "text-navy-800")}
        dotClassName={tone === "white" ? "fill-coral-300" : undefined}
      />
      <span className="flex flex-col leading-none">
        <span
          className={clsx(
            "font-display text-[15px] font-semibold tracking-tight",
            tone === "white" ? "text-white" : "text-navy-800",
          )}
        >
          BDI
        </span>
        {subtitle ? (
          <span
            className={clsx(
              "mt-0.5 text-[11px] font-medium",
              tone === "white" ? "text-white/70" : "text-ink-muted",
            )}
          >
            {subtitle}
          </span>
        ) : null}
      </span>
    </span>
  );
}
