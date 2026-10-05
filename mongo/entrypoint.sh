#!/bin/sh
# ด่านหน้า docker-entrypoint.sh ของ image mongo — ทำงาน**ทุกครั้ง**ที่คอนเทนเนอร์เริ่ม แล้วส่งต่อให้ของเดิม
#
# ทำไมไม่พอที่จะให้ init/01-users.js ปฏิเสธอย่างเดียว: docker-entrypoint.sh รันไฟล์ใน
# /docker-entrypoint-initdb.d **เฉพาะตอน volume ว่าง** และตอนที่มันรัน mongod ชั่วคราวได้สร้างไฟล์
# WiredTiger กับ root user (ด้วยรหัสผ่านที่ส่งมา) ไปแล้ว ถ้าสคริปต์ init ล้ม คอนเทนเนอร์ออก แล้ว
# `restart: unless-stopped` ปลุกขึ้นมาใหม่ — รอบนี้ entrypoint เห็นไฟล์ WiredTiger ก็ข้าม init แล้วเปิด
# mongod ตามปกติ: root ใช้รหัสผ่านตัวอย่าง และไม่มี user ของ backend/worker เลย (ลองกับ mongo:7.0 จริงแล้ว)
# ด่านนี้หยุดก่อน mongod จะแตะ volume จึงไม่มีอะไรค้างครึ่ง ๆ กลาง ๆ — ตั้งรหัสผ่านจริงใน .env แล้ว
# `up -d mongo` ใหม่ก็ init ได้ตามปกติ
#
# เปิดด้วย MONGO_REFUSE_DEV_PASSWORDS=true ซึ่ง docker-compose.prod.yml ตั้งให้ ที่ dev ไม่ได้ตั้ง ด่านนี้จึง
# ผ่านไปเฉย ๆ และ checkout ใช้ค่าตัวอย่างจาก .env.example ได้
#
# ปฏิเสธ = ออกด้วย 1 แล้วคอนเทนเนอร์วนรีสตาร์ต (docker หน่วงเวลาเพิ่มขึ้นเองจนถึงนาทีละครั้ง) mongo ไม่ขึ้น
# ซึ่งเว็บรับได้โดยออกแบบ: ไม่มี service ไหน depends_on mongo และ /health/ready ไม่นับ logStore
#
# กติกาเดียวกับ init/01-users.js (checkPasswords) ทุกข้อ — แก้ที่หนึ่งต้องแก้อีกที่
# backend/src/lib/log-store.ts (warnIfDevPassword) ใช้ร่วมแค่ข้อ dev-…/…change-me และแค่เตือน: มันเห็น URI ที่
# ประกอบเสร็จแล้ว ซึ่งไม่มีรหัสผ่านก็ได้ (managed Mongo) และมีอักขระพิเศษที่ encode เป็น %xx แล้วก็ได้
set -eu

if [ "${MONGO_REFUSE_DEV_PASSWORDS:-}" = "true" ]; then
  bad=""
  names="MONGO_INITDB_ROOT_PASSWORD MONGO_BACKEND_PASSWORD MONGO_WORKER_PASSWORD"
  # user ของเครื่องมือค้น log (bdi_reader) ไม่บังคับ — ว่าง = ไม่เปิด ตรวจเฉพาะเมื่อมีคนตั้ง
  if [ -n "${MONGO_READER_PASSWORD:-}" ]; then names="$names MONGO_READER_PASSWORD"; fi
  for name in $names; do
    eval "value=\${$name:-}"
    case "$value" in
      "" | dev-* | *change-me*)
        bad="$bad $name"
        continue
        ;;
    esac
    # รหัสผ่านของ backend/worker ถูกแทนลงใน MONGODB_URI ตรง ๆ ไม่ได้ encode — อักขระนอกชุดนี้ทำให้ URI เพี้ยน
    # แล้ว log store ขึ้น down ตลอดไปโดยไม่มีใครรู้ว่าเพราะอะไร (root ไม่ได้ลง URI จึงไม่ต้องตรวจข้อนี้)
    if [ "$name" != MONGO_INITDB_ROOT_PASSWORD ]; then
      case "$value" in
        *[!A-Za-z0-9._~-]*) bad="$bad $name" ;;
      esac
    fi
  done
  if [ -n "$bad" ]; then
    # พิมพ์แค่ชื่อตัวแปร ไม่พิมพ์ค่า
    echo "[mongo] ไม่เริ่ม MongoDB: รหัสผ่านต่อไปนี้ว่าง ยังเป็นค่าตัวอย่าง (dev-…/…change-me) หรือมีอักขระที่ใส่ใน URI ไม่ได้:$bad" >&2
    echo "[mongo] ตั้งใน .env ด้วยค่าจาก \`openssl rand -hex 32\` แล้ว \`docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d mongo\`" >&2
    exit 1
  fi
fi

exec docker-entrypoint.sh "$@"
