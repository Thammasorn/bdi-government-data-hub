/**
 * ที่อยู่ไทย (จังหวัด / อำเภอ / ตำบล) — อ่านจากฐานข้อมูล
 *
 * แถวจริงอยู่ที่ `administration.province / district / sub_district` แอดมินแก้ชื่อ รหัสไปรษณีย์
 * เพิ่มรายการ หรือปิดรายการได้ผ่าน `/api/admin/addresses` โดยไม่ต้อง deploy
 *
 * รหัสคือรหัสกรมการปกครอง (กรุงเทพมหานคร = 10) ดูคอมเมนต์ที่ model Province ใน schema.prisma
 *
 * ## ทำไมเป็น cache
 *
 * dropdown ของฟอร์มเรียก `listProvinces()` / `listAmphoes()` / `listSubdistricts()` ทุกครั้งที่
 * เปลี่ยนช่อง และ `isValidAddress()` / `lookupZipcode()` ถูกเรียกแบบ synchronous จาก route —
 * ข้อมูลทั้งชุด (~8.4 พันแถว) จึงอยู่ในหน่วยความจำ `loadAddresses()` ถูก await ใน main() ตอนบูต
 * และ `refreshAddresses()` ถูกเรียกหลังแอดมินเขียนทุกครั้ง ทั้งคู่สร้างภาพใหม่เสร็จก่อนแล้วสลับ
 * ทีเดียว accessor ทุกตัวอ่าน `snapshot` ใหม่ทุกครั้ง ห้าม memo
 *
 * ## ไม่มี fallback ไปที่ไฟล์ JSON
 *
 * ต่างจาก dataset-choices: `resolveAddressCodes()` แปลงชื่อเป็นรหัสด้วยการอ่านตารางตรง ๆ ถ้า
 * dropdown ใช้ไฟล์ขณะที่ตารางว่าง ผู้ใช้จะเลือกที่อยู่ได้ ผ่านการตรวจได้ แล้วรหัสถูกบันทึกเป็น null
 * เงียบ ๆ — ตารางว่างจึงแสดงเป็น dropdown ว่างและ `/health/ready` บอกไว้ ซึ่งเห็นได้ทันที
 * (migration `20261006120000_dopa_address_codes` เติมตารางให้แล้ว ปกติจึงไม่ว่าง)
 *
 * ## รายการที่ปิดอยู่
 *
 * dropdown แสดงเฉพาะที่เปิดอยู่ แต่ `isValidAddress()` และ `lookupZipcode()` นับรวมที่ปิดด้วย —
 * เหตุผลเดียวกับ `allCodes()` ใน dataset-choices: ที่อยู่ที่บันทึกไว้ก่อนปิดต้องยังนำส่งได้
 */
import { Prisma } from "@prisma/client";

import { prisma } from "../db.js";

export interface Subdistrict {
  name: string;
  zipcode: string;
}

interface SubDistrictNode {
  code: string;
  name: string;
  zipcode: string | null;
  isActive: boolean;
}

interface DistrictNode {
  code: string;
  name: string;
  isActive: boolean;
  subDistricts: SubDistrictNode[];
  subDistrictByName: Map<string, SubDistrictNode>;
}

interface ProvinceNode {
  code: string;
  name: string;
  isActive: boolean;
  districts: DistrictNode[];
  districtByName: Map<string, DistrictNode>;
}

interface AddressSnapshot {
  /** เรียงตามชื่อภาษาไทย — ลำดับที่ dropdown ใช้ */
  provinces: ProvinceNode[];
  provinceByName: Map<string, ProvinceNode>;
  counts: { provinces: number; districts: number; subDistricts: number };
}

const collator = new Intl.Collator("th");
const byName = (a: { name: string }, b: { name: string }) => collator.compare(a.name, b.name);

function emptySnapshot(): AddressSnapshot {
  return { provinces: [], provinceByName: new Map(), counts: { provinces: 0, districts: 0, subDistricts: 0 } };
}

let snapshot: AddressSnapshot = emptySnapshot();

async function readSnapshot(): Promise<AddressSnapshot | null> {
  try {
    const [provinces, districts, subDistricts] = await Promise.all([
      prisma.province.findMany({ select: { code: true, nameTh: true, isActive: true } }),
      prisma.district.findMany({ select: { code: true, nameTh: true, isActive: true, provinceCode: true } }),
      prisma.subDistrict.findMany({
        select: { code: true, nameTh: true, isActive: true, districtCode: true, postalCode: true },
      }),
    ]);

    const provinceNodes = new Map<string, ProvinceNode>();
    for (const p of provinces) {
      provinceNodes.set(p.code, {
        code: p.code,
        name: p.nameTh,
        isActive: p.isActive,
        districts: [],
        districtByName: new Map(),
      });
    }

    const districtNodes = new Map<string, DistrictNode>();
    for (const d of districts) {
      const node: DistrictNode = {
        code: d.code,
        name: d.nameTh,
        isActive: d.isActive,
        subDistricts: [],
        subDistrictByName: new Map(),
      };
      districtNodes.set(d.code, node);
      const parent = provinceNodes.get(d.provinceCode);
      parent?.districts.push(node);
      parent?.districtByName.set(node.name, node);
    }

    for (const s of subDistricts) {
      const node: SubDistrictNode = { code: s.code, name: s.nameTh, zipcode: s.postalCode, isActive: s.isActive };
      const parent = districtNodes.get(s.districtCode);
      parent?.subDistricts.push(node);
      parent?.subDistrictByName.set(node.name, node);
    }

    const ordered = [...provinceNodes.values()].sort(byName);
    for (const p of ordered) {
      p.districts.sort(byName);
      for (const d of p.districts) d.subDistricts.sort(byName);
    }

    return {
      provinces: ordered,
      provinceByName: new Map(ordered.map((p) => [p.name, p])),
      counts: { provinces: provinces.length, districts: districts.length, subDistricts: subDistricts.length },
    };
  } catch (error) {
    // ตารางยังไม่มี (P2021) แปลว่า `migrate deploy` ยังไม่ได้รัน — ไม่ใช่เหตุให้ API ทั้งตัวไม่ขึ้น
    const code = error instanceof Prisma.PrismaClientKnownRequestError ? error.code : "";
    console.warn(
      `[address] อ่านตาราง administration.province/district/sub_district ไม่ได้${code ? ` (${code})` : ""}: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

async function load(label: string): Promise<void> {
  const next = await readSnapshot();
  // อ่านไม่ได้ให้คงภาพเดิมไว้ ดีกว่าล้าง dropdown ทั้งระบบเพราะฐานข้อมูลสะดุดครั้งเดียว
  if (!next) return;
  snapshot = next;

  const { provinces, districts, subDistricts } = next.counts;
  if (provinces === 0) {
    console.warn(
      `[address] ${label} — ตารางที่อยู่ว่าง dropdown จังหวัดจะไม่มีตัวเลือก ` +
        "กรุณารัน `npm run prisma:deploy` แล้ว `npm run seed:masters`",
    );
    return;
  }
  console.log(`[address] ${label} — ${provinces} จังหวัด / ${districts} อำเภอ / ${subDistricts} ตำบล`);
}

/** เรียกครั้งเดียวตอนบูต ใน main() ก่อนเปิดรับ request */
export async function loadAddresses(): Promise<void> {
  await load("โหลดตอนบูต");
}

/** เรียกหลังแอดมินเขียน หรือหลังแก้ตารางด้วยมือ (ผ่าน POST /api/admin/addresses/refresh) */
export async function refreshAddresses(): Promise<void> {
  await load("โหลดใหม่");
}

/** จำนวนแถวที่โหลดไว้ — รายงานที่ /health/ready */
export function addressStatus(): { provinces: number; districts: number; subDistricts: number } {
  return snapshot.counts;
}

function findDistrict(province: string, amphoe: string): DistrictNode | undefined {
  return snapshot.provinceByName.get(province)?.districtByName.get(amphoe);
}

export function listProvinces(): string[] {
  return snapshot.provinces.filter((p) => p.isActive).map((p) => p.name);
}

export function listAmphoes(province: string): string[] {
  const node = snapshot.provinceByName.get(province);
  if (!node?.isActive) return [];
  return node.districts.filter((d) => d.isActive).map((d) => d.name);
}

export function listSubdistricts(province: string, amphoe: string): Subdistrict[] {
  if (!snapshot.provinceByName.get(province)?.isActive) return [];
  const node = findDistrict(province, amphoe);
  if (!node?.isActive) return [];
  return node.subDistricts.filter((s) => s.isActive).map((s) => ({ name: s.name, zipcode: s.zipcode ?? "" }));
}

/** ใช้ตรวจว่าที่อยู่ที่ส่งมาเป็นชุดที่มีอยู่จริง กัน client ส่งค่ามั่ว — นับรวมรายการที่ปิดอยู่ */
export function isValidAddress(province: string, amphoe: string, subdistrict: string): boolean {
  return findDistrict(province, amphoe)?.subDistrictByName.has(subdistrict) ?? false;
}

export function lookupZipcode(province: string, amphoe: string, subdistrict: string): string | null {
  return findDistrict(province, amphoe)?.subDistrictByName.get(subdistrict)?.zipcode ?? null;
}

/**
 * แปลง "ชื่อ" ที่ผู้ใช้เลือกเป็น "รหัส" ที่สคีมาใหม่ต้องการ
 *
 * sheet `organization` เก็บ province_code / district_code / sub_district_code ไม่ใช่ชื่อ
 * อ่านจากตาราง master ตรง ๆ (ไม่ใช่ cache) เพราะถูกเรียกใน transaction ด้วย
 *
 * คืน null ทีละช่องเมื่อหาไม่เจอ — ร่างที่กรอกไม่ครบต้องบันทึกได้
 */
export async function resolveAddressCodes(
  db: { province: { findFirst: Function }; district: { findFirst: Function }; subDistrict: { findFirst: Function } },
  address: { province?: string | null; district?: string | null; subdistrict?: string | null },
): Promise<{ provinceCode: string | null; districtCode: string | null; subDistrictCode: string | null }> {
  if (!address.province) {
    return { provinceCode: null, districtCode: null, subDistrictCode: null };
  }

  const province = (await db.province.findFirst({
    where: { nameTh: address.province },
    select: { code: true },
  })) as { code: string } | null;
  if (!province) return { provinceCode: null, districtCode: null, subDistrictCode: null };

  if (!address.district) {
    return { provinceCode: province.code, districtCode: null, subDistrictCode: null };
  }

  const district = (await db.district.findFirst({
    where: { nameTh: address.district, provinceCode: province.code },
    select: { code: true },
  })) as { code: string } | null;
  if (!district) {
    return { provinceCode: province.code, districtCode: null, subDistrictCode: null };
  }

  if (!address.subdistrict) {
    return { provinceCode: province.code, districtCode: district.code, subDistrictCode: null };
  }

  const subDistrict = (await db.subDistrict.findFirst({
    where: { nameTh: address.subdistrict, districtCode: district.code },
    select: { code: true },
  })) as { code: string } | null;

  return {
    provinceCode: province.code,
    districtCode: district.code,
    subDistrictCode: subDistrict?.code ?? null,
  };
}

/** แปลงรหัสกลับเป็นชื่อ เพื่อแสดงผลและใส่ใน PDF */
export async function resolveAddressNames(
  db: { province: { findUnique: Function }; district: { findUnique: Function }; subDistrict: { findUnique: Function } },
  codes: { provinceCode?: string | null; districtCode?: string | null; subDistrictCode?: string | null },
): Promise<{ province: string | null; district: string | null; subdistrict: string | null }> {
  const [province, district, subDistrict] = await Promise.all([
    codes.provinceCode
      ? (db.province.findUnique({ where: { code: codes.provinceCode }, select: { nameTh: true } }) as Promise<{ nameTh: string } | null>)
      : Promise.resolve(null),
    codes.districtCode
      ? (db.district.findUnique({ where: { code: codes.districtCode }, select: { nameTh: true } }) as Promise<{ nameTh: string } | null>)
      : Promise.resolve(null),
    codes.subDistrictCode
      ? (db.subDistrict.findUnique({ where: { code: codes.subDistrictCode }, select: { nameTh: true } }) as Promise<{ nameTh: string } | null>)
      : Promise.resolve(null),
  ]);

  return {
    province: province?.nameTh ?? null,
    district: district?.nameTh ?? null,
    subdistrict: subDistrict?.nameTh ?? null,
  };
}
