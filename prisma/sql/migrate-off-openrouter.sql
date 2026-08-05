-- Backfill idempotente: migra modelos/datos fuera de OpenRouter antes de que
-- `prisma db push` elimine las columnas `provider`/`defaultProvider`/
-- `openrouterApiKey` (2026-08, solo queda Gemini/Google).
-- Los UPDATEs corren únicamente si la columna `provider` todavía existe; en un
-- entorno ya migrado se saltan sin error (guardas via information_schema).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'wa_bots' AND column_name = 'provider') THEN
    UPDATE "wa_bots" SET "model" = 'google/gemini-2.5-flash' WHERE "provider" = 'openrouter' OR ("provider" <> 'google' AND "model" NOT LIKE 'google/%' AND "model" NOT LIKE 'gemini-%');
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'wa_lead_scorer_bots' AND column_name = 'provider') THEN
    UPDATE "wa_lead_scorer_bots" SET "model" = 'google/gemini-2.5-flash' WHERE "provider" = 'openrouter' OR ("provider" <> 'google' AND "model" NOT LIKE 'google/%' AND "model" NOT LIKE 'gemini-%');
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'app_settings' AND column_name = 'defaultProvider') THEN
    UPDATE "app_settings" SET "defaultModel" = 'google/gemini-2.5-flash' WHERE "defaultProvider" = 'openrouter' OR ("defaultProvider" <> 'google' AND "defaultModel" NOT LIKE 'google/%' AND "defaultModel" NOT LIKE 'gemini-%');
  END IF;
END $$;
