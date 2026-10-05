/**
 * งบไบต์ของสิ่งที่ใครก็ส่งเข้า log store ได้โดยไม่ต้องพิสูจน์ตัวตน — ต่อ process ไม่แตะ Mongo ไม่ await อะไร
 *
 *   - `browser` — รายงานจากเบราว์เซอร์ (`POST /api/client-errors` ที่ไม่มี `x-report-token` ที่ตรง — routes/client-errors.ts)
 *     ทั้งตัวเต็มและตัวย่อของรหัสอ้างอิง (lib/error-capture.ts `captureReport`)
 *   - `anonymous-admin` — บันทึกการเรียก `/api/admin*` ที่ token ไม่ผ่านหรือไม่ได้ตรวจ (`via: "ANONYMOUS"` — lib/admin-access.ts)
 *     ทั้งตัวเดี่ยวและบันทึกสรุป
 *   - `anonymous-request` — error event ของ backend ที่เกิดในคำขอ HTTP ที่ไม่มีตัวตนที่ตรวจแล้ว (`isAnonymousRequest` ใน
 *     lib/context.ts: ไม่มีผู้ใช้จาก session ไม่มี admin token หรือ log token ที่ผ่าน) ทั้งตัวเต็มและตัวย่อของรหัสอ้างอิง
 *     (lib/error-capture.ts `keep` / `keepReference`) — fatal ไม่หัก
 *
 * และอีกถังหนึ่งที่**ไม่ใช่**ของที่ใครก็ส่งได้ แต่ใช้กลไกเดียวกัน:
 *   - `admin-token` — บันทึกการเรียก admin API ที่ token **ผ่าน** ซึ่งเขียน**ตอนเกินเพดานขนาด** (`over_quota`) เท่านั้น
 *     (lib/error-capture.ts `enqueueAccessRecord`) ใต้เพดาน มันเป็นข้อมูลปกติที่นับเข้าเพดานเหมือน error ของ server
 *
 * **ทำไมต้องมี:** เพดานต่อนาทีของทางเหล่านี้คุมความถี่ ไม่ได้คุมปริมาณสะสม และของที่เก็บอยู่ได้ 30 ถึง 400 วัน คนที่ไม่มีอะไรเลยนอกจาก
 * URL ยิงไม่หยุดก็เติม log store ได้ไม่จบ: รายงานเบราว์เซอร์ราว 1.5 GB ต่อวันต่อ process (60 ตัวเต็มกับ 240 ตัวย่อต่อนาที) การ
 * เรียก admin API ที่ไม่มี token ซึ่งบันทึกสรุปเปิดใบใหม่ทุกครั้งที่ key ค้นหาเต็ม (ตรวจขั้น 8-10 แบบค้าน 2026-10-01: สามพันคำขอได้
 * สรุปแปดสิบใบ) หรือ route ใดก็ได้ที่ตอบ 5xx ให้คำขอที่ไม่มีตัวตน (`POST /api/auth/thaid/start` ตอบ 501 ตลอดที่ ThaID ยังไม่ได้
 * ตั้งค่า เช่นบน Azure) ซึ่งได้ตัวเต็มห้าสิบตัวต่อชั่วโมงกับตัวย่อของรหัสอ้างอิงนาทีละ 120 ตัว ราวแสนเจ็ดหมื่นตัวต่อวันที่อยู่ 90 วัน (ตรวจ
 * แบบค้านรอบสุดท้าย 2026-10-01) พอถึง LOG_STORE_MAX_MB ธง `over_quota` ก็ปิดของที่สำคัญกว่าไปด้วย — error event ของ server ทุกตัว
 * (การแจ้ง 5xx ต่อเนื่องนับจาก event จึงเงียบ) และค้างอยู่จนของขยะหมดอายุ งบนี้ทำให้สิ่งที่ใครก็ส่งได้กินที่ได้ไม่เกินส่วนหนึ่งของ
 * เพดาน (`SHARE`) จึงพาเพดานไปถึงเองไม่ได้
 *
 * ส่วนบันทึกที่ token ผ่าน ได้รับยกเว้นจาก `over_quota` (ร่องรอยที่ step 8 มีไว้) แต่การยกเว้นที่ไม่มีเพดานคือช่องให้คนถือ token
 * ที่หลุดเติมคลังเกินเพดานไปได้เรื่อย ๆ — ใบสรุปของ token ที่ผ่านปิดแล้วเปิดใบใหม่ไม่จำกัด (`SUMMARY_CLOSED_MS` 0 ใน
 * lib/admin-access.ts) ถัง `admin-token` คือขอบของการยกเว้นนั้น: เกินเพดานแล้ว ของที่เขียนเพิ่มด้วยการยกเว้นค้างอยู่ได้ไม่เกิน
 * `LOG_STORE_MAX_MB × SHARE` (บวกหนึ่งวันต่อการเริ่ม process ใหม่ และใบสรุปที่ค้างตอนปิด process — `flushAdminAccessSummaries`)
 *
 * **กลไก:** ถังต่อชนิด เติมต่อเนื่องวันละ `LOG_STORE_MAX_MB × SHARE ÷ อายุการเก็บของชนิดนั้น` (lib/log-retention.ts) จุได้หนึ่งวัน
 * และเริ่มเต็ม — ของชนิดนั้นที่ค้างอยู่ในคลังจึงไม่เกิน `LOG_STORE_MAX_MB × SHARE` บวกหนึ่งวันต่อการเริ่ม process ใหม่หนึ่งครั้งใน
 * ช่วงอายุนั้น ราคาของเอกสารคือขนาด BSON บวก index ที่มันกิน (`indexCost`) ตัวเดี่ยวกับตัวเต็มใช้ได้ถึงแค่ `RESERVE` ของถัง ส่วนที่
 * เหลือเก็บไว้ให้บันทึกสรุป (นับทุกการเรียกในใบเดียว) และตัวย่อของรหัสอ้างอิง (ตัวที่ผู้ใช้อ่านให้เจ้าหน้าที่ฟัง) ที่ใช้ได้ถึงก้นถัง
 *
 * **ราคาที่จ่าย:** คนที่ยิงขยะไม่หยุดในอัตราที่เท่ากับการเติม (production ราว 18 KB ต่อนาทีของรายงานเบราว์เซอร์ — ตัวเต็มขนาดใหญ่สุดราว
 * หนึ่งตัวต่อนาที · ราว 2 KB ต่อนาทีของ error ในคำขอที่ไม่มีตัวตน — ตัวย่อราวหนึ่งตัวครึ่งต่อนาที) ทำให้ของจริงในช่องทางเดียวกันไม่ถูกเก็บ
 * เป็นเอกสาร: รายงานจริงจากเบราว์เซอร์ รวมถึงรหัสอ้างอิง · error ที่ผู้ใช้ที่ยังไม่ได้เข้าสู่ระบบเจอ (หน้า login, activate, callback
 * ของ ThaID, `requireAuth` ที่ล้มก่อนรู้ว่าเป็นใคร) และรหัสอ้างอิงของมัน — issue ยังนับครบ (`count`) และ issue ระดับ error ยังแจ้ง
 * เป็นใบใหม่ได้ แต่การแจ้ง "ตอบ 5xx ต่อเนื่อง" ของ route ที่มีแต่คำขอไม่มีตัวตนนับจาก event จึงเงียบระหว่างนั้น (workers/error-alerts.ts)
 * เดิมต้องยิงเกิน 300 ต่อนาทีถึงจะกลบรหัสได้ แต่ก็เติมดิสก์จนทุกอย่างหยุดในไม่กี่วัน — แลกกันแล้ว ให้ช่องทางที่ใครก็ส่งได้เป็นตัวที่
 * เสียเอง ไม่ใช่ error ของ server ทั้งหมดกับร่องรอยของ admin token ตัวเลข `refused` ใน `GET /api/admin/logs/status` บอกว่ากำลังเกิดอยู่
 *
 * ต่อ process: backend หลาย replica (Azure) ได้คนละถัง ส่วนที่ใช้ได้จึงคูณจำนวน replica (สาม replica × 25% = 75% ของเพดาน — ยัง
 * ไม่ถึงเพดานเอง)
 *
 * **ไม่อยู่ในงบนี้** (มีเพดานความถี่ของตัวเอง แต่ยังกินที่สะสมได้): issue ใหม่ที่รายงานเบราว์เซอร์สร้าง (ไม่เกินร้อยต่อชั่วโมงต่อ process
 * อยู่ 30 วันถ้าไม่เกิดอีก — ราวห้าสิบ MB ที่เพดานความถี่) แถว `ADMIN_TOKEN_REJECTED` / `LOG_TOKEN_REJECTED` ที่ relay คัดลอกจาก
 * Postgres (throttle ของ lib/token-rejection.ts อยู่ 400 วันในหมวด `admin-access`) และสำเนา audit ที่ Postgres ไม่รับ
 * (`audit_fallback` — เขียนแม้เกินเพดาน คำขอที่ไม่มีตัวตนสร้างได้เฉพาะตอนที่ Postgres ไม่รับแถวอยู่แล้ว)
 */
import { env } from "../env.js";
import { ACTIVITY_RETENTION, ANONYMOUS_ADMIN_ACCESS_DAYS, BROWSER_EVENT_DAYS, ERROR_EVENT_DAYS } from "./log-retention.js";

/** ของที่ใครก็ส่งได้ — สามชนิด รวมกันไม่เกิน 25% ของเพดาน */
export type UntrustedKind = "browser" | "anonymous-admin" | "anonymous-request";
/** ทุกถัง — สามชนิดข้างบน กับส่วนที่ยกเว้นให้บันทึกของ token ที่ผ่านตอนเกินเพดาน */
export type BudgetKind = UntrustedKind | "admin-token";

const UNTRUSTED_KINDS: readonly UntrustedKind[] = ["browser", "anonymous-admin", "anonymous-request"];

/**
 * ส่วนของ LOG_STORE_MAX_MB ที่แต่ละชนิดกินได้ — สามชนิดที่ใครก็ส่งได้รวมกัน 25% ที่เหลือ 75% เป็นของ error ของ server ในคำขอที่มีตัวตน
 * และนอกคำขอ, สำเนา audit, บันทึกที่ token ผ่าน
 * production (5 GB): รายงานเบราว์เซอร์ราว 26 MB ต่อวัน การเรียกที่ไม่มี token ราว 2.8 MB ต่อวัน (ตัวเดี่ยวราว 1.6–1.8 KB รวม index
 * ได้ราวพันสองร้อยถึงพันสี่ร้อยตัวก่อนถึงส่วนที่เหลือไว้) error ในคำขอที่ไม่มีตัวตนราว 2.8 MB ต่อวัน (ทั้งตัวเต็มและตัวย่อของ 5xx ที่
 * route ตอบราว 1 KB บวก index 320 ไบต์ — วัดจริง 2026-10-01 — ราวสองพันตัวต่อวัน) ·
 * `admin-token` **อยู่นอกเพดาน**: 5% ของเพดานต่ออายุ 400 วัน ราว 650 KB ต่อวันบน production (ตัวเดี่ยวราวสามร้อยตัว ที่เหลือพับลง
 * ใบสรุปที่นับทุกการเรียก) — ใช้เฉพาะตอนเกินเพดาน ซึ่งการแจ้งเตือนข้อ 6 (workers/error-alerts.ts) บอกคนดูแลอยู่แล้ว ·
 * dev (512 MB): หนึ่งในสิบของนั้น
 */
const SHARE: Record<BudgetKind, number> = {
  browser: 0.15,
  "anonymous-admin": 0.05,
  "anonymous-request": 0.05,
  "admin-token": 0.05,
};
/**
 * อายุของสิ่งที่แต่ละถังจ่าย — `admin-token` ตามหมวด `admin-access` (400 วัน) ถ้า BDI ตั้งให้เก็บตลอด (`null`) ไม่มีอัตราการเติม
 * ไหนคุมยอดสะสมได้ ใช้ 400 วันต่อ และยอมรับว่ายอดที่เกินเพดานโตช้า ๆ ตามเวลา
 */
const RETENTION_DAYS: Record<BudgetKind, number> = {
  browser: BROWSER_EVENT_DAYS,
  "anonymous-admin": ANONYMOUS_ADMIN_ACCESS_DAYS,
  "anonymous-request": ERROR_EVENT_DAYS,
  "admin-token": ACTIVITY_RETENTION["admin-access"].deleteAfterDays ?? 400,
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

const buckets = new Map<BudgetKind, Bucket>();

function bucketOf(kind: BudgetKind, now: number): Bucket {
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
export function takeUntrustedBytes(kind: BudgetKind, cost: number, options: { useReserve: boolean }): boolean {
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
export function refundUntrustedBytes(kind: BudgetKind, cost: number): void {
  const bucket = bucketOf(kind, Date.now());
  bucket.level = Math.min(bucket.capacity, bucket.level + cost);
}

interface BudgetStats {
  dailyBytes: number;
  availableBytes: number;
  refused: number;
  refusedBytes: number;
}

function statsOf(kind: BudgetKind, now: number): BudgetStats {
  const bucket = bucketOf(kind, now);
  return {
    dailyBytes: Math.round(bucket.capacity),
    availableBytes: Math.round(bucket.level),
    refused: bucket.refused,
    refusedBytes: Math.round(bucket.refusedBytes),
  };
}

/**
 * ตัวเลขของ process นี้ — `GET /api/admin/logs/status` แสดง ต่อชนิด: `dailyBytes` งบต่อวัน · `availableBytes` ที่เหลือตอนนี้ ·
 * `refused` / `refusedBytes` ที่ไม่ได้เก็บเพราะงบหมดตั้งแต่ process เริ่ม (เลขที่ขึ้นเรื่อย ๆ = มีคนยิงขยะอยู่ หรืองบน้อยไป) — ใบสรุป
 * ที่รองบถูกนับซ้ำทุกครั้งที่ลองใหม่
 */
export function untrustedBudgetStats(): Record<UntrustedKind, BudgetStats> {
  const now = Date.now();
  const result = {} as Record<UntrustedKind, BudgetStats>;
  for (const kind of UNTRUSTED_KINDS) result[kind] = statsOf(kind, now);
  return result;
}

/**
 * ถังของบันทึกที่ token ผ่านซึ่งเขียนตอนเกินเพดาน — `GET /api/admin/logs/status` แสดงแยกจากของที่ใครก็ส่งได้ (`adminTokenOverQuotaAllowance`)
 * `refused` ที่ขึ้นแปลว่าเกินเพดานอยู่และมีการเรียกด้วย token ที่ผ่านมากกว่าที่ส่วนยกเว้นรับได้ — ตัวเดี่ยวพับลงใบสรุปที่รองบ
 */
export function adminTokenAllowanceStats(): BudgetStats {
  return statsOf("admin-token", Date.now());
}
