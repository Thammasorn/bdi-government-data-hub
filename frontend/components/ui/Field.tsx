"use client";

import clsx from "clsx";
import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { useId, useState } from "react";

import { EyeIcon, EyeSlashIcon } from "./Icons";

const CONTROL = [
  "w-full rounded-[10px] border bg-white px-3.5 text-[15px] text-ink",
  "placeholder:text-ink-subtle",
  "transition-[border-color,box-shadow] duration-150",
  "disabled:bg-navy-50/60 disabled:text-ink-muted",
].join(" ");

/**
 * ช่องอ่านอย่างเดียวหน้าตาต้องบอกเองว่าแก้ไม่ได้ แต่ยังโฟกัสและคัดลอกค่าออกไปได้
 * (`disabled` ทำอย่างหลังไม่ได้ — รหัสหน่วยงานเป็นค่าที่ผู้ใช้ต้องคัดลอกไปอ้างอิงจริง)
 *
 * ใส่เฉพาะ input/textarea เท่านั้น ห้ามย้ายกลับไปรวมใน CONTROL: ตามสเปก HTML มีแต่
 * input ที่แก้ไขได้ textarea และ contenteditable ที่เป็น `:read-write` — `<select>`
 * เข้าเงื่อนไข `:read-only` เสมอแม้จะเลือกค่าได้ตามปกติ พอรวมไว้ใน CONTROL ทำให้
 * dropdown ทุกตัวในระบบพื้นเทาและตัวอักษรจางเท่ากับช่องที่ถูกล็อก ผู้ใช้จึงอ่านว่า
 * ห้ามเปลี่ยน และช่องที่ disabled จริง (อำเภอก่อนเลือกจังหวัด) ก็แยกไม่ออกจากช่องที่ใช้ได้
 */
const READ_ONLY =
  "read-only:bg-navy-50/60 read-only:text-ink-muted read-only:focus:border-line read-only:focus:shadow-none";

/**
 * สีขอบตามสถานะของช่อง — ผิดเป็นแดง ถูกแล้วเป็นเขียว ยังไม่แตะเป็นสีปกติ
 *
 * ขอบเขียวขึ้นเฉพาะช่องที่ผู้ใช้กรอกเองและผ่านการตรวจแล้ว ไม่ใช่ทุกช่องที่ไม่มี error —
 * ไม่งั้นฟอร์มเปล่าจะเขียวทั้งหน้าตั้งแต่ยังไม่ได้กรอกอะไร ซึ่งอ่านได้ว่า "เรียบร้อยแล้ว"
 *
 * สีไม่ใช่สัญญาณเดียว (docs/02-ui-spec.md): ช่องที่ผิดมีข้อความบอกวิธีแก้อยู่ใต้ช่องเสมอ
 * และช่องที่ผ่านมีเครื่องหมายถูกกำกับ คนที่แยกสีไม่ออกจึงยังอ่านสถานะได้
 */
const stateRing = (invalid?: boolean, valid?: boolean) => {
  if (invalid) return "border-danger focus:border-danger focus:shadow-[0_0_0_3px_var(--color-danger-bg)]";
  if (valid) return "border-success focus:border-success focus:shadow-[0_0_0_3px_var(--color-success-bg)]";
  return "border-line focus:border-navy-500 focus:shadow-[0_0_0_3px_var(--color-navy-100)]";
};

/** เครื่องหมายถูกท้ายช่องที่กรอกผ่านแล้ว — คู่กับขอบเขียว ไม่ใช่แทนกัน */
function ValidMark({ className = "right-3.5" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={clsx("pointer-events-none absolute top-1/2 h-4 w-4 -translate-y-1/2 text-success", className)}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      aria-hidden="true"
    >
      <path d="m3 8.5 3.2 3.2L13 5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

interface FieldShellProps {
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: (id: string) => ReactNode;
  className?: string;
}

/** ช่องที่ตรวจแล้วผ่าน — ขอบเขียวและเครื่องหมายถูก ใช้คู่กับ `error` ไม่ใช่แทนกัน */
type Validatable = { valid?: boolean };

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
  valid,
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> &
  Validatable & { label: string; error?: string; hint?: string }) {
  const showValid = Boolean(valid) && !error;
  return (
    <Field label={label} error={error} hint={hint} required={required} className={className}>
      {(id) => (
        <div className="relative">
          <input
            {...rest}
            id={id}
            aria-invalid={error ? true : undefined}
            className={clsx(CONTROL, READ_ONLY, stateRing(Boolean(error), showValid), "h-11", showValid && "pr-10")}
          />
          {showValid ? <ValidMark /> : null}
        </div>
      )}
    </Field>
  );
}

/**
 * ช่องรหัสผ่านที่มีปุ่มลูกตาให้เปิดดูสิ่งที่พิมพ์ (feedback "features 1 full" แถว 2) — รหัสผ่านของระบบยาว 12 ตัวขึ้นไป
 * และต้องมีสัญลักษณ์ พิมพ์ผิดหนึ่งตัวแล้วมองไม่เห็นว่าผิดตรงไหนคือเหตุที่ผู้ใช้ขอ
 *
 * ปุ่มเป็น `type="button"` ไม่ใช่ submit (Enter ในช่องยังส่งฟอร์มตามปกติ) และกัน mousedown ไว้ โฟกัสกับตำแหน่ง cursor
 * จึงอยู่ในช่องเดิม เปิดดูกลางคำแล้วพิมพ์ต่อได้เลย ไอคอนบอกสถานะปัจจุบัน (ลูกตา = กำลังแสดง) ส่วน `aria-label` บอกสิ่งที่กดแล้ว
 * จะเกิด คนที่ใช้โปรแกรมอ่านจอได้ทั้งสองอย่างจาก `aria-pressed` แต่ละช่องสลับของตัวเอง ช่องยืนยันไม่เปิดตามช่องแรก
 */
export function PasswordField({
  label,
  error,
  hint,
  required,
  valid,
  className,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> &
  Validatable & { label: string; error?: string; hint?: string }) {
  const [shown, setShown] = useState(false);
  const showValid = Boolean(valid) && !error;
  return (
    <Field label={label} error={error} hint={hint} required={required} className={className}>
      {(id) => (
        <div className="relative">
          <input
            {...rest}
            id={id}
            type={shown ? "text" : "password"}
            aria-invalid={error ? true : undefined}
            className={clsx(CONTROL, READ_ONLY, stateRing(Boolean(error), showValid), "h-11", showValid ? "pr-16" : "pr-11")}
          />
          {showValid ? <ValidMark className="right-10" /> : null}
          <button
            type="button"
            aria-controls={id}
            aria-pressed={shown}
            aria-label={shown ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"}
            title={shown ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setShown((s) => !s)}
            className="absolute right-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg text-ink-muted transition-colors hover:bg-navy-50 hover:text-navy-700 focus-visible:outline-2 focus-visible:outline-navy-500"
          >
            {shown ? <EyeIcon className="h-[18px] w-[18px]" /> : <EyeSlashIcon className="h-[18px] w-[18px]" />}
          </button>
        </div>
      )}
    </Field>
  );
}

export function SelectField({
  label,
  error,
  hint,
  required,
  valid,
  className,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> &
  Validatable & { label: string; error?: string; hint?: string }) {
  return (
    <Field label={label} error={error} hint={hint} required={required} className={className}>
      {(id) => (
        <div className="relative">
          <select
            {...rest}
            id={id}
            aria-invalid={error ? true : undefined}
            className={clsx(
              CONTROL,
              // ลูกศรของ select กินที่ขวาอยู่แล้ว จึงไม่เติมเครื่องหมายถูกซ้อนเข้าไปอีก
              stateRing(Boolean(error), Boolean(valid) && !error),
              "h-11 appearance-none pr-10",
            )}
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
  valid,
  className,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> &
  Validatable & { label: string; error?: string; hint?: string }) {
  return (
    <Field label={label} error={error} hint={hint} required={required} className={className}>
      {(id) => (
        <textarea
          {...rest}
          id={id}
          aria-invalid={error ? true : undefined}
          className={clsx(
            CONTROL,
            READ_ONLY,
            stateRing(Boolean(error), Boolean(valid) && !error),
            "min-h-28 py-2.5 leading-relaxed",
          )}
        />
      )}
    </Field>
  );
}
