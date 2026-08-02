/**
 * สร้างข้อมูลตัวอย่างสำหรับทดลองใช้งาน — บัญชีครบทุก role และหน่วยงานครบทุกสถานะ
 * รันซ้ำได้ (ล้างของเดิมก่อนเสมอ)
 *
 *   docker compose exec backend npm run seed:demo
 */
import { randomUUID } from "node:crypto";

import {
  AttachmentKind,
  OrganizationEventType,
  OrganizationStatus,
  Role,
  UserStatus,
  type Organization,
  type Prisma,
} from "@prisma/client";

import { prisma } from "../db.js";
import { hashPassword } from "../lib/auth.js";
import { renderOrganizationForm } from "../lib/pdf.js";
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

  console.log(`
เสร็จแล้ว — ทุกบัญชีใช้รหัสผ่าน: ${PASSWORD}

  officer@bdi.or.th      เจ้าหน้าที่ BDI        มีงานรอตรวจ 1 รายการ
  approver@bdi.or.th     ผู้อนุมัติ BDI          มีงานรอลงนาม 1 รายการ
  wichai@cmpho.go.th     ผู้มีอำนาจกระทำการแทน  มีงานรอเห็นชอบ 1 รายการ
  somchai@moph.go.th     ผู้ใช้หน่วยงาน          คำขออยู่ระหว่างตรวจสอบ
  malee@dol.go.th        ผู้ใช้หน่วยงาน          ถูกส่งกลับให้แก้ไข
  newbie@moi.go.th       ผู้ใช้หน่วยงาน          ยังไม่มีหน่วยงาน (หน้า empty state)
`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
