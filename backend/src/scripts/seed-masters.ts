/**
 * Seed master data — รันได้ซ้ำ (idempotent) และต้องรันก่อน seed:demo เสมอ
 *
 *   - iam.user_account แถว SYSTEM หนึ่งแถว (ผู้กระทำสำหรับ created_by/updated_by ของ master data)
 *   - iam.role ทั้งเจ็ดตาม sheet `role`
 *   - administration.dataset_choice — ตัวเลือกในแบบฟอร์มลงทะเบียนชุดข้อมูล
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
import { DATASET_CHOICE_DEFAULTS } from "../lib/dataset-choices-defaults.js";
import { refreshChoices } from "../lib/dataset-choices.js";
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
  const bdiNames = {
    nameTh: "สถาบันข้อมูลขนาดใหญ่ (องค์การมหาชน)",
    nameEn: "Big Data Institute (Public Organization)",
  };
  await prisma.organization.upsert({
    where: { id: BDI_ORGANIZATION_ID },
    // ชื่อองค์กรเป็นค่าที่ไปโผล่บนเอกสารที่ลงนาม การ seed ซ้ำจึงต้องแก้ชื่อของแถวเดิมด้วย
    // ไม่ใช่ปล่อยผ่านเหมือนตอนที่ update เป็นอ็อบเจ็กต์ว่าง มิฉะนั้นฐานข้อมูลที่ตั้งไว้ก่อน
    // การเปลี่ยนชื่อ (2026-09-05) จะค้างชื่อเก่าไว้ตลอด
    update: bdiNames,
    create: {
      id: BDI_ORGANIZATION_ID,
      organizationCode: BDI_ORGANIZATION_CODE,
      organizationType: "PUBLIC_ORGANIZATION",
      ...bdiNames,
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
 * ยังไม่ได้ไฟล์
 *
 * **ชุด 2026-08-31 สลับลำดับผนวก** จากเดิม 1=DPA 2=PDPA 3=NDA เป็น 1=NDA 2=DPA 3=PDPA
 * รหัส `A1`–`A3` แปลว่า "ผนวก 1–3" เสมอ รหัสจึงเดินตามเลขผนวกของฝ่ายกฎหมาย ไม่ใช่ตาม
 * เนื้อหา — ผนวกที่เผยแพร่ใหม่เป็นเวอร์ชันถัดไปของรหัสเดิม
 *
 * ผลข้างเคียงที่ต้องรู้: `legal_acceptance` ชี้ที่ `legal_document_version` ไฟล์ที่แต่ละคน
 * ยอมรับไว้จึงไม่เปลี่ยน แต่ `legal_document.name_th` เป็นของ**ตัวเอกสาร** ไม่ใช่ของเวอร์ชัน
 * แถวเก่าจึงถูกอ่านใหม่ภายใต้ชื่อใหม่ ถ้าต้องอ้างว่าใครยอมรับ "อะไร" ให้ดูที่ไฟล์ของเวอร์ชัน
 *
 * เวอร์ชัน 1 ถูกเผยแพร่จาก .docx ที่ติดมากับโค้ดใน src/assets/legal-templates/
 * **นั่นเป็นแค่ฉบับตั้งต้น** ของจริงหลังจากนี้คือเวอร์ชันล่าสุดในฐานข้อมูล ซึ่ง BDI
 * เปลี่ยนเองได้ผ่าน POST /api/admin/legal-documents/:code/versions โดยไม่ต้องแก้โค้ด
 *
 * A4 (แบบนำส่งข้อมูล) เป็นเอกสารของ Journey C — เผยแพร่ตั้งแต่การ์ด
 * "Dataset Registration PDF render" ซึ่งทำให้เส้นทางนั้น render เอกสารจาก template
 * เหมือนเส้นทาง B ตัวมันมีช่องติ๊กตามตัวเลือกในแบบฟอร์ม (ดู docs/19)
 *
 * **`required: false` ของ A3 คือการตัดสินเชิงนโยบาย** (BDI, 2026-09-07) หน่วยงานที่ไม่มีการ
 * แบ่งปันข้อมูลส่วนบุคคลข้ามผนวก 3 ได้ ซึ่งเป็นสิ่งที่ `legal_notice` ของฉบับนั้นบอกไว้อยู่แล้ว
 * ก่อนหน้านี้ทุกฉบับถูกตั้ง `true` ปุ่ม "ไม่เกี่ยวข้อง" จึงไม่เคยโผล่ และคำเตือนสั่งให้กดปุ่มที่
 * ไม่มีอยู่จริง
 */
const A3_NOTICE =
  'หากหน่วยงานของท่านไม่มีการแบ่งปันข้อมูลส่วนบุคคล ให้กดปุ่ม "ไม่เกี่ยวข้อง" เพื่อข้ามไปขั้นตอนถัดไป';

const LEGAL_DOCUMENTS = [
  { code: "A0", type: "DATA_SHARING_AGREEMENT", nameTh: "ข้อตกลงหลักในการบริหารจัดการและการแบ่งปันข้อมูล", shortname: "ข้อตกลงหลักในการบริหารจัดการและการแบ่งปันข้อมูล", notice: null, required: true, scope: "ORGANIZATION_REGISTRATION", order: 1, signature: true, template: "A0.docx" },
  { code: "A1", type: "NON_DISCLOSURE_AGREEMENT", nameTh: "ผนวก 1 สัญญารักษาความลับ (NDA)", shortname: "ผนวก 1", notice: null, required: true, scope: "ORGANIZATION_REGISTRATION", order: 2, signature: true, template: "A1.docx" },
  { code: "A2", type: "DATA_PROCESSING_AGREEMENT", nameTh: "ผนวก 2 ข้อตกลงการประมวลผลข้อมูล (DPA)", shortname: "ผนวก 2", notice: null, required: true, scope: "ORGANIZATION_REGISTRATION", order: 3, signature: true, template: "A2.docx" },
  { code: "A3", type: "PERSONAL_DATA_PROCESSING_AGREEMENT", nameTh: "ผนวก 3 ข้อตกลงประมวลผลข้อมูลส่วนบุคคล (PDPA)", shortname: "ผนวก 3", notice: A3_NOTICE, required: false, scope: "ORGANIZATION_REGISTRATION", order: 4, signature: true, template: "A3.docx" },
  { code: "A4", type: "DATA_DELIVERY_FORM", nameTh: "แบบนำส่งข้อมูล", shortname: null, notice: null, required: true, scope: "DATASET_REGISTRATION", order: 1, signature: true, template: "A4.docx" },
] as const;

const TEMPLATE_DIR = new URL("../assets/legal-templates/", import.meta.url);

async function seedLegalDocuments() {
  for (const doc of LEGAL_DOCUMENTS) {
    await prisma.legalDocument.upsert({
      where: { documentCode: doc.code },
      // ชื่อและประเภทถูกแก้ให้ตรงไฟล์จริง ฐานข้อมูลที่ seed ไว้ก่อนหน้าจึงต้องตามมาด้วย
      // shortname/legalNotice อยู่ใน update ด้วย เพราะเป็นถ้อยคำที่ฝ่ายกฎหมายสั่งเปลี่ยนได้
      // และฐานข้อมูลที่มีอยู่แล้วต้องได้ค่าใหม่โดยไม่ต้อง reset
      //
      // isRequired อยู่ใน create เท่านั้น โดยตั้งใจ — แอดมินสลับค่านี้เองได้ผ่าน
      // PATCH /api/admin/legal-documents/:code ถ้าใส่ไว้ใน update ด้วย การรัน seed:masters
      // รอบถัดไปจะล้างสิ่งที่แอดมินตั้งไว้เงียบ ๆ ฐานข้อมูลที่มีอยู่แล้วจึงต้องยิง PATCH เอง
      update: {
        documentType: doc.type,
        nameTh: doc.nameTh,
        shortname: doc.shortname,
        legalNotice: doc.notice,
        displayOrder: doc.order,
      },
      create: {
        documentCode: doc.code,
        documentType: doc.type,
        nameTh: doc.nameTh,
        shortname: doc.shortname,
        legalNotice: doc.notice,
        applicationScope: doc.scope,
        displayOrder: doc.order,
        isRequired: doc.required,
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

/**
 * ตัวเลือกในแบบฟอร์มลงทะเบียนชุดข้อมูล
 *
 * **ต้องรันเป็นตัวแรกใน main()** และต้องตามด้วย refreshChoices() ในโปรเซสเดียวกัน
 * seedLegalDocuments() เผยแพร่ A4.docx ซึ่งมี placeholder `{{tick.<ช่อง>.<รหัส>}}` อยู่
 * 75 ตัว และ publishVersion() ตรวจชื่อเหล่านั้นกับรายการที่ lib/dataset-choices.ts คืนให้
 * ถ้าตัวเลือกยังไม่ถูกเติมและ cache ยังไม่ถูกโหลดใหม่ A4 จะถูกปฏิเสธว่าใช้ตัวแปรที่ระบบ
 * ไม่รู้จัก — สคริปต์ที่มีหน้าที่เติมตาราง จะพังเพราะตารางยังไม่ถูกเติม
 *
 * labelTh / displayOrder / isActive อยู่ใน create **เท่านั้น** โดยตั้งใจ — แอดมินแก้สามค่านี้
 * ได้เองผ่าน PATCH /api/admin/dataset-choices/:fieldKey/:code ถ้าใส่ไว้ใน update ด้วย
 * การรัน seed:masters รอบถัดไปจะล้างสิ่งที่แอดมินตั้งไว้เงียบ ๆ (แบบเดียวกับ isRequired
 * ของ legal_document) ผลคือไฟล์ค่าตั้งต้นเป็น "ค่าเริ่มต้นของฐานข้อมูลใหม่" ไม่ใช่
 * "คำตอบสุดท้ายที่บังคับทุกฐานข้อมูล"
 */
async function seedDatasetChoices() {
  for (const choice of DATASET_CHOICE_DEFAULTS) {
    await prisma.datasetChoice.upsert({
      where: { fieldKey_code: { fieldKey: choice.fieldKey, code: choice.code } },
      update: {},
      create: {
        fieldKey: choice.fieldKey,
        code: choice.code,
        labelTh: choice.labelTh,
        displayOrder: choice.displayOrder,
        createdBy: SYSTEM_USER_ID,
        updatedBy: SYSTEM_USER_ID,
      },
    });
  }

  // cache ในโปรเซสนี้ถูกโหลดตอน import ซึ่งเกิดก่อนแถวข้างบนถูกเขียน
  await refreshChoices();
  console.log(`• administration.dataset_choice — ${DATASET_CHOICE_DEFAULTS.length} แถว`);
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
  // ก่อน seedLegalDocuments() เสมอ — A4 ตรวจชื่อช่องติ๊กกับตัวเลือกชุดนี้ ดูคอมเมนต์ที่ฟังก์ชัน
  await seedDatasetChoices();
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
