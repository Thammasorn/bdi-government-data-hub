"use client";

/**
 * สถานะทั้งหมดของหน้ารายการหนึ่งหน้า — ตารางหน่วยงานกับตารางชุดข้อมูลใช้ตัวเดียวกัน
 *
 * เดิมสองตารางถือ state ของตัวเองด้วยโค้ดที่เหมือนกันเกือบบรรทัดต่อบรรทัด การเติม
 * pagination + การเรียง + แท็บ ลงไปทั้งสองที่จะได้สำเนาที่ยาวขึ้นสองเท่า ส่วนที่
 * *ต่างกันจริง* คือคอลัมน์และ JSX ของแถว ซึ่งยกออกมารวมกันไม่ได้อยู่แล้ว เพราะ
 * Tailwind สแกนคลาสแบบ static — คลาส grid ต้องเขียนเป็นสตริงเต็มในไฟล์ของตัวเอง
 */
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useToast } from "@/components/ui/Toast";
import { api } from "@/lib/api";
import type { ListSummary, PageInfo, SortOrder, StageToken } from "@/lib/stage";

export type QueueTab = "mine" | "all";

interface Options<T> {
  /** เช่น "/api/organizations" — ตัวสรุปคือ path เดียวกันต่อท้าย /summary */
  endpoint: string;
  /** คีย์ของ array ในคำตอบ: "organizations" หรือ "requests" */
  itemsKey: string;
  /** ผู้ใช้มีด่านเป็นของตัวเองไหม — ตัดสินจาก role ที่รู้อยู่แล้ว ไม่ใช่จากตัวเลขที่ต้องรอโหลด
   *  ถ้ารอ summary.mine > 0 แท็บจะกระพริบสลับหลังโหลดเสร็จ ซึ่งเห็นได้ชัดทุกครั้ง */
  hasQueue: boolean;
  initial?: T[];
}

export function useRequestList<T>({ endpoint, itemsKey, hasQueue }: Options<T>) {
  const router = useRouter();
  const params = useSearchParams();
  const { show } = useToast();

  const [rows, setRows] = useState<T[]>([]);
  const [pageInfo, setPageInfo] = useState<PageInfo | null>(null);
  const [summary, setSummary] = useState<ListSummary | null>(null);
  const [loading, setLoading] = useState(true);

  /**
   * ลิงก์เก่าใช้ `?status=SUBMITTED,UNDER_REVIEW` ซึ่งเป็นคำศัพท์ที่หน้าจอเลิกใช้แล้ว
   * แต่ API ยังรับอยู่ จึงส่งต่อไปให้ตามเดิม **จนกว่าผู้ใช้จะแตะเม็ดกรองเอง** แล้วค่อยทิ้ง
   * ถ้าถือไว้ตลอด คนที่มาจากลิงก์เก่าแล้วกดเม็ดกรองใหม่จะได้ผลลัพธ์ที่กว้างกว่าที่กด
   */
  const [legacyStatus, setLegacyStatus] = useState<string | null>(() => params.get("status"));

  const [tab, setTabState] = useState<QueueTab>(() => {
    const explicit = params.get("tab");
    if (explicit === "all" || explicit === "mine") return explicit;
    // ลิงก์เก่าเจาะจงชุดสถานะมาแล้ว เปิดในแท็บ "ทั้งหมด" ไม่งั้นสองเงื่อนไขตัดกันจนว่าง
    if (params.get("status")) return "all";
    return hasQueue ? "mine" : "all";
  });
  const [stages, setStages] = useState<StageToken[]>(
    () => (params.get("stage")?.split(",").filter(Boolean) as StageToken[]) ?? [],
  );
  const [sort, setSortState] = useState<SortOrder>(() =>
    params.get("sort") === "date_asc" ? "date_asc" : "date_desc",
  );
  const [page, setPage] = useState(() => Math.max(1, Number(params.get("page")) || 1));
  const [query, setQueryState] = useState(() => params.get("q") ?? "");

  /**
   * การเปลี่ยนหน้าและการสลับแท็บเป็น "การเดินทาง" ที่ผู้ใช้อยากกด back กลับมาได้
   * ส่วนการพิมพ์ค้นหาและการกดเม็ดกรองไม่ใช่ — ถ้าเก็บทุกคีย์สโตรกลง history
   * ปุ่ม back จะต้องกดย้อนทีละตัวอักษรกว่าจะออกจากหน้านี้ได้
   */
  const pushNext = useRef(false);

  /** เปลี่ยนตัวกรองอะไรก็ตาม = กลับไปหน้า 1 บังคับไว้ในฮุก ไม่ใช่ที่ผู้เรียก
   *  นี่คือบั๊กของ pagination ที่พบบ่อยที่สุด และควรเกิดขึ้นไม่ได้เชิงโครงสร้าง */
  const setTab = useCallback((next: QueueTab) => {
    pushNext.current = true;
    setTabState(next);
    setPage(1);
  }, []);
  const setSort = useCallback((next: SortOrder) => {
    setSortState(next);
    setPage(1);
  }, []);
  const setQuery = useCallback((next: string) => {
    setQueryState(next);
    setPage(1);
  }, []);
  const toggleStage = useCallback((token: StageToken) => {
    setStages((prev) => (prev.includes(token) ? prev.filter((t) => t !== token) : [...prev, token]));
    setLegacyStatus(null);
    setPage(1);
  }, []);
  const clearStages = useCallback(() => {
    setStages([]);
    setLegacyStatus(null);
    setPage(1);
  }, []);

  const stageParam = useMemo(() => stages.join(","), [stages]);

  /** คำตอบที่มาถึงช้ากว่าคำขอที่ใหม่กว่าต้องถูกทิ้ง — ไม่งั้นตารางโชว์หน้า 2 ขณะที่
   *  ตัวเลขบอกหน้า 3 เกิดได้ง่ายกับ debounce บวกการกดเปลี่ยนหน้ารัว ๆ */
  const seq = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => {
      const mine = seq.current + 1;
      seq.current = mine;

      const qs = new URLSearchParams();
      if (stageParam) qs.set("stage", stageParam);
      if (legacyStatus) qs.set("status", legacyStatus);
      if (query.trim()) qs.set("q", query.trim());
      if (tab === "mine") qs.set("scope", "mine");
      qs.set("sort", sort);
      qs.set("page", String(page));

      const summaryQs = new URLSearchParams();
      if (query.trim()) summaryQs.set("q", query.trim());

      Promise.all([
        api.get<Record<string, unknown>>(`${endpoint}?${qs}`),
        api.get<ListSummary>(`${endpoint}/summary?${summaryQs}`),
      ])
        .then(([list, counts]) => {
          if (seq.current !== mine) return;
          setRows((list[itemsKey] as T[]) ?? []);
          setPageInfo((list.page as PageInfo) ?? null);
          setSummary(counts);
        })
        .catch(() => {
          if (seq.current !== mine) return;
          show({ tone: "error", title: "โหลดรายการไม่สำเร็จ" });
        })
        .finally(() => {
          if (seq.current === mine) setLoading(false);
        });
    }, 250);
    return () => clearTimeout(timer);
  }, [endpoint, itemsKey, stageParam, legacyStatus, query, tab, sort, page, show]);

  /** เขียนสถานะทั้งชุดกลับลง URL พร้อมกัน ลิงก์ที่แชร์ไปจึงเปิดได้ตามที่เห็นบนจอ */
  useEffect(() => {
    const qs = new URLSearchParams();
    if (tab === "mine") qs.set("tab", "mine");
    if (stageParam) qs.set("stage", stageParam);
    if (query.trim()) qs.set("q", query.trim());
    if (sort !== "date_desc") qs.set("sort", sort);
    if (page > 1) qs.set("page", String(page));
    const next = qs.toString();
    if (next !== window.location.search.replace(/^\?/, "")) {
      const href = next ? `?${next}` : window.location.pathname;
      if (pushNext.current) router.push(href, { scroll: false });
      else router.replace(href, { scroll: false });
    }
    pushNext.current = false;
  }, [tab, stageParam, query, sort, page, router]);

  /**
   * หน้าที่เลยขอบ — เกิดกับ bookmark ที่ `?page=9` แล้วมาเจอผลลัพธ์ 2 หน้า
   * ดึงกลับมาหน้า 1 แทนที่จะโชว์ตารางว่างข้างตัวเลขที่บอกว่า "แสดง 161–180 จาก 43"
   */
  useEffect(() => {
    if (pageInfo && page > pageInfo.pageCount) setPage(1);
  }, [pageInfo, page]);

  const goToPage = useCallback((next: number) => {
    pushNext.current = true;
    setPage(Math.max(1, next));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  return {
    rows,
    loading,
    pageInfo,
    summary,
    tab,
    setTab,
    stages,
    toggleStage,
    clearStages,
    sort,
    setSort,
    query,
    setQuery,
    page,
    goToPage,
    hasFilter: stages.length > 0 || query.trim().length > 0,
  };
}
