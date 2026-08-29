/**
 * เส้นทางการอนุมัติทั้งเส้น — "มีกี่ขั้น ตอนนี้ขั้นไหน ขั้นต่อไปใครทำ"
 *
 * ต่างจาก `components/organization/Timeline.tsx` ซึ่งตอบว่า "เกิดอะไรขึ้นบ้าง" (ประวัติจริง
 * รวมรอบที่ถูกส่งกลับ) — สองอย่างนี้เป็นคนละคำถาม จึงอยู่คนละการ์ด ไม่ยุบรวมกัน
 *
 * ลำดับขั้นมาจาก API ทั้งหมด (`backend/src/lib/journey-steps.ts`) ไฟล์นี้ไม่รู้จักลำดับด่าน
 * และไม่ควรรู้ — `BDI_OFFICER_REVIEW` เป็นสองด่านคนละด่านใน Journey C ซึ่งแยกได้จากประวัติ
 * เท่านั้น หน้าจอที่เดาลำดับเองจะแสดงผิดโดยไม่มีอะไรพัง
 *
 * แต่ละขั้นบอก **บทบาท** ที่รับผิดชอบ ไม่บอกชื่อผู้ตรวจ
 */
import clsx from "clsx";

import type { JourneyProgress, JourneyProgressSummary, JourneyStep } from "@/lib/types";
import { formatThaiDate } from "@/lib/status";

/** ข้อความอธิบายช่วงที่คำขออยู่ ณ ตอนนี้ ใช้ทั้งแบบเต็มและแบบย่อ */
const PHASE_NOTE: Record<JourneyProgress["phase"], string | null> = {
  DRAFT: "ยังไม่ได้นำส่ง — ขั้นตอนด้านล่างจะเริ่มเมื่อกดนำส่งคำขอ",
  IN_PROGRESS: null,
  WAITING_REVISION: "ขณะนี้อยู่ที่หน่วยงาน — รอแก้ไขตามที่ผู้ตรวจส่งกลับ แล้วนำส่งใหม่",
  APPROVED: "ผ่านครบทุกขั้นตอนแล้ว",
  REJECTED: "คำขอนี้ไม่ได้รับอนุมัติ — กระบวนการปิดแล้ว",
  CANCELLED: "คำขอนี้ถูกยกเลิก",
};

function StepMark({ step }: { step: JourneyStep }) {
  const base =
    "mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full text-[12px] font-semibold";

  if (step.state === "DONE") {
    return (
      <span className={clsx(base, "bg-success text-white")}>
        <svg
          viewBox="0 0 16 16"
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          aria-hidden="true"
        >
          <path d="m4 8.5 2.6 2.6L12 5.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    );
  }

  if (step.state === "REJECTED") {
    return (
      <span className={clsx(base, "bg-danger text-white")}>
        <svg
          viewBox="0 0 16 16"
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          aria-hidden="true"
        >
          <path d="M5 5l6 6M11 5l-6 6" strokeLinecap="round" />
        </svg>
      </span>
    );
  }

  if (step.state === "CURRENT") {
    return (
      <span className={clsx(base, "bg-coral-500 text-white ring-4 ring-coral-500/20")}>
        {step.order ?? "•"}
      </span>
    );
  }

  return <span className={clsx(base, "bg-navy-100 text-navy-600")}>{step.order ?? "•"}</span>;
}

/** ป้ายบอกสถานะของขั้น — มีทั้งสีและข้อความเสมอ ตาม docs/02-ui-spec.md §5 ข้อ 3 */
function StepState({ step }: { step: JourneyStep }) {
  const meta: Record<JourneyStep["state"], { label: string; className: string }> = {
    DONE: { label: "ผ่านแล้ว", className: "bg-success-bg text-success" },
    CURRENT: { label: "อยู่ขั้นนี้", className: "bg-warning-bg text-warning" },
    UPCOMING: { label: "ยังไม่ถึง", className: "bg-navy-50 text-ink-muted" },
    REJECTED: { label: "ไม่อนุมัติ", className: "bg-danger-bg text-danger" },
  };
  const { label, className } = meta[step.state];
  return (
    <span
      className={clsx(
        "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap",
        className,
      )}
    >
      {label}
    </span>
  );
}

export function ApprovalSteps({ progress }: { progress: JourneyProgress }) {
  const note = PHASE_NOTE[progress.phase];

  return (
    <div className="px-6 py-5">
      <p className="text-sm text-ink">
        {progress.currentOrder ? (
          <>
            ขณะนี้อยู่ <strong className="font-semibold text-navy-800">ขั้นที่ {progress.currentOrder} จาก {progress.totalSteps}</strong>
          </>
        ) : (
          <>
            กระบวนการนี้มีทั้งหมด{" "}
            <strong className="font-semibold text-navy-800">{progress.totalSteps} ขั้นตอน</strong>
          </>
        )}
        {progress.nextStep ? (
          <span className="text-ink-muted"> · ขั้นต่อไป: {progress.nextStep.label}</span>
        ) : null}
      </p>

      {note ? (
        <p
          className={clsx(
            "mt-3 rounded-lg px-3 py-2 text-[13px] leading-relaxed",
            progress.phase === "WAITING_REVISION" && "bg-danger-bg text-danger",
            progress.phase === "APPROVED" && "bg-success-bg text-success",
            progress.phase === "REJECTED" && "bg-danger-bg text-danger",
            (progress.phase === "DRAFT" || progress.phase === "CANCELLED") &&
              "bg-canvas text-ink-muted",
          )}
        >
          {note}
        </p>
      ) : null}

      <ol className="mt-4 flex flex-col">
        {progress.steps.map((step, i) => {
          const last = i === progress.steps.length - 1;
          return (
            <li
              key={step.key}
              className="relative flex gap-4 pb-5 last:pb-0"
              aria-current={step.state === "CURRENT" ? "step" : undefined}
            >
              {!last ? (
                <span aria-hidden="true" className="absolute left-[13px] top-9 h-full w-px bg-line" />
              ) : null}
              <StepMark step={step} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <p
                    className={clsx(
                      "text-sm",
                      step.state === "UPCOMING"
                        ? "text-ink-muted"
                        : "font-medium text-ink",
                    )}
                  >
                    {step.order ? `${step.order}. ` : ""}
                    {step.label}
                  </p>
                  <StepState step={step} />
                </div>
                <p className="mt-0.5 text-[13px] text-ink-muted">
                  โดย{step.roleLabel}
                  {step.optional ? " · ขั้นตอนนี้มีเมื่อเจ้าหน้าที่มอบหมายเท่านั้น ไม่นับในลำดับขั้น" : ""}
                  {/* วันที่บอกได้เฉพาะขั้นที่จบไปแล้วจริง — ขั้นที่ถูกส่งกลับยังมี completedAt
                      ของรอบก่อนติดมาด้วย ซึ่งอ่านคู่กับ "ยังไม่ถึง" แล้วขัดกันเอง */}
                  {step.completedAt && (step.state === "DONE" || step.state === "REJECTED")
                    ? ` · ${formatThaiDate(step.completedAt)}`
                    : ""}
                  {step.roundNumber && step.roundNumber > 1 ? ` · รอบที่ ${step.roundNumber}` : ""}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/**
 * บรรทัดเดียวสำหรับตารางและการ์ด
 *
 * รับได้ทั้งฉบับย่อจากหน้ารายการและฉบับเต็มจากหน้ารายละเอียด — สองหน้าจอนี้ต้องพูดตรงกัน
 * ถึงจะโหลดข้อมูลคนละชุด
 */
export function ApprovalStepsCompact({
  progress,
  className,
}: {
  progress: JourneyProgressSummary | JourneyProgress | null;
  className?: string;
}) {
  if (!progress) return <span className="text-[13px] text-ink-muted">—</span>;

  const label =
    "currentLabel" in progress
      ? progress.currentLabel
      : (progress.currentStep?.waitingLabel ?? null);
  const next = "nextLabel" in progress ? progress.nextLabel : (progress.nextStep?.label ?? null);

  if (!progress.currentOrder) {
    const note = PHASE_NOTE[progress.phase];
    return (
      <div className={clsx("flex flex-col gap-0.5", className)}>
        <span className="text-[13px] text-ink-muted">
          {progress.phase === "APPROVED"
            ? `ครบทั้ง ${progress.totalSteps} ขั้นตอน`
            : `ทั้งหมด ${progress.totalSteps} ขั้นตอน`}
        </span>
        {note && progress.phase !== "IN_PROGRESS" ? (
          <span className="text-[12px] text-ink-muted">{note}</span>
        ) : null}
      </div>
    );
  }

  return (
    <div className={clsx("flex flex-col gap-1", className)}>
      <span className="text-[13px] font-medium text-ink">
        ขั้นที่ {progress.currentOrder} จาก {progress.totalSteps}
        {label ? <span className="font-normal text-ink-muted"> · {label}</span> : null}
      </span>
      {/* แถบนี้เป็นของประดับ ตัวเลขข้างบนคือข้อมูลจริง — ไม่สื่อความหมายด้วยสีอย่างเดียว */}
      <span aria-hidden="true" className="flex h-1 gap-0.5">
        {Array.from({ length: progress.totalSteps }, (_, i) => (
          <span
            key={i}
            className={clsx(
              "h-full flex-1 rounded-full",
              i + 1 < progress.currentOrder!
                ? "bg-success"
                : i + 1 === progress.currentOrder
                  ? "bg-coral-500"
                  : "bg-navy-100",
            )}
          />
        ))}
      </span>
      {next ? <span className="text-[12px] text-ink-muted">ขั้นต่อไป: {next}</span> : null}
    </div>
  );
}
