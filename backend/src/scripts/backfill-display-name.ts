/**
 * เขียน `iam.user_account.display_name` ใหม่จากชื่อไทยของแต่ละบัญชี
 *
 * ที่มา: Feedback 20260904 #2 → Bugs ข้อ 1 — ผู้ใช้แจ้งว่าชื่อบนตราลงนามไม่ตรงกับชื่อ
 * บนแถบหัว ต้นเหตุคือ `display_name` ถูกเขียนไว้ตอนสร้างบัญชีแล้วไม่มีใครดูแลต่อ ส่วน
 * โค้ดที่แสดงชื่อบางที่อ่านคอลัมน์นี้ บางที่ประกอบจาก `prefix_th`/`firstname_th`/
 * `lastname_th` เอง ตั้งแต่ 2026-09-06 ทุกที่ประกอบขึ้นใหม่เสมอ (ดู lib/person-name.ts)
 * สคริปต์นี้ทำให้คอลัมน์ที่ยังเหลืออยู่ — ซึ่งการค้นหาผู้ใช้ของแอดมินอ่าน — ตรงตามนั้น
 *
 * **บัญชีที่ไม่มีชื่อไทยจะได้ค่าว่าง ไม่ใช่อีเมล** ตามที่ตกลงกันไว้ อีเมลใน `display_name`
 * คือทางที่อีเมลไปโผล่บนเอกสารข้อตกลงในฐานะ "ชื่อผู้ลงนาม" ได้ สคริปต์พิมพ์รายชื่อแถว
 * ที่ถูกล้างออกมาให้ดูทุกครั้ง เพราะมันคือรายการที่ต้องตามเก็บ ไม่ใช่ผลข้างเคียงที่มองข้ามได้
 *
 * รันซ้ำได้ ไม่เปลี่ยนอะไรถ้าค่าตรงอยู่แล้ว
 *
 *   docker compose exec backend npm run backfill:display-name          # ดูอย่างเดียว
 *   docker compose exec backend npm run backfill:display-name -- --write
 */
import { prisma } from "../db.js";
import { fullNameTh } from "../lib/person-name.js";
import { SYSTEM_USER_ID } from "../lib/system.js";

const write = process.argv.includes("--write");

async function main() {
  /**
   * บัญชี SYSTEM ไม่มีชื่อไทยและไม่ควรมี — `display_name` ของมันคือคำว่า "ระบบ"
   * ที่ `seed:masters` ตั้งไว้ตั้งใจ เพื่อให้ audit log อ่านได้ว่าใครเป็นคนทำรายการนี้
   * ถ้าไม่ยกเว้น สคริปต์นี้จะล้างมันเป็นค่าว่างทุกครั้งที่รัน
   */
  const accounts = await prisma.userAccount.findMany({
    where: { id: { not: SYSTEM_USER_ID } },
    select: {
      id: true,
      email: true,
      status: true,
      displayName: true,
      prefixTh: true,
      firstnameTh: true,
      lastnameTh: true,
    },
    orderBy: { email: "asc" },
  });

  const changes = accounts
    .map((a) => ({ account: a, next: fullNameTh(a) }))
    .filter(({ account, next }) => account.displayName !== next);

  const blanked = changes.filter(({ next }) => next === "");
  const rewritten = changes.filter(({ next }) => next !== "");

  console.log(`บัญชีทั้งหมด ${accounts.length} แถว · ต้องแก้ ${changes.length} แถว`);

  if (rewritten.length > 0) {
    console.log(`\nเขียนชื่อใหม่ ${rewritten.length} แถว`);
    for (const { account, next } of rewritten) {
      console.log(`  ${account.email}\n    ${JSON.stringify(account.displayName)} -> ${JSON.stringify(next)}`);
    }
  }

  if (blanked.length > 0) {
    console.log(`\nล้างเป็นค่าว่าง ${blanked.length} แถว — บัญชีพวกนี้ยังไม่มีชื่อไทย`);
    console.log("ถ้าบัญชีไหนสถานะ ACTIVE แปลว่ามีอะไรผิดปกติ ผู้ที่ activate แล้วต้องมีชื่อครบเสมอ");
    for (const { account } of blanked) {
      console.log(`  ${account.email} · ${account.status} · เดิม ${JSON.stringify(account.displayName)}`);
    }
  }

  if (!write) {
    console.log("\n(ดูอย่างเดียว — ใส่ --write เพื่อเขียนจริง)");
    return;
  }

  for (const { account, next } of changes) {
    await prisma.userAccount.update({ where: { id: account.id }, data: { displayName: next } });
  }
  console.log(`\nเขียนแล้ว ${changes.length} แถว`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
