"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { DatasetSection } from "@/components/home/DatasetSection";
import { OrganizationSection } from "@/components/home/OrganizationSection";
import { useSession } from "@/components/SessionProvider";
import { Button } from "@/components/ui/Button";
import { Card, DotDecoration } from "@/components/ui/Card";
import { Spinner } from "@/components/ui/Spinner";
import { useToast } from "@/components/ui/Toast";
import { api } from "@/lib/api";
import { hasOwnQueue, nodeCount, type ListSummary, type PageInfo } from "@/lib/stage";
import { ROLE_LABELS, isSpecialistOnly, type Role } from "@/lib/status";
import type { DatasetRequestListItem, OrganizationListItem } from "@/lib/types";

const ORGANIZATIONS = "/admin/organizations";
const DATASETS = "/admin/datasets";

/** ปลายทางทั้งห้า — ห้าคีย์นี้เป็นสถานะล้วน หน้าเว็บจึงเป็นเจ้าของได้ ต่างจากชื่อด่าน */
const SETTLED = ["DRAFT", "RETURNED", "APPROVED", "REJECTED", "CANCELLED"];

interface Page<T> {
  rows: T[];
  page: PageInfo;
}

const EMPTY_PAGE: PageInfo = { page: 1, pageSize: 5, total: 0, pageCount: 1 };

/** ยังเดินอยู่ในสายพาน = ทั้งหมด ลบปลายทางทั้งห้า — ไม่ต้องไล่ชื่อด่านเอง */
const inFlight = (s: ListSummary | null) =>
  s ? s.total - SETTLED.reduce((sum, k) => sum + nodeCount(s, k), 0) : 0;

/**
 * หน้าแรกของเจ้าหน้าที่ BDI
 *
 * เดิมฝั่ง BDI ไม่มีหน้าแรกเลย ทุกคนถูกเด้งออกจาก `/` ไปยืนบนตารางคิวตั้งแต่วินาทีที่ล็อกอิน
 * คนที่ถือด่านของทั้งสองเส้นทางจึงต้องเปิดสองตารางแล้วสลับแท็บเอง เพื่อตอบคำถามเดียวว่า
 * "ตอนนี้มีอะไรค้างรอฉันอยู่บ้าง"
 *
 * โครงเดียวกับหน้าแรกของฝั่งหน่วยงาน (`OrganizationHome` ใน app/page.tsx) ทุกชั้น —
 * ทักทาย, การ์ดสรุปสี่ใบ, การ์ด coral ของงานที่หยุดรอผู้อ่านอยู่, แล้ว section ของรายการ —
 * ต่างกันที่ที่นี่มี **สอง** เส้นทางให้ดู ไม่ใช่เส้นทางเดียว
 *
 * ทุกตัวเลขและทุกแถวมาจากเซิร์ฟเวอร์: `mine` บน `/summary` คือผลรวมของด่านที่ตำแหน่งของ
 * ผู้อ่านเป็นเจ้าของ และ `scope=mine` บนรายการก็ตัดสินด้วยกติกาเดียวกัน หน้านี้จึงไม่ต้องรู้
 * ว่าด่านไหนเป็นของ role ไหน ตามกติกาที่หัวไฟล์ lib/stage.ts เขียนไว้
 */
export function BdiHome() {
  const { user } = useSession();
  const { show } = useToast();

  const roles = useMemo(() => user?.roles ?? [], [user?.roles]);
  /**
   * ผู้เชี่ยวชาญที่ไม่ได้ถือ role อื่นของ BDI ไม่มีเมนู "หน่วยงาน" (navItems ใน AppShell)
   * ครึ่งหน่วยงานของหน้านี้จึงหายไปทั้งครึ่ง ไม่ใช่แค่ว่างเปล่า — เขาอ่านคำขอชุดข้อมูล
   * ที่ถูกมอบหมายให้เท่านั้น
   */
  const specialistOnly = isSpecialistOnly(roles);
  /**
   * มีด่านเป็นของตำแหน่งตัวเองไหม — ตัดสินจาก role ที่รู้อยู่แล้ว ไม่ใช่จากตัวเลขที่ต้องรอโหลด
   * เหตุผลเดียวกับ `useRequestList`: คำตอบนี้เลือกว่าจะ **ถามอะไร** กับ API (คำขอที่รอฉัน
   * หรือคำขอล่าสุดในระบบ) ถ้ารอ `/summary` ก่อน หน้าจะยิงสองรอบและสลับเนื้อหาให้เห็น
   * ตัวเลขและแถวยังมาจากเซิร์ฟเวอร์ทั้งหมด เดาผิดจึงได้หัวข้อผิด ไม่ใช่ข้อมูลผิด
   * (นิติกร BDI คือ role เดียวฝั่งนี้ที่ไม่มีด่านเลย — ดู ROLES_WITHOUT_QUEUE ใน lib/stage.ts)
   */
  const hasQueue = hasOwnQueue(roles);

  const [orgSummary, setOrgSummary] = useState<ListSummary | null>(null);
  const [datasetSummary, setDatasetSummary] = useState<ListSummary | null>(null);
  const [orgRows, setOrgRows] = useState<Page<OrganizationListItem> | null>(null);
  const [datasetRows, setDatasetRows] = useState<Page<DatasetRequestListItem> | null>(null);

  useEffect(() => {
    const load = <T,>(path: string, key: string): Promise<Page<T>> =>
      api.get<Record<string, unknown>>(path).then((d) => ({
        rows: (d[key] as T[]) ?? [],
        page: (d.page as PageInfo) ?? EMPTY_PAGE,
      }));

    const scope = hasQueue ? "scope=mine&" : "";

    api
      .get<ListSummary>("/api/dataset-requests/summary")
      .then(setDatasetSummary)
      .catch(() => show({ tone: "error", title: "โหลดคำขอลงทะเบียนชุดข้อมูลไม่สำเร็จ" }));

    load<DatasetRequestListItem>(`/api/dataset-requests?${scope}pageSize=5`, "requests")
      .then(setDatasetRows)
      .catch(() => setDatasetRows({ rows: [], page: EMPTY_PAGE }));

    if (specialistOnly) return;

    api
      .get<ListSummary>("/api/organizations/summary")
      .then(setOrgSummary)
      .catch(() => show({ tone: "error", title: "โหลดคำขอลงทะเบียนหน่วยงานไม่สำเร็จ" }));

    load<OrganizationListItem>(`/api/organizations?${scope}pageSize=5`, "organizations")
      .then(setOrgRows)
      .catch(() => setOrgRows({ rows: [], page: EMPTY_PAGE }));
  }, [show, hasQueue, specialistOnly]);

  const name = user?.firstName?.trim() || user?.email || "";
  const organizationName = user?.organization?.name ?? null;

  const orgMine = orgSummary?.mine ?? 0;
  const datasetMine = datasetSummary?.mine ?? 0;
  const mine = orgMine + datasetMine;

  const tiles = useMemo(() => {
    const approved =
      nodeCount(orgSummary, "APPROVED") + nodeCount(datasetSummary, "APPROVED");
    const waiting = hasQueue
      ? { label: "รอคุณดำเนินการ", value: mine, className: "text-coral-600" }
      : {
          label: "อยู่ระหว่างพิจารณา",
          value: inFlight(orgSummary) + inFlight(datasetSummary),
          className: "text-navy-600",
        };

    return [
      waiting,
      ...(specialistOnly
        ? [
            {
              label: "อยู่ระหว่างพิจารณา",
              value: inFlight(datasetSummary),
              className: "text-navy-600",
            },
          ]
        : [
            {
              label: "คำขอลงทะเบียนหน่วยงาน",
              value: orgSummary?.total ?? 0,
              className: "text-navy-800",
            },
          ]),
      {
        label: specialistOnly ? "ได้รับมอบหมายทั้งหมด" : "คำขอลงทะเบียนชุดข้อมูล",
        value: datasetSummary?.total ?? 0,
        className: "text-navy-800",
      },
      { label: "อนุมัติแล้ว", value: approved, className: "text-success" },
    ];
  }, [orgSummary, datasetSummary, hasQueue, mine, specialistOnly]);

  /* ประโยคไทยประกอบเป็นชิ้นเดียว ไม่ปล่อยให้ JSX ขึ้นบรรทัดใหม่คั่นกลาง */
  const scopeNote = specialistOnly
    ? "ด้านล่างคือคำขอลงทะเบียนชุดข้อมูลที่เจ้าหน้าที่ BDI ขอความเห็นของคุณในฐานะผู้เชี่ยวชาญด้านข้อมูล"
    : hasQueue
      ? "ด้านล่างคือคำขอที่หยุดรอการดำเนินการของคุณอยู่ ทั้งคำขอลงทะเบียนหน่วยงานและคำขอลงทะเบียนชุดข้อมูล"
      : "ด้านล่างคือคำขอล่าสุดในระบบ ทั้งคำขอลงทะเบียนหน่วยงานและคำขอลงทะเบียนชุดข้อมูล";

  const breakdown = [
    orgMine > 0 ? `คำขอลงทะเบียนหน่วยงาน ${orgMine} รายการ` : null,
    datasetMine > 0 ? `คำขอลงทะเบียนชุดข้อมูล ${datasetMine} รายการ` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const waitingForOrganizations = specialistOnly || orgRows !== null;
  const loaded = datasetSummary !== null && datasetRows !== null && waitingForOrganizations;

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <header className="relative mb-8 overflow-hidden">
        <DotDecoration className="-right-4 -top-6 h-36 w-36 text-navy-500" />
        <div className="relative">
          <p className="text-[15px] text-ink-muted">สวัสดี {name}</p>
          {/* เจ้าหน้าที่ BDI สังกัดองค์กร BDI จริงในฐานข้อมูล ชื่อหน่วยงานจึงมาเสมอ */}
          <h1 className="mt-1 text-[26px] font-semibold text-navy-800">
            {organizationName ?? "หน้าแรก"}
          </h1>
          {/* บทบาทเป็นสิ่งที่ตัดสินว่าเห็นอะไรบนหน้านี้ จึงเขียนไว้บนหน้าเลย ไม่ซ่อนในเมนูผู้ใช้ */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {roles.map((role) => (
              <span
                key={role}
                className="rounded-full bg-navy-50 px-3 py-1 text-[13px] font-medium text-navy-700"
              >
                {ROLE_LABELS[role as Role] ?? role}
              </span>
            ))}
          </div>
          <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-ink-muted">{scopeNote}</p>
        </div>
      </header>

      {!loaded ? (
        <Spinner className="min-h-[40vh]" />
      ) : (
        <>
          <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
            {tiles.map((t) => (
              <Card key={t.label} className="px-5 py-4">
                <p className="text-[13px] text-ink-muted">{t.label}</p>
                <p className={`mt-1 text-[28px] font-semibold leading-tight ${t.className}`}>
                  {t.value}
                </p>
              </Card>
            ))}
          </div>

          {/* งานที่หยุดรอผู้อ่านอยู่ต้องเห็นก่อนรายการ และต้องมีปุ่มพาไปทำต่อ ไม่ใช่แค่ตัวเลข */}
          {hasQueue && mine > 0 ? (
            <Card className="mb-8 border-l-[3px] border-l-coral-500">
              <div className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="font-medium text-navy-800">{`งานที่รอคุณดำเนินการ ${mine} รายการ`}</p>
                  <p className="mt-0.5 text-sm leading-relaxed text-ink-muted">{breakdown}</p>
                </div>
                {/* `?tab=mine` ไม่ใช่ `?scope=mine` — หน้าตารางอ่านแท็บจาก `tab`
                    แล้วค่อยแปลงเป็น scope ตอนยิง API (ดู lib/use-request-list.ts) */}
                <div className="flex shrink-0 flex-wrap gap-2">
                  {orgMine > 0 ? (
                    <Link href={`${ORGANIZATIONS}?tab=mine`}>
                      <Button>ตรวจคำขอหน่วยงาน</Button>
                    </Link>
                  ) : null}
                  {datasetMine > 0 ? (
                    <Link href={`${DATASETS}?tab=mine`}>
                      <Button variant={orgMine > 0 ? "secondary" : "primary"}>
                        ตรวจคำขอชุดข้อมูล
                      </Button>
                    </Link>
                  ) : null}
                </div>
              </div>
            </Card>
          ) : null}

          <div className="flex flex-col gap-8">
            {specialistOnly || orgRows === null ? null : (
              <OrganizationSection
                basePath={ORGANIZATIONS}
                tone={hasQueue ? "attention" : "plain"}
                title={
                  hasQueue ? "คำขอลงทะเบียนหน่วยงานที่รอคุณดำเนินการ" : "คำขอลงทะเบียนหน่วยงานล่าสุด"
                }
                description={
                  hasQueue
                    ? "คำขอที่หยุดอยู่ที่ด่านของตำแหน่งคุณ และรอให้คุณตรวจสอบหรือลงนาม"
                    : "คำขอลงทะเบียนหน่วยงานที่เข้ามาล่าสุดในระบบ"
                }
                rows={orgRows.rows}
                count={orgRows.page.total}
                emptyText={
                  hasQueue
                    ? "ไม่มีคำขอลงทะเบียนหน่วยงานที่รอคุณอยู่"
                    : "ยังไม่มีคำขอลงทะเบียนหน่วยงานในระบบ"
                }
                footer={
                  <SectionLinks
                    basePath={ORGANIZATIONS}
                    hasQueue={hasQueue}
                    shown={orgRows.rows.length}
                    total={orgRows.page.total}
                    mineText="ดูคำขอหน่วยงานที่รอคุณทั้ง"
                    allText="ดูคำขอลงทะเบียนหน่วยงานทั้งหมดพร้อมตัวกรองและการค้นหา →"
                  />
                }
              />
            )}

            {datasetRows === null ? null : (
              <DatasetSection
                basePath={DATASETS}
                showOrganization
                tone={hasQueue ? "attention" : "plain"}
                title={
                  specialistOnly
                    ? "คำขอชุดข้อมูลที่ขอความเห็นของคุณ"
                    : hasQueue
                      ? "คำขอลงทะเบียนชุดข้อมูลที่รอคุณดำเนินการ"
                      : "คำขอลงทะเบียนชุดข้อมูลล่าสุด"
                }
                description={
                  specialistOnly
                    ? "คำขอที่คุณถูกมอบหมายให้อ่านและให้ความเห็นในฐานะผู้เชี่ยวชาญด้านข้อมูล"
                    : hasQueue
                      ? "คำขอที่หยุดอยู่ที่ด่านของตำแหน่งคุณ และรอให้คุณตรวจสอบหรือลงนาม"
                      : "คำขอลงทะเบียนชุดข้อมูลที่เข้ามาล่าสุดในระบบ"
                }
                rows={datasetRows.rows}
                count={datasetRows.page.total}
                emptyText={
                  specialistOnly
                    ? "ยังไม่มีคำขอที่เจ้าหน้าที่ BDI ขอความเห็นของคุณ"
                    : hasQueue
                      ? "ไม่มีคำขอลงทะเบียนชุดข้อมูลที่รอคุณอยู่"
                      : "ยังไม่มีคำขอลงทะเบียนชุดข้อมูลในระบบ"
                }
                footer={
                  <SectionLinks
                    basePath={DATASETS}
                    hasQueue={hasQueue}
                    shown={datasetRows.rows.length}
                    total={datasetRows.page.total}
                    mineText="ดูคำขอชุดข้อมูลที่รอคุณทั้ง"
                    allText="ดูคำขอลงทะเบียนชุดข้อมูลทั้งหมดพร้อมตัวกรองและการค้นหา →"
                  />
                }
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * บรรทัดปิดท้าย section
 *
 * ลิงก์แรกโผล่เฉพาะตอนที่รายการยาวกว่าห้าแถวที่โชว์อยู่ — ถ้าไม่ยาวกว่า มันก็พาไปเห็นของเดิม
 * ลิงก์ที่สองมีเสมอ เพราะ section นี้ตอบแค่ "อะไรรอฉันอยู่" ส่วนคำถามอื่นทั้งหมดอยู่ที่ตาราง
 */
function SectionLinks({
  basePath,
  hasQueue,
  shown,
  total,
  mineText,
  allText,
}: {
  basePath: string;
  hasQueue: boolean;
  shown: number;
  total: number;
  mineText: string;
  allText: string;
}) {
  const linkClass = "text-sm font-medium text-navy-700 underline-offset-4 hover:underline";
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      {hasQueue && total > shown ? (
        <Link href={`${basePath}?tab=mine`} className={linkClass}>
          {`${mineText} ${total} รายการ →`}
        </Link>
      ) : null}
      <Link href={`${basePath}?tab=all`} className={linkClass}>
        {allText}
      </Link>
    </div>
  );
}
