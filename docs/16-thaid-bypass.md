# โหมดข้ามการยืนยันตัวตน ThaiD (สำหรับ SIT ชั่วคราว)

> ⚠️ **เอกสารนี้อธิบายสวิตช์ที่ปิดการยืนยันตัวตนกับกรมการปกครอง** อ่านให้จบก่อนเปิด
> และอย่าเปิดบน deployment จริงที่ไม่ใช่การทดสอบ

## ทำไมต้องมี

`redirect_uri` ที่กรมการปกครองลงทะเบียนให้ client ของโครงการยังตรึงไว้ที่
`http://localhost:3000/auth/callback/thaid` ผู้ทดสอบที่กดปุ่ม ThaiD จาก
`https://bdi.thammasorn.org` จึงถูกส่งกลับไปที่ `localhost:3000` **ของเครื่องตัวเอง**
ซึ่งไม่มีอะไรรออยู่ (ยิงจริงยืนยันแล้ว: ส่งโดเมนสาธารณะไปได้
`400 invalid_request — The redirect or callback url mismatch`)

และเพราะการเปิดใช้งานบัญชีใช้ ThaiD ทางเดียว **บัญชีใหม่จึงเปิดใช้งานจากระยะไกลไม่ได้เลย**
จนกว่ากรมการปกครองจะลงทะเบียน redirect URI ของโดเมนจริงให้ โหมดนี้ให้ข้ามขั้น ThaiD
ไปก่อน เพื่อให้ผู้ทดสอบเดินครบทุก flow บน `bdi.thammasorn.org` ได้

## แยกออกจาก main เพื่อถอนคืนได้ง่าย

**โค้ดทั้งหมดของโหมดนี้อยู่บน branch `thaid-bypass-for-sit` เท่านั้น ไม่ได้ merge เข้า `main`**
การเอา ThaiD จริงกลับมาจึงเป็นแค่การ checkout กลับ

```bash
cd /hdd1tb/bdi-project/main
git checkout main                    # โค้ด main ไม่มีโหมด bypass อยู่แล้ว
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

นอกจากนั้นยังมีสวิตช์ env อีกชั้น (`THAID_BYPASS`) ที่ **ค่าตั้งต้นเป็นปิด** —
ต่อให้อยู่บน branch นี้ ถ้าไม่ตั้ง env ก็ทำงานเหมือน ThaiD ปกติทุกอย่าง

## เปิด / ปิด

เปิดใน `.env` ของ deployment แล้วรีสตาร์ต backend

```dotenv
THAID_BYPASS=true
```

```bash
docker compose up -d backend                                   # โหมด dev
# หรือ prod:
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d backend
```

ปิดกลับ: ลบบรรทัดนั้น (หรือ `THAID_BYPASS=false`) แล้วรีสตาร์ต backend อีกครั้ง
**ฝั่งหน้าเว็บไม่ต้อง build ใหม่** — หน้าเว็บอ่านสถานะจาก `GET /api/auth/config` ตอนรัน
ไม่ได้ฝังตอน build

## โหมดนี้ทำอะไร (และไม่ทำอะไร)

| | ปกติ (ThaiD จริง) | โหมด bypass |
|---|---|---|
| `POST /api/auth/thaid/start` (activate) | คืน `authorizeUrl` ของกรมการปกครอง | บันทึกใบยืนยันให้ทันที คืน `{ bypass: true }` |
| เทียบเลขบัตรกับ DOPA | ทำ | **ไม่ทำ** — เชื่อเลขบัตรที่เจ้าหน้าที่บันทึกไว้ตอนสร้างบัญชี |
| ด่านอื่นก่อนหน้า (คีย์ใช้ได้ · บัญชีมี cid) | ตรวจ | **ตรวจเหมือนเดิม** |
| เข้าสู่ระบบด้วย ThaiD | ได้ | **ปิด** (`501`) — ใช้รหัสผ่าน + OTP แทน · ปุ่ม ThaiD บนหน้า login ถูกซ่อน |
| audit `IDENTITY_VERIFIED` | `cid_source: pid`/`sub` | `cid_source: bypass` — แยกออกจากของจริงได้ในภายหลัง |

สิ่งที่ยังทำงานครบ: การเทียบว่าคีย์ยังใช้ได้ · บัญชีต้องมีเลขบัตรบันทึกไว้ ·
เข้าสู่ระบบด้วยรหัสผ่าน + OTP (ทางที่ผู้ทดสอบใช้เข้าระบบตามปกติ)

## ความเสี่ยงที่ยอมรับ

โหมดนี้ทำให้ **ผู้ที่ถือลิงก์เปิดใช้งานตั้งรหัสผ่านได้โดยไม่ต้องมีบัตรจริง** — ความปลอดภัย
ของการเปิดใช้งานบัญชีจึงเหลือแค่ "ลิงก์ถูกส่งไปที่อีเมลของผู้ถูกเชิญเท่านั้น" ยอมรับได้เฉพาะ
**สภาพแวดล้อมทดสอบ** ห้ามใช้กับระบบที่มีข้อมูลจริง — ตรงกับที่ `main/CLAUDE.md` เขียนไว้ว่า
"ไม่มีโหมด mock" การมีสวิตช์แบบนี้จึงต้องแยก branch และมีเอกสารกำกับ ไม่ทิ้งไว้ใน main

## รายการที่ต้องทำเมื่อได้ redirect URI ของโดเมนจริงจากกรมการปกครอง

- [ ] ตั้ง `THAID_REDIRECT_URI=https://bdi.thammasorn.org/auth/callback/thaid` ใน `main/.env`
- [ ] ปิด `THAID_BYPASS` (ลบบรรทัด)
- [ ] `git checkout main` ที่ checkout `main/` (ทิ้งโค้ด bypass) แล้ว build ใหม่
- [ ] ลบ branch `thaid-bypass-for-sit` ทิ้งได้เมื่อไม่ต้องใช้แล้ว
