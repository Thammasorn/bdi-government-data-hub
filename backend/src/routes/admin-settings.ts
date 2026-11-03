/**
 * ค่าตั้งระบบ — `/api/admin/settings` (หน้า /console → ตั้งค่าระบบ, การ์ด "อีเมลเตือนก่อนคำเชิญหมดอายุ (ตั้งจำนวนวันได้ใน admin)" 2026-11-03)
 *
 * ผู้ดูแลระบบเท่านั้น (`requireAdmin`) — `BDI_LEGAL_OFFICER` ที่เข้าหมวด "ตั้งค่าเอกสาร" ได้ไม่เกี่ยวกับหมวดนี้
 * รายการค่า ช่วง และค่าเริ่มต้นอยู่ที่ `lib/system-settings.ts` route นี้แค่อ่านและเขียน ไม่รู้จักค่าไหนเป็นพิเศษ
 */
import { z } from "zod";

import { prisma } from "../db.js";
import { Router } from "../lib/async-route.js";
import { AuditAction, AuditSubject, logAudit } from "../lib/audit.js";
import { adminActorId } from "../lib/context.js";
import { fullNameTh } from "../lib/person-name.js";
import {
  SYSTEM_SETTINGS,
  isSystemSettingKey,
  listSystemSettings,
  parseSettingValue,
  readSystemSetting,
} from "../lib/system-settings.js";
import { requireAdmin } from "../middleware/auth.js";

export const adminSettingRouter = Router();
adminSettingRouter.use(requireAdmin);

/** ค่าทุกตัว พร้อมชื่อคนที่แก้ล่าสุด */
async function settingsWithNames() {
  const settings = await listSystemSettings(prisma);
  const ids = [...new Set(settings.map((s) => s.updatedBy).filter((id): id is string => Boolean(id)))];
  const people = ids.length
    ? await prisma.userAccount.findMany({
        where: { id: { in: ids } },
        select: { id: true, email: true, prefixTh: true, firstnameTh: true, lastnameTh: true },
      })
    : [];
  const names = new Map(people.map((p) => [p.id, fullNameTh(p) || p.email]));
  return settings.map((s) => ({ ...s, updatedBy: s.updatedBy ? (names.get(s.updatedBy) ?? null) : null }));
}

adminSettingRouter.get("/", async (_req, res) => {
  res.json({ settings: await settingsWithNames() });
});

const putSchema = z.object({ value: z.unknown() }).strict();

adminSettingRouter.put("/:key", async (req, res) => {
  const key = String(req.params.key ?? "");
  if (!isSystemSettingKey(key)) {
    res.status(404).json({ error: "not_found", message: "ไม่มีค่าตั้งระบบนี้" });
    return;
  }
  const parsed = putSchema.safeParse(req.body ?? {});
  const spec = SYSTEM_SETTINGS[key];
  const value = parsed.success ? parseSettingValue(key, parsed.data.value) : null;
  if (value === null) {
    res.status(400).json({
      error: "validation",
      fields: {
        value:
          `ต้องเป็นจำนวนเต็ม ${spec.min}–${spec.max()} ${spec.unit}` +
          (key === "invitation_reminder_days"
            ? " (0 = ไม่ส่งอีเมลเตือน · ต้องน้อยกว่าอายุคำเชิญ)"
            : ""),
      },
    });
    return;
  }

  const before = await prisma.systemSetting.findUnique({ where: { key } });
  const previous = await readSystemSetting(prisma, key);
  await prisma.systemSetting.upsert({
    where: { key },
    create: { key, value, updatedBy: adminActorId() },
    update: { value, updatedBy: adminActorId() },
  });

  if (previous !== value || !before) {
    await logAudit({
      action: AuditAction.SYSTEM_SETTING_UPDATED,
      subjectType: AuditSubject.SYSTEM_SETTING,
      before: { value: previous, is_default: !before },
      after: { value, is_default: false },
      metadata: { key },
    });
  }

  const settings = await settingsWithNames();
  res.json({
    setting: settings.find((s) => s.key === key),
    message:
      key === "invitation_reminder_days"
        ? value === 0
          ? "บันทึกแล้ว — ปิดอีเมลเตือนคำเชิญ"
          : `บันทึกแล้ว — เตือนก่อนคำเชิญหมดอายุ ${value} วัน มีผลภายใน 15 นาที`
        : "บันทึกแล้ว",
  });
});
