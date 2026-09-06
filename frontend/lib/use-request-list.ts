"use client";

/**
 * สถานะทั้งหมดของหน้ารายการหนึ่งหน้า — ตารางหน่วยงานกับตารางชุดข้อมูลใช้ตัวเดียวกัน
 *
 * เดิมสองตารางถือ state ของตัวเองด้วยโค้ดที่เหมือนกันเกือบบรรทัดต่อบรรทัด ส่วนที่
 * *ต่างกันจริง* คือคอลัมน์และ JSX ของแถว ซึ่งยกออกมารวมกันไม่ได้อยู่แล้ว เพราะ
 * Tailwind สแกนคลาสแบบ static — คลาส grid ต้องเขียนเป็นสตริงเต็มในไฟล์ของตัวเอง
 */
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { useToast } from "@/components/ui/Toast";
import { api } from "@/lib/api";
import type { ListSummary, NodeKey, PageInfo, SortOrder } from "@/lib/stage";

export type QueueTab = "mine" | "all";

/** ตัวเลือกจำนวนแถวต่อหน้า — เพดาน 100 มาจาก parsePaging() ฝั่ง backend */
export const PAGE_SIZES = [10, 20, 50, 100];
export const DEFAULT_PAGE_SIZE = 20;

interface Options {
  /** เช่น "/api/organizations" — ตัวสรุปคือ path เดียวกันต่อท้าย /summary */
  endpoint: string;
  /** คีย์ของ array ในคำตอบ: "organizations" หรือ "requests" */
  itemsKey: string;
  /** ผู้ใช้มีขั้นตอนเป็นของตัวเองไหม — ตัดสินจาก role ที่รู้อยู่แล้ว ไม่ใช่จากตัวเลขที่ต้องรอโหลด
   *  ถ้ารอ /summary แท็บจะกระพริบสลับหลังโหลดเสร็จ ซึ่งเห็นได้ชัดทุกครั้ง */
  hasQueue: boolean;
}

export function useRequestList<T>({ endpoint, itemsKey, hasQueue }: Options) {
  const router = useRouter();
  const params = useSearchParams();
  const { show } = useToast();

  const [rows, setRows] = useState<T[]>([]);
  const [pageInfo, setPageInfo] = useState<PageInfo | null>(null);
  const [summary, setSummary] = useState<ListSummary | null>(null);
  const [loading, setLoading] = useState(true);

  /**
   * ลิงก์เก่ามีสองรุ่น — `?status=SUBMITTED,UNDER_REVIEW` จากตอนที่ยังกรองด้วยสถานะ และ
   * `?stage=A,B` จากตอนที่เม็ดกรองยังเลือกได้หลายอัน ตอนนี้เลือกได้ทีละอันแล้ว จึงไม่มี
   * สถานะบนแผนภาพที่ตรงกับ "A หรือ B" — ส่งสตริงเดิมต่อไปให้ API ตามเดิม (API ยังรับ
   * comma list) โดยไม่ติ๊กโหนดไหน แล้วทิ้งทันทีที่ผู้ใช้แตะแผนภาพ ถ้าถือไว้ต่อ ผลลัพธ์
   * จะกว้างกว่าโหนดที่เขากด
   */
  const [legacyFilter, setLegacyFilter] = useState<{ key: string; value: string } | null>(() => {
    const stage = params.get("stage");
    if (stage?.includes(",")) return { key: "stage", value: stage };
    const status = params.get("status");
    return status ? { key: "status", value: status } : null;
  });

  const [stage, setStageState] = useState<NodeKey | null>(() => {
    const s = params.get("stage");
    return s && !s.includes(",") ? s : null;
  });

  const [tab, setTabState] = useState<QueueTab>(() => {
    const explicit = params.get("tab");
    if (explicit === "all" || explicit === "mine") return explicit;
    /**
     * ลิงก์ที่เจาะจงตัวกรองมาแล้วเปิดที่แท็บ "ทั้งหมด" — `stage` กับ `scope` AND กันฝั่ง
     * server ถ้าเปิดที่แท็บของตัวเองด้วย คนที่รับลิงก์จะเจอตารางว่างจากเงื่อนไขสองชั้น
     * ที่เขาไม่ได้เลือกเอง
     */
    if (params.get("stage") || params.get("status")) return "all";
    return hasQueue ? "mine" : "all";
  });

  const [sort, setSortState] = useState<SortOrder>(() =>
    params.get("sort") === "date_asc" ? "date_asc" : "date_desc",
  );
  const [page, setPage] = useState(() => Math.max(1, Number(params.get("page")) || 1));
  /** จำนวนแถวต่อหน้า — ผู้ใช้เลือกเองได้ backend รับได้ถึง 100 */
  const [pageSize, setPageSizeState] = useState(() => {
    const raw = Number(params.get("pageSize"));
    return PAGE_SIZES.includes(raw) ? raw : DEFAULT_PAGE_SIZE;
  });
  const [query, setQueryState] = useState(() => params.get("q") ?? "");

  /**
   * การเปลี่ยนหน้าและการสลับแท็บเป็น "การเดินทาง" ที่ผู้ใช้อยากกด back กลับมาได้
   * ส่วนการพิมพ์ค้นหาและการกดโหนดไม่ใช่ — ถ้าเก็บทุกคีย์สโตรกลง history ปุ่ม back
   * จะต้องกดย้อนทีละตัวอักษรกว่าจะออกจากหน้านี้ได้
   */
  const pushNext = useRef(false);

  /** เปลี่ยนตัวกรองอะไรก็ตาม = กลับไปหน้า 1 บังคับไว้ในฮุก ไม่ใช่ที่ผู้เรียก
   *  นี่คือบั๊กของ pagination ที่พบบ่อยที่สุด และควรเกิดขึ้นไม่ได้เชิงโครงสร้าง */
  const setTab = useCallback(
    (next: QueueTab) => {
      pushNext.current = true;
      setTabState(next);
      setPage(1);
      /**
       * กลับมาแท็บของตัวเองแล้วกล่องที่เลือกค้างไว้ไม่ใช่ของเรา = ตัวกรองที่ยกเลิกไม่ได้
       * เพราะกล่องนั้น disable ไปแล้วในแท็บนี้ ล้างทิ้งตรงนี้ที่เดียว ผู้เรียกไม่ต้องรู้
       */
      if (next !== "mine") return;
      setStageState((current) => {
        if (current === null) return null;
        return summary?.nodes.find((n) => n.key === current)?.mine ? current : null;
      });
    },
    [summary],
  );
  const setSort = useCallback((next: SortOrder) => {
    setSortState(next);
    setPage(1);
  }, []);
  const setQuery = useCallback((next: string) => {
    setQueryState(next);
    setPage(1);
  }, []);
  /** เปลี่ยนจำนวนแถวต่อหน้าแล้วหน้าเดิมอาจเลยขอบ — กลับหน้า 1 เหมือนตัวกรองอื่น */
  const setPageSize = useCallback((next: number) => {
    setPageSizeState(next);
    setPage(1);
  }, []);

  /**
   * เลือกทีละโหนด — ไม่ใช่ toggle สะสมเหมือนเม็ดกรองเดิม
   *
   * ไม่ต้องสลับแท็บให้เองอีกแล้ว: แท็บเป็นตัวคุมว่ากล่องไหนกดได้ กล่องที่ไม่ใช่ของผู้ใช้
   * จึง disable ในแท็บของตัวเองอยู่แล้ว การกดจึงไม่มีทางขัดกับ `scope=mine`
   */
  const selectStage = useCallback((next: NodeKey | null) => {
    setStageState(next);
    setLegacyFilter(null);
    setPage(1);
  }, []);

  /** คำตอบที่มาถึงช้ากว่าคำขอที่ใหม่กว่าต้องถูกทิ้ง — ไม่งั้นตารางโชว์หน้า 2 ขณะที่
   *  ตัวเลขบอกหน้า 3 เกิดได้ง่ายกับ debounce บวกการกดเปลี่ยนหน้ารัว ๆ */
  const seq = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => {
      const mine = seq.current + 1;
      seq.current = mine;

      const qs = new URLSearchParams();
      if (stage) qs.set("stage", stage);
      if (legacyFilter) qs.set(legacyFilter.key, legacyFilter.value);
      if (query.trim()) qs.set("q", query.trim());
      if (tab === "mine") qs.set("scope", "mine");
      qs.set("sort", sort);
      qs.set("page", String(page));
      qs.set("pageSize", String(pageSize));

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
  }, [endpoint, itemsKey, stage, legacyFilter, query, tab, sort, page, pageSize, show]);

  /** เขียนสถานะทั้งชุดกลับลง URL พร้อมกัน ลิงก์ที่แชร์ไปจึงเปิดได้ตามที่เห็นบนจอ */
  useEffect(() => {
    const qs = new URLSearchParams();
    if (tab === "mine") qs.set("tab", "mine");
    if (stage) qs.set("stage", stage);
    if (query.trim()) qs.set("q", query.trim());
    if (sort !== "date_desc") qs.set("sort", sort);
    if (page > 1) qs.set("page", String(page));
    if (pageSize !== DEFAULT_PAGE_SIZE) qs.set("pageSize", String(pageSize));
    const next = qs.toString();
    if (next !== window.location.search.replace(/^\?/, "")) {
      const href = next ? `?${next}` : window.location.pathname;
      if (pushNext.current) router.push(href, { scroll: false });
      else router.replace(href, { scroll: false });
    }
    pushNext.current = false;
  }, [tab, stage, query, sort, page, pageSize, router]);

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
    stage,
    selectStage,
    sort,
    setSort,
    query,
    setQuery,
    page,
    goToPage,
    pageSize,
    setPageSize,
    hasFilter: stage !== null || legacyFilter !== null || query.trim().length > 0,
  };
}
