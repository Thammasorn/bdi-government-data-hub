"use client";

import clsx from "clsx";
import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { useId } from "react";

const CONTROL = [
  "w-full rounded-[10px] border bg-white px-3.5 text-[15px] text-ink",
  "placeholder:text-ink-subtle",
  "transition-[border-color,box-shadow] duration-150",
  "disabled:bg-navy-50/60 disabled:text-ink-muted",
].join(" ");

const stateRing = (invalid?: boolean) =>
  invalid
    ? "border-danger focus:border-danger focus:shadow-[0_0_0_3px_var(--color-danger-bg)]"
    : "border-line focus:border-navy-500 focus:shadow-[0_0_0_3px_var(--color-navy-100)]";

interface FieldShellProps {
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: (id: string) => ReactNode;
  className?: string;
}

export function Field({ label, error, hint, required, children, className }: FieldShellProps) {
  const id = useId();
  return (
    <div className={clsx("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
        {required ? <span className="ml-1 text-coral-500">*</span> : null}
      </label>
      {children(id)}
      {/* ข้อความ error บอกวิธีแก้ ไม่ใช่แค่บอกว่าผิด (docs/02-ui-spec.md §5) */}
      {error ? (
        <p className="flex items-start gap-1.5 text-[13px] text-danger" role="alert">
          <svg viewBox="0 0 16 16" className="mt-1 h-3.5 w-3.5 shrink-0" fill="currentColor" aria-hidden="true">
            <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1m0 3.2a.8.8 0 0 1 .8.8v3.6a.8.8 0 0 1-1.6 0V5a.8.8 0 0 1 .8-.8m0 6a1 1 0 1 1 0 2 1 1 0 0 1 0-2" />
          </svg>
          {error}
        </p>
      ) : hint ? (
        <p className="text-[13px] text-ink-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export function TextField({
  label,
  error,
  hint,
  required,
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string; hint?: string }) {
  return (
    <Field label={label} error={error} hint={hint} required={required} className={className}>
      {(id) => (
        <input
          {...rest}
          id={id}
          aria-invalid={error ? true : undefined}
          className={clsx(CONTROL, stateRing(Boolean(error)), "h-11")}
        />
      )}
    </Field>
  );
}

export function SelectField({
  label,
  error,
  hint,
  required,
  className,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { label: string; error?: string; hint?: string }) {
  return (
    <Field label={label} error={error} hint={hint} required={required} className={className}>
      {(id) => (
        <div className="relative">
          <select
            {...rest}
            id={id}
            aria-invalid={error ? true : undefined}
            className={clsx(CONTROL, stateRing(Boolean(error)), "h-11 appearance-none pr-10")}
          >
            {children}
          </select>
          <svg
            viewBox="0 0 20 20"
            className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            aria-hidden="true"
          >
            <path d="m5 8 5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      )}
    </Field>
  );
}

export function TextAreaField({
  label,
  error,
  hint,
  required,
  className,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; error?: string; hint?: string }) {
  return (
    <Field label={label} error={error} hint={hint} required={required} className={className}>
      {(id) => (
        <textarea
          {...rest}
          id={id}
          aria-invalid={error ? true : undefined}
          className={clsx(CONTROL, stateRing(Boolean(error)), "min-h-28 py-2.5 leading-relaxed")}
        />
      )}
    </Field>
  );
}
