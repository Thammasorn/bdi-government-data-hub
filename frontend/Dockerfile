# syntax=docker/dockerfile:1

FROM node:22-alpine AS base
WORKDIR /app

# ---------- dependencies ----------
FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm ci || npm install

# ---------- development (used by docker compose) ----------
FROM base AS dev
ENV NODE_ENV=development
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 3000
# ดูคำอธิบายใน backend/Dockerfile — named volume บัง node_modules ของ image
CMD ["sh", "-c", "npm install --no-audit --no-fund && npm run dev"]

# ---------- build ----------
FROM base AS build
ENV NEXT_TELEMETRY_DISABLED=1
# ต้องเป็น production ตอน build ไม่งั้น React runtime คนละโหมดกับ output
# แล้ว prerender /_global-error จะล้มด้วย "Cannot read properties of null (reading 'useContext')"
ENV NODE_ENV=production

# NEXT_PUBLIC_* ถูกแทนค่าลงบันเดิลของเบราว์เซอร์ตอน build และ **ไม่ถูกอ่านอีกเลยตอนรัน**
# ตั้งใน Azure Container Apps หรือส่ง `docker run -e` แล้วจะเงียบ ๆ ไม่มีผล ต้อง build ใหม่
# เท่านั้นถึงจะเปลี่ยนได้ (ตรวจได้: ชื่อ NEXT_PUBLIC_API_URL ไม่เหลืออยู่ใน .next/static เลย)
#
# **ค่าที่ถูกต้องคือค่าว่าง** ปล่อยว่างแล้วเบราว์เซอร์เรียก /api/* ที่ origin เดียวกับหน้าเว็บ
# แล้ว app/api/[...path]/route.ts ส่งต่อไป backend ให้ — ไม่มี CORS และ session cookie
# ไม่กลายเป็น cross-site ใส่โดเมนเต็มลงไป (เช่น https://bdi-api.thammasorn.org) แล้ว
# การเข้าสู่ระบบจะพังทันที เพราะ SameSite=Lax ไม่ส่ง cookie ข้าม site
#
# อย่าสับสนกับ INTERNAL_API_URL ซึ่งเป็นคนละเรื่อง — ตัวนั้นอ่านตอนรับ request จึงตั้งตอนรันได้
# และ **ห้ามประกาศเป็น ARG ที่นี่** ไม่งั้นจะกลับไปฝังลง image เหมือนบั๊กที่แก้ไปเมื่อ 10 ก.ย.
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---------- production ----------
FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=build /app/public ./public
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
USER node
EXPOSE 3000
CMD ["node", "server.js"]
