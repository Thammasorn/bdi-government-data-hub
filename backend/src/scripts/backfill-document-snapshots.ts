/**
 * บันทึกชุดเอกสารให้คำขอที่นำส่งไปแล้วก่อนจะมี `legal.request_document_snapshot`
 *
 * ที่มา: card "Enhance Legal document management" ข้อ 1 — คำขอต้องถือเอกสารเวอร์ชันที่ตัวเองนำส่งไปตลอดเรื่อง migration สร้างตารางอย่างเดียว
 * คำขอที่ค้างอยู่ในระบบจริงต้องมีคนสั่งบันทึกชุดให้ ไม่อย่างนั้นยังตามเวอร์ชันล่าสุดต่อไป (`documentsForRequest()` ตกกลับแบบนั้นเอง
 * จึงไม่พังถ้ายังไม่ได้รัน)
 *
 * ต่อฉบับ ใช้เวอร์ชันที่คำขอนั้นเคยรับไว้ใน `legal_acceptance` ก่อน ถ้าไม่เคยรับ ใช้เวอร์ชันที่เผยแพร่อยู่ตอนนี้ — ดู `pinSubmittedRequest()`
 *
 * **รอบแรกพิมพ์รายงานอย่างเดียว ไม่เขียนอะไร** รายงานบอกจำนวนคำขอต่อ scope ต่อสถานะ ชุดเอกสารที่จะบันทึก และคำขอที่จะถือเวอร์ชันเก่ากว่า
 * ล่าสุด (เพราะรับไว้แล้ว) ให้เจ้าของระบบดูก่อนแล้วจึงใส่ --write บน production
 *
 * รันซ้ำได้ — คำขอที่มี snapshot แล้วถูกข้าม ไม่เขียนทับ
 *
 *   docker compose exec backend npm run backfill:document-snapshots          # ดูอย่างเดียว
 *   docker compose exec backend npm run backfill:document-snapshots -- --write
 *   docker compose exec backend npm run backfill:document-snapshots:prod -- --write   # main (production build)
 */
import { RequestStatus } from "@prisma/client";

import { prisma } from "../db.js";
import { LEGAL_SCOPES, SUBJECT_OF_SCOPE, pinSubmittedRequest, type LegalScope } from "../lib/legal.js";

const write = process.argv.includes("--write");

interface Candidate {
  id: string;
  label: string;
  status: RequestStatus;
}

/** ที่นำส่งไปแล้ว = ไม่ใช่ฉบับร่างหรือถูกส่งกลับ (สองสถานะนั้นยังอ่านเวอร์ชันล่าสุดจนกว่าจะนำส่งอีกครั้ง) และเคยนำส่งจริง */
const SUBMITTED_STATUSES = [
  RequestStatus.SUBMITTED,
  RequestStatus.UNDER_REVIEW,
  RequestStatus.APPROVED,
  RequestStatus.REJECTED,
  RequestStatus.CANCELLED,
];

async function candidates(scope: LegalScope): Promise<Candidate[]> {
  if (scope === LEGAL_SCOPES.ORGANIZATION_REGISTRATION) {
    const rows = await prisma.organizationRegistrationRequest.findMany({
      where: { status: { in: SUBMITTED_STATUSES }, submittedAt: { not: null } },
      select: { id: true, requestNumber: true, status: true },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((r) => ({ id: r.id, label: r.requestNumber ?? r.id, status: r.status }));
  }
  const rows = await prisma.datasetRegistrationRequest.findMany({
    where: { status: { in: SUBMITTED_STATUSES }, submittedAt: { not: null } },
    select: { id: true, requestNumber: true, status: true },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => ({ id: r.id, label: r.requestNumber ?? r.id, status: r.status }));
}

async function main() {
  let total = 0;
  let pinned = 0;

  for (const scope of Object.values(LEGAL_SCOPES)) {
    const subjectType = SUBJECT_OF_SCOPE[scope];
    const rows = await candidates(scope);
    console.log(`\n== ${scope} — คำขอที่นำส่งแล้ว ${rows.length} ใบ`);

    const byStatus = new Map<RequestStatus, number>();
    const versionCount = new Map<string, number>();
    const pinnedOlder: string[] = [];
    let skipped = 0;
    let scopePinned = 0;

    for (const request of rows) {
      total += 1;
      const subject = { subjectType, subjectId: request.id };
      const existing = await prisma.requestDocumentSnapshot.count({ where: subject });
      if (existing > 0) {
        skipped += 1;
        continue;
      }
      const picks = await prisma.$transaction((tx) => pinSubmittedRequest(tx, scope, subject, { write }));
      pinned += 1;
      scopePinned += 1;
      byStatus.set(request.status, (byStatus.get(request.status) ?? 0) + 1);
      for (const p of picks) {
        const key = `${p.code} v${p.versionNumber}${p.accepted ? " (ที่รับไว้)" : ""}`;
        versionCount.set(key, (versionCount.get(key) ?? 0) + 1);
        if (p.latestVersionNumber !== null && p.versionNumber < p.latestVersionNumber) {
          pinnedOlder.push(`${request.label} ${p.code} v${p.versionNumber} (ล่าสุด v${p.latestVersionNumber})`);
        }
      }
    }

    console.log(`  มี snapshot แล้ว (ข้าม) ${skipped} · ${write ? "บันทึก" : "จะบันทึก"} ${scopePinned} ใบ`);
    for (const [status, n] of [...byStatus.entries()].sort()) console.log(`    ${status}: ${n}`);
    console.log("  เอกสาร/เวอร์ชันที่ถูกผูก:");
    for (const [key, n] of [...versionCount.entries()].sort()) console.log(`    ${key}: ${n} ใบ`);
    if (pinnedOlder.length > 0) {
      console.log(`  ถือเวอร์ชันเก่ากว่าล่าสุด ${pinnedOlder.length} รายการ (หน่วยงานรับเวอร์ชันนั้นไปแล้ว):`);
      for (const line of pinnedOlder) console.log(`    ${line}`);
    }
  }

  console.log(`\nรวมคำขอที่นำส่งแล้ว ${total} ใบ · ${write ? "บันทึกแล้ว" : "จะบันทึก"} ${pinned} ใบ`);
  if (!write) console.log("(ดูอย่างเดียว — ใส่ --write เพื่อเขียนจริง)");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
