CREATE EXTENSION IF NOT EXISTS vector;
-- El índice ivfflat de wa_bot_knowledge se crea en scripts/startup.sh
-- (prod) y docker-compose.override.yml (dev) DESPUÉS de `prisma db push`,
-- ver prisma/sql/ensure-vector-index.sql. No se puede crear aquí:
-- este script corre en la inicialización de Postgres, antes de que
-- Prisma cree la tabla.
