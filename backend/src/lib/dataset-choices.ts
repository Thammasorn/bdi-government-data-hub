/**
 * รายการตัวเลือก (code list) ของแบบฟอร์มลงทะเบียนชุดข้อมูล — อ่านจากฐานข้อมูล
 *
 * แถวจริงอยู่ที่ `administration.dataset_choice` แอดมินแก้ป้าย เรียงลำดับ เพิ่มรหัส
 * หรือปิดตัวเลือกได้ผ่าน `/api/admin/dataset-choices` โดยไม่ต้อง deploy
 * ค่าตั้งต้นที่ใช้ seed (และใช้เป็น fallback) อยู่ที่ `dataset-choices-defaults.ts`
 *
 * ## ทำไมต้องเป็น cache ที่อ่านแบบ synchronous
 *
 * ผู้ใช้ของไฟล์นี้ถูกประเมินตั้งแต่ตอน import ซึ่งเกิดก่อน main() เสมอ — zod schema ใน
 * `lib/dataset.ts` และ `tickFields()` ใน `lib/document-render.ts` ลำพัง `index.ts` ที่
 * import คลาส error ตัวเดียวก็ลากทั้งสายมาประเมินแล้ว accessor ทุกตัวในไฟล์นี้จึงต้อง
 * เรียกได้แบบ synchronous และ **ต้องอ่าน `snapshot` ใหม่ทุกครั้ง** ห้าม memo ห้าม hoist
 * ค่าออกนอก closure ไม่งั้นจะได้ภาพก่อนโหลดค้างไว้ตลอดอายุโปรเซส
 *
 * `loadChoices()` ถูก await ใน main() ตอนบูต และ `refreshChoices()` ถูกเรียกหลังแอดมิน
 * เขียนทุกครั้ง ทั้งคู่สร้างเซตที่ derive แล้วเสร็จ **ข้างใน** ตัวเองแล้วสลับทั้งก้อนทีเดียว
 *
 * ## ทำไมต้องมี fallback ไม่ใช่โยนทิ้ง
 *
 * `seed:masters` เผยแพร่ A4.docx ซึ่งมี placeholder `{{tick.<ช่อง>.<รหัส>}}` อยู่ 75 ตัว
 * และ `assertKnownPlaceholders()` ตรวจชื่อเหล่านั้นกับรายการที่ไฟล์นี้คืนให้ ถ้าไฟล์นี้
 * คืนรายการว่างเมื่อตารางยังว่าง **สคริปต์ที่มีหน้าที่เติมตารางจะรันไม่ผ่านจนกว่าตาราง
 * จะถูกเติม** — ล็อกตัวเองตาย fallback จึงไม่ใช่ตาข่ายนิรภัย แต่เป็นส่วนที่รับน้ำหนัก
 *
 * production ยังบูตด้วย `migrate deploy && node dist/index.js` ซึ่งไม่มีขั้นตอน seed
 * การโยนตอนบูตจึงเท่ากับพาเว็บสาธารณะลงเพราะตารางที่ยังไม่มีใครเติม
 */
import { Prisma } from "@prisma/client";

import { prisma } from "../db.js";
import {
  CHOICE_FIELD_KEYS,
  DATASET_CHOICE_DEFAULTS,
  type ChoiceFieldKey,
} from "./dataset-choices-defaults.js";

export { CHOICE_FIELD_KEYS, type ChoiceFieldKey };

export interface ChoiceOption {
  code: string;
  label: string;
}

export type ChoiceSource = "database" | "defaults";

interface FieldSnapshot {
  /** รหัสทั้งหมด รวมที่ปิดอยู่ — ใช้ตรวจค่าที่บันทึกไว้แล้วและใช้ตั้งชื่อช่องติ๊ก */
  allCodes: ReadonlySet<string>;
  /** เฉพาะที่เปิดอยู่ เรียงตาม display_order แล้ว — ใช้ทำตัวเลือกบนหน้าจอ */
  active: ChoiceOption[];
  /** รหัส → ป้าย รวมที่ปิดอยู่ ป้ายของคำขอเก่าต้องยังอ่านออก */
  labels: ReadonlyMap<string, string>;
  source: ChoiceSource;
}

interface ChoiceSnapshot {
  fields: ReadonlyMap<ChoiceFieldKey, FieldSnapshot>;
  /** ชื่อช่องติ๊กที่มาจาก code list — ยังไม่รวมช่อง boolean ดู lib/document-render.ts */
  tickVariables: ReadonlySet<string>;
  source: ChoiceSource;
  count: number;
}

interface ChoiceRow {
  fieldKey: string;
  code: string;
  labelTh: string;
  displayOrder: number;
  isActive: boolean;
}

const FIELD_KEYS = new Set<string>(CHOICE_FIELD_KEYS);

function defaultRows(fieldKey: ChoiceFieldKey): ChoiceRow[] {
  return DATASET_CHOICE_DEFAULTS.filter((row) => row.fieldKey === fieldKey).map((row) => ({
    fieldKey: row.fieldKey,
    code: row.code,
    labelTh: row.labelTh,
    displayOrder: row.displayOrder,
    isActive: true,
  }));
}

function buildField(rows: ChoiceRow[], source: ChoiceSource): FieldSnapshot {
  const ordered = [...rows].sort(
    (a, b) => a.displayOrder - b.displayOrder || a.code.localeCompare(b.code),
  );
  return {
    allCodes: new Set(ordered.map((row) => row.code)),
    active: ordered
      .filter((row) => row.isActive)
      .map((row) => ({ code: row.code, label: row.labelTh })),
    labels: new Map(ordered.map((row) => [row.code, row.labelTh])),
    source,
  };
}

function buildSnapshot(rowsByField: Map<ChoiceFieldKey, ChoiceRow[]>): ChoiceSnapshot {
  const fields = new Map<ChoiceFieldKey, FieldSnapshot>();
  const tickVariables = new Set<string>();
  let usedDefaults = false;
  let count = 0;

  for (const fieldKey of CHOICE_FIELD_KEYS) {
    const rows = rowsByField.get(fieldKey) ?? [];
    /**
     * fallback **รายคีย์** ไม่ใช่ทั้งชุด — ช่องเดียวที่ขาดไปคือช่องที่อันตรายที่สุด
     * `fillTemplate()` ใช้ nullGetter คืนสตริงว่าง ช่องติ๊กที่ไม่มีค่าป้อนจึงพิมพ์เป็น
     * ช่องว่าง ซึ่งบนกระดาษ A4 อ่านว่า "ไม่ได้เลือก" — PDF ที่มีคนลงนามจริงจะกลายเป็น
     * เอกสารที่คำตอบของผู้ใช้หายไปเงียบ ๆ
     */
    const useDefaults = rows.length === 0;
    if (useDefaults) usedDefaults = true;
    const effective = useDefaults ? defaultRows(fieldKey) : rows;
    count += effective.length;

    fields.set(fieldKey, buildField(effective, useDefaults ? "defaults" : "database"));
    for (const row of effective) tickVariables.add(`tick.${fieldKey}.${row.code}`);
  }

  return { fields, tickVariables, source: usedDefaults ? "defaults" : "database", count };
}

/** ภาพก่อนโหลด — ค่าตั้งต้นล้วน เพื่อให้ accessor ไม่มีวันคืน undefined หรือโยน */
let snapshot: ChoiceSnapshot = buildSnapshot(new Map());

async function readRows(): Promise<Map<ChoiceFieldKey, ChoiceRow[]> | null> {
  try {
    const rows = await prisma.datasetChoice.findMany({
      orderBy: [{ fieldKey: "asc" }, { displayOrder: "asc" }],
      select: { fieldKey: true, code: true, labelTh: true, displayOrder: true, isActive: true },
    });

    const byField = new Map<ChoiceFieldKey, ChoiceRow[]>();
    for (const row of rows) {
      // แถวของ field_key ที่โค้ดไม่รู้จักถูกข้าม — แอดมินเพิ่ม "ช่อง" ใหม่เองไม่ได้ เพิ่มได้แต่ "ตัวเลือก"
      if (!FIELD_KEYS.has(row.fieldKey)) continue;
      const key = row.fieldKey as ChoiceFieldKey;
      const bucket = byField.get(key);
      if (bucket) bucket.push(row);
      else byField.set(key, [row]);
    }
    return byField;
  } catch (error) {
    /**
     * ตารางยังไม่มี (P2021) แปลว่า `migrate deploy` ยังไม่ได้รัน — ปกติสำหรับการบูต
     * ครั้งแรกของ stack ใหม่ ไม่ใช่เหตุให้ API ทั้งตัวไม่ขึ้น
     */
    const code = error instanceof Prisma.PrismaClientKnownRequestError ? error.code : "";
    console.warn(
      `[dataset-choices] อ่านตาราง administration.dataset_choice ไม่ได้${code ? ` (${code})` : ""} — ` +
        `ใช้ค่าตั้งต้นในโค้ดไปก่อน: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

async function load(label: string): Promise<void> {
  const byField = await readRows();
  const next = buildSnapshot(byField ?? new Map());

  // สลับทีเดียวหลังสร้างเสร็จทั้งก้อน — ไม่มีจังหวะที่ผู้อ่านเห็นภาพครึ่ง ๆ กลาง ๆ
  snapshot = next;

  if (next.source === "database") {
    console.log(`[dataset-choices] ${label} — ${next.count} ตัวเลือกจากฐานข้อมูล`);
    return;
  }

  const missing = CHOICE_FIELD_KEYS.filter((key) => next.fields.get(key)?.source === "defaults");
  console.warn(
    `[dataset-choices] ${label} — ไม่พบตัวเลือกในฐานข้อมูลสำหรับ: ${missing.join(", ")} ` +
      `จึงใช้ค่าตั้งต้นในโค้ดแทน กรุณารัน \`npm run seed:masters\` แล้วรีสตาร์ต backend ` +
      `หรือเรียก POST /api/admin/dataset-choices/refresh`,
  );
}

/** เรียกครั้งเดียวตอนบูต ใน main() ก่อนเปิดรับ request */
export async function loadChoices(): Promise<void> {
  await load("โหลดตอนบูต");
}

/** เรียกหลังแอดมินเขียน หรือหลัง seed ในโปรเซสเดียวกัน */
export async function refreshChoices(): Promise<void> {
  await load("โหลดใหม่");
}

function field(fieldKey: ChoiceFieldKey): FieldSnapshot {
  return snapshot.fields.get(fieldKey) ?? buildField(defaultRows(fieldKey), "defaults");
}

/**
 * รหัสทั้งหมดของช่องนั้น **รวมที่ปิดอยู่**
 *
 * ใช้กับการตรวจค่า เพราะ `datasetSubmitSchema` ถูก parse กับค่าที่ **บันทึกไว้แล้ว**
 * ตอนสร้าง PDF และตอนนำส่ง ไม่ใช่กับ input ของผู้ใช้ — ถ้าตรวจด้วยเฉพาะรหัสที่เปิดอยู่
 * การปิดตัวเลือกหนึ่งจะทำให้ร่างทุกฉบับที่ถือรหัสนั้นนำส่งไม่ได้ ทั้งที่กรอกครบ
 */
export function allCodes(fieldKey: ChoiceFieldKey): ReadonlySet<string> {
  return field(fieldKey).allCodes;
}

/** ตัวเลือกที่ยังเปิดอยู่ เรียงตาม display_order — ใช้ทำ dropdown บนหน้าจอ */
export function activeChoices(fieldKey: ChoiceFieldKey): ChoiceOption[] {
  return field(fieldKey).active;
}

/** ป้ายไทยของรหัส คืนรหัสเดิมเมื่อไม่รู้จัก เพื่อไม่ให้คำขอเก่าแสดงเป็นค่าว่าง */
export function choiceLabel(fieldKey: ChoiceFieldKey, code: string): string {
  return field(fieldKey).labels.get(code) ?? code;
}

/** ชื่อช่องติ๊กที่มาจาก code list เช่น `tick.dataType.1` */
export function choiceTickVariables(): ReadonlySet<string> {
  return snapshot.tickVariables;
}

/** ตัวเลือกทุกช่องที่เปิดอยู่ — รูปของ `GET /api/dataset-choices` */
export function activeChoiceMap(): Record<ChoiceFieldKey, ChoiceOption[]> {
  const out = {} as Record<ChoiceFieldKey, ChoiceOption[]>;
  for (const key of CHOICE_FIELD_KEYS) out[key] = activeChoices(key);
  return out;
}

/** ค่าที่ใช้อยู่มาจากฐานข้อมูลหรือจากค่าตั้งต้นในโค้ด — รายงานที่ /health/ready */
export function choiceStatus(): { source: ChoiceSource; count: number } {
  return { source: snapshot.source, count: snapshot.count };
}
