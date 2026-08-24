"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { api } from "@/lib/api";
import type { Role } from "@/lib/status";

export interface SessionUser {
  id: string;
  email: string;
  prefix: string | null;
  firstName: string | null;
  lastName: string | null;
  roles: Role[];
  organizationId: string | null;
  organization?: { id: string; name: string; status: string } | null;
  /**
   * มีค่าเมื่อผู้ใช้ **เคย** สังกัดหน่วยงาน แล้วถูกถอดออกเพราะมีคนมารับหน้าที่แทน
   * ต่างจาก `organizationId === null` เฉย ๆ ซึ่งแปลว่ายังไม่เคยมีหน่วยงานเลย —
   * สองกรณีนี้ต้องบอกผู้ใช้คนละเรื่องกัน ฝั่ง API คือ removedFromOrganization()
   */
  removedFromOrganization?: {
    organizationName: string | null;
    role: string;
    roleLabel: string;
    removedAt: string | null;
    replacedBy: string | null;
  } | null;
}

interface SessionValue {
  user: SessionUser | null;
  loading: boolean;
  refresh: () => Promise<void>;
  setUser: (u: SessionUser | null) => void;
}

const SessionContext = createContext<SessionValue | null>(null);

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession ต้องอยู่ภายใน <SessionProvider>");
  return ctx;
}

/**
 * `hasSessionCookie` มาจาก layout ซึ่งเป็น server component และอ่านคุกกี้ได้
 *
 * ถ้าไม่มีคุกกี้ก็ไม่ต้องยิง /api/auth/me เลย — เริ่มที่ loading = false ได้ทันที
 * ผลคือหน้าที่เรนเดอร์ตอนยังไม่ล็อกอิน (หน้าแนะนำระบบ) ออกมาพร้อมเนื้อหาตั้งแต่ HTML
 * ชุดแรก แทนที่จะเป็น spinner แล้วค่อยสลับหลัง fetch เสร็จ
 *
 * คุกกี้เป็นแค่คำใบ้สำหรับการเรนเดอร์ ไม่ใช่การยืนยันตัวตน — ข้อมูลจริงทุกชิ้น
 * ยังต้องผ่าน API ที่ตรวจลายเซ็นของ JWT อยู่ดี คุกกี้ปลอมจึงได้แค่หน้าเปล่า
 */
export function SessionProvider({
  children,
  hasSessionCookie = true,
}: {
  children: ReactNode;
  hasSessionCookie?: boolean;
}) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(hasSessionCookie);

  const refresh = useCallback(async () => {
    try {
      const data = await api.get<{ user: SessionUser }>("/api/auth/me");
      setUser(data.user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!hasSessionCookie) return;
    void refresh();
  }, [refresh, hasSessionCookie]);

  const value = useMemo(() => ({ user, loading, refresh, setUser }), [user, loading, refresh]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
