"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { useToast } from "@/components/ui/Toast";
import { api, ApiError } from "@/lib/api";

/**
 * เปิดฟอร์มลงทะเบียนชุดข้อมูลใบใหม่ — สร้างฉบับร่างแล้วพาเข้าไปกรอกต่อ
 *
 * คู่กับ `use-organization-registration.ts` และแยกออกมาด้วยเหตุผลเดียวกันทุกประการ:
 * ก้อนนี้เคยอยู่ในหน้า `/datasets` ที่เดียว พอหน้าแรกต้องมีทางเข้าฟอร์มด้วย (การ์ด
 * 2026-09-13 — ลิงก์ "หรือลงทะเบียนชุดข้อมูลเพิ่มเติม" ใต้ตัวเลขในกล่องของผู้ประสานงาน
 * ของหน่วยงาน) การคัดลอก POST + push + toast ไปไว้อีกที่หนึ่งแปลว่าสองหน้าจะเพี้ยนจากกัน
 * วันที่เส้นทางเปลี่ยน
 *
 * **ไม่เช็คสิทธิ์เอง** — `POST /api/dataset-requests` เรียก `prerequisiteError()` อยู่แล้ว
 * และเงื่อนไขมีมากกว่าที่หน้าเว็บมองเห็น (ต้องเป็นผู้ประสานงานของหน่วยงาน · หน่วยงานต้อง
 * ACTIVE · หน่วยงานต้องมีผู้มีอำนาจอนุมัติที่เปิดใช้งานบัญชีแล้ว) ข้อความที่ตอบกลับมาบอก
 * **วิธีแก้** ตามกติกาใน CLAUDE.md จึงเอามาแสดงตรง ๆ ดีกว่าให้หน้าเว็บเดาเงื่อนไขซ้ำแล้ว
 * ตอบคนละเหตุผลกับเซิร์ฟเวอร์
 */
export function useDatasetRegistration() {
  const router = useRouter();
  const { show } = useToast();
  const [starting, setStarting] = useState(false);

  const start = async () => {
    setStarting(true);
    try {
      const data = await api.post<{ request: { id: string } }>("/api/dataset-requests", {});
      router.push(`/datasets/${data.request.id}/edit`);
    } catch (err) {
      show({
        tone: "error",
        title: "สร้างคำขอไม่สำเร็จ",
        detail: err instanceof ApiError ? err.message : undefined,
      });
      setStarting(false);
    }
  };

  return { start, starting };
}
