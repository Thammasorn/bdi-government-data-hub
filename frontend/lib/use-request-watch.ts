"use client";

import { useEffect, useRef } from "react";

import { ApiError, api } from "./api";
import { ORGANIZATION_STATUS_META, isOrganizationFrozen, stageMeta } from "./status";
import type { OrganizationStatus, RequestStatus, ReviewTaskType } from "./status";

/**
 * ทุกด่านเปิดให้ทุกคนที่ถือ role นั้นกดได้ — ผู้ประสานงานของ BDI หลายคนเปิดคำขอใบเดียวกันพร้อมกัน
 * ได้เป็นเรื่องปกติ คนที่ไม่ได้กดต้องรู้ว่าคำขอเดินไปแล้ว ไม่ใช่มารู้ตอนกดปุ่มแล้วเจอ 409
 * เพราะระหว่างนั้นเขาอ่านข้อมูลเก่าอยู่ และปุ่มที่กดไม่ได้แล้วก็ยังตั้งรออยู่ตรงนั้น
 *
 * **นี่เป็นที่เดียวในระบบที่ poll** กระดิ่งแจ้งเตือนตั้งใจไม่ poll (ดู NotificationBell) เพราะ
 * ข่าวช้าไปหนึ่งหน้าไม่เสียหาย แต่หน้านี้ต่างออกไป: สิ่งที่ค้างอยู่บนจอไม่ใช่แค่ข่าวเก่า
 * มันคือปุ่มที่ชวนให้กดสิ่งที่ทำไม่ได้แล้ว
 */
const POLL_INTERVAL_MS = 15_000;

/** สถานะที่คำขอหยุดเดินแล้ว — ไม่มีอะไรให้เฝ้าอีก */
const TERMINAL: RequestStatus[] = ["APPROVED", "REJECTED", "CANCELLED"];

export interface RequestState {
  status: RequestStatus;
  currentTaskType: ReviewTaskType | null;
  /** ค่าที่ backend คิดจาก updated_at ของคำขอกับ review_task และสถานะของหน่วยงาน — ดู stateVersionOf() */
  stateVersion: string;
  /**
   * สถานะของ**หน่วยงาน** — `/state` ส่งมาเสมอ หน้าจอที่ส่ง `current` เข้ามาไม่ต้องใส่ (เทียบกันแค่ `stateVersion`)
   * มีไว้ให้ `describeState()` บอกได้ว่าที่เปลี่ยนคือหน่วยงานถูกระงับ ไม่ใช่มีใครกดอะไร
   */
  organizationStatus?: OrganizationStatus;
}

/**
 * รหัสข้อผิดพลาดที่แปลว่า "คำขอเดินไปแล้วระหว่างที่หน้านี้เปิดค้างอยู่" ทั้งหมดเป็น 409
 *
 * - `stage_completed`   ด่านของผู้ใช้คนนี้ถูกปิดไปแล้ว ตอนนี้คำขออยู่ด่านอื่น
 * - `invalid_state`     ไม่มีด่านค้างอยู่เลย (ถูกส่งกลับให้แก้ไข หรือจบไปแล้ว)
 * - `task_closed`       แพ้การแข่งกันเขียนแบบเสี้ยววินาที — สองคนกดพร้อมกันจริง ๆ
 * - `active_task_exists` เหมือนกัน แต่ชนตอนเปิดด่านถัดไป
 * - `organization_frozen` ผู้ดูแลระบบระงับหรือยุติหน่วยงานระหว่างนั้น — โหลดใหม่แล้วปุ่มหายไปเพราะ banner ขึ้นแทน
 */
const MOVED_CODES = [
  "stage_completed",
  "invalid_state",
  "task_closed",
  "active_task_exists",
  "organization_frozen",
];

/**
 * ข้อผิดพลาดนี้แปลว่าคำขอเดินไปแล้วหรือเปล่า — คืนข้อความที่เอาไปแสดงได้เลย
 *
 * backend เขียนข้อความไว้ครบแล้วว่าเกิดอะไรขึ้นและตอนนี้คำขออยู่ขั้นไหน หน้าจอจึงส่งต่อ
 * ไม่ใช่แต่งใหม่ — ถ้าแต่งใหม่ สองฝั่งจะเล่าเรื่องเดียวกันคนละแบบทันทีที่ด้านใดด้านหนึ่งแก้
 */
export function movedMessage(err: unknown): string | null {
  if (!(err instanceof ApiError) || err.status !== 409) return null;
  return MOVED_CODES.includes(err.code) ? err.message : null;
}

/**
 * ประกาศว่าตอนนี้คำขอไปอยู่ตรงไหน — ใช้ตอนรู้จากการ poll ซึ่งไม่มีข้อความจาก backend
 *
 * ใช้ `stageMeta()` ตัวเดียวกับที่ป้ายสถานะใช้ ประกาศกับป้ายที่อยู่ห่างกันไม่กี่บรรทัดจึงเรียก
 * ด่านเดียวกันด้วยชื่อเดียวกันเสมอ
 */
export function describeState(state: RequestState): string {
  // ที่เปลี่ยนคือหน่วยงาน ไม่ใช่คำขอ — "มีผู้ใช้ท่านอื่นดำเนินการ" จะไม่จริง
  if (isOrganizationFrozen(state.organizationStatus)) {
    return `ผู้ดูแลระบบเปลี่ยนสถานะหน่วยงานเป็น "${ORGANIZATION_STATUS_META[state.organizationStatus!].label}" ระหว่างที่คุณเปิดหน้านี้ — คำขอหยุดอยู่ที่ขั้นเดิม หน้าจอนี้อัปเดตให้แล้ว`;
  }
  const { label } = stageMeta(state.status, state.currentTaskType);
  return `มีผู้ใช้ท่านอื่นดำเนินการกับคำขอนี้ ตอนนี้คำขออยู่ที่ "${label}" — หน้าจอนี้อัปเดตให้แล้ว`;
}

export function useRequestWatch(params: {
  kind: "organizations" | "dataset-requests";
  /** id ของ **คำขอ** ไม่ใช่ param จาก URL — เส้นทางหน่วยงานยอมให้ URL เป็น id ของหน่วยงานได้ */
  requestId: string | null;
  /** สถานะที่หน้าจอกำลังแสดงอยู่ — null = ยังโหลดไม่เสร็จ ยังไม่ต้องเฝ้า */
  current: RequestState | null;
  onChanged: (next: RequestState) => void;
}): void {
  const { kind, requestId, current, onChanged } = params;

  /**
   * ค่าล่าสุดอยู่ใน ref ไม่ใช่ใน deps
   *
   * ถ้าใส่ `current` เป็น dependency ของ effect ทุกครั้งที่หน้า re-render นาฬิกาจะถูกล้าง
   * แล้วตั้งใหม่ นับหนึ่งใหม่เรื่อย ๆ และถ้า re-render ถี่กว่า 15 วินาทีก็จะไม่ยิงเลยสักครั้ง
   */
  const currentRef = useRef(current);
  currentRef.current = current;
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;

  const watching = current !== null && !TERMINAL.includes(current.status);

  useEffect(() => {
    if (!requestId || !watching) return;

    let cancelled = false;
    const check = () => {
      if (document.visibilityState !== "visible") return;
      // `background`: 502 ระหว่าง backend ล่มได้รหัสใหม่ทุก 15 วินาที ต้องไม่ดันรหัสที่ผู้ใช้เห็นใน toast ออกจากคิวรายงาน
      void api
        .get<{ state: RequestState }>(`/api/${kind}/${requestId}/state`, { background: true })
        .then(({ state }) => {
          const shown = currentRef.current;
          if (cancelled || !shown || shown.stateVersion === state.stateVersion) return;
          onChangedRef.current(state);
        })
        .catch(() => {
          /**
           * เงียบไว้โดยตั้งใจ
           *
           * นี่คือการถามเบื้องหลังที่ผู้ใช้ไม่ได้สั่ง เน็ตสะดุดครั้งเดียวจึงไม่ควรเด้งอะไรมาขวางเขา
           * และถ้าเด้ง มันจะเด้งซ้ำทุก 15 วินาที ส่วน 401 มี SessionProvider ดูแลอยู่แล้ว
           */
        });
    };

    /**
     * แท็บที่ถูกพับไว้เบื้องหลังไม่ต้องถาม — ไม่มีใครดูอยู่ และการ poll ค้างไว้ทำให้ session
     * ไม่มีวันหมดอายุแบบ idle (`last_seen_at` ขยับทุกครั้งที่มี request) พอกลับมาดูค่อยถาม
     * ทันทีหนึ่งครั้ง จะได้ไม่ต้องรอครบรอบก่อนเห็นของจริง
     */
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(check, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [kind, requestId, watching]);
}
