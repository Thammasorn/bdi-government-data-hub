"use client";

import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { api, ApiError } from "@/lib/api";
import { nextFromLocation, safeNextPath } from "@/lib/require-auth";

/**
 * ปุ่มเริ่มยืนยันตัวตนกับ ThaiD
 *
 * backend คืน URL มาให้ แล้วหน้านี้พาเบราว์เซอร์ออกไปทั้งหน้า (ไม่ใช่ fetch) เพราะ
 * ผู้ใช้ต้องไปยืนยันบนเว็บ/แอปของกรมการปกครองจริง ๆ — และ redirect_uri ที่ ThaiD
 * รู้จักคือหน้าเว็บของเรา ไม่ใช่ API
 */
const TOKEN_KEY = "thaid:activation-token";
const PROFILE_KEY = "thaid:profile";
const NEXT_KEY = "thaid:next";

/**
 * ฝาก activation key ไว้ก่อนออกไป ThaiD
 *
 * ThaiD ส่งกลับมาแค่ code กับ state — ตัว key จริงจะไม่ถูกส่งออกนอกเบราว์เซอร์เลย
 * (sessionStorage อยู่กับแท็บนี้เท่านั้น และหายเมื่อปิดแท็บ) หน้า callback หยิบไป
 * ใช้พากลับเข้าหน้า /activate ต่อ ส่วน backend ผูก callback กับคำขอเดิมด้วย state
 * ของตัวเอง ไม่ได้เชื่อค่าที่เบราว์เซอร์ถือไว้
 */
export function storeActivationToken(token: string) {
  sessionStorage.setItem(TOKEN_KEY, token);
}

export function takeActivationToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY);
}

export function storeThaidProfile(profile: unknown) {
  sessionStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
}

/**
 * ฝากปลายทางหลังล็อกอินไว้ก่อนออกไป ThaiD ด้วยเหตุผลเดียวกับ activation key
 *
 * ผู้ที่กดลิงก์ในอีเมลตอนยังไม่ล็อกอินจะมาถึงหน้า /login พร้อม ?next=<หน้านั้น>
 * แต่การล็อกอินด้วย ThaiD พาเบราว์เซอร์ออกนอกเว็บแล้วกลับเข้ามาที่
 * /auth/callback/thaid ซึ่งเป็นคนละ URL — ค่า next บน query string จึงหายไป
 * ระหว่างทาง ถ้าไม่ฝากไว้ ผู้ใช้ที่เลือกทางนี้จะไปโผล่หน้าแรกแทนหน้าที่ตั้งใจไป
 */
export function storeNextPath(next: string | null) {
  if (next) sessionStorage.setItem(NEXT_KEY, next);
  else sessionStorage.removeItem(NEXT_KEY);
}

export function takeNextPath(): string | null {
  const value = sessionStorage.getItem(NEXT_KEY);
  sessionStorage.removeItem(NEXT_KEY);
  return safeNextPath(value);
}

export function ThaidButton({
  purpose,
  token,
  label,
  variant = "primary",
  onBeforeRedirect,
}: {
  purpose: "activate" | "login";
  token?: string;
  label: string;
  variant?: "primary" | "secondary";
  onBeforeRedirect?: () => void;
}) {
  const { show } = useToast();
  const [busy, setBusy] = useState(false);

  const start = async () => {
    setBusy(true);
    try {
      const { authorizeUrl } = await api.post<{ authorizeUrl: string }>(
        "/api/auth/thaid/start",
        { purpose, ...(token ? { token } : {}) },
      );
      if (purpose === "login") storeNextPath(nextFromLocation());
      onBeforeRedirect?.();
      window.location.assign(authorizeUrl);
    } catch (err) {
      show({
        tone: "error",
        title: "เริ่มการยืนยันตัวตนไม่สำเร็จ",
        detail: err instanceof ApiError ? err.message : undefined,
      });
      setBusy(false);
    }
  };

  return (
    <Button
      type="button"
      size="lg"
      variant={variant}
      loading={busy}
      onClick={start}
      className="w-full"
      icon={<ThaidMark />}
    >
      {label}
    </Button>
  );
}

/** เครื่องหมายบัตรประชาชนแบบเรียบ — ไม่ได้ใช้โลโก้ ThaiD จริงเพราะยังไม่ได้ขออนุญาตใช้ */
function ThaidMark() {
  return (
    <svg viewBox="0 0 20 20" className="h-[18px] w-[18px]" fill="none" aria-hidden="true">
      <rect x="1.6" y="4" width="16.8" height="12" rx="2.2" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="7.2" cy="9.4" r="1.9" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M4.1 13.6c.5-1.2 1.7-1.9 3.1-1.9s2.6.7 3.1 1.9M12.6 8.4h3.2M12.6 11.2h3.2"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}
