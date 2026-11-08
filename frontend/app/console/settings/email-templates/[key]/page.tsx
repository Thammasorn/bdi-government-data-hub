"use client";

import clsx from "clsx";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ActionDialog } from "@/components/console/ActionDialog";
import { EmailPreviewFrame } from "@/components/console/EmailPreviewFrame";
import {
  Badge,
  ErrorNotice,
  PageHeader,
  Panel,
  Tabs,
  WarningList,
} from "@/components/console/ui";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";
import { useToast } from "@/components/ui/Toast";
import { adminErrorView, type AdminErrorView } from "@/lib/admin-errors";
import { api } from "@/lib/api";
import {
  VERSION_STATUS,
  contentOf,
  lineDiff,
  sameContent,
  type ContentIssue,
  type PreviewResult,
  type TemplateContent,
  type TemplateDetail,
  type TemplateVersion,
} from "@/lib/email-templates";
import { formatThaiDate } from "@/lib/status";
import { useAdminData } from "@/lib/use-admin";

type FieldName = keyof TemplateContent;
type TabKey = "edit" | "history";

const EMPTY: TemplateContent = {
  subject: "",
  bodyHtml: "",
  buttonLabel: null,
  footnoteHtml: null,
};

/**
 * แก้เทมเพลตอีเมลหนึ่งฉบับ (การ์ด "[New Feature] Admin Email Template Edit", 2026-11-08)
 *
 * - เริ่มจากฉบับร่างถ้ามี ไม่งั้นจากเวอร์ชันที่ใช้งานอยู่ — **บันทึก** เขียนฉบับร่าง (อีเมลจริงยังไม่เปลี่ยน) **เผยแพร่** ต้องบันทึกก่อนและใส่เหตุผล
 * - preview render ที่ server ด้วยข้อมูลตัวอย่าง ทุกครั้งที่หยุดพิมพ์ 500 ms และตอบ issue กลับมา — หน้านี้ไม่มีสำเนากติกาการตรวจ
 * - ส่งอีเมลทดสอบส่งสิ่งที่อยู่ในช่องตอนนี้ (ยังไม่บันทึกก็ได้) ถึงอีเมลของผู้ดูแลที่ล็อกอินอยู่เท่านั้น
 * - ประวัติ: ดูตัวอย่าง เปรียบเทียบกับเวอร์ชันที่ใช้งานอยู่ และนำกลับมาเป็นฉบับร่าง
 */
export default function EmailTemplateEditorPage() {
  const { key } = useParams<{ key: string }>();
  const path = `/api/admin/email-templates/${key}`;
  const { data, error, loading, reload } = useAdminData<TemplateDetail>(path);
  const { show } = useToast();

  const [tab, setTab] = useState<TabKey>("edit");
  const [form, setForm] = useState<TemplateContent>(EMPTY);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [actionError, setActionError] = useState<AdminErrorView | null>(null);
  const [serverIssues, setServerIssues] = useState<ContentIssue[]>([]);
  const [publishOpen, setPublishOpen] = useState(false);

  const baseline = data
    ? contentOf(data.draft ?? data.live ?? data.versions[0]!)
    : EMPTY;
  // โหลดเนื้อหาลงช่องเมื่อข้อมูลเปลี่ยนรุ่น (หลังบันทึก/เผยแพร่/นำกลับ) — ไม่ทับสิ่งที่กำลังพิมพ์ระหว่างการโหลดซ้ำแบบอื่น
  const stamp = data
    ? `${data.draft?.versionNumber ?? "-"}:${data.draft?.updatedAt ?? ""}:${data.live?.versionNumber ?? 1}`
    : null;
  useEffect(() => {
    if (!data || stamp === loadedFor) return;
    setForm(baseline);
    setLoadedFor(stamp);
    setServerIssues([]);
    setActionError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stamp]);

  const dirty =
    data !== null && loadedFor !== null && !sameContent(form, baseline);

  // เตือนก่อนปิดแท็บถ้ามีสิ่งที่ยังไม่บันทึก
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const preview = usePreview(path, form, loadedFor !== null);

  if (loading && !data) return <Spinner />;
  if (error && !data) return <ErrorNotice view={adminErrorView(error)} />;
  if (!data) return null;

  const { template, draft, live } = data;
  const issues = serverIssues.length
    ? serverIssues
    : (preview.result?.issues ?? []);
  const fieldError = (f: FieldName) =>
    issues.filter((i) => i.field === f).map((i) => i.message)[0];

  const fail = (err: unknown) => {
    const view = adminErrorView(err);
    setActionError(view);
    const details = (err as { details?: { issues?: ContentIssue[] } }).details;
    setServerIssues(details?.issues ?? []);
  };

  const save = async () => {
    setSaving(true);
    setActionError(null);
    try {
      const res = await api.put<{ message: string; warnings: string[] }>(
        `${path}/draft`,
        form,
      );
      show({ tone: "success", title: res.message });
      setServerIssues([]);
      reload();
    } catch (err) {
      fail(err);
    } finally {
      setSaving(false);
    }
  };

  const testSend = async () => {
    setTesting(true);
    setActionError(null);
    try {
      const res = await api.post<{ message: string }>(`${path}/test-send`, {
        content: form,
      });
      show({ tone: "success", title: res.message });
    } catch (err) {
      fail(err);
    } finally {
      setTesting(false);
    }
  };

  const editingLabel = draft
    ? `กำลังแก้ฉบับร่าง (เวอร์ชัน ${draft.versionNumber})`
    : `เริ่มจากเวอร์ชันที่ใช้งานอยู่ (เวอร์ชัน ${live?.versionNumber ?? 1}) — บันทึกแล้วจะได้ฉบับร่างใหม่`;

  return (
    <div>
      <PageHeader
        back={{
          href: "/console/settings/email-templates",
          label: "เทมเพลตอีเมลทั้งหมด",
        }}
        eyebrow={template.groupLabel}
        title={template.label}
        description={template.description}
      />

      <Tabs<TabKey>
        tabs={[
          { key: "edit", label: "แก้ไข" },
          {
            key: "history",
            label: "ประวัติเวอร์ชัน",
            count: data.versions.length,
          },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === "edit" ? (
        <div className="mt-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-navy-50 px-4 py-3 text-[14px]">
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                meta={draft ? VERSION_STATUS.DRAFT : VERSION_STATUS.PUBLISHED}
              />
              <span className="text-ink">{editingLabel}</span>
              {dirty ? (
                <span className="font-medium text-warning">
                  · มีการแก้ไขที่ยังไม่บันทึก
                </span>
              ) : null}
            </div>
          </div>

          {/* แถวเดียว: เนื้อหาก่อน ตัวอย่างต่อท้าย — ตัวอย่างได้ความกว้างเต็ม เห็นอีเมลขนาดจริง */}
          <ContentEditor
            template={template}
            form={form}
            setForm={setForm}
            fieldError={fieldError}
          />
          <PreviewPanel preview={preview} />

          {/* ปุ่มอยู่ท้ายหน้า หลังตัวอย่าง — ผู้ดูแลแก้ ดูตัวอย่าง แล้วจึงตัดสินใจ ข้อผิดพลาดของปุ่มขึ้นเหนือปุ่ม */}
          {actionError ? <ErrorNotice view={actionError} /> : null}
          <div className="flex flex-wrap items-center justify-end gap-2 rounded-xl bg-navy-50 px-4 py-3">
            <Button
              size="sm"
              variant="ghost"
              disabled={!dirty || saving}
              onClick={() => {
                setForm(baseline);
                setServerIssues([]);
                setActionError(null);
              }}
            >
              ยกเลิกการแก้ไข
            </Button>
            <Button
              size="sm"
              variant="secondary"
              loading={testing}
              onClick={() => void testSend()}
            >
              ส่งอีเมลทดสอบถึงฉัน
            </Button>
            <Button
              size="sm"
              variant="secondary"
              loading={saving}
              disabled={!dirty}
              onClick={() => void save()}
            >
              บันทึกฉบับร่าง
            </Button>
            <Button
              size="sm"
              disabled={!draft || dirty}
              title={
                dirty
                  ? "บันทึกฉบับร่างก่อนเผยแพร่"
                  : !draft
                    ? "ยังไม่มีฉบับร่าง"
                    : undefined
              }
              onClick={() => setPublishOpen(true)}
            >
              เผยแพร่
            </Button>
          </div>
        </div>
      ) : (
        <HistoryTab
          path={path}
          detail={data}
          onRestored={() => {
            reload();
            setTab("edit");
          }}
        />
      )}

      <ActionDialog
        open={publishOpen}
        onClose={() => setPublishOpen(false)}
        title={`เผยแพร่ฉบับร่าง (เวอร์ชัน ${draft?.versionNumber ?? ""})`}
        description={`อีเมล "${template.label}" ฉบับถัดไปที่ระบบส่งจะใช้เนื้อหานี้ทันที เวอร์ชัน ${live?.versionNumber ?? 1} ที่ใช้งานอยู่จะเก็บไว้ในประวัติและนำกลับมาใช้ได้`}
        confirmLabel="เผยแพร่"
        reasonHint="เหตุผลนี้แสดงในประวัติเวอร์ชันและถูกบันทึกไว้เป็นหลักฐาน"
        onConfirm={async (reason) => {
          const res = await api.post<{ message: string }>(`${path}/publish`, {
            reason,
          });
          show({ tone: "success", title: res.message });
          reload();
        }}
      />
    </div>
  );
}

// ------------------------------------------------------------------ preview

function usePreview(path: string, form: TemplateContent, enabled: boolean) {
  const [result, setResult] = useState<PreviewResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AdminErrorView | null>(null);
  const serial = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    const mine = ++serial.current;
    const timer = setTimeout(() => {
      setBusy(true);
      api
        .post<PreviewResult>(
          `${path}/preview`,
          { content: form },
          { background: true },
        )
        .then((r) => {
          if (mine === serial.current) {
            setResult(r);
            setError(null);
          }
        })
        .catch((err) => {
          if (mine === serial.current) setError(adminErrorView(err));
        })
        .finally(() => {
          if (mine === serial.current) setBusy(false);
        });
    }, 500);
    return () => clearTimeout(timer);
  }, [path, form, enabled]);

  return { result, busy, error };
}

function PreviewPanel({ preview }: { preview: ReturnType<typeof usePreview> }) {
  const { result, busy, error } = preview;
  return (
    <div>
      <Panel
        title="ตัวอย่าง"
        description="แสดงด้วยข้อมูลตัวอย่าง (ไม่ใช่ข้อมูลจริง) อัปเดตเมื่อหยุดพิมพ์"
        actions={
          busy ? (
            <span className="text-[12.5px] text-ink-subtle">
              กำลังสร้างตัวอย่าง…
            </span>
          ) : null
        }
      >
        {error ? <ErrorNotice view={error} className="mb-3" /> : null}
        {result ? (
          <div className="space-y-3">
            {result.issues.length ? (
              <div
                role="alert"
                className="rounded-xl bg-danger-bg px-4 py-3 text-[13.5px]"
              >
                <p className="font-semibold text-danger">
                  บันทึกไม่ได้จนกว่าจะแก้ {result.issues.length} ข้อ
                </p>
                <ul className="mt-1 list-disc pl-5 text-ink">
                  {result.issues.map((i, n) => (
                    <li key={n}>{i.message}</li>
                  ))}
                </ul>
                <p className="mt-1 text-[12.5px] text-ink-muted">
                  ตัวอย่างด้านล่างแสดงผลหลังระบบตัดส่วนที่ไม่อนุญาตออกแล้ว
                </p>
              </div>
            ) : null}
            <WarningList warnings={result.warnings} />
            <EmailPreviewFrame
              subject={result.subject}
              html={result.html}
              bytes={result.bytes}
            />
          </div>
        ) : (
          <Spinner />
        )}
      </Panel>
    </div>
  );
}

// ------------------------------------------------------------------ ช่องแก้ไข

function ContentEditor({
  template,
  form,
  setForm,
  fieldError,
}: {
  template: TemplateDetail["template"];
  form: TemplateContent;
  setForm: (f: TemplateContent) => void;
  fieldError: (f: FieldName) => string | undefined;
}) {
  const refs = {
    subject: useRef<HTMLInputElement>(null),
    bodyHtml: useRef<HTMLTextAreaElement>(null),
    buttonLabel: useRef<HTMLInputElement>(null),
    footnoteHtml: useRef<HTMLTextAreaElement>(null),
  };
  /**
   * ช่องและตำแหน่ง cursor ล่าสุด — จำไว้ทุกครั้งที่เลือก/พิมพ์ เพราะเปิด popup แล้วช่องเสียโฟกัส (popup โฟกัสช่องค้นหาของตัวเอง)
   * ค่าเริ่มต้นคือท้ายเนื้อหา
   */
  const caret = useRef<{ field: FieldName; start: number; end: number } | null>(
    null,
  );
  const [paletteOpen, setPaletteOpen] = useState(false);

  const set = (field: FieldName, value: string) =>
    setForm({ ...form, [field]: value });

  const remember =
    (field: FieldName) =>
    (e: { currentTarget: HTMLInputElement | HTMLTextAreaElement }) => {
      caret.current = {
        field,
        start: e.currentTarget.selectionStart ?? 0,
        end: e.currentTarget.selectionEnd ?? 0,
      };
    };
  // onBlur คือตัวที่สำคัญที่สุด: กดปุ่มเปิด popup แล้วช่องเสียโฟกัส ตำแหน่ง ณ ตอนนั้นคือที่ที่ผู้ดูแลตั้งใจจะแทรก
  const track = (field: FieldName) => ({
    onSelect: remember(field),
    onFocus: remember(field),
    onKeyUp: remember(field),
    onMouseUp: remember(field),
    onBlur: remember(field),
  });

  /** แทรก placeholder ที่ตำแหน่ง cursor ที่จำไว้ — บล็อก (และช่องที่ใส่ตัวแปรไม่ได้) ลงช่องเนื้อหา */
  const insert = useCallback(
    (token: string, bodyOnly: boolean) => {
      const remembered = caret.current;
      const field: FieldName =
        !remembered || bodyOnly ? "bodyHtml" : remembered.field;
      const value = form[field] ?? "";
      const usePos = remembered && remembered.field === field;
      const start = usePos
        ? Math.min(remembered.start, value.length)
        : value.length;
      const end = usePos
        ? Math.min(remembered.end, value.length)
        : value.length;
      const next = value.slice(0, start) + token + value.slice(end);
      setForm({ ...form, [field]: next });
      caret.current = {
        field,
        start: start + token.length,
        end: start + token.length,
      };
      setPaletteOpen(false);
      requestAnimationFrame(() => {
        const el = refs[field].current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(start + token.length, start + token.length);
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [form, setForm],
  );

  const bodyLines = useMemo(
    () => Math.min(40, Math.max(16, form.bodyHtml.split("\n").length + 2)),
    [form.bodyHtml],
  );

  return (
    <div className="space-y-4">
      <Panel
        title="เนื้อหา"
        actions={
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setPaletteOpen(true)}
          >
            แทรกตัวแปร / บล็อก
          </Button>
        }
      >
        <div className="space-y-4">
          {template.isLayout ? null : (
            <TextField
              ref={refs.subject}
              label="หัวเรื่อง"
              value={form.subject}
              onChange={(e) => set("subject", e.target.value)}
              {...track("subject")}
              error={fieldError("subject")}
              hint="ข้อความล้วน ใช้ตัวแปรได้ (ไม่ใช้บล็อก)"
            />
          )}
          <div>
            <label
              htmlFor="email-body"
              className="mb-1.5 block text-[14px] font-medium text-ink"
            >
              {template.isLayout ? "แม่แบบกลาง (HTML)" : "เนื้อหา (HTML)"}
            </label>
            <textarea
              id="email-body"
              ref={refs.bodyHtml}
              value={form.bodyHtml}
              onChange={(e) => set("bodyHtml", e.target.value)}
              {...track("bodyHtml")}
              rows={bodyLines}
              spellCheck={false}
              aria-invalid={fieldError("bodyHtml") ? true : undefined}
              className={clsx(
                "w-full rounded-xl border bg-white px-3 py-2.5 font-mono text-[12.5px] leading-relaxed text-ink outline-none focus:ring-2",
                fieldError("bodyHtml")
                  ? "border-danger focus:ring-danger/30"
                  : "border-line focus:ring-navy-200",
              )}
            />
            <p className="mt-1 text-[12.5px] text-ink-subtle">
              Gmail และ Outlook ตัด &lt;style&gt; ทิ้ง — ใส่สีและขนาดด้วย
              style="…" ในแต่ละแท็ก ลิงก์ต้องขึ้นต้นด้วย https:// หรือ mailto:
            </p>
            {fieldError("bodyHtml") ? (
              <p className="mt-1 text-[13px] text-danger">
                {fieldError("bodyHtml")}
              </p>
            ) : null}
          </div>
          {template.hasButton ? (
            <TextField
              ref={refs.buttonLabel}
              label="ข้อความบนปุ่ม"
              value={form.buttonLabel ?? ""}
              onChange={(e) => set("buttonLabel", e.target.value)}
              {...track("buttonLabel")}
              error={fieldError("buttonLabel")}
              hint="ลิงก์ของปุ่มมาจากระบบเสมอ แก้ได้แค่ข้อความ"
            />
          ) : null}
          {template.isLayout ? null : (
            <div>
              <label
                htmlFor="email-footnote"
                className="mb-1.5 block text-[14px] font-medium text-ink"
              >
                หมายเหตุท้ายอีเมล (HTML)
              </label>
              <textarea
                id="email-footnote"
                ref={refs.footnoteHtml}
                value={form.footnoteHtml ?? ""}
                onChange={(e) => set("footnoteHtml", e.target.value)}
                {...track("footnoteHtml")}
                rows={3}
                spellCheck={false}
                className={clsx(
                  "w-full rounded-xl border bg-white px-3 py-2.5 font-mono text-[12.5px] leading-relaxed text-ink outline-none focus:ring-2",
                  fieldError("footnoteHtml")
                    ? "border-danger focus:ring-danger/30"
                    : "border-line focus:ring-navy-200",
                )}
              />
              <p className="mt-1 text-[12.5px] text-ink-subtle">
                แสดงในส่วนท้ายของแม่แบบกลาง ({"{{footnote}}"})
              </p>
              {fieldError("footnoteHtml") ? (
                <p className="mt-1 text-[13px] text-danger">
                  {fieldError("footnoteHtml")}
                </p>
              ) : null}
            </div>
          )}
        </div>
      </Panel>

      <PalettePopup
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        template={template}
        onPick={insert}
      />
    </div>
  );
}

/**
 * popup ตัวแปรและบล็อก — กดหนึ่งรายการแล้วแทรกที่ตำแหน่ง cursor ที่จำไว้และปิด popup
 * ช่องค้นหากรองทั้งชื่อตัวแปรและคำอธิบาย (เทมเพลตชุดข้อมูลมีตัวแปรสิบกว่าตัว)
 */
function PalettePopup({
  open,
  onClose,
  template,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  template: TemplateDetail["template"];
  onPick: (token: string, bodyOnly: boolean) => void;
}) {
  const [q, setQ] = useState("");
  useEffect(() => {
    if (open) setQ("");
  }, [open]);
  const match = (item: { token: string; label: string }) =>
    !q.trim() ||
    `${item.token} ${item.label}`
      .toLowerCase()
      .includes(q.trim().toLowerCase());

  const layout = template.layoutPlaceholders
    .map((p) => ({ token: `{{${p.name}}}`, label: p.label }))
    .filter(match);
  const blocks = template.blocks
    .map((b) => ({
      token: `{{block.${b.name}}}`,
      label: b.label,
      required: b.required,
    }))
    .filter(match);
  const vars = template.variables
    .map((v) => ({ token: `{{${v.name}}}`, label: v.label, sample: v.sample }))
    .filter(match);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="แทรกตัวแปร / บล็อก"
      description="กดเพื่อแทรกที่ตำแหน่ง cursor ล่าสุด — บล็อกแทรกได้เฉพาะในเนื้อหา"
      size="lg"
    >
      <div className="space-y-4">
        <TextField
          label="ค้นหา"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="เช่น หน่วยงาน, request"
        />
        {layout.length ? (
          <PaletteGroup
            title="ตำแหน่งในแม่แบบกลาง"
            items={layout}
            onPick={(t) => onPick(t, true)}
          />
        ) : null}
        {blocks.length ? (
          <PaletteGroup
            title="บล็อกของระบบ (วางตำแหน่งได้ แก้เนื้อในไม่ได้)"
            items={blocks}
            onPick={(t) => onPick(t, true)}
          />
        ) : null}
        {vars.length ? (
          <PaletteGroup
            title="ตัวแปร (ระบบ escape ให้ — แทรก HTML ผ่านตัวแปรไม่ได้)"
            items={vars}
            onPick={(t) => onPick(t, false)}
          />
        ) : null}
        {!layout.length && !blocks.length && !vars.length ? (
          <p className="text-[14px] text-ink-muted">
            ไม่พบรายการที่ตรงกับ "{q}"
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

function PaletteGroup({
  title,
  items,
  onPick,
}: {
  title: string;
  items: Array<{
    token: string;
    label: string;
    sample?: string;
    required?: boolean;
  }>;
  onPick: (token: string) => void;
}) {
  return (
    <div>
      <p className="mb-2 text-[12.5px] font-semibold text-ink-subtle">
        {title}
      </p>
      <ul className="space-y-1">
        {items.map((item) => (
          <li key={item.token}>
            <button
              type="button"
              // mousedown ไม่ขโมยโฟกัสจากช่องที่กำลังพิมพ์ — ตำแหน่ง cursor จึงยังอยู่
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onPick(item.token)}
              className="flex w-full flex-wrap items-baseline gap-x-2 rounded-lg px-2 py-1.5 text-left hover:bg-navy-50"
            >
              <code className="rounded bg-navy-50 px-1.5 py-0.5 font-mono text-[12.5px] text-navy-700">
                {item.token}
              </code>
              <span className="text-[13px] text-ink-muted">{item.label}</span>
              {item.required ? (
                <span className="text-[12px] font-semibold text-coral-600">
                  ต้องมี
                </span>
              ) : null}
              {item.sample ? (
                <span className="text-[12px] text-ink-subtle">
                  เช่น {item.sample}
                </span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ------------------------------------------------------------------ ประวัติ

function HistoryTab({
  path,
  detail,
  onRestored,
}: {
  path: string;
  detail: TemplateDetail;
  onRestored: () => void;
}) {
  const { show } = useToast();
  const [compare, setCompare] = useState<TemplateVersion | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<TemplateVersion | null>(
    null,
  );
  const live = detail.live;

  return (
    <div className="mt-6 space-y-6">
      <Panel
        title="ทุกเวอร์ชัน"
        description="ไม่มีการลบเวอร์ชัน — นำกลับมาใช้จะคัดลอกเป็นฉบับร่างใหม่ ประวัติเดิมไม่เปลี่ยน"
        flush
      >
        <ul className="divide-y divide-line">
          {detail.versions.map((v) => (
            <li
              key={v.versionNumber}
              className="flex flex-col gap-3 px-5 py-4 lg:flex-row lg:items-start lg:justify-between"
            >
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[15px] font-semibold text-navy-800">
                    เวอร์ชัน {v.versionNumber}
                  </span>
                  <Badge meta={VERSION_STATUS[v.status]} />
                  {v.isDefault ? (
                    <span className="text-[12.5px] text-ink-subtle">
                      เนื้อหาตั้งต้นของระบบ
                    </span>
                  ) : null}
                </div>
                <p className="text-[13px] text-ink-muted">
                  {v.createdAt
                    ? `บันทึก ${formatThaiDate(v.updatedAt ?? v.createdAt)} โดย ${v.updatedByName ?? "—"}`
                    : "ยังไม่มีผู้แก้ไข"}
                  {v.publishedAt
                    ? ` · เผยแพร่ ${formatThaiDate(v.publishedAt)} โดย ${v.publishedByName ?? "—"}`
                    : ""}
                </p>
                {v.publishReason ? (
                  <p className="text-[13.5px] text-ink">
                    เหตุผล: {v.publishReason}
                  </p>
                ) : null}
                {v.restoredFromVersion ? (
                  <p className="text-[13.5px] text-ink">
                    คัดลอกจากเวอร์ชัน {v.restoredFromVersion}
                    {v.restoreReason ? ` — ${v.restoreReason}` : ""}
                  </p>
                ) : null}
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setCompare(v)}
                >
                  {v.status === "PUBLISHED" ? "ดูตัวอย่าง" : "ดูและเปรียบเทียบ"}
                </Button>
                {v.status !== "DRAFT" && v.status !== "PUBLISHED" ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setRestoreTarget(v)}
                  >
                    นำกลับมาใช้
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </Panel>

      {compare ? (
        <CompareView
          path={path}
          selected={compare}
          live={live}
          onClose={() => setCompare(null)}
        />
      ) : null}

      <ActionDialog
        open={restoreTarget !== null}
        onClose={() => setRestoreTarget(null)}
        title={`นำเวอร์ชัน ${restoreTarget?.versionNumber ?? ""} กลับมาใช้`}
        description={
          detail.draft
            ? `ระบบจะคัดลอกเนื้อหาของเวอร์ชันนี้ไปเขียนทับฉบับร่าง (เวอร์ชัน ${detail.draft.versionNumber}) ที่มีอยู่ อีเมลจริงยังไม่เปลี่ยนจนกว่าจะกดเผยแพร่`
            : "ระบบจะคัดลอกเนื้อหาของเวอร์ชันนี้เป็นฉบับร่างใหม่ อีเมลจริงยังไม่เปลี่ยนจนกว่าจะกดเผยแพร่"
        }
        confirmLabel="คัดลอกเป็นฉบับร่าง"
        reasonHint="เหตุผลนี้แสดงในประวัติเวอร์ชันและถูกบันทึกไว้เป็นหลักฐาน"
        onConfirm={async (reason) => {
          const res = await api.post<{ message: string }>(
            `${path}/versions/${restoreTarget!.versionNumber}/restore`,
            { reason },
          );
          show({ tone: "success", title: res.message });
          setCompare(null);
          onRestored();
        }}
      />
    </div>
  );
}

function useVersionPreview(path: string, versionNumber: number | null) {
  const [result, setResult] = useState<PreviewResult | null>(null);
  const [error, setError] = useState<AdminErrorView | null>(null);
  useEffect(() => {
    if (versionNumber === null) return;
    let alive = true;
    setResult(null);
    api
      .post<PreviewResult>(`${path}/preview`, { versionNumber })
      .then((r) => alive && setResult(r))
      .catch((err) => alive && setError(adminErrorView(err)));
    return () => {
      alive = false;
    };
  }, [path, versionNumber]);
  return { result, error };
}

function CompareView({
  path,
  selected,
  live,
  onClose,
}: {
  path: string;
  selected: TemplateVersion;
  live: TemplateVersion | null;
  onClose: () => void;
}) {
  const same = live === null || live.versionNumber === selected.versionNumber;
  const left = useVersionPreview(path, selected.versionNumber);
  const right = useVersionPreview(path, same ? null : live!.versionNumber);
  const [mode, setMode] = useState<"preview" | "source">("preview");

  return (
    <Panel
      title={
        same
          ? `ตัวอย่างเวอร์ชัน ${selected.versionNumber}`
          : `เปรียบเทียบเวอร์ชัน ${selected.versionNumber} กับเวอร์ชันที่ใช้งานอยู่ (${live!.versionNumber})`
      }
      actions={
        <div className="flex gap-2">
          {same ? null : (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setMode(mode === "preview" ? "source" : "preview")}
            >
              {mode === "preview" ? "ดูความต่างของโค้ด" : "ดูตัวอย่าง"}
            </Button>
          )}
          <Button size="sm" variant="secondary" onClick={onClose}>
            ปิด
          </Button>
        </div>
      }
    >
      {mode === "source" && !same ? (
        <SourceDiff before={live!} after={selected} />
      ) : (
        <div className={clsx("grid gap-6", same ? "" : "lg:grid-cols-2")}>
          <PreviewColumn
            title={`เวอร์ชัน ${selected.versionNumber}`}
            state={left}
          />
          {same ? null : (
            <PreviewColumn
              title={`ใช้งานอยู่ (เวอร์ชัน ${live!.versionNumber})`}
              state={right}
            />
          )}
        </div>
      )}
    </Panel>
  );
}

function PreviewColumn({
  title,
  state,
}: {
  title: string;
  state: ReturnType<typeof useVersionPreview>;
}) {
  return (
    <div className="min-w-0">
      <p className="mb-2 text-[13px] font-semibold text-ink-muted">{title}</p>
      {state.error ? <ErrorNotice view={state.error} /> : null}
      {state.result ? (
        <EmailPreviewFrame
          subject={state.result.subject}
          html={state.result.html}
          bytes={state.result.bytes}
        />
      ) : state.error ? null : (
        <Spinner />
      )}
    </div>
  );
}

/** ความต่างทีละบรรทัด — ซ้าย/บนคือเวอร์ชันที่ใช้งานอยู่ (ลบ = แดง) เวอร์ชันที่เลือก (เพิ่ม = เขียว) */
function SourceDiff({
  before,
  after,
}: {
  before: TemplateContent;
  after: TemplateContent;
}) {
  const fields: Array<{ field: FieldName; label: string }> = [
    { field: "subject", label: "หัวเรื่อง" },
    { field: "bodyHtml", label: "เนื้อหา" },
    { field: "buttonLabel", label: "ข้อความบนปุ่ม" },
    { field: "footnoteHtml", label: "หมายเหตุท้ายอีเมล" },
  ];
  return (
    <div className="space-y-5">
      <p className="text-[13px] text-ink-muted">
        <span className="rounded bg-danger-bg px-1 text-danger">− แดง</span>{" "}
        มีในเวอร์ชันที่ใช้งานอยู่ ·{" "}
        <span className="rounded bg-success-bg px-1 text-success">+ เขียว</span>{" "}
        มีในเวอร์ชันที่เลือก
      </p>
      {fields.map(({ field, label }) => {
        const a = before[field] ?? "";
        const b = after[field] ?? "";
        return (
          <div key={field}>
            <p className="mb-1.5 text-[13px] font-semibold text-ink-muted">
              {label}
              {a === b ? (
                <span className="ml-2 font-normal text-ink-subtle">
                  ไม่ต่าง
                </span>
              ) : null}
            </p>
            {a === b ? null : (
              <pre className="max-h-[32rem] overflow-auto rounded-xl border border-line bg-white p-3 font-mono text-[12px] leading-relaxed">
                {lineDiff(a, b).map((line, n) => (
                  <div
                    key={n}
                    className={clsx(
                      "whitespace-pre-wrap break-all",
                      line.kind === "added" && "bg-success-bg text-success",
                      line.kind === "removed" && "bg-danger-bg text-danger",
                      line.kind === "same" && "text-ink-muted",
                    )}
                  >
                    {line.kind === "added"
                      ? "+ "
                      : line.kind === "removed"
                        ? "− "
                        : "  "}
                    {line.text}
                  </div>
                ))}
              </pre>
            )}
          </div>
        );
      })}
    </div>
  );
}
