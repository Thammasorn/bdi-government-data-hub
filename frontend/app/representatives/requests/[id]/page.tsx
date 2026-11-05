"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { Timeline } from "@/components/organization/Timeline";
import { ApprovalSteps } from "@/components/review/ApprovalSteps";
import { OrganizationFrozenNotice } from "@/components/review/OrganizationFrozenNotice";
import { ChangeRequestSections } from "@/components/representatives/RequestSections";
import { ChangeStatusBadge, HeadcountTable } from "@/components/representatives/Shell";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { TextAreaField } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";
import { useToast } from "@/components/ui/Toast";
import { api, ApiError } from "@/lib/api";
import type { ChangeDetail } from "@/lib/representatives";
import { useRequireAuth } from "@/lib/require-auth";
import { formatThaiDate, isOrganizationFrozen } from "@/lib/status";

export default function ChangeRequestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { show } = useToast();
  const { user, loading } = useRequireAuth();
  const [request, setRequest] = useState<ChangeDetail | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [modal, setModal] = useState<"confirm" | "return" | "reject" | "cancel" | null>(null);
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
  const lastReturned = [...request.timeline].reverse().find((t) => t.result === "RETURNED");
  const lastRejected = [...request.timeline].reverse().find((t) => t.result === "REJECTED");
  const frozen = isOrganizationFrozen(request.organization.status);

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
      setModal(null);
      setNote("");
      await load();
      if (action === "confirm") {
        setDone(
          result.failedEmails?.length
            ? `ได้ทำการ Deactivate ผู้แทนเดิมแล้ว แต่ส่ง activation key ไม่สำเร็จ: ${result.failedEmails.join(", ")}`
            : "ได้ทำการ Deactivate ผู้แทนเดิม และนำส่ง activation key ไปยังผู้แทนใหม่ เรียบร้อยแล้ว",
        );
      } else {
        show({ tone: "success", title: action === "return" ? "ส่งกลับแก้ไขแล้ว" : "ไม่อนุมัติคำขอแล้ว" });
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

  const cancelRequest = async () => {
    if (note.trim().length < 10) {
      setNoteError("กรุณาระบุเหตุผลอย่างน้อย 10 ตัวอักษร");
      return;
    }
    setBusy(true);
    try {
      await api.post(`/api/representative-changes/${id}/cancel`, { reason: note.trim() });
      setModal(null);
      setNote("");
      await load();
      show({ tone: "success", title: "ยกเลิกคำขอแล้ว" });
    } catch (err) {
      show({ tone: "error", title: "ยกเลิกคำขอไม่สำเร็จ", detail: err instanceof ApiError ? err.message : undefined });
    } finally {
      setBusy(false);
    }
  };

  const openNote = (next: "return" | "reject" | "cancel") => {
    // ส่งกลับเพราะไม่ผ่านการตรวจ — เติมเหตุผลให้ เจ้าหน้าที่แก้ก่อนส่งได้ เพราะหน่วยงานจะอ่านข้อความนี้
    setNote(next === "return" ? blockers.join("\n") : "");
    setNoteError(null);
    setModal(next);
  };

  const showRetry = request.canRetry && (isAdmin || user.roles.includes("BDI_OFFICER"));

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <Breadcrumb
        items={
          isAdmin
            ? [{ label: "ระบบจัดการ", href: "/console" }, { label: request.requestNumber }]
            : [
                { label: "ผู้แทนหน่วยงาน", href: "/representatives" },
                { label: "ฟอร์มเปลี่ยนแปลงผู้แทนหน่วยงาน", href: "/representatives/requests" },
                { label: request.requestNumber },
              ]
        }
      />

      <header className="mb-7 mt-4 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="break-words text-[26px] font-semibold text-navy-800">{request.requestNumber}</h1>
          <p className="mt-1 text-sm text-ink-muted">{request.organization.nameTh}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <ChangeStatusBadge status={request.status} />
        </div>
      </header>

      {frozen ? <OrganizationFrozenNotice status={request.organization.status} /> : null}

      {request.status === "DRAFT" && request.canEdit ? (
        <Card className="mb-6 border-l-[3px] border-l-coral-500">
          <div className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium text-navy-800">คำขอนี้ยังเป็นฉบับร่าง</p>
              <p className="mt-0.5 text-sm text-ink-muted">กรอกข้อมูลให้ครบแล้วตรวจสอบก่อนนำส่งให้ BDI</p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-3">
              <Button variant="secondary" onClick={() => openNote("cancel")}>
                ยกเลิกคำขอ
              </Button>
              <Button onClick={() => router.push(`/representatives/requests/${id}/edit`)}>กรอกข้อมูลต่อ</Button>
            </div>
          </div>
        </Card>
      ) : null}

      {request.status === "RETURNED" && lastReturned?.note ? (
        <div className="mb-6 rounded-xl border-l-[3px] border-danger bg-danger-bg p-5">
          <p className="text-[13px] font-semibold text-danger">สิ่งที่ต้องแก้ไข</p>
          <p className="mt-1.5 whitespace-pre-wrap break-words text-[15px] leading-relaxed text-ink">{lastReturned.note}</p>
          <p className="mt-2 text-[13px] text-ink-muted">
            โดย {lastReturned.actor ? lastReturned.actor.name : "ระบบ"} ·{" "}
            {formatThaiDate(lastReturned.completedAt ?? lastReturned.createdAt)}
          </p>
          {request.canEdit ? (
            <div className="mt-4 flex flex-wrap gap-3">
              <Button size="sm" onClick={() => router.push(`/representatives/requests/${id}/edit`)}>
                แก้ไขข้อมูล
              </Button>
              <Button size="sm" variant="secondary" onClick={() => openNote("cancel")}>
                ยกเลิกคำขอ
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {request.status === "REJECTED" && lastRejected?.note ? (
        <div className="mb-6 rounded-xl border-l-[3px] border-danger bg-danger-bg p-5">
          <p className="text-[13px] font-semibold text-danger">เหตุผลที่ไม่อนุมัติ</p>
          <p className="mt-1.5 whitespace-pre-wrap break-words text-[15px] leading-relaxed text-ink">{lastRejected.note}</p>
          <p className="mt-2 text-[13px] text-ink-muted">
            โดย {lastRejected.actor ? lastRejected.actor.name : "ระบบ"} ·{" "}
            {formatThaiDate(lastRejected.completedAt ?? lastRejected.createdAt)}
          </p>
        </div>
      ) : null}

      {request.canReview ? (
        <Card className="mb-6 border-l-[3px] border-l-coral-500">
          <div className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium text-navy-800">รอการพิจารณาของคุณ</p>
              <p className="mt-0.5 text-sm text-ink-muted">ตรวจสอบรายชื่อและเอกสารแนบ แล้วบันทึกผลการตรวจสอบ</p>
              {blockers.map((b) => (
                <p key={b} className="mt-1 text-sm text-danger">
                  {b}
                </p>
              ))}
            </div>
            <div className="flex shrink-0 flex-wrap gap-3">
              <Button variant="secondary" onClick={() => openNote("reject")}>
                ไม่อนุมัติ
              </Button>
              <Button variant="secondary" onClick={() => openNote("return")}>
                ส่งกลับแก้ไข
              </Button>
              <Button disabled={blockers.length > 0} onClick={() => setModal("confirm")}>
                ผ่านการตรวจสอบ
              </Button>
            </div>
          </div>
        </Card>
      ) : null}

      {showRetry ? (
        <Card className="mb-6 border-l-[3px] border-l-coral-500">
          <div className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium text-navy-800">ดำเนินการไม่สำเร็จ</p>
              <p className="mt-0.5 text-sm text-ink-muted">ระบบจะทำซ้ำเฉพาะรายการที่ยังไม่สำเร็จ</p>
            </div>
            <Button className="shrink-0" onClick={retry} loading={busy}>
              ลองใหม่
            </Button>
          </div>
        </Card>
      ) : null}

      {request.review?.overlaps.length ? (
        <div className="mb-6 rounded-xl border-l-[3px] border-warning bg-warning-bg p-5 text-sm text-ink">
          {request.review.overlaps.map((o) => (
            <p key={`${o.name}-${o.requestNumber}`}>
              {o.name} อยู่ในคำขอ {o.requestNumber} ที่ยังไม่จบด้วย
            </p>
          ))}
        </div>
      ) : null}

      <div className="flex flex-col gap-6">
        {request.headcount ? (
          <Card>
            <CardHeader title="จำนวนหลังดำเนินการ" />
            <div className="px-6 py-4">
              <HeadcountTable rows={request.headcount} />
            </div>
          </Card>
        ) : null}

        <ChangeRequestSections request={request} />

        <Card>
          <CardHeader title="ขั้นตอนการอนุมัติ" />
          <ApprovalSteps progress={request.progress} />
        </Card>

        <Card>
          <CardHeader title="ประวัติการดำเนินการ" />
          <Timeline
            events={request.timeline}
            created={{ at: request.createdAt, by: request.createdBy }}
            submittedAt={request.submittedAt}
          />
        </Card>
      </div>

      <Modal
        open={modal === "return" || modal === "reject" || modal === "cancel"}
        onClose={() => setModal(null)}
        title={modal === "return" ? "ส่งกลับแก้ไข" : modal === "reject" ? "ไม่อนุมัติ" : "ยกเลิกคำขอ"}
        description={
          modal === "return"
            ? "ระบุสิ่งที่ต้องการให้หน่วยงานแก้ไข"
            : modal === "reject"
              ? "คำขอที่ไม่อนุมัติจะจบทันทีและแก้ไขต่อไม่ได้"
              : "คำขอที่ยกเลิกแล้วจะแก้ไขหรือนำส่งไม่ได้อีก"
        }
      >
        <TextAreaField
          label={modal === "return" ? "รายละเอียดที่ต้องแก้ไข" : "เหตุผล"}
          required
          hint={
            modal === "return" && blockers.length > 0
              ? "ระบบเติมเหตุผลที่ตรวจไม่ผ่านให้ แก้ไขได้ก่อนส่ง หน่วยงานจะเห็นข้อความนี้"
              : undefined
          }
          value={note}
          error={noteError ?? undefined}
          onChange={(e) => {
            setNote(e.target.value);
            setNoteError(null);
          }}
        />
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setModal(null)}>
            ย้อนกลับ
          </Button>
          <Button
            variant="danger"
            loading={busy}
            onClick={() => (modal === "cancel" ? cancelRequest() : act(modal === "return" ? "return" : "reject"))}
          >
            {modal === "return" ? "ยืนยันส่งกลับแก้ไข" : modal === "reject" ? "ยืนยันไม่อนุมัติ" : "ยืนยันยกเลิกคำขอ"}
          </Button>
        </div>
      </Modal>

      <Modal
        open={modal === "confirm"}
        onClose={() => setModal(null)}
        title="ผ่านการตรวจสอบ"
        description="ยืนยันว่าคุณตรวจสอบข้อมูลและเอกสารแล้ว"
      >
        <p className="text-[15px] leading-relaxed text-ink-muted">
          ระบบจะยกเลิกผู้แทนเดิมและส่งคำเชิญให้ผู้แทนใหม่ทันที และจะบันทึกผลการดำเนินการนี้
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setModal(null)}>
            ย้อนกลับ
          </Button>
          <Button loading={busy} onClick={() => act("confirm")}>
            ผ่านการตรวจสอบ
          </Button>
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
    </div>
  );
}
