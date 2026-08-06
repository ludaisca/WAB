-- Backfill puntual (2026-08-06): `gemini-3.1-flash-lite` faltó en la tabla de
-- precios de lib/ai/pricing.ts hasta 2026-08-05 (ver comentario en ese
-- archivo), así que estimateCost() devolvió $0 para cada interacción que usó
-- ese modelo y ese $0 quedó grabado permanentemente en la fila de uso. El
-- arreglo de la tabla de precios solo corrige llamadas NUEVAS — este script
-- recalcula las filas históricas ya afectadas usando el mismo precio
-- (input $0.25 / output $1.50 por 1M tokens) y el mismo redondeo a 4
-- decimales que usa estimateCost().
--
-- Idempotente: la condición `estimatedCost = 0` deja de matchear una vez
-- corregida la fila, así que correr esto de nuevo no la vuelve a tocar.
-- Acotado a wa_bot_usage y wa_lead_scorer_usage — son las dos únicas tablas
-- de uso de IA con filas $0/tokens>0 para este modelo (audio_transcription_usage,
-- agent_usage y wa_lead_recovery_attempts no tienen ninguna).

UPDATE "wa_bot_usage"
SET "estimatedCost" = ROUND(
  ((("promptTokens"::numeric / 1000000) * 0.25) + (("completionTokens"::numeric / 1000000) * 1.50))::numeric,
  4
)
WHERE "model" = 'gemini-3.1-flash-lite' AND "estimatedCost" = 0 AND "totalTokens" > 0;

UPDATE "wa_lead_scorer_usage"
SET "estimatedCost" = ROUND(
  ((("promptTokens"::numeric / 1000000) * 0.25) + (("completionTokens"::numeric / 1000000) * 1.50))::numeric,
  4
)
WHERE "model" = 'gemini-3.1-flash-lite' AND "estimatedCost" = 0 AND "totalTokens" > 0;
