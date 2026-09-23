/**
 * ข้อความรายช่องที่ `POST /:id/submit` ตอบกลับมา ส่งต่อจากหน้าตรวจสอบไปยังหน้าฟอร์ม
 *
 * หน้าตรวจสอบไม่มีช่องกรอกสักช่อง มันจึงแสดงข้อความพวกนี้เองไม่ได้ ส่วนหน้าฟอร์มก็เป็น
 * component คนละตัวที่ mount ใหม่ทั้งหมด state ของหน้าตรวจสอบเข้าไปถึงไม่ได้ ก่อนหน้านี้
 * `err.fields` จึงถูกทิ้งไปทั้งชุด แล้วผู้ใช้ได้ toast ว่า "เกิดข้อผิดพลาด กรุณาลองใหม่
 * อีกครั้ง" กับฟอร์มที่ไม่มีเครื่องหมายอะไรเลย (feedback 2026-09-23 แถว 6)
 *
 * ใช้ `sessionStorage` เพราะข้อความชุดนี้มีอายุเท่ากับการเดินทางครั้งเดียวระหว่างสองหน้า
 * — ไม่ควรข้ามแท็บ ไม่ควรอยู่ข้ามวัน และหน้าฟอร์มต้อง**หยิบออก** ไม่ใช่อ่านค้างไว้ ไม่งั้น
 * ข้อความรอบเก่าจะกลับมาทุกครั้งที่เปิดฟอร์ม `take` จึงลบทิ้งเมื่ออ่าน
 *
 * ผูกกับ id ของคำขอ เพราะผู้ใช้เปิดคำขอสองใบคนละแท็บได้ และข้อความของใบหนึ่งไม่ควรไป
 * ระบายสีอีกใบหนึ่ง
 *
 * ทุกการเรียกอยู่ใน try/catch: `sessionStorage` โยน exception ได้เมื่อเบราว์เซอร์ปิด
 * storage ไว้ และการส่งต่อข้อความผิดพลาดไม่ควรทำให้หน้าจอพังยิ่งกว่าเดิม
 */
const keyFor = (requestId: string) => `bdi:submit-errors:${requestId}`;

export function stashSubmitErrors(requestId: string, fields: Record<string, string>): void {
  if (Object.keys(fields).length === 0) return;
  try {
    sessionStorage.setItem(keyFor(requestId), JSON.stringify(fields));
  } catch {
    // เบราว์เซอร์ปิด storage — ฟอร์มยังตรวจฝั่งหน้าเว็บเองได้ แค่ไม่ได้ข้อความของ API
  }
}

/** อ่านแล้วลบทิ้ง — ข้อความชุดนี้ใช้ได้ครั้งเดียว */
export function takeSubmitErrors(requestId: string): Record<string, string> {
  try {
    const raw = sessionStorage.getItem(keyFor(requestId));
    if (!raw) return {};
    sessionStorage.removeItem(keyFor(requestId));
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    // กรองให้เหลือเฉพาะคู่ string→string ค่าที่อ่านมาจาก storage ไม่มีใครรับประกันรูปร่างให้
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0,
      ),
    );
  } catch {
    return {};
  }
}

/**
 * ช่องที่ "ผู้ใช้ตอบไปแล้ว" — ช่องที่มีค่าอยู่ นับว่าแตะแล้ว
 *
 * `touched` มีไว้กันไม่ให้ฟอร์มเปล่าแดงทั้งหน้าตั้งแต่ยังไม่ได้กรอกอะไร ซึ่งยังเป็นกฎที่ถูก
 * สำหรับช่อง**ว่าง** แต่ช่องที่มีคำตอบอยู่แล้ว — ร่างที่บันทึกไว้ คำขอที่ถูกส่งกลับมาแก้ หรือ
 * ค่าที่ระบบเติมให้จากบัญชี — คือช่องที่ตัดสินได้ทันทีว่าผ่านหรือไม่ผ่าน การรอให้ผู้ใช้เข้าไป
 * แล้วออกจากทีละช่องก่อนจึงจะยอมบอก แปลว่าคนที่กลับมาแก้ฟอร์มเห็นหน้าจอที่ไม่มีทั้งขอบแดง
 * และขอบเขียว ทั้งที่ระบบรู้คำตอบอยู่แล้ว (feedback 2026-09-23 แถว 6)
 */
export function touchedFromValues<K extends string>(
  form: Record<K, string>,
): Partial<Record<K, boolean>> {
  const touched: Partial<Record<K, boolean>> = {};
  for (const [key, value] of Object.entries(form) as Array<[K, string]>) {
    if (typeof value === "string" && value.trim().length > 0) touched[key] = true;
  }
  return touched;
}
