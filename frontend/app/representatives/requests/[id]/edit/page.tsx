"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { HeadcountTable, RepresentativeShell } from "@/components/representatives/Shell";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { SelectField, TextField } from "@/components/ui/Field";
import { FileUpload, type UploadedFile } from "@/components/ui/FileUpload";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";
import { useToast } from "@/components/ui/Toast";
import { api, ApiError } from "@/lib/api";
import {
  emptyAddition,
  ROLE_OPTIONS,
  validateAddition,
  type AdditionForm,
  type ChangeDetail,
  type Representative,
} from "@/lib/representatives";
import { useRequireAuth } from "@/lib/require-auth";
import { PREFIXES } from "@/lib/status";

const keyOf = (p: { userRoleAssignmentId: string | null; activationKeyId: string | null }) =>
  p.userRoleAssignmentId ?? p.activationKeyId ?? "";

export default function ChangeRequestFormPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { show } = useToast();
  const { user, loading } = useRequireAuth();

  const [request, setRequest] = useState<ChangeDetail | null>(null);
  const [people, setPeople] = useState<Representative[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [additions, setAdditions] = useState<AdditionForm[]>([]);
  const [file, setFile] = useState<UploadedFile | null>(null);
  const [search, setSearch] = useState("");
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);

  useEffect(() => {
    if (loading || !user) return;
    Promise.all([
      api.get<{ request: ChangeDetail }>(`/api/representative-changes/${id}`),
      api.get<{ representatives: Representative[] }>("/api/representative-changes/representatives"),
    ])
      .then(([{ request: loaded }, { representatives }]) => {
        if (!loaded.canEdit) {
          router.replace(`/representatives/requests/${id}`);
          return;
        }
        setRequest(loaded);
        // คนที่เลือกไว้แล้วอาจไม่อยู่ในรายชื่อปัจจุบัน แต่ยังต้องเห็นเพื่อเอาออกได้
        const known = new Set(representatives.map(keyOf));
        const stale: Representative[] = loaded.removals
          .filter((r) => !known.has(keyOf(r)))
          .map((r) => ({
            kind: r.pendingInvitee ? "INVITED" : "HOLDER",
            accountStatus: "",
            userRoleAssignmentId: r.userRoleAssignmentId,
            activationKeyId: r.activationKeyId,
            userAccountId: "",
            prefixTh: null,
            firstnameTh: null,
            lastnameTh: null,
            name: r.name,
            positionTh: r.positionTh,
            departmentTh: r.departmentTh,
            roleCode: r.roleCode ?? "",
            roleLabel: r.roleLabel ?? "",
            openRequests: [],
          }));
        setPeople([...representatives, ...stale]);
        setSelected(loaded.removals.map(keyOf));
        setAdditions(
          loaded.additions.map((a) => ({
            id: a.id,
            roleCode: a.roleCode,
            prefixTh: a.prefixTh ?? "",
            firstnameTh: a.firstnameTh ?? "",
            lastnameTh: a.lastnameTh ?? "",
            cid: a.cid ?? "",
            email: a.email ?? "",
            phoneNumber: a.phoneNumber ?? "",
            phoneNumberExtension: a.phoneNumberExtension ?? "",
            positionTh: a.positionTh ?? "",
            departmentTh: a.departmentTh ?? "",
          })),
        );
        setFile(loaded.attachment);
      })
      .catch((err: Error) => setProblem(err.message));
  }, [id, loading, user, router]);

  const matches = useMemo(() => {
    const term = search.trim();
    return people.filter((p) => !selected.includes(keyOf(p)) && (!term || p.name.includes(term)));
  }, [people, search, selected]);

  if (loading || !user) return <Spinner />;
  if (problem) return <p className="p-10 text-center text-danger">{problem}</p>;
  if (!request) return <Spinner />;

  const chosen = selected.flatMap((key) => people.filter((p) => keyOf(p) === key));
  const invalid = additions.map(validateAddition);
  const hasItems = selected.length > 0 || additions.length > 0;
  const formValid = hasItems && file !== null && invalid.every((e) => Object.keys(e).length === 0);

  const update = (index: number, patch: Partial<AdditionForm>) =>
    setAdditions((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  /** บันทึกร่าง แล้วใช้คำตอบของ server เป็นค่าปัจจุบัน — id ของแถวใหม่มาจากตรงนี้ */
  const save = async () => {
    const body = {
      removals: chosen.map((p) => ({
        userRoleAssignmentId: p.userRoleAssignmentId,
        activationKeyId: p.activationKeyId,
      })),
      additions: additions.filter((a) => a.roleCode).map((a) => ({ ...a, id: a.id })),
    };
    const { request: fresh } = await api.patch<{ request: ChangeDetail }>(`/api/representative-changes/${id}`, body);
    setRequest(fresh);
    setAdditions((rows) => {
      let next = 0;
      return rows.map((row) => {
        if (!row.roleCode) return row;
        const saved = fresh.additions[next];
        next += 1;
        return { ...row, id: saved?.id ?? row.id };
      });
    });
    return fresh;
  };

  const saveDraft = async () => {
    setSaving(true);
    try {
      await save();
      show({ tone: "success", title: "บันทึกร่างแล้ว" });
    } catch (err) {
      show({ tone: "error", title: "บันทึกไม่สำเร็จ", detail: err instanceof ApiError ? err.message : undefined });
    } finally {
      setSaving(false);
    }
  };

  const openPreview = async () => {
    setShowErrors(true);
    if (!formValid) return;
    setSaving(true);
    try {
      await save();
      setPreviewing(true);
    } catch (err) {
      show({ tone: "error", title: "บันทึกไม่สำเร็จ", detail: err instanceof ApiError ? err.message : undefined });
    } finally {
      setSaving(false);
    }
  };

  const submit = async () => {
    setShowErrors(true);
    if (!formValid) return;
    setSaving(true);
    try {
      await save();
      await api.post(`/api/representative-changes/${id}/submit`, {});
      show({ tone: "success", title: "นำส่งคำขอแล้ว" });
      router.push(`/representatives/requests/${id}`);
    } catch (err) {
      setPreviewing(false);
      const fields = err instanceof ApiError ? Object.values(err.fields) : [];
      show({
        tone: "error",
        title: "นำส่งไม่สำเร็จ",
        detail: fields[0] ?? (err instanceof ApiError ? err.message : undefined),
      });
    } finally {
      setSaving(false);
    }
  };

  const upload = async (picked: File) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", picked);
      const { attachment } = await api.upload<{ attachment: UploadedFile }>(
        `/api/representative-changes/${id}/attachments`,
        form,
      );
      setFile(attachment);
    } catch (err) {
      show({ tone: "error", title: "แนบไฟล์ไม่สำเร็จ", detail: err instanceof ApiError ? err.message : undefined });
    } finally {
      setUploading(false);
    }
  };

  const removeFile = async () => {
    if (!file) return;
    setRemoving(true);
    try {
      await api.del(`/api/representative-changes/${id}/attachments/${file.id}`);
      setFile(null);
    } catch (err) {
      show({ tone: "error", title: "ลบไฟล์ไม่สำเร็จ", detail: err instanceof ApiError ? err.message : undefined });
    } finally {
      setRemoving(false);
    }
  };

  return (
    <RepresentativeShell title={`คำขอ ${request.requestNumber}`} description="กรอกรายการยกเลิกและเพิ่มผู้แทน แล้วแนบหนังสือนำ">
      {request.status === "RETURNED" ? (
        <Card className="mb-4 bg-warning-bg px-5 py-4">
          <p className="text-sm font-medium text-ink">BDI ส่งกลับให้แก้ไข</p>
          <p className="text-sm text-ink">
            {[...request.timeline].reverse().find((t) => t.result === "RETURNED")?.comment}
          </p>
        </Card>
      ) : null}

      <Card className="mb-4 px-5 py-5">
        <h2 className="mb-3 font-semibold text-navy-800">ส่วนที่ 1 ยกเลิกรายชื่อผู้แทนเดิม</h2>
        <TextField
          label="ค้นหาจากชื่อ"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="พิมพ์ชื่อหรือนามสกุล"
        />
        {matches.length ? (
          <ul className="mt-2 max-h-56 overflow-y-auto rounded-xl ring-1 ring-line">
            {matches.map((person) => (
              <li key={keyOf(person)} className="border-b border-line last:border-0">
                <button
                  type="button"
                  onClick={() => setSelected((s) => [...s, keyOf(person)])}
                  className="w-full px-4 py-2 text-left text-sm hover:bg-navy-50"
                >
                  {person.name}
                  {person.kind === "INVITED" ? " (รอเปิดใช้งาน)" : ""}
                  <span className="text-ink-muted"> · {person.roleLabel}</span>
                  {person.openRequests.length ? (
                    <span className="block text-[13px] text-coral-700">
                      อยู่ในคำขอ {person.openRequests.join(", ")} ที่ยังไม่จบ
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {chosen.length ? (
          <ol className="mt-4 space-y-2">
            {chosen.map((person, index) => (
              <li key={keyOf(person)} className="flex items-start justify-between gap-3 rounded-xl bg-navy-50 px-4 py-3 text-sm">
                <span>
                  {index + 1}. {person.name}
                  {person.kind === "INVITED" ? " (รอเปิดใช้งาน)" : ""}
                  <span className="block text-ink-muted">
                    {[person.positionTh, person.departmentTh].filter(Boolean).join(" / ") || "–"} · {person.roleLabel}
                  </span>
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setSelected((s) => s.filter((key) => key !== keyOf(person)))}
                >
                  เอาออก
                </Button>
              </li>
            ))}
          </ol>
        ) : null}
      </Card>

      <Card className="mb-4 px-5 py-5">
        <h2 className="mb-3 font-semibold text-navy-800">ส่วนที่ 2 เพิ่มรายชื่อผู้แทนใหม่</h2>
        {additions.map((row, index) => {
          const errors = showErrors ? invalid[index] : {};
          return (
            <div key={row.id ?? `new-${index}`} className="mb-4 rounded-xl p-4 ring-1 ring-line">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-medium">ผู้แทนลำดับที่ {index + 1}</p>
                <Button size="sm" variant="ghost" onClick={() => setAdditions((r) => r.filter((_, i) => i !== index))}>
                  เอาออก
                </Button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <SelectField
                  label="บทบาท"
                  required
                  value={row.roleCode}
                  error={errors.roleCode}
                  onChange={(e) => update(index, { roleCode: e.target.value })}
                  className="sm:col-span-2"
                >
                  <option value="">เลือกบทบาท</option>
                  {ROLE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </SelectField>
                <SelectField
                  label="คำนำหน้า"
                  required
                  value={row.prefixTh}
                  error={errors.prefixTh}
                  onChange={(e) => update(index, { prefixTh: e.target.value })}
                  className="sm:col-span-2"
                >
                  <option value="">เลือกคำนำหน้า</option>
                  {PREFIXES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </SelectField>
                <TextField label="ชื่อ" required value={row.firstnameTh} error={errors.firstnameTh} onChange={(e) => update(index, { firstnameTh: e.target.value })} />
                <TextField label="นามสกุล" required value={row.lastnameTh} error={errors.lastnameTh} onChange={(e) => update(index, { lastnameTh: e.target.value })} />
                <TextField label="เลขประจำตัวประชาชน" required inputMode="numeric" maxLength={13} value={row.cid} error={errors.cid} onChange={(e) => update(index, { cid: e.target.value.replace(/\D/g, "") })} />
                <TextField label="ตำแหน่ง" required value={row.positionTh} error={errors.positionTh} onChange={(e) => update(index, { positionTh: e.target.value })} />
                <TextField label="ฝ่าย/กอง/สำนัก" required value={row.departmentTh} error={errors.departmentTh} onChange={(e) => update(index, { departmentTh: e.target.value })} />
                <TextField label="email" required type="email" value={row.email} error={errors.email} onChange={(e) => update(index, { email: e.target.value })} />
                <TextField label="เบอร์โทรศัพท์" required inputMode="numeric" value={row.phoneNumber} error={errors.phoneNumber} onChange={(e) => update(index, { phoneNumber: e.target.value })} />
                <TextField label="ต่อ" inputMode="numeric" value={row.phoneNumberExtension} onChange={(e) => update(index, { phoneNumberExtension: e.target.value.replace(/\D/g, "") })} />
              </div>
            </div>
          );
        })}
        <Button variant="secondary" onClick={() => setAdditions((r) => [...r, emptyAddition()])}>
          + เพิ่มผู้แทน
        </Button>
      </Card>

      <Card className="mb-4 px-5 py-5">
        <h2 className="mb-3 font-semibold text-navy-800">ส่วนที่ 3 เอกสารแนบ</h2>
        <FileUpload
          label="แนบหนังสือนำและฟอร์มแจ้งรายละเอียดผู้มีอำนาจและผู้ประสานงานของหน่วยงานที่ขอเปลี่ยนแปลง"
          required
          value={file}
          uploading={uploading}
          removing={removing}
          error={showErrors && !file ? "กรุณาแนบหนังสือนำและฟอร์มแจ้งรายละเอียด" : undefined}
          onSelect={upload}
          onRemove={removeFile}
        />
      </Card>

      {showErrors && !hasItems ? (
        <p className="mb-3 text-sm text-danger">กรุณาระบุผู้แทนที่ต้องการยกเลิกหรือเพิ่มอย่างน้อยหนึ่งรายการ</p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" onClick={() => router.push("/representatives/requests")}>
          Close
        </Button>
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" onClick={saveDraft} loading={saving}>
            Save Draft
          </Button>
          <Button variant="secondary" onClick={openPreview} loading={saving}>
            Preview
          </Button>
          <Button onClick={submit} loading={saving}>
            Submit
          </Button>
        </div>
      </div>

      <Modal open={previewing} onClose={() => setPreviewing(false)} title="ตรวจสอบก่อนนำส่ง" size="lg">
        <div className="space-y-4 text-sm">
          <section>
            <h3 className="mb-1 font-semibold">ส่วนที่ 1 ยกเลิกรายชื่อผู้แทนเดิม</h3>
            {chosen.length ? (
              <ol className="list-decimal pl-5">
                {chosen.map((p) => (
                  <li key={keyOf(p)}>
                    {p.name} · {p.roleLabel}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-ink-muted">ไม่มี</p>
            )}
          </section>
          <section>
            <h3 className="mb-1 font-semibold">ส่วนที่ 2 เพิ่มรายชื่อผู้แทนใหม่</h3>
            {additions.length ? (
              <ol className="list-decimal pl-5">
                {additions.map((a, i) => (
                  <li key={a.id ?? i}>
                    {a.prefixTh} {a.firstnameTh} {a.lastnameTh} · {ROLE_OPTIONS.find((o) => o.value === a.roleCode)?.label} · {a.email}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-ink-muted">ไม่มี</p>
            )}
          </section>
          <section>
            <h3 className="mb-1 font-semibold">ส่วนที่ 3 เอกสารแนบ</h3>
            <p>{file?.filename}</p>
          </section>
          <section>
            <h3 className="mb-1 font-semibold">จำนวนหลังดำเนินการ (ข้อมูลเท่านั้น)</h3>
            <HeadcountTable rows={request.headcount} />
          </section>
          <div className="flex justify-between gap-3 pt-2">
            <Button variant="ghost" onClick={() => setPreviewing(false)}>
              Close
            </Button>
            <Button onClick={submit} loading={saving}>
              Submit
            </Button>
          </div>
        </div>
      </Modal>
    </RepresentativeShell>
  );
}
