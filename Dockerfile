# syntax=docker/dockerfile:1

# ---- deps: install production-ready node_modules ----
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- builder: compile the Next standalone bundle ----
FROM node:24-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---- runner: minimal runtime image ----
FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1
# Tokens are stored here; mount a volume to persist across restarts.
ENV DATABASE_PATH=/data/openusage.db

RUN addgroup -g 1001 nodejs \
  && adduser -u 1001 -G nodejs -S nextjs \
  && mkdir -p /data && chown nextjs:nodejs /data

# Standalone server + static assets.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

USER nextjs
EXPOSE 3000
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD ["node", "-e", "const port=process.env.PORT||3000; fetch('http://127.0.0.1:'+port+'/api/health').then((r)=>{if(!r.ok)process.exit(1);}).catch(()=>process.exit(1));"]

CMD ["node", "server.js"]
