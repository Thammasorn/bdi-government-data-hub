/**
 * สร้างข้อมูลตัวอย่างสำหรับทดลองใช้งาน — บัญชีครบทุก role และหน่วยงานครบทุกสถานะ
 * รันซ้ำได้ (ล้างของเดิมก่อนเสมอ)
 *
 *   docker compose exec backend npm run seed:demo
 */
import { randomUUID } from "node:crypto";

import {
  AttachmentKind,
  DataClassification,
  DataFormat,
  DatasetAttachmentKind,
  DatasetCategory,
  DatasetRequestEventType,
  DatasetRequestStatus,
  DatasetType,
  DeliveryMethod,
  GeoCoverage,
  LicenseType,
  OrganizationEventType,
  OrganizationStatus,
  Role,
  UpdateFrequency,
  UserStatus,
  type DatasetRequest,
  type Organization,
  type Prisma,
} from "@prisma/client";

import { prisma } from "../db.js";
import { hashPassword } from "../lib/auth.js";
import { renderDatasetRegistrationForm, renderOrganizationForm } from "../lib/pdf.js";
import { BUCKET, ensureBucket, minio } from "../storage.js";

const PASSWORD = "bdi12345";

const dt = (daysAgo: number, hour = 10) => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, 0, 0, 0);
  return d;
};

async function makeUser(opts: {
  email: string;
  prefix: string;
  firstName: string;
  lastName: string;
  phone: string;
  roles: Role[];
  organizationId?: string | null;
}) {
  return prisma.user.create({
    data: {
      email: opts.email,
      prefix: opts.prefix,
      firstName: opts.firstName,
      lastName: opts.lastName,
      phone: opts.phone,
      roles: opts.roles,
      status: UserStatus.ACTIVE,
      passwordHash: await hashPassword(PASSWORD),
      emailVerifiedAt: dt(30),
      organizationId: opts.organizationId ?? null,
    },
  });
}

/** อัปโหลดไฟล์ตัวอย่าง (คำสั่งแต่งตั้ง) + PDF ที่ระบบสร้าง ให้หน่วยงานหนึ่ง */
async function attachDocuments(org: Organization, uploadedById: string) {
  const placeholder = Buffer.from(
    "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
      "2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
  );
  const orderKey = `organizations/${org.id}/APPOINTMENT_ORDER/${randomUUID()}`;
  await minio.putObject(BUCKET, orderKey, placeholder, placeholder.length, {
    "Content-Type": "application/pdf",
  });

  const form = await renderOrganizationForm(org);
  const formKey = `organizations/${org.id}/form/${randomUUID()}.pdf`;
  await minio.putObject(BUCKET, formKey, form, form.length, { "Content-Type": "application/pdf" });

  await prisma.attachment.createMany({
    data: [
      {
        kind: AttachmentKind.APPOINTMENT_ORDER,
        objectKey: orderKey,
        filename: `คำสั่งแต่งตั้ง-${org.name}.pdf`,
        mimeType: "application/pdf",
        sizeBytes: placeholder.length,
        organizationId: org.id,
        uploadedById,
      },
      {
        kind: AttachmentKind.GENERATED_FORM,
        objectKey: formKey,
        filename: `แบบฟอร์มสร้างหน่วยงาน-${org.name}.pdf`,
        mimeType: "application/pdf",
        sizeBytes: form.length,
        organizationId: org.id,
        uploadedById,
      },
    ],
  });
}

async function addEvents(
  organizationId: string,
  entries: Array<{
    type: OrganizationEventType;
    actorId: string | null;
    from?: OrganizationStatus;
    to?: OrganizationStatus;
    note?: string;
    at: Date;
  }>,
) {
  for (const e of entries) {
    await prisma.organizationEvent.create({
      data: {
        organizationId,
        type: e.type,
        actorId: e.actorId,
        fromStatus: e.from ?? null,
        toStatus: e.to ?? null,
        note: e.note ?? null,
        createdAt: e.at,
      },
    });
  }
}

async function main() {
  await ensureBucket();

  console.log("ล้างข้อมูลเดิม…");
  await prisma.activityLog.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.datasetRequestEvent.deleteMany();
  await prisma.datasetAttachment.deleteMany();
  await prisma.datasetRequest.deleteMany();
  await prisma.organizationEvent.deleteMany();
  await prisma.attachment.deleteMany();
  await prisma.invitation.deleteMany();
  await prisma.otpCode.deleteMany();
  await prisma.user.updateMany({ data: { organizationId: null } });
  await prisma.organization.deleteMany();
  await prisma.user.deleteMany();

  // ---------------------------------------------------------- เจ้าหน้าที่ BDI
  const officer = await makeUser({
    email: "officer@bdi.or.th",
    prefix: "นาย",
    firstName: "ธนกร",
    lastName: "ตรวจสอบ",
    phone: "0810000001",
    roles: [Role.BDI_OFFICER],
  });
  const approver = await makeUser({
    email: "approver@bdi.or.th",
    prefix: "นาง",
    firstName: "สุดารัตน์",
    lastName: "อนุมัติ",
    phone: "0810000002",
    roles: [Role.BDI_APPROVER],
  });
  const specialist = await makeUser({
    email: "specialist@bdi.or.th",
    prefix: "นาย",
    firstName: "ปกรณ์",
    lastName: "วิเคราะห์",
    phone: "0810000003",
    roles: [Role.BDI_SPECIALIST],
  });

  // ---------------------------------------------------------- หน่วยงานตัวอย่าง
  const base = (
    name: string,
    over: Partial<Prisma.OrganizationCreateInput> = {},
  ): Prisma.OrganizationCreateInput => ({
    name,
    addressLine: "88 หมู่ 4 ถนนติวานนท์",
    province: "นนทบุรี",
    district: "เมืองนนทบุรี",
    subdistrict: "ตลาดขวัญ",
    postalCode: "11000",
    email: "contact@agency.go.th",
    signatoryPrefix: "นาย",
    signatoryFirstName: "วิชัย",
    signatoryLastName: "อำนาจเต็ม",
    signatoryPosition: "ผู้อำนวยการ",
    signatoryEmail: "signatory@agency.go.th",
    signatoryNationalId: "1101700207994",
    signatoryPhone: "0898765432",
    contactPrefix: "นาย",
    contactFirstName: "สมชาย",
    contactLastName: "ใจดี",
    contactPosition: "นักวิชาการคอมพิวเตอร์ชำนาญการ",
    contactDepartment: "กลุ่มงานเทคโนโลยีสารสนเทศ",
    contactEmail: "somchai@moph.go.th",
    contactPhone: "0812345678",
    createdBy: { connect: { id: "" } },
    ...over,
  });

  type Spec = {
    name: string;
    status: OrganizationStatus;
    owner: { email: string; prefix: string; first: string; last: string; phone: string };
    over?: Partial<Prisma.OrganizationCreateInput>;
    submittedDaysAgo?: number;
    events: (ids: { org: string; owner: string }) => Parameters<typeof addEvents>[1];
  };

  const specs: Spec[] = [
    {
      name: "สำนักงานสาธารณสุขจังหวัดเชียงใหม่",
      status: OrganizationStatus.PENDING_BDI_REVIEW,
      owner: { email: "somchai@moph.go.th", prefix: "นาย", first: "สมชาย", last: "ใจดี", phone: "0812345678" },
      over: {
        province: "เชียงใหม่",
        district: "เมืองเชียงใหม่",
        subdistrict: "สุเทพ",
        postalCode: "50200",
        addressLine: "10 ถนนสุเทพ",
        email: "contact@cmpho.go.th",
        signatoryPosition: "นายแพทย์สาธารณสุขจังหวัด",
        signatoryEmail: "wichai@cmpho.go.th",
      },
      submittedDaysAgo: 2,
      events: ({ org, owner }) => [
        { type: OrganizationEventType.CREATED, actorId: owner, to: OrganizationStatus.DRAFT, at: dt(3) },
        {
          type: OrganizationEventType.SUBMITTED,
          actorId: owner,
          from: OrganizationStatus.DRAFT,
          to: OrganizationStatus.PENDING_BDI_REVIEW,
          at: dt(2),
        },
        void org,
      ].filter(Boolean) as never,
    },
    {
      name: "กรมที่ดิน",
      status: OrganizationStatus.NEEDS_REVISION,
      owner: { email: "malee@dol.go.th", prefix: "นางสาว", first: "มาลี", last: "ตั้งใจ", phone: "0823334444" },
      over: {
        email: "contact@dol.go.th",
        contactEmail: "malee@dol.go.th",
        contactFirstName: "มาลี",
        contactLastName: "ตั้งใจ",
        contactPrefix: "นางสาว",
        revisionNote:
          "เลขบัตรประชาชนของผู้มีอำนาจกระทำการแทนไม่ตรงกับคำสั่งแต่งตั้งที่แนบมา\nและกรุณาแนบคำสั่งแต่งตั้งฉบับที่มีลายเซ็นครบถ้วน",
      },
      submittedDaysAgo: 5,
      events: ({ owner }) => [
        { type: OrganizationEventType.CREATED, actorId: owner, to: OrganizationStatus.DRAFT, at: dt(6) },
        {
          type: OrganizationEventType.SUBMITTED,
          actorId: owner,
          from: OrganizationStatus.DRAFT,
          to: OrganizationStatus.PENDING_BDI_REVIEW,
          at: dt(5),
        },
        {
          type: OrganizationEventType.BDI_REVISION_REQUESTED,
          actorId: officer.id,
          from: OrganizationStatus.PENDING_BDI_REVIEW,
          to: OrganizationStatus.NEEDS_REVISION,
          note: "เลขบัตรประชาชนของผู้มีอำนาจกระทำการแทนไม่ตรงกับคำสั่งแต่งตั้งที่แนบมา",
          at: dt(4),
        },
      ],
    },
    {
      name: "สำนักงานพัฒนาสังคมและความมั่นคงของมนุษย์จังหวัดขอนแก่น",
      status: OrganizationStatus.PENDING_SIGNATORY_REVIEW,
      owner: { email: "pranee@m-society.go.th", prefix: "นาง", first: "ปราณี", last: "รอบคอบ", phone: "0834445555" },
      over: {
        province: "ขอนแก่น",
        district: "เมืองขอนแก่น",
        subdistrict: "ในเมือง",
        postalCode: "40000",
        email: "contact@kkpso.go.th",
        signatoryEmail: "wichai@cmpho.go.th",
        contactEmail: "pranee@m-society.go.th",
        contactFirstName: "ปราณี",
        contactLastName: "รอบคอบ",
        contactPrefix: "นาง",
      },
      submittedDaysAgo: 8,
      events: ({ owner }) => [
        { type: OrganizationEventType.CREATED, actorId: owner, to: OrganizationStatus.DRAFT, at: dt(9) },
        {
          type: OrganizationEventType.SUBMITTED,
          actorId: owner,
          from: OrganizationStatus.DRAFT,
          to: OrganizationStatus.PENDING_BDI_REVIEW,
          at: dt(8),
        },
        {
          type: OrganizationEventType.BDI_APPROVED,
          actorId: officer.id,
          from: OrganizationStatus.PENDING_BDI_REVIEW,
          to: OrganizationStatus.PENDING_SIGNATORY_REVIEW,
          at: dt(7),
        },
      ],
    },
    {
      name: "กรมการปกครอง",
      status: OrganizationStatus.PENDING_BDI_APPROVAL,
      owner: { email: "anucha@dopa.go.th", prefix: "นาย", first: "อนุชา", last: "มุ่งมั่น", phone: "0845556666" },
      over: {
        province: "กรุงเทพมหานคร",
        district: "พระนคร",
        subdistrict: "วัดสามพระยา",
        postalCode: "10200",
        email: "contact@dopa.go.th",
        signatoryEmail: "wichai@cmpho.go.th",
        contactEmail: "anucha@dopa.go.th",
        contactFirstName: "อนุชา",
        contactLastName: "มุ่งมั่น",
      },
      submittedDaysAgo: 12,
      events: ({ owner }) => [
        { type: OrganizationEventType.CREATED, actorId: owner, to: OrganizationStatus.DRAFT, at: dt(13) },
        {
          type: OrganizationEventType.SUBMITTED,
          actorId: owner,
          from: OrganizationStatus.DRAFT,
          to: OrganizationStatus.PENDING_BDI_REVIEW,
          at: dt(12),
        },
        {
          type: OrganizationEventType.BDI_APPROVED,
          actorId: officer.id,
          from: OrganizationStatus.PENDING_BDI_REVIEW,
          to: OrganizationStatus.PENDING_SIGNATORY_REVIEW,
          at: dt(11),
        },
        {
          type: OrganizationEventType.SIGNATORY_APPROVED,
          actorId: null,
          from: OrganizationStatus.PENDING_SIGNATORY_REVIEW,
          to: OrganizationStatus.PENDING_BDI_APPROVAL,
          at: dt(10),
        },
      ],
    },
    {
      name: "สำนักงานสถิติแห่งชาติ",
      status: OrganizationStatus.ACTIVE,
      owner: { email: "kanya@nso.go.th", prefix: "นางสาว", first: "กัญญา", last: "เรียบร้อย", phone: "0856667777" },
      over: {
        province: "กรุงเทพมหานคร",
        district: "หลักสี่",
        subdistrict: "ทุ่งสองห้อง",
        postalCode: "10210",
        email: "contact@nso.go.th",
        signatoryEmail: "wichai@cmpho.go.th",
        contactEmail: "kanya@nso.go.th",
        contactFirstName: "กัญญา",
        contactLastName: "เรียบร้อย",
        contactPrefix: "นางสาว",
        activatedAt: dt(14),
      },
      submittedDaysAgo: 20,
      events: ({ owner }) => [
        { type: OrganizationEventType.CREATED, actorId: owner, to: OrganizationStatus.DRAFT, at: dt(21) },
        {
          type: OrganizationEventType.SUBMITTED,
          actorId: owner,
          from: OrganizationStatus.DRAFT,
          to: OrganizationStatus.PENDING_BDI_REVIEW,
          at: dt(20),
        },
        {
          type: OrganizationEventType.BDI_APPROVED,
          actorId: officer.id,
          from: OrganizationStatus.PENDING_BDI_REVIEW,
          to: OrganizationStatus.PENDING_SIGNATORY_REVIEW,
          at: dt(18),
        },
        {
          type: OrganizationEventType.SIGNATORY_APPROVED,
          actorId: null,
          from: OrganizationStatus.PENDING_SIGNATORY_REVIEW,
          to: OrganizationStatus.PENDING_BDI_APPROVAL,
          at: dt(16),
        },
        {
          type: OrganizationEventType.FINAL_APPROVED,
          actorId: approver.id,
          from: OrganizationStatus.PENDING_BDI_APPROVAL,
          to: OrganizationStatus.ACTIVE,
          at: dt(14),
        },
      ],
    },
  ];

  const seeded: Array<{ org: Organization; ownerId: string }> = [];

  for (const spec of specs) {
    const owner = await makeUser({
      email: spec.owner.email,
      prefix: spec.owner.prefix,
      firstName: spec.owner.first,
      lastName: spec.owner.last,
      phone: spec.owner.phone,
      roles: [Role.ORGANIZATION_USER],
    });

    const org = await prisma.organization.create({
      data: {
        ...base(spec.name, spec.over),
        status: spec.status,
        submittedAt: spec.submittedDaysAgo ? dt(spec.submittedDaysAgo) : null,
        createdBy: { connect: { id: owner.id } },
      },
    });
    await prisma.user.update({ where: { id: owner.id }, data: { organizationId: org.id } });
    await attachDocuments(org, owner.id);
    await addEvents(org.id, spec.events({ org: org.id, owner: owner.id }));
    seeded.push({ org, ownerId: owner.id });
    console.log(`  ✓ ${spec.name} [${spec.status}] — เจ้าของ ${owner.email}`);
  }

  // ผู้มีอำนาจกระทำการแทน ใช้อีเมลเดียวกับที่ระบุไว้ในหลายหน่วยงาน
  await makeUser({
    email: "wichai@cmpho.go.th",
    prefix: "นาย",
    firstName: "วิชัย",
    lastName: "อำนาจเต็ม",
    phone: "0898765432",
    roles: [Role.ORGANIZATION_APPROVER],
  });

  // ผู้ใช้ที่ยังไม่มีหน่วยงาน — ไว้ดูหน้า empty state
  await makeUser({
    email: "newbie@moi.go.th",
    prefix: "นางสาว",
    firstName: "ปรียา",
    lastName: "เริ่มต้น",
    phone: "0867778888",
    roles: [Role.ORGANIZATION_USER],
  });

  // ------------------------------------------------- คำขอลงทะเบียนชุดข้อมูล
  // ยื่นได้เฉพาะหน่วยงานที่ ACTIVE แล้ว (docs/01-user-journey.md §4.1)
  const active = seeded.find(({ org }) => org.status === OrganizationStatus.ACTIVE);
  if (active) {
    console.log("สร้างคำขอลงทะเบียนชุดข้อมูล…");
    await seedDatasetRequests(active.org, active.ownerId, {
      officer: officer.id,
      approver: approver.id,
      specialist: specialist.id,
    });
  }

  console.log(`
เสร็จแล้ว — ทุกบัญชีใช้รหัสผ่าน: ${PASSWORD}

  officer@bdi.or.th      เจ้าหน้าที่ BDI        มีงานรอตรวจทั้งหน่วยงานและชุดข้อมูล
  approver@bdi.or.th     ผู้อนุมัติ BDI          มีงานรอลงนามและรออนุมัติชุดข้อมูล
  specialist@bdi.or.th   ผู้เชี่ยวชาญ BDI        มีชุดข้อมูลที่ได้รับมอบหมาย 1 รายการ
  wichai@cmpho.go.th     ผู้มีอำนาจกระทำการแทน  มีงานรอเห็นชอบทั้งสองเส้นทาง
  kanya@nso.go.th        ผู้ใช้หน่วยงาน          หน่วยงานเปิดใช้งานแล้ว มีคำขอชุดข้อมูลครบทุกสถานะ
  somchai@moph.go.th     ผู้ใช้หน่วยงาน          คำขอสร้างหน่วยงานอยู่ระหว่างตรวจสอบ
  malee@dol.go.th        ผู้ใช้หน่วยงาน          ถูกส่งกลับให้แก้ไข
  newbie@moi.go.th       ผู้ใช้หน่วยงาน          ยังไม่มีหน่วยงาน (หน้า empty state)
`);
}

// -------------------------------------------------------------- ชุดข้อมูล

/** ข้อมูลที่กรอกครบตามที่ submit ผ่าน — spec แต่ละอันค่อยทับเฉพาะที่ต่าง */
function datasetBase(): Omit<
  Prisma.DatasetRequestCreateInput,
  "requestNumber" | "organization" | "createdBy"
> {
  return {
    nameTh: "สถิติผู้มาใช้บริการศูนย์ราชการรายเดือน",
    nameEn: "Monthly Government Service Center Visitors",
    description:
      "จำนวนผู้มาใช้บริการของศูนย์ราชการรายเดือน แยกตามประเภทบริการและช่วงอายุ รวบรวมจากระบบคิวอัตโนมัติของแต่ละศูนย์ ใช้สำหรับวางแผนกำลังคนและปรับปรุงคุณภาพบริการ",
    datasetType: DatasetType.STATISTIC,
    category: DatasetCategory.GOVERNMENT,
    keywords: ["บริการภาครัฐ", "สถิติผู้ใช้บริการ", "ศูนย์ราชการ"],
    updateFrequency: UpdateFrequency.MONTHLY,
    geoCoverage: GeoCoverage.NATIONAL,
    dataStartDate: new Date("2020-01-01T00:00:00.000Z"),
    estimatedRecords: 480_000,
    stewardName: "นางสาวกัญญา เรียบร้อย",
    stewardEmail: "kanya@nso.go.th",
    stewardPhone: "0856667777",

    deliveryMethod: DeliveryMethod.API,
    dataFormat: DataFormat.JSON,
    deliveryFrequency: UpdateFrequency.MONTHLY,
    deliveryEndpoint: "https://api.nso.go.th/v1/service-center-visitors",
    technicalContactName: "นายภาคภูมิ ระบบดี",
    technicalContactEmail: "it@nso.go.th",
    deliveryNote: "ต้องใช้ API key ที่ออกให้เป็นรายระบบ ปรับปรุงข้อมูลทุกวันที่ 5 ของเดือนถัดไป",

    dataClassification: DataClassification.PUBLIC,
    hasPersonalData: false,
    legalBasis:
      "พระราชบัญญัติสถิติ พ.ศ. 2550 มาตรา 6 ประกอบระเบียบสำนักนายกรัฐมนตรีว่าด้วยการเปิดเผยข้อมูลภาครัฐ",
    licenseType: LicenseType.OPEN_GOVERNMENT,
    usageRestriction: "อ้างอิงแหล่งที่มาทุกครั้งที่นำไปเผยแพร่ต่อ",
    legalAcceptedAt: dt(9),
  };
}

async function attachDatasetDocuments(request: DatasetRequest & { organization: { name: string } }) {
  const dictionary = Buffer.from(
    "column_name,data_type,description\nvisit_month,date,เดือนที่ให้บริการ\nservice_type,string,ประเภทบริการ\nvisitors,integer,จำนวนผู้ใช้บริการ\n",
    "utf8",
  );
  const dictKey = `dataset-requests/${request.id}/DATA_DICTIONARY/${randomUUID()}`;
  await minio.putObject(BUCKET, dictKey, dictionary, dictionary.length, {
    "Content-Type": "text/csv",
  });

  const form = await renderDatasetRegistrationForm({ ...request, attachments: [] });
  const formKey = `dataset-requests/${request.id}/form/${randomUUID()}.pdf`;
  await minio.putObject(BUCKET, formKey, form, form.length, { "Content-Type": "application/pdf" });

  await prisma.datasetAttachment.createMany({
    data: [
      {
        kind: DatasetAttachmentKind.DATA_DICTIONARY,
        objectKey: dictKey,
        filename: `พจนานุกรมข้อมูล-${request.requestNumber}.csv`,
        mimeType: "text/csv",
        sizeBytes: dictionary.length,
        datasetRequestId: request.id,
      },
      {
        kind: DatasetAttachmentKind.GENERATED_FORM,
        objectKey: formKey,
        filename: `แบบฟอร์มลงทะเบียนชุดข้อมูล-${request.requestNumber}.pdf`,
        mimeType: "application/pdf",
        sizeBytes: form.length,
        datasetRequestId: request.id,
      },
    ],
  });
}

async function seedDatasetRequests(
  org: Organization,
  ownerId: string,
  bdi: { officer: string; approver: string; specialist: string },
) {
  const year = new Date().getFullYear();
  const approverName = "นายวิชัย อำนาจเต็ม";

  type DatasetSpec = {
    nameTh: string;
    status: DatasetRequestStatus;
    over?: Partial<Prisma.DatasetRequestCreateInput>;
    submittedDaysAgo?: number;
    events: Array<{
      type: DatasetRequestEventType;
      actorId: string | null;
      from?: DatasetRequestStatus;
      to?: DatasetRequestStatus;
      note?: string;
      at: Date;
    }>;
  };

  const specs: DatasetSpec[] = [
    {
      nameTh: "ทะเบียนที่ตั้งหน่วยบริการประชาชน",
      status: DatasetRequestStatus.DRAFT,
      over: { legalAcceptedAt: null, keywords: ["หน่วยบริการ"] },
      events: [
        { type: DatasetRequestEventType.CREATED, actorId: ownerId, to: DatasetRequestStatus.DRAFT, at: dt(1) },
      ],
    },
    {
      nameTh: "สถิติผู้มาใช้บริการศูนย์ราชการรายเดือน",
      status: DatasetRequestStatus.PENDING_OFFICER_REVIEW,
      submittedDaysAgo: 3,
      over: { assignedSpecialist: { connect: { id: bdi.specialist } }, assignedAt: dt(2) },
      events: [
        { type: DatasetRequestEventType.CREATED, actorId: ownerId, to: DatasetRequestStatus.DRAFT, at: dt(4) },
        {
          type: DatasetRequestEventType.SUBMITTED,
          actorId: ownerId,
          from: DatasetRequestStatus.DRAFT,
          to: DatasetRequestStatus.PENDING_OFFICER_REVIEW,
          at: dt(3),
        },
        {
          type: DatasetRequestEventType.SPECIALIST_ASSIGNED,
          actorId: bdi.officer,
          from: DatasetRequestStatus.PENDING_OFFICER_REVIEW,
          to: DatasetRequestStatus.PENDING_OFFICER_REVIEW,
          note: "มอบหมายให้ นายปกรณ์ วิเคราะห์",
          at: dt(2),
        },
      ],
    },
    {
      nameTh: "ดัชนีราคาผู้บริโภครายจังหวัด",
      status: DatasetRequestStatus.NEEDS_REVISION,
      submittedDaysAgo: 6,
      over: {
        category: DatasetCategory.ECONOMY_FINANCE,
        revisionNote:
          "พจนานุกรมข้อมูลยังไม่ระบุหน่วยของค่าดัชนี และช่วงเวลาของข้อมูลไม่ตรงกับที่อธิบายไว้ในคำอธิบายชุดข้อมูล",
      },
      events: [
        { type: DatasetRequestEventType.CREATED, actorId: ownerId, to: DatasetRequestStatus.DRAFT, at: dt(7) },
        {
          type: DatasetRequestEventType.SUBMITTED,
          actorId: ownerId,
          from: DatasetRequestStatus.DRAFT,
          to: DatasetRequestStatus.PENDING_OFFICER_REVIEW,
          at: dt(6),
        },
        {
          type: DatasetRequestEventType.OFFICER_REVISION_REQUESTED,
          actorId: bdi.officer,
          from: DatasetRequestStatus.PENDING_OFFICER_REVIEW,
          to: DatasetRequestStatus.NEEDS_REVISION,
          note: "พจนานุกรมข้อมูลยังไม่ระบุหน่วยของค่าดัชนี",
          at: dt(5),
        },
      ],
    },
    {
      nameTh: "จำนวนประชากรแยกตามช่วงอายุรายตำบล",
      status: DatasetRequestStatus.PENDING_ORG_APPROVER,
      submittedDaysAgo: 9,
      over: { category: DatasetCategory.SOCIETY, geoCoverage: GeoCoverage.DISTRICT },
      events: [
        { type: DatasetRequestEventType.CREATED, actorId: ownerId, to: DatasetRequestStatus.DRAFT, at: dt(10) },
        {
          type: DatasetRequestEventType.SUBMITTED,
          actorId: ownerId,
          from: DatasetRequestStatus.DRAFT,
          to: DatasetRequestStatus.PENDING_OFFICER_REVIEW,
          at: dt(9),
        },
        {
          type: DatasetRequestEventType.OFFICER_FORWARDED,
          actorId: bdi.officer,
          from: DatasetRequestStatus.PENDING_OFFICER_REVIEW,
          to: DatasetRequestStatus.PENDING_ORG_APPROVER,
          at: dt(8),
        },
      ],
    },
    {
      nameTh: "สถิติแรงงานนอกระบบรายไตรมาส",
      status: DatasetRequestStatus.PENDING_BDI_APPROVAL,
      submittedDaysAgo: 14,
      over: {
        category: DatasetCategory.SOCIETY,
        updateFrequency: UpdateFrequency.QUARTERLY,
        deliveryFrequency: UpdateFrequency.QUARTERLY,
        orgApproverSignedAt: dt(12),
        orgApproverSignedName: approverName,
      },
      events: [
        { type: DatasetRequestEventType.CREATED, actorId: ownerId, to: DatasetRequestStatus.DRAFT, at: dt(15) },
        {
          type: DatasetRequestEventType.SUBMITTED,
          actorId: ownerId,
          from: DatasetRequestStatus.DRAFT,
          to: DatasetRequestStatus.PENDING_OFFICER_REVIEW,
          at: dt(14),
        },
        {
          type: DatasetRequestEventType.OFFICER_FORWARDED,
          actorId: bdi.officer,
          from: DatasetRequestStatus.PENDING_OFFICER_REVIEW,
          to: DatasetRequestStatus.PENDING_ORG_APPROVER,
          at: dt(13),
        },
        {
          type: DatasetRequestEventType.ORG_APPROVER_SIGNED,
          actorId: null,
          from: DatasetRequestStatus.PENDING_ORG_APPROVER,
          to: DatasetRequestStatus.PENDING_OFFICER_FINAL_CHECK,
          at: dt(12),
        },
        {
          type: DatasetRequestEventType.OFFICER_CONFIRMED,
          actorId: bdi.officer,
          from: DatasetRequestStatus.PENDING_OFFICER_FINAL_CHECK,
          to: DatasetRequestStatus.PENDING_BDI_APPROVAL,
          at: dt(11),
        },
      ],
    },
    {
      nameTh: "ทะเบียนสถานประกอบการรายจังหวัด",
      status: DatasetRequestStatus.APPROVED,
      submittedDaysAgo: 25,
      over: {
        category: DatasetCategory.ECONOMY_FINANCE,
        orgApproverSignedAt: dt(21),
        orgApproverSignedName: approverName,
        approvedAt: dt(19),
        approvedByName: "นางสุดารัตน์ อนุมัติ",
        approvedById: bdi.approver,
      },
      events: [
        { type: DatasetRequestEventType.CREATED, actorId: ownerId, to: DatasetRequestStatus.DRAFT, at: dt(26) },
        {
          type: DatasetRequestEventType.SUBMITTED,
          actorId: ownerId,
          from: DatasetRequestStatus.DRAFT,
          to: DatasetRequestStatus.PENDING_OFFICER_REVIEW,
          at: dt(25),
        },
        {
          type: DatasetRequestEventType.OFFICER_FORWARDED,
          actorId: bdi.officer,
          from: DatasetRequestStatus.PENDING_OFFICER_REVIEW,
          to: DatasetRequestStatus.PENDING_ORG_APPROVER,
          at: dt(23),
        },
        {
          type: DatasetRequestEventType.ORG_APPROVER_SIGNED,
          actorId: null,
          from: DatasetRequestStatus.PENDING_ORG_APPROVER,
          to: DatasetRequestStatus.PENDING_OFFICER_FINAL_CHECK,
          at: dt(21),
        },
        {
          type: DatasetRequestEventType.OFFICER_CONFIRMED,
          actorId: bdi.officer,
          from: DatasetRequestStatus.PENDING_OFFICER_FINAL_CHECK,
          to: DatasetRequestStatus.PENDING_BDI_APPROVAL,
          at: dt(20),
        },
        {
          type: DatasetRequestEventType.BDI_APPROVED,
          actorId: bdi.approver,
          from: DatasetRequestStatus.PENDING_BDI_APPROVAL,
          to: DatasetRequestStatus.APPROVED,
          at: dt(19),
        },
      ],
    },
    // สองรายการสุดท้ายมีไว้ให้เปิดโชว์ตอนสาธิต — เป็นสถานะที่เดินไปถึงเองระหว่างสาธิตไม่ทัน
    {
      nameTh: "ทะเบียนผู้ประกอบการขนส่งสาธารณะ",
      status: DatasetRequestStatus.REJECTED,
      submittedDaysAgo: 30,
      over: {
        category: DatasetCategory.TRANSPORT,
        dataClassification: DataClassification.CONFIDENTIAL,
        hasPersonalData: true,
        orgApproverSignedAt: dt(27),
        orgApproverSignedName: approverName,
        rejectedAt: dt(24),
        rejectedById: bdi.approver,
        rejectedByName: "นางสุดารัตน์ อนุมัติ",
        rejectionReason:
          "ชุดข้อมูลนี้มีเลขประจำตัวประชาชนของผู้ประกอบการรายบุคคล แต่ฐานอำนาจที่อ้างครอบคลุมเฉพาะนิติบุคคล จึงยังเปิดเผยข้อมูลส่วนบุคคลไม่ได้ หากหน่วยงานจะนำส่งใหม่ ให้ตัดฟิลด์ที่ระบุตัวบุคคลออกก่อน แล้วยื่นเป็นคำขอฉบับใหม่",
      },
      events: [
        { type: DatasetRequestEventType.CREATED, actorId: ownerId, to: DatasetRequestStatus.DRAFT, at: dt(31) },
        {
          type: DatasetRequestEventType.SUBMITTED,
          actorId: ownerId,
          from: DatasetRequestStatus.DRAFT,
          to: DatasetRequestStatus.PENDING_OFFICER_REVIEW,
          at: dt(30),
        },
        {
          type: DatasetRequestEventType.OFFICER_FORWARDED,
          actorId: bdi.officer,
          from: DatasetRequestStatus.PENDING_OFFICER_REVIEW,
          to: DatasetRequestStatus.PENDING_ORG_APPROVER,
          at: dt(28),
        },
        {
          type: DatasetRequestEventType.ORG_APPROVER_SIGNED,
          actorId: null,
          from: DatasetRequestStatus.PENDING_ORG_APPROVER,
          to: DatasetRequestStatus.PENDING_OFFICER_FINAL_CHECK,
          at: dt(27),
        },
        {
          type: DatasetRequestEventType.OFFICER_CONFIRMED,
          actorId: bdi.officer,
          from: DatasetRequestStatus.PENDING_OFFICER_FINAL_CHECK,
          to: DatasetRequestStatus.PENDING_BDI_APPROVAL,
          at: dt(26),
        },
        {
          type: DatasetRequestEventType.BDI_REJECTED,
          actorId: bdi.approver,
          from: DatasetRequestStatus.PENDING_BDI_APPROVAL,
          to: DatasetRequestStatus.REJECTED,
          note: "ฐานอำนาจที่อ้างไม่ครอบคลุมข้อมูลส่วนบุคคลของผู้ประกอบการรายบุคคล",
          at: dt(24),
        },
      ],
    },
    {
      nameTh: "สถิติการใช้บริการขนส่งมวลชนรายเดือน",
      status: DatasetRequestStatus.PENDING_OFFICER_FINAL_CHECK,
      submittedDaysAgo: 5,
      over: {
        category: DatasetCategory.TRANSPORT,
        orgApproverSignedAt: dt(2),
        orgApproverSignedName: approverName,
      },
      events: [
        { type: DatasetRequestEventType.CREATED, actorId: ownerId, to: DatasetRequestStatus.DRAFT, at: dt(6) },
        {
          type: DatasetRequestEventType.SUBMITTED,
          actorId: ownerId,
          from: DatasetRequestStatus.DRAFT,
          to: DatasetRequestStatus.PENDING_OFFICER_REVIEW,
          at: dt(5),
        },
        {
          type: DatasetRequestEventType.OFFICER_FORWARDED,
          actorId: bdi.officer,
          from: DatasetRequestStatus.PENDING_OFFICER_REVIEW,
          to: DatasetRequestStatus.PENDING_ORG_APPROVER,
          at: dt(4),
        },
        {
          type: DatasetRequestEventType.ORG_APPROVER_SIGNED,
          actorId: null,
          from: DatasetRequestStatus.PENDING_ORG_APPROVER,
          to: DatasetRequestStatus.PENDING_OFFICER_FINAL_CHECK,
          at: dt(2),
        },
      ],
    },
  ];

  for (const [index, spec] of specs.entries()) {
    const request = await prisma.datasetRequest.create({
      data: {
        ...datasetBase(),
        ...spec.over,
        nameTh: spec.nameTh,
        status: spec.status,
        requestNumber: `DR-${year}-${String(index + 1).padStart(4, "0")}`,
        submittedAt: spec.submittedDaysAgo ? dt(spec.submittedDaysAgo) : null,
        organization: { connect: { id: org.id } },
        createdBy: { connect: { id: ownerId } },
      },
      include: { organization: { select: { name: true } } },
    });

    // ร่างยังไม่มีเอกสาร — ผู้ใช้ยังไม่ได้กดสร้าง PDF
    if (spec.status !== DatasetRequestStatus.DRAFT) await attachDatasetDocuments(request);

    for (const e of spec.events) {
      await prisma.datasetRequestEvent.create({
        data: {
          datasetRequestId: request.id,
          type: e.type,
          actorId: e.actorId,
          fromStatus: e.from ?? null,
          toStatus: e.to ?? null,
          note: e.note ?? null,
          createdAt: e.at,
        },
      });
    }

    console.log(`  ✓ ${request.requestNumber} ${spec.nameTh} [${spec.status}]`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
