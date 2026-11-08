/**
 * ค่าตั้งระบบที่ผู้ดูแลระบบแก้จาก /console → ตั้งค่าระบบ (การ์ด "อีเมลเตือนก่อนคำเชิญหมดอายุ (ตั้งจำนวนวันได้ใน admin)", 2026-11-03)
 *
 * ตาราง `administration.system_setting` เก็บแค่ค่าที่มีคนตั้งแล้ว ส่วนรายการค่าที่มีได้ ช่วง และค่าเริ่มต้นอยู่ที่ `SYSTEM_SETTINGS` ที่เดียว —
 * key ที่ไม่อยู่ในนี้ตั้งไม่ได้ ไม่มีแถว = ค่าเริ่มต้น และแถวที่ค่าใช้ไม่ได้ (มีคนแก้ด้วยมือ) ตกกลับไปใช้ค่าเริ่มต้นพร้อมเตือน ไม่โยน:
 * ค่าตั้งที่เสียต้องไม่ทำให้ตัวเฝ้าใน delivery-worker ล้มทั้งลูป
 *
 * ผู้อ่านอ่านจากฐานข้อมูลทุกครั้ง ไม่มี cache — ค่าที่แก้มีผลกับรอบถัดไปของตัวเฝ้าโดยไม่ต้อง restart และ API กับ worker เป็นคนละ process
 * จึงไม่มีอะไรให้ล้าง
 */
import type { Prisma, PrismaClient } from "@prisma/client";

import { env } from "../env.js";

type Db = PrismaClient | Prisma.TransactionClient;

const DAY_SECONDS = 24 * 60 * 60;

interface IntegerSetting {
  label: string;
  description: string;
  unit: string;
  defaultValue: number;
  min: number;
  /** ฟังก์ชัน ไม่ใช่ค่าคงที่ — เพดานบางตัวมาจาก env ที่เปลี่ยนได้ระหว่าง deploy */
  max: () => number;
}

export const SYSTEM_SETTINGS = {
  /**
   * เตือนผู้ได้รับคำเชิญทางอีเมล N วันก่อนคีย์หมดอายุ (`workers/invitation-reminders.ts`) — 0 = ไม่เตือน
   *
   * ค่าเริ่มต้น 1 วันตามที่ผู้ใช้ขอ ("ส่ง email เตือนก่อน invitation หมดอายุ 1 วัน") เพดานคืออายุคำเชิญลบหนึ่งวัน: คำเชิญที่อายุทั้งหมด
   * ไม่ถึง N วันไม่ถูกเตือน (เตือนทันทีที่ออกไม่มีประโยชน์) ค่าเท่าอายุคำเชิญจึงเท่ากับปิดโดยไม่บอกใคร
   */
  invitation_reminder_days: {
    label: "เตือนก่อนคำเชิญหมดอายุ",
    description:
      "ส่งอีเมลเตือนผู้ได้รับคำเชิญที่ยังไม่ได้ลงทะเบียน ก่อน Activation Key หมดอายุตามจำนวนวันที่กำหนด " +
      "อีเมลเตือนบอกหัวข้อและวันที่ส่งของอีเมลคำเชิญฉบับเดิม ไม่มีลิงก์และไม่มี Activation Key — ตั้งเป็น 0 เพื่อไม่ส่ง",
    unit: "วัน",
    defaultValue: 1,
    min: 0,
    max: () => Math.max(0, Math.floor(env.auth.activationKeyTtlSeconds / DAY_SECONDS) - 1),
  },
  /**
   * ตรวจสถานะการ์ด Jira ทุกกี่วินาที (`workers/jira.ts`) — การ์ด "[Enhance] JIRA integration" (2026-11-08)
   *
   * หนึ่งรอบคือการค้นใน Jira หนึ่งครั้งต่อการ์ด 100 ใบ ไม่ว่าเปิดอยู่กี่ใบ ค่าเริ่มต้น 15 นาที (96 ครั้งต่อวัน) พื้นต่ำสุด 60 วินาทีกันพิมพ์ผิดเป็น
   * ทุกวินาที เพดานหนึ่งวัน หน้าจอแสดงค่านี้ทั้งในหน้าตั้งค่าระบบและในหน้าตั้งค่า Jira
   */
  jira_sync_interval_seconds: {
    label: "ตรวจสถานะการ์ด Jira ทุก",
    description:
      "ระบบถาม Jira เป็นระยะว่าการ์ดของผู้เชี่ยวชาญใบไหนถูกย้ายไป Done แล้ว เพื่อคัดลอก comment เข้าประวัติของคำขอ " +
      "หนึ่งรอบใช้การค้นหนึ่งครั้ง ไม่ว่าการ์ดจะเปิดอยู่กี่ใบ",
    unit: "วินาที",
    defaultValue: 900,
    min: 60,
    max: () => DAY_SECONDS,
  },
} as const satisfies Record<string, IntegerSetting>;

export type SystemSettingKey = keyof typeof SYSTEM_SETTINGS;

export function isSystemSettingKey(key: string): key is SystemSettingKey {
  return Object.prototype.hasOwnProperty.call(SYSTEM_SETTINGS, key);
}

/** ค่าที่ใช้ได้ของ setting — จำนวนเต็มในช่วง ไม่งั้น null (ผู้เรียกตัดสินว่าจะตอบ 400 หรือใช้ค่าเริ่มต้น) */
export function parseSettingValue(key: SystemSettingKey, value: unknown): number | null {
  const spec = SYSTEM_SETTINGS[key];
  return typeof value === "number" && Number.isInteger(value) && value >= spec.min && value <= spec.max() ? value : null;
}

/**
 * ค่าปัจจุบันของ setting หนึ่งตัว — ที่ตั้งไว้ หรือค่าเริ่มต้น
 *
 * ค่าที่ตั้งไว้แต่เกินเพดานในตอนนี้ (อายุคำเชิญใน env ถูกลดลงทีหลัง) ยังคืนตามที่ตั้ง ไม่ปัดลง — ตัวเฝ้าเองไม่พบคีย์ที่เข้าเกณฑ์ จึงเท่ากับปิด
 * ซึ่งตรงกับความหมายเดิม หน้าจอแสดงคำเตือนให้แก้ (`listSystemSettings().outOfRange`)
 */
export async function readSystemSetting(db: Db, key: SystemSettingKey): Promise<number> {
  const row = await db.systemSetting.findUnique({ where: { key } });
  if (!row) return SYSTEM_SETTINGS[key].defaultValue;
  if (typeof row.value === "number" && Number.isInteger(row.value) && row.value >= SYSTEM_SETTINGS[key].min) return row.value;
  console.warn(`[settings] ค่า ${key} ในฐานข้อมูลใช้ไม่ได้ (${JSON.stringify(row.value)}) — ใช้ค่าเริ่มต้น ${SYSTEM_SETTINGS[key].defaultValue}`);
  return SYSTEM_SETTINGS[key].defaultValue;
}

/** ทุก setting พร้อมค่าปัจจุบัน ช่วง และใครแก้ล่าสุด — สิ่งที่หน้า /console/settings แสดง */
export async function listSystemSettings(db: Db) {
  const rows = await db.systemSetting.findMany();
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return Promise.all(
    (Object.keys(SYSTEM_SETTINGS) as SystemSettingKey[]).map(async (key) => {
      const spec = SYSTEM_SETTINGS[key];
      const value = await readSystemSetting(db, key);
      const row = byKey.get(key);
      return {
        key,
        label: spec.label,
        description: spec.description,
        unit: spec.unit,
        value,
        defaultValue: spec.defaultValue,
        isDefault: !row,
        min: spec.min,
        max: spec.max(),
        /** ค่าที่ตั้งไว้เกินเพดานของตอนนี้ — ตั้งก่อนอายุคำเชิญจะถูกลดลง */
        outOfRange: value > spec.max(),
        updatedAt: row?.updatedAt ?? null,
        updatedBy: row?.updatedBy ?? null,
      };
    }),
  );
}
