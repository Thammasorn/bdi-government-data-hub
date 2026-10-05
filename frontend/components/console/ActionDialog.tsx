"use client";

import { useEffect, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/Button";
import { TextAreaField, TextField } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { adminErrorView, type AdminErrorView } from "@/lib/admin-errors";

import { ErrorNotice } from "./ui";

/** เท่ากับ `reasonSchema` ของ /api/admin/* (min 10) — บอกก่อนกด ไม่ต้องรอ 400 */
const REASON_MIN = 10;

/**
 * กล่องยืนยันคำสั่งของผู้ดูแลระบบ — ทางเดียวที่ทุกปุ่มที่เปลี่ยนข้อมูลบน /console ผ่าน
 *
 * - **เหตุผล** (`reason`) — คำสั่งส่วนใหญ่ของ /api/admin/* บังคับอย่างน้อยสิบตัวอักษร เหตุผลนี้ลง `audit_event` และหลายคำสั่ง
 *   ส่งต่อไปเป็นข้อความแจ้งเตือนของเจ้าตัว กล่องจึงบอกตรง ๆ ว่าใครจะเห็น
 * - **พิมพ์ยืนยัน** (`confirmPhrase`) — คำสั่งที่ย้อนไม่ได้หรือย้อนยาก (ลบคำขอ ยุติบัญชี เปลี่ยนเลขบัตร) ต้องพิมพ์เลขที่คำขอหรือ
 *   อีเมลก่อนปุ่มจะกดได้ กันการกดผิดแถวในตารางที่หน้าตาเหมือนกันทุกแถว
 * - ข้อผิดพลาดแสดงในกล่องเดิม ไม่ปิดกล่องทิ้ง เหตุผลที่พิมพ์ไว้จึงไม่หาย และ 409 ที่มีลิงก์ "ไปที่บัญชีนั้น" กดต่อได้เลย
 */
export function ActionDialog({
  open,
  onClose,
  title,
  description,
  confirmLabel,
  tone = "primary",
  reason = true,
  reasonHint = "เหตุผลนี้ถูกบันทึกไว้เป็นหลักฐานของการเปลี่ยนแปลง",
  confirmPhrase,
  children,
  canSubmit = true,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  confirmLabel: string;
  tone?: "primary" | "danger";
  /** false = คำสั่งที่ API ไม่รับเหตุผล (เปิดบัญชีที่ระงับกลับ ส่งคำเชิญซ้ำ) */
  reason?: boolean;
  reasonHint?: string;
  confirmPhrase?: string;
  /** ช่องเพิ่มเติมของคำสั่งนั้น (ช่องติ๊ก ตัวเลือก) — อยู่เหนือช่องเหตุผล */
  children?: ReactNode;
  /** ช่องเพิ่มเติมยังไม่ครบ — ปิดปุ่มไว้ */
  canSubmit?: boolean;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [phrase, setPhrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AdminErrorView | null>(null);

  // เปิดใหม่ทุกครั้งเริ่มจากว่าง — เหตุผลของคำสั่งก่อนหน้าต้องไม่ติดมากับคำสั่งถัดไป
  useEffect(() => {
    if (!open) return;
    setText("");
    setPhrase("");
    setError(null);
  }, [open]);

  const reasonOk = !reason || text.trim().length >= REASON_MIN;
  const phraseOk = !confirmPhrase || phrase.trim() === confirmPhrase;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm(text.trim());
      onClose();
    } catch (err) {
      setError(adminErrorView(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={busy ? () => undefined : onClose} title={title} description={description}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (reasonOk && phraseOk && canSubmit && !busy) void submit();
        }}
      >
        {children}
        {reason ? (
          <TextAreaField
            label="เหตุผล"
            required
            rows={3}
            maxLength={500}
            value={text}
            onChange={(e) => setText(e.target.value)}
            error={error?.fields.reason}
            hint={`${reasonHint} — อย่างน้อย ${REASON_MIN} ตัวอักษร (${text.trim().length}/${REASON_MIN})`}
          />
        ) : null}
        {confirmPhrase ? (
          <TextField
            label={`พิมพ์ ${confirmPhrase} เพื่อยืนยัน`}
            value={phrase}
            onChange={(e) => setPhrase(e.target.value)}
            autoComplete="off"
            valid={phraseOk && phrase.length > 0}
          />
        ) : null}
        {error ? <ErrorNotice view={error} /> : null}
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            ยกเลิก
          </Button>
          <Button
            type="submit"
            variant={tone === "danger" ? "danger" : "primary"}
            loading={busy}
            disabled={!reasonOk || !phraseOk || !canSubmit}
          >
            {confirmLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
