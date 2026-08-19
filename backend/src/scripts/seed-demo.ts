/**
 * Demo fixtures บนสคีมาใหม่ (draft_db_design 2026-08-11)
 *
 * ล้างข้อมูลธุรกรรมทั้งหมดแล้วสร้างใหม่ — master data (role, BDI organization,
 * ตารางที่อยู่) มาจาก seed:masters ซึ่งสคริปต์นี้เรียกให้เองถ้ายังไม่มี
 *
 * ชุดข้อมูลตัวอย่างยังเป็นชุดเดิมกับก่อนย้ายสคีมา แต่ "สถานะ" เปลี่ยนวิธีแสดง:
 * เดิมเก็บด่านไว้ใน status (PENDING_OFFICER_REVIEW ฯลฯ) ตอนนี้ status เหลือเจ็ดค่า
 * ส่วนด่านอยู่ที่ review_task ที่ยัง active — ดูคอลัมน์ "ด่านที่ค้าง" ในผลลัพธ์ท้ายสคริปต์
 */
import {
  AccountType,
  AssignmentSource,
  AttachmentOwnerType,
  CommentVisibility,
  DatasetStatus,
  IntegrationType,
  OrganizationStatus,
  Prisma,
  PrismaClient,
  RequestStatus,
  ReviewResult,
  ReviewTaskStatus,
  ReviewTaskType,
  SubjectType,
  UserAccountStatus,
} from "@prisma/client";
import { randomUUID } from "node:crypto";

import { hashPassword } from "../lib/auth.js";
import {
  EMPTY_METADATA,
  normaliseMetadata,
  toMetadataColumns,
  type MetadataValues,
} from "../lib/dataset.js";
import { assignRole, roleIdByCode } from "../lib/iam.js";
import { runWithContext } from "../lib/context.js";
import {
  BDI_ORGANIZATION_ID,
  PLACEHOLDER_ORGANIZATION_NAME,
  ROLE_CODES,
  SYSTEM_USER_ID,
  type RoleCode,
} from "../lib/system.js";
import { nextDatasetCode } from "../lib/request-number.js";
import { ensureBucket } from "../storage.js";

const prisma = new PrismaClient();

const PASSWORD = "bdi12345";

const dt = (daysAgo: number, hour = 10) => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, 0, 0, 0);
  return d;
};

const ORG_SUBJECT = SubjectType.ORGANIZATION_REGISTRATION_REQUEST;
const DS_SUBJECT = SubjectType.DATASET_REGISTRATION_REQUEST;

// ------------------------------------------------------------------ ผู้ใช้

async function makeUser(opts: {
  email: string;
  prefix: string;
  firstName: string;
  lastName: string;
  phone: string;
  cid?: string;
  accountType: AccountType;
  role: RoleCode;
  organizationId?: string | null;
  status?: UserAccountStatus;
}) {
  const displayName = `${opts.prefix}${opts.firstName} ${opts.lastName}`;
  const status = opts.status ?? UserAccountStatus.ACTIVE;

  const user = await prisma.userAccount.create({
    data: {
      email: opts.email,
      cid: opts.cid ?? null,
      prefixTh: opts.prefix,
      firstnameTh: opts.firstName,
      lastnameTh: opts.lastName,
      phoneNumber: opts.phone,
      displayName,
      accountType: opts.accountType,
      status,
      activatedAt: status === UserAccountStatus.ACTIVE ? dt(60) : null,
      passwordHash: await hashPassword(PASSWORD),
      createdBy: SYSTEM_USER_ID,
      updatedBy: SYSTEM_USER_ID,
    },
  });

  if (status === UserAccountStatus.ACTIVE) {
    await assignRole(prisma, {
      userAccountId: user.id,
      roleCode: opts.role,
      organizationId: opts.organizationId ?? null,
      actorId: SYSTEM_USER_ID,
    });
  }

  return user;
}

// ------------------------------------------------------------------ review task

/**
 * สร้าง review_task ที่ปิดไปแล้วหนึ่งด่าน — ใช้ประกอบประวัติของคำขอที่เดินไปไกลแล้ว
 * ไม่ผ่าน lib/workflow เพราะต้องกำหนดเวลาให้ย้อนหลังได้
 */
async function closedTask(params: {
  subjectType: SubjectType;
  subjectId: string;
  taskType: ReviewTaskType;
  sequenceNumber: number;
  roundNumber?: number;
  assignedUserId: string;
  assignedRole: RoleCode;
  result: ReviewResult;
  comment?: string | null;
  at: Date;
}) {
  return prisma.reviewTask.create({
    data: {
      subjectType: params.subjectType,
      subjectId: params.subjectId,
      taskType: params.taskType,
      sequenceNumber: params.sequenceNumber,
      roundNumber: params.roundNumber ?? 1,
      assignedUserId: params.assignedUserId,
      assignedRole: params.assignedRole,
      assignmentSource: AssignmentSource.SYSTEM,
      status: ReviewTaskStatus.COMPLETED,
      result: params.result,
      resultComment: params.comment ?? null,
      commentVisibility: params.comment ? CommentVisibility.ORGANIZATION : null,
      assignedAt: params.at,
      startedAt: params.at,
      completedAt: params.at,
      createdBy: SYSTEM_USER_ID,
      updatedBy: SYSTEM_USER_ID,
    },
  });
}

/** ด่านที่ยังค้าง — คำขอหนึ่งฉบับมีได้ตัวเดียว (partial unique index บังคับ) */
async function openTaskRow(params: {
  subjectType: SubjectType;
  subjectId: string;
  taskType: ReviewTaskType;
  sequenceNumber: number;
  roundNumber?: number;
  assignedUserId: string;
  assignedRole: RoleCode;
  status?: ReviewTaskStatus;
  at: Date;
}) {
  return prisma.reviewTask.create({
    data: {
      subjectType: params.subjectType,
      subjectId: params.subjectId,
      taskType: params.taskType,
      sequenceNumber: params.sequenceNumber,
      roundNumber: params.roundNumber ?? 1,
      assignedUserId: params.assignedUserId,
      assignedRole: params.assignedRole,
      assignmentSource: AssignmentSource.SYSTEM,
      status: params.status ?? ReviewTaskStatus.PENDING,
      startedAt: params.status === ReviewTaskStatus.IN_PROGRESS ? params.at : null,
      assignedAt: params.at,
      createdBy: SYSTEM_USER_ID,
      updatedBy: SYSTEM_USER_ID,
    },
  });
}

// ------------------------------------------------------------------ main

async function main() {
  await ensureBucket();

  console.log("ล้างข้อมูลธุรกรรมเดิม…");
  await prisma.auditEvent.deleteMany();
  await prisma.notificationDelivery.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.integrationOperation.deleteMany();
  await prisma.legalAcceptance.deleteMany();
  await prisma.signatureConfirmation.deleteMany();
  await prisma.reviewTask.deleteMany();
  await prisma.datasetMetadata.deleteMany();
  await prisma.datasetRegistrationRequest.updateMany({ data: { createdDatasetId: null } });
  await prisma.dataset.deleteMany();
  await prisma.datasetRegistrationMetadata.deleteMany();
  await prisma.datasetRegistrationRequest.deleteMany();
  await prisma.organizationRegistrationRequest.deleteMany();
  /**
   * ไฟล์แนบทั้งหมด **ยกเว้น** template เอกสารกฎหมาย
   *
   * legal_document_version.attachment_id เป็น FK มาที่ตารางนี้ และเวอร์ชันเอกสารเป็น
   * master data ที่ seed:masters เผยแพร่ไว้ ไม่ใช่ข้อมูลธุรกรรมของเดโม ลบทั้งตาราง
   * จะชน legal_document_version_attachment_id_fkey และ seed:demo ล้มทั้งสคริปต์
   */
  await prisma.attachment.deleteMany({
    where: { ownerType: { not: AttachmentOwnerType.LEGAL_DOCUMENT_VERSION } },
  });
  await prisma.activationKey.deleteMany();
  await prisma.otpCode.deleteMany();
  await prisma.userRoleAssignment.deleteMany();
  await prisma.organization.deleteMany({ where: { id: { not: BDI_ORGANIZATION_ID } } });
  await prisma.userAccount.deleteMany({ where: { id: { not: SYSTEM_USER_ID } } });

  // master data ต้องมีอยู่ก่อน — ล้มให้ชัดถ้ายังไม่ได้รัน seed:masters
  await roleIdByCode(prisma, ROLE_CODES.BDI_OFFICER);

  // ---------------------------------------------------------- เจ้าหน้าที่ BDI
  console.log("สร้างบัญชีเจ้าหน้าที่ BDI…");
  const officer = await makeUser({
    email: "officer@bdi.or.th",
    prefix: "นาย",
    firstName: "ธนกร",
    lastName: "ตรวจสอบ",
    phone: "0810000001",
    accountType: AccountType.BDI,
    role: ROLE_CODES.BDI_OFFICER,
  });
  const approver = await makeUser({
    email: "approver@bdi.or.th",
    prefix: "นาง",
    firstName: "สุดารัตน์",
    lastName: "อนุมัติ",
    phone: "0810000002",
    accountType: AccountType.BDI,
    role: ROLE_CODES.BDI_FINAL_APPROVER,
  });
  const specialist = await makeUser({
    email: "specialist@bdi.or.th",
    prefix: "นาย",
    firstName: "ปกรณ์",
    lastName: "วิเคราะห์",
    phone: "0810000003",
    accountType: AccountType.BDI,
    role: ROLE_CODES.BDI_DATASET_SPECIALIST,
  });
  const legalOfficer = await makeUser({
    email: "legal@bdi.or.th",
    prefix: "นางสาว",
    firstName: "อารยา",
    lastName: "นิติกร",
    phone: "0810000004",
    accountType: AccountType.BDI,
    role: ROLE_CODES.BDI_LEGAL_OFFICER,
  });

  // ---------------------------------------------------------- หน่วยงาน
  console.log("สร้างหน่วยงานและคำขอลงทะเบียน…");

  interface OrgSpec {
    code: string;
    name: string;
    /** ด่านที่คำขอค้างอยู่ — null = อนุมัติครบแล้ว */
    stage: ReviewTaskType | null;
    returned?: boolean;
    userEmail: string;
    userName: [string, string, string];
    approverEmail: string;
    approverName: [string, string, string];
    province: string;
    daysAgo: number;
  }

  const orgSpecs: OrgSpec[] = [
    {
      code: "ORG-2026-0001",
      name: "สำนักงานสาธารณสุขจังหวัดเชียงใหม่",
      stage: ReviewTaskType.BDI_OFFICER_REVIEW,
      userEmail: "user.cmi@moph.go.th",
      userName: ["นางสาว", "ณัฐริกา", "ใจดี"],
      approverEmail: "director.cmi@moph.go.th",
      approverName: ["นายแพทย์", "สมชาย", "รักษาดี"],
      province: "เชียงใหม่",
      daysAgo: 6,
    },
    {
      code: "ORG-2026-0002",
      name: "กรมที่ดิน",
      stage: ReviewTaskType.BDI_OFFICER_REVIEW,
      returned: true,
      userEmail: "user@dol.go.th",
      userName: ["นาย", "วิชัย", "เอกสาร"],
      approverEmail: "director@dol.go.th",
      approverName: ["นาง", "ปราณี", "อำนวยการ"],
      province: "กรุงเทพมหานคร",
      daysAgo: 9,
    },
    {
      code: "ORG-2026-0003",
      name: "สำนักงานพัฒนาสังคมและความมั่นคงของมนุษย์จังหวัดขอนแก่น",
      stage: ReviewTaskType.ORGANIZATION_APPROVAL,
      userEmail: "user.kkn@m-society.go.th",
      userName: ["นางสาว", "พิมพ์ชนก", "สังคมดี"],
      approverEmail: "director.kkn@m-society.go.th",
      approverName: ["นาย", "อนุชา", "พัฒนา"],
      province: "ขอนแก่น",
      daysAgo: 12,
    },
    {
      code: "ORG-2026-0004",
      name: "กรมการปกครอง",
      stage: ReviewTaskType.BDI_FINAL_APPROVAL,
      userEmail: "user@dopa.go.th",
      userName: ["นาย", "ธีรศักดิ์", "ทะเบียน"],
      approverEmail: "director@dopa.go.th",
      approverName: ["นาย", "สุรชัย", "ปกครองดี"],
      province: "กรุงเทพมหานคร",
      daysAgo: 16,
    },
    {
      code: "ORG-2026-0005",
      name: "สำนักงานสถิติแห่งชาติ",
      stage: null,
      userEmail: "user@nso.go.th",
      userName: ["นางสาว", "ศศิธร", "สถิติดี"],
      approverEmail: "director@nso.go.th",
      approverName: ["นาย", "ประเสริฐ", "ข้อมูลดี"],
      province: "กรุงเทพมหานคร",
      daysAgo: 30,
    },
  ];

  const orgs: Record<string, { orgId: string; requestId: string; userId: string; approverId: string }> =
    {};

  for (const [index, spec] of orgSpecs.entries()) {
    const active = spec.stage === null;

    const province = await prisma.province.findFirst({ where: { nameTh: spec.province } });
    const district = province
      ? await prisma.district.findFirst({ where: { provinceCode: province.code } })
      : null;
    const subDistrict = district
      ? await prisma.subDistrict.findFirst({ where: { districtCode: district.code } })
      : null;

    const organization = await prisma.organization.create({
      data: {
        organizationCode: spec.code,
        organizationType: "GOVERNMENT_AGENCY",
        nameTh: spec.name,
        status: active ? OrganizationStatus.ACTIVE : OrganizationStatus.PENDING_REGISTRATION,
        addressLine: "578",
        road: "ศรีจันทร์",
        provinceCode: province?.code ?? null,
        districtCode: district?.code ?? null,
        subDistrictCode: subDistrict?.code ?? null,
        postalCode: subDistrict?.postalCode ?? null,
        email: spec.userEmail,
        phone: "021234567",
        activatedAt: active ? dt(spec.daysAgo - 2) : null,
        activatedBy: active ? approver.id : null,
        createdAt: dt(spec.daysAgo),
        createdBy: SYSTEM_USER_ID,
        updatedBy: SYSTEM_USER_ID,
      },
    });

    const orgUser = await makeUser({
      email: spec.userEmail,
      prefix: spec.userName[0],
      firstName: spec.userName[1],
      lastName: spec.userName[2],
      phone: "0820000000",
      cid: `11010000000${index + 1}`.slice(0, 13),
      accountType: AccountType.ORGANIZATION,
      role: ROLE_CODES.ORGANIZATION_USER,
      organizationId: organization.id,
    });

    // ผู้มีอำนาจของหน่วยงานที่ยังไม่ถึงด่านลงนาม ยังเป็นบัญชี PENDING
    const approverActive =
      spec.stage === null ||
      spec.stage === ReviewTaskType.ORGANIZATION_APPROVAL ||
      spec.stage === ReviewTaskType.BDI_FINAL_APPROVAL;

    const orgApprover = await makeUser({
      email: spec.approverEmail,
      prefix: spec.approverName[0],
      firstName: spec.approverName[1],
      lastName: spec.approverName[2],
      phone: "0830000000",
      cid: `31010000000${index + 1}`.slice(0, 13),
      accountType: AccountType.ORGANIZATION,
      role: ROLE_CODES.ORGANIZATION_APPROVER,
      organizationId: organization.id,
      status: approverActive ? UserAccountStatus.ACTIVE : UserAccountStatus.PENDING,
    });

    const request = await prisma.organizationRegistrationRequest.create({
      data: {
        requestNumber: `ORG-REG-2026-${String(index + 1).padStart(4, "0")}`,
        organizationId: organization.id,
        status: RequestStatus.DRAFT,
        organizationCode: spec.code,
        organizationType: "GOVERNMENT_AGENCY",
        organizationNameTh: spec.name,
        organizationAddressLine: "578",
        organizationRoad: "ศรีจันทร์",
        organizationProvinceCode: province?.code ?? null,
        organizationDistrictCode: district?.code ?? null,
        organizationSubdistrictCode: subDistrict?.code ?? null,
        organizationPostalCode: subDistrict?.postalCode ?? null,
        organizationEmail: spec.userEmail,
        organizationPhone: "021234567",

        approverPrefixTh: spec.approverName[0],
        approverFirstnameTh: spec.approverName[1],
        approverLastnameTh: spec.approverName[2],
        approverPositionTh: "ผู้อำนวยการ",
        approverEmail: spec.approverEmail,
        approverCid: orgApprover.cid,
        approverPhoneNumber: "0830000000",

        userPrefixTh: spec.userName[0],
        userFirstnameTh: spec.userName[1],
        userLastnameTh: spec.userName[2],
        userPositionTh: "นักวิเคราะห์นโยบายและแผน",
        userDepartmentTh: "กลุ่มงานข้อมูลสารสนเทศ",
        userEmail: spec.userEmail,
        userPhoneNumber: "0820000000",

        submittedAt: dt(spec.daysAgo - 1),
        approvedAt: active ? dt(spec.daysAgo - 2) : null,
        createdAt: dt(spec.daysAgo),
        createdBy: orgUser.id,
        updatedBy: orgUser.id,
      },
    });

    // ── ประวัติด่านตามสถานะที่ต้องการ ──────────────────────────
    let seq = 1;
    const t = (d: number) => dt(spec.daysAgo - d);

    if (spec.stage === ReviewTaskType.BDI_OFFICER_REVIEW && spec.returned) {
      await closedTask({
        subjectType: ORG_SUBJECT,
        subjectId: request.id,
        taskType: ReviewTaskType.BDI_OFFICER_REVIEW,
        sequenceNumber: seq++,
        assignedUserId: officer.id,
        assignedRole: ROLE_CODES.BDI_OFFICER,
        result: ReviewResult.RETURNED,
        comment: "เอกสารคำสั่งแต่งตั้งไม่ชัดเจน กรุณาแนบฉบับที่อ่านออกได้ทั้งหน้า",
        at: t(1),
      });
    } else if (spec.stage === ReviewTaskType.BDI_OFFICER_REVIEW) {
      await openTaskRow({
        subjectType: ORG_SUBJECT,
        subjectId: request.id,
        taskType: ReviewTaskType.BDI_OFFICER_REVIEW,
        sequenceNumber: seq++,
        assignedUserId: officer.id,
        assignedRole: ROLE_CODES.BDI_OFFICER,
        at: t(1),
      });
    } else if (spec.stage !== null || active) {
      // ผ่านด่าน officer มาแล้วทุกกรณีที่เหลือ
      await closedTask({
        subjectType: ORG_SUBJECT,
        subjectId: request.id,
        taskType: ReviewTaskType.BDI_OFFICER_REVIEW,
        sequenceNumber: seq++,
        assignedUserId: officer.id,
        assignedRole: ROLE_CODES.BDI_OFFICER,
        result: ReviewResult.PASSED,
        at: t(1),
      });

      if (spec.stage === ReviewTaskType.ORGANIZATION_APPROVAL) {
        await openTaskRow({
          subjectType: ORG_SUBJECT,
          subjectId: request.id,
          taskType: ReviewTaskType.ORGANIZATION_APPROVAL,
          sequenceNumber: seq++,
          assignedUserId: orgApprover.id,
          assignedRole: ROLE_CODES.ORGANIZATION_APPROVER,
          at: t(2),
        });
      } else {
        await closedTask({
          subjectType: ORG_SUBJECT,
          subjectId: request.id,
          taskType: ReviewTaskType.ORGANIZATION_APPROVAL,
          sequenceNumber: seq++,
          assignedUserId: orgApprover.id,
          assignedRole: ROLE_CODES.ORGANIZATION_APPROVER,
          result: ReviewResult.APPROVED,
          at: t(2),
        });

        if (spec.stage === ReviewTaskType.BDI_FINAL_APPROVAL) {
          await openTaskRow({
            subjectType: ORG_SUBJECT,
            subjectId: request.id,
            taskType: ReviewTaskType.BDI_FINAL_APPROVAL,
            sequenceNumber: seq++,
            assignedUserId: approver.id,
            assignedRole: ROLE_CODES.BDI_FINAL_APPROVER,
            at: t(3),
          });
        } else {
          await closedTask({
            subjectType: ORG_SUBJECT,
            subjectId: request.id,
            taskType: ReviewTaskType.BDI_FINAL_APPROVAL,
            sequenceNumber: seq++,
            assignedUserId: approver.id,
            assignedRole: ROLE_CODES.BDI_FINAL_APPROVER,
            result: ReviewResult.APPROVED,
            at: t(3),
          });
        }
      }
    }

    await prisma.organizationRegistrationRequest.update({
      where: { id: request.id },
      data: { status: await statusOf(ORG_SUBJECT, request.id, true) },
    });

    orgs[spec.code] = {
      orgId: organization.id,
      requestId: request.id,
      userId: orgUser.id,
      approverId: orgApprover.id,
    };
  }

  // ------------------------------------------- ผู้ใช้ที่เพิ่งรับคำเชิญ ยังไม่มีหน่วยงาน
  /**
   * จุดเริ่มต้นของ Journey B ที่เดินจากหน้าเว็บได้ทันทีโดยไม่ต้องยิงคำเชิญเอง
   *
   * สร้างให้เหมือนสิ่งที่ POST /api/admin/invitations ทิ้งไว้หลังผู้ใช้ยืนยัน OTP แล้ว:
   * หน่วยงานเปล่าสถานะ PENDING_REGISTRATION ชื่อ "หน่วยงานใหม่" พร้อมคำขอฉบับร่าง
   * ที่ยังไม่มีเนื้อหา — ไม่ใช่บัญชีที่ organization_id เป็น NULL ซึ่งออกคีย์ไม่ได้
   */
  console.log("สร้างผู้ใช้ที่ยังไม่มีหน่วยงาน…");

  const newcomerOrg = await prisma.organization.create({
    data: {
      organizationCode: "ORG-2026-0006",
      nameTh: PLACEHOLDER_ORGANIZATION_NAME,
      status: OrganizationStatus.PENDING_REGISTRATION,
      createdAt: dt(1),
      createdBy: SYSTEM_USER_ID,
      updatedBy: SYSTEM_USER_ID,
    },
  });

  const newcomer = await makeUser({
    email: "newbie@moi.go.th",
    prefix: "นาย",
    firstName: "ภานุพงศ์",
    lastName: "เริ่มต้น",
    phone: "0840000000",
    cid: "1101000000060",
    accountType: AccountType.ORGANIZATION,
    role: ROLE_CODES.ORGANIZATION_USER,
    organizationId: newcomerOrg.id,
  });

  await prisma.organizationRegistrationRequest.create({
    data: {
      requestNumber: "ORG-REG-2026-0006",
      organizationId: newcomerOrg.id,
      organizationCode: newcomerOrg.organizationCode,
      status: RequestStatus.DRAFT,
      userEmail: newcomer.email,
      createdAt: dt(1),
      createdBy: newcomer.id,
      updatedBy: newcomer.id,
    },
  });

  // ---------------------------------------------------------- ชุดข้อมูล
  console.log("สร้างคำขอลงทะเบียนชุดข้อมูล…");

  const nso = orgs["ORG-2026-0005"]!;

  interface DatasetSpec {
    title: string;
    stage: ReviewTaskType | null;
    result?: ReviewResult;
    daysAgo: number;
    specialist?: boolean;
    /**
     * ค้างที่ BDI_OFFICER_REVIEW **รอบสอง** คือด่านตรวจซ้ำหลังผู้มีอำนาจลงนามแล้ว
     *
     * ด่านตรวจรอบแรกกับด่านตรวจซ้ำใช้ task_type เดียวกัน ต่างกันตรงที่มี
     * ORGANIZATION_APPROVAL ปิดไปแล้วหรือยัง — ธงนี้บอกให้ seed เดินไปทางนั้น
     */
    recheck?: boolean;
    /** ทับค่า metadata ตั้งต้น เพื่อให้ตัวอย่างครอบคลุมหลายกิ่งของชีท conditions */
    metadata?: Partial<MetadataValues>;
  }

  /**
   * metadata ตัวอย่างหนึ่งชุด — ผ่าน normaliseMetadata() เหมือนที่ API ทำ
   * ถ้า seed เขียนคอลัมน์เองตรง ๆ fixtures จะขัดกับกฎในชีทได้ (เช่น หมวดสาธารณะ
   * แต่ไม่อนุญาตให้ส่งต่อข้อมูลรวม) แล้วหน้าจอจะแสดงสิ่งที่ผู้ใช้กรอกแบบนั้นไม่ได้
   */
  function datasetMetadataFixture(spec: DatasetSpec) {
    const values = normaliseMetadata({
      ...EMPTY_METADATA,
      dataType: "3",
      dataTopic: "05",
      title: spec.title,
      name: "Sample dataset",
      maintainer: "กลุ่มงานสถิติสารสนเทศ",
      maintainerEmail: "user@nso.go.th",
      tagString: "สถิติ,ราชการ",
      notes: `${spec.title} — ชุดข้อมูลตัวอย่างสำหรับสาธิตระบบ จัดทำโดยสำนักงานสถิติแห่งชาติ เพื่อใช้ทดสอบกระบวนการลงทะเบียนชุดข้อมูลตั้งแต่ต้นจนจบ`,
      objective:
        "ใช้สาธิตกระบวนการลงทะเบียนชุดข้อมูลตั้งแต่ร่างจนถึงอนุมัติ และใช้ทดสอบการแสดงผลของแบบฟอร์มที่ระบบสร้าง",
      updateFrequencyUnit: "M",
      updateFrequencyInterval: 1,
      deliveryFrequency: "2",
      geoCoverage: "06",
      dataSource: "สำมะโนประชากรและเคหะ (สำนักงานสถิติแห่งชาติ)",
      dataFormat: "3",
      dataCategory: "a",
      ...spec.metadata,
    });
    return toMetadataColumns(values);
  }

  const datasetSpecs: DatasetSpec[] = [
    { title: "ทะเบียนที่ตั้งหน่วยบริการประชาชน", stage: null, daysAgo: 3 }, // ร่าง
    { title: "สถิติผู้มาใช้บริการศูนย์ราชการรายเดือน", stage: ReviewTaskType.BDI_OFFICER_REVIEW, daysAgo: 8 },
    {
      title: "ดัชนีราคาผู้บริโภครายจังหวัด",
      stage: ReviewTaskType.BDI_OFFICER_REVIEW,
      result: ReviewResult.RETURNED,
      daysAgo: 11,
    },
    {
      // ตัวอย่างที่เดินกิ่ง "มีข้อมูลส่วนบุคคล" ของชีท conditions ครบทั้งแถว
      title: "จำนวนประชากรแยกตามช่วงอายุรายตำบล",
      stage: ReviewTaskType.ORGANIZATION_APPROVAL,
      daysAgo: 14,
      metadata: {
        dataType: "1",
        dataCategory: "b",
        containsPersonalData: true,
        personalDataTypes: "ชื่อ-นามสกุล เลขประจำตัวประชาชน วันเดือนปีเกิด ที่อยู่ตามทะเบียนบ้าน",
        dataSubjectCategories: "ประชาชนที่มีชื่ออยู่ในทะเบียนบ้านในเขตพื้นที่รับผิดชอบ",
        personalDataProcessingPeriod: "b",
        personalDataProcessingPeriodYear: 3,
        personalDataProcessingPeriodMonth: 6,
        dataClassification: "03",
        allowOriginalRawDataRetention: true,
        allowOriginalRawDataSharing: false,
        allowTransformedRawDataSharing: true,
        transformedRawDataRecipients: "กรมการปกครอง, สำนักงานสภาพัฒนาการเศรษฐกิจและสังคมแห่งชาติ",
        allowTransformedRawDataGdxSharing: false,
        allowAggregatedDataSharing: true,
        aggregatedDataRecipients: "หน่วยงานของรัฐที่ร้องขอผ่านระบบกลาง",
        authorizePersonalDataAnonymization: true,
      },
    },
    {
      title: "สถิติการใช้บริการขนส่งมวลชนรายเดือน",
      stage: ReviewTaskType.BDI_OFFICER_REVIEW,
      daysAgo: 17,
      specialist: true,
    },
    { title: "สถิติแรงงานนอกระบบรายไตรมาส", stage: ReviewTaskType.BDI_FINAL_APPROVAL, daysAgo: 20 },
    { title: "ทะเบียนสถานประกอบการรายจังหวัด", stage: null, result: ReviewResult.APPROVED, daysAgo: 26 },
    {
      title: "ทะเบียนผู้ประกอบการขนส่งสาธารณะ",
      stage: null,
      result: ReviewResult.REJECTED,
      daysAgo: 28,
      metadata: {
        dataType: "1",
        dataTopic: "99",
        dataTopicOther: "การกำกับดูแลผู้ประกอบการขนส่ง",
        dataCategory: "c",
        dataClassification: "04",
        dataFormat: "4",
        dataFormatOther: "ระบบเชื่อมโยงข้อมูลของกรมการขนส่งทางบก",
        updateFrequencyUnit: "U",
        allowOriginalRawDataRetention: false,
        allowTransformedRawDataSharing: false,
        allowTransformedRawDataGdxSharing: false,
        allowAggregatedDataSharing: true,
      },
    },
    {
      title: "ทะเบียนโครงการวิจัยที่ได้รับทุนภาครัฐ",
      stage: ReviewTaskType.BDI_OFFICER_REVIEW,
      recheck: true,
      daysAgo: 22,
    },
  ];

  for (const [index, spec] of datasetSpecs.entries()) {
    const isDraft = spec.stage === null && !spec.result;
    const t = (d: number) => dt(spec.daysAgo - d);
    const { columns, extra } = datasetMetadataFixture(spec);

    const request = await prisma.datasetRegistrationRequest.create({
      data: {
        requestNumber: `DS-REG-2026-${String(index + 1).padStart(4, "0")}`,
        organizationId: nso.orgId,
        status: RequestStatus.DRAFT,
        proposedTitle: spec.title,
        submittedAt: isDraft ? null : dt(spec.daysAgo),
        approvedAt: spec.result === ReviewResult.APPROVED ? t(4) : null,
        rejectedAt: spec.result === ReviewResult.REJECTED ? t(3) : null,
        createdAt: dt(spec.daysAgo + 1),
        createdBy: nso.userId,
        updatedBy: nso.userId,
        metadata: {
          create: {
            ...columns,
            ownerOrgId: nso.orgId,
            additionalMetadataJson: extra as Prisma.InputJsonValue,
            createdBy: nso.userId,
            updatedBy: nso.userId,
          },
        },
      },
    });

    if (isDraft) continue;

    let seq = 1;

    if (spec.specialist) {
      // officer มอบหมายผู้เชี่ยวชาญ แล้วผู้เชี่ยวชาญบันทึกความเห็นกลับมา
      await closedTask({
        subjectType: DS_SUBJECT,
        subjectId: request.id,
        taskType: ReviewTaskType.DATASET_SPECIALIST_REVIEW,
        sequenceNumber: seq++,
        assignedUserId: specialist.id,
        assignedRole: ROLE_CODES.BDI_DATASET_SPECIALIST,
        result: ReviewResult.CONFIRMED,
        comment: "โครงสร้างข้อมูลเหมาะสม แนะนำให้ระบุหน่วยนับในพจนานุกรมข้อมูลให้ครบ",
        at: t(1),
      });
    }

    if (spec.result === ReviewResult.RETURNED) {
      await closedTask({
        subjectType: DS_SUBJECT,
        subjectId: request.id,
        taskType: ReviewTaskType.BDI_OFFICER_REVIEW,
        sequenceNumber: seq++,
        assignedUserId: officer.id,
        assignedRole: ROLE_CODES.BDI_OFFICER,
        result: ReviewResult.RETURNED,
        comment: "กรุณาระบุฐานอำนาจตามกฎหมายและแนบตัวอย่างข้อมูลเพิ่มเติม",
        at: t(2),
      });
    } else if (spec.stage === ReviewTaskType.BDI_OFFICER_REVIEW && !spec.recheck) {
      await openTaskRow({
        subjectType: DS_SUBJECT,
        subjectId: request.id,
        taskType: ReviewTaskType.BDI_OFFICER_REVIEW,
        sequenceNumber: seq++,
        roundNumber: spec.specialist ? 2 : 1,
        assignedUserId: officer.id,
        assignedRole: ROLE_CODES.BDI_OFFICER,
        at: t(2),
      });
    } else {
      await closedTask({
        subjectType: DS_SUBJECT,
        subjectId: request.id,
        taskType: ReviewTaskType.BDI_OFFICER_REVIEW,
        sequenceNumber: seq++,
        assignedUserId: officer.id,
        assignedRole: ROLE_CODES.BDI_OFFICER,
        result: ReviewResult.PASSED,
        at: t(2),
      });

      if (spec.stage === ReviewTaskType.ORGANIZATION_APPROVAL) {
        await openTaskRow({
          subjectType: DS_SUBJECT,
          subjectId: request.id,
          taskType: ReviewTaskType.ORGANIZATION_APPROVAL,
          sequenceNumber: seq++,
          assignedUserId: nso.approverId,
          assignedRole: ROLE_CODES.ORGANIZATION_APPROVER,
          at: t(3),
        });
      } else {
        const orgApprovalTask = await closedTask({
          subjectType: DS_SUBJECT,
          subjectId: request.id,
          taskType: ReviewTaskType.ORGANIZATION_APPROVAL,
          sequenceNumber: seq++,
          assignedUserId: nso.approverId,
          assignedRole: ROLE_CODES.ORGANIZATION_APPROVER,
          result: ReviewResult.APPROVED,
          at: t(3),
        });

        // ลงนามของผู้มีอำนาจ — signature.signature_confirmation
        await prisma.signatureConfirmation.create({
          data: {
            reviewTaskId: orgApprovalTask.id,
            subjectType: DS_SUBJECT,
            subjectId: request.id,
            userAccountId: nso.approverId,
            organizationId: nso.orgId,
            confirmationType: "ORGANIZATION_APPROVAL",
            confirmationText:
              "ข้าพเจ้ารับรองว่าข้อมูลในคำขอนี้ถูกต้อง และได้อ่านและยอมรับเอกสารทางกฎหมายที่เกี่ยวข้องครบถ้วนแล้ว",
            confirmationPayloadJson: {
              schemaVersion: 1,
              subjectType: DS_SUBJECT,
              subjectId: request.id,
              requestNumber: request.requestNumber,
              reviewTaskId: orgApprovalTask.id,
              taskType: ReviewTaskType.ORGANIZATION_APPROVAL,
            } as Prisma.InputJsonValue,
            confirmedAt: t(3),
            ipAddress: "203.0.113.10",
            createdBy: nso.approverId,
          },
        });

        // ตรวจซ้ำโดย officer — BDI_OFFICER_REVIEW รอบที่สอง
        if (spec.recheck) {
          await openTaskRow({
            subjectType: DS_SUBJECT,
            subjectId: request.id,
            taskType: ReviewTaskType.BDI_OFFICER_REVIEW,
            sequenceNumber: seq++,
            roundNumber: 2,
            assignedUserId: officer.id,
            assignedRole: ROLE_CODES.BDI_OFFICER,
            at: t(4),
          });
        } else if (spec.stage === ReviewTaskType.BDI_FINAL_APPROVAL || spec.result) {
          await closedTask({
            subjectType: DS_SUBJECT,
            subjectId: request.id,
            taskType: ReviewTaskType.BDI_OFFICER_REVIEW,
            sequenceNumber: seq++,
            roundNumber: 2,
            assignedUserId: officer.id,
            assignedRole: ROLE_CODES.BDI_OFFICER,
            result: ReviewResult.CONFIRMED,
            at: t(4),
          });
        }

        if (spec.stage === ReviewTaskType.BDI_FINAL_APPROVAL) {
          await openTaskRow({
            subjectType: DS_SUBJECT,
            subjectId: request.id,
            taskType: ReviewTaskType.BDI_FINAL_APPROVAL,
            sequenceNumber: seq++,
            assignedUserId: approver.id,
            assignedRole: ROLE_CODES.BDI_FINAL_APPROVER,
            at: t(5),
          });
        } else if (spec.result) {
          await closedTask({
            subjectType: DS_SUBJECT,
            subjectId: request.id,
            taskType: ReviewTaskType.BDI_FINAL_APPROVAL,
            sequenceNumber: seq++,
            assignedUserId: approver.id,
            assignedRole: ROLE_CODES.BDI_FINAL_APPROVER,
            result: spec.result,
            comment:
              spec.result === ReviewResult.REJECTED
                ? "ชุดข้อมูลซ้ำซ้อนกับที่หน่วยงานอื่นนำส่งแล้ว จึงไม่รับลงทะเบียน"
                : null,
            at: t(5),
          });
        }
      }
    }

    // คำขอที่อนุมัติแล้วต้องมี dataset จริง (ขั้นที่ 3–7 ของภาพใน sheet)
    if (spec.result === ReviewResult.APPROVED) {
      const metadata = await prisma.datasetRegistrationMetadata.findUniqueOrThrow({
        where: { datasetRegistrationRequestId: request.id },
      });
      const {
        id: _metadataId,
        datasetRegistrationRequestId: _requestId,
        createdAt: _metadataCreatedAt,
        createdBy: _metadataCreatedBy,
        updatedAt: _metadataUpdatedAt,
        updatedBy: _metadataUpdatedBy,
        ...copiedMetadata
      } = metadata;

      const dataset = await prisma.dataset.create({
        data: {
          datasetCode: await nextDatasetCode(prisma),
          organizationId: nso.orgId,
          status: DatasetStatus.ACTIVE,
          sourceDatasetRegistrationRequestId: request.id,
          activatedAt: t(4),
          activatedBy: approver.id,
          createdBy: approver.id,
          updatedBy: approver.id,
          metadata: {
            // คัดลอกทั้งแถวแบบเดียวกับ materialiseDataset() ใน routes/dataset-requests.ts
            create: {
              ...copiedMetadata,
              additionalMetadataJson: metadata.additionalMetadataJson ?? Prisma.DbNull,
              createdBy: approver.id,
              updatedBy: approver.id,
            },
          },
        },
      });

      await prisma.datasetRegistrationRequest.update({
        where: { id: request.id },
        data: { createdDatasetId: dataset.id },
      });

      await prisma.integrationOperation.create({
        data: {
          integrationType: IntegrationType.DII,
          operation: "PUBLISH_DATASET_REFERENCE",
          subjectType: "DATASET",
          subjectId: dataset.id,
          organizationId: nso.orgId,
          idempotencyKey: `DII:PUBLISH_DATASET_REFERENCE:${dataset.id}`,
          correlationId: randomUUID(),
        },
      });
    }

    await prisma.datasetRegistrationRequest.update({
      where: { id: request.id },
      data: { status: await statusOf(DS_SUBJECT, request.id, true) },
    });
  }

  // ---------------------------------------------------------- สรุป
  const counts = {
    users: await prisma.userAccount.count(),
    organizations: await prisma.organization.count(),
    orgRequests: await prisma.organizationRegistrationRequest.count(),
    datasetRequests: await prisma.datasetRegistrationRequest.count(),
    datasets: await prisma.dataset.count(),
    reviewTasks: await prisma.reviewTask.count(),
    signatures: await prisma.signatureConfirmation.count(),
    integrations: await prisma.integrationOperation.count(),
  };

  console.log("\nเสร็จแล้ว —", JSON.stringify(counts));
  console.log(`รหัสผ่านของทุกบัญชี: ${PASSWORD}`);
  console.log(
    `บัญชี BDI: ${officer.email} · ${approver.email} · ${specialist.email} · ${legalOfficer.email}`,
  );
}

/** สถานะที่ derive จาก review_task — ใช้ตัวเดียวกับ runtime เพื่อให้ fixture ตรงกับของจริง */
async function statusOf(
  subjectType: SubjectType,
  subjectId: string,
  hasSubmitted: boolean,
): Promise<RequestStatus> {
  const { deriveRequestStatus } = await import("../lib/workflow.js");
  return deriveRequestStatus(prisma, { subjectType, subjectId, hasSubmitted, cancelled: false });
}

runWithContext({ sourceComponent: "seed-demo" }, () =>
  main()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect()),
);
