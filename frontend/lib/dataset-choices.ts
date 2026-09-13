/**
 * ตัวเลือกของแบบฟอร์มลงทะเบียนชุดข้อมูล — ดึงจาก `GET /api/dataset-choices`
 *
 * เดิมรายการนี้เป็นค่าคงที่ใน `dataset-form.ts` คู่กับต้นฉบับใน
 * `backend/src/lib/dataset.ts` การเพิ่มตัวเลือกหรือแก้ป้ายสักตัวจึงต้องแก้โค้ดสองไฟล์
 * แล้ว build ใหม่ทั้งสองฝั่ง ตอนนี้แถวอยู่ในฐานข้อมูลและ BDI แก้ได้เองผ่าน admin API
 * หน้าเว็บจึงมาถาม แทนที่จะถือสำเนาไว้
 *
 * **ป้ายกับลำดับดึงมา ส่วนเงื่อนไขยังเป็นสำเนา** — `dataset-form.ts` ยังคง `formRules()`
 * ไว้เหมือนเดิม เพราะฟอร์มต้องรู้ผลของเงื่อนไขทันทีที่ผู้ใช้เลือก ต่างกันตรงที่เงื่อนไข
 * เป็นตรรกะที่อ้างรหัส ซึ่งเปลี่ยนพร้อมโค้ดอยู่แล้ว ส่วนป้ายเป็นข้อมูลที่เปลี่ยนได้เอง
 *
 * โหลดครั้งเดียวต่อการเปิดหน้าเว็บหนึ่งรอบ แล้วแชร์ promise กันระหว่างฟอร์มกับหน้า
 * รายละเอียด — ทั้งสองหน้าอยู่ในแท็บเดียวกันได้ และไม่ควรยิงซ้ำ
 */
"use client";

import { useEffect, useState } from "react";

import { api } from "./api";

/** ชื่อช่องฝั่ง API — ต้องตรงกับ CHOICE_FIELD_KEYS ใน backend/src/lib/dataset-choices-defaults.ts */
export const CHOICE_FIELD_KEYS = [
  "dataType",
  "dataTopic",
  "updateFrequencyUnit",
  "deliveryFrequency",
  "geoCoverage",
  "dataFormat",
  "dataCategory",
  "personalDataProcessingPeriod",
  "dataClassification",
  "licenseId",
] as const;

export type ChoiceFieldKey = (typeof CHOICE_FIELD_KEYS)[number];

export interface ChoiceOption {
  code: string;
  label: string;
}

export type DatasetChoices = Record<ChoiceFieldKey, ChoiceOption[]>;

/** ก่อนโหลดเสร็จทุกช่องว่าง — หน้าจอต้องรอ `loaded` ไม่ใช่เดาว่ามีตัวเลือกแล้ว */
export const EMPTY_CHOICES: DatasetChoices = CHOICE_FIELD_KEYS.reduce((acc, key) => {
  acc[key] = [];
  return acc;
}, {} as DatasetChoices);

let pending: Promise<DatasetChoices> | null = null;

function fetchChoices(): Promise<DatasetChoices> {
  pending ??= api
    .get<{ choices: Partial<DatasetChoices> }>("/api/dataset-choices")
    .then((data) => {
      const choices = { ...EMPTY_CHOICES };
      for (const key of CHOICE_FIELD_KEYS) choices[key] = data.choices[key] ?? [];
      return choices;
    })
    .catch((error: unknown) => {
      // ยิงใหม่ได้ในครั้งถัดไป — ไม่จำความล้มเหลวไว้ตลอดอายุแท็บ
      pending = null;
      throw error;
    });
  return pending;
}

/**
 * ตัวเลือกทุกช่อง พร้อมธงบอกว่าโหลดเสร็จหรือยัง
 *
 * `loaded` เป็น true เมื่อ "เลิกรอแล้ว" ไม่ใช่ "ได้ข้อมูลครบแล้ว" — ถ้า API ล้ม หน้าจอ
 * ต้องเดินต่อไปพร้อมรายการว่าง ไม่ใช่ค้างที่ตัวหมุนตลอดกาล ช่องที่ไม่มีตัวเลือกจะถูก
 * แสดงเป็นช่องที่กดไม่ได้ ซึ่งบอกผู้ใช้ว่ามีอะไรผิดมากกว่าฟอร์มที่ไม่มีวันปรากฏ
 */
export function useDatasetChoices(): { choices: DatasetChoices; loaded: boolean } {
  const [choices, setChoices] = useState<DatasetChoices>(EMPTY_CHOICES);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchChoices()
      .then((data) => {
        if (alive) setChoices(data);
      })
      .catch(() => undefined)
      .finally(() => {
        if (alive) setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  return { choices, loaded };
}

/**
 * ป้ายของรหัสที่เก็บไว้ — **คืนรหัสเดิมเมื่อไม่พบ**
 *
 * คำขอเก่าอาจถือรหัสที่ภายหลังถูกปิด (ซึ่ง `/api/dataset-choices` ไม่ส่งมาแล้ว) และ
 * แอดมินอาจเพิ่งเพิ่มรหัสที่แท็บนี้โหลดไปก่อนหน้า ทั้งสองกรณีต้องเห็นรหัส ไม่ใช่ค่าว่าง
 */
export function labelOf(options: ChoiceOption[], code: string | null | undefined): string | null {
  if (!code) return null;
  return options.find((option) => option.code === code)?.label ?? code;
}
