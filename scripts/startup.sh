#!/bin/sh
set -e

echo "=== WAB Production Startup ==="

echo "1. Generating Prisma client..."
npx prisma generate

echo "1b. Backfilling data off OpenRouter (no-op if already migrated)..."
# Debe correr ANTES de `db push` (migra modelos/data fuera de las columnas
# provider/openrouterApiKey que el push va a eliminar) — los guards IF EXISTS
# lo hacen inofensivo en entornos ya migrados.
npx prisma db execute --file prisma/sql/migrate-off-openrouter.sql --schema prisma/schema.prisma || echo "backfill skipped (columns already dropped)"

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

echo "2b. Backfilling campaign costs (no-op once already computed)..."
# Debe correr DESPUÉS de `db push` (necesita las columnas costUsd/totalCostUsd
# que el push acaba de crear). Ver prisma/sql/backfill-campaign-costs.sql —
# recalcula lo que campaign-worker.ts no pudo calcular en su momento porque
# el código de costeo (f6172c0, 2026-09-23) nunca había corrido en
# producción hasta el deploy que introduce este paso. Idempotente (solo toca
# costUsd IS NULL) — seguro dejarlo corriendo en cada arranque en vez de
# quitarlo después de la primera vez.
npx prisma db execute --file prisma/sql/backfill-campaign-costs.sql --schema prisma/schema.prisma || echo "campaign cost backfill skipped"

echo "3. Ensuring pgvector index..."
npx prisma db execute --file prisma/sql/ensure-vector-index.sql --schema prisma/schema.prisma

echo "4. Starting application..."
exec npm start
