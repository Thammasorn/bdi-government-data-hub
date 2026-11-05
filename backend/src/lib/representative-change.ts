/**
 * คำขอเปลี่ยนแปลงผู้แทนหน่วยงาน — ส่วนที่อ่านอย่างเดียว
 *
 * transition ทั้งหมดอยู่ใน routes/representative-changes.ts ที่นี่ตอบคำถามว่า "ถ้ายืนยันใบนี้ตอนนี้จะเกิดอะไร"
 * หน้าตรวจของ BDI กับการยืนยันจริงเรียก `evaluateChangeRequest()` ตัวเดียวกัน สิ่งที่เจ้าหน้าที่เห็นบนหน้าจอ
 * จึงเป็นเงื่อนไขเดียวกับที่ server ใช้ตัดสิน
 *
 * ทุกอย่างคำนวณจากข้อมูลจริง ณ เวลาที่ถาม ไม่เก็บผลไว้ — ระหว่างรอตรวจ ผู้ดูแลระบบอาจเชิญคน คำเชิญอาจหมดอายุ
 * และคำขอใบอื่นของหน่วยงานเดียวกันอาจถูกยืนยันไปแล้ว
 */
import {
  OrganizationStatus,
  ActivationKeyStatus,
  type Prisma,
  type PrismaClient,
  RepresentativeAdditionStatus,
  RepresentativeChangeStatus,
  RepresentativeRemovalStatus,
  RequestStatus,
  UserAccountStatus,
} from "@prisma/client";

import { activeAssignmentWhere, roleIdByCode, roleSeatUsage } from "./iam.js";
import { fullNameTh } from "./person-name.js";
import { ROLE_LABELS } from "./roles.js";
import { BDI_ORGANIZATION_ID, ROLE_CODES, type RoleCode } from "./system.js";

type Db = PrismaClient | Prisma.TransactionClient;

/** บทบาทที่คำขอนี้เปลี่ยนได้ เรียงตามที่หน้าจอแสดง */
export const REPRESENTATIVE_ROLES: RoleCode[] = [
  ROLE_CODES.ORGANIZATION_USER,
  ROLE_CODES.ORGANIZATION_APPROVER,
];

/** คำขอที่ยังไม่จบ — ใช้เตือนเมื่อคนเดียวกันอยู่ในหลายใบ */
export const OPEN_CHANGE_STATUSES: RepresentativeChangeStatus[] = [
  RepresentativeChangeStatus.DRAFT,
  RepresentativeChangeStatus.SUBMITTED,
  RepresentativeChangeStatus.UNDER_REVIEW,
  RepresentativeChangeStatus.RETURNED,
];

const PERSON = {
  id: true,
  email: true,
  status: true,
  prefixTh: true,
  firstnameTh: true,
  lastnameTh: true,
  positionTh: true,
  departmentTh: true,
  phoneNumber: true,
  phoneNumberExtension: true,
} as const;

export const CHANGE_REQUEST_INCLUDE = {
  organization: { select: { id: true, nameTh: true, status: true, organizationCode: true } },
  removals: {
    orderBy: { createdAt: "asc" },
    include: {
      userRoleAssignment: {
        select: {
          id: true,
          status: true,
          effectiveUntil: true,
          organizationId: true,
          role: { select: { id: true, code: true } },
          userAccount: { select: PERSON },
        },
      },
      activationKey: {
        select: {
          id: true,
          status: true,
          expiresAt: true,
          organizationId: true,
          role: { select: { id: true, code: true } },
          userAccount: { select: PERSON },
        },
      },
    },
  },
  additions: {
    orderBy: { createdAt: "asc" },
    include: { role: { select: { id: true, code: true } } },
  },
} satisfies Prisma.RepresentativeChangeRequestInclude;

export type ChangeRequestRow = Prisma.RepresentativeChangeRequestGetPayload<{
  include: typeof CHANGE_REQUEST_INCLUDE;
}>;
type RemovalRow = ChangeRequestRow["removals"][number];
type AdditionRow = ChangeRequestRow["additions"][number];

/**
 * คำขอหนึ่งใบพร้อมรายการ — รายการที่ผู้กรอกเอาออกจากร่าง (CANCELLED) ไม่นับเป็นส่วนของคำขอ
 *
 * ยกเว้นใบที่ปิดไปแล้ว: ตอนปฏิเสธหรือยกเลิก รายการทั้งใบกลายเป็น CANCELLED ถ้ากรองทิ้ง หน้ารายละเอียด
 * จะว่างเปล่าทั้งที่คำถามคือ "ใบนี้ขออะไรไว้"
 */
export async function loadChangeRequest(db: Db, id: string) {
  const request = await db.representativeChangeRequest.findUnique({
    where: { id },
    include: CHANGE_REQUEST_INCLUDE,
  });
  if (!request) return null;
  const closed =
    request.status === RepresentativeChangeStatus.REJECTED ||
    request.status === RepresentativeChangeStatus.CANCELLED;
  if (closed) return request;
  return {
    ...request,
    removals: request.removals.filter((r) => r.status !== RepresentativeRemovalStatus.CANCELLED),
    additions: request.additions.filter((a) => a.status !== RepresentativeAdditionStatus.CANCELLED),
  };
}

/** คนและบทบาทของรายการยกเลิกหนึ่งแถว — มาจาก role assignment หรือคำเชิญ */
export function removalTarget(removal: RemovalRow) {
  const source = removal.userRoleAssignment ?? removal.activationKey;
  return {
    pendingInvitee: !removal.userRoleAssignment,
    roleCode: (source?.role.code ?? null) as RoleCode | null,
    person: source?.userAccount ?? null,
  };
}

/** รายการยกเลิกยังทำได้อยู่ไหม — role ยังไม่ถูกถอน หรือคำเชิญยังใช้ได้ */
function removalStillValid(removal: RemovalRow): boolean {
  const assignment = removal.userRoleAssignment;
  if (assignment) {
    const account = assignment.userAccount.status;
    return (
      assignment.status === "ACTIVE" &&
      (assignment.effectiveUntil === null || assignment.effectiveUntil > new Date()) &&
      (account === UserAccountStatus.ACTIVE || account === UserAccountStatus.SUSPENDED)
    );
  }
  const key = removal.activationKey;
  return key !== null && key.status === ActivationKeyStatus.ISSUED && key.expiresAt > new Date();
}

export interface HeadcountRow {
  roleCode: RoleCode;
  roleLabel: string;
  current: number;
  removed: number;
  added: number;
  after: number;
  min: number;
  max: number;
  /** คำขอนี้เปลี่ยนบทบาทนี้หรือไม่ — บทบาทที่ไม่เปลี่ยนไม่ถูกตรวจ */
  changed: boolean;
  /** ข้อความเมื่อไม่ผ่าน `null` = ผ่าน */
  problem: string | null;
}

export type AccountState =
  | "NEW"
  | "INVITE_BACK"
  | "REUSE_PENDING"
  | "INVITED"
  | "HOLDS_ROLE"
  | "ACTIVE_NO_ROLE"
  | "SUSPENDED"
  | "OTHER_PROCESS"
  | "EMAIL_CONFLICT"
  | "IDENTITY_CONFLICT"
  | "INCOMPLETE";

export interface AccountCheck {
  additionId: string;
  name: string;
  state: AccountState;
  /** บัญชีที่พบ — ใช้ต่อตอนดำเนินการ */
  accountId: string | null;
  /** ยืนยันได้หรือไม่ */
  ok: boolean;
  message: string;
}

/** เหตุผลที่คนนี้อยู่ใน process อื่น — เป็นผู้มีอำนาจที่ถูกระบุในคำขอจดทะเบียนที่ยังไม่จบ */
async function namedOnOpenRegistration(db: Db, email: string, organizationId: string) {
  return db.organizationRegistrationRequest.findFirst({
    where: {
      approverEmail: { equals: email, mode: "insensitive" },
      organizationId: { not: organizationId },
      status: { in: [RequestStatus.SUBMITTED, RequestStatus.UNDER_REVIEW, RequestStatus.RETURNED] },
    },
    select: { requestNumber: true },
  });
}

async function hasValidInvitation(db: Db, userAccountId: string) {
  const key = await db.activationKey.findFirst({
    where: { userAccountId, status: ActivationKeyStatus.ISSUED, expiresAt: { gt: new Date() } },
    select: { id: true },
  });
  return key !== null;
}

/** §5.3 ของการ์ด — สถานะบัญชีของเลขบัตรและอีเมลในรายการเพิ่มหนึ่งแถว */
export async function checkAddition(
  db: Db,
  addition: AdditionRow,
  organizationId: string,
): Promise<AccountCheck> {
  const name = fullNameTh({
    prefixTh: addition.userPrefixTh,
    firstnameTh: addition.userFirstnameTh,
    lastnameTh: addition.userLastnameTh,
  });
  const base = { additionId: addition.id, name };
  const blocked = (state: AccountState, accountId: string | null, message: string): AccountCheck => ({
    ...base,
    state,
    accountId,
    ok: false,
    message,
  });
  const allowed = (state: AccountState, accountId: string | null, message: string): AccountCheck => ({
    ...base,
    state,
    accountId,
    ok: true,
    message,
  });

  if (!addition.userCid || !addition.userEmail) {
    return blocked("INCOMPLETE", null, "ข้อมูลยังไม่ครบ");
  }
  const select = { id: true, email: true, status: true } as const;
  const [byCid, byEmail] = await Promise.all([
    db.userAccount.findUnique({ where: { cid: addition.userCid }, select }),
    db.userAccount.findUnique({ where: { email: addition.userEmail }, select }),
  ]);

  if (byCid && byEmail && byCid.id !== byEmail.id) {
    return blocked(
      "IDENTITY_CONFLICT",
      byCid.id,
      `เลขบัตรประชาชนเป็นของบัญชี ${byCid.email} แต่อีเมลเป็นของอีกบัญชีหนึ่ง`,
    );
  }
  if (!byCid && byEmail) {
    return blocked(
      "EMAIL_CONFLICT",
      byEmail.id,
      byEmail.status === UserAccountStatus.DEACTIVATED
        ? `อีเมล ${byEmail.email} ยังผูกกับบัญชีที่ยุติแล้ว ผู้ดูแลระบบต้องถอดอีเมลออกจากบัญชีนั้นก่อน`
        : `อีเมล ${byEmail.email} เป็นของบัญชีอื่นอยู่แล้ว`,
    );
  }
  if (!byCid) return allowed("NEW", null, "ยังไม่มีบัญชี ระบบจะสร้างบัญชีและส่งคำเชิญ");

  const accountId = byCid.id;
  switch (byCid.status) {
    case UserAccountStatus.SUSPENDED:
      return blocked("SUSPENDED", accountId, "บัญชีนี้ถูกระงับอยู่ ผู้ดูแลระบบต้องจัดการบัญชีก่อน");
    case UserAccountStatus.ACTIVE: {
      const held = await db.userRoleAssignment.findFirst({
        where: { userAccountId: accountId, ...activeAssignmentWhere() },
        select: { role: { select: { code: true } }, organization: { select: { nameTh: true } } },
      });
      if (held) {
        return blocked(
          "HOLDS_ROLE",
          accountId,
          `บัญชีนี้ถือบทบาท "${ROLE_LABELS[held.role.code as RoleCode] ?? held.role.code}" ` +
            `ของ ${held.organization?.nameTh ?? "หน่วยงานอื่น"} อยู่แล้ว ผู้ใช้หนึ่งคนมีได้บทบาทเดียว`,
        );
      }
      return blocked("ACTIVE_NO_ROLE", accountId, "บัญชีนี้ใช้งานอยู่แต่ไม่มีบทบาท ผู้ดูแลระบบต้องจัดการบัญชีก่อน");
    }
    case UserAccountStatus.DEACTIVATED:
      if (await hasValidInvitation(db, accountId)) {
        return blocked("INVITED", accountId, "บุคคลนี้มีคำเชิญค้างอยู่แล้ว");
      }
      return allowed("INVITE_BACK", accountId, "เคยมีบัญชีที่ยุติแล้ว ระบบจะเชิญกลับ เจ้าตัวต้องยืนยัน ThaID");
    case UserAccountStatus.PENDING: {
      if (await hasValidInvitation(db, accountId)) {
        return blocked("INVITED", accountId, "บุคคลนี้มีคำเชิญค้างอยู่แล้ว");
      }
      const open = await namedOnOpenRegistration(db, byCid.email, organizationId);
      if (open) {
        return blocked(
          "OTHER_PROCESS",
          accountId,
          `บัญชีนี้ถูกระบุเป็นผู้มีอำนาจในคำขอจดทะเบียน ${open.requestNumber} ที่ยังไม่จบ`,
        );
      }
      return allowed("REUSE_PENDING", accountId, "มีบัญชีที่ยังไม่เปิดใช้งาน ระบบจะใช้บัญชีเดิมและส่งคำเชิญใหม่");
    }
  }
}

/** เหตุผลที่รายการยกเลิกล้าสมัย พร้อมเลขคำขอที่ทำไปแล้วถ้าหาได้ */
async function staleRemovalMessage(db: Db, removal: RemovalRow, requestId: string): Promise<string> {
  const { person, pendingInvitee } = removalTarget(removal);
  const name = fullNameTh(person) || "ผู้แทน";
  const done = await db.representativeChangeRemoval.findFirst({
    where: {
      changeRequestId: { not: requestId },
      status: RepresentativeRemovalStatus.COMPLETED,
      OR: [
        ...(removal.userRoleAssignmentId ? [{ userRoleAssignmentId: removal.userRoleAssignmentId }] : []),
        ...(removal.activationKeyId ? [{ activationKeyId: removal.activationKeyId }] : []),
      ],
    },
    select: { changeRequest: { select: { requestNumber: true } } },
  });
  if (done) return `${name} ถูกยกเลิกไปแล้วด้วยคำขอ ${done.changeRequest.requestNumber}`;
  if (!pendingInvitee) return `${name} ไม่ได้ถือบทบาทนี้แล้ว`;
  const key = removal.activationKey;
  return key?.status === ActivationKeyStatus.USED
    ? `${name} เปิดใช้งานบัญชีไปแล้ว คำเชิญนี้จึงยกเลิกไม่ได้ ต้องส่งกลับให้แก้ไข`
    : `คำเชิญของ ${name} หมดอายุหรือถูกยกเลิกไปแล้ว`;
}

export interface OverlapWarning {
  name: string;
  requestNumber: string;
}

/** คนในใบนี้ที่อยู่ในคำขออื่นที่ยังไม่จบของหน่วยงานเดียวกัน */
export async function findOverlaps(db: Db, request: ChangeRequestRow): Promise<OverlapWarning[]> {
  const others = await db.representativeChangeRequest.findMany({
    where: {
      organizationId: request.organizationId,
      id: { not: request.id },
      status: { in: OPEN_CHANGE_STATUSES },
    },
    select: {
      requestNumber: true,
      removals: {
        where: { status: RepresentativeRemovalStatus.PENDING },
        select: { userRoleAssignmentId: true, activationKeyId: true },
      },
      additions: {
        where: { status: RepresentativeAdditionStatus.PENDING },
        select: { userCid: true },
      },
    },
  });
  const warnings: OverlapWarning[] = [];
  for (const other of others) {
    for (const removal of request.removals) {
      const same = other.removals.some(
        (r) =>
          (removal.userRoleAssignmentId && r.userRoleAssignmentId === removal.userRoleAssignmentId) ||
          (removal.activationKeyId && r.activationKeyId === removal.activationKeyId),
      );
      if (same) {
        warnings.push({
          name: fullNameTh(removalTarget(removal).person),
          requestNumber: other.requestNumber,
        });
      }
    }
    for (const addition of request.additions) {
      if (addition.userCid && other.additions.some((a) => a.userCid === addition.userCid)) {
        warnings.push({
          name: fullNameTh({
            prefixTh: addition.userPrefixTh,
            firstnameTh: addition.userFirstnameTh,
            lastnameTh: addition.userLastnameTh,
          }),
          requestNumber: other.requestNumber,
        });
      }
    }
  }
  return warnings;
}

/** ตารางจำนวนก่อน/หลังต่อบทบาท — §3.6 และ §4 ของการ์ด */
export async function computeHeadcount(db: Db, request: ChangeRequestRow): Promise<HeadcountRow[]> {
  const rows: HeadcountRow[] = [];
  for (const roleCode of REPRESENTATIVE_ROLES) {
    const roleId = await roleIdByCode(db, roleCode);
    const { limit, used } = await roleSeatUsage(db, { organizationId: request.organizationId, roleId });
    const removed = request.removals.filter(
      (r) => removalTarget(r).roleCode === roleCode && removalStillValid(r),
    ).length;
    const added = request.additions.filter((a) => a.role.code === roleCode).length;
    const after = used - removed + added;
    const changed = removed > 0 || added > 0;
    const label = ROLE_LABELS[roleCode];

    let problem: string | null = null;
    if (changed) {
      if (after < 1) {
        problem = `หลังดำเนินการจะไม่เหลือ${label} ต้องมีอย่างน้อย 1 คน`;
      } else if (after > limit) {
        // หน่วยงานที่เกินอยู่แล้วเพราะผู้ดูแลระบบลดเพดาน ลดจำนวนลงได้แม้ยังเกิน แต่เพิ่มหรือคงเดิมไม่ได้
        const movingCloser = used > limit && after < used;
        if (!movingCloser) problem = `หลังดำเนินการจะมี${label} ${after} คน เกินที่กำหนด ${limit} คน`;
      }
    }
    rows.push({ roleCode, roleLabel: label, current: used, removed, added, after, min: 1, max: limit, changed, problem });
  }
  return rows;
}

export interface ChangeEvaluation {
  headcount: HeadcountRow[];
  accountChecks: AccountCheck[];
  overlaps: OverlapWarning[];
  /** เหตุผลที่ยืนยันไม่ได้ ว่าง = ยืนยันได้ */
  blockers: string[];
  /** เหตุผลชุดเดียวกันในคำที่หน่วยงานอ่านได้ — ค่าตั้งต้นของช่องส่งกลับแก้ไข */
  returnReasons: string[];
}

/**
 * ข้อความของบัญชีที่ตรวจไม่ผ่าน สำหรับหน่วยงาน
 *
 * `AccountCheck.message` เขียนให้ BDI อ่าน มีอีเมลของบัญชีอื่นและบอกว่าใครถูกระงับหรือถือบทบาทที่ไหน
 * ส่วนสถานะบัญชีต้องอยู่กับ BDI เท่านั้น หน่วยงานจึงได้แค่สิ่งที่ต้องแก้ในคำขอของตัวเอง
 */
function organizationMessage(state: AccountState): string {
  switch (state) {
    case "IDENTITY_CONFLICT":
      return "เลขบัตรประชาชนและอีเมลตรงกับคนละบัญชี กรุณาตรวจสอบ";
    case "EMAIL_CONFLICT":
      return "อีเมลนี้ใช้ไม่ได้ กรุณาตรวจสอบหรือใช้อีเมลอื่น";
    case "INCOMPLETE":
      return "ข้อมูลของผู้แทนรายนี้ไม่ครบ กรุณาตรวจสอบ";
    default:
      return "ไม่สามารถเพิ่มผู้แทนรายนี้ได้ กรุณาตรวจสอบข้อมูลหรือติดต่อ BDI";
  }
}

/** ถ้ายืนยันใบนี้ตอนนี้ได้ไหม และเพราะอะไร */
export async function evaluateChangeRequest(db: Db, request: ChangeRequestRow): Promise<ChangeEvaluation> {
  const headcount = await computeHeadcount(db, request);
  const accountChecks: AccountCheck[] = [];
  for (const addition of request.additions) {
    accountChecks.push(await checkAddition(db, addition, request.organizationId));
  }
  const staleRemovals: string[] = [];
  for (const removal of request.removals) {
    if (!removalStillValid(removal)) staleRemovals.push(await staleRemovalMessage(db, removal, request.id));
  }
  const blockers = [
    ...headcount.flatMap((row) => (row.problem ? [row.problem] : [])),
    ...accountChecks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.message}`),
    ...staleRemovals,
  ];
  const returnReasons = [
    ...headcount.flatMap((row) => (row.problem ? [row.problem] : [])),
    ...accountChecks.filter((c) => !c.ok).map((c) => `${c.name}: ${organizationMessage(c.state)}`),
    ...staleRemovals,
  ];
  return { headcount, accountChecks, overlaps: await findOverlaps(db, request), blockers, returnReasons };
}

/** รายชื่อผู้แทนของหน่วยงาน — ผู้ถือ role (รวมคนที่ถูกระงับ) และคนที่มีคำเชิญค้าง */
/** ไม่ระบุหน่วยงาน = ทุกหน่วยงานที่ผ่านการลงทะเบียน ยกเว้น BDI เอง */
export async function listRepresentatives(db: Db, organizationId?: string) {
  const scope = organizationId
    ? { organizationId }
    : {
        organization: {
          status: { not: OrganizationStatus.PENDING_REGISTRATION },
          id: { not: BDI_ORGANIZATION_ID },
        },
      };
  const organization = { select: { id: true, nameTh: true, status: true } };
  const roleIds = await Promise.all(REPRESENTATIVE_ROLES.map((code) => roleIdByCode(db, code)));
  const [assignments, keys, openRemovals] = await Promise.all([
    db.userRoleAssignment.findMany({
      where: {
        ...scope,
        roleId: { in: roleIds },
        userAccount: { status: { in: [UserAccountStatus.ACTIVE, UserAccountStatus.SUSPENDED] } },
        ...activeAssignmentWhere(),
      },
      select: { id: true, role: { select: { code: true } }, userAccount: { select: PERSON }, organization },
      orderBy: { createdAt: "asc" },
    }),
    db.activationKey.findMany({
      where: {
        ...scope,
        roleId: { in: roleIds },
        status: ActivationKeyStatus.ISSUED,
        expiresAt: { gt: new Date() },
      },
      select: { id: true, role: { select: { code: true } }, userAccount: { select: PERSON }, organization },
      orderBy: { createdAt: "asc" },
    }),
    db.representativeChangeRemoval.findMany({
      where: {
        status: RepresentativeRemovalStatus.PENDING,
        changeRequest: { ...(organizationId ? { organizationId } : {}), status: { in: OPEN_CHANGE_STATUSES } },
      },
      select: {
        userRoleAssignmentId: true,
        activationKeyId: true,
        changeRequest: { select: { id: true, requestNumber: true } },
      },
    }),
  ]);

  const shape = (person: (typeof assignments)[number]["userAccount"], roleCode: string) => ({
    prefixTh: person.prefixTh,
    firstnameTh: person.firstnameTh,
    lastnameTh: person.lastnameTh,
    name: fullNameTh(person),
    positionTh: person.positionTh,
    departmentTh: person.departmentTh,
    email: person.email,
    phoneNumber: person.phoneNumber,
    phoneNumberExtension: person.phoneNumberExtension,
    roleCode,
    roleLabel: ROLE_LABELS[roleCode as RoleCode] ?? roleCode,
  });
  return [
    ...assignments.map((a) => ({
      ...shape(a.userAccount, a.role.code),
      organization: a.organization,
      kind: "HOLDER" as const,
      accountStatus: a.userAccount.status,
      userRoleAssignmentId: a.id,
      activationKeyId: null,
      userAccountId: a.userAccount.id,
      openRequests: openRemovals
        .filter((r) => r.userRoleAssignmentId === a.id)
        .map((r) => r.changeRequest.requestNumber),
    })),
    ...keys.map((k) => ({
      ...shape(k.userAccount, k.role.code),
      organization: k.organization,
      kind: "INVITED" as const,
      accountStatus: k.userAccount.status,
      userRoleAssignmentId: null,
      activationKeyId: k.id,
      userAccountId: k.userAccount.id,
      openRequests: openRemovals
        .filter((r) => r.activationKeyId === k.id)
        .map((r) => r.changeRequest.requestNumber),
    })),
  ];
}

/** จำนวนปัจจุบัน / สูงสุดต่อบทบาทของหน่วยงาน — หัวตารางรายชื่อผู้แทน */
export async function representativeSummary(db: Db, organizationId: string) {
  const rows = [];
  for (const roleCode of REPRESENTATIVE_ROLES) {
    const roleId = await roleIdByCode(db, roleCode);
    const { limit, used } = await roleSeatUsage(db, { organizationId, roleId });
    rows.push({ roleCode, roleLabel: ROLE_LABELS[roleCode], current: used, max: limit, over: used > limit });
  }
  return rows;
}

/**
 * โหนดของแผนภาพ "Flow จำนวน" — หนึ่งโหนดคลุมได้หลายสถานะ
 *
 * ส่งรูปเดียวกับ `journeyGraph()` เพื่อให้ `JourneyFlow` กับ `useRequestList` ของหน้าเว็บใช้ซ้ำได้โดยไม่แก้
 * แต่ไม่ได้ลงทะเบียนใน journey-steps.ts / queue.ts เพราะสองไฟล์นั้นผูกกับ `RequestStatus` และลำดับด่าน
 * ส่วนคำขอนี้มีด่านเดียวและมีสถานะของตัวเอง
 */
export const CHANGE_NODES = [
  { key: "DRAFT", lane: "main", order: 1, label: "ฉบับร่าง", tone: "neutral", role: ROLE_CODES.ORGANIZATION_USER, statuses: [RepresentativeChangeStatus.DRAFT] },
  { key: "OFFICER_REVIEW", lane: "main", order: 2, label: "BDI ตรวจสอบคำขอ", short: "BDI ตรวจสอบคำขอ", tone: "review", role: ROLE_CODES.BDI_OFFICER, statuses: [RepresentativeChangeStatus.SUBMITTED, RepresentativeChangeStatus.UNDER_REVIEW] },
  { key: "COMPLETED", lane: "main", order: null, label: "ดำเนินการเสร็จสิ้น", tone: "success", role: null, statuses: [RepresentativeChangeStatus.COMPLETED] },
  { key: "RETURNED", lane: "revision", order: null, label: "รอการแก้ไข", tone: "danger", role: ROLE_CODES.ORGANIZATION_USER, statuses: [RepresentativeChangeStatus.RETURNED] },
  { key: "PROCESSING_FAILED", lane: "closed", order: null, label: "ดำเนินการไม่สำเร็จ", tone: "danger", role: ROLE_CODES.BDI_OFFICER, statuses: [RepresentativeChangeStatus.CONFIRMED, RepresentativeChangeStatus.PROCESSING, RepresentativeChangeStatus.PROCESSING_FAILED] },
  { key: "REJECTED", lane: "closed", order: null, label: "ไม่อนุมัติ", tone: "danger", role: null, statuses: [RepresentativeChangeStatus.REJECTED] },
  { key: "CANCELLED", lane: "closed", order: null, label: "ยกเลิกแล้ว", tone: "neutral", role: null, statuses: [RepresentativeChangeStatus.CANCELLED] },
] as const;

const CHANGE_EDGES = [
  { from: "DRAFT", to: "OFFICER_REVIEW", kind: "chain" },
  { from: "OFFICER_REVIEW", to: "COMPLETED", kind: "chain" },
  { from: "OFFICER_REVIEW", to: "RETURNED", kind: "return" },
  { from: "RETURNED", to: "OFFICER_REVIEW", kind: "resubmit" },
];

/** ความคืบหน้าในรูปเดียวกับ `journeyProgress()` — คำขอนี้มีด่านเดียว จึงไม่ต้องไล่ลำดับด่าน */
export function changeProgress(
  status: RepresentativeChangeStatus,
  lastTask: { result: string | null; completedAt: Date | null; roundNumber: number } | null,
) {
  const S = RepresentativeChangeStatus;
  const phase =
    status === S.DRAFT
      ? "DRAFT"
      : status === S.RETURNED
        ? "WAITING_REVISION"
        : status === S.COMPLETED
          ? "APPROVED"
          : status === S.REJECTED
            ? "REJECTED"
            : status === S.CANCELLED
              ? "CANCELLED"
              : "IN_PROGRESS";
  const reviewing = status === S.SUBMITTED || status === S.UNDER_REVIEW;
  const state = reviewing
    ? "CURRENT"
    : status === S.RETURNED
      ? "RETURNED"
      : status === S.REJECTED
        ? "REJECTED"
        : status === S.DRAFT || status === S.CANCELLED
          ? "UPCOMING"
          : "DONE";
  const step = {
    key: "OFFICER_REVIEW",
    taskType: "BDI_OFFICER_REVIEW",
    order: 1,
    optional: false,
    label: "BDI ตรวจสอบคำขอ",
    shortLabel: "BDI ตรวจสอบคำขอ",
    waitingLabel: `รอ${ROLE_LABELS[ROLE_CODES.BDI_OFFICER]}ตรวจสอบคำขอ`,
    roleCode: ROLE_CODES.BDI_OFFICER,
    roleLabel: ROLE_LABELS[ROLE_CODES.BDI_OFFICER],
    state,
    result: reviewing ? null : (lastTask?.result ?? null),
    completedAt: reviewing ? null : (lastTask?.completedAt ?? null),
    roundNumber: lastTask?.roundNumber ?? null,
  };
  return {
    steps: [step],
    totalSteps: 1,
    currentOrder: reviewing ? 1 : null,
    currentStep: reviewing ? step : null,
    nextStep: null,
    phase,
  };
}

/** สถานะของโหนดหนึ่ง — คีย์ที่ไม่รู้จักตอบ `null` ผู้เรียกจึงไม่กรอง */
export function statusesOfNode(key: string | undefined): RepresentativeChangeStatus[] | null {
  const node = CHANGE_NODES.find((n) => n.key === key);
  return node ? [...node.statuses] : null;
}

/** สถานะที่เป็นงานของตำแหน่งผู้ใช้คนนี้ — แท็บ "ที่ต้องดำเนินการ" */
export function statusesOfRoles(roles: string[]): RepresentativeChangeStatus[] {
  return CHANGE_NODES.filter((n) => n.role && roles.includes(n.role)).flatMap((n) => [...n.statuses]);
}

/** คำตอบของ `GET /summary` — รูปเดียวกับ `ListSummary` ของหน้าเว็บ */
export function changeRequestSummary(
  counts: Partial<Record<RepresentativeChangeStatus, number>>,
  roles: string[],
) {
  const count = (statuses: readonly RepresentativeChangeStatus[]) =>
    statuses.reduce((sum, status) => sum + (counts[status] ?? 0), 0);
  const nodes = CHANGE_NODES.map((node) => ({
    key: node.key,
    lane: node.lane,
    anchor: null,
    order: node.order,
    optional: false,
    terminal: node.key !== "RETURNED",
    label: node.label,
    short: "short" in node ? node.short : node.label,
    waitingLabel: null,
    roleCode: node.role,
    roleLabel: node.role ? ROLE_LABELS[node.role] : null,
    tone: node.tone,
    count: count(node.statuses),
    mine: Boolean(node.role && roles.includes(node.role)),
  }));
  return {
    total: Object.values(counts).reduce((sum, n) => sum + (n ?? 0), 0),
    mine: nodes.filter((n) => n.mine).reduce((sum, n) => sum + n.count, 0),
    unit: "คำขอ",
    nodes,
    edges: CHANGE_EDGES,
  };
}

/** คีย์ใบนี้ออกจากคำขอเปลี่ยนแปลงผู้แทนหรือไม่ — จำนวนถูกตรวจแล้วตอน BDI ยืนยัน ตอนเปิดใช้งานจึงไม่ตรวจซ้ำ */
export async function isChangeRequestKey(db: Db, activationKeyId: string): Promise<boolean> {
  const addition = await db.representativeChangeAddition.findFirst({
    where: { activationKeyId },
    select: { id: true },
  });
  return addition !== null;
}

/** เลขบัตรที่องค์กรเห็นหลังนำส่ง */
export function maskCid(cid: string | null): string | null {
  return cid ? `${"x".repeat(Math.max(cid.length - 4, 0))}${cid.slice(-4)}` : null;
}
