import {
  ROLE_LABELS,
  formatThaiDate,
  taskEventLabel,
  type ReviewResult,
  type ReviewTaskType,
} from "@/lib/status";
import { fullName } from "@/lib/types";

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
  /** ด่านถูกปิดด้วย "ยกเลิกผลการตรวจสอบ" — ผู้กระทำไม่ใช่เจ้าของด่าน */
  recalled?: boolean;
  createdAt: string;
  completedAt: string | null;
  actor: { id: string; name: string; email: string } | null;
  /** ผู้ที่ทำให้ด่านนี้ถูกเปิด — ของ BDI_OFFICER_REVIEW คือผู้ที่กดนำส่งคำขอรอบนั้น */
  openedBy?: { id: string; name: string; email: string } | null;
}

/** ผู้ยื่นคำขอ — รูปแบบเดียวกันทั้งสองเส้นทาง */
export interface TimelineCreator {
  prefix: string | null;
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
 *
 * **บรรทัด "นำส่งคำขอ" ก็มาจาก `review_task` เหมือนบรรทัดอื่น** ไม่ได้มาจาก `submitted_at`
 * เดิมมันมาจากคอลัมน์นั้น ซึ่งเป็น timestamp เดี่ยวที่ `POST /:id/submit` เขียนทับทุกครั้ง
 * ผลคือผิดสามอย่างพร้อมกัน: ไม่มีชื่อผู้นำส่ง (คอลัมน์ไม่ได้เก็บไว้), การนำส่งรอบที่สอง
 * หลังถูกส่งกลับแก้ไขไม่มีบรรทัดของตัวเอง (คอลัมน์เก็บได้ค่าเดียว) และบรรทัดนั้นถูกวาด
 * เป็นแถวที่สองเสมอทั้งที่ถือเวลาของรอบล่าสุด จึงใหม่กว่าบรรทัดที่อยู่ข้างล่างมัน
 *
 * แถว `BDI_OFFICER_REVIEW` ตอบได้ครบทั้งสาม — ด่านนั้นถูกเปิดจาก `POST /:id/submit` ที่เดียว
 * ทั้งสองเส้นทาง **หนึ่งแถวจึงเท่ากับการนำส่งหนึ่งครั้ง** พร้อมเวลา (`assignedAt`) ผู้กด
 * (`openedBy` มาจาก `created_by`) และรอบที่ (`roundNumber`) ครบในแถวเดียว
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
    // ประกอบด้วย fullName() ตัวเดียวกับที่อื่น — ชื่อบนไทม์ไลน์ต้องตรงกับชื่อบนแถบหัว
    const composed = created.by ? fullName(created.by.prefix, created.by.firstName, created.by.lastName) : null;
    const name = composed === "—" ? (created.by?.email ?? null) : composed;
    rows.push({
      key: "created",
      label: `${ROLE_LABELS.ORGANIZATION_USER}สร้างคำขอ`,
      actor: name,
      at: created.at,
    });
  }

  /**
   * ทางสำรองสำหรับคำขอที่นำส่งไปแล้วแต่ไม่มีแถวของด่านเจ้าหน้าที่เลย — ข้อมูลเก่าหรือ
   * ข้อมูล seed เท่านั้น ของจริงมีเสมอ บรรทัดนี้ไม่มีชื่อและไม่มีรอบ เพราะ `submitted_at`
   * ไม่ได้เก็บทั้งสองอย่างไว้ ตรงนั้นคือทั้งหมดที่รู้จริง
   */
  if (submittedAt && !events.some((e) => e.taskType === "BDI_OFFICER_REVIEW")) {
    rows.push({
      key: "submitted",
      label: `${ROLE_LABELS.ORGANIZATION_USER}นำส่งคำขอ`,
      actor: null,
      at: submittedAt,
    });
  }

  for (const e of events) {
    /**
     * ด่านเจ้าหน้าที่ BDI ถูกเปิดด้วยการกดนำส่ง — วาดการนำส่งรอบนั้นก่อนผลการตรวจของมัน
     *
     * อยู่นอก `if (!e.result)` ข้างล่างโดยตั้งใจ: การนำส่ง**เกิดขึ้นแล้ว**ตั้งแต่แถวถูกสร้าง
     * ต่อให้เจ้าหน้าที่ยังไม่ได้ตรวจ ประวัติจึงต้องมีบรรทัดนี้ระหว่างที่ยังรออยู่
     */
    if (e.taskType === "BDI_OFFICER_REVIEW") {
      rows.push({
        key: `${e.id}-submitted`,
        label: `${ROLE_LABELS.ORGANIZATION_USER}นำส่งคำขอ`,
        actor: e.openedBy ? e.openedBy.name || e.openedBy.email : null,
        at: e.assignedAt ?? e.createdAt,
        round: e.roundNumber,
      });
    }

    // ยังไม่มีผล = ยังไม่เกิดขึ้น — เป็นเรื่องของตัวติดตามขั้นตอน ไม่ใช่ของประวัติ
    if (!e.result) continue;
    rows.push({
      key: e.id,
      label: taskEventLabel(e.taskType, e.result, e.recalled),
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
