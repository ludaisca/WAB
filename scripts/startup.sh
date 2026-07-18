#!/bin/sh
set -e

echo "=== WAB Production Startup ==="

echo "1. Generating Prisma client..."
npx prisma generate

echo "2. Running database migrations..."
if [ -d "prisma/migrations" ]; then
  npx prisma migrate deploy
else
  echo "No migrations found, using db push (development mode)"
  # --accept-data-loss: sin el flag, cualquier cambio de schema que elimine una
  # columna con datos (p. ej. la limpieza de campos write-only de 2026-07)
  # aborta el arranque en producción y el deploy entra en crash-loop. El
  # workflow de este repo es push-based (sin prisma/migrations) — si algún día
  # se migra a `migrate deploy`, quitar este flag.
  npx prisma db push --skip-generate --accept-data-loss
fi

echo "3. Ensuring pgvector index..."
npx prisma db execute --file prisma/sql/ensure-vector-index.sql --schema prisma/schema.prisma

echo "4. Starting application..."
exec npm start
