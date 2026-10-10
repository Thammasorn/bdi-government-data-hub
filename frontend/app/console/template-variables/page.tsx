"use client";

import { useState } from "react";

import { Badge, ErrorNotice, PageHeader, Panel } from "@/components/console/ui";
import { Spinner } from "@/components/ui/Spinner";
import { adminErrorView } from "@/lib/admin-errors";
import { useAdminData } from "@/lib/use-admin";

interface Variable {
  name: string;
  description: string;
  example: string;
  /** `both` ใช้ได้ทั้งสองแบบ · `organization` เฉพาะเอกสารของคำขอลงทะเบียนหน่วยงาน · `dataset` เฉพาะเอกสารของคำขอส่งชุดข้อมูล */
  scope: "both" | "organization" | "dataset";
}

interface Payload {
  scopes: Array<{ scope: string; label: string; variableScope: "organization" | "dataset" }>;
  variableGroups: Array<{ group: string; title: string; variables: Variable[] }>;
}

const SCOPE_BADGE: Record<Variable["scope"], { label: string; className: string }> = {
  both: { label: "ใช้ได้ทั้งสองแบบ", className: "bg-navy-50 text-navy-700" },
  organization: { label: "คำขอลงทะเบียนหน่วยงาน", className: "bg-warning-bg text-warning" },
  dataset: { label: "คำขอส่งชุดข้อมูล", className: "bg-success-bg text-success" },
};

type Filter = "all" | "organization" | "dataset";

/**
 * ตัวแปรที่พิมพ์ลงใน template .docx ได้ — หน้าอ้างอิงของคนเขียนเอกสาร (เดิมเป็นกล่องเด้งในหน้าเอกสารข้อตกลง card "Enhance Legal
 * document management" ข้อ 8) รายการมาจาก `TEMPLATE_VARIABLES` ในโค้ดโดยตรง จึงตรงกับที่ระบบตรวจตอนอัปโหลดเสมอ
 *
 * พิมพ์ชื่อในวงเล็บปีกกาคู่ (`{{org.name}}`) ชื่อที่ไม่อยู่ในรายการทำให้อัปโหลดไม่ผ่าน และตัวแปรของคำขอหน่วยงานกับของคำขอชุดข้อมูลใช้ข้ามกันไม่ได้
 * ปุ่มกรองกับป้ายต่อแถวจึงบอกว่าตัวไหนใช้กับเอกสารแบบไหน
 */
export default function ConsoleTemplateVariablesPage() {
  const { data, error, loading } = useAdminData<Payload>("/api/admin/template-variables");
  const [filter, setFilter] = useState<Filter>("all");
  const [copied, setCopied] = useState<string | null>(null);

  if (loading && !data) return <Spinner />;
  if (error && !data) return <ErrorNotice view={adminErrorView(error)} />;
  if (!data) return null;

  const copy = async (name: string) => {
    try {
      await navigator.clipboard.writeText(name);
      setCopied(name);
      setTimeout(() => setCopied((c) => (c === name ? null : c)), 1500);
    } catch {
      // เบราว์เซอร์ไม่ให้เขียนคลิปบอร์ด (http หรือไม่ได้รับอนุญาต) — ชื่อยังเลือกคัดลอกด้วยมือได้
    }
  };

  const visible = (v: Variable) => filter === "all" || v.scope === "both" || v.scope === filter;

  return (
    <div>
      <PageHeader
        eyebrow="ตั้งค่าเอกสาร"
        title="ตัวแปรที่ใช้ใน template"
      />

      <div role="group" aria-label="กรองตามชนิดเอกสาร" className="mb-5 flex flex-wrap gap-2">
        {(
          [
            ["all", "ทั้งหมด"],
            ["organization", "เอกสารของคำขอลงทะเบียนหน่วยงาน"],
            ["dataset", "เอกสารของคำขอส่งชุดข้อมูล"],
          ] as Array<[Filter, string]>
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={filter === key}
            onClick={() => setFilter(key)}
            className={
              filter === key
                ? "rounded-full bg-navy-800 px-4 py-1.5 text-[13.5px] font-medium text-white"
                : "rounded-full bg-white px-4 py-1.5 text-[13.5px] text-ink-muted ring-1 ring-line hover:text-navy-800"
            }
          >
            {label}
          </button>
        ))}
      </div>

      <div className="space-y-5">
        {data.variableGroups
          .map((g) => ({ ...g, variables: g.variables.filter(visible) }))
          .filter((g) => g.variables.length > 0)
          .map((g) => (
            <Panel key={g.group} title={g.title} flush>
              <dl className="divide-y divide-line">
                {g.variables.map((v) => (
                  <div key={v.name} className="grid gap-1 px-5 py-3 text-[14px] sm:grid-cols-[minmax(0,17rem)_1fr_auto] sm:items-start sm:gap-4">
                    <dt className="flex items-start gap-2">
                      <code className="break-all font-mono text-[13.5px] text-navy-700">{v.name}</code>
                      <button
                        type="button"
                        onClick={() => void copy(v.name)}
                        aria-label={`คัดลอก ${v.name}`}
                        className="shrink-0 rounded-full px-2 py-0.5 text-[12px] font-medium text-navy-700 hover:bg-navy-50"
                      >
                        {copied === v.name ? "คัดลอกแล้ว" : "คัดลอก"}
                      </button>
                    </dt>
                    <dd className="text-ink-muted">
                      {v.description}
                      {v.example ? <span className="block text-ink-subtle">เช่น {v.example}</span> : null}
                    </dd>
                    <dd>
                      <Badge meta={SCOPE_BADGE[v.scope]} />
                    </dd>
                  </div>
                ))}
              </dl>
            </Panel>
          ))}
      </div>
    </div>
  );
}
