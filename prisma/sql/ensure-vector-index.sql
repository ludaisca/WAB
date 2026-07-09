-- Idempotente. DEBE correr después de `prisma db push`/`migrate deploy`
-- (la tabla wa_bot_knowledge tiene que existir ya). Ver docker/init.sql
-- para por qué no puede crearse ahí.
CREATE EXTENSION IF NOT EXISTS vector;
CREATE INDEX IF NOT EXISTS idx_knowledge_embedding
  ON wa_bot_knowledge
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
