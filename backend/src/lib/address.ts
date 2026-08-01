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
