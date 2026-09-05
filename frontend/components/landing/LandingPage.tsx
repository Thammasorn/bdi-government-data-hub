"use client";

/**
 * หน้าแรกก่อนเข้าสู่ระบบ
 *
 * เนื้อหามาจาก assets/info_page/25690806_D2 info page.pptx ครบทุกหัวข้อ แต่ไม่ได้ลอก
 * เลย์เอาต์ของสไลด์มาตรง ๆ — สไลด์วางแถบเมนูสีเข้มค้างไว้ทางซ้ายตลอด ซึ่งเป็นแบบที่
 * เหมาะกับสไลด์นำเสนอมากกว่าหน้าเว็บ: บนจอ 1440 มันกิน 264px ตลอดเวลาโดยไม่ให้อะไรกลับมา
 * และบนมือถือก็ต้องยุบทิ้งอยู่ดี
 *
 * ที่ใช้แทนคือแถบบนแบบโปร่งเบลอที่ติดขอบบน ซึ่งคืนความกว้างทั้งหน้าให้เนื้อหา
 * และยังไฮไลต์หัวข้อที่กำลังอ่านได้เหมือนเดิม
 *
 * แต่ละหัวข้อจงใจใช้รูปแบบต่างกัน (การ์ด · แผงสีเข้ม · ไทม์ไลน์ · รายการเอกสาร)
 * เพราะสิบหัวข้อที่หน้าตาเหมือนกันหมดจะกลายเป็นผนังเดียวที่กวาดตาหาอะไรไม่เจอ
 */

import clsx from "clsx";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { LogoImage } from "@/components/brand/Logo";

import diagram from "./d2-platform-diagram.webp";
import {
  BACKGROUND_BANNER,
  BACKGROUND_LEAD,
  BACKGROUND_POINTS,
  BDI_ROLES,
  BDI_ROLE_LEAD,
  BENEFITS,
  CAPABILITIES,
  CONNECT_NOTE,
  CONNECT_STEPS,
  HERO,
  HOW_IT_WORKS,
  LEGAL_ANNEXES,
  LEGAL_ANNEX_LABEL,
  LEGAL_PRIMARY,
  LEGAL_REGULATION,
  OBJECTIVES,
  OBJECTIVES_BANNER,
  OBJECTIVES_LEAD,
  SECTIONS,
} from "./content";

export function LandingPage() {
  const active = useActiveSection();
  useRevealOnScroll();

  return (
    <div className="bg-white">
      <TopNav active={active} />
      <main>
        <Hero />
        <Background />
        <Objectives />
        <BdiRole />
        <HowItWorks />
        <Benefits />
        <Connect />
        <Legal />
        <MoreInfo />
      </main>
      <SiteFooter />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────── hooks

/**
 * หัวข้อที่กำลังอยู่ในสายตา
 *
 * ใช้เส้นอ้างอิงที่ 40% ของความสูงจอแทน intersection ratio เพราะหัวข้อยาว ๆ กับสั้น ๆ
 * จะได้ ratio ต่างกันมากจนหัวข้อสั้นแทบไม่มีทางชนะ
 */
function useActiveSection() {
  const [active, setActive] = useState(SECTIONS[0]!.id);

  useEffect(() => {
    const onScroll = () => {
      const line = window.innerHeight * 0.4;
      let current = SECTIONS[0]!.id;
      for (const section of SECTIONS) {
        const el = document.getElementById(section.id);
        if (el && el.getBoundingClientRect().top <= line) current = section.id;
      }
      // ถึงท้ายหน้าแล้วไฮไลต์หัวข้อสุดท้ายเสมอ ไม่งั้นหัวข้อท้าย ๆ ที่สั้นกว่าจอ
      // จะไม่มีวันเลื่อนขึ้นถึงเส้นอ้างอิง
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

/**
 * ค่อย ๆ เผยเนื้อหาเมื่อเลื่อนถึง
 *
 * คลาส js-reveal ถูกใส่จาก JS เท่านั้น ถ้าสคริปต์ไม่ทำงานเนื้อหาจะแสดงตามปกติ
 * ไม่ใช่หน้าว่าง — หน้านี้เป็นหน้าที่คนนอกเข้ามาอ่าน จะพลาดตรงนี้ไม่ได้
 */
function useRevealOnScroll() {
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("js-reveal");

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-in");
            observer.unobserve(entry.target);
          }
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.05 },
    );

    document.querySelectorAll(".reveal").forEach((el) => observer.observe(el));
    return () => {
      observer.disconnect();
      root.classList.remove("js-reveal");
    };
  }, []);
}

// ───────────────────────────────────────────────────────────────────── nav

function TopNav({ active }: { active: string }) {
  const listRef = useRef<HTMLUListElement>(null);

  // แถบเลื่อนแนวนอนต้องเลื่อนตามหัวข้อที่ active ไม่งั้นผู้ใช้ไม่เห็นว่าอยู่ตรงไหน
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-nav="${active}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [active]);

  return (
    <header className="sticky top-0 z-30 border-b border-line/70 bg-white/80 frost-12">
      <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3 sm:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2.5" aria-label="หน้าแรก D2">
          <LogoImage className="h-14" />
          <span className="hidden font-heading text-[15px] font-semibold text-navy-800 sm:block">
            D2
          </span>
        </Link>

        <nav aria-label="หัวข้อในหน้านี้" className="min-w-0 flex-1">
          <ul
            ref={listRef}
            className="flex gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {SECTIONS.map((section) => {
              const current = active === section.id;
              return (
                <li key={section.id} className="shrink-0">
                  <a
                    href={`#${section.id}`}
                    data-nav={section.id}
                    aria-current={current ? "true" : undefined}
                    className={clsx(
                      "block whitespace-nowrap rounded-full px-3 py-1.5 text-[14px] transition-colors",
                      current
                        ? "bg-navy-800 font-medium text-white"
                        : "text-ink-muted hover:bg-navy-50 hover:text-navy-800",
                    )}
                  >
                    {section.navLabel}
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>

        <Link
          href="/login"
          className="shrink-0 rounded-full bg-coral-500 px-5 py-2 text-[14px] font-medium text-white transition-colors hover:bg-coral-600"
        >
          เข้าสู่ระบบ
        </Link>
      </div>
    </header>
  );
}

// ──────────────────────────────────────────────────────────── ส่วนประกอบ

function Section({
  id,
  children,
  tone = "white",
}: {
  id: string;
  children: React.ReactNode;
  tone?: "white" | "canvas" | "navy";
}) {
  return (
    <section
      id={id}
      // scroll-mt กันหัวข้อถูกแถบบนบังตอนกดลิงก์
      className={clsx("scroll-mt-20 px-4 py-16 sm:px-6 lg:py-24", {
        "bg-white": tone === "white",
        "bg-canvas": tone === "canvas",
        "bg-navy-800": tone === "navy",
      })}
    >
      <div className="mx-auto max-w-6xl">{children}</div>
    </section>
  );
}

function Heading({
  id,
  lead,
  tone = "dark",
}: {
  id: string;
  lead?: string;
  tone?: "dark" | "light";
}) {
  const section = SECTIONS.find((s) => s.id === id)!;
  return (
    <div className="reveal max-w-3xl">
      {section.eyebrow ? (
        <p
          className={clsx(
            "font-heading text-[13px] font-semibold uppercase tracking-[0.14em]",
            tone === "dark" ? "text-coral-500" : "text-coral-200",
          )}
        >
          {section.eyebrow}
        </p>
      ) : null}
      <h2
        className={clsx(
          "mt-2 font-heading text-[28px] font-semibold sm:text-[34px]",
          tone === "dark" ? "text-navy-800" : "text-white",
        )}
      >
        {section.heading}
      </h2>
      {lead ? (
        <p
          className={clsx(
            "mt-4 text-[17px] leading-[1.85]",
            tone === "dark" ? "text-ink-muted" : "text-white/75",
          )}
        >
          {lead}
        </p>
      ) : null}
    </div>
  );
}

/** แถบสรุปท้ายหัวข้อ — สไลด์เรียกว่า "ข้อความแถบด้านล่าง" */
function Banner({ children }: { children: React.ReactNode }) {
  return (
    <p className="reveal mt-10 flex items-start gap-3 rounded-2xl border border-coral-200 bg-coral-50 px-6 py-5 text-[16px] leading-[1.85] text-navy-800">
      <span
        aria-hidden="true"
        className="mt-2.5 h-1.5 w-6 shrink-0 rounded-full bg-coral-500"
      />
      {children}
    </p>
  );
}

// ─────────────────────────────────────────────────────────────────── icons

const iconProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

const BENEFIT_ICONS = [
  // เชื่อมโยงเป็นระบบ — จุดสามจุดเชื่อมกัน
  <svg key="a" {...iconProps}>
    <circle cx="6" cy="6" r="2.5" />
    <circle cx="18" cy="12" r="2.5" />
    <circle cx="6" cy="18" r="2.5" />
    <path d="M8.2 7.3 15.8 11M8.2 16.7 15.8 13" />
  </svg>,
  // ตัดสินใจด้วยข้อมูล — กราฟแท่ง
  <svg key="b" {...iconProps}>
    <path d="M4 20h16" />
    <path d="M7 20v-6M12 20V6M17 20v-9" />
  </svg>,
  // ลดความซ้ำซ้อน — วนกลับมาใช้ซ้ำ
  <svg key="c" {...iconProps}>
    <path d="M4 12a8 8 0 0 1 13.7-5.7L20 8" />
    <path d="M20 4v4h-4" />
    <path d="M20 12a8 8 0 0 1-13.7 5.7L4 16" />
    <path d="M4 20v-4h4" />
  </svg>,
  // ปลอดภัยและธรรมาภิบาล — โล่
  <svg key="d" {...iconProps}>
    <path d="M12 3l7 3v6c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9V6z" />
    <path d="m9 12 2 2 4-4" />
  </svg>,
];

// ───────────────────────────────────────────────────────────────── หัวข้อ

function Hero() {
  return (
    <header className="relative overflow-hidden bg-navy-800">
      {/* แสงเรืองสองจุดกับตารางจุด ทำให้พื้นหลังเข้มไม่ตายด้าน */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-32 -top-40 h-[36rem] w-[36rem] rounded-full bg-coral-500/25 blur-glow"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-56 -left-24 h-[32rem] w-[32rem] rounded-full bg-navy-400/35 blur-glow"
      />
      <div aria-hidden="true" className="bg-dot-grid absolute inset-0 opacity-60" />

      <div className="relative mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:py-28">
        <span className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-4 py-1.5 font-heading text-[13px] font-medium text-white/90 frost-4">
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-coral-400" />
          {HERO.eyebrow}
        </span>

        <h1 className="mt-6 max-w-4xl font-heading text-[34px] font-semibold leading-[1.25] text-white sm:text-[46px] lg:text-[54px]">
          {HERO.title}
        </h1>
        <p className="mt-6 max-w-2xl text-[17px] leading-[1.9] text-white/80 sm:text-[19px]">
          {HERO.lead}
        </p>

        <div className="mt-9 flex flex-wrap gap-3">
          <Link
            href="/login"
            className="rounded-full bg-coral-500 px-7 py-3.5 text-[15px] font-medium text-white shadow-pop transition-colors hover:bg-coral-600"
          >
            เข้าสู่ระบบ
          </Link>
          <a
            href="#connect"
            className="rounded-full border border-white/30 bg-white/5 px-7 py-3.5 text-[15px] font-medium text-white frost-4 transition-colors hover:bg-white/15"
          >
            ขั้นตอนการขอเชื่อมต่อ
          </a>
        </div>

        <ul className="mt-14 flex flex-wrap gap-x-8 gap-y-3 border-t border-white/15 pt-7">
          {CAPABILITIES.map((cap) => (
            <li key={cap} className="flex items-center gap-2.5 text-[15px] text-white/80">
              <svg className="h-4 w-4 text-coral-400" {...iconProps}>
                <path d="m5 12.5 4.5 4.5L19 7.5" />
              </svg>
              {cap}
            </li>
          ))}
        </ul>
      </div>
    </header>
  );
}

function Background() {
  return (
    <Section id="background" tone="canvas">
      <Heading id="background" lead={BACKGROUND_LEAD} />
      {/*
        bento สลับความกว้าง 2-1 / 1-2 ให้เต็มตารางพอดี — ถ้าให้ใบแรกใบเดียวกว้าง
        แถวล่างจะเหลือช่องว่างหนึ่งช่องค้างไว้
      */}
      <div className="mt-12 grid gap-4 lg:grid-cols-3">
        {BACKGROUND_POINTS.map((point, i) => (
          <article
            key={point.title}
            className={clsx(
              "reveal group relative overflow-hidden rounded-2xl bg-white p-7 shadow-card transition-shadow hover:shadow-pop",
              (i === 0 || i === 3) && "lg:col-span-2",
            )}
          >
            {/* เลขจาง ๆ มุมขวาบน — ไม่ล้นขอบ เพราะโดน overflow-hidden ตัดกลางตัวเลขแล้วดูเหมือนพลาด */}
            <span
              aria-hidden="true"
              className="pointer-events-none absolute right-5 top-3 font-heading text-[64px] font-semibold leading-none text-navy-50 transition-colors group-hover:text-coral-50"
            >
              {String(i + 1).padStart(2, "0")}
            </span>
            <h3 className="relative max-w-[22ch] font-heading text-[19px] font-semibold text-navy-800">
              {point.title}
            </h3>
            <p className="relative mt-3 max-w-2xl text-[15px] leading-[1.85] text-ink-muted">
              {point.body}
            </p>
          </article>
        ))}
      </div>
      <Banner>{BACKGROUND_BANNER}</Banner>
    </Section>
  );
}

function Objectives() {
  return (
    <Section id="objectives">
      <Heading id="objectives" lead={OBJECTIVES_LEAD} />
      {/* รายการมีเส้นคั่น ไม่ใช่การ์ด — ห้าข้อที่เป็นการ์ดจะเหลือใบโดดใบเดียวในแถวสุดท้าย */}
      <ol className="mt-12 grid gap-x-12 sm:grid-cols-2">
        {OBJECTIVES.map((objective, i) => (
          <li
            key={objective.title}
            className="reveal flex gap-5 border-t border-line py-6 first:border-t-0 sm:[&:nth-child(2)]:border-t-0"
          >
            <span className="font-heading text-[15px] font-semibold text-coral-500">
              {String(i + 1).padStart(2, "0")}
            </span>
            <div>
              <h3 className="font-heading text-[18px] font-semibold text-navy-800">
                {objective.title}
              </h3>
              <p className="mt-2 text-[15px] leading-[1.85] text-ink-muted">{objective.body}</p>
            </div>
          </li>
        ))}
      </ol>
      <Banner>{OBJECTIVES_BANNER}</Banner>
    </Section>
  );
}

function BdiRole() {
  return (
    <Section id="bdi-role" tone="navy">
      {/* แผงสีเข้มคั่นจังหวะ — ไม่งั้นสิบหัวข้อจะเป็นพื้นขาว-เทาสลับกันไปจนจบ */}
      <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-start">
        <Heading id="bdi-role" lead={BDI_ROLE_LEAD} tone="light" />
        <ul className="space-y-3">
          {BDI_ROLES.map((role) => (
            <li
              key={role}
              className="reveal flex gap-4 rounded-2xl border border-white/15 bg-white/5 p-5 frost-4"
            >
              <svg className="mt-1 h-5 w-5 shrink-0 text-coral-400" {...iconProps}>
                <path d="m5 12.5 4.5 4.5L19 7.5" />
              </svg>
              <span className="text-[16px] leading-[1.85] text-white/90">{role}</span>
            </li>
          ))}
        </ul>
      </div>
    </Section>
  );
}

function HowItWorks() {
  return (
    <Section id="how-it-works">
      <Heading id="how-it-works" />
      <ol className="relative mt-12 grid gap-6 sm:grid-cols-3">
        {/* เส้นเชื่อมสามขั้น บอกว่านี่คือลำดับ ไม่ใช่สามอย่างที่ไม่เกี่ยวกัน */}
        <span
          aria-hidden="true"
          className="absolute left-0 right-0 top-5 hidden h-px bg-line sm:block"
        />
        {HOW_IT_WORKS.map((step, i) => (
          <li key={step.title} className="reveal relative">
            <span className="relative z-10 flex h-10 w-10 items-center justify-center rounded-full bg-navy-800 font-heading text-[15px] font-semibold text-white ring-8 ring-white">
              {i + 1}
            </span>
            <h3 className="mt-5 font-heading text-[18px] font-semibold text-navy-800">
              {step.title}
            </h3>
            <p className="mt-2 text-[15px] leading-[1.85] text-ink-muted">{step.body}</p>
          </li>
        ))}
      </ol>

      <figure className="reveal mt-14 overflow-hidden rounded-3xl bg-canvas p-4 shadow-card sm:p-8">
        {/*
          import แทนการอ้าง path ใน public/ — Next จะใส่ content hash ใน URL ให้เอง
          และอ่านความกว้าง/สูงจากไฟล์จริง

          ทั้งสองอย่างมีเหตุผลจากของจริง: ตอนเปลี่ยนรูปครั้งก่อน ชื่อไฟล์เท่าเดิม
          Next เลยเสิร์ฟตัวที่ optimize ไว้ของรูปเก่าต่อในบางความกว้าง (แคชอยู่ใน
          named volume ที่ไม่หายตอน restart) และ width/height ที่ใส่มือไว้ก็ยังเป็น
          สัดส่วนเก่า ทำให้จองพื้นที่ผิด · ทั้งคู่จะเกิดกับผู้ใช้จริงหลัง CDN ด้วย ไม่ใช่แค่ในเครื่อง

          ต้นฉบับ assets/info_page/home-page-diagram-image.png (3168×1344 / 5.4 MB)
          ย่อเหลือ 1600px แล้วแปลงเป็น WebP เหลือ 65 KB
        */}
        <Image
          src={diagram}
          alt="แผนภาพการทำงานของ D2 — ข้อมูลจากหลายหน่วยงาน (A ถึง E และอื่น ๆ) ไหลเข้าสู่แพลตฟอร์มกลางด้านข้อมูลขนาดใหญ่ที่เชื่อมโยง บูรณาการ ปลอดภัย และควบคุมคุณภาพข้อมูล แล้วนำออกไปใช้เป็นแดชบอร์ดและรายงาน การวางแผนและคาดการณ์ การวิเคราะห์เชิงลึก การกำหนดนโยบาย และการบริหารราชการ"
          className="mx-auto h-auto w-full max-w-3xl rounded-xl"
          sizes="(max-width: 768px) 100vw, 768px"
        />
      </figure>
    </Section>
  );
}

function Benefits() {
  return (
    <Section id="benefits" tone="canvas">
      <Heading id="benefits" />
      <div className="mt-12 grid gap-4 sm:grid-cols-2">
        {BENEFITS.map((benefit, i) => (
          <article
            key={benefit.title}
            className="reveal rounded-2xl bg-white p-7 shadow-card transition-shadow hover:shadow-pop"
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-navy-50 text-navy-700">
              <span className="h-5 w-5">{BENEFIT_ICONS[i]}</span>
            </span>
            <h3 className="mt-5 font-heading text-[18px] font-semibold text-navy-800">
              {benefit.title}
            </h3>
            <p className="mt-2.5 text-[15px] leading-[1.85] text-ink-muted">{benefit.body}</p>
          </article>
        ))}
      </div>
    </Section>
  );
}

function Connect() {
  return (
    <Section id="connect">
      <Heading id="connect" />
      <ol className="mt-12 grid gap-4 sm:grid-cols-3">
        {CONNECT_STEPS.map((step, i) => (
          <li
            key={step.title}
            className="reveal relative rounded-2xl border border-line bg-white p-7 transition-colors hover:border-navy-200"
          >
            <span className="font-heading text-[13px] font-semibold uppercase tracking-[0.14em] text-coral-500">
              ขั้นที่ {i + 1}
            </span>
            <h3 className="mt-2.5 font-heading text-[18px] font-semibold text-navy-800">
              {step.title}
            </h3>
            <p className="mt-2 text-[15px] leading-[1.85] text-ink-muted">{step.body}</p>
          </li>
        ))}
      </ol>
      <p className="reveal mt-6 flex items-start gap-3 rounded-2xl bg-canvas px-6 py-5 text-[15px] leading-[1.85] text-ink-muted">
        <svg className="mt-1 h-5 w-5 shrink-0 text-ink-subtle" {...iconProps}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v5M12 8h.01" />
        </svg>
        {CONNECT_NOTE}
      </p>
    </Section>
  );
}

/** ป้ายรหัสเอกสาร — ตัวหลักทึบ ตัวภาคผนวกจางลงหนึ่งระดับเพื่อบอกลำดับชั้นซ้ำอีกทาง */
function DocCode({ code, muted = false }: { code: string; muted?: boolean }) {
  return (
    <span
      className={clsx(
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg font-heading text-[13px] font-semibold",
        muted ? "bg-navy-50 text-navy-700" : "bg-navy-800 text-white",
      )}
    >
      {code}
    </span>
  );
}

function Legal() {
  return (
    <Section id="legal" tone="canvas">
      <Heading id="legal" />

      <h3 className="reveal mt-12 font-heading text-[17px] font-semibold text-navy-800">
        กฎหมายที่เกี่ยวข้อง
      </h3>
      <p className="reveal mt-3 rounded-2xl bg-white px-6 py-5 text-[16px] leading-[1.85] text-ink shadow-card">
        {LEGAL_REGULATION}
      </p>

      <h3 className="reveal mt-10 font-heading text-[17px] font-semibold text-navy-800">
        เอกสารที่เกี่ยวข้อง
      </h3>

      {/* ข้อตกลงหลัก */}
      {/* ข้อความตัดบรรทัดเฉพาะจอแคบ ป้ายรหัสจึงชิดบนที่นั่น ส่วนจอกว้างเป็นบรรทัดเดียว จัดกึ่งกลางถูกกว่า */}
      <div className="reveal mt-3 flex items-start gap-4 rounded-2xl bg-white px-6 py-4 shadow-card sm:items-center">
        <DocCode code={LEGAL_PRIMARY.code} />
        <span className="text-[16px] leading-[1.7] text-ink">{LEGAL_PRIMARY.title}</span>
      </div>

      {/*
        ภาคผนวกอยู่ในกล่องเดียวที่มีหัวข้อกำกับและเส้นนำทางด้านซ้าย
        ก่อนหน้านี้เยื้องทีละใบด้วย ml เฉย ๆ ซึ่งทำให้การ์ดสั้นลงโดยขอบขวายังชนที่เดิม
        และไม่มีอะไรบอกว่าเยื้องเพราะอะไร — อ่านเหมือนเรนเดอร์พลาดมากกว่าลำดับชั้น
      */}
      <div className="reveal mt-4 rounded-2xl bg-white p-5 shadow-card sm:p-6">
        <p className="font-heading text-[14px] font-semibold text-ink-muted">
          {LEGAL_ANNEX_LABEL}
          <span className="ml-2 font-sans font-normal text-ink-subtle">แนบท้าย A0</span>
        </p>
        <ul className="mt-3 border-l-2 border-navy-100 pl-5 sm:pl-6">
          {LEGAL_ANNEXES.map((doc) => (
            <li
              key={doc.code}
              className="flex items-start gap-4 border-t border-line py-3.5 first:border-t-0 first:pt-0 last:pb-0 sm:items-center"
            >
              <DocCode code={doc.code} muted />
              <span className="text-[15px] leading-[1.7] text-ink">{doc.title}</span>
            </li>
          ))}
        </ul>
      </div>

      <p className="reveal mt-5 text-[14px] text-ink-subtle">
        ลิงก์ดาวน์โหลดเอกสารแต่ละฉบับอยู่ระหว่างจัดเตรียม
      </p>
    </Section>
  );
}

/**
 * FAQ · ข่าวสาร · ติดต่อเรา
 *
 * ทั้งสามหัวข้อมีในเมนูของสไลด์แต่ไม่มีเนื้อหาให้ รวมไว้เป็นแถบเดียวสามช่อง
 * แทนที่จะเป็นสามหัวข้อเต็มหน้าที่ว่างเปล่า — ยาวเปล่า ๆ ทำให้ทั้งหน้าดูยังไม่เสร็จ
 * แต่ละช่องยังมี id ของตัวเองเพื่อให้ลิงก์บนแถบนำทางกดแล้วมาถูกที่
 */
function MoreInfo() {
  const pending = SECTIONS.filter((s) => s.pending);
  return (
    <section className="scroll-mt-20 bg-white px-4 py-16 sm:px-6 lg:py-24">
      <div className="mx-auto max-w-6xl">
        <div className="reveal max-w-3xl">
          <p className="font-heading text-[13px] font-semibold uppercase tracking-[0.14em] text-coral-500">
            ข้อมูลเพิ่มเติม
          </p>
          <h2 className="mt-2 font-heading text-[28px] font-semibold text-navy-800 sm:text-[34px]">
            กำลังจัดเตรียม
          </h2>
        </div>
        <div className="mt-10 grid gap-4 sm:grid-cols-3">
          {pending.map((section) => (
            <div
              key={section.id}
              id={section.id}
              className="reveal scroll-mt-20 rounded-2xl border border-dashed border-line bg-canvas p-7"
            >
              <h3 className="font-heading text-[17px] font-semibold text-navy-800">
                {section.heading}
              </h3>
              <p className="mt-2 text-[14px] leading-[1.85] text-ink-muted">
                อยู่ระหว่างจัดเตรียมเนื้อหา
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function SiteFooter() {
  return (
    <footer className="bg-navy-900 px-4 py-14 sm:px-6">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col gap-8 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-md">
            <div className="flex items-center gap-3">
              <LogoImage tone="white" className="h-12" />
              <span className="font-heading text-[17px] font-semibold text-white">D2</span>
            </div>
            <p className="mt-4 text-[14px] leading-[1.85] text-white/60">
              Data Integration and Intelligence Platform — ระบบกลางเพื่อการแบ่งปันข้อมูลดิจิทัลของประเทศ
              ดูแลโดยสถาบันข้อมูลขนาดใหญ่ (องค์การมหาชน)
            </p>
          </div>

          <nav aria-label="ลิงก์ท้ายหน้า" className="grid grid-cols-2 gap-x-10 gap-y-2">
            {SECTIONS.slice(0, 8).map((section) => (
              <a
                key={section.id}
                href={`#${section.id}`}
                className="text-[14px] text-white/70 transition-colors hover:text-white"
              >
                {section.navLabel}
              </a>
            ))}
          </nav>
        </div>

        <div className="mt-10 flex flex-col gap-3 border-t border-white/10 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[13px] text-white/50">
            สถาบันข้อมูลขนาดใหญ่ (องค์การมหาชน) — Big Data Institute (Public Organization)
          </p>
          <Link
            href="/login"
            className="text-[14px] font-medium text-white transition-colors hover:text-coral-300"
          >
            เข้าสู่ระบบ →
          </Link>
        </div>
      </div>
    </footer>
  );
}
