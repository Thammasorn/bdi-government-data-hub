"use client";

import clsx from "clsx";
import { useEffect, useId, useMemo, useRef, useState } from "react";

/**
 * ตัวกรองแบบค้นหาและเลือกได้หลายรายการ — ปุ่มทรงเดียวกับ `Dropdown` (SortSelect.tsx) กดแล้วเปิดกล่องที่มีช่องค้นหาและกล่องติ๊ก
 *
 * ใช้ `<select multiple>` ไม่ได้: ต้องค้นได้ และการกด Ctrl ค้างเพื่อเลือกหลายข้อไม่มีใครรู้ (เหตุผลเดียวกับ `MultiChoice`
 * ในฟอร์มชุดข้อมูล) · ปิดเมื่อคลิกนอกกล่องหรือกด Esc แบบ `RepresentativePicker`
 */
export function MultiSelectFilter({
  label,
  allLabel,
  unit,
  options,
  value,
  onChange,
  searchPlaceholder = "พิมพ์เพื่อค้นหา",
}: {
  /** ชื่อของตัวกรอง สำหรับโปรแกรมอ่านหน้าจอ เช่น "หน่วยงาน" */
  label: string;
  /** ข้อความบนปุ่มเมื่อไม่ได้เลือก เช่น "ทุกหน่วยงาน" */
  allLabel: string;
  /** หน่วยนับบนปุ่มเมื่อเลือกหลายรายการ เช่น "หน่วยงาน" → "3 หน่วยงาน" */
  unit: string;
  options: { value: string; label: string }[];
  value: string[];
  onChange: (next: string[]) => void;
  searchPlaceholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const listId = useId();
  const selected = useMemo(() => new Set(value), [value]);

  const matches = useMemo(() => {
    const needle = term.trim().toLowerCase();
    return needle ? options.filter((o) => o.label.toLowerCase().includes(needle)) : options;
  }, [options, term]);

  useEffect(() => {
    if (!open) return;
    search.current?.focus();
    const onClick = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const toggle = (v: string) => {
    // คงลำดับตามรายการตัวเลือก ไม่ใช่ลำดับที่ติ๊ก
    const next = new Set(selected);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    onChange(options.filter((o) => next.has(o.value)).map((o) => o.value));
  };

  const buttonText =
    value.length === 0
      ? allLabel
      : value.length === 1
        ? (options.find((o) => o.value === value[0])?.label ?? `1 ${unit}`)
        : `${value.length} ${unit}`;

  return (
    <div
      ref={root}
      className="relative"
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        aria-label={`${label}: ${buttonText}`}
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((v) => !v)}
        className={clsx(
          "relative h-9 max-w-[18rem] truncate rounded-full border bg-white pl-3.5 pr-9 text-left text-[13px] font-medium text-ink transition-[border-color,box-shadow] focus:border-navy-500 focus:shadow-[0_0_0_3px_var(--color-navy-100)] focus:outline-none",
          value.length > 0 ? "border-navy-500" : "border-line",
        )}
      >
        {buttonText}
        <svg
          viewBox="0 0 20 20"
          className={clsx("pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted", open && "rotate-180")}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          aria-hidden="true"
        >
          <path d="m5 8 5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open ? (
        <div
          id={listId}
          className="absolute left-0 z-20 mt-1 w-[22rem] max-w-[calc(100vw-2rem)] rounded-xl bg-white shadow-card ring-1 ring-line"
        >
          <div className="border-b border-line p-2">
            <input
              ref={search}
              type="search"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder={searchPlaceholder}
              aria-label={`ค้นหา${label}`}
              autoComplete="off"
              className="h-9 w-full rounded-lg border border-line bg-white px-3 text-[14px] text-ink outline-none placeholder:text-ink-subtle focus:border-navy-500 focus:ring-2 focus:ring-navy-100"
            />
          </div>
          <ul role="listbox" aria-multiselectable="true" aria-label={label} className="max-h-64 overflow-y-auto py-1">
            {matches.length === 0 ? (
              <li className="px-4 py-3 text-[13px] text-ink-muted">ไม่พบรายการที่ค้นหา</li>
            ) : (
              matches.map((option) => (
                <li key={option.value} role="option" aria-selected={selected.has(option.value)}>
                  <label className="flex cursor-pointer items-start gap-2 px-3 py-2 text-[14px] text-ink hover:bg-navy-50">
                    <input
                      type="checkbox"
                      checked={selected.has(option.value)}
                      onChange={() => toggle(option.value)}
                      className="mt-0.5 h-4 w-4 shrink-0 rounded border-line text-coral-500 focus:ring-2 focus:ring-navy-100"
                    />
                    <span>{option.label}</span>
                  </label>
                </li>
              ))
            )}
          </ul>
          <div className="flex items-center justify-between border-t border-line px-3 py-2 text-[13px]">
            <span className="text-ink-muted">{value.length > 0 ? `เลือก ${value.length} ${unit}` : allLabel}</span>
            <button
              type="button"
              disabled={value.length === 0}
              onClick={() => onChange([])}
              className="font-medium text-navy-700 underline-offset-2 hover:underline disabled:text-ink-subtle disabled:no-underline"
            >
              ล้างที่เลือก
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
