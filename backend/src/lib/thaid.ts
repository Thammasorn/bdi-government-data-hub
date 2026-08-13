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

/** ข้อมูลผู้ใช้ที่ ThaiD ส่งกลับมา — เก็บเฉพาะที่ระบบนี้ใช้ */
export interface ThaidIdentity {
  /** เลขประจำตัวประชาชน 13 หลัก มีเฉพาะเมื่อ client ได้รับสิทธิ์ scope `pid` */
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
export function authorizeUrl(state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: env.thaid.clientId,
    redirect_uri: env.thaid.redirectUri,
    scope: env.thaid.scope,
    state,
  });
  return `${env.thaid.rootUrl}/api/v2/oauth2/auth/?${params.toString()}`;
}

export function generateState(): string {
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

/** token ที่ยืนยันเสร็จแล้วไม่มีประโยชน์กับระบบนี้อีก — ยกเลิกทิ้ง แต่ไม่ให้พัง flow */
export async function revokeToken(token: string): Promise<void> {
  try {
    await postForm("/api/v2/oauth2/revoke/", { token });
  } catch (err) {
    console.warn("[thaid] revoke ไม่สำเร็จ (ข้ามไป):", err instanceof Error ? err.message : err);
  }
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

type IdTokenClaims = Record<string, unknown> & { sub?: string; pid?: string };

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
 */
export function toIdentity(claims: IdTokenClaims, fallback: Record<string, unknown> = {}): ThaidIdentity {
  const pick = (name: string) => asString(claims[name]) ?? asString(fallback[name]);
  const subject = pick("sub");
  if (!subject) throw new ThaidError("invalid_id_token", "id_token ไม่มี sub");

  return {
    pid: pick("pid"),
    subject,
    titleTh: pick("title"),
    givenNameTh: pick("given_name"),
    familyNameTh: pick("family_name"),
    nameTh: pick("name"),
    nameEn: pick("name_en"),
  };
}

/**
 * เรียก ThaiD ครบขั้นตอน: code → token → identity
 * แล้วยกเลิก access token ทิ้ง เพราะไม่ได้ใช้ต่อ
 */
export async function resolveIdentity(code: string): Promise<ThaidIdentity> {
  const token = await exchangeCode(code);
  if (!token.id_token) {
    throw new ThaidError("no_id_token", "ThaiD ไม่ได้ส่ง id_token กลับมา (scope openid หายไปหรือไม่?)");
  }
  const claims = await verifyIdToken(token.id_token);
  const identity = toIdentity(claims, token as unknown as Record<string, unknown>);
  void revokeToken(token.access_token);
  return identity;
}
