"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { api } from "./api";
import { fullName } from "./types";

/**
 * อ่าน GET หนึ่งตัวของ /api/admin/* — คืนข้อมูล ข้อผิดพลาด และ `reload` ให้หน้าเรียกหลังสั่งงานสำเร็จ
 *
 * `path` เป็น null = ยังไม่พร้อมเรียก (เช่นรอ id จาก route) หน้าจะได้ `loading` ค้างไว้แทนการยิงคำขอที่รู้อยู่แล้วว่าผิด
 * คำตอบที่มาช้ากว่าคำขอถัดไป (พิมพ์ค้นหาเร็ว ๆ) ถูกทิ้ง ไม่งั้นรายการกระพริบกลับไปเป็นผลของคำค้นก่อนหน้า
 */
export function useAdminData<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!path) return;
    let alive = true;
    setLoading(true);
    api
      .get<T>(path)
      .then((d) => {
        if (!alive) return;
        setData(d);
        setError(null);
      })
      .catch((err) => {
        if (alive) setError(err);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [path, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload, setData };
}

/**
 * ตัวกรองของหน้ารายการที่อยู่ใน query string — ลิงก์จากหน้าภาพรวม ("คำเชิญใกล้หมดอายุ") จึงเปิดมาพร้อมตัวกรองได้
 * และปุ่มย้อนกลับของเบราว์เซอร์พากลับไปที่ตัวกรองเดิม
 *
 * ช่องค้นหาพิมพ์ลงสถานะในหน้าก่อน แล้วค่อยเขียน URL หลังหยุดพิมพ์ 300 ms — เขียนทุกตัวอักษรจะได้ประวัติของเบราว์เซอร์
 * หนึ่งรายการต่อหนึ่งตัวอักษร และคำขอหนึ่งตัวต่อตัวอักษร
 */
export function useUrlFilters<K extends string>(keys: readonly K[]) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const values = useMemo(() => {
    const out = {} as Record<K, string>;
    for (const k of keys) out[k] = params.get(k) ?? "";
    return out;
    // keys เป็นค่าคงที่ของหน้า — เทียบด้วย join ไม่ต้องพึ่ง identity ของ array
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, keys.join(",")]);

  const set = useCallback(
    (patch: Partial<Record<K | "page", string>>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch) as [string, string | undefined][]) {
        if (v) next.set(k, v);
        else next.delete(k);
      }
      // เปลี่ยนตัวกรองแล้วต้องกลับไปหน้าแรก ไม่งั้นค้างอยู่หน้า 5 ของผลที่มีแค่หน้าเดียว
      if (!("page" in patch)) next.delete("page");
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  const page = Math.max(1, Number(params.get("page")) || 1);
  return { values, set, page };
}

/** ค่าที่พิมพ์อยู่ในช่องค้นหา — ส่งต่อให้ `onCommit` เมื่อหยุดพิมพ์ */
export function useDebounced(value: string, onCommit: (v: string) => void, ms = 300) {
  useEffect(() => {
    const t = setTimeout(() => onCommit(value), ms);
    return () => clearTimeout(t);
    // onCommit เปลี่ยน identity ทุกครั้งที่ URL เปลี่ยน — ผูกกับค่าที่พิมพ์อย่างเดียว
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, ms]);
}

/** query string จาก object — ข้ามค่าว่าง */
export function qs(params: Record<string, string | number | undefined | null>): string {
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") out.set(k, String(v));
  }
  const s = out.toString();
  return s ? `?${s}` : "";
}

/** ชื่อของบัญชี — `fullName()` (lib/types.ts) ตัวเดียวกับทุกหน้า แต่บัญชีที่ยังไม่มีชื่อ (คำเชิญที่ยังไม่เปิดใช้) ได้อีเมลแทน "—" */
export function accountName(u: {
  prefixTh?: string | null;
  firstnameTh?: string | null;
  lastnameTh?: string | null;
  email: string;
}): string {
  const name = fullName(u.prefixTh, u.firstnameTh, u.lastnameTh);
  return name === "—" ? u.email : name;
}
