FROM node:22-alpine AS base
# postgresql16-client: matchea la versión mayor de "db" (pgvector/pgvector:pg16,
# ver docker-compose.yml) — pg_dump/pg_restore/psql los usa lib/backup/ para el
# sistema de respaldo/restauración, nunca el paquete de servidor completo.
RUN apk add --no-cache openssl libc6-compat postgresql16-client
WORKDIR /app

FROM base AS dev
COPY package*.json ./
RUN npm install
COPY prisma ./prisma
RUN npx prisma generate
COPY . .
EXPOSE 5000
CMD ["npm", "run", "dev"]

FROM base AS builder
COPY package*.json ./
# --include=dev: Coolify puede inyectar NODE_ENV=production como build-arg (ver
# docker-compose.yml ARG COOLIFY_FQDN/NODE_ENV/etc.), lo que hace que "npm ci" a
# secas omita devDependencies (typescript, @types/*) — Next.js las detecta
# faltantes y las reinstala a medias del build, desperdiciando tiempo. Forzarlas
# aquí no depende de cómo esté configurado ese toggle en la UI de Coolify.
RUN npm ci --include=dev
COPY prisma ./prisma
RUN npx prisma generate
COPY . .
# El build de Next con Turbopack (compilación + type-check de ~90 rutas) excede
# el límite de heap por defecto de V8 (~2GB) y aborta con
# "JavaScript heap out of memory" — visto tanto en local como en el build real
# de Coolify. 4096MB da margen sin acercarse al límite físico del host.
ENV NODE_OPTIONS="--max-old-space-size=4096"
RUN npm run build

FROM base AS runner
RUN apk add --no-cache wget
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.ts ./
COPY scripts/startup.sh ./startup.sh
RUN chmod +x startup.sh
EXPOSE 5000
CMD ["./startup.sh"]
