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

# NEXT_PUBLIC_* ถูกฝังลงบันเดิลตอน build ไม่ได้อ่านตอนรัน
# ถ้าไม่ส่งเข้ามาตรงนี้ เบราว์เซอร์จะยิงไปที่ localhost แทน API สาธารณะ
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_THAID_MOCK
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NEXT_PUBLIC_THAID_MOCK=${NEXT_PUBLIC_THAID_MOCK}

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
