"use client";

import { useEffect, useMemo, useState } from "react";

import { SelectField } from "@/components/ui/Field";
import type { AdminOrganization } from "@/lib/admin";
import { api } from "@/lib/api";
import { ORGANIZATION_STATUS_META } from "@/lib/status";

/** id ของแถวหน่วยงาน BDI — ไม่ใช่ตัวเลือกของ role ระดับหน่วยงาน (backend/src/lib/system.ts `BDI_ORGANIZATION_ID`) */
const BDI_ORGANIZATION_ID = "00000000-0000-0000-0000-0000000000b0";

/**
 * เลือกหน่วยงานจากทะเบียน — แทนการวาง UUID ที่ Postman เคยต้องการ
 *
 * โหลดรายชื่อครั้งเดียว (`GET /api/admin/organizations` คืนสูงสุด 200 แถว ซึ่งเกินจำนวนหน่วยงานที่ระบบมีไปมาก) แล้วกรองในหน้า
 * ด้วยช่องพิมพ์ — ชื่อหน่วยงานราชการยาวและขึ้นต้นด้วย "กรม" "สำนักงาน" เหมือนกันหมด เลื่อนหาใน select เปล่า ๆ ไม่ไหว
 * สถานะต่อท้ายชื่อ เพราะคำเชิญ "ผู้มีอำนาจอนุมัติ" ทำได้กับหน่วยงานที่เปิดใช้งานแล้วเท่านั้น
 */
export function OrganizationPicker({
  value,
  onChange,
  label = "หน่วยงาน",
  error,
  required,
}: {
  value: string;
  onChange: (id: string) => void;
  label?: string;
  error?: string;
  required?: boolean;
}) {
  const [orgs, setOrgs] = useState<AdminOrganization[] | null>(null);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    api
      .get<{ organizations: AdminOrganization[] }>("/api/admin/organizations")
      .then((d) => setOrgs(d.organizations.filter((o) => o.id !== BDI_ORGANIZATION_ID)))
      .catch(() => setOrgs([]));
  }, []);

  const shown = useMemo(() => {
    const list = (orgs ?? []).slice().sort((a, b) => a.nameTh.localeCompare(b.nameTh, "th"));
    const f = filter.trim().toLowerCase();
    if (!f) return list;
    // ตัวที่เลือกอยู่ต้องอยู่ในรายการเสมอ ไม่งั้น select แสดงตัวเลือกแรกแทนทั้งที่ค่าจริงเป็นอีกตัว
    return list.filter(
      (o) => o.id === value || o.nameTh.toLowerCase().includes(f) || o.organizationCode.toLowerCase().includes(f),
    );
  }, [orgs, filter, value]);

  return (
    <div className="space-y-2">
      <input
        type="search"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="พิมพ์ชื่อหรือรหัสหน่วยงานเพื่อกรอง"
        aria-label="กรองรายชื่อหน่วยงาน"
        className="h-9 w-full rounded-[10px] border border-line bg-white px-3 text-[14px] placeholder:text-ink-subtle focus:border-navy-500"
      />
      <SelectField
        label={label}
        required={required}
        error={error}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={!orgs}
      >
        <option value="">{orgs ? `เลือกหน่วยงาน (${shown.length})` : "กำลังโหลด…"}</option>
        {shown.map((o) => (
          <option key={o.id} value={o.id}>
            {o.nameTh} · {o.organizationCode} · {ORGANIZATION_STATUS_META[o.status].label}
          </option>
        ))}
      </SelectField>
    </div>
  );
}
