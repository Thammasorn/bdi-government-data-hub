"use client";

/**
 * หน้าแรกก่อนเข้าสู่ระบบ — ตาม assets/info_page/25690806_D2 info page.pptx
 *
 * เลย์เอาต์ตามสไลด์: แถบ navy ด้านซ้ายค้างอยู่กับที่ มีโลโก้ BDI อยู่บนสุดและรายการหัวข้อ
 * ไล่ลงมา เนื้อหาอยู่ทางขวา หัวข้อที่กำลังอ่านอยู่จะถูกล้อมกรอบ (สไลด์วาดเป็นกรอบมน)
 *
 * ทั้งหน้าเป็นหน้าเดียวเลื่อนยาว ไม่ใช่คนละ route — สไลด์ทุกใบใช้ sidebar ชุดเดียวกัน
 * และไฮไลต์หัวข้อที่อยู่ ซึ่งอ่านได้ว่าเป็น anchor ในหน้าเดียวกัน
 *
 * บนจอแคบ sidebar ย้ายไปเป็นแถบหัวข้อเลื่อนแนวนอนด้านบน เพราะแถบ 260px กินพื้นที่
 * เกินครึ่งจอมือถือ
 */

import clsx from "clsx";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { Logo } from "@/components/brand/Logo";
import {
  BACKGROUND_BANNER,
  BACKGROUND_LEAD,
  BACKGROUND_POINTS,
  BDI_ROLES,
  BDI_ROLE_LEAD,
  BENEFITS,
  CONNECT_NOTE,
  CONNECT_STEPS,
  HERO,
  HOW_IT_WORKS,
  LEGAL_DOCUMENTS,
  LEGAL_REGULATION,
  OBJECTIVES,
  OBJECTIVES_BANNER,
  OBJECTIVES_LEAD,
  SECTIONS,
} from "./content";

export function LandingPage() {
  const active = useActiveSection();

  return (
    <div className="min-h-screen bg-white lg:flex">
      <SideNav active={active} />
      <main className="min-w-0 flex-1">
        <Hero />
        <Background />
        <Objectives />
        <BdiRole />
        <HowItWorks />
        <Benefits />
        <Connect />
        <Legal />
        <Pending id="faq" />
        <Pending id="news" />
        <Pending id="contact" />
        <SiteFooter />
      </main>
    </div>
  );
}

/**
 * หัวข้อที่กำลังอยู่ในสายตา
 *
 * ใช้เส้นอ้างอิงที่ 45% ของความสูงจอแทนการดู intersection ratio เพราะหัวข้อยาว ๆ
 * (ความเป็นมา) กับสั้น ๆ (ติดต่อเรา) จะได้ ratio ต่างกันมากจนตัวสั้นแทบไม่เคยชนะ
 */
function useActiveSection() {
  const [active, setActive] = useState(SECTIONS[0]!.id);

  useEffect(() => {
    const onScroll = () => {
      const line = window.innerHeight * 0.45;
      let current = SECTIONS[0]!.id;
      for (const section of SECTIONS) {
        const el = document.getElementById(section.id);
        if (el && el.getBoundingClientRect().top <= line) current = section.id;
      }
      // ถึงท้ายหน้าแล้วให้ไฮไลต์หัวข้อสุดท้ายเสมอ ไม่งั้นหัวข้อท้าย ๆ ที่สั้นกว่าจอ
      // จะไม่มีทางเลื่อนขึ้นไปถึงเส้นอ้างอิงได้เลย
      if (window.innerHeight + window.scrollY >= document.body.scrollHeight - 2) {
        current = SECTIONS[SECTIONS.length - 1]!.id;
      }
      setActive(current);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  return active;
}

function SideNav({ active }: { active: string }) {
  const listRef = useRef<HTMLUListElement>(null);

  // บนมือถือแถบเลื่อนแนวนอน ต้องเลื่อนตามหัวข้อที่ active ไม่งั้นผู้ใช้ไม่เห็นว่าอยู่ตรงไหน
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-nav="${active}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [active]);

  return (
    <nav
      aria-label="หัวข้อในหน้านี้"
      className="sticky top-0 z-20 bg-navy-800 lg:h-screen lg:w-[264px] lg:shrink-0 lg:overflow-y-auto"
    >
      <div className="hidden justify-center px-7 pb-6 pt-8 lg:flex">
        <Link
          href="/"
          className="rounded-lg bg-white px-5 py-4 transition-opacity hover:opacity-90"
          aria-label="หน้าแรก Government Datahub Platform"
        >
          <Logo subtitle={null} />
        </Link>
      </div>

      <ul
        ref={listRef}
        className="flex gap-1 overflow-x-auto px-3 py-3 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:px-4 lg:py-0 lg:pb-8"
      >
        {SECTIONS.map((section) => {
          const current = active === section.id;
          return (
            <li key={section.id} className="shrink-0 lg:shrink">
              <a
                href={`#${section.id}`}
                data-nav={section.id}
                aria-current={current ? "true" : undefined}
                className={clsx(
                  "block whitespace-nowrap rounded-lg px-3.5 py-2.5 text-[15px] leading-relaxed transition-colors lg:whitespace-normal",
                  current
                    ? "bg-navy-700 text-white ring-1 ring-white/45"
                    : "text-white/80 hover:bg-navy-700/60 hover:text-white",
                )}
              >
                {/*
                  สไลด์ตัดบรรทัดหัวข้อยาวไว้ ซึ่งอ่านดีในคอลัมน์แคบด้านซ้าย
                  แต่บนมือถือแถบเป็นแนวนอน การตัดบรรทัดทำให้แถบสูงเป็นสองเท่า
                  และหัวข้อเรียงไม่ตรงกัน จึงต่อกลับเป็นบรรทัดเดียว
                */}
                <span className="lg:hidden">{section.navLabel.join(" ")}</span>
                <span className="hidden lg:block">
                  {section.navLabel.map((line, i) => (
                    <span key={i} className="block">
                      {line}
                    </span>
                  ))}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

// ────────────────────────────────────────────────────────────── ส่วนประกอบ

function Section({
  id,
  heading,
  lead,
  children,
  tone = "white",
}: {
  id: string;
  heading: string;
  lead?: string;
  children?: React.ReactNode;
  tone?: "white" | "canvas";
}) {
  return (
    <section
      id={id}
      // scroll-mt กันหัวข้อถูกแถบ nav ด้านบน (โหมดมือถือ) บังตอนกดลิงก์
      className={clsx("scroll-mt-24 px-6 py-14 sm:px-10 lg:scroll-mt-0 lg:px-16 lg:py-20", {
        "bg-white": tone === "white",
        "bg-canvas": tone === "canvas",
      })}
    >
      <div className="mx-auto max-w-4xl">
        <h2 className="font-heading text-[26px] font-semibold text-navy-800 sm:text-[30px]">
          {heading}
        </h2>
        {lead ? <p className="mt-4 text-[17px] leading-[1.8] text-ink-muted">{lead}</p> : null}
        {children}
      </div>
    </section>
  );
}

/** การ์ดมีเลขลำดับกำกับ ตามที่ mockup ในสไลด์วาดไว้ (01 02 03 04) */
function NumberedCard({ index, title, body }: { index: number; title: string; body: string }) {
  return (
    <div className="rounded-xl border border-line bg-white p-6">
      <span className="font-heading text-[13px] font-semibold text-coral-500">
        {String(index + 1).padStart(2, "0")}
      </span>
      <h3 className="mt-2 font-heading text-[17px] font-semibold text-navy-800">{title}</h3>
      <p className="mt-2 text-[15px] leading-[1.8] text-ink-muted">{body}</p>
    </div>
  );
}

/** แถบสรุปสีเข้มท้ายหัวข้อ — สไลด์เรียกว่า "ข้อความแถบด้านล่าง" */
function Banner({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-8 rounded-xl bg-navy-800 px-6 py-5 text-[16px] leading-[1.8] text-white">
      {children}
    </p>
  );
}

// ─────────────────────────────────────────────────────────────── แต่ละหัวข้อ

function Hero() {
  return (
    // Tailwind 4 เปลี่ยนชื่อ utility เป็น bg-linear-to-* — bg-gradient-to-* ไม่ถูกสร้างออกมา
    // แล้วเงียบ ๆ ทำให้พื้นหลังเป็นสีขาว และตัวหนังสือสีขาวบนนั้นหายไปทั้งหมด
    <header className="border-b border-line bg-linear-to-br from-navy-800 to-navy-600 px-6 py-16 sm:px-10 lg:px-16 lg:py-20">
      <div className="mx-auto max-w-4xl">
        <p className="font-heading text-[14px] font-medium tracking-wide text-coral-200">
          {HERO.eyebrow}
        </p>
        <h1 className="mt-3 font-heading text-[32px] font-semibold leading-tight text-white sm:text-[40px]">
          {HERO.title}
        </h1>
        <p className="mt-5 max-w-3xl text-[17px] leading-[1.8] text-white/85">{HERO.lead}</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/login"
            className="rounded-full bg-coral-500 px-7 py-3 text-[15px] font-medium text-white transition-colors hover:bg-coral-600"
          >
            เข้าสู่ระบบ
          </Link>
          <a
            href="#connect"
            className="rounded-full border border-white/50 px-7 py-3 text-[15px] font-medium text-white transition-colors hover:bg-white/10"
          >
            ขั้นตอนการขอเชื่อมต่อ
          </a>
        </div>
      </div>
    </header>
  );
}

function Background() {
  return (
    <Section id="background" heading="ความเป็นมา" lead={BACKGROUND_LEAD} tone="canvas">
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {BACKGROUND_POINTS.map((point, i) => (
          <NumberedCard key={point.title} index={i} {...point} />
        ))}
      </div>
      <Banner>{BACKGROUND_BANNER}</Banner>
    </Section>
  );
}

function Objectives() {
  return (
    <Section id="objectives" heading="วัตถุประสงค์" lead={OBJECTIVES_LEAD}>
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {OBJECTIVES.map((objective, i) => (
          <NumberedCard key={objective.title} index={i} {...objective} />
        ))}
      </div>
      <Banner>{OBJECTIVES_BANNER}</Banner>
    </Section>
  );
}

function BdiRole() {
  return (
    <Section id="bdi-role" heading="บทบาทของ BDI" lead={BDI_ROLE_LEAD} tone="canvas">
      <ul className="mt-7 space-y-3">
        {BDI_ROLES.map((role) => (
          <li key={role} className="flex gap-3 rounded-xl border border-line bg-white p-5">
            <span
              aria-hidden="true"
              className="mt-2 h-2 w-2 shrink-0 rounded-full bg-coral-500"
            />
            <span className="text-[16px] leading-[1.8] text-ink">{role}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function HowItWorks() {
  return (
    <Section id="how-it-works" heading="D2 ทำงานอย่างไร">
      <ol className="mt-8 grid gap-4 sm:grid-cols-3">
        {HOW_IT_WORKS.map((step, i) => (
          <li key={step.title} className="rounded-xl border border-line bg-white p-6">
            <span className="font-heading text-[13px] font-semibold text-coral-500">
              ขั้นที่ {i + 1}
            </span>
            <h3 className="mt-2 font-heading text-[17px] font-semibold text-navy-800">
              {step.title}
            </h3>
            <p className="mt-2 text-[15px] leading-[1.8] text-ink-muted">{step.body}</p>
          </li>
        ))}
      </ol>
      <figure className="mt-8">
        <Image
          src="/d2-platform-diagram.png"
          alt="แผนภาพการทำงานของ D2 — ข้อมูลจากหลายหน่วยงานเข้าสู่แพลตฟอร์มกลางด้านข้อมูลขนาดใหญ่ แล้วนำออกไปใช้เป็นแดชบอร์ด การวางแผน การวิเคราะห์เชิงลึก การกำหนดนโยบาย และการบริหารราชการ"
          width={740}
          height={404}
          className="h-auto w-full rounded-xl border border-line"
          sizes="(max-width: 1024px) 100vw, 768px"
        />
      </figure>
    </Section>
  );
}

function Benefits() {
  return (
    <Section id="benefits" heading="ประโยชน์ของ D2" tone="canvas">
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {BENEFITS.map((benefit, i) => (
          <NumberedCard key={benefit.title} index={i} {...benefit} />
        ))}
      </div>
    </Section>
  );
}

function Connect() {
  return (
    <Section id="connect" heading="ขั้นตอนการขอเชื่อมต่อระบบ">
      <ol className="mt-8 grid gap-4 sm:grid-cols-3">
        {CONNECT_STEPS.map((step, i) => (
          <li key={step.title} className="rounded-xl border border-line bg-white p-6">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-navy-800 font-heading text-[15px] font-semibold text-white">
              {i + 1}
            </span>
            <h3 className="mt-3 font-heading text-[17px] font-semibold text-navy-800">
              {step.title}
            </h3>
            <p className="mt-2 text-[15px] leading-[1.8] text-ink-muted">{step.body}</p>
          </li>
        ))}
      </ol>
      <p className="mt-6 rounded-xl border border-line bg-canvas px-5 py-4 text-[15px] leading-[1.8] text-ink-muted">
        {CONNECT_NOTE}
      </p>
    </Section>
  );
}

function Legal() {
  return (
    <Section id="legal" heading="กฎหมายและเอกสารที่เกี่ยวข้อง" tone="canvas">
      <h3 className="mt-8 font-heading text-[18px] font-semibold text-navy-800">กฎหมายที่เกี่ยวข้อง</h3>
      <p className="mt-3 rounded-xl border border-line bg-white px-5 py-4 text-[16px] leading-[1.8] text-ink">
        {LEGAL_REGULATION}
      </p>

      <h3 className="mt-9 font-heading text-[18px] font-semibold text-navy-800">เอกสารที่เกี่ยวข้อง</h3>
      <ul className="mt-3 space-y-2.5">
        {LEGAL_DOCUMENTS.map((doc) => (
          <li
            key={doc.code}
            className={clsx(
              "flex gap-3 rounded-xl border border-line bg-white px-5 py-4",
              doc.annex && "sm:ml-8",
            )}
          >
            <span className="font-heading text-[15px] font-semibold text-coral-500">{doc.code}</span>
            <span className="text-[16px] leading-[1.8] text-ink">{doc.title}</span>
          </li>
        ))}
      </ul>
      <p className="mt-5 text-[14px] leading-[1.8] text-ink-subtle">
        ลิงก์ดาวน์โหลดเอกสารแต่ละฉบับอยู่ระหว่างจัดเตรียม
      </p>
    </Section>
  );
}

/**
 * หัวข้อที่มีใน sidebar ของสไลด์แต่ยังไม่มีเนื้อหา
 * แสดงหัวข้อไว้พร้อมบอกตรง ๆ ว่ายังไม่มีข้อมูล ดีกว่าเมนูที่กดแล้วไม่มีอะไร
 * และดีกว่าการแต่งเนื้อหาขึ้นเอง
 */
function Pending({ id }: { id: string }) {
  const section = SECTIONS.find((s) => s.id === id)!;
  const tone = SECTIONS.indexOf(section) % 2 === 0 ? "canvas" : "white";
  return (
    <Section id={id} heading={section.heading} tone={tone}>
      <p className="mt-6 rounded-xl border border-dashed border-line px-6 py-8 text-center text-[15px] text-ink-muted">
        อยู่ระหว่างจัดเตรียมเนื้อหา
      </p>
    </Section>
  );
}

function SiteFooter() {
  return (
    <footer className="bg-navy-900 px-6 py-10 sm:px-10 lg:px-16">
      <div className="mx-auto flex max-w-4xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[14px] leading-[1.8] text-white/70">
          สถาบันข้อมูลขนาดใหญ่ (องค์การมหาชน) — Big Data Institute
        </p>
        <Link
          href="/login"
          className="self-start text-[14px] font-medium text-white underline underline-offset-4 hover:text-coral-200 sm:self-auto"
        >
          เข้าสู่ระบบ
        </Link>
      </div>
    </footer>
  );
}
