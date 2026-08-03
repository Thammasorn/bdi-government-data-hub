import { EVENT_LABELS, formatThaiDate } from "@/lib/status";

export interface OrgEvent {
  id: string;
  type: string;
  note: string | null;
  createdAt: string;
  actor: { firstName: string | null; lastName: string | null; email: string } | null;
}

/** ใช้ร่วมกับเส้นทางชุดข้อมูลได้ — ส่ง labels ของ event ชุดอื่นเข้ามาแทนได้ */
export function Timeline({
  events,
  labels = EVENT_LABELS,
}: {
  events: OrgEvent[];
  labels?: Record<string, string>;
}) {
  if (events.length === 0) {
    return <p className="px-6 py-5 text-sm text-ink-muted">ยังไม่มีประวัติการดำเนินการ</p>;
  }

  return (
    <ol className="flex flex-col px-6 py-5">
      {events.map((e, i) => {
        const actor = e.actor
          ? [e.actor.firstName, e.actor.lastName].filter(Boolean).join(" ") || e.actor.email
          : "ระบบ";
        const last = i === events.length - 1;
        return (
          <li key={e.id} className="relative flex gap-4 pb-5 last:pb-0">
            {!last ? (
              <span aria-hidden="true" className="absolute left-[7px] top-5 h-full w-px bg-line" />
            ) : null}
            <span
              aria-hidden="true"
              className={`relative mt-1.5 h-[15px] w-[15px] shrink-0 rounded-full border-[3px] border-white ${
                last ? "bg-coral-500" : "bg-navy-200"
              } ring-1 ring-line`}
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-ink">{labels[e.type] ?? e.type}</p>
              <p className="mt-0.5 text-[13px] text-ink-muted">
                {actor} · {formatThaiDate(e.createdAt)}
              </p>
              {e.note ? (
                <p className="mt-2 whitespace-pre-wrap rounded-lg bg-canvas px-3 py-2 text-[13px] leading-relaxed text-ink">
                  {e.note}
                </p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
