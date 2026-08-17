"use client";

/*
 * หน้าแรกก่อนเข้าสู่ระบบ
 *
 * Hallmark · genre: editorial · macrostructure: Split Studio
 * theme: BDI CI (พาเลตต์ของโปรเจกต์ ไม่ได้เลือกใหม่) · paper: mid-light tinted (#f6f7fb)
 * display: geometric-sans (Prompt) · accent hue: warm (coral ~35°)
 * nav: N6 Newspaper masthead (issue-line above wordmark · rule double · section row sticky)
 * footer: Ft4 Dense colophon (family sans · paragraph · attribution)
 * hero: H2 Split diptych (7/5 · proof column · vertical rule)
 * heads: S3 Sticky pinned (dock ใต้แถบนำทางด้วย --nav-height)
 * features: F4 Step sequence (01/02/03 · horizontal · rule connector) · F3 Spec sheet (2 คอลัมน์)
 * proof: T1 Pull quote + marginalia · cta: C1 Outlined chip + C3 Typographic link
 * enrichment: none — typography only (แผนภาพที่ใช้เป็นไฟล์จริงจากฝ่ายสื่อสาร ไม่ได้สร้างขึ้น)
 * pre-emit critique: P5 H5 E5 S5 R5 V4
 * slop test: 56 ผ่าน · 1 n/a (26) · 1 เบี่ยงโดยเจตนา (35) · ไม่มีข้อที่ตก
 * contrast: pass (40–41) · slop: pass (42–45) · honest: pass (46)
 * chrome: pass (47) · tokens: pass (48) · responsive: pass (49) · icons: pass (30)
 * mobile: pass (34, 49, 50–57 — วัดจริงที่ 320/375/414/768/1280) · gate 26: n/a ไม่มี control
 * ที่ปิดใช้งานได้ในหน้านี้ (มีแต่ลิงก์) · gate 35: ขีดใต้ offset 4px ไม่ใช่ 1–2px เพราะสระล่างไทย
 *
 * ข้อยกเว้นที่ตั้งใจ: ไม่ได้แยกไฟล์ tokens.css ตามที่ skill กำหนด — โปรเจกต์นี้เก็บ token
 * ไว้ใน @theme ของ app/globals.css ตาม CLAUDE.md ไฟล์ที่ไม่มีใคร import จะเป็นโค้ดตายทันที
 *
 * เนื้อหามาจาก assets/info_page/25690806_D2 info page.pptx ครบทุกหัวข้อเท่าเดิม
 * ทั้งลำดับหัวข้อ ถ้อยคำ และ id ของแต่ละหัวข้อ — งานรอบนี้เปลี่ยนเฉพาะรูปเล่ม
 *
 * โครงเดิมเป็นแถบเต็มความกว้างเรียงลงมา แล้วในแต่ละแถบเป็นตะแกรงการ์ดมีเงา
 * ซึ่งอ่านเหมือนหน้าเว็บ SaaS มากกว่าเอกสารของหน่วยงานรัฐ และมีร่องรอยที่รู้จักกันดี
 * ของหน้าที่ AI สร้าง: แสงเรืองเบลอสองจุดหลัง hero · แถบเบลอแบบกระจก · คำกำกับเล็ก
 * ตัวใหญ่สีคอรัลเหนือทุกหัวข้อ · การ์ดไอคอนสี่ใบเรียงเท่ากัน · ทุกบล็อกค่อย ๆ จางขึ้น
 * ตอนเลื่อนถึง
 *
 * รอบนี้เป็น diptych: หัวข้อกับคำนำอยู่ครึ่งหนึ่ง เนื้อหาอยู่ครึ่งตรงข้าม และสลับข้างลงไป
 * เส้นคั่นบางแทนกรอบการ์ด แถบสีกรมท่าหนึ่งแถบคั่นจังหวะกลางหน้า และไม่มีอะไรขยับ
 * ตอนเลื่อน — เข้าครั้งเดียวที่ hero เท่านั้น
 *
 * ปุ่มหลักเปลี่ยนจากคอรัลเป็นกรมท่า: ตัวหนังสือขาวบนคอรัล #E5775A ได้คอนทราสต์ ~2.8:1
 * ต่ำกว่า WCAG AA (4.5:1) ซึ่งงานภาครัฐรับไม่ได้ คอรัลจึงเหลือหน้าที่เป็นสีเน้น —
 * ขีดใต้หัวข้อที่กำลังอ่าน เส้นนำข้อความสรุป และเลขลำดับขั้น
 */

import clsx from "clsx";
import Image from "next/image";
import Link from "next/link";
import { Fragment, useEffect, useRef, useState } from "react";

import { LogoLockup } from "@/components/brand/Logo";

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

  return (
    <div className="bg-canvas">
      <Masthead active={active} />
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
      <Colophon />
    </div>
  );
}

// ─────────────────────────────────────────────────────────── ค่าที่ใช้ซ้ำ

/** ความกว้างเนื้อหาและระยะขอบ — เขียนที่เดียวเพราะทุกแถบต้องตรงกันเป๊ะ ไม่งั้นเส้นคั่นเยื้องกัน */
const SHELL = "mx-auto w-full max-w-[76rem] px-5 sm:px-8";

/** กันหัวข้อถูกแถบนำทางบังตอนกดลิงก์ */
const ANCHOR = "scroll-mt-[calc(var(--nav-height)+1.5rem)]";

/*
 * ปุ่มและลิงก์ระบุ property ที่ transition เองทุกตัว ไม่ใช้ transition-colors
 * เพราะ Tailwind 4 รวม outline-color ไว้ในนั้น แล้ววงโฟกัสจะค่อย ๆ ปรากฏ —
 * คนที่ใช้คีย์บอร์ดต้องเห็นวงโฟกัสทันทีที่โฟกัสถึง ไม่ใช่หลังจากนั้น 150ms
 */

/** ปุ่มหลัก — สี่เหลี่ยมมุมมนน้อย พื้นกรมท่า ไม่ใช่แคปซูลคอรัล */
const ACTION_PRIMARY =
  "inline-flex min-h-11 items-center rounded-sm bg-navy-800 px-6 text-body font-medium whitespace-nowrap text-navy-50 transition-[background-color] duration-150 hover:bg-navy-900 active:translate-y-px";

/** ปุ่มรอง (C1) — เส้นขอบบาง พื้นโปร่ง */
const ACTION_CHIP =
  "inline-flex min-h-11 items-center gap-2 rounded-sm border border-navy-800 px-6 text-body font-medium whitespace-nowrap text-navy-800 transition-[background-color] duration-150 hover:bg-navy-50 active:translate-y-px";

/** ลิงก์แบบตัวหนังสือ (C3) — ขีดใต้คอรัล หนาขึ้นเมื่อชี้ (offset 4px เผื่อสระล่างของไทย) */
const ACTION_LINK =
  "inline-flex items-center gap-1.5 text-meta font-medium whitespace-nowrap underline decoration-coral-500 decoration-1 underline-offset-4 transition-[text-decoration-thickness] duration-150 hover:decoration-2";

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

// ───────────────────────────────────────────────────────────────────── nav

/**
 * แถบหัวหนังสือ (N6)
 *
 * สามชั้น: บรรทัดสังกัด · โลโก้เต็มกลางหน้า · เส้นคู่แล้วต่อด้วยแถบหัวข้อ
 * เฉพาะแถบหัวข้อที่ติดขอบบนเมื่อเลื่อน ส่วนหัวหนังสือเลื่อนหายไปตามเนื้อหา —
 * หน้ายาวสิบหัวข้อยังต้องมีที่กดข้าม แต่ไม่จำเป็นต้องแบกโลโก้ค้างไว้ทั้งหน้า
 *
 * แถบหัวข้อจึงต้องอยู่ *นอก* <header> — position: sticky ติดได้แค่ในกรอบของ element แม่
 * ตอนแรกวางไว้ในนั้นแล้วแถบหลุดหายไปพร้อมหัวหนังสือทันทีที่เลื่อนพ้น (เห็นได้จาก
 * สกรีนช็อตกลางหน้า: ไม่มีแถบนำทางที่ขอบบนเลย) ตอนนี้แม่ของมันคือกล่องที่ครอบทั้งหน้า
 *
 * ของเดิมเป็นแถบขาวโปร่งเบลอ (frost) ซึ่งเป็นภาษาของแอป ไม่ใช่ของสิ่งพิมพ์ราชการ
 * และเป็นหนึ่งใน tell ที่อ่านออกได้ทันที
 */
function Masthead({ active }: { active: string }) {
  const listRef = useRef<HTMLUListElement>(null);

  // แถบเลื่อนแนวนอนต้องเลื่อนตามหัวข้อที่ active ไม่งั้นผู้ใช้ไม่เห็นว่าอยู่ตรงไหน
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-nav="${active}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [active]);

  return (
    <>
      <header className="bg-canvas">
        <div className={clsx(SHELL, "flex items-center justify-between gap-6 py-1")}>
          {/* จอแคบไม่ต้องมีบรรทัดนี้ — โลโก้ใต้ลงมาก็เขียนชื่อสถาบันอยู่แล้ว */}
          <p className="hidden text-meta text-ink-muted sm:block">
            สถาบันข้อมูลขนาดใหญ่ (องค์การมหาชน)
          </p>
          <Link
            href="/login"
            className={clsx(ACTION_LINK, "ml-auto min-h-11 text-navy-800 sm:min-h-8")}
          >
            เข้าสู่ระบบ
            <span aria-hidden="true">→</span>
          </Link>
        </div>

        <div className="border-t border-navy-100">
          <div className={clsx(SHELL, "py-7 text-center sm:py-9")}>
            <Link href="/" aria-label="D2 — หน้าแรก" className="inline-block">
              <LogoLockup className="h-7 w-auto text-navy-800 sm:h-9" />
            </Link>
            <p className="mt-4 text-meta tracking-[0.14em] text-ink-muted">
              DATA INTEGRATION AND INTELLIGENCE PLATFORM · D2
            </p>
          </div>
        </div>

        {/* เส้นคู่ปิดหัวหนังสือ */}
        <div aria-hidden="true" className="border-t border-navy-200" />
        <div aria-hidden="true" className="mt-[3px] border-t border-navy-200" />
      </header>

      <div className="sticky top-0 z-30 border-b border-navy-100 bg-canvas">
        <nav aria-label="หัวข้อในหน้านี้" className={SHELL}>
          <ul
            ref={listRef}
            className="-mx-3 flex overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {SECTIONS.map((section, i) => {
              const current = active === section.id;
              // สไลด์จัดสิบหัวข้อเป็นสามกลุ่ม (เกี่ยวกับ D2 · กลไกของแพลตฟอร์ม · เริ่มใช้งาน)
              // เดิมกลุ่มเหล่านี้ถูกพิมพ์ซ้ำเป็นคำกำกับเหนือทุกหัวข้อ ซึ่งอ่านเป็นการตกแต่ง
              // ย้ายมาเป็นป้ายกลุ่มในสารบัญ ซึ่งเป็นที่ที่มันทำหน้าที่จริง — บอกว่าหัวข้อถัดไปเป็นชุดใหม่
              const group = section.eyebrow;
              const opensGroup = Boolean(group) && group !== SECTIONS[i - 1]?.eyebrow;
              return (
                <Fragment key={section.id}>
                  {opensGroup ? (
                    <li className="shrink-0 self-center whitespace-nowrap border-l border-navy-100 py-1 pl-3 text-meta text-ink-muted first:border-l-0">
                      {group}
                    </li>
                  ) : null}
                  <li className="shrink-0">
                    <a
                      href={`#${section.id}`}
                      data-nav={section.id}
                      aria-current={current ? "true" : undefined}
                      className={clsx(
                        "relative block whitespace-nowrap px-3 py-3 text-meta transition-[color] duration-150",
                        current ? "font-medium text-navy-800" : "text-ink-muted hover:text-navy-800",
                      )}
                    >
                      {section.navLabel}
                      <span
                        aria-hidden="true"
                        className={clsx(
                          "absolute inset-x-3 bottom-0 h-[2px]",
                          current ? "bg-coral-500" : "bg-transparent",
                        )}
                      />
                    </a>
                  </li>
                </Fragment>
              );
            })}
          </ul>
        </nav>
      </div>
    </>
  );
}

// ──────────────────────────────────────────────────────────── ส่วนประกอบ

function Band({
  id,
  tone = "paper",
  padding = "py-16 lg:py-24",
  children,
}: {
  id: string;
  tone?: "paper" | "paper-2" | "navy";
  padding?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      className={clsx(ANCHOR, "border-b", {
        "border-navy-100 bg-canvas": tone === "paper",
        "border-navy-100 bg-navy-50": tone === "paper-2",
        "border-navy-900 bg-navy-800": tone === "navy",
      })}
    >
      <div className={clsx(SHELL, padding)}>{children}</div>
    </section>
  );
}

/**
 * ครึ่งหัวข้อ + ครึ่งเนื้อหา สลับข้างลงไปตามหน้า
 *
 * ครึ่งหัวข้อ sticky บนจอกว้าง (dock ใต้แถบนำทาง) — หัวข้อที่ยาวหลายรายการจะอ่านง่ายขึ้น
 * เมื่อคำนำยังอยู่ในสายตา บนจอแคบยุบเป็นคอลัมน์เดียวและไม่ sticky
 * ลำดับใน DOM คือหัวข้อก่อนเนื้อหาเสมอ การสลับข้างทำด้วย col-start ไม่ใช่การสลับ DOM
 */
function Diptych({
  head,
  flip = false,
  children,
}: {
  head: React.ReactNode;
  flip?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={clsx(
        "grid gap-x-14 gap-y-9",
        flip
          ? "lg:grid-cols-[minmax(0,1fr)_minmax(0,21rem)]"
          : "lg:grid-cols-[minmax(0,21rem)_minmax(0,1fr)]",
      )}
    >
      <div
        className={clsx(
          "lg:row-start-1 lg:sticky lg:top-[calc(var(--nav-height)+2.5rem)] lg:self-start",
          flip ? "lg:col-start-2" : "lg:col-start-1",
        )}
      >
        {head}
      </div>
      <div className={clsx("lg:row-start-1", flip ? "lg:col-start-1" : "lg:col-start-2")}>
        {children}
      </div>
    </div>
  );
}

function Head({
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
    <>
      <h2
        className={clsx(
          "font-display text-title font-semibold [overflow-wrap:anywhere]",
          tone === "dark" ? "text-navy-800" : "text-navy-50",
        )}
      >
        {section.heading}
      </h2>
      {lead ? (
        <p
          className={clsx(
            "mt-4 max-w-[46ch] text-body",
            tone === "dark" ? "text-ink-muted" : "text-navy-200",
          )}
        >
          {lead}
        </p>
      ) : null}
    </>
  );
}

/**
 * ข้อความสรุปท้ายหัวข้อ — สไลด์เรียกว่า "ข้อความแถบด้านล่าง"
 * เส้นคอรัลนำหน้าแทนกล่องสีอ่อน กล่องสีทำให้ประโยคนี้ดูเป็นการ์ดอีกใบ ไม่ใช่บทสรุป
 */
function Statement({ children, tone = "dark" }: { children: React.ReactNode; tone?: "dark" | "light" }) {
  return (
    <p
      className={clsx(
        "mt-12 max-w-[58ch] border-t-2 pt-5 text-lead",
        tone === "dark" ? "border-coral-500 text-navy-800" : "border-coral-400 text-navy-50",
      )}
    >
      {children}
    </p>
  );
}

// ───────────────────────────────────────────────────────────────── หัวข้อ

function Hero() {
  return (
    <header className="border-b border-navy-100 bg-canvas">
      <div
        className={clsx(
          SHELL,
          // ล่างหนักกว่าบน (~1.5 เท่า) — บน-ล่างเท่ากันทำให้ hero ลอยแยกจากหัวข้อถัดไป
          "grid gap-x-14 gap-y-12 pt-12 pb-16 sm:pt-16 sm:pb-24 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:pt-20 lg:pb-32",
        )}
      >
        <div>
          <h1
            style={{ "--i": 0 } as React.CSSProperties}
            className="enter max-w-[24ch] font-display text-display font-semibold tracking-[-0.015em] text-navy-800 [overflow-wrap:anywhere] [text-wrap:balance]"
          >
            {HERO.title}
          </h1>
          <p
            style={{ "--i": 1 } as React.CSSProperties}
            className="enter mt-7 max-w-[54ch] text-lead text-ink-muted"
          >
            {HERO.lead}
          </p>
          <div
            style={{ "--i": 2 } as React.CSSProperties}
            className="enter mt-10 flex flex-wrap items-center gap-3"
          >
            <Link href="/login" className={ACTION_PRIMARY}>
              เข้าสู่ระบบ
            </Link>
            <a href="#connect" className={ACTION_CHIP}>
              ขั้นตอนการขอเชื่อมต่อ
              <span aria-hidden="true">→</span>
            </a>
          </div>
        </div>

        {/* ครึ่งขวาเป็นคอลัมน์ยืนยัน — สี่คำที่ยกมาจากแถบล่างของแผนภาพในสไลด์ */}
        <div
          style={{ "--i": 3 } as React.CSSProperties}
          className="enter lg:self-end lg:border-l lg:border-navy-100 lg:pl-14"
        >
          <p className="text-meta text-ink-muted">{HERO.eyebrow}</p>
          <ul className="mt-5">
            {CAPABILITIES.map((cap) => (
              <li
                key={cap}
                className="border-t border-navy-100 py-3 font-display text-lead font-medium text-navy-800"
              >
                {cap}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </header>
  );
}

function Background() {
  return (
    <Band id="background">
      <Diptych head={<Head id="background" lead={BACKGROUND_LEAD} />}>
        <dl>
          {BACKGROUND_POINTS.map((point) => (
            <div key={point.title} className="border-t border-navy-100 py-5 first:border-t-0 first:pt-0">
              <dt className="font-display text-lead font-semibold text-navy-800">{point.title}</dt>
              <dd className="mt-2 max-w-[62ch] text-body text-ink-muted">{point.body}</dd>
            </div>
          ))}
        </dl>
      </Diptych>
      <Statement>{BACKGROUND_BANNER}</Statement>
    </Band>
  );
}

function Objectives() {
  return (
    <Band id="objectives" tone="paper-2" padding="py-16 lg:py-20">
      {/* สลับหัวข้อไปอยู่ขวา — จังหวะของหน้าคือการสลับข้าง ไม่ใช่การเปลี่ยนสีพื้น */}
      <Diptych flip head={<Head id="objectives" lead={OBJECTIVES_LEAD} />}>
        <ul className="grid gap-x-12 sm:grid-cols-2">
          {OBJECTIVES.map((objective) => (
            <li key={objective.title} className="border-t border-navy-200 py-5">
              <p className="font-display text-body font-semibold text-navy-800">{objective.title}</p>
              <p className="mt-1.5 text-body text-ink-muted">{objective.body}</p>
            </li>
          ))}
        </ul>
      </Diptych>
      <Statement>{OBJECTIVES_BANNER}</Statement>
    </Band>
  );
}

function BdiRole() {
  return (
    <Band id="bdi-role" tone="navy" padding="py-18 lg:py-24">
      {/* แถบกรมท่าหนึ่งแถบคั่นกลางหน้า — ไม่ใช่การ์ดกระจกบนพื้นเข้มเหมือนเดิม
          ความลึกบนพื้นเข้มมาจากความสว่างของตัวหนังสือ ไม่ใช่จากเงาหรือฟรอสต์ */}
      <Diptych head={<Head id="bdi-role" lead={BDI_ROLE_LEAD} tone="light" />}>
        <ul>
          {BDI_ROLES.map((role) => (
            <li
              key={role}
              className="max-w-[58ch] border-t border-navy-500 py-5 text-lead text-navy-50 first:border-t-0 first:pt-0"
            >
              {role}
            </li>
          ))}
        </ul>
      </Diptych>
    </Band>
  );
}

function HowItWorks() {
  return (
    <Band id="how-it-works">
      <div className="max-w-[46rem]">
        <Head id="how-it-works" />
      </div>

      {/* สามขั้นเป็นลำดับจริง เลขจึงเป็นเนื้อหา ไม่ใช่เครื่องประดับ
          เส้นหนาบนหัวคอลัมน์บอกว่าเป็นชุดเดียวกัน แทนวงกลมมีขอบขาวของเดิม */}
      <ol className="mt-12 grid gap-x-10 gap-y-8 sm:grid-cols-3">
        {HOW_IT_WORKS.map((step, i) => (
          <li key={step.title} className="border-t-2 border-navy-800 pt-4">
            <p className="font-display text-meta font-semibold tabular-nums text-coral-700">
              {String(i + 1).padStart(2, "0")}
            </p>
            <h3 className="mt-2 font-display text-lead font-semibold text-navy-800">{step.title}</h3>
            <p className="mt-2 text-body text-ink-muted">{step.body}</p>
          </li>
        ))}
      </ol>

      <figure className="mt-14 border border-navy-100 bg-navy-50 p-4 sm:p-8">
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
          className="mx-auto h-auto w-full max-w-3xl"
          sizes="(max-width: 768px) 100vw, 768px"
        />
        <figcaption className="mt-5 max-w-[62ch] text-meta text-ink-muted">
          แผนภาพการทำงานของแพลตฟอร์ม D2 — จากชุดข้อมูลของหน่วยงาน ผ่านการเชื่อมโยงและบูรณาการ
          ไปสู่การใช้ประโยชน์เชิงวิเคราะห์
        </figcaption>
      </figure>
    </Band>
  );
}

function Benefits() {
  return (
    <Band id="benefits" tone="paper-2" padding="py-16 lg:py-20">
      {/* หัวข้อขึ้นต้นบรรทัดเดียวกับคำอธิบาย (run-in) — สี่ประโยชน์ที่เคยเป็นการ์ดไอคอน
          สี่ใบเท่ากันคือรูปแบบที่จำได้ทันทีว่ามาจากเทมเพลต ไอคอนไม่ได้เพิ่มความหมายให้ */}
      <Diptych flip head={<Head id="benefits" />}>
        <div className="grid gap-x-12 sm:grid-cols-2">
          {BENEFITS.map((benefit) => (
            <p
              key={benefit.title}
              className="border-t border-navy-200 py-5 text-body text-ink-muted"
            >
              <strong className="font-display font-semibold text-navy-800">{benefit.title}</strong>
              {" — "}
              {benefit.body}
            </p>
          ))}
        </div>
      </Diptych>
    </Band>
  );
}

function Connect() {
  return (
    <Band id="connect">
      <div className="max-w-[46rem]">
        <Head id="connect" />
      </div>

      {/* ตารางขั้นตอน (F3) — คอลัมน์ซ้ายคือลำดับ ขวาคือสิ่งที่ต้องทำ
          จอแคบยุบให้ลำดับขึ้นไปอยู่บรรทัดบน ไม่บีบสองคอลัมน์ให้แคบทั้งคู่ */}
      <ol className="mt-10">
        {CONNECT_STEPS.map((step, i) => (
          <li
            key={step.title}
            className="grid gap-x-8 gap-y-1.5 border-t border-navy-100 py-5 sm:grid-cols-[9rem_minmax(0,1fr)]"
          >
            <p className="font-display text-meta font-semibold tabular-nums text-coral-700">
              ขั้นที่ {i + 1}
            </p>
            <div>
              <h3 className="font-display text-lead font-semibold text-navy-800">{step.title}</h3>
              <p className="mt-2 max-w-[62ch] text-body text-ink-muted">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-6 max-w-[62ch] border-t border-navy-100 pt-5 text-meta text-ink-muted">
        {CONNECT_NOTE}
      </p>
    </Band>
  );
}

function Legal() {
  return (
    <Band id="legal" tone="paper-2">
      <div className="max-w-[46rem]">
        <Head id="legal" />
      </div>

      {/* ระเบียบยกขึ้นเป็นตัวอักษรใหญ่ (T1) ผู้ออกและปีอยู่ริมขวา — อ่านได้จากชื่อระเบียบเอง
          ของเดิมเป็นกล่องขาวมีเงาใบหนึ่ง ซึ่งทำให้กฎหมายดูเท่ากับรายการเอกสารข้างล่าง */}
      <h3 className="mt-12 font-display text-lead font-semibold text-navy-800">กฎหมายที่เกี่ยวข้อง</h3>
      <div className="mt-4 grid gap-x-10 gap-y-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,12rem)]">
        <blockquote className="border-t-2 border-navy-800 pt-5">
          <p className="max-w-[34ch] font-display text-title font-semibold text-navy-800 [overflow-wrap:anywhere]">
            {LEGAL_REGULATION}
          </p>
        </blockquote>
        <p className="text-meta text-ink-muted lg:pt-5">สำนักนายกรัฐมนตรี · พ.ศ. 2569</p>
      </div>

      <h3 className="mt-14 font-display text-lead font-semibold text-navy-800">เอกสารที่เกี่ยวข้อง</h3>
      <ul className="mt-4">
        <li className="flex gap-5 border-t border-navy-200 py-4">
          <span className="w-8 shrink-0 font-display text-meta font-semibold tabular-nums text-navy-800">
            {LEGAL_PRIMARY.code}
          </span>
          <span className="max-w-[62ch] text-body text-ink">{LEGAL_PRIMARY.title}</span>
        </li>

        {/*
          ภาคผนวกอยู่ในรายการซ้อนที่มีหัวข้อกำกับและเส้นนำทางด้านซ้าย
          ก่อนหน้านี้เยื้องทีละใบด้วย ml เฉย ๆ ซึ่งไม่มีอะไรบอกว่าเยื้องเพราะอะไร
        */}
        <li className="border-t border-navy-200 py-4">
          <p className="text-meta text-ink-muted">
            {LEGAL_ANNEX_LABEL} — แนบท้าย {LEGAL_PRIMARY.code}
          </p>
          <ul className="mt-3 border-l border-navy-200 pl-5 sm:pl-6">
            {LEGAL_ANNEXES.map((doc) => (
              <li
                key={doc.code}
                className="flex gap-5 border-t border-navy-200 py-3 first:border-t-0 first:pt-0"
              >
                <span className="w-8 shrink-0 font-display text-meta font-semibold tabular-nums text-ink-muted">
                  {doc.code}
                </span>
                <span className="max-w-[62ch] text-body text-ink">{doc.title}</span>
              </li>
            ))}
          </ul>
        </li>
      </ul>

      <p className="mt-6 text-meta text-ink-muted">ลิงก์ดาวน์โหลดเอกสารแต่ละฉบับอยู่ระหว่างจัดเตรียม</p>
    </Band>
  );
}

/**
 * FAQ · ข่าวสาร · ติดต่อเรา
 *
 * ทั้งสามหัวข้อมีในเมนูของสไลด์แต่ไม่มีเนื้อหาให้ จึงเป็นรายการสามบรรทัดที่บอกตรง ๆ
 * ว่ายังไม่มีเนื้อหา แทนที่จะเป็นการ์ดเส้นประสามใบที่กินพื้นที่เท่าหัวข้อจริง
 * แต่ละบรรทัดยังมี id ของตัวเองเพื่อให้ลิงก์บนแถบนำทางกดแล้วมาถูกที่
 */
function MoreInfo() {
  const pending = SECTIONS.filter((s) => s.pending);
  return (
    <section className="border-b border-navy-100 bg-canvas">
      <div className={clsx(SHELL, "py-12 lg:py-16")}>
        <div className="grid gap-x-14 gap-y-6 lg:grid-cols-[minmax(0,21rem)_minmax(0,1fr)]">
          <h2 className="font-display text-lead font-semibold text-navy-800">กำลังจัดเตรียม</h2>
          <ul>
            {pending.map((section) => (
              <li
                key={section.id}
                id={section.id}
                className={clsx(
                  ANCHOR,
                  "flex flex-wrap items-baseline justify-between gap-x-8 gap-y-1 border-t border-navy-100 py-4 first:border-t-0 first:pt-0",
                )}
              >
                <span className="text-body text-navy-800">{section.heading}</span>
                <span className="text-meta text-ink-muted">อยู่ระหว่างจัดเตรียมเนื้อหา</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

/** ท้ายหน้าแบบ colophon (Ft4) — ปิดหน้าด้วยข้อความบอกว่านี่คืออะไรของใคร ไม่ใช่สารบัญซ้ำ */
function Colophon() {
  return (
    <footer className="bg-navy-900">
      <div className={clsx(SHELL, "py-14")}>
        <div className="grid gap-x-14 gap-y-8 lg:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]">
          <Link href="/" aria-label="D2 — หน้าแรก" className="inline-block">
            <LogoLockup className="h-7 w-auto text-navy-50" dotClassName="fill-coral-300" />
          </Link>

          <div>
            <p className="max-w-[70ch] text-body text-navy-200">
              Data Integration and Intelligence Platform (D2) — ระบบกลางเพื่อการแบ่งปันข้อมูลดิจิทัลของประเทศ
              จัดให้มีและบริหารโดยสถาบันข้อมูลขนาดใหญ่ (องค์การมหาชน)
              ตามระเบียบสำนักนายกรัฐมนตรีว่าด้วยการแบ่งปันข้อมูลดิจิทัล พ.ศ. 2569
            </p>
            <div className="mt-8 flex flex-wrap items-baseline justify-between gap-x-8 gap-y-3 border-t border-navy-700 pt-5">
              <p className="text-meta text-navy-200">
                สถาบันข้อมูลขนาดใหญ่ (องค์การมหาชน) · Big Data Institute
              </p>
              <Link href="/login" className={clsx(ACTION_LINK, "text-navy-50 decoration-coral-300")}>
                เข้าสู่ระบบ
                <span aria-hidden="true">→</span>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
