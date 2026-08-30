import {
  ROLE_LABELS,
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

/** ผู้ยื่นคำขอ — รูปแบบเดียวกันทั้งสองเส้นทาง */
export interface TimelineCreator {
  firstName: string | null;
  lastName: string | null;
  email: string;
}

/** หนึ่งบรรทัดที่วาดจริง — ทุกบรรทัดคือสิ่งที่**เกิดขึ้นแล้ว** */
interface HistoryRow {
  key: string;
  label: string;
  /** null = ไม่รู้ว่าใครเป็นคนทำ ซึ่งต่างจาก "ระบบเป็นคนทำ" */
  actor: string | null;
  at: string;
  note?: string | null;
  round?: number;
}

/**
 * ประวัติการดำเนินการ — ใช้ร่วมกันทั้งเส้นทางหน่วยงานและชุดข้อมูล
 *
 * **เส้นแบ่ง: ที่นี่เล่าสิ่งที่เกิดขึ้นแล้ว ส่วนสิ่งที่กำลังรออยู่เป็นหน้าที่ของตัวติดตามขั้นตอน**
 * เดิมทั้งสองอย่างปนกัน เพราะ timeline สร้างจาก `review_task` ล้วน ๆ แถวของด่านที่เพิ่งถูก
 * เปิดจึงโผล่มาเป็น "รอ… ดำเนินการ" พร้อมชื่อคนที่ระบบเกลี่ยงานให้ และวันที่ที่เป็นเวลา
 * **นำส่งคำขอ** ไม่ใช่เวลาที่เขาทำอะไร — บรรทัดเดียวผิดทั้งการกระทำ ชื่อ และเวลา
 *
 * task ที่ยังไม่มี `result` จึงไม่ถูกวาดเลย และ `buildJourneyProgress()` ซึ่งเป็นตัวติดตาม
 * ขั้นตอนอยู่แล้ว เป็นที่เดียวที่บอกว่ากำลังรออะไรอยู่
 */
export function Timeline({
  events,
  created,
  submittedAt,
}: {
  events: OrgEvent[];
  /** คนสร้างคำขอและเวลาที่สร้าง — `created_by` เชื่อถือได้ ไม่เคยถูกเขียนทับ */
  created?: { at: string; by: TimelineCreator | null };
  submittedAt?: string | null;
}) {
  const rows: HistoryRow[] = [];

  if (created) {
    const name = created.by
      ? [created.by.firstName, created.by.lastName].filter(Boolean).join(" ") || created.by.email
      : null;
    rows.push({
      key: "created",
      label: `${ROLE_LABELS.ORGANIZATION_USER}สร้างคำขอ`,
      actor: name,
      at: created.at,
    });
  }

  if (submittedAt) {
    rows.push({
      key: "submitted",
      label: `${ROLE_LABELS.ORGANIZATION_USER}นำส่งคำขอ`,
      /**
       * ไม่ขึ้นชื่อ — ไม่มีคอลัมน์ `submitted_by` และ `updated_by` ก็เชื่อไม่ได้เพราะ
       * `syncStatus()` เขียนทับด้วย SYSTEM_USER_ID ผู้กรอกกับผู้กดนำส่งเป็นคนละคนได้
       * ทั้งคู่อยู่ในหน่วยงานเดียวกัน เดาเอาจากผู้สร้างจึงเป็นการเดา ไม่ใช่การบันทึก
       */
      actor: null,
      at: submittedAt,
    });
  }

  for (const e of events) {
    // ยังไม่มีผล = ยังไม่เกิดขึ้น — เป็นเรื่องของตัวติดตามขั้นตอน ไม่ใช่ของประวัติ
    if (!e.result) continue;
    rows.push({
      key: e.id,
      label: taskEventLabel(e.taskType, e.result),
      actor: e.actor ? e.actor.name || e.actor.email : null,
      at: e.completedAt ?? e.createdAt,
      note: e.note,
      round: e.roundNumber,
    });
  }

  if (rows.length === 0) {
    return <p className="px-6 py-5 text-sm text-ink-muted">ยังไม่มีประวัติการดำเนินการ</p>;
  }

  return (
    <ol className="flex flex-col px-6 py-5">
      {rows.map((row, i) => {
        const last = i === rows.length - 1;
        return (
          <li key={row.key} className="relative flex gap-4 pb-5 last:pb-0">
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
                {row.label}
                {row.round && row.round > 1 ? (
                  <span className="ml-1.5 text-[13px] font-normal text-ink-muted">
                    (รอบที่ {row.round})
                  </span>
                ) : null}
              </p>
              {/* ไม่มีชื่อก็เหลือแค่เวลา — ดีกว่าเติม "ระบบ" ให้กับสิ่งที่คนเป็นคนทำ */}
              <p className="mt-0.5 text-[13px] text-ink-muted">
                {row.actor ? `${row.actor} · ` : ""}
                {formatThaiDate(row.at)}
              </p>
              {row.note ? (
                <p className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-canvas px-3 py-2 text-[13px] leading-relaxed text-ink">
                  {row.note}
                </p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
