// ตรวจ API ของการ์ด "[Enhance] Legal Document Management" กับ checkout ที่รันอยู่
//
//   node docs/tools/legal-reacceptance-api-check.mjs        (รันจากราก checkout)
//
// ต้องเริ่มจากข้อมูลใหม่ทุกครั้ง: seed:masters → seed:demo → seed:legal-reacceptance แล้ว restart backend
// สคริปต์เปลี่ยนสถานะข้อมูล (ลงนาม อนุมัติ ขอ A3) จึงรันซ้ำบนข้อมูลเดิมไม่ได้
import { execSync } from "node:child_process";

const BASE = process.env.API ?? "http://localhost:4500";
const DIR = process.env.PROJECT_DIR ?? process.cwd();
const PASSWORD = "bdi12345";
const CONFIRM = "ข้าพเจ้าได้พิจารณาข้อตกลงนี้แล้ว และมีเจตนาลงนามด้วยวิธีอิเล็กทรอนิกส์";
const ATTEST = "ข้าพเจ้าได้อ่านเอกสารฉบับนี้ครบถ้วนแล้ว";

const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};
const compose = (args) => execSync(`docker compose ${args}`, { cwd: DIR, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const psql = (sql) => compose(`exec -T postgres psql -U bdi -d bdi -At -c ${JSON.stringify(sql)}`).trim();
const otpLines = () => compose("logs delivery-worker").split("\n").filter((l) => l.includes("รหัส OTP:"));

async function login(email) {
  const before = otpLines().length;
  await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  let code = null;
  for (let i = 0; i < 40 && !code; i += 1) {
    await new Promise((r) => setTimeout(r, 500));
    const lines = otpLines();
    if (lines.length > before) code = lines.at(-1).match(/(\d{6})/)?.[1] ?? null;
  }
  if (!code) throw new Error(`ไม่พบ OTP ของ ${email}`);
  const res = await fetch(`${BASE}/api/auth/login/verify-otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, code }),
  });
  if (!res.ok) throw new Error(`verify ${email}: ${res.status}`);
  return res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}

async function call(cookie, method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...(cookie ? { cookie } : {}), ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* PDF */
  }
  return { status: res.status, json, type: res.headers.get("content-type") };
}

const signBody = (versionId, attest = true) => ({
  acknowledgements: [{ versionId, attestedAt: new Date().toISOString() }],
  notApplicable: [],
  ...(attest ? { attestationText: ATTEST } : {}),
  confirmationText: CONFIRM,
});

async function main() {
  const nsoApprover = await login("director@nso.go.th");
  const nsoUser = await login("user@nso.go.th");
  const dopaApprover = await login("director@dopa.go.th");
  const bdiApprover = await login("approver@bdi.or.th");
  const bdiOfficer = await login("officer@bdi.or.th");

  // A. ล็อกหลัง BDI เผยแพร่
  const pending = (await call(nsoApprover, "GET", "/api/legal-status?tab=pending")).json;
  const a0 = pending?.rows.find((r) => r.documentCode === "A0");
  const a2 = pending?.rows.find((r) => r.documentCode === "A2");
  check("A1 หน่วยงานเห็นงานรอ 2 งาน (A0, A2)", pending?.rows.length === 2 && Boolean(a0?.pending && a2?.pending), `rows=${pending?.rows.length}`);
  check("A2 access_status ล็อก", psql("select access_status from organization.organization where name_th='สำนักงานสถิติแห่งชาติ'") === "LEGAL_DOCS_UPDATE_REQUIRED");
  const create = await call(nsoUser, "POST", "/api/dataset-requests", {});
  check("A3 สร้างคำขอชุดข้อมูลไม่ได้ (409)", create.status === 409 && create.json?.error === "legal_docs_update_required", `status=${create.status}`);
  const elig = await call(nsoUser, "GET", "/api/dataset-requests/eligibility");
  check("A4 eligibility บอกเหตุผลเรื่องเอกสารกฎหมาย", elig.json?.eligible === false && /เอกสารกฎหมาย/.test(elig.json?.reason ?? ""), elig.json?.reason ?? "");

  // B. การมองเห็น
  const all = await call(nsoUser, "GET", "/api/legal-status");
  check("B1 ผู้ใช้หน่วยงานเห็นเฉพาะหน่วยงานตัวเอง และเห็น A3 ที่ข้ามไว้", all.json?.seesAll === false && all.json.rows.every((r) => r.organizationName === "สำนักงานสถิติแห่งชาติ") && all.json.rows.some((r) => r.documentCode === "A3" && !r.currentVersion));
  const bdiList = await call(bdiOfficer, "GET", "/api/legal-status");
  check("B2 เจ้าหน้าที่ BDI เห็นทุกหน่วยงาน", bdiList.json?.seesAll === true && bdiList.json.total >= 3, `total=${bdiList.json?.total}`);
  const options = await call(bdiOfficer, "GET", "/api/legal-status/options");
  check("B3 ตัวเลือกตัวกรอง: เอกสาร A0–A3 และหน่วยงาน", options.json?.documents?.length === 4 && options.json?.organizations?.length >= 1);
  const filtered = await call(bdiOfficer, "GET", `/api/legal-status?documentId=${a0.documentId}`);
  check("B4 กรองตามเอกสาร", filtered.json?.rows.every((r) => r.documentCode === "A0"));
  const cross = await call(dopaApprover, "GET", `/api/legal-status/approvals/${a0.pending.approvalId}`);
  check("B5 หน่วยงานอื่นเปิดงานลงนามของ NSO ไม่ได้ (404)", cross.status === 404, `status=${cross.status}`);
  const anon = await call(null, "GET", "/api/legal-status");
  check("B6 ไม่ได้ล็อกอิน (401)", anon.status === 401);

  // C. ลงนามของหน่วยงาน
  const detail = (await call(nsoApprover, "GET", `/api/legal-status/approvals/${a0.pending.approvalId}`)).json;
  check("C1 รายละเอียด: ผู้มีอำนาจลงนามได้ และมีลำดับขั้น 3 ขั้น", detail?.canSign === true && detail?.progress?.steps?.length === 3, `steps=${detail?.progress?.steps?.length}`);
  const pdf = await call(nsoApprover, "GET", detail.document.fileUrl);
  check("C2 PDF ของ A0 เวอร์ชันใหม่ (เติมข้อมูลหน่วยงาน)", pdf.status === 200 && pdf.type === "application/pdf", `status=${pdf.status}`);
  check("C3 ผู้ใช้หน่วยงานลงนามไม่ได้ (403)", (await call(nsoUser, "POST", `/api/legal-status/approvals/${a0.pending.approvalId}/sign`, signBody(detail.document.versionId))).status === 403);
  check("C4 ผู้มีอำนาจของหน่วยงานอื่นลงนามไม่ได้ (403)", (await call(dopaApprover, "POST", `/api/legal-status/approvals/${a0.pending.approvalId}/sign`, signBody(detail.document.versionId))).status === 403);
  check("C5 ไม่ติ๊กอ่าน = 400", (await call(nsoApprover, "POST", `/api/legal-status/approvals/${a0.pending.approvalId}/sign`, signBody(detail.document.versionId, false))).status === 400);
  const stale = await call(nsoApprover, "POST", `/api/legal-status/approvals/${a0.pending.approvalId}/sign`, signBody("00000000-0000-0000-0000-000000000000"));
  check("C6 เวอร์ชันไม่ตรงกับงาน = 400 stale_documents", stale.status === 400 && stale.json?.error === "stale_documents");
  const sign = await call(nsoApprover, "POST", `/api/legal-status/approvals/${a0.pending.approvalId}/sign`, signBody(detail.document.versionId));
  check("C7 ลงนาม A0 → รอ BDI อนุมัติ", sign.status === 200 && sign.json?.status === "PENDING_BDI_APPROVAL", `status=${sign.status}`);
  check("C8 ลงนามซ้ำ = 409", (await call(nsoApprover, "POST", `/api/legal-status/approvals/${a0.pending.approvalId}/sign`, signBody(detail.document.versionId))).status === 409);

  // D. อนุมัติของ BDI และปลดล็อก
  check("D1 เจ้าหน้าที่ BDI อนุมัติไม่ได้ (403)", (await call(bdiOfficer, "POST", `/api/legal-status/approvals/${a0.pending.approvalId}/approve`, signBody(detail.document.versionId, false))).status === 403);
  const approveA0 = await call(bdiApprover, "POST", `/api/legal-status/approvals/${a0.pending.approvalId}/approve`, signBody(detail.document.versionId, false));
  check("D2 BDI อนุมัติ A0 — ยังล็อกเพราะ A2 ค้าง", approveA0.status === 200 && approveA0.json?.unlocked === false, JSON.stringify(approveA0.json));
  const d2 = (await call(nsoApprover, "GET", `/api/legal-status/approvals/${a2.pending.approvalId}`)).json;
  await call(nsoApprover, "POST", `/api/legal-status/approvals/${a2.pending.approvalId}/sign`, signBody(d2.document.versionId));
  const approveA2 = await call(bdiApprover, "POST", `/api/legal-status/approvals/${a2.pending.approvalId}/approve`, signBody(d2.document.versionId, false));
  check("D3 BDI อนุมัติ A2 — ปลดล็อก", approveA2.status === 200 && approveA2.json?.unlocked === true);
  check("D4 access_status = ACTIVE", psql("select access_status from organization.organization where name_th='สำนักงานสถิติแห่งชาติ'") === "ACTIVE");
  const after = await call(nsoUser, "POST", "/api/dataset-requests", {});
  check("D5 หลังปลดล็อกไม่ถูกบล็อกด้วยเหตุกฎหมาย", after.json?.error !== "legal_docs_update_required", `status=${after.status}`);
  const history = (await call(nsoUser, "GET", `/api/legal-status/${a0.organizationId}/${a0.documentId}/history?page=1&pageSize=5`)).json;
  const active = history?.rows.find((r) => r.status === "ACTIVE");
  // เวอร์ชันที่เพิ่งลงนามมาจากงาน ไม่ใช่เลขตายตัว — seed ใช้เวอร์ชันลงนามซ้ำที่มีอยู่แล้วถ้ามี (เลขขึ้นกับการทดสอบรอบก่อน)
  check(`D6 ประวัติ: เวอร์ชัน ${detail.document.displayVersionNumber} เปิดใช้งาน มีชื่อผู้มีอำนาจทั้งสองฝ่าย และเวอร์ชันเดิมถูกแทนที่`, active?.versionDisplay === detail.document.displayVersionNumber && Boolean(active?.orgApproverName && active?.bdiApproverName) && history.rows.some((r) => r.status === "SUPERSEDED"), JSON.stringify(history?.rows.map((r) => [r.versionDisplay, r.status])));

  // E. ขอเข้าร่วม A3 — สร้างงานและลงนามในคราวเดียว (POST /join) · ยกเลิกกล่องลงนาม = ไม่มีอะไรถูกบันทึก
  const a3 = psql("select id from legal.legal_document where document_code='A3'");
  const joinInfo = (await call(nsoApprover, "GET", `/api/legal-status/${a0.organizationId}/${a3}/detail`)).json;
  check("E0 ผู้มีอำนาจเห็นปุ่มขอเข้าร่วมพร้อมเอกสารเวอร์ชันล่าสุด", joinInfo?.canRequest === true && Boolean(joinInfo?.joinDocument?.versionId));
  const joinBody = (documentId, versionId) => ({ documentId, ...signBody(versionId) });
  check("E1 ผู้ใช้หน่วยงานขอ A3 ไม่ได้ (403 ดูอย่างเดียว)", (await call(nsoUser, "POST", "/api/legal-status/join", joinBody(a3, joinInfo?.joinDocument?.versionId))).status === 403);
  const req = await call(nsoApprover, "POST", "/api/legal-status/join", joinBody(a3, joinInfo?.joinDocument?.versionId));
  const joined = req.json?.approvalId ? (await call(nsoApprover, "GET", `/api/legal-status/approvals/${req.json.approvalId}`)).json : null;
  check("E2 ผู้มีอำนาจขอเข้าร่วม A3 และลงนามในครั้งเดียว → รอ BDI อนุมัติ (201)", req.status === 201 && joined?.approval?.status === "PENDING_BDI_APPROVAL", `status=${req.status} ${req.json?.error ?? ""} ${joined?.approval?.status ?? ""}`);
  check("E3 การขอ A3 ไม่ล็อกหน่วยงาน", psql("select access_status from organization.organization where name_th='สำนักงานสถิติแห่งชาติ'") === "ACTIVE");
  check("E4 ขอ A3 ซ้ำ = 409", (await call(nsoApprover, "POST", "/api/legal-status/join", joinBody(a3, joinInfo?.joinDocument?.versionId))).status === 409);
  const a1 = psql("select id from legal.legal_document where document_code='A1'");
  check("E5 ขอ A1 (บังคับ) = 409", (await call(nsoApprover, "POST", "/api/legal-status/join", joinBody(a1, joinInfo?.joinDocument?.versionId))).status === 409);

  // F. คำขอลงทะเบียนที่ถูกย้อนกลับ
  const reopened = psql("select r.id from organization.organization_registration_request r where r.request_number='ORG-REG-2026-0004'");
  const reg = await call(dopaApprover, "GET", `/api/organizations/${reopened}`);
  check("F1 คำขอที่ผ่านผู้มีอำนาจแล้วถูกย้อนกลับ + legalDocsChanged", reg.json?.organization?.legalDocsChanged === true, `flag=${reg.json?.organization?.legalDocsChanged}`);
  const snapshots = psql("select max(submission_no) from legal.request_document_snapshot where subject_id=(select id from organization.organization_registration_request where request_number='ORG-REG-2026-0003')");
  check("F2 คำขอที่ยังไม่ผ่านผู้มีอำนาจได้ชุดเอกสารใหม่ (snapshot > 1)", Number(snapshots) > 1, `submission_no=${snapshots}`);

  // G. อีเมล
  const mail = compose("logs delivery-worker");
  for (const subject of ["มีเอกสารกฎหมายเวอร์ชันใหม่ รอผู้มีอำนาจอนุมัติ", "กรุณาอนุมัติเอกสารกฎหมายเวอร์ชันใหม่", "รอ BDI อนุมัติ:", "เสร็จสมบูรณ์", "กลับมาใช้งานได้ตามปกติ", "เอกสารมีการเปลี่ยนแปลง ต้องอนุมัติใหม่อีกครั้ง"]) {
    check(`G อีเมล "${subject}"`, mail.includes(subject));
  }

  const failed = results.filter((ok) => !ok).length;
  console.log(`\n${results.length - failed}/${results.length} ผ่าน`);
  if (failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
