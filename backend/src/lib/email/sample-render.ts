/**
 * render เทมเพลตหนึ่งตัวด้วยข้อมูลตัวอย่าง — preview ของหน้าแก้ (API) และอีเมลทดสอบ (delivery-worker) ใช้ตัวเดียวกัน
 *
 * แม่แบบกลางแสดงคู่กับอีเมล "หน่วยงานเปิดใช้งานแล้ว" ฉบับที่ใช้งานอยู่ เทมเพลตอื่นแสดงคู่กับแม่แบบกลางที่ใช้งานอยู่
 */
import type { PrismaClient } from "@prisma/client";

import { LAYOUT_KEY, type TemplateContent, type TemplateDefinition } from "./catalogue.js";
import { loadImages, referencedImages } from "./images.js";
import { renderEmail } from "./render.js";
import { LAYOUT_PREVIEW_KEY, sampleContext } from "./samples.js";
import { liveContent } from "./store.js";

export async function renderSample(db: PrismaClient, def: TemplateDefinition, content: TemplateContent, preview: boolean) {
  const ctx = sampleContext(def.key);
  const [template, layout] =
    def.key === LAYOUT_KEY
      ? [(await liveContent(db, LAYOUT_PREVIEW_KEY)).content, content]
      : [content, (await liveContent(db, LAYOUT_KEY)).content];
  const images = await loadImages(db, referencedImages(template.bodyHtml, template.footnoteHtml, layout.bodyHtml));
  return renderEmail({ content: template, layout, ctx, images, preview });
}
