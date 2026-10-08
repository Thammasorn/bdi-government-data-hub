import { Router } from "../lib/async-route.js";

import { listAmphoes, listProvinces, listSubdistricts } from "../lib/address.js";

export const addressRouter = Router();

/**
 * ข้อมูลนิ่งมาก ให้ browser cache ไว้ลดการยิงซ้ำระหว่างกรอกฟอร์ม — แต่แอดมินแก้ได้ผ่าน
 * /api/admin/addresses แล้ว จึงสั้นพอที่การแก้จะไปถึงผู้ใช้ภายในไม่กี่นาที (เดิม 1 วัน)
 */
addressRouter.use((_req, res, next) => {
  res.set("Cache-Control", "public, max-age=300");
  next();
});

addressRouter.get("/provinces", (_req, res) => {
  res.json({ provinces: listProvinces() });
});

addressRouter.get("/amphoes", (req, res) => {
  const province = String(req.query.province ?? "");
  res.json({ amphoes: listAmphoes(province) });
});

addressRouter.get("/subdistricts", (req, res) => {
  const province = String(req.query.province ?? "");
  const amphoe = String(req.query.amphoe ?? "");
  res.json({ subdistricts: listSubdistricts(province, amphoe) });
});
