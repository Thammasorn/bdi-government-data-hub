import {
  formatThaiDate,
  taskEventLabel,
  type ReviewResult,
  type ReviewTaskType,
} from "@/lib/status";

/**
 * หนึ่งบรรทัดของ timeline = หนึ่งแถวใน review.review_task
 *
 * ตาราง organization_events / dataset_request_events ถูกตัดออกตามดีไซน์
 * ข้อความจึงประกอบจาก task_type + result แทนที่จะ map จาก event type ชุดเดิม
 * (ดู taskEventLabel() ใน lib/status.ts)
 */
export interface OrgEvent {
  sequenceNumber?: number;
  status?: string;
  assignedAt?: string;
  startedAt?: string | null;
  id: string;
  taskType: ReviewTaskType;
  result: ReviewResult | null;
  roundNumber: number;
  note: string | null;
  createdAt: string;
  completedAt: string | null;
  actor: { id: string; name: string; email: string } | null;
}

/** ใช้ร่วมกันทั้งเส้นทางหน่วยงานและชุดข้อมูล — โครง review_task เหมือนกันทั้งคู่ */
export function Timeline({ events }: { events: OrgEvent[] }) {
  if (events.length === 0) {
    return <p className="px-6 py-5 text-sm text-ink-muted">ยังไม่มีประวัติการดำเนินการ</p>;
  }

  return (
    <ol className="flex flex-col px-6 py-5">
      {events.map((e, i) => {
        const actor = e.actor ? e.actor.name || e.actor.email : "ระบบ";
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
              <p className="text-sm font-medium text-ink">
                {taskEventLabel(e.taskType, e.result)}
                {e.roundNumber > 1 ? (
                  <span className="ml-1.5 text-[13px] font-normal text-ink-muted">
                    (รอบที่ {e.roundNumber})
                  </span>
                ) : null}
              </p>
              <p className="mt-0.5 text-[13px] text-ink-muted">
                {actor} · {formatThaiDate(e.completedAt ?? e.createdAt)}
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
