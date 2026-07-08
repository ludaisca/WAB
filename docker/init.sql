CREATE EXTENSION IF NOT EXISTS vector;
CREATE INDEX IF NOT EXISTS idx_knowledge_embedding ON wa_bot_knowledge USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
