"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { ChangeStatusBadge, HeadcountTable, RepresentativeShell } from "@/components/representatives/Shell";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { TextAreaField } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";
import { useToast } from "@/components/ui/Toast";
import { api, ApiError } from "@/lib/api";
import type { ChangeDetail } from "@/lib/representatives";
import { useRequireAuth } from "@/lib/require-auth";
import { formatThaiDate } from "@/lib/status";

const RESULT_LABEL: Record<string, string> = {
  CONFIRMED: "ผ่านการตรวจสอบ",
  RETURNED: "ส่งกลับแก้ไข",
  REJECTED: "ปฏิเสธคำขอ",
};

export default function ChangeRequestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { show } = useToast();
  const { user, loading } = useRequireAuth();
  const [request, setRequest] = useState<ChangeDetail | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const opened = useRef(false);
  // ผู้ดูแลระบบทำทุกอย่างที่ BDI Officer ทำได้ผ่าน admin API ตรรกะเดียวกันฝั่ง server
  const isAdmin = user?.roles.includes("SYSTEM_ADMINISTRATOR") ?? false;
  const base = isAdmin ? "/api/admin/representative-changes" : "/api/representative-changes";

  const load = useCallback(async () => {
    const { request: fresh } = await api.get<{ request: ChangeDetail }>(`${base}/${id}`);
    setRequest(fresh);
    return fresh;
  }, [id, base]);

  useEffect(() => {
    if (loading || !user) return;
    load()
      .then(async (fresh) => {
        // เจ้าหน้าที่เปิดอ่าน = เริ่มตรวจ
        if (!isAdmin && fresh.canReview && fresh.status === "SUBMITTED" && !opened.current) {
          opened.current = true;
          await api.post(`/api/representative-changes/${id}/open`, {});
          await load();
        }
      })
      .catch((err: Error) => setProblem(err.message));
  }, [loading, user, load, id, isAdmin]);

  if (loading || !user) return <Spinner />;
  if (problem) return <p className="p-10 text-center text-danger">{problem}</p>;
  if (!request) return <Spinner />;

  const blockers = request.review?.blockers ?? [];

  const act = async (action: "confirm" | "return" | "reject") => {
    if (action !== "confirm" && note.trim().length < 10) {
      setNoteError("กรุณาระบุเหตุผลอย่างน้อย 10 ตัวอักษร");
      return;
    }
    setBusy(true);
    try {
      const result = await api.post<{ status?: string; failedEmails?: string[] }>(
        `${base}/${id}/review`,
        { action, note: note.trim() || undefined },
      );
      setReviewing(false);
      setNote("");
      await load();
      if (action === "confirm") {
        setDone(
          result.failedEmails?.length
            ? `ได้ทำการ Deactivate ผู้แทนเดิมแล้ว แต่ส่ง activation key ไม่สำเร็จ: ${result.failedEmails.join(", ")}`
            : "ได้ทำการ Deactivate ผู้แทนเดิม และนำส่ง activation key ไปยังผู้แทนใหม่ เรียบร้อยแล้ว",
        );
      } else {
        show({ tone: "success", title: action === "return" ? "ส่งกลับแก้ไขแล้ว" : "ปฏิเสธคำขอแล้ว" });
      }
    } catch (err) {
      await load().catch(() => undefined);
      show({ tone: "error", title: "ดำเนินการไม่สำเร็จ", detail: err instanceof ApiError ? err.message : undefined });
    } finally {
      setBusy(false);
    }
  };

  const retry = async () => {
    setBusy(true);
    try {
      const result = await api.post<{ failedEmails: string[] }>(`${base}/${id}/retry`, {});
      await load();
      show(
        result.failedEmails.length
          ? { tone: "error", title: "ยังส่งคำเชิญไม่สำเร็จ", detail: result.failedEmails.join(", ") }
          : { tone: "success", title: "ส่งคำเชิญเรียบร้อยแล้ว" },
      );
    } catch (err) {
      show({ tone: "error", title: "ลองใหม่ไม่สำเร็จ", detail: err instanceof ApiError ? err.message : undefined });
    } finally {
      setBusy(false);
    }
  };

  const showRetry = request.canRetry && (isAdmin || user.roles.includes("BDI_OFFICER"));

  return (
    <RepresentativeShell title={`คำขอ ${request.requestNumber}`} description={request.organization.nameTh}>
      <Card className="mb-4 flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <ChangeStatusBadge status={request.status} />
        <div className="flex flex-wrap gap-3">
          {request.canEdit ? (
            <Link className="text-sm text-navy-700 underline" href={`/representatives/requests/${id}/edit`}>
              แก้ไขคำขอ
            </Link>
          ) : null}
          {showRetry ? (
            <Button size="sm" onClick={retry} loading={busy}>
              ลองใหม่
            </Button>
          ) : null}
          {request.canReview ? <Button onClick={() => setReviewing(true)}>Submit Review</Button> : null}
        </div>
      </Card>

      {request.review?.overlaps.length ? (
        <Card className="mb-4 bg-warning-bg px-5 py-4 text-sm">
          {request.review.overlaps.map((o) => (
            <p key={`${o.name}-${o.requestNumber}`}>
              {o.name} อยู่ในคำขอ {o.requestNumber} ที่ยังไม่จบด้วย
            </p>
          ))}
        </Card>
      ) : null}

      <Card className="mb-4 px-5 py-5">
        <h2 className="mb-3 font-semibold text-navy-800">จำนวนหลังดำเนินการ</h2>
        <HeadcountTable rows={request.headcount} />
      </Card>

      <Card className="mb-4 px-5 py-5">
        <h2 className="mb-3 font-semibold text-navy-800">ส่วนที่ 1 ยกเลิกรายชื่อผู้แทนเดิม</h2>
        {request.removals.length ? (
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            {request.removals.map((r) => (
              <li key={r.id}>
                {r.name}
                {r.pendingInvitee ? " (รอเปิดใช้งาน)" : ""} · {[r.positionTh, r.departmentTh].filter(Boolean).join(" / ") || "–"} · {r.roleLabel}
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-ink-muted">ไม่มี</p>
        )}
      </Card>

      <Card className="mb-4 px-5 py-5">
        <h2 className="mb-3 font-semibold text-navy-800">ส่วนที่ 2 เพิ่มรายชื่อผู้แทนใหม่</h2>
        {request.additions.length ? (
          <ol className="space-y-3 text-sm">
            {request.additions.map((a, index) => {
              const check = request.review?.accountChecks.find((c) => c.additionId === a.id);
              return (
                <li key={a.id} className="rounded-xl p-4 ring-1 ring-line">
                  <p className="font-medium">
                    ผู้แทนลำดับที่ {index + 1} · {a.roleLabel}
                  </p>
                  <p>
                    {a.prefixTh} {a.firstnameTh} {a.lastnameTh}
                  </p>
                  <p className="text-ink-muted">เลขประจำตัวประชาชน {a.cid}</p>
                  <p className="text-ink-muted">
                    {a.positionTh} · {a.departmentTh}
                  </p>
                  <p className="text-ink-muted">
                    {a.email} · {a.phoneNumber}
                    {a.phoneNumberExtension ? ` ต่อ ${a.phoneNumberExtension}` : ""}
                  </p>
                  {check ? (
                    <p className={check.ok ? "mt-1 text-[13px] text-success" : "mt-1 text-[13px] text-danger"}>
                      {check.ok ? "ตรวจบัญชีผ่าน: " : "ตรวจบัญชีไม่ผ่าน: "}
                      {check.message}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="text-sm text-ink-muted">ไม่มี</p>
        )}
      </Card>

      <Card className="mb-4 px-5 py-5">
        <h2 className="mb-3 font-semibold text-navy-800">ส่วนที่ 3 เอกสารแนบ</h2>
        {request.attachment ? (
          <a
            className="text-sm text-navy-700 underline"
            href={api.fileUrl(`/api/representative-changes/${id}/attachments/${request.attachment.id}`)}
            target="_blank"
            rel="noreferrer"
          >
            {request.attachment.filename}
          </a>
        ) : (
          <p className="text-sm text-ink-muted">ยังไม่มีไฟล์แนบ</p>
        )}
      </Card>

      {request.timeline.some((t) => t.result) ? (
        <Card className="mb-4 px-5 py-5">
          <h2 className="mb-3 font-semibold text-navy-800">ประวัติการตรวจสอบ</h2>
          <ul className="space-y-2 text-sm">
            {request.timeline
              .filter((t) => t.result)
              .map((t) => (
                <li key={t.id}>
                  <span className="font-medium">{RESULT_LABEL[t.result!] ?? t.result}</span>
                  {t.completedBy ? ` โดย ${t.completedBy.name}` : ""}
                  {t.completedAt ? ` · ${formatThaiDate(t.completedAt)}` : ""}
                  {t.comment ? <p className="text-ink-muted">{t.comment}</p> : null}
                </li>
              ))}
          </ul>
        </Card>
      ) : null}

      <Modal open={reviewing} onClose={() => setReviewing(false)} title="ผลการตรวจสอบ">
        <div className="space-y-3">
          {blockers.length ? (
            <div className="rounded-xl bg-danger-bg p-3 text-sm text-danger">
              <p className="font-medium">ผ่านการตรวจสอบไม่ได้</p>
              <ul className="list-disc pl-5">
                {blockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <TextAreaField
            label="กรอก รายละเอียดการส่งกลับแก้ไข"
            hint="บังคับกรอกกรณีส่งกลับแก้ไขหรือปฏิเสธคำขอ"
            value={note}
            error={noteError ?? undefined}
            onChange={(e) => {
              setNote(e.target.value);
              setNoteError(null);
            }}
          />
          <div className="flex flex-wrap justify-between gap-2">
            <Button variant="ghost" onClick={() => setReviewing(false)}>
              Close
            </Button>
            <div className="flex flex-wrap gap-2">
              <Button variant="danger" onClick={() => act("reject")} loading={busy}>
                ปฏิเสธคำขอ
              </Button>
              <Button variant="secondary" onClick={() => act("return")} loading={busy}>
                ส่งกลับแก้ไข
              </Button>
              <Button onClick={() => act("confirm")} loading={busy} disabled={blockers.length > 0}>
                ผ่านการตรวจสอบ
              </Button>
            </div>
          </div>
        </div>
      </Modal>

      <Modal open={done !== null} onClose={() => setDone(null)} title="ดำเนินการแล้ว">
        <p className="mb-4 text-sm">{done}</p>
        <div className="flex justify-center">
          <Button variant="secondary" onClick={() => setDone(null)}>
            Close
          </Button>
        </div>
      </Modal>
    </RepresentativeShell>
  );
}
