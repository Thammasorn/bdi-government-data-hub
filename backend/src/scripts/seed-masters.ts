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
import { PrismaClient } from "@prisma/client";
import { AccountType, LegalDocumentStatus, OrganizationStatus, UserAccountStatus } from "@prisma/client";

import { listProvinces, listAmphoes, listSubdistricts } from "../lib/address.js";
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
 * สร้างเป็น DRAFT ทั้งหมดโดยตั้งใจ: sheet เขียน TODO ไว้ที่คอลัมน์ name_th/name_en
 * และ document_type ยังมาร์ก TO REVIEW แปลว่ายังไม่มีเนื้อหาจริงให้ผู้ใช้ยอมรับ
 * ตามตารางท้าย sheet `legal_document_version` เอกสารที่ DRAFT จะ "ไม่แสดงและยอมรับไม่ได้"
 * จึงยังไม่บล็อกการยื่นคำขอ
 *
 * เมื่อได้ไฟล์จริงมา: อัปโหลดเป็น attachment (owner_type = LEGAL_DOCUMENT_VERSION)
 * สร้าง legal_document_version แล้วเปลี่ยนสถานะเอกสารเป็น ACTIVE และ version เป็น PUBLISHED
 */
async function seedLegalDocuments() {
  const documents = [
    { code: "A0", type: "TERMS_OF_USE", nameTh: "ข้อตกลงการใช้งานระบบ", scope: "ORGANIZATION_REGISTRATION", order: 1, signature: true },
    { code: "A1", type: "DATA_SHARING_AGREEMENT", nameTh: "เงื่อนไขการเชื่อมโยงและแลกเปลี่ยนข้อมูล", scope: "ORGANIZATION_REGISTRATION", order: 2, signature: true },
    { code: "A2", type: "SECURITY_POLICY", nameTh: "ข้อกำหนดด้านความมั่นคงปลอดภัย", scope: "ORGANIZATION_REGISTRATION", order: 3, signature: true },
    { code: "A3", type: "PERSONAL_DATA_PROTECTION_NOTICE", nameTh: "ข้อกำหนดด้านการคุ้มครองข้อมูลส่วนบุคคล", scope: "ORGANIZATION_REGISTRATION", order: 4, signature: true },
    { code: "A4", type: "ACCEPTABLE_USE_POLICY", nameTh: "ข้อกำหนดการใช้ข้อมูลที่ได้รับ", scope: "DATASET_REGISTRATION", order: 1, signature: true },
  ];

  for (const doc of documents) {
    await prisma.legalDocument.upsert({
      where: { documentCode: doc.code },
      update: {},
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
  console.log(`• legal.legal_document — ${documents.length} ฉบับ (DRAFT, ยังไม่มีเนื้อหาจริง)`);
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
