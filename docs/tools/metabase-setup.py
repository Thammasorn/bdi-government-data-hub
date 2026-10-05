#!/usr/bin/env python3
"""ตั้ง Metabase สำหรับค้น log ใน MongoDB — รันครั้งเดียวหลัง `docker compose --profile tools up -d metabase`

    python3 docs/tools/metabase-setup.py            # อ่าน .env ของ checkout นี้
    python3 docs/tools/metabase-setup.py --questions-only   # สร้าง/อัปเดตคำถามสำเร็จรูปอย่างเดียว

ทำสามอย่าง (docs/21 §11):
1. สร้างบัญชีผู้ดูแล Metabase — อีเมล METABASE_ADMIN_EMAIL รหัสผ่านสุ่มเขียนลง .env (ไม่พิมพ์ออกจอ)
2. ต่อฐานข้อมูล "BDI log store" ด้วย bdi_reader (MONGO_READER_PASSWORD) — อ่านได้แค่สำเนาที่ปิดเลขบัตรแล้ว
3. สร้างคำถามสำเร็จรูปในคอลเลกชัน "BDI activity log" (สร้างซ้ำได้ — ตัวชื่อเดิมถูกเขียนทับ)

ใช้แค่ไลบรารีมาตรฐาน ไม่ต้องติดตั้งอะไรเพิ่ม
"""
import json
import secrets
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ENV = ROOT / ".env"


def read_env() -> dict:
    values = {}
    for line in ENV.read_text().splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            key, _, value = line.partition("=")
            values[key.strip()] = value.strip()
    return values


def append_env(key: str, value: str) -> None:
    with ENV.open("a") as f:
        f.write(f"{key}={value}\n")


env = read_env()
BASE = f"http://localhost:{env.get('METABASE_PORT', '3030')}"
SESSION = None


def call(method: str, path: str, body=None):
    req = urllib.request.Request(BASE + path, method=method)
    req.add_header("Content-Type", "application/json")
    if SESSION:
        req.add_header("X-Metabase-Session", SESSION)
    data = json.dumps(body).encode() if body is not None else None
    try:
        with urllib.request.urlopen(req, data, timeout=120) as res:
            raw = res.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as err:
        sys.exit(f"{method} {path} → {err.code}: {err.read().decode()[:500]}")


# ---------------------------------------------------------------- 1. บัญชีผู้ดูแล + ฐานข้อมูล

email = env.get("METABASE_ADMIN_EMAIL") or "admin@bdi.local"
password = env.get("METABASE_ADMIN_PASSWORD")
token = call("GET", "/api/session/properties").get("setup-token")

if token and "--questions-only" not in sys.argv:
    if not password:
        password = secrets.token_urlsafe(18)
        append_env("METABASE_ADMIN_EMAIL", email)
        append_env("METABASE_ADMIN_PASSWORD", password)
    call("POST", "/api/setup", {
        "token": token,
        "user": {"first_name": "BDI", "last_name": "Admin", "email": email, "password": password,
                 "site_name": "BDI activity log"},
        "prefs": {"site_name": "BDI activity log", "site_locale": "th", "allow_tracking": False},
    })
    print(f"สร้างบัญชีผู้ดูแล {email} แล้ว (รหัสผ่านอยู่ใน .env: METABASE_ADMIN_PASSWORD)")

if not password:
    sys.exit("ไม่มี METABASE_ADMIN_PASSWORD ใน .env — Metabase ถูกตั้งไว้ก่อนแล้วด้วยวิธีอื่น")
SESSION = call("POST", "/api/session", {"username": email, "password": password})["id"]

dbs = call("GET", "/api/database")["data"]
# Metabase ติด Sample Database (ข้อมูลร้านค้าสมมติ) กับคำถามตัวอย่างมาเอง — ลบทิ้ง คนเปิดมาจะได้เห็นแค่ log
for sample in [d for d in dbs if d.get("is_sample")]:
    call("DELETE", f"/api/database/{sample['id']}")
    print("ลบ Sample Database ของ Metabase แล้ว")
db = next((d for d in dbs if d["name"] == "BDI log store"), None)
if not db:
    if not env.get("MONGO_READER_PASSWORD"):
        sys.exit("ไม่มี MONGO_READER_PASSWORD ใน .env — ตั้งแล้วรัน mongo/init/01-users.js ใหม่ก่อน")
    db = call("POST", "/api/database", {
        "engine": "mongo",
        "name": "BDI log store",
        "details": {
            "host": "mongo", "port": 27017, "dbname": env.get("MONGODB_DB", "bdi_logs"),
            "user": "bdi_reader", "pass": env["MONGO_READER_PASSWORD"],
            "authdb": env.get("MONGODB_DB", "bdi_logs"), "use-conn-uri": False, "ssl": False,
        },
    })
    print("ต่อฐานข้อมูล BDI log store (bdi_reader) แล้ว — Metabase กำลัง sync")
    for _ in range(60):  # รอ sync ให้เห็น collection ก่อนสร้างคำถาม
        tables = call("GET", f"/api/database/{db['id']}/metadata")["tables"]
        if any(t["name"] == "activity" for t in tables):
            break
        time.sleep(3)

# ---------------------------------------------------------------- 2. คำถามสำเร็จรูป

coll = next((c for c in call("GET", "/api/collection") if c.get("name") == "BDI activity log"), None)
if not coll:
    coll = call("POST", "/api/collection", {"name": "BDI activity log", "color": "#192768",
                                             "description": "คำค้น log สำเร็จรูป — docs/21 §11"})

# เวลาแสดงเป็นเวลาไทย · object (before/after/metadata) แสดงเป็น JSON ในช่อง
BKK = {"$dateToString": {"date": "$occurredAt", "format": "%Y-%m-%d %H:%M:%S", "timezone": "Asia/Bangkok"}}
ROW = {"_id": 0, "เวลา (ไทย)": BKK, "action": 1, "via": 1, "ผู้กระทำ": "$actor.name", "บทบาท": "$actor.roles",
       "subject": "$subject.type", "เลขคำขอ": "$requestNumber", "result": 1, "before": 1, "after": 1,
       "metadata": 1, "IP": "$request.ip", "รหัสอ้างอิง": "$request.reference", "token fp": "$tokenFps"}


def text_tag(name: str, label: str) -> dict:
    return {name: {"id": name, "name": name, "display-name": label, "type": "text", "required": True}}


def by_org(extra_match=None) -> list:
    """หาหน่วยงานจากรหัส (ORG-…) หรือ uuid แล้วดึงทุก event ของ organizationId นั้น"""
    pipeline = [
        {"$match": {"$or": [{"organizationId": "{{org}}"}, {"after.organizationCode": "{{org}}"},
                            {"metadata.organization_code": "{{org}}"}]}},
        {"$group": {"_id": "$organizationId"}},
        {"$match": {"_id": {"$ne": None}}},
        {"$lookup": {"from": "activity", "localField": "_id", "foreignField": "organizationId", "as": "e"}},
        {"$unwind": "$e"},
        {"$replaceRoot": {"newRoot": "$e"}},
    ]
    if extra_match:
        pipeline.append({"$match": extra_match})
    return pipeline + [{"$sort": {"occurredAt": 1}}, {"$project": ROW}]


PERSON = [
    # บัญชีจากอีเมล: แถวที่มีอีเมลนี้ใน after/before ให้ userAccountId · หรือผู้กระทำที่ชื่อบัญชีเป็นอีเมลนี้
    {"$match": {"$or": [{"after.email": "{{email}}"}, {"before.email": "{{email}}"}, {"metadata.email": "{{email}}"}]}},
    {"$project": {"ids": {"$setUnion": [
        {"$ifNull": [{"$cond": [{"$eq": [{"$type": "$after.userAccountId"}, "string"]}, ["$after.userAccountId"], []]}, []]},
        {"$ifNull": ["$relatedUserIds", []]},
    ]}}},
    {"$unwind": "$ids"},
    {"$group": {"_id": "$ids"}},
    {"$lookup": {"from": "activity", "let": {"uid": "$_id"}, "as": "e", "pipeline": [
        {"$match": {"$expr": {"$or": [{"$eq": ["$actor.id", "$$uid"]}, {"$in": ["$$uid", {"$ifNull": ["$relatedUserIds", []]}]}]}}},
    ]}},
    {"$unwind": "$e"},
    {"$replaceRoot": {"newRoot": "$e"}},
    {"$group": {"_id": "$_id", "doc": {"$first": "$$ROOT"}}},
    {"$replaceRoot": {"newRoot": "$doc"}},
    {"$sort": {"occurredAt": 1}},
    {"$project": ROW},
]

QUESTIONS = [
    {
        "name": "1 · เส้นเวลาของหน่วยงาน",
        "description": "ใส่รหัสหน่วยงาน (เช่น ORG-0012) หรือ uuid — ทุก event ของหน่วยงานนั้นเรียงตามเวลา",
        "collection": "activity", "query": by_org(), "tags": text_tag("org", "รหัสหน่วยงาน หรือ uuid"),
    },
    {
        "name": "2 · admin สร้างหน่วยงานเมื่อไร และเชิญใครเข้าหน่วยงาน",
        "description": "ORGANIZATION_CREATED + ACTIVATION_KEY_ISSUED (คำเชิญทุกบทบาท — officer คือ ORGANIZATION_USER) + การเปิดใช้งานบัญชี",
        "collection": "activity",
        "query": by_org({"action": {"$in": ["ORGANIZATION_CREATED", "ACTIVATION_KEY_ISSUED", "ACTIVATION_KEY_USED",
                                            "ROLE_ASSIGNED", "INVITATION_DELETED", "ACTIVATION_KEY_REVOKED"]}}),
        "tags": text_tag("org", "รหัสหน่วยงาน หรือ uuid"),
    },
    {
        "name": "3 · ทุกอย่างของบุคคลนี้ (ค้นด้วยอีเมล)",
        "description": "สิ่งที่คนนี้ทำ และสิ่งที่คนอื่นทำกับบัญชีของคนนี้ — ค้นด้วยอีเมลของบัญชี",
        "collection": "activity", "query": PERSON, "tags": text_tag("email", "อีเมล"),
    },
    {
        "name": "4 · เส้นเวลาของคำขอ (เลขคำขอ)",
        "description": "ใส่เลขคำขอ เช่น ORG-REG-2026-0009 หรือ DS-REG-2026-0003",
        "collection": "activity",
        "query": [{"$match": {"requestNumber": "{{number}}"}}, {"$sort": {"occurredAt": 1}}, {"$project": ROW}],
        "tags": text_tag("number", "เลขคำขอ"),
    },
    {
        "name": "5 · ค้นด้วยรหัสอ้างอิงที่ผู้ใช้แจ้ง (error)",
        "description": "รหัส 8 ตัวที่ขึ้นในข้อความ \"เกิดข้อผิดพลาดภายในระบบ (รหัสอ้างอิง …)\"",
        "collection": "error_events",
        "query": [
            {"$match": {"$or": [{"request.reference": "{{ref}}"}, {"browser.reference": "{{ref}}"}]}},
            {"$sort": {"occurredAt": -1}},
            {"$project": {"_id": 0, "เวลา (ไทย)": BKK, "level": 1, "service": 1, "route": "$request.route",
                          "status": "$request.status", "error": "$error.name", "message": "$error.message",
                          "ที่": "$error.topFrame", "issue": "$fingerprint", "release": 1, "breadcrumbs": 1}},
        ],
        "tags": text_tag("ref", "รหัสอ้างอิง 8 ตัว"),
    },
    {
        "name": "6 · login ล้มเหลว 7 วันล่าสุด",
        "description": "นับตามวันและเหตุผล — ดูการเดารหัสผ่าน / OTP",
        "collection": "activity",
        "query": [
            {"$match": {"action": "LOGIN_FAILED", "$expr": {"$gte": ["$occurredAt",
                        {"$dateSubtract": {"startDate": "$$NOW", "unit": "day", "amount": 7}}]}}},
            {"$group": {"_id": {"วัน": {"$dateToString": {"date": "$occurredAt", "format": "%Y-%m-%d",
                                                           "timezone": "Asia/Bangkok"}},
                                "เหตุผล": "$metadata.failure_reason"}, "จำนวน": {"$sum": 1}}},
            {"$project": {"_id": 0, "วัน": "$_id.วัน", "เหตุผล": "$_id.เหตุผล", "จำนวน": 1}},
            {"$sort": {"วัน": -1, "จำนวน": -1}},
        ],
        "tags": {},
    },
    {
        "name": "7 · error issue ที่ยังเปิดอยู่",
        "description": "เรียงตามครั้งล่าสุดที่เกิด — ปิด issue ทำผ่าน API อ่าน log (Postman E4) ไม่ใช่ที่นี่",
        "collection": "error_issues",
        "query": [
            {"$match": {"status": "open"}},
            {"$sort": {"lastSeen": -1}},
            {"$project": {"_id": 0, "fingerprint": "$_id", "title": 1, "service": 1, "level": 1, "count": 1,
                          "ครั้งแรก (ไทย)": {"$dateToString": {"date": "$firstSeen", "format": "%Y-%m-%d %H:%M",
                                                                "timezone": "Asia/Bangkok"}},
                          "ล่าสุด (ไทย)": {"$dateToString": {"date": "$lastSeen", "format": "%Y-%m-%d %H:%M",
                                                              "timezone": "Asia/Bangkok"}},
                          "release": "$lastRelease"}},
        ],
        "tags": {},
    },
    {
        "name": "8 · การใช้ admin token ทั้งหมด (7 วัน)",
        "description": "ทุกคำสั่งของ admin API รวม GET และ token ที่ถูกปฏิเสธ — แยกตาม fingerprint ของ token",
        "collection": "activity",
        "query": [
            {"$match": {"via": "ADMIN_TOKEN", "$expr": {"$gte": ["$occurredAt",
                        {"$dateSubtract": {"startDate": "$$NOW", "unit": "day", "amount": 7}}]}}},
            {"$sort": {"occurredAt": -1}},
            {"$limit": 2000},
            {"$project": ROW},
        ],
        "tags": {},
    },
]


def substitute(obj):
    """ตัวแปรของ Metabase ใน Mongo native query เขียนเป็น {{name}} แทนค่า (Metabase ใส่เครื่องหมายคำพูดให้เอง)"""
    text = json.dumps(obj, ensure_ascii=False)
    for name in ("org", "email", "number", "ref"):
        text = text.replace(f'"{{{{{name}}}}}"', f"{{{{{name}}}}}")
    return text


existing = {c["name"]: c for c in call("GET", "/api/card") if c.get("collection_id") == coll["id"]}
for q in QUESTIONS:
    card = {
        "name": q["name"],
        "description": q["description"],
        "collection_id": coll["id"],
        "display": "table",
        "visualization_settings": {},
        "dataset_query": {
            "database": db["id"],
            "type": "native",
            "native": {"query": substitute(q["query"]), "collection": q["collection"], "template-tags": q["tags"]},
        },
    }
    if q["name"] in existing:
        call("PUT", f"/api/card/{existing[q['name']]['id']}", card)
        print("อัปเดต", q["name"])
    else:
        call("POST", "/api/card", card)
        print("สร้าง", q["name"])

print(f"เสร็จ — เปิด {BASE} แล้วเข้าคอลเลกชัน \"BDI activity log\"")
