"use client";

import Link from "next/link";

import { EmailImagesPanel } from "@/components/console/EmailImagesPanel";
import { Badge, ErrorNotice, PageHeader, Panel, Tabs, Tag } from "@/components/console/ui";
import { Spinner } from "@/components/ui/Spinner";
import { adminErrorView } from "@/lib/admin-errors";
import { VERSION_STATUS, type TemplateSummary } from "@/lib/email-templates";
import { formatThaiDate } from "@/lib/status";
import { useAdminData, useUrlFilters } from "@/lib/use-admin";

const FILTERS = ["tab"] as const;
type TabKey = "templates" | "images";

/**
 * ตั้งค่า › เทมเพลตอีเมล — รายการอีเมลทุกฉบับที่ระบบส่ง แยกตามกลุ่ม (การ์ด "[New Feature] Admin Email Template Edit", 2026-11-08)
 *
 * ลำดับและกลุ่มมาจาก API (`lib/email/catalogue.ts`) หน้านี้ไม่รู้จักเทมเพลตไหนเป็นพิเศษ เทมเพลตใหม่ในโค้ดขึ้นที่นี่เอง
 */
export default function EmailTemplatesPage() {
  // แท็บอยู่ใน URL (?tab=images) — ลิงก์จาก popup ของหน้าแก้และที่อยู่เดิม /console/settings/email-images เปิดแท็บรูปภาพได้ตรง
  const { values, set } = useUrlFilters(FILTERS);
  const tab: TabKey = values.tab === "images" ? "images" : "templates";
  return (
    <div>
      <PageHeader
        eyebrow="ตั้งค่าระบบ"
        title="เทมเพลตอีเมล"
        description="แก้หัวเรื่องและเนื้อหาของอีเมลทุกฉบับที่ระบบส่ง เขียนเป็น HTML ได้ การแก้ไขบันทึกเป็นฉบับร่างก่อน และมีผลกับอีเมลจริงเมื่อกดเผยแพร่เท่านั้น"
      />
      <Tabs<TabKey>
        tabs={[
          { key: "templates", label: "เทมเพลต" },
          { key: "images", label: "รูปภาพ" },
        ]}
        active={tab}
        onChange={(key) => set({ tab: key === "images" ? "images" : "" })}
      />
      <div className="mt-6">{tab === "images" ? <EmailImagesPanel /> : <TemplateList />}</div>
    </div>
  );
}

function TemplateList() {
  const { data, error, loading } = useAdminData<{ groups: Record<string, string>; templates: TemplateSummary[] }>(
    "/api/admin/email-templates",
  );

  if (loading && !data) return <Spinner />;
  if (error && !data) return <ErrorNotice view={adminErrorView(error)} />;
  if (!data) return null;

  const groups = Object.entries(data.groups)
    .map(([key, label]) => ({ key, label, templates: data.templates.filter((t) => t.group === key) }))
    .filter((g) => g.templates.length > 0);

  return (
    <div>
      <div className="space-y-6">
        {groups.map((group) => (
          <Panel key={group.key} title={group.label} flush>
            <ul className="divide-y divide-line">
              {group.templates.map((t) => (
                <li key={t.key}>
                  <Link
                    href={`/console/settings/email-templates/${t.key}`}
                    className="flex flex-col gap-2 px-5 py-4 transition-colors hover:bg-navy-50/60 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <p className="text-[15px] font-semibold text-navy-800">{t.label}</p>
                      <p className="mt-0.5 text-[13.5px] text-ink-muted">{t.description}</p>
                    </div>
                    <div className="flex shrink-0 flex-col items-start gap-1 sm:items-end">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge meta={VERSION_STATUS.PUBLISHED} />
                        <Tag>{t.isDefault ? "เวอร์ชัน 1 (ตั้งต้น)" : `เวอร์ชัน ${t.liveVersion}`}</Tag>
                        {t.draftVersion ? <Badge meta={{ ...VERSION_STATUS.DRAFT, label: `ฉบับร่าง v${t.draftVersion}` }} /> : null}
                      </div>
                      {t.updatedAt ? (
                        <p className="text-[12.5px] text-ink-subtle">
                          แก้ไขล่าสุด {formatThaiDate(t.updatedAt)}
                          {t.updatedBy ? ` โดย ${t.updatedBy}` : ""}
                        </p>
                      ) : (
                        <p className="text-[12.5px] text-ink-subtle">ยังไม่เคยแก้ไข</p>
                      )}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>
        ))}
      </div>
    </div>
  );
}
