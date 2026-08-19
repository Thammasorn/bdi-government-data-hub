"use client";

import clsx from "clsx";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import { useSession } from "@/components/SessionProvider";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { SelectField, TextField } from "@/components/ui/Field";
import { FileUpload, type UploadedFile } from "@/components/ui/FileUpload";
import { Spinner } from "@/components/ui/Spinner";
import { useToast } from "@/components/ui/Toast";
import { api, ApiError } from "@/lib/api";
import { useRequireAuth } from "@/lib/require-auth";
import { PREFIXES } from "@/lib/status";
import type { Attachment } from "@/lib/types";

/**
 * ชื่อช่องเอกสารบนฟอร์ม → ชนิดไฟล์แนบใน attachment.attachment
 *
 * สองชื่อนี้ไม่ตรงกันสำหรับคำสั่งแต่งตั้ง และไม่ควรตรงกัน: ฝั่งซ้ายคือชื่อช่องที่
 * ข้อความ validation จาก API อ้างถึง (`fields.APPOINTMENT_ORDER`) ส่วนฝั่งขวาคือ
 * ค่าใน enum AttachmentType ที่สคีมาใช้ตามชื่อใน Excel และเป็นค่าที่ API ส่งกลับ
 * มาใน `kind`
 *
 * เดิมหน้านี้ใช้ชื่อช่องไปค้นในลิสต์ไฟล์แนบตรง ๆ จึงไม่มีวันเจอ — ผู้ใช้ที่ถูก
 * ส่งคำขอกลับมาแก้เห็นช่องอัปโหลดว่างเปล่าและต้องแนบไฟล์เดิมซ้ำ ทั้งที่ไฟล์
 * ยังอยู่ครบ
 */
const ATTACHMENT_KIND = {
  APPOINTMENT_ORDER: "AUTHORIZED_REPRESENTATIVE_APPOINTMENT_ORDER",
  POWER_OF_ATTORNEY: "POWER_OF_ATTORNEY",
} as const satisfies Record<string, Attachment["kind"]>;

type AttachmentSlot = keyof typeof ATTACHMENT_KIND;

const EMPTY = {
  organizationCode: "",
  name: "",
  addressLine: "",
  road: "",
  province: "",
  district: "",
  subdistrict: "",
  postalCode: "",
  email: "",
  signatoryPrefix: "",
  signatoryFirstName: "",
  signatoryLastName: "",
  signatoryPosition: "",
  signatoryEmail: "",
  signatoryNationalId: "",
  signatoryPhone: "",
  contactPrefix: "",
  contactFirstName: "",
  contactLastName: "",
  contactPosition: "",
  contactDepartment: "",
  contactEmail: "",
  contactPhone: "",
};
type FormState = typeof EMPTY;

/**
 * สถานะที่ยังแก้ฟอร์มได้ — ตรงกับที่ backend ยอมรับใน PATCH /:id และ POST /:id/submit
 *
 * เมื่อนำส่งไปแล้วหน้านี้ต้องไม่เปิดให้แก้อีก เดิมไม่ได้ดูสถานะเลย ผู้ใช้ที่กด back
 * หรือเปิดลิงก์เดิมค้างไว้จึงกลับเข้ามาแก้ได้ เห็นปุ่มบันทึก แล้วกดไปเจอ error ว่า
 * "คำขอนี้นำส่งไปแล้ว" — เสียเวลากรอกไปเปล่า ๆ แล้วยังดูเหมือนระบบพัง
 * หน้ารายละเอียดเป็นฉบับอ่านอย่างเดียวที่มีทั้งข้อมูลและเอกสารข้อตกลงครบอยู่แล้ว
 * จึงพาไปที่นั่นแทนการทำฟอร์มอ่านอย่างเดียวขึ้นมาอีกชุด
 */
const EDITABLE_STATUSES = new Set(["DRAFT", "RETURNED"]);

const SECTIONS = [
  { id: "section-1", tag: "ส่วนที่ 1", title: "ข้อมูลหน่วยงาน" },
  { id: "section-2", tag: "ส่วนที่ 2", title: "ผู้มีอำนาจกระทำการแทน" },
  { id: "section-3", tag: "ส่วนที่ 3", title: "ผู้กรอกข้อมูล" },
];

/**
 * ช่องที่ไม่บังคับกรอก — ไม่นับตอนติ๊ก "กรอกครบแล้ว"
 *
 * ต้องตรงกับ `submitSchema` ใน backend/src/routes/organizations.ts ซึ่งเป็นตัวตัดสินจริงว่า
 * นำส่งได้หรือยัง ตอนเพิ่มช่อง "ถนน" เข้ามาใน SECTION_FIELDS แล้วลืมข้อนี้ ส่วนที่ 1 ก็ไม่เคย
 * ขึ้นเครื่องหมายถูกเลยจนกว่าจะกรอกถนน ทั้งที่กรอกช่องบังคับครบแล้วและกดนำส่งได้อยู่แล้ว
 * — เครื่องหมายที่ไม่ตรงกับความจริงทำให้ผู้ใช้ไปหาว่ายังขาดอะไรทั้งที่ไม่ขาด
 */
const OPTIONAL_FIELDS: ReadonlySet<keyof FormState> = new Set<keyof FormState>(["road"]);

const SECTION_FIELDS: Record<string, Array<keyof FormState>> = {
  "section-1": ["organizationCode", "name", "addressLine", "road", "province", "district", "subdistrict", "postalCode", "email"],
  "section-2": [
    "signatoryPrefix",
    "signatoryFirstName",
    "signatoryLastName",
    "signatoryPosition",
    "signatoryEmail",
    "signatoryNationalId",
    "signatoryPhone",
  ],
  "section-3": [
    "contactPrefix",
    "contactFirstName",
    "contactLastName",
    "contactPosition",
    "contactDepartment",
    "contactEmail",
    "contactPhone",
  ],
};

/**
 * id มาจาก path ไม่ใช่ query string — useSearchParams() ยังว่างในเรนเดอร์แรก
 * ทำให้เคยหลุดไป router.replace("/") แล้วโดนหน้าแรกเด้งต่อไปหน้า detail
 */
export default function EditOrganizationPage() {
  const router = useRouter();
  const { id: orgId } = useParams<{ id: string }>();
  const { user, loading: sessionLoading } = useRequireAuth();
  const { refresh } = useSession();
  const { show } = useToast();

  const [form, setForm] = useState<FormState>(EMPTY);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [revisionNote, setRevisionNote] = useState<string | null>(null);

  const [appointment, setAppointment] = useState<UploadedFile | null>(null);
  const [powerOfAttorney, setPowerOfAttorney] = useState<UploadedFile | null>(null);
  const [uploadingKind, setUploadingKind] = useState<string | null>(null);

  const [provinces, setProvinces] = useState<string[]>([]);
  const [amphoes, setAmphoes] = useState<string[]>([]);
  const [subdistricts, setSubdistricts] = useState<Array<{ name: string; zipcode: string }>>([]);

  const formRef = useRef<HTMLFormElement>(null);

  // ---------- โหลดข้อมูลเดิม ----------
  useEffect(() => {
    if (sessionLoading || !user) return;
    api
      .get<{ organization: Record<string, unknown> & { attachments: Array<{ id: string; kind: Attachment["kind"]; filename: string; sizeBytes: number }> } }>(
        `/api/organizations/${orgId}`,
      )
      .then(({ organization }) => {
        if (!EDITABLE_STATUSES.has(String(organization.status))) {
          show({
            tone: "info",
            title: "คำขอนี้นำส่งแล้ว จึงแก้ไขไม่ได้",
            detail: "เปิดหน้ารายละเอียดเพื่อดูข้อมูลที่นำส่งและเอกสารข้อตกลง",
          });
          router.replace(`/organizations/${String(organization.id)}`);
          return;
        }
        const next = { ...EMPTY };
        for (const key of Object.keys(EMPTY) as Array<keyof FormState>) {
          const value = organization[key];
          if (typeof value === "string") next[key] = value;
        }
        setForm(next);
        setRevisionNote((organization.revisionNote as string | null) ?? null);
        const find = (slot: AttachmentSlot) =>
          organization.attachments.find((a) => a.kind === ATTACHMENT_KIND[slot]) ?? null;
        setAppointment(find("APPOINTMENT_ORDER"));
        setPowerOfAttorney(find("POWER_OF_ATTORNEY"));
      })
      .catch(() => show({ tone: "error", title: "โหลดข้อมูลไม่สำเร็จ" }))
      .finally(() => setLoading(false));
  }, [sessionLoading, user, orgId, router, show]);

  // ---------- dropdown ที่อยู่แบบลูกโซ่ ----------
  useEffect(() => {
    api.get<{ provinces: string[] }>("/api/address/provinces").then((d) => setProvinces(d.provinces)).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!form.province) {
      setAmphoes([]);
      return;
    }
    api
      .get<{ amphoes: string[] }>(`/api/address/amphoes?province=${encodeURIComponent(form.province)}`)
      .then((d) => setAmphoes(d.amphoes))
      .catch(() => undefined);
  }, [form.province]);

  useEffect(() => {
    if (!form.province || !form.district) {
      setSubdistricts([]);
      return;
    }
    api
      .get<{ subdistricts: Array<{ name: string; zipcode: string }> }>(
        `/api/address/subdistricts?province=${encodeURIComponent(form.province)}&amphoe=${encodeURIComponent(form.district)}`,
      )
      .then((d) => setSubdistricts(d.subdistricts))
      .catch(() => undefined);
  }, [form.province, form.district]);

  const set = useCallback(
    (key: keyof FormState, value: string) => {
      setForm((f) => {
        const next = { ...f, [key]: value };
        // เปลี่ยนจังหวัด/อำเภอแล้วต้องล้างระดับที่ลึกกว่า ไม่งั้นได้ที่อยู่ที่ไม่มีจริง
        if (key === "province") Object.assign(next, { district: "", subdistrict: "", postalCode: "" });
        if (key === "district") Object.assign(next, { subdistrict: "", postalCode: "" });
        if (key === "subdistrict") {
          next.postalCode = subdistricts.find((s) => s.name === value)?.zipcode ?? "";
        }
        return next;
      });
      setFields((f) => (f[key] ? { ...f, [key]: "" } : f));
    },
    [subdistricts],
  );

  const completion = useMemo(() => {
    const done: Record<string, boolean> = {};
    for (const [id, keys] of Object.entries(SECTION_FIELDS)) {
      done[id] = keys
        .filter((k) => !OPTIONAL_FIELDS.has(k))
        .every((k) => form[k].trim().length > 0);
    }
    return done;
  }, [form]);

  // ---------- actions ----------
  const persist = async () => {
    if (!orgId) return null;
    const payload = Object.fromEntries(Object.entries(form).filter(([, v]) => v !== ""));
    return api.patch<{ organization: unknown }>(`/api/organizations/${orgId}`, payload);
  };

  const saveDraft = async () => {
    setSaving(true);
    try {
      await persist();
      show({ tone: "success", title: "บันทึกฉบับร่างแล้ว", detail: "กลับมากรอกต่อได้ภายหลัง" });
    } catch (err) {
      handleApiError(err);
    } finally {
      setSaving(false);
    }
  };

  const uploadFile = async (kind: AttachmentSlot, file: File) => {
    if (!orgId) return;
    if (file.size > 10 * 1024 * 1024) {
      show({ tone: "error", title: "ไฟล์ใหญ่เกินไป", detail: "ขนาดไฟล์ต้องไม่เกิน 10 MB" });
      return;
    }
    setUploadingKind(kind);
    const fd = new FormData();
    fd.append("file", file);
    // ส่งค่าใน enum ไม่ใช่ชื่อช่อง — API รับชื่อย่อได้ด้วยเพื่อความเข้ากันได้ย้อนหลัง
    // แต่ชื่อที่ตรงกับสคีมาคือค่านี้ และเป็นค่าเดียวกับที่มันส่งกลับมา
    fd.append("kind", ATTACHMENT_KIND[kind]);
    try {
      const { attachment } = await api.upload<{ attachment: UploadedFile }>(
        `/api/organizations/${orgId}/attachments`,
        fd,
      );
      if (kind === "APPOINTMENT_ORDER") setAppointment(attachment);
      else setPowerOfAttorney(attachment);
      setFields((f) => ({ ...f, [kind]: "" }));
      show({ tone: "success", title: "อัปโหลดไฟล์แล้ว" });
    } catch (err) {
      handleApiError(err);
    } finally {
      setUploadingKind(null);
    }
  };

  const handleApiError = (err: unknown) => {
    if (!(err instanceof ApiError)) return;
    setFields(err.fields);
    const count = Object.keys(err.fields).length;
    // สเปก: ถ้าข้อมูลที่กรอกไม่ถูกต้อง จะมี toast เตือน
    show({
      tone: "error",
      title: count > 0 ? "ข้อมูลยังไม่ถูกต้อง" : "ดำเนินการไม่สำเร็จ",
      detail: count > 0 ? `กรุณาตรวจสอบ ${count} รายการที่ทำเครื่องหมายไว้` : err.message,
    });
    if (count > 0) {
      const first = Object.keys(err.fields)[0];
      requestAnimationFrame(() => {
        formRef.current
          ?.querySelector<HTMLElement>(`[data-field="${first}"]`)
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    }
  };

  const generateForm = async (e: FormEvent) => {
    e.preventDefault();
    if (!orgId) return;
    setGenerating(true);
    setFields({});
    try {
      await persist();
      await api.post(`/api/organizations/${orgId}/generate-form`);
      await refresh();
      router.push(`/organizations/${orgId}/preview`);
    } catch (err) {
      handleApiError(err);
      setGenerating(false);
    }
  };

  if (sessionLoading || loading) return <Spinner />;

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <header className="mb-8">
        <h1 className="text-[26px] font-semibold text-navy-800">สร้างหน่วยงาน</h1>
        <p className="mt-1.5 text-[15px] text-ink-muted">
          กรอกข้อมูลให้ครบทั้งสามส่วน ระบบจะสร้างแบบฟอร์ม PDF ให้ตรวจสอบก่อนนำส่ง
        </p>
      </header>

      {revisionNote ? (
        <div className="mb-7 rounded-xl border-l-[3px] border-danger bg-danger-bg p-5">
          <p className="text-[13px] font-semibold text-danger">สิ่งที่ต้องแก้ไขตามที่ผู้ตรวจสอบระบุ</p>
          <p className="mt-1.5 whitespace-pre-wrap break-words text-[15px] leading-relaxed text-ink">{revisionNote}</p>
        </div>
      ) : null}

      <div className="grid gap-8 lg:grid-cols-[220px_minmax(0,1fr)]">
        <Stepper completion={completion} />

        <form ref={formRef} onSubmit={generateForm} className="flex flex-col gap-6" noValidate>
          {/* ---------------- ส่วนที่ 1 ---------------- */}
          <Card id={SECTIONS[0].id} className="scroll-mt-24">
            <CardHeader tag={SECTIONS[0].tag} title={SECTIONS[0].title} description="ข้อมูลทั่วไปและที่ตั้งของหน่วยงาน" />
            <div className="grid gap-5 p-6">
              <Wrap name="organizationCode">
                <TextField label="รหัสหน่วยงาน" required value={form.organizationCode} onChange={(e) => set("organizationCode", e.target.value)} error={fields.organizationCode} hint="เจ้าหน้าที่กรอกไว้ให้แล้ว ตรวจสอบและแก้ไขได้หากไม่ถูกต้อง" />
              </Wrap>
              <Wrap name="name">
                <TextField label="ชื่อหน่วยงาน" required value={form.name} onChange={(e) => set("name", e.target.value)} error={fields.name} placeholder="เช่น สำนักงานปลัดกระทรวงสาธารณสุข" />
              </Wrap>
              {/* เอกสาร A0 แยกช่อง "ตั้งอยู่เลขที่ ___ ถนน ___" ตามแบบฟอร์มราชการ
                  ฟอร์มจึงต้องแยกสองช่องด้วย ไม่งั้นช่องถนนในข้อตกลงจะว่างตลอดไป */}
              <Wrap name="addressLine">
                <TextField label="ที่อยู่ (เลขที่ / อาคาร / ซอย)" required value={form.addressLine} onChange={(e) => set("addressLine", e.target.value)} error={fields.addressLine} />
              </Wrap>
              <Wrap name="road">
                <TextField label="ถนน" hint="เว้นว่างได้ถ้าที่อยู่ไม่มีชื่อถนน" value={form.road} onChange={(e) => set("road", e.target.value)} error={fields.road} />
              </Wrap>
              <div className="grid gap-5 sm:grid-cols-3">
                <Wrap name="province">
                  <SelectField label="จังหวัด" required value={form.province} onChange={(e) => set("province", e.target.value)} error={fields.province}>
                    <option value="">เลือกจังหวัด</option>
                    {provinces.map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </SelectField>
                </Wrap>
                <Wrap name="district">
                  <SelectField label="อำเภอ/เขต" required disabled={!form.province} value={form.district} onChange={(e) => set("district", e.target.value)} error={fields.district}>
                    <option value="">{form.province ? "เลือกอำเภอ/เขต" : "เลือกจังหวัดก่อน"}</option>
                    {amphoes.map((a) => (
                      <option key={a} value={a}>{a}</option>
                    ))}
                  </SelectField>
                </Wrap>
                <Wrap name="subdistrict">
                  <SelectField label="ตำบล/แขวง" required disabled={!form.district} value={form.subdistrict} onChange={(e) => set("subdistrict", e.target.value)} error={fields.subdistrict}>
                    <option value="">{form.district ? "เลือกตำบล/แขวง" : "เลือกอำเภอก่อน"}</option>
                    {subdistricts.map((s) => (
                      <option key={s.name} value={s.name}>{s.name}</option>
                    ))}
                  </SelectField>
                </Wrap>
              </div>
              <div className="grid gap-5 sm:grid-cols-2">
                <Wrap name="postalCode">
                  <TextField label="รหัสไปรษณีย์" required inputMode="numeric" maxLength={5} value={form.postalCode} onChange={(e) => set("postalCode", e.target.value)} error={fields.postalCode} hint="เติมอัตโนมัติเมื่อเลือกตำบล" />
                </Wrap>
                <Wrap name="email">
                  <TextField label="อีเมลหน่วยงาน" required type="email" value={form.email} onChange={(e) => set("email", e.target.value)} error={fields.email} placeholder="contact@agency.go.th" />
                </Wrap>
              </div>
            </div>
          </Card>

          {/* ---------------- ส่วนที่ 2 ---------------- */}
          <Card id={SECTIONS[1].id} className="scroll-mt-24">
            <CardHeader tag={SECTIONS[1].tag} title={SECTIONS[1].title} description="ผู้ที่จะลงนามรับรองการสร้างหน่วยงานนี้" />
            <div className="grid gap-5 p-6">
              <PersonFields prefixKey="signatoryPrefix" firstKey="signatoryFirstName" lastKey="signatoryLastName" form={form} fields={fields} set={set} />
              <div className="grid gap-5 sm:grid-cols-2">
                <Wrap name="signatoryPosition">
                  <TextField label="ตำแหน่ง" required value={form.signatoryPosition} onChange={(e) => set("signatoryPosition", e.target.value)} error={fields.signatoryPosition} />
                </Wrap>
                <Wrap name="signatoryEmail">
                  <TextField label="อีเมล" required type="email" value={form.signatoryEmail} onChange={(e) => set("signatoryEmail", e.target.value)} error={fields.signatoryEmail} hint="ระบบจะส่งคำขอให้ลงนามไปที่อีเมลนี้" />
                </Wrap>
              </div>
              <div className="grid gap-5 sm:grid-cols-2">
                <Wrap name="signatoryNationalId">
                  <TextField label="เลขบัตรประชาชน" required inputMode="numeric" maxLength={13} value={form.signatoryNationalId} onChange={(e) => set("signatoryNationalId", e.target.value.replace(/\D/g, ""))} error={fields.signatoryNationalId} hint="ตัวเลข 13 หลัก" />
                </Wrap>
                <Wrap name="signatoryPhone">
                  <TextField label="เบอร์โทรศัพท์" required inputMode="tel" value={form.signatoryPhone} onChange={(e) => set("signatoryPhone", e.target.value)} error={fields.signatoryPhone} />
                </Wrap>
              </div>
              <div className="grid gap-5 border-t border-line pt-5 sm:grid-cols-2">
                <div data-field="APPOINTMENT_ORDER">
                  <FileUpload label="คำสั่งแต่งตั้งผู้มีอำนาจกระทำการแทน" required value={appointment} error={fields.APPOINTMENT_ORDER} uploading={uploadingKind === "APPOINTMENT_ORDER"} onSelect={(f) => uploadFile("APPOINTMENT_ORDER", f)} onRemove={() => setAppointment(null)} />
                </div>
                <FileUpload label="คำสั่งมอบอำนาจ (ถ้ามี)" value={powerOfAttorney} uploading={uploadingKind === "POWER_OF_ATTORNEY"} onSelect={(f) => uploadFile("POWER_OF_ATTORNEY", f)} onRemove={() => setPowerOfAttorney(null)} />
              </div>
            </div>
          </Card>

          {/* ---------------- ส่วนที่ 3 ---------------- */}
          <Card id={SECTIONS[2].id} className="scroll-mt-24">
            <CardHeader tag={SECTIONS[2].tag} title={SECTIONS[2].title} description="ผู้ประสานงานที่กรอกแบบฟอร์มนี้" />
            <div className="grid gap-5 p-6">
              <PersonFields prefixKey="contactPrefix" firstKey="contactFirstName" lastKey="contactLastName" form={form} fields={fields} set={set} />
              <div className="grid gap-5 sm:grid-cols-2">
                <Wrap name="contactPosition">
                  <TextField label="ตำแหน่ง" required value={form.contactPosition} onChange={(e) => set("contactPosition", e.target.value)} error={fields.contactPosition} />
                </Wrap>
                <Wrap name="contactDepartment">
                  <TextField label="ฝ่าย/กอง/สำนัก" required value={form.contactDepartment} onChange={(e) => set("contactDepartment", e.target.value)} error={fields.contactDepartment} />
                </Wrap>
              </div>
              <div className="grid gap-5 sm:grid-cols-2">
                <Wrap name="contactEmail">
                  <TextField label="อีเมล" required type="email" value={form.contactEmail} onChange={(e) => set("contactEmail", e.target.value)} error={fields.contactEmail} />
                </Wrap>
                <Wrap name="contactPhone">
                  <TextField label="เบอร์โทรศัพท์" required inputMode="tel" value={form.contactPhone} onChange={(e) => set("contactPhone", e.target.value)} error={fields.contactPhone} />
                </Wrap>
              </div>
            </div>
          </Card>

          {/* ทึบเต็ม ไม่ใช้ความโปร่ง — เนื้อหาข้างหลังทะลุมาแล้วอ่านยาก */}
          <div className="sticky bottom-0 -mx-4 flex flex-col gap-3 rounded-t-2xl border-t border-line bg-white px-4 py-4 shadow-[0_-4px_16px_rgb(20_26_51_/_0.06)] sm:mx-0 sm:flex-row sm:justify-end sm:px-6">
            <Button type="button" variant="secondary" loading={saving} onClick={saveDraft}>
              บันทึกแบบร่าง
            </Button>
            <Button type="submit" loading={generating}>
              ตรวจสอบและสร้าง PDF
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ ส่วนย่อย

function Wrap({ name, children }: { name: string; children: React.ReactNode }) {
  return <div data-field={name}>{children}</div>;
}

function PersonFields({
  prefixKey,
  firstKey,
  lastKey,
  form,
  fields,
  set,
}: {
  prefixKey: keyof FormState;
  firstKey: keyof FormState;
  lastKey: keyof FormState;
  form: FormState;
  fields: Record<string, string>;
  set: (k: keyof FormState, v: string) => void;
}) {
  return (
    <div className="grid gap-5 sm:grid-cols-[7.5rem_minmax(0,1fr)_minmax(0,1fr)]">
      <Wrap name={prefixKey}>
        <SelectField label="คำนำหน้า" required value={form[prefixKey]} onChange={(e) => set(prefixKey, e.target.value)} error={fields[prefixKey]}>
          <option value="">เลือก</option>
          {PREFIXES.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </SelectField>
      </Wrap>
      <Wrap name={firstKey}>
        <TextField label="ชื่อ" required value={form[firstKey]} onChange={(e) => set(firstKey, e.target.value)} error={fields[firstKey]} />
      </Wrap>
      <Wrap name={lastKey}>
        <TextField label="นามสกุล" required value={form[lastKey]} onChange={(e) => set(lastKey, e.target.value)} error={fields[lastKey]} />
      </Wrap>
    </div>
  );
}

function Stepper({ completion }: { completion: Record<string, boolean> }) {
  return (
    <nav aria-label="ความคืบหน้า" className="hidden lg:block">
      <ol className="sticky top-24 flex flex-col gap-1">
        {SECTIONS.map((s, i) => {
          const done = completion[s.id];
          return (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                className="group flex items-start gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-white"
              >
                <span
                  className={clsx(
                    "mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-[12px] font-semibold transition-colors",
                    done ? "bg-success text-white" : "bg-navy-100 text-navy-600",
                  )}
                >
                  {done ? (
                    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
                      <path d="m4 8.5 2.6 2.6L12 5.6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : (
                    i + 1
                  )}
                </span>
                <span className="flex flex-col leading-tight">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-coral-500">{s.tag}</span>
                  <span className="text-sm font-medium text-ink">{s.title}</span>
                  <span className="mt-0.5 text-[12px] text-ink-muted">{done ? "กรอกครบแล้ว" : "ยังไม่ครบ"}</span>
                </span>
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
