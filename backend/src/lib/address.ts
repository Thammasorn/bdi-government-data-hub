import { readFileSync } from "node:fs";

export interface Subdistrict {
  name: string;
  zipcode: string;
}
export interface Amphoe {
  name: string;
  districts: Subdistrict[];
}
export interface Province {
  province: string;
  amphoes: Amphoe[];
}

/**
 * ข้อมูลที่อยู่ไทย 77 จังหวัด / 927 อำเภอ / 7,423 ตำบล
 * vendor ไว้ในโปรเจกต์เพราะแพ็กเกจต้นทางลาก devDependency ที่ติด CVE เข้ามาใน production
 * อ่านด้วย fs แทน import JSON เพื่อให้ทำงานได้ทั้ง tsx (dev) และ dist ที่ compile แล้ว
 */
const provinces: Province[] = JSON.parse(
  readFileSync(new URL("../data/thai-address.json", import.meta.url), "utf8"),
) as Province[];

export function listProvinces(): string[] {
  return provinces.map((p) => p.province);
}

export function listAmphoes(province: string): string[] {
  return provinces.find((p) => p.province === province)?.amphoes.map((a) => a.name) ?? [];
}

export function listSubdistricts(province: string, amphoe: string): Subdistrict[] {
  return (
    provinces.find((p) => p.province === province)?.amphoes.find((a) => a.name === amphoe)?.districts ??
    []
  );
}

/** ใช้ตรวจว่าที่อยู่ที่ส่งมาเป็นชุดที่มีอยู่จริง กัน client ส่งค่ามั่ว */
export function isValidAddress(province: string, amphoe: string, subdistrict: string): boolean {
  return listSubdistricts(province, amphoe).some((d) => d.name === subdistrict);
}

export function lookupZipcode(province: string, amphoe: string, subdistrict: string): string | null {
  return listSubdistricts(province, amphoe).find((d) => d.name === subdistrict)?.zipcode ?? null;
}

/**
 * แปลง "ชื่อ" ที่ผู้ใช้เลือกเป็น "รหัส" ที่สคีมาใหม่ต้องการ
 *
 * sheet `organization` เก็บ province_code / district_code / sub_district_code ไม่ใช่ชื่อ
 * ตาราง master อยู่ที่ schema `administration` ซึ่ง seed มาจากไฟล์เดียวกันนี้
 * (ดู src/scripts/seed-masters.ts) รหัสจึงตรงกันเสมอตราบใดที่ยังไม่เปลี่ยนไฟล์ต้นทาง
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
