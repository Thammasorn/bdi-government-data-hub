/**
 * ThaiD (ระบบพิสูจน์และยืนยันตัวตนทางดิจิทัล กรมการปกครอง) — OAuth 2.0 / OIDC client
 *
 * อ้างอิง `assets/thaid/thaid-spec-sandbox-1.0.0-nocred.pdf` §6 และ Postman collection
 * ในโฟลเดอร์เดียวกัน ไฟล์นี้พูดกับ ThaiD อย่างเดียว ไม่แตะฐานข้อมูล —
 * การผูก state กับคำขอและการเทียบเลขบัตรอยู่ใน `lib/thaid-flow.ts` และ `routes/auth.ts`
 *
 * ลำดับที่ใช้จริง:
 *   1. authorizeUrl()      → พาเบราว์เซอร์ไป /api/v2/oauth2/auth/ (ผู้ใช้ยืนยันในแอป ThaiD)
 *   2. ThaiD redirect กลับ redirect_uri พร้อม ?code=&state=
 *   3. exchangeCode()      → POST /api/v2/oauth2/token/ ด้วย Basic client_id:client_secret
 *   4. verifyIdToken()     → ตรวจลายเซ็น ES256 ด้วย JWKS ของกรมการปกครอง แล้วอ่าน pid ออกมา
 *   5. revokeToken()       → คืน token ทิ้ง เพราะระบบนี้ใช้ ThaiD เพื่อ "ยืนยันตัวตน" ครั้งเดียว
 *                            ไม่ได้เก็บ access token ไว้เรียก API อื่นต่อ
 *
 * id_token มาถึงเราผ่าน back channel (เราเรียก token endpoint เอง ผ่าน TLS) มาตรฐาน OIDC
 * จึงยอมให้ข้ามการตรวจลายเซ็นได้ แต่ตรวจไว้ก็ไม่แพง และมันคือหลักฐานชิ้นเดียวที่ใช้ตัดสิน
 * ว่าจะสร้างบัญชีให้หรือไม่ — จึงตรวจ
 */
import { createPublicKey, randomBytes, type JsonWebKey, type KeyObject } from "node:crypto";

import jwt from "jsonwebtoken";

import { env } from "../env.js";
import { isValidThaiNationalId } from "./validation.js";

/** ข้อมูลผู้ใช้ที่ ThaiD ส่งกลับมา — เก็บเฉพาะที่ระบบนี้ใช้ */
export interface ThaidIdentity {
  /**
   * เลขประจำตัวประชาชน 13 หลักที่ผ่าน checksum แล้ว อ่านจาก claim ที่ `THAID_USE_PID`
   * กำหนด (`pid` หรือ `sub`) เป็น null เมื่อ claim นั้นไม่มา หรือมาแล้วไม่ใช่เลขบัตร
   */
  pid: string | null;
  /** sub ของ id_token — ลงคอลัมน์ user_account.external_subject */
  subject: string;
  titleTh: string | null;
  givenNameTh: string | null;
  familyNameTh: string | null;
  nameTh: string | null;
  nameEn: string | null;
}

export class ThaidError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export function thaidConfigured(): boolean {
  return Boolean(env.thaid.clientId && env.thaid.clientSecret);
}

/**
 * URL ที่พาผู้ใช้ไปยืนยันตัวตน
 *
 * scope คั่นด้วยช่องว่าง (คู่มือ §6.1.1) — URLSearchParams เข้ารหัสเป็น `+`
 * ซึ่ง ThaiD อ่านได้ตามปกติของ application/x-www-form-urlencoded
 */
export function authorizeUrl(state: string, nonce: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: env.thaid.clientId,
    redirect_uri: env.thaid.redirectUri,
    scope: env.thaid.scope,
    state,
    nonce,
  });
  return `${env.thaid.rootUrl}/api/v2/oauth2/auth/?${params.toString()}`;
}

export function generateState(): string {
  return randomBytes(24).toString("base64url");
}

/**
 * `nonce` ตาม OIDC Core §3.1.2.1 — RECOMMENDED สำหรับ code flow
 *
 * `state` ผูก callback กลับเข้าคำขอที่เราเป็นคนเริ่ม (กัน CSRF) แต่ไม่ได้ผูก **id_token**
 * เข้ากับคำขอนั้น `nonce` เดินทางไปกับ authorization request แล้วกลับมาเป็น claim
 * ใน id_token จึงเป็นตัวที่บอกว่า "ใบนี้ออกให้คำขอของเราจริง" ไม่ใช่ใบที่ใครหยิบมาจากที่อื่น
 */
export function generateNonce(): string {
  return randomBytes(24).toString("base64url");
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  token_type: string;
  scope: string;
  /** คู่มือเขียนทั้ง expire_in และ expires_in — ไม่ได้ใช้ทั้งคู่ */
  expires_in?: number;
}

function basicAuthHeader(): string {
  const raw = `${env.thaid.clientId}:${env.thaid.clientSecret}`;
  return `Basic ${Buffer.from(raw).toString("base64")}`;
}

function commonHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/x-www-form-urlencoded",
    Authorization: basicAuthHeader(),
    ...(env.thaid.apiKey ? { "x-api-key": env.thaid.apiKey } : {}),
  };
}

/** timeout กันคำขอค้าง: ผู้ใช้กำลังรอหน้าเว็บอยู่ ไม่ควรค้างเกินไม่กี่วินาที */
async function postForm(path: string, body: Record<string, string>): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    return await fetch(`${env.thaid.rootUrl}${path}`, {
      method: "POST",
      headers: commonHeaders(),
      body: new URLSearchParams(body).toString(),
      signal: controller.signal,
    });
  } catch (err) {
    throw new ThaidError(
      "network_error",
      `เชื่อมต่อระบบ ThaiD ไม่ได้: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    clearTimeout(timer);
  }
}

export async function exchangeCode(code: string): Promise<TokenResponse> {
  const res = await postForm("/api/v2/oauth2/token/", {
    grant_type: "authorization_code",
    code,
    redirect_uri: env.thaid.redirectUri,
  });

  const payload = (await res.json().catch(() => ({}))) as Record<string, string>;
  if (!res.ok) {
    throw new ThaidError(
      payload.error ?? `http_${res.status}`,
      payload.error_description ?? "แลก authorization code กับ ThaiD ไม่สำเร็จ",
    );
  }
  return payload as unknown as TokenResponse;
}

/**
 * token ที่ยืนยันเสร็จแล้วไม่มีประโยชน์กับระบบนี้อีก — ยกเลิกทิ้ง แต่ไม่ให้พัง flow
 *
 * `token_type_hint` เป็น OPTIONAL ตาม RFC 7009 §2.1 แต่ส่งไปช่วยให้ฝั่ง IdP
 * ค้นถูกตารางตั้งแต่ครั้งแรก และสเปกบอกว่าห้ามปฏิเสธเพราะ hint ผิด
 */
export async function revokeToken(
  token: string,
  hint: "access_token" | "refresh_token" = "access_token",
): Promise<void> {
  try {
    await postForm("/api/v2/oauth2/revoke/", { token, token_type_hint: hint });
  } catch (err) {
    console.warn(
      `[thaid] revoke ${hint} ไม่สำเร็จ (ข้ามไป):`,
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * คืน token ทุกใบที่ ThaiD ออกให้รอบนี้
 *
 * RFC 7009 §2.1 บอกว่าการเพิกถอน refresh token *ควร* ทำให้ access token ที่ออกจาก
 * ใบเดียวกันตายตามไปด้วย แต่ "ควร" ไม่ใช่ "ต้อง" และเราไม่รู้ว่ากรมการปกครองทำแบบไหน
 * จึงส่งทั้งสองใบ ไม่ใช่ใบเดียวแล้วหวังผลพลอยได้
 *
 * ทำขนานกันเพราะไม่มีใครรอผลอยู่ และ error ถูกกลืนใน revokeToken() อยู่แล้ว
 */
export async function revokeIssuedTokens(token: TokenResponse): Promise<void> {
  await Promise.all([
    revokeToken(token.access_token, "access_token"),
    ...(token.refresh_token ? [revokeToken(token.refresh_token, "refresh_token")] : []),
  ]);
}

// ---------------------------------------------------------------- id_token

interface Jwk extends JsonWebKey {
  kid?: string;
}

let jwksCache: { keys: Jwk[]; fetchedAt: number } | null = null;
const JWKS_TTL_MS = 60 * 60 * 1000;

/**
 * ดึง JWKS แล้วแคชไว้ 1 ชั่วโมง
 *
 * กรมการปกครองหมุนคีย์เป็นระยะและ JWKS มีหลายคีย์พร้อมกัน จึงเลือกตาม `kid`
 * ถ้าเจอ kid ที่ไม่รู้จักให้ล้างแคชแล้วดึงใหม่หนึ่งครั้ง ไม่ใช่ปฏิเสธทันที
 */
async function fetchJwks(force = false): Promise<Jwk[]> {
  if (!force && jwksCache && Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS) {
    return jwksCache.keys;
  }
  const res = await fetch(`${env.thaid.rootUrl}/jwks/`);
  if (!res.ok) throw new ThaidError("jwks_unavailable", "ดึงกุญแจสาธารณะของ ThaiD ไม่สำเร็จ");
  const body = (await res.json()) as { keys?: Jwk[] };
  jwksCache = { keys: body.keys ?? [], fetchedAt: Date.now() };
  return jwksCache.keys;
}

async function publicKeyFor(kid: string | undefined): Promise<KeyObject> {
  for (const force of [false, true]) {
    const keys = await fetchJwks(force);
    const jwk = kid ? keys.find((k) => k.kid === kid) : keys[0];
    if (jwk) return createPublicKey({ key: jwk, format: "jwk" });
  }
  throw new ThaidError("unknown_kid", "ไม่พบกุญแจสาธารณะที่ตรงกับลายเซ็นของ id_token");
}

type IdTokenClaims = Record<string, unknown> & { sub?: string; pid?: string; nonce?: string };

export async function verifyIdToken(idToken: string): Promise<IdTokenClaims> {
  const decoded = jwt.decode(idToken, { complete: true });
  if (!decoded || typeof decoded.payload === "string") {
    throw new ThaidError("invalid_id_token", "id_token ที่ได้รับจาก ThaiD อ่านไม่ได้");
  }

  const key = await publicKeyFor(decoded.header.kid);
  try {
    return jwt.verify(idToken, key, {
      algorithms: ["ES256"],
      audience: env.thaid.clientId,
      issuer: env.thaid.rootUrl,
      clockTolerance: 60,
    }) as IdTokenClaims;
  } catch (err) {
    throw new ThaidError(
      "invalid_id_token",
      `ตรวจสอบลายเซ็น id_token ไม่ผ่าน: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/**
 * แปลง claim เป็นรูปที่ระบบนี้ใช้
 *
 * เมื่อขอ scope `openid` ข้อมูลทั้งหมดอยู่ใน id_token (คู่มือ §6.2.2) แต่ token response
 * ก็แนบ scope value มาตรง ๆ ได้เหมือนกันเมื่อไม่ได้ขอ openid — รับทั้งสองทางไว้
 *
 * เลขบัตรมาจาก claim ที่ `THAID_USE_PID` เลือกไว้ และ **ต้องผ่าน checksum ก่อนถึงจะนับ**
 * ถ้าไม่ผ่านให้เป็น null ปลายทางจะปฏิเสธการยืนยันตัวตนแทนที่จะเอาไปเทียบแล้วได้ "ไม่ตรง"
 * — ค่าทึบที่ IdP บางเจ้าใส่มาใน `sub` ไม่ใช่ความผิดของผู้ใช้ จะไปยกเลิกคีย์เขาไม่ได้
 */
export function toIdentity(claims: IdTokenClaims, fallback: Record<string, unknown> = {}): ThaidIdentity {
  const pick = (name: string) => asString(claims[name]) ?? asString(fallback[name]);
  const subject = pick("sub");
  if (!subject) throw new ThaidError("invalid_id_token", "id_token ไม่มี sub");

  const claimed = env.thaid.usePid ? pick("pid") : subject;

  return {
    pid: claimed && isValidThaiNationalId(claimed) ? claimed.replace(/\D/g, "") : null,
    subject,
    titleTh: pick("title"),
    givenNameTh: pick("given_name"),
    familyNameTh: pick("family_name"),
    nameTh: pick("name"),
    nameEn: pick("name_en"),
  };
}

/**
 * เทียบ claim `nonce` กับค่าที่ส่งไปตอน authorize
 *
 * **claim ที่หายไปกับ claim ที่ไม่ตรง คนละเรื่องกัน**
 *   ไม่ตรง  → ปฏิเสธเสมอ id_token ใบนี้ไม่ได้ออกให้คำขอของเรา
 *   ไม่มีมา → กรมการปกครองไม่ได้สะท้อน nonce กลับมา ซึ่งเป็นข้อจำกัดฝั่งเขา ไม่ใช่การโจมตี
 *             ปฏิเสธก็เท่ากับพังการยืนยันตัวตนทั้งระบบเพราะของที่สเปกเรียกว่า RECOMMENDED
 *             จึงเตือนใน log แล้วไปต่อ จนกว่าจะยืนยันได้ว่าเขาสะท้อนกลับมาจริง
 *             (ตั้ง THAID_REQUIRE_NONCE=true แล้วจะกลายเป็นบังคับ)
 *
 * เทียบแบบคงเวลาไม่จำเป็นที่นี่ — ผู้เทียบไม่ได้ป้อนค่าทีละตัวเพื่อวัดเวลา และค่าที่ถูก
 * เทียบเป็นค่าสุ่มที่หมดอายุใน 15 นาทีอยู่แล้ว
 */
function checkNonce(claims: IdTokenClaims, expected: string | null): void {
  const received = asString(claims.nonce);

  if (!received) {
    if (env.thaid.requireNonce) {
      throw new ThaidError("nonce_missing", "id_token จาก ThaiD ไม่มี claim nonce");
    }
    console.warn("[thaid] id_token ไม่มี claim nonce — ThaiD สะท้อน nonce กลับมาหรือไม่?");
    return;
  }
  if (!expected) {
    // แถวเก่าที่เปิดไว้ก่อน deploy รุ่นนี้ ยังไม่มี nonce เก็บไว้ให้เทียบ
    console.warn("[thaid] ได้ claim nonce กลับมาแต่คำขอนี้ไม่ได้บันทึก nonce ไว้ — ข้ามการเทียบ");
    return;
  }
  if (received !== expected) {
    throw new ThaidError("nonce_mismatch", "nonce ใน id_token ไม่ตรงกับคำขอที่เริ่มไว้");
  }
}

/**
 * เรียก ThaiD ครบขั้นตอน: code → token → ตรวจ nonce → identity
 * แล้วยกเลิก token ทุกใบที่เขาออกให้ เพราะไม่ได้ใช้ต่อ
 */
export async function resolveIdentity(
  code: string,
  expectedNonce: string | null,
): Promise<ThaidIdentity> {
  const token = await exchangeCode(code);
  if (!token.id_token) {
    throw new ThaidError("no_id_token", "ThaiD ไม่ได้ส่ง id_token กลับมา (scope openid หายไปหรือไม่?)");
  }

  /**
   * คำถามที่ยังค้าง: ThaiD ออก refresh_token มาด้วยหรือไม่ — `TokenResponse` ประกาศไว้
   * เป็น optional ตามสเปก แต่ยังไม่เคยเห็นค่าจริง บันทึกไว้ใน log ตอนยิงจริงจะได้รู้
   * (ไม่ log ตัว token — แค่ว่ามีหรือไม่มี)
   */
  console.info(`[thaid] token response: refresh_token ${token.refresh_token ? "มี" : "ไม่มี"}`);

  const claims = await verifyIdToken(token.id_token);
  // คืน token ก่อนตรวจ nonce — ใบที่เราปฏิเสธก็ไม่มีเหตุผลให้มีชีวิตต่อฝั่งกรมการปกครอง
  void revokeIssuedTokens(token);

  checkNonce(claims, expectedNonce);
  return toIdentity(claims, token as unknown as Record<string, unknown>);
}
