/**
 * ข้อกำหนดรหัสผ่าน — **สำเนาโดยตั้งใจ** ของ `PASSWORD_RULES` ใน
 * `backend/src/lib/validation.ts` ข้อตกลงเดียวกับ `organization-form.ts`:
 * ฟอร์มต้องบอกได้ทันทีว่ารหัสผ่านที่กำลังพิมพ์ยังขาดอะไร ซึ่งถามเซิร์ฟเวอร์
 * ทุกครั้งที่กดแป้นไม่ได้ ฝั่ง backend ยังเป็นผู้ตัดสินเสมอ — สำเนาที่ล้าสมัย
 * ทำให้หน้าจอพูดผิด แต่ไม่ทำให้ข้อมูลผิด **แก้ไฟล์นี้พร้อมกับไฟล์นั้นเสมอ**
 */
export interface PasswordRule {
  id: string;
  label: string;
  test: (value: string) => boolean;
}

export const PASSWORD_RULES: PasswordRule[] = [
  { id: "length", label: "ความยาวอย่างน้อย 12 ตัวอักษร", test: (v) => v.length >= 12 },
  { id: "upper", label: "ตัวอักษรพิมพ์ใหญ่ (A-Z)", test: (v) => /[A-Z]/.test(v) },
  { id: "lower", label: "ตัวอักษรพิมพ์เล็ก (a-z)", test: (v) => /[a-z]/.test(v) },
  { id: "digit", label: "ตัวเลข (0-9)", test: (v) => /[0-9]/.test(v) },
  {
    id: "symbol",
    label: "อักขระหรือสัญลักษณ์พิเศษ เช่น ! @ # $ ^ & * ( ) _ +",
    // ไม่นับช่องว่างเป็นอักขระพิเศษ — เหตุผลอยู่ในไฟล์ต้นทางฝั่ง backend
    test: (v) => /[^A-Za-z0-9\s]/.test(v),
  },
];

export const passwordMeetsRules = (value: string) => PASSWORD_RULES.every((rule) => rule.test(value));
