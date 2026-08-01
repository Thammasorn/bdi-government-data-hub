"use client";

import clsx from "clsx";
import { useRef, type ClipboardEvent, type KeyboardEvent } from "react";

/** ช่อง OTP 6 หลักแยกกล่อง — วางทั้งชุดทีเดียวได้ (docs/02-ui-spec.md §3.1 A3) */
export function OtpInput({
  value,
  onChange,
  invalid,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  invalid?: boolean;
  disabled?: boolean;
}) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const digits = value.padEnd(6, " ").slice(0, 6).split("");

  const setAt = (index: number, digit: string) => {
    const next = digits.map((d, i) => (i === index ? digit : d)).join("").replace(/\s/g, " ");
    onChange(next.trimEnd().replace(/\s/g, ""));
  };

  const handleChange = (index: number, raw: string) => {
    const digit = raw.replace(/\D/g, "").slice(-1);
    if (!digit) return;
    const chars = value.split("");
    chars[index] = digit;
    onChange(chars.join("").slice(0, 6));
    refs.current[index + 1]?.focus();
  };

  const handleKeyDown = (index: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace") {
      e.preventDefault();
      const chars = value.split("");
      if (chars[index]) {
        chars[index] = "";
        onChange(chars.join("").replace(/\s/g, ""));
      } else {
        refs.current[index - 1]?.focus();
        const prev = value.split("");
        prev[index - 1] = "";
        onChange(prev.join("").replace(/\s/g, ""));
      }
    }
    if (e.key === "ArrowLeft") refs.current[index - 1]?.focus();
    if (e.key === "ArrowRight") refs.current[index + 1]?.focus();
  };

  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (!pasted) return;
    onChange(pasted);
    refs.current[Math.min(pasted.length, 5)]?.focus();
  };

  return (
    <div className="flex justify-between gap-2" role="group" aria-label="รหัสยืนยัน 6 หลัก">
      {Array.from({ length: 6 }).map((_, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="text"
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          maxLength={1}
          disabled={disabled}
          aria-label={`หลักที่ ${i + 1}`}
          aria-invalid={invalid || undefined}
          value={value[i] ?? ""}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={handlePaste}
          onFocus={(e) => e.target.select()}
          className={clsx(
            "h-14 w-full rounded-xl border bg-white text-center font-display text-xl font-semibold text-navy-800",
            "transition-[border-color,box-shadow] duration-150 disabled:opacity-50",
            invalid
              ? "border-danger focus:shadow-[0_0_0_3px_var(--color-danger-bg)]"
              : "border-line focus:border-navy-500 focus:shadow-[0_0_0_3px_var(--color-navy-100)]",
          )}
        />
      ))}
    </div>
  );
}
