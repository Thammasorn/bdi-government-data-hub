/**
 * Router ที่ส่ง rejection ของ async handler ไปให้ error middleware
 *
 * Express 4 เรียก handler แล้วทิ้งค่าที่ return — ถ้า handler เป็น `async` และ throw
 * ผลลัพธ์คือ unhandled rejection ซึ่ง Node 22 ตั้งค่าเริ่มต้นให้ฆ่าโปรเซส ไม่ใช่ 500
 * ทั้งกระบวนการตายพร้อมกับ request อื่นที่ค้างอยู่ และ error middleware ใน index.ts
 * ก็ไม่มีโอกาสได้ทำงาน
 *
 * เจอตอนยิง `GET /api/organizations/mine` (ไม่มี route นี้ จึงไปเข้า `GET /:id`)
 * Prisma โยน P2023 เพราะ "mine" ไม่ใช่ UUID แล้ว backend ดับทั้งตัว — เป็นวิธีล้มระบบ
 * ที่ใครก็ทำได้ด้วย URL เดียว
 *
 * แก้ที่ทางเข้าเดียวแทนการไล่ใส่ try/catch 40 จุด เพราะ route ที่เขียนเพิ่มทีหลัง
 * จะได้รับการคุ้มครองเองโดยไม่ต้องจำ ใช้แทน `import { Router } from "express"`
 * ในไฟล์ใต้ routes/ ทุกไฟล์
 *
 * ถ้าวันหนึ่งย้ายไป Express 5 ไฟล์นี้ลบทิ้งได้ — v5 ทำให้ในตัวแล้ว
 *
 * อีกหน้าที่หนึ่งที่ Express 5 **ไม่ได้** ทำให้: `next` ถูกผูกกับบริบทของคำขอ (ดู `wrap()`) ถ้าย้ายไป
 * v5 ต้องเก็บส่วนนั้นไว้
 */
import { AsyncResource } from "node:async_hooks";

import { Router as ExpressRouter, type IRouter, type RequestHandler } from "express";

/**
 * error middleware ของ Express มีสี่พารามิเตอร์ ห้ามแตะ ไม่งั้นมันจะกลายเป็น handler ธรรมดา
 *
 * `next` ที่ส่งให้ handler ถูกผูกกับบริบทของคำขอ (`AsyncResource.bind`) — middleware แบบ callback
 * ที่เรียก `next` จาก event ของ stream คืนบริบทของ AsyncLocalStorage ไม่ได้ เพราะ event นั้นวิ่งใน
 * บริบทของ socket ไม่ใช่ของคำขอ multer (busboy) เป็นแบบนั้น: ไฟล์ที่ body มาไม่ทันพร้อม header (ไฟล์
 * ขนาดจริงทุกไฟล์) ทำให้ handler หลังการอัปโหลดวิ่งโดยไม่มี store ของ lib/context.ts เลย แถว audit
 * ของการอัปโหลดคำสั่งแต่งตั้งขนาด 759 KB จึงกลายเป็น actor SYSTEM, source `request-service`, ไม่มี IP
 * และ correlation id สุ่มใหม่ (ไฟล์ 45 ไบต์ไม่เป็น) — คนที่อัปโหลดหายไปจากบันทึก การเผยแพร่ template
 * ของ admin ก็ไม่ได้ป้าย `admin-portal` ด้วยเหตุเดียวกัน ผูกที่นี่ที่เดียว route ที่เพิ่มทีหลังได้ไปด้วย
 */
function wrap(handler: unknown): unknown {
  if (typeof handler !== "function" || handler.length === 4) return handler;

  const fn = handler as RequestHandler;
  const wrapped: RequestHandler = (req, res, next) => {
    const resume = AsyncResource.bind(next);
    try {
      Promise.resolve(fn(req, res, resume)).catch(resume);
    } catch (error) {
      resume(error);
    }
  };
  return wrapped;
}

const METHODS = ["all", "get", "post", "put", "patch", "delete", "use"] as const;

export function Router(): IRouter {
  const router = ExpressRouter();

  for (const method of METHODS) {
    const original = router[method].bind(router) as (...args: unknown[]) => unknown;
    (router[method] as unknown) = (...args: unknown[]) => original(...args.map(wrap));
  }

  return router;
}
