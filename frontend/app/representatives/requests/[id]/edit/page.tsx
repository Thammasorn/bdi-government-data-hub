"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { RepresentativePicker } from "@/components/representatives/RepresentativePicker";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { SelectField, TextField } from "@/components/ui/Field";
import { FileUpload, type UploadedFile } from "@/components/ui/FileUpload";
import { FormStepper } from "@/components/ui/FormStepper";
import { IncompleteGate, type IncompleteItem } from "@/components/ui/IncompleteGate";
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
import { MAX_PHONE_EXTENSION } from "@/lib/organization-form";
import { useRequireAuth } from "@/lib/require-auth";
import { PREFIXES } from "@/lib/status";

const SECTIONS = [
  { id: "section-1", tag: "ส่วนที่ 1", title: "ยกเลิกรายชื่อผู้แทนเดิม" },
  { id: "section-2", tag: "ส่วนที่ 2", title: "เพิ่มรายชื่อผู้แทนใหม่" },
  { id: "section-3", tag: "ส่วนที่ 3", title: "เอกสารแนบ" },
];

const INCOMPLETE_HINT_ID = "representative-change-incomplete";

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
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState<Set<number>>(new Set());
  const [problem, setProblem] = useState<string | null>(null);

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
            email: null,
            phoneNumber: null,
            phoneNumberExtension: null,
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

  if (loading || !user) return <Spinner />;
  if (problem) return <p className="p-10 text-center text-danger">{problem}</p>;
  if (!request) return <Spinner />;

  const available = people.filter((p) => !selected.includes(keyOf(p)));
  const chosen = selected.flatMap((key) => people.filter((p) => keyOf(p) === key));
  const invalid = additions.map(validateAddition);
  const hasItems = selected.length > 0 || additions.length > 0;
  const missing: IncompleteItem[] = [
    ...(hasItems
      ? []
      : [
          {
            key: "items",
            section: "ส่วนที่ 1–2",
            label: "ผู้แทน",
            message: "กรุณาระบุผู้แทนที่ต้องการยกเลิกหรือเพิ่มอย่างน้อย 1 รายการ",
          },
        ]),
    ...invalid.flatMap((errors, index) =>
      Object.entries(errors).map(([field, message]) => ({
        key: `addition-${index}-${field}`,
        section: "ส่วนที่ 2",
        label: `ผู้แทนลำดับที่ ${index + 1}`,
        message: message as string,
      })),
    ),
    ...(file
      ? []
      : [
          {
            key: "letter",
            section: "ส่วนที่ 3",
            label: "เอกสารแนบ",
            message: "กรุณาแนบหนังสือนำและฟอร์มแจ้งรายละเอียด",
          },
        ]),
  ];
  const additionsValid = invalid.every((errors) => Object.keys(errors).length === 0);
  // ส่วนที่ 1 กับ 2 ไม่บังคับทีละส่วน มีส่วนใดส่วนหนึ่งก็ครบ แต่คนใหม่ที่กรอกค้างไว้ยังนับว่าไม่ครบ
  const itemsDone = hasItems && additionsValid;
  const completion = {
    [SECTIONS[0].id]: itemsDone,
    [SECTIONS[1].id]: itemsDone,
    [SECTIONS[2].id]: file !== null,
  };
  const revisionNote =
    request.status === "RETURNED"
      ? [...request.timeline].reverse().find((t) => t.result === "RETURNED")?.note
      : null;

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
    if (missing.length > 0) return;
    setSaving(true);
    try {
      await save();
      router.push(`/representatives/requests/${id}/preview`);
    } catch (err) {
      show({ tone: "error", title: "บันทึกไม่สำเร็จ", detail: err instanceof ApiError ? err.message : undefined });
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
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <Breadcrumb
        items={[
          { label: "ผู้แทนหน่วยงาน", href: "/representatives" },
          { label: "ฟอร์มเปลี่ยนแปลงผู้แทนหน่วยงาน", href: "/representatives/requests" },
          { label: request.requestNumber, href: `/representatives/requests/${id}` },
          { label: "แก้ไขคำขอ" },
        ]}
      />

      <header className="mb-8 mt-4">
        <h1 className="text-[26px] font-semibold text-navy-800">คำขอเปลี่ยนแปลงผู้แทนหน่วยงาน</h1>
        <p className="mt-1.5 text-[15px] text-ink-muted">กรอกรายการยกเลิกและเพิ่มผู้แทน แล้วแนบหนังสือนำ</p>
      </header>

      {revisionNote ? (
        <div className="mb-7 rounded-xl border-l-[3px] border-danger bg-danger-bg p-5">
          <p className="text-[13px] font-semibold text-danger">สิ่งที่ต้องแก้ไขตามที่ BDI แจ้ง</p>
          <p className="mt-1.5 whitespace-pre-wrap break-words text-[15px] leading-relaxed text-ink">{revisionNote}</p>
        </div>
      ) : null}

      <div className="grid gap-8 lg:grid-cols-[220px_minmax(0,1fr)]">
        <FormStepper sections={SECTIONS} completion={completion} />

        <div className="flex flex-col gap-6">
          <Card id={SECTIONS[0].id} className="scroll-mt-24">
            <CardHeader tag={SECTIONS[0].tag} title={SECTIONS[0].title} description="เลือกผู้แทนเดิมที่ต้องการยกเลิก (ถ้ามี)" />
            <div className="grid gap-4 p-6">
              <RepresentativePicker
                options={available}
                onPick={(person) => setSelected((current) => [...current, keyOf(person)])}
              />
              {chosen.length ? (
          <ol className="space-y-2">
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
            </div>
          </Card>

          <Card id={SECTIONS[1].id} className="scroll-mt-24">
            <CardHeader tag={SECTIONS[1].tag} title={SECTIONS[1].title} description="เพิ่มผู้แทนใหม่ของหน่วยงาน (ถ้ามี)" />
            <div className="grid gap-6 p-6">
              {additions.map((row, index) => {
                const errors = touched.has(index) ? invalid[index] : {};
                return (
                  <div
                    key={row.id ?? `new-${index}`}
                    onBlur={() => setTouched((rows) => new Set(rows).add(index))}
                    className="grid gap-5 rounded-xl p-5 ring-1 ring-line"
                  >
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold text-navy-800">ผู้แทนลำดับที่ {index + 1}</p>
                      <Button size="sm" variant="ghost" onClick={() => setAdditions((r) => r.filter((_, i) => i !== index))}>
                        เอาออก
                      </Button>
                    </div>
                    <SelectField
                  label="บทบาท"
                  required
                  value={row.roleCode}
                  error={errors.roleCode}
                  onChange={(e) => update(index, { roleCode: e.target.value })}
                >
                  <option value="">เลือกบทบาท</option>
                  {ROLE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </SelectField>
                    <div className="grid gap-5 sm:grid-cols-[10rem_minmax(0,1fr)_minmax(0,1fr)]">
                      <SelectField
                  label="คำนำหน้า"
                  required
                  value={row.prefixTh}
                  error={errors.prefixTh}
                  onChange={(e) => update(index, { prefixTh: e.target.value })}
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
                    </div>
                    <TextField label="เลขประจำตัวประชาชน" required inputMode="numeric" maxLength={13} value={row.cid} error={errors.cid} onChange={(e) => update(index, { cid: e.target.value.replace(/\D/g, "") })} />
                    <div className="grid gap-5 sm:grid-cols-2">
                      <TextField label="ตำแหน่ง" required value={row.positionTh} error={errors.positionTh} onChange={(e) => update(index, { positionTh: e.target.value })} />
                      <TextField label="ฝ่าย/กอง/สำนัก" required value={row.departmentTh} error={errors.departmentTh} onChange={(e) => update(index, { departmentTh: e.target.value })} />
                    </div>
                    <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_8rem]">
                      <TextField label="อีเมล" required type="email" value={row.email} error={errors.email} onChange={(e) => update(index, { email: e.target.value })} />
                      <TextField label="เบอร์โทรศัพท์" required inputMode="tel" value={row.phoneNumber} error={errors.phoneNumber} onChange={(e) => update(index, { phoneNumber: e.target.value })} />
                      <TextField label="ต่อ" inputMode="numeric" maxLength={MAX_PHONE_EXTENSION} value={row.phoneNumberExtension} onChange={(e) => update(index, { phoneNumberExtension: e.target.value.replace(/\D/g, "") })} />
                    </div>
                  </div>
                );
              })}
              <div>
                <Button variant="secondary" onClick={() => setAdditions((r) => [...r, emptyAddition()])}>
                  + เพิ่มผู้แทน
                </Button>
              </div>
            </div>
          </Card>

          <Card id={SECTIONS[2].id} className="scroll-mt-24">
            <CardHeader tag={SECTIONS[2].tag} title={SECTIONS[2].title} />
            <div className="p-6">
              <FileUpload
          label="แนบหนังสือนำและฟอร์มแจ้งรายละเอียดผู้มีอำนาจและผู้ประสานงานของหน่วยงานที่ขอเปลี่ยนแปลง"
          required
          value={file}
          uploading={uploading}
          removing={removing}
          onSelect={upload}
          onRemove={removeFile}
        />
            </div>
          </Card>

          <div className="sticky bottom-0 -mx-4 rounded-t-2xl border-t border-line bg-white px-4 py-4 shadow-[0_-4px_16px_rgb(20_26_51_/_0.06)] sm:mx-0 sm:px-6">
            <IncompleteGate
              items={missing}
              actionLabel="ตรวจสอบข้อมูล"
              hintId={INCOMPLETE_HINT_ID}
              secondaryAction={
                <Button type="button" variant="secondary" loading={saving} onClick={saveDraft}>
                  บันทึกแบบร่าง
                </Button>
              }
            >
              <Button
                type="button"
                loading={saving}
                disabled={missing.length > 0}
                aria-describedby={missing.length > 0 ? INCOMPLETE_HINT_ID : undefined}
                onClick={openPreview}
              >
                ตรวจสอบข้อมูล
              </Button>
            </IncompleteGate>
          </div>
        </div>
      </div>
    </div>
  );
}
