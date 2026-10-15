#!/usr/bin/env python3
"""ตรวจว่าไฟล์ Postman ที่ commit ไว้ไม่มีค่าลับจริงติดไปด้วย — ทั้ง environment และ collection

    python3 docs/tools/check-postman-secrets.py          # ตรวจ docs/*.postman_*.json
    python3 docs/tools/check-postman-secrets.py <ไฟล์>…   # หรือระบุไฟล์เอง

รันก่อน commit ไฟล์ Postman ทุกครั้ง — ออกด้วยรหัส 1 และบอกชื่อตัวแปร (ไม่พิมพ์ค่า) เมื่อเจอ

ทำไมต้องมี: commit `0d0a0d4` (2026-09-24) บันทึก `adminToken` ตัวจริงของ production ลงใน
`docs/bdi-public.postman_environment.json` ทั้งที่ CLAUDE.md กับคำอธิบายของ collection เองบอกว่า
เว้นว่างไว้โดยตั้งใจ แล้ว commit นั้นก็ขึ้น Bitbucket และ GitHub ซึ่งเป็น repo สาธารณะ
กติกาที่เขียนไว้เป็นคำพูดไม่พอ จึงต้องมีตัวตรวจ

ตัดสินจาก **ชื่อ** ตัวแปร ไม่ใช่ `type` — `bdi-dev-checkout` ประกาศ `adminToken` เป็น
`type: "default"` ตัวตรวจที่ดูแค่ `type: "secret"` จะมองข้ามไฟล์นั้นไปทั้งไฟล์
ค่าที่ยอมให้มีได้คือค่าว่าง ค่าตัวอย่างรูป `dev-…-change-me` ที่ checkout สำหรับพัฒนาใช้
และการอ้างถึงตัวแปรล้วน ๆ อย่าง `{{adminToken}}`

ที่ตรวจในไฟล์หนึ่ง (ทุกระดับ — collection · folder · request):
- ตัวแปรของ environment (`values`) และของ collection/folder (`variable`) — เดิมตรวจแค่ `values`
  ทั้งที่ `bdi-admin-portal.postman_collection.json` ประกาศ `adminToken` เป็นตัวแปรของ collection
  และคำอธิบายของมันบอกให้วาง token ตัวจริงลงไปตรงนั้น ไฟล์ collection จึงผ่านทุกครั้ง
- header และ query ที่ชื่อบอกว่าเป็นค่าลับ (`x-admin-token`) แต่ใส่ค่าจริงแทน `{{…}}`
- พารามิเตอร์ของ `auth` — `apikey` เก็บค่าลับไว้ใน `value` (ส่วน `key` คือชื่อ header ไม่ใช่ความลับ)
  แบบอื่นเก็บในชื่อที่บอกตัวเองอยู่แล้ว (`token` · `password` · `clientSecret`)
ที่ไม่ได้ตรวจ: ค่าที่เขียนตรง ๆ ลงใน script (`event`) และใน body ของ request
"""
import json
import re
import sys
from pathlib import Path

SECRET_NAME = re.compile(r"token|secret|key|password|passwd|pass$", re.I)
PLACEHOLDER = re.compile(r"^dev-[a-z0-9-]*change-me$")
REFERENCE = re.compile(r"^\{\{[^{}]+\}\}$")
# รายการ key/value ของ Postman ที่ถือค่าลับได้ — `variable` รวม path variable ของ `url` ด้วย
SCOPES = (("values", "ตัวแปร"), ("variable", "ตัวแปร"), ("header", "header"), ("query", "query"))


def literal(value) -> bool:
    """ค่าจริงที่ไม่ควรอยู่ในไฟล์ — ไม่ว่าง ไม่ใช่ค่าตัวอย่าง และไม่ใช่การอ้างถึงตัวแปร"""
    return isinstance(value, str) and bool(value) and not PLACEHOLDER.match(value) and not REFERENCE.match(value)


def auth_secrets(auth: dict):
    """(ชื่อ, ค่า) ของพารามิเตอร์ auth ที่ถือความลับ"""
    kind = auth.get("type")
    params = auth.get(kind) if isinstance(kind, str) else None
    for param in params if isinstance(params, list) else []:
        if not isinstance(param, dict):
            continue
        name = param.get("key", "")
        if kind == "apikey":
            if name == "value":
                yield f"{kind}.{name}", param.get("value")
        elif SECRET_NAME.search(name):
            yield f"{kind}.{name}", param.get("value")


def problems(path: Path) -> list[str]:
    data = json.loads(path.read_text(encoding="utf-8"))
    found = []
    stack = [data]
    while stack:
        node = stack.pop()
        if isinstance(node, list):
            stack.extend(node)
            continue
        if not isinstance(node, dict):
            continue
        for scope, label in SCOPES:
            entries = node.get(scope)
            for var in entries if isinstance(entries, list) else []:
                if not isinstance(var, dict):
                    continue
                name = var.get("key", "")
                value = var.get("value")
                if SECRET_NAME.search(name) and literal(value):
                    found.append(f"{path}: {label} `{name}` มีค่าอยู่ (ยาว {len(value)} ตัวอักษร) — ต้องเว้นว่างหรือใช้ {{{{…}}}}")
        auth = node.get("auth")
        if isinstance(auth, dict):
            for name, value in auth_secrets(auth):
                if literal(value):
                    found.append(f"{path}: auth `{name}` มีค่าอยู่ (ยาว {len(value)} ตัวอักษร) — ต้องอ้างถึงตัวแปร เช่น {{{{adminToken}}}}")
        stack.extend(v for k, v in node.items() if k != "auth" and k not in dict(SCOPES))
    return found


def main(argv: list[str]) -> int:
    root = Path(__file__).resolve().parents[1]
    files = [Path(a) for a in argv] or sorted(root.glob("*.postman_*.json"))
    issues = [msg for f in files for msg in problems(f)]
    for msg in issues:
        print(msg, file=sys.stderr)
    if not issues:
        print(f"ตรวจ {len(files)} ไฟล์ — ไม่พบค่าลับ")
    return 1 if issues else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
