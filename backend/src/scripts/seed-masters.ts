/**
 * Seed master data — รันได้ซ้ำ (idempotent) และต้องรันก่อน seed:demo เสมอ
 *
 *   - iam.user_account แถว SYSTEM หนึ่งแถว (ผู้กระทำสำหรับ created_by/updated_by ของ master data)
 *   - iam.role ทั้งเจ็ดตาม sheet `role`
 *   - administration.province / district / sub_district จาก backend/src/data/thai-address.json
 *
 * เรื่องรหัสที่อยู่: draft_db_design ใช้ province_code / district_code / sub_district_code
 * แต่ไม่มี sheet ของตาราง master (schema `administration` ยังไม่มี sheet) และ
 * thai-address.json ที่ vendor ไว้มีแต่ "ชื่อ" ไม่มีรหัส
 * → สคริปต์นี้ออกรหัสให้เองแบบเสถียร: จังหวัด 2 หลัก · อำเภอ 4 หลัก · ตำบล 6 หลัก
 *   (รูปทรงเดียวกับ TIS-1099 เพื่อให้เปลี่ยนไปใช้รหัสจริงเป็นแค่การแทนที่ข้อมูล ไม่ต้องแก้สคีมา)
 * **ยังไม่ใช่รหัสราชการจริง** — ดู docs/06-db-migration-plan.md §5 ข้อ 6
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { PrismaClient } from "@prisma/client";
import { AccountType, LegalDocumentStatus, OrganizationStatus, UserAccountStatus } from "@prisma/client";

import { listProvinces, listAmphoes, listSubdistricts } from "../lib/address.js";
import { publishVersion } from "../lib/legal.js";
import {
  BDI_ORGANIZATION_CODE,
  BDI_ORGANIZATION_ID,
  ROLE_DEFINITIONS,
  SYSTEM_USER_EMAIL,
  SYSTEM_USER_ID,
} from "../lib/system.js";

const prisma = new PrismaClient();

const pad = (n: number, width: number) => String(n).padStart(width, "0");

async function seedSystemUser() {
  await prisma.userAccount.upsert({
    where: { id: SYSTEM_USER_ID },
    update: {},
    create: {
      id: SYSTEM_USER_ID,
      email: SYSTEM_USER_EMAIL,
      displayName: "ระบบ",
      accountType: AccountType.SYSTEM,
      status: UserAccountStatus.ACTIVE,
      activatedAt: new Date(),
      createdBy: SYSTEM_USER_ID,
      updatedBy: SYSTEM_USER_ID,
    },
  });
  console.log("• iam.user_account — SYSTEM 1 แถว");
}

async function seedBdiOrganization() {
  await prisma.organization.upsert({
    where: { id: BDI_ORGANIZATION_ID },
    update: {},
    create: {
      id: BDI_ORGANIZATION_ID,
      organizationCode: BDI_ORGANIZATION_CODE,
      organizationType: "PUBLIC_ORGANIZATION",
      nameTh: "สถาบันข้อมูลขนาดใหญ่ (องค์การมหาชน)",
      nameEn: "Big Data Institute",
      status: OrganizationStatus.ACTIVE,
      activatedAt: new Date(),
      activatedBy: SYSTEM_USER_ID,
      createdBy: SYSTEM_USER_ID,
      updatedBy: SYSTEM_USER_ID,
    },
  });
  console.log("• organization.organization — BDI 1 แถว");
}

async function seedRoles() {
  for (const role of ROLE_DEFINITIONS) {
    await prisma.role.upsert({
      where: { code: role.code },
      update: { nameTh: role.nameTh, nameEn: role.nameEn, updatedBy: SYSTEM_USER_ID },
      create: {
        code: role.code,
        nameTh: role.nameTh,
        nameEn: role.nameEn,
        createdBy: SYSTEM_USER_ID,
        updatedBy: SYSTEM_USER_ID,
      },
    });
  }
  console.log(`• iam.role — ${ROLE_DEFINITIONS.length} แถว`);
}

/**
 * เอกสารทางกฎหมาย A0–A4 — sheet `legal_document`
 *
 * ชื่อของแต่ละฉบับมาจากไฟล์จริงใน assets/document-template ไม่ใช่ชื่อที่เดาไว้ตอนที่
 * ยังไม่ได้ไฟล์ (ของเดิมเขียน A1 ว่า "เงื่อนไขการเชื่อมโยงและแลกเปลี่ยนข้อมูล"
 * ทั้งที่ผนวก 1 คือข้อตกลงการประมวลผลข้อมูล DPA)
 *
 * เวอร์ชัน 1 ถูกเผยแพร่จาก .docx ที่ติดมากับโค้ดใน src/assets/legal-templates/
 * **นั่นเป็นแค่ฉบับตั้งต้น** ของจริงหลังจากนี้คือเวอร์ชันล่าสุดในฐานข้อมูล ซึ่ง BDI
 * เปลี่ยนเองได้ผ่าน POST /api/admin/legal-documents/:code/versions โดยไม่ต้องแก้โค้ด
 *
 * A4 (แบบนำส่งข้อมูล) เป็นเอกสารของ Journey C — เผยแพร่ตั้งแต่การ์ด
 * "Dataset Registration PDF render" ซึ่งทำให้เส้นทางนั้น render เอกสารจาก template
 * เหมือนเส้นทาง B ตัวมันมีช่องติ๊กตามตัวเลือกในแบบฟอร์ม (ดู docs/19)
 */
const LEGAL_DOCUMENTS = [
  { code: "A0", type: "DATA_SHARING_AGREEMENT", nameTh: "ข้อตกลงในการบริหารจัดการและการแบ่งปันข้อมูล", scope: "ORGANIZATION_REGISTRATION", order: 1, signature: true, template: "A0.docx" },
  { code: "A1", type: "DATA_PROCESSING_AGREEMENT", nameTh: "ผนวก 1 ข้อตกลงในการประมวลผลข้อมูล (DPA)", scope: "ORGANIZATION_REGISTRATION", order: 2, signature: true, template: "A1.docx" },
  { code: "A2", type: "PERSONAL_DATA_PROCESSING_AGREEMENT", nameTh: "ผนวก 2 ข้อตกลงประมวลผลข้อมูลส่วนบุคคล (PDPA)", scope: "ORGANIZATION_REGISTRATION", order: 3, signature: true, template: "A2.docx" },
  { code: "A3", type: "NON_DISCLOSURE_AGREEMENT", nameTh: "ผนวก 3 ข้อตกลงรักษาความลับ (NDA)", scope: "ORGANIZATION_REGISTRATION", order: 4, signature: true, template: "A3.docx" },
  { code: "A4", type: "DATA_DELIVERY_FORM", nameTh: "แบบนำส่งข้อมูล", scope: "DATASET_REGISTRATION", order: 1, signature: true, template: "A4.docx" },
] as const;

const TEMPLATE_DIR = new URL("../assets/legal-templates/", import.meta.url);

async function seedLegalDocuments() {
  for (const doc of LEGAL_DOCUMENTS) {
    await prisma.legalDocument.upsert({
      where: { documentCode: doc.code },
      // ชื่อและประเภทถูกแก้ให้ตรงไฟล์จริง ฐานข้อมูลที่ seed ไว้ก่อนหน้าจึงต้องตามมาด้วย
      update: { documentType: doc.type, nameTh: doc.nameTh, displayOrder: doc.order },
      create: {
        documentCode: doc.code,
        documentType: doc.type,
        nameTh: doc.nameTh,
        applicationScope: doc.scope,
        displayOrder: doc.order,
        isRequired: true,
        requiresSignatureConfirmation: doc.signature,
        status: LegalDocumentStatus.DRAFT,
        createdBy: SYSTEM_USER_ID,
      },
    });
  }
  console.log(`• legal.legal_document — ${LEGAL_DOCUMENTS.length} ฉบับ`);

  for (const doc of LEGAL_DOCUMENTS) {
    if (!doc.template) continue;

    /**
     * idempotent: ข้ามถ้ามีเวอร์ชันที่เนื้อไฟล์เหมือนกันเผยแพร่อยู่แล้ว
     *
     * เทียบด้วย content_hash ไม่ใช่แค่ "มีเวอร์ชันหรือยัง" เพราะถ้า template ที่ติดมา
     * กับโค้ดถูกแก้แล้ว seed ควรออกเวอร์ชันใหม่ให้ แต่การรันซ้ำ ๆ ต้องไม่งอกเวอร์ชัน
     * ทุกครั้ง — และต้องไม่ทับเวอร์ชันที่ BDI อัปโหลดเข้ามาเองด้วยของเก่าในโค้ด
     */
    const docx = await readFile(new URL(doc.template, TEMPLATE_DIR));
    const hash = createHash("sha256").update(docx).digest("hex");
    const existing = await prisma.legalDocumentVersion.findFirst({
      where: { legalDocument: { documentCode: doc.code } },
      orderBy: { versionNumber: "desc" },
    });
    if (existing) {
      const label = existing.contentHash === hash ? "เผยแพร่อยู่แล้ว" : "มีเวอร์ชันที่แก้ในระบบแล้ว";
      console.log(`  ${doc.code} — ข้าม (${label} v${existing.versionNumber})`);
      continue;
    }

    const { versionNumber, placeholders } = await publishVersion(prisma, {
      documentCode: doc.code,
      docx,
      filename: doc.template,
      actorId: SYSTEM_USER_ID,
    });
    console.log(
      `  ${doc.code} — เผยแพร่ v${versionNumber} (${placeholders.length} placeholder)`,
    );
  }
}

async function seedAddresses() {
  const provinces = listProvinces();

  const provinceRows: { code: string; nameTh: string }[] = [];
  const districtRows: { code: string; nameTh: string; provinceCode: string }[] = [];
  const subDistrictRows: {
    code: string;
    nameTh: string;
    districtCode: string;
    postalCode: string | null;
  }[] = [];

  provinces.forEach((province, pIndex) => {
    const provinceCode = pad(pIndex + 1, 2);
    provinceRows.push({ code: provinceCode, nameTh: province });

    listAmphoes(province).forEach((amphoe, aIndex) => {
      const districtCode = `${provinceCode}${pad(aIndex + 1, 2)}`;
      districtRows.push({ code: districtCode, nameTh: amphoe, provinceCode });

      listSubdistricts(province, amphoe).forEach((tambon, tIndex) => {
        subDistrictRows.push({
          code: `${districtCode}${pad(tIndex + 1, 2)}`,
          nameTh: tambon.name,
          districtCode,
          postalCode: tambon.zipcode || null,
        });
      });
    });
  });

  // ลบแล้วใส่ใหม่ทั้งชุด — รหัสมาจากลำดับในไฟล์ ถ้าไฟล์เปลี่ยนรหัสต้องเปลี่ยนตาม
  // FK เป็น ON DELETE CASCADE จึงลบจากบนสุดพอ
  await prisma.province.deleteMany();
  await prisma.province.createMany({ data: provinceRows });
  await prisma.district.createMany({ data: districtRows });
  await prisma.subDistrict.createMany({ data: subDistrictRows });

  console.log(
    `• administration — ${provinceRows.length} จังหวัด / ${districtRows.length} อำเภอ / ${subDistrictRows.length} ตำบล`,
  );
}

async function main() {
  console.log("seed master data …");
  await seedSystemUser();
  await seedRoles();
  await seedBdiOrganization();
  await seedLegalDocuments();
  await seedAddresses();
  console.log("เสร็จแล้ว");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
