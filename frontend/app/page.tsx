"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { BdiHome } from "@/components/home/BdiHome";
import { DatasetSection } from "@/components/home/DatasetSection";
import { LandingPage } from "@/components/landing/LandingPage";
import { ApprovalStepsCompact } from "@/components/review/ApprovalSteps";
import { useSession, type SessionUser } from "@/components/SessionProvider";
import { Button } from "@/components/ui/Button";
import { Card, DotDecoration, OrganizationStatusBadge } from "@/components/ui/Card";
import { Spinner } from "@/components/ui/Spinner";
import { useToast } from "@/components/ui/Toast";
import { api } from "@/lib/api";
import { useOrganizationRegistration } from "@/lib/use-organization-registration";
import { formatThaiDate, isBdiStaff, type OrganizationStatus } from "@/lib/status";
import { nodeCount, type ListSummary, type PageInfo } from "@/lib/stage";
import type { DatasetRequestListItem, OrganizationListItem } from "@/lib/types";

/** ผลของ endpoint ที่แบ่งหน้าแล้ว — แถวของหน้านี้ กับจำนวนจริงทั้งหมด */
interface Page<T> {
  rows: T[];
  page: PageInfo;
}

const EMPTY_PAGE: PageInfo = { page: 1, pageSize: 5, total: 0, pageCount: 1 };

/**
 * "ยังเดินอยู่ในสายพาน" กับ "จบแล้ว"
 *
 * ฝั่งนี้เคยไล่ชื่อด่านเอง ซึ่งแปลว่าหน้าแรกรู้จักเส้นทาง — สิ่งที่กติกาของ lib/stage.ts
 * ห้ามไว้ และผิดทันทีที่เส้นทางเพิ่มด่าน `SUBMITTED,UNDER_REVIEW` เป็นคำนิยามของ
 * "ยังเดินอยู่" ที่ backend ใช้อยู่แล้ว (requestStatusFor) และ API ยังรับสองคำนี้อยู่
 * ส่วน SETTLED เป็นรายชื่อ RequestStatus ล้วน ซึ่งหน้าเว็บเป็นเจ้าของโดยชอบ
 */
const MOVING = "SUBMITTED,UNDER_REVIEW";
const SETTLED = ["DRAFT", "RETURNED", "APPROVED", "REJECTED", "CANCELLED"];

export default function HomePage() {
  const { user, loading } = useSession();
  const { start, starting } = useOrganizationRegistration();

  if (loading) return <Spinner />;
  // ผู้ที่ยังไม่ล็อกอินได้หน้าแนะนำระบบ ไม่ใช่หน้าล็อกอิน — เดิมเด้งไป /login ทันที
  // ทำให้ไม่มีที่อธิบายว่าระบบนี้คืออะไรให้คนที่เพิ่งเข้ามาอ่าน
  if (!user) return <LandingPage />;
  /**
   * เจ้าหน้าที่ BDI เคยถูกเด้งออกจากหน้านี้ไปยืนบนตารางคิว เพราะยังไม่มีหน้าแรกให้
   * ตอนนี้มีแล้ว — ต้องเช็ค **ก่อน** เงื่อนไข organizationId ข้างล่าง เพราะทุก role
   * assignment มีหน่วยงานติดมาด้วย เจ้าหน้าที่ BDI จึงสังกัดแถวหน่วยงาน BDI จริง ๆ
   * และจะตกไปได้หน้าแรกของผู้ใช้หน่วยงานถ้าปล่อยผ่าน
   */
  if (isBdiStaff(user.roles)) return <BdiHome />;

  // ผู้มีอำนาจกระทำการแทนที่ถูกเชิญเข้ามาทีหลังยังไม่ถูกผูก organizationId
  // แต่เห็นคำขอของหน่วยงานตัวเองผ่าน signatoryEmail จึงต้องได้หน้าแรกแบบเดียวกัน
  // ไม่ใช่หน้าชวนสร้างหน่วยงาน
  const isApprover = user.roles.includes("ORGANIZATION_APPROVER");
  if (!user.organizationId && !isApprover) {
    /* "ยังไม่เคยมีหน่วยงาน" กับ "เคยมีแล้วถูกถอดออก" มาถึงตรงนี้เหมือนกันทุกประการ
       — organizationId เป็น null ทั้งคู่ — แต่ต้องบอกคนละเรื่องกัน */
    return user.removedFromOrganization ? (
      <RemovedFromOrganizationNotice
        removal={user.removedFromOrganization}
        loading={starting}
        onCreate={start}
      />
    ) : (
      <CreateOrganizationPrompt loading={starting} onCreate={start} />
    );
  }

  return <OrganizationHome isApprover={isApprover} onRegister={start} registering={starting} />;
}

// ---------------------------------------------------------------- หน้าแรกของผู้ใช้หน่วยงาน

/**
 * สเปก (Notion — User Home page): หน้าแรกของทั้ง Organization Officer และ Organization Approver
 * แบ่งเป็นสอง section — รายการที่รออนุมัติอยู่บนสุดเสมอ ตามด้วยชุดข้อมูลที่เหลือของหน่วยงาน
 * ทุกแถวบอกวันเวลาที่นำเข้ามา วันเวลาที่อัปเดตล่าสุด สถานะ ชื่อชุดข้อมูล และปุ่ม view / download
 */
function OrganizationHome({
  isApprover,
  onRegister,
  registering,
}: {
  isApprover: boolean;
  onRegister: () => void;
  registering: boolean;
}) {
  const { user } = useSession();
  const { show } = useToast();

  /**
   * หน้านี้เคยดึงรายการทั้งสองเส้นทางมาแบบไม่จำกัดแล้วแบ่ง section เองในเบราว์เซอร์
   * ทำแบบนั้นไม่ได้อีกแล้วเมื่อ API แบ่งหน้า — และไม่ควรทำตั้งแต่แรก เพราะตัวเลขบนการ์ด
   * ที่นับจากแถวที่โหลดมาได้พูดความจริงแค่ตอนที่ยังไม่ถึงเพดาน
   *
   * ตอนนี้ทุกตัวเลขมาจาก `/summary` และแต่ละ section ขอมาแค่ห้าแถวแรกของตัวเอง
   * คำขอมากขึ้นจึงไม่ทำให้หน้าแรกช้าลง
   */
  const [summary, setSummary] = useState<ListSummary | null>(null);
  /** `null` = ยังไม่รู้ผล — ต่างจากผลที่ว่างเปล่า ซึ่งแปลว่ารู้แล้วว่าไม่มีคำขอเลย */
  const [pending, setPending] = useState<Page<DatasetRequestListItem> | null>(null);
  const [others, setOthers] = useState<Page<DatasetRequestListItem> | null>(null);
  const [awaitingMe, setAwaitingMe] = useState<Page<DatasetRequestListItem> | null>(null);
  const [orgRequests, setOrgRequests] = useState<OrganizationListItem[] | null>(null);

  useEffect(() => {
    const load = <T,>(path: string, key: string): Promise<Page<T>> =>
      api.get<Record<string, unknown>>(path).then((d) => ({
        rows: (d[key] as T[]) ?? [],
        page: (d.page as PageInfo) ?? EMPTY_PAGE,
      }));

    api
      .get<ListSummary>("/api/dataset-requests/summary")
      .then(setSummary)
      .catch(() => show({ tone: "error", title: "โหลดรายการชุดข้อมูลไม่สำเร็จ" }));

    load<DatasetRequestListItem>(
      `/api/dataset-requests?status=${MOVING}&pageSize=5`,
      "requests",
    )
      .then(setPending)
      .catch(() => setPending({ rows: [], page: EMPTY_PAGE }));

    load<DatasetRequestListItem>(
      `/api/dataset-requests?stage=${SETTLED.join(",")}&pageSize=5`,
      "requests",
    )
      .then(setOthers)
      .catch(() => setOthers({ rows: [], page: EMPTY_PAGE }));

    /**
     * คำขอลงทะเบียนหน่วยงาน — คนละเส้นทางกับชุดข้อมูล และหน้าแรกเคยไม่พูดถึงเลย
     *
     * ผู้มีอำนาจกระทำการแทนถูกเชิญเข้ามาเพื่อลงนามในคำขอใบหนึ่งโดยเฉพาะ แต่เข้ามาแล้ว
     * เจอหน้าแรกที่พูดเรื่องชุดข้อมูลล้วน ๆ ไม่มีทางไปต่อ ต้องเดาว่าต้องกดเมนู
     * "หน่วยงานของฉัน" เอง
     *
     * หนึ่งหน่วยงานมีคำขอที่ยังไม่จบได้ใบเดียว ห้าแถวจึงเหลือเฟือสำหรับสองคำถามที่
     * หน้านี้ถาม: ยื่นไปแล้วหรือยัง และมีใบไหนหยุดรอลายเซ็นของคนนี้อยู่ไหม
     */
    load<OrganizationListItem>(
      "/api/organizations?status=SUBMITTED,UNDER_REVIEW&pageSize=5",
      "organizations",
    )
      .then((d) => setOrgRequests(d.rows))
      .catch(() => setOrgRequests([]));

    // ยิงเฉพาะคนที่การ์ดนี้พูดด้วย — ผู้ดำเนินการของหน่วยงานไม่มีการ์ดนี้
    if (isApprover) {
      load<DatasetRequestListItem>(
        "/api/dataset-requests?stage=ORGANIZATION_APPROVAL&pageSize=5",
        "requests",
      )
        .then(setAwaitingMe)
        .catch(() => setAwaitingMe({ rows: [], page: EMPTY_PAGE }));
    }
  }, [show, isApprover]);

  /** คำขอลงทะเบียนหน่วยงานที่หยุดรอการลงนามของผู้ใช้คนนี้ */
  const awaitingSignature = isApprover
    ? orgRequests?.find((r) => r.currentTaskType === "ORGANIZATION_APPROVAL")
    : undefined;

  /**
   * ยื่นคำขอไปแล้ว = ไม่ต้องมีปุ่ม "กรอกแบบฟอร์มลงทะเบียนหน่วยงาน" อีก
   *
   * หน่วยงานหนึ่งมีคำขอที่ยังไม่จบได้ใบเดียว (`POST /api/organizations` ตอบ 409 `exists`
   * แล้วพากลับเข้าใบเดิม) แต่หน้าแรกยังโชว์ปุ่มค้างไว้ตลอดเวลาที่หน่วยงานยังไม่ ACTIVE
   * ซึ่งอ่านได้ว่ายื่นได้อีกใบ — ผู้ใช้ที่ยื่นไปแล้วและยังไม่มีใครตอบกลับจะกดปุ่มนี้ซ้ำ
   * โดยเข้าใจว่าครั้งก่อนไม่สำเร็จ
   *
   * ฉบับร่างและใบที่ถูกส่งกลับมาแก้ยังเห็นปุ่มอยู่ เพราะทั้งสองกรณีปุ่มพา "เข้าไปกรอกต่อ"
   * ไม่ใช่ "ยื่นใบใหม่" ส่วนใบที่ถูกปฏิเสธหรือยกเลิกก็ยังเห็น เพราะ API ยอมให้เริ่มใหม่จริง
   *
   * คิวรีข้างบนกรองเหลือเฉพาะใบที่ยังเดินอยู่แล้ว จึงเป็นคำถามว่ามีแถวไหม ไม่ต้องอ่านสถานะซ้ำ
   */
  const registrationInReview = orgRequests === null ? undefined : orgRequests.length > 0;

  const counts = useMemo(
    () => ({
      // ยังเดินอยู่ = ทั้งหมด ลบปลายทางทั้งห้า — อ่านจากโหนดที่ server ส่งมา ไม่ไล่ชื่อด่านเอง
      pending: summary
        ? summary.total - SETTLED.reduce((sum, k) => sum + nodeCount(summary, k), 0)
        : 0,
      revision: nodeCount(summary, "RETURNED"),
      approved: nodeCount(summary, "APPROVED"),
    }),
    [summary],
  );

  const name = user?.firstName?.trim() || user?.email || "";
  const organization = user?.organization ?? null;

  /**
   * ระหว่างที่หน่วยงานยังลงทะเบียนไม่เสร็จ ครึ่งล่างของหน้าเป็นช่องว่างทั้งหมด —
   * ตัวเลขศูนย์สี่ช่องกับสองรายการที่ไม่มีแถวเลย รวมหกกล่องที่ไม่ได้บอกอะไร
   * และดันสิ่งเดียวที่กดได้จริงให้จมอยู่กลางหน้า ยังลงทะเบียนชุดข้อมูลไม่ได้อยู่แล้ว
   * จนกว่าหน่วยงานจะเปิดใช้งาน จึงยุบเหลือประโยคเดียว
   */
  const organizationActive = organization?.status === "ACTIVE";
  const datasetHalfIsEmpty = !organizationActive && summary !== null && summary.total === 0;

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <HomeHeader
        name={name}
        organization={organization}
        /* ผู้ลงนามไม่ใช่คนกรอกฟอร์มลงทะเบียน จึงไม่ต้องเห็นปุ่มนี้ และคนที่ยื่นไปแล้ว
           ก็ไม่ต้องเห็น — `undefined` ระหว่างที่ยังโหลดรายการคำขอไม่เสร็จด้วย ไม่งั้น
           ปุ่มจะโผล่มาแวบหนึ่งแล้วหายไปเมื่อรู้ว่ามีคำขอค้างอยู่ */
        onRegister={isApprover || registrationInReview !== false ? undefined : onRegister}
        registering={registering}
        /* การ์ดลงนามด้านล่างบอกเรื่องเดียวกันแต่ตรงกว่าและมีปุ่มให้กด กล่องเตือน
           "หน่วยงานยังไม่เปิดใช้งาน" จึงกลายเป็นการพูดซ้ำครั้งที่สาม ต่อจาก badge */
        hideInactiveNotice={Boolean(awaitingSignature)}
      />

      {/* ยกขึ้นก่อนทุกอย่าง รวมถึงก่อน spinner ของรายการชุดข้อมูล — งานที่ค้างรอคนนี้อยู่
          ต้องเห็นทันทีที่เปิดหน้า ไม่ใช่หลังจากรอรายการอื่นโหลดเสร็จ */}
      {awaitingSignature ? (
        <Card className="mb-8 border-l-[3px] border-l-coral-500">
          <div className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
            {/* ไม่ต้องเอ่ยชื่อหน่วยงานซ้ำ — เป็นหัวเรื่องของหน้านี้อยู่แล้ว */}
            <div className="min-w-0">
              <p className="font-medium text-navy-800">รอคุณเห็นชอบและลงนามคำขอลงทะเบียนหน่วยงาน</p>
              <p className="mt-0.5 text-sm leading-relaxed text-ink-muted">
                คำขอผ่านการตรวจสอบจากเจ้าหน้าที่ BDI แล้ว และหยุดรอให้คุณอ่านเอกสารข้อตกลง
                แล้วลงนามในฐานะผู้มีอำนาจกระทำการแทน
              </p>
              {/* บอกด้วยว่านี่คือขั้นที่เท่าไรและหลังจากนี้เหลืออะไร — ผู้ลงนามส่วนใหญ่
                  เห็นคำขอครั้งเดียวตรงนี้ และไม่รู้ว่ากดแล้วเรื่องจะไปต่อที่ใคร */}
              {awaitingSignature.progress ? (
                <div className="mt-2">
                  <ApprovalStepsCompact progress={awaitingSignature.progress} />
                </div>
              ) : null}
            </div>
            <Link href={`/organizations/${awaitingSignature.id}`} className="shrink-0">
              <Button>อ่านเอกสารและลงนาม</Button>
            </Link>
          </div>
        </Card>
      ) : null}

      {summary === null || pending === null || others === null ? (
        <Spinner className="min-h-[40vh]" />
      ) : datasetHalfIsEmpty ? (
        <p className="rounded-2xl bg-white p-6 text-[15px] leading-relaxed text-ink-muted shadow-card ring-1 ring-line">
          ยังไม่มีชุดข้อมูลของหน่วยงาน — ลงทะเบียนชุดข้อมูลได้เมื่อหน่วยงานผ่านการอนุมัติและเปิดใช้งานแล้ว
        </p>
      ) : (
        <>
          <StatTiles counts={counts} total={summary.total} />

          {/* ผู้มีอำนาจกระทำการแทนคือคนเดียวที่กดต่อได้เมื่อคำขอค้างที่ด่านนี้
              จึงยกขึ้นมาเป็นการ์ดแยก ไม่ให้จมอยู่ในรายการรวม */}
          {isApprover && awaitingMe && awaitingMe.rows.length > 0 ? (
            <Card className="mb-8 border-l-[3px] border-l-coral-500">
              <div className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-medium text-navy-800">
                    รอคุณพิจารณาและลงนาม {awaitingMe.page.total} รายการ
                  </p>
                  <p className="mt-0.5 text-sm text-ink-muted">
                    คำขอเหล่านี้ผ่านการตรวจสอบเบื้องต้นจาก BDI แล้ว และหยุดรอความเห็นชอบของคุณ
                  </p>
                  {/* ใบเดียวเท่านั้นที่บอกความคืบหน้าตรงนี้ได้ตรง ๆ หลายใบอาจอยู่คนละขั้น
                      และรายการด้านล่างบอกทีละแถวอยู่แล้ว */}
                  {awaitingMe.page.total === 1 && awaitingMe.rows[0].progress ? (
                    <div className="mt-2">
                      <ApprovalStepsCompact progress={awaitingMe.rows[0].progress} />
                    </div>
                  ) : null}
                </div>
                <Link href={`/datasets/${awaitingMe.rows[0].id}`} className="shrink-0">
                  <Button>เริ่มพิจารณา</Button>
                </Link>
              </div>
            </Card>
          ) : null}

          <div className="flex flex-col gap-8">
            <DatasetSection
              title="รายการข้อมูลที่รออนุมัติ"
              description="คำขอที่นำส่งแล้วและยังอยู่ระหว่างการพิจารณา"
              rows={pending.rows}
              count={pending.page.total}
              tone="attention"
              emptyText="ยังไม่มีคำขอที่รอการอนุมัติ"
              footer={
                pending.page.total > pending.rows.length ? (
                  <Link
                    href={`/datasets?status=${MOVING}`}
                    className="text-sm font-medium text-navy-700 underline-offset-4 hover:underline"
                  >
                    ดูคำขอที่รออนุมัติทั้ง {pending.page.total} รายการ →
                  </Link>
                ) : null
              }
            />

            <DatasetSection
              title="ชุดข้อมูลของหน่วยงาน"
              description="ชุดข้อมูลที่ลงทะเบียนเข้ามาแล้ว ทั้งฉบับร่าง รายการที่ต้องแก้ไข และรายการที่จบกระบวนการ"
              rows={others.rows}
              count={others.page.total}
              emptyText="ยังไม่มีชุดข้อมูลอื่นของหน่วยงาน"
              footer={
                <Link
                  href="/datasets"
                  className="text-sm font-medium text-navy-700 underline-offset-4 hover:underline"
                >
                  ดูชุดข้อมูลทั้งหมดพร้อมตัวกรองและการค้นหา →
                </Link>
              }
            />
          </div>
        </>
      )}
    </div>
  );
}

function HomeHeader({
  name,
  organization,
  onRegister,
  registering,
  hideInactiveNotice = false,
}: {
  name: string;
  organization: { id: string; name: string; status: string } | null;
  onRegister?: () => void;
  registering?: boolean;
  /** ซ่อนกล่อง "หน่วยงานยังไม่เปิดใช้งาน" เมื่อมีการ์ดอื่นบอกเรื่องเดียวกันไปแล้ว */
  hideInactiveNotice?: boolean;
}) {
  const status = organization?.status as OrganizationStatus | undefined;

  return (
    <header className="relative mb-8 overflow-hidden">
      <DotDecoration className="-right-4 -top-6 h-36 w-36 text-navy-500" />
      <div className="relative">
        <p className="text-[15px] text-ink-muted">สวัสดี {name}</p>
        <h1 className="mt-1 text-[26px] font-semibold text-navy-800">
          {organization?.name ?? "หน้าแรก"}
        </h1>
        {organization ? (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            {status ? <OrganizationStatusBadge status={status} /> : null}
            <Link
              href={`/organizations/${organization.id}`}
              className="text-sm font-medium text-navy-700 underline-offset-4 hover:underline"
            >
              ดูข้อมูลหน่วยงานของฉัน →
            </Link>
          </div>
        ) : (
          <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-ink-muted">
            คุณเข้าใช้งานในฐานะผู้มีอำนาจกระทำการแทน — ด้านล่างคือคำขอลงทะเบียนชุดข้อมูลของหน่วยงานที่คุณดูแล
          </p>
        )}

        {status && status !== "ACTIVE" && !hideInactiveNotice ? (
          <div className="mt-5 rounded-xl border-l-[3px] border-warning bg-warning-bg p-5">
            <p className="text-[13px] font-semibold text-warning">หน่วยงานยังไม่เปิดใช้งาน</p>
            <p className="mt-1.5 text-[15px] leading-relaxed text-ink">
              หน่วยงานต้องผ่านการอนุมัติและเปิดใช้งานก่อน จึงจะลงทะเบียนชุดข้อมูลใหม่ได้
              ระหว่างนี้ยังเปิดดูคำขอเดิมได้ตามปกติ
            </p>
            {/* หน่วยงานที่เจ้าหน้าที่สร้างไว้ล่วงหน้าไม่มีคำขอจดทะเบียนมาด้วย ผู้ใช้จึงต้องมี
                ปุ่มพาเข้าฟอร์ม — ก่อนหน้านี้ปุ่มนี้อยู่เฉพาะกับผู้ใช้ที่ยังไม่มีหน่วยงาน
                คนที่ถูกผูกหน่วยงานไว้ให้จึงเริ่มเส้นทาง B จากหน้าจอไม่ได้เลย
                กดซ้ำได้ปลอดภัย: ถ้ามีคำขออยู่แล้วระบบพากลับเข้าใบเดิม ไม่ได้เปิดใบใหม่ */}
            {onRegister ? (
              <Button size="sm" className="mt-4" loading={registering} onClick={onRegister}>
                กรอกแบบฟอร์มลงทะเบียนหน่วยงาน
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </header>
  );
}

function StatTiles({
  counts,
  total,
}: {
  counts: { pending: number; revision: number; approved: number };
  total: number;
}) {
  const tiles = [
    { label: "ชุดข้อมูลทั้งหมด", value: total, className: "text-navy-800" },
    { label: "รออนุมัติ", value: counts.pending, className: "text-navy-600" },
    { label: "รอการแก้ไข", value: counts.revision, className: "text-danger" },
    { label: "อนุมัติแล้ว", value: counts.approved, className: "text-success" },
  ];

  return (
    <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
      {tiles.map((t) => (
        <Card key={t.label} className="px-5 py-4">
          <p className="text-[13px] text-ink-muted">{t.label}</p>
          <p className={`mt-1 text-[28px] font-semibold leading-tight ${t.className}`}>{t.value}</p>
        </Card>
      ))}
    </div>
  );
}

/**
 * ผู้ใช้ที่ถูกถอดออกจากหน่วยงานเพราะมีคนมารับหน้าที่แทน
 *
 * หน้านี้เคยพูดกับทุกคนที่ `organizationId` เป็น null ด้วยประโยคเดียวกันว่า
 * "ยังไม่มีหน่วยงานในระบบ" ซึ่งกับคนที่เพิ่งถูกถอดออกนั้นผิดสองชั้น: หน่วยงานของเขามีอยู่
 * (บางรายอนุมัติไปแล้วด้วย) และสิ่งที่เขาต้องทำไม่ใช่การสร้างใบใหม่ แต่คือทวงสิทธิ์คืน
 * ปุ่มสร้างหน่วยงานยังอยู่ เพราะบางคนย้ายไปรับผิดชอบหน่วยงานอื่นจริง ๆ แต่ต้องเขียนให้
 * ชัดว่ามันสร้าง **หน่วยงานใหม่คนละแห่ง** ไม่ได้พากลับเข้าของเดิม
 */
function RemovedFromOrganizationNotice({
  removal,
  loading,
  onCreate,
}: {
  removal: NonNullable<SessionUser["removedFromOrganization"]>;
  loading: boolean;
  onCreate: () => void;
}) {
  const organizationName = removal.organizationName ?? "หน่วยงานเดิมของคุณ";
  const successor = removal.replacedBy ?? "เจ้าหน้าที่คนใหม่";
  /**
   * ประกอบประโยคเองทั้งชิ้น ไม่ปล่อยให้ JSX ขึ้นบรรทัดใหม่คั่นกลาง — ภาษาไทยไม่เว้นวรรค
   * ระหว่างคำ ช่องว่างที่ JSX แถมมาตอนจัดบรรทัดจึงไปโผล่กลางคำบนหน้าจอ
   */
  const removedAtText = removal.removedAt ? ` เมื่อ ${formatThaiDate(removal.removedAt)}` : "";
  /**
   * ผู้มีอำนาจกระทำการแทนไม่ใช่คนกรอกฟอร์มลงทะเบียนหน่วยงาน — เขาถูกเชิญเข้ามาเพื่อลงนาม
   * เท่านั้น (HomeHeader ซ่อนปุ่มเดียวกันนี้จากเขาด้วยเหตุผลนี้) role ของเขาอ่านจาก
   * `removal.role` ไม่ใช่ `user.roles` เพราะสิทธิ์ถูกเพิกถอนไปแล้ว roles จึงว่าง
   */
  const mayRegister = removal.role !== "ORGANIZATION_APPROVER";

  return (
    <div className="relative mx-auto flex min-h-[calc(100vh-8.5rem)] max-w-2xl items-center justify-center px-4 py-16">
      <DotDecoration className="right-0 top-4 h-52 w-52 text-navy-500" />
      <DotDecoration className="bottom-4 left-0 h-40 w-40 text-coral-500" />

      <div className="relative w-full text-center">
        <div className="mx-auto grid h-24 w-24 place-items-center rounded-full bg-warning-bg">
          <svg
            viewBox="0 0 48 48"
            className="h-11 w-11 text-warning"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            aria-hidden="true"
          >
            <path d="M24 3 3 43h42L24 3Z" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M24 17v11" strokeLinecap="round" />
            <circle cx="24" cy="35" r="1.8" fill="currentColor" stroke="none" />
          </svg>
        </div>

        <h1 className="mt-7 text-[28px] font-semibold text-navy-800 sm:text-[30px]">
          บัญชีของคุณถูกถอดออกจากหน่วยงานแล้ว
        </h1>

        <div className="mt-6 rounded-xl border-l-[3px] border-warning bg-warning-bg p-5 text-left">
          <p className="text-[15px] leading-relaxed text-ink">
            {`ผู้ดูแลระบบได้มอบหน้าที่ \u201C${removal.roleLabel}\u201D ของ `}
            <span className="font-medium">{organizationName}</span>
            {` ให้ ${successor} แทนคุณ${removedAtText} \u2014 บัญชีของคุณจึงไม่ได้สังกัดหน่วยงานใดในระบบขณะนี้`}
          </p>
          {/* บอกให้ครบว่าของเดิมไม่ได้หายไปไหน ไม่งั้นจะอ่านเหมือนงานที่ทำมาถูกลบทิ้ง
              และบอกทางไปต่อ ไม่ใช่แค่บอกว่าเกิดอะไรขึ้น */}
          <p className="mt-2 text-[15px] leading-relaxed text-ink">
            {"ข้อมูลและคำขอทั้งหมดของ "}
            <span className="font-medium">{organizationName}</span>
            {" ยังอยู่ครบ เพียงแต่คุณเปิดดูไม่ได้จนกว่าจะได้รับสิทธิ์คืน หากคิดว่าไม่ถูกต้อง โปรดติดต่อผู้ดูแลระบบ BDI เพื่อขอสิทธิ์ในหน่วยงานเดิมคืน"}
          </p>
        </div>

        {mayRegister ? (
          <>
            <p className="mx-auto mt-8 max-w-lg text-[15px] leading-relaxed text-ink-muted">
              {"หากคุณย้ายไปรับผิดชอบหน่วยงานอื่น เริ่มลงทะเบียนหน่วยงานนั้นได้จากปุ่มด้านล่าง \u2014 ปุ่มนี้สร้าง"}
              <span className="font-medium">หน่วยงานใหม่คนละแห่ง</span>
              {" ไม่ได้พาคุณกลับเข้า "}
              <span className="font-medium">{organizationName}</span>
            </p>

            <Button
              size="lg"
              variant="secondary"
              className="mt-6"
              loading={loading}
              onClick={onCreate}
            >
              สร้างหน่วยงานใหม่
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
}

function CreateOrganizationPrompt({
  loading,
  onCreate,
}: {
  loading: boolean;
  onCreate: () => void;
}) {
  // สเปก: "ระบบจะแสดงปุ่มสร้างหน่วยงานตรงกลางหน้าจอ ซึ่งเป็นเมนูเดียวที่ผู้ใช้เห็นและทำได้"
  return (
    <div className="relative mx-auto flex min-h-[calc(100vh-8.5rem)] max-w-2xl items-center justify-center px-4 py-16">
      <DotDecoration className="right-0 top-4 h-52 w-52 text-navy-500" />
      <DotDecoration className="bottom-4 left-0 h-40 w-40 text-coral-500" />

      <div className="relative text-center">
        <div className="mx-auto grid h-24 w-24 place-items-center rounded-full bg-coral-50">
          <svg
            viewBox="0 0 48 48"
            className="h-11 w-11 text-navy-800"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            aria-hidden="true"
          >
            <path d="M8 42V14l12-6 12 6v28" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M32 42V22h8v20M4 42h40" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M16 20h8M16 27h8M16 34h8" strokeLinecap="round" />
          </svg>
        </div>

        <h1 className="mt-7 text-[28px] font-semibold text-navy-800 sm:text-[30px]">
          ยังไม่มีหน่วยงานในระบบ
        </h1>
        <p className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-ink-muted">
          เริ่มต้นด้วยการสร้างหน่วยงานของคุณ เพื่อเข้าใช้งานแพลตฟอร์มข้อมูลภาครัฐ
          ระบบจะพาคุณกรอกข้อมูลทีละขั้นและสร้างแบบฟอร์มให้อัตโนมัติ
        </p>

        <Button size="lg" className="mt-8" loading={loading} onClick={onCreate}>
          สร้างหน่วยงาน
        </Button>
      </div>
    </div>
  );
}

