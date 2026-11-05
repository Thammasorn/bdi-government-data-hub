"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

import type { Representative } from "@/lib/representatives";

const keyOf = (p: { userRoleAssignmentId: string | null; activationKeyId: string | null }) =>
  p.userRoleAssignmentId ?? p.activationKeyId ?? "";

/**
 * Dropdown เลือกผู้แทนที่จะยกเลิก — ปิดอยู่จนกว่าจะกด กดแล้วเห็นทุกคน พิมพ์เพื่อค้นจากชื่อได้
 *
 * ใช้ `<select>` ไม่ได้เพราะต้องค้นได้ ตัวเลือกแต่ละแถวบอกทั้งบทบาทและคำขอที่ค้างอยู่
 */
export function RepresentativePicker({
  options,
  onPick,
}: {
  options: Representative[];
  onPick: (person: Representative) => void;
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const listId = useId();

  const matches = useMemo(() => {
    const needle = term.trim();
    return needle ? options.filter((p) => p.name.includes(needle)) : options;
  }, [options, term]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const pick = (person: Representative) => {
    onPick(person);
    setTerm("");
    setActive(0);
    setOpen(false);
  };

  return (
    <div ref={root} className="relative">
      <label className="mb-1.5 block text-sm font-medium text-ink" htmlFor={`${listId}-input`}>
        เลือกผู้แทนที่ต้องการยกเลิก
      </label>
      <div className="relative">
        <input
          id={`${listId}-input`}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          autoComplete="off"
          value={term}
          placeholder="กดเพื่อเลือก หรือพิมพ์ค้นหาจากชื่อ"
          onClick={() => setOpen(true)}
          onChange={(e) => {
            setTerm(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setActive((i) => Math.min(i + 1, matches.length - 1));
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            }
            if (e.key === "Enter" && open && matches[active]) {
              e.preventDefault();
              pick(matches[active]);
            }
          }}
          className="h-11 w-full rounded-xl border border-line bg-white pl-4 pr-10 text-[15px] text-ink outline-none placeholder:text-ink-subtle focus:border-navy-500 focus:ring-2 focus:ring-navy-100"
        />
        <button
          type="button"
          tabIndex={-1}
          aria-label={open ? "ปิดรายชื่อ" : "เปิดรายชื่อ"}
          onClick={() => setOpen((v) => !v)}
          className="absolute inset-y-0 right-0 grid w-10 place-items-center text-ink-muted"
        >
          <svg viewBox="0 0 16 16" className={open ? "h-4 w-4 rotate-180" : "h-4 w-4"} fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <path d="m4 6 4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      {open ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-xl bg-white shadow-card ring-1 ring-line"
        >
          {matches.length === 0 ? (
            <li className="px-4 py-3 text-sm text-ink-muted">
              {options.length === 0 ? "ไม่มีผู้แทนให้เลือกแล้ว" : "ไม่พบชื่อที่ค้นหา"}
            </li>
          ) : (
            matches.map((person, index) => (
              <li key={keyOf(person)} role="option" aria-selected={index === active}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(index)}
                  onClick={() => pick(person)}
                  className={
                    index === active
                      ? "w-full bg-navy-50 px-4 py-2 text-left text-sm"
                      : "w-full px-4 py-2 text-left text-sm"
                  }
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
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
