"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { DatasetSection } from "@/components/home/DatasetSection";
import { LandingPage } from "@/components/landing/LandingPage";
import { useSession } from "@/components/SessionProvider";
import { Button } from "@/components/ui/Button";
import { Card, DotDecoration, OrganizationStatusBadge } from "@/components/ui/Card";
import { Spinner } from "@/components/ui/Spinner";
import { useToast } from "@/components/ui/Toast";
import { api } from "@/lib/api";
import { useOrganizationRegistration } from "@/lib/use-organization-registration";
import {
  bdiLandingPath,
  isBdiStaff,
  isPendingDatasetStatus,
  type DatasetRequestStatus,
  type OrganizationStatus,
} from "@/lib/status";
import type { DatasetRequestListItem, OrganizationListItem } from "@/lib/types";

export default function HomePage() {
  const { user, loading } = useSession();
  const router = useRouter();
  const { start, starting } = useOrganizationRegistration();

  useEffect(() => {
    if (loading) return;
    // ผู้ที่ยังไม่ล็อกอินได้หน้าแนะนำระบบ ไม่ใช่หน้าล็อกอิน — เดิมเด้งไป /login ทันที
    // ทำให้ไม่มีที่อธิบายว่าระบบนี้คืออะไรให้คนที่เพิ่งเข้ามาอ่าน
    if (!user) return;
    if (isBdiStaff(user.roles)) router.replace(bdiLandingPath(user.roles));
  }, [user, loading, router]);

  if (loading) return <Spinner />;
  if (!user) return <LandingPage />;
  if (isBdiStaff(user.roles)) return <Spinner />;

  // ผู้มีอำนาจกระทำการแทนที่ถูกเชิญเข้ามาทีหลังยังไม่ถูกผูก organizationId
  // แต่เห็นคำขอของหน่วยงานตัวเองผ่าน signatoryEmail จึงต้องได้หน้าแรกแบบเดียวกัน
  // ไม่ใช่หน้าชวนสร้างหน่วยงาน
  const isApprover = user.roles.includes("ORGANIZATION_APPROVER");
  if (!user.organizationId && !isApprover) {
    return <CreateOrganizationPrompt loading={starting} onCreate={start} />;
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
  const [rows, setRows] = useState<DatasetRequestListItem[] | null>(null);
  const [orgRequests, setOrgRequests] = useState<OrganizationListItem[]>([]);

  useEffect(() => {
    // ดึงครั้งเดียวแล้วแบ่ง section ฝั่งหน้าเว็บ — endpoint คืนเฉพาะคำขอที่ผู้ใช้เห็นได้อยู่แล้ว
    // และยิงสองรอบด้วย ?status= ก็ได้ข้อมูลชุดเดียวกันแต่เสียรอบเน็ตเวิร์กเปล่า ๆ
    api
      .get<{ requests: DatasetRequestListItem[] }>("/api/dataset-requests")
      .then((d) => setRows(d.requests))
      .catch(() => {
        setRows([]);
        show({ tone: "error", title: "โหลดรายการชุดข้อมูลไม่สำเร็จ" });
      });

    /**
     * คำขอลงทะเบียนหน่วยงาน — คนละเส้นทางกับชุดข้อมูล และหน้าแรกเคยไม่พูดถึงเลย
     *
     * ผู้มีอำนาจกระทำการแทนถูกเชิญเข้ามาเพื่อลงนามในคำขอใบหนึ่งโดยเฉพาะ แต่เข้ามาแล้ว
     * เจอหน้าแรกที่พูดเรื่องชุดข้อมูลล้วน ๆ ไม่มีทางไปต่อ ต้องเดาว่าต้องกดเมนู
     * "หน่วยงานของฉัน" เอง
     */
    api
      .get<{ organizations: OrganizationListItem[] }>("/api/organizations")
      .then((d) => setOrgRequests(d.organizations))
      .catch(() => setOrgRequests([]));
  }, [show]);

  /** คำขอลงทะเบียนหน่วยงานที่หยุดรอการลงนามของผู้ใช้คนนี้ */
  const awaitingSignature = isApprover
    ? orgRequests.find((r) => r.currentTaskType === "ORGANIZATION_APPROVAL")
    : undefined;

  const { pending, others, awaitingMe, counts } = useMemo(() => split(rows ?? []), [rows]);

  const name = user?.firstName?.trim() || user?.email || "";
  const organization = user?.organization ?? null;

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <HomeHeader
        name={name}
        organization={organization}
        // ผู้ลงนามไม่ใช่คนกรอกฟอร์มลงทะเบียน จึงไม่ต้องเห็นปุ่มนี้
        onRegister={isApprover ? undefined : onRegister}
        registering={registering}
      />

      {/* ยกขึ้นก่อนทุกอย่าง รวมถึงก่อน spinner ของรายการชุดข้อมูล — งานที่ค้างรอคนนี้อยู่
          ต้องเห็นทันทีที่เปิดหน้า ไม่ใช่หลังจากรอรายการอื่นโหลดเสร็จ */}
      {awaitingSignature ? (
        <Card className="mb-8 border-l-[3px] border-l-coral-500">
          <div className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="font-medium text-navy-800">รอคุณเห็นชอบและลงนามคำขอลงทะเบียนหน่วยงาน</p>
              <p className="mt-0.5 text-sm leading-relaxed text-ink-muted">
                {awaitingSignature.name} ผ่านการตรวจสอบจากเจ้าหน้าที่ BDI แล้ว
                และหยุดรอให้คุณอ่านเอกสารข้อตกลงแล้วลงนามในฐานะผู้มีอำนาจกระทำการแทน
              </p>
            </div>
            <Link href={`/organizations/${awaitingSignature.id}`} className="shrink-0">
              <Button>อ่านเอกสารและลงนาม</Button>
            </Link>
          </div>
        </Card>
      ) : null}

      {rows === null ? (
        <Spinner className="min-h-[40vh]" />
      ) : (
        <>
          <StatTiles counts={counts} total={rows.length} />

          {/* ผู้มีอำนาจกระทำการแทนคือคนเดียวที่กดต่อได้เมื่อคำขอค้างที่ด่านนี้
              จึงยกขึ้นมาเป็นการ์ดแยก ไม่ให้จมอยู่ในรายการรวม */}
          {isApprover && awaitingMe.length > 0 ? (
            <Card className="mb-8 border-l-[3px] border-l-coral-500">
              <div className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-medium text-navy-800">
                    รอคุณพิจารณาและลงนาม {awaitingMe.length} รายการ
                  </p>
                  <p className="mt-0.5 text-sm text-ink-muted">
                    คำขอเหล่านี้ผ่านการตรวจสอบเบื้องต้นจาก BDI แล้ว และหยุดรอความเห็นชอบของคุณ
                  </p>
                </div>
                <Link href={`/datasets/${awaitingMe[0].id}`} className="shrink-0">
                  <Button>เริ่มพิจารณา</Button>
                </Link>
              </div>
            </Card>
          ) : null}

          <div className="flex flex-col gap-8">
            <DatasetSection
              title="รายการข้อมูลที่รออนุมัติ"
              description="คำขอที่นำส่งแล้วและยังอยู่ระหว่างการพิจารณา เรียงตามวันเวลาที่ส่งคำขอ ล่าสุดอยู่บนสุด"
              rows={pending}
              tone="attention"
              emptyText="ยังไม่มีคำขอที่รอการอนุมัติ"
            />

            <DatasetSection
              title="ชุดข้อมูลของหน่วยงาน"
              description="ชุดข้อมูลที่ลงทะเบียนเข้ามาแล้ว ทั้งฉบับร่าง รายการที่ต้องแก้ไข และรายการที่จบกระบวนการ"
              rows={others}
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
}: {
  name: string;
  organization: { id: string; name: string; status: string } | null;
  onRegister?: () => void;
  registering?: boolean;
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

        {status && status !== "ACTIVE" ? (
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

/**
 * แบ่งคำขอออกเป็นสอง section ตามสเปก แล้วนับยอดสำหรับการ์ดสรุป
 *
 * รายการที่รออนุมัติไม่ถูกใส่ซ้ำใน section ล่าง — สเปกเขียนว่า "ตามด้วยชุดข้อมูลของ
 * organization นั้น ๆ" คือส่วนที่เหลือ ไม่ใช่รายการเดิมซ้ำอีกรอบ
 *
 * ทั้งสอง section เรียงตามวันเวลาที่ส่งคำขอจากใหม่ไปเก่า (ร่างที่ยังไม่ส่งใช้วันที่สร้างแทน)
 * ทิศทางเดียวกับตารางในหน้า /datasets เพื่อไม่ให้ผู้ใช้ต้องอ่านสองแบบในจอเดียว
 */
function split(rows: DatasetRequestListItem[]) {
  const at = (r: DatasetRequestListItem) => new Date(r.submittedAt ?? r.createdAt).getTime();
  const byNewest = (a: DatasetRequestListItem, b: DatasetRequestListItem) => at(b) - at(a);

  const pending = rows.filter((r) => isPendingDatasetStatus(r.status)).sort(byNewest);
  const others = rows.filter((r) => !isPendingDatasetStatus(r.status)).sort(byNewest);

  const count = (status: DatasetRequestStatus) => rows.filter((r) => r.status === status).length;

  return {
    pending,
    others,
    awaitingMe: pending.filter((r) => r.currentTaskType === "ORGANIZATION_APPROVAL"),
    counts: {
      pending: pending.length,
      revision: count("RETURNED"),
      approved: count("APPROVED"),
    },
  };
}
