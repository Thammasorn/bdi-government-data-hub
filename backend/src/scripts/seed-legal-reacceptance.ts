/**
 * ข้อมูลทดสอบของการ์ด "[Enhance] Legal Document Management" — รันหลัง seed:masters และ seed:demo
 *
 *   npm run seed:legal-reacceptance                      # ค่าตั้งต้น = published
 *   npm run seed:legal-reacceptance -- --stage=baseline
 *
 * ทั้งสองแบบ:
 * 1. "สำนักงานสถิติแห่งชาติ" (ACTIVE ใน seed:demo) ลงนาม A0 A1 A2 ในคำขอลงทะเบียนที่อนุมัติแล้ว — A3 ข้ามไว้ (optional)
 *    seed:demo ไม่สร้าง legal_acceptance ให้ จึงเติมที่นี่โดยผูกกับด่าน ORGANIZATION_APPROVAL ของคำขอนั้น
 * 2. สร้างหน่วยงาน ACTIVE ที่สอง "กรมส่งเสริมการเกษตร" (ORG-2026-0007) ที่ลงนามครบ A0–A3 — ไว้ทดสอบว่า
 *    ล็อก/ปลดล็อกแยกกันต่อหน่วยงาน และว่าเผยแพร่ A3 (optional) แล้วไม่ล็อกแม้หน่วยงานที่เคยเข้าร่วม
 *
 * --stage=baseline  หยุดตรงนี้ — ทุกหน่วยงานลงนามเวอร์ชันที่ใช้อยู่ ไม่มีงานค้าง ให้ผู้ทดสอบเผยแพร่เวอร์ชันใหม่เองจาก /console
 * --stage=published (ค่าตั้งต้น) เผยแพร่ A0 และ A2 เวอร์ชัน "2.0" ที่ต้องลงนามซ้ำ ผ่าน `startReacceptance()` ตัวเดียวกับ /console
 *    → ทั้งสองหน่วยงานถูกล็อก · คำขอลงทะเบียนที่เปิดอยู่ใน seed:demo ได้เอกสารชุดใหม่หรือถูกย้อนกลับ
 *    (docs/tools/legal-reacceptance-api-check.mjs ต้องการสถานะนี้)
 *
 * รันซ้ำหลัง seed:demo ได้ — seed:demo ล้างหน่วยงาน ผู้ใช้ และการลงนามทั้งหมด แต่ไม่ล้างเวอร์ชันเอกสาร
 */
import { readFile } from "node:fs/promises";

import {
  AcceptanceMethod,
  AccountType,
  AssignmentSource,
  ConfirmationType,
  OrganizationStatus,
  PrismaClient,
  ReviewResult,
  ReviewTaskStatus,
  ReviewTaskType,
  SubjectType,
  UserAccountStatus,
  type Organization,
  type OrganizationRegistrationRequest,
  type UserAccount,
} from "@prisma/client";

import { hashPassword } from "../lib/auth.js";
import { runWithContext } from "../lib/context.js";
import { assignRole } from "../lib/iam.js";
import { LEGAL_SCOPES, pinSubmittedRequest, publishVersion } from "../lib/legal.js";
import { startReacceptance } from "../lib/legal-reacceptance.js";
import { fullNameTh } from "../lib/person-name.js";
import { ROLE_CODES, SYSTEM_USER_ID, type RoleCode } from "../lib/system.js";

const prisma = new PrismaClient();
const PASSWORD = "bdi12345";
const ORG_SUBJECT = SubjectType.ORGANIZATION_REGISTRATION_REQUEST;
const TEMPLATE_DIR = new URL("../assets/legal-templates/", import.meta.url);
const REACCEPT = ["A0", "A2"];

type Stage = "baseline" | "published";

function parseStage(): Stage {
  const arg = process.argv.find((a) => a.startsWith("--stage="))?.slice("--stage=".length) ?? "published";
  if (arg !== "baseline" && arg !== "published") throw new Error(`--stage ต้องเป็น baseline หรือ published (ได้ "${arg}")`);
  return arg;
}

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

/** หน่วยงานที่สอง — ลงทะเบียนครบแล้ว ลงนาม A0–A3 */
const SECOND = {
  code: "ORG-2026-0007",
  requestNumber: "ORG-REG-2026-0007",
  name: "กรมส่งเสริมการเกษตร",
  user: { email: "user@doae.go.th", prefix: "นางสาว", first: "กมลชนก", last: "เกษตรดี", cid: "1101000000071" },
  approver: { email: "director@doae.go.th", prefix: "นาย", first: "วีระพงษ์", last: "ส่งเสริม", cid: "3101000000071" },
};

async function makeUser(spec: typeof SECOND.user, role: RoleCode, organizationId: string): Promise<UserAccount> {
  const user = await prisma.userAccount.create({
    data: {
      email: spec.email,
      cid: spec.cid,
      prefixTh: spec.prefix,
      firstnameTh: spec.first,
      lastnameTh: spec.last,
      positionTh: role === ROLE_CODES.ORGANIZATION_APPROVER ? "อธิบดี" : "นักวิชาการคอมพิวเตอร์",
      phoneNumber: "021234567",
      displayName: fullNameTh({ prefixTh: spec.prefix, firstnameTh: spec.first, lastnameTh: spec.last }),
      accountType: AccountType.ORGANIZATION,
      status: UserAccountStatus.ACTIVE,
      activatedAt: daysAgo(40),
      passwordHash: await hashPassword(PASSWORD),
      createdBy: SYSTEM_USER_ID,
      updatedBy: SYSTEM_USER_ID,
    },
  });
  await assignRole(prisma, { userAccountId: user.id, roleCode: role, organizationId, actorId: SYSTEM_USER_ID });
  return user;
}

/** สร้างหน่วยงานที่สองโดยคัดลอกที่อยู่และ snapshot ของ NSO — ถ้ามีอยู่แล้ว (รันซ้ำ) ใช้ของเดิม */
async function ensureSecondOrganization(template: { org: Organization; request: OrganizationRegistrationRequest }) {
  const existing = await prisma.organization.findFirst({ where: { organizationCode: SECOND.code } });
  if (existing) {
    const request = await prisma.organizationRegistrationRequest.findFirstOrThrow({ where: { organizationId: existing.id } });
    const signer = await prisma.userAccount.findFirstOrThrow({ where: { email: SECOND.approver.email } });
    return { org: existing, request, signer };
  }

  const { id: _orgId, createdAt: _oc, updatedAt: _ou, ...orgColumns } = template.org;
  const org = await prisma.organization.create({
    data: {
      ...orgColumns,
      organizationCode: SECOND.code,
      nameTh: SECOND.name,
      nameEn: null,
      email: SECOND.user.email,
      status: OrganizationStatus.ACTIVE,
      activatedAt: daysAgo(35),
      createdAt: daysAgo(45),
      createdBy: SYSTEM_USER_ID,
      updatedBy: SYSTEM_USER_ID,
    },
  });
  const user = await makeUser(SECOND.user, ROLE_CODES.ORGANIZATION_USER, org.id);
  const signer = await makeUser(SECOND.approver, ROLE_CODES.ORGANIZATION_APPROVER, org.id);
  const bdiOfficer = await prisma.userAccount.findFirstOrThrow({ where: { email: "officer@bdi.or.th" } });
  const bdiApprover = await prisma.userAccount.findFirstOrThrow({ where: { email: "approver@bdi.or.th" } });

  // ไฟล์แนบเป็นของ NSO — ไม่คัดลอก · additional_detail_json ไม่ได้ใช้ในคำขอตัวอย่าง
  const {
    id: _rid,
    createdAt: _rc,
    updatedAt: _ru,
    additionalDetailJson: _extra,
    authorizedRepresentativeAppointmentAttachmentId: _a1,
    powerOfAttorneyAttachmentId: _a2,
    ...requestColumns
  } = template.request;
  const request = await prisma.organizationRegistrationRequest.create({
    data: {
      ...requestColumns,
      requestNumber: SECOND.requestNumber,
      organizationId: org.id,
      organizationCode: SECOND.code,
      organizationNameTh: SECOND.name,
      organizationEmail: SECOND.user.email,
      approverPrefixTh: SECOND.approver.prefix,
      approverFirstnameTh: SECOND.approver.first,
      approverLastnameTh: SECOND.approver.last,
      approverPositionTh: "อธิบดี",
      approverEmail: SECOND.approver.email,
      approverCid: SECOND.approver.cid,
      userCid: SECOND.user.cid,
      userPrefixTh: SECOND.user.prefix,
      userFirstnameTh: SECOND.user.first,
      userLastnameTh: SECOND.user.last,
      userEmail: SECOND.user.email,
      submittedAt: daysAgo(44),
      approvedAt: daysAgo(35),
      createdAt: daysAgo(45),
      createdBy: user.id,
      updatedBy: user.id,
    },
  });

  // สามด่านของ Journey B ปิดครบ — ผู้ประสานงานนำส่ง → BDI ตรวจ → ผู้มีอำนาจลงนาม → BDI อนุมัติ
  const gates: Array<{ type: ReviewTaskType; role: RoleCode; by: UserAccount; result: ReviewResult; at: number }> = [
    { type: ReviewTaskType.BDI_OFFICER_REVIEW, role: ROLE_CODES.BDI_OFFICER, by: bdiOfficer, result: ReviewResult.PASSED, at: 43 },
    { type: ReviewTaskType.ORGANIZATION_APPROVAL, role: ROLE_CODES.ORGANIZATION_APPROVER, by: signer, result: ReviewResult.APPROVED, at: 40 },
    { type: ReviewTaskType.BDI_FINAL_APPROVAL, role: ROLE_CODES.BDI_FINAL_APPROVER, by: bdiApprover, result: ReviewResult.APPROVED, at: 35 },
  ];
  for (const [index, gate] of gates.entries()) {
    await prisma.reviewTask.create({
      data: {
        subjectType: ORG_SUBJECT,
        subjectId: request.id,
        taskType: gate.type,
        sequenceNumber: index + 1,
        roundNumber: 1,
        // ด่านของ BDI ไม่มีผู้รับผิดชอบ — มีเฉพาะด่านผู้มีอำนาจของหน่วยงานใน Journey B
        assignedUserId: gate.type === ReviewTaskType.ORGANIZATION_APPROVAL ? signer.id : null,
        assignedRole: gate.role,
        assignmentSource: AssignmentSource.SYSTEM,
        status: ReviewTaskStatus.COMPLETED,
        result: gate.result,
        completedBy: gate.by.id,
        assignedAt: daysAgo(gate.at + 1),
        startedAt: daysAgo(gate.at),
        completedAt: daysAgo(gate.at),
        createdBy: SYSTEM_USER_ID,
        updatedBy: gate.by.id,
      },
    });
  }
  console.log(`  สร้าง ${SECOND.name} (${SECOND.code}) · ${SECOND.user.email} · ${SECOND.approver.email}`);
  return { org, request, signer };
}

/**
 * ลงนามเอกสารของหน่วยงานในด่าน ORGANIZATION_APPROVAL ของคำขอลงทะเบียน — เหมือนที่ SigningDialog บันทึก
 * pick "first" = เวอร์ชันแรกที่ไม่ใช่ฉบับลงนามซ้ำ (published จะได้ล็อกเมื่อเปิด 2.0) · "latest" = ฉบับที่ใช้อยู่ตอนนี้ (baseline)
 */
async function signDocuments(params: {
  org: Organization;
  request: OrganizationRegistrationRequest;
  signer: UserAccount;
  codes: string[];
  pick: "first" | "latest";
}) {
  const { org, request, signer } = params;
  const task = await prisma.reviewTask.findFirstOrThrow({
    where: { subjectType: ORG_SUBJECT, subjectId: request.id, taskType: ReviewTaskType.ORGANIZATION_APPROVAL },
  });
  const confirmation =
    (await prisma.signatureConfirmation.findFirst({
      where: { reviewTaskId: task.id, confirmationType: ConfirmationType.ORGANIZATION_APPROVAL },
    })) ??
    (await prisma.signatureConfirmation.create({
      data: {
        reviewTaskId: task.id,
        subjectType: ORG_SUBJECT,
        subjectId: request.id,
        userAccountId: signer.id,
        organizationId: org.id,
        confirmationType: ConfirmationType.ORGANIZATION_APPROVAL,
        confirmationText: "ข้าพเจ้าได้พิจารณาข้อตกลงนี้แล้ว และมีเจตนาลงนามด้วยวิธีอิเล็กทรอนิกส์",
        confirmationPayloadJson: {
          signedName: fullNameTh(signer),
          signedFirstName: signer.firstnameTh,
          signedLastName: signer.lastnameTh,
          signedPosition: signer.positionTh,
          documentVersionIds: [],
        },
        confirmedAt: task.completedAt ?? new Date(),
        createdBy: signer.id,
      },
    }));

  // ลายมือชื่อของผู้มีอำนาจอนุมัติของ BDI ที่ด่านสุดท้าย — popup ประวัติอ่านชื่อผู้อนุมัติ BDI จากแถวนี้
  const finalTask = await prisma.reviewTask.findFirstOrThrow({
    where: { subjectType: ORG_SUBJECT, subjectId: request.id, taskType: ReviewTaskType.BDI_FINAL_APPROVAL },
  });
  const bdiSigned = await prisma.signatureConfirmation.findFirst({
    where: { reviewTaskId: finalTask.id, confirmationType: ConfirmationType.BDI_FINAL_APPROVAL },
  });
  if (!bdiSigned) {
    const bdiApprover = await prisma.userAccount.findFirstOrThrow({ where: { email: "approver@bdi.or.th" } });
    await prisma.signatureConfirmation.create({
      data: {
        reviewTaskId: finalTask.id,
        subjectType: ORG_SUBJECT,
        subjectId: request.id,
        userAccountId: bdiApprover.id,
        organizationId: org.id,
        confirmationType: ConfirmationType.BDI_FINAL_APPROVAL,
        confirmationText: "ข้าพเจ้าได้พิจารณาคำขอและเอกสารแล้ว และมีเจตนาลงนามด้วยวิธีอิเล็กทรอนิกส์",
        confirmationPayloadJson: {
          signedName: fullNameTh(bdiApprover),
          signedFirstName: bdiApprover.firstnameTh,
          signedLastName: bdiApprover.lastnameTh,
          signedPosition: bdiApprover.positionTh,
          documentVersionIds: [],
        },
        confirmedAt: finalTask.completedAt ?? new Date(),
        createdBy: bdiApprover.id,
      },
    });
  }

  for (const code of params.codes) {
    const signedBefore = await prisma.legalAcceptance.findFirst({
      where: { organizationId: org.id, legalDocumentVersion: { legalDocument: { documentCode: code } } },
    });
    if (signedBefore) continue;
    const version =
      params.pick === "first"
        ? await prisma.legalDocumentVersion.findFirstOrThrow({
            where: { legalDocument: { documentCode: code }, requiresReacceptance: false, status: { in: ["PUBLISHED", "SUPERSEDED"] } },
            orderBy: { versionNumber: "asc" },
          })
        : await prisma.legalDocumentVersion.findFirstOrThrow({
            where: { legalDocument: { documentCode: code }, status: "PUBLISHED" },
          });
    await prisma.legalAcceptance.create({
      data: {
        legalDocumentVersionId: version.id,
        userAccountId: signer.id,
        organizationId: org.id,
        subjectType: ORG_SUBJECT,
        subjectId: request.id,
        reviewTaskId: task.id,
        signatureConfirmationId: confirmation.id,
        acceptanceMethod: AcceptanceMethod.CHECKBOX,
        acceptedAt: confirmation.confirmedAt,
        createdBy: signer.id,
      },
    });
    console.log(`  ${org.nameTh} ลงนาม ${code} เวอร์ชัน ${version.displayVersionNumber}`);
  }
}

/**
 * ชุดเอกสารของคำขอที่อนุมัติแล้วต้องเป็นฉบับที่ลงนามจริง — เหมือนคำขอที่ผ่านระบบมาเอง
 *
 * seed:demo pin คำขอด้วยเวอร์ชันล่าสุด ณ ตอนรัน ซึ่งไม่ใช่ฉบับที่ `signDocuments()` ลงนาม (เลือกฉบับแรกในโหมด published)
 * หน้ารายละเอียดคำขอจึงบอกเวอร์ชันที่อนุมัติผิด · ฉบับไม่บังคับที่ไม่ได้ลงนาม = หน่วยงานกด "ไม่เกี่ยวข้อง" ตอนลงนาม
 * ซึ่งระบบจริงเก็บไว้ใน `notApplicableVersionIds` ของลายมือชื่อ ORGANIZATION_APPROVAL
 */
async function pinSignedSet(request: OrganizationRegistrationRequest) {
  const subject = { subjectType: ORG_SUBJECT, subjectId: request.id };
  await prisma.requestDocumentSnapshot.deleteMany({ where: subject });
  const picks = await pinSubmittedRequest(prisma, LEGAL_SCOPES.ORGANIZATION_REGISTRATION, subject, { write: true });
  const skippedCodes = picks.filter((p) => !p.accepted).map((p) => p.code);
  const skipped = await prisma.requestDocumentSnapshot.findMany({
    where: { ...subject, isRequired: false, legalDocumentVersion: { legalDocument: { documentCode: { in: skippedCodes } } } },
    select: { legalDocumentVersionId: true },
  });
  const confirmation = await prisma.signatureConfirmation.findFirstOrThrow({
    where: { ...subject, confirmationType: ConfirmationType.ORGANIZATION_APPROVAL },
  });
  const payload = (confirmation.confirmationPayloadJson ?? {}) as Record<string, unknown>;
  await prisma.signatureConfirmation.update({
    where: { id: confirmation.id },
    data: { confirmationPayloadJson: { ...payload, notApplicableVersionIds: skipped.map((r) => r.legalDocumentVersionId) } },
  });
}

async function main(): Promise<void> {
  const stage = parseStage();
  const pick = stage === "baseline" ? "latest" : "first";
  console.log(`seed:legal-reacceptance --stage=${stage}`);

  const nso = await prisma.organization.findFirstOrThrow({ where: { nameTh: "สำนักงานสถิติแห่งชาติ" } });
  if (nso.status !== OrganizationStatus.ACTIVE) throw new Error("สำนักงานสถิติแห่งชาติไม่ได้ ACTIVE — รัน seed:demo ก่อน");
  const nsoRequest = await prisma.organizationRegistrationRequest.findFirstOrThrow({
    where: { organizationId: nso.id, status: "APPROVED" },
  });
  const nsoSigner = await prisma.userAccount.findFirstOrThrow({ where: { email: "director@nso.go.th" } });
  await signDocuments({ org: nso, request: nsoRequest, signer: nsoSigner, codes: ["A0", "A1", "A2"], pick });

  const second = await ensureSecondOrganization({ org: nso, request: nsoRequest });
  await signDocuments({ ...second, codes: ["A0", "A1", "A2", "A3"], pick });
  // ก่อนเปิดงานลงนามเวอร์ชันใหม่ — startReacceptance ไม่แตะคำขอที่อนุมัติแล้ว
  await pinSignedSet(nsoRequest);
  await pinSignedSet(second.request);

  if (stage === "published") {
    for (const code of REACCEPT) {
      const exists = await prisma.legalDocumentVersion.findFirst({
        where: { legalDocument: { documentCode: code }, requiresReacceptance: true, status: "PUBLISHED" },
      });
      if (exists) {
        // seed:demo ล้างงานลงนามไปแล้ว แต่เวอร์ชันยังอยู่ — เปิดงานจากเวอร์ชันเดิม (รันซ้ำได้ผลเดิม)
        const summary = await startReacceptance({ versionId: exists.id, actorId: SYSTEM_USER_ID });
        console.log(`  ${code} ใช้เวอร์ชัน ${exists.displayVersionNumber} ที่มีอยู่แล้ว`, summary);
        continue;
      }
      const published = await publishVersion(prisma, {
        documentCode: code,
        docx: await readFile(new URL(`${code}.docx`, TEMPLATE_DIR)),
        filename: `${code}.docx`,
        actorId: SYSTEM_USER_ID,
        displayVersionNumber: "2.0",
        requiresReacceptance: true,
      });
      const summary = await startReacceptance({ versionId: published.versionId, actorId: SYSTEM_USER_ID });
      console.log(`  เผยแพร่ ${code} เวอร์ชัน 2.0 (ต้องลงนามซ้ำ)`, summary);
    }
  }

  console.log("");
  for (const org of [nso, second.org]) {
    const after = await prisma.organization.findUniqueOrThrow({ where: { id: org.id }, select: { accessStatus: true } });
    console.log(`${org.nameTh}: access_status = ${after.accessStatus}`);
  }
  const live = await prisma.legalDocumentVersion.findMany({
    where: { status: "PUBLISHED", legalDocument: { applicationScope: "ORGANIZATION_REGISTRATION" } },
    select: { displayVersionNumber: true, legalDocument: { select: { documentCode: true } } },
    orderBy: { legalDocument: { documentCode: "asc" } },
  });
  console.log("เวอร์ชันที่ใช้อยู่:", live.map((v) => `${v.legalDocument.documentCode}=${v.displayVersionNumber}`).join(" "));
  console.log(`รหัสผ่านทุกบัญชี ${PASSWORD}`);
}

runWithContext({ sourceComponent: "seed-legal-reacceptance" }, () =>
  main()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect()),
);
