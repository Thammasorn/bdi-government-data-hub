import clsx from "clsx";

/** แถบความคืบหน้าข้างฟอร์มคำขอ — ใช้ร่วมกันทุกฟอร์มที่แบ่งเป็นส่วน */
export function FormStepper({
  sections,
  completion,
}: {
  sections: { id: string; tag: string; title: string }[];
  completion: Record<string, boolean>;
}) {
  return (
    <nav aria-label="ความคืบหน้า" className="hidden lg:block">
      <ol className="sticky top-24 flex flex-col gap-1">
        {sections.map((s, i) => {
          const done = completion[s.id];
          return (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                className="group flex items-start gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-white"
              >
                <span
                  className={clsx(
                    "mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-[12px] font-semibold transition-colors",
                    done ? "bg-success text-white" : "bg-navy-100 text-navy-600",
                  )}
                >
                  {done ? (
                    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
                      <path d="m4 8.5 2.6 2.6L12 5.6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : (
                    i + 1
                  )}
                </span>
                <span className="flex flex-col leading-tight">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-coral-500">{s.tag}</span>
                  <span className="text-sm font-medium text-ink">{s.title}</span>
                  <span className="mt-0.5 text-[12px] text-ink-muted">{done ? "กรอกครบแล้ว" : "ยังไม่ครบ"}</span>
                </span>
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
