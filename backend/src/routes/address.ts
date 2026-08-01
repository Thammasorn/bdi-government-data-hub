import { Router } from "express";

import { listAmphoes, listProvinces, listSubdistricts } from "../lib/address.js";

export const addressRouter = Router();

/** ข้อมูลนิ่งมาก — ให้ browser cache ได้ยาว ๆ ลดการยิงซ้ำระหว่างกรอกฟอร์ม */
addressRouter.use((_req, res, next) => {
  res.set("Cache-Control", "public, max-age=86400");
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
