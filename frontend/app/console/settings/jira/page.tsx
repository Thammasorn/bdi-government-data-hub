"use client";

import Link from "next/link";
import { useState } from "react";

import { DataTable, EmptyState, type Column } from "@/components/console/DataTable";
import { ErrorNotice, PageHeader, Panel, Tabs } from "@/components/console/ui";
import { Button } from "@/components/ui/Button";
import { PasswordField, TextField } from "@/components/ui/Field";
import { Spinner } from "@/components/ui/Spinner";
import { useToast } from "@/components/ui/Toast";
import { adminErrorView, type AdminErrorView } from "@/lib/admin-errors";
import { api } from "@/lib/api";
import { formatThaiDate } from "@/lib/status";
import { useAdminData } from "@/lib/use-admin";

/** `GET /api/admin/settings/jira` — backend/src/routes/admin-jira.ts */
interface JiraSnapshot {
  config: {
    enabled: boolean;
    domain: string;
    email: string;
    tokenSet: boolean;
    tokenUnreadable: boolean;
    projectKey: string;
    doneStatus: string;
    archiveStatus: string;
    updatedAt: string | null;
    updatedBy: string | null;
  };
  status: {
    ok: boolean | null;
    message: string | null;
    code: string | null;
    at: string | null;
    authFailedAt: string | null;
    lastSyncAt: string | null;
    authBlocked: boolean;
    usable: boolean;
  };
  syncIntervalSeconds: number;
  counts: { failed: number; pending: number };
}

interface TestResult {
  ok: boolean;
  steps: Array<{ label: string; ok: boolean; detail: string | null }>;
  requeued: number;
}

interface JiraOperationRow {
  id: string;
  createdAt: string;
  lastAttemptAt: string | null;
  nextRetryAt: string | null;
  operation: string;
  operationLabel: string;
  requestId: string | null;
  requestNumber: string | null;
  issueKey: string | null;
  issueUrl: string | null;
  status: "PENDING" | "PROCESSING" | "SUCCEEDED" | "FAILED" | "DEAD_LETTER" | "CANCELLED";
  attemptCount: number;
  errorCode: string | null;
  message: string | null;
  retryable: boolean;
}

type Filter = "failed" | "pending" | "all";

/**
 * ตั้งค่าระบบ → Jira (การ์ด "[Enhance] JIRA integration" 2026-11-08)
 *
 * ค่าตั้งการเชื่อมต่อ · ช่วงตรวจสถานะการ์ด · บันทึกการทำงานกับ Jira — ทั้งหมดอยู่หน้าเดียว เพราะผู้ที่แก้ token คือคนเดียวกับที่ต้องเห็นว่างานไหน
 * ค้างเพราะ token และกดส่งใหม่ API token ไม่เคยกลับมาที่หน้านี้: ช่องว่างแปลว่า "ใช้ค่าเดิม"
 */
export default function ConsoleJiraSettingsPage() {
  const { data, error, loading, reload } = useAdminData<JiraSnapshot>("/api/admin/settings/jira");
  const [logRound, setLogRound] = useState(0);

  if (loading && !data) return <Spinner />;
  if (error && !data) return <ErrorNotice view={adminErrorView(error)} />;
  if (!data) return null;

  const refresh = () => {
    reload();
    setLogRound((n) => n + 1);
  };

  return (
    <div>
      <PageHeader eyebrow="ตั้งค่าระบบ" title="Jira" />
      <div className="space-y-6">
        <ConnectionPanel key={data.config.updatedAt ?? "new"} snapshot={data} onSaved={refresh} />
        <IntervalPanel key={`interval:${data.syncIntervalSeconds}`} snapshot={data} onSaved={reload} />
        <OperationsPanel counts={data.counts} round={logRound} onChanged={refresh} />
      </div>
    </div>
  );
}

function StatusLine({ snapshot }: { snapshot: JiraSnapshot }) {
  const { config, status } = snapshot;
  let tone = "bg-canvas text-ink-muted";
  let text: string;
  if (!config.enabled) {
    text = "ปิดการเชื่อมต่ออยู่ — ระบบไม่สร้างการ์ดและไม่เรียก Jira";
  } else if (status.authBlocked) {
    tone = "bg-danger-bg text-danger";
    text = `เชื่อมต่อไม่ได้ — ${status.message ?? "token ใช้ไม่ได้"}${status.at ? ` (ล่าสุด ${formatThaiDate(status.at)})` : ""} · ระบบหยุดส่งงานจนกว่าจะบันทึก token ใหม่`;
  } else if (status.ok === false) {
    tone = "bg-warning-bg text-warning";
    text = `ล่าสุดเรียก Jira ไม่สำเร็จ — ${status.message ?? ""}${status.at ? ` (${formatThaiDate(status.at)})` : ""}`;
  } else if (status.ok === true) {
    tone = "bg-success-bg text-success";
    text = `เชื่อมต่อได้${status.at ? ` (ล่าสุด ${formatThaiDate(status.at)})` : ""}`;
  } else {
    text = "ยังไม่เคยเรียก Jira — กดทดสอบการเชื่อมต่อเพื่อตรวจ";
  }
  return (
    <p role="status" className={`rounded-xl px-4 py-3 text-[14px] font-medium ${tone}`}>
      {text}
    </p>
  );
}

function ConnectionPanel({ snapshot, onSaved }: { snapshot: JiraSnapshot; onSaved: () => void }) {
  const { config } = snapshot;
  const [enabled, setEnabled] = useState(config.enabled);
  const [domain, setDomain] = useState(config.domain);
  const [email, setEmail] = useState(config.email);
  const [token, setToken] = useState("");
  const [projectKey, setProjectKey] = useState(config.projectKey);
  const [doneStatus, setDoneStatus] = useState(config.doneStatus);
  const [archiveStatus, setArchiveStatus] = useState(config.archiveStatus);
  const [busy, setBusy] = useState<"save" | "test" | null>(null);
  const [error, setError] = useState<AdminErrorView | null>(null);
  const [test, setTest] = useState<TestResult | null>(null);
  const { show } = useToast();

  /** ค่าที่เปลี่ยนจากที่บันทึกไว้ — ส่งเฉพาะช่องที่เปลี่ยน token ส่งเฉพาะตอนพิมพ์ใหม่ */
  const changes = () => {
    const out: Record<string, string | boolean> = {};
    if (domain.trim() !== config.domain) out.domain = domain.trim();
    if (email.trim() !== config.email) out.email = email.trim();
    if (token.trim()) out.token = token.trim();
    if (projectKey.trim() !== config.projectKey) out.projectKey = projectKey.trim();
    if (doneStatus.trim() !== config.doneStatus) out.doneStatus = doneStatus.trim();
    if (archiveStatus.trim() !== config.archiveStatus) out.archiveStatus = archiveStatus.trim();
    return out;
  };
  const dirty = Object.keys(changes()).length > 0 || enabled !== config.enabled;

  const save = async () => {
    setBusy("save");
    setError(null);
    try {
      const body = { ...changes(), ...(enabled !== config.enabled ? { enabled } : {}) };
      const res = await api.put<{ message: string }>("/api/admin/settings/jira", body);
      show({ tone: "success", title: res.message });
      setToken("");
      onSaved();
    } catch (err) {
      setError(adminErrorView(err));
    } finally {
      setBusy(null);
    }
  };

  const runTest = async () => {
    setBusy("test");
    setError(null);
    setTest(null);
    try {
      // ทดสอบค่าที่อยู่ในฟอร์ม — ยังไม่บันทึกก็ทดสอบได้ ช่องที่ไม่ได้แก้ใช้ค่าที่บันทึกไว้
      const res = await api.post<TestResult>("/api/admin/settings/jira/test", changes());
      setTest(res);
      if (res.requeued > 0) show({ tone: "success", title: `ส่งงานที่ค้างอยู่ ${res.requeued} รายการอีกครั้ง` });
      onSaved();
    } catch (err) {
      setError(adminErrorView(err));
    } finally {
      setBusy(null);
    }
  };

  const field = (name: string) => error?.fields[name];

  return (
    <Panel
      title="การเชื่อมต่อ"
      description="เมื่อผู้ประสานงานของ BDI ขอความเห็นผู้เชี่ยวชาญ ระบบสร้างการ์ดใน Jira และคัดลอก comment กลับมาเมื่อการ์ดถึงสถานะ Done"
    >
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <StatusLine snapshot={snapshot} />

        <label className="flex items-start gap-3 text-[15px] text-ink">
          <input type="checkbox" className="mt-1" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          <span>
            <span className="font-medium">เชื่อมต่อ Jira</span>
            <span className="block text-[13px] text-ink-muted">ปิดอยู่ = ระบบทำงานแบบเดิมทุกอย่าง การ์ดที่สร้างไปแล้วคงอยู่ใน Jira ตามเดิม</span>
          </span>
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Jira domain"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="https://bdithailand.atlassian.net"
            error={field("domain")}
          />
          <TextField
            label="อีเมลบัญชี Jira"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="jira-vela@bdi.or.th"
            error={field("email")}
            hint="บัญชีที่ระบบใช้สร้างการ์ดและเขียน comment"
          />
          <PasswordField
            label="API token"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            autoComplete="new-password"
            placeholder={config.tokenSet ? "ตั้งไว้แล้ว — เว้นว่างเพื่อใช้ค่าเดิม" : "วาง API token ของบัญชีด้านบน"}
            error={field("token")}
            hint={
              config.tokenUnreadable
                ? "token ที่เก็บไว้อ่านไม่ได้แล้ว (กุญแจของเซิร์ฟเวอร์เปลี่ยน) กรุณากรอกใหม่"
                : "เก็บแบบเข้ารหัส ระบบไม่แสดง token ที่บันทึกไว้"
            }
          />
          <TextField
            label="Project key"
            value={projectKey}
            onChange={(e) => setProjectKey(e.target.value)}
            placeholder="D2S"
            error={field("projectKey")}
            hint="Space ที่สร้างการ์ด เช่น D2S (D2share)"
          />
          <TextField
            label="สถานะที่ถือว่าตรวจเสร็จ"
            value={doneStatus}
            onChange={(e) => setDoneStatus(e.target.value)}
            error={field("doneStatus")}
            hint="การ์ดถึงสถานะนี้ → คัดลอก comment เข้าประวัติของคำขอ"
          />
          <TextField
            label="สถานะสำหรับเก็บการ์ด"
            value={archiveStatus}
            onChange={(e) => setArchiveStatus(e.target.value)}
            error={field("archiveStatus")}
            hint="การ์ดที่ระบบเลิกติดตามก่อนตรวจเสร็จถูกย้ายไปสถานะนี้"
          />
        </div>

        {test ? (
          <div
            role="status"
            className={`rounded-xl px-4 py-3 text-[14px] ${test.ok ? "bg-success-bg" : "bg-danger-bg"}`}
          >
            <p className={`font-semibold ${test.ok ? "text-success" : "text-danger"}`}>
              {test.ok ? "เชื่อมต่อได้" : "เชื่อมต่อไม่สำเร็จ"}
            </p>
            <ul className="mt-1 space-y-0.5 text-ink">
              {test.steps.map((s) => (
                <li key={s.label}>
                  {s.ok ? "✓" : "✗"} {s.label}
                  {s.detail ? <span className="text-ink-muted"> — {s.detail}</span> : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {error ? (
          <ErrorNotice
            view={error}
            hideFields={["domain", "email", "token", "projectKey", "doneStatus", "archiveStatus"]}
          />
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[13px] text-ink-muted">
            {config.updatedAt
              ? `แก้ไขล่าสุด ${formatThaiDate(config.updatedAt)}${config.updatedBy ? ` โดย ${config.updatedBy}` : ""}`
              : "ยังไม่มีผู้ตั้งค่า"}
          </p>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" loading={busy === "test"} disabled={busy !== null} onClick={runTest}>
              ทดสอบการเชื่อมต่อ
            </Button>
            <Button type="submit" loading={busy === "save"} disabled={!dirty || busy !== null}>
              บันทึก
            </Button>
          </div>
        </div>
      </form>
    </Panel>
  );
}

const MIN_INTERVAL = 60;
const MAX_INTERVAL = 86_400;

/** ค่าตั้งระบบ `jira_sync_interval_seconds` — endpoint เดียวกับหน้าตั้งค่าระบบ แสดงที่นี่ด้วยเพื่อให้เรื่อง Jira อยู่ที่เดียว */
function IntervalPanel({ snapshot, onSaved }: { snapshot: JiraSnapshot; onSaved: () => void }) {
  const [text, setText] = useState(String(snapshot.syncIntervalSeconds));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AdminErrorView | null>(null);
  const { show } = useToast();

  const trimmed = text.trim();
  const parsed = /^\d+$/.test(trimmed) ? Number(trimmed) : null;
  const localError =
    trimmed !== "" && (parsed === null || parsed < MIN_INTERVAL || parsed > MAX_INTERVAL)
      ? `ต้องเป็นจำนวนเต็ม ${MIN_INTERVAL}–${MAX_INTERVAL.toLocaleString("th-TH")} วินาที`
      : undefined;

  const save = async () => {
    if (parsed === null) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.put<{ message: string }>("/api/admin/settings/jira_sync_interval_seconds", { value: parsed });
      show({ tone: "success", title: res.message });
      onSaved();
    } catch (err) {
      setError(adminErrorView(err));
    } finally {
      setBusy(false);
    }
  };

  const minutes = parsed !== null && parsed >= 60 ? ` (ประมาณ ${Math.round(parsed / 60).toLocaleString("th-TH")} นาที)` : "";

  return (
    <Panel
      title="ตรวจสถานะการ์ดทุก"
      description="ระบบถาม Jira เป็นระยะว่าการ์ดใบไหนถึงสถานะตรวจเสร็จแล้ว หนึ่งรอบใช้การค้นครั้งเดียว ไม่ว่าการ์ดจะเปิดอยู่กี่ใบ"
    >
      <form
        className="flex flex-wrap items-end gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="w-full max-w-xs">
          <TextField
            label="จำนวนวินาที"
            inputMode="numeric"
            value={text}
            onChange={(e) => setText(e.target.value)}
            error={localError ?? error?.fields.value}
            hint={`${MIN_INTERVAL}–${MAX_INTERVAL.toLocaleString("th-TH")} วินาที · ค่าเริ่มต้น 900${minutes}`}
          />
        </div>
        <Button type="submit" loading={busy} disabled={parsed === null || Boolean(localError) || parsed === snapshot.syncIntervalSeconds}>
          บันทึก
        </Button>
      </form>
      <p className="mt-3 text-[13px] text-ink-muted">
        {snapshot.status.lastSyncAt ? `ตรวจล่าสุด ${formatThaiDate(snapshot.status.lastSyncAt)}` : "ยังไม่เคยตรวจ"}
      </p>
      {error && !error.fields.value ? <ErrorNotice view={error} className="mt-3" /> : null}
    </Panel>
  );
}

const STATUS_META: Record<JiraOperationRow["status"], { label: string; className: string }> = {
  SUCCEEDED: { label: "สำเร็จ", className: "bg-success-bg text-success" },
  DEAD_LETTER: { label: "ล้มเหลว", className: "bg-danger-bg text-danger" },
  FAILED: { label: "รอลองใหม่", className: "bg-warning-bg text-warning" },
  PENDING: { label: "รอส่ง", className: "bg-canvas text-ink-muted" },
  PROCESSING: { label: "กำลังส่ง", className: "bg-canvas text-ink-muted" },
  CANCELLED: { label: "ยกเลิก", className: "bg-canvas text-ink-muted" },
};

function OperationsPanel({
  counts,
  round,
  onChanged,
}: {
  counts: { failed: number; pending: number };
  round: number;
  onChanged: () => void;
}) {
  const [filter, setFilter] = useState<Filter>(counts.failed > 0 ? "failed" : "all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [retrying, setRetrying] = useState<string | null>(null);
  const { show } = useToast();
  const { data, loading, error, reload } = useAdminData<{ total: number; operations: JiraOperationRow[] }>(
    `/api/admin/settings/jira/operations?status=${filter}&page=${page}&pageSize=${pageSize}&r=${round}`,
  );

  const retry = async (row: JiraOperationRow) => {
    setRetrying(row.id);
    try {
      const res = await api.post<{ message: string }>(`/api/admin/settings/jira/operations/${row.id}/retry`, {});
      show({ tone: "success", title: res.message });
      reload();
      onChanged();
    } catch (err) {
      const view = adminErrorView(err);
      show({ tone: "error", title: view.title, detail: view.message });
    } finally {
      setRetrying(null);
    }
  };

  const columns: Column<JiraOperationRow>[] = [
    {
      key: "at",
      header: "เวลา",
      cell: (r) => <span className="whitespace-nowrap">{formatThaiDate(r.lastAttemptAt ?? r.createdAt)}</span>,
    },
    {
      key: "request",
      header: "คำขอ",
      cell: (r) =>
        r.requestId ? (
          <Link href={`/console/registrations/datasets/${r.requestId}`} className="font-medium text-navy-700 hover:underline">
            {r.requestNumber ?? "—"}
          </Link>
        ) : (
          <span title="คำขอถูกลบไปแล้ว">{r.requestNumber ?? "—"}</span>
        ),
    },
    { key: "operation", header: "การทำงาน", cell: (r) => r.operationLabel },
    {
      key: "issue",
      header: "การ์ด",
      cell: (r) =>
        r.issueKey && r.issueUrl ? (
          <a href={r.issueUrl} target="_blank" rel="noreferrer" className="text-navy-700 hover:underline">
            {r.issueKey}
          </a>
        ) : (
          (r.issueKey ?? "–")
        ),
    },
    {
      key: "status",
      header: "ผล",
      cell: (r) => (
        <span className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12.5px] font-medium ${STATUS_META[r.status].className}`}>
          {STATUS_META[r.status].label}
        </span>
      ),
    },
    {
      key: "detail",
      header: "รายละเอียด",
      className: "min-w-[16rem]",
      cell: (r) => (
        <div className="space-y-1">
          {r.message ? <p className="text-[13.5px] text-ink">{r.message}</p> : null}
          {r.status === "FAILED" && r.nextRetryAt ? (
            <p className="text-[12.5px] text-ink-muted">
              ลองแล้ว {r.attemptCount} ครั้ง · ครั้งถัดไป {formatThaiDate(r.nextRetryAt)}
            </p>
          ) : null}
          {r.retryable ? (
            <Button
              variant="secondary"
              size="sm"
              loading={retrying === r.id}
              onClick={(e) => {
                e.stopPropagation();
                void retry(r);
              }}
            >
              ลองอีกครั้ง
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <Panel
      title="บันทึกการทำงานกับ Jira"
      description={`ทุกงานที่ระบบส่งไป Jira ย้อนหลัง 30 วัน — งานที่ล้มเหลวกด "ลองอีกครั้ง" ได้ ระบบลองใหม่เองก่อนจนครบ 24 ชั่วโมง`}
      flush
    >
      <div className="px-5 pt-3">
        <Tabs<Filter>
          tabs={[
            { key: "failed", label: "ล้มเหลว", count: counts.failed },
            { key: "pending", label: "รอลองใหม่", count: counts.pending },
            { key: "all", label: "ทั้งหมด" },
          ]}
          active={filter}
          onChange={(k) => {
            setFilter(k);
            setPage(1);
          }}
        />
      </div>
      {error ? <ErrorNotice view={adminErrorView(error)} className="m-5" /> : null}
      <DataTable
        columns={columns}
        rows={data?.operations ?? null}
        rowKey={(r) => r.id}
        loading={loading}
        empty={
          <EmptyState
            title={filter === "failed" ? "ไม่มีงานที่ล้มเหลว" : filter === "pending" ? "ไม่มีงานที่รออยู่" : "ยังไม่มีการทำงานกับ Jira"}
          />
        }
        page={page}
        pageSize={pageSize}
        total={data?.total}
        onPage={setPage}
        onPageSize={(n) => {
          setPageSize(n);
          setPage(1);
        }}
      />
    </Panel>
  );
}
