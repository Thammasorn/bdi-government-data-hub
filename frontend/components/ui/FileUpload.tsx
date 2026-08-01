"use client";

import clsx from "clsx";
import { useRef, useState, type DragEvent } from "react";

export interface UploadedFile {
  id: string;
  filename: string;
  sizeBytes: number;
}

const formatSize = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

export function FileUpload({
  label,
  hint,
  required,
  error,
  value,
  uploading,
  onSelect,
  onRemove,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  error?: string;
  value: UploadedFile | null;
  uploading?: boolean;
  onSelect: (file: File) => void;
  onRemove: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) onSelect(file);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-ink">
        {label}
        {required ? <span className="ml-1 text-coral-500">*</span> : null}
      </span>

      {value ? (
        <div className="flex items-center gap-3 rounded-[10px] border border-line bg-white p-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-navy-50 text-navy-700">
            <svg viewBox="0 0 20 20" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
              <path d="M11.5 2.5H6a1.5 1.5 0 0 0-1.5 1.5v12A1.5 1.5 0 0 0 6 17.5h8a1.5 1.5 0 0 0 1.5-1.5V6.5z" strokeLinejoin="round" />
              <path d="M11.5 2.5v4h4" strokeLinejoin="round" />
            </svg>
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-ink">{value.filename}</p>
            <p className="text-[12px] text-ink-muted">{formatSize(value.sizeBytes)}</p>
          </div>
          <button
            type="button"
            onClick={onRemove}
            className="rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-ink-muted transition-colors hover:bg-danger-bg hover:text-danger"
          >
            ลบ
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          disabled={uploading}
          className={clsx(
            "flex flex-col items-center gap-1.5 rounded-[10px] border border-dashed px-4 py-7 transition-colors",
            dragging ? "border-navy-500 bg-navy-50" : "border-line bg-canvas hover:border-navy-300 hover:bg-navy-50/50",
            error && "border-danger",
          )}
        >
          {uploading ? (
            <svg viewBox="0 0 24 24" className="h-5 w-5 animate-spin text-navy-400" aria-hidden="true">
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" fill="none" opacity=".3" />
              <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" className="h-5 w-5 text-navy-400" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" strokeLinecap="round" />
            </svg>
          )}
          <span className="text-sm font-medium text-navy-700">
            {uploading ? "กำลังอัปโหลด…" : "คลิกเพื่อเลือกไฟล์ หรือลากมาวาง"}
          </span>
          <span className="text-[12px] text-ink-muted">รองรับ PDF หรือ JPG ขนาดไม่เกิน 10 MB</span>
        </button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,image/jpeg"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onSelect(file);
          e.target.value = "";
        }}
      />

      {error ? (
        <p className="text-[13px] text-danger" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-[13px] text-ink-muted">{hint}</p>
      ) : null}
    </div>
  );
}
