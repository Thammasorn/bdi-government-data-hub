"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { ApiError, api } from "@/lib/api";
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

/** ชื่อที่เอาไปแสดง — ที่เดียว เพื่อให้กล่องเตือนกับเมนูผู้ใช้เรียกคนเดียวกันเหมือนกัน */
export function sessionUserName(user: SessionUser): string {
  return [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email;
}

/**
 * ตัวตนของเบราว์เซอร์นี้เปลี่ยนไปแล้ว ระหว่างที่แท็บนี้เปิดค้างอยู่
 *
 * `nextName === null` = ไม่มีใครล็อกอินอยู่แล้ว (ออกจากระบบ หรือ session ถูกเพิกถอน)
 */
export interface SessionChange {
  previousName: string;
  nextName: string | null;
}

interface SessionValue {
  user: SessionUser | null;
  loading: boolean;
  refresh: () => Promise<void>;
  setUser: (u: SessionUser | null) => void;
  /** ไม่ null = สิ่งที่แท็บนี้แสดงอยู่ ไม่ใช่ตัวตนที่ backend ใช้จริงอีกต่อไป */
  changed: SessionChange | null;
}

/**
 * ตัวตนล่าสุดของเบราว์เซอร์ ประกาศผ่าน localStorage ให้แท็บอื่นรู้
 *
 * cookie `bdi_session` มีใบเดียวต่อเบราว์เซอร์ และ `issueSession()` หมุนใบเสมอ —
 * ล็อกอินหรือเปิดใช้งานบัญชีใหม่จึงเพิกถอน session เดิมทิ้งจริง ๆ (`ROTATED`) ซึ่งถูกแล้ว
 * ที่พังคือแท็บเดิมไม่มีทางรู้: มันอ่าน /api/auth/me ครั้งเดียวตอน mount แล้วถือชื่อนั้นไว้
 * จนกว่าจะโหลดหน้าใหม่ ทั้งที่ทุก request หลังจากนั้นพก cookie ใบใหม่ไป
 *
 * event `storage` ยิงเฉพาะแท็บที่**ไม่ได้**เป็นคนเขียน ซึ่งตรงกับที่ต้องการพอดี —
 * แท็บที่กดล็อกอินเองจะไม่เตือนตัวเอง และไม่ต้องยิง API เพิ่มแม้แต่ครั้งเดียว
 */
const IDENTITY_KEY = "bdi:identity";

interface AnnouncedIdentity {
  userId: string | null;
  name: string | null;
}

function announceIdentity(user: SessionUser | null) {
  try {
    const payload: AnnouncedIdentity & { at: number } = {
      userId: user?.id ?? null,
      name: user ? sessionUserName(user) : null,
      at: Date.now(),
    };
    window.localStorage.setItem(IDENTITY_KEY, JSON.stringify(payload));
  } catch {
    // localStorage ปิดอยู่ (โหมดส่วนตัวบางตัว) — ตัวสำรองคือการตรวจซ้ำตอนกลับมาที่แท็บ
  }
}

/**
 * ประกาศว่าเบราว์เซอร์นี้ไม่มีใครล็อกอินแล้ว โดยไม่ต้องแตะ state ของแท็บตัวเอง
 *
 * ปกติการประกาศเป็นหน้าที่ของ effect ข้างล่างซึ่งเฝ้าดู `user` อยู่ แต่ปุ่มออกจากระบบ
 * เลือกโหลดหน้าใหม่ทั้งหน้าแทนการ setUser(null) (เหตุผลอยู่ที่ AppShell) — เมื่อไม่มี
 * state เปลี่ยน ก็ไม่มี effect ไหนทำงาน แท็บอื่นจึงต้องได้ยินจากตรงนี้แทน
 */
export function announceSignOut() {
  announceIdentity(null);
}

function parseIdentity(raw: string | null): AnnouncedIdentity | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as AnnouncedIdentity;
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

/** ตรวจซ้ำได้ถี่สุดเท่านี้ — กันแท็บที่ถูกสลับไปมาถี่ ๆ ยิง /api/auth/me รัว */
const RECHECK_INTERVAL_MS = 30_000;

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
  const [changed, setChanged] = useState<SessionChange | null>(null);

  /**
   * ตัวฟัง event ผูกครั้งเดียวตอน mount จึงอ่าน `user` จาก state ตรง ๆ ไม่ได้ — มันจะ
   * ปิดทับค่าของรอบแรกไว้ตลอดกาล ref ให้ค่าล่าสุดโดยไม่ต้องผูกตัวฟังใหม่ทุกครั้งที่
   * ผู้ใช้เปลี่ยน (ซึ่งจะทำให้พลาด event ที่มาถึงระหว่างถอด/ใส่ตัวฟัง)
   */
  const userRef = useRef<SessionUser | null>(null);
  const changedRef = useRef<SessionChange | null>(null);
  userRef.current = user;
  changedRef.current = changed;

  /** ประกาศครั้งเดียวต่อการเปลี่ยนตัวตนจริง ๆ ไม่ใช่ทุกครั้งที่ refresh คืนอ็อบเจ็กต์ใหม่ */
  const announcedRef = useRef<string | null | undefined>(undefined);

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

  // บอกแท็บอื่นว่าตอนนี้เบราว์เซอร์นี้เป็นใคร
  useEffect(() => {
    if (loading) return;
    const id = user?.id ?? null;
    if (announcedRef.current === id) return;
    announcedRef.current = id;
    announceIdentity(user);
  }, [user, loading]);

  // แท็บอื่นประกาศตัวตนใหม่ — รู้ได้ภายในไม่ถึงวินาที โดยไม่ต้องยิง API
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== IDENTITY_KEY) return;
      const current = userRef.current;
      // ยังไม่เคยล็อกอินในแท็บนี้ ก็ไม่มีตัวตนอะไรให้ขัดกัน
      if (!current || changedRef.current) return;
      const announced = parseIdentity(event.newValue);
      if (!announced || announced.userId === current.id) return;
      setChanged({ previousName: sessionUserName(current), nextName: announced.name });
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  /**
   * ตัวสำรอง: ตรวจซ้ำตอนกลับมาที่แท็บ
   *
   * ครอบกรณีที่การประกาศข้างบนไม่ครอบ — localStorage ถูกปิด, แท็บเปิดค้างมาตั้งแต่ก่อน
   * มีฟีเจอร์นี้, session ถูกเพิกถอนจากที่อื่น (ออกจากระบบทุกอุปกรณ์ · ระงับบัญชี)
   * หรือหมดอายุเอง — ซึ่งกรณีหลังนี้เดิมจะโผล่เป็น 401 ปริศนาตอนกดปุ่ม
   *
   * นับเฉพาะ 401 ว่าเป็น "ออกจากระบบแล้ว" เน็ตสะดุดชั่วขณะไม่ใช่การเปลี่ยนตัวตน
   */
  useEffect(() => {
    if (!hasSessionCookie) return;
    let lastCheck = 0;
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (!userRef.current || changedRef.current) return;
      if (Date.now() - lastCheck < RECHECK_INTERVAL_MS) return;
      lastCheck = Date.now();
      void api
        .get<{ user: SessionUser }>("/api/auth/me")
        .then((data) => {
          const current = userRef.current;
          if (!current || changedRef.current || data.user.id === current.id) return;
          setChanged({
            previousName: sessionUserName(current),
            nextName: sessionUserName(data.user),
          });
        })
        .catch((err: unknown) => {
          const current = userRef.current;
          if (!current || changedRef.current) return;
          if (err instanceof ApiError && err.status === 401) {
            setChanged({ previousName: sessionUserName(current), nextName: null });
          }
        });
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [hasSessionCookie]);

  const value = useMemo(
    () => ({ user, loading, refresh, setUser, changed }),
    [user, loading, refresh, changed],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
