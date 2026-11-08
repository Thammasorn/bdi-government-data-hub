/**
 * ประกอบอีเมลที่จะส่งจริงจากเวอร์ชันที่ใช้งานอยู่ของเทมเพลตกับแม่แบบกลาง
 *
 * **อีเมลต้องออกเสมอ** ถ้าเวอร์ชันในฐานข้อมูลอ่านหรือ render ไม่ได้ (แถวที่มีคนแก้ด้วยมือ ฐานข้อมูลสะดุด) จะส่งด้วยเนื้อหาตั้งต้นในโค้ด
 * แทนและบันทึก error ไว้ (`captureError`, tag `email.template-fallback`) — คำเชิญที่ไม่ออกเพราะเทมเพลตเสียคือคนที่เข้าระบบไม่ได้
 */
import { prisma } from "../../db.js";
import { captureError } from "../error-capture.js";
import { LAYOUT_KEY, templateDefinition, type TemplateContent } from "./catalogue.js";
import { defaultLogoAsset, LOGO_CODE, loadImages, referencedImages, type ImageAsset } from "./images.js";
import { renderEmail, type EmailContext, type RenderedEmail } from "./render.js";
import { liveContent } from "./store.js";

function defaultsOf(key: string): TemplateContent {
  const def = templateDefinition(key);
  if (!def) throw new Error(`ไม่มีเทมเพลตอีเมล ${key} ใน catalogue`);
  return def.defaults;
}

/** เนื้อหาตั้งต้นล้วน ไม่แตะฐานข้อมูล — `sendRaw()` (สรุป error) ใช้ เพราะมันต้องส่งได้แม้ฐานข้อมูลล่ม */
export function defaultLayout(): TemplateContent {
  return defaultsOf(LAYOUT_KEY);
}

/** รูปชุดที่ไม่แตะฐานข้อมูล — โลโก้ในโค้ดอย่างเดียว */
export function defaultImages(): Map<string, ImageAsset> {
  const logo = defaultLogoAsset();
  return logo ? new Map([[LOGO_CODE, logo]]) : new Map();
}

export async function composeEmail(ctx: EmailContext): Promise<RenderedEmail> {
  try {
    const [template, layout] = await Promise.all([liveContent(prisma, ctx.key), liveContent(prisma, LAYOUT_KEY)]);
    const images = await loadImages(
      prisma,
      referencedImages(template.content.bodyHtml, template.content.footnoteHtml, layout.content.bodyHtml),
    );
    return renderEmail({ content: template.content, layout: layout.content, ctx, images });
  } catch (err) {
    captureError(err, {
      tag: "email.template-fallback",
      fingerprint: `email:template-fallback:${ctx.key}`,
      extra: { templateKey: ctx.key },
    });
    return renderEmail({ content: defaultsOf(ctx.key), layout: defaultLayout(), ctx, images: defaultImages() });
  }
}
