-- Recalcula WACampaign.sentCount desde los estados reales de sus destinatarios.
--
-- Contexto (2026-10): un mensaje aceptado por Meta (SENT) puede pasar después a
-- FAILED por un webhook tardío. El webhook recontaba delivered/read/failed pero
-- no sentCount, así que el "Enviados" del embudo quedaba inflado para siempre
-- (447 de 1,441 campañas, +1.1 en promedio). syncCampaignCounts() ya recontaba
-- desde estados; este script corrige el historial y es idempotente: solo toca
-- filas donde el contador no coincide.
UPDATE wa_campaigns c
SET "sentCount" = agg.sent
FROM (
  SELECT "campaignId",
         count(*) FILTER (WHERE status IN ('SENT', 'DELIVERED', 'READ')) AS sent
  FROM wa_campaign_recipients
  GROUP BY "campaignId"
) agg
WHERE c.id = agg."campaignId"
  AND c."sentCount" <> agg.sent;

-- Campañas sin destinatarios: el contador debe quedar en cero.
UPDATE wa_campaigns c
SET "sentCount" = 0
WHERE c."sentCount" <> 0
  AND NOT EXISTS (SELECT 1 FROM wa_campaign_recipients r WHERE r."campaignId" = c.id);
