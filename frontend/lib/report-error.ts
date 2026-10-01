/**
 * รายงาน error ของเบราว์เซอร์ไปที่ log store — `POST /api/client-errors` ของ backend (backend/src/routes/client-errors.ts)
 *
 * ใช้จาก instrumentation-client.ts (error ที่ไม่มีใครจับ), app/global-error.tsx และ lib/api.ts (502 ของ proxy) — ไม่มีหน้าไหน
 * ต้องเรียกเอง กติกา:
 *   - **ไม่รายงาน `ApiError`** ยกเว้น `backend_unreachable` — 4xx เป็นเรื่องของคำขอ 5xx backend เก็บไว้เองแล้วพร้อมรหัสอ้างอิง
 *     ส่วน 502 ของ proxy คือคำขอที่ backend ไม่เคยเห็น จึงต้องมาจากที่นี่ แต่ส่งตอนนั้นไม่ได้ (backend ล่มอยู่) — เก็บไว้ใน
 *     `sessionStorage` (`bdi.pendingErrorReports` ไม่เกิน 5 รายการ ไม่เขียนอะไรอื่นลงไป) แล้วส่งหลังคำขอ API ถัดไปที่สำเร็จ
 *     เต็มแล้วตัดรหัสที่ไม่เคย**ขึ้นจอ**ก่อน — ดูจากหน้าเว็บจริง ไม่ใช่จากว่าใครเรียก (`queueProxyFailure`)
 *   - ส่งแค่ `location.pathname` ไม่เคยส่ง query hash หรือค่าใด ๆ จาก `sessionStorage` ของหน้า (`?token=` ของหน้า activate,
 *     `?code&state` ของ ThaID) path ของคำขอ API ห้าตัวล่าสุดก็ตัด query ทิ้ง (`noteApiCall`) และ URL ที่โผล่ในข้อความหรือ stack
 *     ของ error เองก็เหลือแค่ path (`withoutUrlQueries`)
 *   - ซ้ำกัน (ข้อความ + เฟรมแรก) ส่งครั้งเดียวต่อการเปิดหน้า และไม่เกิน 10 รายงานต่อการเปิดหน้า — รายงานที่มีรหัสอ้างอิง
 *     (หน้า global-error) ไม่ถูกตัดเป็นตัวซ้ำ และมีโควตา 10 ของตัวเอง error อื่นใช้โควตาของมันหมดไม่ได้
 *   - `navigator.sendBeacon` เป็น `text/plain` (ไม่มี preflight ข้าม origin ในเครื่อง dev และส่งได้แม้หน้ากำลังปิด) ไม่ได้ก็ `fetch`
 *     แบบ keepalive ไม่แนบ cookie — endpoint ไม่ต้อง login และไม่ควรรู้ว่าใครส่ง
 *   - กลืนทุกความล้มเหลว: การรายงาน error ต้องไม่เป็นต้นเหตุของ error
 *   - chunk ที่โหลดไม่ขึ้น (`isChunkLoadError`) เป็นคำเตือน ไม่ว่ามาทางไหน (ตัวดักของ `window` หรือหน้า global-error)
 *   - body ไม่เกินเพดานของ backend เป็นไบต์ (lib/report-body.ts) — เกินแล้ว backend ทิ้งทั้งก้อนเงียบ ๆ
 * backend กวาดทุกช่องซ้ำเอง (lib/redact.ts) ไม่เชื่อสิ่งที่ส่งไป
 */
import { reportBody } from "./report-body";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "";
/** รุ่นของบันเดิลนี้ — SHA ที่ build (frontend/Dockerfile: GIT_SHA → NEXT_PUBLIC_RELEASE) dev ไม่มี */
const RELEASE = process.env.NEXT_PUBLIC_RELEASE || "dev";
const ENDPOINT = `${BASE}/api/client-errors`;

const MAX_PER_PAGE = 10;
/**
 * รายงานที่มีรหัสอ้างอิงนับแยกจาก `MAX_PER_PAGE` — รหัสนั้นอยู่บนจอแล้ว ผู้ใช้ถูกบอกให้แจ้งรหัสนี้ ถ้าคำเตือน chunk หรือ error
 * ของสคริปต์ภายนอกสิบตัวก่อนหน้าใช้โควตาหมด หน้า global-error ยังแสดงรหัส แต่ไม่มีอะไรส่งไป G6 ตอบว่าไม่พบ ยังต้องมีเพดาน
 * เพราะ `sent` นับทั้งการเปิดหน้า (ข้ามการเปลี่ยนหน้าแบบ SPA) — backend จำกัดอีกชั้น (60 รายงานของเบราว์เซอร์ต่อนาที)
 */
const MAX_REFERENCED_PER_PAGE = 10;
const PENDING_KEY = "bdi.pendingErrorReports";
const PENDING_MAX = 5;
/**
 * รหัสที่เพิ่งเข้าคิวถูกเฝ้าดูว่าขึ้นจอไหมนานเท่านี้ (`watchForShown`) และระหว่างนี้ยังไม่นับว่า "ไม่มีใครเห็น" — toast หรือข้อความ
 * ในหน้าเรนเดอร์ภายในเฟรมสองเฟรมหลังคำขอล้ม ห้าวินาทีเผื่อเครื่องช้า
 */
const SHOW_WINDOW_MS = 5_000;
const LAST_API_MAX = 5;

export type ReportMechanism = "window" | "unhandledrejection" | "global-error" | "proxy";

interface ApiCall {
  method: string;
  path: string;
  status: number;
  correlationId: string | null;
}

interface PendingReport {
  reference: string;
  pathname: string;
  at: string;
  /** มาจากคำขอที่บอกเองว่าไม่แสดง error ของตัวเอง (`background` ใน lib/api.ts) — ไม่ต้องรอดูว่าจะขึ้นจอไหม */
  background?: boolean;
  /** รหัสนี้ขึ้นจอแล้ว (toast ข้อความในหน้า — ที่ไหนก็ได้ในหน้าเว็บ, `watchForShown`) ผู้ใช้อาจอ่านให้เจ้าหน้าที่ฟัง */
  shown?: boolean;
}

let sent = 0;
let sentReferenced = 0;
const seen = new Set<string>();
const lastApi: ApiCall[] = [];

/** จดคำขอ API ล่าสุด (lib/api.ts เรียกทุกคำตอบ) — path ไม่มี query เก็บแค่ห้าตัว ติดไปกับรายงานถัดไป */
export function noteApiCall(call: ApiCall): void {
  try {
    lastApi.push({ ...call, path: call.path.split("?")[0]!.split("#")[0]!.slice(0, 300) });
    if (lastApi.length > LAST_API_MAX) lastApi.shift();
  } catch {
    // ไม่มีอะไรต้องทำ
  }
}

/**
 * ของที่ throw มาเป็น `ApiError` ของ lib/api.ts ไหม — ดูจากป้าย `kind` ไม่ใช่ `instanceof` (lib/api.ts import ไฟล์นี้) และไม่ใช่
 * `constructor.name` ซึ่งบันเดิล production ย่อชื่อคลาสทิ้ง
 */
function apiErrorOf(value: unknown): { status: number; code: string } | null {
  if (!value || typeof value !== "object") return null;
  const { kind, status, code } = value as { kind?: unknown; status?: unknown; code?: unknown };
  return kind === "ApiError" && typeof status === "number" && typeof code === "string" ? { status, code } : null;
}

/**
 * chunk ของบันเดิลโหลดไม่ขึ้น — ส่วนใหญ่คือ deploy ใหม่ระหว่างที่หน้าเก่ายังเปิดอยู่ (ไฟล์ของ build เก่าหายไปแล้ว) ไม่ใช่บั๊ก
 * บันทึกเป็นคำเตือนและไม่ส่งอีเมลแจ้งเตือน (plan §5) backend จัดทุกตัวไว้ใน issue เดียว `browser:chunk-load`
 *
 * **สองถ้อยคำ เพราะสอง bundler:** `next dev --webpack` ของ dev checkout ได้ "Loading chunk 123 failed." / "Loading CSS chunk …"
 * ส่วน `next build` ของ production เป็น **Turbopack** (ค่าตั้งต้นของ Next 16) ได้ "Failed to load chunk
 * /_next/static/chunks/<hash>.js from module 83412" ชื่อ `ChunkLoadError` ทั้งคู่ใน runtime ที่ Next 16.2.12 ใส่ลงบันเดิล (ตรวจกับ
 * build จริง 2026-10-01) แต่ดูชื่ออย่างเดียวไม่พอ: runtime ของ Turbopack อีกชุดที่มากับ Next (`next/dist/bundle-analyzer`)
 * throw `Error` ชื่อ `Error` ด้วยถ้อยคำเดียวกัน และ `window` `error` ที่ไม่มี `event.error` มีแค่ข้อความ — ตัวที่หลุดจะเป็น error
 * หนึ่ง issue ต่อ hash ของ chunk ต่อ build และส่งอีเมลแจ้งเตือนทุก deploy จึงดูถ้อยคำด้วย
 * ตรวจคู่กันกับ `isChunkLoadReport` ใน backend/src/routes/client-errors.ts — แก้ที่หนึ่งต้องแก้อีกที่
 */
export function isChunkLoadError(value: unknown): boolean {
  // `window` `error` ที่ไม่มี `event.error` (สคริปต์ข้าม origin) ได้แค่ข้อความ เช่น "Uncaught Error: Failed to load chunk …"
  const name = value instanceof Error ? value.name : "";
  const message = value instanceof Error ? String(value.message ?? "") : typeof value === "string" ? value : "";
  return (
    name === "ChunkLoadError" ||
    /Loading (?:CSS )?chunk [\w-]+ failed/i.test(message) ||
    /Failed to load chunk\s/i.test(message)
  );
}

function describe(value: unknown): { name: string; message: string; stack?: string } {
  if (value instanceof Error) {
    return { name: value.name || "Error", message: String(value.message ?? ""), stack: value.stack };
  }
  if (typeof value === "string") return { name: "Error", message: value };
  try {
    return { name: "NonError", message: JSON.stringify(value)?.slice(0, 500) ?? String(value) };
  } catch {
    return { name: "NonError", message: String(value) };
  }
}

/**
 * รายงาน error หนึ่งตัว — ไม่ throw ไม่ await `reference` คือรหัสที่ผู้ใช้เห็นบนจอ (หน้า global-error) `digest` คือของ Next
 * สำหรับ error ฝั่ง server ที่ถูกซ่อนข้อความ · ไม่ระบุ `level` = `warning` ถ้าเป็น chunk ที่โหลดไม่ขึ้น (`isChunkLoadError`)
 * นอกนั้น `error`
 */
export function reportError(
  error: unknown,
  options: { mechanism: ReportMechanism; level?: "error" | "warning"; digest?: string; reference?: string },
): void {
  try {
    const api = apiErrorOf(error);
    if (api) return; // 4xx: เรื่องของคำขอ · 5xx: backend เก็บแล้ว · backend_unreachable: lib/api.ts เข้าคิวเอง
    if (options.reference ? sentReferenced >= MAX_REFERENCED_PER_PAGE : sent >= MAX_PER_PAGE) return;
    const { name, message: rawMessage, stack: rawStack } = describe(error);
    const message = withoutUrlQueries(rawMessage);
    const stack = rawStack === undefined ? undefined : withoutUrlQueries(rawStack);
    const firstFrame = (stack ?? "").split("\n").find((line) => /^\s+at\s|@/.test(line)) ?? "";
    const key = `${name}|${message}|${firstFrame}`;
    // รายงานที่มีรหัสอ้างอิงไม่ถูกตัดเป็นตัวซ้ำ: error ที่เรนเดอร์ไม่ผ่านมาถึง `window` `error` ก่อน (React ส่งต่อ) แล้วหน้า
    // global-error รายงานตัวเดียวกันพร้อมรหัสที่ผู้ใช้เห็น — ถ้าตัดตัวหลัง รหัสบนจอจะค้นไม่เจอ
    if (seen.has(key) && !options.reference) return;
    seen.add(key);
    if (options.reference) sentReferenced += 1;
    else sent += 1;
    send({
      mechanism: options.mechanism,
      level: options.level ?? (isChunkLoadError(error) ? "warning" : "error"),
      name: name.slice(0, 200),
      message: message.slice(0, 2_000),
      ...(stack ? { stack: stack.slice(0, 16_000) } : {}),
      pathname: currentPathname(),
      ...(options.digest ? { digest: options.digest.slice(0, 100) } : {}),
      ...(options.reference ? { reference: options.reference } : {}),
      release: RELEASE,
      lastApi: [...lastApi],
    });
  } catch {
    // การรายงานพังต้องไม่พาอะไรพังตาม
  }
}

/**
 * 502 ของ proxy (`backend_unreachable`) — เก็บไว้ส่งทีหลัง ตอนนี้ backend ล่มอยู่ ส่งไปก็ไม่ถึง ไม่เกิน 5 รายการ
 * รหัสอ้างอิงเดียวกับที่ผู้ใช้เห็นใน toast ทำให้เจ้าหน้าที่ค้นเจอได้ (Postman G6 — trace แสดงเป็น `reports`)
 *
 * **คิวเต็มแล้วตัดตามว่ารหัสขึ้นจอหรือเปล่า** (`evictionRank`) ไม่ใช่ตามว่าใครเรียก: รหัสที่เข้าคิวถูกเฝ้าดูห้าวินาที
 * (`watchForShown`) ถ้าโผล่ที่ไหนในหน้าเว็บ — toast ข้อความใต้ฟอร์ม หน้า login — ก็ถูกจดว่าขึ้นจอ ลำดับการตัด:
 *   1. รหัสที่ไม่ขึ้นจอ เก่าสุดก่อน (คำขอ `background` หรือเข้าคิวเกินห้าวินาทีแล้วไม่มีใครเห็น)
 *   2. รหัสที่ขึ้นจอแล้ว เก่าสุดก่อน — ยกเว้นตัวล่าสุดที่ขึ้นจอ
 *   3. รหัสที่เพิ่งเข้าคิวไม่ถึงห้าวินาที (ยังอาจกำลังจะขึ้นจอ)
 *   4. รหัสล่าสุดที่ขึ้นจอ — ตัวที่ผู้ใช้น่าจะอ่านให้เจ้าหน้าที่ฟังที่สุด ออกเป็นตัวสุดท้าย
 *
 * เดิม (f8da457) ตัดคำขอที่ติด `{ background: true }` ก่อน แล้วถือว่าคำขออื่นทุกตัวผู้ใช้เห็น แต่การโหลดรายการ สรุป รายละเอียด และ
 * รายชื่อผู้เชี่ยวชาญของหน้าที่ผู้ใช้เปิดผ่านล้มด้วย toast ข้อความตายตัว ("โหลดข้อมูลไม่สำเร็จ") หรือเงียบ ๆ — ไม่เคยแสดงรหัส แต่
 * นับว่าเห็น เข้าหน้ารายละเอียดแล้วกลับหน้ารายการหนึ่งรอบระหว่าง backend ล่มก็ดันรหัสใน toast ออกจากคิว G6 ตอบว่าไม่พบ (ตรวจ
 * ขั้น 9 แบบค้าน 2026-10-01) ก่อนหน้านั้นตัดตัวเก่าสุดเสมอ ตัว poll `/state` ทุก 15 วินาทีห้าครั้งก็พอ การติดป้ายทีละที่เรียกคือ
 * จุดที่พลาดทั้งสองครั้ง จึงดูจากหน้าเว็บแทน `background` ยังมีไว้บอกว่าไม่ต้องรอดู
 */
export function queueProxyFailure(reference: string | undefined, options: { background?: boolean } = {}): void {
  try {
    if (!reference || !/^[0-9a-f]{8}$/i.test(reference)) return;
    const pending = readPending();
    if (pending.some((item) => item.reference === reference)) return;
    pending.push({
      reference,
      pathname: currentPathname(),
      at: new Date().toISOString(),
      ...(options.background ? { background: true } : {}),
    });
    while (pending.length > PENDING_MAX) {
      const now = Date.now();
      const newestShown = pending.map((item) => item.shown === true).lastIndexOf(true);
      let victim = 0;
      for (let index = 1; index < pending.length; index += 1) {
        if (evictionRank(pending[index]!, index, newestShown, now) < evictionRank(pending[victim]!, victim, newestShown, now)) {
          victim = index;
        }
      }
      pending.splice(victim, 1);
    }
    writePending(pending);
    // คำขอที่ไม่บอกว่าเงียบ — ดูว่ารหัสนี้จะขึ้นจอไหม (เริ่มก่อน `throw` ใน lib/api.ts ตัวจับ error ของหน้ายังไม่ได้วาดอะไร)
    if (!options.background) watchForShown();
  } catch {
    // sessionStorage ใช้ไม่ได้ (โหมดส่วนตัว เต็ม) — รายงานนั้นหายไป
  }
}

/** ลำดับการตัดเมื่อคิวเต็ม (เลขน้อยออกก่อน เท่ากันตัวเก่าออกก่อน) — ข้อ 1–4 ของ `queueProxyFailure` */
function evictionRank(item: PendingReport, index: number, newestShown: number, now: number): number {
  if (item.shown === true) return index === newestShown ? 3 : 1;
  const fresh = item.background !== true && now - Date.parse(item.at) < SHOW_WINDOW_MS;
  return fresh ? 2 : 0;
}

let shownObserver: MutationObserver | null = null;
let shownTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * เฝ้าหน้าเว็บ `SHOW_WINDOW_MS` นับจาก 502 ล่าสุด — ข้อความที่เพิ่มหรือเปลี่ยนในหน้า (toast, ข้อความใต้ฟอร์ม) ที่มีรหัสในคิวซึ่งยังไม่
 * ขึ้นจอ ทำให้รหัสนั้นถูกจดว่า `shown` ดูที่ DOM ไม่ใช่ที่ตัวเรียก: หน้าไหนแสดง `ApiError.message` ด้วยวิธีไหนก็ตามก็นับ และหน้าที่
 * แสดงข้อความตายตัวก็ไม่นับ โดยไม่ต้องแก้หน้าใดเลย นอกช่วงนี้ไม่มีตัวเฝ้า (ไม่มีค่าใช้จ่ายตอนระบบปกติ)
 */
function watchForShown(): void {
  try {
    if (typeof MutationObserver === "undefined" || typeof document === "undefined" || !document.body) return;
    if (!shownObserver) {
      shownObserver = new MutationObserver((records) => {
        try {
          const unshown = readPending().filter((item) => item.shown !== true);
          if (unshown.length === 0) return;
          const texts: string[] = [];
          for (const record of records) {
            if (record.type === "characterData") texts.push(record.target.textContent ?? "");
            else record.addedNodes.forEach((node) => texts.push(node.textContent ?? ""));
          }
          const text = texts.join("\n").toLowerCase();
          const found = unshown.filter((item) => text.includes(item.reference.toLowerCase())).map((item) => item.reference);
          if (found.length > 0) markShown(found);
        } catch {
          // ไม่มีอะไรต้องทำ
        }
      });
      shownObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
    }
    if (shownTimer) clearTimeout(shownTimer);
    shownTimer = setTimeout(() => {
      shownObserver?.disconnect();
      shownObserver = null;
      shownTimer = null;
    }, SHOW_WINDOW_MS);
  } catch {
    // ไม่มีตัวเฝ้า = รหัสนั้นนับว่าไม่ขึ้นจอหลังห้าวินาที (ข้อ 1 ของ `queueProxyFailure`)
  }
}

function markShown(references: string[]): void {
  const pending = readPending();
  let changed = false;
  for (const item of pending) {
    if (item.shown !== true && references.includes(item.reference)) {
      item.shown = true;
      changed = true;
    }
  }
  if (changed) writePending(pending);
}

/** ส่งรายงาน 502 ที่ค้างไว้ — lib/api.ts เรียกหลังคำขอที่สำเร็จ (backend กลับมาแล้ว) ล้างคิวก่อนส่ง จึงไม่ส่งซ้ำ */
export function flushPendingReports(): void {
  try {
    const pending = readPending();
    if (pending.length === 0) return;
    writePending([]);
    for (const item of pending) {
      send({
        mechanism: "proxy",
        level: "error",
        name: "BackendUnreachable",
        message: "backend_unreachable",
        pathname: item.pathname,
        reference: item.reference,
        at: item.at,
        release: RELEASE,
        lastApi: [],
      });
    }
  } catch {
    // ไม่มีอะไรต้องทำ
  }
}

function readPending(): PendingReport[] {
  try {
    const raw = window.sessionStorage.getItem(PENDING_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed
          .filter(
            (item): item is PendingReport =>
              !!item && typeof item.reference === "string" && typeof item.pathname === "string" && typeof item.at === "string",
          )
          // เก็บแค่ช่องที่รู้จัก — ค่าที่หน้าอื่นหรือรุ่นก่อนเขียนไว้ไม่ติดกลับลงไป · รายการของรุ่นก่อนไม่มี `shown` = ไม่รู้ว่าขึ้นจอ
          // ไหม เข้าคิวไปนานแล้วจึงนับเป็นข้อ 1 ของ `queueProxyFailure`
          .map((item) => ({
            reference: item.reference,
            pathname: item.pathname,
            at: item.at,
            ...(item.background === true ? { background: true } : {}),
            ...(item.shown === true ? { shown: true } : {}),
          }))
      : [];
  } catch {
    return [];
  }
}

function writePending(items: PendingReport[]): void {
  try {
    if (items.length === 0) window.sessionStorage.removeItem(PENDING_KEY);
    else window.sessionStorage.setItem(PENDING_KEY, JSON.stringify(items));
  } catch {
    // ไม่มีอะไรต้องทำ
  }
}

/**
 * URL ในข้อความเหลือแค่ path — ตัด `?…` และ `#…` ทิ้ง เหลือ `:บรรทัด:คอลัมน์` ท้ายเฟรมไว้ ข้อความของ error มี URL เต็มของหน้าได้เอง
 * (เฟรมของสคริปต์ในหน้า, ลิงก์ของ React ที่ยกข้อความบนจอมาใน `?args[]=`, fetch ที่ล้ม) — กฎเดียวกับ backend
 * (`withoutUrlQueries` ใน backend/src/routes/client-errors.ts ซึ่งตัดซ้ำอีกรอบ) ไล่ทีละคำ: คำที่มี `/` ก่อน `?`/`#` ตัวแรกเท่านั้น
 */
function withoutUrlQueries(text: string): string {
  try {
    return text.replace(/[^\s"'`()<>]+/g, (word) => {
      const cut = word.search(/[?#]/);
      if (cut <= 0) return word;
      const path = word.slice(0, cut);
      if (!path.includes("/")) return word;
      return path + (/(?::\d{1,9}){1,2}$/.exec(word.slice(cut))?.[0] ?? "");
    });
  } catch {
    return text;
  }
}

/** ไม่เกิน 2,000 ตัว — เพดานของ backend (`pathname` ใน zod) เกินแล้วทั้งรายงานถูกปฏิเสธเงียบ ๆ */
function currentPathname(): string {
  try {
    return window.location.pathname.slice(0, 2_000);
  } catch {
    return "";
  }
}

function send(report: Record<string, unknown>): void {
  try {
    const body = reportBody(report);
    const beacon =
      typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function"
        ? navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "text/plain" }))
        : false;
    if (beacon) return;
    void fetch(ENDPOINT, {
      method: "POST",
      body,
      keepalive: true,
      credentials: "omit",
      headers: { "content-type": "text/plain" },
    }).catch(() => undefined);
  } catch {
    // ไม่มีอะไรต้องทำ
  }
}
