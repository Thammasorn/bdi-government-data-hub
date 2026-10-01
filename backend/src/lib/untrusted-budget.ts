/**
 * งบไบต์ของสิ่งที่ใครก็ส่งเข้า log store ได้โดยไม่ต้องพิสูจน์ตัวตน — ต่อ process ไม่แตะ Mongo ไม่ await อะไร
 *
 *   - `browser` — รายงานจากเบราว์เซอร์ (`POST /api/client-errors` ที่ไม่มี `x-report-token` ที่ตรง — routes/client-errors.ts)
 *     ทั้งตัวเต็มและตัวย่อของรหัสอ้างอิง (lib/error-capture.ts `captureReport`)
 *   - `anonymous-admin` — บันทึกการเรียก `/api/admin*` ที่ token ไม่ผ่านหรือไม่ได้ตรวจ (`via: "ANONYMOUS"` — lib/admin-access.ts)
 *     ทั้งตัวเดี่ยวและบันทึกสรุป
 *
 * **ทำไมต้องมี:** เพดานต่อนาทีของสองทางนี้คุมความถี่ ไม่ได้คุมปริมาณสะสม และของที่เก็บอยู่ได้ 30 ถึง 400 วัน คนที่ไม่มีอะไรเลยนอกจาก
 * URL ยิงไม่หยุดก็เติม log store ได้ไม่จบ: รายงานเบราว์เซอร์ราว 1.5 GB ต่อวันต่อ process (60 ตัวเต็มกับ 240 ตัวย่อต่อนาที) หรือการ
 * เรียก admin API ที่ไม่มี token ซึ่งบันทึกสรุปเปิดใบใหม่ทุกครั้งที่ key ค้นหาเต็ม (ตรวจขั้น 8-10 แบบค้าน 2026-10-01: สามพันคำขอได้
 * สรุปแปดสิบใบ) พอถึง LOG_STORE_MAX_MB ธง `over_quota` ก็ปิดของที่สำคัญกว่าไปด้วย — error event ของ server ทุกตัว (การแจ้ง 5xx
 * ต่อเนื่องนับจาก event จึงเงียบ) และค้างอยู่จนของขยะหมดอายุ งบนี้ทำให้สิ่งที่ใครก็ส่งได้กินที่ได้ไม่เกินส่วนหนึ่งของเพดาน
 * (`SHARE`) จึงพาเพดานไปถึงเองไม่ได้ (บันทึกการเรียกที่ token ผ่านยังเก็บแม้เกินเพดาน — lib/error-capture.ts `enqueueAccessRecord`)
 *
 * **กลไก:** ถังต่อชนิด เติมต่อเนื่องวันละ `LOG_STORE_MAX_MB × SHARE ÷ อายุการเก็บของชนิดนั้น` (lib/log-retention.ts) จุได้หนึ่งวัน
 * และเริ่มเต็ม — ของชนิดนั้นที่ค้างอยู่ในคลังจึงไม่เกิน `LOG_STORE_MAX_MB × SHARE` บวกหนึ่งวันต่อการเริ่ม process ใหม่หนึ่งครั้งใน
 * ช่วงอายุนั้น ราคาของเอกสารคือขนาด BSON บวก index ที่มันกิน (`indexCost`) ตัวเดี่ยวกับตัวเต็มใช้ได้ถึงแค่ `RESERVE` ของถัง ส่วนที่
 * เหลือเก็บไว้ให้บันทึกสรุป (นับทุกการเรียกในใบเดียว) และตัวย่อของรหัสอ้างอิง (ตัวที่ผู้ใช้อ่านให้เจ้าหน้าที่ฟัง) ที่ใช้ได้ถึงก้นถัง
 *
 * **ราคาที่จ่าย:** คนที่ยิงขยะไม่หยุดในอัตราที่เท่ากับการเติม (production ราว 18 KB ต่อนาทีของรายงานเบราว์เซอร์ — ตัวเต็มขนาดใหญ่สุดราว
 * หนึ่งตัวต่อนาที) ทำให้รายงานจริงจากเบราว์เซอร์ รวมถึงรหัสอ้างอิง ไม่ถูกเก็บ เดิมต้องยิงเกิน 300 ต่อนาทีถึงจะกลบรหัสได้ แต่ก็เติมดิสก์
 * จนทุกอย่างหยุดในไม่กี่วัน — แลกกันแล้ว ให้ช่องทางที่ใครก็ส่งได้เป็นตัวที่เสียเอง ไม่ใช่ error ของ server กับร่องรอยของ admin token
 * ตัวเลข `refused` ใน `GET /api/admin/logs/status` บอกว่ากำลังเกิดอยู่
 *
 * ต่อ process: backend หลาย replica (Azure) ได้คนละถัง ส่วนที่ใช้ได้จึงคูณจำนวน replica (สาม replica × 20% = 60% ของเพดาน — ยัง
 * ไม่ถึงเพดานเอง)
 *
 * **ไม่อยู่ในงบนี้** (มีเพดานความถี่ของตัวเอง แต่ยังกินที่สะสมได้): issue ใหม่ที่รายงานเบราว์เซอร์สร้าง (ไม่เกินร้อยต่อชั่วโมงต่อ process
 * อยู่ 30 วันถ้าไม่เกิดอีก — ราวห้าสิบ MB ที่เพดานความถี่) และแถว `ADMIN_TOKEN_REJECTED` / `LOG_TOKEN_REJECTED` ที่ relay คัดลอกจาก
 * Postgres (throttle ของ lib/token-rejection.ts อยู่ 400 วันในหมวด `admin-access`)
 */
import { env } from "../env.js";
import { ANONYMOUS_ADMIN_ACCESS_DAYS, BROWSER_EVENT_DAYS } from "./log-retention.js";

export type UntrustedKind = "browser" | "anonymous-admin";

/**
 * ส่วนของ LOG_STORE_MAX_MB ที่แต่ละชนิดกินได้ — รวมกัน 20% ที่เหลือ 80% เป็นของ error ของ server, สำเนา audit, บันทึกที่ token ผ่าน
 * production (5 GB): รายงานเบราว์เซอร์ราว 26 MB ต่อวัน การเรียกที่ไม่มี token ราว 2.8 MB ต่อวัน (ตัวเดี่ยวราว 1.6–1.8 KB รวม index
 * ได้ราวพันสองร้อยถึงพันสี่ร้อยตัวก่อนถึงส่วนที่เหลือไว้) ·
 * dev (512 MB): หนึ่งในสิบของนั้น
 */
const SHARE: Record<UntrustedKind, number> = { browser: 0.15, "anonymous-admin": 0.05 };
const RETENTION_DAYS: Record<UntrustedKind, number> = {
  browser: BROWSER_EVENT_DAYS,
  "anonymous-admin": ANONYMOUS_ADMIN_ACCESS_DAYS,
};
/** ส่วนของถังที่ตัวเดี่ยวและตัวเต็มต้องเหลือไว้ — บันทึกสรุปกับตัวย่อของรหัสอ้างอิงใช้ส่วนนี้ได้ */
const RESERVE = 0.25;
/**
 * ราคาต่อหนึ่งรายการใน index — key, RecordId และส่วนหัวของ WiredTiger ประมาณแบบไม่ประหยัด (prefix compression ทำให้จริงน้อยกว่า)
 * error_events มี index ห้าตัวรวม `_id` · activity สิบสองตัว สามตัวเป็น array (รายการต่อค่า)
 */
const INDEX_ENTRY_BYTES = 64;
const DAY_MS = 86_400_000;

interface Bucket {
  /** ไบต์ที่เติมต่อมิลลิวินาที */
  rate: number;
  /** จุได้เท่านี้ — หนึ่งวันของการเติม */
  capacity: number;
  level: number;
  at: number;
  refused: number;
  refusedBytes: number;
}

const buckets = new Map<UntrustedKind, Bucket>();

function bucketOf(kind: UntrustedKind, now: number): Bucket {
  let bucket = buckets.get(kind);
  if (!bucket) {
    const daily = (env.logStore.maxMb * 1024 * 1024 * SHARE[kind]) / RETENTION_DAYS[kind];
    bucket = { rate: daily / DAY_MS, capacity: daily, level: daily, at: now, refused: 0, refusedBytes: 0 };
    buckets.set(kind, bucket);
  }
  if (now > bucket.at) {
    bucket.level = Math.min(bucket.capacity, bucket.level + (now - bucket.at) * bucket.rate);
    bucket.at = now;
  }
  return bucket;
}

/** ราคาของ index สำหรับเอกสารที่กิน `entries` รายการ */
export function indexCost(entries: number): number {
  return entries * INDEX_ENTRY_BYTES;
}

/**
 * หักงบ `cost` ไบต์ — true ถ้าเก็บได้ (หักแล้ว) false ถ้าไม่พอ (นับเป็น `refused`) ไม่ throw
 * `useReserve` = บันทึกสรุปและตัวย่อของรหัสอ้างอิง ใช้ได้ถึงก้นถัง ที่เหลือต้องเหลือ `RESERVE` ไว้
 */
export function takeUntrustedBytes(kind: UntrustedKind, cost: number, options: { useReserve: boolean }): boolean {
  const bucket = bucketOf(kind, Date.now());
  const floor = options.useReserve ? 0 : bucket.capacity * RESERVE;
  if (bucket.level - cost < floor) {
    bucket.refused += 1;
    bucket.refusedBytes += cost;
    return false;
  }
  bucket.level -= cost;
  return true;
}

/** คืนงบที่หักไปแล้วแต่ไม่ได้เก็บจริง (คิวเต็ม) — ไม่งั้นช่วงที่ Mongo ล่มกินงบทั้งวันโดยไม่มีอะไรถูกเก็บ */
export function refundUntrustedBytes(kind: UntrustedKind, cost: number): void {
  const bucket = bucketOf(kind, Date.now());
  bucket.level = Math.min(bucket.capacity, bucket.level + cost);
}

/**
 * ตัวเลขของ process นี้ — `GET /api/admin/logs/status` แสดง ต่อชนิด: `dailyBytes` งบต่อวัน · `availableBytes` ที่เหลือตอนนี้ ·
 * `refused` / `refusedBytes` ที่ไม่ได้เก็บเพราะงบหมดตั้งแต่ process เริ่ม (เลขที่ขึ้นเรื่อย ๆ = มีคนยิงขยะอยู่ หรืองบน้อยไป)
 */
export function untrustedBudgetStats(): Record<
  UntrustedKind,
  { dailyBytes: number; availableBytes: number; refused: number; refusedBytes: number }
> {
  const now = Date.now();
  const of = (kind: UntrustedKind) => {
    const bucket = bucketOf(kind, now);
    return {
      dailyBytes: Math.round(bucket.capacity),
      availableBytes: Math.round(bucket.level),
      refused: bucket.refused,
      refusedBytes: Math.round(bucket.refusedBytes),
    };
  };
  return { browser: of("browser"), "anonymous-admin": of("anonymous-admin") };
}
