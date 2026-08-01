# syntax=docker/dockerfile:1

FROM node:22-alpine AS base
# Prisma's query engine needs OpenSSL on Alpine.
RUN apk add --no-cache openssl
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
RUN npx prisma generate
EXPOSE 4000
# compose mounts a named volume over /app/node_modules, which shadows whatever
# the image baked in — so rebuilding alone never picks up new dependencies.
# Reconciling on every start keeps the volume in step with package.json.
CMD ["sh", "-c", "npm install --no-audit --no-fund && npx prisma generate && npm run dev"]

# ---------- build ----------
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npm run build

# ---------- production ----------
FROM base AS runner
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=build /app/dist ./dist
COPY prisma ./prisma
USER node
EXPOSE 4000
CMD ["node", "dist/index.js"]
