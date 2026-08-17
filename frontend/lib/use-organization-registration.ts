"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { useToast } from "@/components/ui/Toast";
import { api, ApiError } from "@/lib/api";

/**
 * เปิดฟอร์มลงทะเบียนหน่วยงานของผู้ใช้คนนี้ — ทั้งกรณีเริ่มใหม่และกรณีกลับเข้าใบเดิม
 *
 * `POST /api/organizations` ทำสองอย่างนี้ในตัวอยู่แล้ว: ยังไม่มีคำขอที่ยังไม่จบ ก็สร้าง
 * ฉบับร่างให้ (พร้อมข้อมูลที่เจ้าหน้าที่เตรียมไว้ให้หน่วยงานนั้น) ถ้ามีอยู่แล้วจะตอบ
 * 409 `exists` พร้อม `requestId` ของใบเดิม หน้าจอที่เรียกจึงไม่ต้องรู้ล่วงหน้าว่าอยู่กรณีไหน
 * และไม่ต้องยิงรายการคำขอมาก่อนเพื่อเดา
 *
 * เดิมโค้ดก้อนนี้อยู่ในหน้าแรกที่เดียว และเรียกได้เฉพาะผู้ใช้ที่ยัง **ไม่มี** หน่วยงาน
 * ผู้ใช้ที่เจ้าหน้าที่ผูกหน่วยงานไว้ให้ล่วงหน้าจึงไม่มีปุ่มไหนพาเข้าฟอร์มได้เลย
 */
export function useOrganizationRegistration() {
  const router = useRouter();
  const { show } = useToast();
  const [starting, setStarting] = useState(false);

  const start = async () => {
    setStarting(true);
    try {
      const data = await api.post<{ organization: { id: string } }>("/api/organizations", {});
      router.push(`/organizations/${data.organization.id}/edit`);
    } catch (err) {
      if (err instanceof ApiError && err.code === "exists" && err.requestId) {
        router.push(`/organizations/${err.requestId}/edit`);
        return;
      }
      show({
        tone: "error",
        title: "เปิดฟอร์มลงทะเบียนหน่วยงานไม่สำเร็จ",
        detail: err instanceof ApiError ? err.message : undefined,
      });
      setStarting(false);
    }
  };

  return { start, starting };
}
