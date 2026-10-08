#!/usr/bin/env node
/**
 * สร้างข้อมูลที่อยู่ชุดรหัสกรมการปกครอง และ migration ที่ย้ายรหัสเก่าในฐานข้อมูลไปเป็นรหัสใหม่
 *
 *   node backend/scripts/build-address-data.mjs
 *
 * รันบน host ได้ (ใช้แค่ node ≥ 20 กับ git) ไม่ต้องเข้า container เขียนสองไฟล์:
 *
 *   backend/src/data/thai-address.json                         — ข้อมูลที่ seed:masters ใช้
 *   backend/prisma/migrations/<MIGRATION>/migration.sql         — ย้ายรหัสเก่า → ใหม่ + เปลี่ยนตาราง master
 *
 * ## ที่มาของข้อมูล
 *
 * - **ชุดใหม่**: `data/raw` ของ github.com/kongvut/thai-province-data ที่ commit `KONGVUT_SHA`
 *   (ตรึงไว้ ไม่ใช่ master เพื่อให้รันซ้ำแล้วได้ไฟล์เดิม) รหัสอำเภอ/ตำบลของมันเทียบกับไฟล์สถิติ
 *   ประชากรรายตำบลของกรมการปกครอง พ.ศ.2567 (stat_t67.xls) แล้วตรงกันทุกตัว ชื่อต่างกัน 5 แห่ง
 *   ซึ่งใช้ชื่อตามกรมการปกครอง (`DOPA_NAME_OVERRIDES`)
 * - **รหัสคือรหัสกรมการปกครองทั้งสามระดับ** อำเภอและตำบลคือ id ของ kongvut ตรง ๆ แต่ id ของ
 *   "จังหวัด" ใน kongvut เป็นเลขลำดับ 1–77 ไม่ใช่รหัสกรมการปกครอง จึงใช้สองหลักแรกของรหัสอำเภอ
 *   แทน (กรุงเทพมหานคร = 10 ไม่ใช่ 1) และตรวจว่าทุกอำเภอของจังหวัดเดียวกันขึ้นต้นด้วยรหัสเดียวกัน
 * - **ชุดเก่า**: `thai-address.json` ฉบับที่ commit `LEGACY_COMMIT` ซึ่งไม่มีรหัส seed:masters
 *   ฉบับก่อนออกรหัสจากลำดับในไฟล์ (จังหวัด 2 หลัก · อำเภอ 4 · ตำบล 6) สคริปต์นี้สร้างรหัสเก่า
 *   ด้วยวิธีเดียวกันทุกตัวอักษร แล้วจับคู่กับชุดใหม่ด้วยชื่อ
 *
 * การจับคู่ต้องครบทุกแถว — ชื่อที่หาคู่ไม่เจอและไม่ได้อยู่ใน `LEGACY_*_ALIASES` ทำให้สคริปต์หยุด
 * ไม่ปล่อยให้แถวไหนตกหล่นไปเงียบ ๆ
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const KONGVUT_SHA = "12b566aecd01b8337589c972fa0cfc2907cc2786";
const LEGACY_COMMIT = "75e9de0";
const MIGRATION = "20261006120000_dopa_address_codes";

const BACKEND = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = join(BACKEND, "..");

/** อำเภอใน kongvut ที่ไม่ใช่อำเภอจริง — เป็นรหัสสำนักทะเบียนท้องถิ่น และไม่มีตำบลอยู่ข้างใต้เลย */
const EXCLUDED_DISTRICTS = new Set(["7074", "9077"]);

/** ชื่อตำบลที่ kongvut สะกดต่างจากกรมการปกครอง (stat_t67.xls) — ใช้ของกรมการปกครอง */
const DOPA_NAME_OVERRIDES = {
  "450109": "ปอภาร (ปอพาน)",
  "501805": "แม่หลอง",
  "502202": "ทุ่งปี๊",
  "600113": "วัดไทรย์",
  "840902": "พะแสง",
};

/** อำเภอในไฟล์เก่าที่ชื่อไม่ตรงกับชุดใหม่ — "จังหวัด/อำเภอเก่า" → ชื่ออำเภอใหม่ */
const LEGACY_DISTRICT_ALIASES = {
  "บึงกาฬ/บึงกาฬ": "เมืองบึงกาฬ",
  "พัทลุง/ป่าพยอม": "ป่าพะยอม",
  "มุกดาหาร/ว่านใหญ่": "หว้านใหญ่",
  "ยะลา/กรงปีนัง": "กรงปินัง",
};

/**
 * ตำบลในไฟล์เก่าที่ชื่อไม่ตรงกับชุดใหม่ — "จังหวัด/อำเภอเก่า/ตำบลเก่า" (ตัดช่องว่างออกแล้ว) →
 *
 * - รหัสตำบลใหม่ 6 หลัก: สะกดผิด ชื่อเทศบาลที่ปนมาแทนชื่อตำบล หรือย้ายอำเภอ (ท่าแฝก)
 * - `null`: ไม่มีตำบลที่ตรงกันแน่ชัด — แถวที่ถือรหัสนี้จะเหลือแค่อำเภอ ให้ผู้ใช้เลือกตำบลใหม่เอง
 *   ดีกว่าเดาให้แล้วผิด (บางนา/บางบอนถูกแบ่งเป็นหลายแขวง, เทศบาลเมืองพระประแดงครอบหลายตำบล,
 *   สมก๋าย/ขามเรียน/สองห้อง (เมืองหนองคาย) ไม่มีในข้อมูลกรมการปกครองแล้ว)
 */
const LEGACY_SUBDISTRICT_ALIASES = {
  "กรุงเทพมหานคร/บางนา/บางนา": null,
  "กรุงเทพมหานคร/บางบอน/บางบอน": null,
  "กาญจนบุรี/ท่ามะกา/ท่าเรือ(เทศบาลเมืองพระแท่น)": "710507",
  "กาฬสินธุ์/ฆ้องชัย/โนนศิลา": "461804",
  "กาฬสินธุ์/ดอนจาน/พยุง": "461703",
  "กาฬสินธุ์/นาคู/โนนนาจาง": "461603",
  "กาฬสินธุ์/ยางตลาด/หนองอีเฒ่า": "460708",
  "จันทบุรี/เขาคิชฌกูฏ/ซากไทย": "221001",
  "ฉะเชิงเทรา/เมืองฉะเชิงเทรา/บางกระไห": "240114",
  "ชลบุรี/พนัสนิคม/บ้านเชิด": "200604",
  "ชลบุรี/เมืองชลบุรี/ดอนหัวฬอ": "200109",
  "ตรัง/ย่านตาขาว/โพรงจรเข้": "920305",
  "ตรัง/รัษฎา/ต.หนองบัว": "920903",
  "ตาก/บ้านตาก/ทุ่งกระเซาะ": "630206",
  "นครนายก/องครักษ์/ศรีษะกระบือ": "260403",
  "นครปฐม/นครชัยศรี/ศีรษะทอง": "730312",
  "นครปฐม/เมืองนครปฐม/สระกระเทียม": "730120",
  // ไม่มีในข้อมูลกรมการปกครอง ช่องของมัน (380103) เป็นโนนสว่าง ซึ่งไฟล์เก่าไม่มี — ไม่มีหลักฐานว่าเป็นตำบลเดียวกัน
  "บึงกาฬ/บึงกาฬ/หนองเข็ง": null,
  "นครศรีธรรมราช/จุฬาภรณ์/สาม": "801906",
  "นครศรีธรรมราช/ทุ่งสง/เทศบาลเมืองทุ่งสง-ปากแพรก": "800901",
  "นครศรีธรรมราช/ปากพนัง/ท่าพญา": "801216",
  "นครศรีธรรมราช/สิชล/สีขีด": "801406",
  "นครสวรรค์/แม่วงก์/แม่เลย์": "601303",
  "นราธิวาส/ระแงะ/กาลิชา": "960507",
  "นราธิวาส/สุไหงโก-ลก/ป่าเสมัส": "961002",
  "นราธิวาส/สุไหงโก-ลก/สุไหงโกลก": "961001",
  "น่าน/ท่าวังผา/ต.ผาทอง": "550610",
  "น่าน/นาหมื่น/เมืองลี่": "551003",
  "น่าน/ปัว/เจดียชัย": "550510",
  "น่าน/เมืองน่าน/นาชาว": "550107",
  "น่าน/เมืองน่าน/สวก": "550116",
  "บุรีรัมย์/ละหานทราย/หนองตระครอง": "310610",
  "บุรีรัมย์/ลำปลายมาศ/หนองกระทิง": "311006",
  "บุรีรัมย์/เมืองบุรีรัมย์/สวายจึก": "310106",
  "ปัตตานี/สายบุรี/ตะลุปัน": "940701",
  "ปัตตานี/ไม้แก่น/คอนทราย": "940804",
  "พระนครศรีอยุธยา/บางไทร/บ้างกลึง": "140411",
  "พระนครศรีอยุธยา/พระนครศรีอยุธยา/บ้านรุม": "140121",
  "พะเยา/เมืองพะเยา/แม่ปีม": "560108",
  "พิจิตร/เมืองพิจิตร/ท่าฬอ": "660104",
  "มหาสารคาม/ยางสีสุราช/ขามเรียน": null,
  "ระยอง/เมืองระยอง/กระเฉด": "210110",
  "ร้อยเอ็ด/เสลภูมิ/ศรีวิสัย": "451014",
  "ลพบุรี/ท่าวุ้ง/ลาดสาลี": "160509",
  "ลพบุรี/เมืองลพบุรี/โคกกระเทียม": "160107",
  "ลำปาง/เมืองลำปาง/เวียงเหนือสวนดอกสบตุ๋ยอยู่นอก1ตำบลคือหัวเ*": "520101",
  "ลำปาง/แม่เมาะ/สบป้าน": "520205",
  "ศรีสะเกษ/ศรีรัตนะ/เสืองข้าว": "331405",
  "สงขลา/ระโนด/ตาเครียะ": "900703",
  "สตูล/ควนกาหลง/อุไดเจริญ": "910303",
  "สมุทรปราการ/บางเสาธง/ศรีษะจรเข้น้อย": "110602",
  "สมุทรปราการ/บางเสาธง/ศรีษะจรเข้ใหญ่": "110603",
  "สมุทรปราการ/พระประแดง/เทศบาลสำโรงใต้": "110407",
  "สมุทรปราการ/พระประแดง/เทศบาลเมืองพระประแดง": null,
  "สมุทรปราการ/เมืองสมุทรปราการ/เทศบาลนครสมุทรปราการ": "110101",
  "สมุทรปราการ/เมืองสมุทรปราการ/เทศบาลบางปู": "110112",
  "สมุทรปราการ/เมืองสมุทรปราการ/เทศบาลบางเมือง": "110114",
  "สระบุรี/บ้านหมอ/สร้างโศก": "190603",
  "สุรินทร์/ปราสาท/กันตรวจระมวล": "320516",
  "หนองคาย/เมืองหนองคาย/สองห้อง": null,
  // ย้ายจากอำเภอท่าปลาไปอำเภอน้ำปาด — อำเภอของแถวที่ถือรหัสนี้จึงเปลี่ยนตามไปด้วย
  "อุตรดิตถ์/ท่าปลา/ท่าแฝก": "530407",
  "อุตรดิตถ์/น้ำปาด/น้ำไฝ": "530405",
  "อุบลราชธานี/สิรินธร/นิคมลำโดมน้อย": "342504",
  "อ่างทอง/วิเศษชัยชาญ/ไผ่จำศีล": "150601",
  "อ่างทอง/โพธิ์ทอง/ยางซ้าย": "150410",
  "เชียงใหม่/แม่แตง/สมก๋าย": null,
  // ชื่อตามกรมการปกครองต่างจากไฟล์เก่า (DOPA_NAME_OVERRIDES) — ตำบลเดียวกัน รหัสเดียวกัน
  "ร้อยเอ็ด/เมืองร้อยเอ็ด/ปอภาร": "450109",
  "เชียงใหม่/อมก๋อย/สบโขง": "501805",
  "เชียงใหม่/แม่วาง/ทุ่งปี้": "502202",
  "เพชรบุรี/เมืองเพชรบุรี/คลองกระแซง": "760102",
  "แพร่/เมืองแพร่/นาชำ": "540103",
  "แพร่/เมืองแพร่/วังหงษ์": "540113",
};

const squash = (s) => s.trim().replace(/\s+/g, "");
const pad = (n, width) => String(n).padStart(width, "0");

async function fetchRaw(name) {
  const url = `https://raw.githubusercontent.com/kongvut/thai-province-data/${KONGVUT_SHA}/data/raw/${name}.json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`โหลด ${url} ไม่ได้: ${res.status}`);
  return res.json();
}

// ─────────────────────────────────────────────────────────── ชุดใหม่

const [rawProvinces, rawDistricts, rawSubDistricts] = await Promise.all(
  ["provinces", "districts", "sub_districts"].map(fetchRaw),
);

for (const row of [...rawProvinces, ...rawDistricts, ...rawSubDistricts]) {
  if (row.deleted_at) throw new Error(`kongvut มีแถวที่ถูกลบ (${row.id}) — ต้องตัดสินใจก่อนว่าจะทำอย่างไร`);
}

const districts = rawDistricts
  .filter((d) => !EXCLUDED_DISTRICTS.has(String(d.id)))
  .map((d) => ({
    code: String(d.id),
    nameTh: d.name.th.trim(),
    nameEn: d.name.en?.trim() || null,
    provinceId: d.province_id,
    subDistricts: [],
  }));
const districtByCode = new Map(districts.map((d) => [d.code, d]));

for (const s of rawSubDistricts) {
  const code = String(s.id);
  const district = districtByCode.get(String(s.district_id));
  if (!district) throw new Error(`ตำบล ${code} อยู่ใต้อำเภอ ${s.district_id} ที่ไม่มีอยู่`);
  if (!code.startsWith(district.code)) throw new Error(`ตำบล ${code} ไม่ขึ้นต้นด้วยรหัสอำเภอ ${district.code}`);
  district.subDistricts.push({
    code,
    nameTh: DOPA_NAME_OVERRIDES[code] ?? s.name.th.trim(),
    nameEn: s.name.en?.trim() || null,
    postalCode: s.zip_code ? String(s.zip_code) : null,
  });
}

const provinces = rawProvinces.map((p) => {
  const own = districts.filter((d) => d.provinceId === p.id);
  const prefixes = new Set(own.map((d) => d.code.slice(0, 2)));
  if (prefixes.size !== 1) throw new Error(`อำเภอของ ${p.name.th} ขึ้นต้นด้วยรหัสจังหวัดไม่ตรงกัน: ${[...prefixes]}`);
  return {
    code: [...prefixes][0],
    nameTh: p.name.th.trim(),
    nameEn: p.name.en?.trim() || null,
    districts: own
      .sort((a, b) => a.code.localeCompare(b.code))
      .map(({ provinceId: _drop, subDistricts, ...d }) => ({
        ...d,
        subDistricts: subDistricts.sort((a, b) => a.code.localeCompare(b.code)),
      })),
  };
}).sort((a, b) => a.code.localeCompare(b.code));

for (const d of districts) {
  if (d.subDistricts.length === 0) throw new Error(`อำเภอ ${d.code} ${d.nameTh} ไม่มีตำบล`);
}

const counts = {
  provinces: provinces.length,
  districts: provinces.reduce((n, p) => n + p.districts.length, 0),
  subDistricts: provinces.reduce((n, p) => n + p.districts.reduce((m, d) => m + d.subDistricts.length, 0), 0),
};

// ─────────────────────────────────────────────────────────── ชุดเก่า → ใหม่

const legacy = JSON.parse(
  execFileSync("git", ["-C", REPO, "show", `${LEGACY_COMMIT}:backend/src/data/thai-address.json`], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  }),
);

// รหัสของแม่ไปด้วยในแถว — migration ไม่ต้องเดาโครงสร้างรหัส (LEFT(…)) ตารางจับคู่บอกตรง ๆ
const provinceMap = []; // [เก่า, จังหวัดใหม่]
const districtMap = []; // [เก่า, อำเภอใหม่, จังหวัดใหม่]
const subDistrictMap = []; // [เก่า, ตำบลใหม่, อำเภอใหม่, จังหวัดใหม่] — null ทั้งสามเมื่อไม่มีคู่
const provinceOfDistrict = new Map(provinces.flatMap((p) => p.districts.map((d) => [d.code, p.code])));
const dropped = []; // ตำบลเก่าที่ไม่มีคู่ — สำหรับรายงาน
const usedAliases = new Set();
const unmatched = []; // รวบรวมให้ครบก่อนหยุด จะได้แก้ alias ทีเดียว

legacy.forEach((lp, pIndex) => {
  const oldProvince = pad(pIndex + 1, 2);
  const province = provinces.find((p) => p.nameTh === lp.province);
  if (!province) throw new Error(`ไม่พบจังหวัด ${lp.province} ในชุดใหม่`);
  provinceMap.push([oldProvince, province.code]);

  lp.amphoes.forEach((la, aIndex) => {
    const oldDistrict = `${oldProvince}${pad(aIndex + 1, 2)}`;
    const wanted = LEGACY_DISTRICT_ALIASES[`${lp.province}/${la.name}`] ?? la.name;
    const district = province.districts.find((d) => d.nameTh === wanted);
    if (!district) throw new Error(`ไม่พบอำเภอ ${lp.province}/${la.name} ในชุดใหม่ — เพิ่มใน LEGACY_DISTRICT_ALIASES`);
    districtMap.push([oldDistrict, district.code, province.code]);

    la.districts.forEach((lt, tIndex) => {
      const oldSub = `${oldDistrict}${pad(tIndex + 1, 2)}`;
      const key = `${lp.province}/${la.name}/${squash(lt.name)}`;
      let code;
      if (key in LEGACY_SUBDISTRICT_ALIASES) {
        usedAliases.add(key);
        code = LEGACY_SUBDISTRICT_ALIASES[key];
      } else {
        code = district.subDistricts.find((s) => squash(s.nameTh) === squash(lt.name))?.code;
        if (!code) {
          unmatched.push(key);
          return;
        }
      }
      if (code && !districtByCode.get(code.slice(0, 4))?.subDistricts.some((s) => s.code === code)) {
        throw new Error(`alias ของ ${key} ชี้ไปที่ ${code} ซึ่งไม่มีอยู่ในชุดใหม่`);
      }
      if (code === null) {
        dropped.push(`${oldSub} ${key}`);
        subDistrictMap.push([oldSub, null, null, null]);
      } else {
        const newDistrict = code.slice(0, 4);
        subDistrictMap.push([oldSub, code, newDistrict, provinceOfDistrict.get(newDistrict)]);
      }
    });
  });
});

if (unmatched.length) {
  throw new Error(`ไม่พบตำบลเหล่านี้ในชุดใหม่ — เพิ่มใน LEGACY_SUBDISTRICT_ALIASES:\n  ${unmatched.join("\n  ")}`);
}

const unused = Object.keys(LEGACY_SUBDISTRICT_ALIASES).filter((key) => !usedAliases.has(key));
if (unused.length) throw new Error(`alias ที่ไม่ได้ใช้ (พิมพ์ผิด?): ${unused.join(", ")}`);

// ─────────────────────────────────────────────────────────── เขียนไฟล์

writeFileSync(join(BACKEND, "src/data/thai-address.json"), JSON.stringify(provinces) + "\n");

const q = (v) => (v === null || v === undefined ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);
const values = (rows) => rows.map((r) => `  (${r.map(q).join(", ")})`).join(",\n");

const flat = {
  provinces: provinces.map((p) => [p.code, p.nameTh, p.nameEn]),
  districts: provinces.flatMap((p) => p.districts.map((d) => [d.code, d.nameTh, d.nameEn, p.code])),
  subDistricts: provinces.flatMap((p) =>
    p.districts.flatMap((d) => d.subDistricts.map((s) => [s.code, s.nameTh, s.nameEn, d.code, s.postalCode])),
  ),
};

const sql = `-- ย้ายข้อมูลที่อยู่ไปใช้รหัสกรมการปกครอง และให้แอดมินแก้ตาราง master ได้
--
-- สร้างโดย backend/scripts/build-address-data.mjs — **อย่าแก้ไฟล์นี้ด้วยมือ** แก้สคริปต์แล้วรันใหม่
--
-- ก่อนหน้านี้ seed:masters ออกรหัสเองจากลำดับในไฟล์ thai-address.json (กรุงเทพฯ = 02,
-- สามเสนใน = 023001) migration นี้:
--   1. เพิ่ม is_active ให้ตาราง master ทั้งสาม — แอดมินปิดรายการแทนการลบ เพราะ
--      organization เก็บรหัสโดยไม่มี FK การลบจะทิ้งรหัสกำพร้าไว้ในแถวที่อ้างอยู่
--   2. แปลงรหัสเก่าใน organization.organization และ organization_registration_request
--      ไปเป็นรหัสใหม่ ผ่านตารางจับคู่ที่สร้างจากชื่อ (ดูสคริปต์ข้างบน)
--   3. ล้างตาราง master แล้วใส่ชุดใหม่ ${counts.provinces} จังหวัด / ${counts.districts} อำเภอ / ${counts.subDistricts} ตำบล
--      รหัสกรมการปกครองทั้งสามระดับ (กรุงเทพมหานคร = 10, สามเสนใน = 101401) จาก
--      kongvut/thai-province-data@${KONGVUT_SHA.slice(0, 7)} — ตรงกับสถิติประชากรของกรมการปกครอง พ.ศ.2567
--
-- รันครั้งเดียว: Prisma บันทึกไว้ใน _prisma_migrations แล้วจะไม่รันซ้ำตอน redeploy
-- ข้อนี้สำคัญ เพราะรหัสเก่ากับรหัสใหม่มีรูปเดียวกันและซ้อนกันได้ (รหัสเก่า 10 = จังหวัดลำดับที่ 10)
-- การแปลงสองรอบจะทำให้ข้อมูลเพี้ยนโดยไม่มีอะไรเตือน
--
-- ตำบลเก่าที่ไม่มีคู่ชัดเจน ${dropped.length} รายการ — แถวที่ถือรหัสเหล่านี้จะเหลือแค่อำเภอ:
${dropped.map((d) => `--   ${d}`).join("\n")}

-- กันรันกับฐานข้อมูลที่ไม่ได้อยู่ในรูปรหัสเก่า: ถ้ามีข้อมูลจังหวัดอยู่แล้วแต่ "02" ไม่ใช่กรุงเทพฯ
-- แปลว่าตารางนี้ถูกเปลี่ยนไปแล้วด้วยวิธีอื่น การแปลงต่อจะทับรหัสที่ถูกอยู่แล้ว
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "administration"."province")
     AND NOT EXISTS (
       SELECT 1 FROM "administration"."province" WHERE "code" = '02' AND "name_th" = 'กรุงเทพมหานคร'
     ) THEN
    RAISE EXCEPTION 'administration.province ไม่ได้อยู่ในรูปรหัสเก่า (02 = กรุงเทพมหานคร) — หยุดก่อนแปลงรหัสซ้ำ';
  END IF;
END $$;

-- AlterTable
ALTER TABLE "administration"."province" ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "administration"."district" ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "administration"."sub_district" ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true;

-- ตารางจับคู่รหัสเก่า → ใหม่ (ชั่วคราว หายไปเมื่อจบ session)
CREATE TEMP TABLE "address_map_province" ("old_code" VARCHAR(16) PRIMARY KEY, "new_code" VARCHAR(16) NOT NULL);
CREATE TEMP TABLE "address_map_district" (
  "old_code" VARCHAR(16) PRIMARY KEY, "new_code" VARCHAR(16) NOT NULL, "new_province" VARCHAR(16) NOT NULL
);
CREATE TEMP TABLE "address_map_sub_district" (
  "old_code" VARCHAR(16) PRIMARY KEY, "new_code" VARCHAR(16), "new_district" VARCHAR(16), "new_province" VARCHAR(16)
);

INSERT INTO "address_map_province" ("old_code", "new_code") VALUES
${values(provinceMap)};

INSERT INTO "address_map_district" ("old_code", "new_code", "new_province") VALUES
${values(districtMap)};

INSERT INTO "address_map_sub_district" ("old_code", "new_code", "new_district", "new_province") VALUES
${values(subDistrictMap)};

-- แปลงทั้งสามคอลัมน์ในคำสั่งเดียว อ่านจากค่าเดิมของแถว จึงไม่มีทางแปลงซ้ำในรอบเดียวกัน
-- อำเภอและจังหวัดตามตำบลใหม่ก่อน (ตำบลที่ย้ายอำเภอจะพาอำเภอไปด้วย) ถ้าไม่มีตำบลจึงใช้คู่ของตัวเอง
UPDATE "organization"."organization" AS o
SET "sub_district_code" = m."sub",
    "district_code"     = m."district",
    "province_code"     = m."province"
FROM (
  SELECT o2."id",
         s."new_code" AS "sub",
         COALESCE(s."new_district", d."new_code") AS "district",
         COALESCE(s."new_province", d."new_province", p."new_code") AS "province"
  FROM "organization"."organization" AS o2
  LEFT JOIN "address_map_sub_district" AS s ON s."old_code" = o2."sub_district_code"
  LEFT JOIN "address_map_district" AS d ON d."old_code" = o2."district_code"
  LEFT JOIN "address_map_province" AS p ON p."old_code" = o2."province_code"
  WHERE o2."province_code" IS NOT NULL OR o2."district_code" IS NOT NULL OR o2."sub_district_code" IS NOT NULL
) AS m
WHERE o."id" = m."id";

UPDATE "organization"."organization_registration_request" AS r
SET "organization_subdistrict_code" = m."sub",
    "organization_district_code"    = m."district",
    "organization_province_code"    = m."province"
FROM (
  SELECT r2."id",
         s."new_code" AS "sub",
         COALESCE(s."new_district", d."new_code") AS "district",
         COALESCE(s."new_province", d."new_province", p."new_code") AS "province"
  FROM "organization"."organization_registration_request" AS r2
  LEFT JOIN "address_map_sub_district" AS s ON s."old_code" = r2."organization_subdistrict_code"
  LEFT JOIN "address_map_district" AS d ON d."old_code" = r2."organization_district_code"
  LEFT JOIN "address_map_province" AS p ON p."old_code" = r2."organization_province_code"
  WHERE r2."organization_province_code" IS NOT NULL
     OR r2."organization_district_code" IS NOT NULL
     OR r2."organization_subdistrict_code" IS NOT NULL
) AS m
WHERE r."id" = m."id";

DROP TABLE "address_map_province";
DROP TABLE "address_map_district";
DROP TABLE "address_map_sub_district";

-- ตาราง master ชุดใหม่ (FK ของ district/sub_district เป็น ON DELETE CASCADE จึงลบจากจังหวัดพอ)
DELETE FROM "administration"."province";

INSERT INTO "administration"."province" ("code", "name_th", "name_en") VALUES
${values(flat.provinces)};

INSERT INTO "administration"."district" ("code", "name_th", "name_en", "province_code") VALUES
${values(flat.districts)};

INSERT INTO "administration"."sub_district" ("code", "name_th", "name_en", "district_code", "postal_code") VALUES
${values(flat.subDistricts)};
`;

const migrationDir = join(BACKEND, "prisma/migrations", MIGRATION);
mkdirSync(migrationDir, { recursive: true });
writeFileSync(join(migrationDir, "migration.sql"), sql);

console.log(
  `thai-address.json — ${counts.provinces} จังหวัด / ${counts.districts} อำเภอ / ${counts.subDistricts} ตำบล\n` +
    `${MIGRATION} — จับคู่ ${provinceMap.length} / ${districtMap.length} / ${subDistrictMap.length} รหัสเก่า, ` +
    `ตำบลที่ไม่มีคู่ ${dropped.length}:\n  ${dropped.join("\n  ")}`,
);
