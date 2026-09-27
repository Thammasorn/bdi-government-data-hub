#!/usr/bin/env python3
"""ตรวจว่า Postman environment ที่ commit ไว้ไม่มีค่าลับจริงติดไปด้วย

    python3 docs/tools/check-postman-secrets.py          # ตรวจ docs/*.postman_environment.json
    python3 docs/tools/check-postman-secrets.py <ไฟล์>…   # หรือระบุไฟล์เอง

รันก่อน commit ไฟล์ Postman ทุกครั้ง — ออกด้วยรหัส 1 และบอกชื่อตัวแปร (ไม่พิมพ์ค่า) เมื่อเจอ

ทำไมต้องมี: commit `0d0a0d4` (2026-09-24) บันทึก `adminToken` ตัวจริงของ production ลงใน
`docs/bdi-public.postman_environment.json` ทั้งที่ CLAUDE.md กับคำอธิบายของ collection เองบอกว่า
เว้นว่างไว้โดยตั้งใจ แล้ว commit นั้นก็ขึ้น Bitbucket และ GitHub ซึ่งเป็น repo สาธารณะ
กติกาที่เขียนไว้เป็นคำพูดไม่พอ จึงต้องมีตัวตรวจ

ตัดสินจาก **ชื่อ** ตัวแปร ไม่ใช่ `type` — `bdi-dev-checkout` ประกาศ `adminToken` เป็น
`type: "default"` ตัวตรวจที่ดูแค่ `type: "secret"` จะมองข้ามไฟล์นั้นไปทั้งไฟล์
ค่าที่ยอมให้มีได้คือค่าว่าง กับค่าตัวอย่างรูป `dev-…-change-me` ที่ checkout สำหรับพัฒนาใช้
"""
import json
import re
import sys
from pathlib import Path

SECRET_NAME = re.compile(r"token|secret|key|password|passwd|pass$", re.I)
PLACEHOLDER = re.compile(r"^dev-[a-z0-9-]*change-me$")


def problems(path: Path) -> list[str]:
    data = json.loads(path.read_text(encoding="utf-8"))
    found = []
    for var in data.get("values", []):
        name = var.get("key", "")
        value = var.get("value") or ""
        if SECRET_NAME.search(name) and value and not PLACEHOLDER.match(value):
            found.append(f"{path}: ตัวแปร `{name}` มีค่าอยู่ (ยาว {len(value)} ตัวอักษร) — ต้องเว้นว่าง")
    return found


def main(argv: list[str]) -> int:
    root = Path(__file__).resolve().parents[1]
    files = [Path(a) for a in argv] or sorted(root.glob("*.postman_environment.json"))
    issues = [msg for f in files for msg in problems(f)]
    for msg in issues:
        print(msg, file=sys.stderr)
    if not issues:
        print(f"ตรวจ {len(files)} ไฟล์ — ไม่พบค่าลับ")
    return 1 if issues else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
